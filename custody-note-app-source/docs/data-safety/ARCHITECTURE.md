# Data-safety architecture — Custody Note

**Audience:** engineering + reliability  
**Invariant:** Once a record is successfully committed, no sync/restart/upgrade/network/stale-device/conflict may make the last recoverable copy disappear.  
**Absence is not deletion.** Deletion requires an explicit tombstone for a matching `sync_id`.

---

## Layers (must stay separate)

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (app.js) — UI state only                           │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC (preload)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Local durable DB (encrypted CNDB / sql.js → attendances.db) │
│  + record_revisions (metadata/hash history)                 │
│  + sync_queue outbox (mutation_id, survives restart)        │
└───────────────────────────┬─────────────────────────────────┘
                            │ push per sync_id (not whole DB)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ CENTRAL ACCOUNT SoT — custodynote.com /api/sync/* (live KV) │
│ Licence-key scoped (NOT device-scoped “Mac vs Windows”)     │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │ independent of live SoT
                │                             ▼
                │              ┌──────────────────────────────────────────┐
                │              │ Server SoT PITR — S3 sot-pitr/{userId}/  │
                │              │ (website: list/create/restore; cron)      │
                │              │ ≠ live KV SoT; ≠ managed AWS backup       │
                │              │ docs: website SERVER-PITR.md / PR #10     │
                │              └──────────────────────────────────────────┘
                │ independent of live SoT
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Client independent PITR / historical recovery               │
│  - Generational local Backups (quick/hourly CNDB verify)    │
│  - Optional offsite folder copy                             │
│  - Managed AWS cloud backup (entitlement) ≠ sync SoT        │
│    and ≠ server sot-pitr                                    │
└─────────────────────────────────────────────────────────────┘
```

**Critical separation:** Live central sync SoT ≠ server `sot-pitr/` snapshots ≠ folder offsite backups ≠ managed AWS backup entitlement. Historical lanes must **not** instantly mirror accidental live SoT damage; they are point-in-time recovery copies.

---

## Where a record can exist

| Location | Role | Authority |
|----------|------|-----------|
| Renderer form memory | Ephemeral UI | Not durable |
| sql.js in-memory DB | Working set | Not durable until flush |
| `userData/attendances.db` (CNDB) | Local durable working copy | Required before “Safe locally” |
| `sync_queue` + `sync_dirty` | Persistent outbox | Survives restart; clear only after ack |
| `record_revisions` | Local overwrite/conflict hints | Metadata + content hash |
| Central `/api/sync` (live KV / S3 per syncId) | **Account-level Source of Truth** | Licence hash scoped |
| Server `sot-pitr/{userId}/` snapshots | **Independent SoT PITR** (website) | Not live SoT; not managed AWS backup |
| `userData/Backups/attendance-quick-*.db` | Independent client PITR | Generational; verified magic |
| `attendance-backup-*.db` hourly | Independent client PITR | Retention window |
| Offsite backup folder | Independent PITR copy | User-configured |
| Managed AWS cloud backup | Disaster recovery product | **Not** sync SoT; **not** `sot-pitr` |
| `sync_conflicts` | Parked remote when local dirty/protected | User resolves |

---

## Force Save / Save Now (required steps)

1. Flush UI → attendance-save (when on form)  
2. Durable local commit + `flushDbSync` verified (`noteDurable`)  
3. Enqueue mutation to persistent outbox (`mutation_id` = sync_id+version+op)  
4. Verified generational backup  
5. Attempt immediate central sync (`drainPendingSyncUploads`)  
6. Require server ack with `written` count (idempotent mutation IDs; ambiguous ack → safe retry)  
7. Update backup integrity snapshot  
8. Show precise status — **never** bare “Saved”:

| State | Meaning |
|-------|---------|
| Attention required | Local durable write failed |
| Safe locally | Disk (+ ideally backup) OK; central not confirmed |
| Waiting for internet | Local safe; offline |
| Syncing | Local safe; push in flight |
| Sync problem — local copy safe | 429/auth/error; local retained |
| Safe locally + central copy confirmed | Local + ack |

Surfaces: last local save, last central sync, pending count, device id.

---

## Sync rules

- **Per-record** upsert by `sync_id` / `sync_version` — **whole-dataset LWW prohibited**  
- Pull is merge-only; empty cloud **preserves** local  
- Soft-delete only via explicit `deleted_at` tombstone for **matching** `sync_id`  
- Stale device absence must not erase newer central or local records  
- Failed cloud reads must **never** be interpreted as empty authoritative dataset for wipe purposes  
- Push clears dirty only when `assertPushAccepted` / `mayClearOutboxEntry` confirms written ≥ sent  

---

## Fail-safe monitors (`lib/dataSafetyMonitors.js`)

Detect and **retain local / do not overwrite known-good** on:

- Sudden local count drop  
- Remote disappear without tombstone  
- Revision going backwards  
- Empty cloud with local data  
- Migration shrink  
- 429 / auth / master key missing / decrypt failure  

## Durability flush policy (`lib/flushDirtyPolicy.js`)

- Bounded async flush (`flushDbAsyncBounded`) must **restore `_dbDirty`** on timeout or write failure — quit must not treat an unconfirmed write as durable.  
- Force Save / Save Now post-flush durability requires: not dirty + file exists + **CNDB magic verified** (`evaluatePostFlushDurability`). Existence alone is insufficient.  

## Verification harness (`lib/dataSafetyHarness.js` + `npm run test:data-safety`)

Deterministic (seeded) chaos catalogue, never-event canary invariant, startup circuit breakers (empty-cloud / false-synced / stale pull), and 1000+ canary scale against the in-repo mock licence-scoped SoT. See `docs/data-safety/VERIFICATION-REPORT.md`.

---

## Server SoT PITR (website — independent lane)

Live account SoT remains `/api/sync/*` (per-record). **Independent** historical recovery on the server is the website `sot-pitr/{userId}/` snapshot lane (list/create/restore APIs, push-debounced + hourly cron, retention 48h hourly + 30d daily, fail-safe restore). Documented in the website repo as `docs/data-safety/SERVER-PITR.md` ([custody-note-website PR #10](https://github.com/robertcashman-bit/custody-note-website/pull/10)).

This **app repo** owns the client contract:

- Confirmed push ack  
- Empty-cloud alarms  
- Generational verified backups + integrity gate  
- Integrity report IPC (`autoDelete: false`)  
- Force Save local vs central status  

Server `sot-pitr` must stay **independent** of live SoT mutation paths and must not be conflated with managed AWS cloud-backup entitlement.

---

## Mac vs Windows

Custody workflow behaviour is identical. Allowed platform differences are OS integration only (paths, menus, updater teardown). Sync SoT is licence-scoped on both platforms — there is no “Mac backup vs Windows backup” as sync authority.
