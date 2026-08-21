/**
 * Static tripwire: cached revoked licence status must always re-check online.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('licence revoked recheck (source)', () => {
  it('renderer always calls licenceValidate when local status is revoked', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'licence.js'), 'utf8');
    const revokedIdx = src.indexOf("status.status === 'revoked'");
    assert.ok(revokedIdx > 0, 'revoked gate must exist');
    const after = src.slice(revokedIdx, revokedIdx + 1200);
    assert.ok(
      after.includes('licenceValidate'),
      'revoked path must re-check online via licenceValidate'
    );
    assert.ok(
      after.includes('Checking with the licence server') || after.includes('checkedOnline') || after.includes('Always re-check'),
      'revoked path must document/perform an online recheck'
    );
  });
});
