/**
 * Resolve which emails receive product-owner admin licence treatment.
 *
 * Packaged installs rarely have process.env set, so a small built-in list of
 * product-owner emails remains as the fail-open fallback for admin licences.
 * CUSTODY_ADMIN_EMAILS (comma-separated) replaces the built-in list when set.
 * licence-config.json may also supply adminEmails.
 *
 * Admin licences are intentionally non-revocable in the desktop client and
 * always re-checked online on startup.
 */
'use strict';

const BUILTIN_ADMIN_EMAILS = Object.freeze([
  'robertdavidcashman@gmail.com',
  'nerijus83@gmail.com',
]);

function normalizeEmailList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const email = String(raw || '')
      .trim()
      .toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function parseAdminEmailsEnv(envValue) {
  if (envValue == null || envValue === '') return [];
  return normalizeEmailList(String(envValue).split(','));
}

/**
 * @param {{ envValue?: string|null, configEmails?: string[]|null, includeBuiltin?: boolean }} [opts]
 * @returns {string[]}
 */
function resolveAdminEmails(opts) {
  const options = opts || {};
  const fromEnv = parseAdminEmailsEnv(options.envValue);
  if (fromEnv.length) return fromEnv;
  const fromConfig = normalizeEmailList(options.configEmails);
  if (fromConfig.length) return fromConfig;
  if (options.includeBuiltin === false) return [];
  return normalizeEmailList(BUILTIN_ADMIN_EMAILS);
}

function isAdminEmail(email, adminEmails) {
  if (!email) return false;
  const list = Array.isArray(adminEmails) ? adminEmails : [];
  return list.includes(String(email).trim().toLowerCase());
}

function isSyntheticLocalLicenceKey(key) {
  const k = String(key || '').toUpperCase();
  return k.startsWith('FREE-') || k.startsWith('TRIAL-');
}

module.exports = {
  BUILTIN_ADMIN_EMAILS,
  normalizeEmailList,
  parseAdminEmailsEnv,
  resolveAdminEmails,
  isAdminEmail,
  isSyntheticLocalLicenceKey,
};
