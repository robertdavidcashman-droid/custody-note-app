'use strict';

/**
 * Client signature "Not needed" tick + optional reason.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const appJs = read('app.js');
const stylesCss = read('styles.css');
const mainJs = read('main.js');

describe('Client signature not needed UI', () => {
  it('renders Not needed checkbox near clientSig', () => {
    assert.match(appJs, /Client signature not needed/);
    assert.match(appJs, /client-sig-not-needed/);
    assert.match(appJs, /clientSigNotNeeded/);
  });

  it('stores optional reason in declarationUnsignedReason', () => {
    assert.match(appJs, /declarationUnsignedReason/);
    assert.match(appJs, /Reason \(optional\)/);
    assert.match(mainJs, /declarationUnsignedReason/);
  });

  it('styles the not-needed controls', () => {
    assert.match(stylesCss, /\.client-sig-not-needed/);
    assert.match(stylesCss, /\.client-sig-not-needed__reason/);
  });
});

describe('Client signature not needed gates warnings', () => {
  it('record health flags skip client-sig when clientSigNotNeeded', () => {
    assert.match(
      appJs,
      /!d\.clientSig && !d\.clientSigNotNeeded\) flags\.push\(\{ key: 'client-sig'/
    );
  });

  it('attention issues skip missing client signature when not needed', () => {
    assert.match(
      appJs,
      /!d\.clientSig && !d\.clientSigNotNeeded\) issues\.push/
    );
  });

  it('LAA generate queue skips client sig when not needed', () => {
    assert.match(appJs, /needsClientSig = !data\.clientSig && !data\.clientSigNotNeeded/);
  });

  it('PDF preview status shows not needed', () => {
    assert.match(appJs, /Client signature not needed/);
    assert.match(appJs, /data\.clientSigNotNeeded/);
  });

  it('PDF signature block shows Not needed with optional reason', () => {
    assert.match(appJs, /Not needed/);
    assert.match(appJs, /k === 'clientSig' && d\.clientSigNotNeeded/);
  });
});
