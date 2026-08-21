/**
 * Compute local licence status from stored licence.dat fields.
 * Shared by main process IPC and unit tests.
 *
 * Tiers (freemium):
 *   free  — core features forever (FREE-* or expired trial/paid downgraded)
 *   trial — legacy timed trial (migrated to free when FREE_TIER_ENABLED)
 *   pro   — paid / complimentary Lemon subscription
 */
const DEFAULT_GRACE_DAYS = 60;
const DEFAULT_TRIAL_DAYS = 30;

function keyLooksFree(key) {
  return String(key || '').toUpperCase().startsWith('FREE-');
}

function keyLooksTrial(key) {
  return String(key || '').toUpperCase().startsWith('TRIAL-');
}

function keyLooksAccount(key) {
  return String(key || '').toUpperCase().startsWith('ACCOUNT-');
}

function resolveTier(data) {
  if (!data || !data.key) return 'none';
  if (data.tier === 'free' || data.tier === 'pro' || data.tier === 'trial') return data.tier;
  if (keyLooksFree(data.key)) return 'free';
  if (keyLooksTrial(data.key) || data.isTrial) return 'trial';
  if (keyLooksAccount(data.key) && data.isTrial) return 'trial';
  return 'pro';
}

function computeLicenceStatus(data, options) {
  const opts = options || {};
  const graceDays = opts.graceDays != null ? opts.graceDays : DEFAULT_GRACE_DAYS;
  const trialDays = opts.trialDays != null ? opts.trialDays : DEFAULT_TRIAL_DAYS;
  const adminEmails = Array.isArray(opts.adminEmails) ? opts.adminEmails : [];
  const freeTierEnabled = opts.freeTierEnabled !== false;

  const noAddons = { quickfile: false, emailAddon: false };
  if (!data || !data.key) {
    return {
      status: 'none',
      message: 'No licence activated',
      addons: noAddons,
      tier: 'none',
      createAllowed: freeTierEnabled,
    };
  }

  const isAdmin = !!(data.email && adminEmails.includes(String(data.email).toLowerCase()));
  const isAddonValid = (exp) => exp && new Date(exp).getTime() > Date.now();
  const addons = {
    quickfile: isAdmin || isAddonValid(data.entitlements?.quickfile?.expiresAt),
    emailAddon: isAdmin || isAddonValid(data.entitlements?.emailAddon?.expiresAt),
  };

  let tier = resolveTier(data);

  // Product-owner admin licences are never revoked/expired in the client.
  // Online validation still runs on startup so entitlements stay fresh.
  if (isAdmin) {
    return {
      status: 'active',
      message: 'Admin licence — always active.',
      key: data.key,
      email: data.email || '',
      expiresAt: data.expiresAt || null,
      activatedAt: data.activatedAt,
      lastValidated: data.lastValidated,
      isTrial: false,
      isFree: false,
      isAdmin: true,
      trialDays: undefined,
      addons: { quickfile: true, emailAddon: true },
      entitlements: data.entitlements || null,
      graceDays,
      tier: 'pro',
      createAllowed: true,
    };
  }

  // Synthetic Free keys are local-only; a stale revoked stamp must not block them.
  if (
    (data.status === 'revoked' || data.status === 'invalid') &&
    !(freeTierEnabled && (tier === 'free' || keyLooksFree(data.key)))
  ) {
    return {
      status: 'revoked',
      message: 'Licence has been revoked. Please enter a new licence key or contact support.',
      key: data.key,
      email: data.email,
      addons,
      entitlements: data.entitlements || null,
      tier,
      createAllowed: false,
    };
  }
  if (data.status === 'already_used') {
    return {
      status: 'already_used',
      message: data.message || 'Licence is already in use on the maximum number of devices. Deactivate a device in Settings on an activated PC, then try again.',
      key: data.key,
      email: data.email,
      addons,
      entitlements: data.entitlements || null,
      tier,
      createAllowed: false,
    };
  }

  const now = Date.now();

  // Non-expiring Free during beta
  if (tier === 'free' || (freeTierEnabled && keyLooksFree(data.key))) {
    return {
      status: 'active',
      key: data.key,
      email: data.email || '',
      expiresAt: null,
      activatedAt: data.activatedAt,
      lastValidated: data.lastValidated,
      isTrial: false,
      isFree: true,
      tier: 'free',
      createAllowed: true,
      addons,
      entitlements: data.entitlements || null,
      graceDays,
    };
  }

  if (data.expiresAt) {
    const expiryMs = new Date(data.expiresAt).getTime();
    const daysRemaining = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
    if (expiryMs < now) {
      // Freemium: expired trial or paid → Free core still usable; Pro extras gated elsewhere
      if (freeTierEnabled) {
        const wasTrial = !!data.isTrial || keyLooksTrial(data.key);
        return {
          status: 'active',
          message: wasTrial
            ? 'You are on free beta access. Pro (cloud backup) is planned after beta.'
            : 'Your Pro subscription expired on ' +
              new Date(data.expiresAt).toLocaleDateString('en-GB') +
              '. Core features remain available on free beta access — Paid Pro planned after beta for cloud backup and advanced tools.',
          key: data.key,
          email: data.email,
          daysRemaining: 0,
          isTrial: false,
          isFree: true,
          tier: 'free',
          proExpired: !wasTrial,
          createAllowed: true,
          trialDays,
          addons: noAddons,
          entitlements: null,
        };
      }
      return {
        status: 'expired',
        message:
          'Your subscription expired on ' +
          new Date(data.expiresAt).toLocaleDateString('en-GB') +
          '. Please renew to continue using Custody Note.',
        key: data.key,
        email: data.email,
        daysRemaining: 0,
        isTrial: !!data.isTrial,
        trialDays,
        addons,
        entitlements: data.entitlements || null,
        tier,
        createAllowed: false,
      };
    }
    if (daysRemaining <= 7) {
      return {
        status: 'expiring_soon',
        message:
          'Your ' +
          (data.isTrial ? 'trial' : 'subscription') +
          ' expires in ' +
          daysRemaining +
          ' day' +
          (daysRemaining !== 1 ? 's' : '') +
          '. Please renew to avoid interruption.',
        key: data.key,
        email: data.email || '',
        expiresAt: data.expiresAt,
        activatedAt: data.activatedAt,
        lastValidated: data.lastValidated,
        daysRemaining,
        isTrial: !!data.isTrial,
        trialDays,
        addons,
        entitlements: data.entitlements || null,
        tier,
        createAllowed: true,
      };
    }
  }

  if (data.lastValidated && tier === 'pro') {
    const sinceLast = now - new Date(data.lastValidated).getTime();
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    if (sinceLast > graceMs) {
      return {
        status: 'grace_expired',
        message:
          'Licence could not be verified for ' +
          graceDays +
          ' days. Connect to the internet to verify your subscription — your licence is still active.',
        key: data.key,
        email: data.email,
        graceDays,
        addons,
        entitlements: data.entitlements || null,
        expiresAt: data.expiresAt || null,
        lastValidated: data.lastValidated,
        isTrial: !!data.isTrial,
        tier,
        createAllowed: true,
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
    isFree: tier === 'free',
    trialDays: data.isTrial ? trialDays : undefined,
    addons,
    entitlements: data.entitlements || null,
    graceDays,
    tier,
    createAllowed: true,
  };
  if (data.expiresAt) {
    result.daysRemaining = Math.ceil((new Date(data.expiresAt).getTime() - now) / (24 * 60 * 60 * 1000));
  }
  return result;
}

module.exports = {
  computeLicenceStatus,
  resolveTier,
  DEFAULT_GRACE_DAYS,
  DEFAULT_TRIAL_DAYS,
};
