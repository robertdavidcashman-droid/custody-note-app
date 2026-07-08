/**
 * Email compose draft — mailto, OWA deeplink, pending storage, template placeholders.
 * Uses lib/emailComposeDraft.js (same logic as preload → CustodyEmailCompose).
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  PENDING_EMAIL_DRAFT_KEY,
  normalizeDraft,
  buildMailtoLink,
  buildOutlookWebComposeLink,
  savePendingEmailDraft,
  getPendingEmailDraft,
  clearPendingEmailDraft,
  mergeTemplatePlaceholders,
  normalizeMergedEmailText,
  buildFullEmailClipboardText,
  openEmailDraft,
  resumePendingEmailDraft,
  createMemoryStorage,
} = require('../lib/emailComposeDraft');
const { copyText } = require('../lib/emailCopy');

describe('Template merge ({{placeholders}})', () => {
  const map = {
    clientName: 'Jane Doe',
    officerRank: 'DC',
    officerSurname: 'Smith',
    policeStation: 'Norwich',
    custodyNumber: 'CN-99',
    dsccReference: 'DSCC/1',
  };

  it('replaces {{clientName}}', () => {
    assert.strictEqual(mergeTemplatePlaceholders('Hello {{clientName}}', map), 'Hello Jane Doe');
  });

  it('replaces {{officerRank}}', () => {
    assert.strictEqual(mergeTemplatePlaceholders('Rank {{officerRank}}', map), 'Rank DC');
  });

  it('replaces {{officerSurname}}', () => {
    assert.strictEqual(mergeTemplatePlaceholders('{{officerSurname}}', map), 'Smith');
  });

  it('replaces {{policeStation}}', () => {
    assert.strictEqual(mergeTemplatePlaceholders('at {{policeStation}}', map), 'at Norwich');
  });

  it('replaces {{custodyNumber}}', () => {
    assert.strictEqual(mergeTemplatePlaceholders('{{custodyNumber}}', map), 'CN-99');
  });

  it('replaces {{dsccReference}}', () => {
    assert.strictEqual(mergeTemplatePlaceholders('{{dsccReference}}', map), 'DSCC/1');
  });

  it('leaves missing placeholders blank', () => {
    assert.strictEqual(mergeTemplatePlaceholders('{{unknownKey}}', map), '');
  });

  it('preserves line breaks', () => {
    assert.strictEqual(
      mergeTemplatePlaceholders('Line1\n\nLine2 {{clientName}}', map),
      'Line1\n\nLine2 Jane Doe'
    );
  });
});

describe('normalizeMergedEmailText', () => {
  it('trims trailing spaces per line and end of string', () => {
    assert.strictEqual(normalizeMergedEmailText('x  \n y\t'), 'x\n y');
  });
});

describe('buildFullEmailClipboardText', () => {
  it('uses To / Subject / blank line / body', () => {
    const t = buildFullEmailClipboardText({ to: 'a@b.c', subject: 'S', body: 'Hi\nThere' });
    assert.strictEqual(t, 'To: a@b.c\nSubject: S\n\nHi\nThere');
  });
});

describe('Mailto link', () => {
  it('builds valid mailto link', () => {
    const u = buildMailtoLink({ to: 'a@b.co', subject: 's', body: 'b' });
    assert.ok(u.startsWith('mailto:'));
    assert.ok(u.includes('subject='));
    assert.ok(u.includes('body='));
  });

  it('encodes subject', () => {
    const u = buildMailtoLink({ to: 'x@y.z', subject: 'a & b', body: '' });
    assert.ok(u.includes(encodeURIComponent('a & b')));
    assert.ok(!u.includes('a & b?'));
  });

  it('encodes body', () => {
    const u = buildMailtoLink({ to: 'x@y.z', subject: '', body: 'hello' });
    assert.ok(u.includes('body=' + encodeURIComponent('hello')));
  });

  it('encodes line breaks as CRLF in query', () => {
    const u = buildMailtoLink({ to: 'x@y.z', subject: '', body: 'a\nb' });
    const idx = u.indexOf('body=');
    const raw = u.slice(idx + 'body='.length);
    const decoded = decodeURIComponent(raw.split('&')[0]);
    assert.ok(decoded.includes('\r\n'), decoded);
  });

  it('includes cc only when provided', () => {
    const noCc = buildMailtoLink({ to: 'x@y.z', cc: '', subject: 's', body: 'b' });
    assert.ok(!noCc.includes('cc='));
    const withCc = buildMailtoLink({ to: 'x@y.z', cc: 'c@d.e', subject: '', body: '' });
    assert.ok(withCc.includes('cc=' + encodeURIComponent('c@d.e')));
  });

  it('does not produce raw spaces in query (encoded)', () => {
    const u = buildMailtoLink({ to: 'x@y.z', subject: 'hello world', body: 'x y' });
    assert.ok(!/\?[^%]*[ ]/.test(u.split('mailto:')[1] || u), 'space should be encoded');
  });

  it('does not put unencoded line breaks in mailto query values', () => {
    const u = buildMailtoLink({ to: 'x@y.z', subject: 's', body: 'a\nb' });
    const q = u.split('?')[1] || '';
    assert.ok(!q.includes('\n'), 'query string should not contain raw newline');
  });
});

describe('Outlook Web compose link', () => {
  it('builds outlook.office.com deeplink compose URL', () => {
    const u = buildOutlookWebComposeLink({
      to: 'o@police.uk',
      cc: '',
      subject: 'Subj',
      body: 'Body',
    });
    assert.ok(u.startsWith('https://outlook.office.com/mail/0/deeplink/compose?'));
  });

  it('includes to, cc, subject and body in query (decoded via URL)', () => {
    const u = buildOutlookWebComposeLink({
      to: 'a@b.c',
      cc: 'c@d.e',
      subject: 'S',
      body: 'B',
    });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('to'), 'a@b.c');
    assert.strictEqual(parsed.searchParams.get('cc'), 'c@d.e');
    assert.strictEqual(parsed.searchParams.get('subject'), 'S');
    assert.strictEqual(parsed.searchParams.get('body'), 'B');
  });

  it('preserves line breaks in body (CRLF)', () => {
    const u = buildOutlookWebComposeLink({ to: 'a@b.c', subject: '', body: 'one\ntwo' });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('body'), 'one\r\ntwo');
  });

  it('does not lose apostrophes, ampersands or commas', () => {
    const sub = "Re: O'Brien, Smith & Co — urgent";
    const body = "Dear Sir,\nIt's urgent & required.";
    const u = buildOutlookWebComposeLink({ to: 'a@b.c', cc: '', subject: sub, body: body });
    const parsed = new URL(u);
    assert.strictEqual(parsed.searchParams.get('subject'), sub);
    assert.strictEqual(parsed.searchParams.get('body'), body.replace(/\n/g, '\r\n'));
  });
});

describe('Pending draft storage', () => {
  let mem;

  beforeEach(() => {
    mem = createMemoryStorage();
  });

  it('saves draft before opening (simulated)', () => {
    var d = { to: 'x@y.z', cc: '', subject: 'S', body: 'B', templateId: 't1', createdAt: '2026-01-01T00:00:00.000Z', mode: 'outlook-web' };
    savePendingEmailDraft(d, mem);
    assert.strictEqual(mem.getItem(PENDING_EMAIL_DRAFT_KEY).includes('x@y.z'), true);
  });

  it('retrieves saved draft after simulated interruption', () => {
    savePendingEmailDraft({ to: 'a@b.c', subject: 's', body: 'b', templateId: 'x' }, mem);
    var g = getPendingEmailDraft(mem);
    assert.strictEqual(g.to, 'a@b.c');
    assert.strictEqual(g.subject, 's');
  });

  it('resume opens saved draft (mock window)', () => {
    var opens = [];
    var loc = null;
    var win = {
      open: function (url) {
        opens.push(url);
        return {};
      },
      location: { set href(v) { loc = v; }, get href() { return loc || ''; } },
    };
    savePendingEmailDraft({
      to: 'o@p.q',
      cc: '',
      subject: 'Sub',
      body: 'Hi',
      templateId: 'bail_details',
      mode: 'outlook-web',
    }, mem);
    var ok = resumePendingEmailDraft('outlook-web', mem, { window: win });
    assert.strictEqual(ok, true);
    assert.strictEqual(opens.length, 1);
    assert.ok(opens[0].includes('outlook.office.com/mail/0/deeplink/compose'));
  });

  it('pending draft remains after first open attempt (storage untouched)', () => {
    savePendingEmailDraft({ to: 'a@b.c', subject: '', body: '', templateId: '' }, mem);
    openEmailDraft({ to: 'a@b.c', subject: '', body: '' }, 'outlook-web', {
      window: { open: function () { return {}; }, location: { href: '' } },
    });
    assert.ok(getPendingEmailDraft(mem));
  });

  it('pending draft can be cleared manually', () => {
    savePendingEmailDraft({ to: 'a@b.c', subject: 's', body: 'b', templateId: '' }, mem);
    clearPendingEmailDraft(mem);
    assert.strictEqual(getPendingEmailDraft(mem), null);
  });
});

describe('openEmailDraft (mock env)', () => {
  it('returns false for invalid officer email', () => {
    var ok = openEmailDraft({ to: 'bad', subject: '', body: '' }, 'mailto', {
      window: { open: function () {}, location: { href: '' } },
    });
    assert.strictEqual(ok, false);
  });

  it('mailto assigns location.href', () => {
    var href = '';
    var win = {
      open: function () {},
      location: {
        set href(v) { href = v; },
        get href() { return href; },
      },
    };
    var ok = openEmailDraft({ to: 'a@b.c', subject: 's', body: 'b' }, 'mailto', { window: win });
    assert.strictEqual(ok, true);
    assert.ok(href.startsWith('mailto:'));
  });

  it('outlook-web calls window.open', () => {
    var opened = [];
    var win = {
      open: function (u) {
        opened.push(u);
        return {};
      },
      location: {},
    };
    var ok = openEmailDraft({ to: 'a@b.c', subject: 's', body: 'b' }, 'outlook-web', { window: win });
    assert.strictEqual(ok, true);
    assert.strictEqual(opened.length, 1);
  });

  it('outlook-web returns false when window.open returns null (popup blocked)', () => {
    var logged = [];
    var origErr = console.error;
    console.error = function (msg) {
      logged.push(msg);
    };
    try {
      var win = {
        open: function () {
          return null;
        },
        location: {},
      };
      var ok = openEmailDraft({ to: 'a@b.c', subject: 's', body: 'b' }, 'outlook-web', { window: win });
      assert.strictEqual(ok, false);
      assert.ok(logged.length >= 1, 'expected console.error');
    } finally {
      console.error = origErr;
    }
  });
});

describe('normalizeDraft', () => {
  it('fills defaults', () => {
    var n = normalizeDraft({ to: '  a@b.c  ', subject: 'x' });
    assert.strictEqual(n.to, 'a@b.c');
  });
});

describe('copyText helper (lib/emailCopy)', () => {
  it('returns false for empty text', async () => {
    assert.strictEqual(await copyText('', {}), false);
  });

  it('uses clipboard API when available and secure context', async () => {
    let written = '';
    const env = {
      isSecureContext: true,
      navigator: {
        clipboard: {
          writeText: async (s) => {
            written = s;
          },
        },
      },
    };
    const ok = await copyText('hello', env);
    assert.strictEqual(ok, true);
    assert.strictEqual(written, 'hello');
  });

  it('uses textarea fallback when clipboard unavailable', async () => {
    let created;
    const env = {
      isSecureContext: false,
      navigator: {},
      document: {
        body: {
          appendChild() {},
          removeChild() {},
        },
        createElement: function () {
          created = {
            value: '',
            style: {},
            setAttribute() {},
            focus() {},
            select() {},
          };
          return created;
        },
        execCommand: function () {
          return true;
        },
      },
    };
    const ok = await copyText('multi\nline', env);
    assert.strictEqual(ok, true);
    assert.strictEqual(created.value, 'multi\nline');
  });
});
