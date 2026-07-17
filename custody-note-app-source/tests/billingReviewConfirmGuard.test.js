/**
 * Regression test for v1.5.10 fix:
 *
 * On the workflow Step 2 ("Billing review") screen the "Review Confirmation —
 * tick all 3 to unlock QuickFile" card and its "Send Bill to QuickFile is now
 * unlocked — click it in the footer below" status used to render
 * unconditionally, even when QuickFile was not configured (and therefore the
 * footer would never emit the "Send Bill to QuickFile" button). Users were
 * told to click a button that did not exist.
 *
 * The fix: the review-confirmation card is only rendered when
 *   `qfConfigured && !opts.hasExistingInvoice`
 * matching the same gate used by the footer's `createBtnHtml`. When QuickFile
 * is not configured, a plain "QuickFile not configured" notice card is shown
 * instead, with an "Open QuickFile settings" button that calls
 * `window.openQuickFileSettings()` (which is exposed in app.js).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const billingScreen = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

describe('v1.5.10 — Billing review confirmation card is gated on QuickFile config', () => {
  it('Review Confirmation card is wrapped in a (qfConfigured && !opts.hasExistingInvoice) ternary', () => {
    assert.match(
      billingScreen,
      /qfConfigured\s*&&\s*!opts\.hasExistingInvoice[\s\S]*?wf-review-confirmation-card/,
      'Review Confirmation card must only render when QuickFile is configured AND no invoice exists yet'
    );
  });

  it('A QuickFile not-set-up notice card is rendered when !qfConfigured', () => {
    assert.match(billingScreen, /wf-qf-not-configured-card/);
    assert.match(billingScreen, /QuickFile not set up/);
    assert.match(
      billingScreen,
      /!qfConfigured[\s\S]*?wf-qf-not-configured-card/,
      'Not-configured notice must be gated on !qfConfigured'
    );
  });

  it('Not-configured notice includes an "Open QuickFile settings" action button', () => {
    assert.match(billingScreen, /id="wf-bill-open-qf-settings"/);
    assert.match(billingScreen, /Open QuickFile settings/);
  });

  it('Click handler closes the workflow and calls window.openQuickFileSettings()', () => {
    assert.match(
      billingScreen,
      /wf-bill-open-qf-settings[\s\S]*?addEventListener\('click'[\s\S]*?window\.openQuickFileSettings\(\)/,
      'wf-bill-open-qf-settings click handler must invoke window.openQuickFileSettings()'
    );
    assert.match(
      billingScreen,
      /wf-bill-open-qf-settings[\s\S]*?addEventListener\('click'[\s\S]*?closeWorkflow\(\)/,
      'Handler must close the workflow overlay before opening Settings so the user can see it'
    );
  });

  it('app.js exposes openQuickFileSettings on window', () => {
    assert.match(
      appJs,
      /window\.openQuickFileSettings\s*=\s*openQuickFileSettings/,
      'openQuickFileSettings must be exposed on window so renderer modules can call it'
    );
  });

  it('Checkbox-binding code does not throw when the review checkboxes are absent', () => {
    assert.match(
      billingScreen,
      /var checkboxes = overlay\.querySelectorAll\('\.wf-checklist input\[type="checkbox"\]'\);[\s\S]*?if \(checkboxes && checkboxes\.length\)/,
      'Checkbox binding must be guarded with an `if (checkboxes && checkboxes.length)` check'
    );
  });
});
