'use strict';

/**
 * Defence summary panel — derive outcome, dates, venue, interview position, and advice
 * for page-1 PDF "Defence summary" block. Shared by renderer (via script tag) and node --test.
 *
 * Outcome codes follow LAA Crime Lower investigation outcomes
 * (Guidance for Reporting Crime Lower Work). CN09 is Released – No Bail only
 * (RUI / released WITHOUT bail). First grant of police bail must never map to CN09.
 * CN10/CN11 are for vary/extend bail applications (INVK/INVL), not first grant.
 */

var OUTCOME_CODE_BY_DECISION = {
  'Charged without Bail': 'CN06 \u2013 Charge / Summons',
  'Charged with Bail': 'CN06 \u2013 Charge / Summons',
  'Remanded in Custody': 'CN06 \u2013 Charge / Summons',
  'Released NFA': 'CN04 \u2013 No further action',
  'Simple Caution': 'CN05 \u2013 Simple caution / reprimand / warning',
  'Youth caution / Youth conditional caution': 'CN05 \u2013 Simple caution / reprimand / warning',
  'Conditional Caution': 'CN07 \u2013 Conditional Caution',
  'Penalty Notice (PND)': 'CN08 \u2013 Fixed Penalty Notice',
  'Released Under Investigation': 'CN09 \u2013 Released no bail',
  'Handed back to DSCC': 'CN01 \u2013 No further instructions',
  'NFA \u2013 no further action': 'CN04 \u2013 No further action',
  'Charged': 'CN06 \u2013 Charge / Summons',
  'Community Resolution': 'CN04 \u2013 No further action',
  /* Bail without charge / Released on pre-charge bail: no CN auto-code.
     First grant of police bail is not CN09 (RUI / no bail) and not CN10/CN11. */
};

/** Decisions that must never be paired with CN09 (client is / remains on bail). */
var CN09_FORBIDDEN_DECISIONS = [
  'Bail without charge',
  'Released on pre-charge bail',
  'Charged with Bail',
];

/** First grant of police bail — no LAA investigation CN code applies. */
var FIRST_GRANT_POLICE_BAIL_DECISIONS = [
  'Bail without charge',
  'Released on pre-charge bail',
];

/** Codes that must not sit on a first-grant bail matter (no matching first-grant CN). */
var FIRST_GRANT_BAIL_FORBIDDEN_CODE_PREFIXES = [
  'CN04', 'CN05', 'CN06', 'CN07', 'CN08', 'CN09',
];

function trim(val) {
  return (val == null ? '' : String(val)).trim();
}

function extractOutcomeCodePrefix(code) {
  var m = trim(code).match(/^CN(\d{2})\b/i);
  return m ? ('CN' + m[1]) : '';
}

function isCn09ForbiddenDecision(decision) {
  var d = trim(decision);
  if (!d) return false;
  if (CN09_FORBIDDEN_DECISIONS.indexOf(d) !== -1) return true;
  if (/^Charged with Bail$/i.test(d)) return true;
  if (/Bail without charge/i.test(d)) return true;
  if (/Released on pre-charge bail/i.test(d)) return true;
  return false;
}

function isFirstGrantPoliceBailDecision(decision) {
  var d = trim(decision);
  if (!d) return false;
  if (FIRST_GRANT_POLICE_BAIL_DECISIONS.indexOf(d) !== -1) return true;
  if (/Bail without charge/i.test(d)) return true;
  if (/Released on pre-charge bail/i.test(d)) return true;
  return false;
}

function isKnownSuggestedOutcomeCode(code) {
  var c = trim(code);
  if (!c) return false;
  var keys = Object.keys(OUTCOME_CODE_BY_DECISION);
  for (var i = 0; i < keys.length; i++) {
    if (OUTCOME_CODE_BY_DECISION[keys[i]] === c) return true;
  }
  return /^CN\d{2}\b/i.test(c);
}

/**
 * Returns an error message when outcomeCode conflicts with outcomeDecision, else ''.
 * Only reports pairs that are actually wrong under LAA rules (not mere style differences).
 */
