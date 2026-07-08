const fs = require('fs');
const path = require('path');

const STATE_FILE_NAME = 'cn-auto-update-state.json';

function getStatePath(app) {
  return path.join(app.getPath('userData'), STATE_FILE_NAME);
}

function getDefaultState() {
  return {
    lastVersion: null,
    pendingUpdateVersion: null,
    pendingInstallVersion: null,
    lastStartupAt: null,
    updateDownloadedAt: null,
    installAttemptedAt: null,
    lastCountedInstallAttemptAt: null,
    failedInstallCount: 0,
    updaterDisabledUntil: null,
    lastError: null,
    loopDetectedAt: null,
    lastAppliedVersion: null,
    lastAppliedAt: null,
    lastRemoteVersion: null,
    lastNoUpdateCheckAt: null,
    appVersionAtCheck: null,
    consecutiveDownloadFailures: 0,
    downloadFailureVersion: null,
  };
}

function normalizeState(raw) {
  const state = Object.assign({}, getDefaultState(), raw || {});
  if (state.pendingDownloadedAt != null && state.updateDownloadedAt == null) {
    state.updateDownloadedAt = state.pendingDownloadedAt;
  }
  if (!Number.isFinite(state.failedInstallCount)) {
    state.failedInstallCount = 0;
  }
  if (!Number.isFinite(state.consecutiveDownloadFailures)) {
    state.consecutiveDownloadFailures = 0;
  }
  if (state.lastCountedInstallAttemptAt != null && !Number.isFinite(state.lastCountedInstallAttemptAt)) {
    state.lastCountedInstallAttemptAt = null;
  }
  return state;
}

function readState(app) {
  try {
    const statePath = getStatePath(app);
    if (!fs.existsSync(statePath)) return normalizeState(null);
    return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (_) {
    return normalizeState(null);
  }
}

function writeState(app, state) {
  const statePath = getStatePath(app);
  const next = normalizeState(state);
  fs.writeFileSync(statePath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function mergeState(app, patch) {
  const current = readState(app);
  const update = typeof patch === 'function' ? patch(current) : patch;
  return writeState(app, Object.assign({}, current, update || {}));
}

module.exports = {
  STATE_FILE_NAME,
  getStatePath,
  getDefaultState,
  normalizeState,
  readState,
  writeState,
  mergeState,
};
