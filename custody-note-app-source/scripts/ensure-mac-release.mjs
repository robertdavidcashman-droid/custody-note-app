#!/usr/bin/env node
/**
 * On macOS: if the GitHub release for package.json version is missing Mac updater
 * assets, run complete-mac-release. Otherwise upload any local dist files still
 * missing (electron-builder publish skip). No-op when release is complete.
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchReleaseByTag } from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'darwin') {
  console.log('[ensure-mac-release] Not macOS — skipping.');
  process.exit(0);
}

function resolveGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  for (const line of out.split('\n')) {
    if (line.startsWith('password=')) return line.slice('password='.length);
  }
  return null;
}

const token = resolveGitHubToken();
if (!token) {
  console.warn('[ensure-mac-release] No GitHub token — cannot verify Mac assets.');
  process.exit(0);
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;

try {
  const inProgress = execSync(
    'gh run list --repo robertcashman-bit/custody-note-app --workflow "Release and deploy" --status in_progress --json headBranch',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const runs = JSON.parse(inProgress || '[]');
  if (runs.some((r) => r.headBranch === tag)) {
    console.log(`[ensure-mac-release] GitHub Actions release for ${tag} is in progress — skipping local Mac build.`);
    console.log('[ensure-mac-release] If CI fails: npm run complete-mac-release');
    process.exit(0);
  }
} catch {
  // gh unavailable — continue with asset check
}

let needMac = true;
try {
  const release = await fetchReleaseByTag(tag, token);
  const names = new Set((release.assets || []).map((a) => a.name));
  needMac = !names.has('latest-mac.yml') || !names.has(`Custody-Note-${version}-arm64.dmg`);
} catch (err) {
  console.warn(`[ensure-mac-release] Could not read ${tag} yet (${err.message || err}) — will try complete-mac-release.`);
}

if (needMac) {
  console.log(`[ensure-mac-release] Mac assets missing on ${tag} — running complete-mac-release…`);
  try {
    execSync('node scripts/complete-mac-release.mjs', { cwd: root, stdio: 'inherit', env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } });
  } catch (err) {
    try {
      const release = await fetchReleaseByTag(tag, token);
      const names = new Set((release.assets || []).map((a) => a.name));
      const hasMac = names.has('latest-mac.yml') && names.has(`Custody-Note-${version}-arm64.dmg`);
      if (hasMac) {
        console.warn('[ensure-mac-release] complete-mac-release failed but Mac assets are on GitHub — continuing.');
      } else {
        throw err;
      }
    } catch (checkErr) {
      throw err;
    }
  }
} else if (existsSync(join(root, 'dist', 'latest-mac.yml'))) {
  console.log(`[ensure-mac-release] Mac assets present on ${tag}; uploading any local gaps…`);
  execSync('node scripts/upload-mac-release-assets.mjs', { cwd: root, stdio: 'inherit', env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } });
} else {
  console.log(`[ensure-mac-release] ${tag} Mac release OK.`);
}
