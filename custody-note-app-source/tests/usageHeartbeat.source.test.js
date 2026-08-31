'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const analyticsMd = fs.readFileSync(path.join(ROOT, 'docs', 'ANALYTICS.md'), 'utf8');

describe('usage heartbeat wiring (source)', () => {
  it('posts to /api/stats/heartbeat and not trial-started for the daily ping', () => {
    assert.match(mainJs, /reportUsageHeartbeatToServer/);
    assert.match(mainJs, /scheduleUsageHeartbeat/);
    assert.match(mainJs, /\/api\/stats\/heartbeat/);
    assert.match(mainJs, /usageHeartbeat/);
    assert.match(mainJs, /HEARTBEAT_STATE_FILE|cn-usage-heartbeat\.json/);
  });

  it('is packaged-only, deferred, fire-and-forget with short timeout', () => {
    assert.match(mainJs, /function reportUsageHeartbeatToServer/);
    const fnStart = mainJs.indexOf('function reportUsageHeartbeatToServer');
    assert.ok(fnStart > 0);
    const fnBody = mainJs.slice(fnStart, fnStart + 1800);
    assert.match(fnBody, /app\.isPackaged/);
    assert.match(fnBody, /timeout:\s*8000/);
    assert.match(fnBody, /\.catch\(/);

    const scheduleStart = mainJs.indexOf('function scheduleUsageHeartbeat');
    assert.ok(scheduleStart > 0);
    const scheduleBody = mainJs.slice(scheduleStart, scheduleStart + 800);
    assert.match(scheduleBody, /did-finish-load|ready-to-show/);
    assert.match(scheduleBody, /setTimeout/);

    assert.match(mainJs, /scheduleUsageHeartbeat\(mainWindow\)/);
  });

  it('documents the heartbeat in ANALYTICS.md', () => {
    assert.match(analyticsMd, /usage_heartbeat/);
    assert.match(analyticsMd, /\/api\/stats\/heartbeat/);
    assert.match(analyticsMd, /machineId/);
    assert.match(analyticsMd, /unique machines/i);
    assert.match(analyticsMd, /Do \*\*not\*\* reuse `trial-started`/);
  });
});