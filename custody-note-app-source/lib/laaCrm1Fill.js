'use strict';

/**
 * CRM1 (Legal Aid Means / Client Details) official PDF prefill.
 *
 * Extracted from main.js so the field mapping is unit-testable: tests can load
 * the real `crm1-v16-feb-2025.pdf`, run `fillCRM1`, then read the AcroForm
 * fields back to assert the correct boxes are ticked.
 *
 * Field names below were verified against the actual v16 template by matching
 * each widget rectangle to the printed label position (see git history for the
 * extraction). Earlier guesses had the gender/marital block shuffled by one
 * box and the two benefit questions swapped, which ticked the wrong boxes.
 *
 * CRM1 v16 page-1 layout (verified):
 *   Marital status:  Single=CheckBox87  Married/Civil Partner=Married  Cohabiting=CheckBox1
 *                    Separated=Separated  Divorced/dissolved CP=Divorced  Widowed=CheckBox89
 *   Gender:          Male=CheckBox11  Female=CheckBox12  Prefer not to say=CheckBox14
 *
 * CRM1 v16 page-7 layout (verified, three yes/no questions top -> bottom):
 *   Q1 Under 18?                            Yes='Client under 18 checkbox'   No='Client not under 18 checkbox'
 *   Q2 Guarantee Pension Credit / UC?       Yes=CheckBox10                    No=CheckBox9
 *   Q3 Other passporting (gross <= £14,213) Yes=CheckBox13                    No=CheckBox6
 *   If Q2 or Q3 = Yes the rest is passported; otherwise give weekly income.
 */

/* Per-render accumulator of "field not found" misses, so the caller can warn the
 * user that the template may have changed rather than shipping a blank PDF. */
let _accumulator = null;
function _recordMiss(fieldName, kind, err) {
  if (!_accumulator) return;
  try {
    _accumulator.push({ field: fieldName, kind: kind, error: err && err.message ? err.message : String(err) });
  } catch (_) {}
}

function safeSet(form, fieldName, value) {
  if (value === undefined || value === null) return;
  const t = String(value);
  if (t === '') return;
  try { form.getTextField(fieldName).setText(t); }
  catch (err) { _recordMiss(fieldName, 'text', err); }
}

function safeClearText(form, fieldName) {
  try { form.getTextField(fieldName).setText(''); } catch (_) {}
}

function safeCheck(form, fieldName, condition) {
  if (!condition) return;
  try { form.getCheckBox(fieldName).check(); }
  catch (err) { _recordMiss(fieldName, 'checkbox', err); }
}

function safeUncheck(form, fieldName) {
  try { form.getCheckBox(fieldName).uncheck(); } catch (_) {}
}

function fmtDateDMY(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(val);
}

/** UK NI for PDF: strip spaces, uppercase (matches in-app validation AB123456C). */
function normalizeNiNumberForPdf(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/\s+/g, '').toUpperCase();
}

/** CRM1 income section: stored gross annual (£) -> weekly. */
function poundsAnnualToWeeklyOrEmpty(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = parseFloat(String(val).replace(/,/g, ''));
  if (!Number.isFinite(n)) return '';
  return String(Math.round((n / 52) * 100) / 100);
}

/** CRM1 page 7 Q2: Universal Credit or Guarantee Pension Credit only (narrower than main passporting list). */
function benefitIndicatesUniversalCreditOrPensionGuarantee(d) {
  const s = `${d.benefitType || ''} ${d.benefitOther || ''}`;
  return /\bUniversal Credit\b/i.test(s) || /Pension Credit/i.test(s);
}

/**
 * CRM1 page 6 — Ethnicity (v16): codes from data/laa-reference-data.json ethnicCodes, left-to-right /
 * top-to-bottom field order on the official PDF (18 single-choice boxes).
 */
