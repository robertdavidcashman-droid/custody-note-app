#!/usr/bin/env node
/**
 * Upload Mac build artefacts to an existing GitHub release (when electron-builder
 * skips publish because the release is already published, not draft).
 *
 * Skips assets that already exist AND match dist/latest-mac.yml checksums.
 * Replaces remote assets when checksums diverge (stale partial upload).
 */
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  throw new Error('GH_TOKEN required');
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

function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

function parseLatestMacYml(text) {
  const map = new Map();
  let inFiles = false;
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^[^\s-]/.test(line) && line.trim()) inFiles = false;
    if (!inFiles) continue;
    const urlMatch = line.match(/^\s*-\s*url:\s*(.+)$/);
    if (urlMatch) {
      if (current && current.url) map.set(current.url, current.sha512);
      let url = urlMatch[1].trim();
      if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
        url = url.slice(1, -1);
      }
      current = { url, sha512: null };
      continue;
    }
    if (!current) continue;
    const shaMatch = line.match(/^\s+sha512:\s*(.+)$/);
    if (shaMatch) {
      let val = shaMatch[1].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      current.sha512 = val;
    }
  }
  if (current && current.url && current.sha512) map.set(current.url, current.sha512);
  return map;
}

function loadLocalFeedChecksums(dist) {
  const ymlPath = join(dist, 'latest-mac.yml');
  if (!existsSync(ymlPath)) return null;
  return parseLatestMacYml(readFileSync(ymlPath, 'utf8'));
}

async function remoteSha512(asset, headers) {
  const res = await fetch(asset.browser_download_url, { headers });
  if (!res.ok) throw new Error(`download ${asset.name} failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return sha512Base64(buf);
}

async function deleteAsset(assetId, headers) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    throw new Error(`delete asset ${assetId} failed: HTTP ${res.status} ${await res.text()}`);
  }
}

loadEnvFile('.env.local');
const token = resolveGitHubToken();
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;
const repo = 'robertcashman-bit/custody-note-app';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'CustodyNote-UploadMacAssets',
};

const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
const release = await releaseRes.json();
if (!release.id) throw new Error(release.message || 'Release not found');

const dist = join(root, 'dist');
const feedChecksums = loadLocalFeedChecksums(dist);
if (!feedChecksums || feedChecksums.size === 0) {
  console.warn('[upload-mac-assets] dist/latest-mac.yml missing — uploads may desync checksums.');
}

const assetByName = new Map((release.assets || []).map((a) => [a.name, a]));
const files = [
  `Custody-Note-${version}-arm64.dmg`,
  `Custody-Note-${version}-arm64.dmg.blockmap`,
  `Custody-Note-${version}-arm64.zip`,
  `Custody-Note-${version}-arm64.zip.blockmap`,
  `Custody-Note-${version}-x64.dmg`,
  `Custody-Note-${version}-x64.dmg.blockmap`,
  `Custody-Note-${version}-x64.zip`,
  `Custody-Note-${version}-x64.zip.blockmap`,
  'latest-mac.yml',
];

for (const name of files) {
  const localPath = join(dist, name);
  if (!existsSync(localPath)) {
    console.warn(`[upload-mac-assets] missing locally: ${name}`);
    continue;
  }

  const localBody = readFileSync(localPath);
  const localSha = name === 'latest-mac.yml' ? null : sha512Base64(localBody);
  const expectedFromFeed = feedChecksums && feedChecksums.get(name);
  if (expectedFromFeed && localSha && expectedFromFeed !== localSha) {
    throw new Error(
      `[upload-mac-assets] dist/${name} does not match dist/latest-mac.yml — rebuild Mac assets before upload.`,
    );
  }

  const existingAsset = assetByName.get(name);
  if (existingAsset) {
    if (name === 'latest-mac.yml') {
      const remoteText = await (await fetch(existingAsset.browser_download_url, { headers })).text();
      const localText = localBody.toString('utf8');
      if (remoteText === localText) {
        console.log(`[upload-mac-assets] skip (unchanged): ${name}`);
        continue;
      }
      console.log(`[upload-mac-assets] replacing stale ${name}…`);
      await deleteAsset(existingAsset.id, headers);
    } else if (localSha) {
      const remoteSha = await remoteSha512(existingAsset, headers);
      if (remoteSha === localSha) {
        console.log(`[upload-mac-assets] skip (checksum ok): ${name}`);
        continue;
      }
      console.log(`[upload-mac-assets] replacing checksum mismatch ${name}…`);
      await deleteAsset(existingAsset.id, headers);
    } else {
      console.log(`[upload-mac-assets] skip (exists): ${name}`);
      continue;
    }
  }

  console.log(`[upload-mac-assets] uploading ${name}…`);
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const contentType = name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': contentType,
      'Content-Length': String(localBody.length),
    },
    body: localBody,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload ${name} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  console.log(`[upload-mac-assets] uploaded ${name}`);
}

console.log('[upload-mac-assets] Done.');
