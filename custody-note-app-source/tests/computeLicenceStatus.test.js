const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeLicenceStatus,
  resolveTier,
  DEFAULT_GRACE_DAYS,
} = require('../main/computeLicenceStatus');

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
    assert.equal(st.tier, 'pro');
    assert.equal(st.createAllowed, true);
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

  it('returns expired before grace when subscription date has passed and free tier off', () => {
    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus(
      {
        key: paidKey,
        expiresAt: pastExpiry,
        lastValidated: stale,
        status: 'active',
      },
      { freeTierEnabled: false },
    );
    assert.equal(st.status, 'expired');
    assert.equal(st.createAllowed, false);
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

describe('computeLicenceStatus freemium free during beta', () => {
  it('treats FREE-* as active free with createAllowed', () => {
    const st = computeLicenceStatus({
      key: 'FREE-ABCDEF0123456789',
      status: 'active',
      activatedAt: new Date().toISOString(),
    });
    assert.equal(st.status, 'active');
    assert.equal(st.tier, 'free');
    assert.equal(st.isFree, true);
    assert.equal(st.createAllowed, true);
    assert.equal(st.expiresAt, null);
  });

  it('downgrades expired trial to Free when freemium on', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus({
      key: 'TRIAL-ABCDEF0123456789',
      isTrial: true,
      expiresAt: past,
      status: 'active',
    });
    assert.equal(st.status, 'active');
    assert.equal(st.tier, 'free');
    assert.equal(st.createAllowed, true);
    assert.match(st.message, /free beta|Free during beta|beta access/i);
  });

  it('downgrades expired paid to Free core when freemium on', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const st = computeLicenceStatus({
      key: 'CN-AAAA-BBBB-CCCC-DDDD',
      expiresAt: past,
      status: 'active',
    });
    assert.equal(st.status, 'active');
    assert.equal(st.tier, 'free');
    assert.equal(st.proExpired, true);
    assert.equal(st.createAllowed, true);
  });

  it('resolveTier recognises free/trial/pro keys', () => {
    assert.equal(resolveTier({ key: 'FREE-X' }), 'free');
    assert.equal(resolveTier({ key: 'TRIAL-X', isTrial: true }), 'trial');
    assert.equal(resolveTier({ key: 'CN-AAAA-BBBB-CCCC-DDDD' }), 'pro');
  });
});

describe('computeLicenceStatus admin never revoked', () => {
  const adminEmail = 'robertdavidcashman@gmail.com';
  const adminOpts = { adminEmails: [adminEmail] };

  it('treats admin as active even when stored status is revoked', () => {
    const st = computeLicenceStatus(
      {
        key: 'CN-AAAA-BBBB-CCCC-DDDD',
        email: adminEmail,
        status: 'revoked',
      },
      adminOpts
    );
    assert.equal(st.status, 'active');
    assert.equal(st.isAdmin, true);
    assert.equal(st.createAllowed, true);
    assert.equal(st.tier, 'pro');
    assert.equal(st.addons.quickfile, true);
    assert.equal(st.addons.emailAddon, true);
  });

  it('treats admin as active even when status is already_used or expired', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const used = computeLicenceStatus(
      {
        key: 'CN-AAAA-BBBB-CCCC-DDDD',
        email: adminEmail,
        status: 'already_used',
      },
      adminOpts
    );
    assert.equal(used.status, 'active');
    assert.equal(used.isAdmin, true);

    const expired = computeLicenceStatus(
      {
        key: 'CN-AAAA-BBBB-CCCC-DDDD',
        email: adminEmail,
        status: 'active',
        expiresAt: past,
      },
      { ...adminOpts, freeTierEnabled: false }
    );
    assert.equal(expired.status, 'active');
    assert.equal(expired.isAdmin, true);
  });

  it('still revokes non-admin licences', () => {
    const st = computeLicenceStatus(
      {
        key: 'CN-AAAA-BBBB-CCCC-DDDD',
        email: 'user@example.com',
        status: 'revoked',
      },
      adminOpts
    );
    assert.equal(st.status, 'revoked');
    assert.equal(st.createAllowed, false);
  });

  it('does not treat a stale revoked stamp on FREE-* as revoked', () => {
    const st = computeLicenceStatus({
      key: 'FREE-ABCDEF0123456789',
      status: 'revoked',
      isFree: true,
      tier: 'free',
    });
    assert.equal(st.status, 'active');
    assert.equal(st.tier, 'free');
    assert.equal(st.createAllowed, true);
  });
});
