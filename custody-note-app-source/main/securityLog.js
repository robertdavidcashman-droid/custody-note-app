'use strict';

/**
 * main/securityLog.js
 * ----------------------------------------------------------------------------
 * Append-only on-disk log of security-relevant events for forensic review.
 *
 * What we log:
 *   - admin_login_success / admin_login_failure / admin_lockout
 *   - recovery_password_attempt / recovery_password_success / recovery_password_failure
 *   - session_lock / session_unlock_success / session_unlock_failure
 *   - ipc_trusted_frame_rejected
 *   - sync_auth_failure / api_url_rejected
 *   - permission_denied
 *   - power_lock_triggered
 *
 * What we never log:
 *   - the password / token itself
 *   - any custody-note content
 *   - any client/case identifier
 *
 * File: <userData>/security.log (rotated when > MAX_BYTES). Format: one
 * JSON object per line. Atomic append (single write call, ≤ MAX_LINE_BYTES).
 */

const fs = require('fs');
const path = require('path');
const safeLog = require('../lib/safeLog');

const MAX_BYTES = 1024 * 1024; // 1 MB before rotation
const MAX_LINE_BYTES = 4096;
const FILENAME = 'security.log';
const ROTATED_FILENAME = 'security.log.1';

let _userDataPath = null;

function init(userDataPath) { _userDataPath = userDataPath; }

function _filePath() {
  if (!_userDataPath) {
    try { _userDataPath = require('electron').app.getPath('userData'); }
    catch (_) { return null; }
  }
  return path.join(_userDataPath, FILENAME);
}

function _rotateIfNeeded(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st && st.size > MAX_BYTES) {
      const rotated = path.join(path.dirname(filePath), ROTATED_FILENAME);
      try { if (fs.existsSync(rotated)) fs.unlinkSync(rotated); } catch (_) {}
      try { fs.renameSync(filePath, rotated); } catch (_) {}
    }
  } catch (_) { /* file does not exist yet */ }
}

/**
 * Record one security event. Synchronous on purpose: we want events to be
 * persisted before the next thing happens, even if the app crashes.
 *
 * @param {string} event   Event identifier (e.g. 'admin_login_failure').
 * @param {object} [meta]  Small JSON-serialisable details. Will be redacted.
 */
function record(event, meta) {
  const filePath = _filePath();
  if (!filePath) return;
  try {
    _rotateIfNeeded(filePath);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event: String(event || 'unknown'),
      meta: meta ? safeLog.redact(meta) : undefined,
    });
    const truncated = line.length > MAX_LINE_BYTES
      ? line.slice(0, MAX_LINE_BYTES - 1) + '"'
      : line;
    fs.appendFileSync(filePath, truncated + '\n');
  } catch (e) {
    // Never throw — security logging must not break the calling flow.
    try { console.warn('[security-log] write failed:', e && e.message ? e.message : e); }
    catch (_) {}
  }
}

module.exports = { init, record };
