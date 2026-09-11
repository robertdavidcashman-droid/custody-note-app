# Forensics: Missing Medway attendance — 7 Sep 2026

**Product:** Custody Note (Electron + custodynote.com sync)  
**Investigation branch:** `cursor/attendance-durability-forensics-f170` (extends empty-cloud alarm PR #33 / 1.9.84 → **1.9.85**)  
**Case (field report, non-binding):** Calin Costache / Costa — Medway/Gillingham — interview ~15:44 BST 7 Sep 2026  
**Agent limitation:** This environment cannot see Robert’s disks or live licence cloud data. Do not invent that the Costache row exists in cloud.

---

## Part A — Architecture + storage map

### End-to-end path (code-backed)

```
User edits (renderer app.js)
  → quietSave / saveForm
  → preload attendanceSave
  → ipcMain 'attendance-save' (main.js)
  → in-memory sql.js UPDATE/INSERT (sync_dirty=1, sync_version++)
  → markDbDirty() → backup scheduler + scheduleSyncSoon()
  → enqueueSyncForRecord() → sync_queue
  → finishAttendanceSaveResult() → flushDbSync()  [1.9.85: ALL statuses]
  → IPC returns { id, durable, pendingSync, syncDirty }
  → UI: "Saved locally · pending sync" (not "Synced")
  → syncWorker push → POST /api/sync/push (licence key)
  → assertPushAccepted(written >= sent) → clear sync_dirty
  → syncPull ← GET/POST /api/sync/pull (merge by sync_id)
  → backupScheduler → userData/Backups/ (verified CNDB)
```

### Storage locations

| Path | Role |
|------|------|
| `userData/attendances.db` | Live encrypted SQLite (CNDB AES-256-GCM envelope) |
| `userData/encryption.key` | OS safeStorage-wrapped master key |
| `userData/recovery.dat` | Recovery-password wrap of master key |
| `userData/master.fallback` | Fallback when safeStorage unavailable |
| `userData/Backups/attendance-latest.db` | Latest quick pointer (includes dirty rows) |
| `userData/Backups/attendance-quick-*.db` | Generational quick snapshots (1.9.85+; retain 48) |
| `userData/Backups/attendance-backup-*.db` | Hourly multi-generation archives |
| `sync_queue` / `sync_dirty` / `sync_id` / `sync_version` | Offline-first queue + conflict helpers |
| `deleted_at` / `archived_at` | Soft-delete / archive (preferred over hard DELETE) |
| `https://custodynote.com/api/sync/push\|pull` | Licence-hash scoped record sync (S3 behind API) |
| `POST /api/backup/credentials` | Managed cloud backup credentials (Pro-gated) |

### Explicit answers

| Question | Answer | Evidence |
|----------|--------|----------|
| **Can UI show saved before durable local write completes?** | **Before 1.9.85: YES for drafts.** IPC returned after in-memory `dbRun`; durable write waited up to **30s** debounce (+ 3s idle grace) via async `saveDb`. Finalise/complete already called `flushDbSync`. **After 1.9.85: NO** — every `attendance-save` calls `flushDbSync` before return; UI shows “Saved locally” only when `durable:true`. | `markDbDirtyForSave` / `DB_SAVE_DEBOUNCE_MS=30000`; `finishAttendanceSaveResult`; renderer `showAutoSaveIndicator({ durable })` |
| **Can empty pull wipe local records?** | **NO.** Empty `records[]` merges nothing; no `DELETE FROM attendances`. Soft-delete only if remote tombstone for **same** `sync_id` wins and local is not dirty. | `syncPull` merge loop; `lib/syncLocalPreserve.js` |
| **Can Full re-sync destroy local-only?** | **NO.** Resets pull cursor → from-epoch pull → additive merge. Local-only rows kept. | `runFullSyncFromCloud`; `fullResyncMayDestroyLocalOnly()===false` |
| **Are soft-deletes preferred?** | **YES.** User delete sets `deleted_at`. Hard `DELETE` only for draft dedupe cleanup. | `attendance-delete` returns `{ soft: true }` |
| **Does backup verify after write?** | **Before 1.9.85: NO.** **After 1.9.85: YES** — CNDB magic + size check via `verifyEncryptedBackupFile`. | `lib/backupVerify.js`; `_runQuickBackupAsync` / hourly / `backup-now` |

### Conflict / merge rules (pull)

1. No local `sync_id` → INSERT remote  
2. Local finalised/completed vs non-matching remote status → BLOCK + conflict  
3. Remote newer + local `sync_dirty=1` → BLOCK (`preserve_local_dirty`)  
4. Remote newer + clean local → UPDATE (may set `deleted_at` from remote tombstone)  
5. Remote older/equal → no-op  

### Licence / auth

Sync APIs require licence key → server scopes by **licence hash** (not machine id). Machine id is metadata. Invalid/missing key → no pull/push.

---

## Part B — Git suspects (Aug–Sep 2026)

No reverts performed. Shortlist of commits touching sync / save / dirty / Full re-sync / backup:

| Commit | Relevance |
|--------|-----------|
| `7ef600c` | `fix(durability): flushDbSync on suspend/lock and attendance finalise` — drafts still deferred |
| `23c82a7` / `c1f5ace` / `d037eb0` | Push ack / empty-cloud / re-upload (1.9.82 class) |
| `0c50761` | Do not treat incremental empty pulls as empty cloud |
| `54f526f` / `fa7e5a1` | Full re-sync from-epoch; pull-empty documentation |
| `99635c9` / `40795c4` | Re-upload drain + Data & Sync health |
| `9ed85fd` / `46d49d6` | PR #33 empty-cloud alarm (1.9.84) |
| `a7cf373` / `d8961c8` | Mac→Windows unlock / master.fallback (data access, not wipe) |

**Ruled out as wipe mechanism:** empty pull / Full re-sync deleting local-only (code never did hard wipe on empty cloud).

**Still plausible for Costache absence (needs live disks):**

1. Draft never durable-flushed on creating Windows machine (crash/kill within debounce window) — **addressed in 1.9.85**  
2. Note never created on that device (only reconstructed draft from transcript later)  
3. False push-ack cleared dirty while cloud never stored (1.9.82 class) — other machines never received it  
4. Wrong licence / different userData profile  

---

## Part C — Permanent fixes shipped in 1.9.85

- Durable `flushDbSync` on **all** attendance-save paths; IPC returns `{ id, durable, pendingSync }`  
- Honest UI: “Saved locally · pending sync” vs footer “Synced”  
- Explicit empty-cloud preserve guards + Full re-sync non-destructive assertion  
- Backup post-write CNDB verify; backup-status surfaces last success/failure + verify  
- Soft-delete flush to disk; integrity checker IPC (report only, `autoDelete:false`)  
- Metadata-only `[SAVE]` / `[INTEGRITY]` logs (no note bodies)  
- Autotests in `tests/attendanceDurability.test.js`

---

## Live-machine evidence still required

This agent **cannot** confirm whether Costache exists in production cloud or on Robert’s Framework12 / Macs / Main-PC.

### How to verify cloud inventory (read-only)

On a machine with the live licence activated:

1. Settings → **Integrity check (local vs cloud)** — reports local counts vs `lastVerifiedCloudInventory` without deleting.  
2. Settings → **Full re-sync from cloud** (only if cloud is known non-empty) — note `received` / `merged`.  
3. Or scripted: authenticate and call `POST https://custodynote.com/api/sync/pull` with `{ key, machineId, since: "1970-01-01T00:00:00.000Z" }` and inspect `record_count` / `records.length` (metadata only; envelopes need master key to decrypt bodies).  
4. Preserve-first local inventory: `npm run inventory:sync-storage` / `CUSTODYNOTE_USERDATA=... node scripts/inventory-sync-storage.mjs`  
5. Search local/backups for station Medway/Gillingham + date 2026-09-07 via record-index export (no bodies) or offline decrypt of a **copy** of `attendances.db` + key.

**Do not** invent a cloud row. If from-epoch pull returns `records: []` / inventory 0 and no local/backup row matches, the attendance is not recoverable from sync alone.

---

## Confirmed vs ruled-out claims

| Claim | Status |
|-------|--------|
| UI could claim saved before disk flush (drafts) | **Confirmed** pre-1.9.85 |
| Empty cloud pull wiped local DBs | **Ruled out** in code |
| Full re-sync destroyed local-only | **Ruled out** in code |
| False push-ack could hide empty cloud | **Confirmed** historically; mitigated 1.9.82–1.9.84 |
| Costache row exists in cloud | **Unknown** — needs live `/api/sync/pull` inventory |
| Costache wiped by reconciliation | **Unlikely** — no empty-wipe path; prefer “never durable / never pushed / never created” |

---

## Backup scheduler reality (Framework12 follow-up)

### (1) Confirmed in source — intervals & overwrite (pre-1.9.85)

| Layer | Value | Notes |
|-------|-------|-------|
| `main/backupScheduler.js` default (older) | quick **15 min**, idle grace 45s, periodic 3 min | Module defaults only |
| **`main.js` `getBackupScheduler()` wiring** | quick **`30 * 60 * 1000` (30 min)**, idle 90s, periodic 10 min | **This is what the app actually ran** — overrode module defaults |
| Quick file | **Single overwrite** `Backups/attendance-latest.db` | No point-in-time within the hour |
| Hourly | `attendance-backup-<ISO>.db` | Keep 24 hourly + 7 daily reps |
| On missing folder | `isBackupFolderReady()` → `{ skipped: true, reason: 'backup-folder-missing' }` | Could look calm; no durable Home ERROR historically |
| Contents | Live in-memory export via `getEncryptedDbExport()` | **Includes dirty / unsynced rows** when folder is writable |

Robert expected backups every couple of minutes; production quick cadence was **30 minutes**, not 2.

### (2) Why `Backups/` can be empty while the app runs

1. After Mac→Windows restore, `settings.backupFolder` still held `/Users/…/Backups` — not creatable on Windows; every scheduled run skipped.  
2. Fresh installs historically stored the path without `mkdir` (later mitigated by `ensureBackupFolderExists`, but foreign OS paths still broke readiness).  
3. Off-site OneDrive (`offsiteBackupFolder`) could still receive copies while primary local Backups never wrote — UI did not make the split obvious.  
4. **Do not invent** that Costache is in any Framework12 backup without reading those files (prefer preserve-first search of OneDrive Sep 7–8 offsite copies).

### (3) 1.9.85 hardenings

| Change | Behaviour |
|--------|-----------|
| Quick interval | **`2 * 60 * 1000`** in both scheduler default **and** `getBackupScheduler()` wiring |
| Generational quick | Writes `attendance-latest.db` **and** `attendance-quick-<ISO>.db`; prune keeps **48** quick gens |
| Verify | Post-write CNDB magic + size (`verifyEncryptedBackupFile`) |
| Dirty rows | Unchanged — export is full live DB including `sync_dirty=1` |
| No silent skip | `_notifyBackupDegraded` → Home banner + Settings + footer |
| Path sanitize | Foreign OS `backupFolder` auto-resets to `userData/Backups` |

### (4) Tests

- `tests/backupPathAndGenerational.test.js` — path reset, generational naming, degraded UI, main.js 2‑min wiring  
- `tests/backupScheduler.test.js` — N‑minute cadence / retention around dirty saves that never reach cloud  
- `tests/attendanceDurability.test.js` — verify + integrity without auto-delete

**Platform (Windows + Mac):** backup location is always visible in Settings; foreign-OS paths cannot silently disable local backups after restore. **Save now** (Ctrl+S) forces disk flush + verified backup with explicit success/failure copy.

---

## Platform impact

- **Mac:** same durability flush, UI honesty, backup verify, integrity check, generational quick backups, path sanitize  
- **Windows:** identical product behaviour; path sanitise specifically fixes Mac→Windows restore leaving `/Users/…` in `backupFolder` (OS integration allowlist)
