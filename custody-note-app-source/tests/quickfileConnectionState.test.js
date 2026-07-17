/**
 * Unit tests for QuickFile connection-state derivation (renderer/lib/quickfileConnectionState.js).
 *
 * These verify the app describes the QuickFile link from DB-backed facts
 * (configured credentials + last real health-check result), NOT from fragile
 * browser state, and that "not connected" is only shown when credentials are
 * actually missing or a real test actually failed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { deriveQuickFileConnectionState } = require('../renderer/lib/quickfileConnectionState');

describe('deriveQuickFileConnectionState', () => {
  it('reports not_configured with specific missing fields + reconnect instructions', () => {
    const s = deriveQuickFileConnectionState({ missing: ['Account number', 'API key'] });
    assert.strictEqual(s.state, 'not_configured');
    assert.strictEqual(s.ok, false);
    assert.strictEqual(s.configured, false);
    assert.match(s.detail, /Account number, API key/);
    assert.ok(s.instructions.some((i) => /Custody Note account/i.test(i)), 'must explain account-backed storage');
    assert.ok(s.instructions.length >= 2, 'must give reconnect steps');
  });

  it('reports configured_untested when all credentials present but never tested', () => {
    const s = deriveQuickFileConnectionState({ missing: [], lengths: { account: 5, apiKey: 32, applicationId: 10 } });
    assert.strictEqual(s.state, 'configured_untested');
    assert.strictEqual(s.ok, false);
    assert.strictEqual(s.configured, true);
    assert.match(s.headline, /loaded from your account/i);
    assert.match(s.detail, /Test QuickFile connection/i);
  });

  it('not_configured mentions syncing from another computer', () => {
    const s = deriveQuickFileConnectionState({ missing: ['Application ID'] });
    assert.ok(s.instructions.some((i) => /another computer/i.test(i)), 'must mention account sync from other machine');
    assert.ok(!s.instructions.some((i) => /this computer only/i.test(i)), 'must not say this-computer-only');
  });

  it('reports connected (ok=true) after a successful test with the verified time', () => {
    const s = deriveQuickFileConnectionState({ missing: [], lastOkAt: '2026-06-06T10:00:00.000Z' });
    assert.strictEqual(s.state, 'connected');
    assert.strictEqual(s.ok, true);
    assert.match(s.headline, /Connected/);
    assert.match(s.detail, /Last verified/);
  });

  it('reports error with the failure reason + reconnect instructions when last test failed', () => {
    const s = deriveQuickFileConnectionState({
      missing: [],
      lastError: 'QuickFile HTTP 401: invalid credentials',
      lastCheckedAt: '2026-06-06T10:00:00.000Z',
    });
    assert.strictEqual(s.state, 'error');
    assert.strictEqual(s.ok, false);
    assert.match(s.detail, /401/);
    assert.ok(s.instructions.length >= 1, 'error state must give recovery steps');
  });

  it('prefers a fresh failure over a stale success (lastError wins)', () => {
    const s = deriveQuickFileConnectionState({
      missing: [],
      lastOkAt: '2026-06-01T10:00:00.000Z',
      lastError: 'Network timeout',
      lastCheckedAt: '2026-06-06T10:00:00.000Z',
    });
    assert.strictEqual(s.state, 'error');
  });

  it('never claims connected when credentials are missing, even with a stale lastOkAt', () => {
    const s = deriveQuickFileConnectionState({ missing: ['API key'], lastOkAt: '2026-06-01T10:00:00.000Z' });
    assert.strictEqual(s.state, 'not_configured');
    assert.strictEqual(s.ok, false);
  });

  it('reports sync_unavailable when account pull fails with route/HTML 404', () => {
    const s = deriveQuickFileConnectionState({
      missing: ['Account number', 'API key', 'Application ID'],
      syncError: 'Server error 404',
    });
    assert.strictEqual(s.state, 'sync_unavailable');
    assert.match(s.headline, /temporarily unavailable/i);
    assert.ok(!s.instructions.some((i) => /another computer/i.test(i)), 'must not imply sync worked');
  });

  it('not_configured when server has no saved credentials (JSON 404)', () => {
    const s = deriveQuickFileConnectionState({
      missing: ['API key'],
      syncError: 'No QuickFile settings found for this licence',
    });
    assert.strictEqual(s.state, 'not_configured');
    assert.ok(s.instructions.some((i) => /No QuickFile credentials are saved/i.test(i)));
  });
});
