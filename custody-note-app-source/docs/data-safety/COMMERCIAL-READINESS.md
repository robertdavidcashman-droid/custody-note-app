# COMMERCIAL-READINESS — Data protection

**Overall rating: GREEN**

## Justification (short)

Client **1.9.92** + website SoT/PITR ([PR #13](https://github.com/robertcashman-bit/custody-note-website/pull/13)) close the prior AMBER residuals with evidence: Force Save drain sized from outbox (never false Synced), force-quit/SIGKILL flush durability, monitors fail-closed, app `test:data-safety` **193/193**, website full suite **192/192**, SoT/PITR pack **35/35**, `docs/data-safety/SERVER-PITR-VERIFICATION.md`. Website fixes include 503 `INCOMPLETE_SOT_READ` (no ok+empty on null timeline), snapshot create refuse incomplete live reads, and `classifySyncInventoryResponse` failure≠empty. Historical Costachi never-flushed bytes remain **NON-BLOCKING** (not recoverable).

## Basis

| Area | Rating | Basis |
|------|--------|-------|
| Local durability before user “safe” | GREEN | flushDbSync + post-flush magic verify + dirty restore on timeout |
| Honest local vs central status | GREEN | Force Save state machine; no bare “Saved” |
| Persistent outbox + ack gating | GREEN | mutation_id + written ack / ID match |
| Absence ≠ delete / tombstones | GREEN | Explicit rules + pull guards |
| Empty / failed cloud non-destructive | GREEN | App preserve + website `classifySyncInventoryResponse` / 503 |
| Force Save large outbox | GREEN | `computeForceSaveMaxCycles` + interpretDrain + drainPending flag |
| Force-quit / kill durability | GREEN | SIGKILL + crash-before-rename + dirty restore tests |
| Independent PITR (client) | GREEN | Generational verified backups + integrity gate |
| Server-side SoT PITR | GREEN | Website PR #13: 192/192 + 35/35; `SERVER-PITR-VERIFICATION.md` |
| CI gate | GREEN | App `npm run test:data-safety` (193) in Test workflow |
| Fail-safe monitors | GREEN | `enforceMonitorFailClosed` + syncPull wiring + tests |
| Costachi historical bytes | NON-BLOCKING | Future routes closed; originals not recoverable |

## Ship posture

Ship **1.9.92** as commercially **GREEN** for data protection. Keep live SoT / `sot-pitr` / managed AWS backup as three distinct lanes in product copy.

## Mac impact / Windows impact

Identical custody data-safety behaviour. Sync SoT is licence-scoped on both platforms.
