/**
 * Tests for renderer/lib/websiteLinks.js — UTM-tagged website URLs from the app.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadWebsiteLinks() {
  const sandbox = { window: {}, globalThis: {}, URL };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const code = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'renderer', 'lib', 'websiteLinks.js'),
    'utf8',
  );
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

describe('websiteLinks', () => {
  it('appendWebsiteUtm adds standard params', () => {
    const { appendWebsiteUtm } = loadWebsiteLinks();
    const url = appendWebsiteUtm('https://custodynote.com/download', {
      campaign: 'share',
      content: 'copy-link',
    });
    assert.ok(url.includes('utm_source=app'));
    assert.ok(url.includes('utm_medium=referral'));
    assert.ok(url.includes('utm_campaign=share'));
    assert.ok(url.includes('utm_content=copy-link'));
  });

  it('WEBSITE_LINKS.download returns tracked download URL', () => {
    const { WEBSITE_LINKS } = loadWebsiteLinks();
    const url = WEBSITE_LINKS.download();
    assert.ok(url.startsWith('https://custodynote.com/download'));
    assert.ok(url.includes('utm_campaign=share'));
  });

  it('WEBSITE_LINKS help links use help campaign', () => {
    const { WEBSITE_LINKS } = loadWebsiteLinks();
    assert.ok(WEBSITE_LINKS.faq().includes('utm_campaign=help'));
    assert.ok(WEBSITE_LINKS.attendanceNotesGuide().includes('how-to-write-attendance-notes'));
  });
});
