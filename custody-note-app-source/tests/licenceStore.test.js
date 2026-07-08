/**
 * Tests for main/licenceStore.js
 * Run: npm run test:unit
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const licenceStore = require('../main/licenceStore');

const TEST_DIR = path.join(__dirname, '../.test-tmp-licence');

describe('licenceStore', () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const key = crypto.randomBytes(32);
    await licenceStore.initStore(TEST_DIR, key);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    } catch (_) {}
  });

  it('initStore creates encrypted DB file', async () => {
    assert.ok(fs.existsSync(path.join(TEST_DIR, 'licences.db.enc')));
    const raw = fs.readFileSync(path.join(TEST_DIR, 'licences.db.enc'));
    assert.ok(raw.length > 0);
    assert.strictEqual(raw[0], 1);
  });

  it('upsertLicence and getByEmail', () => {
    licenceStore.upsertLicence({
      email: '  Test@Example.COM  ',
      licence_key: 'ABCD-1234-EFGH-5678',
      created_at: 1000,
    });
    const rec = licenceStore.getByEmail('test@example.com');
    assert.ok(rec);
    assert.strictEqual(rec.email, 'test@example.com');
    assert.strictEqual(rec.licence_key, 'ABCD-1234-EFGH-5678');
    assert.strictEqual(rec.created_at, 1000);
    assert.strictEqual(rec.status, 'active');
  });

  it('getByEmail returns null for missing email', () => {
    assert.strictEqual(licenceStore.getByEmail('nope@x.com'), null);
  });

  it('upsertLicence normalizes email', () => {
    licenceStore.upsertLicence({ email: '  Foo@Bar.COM  ', licence_key: 'X' });
    assert.ok(licenceStore.getByEmail('foo@bar.com'));
  });

  it('searchByEmailPrefix', () => {
    licenceStore.upsertLicence({ email: 'alice@x.com', licence_key: 'K1' });
    licenceStore.upsertLicence({ email: 'alice2@x.com', licence_key: 'K2' });
    licenceStore.upsertLicence({ email: 'bob@x.com', licence_key: 'K3' });
    const rows = licenceStore.searchByEmailPrefix('alice');
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map((r) => r.email).sort(), ['alice2@x.com', 'alice@x.com']);
  });

  it('listRecent returns by created_at desc', () => {
    licenceStore.upsertLicence({ email: 'a@x.com', licence_key: 'K1', created_at: 100 });
    licenceStore.upsertLicence({ email: 'b@x.com', licence_key: 'K2', created_at: 200 });
    const rows = licenceStore.listRecent(10);
    assert.strictEqual(rows[0].email, 'b@x.com');
    assert.strictEqual(rows[1].email, 'a@x.com');
  });

  it('setStatus and markSent', () => {
    licenceStore.upsertLicence({ email: 's@x.com', licence_key: 'K', id: 'id-1' });
    licenceStore.setStatus('id-1', 'revoked');
    const rec = licenceStore.getByEmail('s@x.com');
    assert.strictEqual(rec.status, 'revoked');
    licenceStore.markSent('id-1', 9999);
    const rec2 = licenceStore.getByEmail('s@x.com');
    assert.strictEqual(rec2.last_sent_at, 9999);
  });

  it('maskKey', () => {
    assert.ok(/^ABCD-\*\*\*\*-\*\*\*\*-/.test(licenceStore.maskKey('ABCD-1234-EFGH-5678')));
    assert.strictEqual(licenceStore.maskKey('short'), 'shor-****-****-hort');
  });

  it('encryption roundtrip: data persists across re-init', async () => {
    const subDir = path.join(TEST_DIR, 'roundtrip');
    fs.mkdirSync(subDir, { recursive: true });
    const key = crypto.randomBytes(32);
    await licenceStore.initStore(subDir, key);
    licenceStore.upsertLicence({ email: 'persist@x.com', licence_key: 'SECRET-KEY' });
    const encPath = path.join(subDir, 'licences.db.enc');
    const raw = fs.readFileSync(encPath);
    assert.ok(!raw.toString('utf8').includes('SECRET-KEY'));
    await licenceStore.initStore(subDir, key);
    const rec = licenceStore.getByEmail('persist@x.com');
    assert.ok(rec);
    assert.strictEqual(rec.licence_key, 'SECRET-KEY');
    fs.rmSync(subDir, { recursive: true, force: true });
  });
});
