#!/usr/bin/env node
/**
 * Produces a Developer ID–signed macOS .dmg for distribution (notarised by default).
 *
 * Prerequisites:
 *   APPLE_TEAM_ID                  10-character Team ID from developer.apple.com (required).
 *   APPLE_ID                       Apple ID email (required unless local CN_SKIP_NOTARIZE=1).
 *   APPLE_APP_SPECIFIC_PASSWORD    App-specific password (required unless local CN_SKIP_NOTARIZE=1).
 *   CN_SKIP_NOTARIZE=1             Local/dev escape only: codesign without notarytool.
 *                                  Forbidden in CI (GITHUB_ACTIONS/CI) and whenever
 *                                  CN_PUBLISH is set — GitHub Release Mac assets must
 *                                  be notarised. Gatekeeper may need right-click → Open
 *                                  for unnotarized local builds.
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
 * After electron-builder completes (and BEFORE any GitHub Release upload), this
 * script runs spctl --assess on each produced .app and mounts each .dmg to
 * assess the embedded .app. That exits zero only if Gatekeeper accepts the
 * signed + stapled bundle. Failure means artefacts must not be published.
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

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
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

/* CN_PUBLISH=always makes this script upload artefacts (and latest-mac.yml)
 * to the matching GitHub Release AFTER Gatekeeper assessment passes.
 * Upload is deferred so Unnotarized Developer ID builds never hit Releases. */
const PUBLISH_MODE = process.env.CN_PUBLISH || null;

/* CN_SKIP_NOTARIZE=1 — local/dev only: Developer ID codesign without notarytool.
 * Forbidden when IS_CI or CN_PUBLISH is set (GitHub Release path must notarise). */
const SKIP_NOTARIZE =
  process.env.CN_SKIP_NOTARIZE === '1' ||
  /^true$/i.test(String(process.env.CN_SKIP_NOTARIZE || ''));

function fail(msg) {
  console.error(`[build:mac:signed] FAIL: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[build:mac:signed] ${msg}`);
}

function warn(msg) {
  console.warn(`[build:mac:signed] WARN: ${msg}`);
}

/* ────────────────────────────────────────────────────────────────────────
 * Pre-flight checks — fail fast before electron-builder spends 10 minutes
 * on something that will reject right at the end.
 * ──────────────────────────────────────────────────────────────────────── */

if (process.platform !== 'darwin') {
  fail(`must run on macOS (this host is ${process.platform}). Signed builds use Apple-only tooling (codesign, notarytool, spctl).`);
}

if (SKIP_NOTARIZE && (IS_CI || PUBLISH_MODE)) {
  fail(
    `CN_SKIP_NOTARIZE=1 is not allowed for CI or GitHub Release publish.\n` +
    `Release Mac assets must be notarised. Fix APPLE_APP_SPECIFIC_PASSWORD\n` +
    `(or unset CN_PUBLISH / run outside CI for a local unsigned-notary experiment).\n` +
    `Refusing to produce Developer ID–signed-but-unnotarized release artefacts.`,
  );
}

function normalizeAppPassword(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (/^[a-z0-9]{16}$/i.test(s)) {
    s = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  }
  return s;
}

const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || '').trim();
if (!APPLE_TEAM_ID) {
  fail(
    `missing environment variable: APPLE_TEAM_ID\n\n` +
    `Set it before running this build (needed to select the Developer ID identity).\n` +
    `Find yours at https://developer.apple.com/account → Membership.`
  );
}

if (!/^[A-Z0-9]{10}$/.test(APPLE_TEAM_ID)) {
  fail(
    `APPLE_TEAM_ID="${APPLE_TEAM_ID}" is not a 10-character Apple Team ID.\n` +
    `Find yours at https://developer.apple.com/account → Membership.`
  );
}

let APPLE_ID = String(process.env.APPLE_ID || '').trim();
let APPLE_APP_SPECIFIC_PASSWORD = normalizeAppPassword(process.env.APPLE_APP_SPECIFIC_PASSWORD);

