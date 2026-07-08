# Sync Reliability Investigation — Root Cause & Resilience Review

## 1. End-to-end sync path

```
[Electron app]
  markDbDirty() → scheduleSyncSoon() (3s debounce)
  OR 30s interval → runSyncCycle()
    → syncPush(): SELECT dirty rows (LIMIT 50) → httpPost(/api/sync/push) [30s timeout]
    → On success: dbRun(UPDATE sync_dirty=0 WHERE sync_id=? AND sync_version=?) [debounced save 500ms]
    → syncPull(): httpPost(/api/sync/pull, { since: lastSyncPullAt }) [30s timeout]
    → On success: merge into attendances, setLastSyncTimestamp(resp.serverTime), saveDb() if merged > 0
    → IPC sync-status-changed
[Next.js API]
  POST /api/sync/push → validateLicenceKey (KV) → syncPushRecords(licence.hash, records)
  POST /api/sync/pull → validateLicenceKey → syncPullRecords(licence.hash, since, machineId)
[AWS]
  getSyncS3Client() → STS AssumeRole (cached 14 min) → S3
  syncPushRecords: PutObject per record, batches of 10 in parallel
  syncPullRecords: ListObjectsV2 → filter LastModified > since → GetObject in batches of 10, cap 200
```

**Source event:** Any mutation (save, archive, unarchive, delete) sets `sync_dirty=1`, `markDbDirty()` → `scheduleSyncSoon()`.
**Persistence:** Local SQLite via `dbRun()` (debounced 500ms to disk). S3 is the remote store; no queue.
**Acknowledgement:** Client clears `sync_dirty` only after `resp.ok` and only for rows where `sync_version` matches (race-safe).

---

## 2. Root cause analysis

### A. No retry with backoff (primary cause of “recurring sync errors”)

- **Location:** `main.js` `runSyncCycle()` → `syncPush()` / `syncPull()`.
- **Behaviour:** One failure (network, timeout, 5xx, 429) is logged and the cycle returns `hadError: true`. The next attempt is either in 30s (timer) or 3s after next mutation (`scheduleSyncSoon`). There is **no retry within the same cycle** and **no exponential backoff**.
- **Impact:** Transient blips (e.g. AWS throttling, brief network drop) cause user-visible “Sync error” and leave records pending until a later cycle succeeds. If the environment is flaky, failures can appear “recurring” even though each attempt is a single shot.

### B. lastSyncPullAt only advances on full pull success

- **Location:** `main.js` `syncPull()` — `setLastSyncTimestamp(resp.serverTime)` only when `resp.ok`.
- **Behaviour:** If pull fails (timeout, 500), `lastSyncPullAt` is not updated, so the next pull re-requests from the same `since`. This is correct for at-least-once semantics but combined with (A) means repeated failures keep re-fetching the same window and can repeatedly hit timeouts or rate limits.

### C. Local persistence of “cleared” dirty flag is debounced

- **Location:** `main.js` — after push success we `dbRun('UPDATE ... sync_dirty=0 ...')` which triggers `markDbDirtyForSave()` → 500ms debounced `saveDb()`.
- **Behaviour:** If the app exits or crashes before the 500ms timer fires, the on-disk DB still has `sync_dirty=1` for those rows. On restart we treat them as pending and push again (idempotent on S3). So we do **not** lose data, but we can double-push after a crash (acceptable; S3 overwrite is idempotent).

### D. Server-side: partial batch failure leaves no per-record audit

- **Location:** `custody note - website production/src/lib/aws.ts` `syncPushRecords()` — batches of 10 with `Promise.all`. If one PutObject fails, the whole batch throws and the API returns 500.
- **Behaviour:** Client does not clear any `sync_dirty` (correct). No server-side durable log of which keys were written or failed, so operators cannot see “record X succeeded, record Y failed” without adding logging/table.

### E. No correlation ID or structured sync audit

- **Location:** Entire sync path (client and server).
- **Behaviour:** Logs are ad hoc (`[Sync] Push FAILED: ...`). No correlation ID tying a single sync attempt to push + pull, and no durable table of attempts (timestamp, direction, count, error). Hard to debug “which attempt failed and what was in flight”.

### F. Pull cap with no continuation token

- **Location:** `aws.ts` `syncPullRecords()` — returns at most `MAX_PULL_RECORDS` (200) per request; `since` is a timestamp.
- **Behaviour:** If a subscriber has >200 records modified since `since`, only 200 are returned. The client updates `lastSyncPullAt` to `serverTime` and will get the “next” 200 on the next pull (since S3 list is ordered and we filter by `LastModified > since`). So eventually consistent, but after long offline periods many round-trips may be needed. No explicit continuation/cursor.

### G. STS credential cache and failures

- **Location:** `aws.ts` `getSyncS3Client()` — caches client until 1 minute before TTL (14 min).
- **Behaviour:** If STS AssumeRole fails (e.g. network, IAM), the API throws and returns 500. There is no retry of credential fetch in the same request. Client sees “Sync push failed” and will retry on next cycle (after we add client retries, this is partly mitigated).

