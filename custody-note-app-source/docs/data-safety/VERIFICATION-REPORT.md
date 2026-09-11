# CUSTODYNOTE DATA SAFETY VERIFICATION

**Date:** 2026-09-10  
**App version under test:** 1.9.92 (on `master` after PR #42 / 1.9.91 merge)  
**Overall status:** **GREEN**  
**Commercial release for data protection?** **YES**

---

## Executive verdict

Critical silent-loss routes are closed or fail-closed with measurable harness evidence on **both** the desktop app and the website server SoT/PITR lane.

- App: Force Save drain sized from outbox (never false Synced); force-quit/SIGKILL flush durability; monitors fail-closed; licence-scoped account SoT; **193 pass / 0 fail** (`npm run test:data-safety`).
- Website: [custody-note-website PR #13](https://github.com/robertcashman-bit/custody-note-website/pull/13) — full suite **192 pass / 0 fail**; SoT/PITR pack **35 pass / 0 fail**; doc `docs/data-safety/SERVER-PITR-VERIFICATION.md`. Fixes: pull no longer returns ok+empty on null timeline GETs (**503 `INCOMPLETE_SOT_READ`**); snapshot create refuses incomplete live reads; `classifySyncInventoryResponse` failure≠empty.

| Gate | Result |
|------|--------|
| App `npm run test:data-safety` | **193 pass / 0 fail** |
| Website full suite (PR #13) | **192 pass / 0 fail** |
| Website SoT/PITR pack (PR #13) | **35 pass / 0 fail** |
| CI workflow (app) | `.github/workflows/test.yml` → Data-safety gate |
| Never-event / canaries | Pass (chaos seed `20260910`; **1000** canaries) |
| Force-quit / SIGKILL mid-flush | Pass (`dataSafety.greenCloseout`) |

---

## Persistence architecture map (real stack)

```
Renderer (app.js) ──IPC──► Main (main.js)
                              │
                              ▼
                    sql.js in-memory DB
                              │ flushDbSync / atomic write (+ dirty restore on timeout)
                              ▼
              userData/attendances.db  (encrypted CNDB; magic verified on Force Save)
                 Win: %APPDATA%/custody-note/
                 Mac: ~/Library/Application Support/custody-note/
                              │ enqueue mutation_id
                              ▼
                    sync_queue outbox (persistent)
                              │ syncWorker pushRecordBatch (written-ID ack)
                              ▼
         custodynote.com POST /api/sync/push|pull
         Auth: normalised licence key → server licence.hash
         machineId = metadata only (NOT SoT namespace)
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
     Live SoT (per syncId)  Managed AWS     Server sot-pitr/{userId}/
     licence-hash scoped    backup prefix   (website; independent PITR)
              │
              ▼
     Client PITR: userData/Backups/* + optional OneDrive/offsite folder
```

**ONE account-level central SoT?** **YES (proved).** Licence-scoped mock API; Mac machineId push visible to Windows machineId pull; other licence rejected.

---

## Residual closeout

| Residual | Disposition | Evidence |
|----------|-------------|----------|
| Force Save `maxCycles: 3` | **CLOSED** | `computeForceSaveMaxCycles` + `interpretForceSaveDrain` + `forceSaveDrainPending` |
| Packaged / force-quit | **CLOSED** (in-process equivalent) | SIGKILL + crash-before-rename + dirty restore |
| Operator / monitors | **CLOSED** | `enforceMonitorFailClosed` + syncPull wiring |
| Server sot-pitr / central SoT | **CLOSED** | Website PR #13: 192/192 + 35/35 SoT/PITR; `SERVER-PITR-VERIFICATION.md`; 503 `INCOMPLETE_SOT_READ`; `classifySyncInventoryResponse` |
| Costachi historical bytes | **NON-BLOCKING** | Never-flushed originals not recoverable; GREEN = **future** silent-loss routes closed |

---

## A–N answers

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| **A** | Local save durable before UI safe? | **YES** | flushDbSync + magic verify + dirty restore |
| **B** | Force Save distinguishes local vs central? | **YES** | forceSaveStatus states; no bare Saved |
| **C** | Offline: local retained, outbox survives? | **YES** | waiting_for_internet; outbox tests |
| **D** | Restart / force-quit keeps durable copy? | **YES** | SIGKILL + reopen + dirty retain |
| **E** | Lost/ambiguous ack does not clear outbox? | **YES** | mayClearOutboxEntry / assertPushAccepted |
| **F** | Mutation idempotency? | **YES** | buildMutationId |
| **G** | Stale device absence cannot delete newer? | **YES** | tombstone / preserve guards |
| **H** | Empty/failed ≠ empty authoritative dataset? | **YES** | App `emptyOrFailedResponsePolicy` + website `classifySyncInventoryResponse` / 503 `INCOMPLETE_SOT_READ` |
| **I** | Tombstones require matching sync_id? | **YES** | tombstoneRules |
| **J** | Restore refuses empty-over-live? | **YES** | mayRestoreBackupOverLive + PITR score + website snapshot refuse incomplete |
| **K** | PITR independent of live SoT? | **YES** | client gate + website `SERVER-PITR-VERIFICATION.md` |
| **L** | Disk-full / write-fail must not show Saved? | **YES** | attention_required |
| **M** | No silent DB reset / Mac↔Win same SoT? | **YES** | licence-scoped SoT test |
| **N** | Auth expiry / 429 never drop mutations? | **YES** | rate-limit gate + outbox retain |

---

## NON-BLOCKING residuals only

1. **Historical Costachi never-flushed bytes** — not resurrectable; class prevented going forward.  
2. **Dual physical Mac+Windows kill-9 on metal** — in-process SIGKILL + durability harness covers the durability claim; optional ops validation.

---

## Test evidence

```text
App:     npm run test:data-safety  → 193 pass / 0 fail
Website: full suite (PR #13)       → 192 pass / 0 fail
Website: SoT/PITR pack (PR #13)    → 35 pass / 0 fail
Doc:     custody-note-website docs/data-safety/SERVER-PITR-VERIFICATION.md
Chaos seed: 20260910 | Canary scale: 1000
```

---

## Mac impact / Windows impact

Identical custody data-safety behaviour and licence-scoped SoT on both platforms.

---

## Commercial readiness

Ship **1.9.92** as data-protection **GREEN** with NON-BLOCKING residuals above. Do not market managed AWS backup entitlement as sync SoT or as SoT PITR.
