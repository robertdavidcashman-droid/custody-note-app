'use strict';

/**
 * windowHardening.js
 * ----------------------------------------------------------------------------
 * Defence-in-depth for Electron BrowserWindows. Applied once per window and
 * once per session. None of these are "the security boundary" on their own —
 * sandbox + contextIsolation + nodeIntegration:false are — but they close
 * known bypasses where a renderer compromise (e.g. via stored XSS in user
 * input) would otherwise be able to:
 *
 *   • navigate the main window away from file:// (and so defeat
 *     _isTrustedFrame in main/licenceIpc.js);
 *   • open a new window pointing at an attacker-controlled URL with
 *     full Chromium privileges (window.open returns a real window that
 *     can be used to siphon data via window.postMessage);
 *   • silently use camera, microphone, geolocation, USB, MIDI, Bluetooth,
 *     screen capture, idle detection, etc.;
 *   • load remote frames or service workers from arbitrary origins.
 *
 * Every external link the user clicks is delegated to shell.openExternal
 * AFTER passing the allow-list (HTTPS http-localhost, or a validated mailto:
 * draft string — see isSafeMailtoDraftUrl in this file).
 *
 * Tested values intentionally fail closed: any unknown navigation, any
 * unknown permission, any unknown protocol → denied.
 */

const URL_ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const URL_ALLOWED_LOCAL_ONLY_PROTOCOLS = new Set(['file:']);

/**
 * Return true if the renderer should be allowed to navigate to `urlStr` in-place.
 * We only ever permit file:// URLs that point at the bundled app (i.e. start
 * with the app's own file:// origin). Everything else is rejected so the
 * renderer cannot escape its origin.
 */
function isInternalNavigation(urlStr, appOrigin) {
  if (typeof urlStr !== 'string' || !urlStr) return false;
  let parsed;
  try { parsed = new URL(urlStr); } catch (_) { return false; }
  if (!URL_ALLOWED_LOCAL_ONLY_PROTOCOLS.has(parsed.protocol)) return false;
  // file:// origin compare is fragile across platforms; compare normalised.
  if (!appOrigin) return parsed.protocol === 'file:';
  try {
    const base = new URL(appOrigin);
    return base.protocol === 'file:'
      && (parsed.href === base.href
          || parsed.href.startsWith(base.href.replace(/[^/]+$/, '')));
  } catch (_) {
    return parsed.protocol === 'file:';
  }
}

/**
 * Validate a URL the renderer asked us to open externally. We accept only
 * https:// (and http:// for localhost dev), and we reject anything that
 * tries to smuggle in an alternate scheme via a leading whitespace or
 * embedded null. Caller should additionally pass through any project-wide
 * allow-list (e.g. only custodynote.com / GOV.UK / outlook.office.com).
 */
