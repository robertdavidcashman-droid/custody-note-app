'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BUILTIN_ADMIN_EMAILS,
  resolveAdminEmails,
  isAdminEmail,
  isSyntheticLocalLicenceKey,
} = require('../main/licenceAdminEmails');

describe('licenceAdminEmails', () => {
  it('includes product-owner built-in emails', () => {
    assert.ok(BUILTIN_ADMIN_EMAILS.includes('robertdavidcashman@gmail.com'));
    assert.ok(BUILTIN_ADMIN_EMAILS.includes('nerijus83@gmail.com'));
  });

  it('falls back to built-in list when env and config are empty', () => {
    const list = resolveAdminEmails({ envValue: '', configEmails: [], includeBuiltin: true });
    assert.deepEqual(list, [...BUILTIN_ADMIN_EMAILS]);
  });

  it('lets CUSTODY_ADMIN_EMAILS replace the built-in list', () => {
    const list = resolveAdminEmails({
      envValue: 'support@example.com, Other@Example.COM',
      configEmails: ['ignored@example.com'],
      includeBuiltin: true,
    });
    assert.deepEqual(list, ['support@example.com', 'other@example.com']);
  });

  it('uses licence-config adminEmails when env is empty', () => {
    const list = resolveAdminEmails({
      envValue: '',
      configEmails: ['ops@custodynote.com'],
      includeBuiltin: true,
    });
    assert.deepEqual(list, ['ops@custodynote.com']);
  });

  it('isAdminEmail matches case-insensitively', () => {
    const list = ['robertdavidcashman@gmail.com'];
    assert.equal(isAdminEmail('RobertDavidCashman@gmail.com', list), true);
    assert.equal(isAdminEmail('other@example.com', list), false);
    assert.equal(isAdminEmail('', list), false);
  });

  it('detects synthetic Free/trial keys', () => {
    assert.equal(isSyntheticLocalLicenceKey('FREE-ABCDEF0123456789'), true);
    assert.equal(isSyntheticLocalLicenceKey('TRIAL-ABCDEF0123456789'), true);
    assert.equal(isSyntheticLocalLicenceKey('CN-AAAA-BBBB-CCCC-DDDD'), false);
    assert.equal(isSyntheticLocalLicenceKey('ACCOUNT-XYZ'), false);
  });
});
