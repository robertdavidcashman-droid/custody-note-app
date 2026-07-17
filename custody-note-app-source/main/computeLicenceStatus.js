/**
 * Compute local licence status from stored licence.dat fields.
 * Shared by main process IPC and unit tests.
 */
const DEFAULT_GRACE_DAYS = 60;
const DEFAULT_TRIAL_DAYS = 30;

function computeLicenceStatus(data, options) {
  const opts = options || {};
  const graceDays = opts.graceDays != null ? opts.graceDays : DEFAULT_GRACE_DAYS;
  const trialDays = opts.trialDays != null ? opts.trialDays : DEFAULT_TRIAL_DAYS;
  const adminEmails = Array.isArray(opts.adminEmails) ? opts.adminEmails : [];

  const noAddons = { quickfile: false, emailAddon: false };
  if (!data || !data.key) return { status: 'none', message: 'No licence activated', addons: noAddons };

  const isAdmin = data.email && adminEmails.includes(String(data.email).toLowerCase());
  const isAddonValid = (exp) => exp && new Date(exp).getTime() > Date.now();
  const addons = {
    quickfile: isAdmin || isAddonValid(data.entitlements?.quickfile?.expiresAt),
    emailAddon: isAdmin || isAddonValid(data.entitlements?.emailAddon?.expiresAt),
  };

  if (data.status === 'revoked' || data.status === 'invalid') {
    return { status: 'revoked', message: 'Licence has been revoked. Please enter a new licence key or contact support.', key: data.key, email: data.email, addons, entitlements: data.entitlements || null };
  }
  if (data.status === 'already_used') {
    return {
      status: 'already_used',
      message: data.message || 'Licence is already in use on the maximum number of devices. Deactivate a device in Settings on an activated PC, then try again.',
      key: data.key,
      email: data.email,
      addons,
      entitlements: data.entitlements || null,
    };
  }

  const now = Date.now();
  if (data.expiresAt) {
    const expiryMs = new Date(data.expiresAt).getTime();
    const daysRemaining = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
    if (expiryMs < now) {
      return { status: 'expired', message: 'Your subscription expired on ' + new Date(data.expiresAt).toLocaleDateString('en-GB') + '. Please renew to continue using Custody Note.', key: data.key, email: data.email, daysRemaining: 0, isTrial: !!data.isTrial, trialDays, addons, entitlements: data.entitlements || null };
    }
    if (daysRemaining <= 7) {
      return { status: 'expiring_soon', message: 'Your ' + (data.isTrial ? 'trial' : 'subscription') + ' expires in ' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '') + '. Please renew to avoid interruption.', key: data.key, email: data.email || '', expiresAt: data.expiresAt, activatedAt: data.activatedAt, lastValidated: data.lastValidated, daysRemaining, isTrial: !!data.isTrial, trialDays, addons, entitlements: data.entitlements || null };
    }
  }

  if (data.lastValidated) {
    const sinceLast = now - new Date(data.lastValidated).getTime();
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    if (sinceLast > graceMs) {
      return {
        status: 'grace_expired',
        message: 'Licence could not be verified for ' + graceDays + ' days. Connect to the internet to verify your subscription — your licence is still active.',
        key: data.key,
        email: data.email,
        graceDays,
        addons,
        entitlements: data.entitlements || null,
        expiresAt: data.expiresAt || null,
        lastValidated: data.lastValidated,
        isTrial: !!data.isTrial,
      };
    }
  }

  const result = {
    status: 'active',
    key: data.key,
    email: data.email || '',
    expiresAt: data.expiresAt || null,
    activatedAt: data.activatedAt,
    lastValidated: data.lastValidated,
    isTrial: !!data.isTrial,
    trialDays: data.isTrial ? trialDays : undefined,
    addons,
    entitlements: data.entitlements || null,
    graceDays,
  };
  if (data.expiresAt) {
    result.daysRemaining = Math.ceil((new Date(data.expiresAt).getTime() - now) / (24 * 60 * 60 * 1000));
  }
  return result;
}

module.exports = { computeLicenceStatus, DEFAULT_GRACE_DAYS, DEFAULT_TRIAL_DAYS };
