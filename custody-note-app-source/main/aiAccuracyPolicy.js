/**
 * Non-negotiable AI accuracy rules for Custody Note legal answers.
 * Used by Ask AI and Law / Elements fill — validate before UI accepts a response.
 */

'use strict';

const PREFERRED_UK_LEGAL_DOMAINS = [
  'legislation.gov.uk',
  'www.legislation.gov.uk',
  'www.sentencingcouncil.org.uk',
  'sentencingcouncil.org.uk',
  'www.cps.gov.uk',
  'cps.gov.uk',
  'www.bailii.org',
  'bailii.org',
  'www.judiciary.uk',
  'judiciary.uk',
  'www.gov.uk',
];

const ACCURACY_SYSTEM_RULES =
  'ACCURACY RULES (non-negotiable — violation means the app will reject your answer):\n' +
  '1. No hallucinations. Do not invent statutes, case names, ratios, citations, or dates.\n' +
  '2. Fact-check from several independent sources using web search before asserting law.\n' +
  '3. Be truthful, up to date, and accurate. Prefer current primary/official materials. If the law may have changed, say so.\n' +
  '4. If in doubt, do not quote or assert the point — omit it and list it under Uncertainties.\n' +
  '5. Case law is especially strict: only cite a case if a retrieved source URL supports that citation. Otherwise do not name the case.\n' +
  '6. Every substantive answer MUST end with a Sources section listing at least two http(s) URLs (title + URL). No sources = rejected.\n' +
  'Prefer UK official domains (legislation.gov.uk, sentencingcouncil.org.uk, cps.gov.uk, bailii.org, judiciary.uk, gov.uk) when available.\n' +
  'This is a draft for a qualified solicitor to verify against primary materials — not legal advice. Do not invent client facts.';

const REQUIRED_OUTPUT_SHAPE =
  'Output format (use these headings exactly):\n' +
  'Answer\n' +
  '<your substantive answer>\n\n' +
  'Uncertainties\n' +
  '<points you could not verify, or None>\n\n' +
  'Sources\n' +
  '1. <title> — <https://url>\n' +
  '2. <title> — <https://url>\n' +
  '(Minimum two Sources URLs for any answer that states legal rules. ' +
  'If you cannot reliably confirm from sources, reply only with a short refusal under Answer, Uncertainties explaining why, and Sources: None — do not invent URLs.)';

const CASE_LAW_PATTERN =
  /\b(?:v\.?|vs\.?)\b|\[[12]\d{3}\]\s*[A-Z]|\b(?:EWCA|EWHC|UKSC|UKHL|Cr\.?\s*App\.?\s*R\.?|WLR|All\s*ER)\b/i;

const REFUSAL_PATTERN =
  /\b(cannot reliably confirm|unable to verify|insufficient (?:reliable )?sources|do not have (?:reliable )?sources|cannot find (?:reliable )?sources)\b/i;

const URL_PATTERN = /https?:\/\/[^\s)\]>'"]+/gi;

function extractUrlsFromText(text) {
  const raw = String(text || '');
  const found = raw.match(URL_PATTERN) || [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < found.length; i++) {
    let u = found[i].replace(/[.,;:]+$/, '');
    if (!seen[u]) {
      seen[u] = true;
      out.push(u);
    }
  }
  return out;
}

function normaliseCitations(citations) {
  if (!Array.isArray(citations)) return [];
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    if (!c || typeof c !== 'object') continue;
    const url = String(c.url || c.href || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({
      title: String(c.title || c.name || url).trim() || url,
      url: url,
    });
  }
  return out;
}

function extractSourcesSection(text) {
  const raw = String(text || '');
  const m = raw.match(/\n\s*Sources\s*\n([\s\S]*)$/i);
  if (!m) return { hasHeading: /\bSources\b/i.test(raw), body: '' };
  return { hasHeading: true, body: m[1].trim() };
}

function extractUncertainties(text) {
  const raw = String(text || '');
  const m = raw.match(/\n\s*Uncertainties\s*\n([\s\S]*?)(?=\n\s*Sources\s*\n|$)/i);
  if (!m) return '';
  return m[1].trim();
}