function getOutcomeCodeMismatchError(decision, code) {
  var d = trim(decision);
  var prefix = extractOutcomeCodePrefix(code);
  if (!d || !prefix) return '';

  /* First-grant bail has no investigation CN — reject charge / NFA / caution / RUI leftovers. */
  if (isFirstGrantPoliceBailDecision(d) && FIRST_GRANT_BAIL_FORBIDDEN_CODE_PREFIXES.indexOf(prefix) !== -1) {
    return 'First grant of police bail (' + d + ') has no LAA investigation outcome code. Remove ' + prefix + ' (or leave Outcome code blank)';
  }

  if (prefix === 'CN09' && isCn09ForbiddenDecision(d)) {
    return 'CN09 is Released \u2013 No Bail (RUI / released without bail only). It must not be used when the client is on bail (' + d + ')';
  }

  if (prefix === 'CN09' && (/^Charged\b/i.test(d) || /Remanded in Custody/i.test(d))) {
    return 'CN09 (Released \u2013 No Bail) does not match a charge/remand outcome (' + d + '). Use CN06';
  }

  if (prefix === 'CN09' && (/Released NFA/i.test(d) || /^NFA\b/i.test(d) || /no further action/i.test(d))) {
    return 'CN09 (Released \u2013 No Bail) does not match NFA. Use CN04';
  }

  var expectedLabel = OUTCOME_CODE_BY_DECISION[d];
  if (expectedLabel) {
    var expected = extractOutcomeCodePrefix(expectedLabel);
    if (expected && prefix !== expected) {
      /* Known definite mismatches only — e.g. Charged* must be CN06, NFA must be CN04 */
      if (expected === 'CN06' && prefix === 'CN09') {
        return 'Outcome code CN09 does not match ' + d + ' (expected CN06)';
      }
      if (expected === 'CN04' && prefix === 'CN09') {
        return 'Outcome code CN09 does not match ' + d + ' (expected CN04)';
      }
      if (expected === 'CN06' && (prefix === 'CN04' || prefix === 'CN05' || prefix === 'CN07' || prefix === 'CN08' || prefix === 'CN09')) {
        return 'Outcome code ' + prefix + ' does not match ' + d + ' (expected CN06)';
      }
      if (expected === 'CN04' && (prefix === 'CN06' || prefix === 'CN09')) {
        return 'Outcome code ' + prefix + ' does not match ' + d + ' (expected CN04)';
      }
      if (expected === 'CN09' && (prefix === 'CN06' || prefix === 'CN10' || prefix === 'CN11')) {
        return 'Outcome code ' + prefix + ' does not match Released Under Investigation (expected CN09)';
      }
    }
  }

  if ((prefix === 'CN10' || prefix === 'CN11') && isCn09ForbiddenDecision(d)) {
    return prefix + ' is only for vary/extend bail applications (INVK/INVL), not first grant of police bail (' + d + ')';
  }

  return '';
}

/**
 * When the user changes outcomeDecision, return the outcomeCode that should be stored.
 * Clears any leftover suggested LAA code when switching to first-grant bail (no CN applies).
 * Preserves a manually entered non-CN value.
 */
function resolveOutcomeCodeOnDecisionChange(decision, prevCode) {
  var suggested = suggestOutcomeCodeForDecision(decision);
  var prev = trim(prevCode);
  var prevWasSuggested = !prev || isKnownSuggestedOutcomeCode(prev);

  if (suggested && (!prev || prevWasSuggested)) {
    return suggested;
  }
  if (!suggested && prev && isFirstGrantPoliceBailDecision(decision) && isKnownSuggestedOutcomeCode(prev)) {
    return '';
  }
  return prev;
}

function deriveOutcomeCode(d) {
  var explicit = trim(d.outcomeCode);
  if (explicit) return explicit;
  var decision = trim(d.outcomeDecision);
  if (!decision) return '';
  if (Object.prototype.hasOwnProperty.call(OUTCOME_CODE_BY_DECISION, decision)) {
    return OUTCOME_CODE_BY_DECISION[decision] || '';
  }
  if (/charged/i.test(decision) || /remanded in custody/i.test(decision)) {
    return 'CN06 \u2013 Charge / Summons';
  }
  if (/NFA|no further action/i.test(decision)) return 'CN04 \u2013 No further action';
  if (/Youth caution/i.test(decision) || /Simple Caution/i.test(decision)) {
    return 'CN05 \u2013 Simple caution / reprimand / warning';
  }
  if (/Conditional Caution/i.test(decision)) return 'CN07 \u2013 Conditional Caution';
  if (/Penalty Notice|PND/i.test(decision)) return 'CN08 \u2013 Fixed Penalty Notice';
  /* CN09 only for RUI / released without bail — never for bail outcomes */
  if (/Released Under Investigation/i.test(decision) || /Released\s*[–—-]?\s*No Bail/i.test(decision)) {
    return 'CN09 \u2013 Released no bail';
  }
  if (/Handed back to DSCC/i.test(decision)) return 'CN01 \u2013 No further instructions';
  return '';
}

/**
 * Suggested code label for a decision when the field is empty (auto-fill).
 * Returns '' when LAA has no matching investigation outcome (e.g. first police bail).
 */
function suggestOutcomeCodeForDecision(decision) {
  return deriveOutcomeCode({ outcomeDecision: decision, outcomeCode: '' });
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
  CN09_FORBIDDEN_DECISIONS: CN09_FORBIDDEN_DECISIONS,
  FIRST_GRANT_POLICE_BAIL_DECISIONS: FIRST_GRANT_POLICE_BAIL_DECISIONS,
  FIRST_GRANT_BAIL_FORBIDDEN_CODE_PREFIXES: FIRST_GRANT_BAIL_FORBIDDEN_CODE_PREFIXES,
  extractOutcomeCodePrefix: extractOutcomeCodePrefix,
  isCn09ForbiddenDecision: isCn09ForbiddenDecision,
  isFirstGrantPoliceBailDecision: isFirstGrantPoliceBailDecision,
  isKnownSuggestedOutcomeCode: isKnownSuggestedOutcomeCode,
  getOutcomeCodeMismatchError: getOutcomeCodeMismatchError,
  resolveOutcomeCodeOnDecisionChange: resolveOutcomeCodeOnDecisionChange,
  deriveOutcomeCode: deriveOutcomeCode,
  suggestOutcomeCodeForDecision: suggestOutcomeCodeForDecision,
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
