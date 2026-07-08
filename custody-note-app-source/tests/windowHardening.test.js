/**
 * tests/windowHardening.test.js
 * Pure-function tests of the URL filters used by main/windowHardening.js.
 * These run in plain node (no Electron), so they verify the *policy* without
 * needing a renderer.
 *
 * Run: npm run test:unit
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isInternalNavigation,
  isSafeExternalUrl,
  isSafeMailtoDraftUrl,
  ELECTRON_CSP,
  ALLOWED_PERMISSIONS,
} = require('../main/windowHardening');

describe('windowHardening.isInternalNavigation', () => {
  const origin = 'file:///c:/app/index.html';

  it('accepts file:// inside the same app folder', () => {
    assert.strictEqual(isInternalNavigation('file:///c:/app/index.html', origin), true);
    assert.strictEqual(isInternalNavigation('file:///c:/app/sub/page.html', origin), true);
  });

  it('rejects http(s) URLs', () => {
    assert.strictEqual(isInternalNavigation('https://evil.com/', origin), false);
    assert.strictEqual(isInternalNavigation('http://localhost/', origin), false);
  });

  it('rejects javascript:, data:, blob: schemes', () => {
    assert.strictEqual(isInternalNavigation('javascript:alert(1)', origin), false);
    assert.strictEqual(isInternalNavigation('data:text/html,<script>x()</script>', origin), false);
    assert.strictEqual(isInternalNavigation('blob:null/abc', origin), false);
  });

  it('rejects file:// outside the app folder', () => {
    assert.strictEqual(isInternalNavigation('file:///c:/Windows/system32/config.html', origin), false);
  });

  it('rejects malformed input', () => {
    assert.strictEqual(isInternalNavigation('not a url', origin), false);
    assert.strictEqual(isInternalNavigation('', origin), false);
    assert.strictEqual(isInternalNavigation(null, origin), false);
    assert.strictEqual(isInternalNavigation(undefined, origin), false);
  });
});

describe('windowHardening.isSafeExternalUrl', () => {
  it('accepts https:// URLs', () => {
    assert.strictEqual(isSafeExternalUrl('https://custodynote.com'), true);
    assert.strictEqual(isSafeExternalUrl('https://outlook.office.com/mail/0/deeplink/compose?subject=hi'), true);
  });

  it('accepts http://localhost only', () => {
    assert.strictEqual(isSafeExternalUrl('http://localhost:5173'), true);
    assert.strictEqual(isSafeExternalUrl('http://127.0.0.1:8080'), true);
    assert.strictEqual(isSafeExternalUrl('http://example.com'), false);
  });

  it('rejects dangerous schemes', () => {
    assert.strictEqual(isSafeExternalUrl('javascript:alert(1)'), false);
    assert.strictEqual(isSafeExternalUrl('file:///etc/passwd'), false);
    assert.strictEqual(isSafeExternalUrl('data:text/html,<script>x()</script>'), false);
    assert.strictEqual(isSafeExternalUrl('vbscript:msgbox(1)'), false);
  });

  it('rejects URLs with control characters (smuggling)', () => {
    assert.strictEqual(isSafeExternalUrl('https://example.com\nX-Header'), false);
    assert.strictEqual(isSafeExternalUrl('https://example.com\u0000evil'), false);
  });

  it('rejects mailto: for isSafeExternalUrl (mailto uses isSafeMailtoDraftUrl)', () => {
    assert.strictEqual(isSafeExternalUrl('mailto:test@example.com'), false);
  });

  it('rejects malformed input', () => {
    assert.strictEqual(isSafeExternalUrl(''), false);
    assert.strictEqual(isSafeExternalUrl(null), false);
    assert.strictEqual(isSafeExternalUrl(undefined), false);
    assert.strictEqual(isSafeExternalUrl({}), false);
  });
});

describe('windowHardening.isSafeMailtoDraftUrl', () => {
  it('accepts RFC-style mailto with query headers', () => {
    assert.strictEqual(
      isSafeMailtoDraftUrl('mailto:a@b.com?subject=' + encodeURIComponent('hello') + '&body=' + encodeURIComponent('line')),
      true
    );
  });

  it('rejects mailto without @ in address part', () => {
    assert.strictEqual(isSafeMailtoDraftUrl('mailto:not-an-email'), false);
  });

  it('rejects non-mailto schemes', () => {
    assert.strictEqual(isSafeMailtoDraftUrl('https://x'), false);
  });

  it('rejects control characters', () => {
    assert.strictEqual(isSafeMailtoDraftUrl('mailto:a@b.com\u0000evil'), false);
  });
});

describe('windowHardening.ELECTRON_CSP', () => {
  it('uses default-src none and locks down sub-resources', () => {
    assert.match(ELECTRON_CSP, /default-src 'none'/);
    assert.match(ELECTRON_CSP, /object-src 'none'/);
    assert.match(ELECTRON_CSP, /base-uri 'none'/);
    assert.match(ELECTRON_CSP, /frame-ancestors 'none'/);
    assert.match(ELECTRON_CSP, /form-action 'none'/);
  });

  it('does not allow any third-party script origin', () => {
    assert.doesNotMatch(ELECTRON_CSP, /sql\.js\.org/);
    assert.doesNotMatch(ELECTRON_CSP, /unpkg/);
    assert.doesNotMatch(ELECTRON_CSP, /cdn\./i);
    assert.doesNotMatch(ELECTRON_CSP, /'unsafe-eval'/);
    assert.doesNotMatch(ELECTRON_CSP, /'unsafe-inline'.*script-src/);
  });

  it('only permits the legitimate API origin in connect-src', () => {
    assert.match(ELECTRON_CSP, /connect-src 'self' https:\/\/custodynote\.com https:\/\/www\.custodynote\.com/);
  });
});

describe('windowHardening.ALLOWED_PERMISSIONS', () => {
  it('does not allow camera, microphone, geolocation, USB, MIDI, etc.', () => {
    const dangerous = [
      'media', 'camera', 'microphone', 'geolocation', 'midi', 'midiSysex',
      'usb', 'serial', 'hid', 'bluetooth', 'notifications',
      'screen', 'display-capture', 'idle-detection', 'pointerLock',
    ];
    for (const p of dangerous) {
      assert.strictEqual(ALLOWED_PERMISSIONS.has(p), false, p + ' must NOT be allowed');
    }
  });
});

