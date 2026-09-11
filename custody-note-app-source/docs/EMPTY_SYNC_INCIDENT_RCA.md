# CUSTODY NOTE DATA INTEGRITY INCIDENT REPORT

**Product:** Custody Note (Electron desktop + custodynote.com sync API)  
**Version shipping the fix:** 1.9.82  
**Licence (masked):** `CN-A-****-****-0532`  
**Scope:** Mac (Roberts-MacBook-Air ~66 local records) → Windows empty UI / “No remote records”; cloud empty for licence after supposed successful push.

> Note: “Cassidy Note” in earlier drafts refers to **Custody Note** — same product.

---

## Root cause

Multiple verified client defects combined into one production failure class (not a single bug):

1. **False durable push ack** — `pushRecordBatch` treated `{ ok: true }` as success even when `written` was omitted, `0`, or `< sent`, then cleared `sync_dirty` / drained `sync_queue`. Local Mac looked fully synced; Mac’s own pull still `received: 0`; Windows Full re-sync correctly reported “No remote records”.
2. **Push observability gap** — only pull called `logSyncAttempt`, so CDP `lastAttempts` looked pull-only even when push had run (or failed silently).
3. **Restore / worker race** — swapping the in-memory DB while a cycle was in flight could mid-drain dirty counts (e.g. pending=11 of 66) and `markSynced` against the new DB.
4. **No forced re-upload + verify** after raw DB+key file-swap (which does **not** mark dirty) or after “already clean” local state — “Push all pending” is a no-op when dirty=0.
5. **429 spam** — 10s poll kept hitting `checkRateLimit("sync-push"|"sync-pull", ip, 120/hour)` after “Too many requests”.
6. **UX honesty gaps** — large encrypted `attendances.db` (~7.5MB) with 0 UI rows looked like a blank install; Backup queued while Backups folder missing; calm “Synced” while cloud empty. Companion fix: do **not** treat incremental pulls with `received:0` as empty-cloud (require `pulledFromEpoch`).

**Server contract (custodynote.com):** push/pull gated by licence key → records scoped by **licence hash** (not machine id) → S3. Live probes without secrets: missing key → `Missing licence key`; invalid → `Invalid licence key`. Website repo is private (not cloneable from this agent). Managed AWS *backup* is Pro-gated; **record sync** uses the licence key (Free CN-A still syncs when valid).

---

## Yesterday’s record

**Not recoverable from this agent VM** (no user `attendances.db` / backups / cloud credentials with the live licence).

**Primary recovery source:** Mac Air local SQLite with ~66 records (~6.9MB), including yesterday’s completed police-station attendance if it still exists locally.

**Recovery procedure (preserve-first):**

1. On Mac: Settings → **Re-upload all local records to cloud** (v1.9.82+) — marks all non-deleted rows dirty, bumps `sync_version`, rebuilds queue, pushes with confirmed `written`, then **verify pull**.
2. If verify returns `CLOUD_EMPTY_AFTER_PUSH`, keep dirty and retry after rate-limit cooldown; do **not** wipe local DBs.
3. On Windows: **do not delete** the ~7.5MB `attendances.db`. Prefer Full re-sync after Mac verify succeeds; if UI still empty but file is large, restore from Mac copy of `attendances.db` + `encryption.key` + `recovery.dat` (raw swap) **or** in-app restore, then re-upload from the healthy device.
4. Optional read-only inventory: `node scripts/inventory-sync-storage.mjs` (or `CUSTODYNOTE_USERDATA=...`).

**Do not invent missing note text.** If the yesterday row is absent from Mac, Windows, and cloud after inventory, it cannot be reconstructed from this incident alone.

---

## Historical records

| Location | Role | Incident observation |
|----------|------|----------------------|
| `userData/attendances.db` | Live encrypted SQLite | Mac ~6.9MB / 66 rows; Windows ~7.5MB / UI empty |
| `encryption.key` / `recovery.dat` | Crypto material | Required with any DB restore |
| `licence.dat` | Licence ownership | Masked CN-A-…-0532; sync scoped by licence hash |
| `sync_queue` / `sync_dirty` / `sync_id` | Offline-first queue | Cleared prematurely on false ack |
| `sync_attempts` | Audit of push/pull | Previously pull-only |
| `Backups/` | Local rolling backups | Missing on Windows; “Backup queued” |
| `*.tmp` / pre-restore copies | Safety copies | Large Mar `.tmp` / thin pre-cloud-restore on Windows — preserve |
| Cloud S3 via `/api/sync/push\|pull` | Cross-device store | Empty for licence after false ack |
| Renderer localStorage | Not sole DB | Electron SQLite is authoritative; still audit companion web if used |

