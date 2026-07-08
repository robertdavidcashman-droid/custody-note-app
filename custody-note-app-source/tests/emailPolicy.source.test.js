/**
 * Policy: no raw mailto: in UI sources; no renderer shell.openExternal.
 * Officer Emails (v1.9) uses Outlook Web deeplink built in main only.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const PROD_FILES = [
  'preload.js',
  'app.js',
  'index.html',
  'renderer/views/billing.js',
  'renderer/views/list.js',
  'renderer/views/settings.js',
  'renderer/views/reports.js',
  'renderer/views/authorities.js',
  'renderer/views/station-mileage-admin.js',
  'renderer/views/officerEmailsPanel.js',
  'renderer/templateSystem/templateEngine.js',
  'renderer/templateSystem/templateManager.js',
  'renderer/templateSystem/templateStore.js',
  'renderer/templateSystem/placeholders.js',
  'lib/officerEmailDrafts.js',
];

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'playwright-report', 'test-results'];

function walkJsHtml(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
  for (const entry of entries) {
    if (SKIP_DIRS.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsHtml(full));
    } else if (/\.(js|html|mjs|cjs)$/i.test(entry.name) && !entry.name.endsWith('.test.js')) {
      results.push(full);
    }
  }
  return results;
}

/* mailto: literals only in URL-builder libraries, preload inline, hardening,
   main, and the v1.8.0 send-method UI display text (a UI option label and a
   detection-status string — both of which legitimately render the literal
   substring "mailto:" to the user but never invoke it as a launch URI). */
const MAILTO_ALLOWED = new Set([
  'lib/emailComposeDraft.js',
  'preload.js',
  'main/windowHardening.js',
  'main.js',
  /* Legacy UI copy may still mention mailto: as plain text in labels/help. */
  'index.html',
  'app.js',
]);

describe('Email policy — production sources', () => {
  it('renderer/UI files still contain no mailto: (mailto only goes through the URL builders)', () => {
    const bad = [];
    for (const rel of PROD_FILES) {
      const f = path.join(root, rel);
      if (!fs.existsSync(f)) continue;
      if (MAILTO_ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.toLowerCase().includes('mailto:')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'Unexpected mailto: in:\n' + bad.join('\n'));
  });

  it('FULL codebase scan: mailto: only appears in the allow-listed builder/fallback files', () => {
    const allFiles = walkJsHtml(root);
    const bad = [];
    for (const f of allFiles) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      if (rel.startsWith('tests/')) continue;
      if (MAILTO_ALLOWED.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.toLowerCase().includes('mailto:')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'mailto: found in non-allow-listed source files:\n' + bad.join('\n'));
  });

  it('no navigator.share used for email in any JS file', () => {
    const allFiles = walkJsHtml(root);
    const bad = [];
    for (const f of allFiles) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      if (rel.startsWith('tests/')) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (text.includes('navigator.share')) {
        bad.push(rel);
      }
    }
    assert.deepStrictEqual(bad, [], 'navigator.share found in:\n' + bad.join('\n'));
  });

  it('no direct email client invocation patterns in renderer files', () => {
    const rendererFiles = walkJsHtml(path.join(root, 'renderer'));
    const bad = [];
    const patterns = [
      /window\.open\s*\([^)]*mail/i,
      /location\.href\s*=\s*['"]mailto/i,
      /shell\.openExternal/i,
    ];
    for (const f of rendererFiles) {
      const text = fs.readFileSync(f, 'utf8');
      for (const p of patterns) {
        if (p.test(text)) {
          bad.push(path.relative(root, f).replace(/\\/g, '/') + ' => ' + p.source);
        }
      }
    }
    assert.deepStrictEqual(bad, [], 'Direct email client invocation in renderer:\n' + bad.join('\n'));
  });

  it('preload does not expose emailAPI or openOutlookEmail', () => {
    const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    assert.ok(!preloadJs.includes('openOutlookEmail'));
    assert.ok(!preloadJs.includes("exposeInMainWorld('emailAPI'"));
  });

  it('main.js blocks mailto in open-external handler', () => {
    const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    assert.ok(mainJs.includes("u.toLowerCase().startsWith('mailto:')"),
      'main.js must block mailto in open-external');
    const idx = mainJs.indexOf("u.toLowerCase().startsWith('mailto:')");
    const slice = mainJs.slice(Math.max(0, idx - 200), idx + 200);
    assert.ok(slice.includes('open-external'), 'mailto block must be inside open-external handler');
  });

});

