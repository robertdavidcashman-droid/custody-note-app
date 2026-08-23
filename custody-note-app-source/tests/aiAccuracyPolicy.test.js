'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateAiLegalResponse,
  formatSourcesBlock,
  isHonestRefusal,
  hasLegalAssertions,
  ACCURACY_SYSTEM_RULES,
  REQUIRED_OUTPUT_SHAPE,
} = require('../main/aiAccuracyPolicy');

describe('aiAccuracyPolicy', () => {
  it('exports the six non-negotiable accuracy rules', () => {
    assert.match(ACCURACY_SYSTEM_RULES, /No hallucinations/i);
    assert.match(ACCURACY_SYSTEM_RULES, /several independent sources/i);
    assert.match(ACCURACY_SYSTEM_RULES, /If in doubt/i);
    assert.match(ACCURACY_SYSTEM_RULES, /Case law is especially strict/i);
    assert.match(ACCURACY_SYSTEM_RULES, /Sources section/i);
    assert.match(REQUIRED_OUTPUT_SHAPE, /Sources/);
  });

  it('passes legal answer with two source URLs', () => {
    const text =
      'Answer\n' +
      'ABH requires assault or battery causing actual bodily harm.\n\n' +
      'Uncertainties\n' +
      'None\n\n' +
      'Sources\n' +
      '1. Legislation.gov.uk — https://www.legislation.gov.uk/ukpga/1861/100\n' +
      '2. CPS — https://www.cps.gov.uk/legal-guidance/offences-against-person';
    const r = validateAiLegalResponse({ text: text });
    assert.equal(r.ok, true);
    assert.ok(r.sources.length >= 2);
  });

  it('fails missing Sources section on legal assertions', () => {
    const r = validateAiLegalResponse({
      text: 'Answer\nThe prosecution must prove actus reus and mens rea.\n\nUncertainties\nNone',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /Sources/i);
  });

  it('fails legal answer with fewer than two URLs', () => {
    const r = validateAiLegalResponse({
      text:
        'Answer\nSentencing guideline applies.\n\nUncertainties\nNone\n\nSources\n1. SC — https://www.sentencingcouncil.org.uk/only-one',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /two source/i);
  });

  it('fails case-law style claim without source URLs', () => {
    const r = validateAiLegalResponse({
      text:
        'Answer\nSee R v Brown [1993] UKHL 19 on consent.\n\nUncertainties\nNone\n\nSources\nNone',
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /case-law/i);
  });

  it('passes honest refusal without fake sources', () => {
    const text =
      'Answer\nI cannot reliably confirm this point from current sources.\n\n' +
      'Uncertainties\nInsufficient reliable sources on the specific point asked.\n\n' +
      'Sources\nNone';
    assert.equal(isHonestRefusal(text), true);
    const r = validateAiLegalResponse({ text: text });
    assert.equal(r.ok, true);
    assert.equal(r.refusal, true);
  });

  it('merges citation annotations into Sources when model omitted URLs', () => {
    const r = validateAiLegalResponse({
      text:
        'Answer\nThe offence is either-way. Maximum sentence is five years.\n\nUncertainties\nNone\n\nSources\n(see citations)',
      citations: [
        { title: 'OAPA', url: 'https://www.legislation.gov.uk/ukpga/1861/100' },
        { title: 'CPS', url: 'https://www.cps.gov.uk/legal-guidance/offences-against-person' },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.sources.length >= 2);
    assert.match(r.text, /legislation\.gov\.uk/);
  });

  it('formatSourcesBlock numbers title and URL', () => {
    const block = formatSourcesBlock([
      { title: 'A', url: 'https://example.com/a' },
      { title: 'B', url: 'https://example.com/b' },
    ]);
    assert.match(block, /^Sources\n/);
    assert.match(block, /1\. A — https:\/\/example\.com\/a/);
  });

  it('detects legal assertions', () => {
    assert.equal(hasLegalAssertions('The prosecution must prove the elements of the offence.'), true);
    assert.equal(hasLegalAssertions('Hello'), false);
  });
});
