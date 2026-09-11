'use strict';

/**
 * lib/masterKey.js
 * ----------------------------------------------------------------------------
 * Master-key resolution for the at-rest attendance DB (encryption.key /
 * master.fallback / recovery). Extracted from main.js so Mac→Windows
 * safeStorage failures can be unit-tested without Electron.
 *
 * Preserve-first rules:
 *   - If encryption.key exists but cannot be decrypted (or yields an invalid
 *     key), quarantine it and return null when allowCreate is false.
 *   - Never mint a replacement master key in the same call that found an
 *     unreadable key file — that bricks an existing CNDB by writing a
 *     readable-but-wrong Windows key that skips the recovery prompt.
 *   - Existing CNDB unlock must go through recovery password (or a clear
 *     error asking for one), never a fresh random key.
 */

const path = require('path');

function isValidMasterKeyHex(value) {
  return typeof value === 'string'
    && value.length === 64
    && /^[0-9a-f]+$/i.test(value);
}

/**
 * Move an unreadable encryption.key aside. Never deletes user key material.
 * @returns {string|null} quarantine path, or null if rename failed / missing
 */
function quarantineUnreadableKeyFile(fsApi, keyPath, nowMs = Date.now()) {
  if (!fsApi || !keyPath || typeof fsApi.existsSync !== 'function') return null;
  if (!fsApi.existsSync(keyPath)) return null;
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const dest = keyPath + '.unreadable-' + stamp;
  try {
    fsApi.renameSync(keyPath, dest);
    return dest;
  } catch (err) {
    // Last resort: copy then unlink source only if copy succeeded — still
    // preserve a copy. Prefer rename; if that fails, leave the original.
    try {
      fsApi.copyFileSync(keyPath, dest);
      return dest;
    } catch (_) {
      return null;
    }
  }
}

/**
 * Resolve the local master key.
 *
 * @param {object} deps
 * @param {boolean} [deps.allowCreate=true]
 * @param {string} deps.keyPath
 * @param {string} deps.fallbackPath
 * @param {{ isEncryptionAvailable: Function, decryptString: Function }|null} deps.safeStorage
 * @param {object} deps.fs  subset: existsSync, readFileSync, renameSync, copyFileSync
 * @param {(buf: Buffer) => string|null} deps.decryptFallbackKey
 * @param {() => string} deps.createRandomKey
 * @param {(hex: string) => void} deps.persistNewKey  write encryption.key / fallback
 * @param {{ warn?: Function, info?: Function }} [deps.logger]
 * @param {number} [deps.nowMs]
 * @returns {{ key: string|null, quarantinedKeyPath: string|null, created: boolean, reason: string }}
 */
function resolveMasterKey(deps) {
  const allowCreate = deps.allowCreate !== false;
  const fsApi = deps.fs;
  const keyPath = deps.keyPath;
  const fallbackPath = deps.fallbackPath;
  const logger = deps.logger || {};
  const warn = typeof logger.warn === 'function' ? logger.warn.bind(logger) : () => {};
  const info = typeof logger.info === 'function' ? logger.info.bind(logger) : () => {};
  const nowMs = deps.nowMs != null ? deps.nowMs : Date.now();

  const tryLoadFallback = () => {
    if (!fallbackPath || !fsApi.existsSync(fallbackPath)) return null;
    try {
      const raw = fsApi.readFileSync(fallbackPath);
      const fromObfuscated = deps.decryptFallbackKey ? deps.decryptFallbackKey(raw) : null;
      if (isValidMasterKeyHex(fromObfuscated)) {
        return { key: fromObfuscated, fromPlaintext: false };
      }
      // Legacy plaintext fallback (pre-obfuscation upgrade)
      const plaintext = Buffer.isBuffer(raw) ? raw.toString('utf8').trim() : String(raw || '').trim();
      if (isValidMasterKeyHex(plaintext)) {
        return { key: plaintext, fromPlaintext: true };
      }
    } catch (err) {
      warn('[Encryption] Cannot read fallback key:', err && err.message ? err.message : err);
    }
    return null;
  };

  const safeStorage = deps.safeStorage;
  const safeAvailable = !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
    && safeStorage.isEncryptionAvailable());

  if (safeAvailable) {
    let quarantinedKeyPath = null;
    let sawUnreadableKeyFile = false;

    if (fsApi.existsSync(keyPath)) {
      try {
        const decrypted = safeStorage.decryptString(fsApi.readFileSync(keyPath));
        if (isValidMasterKeyHex(decrypted)) {
          return { key: decrypted, quarantinedKeyPath: null, created: false, reason: 'safeStorage' };
        }
        warn('[Encryption] safeStorage key decrypted but is not a valid 64-char hex master key');
        sawUnreadableKeyFile = true;
        quarantinedKeyPath = quarantineUnreadableKeyFile(fsApi, keyPath, nowMs);
        if (quarantinedKeyPath) {
          info('[Encryption] Quarantined unusable encryption.key →', path.basename(quarantinedKeyPath));
        }
      } catch (err) {
        warn('[Encryption] Cannot decrypt safeStorage key (new machine?):', err && err.message ? err.message : err);
        sawUnreadableKeyFile = true;
        quarantinedKeyPath = quarantineUnreadableKeyFile(fsApi, keyPath, nowMs);
        if (quarantinedKeyPath) {
          info('[Encryption] Quarantined unusable encryption.key →', path.basename(quarantinedKeyPath));
        }
      }
    }

    const fallback = tryLoadFallback();
    if (fallback) {
      return {
        key: fallback.key,
        quarantinedKeyPath,
        created: false,
        reason: sawUnreadableKeyFile ? 'fallback_after_unreadable_key' : 'fallback',
        legacyPlaintextFallback: !!fallback.fromPlaintext,
      };
    }

    // Unreadable key present (now quarantined): NEVER mint a replacement here.
    // A new readable key would skip recovery and brick an existing CNDB.
    if (sawUnreadableKeyFile) {
      return {
        key: null,
        quarantinedKeyPath,
        created: false,
        reason: 'unreadable_key_quarantined',
      };
    }

    if (!allowCreate) {
      return { key: null, quarantinedKeyPath: null, created: false, reason: 'missing' };
    }

    const fresh = deps.createRandomKey();
    deps.persistNewKey(fresh);
    return { key: fresh, quarantinedKeyPath: null, created: true, reason: 'created' };
  }

  // safeStorage unavailable — obfuscated fallback only.
  warn('[Encryption] safeStorage unavailable; using obfuscated fallback. Set a recovery password in Settings.');
  const fallback = tryLoadFallback();
  if (fallback) {
    return {
      key: fallback.key,
      quarantinedKeyPath: null,
      created: false,
      reason: 'fallback_no_safeStorage',
      legacyPlaintextFallback: !!fallback.fromPlaintext,
    };
  }
  if (!allowCreate) {
    return { key: null, quarantinedKeyPath: null, created: false, reason: 'missing' };
  }
  const fresh = deps.createRandomKey();
  deps.persistNewKey(fresh);
  return { key: fresh, quarantinedKeyPath: null, created: true, reason: 'created_fallback' };
}

