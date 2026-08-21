/**
 * tests/securityHardeningRegression.test.js
 * Static tripwires for defensive security controls — fails CI if regressions land.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('security hardening regressions', () => {
  it('main.js blocks marketing capturePage in packaged builds without explicit override', () => {
    const src = read('main.js');
    assert.ok(src.includes('CAPTURE_SCREENSHOTS'), 'capture mode env must exist');
    assert.ok(src.includes('app.isPackaged'), 'packaged guard required');
    assert.ok(
      src.includes('CUSTODYNOTE_ENABLE_MARKETING_CAPTURE'),
      'explicit override env required for packaged capture'
    );
    assert.ok(src.includes('capturePage'), 'capturePage call must remain auditable');
  });

  it('outlookWebCompose omits body from URL by default', () => {
    const src = read('lib/outlookWebCompose.js');
    assert.ok(src.includes('includeBody'), 'opt-in includeBody flag required');
    assert.match(
      src,
      /includeBody\s*===\s*true/,
      'body in URL must be opt-in only'
    );
    assert.ok(
      src.includes('truncated: hasBody') || src.includes('truncated: hasBody,'),
      'truncated flag must reflect body-on-clipboard semantics'
    );
  });

  it('openai client never logs raw prompts', () => {
    for (const rel of ['main/openaiClient.js', 'main/openaiAsk.js', 'main/openaiLawElements.js']) {
      const src = read(rel);
      assert.ok(!/console\.(log|info)\([^)]*inputMessages/i.test(src), rel + ' must not log inputMessages');
      assert.ok(!/console\.(log|info)\([^)]*prompt/i.test(src), rel + ' must not log prompts');
    }
    const client = read('main/openaiClient.js');
    assert.ok(client.includes('debugOpenAiMeta'), 'openaiClient must use metadata-only debug helper');
    assert.ok(client.includes('safeLog'), 'openaiClient must use safeLog');
  });

  it('BrowserWindow uses contextIsolation and sandbox', () => {
    const src = read('main.js');
    assert.ok(/contextIsolation:\s*true/.test(src), 'contextIsolation must be true');
    assert.ok(/sandbox:\s*true/.test(src), 'sandbox must be true');
    assert.ok(/nodeIntegration:\s*false/.test(src), 'nodeIntegration must be false');
  });

  it('.env.example has placeholders only — no live secrets', () => {
    const ex = read('.env.example');
    assert.ok(!/\bghp_[A-Za-z0-9]{20,}\b/.test(ex), '.env.example must not contain real gh tokens');
    assert.ok(!/\bsk_live_[0-9a-zA-Z]{20,}\b/.test(ex), '.env.example must not contain live Stripe keys');
    assert.ok(ex.includes('your_token_here') || ex.includes('example.com'), 'placeholders expected');
  });

  it('.gitignore covers secret env files', () => {
    const gi = read('.gitignore');
    assert.ok(gi.includes('.env'), '.env must be gitignored');
    assert.ok(gi.includes('.env.*'), '.env.* must be gitignored');
    assert.ok(gi.includes('!.env.example'), '.env.example must remain tracked');
  });
});
