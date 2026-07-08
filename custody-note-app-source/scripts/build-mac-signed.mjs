#!/usr/bin/env node
/**
 * Produces a signed + notarised macOS .dmg for distribution.
 *
 * Prerequisites (all environment variables MUST be set in your shell):
 *   APPLE_ID                       Your Apple ID email (the Developer Program one)
 *   APPLE_APP_SPECIFIC_PASSWORD    App-specific password from appleid.apple.com
 *                                  Looks like "xxxx-xxxx-xxxx-xxxx".
 *   APPLE_TEAM_ID                  10-character Team ID from developer.apple.com.
 *
 * Additional prerequisites on this Mac:
 *   - Active Apple Developer Program membership.
 *   - "Developer ID Application: <Your Name> (<TEAMID>)" certificate
 *     installed in your login Keychain. Verify by running:
 *
 *         npm run verify:mac:cert
 *
 *     The output must list at least one identity of the form
 *         "Developer ID Application: <something> (<APPLE_TEAM_ID>)"
 *
 * Output:
 *   dist/Custody Note-<version>.dmg            (x64,   signed + notarised)
 *   dist/Custody Note-<version>-arm64.dmg      (arm64, signed + notarised)
 *   plus matching .zip files and latest-mac.yml for the auto-updater feed.
 *
 * After electron-builder completes, this script runs
 *     spctl --assess --type execute
 * on each produced .app. That call exits zero only if Gatekeeper actually
 * accepts the signed + stapled bundle. Failure here means the .dmg will
 * not install cleanly on a fresh Mac (likely causes: notarisation failed,
 * stapling failed, or entitlements rejected the binary).
 *
 * Signing is now the DEFAULT: package.json build.mac sets hardenedRuntime:true
 * and no longer pins identity:null, so `npm run build:mac` / `npm run build`
 * sign + harden whenever a Developer ID certificate is available (and skip
 * signing gracefully when none is, rather than hard-failing). The explicit
 * unsigned local-dev flow is `npm run build:mac:dev`. This script remains the
 * full signed + NOTARISED pipeline used for distribution / CI releases and is
 * unaffected by those package.json defaults — it deep-clones the build config
 * and sets the exact signing identity, entitlements and notarize flags itself.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { homedir, tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const ENTITLEMENTS_REL = 'build/entitlements.mac.plist';
const ENTITLEMENTS_ABS = join(APP_ROOT, ENTITLEMENTS_REL);

/* The user's offline signing assets — raw private key + cert, generated when
 * the Apple Developer ID certificate was issued. If these are present we use
 * them to build a fresh, ephemeral .p12 with a random passphrase and hand
 * that to electron-builder via CSC_LINK + CSC_KEY_PASSWORD. electron-builder
 * imports it into its own temporary keychain internally with codesign trust
 * pre-granted, so signing is fully headless (no Keychain Access prompts).
 *
 * This is the documented electron-builder CI pattern. Falls back to the
 * login keychain (which can raise prompts) if the assets are missing. */
const SIGNING_STAGING_DIR = join(homedir(), '.cn-signing');
const SIGNING_KEY_FILE = join(SIGNING_STAGING_DIR, 'devid.key');
const SIGNING_CERT_FILE = join(SIGNING_STAGING_DIR, 'cert.pem');
const SIGNING_ASSETS_PRESENT =
  existsSync(SIGNING_KEY_FILE) && existsSync(SIGNING_CERT_FILE);

/* In CI (GitHub Actions runner) the certificate is imported directly into a
 * temporary keychain by the workflow step before this script runs. The temp
 * keychain is in the search list and pre-trusted for codesign, so we don't
 * need the ephemeral .p12 dance and we don't need to warn about Keychain
 * prompts — they cannot fire because partition-list is already set. */
const IS_CI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

/* CN_PUBLISH=always makes the build also upload artefacts (and latest-mac.yml)
 * to the matching GitHub Release via electron-builder's standard GitHub
 * publisher. Used by the release-publish.yml workflow so the Mac job can push
 * its outputs to the same draft release the Windows job populates. */
