/**
 * Tests for v1.5.2 fixes:
 *   1. Time-breakdown panel "chargeable attendance & advice (totals)" row
 *      must be computed from the recorded visit times via
 *      `StationVisits.aggregateMinuteBuckets`, NOT read from the
 *      `adviceSocial` / `adviceUnsocial` form fields. Those form fields
 *      are user-overrideable in §9 and stale values produced confusing
 *      output like:
 *          Visit 1 — Attendance at station: 14:42 to 16:00 — social (78 mins)
 *          All visits — chargeable attendance & advice (totals): social (36 mins)
 *
 *   2. Inline "Add new firm" form (instructing-firm picker on §1) must:
 *      - render a labelled row per field
 *      - mark Firm name as required
 *      - keep the phone field's None / N/A / Not applicable quick-fill
 *        buttons grouped tightly with the phone input (visually obvious
 *        they belong to phone, not to email)
 *      - present "Add Firm" as the visually primary action
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('../renderer/lib/station-visits.js');
const SV = globalThis.StationVisits;

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* ---------- Fix 1: chargeable attendance & advice totals ---------- */

describe('Time-breakdown panel — chargeable attendance & advice totals', () => {
  it('aggregateMinuteBuckets gives 78 social mins for a single 14:42–16:00 visit', () => {
    const visits = [{ timeArrival: '14:42', timeDeparture: '16:00' }];
    const agg = SV.aggregateMinuteBuckets(visits, false);
    assert.strictEqual(agg.adviceSocial, 78);
    assert.strictEqual(agg.adviceUnsocial, 0);
  });

  it('aggregateMinuteBuckets correctly subtracts waiting time', () => {
    const visits = [
      {
        timeArrival: '14:00',
        timeDeparture: '16:00',
        waitingTimeStart: '14:30',
        waitingTimeEnd: '15:00',
      },
    ];
    const agg = SV.aggregateMinuteBuckets(visits, false);
    assert.strictEqual(
      agg.adviceSocial + agg.adviceUnsocial,
      120 - 30,
      'station = 120 mins, waiting = 30 mins, advice = 90 mins'
    );
  });

  it('aggregateMinuteBuckets sums across multiple visits', () => {
    const visits = [
      { timeArrival: '10:00', timeDeparture: '11:00' },
      { timeArrival: '14:00', timeDeparture: '15:30' },
    ];
    const agg = SV.aggregateMinuteBuckets(visits, false);
    assert.strictEqual(agg.adviceSocial, 60 + 90);
  });

  it('app.js totals row is computed from visits, NOT from form fields', () => {
    const fnStart = APP_JS.indexOf('function _computeChargeableSplitFromVisits');
    assert.ok(fnStart > 0, '_computeChargeableSplitFromVisits helper must exist');
    const fnEnd = APP_JS.indexOf('\n  }\n', fnStart);
    const fnSrc = APP_JS.slice(fnStart, fnEnd);
    assert.ok(
      fnSrc.includes('aggregateMinuteBuckets'),
      'totals helper must call aggregateMinuteBuckets'
    );
    assert.ok(
      !fnSrc.includes("getFieldValue('adviceSocial')"),
      'totals helper must NOT read adviceSocial form field'
    );
    assert.ok(
      !fnSrc.includes("getFieldValue('adviceUnsocial')"),
      'totals helper must NOT read adviceUnsocial form field'
    );
  });

  it('app.js no longer derives the totals row from the adviceSocial form field', () => {
    const panelStart = APP_JS.indexOf('function updateTimeBreakdownPanel');
    assert.ok(panelStart > 0);
    const panelEnd = APP_JS.indexOf('\n  }\n', panelStart);
    const panelSrc = APP_JS.slice(panelStart, panelEnd);
    assert.ok(
      !panelSrc.includes("getFieldValue('adviceSocial')"),
      'updateTimeBreakdownPanel must not read adviceSocial directly — it should call _computeChargeableSplitFromVisits'
    );
  });

  it('manual-override note is shown when form field disagrees with auto split', () => {
    assert.ok(
      APP_JS.includes('Manual override active:'),
      'panel should surface a "Manual override active" note when the §9 fields disagree with the auto totals'
    );
    assert.ok(
      APP_JS.includes('time-breakdown-override-note'),
      'override note CSS class should be applied'
    );
  });
});

/* ---------- Fix 2: Add Firm form structure ---------- */

