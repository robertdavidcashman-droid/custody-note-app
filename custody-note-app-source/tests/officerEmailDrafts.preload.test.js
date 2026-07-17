'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('preload — officerEmails IPC wiring', () => {
  const preloadPath = path.join(__dirname, '..', 'preload.js');
  const src = fs.readFileSync(preloadPath, 'utf8');

  const channels = [
    'officer-email-drafts-list',
    'officer-email-drafts-get',
    'officer-email-drafts-create',
    'officer-email-drafts-update',
    'officer-email-drafts-duplicate',
    'officer-email-drafts-cancel',
    'officer-email-drafts-delete',
    'officer-email-drafts-mark-opened',
    'officer-email-drafts-mark-sent-manually',
    'officer-email-drafts-compose-url',
    'officer-email-drafts-open-outlook',
    'officer-email-drafts-open-one-off-outlook',
    'officer-email-drafts-copy',
    'officer-email-drafts-preview',
  ];

  for (const ch of channels) {
    it('includes invoke for ' + ch, () => {
      assert.ok(src.includes("'" + ch + "'"), 'missing ' + ch);
    });
  }

  it('exposes officerEmails namespace keys', () => {
    assert.ok(/officerEmails:\s*\{/.test(src));
    assert.ok(src.includes('listDrafts:'), 'listDrafts');
    assert.ok(src.includes('openOutlookDraft:'), 'openOutlookDraft');
    assert.ok(src.includes('openOneOffOutlook:'), 'openOneOffOutlook');
    assert.ok(src.includes('getComposeUrl:'), 'getComposeUrl');
  });
});
