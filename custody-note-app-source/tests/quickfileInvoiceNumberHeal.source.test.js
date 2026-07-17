/**
 * Source tests for QuickFile invoice-number self-healing:
 * when a desired number is taken, the app must find the next free number
 * (heal + retry + auto-assign fallback) and still attach documents after create.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const billingUtils = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractHandler(name) {
  const re = new RegExp("ipcMain\\.handle\\('" + name + "'[\\s\\S]*?^\\}\\);", 'm');
  const m = mainJs.match(re);
  assert.ok(m, 'handler missing: ' + name);
  return m[0];
}

describe('QuickFile invoice number self-heal', () => {
  it('healInvoiceNumberSequence computes numeric max across search records', () => {
    const fn = mainJs.match(/async function healInvoiceNumberSequence[\s\S]*?^}/m);
    assert.ok(fn, 'healInvoiceNumberSequence missing');
    assert.ok(mainJs.includes('ReturnCount: 100'));
    assert.ok(mainJs.includes('invoice-number-heal'));
    assert.ok(fn[0].includes('ledgerMax') && fn[0].includes('bumped'));
  });

  it('create handler re-heals on duplicate and auto-assigns if still blocked', () => {
    const handler = extractHandler('quickfile-create-invoice');
    assert.ok(handler.includes("healInvoiceNumberSequence({ soft: false, reason: 'create-invoice' })"));
    assert.ok(handler.includes("reason: 'create-duplicate-retry'"));
    assert.ok(handler.includes("reason: 'create-auto-assign-fallback'"));
    assert.ok(handler.includes('buildInvoiceCreatePayload({ IssueDate: invDate })'));
    assert.ok(handler.includes('invoiceBody.InvoiceNumber'));
    assert.ok(handler.includes('invoiceBody.Invoice_No') || handler.includes('InvoiceNo'));
    assert.ok(handler.includes('lastAttemptedInvNum'));
    assert.ok(handler.includes('bumpLocalNextAfterAssignedInvoiceNumber(invoiceNumber)'));
    assert.ok(handler.includes("reason: 'create-failed'"));
  });

  it('attachments still run only after a successful create (unchanged contract)', () => {
    const handler = extractHandler('quickfile-create-invoice');
    const createIdx = handler.indexOf("quickFileRequest('/1_2/invoice/create'");
    const attachIdx = handler.indexOf('quickFileUploadSalesAttachment');
    assert.ok(createIdx > -1 && attachIdx > createIdx, 'attachments must follow create');
  });

  it('preload bridges quickfileHealInvoiceNumber', () => {
    assert.ok(preloadJs.includes('quickfileHealInvoiceNumber'));
    assert.ok(preloadJs.includes("invoke('quickfile-heal-invoice-number')"));
  });

  it('Test QuickFile surfaces healed next invoice number', () => {
    const testHandler = extractHandler('quickfile-test-connection');
    assert.ok(testHandler.includes('nextInvoiceNumber'));
    assert.ok(testHandler.includes("reason: 'test-connection'"));
    assert.ok(appJs.includes('Next invoice #'));
  });

  it('billing failure toast special-cases invoice-number conflicts', () => {
    assert.ok(billingUtils.includes('looksLikeInvoiceNumberConflictError'));
    assert.ok(billingUtils.includes('Invoice numbering will re-sync automatically'));
  });
});