if (SKIP_NOTARIZE) {
  info(
    'CN_SKIP_NOTARIZE=1 (local/dev only) — will Developer ID–sign without notarization. ' +
    'First launch on a fresh Mac may need right-click → Open. Not for GitHub Releases.',
  );
  // Notary env is optional when skipping; keep whatever is present for logging only.
  if (APPLE_APP_SPECIFIC_PASSWORD) {
    process.env.APPLE_APP_SPECIFIC_PASSWORD = APPLE_APP_SPECIFIC_PASSWORD;
  }
} else {
  const missing = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'].filter(
    (k) => !process.env[k] || !String(process.env[k]).trim(),
  );
  if (missing.length > 0) {
    fail(
      `missing environment variable(s): ${missing.join(', ')}\n\n` +
      `Set them in your shell before running this build, e.g.:\n` +
      `    export APPLE_ID="you@example.com"\n` +
      `    export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"\n` +
      `    export APPLE_TEAM_ID="A1B2C3D4E5"\n` +
      `    npm run build:mac:signed\n\n` +
      `For local experimentation only (not CI / not CN_PUBLISH), you may set\n` +
      `CN_SKIP_NOTARIZE=1 to codesign without notarization.\n` +
      `These values live only in your shell environment for the duration of the\n` +
      `build. They are NEVER read from or written to the repository.`
    );
  }

  if (!APPLE_ID.includes('@')) {
    fail(`APPLE_ID="${APPLE_ID}" does not look like an email address.`);
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

  process.env.APPLE_APP_SPECIFIC_PASSWORD = APPLE_APP_SPECIFIC_PASSWORD;
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
info(
  SKIP_NOTARIZE
    ? `APPLE_TEAM_ID=${APPLE_TEAM_ID} (notarization skipped — local/dev only)`
    : `APPLE_ID=${APPLE_ID} APPLE_TEAM_ID=${APPLE_TEAM_ID}`,
);

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
   * env vars (validated above when notarizing). Earlier versions accepted an
   * object with teamId here; that schema was removed in 26.0.
   * CN_SKIP_NOTARIZE=1 (local/dev only) keeps codesign but skips notarytool. */
  notarize: !SKIP_NOTARIZE,
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
 *
 * Publish is intentionally deferred until AFTER Gatekeeper assessment so
 * Unnotarized Developer ID artefacts never reach GitHub Releases.
 * ──────────────────────────────────────────────────────────────────────── */

if (PUBLISH_MODE) {
  info(
    `CN_PUBLISH=${PUBLISH_MODE} — will upload to GitHub Release only after spctl passes ` +
    `(build phase does not publish).`,
  );
}

info(
  SKIP_NOTARIZE
    ? 'starting electron-builder (Developer ID signing only — notarisation skipped, local/dev)…'
    : 'starting electron-builder (signing + notarisation can take 5–15 minutes)…'
);
const electronBuilder = await import('electron-builder');
const { build, Platform } = electronBuilder;

let artefacts;
try {
  const buildOpts = {
    targets: Platform.MAC.createTarget(),
    config,
  };
  // Never pass publish here — assess first, then upload below.
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

/**
 * Run spctl --assess --type execute on a .app. Returns true on accept.
 * @param {string} appPath
 * @returns {boolean}
 */
function spctlAssessApp(appPath) {
  const r = spawnSync('spctl', ['--assess', '--verbose=4', '--type', 'execute', appPath], {
    encoding: 'utf8',
  });
  const out = ((r.stderr || '') + (r.stdout || '')).trim();
  if (r.status !== 0) {
    console.error(
      `[build:mac:signed] FAIL: spctl rejected ${appPath}\n` +
      out.split('\n').map((l) => '    ' + l).join('\n'),
    );
    if (/unnotarized developer id/i.test(out)) {
      console.error(
        '[build:mac:signed] Gatekeeper reports Unnotarized Developer ID — ' +
        'refusing to publish. Check notarytool / APPLE_APP_SPECIFIC_PASSWORD.',
      );
    }
    return false;
  }
  info(`  OK ${appPath} — ${out || 'accepted'}`);
  return true;
}

/**
 * Mount a .dmg read-only, spctl-assess the embedded Custody Note.app, detach.
 * @param {string} dmgPath
 * @returns {boolean}
 */
function spctlAssessDmgContents(dmgPath) {
  const mountPoint = mkdtempSync(join(tmpdir(), 'cn-dmg-assess-'));
  try {
    const attach = spawnSync(
      'hdiutil',
      ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgPath],
      { encoding: 'utf8' },
    );
    if (attach.status !== 0) {
      console.error(
        `[build:mac:signed] FAIL: could not attach ${dmgPath}\n` +
        ((attach.stderr || attach.stdout || '').trim()),
      );
      return false;
    }
    const appPath = join(mountPoint, 'Custody Note.app');
    if (!existsSync(appPath)) {
      console.error(
        `[build:mac:signed] FAIL: ${dmgPath} has no Custody Note.app at mount root ` +
        `(entries: ${readdirSync(mountPoint).join(', ') || '<empty>'})`,
      );
      return false;
    }
    info(`  assessing .app inside ${dmgPath} …`);
    return spctlAssessApp(appPath);
  } finally {
    spawnSync('hdiutil', ['detach', mountPoint, '-force'], { encoding: 'utf8' });
    try { rmSync(mountPoint, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function listBuiltDmgs() {
  const dist = join(APP_ROOT, 'dist');
  if (!existsSync(dist)) return [];
  const version = String(pkg.version || '');
  const names = readdirSync(dist).filter(
    (n) =>
      n.endsWith('.dmg') &&
      !n.endsWith('.blockmap') &&
      (n.includes(version) || n.startsWith('Custody-Note-') || n.startsWith('Custody Note')),
  );
  return names.map((n) => join(dist, n));
}

/* ────────────────────────────────────────────────────────────────────────
 * Post-build assessment (before any GitHub Release upload).
 * - Full path: spctl --assess on each .app AND on the .app inside each .dmg.
 * - CN_SKIP_NOTARIZE (local/dev only): codesign --verify only.
 * ──────────────────────────────────────────────────────────────────────── */

let anyFailed = false;
if (SKIP_NOTARIZE) {
  info('running codesign --verify on each built .app (notarization skipped, local/dev) …');
  for (const dir of ['mac', 'mac-arm64']) {
    const appPath = join(APP_ROOT, 'dist', dir, 'Custody Note.app');
    if (!existsSync(appPath)) {
      info(`  (skipped, not present: ${appPath})`);
      continue;
    }
    const r = spawnSync(
      'codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', appPath],
      { encoding: 'utf8' },
    );
    const out = ((r.stderr || '') + (r.stdout || '')).trim();
    if (r.status !== 0) {
      anyFailed = true;
      console.error(
        `[build:mac:signed] FAIL: codesign --verify rejected ${appPath}\n` +
        out.split('\n').map((l) => '    ' + l).join('\n'),
      );
    } else {
      info(`  OK ${appPath} — Developer ID signature verified`);
      if (out) info(`    ${out.split('\n')[0]}`);
    }
  }

  if (anyFailed) {
    fail(
      `at least one .app failed codesign --verify. Do NOT distribute until the ` +
      `Developer ID signature is valid.`,
    );
  }

  warn(
    'Signed (not notarised) local build OK. Do not upload to GitHub Releases. ' +
    'First launch on a fresh Mac may require right-click → Open until a ' +
    'notarised rebuild is published.',
  );
  info('Artefacts ready in dist/ (local/dev only).');
} else {
  info('running spctl --assess on each built .app …');
  let assessedApps = 0;
  for (const dir of ['mac', 'mac-arm64']) {
    const appPath = join(APP_ROOT, 'dist', dir, 'Custody Note.app');
    if (!existsSync(appPath)) {
      info(`  (skipped, not present: ${appPath})`);
      continue;
    }
    assessedApps += 1;
    if (!spctlAssessApp(appPath)) anyFailed = true;
  }
  if (assessedApps === 0) {
    fail('no built .app found under dist/mac or dist/mac-arm64 — cannot Gatekeeper-assess.');
  }

  info('running spctl --assess on .app inside each built .dmg …');
  const dmgs = listBuiltDmgs();
  if (dmgs.length === 0) {
    fail('no .dmg artefacts found under dist/ — refusing to publish without DMG Gatekeeper check.');
  }
  for (const dmgPath of dmgs) {
    if (!spctlAssessDmgContents(dmgPath)) anyFailed = true;
  }

  if (anyFailed) {
    fail(
      `at least one .app/.dmg was rejected by Gatekeeper. Likely causes:\n` +
      `  - notarisation silently failed (check the electron-builder output above for "notarytool" errors)\n` +
      `  - the entitlements requested are not permitted for your certificate\n` +
      `  - the certificate is "Developer ID Application" but expired or revoked\n` +
      `Do NOT upload artefacts until spctl passes.`,
    );
  }

  info('signed + notarised build OK (spctl accepted .app and .dmg contents).');
}

/* ────────────────────────────────────────────────────────────────────────
 * GitHub Release upload — only after Gatekeeper assessment passed.
 * ──────────────────────────────────────────────────────────────────────── */

if (PUBLISH_MODE) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    fail('CN_PUBLISH is set but GH_TOKEN / GITHUB_TOKEN is missing — cannot upload.');
  }
  const tag = `v${pkg.version}`;
  info(`Gatekeeper OK — ensuring GitHub release ${tag} exists, then uploading…`);
  const { fetchReleaseByTag, waitForReleaseByTag, RELEASE_OWNER, RELEASE_REPO, releaseApiHeaders } =
    await import('./github-release-api.mjs');

  let release;
  try {
    release = await fetchReleaseByTag(tag, token);
  } catch (_) {
    info(`Release ${tag} not found yet — waiting for CI Windows job / creating draft if needed…`);
    try {
      release = await waitForReleaseByTag(tag, token, { maxAttempts: 24, delayMs: 5000 });
    } catch (waitErr) {
      info(`Still no release after wait (${waitErr.message || waitErr}) — creating draft…`);
      const createRes = await fetch(
        `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases`,
        {
          method: 'POST',
          headers: {
            ...releaseApiHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tag_name: tag,
            name: tag,
            draft: true,
            prerelease: false,
            generate_release_notes: false,
          }),
        },
      );
      if (!createRes.ok) {
        fail(
          `Failed to create draft release ${tag}: HTTP ${createRes.status} ` +
          `${(await createRes.text()).slice(0, 300)}`,
        );
      }
      release = await createRes.json();
      info(`Created draft release ${tag} (id ${release.id}).`);
    }
  }
  if (!release || !release.id) {
    fail(`Could not resolve GitHub release ${tag} for upload.`);
  }

  const up = spawnSync(process.execPath, [join(__dirname, 'upload-mac-release-assets.mjs')], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (up.status !== 0) {
    fail(`GitHub Release Mac asset upload failed (exit ${up.status == null ? 1 : up.status}).`);
  }
  info('Mac artefacts uploaded to GitHub Release after successful Gatekeeper assessment.');
}
