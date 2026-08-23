'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildOffencePayload,
  buildPromptMessages,
  requestLawElementsDraft,
  resetInFlightForTests,
} = require('../main/openaiLawElements');
const {
  buildAskMessages,
  requestAskAnswer,
  resetAskInFlightForTests,
  normaliseHistory,
} = require('../main/openaiAsk');
const { extractTextAndCitations } = require('../main/openaiClient');

function mockResponsesOk(text, citations) {
  return {
    ok: true,
    json: async () => ({
      output_text: text,
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: text,
              annotations: (citations || []).map(function (c) {
                return { type: 'url_citation', title: c.title, url: c.url };
              }),
            },
          ],
        },
      ],
    }),
  };
}

const GOOD_LAW_TEXT =
  'Answer\n' +
  'Actus reus: assault or battery causing actual bodily harm.\n\n' +
  'Uncertainties\n' +
  'None\n\n' +
  'Sources\n' +
  '1. Legislation — https://www.legislation.gov.uk/ukpga/1861/100\n' +
  '2. CPS — https://www.cps.gov.uk/legal-guidance/offences-against-person';

describe('openaiLawElements', () => {
  beforeEach(() => {
    resetInFlightForTests();
  });

  it('builds offence-only payload and ignores client fields', () => {
    const payload = buildOffencePayload({
      clientName: 'SECRET CLIENT',
      clientInstructions: 'privileged',
      offence1Details: 'Theft',
      offence1Statute: 'Theft Act 1968 s.1',
      offence2Details: '',
    });
    assert.equal(payload.offences.length, 1);
    assert.equal(payload.offences[0].details, 'Theft');
    assert.ok(!JSON.stringify(payload).includes('SECRET'));
    assert.ok(!JSON.stringify(payload).includes('privileged'));
  });

  it('requires an offence', () => {
    const payload = buildOffencePayload({ clientName: 'x' });
    assert.ok(payload.error);
  });

  it('prompt mentions actus reus / mens rea / defences / sentencing and sources', () => {
    const msg = buildPromptMessages([{ details: 'ABH', statute: 'OAPA 1861 s.47', modeOfTrial: 'Either way' }]);
    assert.match(msg.system, /Actus reus/i);
    assert.match(msg.system, /Mens rea/i);
    assert.match(msg.system, /defences/i);
    assert.match(msg.system, /Sentencing/i);
    assert.match(msg.system, /ACCURACY|Sources/i);
    assert.match(msg.user, /ABH/);
    assert.match(msg.user, /Sources/);
  });

  it('gates on confirmed and api key', async () => {
    let called = false;
    const r1 = await requestLawElementsDraft({
      confirmed: false,
      apiKey: 'sk-test',
      offences: [{ details: 'Theft', statute: '', modeOfTrial: '' }],
      fetchImpl: async () => {
        called = true;
        return mockResponsesOk(GOOD_LAW_TEXT);
      },
    });
    assert.equal(r1.ok, false);
    assert.equal(called, false);

    const r2 = await requestLawElementsDraft({
      confirmed: true,
      apiKey: '',
      offences: [{ details: 'Theft', statute: '', modeOfTrial: '' }],
      fetchImpl: async () => {
        called = true;
        return mockResponsesOk(GOOD_LAW_TEXT);
      },
    });
    assert.equal(r2.ok, false);
    assert.equal(called, false);
  });

  it('returns grounded draft with sources', async () => {
    const res = await requestLawElementsDraft({
      confirmed: true,
      apiKey: 'sk-test',
      offences: [{ details: 'ABH', statute: 'OAPA', modeOfTrial: '' }],
      fetchImpl: async () => mockResponsesOk(GOOD_LAW_TEXT),
    });
    assert.equal(res.ok, true);
    assert.match(res.draft, /Actus reus/i);
    assert.ok(res.sources.length >= 2);
  });

  it('rejects unsourced legal draft after retry', async () => {
    let calls = 0;
    const res = await requestLawElementsDraft({
      confirmed: true,
      apiKey: 'sk-test',
      offences: [{ details: 'ABH', statute: 'OAPA', modeOfTrial: '' }],
      fetchImpl: async () => {
        calls += 1;
        return mockResponsesOk('Answer\nMust prove actus reus.\n\nUncertainties\nNone\n\nSources\nNone');
      },
    });
    assert.equal(res.ok, false);
    assert.ok(calls >= 1);
    assert.match(res.error, /source|rejected|accuracy/i);
  });

  it('PDF builders omit AI UI keys', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const pdfStart = appJs.indexOf('function buildPdfHtml');
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    assert.ok(pdfStart > 0 && volStart > 0);
    const pdfChunk = appJs.slice(pdfStart, pdfStart + 8000);
    const volChunk = appJs.slice(volStart, volStart + 8000);
    assert.ok(!pdfChunk.includes('aiFillLawElements'));
    assert.ok(!volChunk.includes('aiFillLawElements'));
    assert.ok(!pdfChunk.includes('aiAskQuestion'));
    assert.ok(!volChunk.includes('aiAskQuestion'));
    assert.ok(appJs.includes("type: 'aiLawFill'"));
    assert.ok(appJs.includes("type: 'aiAsk'"));
  });
});

