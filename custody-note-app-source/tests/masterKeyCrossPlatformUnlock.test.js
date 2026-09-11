/**
 * tests/masterKeyCrossPlatformUnlock.test.js
 * ----------------------------------------------------------------------------
 * Mac→Windows (and cross-machine) unlock: encryption.key is OS-bound via
 * Electron safeStorage. When the key file cannot be decrypted locally, we must
 * NOT mint a replacement master key that bricks an existing CNDB — instead
 * quarantine the unreadable key and route through recovery.dat.
 *
 * Run: npm run test:unit
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const dbCrypto = require('../lib/dbCrypto');
const {
  isValidMasterKeyHex,
  quarantineUnreadableKeyFile,
  resolveMasterKey,
  decryptBufferWithRecoveryFlow,
  RECOVERY_REQUIRED_MESSAGE,
  RECOVERY_CANCELLED_MESSAGE,
  WRONG_KEY_RECOVERY_MESSAGE,
} = require('../lib/masterKey');

function newKey() {
  return crypto.randomBytes(32).toString('hex');
}

function makeMemFs(initial = {}) {
  const files = { ...initial };
  return {
    _files: files,
    existsSync(p) {
      return Object.prototype.hasOwnProperty.call(files, p);
    },
    readFileSync(p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error('ENOENT: ' + p);
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    },
    writeFileSync(p, data) {
      files[p] = Buffer.isBuffer(data) ? data : Buffer.from(data);
    },
    renameSync(from, to) {
      if (!Object.prototype.hasOwnProperty.call(files, from)) {
        const err = new Error('ENOENT: ' + from);
        err.code = 'ENOENT';
        throw err;
      }
      files[to] = files[from];
      delete files[from];
    },
    copyFileSync(from, to) {
      if (!Object.prototype.hasOwnProperty.call(files, from)) {
        const err = new Error('ENOENT: ' + from);
        err.code = 'ENOENT';
        throw err;
      }
      files[to] = Buffer.from(files[from]);
    },
  };
}

function wrapRecoveryDat(masterKeyHex, password) {
  const salt = crypto.randomBytes(32);
  const derived = crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha512');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(masterKeyHex, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, enc]);
}

describe('masterKey — validation & quarantine', () => {
  it('accepts only 64-char hex master keys', () => {
    assert.strictEqual(isValidMasterKeyHex(newKey()), true);
    assert.strictEqual(isValidMasterKeyHex('abc'), false);
    assert.strictEqual(isValidMasterKeyHex('g'.repeat(64)), false);
    assert.strictEqual(isValidMasterKeyHex(null), false);
  });

  it('quarantines an unreadable key file without deleting it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-keyq-'));
    const keyPath = path.join(dir, 'encryption.key');
    const original = Buffer.from('mac-safeStorage-blob');
    fs.writeFileSync(keyPath, original);
    try {
      const dest = quarantineUnreadableKeyFile(fs, keyPath, Date.UTC(2026, 8, 8, 12, 0, 0));
      assert.ok(dest);
      assert.ok(!fs.existsSync(keyPath), 'original path must be vacated');
      assert.ok(fs.existsSync(dest), 'quarantine copy must exist');
      assert.ok(dest.includes('encryption.key.unreadable-'));
      assert.ok(fs.readFileSync(dest).equals(original), 'key bytes must be preserved');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('masterKey — resolveMasterKey (Mac→Windows class)', () => {
  const KEY_PATH = '/ud/encryption.key';
  const FALLBACK_PATH = '/ud/master.fallback';
  const REAL_KEY = 'a'.repeat(64);

  it('loads a normally readable safeStorage key', () => {
    const mem = makeMemFs({ [KEY_PATH]: Buffer.from('wrapped') });
    let persisted = null;
    const result = resolveMasterKey({
      allowCreate: false,
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => REAL_KEY,
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => newKey(),
      persistNewKey: (k) => { persisted = k; },
    });
    assert.strictEqual(result.key, REAL_KEY);
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.reason, 'safeStorage');
    assert.strictEqual(persisted, null);
    assert.ok(mem.existsSync(KEY_PATH), 'readable key must stay in place');
  });

  it('quarantines foreign/unreadable key and returns null without writing a new key (allowCreate false)', () => {
    const foreignBlob = Buffer.from('mac-safeStorage-blob-foreign');
    const mem = makeMemFs({ [KEY_PATH]: foreignBlob });
    let persisted = null;
    let createdCount = 0;
    const result = resolveMasterKey({
      allowCreate: false,
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString'); },
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => { createdCount++; return newKey(); },
      persistNewKey: (k) => { persisted = k; },
      nowMs: Date.UTC(2026, 8, 8, 18, 0, 0),
    });
    assert.strictEqual(result.key, null);
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.reason, 'unreadable_key_quarantined');
    assert.ok(result.quarantinedKeyPath);
    assert.ok(!mem.existsSync(KEY_PATH), 'unreadable key path vacated');
    assert.ok(mem.existsSync(result.quarantinedKeyPath), 'quarantine preserved');
    assert.ok(mem.readFileSync(result.quarantinedKeyPath).equals(foreignBlob));
    assert.strictEqual(persisted, null, 'must not write a new encryption.key');
    assert.strictEqual(createdCount, 0, 'must not invent a replacement master key');
  });

  it('still refuses to mint a replacement key when allowCreate is true after unreadable key', () => {
    const mem = makeMemFs({ [KEY_PATH]: Buffer.from('foreign') });
    let persisted = null;
    const result = resolveMasterKey({
      allowCreate: true,
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('decrypt failed'); },
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => 'b'.repeat(64),
      persistNewKey: (k) => { persisted = k; },
    });
    assert.strictEqual(result.key, null);
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.reason, 'unreadable_key_quarantined');
    assert.strictEqual(persisted, null);
  });

  it('treats invalid decrypted key material as unreadable (quarantine, no create)', () => {
    const mem = makeMemFs({ [KEY_PATH]: Buffer.from('wrapped') });
    let persisted = null;
    const result = resolveMasterKey({
      allowCreate: true,
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => 'not-a-valid-key',
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => 'c'.repeat(64),
      persistNewKey: (k) => { persisted = k; },
    });
    assert.strictEqual(result.key, null);
    assert.strictEqual(persisted, null);
    assert.strictEqual(result.reason, 'unreadable_key_quarantined');
  });

  it('creates a fresh key only when no key file exists (new install)', () => {
    const mem = makeMemFs({});
    let persisted = null;
    const fresh = 'd'.repeat(64);
    const result = resolveMasterKey({
      allowCreate: true,
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('should not be called'); },
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => fresh,
      persistNewKey: (k) => { persisted = k; },
    });
    assert.strictEqual(result.key, fresh);
    assert.strictEqual(result.created, true);
    assert.strictEqual(persisted, fresh);
  });
});

describe('masterKey — decryptBufferWithRecoveryFlow + CNDB', () => {
  it('unreadable key + existing CNDB + recovery.dat → prompts recovery and opens DB', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE attendances (id INTEGER PRIMARY KEY, data TEXT)');
    db.run("INSERT INTO attendances (data) VALUES ('{\"client\":\"MacRecord\"}')");
    const plain = Buffer.from(db.export());
    db.close();

    const masterKeyHex = newKey();
    const encrypted = dbCrypto.encryptBuffer(plain, masterKeyHex);
    assert.ok(dbCrypto.isEncrypted(encrypted));

    const KEY_PATH = '/ud/encryption.key';
    const FALLBACK_PATH = '/ud/master.fallback';
    const mem = makeMemFs({ [KEY_PATH]: Buffer.from('mac-key-blob') });
    let persistedKey = null;
    let promptCount = 0;

    const resolved = resolveMasterKey({
      allowCreate: false,
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('foreign safeStorage key'); },
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => newKey(),
      persistNewKey: (k) => { persistedKey = k; },
    });
    assert.strictEqual(resolved.key, null);
    assert.strictEqual(persistedKey, null);
    assert.ok(!mem.existsSync(KEY_PATH));

    const decrypted = await decryptBufferWithRecoveryFlow({
      buf: encrypted,
      getMasterKey: () => null, // after quarantine
      hasRecoveryPassword: () => true,
      promptForRecoveryPassword: async () => {
        promptCount++;
        return masterKeyHex;
      },
      persistRecoveredKey: (k) => { persistedKey = k; },
      decryptBuffer: (buf, key) => dbCrypto.decryptBuffer(buf, key),
    });

    assert.strictEqual(promptCount, 1);
    assert.strictEqual(persistedKey, masterKeyHex);
    assert.ok(decrypted.equals(plain));

    const reopened = new SQL.Database(decrypted);
    const stmt = reopened.prepare('SELECT data FROM attendances WHERE id=1');
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    reopened.close();
    assert.match(row.data, /MacRecord/);

    // Original DB bytes must still be intact (caller never deletes attendances.db)
    assert.ok(dbCrypto.isEncrypted(encrypted));
  });

  it('unreadable key + existing CNDB + no recovery → fails safely without writing a new key', async () => {
    const masterKeyHex = newKey();
    const encrypted = dbCrypto.encryptBuffer(Buffer.from('SQLite-ish payload'), masterKeyHex);

    const KEY_PATH = '/ud/encryption.key';
    const FALLBACK_PATH = '/ud/master.fallback';
    const foreign = Buffer.from('foreign-mac-key');
    const mem = makeMemFs({ [KEY_PATH]: foreign });
    let persistedKey = null;

    const resolved = resolveMasterKey({
      allowCreate: true, // even if a write path asked to create
      keyPath: KEY_PATH,
      fallbackPath: FALLBACK_PATH,
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('cannot decrypt'); },
      },
      fs: mem,
      decryptFallbackKey: () => null,
      createRandomKey: () => 'e'.repeat(64),
      persistNewKey: (k) => { persistedKey = k; },
    });
    assert.strictEqual(resolved.key, null);
    assert.strictEqual(persistedKey, null);
    assert.ok(resolved.quarantinedKeyPath);
    assert.ok(mem.existsSync(resolved.quarantinedKeyPath));
    assert.ok(!mem.existsSync(KEY_PATH), 'must not leave a wrong readable key at encryption.key');

    await assert.rejects(
      () => decryptBufferWithRecoveryFlow({
        buf: encrypted,
        getMasterKey: () => null,
        hasRecoveryPassword: () => false,
        promptForRecoveryPassword: async () => {
          throw new Error('must not prompt when recovery.dat is absent');
        },
        persistRecoveredKey: (k) => { persistedKey = k; },
        decryptBuffer: (buf, key) => dbCrypto.decryptBuffer(buf, key),
      }),
      (err) => {
        assert.strictEqual(err.code, 'CN_RECOVERY_REQUIRED');
        assert.match(err.message, /recovery password/i);
        assert.ok(err.message.includes(RECOVERY_REQUIRED_MESSAGE.slice(0, 40)) || /recovery password/i.test(err.message));
        return true;
      }
    );
    assert.strictEqual(persistedKey, null, 'must not brick further recovery by writing a new key');
  });

  it('wrong local key + recovery.dat → prompts recovery instead of raw GCM-only failure', async () => {
    const realKey = newKey();
    const wrongKey = newKey();
    const encrypted = dbCrypto.encryptBuffer(Buffer.from('secret-db'), realKey);
    let prompted = false;
    let persisted = null;

    const out = await decryptBufferWithRecoveryFlow({
      buf: encrypted,
      getMasterKey: () => wrongKey,
      hasRecoveryPassword: () => true,
      promptForRecoveryPassword: async () => {
        prompted = true;
        return realKey;
      },
      persistRecoveredKey: (k) => { persisted = k; },
      decryptBuffer: (buf, key) => dbCrypto.decryptBuffer(buf, key),
    });
    assert.strictEqual(prompted, true);
    assert.strictEqual(persisted, realKey);
    assert.ok(out.equals(Buffer.from('secret-db')));
  });

  it('recovery cancelled → clear user-facing error mentioning recovery password', async () => {
    const encrypted = dbCrypto.encryptBuffer(Buffer.from('x'), newKey());
    await assert.rejects(
      () => decryptBufferWithRecoveryFlow({
        buf: encrypted,
        getMasterKey: () => null,
        hasRecoveryPassword: () => true,
        promptForRecoveryPassword: async () => null,
        persistRecoveredKey: () => {},
        decryptBuffer: (buf, key) => dbCrypto.decryptBuffer(buf, key),
      }),
      (err) => {
        assert.strictEqual(err.code, 'CN_RECOVERY_CANCELLED');
        assert.match(err.message, /recovery password/i);
        assert.ok(err.message.startsWith(RECOVERY_CANCELLED_MESSAGE.slice(0, 20)) || err.message === RECOVERY_CANCELLED_MESSAGE);
        assert.doesNotMatch(err.message, /Unsupported state or unable to authenticate data/i);
        return true;
      }
    );
  });

  it('normal readable key path still decrypts without prompting recovery', async () => {
    const key = newKey();
    const plain = Buffer.from('normal-path-db');
    const encrypted = dbCrypto.encryptBuffer(plain, key);
    let prompted = false;
    const out = await decryptBufferWithRecoveryFlow({
      buf: encrypted,
      getMasterKey: () => key,
      hasRecoveryPassword: () => true,
      promptForRecoveryPassword: async () => {
        prompted = true;
        return null;
      },
      persistRecoveredKey: () => {},
      decryptBuffer: (buf, k) => dbCrypto.decryptBuffer(buf, k),
    });
    assert.strictEqual(prompted, false);
    assert.ok(out.equals(plain));
  });

  it('exposes WRONG_KEY_RECOVERY_MESSAGE constant for UI wiring', () => {
    assert.match(WRONG_KEY_RECOVERY_MESSAGE, /recovery password/i);
    assert.match(RECOVERY_REQUIRED_MESSAGE, /recovery password/i);
  });
});

describe('masterKey — main.js wiring (source)', () => {
  const mainJs = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');

  it('delegates master-key resolve and CNDB unlock to lib/masterKey', () => {
    assert.match(mainJs, /require\('\.\/lib\/masterKey'\)/);
    assert.match(mainJs, /resolveMasterKey\(/);
    assert.match(mainJs, /decryptBufferWithRecoveryFlow\(/);
    assert.match(mainJs, /allowCreate: false/);
  });

  it('surfaces recovery-password guidance in PersistenceStartupError for unlock failures', () => {
    assert.match(mainJs, /Enter your recovery password/);
    assert.match(mainJs, /CN_RECOVERY_REQUIRED/);
  });
});
