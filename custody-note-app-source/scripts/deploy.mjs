#!/usr/bin/env node
/**
 * Full deploy: verify changelog ↔ version, push app repo, sync website (Vercel), trigger release CI.
 *
 * Usage: npm run deploy
 *
 * Requires: git credentials for push; ../custody-note-website clone for website sync.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function readPkgVersion() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

console.log('[deploy] Step 0/5 — deploy prerequisites');
try {
  run('node scripts/check-deploy-prerequisites.mjs');
} catch {
  process.exit(1);
}

console.log('[deploy] Step 1/5 — verify package.json and changelog.json');
run('node scripts/verify-release-consistency.mjs');

console.log('[deploy] Step 2/5 — commit release metadata if staged changes exist');
run('git add package.json changelog.json');
let committed = false;
try {
  run('git diff --cached --quiet');
} catch {
  const version = readPkgVersion();
  run(`git commit -m "chore(release): v${version}"`);
  committed = true;
  console.log(`[deploy] Committed chore(release): v${version}`);
}

console.log('[deploy] Step 3/5 — push app repository');
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
run(`git push origin ${branch}`);

console.log('[deploy] Step 4/5 — sync custody-note-website (Vercel auto-deploys from GitHub)');
run('node scripts/sync-website.mjs');

console.log('[deploy] Step 5/5 — trigger GitHub Release and deploy workflow');
const version = readPkgVersion();
console.log('[deploy] Waiting 15s for auto-tag workflow (if package.json just pushed)…');
await new Promise((r) => setTimeout(r, 15000));
run(`node scripts/trigger-release-deploy.mjs v${version}`);

// Mac installers are built by CI (release-mac). Do not run ensure-mac-release here —
// concurrent local + CI uploads cause latest-mac.yml checksum mismatches and publish-release failures.
// If Mac CI fails or stalls: npm run complete-mac-release (on a Mac with signing creds in .env.local).
console.log('[deploy] Mac release assets: GitHub Actions release-mac job (not local build during deploy).');
console.log('[deploy] If Mac CI fails: npm run complete-mac-release');

console.log(`[deploy] Complete — v${version} pushed, website synced, release workflow triggered.`);
