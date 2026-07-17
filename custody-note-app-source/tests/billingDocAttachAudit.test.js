/**
 * Billing, Documents & Attachments — Deep Audit Tests
 * Regression tests for issues found during the full audit.
 */

const { readFileSync } = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');

function readSrc(rel) {
  return readFileSync(path.join(APP_ROOT, rel), 'utf8');
}

/* ══════════════════════════════════════════════════
   BILLING CALCULATION TESTS
   ══════════════════════════════════════════════════ */

test('billingUtils: calculateInvoiceTotals grandTotal = rounded sub + rounded vat (no penny discrepancy)', () => {
  const src = readSrc('renderer/billingUtils.js');
  const fn = new Function(src + '; return calculateInvoiceTotals;')();

  const result = fn({ fixedFee: 160.005, mileageMiles: 0, mileageRate: 0, parkingAmount: 0, vatRate: 0.20 });
  assert.equal(result.grandTotal, Number((result.subTotal + result.vatTotal).toFixed(2)),
    'grandTotal must equal rounded subTotal + rounded vatTotal');
});

test('billingUtils: zero mileageRate is NOT replaced with default', () => {
  const src = readSrc('renderer/billingUtils.js');
  const fn = new Function(src + '; return calculateInvoiceTotals;')();

  const result = fn({ fixedFee: 100, mileageMiles: 10, mileageRate: 0, vatRate: 0.20 });
  assert.equal(result.mileageAmount, 0, 'mileage amount should be 0 when rate is explicitly 0');
});

test('billingUtils: zero fixedFee is NOT replaced with default', () => {
  const src = readSrc('renderer/billingUtils.js');
  const fn = new Function(src + '; return calculateInvoiceTotals;')();

  const result = fn({ fixedFee: 0, mileageMiles: 0, mileageRate: 0.45, parkingAmount: 50, vatRate: 0.20 });
  assert.equal(result.fixedFee, 0, 'fixedFee should remain 0 when explicitly set');
  assert.equal(result.subTotal, 50, 'subTotal should only include parking');
});

test('billingUtils: negative values are clamped to zero', () => {
  const src = readSrc('renderer/billingUtils.js');
  const fn = new Function(src + '; return calculateInvoiceTotals;')();

  const result = fn({ fixedFee: -100, mileageMiles: -5, mileageRate: 0.45, parkingAmount: 10, vatRate: 0.20 });
  assert.equal(result.fixedFee, 0, 'negative fixedFee should become 0');
  assert.equal(result.mileageMiles, 0, 'negative miles should become 0');
});

test('billingUtils: NaN inputs default safely', () => {
  const src = readSrc('renderer/billingUtils.js');
  const fn = new Function(src + '; return calculateInvoiceTotals;')();

  const result = fn({ fixedFee: 'abc', mileageMiles: undefined, mileageRate: null, vatRate: NaN });
  assert.equal(result.fixedFee, 0);
  assert.equal(result.mileageMiles, 0);
  assert.equal(result.vatRate, 0.20, 'vatRate should default to 0.20');
});

test('billingUtils: standard invoice £160 + 10 miles + £5 parking', () => {
  const src = readSrc('renderer/billingUtils.js');
  const fn = new Function(src + '; return calculateInvoiceTotals;')();

  const result = fn({ fixedFee: 160, mileageMiles: 10, mileageRate: 0.45, parkingAmount: 5, vatRate: 0.20 });
  assert.equal(result.fixedFee, 160);
  assert.equal(result.mileageAmount, 4.50);
  assert.equal(result.parkingAmount, 5);
  assert.equal(result.subTotal, 169.50);
  assert.equal(result.vatTotal, 33.90);
  assert.equal(result.grandTotal, 203.40);
});

test('billingUtils: buildQuickFilePayload respects explicit zero fees', () => {
  const src = readSrc('renderer/billingUtils.js');
  const globals = `
    function buildLine1Description() { return 'Test'; }
    function formatInvoiceTitle(c, s) { return c + ' - ' + s; }
  `;
  const fn = new Function(globals + src + '; return buildQuickFilePayload;')();

  const payload = fn({
    clientName: 'Test', policeStation: 'Station',
    fixedFee: 0, mileageMiles: 0, mileageRate: 0, parkingAmount: 0, vatRate: 0.20,
  });
  assert.equal(payload.totals.fixedFee, 0);
  assert.equal(payload.totals.grandTotal, 0);
  assert.equal(payload.lineItems.length, 0, 'no line items for zero-value invoice');
});

/* ══════════════════════════════════════════════════
   XSS / ESCAPING TESTS
   ══════════════════════════════════════════════════ */

test('_wfEsc escapes double quotes for safe HTML attribute use', () => {
  const src = readSrc('renderer/views/workflow-stepper.js');
  const fn = new Function(src + '; return _wfEsc;')();

  const result = fn('" onmouseover="alert(1)');
  assert.ok(!result.includes('"'), 'double quotes must be escaped');
  assert.ok(result.includes('&quot;'), 'should use &quot; entity');
});

