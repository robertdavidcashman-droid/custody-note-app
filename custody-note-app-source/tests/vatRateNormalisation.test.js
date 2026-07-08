/**
 * Regression tests for v1.5.4 — VAT rate normalisation
 *
 * Bug: settings persists `billingVatRate` as the percentage string "20"
 *      (because the settings input is in % units). The rest of the system
 *      expects a decimal fraction (0.20). Without normalisation, parseFloat("20")
 *      yields 20, which then gets multiplied by 100 again at render time and the
 *      VAT input shows "2000" instead of "20".
 *
 * Fix: introduce `_normaliseVatRate` in app.js that always returns a decimal
 *      fraction in [0, 1], divides by 100 if >1, and provides a sane fallback.
 *      Add defence-in-depth `if (vatRate > 1) vatRate /= 100` guards in both
 *      billing renderers so any legacy bad value can't poison the field again.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJs         = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const billingScreen = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const billingJs     = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');

describe('v1.5.4 — VAT rate normalisation', () => {
  it('app.js defines _normaliseVatRate helper', () => {
    assert.match(
      appJs,
      /function\s+_normaliseVatRate\s*\(\s*raw\s*,\s*fallback\s*\)/,
      '_normaliseVatRate(raw, fallback) must exist in app.js'
    );
  });

  it('settings save path uses _normaliseVatRate (not raw parseFloat)', () => {
    const matches = appJs.match(/_normaliseVatRate\(s\.billingVatRate/g) || [];
    assert.ok(
      matches.length >= 2,
      'Both _billingDefaults assignments (save path + initial load) must call _normaliseVatRate(s.billingVatRate, ...). Found ' + matches.length
    );
  });

  it('app.js no longer contains the raw parseFloat(s.billingVatRate) || 0.20 pattern', () => {
    assert.doesNotMatch(
      appJs,
      /parseFloat\(s\.billingVatRate\)\s*\|\|\s*0\.20/,
      'Raw parseFloat(s.billingVatRate) || 0.20 is the bug pattern that yields 20 instead of 0.20 — must be replaced by _normaliseVatRate'
    );
  });

  it('billing-screen.js guards an out-of-range vatRate from settings (>1 → /100)', () => {
    assert.match(
      billingScreen,
      /if\s*\(\s*typeof\s+vatRate\s*===\s*['"]number['"]\s*&&\s*vatRate\s*>\s*1\s*\)\s*vatRate\s*=\s*vatRate\s*\/\s*100/,
      'billing-screen.js must contain the defence-in-depth `if (vatRate > 1) vatRate = vatRate / 100` guard'
    );
  });

  it('billing-screen.js wf-vat input renders normalised value (cannot show 2000)', () => {
    assert.match(
      billingScreen,
      /id="wf-vat"[^>]*value="'\s*\+\s*\(function\(\)\{\s*var vr = \(opts\.vatRate \|\| 0\.20\); if \(vr > 1\) vr = vr \/ 100; return \(vr \* 100\)\.toFixed\(0\); \}\)\(\)/,
      'The wf-vat input must wrap its value in a normaliser IIFE so a bad opts.vatRate can never render as 2000'
    );
  });

  it('billing.js standalone billing-vat-rate input renders normalised value', () => {
    assert.match(
      billingJs,
      /id="billing-vat-rate"[^>]*value="'\s*\+\s*\(function\(\)\{\s*var vr = \(opts\.vatRate \|\| 0\.20\); if \(vr > 1\) vr = vr \/ 100; return \(vr \* 100\)\.toFixed\(0\); \}\)\(\)/,
      'The billing-vat-rate input must wrap its value in a normaliser IIFE'
    );
  });

  it('billing.js subtotal calculation guards vatRate (>1 → /100) so totals are correct', () => {
    assert.match(
      billingJs,
      /_vatRateForCalc\s*=\s*\(opts\.vatRate \|\| 0\.20\);\s*\n\s*if\s*\(typeof _vatRateForCalc === 'number' && _vatRateForCalc > 1\) _vatRateForCalc = _vatRateForCalc \/ 100/,
      'billing.js must compute vatAmt against a normalised _vatRateForCalc'
    );
  });
});

describe('v1.5.4 — _normaliseVatRate behaviour (semantic)', () => {
  // Extract and eval just the helper so we can unit-test its behaviour.
  // Matches the function declaration through its closing brace.
  const m = appJs.match(/function\s+_normaliseVatRate\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(m, 'Could not extract _normaliseVatRate from app.js');
  // eslint-disable-next-line no-new-func
  const _normaliseVatRate = new Function(m[0] + '; return _normaliseVatRate;')();

  it('"20" (percent string from settings) → 0.20', () => {
    assert.strictEqual(_normaliseVatRate('20', 0.20), 0.20);
  });

  it('20 (number, percent) → 0.20', () => {
    assert.strictEqual(_normaliseVatRate(20, 0.20), 0.20);
  });

  it('"0.2" (decimal string) → 0.2', () => {
    assert.strictEqual(_normaliseVatRate('0.2', 0.20), 0.2);
  });

  it('0.20 (already a decimal) → 0.20', () => {
    assert.strictEqual(_normaliseVatRate(0.20, 0.20), 0.20);
  });

  it('null → fallback 0.20', () => {
    assert.strictEqual(_normaliseVatRate(null, 0.20), 0.20);
  });

  it('undefined → fallback 0.20', () => {
    assert.strictEqual(_normaliseVatRate(undefined, 0.20), 0.20);
  });

  it('"" → fallback 0.20', () => {
    assert.strictEqual(_normaliseVatRate('', 0.20), 0.20);
  });

  it('"abc" (NaN) → fallback 0.20', () => {
    assert.strictEqual(_normaliseVatRate('abc', 0.20), 0.20);
  });

  it('-5 (negative) → fallback 0.20', () => {
    assert.strictEqual(_normaliseVatRate(-5, 0.20), 0.20);
  });

  it('"2000" (the bug value, double-multiplied) → fallback 0.20', () => {
    // 2000 / 100 = 20, which is still > 1, so we fall back rather than guess.
    assert.strictEqual(_normaliseVatRate('2000', 0.20), 0.20);
  });

  it('"5" (e.g. reduced rate) → 0.05', () => {
    assert.ok(Math.abs(_normaliseVatRate('5', 0.20) - 0.05) < 1e-9);
  });
});
