#!/usr/bin/env node
/**
 * Post-build asar integrity check.
 *
 * Runs after `electron-builder` and BEFORE the .exe is allowed to ship.
 * Catches the v1.5.6 incident where the packaged app.asar shipped with:
 *   - top-level package.json overwritten with 432 bytes of Playwright HTML
 *   - main.js truncated mid-file with main/adminAuth.js content appended
 *     (producing a duplicate `const crypto = require('crypto');` →
 *      SyntaxError → app exits 1 silently before any JS runs)
 *
 * Verification strategy: extract a small, well-known set of files from the
 * built asar and verify each one. We do NOT trust the source tree at this
 * point — we trust ONLY what actually ended up inside the asar that will
 * ship to users.
 *
 * Checks performed for each of dist/win-unpacked/resources/app.asar AND
 * (if present) dist/win-ia32-unpacked/resources/app.asar:
 *   - asar header is readable
 *   - top-level package.json parses as JSON
 *   - package.json.version matches package.json on disk
 *   - package.json.main resolves inside the asar
 *   - critical JS files (main.js, preload.js, updater.js, updateState.js)
 *     all pass `node --check`
 *   - critical JS files all start with their expected first line
 *     (catches file-overlap corruption that node --check might miss
 *      if the truncation happens to land on a valid statement boundary)
 *   - critical JS files are at least their minimum expected size
 *
 * Exits 0 on success, 1 on any failure. A failure means the .exe MUST NOT
 * be released — re-run the build (after freeing disk space if needed).
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const ASAR_BIN = join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');

const sourcePkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));

/** Each entry: { file, firstLineStartsWith, minBytes } */
const CRITICAL_FILES = [
  { file: 'main.js',        firstLineStartsWith: 'const { app, BrowserWindow', minBytes: 10000 },
  { file: 'preload.js',     firstLineStartsWith: 'const { contextBridge',      minBytes: 1000  },
  { file: 'updater.js',     firstLineStartsWith: "const path = require('path')", minBytes: 10000 },
  { file: 'updateState.js', firstLineStartsWith: "const fs = require('fs')",     minBytes: 200   },
  { file: 'lib/laaDeclarationPdf.js', firstLineStartsWith: "'use strict';", minBytes: 5000 },
];

function fail(msg) {
  console.error(`[verify:built-asar] FAIL: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[verify:built-asar] ${msg}`);
}

function findBuiltAsars() {
  const distRoot = join(APP_ROOT, 'dist');
  if (!existsSync(distRoot)) {
    fail(`dist/ not found at ${distRoot} — did electron-builder actually run?`);
  }
  const candidates = [];

  /* Windows / Linux: app.asar is at <platform-unpacked>/resources/app.asar */
  for (const d of ['win-unpacked', 'win-ia32-unpacked', 'win-arm64-unpacked', 'linux-unpacked']) {
    const a = join(distRoot, d, 'resources', 'app.asar');
    if (existsSync(a)) candidates.push(a);
  }

  /* macOS: app.asar is inside the .app bundle at
   * <platform-unpacked>/<productName>.app/Contents/Resources/app.asar.
   * We discover the .app name dynamically so this script does not need
   * to be edited if the productName changes. */
  for (const d of ['mac', 'mac-arm64']) {
    const macUnpacked = join(distRoot, d);
    if (!existsSync(macUnpacked)) continue;
    let appName = null;
    try {
      appName = readdirSync(macUnpacked).find((n) => n.endsWith('.app')) || null;
    } catch (_) { /* ignore */ }
    if (!appName) continue;
    const a = join(macUnpacked, appName, 'Contents', 'Resources', 'app.asar');
    if (existsSync(a)) candidates.push(a);
  }

  if (candidates.length === 0) {
    fail(`no built app.asar found under ${distRoot}/<platform-unpacked>/resources/app.asar (or mac .app bundle)`);
  }
  return candidates;
}

