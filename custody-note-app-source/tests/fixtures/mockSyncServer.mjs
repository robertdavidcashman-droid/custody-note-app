#!/usr/bin/env node
/**
 * In-memory mock custodynote.com sync API for cross-device integration/E2E tests.
 */
import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { encryptMasterKeyForEscrow } = require('../../lib/keyEscrow.js');

const TEST_LICENCE_KEY = 'SYNC-TEST-0001-KEY1';
const TEST_USER_ID = 'user-sync-test-001';

/** @type {Map<string, { timeline: Map<number, string>, records: Map<string, object>, escrow: string | null }>} */
const stores = new Map();

function storeForKey(licenceKey) {
  const k = String(licenceKey).trim().toUpperCase();
  if (!stores.has(k)) {
    stores.set(k, { timeline: new Map(), records: new Map(), escrow: null });
  }
  return stores.get(k);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

export function resetMockSyncStores() {
  stores.clear();
}

export function getTestLicenceKey() {
  return TEST_LICENCE_KEY;
}

export function getTestUserId() {
  return TEST_USER_ID;
}

export function createMockSyncServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, { ok: true });
      }
      if (req.method !== 'POST') {
        return sendJson(res, 404, { ok: false, error: 'Not found' });
      }
      const body = await readJson(req);

      if (url.pathname === '/api/licence/validate') {
        const key = String(body.key || '').trim().toUpperCase();
        if (key !== TEST_LICENCE_KEY) {
          return sendJson(res, 200, { valid: false, message: 'Invalid test licence' });
        }
        return sendJson(res, 200, {
          valid: true,
          email: 'sync-test@example.com',
          status: 'active',
          entitlements: { cloudBackup: true },
        });
      }

      if (url.pathname === '/api/recovery') {
        const key = String(body.key || '').trim().toUpperCase();
        const store = storeForKey(key);
        if (body.blob) {
          store.escrow = body.blob;
          return sendJson(res, 200, { ok: true });
        }
        if (!store.escrow) {
          return sendJson(res, 200, { ok: false, error: 'No recovery data found for this licence key' });
        }
        return sendJson(res, 200, { ok: true, blob: store.escrow });
      }

      if (url.pathname === '/api/sync/push') {
        const key = String(body.key || '').trim().toUpperCase();
        if (key !== TEST_LICENCE_KEY) {
          return sendJson(res, 401, { ok: false, error: 'Invalid licence key' });
        }
        const store = storeForKey(key);
        const records = Array.isArray(body.records) ? body.records : [];
        let written = 0;
        const now = Date.now();
        for (const record of records) {
          if (!record || !record.syncId) continue;
          store.records.set(record.syncId, {
            syncId: record.syncId,
            envelope: record.envelope,
            encrypted: true,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            version: record.version || 1,
            lastPushedBy: body.machineId || 'unknown',
            serverUpdatedAt: new Date(now).toISOString(),
          });
          store.timeline.set(now + written, record.syncId);
          written++;
        }
        return sendJson(res, 200, { ok: true, written });
      }

      if (url.pathname === '/api/sync/pull') {
        const key = String(body.key || '').trim().toUpperCase();
        if (key !== TEST_LICENCE_KEY) {
          return sendJson(res, 401, { ok: false, error: 'Invalid licence key' });
        }
        const store = storeForKey(key);
        const sinceMs = body.since ? new Date(body.since).getTime() : 0;
        const ids = [...store.timeline.entries()]
          .filter(([score]) => score > sinceMs)
          .sort((a, b) => a[0] - b[0])
          .map(([, id]) => id);
        const MAX = 200;
        const pageIds = ids.slice(0, MAX);
        const records = pageIds
          .map((id) => store.records.get(id))
          .filter(Boolean)
          .map((stored) => ({
            syncId: stored.syncId,
            envelope: stored.envelope,
            encrypted: stored.encrypted ?? true,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            version: stored.version,
          }));
        return sendJson(res, 200, {
          ok: true,
          records,
          serverTime: new Date().toISOString(),
          hasMore: ids.length > MAX,
        });
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e && e.message ? e.message : 'Server error' });
    }
  });

  return {
    server,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      return `http://127.0.0.1:${port}`;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
    seedEscrow(licenceKey, masterKeyHex) {
      const blob = encryptMasterKeyForEscrow(masterKeyHex, licenceKey);
      storeForKey(licenceKey).escrow = blob;
    },
    getRecordCount(licenceKey) {
      return storeForKey(licenceKey).records.size;
    },
  };
}
