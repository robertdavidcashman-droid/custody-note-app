'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ds = require('../lib/defenceSummary');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('defenceSummary — Charged without Bail custody attendance', () => {
  const chargedWithoutBail = {
    outcomeDecision: 'Charged without Bail',
    courtDate: '2026-06-10',
    courtTime: '10:30',
    courtName: 'Sheffield Magistrates\' Court',
    clientDecision: 'Answer questions',
    reasonsForAdviceSelect: 'Answer questions \u2013 client admits, full cooperation',
    reasonsForAdvice: 'Answer questions \u2013 client admits, full cooperation',
  };

  it('derives CN06 outcome code when outcomeCode field is empty', () => {
    assert.strictEqual(ds.deriveOutcomeCode(chargedWithoutBail), 'CN06 \u2013 Charge / Summons');
  });

  it('uses court date (and time) for next date', () => {
    assert.strictEqual(ds.deriveNextDateDisplay(chargedWithoutBail), '10/06/2026 at 10:30');
  });

  it('uses court name for next venue', () => {
    assert.strictEqual(ds.deriveNextVenue(chargedWithoutBail), 'Sheffield Magistrates\' Court');
  });

  it('uses client decision for interview position', () => {
    assert.strictEqual(ds.deriveInterviewPosition(chargedWithoutBail), 'Answer questions');
  });

  it('uses reasonsForAdviceSelect for headline advice when detail is present', () => {
    assert.strictEqual(
      ds.deriveHeadlineAdvice(chargedWithoutBail),
      'Answer questions \u2013 client admits, full cooperation'
    );
  });

  it('buildDefenceSummaryHtml does not show "not recorded" for populated charged-without-bail fields', () => {
    const html = ds.buildDefenceSummaryHtml(chargedWithoutBail, function(s) { return s; });
    assert.match(html, /Outcome code.*CN06/);
    assert.match(html, /Next date.*10\/06\/2026/);
    assert.match(html, /Next venue.*Sheffield/);
    assert.match(html, /Interview position.*Answer questions/);
    assert.doesNotMatch(html, /Outcome code:.*not recorded/);
    assert.doesNotMatch(html, /Next date:.*not recorded/);
    assert.doesNotMatch(html, /Interview position:.*not recorded/);
  });
});

describe('defenceSummary — LAA outcome mapping (bail must never be CN09)', () => {
  it('maps Released Under Investigation to CN09', () => {
    assert.strictEqual(
      ds.deriveOutcomeCode({ outcomeDecision: 'Released Under Investigation' }),
      'CN09 \u2013 Released no bail'
    );
  });

  it('maps Released NFA to CN04', () => {
    assert.strictEqual(
      ds.deriveOutcomeCode({ outcomeDecision: 'Released NFA' }),
      'CN04 \u2013 No further action'
    );
  });

  it('maps Charged with Bail / Charged without Bail / Charged / Remanded to CN06', () => {
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Charged with Bail' }), 'CN06 \u2013 Charge / Summons');
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Charged without Bail' }), 'CN06 \u2013 Charge / Summons');
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Charged' }), 'CN06 \u2013 Charge / Summons');
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Remanded in Custody' }), 'CN06 \u2013 Charge / Summons');
  });

  it('does NOT map Bail without charge or Released on pre-charge bail to CN09', () => {
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Bail without charge' }), '');
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Released on pre-charge bail' }), '');
    assert.ok(!/CN09/.test(ds.suggestOutcomeCodeForDecision('Bail without charge')));
    assert.ok(!/CN09/.test(ds.suggestOutcomeCodeForDecision('Released on pre-charge bail')));
    assert.ok(!/CN09/.test(ds.suggestOutcomeCodeForDecision('Charged with Bail')));
  });

  it('maps Simple Caution / youth caution to CN05 and Conditional Caution to CN07', () => {
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Simple Caution' }), 'CN05 \u2013 Simple caution / reprimand / warning');
    assert.strictEqual(
      ds.deriveOutcomeCode({ outcomeDecision: 'Youth caution / Youth conditional caution' }),
      'CN05 \u2013 Simple caution / reprimand / warning'
    );
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Conditional Caution' }), 'CN07 \u2013 Conditional Caution');
  });

  it('maps Penalty Notice (PND) to CN08', () => {
    assert.strictEqual(
      ds.deriveOutcomeCode({ outcomeDecision: 'Penalty Notice (PND)' }),
      'CN08 \u2013 Fixed Penalty Notice'
    );
  });
});

