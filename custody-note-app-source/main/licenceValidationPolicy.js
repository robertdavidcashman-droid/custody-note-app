/**
 * Shared rules for applying online licence validation results to local
 * licence.dat. Keeps admin / synthetic Free keys from being permanently
 * stamped as revoked by a single failed server response.
 */
'use strict';

const { isAdminEmail, isSyntheticLocalLicenceKey } = require('./licenceAdminEmails');

/**
 * @param {object|null} data stored licence
 * @param {string[]} adminEmails
 * @returns {boolean}
 */
function isAdminLicence(data, adminEmails) {
  return !!(data && isAdminEmail(data.email, adminEmails));
}

/**
 * Local Free/trial synthetic keys are not server-managed subscriptions.
 * Validating them online can falsely return invalid → revoked.
 * @param {object|null} data
 * @returns {boolean}
 */
function shouldSkipOnlineValidation(data) {
  if (!data) return true;
  if (data.authToken) return false;
  return isSyntheticLocalLicenceKey(data.key);
}

/**
 * Apply a successful or failed online validation response onto a copy of
 * the stored licence fields. Does not write to disk.
 *
 * @param {object} data current licence data (mutated)
 * @param {{ valid: boolean|null, offline?: boolean, expiresAt?: string|null, email?: string, isTrial?: boolean, serverStatus?: string|null, entitlements?: object|null, message?: string }} result
 * @param {{ adminEmails?: string[] }} [options]
 * @returns {{ persisted: boolean, clearedRevoked: boolean, skippedPersistRevoke: boolean }}
 */
function applyOnlineValidationResult(data, result, options) {
  const adminEmails = (options && options.adminEmails) || [];
  const admin = isAdminLicence(data, adminEmails);
  let persisted = false;
  let clearedRevoked = false;
  let skippedPersistRevoke = false;

  if (!data || !result) {
    return { persisted, clearedRevoked, skippedPersistRevoke };
  }

  if (result.valid === true) {
    data.lastValidated = new Date().toISOString();
    if (result.expiresAt) data.expiresAt = result.expiresAt;
    if (result.email) data.email = result.email;
    if (result.isTrial !== undefined) data.isTrial = !!result.isTrial;
    if (result.serverStatus) data.status = result.serverStatus;
    else data.status = 'active';
    if (result.entitlements !== undefined) data.entitlements = result.entitlements;
    if (data.status === 'revoked' || data.status === 'invalid') {
      // Server said valid — never keep a stale revoked stamp.
      data.status = 'active';
      clearedRevoked = true;
    }
    persisted = true;
    return { persisted, clearedRevoked, skippedPersistRevoke };
  }

  if (result.valid === false) {
    const serverStatus = result.serverStatus || 'revoked';
    if (admin) {
      // Admin licences are never revoked locally. Keep active and refresh
      // non-status fields when the server still returned them.
      if (result.email) data.email = result.email;
      if (result.expiresAt) data.expiresAt = result.expiresAt;
      if (result.entitlements !== undefined) data.entitlements = result.entitlements;
      if (data.status === 'revoked' || data.status === 'invalid' || data.status === 'already_used') {
        data.status = 'active';
        clearedRevoked = true;
      } else if (!data.status) {
        data.status = 'active';
      }
      skippedPersistRevoke = true;
      persisted = true;
      return { persisted, clearedRevoked, skippedPersistRevoke };
    }

    if (isSyntheticLocalLicenceKey(data.key) && !data.authToken) {
      skippedPersistRevoke = true;
      return { persisted, clearedRevoked, skippedPersistRevoke };
    }

    if (serverStatus === 'expired') data.expiresAt = result.expiresAt || data.expiresAt;
    data.status = serverStatus;
    persisted = true;
    return { persisted, clearedRevoked, skippedPersistRevoke };
  }

  return { persisted, clearedRevoked, skippedPersistRevoke };
}

module.exports = {
  isAdminLicence,
  shouldSkipOnlineValidation,
  applyOnlineValidationResult,
};
