#!/usr/bin/env node
/**
 * Final honesty pass for 1.9.69 download copy after stacked replaces.
 * Restores releases.json from app changelog and fixes Mac marketing copy for
 * Developer ID–signed (not notarised) builds.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, '..', 'custody-note-website');

if (!existsSync(WEBSITE_ROOT)) {
  console.error('[repair-website] WEBSITE_ROOT not found:', WEBSITE_ROOT);
  process.exit(1);
}

execSync('node scripts/sync-website.mjs', {
  cwd: APP_ROOT,
  stdio: 'inherit',
  env: { ...process.env, WEBSITE_ROOT, SYNC_WEBSITE_NO_PUSH: '1' },
});

const targets = [
  'app/download/page.tsx',
  'components/MacDownloadPicker.tsx',
];

const REPLACEMENTS = [
  ['Developer ID Developer ID signed', 'Developer ID signed'],
  ['Developer ID Developer ID signed and notarised', 'Developer ID signed'],
  ['Developer ID signed and notarised', 'Developer ID signed'],
  ['Developer ID signed & notarised', 'Developer ID signed'],
  ['signed &amp; notarised', 'Developer ID signed'],
  ['signed & notarised', 'Developer ID signed'],
];

const report = { filesTouched: [], hits: [] };

for (const rel of targets) {
  const abs = join(WEBSITE_ROOT, rel);
  if (!existsSync(abs)) continue;
  let text = readFileSync(abs, 'utf8');
  let next = text;
  for (const [find, replace] of REPLACEMENTS) {
    if (!next.includes(find)) continue;
    const n = next.split(find).length - 1;
    next = next.split(find).join(replace);
    report.hits.push({ file: rel, find, n });
  }

  // Installation step — prefer explicit pending notarization wording.
  next = next.replace(
    /On first launch, Custody Note is\{\" \"\}\s*\n\s*<strong className=\"text-white\">Developer ID signed<\/strong>\.?\s*\n\s*If macOS Gatekeeper blocks the app,\s*\n\s*right-click Custody Note in\s*\n\s*Applications and choose\{\" \"\}\s*\n\s*<strong className=\"text-white\">Open<\/strong> once\./,
    `Custody Note is{" "}
                <strong className="text-white">Developer ID signed</strong>
                {" "}(Apple notarization pending). On first launch, right-click
                Custody Note in Applications and choose{" "}
                <strong className="text-white">Open</strong> once.`,
  );

  next = next.replace(
    /The Mac download is Developer ID signed by Apple\. If\s*\n\s*macOS Gatekeeper blocks launch, use right-click &rarr;\{\" \"\}\s*\n\s*Open once, or check you downloaded the correct architecture \(Apple\s*\n\s*Silicon vs Intel\)\./,
    `The Mac download is Developer ID signed; Apple notarization is still
            pending, so Gatekeeper may require right-click &rarr;{" "}
            Open once on first launch. Use the correct architecture (Apple
            Silicon vs Intel).`,
  );

  if (next !== text) {
    writeFileSync(abs, next, 'utf8');
    report.filesTouched.push(rel);
  }
}

writeFileSync(
  join(WEBSITE_ROOT, '.repair-website-release-copy-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);

const releases = JSON.parse(readFileSync(join(WEBSITE_ROOT, 'data/releases.json'), 'utf8'));
const versions = (releases.releases || []).map((r) => r.version);
const dup = versions.length !== new Set(versions).size;
console.log(JSON.stringify({ version: releases.version, entries: versions.length, dup, report }, null, 2));
if (dup) process.exit(1);
