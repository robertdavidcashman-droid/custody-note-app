#!/usr/bin/env node
/**
 * Preflight checks before npm run deploy.
 * Ensures gh, git auth (workflow scope), website clone, and version sync.
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localGh = join(homedir(), '.local', 'bin', 'gh');
const errors = [];
const warnings = [];

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function ghBin() {
  const which = spawnSync('which', ['gh'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  if (existsSync(localGh)) return localGh;
  return null;
}

function info(msg) {
  console.log(`[check:deploy] ${msg}`);
}

function fail(msg) {
  errors.push(msg);
  console.error(`[check:deploy] FAIL: ${msg}`);
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`[check:deploy] WARN: ${msg}`);
}

info('Checking deploy prerequisites…');

const gh = ghBin();
if (!gh) {
  fail('GitHub CLI (gh) not found. Install: curl gh release to ~/.local/bin/gh (see scripts/check-deploy-prerequisites.mjs header)');
} else {
  info(`gh: ${run(`"${gh}" --version`, { cwd: root }).split('\n')[0]}`);
  const status = spawnSync(gh, ['auth', 'status'], { encoding: 'utf8' });
  if (status.status !== 0) {
    fail('gh not authenticated. Run: gh auth login -h github.com -p https -s repo,workflow,read:org');
  } else {
    const out = `${status.stdout}\n${status.stderr}`;
    if (!/Token scopes:.*\bworkflow\b/.test(out)) {
      fail('gh token missing workflow scope (needed to push .github/workflows). Run: gh auth refresh -h github.com -s repo,workflow,read:org,gist');
    } else {
      info('gh auth OK (workflow scope present)');
    }
  }
}

const verify = spawnSync(process.execPath, ['scripts/verify-release-consistency.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (verify.status !== 0) {
  fail('package.json and changelog.json out of sync — run npm run check:version');
}

const websiteRoot = join(root, '..', 'custody-note-website');
if (!existsSync(join(websiteRoot, '.git'))) {
  fail(`Website clone missing at ${websiteRoot} — git clone custody-note-website alongside this repo`);
} else {
  info(`website clone: ${websiteRoot}`);
}

try {
  const branch = run('git rev-parse --abbrev-ref HEAD', { cwd: root });
  const ahead = run(`git rev-list --count origin/${branch}..HEAD`, { cwd: root });
  if (Number(ahead) > 0) {
    warn(`Local branch is ${ahead} commit(s) ahead of origin/${branch} — deploy will push`);
  }
} catch {
  warn('Could not compare local vs origin (fetch may be needed)');
}

if (existsSync(join(root, '.github', 'workflows', 'release-publish.yml'))) {
  try {
    const dirty = run('git status --porcelain .github/workflows/', { cwd: root });
    if (dirty) {
      warn('Uncommitted workflow changes — commit before deploy if CI changes are intended');
    }
  } catch { /* ignore */ }
}

if (errors.length) {
  console.error('\n[check:deploy] Not ready. Fix the items above, then:');
  console.error('  export PATH="$HOME/.local/bin:$PATH"');
  console.error('  gh auth setup-git   # route git push through gh (workflow scope)');
  console.error('  npm run deploy');
  process.exit(1);
}

if (warnings.length) {
  console.log(`[check:deploy] Ready with ${warnings.length} warning(s).`);
} else {
  console.log('[check:deploy] Ready — npm run deploy');
}
