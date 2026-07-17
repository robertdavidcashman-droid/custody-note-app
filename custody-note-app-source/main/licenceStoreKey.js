/**
 * Licence store encryption key management.
 * Uses Electron safeStorage (OS keychain) for key persistence.
 * Key never stored in renderer, config, or logs.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SERVICE = 'CustodyNote';
const ACCOUNT = 'db_key';
const FALLBACK_FILENAME = 'licence-store.key';

function getKeyPath(app) {
  return path.join(app.getPath('userData'), FALLBACK_FILENAME);
}

function getLicenceStoreKey(app, safeStorage) {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const keyPath = getKeyPath(app);
    if (fs.existsSync(keyPath)) {
      try {
        const enc = fs.readFileSync(keyPath);
        const dec = safeStorage.decryptString(enc);
        const buf = Buffer.from(dec, 'hex');
        if (buf.length === 32) return buf;
      } catch (e) {
        console.warn('[LicenceStore] Cannot decrypt key:', e.message);
      }
    }
    const key = crypto.randomBytes(32);
    try {
      const enc = safeStorage.encryptString(key.toString('hex'));
      fs.writeFileSync(keyPath, enc);
    } catch (e) {
      console.error('[LicenceStore] Failed to persist key:', e.message);
    }
    return key;
  }
  // H30 — previous fallback wrote the 32-byte AES key as hex-plaintext into
  // userData when safeStorage was unavailable, which effectively defeated
  // the licence-store encryption. Refuse to run the admin store in that
  // state and surface a clear error; operations can still work (safeStorage
  // is available on Windows/macOS/most Linux keyrings out of the box) and
  // admins running in an unusual session can enable the OS credential
  // service or sign in interactively.
  const err = new Error(
    'Licence store requires an OS secure-storage service (safeStorage). ' +
    'Sign in to the desktop session or enable the Credential Manager / Keychain / libsecret to use admin features.'
  );
  err.code = 'CN_NO_SAFE_STORAGE';
  throw err;
}

module.exports = { getLicenceStoreKey };
