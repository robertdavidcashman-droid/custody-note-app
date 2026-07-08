'use strict';

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 600000;
const PBKDF2_ITERATIONS_LEGACY = 100000;
const PBKDF2_DIGEST = 'sha256';

function escrowSalt(licenceKey) {
  return crypto.createHash('sha256').update('cn-escrow-salt:' + String(licenceKey).trim().toUpperCase()).digest();
}

function encryptMasterKeyForEscrow(masterKeyHex, licenceKey) {
  const salt = escrowSalt(licenceKey);
  const derived = crypto.pbkdf2Sync(String(licenceKey).trim().toUpperCase(), salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(masterKeyHex, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptMasterKeyFromEscrow(blob, licenceKey) {
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < 28) return null;
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const enc = raw.slice(28);
  const salt = escrowSalt(licenceKey);
  const tryWith = function (iters) {
    try {
      const derived = crypto.pbkdf2Sync(String(licenceKey).trim().toUpperCase(), salt, iters, 32, PBKDF2_DIGEST);
      const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString('utf8');
    } catch (_) {
      return null;
    }
  };
  return tryWith(PBKDF2_ITERATIONS) || tryWith(PBKDF2_ITERATIONS_LEGACY);
}

module.exports = {
  encryptMasterKeyForEscrow,
  decryptMasterKeyFromEscrow,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LEGACY,
};