const RECOVERY_REQUIRED_MESSAGE =
  'Cannot decrypt the attendance database: the encryption key for this machine is missing or unreadable. '
  + 'Enter your recovery password (Settings → recovery password), and ensure recovery.dat is present next to attendances.db. '
  + 'Your records have not been deleted.';

const RECOVERY_CANCELLED_MESSAGE =
  'Database unlock was cancelled. Your records are safe and have not been deleted. '
  + 'Restart Custody Note and enter your recovery password to unlock, or restore from a backup.';

const WRONG_KEY_RECOVERY_MESSAGE =
  'The local encryption key could not unlock the attendance database. '
  + 'If you copied data from another computer, enter your recovery password. '
  + 'Your records have not been deleted.';

/**
 * Decrypt a CNDB buffer using the local key, falling back to recovery password.
 * Never creates a master key. Never deletes attendances.db.
 *
 * @param {object} deps
 * @param {Buffer} deps.buf
 * @param {string} [deps.magic='CNDB']
 * @param {() => string|null} deps.getMasterKey  allowCreate:false resolver
 * @param {() => boolean} deps.hasRecoveryPassword
 * @param {() => Promise<string|null>} deps.promptForRecoveryPassword
 * @param {(hex: string) => void} deps.persistRecoveredKey
 * @param {(buf: Buffer, key: string) => Buffer} deps.decryptBuffer  throws on GCM fail
 * @returns {Promise<Buffer>}
 */
async function decryptBufferWithRecoveryFlow(deps) {
  const buf = deps.buf;
  const magic = deps.magic || 'CNDB';
  if (!buf || buf.length < 4) return buf;
  if (buf.slice(0, 4).toString() !== magic) return buf;

  let masterKeyHex = deps.getMasterKey();
  let promptedRecovery = false;

  const tryRecovery = async (why) => {
    if (!deps.hasRecoveryPassword()) return null;
    promptedRecovery = true;
    const recovered = await deps.promptForRecoveryPassword();
    if (recovered && isValidMasterKeyHex(recovered)) {
      deps.persistRecoveredKey(recovered);
      return recovered;
    }
    return null;
  };

  if (!masterKeyHex) {
    masterKeyHex = await tryRecovery('missing_key');
    if (!masterKeyHex) {
      const err = new Error(
        promptedRecovery ? RECOVERY_CANCELLED_MESSAGE : RECOVERY_REQUIRED_MESSAGE
      );
      err.code = promptedRecovery ? 'CN_RECOVERY_CANCELLED' : 'CN_RECOVERY_REQUIRED';
      throw err;
    }
  }

  try {
    return deps.decryptBuffer(buf, masterKeyHex);
  } catch (decryptErr) {
    // Wrong key on disk (e.g. a prior buggy launch wrote a fresh Windows key
    // over an unreadable Mac key). If recovery.dat exists, offer recovery
    // instead of surfacing a raw GCM auth error alone.
    if (!promptedRecovery && deps.hasRecoveryPassword()) {
      const recovered = await tryRecovery('decrypt_failed');
      if (recovered) {
        try {
          return deps.decryptBuffer(buf, recovered);
        } catch (_) {
          /* fall through to clear error */
        }
      }
      const err = new Error(promptedRecovery && !recovered
        ? RECOVERY_CANCELLED_MESSAGE
        : WRONG_KEY_RECOVERY_MESSAGE);
      err.code = 'CN_DECRYPT_FAILED';
      err.cause = decryptErr;
      throw err;
    }
    const err = new Error(
      deps.hasRecoveryPassword()
        ? WRONG_KEY_RECOVERY_MESSAGE
        : RECOVERY_REQUIRED_MESSAGE
    );
    err.code = 'CN_DECRYPT_FAILED';
    err.cause = decryptErr;
    throw err;
  }
}

module.exports = {
  isValidMasterKeyHex,
  quarantineUnreadableKeyFile,
  resolveMasterKey,
  decryptBufferWithRecoveryFlow,
  RECOVERY_REQUIRED_MESSAGE,
  RECOVERY_CANCELLED_MESSAGE,
  WRONG_KEY_RECOVERY_MESSAGE,
};
