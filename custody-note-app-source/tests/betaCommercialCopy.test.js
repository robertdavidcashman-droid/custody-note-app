'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'index.html',
  'app.js',
  'renderer/licence.js',
  'renderer/product-tips.js',
  'main/computeLicenceStatus.js',
];

const FORBIDDEN = [
  /Get a free trial or buy/i,
  /Subscribe to Pro at custodynote\.com\/pricing/i,
  /Subscribe at custodynote\.com/i,
  /Core features stay free forever/i,
  /Share Free forever Custody Note/i,
  /Renew Pro at custodynote\.com\/pricing for cloud backup/i,
  /Cloud backup is included with paid subscriptions/i,
  /Cloud backup requires a paid subscription\. Subscribe/i,
  /Your free trial has ended\. Subscribe to continue/i,
  /customer portal link from Lemon Squeezy/i,
];

const REQUIRED_ANY = [
  /Free during beta\. No credit card\. Paid Pro planned after beta/i,
];

describe('beta commercial copy honesty', () => {
  for (const file of FILES) {
    it(`${file} has no contradictory live-checkout / free-forever CTAs`, () => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const re of FORBIDDEN) {
        assert.doesNotMatch(text, re, `${file} must not match ${re}`);
      }
    });
  }

  it('core UI surfaces include the beta commercial line', () => {
    const blob = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    assert.ok(REQUIRED_ANY.some((re) => re.test(blob)));
  });
});
