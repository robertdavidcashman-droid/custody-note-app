'use strict';

/**
 * Force Save drain policy + force-quit flush durability + monitor fail-closed
 * + server PITR client contracts.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const {
  computeForceSaveMaxCycles,
  interpretForceSaveDrain,
  shouldPersistDrainContinuation,
  FORCE_SAVE_DRAIN_MIN_CYCLES,
} = require('../lib/forceSaveDrainPolicy');
const {
  resolveForceSaveState,
  FORCE_SAVE_STATES,
  isAmbiguousSavedLabel,
  buildForceSaveResult,
} = require('../lib/forceSaveStatus');
const {
  shouldRestoreDirtyAfterFlush,
  evaluatePostFlushDurability,
} = require('../lib/flushDirtyPolicy');
const { MAGIC, encryptBuffer, decryptBuffer } = require('../lib/dbCrypto');
const { verifyEncryptedBackupFile } = require('../lib/backupVerify');
const {
  enforceMonitorFailClosed,
  assertMayOverwriteKnownGood,
} = require('../lib/monitorFailClosed');
const {
  emptyOrFailedResponsePolicy,
  serverPitrIndependenceContract,
  scorePitrRestoreCandidate,
} = require('../lib/serverPitrContract');
const { mayRestoreBackupOverLive } = require('../lib/backupIntegrityGate');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

describe('Force Save drain — no false Synced on large outbox', () => {
  it('sizes maxCycles from pending depth (not fixed 3)', () => {
    const small = computeForceSaveMaxCycles({ pendingCount: 5, dirtyCount: 0 });
    assert.ok(small >= FORCE_SAVE_DRAIN_MIN_CYCLES);
    assert.ok(small > 3);
    const large = computeForceSaveMaxCycles({ pendingCount: 1000, dirtyCount: 0, recordsPerCycle: 100 });
    // 1000/100 + 5 = 15
    assert.ok(large >= 15);
    assert.ok(large < 200);
  });

  it('max_cycles / still pending never centralConfirmed', () => {
    const r = interpretForceSaveDrain({
      stoppedReason: 'max_cycles',
      pending: 40,
      dirty: 0,
    });
    assert.strictEqual(r.centralConfirmed, false);
    assert.strictEqual(r.continueInBackground, true);
    assert.strictEqual(r.syncing, true);
    assert.ok(shouldPersistDrainContinuation(r));
    const state = resolveForceSaveState({
      noteDurable: true,
      backupOk: true,
      centralConfirmed: r.centralConfirmed,
      pendingCount: r.pendingCount,
      syncing: r.syncing,
      syncError: r.syncError,
      syncAttempted: true,
    });
    assert.notStrictEqual(state, FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED);
    assert.ok(
      state === FORCE_SAVE_STATES.SYNCING ||
        state === FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE
    );
    const msg = buildForceSaveResult({
      noteDurable: true,
      centralConfirmed: false,
      pendingCount: 40,
      syncing: true,
      syncError: r.syncError,
    }).userMessage;
    assert.ok(!isAmbiguousSavedLabel(msg.headline));
    assert.ok(!/^synced$/i.test(msg.headline));
  });

  it('drained → centralConfirmed', () => {
    const r = interpretForceSaveDrain({
      stoppedReason: 'drained',
      pending: 0,
      dirty: 0,
    });
    assert.strictEqual(r.centralConfirmed, true);
    assert.strictEqual(shouldPersistDrainContinuation(r), false);
  });

  it('persist-and-backup uses computeForceSaveMaxCycles (not hard-coded 3)', () => {
    const idx = mainJs.indexOf("ipcMain.handle('persist-and-backup'");
    assert.ok(idx > 0);
    const chunk = mainJs.slice(idx, idx + 12000);
    assert.match(chunk, /computeForceSaveMaxCycles/);
    assert.match(chunk, /interpretForceSaveDrain/);
    assert.match(chunk, /forceSaveDrainPending/);
    assert.doesNotMatch(chunk, /drainPendingSyncUploads\(\{\s*maxCycles:\s*3\s*\}\)/);
  });
});

describe('Force-quit / kill around flush — local durability', () => {
  it('crash before rename keeps prior durable CNDB (tmp orphan only)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fq-'));
    const dbPath = path.join(dir, 'attendances.db');
    const key = crypto.randomBytes(32).toString('hex');
    const canary = Buffer.from('CANARY-FORCE-QUIT-RECORD-v1');
    const durable = encryptBuffer(canary, key);
    fs.writeFileSync(dbPath, durable);

    // Simulate crash mid-write: tmp written, rename never happens.
    const tmp = dbPath + '.' + process.pid + '.crash.tmp';
    const newer = encryptBuffer(Buffer.from('PARTIAL-NEWER'), key);
    fs.writeFileSync(tmp, newer);
    // Process "dies" — only tmp exists besides original.
    assert.ok(fs.existsSync(dbPath));
    assert.ok(fs.existsSync(tmp));
    const onDisk = fs.readFileSync(dbPath);
    assert.strictEqual(onDisk.slice(0, 4).toString(), MAGIC);
    const roundTrip = decryptBuffer(onDisk, key);
    assert.ok(roundTrip);
    assert.strictEqual(roundTrip.toString(), canary.toString());
    // Cleanup orphan tmp like flushDbSync does
    fs.unlinkSync(tmp);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('timeout flush restores dirty — Force Save refuses Safe locally', () => {
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ timedOut: true }).restoreDirty, true);
    const dur = evaluatePostFlushDurability({
      dirty: true,
      pathExists: true,
      magicOk: true,
      bytes: 100,
    });
    assert.strictEqual(dur.durable, false);
    assert.strictEqual(
      resolveForceSaveState({ noteDurable: false }),
      FORCE_SAVE_STATES.ATTENTION_REQUIRED
    );
  });

  it('child process kill mid-script leaves pre-written CNDB intact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-kill-'));
    const dbPath = path.join(dir, 'attendances.db');
    const keyHex = crypto.randomBytes(32).toString('hex');
    const script = `
      const fs = require('fs');
      const crypto = require('crypto');
      const { encryptBuffer } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'dbCrypto.js'))});
      const dbPath = ${JSON.stringify(dbPath)};
      const key = ${JSON.stringify(keyHex)};
      const durable = encryptBuffer(Buffer.from('PRE-KILL-CANARY'), key);
      fs.writeFileSync(dbPath, durable);
      // Signal ready then spin until killed (simulates mid-flush hang).
      fs.writeFileSync(${JSON.stringify(path.join(dir, 'ready'))}, '1');
      setInterval(() => {}, 1000);
    `;
    const child = require('child_process').spawn(process.execPath, ['-e', script], {
      stdio: 'ignore',
      detached: false,
    });
    const readyPath = path.join(dir, 'ready');
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyPath) && Date.now() < deadline) {
      spawnSync(process.execPath, ['-e', ''], { timeout: 50 });
    }
    assert.ok(fs.existsSync(readyPath), 'child never wrote ready marker');
    assert.ok(fs.existsSync(dbPath));
    child.kill('SIGKILL');
    child.unref();
    // Wait briefly for kill
    spawnSync(process.execPath, ['-e', ''], { timeout: 100 });
    const verified = verifyEncryptedBackupFile(dbPath);
    assert.strictEqual(verified.ok, true);
    const plain = decryptBuffer(fs.readFileSync(dbPath), keyHex);
    assert.strictEqual(plain.toString(), 'PRE-KILL-CANARY');
    try { process.kill(child.pid); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Monitor fail-closed', () => {
  it('blocks wipe / overwrite when monitors fire; merge still allowed', () => {
    const wipe = enforceMonitorFailClosed(
      { previousActiveCount: 20, currentActiveCount: 0 },
      { intendedAction: 'wipe' }
    );
    assert.strictEqual(wipe.allowed, false);
    assert.strictEqual(wipe.mayOverwriteKnownGood, false);
    assert.strictEqual(wipe.failClosed, true);
    assert.throws(() => assertMayOverwriteKnownGood(wipe), /REFUSING_OVERWRITE/);

    const merge = enforceMonitorFailClosed(
      {
        localActiveCount: 65,
        lastPullReceived: 0,
        pulledFromEpoch: true,
        lastVerifiedCloudInventory: 0,
        pullEverCompleted: true,
      },
      { intendedAction: 'merge' }
    );
    assert.strictEqual(merge.allowed, true);
    assert.strictEqual(merge.mayOverwriteKnownGood, false);
    assert.strictEqual(merge.failClosed, true);
  });

  it('syncPull wires monitor fail-closed + response policy', () => {
    assert.match(mainJs, /enforceMonitorFailClosed/);
    assert.match(mainJs, /emptyOrFailedResponsePolicy/);
    assert.match(mainJs, /accept_empty_cloud_as_wipe/);
  });
});

describe('Server SoT PITR client contracts (website companion)', () => {
  it('empty/failed response ≠ authoritative empty wipe', () => {
    assert.strictEqual(
      emptyOrFailedResponsePolicy({ ok: false, error: 'timeout' }).mayWipeLocal,
      false
    );
    assert.strictEqual(
      emptyOrFailedResponsePolicy({ ok: true, statusCode: 500, error: 'boom' }).treatAsAuthoritativeEmpty,
      false
    );
    assert.strictEqual(
      emptyOrFailedResponsePolicy({ ok: true, records: null }).mayZeroInventory,
      false
    );
    // Website PR #13: null timeline → 503 INCOMPLETE_SOT_READ (not ok+empty)
    const incomplete = emptyOrFailedResponsePolicy({
      ok: false,
      statusCode: 503,
      code: 'INCOMPLETE_SOT_READ',
      error: 'INCOMPLETE_SOT_READ',
      records: [],
    });
    assert.strictEqual(incomplete.treatAsAuthoritativeEmpty, false);
    assert.strictEqual(incomplete.mayWipeLocal, false);
    assert.strictEqual(incomplete.reason, 'incomplete_sot_read');
    const emptyOk = emptyOrFailedResponsePolicy({
      ok: true,
      records: [],
      pulledFromEpoch: true,
      statusCode: 200,
    });
    assert.strictEqual(emptyOk.mayWipeLocal, false);
    assert.strictEqual(emptyOk.treatAsAuthoritativeEmpty, true);
  });

  it('PITR prefix independent from live SoT', () => {
    const c = serverPitrIndependenceContract({
      liveSoTPrefix: 'sync/',
      pitrPrefix: 'sot-pitr/',
    });
    assert.strictEqual(c.ok, true);
    assert.strictEqual(c.mayMirrorLiveDamageInstantly, false);
  });

  it('restore scoring refuses empty/corrupt over live', () => {
    const bad = scorePitrRestoreCandidate(
      { activeCount: 0, readable: true, verified: true, magicOk: true },
      { activeCount: 65 }
    );
    assert.strictEqual(bad.allowed, false);
    assert.ok(bad.reasons.includes('empty_over_live'));
    assert.strictEqual(
      mayRestoreBackupOverLive(
        { activeCount: 0, readable: true, magicOk: true, verified: true },
        { activeCount: 65 }
      ).allowed,
      false
    );
    const good = scorePitrRestoreCandidate(
      { activeCount: 60, readable: true, verified: true, magicOk: true },
      { activeCount: 65 }
    );
    assert.strictEqual(good.allowed, true);
  });
});
