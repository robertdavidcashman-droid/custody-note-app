/**
 * Local encrypted licence database (admin-only).
 * All operations run in main process only.
 * Keys never logged. DB encrypted at rest.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DB_FILENAME = 'licences.db.enc';
const SCHEMA_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

let _db = null;
let _key = null;
let _userDataPath = null;

function getDbPath(userDataPath) {
  const base = userDataPath != null ? userDataPath : _userDataPath;
  if (!base) {
    try {
      return path.join(require('electron').app.getPath('userData'), DB_FILENAME);
    } catch (_) {
      throw new Error('Licence store: userDataPath not set');
    }
  }
  return path.join(base, DB_FILENAME);
}

function setEncryptionKey(keyBuffer) {
  if (!keyBuffer || keyBuffer.length !== 32) {
    throw new Error('Invalid encryption key: must be 32 bytes');
  }
  _key = keyBuffer;
}

function encrypt(plainBuffer) {
  if (!_key) throw new Error('Encryption key not set');
  const buf = Buffer.isBuffer(plainBuffer) ? plainBuffer : Buffer.from(plainBuffer);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, _key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([SCHEMA_VERSION]), iv, tag, enc]);
}

function decrypt(data) {
  if (!_key) throw new Error('Encryption key not set');
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const version = buf[0];
  if (version !== SCHEMA_VERSION) throw new Error('Unsupported DB version');
  const iv = buf.slice(1, 1 + IV_LENGTH);
  const tag = buf.slice(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH);
  const enc = buf.slice(1 + IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, _key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS licences (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  licence_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','revoked','cancelled','expired','past_due','trialing'))
);
CREATE INDEX IF NOT EXISTS idx_licences_email ON licences(email);
`;

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function initStore(userDataPath, keyBuffer) {
  _userDataPath = userDataPath;
  setEncryptionKey(keyBuffer);
  const dbPath = getDbPath(userDataPath);

  const initNewDb = (SQL) => {
    const db = new SQL.Database();
    db.run(SCHEMA);
    const data = db.export();
    db.close();
    const enc = encrypt(data);
    fs.writeFileSync(dbPath, enc);
    return loadDb(SQL, dbPath);
  };

  const loadDb = (SQL, p) => {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p);
    const dec = decrypt(raw);
    const db = new SQL.Database(dec);
    return db;
  };

  const migrateSchema = (db) => {
    try {
      const info = db.exec("PRAGMA table_info(licences)");
      if (!info.length) return;
      const checkSql = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='licences'");
      if (!checkSql.length) return;
      const ddl = checkSql[0].values[0][0];
      if (ddl && ddl.includes("'cancelled'")) return;
      db.run("ALTER TABLE licences RENAME TO licences_old");
      db.run(SCHEMA);
      db.run("INSERT INTO licences SELECT * FROM licences_old");
      db.run("DROP TABLE licences_old");
    } catch (_) {}
  };

  return new Promise((resolve, reject) => {
    const initSqlJs = require('sql.js');
    initSqlJs().then((SQL) => {
      try {
        _db = loadDb(SQL, dbPath) || initNewDb(SQL);
        if (_db) { migrateSchema(_db); persist(); }
        resolve(_db !== null);
      } catch (e) {
        reject(e);
      }
    }).catch(reject);
  });
}

function run(sql, params = []) {
  if (!_db) throw new Error('Licence store not initialized');
  _db.run(sql, params);
}

function all(sql, params = []) {
  if (!_db) throw new Error('Licence store not initialized');
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getOne(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

function persist() {
  if (!_db) return;
  const data = _db.export();
  const dbPath = getDbPath(_userDataPath);
  const enc = encrypt(data);
  fs.writeFileSync(dbPath, enc);
}

function getByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return getOne('SELECT id, email, licence_key, created_at, last_sent_at, status FROM licences WHERE email = ?', [e]);
}

function upsertLicence(record) {
  const email = normalizeEmail(record.email);
  if (!email || !record.licence_key) return;
  const id = record.id || crypto.randomUUID();
  const created_at = record.created_at != null ? record.created_at : Date.now();
  const last_sent_at = record.last_sent_at != null ? record.last_sent_at : null;
  const VALID_STATUSES = ['active', 'revoked', 'cancelled', 'expired', 'past_due', 'trialing'];
  const status = VALID_STATUSES.includes(record.status) ? record.status : 'active';

  run(
    `INSERT INTO licences (id, email, licence_key, created_at, last_sent_at, status) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, licence_key=excluded.licence_key,
       last_sent_at=excluded.last_sent_at, status=excluded.status`,
    [id, email, record.licence_key, created_at, last_sent_at, status]
  );
  persist();
}

function searchByEmailPrefix(prefix, limit = 50) {
  const p = normalizeEmail(prefix);
  if (!p) return [];
  return all(
    `SELECT id, email, licence_key, created_at, last_sent_at, status FROM licences WHERE email LIKE ? ORDER BY created_at DESC LIMIT ?`,
    [p + '%', limit]
  );
}

function listRecent(limit = 100) {
  return all(
    `SELECT id, email, licence_key, created_at, last_sent_at, status FROM licences ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

function setStatus(id, status) {
  const VALID_STATUSES = ['active', 'revoked', 'cancelled', 'expired', 'past_due', 'trialing'];
  if (!VALID_STATUSES.includes(status)) return;
  run('UPDATE licences SET status = ? WHERE id = ?', [status, id]);
  persist();
}

function markSent(id, ts = Date.now()) {
  run('UPDATE licences SET last_sent_at = ? WHERE id = ?', [ts, id]);
  persist();
}

function maskKey(key) {
  if (!key || typeof key !== 'string') return '****';
  const parts = key.split('-');
  if (parts.length >= 4) {
    return parts[0] + '-****-****-' + (parts[parts.length - 1] || '').slice(-4);
  }
  return key.slice(0, 4) + '-****-****-' + (key.length >= 4 ? key.slice(-4) : '****');
}

module.exports = {
  initStore,
  setEncryptionKey,
  getByEmail,
  upsertLicence,
  searchByEmailPrefix,
  listRecent,
  setStatus,
  markSent,
  maskKey,
  getDbPath,
  persist,
};
