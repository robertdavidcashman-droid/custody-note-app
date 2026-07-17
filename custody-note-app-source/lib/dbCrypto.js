'use strict';

/**
 * lib/dbCrypto.js
 * ----------------------------------------------------------------------------
 * Pure, dependency-free AES-256-GCM helpers for the at-rest attendance DB.
 *
 * Extracted from main.js so the exact on-disk encryption format can be unit
 * tested under `node --test` WITHOUT booting Electron. main.js keeps ownership
 * of master-key resolution (safeStorage / recovery password / escrow) and
 * delegates only the raw crypto here. The byte layout is unchanged, so existing
 * encrypted user databases continue to decrypt identically:
 *
 *     [ MAGIC(4) | iv(12) | authTag(16) | ciphertext(...) ]
 *
 * SECURITY: encryptBuffer refuses (throws CN_NO_MASTER_KEY) when no key is
 * provided — confidential legal-aid data must never be written unencrypted.
 */

const crypto = require('crypto');

const MAGIC = 'CNDB';

/** True if the buffer carries our encryption envelope (magic header). */
function isEncrypted(buf) {
  return !!buf && buf.length >= 4 && buf.slice(0, 4).toString() === MAGIC;
}

/**
 * Encrypt a buffer with AES-256-GCM under the given hex master key.
 * @param {Buffer} buf
 * @param {string} masterKeyHex  64-char hex (32 bytes).
 * @returns {Buffer} MAGIC + iv + tag + ciphertext
 * @throws {Error} code CN_NO_MASTER_KEY when no key supplied.
 */
function encryptBuffer(buf, masterKeyHex) {
  if (!masterKeyHex) {
    const err = new Error('No master key available; refusing to write database unencrypted. Set a recovery password in Settings or restore from backup.');
    err.code = 'CN_NO_MASTER_KEY';
    throw err;
  }
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(MAGIC), iv, tag, encrypted]);
}

/**
 * Decrypt a buffer produced by encryptBuffer.
 * @param {Buffer} buf
 * @param {string} masterKeyHex
 * @returns {Buffer|null}
 *   - the original plaintext buffer on success,
 *   - the input buffer unchanged if it is NOT in our envelope format
 *     (legacy/plaintext passthrough, matching historic main.js behaviour),
 *   - null if the buffer is encrypted but no key was supplied.
 * @throws if the key is wrong / data is tampered (GCM auth failure).
 */
function decryptBuffer(buf, masterKeyHex) {
  if (!buf || buf.length < 4) return buf;
  if (buf.slice(0, 4).toString() !== MAGIC) return buf;
  if (!masterKeyHex) return null;
  const iv = buf.slice(4, 16);
  const tag = buf.slice(16, 32);
  const data = buf.slice(32);
  const key = Buffer.from(masterKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

module.exports = { MAGIC, isEncrypted, encryptBuffer, decryptBuffer };
