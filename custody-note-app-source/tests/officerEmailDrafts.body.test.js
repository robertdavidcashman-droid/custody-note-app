'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateOfficerEmailBody } = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — body', () => {
  const base = {
    templateType: 'disclosure_confirm_attendance',
    recipientName: 'Officer',
    clientName: 'Jane',
    policeStation: 'Tonbridge',
    attendanceDate: '1 Jan 2026',
    offence: 'Theft',
  };

  it('uses reply-to sentence when My email address is empty', () => {
    const b = generateOfficerEmailBody(Object.assign({}, base, { userEmailAddress: '' }));
    assert.ok(b.includes('Please send initial disclosure by reply to this email.'), b);
    assert.ok(!b.includes('@'), b);
  });

  it('inserts optional My email address into the disclosure sentence', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { userEmailAddress: ' me@firm.example ' })
    );
    assert.ok(b.includes('Please send initial disclosure to me at me@firm.example.'), b);
    assert.ok(!b.includes('by reply to this email'), b);
  });

  it('chase_disclosure appends disclosure destination', () => {
    const b = generateOfficerEmailBody(
      Object.assign({}, base, { templateType: 'chase_disclosure', userEmailAddress: 'me@firm.example' })
    );
    assert.ok(b.includes('Please send initial disclosure to me at me@firm.example.'), b);
  });
});
