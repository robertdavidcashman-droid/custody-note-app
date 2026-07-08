/**
 * Static source checks for billing overhaul: removed UI, async IPC, invoice rules.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const indexHtml = read('index.html');
const appJs = read('app.js');
const mainJs = read('main.js');
const preloadJs = read('preload.js');
const billingJs = read(path.join('renderer', 'views', 'billing.js'));

describe('Removed UI — index.html', () => {
  const removed = [
    'id="form-header-export-pdf"',
    'id="form-header-export-docx"',
    'data-action="shortcut-print-pdf"',
    'data-action="shortcut-email-solicitor"',
  ];
  removed.forEach((frag) => {
    it('does not include ' + frag, () => {
      assert.ok(!indexHtml.includes(frag), 'should remove: ' + frag);
    });
  });
});

describe('Removed solicitor / picker code — app.js', () => {
  it('does not define printDeclarationFromForm', () => {
    assert.ok(!appJs.includes('function printDeclarationFromForm'));
  });
  it('does not define showAttendancePickerModal', () => {
    assert.ok(!appJs.includes('function showAttendancePickerModal'));
  });
  it('does not define openSolicitorEmail', () => {
    assert.ok(!appJs.includes('function openSolicitorEmail'));
  });
  it('does not include Instructing Solicitor Email PDF section', () => {
    assert.ok(!appJs.includes('Instructing Solicitor Email'));
  });
});

describe('Async IPC — no synchronous bridge misuse', () => {
  it('preload has no sendSync', () => {
    assert.ok(!preloadJs.includes('sendSync'));
  });
  it('preview uses invoke in preload', () => {
    assert.ok(preloadJs.includes("invoke('preview-pdf-from-html'"));
  });
  it('QuickFile create uses invoke in preload', () => {
    assert.ok(preloadJs.includes("invoke('quickfile-create-invoice'"));
  });
});

describe('QuickFile payload shape — main.js', () => {
  it('uses ItemLines.ItemLine and Tax1 on lines', () => {
    assert.ok(mainJs.includes('ItemLines'));
    assert.ok(mainJs.includes('ItemLine:'));
    assert.ok(mainJs.includes('Tax1:'));
  });
  it('accepts billingInvoiceNumber param', () => {
    assert.ok(mainJs.includes('billingInvoiceNumber'));
    assert.ok(mainJs.includes('sanitizeQuickFileInvoiceNumber'));
  });
});

describe('Auto invoice number wiring', () => {
  it('app.js exposes sanitise helpers', () => {
    assert.ok(appJs.includes('function sanitizeBillingInvoiceNumber'));
    assert.ok(appJs.includes('ensureBillingDisplayInvoiceNumber'));
  });
  it('billing panel does NOT expose the internal "Billing invoice no." line (v1.5.6)', () => {
    // v1.5.6: removed both the read-only display element and the (long-removed) input
    assert.ok(!billingJs.includes('billing-invoice-ref-display'),
      'v1.5.6: billing-invoice-ref-display must not appear in the billing panel');
    assert.ok(!billingJs.includes('id="billing-invoice-number-input"'));
    assert.ok(!billingJs.includes("name=\"billingInvoiceNumber\""));
  });
});

describe('SBT is not surfaced in billing readiness panel', () => {
  it('does not define getBillingReadinessInformationalNotes', () => {
    assert.ok(!appJs.includes('function getBillingReadinessInformationalNotes'));
  });
  it('blocking warnings omit sufficient benefit / SBT', () => {
    const warnIdx = appJs.indexOf('function getBillingReadinessWarnings');
    assert.ok(warnIdx !== -1);
    const warnBlock = appJs.substring(warnIdx, warnIdx + 900);
    assert.ok(!warnBlock.includes('sufficientBenefit'));
    assert.ok(!appJs.includes('Sufficient benefit note missing'));
    assert.ok(!appJs.includes('Sufficient benefit: add SBT'));
  });
});

describe('Input path debounce — app.js', () => {
  it('attachSectionListeners wires input to scheduleUIRefresh', () => {
    const i = appJs.indexOf('function attachSectionListeners');
    assert.ok(i !== -1);
    const block = appJs.substring(i, i + 9000);
    assert.ok(block.includes("addEventListener('input'"));
    assert.ok(block.includes('scheduleUIRefresh'));
  });

  it('uses 300ms UI refresh debounce in main form path', () => {
    assert.ok(appJs.includes('UI_REFRESH_DEBOUNCE_MS = 300'));
  });
});
