'use strict';

/**
 * Post-write verification for encrypted CNDB backup files.
 * Does not decrypt note bodies — only magic header + size checks.
 */

const fs = require('fs');
const { MAGIC, isEncrypted } = require('./dbCrypto');

/**
 * @param {string} filePath
 * @param {{ expectedBytes?: number, minBytes?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string, bytes?: number, magicOk?: boolean }}
 */
function verifyEncryptedBackupFile(filePath, opts = {}) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, reason: 'missing_path' };
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return { ok: false, reason: 'missing_file', error: err && err.message ? err.message : String(err) };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: 'not_a_file' };
  }
  const bytes = stat.size;
  const minBytes = opts.minBytes != null ? Number(opts.minBytes) : 4;
  if (!Number.isFinite(bytes) || bytes < minBytes) {
    return { ok: false, reason: 'too_small', bytes };
  }
  if (opts.expectedBytes != null && Number(opts.expectedBytes) !== bytes) {
    return { ok: false, reason: 'size_mismatch', bytes, expectedBytes: Number(opts.expectedBytes) };
  }
  let header;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      header = Buffer.alloc(4);
      const read = fs.readSync(fd, header, 0, 4, 0);
      if (read < 4) {
        return { ok: false, reason: 'short_read', bytes };
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return { ok: false, reason: 'read_failed', bytes, error: err && err.message ? err.message : String(err) };
  }
  const magicOk = isEncrypted(header) || header.slice(0, 4).toString() === MAGIC;
  if (!magicOk) {
    return { ok: false, reason: 'bad_magic', bytes, magicOk: false };
  }
  return { ok: true, bytes, magicOk: true, verifiedAt: new Date().toISOString() };
}

module.exports = {
  verifyEncryptedBackupFile,
};
