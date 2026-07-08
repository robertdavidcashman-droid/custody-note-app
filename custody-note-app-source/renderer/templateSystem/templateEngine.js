/* ═══════════════════════════════════════════════════════
   TEMPLATE SYSTEM — Engine
   Pure functions: no DOM, no globals written.
   Token format: [KEY]  (uppercase, A-Z 0-9 _)
   ═══════════════════════════════════════════════════════ */

var _TPL_REGEX = /\[([A-Z0-9_]+)\]/g;

/* ── Helpers ──────────────────────────────────────────── */

function _tplClean(val) {
  return (val == null || val === 'null' || val === 'undefined') ? '' : String(val).trim();
}

function _tplFmtDate(input) {
  if (!input) return '';
  var s = _tplClean(input);
  if (!s) return '';
  /* ISO yyyy-mm-dd */
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    var d = parseInt(iso[3], 10);
    var m = parseInt(iso[2], 10) - 1;
    var y = parseInt(iso[1], 10);
    return d + ' ' + months[m] + ' ' + y;
  }
  /* dd/mm/yyyy already formatted */
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return s;
  return s;
}

function _tplFmtTime(input) {
  if (!input) return '';
  var s = _tplClean(input);
  /* Already HH:MM */
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  return s;
}

/** Build a single-line address from split form fields (attendance record). */
function _tplFormatAddress(r) {
  r = r || {};
  var parts = [
    r.address1, r.address2, r.address3, r.city, r.county, r.postCode
  ].map(function(x) { return _tplClean(x); }).filter(Boolean);
  if (parts.length) return parts.join(', ');
  return _tplClean(r.address || r.clientAddress || '');
}

/** Disclosure / advice text: map actual schema keys to template placeholders. */
function _tplDisclosureSummary(r) {
  r = r || {};
  return _tplClean(r.disclosureNarrative || r.disclosureSummary || '');
}

function _tplAdviceGiven(r) {
  r = r || {};
  var parts = [
    _tplClean(r.adviceGiven),
    _tplClean(r.adviceReInterview),
    _tplClean(r.reasonsForAdvice)
  ].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  return '';
}

/* ── Public API ───────────────────────────────────────── */

/**
 * Build a placeholder data map from record / settings data.
 * Pass anything you have — missing fields become empty strings.
 * @param {object} opts
 * @param {object} [opts.record]   Attendance record fields
 * @param {object} [opts.settings] App settings (_appSettingsCache)
 * @param {Date}   [opts.now]      Override for today/now
 * @returns {object} Plain key→value map for tplRender()
 */
