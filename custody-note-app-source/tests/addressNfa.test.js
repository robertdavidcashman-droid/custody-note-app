'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const clientAddress = require('../lib/clientAddress');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

describe('clientAddress helper', () => {
  it('returns No Fixed Abode when addressNfa is Yes', () => {
    assert.strictEqual(
      clientAddress.formatClientAddress({ addressNfa: 'Yes' }),
      'No Fixed Abode',
    );
  });

  it('returns No Fixed Abode when address1 is already NFA', () => {
    assert.strictEqual(
      clientAddress.formatClientAddress({ address1: 'No Fixed Abode', city: 'London' }),
      'No Fixed Abode',
    );
  });

  it('joins address parts when NFA is not set', () => {
    assert.strictEqual(
      clientAddress.formatClientAddress({
        address1: '1 High Street',
        city: 'Leeds',
        postCode: 'LS1 1AA',
      }),
      '1 High Street, Leeds, LS1 1AA',
    );
  });

  it('supports custom separator', () => {
    assert.strictEqual(
      clientAddress.formatClientAddress({ address1: '1 High Street', city: 'Leeds' }, '\n'),
      '1 High Street\nLeeds',
    );
  });
});

describe('address NFA app wiring', () => {
  it('loads clientAddress.js before app.js', () => {
    const libIdx = indexHtml.indexOf('src="lib/clientAddress.js"');
    const appIdx = indexHtml.indexOf('src="app.js"');
    assert.ok(libIdx !== -1);
    assert.ok(appIdx !== -1);
    assert.ok(libIdx < appIdx);
  });

  it('defines addressNfa field on custody and voluntary client sections', () => {
    const matches = appJs.match(/key: 'addressNfa', label: 'No Fixed Abode \(NFA\)', type: 'addressNfa'/g) || [];
    assert.strictEqual(matches.length, 2, 'expected NFA checkbox in custody and voluntary section 3');
  });

  it('wires applyAddressNfaState and formatClientAddressForPdf', () => {
    assert.match(appJs, /function applyAddressNfaState\(/);
    assert.match(appJs, /function formatClientAddressForPdf\(/);
    assert.match(appJs, /formatClientAddressForPdf\(d\)/);
  });

  it('includes addressNfa in client lookup/personal keys', () => {
    assert.match(appJs, /'addressNfa','address1','address2'/);
    assert.match(appJs, /'addressNfa','address1','address2','address3','city','county','postCode'/);
  });
});
