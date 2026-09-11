# Website SoT PITR — companion contract (app ↔ website)

Server `sot-pitr/{userId}/` is owned by `robertcashman-bit/custody-note-website`.

## Website evidence (PR #13 — cite for GREEN)

| Suite | Result | Source |
|-------|--------|--------|
| Full website suite | **192 pass / 0 fail** | [PR #13](https://github.com/robertcashman-bit/custody-note-website/pull/13) |
| SoT/PITR pack | **35 pass / 0 fail** | same |
| Doc | `docs/data-safety/SERVER-PITR-VERIFICATION.md` | website repo |

### Website fixes included in that evidence

- Pull no longer returns `ok` + empty on null timeline GETs → **503 `INCOMPLETE_SOT_READ`**
- Snapshot create refuses incomplete live reads
- `classifySyncInventoryResponse` — failure ≠ empty dataset

## Client contracts proved in this app repo

```bash
npm run test:data-safety   # 193 pass / 0 fail
```

- `lib/serverPitrContract.js` — empty/failed response ≠ wipe; prefix independence; restore scoring
- `lib/backupIntegrityGate.js` — refuse empty-over-live
- `lib/monitorFailClosed.js` — wipe/overwrite blocked when monitors fire
- `tests/dataSafety.greenCloseout.test.js` — PITR + drain + force-quit + monitors

## Commands (website checkout)

```bash
cd custody-note-website
npm ci
npm test
# SoT/PITR pack as documented in SERVER-PITR-VERIFICATION.md
```
