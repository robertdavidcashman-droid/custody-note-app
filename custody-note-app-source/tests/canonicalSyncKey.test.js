/**
 * Canonical sync-key protocol: one encryption key per licence, download-first.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ensureCanonicalSyncKey, RESULT_ACTIONS } = require('../lib/canonicalSyncKey');
const { encryptMasterKeyForEscrow, decryptMasterKeyFromEscrow } = require('../lib/keyEscrow');

const LICENCE = 'ABCD-1234-EFGH-5678';
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function makeDeps(overrides = {}) {
  const state = {
    escrowBlob: null,
    localKey: KEY_A,
    adopted: null,
    rekeyed: false,
    uploads: 0,
  };
  const deps = {
    getLicenceKey: () => LICENCE,
    getLocalKeyHex: () => state.localKey,
    fetchEscrow: async () => (state.escrowBlob ? { ok: true, blob: state.escrowBlob } : { ok: false }),
    uploadEscrow: async (blob) => { state.escrowBlob = blob; state.uploads++; return true; },
    encryptEscrow: encryptMasterKeyForEscrow,
    decryptEscrow: decryptMasterKeyFromEscrow,
    adoptKey: (hex) => { state.adopted = hex; state.localKey = hex; },
    rekeyLocalRecords: () => { state.rekeyed = true; },
    ...overrides,
  };
  return { deps, state };
}

describe('canonical sync key protocol', () => {
  it('uploads local key when no escrow exists (first device wins)', async () => {
    const { deps, state } = makeDeps();
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.action, RESULT_ACTIONS.UPLOADED_LOCAL_KEY);
    assert.strictEqual(decryptMasterKeyFromEscrow(state.escrowBlob, LICENCE), KEY_A);
    assert.strictEqual(state.adopted, null);
    assert.strictEqual(state.rekeyed, false);
  });

  it('no-ops when escrow already matches the local key', async () => {
    const { deps, state } = makeDeps();
    state.escrowBlob = encryptMasterKeyForEscrow(KEY_A, LICENCE);
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.action, RESULT_ACTIONS.MATCH);
    assert.strictEqual(state.uploads, 0);
    assert.strictEqual(state.rekeyed, false);
  });

  it('adopts escrow key and re-keys local records when keys diverge', async () => {
    const { deps, state } = makeDeps();
    state.escrowBlob = encryptMasterKeyForEscrow(KEY_B, LICENCE);
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.action, RESULT_ACTIONS.ADOPTED_REKEYED);
    assert.strictEqual(state.adopted, KEY_B);
    assert.strictEqual(state.rekeyed, true);
    // Never overwrites the existing escrow with the divergent local key.
    assert.strictEqual(state.uploads, 0);
    assert.strictEqual(decryptMasterKeyFromEscrow(state.escrowBlob, LICENCE), KEY_B);
  });

  it('adopts escrow key without re-key when device has no key yet', async () => {
    const { deps, state } = makeDeps();
    state.localKey = null;
    state.escrowBlob = encryptMasterKeyForEscrow(KEY_B, LICENCE);
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.action, RESULT_ACTIONS.ADOPTED_NO_LOCAL);
    assert.strictEqual(state.adopted, KEY_B);
    assert.strictEqual(state.rekeyed, false);
  });

  it('reports undecryptable escrow without touching local key or escrow', async () => {
    const { deps, state } = makeDeps();
    state.escrowBlob = encryptMasterKeyForEscrow(KEY_B, 'DIFFERENT-LICENCE-KEY-0000');
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.action, RESULT_ACTIONS.ESCROW_UNDECRYPTABLE);
    assert.strictEqual(state.adopted, null);
    assert.strictEqual(state.uploads, 0);
  });

  it('reports no_key_no_escrow when device has neither', async () => {
    const { deps } = makeDeps();
    deps.getLocalKeyHex = () => null;
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.action, RESULT_ACTIONS.NO_KEY_NO_ESCROW);
  });

  it('requires a licence key', async () => {
    const { deps } = makeDeps();
    deps.getLicenceKey = () => null;
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.action, RESULT_ACTIONS.NO_LICENCE);
  });

  it('surfaces fetch errors as retryable error action', async () => {
    const { deps } = makeDeps();
    deps.fetchEscrow = async () => { throw new Error('network down'); };
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.action, RESULT_ACTIONS.ERROR);
    assert.match(res.error, /network down/);
  });

  it('reports upload failure so the worker retries later', async () => {
    const { deps } = makeDeps();
    deps.uploadEscrow = async () => false;
    const res = await ensureCanonicalSyncKey(deps);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.action, RESULT_ACTIONS.UPLOAD_FAILED);
  });
});
