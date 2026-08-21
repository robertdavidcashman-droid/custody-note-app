const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'website-product-shots', 'screenshots');

describe('website product demo screenshots', () => {
  it('includes a filled records-list webp larger than the empty-state shot', () => {
    const webp = path.join(root, 'records-list.webp');
    assert.ok(fs.existsSync(webp), 'records-list.webp must exist');
    const size = fs.statSync(webp).size;
    assert.ok(size > 40000, 'filled records-list.webp should be >40KB (got ' + size + ')');
  });

  it('mirrors records-list under screenshots/app for InlineScreenshot paths', () => {
    const webp = path.join(root, 'app', 'records-list.webp');
    assert.ok(fs.existsSync(webp), 'app/records-list.webp must exist');
  });
});
