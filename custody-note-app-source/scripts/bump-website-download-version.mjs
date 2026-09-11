#!/usr/bin/env node
/**
 * Bump custodynote.com download page + stats API defaults to the app package
 * version, and soften Mac notarization marketing copy when shipping a
 * Developer ID–signed (not yet notarised) build.
 *
 * The live download version is owned by data/releases.json (via getLatestVersion).
 * When that file already matches TO_VERSION and there are no hardcoded pins left
 * to rewrite, this script exits 0 as a successful no-op (copy softening may
 * still apply). It only fails when the site is genuinely behind AND nothing
 * could be updated.
 *
 * Run against a clone of robertcashman-bit/custody-note-website:
 *   WEBSITE_ROOT=../custody-note-website node scripts/bump-website-download-version.mjs
 *
 * Env:
 *   WEBSITE_ROOT — path to website clone (required)
 *   FROM_VERSION — previous version string (default: detect from website sources)
 *   TO_VERSION — target version (default: app package.json version)
 *   SOFTEN_NOTARY_COPY — "0" to skip copy softening (default: soften)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[bump-website-download] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const TO_VERSION = String(process.env.TO_VERSION || pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(TO_VERSION)) {
  console.error('[bump-website-download] Invalid TO_VERSION:', TO_VERSION);
  process.exit(1);
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'coverage',
  '.vercel',
]);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot) : '';
      if (TEXT_EXT.has(ext)) out.push(p);
    }
  }
  return out;
}

/**
 * Authoritative live product version on the marketing site.
 * Download UI uses getLatestVersion() from data/releases.json (synced by
 * sync-website / changelog bots). Hardcoded download pins may be absent.
 */
