const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  encryptMasterKeyForEscrow,
  decryptMasterKeyFromEscrow,
} = require('../lib/keyEscrow');

describe('keyEscrow', () => {
  const masterKey = 'f'.repeat(64);
  const licenceKey = 'ABCD-1234-EFGH-5678';

  it('round-trips master key with licence-derived encryption', () => {
    const blob = encryptMasterKeyForEscrow(masterKey, licenceKey);
    const recovered = decryptMasterKeyFromEscrow(blob, licenceKey);
    assert.strictEqual(recovered, masterKey);
  });

  it('fails decrypt with wrong licence key', () => {
    const blob = encryptMasterKeyForEscrow(masterKey, licenceKey);
    const recovered = decryptMasterKeyFromEscrow(blob, 'WRONG-KEY-0000-0000');
    assert.strictEqual(recovered, null);
  });

  it('different licences produce different escrow blobs', () => {
    const b1 = encryptMasterKeyForEscrow(masterKey, 'KEY1-1111-1111-1111');
    const b2 = encryptMasterKeyForEscrow(masterKey, 'KEY2-2222-2222-2222');
    assert.notStrictEqual(b1, b2);
  });
});
