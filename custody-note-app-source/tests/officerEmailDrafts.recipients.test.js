'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getRecipientNameOrDefault } = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — recipient defaulting', () => {
  it('uses Officer when blank (non-custody template)', () => {
    assert.strictEqual(getRecipientNameOrDefault('chase_disclosure', ''), 'Officer');
  });

  it('uses DDO for custody templates when blank', () => {
    assert.strictEqual(getRecipientNameOrDefault('custody_log_request', ''), 'DDO');
    assert.strictEqual(getRecipientNameOrDefault('custody_record_detention_log_request', ''), 'DDO');
    assert.strictEqual(getRecipientNameOrDefault('chase_custody_log_follow_up', ''), 'DDO');
  });

  it('preserves explicit name', () => {
    assert.strictEqual(getRecipientNameOrDefault('chase_disclosure', '  PC Smith  '), 'PC Smith');
  });
});
