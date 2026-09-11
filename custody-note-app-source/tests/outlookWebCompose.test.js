'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  buildOutlookWebComposeUrl,
  buildFullComposePlainTextForClipboard,
  buildBodyPlainTextForClipboard,
  prepareOutlookComposeForOpen,
  truncateOutlookComposeForShellOpen,
  OUTLOOK_WEB_COMPOSE_BASE,
} = require('../lib/outlookWebCompose');
const {
  buildOutlookComposeEmlContent,
  extractEmlPlainBody,
} = require('../lib/outlookComposeEml');

const SPECIAL_BODY = [
  'Dear Officer,',
  '',
  'Re: Smith & Jones — CR/12345/26',
  '',
  "The client's position is that he didn't attend the address.",
  '',
  'Please confirm whether CCTV, BWV and/or telephone evidence has been obtained.',
  '',
  'Kind regards,',
  'Robert Cashman',
].join('\n');

describe('outlookWebCompose.buildOutlookWebComposeUrl', () => {
  it('omits body by default (opt-in includeBody)', () => {
    const u = buildOutlookWebComposeUrl({
      to: 'o@police.uk',
      subject: 'Subj',
      body: 'Body',
    });
    assert.ok(u.startsWith(`${OUTLOOK_WEB_COMPOSE_BASE}?`), u);
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('to'), 'o@police.uk');
    assert.strictEqual(parsed.searchParams.get('subject'), 'Subj');
    assert.strictEqual(parsed.searchParams.get('body'), null, 'body must not appear unless includeBody');
  });

  it('includes body when includeBody opt-in is set', () => {
    const u = buildOutlookWebComposeUrl(
      { to: 'o@police.uk', subject: 'Subj', body: 'Body' },
      { includeBody: true }
    );
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('body'), 'Body');
  });

  it('preserves multiline body with blank lines when includeBody', () => {
    const u = buildOutlookWebComposeUrl(
      { to: 'a@b.c', subject: 'S', body: 'Line1\n\nLine3' },
      { includeBody: true }
    );
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('body'), 'Line1\r\n\r\nLine3');
  });

  it('encodes apostrophes ampersands quotes question marks percent once', () => {
    const body = "It's 100% urgent? See Smith & Jones.";
    const u = buildOutlookWebComposeUrl(
      { to: 'a@b.c', subject: "Re: O'Brien & \"Partner\"?", body },
      { includeBody: true }
    );
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('subject'), "Re: O'Brien & \"Partner\"?");
    assert.strictEqual(parsed.searchParams.get('body'), body);
    assert.ok(!u.includes('%%'), 'must not double-encode percent');
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
  });
});

