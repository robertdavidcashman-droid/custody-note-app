'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { encryptSyncEnvelope, decryptSyncEnvelope } = require('../lib/syncRecordCrypto');

test('encryptSyncEnvelope round-trips attendance payload', () => {
  const masterKeyHex = crypto.randomBytes(32).toString('hex');
  const payload = {
    data: '{"client":"Test Client"}',
    status: 'draft',
    clientName: 'Test Client',
    stationName: 'Medway',
    dsccRef: 'DSCC123',
  };
  const envelope = encryptSyncEnvelope(masterKeyHex, payload);
  const decoded = decryptSyncEnvelope(masterKeyHex, envelope);
  assert.deepEqual(decoded, payload);
});

test('decryptSyncEnvelope supports legacy plaintext JSON', () => {
  const masterKeyHex = crypto.randomBytes(32).toString('hex');
  const legacy = JSON.stringify({ data: 'x', status: 'draft' });
  const decoded = decryptSyncEnvelope(masterKeyHex, legacy);
  assert.equal(decoded.data, 'x');
});

test('decryptSyncEnvelope returns null for wrong key', () => {
  const key1 = crypto.randomBytes(32).toString('hex');
  const key2 = crypto.randomBytes(32).toString('hex');
  const envelope = encryptSyncEnvelope(key1, { data: 'secret' });
  assert.equal(decryptSyncEnvelope(key2, envelope), null);
});
