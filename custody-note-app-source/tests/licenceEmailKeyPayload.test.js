const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildLicenceEmailKeyPayload } = require('../main/licenceEmailKeyPayload');

describe('buildLicenceEmailKeyPayload', () => {
  it('sends licence key when activated, ignoring practice email from renderer', () => {
    const payload = buildLicenceEmailKeyPayload(
      { key: 'CN-AAAA-BBBB-CCCC-DDDD', email: 'account@purchase.com' },
      { email: 'practice@firm.com' },
    );
    assert.equal(payload.key, 'CN-AAAA-BBBB-CCCC-DDDD');
    assert.equal(payload.email, undefined);
  });

  it('falls back to account email from licence.dat when no key', () => {
    const payload = buildLicenceEmailKeyPayload(
      { email: 'account@purchase.com' },
      { email: 'practice@firm.com' },
    );
    assert.equal(payload.email, 'account@purchase.com');
    assert.equal(payload.key, undefined);
  });

  it('uses renderer email only when licence file has neither key nor account email', () => {
    const payload = buildLicenceEmailKeyPayload({}, { email: 'Practice@Firm.com' });
    assert.equal(payload.email, 'practice@firm.com');
  });
});
