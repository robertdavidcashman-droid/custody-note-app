#!/usr/bin/env node
/**
 * Verify https://custodynote.com/ first-screen markers after a production deploy.
 * Checks the hero HTML chunk (before the "custody desk" section), not the full page.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
  });
}

function heroChunk(html) {
  const end = html.indexOf('The custody desk does not wait');
  return end > 0 ? html.slice(0, end) : html.slice(0, 20000);
}

async function main() {
  const htmlPath = argValue('--html');
  const proofDir = argValue('--write-proof');
  const url = argValue('--url') || 'https://custodynote.com/';
  let html;
  if (htmlPath && fs.existsSync(htmlPath)) {
    html = fs.readFileSync(htmlPath, 'utf8');
  } else {
    html = await fetchText(`${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`);
    if (htmlPath) fs.writeFileSync(htmlPath, html);
  }
  const hero = heroChunk(html);

  const checks = {
    'hero has Download free': hero.includes('Download free'),
    'hero has View Features': hero.includes('View Features'),
    'hero no See Example Note': !hero.includes('See Example Note'),
    'hero no Free note generator': !hero.includes('Free note generator'),
    'hero no Download for Windows': !hero.includes('Download for Windows'),
    'hero enlarged shot (max-w-2xl lg:max-w-none)': hero.includes('max-w-2xl lg:max-w-none'),
    'hero no old max-w-lg wrapper': !hero.includes('max-w-lg lg:mx-0'),
    'hero glow blur-3xl': hero.includes('blur-3xl'),
  };

  for (const [k, v] of Object.entries(checks)) console.log(`${k}: ${v}`);
  console.log(`bytes: ${html.length} heroBytes: ${hero.length}`);

  if (proofDir) {
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(
      path.join(proofDir, 'markers.txt'),
      Object.entries(checks).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n'
    );
  }

  const ok = Object.values(checks).every(Boolean);
  if (!ok) {
    console.error('LIVE verification FAILED — first screen does not match display PR #3.');
    process.exit(1);
  }
  console.log('LIVE verification OK — first screen matches new display');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
