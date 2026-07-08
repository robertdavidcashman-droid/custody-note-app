const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stableStringify, sortKeysDeep } = require('../lib/stableStringify');
const fs = require('fs');
const path = require('path');

describe('stableStringify', () => {
  it('produces the same string when object key order differs', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    assert.strictEqual(stableStringify(a), stableStringify(b));
  });

  it('handles nested arrays and null', () => {
    const x = { items: [{ c: 1 }, null, { a: 0 }], n: null };
    const y = { n: null, items: [{ c: 1 }, null, { a: 0 }] };
    assert.strictEqual(stableStringify(x), stableStringify(y));
  });

  it('distinguishes different values', () => {
    assert.notStrictEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
  });
});

describe('sortKeysDeep', () => {
  it('returns a new object with sorted keys at all levels', () => {
    const o = { m: { z: 1, a: 2 } };
    const s = sortKeysDeep(o);
    assert.deepStrictEqual(s, { m: { a: 2, z: 1 } });
    assert.strictEqual(Object.keys(s.m).join(','), 'a,z');
  });
});

describe('main.js burst duplicate guard', () => {
  it('uses stableStringify and scans recent draft rows (not raw data=?)', () => {
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const idx = mainSrc.indexOf('Guard against burst duplicate inserts');
    assert.ok(idx !== -1, 'comment block must exist');
    const block = mainSrc.substring(idx, idx + 1200);
    assert.ok(block.includes('stableStringify(parsed)'), 'must compare canonical payload');
    assert.ok(block.includes('recentRows'), 'must query recent draft rows');
    assert.ok(
      !block.includes("AND data=? AND created_at"),
      'must not match duplicate rows by raw JSON text (key order); use canonical compare instead'
    );
  });
});
