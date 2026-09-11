'use strict';

/**
 * Pure footer chip derivation for sync + backup status.
 * Dual-export: Node tests (module.exports) and renderer <script> (window.FooterStatusChips).
 *
 * Goals:
 * - Never panic when local DB + backups + outbox are healthy
 * - Never hide real push/backup failures
 * - Distinguish managed AWS entitlement from sync SoT health
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.FooterStatusChips = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function formatSyncTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  /**
   * @param {object} st sync-status payload (renderer snapshot)
   * @returns {{ text: string, variant: string, title?: string, cursor?: string }}
   */
  function deriveSyncFooterChip(st) {
    if (!st || !st.enabled) {
      return { text: '', variant: '', hidden: true };
    }

    var pending = st.pendingChanges || 0;
    var dirty = st.dirtyPushCount || 0;
    var pendingOrDirty = pending + dirty;
    var failed = st.failedCount || 0;
    var blocked = st.blockedCount || 0;
    var conflicts = st.conflictCount || 0;
    var emptyCloud = !!(st.emptyCloudAlarm || st.localFullCloudEmpty || st.suggestReuploadAll || (st.health && st.health.cloudLikelyEmpty));
    var emptyCloudMsg = st.emptyCloudAlarmMessage ||
      'Records are still on this device, but the cloud has none for this licence. Use Re-upload all — do not use Full re-sync while the cloud is empty.';
    var rateLimited = !!(st.rateLimited ||
      (st.rateLimit && st.rateLimit.blocked) ||
      st.lastSyncSkipReason === 'rate_limited' ||
      (st.rateLimitedUntil && st.rateLimitedUntil > Date.now()));
    var rateLimitRemainingMs = st.rateLimitRemainingMs ||
      (st.rateLimit && st.rateLimit.remainingMs) ||
      0;
    var lastPushFailed = st.lastPush && st.lastPush.ok === false;
    var lp = st.lastPull || {};
    var decryptFailed = lp.decryptFailed || 0;
    var received = lp.received || 0;
    var merged = lp.merged || 0;
    var total = st.totalRecords || 0;

    if (conflicts > 0) {
      return {
        text: conflicts + ' conflict' + (conflicts === 1 ? '' : 's'),
        variant: 'offline',
        title: 'Sync found newer remote changes but kept your local edits safe. Click to review and resolve.',
        cursor: 'pointer',
      };
    }
    if (st.authRequired || st.connectivity === 'auth_required' || st.lastSyncSkipReason === 'auth_required' || st.syncPhase === 'auth_required') {
      return {
        text: 'Activate licence to sync',
        variant: 'offline',
        title: 'Cloud sync needs an active licence on this computer. Open Settings → Licence, activate or sign in, and sync will resume automatically.',
        cursor: 'pointer',
      };
    }
    if (st.syncPhase === 'healing' || (st.emptyCloudHeal && st.emptyCloudHeal.status === 'running')) {
      return {
        text: 'Healing empty cloud…',
        variant: 'syncing',
        title: 'Local records are being re-uploaded because the cloud was empty for this licence. Your notes stay on this device.',
        cursor: '',
      };
    }
    if (emptyCloud) {
      return {
        text: 'Cloud empty — re-upload',
        variant: 'offline',
        title: emptyCloudMsg,
        cursor: 'pointer',
      };
    }
    if (rateLimited) {
      var remMs = rateLimitRemainingMs || 0;
      var secsRl = Math.max(1, Math.ceil(remMs / 1000));
      var waitHint = secsRl < 90
        ? ('retry in ~' + secsRl + 's')
        : ('retry in ~' + Math.max(1, Math.ceil(secsRl / 60)) + 'm');
      var rlTitle = 'Safe locally — nothing was dropped. Cloud sync is briefly rate-limited (' + waitHint + '). ' +
        (pendingOrDirty > 0
          ? (pendingOrDirty + ' record(s) waiting to upload; sync resumes automatically.')
          : 'Sync resumes automatically.');
      return {
        text: 'Safe locally — sync waiting',
        variant: 'backup-ok',
        title: rlTitle,
        cursor: '',
      };
    }
    if (decryptFailed > 0) {
      return {
        text: decryptFailed + ' decrypt failed',
        variant: 'offline',
        title: 'Remote records could not be decrypted. Use Settings → Backup → Recover from Cloud (Security tab) or Full re-sync from cloud.',
        cursor: 'pointer',
      };
    }
    if ((lp.noMasterKeySkipped || 0) > 0) {
      return {
        text: 'Waiting for sync key',
        variant: 'offline',
        title: 'Cloud records arrived but this computer has no master key yet. Keep the app online so canonical key escrow can complete, then Full re-sync.',
        cursor: 'pointer',
      };
    }
    if (st.emptyLargeDb) {
      return {
        text: 'DB empty — recover',
        variant: 'offline',
        title: 'Local database file is large but lists no records. Open Settings → Backup to restore, or Full re-sync from cloud. On the computer with your data, use Re-upload all local records to cloud.',
        cursor: 'pointer',
      };
    }
    if (lastPushFailed && pendingOrDirty > 0) {
      return {
        text: pendingOrDirty + ' not confirmed in cloud',
        variant: 'offline',
        title: (st.lastPush && st.lastPush.error ? st.lastPush.error + ' — ' : '') +
          'Local records stay dirty until the cloud confirms a durable write. Use Push all pending now or Re-upload all.',
        cursor: 'pointer',
      };
    }
    if (pendingOrDirty === 0 && total === 0 && received === 0 && st.lastSync) {
      return {
        text: 'No remote records',
        variant: 'backup-ok',
        title: 'Pull succeeded but no records from other devices yet. On the computer with your data, use Re-upload all local records to cloud (or Push all pending now) and wait for 0 pending. Then Full re-sync here.',
        cursor: '',
      };
    }
    if (blocked > 0) {
      return {
        text: blocked + ' auto-retrying',
        variant: 'offline',
        title: (st.lastError || '') + ' — will auto-retry. Click to retry now.',
        cursor: 'pointer',
      };
    }
    if (failed > 0) {
      return {
        text: failed + ' retrying',
        variant: 'offline',
        title: (st.lastError || '') + ' — click to retry sync.',
        cursor: 'pointer',
      };
    }
    if (pendingOrDirty > 0) {
      return {
        text: pendingOrDirty + ' pending',
        variant: 'syncing',
        cursor: '',
      };
    }
    if (st.lastSync && !(st.suppressSyncedFooter) && st.syncHealthy !== false) {
      if (merged > 0) {
        return {
          text: 'Synced ' + formatSyncTime(st.lastSync) + ' (' + merged + ' new)',
          variant: 'synced',
          cursor: '',
        };
      }
      if (received > 0 && merged === 0) {
        return {
          text: 'Up to date',
          variant: 'synced',
          title: 'Checked cloud — local records are current.',
          cursor: '',
        };
      }
      return {
        text: 'Synced ' + formatSyncTime(st.lastSync),
        variant: 'synced',
        cursor: '',
      };
    }
    if (st.suppressSyncedFooter || st.syncHealthy === false) {
      // Genuine attention needed — not empty-cloud (handled above), not healthy pull-only.
      return {
        text: 'Sync needs attention',
        variant: 'offline',
        title: st.lastError ||
          'Sync needs attention. Open Settings → Backup to retry push, or Full re-sync if records are missing on this device.',
        cursor: 'pointer',
      };
    }
    return {
      text: 'Waiting to sync',
      variant: 'backup-ok',
      cursor: '',
    };
  }

  /**
   * Backup footer chip from backup-status snapshot.
   * hourlyDirty alone after a successful quick backup is NOT an error —
   * it means the next generational hourly run is still due.
   *
   * @returns {{ text: string, variant: string, title?: string, handled: boolean }}
   *   handled=false → caller may fall through to settings-based idle/off.
   */
  function deriveBackupFooterChip(bs) {
    if (!bs || bs.state === 'not-initialised') {
      return { text: 'Backup starting…', variant: '', handled: true };
    }
    if (bs.state === 'running') {
      return { text: 'Backup running', variant: 'backup-active', handled: true };
    }
    if (bs.state === 'deferred') {
      return {
        text: 'Backup idle',
        variant: 'backup-ok',
        title: bs.deferredReason === 'user-active'
          ? 'Backup waiting until you pause typing.'
          : (bs.deferredReason || ''),
        handled: true,
      };
    }
    if (bs.state === 'error' || bs.lastDegradedReason) {
      return {
        text: 'Backup degraded',
        variant: 'offline',
        title: bs.lastError || bs.lastDegradedReason || '',
        handled: true,
      };
    }

    var quickDirty = !!bs.quickDirty;
    var hourlyDirty = !!bs.hourlyDirty;
    // lastBackupAt may be 0 in tests (fake clock) — treat null/undefined only as missing.
    var lastSuccess = bs.lastSuccessAt != null ? bs.lastSuccessAt
      : (bs.lastBackupAt != null ? bs.lastBackupAt : null);
    var noFolder = bs.lastSkipReason === 'backup-folder-missing' ||
      bs.lastSkipReason === 'db-missing' ||
      bs.lastSkipReason === 'export-failed';

    if (quickDirty) {
      if (noFolder) {
        return {
          text: bs.lastSkipReason === 'backup-folder-missing' ? 'Backup folder missing' : 'Backup off',
          variant: 'offline',
          title: bs.lastSkipReason === 'backup-folder-missing'
            ? 'Could not create or write the local Backups folder. Open Settings → Backup and choose a writable folder.'
            : (bs.lastSkipReason || ''),
          handled: true,
        };
      }
      return {
        text: 'Backup queued',
        variant: 'backup-active',
        title: 'A local backup will run shortly (after idle). Your last edits are still in the live database.',
        handled: true,
      };
    }

    // hourlyDirty without quickDirty: quick backup already succeeded; hourly is scheduled.
    if (hourlyDirty && lastSuccess != null) {
      return {
        text: 'Backed up',
        variant: 'backup-ok',
        title: 'Local backup succeeded' +
          (bs.lastBackupKind ? ' (' + bs.lastBackupKind + ')' : '') +
          '. Next hourly generational backup is scheduled.' +
          (bs.offsiteBackupFolder ? ' Offsite folder configured.' : ''),
        handled: true,
      };
    }

    if (hourlyDirty && lastSuccess == null && noFolder) {
      return {
        text: bs.lastSkipReason === 'backup-folder-missing' ? 'Backup folder missing' : 'Backup off',
        variant: 'offline',
        title: bs.lastSkipReason || '',
        handled: true,
      };
    }

    if (hourlyDirty && lastSuccess == null) {
      // Never successfully backed up yet but only hourly pending — still queued.
      return {
        text: 'Backup queued',
        variant: 'backup-active',
        title: 'Waiting for the first backup to complete.',
        handled: true,
      };
    }

    if (lastSuccess != null && !quickDirty && !hourlyDirty) {
      return {
        text: 'Backed up',
        variant: 'backup-ok',
        title: 'Last backup succeeded' +
          (bs.latestFileVerified === false ? ' (verification pending/failed — check Settings).' : '.'),
        handled: true,
      };
    }

    return { text: '', variant: '', handled: false };
  }

  /**
   * Managed AWS cloud-backup entitlement chip — must NOT reuse sync “Local only” panic wording.
   */
  function deriveManagedCloudBackupFooterChip(status) {
    if (status && status.enabled) {
      return {
        text: 'AWS backup on',
        variant: 'backup-ok',
        title: status.lastSuccess
          ? 'Last managed cloud backup: ' + String(status.lastSuccess)
          : 'Managed AWS cloud backup is active.',
        cursor: '',
      };
    }
    return {
      text: 'Local backups',
      variant: 'backup-ok',
      title: (status && status.lastError)
        ? ('Managed cloud backup unavailable: ' + status.lastError + '. Local + offsite folders still protect your data.')
        : 'Managed AWS cloud backup is not configured. Local Backups folder and OneDrive/offsite still protect your data. Click to open Settings.',
      cursor: 'pointer',
    };
  }

  return {
    formatSyncTime: formatSyncTime,
    deriveSyncFooterChip: deriveSyncFooterChip,
    deriveBackupFooterChip: deriveBackupFooterChip,
    deriveManagedCloudBackupFooterChip: deriveManagedCloudBackupFooterChip,
  };
});