const PUBLISH_MODE = process.env.CN_PUBLISH || null;

function fail(msg) {
  console.error(`[build:mac:signed] FAIL: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[build:mac:signed] ${msg}`);
}

/* ────────────────────────────────────────────────────────────────────────
 * Pre-flight checks — fail fast before electron-builder spends 10 minutes
 * on something that will reject right at the end.
 * ──────────────────────────────────────────────────────────────────────── */

if (process.platform !== 'darwin') {
  fail(`must run on macOS (this host is ${process.platform}). Signed builds use Apple-only tooling (codesign, notarytool, spctl).`);
}

const REQUIRED_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missing.length > 0) {
  fail(
    `missing environment variable(s): ${missing.join(', ')}\n\n` +
    `Set them in your shell before running this build, e.g.:\n` +
    `    export APPLE_ID="you@example.com"\n` +
    `    export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"\n` +
    `    export APPLE_TEAM_ID="A1B2C3D4E5"\n` +
    `    npm run build:mac:signed\n\n` +
    `These values live only in your shell environment for the duration of the\n` +
    `build. They are NEVER read from or written to the repository.`
  );
}

function normalizeAppPassword(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (/^[a-z0-9]{16}$/i.test(s)) {
    s = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  }
  return s;
}

const APPLE_ID = process.env.APPLE_ID.trim();
const APPLE_APP_SPECIFIC_PASSWORD = normalizeAppPassword(process.env.APPLE_APP_SPECIFIC_PASSWORD);
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID.trim();
process.env.APPLE_APP_SPECIFIC_PASSWORD = APPLE_APP_SPECIFIC_PASSWORD;

if (!APPLE_ID.includes('@')) {
  fail(`APPLE_ID="${APPLE_ID}" does not look like an email address.`);
}

if (!/^[A-Z0-9]{10}$/.test(APPLE_TEAM_ID)) {
  fail(
    `APPLE_TEAM_ID="${APPLE_TEAM_ID}" is not a 10-character Apple Team ID.\n` +
    `Find yours at https://developer.apple.com/account → Membership.`
  );
}

if (!/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(APPLE_APP_SPECIFIC_PASSWORD)) {
  /* Apple's app-specific passwords are formatted as four 4-character groups
   * separated by hyphens. If yours doesn't match, you probably copied the
   * regular Apple ID password by mistake. */
  fail(
    `APPLE_APP_SPECIFIC_PASSWORD does not match Apple's "xxxx-xxxx-xxxx-xxxx" format.\n` +
    `Generate one at https://appleid.apple.com/ → Sign-In and Security →\n` +
    `App-Specific Passwords. Do NOT use your regular Apple ID password here.`
  );
}

if (!existsSync(ENTITLEMENTS_ABS)) {
  fail(`entitlements file not found at ${ENTITLEMENTS_ABS}. Run from repo root.`);
}

/* Confirm a Developer ID Application certificate matching the team is in
 * the Keychain. Without this, electron-builder would auto-discover a
 * different (or no) identity and the build would fail mid-way. */
const idCheck = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
  encoding: 'utf8',
});
if (idCheck.status !== 0) {
  fail(`"security find-identity" exited ${idCheck.status}: ${(idCheck.stderr || '').trim()}`);
}
const idOut = idCheck.stdout || '';
const teamRe = new RegExp(`"Developer ID Application:[^"]+\\(${APPLE_TEAM_ID}\\)"`);
if (!teamRe.test(idOut)) {
  fail(
    `no "Developer ID Application" certificate matching team ${APPLE_TEAM_ID} found in Keychain.\n\n` +
    `What "security find-identity -v -p codesigning" returned:\n` +
    idOut.split('\n').map((l) => '    ' + l).join('\n') + '\n\n' +
    `If the list is empty or only shows Mac App Store / Developer ID Installer certs,\n` +
    `download and install your "Developer ID Application" certificate from\n` +
    `https://developer.apple.com/account/resources/certificates`
  );
}
info(`Developer ID Application certificate present in Keychain for team ${APPLE_TEAM_ID}`);
info(`APPLE_ID=${APPLE_ID} APPLE_TEAM_ID=${APPLE_TEAM_ID}`);

