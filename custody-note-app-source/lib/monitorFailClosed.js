'use strict';

/**
 * Enforce fail-closed behaviour when data-safety monitors fire.
 * Monitors detect; this gate blocks overwrite / wipe / destructive pull.
 * Merge-only apply remains allowed while mayOverwriteKnownGood stays false.
 */

const { runDataSafetyMonitors, SEVERITY } = require('./dataSafetyMonitors');

const DESTRUCTIVE_ACTIONS = new Set([
  'wipe',
  'replace_all',
  'overwrite_known_good',
  'restore_empty',
  'accept_empty_cloud_as_wipe',
]);

/**
 * @param {object} monitorInput — same shape as runDataSafetyMonitors
 * @param {{ intendedAction?: string }} opts
 */
function enforceMonitorFailClosed(monitorInput = {}, opts = {}) {
  const report = runDataSafetyMonitors(monitorInput);
  const action = String(opts.intendedAction || 'merge').toLowerCase();
  const destructive = DESTRUCTIVE_ACTIONS.has(action);
  const hasBlocking = report.findings.some(
    (f) => f.severity === SEVERITY.ERROR || f.severity === SEVERITY.CRITICAL
  );

  if (destructive) {
    return {
      allowed: false,
      failClosed: true,
      retainLocal: true,
      mayOverwriteKnownGood: false,
      blockedAction: action,
      report,
    };
  }

  return {
    // Merge-only upsert/soft-tombstone may continue; overwrite of known-good may not.
    allowed: true,
    failClosed: hasBlocking,
    retainLocal: true,
    mayOverwriteKnownGood: false,
    blockedAction: null,
    report,
  };
}

function assertMayOverwriteKnownGood(gate) {
  if (gate && gate.mayOverwriteKnownGood === true) return true;
  const err = new Error('REFUSING_OVERWRITE_KNOWN_GOOD: monitors fail-closed; retain local');
  err.code = 'REFUSING_OVERWRITE_KNOWN_GOOD';
  throw err;
}

module.exports = {
  enforceMonitorFailClosed,
  assertMayOverwriteKnownGood,
  DESTRUCTIVE_ACTIONS,
};