describe('aiLawElements renderer — Insert-only + sources gate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'aiLawElements.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  it('never calls runFill without confirm OK', () => {
    assert.match(src, /confirmAsync\(msg/);
    assert.match(src, /if \(ok\) runFill\(\)/);
    assert.match(src, /else uncheckFillBoxes\(\)/);
  });

  it('writes lawElements only via insert path', () => {
    assert.match(src, /function insertIntoLawElements/);
    assert.match(src, /Only write path into lawElements/);
    const runFillStart = src.indexOf('function runFill()');
    const runFillEnd = src.indexOf('function onFillCheckboxChange');
    assert.ok(runFillStart > 0 && runFillEnd > runFillStart);
    const runFillBody = src.slice(runFillStart, runFillEnd);
    assert.ok(!runFillBody.includes("setField('lawElements'"));
    assert.ok(runFillBody.includes('showReviewModal'));
  });

  it('gates Insert/Append on sources and shows Sources UI', () => {
    assert.match(html, /id="ai-law-draft-sources"/);
    assert.match(html, /id="ai-ask-accuracy-banner"/);
    assert.match(src, /sources\.length/);
    assert.match(src, /Insert disabled|sources required|canInsert|_lastLawSources|appendLastToLawElements/i);
  });
});

describe('openaiAsk', () => {
  beforeEach(() => {
    resetAskInFlightForTests();
  });

  it('builds free-form messages with history and no client fields', () => {
    const built = buildAskMessages({
      question: 'What are the elements of self-defence?',
      history: [
        { role: 'user', content: 'Explain intoxication briefly' },
        { role: 'assistant', content: 'Intoxication is usually...' },
      ],
      offences: [],
    });
    assert.equal(built.question, 'What are the elements of self-defence?');
    assert.ok(built.messages.some((m) => m.role === 'user' && /self-defence/.test(m.content)));
    const blob = JSON.stringify(built.messages);
    assert.ok(!blob.includes('clientName'));
  });

  it('optionally attaches offence context only', () => {
    const built = buildAskMessages({
      question: 'Sentencing?',
      history: [],
      offences: [{ details: 'ABH', statute: 's.47', modeOfTrial: 'EW' }],
    });
    const sys = built.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.match(sys, /ABH/);
    assert.ok(!sys.includes('clientName'));
  });

  it('normalises history roles', () => {
    const h = normaliseHistory([
      { role: 'user', content: 'a' },
      { role: 'system', content: 'bad' },
      { role: 'assistant', content: 'b' },
    ]);
    assert.equal(h.length, 2);
  });

  it('returns answer with sources from Responses API', async () => {
    const res = await requestAskAnswer({
      confirmed: true,
      apiKey: 'sk-test',
      question: 'Self-defence elements?',
      history: [],
      fetchImpl: async () => mockResponsesOk(GOOD_LAW_TEXT),
    });
    assert.equal(res.ok, true);
    assert.ok(res.sources.length >= 2);
    assert.match(res.answer, /Sources/i);
  });

  it('extractTextAndCitations reads annotations', () => {
    const parsed = extractTextAndCitations({
      output_text: 'Hello',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Hello',
              annotations: [{ type: 'url_citation', title: 'A', url: 'https://example.com/a' }],
            },
          ],
        },
      ],
    });
    assert.equal(parsed.text, 'Hello');
    assert.equal(parsed.citations[0].url, 'https://example.com/a');
  });

  it('preload and main expose ask IPC', () => {
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(preload, /aiAskQuestion/);
    assert.match(main, /ai:ask-question/);
    assert.match(main, /requestAskAnswer/);
  });
});