const CRM1_ETHNICITY_FIELD_BY_CODE = {
  '01': 'CheckBox137',
  '02': 'CheckBox132',
  '14': 'CheckBox101',
  '16': 'CheckBox138',
  '10': 'CheckBox134',
  '11': 'CheckBox67',
  '12': 'CheckBox145',
  '13': 'CheckBox135',
  '06': 'CheckBox68',
  '07': 'CheckBox136',
  '08': 'CheckBox116',
  '09': 'CheckBox147',
  '15': 'CheckBox150',
  '04': 'CheckBox151',
  '03': 'CheckBox148',
  '05': 'CheckBox2',
  '00': 'CheckBox152',
  '99': 'CheckBox149',
};

/**
 * CRM1 page 6 — Disability: codes from disabilityCodes; physical order matches the printed
 * "Definitions:" list on v16 (CheckBox66 = "Prefer not to say" — no app code, left blank).
 */
const CRM1_DISABILITY_FIELD_BY_CODE = {
  NCD: 'CheckBox31',
  VIS: 'CheckBox32',
  ILL: 'CheckBox3',
  OTH: 'CheckBox65',
  UKN: 'CheckBox4',
  MHC: 'CheckBox5',
  LDD: 'CheckBox72',
  MOB: 'CheckBox117',
  DEA: 'CheckBox73',
  HEA: 'CheckBox120',
  BLI: 'CheckBox100',
};

const CRM1_ALL_ETHNICITY_FIELDS = Object.values(CRM1_ETHNICITY_FIELD_BY_CODE);
const CRM1_ALL_DISABILITY_FIELDS = Object.values(CRM1_DISABILITY_FIELD_BY_CODE);

function fillCRM1EqualOpportunities(form, d) {
  CRM1_ALL_ETHNICITY_FIELDS.forEach((name) => safeUncheck(form, name));
  const eth = String(d.ethnicOriginCode || '').trim();
  const ethField = CRM1_ETHNICITY_FIELD_BY_CODE[eth];
  if (ethField) safeCheck(form, ethField, true);

  CRM1_ALL_DISABILITY_FIELDS.forEach((name) => safeUncheck(form, name));
  safeUncheck(form, 'CheckBox66');
  const dis = String(d.disabilityCode || '').trim();
  const disField = CRM1_DISABILITY_FIELD_BY_CODE[dis];
  if (disField) safeCheck(form, disField, true);
}

/* CRM1 v16 header UFN combs (y=674 row, page 1), left-to-right. */
const CRM1_UFN_COMBS = ['Comb1', 'Comb11', 'Comb2', 'Comb3', 'Comb4', 'Comb5', 'Comb21', 'Comb6', 'Comb7'];
/* NI number: 9 individual comb boxes on the DOB row (y=627). */
const CRM1_NI_COMBS = ['National_insurance_number', 'National_insurance_number1', 'Comb10', 'Comb101', 'Comb8', 'Comb9', 'Comb12', 'Comb13', 'FillText644'];

/* Gender / marital sets — cleared up-front so a template default never leaves the wrong box ticked. */
const CRM1_GENDER_FIELDS = ['CheckBox11', 'CheckBox12', 'CheckBox14'];
const CRM1_MARITAL_FIELDS = ['CheckBox87', 'Married', 'CheckBox1', 'Separated', 'Divorced', 'CheckBox89'];

/**
 * Fill the CRM1 AcroForm in place.
 * @param {import('pdf-lib').PDFForm} form
 * @param {object} d  attendance record data
 * @param {{accumulator?: Array}} [opts] optional miss accumulator (caller-owned array)
 * @returns {Array} the miss list (same array as opts.accumulator when provided)
 */
