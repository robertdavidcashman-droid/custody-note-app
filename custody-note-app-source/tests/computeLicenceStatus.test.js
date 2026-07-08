const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeLicenceStatus, DEFAULT_GRACE_DAYS } = require('../main/computeLicenceStatus');

describe('computeLicenceStatus grace period', () => {
  const paidKey = 'CN-AAAA-BBBB-CCCC-DDDD';
  const futureExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  it('defaults grace period to 60 days', () => {
    assert.equal(DEFAULT_GRACE_DAYS, 60);
  });

  it('returns active when lastValidated is within grace window', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus({
      key: paidKey,
      expiresAt: futureExpiry,
      lastValidated: recent,
      status: 'active',
    });
    assert.equal(st.status, 'active');
  });

  it('returns grace_expired when lastValidated is older than grace window', () => {
    const stale = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus({
      key: paidKey,
      expiresAt: futureExpiry,
      lastValidated: stale,
      status: 'active',
    });
    assert.equal(st.status, 'grace_expired');
    assert.match(st.message, /60 days/);
    assert.match(st.message, /still active/i);
  });

  it('returns expired before grace when subscription date has passed', () => {
    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus({
      key: paidKey,
      expiresAt: pastExpiry,
      lastValidated: stale,
      status: 'active',
    });
    assert.equal(st.status, 'expired');
  });

  it('respects custom graceDays option', () => {
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus(
      { key: paidKey, expiresAt: futureExpiry, lastValidated: stale, status: 'active' },
      { graceDays: 7 },
    );
    assert.equal(st.status, 'grace_expired');
    assert.match(st.message, /7 days/);
  });
});
