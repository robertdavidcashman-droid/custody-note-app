/* Audit-log compaction for attendances.db.
 *
 * Runs inside Electron so it can use safeStorage to load the master key,
 * then opens the encrypted SQLite file via sql.js, compacts audit_log, and
 * writes the database back encrypted using the SAME format as main.js.
 *
 * Compaction strategy (destructive — assumes you have a quarantine backup):
 *   1. Drop audit_log rows older than RETENTION_DAYS (default 30).
 *   2. Within each attendance_id, dedupe CONSECUTIVE identical previous_snapshot
 *      runs — keep only the earliest row of each run (so audit history shape is
 *      preserved but exact-duplicate snapshots collapse).
 *   3. VACUUM.
 *
 * Run with:  npx electron scripts/compact-audit-log.cjs [--days=30] [--dry-run]
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

app.setName('custody-note');
try {
  const realUserData = path.join(process.env.APPDATA || app.getPath('appData'), 'custody-note');
  app.setPath('userData', realUserData);
} catch (e) {
  console.warn('[compact] could not override userData:', e.message);
}

const MAGIC = 'CNDB';
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const daysArg = args.find((a) => a.startsWith('--days='));
const RETENTION_DAYS = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1], 10) || 30) : 30;

function fmt(n) {
  if (n == null) return 'n/a';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
function rowsOf(res) {
  if (!res || res.length === 0) return [];
  const cols = res[0].columns;
  return res[0].values.map((v) => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
}
function _getMachineObfuscationKey() {
  const os = require('os');
  const raw = 'cn-fallback:' + [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', os.totalmem()].join('|');
  return crypto.createHash('sha256').update(raw).digest();
}
function _decryptFallbackKey(buf) {
  if (!buf || buf.length < 28) return null;
  try {
    const mk = _getMachineObfuscationKey();
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', mk, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (_) {
    return null;
  }
}
function loadMasterKey(userData) {
  const keyPath = path.join(userData, 'encryption.key');
  const fallbackPath = path.join(userData, 'master.fallback');
  if (safeStorage.isEncryptionAvailable() && fs.existsSync(keyPath)) {
    try {
      return safeStorage.decryptString(fs.readFileSync(keyPath));
    } catch (err) {
      console.warn('[compact] safeStorage decrypt failed:', err.message);
    }
  }
  if (fs.existsSync(fallbackPath)) {
    const raw = fs.readFileSync(fallbackPath);
    const k = _decryptFallbackKey(raw);
    if (k && k.length === 64) return k;
    const plaintext = raw.toString('utf8').trim();
    if (plaintext && plaintext.length === 64 && /^[0-9a-f]+$/.test(plaintext)) return plaintext;
  }
  throw new Error('Could not load master key.');
}
function decryptBuffer(buf, masterKeyHex) {
  if (!buf || buf.length < 4) throw new Error('DB file too small.');
  if (buf.slice(0, 4).toString() !== MAGIC) return buf;
  const iv = buf.slice(4, 16);
  const tag = buf.slice(16, 32);
  const data = buf.slice(32);
  const key = Buffer.from(masterKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
function encryptBuffer(buf, masterKeyHex) {
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(MAGIC), iv, tag, enc]);
}

function writeAtomicSync(destPath, data) {
  const tmpPath = `${destPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, data);
  try {
    fs.renameSync(tmpPath, destPath);
  } catch (renameErr) {
    if (!fs.existsSync(tmpPath)) throw renameErr;
    fs.copyFileSync(tmpPath, destPath);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

async function run() {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'attendances.db');
  console.log('Mode         :', DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE');
  console.log('Retention    :', RETENTION_DAYS, 'days');
  console.log('userData     :', userData);
  console.log('DB path      :', dbPath);

  const fileBuf = fs.readFileSync(dbPath);
  console.log('On-disk size :', fmt(fileBuf.length));

  const masterKey = loadMasterKey(userData);
  const raw = decryptBuffer(fileBuf, masterKey);
  console.log('Decrypted    :', fmt(raw.length));

  const SQL = await initSqlJs();
  const db = new SQL.Database(raw);

  // Before stats
  const beforeRows = rowsOf(db.exec('SELECT COUNT(*) AS c FROM audit_log'))[0].c;
  const beforeBytes = rowsOf(db.exec(
    "SELECT SUM(LENGTH(previous_snapshot)) AS b FROM audit_log"
  ))[0].b || 0;
  const distinctRecords = rowsOf(db.exec(
    "SELECT COUNT(DISTINCT attendance_id) AS c FROM audit_log"
  ))[0].c;
  console.log('---');
  console.log('Before:');
  console.log('  audit_log rows                :', beforeRows);
  console.log('  distinct attendance_id values :', distinctRecords);
  console.log('  total previous_snapshot bytes :', fmt(beforeBytes));

  // Step 1: drop rows older than retention.
  // Audit timestamp is 'YYYY-MM-DD HH:MM:SS' (SQLite datetime('now')) — sortable as text.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const oldRows = rowsOf(db.exec(
    "SELECT COUNT(*) AS c FROM audit_log WHERE timestamp < ?",
    [cutoff]
  ))[0].c;
  console.log('---');
  console.log('Cutoff       :', cutoff);
  console.log('Rows older than retention :', oldRows);

  if (!DRY_RUN && oldRows > 0) {
    db.run('DELETE FROM audit_log WHERE timestamp < ?', [cutoff]);
  }

  // Step 2: dedupe consecutive identical previous_snapshot per attendance_id.
  // Use sqlite's window function via subquery: keep min(id) per (attendance_id, snapshot_run)
  // where snapshot_run is grouped by consecutive identical snapshots.
  // Approach: for each attendance_id ordered by id ASC, compare current snapshot
  // to the PREVIOUS row's snapshot — if identical, mark for delete.
  //
  // sql.js (SQLite 3.x with window functions) supports LAG().
  const dupesQ = `
    WITH ordered AS (
      SELECT id, attendance_id, previous_snapshot,
             LAG(previous_snapshot) OVER (PARTITION BY attendance_id ORDER BY id) AS prev_snap
        FROM audit_log
    )
    SELECT id FROM ordered
     WHERE previous_snapshot IS NOT NULL
       AND prev_snap IS NOT NULL
       AND previous_snapshot = prev_snap
  `;
  const dupRows = rowsOf(db.exec(dupesQ));
  console.log('---');
  console.log('Consecutive-duplicate rows to drop :', dupRows.length);

  if (!DRY_RUN && dupRows.length > 0) {
    // Delete in chunks to avoid one giant IN-clause
    const ids = dupRows.map((r) => r.id);
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      db.run(`DELETE FROM audit_log WHERE id IN (${placeholders})`, chunk);
    }
  }

  // Step 3: VACUUM
  if (!DRY_RUN) {
    console.log('VACUUM ...');
    db.run('VACUUM');
  }

  const afterRows = rowsOf(db.exec('SELECT COUNT(*) AS c FROM audit_log'))[0].c;
  const afterBytes = rowsOf(db.exec(
    "SELECT SUM(LENGTH(previous_snapshot)) AS b FROM audit_log"
  ))[0].b || 0;
  console.log('---');
  console.log('After:');
  console.log('  audit_log rows                :', afterRows, '(\u0394', afterRows - beforeRows, ')');
  console.log('  total previous_snapshot bytes :', fmt(afterBytes), '(\u0394', fmt(afterBytes - beforeBytes), ')');

  if (DRY_RUN) {
    console.log('---');
    console.log('DRY-RUN: nothing was written.');
    db.close();
    app.quit();
    return;
  }

  // Re-encrypt + atomic write back.
  console.log('Exporting compacted DB ...');
  const outRaw = Buffer.from(db.export());
  console.log('New plaintext size :', fmt(outRaw.length));
  const outEnc = encryptBuffer(outRaw, masterKey);
  console.log('New encrypted size :', fmt(outEnc.length));
  writeAtomicSync(dbPath, outEnc);
  const newSize = fs.statSync(dbPath).size;
  console.log('Wrote DB. On-disk size :', fmt(newSize));
  console.log('Reclaimed             :', fmt(fileBuf.length - newSize));

  db.close();
  app.quit();
}

app.whenReady().then(() => {
  run().catch((err) => {
    console.error('[compact] failed:', err && err.stack ? err.stack : err);
    app.exit(1);
  });
});