function readReleasesJsonVersion() {
  const p = join(WEBSITE_ROOT, 'data', 'releases.json');
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    const v = String(data?.version || '').trim();
    return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function detectFromVersion(files) {
  if (process.env.FROM_VERSION && process.env.FROM_VERSION.trim()) {
    return process.env.FROM_VERSION.trim();
  }
  const counts = new Map();
  const re = /\b1\.\d+\.\d+\b/g;
  for (const f of files) {
    // Prefer download + API routes for the live product version pin.
    // Do not treat historical entries inside releases.json as live pins —
    // the top-level `version` field is authoritative (see readReleasesJsonVersion).
    const rel = relative(WEBSITE_ROOT, f).replace(/\\/g, '/');
    if (
      !rel.includes('download') &&
      !rel.includes('stats/download') &&
      !rel.includes('lib/site') &&
      !rel.includes('product-copy')
    ) {
      continue;
    }
    if (rel === 'data/releases.json' || rel.endsWith('/releases.json')) continue;
    const text = readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      const v = m[0];
      if (v === TO_VERSION) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  // Prefer the newest prior pin (semver), not the most frequent string.
  // Frequency can pick stale leftovers (e.g. 1.4.188) over the live pin (1.9.70).
  function cmpSemver(a, b) {
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }
  let best = null;
  for (const v of counts.keys()) {
    if (!best || cmpSemver(v, best) > 0) best = v;
  }
  return best;
}

const files = walk(WEBSITE_ROOT);
// Never rewrite historical versions inside releases.json / blog imports —
// sync-website.mjs owns those. Version pin bumps are for download UI + API routes.
const mutableFiles = files.filter((f) => {
  const rel = relative(WEBSITE_ROOT, f).replace(/\\/g, '/');
  if (rel === 'data/releases.json') return false;
  if (rel === 'data/blog-imports.json') return false;
  if (rel.startsWith('data/blog-imports/')) return false;
  return true;
});

const releasesVersion = readReleasesJsonVersion();
let FROM_VERSION = detectFromVersion(files);

if (releasesVersion === TO_VERSION) {
  // Site already advertises the target version via releases.json — no hardcoded
  // pin bump is required. Still allow Mac notarization copy softening below.
  FROM_VERSION = TO_VERSION;
  console.log(
    `[bump-website-download] releases.json already at ${TO_VERSION} — version pins not required (copy-only pass).`,
  );
} else if (!FROM_VERSION) {
  // Prefer releases.json as the prior pin when download UI has no hardcoded version.
  FROM_VERSION = releasesVersion || TO_VERSION;
  if (FROM_VERSION === TO_VERSION) {
    console.log(
      `[bump-website-download] No prior version pin found; treating as already at ${TO_VERSION} (copy-only pass).`,
    );
  } else {
    console.log(
      `[bump-website-download] No hardcoded pin; using releases.json ${FROM_VERSION} → ${TO_VERSION}`,
    );
  }
} else if (FROM_VERSION === TO_VERSION) {
  console.log(`[bump-website-download] Already at ${TO_VERSION} — applying copy softening only.`);
} else {
  console.log(`[bump-website-download] ${FROM_VERSION} → ${TO_VERSION}`);
}

const soften = process.env.SOFTEN_NOTARY_COPY !== '0';

/** Ordered string replacements applied after version bump. */
const COPY_REPLACEMENTS = [
  [
    'macOS 11 or later · Apple Silicon & Intel · signed & notarised · ~130 MB',
    'macOS 11 or later · Apple Silicon & Intel · Developer ID signed · ~130 MB',
  ],
  [
    'macOS 11 or later · Apple Silicon &amp; Intel · signed &amp; notarised · ~130 MB',
    'macOS 11 or later · Apple Silicon &amp; Intel · Developer ID signed · ~130 MB',
    { optional: true },
  ],
  [
    'On first launch, Custody Note is signed and notarised and should open normally. If macOS Gatekeeper blocks the app, right-click Custody Note in Applications and choose Open once.',
    'Custody Note is Developer ID signed. Notarization may still be pending, so on first launch macOS Gatekeeper may block open — right-click Custody Note in Applications and choose Open once.',
  ],
  [
    'The Mac download is signed and notarised by Apple. You should not see an “unidentified developer” warning under normal circumstances. If macOS still blocks launch, use right-click → Open once, or check you downloaded the correct architecture (Apple Silicon vs Intel).',
    'The Mac download is Developer ID signed. Apple notarization may still be pending for this build, so Gatekeeper may ask you to right-click → Open once on first launch. Always download the correct architecture (Apple Silicon vs Intel).',
  ],
  [
    'signed and notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed & notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed &amp; notarised',
    'Developer ID signed',
    { optional: true },
  ],
  // Fragment forms used in MacDownload client components / split JSX
  [
    '· signed & notarised ·',
    '· Developer ID signed ·',
    { optional: true },
  ],
  [
    '· signed &amp; notarised ·',
    '· Developer ID signed ·',
    { optional: true },
  ],
  [
    'signed {"&"} notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed {\'&\'} notarised',
    'Developer ID signed',
    { optional: true },
  ],
  [
    'signed {"\\u0026"} notarised',
    'Developer ID signed',
    { optional: true },
  ],
];

const report = {
  from: FROM_VERSION,
  to: TO_VERSION,
  versionReplacements: 0,
  filesTouched: [],
  copyHits: [],
  copyMisses: [],
};

for (const file of mutableFiles) {
  let text = readFileSync(file, 'utf8');
  let next = text;
  let changed = false;

  if (FROM_VERSION !== TO_VERSION && next.includes(FROM_VERSION)) {
    const occurrences = next.split(FROM_VERSION).length - 1;
    next = next.split(FROM_VERSION).join(TO_VERSION);
    report.versionReplacements += occurrences;
    changed = true;
  }

  if (soften) {
    for (const entry of COPY_REPLACEMENTS) {
      const [find, replace, opts = {}] = entry;
      if (!next.includes(find)) {
        if (!opts.optional) {
          // Only record misses for high-priority download-related files.
          const rel = relative(WEBSITE_ROOT, file).replace(/\\/g, '/');
          if (rel.includes('download') || rel.includes('MacDownload') || rel.includes('product-copy')) {
            report.copyMisses.push({ file: rel, find: find.slice(0, 80) });
          }
        }
        continue;
      }
      next = next.split(find).join(replace);
      changed = true;
      report.copyHits.push({
        file: relative(WEBSITE_ROOT, file).replace(/\\/g, '/'),
        find: find.slice(0, 80),
      });
    }
  }

  if (changed && next !== text) {
    writeFileSync(file, next, 'utf8');
    report.filesTouched.push(relative(WEBSITE_ROOT, file).replace(/\\/g, '/'));
  }
}

writeFileSync(
  join(WEBSITE_ROOT, '.bump-website-download-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);

console.log(
  `[bump-website-download] Touched ${report.filesTouched.length} file(s); ` +
    `${report.versionReplacements} version string replacement(s); ` +
    `${report.copyHits.length} copy hit(s).`,
);

if (FROM_VERSION !== TO_VERSION && report.versionReplacements === 0) {
  // Belt-and-suspenders: if releases.json already advertises TO_VERSION, the
  // download UI is current even with zero hardcoded pin replacements.
  if (releasesVersion === TO_VERSION) {
    console.log(
      `[bump-website-download] No hardcoded version pins to replace; releases.json already at ${TO_VERSION} — success (no-op).`,
    );
    process.exit(0);
  }
  console.error('[bump-website-download] No version strings were replaced — aborting.');
  if (releasesVersion) {
    console.error(
      `[bump-website-download] releases.json is at ${releasesVersion}, expected ${TO_VERSION}. Run sync-website first.`,
    );
  } else {
    console.error(
      `[bump-website-download] data/releases.json missing or invalid; expected version ${TO_VERSION}.`,
    );
  }
  process.exit(1);
}
