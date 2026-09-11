#!/usr/bin/env node
/**
 * Publish an existing build to GitHub Releases via API.
 * Use when electron-builder's publish fails to create the release.
 *
 * Requires: GH_TOKEN or GITHUB_TOKEN
 * Usage: node scripts/publish-to-github.mjs [version]
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const DIST = join(APP_ROOT, 'dist');

const OWNER = 'robertcashman-bit';
const REPO = 'custody-note-app';

function loadToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  }
  for (const name of ['.env', '.env.local']) {
    const p = join(APP_ROOT, name);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*GH_TOKEN\s*=\s*(.+?)\s*$/);
        if (m) return m[1].replace(/^["']|["']$/g, '').trim();
      }
    } catch (_) {}
  }
  return null;
}

async function main() {
  const version = process.argv[2] || JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version;
  const tag = `v${version}`;

  const token = loadToken();
  if (!token) {
    console.error('GH_TOKEN or GITHUB_TOKEN required. Set in .env or environment.');
    process.exit(1);
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Asset names: electron-updater expects Custody-Note-Setup-X.exe (hyphens)
  const exeName = `Custody-Note-Setup-${version}.exe`;
  const blockmapName = `Custody-Note-Setup-${version}.exe.blockmap`;

  const exePath = join(DIST, `Custody Note Setup ${version}.exe`);
  const blockmapPath = join(DIST, blockmapName);
  const latestPath = join(DIST, 'latest.yml');

  if (!existsSync(exePath)) {
    console.error(`Installer not found: ${exePath}`);
    process.exit(1);
  }

  console.log(`Creating release ${tag}...`);

  // Create release
  const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: version,
      body: `Release ${version}`,
      draft: false,
    }),
  });

  let release;
  let uploadUrl;

  if (createRes.ok) {
    release = await createRes.json();
    uploadUrl = release.upload_url.replace(/\{.*\}/, '');
  } else {
    const err = await createRes.text();
    if (createRes.status === 422 && err.includes('already_exists')) {
      console.log(`Release ${tag} already exists. Fetching...`);
      const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`, { headers });
      if (!getRes.ok) {
        console.error('Could not fetch existing release:', await getRes.text());
        process.exit(1);
      }
      release = await getRes.json();
      uploadUrl = release.upload_url.replace(/\{.*\}/, '');
      if (release.assets?.length >= 2) {
        console.log('Release already has assets. If app still says up-to-date, try deleting the release on GitHub and re-running.');
        process.exit(0);
      }
    } else {
      console.error('Create release failed:', createRes.status, err);
      process.exit(1);
    }
  }

  async function uploadAsset(filePath, assetName, contentType) {
    if (!existsSync(filePath)) {
      console.warn(`Skip ${assetName} (not found)`);
      return;
    }
    const body = readFileSync(filePath);
    const res = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body,
    });
    if (!res.ok) {
      console.error(`Upload ${assetName} failed:`, res.status, await res.text());
    } else {
      console.log(`Uploaded ${assetName}`);
    }
  }

  await uploadAsset(exePath, exeName);
  await uploadAsset(blockmapPath, blockmapName);
  await uploadAsset(latestPath, 'latest.yml', 'text/yaml');

  console.log(`\nDone. Release ${tag} is published.`);
  console.log(`Your app should now detect the update.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
