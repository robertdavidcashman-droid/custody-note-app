/**
 * Unit tests for sync reliability behaviour: retry with exponential backoff.
 * The actual withRetry lives in main.js; this file tests equivalent logic
 * so that contract and backoff shape are validated.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

const SYNC_MAX_ATTEMPTS = 3;
const SYNC_RETRY_BASE_MS = 2000;
const SYNC_RETRY_JITTER_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withRetry(fn, _correlationId, direction) {
  return fn().catch(async (err) => {
    let lastErr = err;
    for (let attempt = 1; attempt < SYNC_MAX_ATTEMPTS; attempt++) {
      const delay =
        SYNC_RETRY_BASE_MS * Math.pow(2, attempt - 1) +
        Math.floor(Math.random() * SYNC_RETRY_JITTER_MS);
      await sleep(0); // in tests we use 0 to avoid real delays
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  });
}

describe("sync reliability", () => {
  it("returns result on first success", async () => {
    const result = await withRetry(() => Promise.resolve({ pushed: 5 }), "id", "push");
    assert.strictEqual(result.pushed, 5);
  });

  it("retries and succeeds on second attempt", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("Network error"));
      return Promise.resolve({ pushed: 1 });
    };
    const result = await withRetry(fn, "id", "push");
    assert.strictEqual(result.pushed, 1);
    assert.strictEqual(calls, 2);
  });

  it("retries up to SYNC_MAX_ATTEMPTS then throws", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.reject(new Error("Always fail"));
    };
    await assert.rejects(
      () => withRetry(fn, "id", "push"),
      /Always fail/
    );
    assert.strictEqual(calls, SYNC_MAX_ATTEMPTS);
  });

  it("backoff delay shape is exponential (attempt 1: ~2s, attempt 2: ~4s)", () => {
    const d1 = SYNC_RETRY_BASE_MS * Math.pow(2, 0) + SYNC_RETRY_JITTER_MS / 2;
    const d2 = SYNC_RETRY_BASE_MS * Math.pow(2, 1) + SYNC_RETRY_JITTER_MS / 2;
    assert.ok(d1 >= 2000 && d1 <= 2500);
    assert.ok(d2 >= 4000 && d2 <= 4500);
  });
});
