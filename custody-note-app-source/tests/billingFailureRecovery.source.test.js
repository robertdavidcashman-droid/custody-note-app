/**
 * Integration/source tests for billing clarity:
 *  - a failed QuickFile export shows a clear recovery action and does NOT mark
 *    the record invoiced (so no duplicate is created on retry);
 *  - the invoice status model can represent failed/paid states.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const BILLING_SCREEN = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const BILLING_UTILS = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');

describe('billing failed-export recovery', () => {
  it('defines a single failure handler wired to shared recovery copy', () => {
    assert.ok(BILLING_SCREEN.includes('function _wfShowInvoiceFailure'), 'recovery helper missing');
    assert.ok(BILLING_SCREEN.includes('formatBillingCreateFailureToast'),
      'failure handler must delegate to shared formatter');
    assert.ok(BILLING_UTILS.includes('press "Send Bill to QuickFile" again'),
      'generic failures must tell the user how to retry');
    assert.ok(BILLING_UTILS.includes('Continue to Review & complete'),
      'already-invoiced failures must not tell the user to press Send again');
    assert.ok(/Test QuickFile connection/.test(BILLING_UTILS),
      'connection-type failures must point to the connection test');
  });

  it('does not set invoice ids on the failure path (avoids accidental duplicates)', () => {
    // The only assignment of quickfile_invoice_id must be inside the success (result.ok) branch.
    const okIdx = BILLING_SCREEN.indexOf('if (result.ok)');
    const assignIdx = BILLING_SCREEN.indexOf('formData.quickfile_invoice_id =');
    assert.ok(okIdx > -1 && assignIdx > okIdx, 'invoice id must only be set on success');
  });
});

describe('invoice status model', () => {
  it('can represent draft, ready, invoiced, sent, failed, paid and archived', () => {
    ['DRAFT', 'INVOICE_READY', 'INVOICED', 'SENT', 'FAILED', 'PAID', 'ARCHIVED'].forEach((k) => {
      assert.ok(BILLING_UTILS.includes(k + ':'), 'missing status ' + k);
    });
    assert.ok(BILLING_UTILS.includes("failed: 'Send failed'"), 'failed label missing');
    assert.ok(BILLING_UTILS.includes("paid: 'Paid'"), 'paid label missing');
  });
});