function fillCRM1(form, d, opts) {
  d = d || {};
  const acc = (opts && opts.accumulator) || [];
  _accumulator = acc;
  try {
    safeSet(form, 'Surname', d.surname);
    const firstLine = [d.forename, d.middleName].filter(Boolean).join(' ').trim();
    safeSet(form, 'First_name', firstLine || d.forename);

    const dob = fmtDateDMY(d.dob);
    if (dob) {
      const parts = dob.split('/');
      safeSet(form, 'Date_of_birth', parts[0] || '');
      safeSet(form, 'Date_of_birth1', parts[1] || '');
      safeSet(form, 'Date_of_birth2', parts[2] || '');
    }

    /* UFN: DDMMYY/NNN -> 6 chars + slash + 3 chars = 9 fillable boxes (firm IS the user, so always print it). */
    CRM1_UFN_COMBS.forEach((c) => safeClearText(form, c));
    const ufnRaw = d.ufn || d.ourFileNumber || d.fileReference || '';
    const ufnChars = String(ufnRaw).replace(/\s+/g, '').replace(/\//g, '').toUpperCase();
    if (ufnChars) {
      for (let i = 0; i < CRM1_UFN_COMBS.length; i++) {
        if (ufnChars[i]) safeSet(form, CRM1_UFN_COMBS[i], ufnChars[i]);
      }
    }

    const ni = normalizeNiNumberForPdf(d.niNumber || d.crm14NiNumber || '');
    for (let i = 0; i < CRM1_NI_COMBS.length; i++) {
      safeSet(form, CRM1_NI_COMBS[i], ni[i] || '');
    }

    safeSet(form, 'Current_address', [d.address1, d.address2, d.address3].filter(Boolean).join(', '));
    safeSet(form, 'FillText1', d.city);
    safeSet(form, 'County', d.county);
    safeSet(form, 'Postcode', d.postCode);

    /* Marital status (clear all six first for determinism). */
    const ms = d.maritalStatus || '';
    CRM1_MARITAL_FIELDS.forEach((name) => safeUncheck(form, name));
    safeCheck(form, 'CheckBox87', ms === 'Single');
    safeCheck(form, 'Married', ms === 'Married' || ms === 'Civil Partner' || ms === 'Married/Civil Partner');
    safeCheck(form, 'CheckBox1', ms === 'Cohabiting');
    safeCheck(form, 'Separated', ms === 'Separated');
    safeCheck(form, 'Divorced', ms === 'Divorced' || ms === 'Divorced/dissolved CP');
    safeCheck(form, 'CheckBox89', ms === 'Widowed');

    /* Gender: Male=CheckBox11, Female=CheckBox12, Prefer not to say=CheckBox14 (clear all first). */
    const gRaw = String(d.gender || '').trim().toLowerCase();
    CRM1_GENDER_FIELDS.forEach((name) => safeUncheck(form, name));
    const gMale = gRaw === 'male' || gRaw === 'm';
    const gFemale = gRaw === 'female' || gRaw === 'f';
    const gPnts = /^prefer\b/.test(gRaw) || gRaw.indexOf('prefer not') !== -1;
    safeCheck(form, 'CheckBox11', gMale);
    safeCheck(form, 'CheckBox12', gFemale);
    safeCheck(form, 'CheckBox14', gPnts);

    fillCRM1EqualOpportunities(form, d);

    /* Page 7 Q1 — Under 18? Yes = ignore rest of page. */
    const under18 = d.juvenileVulnerable === 'Juvenile';
    safeUncheck(form, 'Client under 18 checkbox');
    safeUncheck(form, 'Client not under 18 checkbox');
    safeCheck(form, 'Client under 18 checkbox', under18);
    safeCheck(form, 'Client not under 18 checkbox', !under18);

    /* Benefit / income passporting.
     *  onUcPc            -> Q2 Yes (Guarantee Pension Credit / Universal Credit)
     *  onOtherPassporting-> Q3 Yes (other passporting benefit, gross income <= £14,213)
     *  onBenefit         -> any passporting (suppresses the weekly income figures) */
    const onUcPc = benefitIndicatesUniversalCreditOrPensionGuarantee(d);
    const onBenefit = d.passportedBenefit === 'Yes' || d.benefits === 'Yes';
    const onOtherPassporting = onBenefit && !onUcPc;

    /* Q2: Guarantee Pension Credit / Universal Credit? (CheckBox10 = Yes, CheckBox9 = No) */
    safeUncheck(form, 'CheckBox10');
    safeUncheck(form, 'CheckBox9');
    safeCheck(form, 'CheckBox10', onUcPc);
    safeCheck(form, 'CheckBox9', !onUcPc);

    /* Q3: other passporting benefit, gross income <= £14,213? (CheckBox13 = Yes, CheckBox6 = No).
     * Only meaningful when Q2 = No (if Q2 Yes the form says ignore the rest). */
    safeUncheck(form, 'CheckBox13');
    safeUncheck(form, 'CheckBox6');
    if (!onUcPc) {
      safeCheck(form, 'CheckBox13', onOtherPassporting);
      safeCheck(form, 'CheckBox6', !onOtherPassporting);
    }

    /* Weekly income — only when not passported at all. */
    const wkClient = onBenefit ? '' : poundsAnnualToWeeklyOrEmpty(d.grossIncome);
    const wkPartner = onBenefit ? '' : poundsAnnualToWeeklyOrEmpty(d.partnerIncome);
    safeSet(form, 'The_client1', wkClient);
    safeSet(form, 'Partner_if_living_with_t_', wkPartner);
    if (!onBenefit && (wkClient !== '' || wkPartner !== '')) {
      const a = parseFloat(wkClient) || 0;
      const b = parseFloat(wkPartner) || 0;
      safeSet(form, 'Total1', String(Math.round((a + b) * 100) / 100));
    }

    /* NOTE: do NOT write d.dependants into FillText15. FillText15 is in the page-7
     * deductions block (Income tax / NI / other deductions), NOT the page-8 dependants
     * box. CRM1 v16 has no AcroForm field for the page-8 dependants count (handwritten). */

    /* Capital (page 8). */
    const capC = d.capitalClient;
    const capP = d.capitalPartner;
    const capT = d.capitalTotal;
    const hasCapC = capC !== undefined && capC !== null && String(capC).trim() !== '';
    const hasCapP = capP !== undefined && capP !== null && String(capP).trim() !== '';
    const hasCapT = capT !== undefined && capT !== null && String(capT).trim() !== '';
    if (hasCapC) safeSet(form, 'FillText23', String(capC).trim());
    if (hasCapP) safeSet(form, 'FillText24', String(capP).trim());
    if (hasCapC || hasCapP || hasCapT) {
      safeSet(form, 'FillText25', '0');
      safeSet(form, 'FillText26', '0');
    }
    if (hasCapT) {
      safeSet(form, 'FillText27', String(capT).trim());
    } else if (hasCapC || hasCapP) {
      const x = parseFloat(String(capC).replace(/,/g, '')) || 0;
      const y = parseFloat(String(capP).replace(/,/g, '')) || 0;
      safeSet(form, 'FillText27', String(Math.round((x + y) * 100) / 100));
    }
    if (hasCapC || hasCapP || hasCapT) {
      const totalVal = hasCapT
        ? String(capT).trim()
        : String((parseFloat(String(capC).replace(/,/g, '')) || 0) + (parseFloat(String(capP).replace(/,/g, '')) || 0));
      safeSet(form, 'FillText28', totalVal);
    }

    return acc;
  } finally {
    _accumulator = null;
  }
}

module.exports = {
  fillCRM1,
  fillCRM1EqualOpportunities,
  safeSet,
  safeClearText,
  safeCheck,
  safeUncheck,
  fmtDateDMY,
  normalizeNiNumberForPdf,
  poundsAnnualToWeeklyOrEmpty,
  benefitIndicatesUniversalCreditOrPensionGuarantee,
  CRM1_ETHNICITY_FIELD_BY_CODE,
  CRM1_DISABILITY_FIELD_BY_CODE,
  CRM1_UFN_COMBS,
  CRM1_NI_COMBS,
  CRM1_GENDER_FIELDS,
  CRM1_MARITAL_FIELDS,
};
