'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const parityRulePath = path.join(root, '.cursor', 'rules', 'custody-note-cross-platform-parity.mdc');
const productionRulePath = path.join(root, '.cursor', 'rules', 'custody-note-electron-production.mdc');
const cursorrulesPath = path.join(root, '.cursorrules');

function read(relOrAbs) {
  return fs.readFileSync(relOrAbs, 'utf8');
}

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, 'expected YAML frontmatter');
  const body = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) body[kv[1]] = kv[2].trim();
  }
  return { frontmatter: body, content: src.slice(m[0].length) };
}

describe('cross-platform parity Cursor rule', () => {
  it('exists with alwaysApply: true', () => {
    assert.ok(fs.existsSync(parityRulePath), 'parity rule file missing');
    const { frontmatter } = parseFrontmatter(read(parityRulePath));
    assert.strictEqual(frontmatter.alwaysApply, 'true');
    assert.match(frontmatter.description || '', /Mac and Windows/i);
  });

  it('defines required parity, workflow, allowlist, forbidden, and checklist sections', () => {
    const { content } = parseFrontmatter(read(parityRulePath));
    for (const heading of [
      '## Required parity',
      '## Mandatory workflow when changing code',
      '## Allowed platform-specific code (allowlist)',
      '## Forbidden',
      '## Verification checklist (before finishing)',
    ]) {
      assert.ok(content.includes(heading), `missing section: ${heading}`);
    }
    assert.match(content, /Mac impact.*Windows impact/s);
    assert.match(content, /preloadOutlookWebComposeParity\.test\.js/);
  });

  it('is referenced from .cursorrules and custody-note-electron-production.mdc', () => {
    const cursorrules = read(cursorrulesPath);
    assert.match(cursorrules, /## Cross-platform parity \(Mac \+ Windows\)/);
    assert.match(cursorrules, /custody-note-cross-platform-parity\.mdc/);

    const production = read(productionRulePath);
    assert.match(production, /custody-note-cross-platform-parity\.mdc/);
    assert.match(production, /functional parity required/i);
  });

  it('allowlist references exist in the codebase', () => {
    const mainJs = read(path.join(root, 'main.js'));
    assert.match(mainJs, /function getFallbackAppDataRoot/);
    assert.match(mainJs, /function buildMacAppMenu/);
    assert.match(mainJs, /create-desktop-shortcut/);

    assert.ok(fs.existsSync(path.join(root, 'lib', 'openExternalUrl.js')));
    assert.ok(fs.existsSync(path.join(root, 'updater.js')));
    assert.ok(fs.existsSync(path.join(root, 'tests', 'preloadOutlookWebComposeParity.test.js')));
  });
});
