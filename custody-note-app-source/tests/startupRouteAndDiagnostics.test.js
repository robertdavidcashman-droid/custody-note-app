/**
 * Startup-route + diagnostics test.
 *
 * Background (v1.6.18 audit)
 * --------------------------
 * The user reported the desktop app "started opening as or through a web
 * page that offers a demo/trial-style experience". The root cause was an
 * orphan Chrome PWA shortcut from a since-deleted Vercel browser demo, but
 * three things in the codebase were also too lenient:
 *
 *   • main.js did not log the file URL the BrowserWindow actually loads,
 *     so reading start.log alone could not prove the desktop entry was the
 *     bundled index.html.
 *   • Electron's `preload-error` event was not handled, so a partial
 *     working tree silently disabled every contextBridge bridge and the
 *     renderer fell through to a state that LOOKED like a marketing page.
 *   • There was no startup line proving sandbox/contextIsolation are still
 *     true (a regression in webPreferences would weaken security).
 *
 * This file pins those three guarantees as static checks on main.js so a
 * future refactor cannot regress them silently.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'main.js');

describe('Startup route + diagnostics', () => {
  it('webPreferences for the main window keep sandbox + contextIsolation + nodeIntegration:false', () => {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    const idx = src.indexOf('mainWindow = new BrowserWindow(');
    assert.ok(idx > 0, 'mainWindow = new BrowserWindow(...) constructor not found in main.js');
    const window = src.slice(idx, idx + 1500);
    assert.ok(/contextIsolation:\s*true/.test(window), 'main BrowserWindow must keep contextIsolation: true');
    assert.ok(/nodeIntegration:\s*false/.test(window), 'main BrowserWindow must keep nodeIntegration: false');
    assert.ok(/sandbox:\s*true/.test(window), 'main BrowserWindow must keep sandbox: true');
    assert.ok(/preload:\s*path\.join\(__dirname,\s*['"]preload\.js['"]\)/.test(window),
      'main BrowserWindow must load preload.js from __dirname (not a remote URL).');
  });

  it('main.js logs the desktop entry file URL (audit trail for "did it open a webpage?")', () => {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    assert.ok(
      /\[Startup\]\s*Loading desktop entry/.test(src),
      'main.js should log "[Startup] Loading desktop entry: <fileURL>" so support can confirm the '
        + 'app loaded a local file://, not a remote demo/marketing URL.'
    );
  });

  it('main.js handles preload-error so silent preload failures cannot fake a marketing page', () => {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    assert.ok(
      /webContents\.on\(\s*['"]preload-error['"]/.test(src),
      'main.js must subscribe to webContents.on("preload-error", ...). Without this, a missing '
        + 'preload helper silently disables every IPC bridge and the renderer falls through to a '
        + 'state that looks like a marketing/trial page.'
    );
    assert.ok(
      /__custodyNotePreloadError/.test(src),
      'preload-error handler should publish window.__custodyNotePreloadError so renderer/init-events.js '
        + 'can show the in-app diagnostic overlay.'
    );
  });

  it('startup banner includes packaged + version + platform (PII-safe diagnostics)', () => {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    /* Existing line: console.log(`[Startup] Custody Note v${app.getVersion()} ...`) — keep it. */
    assert.ok(
      /\[Startup\]\s*Custody Note v\$\{app\.getVersion\(\)\}/.test(src),
      'main.js must keep the [Startup] Custody Note v<X> banner in app.whenReady().'
    );
    assert.ok(
      /packaged=\$\{app\.isPackaged\}/.test(src),
      'startup banner must include packaged=<true|false> so support can tell installer vs dev.'
    );
    assert.ok(
      /\[Startup\]\s*userData=/.test(src),
      'main.js should log userData path + dbExists at startup (PII-safe; no contents).'
    );
  });
});
