/**
 * Preload integrity test — protects against the v1.6.18 audit class of
 * regressions ("the app opens like a webpage" / "Run in Electron: npm start").
 *
 * Background
 * ----------
 * preload.js runs in a sandboxed Electron renderer (sandbox: true). Electron
 * 28 bundles the preload at runtime via esbuild. Relative requires like
 *
 *     require('./lib/emailComposeDraft')
 *
 * succeed in plain Node tests but FAIL when the preload is loaded from
 * inside an asar at runtime, with:
 *
 *     Unable to load preload script: …\app.asar\preload.js
 *     Error: module not found: ./lib/emailComposeDraft
 *
 * Every contextBridge.exposeInMainWorld call is then skipped, window.api
 * etc. become undefined in the renderer, and app.js init() falls through to
 *
 *     <p>Run in Electron: <code>npm start</code></p>
 *
 * Fix: the helper is INLINED in preload.js. lib/emailComposeDraft.js still
 * exists for plain-Node consumers (tests). This test is the static guarantee
 * that the regression cannot recur:
 *
 *   1. preload.js MUST NOT require any relative path. The only allowed
 *      requires are 'electron' and Node built-ins.
 *   2. preload.js MUST expose the bridges main + renderer expect (no emailAPI):
 *      api, custodyNoteBuildInfo, CustodyEmailCompose, custodyNote.
 *   3. preload.js MUST publish custodyNoteBuildInfo.preloadOk so the
 *      renderer's preload-failure guard in init-events.js can detect a
 *      broken preload.
 *   4. The inlined helper block MUST export the same function names as
 *      lib/emailComposeDraft.js (parity), so tests/emailComposeDraft.module.test.js
 *      and the inlined preload helper cannot drift. tests/preloadOutlookWebComposeParity.test.js
 *      additionally locks the OWA deeplink URL algorithm to lib/outlookWebCompose.js.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRELOAD_PATH = path.join(ROOT, 'preload.js');
const LIB_PATH = path.join(ROOT, 'lib', 'emailComposeDraft.js');

describe('preload.js integrity', () => {
  it('exists and is non-empty', () => {
    assert.ok(fs.existsSync(PRELOAD_PATH), 'preload.js missing');
    const stat = fs.statSync(PRELOAD_PATH);
    assert.ok(stat.size > 200, 'preload.js suspiciously small (' + stat.size + ' bytes)');
  });

  it('does NOT require any relative path (sandbox + asar safety)', () => {
    const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
    /* Strip block + line comments so the cautionary block-comment in the
       file doesn't trip the regex below. */
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const re = /require\(\s*['"](\.{1,2}\/[^'"\)]+)['"]\s*\)/g;
    const offenders = [];
    let m;
    while ((m = re.exec(codeOnly))) offenders.push(m[1]);
    assert.deepStrictEqual(
      offenders,
      [],
      'preload.js must NOT use relative require() — Electron 28 sandbox + asar bundling cannot resolve them.\n'
        + 'Found: ' + offenders.join(', ')
        + '\nInline the helper directly into preload.js (see the existing emailComposeDraft inline IIFE).'
    );
  });

  it('only requires electron / Node built-ins (sandbox-safe)', () => {
    const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
    const allowed = new Set(['electron', 'events', 'timers', 'url']);
    const re = /require\(\s*['"]([^'"\)]+)['"]\s*\)/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(src))) seen.add(m[1]);
    for (const mod of seen) {
      if (mod.startsWith('.') || mod.startsWith('/')) continue; // covered by the relative-require test
      assert.ok(
        allowed.has(mod),
        'preload.js requires "' + mod + '" — sandboxed preload only permits '
          + Array.from(allowed).join(', ') + '.'
      );
    }
  });

  it('exposes the bridges main.js / renderer expect', () => {
    const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
    const required = [
      "contextBridge.exposeInMainWorld('api'",
      "contextBridge.exposeInMainWorld('custodyNoteBuildInfo'",
      "contextBridge.exposeInMainWorld('CustodyEmailCompose'",
      "contextBridge.exposeInMainWorld('custodyNote'",
    ];
    for (const marker of required) {
      assert.ok(src.includes(marker), 'preload.js missing bridge: ' + marker);
    }
  });

  it('publishes custodyNoteBuildInfo.preloadOk for the renderer guard', () => {
    const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
    assert.ok(
      /preloadOk\s*:/.test(src),
      'preload.js should expose custodyNoteBuildInfo.preloadOk so renderer/init-events.js '
      + 'and future tests can detect a broken preload.'
    );
  });

  it('inlines every export from lib/emailComposeDraft.js (no drift between source-of-truth and preload)', () => {
    const lib = fs.readFileSync(LIB_PATH, 'utf8');
    const preload = fs.readFileSync(PRELOAD_PATH, 'utf8');
    /* Extract the keys from the lib file's `module.exports = { … }` block
       and assert each one is referenced inside preload.js. This catches
       drift if someone adds an export to lib/emailComposeDraft.js but
       forgets to mirror it into the inlined block in preload.js. */
    const exportsMatch = lib.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/m);
    assert.ok(exportsMatch, 'lib/emailComposeDraft.js no longer ends with module.exports = { … } — sanity check');
    const keys = exportsMatch[1]
      .split(',')
      .map((s) => s.trim().split(':')[0].trim())
      .filter(Boolean)
      .filter((k) => /^[A-Za-z_]/.test(k));
    assert.ok(keys.length > 5, 'Could not parse exports from lib/emailComposeDraft.js');
    for (const k of keys) {
      assert.ok(
        preload.includes(k),
        'preload.js does not reference "' + k + '" exported by lib/emailComposeDraft.js. '
          + 'Mirror the export into the inlined helper block in preload.js.'
      );
    }
  });
});