describe('defenceSummary — outcome code vs decision mismatch errors', () => {
  it('errors when Bail without charge / pre-charge bail / Charged with Bail is paired with CN09', () => {
    for (const decision of ['Bail without charge', 'Released on pre-charge bail', 'Charged with Bail']) {
      const err = ds.getOutcomeCodeMismatchError(decision, 'CN09 \u2013 Released no bail');
      assert.ok(err, 'expected mismatch for ' + decision);
      assert.match(err, /CN09/);
      assert.match(err, /bail/i);
    }
  });

  it('errors when first-grant bail is paired with charge / NFA / caution leftovers', () => {
    for (const decision of ['Bail without charge', 'Released on pre-charge bail']) {
      for (const code of [
        'CN06 \u2013 Charge / Summons',
        'CN04 \u2013 No further action',
        'CN05 \u2013 Simple caution / reprimand / warning',
        'CN07 \u2013 Conditional Caution',
        'CN08 \u2013 Fixed Penalty Notice',
        'CN09 \u2013 Released no bail',
      ]) {
        const err = ds.getOutcomeCodeMismatchError(decision, code);
        assert.ok(err, 'expected mismatch for ' + decision + ' + ' + code);
        assert.match(err, /first grant|no LAA investigation/i);
      }
    }
  });

  it('does not error when RUI is correctly CN09', () => {
    assert.strictEqual(
      ds.getOutcomeCodeMismatchError('Released Under Investigation', 'CN09 \u2013 Released no bail'),
      ''
    );
  });

  it('does not error when Charged with Bail is correctly CN06', () => {
    assert.strictEqual(
      ds.getOutcomeCodeMismatchError('Charged with Bail', 'CN06 \u2013 Charge / Summons'),
      ''
    );
  });

  it('does not error when Bail without charge has no outcome code yet', () => {
    assert.strictEqual(ds.getOutcomeCodeMismatchError('Bail without charge', ''), '');
  });

  it('errors when Charged is paired with CN09', () => {
    const err = ds.getOutcomeCodeMismatchError('Charged', 'CN09');
    assert.ok(err);
    assert.match(err, /CN06|charge/i);
  });

  it('errors when NFA is paired with CN09', () => {
    const err = ds.getOutcomeCodeMismatchError('Released NFA', 'CN09 \u2013 Released no bail');
    assert.ok(err);
    assert.match(err, /CN04|NFA/i);
  });

  it('errors when CN10/CN11 used for first grant of police bail', () => {
    const err = ds.getOutcomeCodeMismatchError('Bail without charge', 'CN10 \u2013 Bail varied / extended');
    assert.ok(err);
    assert.match(err, /INVK|vary|extend/i);
  });
});

describe('defenceSummary — resolveOutcomeCodeOnDecisionChange (stale code clear)', () => {
  it('Charged → CN06, then Bail without charge clears leftover CN06', () => {
    const afterCharge = ds.resolveOutcomeCodeOnDecisionChange('Charged', '');
    assert.strictEqual(afterCharge, 'CN06 \u2013 Charge / Summons');
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Bail without charge', afterCharge),
      ''
    );
  });

  it('clears CN04 / CN05 / CN09 leftovers when switching to first-grant bail', () => {
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Bail without charge', 'CN04 \u2013 No further action'),
      ''
    );
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Released on pre-charge bail', 'CN05 \u2013 Simple caution / reprimand / warning'),
      ''
    );
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Bail without charge', 'CN09 \u2013 Released no bail'),
      ''
    );
  });

  it('Charged with Bail still resolves to CN06 (does not clear)', () => {
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Charged with Bail', 'CN06 \u2013 Charge / Summons'),
      'CN06 \u2013 Charge / Summons'
    );
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Charged with Bail', ''),
      'CN06 \u2013 Charge / Summons'
    );
  });

  it('RUI still resolves to CN09', () => {
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Released Under Investigation', ''),
      'CN09 \u2013 Released no bail'
    );
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Released Under Investigation', 'CN06 \u2013 Charge / Summons'),
      'CN09 \u2013 Released no bail'
    );
  });

  it('preserves a manually entered non-CN value when switching decision', () => {
    assert.strictEqual(
      ds.resolveOutcomeCodeOnDecisionChange('Charged', 'Custom firm note'),
      'Custom firm note'
    );
  });
});

