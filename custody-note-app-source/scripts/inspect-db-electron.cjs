/* Read-only DB diagnostic that runs inside Electron so it can use safeStorage
 * to fetch the master key and decrypt attendances.db. Prints schema, row counts,
 * per-table footprint via dbstat, and BLOB/TEXT column stats.
 *
 * Run with:  npx electron scripts/inspect-db-electron.cjs
 *
 * Does not modify the database. The full raw DB stays in memory only.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

/* CRITICAL: when launched via `npx electron`, the default userData dir is
 * %APPDATA%\Electron, not the production app's %APPDATA%\custody-note.
 * Force the name + path so safeStorage and DB lookups hit the real data. */
app.setName('custody-note');
try {
  const realUserData = path.join(process.env.APPDATA || app.getPath('appData'), 'custody-note');
  app.setPath('userData', realUserData);
} catch (e) {
  console.warn('[inspect] could not override userData:', e.message);
}

const MAGIC = 'CNDB';

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
      console.warn('[inspect] safeStorage decrypt failed:', err.message);
    }
  }
  if (fs.existsSync(fallbackPath)) {
    const raw = fs.readFileSync(fallbackPath);
    const k = _decryptFallbackKey(raw);
    if (k && k.length === 64) return k;
    const plaintext = raw.toString('utf8').trim();
    if (plaintext && plaintext.length === 64 && /^[0-9a-f]+$/.test(plaintext)) return plaintext;
  }
  throw new Error('Could not load master key — neither safeStorage nor fallback worked.');
}

function decryptBuffer(buf, masterKeyHex) {
  if (!buf || buf.length < 4) throw new Error('DB file too small.');
  if (buf.slice(0, 4).toString() !== MAGIC) {
    return buf;
  }
  const iv = buf.slice(4, 16);
  const tag = buf.slice(16, 32);
  const data = buf.slice(32);
  const key = Buffer.from(masterKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

async function run() {
  const userData = app.getPath('userData');
  const dbPath = process.argv.find((a) => a.endsWith('.db')) || path.join(userData, 'attendances.db');

  console.log('userData :', userData);
  console.log('DB path  :', dbPath);
  const fileBuf = fs.readFileSync(dbPath);
  console.log('On-disk size :', fmt(fileBuf.length));

  const masterKey = loadMasterKey(userData);
  console.log('Master key loaded (length', masterKey.length, 'hex chars).');

  const t0 = Date.now();
  const raw = decryptBuffer(fileBuf, masterKey);
  console.log('Decrypted size :', fmt(raw.length), '(', Date.now() - t0, 'ms)');
  console.log('Decrypted header:', raw.slice(0, 16).toString('utf8').replace(/[^\x20-\x7e]/g, '.'));
  console.log('---');

  const SQL = await initSqlJs();
  const db = new SQL.Database(raw);

  const pageSize = rowsOf(db.exec('PRAGMA page_size'))[0].page_size;
  const pageCount = rowsOf(db.exec('PRAGMA page_count'))[0].page_count;
  const freelistCount = rowsOf(db.exec('PRAGMA freelist_count'))[0].freelist_count;
  console.log(`page_size=${pageSize}  page_count=${pageCount}  freelist_count=${freelistCount}`);
  console.log(`logical pages used: ${fmt((pageCount - freelistCount) * pageSize)} / file ${fmt(pageCount * pageSize)}`);
  console.log(`free pages (would be reclaimed by VACUUM): ${fmt(freelistCount * pageSize)}`);
  console.log('---');

  let dbstatRows = [];
  let dbstatAvailable = true;
  try {
    dbstatRows = rowsOf(db.exec(
      "SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages FROM dbstat GROUP BY name ORDER BY bytes DESC"
    ));
  } catch (_) {
    dbstatAvailable = false;
  }
  if (dbstatAvailable && dbstatRows.length) {
    console.log('Per-object byte usage (dbstat):');
    console.log('  bytes        pages   name');
    for (const r of dbstatRows) {
      console.log(`  ${fmt(r.bytes).padEnd(12)} ${String(r.pages).padEnd(7)} ${r.name}`);
    }
    console.log('---');
  } else {
    console.log('(dbstat not available — skipping byte breakdown)');
  }

  const userTables = rowsOf(db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )).map((r) => r.name);

  console.log('Per-table row counts + columns:');
  for (const t of userTables) {
    let count = 'err';
    try {
      count = rowsOf(db.exec(`SELECT COUNT(*) AS c FROM "${t}"`))[0].c;
    } catch (e) {
      count = 'err: ' + e.message;
    }
    let cols = [];
    try {
      cols = rowsOf(db.exec(`PRAGMA table_info("${t}")`)).map((c) => `${c.name}:${c.type || 'untyped'}`);
    } catch (_) {}
    console.log(`  ${t}  rows=${count}  cols=[${cols.join(', ')}]`);
  }
  console.log('---');

  console.log('BLOB / TEXT column footprint per table:');
  for (const t of userTables) {
    let cols = [];
    try {
      cols = rowsOf(db.exec(`PRAGMA table_info("${t}")`));
    } catch (_) { continue; }
    const heavyCols = cols.filter((c) => /BLOB|TEXT/i.test(c.type || '') || (c.type || '') === '');
    if (!heavyCols.length) continue;
    let printedHeader = false;
    for (const c of heavyCols) {
      try {
        const stats = rowsOf(db.exec(
          `SELECT COUNT("${c.name}") AS non_null,
                  SUM(LENGTH("${c.name}")) AS total_bytes,
                  MAX(LENGTH("${c.name}")) AS max_bytes,
                  AVG(LENGTH("${c.name}")) AS avg_bytes
             FROM "${t}"`
        ))[0];
        if (!stats || !stats.total_bytes) continue;
        if (!printedHeader) {
          console.log(`\n  Table: ${t}`);
          printedHeader = true;
        }
        console.log(
          `    ${c.name} (${c.type || 'untyped'}): non_null=${stats.non_null}  ` +
            `total=${fmt(stats.total_bytes)}  max=${fmt(stats.max_bytes)}  ` +
            `avg=${fmt(Math.round(stats.avg_bytes || 0))}`
        );
      } catch (e) {
        console.log(`    ${c.name}: error - ${e.message}`);
      }
    }
  }
  console.log('---');

  console.log('Top 5 widest rows per table (TEXT+BLOB length sum, > 10 KB only):');
  for (const t of userTables) {
    let cols = [];
    try {
      cols = rowsOf(db.exec(`PRAGMA table_info("${t}")`));
    } catch (_) { continue; }
    const heavyCols = cols.filter((c) => /BLOB|TEXT/i.test(c.type || '') || (c.type || '') === '');
    if (!heavyCols.length) continue;
    const idCol = cols.find((c) => c.pk) || cols[0];
    const sumExpr = heavyCols.map((c) => `COALESCE(LENGTH("${c.name}"),0)`).join(' + ');
    try {
      const top = rowsOf(db.exec(
        `SELECT "${idCol.name}" AS id, ${sumExpr} AS sz FROM "${t}" ORDER BY sz DESC LIMIT 5`
      ));
      const big = top.filter((r) => r.sz > 10 * 1024);
      if (big.length) {
        console.log(`  ${t}:`);
        for (const r of big) {
          console.log(`    ${idCol.name}=${r.id}  ~${fmt(r.sz)}`);
        }
      }
    } catch (_) {}
  }

  db.close();
  app.quit();
}

app.whenReady().then(() => {
  run().catch((err) => {
    console.error('Inspector failed:', err);
    app.exit(1);
  });
});
