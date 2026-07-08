/**
 * Desktop-app marketing-asset hygiene test.
 *
 * Background (v1.6.18 audit)
 * --------------------------
 * The repo previously shipped a Vercel-hosted browser/PWA demo
 * (browser-demo.html, browser-api.js, manifest.json, sw.js, vercel.json,
 * .vercelignore, scripts/bundle-sqljs.mjs). Commit fe34c25 ("Remove web
 * demo and PWA build; desktop app only") removed all of those because real
 * client data must only ever live in the encrypted desktop store.
 *
 * Why this test exists
 * --------------------
 * If any of those files (or any new marketing/demo HTML — "free trial",
 * "free generator", "landing", "download", "example", "demo") ever sneak
 * back into the source tree, two regressions become possible:
 *
 *   1. The file gets bundled into app.asar by electron-builder (the build
 *      includes everything by default with `**\/*`), so the desktop
 *      installer ships a marketing/demo HTML next to index.html.
 *   2. A Chrome-PWA-style shortcut or a developer mistake can point at one
 *      of these files instead of the bundled index.html, and the user
 *      sees a "demo / trial" page when they expected the real app.
 *
 * This test is a static tripwire: any addition of these names to the repo
 * fails the build before it ships.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const FORBIDDEN_AT_REPO_ROOT = [
  'browser-demo.html',
  'browser-api.js',
  'manifest.json',
  'sw.js',
  'vercel.json',
  '.vercelignore',
  'custodynote-free-police-station-note-generator.html',
  'free-trial.html',
  'demo.html',
  'landing.html',
  'marketing.html',
];

const FORBIDDEN_PATTERN = /^(browser-demo|free[-_]trial|demo|landing|marketing|sample-note|example-note|custodynote-free)[\w.-]*\.html$/i;

const TEST_INTRINSIC = new Set([
  // Existing audit/PDF inspection HTMLs in tests/, allowed.
]);

describe('Desktop app must not ship marketing/demo HTML/JS assets', () => {
  for (const name of FORBIDDEN_AT_REPO_ROOT) {
    it('repo root has no ' + name, () => {
      const p = path.join(ROOT, name);
      assert.ok(
        !fs.existsSync(p),
        'Forbidden marketing/demo file present at repo root: ' + p
          + '. See tests/desktopAppHasNoMarketingAssets.test.js for context. '
          + 'If this file is intentional, gate it behind a separate website repo, not the desktop app.'
      );
    });
  }

  it('no <pattern>.html marketing/demo files anywhere in the source tree', () => {
    /* Excludes node_modules, .git, dist (built artefacts), playwright-report,
       test-results, and tests/ (test fixtures may legitimately use these
       words). Anything else that matches the forbidden pattern fails. */
    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'playwright-report', 'test-results', 'tests', '.cursor', '.vercel']);
    const offenders = [];
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (ignoreDirs.has(entry.name)) continue;
          walk(full);
        } else if (entry.isFile()) {
          if (FORBIDDEN_PATTERN.test(entry.name) && !TEST_INTRINSIC.has(entry.name)) {
            offenders.push(path.relative(ROOT, full));
          }
        }
      }
    }
    walk(ROOT);
    assert.deepStrictEqual(
      offenders,
      [],
      'Found marketing/demo HTML files in the desktop app source tree:\n  '
        + offenders.join('\n  ')
        + '\nThese must be moved to the marketing-website repo (custody-note-website) — '
        + 'they must not be bundled inside Custody Note.exe.'
    );
  });

  it('package.json build.files does not opt-in any marketing/demo asset', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files = (pkg && pkg.build && pkg.build.files) || [];
    const joined = files.join('\n').toLowerCase();
    const forbiddenSubstrings = ['browser-demo', 'free-trial', 'marketing', 'landing.html'];
    for (const bad of forbiddenSubstrings) {
      assert.ok(
        !joined.includes(bad),
        'package.json build.files explicitly references "' + bad + '" — desktop installer would bundle it.'
      );
    }
  });

  it('main.js never points the main BrowserWindow at a remote URL', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    /* The main app shell uses loadFile('index.html'). loadURL is only used
       for the in-app PDF preview (data: URL) and tiny utility windows. We
       refuse any pattern that hands the MAIN window a remote http(s) URL. */
    const badPatterns = [
      /mainWindow\.loadURL\s*\(\s*['"`]https?:/i,
      /mainWindow\.loadURL\s*\(\s*['"`]\s*\/\//i, // protocol-relative
    ];
    for (const re of badPatterns) {
      assert.ok(
        !re.test(src),
        'main.js loads the MAIN BrowserWindow from a remote URL (matched ' + re + '). '
          + 'The desktop window must use loadFile("index.html") only.'
      );
    }
    assert.ok(
      /mainWindow\.loadFile\(\s*['"]index\.html['"]\s*\)/.test(src),
      'main.js no longer calls mainWindow.loadFile("index.html"). '
        + 'The desktop window must always start from the bundled local index.html, not a remote URL.'
    );
  });
});
