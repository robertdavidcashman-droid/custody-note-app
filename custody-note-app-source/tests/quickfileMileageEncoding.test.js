'use strict';

/**
 * QuickFile mileage line must be ASCII-safe (no Â£ / Ã / mojibake, no raw £).
 * Root cause of the live bug was a literal "Â£" string baked into main.js.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { formatQuickFileMileageDescription } = require('../lib/quickfileClient');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const billingUtilsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'billingUtils.js'), 'utf8');

describe('formatQuickFileMileageDescription', () => {
  it('builds an ASCII-safe miles-at-rate string', () => {
    const desc = formatQuickFileMileageDescription(12, 0.45);
    assert.strictEqual(desc, 'Mileage (12.0 miles at 0.45 GBP/mile)');
  });

  it('contains no pound sign, en-dash, or mojibake accents', () => {
    const desc = formatQuickFileMileageDescription(12.5, 0.45);
    assert.ok(!desc.includes('\u00a3'), 'must not contain £');
    assert.ok(!desc.includes('\u2013'), 'must not contain en-dash');
    assert.ok(!desc.includes('\u00c2'), 'must not contain Â');
    assert.ok(!desc.includes('\u00c3'), 'must not contain Ã');
    assert.ok(!/Â|Ã|â€/.test(desc));
    // Wire bytes must be pure ASCII for this description
    assert.strictEqual(Buffer.from(desc, 'utf8').toString('ascii'), desc);
  });

  it('defaults invalid rate to 0.45 and formats one decimal mile', () => {
    assert.strictEqual(
      formatQuickFileMileageDescription('not-a-number', 'x'),
      'Mileage (0.0 miles at 0.45 GBP/mile)'
    );
  });
});

describe('QuickFile mileage wire path (main.js)', () => {
  it('uses formatQuickFileMileageDescription for ItemDescription', () => {
    assert.match(mainJs, /formatQuickFileMileageDescription\(/);
    assert.doesNotMatch(mainJs, /miles @/);
  });

  it('does not contain a literal mojibake Â£ in the QuickFile invoice builder', () => {
    const createStart = mainJs.indexOf("ipcMain.handle('quickfile-create-invoice'");
    assert.ok(createStart > 0);
    const slice = mainJs.slice(createStart, createStart + 8000);
    assert.ok(!slice.includes('\u00c2\u00a3'), 'must not contain Â£ (U+00C2 U+00A3)');
    assert.ok(!slice.includes('Â£'));
    assert.ok(!slice.includes('\u00a3'), 'invoice create path must not embed raw £');
  });

  it('payload string for sample miles matches helper exactly', () => {
    const expected = formatQuickFileMileageDescription(12, 0.45);
    assert.strictEqual(expected, 'Mileage (12.0 miles at 0.45 GBP/mile)');
    assert.ok(mainJs.includes('quickfileClient.formatQuickFileMileageDescription'));
  });
});

describe('billingUtils mileage preview description', () => {
  it('uses ASCII GBP/mile form (not bare Mileage with a pound glyph)', () => {
    assert.match(billingUtilsJs, /miles at .* GBP\/mile/);
    assert.doesNotMatch(billingUtilsJs, /description: 'Mileage'/);
    assert.ok(!billingUtilsJs.includes('\u00a3'));
    assert.ok(!billingUtilsJs.includes('Â'));
  });
});
