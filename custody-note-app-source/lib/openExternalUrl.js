'use strict';

/**
 * openExternalUrl
 *
 * Wrapper for opening an HTTPS URL from the Electron main process that works
 * around a Windows-specific failure mode:
 *
 *   On modern Windows installs, Microsoft's "Outlook for Windows" UWP/AppX app
 *   (`Microsoft.OutlookForWindows`, executable `olk.exe`) registers itself as
 *   a per-host URL handler for `outlook.office.com`. When Electron calls
 *   `shell.openExternal('https://outlook.office.com/mail/0/deeplink/compose?...')`,
 *   Windows hands the URL to `olk.exe` instead of the user's default browser.
 *   `olk.exe` starts but, in practice, frequently consumes the deeplink
 *   silently with no visible window — observed locally as `MainWindowHandle=0`
 *   and an empty `MainWindowTitle` for 30+ seconds. From the user's
 *   perspective the click "does nothing".
 *
 * Workaround: when the URL is one of the Outlook Web hosts and we are on
 * Windows, locate the user's default browser executable on disk and spawn it
 * directly with the URL as an argument. This bypasses the Windows URL handler
 * chain (and therefore the AppX hijack) and reliably produces a visible
 * browser tab. If we cannot find a known browser, we fall back to
 * `shell.openExternal` so behaviour is never strictly worse than before.
 *
 * The helper is small, dependency-free (`fs`, `path`, `child_process`,
 * Electron's `shell`), and pure-functional except for the spawn itself, so it
 * is easy to unit test by injecting `electronShell`, `platform`, `env`,
 * `fileExists`, and `spawnFn`.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Hosts that Microsoft's Outlook for Windows AppX is observed to hijack. */
const OUTLOOK_WEB_HIJACK_HOSTS = new Set([
  'outlook.office.com',
  'outlook.live.com',
]);

function _hostnameOf(urlStr) {
  try { return new URL(urlStr).hostname.toLowerCase(); } catch (_) { return ''; }
}

/**
 * @param {string} urlStr
 * @param {string} [platform]
 * @returns {boolean}
 */
function shouldBypassShellForUrl(urlStr, platform) {
  const plat = platform || process.platform;
  if (plat !== 'win32') return false;
  return OUTLOOK_WEB_HIJACK_HOSTS.has(_hostnameOf(urlStr));
}

/**
 * Build the ordered list of candidate browser executable paths to try on
 * Windows. Pure function — pass `env` to make it testable.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function defaultBrowserCandidatesWindows(env) {
  const e = env || process.env;
  const pf = e['ProgramFiles'];
  const pf86 = e['ProgramFiles(x86)'];
  const lad = e['LOCALAPPDATA'];
  const join = path.win32.join;
  const list = [];
  if (pf) list.push(join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (pf86) list.push(join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (lad) list.push(join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (pf) list.push(join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (pf86) list.push(join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (pf) list.push(join(pf, 'Mozilla Firefox', 'firefox.exe'));
  if (pf86) list.push(join(pf86, 'Mozilla Firefox', 'firefox.exe'));
  if (pf) list.push(join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  if (pf86) list.push(join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  return list;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fileExists?: (p:string)=>boolean }} [opts]
 * @returns {string|null}
 */
function findDefaultBrowserExeWindows(opts) {
  const o = opts || {};
  const exists = o.fileExists || ((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  for (const candidate of defaultBrowserCandidatesWindows(o.env)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Open an external URL, working around the Outlook-for-Windows AppX hijack
 * for Outlook Web compose deeplinks.
 *
 * @param {string} urlStr
 * @param {{
 *   electronShell?: { openExternal: (url: string) => Promise<void> },
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fileExists?: (p:string) => boolean,
 *   spawnFn?: (cmd:string, args:string[], opts:object) => any,
 *   logger?: { info?: Function, warn?: Function }
 * }} [opts]
 * @returns {Promise<{ method: 'browser-direct' | 'shell-openExternal', exe?: string, reason?: string }>}
 */
async function openExternalUrl(urlStr, opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const log = o.logger || console;
  const electronShell = o.electronShell || (() => {
    try { return require('electron').shell; }
    catch (_) { return null; }
  })();
  if (!electronShell || typeof electronShell.openExternal !== 'function') {
    throw new Error('openExternalUrl: electronShell.openExternal is required');
  }

  const tryBrowserDirect = shouldBypassShellForUrl(urlStr, platform);
  if (tryBrowserDirect) {
    const exe = findDefaultBrowserExeWindows({ env: o.env, fileExists: o.fileExists });
    if (exe) {
      const spawnFn = o.spawnFn || spawn;
      try {
        const child = spawnFn(exe, [urlStr], { detached: true, stdio: 'ignore' });
        if (child && typeof child.on === 'function') child.on('error', () => {});
        if (child && typeof child.unref === 'function') child.unref();
        if (log && typeof log.info === 'function') {
          log.info('[openExternalUrl] using browser-direct (bypass Windows URL hijack)', { exe });
        }
        return { method: 'browser-direct', exe };
      } catch (err) {
        if (log && typeof log.warn === 'function') {
          log.warn('[openExternalUrl] browser-direct spawn failed; falling back to shell.openExternal', { exe, err: err && err.message });
        }
        // fall through to shell.openExternal below
      }
    } else if (log && typeof log.info === 'function') {
      log.info('[openExternalUrl] no known browser exe found; falling back to shell.openExternal', { reason: 'no-known-browser' });
    }
  }

  await electronShell.openExternal(urlStr);
  if (log && typeof log.info === 'function') {
    log.info('[openExternalUrl] used shell.openExternal');
  }
  return { method: 'shell-openExternal', reason: tryBrowserDirect ? 'no-browser-fallback' : 'not-applicable' };
}

module.exports = {
  OUTLOOK_WEB_HIJACK_HOSTS,
  shouldBypassShellForUrl,
  defaultBrowserCandidatesWindows,
  findDefaultBrowserExeWindows,
  openExternalUrl,
};