function extractFile(asarPath, internalPath, destDir) {
  const r = spawnSync(ASAR_BIN, ['extract-file', asarPath, internalPath], {
    cwd: destDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    fail(`asar extract-file failed for "${internalPath}" from ${asarPath}: ${(r.stderr || r.stdout || '').trim()}`);
  }
  const out = join(destDir, internalPath.split(/[\\/]/).pop());
  if (!existsSync(out)) {
    fail(`asar extract-file produced no output file for "${internalPath}" from ${asarPath}`);
  }
  return out;
}

function nodeCheck(jsPath) {
  const r = spawnSync(process.execPath, ['--check', jsPath], { encoding: 'utf8' });
  if (r.status !== 0) {
    return (r.stderr || r.stdout || 'unknown error').trim();
  }
  return null;
}

function verifyAsar(asarPath) {
  info(`checking ${asarPath} (${statSync(asarPath).size} bytes)`);

  const tmp = mkdtempSync(join(tmpdir(), 'cn-verify-asar-'));
  try {
    /* package.json — note: electron-builder legitimately strips this file
     * down to ~400 bytes (name, version, main, author, license, dependencies
     * only — no devDependencies, scripts, build config). So we do NOT enforce
     * a minimum size here; we only enforce that it parses as JSON, has the
     * expected version, and has a main entry point. The v1.5.6 corruption
     * showed up as invalid-JSON (HTML content), which JSON.parse catches. */
    const pkgFile = extractFile(asarPath, 'package.json', tmp);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    } catch (e) {
      const head = readFileSync(pkgFile, 'utf8').slice(0, 120);
      fail(`asar package.json is not valid JSON: ${e.message} (asar=${asarPath})\n  first 120 chars: ${head}`);
    }
    if (pkg.version !== sourcePkg.version) {
      fail(`asar package.json version "${pkg.version}" !== source "${sourcePkg.version}" (asar=${asarPath})`);
    }
    if (pkg.name !== sourcePkg.name) {
      fail(`asar package.json name "${pkg.name}" !== source "${sourcePkg.name}" (asar=${asarPath})`);
    }
    if (!pkg.main || typeof pkg.main !== 'string') {
      fail(`asar package.json has no "main" field (asar=${asarPath})`);
    }
    info(`  OK package.json (parses, name+version match source, main="${pkg.main}")`);

    /* critical JS files */
    for (const spec of CRITICAL_FILES) {
      const jsFile = extractFile(asarPath, spec.file, tmp);
      const sz = statSync(jsFile).size;
      if (sz < spec.minBytes) {
        fail(`asar ${spec.file} is only ${sz} bytes (expected ≥ ${spec.minBytes}) — possible truncation (asar=${asarPath})`);
      }
      const src = readFileSync(jsFile, 'utf8');
      const firstLine = (src.split('\n')[0] || '').replace(/\r$/, '');
      if (spec.firstLineStartsWith && !firstLine.startsWith(spec.firstLineStartsWith)) {
        fail(
          `asar ${spec.file} first line is "${firstLine.slice(0, 80)}" — expected start "${spec.firstLineStartsWith}". ` +
          `File was overwritten with foreign content. (asar=${asarPath})`
        );
      }
      const err = nodeCheck(jsFile);
      if (err) {
        fail(`asar ${spec.file} failed node --check (asar=${asarPath}):\n${err}`);
      }
      info(`  OK ${spec.file} (${sz} bytes, parses, starts with expected line)`);
    }

    /* magistrates court list — required for Section 8 court name typeahead */
    const courtsFile = extractFile(asarPath, 'data/magistrates-courts.json', tmp);
    let courtsList;
    try {
      courtsList = JSON.parse(readFileSync(courtsFile, 'utf8'));
    } catch (e) {
      fail(`asar data/magistrates-courts.json is not valid JSON: ${e.message} (asar=${asarPath})`);
    }
    if (!Array.isArray(courtsList) || courtsList.length < 200) {
      fail(
        `asar data/magistrates-courts.json must be an array with ≥200 courts (got ${Array.isArray(courtsList) ? courtsList.length : typeof courtsList}) (asar=${asarPath})`,
      );
    }
    info(`  OK data/magistrates-courts.json (${courtsList.length} courts)`);

    /* main.js per package.json must resolve */
    if (pkg.main !== 'main.js') {
      info(`  NOTE pkg.main is "${pkg.main}" (not "main.js") — extracting and checking it too`);
      const entryFile = extractFile(asarPath, pkg.main, tmp);
      const err = nodeCheck(entryFile);
      if (err) fail(`asar entry point ${pkg.main} failed node --check: ${err}`);
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

function main() {
  if (!existsSync(ASAR_BIN)) {
    fail(`asar CLI not found at ${ASAR_BIN}. Install dev deps with "npm install".`);
  }
  const asars = findBuiltAsars();
  for (const a of asars) verifyAsar(a);
  info(`OK — verified ${asars.length} built asar(s) for v${sourcePkg.version}`);
}

main();
