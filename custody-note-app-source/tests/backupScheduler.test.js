const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createBackupScheduler } = require('../main/backupScheduler');

function createHarness(opts = {}) {
  let nowMs = 0;
  let nextId = 1;
  const timers = new Map();
  const calls = [];
  const statusChanges = [];

  function setTimer(fn, delay) {
    const id = nextId++;
    timers.set(id, { id, fn, runAt: nowMs + Math.max(0, delay || 0) });
    return id;
  }

  function clearTimer(id) {
    timers.delete(id);
  }

  async function tick(ms) {
    nowMs += ms;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const due = [...timers.values()]
        .filter(t => t.runAt <= nowMs)
        .sort((a, b) => a.runAt - b.runAt);
      for (const timer of due) {
        timers.delete(timer.id);
        progressed = true;
        await timer.fn();
      }
    }
  }

  const scheduler = createBackupScheduler({
    now: () => nowMs,
    setTimer,
    clearTimer,
    quickMinIntervalMs: opts.quickMinIntervalMs || 10_000,
    hourlyIntervalMs: opts.hourlyIntervalMs || 60_000,
    userIdleGraceMs: opts.userIdleGraceMs || 5_000,
    periodicCheckMs: opts.periodicCheckMs || 2_000,
    runBackup: opts.runBackup || (async (kind, reason) => {
      calls.push({ kind, reason, at: nowMs });
      return { bytes: kind === 'hourly' ? 200 : 100, durationMs: kind === 'hourly' ? 40 : 20 };
    }),
    onStatusChange: (s) => { statusChanges.push({ ...s, at: nowMs }); },
  });

  return { scheduler, calls, statusChanges, tick, now: () => nowMs, timers };
}