function tplBuildData(opts) {
  opts = opts || {};
  var r = opts.record   || {};
  var s = opts.settings || {};
  var now = opts.now instanceof Date ? opts.now : new Date();

  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var todayStr = now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var nowTimeStr = hh + ':' + mm;

  var firstName = _tplClean(r.forename  || r.firstName  || r.client_first_name || '');
  var lastName  = _tplClean(r.surname   || r.lastName   || r.client_last_name  || '');
  var fullName  = _tplClean(r.clientName || r.full_name || '') ||
                  [firstName, lastName].filter(Boolean).join(' ');

  /* Parse officer rank from oicName field ("DC Jones" → rank "DC", surname "Jones") */
  var oicRaw  = _tplClean(r.oicName || '');
  var oicRank = '', oicSurname = oicRaw;
  var _RANKS = ['Det Ch Supt','Det Ch Insp','Det Supt','Det Insp','Det Sgt','Det Con',
                'Ch Supt','Ch Insp','Supt','Insp','Sgt','Con',
                'DCI','DCS','DI','DS','DC','PC','PS','CI','ACC','DCC','CC','PCSO','Cst'];
  for (var ri = 0; ri < _RANKS.length; ri++) {
    var rk = _RANKS[ri];
    if (oicRaw.toLowerCase().indexOf(rk.toLowerCase() + ' ') === 0) {
      oicRank = rk;
      oicSurname = oicRaw.slice(rk.length).trim();
      break;
    }
  }

  return {
    CLIENT_NAME:        fullName,
    CLIENT_FIRST_NAME:  firstName,
    CLIENT_LAST_NAME:   lastName,
    DOB:                _tplFmtDate(_tplClean(r.dob || r.dateOfBirth || '')),
    CLIENT_ADDRESS:     _tplFormatAddress(r),
    CLIENT_PHONE:       _tplClean(r.clientPhone || r.phone || ''),
    CLIENT_EMAIL:       _tplClean(r.clientEmail || r.email || ''),

    CASE_REFERENCE:     _tplClean(r.ourFileNumber || r.fileReference || r.caseReference || ''),
    CUSTODY_REFERENCE:  _tplClean(r.custodyReference || r.dsccRef || r.custodyNumber || r.crn || r.ufn || ''),
    POLICE_STATION:     _tplClean(r.policeStationName || r.policeStation || r.otherLocation || ''),
    OFFICER_NAME:       oicRaw,
    OFFICER_RANK:       oicRank,

    INTERVIEW_DATE:     _tplFmtDate(_tplClean(r.date || r.interviewDate || r.instructionDateTime || '')),
    INTERVIEW_TIME:     _tplFmtTime(_tplClean(r.timeArrival || r.interviewTime || '')),
    ARREST_DATE:        _tplFmtDate(_tplClean(r.arrestDate || '')),
    ARREST_TIME:        _tplFmtTime(_tplClean(r.arrestTime || '')),
    BAIL_RETURN_DATE:   _tplFmtDate(_tplClean(r.bailDate || r.bailReturnDate || '')),
    BAIL_CONDITIONS:    _tplClean(r.bailConditions || ''),
    ALLEGATION:         _tplClean(r.offenceSummary || r.allegation || ''),
    DISCLOSURE_SUMMARY: _tplDisclosureSummary(r),
    ADVICE_GIVEN:       _tplAdviceGiven(r),

    SOLICITOR_NAME:     _tplClean(r.feeEarnerName || r.laaFeeEarnerFullName || s.feeEarnerNameDefault || ''),
    SOLICITOR_EMAIL:    _tplClean(s.feeEarnerEmail || s.solicitorEmail || ''),
    SOLICITOR_PHONE:    _tplClean(s.feeEarnerPhone || s.solicitorPhone || ''),
    FIRM_NAME:          _tplClean(r.firmName || s.firmName || ''),

    TODAY_DATE:         todayStr,
    NOW_TIME:           nowTimeStr
  };
}

/**
 * Replace all [KEY] tokens in a template string using the data map.
 * @param {string} template
 * @param {object} data      Key→value map from tplBuildData()
 * @param {object} [opts]
 * @param {'blank'|'keep'|'warn'} [opts.missing='blank']
 * @returns {string}
 */
function tplRender(template, data, opts) {
  data = data || {};
  opts = opts || {};
  var mode = opts.missing || 'blank';

  return String(template || '').replace(_TPL_REGEX, function(_, rawKey) {
    var val = data[rawKey];
    if (val != null && String(val).trim() !== '') return String(val);
    if (mode === 'keep') return '[' + rawKey + ']';
    if (mode === 'warn') return '⚠ [' + rawKey + ']';
    return '';
  });
}

/**
 * Extract unique [KEY] tokens from a template string.
 * @param {string} text
 * @returns {string[]}
 */
function tplFindPlaceholders(text) {
  var seen = {};
  var result = [];
  var m;
  var re = /\[([A-Z0-9_]+)\]/g;
  while ((m = re.exec(String(text || ''))) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = true; result.push(m[1]); }
  }
  return result;
}

/**
 * Validate a template against a data map.
 * Returns lists of all placeholders found and which are missing data.
 * @param {string} template
 * @param {object} data
 * @returns {{ placeholders: string[], missing: string[] }}
 */
function tplValidate(template, data) {
  data = data || {};
  var found = tplFindPlaceholders(template);
  var missing = found.filter(function(key) {
    var v = data[key];
    return v == null || String(v).trim() === '';
  });
  return { placeholders: found, missing: missing };
}
