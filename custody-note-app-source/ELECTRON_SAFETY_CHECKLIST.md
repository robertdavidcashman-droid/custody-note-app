# CustodyNote — Electron Safety Checklist

Run through this before shipping changes to main process, updater, build config, or app lifecycle.

---

## App Lifecycle

- [ ] Are app lifecycle handlers duplicated? (`app.whenReady`, `window-all-closed`, `before-quit`)
- [ ] Does any new code call `app.quit()`, `app.exit()`, or `app.relaunch()`? If so, is it guarded?
- [ ] Is `app.requestSingleInstanceLock()` still in place?

## IPC

- [ ] Are IPC listeners registered exactly once? (no re-registration on window focus/reload)
- [ ] Is every `ipcMain.handle` matched by a `preload.js` bridge and renderer call?
- [ ] Does the renderer avoid direct Node/Electron access?

## Updater

- [ ] Is autoUpdater initialised exactly once?
- [ ] Are updater event listeners registered exactly once?
- [ ] Is `checkForUpdates` called with cooldown and not on every window focus?
- [ ] Is `quitAndInstall` guarded against double-call?
- [ ] Is there a forced `app.exit(0)` timeout after `quitAndInstall`?
- [ ] Is update state persisted to `cn-auto-update-state.json`?
- [ ] Is failed version transition detected on startup?
- [ ] Is there a circuit breaker (`failedInstallCount >= MAX`)?
- [ ] Can this change cause a restart loop? (If yes, add prevention.)
- [ ] Is every updater event logged to `cn-auto-update.log`?

## Build / NSIS

- [ ] Does this change affect install path? (user AppData vs Program Files)
- [ ] Does this change affect auto-update compatibility? (publish config, latest.yml)
- [ ] Is `build/installer.nsh` still included and functional?
- [ ] Is `perMachine: false` still set? (prevents admin permission issues)
- [ ] Has the change been tested in packaged mode?

## Timers and Intervals

- [ ] Are long-running `setInterval` / `setTimeout` calls justified?
- [ ] Do they have proper cleanup on app quit?
- [ ] Do retry/interval patterns have a maximum attempt count?

## Logging

- [ ] Is there persistent logging for failure cases?
- [ ] Are errors caught and logged (not swallowed)?
- [ ] For new IPC handlers with side effects, is there entry/error logging?

## General

- [ ] Does this fix work in packaged mode, not just dev?
- [ ] Is `app.isPackaged` checked where appropriate?
- [ ] Has the change been tested with the NSIS installer (not just dev mode)?
