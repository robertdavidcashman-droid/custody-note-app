/**
 * Unit tests for sync worker: error classification, retry schedule, queue semantics.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { isRetryableError, RETRY_DELAYS_MS, MAX_RETRY_ATTEMPTS, SYNC_REQUEST_TIMEOUT_MS, SYNC_POLL_INTERVAL_MS } = require("../main/syncWorker");

describe("sync worker", () => {
  it("classifies network errors as retryable", () => {
    assert.strictEqual(isRetryableError({ message: "timeout", code: "ETIMEDOUT" }), true);
    assert.strictEqual(isRetryableError({ message: "x", code: "ECONNREFUSED" }), true);
    assert.strictEqual(isRetryableError({ message: "x", code: "ENOTFOUND" }), true);
    assert.strictEqual(isRetryableError(new Error("Timeout")), true);
  });

  it("classifies 5xx and 429 as retryable", () => {
    assert.strictEqual(isRetryableError(new Error("Server error 500")), true);
    assert.strictEqual(isRetryableError(new Error("Server error 503")), true);
    assert.strictEqual(isRetryableError(new Error("Server error 429")), true);
  });

  it("classifies 4xx validation/auth as non-retryable", () => {
    assert.strictEqual(isRetryableError(new Error("Server error 400")), false);
    assert.strictEqual(isRetryableError(new Error("Server error 401")), false);
    assert.strictEqual(isRetryableError(new Error("Server error 403")), false);
    assert.strictEqual(isRetryableError(new Error("Server error 404")), false);
    assert.strictEqual(isRetryableError(new Error("Server error 422")), false);
  });

  it("retry schedule has correct delays", () => {
    assert.strictEqual(RETRY_DELAYS_MS[0], 0);
    assert.strictEqual(RETRY_DELAYS_MS[1], 10_000);
    assert.strictEqual(RETRY_DELAYS_MS[2], 30_000);
    assert.strictEqual(RETRY_DELAYS_MS[3], 120_000);
    assert.strictEqual(RETRY_DELAYS_MS[4], 600_000);
    assert.strictEqual(RETRY_DELAYS_MS[5], 1_800_000);
  });

  it("MAX_RETRY_ATTEMPTS is 6", () => {
    assert.strictEqual(MAX_RETRY_ATTEMPTS, 6);
  });

  it("SYNC_REQUEST_TIMEOUT_MS is 30 seconds", () => {
    assert.strictEqual(SYNC_REQUEST_TIMEOUT_MS, 30000);
  });

  it("SYNC_POLL_INTERVAL_MS is 10 seconds", () => {
    assert.strictEqual(SYNC_POLL_INTERVAL_MS, 10000);
  });
});
