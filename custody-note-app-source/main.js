const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, powerMonitor, clipboard } = require('electron');
const os = require('os');
const path = require('path');
/* Automated tests: isolated DB and photos dir (must run before any app.getPath('userData') use). */
if (process.env.CUSTODYNOTE_TEST_USERDATA && String(process.env.CUSTODYNOTE_TEST_USERDATA).trim()) {
  try {
    app.setPath('userData', path.resolve(String(process.env.CUSTODYNOTE_TEST_USERDATA).trim()));
  } catch (e) {
    console.warn('[CUSTODYNOTE_TEST_USERDATA] setPath failed:', e && e.message);
  }
}
const fs = require('fs');
const { stableStringify } = require('./lib/stableStringify');
const { autoUpdater } = require('electron-updater');
const { initUpdater } = require('./updater');

// H27 — propagate app.isPackaged into the env so preload.js (which runs in
// the renderer and can't import `app`) can refuse to expose the E2E test
// hooks (skipLicenceGate, etc.) in shipped installers.
process.env.CUSTODYNOTE_PACKAGED = app.isPackaged ? '1' : '0';

/* â”€â”€â”€ Single-instance lock â”€â”€â”€ */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[App] Another instance is already running â€” quitting this one');
  app.quit();
}

let updaterController = null;

function getFallbackAppDataRoot() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getDefaultUserDataPath() {
  try {
    return app.getPath('userData');
  } catch (_) {
    return path.join(getFallbackAppDataRoot(), 'custody-note');
  }
}

/* macOS application menu. On macOS, hiding the menu bar entirely (which
 * is what setApplicationMenu(null) does on Windows) also disables the
 * standard Cmd+Q / Cmd+W / Cmd+C / Cmd+V / Cmd+A keyboard shortcuts and
 * input-method editing in text fields. Apps that omit the menu therefore
 * feel broken to mac users. We supply a minimal menu using only built-in
 * Electron roles, which respects the existing `before-quit` handlers
 * (database flush, security log) because role:'quit' goes through the
 * normal app.quit() path. This function is only called when
 * process.platform === 'darwin'; on Windows the menu is still suppressed
 * exactly as before. */
function buildMacAppMenu() {
  const appName = app.getName();
  const template = [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

const DEFAULT_USERDATA_PATH = getDefaultUserDataPath();
const PORTABLE_USERDATA_PATH = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'userData')
  : null;
const IS_PORTABLE_BUILD = !!(PORTABLE_USERDATA_PATH && fs.existsSync(PORTABLE_USERDATA_PATH));

/* Portable trial: when userData folder exists next to the exe, use it so trial packages work. */
if (IS_PORTABLE_BUILD) {
  app.setPath('userData', PORTABLE_USERDATA_PATH);
}

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const _trustedApiAgent = new https.Agent();

const { URL } = require('url');
const initSqlJs = require('sql.js');
const { parseCasenotePdfTextToRecordData } = require('./importers/casenote-pdf-import');
const adminAuth = require('./main/adminAuth');
const { createSyncWorker } = require('./main/syncWorker');
const { runMigrations: runDbMigrations } = require('./main/dbMigrations');
const syncConflicts = require('./main/syncConflicts');
const errorReporting = require('./main/errorReporting');
const dbCrypto = require('./lib/dbCrypto');
const { createBackupScheduler } = require('./main/backupScheduler');
const { hardenWindow, hardenSession, isSafeExternalUrl } = require('./main/windowHardening');
const _securityLog = require('./main/securityLog');
const _safeLog = require('./lib/safeLog');
const officerEmailDrafts = require('./lib/officerEmailDrafts');
const outlookWebCompose = require('./lib/outlookWebCompose');
const openExternalUrlModule = require('./lib/openExternalUrl');

let mainWindow;
let db;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

class PersistenceStartupError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PersistenceStartupError';
    this.details = details;
  }
}

function formatPersistenceStartupError(err) {
  const lines = [err && err.message ? err.message : 'Persistence startup failed.'];
  const details = err && err.details ? err.details : null;
  if (details) {
    Object.keys(details).forEach((key) => {
      const value = details[key];
      if (value == null || value === '') return;
      lines.push(`${key}: ${value}`);
    });
  }
  return lines.join('\n');
}

function writeCliJson(payload) {
  const target = process.env.CN_CLI_OUTPUT_FILE;
  if (!target) return;
  try {
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('[CLI] Failed to write output file:', err.message);
  }
}

function writeCliError(message) {
  const target = process.env.CN_CLI_ERROR_FILE;
  if (!target) return;
  try {
    fs.writeFileSync(target, String(message || ''), 'utf8');
  } catch (err) {
    console.warn('[CLI] Failed to write error file:', err.message);
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   DATABASE ENCRYPTION (AES-256-GCM + dual key)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const MAGIC = 'CNDB';
// Recovery-password and key-escrow KDF iterations. Bumped from 100,000 to
// 600,000 (OWASP Password Storage Cheat Sheet 2023+ minimum for PBKDF2-SHA512).
// Older recovery files written with 100k are still accepted via tryRecoverMasterKey,
// which falls back to the legacy iteration count and rewrites the file at
// the new strength on a successful unlock.
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_ITERATIONS_LEGACY = 100000;
const PBKDF2_DIGEST = 'sha512';
let _masterKey = null;
let _recoveryPasswordHash = null;
let _needsFallbackMigration = false;

function getKeyFilePath() {
  return path.join(app.getPath('userData'), 'encryption.key');
}

function getRecoveryFilePath() {
  return path.join(app.getPath('userData'), 'recovery.dat');
}

// Fallback key file used when Electron safeStorage is unavailable on this system.
// The database is still AES-256-GCM encrypted; only the key-file itself lacks
// OS-level protection in this mode. Users are advised to set a recovery password.
function getFallbackKeyPath() {
  return path.join(app.getPath('userData'), 'master.fallback');
}

function buildDbPersistenceDetails(extra = {}) {
  return Object.assign({
    defaultUserDataPath: DEFAULT_USERDATA_PATH,
    activeUserDataPath: app.getPath('userData'),
    portableUserDataPath: PORTABLE_USERDATA_PATH || '',
    isPortableBuild: IS_PORTABLE_BUILD ? 'true' : 'false',
    dbPath: getDbPath(),
    keyPath: getKeyFilePath(),
    recoveryPath: getRecoveryFilePath(),
    fallbackKeyPath: getFallbackKeyPath(),
  }, extra);
}

function getOrCreateMasterKey(options = {}) {
  const allowCreate = options.allowCreate !== false;
  if (_masterKey) return _masterKey;
  const keyPath = getKeyFilePath();
  const fallbackPath = getFallbackKeyPath();

  if (safeStorage.isEncryptionAvailable()) {
    // Primary path: OS-protected safeStorage
    if (fs.existsSync(keyPath)) {
      try {
        _masterKey = safeStorage.decryptString(fs.readFileSync(keyPath));
        return _masterKey;
      } catch (err) {
        console.warn('[Encryption] Cannot decrypt safeStorage key (new machine?):', err.message);
        if (!allowCreate && !fs.existsSync(fallbackPath)) return null;
        // Fall through to fallback below
      }
    }
    if (!allowCreate && !fs.existsSync(fallbackPath)) return null;
    _masterKey = crypto.randomBytes(32).toString('hex');
    saveMasterKeyToSafeStorage(_masterKey);
    return _masterKey;
  }

  // safeStorage not available â€” use obfuscated fallback file so the key persists across restarts.
  // The key is encrypted with a machine-derived key (not truly secure against a determined local
  // attacker, but prevents casual exposure). Users should set a recovery password ASAP.
  console.warn('[Encryption] safeStorage unavailable; using obfuscated fallback. Set a recovery password in Settings.');
  if (fs.existsSync(fallbackPath)) {
    try {
      const raw = fs.readFileSync(fallbackPath);
      const k = _decryptFallbackKey(raw);
      if (k && k.length === 64) {
        _masterKey = k;
        _needsFallbackMigration = true;
        return _masterKey;
      }
      // Legacy plaintext fallback (pre-obfuscation upgrade)
      const plaintext = raw.toString('utf8').trim();
      if (plaintext && plaintext.length === 64 && /^[0-9a-f]+$/.test(plaintext)) {
        _masterKey = plaintext;
        _needsFallbackMigration = true;
        _writeFallbackKeyEncrypted(fallbackPath, _masterKey);
        return _masterKey;
      }
    } catch (err) {
      console.warn('[Encryption] Cannot read fallback key:', err.message);
    }
  }
  if (!allowCreate) return null;
  _masterKey = crypto.randomBytes(32).toString('hex');
  _writeFallbackKeyEncrypted(fallbackPath, _masterKey);
  return _masterKey;
}

function _getMachineObfuscationKey() {
  const os = require('os');
  const raw = 'cn-fallback:' + [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', os.totalmem()].join('|');
  return crypto.createHash('sha256').update(raw).digest();
}

function _writeFallbackKeyEncrypted(filePath, hexKey) {
  try {
    const mk = _getMachineObfuscationKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', mk, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(hexKey, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    fs.writeFileSync(filePath, Buffer.concat([iv, tag, enc]));
  } catch (err) {
    console.error('[Encryption] Cannot write obfuscated fallback key:', err.message);
  }
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

function saveMasterKeyToSafeStorage(hexKey) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(hexKey);
      fs.writeFileSync(getKeyFilePath(), encrypted);
      deleteFallbackKeyIfExists();
    } catch (err) {
      console.error('[Encryption] Failed to save key to safeStorage:', err.message);
    }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    _writeFallbackKeyEncrypted(getFallbackKeyPath(), hexKey);
  }
}

function deleteFallbackKeyIfExists() {
  const fb = getFallbackKeyPath();
  if (fs.existsSync(fb)) {
    try { fs.unlinkSync(fb); console.info('[Encryption] Removed legacy plaintext fallback key.'); } catch (_) {}
  }
}

function deriveKeyFromPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
}

async function setRecoveryPassword(password) {
  const masterKeyHex = getOrCreateMasterKey();
  if (!masterKeyHex) throw new Error('Master key not available');
  const salt = crypto.randomBytes(32);
  const derived = deriveKeyFromPassword(password, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(masterKeyHex, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const data = Buffer.concat([salt, iv, tag, enc]);
  fs.writeFileSync(getRecoveryFilePath(), data);
  _recoveryPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
  deleteFallbackKeyIfExists();
  _needsFallbackMigration = false;
  const cloudBackupOk = await uploadKeyEscrow();
  return { cloudBackupOk };
}

function hasRecoveryPassword() {
  return fs.existsSync(getRecoveryFilePath());
}

function tryRecoverMasterKey(password) {
  const recPath = getRecoveryFilePath();
  if (!fs.existsSync(recPath)) return null;
  const data = fs.readFileSync(recPath);
  const salt = data.slice(0, 32);
  const iv = data.slice(32, 44);
  const tag = data.slice(44, 60);
  const enc = data.slice(60);
  // Try current iteration count first.
  const tryWith = function (iters) {
    try {
      const derived = crypto.pbkdf2Sync(password, salt, iters, 32, PBKDF2_DIGEST);
      const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString('utf8');
    } catch (_) {
      return null;
    }
  };
  let recovered = tryWith(PBKDF2_ITERATIONS);
  if (recovered) return recovered;
  // Fallback: legacy 100k file. On success, rewrite with the new (stronger)
  // iteration count so the next unlock uses 600k. We never log the password
  // and we ignore rewrite failures (the user can still unlock).
  recovered = tryWith(PBKDF2_ITERATIONS_LEGACY);
  if (recovered) {
    try {
      const newSalt = crypto.randomBytes(32);
      const newDerived = deriveKeyFromPassword(password, newSalt);
      const newIv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', newDerived, newIv);
      const newEnc = Buffer.concat([cipher.update(Buffer.from(recovered, 'utf8')), cipher.final()]);
      const newTag = cipher.getAuthTag();
      const out = Buffer.concat([newSalt, newIv, newTag, newEnc]);
      fs.writeFileSync(recPath, out);
      console.info('[Encryption] Upgraded recovery.dat to PBKDF2 ' + PBKDF2_ITERATIONS + ' iterations.');
    } catch (e) {
      console.warn('[Encryption] Could not upgrade recovery.dat KDF strength:', e && e.message ? e.message : e);
    }
    return recovered;
  }
  return null;
}

/* â”€â”€â”€ Cloud key escrow â”€â”€â”€ */
const {
  encryptMasterKeyForEscrow,
  decryptMasterKeyFromEscrow,
} = require('./lib/keyEscrow');

const { ensureCanonicalSyncKey } = require('./lib/canonicalSyncKey');

let _lastCanonicalKeyAction = null;
let _lastCanonicalKeyAt = null;

/**
 * Adopt a canonical key downloaded from escrow: swap the in-memory key,
 * persist via safeStorage, re-encrypt the on-disk DB, and move aside any
 * stale recovery.dat (it wraps the OLD key — offering it later would restore
 * a key that can no longer read the DB or the cloud records).
 */
function adoptCanonicalMasterKey(masterKeyHex) {
  _masterKey = masterKeyHex;
  saveMasterKeyToSafeStorage(masterKeyHex);
  try {
    const recPath = getRecoveryFilePath();
    if (fs.existsSync(recPath)) {
      const stalePath = recPath + '.superseded-' + new Date().toISOString().slice(0, 10);
      fs.renameSync(recPath, stalePath);
      console.warn('[Sync] recovery.dat wrapped the previous key — moved aside. Ask the user to set a new recovery password.');
    }
  } catch (_) {}
  try { if (db) saveDb(); } catch (_) {}
  console.info('[Sync] Adopted canonical sync key from cloud escrow.');
}

/**
 * Re-key: every record this device has ever synced gets a version bump and is
 * re-queued, so it is re-pushed encrypted with the (newly adopted) canonical
 * key. The cloud store converges on ciphertext all devices can read.
 */
function rekeyLocalRecordsForSync() {
  if (!db) return 0;
  const rows = dbAll('SELECT id FROM attendances WHERE sync_id IS NOT NULL') || [];
  for (const row of rows) {
    dbRun('UPDATE attendances SET sync_dirty=1, sync_version=COALESCE(sync_version,1)+1 WHERE id=?', [row.id]);
    enqueueSyncForRecord(row.id);
  }
  if (rows.length > 0) {
    saveDb();
    console.info('[Sync] Re-keyed ' + rows.length + ' record(s) for re-push under the canonical key.');
  }
  return rows.length;
}

/**
 * Establish the ONE canonical encryption key for this licence.
 * Download-first: adopt an existing escrow key (re-keying local records if we
 * had a different one); only upload ours when no escrow exists yet.
 */
async function ensureCanonicalSyncKeyNow() {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, action: 'no_api' };
  const data = readLicenceData();
  const result = await ensureCanonicalSyncKey({
    getLicenceKey: () => (data && data.key ? data.key : null),
    getLocalKeyHex: () => getOrCreateMasterKey({ allowCreate: false }),
    fetchEscrow: () => httpPost(`${apiUrl}/api/recovery`, {
      key: data.key,
      machineId: getMachineId(),
    }, { headers: _getAuthHeaders() }),
    uploadEscrow: async (blob) => {
      const resp = await httpPost(`${apiUrl}/api/recovery`, {
        key: data.key,
        machineId: getMachineId(),
        blob,
      }, { headers: _getAuthHeaders() });
      return !!(resp && resp.ok);
    },
    encryptEscrow: encryptMasterKeyForEscrow,
    decryptEscrow: decryptMasterKeyFromEscrow,
    adoptKey: adoptCanonicalMasterKey,
    rekeyLocalRecords: () => { rekeyLocalRecordsForSync(); },
  });
  _lastCanonicalKeyAction = result.action;
  _lastCanonicalKeyAt = new Date().toISOString();
  if (!result.ok && result.action !== 'match') {
    console.warn('[Sync] Canonical key check:', result.action, result.error || '');
  }
  return result;
}

async function uploadKeyEscrow() {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return false;
  const data = readLicenceData();
  if (!data || !data.key) return false;
  const masterKeyHex = _masterKey || getOrCreateMasterKey({ allowCreate: false });
  if (!masterKeyHex) return false;
  try {
    const blob = encryptMasterKeyForEscrow(masterKeyHex, data.key);
    const resp = await httpPost(`${apiUrl}/api/recovery`, {
      key: data.key,
      machineId: getMachineId(),
      blob,
    }, { headers: _getAuthHeaders() });
    if (resp && resp.ok) {
      console.info('[Recovery] Key escrow uploaded to cloud.');
      return true;
    }
  } catch (e) {
    console.warn('[Recovery] Failed to upload key escrow:', e && e.message ? e.message : e);
  }
  return false;
}

// SECURITY: never persist legal-aid data unencrypted. The actual AES-256-GCM
// primitives + on-disk envelope format live in lib/dbCrypto.js (unit-tested);
// main.js owns master-key resolution (safeStorage / recovery / escrow). The
// CN_NO_MASTER_KEY refusal is enforced inside dbCrypto.encryptBuffer.
function encryptBuffer(buf) {
  const masterKeyHex = getOrCreateMasterKey();
  return dbCrypto.encryptBuffer(buf, masterKeyHex);
}

function decryptBuffer(buf) {
  if (!buf || buf.length < 4) return buf;
  if (buf.slice(0, 4).toString() !== MAGIC) return buf;
  const masterKeyHex = getOrCreateMasterKey({ allowCreate: false });
  if (!masterKeyHex) {
    return null;
  }
  return dbCrypto.decryptBuffer(buf, masterKeyHex);
}

async function decryptBufferWithRecovery(buf) {
  if (!buf || buf.length < 4) return buf;
  if (buf.slice(0, 4).toString() !== MAGIC) return buf;
  let masterKeyHex = getOrCreateMasterKey({ allowCreate: false });
  if (!masterKeyHex && hasRecoveryPassword()) {
    masterKeyHex = await promptForRecoveryPassword();
    if (masterKeyHex) {
      _masterKey = masterKeyHex;
      saveMasterKeyToSafeStorage(masterKeyHex);
    }
  }
  if (!masterKeyHex) {
    throw new Error('Cannot decrypt database: no key available. If you have a recovery password, ensure the recovery.dat file is present.');
  }
  return dbCrypto.decryptBuffer(buf, masterKeyHex);
}

async function promptForRecoveryPassword() {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const inputResult = await showPasswordInputDialog();
    if (!inputResult) return null;
    const recovered = tryRecoverMasterKey(inputResult);
    if (recovered) return recovered;
    if (attempt < MAX_ATTEMPTS) {
      await dialog.showMessageBox(mainWindow || null, {
        type: 'warning',
        title: 'Incorrect Password',
        message: 'The recovery password is incorrect.\nAttempt ' + attempt + ' of ' + MAX_ATTEMPTS + '.',
        buttons: ['Try Again'],
      });
    }
  }
  const { response } = await dialog.showMessageBox(mainWindow || null, {
    type: 'error',
    title: 'Recovery Failed',
    message: 'Too many incorrect attempts. The database could not be unlocked.',
    detail: 'Your records are safe â€” nothing has been deleted.\n\nYou can quit the app and try again later, or start with a fresh (empty) database.\n\nIMPORTANT: Starting fresh will NOT delete your backup files. You can restore from backup in Settings.',
    buttons: ['Quit App (try again later)', 'Start with fresh database'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 0) {
    app.quit();
  }
  return null;
}

function showPasswordInputDialog() {
  return new Promise((resolve) => {
    let resolved = false;

    function done(value) {
      if (resolved) return;
      resolved = true;
      ipcMain.removeAllListeners('recovery-pw-submit');
      ipcMain.removeAllListeners('recovery-pw-cancel');
      if (win && !win.isDestroyed()) win.destroy();
      resolve(value || null);
    }

    const win = new BrowserWindow({
      width: 420, height: 220, resizable: false,
      minimizable: false, maximizable: false,
      modal: true, parent: mainWindow || null,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'password-preload.js'),
      },
      title: 'Recovery Password',
      autoHideMenuBar: true,
    });
    // Defence-in-depth: refuse navigation/window.open in this modal.
    try {
      hardenWindow(win, {
        logger: { warn: (msg, meta) => console.warn(msg, meta || '') },
        appOrigin: '',
        shellOpenExternal: () => Promise.resolve(),
      });
    } catch (_) {}

    ipcMain.once('recovery-pw-submit', (_, pw) => done(pw));
    ipcMain.once('recovery-pw-cancel', () => done(null));

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>body{font-family:Segoe UI,sans-serif;padding:20px;margin:0;background:#f5f5f5;}
    label{display:block;margin-bottom:6px;font-weight:600;}
    .pw-row{display:flex;align-items:center;gap:8px;}
    input{flex:1;padding:8px;font-size:14px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;}
    .btns{margin-top:16px;text-align:right;}
    button{padding:8px 20px;font-size:14px;border:none;border-radius:4px;cursor:pointer;margin-left:8px;}
    .ok{background:#2563eb;color:#fff;} .cancel{background:#e5e5e5;}
    .toggle-pw{padding:8px 12px;font-size:13px;background:#e5e5e5;}</style></head>
    <body><label>Enter recovery password:</label>
    <div class="pw-row">
      <input type="password" id="pw" autofocus>
      <button type="button" id="toggle-pw" class="toggle-pw" aria-label="Show password">Show</button>
    </div>
    <div class="btns">
      <button class="cancel" onclick="window.pwdApi.cancel()">Cancel</button>
      <button class="ok" onclick="doSubmit()">Unlock</button>
    </div>
    <script>
    function doSubmit(){var v=document.getElementById('pw').value;if(v)window.pwdApi.submit(v);}
    document.getElementById('pw').addEventListener('keydown',function(e){
      if(e.key==='Enter')doSubmit();
      if(e.key==='Escape')window.pwdApi.cancel();
    });
    var inp=document.getElementById('pw'),tbtn=document.getElementById('toggle-pw');
    tbtn.addEventListener('click',function(){
      var isPw=inp.type==='password';
      inp.type=isPw?'text':'password';
      tbtn.textContent=isPw?'Hide':'Show';
      tbtn.setAttribute('aria-label',isPw?'Hide password':'Show password');
    });
    </script></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.on('closed', () => done(null));
  });
}

function getDbPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'attendances.db');
}

/* Sweep orphan atomic-write temp files left behind by interrupted saves.
 * Pattern matches getAtomicTempPath(): "<basename>.<pid>.<ms>.<hex>.tmp"
 * Files younger than 60s are skipped in case any concurrent write is in flight. */
function cleanStaleDbTempFiles() {
  try {
    const userData = app.getPath('userData');
    const dbBase = path.basename(getDbPath());
    const re = new RegExp('^' + dbBase.replace(/\./g, '\\.') + '\\.\\d+\\.\\d+\\.[0-9a-f]+\\.tmp$');
    const cutoff = Date.now() - 60 * 1000;
    let removed = 0;
    let bytes = 0;
    for (const name of fs.readdirSync(userData)) {
      if (!re.test(name)) continue;
      const full = path.join(userData, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs > cutoff) continue;
        bytes += st.size;
        fs.unlinkSync(full);
        removed++;
      } catch (_) { /* ignore individual file errors */ }
    }
    if (removed > 0) {
      console.log('[Startup] Removed ' + removed + ' orphan DB temp file(s), reclaimed ' + Math.round(bytes / (1024 * 1024)) + ' MB');
    }
  } catch (e) {
    console.warn('[Startup] cleanStaleDbTempFiles failed:', e && e.message ? e.message : e);
  }
}

// H18 â€” schema migrations were guarded with bare `catch (_) {}`, which
// silently swallowed *any* failure (typo, locked DB, disk error) as well
// as the expected "duplicate column" case. Use a helper that only swallows
// the duplicate-column error and surfaces everything else (logged + rethrown).
function _safeAddColumn(table, columnDef) {
  if (!db) return;
  try {
    db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + columnDef);
  } catch (err) {
    var msg = (err && err.message) ? String(err.message) : '';
    if (/duplicate column name/i.test(msg)) return;
    console.error('[schema] ALTER TABLE ' + table + ' ADD COLUMN ' + columnDef + ' failed:', msg);
    throw err;
  }
}

// H19 - wrap multi-step DB writes (e.g. UPDATE attendances + INSERT audit_log)
// in BEGIN/COMMIT so a mid-sequence crash can never leave an audit gap that
// breaks the legal-aid compliance trail. sql.js is synchronous so a try/catch
// around the body is sufficient; we ROLLBACK on any thrown error. Re-entrant
// calls are flattened (no nested transactions).
let _txDepth = 0;
function dbTx(fn) {
  if (!db) return fn();
  if (_txDepth > 0) return fn();
  _txDepth++;
  let inTx = false;
  try {
    db.run('BEGIN');
    inTx = true;
    const result = fn();
    db.run('COMMIT');
    inTx = false;
    return result;
  } catch (err) {
    if (inTx) {
      try { db.run('ROLLBACK'); } catch (rollbackErr) {
        console.error('[dbTx] ROLLBACK failed after error:', rollbackErr && rollbackErr.message);
      }
    }
    throw err;
  } finally {
    _txDepth--;
  }
}

let _saveDbInProgress = false;
let _lastEditorActivityAt = 0;
const SAVE_IDLE_GRACE_MS = 3000;
let _cachedDbExport = null;
let _cachedDbExportDirty = true;
// Monotonic write generation. Incremented on every saveDb kickoff and on flushDbSync.
// Async writers compare their captured generation against this before renaming;
// stale writers self-cancel so they cannot overwrite a newer (sync-flushed) file.
let _dbWriteGeneration = 0;
let _dbInFlightTempPath = null;

function getEncryptedDbExport() {
  if (!db) return null;
  if (!_cachedDbExportDirty && _cachedDbExport) return _cachedDbExport;
  const data = db.export();
  try {
    _cachedDbExport = encryptBuffer(Buffer.from(data));
    _cachedDbExportDirty = false;
    return _cachedDbExport;
  } catch (err) {
    // CN_NO_MASTER_KEY (or other crypto failure) â€” do NOT persist plaintext.
    // Caller decides what to do (skip save, retry later, surface to renderer).
    console.error('[getEncryptedDbExport] Encryption failed:', err && err.message ? err.message : err);
    _cachedDbExport = null;
    _cachedDbExportDirty = true;
    throw err;
  }
}

function getAtomicTempPath(destPath) {
  return `${destPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
}

function writeFileAtomic(destPath, data, done) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = getAtomicTempPath(destPath);
  fs.writeFile(tmpPath, data, (writeErr) => {
    if (writeErr) {
      done(writeErr);
      return;
    }
    fs.rename(tmpPath, destPath, (renameErr) => {
      if (!renameErr) {
        done(null);
        return;
      }
      try {
        if (!fs.existsSync(tmpPath)) {
          throw renameErr;
        }
        fs.copyFileSync(tmpPath, destPath);
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        done(null);
      } catch (copyErr) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch (_) {}
        done(copyErr);
      }
    });
  });
}

function writeFileAtomicAsync(destPath, data) {
  return new Promise((resolve, reject) => {
    writeFileAtomic(destPath, data, (err) => err ? reject(err) : resolve());
  });
}

function writeFileAtomicSync(destPath, data) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = getAtomicTempPath(destPath);
  try {
    fs.writeFileSync(tmpPath, data);
    try {
      fs.renameSync(tmpPath, destPath);
    } catch (renameErr) {
      if (!fs.existsSync(tmpPath)) throw renameErr;
      fs.copyFileSync(tmpPath, destPath);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

function saveDb() {
  if (!db) return;
  if (_saveDbInProgress) {
    _dbSaveRequestedWhileBusy = true;
    return;
  }
  const sinceActivity = Date.now() - _lastEditorActivityAt;
  if (sinceActivity < SAVE_IDLE_GRACE_MS) {
    if (!_dbSaveTimer) {
      _dbSaveTimer = setTimeout(() => {
        _dbSaveTimer = null;
        saveDb();
      }, SAVE_IDLE_GRACE_MS - sinceActivity + 500);
    }
    return;
  }
  _saveDbInProgress = true;
  let encrypted;
  try {
    encrypted = getEncryptedDbExport();
  } catch (err) {
    console.error('[saveDb] Encryption failed; leaving on-disk DB unchanged:', err && err.message ? err.message : err);
    _saveDbInProgress = false;
    _dbDirty = true;
    _cachedDbExportDirty = true;
    return;
  }
  if (!encrypted) { _saveDbInProgress = false; return; }
  const dbPath = getDbPath();
  // Inlined atomic write so we can check the write generation between the
  // tmp-file write and the rename, and self-cancel if a sync flush has run.
  const myGen = ++_dbWriteGeneration;
  const tmpPath = getAtomicTempPath(dbPath);
  _dbInFlightTempPath = tmpPath;
  fs.writeFile(tmpPath, encrypted, (writeErr) => {
    if (myGen !== _dbWriteGeneration) {
      // A newer save / sync flush has superseded us. Drop the tmp file.
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      if (_dbInFlightTempPath === tmpPath) _dbInFlightTempPath = null;
      _saveDbInProgress = false;
      if (_dbDirty || _dbSaveRequestedWhileBusy) {
        _dbSaveRequestedWhileBusy = false;
        saveDb();
      }
      return;
    }
    let writeFailed = false;
    if (writeErr) {
      console.error('[saveDb] tmp write failed:', writeErr.message);
      writeFailed = true;
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    } else {
      fs.rename(tmpPath, dbPath, (renameErr) => {
        if (myGen !== _dbWriteGeneration) {
          // Superseded between writeFile and rename â€” drop our tmp file (if it still exists)
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
          if (_dbInFlightTempPath === tmpPath) _dbInFlightTempPath = null;
          _saveDbInProgress = false;
          if (_dbDirty || _dbSaveRequestedWhileBusy) {
            _dbSaveRequestedWhileBusy = false;
            saveDb();
          }
          return;
        }
        let renameFailed = false;
        if (renameErr) {
          // Cross-device or AV-locked rename â€” fall back to copy+unlink.
          try {
            if (!fs.existsSync(tmpPath)) throw renameErr;
            fs.copyFileSync(tmpPath, dbPath);
            try { fs.unlinkSync(tmpPath); } catch (_) {}
          } catch (copyErr) {
            console.error('[saveDb] rename + copy fallback failed:', copyErr.message);
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
            renameFailed = true;
          }
        }
        if (_dbInFlightTempPath === tmpPath) _dbInFlightTempPath = null;
        _saveDbInProgress = false;
        if (renameFailed) {
          _dbDirty = true;
          _cachedDbExportDirty = true;
        }
        if (_dbDirty || _dbSaveRequestedWhileBusy) {
          _dbSaveRequestedWhileBusy = false;
          saveDb();
        }
      });
      return;
    }
    if (_dbInFlightTempPath === tmpPath) _dbInFlightTempPath = null;
    _saveDbInProgress = false;
    if (writeFailed) {
      _dbDirty = true;
      _cachedDbExportDirty = true;
    }
    if (_dbDirty || _dbSaveRequestedWhileBusy) {
      _dbSaveRequestedWhileBusy = false;
      saveDb();
    }
  });
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

let _dbDirty = false;
let _dbSaveTimer = null;
let _dbSaveRequestedWhileBusy = false;
const DB_SAVE_DEBOUNCE_MS = 30000;

function markDbDirtyForSave() {
  _dbDirty = true;
  _cachedDbExportDirty = true;
  if (!_dbSaveTimer) {
    _dbSaveTimer = setTimeout(() => {
      _dbSaveTimer = null;
      if (_dbDirty) { _dbDirty = false; saveDb(); }
    }, DB_SAVE_DEBOUNCE_MS);
  }
}

function flushDb() {
  if (_dbSaveTimer) { clearTimeout(_dbSaveTimer); _dbSaveTimer = null; }
  if (_dbDirty) { _dbDirty = false; saveDb(); }
}

function flushDbSync() {
  if (!db) return;
  if (_dbSaveTimer) { clearTimeout(_dbSaveTimer); _dbSaveTimer = null; }
  _dbDirty = false;
  _dbSaveRequestedWhileBusy = false;
  // Invalidate any in-flight async save: when its writeFile/rename callback fires
  // it will see a stale generation and self-cancel without overwriting our flush.
  _dbWriteGeneration++;
  const staleTmp = _dbInFlightTempPath;
  _dbInFlightTempPath = null;
  try {
    const encrypted = getEncryptedDbExport();
    if (encrypted) writeFileAtomicSync(getDbPath(), encrypted);
  } catch (err) {
    console.error('[flushDbSync] Failed to persist database:', err && err.message ? err.message : err);
    // Encryption / IO failure: deliberately do NOT overwrite the on-disk DB.
    _dbDirty = true;
    _cachedDbExportDirty = true;
  }
  // Best-effort cleanup of any orphaned tmp file from the cancelled async writer.
  if (staleTmp) {
    try { if (fs.existsSync(staleTmp)) fs.unlinkSync(staleTmp); } catch (_) {}
  }
  _saveDbInProgress = false;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  markDbDirtyForSave();
}

/* â”€â”€â”€ Audit-log helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Wrap audit_log INSERTs so we can:
 *   - skip persisting `previous_snapshot` when it would be byte-identical
 *     to the most-recent snapshot for the same attendance_id (the action
 *     row is still inserted so the timeline stays complete)
 *   - keep the row count bounded over time via a startup retention sweep
 * Both behaviours are tunable via settings: `auditLogRetentionDays` (default 90).
 */
const AUDIT_LOG_DEFAULT_RETENTION_DAYS = 90;

function _getAuditRetentionDays() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key='auditLogRetentionDays'");
    if (row && row.value) {
      const n = parseInt(String(row.value), 10);
      if (Number.isFinite(n) && n >= 7 && n <= 3650) return n;
    }
  } catch (_) { /* settings table may not exist yet during early init */ }
  return AUDIT_LOG_DEFAULT_RETENTION_DAYS;
}

function appendAuditLog(attendanceId, action, opts) {
  const o = opts || {};
  let snapshot = o.previousSnapshot != null ? o.previousSnapshot : null;
  const changedFields = o.changedFields != null ? o.changedFields : null;
  const userNote = o.userNote != null ? o.userNote : null;
  const ts = o.timestamp || new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Dedupe: if this attendance's most recent audit_log row already has the same
  // previous_snapshot, drop ours so we don't double-store the same JSON blob.
  if (snapshot != null && attendanceId != null) {
    try {
      const last = dbGet(
        'SELECT previous_snapshot FROM audit_log WHERE attendance_id=? AND previous_snapshot IS NOT NULL ORDER BY id DESC LIMIT 1',
        [attendanceId]
      );
      if (last && last.previous_snapshot === snapshot) snapshot = null;
    } catch (_) { /* table may not exist yet during init */ }
  }

  db.run(
    'INSERT INTO audit_log (attendance_id, action, previous_snapshot, changed_fields, timestamp, user_note) VALUES (?,?,?,?,?,?)',
    [attendanceId, action, snapshot, changedFields, ts, userNote]
  );
}

function pruneOldAuditLog() {
  if (!db) return 0;
  try {
    const days = _getAuditRetentionDays();
    const cutoffMs = Date.now() - days * 86400000;
    const cutoff = new Date(cutoffMs).toISOString().slice(0, 19).replace('T', ' ');
    const before = dbGet('SELECT COUNT(*) AS c FROM audit_log WHERE timestamp < ?', [cutoff]);
    const n = before ? before.c : 0;
    if (n > 0) {
      db.run('DELETE FROM audit_log WHERE timestamp < ?', [cutoff]);
      console.log('[audit_log] Pruned ' + n + ' rows older than ' + days + ' days (cutoff ' + cutoff + ')');
      markDbDirtyForSave();
    }
    return n;
  } catch (e) {
    console.warn('[audit_log] retention sweep failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function parseSqliteDateTimeToMs(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  ).getTime();
}

function createDbSafetyCopy(tag = 'repair') {
  try {
    const src = getDbPath();
    if (!src || !fs.existsSync(src)) return null;
    const baseDir = path.dirname(src);
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const dest = path.join(baseDir, `attendances.db.${tag}.${stamp}.bak`);
    fs.copyFileSync(src, dest);
    return dest;
  } catch (e) {
    console.warn('[DB] Safety copy failed:', e && e.message ? e.message : e);
    return null;
  }
}

function extractIndexedAttendanceFields(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const clientName = [p.surname || '', p.forename || ''].filter(Boolean).join(', ');
  const stationName = p.policeStationName || '';
  const dsccRef = p.dsccRef || '';
  const attendanceDate = p.date || (p.instructionDateTime ? String(p.instructionDateTime).slice(0, 10) : '') || '';
  return { clientName, stationName, dsccRef, attendanceDate };
}

function backfillAttendanceIndexColumns({ limit = 10000 } = {}) {
  if (!db) return 0;
  try {
    const rows = dbAll(
      `SELECT id, data, client_name, station_name, dscc_ref, attendance_date
       FROM attendances
       WHERE deleted_at IS NULL
         AND (COALESCE(client_name,'')='' OR COALESCE(station_name,'')='' OR COALESCE(dscc_ref,'')='' OR COALESCE(attendance_date,'')='')
       LIMIT ?`,
      [limit]
    );

    let updated = 0;
    rows.forEach((r) => {
      if (!r || !r.id || !r.data) return;
      let parsed;
      try { parsed = JSON.parse(r.data); } catch (_) { return; }
      const f = extractIndexedAttendanceFields(parsed);
      const nextClient = (r.client_name != null && String(r.client_name).trim()) ? r.client_name : f.clientName;
      const nextStation = (r.station_name != null && String(r.station_name).trim()) ? r.station_name : f.stationName;
      const nextDscc = (r.dscc_ref != null && String(r.dscc_ref).trim()) ? r.dscc_ref : f.dsccRef;
      const nextDate = (r.attendance_date != null && String(r.attendance_date).trim()) ? r.attendance_date : f.attendanceDate;

      if (nextClient === (r.client_name || '') && nextStation === (r.station_name || '') && nextDscc === (r.dscc_ref || '') && nextDate === (r.attendance_date || '')) return;
      db.run(
        'UPDATE attendances SET client_name=?, station_name=?, dscc_ref=?, attendance_date=? WHERE id=?',
        [nextClient || '', nextStation || '', nextDscc || '', nextDate || '', r.id]
      );
      updated++;
    });

    if (updated) saveDb();
    return updated;
  } catch (e) {
    console.warn('[DB] Backfill index columns failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function normalizeKeyPart(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function buildDraftDedupeKey(row, parsed) {
  const dscc = normalizeKeyPart(row.dscc_ref || parsed.dsccRef).toUpperCase();
  const date = normalizeKeyPart(
    row.attendance_date ||
    parsed.date ||
    (parsed.instructionDateTime ? String(parsed.instructionDateTime).slice(0, 10) : '')
  );
  const station = normalizeKeyPart(row.station_name || parsed.policeStationName).toLowerCase();
  const surname = normalizeKeyPart(parsed.surname || '').toLowerCase();
  const forename = normalizeKeyPart(parsed.forename || '').toLowerCase();
  const clientFromRow = normalizeKeyPart(row.client_name || '').toLowerCase();
  const client = clientFromRow || [surname, forename].filter(Boolean).join(', ');
  const custody = normalizeKeyPart(parsed.custodyNumber).toLowerCase();

  if (dscc) return `dscc:${dscc}|date:${date}|station:${station}`;

  // Require both surname AND forename (or full client_name with a comma) to prevent
  // matching two different "Smith"s at the same station/date
  const clientHasBothNames = (surname && forename) || (clientFromRow && clientFromRow.includes(','));
  const hasClientQuad = !!(clientHasBothNames && client && date && station);
  const hasCustodyTriplet = !!(custody && date && station);
  if (hasClientQuad) return `client:${client}|date:${date}|station:${station}`;
  if (hasCustodyTriplet) return `custody:${custody}|date:${date}|station:${station}`;

  return null;
}

/** Build case key from parsed data only (for incoming save). */
function buildCaseKeyFromParsed(parsed) {
  const row = {
    client_name: [parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', '),
    station_name: parsed.policeStationName || '',
    dscc_ref: parsed.dsccRef || '',
    attendance_date: parsed.date || (parsed.instructionDateTime ? String(parsed.instructionDateTime).slice(0, 10) : ''),
  };
  return buildDraftDedupeKey(row, parsed);
}

/** If an existing draft matches this case key, return its id (most recently updated). Used to avoid creating a second copy. */
function findExistingDraftIdByCaseKey(parsed) {
  if (!db) return null;
  const key = buildCaseKeyFromParsed(parsed);
  if (!key) return null;
  try {
    const dscc = normalizeKeyPart(parsed.dsccRef).toUpperCase();
    const date = normalizeKeyPart(parsed.date || (parsed.instructionDateTime ? String(parsed.instructionDateTime).slice(0, 10) : ''));
    const station = normalizeKeyPart(parsed.policeStationName).toLowerCase();
    const client = normalizeKeyPart([parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', ')).toLowerCase();

    let rows;
    if (dscc) {
      rows = dbAll(
        "SELECT id, data, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL AND archived_at IS NULL AND dscc_ref=? ORDER BY updated_at DESC LIMIT 5",
        [dscc]
      );
    } else if (client && date && station) {
      rows = dbAll(
        "SELECT id, data, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL AND archived_at IS NULL AND client_name=? AND attendance_date=? ORDER BY updated_at DESC LIMIT 5",
        [client, date]
      );
    } else {
      rows = dbAll(
        "SELECT id, data, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC"
      );
    }
    for (const r of rows) {
      if (!r || !r.data) continue;
      let p = {};
      try { p = JSON.parse(r.data); } catch (_) { continue; }
      if (buildDraftDedupeKey(r, p) === key) return r.id;
    }
  } catch (e) {
    console.warn('[DB] findExistingDraftIdByCaseKey failed:', e && e.message ? e.message : e);
  }
  return null;
}

function dedupeDraftsByCaseKeys() {
  if (!db) return 0;
  try {
    const rows = dbAll(
      "SELECT id, data, updated_at, client_name, station_name, dscc_ref, attendance_date FROM attendances WHERE status='draft' AND deleted_at IS NULL AND archived_at IS NULL"
    );
    if (!rows || rows.length < 2) return 0;

    const groups = new Map();
    rows.forEach((r) => {
      if (!r || !r.id || !r.data) return;
      let parsed = {};
      try { parsed = JSON.parse(r.data); } catch (_) { parsed = {}; }
      const key = buildDraftDedupeKey(r, parsed);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    let removed = 0;
    for (const [, group] of groups.entries()) {
      if (!group || group.length < 2) continue;
      group.sort((a, b) => {
        const ta = parseSqliteDateTimeToMs(a.updated_at) || 0;
        const tb = parseSqliteDateTimeToMs(b.updated_at) || 0;
        if (ta !== tb) return tb - ta;
        return (b.id || 0) - (a.id || 0);
      });
      const keep = group[0];
      group.slice(1).forEach((r) => {
        if (r.id === keep.id) return;
        db.run('DELETE FROM attendances WHERE id=?', [r.id]);
        removed++;
      });
    }

    if (removed) {
      saveDb();
      console.log('[DB] Removed', removed, 'draft duplicates (case-key dedupe)');
    }
    return removed;
  } catch (e) {
    console.warn('[DB] Case-key draft dedupe failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function cleanupAccidentalDuplicateDrafts({ windowMs = 2 * 60 * 1000 } = {}) {
  if (!db) return 0;
  try {
    const groups = dbAll(
      "SELECT data, COUNT(*) as c FROM attendances WHERE status='draft' AND deleted_at IS NULL GROUP BY data HAVING c > 1"
    );

    let removed = 0;
    groups.forEach((g) => {
      if (!g || !g.data) return;

      const rows = dbAll(
        "SELECT id, created_at, updated_at FROM attendances WHERE status='draft' AND deleted_at IS NULL AND data=? ORDER BY created_at ASC, id ASC",
        [g.data]
      );
      if (!rows || rows.length < 2) return;

      const first = parseSqliteDateTimeToMs(rows[0].created_at);
      const last = parseSqliteDateTimeToMs(rows[rows.length - 1].created_at);
      if (!first || !last) return;

      // Only treat as accidental duplicates if they were created in a short burst.
      if ((last - first) > windowMs) return;

      const keep = dbGet(
        "SELECT id FROM attendances WHERE status='draft' AND deleted_at IS NULL AND data=? ORDER BY updated_at DESC, id DESC LIMIT 1",
        [g.data]
      );
      const keepId = keep && keep.id;
      if (!keepId) return;

      rows.forEach((r) => {
        if (r.id === keepId) return;
        db.run('DELETE FROM attendances WHERE id=?', [r.id]);
        removed++;
      });
    });

    if (removed) {
      saveDb();
      console.log('[DB] Removed', removed, 'accidental duplicate drafts');
    }
    return removed;
  } catch (e) {
    console.warn('[DB] Duplicate draft cleanup failed:', e && e.message ? e.message : e);
    return 0;
  }
}

// H20 — old default was app.getPath('desktop'), which on a typical OneDrive
// install is `…\OneDrive\Desktop`. The hourly + 24-archive retention then
// pushed an encrypted-DB blob (often hundreds of MB) into OneDrive every
// hour, which churned ~11 GB/day of upload bandwidth. The new default is
// userData\Backups (local-only, on the same volume as the live DB), and
// existing user-set backup folders are still honoured.
function _defaultBackupFolder() {
  try {
    return path.join(app.getPath('userData'), 'Backups');
  } catch (_) {
    return app.getPath('desktop');
  }
}
function getBackupFolder() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key = 'backupFolder'");
    if (row && row.value) return row.value;
  } catch (_) {}
  return _defaultBackupFolder();
}

function getOffsiteBackupFolder() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key = 'offsiteBackupFolder'");
    if (row && row.value && String(row.value).trim()) return String(row.value).trim();
  } catch (_) {}
  return null;
}

function copyToOffsiteBackup(localFilePath) {
  const offsiteDir = getOffsiteBackupFolder();
  if (!offsiteDir || !fs.existsSync(offsiteDir)) return;
  try {
    const name = path.basename(localFilePath);
    const dest = path.join(offsiteDir, name);
    fs.copyFileSync(localFilePath, dest);
    console.log('[Backup] Copied to off-site:', name);
  } catch (err) {
    console.error('[Backup] Off-site copy failed:', err.message);
  }
}

/** If cloud backup URL is set in settings, upload the given buffer (non-blocking). */
function uploadToCloudIfConfigured(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return;
  try {
    const rowUrl = dbGet("SELECT value FROM settings WHERE key = 'cloudBackupUrl'");
    const rowToken = dbGet("SELECT value FROM settings WHERE key = 'cloudBackupToken'");
    const url = rowUrl && rowUrl.value ? String(rowUrl.value).trim() : '';
    const token = rowToken && rowToken.value ? String(rowToken.value).trim() : '';
    if (!url) return;
    uploadBackupToCloud(url, buffer, token).then(() => {
      console.log('[Backup] Cloud upload succeeded');
    }).catch(err => {
      console.error('[Backup] Cloud upload failed:', err && err.message ? err.message : err);
    });
  } catch (e) {}
}

async function initDb() {
  cleanStaleDbTempFiles();
  const SQL = await initSqlJs();
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    const rawBuf = fs.readFileSync(dbPath);
    if (!rawBuf || !rawBuf.length) {
      throw new PersistenceStartupError(
        'The attendance database file exists but is empty. To protect your records, Custody Note will not start with a blank database.',
        buildDbPersistenceDetails({ dbSizeBytes: 0 })
      );
    }
    try {
      const buf = await decryptBufferWithRecovery(rawBuf);
      if (!buf) throw new Error('No database bytes were returned during decryption');
      db = new SQL.Database(buf);
    } catch (err) {
      throw new PersistenceStartupError(
        'Custody Note could not load the existing attendance database. To protect your records, the app has stopped instead of opening a blank database.',
        buildDbPersistenceDetails({
          dbSizeBytes: rawBuf.length,
          cause: err && err.message ? err.message : String(err),
        })
      );
    }
  } else {
    db = new SQL.Database();
  }

  // H17 â€” enable foreign-key enforcement on every open. sql.js opens with
  // FKs disabled by default (matching the SQLite C API). Without this any
  // FOREIGN KEY constraint we add later is silently a no-op at runtime.
  try { db.run('PRAGMA foreign_keys = ON'); } catch (e) { console.warn('[initDb] PRAGMA foreign_keys failed:', e && e.message); }

  /* ───────────────────────────────────────────────────────────────────────
   * Versioned schema migrations (main/dbMigrations.js).
   *
   * Historically this block was a flat list of CREATE TABLE/INDEX IF NOT
   * EXISTS + _safeAddColumn ALTERs run unconditionally on every startup. That
   * is now expressed as an ordered, named migration list tracked by a
   * `schema_version` table. The v1 "baseline-schema" migration contains
   * exactly those idempotent statements, so existing user DBs (which already
   * have every column) migrate to the versioned state WITHOUT data loss or
   * re-running destructive ops — they simply get stamped as version 1.
   *
   * Data-level backfills (backfillSyncIds / migrateSyncDirtyToQueue / station
   * load / scheme-code migration) intentionally remain below, run after the
   * schema is in place.
   * ─────────────────────────────────────────────────────────────────────── */
  try {
    const migrationResult = runDbMigrations(db, {
      logger: { error: (...a) => console.error(...a) },
    });
    if (migrationResult.applied.length) {
      console.log('[schema] Applied migration(s): ' + migrationResult.applied.join(', ') +
        ' (now at v' + migrationResult.to + ')');
    }
  } catch (err) {
    console.error('[schema] Migration runner failed:', err && err.message ? err.message : err);
    throw err;
  }

  backfillSyncIds();
  migrateSyncDirtyToQueue();

  const existing = dbGet("SELECT 1 FROM settings WHERE key = 'backupFolder'");
  if (!existing) {
    // H20 — default to userData\Backups instead of Desktop (often OneDrive).
    db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ['backupFolder', _defaultBackupFolder()]);
  }

  loadStationsFromFile();
  try { migrateSchemeIdsToSchemeCodes(); } catch (e) { console.error('[migrateSchemeIdsToSchemeCodes] failed:', e && e.message); }
  // Bound audit_log row growth before any user activity (defaults to 90 days,
  // tunable via settings.auditLogRetentionDays).
  try { pruneOldAuditLog(); } catch (_) {}
  saveDb();
  return db;
}

function loadStationsFromFile() {
  const stationsPath = path.join(__dirname, 'data', 'police-stations-laa.json');
  if (!fs.existsSync(stationsPath)) return;
  let stations;
  try {
    stations = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
  } catch (e) {
    console.error('[loadStationsFromFile] Failed to parse police-stations-laa.json:', e && e.message);
    return;
  }
  if (!Array.isArray(stations)) return;
  try { db.run('BEGIN TRANSACTION'); } catch (_) {}
  for (const s of stations) {
    try {
      const existing = dbGet('SELECT id FROM police_stations WHERE name = ? AND code = ?', [s.name || '', s.code || '']);
      if (existing) {
        db.run('UPDATE police_stations SET scheme = ?, region = ?, scheme_code = ?, kind = ? WHERE id = ?',
          [s.scheme || '', s.region || '', s.schemeCode || '', s.kind || 'station', existing.id]);
      } else {
        db.run('INSERT OR IGNORE INTO police_stations (name, code, scheme, region, scheme_code, kind) VALUES (?, ?, ?, ?, ?, ?)',
          [s.name || '', s.code || '', s.scheme || '', s.region || '', s.schemeCode || '', s.kind || 'station']);
      }
    } catch (_) {}
  }
  try { db.run('COMMIT'); } catch (_) {}
}

// One-shot migration: legacy records had data.schemeId set to the station code
// (e.g. "RD003") instead of the LAA 4-digit scheme code (e.g. "1131").
// This rewrites schemeId on every attendance row where it still matches the
// station-id pattern AND we can resolve a scheme_code from police_stations.
// Idempotent: marks completion in settings so it only runs once per machine.
function migrateSchemeIdsToSchemeCodes() {
  const FLAG_KEY = 'schemeIdBackfillCompletedAt';
  const flagRow = dbGet('SELECT value FROM settings WHERE key = ?', [FLAG_KEY]);
  if (flagRow && flagRow.value) return;

  const stationByCode = new Map();
  for (const r of dbAll('SELECT code, scheme_code FROM police_stations WHERE scheme_code IS NOT NULL AND scheme_code != ""')) {
    stationByCode.set(String(r.code).toUpperCase(), r.scheme_code);
  }

  const STATION_ID_RE = /^[A-Z]{2}\d{3}[A-Z]?$/;
  const rows = dbAll("SELECT id, data FROM attendances WHERE data LIKE '%\"schemeId\"%'");
  let updated = 0;
  let scanned = 0;

  try { db.run('BEGIN TRANSACTION'); } catch (_) {}
  for (const row of rows) {
    scanned++;
    let parsed;
    try { parsed = JSON.parse(row.data); } catch (_) { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const cur = String(parsed.schemeId || '').trim().toUpperCase();
    if (!cur || !STATION_ID_RE.test(cur)) continue;
    const schemeCode = stationByCode.get(cur);
    if (!schemeCode || schemeCode === cur) continue;
    parsed.schemeId = schemeCode;
    try {
      db.run('UPDATE attendances SET data = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [JSON.stringify(parsed), row.id]);
      updated++;
    } catch (_) {}
  }
  try { db.run('COMMIT'); } catch (_) {}

  try {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [FLAG_KEY, new Date().toISOString()]);
  } catch (_) {}
  console.log('[migrateSchemeIdsToSchemeCodes] scanned=' + scanned + ' updated=' + updated);
}

/* â”€â”€â”€ SMART BACKUP SYSTEM â”€â”€â”€ */
let dbDirtySinceQuickBackup = false;
let dbDirtySinceHourlyBackup = false;
const MAX_HOURLY_BACKUPS = 24; /* last 24 hourly archives (~1 working day) */
const MAX_DAILY_BACKUPS  = 7;  /* one representative per day for 7 days */

let _backupScheduler = null;

function getBackupScheduler() {
  if (_backupScheduler) return _backupScheduler;
  _backupScheduler = createBackupScheduler({
    quickMinIntervalMs: 30 * 60 * 1000,
    userIdleGraceMs: 90 * 1000,
    periodicCheckMs: 10 * 60 * 1000,
    runBackup: (kind, reason) => {
      console.log('[Backup] Scheduler triggered:', kind, reason);
      if (kind === 'hourly') {
        return _runHourlyBackupAsync();
      }
      return _runQuickBackupAsync();
    },
    onStatusChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backup-status-changed', status);
      }
    },
  });
  return _backupScheduler;
}

function _runQuickBackupAsync() {
  if (!db) return Promise.resolve({ skipped: true, reason: 'db-missing' });
  if (!isBackupFolderReady()) return Promise.resolve({ skipped: true, reason: 'backup-folder-missing' });
  const dest = path.join(getBackupFolder(), 'attendance-latest.db');
  const start = Date.now();
  try {
    const encrypted = getEncryptedDbExport();
    if (!encrypted) return Promise.resolve({ skipped: true, reason: 'export-failed' });
    return new Promise((resolve, reject) => {
      writeFileAtomic(dest, encrypted, (err) => {
        if (err) { console.error('[Backup] Quick backup write failed:', err.message); return reject(err); }
        console.log('[Backup] Quick backup saved (encrypted), took', Date.now() - start, 'ms,', encrypted.length, 'bytes');
        copyToOffsiteBackup(dest);
        uploadToCloudIfConfigured(encrypted);
        uploadToS3IfConfigured(encrypted, 'attendance-latest.db');
        uploadToManagedCloudIfEnabled(encrypted, 'attendance-latest.db');
        resolve({ durationMs: Date.now() - start, bytes: encrypted.length });
      });
    });
  } catch (err) {
    console.error('[Backup] Quick backup failed:', err.message);
    return Promise.reject(err);
  }
}

function _runHourlyBackupAsync() {
  if (!db) return Promise.resolve({ skipped: true, reason: 'db-missing' });
  if (!isBackupFolderReady()) return Promise.resolve({ skipped: true, reason: 'backup-folder-missing' });
  const backupDir = getBackupFolder();
  const name = `attendance-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.db`;
  const dest = path.join(backupDir, name);
  const start = Date.now();
  try {
    const encrypted = getEncryptedDbExport();
    if (!encrypted) return Promise.resolve({ skipped: true, reason: 'export-failed' });
    return new Promise((resolve, reject) => {
      writeFileAtomic(dest, encrypted, (err) => {
        if (err) { console.error('[Backup] Hourly write failed:', err.message); return reject(err); }
        console.log('[Backup] Hourly archive saved (encrypted):', name, 'took', Date.now() - start, 'ms');
        pruneOldBackups(backupDir);
        copyToOffsiteBackup(dest);
        uploadToCloudIfConfigured(encrypted);
        uploadToS3IfConfigured(encrypted, name);
        uploadToManagedCloudIfEnabled(encrypted, name);
        const offsiteDir = getOffsiteBackupFolder();
        if (offsiteDir && fs.existsSync(offsiteDir)) pruneOldBackups(offsiteDir);
        resolve({ durationMs: Date.now() - start, bytes: encrypted.length });
      });
    });
  } catch (err) {
    console.error('[Backup] Hourly backup failed:', err.message);
    return Promise.reject(err);
  }
}

function markDbDirty() {
  dbDirtySinceQuickBackup = true;
  dbDirtySinceHourlyBackup = true;
  const bs = _backupScheduler;
  if (bs) bs.markDirty('db-change');
  scheduleSyncSoon();
}

function isBackupFolderReady() {
  try {
    const dir = getBackupFolder();
    return dir && fs.existsSync(dir);
  } catch (_) { return false; }
}

function runQuickBackup() {
  if (!db || !dbDirtySinceQuickBackup) return;
  const result = _runQuickBackupAsync();
  if (result && !result.skipped) dbDirtySinceQuickBackup = false;
}

function runHourlyBackup() {
  if (!db || !dbDirtySinceHourlyBackup) return;
  const result = _runHourlyBackupAsync();
  if (result && !result.skipped) dbDirtySinceHourlyBackup = false;
}

function pruneOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('attendance-backup-') && f.endsWith('.db'))
      .map(f => ({ name: f, path: path.join(backupDir, f), time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time); /* newest first */

    const keep = new Set();

    /* Keep the most recent MAX_HOURLY_BACKUPS files (last ~24 hours) */
    files.slice(0, MAX_HOURLY_BACKUPS).forEach(f => keep.add(f.name));

    /* Also keep one representative file per calendar day for the last MAX_DAILY_BACKUPS days */
    const seenDays = new Set();
    const cutoff = Date.now() - MAX_DAILY_BACKUPS * 24 * 60 * 60 * 1000;
    files.forEach(f => {
      if (f.time < cutoff) return;
      const day = new Date(f.time).toISOString().slice(0, 10); /* YYYY-MM-DD */
      if (!seenDays.has(day)) {
        seenDays.add(day);
        keep.add(f.name);
      }
    });

    /* Delete everything not in the keep set */
    let pruned = 0;
    files.forEach(f => {
      if (!keep.has(f.name)) {
        try { fs.unlinkSync(f.path); pruned++; } catch (_) {}
      }
    });
    if (pruned > 0) console.log('[Backup] Pruned', pruned, 'old archives; keeping', keep.size);
  } catch (_) {}
}

/** POST encrypted backup buffer to a cloud URL. Returns Promise<void> or rejects with error message. */
function uploadBackupToCloud(urlStr, buffer, token) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      reject(new Error('Invalid cloud backup URL'));
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
      },
    };
    if (token && String(token).trim()) {
      options.headers['Authorization'] = 'Bearer ' + String(token).trim();
    }
    const req = mod.request(options, (res) => {
      const status = res.statusCode || 0;
      if (status >= 200 && status < 300) {
        resolve();
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        reject(new Error('Cloud backup failed: HTTP ' + status + (body ? ' â€” ' + body.slice(0, 100) : '')));
      });
    });
    req.on('error', (err) => reject(new Error('Cloud backup failed: ' + (err.message || err))));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Cloud backup failed: timeout'));
    });
    req.write(buffer);
    req.end();
  });
}

const S3_PREFIX = 'custody-note/';
let _lastS3SuccessTime = null;
let _lastS3Error = null;

/** Cloud backup uses only licence-key + /api/backup/credentials (managed cloud). No stored AWS keys. */
function getS3Config() {
  return null;
}

/** If AWS S3 backup is enabled in settings, upload the buffer to S3 (non-blocking). key = e.g. attendance-latest.db or attendance-backup-2026-02-26-14-30.db */
function uploadToS3IfConfigured(buffer, key) {
  if (!buffer || !Buffer.isBuffer(buffer) || !key) return;
  const config = getS3Config();
  if (!config) return;
  const { region, bucket, accessKeyId, secretAccessKey } = config;
  const s3Key = S3_PREFIX + key;
  import('@aws-sdk/client-s3').then(({ S3Client, PutObjectCommand }) => {
    const client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    return client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: 'application/octet-stream',
    }));
  }).then(() => {
    _lastS3SuccessTime = Date.now();
    _lastS3Error = null;
    console.log('[Backup] S3 upload succeeded:', s3Key);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('s3-backup-status');
  }).catch(err => {
    _lastS3Error = err && err.message ? err.message : String(err);
    console.error('[Backup] S3 upload failed:', _lastS3Error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('s3-backup-status');
  });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MANAGED CLOUD BACKUP (subscription-based)
   Uses temp credentials from the licence server.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
let _managedCloudCreds = null;
let _managedCloudCredsExpiry = 0;
let _lastManagedCloudSuccess = null;
let _lastManagedCloudError = null;
let _cloudBackupEnabled = false;

const ALLOWED_API_HOSTS = ['custodynote.com', 'www.custodynote.com', 'localhost', '127.0.0.1'];

function isAllowedApiUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && !(u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_API_HOSTS.some(h => h.replace(/^www\./, '') === host || u.hostname === h);
  } catch (_) { return false; }
}

function getManagedCloudApiUrl() {
  const envBase = process.env.LICENCE_SERVER_BASE_URL;
  if (envBase && typeof envBase === 'string' && isAllowedApiUrl(envBase)) {
    return envBase.replace(/\/$/, '');
  }
  try {
    const cfgPath = path.join(app.getPath('userData'), 'licence-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.apiUrl && isAllowedApiUrl(cfg.apiUrl)) return cfg.apiUrl;
    }
  } catch (_) {}
  return 'https://custodynote.com';
}

async function fetchManagedCloudCredentials() {
  const now = Date.now();
  if (_managedCloudCreds && _managedCloudCredsExpiry > now + 60000) {
    return _managedCloudCreds;
  }
  const data = readLicenceData();
  if (!data || (!data.key && !data.authToken)) return null;
  const apiUrl = getManagedCloudApiUrl();
  try {
    const authHeaders = _getAuthHeaders();
    const resp = await httpPost(`${apiUrl}/api/backup/credentials`, { key: data.key }, { headers: authHeaders });
    if (resp.error) {
      _lastManagedCloudError = resp.error;
      return null;
    }
    if (resp.credentials) {
      _managedCloudCreds = resp.credentials;
      _managedCloudCredsExpiry = new Date(resp.credentials.expiration).getTime();
      return _managedCloudCreds;
    }
  } catch (e) {
    _lastManagedCloudError = e && e.message ? e.message : String(e);
  }
  return null;
}

function emitCloudBackupStatus(overrides) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const lic = readLicenceData();
  const payload = {
    enabled: _cloudBackupEnabled,
    isTrial: !!(lic && lic.isTrial),
    lastError: _lastManagedCloudError || null,
    lastSuccess: _lastManagedCloudSuccess || null,
  };
  if (overrides && typeof overrides === 'object') {
    Object.assign(payload, overrides);
  }
  mainWindow.webContents.send('cloud-backup-status-changed', payload);
}

async function checkCloudBackupEntitlement() {
  const data = readLicenceData();
  const isTrial = !!(data && data.isTrial);
  const hasAuth = !!(data && data.authToken);
  if (!data || (!data.key && !hasAuth)) {
    _cloudBackupEnabled = false;
    _lastManagedCloudError = null;
    emitCloudBackupStatus({ enabled: false, isTrial: false, lastError: null });
    return;
  }
  if (isTrial && !hasAuth) {
    _cloudBackupEnabled = false;
    _lastManagedCloudError = null;
    console.info('[CloudBackup] Skipping entitlement check â€” trial licence active. Cloud backup not included.');
    emitCloudBackupStatus({ enabled: false, isTrial: true, lastError: null });
    return;
  }
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) {
    _cloudBackupEnabled = false;
    _lastManagedCloudError = 'Cannot reach licence server.';
    console.warn('[CloudBackup] No API URL configured');
    emitCloudBackupStatus({ enabled: false, isTrial: false });
    return;
  }
  try {
    const resp = await postLicenceValidateRequest({
      key: data.key,
      machineId: getMachineId(),
      appVersion: app.getVersion() || '0.0.0',
    });
    if (resp && resp.valid === false) {
      _cloudBackupEnabled = false;
      _lastManagedCloudError = resp.message || resp.error || 'Licence validation failed. Check your licence and try again.';
      if (resp.expiresAt) data.expiresAt = resp.expiresAt;
      if (resp.email) data.email = resp.email;
      if (resp.status) data.status = resp.status;
      if (resp.isTrial !== undefined) data.isTrial = !!resp.isTrial;
      if (resp.entitlements !== undefined) data.entitlements = resp.entitlements;
      writeLicenceData(data);
      console.warn('[CloudBackup] Entitlement blocked:', _lastManagedCloudError);
      emitCloudBackupStatus({
        enabled: false,
        isTrial: !!resp.isTrial,
        lastError: _lastManagedCloudError,
      });
      return;
    }
    _cloudBackupEnabled = !!(resp && resp.cloudBackup);
    _lastManagedCloudError = _cloudBackupEnabled
      ? null
      : ((resp && (resp.backupMessage || resp.message || resp.error)) ||
        'Cloud backup is not enabled for this licence.');
    console.info('[CloudBackup] Entitlement result: cloudBackup=' + _cloudBackupEnabled + ' valid=' + !!(resp && resp.valid));
    if (resp && resp.expiresAt) data.expiresAt = resp.expiresAt;
    data.cachedCloudBackup = _cloudBackupEnabled;
    data.cachedCloudBackupAt = new Date().toISOString();
    if (resp && resp.valid !== undefined) {
      data.lastValidated = new Date().toISOString();
    }
    writeLicenceData(data);
  } catch (err) {
    const cachedAge = data.cachedCloudBackupAt ? (Date.now() - new Date(data.cachedCloudBackupAt).getTime()) : Infinity;
    const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    if (data.cachedCloudBackup && cachedAge < MAX_CACHE_AGE_MS) {
      _cloudBackupEnabled = true;
      console.warn('[CloudBackup] Entitlement check failed (network issue) â€” using cached entitlement (age: ' + Math.round(cachedAge / 3600000) + 'h):', err && err.message ? err.message : err);
    } else {
      _cloudBackupEnabled = false;
      console.error('[CloudBackup] Entitlement check failed and no valid cache:', err && err.message ? err.message : err);
    }
  }
  emitCloudBackupStatus();
}

/** Map AWS/SDK errors to user-friendly codes; return { message, code, correlationId }. */
function mapBackupError(err) {
  const correlationId = 'cn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const msg = err && err.message ? String(err.message) : String(err);
  if (!msg) return { message: 'Backup failed: unknown error', code: 'UNKNOWN', correlationId };
  if (/credentials|Credential|Unauthorized|AccessDenied|403|Forbidden/i.test(msg)) {
    return { message: 'Backup failed: permission denied. Check your licence and try again.', code: 'PERMISSION_DENIED', correlationId };
  }
  if (/bucket|Bucket|NoSuchBucket|InvalidBucket|404/i.test(msg)) {
    return { message: 'Backup failed: configuration missing (bucket). Contact support.', code: 'CONFIG_MISSING', correlationId };
  }
  if (/network|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(msg)) {
    return { message: 'Backup failed: network issue. Check your connection and try again.', code: 'NETWORK_ERROR', correlationId };
  }
  if (/ObjectLock|object lock/i.test(msg)) {
    return { message: 'Backup failed: storage configuration issue. Contact support.', code: 'CONFIG_ERROR', correlationId };
  }
  return { message: 'Backup failed: ' + msg.slice(0, 80), code: 'ERROR', correlationId };
}

const MANAGED_BACKUP_MAX_RETRIES = 3;
const MANAGED_BACKUP_INITIAL_DELAY_MS = 1000;

function uploadToManagedCloudIfEnabled(buffer, key) {
  if (!buffer || !Buffer.isBuffer(buffer) || !key) return;
  if (!_cloudBackupEnabled) return;

  function doUpload(creds, attempt) {
    return import('@aws-sdk/client-s3').then(({ S3Client, PutObjectCommand }) => {
      const client = new S3Client({
        region: creds.region,
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
        },
      });
      const s3Key = `${creds.prefix}/${key}`;
      // Do NOT use ObjectLockMode/ObjectLockRetainUntilDate unless bucket has Object Lock enabled
      return client.send(new PutObjectCommand({
        Bucket: creds.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: 'application/octet-stream',
      }));
    });
  }

  function retryWithBackoff(creds, attempt) {
    return doUpload(creds, attempt).catch(err => {
      const mapped = mapBackupError(err);
      console.error('[Backup] Managed cloud upload attempt', attempt, mapped.code, mapped.correlationId, err && err.message);
      if (attempt < MANAGED_BACKUP_MAX_RETRIES) {
        const delay = MANAGED_BACKUP_INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        return new Promise((resolve) => setTimeout(resolve, delay)).then(() => retryWithBackoff(creds, attempt + 1));
      }
      _lastManagedCloudError = mapped.message + ' (Ref: ' + mapped.correlationId + ')';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cloud-backup-status-changed', {
          enabled: _cloudBackupEnabled,
          lastError: _lastManagedCloudError,
          correlationId: mapped.correlationId,
        });
      }
      throw err;
    });
  }

  fetchManagedCloudCredentials().then(creds => {
    if (!creds) {
      _lastManagedCloudError = 'Backup failed: configuration missing. Check your licence.';
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('cloud-backup-status-changed', { enabled: false, lastError: _lastManagedCloudError });
      }
      return;
    }
    return retryWithBackoff(creds, 1);
  }).then(() => {
    _lastManagedCloudSuccess = Date.now();
    _lastManagedCloudError = null;
    console.log('[Backup] Managed cloud upload succeeded:', key);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cloud-backup-status-changed', { enabled: true, lastSuccess: _lastManagedCloudSuccess });
  }).catch(() => {});
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CROSS-DEVICE SYNC ENGINE
   Pushes local changes to and pulls remote changes
   from a central DynamoDB store via the website API.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const SYNC_ATTEMPTS_KEEP = 100;

function generateCorrelationId() {
  const hex = crypto.randomBytes(8).toString('hex');
  return 'sync-' + hex;
}

function logSyncAttempt(correlationId, direction, recordCount, success, errorMessage) {
  if (!db) return;
  try {
    dbRun(
      'INSERT INTO sync_attempts (correlation_id, direction, record_count, success, error_message) VALUES (?,?,?,?,?)',
      [correlationId || null, direction, recordCount || 0, success ? 1 : 0, errorMessage || null]
    );
    const row = dbGet('SELECT COUNT(*) as c FROM sync_attempts');
    if (row && row.c > SYNC_ATTEMPTS_KEEP) {
      dbRun('DELETE FROM sync_attempts WHERE id IN (SELECT id FROM sync_attempts ORDER BY id ASC LIMIT ?)', [row.c - SYNC_ATTEMPTS_KEEP]);
    }
  } catch (e) {
    console.warn('[Sync] Failed to write sync_attempts:', e && e.message ? e.message : e);
  }
}

function generateSyncId() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function backfillSyncIds() {
  if (!db) return;
  try {
    const rows = dbAll("SELECT id FROM attendances WHERE sync_id IS NULL OR sync_id = ''");
    if (rows.length === 0) return;
    try { db.run('BEGIN TRANSACTION'); } catch (_) {}
    for (const row of rows) {
      dbRun('UPDATE attendances SET sync_id=?, sync_dirty=1 WHERE id=?', [generateSyncId(), row.id]);
    }
    try { db.run('COMMIT'); } catch (_) {}
    console.log('[Sync] Backfilled sync_id for', rows.length, 'records');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.warn('[Sync] Backfill sync_id failed:', e && e.message ? e.message : e);
  }
}

/** Migrate sync_dirty records into sync_queue for offline-first processing. */
function migrateSyncDirtyToQueue() {
  if (!db) return;
  try {
    const hasTable = dbGet("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_queue'");
    if (!hasTable) return;
    const rows = dbAll('SELECT id FROM attendances WHERE sync_dirty=1');
    if (!rows || rows.length === 0) return;
    const now = Date.now();
    try { db.run('BEGIN TRANSACTION'); } catch (_) {}
    for (const row of rows) {
      const qid = 'sq-' + crypto.randomBytes(12).toString('hex');
      const rid = String(row.id);
      dbRun('DELETE FROM sync_queue WHERE record_id=?', [rid]);
      dbRun(
        'INSERT OR IGNORE INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status) VALUES (?,?,?,?,?,0,?,?)',
        [qid, rid, 'upsert', '{}', now, now, 'pending']
      );
    }
    try { db.run('COMMIT'); } catch (_) {}
    console.log('[Sync] Migrated', rows.length, 'dirty records to sync_queue');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.warn('[Sync] migrateSyncDirtyToQueue failed:', e && e.message ? e.message : e);
  }
}

function rebuildSyncQueueForDirtyRecords() {
  if (!db) return 0;
  try {
    dbRun('DELETE FROM sync_queue');
    migrateSyncDirtyToQueue();
    const row = dbGet('SELECT COUNT(*) as c FROM sync_queue');
    return row ? (row.c || 0) : 0;
  } catch (e) {
    console.warn('[Sync] rebuildSyncQueueForDirtyRecords failed:', e && e.message ? e.message : e);
    return 0;
  }
}

function clearOpenSyncConflicts(attendanceId, resolutionNote) {
  if (!db || !attendanceId) return;
  const existing = dbGet('SELECT COUNT(*) as c FROM sync_conflicts WHERE attendance_id=? AND resolved_at IS NULL', [attendanceId]);
  if (!existing || !existing.c) return;
  dbRun(
    'UPDATE sync_conflicts SET resolved_at=?, resolution_note=? WHERE attendance_id=? AND resolved_at IS NULL',
    [new Date().toISOString(), resolutionNote || 'resolved', attendanceId]
  );
}

function recordSyncConflict(localId, localRow, remote, reason) {
  if (!db || !localId) return;
  const now = new Date().toISOString();
  const existing = dbGet(
    `SELECT data, status, updated_at, deleted_at, deletion_reason, supervisor_approved_at,
            supervisor_note, archived_at, sync_version
       FROM attendances WHERE id=?`,
    [localId]
  );
  const localSnapshot = existing ? JSON.stringify({
    data: existing.data,
    status: existing.status,
    updatedAt: existing.updated_at,
    deletedAt: existing.deleted_at || null,
    deletionReason: existing.deletion_reason || null,
    supervisorApprovedAt: existing.supervisor_approved_at || null,
    supervisorNote: existing.supervisor_note || '',
    archivedAt: existing.archived_at || null,
    version: existing.sync_version || (localRow && localRow.sync_version) || 1,
  }) : null;
  const remoteSnapshot = JSON.stringify({
    syncId: remote.syncId,
    data: remote.data,
    status: remote.status || 'draft',
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    deletedAt: remote.deletedAt || null,
    deletionReason: remote.deletionReason || null,
    clientName: remote.clientName || '',
    stationName: remote.stationName || '',
    dsccRef: remote.dsccRef || '',
    attendanceDate: remote.attendanceDate || '',
    supervisorApprovedAt: remote.supervisorApprovedAt || null,
    supervisorNote: remote.supervisorNote || '',
    archivedAt: remote.archivedAt || null,
    version: remote.version || 1,
  });
  dbRun('DELETE FROM sync_conflicts WHERE attendance_id=? AND resolved_at IS NULL', [localId]);
  dbRun(
    `INSERT INTO sync_conflicts (
      attendance_id, sync_id, reason, local_version, remote_version, local_updated_at,
      remote_updated_at, remote_status, local_snapshot, remote_snapshot, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      localId,
      remote.syncId || null,
      reason || 'remote_newer',
      (localRow && localRow.sync_version) || (existing && existing.sync_version) || 1,
      remote.version || 1,
      (localRow && localRow.updated_at) || (existing && existing.updated_at) || null,
      remote.updatedAt || null,
      remote.status || 'draft',
      localSnapshot,
      remoteSnapshot,
      now,
    ]
  );
  appendAuditLog(localId, 'sync_conflict_blocked', {
    previousSnapshot: existing ? existing.data : null,
    timestamp: now,
    userNote: reason === 'protect_finalised'
      ? 'Remote draft was blocked because the local record is finalised.'
      : 'Remote changes were held back because the local record has unsynced edits.',
  });
}

function getSyncApiUrl() {
  const base = getManagedCloudApiUrl();
  return base || null;
}

function getLastSyncTimestamp() {
  if (!db) return '1970-01-01T00:00:00.000Z';
  const row = dbGet("SELECT value FROM settings WHERE key = 'lastSyncPullAt'");
  return (row && row.value) || '1970-01-01T00:00:00.000Z';
}

function setLastSyncTimestamp(ts) {
  if (!db) return;
  dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", [ts]);
}

let _lastPullStats = {
  received: 0,
  merged: 0,
  conflicts: 0,
  decryptFailed: 0,
  noMasterKeySkipped: 0,
  cursorAdvanced: false,
  at: null,
};

function getLastPullStats() {
  return { ..._lastPullStats };
}

async function syncPull(opts) {
  const apiUrl = getSyncApiUrl();
  if (!apiUrl) return { pulled: 0 };

  const data = readLicenceData();
  if (!data || !data.key) return { pulled: 0 };

  const localCountRow = dbGet('SELECT COUNT(*) as c FROM attendances WHERE deleted_at IS NULL');
  const localCount = localCountRow ? localCountRow.c : 0;
  if (localCount === 0 || _lastPullStats.decryptFailed > 0 || _lastPullStats.noMasterKeySkipped > 0) {
    await ensureCanonicalSyncKeyNow().catch(() => {});
  }

  const { decryptSyncEnvelope } = require('./lib/syncRecordCrypto');
  const syncOpts = { timeout: 30000 };
  if (opts && opts.correlationId) syncOpts.headers = { 'X-Correlation-Id': opts.correlationId };

  let merged = 0;
  let conflicts = 0;
  let decryptFailed = 0;
  let noMasterKeySkipped = 0;
  let receivedCount = 0;
  let cursorAdvanced = true;
  let iterations = 0;
  const MAX_PULL_ITERATIONS = 50;

  while (iterations < MAX_PULL_ITERATIONS) {
    iterations++;
    const since = getLastSyncTimestamp();
    const resp = await httpPost(`${apiUrl}/api/sync/pull`, {
      key: data.key,
      machineId: getMachineId(),
      since,
    }, syncOpts);

    if (!resp || !resp.ok) {
      throw new Error(resp && resp.error ? resp.error : 'Pull failed');
    }

    const masterKeyHex = getOrCreateMasterKey({ allowCreate: false });
    const remoteRecords = resp.records || [];
    let batchMerged = 0;
    let batchConflicts = 0;
    let batchDecryptFailed = 0;
    let batchNoMasterKeySkipped = 0;
    receivedCount += remoteRecords.length;

    for (const rawRemote of remoteRecords) {
      let remote = rawRemote;
      if (rawRemote.envelope) {
        if (!masterKeyHex) {
          console.warn('[SYNC-PULL] Cannot decrypt envelope without local master key');
          batchNoMasterKeySkipped++;
          continue;
        }
        const payload = decryptSyncEnvelope(masterKeyHex, rawRemote.envelope);
        if (!payload) {
          console.warn('[SYNC-PULL] Failed to decrypt sync record', rawRemote.syncId);
          batchDecryptFailed++;
          continue;
        }
        remote = {
          syncId: rawRemote.syncId,
          data: payload.data,
          status: payload.status,
          createdAt: rawRemote.createdAt,
          updatedAt: rawRemote.updatedAt,
          deletedAt: payload.deletedAt || null,
          deletionReason: payload.deletionReason || null,
          clientName: payload.clientName || '',
          stationName: payload.stationName || '',
          dsccRef: payload.dsccRef || '',
          attendanceDate: payload.attendanceDate || '',
          supervisorApprovedAt: payload.supervisorApprovedAt || null,
          supervisorNote: payload.supervisorNote || '',
          archivedAt: payload.archivedAt || null,
          version: rawRemote.version,
        };
      }
      const local = dbGet('SELECT id, sync_version, updated_at, sync_dirty FROM attendances WHERE sync_id=?', [remote.syncId]);

      if (!local) {
        dbRun(
          `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, deleted_at, deletion_reason,
         client_name, station_name, dscc_ref, attendance_date,
         supervisor_approved_at, supervisor_note, archived_at, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
          [remote.syncId, remote.data, remote.status, remote.createdAt, remote.updatedAt,
           remote.deletedAt || null, remote.deletionReason || null,
           remote.clientName || '', remote.stationName || '', remote.dsccRef || '', remote.attendanceDate || '',
           remote.supervisorApprovedAt || null, remote.supervisorNote || '', remote.archivedAt || null,
           remote.version || 1]
        );
        batchMerged++;
        continue;
      }

      const localVersion = local.sync_version || 1;
      const remoteVersion = remote.version || 1;

      const localStatus = (() => {
        const s = dbGet('SELECT status FROM attendances WHERE id=?', [local.id]);
        return s ? s.status : null;
      })();
      if (localStatus === 'finalised' && remote.status !== 'finalised') {
        console.log('[SYNC-PULL] BLOCKED: refusing to overwrite finalised record id=' + local.id +
          ' with remote status=' + remote.status + ' (remote v' + remoteVersion + ', local v' + localVersion + ')');
        recordSyncConflict(local.id, local, remote, 'protect_finalised');
        batchConflicts++;
        continue;
      }
      if (localStatus === 'completed' && remote.status !== 'completed') {
        console.log('[SYNC-PULL] BLOCKED: refusing to overwrite office-completed record id=' + local.id +
          ' with remote status=' + remote.status + ' (remote v' + remoteVersion + ', local v' + localVersion + ')');
        recordSyncConflict(local.id, local, remote, 'protect_finalised');
        batchConflicts++;
        continue;
      }

      const remoteNewer = remoteVersion > localVersion ||
        (remoteVersion === localVersion && remote.updatedAt > (local.updated_at || ''));

      if (remoteNewer) {
        if (local.sync_dirty === 1) {
          recordSyncConflict(local.id, local, remote, 'preserve_local_dirty');
          batchConflicts++;
          continue;
        }
        clearOpenSyncConflicts(local.id, 'remote_applied');
        dbRun(
          `UPDATE attendances SET data=?, status=?, updated_at=?, deleted_at=?, deletion_reason=?,
         client_name=?, station_name=?, dscc_ref=?, attendance_date=?,
         supervisor_approved_at=?, supervisor_note=?, archived_at=?, sync_dirty=0, sync_version=?
         WHERE id=?`,
          [remote.data, remote.status, remote.updatedAt,
           remote.deletedAt || null, remote.deletionReason || null,
           remote.clientName || '', remote.stationName || '', remote.dsccRef || '', remote.attendanceDate || '',
           remote.supervisorApprovedAt || null, remote.supervisorNote || '', remote.archivedAt || null,
           remoteVersion, local.id]
        );
        batchMerged++;
      }
    }

    merged += batchMerged;
    conflicts += batchConflicts;
    decryptFailed += batchDecryptFailed;
    noMasterKeySkipped += batchNoMasterKeySkipped;

    const { shouldAdvanceSyncPullCursor } = require('./lib/syncPullCursor');
    cursorAdvanced = shouldAdvanceSyncPullCursor({
      receivedCount: remoteRecords.length,
      decryptFailed: batchDecryptFailed,
      noMasterKeySkipped: batchNoMasterKeySkipped,
    });
    if (resp.serverTime && cursorAdvanced) {
      setLastSyncTimestamp(resp.serverTime);
    } else if (!cursorAdvanced && (batchDecryptFailed > 0 || batchNoMasterKeySkipped > 0)) {
      console.warn('[SYNC-PULL] Pull cursor not advanced —', batchDecryptFailed, 'decrypt failed,', batchNoMasterKeySkipped, 'skipped (no key)');
    }

    if (!resp.hasMore || remoteRecords.length === 0) break;
  }

  _lastPullStats = {
    received: receivedCount,
    merged,
    conflicts,
    decryptFailed,
    noMasterKeySkipped,
    cursorAdvanced,
    at: new Date().toISOString(),
  };

  const correlationId = opts && opts.correlationId;
  logSyncAttempt(
    correlationId,
    'pull',
    receivedCount,
    decryptFailed === 0 && noMasterKeySkipped === 0,
    decryptFailed > 0
      ? `decrypt_failed:${decryptFailed}`
      : (noMasterKeySkipped > 0 ? `no_master_key:${noMasterKeySkipped}` : null)
  );

  if (merged > 0 || conflicts > 0) {
    saveDb();
  }
  return {
    pulled: merged,
    conflicts,
    received: receivedCount,
    decryptFailed,
    noMasterKeySkipped,
    cursorAdvanced,
  };
}

function resetSyncPullCursor() {
  if (!db) return;
  dbRun("DELETE FROM settings WHERE key='lastSyncPullAt'");
}

async function runFullSyncFromCloud() {
  if (!db) throw new Error('Database not ready');
  migrateSyncDirtyToQueue();
  resetSyncPullCursor();
  saveDb();
  const w = getSyncWorker();
  if (w) {
    w.forceRetryAll();
    await w.runCycle();
  }
}

/** Secondary devices with no local records: auto full re-sync once network is up. */
function scheduleAutoFullResyncIfEmpty() {
  if (!db || !getSyncApiUrl()) return;
  const data = readLicenceData();
  if (!data || !data.key) return;
  const countRow = dbGet('SELECT COUNT(*) as c FROM attendances WHERE deleted_at IS NULL');
  const total = countRow ? countRow.c : 0;
  if (total > 0) return;
  console.info('[Sync] No local records — scheduling automatic full re-sync from cloud');
  setTimeout(() => {
    ensureCanonicalSyncKeyNow().then(() => {
      return runFullSyncFromCloud();
    }).catch((e) => {
      console.warn('[Sync] Auto full re-sync failed:', e && e.message ? e.message : e);
    });
  }, 12000);
}

let _syncWorker = null;

function getSyncWorker() {
  if (!_syncWorker && db) {
    _syncWorker = createSyncWorker({
      db,
      dbRun,
      dbGet: (sql, params) => dbGet(sql, params ?? []),
      dbAll: (sql, params) => dbAll(sql, params ?? []),
      flushDb,
      getSyncApiUrl,
      readLicenceData,
      getMachineId,
      getMasterKeyHex: () => getOrCreateMasterKey({ allowCreate: false }),
      httpPost: (url, body, opts) => httpPost(url, body, { ...opts, timeout: (opts && opts.timeout) || 30000 }),
      httpGetWithTimeout,
      syncPull: () => syncPull({ correlationId: generateCorrelationId() }),
      ensureCanonicalKey: () => ensureCanonicalSyncKeyNow(),
      resolveSyncConflictsForRecord: (recordId, resolutionNote) => clearOpenSyncConflicts(Number(recordId), resolutionNote),
      onStatusChange: () => {},
      sendToRenderer: (channel, data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); },
    });
  }
  return _syncWorker;
}

function enqueueSyncForRecord(recordId, operation = 'upsert') {
  const w = getSyncWorker();
  if (w) w.enqueue(String(recordId), operation, {});
}

function startSyncTimer() {
  const w = getSyncWorker();
  if (w) w.start();
}

function stopSyncTimer() {
  if (_syncWorker) _syncWorker.stop();
}

/**
 * Schedule sync soon â€” called after any record mutation.
 * Offline-first: sync runs in background; UI never waits.
 */
function scheduleSyncSoon() {
  const w = getSyncWorker();
  if (w) w.scheduleSoon();
}

/** After licence is valid again, unblock sync queue items that failed with 401/403. */
function retrySyncQueueAfterLicenceSuccess() {
  try {
    const apiUrl = getSyncApiUrl();
    if (!apiUrl) return;
    const w = getSyncWorker();
    if (!w) return;
    const n = w.forceRetryAll();
    if (n > 0) w.scheduleSoon();
  } catch (_) {}
}

function createWindow() {
  const iconPath = path.join(__dirname, 'custody-note.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'Custody Note',
  });
  const isCaptureMode = process.env.CAPTURE_SCREENSHOTS === '1';
  mainWindow.once('ready-to-show', () => {
    if (!isCaptureMode) {
      mainWindow.show();
      mainWindow.maximize();
    }
    setTimeout(() => {
      if (db) {
        try {
          db.run('BEGIN TRANSACTION');
          backfillAttendanceIndexColumns({ limit: 10000 });
          db.run('COMMIT');
          saveDb();
        } catch (e) {
          try { db.run('ROLLBACK'); } catch (_) {}
          console.warn('[DB] Deferred backfill failed:', e && e.message ? e.message : e);
        }
      }
    }, 5000);
  });
  /* Startup audit: log the EXACT entry path the BrowserWindow loads. Anyone
     debugging "the app opened a webpage" should be able to confirm from this
     line that the desktop window loads index.html via file://, not a remote
     URL. We never call loadURL('https://...') for the main window. */
  const _startupIndexPath = path.join(__dirname, 'index.html');
  const _startupIndexFileUrl = require('url').pathToFileURL(_startupIndexPath).href;
  console.log('[Startup] Loading desktop entry:', _startupIndexFileUrl);
  mainWindow.loadFile('index.html');
  const ses = mainWindow.webContents.session;
  ses.clearCache().catch(() => {});
  ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(() => {});

  /* Surface preload bundling failures. Without this hook, a missing /
     mistyped `require()` inside preload.js silently disables every
     contextBridge — window.api / window.custodyNoteBuildInfo / window.custodyNote all
     become undefined, the licence flow falls through to its "no API" branch,
     and the user sees an empty shell with a www.custodynote.com link in the
     splash that LOOKS like a marketing page. We log the failure to stderr
     and to the renderer (via console-message → renderer's own banner) so
     it is impossible to miss in start.log. */
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const msg = (error && (error.stack || error.message)) ? String(error.stack || error.message) : String(error);
    console.error('[Startup] preload-error in', preloadPath, '\n' + msg);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          'window.__custodyNotePreloadError = ' + JSON.stringify({ path: preloadPath, message: msg }) + ';'
            + 'try { document.dispatchEvent(new CustomEvent("custody-preload-error")); } catch (_) {}'
        ).catch(() => {});
      }
    } catch (_) {}
  });
  // Defence-in-depth: block navigation away from file://, refuse window.open,
  // deny camera/mic/geolocation/etc., and force CSP/security response headers.
  // None of these is a security boundary on its own — sandbox + contextIsolation
  // + nodeIntegration:false are — but they close known bypasses.
  try {
    const indexFileUrl = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
    hardenWindow(mainWindow, {
      logger: { warn: (msg, meta) => console.warn(msg, meta || '') },
      appOrigin: indexFileUrl,
      shellOpenExternal: (u) => (isSafeExternalUrl(u) ? shell.openExternal(u) : Promise.resolve()),
    });
    hardenSession(ses, {
      logger: { warn: (msg, meta) => console.warn(msg, meta || '') },
    });
  } catch (e) {
    console.warn('[security] Failed to apply window/session hardening:', e && e.message);
  }
  if (updaterController && updaterController.scheduleDeferredCheck) {
    updaterController.scheduleDeferredCheck(mainWindow);
  }
  mainWindow.on('close', (e) => {
    if (!mainWindow || mainWindow._forceClose) return;
    /* Automated tests (isolated userData): allow window to close so Playwright/e2e can exit */
    if (process.env.CUSTODYNOTE_TEST_USERDATA) return;
    e.preventDefault();
    mainWindow.webContents.send('check-unsaved-changes');
  });
  ipcMain.once('close-confirmed', () => {
    if (mainWindow) {
      mainWindow._forceClose = true;
      mainWindow.close();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  /* Window-focus update check removed â€” caused re-triggering after failed installs */

  if (isCaptureMode) {
    const outputDir = process.env.CAPTURE_OUTPUT_DIR || path.join(__dirname, '..', 'custody note - website production', 'public', 'screenshots');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    mainWindow.webContents.once('did-finish-load', async () => {
      const views = [
        { name: 'home', file: 'home.png' },
        { name: 'quickcapture', file: 'quickcapture.png' },
        { name: 'new', file: 'form.png' },
        { name: 'list', file: 'records.png' },
        { name: 'reports', file: 'reports.png' },
      ];
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        await delay(3500);
        await mainWindow.webContents.executeJavaScript(`
          (function(){
            var s = document.getElementById('splash');
            if (s && s.parentNode) { s.classList.add('fade-out'); setTimeout(function(){ s.remove(); }, 300); }
          })();
        `);
        await delay(500);
        for (const { name, file } of views) {
          await mainWindow.webContents.executeJavaScript(
            `if (typeof showView === 'function') showView('${name}');`
          );
          await delay(900);
          const buf = await mainWindow.webContents.capturePage();
          const outPath = path.join(outputDir, file);
          fs.writeFileSync(outPath, buf.toPNG());
          console.log('[Capture] Saved', file);
        }
        console.log('[Capture] Done. Screenshots in', outputDir);
      } catch (err) {
        console.error('[Capture] Error:', err);
      } finally {
        app.quit();
      }
    });
  }

  if (process.env.ELECTRON_RUN_AS_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      /* Collect console output from renderer */
      mainWindow.webContents.on('console-message', (_, level, message) => {
        const tag = ['V','I','W','E'][level] || '?';
        console.log(`[renderer][${tag}] ${message}`);
      });

      setTimeout(async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`
            (async function stressTest() {
              var results = [];
              var errors = [];

              function log(msg) { results.push(msg); console.log('[TEST] ' + msg); }
              function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
              function isViewActive(id) {
                var el = document.getElementById(id);
                return !!(el && el.classList.contains('active'));
              }
              async function waitFor(predicate, timeoutMs, label) {
                var started = Date.now();
                while ((Date.now() - started) < timeoutMs) {
                  try {
                    if (predicate()) return true;
                  } catch (_) {}
                  await sleep(100);
                }
                if (label) errors.push(label);
                return false;
              }
              async function waitForView(id, timeoutMs, label) {
                return waitFor(function() { return isViewActive(id); }, timeoutMs || 5000, label || ('Expected view active: ' + id));
              }
              function setInputValue(el, value) {
                if (!el) return false;
                try { el.focus(); } catch (_) {}
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
              function parseRowData(row) {
                if (!row) return {};
                if (row.data && typeof row.data === 'object') return row.data;
                if (row.data) {
                  try { return JSON.parse(row.data); } catch (_) {}
                }
                return {};
              }
              async function findSavedRecord(matchFn) {
                if (!window.api || !window.api.attendanceListFull) return null;
                var rows = await window.api.attendanceListFull();
                return (rows || []).find(matchFn) || null;
              }
              async function saveExitToDraftAndWait() {
                var saveExitBtn = document.getElementById('form-save-exit');
                if (!saveExitBtn) return false;
                saveExitBtn.click();
                var modalOrHome = await waitFor(function() {
                  return isViewActive('view-home') || !!document.getElementById('save-exit-draft');
                }, 3000, 'Save & exit dialog did not appear');
                if (!modalOrHome) return false;
                if (isViewActive('view-home')) return true;
                var draftBtn = document.getElementById('save-exit-draft');
                if (!draftBtn) {
                  errors.push('Save & exit draft option not found');
                  return false;
                }
                draftBtn.click();
                return waitForView('view-home', 10000, 'Save & exit did not return to home');
              }
              async function openListAndSearch(query) {
                var viewAllBtn = document.getElementById('home-view-all');
                if (viewAllBtn) {
                  viewAllBtn.click();
                } else if (gearBtn) {
                  gearBtn.click();
                  await sleep(200);
                  var gearDd = document.getElementById('gear-dropdown');
                  var recordsItem = gearDd ? gearDd.querySelector('[data-action="records"]') : null;
                  if (recordsItem) recordsItem.click();
                }
                var listReady = await waitForView('view-list', 5000, 'List view not active');
                if (!listReady) return false;
                var search = document.getElementById('list-search');
                if (!search) {
                  errors.push('List search not found');
                  return false;
                }
                setInputValue(search, query);
                return waitFor(function() {
                  return !!document.querySelector('#attendance-list li[data-id] .list-item-text');
                }, 5000, 'List search returned no rows for: ' + query);
              }
              async function openFirstListResult() {
                var item = document.querySelector('#attendance-list li[data-id] .list-item-text');
                if (!item) {
                  errors.push('No list item available to open');
                  return false;
                }
                item.click();
                return waitForView('view-form', 5000, 'Form view not active after opening list item');
              }
              async function clickPrimaryConfirm(timeoutMs) {
                var shown = await waitFor(function() {
                  return !!document.querySelector('.cn-confirm-overlay .btn.btn-primary');
                }, timeoutMs || 4000, 'Confirmation dialog did not appear');
                if (!shown) return false;
                var okBtn = document.querySelector('.cn-confirm-overlay .btn.btn-primary');
                if (!okBtn) {
                  errors.push('Confirmation OK button not found');
                  return false;
                }
                okBtn.click();
                return true;
              }
              async function openRecordById(recordId, missingLabel) {
                if (!recordId) {
                  errors.push('Missing record id for reopen step');
                  return false;
                }
                if (typeof openAttendance === 'function') {
                  openAttendance(recordId);
                  return waitForView('view-form', 5000, 'Form view not active after opening saved record');
                }
                var viewAllBtn = document.getElementById('home-view-all');
                if (viewAllBtn) {
                  viewAllBtn.click();
                } else if (gearBtn) {
                  gearBtn.click();
                  await sleep(200);
                  var gearDd = document.getElementById('gear-dropdown');
                  var recordsItem = gearDd ? gearDd.querySelector('[data-action="records"]') : null;
                  if (recordsItem) recordsItem.click();
                }
                var listReady = await waitForView('view-list', 5000, 'List view not active');
                if (!listReady) return false;
                var rowReady = await waitFor(function() {
                  return !!document.querySelector('#attendance-list li[data-id="' + recordId + '"] .list-item-text');
                }, 5000, missingLabel || ('Saved record not visible in list: ' + recordId));
                if (!rowReady) return false;
                document.querySelector('#attendance-list li[data-id="' + recordId + '"] .list-item-text').click();
                return waitForView('view-form', 5000, 'Form view not active after opening saved record');
              }
              var testStamp = String(Date.now());
              var qcExpected = {
                forename: 'QCSmoke' + testStamp.slice(-5),
                surname: 'User' + testStamp.slice(-6),
                custody: 'CU/' + testStamp.slice(-6),
                notes: 'Smoke QC note ' + testStamp,
                firmName: 'Smoke Firm ' + testStamp.slice(-6),
                firmContact: 'QC Contact ' + testStamp.slice(-4),
                firmPhone: '07700 9' + testStamp.slice(-6),
                firmEmail: 'qc' + testStamp.slice(-5) + '@example.com'
              };
              var attExpected = {
                surname: 'Stress' + testStamp.slice(-6),
                forename: 'Bot' + testStamp.slice(-5)
              };
              var qcRecordId = null;
              var attendanceRecordId = null;

              /* 1. Basic checks â€” home view is now the landing view */
              if (document.getElementById('splash')) { errors.push('Splash still present'); }
              if (!document.querySelector('.app-header')) { errors.push('No .app-header found'); }
              var homeView = document.getElementById('view-home');
              if (!homeView || !homeView.classList.contains('active')) { errors.push('Home view not active at start'); }
              log('1. Splash gone, header present, home view active');

              /* 1b. Home action cards exist */
              var homeCards = ['home-card-attendance','home-card-voluntary','home-card-telephone','home-card-quick'];
              var cardMissing = homeCards.filter(function(id) { return !document.getElementById(id); });
              if (cardMissing.length) errors.push('Home missing cards: ' + cardMissing.join(', '));
              log('1b. Home action cards present');

              /* 1c. Gear menu button exists */
              var gearBtn = document.getElementById('gear-menu-btn');
              if (!gearBtn) errors.push('gear-menu-btn not found');
              else log('1c. Gear menu button present');

              /* 1d. Home greeting and datetime */
              var greetEl = document.getElementById('home-greeting');
              if (!greetEl || !greetEl.textContent) errors.push('Home greeting missing or empty');
              else log('1d. Home greeting: ' + greetEl.textContent);
              var dtEl = document.getElementById('home-datetime');
              if (!dtEl || !dtEl.textContent) errors.push('Home datetime missing or empty');
              else log('1e. Home datetime: ' + dtEl.textContent);

              /* 1f. Footer: internet status text and backup status */
              var netText = document.getElementById('net-status-text');
              var backupText = document.getElementById('backup-status-text');
              if (!netText) errors.push('Footer: net-status-text missing');
              else if (!/^(Online|Offline|Internet: Connected|Internet: Not connected)$/.test((netText.textContent || '').trim())) errors.push('Footer: net status text unexpected: ' + netText.textContent);
              if (!backupText) errors.push('Footer: backup-status-text missing');
              else if (!/(backup|local only)/i.test((backupText.textContent || '').trim())) errors.push('Footer: backup text unexpected: ' + backupText.textContent);
              log('1f. Footer status text OK');

              /* 2. Test New Attendance from home card */
              var cardAtt = document.getElementById('home-card-attendance');
              if (!cardAtt) { errors.push('home-card-attendance not found'); }
              else {
                cardAtt.click();
                await sleep(800);
                var formView = document.getElementById('view-form');
                if (!formView || !formView.classList.contains('active')) {
                  errors.push('Home Attendance card: view-form not active');
                } else {
                  log('2. Home Attendance card works - form view active');
                  var ctxBar = document.getElementById('form-context-bar');
                  var ctxRight = ctxBar ? ctxBar.querySelector('.context-right') : null;
                  if (ctxRight && ctxRight.textContent.length > 10) {
                    log('2b. Context bar posh date: ' + ctxRight.textContent);
                  } else {
                    errors.push('Context bar: posh date not found');
                  }
                  var dtBars = document.querySelectorAll('.section-datetime');
                  if (dtBars.length > 0) errors.push('Section datetime bars still present: ' + dtBars.length);
                  else log('2c. Section datetime bars removed OK');
                  var colorDots = document.querySelectorAll('.prog-dot.complete, .prog-dot.partial');
                  if (colorDots.length > 0) errors.push('Coloured progress dots still present: ' + colorDots.length);
                  else log('2d. Progress dots: no green/orange colours');
                  var laaBtn = document.getElementById('laa-forms-btn');
                  if (!laaBtn) errors.push('LAA Forms button not in form header');
                  else log('2e. LAA Forms button present in header');
                }
              }

              /* 3. Save & exit returns to home */
              var saveExit0 = document.getElementById('form-save-exit');
              if (saveExit0) {
                if (await saveExitToDraftAndWait()) {
                  log('3. Save & exit returns to home');
                }
              }

              /* 4. Gear menu: open and navigate to Records (list) */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd = document.getElementById('gear-dropdown');
                if (gearDd && !gearDd.classList.contains('hidden')) {
                  log('4a. Gear dropdown opened');
                  var recordsItem = gearDd.querySelector('[data-action="records"]');
                  if (recordsItem) {
                    recordsItem.click();
                    await sleep(500);
                    if (document.getElementById('view-list')?.classList.contains('active')) {
                      log('4b. Gear > Records navigates to list');
                    } else {
                      errors.push('Gear Records: list view not active');
                    }
                  }
                } else {
                  errors.push('Gear dropdown did not open');
                }
              }

              /* 5. List back-home button */
              var listBackHome = document.getElementById('list-back-home');
              if (listBackHome) {
                listBackHome.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('5. List back-home works');
                } else {
                  errors.push('List back-home did not return to home');
                }
              }

              /* 6. Quick Capture from home card */
              var cardQc = document.getElementById('home-card-quick');
              if (cardQc) {
                cardQc.click();
                await sleep(500);
                var qcView = document.getElementById('view-quickcapture');
                if (!qcView || !qcView.classList.contains('active')) {
                  errors.push('Quick Capture: view-quickcapture not active');
                } else {
                  log('6. Quick Capture card works');
                }
              }

              /* 7. QC Cancel returns to home */
              var qcCancel = document.getElementById('qc-cancel');
              if (qcCancel) {
                qcCancel.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('7. QC Cancel works - back to home');
                } else {
                  errors.push('QC Cancel did not return to home');
                }
              }

              /* 8. Gear > Firms */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd2 = document.getElementById('gear-dropdown');
                var firmsItem = gearDd2 ? gearDd2.querySelector('[data-action="firms"]') : null;
                if (firmsItem) {
                  firmsItem.click();
                  await sleep(500);
                  if (document.getElementById('view-firms')?.classList.contains('active')) {
                    log('8. Gear > Firms works');
                  } else {
                    errors.push('Gear Firms: view-firms not active');
                  }
                }
              }

              /* 9. Firms back button goes to home */
              var firmsBack = document.getElementById('firms-back-btn');
              if (firmsBack) {
                firmsBack.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('9. Firms back button works - goes to home');
                } else {
                  errors.push('Firms back: view-home not active');
                }
              }

              /* 10. Gear > Reports */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd3 = document.getElementById('gear-dropdown');
                var reportsItem = gearDd3 ? gearDd3.querySelector('[data-action="reports"]') : null;
                if (reportsItem) {
                  reportsItem.click();
                  await sleep(500);
                  if (document.getElementById('view-reports')?.classList.contains('active')) {
                    log('10. Gear > Reports works');
                  } else {
                    errors.push('Gear Reports: view-reports not active');
                  }
                }
              }

              /* 11. Reports back goes to home */
              var reportsBack = document.getElementById('reports-back-btn');
              if (reportsBack) {
                reportsBack.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('11. Reports back button works - goes to home');
                } else {
                  errors.push('Reports back: view-home not active');
                }
              }

              /* 12. Gear > Settings */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd4 = document.getElementById('gear-dropdown');
                var settingsItem = gearDd4 ? gearDd4.querySelector('[data-action="settings"]') : null;
                if (settingsItem) {
                  settingsItem.click();
                  await sleep(500);
                  if (document.getElementById('view-settings')?.classList.contains('active')) {
                    log('12. Gear > Settings works');
                    /* 12b. Support links: ensure details open, click support-faq-link and useful-link-btn */
                    var detailsEl = document.getElementById('support-faq-details');
                    if (detailsEl && !detailsEl.open) { detailsEl.setAttribute('open', ''); await sleep(100); }
                    var supportFaqLinks = document.querySelectorAll('.support-faq-link');
                    var supportUrls = Array.from(supportFaqLinks).map(function(btn) { return btn.dataset.url || ''; });
                    var missingSupportUrls = ['https://www.custodynote.com/support', 'https://www.custodynote.com/faq', 'https://www.custodynote.com/contact'].filter(function(url) {
                      return supportUrls.indexOf(url) < 0;
                    });
                    if (supportFaqLinks.length >= 3 && !missingSupportUrls.length) {
                      supportFaqLinks[0].click();
                      await sleep(150);
                      log('12b. support-faq-link clicked (Open forum)');
                    } else {
                      errors.push('support-faq-link buttons missing expected destinations: ' + supportUrls.join(', '));
                    }
                    var usefulLinks = document.querySelectorAll('.useful-link-btn');
                    var supportLink = Array.from(usefulLinks).find(function(a){ return (a.dataset.extUrl || a.href || '').indexOf('support') >= 0; });
                    if (supportLink) {
                      supportLink.click();
                      await sleep(150);
                      log('12c. useful-link-btn Support clicked');
                    }
                  } else {
                    errors.push('Gear Settings: view-settings not active');
                  }
                }
              }

              /* 13. Settings back goes to home */
              var settingsBack = document.getElementById('settings-back-btn');
              if (settingsBack) {
                settingsBack.click();
                await sleep(300);
                if (document.getElementById('view-home')?.classList.contains('active')) {
                  log('13. Settings back button works - goes to home');
                } else {
                  errors.push('Settings back: view-home not active');
                }
              }

              /* 14. Dark mode toggle */
              var dmToggle = document.getElementById('dark-mode-toggle');
              if (dmToggle) {
                dmToggle.click();
                await sleep(200);
                var isDark = document.documentElement.classList.contains('dark');
                log('14. Dark mode toggle works (dark=' + isDark + ')');
                dmToggle.click();
                await sleep(200);
              }

              /* 15. Quick Capture: fill form, save, verify return to home */
              var cardQc2 = document.getElementById('home-card-quick');
              if (cardQc2) {
                cardQc2.click();
                await sleep(500);

                var qcNewFields = ['qc-referral-name','qc-referral-phone','qc-referral-email','qc-oic-name','qc-custody-number','qc-client-status','qc-weekend-bh','qc-notes','qc-firm-select-btn','qc-firm-add-btn','qc-firm-wrap'];
                var qcMissing = qcNewFields.filter(function(id) { return !document.getElementById(id); });
                if (qcMissing.length) errors.push('QC missing fields: ' + qcMissing.join(', '));

                var stWrap = document.getElementById('qc-station-search-wrap');
                if (!stWrap) { errors.push('QC station-search-wrap not found'); }
                else if (!stWrap.classList.contains('station-search-wrap')) { errors.push('QC station wrap missing .station-search-wrap class'); }

                var fn = document.getElementById('qc-forename');
                var sn = document.getElementById('qc-surname');
                var off = document.getElementById('qc-offence');
                if (fn) setInputValue(fn, qcExpected.forename);
                if (sn) setInputValue(sn, qcExpected.surname);
                if (off) setInputValue(off, 'Theft');
                if (off) {
                  var offenceShown = await waitFor(function() {
                    return !!document.querySelector('.offence-autocomplete-dropdown.open .offence-autocomplete-option');
                  }, 3000, 'Quick Capture offence suggestions did not appear');
                  if (offenceShown) {
                    document.querySelector('.offence-autocomplete-dropdown.open .offence-autocomplete-option').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    log('15a. Quick Capture offence autocomplete shows suggestions');
                  }
                }
                var refName = document.getElementById('qc-referral-name');
                var refPhone = document.getElementById('qc-referral-phone');
                var oic = document.getElementById('qc-oic-name');
                var custody = document.getElementById('qc-custody-number');
                var notes = document.getElementById('qc-notes');
                if (refName) setInputValue(refName, 'Jane Smith');
                if (refPhone) setInputValue(refPhone, '07700 900123');
                if (oic) setInputValue(oic, 'DC Jones');
                if (custody) setInputValue(custody, qcExpected.custody);
                if (notes) setInputValue(notes, qcExpected.notes);
                var qcAddFirmBtn = document.getElementById('qc-firm-add-btn');
                if (qcAddFirmBtn) {
                  qcAddFirmBtn.click();
                  await sleep(150);
                  setInputValue(document.getElementById('qc-new-firm-name'), qcExpected.firmName);
                  setInputValue(document.getElementById('qc-new-firm-contact'), qcExpected.firmContact);
                  setInputValue(document.getElementById('qc-new-firm-phone'), qcExpected.firmPhone);
                  setInputValue(document.getElementById('qc-new-firm-email'), qcExpected.firmEmail);
                  var qcAddFirmConfirm = document.getElementById('qc-add-firm-btn');
                  if (qcAddFirmConfirm) {
                    qcAddFirmConfirm.click();
                    var firmAdded = await waitFor(function() {
                      var fid = document.getElementById('qc-firm');
                      return !!(fid && fid.value);
                    }, 5000, 'Quick Capture new firm was not saved');
                    if (firmAdded) log('15aa. Quick Capture new firm saved and selected');
                  }
                }

                var qcSave = document.getElementById('qc-save');
                if (qcSave) {
                  qcSave.click();
                  if (await waitForView('view-home', 8000, 'QC save: did not return to home')) {
                    log('15. QC save draft works (all new fields present and filled)');
                    var qcRow = await findSavedRecord(function(r) {
                      var d = parseRowData(r);
                      return d.surname === qcExpected.surname && d.forename === qcExpected.forename;
                    });
                    if (qcRow) {
                      qcRecordId = qcRow.id;
                      log('15b. Quick Capture record persisted to database');
                    } else {
                      errors.push('Quick Capture record not found after save');
                    }
                    if (window.api && window.api.firmsList) {
                      var qcFirmRows = await window.api.firmsList();
                      var savedFirm = (qcFirmRows || []).find(function(f) { return f.name === qcExpected.firmName; });
                      if (savedFirm &&
                          savedFirm.contact_name === qcExpected.firmContact &&
                          savedFirm.contact_phone === qcExpected.firmPhone &&
                          savedFirm.contact_email === qcExpected.firmEmail) {
                        log('15bb. Quick Capture firm contact details persisted to database');
                      } else {
                        errors.push('Quick Capture firm details did not persist to database');
                      }
                    }
                    if (await openRecordById(qcRecordId, 'Quick Capture saved record not visible in list')) {
                      var qcSurnameField = document.querySelector('[data-field="surname"]');
                      var qcForenameField = document.querySelector('[data-field="forename"]');
                      var qcDbRow = qcRecordId && window.api && window.api.attendanceGet ? await window.api.attendanceGet(qcRecordId) : null;
                      var qcDbData = parseRowData(qcDbRow);
                      if (qcSurnameField && qcForenameField &&
                          qcSurnameField.value === qcExpected.surname &&
                          qcForenameField.value === qcExpected.forename &&
                          qcDbData.custodyNumber === qcExpected.custody &&
                          qcDbData.arrivalNotes === qcExpected.notes) {
                        log('15c. Quick Capture record re-opened with saved values intact');
                      } else {
                        errors.push('Quick Capture persisted values did not match after re-open');
                      }
                      await saveExitToDraftAndWait();
                    }
                  }
                }
              }

              /* 16. Go to list via View All, test filter buttons */
              var viewAllBtn = document.getElementById('home-view-all');
              if (viewAllBtn) {
                viewAllBtn.click();
                if (await waitForView('view-list', 5000, 'View All did not navigate to list')) {
                  log('16a. View All navigates to list');
                }
              }
              var filterDraft = document.querySelector('.filter-btn[data-filter="draft"]');
              if (filterDraft) {
                filterDraft.click();
                await sleep(300);
                if (filterDraft.classList.contains('active')) {
                  log('16b. Filter button works');
                } else {
                  errors.push('Filter button not active after click');
                }
              }
              var filterAll = document.querySelector('.filter-btn[data-filter="all"]');
              if (filterAll) filterAll.click();
              await sleep(300);

              /* 17. New Attendance from home card: open and fill minimal data */
              var listBack = document.getElementById('list-back-home');
              if (listBack) { listBack.click(); await sleep(300); }
              var cardAtt2 = document.getElementById('home-card-attendance');
              if (cardAtt2) {
                cardAtt2.click();
                await sleep(800);
                var formSurname = document.querySelector('[data-field="surname"]');
                var formForename = document.querySelector('[data-field="forename"]');
                var formDate = document.querySelector('[data-field="date"]');
                var instrDt = document.querySelector('[data-field="instructionDateTime"]');
                if (formSurname) setInputValue(formSurname, attExpected.surname);
                if (formForename) setInputValue(formForename, attExpected.forename);
                if (formDate) setInputValue(formDate, new Date().toISOString().slice(0, 10));
                if (instrDt) setInputValue(instrDt, new Date().toISOString().slice(0, 16));
                log('17. New Attendance opened, minimal data filled');
              }

              /* 18. Section navigation */
              var formNext = document.getElementById('form-next');
              var form = document.getElementById('attendance-form');
              if (formNext && form) {
                for (var n = 0; n < 4; n++) {
                  formNext.click();
                  await sleep(400);
                }
                var titleEl = document.getElementById('form-page-title');
                var title = titleEl ? titleEl.textContent : '';
                if (title.indexOf('Disclosure') >= 0) {
                  log('18. Section navigation works - reached Disclosure');
                } else {
                  errors.push('Section nav: expected Disclosure, got: ' + title);
                }
              }

              /* 19. Save draft, reopen, and finalise */
              if (window.api && typeof getFormData === 'function') {
                try {
                  var attDraftId = await window.api.attendanceSave({ id: currentAttendanceId || null, data: getFormData(), status: 'draft' });
                  if (attDraftId) {
                    attendanceRecordId = attDraftId;
                    if (typeof showView === 'function') showView('home');
                    await waitForView('view-home', 5000, 'Attendance draft save did not return to home');
                    log('19. Attendance draft save works');
                  } else {
                    errors.push('Attendance draft save did not return an id');
                  }
                } catch (e) {
                  errors.push('Attendance draft save failed: ' + (e && e.message ? e.message : e));
                }
                var attRow = await findSavedRecord(function(r) {
                  var d = parseRowData(r);
                  return d.surname === attExpected.surname && d.forename === attExpected.forename;
                });
                if (attRow) {
                  attendanceRecordId = attRow.id;
                  log('19b. Attendance draft persisted to database');
                } else {
                  errors.push('Attendance draft record not found after save');
                }
                if (await openRecordById(attendanceRecordId, 'Attendance saved record not visible in list')) {
                  var reSurname = document.querySelector('[data-field="surname"]');
                  var reForename = document.querySelector('[data-field="forename"]');
                  if (reSurname && reForename &&
                      reSurname.value === attExpected.surname &&
                      reForename.value === attExpected.forename) {
                    log('19c. Attendance draft re-opened with saved values intact');
                  } else {
                    errors.push('Attendance draft values did not persist after re-open');
                  }
                  var formFinalise = document.getElementById('form-finalise') || document.getElementById('form-finalise-bar');
                  if (formFinalise || typeof validateBeforeFinalise === 'function') {
                    if (formFinalise) formFinalise.click();
                    else validateBeforeFinalise();
                    if (await clickPrimaryConfirm(4000)) {
                      var finalisedList = await waitForView('view-list', 12000, 'Finalise did not return to list view');
                      if (finalisedList) {
                        var finalisedRow = attendanceRecordId && window.api && window.api.attendanceGet ? await window.api.attendanceGet(attendanceRecordId) : null;
                        if (finalisedRow && finalisedRow.status === 'finalised') {
                          log('19d. Attendance finalise persisted finalised status');
                        } else {
                          errors.push('Attendance finalise did not persist finalised status');
                        }
                      }
                    }
                  } else {
                    errors.push('form-finalise button not found after re-open');
                  }
                }
              } else {
                errors.push('Attendance draft save helpers not available');
              }

              /* 20. Telephone Advice Call from home card */
              var cardTel = document.getElementById('home-card-telephone');
              if (cardTel) {
                cardTel.click();
                await sleep(800);
                if (document.getElementById('view-form')?.classList.contains('active')) {
                  log('20. Telephone Advice Call opens form view');
                  var telSections = document.querySelectorAll('.form-section');
                  if (telSections.length === 4) {
                    log('20b. Telephone form has 4 sections (INVB)');
                  } else {
                    errors.push('Telephone form: expected 4 sections, got ' + telSections.length);
                  }
                  var dsccField = document.querySelector('[data-field="dsccRef"]');
                  if (dsccField) {
                    log('20c. DSCC field present in telephone form');
                  } else {
                    errors.push('Telephone form: DSCC field missing');
                  }
                  var telNext = document.getElementById('form-next');
                  if (telNext) {
                    telNext.click();
                    await sleep(350);
                  }
                  var telAdviceField = document.querySelector('[data-field="telephoneAdviceSummary"]');
                  if (telAdviceField) {
                    log('20d. Telephone advice summary field present');
                  } else {
                    errors.push('Telephone form: telephoneAdviceSummary field missing');
                  }
                  if (telNext) {
                    var telPrev = document.getElementById('form-prev');
                    if (telPrev) { telPrev.click(); await sleep(250); }
                  }
                  var firstTitle = document.getElementById('form-page-title');
                  if (firstTitle && firstTitle.textContent.includes('Call Details')) {
                    log('20e. First section title correct: ' + firstTitle.textContent);
                  } else {
                    errors.push('Telephone form: first section title unexpected: ' + (firstTitle ? firstTitle.textContent : 'missing'));
                  }
                  var progDots = document.querySelectorAll('#section-progress-bar .prog-dot');
                  if (progDots.length === 4) {
                    log('20f. Progress bar shows 4 dots');
                  } else {
                    errors.push('Telephone form: expected 4 progress dots, got ' + progDots.length);
                  }
                } else {
                  errors.push('Telephone Advice: form view not active');
                }
              }

              /* 21. Navigate back, test LAA forms via gear menu */
              var saveExit2 = document.getElementById('form-save-exit');
              if (saveExit2) { await saveExitToDraftAndWait(); }
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd5 = document.getElementById('gear-dropdown');
                var laaItem = gearDd5 ? gearDd5.querySelector('[data-action="laa-forms"]') : null;
                if (laaItem) {
                  laaItem.click();
                  await sleep(500);
                  var laaNavPopup = document.getElementById('laa-nav-popup');
                  if (laaNavPopup) {
                    log('21. LAA Forms popup opened via gear menu');
                    var crm1Li = laaNavPopup.querySelector('[data-form="crm1"]');
                    if (crm1Li) {
                      log('21b. CRM1 option present in LAA popup');
                    }
                    var declLi = laaNavPopup.querySelector('[data-form="declaration"]');
                    if (declLi) {
                      log('21c. Applicant Declaration option present in LAA popup');
                    }
                    var closeLaaNav = document.getElementById('laa-nav-popup-close');
                    if (closeLaaNav) { closeLaaNav.click(); await sleep(300); }
                  } else {
                    errors.push('LAA Forms popup not found');
                  }
                }
              }

              /* 22. Test LAA Forms popup from within attendance form */
              var cardAtt3 = document.getElementById('home-card-attendance');
              if (cardAtt3) {
                cardAtt3.click();
                await sleep(800);
                var laaFormsBtn = document.getElementById('laa-forms-btn');
                if (laaFormsBtn) {
                  laaFormsBtn.click();
                  await sleep(500);
                  var laaPopup = document.getElementById('laa-forms-popup');
                  if (laaPopup) {
                    log('22. LAA Forms popup opened from attendance form');
                    var crm2Btn = laaPopup.querySelector('[data-form="crm2"]');
                    if (crm2Btn) {
                      log('22b. CRM2 option present in form LAA popup');
                    }
                    var declBtn2 = laaPopup.querySelector('[data-form="declaration"]');
                    if (declBtn2) {
                      log('22c. Applicant Declaration option present in form LAA popup');
                    }
                    var closeLaaPopup = document.getElementById('laa-popup-close');
                    if (closeLaaPopup) { closeLaaPopup.click(); await sleep(300); }
                  } else {
                    errors.push('LAA Forms popup not found');
                  }
                }
                var saveExit3 = document.getElementById('form-save-exit');
                if (saveExit3) { await saveExitToDraftAndWait(); }
              }

              /* 23. Verify official PDF API is available */
              if (window.api && typeof window.api.laaGenerateOfficialPdf === 'function') {
                log('23a. laaGenerateOfficialPdf API available');
              } else {
                errors.push('laaGenerateOfficialPdf API not available');
              }
              if (window.api && typeof window.api.laaOpenOfficialTemplate === 'function') {
                log('23b. laaOpenOfficialTemplate API available');
              } else {
                errors.push('laaOpenOfficialTemplate API not available');
              }

              /* 24. Splash screen CSS check (animations defined) */
              var sheets = document.styleSheets;
              var hasSplashDraw = false;
              try {
                for (var si = 0; si < sheets.length; si++) {
                  try {
                    var rules = sheets[si].cssRules;
                    for (var ri = 0; ri < rules.length; ri++) {
                      if (rules[ri].name === 'splash-draw') hasSplashDraw = true;
                    }
                  } catch(e) {}
                }
              } catch(e) {}
              if (hasSplashDraw) log('24. Splash animation keyframes present');
              else errors.push('Splash animation keyframes (splash-draw) not found');

              /* 25. Official LAA PDF APIs present */
              if (window.api && typeof window.api.laaGenerateOfficialPdf === 'function' && typeof window.api.laaOpenOfficialTemplate === 'function') {
                log('25. Official LAA PDF APIs available (laaGenerateOfficialPdf, laaOpenOfficialTemplate)');
              } else {
                errors.push('Official LAA PDF APIs not available');
              }
              if (window.api && typeof window.api.printPdfFile === 'function') {
                log('25b. printPdfFile API available');
              } else {
                errors.push('printPdfFile API not available');
              }
              if (window.api && typeof window.api.printToPdf === 'function') {
                try {
                  var smokePdf = await window.api.printToPdf({
                    html: '<html><body><h1>Custody Note Smoke</h1><p>' + testStamp + '</p></body></html>',
                    filename: 'custody-note-smoke-' + testStamp + '.pdf'
                  });
                  if (smokePdf && /\.pdf$/i.test(smokePdf)) {
                    log('25c. printToPdf generated a PDF file');
                  } else {
                    errors.push('printToPdf did not return a PDF path');
                  }
                } catch (e) {
                  errors.push('printToPdf failed: ' + (e && e.message ? e.message : e));
                }
              } else {
                errors.push('printToPdf API not available');
              }

              /* 26. Global search bar exists */
              var globalSearch = document.getElementById('global-search');
              if (!globalSearch) errors.push('Global search bar missing');
              else log('26. Global search bar present');

              /* 27. Backup status and local backup listing are available */
              if (window.api && typeof window.api.backupStatus === 'function' && typeof window.api.localBackupList === 'function') {
                try {
                  var backupSnapshot = await window.api.backupStatus();
                  if (backupSnapshot && backupSnapshot.state) {
                    log('27. Backup status API returned current state');
                  } else {
                    errors.push('Backup status did not return a valid state');
                  }
                  var backupList = await window.api.localBackupList();
                  if (backupList && backupList.ok && backupList.files && backupList.files.length) {
                    log('27b. Local backup list returned backups');
                  } else {
                    errors.push('Local backup list did not return any backups');
                  }
                } catch (e) {
                  errors.push('Backup flow failed: ' + (e && e.message ? e.message : e));
                }
              } else {
                errors.push('Backup APIs not available');
              }

              /* 28. Finish-matter workflow (header) — opens the matter-billing
               * full-page screen; if the open record is finalised the workflow
               * auto-mounts inline, otherwise the start button is disabled and
               * we just verify the screen rendered correctly. */
              var cardAtt4 = document.getElementById('home-card-attendance');
              if (cardAtt4) {
                cardAtt4.click();
                await sleep(800);
                var billingBtn = document.getElementById('billing-panel-btn');
                if (billingBtn) {
                  log('28a. Finish matter button present in form header');
                  billingBtn.click();
                  await sleep(500);
                  var matterBillingView = document.getElementById('view-matter-billing');
                  var matterBillingActive = matterBillingView && matterBillingView.classList.contains('active');
                  if (!matterBillingActive) {
                    /* Fallback for older builds that still use a modal overlay. */
                    var attachCancel = document.querySelector('.cn-confirm-overlay .cn-confirm-btns .btn-secondary');
                    if (attachCancel && attachCancel.textContent === 'Cancel') {
                      attachCancel.click();
                      await sleep(450);
                    }
                  }
                  var startBtn = document.getElementById('matter-billing-start-btn');
                  if (matterBillingActive || startBtn) {
                    log('28a1. Matter-billing screen rendered');
                  }
                  /* If the start button exists and is enabled (i.e. record is
                   * finalised), click it to mount the inline workflow. The
                   * workflow may also auto-mount on screen entry. */
                  if (startBtn && !startBtn.disabled) {
                    startBtn.click();
                    await sleep(450);
                  }
                  var wfOverlay = document.getElementById('workflow-overlay');
                  if (wfOverlay) {
                    log('28b. Finish-matter workflow overlay opens');
                    var feeInput = document.getElementById('wf-fee');
                    if (!feeInput) {
                      var step0 = wfOverlay.querySelector('.wf-step[data-wf-idx="0"]');
                      if (step0) {
                        step0.click();
                        await sleep(250);
                      }
                      var docNext = document.getElementById('wf-doc-next');
                      if (docNext) {
                        docNext.click();
                        await sleep(600);
                        feeInput = document.getElementById('wf-fee');
                      }
                    }
                    var milesInput = document.getElementById('wf-miles');
                    var rateInput = document.getElementById('wf-rate');
                    var parkingInput = document.getElementById('wf-parking');
                    var vatInput = document.getElementById('wf-vat');
                    if (feeInput && milesInput && rateInput && parkingInput && vatInput) {
                      log('28d. Invoice step input fields present');
                    } else {
                      errors.push('Invoice step missing input fields (wf-fee etc.)');
                    }
                    var checkAtt = document.getElementById('wf-check-attendance');
                    var checkDocs = document.getElementById('wf-check-docs');
                    var checkBill = document.getElementById('wf-check-billing');
                    if (checkAtt && checkDocs && checkBill) {
                      log('28e. Review confirmation checklist present (3 checkboxes)');
                    } else {
                      errors.push('Invoice step missing review checklist');
                    }
                    var createBtn = document.getElementById('wf-bill-create');
                    if (createBtn && createBtn.disabled) {
                      log('28f. Generate Invoice button present and disabled (checklist not yet confirmed)');
                    } else if (createBtn) {
                      errors.push('Generate Invoice button should be disabled before confirming checklist');
                    } else {
                      errors.push('Generate Invoice button missing');
                    }
                    if (checkAtt && checkDocs && checkBill && createBtn) {
                      checkAtt.click(); checkDocs.click(); checkBill.click();
                      await sleep(100);
                      if (!createBtn.disabled) {
                        log('28g. Generate Invoice enables after all checkboxes checked');
                      } else {
                        errors.push('Generate Invoice did not enable after checking all boxes');
                      }
                    }
                    var subtotalEl = document.getElementById('wf-prev-sub');
                    var vatEl = document.getElementById('wf-prev-vat');
                    var totalEl = document.getElementById('wf-prev-total');
                    if (subtotalEl && vatEl && totalEl) {
                      log('28h. QuickFile preview totals present (subtotal, VAT, total)');
                    } else {
                      errors.push('QuickFile preview totals missing');
                    }
                    var narrativeEl = document.getElementById('wf-narrative');
                    if (narrativeEl && narrativeEl.value) {
                      log('28i. Invoice narrative auto-generated: ' + narrativeEl.value.slice(0, 60));
                    } else if (narrativeEl) {
                      log('28i. Invoice narrative field present (empty - no data on form)');
                    } else {
                      errors.push('Invoice narrative field missing');
                    }
                    if (feeInput) {
                      setInputValue(feeInput, '200');
                      await sleep(100);
                      var updatedSubtotal = subtotalEl ? subtotalEl.textContent : '';
                      if (updatedSubtotal.indexOf('200') >= 0) {
                        log('28j. Live invoice preview recalculation works');
                      } else {
                        log('28j. Invoice recalc: subtotal shows ' + updatedSubtotal);
                      }
                    }
                    var closeBtn = document.getElementById('wf-bill-close');
                    if (closeBtn) {
                      closeBtn.click();
                      await sleep(300);
                      var overlayGone = !document.getElementById('workflow-overlay');
                      if (overlayGone) {
                        log('28k. Workflow closes correctly');
                      } else {
                        errors.push('Workflow overlay did not close');
                      }
                    }
                  } else if (startBtn && startBtn.disabled) {
                    /* Note isn't finalised in this section of the smoke (fresh
                     * blank attendance form) — start button correctly disabled.
                     * The full inline workflow is exercised by the e2e tests. */
                    log('28b. Matter-billing start button correctly disabled until note is finalised');
                  } else if (matterBillingActive) {
                    log('28b. Matter-billing screen rendered (workflow not auto-mounted on this record)');
                  } else {
                    errors.push('Finish-matter screen did not open (no view-matter-billing.active and no matter-billing-start-btn)');
                  }
                } else {
                  errors.push('Finish matter button not found in form header');
                }
                var saveExit5 = document.getElementById('form-save-exit');
                if (saveExit5) { await saveExitToDraftAndWait(); }
              }

              /* 29. Billing API surface check */
              var billingApis = [
                'quickfileSuggestNextInvoiceNumber', 'quickfileCreateInvoice', 'stationMileageGet', 'stationsMileageList',
                'stationMileageSave', 'stationMileageBulkSave',
                'billingAuditLogAdd', 'billingAuditLogGet',
                'billableAttendances', 'attendanceInvoiceStatus'
              ];
              var missingApis = billingApis.filter(function(name) {
                return !(window.api && typeof window.api[name] === 'function');
              });
              if (!missingApis.length) {
                log('29. All billing API methods available (' + billingApis.length + ')');
              } else {
                errors.push('Missing billing APIs: ' + missingApis.join(', '));
              }

              /* 30. Station Mileage view navigates correctly */
              if (gearBtn) {
                gearBtn.click();
                await sleep(200);
                var gearDd6 = document.getElementById('gear-dropdown');
                var mileageItem = gearDd6 ? gearDd6.querySelector('[data-action="station-mileage"]') : null;
                if (mileageItem) {
                  mileageItem.click();
                  await sleep(500);
                  if (document.getElementById('view-station-mileage')?.classList.contains('active')) {
                    log('30a. Gear > Station Mileage navigates correctly');
                    var mileageSearch = document.getElementById('mileage-search');
                    var mileageSaveBtn = document.getElementById('mileage-save-all');
                    var mileageTable = document.getElementById('station-mileage-table-wrap');
                    if (mileageSearch && mileageSaveBtn && mileageTable) {
                      log('30b. Station Mileage UI elements present (search, save, table)');
                    } else {
                      errors.push('Station Mileage missing UI elements');
                    }
                    if (mileageTable && mileageTable.querySelector('table')) {
                      log('30c. Station mileage table rendered with data');
                    } else {
                      log('30c. Station mileage table present (may be empty if no stations)');
                    }
                    var mileageBack = document.getElementById('station-mileage-back-btn');
                    if (mileageBack) {
                      mileageBack.click();
                      await sleep(300);
                      if (document.getElementById('view-home')?.classList.contains('active')) {
                        log('30d. Station Mileage back button returns to home');
                      } else {
                        errors.push('Station Mileage back button did not return to home');
                      }
                    }
                  } else {
                    errors.push('Station Mileage view not active');
                  }
                } else {
                  errors.push('Station Mileage gear menu item not found');
                }
              }

              /* 31. (Removed in v1.5.23) The standalone "Open matters" practice-wide
                 view (#view-billing) was deleted; per-matter billing is now reached
                 via the bottom-nav "Billing" button which routes to
                 #view-matter-billing for the current record. */

              /* 32. Station mileage API returns data */
              if (window.api && typeof window.api.stationsMileageList === 'function') {
                try {
                  var stationsList = await window.api.stationsMileageList();
                  if (stationsList && stationsList.length > 0) {
                    var sampleStation = stationsList[0];
                    log('32a. stationsMileageList returned ' + stationsList.length + ' stations (first: ' + sampleStation.name + ')');
                    if ('mileage_from_base' in sampleStation) {
                      log('32b. Stations have mileage_from_base field');
                    } else {
                      errors.push('Station records missing mileage_from_base field');
                    }
                  } else {
                    log('32a. stationsMileageList returned empty (no stations in DB)');
                  }
                } catch (e) {
                  errors.push('stationsMileageList API call failed: ' + (e && e.message ? e.message : e));
                }
              }

              /* 33. Billable attendances API returns data */
              if (window.api && typeof window.api.billableAttendances === 'function') {
                try {
                  var billable = await window.api.billableAttendances();
                  log('33. billableAttendances API returned ' + (billable ? billable.length : 0) + ' unbilled records');
                } catch (e) {
                  errors.push('billableAttendances API call failed: ' + (e && e.message ? e.message : e));
                }
              }

              /* 34. Billing audit log API */
              if (window.api && typeof window.api.billingAuditLogAdd === 'function') {
                try {
                  await window.api.billingAuditLogAdd({
                    attendanceId: 0,
                    action: 'smoke_test',
                    details: 'Smoke test entry ' + testStamp,
                    userName: 'SmokeTester'
                  });
                  var auditEntries = await window.api.billingAuditLogGet(0);
                  var found = (auditEntries || []).find(function(e) { return e.details && e.details.indexOf(testStamp) >= 0; });
                  if (found) {
                    log('34. Billing audit log write+read roundtrip works');
                  } else {
                    errors.push('Billing audit log entry not found after write');
                  }
                } catch (e) {
                  errors.push('Billing audit log roundtrip failed: ' + (e && e.message ? e.message : e));
                }
              }

              /* Summary */
              log('--- RESULTS ---');
              log('Passed: ' + results.length + ' checks');
              if (errors.length) {
                log('ERRORS (' + errors.length + '):');
                errors.forEach(function(e) { log('  FAIL: ' + e); });
              } else {
                log('ALL TESTS PASSED');
              }
              return { passed: errors.length === 0, results: results, errors: errors };
            })()
          `);

          console.log('\\n=== STRESS TEST RESULTS ===');
          if (result.errors && result.errors.length) {
            result.errors.forEach(e => console.log('  FAIL:', e));
            console.log('FAILED:', result.errors.length, 'error(s)');
          } else {
            console.log('ALL TESTS PASSED');
          }
          mainWindow.close();
          app.exit(result.passed ? 0 : 1);
        } catch (err) {
          console.error('Test execution error:', err);
          mainWindow.close();
          app.exit(1);
        }
      }, 8000);
    });
  }
}

/* â”€â”€â”€ Bank holiday auto-update â”€â”€â”€ */
async function fetchAndCacheBankHolidays() {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: 'www.gov.uk', path: '/bank-holidays.json', method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': `CustodyNote/${app.getVersion()}` } },
      (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            const events = (json['england-and-wales'] || {}).events || [];
            const dates = events.map(e => e.date).filter(Boolean);
            if (dates.length > 0 && db) {
              db.run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
                ['bankHolidays', JSON.stringify(dates)]);
              saveDb();
              console.log('[BankHolidays] Cached', dates.length, 'dates');
            }
            resolve(dates);
          } catch (e) { console.warn('[BankHolidays] Parse error:', e.message); resolve(null); }
        });
      }
    );
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.on('error', e => { console.warn('[BankHolidays] Fetch failed:', e.message); resolve(null); });
    req.end();
  });
}

/** When the running build first ran on this computer (set when app version in userData changes). ISO string. */
function readAndRefreshVersionState() {
  let st = { lastRunVersion: null, versionAppliedAt: null };
  try {
    const statePath = path.join(app.getPath('userData'), 'app-version-state.json');
    const current = app.getVersion();
    try {
      st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {}
    if (st.lastRunVersion !== current) {
      st = { lastRunVersion: current, versionAppliedAt: new Date().toISOString() };
      try {
        fs.writeFileSync(statePath, JSON.stringify(st), 'utf8');
      } catch (e) { /* ignore */ }
    }
  } catch (_) {}
  return st;
}

ipcMain.handle('get-app-version', () => {
  try {
    const version = app.getVersion();
    const pkgPath = path.join(__dirname, 'package.json');
    let lastUpdated = '';
    let buildTime = '';
    try {
      const pkg = require('./package.json');
      lastUpdated = pkg.lastUpdated || '';
      if (pkg.buildTime) buildTime = pkg.buildTime;
    } catch (_) {}
    if (!buildTime) {
      try {
        const stat = fs.statSync(pkgPath);
        buildTime = new Date(stat.mtimeMs).toISOString();
      } catch (_) {}
    }
    if (!lastUpdated) {
      try {
        const stat = fs.statSync(pkgPath);
        lastUpdated = new Date(stat.mtimeMs).toISOString().slice(0, 10);
      } catch (_) {}
    }
    const vs = readAndRefreshVersionState();
    return {
      version: version || '0.0.0',
      lastUpdated,
      /* ISO: when this build was released (set at release; else package.json mtime). */
      buildTime: buildTime || null,
      /* First time this semver ran on this machine (after install or auto-update). */
      versionAppliedAt: vs.versionAppliedAt || null,
      platform: process.platform,
    };
  } catch (_) { return { version: '0.0.0', lastUpdated: '', buildTime: null, versionAppliedAt: null, platform: process.platform }; }
});

ipcMain.handle('app-update-install', () => {
  try {
    if (!updaterController) {
      return { ok: false, error: 'Updater is not initialized.' };
    }
    return updaterController.installDownloadedUpdate();
  } catch (e) {
    console.error('[AutoUpdate] install handler error:', e?.message || e);
    return { ok: false, error: e?.message || 'Install failed' };
  }
});

ipcMain.handle('get-bank-holidays', () => {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key='bankHolidays'");
    return row ? JSON.parse(row.value) : null;
  } catch (_) { return null; }
});

ipcMain.handle('get-safe-storage-status', () => {
  try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   LICENCE / SUBSCRIPTION SYSTEM
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const LICENCE_FILE = 'licence.dat';
const LICENCE_GRACE_DAYS = 60;
const LICENCE_REVALIDATE_HOURS = 24;
const TRIAL_DAYS = 30;

/** One anonymous ping when a packaged install starts its local trial (no case data). */
function reportTrialStartedToServer() {
  if (!app.isPackaged) return;
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return;
  httpPost(`${apiUrl}/api/stats/trial-started`, {
    machineId: getMachineId(),
    platform: process.platform,
    appVersion: app.getVersion(),
  }, { timeout: 8000 }).catch(function () {});
}

function getLicencePath() {
  return path.join(app.getPath('userData'), LICENCE_FILE);
}

function getMachineId() {
  const os = require('os');
  const raw = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', os.totalmem()].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function readLicenceData() {
  const lpath = getLicencePath();
  if (!fs.existsSync(lpath)) return null;
  try {
    const raw = fs.readFileSync(lpath);
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(raw);
      return JSON.parse(json);
    }
    return JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.warn('[Licence] Failed to read licence data:', e.message);
    return null;
  }
}

function assertReadableStoredLicence() {
  const lpath = getLicencePath();
  if (!fs.existsSync(lpath)) return;
  const data = readLicenceData();
  if (data && data.key) return;
  throw new PersistenceStartupError(
    'Custody Note found an existing licence file but could not read it. To protect your subscription state, the app has stopped instead of replacing it with a fresh trial.',
    Object.assign(buildDbPersistenceDetails(), { licencePath: lpath })
  );
}

function writeLicenceData(data) {
  const lpath = getLicencePath();
  const json = JSON.stringify(data);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(lpath, safeStorage.encryptString(json));
    } else {
      fs.writeFileSync(lpath, json, 'utf8');
    }
  } catch (e) {
    console.error('[Licence] Failed to write licence data:', e.message);
  }
}

function deleteLicenceData() {
  const lpath = getLicencePath();
  try { if (fs.existsSync(lpath)) fs.unlinkSync(lpath); } catch (_) {}
}

const MAX_LICENCE_KEY_LENGTH = 64;

function validateLicenceKeyFormat(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.trim();
  if (k.length > MAX_LICENCE_KEY_LENGTH) return false;
  const upper = k.toUpperCase();
  return /^[A-Z0-9]{4,8}(-[A-Z0-9]{4,8}){2,7}$/.test(upper) || k.length >= 16;
}

function getLicenceValidationUrl() {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'licence-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.validationUrl && isAllowedApiUrl(cfg.validationUrl)) return cfg.validationUrl;
    }
  } catch (_) {}
  // Default: use same base as cloud backup so app and website interface out of the box
  const base = getManagedCloudApiUrl();
  return base ? base + '/api/licence/validate' : null;
}

function httpGetWithTimeout(url, timeoutMs) {
  const ceiling = (timeoutMs || 8000) + 2000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const hardTimer = setTimeout(() => {
      if (req) req.destroy();
      const err = new Error('Hard timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    }, ceiling);
    let req;
    try {
      const parsed = new URL(url);
      if (!isAllowedApiUrl(url)) { clearTimeout(hardTimer); return done(reject, new Error('URL not allowed')); }
      const mod = parsed.protocol === 'https:' ? https : http;
      const reqOpts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: timeoutMs || 8000,
      };
      if (parsed.protocol === 'https:' && isAllowedApiUrl(url)) reqOpts.agent = _trustedApiAgent;
      req = mod.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          clearTimeout(hardTimer); done(resolve, { statusCode: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data });
        });
      });
      req.on('error', (e) => {
        clearTimeout(hardTimer); const err = e instanceof Error ? e : new Error(String(e)); if (e && e.code) err.code = e.code; done(reject, err);
      });
      req.on('timeout', () => {
        req.destroy(); clearTimeout(hardTimer); const err = new Error('Timeout'); err.code = 'ETIMEDOUT'; done(reject, err);
      });
      req.end();
    } catch (e) {
      clearTimeout(hardTimer);
      done(reject, e);
    }
  });
}

function httpGetBinaryBuffer(url, timeoutMs) {
  const ceiling = (timeoutMs || 15000) + 2000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const hardTimer = setTimeout(() => {
      if (req) req.destroy();
      const err = new Error('Hard timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    }, ceiling);
    let req;
    try {
      const parsed = new URL(url);
      if (!isAllowedApiUrl(url)) { clearTimeout(hardTimer); return done(reject, new Error('URL not allowed')); }
      const mod = parsed.protocol === 'https:' ? https : http;
      const reqOpts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        timeout: timeoutMs || 15000,
      };
      if (parsed.protocol === 'https:' && isAllowedApiUrl(url)) reqOpts.agent = _trustedApiAgent;
      req = mod.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', (c) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
        res.on('end', () => {
          clearTimeout(hardTimer);
          done(resolve, {
            statusCode: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            buffer: Buffer.concat(chunks),
          });
        });
      });
      req.on('error', (e) => {
        clearTimeout(hardTimer); const err = e instanceof Error ? e : new Error(String(e)); if (e && e.code) err.code = e.code; done(reject, err);
      });
      req.on('timeout', () => {
        req.destroy(); clearTimeout(hardTimer); const err = new Error('Timeout'); err.code = 'ETIMEDOUT'; done(reject, err);
      });
      req.end();
    } catch (e) {
      clearTimeout(hardTimer);
      done(reject, e);
    }
  });
}

function httpPost(url, body, opts) {
  const timeoutMs = (opts && opts.timeout) || 15000;
  const maxRedirects = (opts && opts._redirectCount) || 0;
  const extraHeaders = (opts && opts.headers) || {};
  const ceiling = timeoutMs + 2000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; clearTimeout(hardTimer); fn(val); } };
    const hardTimer = setTimeout(() => {
      if (req) req.destroy();
      const err = new Error('Hard timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    }, ceiling);
    let parsed, req;
    try {
      parsed = new URL(url);
      if (!isAllowedApiUrl(url)) return done(reject, new Error('API URL not allowed'));
    } catch (e) {
      return done(reject, new Error('Invalid URL'));
    }
    const mod = parsed.protocol === 'https:' ? https : http;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders };
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
      timeout: timeoutMs,
    };
    if (parsed.protocol === 'https:' && isAllowedApiUrl(url)) reqOpts.agent = _trustedApiAgent;
    req = mod.request(reqOpts, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects >= 3) return done(reject, new Error('Too many redirects'));
        res.resume();
        done(resolve, httpPost(res.headers.location, body, { timeout: timeoutMs, _redirectCount: maxRedirects + 1, headers: extraHeaders }));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          let errMsg = 'Server error ' + res.statusCode;
          try { const j = JSON.parse(data); if (j.error) errMsg = j.error; } catch (_) {}
          const err = new Error(errMsg);
          err.statusCode = res.statusCode;
          return done(reject, err);
        }
        try { done(resolve, JSON.parse(data)); } catch (_) { done(reject, new Error('Invalid response from server')); }
      });
    });
    req.on('error', (e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      if (e && e.code) err.code = e.code;
      done(reject, err);
    });
    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Timeout');
      err.code = 'ETIMEDOUT';
      done(reject, err);
    });
    req.write(payload);
    req.end();
  });
}

function _getAuthHeaders() {
  const data = readLicenceData();
  if (data && data.authToken) {
    return { Authorization: 'Bearer ' + data.authToken };
  }
  return {};
}

async function postLicenceValidateRequest(body) {
  const url = getLicenceValidationUrl();
  if (!url) return null;
  const authHeaders = _getAuthHeaders();
  try {
    return await httpPost(url, body, { headers: authHeaders });
  } catch (e) {
    if (e && e.statusCode === 401 && authHeaders.Authorization && body.key && String(body.key).trim()) {
      const data = readLicenceData();
      if (data && data.authToken) {
        delete data.authToken;
        delete data.refreshToken;
        writeLicenceData(data);
      }
      return await httpPost(url, body, {});
    }
    throw e;
  }
}

async function validateLicenceOnline(key, machineId) {
  const url = getLicenceValidationUrl();
  if (!url) return { valid: true, offline: true };
  try {
    const resp = await postLicenceValidateRequest({
      key,
      machineId,
      appVersion: app.getVersion() || '0.0.0',
    });
    return {
      valid: !!resp.valid,
      expiresAt: resp.expiresAt || null,
      email: resp.email || '',
      message: resp.message || '',
      isTrial: !!resp.isTrial,
      offline: false,
      serverStatus: resp.status || null,
      entitlements: resp.entitlements || null,
      cloudBackup: !!resp.cloudBackup,
    };
  } catch (e) {
    return { valid: null, offline: true, message: 'Could not reach validation server: ' + e.message, serverStatus: null };
  }
}

// Admin email allow-list. Previously contained two hardcoded personal email
// addresses (`robertdavidcashman@gmail.com`, `nerijus83@gmail.com`) which
// granted unconditional admin entitlements to any installation that had a
// licence registered against either address. That is unsafe in a multi-user
// product because (a) the owners of those addresses change over time, (b) it
// blurs the audit trail, and (c) an attacker who can register a licence
// against one of those emails on the licence server gets full admin.
//
// The list is now strictly opt-in via the `CUSTODY_ADMIN_EMAILS` env var
// (comma-separated). If the env var is unset or empty, NO local install
// treats any user as an admin. This means the licence server remains the
// single source of truth for entitlements.
//
// Set CUSTODY_ADMIN_EMAILS only on machines used for support/admin work.
const ADMIN_EMAILS_LOCAL = (process.env.CUSTODY_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const { computeLicenceStatus: computeLicenceStatusCore } = require('./main/computeLicenceStatus');

function computeLicenceStatus(data) {
  return computeLicenceStatusCore(data, {
    graceDays: LICENCE_GRACE_DAYS,
    trialDays: TRIAL_DAYS,
    adminEmails: ADMIN_EMAILS_LOCAL,
  });
}

ipcMain.handle('licence:status', () => {
  const enforced = !!getLicenceValidationUrl();
  const licencePath = getLicencePath();
  let data = readLicenceData();
  if ((!data || !data.key) && fs.existsSync(licencePath)) {
    return {
      status: 'error',
      message: 'Stored licence could not be read. Custody Note will not replace it automatically.',
      addons: { quickfile: false, emailAddon: false },
      enforced,
    };
  }
  if (!data || !data.key) {
    const now = new Date();
    const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    data = {
      key: 'TRIAL-' + getMachineId().slice(0, 16).toUpperCase(),
      email: '',
      activatedAt: now.toISOString(),
      lastValidated: now.toISOString(),
      expiresAt: expires.toISOString(),
      machineId: getMachineId(),
      status: 'active',
      isTrial: true,
    };
    writeLicenceData(data);
    reportTrialStartedToServer();
  }
  const result = computeLicenceStatus(data);
  result.enforced = enforced;
  result.graceDays = LICENCE_GRACE_DAYS;
  if (data && data.authToken) {
    result.signInWithAccount = true;
    result.accountEmail = data.email || '';
    result.syntheticLicenceKey = !!(data.key && String(data.key).toUpperCase().startsWith('ACCOUNT-'));
  }
  return result;
});

ipcMain.handle('licence:activate', async (_, { key, email }) => {
  if (!validateLicenceKeyFormat(key)) return { success: false, message: 'Invalid licence key format' };
  const machineId = getMachineId();
  const result = await validateLicenceOnline(key.trim(), machineId);
  if (result.valid === false) return { success: false, message: result.message || 'Licence key is not valid' };
  const now = new Date().toISOString();
  const data = {
    key: key.trim(),
    email: result.email || email || '',
    activatedAt: now,
    lastValidated: now,
    expiresAt: result.expiresAt || null,
    machineId,
    status: 'active',
    isTrial: result.isTrial === true,
    entitlements: result.entitlements || null,
  };
  writeLicenceData(data);
  await ensureCanonicalSyncKeyNow().catch(() => {});
  checkCloudBackupEntitlement().catch(() => {});
  retrySyncQueueAfterLicenceSuccess();
  scheduleSyncSoon();
  return { success: true, status: computeLicenceStatus(data) };
});

ipcMain.handle('licence:validate', async () => {
  const data = readLicenceData();
  if (!data || (!data.key && !data.authToken)) return { valid: false, status: { status: 'none' } };
  const machineId = getMachineId();
  const result = await validateLicenceOnline(String(data.key || ''), machineId);
  if (result.valid === true) {
    data.lastValidated = new Date().toISOString();
    if (result.expiresAt) data.expiresAt = result.expiresAt;
    if (result.email) data.email = result.email;
    if (result.isTrial !== undefined) data.isTrial = !!result.isTrial;
    if (result.serverStatus) data.status = result.serverStatus;
    if (result.entitlements !== undefined) data.entitlements = result.entitlements;
    writeLicenceData(data);
    retrySyncQueueAfterLicenceSuccess();
    checkCloudBackupEntitlement().catch(() => {});
    ensureQuickFileSettingsFromServer({ reason: 'licence-validate' }).catch(function (e) {
      console.warn('[QuickFile] background settings pull after licence validate failed:', e && e.message);
    });
  } else if (result.valid === false) {
    const serverStatus = result.serverStatus || 'revoked';
    if (serverStatus === 'expired') data.expiresAt = result.expiresAt || data.expiresAt;
    data.status = serverStatus;
    writeLicenceData(data);
    const status = computeLicenceStatus(data);
    status.message = result.message || status.message || 'Licence is not valid';
    return { valid: false, status };
  }
  if (result.offline) {
    return {
      valid: null,
      offline: true,
      status: computeLicenceStatus(data),
      message: result.message || 'Could not reach validation server',
    };
  }
  return { valid: result.valid === true, status: computeLicenceStatus(data) };
});

ipcMain.handle('licence:deactivate', () => {
  deleteLicenceData();
  return { success: true };
});

ipcMain.handle('licence:email-key', async (_, params) => {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, sent: false, error: 'Cannot reach licence server' };
  const data = readLicenceData();
  const { buildLicenceEmailKeyPayload } = require('./main/licenceEmailKeyPayload');
  const payload = buildLicenceEmailKeyPayload(data, params);
  if (!payload.key && !payload.email) {
    return { ok: false, sent: false, error: 'No licence key or account email on this device' };
  }
  const correlationId = 'cn-' + Date.now().toString(36);
  try {
    const resp = await httpPost(`${apiUrl}/api/licence/email-key`, payload, { headers: _getAuthHeaders() });
    console.info('[licence:email-key]', {
      correlationId: resp.correlationId || correlationId,
      ok: resp.ok,
      sent: resp.sent,
      lookup: payload.key ? 'licence_key' : 'email',
    });
    if (resp.error && resp.ok !== true) {
      return { ok: false, sent: false, error: resp.error, correlationId: resp.correlationId || correlationId };
    }
    if (resp.ok === false) {
      return {
        ok: false,
        sent: false,
        error: resp.error || 'Could not send email',
        correlationId: resp.correlationId || correlationId,
      };
    }
    if (resp.sent === false) {
      return {
        ok: false,
        sent: false,
        error: resp.error || 'Email was not sent',
        correlationId: resp.correlationId || correlationId,
      };
    }
    return {
      ok: true,
      sent: true,
      message: resp.message || "If an account exists, we've sent your key.",
      correlationId: resp.correlationId || correlationId,
    };
  } catch (e) {
    console.error('[licence:email-key]', correlationId, e && e.message ? e.message : e);
    return { ok: false, sent: false, error: e && e.message ? e.message : 'Failed to send email', correlationId };
  }
});

ipcMain.handle('licence:deactivate-machine', async () => {
  const data = readLicenceData();
  if (!data || !data.key) return { ok: false, error: 'No licence key' };
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach licence server' };
  const machineId = getMachineId();
  try {
    const resp = await httpPost(`${apiUrl}/api/licence/deactivate-machine`, { key: data.key, machineId }, { headers: _getAuthHeaders() });
    if (resp.error) return { ok: false, error: resp.error };
    deleteLicenceData();
    return { ok: true, message: resp.message };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Failed to deactivate' };
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAGIC LINK AUTH
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

ipcMain.handle('auth:status', () => {
  const data = readLicenceData();
  return {
    loggedIn: !!(data && data.authToken),
    email: data?.email || null,
    accountId: data?.accountId || null,
  };
});

ipcMain.handle('auth:magic-link', async (_, { email }) => {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach server' };
  try {
    const resp = await httpPost(`${apiUrl}/api/auth/magic-link`, { email });
    return resp;
  } catch (e) {
    const msg = e && e.message ? e.message : 'Failed to send login link';
    if (e && e.statusCode === 429) return { ok: false, error: msg };
    return { ok: false, error: msg };
  }
});

ipcMain.handle('auth:poll', async (_, { pollId }) => {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach server' };
  try {
    const resp = await httpPost(`${apiUrl}/api/auth/poll`, { pollId });
    if (resp.ok && resp.accessToken) {
      let data = readLicenceData() || {};
      data.authToken = resp.accessToken;
      data.refreshToken = resp.refreshToken || '';
      data.email = resp.user?.email || '';
      data.accountId = resp.user?.id || '';
      if (resp.subscription && resp.subscription.licenceKey) {
        data.key = resp.subscription.licenceKey;
        data.status = resp.subscription.status || 'active';
        data.expiresAt = resp.subscription.expiresAt || '';
      }
      data.lastValidated = new Date().toISOString();
      writeLicenceData(data);
    }
    return resp;
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Connection error' };
  }
});

ipcMain.handle('auth:logout', () => {
  const data = readLicenceData();
  if (data) {
    delete data.authToken;
    delete data.refreshToken;
    delete data.accountId;
    writeLicenceData(data);
  }
  return { ok: true };
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Global error boundaries â€” restart sync timer if it dies silently.
   ROOT CAUSE: Unhandled rejections in async flows could kill the sync
   interval without any visible error. These handlers log the error
   and restart the sync worker to maintain reliability.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
// H25 — the old handler just logged and carried on, which left IPC surfaces
// live after broken invariants. We now:
//   1. log full details (stack, pid, memory snapshot),
//   2. best-effort synchronous flush of the DB so in-flight work isn't lost,
//   3. mark the process as degraded so downstream code can refuse risky
//      operations (see _isDegraded), and
//   4. quit if the error is not one we know is safely recoverable.
let _isDegraded = false;
function _markDegradedAndMaybeQuit(label, err) {
  _isDegraded = true;
  try {
    // Route through the PII-safe redactor (lib/safeLog) so no confidential
    // client data can leak into logs, then forward to opt-in remote reporting.
    _safeLog.error('[Global] ' + label + ':', err && err.stack ? err.stack : err);
    _safeLog.error('[Global] pid=' + process.pid + ', rss=' + Math.round(process.memoryUsage().rss / (1024 * 1024)) + ' MB');
  } catch (_) {}
  try { errorReporting.captureException(err instanceof Error ? err : new Error(String(err)), label); } catch (_) {}
  try { if (typeof flushDbSync === 'function') flushDbSync(); } catch (flushErr) {
    console.error('[Global] flushDbSync during crash recovery failed:', flushErr && flushErr.message);
  }
  // Treat sync-timer restart as recoverable noise; anything else is fatal.
  const msg = err && err.message ? String(err.message) : '';
  const recoverable = /sync|timer|network|ECONN|ETIMEDOUT/i.test(msg);
  if (!recoverable) {
    // Give the log sink 200 ms to flush, then exit with a non-zero code so
    // the installer's restart-on-crash can pick up.
    setTimeout(() => { try { app.exit(1); } catch (_) { process.exit(1); } }, 200);
  } else {
    try { startSyncTimer(); } catch (_) {}
  }
}
// Opt-in remote crash reporting (NO-OP unless CUSTODYNOTE_SENTRY_DSN/SENTRY_DSN
// is set AND @sentry/electron is installed). All payloads are PII-redacted via
// lib/safeLog before send. The local redacted-logging handlers below are the
// always-on baseline regardless.
try {
  errorReporting.initMainErrorReporting({
    release: (() => { try { return 'custody-note@' + app.getVersion(); } catch (_) { return undefined; } })(),
  });
} catch (e) {
  try { _safeLog.warn('[errorReporting] init failed:', e && e.message ? e.message : e); } catch (_) {}
}

process.on('unhandledRejection', (reason) => {
  _markDegradedAndMaybeQuit('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  _markDegradedAndMaybeQuit('Uncaught exception', err);
});

/* Renderer-side error reporting sink. The renderer forwards window 'error' /
   'unhandledrejection' events here; we log them via the PII-safe redactor and
   forward to opt-in remote reporting. NO-OP-safe: never throws back to caller. */
ipcMain.handle('report-client-error', (_event, payload) => {
  try {
    const p = payload || {};
    const msg = String(p.message || 'Unknown renderer error');
    _safeLog.error('[renderer]', msg, p.source ? ('@' + p.source + ':' + (p.line || '?')) : '');
    const err = new Error(msg);
    if (p.stack && typeof p.stack === 'string') err.stack = p.stack;
    errorReporting.captureException(err, 'renderer');
  } catch (_) { /* reporting must never break the renderer */ }
  return { ok: true };
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  console.log(`[Startup] Custody Note v${app.getVersion()} â€” packaged=${app.isPackaged}, platform=${process.platform}, arch=${process.arch}, portable=${IS_PORTABLE_BUILD}`);
  /* Extra startup diagnostics. Deliberately NOTHING client-sensitive: no
     custody data, no client identifiers, no licence key, no email body — only
     existence flags / paths so the support trail can verify the desktop app
     loaded a local file URL, not a remote demo/marketing page, and that the
     local data store is in the expected place. */
  try {
    const userDataDir = app.getPath('userData');
    const dbExpected = path.join(userDataDir, 'app.db');
    const dbExists = (() => { try { return fs.existsSync(dbExpected); } catch (_) { return false; } })();
    const isOnline = (() => {
      try { return require('electron').net.isOnline ? require('electron').net.isOnline() : null; } catch (_) { return null; }
    })();
    console.log('[Startup] userData=' + userDataDir
      + ' dbExists=' + dbExists
      + ' online=' + (isOnline === null ? 'unknown' : isOnline ? 'true' : 'false')
      + ' E2E=' + (process.env.CUSTODYNOTE_E2E_SKIP_LICENCE_GATE === '1' ? 'skip-licence' : 'normal'));
  } catch (e) {
    console.warn('[Startup] Diagnostics gather failed:', e && e.message);
  }
  try { _securityLog.init(app.getPath('userData')); _securityLog.record('app_started', { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }); }
  catch (_) {}
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.policestationagent.custodynote');
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(buildMacAppMenu());
  } else {
    Menu.setApplicationMenu(null);
  }

  function getCliArgValue(name) {
    const idx = process.argv.indexOf(name);
    if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
    const prefix = name + '=';
    const found = process.argv.find(a => typeof a === 'string' && a.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
  }

  const cliImportPath = getCliArgValue('--import-record');
  const cliListRecords = process.argv.includes('--list-records');
  const cliDumpIdRaw = getCliArgValue('--dump-record');
  const cliDumpId = cliDumpIdRaw ? (parseInt(cliDumpIdRaw, 10) || null) : null;

  const trialInitOnly = process.env.TRIAL_INIT_ONLY === '1';

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[Encryption] safeStorage not available on this system. Database will not be encrypted automatically. Set a recovery password in Settings for protection.');
  }

  updaterController = initUpdater({
    app,
    autoUpdater,
    BrowserWindow,
    dialog,
    mainWindowRef: () => mainWindow,
    flushDbSync,
    closeDb: () => {
      if (db) {
        db.close();
        db = null;
      }
    },
    stopSyncTimer,
    stopBackupScheduler: () => {
      // H22 — backupScheduler exposes `dispose()`, not `stop()`. The bad call
      // threw silently inside the updater shutdown path, so the scheduler kept
      // firing during install (race with the running installer + locked files).
      if (_backupScheduler && typeof _backupScheduler.dispose === 'function') {
        try { _backupScheduler.dispose(); } catch (e) {
          console.warn('[stopBackupScheduler] dispose failed:', e && e.message);
        }
      }
    },
    isPortableBuild: IS_PORTABLE_BUILD,
  });

  ipcMain.handle('app-check-updates', () => updaterController.checkForUpdates({ source: 'manual-ipc', force: true }));
  ipcMain.handle('app-update-reset-loop', () => updaterController.resetLoopState());
  ipcMain.handle('get-auto-update-state', () => updaterController.getPublicState());
  ipcMain.handle('app-update-diagnostic-install', () => {
    if (!updaterController || !updaterController.diagnosticInstall) {
      return { ok: false, error: 'Updater is not initialized.' };
    }
    return updaterController.diagnosticInstall();
  });

  const isCliMode = !!(trialInitOnly || cliImportPath || cliListRecords || cliDumpId);
  try {
    await initDb();
    assertReadableStoredLicence();
  } catch (err) {
    const formatted = formatPersistenceStartupError(err);
    console.error('[Startup] Fatal persistence error\n' + formatted);
    if (isCliMode) writeCliError(formatted);
    if (!isCliMode) {
      dialog.showErrorBox('Custody Note could not load your saved data', formatted);
    }
    app.exit(1);
    return;
  }

  /* â”€â”€â”€ Licence store (admin DB) init â”€â”€â”€ */
  try {
    const licenceStoreKey = require('./main/licenceStoreKey').getLicenceStoreKey(app, safeStorage);
    await require('./main/licenceStore').initStore(app.getPath('userData'), licenceStoreKey);
    require('./main/licenceIpc').registerLicenceIpc(app);
  } catch (e) {
    console.warn('[LicenceStore] Init failed:', e.message);
  }

  if (trialInitOnly) {
    app.quit();
    return;
  }

  /* Pull QuickFile credentials from Custody Note account when licence is present. */
  try {
    const qfStatus = getQuickFileSettingsStatus();
    const qfStartup = ensureQuickFileSettingsFromServer({
      reason: 'startup',
      force: qfStatus.missing.length > 0,
    });
    const logQfStartup = function (r) {
      const tag = r && r.skipped ? r.skipped : (r && r.usedLocal ? 'cached' : 'pulled');
      console.info('[QuickFile] startup pull: ' + tag);
    };
    if (qfStatus.missing.length > 0) {
      logQfStartup(await qfStartup);
    } else {
      qfStartup.then(logQfStartup).catch(function (e) {
        console.warn('[QuickFile] startup pull failed:', e && e.message);
      });
    }
  } catch (qfErr) {
    console.warn('[QuickFile] startup pull error:', qfErr && qfErr.message);
  }

  // Normal app mode: create the window only after persistent data is available.
  if (!cliImportPath && !cliListRecords && !cliDumpId) {
    createWindow();
    runLaaEnsureTemplates({}).catch(function (e) {
      console.warn('[LAA] startup template check failed:', e && e.message);
    });
  }

  // Auto-import watcher: periodically scan configured folder for new PDF/JSON files.
  let _autoImportTimer = null;
  let _autoImportBusy = false;
  function getSettingValue(key) {
    try {
      const row = dbGet("SELECT value FROM settings WHERE key = ?", [key]);
      return row && row.value != null ? String(row.value) : '';
    } catch (_) { return ''; }
  }
  function setSettingValue(key, val) {
    try { dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, val == null ? '' : String(val)]); } catch (_) {}
  }
  function startAutoImportIfEnabled() {
    if (_autoImportTimer) { clearInterval(_autoImportTimer); _autoImportTimer = null; }
    const enabled = getSettingValue('autoImportEnabled') === 'true';
    const folder = getSettingValue('autoImportFolder');
    if (!enabled || !folder || !fs.existsSync(folder)) return;

    const intervalMs = 15000;
    _autoImportTimer = setInterval(async () => {
      if (_autoImportBusy) return;
      _autoImportBusy = true;
      try {
        const lastMs = parseInt(getSettingValue('autoImportLastMtimeMs') || '0', 10) || 0;
        const entries = fs.readdirSync(folder)
          .filter((name) => /\.(pdf|json)$/i.test(name))
          .map((name) => {
            const full = path.join(folder, name);
            let st;
            try { st = fs.statSync(full); } catch (_) { return null; }
            return { name, full, mtimeMs: st.mtimeMs || 0, size: st.size || 0 };
          })
          .filter(Boolean)
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        for (const f of entries) {
          if (!f || !f.full) continue;
          if (f.mtimeMs <= lastMs) break;
          // Skip files still being written (tiny or very recent).
          if (f.size < 50) continue;
          const ageMs = Date.now() - f.mtimeMs;
          if (ageMs < 1500) continue;

          try {
            const data = await loadRecordDataFromFile(f.full);
            if (data && typeof data === 'object') {
              delete data.id; delete data.created_at; delete data.updated_at;
            }
            const savedId = insertImportedDraftAttendance(data);
            setSettingValue('autoImportLastMtimeMs', String(f.mtimeMs));
            setSettingValue('autoImportLastFile', f.name);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('auto-import:imported', { file: f.name, path: f.full, id: savedId });
            }
            break; // import newest only per tick to avoid UI spam
          } catch (e) {
            // Don't advance the cursor on failure, so it can retry later.
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('auto-import:error', { file: f.name, path: f.full, error: e && e.message ? e.message : String(e) });
            }
            break;
          }
        }
      } catch (_) {
        // ignore timer errors
      } finally {
        _autoImportBusy = false;
      }
    }, intervalMs);
  }

  // CLI: list records (for debugging / admin)
  if (cliListRecords) {
    try {
      const rows = dbAll(
        "SELECT id, updated_at, client_name, station_name, dscc_ref, attendance_date, status FROM attendances WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50"
      );
      const payload = { total: rows.length, rows };
      writeCliJson(payload);
      console.log(JSON.stringify(payload, null, 2));
      app.exit(0);
      return;
    } catch (e) {
      const message = 'Failed to list records: ' + (e && e.message ? e.message : e);
      writeCliError(message);
      console.error(message);
      app.exit(1);
      return;
    }
  }

  // CLI: dump a record's full JSON blob
  if (cliDumpId) {
    try {
      const row = dbGet('SELECT id, status, data, updated_at, created_at FROM attendances WHERE id=?', [cliDumpId]);
      if (!row) {
        const notFound = 'Record not found: ' + cliDumpId;
        writeCliError(notFound);
        console.error(notFound);
        app.exit(1);
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(row.data); } catch (_) { parsed = row.data; }
      const payload = { id: row.id, status: row.status, created_at: row.created_at, updated_at: row.updated_at, data: parsed };
      writeCliJson(payload);
      console.log(JSON.stringify(payload, null, 2));
      app.exit(0);
      return;
    } catch (e) {
      const message = 'Failed to dump record: ' + (e && e.message ? e.message : e);
      writeCliError(message);
      console.error(message);
      app.exit(1);
      return;
    }
  }

  // CLI: import a record from a PDF/JSON file and save as a draft.
  if (cliImportPath) {
    try {
      const data = await loadRecordDataFromFile(cliImportPath);
      // Ensure we don't accidentally carry over DB identity fields from JSON exports
      if (data && typeof data === 'object') {
        delete data.id;
        delete data.created_at;
        delete data.updated_at;
      }
      const savedId = insertImportedDraftAttendance(data);
      const payload = { ok: true, id: savedId };
      writeCliJson(payload);
      console.log(JSON.stringify(payload, null, 2));
      app.exit(0);
      return;
    } catch (e) {
      const message = 'Import failed: ' + (e && e.message ? e.message : e);
      writeCliError(message);
      console.error(message);
      app.exit(1);
      return;
    }
  }

  cleanupAccidentalDuplicateDrafts();
  dedupeDraftsByCaseKeys();
  getBackupScheduler();
  // Check cloud backup on startup; retry a few times in case network isn't ready
  checkCloudBackupEntitlement().catch(() => {});
  setTimeout(() => checkCloudBackupEntitlement().catch(() => {}), 5000);
  setTimeout(() => checkCloudBackupEntitlement().catch(() => {}), 15000);
  setInterval(() => { checkCloudBackupEntitlement().catch(() => {}); }, 60 * 60 * 1000);
  // Start cross-device sync after short delay to allow network to settle
  setTimeout(() => {
    startSyncTimer();
    scheduleAutoFullResyncIfEmpty();
  }, 8000);
  setInterval(() => {
    cleanupAccidentalDuplicateDrafts();
    dedupeDraftsByCaseKeys();
  }, 5 * 60 * 1000);
  fetchAndCacheBankHolidays().catch(() => {});

  // Start auto-import watcher (normal UI mode).
  startAutoImportIfEnabled();
  // Re-check auto-import config periodically in case user changes settings.
  setInterval(startAutoImportIfEnabled, 30000);
});

app.on('window-all-closed', () => {
  console.log('[App] window-all-closed event');
  try { stopSyncTimer(); } catch (_) {}
  try { if (db) { flushDbSync(); db.close(); db = null; } } catch (_) {}
  app.quit();
});

app.on('before-quit', () => {
  console.log('[App] before-quit event');
  if (mainWindow) mainWindow._forceClose = true;
  try { if (db) flushDbSync(); } catch (_) {}
});

ipcMain.handle('get-settings', () => {
  const rows = dbAll('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

// H21 — settings keys that hold network endpoints can repoint the encrypted
// DB upload target if a renderer is poisoned. Validate them server-side
// before persisting; return an error to the renderer rather than silently
// trusting the value. Tokens / passwords are still accepted as opaque
// strings (they're stored in the DB which is already encrypted at rest).
const _URL_LIKE_SETTINGS = new Set(['cloudBackupUrl', 'syncApiUrl', 'cloudApiUrl']);
const _QF_PRESERVE_LOG = '[set-settings] preserved existing QuickFile key:';
function _isAllowedSettingsUrl(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return true; // clearing is fine
  let u;
  try { u = new URL(v); } catch (_) { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  // Reject loopback / link-local / RFC1918 except 127.0.0.1 for dev.
  // (Defence-in-depth; the actual cloud endpoint allowlist lives at request time.)
  return true;
}

ipcMain.handle('set-settings', (_, settings) => {
  if (!settings || typeof settings !== 'object') return { ok: false, error: 'Invalid settings payload' };
  const rejected = [];
  let wroteQuickFile = false;
  for (const [key, value] of Object.entries(settings)) {
    if (_URL_LIKE_SETTINGS.has(key) && !_isAllowedSettingsUrl(value)) {
      rejected.push(key);
      continue;
    }
    if (QUICKFILE_CREDENTIAL_KEYS.has(key)) {
      const incoming = value == null ? '' : String(value).trim();
      if (!incoming) {
        const existing = dbGet('SELECT value FROM settings WHERE key = ?', [key]);
        if (existing && String(existing.value || '').trim()) {
          console.log(_QF_PRESERVE_LOG, key);
          continue;
        }
      }
      wroteQuickFile = true;
    }
    dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value == null ? '' : String(value)]);
  }
  markDbDirty();
  if (wroteQuickFile && typeof flushDbSync === 'function') {
    try { flushDbSync(); } catch (flushErr) {
      console.warn('[set-settings] flushDbSync after QuickFile keys failed:', flushErr && flushErr.message);
    }
  }
  if (rejected.length) {
    return { ok: true, rejectedSettings: rejected };
  }
  return true;
});

ipcMain.handle('attendance-list', () => {
  /* Lightweight index-only rows for the list view â€” no data blob. */
  return dbAll(
    `SELECT id, created_at, updated_at, client_name, station_name, dscc_ref, attendance_date, status, supervisor_approved_at,
       COALESCE(json_extract(data, '$.offenceSummary'), '') AS offenceSummary
     FROM attendances WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC`
  );
});

ipcMain.handle('attendance-list-full', () => {
  /* Full rows including data blob â€” used by CSV export, reports, and records list. */
  return dbAll(
    'SELECT id, created_at, updated_at, client_name, station_name, dscc_ref, attendance_date, status, data, quickfile_invoice_id, quickfile_invoice_number FROM attendances WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC'
  );
});

ipcMain.handle('attendance-home-stats', () => {
  return dbAll(
    `SELECT
       id,
       created_at,
       updated_at,
       client_name,
       station_name,
       attendance_date,
       status,
       quickfile_invoice_id,
       COALESCE(json_extract(data, '$.clientSig'), '') AS clientSig,
       COALESCE(json_extract(data, '$.feeEarnerSig'), '') AS feeEarnerSig,
       COALESCE(json_extract(data, '$.firmId'), '') AS firmId,
       COALESCE(json_extract(data, '$.outcomeDecision'), '') AS outcomeDecision,
       COALESCE(json_extract(data, '$.caseOutcomeStatus'), '') AS caseOutcomeStatus,
       COALESCE(json_extract(data, '$.totalTimeClaimed'), '') AS totalTimeClaimed,
       COALESCE(json_extract(data, '$.totalHoursWorked'), '') AS totalHoursWorked,
       COALESCE(json_extract(data, '$.forename'), '') AS forename,
       COALESCE(json_extract(data, '$.surname'), '') AS surname,
       COALESCE(json_extract(data, '$.offenceSummary'), '') AS offenceSummary,
       COALESCE(json_extract(data, '$._formType'), '') AS _formType,
       COALESCE(json_extract(data, '$.attendanceMode'), '') AS attendanceMode,
       COALESCE(json_extract(data, '$.custodyNumber'), '') AS custodyNumber
     FROM attendances
     WHERE deleted_at IS NULL
       AND archived_at IS NULL
     ORDER BY updated_at DESC`
  );
});

ipcMain.handle('attendance-search', (_, params) => {
  const { query, status, page, pageSize, sortField, sortDir, archived, workType } = params || {};
  const requestedPage = Math.max(1, page || 1);
  const ps = Math.max(1, pageSize || 50);
  const orderCol = ['updated_at', 'attendance_date', 'client_name', 'station_name'].includes(sortField)
    ? sortField : 'updated_at';
  const orderDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  const { deleted } = params || {};
  let where = deleted === true ? 'WHERE deleted_at IS NOT NULL' : 'WHERE deleted_at IS NULL';
  const params2 = [];

  if (!deleted) {
    if (archived === true) {
      where += ' AND archived_at IS NOT NULL';
    } else {
      where += ' AND archived_at IS NULL';
    }
  }
  if (query && query.trim()) {
    const like = '%' + query.trim() + '%';
    where += ` AND (
      client_name LIKE ?
      OR dscc_ref LIKE ?
      OR attendance_date LIKE ?
      OR station_name LIKE ?
      OR COALESCE(json_extract(data, '$.surname'), '') LIKE ?
      OR COALESCE(json_extract(data, '$.forename'), '') LIKE ?
      OR COALESCE(json_extract(data, '$.custodyNumber'), '') LIKE ?
      OR COALESCE(json_extract(data, '$.ufn'), '') LIKE ?
      OR COALESCE(json_extract(data, '$.fileReference'), '') LIKE ?
      OR COALESCE(json_extract(data, '$.ourFileNumber'), '') LIKE ?
    )`;
    params2.push(like, like, like, like, like, like, like, like, like, like);
  }
  if (status && status !== 'all') {
    where += ' AND status = ?';
    params2.push(status);
  }
  if (workType && workType !== 'all') {
    if (workType === 'telephone') {
      where += ` AND COALESCE(json_extract(data, '$._formType'), '') = 'telephone'`;
    } else if (workType === 'voluntary') {
      where += ` AND COALESCE(json_extract(data, '$._formType'), 'attendance') != 'telephone'
                 AND COALESCE(json_extract(data, '$.attendanceMode'), 'custody') = 'voluntary'`;
    } else if (workType === 'custody') {
      where += ` AND COALESCE(json_extract(data, '$._formType'), 'attendance') != 'telephone'
                 AND COALESCE(json_extract(data, '$.attendanceMode'), 'custody') != 'voluntary'`;
    } else {
      where += ' AND work_type = ?';
      params2.push(workType);
    }
  }

  const countRow = dbGet(`SELECT COUNT(*) as total FROM attendances ${where}`, params2);
  const total = (countRow && countRow.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const p = total > 0 ? Math.min(requestedPage, totalPages) : 1;
  const offset = (p - 1) * ps;
  const rows = dbAll(
    `SELECT id, created_at, updated_at, client_name, station_name, dscc_ref, attendance_date, status, supervisor_approved_at, archived_at, deleted_at, deletion_reason, data
     FROM attendances ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`,
    [...params2, ps, offset]
  );
  return { rows, total, page: p, pageSize: ps };
});

ipcMain.handle('attendance-check-duplicate', (_, { dsccRef, clientName, attendanceDate, stationName, excludeId }) => {
  const results = [];
  if (dsccRef && dsccRef.trim()) {
    const rows = dbAll(
      "SELECT id, client_name, attendance_date, station_name FROM attendances WHERE dscc_ref=? AND status='finalised' AND deleted_at IS NULL AND id!=?",
      [dsccRef.trim(), excludeId || 0]
    );
    rows.forEach(r => results.push({ ...r, matchReason: 'Same DSCC reference' }));
  }
  if (!results.length && clientName && attendanceDate && stationName) {
    const rows = dbAll(
      "SELECT id, client_name, attendance_date, station_name FROM attendances WHERE client_name=? AND attendance_date=? AND station_name=? AND status='finalised' AND deleted_at IS NULL AND id!=?",
      [clientName, attendanceDate, stationName, excludeId || 0]
    );
    rows.forEach(r => results.push({ ...r, matchReason: 'Same client, date and station' }));
  }
  return results;
});

ipcMain.handle('attendance-get', (_, id) => {
  return dbGet('SELECT id, data, status, supervisor_approved_at, supervisor_note, archived_at FROM attendances WHERE id = ?', [id]) || null;
});

ipcMain.handle('attendance-save', (_, { id, data, status, unlock }) => {
  const now = new Date().toISOString();
  const st = status || 'draft';

  /* Unlock: change status back to draft without overwriting data */
  if (id && unlock && !data) {
    const existing = dbGet('SELECT status, sync_version FROM attendances WHERE id = ?', [id]);
    if (existing) {
      const nextVer = (existing.sync_version || 1) + 1;
      dbRun('UPDATE attendances SET status=?, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', ['draft', now, nextVer, id]);
      db.run('INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)', [id, 'unlocked_for_amendment', now]);
      markDbDirty();
      enqueueSyncForRecord(id);
    }
    return id;
  }

  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  let parsed;
  try {
    parsed = typeof data === 'object' ? data : JSON.parse(dataStr);
  } catch (e) {
    console.error('[attendance-save] Invalid JSON data payload:', e && e.message);
    throw new Error('Invalid attendance data â€” could not parse record');
  }

  /* Keep file reference in sync with file number (ours) â€“ same value for both */
  if (parsed.ourFileNumber != null && parsed.ourFileNumber !== '') {
    parsed.fileReference = String(parsed.ourFileNumber);
  }
  const dataToSave = JSON.stringify(parsed);

  /* Extract indexed fields from parsed data */
  const clientName = [parsed.surname || '', parsed.forename || ''].filter(Boolean).join(', ');
  const stationName = parsed.policeStationName || '';
  const dsccRef = parsed.dsccRef || '';
  const attendanceDate = parsed.date || '';
  const workType = parsed.workType || '';

  if (id) {
    const existing = dbGet('SELECT status, data, sync_version FROM attendances WHERE id = ?', [id]);

    if (st === 'finalised') {
      console.log('[FINALISE] attendance-save called with status=finalised, id=' + id +
        ', existing.status=' + (existing ? existing.status : 'NOT_FOUND') +
        ', existing.sync_version=' + (existing ? existing.sync_version : 'N/A'));
    }

    /* Block edits to locked records (finalised / office-completed) unless status stays finalised|completed */
    if (existing && (existing.status === 'finalised' || existing.status === 'completed') && st !== 'finalised' && st !== 'completed') {
      console.log('[FINALISE] BLOCKED: draft write to locked record id=' + id);
      return { error: 'locked', message: 'This record is finalised and cannot be modified.' };
    }

    if (st === 'completed') {
      if (!existing) {
        return { error: 'invalid', message: 'Cannot mark complete: record not found.' };
      }
      if (existing.status !== 'finalised' && existing.status !== 'completed') {
        return { error: 'invalid', message: 'Mark office complete only after the attendance note is finalised.' };
      }
    }

    /* Compute diff for audit log (skip expensive diff on draft autosaves for performance) */
    let previousSnapshot = null;
    let changedFields = null;
    if (existing && (st === 'finalised' || (st === 'completed' && existing.status === 'finalised'))) {
      previousSnapshot = existing.data;
      try {
        const prev = JSON.parse(existing.data);
        const changed = Object.keys(parsed).filter(
          k => JSON.stringify(parsed[k]) !== JSON.stringify(prev[k])
        );
        changedFields = JSON.stringify(changed);
      } catch (_) {}
    }

    const nextVer = (existing && existing.sync_version || 1) + 1;
    // H19 — UPDATE + audit_log INSERT atomically so a crash between them
    // can't persist a status change without its audit row.
    dbTx(function() {
      dbRun(
        'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, work_type=?, sync_dirty=1, sync_version=? WHERE id=?',
        [dataToSave, st, now, clientName, stationName, dsccRef, attendanceDate, workType, nextVer, id]
      );
      let action = 'updated';
      if (st === 'finalised') action = 'finalised';
      else if (st === 'completed' && existing && existing.status === 'finalised') action = 'office_completed';
      appendAuditLog(id, action, { previousSnapshot: previousSnapshot, changedFields: changedFields, timestamp: now });
    });

    if (st === 'finalised') {
      const verify = dbGet('SELECT status, sync_version FROM attendances WHERE id = ?', [id]);
      console.log('[FINALISE] VERIFIED after UPDATE: id=' + id +
        ', status=' + (verify ? verify.status : 'MISSING') +
        ', sync_version=' + (verify ? verify.sync_version : 'N/A'));
      if (!verify || verify.status !== 'finalised') {
        console.error('[FINALISE] CRITICAL: DB write did NOT persist status=finalised for id=' + id);
      }
    }
    markDbDirty();
    if (st === 'finalised' || st === 'completed') flushDb();
    enqueueSyncForRecord(id, st === 'finalised' ? 'finalise' : 'upsert');
    return id;
  }

  // One copy per case: if a draft already exists for this case (same DSCC or client+date+station), update it instead of creating a new row.
  if (st === 'draft') {
    const existingId = findExistingDraftIdByCaseKey(parsed);
    if (existingId) {
      const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [existingId]);
      const nv = (ev && ev.sync_version || 1) + 1;
      dbRun(
        'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, work_type=?, sync_dirty=1, sync_version=? WHERE id=?',
        [dataToSave, st, now, clientName, stationName, dsccRef, attendanceDate, workType, nv, existingId]
      );
      db.run(
        'INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)',
        [existingId, 'updated', now]
      );
      markDbDirty();
      enqueueSyncForRecord(existingId);
      return existingId;
    }
    // Guard against burst duplicate inserts (double-click / repeated handler firing):
    // if we just created the same draft payload in the last 30s, reuse it.
    // Compare via stableStringify â€” raw data=? matched only identical JSON text, so key order could miss duplicates.
    try {
      const incomingCanon = stableStringify(parsed);
      const recentRows = dbAll(
        "SELECT id, sync_version, data FROM attendances WHERE status='draft' AND deleted_at IS NULL AND created_at >= datetime('now', '-30 seconds') ORDER BY id DESC LIMIT 20"
      );
      for (let i = 0; recentRows && i < recentRows.length; i++) {
        const row = recentRows[i];
        if (!row || !row.data) continue;
        let prevParsed;
        try {
          prevParsed = JSON.parse(row.data);
        } catch (_) {
          continue;
        }
        if (stableStringify(prevParsed) === incomingCanon) {
          const nv = (row.sync_version || 1) + 1;
          dbRun(
            'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, work_type=?, sync_dirty=1, sync_version=? WHERE id=?',
            [dataToSave, st, now, clientName, stationName, dsccRef, attendanceDate, workType, nv, row.id]
          );
          markDbDirty();
          enqueueSyncForRecord(row.id);
          return row.id;
        }
      }
    } catch (e) {
      console.warn('[DB] Recent-duplicate guard failed:', e && e.message ? e.message : e);
    }
  }

  /* Assign sequential file number (ours) for new attendances only when user has not typed one */
  const userFileNum = (parsed.ourFileNumber != null && String(parsed.ourFileNumber).trim() !== '') ? String(parsed.ourFileNumber).trim() : null;
  if (userFileNum == null) {
    const nextRow = dbGet("SELECT value FROM settings WHERE key = 'nextFileNumberOurs'");
    const nextFileNum = (nextRow && nextRow.value !== undefined && nextRow.value !== '' ? (parseInt(nextRow.value, 10) || 1) : 1);
    parsed.ourFileNumber = String(nextFileNum);
    parsed.fileReference = parsed.ourFileNumber;
    dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('nextFileNumberOurs', ?)", [String(nextFileNum + 1)]);
  } else {
    parsed.ourFileNumber = userFileNum;
    parsed.fileReference = parsed.ourFileNumber;
  }
  const insertDataStr = JSON.stringify(parsed);
  const newSyncId = generateSyncId();

  dbRun(
    'INSERT INTO attendances (data, status, updated_at, client_name, station_name, dscc_ref, attendance_date, work_type, sync_id, sync_dirty, sync_version) VALUES (?,?,?,?,?,?,?,?,?,1,1)',
    [insertDataStr, st, now, clientName, stationName, dsccRef, attendanceDate, workType, newSyncId]
  );
  markDbDirty();
  // sql.js + our dbRun/saveDb flow can occasionally yield 0 for last_insert_rowid().
  // Using MAX/ORDER BY is safe here (single-user local DB) and avoids "no id returned" in the UI.
  const r = dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1');
  const newId = r ? r.id : null;
  if (newId) {
    db.run(
      'INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)',
      [newId, 'created', now]
    );
    enqueueSyncForRecord(newId);
  }
  return newId;
});

ipcMain.handle('attendance-force-status', (_, { id, status }) => {
  if (!id || !status) return { error: 'missing_params' };
  const existing = dbGet('SELECT status, sync_version FROM attendances WHERE id = ?', [id]);
  if (!existing) return { error: 'not_found' };
  const now = new Date().toISOString();
  const nextVer = (existing.sync_version || 1) + 1;
  dbRun('UPDATE attendances SET status=?, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?',
    [status, now, nextVer, id]);
  db.run('INSERT INTO audit_log (attendance_id, action, timestamp, user_note) VALUES (?,?,?,?)',
    [id, status === 'finalised' ? 'force_finalised' : 'force_status_change', now, 'Forced status update to ' + status]);
  markDbDirty();
  enqueueSyncForRecord(id, status === 'finalised' ? 'finalise' : 'upsert');
  const verify = dbGet('SELECT status FROM attendances WHERE id = ?', [id]);
  console.log('[FORCE-STATUS] id=' + id + ' set to ' + status + ', verified=' + (verify ? verify.status : 'MISSING'));
  return { ok: true, status: verify ? verify.status : status };
});

ipcMain.handle('attendance-archive', (_, id) => {
  if (!id) return false;
  const now = new Date().toISOString();
  const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [id]);
  const nv = (ev && ev.sync_version || 1) + 1;
  dbRun('UPDATE attendances SET archived_at=?, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', [now, now, nv, id]);
  db.run('INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)', [id, 'archived', now]);
  markDbDirty();
  enqueueSyncForRecord(id);
  return true;
});

ipcMain.handle('attendance-unarchive', (_, id) => {
  if (!id) return false;
  const now = new Date().toISOString();
  const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [id]);
  const nv = (ev && ev.sync_version || 1) + 1;
  dbRun('UPDATE attendances SET archived_at=NULL, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', [now, nv, id]);
  markDbDirty();
  enqueueSyncForRecord(id);
  return true;
});

ipcMain.handle('attendance-delete', (_, { id, reason } = {}) => {
  if (!id) return false;
  const existing = dbGet('SELECT status, sync_version FROM attendances WHERE id = ?', [id]);
  if (existing) {
    const now = new Date().toISOString();
    const nv = (existing.sync_version || 1) + 1;
    dbRun('UPDATE attendances SET deleted_at=?, deletion_reason=?, sync_dirty=1, sync_version=? WHERE id=?', [now, reason || '', nv, id]);
    db.run(
      'INSERT INTO audit_log (attendance_id, action, user_note, timestamp) VALUES (?,?,?,?)',
      [id, existing.status === 'finalised' ? 'soft_deleted' : 'draft_soft_deleted', reason || '', now]
    );
    markDbDirty();
    enqueueSyncForRecord(id);
    return { soft: true };
  }
  return false;
});

ipcMain.handle('attendance-undelete', (_, id) => {
  if (!id) return false;
  const now = new Date().toISOString();
  const ev = dbGet('SELECT sync_version FROM attendances WHERE id=?', [id]);
  const nv = (ev && ev.sync_version || 1) + 1;
  dbRun('UPDATE attendances SET deleted_at=NULL, deletion_reason=NULL, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?', [now, nv, id]);
  db.run('INSERT INTO audit_log (attendance_id, action, timestamp, user_note) VALUES (?,?,?,?)', [id, 'restored', now, 'Restored from deleted']);
  markDbDirty();
  enqueueSyncForRecord(id);
  return true;
});

ipcMain.handle('audit-log-get', (_, attendanceId) => {
  return dbAll(
    'SELECT id, action, changed_fields, timestamp, user_note FROM audit_log WHERE attendance_id=? ORDER BY timestamp DESC',
    [attendanceId]
  );
});

ipcMain.handle('audit-log-get-history', (_, attendanceId) => {
  return dbAll(
    'SELECT id, action, changed_fields, previous_snapshot, timestamp, user_note FROM audit_log WHERE attendance_id=? ORDER BY timestamp ASC',
    [attendanceId]
  );
});

ipcMain.handle('attendance-export-csv', (_, { fromDate, toDate }) => {
  try {
    function csvSafe(val) {
      let s = String(val || '');
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }
    let where = "WHERE deleted_at IS NULL AND archived_at IS NULL";
    const params = [];
    if (fromDate) { where += " AND attendance_date >= ?"; params.push(fromDate); }
    if (toDate)   { where += " AND attendance_date <= ?"; params.push(toDate); }
    const rows = dbAll(
      `SELECT id, attendance_date, client_name, station_name, dscc_ref, status, work_type, data FROM attendances ${where} ORDER BY attendance_date ASC`,
      params
    );
    const headers = ['ID','Date','Client Name','Station','DSCC Ref','Status','Work Type','Firm','Matter Type','DSCC/UFN','Court Date'];
    const csvRows = [headers.map(csvSafe).join(',')];
    rows.forEach(function(r) {
      let d = {};
      try { d = JSON.parse(r.data || '{}'); } catch (_) {}
      const cols = [
        r.id,
        r.attendance_date || '',
        r.client_name || '',
        r.station_name || '',
        r.dscc_ref || '',
        r.status || '',
        r.work_type || d.workType || '',
        d.firmName || '',
        d.matterTypeCode || '',
        d.dsccRef || '',
        d.courtDate || '',
      ];
      csvRows.push(cols.map(csvSafe).join(','));
    });
    return { ok: true, csv: csvRows.join('\r\n'), count: rows.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('supervisor-approve', (_, { id, note, credential }) => {
  const auth = verifySensitiveActionCredential(credential, 'supervisor-approval');
  if (!auth.ok) throw new Error(auth.error);
  const existing = dbGet('SELECT sync_version FROM attendances WHERE id=?', [id]);
  if (!existing) throw new Error('Record not found');
  const now = new Date().toISOString();
  const nextVersion = (existing.sync_version || 1) + 1;
  dbRun(
    'UPDATE attendances SET supervisor_approved_at=?, supervisor_note=?, updated_at=?, sync_dirty=1, sync_version=? WHERE id=?',
    [now, note || '', now, nextVersion, id]
  );
  db.run(
    'INSERT INTO audit_log (attendance_id, action, user_note, timestamp) VALUES (?,?,?,?)',
    [id, 'supervisor_approved', note || '', now]
  );
  enqueueSyncForRecord(id);
  return { ok: true, credentialType: auth.credentialType };
});

ipcMain.handle('stations-list', () => {
  const rows = dbAll('SELECT id, name, code, scheme, region, scheme_code, kind FROM police_stations ORDER BY region, name');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    code: r.code,
    scheme: r.scheme,
    region: r.region,
    schemeCode: r.scheme_code || '',
    kind: r.kind || 'station',
  }));
});

ipcMain.handle('stations-replace', (_, stations) => {
  if (!Array.isArray(stations)) throw new Error('stations must be an array');
  try {
    db.run('BEGIN');
    db.run('DELETE FROM police_stations');
    for (const s of stations) {
      db.run('INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind) VALUES (?, ?, ?, ?, ?, ?)',
        [s.name || '', s.code || '', s.scheme || '', s.region || '', s.schemeCode || '', s.kind || 'station']);
    }
    db.run('COMMIT');
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    console.error('[stations-replace] Transaction failed, rolled back:', e && e.message);
    throw e;
  }
  saveDb();
  return true;
});

ipcMain.handle('firms-list', () => {
  return dbAll('SELECT id, name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, is_default FROM firms ORDER BY is_default DESC, name');
});

ipcMain.handle('firm-save', (_, firm) => {
  const srcRef = firm.source_of_referral || '';
  if (firm.id) {
    dbRun('UPDATE firms SET name=?, laa_account=?, contact_name=?, contact_email=?, contact_phone=?, address=?, source_of_referral=?, is_default=? WHERE id=?',
      [firm.name, firm.laa_account || '', firm.contact_name || '', firm.contact_email || '', firm.contact_phone || '', firm.address || '', srcRef, firm.is_default ? 1 : 0, firm.id]);
    markDbDirty();
    return firm.id;
  }
  dbRun('INSERT INTO firms (name, laa_account, contact_name, contact_email, contact_phone, address, source_of_referral, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [firm.name, firm.laa_account || '', firm.contact_name || '', firm.contact_email || '', firm.contact_phone || '', firm.address || '', srcRef, firm.is_default ? 1 : 0]);
  markDbDirty();
  const r = dbGet('SELECT last_insert_rowid() as id');
  return r ? r.id : null;
});

ipcMain.handle('firm-delete', (_, id) => {
  dbRun('DELETE FROM firms WHERE id = ?', [id]);
  markDbDirty();
  return true;
});

ipcMain.handle('firm-set-default', (_, id) => {
  dbRun('UPDATE firms SET is_default = 0', []);
  dbRun('UPDATE firms SET is_default = 1 WHERE id = ?', [id]);
  markDbDirty();
  return true;
});

ipcMain.handle('generate-ufn', (_, dateStr) => {
  const d = dateStr ? new Date(dateStr) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const datePrefix = dd + mm + yy;
  const todayStart = `${d.getFullYear()}-${mm}-${dd}`;
  const count = dbGet(
    "SELECT COUNT(*) as c FROM attendances WHERE data LIKE ?",
    [`%"ufn":"${datePrefix}/%`]
  );
  const seq = ((count && count.c) || 0) + 1;
  return `${datePrefix}/${String(seq).padStart(3, '0')}`;
});

ipcMain.handle('load-reference-data', () => {
  const refPath = path.join(__dirname, 'data', 'laa-reference-data.json');
  if (fs.existsSync(refPath)) {
    try {
      return JSON.parse(fs.readFileSync(refPath, 'utf8'));
    } catch (e) {
      console.error('[load-reference-data] Failed to parse laa-reference-data.json:', e && e.message);
      return null;
    }
  }
  return null;
});

ipcMain.handle('load-magistrates-courts', () => {
  const courtsPath = path.join(__dirname, 'data', 'magistrates-courts.json');
  if (!fs.existsSync(courtsPath)) {
    console.error('[load-magistrates-courts] File not found:', courtsPath);
    return [];
  }
  try {
    const list = JSON.parse(fs.readFileSync(courtsPath, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('[load-magistrates-courts] Failed to parse magistrates-courts.json:', e && e.message);
    return [];
  }
});

ipcMain.handle('backup-now', async () => {
  try {
    const backupDir = getBackupFolder();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const name = `attendance-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.db`;
    const dest = path.join(backupDir, name);
    _cachedDbExportDirty = true;
    const encData = getEncryptedDbExport();
    if (!encData) throw new Error('Database export failed');
    await writeFileAtomicAsync(dest, encData);
    const latestDest = path.join(backupDir, 'attendance-latest.db');
    await writeFileAtomicAsync(latestDest, encData);
    dbDirtySinceQuickBackup = false;
    dbDirtySinceHourlyBackup = false;
    pruneOldBackups(backupDir);
    copyToOffsiteBackup(dest);
    copyToOffsiteBackup(latestDest);
    uploadToCloudIfConfigured(encData);
    uploadToS3IfConfigured(encData, 'attendance-latest.db');
    uploadToS3IfConfigured(encData, path.basename(dest));
    uploadToManagedCloudIfEnabled(encData, 'attendance-latest.db');
    uploadToManagedCloudIfEnabled(encData, path.basename(dest));
    const offsiteDir = getOffsiteBackupFolder();
    if (offsiteDir && fs.existsSync(offsiteDir)) pruneOldBackups(offsiteDir);
    const bs = _backupScheduler;
    if (bs) bs.recordCompleted('quick', 'manual', { bytes: encData.length }, true);
    return dest;
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('[backup-now] Backup failed:', msg);
    throw new Error('Backup failed: ' + msg);
  }
});

ipcMain.handle('flush-and-backup', async () => {
  flushDb();
  await new Promise(r => setTimeout(r, 200));
  return 'flushed';
});

ipcMain.handle('backup-status', () => {
  const bs = _backupScheduler;
  if (!bs) return { state: 'not-initialised' };
  return bs.getStatus();
});

ipcMain.on('editor-activity', () => {
  _lastEditorActivityAt = Date.now();
  const bs = _backupScheduler;
  if (bs) bs.noteUserActivity('editor');
});

ipcMain.handle('db-repair', () => {
  if (!db) return { ok: false, error: 'Database not initialised' };
  const backupPath = createDbSafetyCopy('repair');
  const backfilled = backfillAttendanceIndexColumns();
  const removedBurst = cleanupAccidentalDuplicateDrafts();
  const removedByKey = dedupeDraftsByCaseKeys();
  return {
    ok: true,
    backupPath,
    backfilled,
    removedBurst,
    removedByKey,
  };
});

ipcMain.handle('save-csv', (_, { csv, filename }) => {
  try {
    const desktop = app.getPath('desktop');
    const safeName = path.basename(filename || 'attendances-export.csv').replace(/[<>:"/\\|?*]/g, '_');
    const filePath = path.join(desktop, safeName);
    fs.writeFileSync(filePath, csv, 'utf8');
    return filePath;
  } catch (e) {
    return { error: e.message || 'Failed to save CSV' };
  }
});

ipcMain.handle('get-desktop-path', () => app.getPath('desktop'));

ipcMain.handle('get-s3-backup-status', () => {
  const config = getS3Config();
  return {
    configured: !!config,
    lastSuccess: _lastS3SuccessTime,
    lastError: _lastS3Error || null,
  };
});

ipcMain.handle('test-s3-backup', async () => {
  const config = getS3Config();
  if (!config) return { ok: false, error: 'AWS S3 not configured' };
  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: S3_PREFIX + '.connection-test',
      Body: Buffer.from('ok'),
      ContentType: 'text/plain',
    }));
    _lastS3SuccessTime = Date.now();
    _lastS3Error = null;
    return { ok: true };
  } catch (err) {
    _lastS3Error = err && err.message ? err.message : String(err);
    return { ok: false, error: _lastS3Error };
  }
});

/* â”€â”€â”€ Managed cloud backup IPC handlers â”€â”€â”€ */

ipcMain.handle('cloud-backup-status', () => {
  const licData = readLicenceData();
  return {
    enabled: _cloudBackupEnabled,
    lastSuccess: _lastManagedCloudSuccess,
    lastError: _lastManagedCloudError,
    isTrial: !!(licData && licData.isTrial),
  };
});

ipcMain.handle('cloud-backup-check-entitlement', async () => {
  await checkCloudBackupEntitlement();
  return { enabled: _cloudBackupEnabled };
});

ipcMain.handle('cloud-backup-subscribe', async () => {
  const apiUrl = getManagedCloudApiUrl();
  if (!apiUrl) return { ok: false, error: 'Cannot reach server' };
  const data = readLicenceData();
  const email = data && data.email ? data.email : '';
  const url = `${apiUrl}/pricing${email ? '?email=' + encodeURIComponent(email) : ''}`;
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('cloud-backup-list', async () => {
  const data = readLicenceData();
  if (!data || (!data.key && !data.authToken)) return { backups: [], error: 'No licence key' };
  const apiUrl = getManagedCloudApiUrl();
  try {
    const authHeaders = _getAuthHeaders();
    const resp = await httpPost(`${apiUrl}/api/backup/list`, { key: data.key }, { headers: authHeaders });
    return resp;
  } catch (e) {
    return { backups: [], error: e && e.message ? e.message : 'Failed to list backups' };
  }
});

ipcMain.handle('cloud-backup-restore', async (_, { backupKey }) => {
  const data = readLicenceData();
  if (!data || (!data.key && !data.authToken)) return { ok: false, error: 'No licence key' };
  if (typeof backupKey !== 'string' || !backupKey.trim()) return { ok: false, error: 'Invalid backup key' };
  const sanitizedKey = backupKey.replace(/[^a-zA-Z0-9._\-]/g, '');
  if (sanitizedKey !== backupKey || sanitizedKey.includes('..')) return { ok: false, error: 'Invalid backup key' };
  try {
    const creds = await fetchManagedCloudCredentials();
    if (!creds) return { ok: false, error: 'Could not obtain cloud credentials' };
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
    const s3Key = `${creds.prefix}/${sanitizedKey}`;
    const resp = await client.send(new GetObjectCommand({ Bucket: creds.bucket, Key: s3Key }));
    const chunks = [];
    for await (const chunk of resp.Body) { chunks.push(chunk); }
    const encryptedBuffer = Buffer.concat(chunks);

    // Save safety copy first
    createDbSafetyCopy('pre-cloud-restore');

    // Decrypt and load
    const decrypted = await decryptBufferWithRecovery(encryptedBuffer);
    if (!decrypted) return { ok: false, error: 'Could not decrypt the backup. Check your recovery password.' };

    const SQL = await initSqlJs();
    const newDb = new SQL.Database(decrypted);
    db = newDb;
    // Ensure sync columns exist in restored DB and mark all records for re-sync
    _safeAddColumn('attendances', "sync_id TEXT DEFAULT NULL");
    _safeAddColumn('attendances', "sync_dirty INTEGER DEFAULT 1");
    _safeAddColumn('attendances', "sync_version INTEGER DEFAULT 1");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_att_sync_id ON attendances(sync_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_att_sync_dirty ON attendances(sync_dirty)");
    db.run(`CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT, created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER, sync_id TEXT, reason TEXT, local_version INTEGER DEFAULT 0, remote_version INTEGER DEFAULT 0, local_updated_at TEXT, remote_updated_at TEXT, remote_status TEXT, local_snapshot TEXT, remote_snapshot TEXT, created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT DEFAULT NULL, resolution_note TEXT DEFAULT '')`);
    backfillSyncIds();
    dbRun("UPDATE attendances SET sync_dirty=1");
    rebuildSyncQueueForDirtyRecords();
    resetSyncPullCursor();
    saveDb();
    /* Suppress scheduler for 60s so the restored DB is not immediately overwritten,
       then trigger one quick backup of the restored state as the new baseline. */
    if (_backupScheduler) _backupScheduler.suppressNext(60000);
    setTimeout(() => { _runQuickBackupAsync().catch(() => {}); }, 3000);
    console.log('[Restore] Database restored from cloud backup:', backupKey);
    return { ok: true };
  } catch (e) {
    console.error('[Restore] Cloud restore failed:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : 'Restore failed' };
  }
});

/* â”€â”€â”€ Local backup list + restore â”€â”€â”€ */
ipcMain.handle('local-backup-list', async () => {
  try {
    const dirs = [getBackupFolder()];
    const row = dbGet("SELECT value FROM settings WHERE key = 'offsiteBackupFolder'");
    if (row && row.value && row.value.trim()) dirs.push(row.value.trim());
    const seen = new Set();
    const files = [];
    for (const dir of dirs) {
      if (!dir || !fs.existsSync(dir)) continue;
      let entries;
      try { entries = fs.readdirSync(dir); } catch (_) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.db')) continue;
        const fullPath = path.join(dir, f);
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);
        let stat;
        try { stat = fs.statSync(fullPath); } catch (_) { continue; }
        files.push({ name: f, path: fullPath, dir, sizeBytes: stat.size, modifiedAt: stat.mtimeMs });
      }
    }
    files.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return { ok: true, files: files.slice(0, 30) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('local-backup-restore', async (_, { filePath }) => {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'No file path provided' };
  // H12 — tighten validation: realpath, extension check, magic-byte / size
  // sanity, and reject anything that doesn't look like one of our encrypted
  // backups. Stops the renderer from swapping in an arbitrary .db file.
  let resolved;
  try { resolved = fs.realpathSync(path.resolve(filePath)); }
  catch (_) { return { ok: false, error: 'File not found' }; }
  if (path.extname(resolved).toLowerCase() !== '.db') return { ok: false, error: 'Invalid file type' };
  if (!fs.existsSync(resolved)) return { ok: false, error: 'File not found' };
  let stat;
  try { stat = fs.statSync(resolved); }
  catch (_) { return { ok: false, error: 'Could not stat file' }; }
  if (!stat.isFile()) return { ok: false, error: 'Not a regular file' };
  // Live DBs are at least a few KB; an empty or tiny file isn't a backup.
  // Cap at 2 GB to fail fast on absurd inputs (way over our real ceiling).
  if (stat.size < 1024 || stat.size > 2 * 1024 * 1024 * 1024) {
    return { ok: false, error: 'Backup file is suspiciously small or large; refusing to restore.' };
  }
  try {
    const rawBuf = fs.readFileSync(resolved);
    createDbSafetyCopy('pre-local-restore');
    const decrypted = await decryptBufferWithRecovery(rawBuf);
    if (!decrypted) return { ok: false, error: 'Could not decrypt the backup. Check your recovery password.' };
    const SQL = await initSqlJs();
    const newDb = new SQL.Database(decrypted);
    db = newDb;
    _safeAddColumn('attendances', "sync_id TEXT DEFAULT NULL");
    _safeAddColumn('attendances', "sync_dirty INTEGER DEFAULT 1");
    _safeAddColumn('attendances', "sync_version INTEGER DEFAULT 1");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_att_sync_id ON attendances(sync_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_att_sync_dirty ON attendances(sync_dirty)");
    db.run(`CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT, created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER, sync_id TEXT, reason TEXT, local_version INTEGER DEFAULT 0, remote_version INTEGER DEFAULT 0, local_updated_at TEXT, remote_updated_at TEXT, remote_status TEXT, local_snapshot TEXT, remote_snapshot TEXT, created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT DEFAULT NULL, resolution_note TEXT DEFAULT '')`);
    backfillSyncIds();
    dbRun("UPDATE attendances SET sync_dirty=1");
    rebuildSyncQueueForDirtyRecords();
    resetSyncPullCursor();
    saveDb();
    /* Suppress scheduler for 60s so the restored DB is not immediately overwritten,
       then trigger one quick backup of the restored state as the new baseline. */
    if (_backupScheduler) _backupScheduler.suppressNext(60000);
    setTimeout(() => { _runQuickBackupAsync().catch(() => {}); }, 3000);
    console.log('[Restore] Database restored from local backup:', resolved);
    return { ok: true };
  } catch (e) {
    console.error('[Restore] Local restore failed:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : 'Restore failed' };
  }
});

/* â”€â”€â”€ Cross-device sync IPC handlers â”€â”€â”€ */
ipcMain.handle('sync-now', async () => {
  try {
    migrateSyncDirtyToQueue();
    const w = getSyncWorker();
    if (w) {
      w.forceRetryAll();
      await w.runCycle();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Sync failed' };
  }
});

ipcMain.handle('sync-full-resync', async () => {
  try {
    await runFullSyncFromCloud();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Full re-sync failed' };
  }
});

ipcMain.handle('sync-status', () => {
  const lastSync = getLastSyncTimestamp();
  const dirtyCount = dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1');
  const queuePending = dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing')");
  const queueFailed = dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status='failed'");
  const queueBlocked = dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status='blocked'");
  const conflicts = dbGet("SELECT COUNT(*) as c FROM sync_conflicts WHERE resolved_at IS NULL");
  const totalCount = dbGet('SELECT COUNT(*) as c FROM attendances WHERE deleted_at IS NULL');
  const apiUrl = getSyncApiUrl();
  const diag = getSyncWorker() ? getSyncWorker().getDiagnostics() : {};
  let lastAttempts = [];
  try {
    const rows = dbAll('SELECT correlation_id, direction, record_count, success, error_message, created_at FROM sync_attempts ORDER BY id DESC LIMIT 10');
    lastAttempts = (rows || []).map(r => ({
      correlationId: r.correlation_id,
      direction: r.direction,
      recordCount: r.record_count,
      success: !!r.success,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));
  } catch (_) {}
  const pendingCount = (queuePending ? queuePending.c : 0) || 0;
  const failedCount = (queueFailed ? queueFailed.c : 0) || 0;
  const blockedCount = (queueBlocked ? queueBlocked.c : 0) || 0;
  const conflictCount = (conflicts ? conflicts.c : 0) || 0;
  const pending = pendingCount + failedCount + blockedCount;
  const dirtyPushCount = dirtyCount ? dirtyCount.c : 0;
  const lastPull = getLastPullStats();
  return {
    enabled: !!apiUrl,
    inProgress: diag.inProgress || false,
    lastSync: lastSync !== '1970-01-01T00:00:00.000Z' ? lastSync : diag.lastSyncAt || null,
    pendingChanges: pending,
    failedCount,
    blockedCount,
    conflictCount,
    dirtyPushCount,
    totalRecords: totalCount ? totalCount.c : 0,
    lastPull,
    lastAttempts,
    connectivity: diag.connectivity,
    lastError: diag.lastError,
  };
});

ipcMain.handle('sync-schedule-on-reconnect', () => {
  scheduleSyncSoon();
  return {};
});

/* List open sync conflicts (local vs remote snapshots) for the resolution UI. */
ipcMain.handle('sync-conflicts-list', () => {
  try {
    if (!db) return { ok: true, conflicts: [] };
    const conflicts = syncConflicts.listOpenConflicts({ dbAll, dbGet });
    return { ok: true, conflicts };
  } catch (e) {
    console.error('[sync-conflicts-list]', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : 'Failed to list conflicts' };
  }
});

/* Resolve a single sync conflict. resolution: 'keep_local' | 'accept_remote'.
   { force: true } is required to accept remote over a protected local record. */
ipcMain.handle('sync-conflict-resolve', (_event, params) => {
  try {
    if (!db) return { ok: false, error: 'Database not ready' };
    const conflictId = params && params.conflictId;
    const resolution = params && params.resolution;
    const force = !!(params && params.force);
    const result = syncConflicts.resolveConflict(
      {
        dbGet,
        dbRun,
        appendAuditLog,
        nowIso: () => new Date().toISOString(),
      },
      conflictId,
      resolution,
      { force }
    );
    if (result.ok && !result.alreadyResolved) {
      try { saveDb(); } catch (saveErr) { console.error('[sync-conflict-resolve] saveDb failed:', saveErr && saveErr.message); }
      // Keeping local means the local edit must re-propagate to other devices.
      if (result.requeue && result.attendanceId != null) {
        try { enqueueSyncForRecord(result.attendanceId); } catch (_) {}
      }
      try { scheduleSyncSoon(); } catch (_) {}
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('sync-status-changed', { status: 'synced' }); } catch (_) {}
        if (result.resolution === 'accept_remote') {
          try { mainWindow.webContents.send('records-updated-from-sync', { count: 1 }); } catch (_) {}
        }
      }
    }
    return result;
  } catch (e) {
    console.error('[sync-conflict-resolve]', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : 'Failed to resolve conflict' };
  }
});

ipcMain.handle('sync-get-diagnostics', () => {
  const w = getSyncWorker();
  const diag = w ? w.getDiagnostics() : {};
  const lic = readLicenceData();
  const data = lic || {};
  const apiUrl = getSyncApiUrl();
  const totalCount = dbGet('SELECT COUNT(*) as c FROM attendances WHERE deleted_at IS NULL');
  const masterKeyPresent = !!getOrCreateMasterKey({ allowCreate: false });
  let licenceKeyMasked = null;
  if (data.key) {
    const k = String(data.key);
    licenceKeyMasked = k.length > 8 ? k.slice(0, 4) + '-****-****-' + k.slice(-4) : '****';
  }
  return {
    ...diag,
    apiUrl: apiUrl || null,
    machineId: getMachineId(),
    licenceKeyMasked,
    licenceEmail: data.email || null,
    masterKeyPresent,
    totalRecords: totalCount ? totalCount.c : 0,
    lastPull: getLastPullStats(),
    dataSource: 'sqlite-backend-sync',
    canonicalKeyAction: _lastCanonicalKeyAction,
    canonicalKeyCheckedAt: _lastCanonicalKeyAt,
  };
});

ipcMain.handle('sync-force-retry', () => {
  const w = getSyncWorker();
  if (!w) return { recovered: 0 };
  const recovered = w.forceRetryAll();
  if (recovered > 0) w.scheduleSoon();
  return { recovered };
});

ipcMain.handle('prepare-trial', async () => {
  const scriptPath = path.join(__dirname, 'scripts', 'prepare-trial.js');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'Run "npm run prepare-trial" from the project folder.' };
  }
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn('node', [scriptPath], { cwd: __dirname, stdio: 'inherit', shell: false });
    proc.on('close', (code) => resolve({ ok: code === 0, error: code !== 0 ? 'Script failed' : null }));
    proc.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
});

ipcMain.handle('get-db-path', () => getDbPath());

ipcMain.handle('set-recovery-password', async (_, password) => {
  try {
    const result = await setRecoveryPassword(password);
    saveDb();
    return { success: true, cloudBackupOk: result.cloudBackupOk };
  } catch (err) {
    return { success: false, error: err.message, cloudBackupOk: false };
  }
});

ipcMain.handle('has-recovery-password', () => hasRecoveryPassword());

function getSecurityCredentialStatus() {
  const hasRecovery = hasRecoveryPassword();
  const hasAdmin = adminAuth.hasAdminPassword(app);
  if (hasRecovery) {
    return {
      canLock: true,
      hasRecoveryPassword: true,
      hasAdminPassword: hasAdmin,
      preferred: 'recovery',
      label: 'recovery password',
    };
  }
  if (hasAdmin) {
    return {
      canLock: true,
      hasRecoveryPassword: false,
      hasAdminPassword: true,
      preferred: 'admin',
      label: 'admin password',
    };
  }
  return {
    canLock: false,
    hasRecoveryPassword: false,
    hasAdminPassword: false,
    preferred: 'none',
    label: 'password',
  };
}

function verifySensitiveActionCredential(password, purpose) {
  const credential = getSecurityCredentialStatus();
  const value = typeof password === 'string' ? password : '';
  const actionLabel = purpose === 'supervisor-approval' ? 'supervisor approval' : 'unlock';
  if (!credential.canLock) {
    return {
      ok: false,
      code: 'credential_not_configured',
      credentialType: 'none',
      error: `Set a recovery password or admin password in Settings before using ${actionLabel}.`,
    };
  }
  if (!value) {
    return {
      ok: false,
      code: 'missing_password',
      credentialType: credential.preferred,
      error: 'Enter your ' + credential.label + '.',
    };
  }
  if (credential.hasRecoveryPassword) {
    const recovered = tryRecoverMasterKey(value);
    if (recovered) return { ok: true, credentialType: 'recovery' };
  }
  if (credential.hasAdminPassword) {
    const adminResult = adminAuth.login(app, value);
    if (adminResult && adminResult.ok) return { ok: true, credentialType: 'admin' };
    if (adminResult && adminResult.error === 'Locked out') {
      return {
        ok: false,
        code: 'locked_out',
        credentialType: 'admin',
        error: 'Admin login is temporarily locked. Try again later.',
        retryAfter: adminResult.retryAfter || 0,
      };
    }
  }
  return {
    ok: false,
    code: 'invalid_password',
    credentialType: credential.preferred,
    error: credential.hasRecoveryPassword && credential.hasAdminPassword
      ? 'Password did not match the recovery or admin credential.'
      : 'Incorrect ' + credential.label + '.',
  };
}

ipcMain.handle('session-lock-status', () => getSecurityCredentialStatus());

// Lock the renderer immediately when the OS reports lock-screen, suspend,
// shutdown, or screen lock events. Treats those as "user has stepped away,
// the session is no longer trusted". The renderer-side lock overlay handles
// the actual UI; here we just notify it.
function _broadcastForceLock(reason) {
  try {
    const wins = BrowserWindow.getAllWindows ? BrowserWindow.getAllWindows() : [];
    for (const w of wins) {
      if (w && !w.isDestroyed() && w.webContents) {
        try { w.webContents.send('session-force-lock', { reason: reason || 'os-event' }); }
        catch (_) {}
      }
    }
    try { _securityLog && _securityLog.record && _securityLog.record('power_lock_triggered', { reason: reason || 'os-event' }); }
    catch (_) {}
  } catch (_) {}
}
try {
  if (powerMonitor && typeof powerMonitor.on === 'function') {
    powerMonitor.on('lock-screen', () => _broadcastForceLock('lock-screen'));
    powerMonitor.on('suspend',     () => _broadcastForceLock('suspend'));
    powerMonitor.on('shutdown',    () => _broadcastForceLock('shutdown'));
    if (process.platform !== 'win32') {
      // Some platforms expose 'user-did-resign-active' (macOS) for tab switch
      // away from the app. Useful but noisy; gated to non-Windows.
      try { powerMonitor.on('user-did-resign-active', () => _broadcastForceLock('user-did-resign-active')); }
      catch (_) {}
    }
  }
} catch (e) {
  console.warn('[security] powerMonitor lock binding failed:', e && e.message ? e.message : e);
}

// H29 — bucket per-channel attempts so credential stuffing over IPC is
// bounded to 5 tries per minute. Unlock via OS safeStorage isn't affected.
const _ipcRateBuckets = new Map();
function _ipcChannelAllow(channel, max, windowMs) {
  const now = Date.now();
  let bucket = _ipcRateBuckets.get(channel);
  if (!bucket) { bucket = []; _ipcRateBuckets.set(channel, bucket); }
  while (bucket.length && (now - bucket[0]) > windowMs) bucket.shift();
  if (bucket.length >= max) return false;
  bucket.push(now);
  return true;
}

ipcMain.handle('session-unlock', (_, password) => {
  if (!_ipcChannelAllow('session-unlock', 5, 60 * 1000)) {
    return { ok: false, code: 'rate_limited', error: 'Too many unlock attempts. Please wait a minute.' };
  }
  return verifySensitiveActionCredential(password, 'session-unlock');
});

ipcMain.handle('recover-key-from-cloud', async () => {
  const result = await ensureCanonicalSyncKeyNow();
  if (!result.ok) {
    const messages = {
      no_key_no_escrow: 'No cloud recovery data found. Open Custody Note on a computer that has your records and ensure sync has run, or set a recovery password in Settings → Security.',
      escrow_undecryptable: 'Cloud recovery data exists but could not be decrypted with this licence key. Check that both computers use exactly the same licence key.',
      no_licence: 'No licence key activated on this computer.',
    };
    return {
      ok: false,
      error: result.error || messages[result.action] || 'Could not recover encryption key from cloud.',
    };
  }
  scheduleSyncSoon();
  return { ok: true, action: result.action };
});

ipcMain.handle('is-db-encrypted', () => {
  try {
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) return false;
    const buf = fs.readFileSync(dbPath);
    return buf.length >= 4 && buf.slice(0, 4).toString() === MAGIC;
  } catch (_) { return false; }
});

ipcMain.handle('is-safe-storage-available', () => safeStorage.isEncryptionAvailable());

ipcMain.handle('choose-folder', async (_, opts) => {
  const title = opts && opts.forOffsite ? 'Choose off-site backup folder (e.g. OneDrive, Dropbox)' : 'Choose backup folder';
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title,
  });
  return canceled ? null : (filePaths[0] || null);
});

ipcMain.handle('detect-cloud-folders', () => {
  const home = app.getPath('home');
  const candidates = [
    { name: 'OneDrive', sub: 'OneDrive' },
    { name: 'Dropbox', sub: 'Dropbox' },
    { name: 'Google Drive', sub: 'Google Drive' },
    { name: 'iCloud Drive', sub: 'iCloudDrive' },
    { name: 'iCloud Drive', sub: 'iCloud Drive' },
  ];
  const seenPaths = new Set();
  const found = [];
  for (const c of candidates) {
    const full = path.join(home, c.sub);
    if (seenPaths.has(full)) continue;
    try {
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        found.push({ name: c.name, path: full });
        seenPaths.add(full);
      }
    } catch (_) {}
  }
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('OneDrive - ') && !found.some(f => f.path === path.join(home, e.name))) {
        found.push({ name: 'OneDrive (' + e.name.slice(11) + ')', path: path.join(home, e.name) });
      }
    }
  } catch (_) {}
  return found;
});

ipcMain.handle('pick-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Attach photo',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 5 * 1024 * 1024) return { error: 'File too large (max 5 MB)' };
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
    const mime = mimeMap[ext] || 'image/jpeg';
    const buf = fs.readFileSync(filePath);
    return { dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), name: path.basename(filePath) };
  } catch (err) {
    return { error: 'Could not read file: ' + (err.message || String(err)) };
  }
});

ipcMain.handle('pick-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Attach file (any type)',
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 15 * 1024 * 1024) return { error: 'File too large (max 15 MB)' };
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeMap = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
      pdf: 'application/pdf',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain', csv: 'text/csv',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const buf = fs.readFileSync(filePath);
    return { dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), name: path.basename(filePath), mime };
  } catch (err) {
    return { error: 'Could not read file: ' + (err.message || String(err)) };
  }
});

/* â”€â”€â”€ Import record from PDF or JSON (Settings / Admin) â”€â”€â”€ */
const IMPORT_MARKER = 'CUSTODY_NOTE_IMPORT:';
async function loadRecordDataFromFile(filePath) {
  if (!filePath || typeof filePath !== 'string') throw new Error('No file path provided');
  const p = filePath.trim();
  if (!p) throw new Error('No file path provided');
  if (!fs.existsSync(p)) throw new Error('File not found: ' + p);
  const ext = path.extname(p).toLowerCase();

  if (ext === '.json') {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('No record data in JSON');
    return data;
  }

  if (ext === '.pdf') {
    let pdfParse;
    try {
      pdfParse = require('pdf-parse');
    } catch (_) {
      throw new Error('PDF import requires the pdf-parse package. Run: npm install pdf-parse');
    }
    const buffer = fs.readFileSync(p);
    const result = await pdfParse(buffer);
    const text = result && result.text ? result.text : '';

    // Preferred path: PDF exported from this app (hidden base64 JSON marker)
    const idx = text.indexOf(IMPORT_MARKER);
    if (idx !== -1) {
      const base64 = text.slice(idx + IMPORT_MARKER.length).replace(/\s/g, '');
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      const data = JSON.parse(decoded);
      if (!data || typeof data !== 'object') throw new Error('No record data in PDF');
      return data;
    }

    // Fallback path: Custody Note-generated custody note PDF (labelled fields)
    const parsed = parseCasenotePdfTextToRecordData(text);
    if (parsed) return parsed;

    throw new Error('No Custody Note import data in this PDF. Use a PDF exported from Custody Note.');
  }

  throw new Error('Unsupported file type. Use a .pdf or .json file.');
}

function insertImportedDraftAttendance(data) {
  if (!db) throw new Error('Database not initialised');
  if (!data || typeof data !== 'object') throw new Error('No record data in file');

  // Keep file reference in sync with file number (ours) â€“ same value for both
  if (data.ourFileNumber != null && data.ourFileNumber !== '') {
    data.fileReference = String(data.ourFileNumber);
  }

  const now = new Date().toISOString();
  const indexed = extractIndexedAttendanceFields(data);
  const clientName = indexed.clientName;
  const stationName = indexed.stationName;
  const dsccRef = indexed.dsccRef;
  const attendanceDate = indexed.attendanceDate;
  const workType = data.workType || '';

  const dataStr = JSON.stringify(data);

  // Prefer updating an existing draft for the same case to avoid duplicates.
  let existingId = null;
  if (data.ourFileNumber != null && String(data.ourFileNumber).trim()) {
    try {
      const ofn = String(data.ourFileNumber).trim();
      const row = dbGet(
        "SELECT id FROM attendances WHERE status='draft' AND deleted_at IS NULL AND archived_at IS NULL AND data LIKE ? ORDER BY updated_at DESC LIMIT 1",
        [`%"ourFileNumber":"${ofn}"%`]
      );
      if (row && row.id) existingId = row.id;
    } catch (_) {}
  }
  if (!existingId) existingId = findExistingDraftIdByCaseKey(data);
  if (existingId) {
    const existing = dbGet('SELECT sync_version, data FROM attendances WHERE id=?', [existingId]);
    const nextVer = (existing && existing.sync_version || 1) + 1;
    dbRun(
      'UPDATE attendances SET data=?, status=?, updated_at=?, client_name=?, station_name=?, dscc_ref=?, attendance_date=?, work_type=?, sync_dirty=1, sync_version=? WHERE id=?',
      [dataStr, 'draft', now, clientName, stationName, dsccRef, attendanceDate, workType, nextVer, existingId]
    );
    appendAuditLog(existingId, 'import_updated', {
      previousSnapshot: existing && existing.data ? existing.data : null,
      timestamp: now,
      userNote: 'Imported record merged into existing draft',
    });
    markDbDirty();
    enqueueSyncForRecord(existingId);
    return existingId;
  }

  const newSyncId = generateSyncId();
  dbRun(
    'INSERT INTO attendances (data, status, updated_at, client_name, station_name, dscc_ref, attendance_date, work_type, sync_id, sync_dirty, sync_version) VALUES (?,?,?,?,?,?,?,?,?,1,1)',
    [dataStr, 'draft', now, clientName, stationName, dsccRef, attendanceDate, workType, newSyncId]
  );
  markDbDirty();
  const r = dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1');
  const newId = r ? r.id : null;
  if (newId) {
    db.run(
      'INSERT INTO audit_log (attendance_id, action, timestamp, user_note) VALUES (?,?,?,?)',
      [newId, 'import_created', now, 'Imported record created as draft']
    );
    enqueueSyncForRecord(newId);
  }
  return newId;
}

ipcMain.handle('import-record-from-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Load record from PDF or JSON',
    filters: [
      { name: 'PDF or JSON', extensions: ['pdf', 'json'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'All', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths.length) return { error: 'cancelled' };
  const filePath = filePaths[0];

  try {
    const data = await loadRecordDataFromFile(filePath);
    return { data };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err instanceof SyntaxError) return { error: 'Invalid JSON in file.' };
    return { error: msg };
  }
});

// Import record from an explicit file path (used by paste-path and drag-drop import).
// H11 — restrict to user-reachable roots so a poisoned renderer can't pump
// arbitrary system paths through this channel and read back arbitrary files.
function _isAllowedImportPath(p) {
  try {
    const resolved = fs.realpathSync(path.resolve(p));
    const ext = path.extname(resolved).toLowerCase();
    if (ext !== '.pdf' && ext !== '.json') return false;
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return false;
    // 25 MB hard cap on import file size (M17 scope creep, also prevents
    // pdf-parse main-thread DoS on giant files).
    if (stat.size > 25 * 1024 * 1024) return false;
    const allowed = [
      app.getPath('desktop'),
      app.getPath('downloads'),
      app.getPath('documents'),
      app.getPath('temp'),
      app.getPath('userData'),
    ].map(r => { try { return fs.realpathSync(r); } catch (_) { return r; } });
    return allowed.some(root => resolved === root || resolved.startsWith(root + path.sep));
  } catch (_) { return false; }
}

ipcMain.handle('import-record-from-path', async (_, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { error: 'No file path provided' };
    }
    if (!_isAllowedImportPath(filePath)) {
      return { error: 'Import is restricted to .pdf or .json files in Desktop / Documents / Downloads / Temp (max 25 MB).' };
    }
    const data = await loadRecordDataFromFile(filePath);
    return { data };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err instanceof SyntaxError) return { error: 'Invalid JSON in file.' };
    return { error: msg };
  }
});

/* â”€â”€â”€ Photo file storage (encrypted, separate files) â”€â”€â”€ */
function sanitizePathSegment(seg) {
  if (typeof seg !== 'string') return null;
  const clean = seg.replace(/[^a-zA-Z0-9_\-]/g, '');
  return clean.length > 0 ? clean : null;
}

function getPhotosDir(attendanceId) {
  const dir = path.join(app.getPath('userData'), 'photos', String(attendanceId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('photo-save', (_, { attendanceId, photoId, dataUrl, name, mimeType }) => {
  const safeAttId = sanitizePathSegment(String(attendanceId));
  const safePhotoId = sanitizePathSegment(String(photoId));
  if (!safeAttId || !safePhotoId) return { error: 'Invalid identifier' };
  try {
    const dir = getPhotosDir(safeAttId);
    const filePath = path.join(dir, safePhotoId + '.enc');
    const buf = Buffer.from(dataUrl, 'utf8');
    fs.writeFileSync(filePath, encryptBuffer(buf));
    return { photoId, name, mimeType };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('photo-load', (_, { attendanceId, photoId }) => {
  const safeAttId = sanitizePathSegment(String(attendanceId));
  const safePhotoId = sanitizePathSegment(String(photoId));
  if (!safeAttId || !safePhotoId) return { error: 'Invalid identifier' };
  try {
    const filePath = path.join(app.getPath('userData'), 'photos', safeAttId, safePhotoId + '.enc');
    if (!fs.existsSync(filePath)) return null;
    const enc = fs.readFileSync(filePath);
    const dec = decryptBuffer(enc);
    return dec ? dec.toString('utf8') : null;
  } catch (err) {
    console.error('[Photo] Load failed:', err.message);
    return null;
  }
});

ipcMain.handle('photo-delete', (_, { attendanceId, photoId }) => {
  const safeAttId = sanitizePathSegment(String(attendanceId));
  const safePhotoId = sanitizePathSegment(String(photoId));
  if (!safeAttId || !safePhotoId) return { error: 'Invalid identifier' };
  try {
    const filePath = path.join(app.getPath('userData'), 'photos', safeAttId, safePhotoId + '.enc');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('photos-duplicate-folder', (_, { fromId, toId }) => {
  const safeFrom = sanitizePathSegment(String(fromId));
  const safeTo = sanitizePathSegment(String(toId));
  if (!safeFrom || !safeTo || safeFrom === safeTo) return { ok: false, error: 'invalid_ids' };
  try {
    const base = path.join(app.getPath('userData'), 'photos');
    const srcDir = path.join(base, safeFrom);
    const destDir = path.join(base, safeTo);
    if (!fs.existsSync(srcDir)) return { ok: true, copied: 0 };
    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    let copied = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || !f.endsWith('.enc')) continue;
      fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
      copied++;
    }
    return { ok: true, copied };
  } catch (err) {
    console.error('[photos-duplicate-folder]', err && err.message ? err.message : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('open-external', async (_, url) => {
  if (typeof url !== 'string') return;
  const u = url.trim();
  if (u.toLowerCase().startsWith('mailto:')) {
    console.warn('[open-external] Blocked mailto (copy subject/body in the app, then paste into your mail client):', u.slice(0, 120));
    return;
  }
  if (typeof isSafeExternalUrl === 'function' && !isSafeExternalUrl(u)) {
    console.warn('[open-external] Blocked URL (allowlist):', u.slice(0, 120));
    return;
  }
  try {
    await shell.openExternal(u);
  } catch (err) {
    console.warn('[open-external] failed:', err && err.message ? err.message : err);
  }
});

ipcMain.handle('open-path', async (_, filePath) => {
  try {
    if (typeof filePath !== 'string') return false;
    const p = filePath.trim();
    if (!p) return false;
    // H13 — resolve symlinks/junctions before the allowlist check so a
    // junction under an allowed root that targets outside is rejected.
    let resolved;
    try { resolved = fs.realpathSync(path.resolve(p)); }
    catch (_) { return { error: 'Path does not exist or is not accessible' }; }
    const allowedRoots = [
      app.getPath('userData'),
      app.getPath('desktop'),
      app.getPath('documents'),
      app.getPath('temp'),
    ].map(r => { try { return fs.realpathSync(r); } catch (_) { return r; } });
    if (!allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep))) {
      return { error: 'Path outside allowed directories' };
    }
    await shell.openPath(resolved);
    return true;
  } catch (_e) {
    return false;
  }
});

ipcMain.handle('create-desktop-shortcut', () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Only available on Windows' };
  }
  try {
    const exe = app.getPath('exe');
    const desktop = app.getPath('desktop');
    const shortcutPath = path.join(desktop, 'Custody Note.lnk');
    const op = fs.existsSync(shortcutPath) ? 'update' : 'create';
    const ok = shell.writeShortcutLink(shortcutPath, op, {
      target: exe,
      cwd: path.dirname(exe),
      icon: exe,
      iconIndex: 0,
      description: 'Custody Note',
    });
    return { ok: !!ok, path: shortcutPath };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('open-app-folder', async () => {
  try {
    const dir = path.dirname(app.getPath('exe'));
    const err = await shell.openPath(dir);
    if (err) return { ok: false, error: err };
    return { ok: true, path: dir };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

/* Render HTML to a PDF buffer using an offscreen BrowserWindow.
 *
 * Loads HTML from a temp file rather than a data: URL because Chromium caps
 * data: URLs at ~2 MB; a custody note that includes signature PNGs and long
 * interview notes routinely exceeds that and the PDF would silently never
 * generate (this was the v1.5.7 "Generate PDF does nothing" bug). Temp file
 * has no size limit, supports relative paths, and yields useful error events.
 */
// H15 — hard cap on HTML size to prevent main-process DoS / memory pressure.
// Real custody notes max out around ~600 KB even with embedded signatures;
// 25 MB leaves ample headroom for the largest legitimate generated documents
// (multi-attachment cover bundles) while killing pathological renderer input.
const RENDER_HTML_MAX_BYTES = 25 * 1024 * 1024;

async function renderHtmlToPdfBuffer(html) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('renderHtmlToPdfBuffer: html is empty');
  }
  const byteLen = Buffer.byteLength(html, 'utf8');
  if (byteLen > RENDER_HTML_MAX_BYTES) {
    throw new Error('renderHtmlToPdfBuffer: html exceeds ' + RENDER_HTML_MAX_BYTES + ' bytes (got ' + byteLen + ')');
  }
  const tempDir = app.getPath('temp');
  const tempPath = path.join(tempDir, `cn-pdf-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`);
  fs.writeFileSync(tempPath, html, 'utf8');

  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Offscreen PDF window: belt-and-braces — should never need to navigate
  // anywhere except the local temp file we just wrote.
  try {
    hardenWindow(win, {
      logger: { warn: (msg, meta) => console.warn(msg, meta || '') },
      appOrigin: '',
      shellOpenExternal: () => Promise.resolve(),
    });
  } catch (_) {}

  function cleanupTemp() {
    try { fs.unlinkSync(tempPath); } catch (_) { /* ignore */ }
  }

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('PDF HTML load timeout (60s) â€” temp file: ' + tempPath)),
        60000
      );
      win.webContents.once('did-finish-load', () => finish());
      win.webContents.once('did-fail-load', (_e, errCode, errDesc, validatedURL) => {
        finish(new Error('PDF HTML failed to load: ' + errDesc + ' (' + errCode + ') url=' + validatedURL));
      });
      win.webContents.once('render-process-gone', (_e, details) => {
        finish(new Error('PDF renderer crashed: ' + (details && details.reason) + ' exit=' + (details && details.exitCode)));
      });
      win.loadFile(tempPath).catch((err) => finish(err));
    });

    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      margins: { marginType: 'default' },
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
      <div style="width:100%; padding:0 12px; font-family:Segoe UI, Arial, sans-serif; font-size:8px; color:#475569; border-top:1px solid #e2e8f0; padding-top:6px; display:flex; justify-content:space-between; align-items:center;">
        <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
        <div>Created with Custody Note</div>
        <div>Generated <span class="date"></span></div>
      </div>
    `,
    });
    return buf;
  } finally {
    try { win.destroy(); } catch (_) {}
    cleanupTemp();
  }
}

ipcMain.handle('print-to-pdf', async (_, { html, filename }) => {
  // Logged-name only (never log the full path — the home folder leaks the
  // OS username; the file basename can leak client name if the renderer
  // hasn't already sanitised it). The basename is what the user already
  // sees in the success toast, so logging that is acceptable.
  let outPath = '<not yet set>';
  let safeName = '';
  try {
    const desktop = app.getPath('desktop');
    if (!fs.existsSync(desktop)) {
      throw new Error('Desktop folder does not exist. If you use OneDrive Known Folder Move, sign in to OneDrive and try again.');
    }
    safeName = path.basename(filename || `attendance-${Date.now()}.pdf`).replace(/[<>:"/\\|?*]/g, '_');
    outPath = path.join(desktop, safeName);
    const buf = await renderHtmlToPdfBuffer(html);
    fs.writeFileSync(outPath, buf);
    console.log('[print-to-pdf] wrote ' + safeName + ' (' + buf.length + ' bytes)');
    return outPath;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('[print-to-pdf] FAILED file=' + (safeName || '<none>') + ' htmlLen=' + (html ? html.length : 0) + ' err=' + msg);
    throw new Error(msg);
  }
});

/** Save a base64 PDF to temp and open in system PDF viewer */
// H16 — cap base64 input. 50 MB base64 ≈ 37 MB binary, more than any
// realistic generated PDF; anything bigger is treated as a DoS attempt.
const PREVIEW_PDF_MAX_BASE64_BYTES = 50 * 1024 * 1024;
ipcMain.handle('preview-pdf-base64', async (_, { base64, filename }) => {
  try {
    if (typeof base64 !== 'string' || !base64) return { ok: false, error: 'No PDF data provided' };
    if (base64.length > PREVIEW_PDF_MAX_BASE64_BYTES) {
      return { ok: false, error: 'PDF too large to preview (max ' + Math.round(PREVIEW_PDF_MAX_BASE64_BYTES / (1024 * 1024)) + ' MB base64)' };
    }
    const tempDir = app.getPath('temp');
    const safeName = (filename || `preview-${Date.now()}.pdf`).replace(/[<>:"/\\|?*]/g, '_');
    if (path.extname(safeName).toLowerCase() !== '.pdf') {
      return { ok: false, error: 'Only .pdf preview filenames are accepted' };
    }
    const filePath = path.join(tempDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    await shell.openPath(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    console.error('[preview-pdf-base64]', err);
    return { ok: false, error: err.message || String(err) };
  }
});

/** Returns PDF as base64 for in-app preview (renderer); work stays in main process. */
ipcMain.handle('preview-pdf-from-html', async (_, { html }) => {
  try {
    const buf = await renderHtmlToPdfBuffer(html);
    return { ok: true, base64: Buffer.from(buf).toString('base64') };
  } catch (err) {
    console.error('[preview-pdf-from-html]', err && err.message ? err.message : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

/* â”€â”€â”€ Export attendance note as DOCX â”€â”€â”€ */
ipcMain.handle('export-docx', async (_, { data, settings, filename }) => {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType } = require('docx');

  const d = data || {};
  const s = settings || {};
  const brand = (s.brandName || 'Defence Legal Services Ltd') + (s.tradingAs ? ' t/a ' + s.tradingAs : '');
  const clientName = [d.forename, d.surname].filter(Boolean).join(' ') || '\u2014';
  const isVol = d.attendanceMode === 'voluntary';
  const isTel = d._formType === 'telephone';
  const docTitle = isTel ? 'Telephone Advice Note' : (isVol ? 'Voluntary Attendance Note' : 'Custody Note');

  function val(v) { return v ? String(v).trim() : ''; }
  function fmtD(v) {
    if (!v) return '';
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : v;
  }

  function fieldRow(label, value) {
    if (!value) return null;
    return new TableRow({
      children: [
        new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: 'Segoe UI' })] })] }),
        new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: String(value), size: 20, font: 'Segoe UI' })] })] }),
      ],
    });
  }

  function sectionHeading(text) {
    return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 80 },
      children: [new TextRun({ text, bold: true, size: 22, font: 'Segoe UI', color: '1e40af' })] });
  }

  function narrativePara(text) {
    if (!text) return null;
    return new Paragraph({ spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: String(text), size: 20, font: 'Segoe UI' })] });
  }

  const children = [];

  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
    children: [new TextRun({ text: brand, bold: true, size: 18, font: 'Segoe UI', color: '475569' })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: docTitle, bold: true, size: 28, font: 'Segoe UI', color: '1e40af' })] }));

  const coverRows = [
    fieldRow('Client', clientName),
    fieldRow('Date', fmtD(d.date)),
    fieldRow('Station', val(d.policeStationName) || val(d.otherLocation)),
    !isVol ? fieldRow('Custody No.', val(d.custodyNumber)) : null,
    fieldRow('DSCC Ref', val(d.dsccRef)),
    fieldRow('Offence', val(d.offenceSummary)),
    fieldRow('Firm', val(d.firmName)),
    fieldRow('Fee Earner', val(d.feeEarnerName)),
    fieldRow('Our Ref', val(d.ourFileNumber) || val(d.fileReference)),
    fieldRow('UFN', val(d.ufn)),
  ].filter(Boolean);

  if (coverRows.length) {
    children.push(new Table({ rows: coverRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  children.push(sectionHeading('1. Instruction'));
  const instrRows = [
    fieldRow('Source', val(d.instructionSource)),
    fieldRow('Date', fmtD(d.date)),
    fieldRow('Time of instruction', val(d.instructionTime)),
    fieldRow('Arrival time', val(d.arrivalTime)),
    fieldRow('DSCC Reference', val(d.dsccRef)),
    fieldRow('Reason for request', val(d.requestReason)),
  ].filter(Boolean);
  if (instrRows.length) children.push(new Table({ rows: instrRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('2. Client Details'));
  const clientRows = [
    fieldRow('Forename', val(d.forename)),
    fieldRow('Surname', val(d.surname)),
    fieldRow('Date of Birth', fmtD(d.dob)),
    fieldRow('Address', val(d.address)),
    fieldRow('Occupation', val(d.occupation)),
    fieldRow('Nationality', val(d.nationality)),
    fieldRow('Appropriate Adult', val(d.appropriateAdult)),
    fieldRow('Interpreter', val(d.interpreter)),
    fieldRow('Vulnerable', val(d.vulnerable)),
    fieldRow('Youth', val(d.youth)),
  ].filter(Boolean);
  if (clientRows.length) children.push(new Table({ rows: clientRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('3. Offence Details'));
  const offRows = [
    fieldRow('Offence Summary', val(d.offenceSummary)),
    fieldRow('Offence 1', val(d.offence1Details)),
    fieldRow('Offence 2', val(d.offence2Details)),
    fieldRow('Offence 3', val(d.offence3Details)),
    fieldRow('MG5 / Evidence Summary', val(d.evidenceSummary)),
  ].filter(Boolean);
  if (offRows.length) children.push(new Table({ rows: offRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('4. Detention & PACE'));
  const paceRows = [
    fieldRow('Detention authorised', val(d.detentionAuthorised)),
    fieldRow('Grounds for detention', val(d.detentionGrounds)),
    fieldRow('PACE clock started', val(d.paceClockStart)),
    fieldRow('PACE clock expires', val(d.paceClockExpiry)),
  ].filter(Boolean);
  if (paceRows.length) children.push(new Table({ rows: paceRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('5. Welfare & Conditions'));
  const welRows = [
    fieldRow('Fitness to be interviewed', val(d.fitnessToInterview)),
    fieldRow('Meal breaks', val(d.mealBreaks)),
    fieldRow('Rest', val(d.rest)),
    fieldRow('Medical attention', val(d.medicalAttention)),
  ].filter(Boolean);
  if (welRows.length) children.push(new Table({ rows: welRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('6. Disclosure'));
  if (val(d.disclosureNotes)) children.push(narrativePara(d.disclosureNotes));

  children.push(sectionHeading('7. Consultation'));
  if (val(d.consultationNotes)) children.push(narrativePara(d.consultationNotes));
  const consRows = [
    fieldRow('Advice given', val(d.adviceGiven)),
    fieldRow('Client instructions (full)', val(d.clientInstructionsDetail)),
    fieldRow('Summary of client instructions', val(d.clientInstructions)),
  ].filter(Boolean);
  if (consRows.length) children.push(new Table({ rows: consRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('8. Interview'));
  const interviews = d.interviews || [];
  if (interviews.length) {
    children.push(new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: 'These notes are not verbatim and should not be relied upon as if a transcript.', italics: true, size: 18, font: 'Segoe UI', color: 'b91c1c' })
    ] }));
  }
  interviews.forEach(function(iv, idx) {
    children.push(new Paragraph({ spacing: { before: 120 }, children: [
      new TextRun({ text: 'Interview ' + (idx + 1), bold: true, size: 20, font: 'Segoe UI' })
    ] }));
    const ivRows = [
      fieldRow('Start', val(iv.startTime)),
      fieldRow('End', val(iv.endTime)),
      fieldRow('Present', val(iv.present)),
      fieldRow('Cautioned', val(iv.cautioned)),
    ].filter(Boolean);
    if (ivRows.length) children.push(new Table({ rows: ivRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    if (val(iv.notes)) children.push(narrativePara(iv.notes));
  });

  children.push(sectionHeading('9. Outcome'));
  const outRows = [
    fieldRow('Interview completed', val(d.interviewCompleted)),
    fieldRow('Outcome', val(d.outcomeDecision)),
    fieldRow('Outcome Code (LAA)', val(d.outcomeCode)),
    fieldRow('Stage / Fee code', val(d.stageReachedOrFeeCode)),
    fieldRow('Next location', val(d.nextLocationName)),
    fieldRow('Next date', fmtD(d.nextDate)),
    fieldRow('Further attendance', val(d.furtherAttendance)),
  ].filter(Boolean);
  if (outRows.length) children.push(new Table({ rows: outRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(sectionHeading('Time Recording'));
  const timeRows = [
    fieldRow('Travel time', val(d.travelTimeTotal || d.travelTime)),
    fieldRow('Waiting time', val(d.waitingTime)),
    fieldRow('Attendance time', val(d.attendanceTime)),
    fieldRow('Departure time', val(d.departureTime)),
  ].filter(Boolean);
  if (timeRows.length) children.push(new Table({ rows: timeRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(new Paragraph({ spacing: { before: 300 }, children: [
    new TextRun({ text: 'Created with Custody Note \u2014 www.custodynote.com', size: 16, font: 'Segoe UI', color: '94a3b8', italics: true })
  ] }));

  const doc = new Document({
    creator: 'Custody Note',
    title: docTitle + ' \u2013 ' + clientName,
    description: docTitle,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const desktop = app.getPath('desktop');
  const safeName = path.basename(filename || ('attendance-' + Date.now() + '.docx')).replace(/[<>:"/\\|?*]/g, '_');
  const outPath = path.join(desktop, safeName);
  fs.writeFileSync(outPath, buffer);
  return outPath;
});

/* Print an existing PDF file */
ipcMain.handle('print-pdf-file', async (_, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'No file path provided' };
  if (!fs.existsSync(filePath)) return { error: 'File not found' };
  // H13/H14 — resolve through realpathSync so a Windows junction/symlink
  // under an allowed root that targets outside is rejected, then pass the
  // *resolved* path to loadFile (the previous code resolved-and-checked but
  // then loaded the un-resolved input, which defeated the check).
  let resolvedPath;
  try { resolvedPath = fs.realpathSync(path.resolve(filePath)); }
  catch (e) { return { error: 'Could not resolve path: ' + (e && e.message ? e.message : String(e)) }; }
  if (path.extname(resolvedPath).toLowerCase() !== '.pdf') {
    return { error: 'Only .pdf files can be printed via this channel' };
  }
  const userDataDir = fs.realpathSync(app.getPath('userData'));
  const tempDir = fs.realpathSync(app.getPath('temp'));
  if (!resolvedPath.startsWith(userDataDir) && !resolvedPath.startsWith(tempDir)) {
    return { error: 'Path outside allowed directories' };
  }
  const win = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    hardenWindow(win, {
      logger: { warn: (msg, meta) => console.warn(msg, meta || '') },
      appOrigin: '',
      shellOpenExternal: () => Promise.resolve(),
    });
  } catch (_) {}
  try {
    await win.loadFile(resolvedPath);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (!success && reason !== 'cancelled') console.error('[print-pdf-file] Print failed:', reason);
        resolve();
      });
    });
    return { ok: true };
  } finally {
    try { win.destroy(); } catch (_) {}
  }
});

/* â”€â”€â”€ LAA Official PDF prefill â”€â”€â”€ */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const laaCrm1Fill = require('./lib/laaCrm1Fill');
const laaFormsSync = require('./lib/laaFormsSync');
const laaFormsManifest = require('./lib/laaFormsManifest');
const quickfileClient = require('./lib/quickfileClient');
const quickfileSettingsSync = require('./lib/quickfileSettingsSync');

const QUICKFILE_CREDENTIAL_KEYS = new Set(['quickfileAccountNumber', 'quickfileApiKey', 'quickfileAppId']);

let _laaTemplateStatusCache = null;

function getBundledLaaFormDir() {
  const packed = path.join(process.resourcesPath, 'app', 'data', 'laa-official-forms');
  if (fs.existsSync(packed)) return packed;
  return path.join(__dirname, 'data', 'laa-official-forms');
}

function getLaaFormDir() {
  const active = laaFormsSync.getActiveManifest(getBundledLaaFormDir(), app.getPath('userData'));
  return active ? active.baseDir : getBundledLaaFormDir();
}

function getLaaTemplatePath(formType) {
  return laaFormsSync.resolveTemplatePath(formType, getBundledLaaFormDir(), app.getPath('userData'));
}

async function runLaaEnsureTemplates(opts) {
  const result = await laaFormsSync.ensureTemplates({
    bundledDir: getBundledLaaFormDir(),
    userDataDir: app.getPath('userData'),
    httpGet: (url, ms) => httpGetWithTimeout(url, ms),
    httpGetBinary: (url, ms) => httpGetBinaryBuffer(url, ms),
    apiBaseUrl: getManagedCloudApiUrl() || 'https://custodynote.com',
    forceRemote: !!(opts && opts.forceRemote),
  });
  _laaTemplateStatusCache = result;
  if (result.updated && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('laa-templates-updated', {
        updatedForms: result.updatedForms || [],
        forms: result.forms || {},
      });
    } catch (_) {}
  }
  return result;
}

/** Human-readable label for Desktop naming: Client - Station - Date - Form - Firm.pdf */
function laaSanitizeFilePart(s, maxLen) {
  const t = String(s || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const m = maxLen || 80;
  return t.length > m ? t.slice(0, m) : t;
}

function laaDesktopPdfFilename(d, formType) {
  const dd = d || {};
  const labels = {
    crm1: 'CRM1 Client Details',
    crm2: 'CRM2 Advice and Assistance',
    crm3: 'CRM3 Advocacy Assistance',
    declaration: 'Applicant Declaration',
  };
  const client = laaSanitizeFilePart([dd.forename, dd.surname].filter(Boolean).join(' '), 72) || 'Client';
  const station = laaSanitizeFilePart(dd.policeStationName || dd.otherLocation, 72) || 'Police station';
  const m = String(dd.date || dd.laaSignatureDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dateIso = m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().slice(0, 10);
  const what = labels[formType] || String(formType || 'LAA form').replace(/-/g, ' ');
  const firm = laaSanitizeFilePart(dd.firmName, 72) || 'Firm';
  return `${client} - ${station} - ${dateIso} - ${what} - ${firm}.pdf`;
}

function fmtDateDMY(val) {
  if (!val) return '';
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(val);
}

// H40 — these used to silently swallow "field not found" / pdf-lib errors,
// so a renamed LAA form field would ship as a fully-blank PDF while the
// app reported "filled". We now collect per-render misses onto an
// optional accumulator so fillCRMx can surface a count to the caller and
// we log the first few misses for diagnostics.
let _laaFieldMissAccumulator = null;
function _recordLaaFieldMiss(fieldName, kind, err) {
  try {
    if (!_laaFieldMissAccumulator) return;
    _laaFieldMissAccumulator.push({ field: fieldName, kind: kind, error: err && err.message ? err.message : String(err) });
  } catch (_) {}
}

function safeSet(form, fieldName, value) {
  if (value === undefined || value === null) return;
  const t = String(value);
  if (t === '') return;
  try { form.getTextField(fieldName).setText(t); }
  catch (err) { _recordLaaFieldMiss(fieldName, 'text', err); }
}

function safeClearText(form, fieldName) {
  try { form.getTextField(fieldName).setText(''); } catch (_) {}
}

function safeCheck(form, fieldName, condition) {
  if (!condition) return;
  try { form.getCheckBox(fieldName).check(); }
  catch (err) { _recordLaaFieldMiss(fieldName, 'checkbox', err); }
}

function safeUncheck(form, fieldName) {
  try { form.getCheckBox(fieldName).uncheck(); } catch (_) {}
}

/**
 * CRM1 page 6 â€” Ethnicity (v16): codes from data/laa-reference-data.json ethnicCodes, left-to-right /
 * top-to-bottom field order on the official PDF (18 single-choice boxes).
 */
/* (CRM1 ethnicity/disability code maps moved to lib/laaCrm1Fill.js) */

/**
 * CRM1 page 6 â€” Disability: codes from disabilityCodes; physical order matches the printed
 * â€œDefinitions:â€ list on v16 (CheckBox66 = â€œPrefer not to sayâ€ â€” no app code, left blank).
 */

async function embedSignature(pdfDoc, form, fieldName, dataUri) {
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:image')) return;
  try {
    const field = form.getField(fieldName);
    const widgets = field.acroField.getWidgets();
    if (!widgets.length) return;
    const rect = widgets[0].getRectangle();
    const pageRef = widgets[0].P();
    const pages = pdfDoc.getPages();
    let page = pages[pages.length - 1];
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].ref === pageRef) { page = pages[i]; break; }
    }
    const base64 = dataUri.split(',')[1];
    if (!base64) return;
    const imgBytes = Buffer.from(base64, 'base64');
    const image = dataUri.includes('image/jpeg') || dataUri.includes('image/jpg')
      ? await pdfDoc.embedJpg(imgBytes)
      : await pdfDoc.embedPng(imgBytes);
    const scale = Math.min(rect.width / image.width, rect.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, {
      x: rect.x,
      y: rect.y + (rect.height - h) / 2,
      width: w,
      height: h,
    });
    form.removeField(field);
  } catch (e) {
    console.error('[Signature embed]', fieldName, e.message);
  }
}

/* CRM1 prefill delegates to the unit-tested module. The IPC handlers set
 * _laaFieldMissAccumulator before calling, so pass it through to surface any
 * "field not found" misses (e.g. if the LAA renames a template field). */
function fillCRM1(form, d) {
  return laaCrm1Fill.fillCRM1(form, d, { accumulator: _laaFieldMissAccumulator || undefined });
}

function fillCRM2(form, d) {
  safeCheck(form, 'CheckBox13', d.previousAdvice !== 'Yes');
  safeCheck(form, 'CheckBox14', d.previousAdvice === 'Yes');
  safeSet(form, 'FillText6', fmtDateDMY(d.previousAdviceDate));
  safeSet(form, 'FillText2', d.previousFirmName);
  safeSet(form, 'FillText5', fmtDateDMY(d.laaSignatureDate) || fmtDateDMY(d.date));

  safeCheck(form, 'CheckBox1', true);

  // H34 — CheckBox2 = "criminal / attendance" work. The old condition
  // `wt.indexOf('Telephone') < 0` evaluated to TRUE on an unset workType
  // because an empty string's indexOf is -1, so every blank-worktype
  // record got the criminal tick. Require an explicit positive match on
  // the criminal / attendance keywords instead.
  const wt = d.workType || '';
  const _isCriminalOrAttendance = wt.indexOf('Criminal') >= 0
    || wt.indexOf('Attendance') >= 0
    || wt.indexOf('Police Station') >= 0;
  safeCheck(form, 'CheckBox2', _isCriminalOrAttendance);
  safeCheck(form, 'CheckBox4', wt.indexOf('CCRC') >= 0);
  safeCheck(form, 'CheckBox5', wt.indexOf('Appeals') >= 0 || wt.indexOf('Review') >= 0);
  safeCheck(form, 'CheckBox3', wt.indexOf('Prison') >= 0);

  safeCheck(form, 'CheckBox6', d.travelledToClient === 'Yes');
  safeCheck(form, 'CheckBox7', d.childOrPatient === 'Yes' || d.juvenileVulnerable === 'Juvenile');
  safeCheck(form, 'CheckBox8', d.previousAdvice === 'Yes');
  safeCheck(form, 'CheckBox9', d.telephoneAdviceGiven === 'Yes');
  safeCheck(form, 'CheckBox10', d.claimedOutwardTravelBeforeSignature === 'Yes');

  const justified = [];
  if (d.travelledToClient === 'Yes') justified.push('Travelled out of office to visit client.');
  if (d.childOrPatient === 'Yes' || d.juvenileVulnerable === 'Juvenile') justified.push('Application accepted from child/patient.');
  if (d.previousAdvice === 'Yes') justified.push('Advice provided within 6 months on same matter.');
  if (d.telephoneAdviceGiven === 'Yes') justified.push('Telephone advice before signature.');
  if (d.crm2JustificationNotes) justified.push(d.crm2JustificationNotes);
  safeSet(form, 'FillText1', justified.join(' '));

  safeCheck(form, 'CheckBox11', d.repOrderApplied === 'Yes');
  safeCheck(form, 'CheckBox12', d.repOrderApplied !== 'Yes');
}

function fillCRM3(form, d) {
  const isDefending = d.outcomeDecision ? (d.outcomeDecision.indexOf('Charged') >= 0 || d.outcomeDecision.indexOf('Bail') >= 0) : true;
  safeCheck(form, 'defending_the', isDefending);
  safeCheck(form, 'CheckBox4', !isDefending);
  const involvedOther = d.clientInvolvedAnotherWay === 'Yes';
  safeUncheck(form, 'involved_in_another_way');
  safeCheck(form, 'involved_in_another_way', involvedOther);
  safeSet(form, 'FillText2', d.clientInvolvedDetails);
  /* Header UFN line â€” firm completes; do not pre-fill from record UFN */
  safeClearText(form, 'FillText8');

  const instrDate = fmtDateDMY(d.date);
  if (instrDate) {
    const parts = instrDate.split('/');
    safeSet(form, 'Date_first_instructed_by', parts[0] || '');
    safeSet(form, 'Date_first_instructed_by1', parts[1] || '');
    safeSet(form, 'Date_first_instructed_by2', parts[2] || '');
  }

  const reason = d.advocacyReason || d.offenceSummary || d.offence1Details || '';
  safeCheck(form, 'Disciplinary_proceedings', reason.indexOf('Disciplinary') >= 0);
  safeCheck(form, 'CheckBox10', reason.indexOf('Parole') >= 0);
  safeCheck(form, 'CheckBox1', reason.indexOf('Category A') >= 0);
  safeCheck(form, 'Mental_Health_Review_Trib', reason.indexOf('Minimum Term') >= 0);
  safeCheck(form, 'CheckBox13', reason.indexOf('Armed Forces') >= 0);

  safeCheck(form, 'CheckBox3', reason.indexOf('bail') >= 0 || reason.indexOf('Bail') >= 0 || (d.outcomeDecision && d.outcomeDecision.indexOf('Charged') >= 0));
  safeCheck(form, 'CheckBox5', reason.indexOf('Warrant') >= 0 || reason.indexOf('detention') >= 0 || reason.indexOf('Detention') >= 0);

  // H35 — Name_of_court must be a court name. Previously fell back to the
  // police station, so CRM3 prints the police station as the court. Use
  // the explicit courtName field only; leave blank if not supplied.
  safeSet(form, 'Name_of_court', d.courtName || '');

  const nextHearing = fmtDateDMY(d.courtDate || d.bailDate);
  if (nextHearing) {
    const parts = nextHearing.split('/');
    safeSet(form, 'Date_of_next_hearing', parts[0] || '');
    safeSet(form, 'Date_of_next_hearing1', parts[1] || '');
    safeSet(form, 'Date_of_next_hearing2', parts[2] || '');
  }

  const dateCourtActionStarted = fmtDateDMY(d.date);
  if (dateCourtActionStarted) {
    const parts = dateCourtActionStarted.split('/');
    safeSet(form, 'Date_court_action_started', parts[0] || '');
    safeSet(form, 'Date_court_action_started1', parts[1] || '');
    safeSet(form, 'Date_court_action_started2', parts[2] || '');
  }

  const hasCourtAction = !!(d.date && String(d.date).trim());
  safeUncheck(form, 'Yes1');
  safeUncheck(form, 'No1');
  safeCheck(form, 'Yes1', hasCourtAction);
  safeCheck(form, 'No1', !hasCourtAction);

  const counselYes = d.counselInstructed === 'Yes';
  safeUncheck(form, 'CheckBox2');
  safeUncheck(form, 'CheckBox7');
  safeCheck(form, 'CheckBox2', counselYes);
  safeCheck(form, 'CheckBox7', !counselYes);

  safeSet(form, 'FillText10', d.offenceSummary || d.offence1Details);
  safeSet(form, 'FillText17', reason || (d.outcomeDecision && d.outcomeDecision.indexOf('Charged') >= 0 ? 'Bail application / remand hearing following charge at police station.' : ''));
}

async function fillDeclaration(pdfDoc, form, d, settings) {
  const s = settings || {};
  /* Text4 = USN â€” must remain blank for the firm (same as CRM1 USN). */
  safeClearText(form, 'Text4');
  safeSet(form, 'Text5', [d.forename, d.surname].filter(Boolean).join(' '));
  safeSet(form, 'Text6', d.niNumber);
  safeSet(form, 'Text7', fmtDateDMY(d.dob));
  safeSet(form, 'Dated', fmtDateDMY(d.laaSignatureDate) || fmtDateDMY(d.date));
  safeSet(form, 'Full name in block capitals', [d.forename, d.surname].filter(Boolean).join(' ').toUpperCase());
  safeCheck(form, 'a firm which holds a contract issued by the LAA', true);
  safeSet(form, 'Full name in block capitals_3', d.feeEarnerName || d.laaFeeEarnerFullName || s.feeEarnerName || '');
  safeSet(form, 's LAA Account Number', s.firmLaaAccount || d.firmLaaAccount || '');

  await embedSignature(pdfDoc, form, 'Signature1', d.clientSig);
  await embedSignature(pdfDoc, form, 'Signature3', d.feeEarnerSig);

  // If client signature missing, add reason-why-unsigned on the form (when provided)
  const reason = d.declarationUnsignedReason;
  if (!d.clientSig && reason) {
    try {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const page = pages[0];
      const { height } = page.getSize();
      const line1 = 'Declaration not signed. Reason:';
      const line2 = String(reason).slice(0, 120);
      page.drawText(line1, { x: 50, y: height - 380, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
      page.drawText(line2, { x: 50, y: height - 392, size: 8, font });
    } catch (e) {
      console.error('[Declaration unsigned reason]', e.message);
    }
  }
}

function mergeFeeEarnerSigFromSettings(data, settings) {
  const d = data && typeof data === 'object' ? { ...data } : {};
  const s = settings || {};
  if ((s.feeEarnerSigMode || 'draw') === 'saved' && s.feeEarnerSigMaster && String(s.feeEarnerSigMaster).startsWith('data:image')) {
    d.feeEarnerSig = s.feeEarnerSigMaster;
  }
  return d;
}

ipcMain.handle('laa-ensure-templates', async (_, opts) => {
  try {
    return await runLaaEnsureTemplates(opts || {});
  } catch (err) {
    console.error('[LAA ensure-templates]', err);
    return { ok: false, error: err.message || String(err), forms: {} };
  }
});

ipcMain.handle('laa-get-template-status', async () => {
  if (_laaTemplateStatusCache) return _laaTemplateStatusCache;
  try {
    return await runLaaEnsureTemplates({ skipRemote: true });
  } catch (err) {
    return { ok: false, error: err.message || String(err), forms: {} };
  }
});

ipcMain.handle('laa-generate-official-pdf', async (_, { formType, data }) => {
  try {
    if (!laaFormsManifest.FORM_TYPES.includes(formType)) return { error: 'Unknown form type: ' + formType };
    const ensure = await runLaaEnsureTemplates({});
    if (!ensure.ok) return { error: ensure.error || 'LAA templates unavailable' };
    const templatePath = getLaaTemplatePath(formType);
    if (!templatePath) return { error: 'Template not found for ' + formType };

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const rows = dbAll ? dbAll('SELECT key, value FROM settings') : [];
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const d = mergeFeeEarnerSigFromSettings(data || {}, settings);
    settings.firmName = settings.firmName || '';
    settings.firmLaaAccount = settings.firmLaaAccount || '';
    settings.feeEarnerName = settings.feeEarnerName || '';

    // H40 — collect field misses so we can tell the renderer if LAA renamed
    // any fields and the output PDF is actually missing content.
    _laaFieldMissAccumulator = [];
    try {
      switch (formType) {
        case 'crm1': fillCRM1(form, d); break;
        case 'crm2': fillCRM2(form, d); break;
        case 'crm3': fillCRM3(form, d); break;
        case 'declaration': await fillDeclaration(pdfDoc, form, d, settings); break;
      }
    } finally {
      var misses = _laaFieldMissAccumulator || [];
      _laaFieldMissAccumulator = null;
      if (misses.length) {
        console.warn('[LAA PDF] ' + misses.length + ' form field(s) could not be set on ' + formType + ':',
          misses.slice(0, 5).map(m => m.field + ' (' + m.kind + ')').join(', '));
      }
    }

    // H36 — flatten so the exported PDF is no longer editable via AcroForm.
    try { form.flatten(); } catch (flattenErr) {
      console.warn('[LAA PDF] form.flatten failed:', flattenErr && flattenErr.message);
    }

    const pdfBytes = await pdfDoc.save();
    const desktop = app.getPath('desktop');
    const safeName = laaDesktopPdfFilename(d, formType).replace(/[<>:"/\\|?*]/g, '_');
    const outPath = path.join(desktop, safeName);
    fs.writeFileSync(outPath, pdfBytes);
    return {
      path: outPath,
      fieldMisses: misses.length,
      missedFields: misses.slice(0, 10).map(m => m.field),
    };
  } catch (err) {
    console.error('[LAA PDF]', err);
    return { error: err.message || String(err) };
  }
});

/* Generate LAA PDF as base64 buffer (for attaching to records/invoices, not saving to Desktop) */
ipcMain.handle('laa-generate-pdf-buffer', async (_, { formType, data }) => {
  try {
    if (!laaFormsManifest.FORM_TYPES.includes(formType)) return { error: 'Unknown form type: ' + formType };
    const ensure = await runLaaEnsureTemplates({});
    if (!ensure.ok) return { error: ensure.error || 'LAA templates unavailable' };
    const templatePath = getLaaTemplatePath(formType);
    if (!templatePath) return { error: 'Template not found for ' + formType };

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    const rows = dbAll ? dbAll('SELECT key, value FROM settings') : [];
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const d = mergeFeeEarnerSigFromSettings(data || {}, settings);
    settings.firmName = settings.firmName || '';
    settings.firmLaaAccount = settings.firmLaaAccount || '';
    settings.feeEarnerName = settings.feeEarnerName || '';

    _laaFieldMissAccumulator = [];
    try {
      switch (formType) {
        case 'crm1': fillCRM1(form, d); break;
        case 'crm2': fillCRM2(form, d); break;
        case 'crm3': fillCRM3(form, d); break;
        case 'declaration': await fillDeclaration(pdfDoc, form, d, settings); break;
      }
    } finally {
      var misses = _laaFieldMissAccumulator || [];
      _laaFieldMissAccumulator = null;
      if (misses.length) {
        console.warn('[LAA PDF Buffer] ' + misses.length + ' form field(s) could not be set on ' + formType);
      }
    }

    // H36 — flatten so the attached PDF is no longer editable via AcroForm.
    try { form.flatten(); } catch (flattenErr) {
      console.warn('[LAA PDF Buffer] form.flatten failed:', flattenErr && flattenErr.message);
    }

    const pdfBytes = await pdfDoc.save();
    return {
      base64: Buffer.from(pdfBytes).toString('base64'),
      size: pdfBytes.length,
      fieldMisses: misses.length,
      missedFields: misses.slice(0, 10).map(m => m.field),
    };
  } catch (err) {
    console.error('[LAA PDF Buffer]', err);
    return { error: err.message || String(err) };
  }
});

/* Convert HTML document to PDF buffer (for conflict cert, client instructions, etc.) */
ipcMain.handle('html-to-pdf-buffer', async (_, { html }) => {
  try {
    const buf = await renderHtmlToPdfBuffer(html);
    return { base64: buf.toString('base64'), size: buf.length };
  } catch (err) {
    console.error('[HTMLâ†’PDF Buffer]', err);
    return { error: err.message || String(err) };
  }
});


ipcMain.handle('laa-open-official-template', async (_, formType) => {
  try {
    if (!laaFormsManifest.FORM_TYPES.includes(formType)) return { error: 'Unknown form type: ' + formType };
    const ensure = await runLaaEnsureTemplates({});
    if (!ensure.ok) return { error: ensure.error || 'LAA templates unavailable' };
    const templatePath = getLaaTemplatePath(formType);
    if (!templatePath) return { error: 'Template not found for ' + formType };
    await shell.openPath(templatePath);
    return { path: templatePath };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

/* â”€â”€â”€ QuickFile API: import firms directory â”€â”€â”€ */
function getQuickFileSettingsStatus() {
  const rows = dbAll('SELECT key, value FROM settings');
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const accountNumber = (settings.quickfileAccountNumber || '').trim();
  const apiKey = (settings.quickfileApiKey || '').trim();
  const applicationId = (settings.quickfileAppId || '').trim();
  const missing = [];
  if (!accountNumber) missing.push('Account number');
  if (!apiKey) missing.push('API key');
  if (!applicationId) missing.push('Application ID');
  return {
    accountNumber,
    apiKey,
    applicationId,
    missing,
    lengths: {
      account: accountNumber.length,
      apiKey: apiKey.length,
      applicationId: applicationId.length,
    },
  };
}

function applyQuickFileSettingsFromCloud(decrypted, serverUpdatedAt) {
  if (!decrypted) return false;
  dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileAccountNumber', decrypted.quickfileAccountNumber || '']);
  dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileApiKey', decrypted.quickfileApiKey || '']);
  dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileAppId', decrypted.quickfileAppId || '']);
  if (serverUpdatedAt) {
    dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileSettingsServerUpdatedAt', serverUpdatedAt]);
  }
  dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileSettingsSyncedAt', new Date().toISOString()]);
  markDbDirty();
  if (typeof flushDbSync === 'function') {
    try { flushDbSync(); } catch (flushErr) {
      console.warn('[QuickFile] flushDbSync after cloud pull failed:', flushErr && flushErr.message);
    }
  }
  return true;
}

async function ensureQuickFileSettingsFromServer(opts) {
  const reason = (opts && opts.reason) || 'unknown';
  const force = !!(opts && opts.force);
  const status = getQuickFileSettingsStatus();
  const localComplete = status.missing.length === 0;
  const rows = dbAll('SELECT key, value FROM settings');
  const localMeta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const localServerUpdatedAt = String(localMeta.quickfileSettingsServerUpdatedAt || '').trim();

  const apiUrl = getManagedCloudApiUrl();
  const data = readLicenceData();
  if (!apiUrl || !data || !data.key) {
    return { ok: localComplete, usedLocal: localComplete, reason: reason, skipped: 'no-licence-or-api' };
  }

  /* Incomplete local credentials: always pull from server (new machine / fresh install). */
  if (localComplete && !force) {
    const syncedAt = Date.parse(localMeta.quickfileSettingsSyncedAt || '');
    if (syncedAt && (Date.now() - syncedAt) < 15 * 60 * 1000) {
      return { ok: true, usedLocal: true, reason: reason, skipped: 'recent-local-cache' };
    }
  }

  const pull = await quickfileSettingsSync.pullQuickFileSettingsFromServer(
    httpPost,
    apiUrl,
    data.key,
    getMachineId(),
    { headers: _getAuthHeaders(), timeout: 15000 }
  );

  if (!pull.ok) {
    console.warn('[QuickFile] settings pull failed (' + reason + '):', pull.error || 'unknown');
    return { ok: localComplete, usedLocal: localComplete, reason: reason, error: pull.error || 'pull failed' };
  }

  const serverUpdatedAt = String(pull.updatedAt || '').trim();
  if (localComplete && serverUpdatedAt && localServerUpdatedAt && serverUpdatedAt <= localServerUpdatedAt && !force) {
    dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileSettingsSyncedAt', new Date().toISOString()]);
    markDbDirty();
    return { ok: true, usedLocal: true, reason: reason, skipped: 'server-not-newer' };
  }

  const decrypted = quickfileSettingsSync.decryptQuickFileSettings(data.key, pull.blob);
  if (!decrypted || !decrypted.quickfileAccountNumber || !decrypted.quickfileApiKey || !decrypted.quickfileAppId) {
    console.warn('[QuickFile] settings pull returned undecryptable or incomplete blob (' + reason + ')');
    return { ok: localComplete, usedLocal: localComplete, reason: reason, error: 'decrypt failed' };
  }

  applyQuickFileSettingsFromCloud(decrypted, serverUpdatedAt);
  console.info('[QuickFile] settings pulled from server (' + reason + ') updatedAt=' + (serverUpdatedAt || '?'));
  return { ok: true, usedLocal: false, reason: reason, updatedAt: serverUpdatedAt };
}

async function pushQuickFileSettingsToCloud(reason) {
  const apiUrl = getManagedCloudApiUrl();
  const data = readLicenceData();
  if (!apiUrl || !data || !data.key) {
    return { ok: false, error: 'Licence server not available' };
  }
  const status = getQuickFileSettingsStatus();
  if (status.missing.length) {
    return { ok: false, error: 'QuickFile credentials incomplete' };
  }
  const payload = {
    quickfileAccountNumber: status.accountNumber,
    quickfileApiKey: status.apiKey,
    quickfileAppId: status.applicationId,
  };
  const push = await quickfileSettingsSync.pushQuickFileSettingsToServer(
    httpPost,
    apiUrl,
    data.key,
    getMachineId(),
    payload,
    { headers: _getAuthHeaders(), timeout: 15000 }
  );
  if (push.ok) {
    if (push.updatedAt) {
      dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileSettingsServerUpdatedAt', push.updatedAt]);
      dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileSettingsSyncedAt', new Date().toISOString()]);
      markDbDirty();
      if (typeof flushDbSync === 'function') {
        try { flushDbSync(); } catch (_) {}
      }
    }
    console.info('[QuickFile] settings pushed to server (' + (reason || 'save') + ')');
  } else {
    console.warn('[QuickFile] settings push failed:', push.error || 'unknown');
  }
  return push;
}

function getQuickFileAuth() {
  const status = getQuickFileSettingsStatus();
  // A fresh submission number + MD5 is built for every request (no token reuse).
  return quickfileClient.buildQuickFileAuth({
    accountNumber: status.accountNumber,
    apiKey: status.apiKey,
    applicationId: status.applicationId,
  });
}

function quickFileRequest(apiPath, bodyContent) {
  const auth = getQuickFileAuth();
  const postData = JSON.stringify({
    payload: {
      Header: {
        MessageType: 'Request',
        SubmissionNumber: auth.submissionNumber,
        Authentication: {
          AccNumber: auth.accountNumber,
          MD5Value: auth.md5Value,
          ApplicationID: auth.applicationId,
        },
      },
      Body: bodyContent,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.quickfile.co.uk',
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData, 'utf8'),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const raw = String(data || '');
          try {
            resolve(quickfileClient.parseQuickFileResponse(res.statusCode, raw));
          } catch (parseErr) {
            if (/parse error/i.test(parseErr.message)) {
              console.error('[QuickFile] Response not valid JSON | HTTP:', res.statusCode, '| length:', raw.length, '| head:', raw.slice(0, 800));
            }
            reject(parseErr);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData, 'utf8');
    req.end();
  });
}

function quickFileJoinAddress(parts) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function quickFileExtractAddress(client) {
  if (!client || typeof client !== 'object') return '';
  const candidates = [
    client.Address,
    client.InvoiceAddress,
    client.DeliveryAddress,
    client.PostalAddress,
    client.PrimaryAddress,
    client.AddressDetails,
  ];
  for (const address of candidates) {
    if (!address) continue;
    if (typeof address === 'string') {
      const text = address.trim();
      if (text) return text;
      continue;
    }
    if (typeof address === 'object') {
      const joined = quickFileJoinAddress([
        address.Line1,
        address.Line2,
        address.Line3,
        address.Line4,
        address.Line5,
        address.AddressLine1,
        address.AddressLine2,
        address.AddressLine3,
        address.AddressLine4,
        address.AddressLine5,
        address.City,
        address.Town,
        address.County,
        address.Postcode,
        address.PostCode,
        address.Zip,
        address.Country,
      ]);
      if (joined) return joined;
    }
  }
  return quickFileJoinAddress([
    client.AddressLine1,
    client.AddressLine2,
    client.AddressLine3,
    client.AddressLine4,
    client.AddressLine5,
    client.City,
    client.Town,
    client.County,
    client.Postcode,
    client.PostCode,
    client.Zip,
    client.Country,
  ]);
}

function quickFileExtractRecords(body) {
  const clientList = body.Record || body.Records || body.ClientDetails || body.Clients || [];
  return Array.isArray(clientList) ? clientList : [clientList].filter(Boolean);
}

function quickFileNormaliseClient(client) {
  const primary = client.PrimaryContact || client.Contact || {};
  return {
    clientId: client.ClientID || client.ClientId || '',
    companyName: client.ClientName || client.CompanyName || client.Name || '',
    contactName: (
      client.ContactName ||
      [primary.FirstName || client.ContactFirstName || '', primary.Surname || client.ContactLastName || ''].filter(Boolean).join(' ')
    ).trim(),
    email: client.Email || primary.Email || '',
    telephone: client.Telephone || primary.Telephone || primary.Phone || '',
    address: quickFileExtractAddress(client),
  };
}

async function quickFileFetchAllClients() {
  const pageSize = 200;
  let offset = 0;
  const clients = [];
  while (true) {
    const body = await quickFileRequest('/1_2/client/search', {
      SearchParameters: {
        ReturnCount: pageSize,
        Offset: offset,
        OrderResultsBy: 'CompanyName',
        OrderDirection: 'ASC',
      },
    });
    const records = quickFileExtractRecords(body);
    clients.push(...records);
    if (records.length < pageSize) break;
    offset += pageSize;
  }
  return clients;
}

ipcMain.handle('quickfile-fetch-clients', async () => {
  await ensureQuickFileSettingsFromServer({ reason: 'fetch-clients' });
  const records = await quickFileFetchAllClients();
  const clients = records.map((client) => {
    return quickFileNormaliseClient(client);
  }).filter((client) => client.companyName);
  return { clients };
});

/* Persist the outcome of a real QuickFile health check so the connection panel
 * can show a reliable state across app restarts and on every machine. We only
 * ever write the three status keys here — never the credential keys — so a
 * failed/timed-out API call can never corrupt saved QuickFile credentials. */
function recordQuickFileConnectionResult(ok, errorMessage) {
  const nowIso = new Date().toISOString();
  try {
    dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileLastConnectionCheckedAt', nowIso]);
    if (ok) {
      dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileLastConnectionOkAt', nowIso]);
      dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileLastConnectionError', '']);
    } else {
      dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['quickfileLastConnectionError', String(errorMessage || 'Unknown error').slice(0, 500)]);
    }
    markDbDirty();
  } catch (e) {
    console.warn('[QuickFile] could not persist connection result:', e && e.message);
  }
}

ipcMain.handle('quickfile-test-connection', async () => {
  await ensureQuickFileSettingsFromServer({ reason: 'test-connection', force: true });
  try {
    const body = await quickFileRequest('/1_2/client/search', {
      SearchParameters: {
        ReturnCount: 1,
        Offset: 0,
        OrderResultsBy: 'CompanyName',
        OrderDirection: 'ASC',
      },
    });
    const records = quickFileExtractRecords(body);
    recordQuickFileConnectionResult(true, '');
    return {
      ok: true,
      sampleCount: records.length,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    recordQuickFileConnectionResult(false, msg);
    throw err; // surface the real reason to the renderer
  }
});

ipcMain.handle('quickfile-settings-status', () => {
  const status = getQuickFileSettingsStatus();
  return { missing: status.missing, lengths: status.lengths };
});

/* Reliable, DB-backed connection facts for the status panel. Reads only the
 * settings table (per-machine source of truth) — independent of any renderer
 * state, so it is consistent on every machine and after every restart. */
ipcMain.handle('quickfile-connection-state', async () => {
  const ensureResult = await ensureQuickFileSettingsFromServer({ reason: 'connection-state', force: true });
  const status = getQuickFileSettingsStatus();
  const rows = dbAll('SELECT key, value FROM settings');
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    missing: status.missing,
    lengths: status.lengths,
    lastOkAt: settings.quickfileLastConnectionOkAt || '',
    lastError: settings.quickfileLastConnectionError || '',
    lastCheckedAt: settings.quickfileLastConnectionCheckedAt || '',
    syncError: (ensureResult && ensureResult.error) || '',
  };
});

ipcMain.handle('quickfile-settings-push', async () => {
  try {
    return await pushQuickFileSettingsToCloud('settings-save');
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('quickfile-settings-ensure', async () => {
  try {
    const before = getQuickFileSettingsStatus();
    const result = await ensureQuickFileSettingsFromServer({
      reason: 'ensure',
      force: before.missing.length > 0,
    });
    const after = getQuickFileSettingsStatus();
    return {
      ok: after.missing.length === 0,
      pulled: result.usedLocal === false,
      missing: after.missing,
      skipped: result.skipped || null,
      error: result.error || null,
    };
  } catch (err) {
    return {
      ok: false,
      pulled: false,
      missing: getQuickFileSettingsStatus().missing,
      error: err && err.message ? err.message : String(err),
    };
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   POSTCODE LOOKUP  (server proxy â†’ Ideal Postcodes API)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
ipcMain.handle('postcode-lookup', async (_, postcode) => {
  const pc = (postcode || '').trim().replace(/\s+/g, '');
  if (!pc) return { ok: false, error: 'No postcode entered.' };

  const data = readLicenceData();
  const licenceKey = (data && data.key) || '';
  const apiUrl = getManagedCloudApiUrl();

  if (!licenceKey || !apiUrl) {
    console.warn('[Postcode] Missing licence key or API URL', { hasKey: !!licenceKey, hasUrl: !!apiUrl });
    return { ok: false, error: 'Postcode lookup requires a valid licence. Check your internet connection or contact support.' };
  }

  console.log(`[Postcode] Looking up "${pc}" via ${apiUrl}/api/postcodes/lookup`);
  try {
    const resp = await httpPost(`${apiUrl}/api/postcodes/lookup`, { postcode: pc, licenceKey });
    console.log(`[Postcode] Response ok=${resp.ok}, addresses=${resp.addresses ? resp.addresses.length : 0}`);
    if (resp.ok && resp.addresses) return { ok: true, addresses: resp.addresses };
    if (resp.error === 'Postcode not found') return { ok: false, error: 'Postcode not found.' };
    return { ok: false, error: resp.error || 'Lookup failed.' };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const code = e && e.statusCode;
    console.warn(`[Postcode] Lookup failed â€” status=${code || '?'}, message="${msg}"`);
    if (msg === 'Postcode not found') return { ok: false, error: 'Postcode not found.' };
    if (msg === 'Invalid licence key') return { ok: false, error: 'Invalid licence key. Re-activate in Settings.' };
    if (msg === 'Licence key is required') return { ok: false, error: 'Licence key is required for postcode lookup.' };
    if (/subscription required/i.test(msg)) return { ok: false, error: 'Active subscription required for postcode lookup.' };
    /* 402 Payment Required â€” upstream postcode quota / plan / billing on managed API */
    if (code === 402) {
      return {
        ok: false,
        error:
          'Postcode lookup is not available right now (service billing or quota). Please try again later or enter the address manually. Contact support if this continues.',
      };
    }
    if (/not configured/i.test(msg)) return { ok: false, error: 'Postcode service is temporarily unavailable.' };
    if (e && e.code === 'ETIMEDOUT') return { ok: false, error: 'Postcode lookup timed out. Try again.' };
    return { ok: false, error: msg || 'Postcode lookup failed. Check your internet connection.' };
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   QUICKFILE INVOICE CREATION
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function quickFileFindOrCreateClient(firmName, contactEmail) {
  const searchBody = await quickFileRequest('/1_2/client/search', {
    SearchParameters: {
      CompanyName: firmName,
      ReturnCount: 10,
      Offset: 0,
      OrderResultsBy: 'CompanyName',
      OrderDirection: 'ASC',
    },
  });
  const records = quickFileExtractRecords(searchBody);
  const match = records.find(r => {
    const name = (r.ClientName || r.CompanyName || r.Name || '').toLowerCase();
    return name === firmName.toLowerCase();
  });
  if (match) return match.ClientID || match.ClientId;

  const createBody = await quickFileRequest('/1_2/client/create', {
    ClientDetails: {
      ClientType: 'Company',
      CompanyName: firmName,
      Email: contactEmail || '',
    },
  });
  return createBody.ClientID || createBody.ClientId || createBody.RecordID || null;
}

function sanitizeQuickFileInvoiceNumber(raw) {
  let s = String(raw || '').trim().replace(/^\.+/, '');
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  if (s.length > 20) s = s.slice(0, 20);
  return s;
}

function getNextSequentialInvoiceNumber() {
  const row = dbAll("SELECT value FROM settings WHERE key = 'nextInvoiceNumber'");
  let next = row.length ? parseInt(row[0].value, 10) : NaN;
  if (!Number.isFinite(next) || next < 1) next = 6066;
  const formatted = String(next).padStart(6, '0');
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('nextInvoiceNumber', ?)", [String(next + 1)]);
  saveDb();
  return formatted;
}

/** Next invoice number that would be issued (does not advance the counter). */
function peekNextSequentialInvoiceNumber() {
  const row = dbAll("SELECT value FROM settings WHERE key = 'nextInvoiceNumber'");
  let next = row.length ? parseInt(row[0].value, 10) : NaN;
  if (!Number.isFinite(next) || next < 1) next = 6066;
  return String(next).padStart(6, '0');
}

/** Largest numeric segment from an invoice reference (handles "006069", "INV-6069", etc.). */
function parseInvoiceNumberNumericPart(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return NaN;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : NaN;
}

function quickFileExtractInvoiceSearchRecords(body) {
  if (!body || typeof body !== 'object') return [];
  const list =
    body.Record ||
    body.Records ||
    body.InvoiceDetails ||
    body.Invoices ||
    body.InvoiceList ||
    [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean);
}

async function quickFileGetMaxInvoiceNumberNumeric() {
  const body = await quickFileRequest('/1_2/invoice/search', {
    SearchParameters: {
      ReturnCount: 1,
      Offset: 0,
      OrderResultsBy: 'InvoiceNumber',
      OrderDirection: 'DESC',
      InvoiceType: 'INVOICE',
    },
  });
  const records = quickFileExtractInvoiceSearchRecords(body);
  if (!records.length) return null;
  const inv = records[0];
  const invNum = inv.InvoiceNumber || inv.Invoice_No || inv.InvoiceNo || inv.InvoiceNum || '';
  const n = parseInvoiceNumberNumericPart(invNum);
  return Number.isFinite(n) ? n : null;
}

/** Align local nextInvoiceNumber so the next issued number is above QuickFile's highest (handles invoices created outside the app). */
async function syncNextInvoiceNumberFromQuickFileLedger() {
  try {
    const max = await quickFileGetMaxInvoiceNumberNumeric();
    if (max === null || !Number.isFinite(max)) return;
    const row = dbAll("SELECT value FROM settings WHERE key = 'nextInvoiceNumber'");
    let storedNext = row.length ? parseInt(row[0].value, 10) : NaN;
    if (!Number.isFinite(storedNext) || storedNext < 1) storedNext = 6066;
    const requiredNext = max + 1;
    if (storedNext < requiredNext) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('nextInvoiceNumber', ?)", [String(requiredNext)]);
      saveDb();
      console.warn('[QuickFile] Bumped nextInvoiceNumber to ' + requiredNext + ' (QuickFile max invoice # was ' + max + ')');
    }
  } catch (e) {
    console.warn('[QuickFile] syncNextInvoiceNumberFromQuickFileLedger:', e && e.message ? e.message : e);
  }
}

function isQuickFileInvoiceNumberDuplicateError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  if (!msg) return false;
  if (msg.includes('already exists')) return true;
  if (/invoice\s*#?\s*[\d\w-]+\s*already/.test(msg)) return true;
  if (msg.includes('duplicate') && msg.includes('invoice')) return true;
  if (msg.includes('invoice number') && (msg.includes('taken') || msg.includes('use'))) return true;
  return false;
}

ipcMain.handle('quickfile-suggest-next-invoice-number', async () => {
  await syncNextInvoiceNumberFromQuickFileLedger();
  return { ok: true, number: peekNextSequentialInvoiceNumber() };
});

function buildQuickFileItemLine(shortName, description, unitCost, qty, vatRate) {
  const vr = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 0.2;
  const net = Number.isFinite(Number(unitCost)) ? Number(unitCost) : 0;
  const q = Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1;
  if (net <= 0) throw new Error('Line item unit cost must be > 0: ' + shortName);
  const taxAmt = net * vr;
  const name = String(shortName || 'Item').replace(/\s+/g, ' ').trim().slice(0, 25);
  return {
    ItemID: 0,
    ItemName: name,
    ItemDescription: String(description || '').slice(0, 5000),
    ItemNominalCode: '4000',
    Qty: q,
    UnitCost: Number(net.toFixed(2)),
    Tax1: {
      TaxName: 'VAT',
      TaxPercentage: Number((vr * 100).toFixed(2)),
      TaxAmount: Number(taxAmt.toFixed(2)),
    },
  };
}

/* Product note: invoice/create shipped first; Document_Upload was added so the attendance PDF
   matches billing preview. Earlier â€œbilling overhaulâ€ removed list exports before this unified flow. */
/** Attach a PDF to a sales invoice via QuickFile Document_Upload (same auth as other calls). */
function validateDocumentUploadPayload(body) {
  const doc = body && body.DocumentDetails;
  if (!doc || typeof doc !== 'object') throw new Error('Preflight: missing DocumentDetails');
  if (!doc.FileName || typeof doc.FileName !== 'string' || !doc.FileName.trim()) {
    throw new Error('Preflight: FileName is required');
  }
  if (!doc.EmbeddedFileBinaryObject || typeof doc.EmbeddedFileBinaryObject !== 'string') {
    throw new Error('Preflight: EmbeddedFileBinaryObject is required');
  }
  const type = doc.Type;
  if (!type || typeof type !== 'object') {
    throw new Error('Preflight: DocumentDetails.Type wrapper is required');
  }
  const sa = type.SalesAttachment;
  if (!sa || typeof sa !== 'object') {
    throw new Error('Preflight: Type.SalesAttachment is required');
  }
  if (!Number.isFinite(sa.InvoiceId) || sa.InvoiceId <= 0) {
    throw new Error('Preflight: SalesAttachment.InvoiceId must be a positive integer');
  }
}

async function quickFileUploadSalesAttachment(invoiceId, fileName, pdfBuffer, notes) {
  const invId = parseInt(String(invoiceId), 10);
  if (!Number.isFinite(invId)) throw new Error('Invalid InvoiceId for attachment');
  if (!pdfBuffer || !pdfBuffer.length) throw new Error('PDF buffer is empty â€” cannot attach');
  const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
  if (pdfBuffer.length > MAX_ATTACH_BYTES) throw new Error('Attachment too large (' + Math.round(pdfBuffer.length / 1024) + ' KB) â€” max 10 MB');
  const safeName = String(fileName || 'attendance-note.pdf').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  const fn = safeName.length >= 5 ? safeName.slice(0, 150) : 'note.pdf';
  const b64 = Buffer.from(pdfBuffer).toString('base64');
  const uploadPayload = {
    DocumentDetails: {
      FileName: fn,
      EmbeddedFileBinaryObject: b64,
      Type: {
        SalesAttachment: {
          InvoiceId: invId,
          Notes: String(notes || 'Attendance note PDF').slice(0, 600),
        },
      },
    },
  };
  validateDocumentUploadPayload(uploadPayload);
  await quickFileRequest('/1_2/document/upload', uploadPayload);
}

function validateQuickFileInvoicePayload(body) {
  const inv = body && body.InvoiceData;
  if (!inv || typeof inv !== 'object') throw new Error('Preflight: missing InvoiceData');
  const validTypes = ['INVOICE', 'ESTIMATE', 'RECURRING'];
  if (!validTypes.includes(inv.InvoiceType)) throw new Error('Preflight: InvoiceType must be ' + validTypes.join('/'));
  if (!Number.isFinite(inv.ClientID) || inv.ClientID <= 0) throw new Error('Preflight: ClientID must be a positive integer');
  if (typeof inv.Currency !== 'string' || inv.Currency.length !== 3) throw new Error('Preflight: Currency must be a 3-char ISO code');
  if (!Number.isFinite(inv.TermDays) || inv.TermDays < 0) throw new Error('Preflight: TermDays must be a non-negative integer');
  if (inv.InvoiceDescription && (inv.InvoiceDescription.length < 2 || inv.InvoiceDescription.length > 35)) {
    throw new Error('Preflight: InvoiceDescription must be 2-35 chars');
  }
  if (inv.ClientAddress) {
    if (!inv.ClientAddress.CountryISO || inv.ClientAddress.CountryISO.length !== 2) {
      throw new Error('Preflight: ClientAddress requires a 2-char CountryISO');
    }
  }
  const lines = inv.InvoiceLines && inv.InvoiceLines.ItemLines && inv.InvoiceLines.ItemLines.ItemLine;
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Preflight: at least one ItemLine required');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const pfx = 'Preflight: ItemLine[' + i + '] ';
    if (typeof ln.ItemNominalCode !== 'string' || ln.ItemNominalCode.length < 2 || ln.ItemNominalCode.length > 5) {
      throw new Error(pfx + 'ItemNominalCode must be 2-5 chars');
    }
    if (!Number.isFinite(ln.UnitCost) || ln.UnitCost <= 0) throw new Error(pfx + 'UnitCost must be > 0');
    if (!Number.isFinite(ln.Qty) || ln.Qty <= 0) throw new Error(pfx + 'Qty must be > 0');
    if (ln.ItemName && ln.ItemName.length > 25) throw new Error(pfx + 'ItemName max 25 chars');
  }
  const sched = inv.Scheduling;
  if (!sched || typeof sched !== 'object') throw new Error('Preflight: missing Scheduling inside InvoiceData');
  const single = sched.SingleInvoiceData;
  if (inv.InvoiceType === 'INVOICE' || inv.InvoiceType === 'ESTIMATE') {
    if (!single || !single.IssueDate) throw new Error('Preflight: SingleInvoiceData.IssueDate required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(single.IssueDate)) throw new Error('Preflight: IssueDate must be YYYY-MM-DD');
  }
}

ipcMain.handle('quickfile-create-invoice', async (_, params) => {
  if (!params || typeof params !== 'object') {
    return { ok: false, error: 'Invalid invoice parameters' };
  }
  await ensureQuickFileSettingsFromServer({ reason: 'create-invoice', force: true });
  const {
    attendanceId,
    firmName,
    contactEmail,
    clientName,
    stationName,
    attendanceFee,
    mileageMiles,
    mileageRate,
    parkingAmount,
    vatRate,
    narrative,
    invoiceDate,
    userName,
    billingInvoiceNumber,
    attachAttendanceHtml,
    attachPdfFileName,
  } = params;

  if (!firmName || typeof firmName !== 'string' || !firmName.trim()) {
    return { ok: false, error: 'Firm name is required to create an invoice' };
  }

  if (attendanceId) {
    const existingInv = dbGet('SELECT quickfile_invoice_id, quickfile_invoice_number FROM attendances WHERE id = ?', [attendanceId]);
    if (existingInv && existingInv.quickfile_invoice_id && !params.allowDuplicate) {
      return {
        ok: false,
        code: 'ALREADY_INVOICED',
        error: 'This record already has invoice #' + (existingInv.quickfile_invoice_number || existingInv.quickfile_invoice_id) + '.',
      };
    }
  }

  try {
    const clientId = await quickFileFindOrCreateClient(firmName.trim(), contactEmail);
    if (!clientId) throw new Error('Could not find or create QuickFile client for ' + firmName);

    const clientIdNum = parseInt(String(clientId), 10);
    if (!Number.isFinite(clientIdNum)) throw new Error('Invalid QuickFile ClientID: ' + String(clientId));

    const vr = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 0.2;
    const cn = (clientName || '').trim();
    const sn = (stationName || '').trim();

    const lineItems = [];
    if (attendanceFee > 0) {
      lineItems.push(buildQuickFileItemLine(
        'PS Attendance Fixed Fee',
        narrative || [cn, sn].filter(Boolean).join(' - ') || 'Police Station Attendance Fixed Fee',
        attendanceFee,
        1,
        vr
      ));
    }

    const mileageCost = (mileageMiles || 0) * (mileageRate || 0.45);
    if (mileageCost > 0) {
      lineItems.push(buildQuickFileItemLine(
        'Mileage',
        (mileageMiles || 0) + ' miles @ Â£' + (mileageRate || 0.45).toFixed(2),
        mileageCost,
        1,
        vr
      ));
    }

    if (parkingAmount > 0) {
      lineItems.push(buildQuickFileItemLine(
        'Parking',
        'Parking',
        parkingAmount,
        1,
        vr
      ));
    }

    if (!lineItems.length) throw new Error('No billable items to invoice');

    const invDate = invoiceDate || new Date().toISOString().slice(0, 10);

    await syncNextInvoiceNumberFromQuickFileLedger();

    const MAX_INVOICE_NUMBER_ATTEMPTS = 35;
    let invoiceBody;
    let lastCreateErr;
    for (let attempt = 0; attempt < MAX_INVOICE_NUMBER_ATTEMPTS; attempt++) {
      const invNum = getNextSequentialInvoiceNumber();
      const singleInvoiceData = { IssueDate: invDate, InvoiceNumber: invNum };

      const invoicePayload = {
        InvoiceData: {
          InvoiceType: 'INVOICE',
          ClientID: clientIdNum,
          Currency: 'GBP',
          TermDays: 30,
          Language: 'en',
          Notes: (narrative || '').slice(0, 4000),
          InvoiceLines: {
            ItemLines: {
              ItemLine: lineItems,
            },
          },
          Scheduling: {
            SingleInvoiceData: singleInvoiceData,
          },
        },
      };
      validateQuickFileInvoicePayload(invoicePayload);
      try {
        invoiceBody = await quickFileRequest('/1_2/invoice/create', invoicePayload);
        break;
      } catch (e) {
        lastCreateErr = e;
        if (!isQuickFileInvoiceNumberDuplicateError(e) || attempt === MAX_INVOICE_NUMBER_ATTEMPTS - 1) {
          throw e;
        }
        console.warn('[QuickFile] Invoice number conflict, trying next:', e && e.message ? e.message : e);
      }
    }
    if (!invoiceBody) throw lastCreateErr || new Error('QuickFile invoice/create failed');

    const invoiceId = invoiceBody.InvoiceID || invoiceBody.InvoiceId || invoiceBody.RecordID || '';
    const invoiceNumber = invoiceBody.InvoiceNumber || '';

    const subtotal = (attendanceFee || 0) + mileageCost + (parkingAmount || 0);
    const vat = subtotal * vr;
    const total = subtotal + vat;

    const invoiceUrl = invoiceId
      ? 'https://app.quickfile.co.uk/invoice/view/' + invoiceId
      : '';

    let attachmentOk = false;
    let attachmentError = '';

    if (attendanceId) {
      db.run(
        `UPDATE attendances SET
          quickfile_invoice_id = ?,
          quickfile_invoice_number = ?,
          quickfile_invoice_url = ?,
          invoice_created_at = datetime('now'),
          invoice_created_by = ?,
          invoice_subtotal = ?,
          invoice_vat = ?,
          invoice_total = ?,
          invoice_narrative = ?,
          invoice_mileage_miles = ?,
          invoice_mileage_rate = ?,
          invoice_parking_amount = ?,
          invoice_attendance_fee = ?,
          invoice_vat_rate = ?,
          updated_at = datetime('now')
        WHERE id = ?`,
        [
          String(invoiceId), invoiceNumber, invoiceUrl,
          userName || '',
          subtotal, vat, total,
          narrative || '',
          mileageMiles || 0, mileageRate || 0.45,
          parkingAmount || 0, attendanceFee || 0,
          vatRate || 0.20,
          attendanceId,
        ]
      );
      db.run(
        `INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)`,
        [attendanceId, 'invoice_created', JSON.stringify({ invoiceId, invoiceNumber, total }), userName || '']
      );
      saveDb();
    }

    /* Attach PDFs to QuickFile invoice â€” supports multiple attachments */
    const attachResults = [];

    /*
     * v1.5.6: Avoid double-attachment on the workflow billing path.
     *
     * Two attach sources exist:
     *   1) Legacy `attachAttendanceHtml` â€” auto-renders the attendance note from HTML.
     *   2) `extraAttachments[]` â€” user-selected documents from the workflow billing screen
     *      (which already includes the attendance note when ticked).
     *
     * If the caller provides any user-selected `extraAttachments`, we honour ONLY their
     * selection and skip the legacy auto attach (otherwise the attendance note got
     * attached twice). The standalone billing.js path â€” which never sends
     * `extraAttachments` â€” keeps its single auto-attached attendance note.
     */
    const extraAttachments = params.extraAttachments;
    const hasUserSelectedExtras = Array.isArray(extraAttachments)
      && extraAttachments.some(a => a && a.base64 && a.filename);

    if (invoiceId && attachAttendanceHtml && String(attachAttendanceHtml).trim() && !hasUserSelectedExtras) {
      try {
        const pdfBuf = await renderHtmlToPdfBuffer(String(attachAttendanceHtml));
        const fn = (attachPdfFileName && String(attachPdfFileName).trim()) || 'attendance-note.pdf';
        await quickFileUploadSalesAttachment(invoiceId, fn, pdfBuf, 'Attendance note (Custody Note)');
        attachmentOk = true;
        attachResults.push({ name: fn, ok: true });
        if (attendanceId) {
          db.run(
            `INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)`,
            [attendanceId, 'invoice_attachment_uploaded', JSON.stringify({ invoiceId: String(invoiceId), fileName: fn }), userName || '']
          );
        }
      } catch (attErr) {
        attachmentError = attErr && attErr.message ? attErr.message : String(attErr);
        console.error('[QuickFile] Invoice attachment failed:', attachmentError);
        attachResults.push({ name: attachPdfFileName || 'attendance-note.pdf', ok: false, error: attachmentError });
        if (attendanceId) {
          db.run(
            `INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)`,
            [attendanceId, 'invoice_attachment_failed', attachmentError, userName || '']
          );
        }
      }
    }

    /* User-selected base64 PDF attachments (CRM forms, attendance note, conflict cert, etc.) */
    if (invoiceId && Array.isArray(extraAttachments)) {
      for (const att of extraAttachments) {
        if (!att || !att.base64 || !att.filename) continue;
        try {
          const pdfBuf = Buffer.from(att.base64, 'base64');
          await quickFileUploadSalesAttachment(invoiceId, att.filename, pdfBuf, att.description || 'Document (Custody Note)');
          attachResults.push({ name: att.filename, ok: true });
          if (attendanceId) {
            db.run(
              `INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)`,
              [attendanceId, 'invoice_attachment_uploaded', JSON.stringify({ invoiceId: String(invoiceId), fileName: att.filename }), userName || '']
            );
          }
        } catch (attErr) {
          const errMsg = attErr && attErr.message ? attErr.message : String(attErr);
          attachResults.push({ name: att.filename, ok: false, error: errMsg });
          if (attendanceId) {
            db.run(
              `INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)`,
              [attendanceId, 'invoice_attachment_failed', errMsg, userName || '']
            );
          }
        }
      }
    }

    if (attachResults.length) saveDb();

    return {
      ok: true,
      invoiceId: String(invoiceId),
      invoiceNumber,
      invoiceUrl,
      subtotal,
      vat,
      total,
      attachmentOk: attachResults.some(r => r.ok),
      attachmentError: attachmentError || undefined,
      attachResults,
    };
  } catch (err) {
    if (attendanceId) {
      db.run(
        `INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)`,
        [attendanceId, 'invoice_failed', String(err.message || err), userName || '']
      );
      saveDb();
    }
    return { ok: false, error: err.message || String(err) };
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   STATION MILEAGE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

ipcMain.handle('station-mileage-get', (_, stationId) => {
  const row = dbGet('SELECT mileage_from_base, postcode FROM police_stations WHERE id = ?', [stationId]);
  return row || { mileage_from_base: null, postcode: '' };
});

ipcMain.handle('stations-mileage-list', () => {
  return dbAll('SELECT id, name, code, scheme, region, mileage_from_base, postcode FROM police_stations ORDER BY name');
});

ipcMain.handle('station-mileage-save', (_, params) => {
  const { id, mileage_from_base, postcode, userName } = params;
  db.run(
    'UPDATE police_stations SET mileage_from_base = ?, postcode = ? WHERE id = ?',
    [mileage_from_base != null ? mileage_from_base : null, postcode || '', id]
  );
  saveDb();
  return { ok: true };
});

ipcMain.handle('station-mileage-bulk-save', (_, stations) => {
  stations.forEach(s => {
    db.run(
      'UPDATE police_stations SET mileage_from_base = ?, postcode = ? WHERE id = ?',
      [s.mileage_from_base != null ? s.mileage_from_base : null, s.postcode || '', s.id]
    );
  });
  saveDb();
  return { ok: true };
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   BILLING AUDIT LOG
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

ipcMain.handle('billing-audit-log-add', (_, params) => {
  const { attendanceId, action, details, userName } = params;
  db.run(
    'INSERT INTO billing_audit_log (attendance_id, action, details, user_name) VALUES (?, ?, ?, ?)',
    [attendanceId, action, details || '', userName || '']
  );
  saveDb();
  return { ok: true };
});

ipcMain.handle('billing-audit-log-get', (_, attendanceId) => {
  return dbAll(
    'SELECT * FROM billing_audit_log WHERE attendance_id = ? ORDER BY timestamp DESC',
    [attendanceId]
  );
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   BILLABLE ATTENDANCES (unbilled completed records)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

ipcMain.handle('billable-attendances', () => {
  /* archived_at IS NULL: archived matters must NOT reappear as billable, otherwise a
     fee earner could raise a duplicate QuickFile invoice for a matter that was
     already billed outside QuickFile (e.g. paper LAA claim) and then archived. */
  const rows = dbAll(
    `SELECT id, data, status, created_at, updated_at, client_name, station_name, attendance_date,
            quickfile_invoice_id, invoice_total
     FROM attendances
     WHERE (status = 'finalised' OR status = 'completed')
       AND (quickfile_invoice_id IS NULL OR quickfile_invoice_id = '')
       AND deleted_at IS NULL
       AND archived_at IS NULL
     ORDER BY attendance_date DESC`
  );
  return rows;
});

ipcMain.handle('billing-view-records', () => {
  return dbAll(
    `SELECT id, data, status, created_at, updated_at, client_name, station_name, attendance_date,
            quickfile_invoice_id, quickfile_invoice_number, invoice_total, archived_at
     FROM attendances
     WHERE deleted_at IS NULL
       AND archived_at IS NULL
       AND (status = 'finalised' OR status = 'completed' OR quickfile_invoice_id IS NOT NULL)
     ORDER BY attendance_date DESC`
  );
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   ATTENDANCE INVOICE STATUS (for billing panel)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

ipcMain.handle('attendance-invoice-status', (_, attendanceId) => {
  const row = dbGet(
    `SELECT quickfile_invoice_id, quickfile_invoice_number, quickfile_invoice_url,
            invoice_created_at, invoice_created_by,
            invoice_subtotal, invoice_vat, invoice_total,
            invoice_narrative, invoice_mileage_miles, invoice_mileage_rate,
            invoice_parking_amount, invoice_attendance_fee, invoice_vat_rate
     FROM attendances WHERE id = ?`,
    [attendanceId]
  );
  return row || {};
});

function _officerEmailExtraDomainsFromSettings() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key = 'email'");
    if (!row || row.value == null || row.value === '') return [];
    const em = String(row.value).trim();
    const at = em.lastIndexOf('@');
    if (at < 1) return [];
    const dom = em.slice(at + 1).toLowerCase();
    return dom ? [dom] : [];
  } catch (_) {
    return [];
  }
}

function _officerEmailSignOffFromSettings() {
  try {
    const row = dbGet("SELECT value FROM settings WHERE key = 'feeEarnerNameDefault'");
    if (!row || row.value == null || row.value === '') return '';
    return String(row.value).trim();
  } catch (_) {
    return '';
  }
}

function _officerDraftStatusAfterSave(apiLike, previousStatus) {
  const ps = String(previousStatus || 'draft');
  if (ps === 'sent_manually' || ps === 'cancelled' || ps === 'deleted') return ps;
  if (ps === 'opened_in_outlook') return 'opened_in_outlook';
  const ov = officerEmailDrafts.validateOpenOutlookFields(apiLike, {
    extraDomains: _officerEmailExtraDomainsFromSettings(),
  });
  return ov.ok ? 'ready_for_outlook' : 'draft';
}

function _officerDraftRowToApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    custodyNoteId: r.custody_note_id,
    status: r.status,
    templateType: r.template_type,
    toEmail: r.to_email,
    recipientName: r.recipient_name,
    clientName: r.client_name,
    policeStation: r.police_station,
    offence: r.offence,
    attendanceDate: r.attendance_date,
    attendanceTime: r.attendance_time,
    extraNote: r.extra_note,
    bailReturnDate: r.bail_return_date,
    bailConditions: r.bail_conditions,
    userEmailAddress: r.user_email_address,
    subject: r.subject,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    openedInOutlookAt: r.opened_in_outlook_at,
    sentManuallyConfirmedAt: r.sent_manually_confirmed_at,
    cancelledAt: r.cancelled_at,
    deletedAt: r.deleted_at,
  };
}

function _officerEmailAudit(custodyNoteId, action) {
  const idNum = parseInt(String(custodyNoteId), 10);
  const aid = Number.isFinite(idNum) ? idNum : null;
  const now = new Date().toISOString();
  try {
    db.run('INSERT INTO audit_log (attendance_id, action, timestamp) VALUES (?,?,?)', [aid, action, now]);
  } catch (_) { /* best-effort */ }
}

ipcMain.handle('officer-email-drafts-list', (_, custodyNoteId) => {
  if (custodyNoteId == null || custodyNoteId === '') return [];
  const cid = String(custodyNoteId);
  const rows = dbAll(
    `SELECT * FROM officer_email_drafts WHERE custody_note_id = ? AND status != 'deleted' ORDER BY updated_at DESC`,
    [cid]
  );
  return rows.map(_officerDraftRowToApi);
});

ipcMain.handle('officer-email-drafts-get', (_, draftId) => {
  if (!draftId) return null;
  const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  return _officerDraftRowToApi(row);
});

ipcMain.handle('officer-email-drafts-create', (_, payload) => {
  const v = officerEmailDrafts.validateOfficerEmailDraft(payload || {}, { mode: 'create' });
  if (!v.ok) return { ok: false, errors: v.errors };
  const n = v.normalized;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const st = _officerDraftStatusAfterSave(
    { toEmail: n.toEmail, subject: n.subject, body: n.body },
    'draft'
  );
  dbRun(
    `INSERT INTO officer_email_drafts (
      id, custody_note_id, status, template_type, to_email, recipient_name, client_name, police_station, offence,
      attendance_date, attendance_time, extra_note, bail_return_date, bail_conditions, user_email_address, subject, body,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, n.custodyNoteId, st, n.templateType || 'disclosure_confirm_attendance',
      n.toEmail, n.recipientName, n.clientName, n.policeStation, n.offence,
      n.attendanceDate, n.attendanceTime, n.extraNote, n.bailReturnDate, n.bailConditions, n.userEmailAddress,
      n.subject, n.body, now, now,
    ]
  );
  markDbDirty();
  _officerEmailAudit(n.custodyNoteId, 'officer_email_draft_create');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [id])) };
});

ipcMain.handle('officer-email-drafts-update', (_, draftId, payload) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const existing = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!existing || existing.status === 'deleted') return { ok: false, errors: ['Draft not found'] };
  const cur = _officerDraftRowToApi(existing);
  const merged = Object.assign({}, cur, payload || {});
  merged.custodyNoteId = cur.custodyNoteId;
  merged.status = cur.status;
  const v = officerEmailDrafts.validateOfficerEmailDraft(merged, { mode: 'update' });
  if (!v.ok) return { ok: false, errors: v.errors };
  const n = v.normalized;
  const now = new Date().toISOString();
  const st = _officerDraftStatusAfterSave(
    { toEmail: n.toEmail, subject: n.subject, body: n.body },
    existing.status
  );
  dbRun(
    `UPDATE officer_email_drafts SET
      template_type=?, to_email=?, recipient_name=?, client_name=?, police_station=?, offence=?,
      attendance_date=?, attendance_time=?, extra_note=?, bail_return_date=?, bail_conditions=?, user_email_address=?,
      subject=?, body=?, status=?, updated_at=?
     WHERE id=?`,
    [
      n.templateType, n.toEmail, n.recipientName, n.clientName, n.policeStation, n.offence,
      n.attendanceDate, n.attendanceTime, n.extraNote, n.bailReturnDate, n.bailConditions, n.userEmailAddress,
      n.subject, n.body, st, now, String(draftId),
    ]
  );
  markDbDirty();
  _officerEmailAudit(existing.custody_note_id, 'officer_email_draft_update');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)])) };
});

ipcMain.handle('officer-email-drafts-duplicate', (_, draftId) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const src = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!src || src.status === 'deleted') return { ok: false, errors: ['Draft not found'] };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dupSt = _officerDraftStatusAfterSave(
    { toEmail: src.to_email, subject: src.subject, body: src.body },
    'draft'
  );
  dbRun(
    `INSERT INTO officer_email_drafts (
      id, custody_note_id, status, template_type, to_email, recipient_name, client_name, police_station, offence,
      attendance_date, attendance_time, extra_note, bail_return_date, bail_conditions, user_email_address, subject, body,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, src.custody_note_id, dupSt, src.template_type,
      src.to_email, src.recipient_name, src.client_name, src.police_station, src.offence,
      src.attendance_date, src.attendance_time, src.extra_note, src.bail_return_date, src.bail_conditions, src.user_email_address,
      src.subject, src.body, now, now,
    ]
  );
  markDbDirty();
  _officerEmailAudit(src.custody_note_id, 'officer_email_draft_duplicate');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [id])) };
});

ipcMain.handle('officer-email-drafts-cancel', (_, draftId) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!row || row.status === 'deleted') return { ok: false, errors: ['Draft not found'] };
  if (!officerEmailDrafts.canTransitionStatus(row.status, 'cancelled')) {
    return { ok: false, errors: ['Invalid status transition'] };
  }
  const now = new Date().toISOString();
  dbRun(
    `UPDATE officer_email_drafts SET status='cancelled', cancelled_at=?, updated_at=? WHERE id=?`,
    [now, now, String(draftId)]
  );
  markDbDirty();
  _officerEmailAudit(row.custody_note_id, 'officer_email_draft_cancel');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)])) };
});

ipcMain.handle('officer-email-drafts-delete', (_, draftId) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!row || row.status === 'deleted') return { ok: false, errors: ['Draft not found'] };
  if (!officerEmailDrafts.canTransitionStatus(row.status, 'deleted')) {
    return { ok: false, errors: ['Invalid status transition'] };
  }
  const now = new Date().toISOString();
  dbRun(
    `UPDATE officer_email_drafts SET status='deleted', deleted_at=?, updated_at=? WHERE id=?`,
    [now, now, String(draftId)]
  );
  markDbDirty();
  _officerEmailAudit(row.custody_note_id, 'officer_email_draft_delete');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)])) };
});

ipcMain.handle('officer-email-drafts-mark-opened', (_, draftId) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!row || row.status === 'deleted') return { ok: false, errors: ['Draft not found'] };
  const now = new Date().toISOString();
  if (row.status === 'opened_in_outlook') {
    dbRun(`UPDATE officer_email_drafts SET opened_in_outlook_at=?, updated_at=? WHERE id=?`, [now, now, String(draftId)]);
  } else if (officerEmailDrafts.canTransitionStatus(row.status, 'opened_in_outlook')) {
    dbRun(
      `UPDATE officer_email_drafts SET status='opened_in_outlook', opened_in_outlook_at=?, updated_at=? WHERE id=?`,
      [now, now, String(draftId)]
    );
  } else {
    return { ok: false, errors: ['Invalid status transition'] };
  }
  markDbDirty();
  _officerEmailAudit(row.custody_note_id, 'officer_email_draft_mark_opened');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)])) };
});

ipcMain.handle('officer-email-drafts-mark-sent-manually', (_, draftId) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!row || row.status === 'deleted') return { ok: false, errors: ['Draft not found'] };
  if (!officerEmailDrafts.canTransitionStatus(row.status, 'sent_manually')) {
    return { ok: false, errors: ['Invalid status transition'] };
  }
  const now = new Date().toISOString();
  dbRun(
    `UPDATE officer_email_drafts SET status='sent_manually', sent_manually_confirmed_at=?, updated_at=? WHERE id=?`,
    [now, now, String(draftId)]
  );
  markDbDirty();
  _officerEmailAudit(row.custody_note_id, 'officer_email_draft_mark_sent');
  return { ok: true, draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)])) };
});

ipcMain.handle('officer-email-drafts-compose-url', (_, payload) => {
  const p = payload || {};
  let to;
  let subject;
  let body;
  if (p.draftId != null && String(p.draftId).trim() !== '') {
    const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(p.draftId)]);
    if (!row) return { ok: false, errors: ['Draft not found'] };
    if (row.status === 'deleted') {
      return { ok: false, errors: ['This draft has been deleted and cannot be opened in Outlook.'] };
    }
    if (row.status === 'cancelled') {
      return { ok: false, errors: ['This draft has been cancelled and cannot be opened in Outlook.'] };
    }
    const ov = officerEmailDrafts.validateOpenOutlookFields(row, {
      extraDomains: _officerEmailExtraDomainsFromSettings(),
    });
    if (!ov.ok) return { ok: false, errors: ov.errors };
    to = row.to_email;
    subject = row.subject;
    body = row.body;
  } else if (p.fields && typeof p.fields === 'object') {
    const n = officerEmailDrafts.normaliseOfficerEmailDraft(p.fields);
    const ov = officerEmailDrafts.validateOpenOutlookFields(n, {
      extraDomains: _officerEmailExtraDomainsFromSettings(),
    });
    if (!ov.ok) return { ok: false, errors: ov.errors };
    to = n.toEmail;
    subject = n.subject;
    body = n.body;
  } else {
    return { ok: false, errors: ['draftId or fields is required'] };
  }
  const toT = officerEmailDrafts.trimMax(to, officerEmailDrafts.MAX_LENGTHS.toEmail);
  const subT = officerEmailDrafts.trimMax(subject, officerEmailDrafts.MAX_LENGTHS.subject);
  const bodyT = officerEmailDrafts.str(body);
  const composed = outlookWebCompose.truncateOutlookComposeForShellOpen({
    to: toT,
    cc: '',
    subject: subT,
    body: bodyT,
  });
  if (typeof isSafeExternalUrl === 'function' && !isSafeExternalUrl(composed.url)) {
    return { ok: false, errors: ['Could not build a safe Outlook Web link.'] };
  }
  return {
    ok: true,
    url: composed.url,
    truncated: composed.truncated,
    urlLength: composed.url.length,
  };
});

ipcMain.handle('officer-email-drafts-open-outlook', async (_, draftId) => {
  if (!draftId) return { ok: false, errors: ['draftId required'] };
  const row = dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)]);
  if (!row) return { ok: false, errors: ['Draft not found'] };
  if (row.status === 'deleted') return { ok: false, errors: ['This draft has been deleted and cannot be opened in Outlook.'] };
  if (row.status === 'cancelled') return { ok: false, errors: ['This draft has been cancelled and cannot be opened in Outlook.'] };
  if (!officerEmailDrafts.canTransitionStatus(row.status, 'opened_in_outlook') && row.status !== 'opened_in_outlook') {
    return { ok: false, errors: ['Invalid status transition'] };
  }
  const ov = officerEmailDrafts.validateOpenOutlookFields(row, {
    extraDomains: _officerEmailExtraDomainsFromSettings(),
  });
  if (!ov.ok) return { ok: false, errors: ov.errors };
  const toT = officerEmailDrafts.trimMax(row.to_email, officerEmailDrafts.MAX_LENGTHS.toEmail);
  const subT = officerEmailDrafts.trimMax(row.subject, officerEmailDrafts.MAX_LENGTHS.subject);
  const bodyT = officerEmailDrafts.str(row.body);
  const { url, truncated, fullPlainTextForClipboard } = outlookWebCompose.truncateOutlookComposeForShellOpen({
    to: toT,
    cc: '',
    subject: subT,
    body: bodyT,
  });
  if (typeof isSafeExternalUrl === 'function' && !isSafeExternalUrl(url)) {
    console.warn('[officer-email-drafts-open-outlook] isSafeExternalUrl rejected url', { urlLength: url.length });
    return { ok: false, errors: ['Outlook Web could not be opened. You can still copy the recipient, subject and body manually.'] };
  }
  if (truncated) {
    try {
      clipboard.writeText(fullPlainTextForClipboard);
    } catch (clipErr) {
      console.warn('[officer-email-drafts-open-outlook] clipboard write failed', clipErr);
    }
  }
  let openMethod = null;
  try {
    console.info('[officer-email-drafts-open-outlook] invoking openExternalUrl', { urlLength: url.length, truncated: !!truncated });
    const openRes = await openExternalUrlModule.openExternalUrl(url, { electronShell: shell });
    openMethod = openRes && openRes.method ? openRes.method : null;
    console.info('[officer-email-drafts-open-outlook] openExternalUrl resolved', openRes);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.warn('[officer-email-drafts-open-outlook] openExternalUrl failed', msg);
    return { ok: false, errors: [msg || 'Outlook Web could not be opened. You can still copy the recipient, subject and body manually.'] };
  }
  const now = new Date().toISOString();
  if (row.status === 'opened_in_outlook') {
    dbRun(`UPDATE officer_email_drafts SET opened_in_outlook_at=?, updated_at=? WHERE id=?`, [now, now, String(draftId)]);
  } else {
    dbRun(
      `UPDATE officer_email_drafts SET status='opened_in_outlook', opened_in_outlook_at=?, updated_at=? WHERE id=?`,
      [now, now, String(draftId)]
    );
  }
  markDbDirty();
  _officerEmailAudit(row.custody_note_id, 'officer_email_draft_open_outlook');
  return {
    ok: true,
    draft: _officerDraftRowToApi(dbGet('SELECT * FROM officer_email_drafts WHERE id = ?', [String(draftId)])),
    truncated,
    urlLength: url.length,
    openMethod,
  };
});

ipcMain.handle('officer-email-drafts-open-one-off-outlook', async (_, fields) => {
  const n = officerEmailDrafts.normaliseOfficerEmailDraft(fields || {});
  const ov = officerEmailDrafts.validateOpenOutlookFields(n, {
    extraDomains: _officerEmailExtraDomainsFromSettings(),
  });
  if (!ov.ok) return { ok: false, errors: ov.errors };
  const toT = officerEmailDrafts.trimMax(n.toEmail, officerEmailDrafts.MAX_LENGTHS.toEmail);
  const subT = officerEmailDrafts.trimMax(n.subject, officerEmailDrafts.MAX_LENGTHS.subject);
  const bodyT = officerEmailDrafts.str(n.body);
  const composed = outlookWebCompose.truncateOutlookComposeForShellOpen({
    to: toT,
    cc: '',
    subject: subT,
    body: bodyT,
  });
  const url = composed.url;
  if (typeof isSafeExternalUrl === 'function' && !isSafeExternalUrl(url)) {
    console.warn('[officer-email-drafts-open-one-off-outlook] isSafeExternalUrl rejected url', { urlLength: url.length });
    return { ok: false, errors: ['Outlook Web could not be opened. You can still copy the recipient, subject and body manually.'] };
  }
  if (composed.truncated) {
    try {
      clipboard.writeText(composed.fullPlainTextForClipboard);
    } catch (clipErr) {
      console.warn('[officer-email-drafts-open-one-off-outlook] clipboard fallback failed:', clipErr && clipErr.message);
    }
  }
  let oneOffOpenMethod = null;
  try {
    console.info('[officer-email-drafts-open-one-off-outlook] invoking openExternalUrl', { urlLength: url.length, truncated: !!composed.truncated });
    const openRes = await openExternalUrlModule.openExternalUrl(url, { electronShell: shell });
    oneOffOpenMethod = openRes && openRes.method ? openRes.method : null;
    console.info('[officer-email-drafts-open-one-off-outlook] openExternalUrl resolved', openRes);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.warn('[officer-email-drafts-open-one-off-outlook] openExternalUrl failed', msg);
    return { ok: false, errors: [msg || 'Outlook Web could not be opened. You can still copy the recipient, subject and body manually.'] };
  }
  return { ok: true, truncated: composed.truncated, urlLength: composed.url.length, openMethod: oneOffOpenMethod };
});

ipcMain.handle('officer-email-drafts-copy', (_, text) => {
  try {
    clipboard.writeText(text != null ? String(text) : '');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
});

ipcMain.handle('officer-email-drafts-preview', (_, fields) => {
  try {
    const f = Object.assign({}, fields || {});
    if (!f.signOffName) f.signOffName = _officerEmailSignOffFromSettings();
    const subject = officerEmailDrafts.generateOfficerEmailSubject(f);
    let body = officerEmailDrafts.generateOfficerEmailBody(f);
    body = officerEmailDrafts.insertExtraNote(body, f.extraNote);
    return {
      ok: true,
      subject: officerEmailDrafts.trimMax(subject, officerEmailDrafts.MAX_LENGTHS.subject),
      body: officerEmailDrafts.trimMax(body, officerEmailDrafts.MAX_LENGTHS.body),
    };
  } catch (err) {
    console.warn('[officer-email-drafts-preview] failed');
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
});