### H. Rate limiting (429)

- **Location:** API routes use `checkRateLimit("sync-push"|"sync-pull", ip, 120/hour)`.
- **Behaviour:** On 429 the API returns `{ ok: false, error: "Too many requests..." }`. Client treats this like any other error (no special backoff). High-frequency retries could hit 429 repeatedly.

---

## 3. Where failure occurs (mapping)

| Phase | Failure mode | Current behaviour |
|-------|----------------|-------------------|
| Before send | No API URL / no licence | Returns early, no error to user for “sync error” (status shows “pending”) |
| During send | Network error, timeout, TLS | httpPost rejects; runSyncCycle catches, sets hadError, no retry |
| After send, before persistence | Server 500 after partial S3 write | Client does not clear dirty; records retried next cycle. Server has no per-record log. |
| After persistence, before ack | N/A (we ack by clearing dirty only after resp.ok) | — |
| Duplicate processing | Same record pushed twice (e.g. after crash) | S3 PutObject overwrites; idempotent. |
| Out-of-order | Pull merges by sync_id + version; remote wins if newer | Correct. |
| Silent failure | Errors only in console.error; no durable audit | Operators cannot trace “record X never synced” without more logging. |

---

## 4. Stability assessment

- **Intermittent:** Yes — single-attempt design makes transient issues look “recurring”.
- **Environment-specific:** Possible (e.g. gov WiFi, proxy) due to timeout/redirect/network.
- **Data-specific:** Unlikely except for very large payloads (timeout) or malformed data (validation error).
- **Concurrency-related:** Single-threaded sync (`_syncInProgress`); no concurrent workers.
- **Load-related:** Rate limit 120/hour per IP; many devices behind same IP could hit it. S3 batch size and 30s timeout are reasonable.
- **Timeout-related:** 30s was added; previously 10s caused pull timeouts with many records.
- **Credential-related:** STS cache; if credentials expire mid-batch, entire request fails.

**Currently guaranteed:**

- **No record loss (best effort):** Dirty records stay dirty until push succeeds; pull merges into local DB. If app crashes before clearing dirty, we retry push (idempotent).
- **No duplicate records (merge by sync_id):** Pull uses sync_id; insert or update by version. Push overwrites same key on S3.
- **No silent “success” with partial write:** Client only clears dirty on `resp.ok`; server returns 500 if any S3 write in the batch fails.

**Not guaranteed:**

- **Replayability after failure:** No durable log of “this batch failed with this error”; only in-memory/console.
- **Auditability per record:** No table or log like “record sync_id=X last attempt at T, result=success|fail”.
- **Bounded retries:** No limit on how many times we retry (we will keep trying every 30s or 3s after mutation); no circuit breaker.
- **Ordering across devices:** Last-write-wins by version/updatedAt; no strong ordering guarantee across machines.

---

## 5. Resilience review summary

| Area | Status | Notes |
|------|--------|--------|
| Retry logic | Missing | Single attempt per cycle |
| Exponential backoff | Missing | Fixed 30s / 3s |
| Jitter | Missing | Could add to avoid thundering herd |
| Timeout | Set | 30s for sync (client) |
| Circuit breaker | Missing | No pause after N failures |
| Idempotency keys | Present | sync_id; S3 key = sync_id; version used for conflict |
| Deduplication | Present | sync_id unique; remote wins by version |
| Transactional integrity | Partial | Client: multiple dbRun; no explicit transaction around “clear dirty”. Server: no transaction (S3 per key). |
| Atomic writes | Partial | Each S3 PutObject is atomic; batch is not all-or-nothing (we throw on first failure in batch). |
| Poison message | N/A | No queue |
| Dead-letter | N/A | No queue |
| Lock / concurrency | Present | _syncInProgress prevents overlapping runSyncCycle |
| Ordering | Best-effort | ORDER BY updated_at ASC for push; pull order from S3 list |
| Logging | Weak | console.info/error only; no correlation ID |
| Alerting | None | No metrics or alerts |
| AWS credential refresh | Cached | 14 min; no retry on STS failure |
| Partial success (server) | Fails whole batch | One PutObject failure → 500 |
| Rollback / compensation | None | No explicit rollback; we simply don’t clear dirty on failure |

---

## 6. Fixes to implement

1. **Client (main.js)**  
   - Add retry with exponential backoff (and jitter) for `syncPush` and `syncPull` within `runSyncCycle` (e.g. max 3 attempts, 2s/4s/8s with jitter).  
   - After clearing `sync_dirty`, call `flushDb()` so the cleared state is persisted immediately (avoid relying on 500ms debounce before process exit).  
   - Add a simple **sync_attempts** table (or append-only log file): `timestamp, direction (push|pull), count, error?, correlation_id`, and write one row per attempt (success or failure).  
   - Optionally add a correlation ID (UUID) per runSyncCycle and log it (and pass to server in a header if we extend API).  

