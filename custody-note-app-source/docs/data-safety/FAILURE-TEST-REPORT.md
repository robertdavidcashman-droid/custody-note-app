# FAILURE-TEST-REPORT — Data safety

Negative / failure-path cases the suite and code must continue to reject.

| Failure injected | Expected behaviour | Test / guard |
|------------------|--------------------|--------------|
| Disk flush fails | Attention required; no “Safe locally” | `resolveForceSaveState({ noteDurable:false })` |
| Flush timeout / ENOSPC | Restore `_dbDirty`; never claim durable | `shouldRestoreDirtyAfterFlush` + `flushDbAsyncBounded` |
| Post-flush file missing magic | Not durable | `evaluatePostFlushDurability` / `verifyEncryptedBackupFile` |
| Written ID array padded/wrong | Refuse push ack; outbox retained | `normalizeWrittenAck` + `assertPushAccepted` |
| Backup folder missing/unwritable | Safe locally + backup warning; never silent success | saveNowResult + backup path tests |
| Push `ok:true` `written:0` | Dirty retained; outbox not cleared | assertPushAccepted / mayClearOutboxEntry |
| Push omits `written` | Ambiguous → safe retry | isAmbiguousPushAck |
| HTTP 429 | Rate-limit gate; local retained | createRateLimitGate |
| Empty cloud pull with local>0 | Preserve local; no wipe | emptyCloudPullPolicy |
| Pull `wipe` / unmatched delete | Throw REFUSING_DESTRUCTIVE_PULL | assertPullBatchNonDestructive |
| Remote missing id without tombstone | Monitor ERROR; retain local | detectRemoteDisappearWithoutTombstone |
| Apply remote lower sync_version | Skip / conflict | detectRevisionGoingBackwards |
| Restore empty backup over live>0 | Refused | mayRestoreBackupOverLive |
| Migration shrink ≥10% | CRITICAL abort signal | detectMigrationShrink |
| Re-enqueue while status=syncing | Prior syncing row kept | syncWorker enqueue test |
| Master key missing | Monitor CRITICAL; stop destructive sync | detectAuthOrKeyProblems |

## Known residual failure modes (see REMAINING-RISKS.md)

- Force Save drain is sized from outbox depth with absolute ceiling; if still pending → honest Syncing + `forceSaveDrainPending` background continue (never false Synced)  
- Revision table stores hashes not full encrypted bodies (full body recovery: generational CNDB and/or website `sot-pitr`)  
- Server SoT PITR live suite: website-owned; client contracts proved in-app (`serverPitrContract`)  
