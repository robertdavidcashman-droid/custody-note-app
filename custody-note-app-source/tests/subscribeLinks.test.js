'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'app.js', 'main.js'];

describe('subscribe links', () => {
  it('does not reference the removed custodynote.com/buy path', () => {
    for (const file of FILES) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.doesNotMatch(
        text,
        /custodynote\.com\/buy\b/i,
        `${file} must link to custodynote.com/pricing, not /buy`,
      );
    }
  });

  it('reports new local trials to the licence server when packaged', () => {
    const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.match(mainJs, /reportTrialStartedToServer/);
    assert.match(mainJs, /\/api\/stats\/trial-started/);
  });

  it('cloud-backup-subscribe opens pricing on the licence server', () => {
    const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.match(mainJs, /`\$\{apiUrl\}\/pricing/);
    assert.doesNotMatch(mainJs, /\/buy\?plan=cloud/);
  });
});
