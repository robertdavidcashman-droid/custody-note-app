'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const BILLING = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'billing-screen.js'), 'utf8');

describe('billing-screen QuickFile load resilience', () => {
  it('does not use Promise.all with DOM fallback catch for qfConfigured', () => {
    assert.ok(!BILLING.includes('Promise.all(['), 'must not use fragile Promise.all for billing load');
    assert.match(BILLING, /Promise\.allSettled/);
    const catchIdx = BILLING.indexOf('}).catch(function');
    assert.equal(catchIdx, -1, 'billing step must not catch and downgrade QuickFile to DOM check');
  });
});
