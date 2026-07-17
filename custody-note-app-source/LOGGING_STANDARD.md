# CustodyNote — Logging Standard

Practical logging rules for critical flows. Keep logs useful, not noisy.

---

## Where logs go

| Flow | Destination | Persistence |
|------|-------------|-------------|
| Auto-updater | `cn-auto-update.log` in userData | Persistent across restarts |
| App startup | console + main process stdout | Session only |
| IPC calls | console (main process) | Session only |
| DB errors | console (main process) | Session only |
| Renderer errors | DevTools console | Session only |

For production debugging, the updater log is the most important because update failures survive restarts.

---

## Log format

Use bracketed tags for grep-ability:

```
[updater] checking-for-update  v1.4.182 → ...
[updater] update-downloaded    v1.4.183
[updater] quitAndInstall       called once
[ipc]     quickfile-create-invoice  clientId=123
[db]      save failed: SQLITE_BUSY
[startup] version=1.4.182  packaged=true  platform=win32
```

---

## What to log

### Startup (main process)
- App version, isPackaged, platform
- Install path (process.resourcesPath)
- Whether update state file exists and its contents

### Updater (every event, persistent)
- checking-for-update trigger source (startup, interval, manual)
- update-available with target version
- download-progress at 25%, 50%, 75%, 100%
- update-downloaded with version
- quitAndInstall call (log BEFORE calling)
- Errors with full message
- Loop detection: failed install count, blocked state

### IPC (main process)
- Log entry for handlers that perform side effects (file writes, shell.openPath, QuickFile API calls)
- Log errors with the channel name and error message

### DB
- Open success/failure
- Save failures (catch and log, don't swallow)
- Close/flush before quit

### Renderer
- Use console.warn/error for unexpected states
- Do not log routine UI events

---

## What NOT to log

- Routine getter IPC calls (reading settings, getting version)
- Every DOM event or UI render
- Sensitive data (API keys, full file paths with usernames in production logs)

---

## Adding logging to new features

When adding a feature that involves file I/O, external APIs, or process lifecycle:

1. Add a `[tag]` log at entry point
2. Log the outcome (success or error)
3. If the operation can fail silently, add an explicit error log
4. For retry/loop patterns, log attempt count
