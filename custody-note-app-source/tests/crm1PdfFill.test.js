/**
 * Regression: CRM1 official PDF prefill (lib/laaCrm1Fill.js) — UFN/NI combs,
 * gender/marital/benefit ticks, weekly income, capital, equal opportunities.
 *
 * Field mapping moved out of main.js into lib/laaCrm1Fill.js (v1.9.17) so it is
 * unit-testable; main.js now delegates to it. These static checks assert the
 * source shape; tests/crm1Fill.test.js asserts the actual filled PDF.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const crm1Src = fs.readFileSync(path.join(root, 'lib', 'laaCrm1Fill.js'), 'utf8');

describe('CRM1 PDF fill (lib/laaCrm1Fill.js)', () => {
  it('main.js delegates CRM1 fill to the module', () => {
    assert.ok(mainSrc.includes("require('./lib/laaCrm1Fill')"), 'main.js must require the module');
    assert.ok(/function fillCRM1\(form, d\)\s*\{[\s\S]*laaCrm1Fill\.fillCRM1\(form, d/.test(mainSrc),
      'main.js fillCRM1 must delegate to laaCrm1Fill.fillCRM1');
  });

  it('clears UFN header combs, populates from UFN or file / matter ref, and maps NI to correct comb fields', () => {
    assert.ok(crm1Src.includes("CRM1_UFN_COMBS"), 'UFN combs array expected');
    assert.ok(crm1Src.includes("safeClearText(form, c)"), 'UFN combs must be cleared first');
    assert.ok(/d\.ufn\s*\|\|\s*d\.ourFileNumber\s*\|\|\s*d\.fileReference/.test(crm1Src),
      'UFN combs must use dedicated UFN or the same ref as the attendance File / matter reference');
    assert.ok(crm1Src.includes("safeSet(form, CRM1_UFN_COMBS[i], ufnChars[i])"), 'UFN combs filled char-by-char');
    assert.ok(crm1Src.includes("CRM1_NI_COMBS"), 'NI combs array expected');
    assert.ok(crm1Src.includes("'National_insurance_number', 'National_insurance_number1', 'Comb10', 'Comb101', 'Comb8', 'Comb9', 'Comb12', 'Comb13', 'FillText644'"), 'NI mapped to correct 9 comb fields');
    assert.ok(!/safeSet\(form, 'FillText644', d\.ufn\)/.test(crm1Src), 'UFN must not populate USN');
  });

  it('does NOT push d.dependants into FillText15 (page-7 deductions field, not page-8 dependants)', () => {
    assert.ok(!/safeSet\(\s*form\s*,\s*'FillText15'\s*,\s*d\.dependants\s*\)/.test(crm1Src),
      'FillText15 sits in the page-7 deductions block; writing dependants there overprints a deduction box');
  });

  it('maps gender to verified v16 boxes: Male=CheckBox11, Female=CheckBox12, Prefer not to say=CheckBox14', () => {
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox11', gMale)"), 'Male = CheckBox11');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox12', gFemale)"), 'Female = CheckBox12');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox14', gPnts)"), 'Prefer not to say = CheckBox14');
    assert.ok(crm1Src.includes("CRM1_GENDER_FIELDS"), 'gender boxes cleared before tick');
  });

  it('maps marital Cohabiting to CheckBox1 and Widowed to CheckBox89 (verified v16)', () => {
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox1', ms === 'Cohabiting')"), 'Cohabiting = CheckBox1');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox89', ms === 'Widowed')"), 'Widowed = CheckBox89');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox87', ms === 'Single')"), 'Single = CheckBox87');
  });

  it('maps the two page-7 benefit questions correctly (Q2 UC/PC CheckBox10/9, Q3 CheckBox13/6)', () => {
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox10', onUcPc)"), 'Q2 Yes (UC/PC) = CheckBox10');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox9', !onUcPc)"), 'Q2 No = CheckBox9');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox13', onOtherPassporting)"), 'Q3 Yes = CheckBox13');
    assert.ok(crm1Src.includes("safeCheck(form, 'CheckBox6', !onOtherPassporting)"), 'Q3 No = CheckBox6');
  });

  it('converts annual gross figures to weekly for CRM1 income boxes', () => {
    assert.ok(crm1Src.includes('poundsAnnualToWeeklyOrEmpty'), 'weekly conversion helper expected');
    assert.ok(crm1Src.includes("safeSet(form, 'Partner_if_living_with_t_', wkPartner)"), 'partner box must be weekly figure');
  });

  it('fills capital page fields FillText23-FillText28 from record', () => {
    assert.ok(crm1Src.includes("safeSet(form, 'FillText23'"), 'capital client savings');
    assert.ok(crm1Src.includes("safeSet(form, 'FillText24'"), 'capital partner savings');
    assert.ok(crm1Src.includes("safeSet(form, 'FillText25'"), 'capital client investments');
    assert.ok(crm1Src.includes("safeSet(form, 'FillText26'"), 'capital partner investments');
    assert.ok(crm1Src.includes("safeSet(form, 'FillText27'"), 'capital total');
    assert.ok(crm1Src.includes("safeSet(form, 'FillText28'"), 'capital above threshold');
  });

  it('maps equal opportunities ethnicity/disability codes to CRM1 page 6 checkboxes', () => {
    assert.ok(crm1Src.includes('CRM1_ETHNICITY_FIELD_BY_CODE'), 'ethnicity map');
    assert.ok(crm1Src.includes("'01': 'CheckBox137'"), 'ethnicity code 01');
    assert.ok(crm1Src.includes('CRM1_DISABILITY_FIELD_BY_CODE'), 'disability map');
    assert.ok(crm1Src.includes("NCD: 'CheckBox31'"), 'disability NCD');
    assert.ok(crm1Src.includes('fillCRM1EqualOpportunities'), 'equal op fill helper');
  });
});

describe('Applicant Declaration PDF (main.js)', () => {
  it('clears Text4 USN field', () => {
    assert.ok(mainSrc.includes("safeClearText(form, 'Text4')"), 'USN Text4 cleared');
  });
});

describe('CRM3 PDF fill (main.js)', () => {
  it('uses Yes1/No1 for action started and mutual counsel ticks', () => {
    assert.ok(mainSrc.includes("safeUncheck(form, 'Yes1')"), 'Yes1 uncheck');
    assert.ok(mainSrc.includes("safeCheck(form, 'CheckBox2', counselYes)"), 'counsel Yes');
  });
  it('clears header FillText8 (UFN for firm)', () => {
    assert.ok(mainSrc.includes("safeClearText(form, 'FillText8')"), 'CRM3 header UFN cleared');
  });
});
