#!/usr/bin/env node
/**
 * Build signed + notarised Mac installers locally and upload to the GitHub
 * draft release for the current package.json version. Use when CI release-mac
 * failed or timed out.
 *
 * Requires: .env.local with APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 *           GH_TOKEN or GITHUB_TOKEN (or git credential for github.com)
 *
 * Usage: npm run complete-mac-release
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchReleaseByTag, waitForReleaseByTag } from './github-release-api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
}

function loadEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function resolveGitHubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = execSync('printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n')) {
      if (line.startsWith('password=')) return line.slice('password='.length);
    }
  } catch (_) {}
  return null;
}

async function publishReleaseIfReady(version, token, opts = {}) {
  const tag = `v${version}`;
  const required = [
    `Custody-Note-Setup-${version}.exe`,
    `Custody-Note-Setup-${version}.exe.blockmap`,
    'latest.yml',
    `Custody-Note-${version}-arm64.dmg`,
    `Custody-Note-${version}-arm64.zip`,
    `Custody-Note-${version}-x64.dmg`,
    `Custody-Note-${version}-x64.zip`,
    'latest-mac.yml',
  ];
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CustodyNote-CompleteMacRelease',
  };

  let release;
  try {
    release = opts.waitForRelease
      ? await waitForReleaseByTag(tag, token, { maxAttempts: opts.maxAttempts || 12, delayMs: 5000 })
      : await fetchReleaseByTag(tag, token);
  } catch (err) {
    if (opts.waitForRelease) {
      console.warn(`[complete-mac-release] Release ${tag} not ready yet: ${err.message || err}`);
      return;
    }
    throw err;
  }

  const names = new Set((release.assets || []).map((a) => a.name));
  const missing = required.filter((n) => !names.has(n));
  if (missing.length) {
    console.warn(`[complete-mac-release] Release ${tag} still missing: ${missing.join(', ')}`);
    console.warn('[complete-mac-release] Mac assets uploaded; Windows assets may still be uploading via CI.');
    return;
  }

  if (release.draft) {
    const r = await fetch(`https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/${release.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: false, make_latest: true }),
    });
    if (!r.ok) throw new Error(`Failed to publish ${tag}: HTTP ${r.status}`);
    console.log(`[complete-mac-release] Published ${tag} (draft → live).`);
  } else {
    console.log(`[complete-mac-release] ${tag} is already live.`);
  }
}

if (process.platform !== 'darwin') {
  console.error('[complete-mac-release] Must run on macOS.');
  process.exit(1);
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const token = resolveGitHubToken();
if (!token) {
  console.error('[complete-mac-release] GH_TOKEN required to upload to GitHub Releases.');
  process.exit(1);
}
process.env.GH_TOKEN = token;
process.env.GITHUB_TOKEN = token;

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

console.log(`[complete-mac-release] Building and publishing Mac assets for ${tag}…`);

if (!existsSync(join(root, 'node_modules', 'electron', 'path.txt'))) {
  console.log('[complete-mac-release] Installing dependencies (npm ci)…');
  run('npm ci');
}

const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
let checkedOutTag = false;
try {
  const tagCommit = execSync(`git rev-list -n 1 ${tag}`, { cwd: root, encoding: 'utf8' }).trim();
  const headCommit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  if (tagCommit !== headCommit) {
    console.log(`[complete-mac-release] Checking out ${tag} for release build…`);
    run(`git checkout ${tag}`);
    checkedOutTag = true;
  }
} catch (e) {
  console.warn(`[complete-mac-release] Could not checkout ${tag}:`, e.message);
}

process.env.CN_PUBLISH = 'always';
const build = spawnSync('node', ['scripts/build-mac-signed.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (build.status !== 0) {
  if (checkedOutTag && branch !== 'HEAD') {
    try { run(`git checkout ${branch}`); } catch (_) {}
  }
  process.exit(build.status || 1);
}

if (checkedOutTag && branch !== 'HEAD') {
  run(`git checkout ${branch}`);
}

console.log('[complete-mac-release] Waiting for GitHub draft release (CI may still be creating it)…');
await publishReleaseIfReady(version, token, { waitForRelease: true });

console.log('[complete-mac-release] Uploading Mac assets if missing on GitHub…');
run('node scripts/upload-mac-release-assets.mjs');

console.log('[complete-mac-release] Checking whether release can be published…');
await publishReleaseIfReady(version, token);
console.log('[complete-mac-release] Done.');
