'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STATE_FILE,
  ALLOWED_PAYLOAD_KEYS,
  shouldSendHeartbeat,
  buildHeartbeatPayload,
  payloadIsPrivacySafe,
  readLastHeartbeatAt,
  writeLastHeartbeatAt,
} = require('../main/usageHeartbeat');

describe('usageHeartbeat gate', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');

  it('sends when lastHeartbeatAt is missing', () => {
    assert.equal(shouldSendHeartbeat(null, now), true);
    assert.equal(shouldSendHeartbeat(undefined, now), true);
    assert.equal(shouldSendHeartbeat('', now), true);
  });

  it('sends when lastHeartbeatAt is unparseable', () => {
    assert.equal(shouldSendHeartbeat('not-a-date', now), true);
  });

  it('sends when lastHeartbeatAt is older than 24h', () => {
    const staleIso = new Date(now - HEARTBEAT_INTERVAL_MS - 1).toISOString();
    const staleMs = now - HEARTBEAT_INTERVAL_MS - 1000;
    assert.equal(shouldSendHeartbeat(staleIso, now), true);
    assert.equal(shouldSendHeartbeat(staleMs, now), true);
  });

  it('skips when lastHeartbeatAt is within 24h', () => {
    const recentIso = new Date(now - HEARTBEAT_INTERVAL_MS + 60_000).toISOString();
    const recentMs = now - 1000;
    assert.equal(shouldSendHeartbeat(recentIso, now), false);
    assert.equal(shouldSendHeartbeat(recentMs, now), false);
    assert.equal(shouldSendHeartbeat(now, now), false);
  });

  it('sends exactly at the 24h boundary', () => {
    assert.equal(shouldSendHeartbeat(now - HEARTBEAT_INTERVAL_MS, now), true);
  });
});

describe('usageHeartbeat payload', () => {
  it('builds only machineId, platform, appVersion, tier', () => {
    const machineId = crypto.createHash('sha256').update('host|linux|x64|cpu|mem').digest('hex').slice(0, 32);
    const payload = buildHeartbeatPayload({
      machineId,
      platform: 'linux',
      appVersion: '1.9.80',
      tier: 'pro',
      email: 'should-not-appear@example.com',
      ufn: 'UFN123',
      licenceKey: 'CN-AAAA-BBBB-CCCC-DDDD',
      clientName: 'Secret Client',
    });
    assert.deepEqual(Object.keys(payload).sort(), [...ALLOWED_PAYLOAD_KEYS].sort());
    assert.equal(payload.machineId, machineId);
    assert.equal(payload.platform, 'linux');
    assert.equal(payload.appVersion, '1.9.80');
    assert.equal(payload.tier, 'pro');
    assert.equal(payload.email, undefined);
    assert.equal(payload.ufn, undefined);
    assert.equal(payload.licenceKey, undefined);
    assert.equal(payload.clientName, undefined);
    assert.equal(payloadIsPrivacySafe(payload), true);
  });

  it('defaults missing tier to none and requires hashed machineId', () => {
    const bad = buildHeartbeatPayload({
      machineId: 'hostname-not-hashed',
      platform: 'win32',
      appVersion: '1.9.80',
    });
    assert.equal(bad.tier, 'none');
    assert.equal(payloadIsPrivacySafe(bad), false);

    const goodId = 'a'.repeat(32);
    const good = buildHeartbeatPayload({
      machineId: goodId,
      platform: 'darwin',
      appVersion: '1.9.80',
      tier: 'free',
    });
    assert.equal(payloadIsPrivacySafe(good), true);
  });
});

describe('usageHeartbeat persistence', () => {
  it('reads and writes lastHeartbeatAt under a local stamp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-heartbeat-'));
    const stampPath = path.join(dir, HEARTBEAT_STATE_FILE);
    assert.equal(readLastHeartbeatAt(stampPath, fs), null);

    const at = '2026-08-31T10:00:00.000Z';
    writeLastHeartbeatAt(stampPath, fs, at);
    assert.equal(readLastHeartbeatAt(stampPath, fs), at);
    assert.equal(shouldSendHeartbeat(readLastHeartbeatAt(stampPath, fs), Date.parse('2026-08-31T12:00:00.000Z')), false);
    assert.equal(shouldSendHeartbeat(readLastHeartbeatAt(stampPath, fs), Date.parse('2026-09-01T11:00:00.000Z')), true);
  });
});
