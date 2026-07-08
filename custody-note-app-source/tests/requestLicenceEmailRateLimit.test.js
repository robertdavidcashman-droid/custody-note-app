/**
 * Tests for main/requestLicenceEmailRateLimit.js
 * Run: npm run test:unit
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { checkRateLimit } = require('../main/requestLicenceEmailRateLimit');

describe('requestLicenceEmailRateLimit', () => {
  beforeEach(() => {
    require('../main/requestLicenceEmailRateLimit').resetForTest();
  });

  it('allows first 5 requests', () => {
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(checkRateLimit(), true);
    }
  });

  it('blocks 6th request within window', () => {
    for (let i = 0; i < 5; i++) checkRateLimit();
    assert.strictEqual(checkRateLimit(), false);
  });
});