2. **Server (Next.js + aws.ts)**  
   - Add correlation ID from header or generate one; log it in every sync push/pull (structured log: correlationId, direction, recordCount, duration, error).  
   - For `syncPushRecords`, optionally log each syncId written (at debug level) or at least count. On failure, log the error and correlation ID so operators can correlate with client.  
   - Consider retrying STS `AssumeRole` once on failure (transient network).  
   - Consider retrying individual S3 PutObject (e.g. once with short delay) before failing the batch (optional).  

3. **Reconciliation**  
   - Add an admin or diagnostic endpoint (or script) that, given a licence key hash, lists sync keys in S3 and compares with a client-provided list of sync_ids (or lastSyncPullAt + count). This allows “do I have any records in S3 that this device never got?”.  
   - Document that operators can use `lastSyncPullAt` and pending count to assess backlog.  

4. **Observability**  
   - Structured logs: JSON with correlationId, direction, count, error, duration.  
   - Client: log sync_attempts to table or file so that “last 10 attempts” can be shown in Settings/Support.  
   - Optional: expose a simple “sync health” in sync-status (e.g. last attempt result, last error message) for support.  

5. **Tests**  
   - Unit: syncPush retry (mock httpPost to fail then succeed).  
   - Unit: syncPull retry; syncPull updates lastSyncPullAt only on success.  
   - Integration: push then pull, assert record present and dirty cleared.  
   - Failure injection: timeout, 500, 429; assert retries and eventual success or clear error.  

---

## 7. Remaining edge cases (after fixes)

- **Clock skew:** Pull uses server `serverTime`; if server clock is behind, we might re-fetch some records (safe). If ahead, we might skip briefly (unlikely).  
- **>200 records in one pull:** We cap at 200; client needs multiple pulls to catch up (already the case).  
- **Rate limit 429:** We will retry with backoff; if many devices share an IP, they could still hit 120/hour — consider per-licence or per-machine-id limit in future.  
- **STS or S3 region outage:** Retries and backoff improve resilience but cannot fix a prolonged AWS outage; we rely on “eventually consistent” and durable dirty flag.  

---

## 8. Deliverables implemented

### A. Root cause summary
See §2 (no retry, debounced persist of cleared dirty, no correlation ID, server no retry on STS).

### B. Risk assessment
See §4 (what is guaranteed / not guaranteed) and §5 (resilience review).

### C. Code changes
- **Client (main.js):** sync_attempts table; generateCorrelationId; logSyncAttempt; withRetry (exponential backoff + jitter); flushDb() after clearing sync_dirty; runSyncCycle passes correlationId to push/pull and logs each attempt; sync-status returns lastAttempts (last 10).
- **Client httpPost:** optional headers (X-Correlation-Id sent for sync).
- **Server push/pull routes:** getCorrelationId from header or generate; structured log (JSON) per request with correlationId, recordCount, durationMs, error; 429/500 logged with correlationId.
- **Server aws.ts:** getSyncS3Client retries once on STS failure (clear cache and retry).

### D. Why the changes fix the issue
- Retries with backoff absorb transient network/AWS blips so one failure does not mean "sync error" until the next 30s cycle.
- flushDb() after clearing dirty ensures the "synced" state is persisted before process exit, reducing double-push after crash.
- sync_attempts gives a durable audit trail so operators can see last 10 attempts (and correlationId) for support.
- Correlation ID ties client and server logs for the same cycle.
- STS retry once reduces 500s due to brief credential or network glitches.

### E. Remaining edge cases
- Clock skew; >200 records per pull (multiple round-trips); 429 if many devices share IP; prolonged AWS outage (eventual consistency only). See §7.

### F. Tests added
- `tests/syncReliability.test.js`: unit tests for retry behaviour (first success, retry then success, max attempts then throw, backoff shape). Run with `npm run test:unit`.

### G. Operational recommendations
- Monitor server logs for `[Sync push] error` and `[Sync pull] error`; alert on repeated failures for same correlationId or high error rate.
- Use sync-status.lastAttempts in support to see recent failures and correlationId for server log lookup.
- Optionally add an admin endpoint to list S3 sync keys for a licence hash to reconcile "missing" records.

### H. Incident-prevention checklist for future deployments

- [ ] Any change to sync path: run integration test (push + pull + assert).
- [ ] Before changing timeout/rate limits: check impact on 200-record pull and 50-record push.
- [ ] Any new env (e.g. new API URL): verify redirect and TLS (httpPost already follows redirects).
- [ ] After adding new S3 permissions: verify AssumeRole policy includes sync/* and recovery/*.
- [ ] Logging changes: ensure correlation ID (or equivalent) is in every sync log line.
- [ ] If adding a queue later: design for idempotency (sync_id + version) and at-least-once delivery.
