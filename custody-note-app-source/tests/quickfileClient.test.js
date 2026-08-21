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
const {
  buildQuickFileAuth,
  parseQuickFileResponse,
  buildQuickFileClientCreateBody,
  extractQuickFileAddress,
  pickQuickFileContact,
  normaliseQuickFileSearchClient,
  mergeQuickFileClientDetails,
  mapWithConcurrency,
} = require('../lib/quickfileClient');

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

describe('buildQuickFileClientCreateBody', () => {
  it('builds CompanyName-only ClientDetails (no ClientType or Email in that namespace)', () => {
    const body = buildQuickFileClientCreateBody('  Acme Solicitors  ', 'billing@acme.test');
    assert.deepStrictEqual(body, {
      ClientDetails: { CompanyName: 'Acme Solicitors' },
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body.ClientDetails, 'ClientType'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body.ClientDetails, 'Email'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, 'ClientContacts'), false);
  });

  it('truncates CompanyName to 100 characters', () => {
    const long = 'X'.repeat(150);
    const body = buildQuickFileClientCreateBody(long);
    assert.strictEqual(body.ClientDetails.CompanyName.length, 100);
  });

  it('throws when firm name is empty after trim', () => {
    assert.throws(() => buildQuickFileClientCreateBody('   '), /Firm name is required/);
    assert.throws(() => buildQuickFileClientCreateBody(''), /Firm name is required/);
    assert.throws(() => buildQuickFileClientCreateBody(null), /Firm name is required/);
  });
});

describe('extractQuickFileAddress', () => {
  it('joins Address object lines', () => {
    assert.strictEqual(
      extractQuickFileAddress({ Address: { Line1: '1 High St', City: 'Leeds', PostCode: 'LS1 1AA' } }),
      '1 High St, Leeds, LS1 1AA'
    );
  });

  it('returns empty string for missing client', () => {
    assert.strictEqual(extractQuickFileAddress(null), '');
  });
});

describe('pickQuickFileContact', () => {
  it('prefers default contact over first entry', () => {
    const picked = pickQuickFileContact({
      ClientContacts: [
        { FirstName: 'Other', Surname: 'Person', Email: 'other@ex.test', Telephone: '0111' },
        { FirstName: 'Jane', Surname: 'Doe', Email: 'jane@ex.test', Telephone: '0222', DefaultContact: true },
      ],
    });
    assert.strictEqual(picked.contactName, 'Jane Doe');
    assert.strictEqual(picked.email, 'jane@ex.test');
    assert.strictEqual(picked.telephone, '0222');
  });

  it('returns empty fields when contacts are absent', () => {
    assert.deepStrictEqual(pickQuickFileContact({}), {
      contactName: '',
      email: '',
      telephone: '',
    });
  });
});

describe('normaliseQuickFileSearchClient + mergeQuickFileClientDetails', () => {
  it('normalises a sparse search row', () => {
    const n = normaliseQuickFileSearchClient({
      ClientID: 99,
      CompanyName: 'Acme LLP',
      Email: 'office@acme.test',
      Telephone: '0113 111',
    });
    assert.deepStrictEqual(n, {
      clientId: '99',
      companyName: 'Acme LLP',
      contactName: '',
      email: 'office@acme.test',
      telephone: '0113 111',
      address: '',
    });
  });

  it('merges Client_Get address and contacts over search fields', () => {
    const search = normaliseQuickFileSearchClient({
      ClientID: 99,
      CompanyName: 'Acme LLP',
      Email: 'sparse@acme.test',
      Telephone: '0000',
    });
    const merged = mergeQuickFileClientDetails(search, {
      ClientID: 99,
      CompanyName: 'Acme Solicitors LLP',
      Address: { Line1: '10 Court Lane', City: 'York', PostCode: 'YO1 1AA' },
      ClientContacts: [
        { FirstName: 'Sam', Surname: 'Counsel', Email: 'sam@acme.test', Telephone: '01904 123456' },
      ],
    });
    assert.strictEqual(merged.companyName, 'Acme Solicitors LLP');
    assert.strictEqual(merged.contactName, 'Sam Counsel');
    assert.strictEqual(merged.email, 'sam@acme.test');
    assert.strictEqual(merged.telephone, '01904 123456');
    assert.strictEqual(merged.address, '10 Court Lane, York, YO1 1AA');
  });

  it('falls back to search when get body is null', () => {
    const search = normaliseQuickFileSearchClient({ ClientID: 1, CompanyName: 'Solo', Email: 'a@b.c' });
    const merged = mergeQuickFileClientDetails(search, null);
    assert.deepStrictEqual(merged, search);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order and respects concurrency', async () => {
    const started = [];
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 5));
      return n * 10;
    });
    assert.deepStrictEqual(results, [10, 20, 30, 40]);
    assert.deepStrictEqual(started.slice(0, 2).sort(), [1, 2]);
  });
});
