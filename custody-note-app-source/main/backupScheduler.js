function createBackupScheduler(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
  const runBackup = typeof options.runBackup === 'function' ? options.runBackup : async () => ({ skipped: true });
  const onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : () => {};

  const QUICK_MIN_INTERVAL_MS = options.quickMinIntervalMs || 15 * 60 * 1000;
  const HOURLY_INTERVAL_MS = options.hourlyIntervalMs || 60 * 60 * 1000;
  const USER_IDLE_GRACE_MS = options.userIdleGraceMs || 45 * 1000;
  const PERIODIC_CHECK_MS = options.periodicCheckMs || 3 * 60 * 1000;

  let timer = null;
  let running = false;
  let quickDirty = false;
  let hourlyDirty = false;
  let lastUserActivityAt = null;
  let lastQuickBackupAt = null;
  let lastHourlyBackupAt = now();
  let lastBackupAt = null;
  let lastBackupDurationMs = 0;
  let lastBackupBytes = 0;
  let lastBackupKind = null;
  let lastBackupReason = null;
  let lastError = null;
  let lastRequestedAt = null;
  let lastSkipReason = null;
  let deferredReason = null;
  let currentState = 'idle';
  let nextRunAt = 0;

  function snapshot(extra = {}) {
    return {
      state: currentState,
      quickDirty,
      hourlyDirty,
      running,
      lastUserActivityAt,
      lastQuickBackupAt,
      lastHourlyBackupAt,
      lastBackupAt,
      lastBackupDurationMs: lastBackupDurationMs || 0,
      lastBackupBytes: lastBackupBytes || 0,
      lastBackupKind,
      lastBackupReason,
      lastError,
      lastRequestedAt,
      lastSkipReason,
      nextRunAt: nextRunAt || null,
      deferredReason,
      userIdleGraceMs: USER_IDLE_GRACE_MS,
      quickMinIntervalMs: QUICK_MIN_INTERVAL_MS,
      periodicCheckMs: PERIODIC_CHECK_MS,
      ...extra,
    };
  }

  function emit(extra = {}) {
    onStatusChange(snapshot(extra));
  }

  function clearScheduledTimer() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    nextRunAt = 0;
  }

  function schedule(delayMs, reason) {
    const delay = Math.max(0, Math.floor(delayMs || 0));
    clearScheduledTimer();
    nextRunAt = now() + delay;
    if (currentState !== 'error') {
      currentState = delay > 0 ? 'scheduled' : currentState;
    }
    deferredReason = reason || deferredReason || null;
    timer = setTimer(() => {
      timer = null;
      nextRunAt = 0;
      runDue(reason || 'scheduled').catch(() => {});
    }, delay);
    emit();
  }

  function chooseBackupKind() {
    const ts = now();
    const hourlyDue = hourlyDirty && lastHourlyBackupAt != null && (ts - lastHourlyBackupAt) >= HOURLY_INTERVAL_MS;
    if (hourlyDue) return 'hourly';
    if (quickDirty) return 'quick';
    return null;
  }

  function computeDelay(kind, reason, force) {
    const ts = now();
    if (!kind) return PERIODIC_CHECK_MS;
    if (force) return 0;

    const sinceActivity = lastUserActivityAt != null ? ts - lastUserActivityAt : Number.POSITIVE_INFINITY;
    if (sinceActivity < USER_IDLE_GRACE_MS) {
      currentState = 'deferred';
      deferredReason = 'user-active';
      return USER_IDLE_GRACE_MS - sinceActivity;
    }

    if (kind === 'quick' && lastQuickBackupAt != null) {
      const sinceQuick = ts - lastQuickBackupAt;
      if (sinceQuick < QUICK_MIN_INTERVAL_MS) {
        currentState = 'deferred';
        deferredReason = 'min-interval';
        return QUICK_MIN_INTERVAL_MS - sinceQuick;
      }
    }

    currentState = 'ready';
    deferredReason = reason || null;
    return 0;
  }

  async function runDue(reason = 'scheduled', force = false) {
    if (running) return;
    const kind = chooseBackupKind();
    const delay = computeDelay(kind, reason, force);
    if (delay > 0) {
      schedule(delay, reason);
      return;
    }
    if (!kind) {
      currentState = 'idle';
      deferredReason = null;
      schedule(PERIODIC_CHECK_MS, 'periodic-idle');
      return;
    }

    running = true;
    currentState = 'running';
    deferredReason = null;
    emit({ activeKind: kind, activeReason: reason });
    const startedAt = now();
    try {
      const result = await Promise.resolve(runBackup(kind, reason, { force }));
      if (result && result.skipped) {
        currentState = 'idle';
        lastSkipReason = result.reason || reason;
        deferredReason = result.reason || reason;
      } else {
        lastBackupAt = now();
        lastBackupDurationMs = result && result.durationMs != null ? result.durationMs : (lastBackupAt - startedAt);
        lastBackupBytes = result && result.bytes != null ? result.bytes : 0;
        lastBackupKind = kind;
        lastBackupReason = reason;
        lastError = null;
        lastSkipReason = null;
        if (kind === 'hourly') {
          hourlyDirty = false;
          quickDirty = false;
          lastHourlyBackupAt = lastBackupAt;
          lastQuickBackupAt = lastBackupAt;
        } else {
          quickDirty = false;
          lastQuickBackupAt = lastBackupAt;
        }
      }
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      currentState = 'error';
    } finally {
      running = false;
      const isError = currentState === 'error';
      if (!isError && currentState !== 'idle') currentState = chooseBackupKind() ? 'scheduled' : 'idle';
      emit();
      if (isError) {
        schedule(PERIODIC_CHECK_MS, 'error-retry');
      } else if (currentState === 'idle' && deferredReason && (deferredReason === 'backup-folder-missing' || deferredReason === 'db-missing')) {
        schedule(PERIODIC_CHECK_MS, deferredReason);
      } else {
        schedule(computeDelay(chooseBackupKind(), 'post-run', false), 'post-run');
      }
    }
  }

  return {
    markDirty(reason = 'change') {
      quickDirty = true;
      hourlyDirty = true;
      lastRequestedAt = now();
      currentState = 'scheduled';
      deferredReason = reason;
      emit();
      schedule(computeDelay(chooseBackupKind(), reason, false), reason);
    },
    noteUserActivity(reason = 'input') {
      lastUserActivityAt = now();
      deferredReason = reason;
      if (quickDirty || hourlyDirty) {
        currentState = 'deferred';
        schedule(computeDelay(chooseBackupKind(), reason, false), reason);
      } else {
        emit();
      }
    },
    requestCheckpoint(reason = 'timer') {
      if (!quickDirty && !hourlyDirty) {
        currentState = 'idle';
        emit();
        return;
      }
      schedule(computeDelay(chooseBackupKind(), reason, false), reason);
    },
    requestBackgroundFlush(reason = 'background') {
      if (!quickDirty && !hourlyDirty) return;
      runDue(reason, true).catch(() => {});
    },
    async forceRun(reason = 'manual') {
      await runDue(reason, true);
      return snapshot();
    },
    recordCompleted(kind = 'quick', reason = 'manual', metrics = {}, clearsAll = false) {
      const ts = now();
      lastBackupAt = ts;
      lastBackupDurationMs = metrics.durationMs || 0;
      lastBackupBytes = metrics.bytes || 0;
      lastBackupKind = kind;
      lastBackupReason = reason;
      lastError = null;
      lastSkipReason = null;
      if (kind === 'hourly' || clearsAll) {
        hourlyDirty = false;
        quickDirty = false;
        lastHourlyBackupAt = ts;
        lastQuickBackupAt = ts;
      } else {
        quickDirty = false;
        lastQuickBackupAt = ts;
      }
      currentState = chooseBackupKind() ? 'scheduled' : 'idle';
      deferredReason = null;
      emit();
      schedule(computeDelay(chooseBackupKind(), 'post-manual', false), 'post-manual');
    },
    getStatus() {
      return snapshot();
    },
    /* Suppress scheduler-initiated backups for `ms` milliseconds after a restore.
       Prevents the restored DB being immediately overwritten by a stale scheduled run.
       Manually-triggered backups (forceRun) are unaffected. */
    suppressNext(ms) {
      const wait = Math.max(0, ms || 60000);
      quickDirty = false;
      hourlyDirty = false;
      clearScheduledTimer();
      currentState = 'idle';
      deferredReason = 'post-restore-suppress';
      emit();
      setTimer(() => {
        /* Re-enable dirty tracking after suppression window */
        quickDirty = true;
        hourlyDirty = true;
        deferredReason = null;
        schedule(0, 'post-restore');
      }, wait);
    },
    dispose() {
      clearScheduledTimer();
    },
  };
}

module.exports = {
  createBackupScheduler,
};
