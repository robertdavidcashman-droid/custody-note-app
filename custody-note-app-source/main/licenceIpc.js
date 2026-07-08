/**
 * IPC handlers for licence admin and forgot-key.
 * All run in main process. Renderer never gets raw licence keys except via adminRevealLicence after auth.
 */
const { ipcMain } = require('electron');
const licenceStore = require('./licenceStore');
const adminAuth = require('./adminAuth');
const requestLicenceEmailRateLimit = require('./requestLicenceEmailRateLimit');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUERY_MAX_LEN = 100;
const GENERIC_SUCCESS = { success: true, message: 'If that email exists in our system, your licence code has been sent.' };

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim().toLowerCase());
}

// H28 — defence-in-depth: every privileged custody:* channel must come from
// a local, app-controlled frame. Any arbitrary http(s) URL the renderer
// might be tricked into loading must not be allowed to invoke admin IPC.
// The app is always served from a file:// index.html inside the install
// directory, and preload + contextIsolation already prevent cross-origin
// script access; this just hardens the default against regressions.
function _isTrustedFrame(event) {
  try {
    const frame = event && event.senderFrame;
    if (!frame) return false;
    const url = String(frame.url || '');
    if (!url) return false;
    // file:// from the app bundle is trusted. dev-server pages served over
    // http://localhost are trusted only in dev builds (never in packaged).
    if (url.startsWith('file://')) return true;
    if (process.env.CUSTODYNOTE_PACKAGED !== '1' && /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

// H29 — per-channel rate limiter used by session-unlock / admin-login style
// channels so credential stuffing over IPC doesn't get unbounded attempts.
const _rateLimiters = new Map();
function _checkChannelRateLimit(channel, max, windowMs) {
  const now = Date.now();
  let bucket = _rateLimiters.get(channel);
  if (!bucket) { bucket = []; _rateLimiters.set(channel, bucket); }
  while (bucket.length && (now - bucket[0]) > windowMs) bucket.shift();
  if (bucket.length >= max) return false;
  bucket.push(now);
  return true;
}

function getServerBaseUrl() {
  try {
    const base = process.env.LICENCE_SERVER_BASE_URL;
    if (base && typeof base === 'string' && base.startsWith('https://')) return base;
    const { app } = require('electron');
    const path = require('path');
    const fs = require('fs');
    const cfgPath = path.join(app.getPath('userData'), 'licence-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.apiUrl) return cfg.apiUrl.replace(/\/$/, '');
    }
  } catch (_) {}
  return 'https://custodynote.com';
}

function httpPostForgot(baseUrl, email) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const url = new URL('/api/licence/email-key', baseUrl);
    const payload = JSON.stringify({ email: email.trim().toLowerCase() });
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve({});
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

function registerLicenceIpc(app) {
  ipcMain.handle('custody:requestLicenceEmail', async (_, email) => {
    if (!validateEmail(email)) return GENERIC_SUCCESS;
    if (!requestLicenceEmailRateLimit.checkRateLimit()) {
      return GENERIC_SUCCESS;
    }
    const baseUrl = getServerBaseUrl();
    try {
      const resp = await httpPostForgot(baseUrl, email);
      if (resp && resp.ok === false) {
        return {
          success: false,
          message: resp.error || 'Could not send email. Try again or contact support.',
        };
      }
      return {
        success: true,
        message: (resp && resp.message) || GENERIC_SUCCESS.message,
      };
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Licence] Forgot-key request failed:', e.message);
      }
      return {
        success: false,
        message: 'Could not connect. Please try again later.',
      };
    }
  });

  ipcMain.handle('custody:adminLogin', async (event, password) => {
    if (!_isTrustedFrame(event)) return { success: false, error: 'Untrusted frame' };
    if (!_checkChannelRateLimit('custody:adminLogin', 5, 60 * 1000)) {
      return { success: false, error: 'Too many login attempts. Please wait a minute and try again.' };
    }
    return adminAuth.login(app, password);
  });

  ipcMain.handle('custody:adminSetPassword', async (event, { password, token }) => {
    if (!_isTrustedFrame(event)) return { success: false, error: 'Untrusted frame' };
    if (!_checkChannelRateLimit('custody:adminSetPassword', 5, 60 * 1000)) {
      return { success: false, error: 'Too many attempts. Please wait a minute and try again.' };
    }
    return adminAuth.setAdminPassword(app, password, token);
  });

  ipcMain.handle('custody:adminHasPassword', async (event) => {
    if (!_isTrustedFrame(event)) return false;
    return adminAuth.hasAdminPassword(app);
  });

  ipcMain.handle('custody:adminSearch', async (event, emailQuery) => {
    if (!_isTrustedFrame(event)) return { items: [] };
    adminAuth.requireAdmin();
    const q = typeof emailQuery === 'string' ? emailQuery.trim().slice(0, QUERY_MAX_LEN) : '';
    const rows = q ? licenceStore.searchByEmailPrefix(q, 50) : licenceStore.listRecent(50);
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        licenceKeyMasked: licenceStore.maskKey(r.licence_key),
        createdAt: r.created_at,
        status: r.status,
        lastSentAt: r.last_sent_at,
      })),
    };
  });

  ipcMain.handle('custody:adminRevealLicence', async (event, id) => {
    if (!_isTrustedFrame(event)) return { error: 'Untrusted frame' };
    adminAuth.requireAdmin();
    const rows = licenceStore.listRecent(1000);
    const r = rows.find((x) => x.id === id);
    if (!r) return { error: 'Not found' };
    return {
      email: r.email,
      licence_key: r.licence_key,
      created_at: r.created_at,
      status: r.status,
      last_sent_at: r.last_sent_at,
    };
  });

  ipcMain.handle('custody:adminResend', async (event, id) => {
    if (!_isTrustedFrame(event)) return { success: false, message: 'Untrusted frame' };
    adminAuth.requireAdmin();
    const rows = licenceStore.listRecent(1000);
    const r = rows.find((x) => x.id === id);
    if (!r) return { success: false, message: 'Not found' };
    const baseUrl = getServerBaseUrl();
    try {
      await httpPostForgot(baseUrl, r.email);
      licenceStore.markSent(id);
    } catch (e) {
      console.warn('[Licence] Resend failed:', e.message);
      return { success: false, message: 'Failed to send: ' + (e.message || 'network error') };
    }
    return { success: true, message: 'Request sent.' };
  });

  ipcMain.handle('custody:adminSync', async (event) => {
    if (!_isTrustedFrame(event)) return { ok: false, reason: 'untrusted_frame', synced: 0 };
    adminAuth.requireAdmin();
    const baseUrl = getServerBaseUrl();
    const token = process.env.ADMIN_API_TOKEN || process.env.ADMIN_SECRET;
    if (!token) return { ok: false, reason: 'admin_token_not_configured', synced: 0 };

    return new Promise((resolve) => {
      const https = require('https');
      const url = new URL('/api/admin/licences/sync', baseUrl);
      url.searchParams.set('since', '0');
      https.get({
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { Authorization: 'Bearer ' + token },
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.items && Array.isArray(json.items)) {
              let synced = 0;
              for (const item of json.items) {
                licenceStore.upsertLicence(item);
                synced++;
              }
              resolve({ ok: json.ok !== false, synced });
            } else {
              resolve({ ok: false, reason: json.reason || 'invalid_response', synced: 0 });
            }
          } catch (_) {
            resolve({ ok: false, reason: 'parse_error', synced: 0 });
          }
        });
      }).on('error', (e) => {
        resolve({ ok: false, reason: e.message || 'network_error', synced: 0 });
      }).on('timeout', function () {
        this.destroy();
        resolve({ ok: false, reason: 'timeout', synced: 0 });
      });
    });
  });

  ipcMain.handle('custody:adminDashboard', async (event) => {
    if (!_isTrustedFrame(event)) return { ok: false, error: 'Untrusted frame' };
    adminAuth.requireAdmin();
    const baseUrl = getServerBaseUrl();
    const token = process.env.ADMIN_API_TOKEN || process.env.ADMIN_SECRET;
    if (!token) return { ok: false, error: 'ADMIN_SECRET not configured' };

    return new Promise((resolve) => {
      const https = require('https');
      const url = new URL('/api/admin/licences', baseUrl);
      https.get({
        hostname: url.hostname,
        path: url.pathname,
        headers: { 'x-admin-secret': token },
        timeout: 20000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: true, stats: json.stats, licences: json.licences || [] });
          } catch (_) {
            resolve({ ok: false, error: 'Invalid response from server' });
          }
        });
      }).on('error', (e) => {
        resolve({ ok: false, error: e.message || 'Network error' });
      }).on('timeout', function () {
        this.destroy();
        resolve({ ok: false, error: 'Request timed out' });
      });
    });
  });

  ipcMain.handle('custody:adminResendToEmail', async (event, { email, licenceKey }) => {
    if (!_isTrustedFrame(event)) return { success: false, message: 'Untrusted frame' };
    adminAuth.requireAdmin();
    const baseUrl = getServerBaseUrl();
    const token = process.env.ADMIN_API_TOKEN || process.env.ADMIN_SECRET;
    if (!token) return { ok: false, error: 'ADMIN_SECRET not configured' };

    return new Promise((resolve) => {
      const https = require('https');
      const url = new URL('/api/admin/licences', baseUrl);
      const payload = JSON.stringify({ action: 'resend', email, licenceKey });
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: { 'x-admin-secret': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 15000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve({ ok: false, error: 'Invalid response' });
          }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message || 'Network error' }));
      req.on('timeout', function () { this.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      req.write(payload);
      req.end();
    });
  });

  ipcMain.handle('custody:serverConfigured', () => {
    const base = getServerBaseUrl();
    return !!base && base.startsWith('https://');
  });
}

module.exports = { registerLicenceIpc };