---

## Record lifecycle map (create → UI)

1. **Create/edit** (renderer) → SQLite `attendances` row with `sync_id` UUID, `sync_dirty=1`, `sync_version++`
2. **Queue** → `sync_queue` pending upsert (`migrateSyncDirtyToQueue` / restore rebuild)
3. **Push** → worker batch → `/api/sync/push` with normalised licence key → require `written >= sent` → only then clear dirty + log push attempt
4. **Licence association** → server stores under licence hash (not machine id); machine id is metadata
5. **Pull** → `/api/sync/pull` since cursor (Full re-sync resets to epoch) → decrypt envelope → merge/conflict
6. **UI** → Home/list refresh; footer phase; Settings **Data & Sync** health (local vs last cloud pull)

---

## Dual-mandate coverage checklist

### (1) Deep-dive / empty-cloud / Windows empty-UI

| Requirement | Status |
|-------------|--------|
| False push ack / empty cloud | Fixed + CDP tests |
| Push vs pull empty / Mac CDP | Fixed + logged pushes + verify |
| 429 rate limit | Gate + UI |
| Re-upload path | Drain + verify |
| Backups folder UX | Ensure on dirty + inventory warning |
| Diagnostics | Ctrl+Shift+D + Settings Open diagnostics |
| Canonical key | Match path retained; keys normalised |
| Full re-sync no-op | Authoritative syncPull |
| Licence casing | `normalizeLicenceKeyForSync` |

### (2) Production data-integrity brief

| Requirement | Status |
|-------------|--------|
| PRESERVE | Inventory script; no wipes; safety copies |
| MAP lifecycle | This section |
| LOCATE yesterday’s record | Mac primary; metadata export; cannot invent text |
| AUTH/ownership | Licence-hash scoped; key normalise |
| Sync states / queue / retry / UI honesty | `deriveSyncPhase`, drain, 429, footer |
| Data & Sync diagnostics | Settings panel + health + schemaVersion |
| schemaVersion | Exposed on sync-status |
| Export / emergency backup | Record-index export (no note bodies) |
| Autotests | emptySyncRecovery + existing sync suites |
| Incident report | This document + PR |
| Cassidy Note = Custody Note | Explicit |

---

## Changes made (v1.9.82)

- `lib/syncPushAck.js` — shared `assertPushAccepted` + `createRateLimitGate` (5 min cooldown after 429)
- `main/syncWorker.js` — durable write required before dirty clear; push `logSyncAttempt`; rate-limit skips push+pull; `lastPush` / `lastVerifiedCloudPushAt`; `resetRuntimeState`
- `main.js` — `resetSyncWorkerAfterDbSwap` on local/cloud restore; `sync-reupload-all` with verify pull → `CLOUD_EMPTY_AFTER_PUSH`; richer `sync-status` (phase, rate limit, last push); auto full-resync also for empty-large-DB; Backups ensure on dirty
- `lib/syncRecoveryHints.js` — empty-large-DB, local-full/cloud-empty, footer suppress, `deriveSyncPhase`
- `app.js` / Settings — Re-upload button; Rate limited / Cloud may be empty / DB empty recovery copy
- `scripts/inventory-sync-storage.mjs` — read-only storage inventory
- Tests: `tests/emptySyncRecovery.test.js` (+ existing syncEngine / stress / crossDevice suites)

---

## Data safety

- No destructive migrations; no wiping DBs; no deleting orphaned rows as part of this fix.
- Restore / re-upload are additive (re-dirty + bump version + upsert).
- Inventory script is explicitly READ-ONLY (no decrypt of note bodies, no writes to attendances.db).
- Structured sync logs omit note body content.

---

## Sync protection

| Requirement | Status |
|-------------|--------|
| Explicit phases (`local_saved` / `pending` / `syncing` / `synced` / `failed`) | `deriveSyncPhase` on sync-status |
| Durable queue + stable `sync_id` UUID | Existing offline-first path retained |
| Idempotent upsert | Server + client upsert by syncId (unchanged contract) |
| Never clear dirty without confirmed `written >= sent` | `assertPushAccepted` |
| 429-safe retry | Rate-limit gate; retryable classification |
| UI honesty | Footer + Settings recovery hints |
| Sync now + pending counts | Existing + lastPush / rateLimit |
| Diagnostics | Ctrl+Shift+D + Settings cross-device panel |
| Conflict handling | Existing `sync_conflicts` path |
| Health: local vs cloud | `health` on sync-status + Settings Data & Sync line |
| schemaVersion | `getDbSchemaVersion()` on sync-status |
| Emergency metadata export | `sync-export-record-index` (no note bodies) |

