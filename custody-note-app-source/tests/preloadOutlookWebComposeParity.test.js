'use strict';

/**
 * Preload cannot require lib files — run the inlined custodyEmailComposeDraft IIFE
 * in a vm sandbox and compare buildOutlookWebComposeLink to lib/emailComposeDraft.js
 * (which delegates to lib/outlookWebCompose.js).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const lib = require('../lib/emailComposeDraft');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');

function loadPreloadComposeApi() {
  const preloadSrc = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const start = preloadSrc.indexOf('(function buildEmailComposeDraft()');
  assert.ok(start >= 0, 'preload IIFE start not found');
  const end = preloadSrc.indexOf('})();\n\ncontextBridge.exposeInMainWorld', start);
  assert.ok(end > start, 'preload IIFE end delimiter not found');
  const expr = preloadSrc.slice(start, end + '})();'.length);
  return vm.runInNewContext(expr, {
    encodeURIComponent,
    String,
    Object,
    Date,
    JSON,
  });
}

describe('preload vs lib — Outlook Web compose URL', () => {
  const fixtures = [
    { to: 'o@police.uk', cc: '', subject: 'Subj', body: 'Body' },
    { to: 'a@b.c', cc: 'c@d.e', subject: 'S', body: 'B\nC' },
    { to: 'x@y.z', cc: '  ', subject: "a & b", body: "line1\nIt's ok" },
    { to: '  u@v.w  ', cc: '', subject: '', body: '' },
  ];

  it('buildOutlookWebComposeLink matches lib/emailComposeDraft for fixtures', () => {
    const preloadApi = loadPreloadComposeApi();
    for (const d of fixtures) {
      const a = lib.buildOutlookWebComposeLink(d);
      const b = preloadApi.buildOutlookWebComposeLink(d);
      assert.strictEqual(b, a, 'mismatch for ' + JSON.stringify(d));
    }
  });
});
