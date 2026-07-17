/**
 * Source/regression tests for readable text contrast tokens and view overrides.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

describe('text contrast CSS tokens', () => {
  it('defines --muted alias tied to --on-surface-muted', () => {
    assert.ok(stylesCss.includes('--muted: var(--on-surface-muted)'), 'missing --muted alias');
  });

  it('bumps dark-mode --on-surface-muted to #cbd5e1', () => {
    const darkBlock = stylesCss.match(/html\.dark\s*\{[^}]+\}/);
    assert.ok(darkBlock, 'html.dark block missing');
    assert.ok(darkBlock[0].includes('--on-surface-muted: #cbd5e1'), 'dark on-surface-muted should be #cbd5e1');
  });

  it('light mode sets readable shell --text-muted', () => {
    const lightBlock = stylesCss.match(/html:not\(\.dark\)\s*\{[^}]+\}/);
    assert.ok(lightBlock, 'html:not(.dark) block missing');
    assert.ok(lightBlock[0].includes('--text-muted: #475569'), 'light text-muted should be #475569');
  });
});

describe('action guide done styling', () => {
  it('does not ghost completed guide items with line-through or low opacity', () => {
    const doneBlock = stylesCss.match(/\.wf-action-guide-item--done\s*\{[^}]+\}/);
    assert.ok(doneBlock, '.wf-action-guide-item--done rule missing');
    assert.ok(!doneBlock[0].includes('line-through'), 'done guide items must not use line-through');
    assert.ok(!/opacity:\s*0\.[0-8]/.test(doneBlock[0]), 'done guide items must not use opacity below 0.9');
  });
});

describe('view-specific contrast overrides', () => {
  it('includes light-mode form hint overrides', () => {
    assert.ok(stylesCss.includes('html:not(.dark) #view-form .field-hint'));
  });

  it('includes light-mode home meta overrides', () => {
    assert.ok(stylesCss.includes('html:not(.dark) #view-home .home-section-title'));
    assert.ok(stylesCss.includes('html:not(.dark) #view-home .home-item-meta'));
  });

  it('includes billing workflow label overrides', () => {
    assert.ok(stylesCss.includes('html:not(.dark) #view-matter-billing .wf-label'));
    assert.ok(stylesCss.includes('html.dark .wf-card .wf-label'));
  });
});
