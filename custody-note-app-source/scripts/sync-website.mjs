#!/usr/bin/env node
/**
 * Syncs changelog and version from app to website without bumping or building.
 * Use when you've manually edited changelog.json and want to update the website.
 *
 * Runs verify-release-consistency checks first to catch drift early.
 *
 * Env:
 *   WEBSITE_ROOT — override path to website repo clone (required in CI when checkout path differs)
 *   WEBSITE_GIT_BRANCH — branch to push (default: detect origin/HEAD, else master)
 *   SYNC_WEBSITE_NO_PUSH — if "1", write releases.json only (no git commit/push)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()
    ? process.env.WEBSITE_ROOT.trim()
    : join(APP_ROOT, '..', 'custody-note-website');

const noPush = process.env.SYNC_WEBSITE_NO_PUSH === '1' || process.argv.includes('--no-push');

function getWebsitePushRef() {
  if (process.env.WEBSITE_GIT_BRANCH && process.env.WEBSITE_GIT_BRANCH.trim()) {
    return process.env.WEBSITE_GIT_BRANCH.trim();
  }
  try {
    const sym = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: WEBSITE_ROOT,
      encoding: 'utf8',
    }).trim();
    const m = sym.match(/origin\/(.+)$/);
    if (m) return m[1];
  } catch (_) {}
  return 'master';
}

// Run consistency check first (WEBSITE_ROOT passed through env for verify script)
try {
  execSync('node scripts/verify-release-consistency.mjs', {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: { ...process.env, WEBSITE_ROOT },
  });
} catch {
  console.error('[sync-website] Aborting — release consistency check failed. Fix errors above first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(APP_ROOT, 'changelog.json'), 'utf8'));

const websiteDataDir = join(WEBSITE_ROOT, 'data');
const websiteDataPath = join(websiteDataDir, 'releases.json');

if (!existsSync(websiteDataDir)) {
  mkdirSync(websiteDataDir, { recursive: true });
}

writeFileSync(
  websiteDataPath,
  JSON.stringify({ version: pkg.version, releases: changelog.releases }, null, 2) + '\n',
  'utf8'
);
console.log(`[sync-website] Synced v${pkg.version} and ${changelog.releases.length} releases to website`);

// LAA official PDF templates + manifest (desktop app auto-update endpoint)
const laaSrcDir = join(APP_ROOT, 'data', 'laa-official-forms');
const laaDestDir = join(WEBSITE_ROOT, 'data', 'laa-official-forms');
if (existsSync(laaSrcDir)) {
  if (!existsSync(laaDestDir)) mkdirSync(laaDestDir, { recursive: true });
  for (const name of readdirSync(laaSrcDir)) {
    const src = join(laaSrcDir, name);
    if (statSync(src).isFile()) {
      writeFileSync(join(laaDestDir, name), readFileSync(src));
    }
  }
  console.log('[sync-website] Synced LAA official forms to website data/laa-official-forms');
}

// SEO blog imports + release-notes post → data/blog-imports.json
try {
  execSync('node seo-growth/scripts/publish-blog-from-markdown.mjs --stagger-weeks', {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: { ...process.env, WEBSITE_ROOT },
  });
  execSync('node scripts/sync-changelog-blog.mjs', {
    cwd: WEBSITE_ROOT,
    stdio: 'inherit',
  });
} catch (e) {
  console.warn('[sync-website] Blog import sync failed (non-fatal):', e.message);
}

if (noPush) {
  console.log('[sync-website] No-push mode — skipping git commit/push');
  process.exit(0);
}

// Auto-commit and push — Vercel deploys automatically from GitHub
try {
  if (!existsSync(join(WEBSITE_ROOT, '.git'))) {
    console.error('[sync-website] No .git in WEBSITE_ROOT — cannot push. Set SYNC_WEBSITE_NO_PUSH=1 to write files only.');
    process.exit(process.env.GITHUB_ACTIONS ? 1 : 0);
  }
  execSync('git add -A', { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  try {
    execSync(`git commit -m "Changelog: sync releases.json to v${pkg.version}"`, { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  } catch {
    console.log('[sync-website] Nothing to commit (already up to date)');
  }
  const branch = getWebsitePushRef();
  try {
    execSync(`git pull --rebase origin ${branch}`, { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  } catch (e) {
    console.warn('[sync-website] git pull --rebase failed (continuing with push):', e.message);
  }
  execSync(`git push origin ${branch}`, { cwd: WEBSITE_ROOT, stdio: 'inherit' });
  console.log('[sync-website] Pushed to GitHub → Vercel will auto-deploy custodynote.com');
} catch (e) {
  console.error('[sync-website] Git push failed:', e.message);
  process.exit(process.env.GITHUB_ACTIONS ? 1 : 0);
}
