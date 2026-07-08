/**
 * Billing duplicate-invoice guard: user-facing errors and recovery copy.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const billingScreenJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const billingUtilsJs = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');

describe('main.js duplicate invoice guard', () => {
  it('returns ALREADY_INVOICED code without developer override text', () => {
    assert.ok(mainJs.includes("code: 'ALREADY_INVOICED'"), 'missing ALREADY_INVOICED code');
    assert.ok(mainJs.includes('already has invoice #'), 'missing user invoice message');
    assert.ok(!mainJs.includes('Set allowDuplicate to override'), 'developer error text must not appear');
  });

  it('still gates duplicates unless allowDuplicate param is set', () => {
    assert.ok(mainJs.includes('!params.allowDuplicate'), 'duplicate guard must remain');
    assert.ok(mainJs.includes('allowDuplicate'), 'allowDuplicate param must remain for confirmed duplicates');
  });
});

describe('billingUtils duplicate invoice helpers', () => {
  it('defines shared already-invoiced detection and toast formatters', () => {
    assert.ok(billingUtilsJs.includes('function isAlreadyInvoicedError'));
    assert.ok(billingUtilsJs.includes('function formatBillingCreateFailureToast'));
    assert.ok(billingUtilsJs.includes('function formatLegacyBillingCreateFailureToast'));
    assert.ok(billingUtilsJs.includes('Continue to Review & complete'));
    assert.ok(!billingUtilsJs.includes('allowDuplicate'));
  });
});

describe('billing-screen workflow recovery', () => {
  it('re-fetches invoice status before create', () => {
    const fnIdx = billingScreenJs.indexOf('async function _wfHandleCreateInvoiceImpl');
    assert.ok(fnIdx !== -1);
    const fnBlock = billingScreenJs.substring(fnIdx, fnIdx + 1200);
    assert.ok(fnBlock.includes('attendanceInvoiceStatus(recordId)'), 'must refresh invoice status before create');
  });

  it('routes failures through formatBillingCreateFailureToast', () => {
    assert.ok(billingScreenJs.includes('formatBillingCreateFailureToast'));
    assert.ok(billingScreenJs.includes('_wfShowInvoiceFailure(result.error'), 'must pass error code to failure handler');
  });

  it('guide copy points to Continue when invoice already exists', () => {
    assert.ok(billingScreenJs.includes('Invoice already created'));
    assert.ok(billingScreenJs.includes('Continue to Review &amp; complete'));
    assert.ok(!billingScreenJs.includes('create another if needed'), 'misleading create-another copy removed');
  });
});

describe('legacy billing panel recovery', () => {
  it('uses shared legacy failure formatter', () => {
    assert.ok(billingJs.includes('formatLegacyBillingCreateFailureToast'));
  });

  it('re-fetches invoice status before create', () => {
    const fnIdx = billingJs.indexOf('async function _handleCreateInvoice');
    assert.ok(fnIdx !== -1);
    const fnBlock = billingJs.substring(fnIdx, fnIdx + 1200);
    assert.ok(fnBlock.includes('attendanceInvoiceStatus(recordId)'), 'legacy panel must refresh invoice status');
  });
});
