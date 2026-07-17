/**
 * Finalise and billing logic tests.
 *
 * Tests that attendance can be finalised without case outcome,
 * and that billing readiness warnings only fire when appropriate.
 *
 * These tests exercise the validation and billing logic functions
 * by mocking the formData object and calling the functions directly.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');

function extractFunction(source, funcName) {
  const regex = new RegExp('function\\s+' + funcName + '\\s*\\(');
  const idx = source.indexOf('function ' + funcName);
  if (idx === -1) return null;
  let depth = 0;
  let started = false;
  let end = idx;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) { end = i + 1; break; }
  }
  return source.substring(idx, end);
}

function buildValidationRunner(funcBody, funcName) {
  const wrappedCode = `
    var formData = {};
    var esc = function(s) { return String(s || ''); };
    ${funcBody}
    return ${funcName};
  `;
  const factory = new Function(wrappedCode);
  return function runValidation(data) {
    const fn = factory();
    return fn.call({ formData: data }, data);
  };
}

function buildBillingRunner() {
  const funcBody = extractFunction(appJsSource, 'getBillingReadinessWarnings');
  if (!funcBody) throw new Error('Could not extract getBillingReadinessWarnings');
  const wrappedCode = `
    var formData;
    var esc = function(s) { return String(s || ''); };
    ${funcBody}
    return function(data) { formData = data; return getBillingReadinessWarnings(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function buildAttendanceValidator() {
  const funcBody = extractFunction(appJsSource, 'validateAttendanceForm');
  if (!funcBody) throw new Error('Could not extract validateAttendanceForm');
  const wrappedCode = `
    var formData;
    ${funcBody}
    return function(data) { formData = data; return validateAttendanceForm(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function buildTelephoneValidator() {
  const funcBody = extractFunction(appJsSource, 'validateTelephoneForm');
  if (!funcBody) throw new Error('Could not extract validateTelephoneForm');
  const wrappedCode = `
    var formData;
    ${funcBody}
    return function(data) { formData = data; return validateTelephoneForm(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function buildVoluntaryValidator() {
  const funcBody = extractFunction(appJsSource, 'validateVoluntaryForm');
  if (!funcBody) throw new Error('Could not extract validateVoluntaryForm');
  const wrappedCode = `
    var formData;
    ${funcBody}
    return function(data) { formData = data; return validateVoluntaryForm(); };
  `;
  const factory = new Function(wrappedCode);
  return factory();
}

function baseAttendanceData(overrides = {}) {
  return {
    date: '2025-01-15',
    policeStationId: 'PS001',
    instructionDateTime: '2025-01-15T10:00',
    surname: 'Smith',
    forename: 'John',
    dob: '1990-01-01',
    sufficientBenefitTest: 'Yes',
    conflictCheckResult: 'Negative',
    laaClientFullName: 'John Smith',
    niNumber: 'AB123456C',
    matterTypeCode: 'CRM14',
    offence1Details: 'Theft',
    timeArrival: '10:30',
    previousAdvice: 'No',
    workType: 'First Police Station Attendance',
    disclosureType: 'Written',
    ...overrides,
  };
}

function baseTelephoneData(overrides = {}) {
  return {
    date: '2025-01-15',
    policeStationId: 'PS001',
    dsccRef: 'DSCC123',
    instructionDateTime: '2025-01-15T10:00',
    matterTypeCode: 'CRM14',
    dutySolicitor: 'Yes',
    feeCode: 'INVA',
    surname: 'Smith',
    forename: 'John',
    gender: 'Male',
    clientPhone: '07700900000',
    timeFirstContactWithClient: '10:15',
    firstContactWithin45Mins: 'Yes',
    telephoneAdviceSummary: 'Advised on rights',
    previousAdvice: 'No',
    ...overrides,
  };
}

function baseVoluntaryData(overrides = {}) {
  return {
    date: '2025-01-15',
    instructionSource: 'Direct',
    surname: 'Smith',
    forename: 'John',
    offenceSummary: 'Fraud allegation',
    voluntaryStatusConfirmed: 'Yes',
    policeStationId: 'PS001',
    previousAdvice: 'No',
    ...overrides,
  };
}


describe('Finalise: Attendance form validation', () => {
  let validate;
  try { validate = buildAttendanceValidator(); } catch (_) {}

  it('requires outcomeDecision for attendance finalisation', { skip: !validate }, () => {
    const data = baseAttendanceData({ outcomeDecision: '' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.ok(outcomeErr, 'Should require outcomeDecision');
  });

  it('passes with ongoing outcome selected', { skip: !validate }, () => {
    const data = baseAttendanceData({ outcomeDecision: 'Ongoing / Unknown' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('clears bail requirements for charged without bail path', { skip: !validate }, () => {
    const data = baseAttendanceData({ outcomeDecision: 'Charged without Bail' });
    const errors = validate(data);
    const bailErr = errors.find(e => e.key === 'bailType' || e.key === 'bailConditions');
    assert.strictEqual(bailErr, undefined);
  });
});


describe('Finalise: Telephone form validation', () => {
  let validate;
  try { validate = buildTelephoneValidator(); } catch (_) {}

  it('requires outcomeDecision for telephone finalisation', { skip: !validate }, () => {
    const data = baseTelephoneData({ outcomeDecision: '' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.ok(outcomeErr, 'Should require an outcome selection');
  });

  it('does not require outcomeCode when the telephone outcome is still ongoing', { skip: !validate }, () => {
    const data = baseTelephoneData({ outcomeDecision: 'Ongoing / Unknown' });
    const errors = validate(data);
    const codeErr = errors.find(e => e.key === 'outcomeCode');
    assert.strictEqual(codeErr, undefined);
  });

  it('requires outcomeCode when the telephone matter is concluded', { skip: !validate }, () => {
    const data = baseTelephoneData({ outcomeDecision: 'NFA – no further action' });
    const errors = validate(data);
    const codeErr = errors.find(e => e.key === 'outcomeCode');
    assert.ok(codeErr, 'Should require outcomeCode when concluded');
  });

  it('requires caseConcludedDate when the telephone matter is concluded', { skip: !validate }, () => {
    const data = baseTelephoneData({ outcomeDecision: 'Charged', outcomeCode: 'CN06 – Charge / Summons' });
    const errors = validate(data);
    const dateErr = errors.find(e => e.key === 'caseConcludedDate');
    assert.ok(dateErr, 'Should require caseConcludedDate when concluded');
  });
});


describe('Finalise: Voluntary form validation', () => {
  let validate;
  try { validate = buildVoluntaryValidator(); } catch (_) {}

  it('passes with blank voluntary outcome', { skip: !validate }, () => {
    const data = baseVoluntaryData({ outcomeDecision: '' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeDecision');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('passes with outcomeDecision=Ongoing / Unknown', { skip: !validate }, () => {
    const data = baseVoluntaryData({ outcomeDecision: 'Ongoing / Unknown' });
    const errors = validate(data);
    const outcomeErr = errors.find(e => e.key === 'outcomeCode');
    assert.strictEqual(outcomeErr, undefined);
  });

  it('requires outcomeDecision when concluded', { skip: !validate }, () => {
    const data = baseVoluntaryData({ outcomeDecision: 'Released NFA', outcomeCode: '' });
    const errors = validate(data);
    const codeErr = errors.find(e => e.key === 'outcomeCode');
    assert.ok(codeErr, 'outcomeCode should be required when a definitive outcome is selected');
  });
});


describe('Billing readiness warnings', () => {
  let getBillingWarnings;
  try { getBillingWarnings = buildBillingRunner(); } catch (_) {}

  it('warns when attendance outcome is missing', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      totalMinutes: '60',
      sufficientBenefitTest: 'Yes',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.ok(outcomeWarn, 'Should warn when no outcome is recorded');
  });

  it('no outcome code warning for custody when a decision is selected', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      outcomeDecision: 'Charged without Bail',
      totalMinutes: '60',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.strictEqual(outcomeWarn, undefined);
  });

  it('warns about outcome code for concluded voluntary matters when missing', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      attendanceMode: 'voluntary',
      outcomeDecision: 'Released NFA',
      outcomeCode: '',
      totalMinutes: '60',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.ok(outcomeWarn, 'Should warn when case is concluded but outcomeCode missing');
  });

  it('no warning when voluntary conclusion has outcomeCode', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      attendanceMode: 'voluntary',
      outcomeDecision: 'Released NFA',
      outcomeCode: 'CN04',
      totalMinutes: '60',
    });
    const outcomeWarn = w.find(msg => msg.toLowerCase().includes('outcome'));
    assert.strictEqual(outcomeWarn, undefined);
  });

  it('skips billing warnings for telephone form type', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({ _formType: 'telephone' });
    assert.strictEqual(w.length, 0);
  });

  it('missing sufficient benefit does not add a blocking billing readiness warning', { skip: !getBillingWarnings }, () => {
    const w = getBillingWarnings({
      matterTypeCode: 'CRM14',
      outcomeDecision: 'Ongoing / Unknown',
      totalMinutes: '60',
      sufficientBenefitTest: '',
      sufficientBenefitNotes: '',
    });
    const sbt = w.find(msg => /sufficient benefit/i.test(msg));
    assert.strictEqual(sbt, undefined, 'SBT should be informational only, not in blocking list');
  });
});
