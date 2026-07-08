#!/usr/bin/env node
/**
 * Validates that package.json version, changelog.json, and the website's
 * releases.json are all consistent. Runs before every build (npm run build)
 * and during release (npm run release).
 *
 * Checks:
 *  - package.json has a valid semver version
 *  - changelog.json has exactly one latest=true entry as the first item
 *  - latest entry version matches package.json
 *  - no duplicate versions
 *  - all versions are valid semver
 *  - latest entry has a date
 *  - releases are sorted descending by semver
 *  - website releases.json (if present) matches
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const WEBSITE_ROOT =
  process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()
    ? process.env.WEBSITE_ROOT.trim()
    : join(APP_ROOT, '..', 'custody-note-website');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const errors = [];
const warnings = [];

function error(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function parseSemver(v) {
  return v.split('.').map(Number);
}

function compareSemverDesc(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i];
  }
  return 0;
}

// --- Load data ---

const pkg = readJson(join(APP_ROOT, 'package.json'));
const changelog = readJson(join(APP_ROOT, 'changelog.json'));
const releases = Array.isArray(changelog.releases) ? changelog.releases : [];

// --- package.json version ---

if (!pkg.version || typeof pkg.version !== 'string') {
  error('package.json version is missing or invalid.');
} else if (!SEMVER_RE.test(pkg.version)) {
  error(`package.json version "${pkg.version}" is not valid semver (expected x.y.z).`);
}

// --- changelog.json ---

if (releases.length === 0) {
  error('changelog.json has no releases.');
}

// Exactly one latest
const latest = releases.filter((r) => r && r.latest === true);
if (latest.length !== 1) {
  error(`changelog.json must have exactly one latest=true entry (found ${latest.length}).`);
}

const latestRelease = latest[0];
if (latestRelease) {
  if (!latestRelease.version) {
    error('Latest changelog entry has no version.');
  } else {
    if (latestRelease.version !== pkg.version) {
      error(`Version mismatch: package.json=${pkg.version}, changelog latest=${latestRelease.version}.`);
    }
    if (!SEMVER_RE.test(latestRelease.version)) {
      error(`Latest changelog version "${latestRelease.version}" is not valid semver.`);
    }
  }
  if (!latestRelease.date) {
    error(`Latest release "${latestRelease.version || '?'}" is missing a date.`);
  }
}

// First item must be latest
if (releases[0] && (!releases[0].latest || releases[0].version !== (latestRelease && latestRelease.version))) {
  error('Latest changelog entry must be the first item in releases array.');
}

// Duplicate versions
const seen = new Set();
for (const r of releases) {
  if (!r || !r.version) continue;
  if (!SEMVER_RE.test(r.version)) {
    error(`Release "${r.version}" is not valid semver.`);
  }
  if (seen.has(r.version)) {
    error(`Duplicate release version: "${r.version}".`);
  }
  seen.add(r.version);
}

// Descending order check
const semverVersions = releases.filter(r => r && r.version && SEMVER_RE.test(r.version)).map(r => r.version);
for (let i = 0; i < semverVersions.length - 1; i++) {
  if (compareSemverDesc(semverVersions[i], semverVersions[i + 1]) > 0) {
    warn(`Releases not in descending semver order: "${semverVersions[i]}" before "${semverVersions[i + 1]}".`);
    break;
  }
}

// --- Website releases.json cross-check ---

const websiteReleasesPath = join(WEBSITE_ROOT, 'data', 'releases.json');
if (existsSync(websiteReleasesPath)) {
  try {
    const websiteData = readJson(websiteReleasesPath);
    if (websiteData.version !== pkg.version) {
      warn(
        `Website releases.json version is "${websiteData.version}" but package.json is "${pkg.version}". ` +
        `Run "npm run sync-website" to fix.`
      );
    }
  } catch (e) {
    warn(`Could not read website releases.json: ${e.message}`);
  }
} else {
  warn('Website releases.json not found (expected at: ' + websiteReleasesPath + ').');
}

// --- Critical main-process file integrity ---
//
// Hard-block release if any critical main-process JS file fails to parse,
// is suspiciously small, or no longer starts with its expected first line.
// This catches the v1.5.0 incident where `updater.js` shipped with a chunk
// of test-file content concatenated in front of it, breaking app launch
// with `SyntaxError: Unexpected identifier 'Optimiz'` at line 1.

const CRITICAL_FILES = [
  { file: 'main.js',         firstLineStartsWith: 'const { app, BrowserWindow', minBytes: 10000 },
  { file: 'preload.js',      firstLineStartsWith: 'const { contextBridge',      minBytes: 1000  },
  { file: 'updater.js',      firstLineStartsWith: "const path = require('path')", minBytes: 10000 },
  { file: 'updateState.js',  firstLineStartsWith: "const fs = require('fs')",     minBytes: 200   },
];

for (const spec of CRITICAL_FILES) {
  const abs = join(APP_ROOT, spec.file);
  if (!existsSync(abs)) {
    error(`Critical file missing: ${spec.file}`);
    continue;
  }
  const st = statSync(abs);
  if (st.size < spec.minBytes) {
    error(`Critical file too small: ${spec.file} is ${st.size} bytes (expected ≥ ${spec.minBytes}). Possible truncation.`);
  }
  const src = readFileSync(abs, 'utf8');
  const firstLine = (src.split('\n')[0] || '').replace(/\r$/, '');
  if (spec.firstLineStartsWith && !firstLine.startsWith(spec.firstLineStartsWith)) {
    error(
      `Critical file ${spec.file} first line is "${firstLine.slice(0, 80)}" — expected to start with "${spec.firstLineStartsWith}". ` +
      `File may have been overwritten with foreign content.`
    );
  }
  const check = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (check.status !== 0) {
    error(`Critical file ${spec.file} failed node --check:\n${(check.stderr || '').trim()}`);
  }
}

// --- Output ---

for (const w of warnings) {
  console.warn(`[release:verify] WARN: ${w}`);
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`[release:verify] ERROR: ${e}`);
  }
  process.exit(1);
}

console.log(`[release:verify] OK — package.json and changelog.json are in sync at v${pkg.version}`);