describe('backupScheduler', () => {
  it('uses calmer default intervals', () => {
    const scheduler = createBackupScheduler({
      now: () => 0,
      setTimer: () => 1,
      clearTimer: () => {},
      runBackup: async () => ({ skipped: true }),
    });
    const status = scheduler.getStatus();
    assert.strictEqual(status.quickMinIntervalMs, 15 * 60 * 1000);
    assert.strictEqual(status.userIdleGraceMs, 45 * 1000);
    assert.strictEqual(status.periodicCheckMs, 3 * 60 * 1000);
  });

  it('does not run when clean', () => {
    const h = createHarness();
    h.scheduler.requestCheckpoint('timer');
    assert.strictEqual(h.calls.length, 0);
    const status = h.scheduler.getStatus();
    assert.strictEqual(status.quickDirty, false);
    assert.strictEqual(status.hourlyDirty, false);
  });

  it('defers while user is active and runs after idle grace', async () => {
    const h = createHarness();
    h.scheduler.markDirty('save');
    h.scheduler.noteUserActivity('typing');
    await h.tick(4_000);
    assert.strictEqual(h.calls.length, 0, 'should not backup while user is active');
    await h.tick(1_001);
    assert.strictEqual(h.calls.length, 1, 'should backup after idle grace');
    assert.strictEqual(h.calls[0].kind, 'quick');
  });

  it('enforces minimum interval for quick backups', async () => {
    const h = createHarness();
    h.scheduler.markDirty('save');
    await h.tick(0);
    assert.strictEqual(h.calls.length, 1, 'first backup should run immediately');

    h.scheduler.markDirty('save-again');
    await h.tick(9_999);
    assert.strictEqual(h.calls.length, 1, 'should not run before min interval');
    await h.tick(2);
    assert.strictEqual(h.calls.length, 2, 'should run after min interval');
  });

  it('promotes to hourly backup when hourly interval elapsed', async () => {
    const h = createHarness();
    h.scheduler.markDirty('save');
    await h.tick(0);
    assert.strictEqual(h.calls[0].kind, 'quick');

    h.scheduler.markDirty('save-again');
    await h.tick(60_000);
    assert.strictEqual(h.calls[1].kind, 'hourly');
  });

  it('forces immediate backup on background flush', async () => {
    const h = createHarness();
    h.scheduler.markDirty('save');
    h.scheduler.noteUserActivity('typing');
    h.scheduler.requestBackgroundFlush('app-hidden');
    await h.tick(0);
    assert.strictEqual(h.calls.length, 1);
    assert.strictEqual(h.calls[0].reason, 'app-hidden');
  });

  it('does not run backup when nothing is dirty', async () => {
    const h = createHarness();
    await h.tick(30_000);
    assert.strictEqual(h.calls.length, 0, 'no backup when clean');
  });

  it('skips background flush when clean', async () => {
    const h = createHarness();
    h.scheduler.requestBackgroundFlush('app-close');
    await h.tick(0);
    assert.strictEqual(h.calls.length, 0, 'no backup flush when clean');
  });

  it('tracks status correctly through lifecycle', async () => {
    const h = createHarness();
    let s = h.scheduler.getStatus();
    assert.strictEqual(s.state, 'idle');
    assert.strictEqual(s.quickDirty, false);

    h.scheduler.markDirty('edit');
    s = h.scheduler.getStatus();
    assert.strictEqual(s.quickDirty, true);
    assert.strictEqual(s.hourlyDirty, true);

    await h.tick(0);
    s = h.scheduler.getStatus();
    assert.strictEqual(s.quickDirty, false, 'quick dirty cleared after backup');
  });

  it('records manual completion and clears dirty flags', () => {
    const h = createHarness();
    h.scheduler.markDirty('change');
    let s = h.scheduler.getStatus();
    assert.strictEqual(s.quickDirty, true);

    h.scheduler.recordCompleted('quick', 'manual', { bytes: 500 }, true);
    s = h.scheduler.getStatus();
    assert.strictEqual(s.quickDirty, false);
    assert.strictEqual(s.hourlyDirty, false);
    assert.strictEqual(s.lastBackupKind, 'quick');
    assert.strictEqual(s.lastBackupBytes, 500);
  });

  it('defers continually during sustained typing', async () => {
    const h = createHarness();
    h.scheduler.markDirty('save');
    for (let i = 0; i < 10; i++) {
      h.scheduler.noteUserActivity('typing');
      await h.tick(2_000);
    }
    assert.strictEqual(h.calls.length, 0, 'should not backup during sustained typing');
    await h.tick(5_001);
    assert.strictEqual(h.calls.length, 1, 'should backup after typing stops');
  });

  it('handles backup error gracefully', async () => {
    let callCount = 0;
    let nowMs = 0;
    let nextId = 1;
    const timers = new Map();

    function setTimer(fn, delay) {
      const id = nextId++;
      timers.set(id, { id, fn, runAt: nowMs + Math.max(0, delay || 0) });
      return id;
    }
    function clearTimer(id) { timers.delete(id); }

    async function tickOnce() {
      const due = [...timers.values()]
        .filter(t => t.runAt <= nowMs)
        .sort((a, b) => a.runAt - b.runAt);
      if (due.length > 0) {
        const t = due[0];
        timers.delete(t.id);
        await t.fn();
      }
    }

    const scheduler = createBackupScheduler({
      now: () => nowMs,
      setTimer,
      clearTimer,
      quickMinIntervalMs: 10_000,
      hourlyIntervalMs: 60_000,
      userIdleGraceMs: 5_000,
      periodicCheckMs: 60_000,
      runBackup: async () => {
        callCount++;
        throw new Error('disk full');
      },
    });
    scheduler.markDirty('save');
    await tickOnce();
    const s = scheduler.getStatus();
    assert.strictEqual(callCount, 1, 'runBackup should have been called exactly once');
    assert.strictEqual(s.lastError, 'disk full');
    assert.strictEqual(s.state, 'error');
  });

  it('dispose cleans up timers', () => {
    const h = createHarness();
    h.scheduler.markDirty('save');
    assert.ok(h.timers.size > 0, 'should have a timer');
    h.scheduler.dispose();
    assert.strictEqual(h.timers.size, 0, 'all timers should be cleared');
  });
});