function isHonestRefusal(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (!REFUSAL_PATTERN.test(raw)) return false;
  const sources = extractSourcesSection(raw);
  const urls = extractUrlsFromText(raw);
  /* Refusal may say Sources: None and must not assert detailed case law. */
  if (CASE_LAW_PATTERN.test(raw) && urls.length < 1) return false;
  const sourcesNone = /sources\s*:\s*none\b/i.test(raw) || /^none\b/i.test(sources.body);
  return sourcesNone || urls.length === 0;
}

function hasLegalAssertions(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  if (isHonestRefusal(raw)) return false;
  return (
    /\b(actus reus|mens rea|offence|statute|section\s+\d|sentencing|defence|prosecution|guilty|indictment|summary.?only|either.?way)\b/i.test(
      raw,
    ) ||
    CASE_LAW_PATTERN.test(raw) ||
    /\b(must prove|elements of|maximum (?:sentence|penalty)|guideline)\b/i.test(raw)
  );
}

function formatSourcesBlock(citations) {
  const list = normaliseCitations(citations);
  if (!list.length) return '';
  const lines = list.map(function (c, i) {
    return i + 1 + '. ' + c.title + ' — ' + c.url;
  });
  return 'Sources\n' + lines.join('\n');
}

function mergeTextWithCitationSources(text, citations) {
  let body = String(text || '').trim();
  const fromText = extractUrlsFromText(body);
  const fromCite = normaliseCitations(citations);
  const merged = normaliseCitations(
    fromCite.concat(
      fromText.map(function (url) {
        return { title: url, url: url };
      }),
    ),
  );
  const section = extractSourcesSection(body);
  if (!section.hasHeading || extractUrlsFromText(section.body).length < 2) {
    if (merged.length >= 2) {
      /* Strip a weak/empty Sources section then append a complete one. */
      body = body.replace(/\n\s*Sources\s*\n[\s\S]*$/i, '').trim();
      body = body + '\n\n' + formatSourcesBlock(merged);
    }
  }
  return { text: body, sources: merged };
}

/**
 * @param {{ text?: string, citations?: Array<{title?: string, url?: string}> }} opts
 * @returns {{ ok: boolean, error?: string, text?: string, sources?: Array, uncertainties?: string, refusal?: boolean }}
 */
function validateAiLegalResponse(opts) {
  const options = opts || {};
  const merged = mergeTextWithCitationSources(options.text, options.citations);
  const text = merged.text;
  const sources = merged.sources;
  const uncertainties = extractUncertainties(text);

  if (!text) {
    return { ok: false, error: 'Empty AI response.' };
  }

  if (isHonestRefusal(text)) {
    return {
      ok: true,
      text: text,
      sources: sources,
      uncertainties: uncertainties || 'Insufficient reliable sources.',
      refusal: true,
    };
  }

  const section = extractSourcesSection(text);
  if (!section.hasHeading) {
    return {
      ok: false,
      error: 'AI response rejected: missing Sources section (mandatory).',
      text: text,
      sources: sources,
    };
  }

  const sourceUrls = extractUrlsFromText(section.body);
  const allUrls = sourceUrls.length ? sourceUrls : sources.map(function (s) { return s.url; });

  if (CASE_LAW_PATTERN.test(text) && allUrls.length < 1) {
    return {
      ok: false,
      error:
        'AI response rejected: case-law references require supporting source URLs. ' +
        'If in doubt, the case must not be cited.',
      text: text,
      sources: sources,
    };
  }

  if (hasLegalAssertions(text) && allUrls.length < 2) {
    return {
      ok: false,
      error:
        'AI response rejected: legal answers require at least two source URLs. ' +
        'Doubtful or unsourced material must not be quoted.',
      text: text,
      sources: sources,
    };
  }

  const normalisedSources =
    sources.length >= 2
      ? sources
      : allUrls.map(function (url) {
          return { title: url, url: url };
        });

  return {
    ok: true,
    text: text,
    sources: normalisedSources,
    uncertainties: uncertainties,
    refusal: false,
  };
}

module.exports = {
  ACCURACY_SYSTEM_RULES,
  REQUIRED_OUTPUT_SHAPE,
  PREFERRED_UK_LEGAL_DOMAINS,
  CASE_LAW_PATTERN,
  extractUrlsFromText,
  extractSourcesSection,
  extractUncertainties,
  normaliseCitations,
  formatSourcesBlock,
  mergeTextWithCitationSources,
  validateAiLegalResponse,
  hasLegalAssertions,
  isHonestRefusal,
};