describe('Inline Add Firm form — labelled stacked layout', () => {
  it('uses the new add-firm-stacked container class', () => {
    assert.ok(
      APP_JS.includes('add-firm-stacked'),
      'addRow must use the new stacked container class'
    );
  });

  it('each firm field has a clear, unambiguous label string in the spec (v1.5.5)', () => {
    const block = APP_JS.slice(
      APP_JS.indexOf('var firmFields = ['),
      APP_JS.indexOf("var firmInps = {};")
    );
    for (const expected of [
      "label: 'Instructing firm name'",
      "label: 'Contact at firm (the person who instructed you)'",
      "label: 'Phone number for that contact'",
      "label: 'Email for that contact'",
    ]) {
      assert.ok(
        block.includes(expected),
        'firmFields must include ' + expected
      );
    }
    assert.ok(block.includes('required: true'), 'Firm name must be marked required');
  });

  it('v1.5.5 — Source of referral is REMOVED from the inline firm form (it is a per-matter property, not a firm property)', () => {
    const block = APP_JS.slice(
      APP_JS.indexOf('var firmFields = ['),
      APP_JS.indexOf("var firmInps = {};")
    );
    assert.ok(
      !block.includes("label: 'Source of referral'"),
      'Source of referral must NOT appear in the inline firm-form fields list'
    );
    assert.ok(
      !block.includes("id: 'afs'"),
      'The afs (Source of referral) field must be gone from the inline firm form'
    );
  });

  it('v1.5.5 — matter form still has its own Source of Referral field on §1', () => {
    assert.ok(
      APP_JS.match(/key:\s*['"]sourceOfReferral['"][^}]*label:\s*['"]Source of Referral['"]/),
      'Matter form must still expose sourceOfReferral so users have somewhere to record it'
    );
  });

  it('renders a <label> element per field via add-firm-field__label', () => {
    assert.ok(
      APP_JS.includes("lab.className = 'add-firm-field__label'"),
      'each field must render a <label> with class add-firm-field__label'
    );
    assert.ok(
      APP_JS.includes("lab.textContent = ff.label"),
      'label text must come from the field spec'
    );
  });

  it('phone quick-fill buttons (None / N/A / Not applicable) are grouped with the phone input', () => {
    const phoneBlockStart = APP_JS.indexOf("if (ff.type === 'tel')", APP_JS.indexOf('var firmInps = {};'));
    const phoneBlockEnd = APP_JS.indexOf('group.appendChild(inputRow);', phoneBlockStart);
    assert.ok(phoneBlockEnd > phoneBlockStart, 'phone block must wrap input + buttons in a single row');
    const phoneBlock = APP_JS.slice(phoneBlockStart, phoneBlockEnd);
    for (const opt of ['None', 'N/A', 'Not applicable']) {
      assert.ok(phoneBlock.includes("'" + opt + "'"), 'phone quick-fill must include ' + opt);
    }
    assert.ok(
      phoneBlock.includes("inputRow.className = 'add-firm-field__input-row'"),
      'phone input + quick-fills must be wrapped in add-firm-field__input-row'
    );
  });

  it('Add Firm is a primary button and Cancel is a secondary button', () => {
    assert.ok(
      APP_JS.includes("addBtn.className = 'btn btn-primary add-firm-actions__primary'"),
      'Add Firm must use btn-primary so it visually outranks Cancel'
    );
    assert.ok(
      APP_JS.includes("cancelBtn.className = 'btn btn-secondary add-firm-actions__cancel'"),
      'Cancel must use btn-secondary'
    );
  });
});

describe('v1.5.5 — inline firm form: Back button + intro', () => {
  it('renders a "Back" button at the top of the inline form', () => {
    assert.ok(
      APP_JS.includes("backBtn.className = 'btn-small add-firm-topbar__back'"),
      'Back button must exist with class add-firm-topbar__back'
    );
    assert.ok(
      APP_JS.includes("backBtn.innerHTML = '\\u2190 Back'"),
      'Back button must show "← Back"'
    );
  });

  it('Back button mirrors Cancel and clears the form', () => {
    assert.ok(
      APP_JS.includes('backBtn.addEventListener(\'click\', hideAddRow);'),
      'Back button must call hideAddRow (same behaviour as Cancel)'
    );
  });

  it('renders a top-bar title "Add new instructing firm" so the user knows where they are', () => {
    assert.ok(
      APP_JS.includes("topBarTitle.textContent = 'Add new instructing firm'"),
      'Top bar must display "Add new instructing firm"'
    );
  });

  it('renders a one-line intro explaining what the form is for', () => {
    assert.ok(
      APP_JS.includes("addRowIntro.className = 'add-firm-intro'"),
      'Intro paragraph must exist with class add-firm-intro'
    );
    assert.ok(
      APP_JS.includes("addRowIntro.textContent = 'Add the instructing solicitor"),
      'Intro must explain the form is for the instructing solicitor\'s firm'
    );
  });

  it('save handler no longer sends source_of_referral (since the field is gone)', () => {
    const saveBlock = APP_JS.slice(
      APP_JS.indexOf('var newFirm = {'),
      APP_JS.indexOf('addBtn.disabled = true;')
    );
    assert.ok(
      !saveBlock.includes('source_of_referral:'),
      'newFirm payload must NOT include source_of_referral (field was removed in v1.5.5)'
    );
    assert.ok(
      !saveBlock.includes('firmInps.afs'),
      'Save handler must not reference firmInps.afs (field is gone)'
    );
  });

  it('CSS defines styles for the new top-bar Back button and intro', () => {
    const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    assert.ok(stylesCss.includes('.add-firm-topbar {'), 'styles.css must define .add-firm-topbar');
    assert.ok(stylesCss.includes('.add-firm-topbar__back'), 'styles.css must define .add-firm-topbar__back');
    assert.ok(stylesCss.includes('.add-firm-intro {'), 'styles.css must define .add-firm-intro');
    assert.ok(
      stylesCss.includes('html.dark .add-firm-topbar__back'),
      'dark-mode rules must exist for the Back button'
    );
  });
});
