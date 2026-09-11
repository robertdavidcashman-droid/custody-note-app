/**
 * Unit tests for Annex A police-station PDF parse helpers.
 * Guards against nameless IDs being dropped and continued headings / footnotes
 * gluing into station or scheme labels.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  cleanSchemeName,
  stripContinuedHeading,
  resolveStationName,
  buildStationRecord,
} = require('../data/parse-stations.js');

describe('parse-stations helpers', () => {
  it('cleanSchemeName strips Llanelli transitional footnote', () => {
    const dirty =
      'Llanelli These Police Station ID codes must be used for Matters starting before 16/11/2023 and on or after 06/12/2024 in the Llanelli Police Station Scheme.';
    assert.strictEqual(cleanSchemeName(dirty), 'Llanelli');
  });

  it('cleanSchemeName fixes Sedgemore / Taunton Dane OCR typo', () => {
    assert.strictEqual(cleanSchemeName('Sedgemore / Taunton Dane'), 'Sedgemoor / Taunton Deane');
  });

  it('stripContinuedHeading removes Central London (Contd) leftovers', () => {
    assert.strictEqual(
      stripContinuedHeading('Central London (Contd) Tottenham Court Road'),
      'Tottenham Court Road'
    );
    assert.strictEqual(
      stripContinuedHeading('Central London (contd.) Tottenham Court Road'),
      'Tottenham Court Road'
    );
  });

  it('resolveStationName inherits previous name for nameless Annex A IDs (MA100)', () => {
    assert.strictEqual(resolveStationName('', { lastStationName: 'Great Broughton' }), 'Great Broughton');
    assert.strictEqual(
      resolveStationName('  ', { lastStationName: 'Great Broughton', currentScheme: 'Whitehaven / Workington' }),
      'Great Broughton'
    );
  });

  it('buildStationRecord keeps nameless IDs with inherited name and cleaned scheme', () => {
    const rec = buildStationRecord('MA100', '', {
      currentScheme: 'Whitehaven / Workington',
      currentSchemeCode: '6007',
      lastStationName: 'Great Broughton',
    });
    assert.ok(rec);
    assert.strictEqual(rec.code, 'MA100');
    assert.strictEqual(rec.name, 'Great Broughton');
    assert.strictEqual(rec.scheme, 'Whitehaven / Workington');
    assert.strictEqual(rec.schemeCode, '6007');
    assert.strictEqual(rec.kind, 'station');
  });

  it('buildStationRecord does not drop empty-name IDs when prior name or scheme exists', () => {
    assert.strictEqual(
      buildStationRecord('MA100', '', { currentSchemeCode: '6007' }),
      null,
      'without name/scheme inheritance there is no usable name'
    );
    assert.ok(
      buildStationRecord('MA100', '', {
        currentScheme: 'Whitehaven / Workington',
        currentSchemeCode: '6007',
        lastStationName: 'Great Broughton',
      }),
      'with inheritance the ID is stored'
    );
  });
});