test('_wfEsc escapes all HTML special characters', () => {
  const src = readSrc('renderer/views/workflow-stepper.js');
  const fn = new Function(src + '; return _wfEsc;')();

  const result = fn('<script>alert("xss")</script> & more');
  assert.ok(!result.includes('<'), 'angle brackets must be escaped');
  assert.ok(!result.includes('>'), 'angle brackets must be escaped');
  assert.ok(result.includes('&amp;'), 'ampersand must be escaped');
  assert.ok(result.includes('&quot;'), 'quotes must be escaped');
});

/* ══════════════════════════════════════════════════
   ATTACHMENT WORKFLOW TESTS
   ══════════════════════════════════════════════════ */

test('pick-file handler has try/catch for error safety', () => {
  const src = readSrc('main.js');
  const pickFileMatch = src.match(/ipcMain\.handle\('pick-file'[\s\S]*?\n\}\);/);
  assert.ok(pickFileMatch, 'pick-file handler should exist');
  assert.ok(pickFileMatch[0].includes('try {'), 'pick-file must have try/catch');
  assert.ok(pickFileMatch[0].includes('catch'), 'pick-file must have catch block');
});

test('pick-file handler checks size before reading full file', () => {
  const src = readSrc('main.js');
  const pickFileMatch = src.match(/ipcMain\.handle\('pick-file'[\s\S]*?\n\}\);/);
  assert.ok(pickFileMatch, 'pick-file handler should exist');
  const handler = pickFileMatch[0];
  const statIdx = handler.indexOf('statSync');
  const readIdx = handler.indexOf('readFileSync');
  assert.ok(statIdx > -1, 'should use statSync for size check');
  assert.ok(readIdx > -1, 'should read file');
  assert.ok(statIdx < readIdx, 'statSync must come BEFORE readFileSync');
});

test('pick-image handler has try/catch for error safety', () => {
  const src = readSrc('main.js');
  const match = src.match(/ipcMain\.handle\('pick-image'[\s\S]*?\n\}\);/);
  assert.ok(match, 'pick-image handler should exist');
  assert.ok(match[0].includes('try {'), 'pick-image must have try/catch');
  assert.ok(match[0].includes('catch'), 'pick-image must have catch block');
});

/* ══════════════════════════════════════════════════
   OPEN MATTERS REVENUE — VAT NOT HARDCODED
   (replaces the old billable-attendances.js test after that file
   was deleted in v1.4.217 — the same rule still applies to the
   projected revenue calc that took its place.)
   ══════════════════════════════════════════════════ */

/* (Removed in v1.5.23) The standalone Open-matters view (billing-view.js)
   was deleted along with #view-billing. Per-matter revenue now flows through
   billing-screen.js / billingUtils.js, which are still covered by the VAT
   multiplier check in billingWorkflow.test.js. */

/* ══════════════════════════════════════════════════
   ARCHIVE CONFIRMATION (main form — workflow no longer archives in overlay)
   ══════════════════════════════════════════════════ */

test('app.js archive flow uses confirmation dialog', () => {
  const src = readSrc('app.js');
  assert.ok(src.includes('showConfirm'), 'Archive action must use confirmation dialog');
  assert.ok(
    src.includes('Archive this record') || src.includes('Archive this matter'),
    'Confirmation should mention archiving'
  );
});

/* ══════════════════════════════════════════════════
   STALE STATE — quickfile_invoice_id SET IN FORMDATA
   ══════════════════════════════════════════════════ */

test('billing.js sets quickfile_invoice_id in formData after successful invoice creation', () => {
  const src = readSrc('renderer/views/billing.js');
  assert.ok(src.includes('formData.quickfile_invoice_id'), 'Must write quickfile_invoice_id back to formData');
});

/* ══════════════════════════════════════════════════
   PRINT-TO-PDF ERROR HANDLING
   ══════════════════════════════════════════════════ */

test('print-to-pdf handler has try/catch', () => {
  const src = readSrc('main.js');
  const match = src.match(/ipcMain\.handle\('print-to-pdf'[\s\S]*?\n\}\);/);
  assert.ok(match, 'print-to-pdf handler should exist');
  assert.ok(match[0].includes('try {'), 'print-to-pdf must have try/catch');
});

/* ══════════════════════════════════════════════════
   BILLING VIEW — NEW IPC HANDLER EXISTS
   ══════════════════════════════════════════════════ */

test('billing-view-records IPC handler exists in main.js', () => {
  const src = readSrc('main.js');
  assert.ok(src.includes("ipcMain.handle('billing-view-records'"), 'billing-view-records handler must exist');
});

test('billingViewRecords exposed in preload.js', () => {
  const src = readSrc('preload.js');
  assert.ok(src.includes('billingViewRecords'), 'billingViewRecords must be exposed in preload');
});
