/**
 * Regression test for "failed to generate police station attendance note —
 * h is not a function".
 *
 * Root cause: inside buildPdfHtml() (app.js) an IIFE that renders
 * stationVisits declared `var h = ''` to accumulate HTML, which shadowed the
 * outer `const h = esc` HTML-escape function. The IIFE then called `h(lab)`
 * and Chromium threw "h is not a function", which the renderer surfaced as
 * a generic toast.
 *
 * The fix renames the local accumulator to `visitHtml`. This test:
 *
 * 1. Asserts the source no longer contains a `var h = ''` declaration inside
 *    buildPdfHtml's body (the only place it ever lived).
 * 2. Asserts the multi-visit branch uses `visitHtml` as the accumulator.
 * 3. Asserts the renderer (documents-screen.js) routes attendance_note
 *    through window.getPdfBuilderForData so the right builder is selected
 *    per record (custody / voluntary / telephone) regardless of the
 *    currently-loaded form.
 * 4. Asserts the three builders are exposed on window so documents-screen.js
 *    can pick the right one for the record being generated.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const docScreenJs = fs.readFileSync(
  path.join(root, 'renderer', 'views', 'documents-screen.js'),
  'utf8'
);

function sliceFunction(src, signature, nextSignature) {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, 'expected to find ' + signature);
  const end = src.indexOf(nextSignature, start + signature.length);
  assert.ok(end !== -1, 'expected to find ' + nextSignature + ' after ' + signature);
  return src.slice(start, end);
}

describe('Police Station Attendance Note PDF — regression for "h is not a function"', () => {
  // buildPdfHtml ends where buildTelephonePdfHtml begins (those two helpers
  // live back-to-back). Slicing this way avoids accidentally pulling the
  // legitimate `var h = function(s)…` declarations from buildTelephonePdfHtml
  // and buildVoluntaryPdfHtml into the regression check.
  const buildPdfHtmlBody = sliceFunction(
    appJs,
    'function buildPdfHtml(',
    'function buildTelephonePdfHtml('
  );

  it('buildPdfHtml does not declare a local `h` that shadows the escape helper', () => {
    // The only `h` inside buildPdfHtml should be the `const h = esc` helper
    // declared at the top. A `var h = ...` (or another const/let h) anywhere
    // in the body would shadow it for the surrounding scope and break PDF
    // generation for records using that branch.
    const decls = buildPdfHtmlBody.match(/(?:^|\W)(?:var|let|const)\s+h\s*=\s*[^;]+/g) || [];
    assert.strictEqual(
      decls.length,
      1,
      'expected exactly one `h` declaration inside buildPdfHtml, found ' + decls.length + ': ' + JSON.stringify(decls)
    );
    assert.match(
      decls[0],
      /const\s+h\s*=\s*esc/,
      'the only `h` declaration in buildPdfHtml must be `const h = esc`'
    );
  });

  it('the stationVisits IIFE uses `visitHtml` (not `h`) as its accumulator', () => {
    // The post-fix shape: `var visitHtml = '';` followed by `visitHtml += ...`
    // and `return visitHtml;`. Any reappearance of `var h = ''` here is the
    // exact regression we're guarding against.
    assert.ok(
      buildPdfHtmlBody.includes('var visitHtml'),
      'stationVisits accumulator should be named visitHtml'
    );
    assert.ok(
      !/var\s+h\s*=\s*['"]['"]/i.test(buildPdfHtmlBody),
      'must not reintroduce `var h = ""` inside buildPdfHtml'
    );
  });
});

describe('documents-screen.js routes attendance_note through getPdfBuilderForData', () => {
  it('uses window.getPdfBuilderForData(data) for record-specific builder selection', () => {
    // documents-screen.js used to call getActivePdfBuilder(), which inspects
    // the *currently loaded* formData global rather than the record being
    // generated. That meant generating a custody-note PDF while looking at a
    // telephone matter (or vice versa) silently used the wrong template.
    // The fix is to call getPdfBuilderForData(data) with the record's own data.
    assert.ok(
      docScreenJs.includes("case 'attendance_note':"),
      'documents-screen.js must handle attendance_note'
    );
    assert.ok(
      docScreenJs.includes('window.getPdfBuilderForData(data)'),
      'attendance_note must build via window.getPdfBuilderForData(data)'
    );
  });
});

describe('window exposure of PDF builders (so documents-screen can reach them)', () => {
  const exposures = [
    'window.getPdfBuilderForData = getPdfBuilderForData',
    'window.buildPdfHtml = buildPdfHtml',
    'window.buildVoluntaryPdfHtml = buildVoluntaryPdfHtml',
    'window.buildTelephonePdfHtml = buildTelephonePdfHtml',
  ];
  exposures.forEach(function (line) {
    it('app.js exposes ' + line.split(' = ')[0], () => {
      assert.ok(appJs.includes(line), 'expected app.js to contain: ' + line);
    });
  });
});

describe('Police Station Attendance Note PDF — defence summary and outcome fields', () => {
  const buildPdfHtmlBody = sliceFunction(
    appJs,
    'function buildPdfHtml(',
    'function buildTelephonePdfHtml('
  );

  it('section 8 uses derived defence summary fields', () => {
    assert.match(buildPdfHtmlBody, /getDefenceSummaryFields\(d\)/);
    assert.match(buildPdfHtmlBody, /row\('Outcome code', f\.outcomeCode\)/);
    assert.match(buildPdfHtmlBody, /row\('Next date', f\.nextDate\)/);
    assert.match(buildPdfHtmlBody, /row\('Next venue', f\.nextVenue\)/);
    assert.match(buildPdfHtmlBody, /row\('Interview position', f\.interviewPosition\)/);
    assert.match(buildPdfHtmlBody, /row\('Headline advice', f\.headlineAdvice\)/);
  });

  it('section 11 always includes privacy notice and applicant declaration calls', () => {
    assert.match(buildPdfHtmlBody, /laaPrivacyNoticePdfHtml\(h\)/);
    assert.match(buildPdfHtmlBody, /laaOnlineApplicantDeclarationPdfHtml\(h\)/);
    assert.ok(
      !buildPdfHtmlBody.includes('if (!laaRows && !hasSig && !laaPrivacyNoticePdfHtml(h)'),
      'custody PDF must not skip entire LAA Declaration when fields are empty'
    );
  });
});