describe('outlookWebCompose.prepareOutlookComposeForOpen — body in Outlook', () => {
  it('places ordinary short body in OWA URL (not clipboard-only)', () => {
    const body = 'Dear Officer,\n\nPlease send initial disclosure.\n\nKind regards,\nRobert';
    const r = prepareOutlookComposeForOpen(
      { to: 'a@b.c', subject: 'Disclosure', body },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(r.method, 'outlook-web');
    assert.strictEqual(r.bodyPlacedInCompose, true);
    assert.strictEqual(r.truncated, false);
    const parsed = new URL(r.url);
    assert.strictEqual(parsed.searchParams.get('to'), 'a@b.c');
    assert.strictEqual(parsed.searchParams.get('subject'), 'Disclosure');
    assert.strictEqual(parsed.searchParams.get('body'), body.replace(/\n/g, '\r\n'));
    assert.ok(r.bodyUsedInUrl.includes('Please send initial disclosure'));
  });

  it('preserves multiline + blank lines in OWA body param', () => {
    const body = 'Para one.\n\nPara two.\n\nPara three.';
    const r = prepareOutlookComposeForOpen(
      { to: 'o@police.uk', subject: 'S', body },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(r.method, 'outlook-web');
    assert.strictEqual(new URL(r.url).searchParams.get('body'), body.replace(/\n/g, '\r\n'));
  });

  it('uses edited live body, not a stale generated string', () => {
    const generated = 'ORIGINAL GENERATED TEXT';
    const edited = 'AMENDED BY USER — please send CCTV.';
    const r = prepareOutlookComposeForOpen(
      { to: 'o@police.uk', subject: 'S', body: edited },
      { maxUrlLength: 50_000 }
    );
    const urlBody = new URL(r.url).searchParams.get('body');
    assert.strictEqual(urlBody, edited);
    assert.ok(!urlBody.includes(generated));
    assert.ok(!r.body.includes(generated));
  });

  it('special-character officer email sample survives encoding into OWA body', () => {
    const r = prepareOutlookComposeForOpen(
      { to: 'o@police.uk', subject: 'Re: Smith & Jones', body: SPECIAL_BODY },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(r.method, 'outlook-web');
    const decoded = new URL(r.url).searchParams.get('body');
    assert.strictEqual(decoded, SPECIAL_BODY.replace(/\n/g, '\r\n'));
    assert.ok(decoded.includes("didn't"));
    assert.ok(decoded.includes('Smith & Jones'));
    assert.ok(decoded.includes('CR/12345/26'));
  });

  it('empty subject still places body in compose when body present', () => {
    const r = prepareOutlookComposeForOpen(
      { to: 'a@b.c', subject: '', body: 'Hello body' },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(new URL(r.url).searchParams.get('body'), 'Hello body');
    assert.strictEqual(new URL(r.url).searchParams.get('subject'), null);
  });

  it('populated subject is preserved alongside body', () => {
    const r = prepareOutlookComposeForOpen(
      { to: 'a@b.c', subject: 'Custody — disclosure', body: 'Please confirm.' },
      { maxUrlLength: 50_000 }
    );
    const parsed = new URL(r.url);
    assert.strictEqual(parsed.searchParams.get('subject'), 'Custody — disclosure');
    assert.strictEqual(parsed.searchParams.get('body'), 'Please confirm.');
  });

  it('long body uses .eml path with full body (never silent empty body)', () => {
    const body = 'MARK_START\n' + 'X'.repeat(5000) + '\nMARK_END';
    const r = prepareOutlookComposeForOpen(
      { to: 'officer@met.police.uk', subject: 'Custody note', body },
      { maxUrlLength: 1800 }
    );
    assert.strictEqual(r.method, 'outlook-desktop-eml');
    assert.strictEqual(r.bodyPlacedInCompose, true);
    assert.ok(r.emlContent.includes('X-Unsent: 1'));
    assert.ok(r.emlContent.includes('Content-Type: text/html; charset=utf-8'));
    assert.ok(r.emlContent.includes('Content-Transfer-Encoding: quoted-printable'));
    assert.ok(r.emlContent.includes('X-Uniform-Type-Identifier: com.apple.mail-draft'));
    assert.strictEqual(extractEmlPlainBody(r.emlContent), body);
    assert.ok(!r.url.includes('body='), 'long body stays off URL');
  });

  it('second prepare with newer text uses the newest body', () => {
    const first = prepareOutlookComposeForOpen(
      { to: 'a@b.c', subject: 'S', body: 'first version' },
      { maxUrlLength: 50_000 }
    );
    const second = prepareOutlookComposeForOpen(
      { to: 'a@b.c', subject: 'S', body: 'second version — newest' },
      { maxUrlLength: 50_000 }
    );
    assert.strictEqual(new URL(first.url).searchParams.get('body'), 'first version');
    assert.strictEqual(new URL(second.url).searchParams.get('body'), 'second version — newest');
  });

  it('truncateOutlookComposeForShellOpen alias matches prepareOutlookComposeForOpen', () => {
    const fields = { to: 'a@b.c', subject: 'S', body: 'Hello' };
    const a = prepareOutlookComposeForOpen(fields, { maxUrlLength: 50_000 });
    const b = truncateOutlookComposeForShellOpen(fields, { maxUrlLength: 50_000 });
    assert.strictEqual(a.method, b.method);
    assert.strictEqual(a.url, b.url);
    assert.strictEqual(a.body, b.body);
  });
});

describe('outlookComposeEml — body round-trip', () => {
  it('preserves special characters and blank lines in .eml body', () => {
    const eml = buildOutlookComposeEmlContent({
      to: 'o@police.uk',
      subject: 'Re: Smith & Jones',
      body: SPECIAL_BODY,
    });
    assert.ok(eml.includes('X-Unsent: 1'));
    assert.ok(eml.includes('Content-Type: text/html; charset=utf-8'));
    assert.ok(eml.includes('Content-Transfer-Encoding: quoted-printable'));
    assert.ok(eml.includes('X-Uniform-Type-Identifier: com.apple.mail-draft'));
    assert.ok(eml.includes('Smith &amp; Jones'), 'HTML-escapes ampersands in body');
    assert.strictEqual(extractEmlPlainBody(eml), SPECIAL_BODY);
  });

  it('quoted-printable payload is 7-bit (no raw UTF-8 high bytes in file)', () => {
    const eml = buildOutlookComposeEmlContent({
      to: 'o@police.uk',
      subject: 'Unicode',
      body: 'Pound £ and dash — and café',
    });
    const payloadStart = eml.indexOf('\r\n\r\n') + 4;
    const payload = eml.slice(payloadStart);
    for (let i = 0; i < payload.length; i++) {
      assert.ok(payload.charCodeAt(i) <= 0x7f, 'EML payload must be 7-bit for New Outlook file encoding');
    }
    assert.strictEqual(extractEmlPlainBody(eml), 'Pound £ and dash — and café');
  });

  it('strips CR/LF injection from To/Subject headers', () => {
    const eml = buildOutlookComposeEmlContent({
      to: 'a@b.com\r\nBcc: evil@x.com',
      subject: 'Safe\nInject',
      body: 'Body text',
    });
    assert.doesNotMatch(eml, /\r\nBcc:/i);
    assert.ok(eml.includes('Body text'));
  });
});
