/**
 * Unit tests for CRM1 pre-submit validation (renderer/lib/crm1Validation.js).
 *
 * Guards the "CRM1 keeps producing errors / fills boxes wrong" complaint: the
 * app must surface SPECIFIC field-level problems before generating the official
 * PDF, instead of silently producing a near-blank or wrong form.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validateCrm1Data, parseDateLoose } = require('../renderer/lib/crm1Validation');

const NOW = new Date('2026-06-06T12:00:00.000Z');

function fullValidRecord() {
  return {
    surname: 'Smith',
    forename: 'John',
    dob: '1990-04-05',
    gender: 'Male',
    address1: '1 High Street',
    postCode: 'LS1 1AA',
    niNumber: 'AB123456C',
    ufn: '010125/001',
    passportedBenefit: 'No',
    benefits: 'No',
    grossIncome: '12000',
  };
}

describe('validateCrm1Data — required fields', () => {
  it('passes a complete, valid record with no errors', () => {
    const r = validateCrm1Data(fullValidRecord(), { now: NOW });
    assert.strictEqual(r.ok, true, 'expected ok, got errors: ' + JSON.stringify(r.errors));
    assert.strictEqual(r.errors.length, 0);
  });

  it('flags missing surname, first name, DOB, address and postcode with specific messages', () => {
    const r = validateCrm1Data({}, { now: NOW });
    assert.strictEqual(r.ok, false);
    const fields = r.errors.map((e) => e.field);
    assert.ok(fields.includes('surname'), 'surname error');
    assert.ok(fields.includes('forename'), 'forename error');
    assert.ok(fields.includes('dob'), 'dob error');
    assert.ok(fields.includes('address1'), 'address error');
    assert.ok(fields.includes('postCode'), 'postcode error');
    // messages are specific, not a generic "invalid form"
    r.errors.forEach((e) => assert.ok(e.message && e.message.length > 8 && !/invalid form/i.test(e.message)));
  });
});

describe('validateCrm1Data — date handling', () => {
  it('rejects a malformed date of birth', () => {
    const r = validateCrm1Data(Object.assign(fullValidRecord(), { dob: '32/13/2020' }), { now: NOW });
    assert.ok(r.errors.some((e) => e.field === 'dob' && /valid date/i.test(e.message)));
  });

  it('rejects a future date of birth', () => {
    const r = validateCrm1Data(Object.assign(fullValidRecord(), { dob: '2099-01-01' }), { now: NOW });
    assert.ok(r.errors.some((e) => e.field === 'dob' && /future/i.test(e.message)));
  });

  it('accepts both YYYY-MM-DD and D/M/YYYY', () => {
    assert.ok(parseDateLoose('1990-04-05'));
    assert.ok(parseDateLoose('5/4/1990'));
    assert.strictEqual(parseDateLoose('not-a-date'), null);
  });
});

describe('validateCrm1Data — NI format and warnings', () => {
  it('errors on a malformed NI number', () => {
    const r = validateCrm1Data(Object.assign(fullValidRecord(), { niNumber: '123' }), { now: NOW });
    assert.ok(r.errors.some((e) => e.field === 'niNumber' && /AB123456C/.test(e.message)));
  });

  it('warns (not errors) when neither NI nor ARC is present', () => {
    const rec = fullValidRecord();
    delete rec.niNumber;
    const r = validateCrm1Data(rec, { now: NOW });
    assert.strictEqual(r.ok, true, 'missing NI is a warning, not a hard error');
    assert.ok(r.warnings.some((w) => w.field === 'niNumber'));
  });

  it('warns when gender is blank (Equal Opportunities box left empty)', () => {
    const rec = fullValidRecord();
    delete rec.gender;
    const r = validateCrm1Data(rec, { now: NOW });
    assert.ok(r.warnings.some((w) => w.field === 'gender'));
  });
});
