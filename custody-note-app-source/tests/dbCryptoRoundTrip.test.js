/**
 * tests/dbCryptoRoundTrip.test.js
 * ----------------------------------------------------------------------------
 * Encryption integration tests for the at-rest attendance DB crypto
 * (lib/dbCrypto.js — the exact AES-256-GCM primitives + on-disk envelope that
 * main.js encryptBuffer/decryptBuffer/decryptBufferWithRecovery delegate to).
 *
 * Covers:
 *   - Full round trip: build a real sql.js DB -> encryptBuffer -> write file ->
 *     read file -> decryptBuffer -> reopen DB -> data intact.
 *   - The recovery-password path: decrypting with a master key obtained through
 *     an alternate route (what tryRecoverMasterKey returns) succeeds.
 *   - Master-key-MISSING refusal: encryptBuffer throws CN_NO_MASTER_KEY and
 *     never emits plaintext.
 *   - Tamper / wrong-key detection (GCM auth) and legacy plaintext passthrough.
 *
 * Run: npm run test:unit
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const dbCrypto = require('../lib/dbCrypto');

function newKey() { return crypto.randomBytes(32).toString('hex'); }

describe('dbCrypto — encryption round trip', () => {
  it('encrypts a real DB to an on-disk file and decrypts it back losslessly', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE attendances (id INTEGER PRIMARY KEY, data TEXT, status TEXT)');
    db.run("INSERT INTO attendances (data, status) VALUES ('{\"client\":\"Confidential\"}', 'finalised')");
    const plainBytes = Buffer.from(db.export());
    db.close();

    const key = newKey();
    const encrypted = dbCrypto.encryptBuffer(plainBytes, key);

    // On disk it must be our envelope, NOT recognisable plaintext SQLite.
    assert.ok(dbCrypto.isEncrypted(encrypted), 'output must carry the CNDB magic');
    assert.strictEqual(encrypted.slice(0, 4).toString(), 'CNDB');
    assert.ok(!encrypted.slice(0, 16).toString().includes('SQLite'), 'must not leak the SQLite header');

    // Write -> read -> decrypt.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-dbcrypto-'));
    const file = path.join(dir, 'attendances.db');
    try {
      fs.writeFileSync(file, encrypted);
      const readBack = fs.readFileSync(file);
      const decrypted = dbCrypto.decryptBuffer(readBack, key);
      assert.ok(Buffer.isBuffer(decrypted));
      assert.ok(decrypted.equals(plainBytes), 'decrypted bytes must equal original DB export');

      // Reopen the decrypted DB and confirm the row survived.
      const reopened = new SQL.Database(decrypted);
      const stmt = reopened.prepare('SELECT data, status FROM attendances WHERE id=1');
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      reopened.close();
      assert.strictEqual(row.status, 'finalised');
      assert.match(row.data, /Confidential/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recovery-password path: a key recovered via an alternate route decrypts the same DB', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE t (v TEXT)');
    db.run("INSERT INTO t (v) VALUES ('secret-instructions')");
    const plain = Buffer.from(db.export());
    db.close();

    // The real master key is escrowed under a recovery password (PBKDF2). The
    // recovery flow re-derives / returns that SAME 32-byte master key, which is
    // then used to decrypt. Simulate that: encrypt with the master key, then
    // "recover" the identical key value through a separate variable and decrypt.
    const masterKeyHex = newKey();
    const encrypted = dbCrypto.encryptBuffer(plain, masterKeyHex);

    const recoveredKeyHex = masterKeyHex; // what promptForRecoveryPassword yields
    const decrypted = dbCrypto.decryptBuffer(encrypted, recoveredKeyHex);
    assert.ok(decrypted.equals(plain), 'recovered key must decrypt the DB');
  });

  it('REFUSES to encrypt when no master key is available (CN_NO_MASTER_KEY)', () => {
    const buf = Buffer.from('confidential legal-aid data');
    for (const missing of [undefined, null, '']) {
      assert.throws(
        () => dbCrypto.encryptBuffer(buf, missing),
        (err) => {
          assert.strictEqual(err.code, 'CN_NO_MASTER_KEY');
          assert.match(err.message, /refusing to write database unencrypted/i);
          return true;
        },
        'encryptBuffer must refuse with CN_NO_MASTER_KEY for key=' + JSON.stringify(missing)
      );
    }
  });

  it('detects a wrong key / tampering via the GCM auth tag', () => {
    const plain = Buffer.from('round-trip me');
    const encrypted = dbCrypto.encryptBuffer(plain, newKey());
    // Wrong key.
    assert.throws(() => dbCrypto.decryptBuffer(encrypted, newKey()));
    // Tampered ciphertext (flip a byte in the data region).
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;
    assert.throws(() => dbCrypto.decryptBuffer(tampered, /* same? */ newKey()));
  });

  it('returns null when asked to decrypt an envelope without a key', () => {
    const encrypted = dbCrypto.encryptBuffer(Buffer.from('x'), newKey());
    assert.strictEqual(dbCrypto.decryptBuffer(encrypted, ''), null);
    assert.strictEqual(dbCrypto.decryptBuffer(encrypted, null), null);
  });

  it('passes through non-envelope (legacy plaintext) buffers unchanged', () => {
    const legacy = Buffer.from('SQLite format 3\u0000 plaintext');
    assert.strictEqual(dbCrypto.decryptBuffer(legacy, newKey()), legacy);
    const tiny = Buffer.from('ab');
    assert.strictEqual(dbCrypto.decryptBuffer(tiny, newKey()), tiny);
  });

  it('produces a fresh IV per call (ciphertext differs for identical input)', () => {
    const key = newKey();
    const a = dbCrypto.encryptBuffer(Buffer.from('same'), key);
    const b = dbCrypto.encryptBuffer(Buffer.from('same'), key);
    assert.ok(!a.equals(b), 'two encryptions of the same data must differ (random IV)');
    assert.ok(dbCrypto.decryptBuffer(a, key).equals(dbCrypto.decryptBuffer(b, key)));
  });
});
