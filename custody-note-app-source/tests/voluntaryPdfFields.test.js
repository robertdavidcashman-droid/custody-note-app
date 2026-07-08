/**
 * Regression: the Voluntary Attendance Note PDF (buildVoluntaryPdfHtml in app.js)
 * must render fields that are collected on the voluntary form and shown on the
 * equivalent custody note, so nothing the fee earner enters is silently dropped.
 *
 * Added in v1.9.17 after an audit found the voluntary PDF omitted:
 *   - Matter Type (section 4)
 *   - Interpreter mode / agency / phone / arrival time (section 3)
 *   - Disclosure: samples disclosed, caution offered, injuries (section 5)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function sliceFunction(src, signature, nextSignature) {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, 'expected to find ' + signature);
  const end = src.indexOf(nextSignature, start + signature.length);
  assert.ok(end !== -1, 'expected to find ' + nextSignature + ' after ' + signature);
  return src.slice(start, end);
}

describe('Voluntary Attendance Note PDF — field completeness', () => {
  const body = sliceFunction(appJs, 'function buildVoluntaryPdfHtml(', 'function getActivePdfBuilder(');

  it('renders Matter Type in section 4', () => {
    assert.ok(
      body.includes("row('Matter Type', codeLookup('matterTypeCodes', d.matterTypeCode))"),
      'voluntary PDF section 4 must render the Matter Type code'
    );
  });

  it('renders full interpreter details when there are language issues', () => {
    assert.ok(body.includes("row('Interpretation mode', d.interpreterMode)"), 'interpreter mode');
    assert.ok(body.includes("row('Interpreter agency', d.interpreterAgency)"), 'interpreter agency');
    assert.ok(body.includes("row('Interpreter phone', d.interpreterPhone)"), 'interpreter phone');
    assert.ok(body.includes("row('Interpreter arrival time', d.interpreterArrivalTime)"), 'interpreter arrival time');
  });

  it('renders the disclosure extras (samples, caution offered, injuries)', () => {
    assert.ok(body.includes("row('Samples (disclosed)?', d.samplesDisclosed)"), 'samples disclosed');
    assert.ok(body.includes("row('Caution/out-of-court offered?', d.cautionAvailable)"), 'caution offered');
    assert.ok(body.includes("row('Injuries (disclosure)', d.disclosureReInjuries)"), 'disclosure injuries');
  });

  it('still renders the voluntary-specific blocks (free to leave, voluntary confirmation)', () => {
    assert.ok(body.includes('freeToLeaveExplained'), 'free-to-leave block');
    assert.ok(body.includes('voluntaryStatusConfirmed'), 'voluntary status confirmation');
  });
});
