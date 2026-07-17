#!/usr/bin/env node
/**
 * Regenerate latest-mac.yml from Mac assets already on a GitHub release,
 * then replace the feed on GitHub. Use when zips were re-uploaded without
 * updating the yml (checksum mismatch loop).
 *
 * Usage: node scripts/repair-github-mac-updater-feed.mjs --tag v1.9.26
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
import { fetchReleaseByTag, RELEASE_OWNER, RELEASE_REPO } from './github-release-api.mjs';

function repoSlug() {
  const env = String(process.env.GITHUB_REPOSITORY || '').trim();
  if (env && env.includes('/')) return env;
  return `${RELEASE_OWNER}/${RELEASE_REPO}`;
}

function parseArgs(argv) {
  let tag = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--tag' && argv[i + 1]) tag = argv[++i];
  }
  if (!tag) {
    tag = `v${JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')).version}`;
  }
  if (!/^v/.test(tag)) tag = `v${tag}`;
  return tag;
}

function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

function buildLatestMacYml(version, fileEntries, releaseDate) {
  const lines = [`version: ${version}`, 'files:'];
  for (const f of fileEntries) {
    lines.push(`  - url: ${f.url}`);
    lines.push(`    sha512: ${f.sha512}`);
    lines.push(`    size: ${f.size}`);
  }
  const primary = fileEntries.find((f) => f.url.includes('-arm64.zip')) || fileEntries[0];
  lines.push(`path: ${primary.url}`);
  lines.push(`sha512: ${primary.sha512}`);
  lines.push(`releaseDate: '${releaseDate || new Date().toISOString()}'`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const tag = parseArgs(process.argv);
  const version = tag.replace(/^v/, '');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('[repair-mac-feed] GH_TOKEN required.');
    process.exit(1);
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CustodyNote-RepairMacFeed',
  };

  const release = await fetchReleaseByTag(tag, token);

  const macAssetNames = (release.assets || [])
    .map((a) => a.name)
    .filter((n) => /^Custody-Note-/.test(n) && (n.endsWith('.zip') || n.endsWith('.dmg')));
  if (macAssetNames.length === 0) {
    console.error('[repair-mac-feed] No Mac .zip/.dmg assets on release.');
    process.exit(1);
  }

  macAssetNames.sort();
  const fileEntries = [];
  const dlHeaders = { ...headers, Accept: 'application/octet-stream' };
  for (const name of macAssetNames) {
    const asset = release.assets.find((a) => a.name === name);
    console.log(`[repair-mac-feed] hashing ${name}…`);
    const res = await fetch(asset.url, { headers: dlHeaders, redirect: 'follow' });
    if (!res.ok) {
      console.error(`[repair-mac-feed] download failed ${name}: HTTP ${res.status}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fileEntries.push({
      url: name,
      sha512: sha512Base64(buf),
      size: buf.length,
    });
  }

  const existingFeed = (release.assets || []).find((a) => a.name === 'latest-mac.yml');
  let releaseDate = new Date().toISOString();
  if (existingFeed) {
    const oldRes = await fetch(existingFeed.url, { headers: dlHeaders, redirect: 'follow' });
    if (oldRes.ok) {
      const oldText = await oldRes.text();
      const m = oldText.match(/releaseDate:\s*['"]?([^'"\n]+)/);
      if (m) releaseDate = m[1].trim();
    }
    console.log(`[repair-mac-feed] deleting stale latest-mac.yml (asset id ${existingFeed.id})…`);
    const delRes = await fetch(`https://api.github.com/repos/${repoSlug()}/releases/assets/${existingFeed.id}`, {
      method: 'DELETE',
      headers,
    });
    if (!delRes.ok) {
      console.error('[repair-mac-feed] delete latest-mac.yml failed:', delRes.status, await delRes.text());
      process.exit(1);
    }
  }

  const ymlBody = buildLatestMacYml(version, fileEntries, releaseDate);
  const slug = repoSlug();
  const uploadUrl = `https://uploads.github.com/repos/${slug}/releases/${release.id}/assets?name=${encodeURIComponent('latest-mac.yml')}`;
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'text/yaml',
      'Content-Length': String(Buffer.byteLength(ymlBody)),
    },
    body: ymlBody,
  });
  if (!upRes.ok) {
    console.error('[repair-mac-feed] upload failed:', upRes.status, await upRes.text());
    process.exit(1);
  }
  console.log(`[repair-mac-feed] Uploaded new latest-mac.yml for ${tag}.`);
  console.log('[repair-mac-feed] Run: node scripts/verify-github-updater-assets.mjs --tag', tag, '--platform mac');
}

main().catch((err) => {
  console.error('[repair-mac-feed] Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
