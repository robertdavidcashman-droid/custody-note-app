'use strict';

/**
 * Tests for lib/openExternalUrl.js — the Windows AppX URL-hijack workaround.
 *
 * Background: Microsoft's "Outlook for Windows" UWP app (`olk.exe`) registers
 * itself as a per-host URL handler for `outlook.office.com`. When Electron
 * calls `shell.openExternal('https://outlook.office.com/mail/0/deeplink/compose?...')`
 * Windows hands the URL to `olk.exe`, which silently consumes it with no
 * visible window. The helper bypasses this by spawning the user's default
 * browser directly when the URL is one of the hijacked hosts.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const mod = require('../lib/openExternalUrl');

describe('shouldBypassShellForUrl', () => {
  it('returns true on win32 for outlook.office.com', () => {
    assert.strictEqual(mod.shouldBypassShellForUrl('https://outlook.office.com/mail/0/deeplink/compose?to=a@b.c', 'win32'), true);
  });
  it('returns true on win32 for outlook.live.com', () => {
    assert.strictEqual(mod.shouldBypassShellForUrl('https://outlook.live.com/owa/?path=/mail/action/compose', 'win32'), true);
  });
  it('returns false on win32 for outlook.office365.com (no hijack registered for that host)', () => {
    assert.strictEqual(mod.shouldBypassShellForUrl('https://outlook.office365.com/mail/0/deeplink/compose', 'win32'), false);
  });
  it('returns false on win32 for unrelated hosts', () => {
    assert.strictEqual(mod.shouldBypassShellForUrl('https://example.com/anything', 'win32'), false);
    assert.strictEqual(mod.shouldBypassShellForUrl('https://google.com/', 'win32'), false);
  });
  it('returns false on darwin/linux even for outlook.office.com', () => {
    assert.strictEqual(mod.shouldBypassShellForUrl('https://outlook.office.com/x', 'darwin'), false);
    assert.strictEqual(mod.shouldBypassShellForUrl('https://outlook.office.com/x', 'linux'), false);
  });
  it('returns false for invalid / non-http URLs', () => {
    assert.strictEqual(mod.shouldBypassShellForUrl('not-a-url', 'win32'), false);
    assert.strictEqual(mod.shouldBypassShellForUrl('mailto:x@y.z', 'win32'), false);
    assert.strictEqual(mod.shouldBypassShellForUrl('', 'win32'), false);
    assert.strictEqual(mod.shouldBypassShellForUrl(null, 'win32'), false);
  });
});

describe('defaultBrowserCandidatesWindows', () => {
  it('includes Chrome, Edge, Firefox, Brave standard install paths when env vars present', () => {
    const env = {
      'ProgramFiles': 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      'LOCALAPPDATA': 'C:\\Users\\u\\AppData\\Local',
    };
    const list = mod.defaultBrowserCandidatesWindows(env);
    const joined = list.join('|');
    assert.ok(joined.includes(path.win32.join('Google', 'Chrome', 'Application', 'chrome.exe')), 'chrome.exe candidate missing');
    assert.ok(joined.includes(path.win32.join('Microsoft', 'Edge', 'Application', 'msedge.exe')), 'msedge.exe candidate missing');
    assert.ok(joined.includes(path.win32.join('Mozilla Firefox', 'firefox.exe')), 'firefox.exe candidate missing');
    assert.ok(joined.includes(path.win32.join('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')), 'brave.exe candidate missing');
  });
  it('skips entries whose env var is missing', () => {
    const list = mod.defaultBrowserCandidatesWindows({});
    assert.deepStrictEqual(list, []);
  });
});

describe('findDefaultBrowserExeWindows', () => {
  const env = {
    'ProgramFiles': 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'LOCALAPPDATA': 'C:\\Users\\u\\AppData\\Local',
  };
  it('returns the first existing browser exe', () => {
    const chrome = path.win32.join('C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const fileExists = (p) => p === chrome;
    assert.strictEqual(mod.findDefaultBrowserExeWindows({ env, fileExists }), chrome);
  });
  it('prefers Program Files\\Google\\Chrome over the (x86) fallback', () => {
    const chrome64 = path.win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const chrome86 = path.win32.join('C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const fileExists = (p) => p === chrome64 || p === chrome86;
    assert.strictEqual(mod.findDefaultBrowserExeWindows({ env, fileExists }), chrome64);
  });
  it('returns null when no candidate exists', () => {
    assert.strictEqual(mod.findDefaultBrowserExeWindows({ env, fileExists: () => false }), null);
  });
});

describe('openExternalUrl', () => {
  function makeShell() {
    const calls = [];
    return {
      calls,
      openExternal: (u) => { calls.push(u); return Promise.resolve(); },
    };
  }
  function makeSpawn() {
    const calls = [];
    function fakeChild() {
      return {
        on: () => undefined,
        unref: () => undefined,
      };
    }
    return {
      calls,
      fn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return fakeChild(); },
    };
  }

  it('on win32 + Outlook URL + Chrome present: spawns Chrome directly, does NOT call shell.openExternal', async () => {
    const shell = makeShell();
    const spawnCtl = makeSpawn();
    const chrome = path.win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const res = await mod.openExternalUrl('https://outlook.office.com/mail/0/deeplink/compose?to=a@b.c', {
      electronShell: shell,
      platform: 'win32',
      env: { 'ProgramFiles': 'C:\\Program Files' },
      fileExists: (p) => p === chrome,
      spawnFn: spawnCtl.fn,
      logger: { info: () => {}, warn: () => {} },
    });
    assert.strictEqual(res.method, 'browser-direct');
    assert.strictEqual(res.exe, chrome);
    assert.strictEqual(spawnCtl.calls.length, 1);
    assert.strictEqual(spawnCtl.calls[0].cmd, chrome);
    assert.deepStrictEqual(spawnCtl.calls[0].args, ['https://outlook.office.com/mail/0/deeplink/compose?to=a@b.c']);
    assert.strictEqual(shell.calls.length, 0, 'shell.openExternal must NOT be called when browser-direct succeeds');
  });

  it('on win32 + Outlook URL + NO browser exe: falls back to shell.openExternal', async () => {
    const shell = makeShell();
    const spawnCtl = makeSpawn();
    const res = await mod.openExternalUrl('https://outlook.office.com/x', {
      electronShell: shell,
      platform: 'win32',
      env: { 'ProgramFiles': 'C:\\Program Files' },
      fileExists: () => false,
      spawnFn: spawnCtl.fn,
      logger: { info: () => {}, warn: () => {} },
    });
    assert.strictEqual(res.method, 'shell-openExternal');
    assert.strictEqual(spawnCtl.calls.length, 0);
    assert.deepStrictEqual(shell.calls, ['https://outlook.office.com/x']);
  });

  it('on win32 + non-Outlook URL: uses shell.openExternal directly', async () => {
    const shell = makeShell();
    const spawnCtl = makeSpawn();
    const res = await mod.openExternalUrl('https://example.com/page', {
      electronShell: shell,
      platform: 'win32',
      env: { 'ProgramFiles': 'C:\\Program Files' },
      fileExists: () => true,
      spawnFn: spawnCtl.fn,
      logger: { info: () => {}, warn: () => {} },
    });
    assert.strictEqual(res.method, 'shell-openExternal');
    assert.strictEqual(spawnCtl.calls.length, 0);
    assert.deepStrictEqual(shell.calls, ['https://example.com/page']);
  });

  it('on darwin/linux + Outlook URL: uses shell.openExternal (no hijack to bypass)', async () => {
    for (const platform of ['darwin', 'linux']) {
      const shell = makeShell();
      const spawnCtl = makeSpawn();
      const res = await mod.openExternalUrl('https://outlook.office.com/mail/0/deeplink/compose', {
        electronShell: shell,
        platform,
        env: {},
        fileExists: () => true,
        spawnFn: spawnCtl.fn,
        logger: { info: () => {}, warn: () => {} },
      });
      assert.strictEqual(res.method, 'shell-openExternal', 'on ' + platform);
      assert.strictEqual(spawnCtl.calls.length, 0, 'should not spawn on ' + platform);
      assert.strictEqual(shell.calls.length, 1, 'should call shell.openExternal on ' + platform);
    }
  });

  it('falls back to shell.openExternal when spawn throws', async () => {
    const shell = makeShell();
    const chrome = path.win32.join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const res = await mod.openExternalUrl('https://outlook.office.com/x', {
      electronShell: shell,
      platform: 'win32',
      env: { 'ProgramFiles': 'C:\\Program Files' },
      fileExists: (p) => p === chrome,
      spawnFn: () => { throw new Error('access denied'); },
      logger: { info: () => {}, warn: () => {} },
    });
    assert.strictEqual(res.method, 'shell-openExternal');
    assert.deepStrictEqual(shell.calls, ['https://outlook.office.com/x']);
  });

  it('throws when no electronShell.openExternal is available', async () => {
    await assert.rejects(
      () => mod.openExternalUrl('https://example.com', {
        electronShell: null,
        platform: 'darwin',
      }),
      /electronShell\.openExternal is required/
    );
  });
});
