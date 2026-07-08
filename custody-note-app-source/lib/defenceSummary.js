'use strict';

/**
 * Defence summary panel — derive outcome, dates, venue, interview position, and advice
 * for page-1 PDF "Defence summary" block. Shared by renderer (via script tag) and node --test.
 */

var OUTCOME_CODE_BY_DECISION = {
  'Charged without Bail': 'CN06 \u2013 Charge / Summons',
  'Charged with Bail': 'CN06 \u2013 Charge / Summons',
  'Remanded in Custody': 'CN06 \u2013 Charge / Summons',
  'Released NFA': 'CN04 \u2013 No further action',
  'Simple Caution': 'CN05 \u2013 Simple caution / reprimand / warning',
  'Conditional Caution': 'CN07 \u2013 Conditional Caution',
  'Penalty Notice (PND)': 'CN08 \u2013 Fixed Penalty Notice',
  'Released Under Investigation': 'CN09 \u2013 Released no bail',
  'Bail without charge': 'CN09 \u2013 Released no bail',
  'Handed back to DSCC': 'CN01 \u2013 No further instructions',
  'NFA \u2013 no further action': 'CN04 \u2013 No further action',
  'Charged': 'CN06 \u2013 Charge / Summons',
  'Community Resolution': 'CN04 \u2013 No further action',
  'Released on pre-charge bail': 'CN09 \u2013 Released no bail',
};

function trim(val) {
  return (val == null ? '' : String(val)).trim();
}

function deriveOutcomeCode(d) {
  var explicit = trim(d.outcomeCode);
  if (explicit) return explicit;
  var decision = trim(d.outcomeDecision);
  if (!decision) return '';
  if (OUTCOME_CODE_BY_DECISION[decision]) return OUTCOME_CODE_BY_DECISION[decision];
  if (/charged/i.test(decision) || /remanded in custody/i.test(decision)) {
    return 'CN06 \u2013 Charge / Summons';
  }
  if (/NFA|no further action/i.test(decision)) return 'CN04 \u2013 No further action';
  if (/Simple Caution/i.test(decision)) return 'CN05 \u2013 Simple caution / reprimand / warning';
  if (/Conditional Caution/i.test(decision)) return 'CN07 \u2013 Conditional Caution';
  if (/Penalty Notice|PND/i.test(decision)) return 'CN08 \u2013 Fixed Penalty Notice';
  if (/Released Under Investigation|pre-charge bail|Bail without charge/i.test(decision)) {
    return 'CN09 \u2013 Released no bail';
  }
  if (/Handed back to DSCC/i.test(decision)) return 'CN01 \u2013 No further instructions';
  return '';
}

function deriveNextDateRaw(d) {
  return trim(d.courtDate) || trim(d.bailDate) || trim(d.nextDate) || trim(d.caseConcludedDate);
}

function formatIsoDate(val) {
  if (!val) return '';
  var s = String(val).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return s;
}

function deriveNextDateDisplay(d) {
  var raw = deriveNextDateRaw(d);
  if (!raw) return '';
  var datePart = formatIsoDate(raw);
  var time = '';
  if (trim(d.courtDate) && trim(d.courtTime)) time = trim(d.courtTime).slice(0, 5);
  else if (trim(d.bailDate) && trim(d.bailReturnTime)) time = trim(d.bailReturnTime).slice(0, 5);
  return time ? datePart + ' at ' + time : datePart;
}

function deriveNextVenue(d) {
  return trim(d.courtName) || trim(d.nextLocationName) || trim(d.bailReturnStationName);
}

function deriveInterviewPosition(d) {
  var legacy = trim(d.interviewApproachSummary) || trim(d.interviewApproach);
  if (legacy) return legacy;
  var decision = trim(d.clientDecision);
  var adviceRe = trim(d.adviceReInterview);
  if (decision && adviceRe && adviceRe !== decision) return decision + ' (' + adviceRe + ')';
  if (decision) return decision;
  if (adviceRe) return adviceRe;
  var quick = trim(d.reasonsForAdviceSelect);
  if (quick && quick !== 'Other \u2013 see notes below') {
    var dash = quick.indexOf(' \u2013 ');
    return dash >= 0 ? quick.slice(0, dash) : quick;
  }
  return '';
}

function deriveHeadlineAdvice(d) {
  var s = trim(d.adviceGivenSummary) ||
    trim(d.reasonsForAdviceSelect) ||
    trim(d.reasonsForAdvice) ||
    trim(d.adviceGiven) ||
    trim(d.adviceSummary) ||
    trim(d.telephoneAdviceSummary);
  if (!s) return '';
  var firstLine = s.split(/\n|\.[\s]/)[0].trim();
  return firstLine.length > 220 ? firstLine.slice(0, 217) + '\u2026' : firstLine;
}

function buildDefenceSummaryFields(d) {
  d = d || {};
  return {
    outcome: trim(d.outcomeDecision),
    outcomeCode: deriveOutcomeCode(d),
    nextDate: deriveNextDateDisplay(d),
    nextVenue: deriveNextVenue(d),
    interviewPosition: deriveInterviewPosition(d),
    headlineAdvice: deriveHeadlineAdvice(d),
  };
}

function buildDefenceSummaryHtml(d, esc) {
  esc = esc || function(s) { return String(s == null ? '' : s); };
  var fields = buildDefenceSummaryFields(d);
  function it(label, val, wide) {
    var v = (val == null || val === '') ? '<span class="ds-empty">not recorded</span>' : esc(String(val));
    return '<div class="ds-item' + (wide ? ' ds-wide' : '') + '"><strong>' + esc(label) + ':</strong> ' + v + '</div>';
  }
  return '<div class="def-summary"><h3>Defence summary</h3><div class="ds-grid">' +
    it('Outcome', fields.outcome) +
    it('Outcome code', fields.outcomeCode) +
    it('Next date', fields.nextDate) +
    it('Next venue', fields.nextVenue) +
    it('Interview position', fields.interviewPosition) +
    it('Headline advice', fields.headlineAdvice, true) +
    (trim(d.outcomeNotes) ? it('Outcome notes', d.outcomeNotes, true) : '') +
  '</div></div>';
}

var DefenceSummary = {
  OUTCOME_CODE_BY_DECISION: OUTCOME_CODE_BY_DECISION,
  deriveOutcomeCode: deriveOutcomeCode,
  deriveNextDateRaw: deriveNextDateRaw,
  deriveNextDateDisplay: deriveNextDateDisplay,
  deriveNextVenue: deriveNextVenue,
  deriveInterviewPosition: deriveInterviewPosition,
  deriveHeadlineAdvice: deriveHeadlineAdvice,
  buildDefenceSummaryFields: buildDefenceSummaryFields,
  buildDefenceSummaryHtml: buildDefenceSummaryHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DefenceSummary;
}
if (typeof window !== 'undefined') {
  window.DefenceSummary = DefenceSummary;
}