describe('defenceSummary — fallbacks and explicit values', () => {
  it('prefers explicit outcomeCode over derived value', () => {
    assert.strictEqual(
      ds.deriveOutcomeCode({ outcomeDecision: 'Charged without Bail', outcomeCode: 'CN06 \u2013 Charge / Summons' }),
      'CN06 \u2013 Charge / Summons'
    );
  });

  it('falls back to bailDate and bailReturnStationName without inventing CN09', () => {
    const data = {
      outcomeDecision: 'Bail without charge',
      bailDate: '2026-07-01',
      bailReturnTime: '09:00',
      bailReturnStationName: 'Holbeck Police Station',
    };
    assert.strictEqual(ds.deriveNextDateDisplay(data), '01/07/2026 at 09:00');
    assert.strictEqual(ds.deriveNextVenue(data), 'Holbeck Police Station');
    assert.strictEqual(ds.deriveOutcomeCode(data), '');
  });

  it('uses nextLocationName when court name is absent', () => {
    assert.strictEqual(
      ds.deriveNextVenue({ nextLocationName: 'Leeds Crown Court' }),
      'Leeds Crown Court'
    );
  });

  it('derives interview position from adviceReInterview when clientDecision is empty', () => {
    assert.strictEqual(
      ds.deriveInterviewPosition({ adviceReInterview: 'No comment' }),
      'No comment'
    );
  });

  it('maps telephone Charged outcome to CN06', () => {
    assert.strictEqual(ds.deriveOutcomeCode({ outcomeDecision: 'Charged' }), 'CN06 \u2013 Charge / Summons');
  });
});

describe('defenceSummary — app wiring', () => {
  it('index.html loads lib/defenceSummary.js before app.js', () => {
    const dsIdx = indexHtml.indexOf('src="lib/defenceSummary.js"');
    const appIdx = indexHtml.indexOf('src="app.js"');
    assert.ok(dsIdx !== -1, 'expected lib/defenceSummary.js script tag');
    assert.ok(appIdx !== -1, 'expected app.js script tag');
    assert.ok(dsIdx < appIdx, 'defenceSummary.js must load before app.js');
  });

  it('lib/defenceSummary.js uses browser-safe export', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'defenceSummary.js'), 'utf8');
    assert.match(src, /typeof module !== 'undefined' && module\.exports/);
    assert.match(src, /window\.DefenceSummary = DefenceSummary/);
  });

  it('app.js pdfDefenceSummaryHtml delegates to DefenceSummary module', () => {
    assert.match(appJs, /window\.DefenceSummary/);
    assert.match(appJs, /buildDefenceSummaryHtml/);
    assert.match(appJs, /getDefenceSummaryFields/);
  });

  it('telephone and voluntary outcomeCode dropdowns include CN12 and CN13', () => {
    assert.match(appJs, /CN12 \\u2013 Pre-charge engagement agreed/);
    assert.match(appJs, /CN13 \\u2013 Pre-charge engagement not agreed/);
  });

  it('suggested OUTCOME_CODE_BY_DECISION labels match telephone and voluntary select options exactly', () => {
    const map = ds.OUTCOME_CODE_BY_DECISION;
    const mustMatch = [
      map['Conditional Caution'],
      map['Penalty Notice (PND)'],
      map['Handed back to DSCC'],
      map['Released NFA'],
      map['Simple Caution'],
      map['Charged'],
    ];
    for (const label of mustMatch) {
      assert.ok(label, 'expected mapped label');
      /* Escaped unicode en-dash as written in app.js option arrays */
      const escaped = label.replace(/\u2013/g, '\\u2013');
      assert.ok(
        appJs.includes("'" + escaped + "'") || appJs.includes(escaped),
        'expected app.js option string to match mapped label: ' + label
      );
    }
    /* Voluntary options must use Title Case CN07/CN08 (not "Conditional caution") and include CN01 */
    assert.match(appJs, /CN07 \\u2013 Conditional Caution/);
    assert.match(appJs, /CN08 \\u2013 Fixed Penalty Notice/);
    assert.doesNotMatch(appJs, /CN07 \\u2013 Conditional caution/);
    assert.doesNotMatch(appJs, /CN08 \\u2013 Fixed penalty notice/);
    assert.ok(
      (appJs.match(/CN01 \\u2013 No further instructions/g) || []).length >= 2,
      'telephone and voluntary dropdowns both need CN01'
    );
  });

  it('finalise validators call pushOutcomeCodeMismatchError', () => {
    assert.match(appJs, /function pushOutcomeCodeMismatchError/);
    assert.match(appJs, /pushOutcomeCodeMismatchError\(m, 2\)/);
    assert.match(appJs, /pushOutcomeCodeMismatchError\(m, 7\)/);
  });

  it('outcomeDecision change resolves LAA code via DefenceSummary (clears stale on first-grant bail)', () => {
    assert.match(appJs, /resolveOutcomeCodeOnDecisionChange/);
  });
});
