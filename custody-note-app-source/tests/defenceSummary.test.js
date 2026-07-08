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

describe('defenceSummary — fallbacks and explicit values', () => {
  it('prefers explicit outcomeCode over derived value', () => {
    assert.strictEqual(
      ds.deriveOutcomeCode({ outcomeDecision: 'Charged without Bail', outcomeCode: 'CN06 \u2013 Charge / Summons' }),
      'CN06 \u2013 Charge / Summons'
    );
  });

  it('falls back to bailDate and bailReturnStationName', () => {
    const data = {
      outcomeDecision: 'Bail without charge',
      bailDate: '2026-07-01',
      bailReturnTime: '09:00',
      bailReturnStationName: 'Holbeck Police Station',
    };
    assert.strictEqual(ds.deriveNextDateDisplay(data), '01/07/2026 at 09:00');
    assert.strictEqual(ds.deriveNextVenue(data), 'Holbeck Police Station');
    assert.strictEqual(ds.deriveOutcomeCode(data), 'CN09 \u2013 Released no bail');
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
});