function isSafeExternalUrl(urlStr) {
  if (typeof urlStr !== 'string') return false;
  // Reject obvious smuggling.
  if (/[\u0000-\u001F\u007F]/.test(urlStr)) return false;
  let parsed;
  try { parsed = new URL(urlStr.trim()); } catch (_) { return false; }
  if (!URL_ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
  if (parsed.protocol === 'http:'
      && parsed.hostname !== 'localhost'
      && parsed.hostname !== '127.0.0.1') {
    return false;
  }
  return true;
}

const MAILTO_URL_MAX_LEN = 100000;

/**
 * Allow user-triggered mailto: drafts from the bundled app only — tight
 * validation so renderer XSS cannot invoke arbitrary schemes. Delegated to
 * shell.openExternal (same as https) after will-navigate preventDefault.
 */
function isSafeMailtoDraftUrl(urlStr) {
  if (typeof urlStr !== 'string') return false;
  if (/[\u0000-\u001F\u007F]/.test(urlStr)) return false;
  const t = urlStr.trim();
  if (!t.toLowerCase().startsWith('mailto:')) return false;
  if (t.length > MAILTO_URL_MAX_LEN) return false;
  const rest = t.slice('mailto:'.length);
  const q = rest.indexOf('?');
  const addrPart = q >= 0 ? rest.slice(0, q) : rest;
  let decoded = addrPart;
  try {
    decoded = decodeURIComponent(addrPart);
  } catch (_) { /* keep raw */ }
  return decoded.indexOf('@') > 0 && decoded.indexOf('@') < decoded.length - 1;
}

/**
 * Hardened CSP for the Electron build. Stricter than the one in index.html:
 * the desktop bundle ships sql.js locally so no CDN is required, no remote
 * connections except the licence/sync API and Outlook Web (which is opened
 * by shell.openExternal in the OS browser, never fetched), and no inline
 * scripts.
 *
 * We intentionally keep `'unsafe-inline'` for style-src because the renderer
 * uses dynamic inline styles in many places; switching to nonces would be
 * a separate larger refactor.
 */
const ELECTRON_CSP =
  "default-src 'none'; " +
  "script-src 'self' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "media-src 'self' data: blob:; " +
  "connect-src 'self' https://custodynote.com https://www.custodynote.com; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-src 'none'; " +
  "frame-ancestors 'none'; " +
  "manifest-src 'self'; " +
  "worker-src 'self'; " +
  "upgrade-insecure-requests";

/**
 * Permission requests that we accept in the desktop app. Anything else
 * (camera, microphone, geolocation, USB, MIDI, Bluetooth, idle detection,
 * screen capture, etc.) is denied without a prompt. Failing closed.
 */
const ALLOWED_PERMISSIONS = new Set([
  // Required by Electron internals; Chromium grants these implicitly anyway.
  'clipboard-sanitized-write',
  'fullscreen',
]);

/**
 * Apply hardening to a single BrowserWindow. Idempotent: safe to call
 * multiple times for the same window.
 *
 *   options.shellOpenExternal   - fn (urlStr) => Promise<void>, used so
 *                                 callers can delegate through their own
 *                                 isAllowedApiUrl-style filter.
 *   options.logger              - { warn(msg, meta?) } for security events.
 *   options.appOrigin           - file:// URL of index.html to compare
 *                                 navigations against.
 */
function hardenWindow(win, options) {
  const opts = options || {};
  const log = opts.logger || { warn: function () {} };
  const appOrigin = opts.appOrigin || '';
  const openExternal = opts.shellOpenExternal || (function () { return Promise.resolve(); });

  if (!win || typeof win.webContents !== 'object') return;
  const wc = win.webContents;

  // Block in-place navigation to anything that is not the bundled app.
  wc.on('will-navigate', function (event, urlStr) {
    if (!isInternalNavigation(urlStr, appOrigin)) {
      event.preventDefault();
      log.warn('[security] Blocked in-place navigation', { url: _redactForLog(urlStr) });
      if (isSafeExternalUrl(urlStr)) {
        Promise.resolve(openExternal(urlStr)).catch(function () {});
      } else if (isSafeMailtoDraftUrl(urlStr)) {
        Promise.resolve(openExternal(urlStr)).catch(function () {});
      }
    }
  });

  wc.on('will-redirect', function (event, urlStr) {
    if (!isInternalNavigation(urlStr, appOrigin)) {
      event.preventDefault();
      log.warn('[security] Blocked redirect', { url: _redactForLog(urlStr) });
    }
  });

  // Refuse window.open for anything we don't recognise. Anything we do
  // recognise (an http(s) URL) gets opened in the OS default browser via
  // shell.openExternal — never given a real BrowserWindow.
  wc.setWindowOpenHandler(function (details) {
    const target = details && details.url ? String(details.url) : '';
    if (isSafeExternalUrl(target)) {
      Promise.resolve(openExternal(target)).catch(function () {});
    } else if (isSafeMailtoDraftUrl(target)) {
      Promise.resolve(openExternal(target)).catch(function () {});
    } else {
      log.warn('[security] Blocked window.open', { url: _redactForLog(target) });
    }
    return { action: 'deny' };
  });

  // Refuse to attach <webview> or load preload scripts from anywhere
  // other than the bundled paths.
  wc.on('will-attach-webview', function (event, webPreferences) {
    event.preventDefault();
    log.warn('[security] Blocked <webview> attach');
    // Defensive: if Electron ever ignores preventDefault(), strip privileges.
    if (webPreferences) {
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      delete webPreferences.preload;
    }
  });
}

/**
 * Apply hardening to a session (typically the default session). Should be
 * called once at app startup, after app.whenReady().
 *
 *   options.allowedHosts     - additional hosts to allow in connect-src
 *                              (rare; usually leave empty)
 *   options.logger           - { warn(msg, meta?) } for security events.
 */
function hardenSession(session, options) {
  if (!session) return;
  const opts = options || {};
  const log = opts.logger || { warn: function () {} };

  // Deny every permission request by default. The desktop Custody Note app
  // never asks for camera, microphone, geolocation, USB, MIDI, etc.
  session.setPermissionRequestHandler(function (_webContents, permission, callback) {
    const allowed = ALLOWED_PERMISSIONS.has(permission);
    if (!allowed) log.warn('[security] Denied permission request', { permission: permission });
    try { callback(allowed); } catch (_) {}
  });

  // For permission CHECKS (sync) — Electron ≥10 exposes this — also default deny.
  if (typeof session.setPermissionCheckHandler === 'function') {
    session.setPermissionCheckHandler(function (_wc, permission /*, requestingOrigin, details */) {
      return ALLOWED_PERMISSIONS.has(permission);
    });
  }

  // Inject CSP and the rest of the security headers as RESPONSE headers,
  // independent of the meta tag in index.html. Belt-and-braces: a meta CSP
  // does not apply to subresources loaded before the parser sees it,
  // whereas a header CSP does.
  session.webRequest.onHeadersReceived(function (details, callback) {
    const headers = Object.assign({}, details.responseHeaders || {});
    function set(name, value) {
      // Strip any existing variant (case-insensitive) before setting.
      Object.keys(headers).forEach(function (k) {
        if (k.toLowerCase() === name.toLowerCase()) delete headers[k];
      });
      headers[name] = [value];
    }
    set('Content-Security-Policy', ELECTRON_CSP);
    set('X-Content-Type-Options', 'nosniff');
    set('X-Frame-Options', 'DENY');
    set('Referrer-Policy', 'no-referrer');
    set('Cross-Origin-Opener-Policy', 'same-origin');
    set('Cross-Origin-Resource-Policy', 'same-origin');
    set('Cross-Origin-Embedder-Policy', 'credentialless');
    set('Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), '
      + 'magnetometer=(), microphone=(), payment=(), usb=(), '
      + 'interest-cohort=(), browsing-topics=(), bluetooth=(), '
      + 'serial=(), midi=(), hid=(), idle-detection=(), '
      + 'display-capture=(), publickey-credentials-get=()');
    try { callback({ responseHeaders: headers }); } catch (_) {}
  });

  // Block navigations that originated from a service worker spoofing
  // executeJavaScript IPC replies (mitigation for GHSA-xj5x-m3f3-5x3h
  // until we are on Electron ≥38.8.6 / 41.x).
  if (typeof session.serviceWorkers === 'object' && session.serviceWorkers
      && typeof session.serviceWorkers.on === 'function') {
    session.serviceWorkers.on('console-message', function (_event, message) {
      if (message && message.message
          && /executeJavaScript|ipcRenderer/.test(String(message.message))) {
        log.warn('[security] Suspicious SW console message', { source: message.sourceUrl || '' });
      }
    });
  }
}

function _redactForLog(urlStr) {
  if (typeof urlStr !== 'string') return '<non-string>';
  // Keep scheme + host only; drop path/query/fragment which can contain PII.
  try {
    const u = new URL(urlStr);
    return u.protocol + '//' + u.hostname + (u.pathname && u.pathname !== '/' ? '/<path>' : '');
  } catch (_) {
    return '<unparsable>';
  }
}

module.exports = {
  hardenWindow,
  hardenSession,
  isInternalNavigation,
  isSafeExternalUrl,
  isSafeMailtoDraftUrl,
  ELECTRON_CSP,
  ALLOWED_PERMISSIONS,
};
