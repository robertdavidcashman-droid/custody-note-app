'use strict';

/**
 * Encrypt / decrypt QuickFile credentials for central server storage.
 * Server stores ciphertext only — decryption requires the licence key.
 */

const crypto = require('crypto');

const PBKDF2_ITERATIONS = 600000;
const PBKDF2_DIGEST = 'sha512';
const SALT_PREFIX = 'cn-qf-settings-salt:';

function deriveKey(licenceKey) {
  const normalized = String(licenceKey || '').trim().toUpperCase();
  const salt = crypto.createHash('sha256').update(SALT_PREFIX + normalized).digest();
  return crypto.pbkdf2Sync(normalized, salt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST);
}

function encryptQuickFileSettings(licenceKey, settings) {
  const payload = JSON.stringify({
    quickfileAccountNumber: String(settings.quickfileAccountNumber || '').trim(),
    quickfileApiKey: String(settings.quickfileApiKey || '').trim(),
    quickfileAppId: String(settings.quickfileAppId || '').trim(),
  });
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
    return {
      quickfileAccountNumber: String(parsed.quickfileAccountNumber || '').trim(),
      quickfileApiKey: String(parsed.quickfileApiKey || '').trim(),
      quickfileAppId: String(parsed.quickfileAppId || '').trim(),
    };
  } catch (_) {
    return null;
  }
}

function pushQuickFileSettingsToServer(httpPost, apiUrl, licenceKey, machineId, settings, opts) {
  if (!httpPost || !apiUrl || !licenceKey) {
    return Promise.resolve({ ok: false, error: 'QuickFile sync not configured' });
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
    return Promise.resolve({ ok: false, error: 'QuickFile sync not configured' });
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

module.exports = {
  encryptQuickFileSettings: encryptQuickFileSettings,
  decryptQuickFileSettings: decryptQuickFileSettings,
  pushQuickFileSettingsToServer: pushQuickFileSettingsToServer,
  pullQuickFileSettingsFromServer: pullQuickFileSettingsFromServer,
};
