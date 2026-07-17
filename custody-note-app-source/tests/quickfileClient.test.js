/**
 * QuickFile API client tests — auth building + response parsing with MOCK data.
 * These never touch the live QuickFile API.
 *
 * Covers requirement C: valid credentials build correct auth; missing/invalid
 * credentials give a clear warning; "token" (per-request MD5) freshness; and
 * that error responses are parsed into specific, user-readable messages.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildQuickFileAuth, parseQuickFileResponse } = require('../lib/quickfileClient');

const VALID = { accountNumber: '1234567', apiKey: 'API-KEY-ABC', applicationId: 'APP-ID-XYZ' };

describe('buildQuickFileAuth', () => {
  it('builds an auth block for valid credentials', () => {
    const auth = buildQuickFileAuth(VALID, { submissionNumber: 'sub-1', md5: (s) => 'md5(' + s + ')' });
    assert.strictEqual(auth.accountNumber, '1234567');
    assert.strictEqual(auth.applicationId, 'APP-ID-XYZ');
    assert.strictEqual(auth.submissionNumber, 'sub-1');
    assert.strictEqual(auth.md5Value, 'md5(1234567API-KEY-ABCsub-1)');
  });

  it('throws a clear, specific error listing each missing credential', () => {
    assert.throws(() => buildQuickFileAuth({}), /missing in Settings: Account number, API key, Application ID/);
    assert.throws(() => buildQuickFileAuth({ accountNumber: '1', apiKey: 'k' }), /Application ID/);
  });

  it('uses a fresh submission number + MD5 per request (nothing to expire/refresh)', () => {
    const a = buildQuickFileAuth(VALID);
    const b = buildQuickFileAuth(VALID);
    assert.notStrictEqual(a.submissionNumber, b.submissionNumber, 'submission numbers must differ');
    assert.notStrictEqual(a.md5Value, b.md5Value, 'MD5 must differ per request');
  });
});

describe('parseQuickFileResponse', () => {
  it('returns the message Body on a healthy 200 response', () => {
    const raw = JSON.stringify({
      Client_Search: { Header: { Status: 'Success' }, Body: { ReturnCount: 1, Record: [{ CompanyName: 'Acme' }] } },
    });
    const body = parseQuickFileResponse(200, raw);
    assert.strictEqual(body.ReturnCount, 1);
    assert.strictEqual(body.Record[0].CompanyName, 'Acme');
  });

  it('throws a clear message for an empty response', () => {
    assert.throws(() => parseQuickFileResponse(200, ''), /empty response \(HTTP 200\)/);
  });

  it('throws the HTTP status for a non-2xx response', () => {
    assert.throws(() => parseQuickFileResponse(401, 'Unauthorized'), /HTTP 401/);
  });

  it('surfaces QuickFile Errors array messages', () => {
    const raw = JSON.stringify({ Errors: { Error: [{ Message: 'Invalid MD5 signature' }] } });
    assert.throws(() => parseQuickFileResponse(200, raw), /Invalid MD5 signature/);
  });

  it('surfaces a Header.Status === "Error" status message', () => {
    const raw = JSON.stringify({ Client_Search: { Header: { Status: 'Error', StatusMessage: 'Account suspended' } } });
    assert.throws(() => parseQuickFileResponse(200, raw), /Account suspended/);
  });

  it('throws a parse error for invalid JSON on a 200', () => {
    assert.throws(() => parseQuickFileResponse(200, '<html>not json</html>'), /parse error \(HTTP 200\)/);
  });
});
