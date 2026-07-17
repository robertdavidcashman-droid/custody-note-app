/**
 * Regression tests for v1.5.3 fixes:
 *
 * 1. The "Send Bill to QuickFile" button must be clearly labelled as such
 *    (no longer "Generate Invoice"), so users immediately understand what
 *    the button does in the workflow billing step.
 *
 * 2. Archive flow must NOT silently archive a matter when QuickFile is
 *    configured but no invoice has been sent yet. Instead it must offer
 *    a 3-way choice (send first / archive without sending / cancel).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const billingScreen = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const billingJs     = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const completion    = fs.readFileSync(path.join(root, 'renderer', 'views', 'completion-screen.js'), 'utf8');
const toastJs       = fs.readFileSync(path.join(root, 'renderer', 'toast.js'), 'utf8');
const stylesCss     = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

describe('v1.5.3 — "Send Bill to QuickFile" button label', () => {
  it('billing-screen.js footer button uses the explicit "Send Bill to QuickFile" wording', () => {
    assert.match(
      billingScreen,
      /Send Bill to QuickFile &mdash; tick all 3 checkboxes first/,
      'Locked button label must say "Send Bill to QuickFile — tick all 3 checkboxes first"'
    );
  });

  it('billing-screen.js unlocked button uses "Send Bill to QuickFile"', () => {
    assert.match(
      billingScreen,
      /&#10003; Send Bill to QuickFile/,
      'Unlocked button (after 3 checkboxes ticked) must read "Send Bill to QuickFile"'
    );
  });

  it('billing-screen.js review confirmation card title and hint reference QuickFile', () => {
    assert.match(billingScreen, /tick all 3 to unlock QuickFile/);
    assert.match(billingScreen, /<strong>Send Bill to QuickFile<\/strong> button becomes active/);
  });

  it('billing-screen.js review status message uses the new label', () => {
    assert.match(billingScreen, /Send Bill to QuickFile is locked/);
    assert.match(billingScreen, /Send Bill to QuickFile is now unlocked/);
  });

  it('billing-screen.js no longer presents the ambiguous "Generate Invoice" label', () => {
    assert.ok(
      !/Generate Invoice/.test(billingScreen),
      'Old "Generate Invoice" copy must be fully removed from billing-screen.js'
    );
  });

  it('billing-screen.js in-flight button text says "Sending to QuickFile..."', () => {
    assert.match(billingScreen, /Sending to QuickFile\.\.\./);
  });

  it('billing-screen.js success toast mentions QuickFile explicitly', () => {
    assert.match(billingScreen, /QuickFile invoice #'\s*\+/);
    assert.match(billingScreen, /sent successfully/);
  });

  it('billing.js standalone billing panel uses the new label too', () => {
    assert.match(billingJs, /Send Bill to QuickFile/);
    assert.ok(
      !/Create QuickFile Invoice/.test(billingJs),
      'Old "Create QuickFile Invoice" wording must be removed from billing.js'
    );
  });
});

describe('v1.5.3 — Archive guard (do not silently bypass QuickFile)', () => {
  it('completion-screen.js _wfRunArchiveFromWorkflow reads QuickFile configuration before confirming archive', () => {
    const fn = completion.match(/function _wfRunArchiveFromWorkflow\(\)[\s\S]*?\n\}\s*\n/);
    assert.ok(fn, 'Could not locate _wfRunArchiveFromWorkflow function');
    const body = fn[0];
    assert.match(body, /hasQuickFileSettingsConfigured/);
    assert.match(body, /QuickfileConfigured\.fetchQuickFileConfigured/);
    assert.match(body, /_wfRunArchiveFromWorkflowImpl/);
    assert.match(body, /currentRecordArchived/);
  });

  it('completion-screen.js shows a 3-way choice dialog when QuickFile invoice is missing', () => {
    assert.match(completion, /showChoice\s*\(/);
    assert.match(completion, /This bill has NOT been sent to QuickFile yet/);
    assert.match(completion, /Send Bill to QuickFile first \(recommended\)/);
    assert.match(completion, /Archive without sending to QuickFile/);
  });

  it('"Send first" choice routes the user back to the billing review step', () => {
    assert.match(completion, /_wfGoToStep\(1\)/);
    assert.match(completion, /Tick the 3 review boxes, then click Send Bill to QuickFile/);
  });

  it('archive proceed path is factored into a reusable helper and exposed globally', () => {
    assert.match(completion, /function _wfArchiveConfirmedAndProceed\(\)/);
    assert.match(completion, /window\._wfArchiveConfirmedAndProceed\s*=\s*_wfArchiveConfirmedAndProceed/);
  });

  it('archive proceed helper still saves billing/office completion timestamps and archives', () => {
    assert.match(completion, /billingProcessCompletedAt\s*=\s*iso/);
    assert.match(completion, /officeWorkCompletedAt\s*=\s*iso/);
    assert.match(completion, /attendanceArchive\(currentAttendanceId\)/);
  });
});

describe('v1.5.3 — showChoice helper', () => {
  it('toast.js exports a showChoice helper on window', () => {
    assert.match(toastJs, /function showChoice\s*\(/);
    assert.match(toastJs, /window\.showChoice\s*=\s*showChoice/);
  });

  it('showChoice supports primary/secondary/danger button variants', () => {
    assert.match(toastJs, /opt\.variant\s*===\s*'danger'/);
    assert.match(toastJs, /opt\.variant\s*===\s*'secondary'/);
  });

  it('showChoice resolves with null when dismissed via Escape or backdrop click', () => {
    assert.match(toastJs, /done\(null\)/);
  });

  it('styles.css provides a stacked-button layout for the choice modal', () => {
    assert.match(stylesCss, /\.cn-confirm-btns--stacked\s*\{/);
    assert.match(stylesCss, /flex-direction:\s*column/);
  });
});
