const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('product tips', () => {
  it('ships bundled JSON with Free/Pro tip', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'product-tips.json'), 'utf8');
    const tips = JSON.parse(raw);
    assert.ok(Array.isArray(tips) && tips.length >= 3);
    assert.ok(tips.some((t) => /free during beta|beta/i.test(t.body || '')));
  });

  it('ProductTips.pickTip returns a tip object', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'product-tips.js'), 'utf8');
    const store = {};
    const sandbox = {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInNewContext(src, sandbox);
    assert.ok(sandbox.ProductTips);
    const tip = sandbox.ProductTips.pickTip(sandbox.ProductTips.FALLBACK_TIPS);
    assert.ok(tip && tip.id && tip.body);
  });
});