/* ────────────────────────────────────────────────────────────────────────
 * Build a config override that takes the unsigned package.json baseline and
 * flips the macOS-specific bits required for signing + notarisation. We do
 * this by deep-cloning the package.json "build" block and rewriting the
 * "mac" key. That guarantees:
 *   - Windows/NSIS config is untouched (we don't pass any platform flag
 *     that would affect Windows in this script's electron-builder call).
 *   - The unsigned build's "build.mac" object in package.json is untouched
 *     on disk — only the in-memory copy passed to electron-builder differs.
 * ──────────────────────────────────────────────────────────────────────── */

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const baseBuild = pkg.build || {};
const baseMac = baseBuild.mac || {};

/* Pull the actual signing identity name out of the Keychain so we can set it
 * explicitly rather than relying on auto-discovery. Setting it explicitly to
 * the matched string forces electron-builder to sign with exactly this cert
 * (and avoids any ambiguity if multiple identities are present). */
const idLine = idOut.split('\n').find((l) => teamRe.test(l));
const idMatch = idLine && idLine.match(/"(Developer ID Application:[^"]+)"/);
if (!idMatch) {
  fail(`could not parse identity name from "${idLine || '<no line>'}"`);
}
const SIGNING_IDENTITY_FULL = idMatch[1];
// electron-builder 26.x rejects the 'Developer ID Application:' prefix and wants only
// the common-name suffix (e.g. 'Robert Cashman (D99FL3LWH3)'). It still resolves
// to the exact same cert in the Keychain.
const SIGNING_IDENTITY = SIGNING_IDENTITY_FULL.replace(/^Developer ID Application:\s*/, '');
info(`signing identity: ${SIGNING_IDENTITY_FULL} (passed to electron-builder as: ${SIGNING_IDENTITY})`);

const overrideMac = {
  ...baseMac,
  identity: SIGNING_IDENTITY,
  hardenedRuntime: true,
  /* gatekeeperAssess: electron-builder's own post-build spctl check.
   * We disable theirs (because we run it ourselves below with verbose
   * output) but leave the build to proceed. */
  gatekeeperAssess: false,
  entitlements: ENTITLEMENTS_REL,
  entitlementsInherit: ENTITLEMENTS_REL,
  /* electron-builder 26.x: `notarize` is a boolean. Credentials and team
   * ID are read from APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
   * env vars (validated above). Earlier versions accepted an object with
   * teamId here; that schema was removed in 26.0. */
  notarize: true,
};

/* ────────────────────────────────────────────────────────────────────────
 * Build an ephemeral .p12 from the raw key + certificate so we can hand
 * electron-builder CSC_LINK + CSC_KEY_PASSWORD. This is the documented
 * CI pattern: electron-builder imports the .p12 into its own temporary
 * keychain with codesign trust pre-granted, then deletes that keychain at
 * the end of the build. The Keychain "Allow / Always Allow" dialog the
 * user kept hitting against the login keychain never appears in this
 * flow.
 *
 * We use a random passphrase that lives only in this process — the .p12
 * file itself is written under os.tmpdir() and removed in a finally{}
 * block below.
 * ──────────────────────────────────────────────────────────────────────── */

