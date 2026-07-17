/**
 * Local admin authentication.
 * PBKDF2-SHA512 (310,000 iterations) for password hashing. Lockout after 5
 * failures. Admin session TTL 10 minutes idle. Header comment previously said
 * Argon2id — that was incorrect. PBKDF2 at this iteration count meets OWASP
 * 2023 minimums; consider migrating to Argon2id when the build can ship a
 * native module.
 *
 * All login attempts (success and failure) and lockouts are forwarded to the
 * append-only security event log if available.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let _securityLog = null;
try { _securityLog = require('./securityLog'); } catch (_) { _securityLog = null; }
function _audit(event, meta) {
  try { if (_securityLog && _securityLog.record) _securityLog.record(event, meta); }
  catch (_) {}
}

const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 10 * 60 * 1000;
const PBKDF2_ITERATIONS = 310000;
const HASH_FILE = 'admin-auth.dat';

let _adminSessionUntil = 0;
let _failedAttempts = 0;
let _lockoutUntil = 0;

function getHashPath(app) {
  return path.join(app.getPath('userData'), HASH_FILE);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512');
}

function createHash(password) {
  const salt = crypto.randomBytes(32);
  const hash = hashPassword(password, salt);
  return Buffer.concat([salt, hash]).toString('base64');
}

function verifyPassword(password, stored) {
  const buf = Buffer.from(stored, 'base64');
  const salt = buf.slice(0, 32);
  const expected = buf.slice(32);
  const actual = hashPassword(password, salt);
  return crypto.timingSafeEqual(expected, actual);
}

function hasAdminPassword(app) {
  const p = getHashPath(app);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}

function setAdminPassword(app, password, existingToken) {
  const setupToken = process.env.ADMIN_SETUP_TOKEN;
  if (hasAdminPassword(app) && !existingToken && (!setupToken || setupToken.length < 16)) {
    return { ok: false, error: 'Admin already configured. Use ADMIN_SETUP_TOKEN to reset.' };
  }
  if (hasAdminPassword(app) && existingToken !== setupToken) return { ok: false, error: 'Invalid token' };
  if (!hasAdminPassword(app) && setupToken && existingToken !== setupToken) return { ok: false, error: 'Invalid setup token' };
  const hash = createHash(password);
  fs.writeFileSync(getHashPath(app), hash, 'utf8');
  return { ok: true };
}

function checkLockout() {
  if (_lockoutUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((_lockoutUntil - Date.now()) / 1000) };
  }
  return { locked: false };
}

function login(app, password) {
  const lock = checkLockout();
  if (lock.locked) {
    _audit('admin_login_locked_out', { retryAfterSec: lock.retryAfter });
    return { ok: false, error: 'Locked out', retryAfter: lock.retryAfter };
  }

  if (!hasAdminPassword(app)) {
    _audit('admin_login_failure', { reason: 'admin_not_configured' });
    return { ok: false, error: 'Admin not configured' };
  }

  const stored = fs.readFileSync(getHashPath(app), 'utf8');
  if (!verifyPassword(password, stored)) {
    _failedAttempts++;
    if (_failedAttempts >= LOCKOUT_ATTEMPTS) {
      _lockoutUntil = Date.now() + LOCKOUT_MS;
      _failedAttempts = 0;
      _audit('admin_lockout', { lockoutMs: LOCKOUT_MS });
      return { ok: false, error: 'Locked out', retryAfter: LOCKOUT_MS / 1000 };
    }
    _audit('admin_login_failure', { reason: 'invalid_password', failedAttempts: _failedAttempts });
    return { ok: false, error: 'Invalid password' };
  }
  _failedAttempts = 0;
  _adminSessionUntil = Date.now() + SESSION_TTL_MS;
  _audit('admin_login_success');
  return { ok: true };
}

function extendSession() {
  _adminSessionUntil = Date.now() + SESSION_TTL_MS;
}

function isAdminSession() {
  return _adminSessionUntil > Date.now();
}

function requireAdmin() {
  if (!isAdminSession()) throw new Error('Admin session required');
  extendSession();
}

module.exports = {
  hasAdminPassword,
  setAdminPassword,
  login,
  isAdminSession,
  requireAdmin,
  extendSession,
  checkLockout,
};
