/**
 * Cold-start / splash-gate regressions for v1.9.79.
 *
 * Pins: (a) createWindow must not clear Chromium cache every launch,
 * (b) splash hide must not await magistrates courts / reference JSON,
 * (c) deferred script loader exists for non-home views.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'main.js');
const APP_JS = path.join(ROOT, 'app.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
const BOOT_DEFERRED = path.join(ROOT, 'renderer', 'boot-deferred.js');

describe('Cold start — cache hygiene', () => {
  it('createWindow does not call clearCache / clearStorageData on every launch', () => {
    const src = fs.readFileSync(MAIN_JS, 'utf8');
    const idx = src.indexOf('function createWindow()');
    assert.ok(idx > 0, 'createWindow() not found');
    const end = src.indexOf('\nfunction ', idx + 10);
    const body = src.slice(idx, end > idx ? end : idx + 8000);
    /* Unconditional clearCache is forbidden. An env-gated A/B path for timing
       measurements is allowed only behind CUSTODYNOTE_BOOT_CLEAR_CACHE. */
    const unguarded = body.replace(
      /if\s*\(\s*process\.env\.CUSTODYNOTE_BOOT_CLEAR_CACHE\s*===\s*['"]1['"]\s*\)\s*\{[\s\S]*?\n\s*\}/,
      '/* gated-clearCache-removed */'
    );
    assert.doesNotMatch(unguarded, /ses\.clearCache\s*\(/,
      'createWindow must not call ses.clearCache() unconditionally on every boot');
    assert.doesNotMatch(unguarded, /ses\.clearStorageData\s*\(/,
      'createWindow must not call ses.clearStorageData() unconditionally on every launch');
  });
});

describe('Cold start — splash gate', () => {
  it('splash Promise.all does not await loadMagistratesCourts or loadReferenceData', () => {
    const appJs = fs.readFileSync(APP_JS, 'utf8');
    const splashIdx = appJs.indexOf('splashMinMs');
    assert.ok(splashIdx > 0, 'splashMinMs not found');
    const window = appJs.slice(splashIdx, splashIdx + 2500);
    assert.match(window, /Promise\.all\(\s*\[[\s\S]*stationsList\(\)[\s\S]*firmsList\(\)[\s\S]*\]\s*\)/,
      'splash should still wait on stationsList + firmsList');
    assert.doesNotMatch(window, /Promise\.all\(\s*\[[\s\S]*loadMagistratesCourts\(\)[\s\S]*\]\s*\)/,
      'splash must not await loadMagistratesCourts()');
    assert.doesNotMatch(window, /Promise\.all\(\s*\[[\s\S]*loadReferenceData\(\)[\s\S]*\]\s*\)/,
      'splash must not await loadReferenceData()');
    assert.match(appJs, /loadMagistratesCourts\(\)/,
      'magistrates courts must still be scheduled (background / ensure-on-focus)');
  });

  it('splash min time is not raised above 600ms', () => {
    const appJs = fs.readFileSync(APP_JS, 'utf8');
    assert.match(appJs, /splashMinMs\s*=\s*600\b/);
  });
});

describe('Cold start — deferred scripts', () => {
  it('index.html loads boot-deferred.js after app.js and keeps deferred path markers', () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    const appIdx = html.indexOf('src="app.js"');
    const bootIdx = html.indexOf('src="renderer/boot-deferred.js"');
    assert.ok(appIdx > 0 && bootIdx > appIdx, 'boot-deferred.js must load after app.js');
    assert.ok(html.includes('renderer/laa-forms.js'), 'laa-forms path must remain visible for load-order tests');
    assert.ok(html.includes('renderer/views/billing.js'), 'billing.js path must remain visible');
    assert.ok(html.includes('renderer/views/workflow-stepper.js'));
  });

  it('boot-deferred.js lists high-cost non-home scripts and exposes ensure API', () => {
    const src = fs.readFileSync(BOOT_DEFERRED, 'utf8');
    assert.match(src, /window\.__cnEnsureDeferredScripts\s*=/);
    assert.match(src, /renderer\/laa-forms\.js/);
    assert.match(src, /renderer\/views\/billing-screen\.js/);
    assert.match(src, /renderer\/aiLawElements\.js/);
    assert.match(src, /renderer\/widgets\/wheelDateTimePicker\.js/);
    assert.doesNotMatch(src, /app\.js/, 'app.js must stay on the critical path, not deferred');
  });

  it('stations file stamp skip is present (avoid 2k-row upsert every boot)', () => {
    const main = fs.readFileSync(MAIN_JS, 'utf8');
    assert.match(main, /stationsFileStamp/);
    assert.match(main, /function loadStationsFromFile/);
  });

  it('QuickFile startup pull does not block createWindow', () => {
    const main = fs.readFileSync(MAIN_JS, 'utf8');
    const idx = main.indexOf('Pull QuickFile credentials');
    assert.ok(idx > 0);
    const window = main.slice(idx, idx + 1200);
    assert.doesNotMatch(window, /await qfStartup/,
      'startup must not await QuickFile pull before createWindow');
    assert.match(window, /qfStartup\.then\(/);
    assert.match(window, /createWindow\(\)/);
  });
});
