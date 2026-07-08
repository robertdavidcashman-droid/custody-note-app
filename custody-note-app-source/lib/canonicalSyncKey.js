'use strict';

/**
 * Canonical sync-key protocol — ONE encryption key per licence.
 *
 * Root cause of "records still not synced": every computer generated its own
 * master key and blindly uploaded it to the escrow slot after pushing. With
 * two active devices the escrow ping-ponged between key A and key B, and the
 * cloud store accumulated records encrypted with a MIX of keys — so each
 * device could only decrypt the other's records some of the time (or never).
 *
 * Protocol (download-first, first-device-wins):
 *   1. Download the escrow blob for this licence.
 *   2. No escrow yet  → upload OUR key. We are the canonical key.
 *   3. Escrow matches our key → nothing to do.
 *   4. Escrow differs → ADOPT the escrow key, then re-key: bump sync_version,
 *      mark every synced record dirty and re-push so the cloud store converges
 *      on ciphertext readable by every device.
 *   5. Never upload a key that would overwrite a different existing escrow.
 *
 * All I/O is injected so the protocol is unit-testable without Electron.
 */

const RESULT_ACTIONS = Object.freeze({
  NO_API: 'no_api',
  NO_LICENCE: 'no_licence',
  NO_KEY_NO_ESCROW: 'no_key_no_escrow',
  UPLOADED_LOCAL_KEY: 'uploaded_local_key',
  UPLOAD_FAILED: 'upload_failed',
  MATCH: 'match',
  ADOPTED_NO_LOCAL: 'adopted_no_local',
  ADOPTED_REKEYED: 'adopted_rekeyed',
  ESCROW_UNDECRYPTABLE: 'escrow_undecryptable',
  ERROR: 'error',
});

/**
 * @param {object} deps
 * @param {() => string|null} deps.getLicenceKey
 * @param {() => string|null} deps.getLocalKeyHex        current master key (hex) or null
 * @param {() => Promise<{ok:boolean, blob?:string, error?:string}>} deps.fetchEscrow
 * @param {(blob:string) => Promise<boolean>} deps.uploadEscrow
 * @param {(masterKeyHex:string, licenceKey:string) => string} deps.encryptEscrow
 * @param {(blob:string, licenceKey:string) => string|null} deps.decryptEscrow
 * @param {(masterKeyHex:string) => void} deps.adoptKey  persist the new canonical key locally
 * @param {() => Promise<void>|void} deps.rekeyLocalRecords  mark all synced records dirty + requeue
 * @returns {Promise<{ok:boolean, action:string, error?:string}>}
 */
async function ensureCanonicalSyncKey(deps) {
  const licenceKey = deps.getLicenceKey();
  if (!licenceKey) return { ok: false, action: RESULT_ACTIONS.NO_LICENCE };

  let escrowResp;
  try {
    escrowResp = await deps.fetchEscrow();
  } catch (e) {
    return { ok: false, action: RESULT_ACTIONS.ERROR, error: e && e.message ? e.message : String(e) };
  }

  const localKey = deps.getLocalKeyHex();
  const hasEscrow = !!(escrowResp && escrowResp.ok && escrowResp.blob);

  if (!hasEscrow) {
    if (!localKey) return { ok: false, action: RESULT_ACTIONS.NO_KEY_NO_ESCROW };
    try {
      const blob = deps.encryptEscrow(localKey, licenceKey);
      const uploaded = await deps.uploadEscrow(blob);
      return uploaded
        ? { ok: true, action: RESULT_ACTIONS.UPLOADED_LOCAL_KEY }
        : { ok: false, action: RESULT_ACTIONS.UPLOAD_FAILED };
    } catch (e) {
      return { ok: false, action: RESULT_ACTIONS.UPLOAD_FAILED, error: e && e.message ? e.message : String(e) };
    }
  }

  const canonicalKey = deps.decryptEscrow(escrowResp.blob, licenceKey);
  if (!canonicalKey || canonicalKey.length !== 64) {
    // Escrow exists but was written under a different licence string — do NOT
    // overwrite it and do NOT change the local key. Surface for support.
    return { ok: false, action: RESULT_ACTIONS.ESCROW_UNDECRYPTABLE };
  }

  if (localKey && canonicalKey === localKey) {
    return { ok: true, action: RESULT_ACTIONS.MATCH };
  }

  deps.adoptKey(canonicalKey);

  if (!localKey) {
    return { ok: true, action: RESULT_ACTIONS.ADOPTED_NO_LOCAL };
  }

  // Local records were pushed under the OLD key — re-key so the cloud store
  // converges on the canonical key for every device.
  await deps.rekeyLocalRecords();
  return { ok: true, action: RESULT_ACTIONS.ADOPTED_REKEYED };
}

module.exports = { ensureCanonicalSyncKey, RESULT_ACTIONS };