---

## Update protection

- Installers must not wipe `userData`. This change does not alter NSIS/Mac installer data paths.
- After app update, existing dirty/queue semantics still apply; false-ack class is closed so updates cannot “look synced” with empty cloud.
- Raw file-swap still does not mark dirty — operators must use **Re-upload all** after a raw restore.

---

## Testing

- `node --test tests/emptySyncRecovery.test.js` — false ack, 429 gate, resetRuntimeState, heuristics, phases, product wiring, 66-row mark-all
- Existing: `tests/syncReliability.test.js`, `syncPushAck` / worker / engine / integration / conflicts / crossDevice / stress
- Prefer `npm run test:unit` before ship

---

## Deployment

**Not deployed from this agent.** Ship steps:

1. Merge PR #31 after review.
2. Ensure `package.json` / `changelog.json` stay at 1.9.82 (`npm run check:version`).
3. From a maintained checkout: `npm run deploy` (commits release if needed, pushes app, syncs website releases.json, retags for GitHub Actions Windows+Mac installers).
4. On Mac with data: install 1.9.82 → **Re-upload all local records to cloud** → confirm verify received > 0.
5. On Windows: Full re-sync → confirm Home lists records; if empty-large-DB persists, restore from Mac copy then re-upload from healthy device.

Do not claim production fixed until Mac verify pull and Windows Full re-sync both show records.

---

## Remaining risks

- Server returning a lying `written: N` equal to sent without S3 persistence — mitigated by verify pull on re-upload (`CLOUD_EMPTY_AFTER_PUSH`) and by **empty-cloud auto-heal** (v1.9.91) which probes from epoch when local is full and inventory is unknown/0, then re-uploads with verify.
- Silent skip / days-without-attempts class — closed in v1.9.91 via durable `lastSyncCycleAt` + skip reason on every cycle (including `auth_required` / `rate_limited` / `offline`).
- Website API / RLS changes require private `custody-note-website` access (out of scope when inaccessible). Client does not require an API contract change for this fix.
- Yesterday’s note absent from Mac, Windows, and cloud cannot be fabricated.
- Pre-1.9.82 clients can still clear dirty on incomplete push until updated.
- Pre-1.9.91 clients can still go silent on early skip without heartbeat until updated.

---

## Field facts appendix

| Fact | Explanation |
|------|-------------|
| Mac ~66 records; raw DB+key restored Air-2 UI | Local SQLite is source of truth; raw swap restores rows without touching cloud |
| In-app restore marks dirty; raw swap does not | Restore updates `sync_dirty` / queue; file copy leaves prior dirty=0 |
| After restore+sync: dirty briefly 11 then 0; pull received=0 | Mid-batch sample (20/round) + false ack cleared dirty while cloud empty |
| `lastAttempts` pull-only | Push not logged (fixed) |
| Windows Full re-sync → No remote records; DB ~7.5MB | Cloud empty for licence and/or Full re-sync worker no-op; large file with 0 active UI rows |
| `Too many requests` | 120/hour push+pull rate limit |

## Windows Full re-sync still empty while Mac “pushed”

Even when treating cloud as should-contain Mac records, Windows can still show **No remote records** if:

1. Full re-sync only called `worker.runCycle()`, which returns immediately when `_inProgress` or skips pull after a push 429, while IPC returned `{ ok: true }` (fixed: authoritative `syncPull` after cursor reset).
2. Licence key casing differed between devices while server/mock hashes with `trim().toUpperCase()` (fixed: client normalises push/pull/activate keys).
3. Cloud actually still empty for the licence (Mac false ack pre-1.9.82) — use **Re-upload all** with verify on Mac.
4. Decrypt / missing master key — footer now distinguishes these from “No remote records”.

## Why dirty=11 is not “only 11 marked”

Restore marks **all** non-deleted rows dirty and rebuilds the full queue (`marked`/`queued` returned on restore). CDP sampling mid-batch during a cycle that incorrectly cleared dirty (pre-`assertPushAccepted`) explains a transient pending=11 with `totalRecords=66`. After this fix, incomplete `ok:true` pushes keep dirty=66, push attempts are logged, and **Re-upload all** drains the full queue then verify-pulls — `CLOUD_EMPTY_AFTER_PUSH` if the cloud is still empty.
