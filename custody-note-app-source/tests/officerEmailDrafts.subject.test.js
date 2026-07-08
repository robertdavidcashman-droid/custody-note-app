'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateOfficerEmailSubject, SUBJECT_SUFFIX } = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — subject line', () => {
  it('joins client, station, offence and template label', () => {
    const s = generateOfficerEmailSubject({
      clientName: 'A B',
      policeStation: 'X Station',
      offence: 'Fraud',
      templateType: 'chase_disclosure',
    });
    assert.ok(s.includes('A B'), s);
    assert.ok(s.includes('X Station'), s);
    assert.ok(s.includes('Fraud'), s);
    assert.ok(s.includes(SUBJECT_SUFFIX.chase_disclosure), s);
  });

  it('uses the user-facing confirm attendance subject suffix', () => {
    const s = generateOfficerEmailSubject({
      clientName: 'John Smith',
      policeStation: 'Tonbridge Police Station',
      offence: 'Assault',
      templateType: 'disclosure_confirm_attendance',
    });
    assert.strictEqual(
      s,
      'John Smith - Tonbridge Police Station - Assault - Confirm attendance — disclosure'
    );
  });

  it('uses placeholders when fields missing', () => {
    const s = generateOfficerEmailSubject({
      clientName: '',
      policeStation: '',
      offence: '',
      templateType: 'custody_log_request',
    });
    assert.ok(s.includes('[Client Name]'), s);
    assert.ok(s.includes('[Police Station]'), s);
    assert.ok(s.includes('[Offence]'), s);
    assert.ok(!/undefined|null|NaN/.test(s), s);
  });
});
