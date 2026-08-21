'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  buildOutlookWebComposeUrl,
  buildFullComposePlainTextForClipboard,
  buildBodyPlainTextForClipboard,
  truncateOutlookComposeForShellOpen,
  OUTLOOK_WEB_COMPOSE_BASE,
} = require('../lib/outlookWebCompose');

describe('outlookWebCompose.buildOutlookWebComposeUrl', () => {
  it('builds outlook.office.com deeplink with encoded query (subject-only by default)', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'o@police.uk',
      subject: 'Subj',
      body: 'Body',
    });
    assert.ok(u.startsWith(`${OUTLOOK_WEB_COMPOSE_BASE}?`), u);
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('to'), 'o@police.uk');
    assert.strictEqual(parsed.searchParams.get('subject'), 'Subj');
    assert.strictEqual(parsed.searchParams.get('body'), null, 'body must not appear in URL by default');
  });

  it('includes body only when includeBody opt-in is set', () => {
    const u = buildOutlookWebComposeUrl(
      { to: 'o@police.uk', subject: 'Subj', body: 'Body' },
      { includeBody: true }
    );
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('body'), 'Body');
  });

  it('omits cc when empty or whitespace', () => {
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', cc: '   ', subject: 'S', body: 'B' });
    assert.ok(!u.includes('cc='), u);
  });

  it('includes cc when non-empty', () => {
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', cc: 'c@d.e', subject: '', body: '' });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('cc'), 'c@d.e');
  });

  it('does not place body newlines in URL by default', () => {
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', subject: '', body: 'one\ntwo' });
    assert.ok(!u.includes('body='), u);
  });

  it('encodes ampersands apostrophes quotes in subject', () => {
    const sub = "Re: O'Brien & \"Partner\" / DSCC/2026-001";
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', subject: sub, body: 'secret body' });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('subject'), sub);
    assert.strictEqual(parsed.searchParams.get('body'), null);
  });

  it('trims leading and trailing spaces on to', () => {
    const u = buildOutlookWebComposeUrl({ to: '  x@y.z  ', subject: '', body: '' });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('to'), 'x@y.z');
  });
});

describe('outlookWebCompose.buildFullComposePlainTextForClipboard', () => {
  it('matches To / Subject / blank line / body layout', () => {
    const t = buildFullComposePlainTextForClipboard({
      to: 'a@b.c',
      subject: 'S',
      body: 'Hi\nThere',
    });
    assert.strictEqual(t, 'To: a@b.c\nSubject: S\n\nHi\nThere');
  });
});

describe('outlookWebCompose.buildBodyPlainTextForClipboard', () => {
  it('returns body only (no To/Subject headers)', () => {
    const t = buildBodyPlainTextForClipboard({
      to: 'a@b.c',
      subject: 'S',
      body: 'Dear Officer,\nPlease send disclosure.',
    });
    assert.strictEqual(t, 'Dear Officer,\nPlease send disclosure.');
    assert.ok(!t.startsWith('To:'), 'must not include To header');
    assert.ok(!t.includes('Subject:'), 'must not include Subject header');
  });

  it('accepts a raw body string', () => {
    assert.strictEqual(buildBodyPlainTextForClipboard('Line one\nLine two'), 'Line one\nLine two');
  });
});

describe('outlookWebCompose.truncateOutlookComposeForShellOpen', () => {
  it('never places body in URL; bodyPlainTextForClipboard is body-only for paste', () => {
    const body = 'Dear Officer,\n\nPlease send initial disclosure by reply to this email.\n\nMany thanks.\n\nRobert';
    const r = truncateOutlookComposeForShellOpen(
      { to: 'a@b.c', subject: 'S', body },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(r.truncated, true);
    assert.ok(!r.url.includes('body='), r.url);
    assert.strictEqual(r.bodyUsedInUrl, '');
    assert.strictEqual(
      r.bodyPlainTextForClipboard,
      body,
      'Open-Outlook clipboard must be the template body only (paste into Outlook body field)'
    );
    assert.ok(!r.bodyPlainTextForClipboard.startsWith('To:'), 'regression: To:/Subject: header blob breaks Outlook paste');
    assert.ok(r.fullPlainTextForClipboard.includes(body), 'full draft text still available for copy-whole-draft');
    assert.strictEqual(r.urlLength, r.url.length);
  });

  it('truncated=false when no body', () => {
    const r = truncateOutlookComposeForShellOpen(
      { to: 'a@b.c', subject: 'S', body: '' },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(r.truncated, false);
    assert.ok(!r.url.includes('body='));
    assert.strictEqual(r.bodyPlainTextForClipboard, '');
  });

  it('long body stays off URL; body clipboard preserves full text', () => {
    const body = 'X'.repeat(25_000);
    const r = truncateOutlookComposeForShellOpen(
      { to: 'officer@met.police.uk', subject: 'Custody note', body },
      { maxUrlLength: 4000 }
    );
    assert.strictEqual(r.truncated, true);
    assert.ok(r.url.length <= 4000, `url length ${r.url.length}`);
    assert.ok(!r.url.includes('body='));
    assert.strictEqual(r.bodyPlainTextForClipboard, body, 'clipboard text must be the full body only');
  });

  it('expands with many ampersands still keeps body off URL', () => {
    const body = 'MARK\n' + '&'.repeat(8000);
    const r = truncateOutlookComposeForShellOpen(
      { to: 'o@police.uk', subject: 'S', body },
      { maxUrlLength: 3500 }
    );
    assert.strictEqual(r.truncated, true);
    assert.ok(r.url.length <= 3500);
    assert.ok(!r.url.includes('body='));
    assert.strictEqual(r.bodyPlainTextForClipboard, body);
    assert.ok(r.bodyPlainTextForClipboard.includes('MARK'));
  });
});
