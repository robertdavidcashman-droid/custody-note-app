'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('P0 durability — flush on suspend/lock/finalise', () => {
  it('force-lock broadcasts flushDbSync before session-force-lock', () => {
    const idx = mainJs.indexOf('function _broadcastForceLock');
    assert.ok(idx > 0, '_broadcastForceLock must exist');
    const body = mainJs.slice(idx, idx + 900);
    assert.match(body, /flushDbSync\(\)/);
    assert.match(body, /session-force-lock/);
    assert.ok(
      body.indexOf('flushDbSync') < body.indexOf('session-force-lock'),
      'DB must flush before lock IPC'
    );
  });

  it('before-quit still flushes synchronously', () => {
    assert.match(mainJs, /app\.on\('before-quit'/);
    const idx = mainJs.indexOf("app.on('before-quit'");
    const body = mainJs.slice(idx, idx + 400);
    assert.match(body, /flushDbSync\(\)/);
  });

  it('attendance finalise/complete uses flushDbSync not async flushDb', () => {
    assert.match(
      mainJs,
      /if \(st === 'finalised' \|\| st === 'completed'\) flushDbSync\(\)/
    );
    assert.doesNotMatch(
      mainJs,
      /if \(st === 'finalised' \|\| st === 'completed'\) flushDb\(\)/
    );
  });
});

describe('P0 backups — default folder created on init', () => {
  it('defines ensureBackupFolderExists and uses it for readiness', () => {
    assert.match(mainJs, /function ensureBackupFolderExists/);
    assert.match(mainJs, /mkdirSync\(dir,\s*\{\s*recursive:\s*true\s*\}\)/);
    assert.match(mainJs, /function isBackupFolderReady/);
    const readyIdx = mainJs.indexOf('function isBackupFolderReady');
    const readyBody = mainJs.slice(readyIdx, readyIdx + 120);
    assert.match(readyBody, /ensureBackupFolderExists\(\)/);
  });

  it('initDb creates the backup folder after setting the default path', () => {
    assert.match(mainJs, /ensureBackupFolderExists\(\)/);
    const initIdx = mainJs.indexOf('async function initDb');
    const initChunk = mainJs.slice(initIdx, initIdx + 4500);
    assert.match(initChunk, /backupFolder/);
    assert.match(initChunk, /ensureBackupFolderExists/);
  });
});

describe('P0 keyboard shortcuts — Ctrl or Meta', () => {
  it('initKeyboardShortcuts accepts ctrlKey or metaKey', () => {
    assert.match(appJs, /function modPressed\(e\)\s*\{\s*return !!\(e && \(e\.ctrlKey \|\| e\.metaKey\)\);\s*\}/);
    assert.match(appJs, /modPressed\(e\) && e\.key === 's'/);
    assert.match(appJs, /modPressed\(e\) && e\.key === 'n'/);
  });

  it('shortcut labels use data-shortcut-mod and Save (not Save & exit) for Cmd/Ctrl+S', () => {
    assert.match(indexHtml, /data-shortcut-mod/);
    assert.match(indexHtml, /<kbd data-shortcut-mod>Ctrl<\/kbd>\+<kbd>S<\/kbd><\/td><td>Save<\/td>/);
    assert.doesNotMatch(indexHtml, /Ctrl<\/kbd>\+<kbd>S<\/kbd><\/td><td>Save &amp; exit<\/td>/);
  });

  it('form-save-exit tooltip no longer claims Ctrl+S does exit', () => {
    assert.doesNotMatch(indexHtml, /title="Save and exit \(Ctrl\+S\)"/);
    assert.match(indexHtml, /id="form-save-exit"[^>]*title="Save &amp; exit"/);
  });
});

describe('P1 idle UI default matches runtime', () => {
  it('unset idleTimeoutMinutes shows 10 minutes in settings, not Disabled', () => {
    assert.match(appJs, /idleEl\.value = '10'/);
    assert.match(appJs, /_IDLE_DEFAULT_MINUTES = 10/);
  });
});
