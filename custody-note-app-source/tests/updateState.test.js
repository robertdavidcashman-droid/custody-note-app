const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readState, mergeState, getDefaultState } = require('../updateState');

function makeFakeApp(userDataPath) {
  return {
    getPath(name) {
      if (name !== 'userData') throw new Error('Unexpected path request');
      return userDataPath;
    },
  };
}

test('updateState returns defaults when no state file exists', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-update-state-'));
  const app = makeFakeApp(tempDir);
  const state = readState(app);
  assert.deepEqual(state, getDefaultState());
});

test('updateState preserves compatibility with pendingDownloadedAt', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-update-state-'));
  const app = makeFakeApp(tempDir);
  mergeState(app, {
    pendingDownloadedAt: 1234,
    pendingInstallVersion: '1.2.3',
    failedInstallCount: 1,
  });
  const state = readState(app);
  assert.equal(state.updateDownloadedAt, 1234);
  assert.equal(state.pendingInstallVersion, '1.2.3');
  assert.equal(state.failedInstallCount, 1);
});
