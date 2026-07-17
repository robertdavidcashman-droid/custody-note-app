'use strict';

/**
 * CRM1 HTML preview ethnicity/disability ticks must follow LAA numeric codes
 * stored on the attendance record (ethnicOriginCode), not legacy label strings.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const laaForms = require('../renderer/laa-forms.js');

const laaFormsSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'laa-forms.js'), 'utf8');

function tickedNearLabel(html, label) {
  const re = new RegExp('laa-cb laa-cb-ticked[^<]*</span>\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return re.test(html);
}

describe('CRM1 HTML preview — ethnicity codes', () => {
  it('uses hasLaaCode helper for numeric LAA codes', () => {
    assert.match(laaFormsSrc, /function hasLaaCode\(/);
    assert.match(laaFormsSrc, /hasLaaCode\(eth, '06'/);
  });

  it('ticks Indian when ethnicOriginCode is 06 (Asian or Asian British Indian)', () => {
    const html = laaForms.buildCRM1({ surname: 'Patel', ethnicOriginCode: '06' });
    assert.ok(tickedNearLabel(html, 'Indian'), 'Indian must be ticked for code 06');
    assert.ok(!tickedNearLabel(html, 'British'), 'British must not be ticked for code 06');
  });

  it('ticks White Other when ethnicOriginCode is 14 (not Indian)', () => {
    const html = laaForms.buildCRM1({ surname: 'Popescu', ethnicOriginCode: '14' });
    assert.ok(tickedNearLabel(html, 'White Other'), 'White Other must be ticked for code 14');
    assert.ok(!tickedNearLabel(html, 'Indian'), 'Indian must not be ticked for code 14');
  });

  it('still supports legacy A1 alias for Indian', () => {
    const html = laaForms.buildCRM1({ surname: 'Patel', ethnicOriginCode: 'A1' });
    assert.ok(tickedNearLabel(html, 'Indian'), 'legacy A1 must tick Indian');
  });

  it('ticks visually impaired when disabilityCode is VIS', () => {
    const html = laaForms.buildCRM1({ surname: 'Test', disabilityCode: 'VIS' });
    assert.ok(tickedNearLabel(html, 'Visually impaired'));
  });
});
