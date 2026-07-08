/**
 * Integration/source tests for CRM1 pre-submit validation wiring (no silent failures).
 *
 * Confirms the generation flow:
 *  - loads the shared CRM1 validation helper;
 *  - runs validateCrm1Data before generating CRM1 and shows a pre-submit summary;
 *  - surfaces field-fill misses returned by the main process instead of pretending success.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const MAIN = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

describe('CRM1 pre-submit validation wiring', () => {
  it('index.html loads the CRM1 validation helper before app.js', () => {
    assert.ok(HTML.includes('renderer/lib/crm1Validation.js'), 'helper script not loaded');
    assert.ok(HTML.indexOf('renderer/lib/crm1Validation.js') < HTML.indexOf('src="app.js"'),
      'crm1Validation.js must load before app.js');
  });

  it('openLaaForm validates CRM1 and shows a pre-submit summary', () => {
    assert.ok(APP.includes('Crm1Validation.validateCrm1Data'), 'must call shared validator');
    assert.ok(/CRM1 \\u2014 check before submitting|check before submitting/.test(APP),
      'must present a pre-submit summary title');
    assert.ok(APP.includes("formType === 'crm1'"), 'validation gated to CRM1 form');
  });

  it('generateLaaFormPdf surfaces field-fill misses (no silent failure)', () => {
    assert.ok(APP.includes('result.fieldMisses'), 'renderer must read fieldMisses');
    assert.ok(/could not be filled/i.test(APP), 'must warn the user about unfilled fields');
  });

  it('main process still returns fieldMisses so the renderer can act on them', () => {
    assert.ok(MAIN.includes('fieldMisses:'), 'main must return a fieldMisses count');
    assert.ok(MAIN.includes('missedFields:'), 'main must return the missed field names');
  });

  it('billing Step 1 generate uses the shared CRM1 pre-submit summary', () => {
    const DOC = fs.readFileSync(path.join(root, 'renderer', 'views', 'documents-screen.js'), 'utf8');
    assert.ok(DOC.includes('promptCrm1ValidationBeforeGenerate'), 'documents-screen must call shared validator');
    assert.ok(DOC.includes("formId === 'crm1'"), 'validation gated to CRM1 in workflow');
  });
});
