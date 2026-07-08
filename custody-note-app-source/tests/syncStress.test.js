/**
 * Stress tests for sync engine.
 *
 * Tests: queue flood, intermittent failure, concurrent save storm,
 * network flap, large payload, stale recovery under load.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createSyncWorker, MAX_RECORDS_PER_CYCLE } = require('../main/syncWorker');

function createMockCtx(overrides = {}) {
  const tables = {
    sync_queue: [],
    attendances: [],
    settings: [],
  };

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
    if (sql.includes('FROM settings')) return null;
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
      } else if (sql.includes('error=?') && sql.includes('retry_count=?')) {
        const row = tables.sync_queue.find(r => r.id === params[4]);
        if (row) { row.status = params[0]; row.error = params[1]; row.retry_count = params[2]; row.last_attempt = params[3]; }
      } else {
        const row = tables.sync_queue.find(r => r.id === params[2]);
        if (row) { row.status = params[0]; row.last_attempt = params[1]; }
      }
      return;
    }
    if (sql.startsWith('UPDATE attendances SET sync_dirty=0')) {
      const row = tables.attendances.find(r => String(r.id) === String(params[0]));
      if (row) row.sync_dirty = 0;
      return;
    }
  }

  function addAttendance(id, opts = {}) {
    tables.attendances.push({
      id: String(id), sync_id: 'sid-' + id, data: opts.data || '{}',
      status: opts.status || 'draft', created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted_at: null, deletion_reason: null,
      client_name: '', station_name: '', dscc_ref: '', attendance_date: '',
      supervisor_approved_at: null, supervisor_note: '', archived_at: null,
      sync_dirty: 1, sync_version: opts.sync_version || 1,
    });
  }

  const ctx = {
    db: true, dbRun, dbGet, dbAll,
    flushDb: () => {},
    getSyncApiUrl: () => 'https://test.example.com',
    readLicenceData: () => ({ key: 'test-key' }),
    getMachineId: () => 'test-machine',
    getMasterKeyHex: () => 'a'.repeat(64),
    httpPost: async () => ({ ok: true, written: 1 }),
    httpGetWithTimeout: async () => ({ statusCode: 200, ok: true }),
    onStatusChange: () => {}, sendToRenderer: () => {},
    ...overrides,
  };

  return { ctx, tables, addAttendance };
}


describe('Stress: Queue flood (100 records)', () => {
  it('processes all 100 records across multiple cycles', async () => {
    const mock = createMockCtx();
    for (let i = 1; i <= 100; i++) mock.addAttendance(i);
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= 100; i++) worker.enqueue(String(i), 'upsert', {});

    const maxCycles = Math.ceil(100 / MAX_RECORDS_PER_CYCLE) + 5;
    for (let c = 0; c < maxCycles; c++) {
      await worker.runCycle();
    }
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 100, `All 100 should be synced, got ${synced}`);
  });
});


describe('Stress: Intermittent 50% failure', () => {
  it('eventually syncs all records despite random failures', async () => {
    let callCount = 0;
    const mock = createMockCtx({
      httpPost: async () => {
        callCount++;
        if (Math.random() < 0.5) {
          const e = new Error('Timeout'); e.code = 'ETIMEDOUT'; throw e;
        }
        return { ok: true, written: 1 };
      },
    });
    for (let i = 1; i <= 10; i++) mock.addAttendance(i);
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= 10; i++) worker.enqueue(String(i), 'upsert', {});

    for (let c = 0; c < 200; c++) {
      for (const q of mock.tables.sync_queue) {
        if (q.status !== 'synced' && q.status !== 'blocked') {
          q.last_attempt = 0;
          q.retry_count = 0;
        }
      }
      await worker.runCycle();
      const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
      if (synced === 10) break;
    }
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 10, `All 10 should eventually sync, got ${synced}`);
  });
});


describe('Stress: Concurrent save storm (20 saves to same record)', () => {
  it('only keeps 1 queue item and syncs the latest', async () => {
    const mock = createMockCtx();
    mock.addAttendance(1);
    const worker = createSyncWorker(mock.ctx);

    for (let i = 0; i < 20; i++) {
      worker.enqueue('1', 'upsert', { version: i });
    }

    const items = mock.tables.sync_queue.filter(r => r.record_id === '1');
    assert.strictEqual(items.length, 1, 'Only 1 queue item should exist');
    assert.ok(items[0].payload.includes('"version":19'), 'Should have latest version');

    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 1);
  });
});


describe('Stress: Network flap (alternate connectivity)', () => {
  it('syncs all items despite alternating connectivity', async () => {
    let online = true;
    const mock = createMockCtx({
      httpPost: async () => {
        if (!online) { const e = new Error('Timeout'); e.code = 'ETIMEDOUT'; throw e; }
        return { ok: true, written: 1 };
      },
    });
    for (let i = 1; i <= 10; i++) mock.addAttendance(i);
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= 10; i++) worker.enqueue(String(i), 'upsert', {});

    for (let c = 0; c < 100; c++) {
      online = c % 2 === 0;
      for (const q of mock.tables.sync_queue) {
        if (q.status !== 'synced' && q.status !== 'blocked') {
          q.last_attempt = 0;
          q.retry_count = 0;
        }
      }
      await worker.runCycle();
      const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
      if (synced === 10) break;
    }
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 10, `All should sync, got ${synced}`);
  });
});


describe('Stress: Large payload (500KB)', () => {
  it('syncs record with 500KB data blob', async () => {
    const largeData = JSON.stringify({ notes: 'x'.repeat(500 * 1024) });
    const mock = createMockCtx();
    mock.addAttendance(1, { data: largeData });
    const worker = createSyncWorker(mock.ctx);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 1, 'Large record should sync');
  });
});


describe('Stress: Stale recovery under load (50 failed items)', () => {
  it('recovers and processes all 50 failed items', async () => {
    const mock = createMockCtx();
    for (let i = 1; i <= 50; i++) mock.addAttendance(i);
    const worker = createSyncWorker(mock.ctx);
    for (let i = 1; i <= 50; i++) worker.enqueue(String(i), 'upsert', {});

    for (const q of mock.tables.sync_queue) {
      q.status = 'failed';
      q.retry_count = 6;
      q.last_attempt = Date.now() - 6 * 60_000;
    }

    const maxCycles = Math.ceil(50 / MAX_RECORDS_PER_CYCLE) + 5;
    for (let c = 0; c < maxCycles; c++) {
      await worker.runCycle();
    }
    const synced = mock.tables.sync_queue.filter(r => r.status === 'synced').length;
    assert.strictEqual(synced, 50, `All 50 recovered items should sync, got ${synced}`);
  });
});
