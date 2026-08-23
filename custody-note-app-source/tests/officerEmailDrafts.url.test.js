'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildOutlookComposeUrl } = require('../lib/officerEmailDrafts');

describe('officerEmailDrafts — Outlook Web compose URL', () => {
  it('includes body in outlook.office.com deeplink when URL fits', () => {
    const u = buildOutlookComposeUrl({
      toEmail: 'a@b.police.uk',
      subject: 'Hello',
      body: 'Line1\nLine2',
    });
    assert.ok(u.startsWith('https://outlook.office.com/mail/0/deeplink/compose'), u);
    assert.ok(u.includes('to='), u);
    assert.ok(u.includes('subject='), u);
    assert.ok(u.includes('body='), 'body must be in compose URL when it fits');
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('body'), 'Line1\r\nLine2');
  });

  it('encodes body newlines as CRLF in query', () => {
    const u = buildOutlookComposeUrl({ toEmail: 'x@y.gov.uk', subject: 'S', body: 'a\nb' });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('body'), 'a\r\nb');
  });

  it('encodes special characters in subject and body', () => {
    const u = buildOutlookComposeUrl({
      toEmail: 'o@police.uk',
      subject: "Re: O'Brien & Co",
      body: "It's urgent.\nNext line",
    });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('subject'), "Re: O'Brien & Co");
    assert.strictEqual(parsed.searchParams.get('body'), "It's urgent.\r\nNext line");
  });

  it('long body falls back to subject/to URL (Open Outlook uses .eml for body)', () => {
    const longBody = 'X'.repeat(8000);
    const u = buildOutlookComposeUrl({
      toEmail: 'o@police.uk',
      subject: 'Long',
      body: longBody,
    });
    assert.ok(!u.includes('body='), 'oversized body must not be forced into URL');
    assert.ok(u.includes('to='));
    assert.ok(u.includes('subject='));
  });
});
