/**
 * Opt-in free-form OpenAI Q&A for solicitors (web-search grounded + accuracy gate).
 * Sends the typed question + optional session history (+ optional offence names).
 * Never auto-pulls client or privileged form fields.
 */

'use strict';

const { requestGroundedLegalAnswer, DEFAULT_MODEL, RESPONSES_URL } = require('./openaiClient');
const { ACCURACY_SYSTEM_RULES } = require('./aiAccuracyPolicy');

let _inFlight = false;

const ASK_SYSTEM_PROMPT =
  'You are a UK criminal defence solicitor assistant helping a qualified solicitor. ' +
  'Answer the question asked clearly and practically. ' +
  'Do not invent case facts about a specific client. Do not require or request client identifiers. ' +
  'UK law only unless the user asks about another jurisdiction. ' +
  'Use web search. Follow the ACCURACY RULES and required Sources format.';

function normaliseHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (let i = 0; i < history.length; i++) {
    const turn = history[i];
    if (!turn || typeof turn !== 'object') continue;
    const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : '';
    const content = String(turn.content || '').trim();
    if (!role || !content) continue;
    out.push({ role: role, content: content });
    if (out.length >= 40) break;
  }
  return out;
}

function formatOffencesContext(offences) {
  if (!Array.isArray(offences) || !offences.length) return '';
  const lines = offences.map(function (o, idx) {
    return (
      (idx + 1) +
      '. ' +
      (o.details || '(unnamed)') +
      (o.statute ? ' — ' + o.statute : '') +
      (o.modeOfTrial ? ' (mode: ' + o.modeOfTrial + ')' : '')
    );
  });
  return 'Offence name(s)/statute(s) from the attendance note (optional context):\n' + lines.join('\n');
}

function buildAskMessages(opts) {
  const options = opts || {};
  const question = String(options.question || '').trim();
  const history = normaliseHistory(options.history);
  const offences = Array.isArray(options.offences) ? options.offences : [];
  const messages = [{ role: 'system', content: ASK_SYSTEM_PROMPT }];
  const offenceCtx = formatOffencesContext(offences);
  if (offenceCtx) {
    messages.push({
      role: 'system',
      content: offenceCtx + '\n\nUse this only if relevant to the user question. Do not invent further case facts.',
    });
  }
  for (let i = 0; i < history.length; i++) {
    messages.push(history[i]);
  }
  if (question) {
    messages.push({ role: 'user', content: question });
  }
  return { messages: messages, question: question, history: history };
}

async function requestAskAnswer(opts) {
  const options = opts || {};
  if (options.confirmed !== true) {
    return { ok: false, error: 'Explicit confirmation required before calling OpenAI.' };
  }
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'Add your OpenAI API key in Settings → Integrations first.' };
  }
  const built = buildAskMessages(options);
  if (!built.question) {
    return { ok: false, error: 'Enter a question first.' };
  }
  if (_inFlight) {
    return { ok: false, error: 'An AI request is already in progress.' };
  }

  _inFlight = true;
  try {
    const result = await requestGroundedLegalAnswer({
      apiKey: apiKey,
      model: options.model,
      fetchImpl: options.fetchImpl,
      inputMessages: built.messages,
      requireWebSearch: true,
      retryOnValidationFail: true,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      answer: result.text,
      sources: result.sources || [],
      uncertainties: result.uncertainties || '',
      refusal: !!result.refusal,
      model: result.model || DEFAULT_MODEL,
      message: result.message,
    };
  } finally {
    _inFlight = false;
  }
}

function resetAskInFlightForTests() {
  _inFlight = false;
}

module.exports = {
  ASK_SYSTEM_PROMPT,
  ACCURACY_SYSTEM_RULES,
  buildAskMessages,
  normaliseHistory,
  formatOffencesContext,
  requestAskAnswer,
  resetAskInFlightForTests,
  DEFAULT_MODEL,
  OPENAI_URL: RESPONSES_URL,
};
