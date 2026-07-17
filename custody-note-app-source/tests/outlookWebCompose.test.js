'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  buildOutlookWebComposeUrl,
  buildFullComposePlainTextForClipboard,
  truncateOutlookComposeForShellOpen,
  OUTLOOK_WEB_COMPOSE_BASE,
} = require('../lib/outlookWebCompose');

describe('outlookWebCompose.buildOutlookWebComposeUrl', () => {
  it('builds outlook.office.com deeplink with encoded query', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'o@police.uk',
      subject: 'Subj',
      body: 'Body',
    });
    assert.ok(u.startsWith(`${OUTLOOK_WEB_COMPOSE_BASE}?`), u);
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('to'), 'o@police.uk');
    assert.strictEqual(parsed.searchParams.get('subject'), 'Subj');
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

  it('normalizes body newlines to CRLF in encoded output', () => {
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', subject: '', body: 'one\ntwo' });
    assert.ok(u.includes('one%0D%0Atwo') || u.includes('one%0d%0atwo'), u);
  });

  it('encodes ampersands apostrophes quotes and DSCC-style text', () => {
    const sub = "Re: O'Brien & \"Partner\" / DSCC/2026-001";
    const body = "Line with & <tags> and 50% discount\nSecond line.";
    const u = buildOutlookWebComposeUrl({ to: 'a@b.c', subject: sub, body });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('subject'), sub);
    assert.strictEqual(parsed.searchParams.get('body'), body.replace(/\n/g, '\r\n'));
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

describe('outlookWebCompose.truncateOutlookComposeForShellOpen', () => {
  it('does not truncate when under max length', () => {
    const r = truncateOutlookComposeForShellOpen(
      { to: 'a@b.c', subject: 'S', body: 'short' },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(r.truncated, false);
    assert.ok(r.url.includes('body='));
    assert.strictEqual(r.urlLength, r.url.length);
  });

  it('truncates long body and preserves fullPlainTextForClipboard', () => {
    const body = 'X'.repeat(25_000);
    const r = truncateOutlookComposeForShellOpen(
      { to: 'officer@met.police.uk', subject: 'Custody note', body },
      { maxUrlLength: 4000 }
    );
    assert.strictEqual(r.truncated, true);
    assert.ok(r.url.length <= 4000, `url length ${r.url.length}`);
    assert.ok(r.fullPlainTextForClipboard.includes(body), 'clipboard text must include full body');
    const parsed = new URL(r.url);
    const bodyInUrl = parsed.searchParams.get('body');
    assert.ok(bodyInUrl.length < body.length, 'URL body should be shorter than original');
  });

  it('expands with many ampersands still truncates safely', () => {
    const body = 'MARK\n' + '&'.repeat(8000);
    const r = truncateOutlookComposeForShellOpen(
      { to: 'o@police.uk', subject: 'S', body },
      { maxUrlLength: 3500 }
    );
    assert.strictEqual(r.truncated, true);
    assert.ok(r.url.length <= 3500);
    assert.ok(r.fullPlainTextForClipboard.includes('MARK'));
  });
});
