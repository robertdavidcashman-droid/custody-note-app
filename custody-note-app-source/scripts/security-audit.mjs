// scripts/security-audit.mjs
// ---------------------------------------------------------------------------
// One-shot security audit gate. Runs:
//   1. npm audit (production deps only)         — fails on >= high
//   2. local secret scan over the repo          — fails on any high-severity hit
//   3. .env / .cursorignore presence sanity     — warns (does not fail) if absent
//
// Exit codes:
//   0  clean
//   1  audit failed
//   2  secret scan failed
//   3  both failed
//
// Run via `npm run security:audit`.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let exitCode = 0;

console.log('━━━ npm audit (production dependencies) ━━━');
let auditJson = null;
try {
  const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  }).toString();
  auditJson = JSON.parse(out);
} catch (e) {
  // npm audit exits non-zero when vulnerabilities exist; still parse stdout
  if (e && e.stdout) {
    try { auditJson = JSON.parse(e.stdout.toString()); } catch (_) {}
  }
}
if (auditJson && auditJson.metadata && auditJson.metadata.vulnerabilities) {
  const v = auditJson.metadata.vulnerabilities;
  console.log(`  info=${v.info||0} low=${v.low||0} mod=${v.moderate||0} high=${v.high||0} crit=${v.critical||0}`);
  if ((v.high || 0) + (v.critical || 0) > 0) {
    console.error('  FAIL: high or critical vulnerabilities present');
    console.error('  Run `npm audit --omit=dev` for detail.');
    exitCode |= 1;
  } else {
    console.log('  OK');
  }
} else {
  console.warn('  WARN: could not parse npm audit output (continuing)');
}

console.log('\n━━━ secret scan (local) ━━━');
const SECRET_RULES = [
  { id: 'gh-token-classic',   re: /\bghp_[A-Za-z0-9]{36,}\b/,                                severity: 'high'   },
  { id: 'gh-token-fine',      re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/,                        severity: 'high'   },
  { id: 'gh-app-token',       re: /\b(?:gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,                severity: 'high'   },
  { id: 'aws-access-key',     re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,                           severity: 'high'   },
  { id: 'private-key-block',  re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/,  severity: 'high'   },
  { id: 'jwt',                re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/, severity: 'medium' },
  { id: 'slack-token',        re: /xox[baprs]-[A-Za-z0-9-]{10,}/,                            severity: 'high'   },
  { id: 'google-api-key',     re: /AIza[0-9A-Za-z_\-]{35}/,                                  severity: 'high'   },
  { id: 'stripe-live',        re: /\bsk_live_[0-9a-zA-Z]{24,}\b/,                            severity: 'high'   },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  'playwright-report', 'test-results', '.next', '.cache',
  'extracted-installed', 'orig-extract', 'test-extract', 'verify-pj', 'vfy',
  'photos', 'userData', 'vendor',
]);
const SKIP_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.ico','.webp','.svg','.pdf',
  '.exe','.dll','.dmg','.AppImage','.deb','.rpm','.snap','.zip','.tar','.gz',
  '.wasm','.lock','.lockfile','.bin','.psd',
]);
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);
const SCAN_BUDGET_BYTES = 1 * 1024 * 1024; // skip files larger than 1 MB

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && (e.name === '.env' || e.name.startsWith('.env.'))) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) { yield* walk(full); continue; }
    if (SKIP_FILES.has(e.name)) continue;
    const dot = e.name.lastIndexOf('.');
    if (dot >= 0 && SKIP_EXTS.has(e.name.slice(dot).toLowerCase())) continue;
    yield full;
  }
}

const SELF = fileURLToPath(import.meta.url);

// Files that contain INTENTIONAL secret-shaped strings (tests for the
// redactor; documentation showing what a leaked secret looks like) can
// opt out by including this marker in the first 5 lines:
//     // security-audit:allow-secrets
const ALLOW_MARKER = /security-audit\s*:\s*allow-secrets/;

let highHits = 0;
let mediumHits = 0;
for (const file of walk(ROOT)) {
  if (file === SELF) continue;
  let st;
  try { st = statSync(file); } catch (_) { continue; }
  if (st.size > SCAN_BUDGET_BYTES) continue;
  let body;
  try { body = readFileSync(file, 'utf8'); }
  catch (_) { continue; }
  const head = body.split('\n', 20).join('\n');
  if (ALLOW_MARKER.test(head)) continue;
  for (const rule of SECRET_RULES) {
    if (rule.re.test(body)) {
      const rel = relative(ROOT, file);
      console.error(`  HIT  [${rule.severity}] ${rule.id} → ${rel}`);
      if (rule.severity === 'high') highHits++; else mediumHits++;
    }
  }
}
console.log(`  total: high=${highHits} medium=${mediumHits}`);
if (highHits > 0) {
  console.error('  FAIL: high-severity secret(s) detected — rotate and remove.');
  exitCode |= 2;
} else {
  console.log('  OK');
}

console.log('\n━━━ ignore-file sanity ━━━');
for (const f of ['.gitignore', '.cursorignore', '.vercelignore']) {
  if (existsSync(join(ROOT, f))) {
    console.log(`  ${f}: present`);
  } else {
    console.warn(`  ${f}: MISSING (warning only)`);
  }
}

if (exitCode === 0) {
  console.log('\n✓ security audit passed');
} else {
  console.error('\n✗ security audit FAILED (exit ' + exitCode + ')');
}
process.exit(exitCode);
