/**
 * Regression for the billing redesign (v1.9.17):
 *  - getBillingHardWarnings() now exists and is exposed on window so the
 *    workflow completion step (Step 3) "Billing data complete" check is live
 *    (it was calling an undefined function, so the check was dead).
 *  - The legacy openBillingPanel() modal redirects to the single full-page
 *    billing workflow, so there is one billing path rather than two.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const completionJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'completion-screen.js'), 'utf8');

describe('getBillingHardWarnings (Step 3 billing-complete check)', () => {
  it('is defined in app.js and exposed on window', () => {
    assert.ok(/function getBillingHardWarnings\s*\(/.test(appJs), 'function must be defined');
    assert.ok(appJs.includes('window.getBillingHardWarnings = getBillingHardWarnings'), 'must be exposed on window');
  });

  it('is consumed by the completion screen (no longer a dead check)', () => {
    assert.ok(completionJs.includes('getBillingHardWarnings'), 'completion-screen.js must call it');
  });

  it('flags the core LAA claim essentials (matter type, outcome, time, DSCC)', () => {
    const start = appJs.indexOf('function getBillingHardWarnings');
    const body = appJs.slice(start, start + 1400);
    assert.ok(/matterTypeCode/.test(body), 'checks matter type');
    assert.ok(/outcomeDecision/.test(body), 'checks outcome');
    assert.ok(/totalMinutes/.test(body), 'checks time recording');
    assert.ok(/dsccRef/.test(body), 'checks DSCC reference');
    assert.ok(/_formType === 'telephone'/.test(body), 'telephone matters are exempt');
  });
});

describe('billing re-flow labels (invoice vs LAA claim)', () => {
  const billingScreen = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');

  it('billing-screen separates QuickFile invoice from Section 9 LAA claim', () => {
    assert.ok(billingScreen.includes('_wfBuildLaaClaimGuideCard'), 'LAA claim guide helper');
    assert.ok(billingScreen.includes('does not set the bill'), 'LAA guide title');
    assert.ok(billingScreen.includes('Your invoice'), 'invoice section title');
    assert.ok(billingScreen.includes('LAA fixed fee on the claim form is &pound;320'), 'clarifies £320 vs invoice');
    assert.ok(billingScreen.includes('calculateInvoiceTotals'), 'invoice totals via shared helper');
  });
});

describe('single billing path (legacy modal redirects to workflow)', () => {
  it('openBillingPanel redirects to the full-page matter-billing workflow', () => {
    const start = billingJs.indexOf('function openBillingPanel');
    const body = billingJs.slice(start, start + 700);
    assert.ok(body.includes("showView('matter-billing')"), 'must redirect to the workflow screen');
    assert.ok(body.includes("getElementById('view-matter-billing')"), 'guards on the workflow view being present');
  });

  it('still exposes openBillingPanel as a defensive fallback', () => {
    assert.ok(billingJs.includes('function openBillingPanel'), 'function still present');
  });
});
