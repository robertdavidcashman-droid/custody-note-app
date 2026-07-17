# Sync Architecture — Offline-First Model

## Overview

Custody Note uses a **true offline-first** sync model. The local SQLite database is the source of truth. Saves never depend on internet connectivity.

## Flow

```
User edits record
    ↓
Renderer saves to SQLite immediately (IPC → main process)
    ↓
Main process writes to attendances, sets sync_dirty=1
    ↓
Main process enqueues sync_queue entry for this record
    ↓
UI updates instantly (no wait for server)
    ↓
Sync worker (background) pushes changes when API is reachable
```

## Components

### `main/syncWorker.js`
- Processes `sync_queue` table per-record
- One failed item never blocks others
- Runs every 10 seconds
- Retry schedule: 0s, 10s, 30s, 2m, 10m, 30m → then marks `failed`
- 8-second HTTP timeout per request

### `sync_queue` table
- `id` — unique queue item ID
- `record_id` — attendance id
- `operation` — upsert | finalise
- `payload` — JSON (minimal; worker reads from attendances)
- `created_at`, `last_attempt` — timestamps
- `retry_count` — for backoff
- `status` — pending | syncing | synced | failed | blocked
- `error` — last error message

### Connectivity states
- `offline` — no API URL
- `auth_required` — no licence key
- `api_available` — health check OK or skipped
- `internet_available_api_unreachable` — timeout, DNS, network error

### Triggers for sync
- App startup (8s delay)
- Every 10 seconds (poll)
- `scheduleSyncSoon()` after any mutation (1s debounce)
- `online` event
- `visibilitychange` (tab focus / wake from sleep)

## Finalise protection

1. **Frontend**: `stopAutoSave()` and cancel debounce before finalise
2. **Frontend**: `quietSave()` skips when `currentRecordStatus === 'finalised'`
3. **Backend**: Rejects any save with `status='draft'` when record is already `finalised`

## Diagnostics

Press **Ctrl+Shift+D** to show:
- Queue length
- Connectivity state
- Last sync time
- Last error
- Failed/blocked counts

## Root causes addressed

| Issue | Cause | Fix |
|-------|-------|-----|
| Sync failures on restricted Wi-Fi | Requests hanging without timeout | 8s timeout, retry backoff |
| "Still trying" misleading | Single batch push; one failure blocked all | Per-record queue; one bad never blocks |
| Finalise not sticking | Autosave overwriting with draft | stopAutoSave + quietSave guard + backend reject |
| No sync on reconnect | Only 30s poll | online + visibilitychange trigger scheduleSoon |

---

## Future: Server-side per-record sync

Currently the API accepts a batch `records` array and returns `ok` / `written` for the whole batch. If one record fails (e.g. validation), the whole batch fails. To support partial success:

1. **API change**: Return `{ ok: true, written: [...syncIds], failed: [{ syncId, error }] }`
2. **Client change**: For each `written` syncId, clear sync_dirty and mark queue item synced; for each `failed`, mark queue item blocked/failed and continue with other records

This would allow true "one bad record never blocks others" at the HTTP layer. Until then, the per-record queue still helps: each record is pushed in its own request, so a failure only affects that one queue item; other items process in subsequent cycles.
