const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/* ──────────────────────────── 1. Packaging & Config ──────────────────────────── */

describe('1 · Packaging & Config Consistency', () => {
  const pkg = JSON.parse(readFile('package.json'));

  it('version matches semver pattern', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  });

  it('build.appId is a valid reverse-domain', () => {
    assert.match(pkg.build.appId, /^[a-z]+\.[a-z]+\.[a-z]+$/);
  });

  it('build.publish.provider is github', () => {
    assert.equal(pkg.build.publish.provider, 'github');
  });

  it('build.publish.owner is a non-empty string', () => {
    assert.ok(typeof pkg.build.publish.owner === 'string' && pkg.build.publish.owner.length > 0);
  });

  it('build.publish.repo is a non-empty string', () => {
    assert.ok(typeof pkg.build.publish.repo === 'string' && pkg.build.publish.repo.length > 0);
  });

  it('GitHub releases stay draft until cross-platform updater assets are uploaded', () => {
    assert.equal(pkg.build.publish.releaseType, 'draft');
    const workflowSrc = readFile('.github/workflows/release-publish.yml');
    // Dedicated publish-release job waits for the full Windows + Mac asset
    // set, then flips draft → live. Asserting both feeds + the gh-cli edit
    // protects the gating from a Windows-only regression.
    assert.ok(workflowSrc.includes('publish-release:'));
    assert.ok(workflowSrc.includes('verify-github-updater-assets.mjs'));
    assert.ok(workflowSrc.includes('latest.yml'));
    assert.ok(workflowSrc.includes('latest-mac.yml'));
    assert.ok(/gh release edit\s+"\$TAG"/.test(workflowSrc));
  });

  it('build.nsis config exists', () => {
    assert.ok(pkg.build.nsis, 'nsis block missing from build config');
  });

  it('electron is in devDependencies', () => {
    assert.ok(pkg.devDependencies.electron, 'electron missing from devDependencies');
  });

  it('electron-builder is in devDependencies', () => {
    assert.ok(pkg.devDependencies['electron-builder'], 'electron-builder missing from devDependencies');
  });

  it('electron-updater is in dependencies', () => {
    assert.ok(pkg.dependencies['electron-updater'], 'electron-updater missing from dependencies');
  });
});

/* ──────────────────────────── 2. Electron Security ──────────────────────────── */

describe('2 · Electron Security Config', () => {
  const mainSrc = readFile('main.js');
  const indexSrc = readFile('index.html');

  it('primary BrowserWindow has contextIsolation: true', () => {
    assert.ok(mainSrc.includes('contextIsolation: true'), 'contextIsolation not set to true');
  });

  it('primary BrowserWindow has nodeIntegration: false', () => {
    assert.ok(mainSrc.includes('nodeIntegration: false'), 'nodeIntegration not set to false');
  });

  it('primary BrowserWindow has sandbox: true', () => {
    assert.ok(mainSrc.includes('sandbox: true'), 'sandbox not enabled');
  });

  it('no require("electron").remote usage', () => {
    assert.ok(!mainSrc.includes('.remote'), 'found .remote usage in main.js');
  });

  it('no @electron/remote import', () => {
    assert.ok(!mainSrc.includes('@electron/remote'), '@electron/remote found in main.js');
  });

  it('no <webview> tags in index.html', () => {
    assert.ok(!indexSrc.toLowerCase().includes('<webview'), '<webview> tag found in index.html');
  });

  it('open-external handler validates URL via allowlist', () => {
    const hasSafe = mainSrc.includes('isSafeExternalUrl');
    assert.ok(hasSafe, 'open-external handler must use isSafeExternalUrl');
  });
});

/* ──────────────────────────── 3. IPC Surface ──────────────────────────── */

