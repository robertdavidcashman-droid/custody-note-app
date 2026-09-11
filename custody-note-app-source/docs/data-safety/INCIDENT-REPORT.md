# INCIDENT REPORT — Costachi / Costache never-event (Medway, 7 Sep 2026)

**Status:** Confirmed loss of original attendance bytes from recoverable stores investigated to date.  
**Product:** Custody Note (Electron desktop)  
**Client (field report):** Calin Costachi / Costache, DOB 26/02/1970, Medway/Gillingham  
**Interview:** ~15:44 on 7 Sep 2026, typed on Windows Framework12  
**Reconstructed draft:** Later inserted as live id **112** (draft) and synced when cloud was healthy  

This report is metadata-oriented. It does **not** invent recovery of the original Costachi note body.

---

## Evidence summary (forensic finding — CONFIRMED)

| Store searched | Result |
|----------------|--------|
| OneDrive Sep 7–8 backups | Freeze at Ellie Smith updated `2026-09-07T13:08:02Z` — **before** the interview |
| Mac live DB / Mac backups | **0** matching attendance |
| LevelDB / Recycle Bin / Main-PC dig | **Empty** for original attendance |
| Historical durable SQLite copies examined | Original attendance **never found** |

**Conclusion:** The original attendance almost certainly **never reached a durable local SQLite flush** on the creating device, despite the user believing save/sync had occurred. Therefore no later sync, backup, or offsite copy could contain it.

---

## Likely mechanism (ordered)

### H1 — Strongest fit: UI/autosave race before durable flush (pre-1.9.85)

Before **v1.9.85**, draft `attendance-save` updated in-memory sql.js and returned to the UI while durable disk write waited on a **~30s debounce** (`markDbDirty` / `saveDb`). A crash, force-quit, sleep, or OS kill inside that window produced:

- User-visible “saved” confidence  
- **No** row in `attendances.db`  
- **No** `sync_queue` outbox entry that could reach the central account store  
- **No** generational backup containing the note  

This matches “never found in any historical DB.”

**Mitigation shipped in 1.9.85:** every attendance-save path calls `flushDbSync` before IPC returns; UI distinguishes durable local vs pending sync.

### H2 — Cross-platform leftover Mac `backupFolder` on Windows

After Mac→Windows restore, `settings.backupFolder` could still hold a Mac path (`/Users/...`). On Windows the local Backups folder appeared **missing/empty** while OneDrive still held an **older** series that stopped before the interview.

**Effect:** User lacked usable **local** recovery copies on Framework12 even if a later draft had been saved. Does not by itself delete cloud SoT; it removes a recovery lane.

**Mitigation shipped in 1.9.85:** foreign-OS backup path auto-reset to `userData/Backups`; Settings shows effective paths and failures.

### H3 — Empty-cloud / rate-limit / full-resync destructive paths

Historically, false push-ack (`ok:true` without `written`) and footer confusion could make Mac look synced while cloud was empty. Empty pull / Full re-sync in current code are **merge-only** and do not wipe local-only rows.

**Partially mitigated** in 1.9.82–1.9.85; this PR adds automated `test:data-safety` proofs (absence≠delete, empty-cloud preserve, ack gating).

### H4 — “Local only” / managed cloud backup entitlement vs sync health

Footer/settings copy historically conflated managed AWS cloud **backup entitlement** with **sync SoT health** and 429 rate limits. Users could read “cloud” as “central copy confirmed” when only local or only backup entitlement applied.

**Mitigation in this release:** Force Save status model explicitly splits **Safe locally** vs **Safe locally + central copy confirmed** vs waiting/sync problem states.

---

## Recovery status

| Item | Status |
|------|--------|
| Original Costachi attendance bytes | **Not recoverable** from stores examined; do not invent them |
| Reconstructed draft id 112 | Exists as later user reconstruction; synced when cloud healthy |
| Cloud at times 429-limited | May delay propagation; does not restore missing original |
| Recommended operator actions | Preserve all Framework12/OneDrive/Mac images; run Integrity check + inventory script; do **not** Full re-sync while cloud inventory is 0 |

---

## Hypotheses verdict

| ID | Verdict |
|----|---------|
| H1 Unsaved / local flush failure | **Accepted** — strongest forensic fit |
| H2 Mac backupFolder on Windows | **Accepted** as contributing recovery silence |
| H3 Destructive empty-cloud sync | **Partially historical**; current code + tests reject wipe |
| H4 Local/cloud UX confusion | **Accepted** — addressed by Force Save status model |

---

## Related documents

- `docs/forensics/MEDWAY_2026-09-07_ATTENDANCE_INVESTIGATION.md`
- `docs/data-safety/ARCHITECTURE.md`
- `docs/EMPTY_SYNC_INCIDENT_RCA.md`
