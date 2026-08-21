'use strict';

/**
 * Encrypt / decrypt licence-synced user settings for central server storage.
 * Uses the existing /api/settings/quickfile endpoint (opaque ciphertext blob).
 * Decryption requires the licence key. Machine-local paths/counters are excluded.
 */

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 600000;
const PBKDF2_DIGEST = 'sha512';
const SALT_PREFIX = 'cn-qf-settings-salt:';

/**
 * Keys synced across the user's Custody Note installs (same licence).
 * Do not add machine paths, watermarks, or per-device counters here.
 */
const SYNCABLE_SETTINGS_KEYS = [
  /* Integrations / secrets */
  'quickfileAccountNumber',
  'quickfileApiKey',
  'quickfileAppId',
  'openaiApiKey',
  /* Identity / work defaults */
  'email',
  'dsccPin',
  'feeEarnerNameDefault',
  'feeEarnerSigMode',
  'feeEarnerSigMaster',
  'officePostcode',
  'billingAttendanceFee',
  'billingMileageRate',
  'billingVatRate',
  'pdfBrandingFooter',
  'outlookAccountType',
  'alwaysUseOutlookWeb',
  /* UX */
  'darkMode',
  'colourTheme',
  'fontSize',
  'scrollbarScale',
  'displayDensity',
  'formSubsectionsMode',
  'layoutMode',
  'navMode',
  'homePriority',
  'homeWidgetsMode',
  'homeShowActive',
  'homeShowDashboard',
  'homeShowShortcuts',
  'homeShowLaa',
  'homeShowStatus',
  'showContextPanel',
  'forceThreeCol',
  'stickySectionHeadings',
  'largerTextareas',
  'sectionAccents',
  'highContrast',
  'largeControls',
  'reducedMotion',
  'idleTimeoutMinutes',
  'suggestionsForumUrl',
  'contextPanelCollapsed',
  'scratchpadText',
  'recentStations',
  'referralCode',
  /* Content packs */
  'customTemplatesJson',
  'firmWorkspaceJson',
];

/** Explicit exclude list (documentation / guards). */
const MACHINE_LOCAL_SETTINGS_KEYS = [
  'backupFolder',
  'offsiteBackupFolder',
  'autoImportFolder',
  'autoImportEnabled',
  'autoImportLastMtimeMs',
  'autoImportLastFile',
  'cloudBackupUrl',
  'cloudBackupToken',
  'syncApiUrl',
  'cloudApiUrl',
  'lastSyncPullAt',
  'nextFileNumberOurs',
  'nextInvoiceNumber',
  'bankHolidays',
  'quickfileSettingsSyncedAt',
  'quickfileSettingsServerUpdatedAt',
  'quickfileLastConnectionCheckedAt',
  'quickfileLastConnectionOkAt',
  'quickfileLastConnectionError',
  'quickfileLastImportAt',
  'schemeIdBackfillCompletedAt',
  'cloudBackupHomeBannerDismissed',
  'sidebarWidth',
  'contextPanelWidth',
];

function deriveKey(licenceKey) {
  const normalized = String(licenceKey || '').trim().toUpperCase();
  const salt = crypto.createHash('sha256').update(SALT_PREFIX + normalized).digest();
  return crypto.pbkdf2Sync(normalized, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
}

function pickSyncableSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const out = {};
  for (let i = 0; i < SYNCABLE_SETTINGS_KEYS.length; i++) {
    const key = SYNCABLE_SETTINGS_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(src, key) && src[key] != null) {
      out[key] = String(src[key]);
    } else {
      out[key] = '';
    }
  }
  return out;
}

function encryptQuickFileSettings(licenceKey, settings) {
  const payload = JSON.stringify(pickSyncableSettings(settings));
  const derived = deriveKey(licenceKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptQuickFileSettings(licenceKey, blob) {
  if (!blob) return null;
  const raw = Buffer.from(String(blob), 'base64');
  if (raw.length < 28) return null;
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const enc = raw.slice(28);
  try {
    const derived = deriveKey(licenceKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed = JSON.parse(dec.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return pickSyncableSettings(parsed);
  } catch (_) {
    return null;
  }
}

function pushQuickFileSettingsToServer(httpPost, apiUrl, licenceKey, machineId, settings, opts) {
  if (!httpPost || !apiUrl || !licenceKey) {
    return Promise.resolve({ ok: false, error: 'Settings sync not configured' });
  }
  const blob = encryptQuickFileSettings(licenceKey, settings);
  const headers = opts && opts.headers ? opts.headers : {};
  return httpPost(`${apiUrl.replace(/\/$/, '')}/api/settings/quickfile`, {
    key: licenceKey,
    machineId: machineId,
    blob: blob,
  }, { headers: headers, timeout: opts && opts.timeout || 15000 }).then(function(resp) {
    if (resp && resp.ok) {
      return { ok: true, updatedAt: resp.updatedAt || new Date().toISOString() };
    }
    return { ok: false, error: (resp && resp.error) || 'Push failed' };
  }).catch(function(err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  });
}

function pullQuickFileSettingsFromServer(httpPost, apiUrl, licenceKey, machineId, opts) {
  if (!httpPost || !apiUrl || !licenceKey) {
    return Promise.resolve({ ok: false, error: 'Settings sync not configured' });
  }
  const headers = opts && opts.headers ? opts.headers : {};
  return httpPost(`${apiUrl.replace(/\/$/, '')}/api/settings/quickfile`, {
    key: licenceKey,
    machineId: machineId,
  }, { headers: headers, timeout: opts && opts.timeout || 15000 }).then(function(resp) {
    if (resp && resp.ok && resp.blob) {
      return {
        ok: true,
        blob: resp.blob,
        updatedAt: resp.updatedAt || '',
      };
    }
    return { ok: false, error: (resp && resp.error) || 'Pull failed' };
  }).catch(function(err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  });
}

function isSyncableSettingsKey(key) {
  return SYNCABLE_SETTINGS_KEYS.indexOf(key) !== -1;
}

function hasAnySyncableContent(settings) {
  const picked = pickSyncableSettings(settings);
  return SYNCABLE_SETTINGS_KEYS.some(function (k) {
    return String(picked[k] || '').trim().length > 0;
  });
}

module.exports = {
  SYNCABLE_SETTINGS_KEYS: SYNCABLE_SETTINGS_KEYS,
  MACHINE_LOCAL_SETTINGS_KEYS: MACHINE_LOCAL_SETTINGS_KEYS,
  pickSyncableSettings: pickSyncableSettings,
  isSyncableSettingsKey: isSyncableSettingsKey,
  hasAnySyncableContent: hasAnySyncableContent,
  encryptQuickFileSettings: encryptQuickFileSettings,
  decryptQuickFileSettings: decryptQuickFileSettings,
  pushQuickFileSettingsToServer: pushQuickFileSettingsToServer,
  pullQuickFileSettingsFromServer: pullQuickFileSettingsFromServer,
};
