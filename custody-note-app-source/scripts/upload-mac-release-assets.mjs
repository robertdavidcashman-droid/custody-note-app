#!/usr/bin/env node
/**
 * Upload Mac build artefacts to an existing GitHub release (when electron-builder
 * skips publish because the release is already published, not draft).
 *
 * Skips assets that already exist AND match dist/latest-mac.yml checksums.
 * Replaces remote assets when checksums diverge (stale partial upload).
 *
 * Draft releases: never verify via public browser_download_url
 * (`…/releases/download/untagged-…/…` returns HTTP 404 while draft). Always
 * download through the authenticated Releases API asset URL instead.
 */
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

/**
 * Prefer the authenticated API asset URL. Public browser_download_url 404s on
 * draft releases (`/releases/download/untagged-…/…`).
 */
function releaseAssetDownloadUrl(asset, releaseIsDraft) {
  if (!asset) return null;
  if (asset.url) return asset.url;
  // Published releases may still expose browser_download_url only in odd payloads.
  if (!releaseIsDraft && asset.browser_download_url) return asset.browser_download_url;
  return null;
}

async function downloadReleaseAssetBuffer(asset, headers, opts = {}) {
  const releaseIsDraft = Boolean(opts.releaseIsDraft);
  const url = releaseAssetDownloadUrl(asset, releaseIsDraft);
  if (!url) {
    throw new Error(`download ${asset && asset.name ? asset.name : 'asset'} failed: no API asset URL`);
  }
  const dlHeaders = {
    ...headers,
    // Required so api.github.com/…/releases/assets/{id} returns octets, not JSON metadata.
    Accept: 'application/octet-stream',
  };
  const res = await fetch(url, { headers: dlHeaders, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`download ${asset.name} failed: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function remoteSha512(asset, headers, opts = {}) {
  const buf = await downloadReleaseAssetBuffer(asset, headers, opts);
  return sha512Base64(buf);
}

async function deleteAsset(assetId, headers, repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    throw new Error(`delete asset ${assetId} failed: HTTP ${res.status} ${await res.text()}`);
  }
}

async function main() {
  loadEnvFile('.env.local');
  const token = resolveGitHubToken();
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const tag = `v${version}`;
  const { fetchReleaseByTag, RELEASE_OWNER, RELEASE_REPO, releaseApiHeaders } =
    await import('./github-release-api.mjs');
  const repo = `${RELEASE_OWNER}/${RELEASE_REPO}`;
  const headers = releaseApiHeaders(token);

  /* Draft releases are invisible to /releases/tags/{tag} — use the helper that
   * also scans the releases list so post-spctl uploads work while the release
   * is still draft (CI publish path). */
  const release = await fetchReleaseByTag(tag, token);
  if (!release.id) throw new Error(release.message || 'Release not found');
  const releaseIsDraft = Boolean(release.draft);

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
        const remoteBuf = await downloadReleaseAssetBuffer(existingAsset, headers, { releaseIsDraft });
        const remoteText = remoteBuf.toString('utf8');
        const localText = localBody.toString('utf8');
        if (remoteText === localText) {
          console.log(`[upload-mac-assets] skip (unchanged): ${name}`);
          continue;
        }
        console.log(`[upload-mac-assets] replacing stale ${name}…`);
        await deleteAsset(existingAsset.id, headers, repo);
      } else if (localSha) {
        const remoteSha = await remoteSha512(existingAsset, headers, { releaseIsDraft });
        if (remoteSha === localSha) {
          console.log(`[upload-mac-assets] skip (checksum ok): ${name}`);
          continue;
        }
        console.log(`[upload-mac-assets] replacing checksum mismatch ${name}…`);
        await deleteAsset(existingAsset.id, headers, repo);
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
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error('[upload-mac-assets] Fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

export {
  sha512Base64,
  parseLatestMacYml,
  releaseAssetDownloadUrl,
  downloadReleaseAssetBuffer,
  remoteSha512,
};
