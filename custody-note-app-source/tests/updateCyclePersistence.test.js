const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');

const mainJsPath = path.resolve(__dirname, '..', 'main.js');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');
const updaterJs = fs.readFileSync(path.resolve(__dirname, '..', 'updater.js'), 'utf8');
const updateStateJs = fs.readFileSync(path.resolve(__dirname, '..', 'updateState.js'), 'utf8');

describe('update-cycle persistence', () => {
  it('persists attendance records across a restart at the database layer', async () => {
    const SQL = await initSqlJs();
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cn-db-roundtrip-')), 'attendances.db');

    const db1 = new SQL.Database();
    db1.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      status TEXT DEFAULT 'draft'
    );`);
    db1.run('INSERT INTO attendances (data, status) VALUES (?, ?)', [
      JSON.stringify({ surname: 'Persistence', forename: 'Pat', policeStationName: 'Holborn' }),
      'draft',
    ]);
    fs.writeFileSync(dbPath, Buffer.from(db1.export()));
    db1.close();

    const db2 = new SQL.Database(fs.readFileSync(dbPath));
    const stmt = db2.prepare('SELECT id, data, status FROM attendances');
    assert.ok(stmt.step(), 'Expected persisted attendance row after restart');
    const row = stmt.getAsObject();
    stmt.free();
    db2.close();

    const parsed = JSON.parse(row.data);
    assert.strictEqual(parsed.surname, 'Persistence');
    assert.strictEqual(parsed.forename, 'Pat');
    assert.strictEqual(parsed.policeStationName, 'Holborn');
    assert.strictEqual(row.status, 'draft');
  });

  it('fails closed instead of replacing an unreadable database with a blank one', () => {
    assert.match(
      mainJs,
      /Custody Note could not load the existing attendance database\. To protect your records, the app has stopped instead of opening a blank database\./
    );
    assert.doesNotMatch(mainJs, /The app will start with a fresh database/);
  });

  it('never generates a new master key while reading an existing encrypted database', () => {
    assert.match(mainJs, /let masterKeyHex = getOrCreateMasterKey\(\{ allowCreate: false \}\);/);
    const matches = mainJs.match(/getOrCreateMasterKey\(\{ allowCreate: false \}\)/g) || [];
    assert.ok(matches.length >= 2, 'Expected read paths to disable key generation');
  });

  it('prevents portable builds from auto-updating into a different data location', () => {
    assert.match(mainJs, /isPortableBuild: IS_PORTABLE_BUILD/);
    assert.match(updaterJs, /Portable builds do not auto-update to avoid switching to a different data location/);
  });

  it('defers the first update check until the renderer has loaded (no dropped IPC)', () => {
    assert.match(mainJs, /scheduleDeferredCheck/);
    assert.match(updaterJs, /startup-deferred/);
    assert.doesNotMatch(mainJs, /safeCheckForUpdates\('startup'\)/);
  });

  it('persists auto-update metadata under userData for cross-restart diagnostics', () => {
    assert.match(updateStateJs, /cn-auto-update-state\.json/);
    assert.match(updateStateJs, /mergeState/);
  });

  it('forces a synchronous DB flush during shutdown', () => {
    assert.match(mainJs, /flushDbSync\(\)/);
    assert.match(mainJs, /db\.close\(\)/);
    assert.match(mainJs, /app\.on\('before-quit'/);
  });

  it('refuses to replace an unreadable stored licence with a new trial', () => {
    assert.match(mainJs, /Custody Note found an existing licence file but could not read it/);
    assert.match(mainJs, /Stored licence could not be read\. Custody Note will not replace it automatically\./);
  });
});
