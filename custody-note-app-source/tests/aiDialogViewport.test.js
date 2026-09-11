'use strict';

/**
 * AI Law draft + Ask AI dialogs must fit short / scaled viewports:
 * sticky footer with actions always in the dialog chrome, body scrolls,
 * overlay click-out and Escape dismiss.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const rendererSrc = fs.readFileSync(path.join(ROOT, 'renderer', 'aiLawElements.js'), 'utf8');

function extractModalMarkup(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0, `${id} missing from index.html`);
  const open = html.lastIndexOf('<div', start);
  let depth = 0;
  let i = open;
  while (i < html.length) {
    if (html.startsWith('<div', i)) {
      depth += 1;
      i = html.indexOf('>', i) + 1;
      continue;
    }
    if (html.startsWith('</div>', i)) {
      depth -= 1;
      i += 6;
      if (depth === 0) return html.slice(open, i);
      continue;
    }
    i += 1;
  }
  throw new Error(`Failed to extract markup for ${id}`);
}

describe('AI dialog markup — viewport-fit structure', () => {
  it('uses dedicated ai-dialog classes (not missing first-launch-modal)', () => {
    assert.match(html, /id="ai-law-draft-modal"[^>]*class="ai-dialog-overlay"/);
    assert.match(html, /id="ai-ask-modal"[^>]*class="ai-dialog-overlay"/);
    assert.match(html, /class="ai-dialog ai-dialog--law"/);
    assert.match(html, /class="ai-dialog ai-dialog--ask"/);
    const lawChunk = extractModalMarkup('ai-law-draft-modal');
    const askChunk = extractModalMarkup('ai-ask-modal');
    assert.ok(!lawChunk.includes('first-launch-modal'), 'law draft must not use unstyled first-launch-modal');
    assert.ok(!askChunk.includes('first-launch-modal'), 'ask modal must not use unstyled first-launch-modal');
    assert.ok(!lawChunk.includes('first-launch-overlay'));
    assert.ok(!askChunk.includes('first-launch-overlay'));
  });

  it('places footer actions outside the scrollable body for both modals', () => {
    for (const id of ['ai-law-draft-modal', 'ai-ask-modal']) {
      const chunk = extractModalMarkup(id);
      const bodyIdx = chunk.indexOf('ai-dialog-body');
      const footerIdx = chunk.indexOf('ai-dialog-footer');
      assert.ok(bodyIdx > 0 && footerIdx > bodyIdx, `${id}: footer must follow body`);
      assert.match(chunk, /ai-dialog-actions/);
    }
    const law = extractModalMarkup('ai-law-draft-modal');
    assert.match(law, /id="ai-law-draft-copy"/);
    assert.match(law, /id="ai-law-draft-insert"/);
    assert.match(law, /id="ai-law-draft-close"/);
    assert.ok(law.indexOf('ai-law-draft-copy') > law.indexOf('ai-dialog-footer'));
    assert.ok(law.indexOf('ai-law-draft-text') > law.indexOf('ai-dialog-body'));
    assert.ok(law.indexOf('ai-law-draft-text') < law.indexOf('ai-dialog-footer'));
    assert.ok(!/id="ai-law-draft-text"[^>]*rows="12"/.test(law), 'textarea must not force fixed 12 rows');

    const ask = extractModalMarkup('ai-ask-modal');
    for (const bid of [
      'ai-ask-send',
      'ai-ask-copy-last',
      'ai-ask-copy-thread',
      'ai-ask-append-law',
      'ai-ask-clear',
      'ai-ask-close',
    ]) {
      assert.ok(ask.includes(`id="${bid}"`), `${bid} missing`);
      assert.ok(ask.indexOf(bid) > ask.indexOf('ai-dialog-footer'), `${bid} must be in footer`);
    }
    assert.ok(ask.indexOf('ai-ask-thread') < ask.indexOf('ai-dialog-footer'));
  });
});

describe('AI dialog CSS — fit viewport + sticky footer', () => {
  it('defines overlay and dialog max-height with vh/dvh fallbacks', () => {
    assert.match(styles, /\.ai-dialog-overlay\s*\{/);
    assert.match(styles, /\.ai-dialog\s*\{/);
    assert.match(styles, /max-height:\s*90vh/);
    assert.match(styles, /max-height:\s*min\(90dvh,\s*calc\(100vh - 2rem\)\)/);
    assert.match(styles, /\.ai-dialog-body\s*\{[\s\S]*?overflow-y:\s*auto/);
    assert.match(styles, /\.ai-dialog-footer\s*\{[\s\S]*?flex:\s*0 0 auto/);
    assert.match(styles, /\.ai-dialog-footer\s*\{[\s\S]*?position:\s*sticky/);
    assert.match(styles, /\.ai-dialog\s*\{[\s\S]*?overflow:\s*hidden/);
    assert.match(styles, /\.ai-dialog-textarea\s*\{[\s\S]*?min-height:/);
    assert.match(styles, /\.ai-dialog-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });

  it('keeps Ask thread scrolling inside the body, not a fixed 40vh that overflows chrome', () => {
    assert.match(styles, /\.ai-ask-thread\s*\{[\s\S]*?overflow:\s*auto/);
    assert.ok(!/id="ai-ask-thread"[^>]*max-height:\s*40vh/.test(html));
  });
});

describe('AI dialog dismiss wiring (source)', () => {
  it('wires overlay click-out and Escape to the same close paths', () => {
    assert.match(rendererSrc, /dismissLawDraftModal/);
    assert.match(rendererSrc, /e\.target === lawModal/);
    assert.match(rendererSrc, /e\.target === askModal/);
    assert.match(rendererSrc, /stopPropagation/);
    assert.match(rendererSrc, /e\.key !== 'Escape'/);
    assert.match(rendererSrc, /closeAskSession\(\)/);
    assert.match(rendererSrc, /uncheckFillBoxes\(\)/);
  });
});

describe('AI dialog dismiss behaviour (jsdom)', () => {
  let dom;
  let window;
  let document;

  beforeEach(() => {
    const lawMarkup = extractModalMarkup('ai-law-draft-modal');
    const askMarkup = extractModalMarkup('ai-ask-modal');
    dom = new JSDOM(
      `<!DOCTYPE html><html><head><style>${styles}</style></head><body>${lawMarkup}${askMarkup}</body></html>`,
      { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true }
    );
    window = dom.window;
    document = window.document;
    window.showToast = function () {};
    window.showConfirm = function () {
      return Promise.resolve(false);
    };
    window.formData = {};
    global.window = window;
    global.document = document;
    global.HTMLElement = window.HTMLElement;
    global.Node = window.Node;
    /* eslint-disable no-eval */
    window.eval(rendererSrc);
    /* eslint-enable no-eval */
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.HTMLElement;
    delete global.Node;
    if (dom) dom.window.close();
    dom = null;
  });

  function openLaw() {
    const modal = document.getElementById('ai-law-draft-modal');
    modal.style.display = '';
    const text = document.getElementById('ai-law-draft-text');
    text.value = 'Long draft\n'.repeat(40) + '\nSources\n1. https://a.test\n2. https://b.test';
    const sources = document.getElementById('ai-law-draft-sources');
    sources.innerHTML = '<strong>Sources</strong><ol><li>https://a.test</li><li>https://b.test</li></ol>';
    return modal;
  }

  function openAsk() {
    const modal = document.getElementById('ai-ask-modal');
    modal.style.display = '';
    const thread = document.getElementById('ai-ask-thread');
    thread.innerHTML = '<div>' + 'AI answer paragraph. '.repeat(80) + '</div>';
    return modal;
  }

  it('keeps footer action buttons inside .ai-dialog-footer (not in scroll body)', () => {
    openLaw();
    openAsk();
    const lawFooter = document.querySelector('#ai-law-draft-modal .ai-dialog-footer');
    const askFooter = document.querySelector('#ai-ask-modal .ai-dialog-footer');
    assert.ok(lawFooter.contains(document.getElementById('ai-law-draft-copy')));
    assert.ok(lawFooter.contains(document.getElementById('ai-law-draft-insert')));
    assert.ok(lawFooter.contains(document.getElementById('ai-law-draft-close')));
    assert.ok(askFooter.contains(document.getElementById('ai-ask-clear')));
    assert.ok(askFooter.contains(document.getElementById('ai-ask-close')));
    assert.ok(askFooter.contains(document.getElementById('ai-ask-append-law')));

    const lawDialog = document.querySelector('#ai-law-draft-modal .ai-dialog');
    const askDialog = document.querySelector('#ai-ask-modal .ai-dialog');
    const lawCs = window.getComputedStyle(lawDialog);
    const askCs = window.getComputedStyle(askDialog);
    assert.equal(lawCs.display, 'flex');
    assert.equal(askCs.display, 'flex');
    assert.match(lawCs.flexDirection, /column/i);
    assert.match(String(lawCs.overflow), /hidden/i);

    const lawBody = document.querySelector('#ai-law-draft-modal .ai-dialog-body');
    const lawBodyCs = window.getComputedStyle(lawBody);
    assert.match(String(lawBodyCs.overflowY || lawBodyCs.overflow), /auto|scroll/i);

    const footerCs = window.getComputedStyle(lawFooter);
    assert.equal(footerCs.flexShrink === '0' || footerCs.flex === '0 0 auto' || /0 0 auto/.test(footerCs.flex), true);
  });

  it('hides law draft modal on overlay click and Escape', () => {
    const modal = openLaw();
    assert.notEqual(modal.style.display, 'none');
    modal.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(modal.style.display, 'none');

    openLaw();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.style.display, 'none');
  });

  it('does not close law draft when clicking inside the dialog', () => {
    const modal = openLaw();
    const dialog = modal.querySelector('.ai-dialog');
    dialog.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.notEqual(modal.style.display, 'none');
  });

  it('hides Ask AI modal on overlay click and Escape', () => {
    const modal = openAsk();
    modal.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(modal.style.display, 'none');

    openAsk();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(modal.style.display, 'none');
  });

  it('keeps Insert disabled until sources gate is opened by setInsertEnabled path', () => {
    openLaw();
    const insert = document.getElementById('ai-law-draft-insert');
    assert.equal(insert.disabled, true);
    const append = document.getElementById('ai-ask-append-law');
    assert.equal(append.disabled, true);
  });
});