describe('3 · IPC Surface Completeness', () => {
  const preloadSrc = readFile('preload.js');

  function collectMainProcessSources() {
    const mainSrc = readFile('main.js');
    const parts = [mainSrc];
    const mainDir = path.join(ROOT, 'main');
    if (fs.existsSync(mainDir)) {
      fs.readdirSync(mainDir).filter(f => f.endsWith('.js')).forEach(f => {
        parts.push(fs.readFileSync(path.join(mainDir, f), 'utf8'));
      });
    }
    return parts.join('\n');
  }
  const allMainSrc = collectMainProcessSources();

  const invokeChannels = [...preloadSrc.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  const sendChannels = [...preloadSrc.matchAll(/ipcRenderer\.send\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  const handleChannels = [...allMainSrc.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  const onChannels = [...allMainSrc.matchAll(/ipcMain\.on\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  const onceChannels = [...allMainSrc.matchAll(/ipcMain\.once\(['"]([^'"]+)['"]/g)].map(m => m[1]);

  const KNOWN_INTERNAL = /^recovery-pw-/;

  it('preload exposes at least 20 invoke channels', () => {
    assert.ok(invokeChannels.length >= 20, `only ${invokeChannels.length} invoke channels found`);
  });

  it('every preload invoke channel has a matching ipcMain.handle', () => {
    const missing = invokeChannels.filter(ch => !handleChannels.includes(ch));
    assert.deepStrictEqual(missing, [], `unhandled invoke channels: ${missing.join(', ')}`);
  });

  it('no orphaned handle channels without preload consumers (excluding internal)', () => {
    const allPreloadChannels = new Set([...invokeChannels, ...sendChannels]);
    const orphans = handleChannels.filter(ch => !allPreloadChannels.has(ch) && !KNOWN_INTERNAL.test(ch));
    assert.deepStrictEqual(orphans, [], `orphaned handle channels: ${orphans.join(', ')}`);
  });

  it('every preload send channel has a matching ipcMain.on or ipcMain.once', () => {
    const allMainListeners = [...onChannels, ...onceChannels];
    const missing = sendChannels.filter(ch => !allMainListeners.includes(ch));
    assert.deepStrictEqual(missing, [], `unmatched send channels: ${missing.join(', ')}`);
  });

  it('total IPC surface count is reasonable', () => {
    const total = new Set([...invokeChannels, ...sendChannels]).size;
    console.log(`    IPC surface: ${total} channels (${invokeChannels.length} invoke, ${sendChannels.length} send)`);
    assert.ok(total > 20 && total < 300, `unexpected IPC surface size: ${total}`);
  });
});

/* ──────────────────────────── 4. Updater Flow ──────────────────────────── */

describe('4 · Updater Flow', () => {
  const mainSrc = readFile('main.js');
  const updaterSrc = readFile('updater.js');

  it('autoUpdater is guarded by app.isPackaged', () => {
    const guardIdx = updaterSrc.indexOf('app.isPackaged');
    const updaterIdx = updaterSrc.indexOf('autoUpdater.autoDownload');
    assert.ok(guardIdx !== -1 && updaterIdx !== -1 && guardIdx < updaterIdx,
      'app.isPackaged guard must appear before autoUpdater setup');
  });

  it('main.js initializes the modular updater', () => {
    assert.ok(
      mainSrc.includes("require('./updater')") && mainSrc.includes('initUpdater'),
      'initUpdater import missing'
    );
    assert.ok(mainSrc.includes('updaterController = initUpdater({'), 'updaterController init missing');
  });

  it('updater module tracks updaterState', () => {
    assert.ok(updaterSrc.includes('let updaterState ='), 'updaterState not found');
  });

  it('autoDownload = true is set', () => {
    assert.ok(updaterSrc.includes('autoDownload = true'), 'autoDownload not set to true');
  });

  it('autoInstallOnAppQuit is explicitly disabled in favor of guarded install', () => {
    assert.ok(
      updaterSrc.includes('autoInstallOnAppQuit = false'),
      'autoInstallOnAppQuit not configured'
    );
  });

  it('download-progress handler exists', () => {
    assert.ok(updaterSrc.includes("'download-progress'") || updaterSrc.includes('"download-progress"'),
      'download-progress event handler missing');
  });

  it('quitAndInstall is called without premature window destruction', () => {
    assert.ok(updaterSrc.includes('quitAndInstall'), 'quitAndInstall call missing');
    assert.ok(
      !updaterSrc.includes('win.destroy()'),
      'updater must NOT destroy windows — that triggers window-all-closed race'
    );
    assert.ok(updaterSrc.includes('prepareForInstall'), 'prepareForInstall helper missing');
  });

  it('autoUpdater.checkForUpdates only in updater module', () => {
    const mainMatches = mainSrc.match(/autoUpdater\.checkForUpdates\s*\(/g) || [];
    const updaterMatches = updaterSrc.match(/autoUpdater\.checkForUpdates\s*\(/g) || [];
    assert.equal(mainMatches.length, 0, 'main.js should not call autoUpdater.checkForUpdates directly');
    assert.ok(updaterMatches.length >= 1, 'updater.js should own checkForUpdates calls');
  });

  it('main.js exposes updater IPC through updaterController', () => {
    assert.ok(mainSrc.includes("ipcMain.handle('app-check-updates'"), 'app-check-updates handler missing');
    assert.ok(mainSrc.includes("ipcMain.handle('app-update-reset-loop'"), 'app-update-reset-loop handler missing');
    assert.ok(mainSrc.includes("ipcMain.handle('get-auto-update-state'"), 'get-auto-update-state handler missing');
  });

  it('updater module exports loop protection and recovery helpers', () => {
    assert.ok(updaterSrc.includes('resetLoopState'), 'resetLoopState missing');
    assert.ok(updaterSrc.includes('loop-blocked'), 'loop-blocked state missing');
    assert.ok(updaterSrc.includes('updaterDisabledUntil'), 'updaterDisabledUntil missing');
  });
});

/* ──────────────────────────── 5. Data Layer Safety ──────────────────────────── */

describe('5 · Data Layer Safety', () => {
  const mainSrc = readFile('main.js');

  it('db flush on before-quit', () => {
    const chunk = mainSrc.slice(mainSrc.indexOf("'before-quit'"));
    assert.ok(chunk.includes('flushDb'), 'no flushDb in before-quit handler');
  });

  it('db flush on window-all-closed', () => {
    const chunk = mainSrc.slice(mainSrc.indexOf("'window-all-closed'"));
    assert.ok(chunk.includes('flushDb'), 'no flushDb in window-all-closed handler');
  });

  it('initDb function exists', () => {
    assert.ok(/function\s+initDb/.test(mainSrc), 'initDb function not found');
  });

  it('SQL queries use parameterized ? placeholders', () => {
    const parameterized = (mainSrc.match(/\?\s*[,)]/g) || []).length;
    assert.ok(parameterized > 10, `only ${parameterized} parameterized query placeholders found — expected many more`);
  });

  it('no obvious string concatenation in SQL with user data', () => {
    const sqlConcat = mainSrc.match(/(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET).*['"]\s*\+\s*(?!['"])/gi) || [];
    const filtered = sqlConcat.filter(m =>
      !m.includes('TABLE') && !m.includes('PRAGMA') &&
      !m.includes('Selector') && !m.includes('console') && !m.includes('log')
    );
    assert.ok(filtered.length < 3, `found ${filtered.length} potential SQL concatenations:\n${filtered.slice(0, 5).join('\n')}`);
  });
});

/* ──────────────────────────── 6. Security Patterns ──────────────────────────── */

describe('6 · Security Patterns', () => {
  const mainSrc = readFile('main.js');
  const preloadSrc = readFile('preload.js');
  const appSrc = readFile('app.js');

  it('no eval() in main.js', () => {
    const matches = mainSrc.match(/[^a-zA-Z]eval\s*\(/g) || [];
    assert.equal(matches.length, 0, `eval() found in main.js (${matches.length} occurrences)`);
  });

  it('no eval() in preload.js', () => {
    const matches = preloadSrc.match(/[^a-zA-Z]eval\s*\(/g) || [];
    assert.equal(matches.length, 0, `eval() found in preload.js`);
  });

  it('no new Function() in main.js', () => {
    assert.ok(!mainSrc.includes('new Function('), 'new Function() found in main.js');
  });

  it('no new Function() in preload.js', () => {
    assert.ok(!preloadSrc.includes('new Function('), 'new Function() found in preload.js');
  });

  it('child_process shell:true is not in IPC-exposed code paths', () => {
    const shellTrueIdx = mainSrc.indexOf('shell: true');
    if (shellTrueIdx !== -1) {
      const before = mainSrc.slice(Math.max(0, shellTrueIdx - 400), shellTrueIdx);
      const isInScript = before.includes('prepare-trial') || before.includes('scriptPath') || before.includes('scripts/');
      assert.ok(isInScript, 'shell: true found outside script-only code paths');
    }
  });

  it('photo-save uses path sanitization', () => {
    assert.ok(mainSrc.includes('sanitizePathSegment'), 'sanitizePathSegment not found in main.js');
    const photoSaveBlock = mainSrc.slice(mainSrc.indexOf("'photo-save'"), mainSrc.indexOf("'photo-save'") + 500);
    assert.ok(photoSaveBlock.includes('sanitizePathSegment'), 'photo-save handler does not use sanitizePathSegment');
  });

  it('photo-load uses path sanitization', () => {
    const photoLoadBlock = mainSrc.slice(mainSrc.indexOf("'photo-load'"), mainSrc.indexOf("'photo-load'") + 500);
    assert.ok(photoLoadBlock.includes('sanitizePathSegment'), 'photo-load handler does not use sanitizePathSegment');
  });

  it('photo-delete uses path sanitization', () => {
    const photoDeleteBlock = mainSrc.slice(mainSrc.indexOf("'photo-delete'"), mainSrc.indexOf("'photo-delete'") + 500);
    assert.ok(photoDeleteBlock.includes('sanitizePathSegment'), 'photo-delete handler does not use sanitizePathSegment');
  });

  it('_forceClose is set in before-quit handler', () => {
    const beforeQuitIdx = mainSrc.indexOf("'before-quit'");
    const chunk = mainSrc.slice(beforeQuitIdx, beforeQuitIdx + 300);
    assert.ok(chunk.includes('_forceClose = true'), '_forceClose not set in before-quit');
  });

  it('escape function (esc) exists in app.js', () => {
    assert.ok(/function esc\b/.test(appSrc), 'esc() escape helper not found in app.js');
  });

  it('innerHTML usage count in app.js is reasonable', () => {
    const count = (appSrc.match(/\.innerHTML\s*=/g) || []).length;
    console.log(`    innerHTML assignments in app.js: ${count}`);
    assert.ok(count > 0, 'no innerHTML usage found (unexpected)');
  });
});

/* ──────────────────────────── 7. File Structure ──────────────────────────── */

describe('7 · File Structure', () => {
  it('main.js exists and is > 1000 lines', () => {
    const src = readFile('main.js');
    const lines = src.split('\n').length;
    assert.ok(lines > 1000, `main.js has only ${lines} lines`);
  });

  it('preload.js exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'preload.js')), 'preload.js missing');
  });

  it('index.html exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'index.html')), 'index.html missing');
  });

  it('package.json exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'package.json')), 'package.json missing');
  });

  it('changelog.json exists and is valid JSON with version field', () => {
    const raw = readFile('changelog.json');
    const data = JSON.parse(raw);
    assert.ok(data.releases && data.releases.length > 0, 'changelog.json has no releases');
    assert.ok(data.releases[0].version, 'first changelog entry has no version field');
  });
});

/* ──────────────────────────── 8. CSP Check ──────────────────────────── */

describe('8 · Content Security Policy', () => {
  const indexSrc = readFile('index.html');
  const cspMatch = indexSrc.match(/content="([^"]*)"[^>]*>/i);
  const cspMetaMatch = indexSrc.match(/<meta[^>]*Content-Security-Policy[^>]*content="([^"]*)"/i);
  const csp = cspMetaMatch ? cspMetaMatch[1] : '';

  it('CSP meta tag exists', () => {
    assert.ok(csp.length > 0, 'Content-Security-Policy meta tag not found');
  });

  it('CSP contains script-src directive', () => {
    assert.ok(csp.includes('script-src'), 'script-src missing from CSP');
  });

  it('CSP contains self', () => {
    assert.ok(csp.includes("'self'"), "'self' missing from CSP");
  });

  it("script-src does not contain 'unsafe-inline'", () => {
    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    const scriptSrc = scriptSrcMatch ? scriptSrcMatch[1] : '';
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src must not contain 'unsafe-inline' — move inline scripts to external files");
  });

  it("style-src unsafe-inline audit (warning only)", () => {
    const styleSrcMatch = csp.match(/style-src\s+([^;]+)/);
    const styleSrc = styleSrcMatch ? styleSrcMatch[1] : '';
    if (styleSrc.includes("'unsafe-inline'")) {
      console.log("    ⚠  style-src contains 'unsafe-inline' — acceptable for inline style attrs; remove if nonces added");
    }
    assert.ok(true);
  });
});

/* ──────────────────────────── 9. Release Consistency ──────────────────────────── */

describe('9 · Release Consistency', () => {
  const pkg = JSON.parse(readFile('package.json'));
  const changelog = JSON.parse(readFile('changelog.json'));
  const latestRelease = changelog.releases[0];

  it('changelog first entry has a version', () => {
    assert.ok(latestRelease.version, 'no version on first changelog entry');
  });

  it('package.json version matches changelog latest version', () => {
    if (pkg.version !== latestRelease.version) {
      console.log(`    ⚠  package.json=${pkg.version} vs changelog=${latestRelease.version} — may be intentional`);
    }
    assert.equal(pkg.version, latestRelease.version,
      `version mismatch: package.json=${pkg.version}, changelog=${latestRelease.version}`);
  });
});

/* ──────────────────────────── 10. Source Integrity — no corrupted / native code strings ───── */

describe('10 · Source Integrity', () => {
  const appJs = readFile('app.js');
  const jsFiles = [
    'app.js',
    'renderer/views/billing-screen.js',
    'renderer/views/completion-screen.js',
    'renderer/views/documents-screen.js',
    'renderer/views/workflow-stepper.js',
    'renderer/views/billing.js',
  ];

  it('app.js passes syntax check (no parse errors)', () => {
    try {
      new Function(appJs);
    } catch (e) {
      assert.fail('app.js has a syntax error: ' + e.message);
    }
  });

  it('no "[native code]" strings in source files', () => {
    const tainted = [];
    for (const rel of jsFiles) {
      const src = readFile(rel);
      if (src.includes('[native code]')) tainted.push(rel);
    }
    assert.deepEqual(tainted, [], 'Files contain "[native code]" corruption: ' + tainted.join(', '));
  });

  it('getBillingReadinessWarnings is defined in app.js (regression guard)', () => {
    assert.ok(appJs.includes('function getBillingReadinessWarnings'),
      'getBillingReadinessWarnings was deleted but is still called — app will crash');
  });

  it('every standalone function called in updateBillingReadinessPanel is defined', () => {
    const fnIdx = appJs.indexOf('function updateBillingReadinessPanel');
    assert.ok(fnIdx !== -1, 'updateBillingReadinessPanel not found');
    const block = appJs.substring(fnIdx, fnIdx + 1500);
    const calls = [...block.matchAll(/(?<!\.)(\b[a-zA-Z_]\w+)\(\)/g)].map(m => m[1]);
    const builtins = ['return', 'join', 'trim', 'toString', 'map', 'filter', 'forEach', 'indexOf', 'toLowerCase', 'String'];
    for (const fnName of calls) {
      if (builtins.includes(fnName)) continue;
      const defined = appJs.includes('function ' + fnName) || appJs.includes(fnName + ' = function');
      assert.ok(defined, 'updateBillingReadinessPanel calls ' + fnName + '() but it is not defined in app.js');
    }
  });
});

/* ──────────────────────────── 11. Dead Code / Broken References ──────────────────────────── */

describe('11 · Dead Code & Broken References', () => {
  const pkg = JSON.parse(readFile('package.json'));
  const indexSrc = readFile('index.html');

  it('no broken node script references in package.json scripts', () => {
    const scripts = pkg.scripts || {};
    const broken = [];
    for (const [name, cmd] of Object.entries(scripts)) {
      const m = (cmd || '').match(/^node\s+([\w./\-]+\.(?:js|mjs|cjs))/);
      if (m) {
        const scriptFile = m[1];
        // Skip developer-convenience scripts that point at sibling repos
        // (e.g. ../custody-note-website/...). Those resolve on a developer
        // machine where both repos sit alongside each other, but not in CI
        // where only this repo is checked out. Treating them as "broken"
        // creates false negatives that block every CI run.
        if (scriptFile.startsWith('../') || scriptFile.startsWith('..\\')) continue;
        const fullPath = path.join(ROOT, scriptFile);
        if (!fs.existsSync(fullPath)) broken.push(`${name}: ${scriptFile}`);
      }
    }
    assert.deepEqual(broken, [], `Broken node script references: ${broken.join(', ')}`);
  });

  it('all script tags in index.html reference existing files', () => {
    const scriptTags = [...indexSrc.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
    const missing = scriptTags.filter(src => {
      if (src.startsWith('http')) return false;
      return !fs.existsSync(path.join(ROOT, src));
    });
    assert.deepStrictEqual(missing, [], `missing script files: ${missing.join(', ')}`);
  });
});