let ephemeralP12Dir = null;
if (SIGNING_ASSETS_PRESENT) {
  ephemeralP12Dir = mkdtempSync(join(tmpdir(), 'cn-signing-'));
  const p12Path = join(ephemeralP12Dir, 'devid.p12');
  const p12Pass = randomBytes(24).toString('hex');

  const exp = spawnSync(
    'openssl',
    [
      'pkcs12', '-export',
      '-inkey', SIGNING_KEY_FILE,
      '-in', SIGNING_CERT_FILE,
      '-out', p12Path,
      '-password', `pass:${p12Pass}`,
    ],
    { encoding: 'utf8' }
  );
  if (exp.status !== 0) {
    fail(`openssl pkcs12 -export failed: ${(exp.stderr || exp.stdout || '').trim()}`);
  }

  process.env.CSC_LINK = p12Path;
  process.env.CSC_KEY_PASSWORD = p12Pass;
  info(`built ephemeral signing p12 at ${p12Path} — electron-builder will use its own temp keychain (no codesign prompts)`);
} else if (IS_CI) {
  info(
    `CI detected: Developer ID certificate is expected to be pre-imported into a ` +
    `temporary keychain by the workflow (with partition-list set so codesign can ` +
    `use it without prompts). The "security find-identity" check above confirmed ` +
    `it is present.`
  );
} else {
  info(
    `~/.cn-signing/{devid.key,cert.pem} not present — falling back to the ` +
    `login keychain for signing. codesign may raise interactive ` +
    `"Allow / Always Allow" prompts during the build.`
  );
}

const config = {
  ...baseBuild,
  mac: overrideMac,
};

/* ────────────────────────────────────────────────────────────────────────
 * Invoke electron-builder programmatically. The dynamic import avoids
 * pulling the (heavy) electron-builder API into Node's startup cost for
 * the much smaller validation script above.
 * ──────────────────────────────────────────────────────────────────────── */

if (PUBLISH_MODE) {
  info(`CN_PUBLISH=${PUBLISH_MODE} — electron-builder will upload artefacts and latest-mac.yml to the matching GitHub release.`);
}

info('starting electron-builder (signing + notarisation can take 5–15 minutes)…');
const electronBuilder = await import('electron-builder');
const { build, Platform } = electronBuilder;

let artefacts;
try {
  const buildOpts = {
    targets: Platform.MAC.createTarget(),
    config,
  };
  if (PUBLISH_MODE) buildOpts.publish = PUBLISH_MODE;
  artefacts = await build(buildOpts);
} catch (e) {
  fail(`electron-builder failed: ${e && e.message ? e.message : String(e)}`);
} finally {
  /* Always wipe the ephemeral .p12 + its passphrase from env, even on
   * failure. Otherwise a crashed build would leave the .p12 readable on
   * the local filesystem indefinitely. */
  if (ephemeralP12Dir) {
    try { rmSync(ephemeralP12Dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  delete process.env.CSC_LINK;
  delete process.env.CSC_KEY_PASSWORD;
}

info('electron-builder completed. Built artefacts:');
for (const a of artefacts || []) {
  info(`  - ${a}`);
}

/* ────────────────────────────────────────────────────────────────────────
 * Post-build Gatekeeper assessment. spctl --assess returns 0 only if the
 * .app is signed AND notarised AND the ticket is stapled. Anything else
 * means an end user double-clicking the .dmg will hit a warning.
 * ──────────────────────────────────────────────────────────────────────── */

info('running spctl --assess on each built .app …');
let anyFailed = false;
for (const dir of ['mac', 'mac-arm64']) {
  const appPath = join(APP_ROOT, 'dist', dir, 'Custody Note.app');
  if (!existsSync(appPath)) {
    info(`  (skipped, not present: ${appPath})`);
    continue;
  }
  const r = spawnSync('spctl', ['--assess', '--verbose=4', '--type', 'execute', appPath], {
    encoding: 'utf8',
  });
  const out = ((r.stderr || '') + (r.stdout || '')).trim();
  if (r.status !== 0) {
    anyFailed = true;
    console.error(`[build:mac:signed] FAIL: spctl rejected ${appPath}\n${out.split('\n').map((l) => '    ' + l).join('\n')}`);
  } else {
    info(`  OK ${appPath} — ${out}`);
  }
}

if (anyFailed) {
  fail(
    `at least one .app was rejected by Gatekeeper. Likely causes:\n` +
    `  - notarisation silently failed (check the electron-builder output above for "notarytool" errors)\n` +
    `  - the entitlements requested are not permitted for your certificate\n` +
    `  - the certificate is "Developer ID Application" but expired or revoked\n` +
    `Do NOT distribute the .dmg until spctl passes.`
  );
}

info('signed + notarised build OK. Artefacts ready for distribution in dist/.');
