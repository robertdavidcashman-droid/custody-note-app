/**
 * Sync engine integration tests: offline persistence, network failure retry,
 * queue recovery, race conditions.
 *
 * Uses an in-memory mock database context to exercise the sync worker logic
 * without requiring Electron or a real SQLite instance.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createSyncWorker, isRetryableError, MAX_RECORDS_PER_CYCLE, PUSH_HTTP_BATCH_SIZE, HEALTH_CHECK_TIMEOUT_MS } = require('../main/syncWorker');

function createMockCtx(overrides = {}) {
  const tables = {
    sync_queue: [],
    attendances: [],
    settings: [],
  };
  let idCounter = 1;

  function dbAll(sql, params = []) {
    if (sql.includes('FROM sync_queue')) {
      let rows = [...tables.sync_queue];
      if (sql.includes("status IN ('pending','syncing')") || sql.includes("status = 'pending'")) {
        rows = rows.filter(r => r.status === 'pending' || (sql.includes('syncing') && r.status === 'syncing'));
      }
      else if (sql.includes("status = 'blocked'")) rows = rows.filter(r => r.status === 'blocked');
      else if (sql.includes("status = 'failed'")) rows = rows.filter(r => r.status === 'failed');
      else if (sql.includes("status IN ('failed','blocked')")) rows = rows.filter(r => r.status === 'failed' || r.status === 'blocked');
      if (sql.includes("status != 'synced'")) rows = rows.filter(r => r.status !== 'synced');
      if (sql.includes('ORDER BY created_at ASC')) rows.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
      const limitMatch = sql.match(/LIMIT\s+(\d+)/);
      if (limitMatch) rows = rows.slice(0, parseInt(limitMatch[1]));
      if (sql.includes('retry_count <')) {
        const cap = params[0];
        rows = rows.filter(r => (r.retry_count || 0) < cap);
      }
      if (sql.includes('COALESCE(last_attempt, 0)')) {
        const now = sql.includes('retry_count <') ? params[1] : params[0];
        const cooldown = sql.includes('retry_count <') ? params[2] : params[1];
        rows = rows.filter(r => (now - (r.last_attempt || 0)) > cooldown);
      }
      return rows;
    }
    return [];
  }

  function dbGet(sql, params = []) {
    if (sql.includes('COUNT(*)')) {
      let rows = [...tables.sync_queue];
      if (sql.includes("status IN ('pending','syncing')") || sql.includes("status = 'pending'")) {
        rows = rows.filter(r => r.status === 'pending' || (sql.includes('syncing') && r.status === 'syncing'));
      }
      if (sql.includes("status='failed'")) rows = rows.filter(r => r.status === 'failed');
      if (sql.includes("status='blocked'")) rows = rows.filter(r => r.status === 'blocked');
      return { c: rows.length };
    }
    if (sql.includes('FROM sync_queue WHERE id=?')) {
      return tables.sync_queue.find(r => r.id === params[0]) || null;
    }
    if (sql.includes('FROM attendances WHERE id=?')) {
      return tables.attendances.find(r => String(r.id) === String(params[0])) || null;
    }
    if (sql.includes('FROM settings')) {
      return tables.settings.find(r => r.key === params[0]) || null;
    }
    return null;
  }

  function dbRun(sql, params = []) {
    if (sql.startsWith('DELETE FROM sync_queue WHERE record_id=?')) {
      tables.sync_queue = tables.sync_queue.filter(r => r.record_id !== String(params[0]));
      return;
    }
    if (sql.startsWith('INSERT INTO sync_queue')) {
      tables.sync_queue.push({
        id: params[0], record_id: params[1], operation: params[2], payload: params[3],
        created_at: params[4], retry_count: 0, last_attempt: params[5],
        status: params[6], error: params[7] || null,
      });
      return;
    }
    if (sql.startsWith('UPDATE sync_queue SET status=?')) {
      if (sql.includes('retry_count=0')) {
        const row = tables.sync_queue.find(r => r.id === params[2]);
        if (row) { row.status = params[0]; row.retry_count = 0; row.last_attempt = params[1]; row.error = null; }
      } else if (sql.includes('error=NULL')) {
        const row = tables.sync_queue.find(r => r.id === params[1]);
        if (row) { row.status = params[0]; row.error = null; }
      } else if (sql.includes('last_attempt=?') && sql.includes('error=?') && sql.includes('retry_count=?')) {
        const row = tables.sync_queue.find(r => r.id === params[4]);
        if (row) { row.status = params[0]; row.error = params[1]; row.retry_count = params[2]; row.last_attempt = params[3]; }
      } else {
        const row = tables.sync_queue.find(r => r.id === params[2]);
        if (row) { row.status = params[0]; row.last_attempt = params[1]; }
      }
      return;
    }
    if (sql.startsWith('UPDATE attendances SET sync_dirty=0 WHERE id=? AND sync_version=?')) {
      const row = tables.attendances.find(r => String(r.id) === String(params[0]) && (r.sync_version || 1) === params[1]);
      if (row) row.sync_dirty = 0;
      return;
    }
    if (sql.startsWith('UPDATE attendances SET sync_dirty=0 WHERE id=?')) {
      const row = tables.attendances.find(r => String(r.id) === String(params[0]));
      if (row) row.sync_dirty = 0;
      return;
    }
  }

  function addAttendance(id, opts = {}) {
    tables.attendances.push({
      id: String(id),
      sync_id: opts.sync_id || 'sid-' + id,
      data: opts.data || '{}',
      status: opts.status || 'draft',
      created_at: opts.created_at || new Date().toISOString(),
      updated_at: opts.updated_at || new Date().toISOString(),
      deleted_at: null, deletion_reason: null,
      client_name: opts.client_name || '', station_name: '', dscc_ref: '', attendance_date: '',
      supervisor_approved_at: null, supervisor_note: '', archived_at: null,
      sync_dirty: opts.sync_dirty !== undefined ? opts.sync_dirty : 1,
      sync_version: opts.sync_version || 1,
    });
  }

  let httpPostCalls = [];
  let httpPostBehaviour = 'succeed';
  let httpPostDelayMs = 0;

  const ctx = {
    db: true,
    dbRun,
    dbGet,
    dbAll,
    flushDb: () => {},
    getSyncApiUrl: () => 'https://test.example.com',
    readLicenceData: () => ({ key: 'test-key' }),
    getMachineId: () => 'test-machine',
    getMasterKeyHex: () => 'a'.repeat(64),
    httpPost: async (url, body, opts) => {
      httpPostCalls.push({ url, body, opts, timestamp: Date.now() });
      if (httpPostDelayMs > 0) await new Promise(r => setTimeout(r, httpPostDelayMs));
      if (httpPostBehaviour === 'succeed') return { ok: true, written: 1 };
      if (httpPostBehaviour === 'timeout') { const e = new Error('Timeout'); e.code = 'ETIMEDOUT'; throw e; }
      if (httpPostBehaviour === 'connrefused') { const e = new Error('Connection refused'); e.code = 'ECONNREFUSED'; throw e; }
      if (httpPostBehaviour === 'badrequest') { const e = new Error('Server error 400'); e.statusCode = 400; throw e; }
      if (typeof httpPostBehaviour === 'function') return httpPostBehaviour(url, body, opts);
      return { ok: true, written: 1 };
    },
    httpGetWithTimeout: async () => ({ statusCode: 200, ok: true }),
    onStatusChange: () => {},
    sendToRenderer: () => {},
    ...overrides,
  };

  return {
    ctx,
    tables,
    addAttendance,
    getHttpCalls: () => httpPostCalls,
    resetHttpCalls: () => { httpPostCalls = []; },
    setHttpBehaviour: (b) => { httpPostBehaviour = b; },
    setHttpDelay: (ms) => { httpPostDelayMs = ms; },
  };
}


describe('Sync Engine: Offline persistence', () => {
  it('enqueues records and they survive in queue', () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    mock.addAttendance(2);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    worker.enqueue('2', 'upsert', {});
    const diag = worker.getDiagnostics();
    assert.strictEqual(diag.queueLength, 2);
  });

  it('records persist after finalise (status change)', () => {
    const mock = createMockCtx();
    mock.addAttendance(1, { status: 'draft' });
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    mock.tables.attendances[0].status = 'finalised';
    worker.enqueue('1', 'upsert', {});
    const diag = worker.getDiagnostics();
    assert.strictEqual(diag.queueLength, 1);
  });

  it('enqueue replaces existing entry for same record', () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', { v: 1 });
    worker.enqueue('1', 'upsert', { v: 2 });
    assert.strictEqual(mock.tables.sync_queue.length, 1);
    assert.ok(mock.tables.sync_queue[0].payload.includes('"v":2'));
  });
});


describe('Sync Engine: Network failure retry', () => {
  it('marks item pending with incremented retry on ETIMEDOUT', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    mock.setHttpBehaviour('timeout');
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const item = mock.tables.sync_queue[0];
    assert.ok(item.status === 'pending' || item.status === 'failed');
    assert.ok(item.retry_count >= 1);
    assert.ok(item.error.includes('Timeout') || item.error.includes('timeout'));
  });

  it('marks item pending with incremented retry on ECONNREFUSED', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    mock.setHttpBehaviour('connrefused');
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const item = mock.tables.sync_queue[0];
    assert.ok(item.retry_count >= 1);
    assert.ok(item.error.includes('refused') || item.error.includes('Connection'));
  });

  it('marks item blocked on non-retryable 400 error', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    mock.setHttpBehaviour('badrequest');
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const item = mock.tables.sync_queue[0];
    assert.strictEqual(item.status, 'blocked');
  });

  it('syncs successfully after network is restored', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    mock.setHttpBehaviour('timeout');
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const afterFail = mock.tables.sync_queue[0];
    assert.ok(afterFail.retry_count >= 1, 'retry_count should increment');
    assert.ok(afterFail.status === 'pending', 'should be pending for retry');
    mock.setHttpBehaviour('succeed');
    afterFail.last_attempt = 0;
    afterFail.retry_count = 0;
    await worker.runCycle();
    assert.strictEqual(afterFail.status, 'synced', 'Item should be synced after network restore');
  });
});


describe('Sync Engine: Queue recovery (batch processing)', () => {
  it('processes all queued items in one cycle when under batch limit', async () => {
    const mock = createMockCtx();
    for (let i = 1; i <= 8; i++) {
      mock.addAttendance(i);
    }
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= 8; i++) {
      worker.enqueue(String(i), 'upsert', {});
    }
    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 8);
    assert.strictEqual(mock.getHttpCalls().length, 1);
  });

  it('flushes large queue in 2 cycles', async () => {
    const total = MAX_RECORDS_PER_CYCLE + 15;
    const mock = createMockCtx();
    for (let i = 1; i <= total; i++) {
      mock.addAttendance(i);
    }
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= total; i++) {
      worker.enqueue(String(i), 'upsert', {});
    }
    await worker.runCycle();
    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, total);
  });

  it('stops batch on first network error', async () => {
    const mock = createMockCtx();
    let callCount = 0;
    mock.ctx.httpPost = async () => {
      callCount++;
      if (callCount === 2) { const e = new Error('Timeout'); e.code = 'ETIMEDOUT'; throw e; }
      return { ok: true, written: 1 };
    };
    const firstBatch = PUSH_HTTP_BATCH_SIZE;
    const secondBatch = 5;
    for (let i = 1; i <= firstBatch + secondBatch; i++) mock.addAttendance(i);
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= firstBatch + secondBatch; i++) worker.enqueue(String(i), 'upsert', {});
    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, firstBatch);
    assert.strictEqual(callCount, 2);
  });

  it('recovers failed items after 5 min cooldown', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    mock.tables.sync_queue[0].status = 'failed';
    mock.tables.sync_queue[0].last_attempt = Date.now() - 6 * 60_000;
    await worker.runCycle();
    assert.strictEqual(mock.tables.sync_queue[0].status, 'synced');
  });

  it('auto-recovers blocked items after 30 min cooldown', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    mock.tables.sync_queue[0].status = 'blocked';
    mock.tables.sync_queue[0].retry_count = 1;
    mock.tables.sync_queue[0].last_attempt = Date.now() - 31 * 60_000;
    await worker.runCycle();
    const status = mock.tables.sync_queue[0].status;
    assert.ok(status === 'pending' || status === 'synced', 'blocked item should be recovered to pending or synced, got: ' + status);
  });

  it('does NOT auto-recover blocked items before 30 min cooldown', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    mock.tables.sync_queue[0].status = 'blocked';
    mock.tables.sync_queue[0].retry_count = 1;
    mock.tables.sync_queue[0].last_attempt = Date.now() - 5 * 60_000;
    await worker.runCycle();
    assert.strictEqual(mock.tables.sync_queue[0].status, 'blocked');
  });

  it('stops auto-recovering blocked items after MAX_BLOCKED_AUTO_RECOVERIES', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    mock.tables.sync_queue[0].status = 'blocked';
    mock.tables.sync_queue[0].retry_count = 3;
    mock.tables.sync_queue[0].last_attempt = Date.now() - 60 * 60_000;
    await worker.runCycle();
    assert.strictEqual(mock.tables.sync_queue[0].status, 'blocked');
  });
});


describe('Sync Engine: Race conditions', () => {
  it('version-aware cleanup: v2 saved during push keeps record dirty', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1, { sync_version: 1, sync_dirty: 1 });
    let pushIntercepted = false;
    mock.ctx.httpPost = async () => {
      if (!pushIntercepted) {
        pushIntercepted = true;
        mock.tables.attendances[0].sync_version = 2;
        mock.tables.attendances[0].sync_dirty = 1;
      }
      return { ok: true, written: 1 };
    };
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    assert.strictEqual(mock.tables.attendances[0].sync_dirty, 1,
      'Record should stay dirty because v2 was written during push of v1');
  });

  it('concurrent enqueue: only one queue item per record', () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    for (let i = 0; i < 20; i++) {
      worker.enqueue('1', 'upsert', { save: i });
    }
    const items = mock.tables.sync_queue.filter(r => r.record_id === '1');
    assert.strictEqual(items.length, 1, 'Should only have 1 queue item for the record');
    assert.ok(items[0].payload.includes('"save":19'), 'Should be the latest version');
  });

  it('forceRetryAll resets failed and blocked items', () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    mock.addAttendance(2);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    worker.enqueue('2', 'upsert', {});
    mock.tables.sync_queue[0].status = 'failed';
    mock.tables.sync_queue[0].retry_count = 6;
    mock.tables.sync_queue[1].status = 'blocked';
    const count = worker.forceRetryAll();
    assert.strictEqual(count, 2);
    assert.strictEqual(mock.tables.sync_queue[0].status, 'pending');
    assert.strictEqual(mock.tables.sync_queue[0].retry_count, 0);
    assert.strictEqual(mock.tables.sync_queue[1].status, 'pending');
  });
});


describe('Sync Engine: Health check advisory', () => {
  it('still processes queue when health check fails (non-blocking)', async () => {
    const mock = createMockCtx();
    mock.ctx.httpGetWithTimeout = async () => { throw new Error('health timeout'); };
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 1, 'Should still sync when health check fails');
  });

  it('skips health check when last push was recent', async () => {
    let healthCalled = false;
    const mock = createMockCtx();
    mock.ctx.httpGetWithTimeout = async () => { healthCalled = true; return { statusCode: 200, ok: true }; };
    mock.addAttendance(1);
    mock.addAttendance(2);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    healthCalled = false;
    worker.enqueue('2', 'upsert', {});
    await worker.runCycle();
    assert.strictEqual(healthCalled, false, 'Health check should be skipped when last push was recent');
  });

  it('blocks on auth_required', async () => {
    const mock = createMockCtx();
    mock.ctx.readLicenceData = () => null;
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 0, 'Should not sync when auth is required');
  });

  it('uses reduced health check timeout constant', () => {
    assert.strictEqual(HEALTH_CHECK_TIMEOUT_MS, 4000);
  });
});


describe('Sync Engine: Error classification', () => {
  it('classifies aborted requests as retryable', () => {
    assert.strictEqual(isRetryableError(new Error('Request aborted')), true);
  });
});
