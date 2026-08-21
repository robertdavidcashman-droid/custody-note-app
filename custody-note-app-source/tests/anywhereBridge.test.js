const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isBridgePayload,
  buildBridgeFromAnywhereBackup,
  mapBridgeAttendanceToDesktop,
  BRIDGE_FORMAT,
} = require('../main/anywhereBridge');

describe('anywhereBridge', () => {
  it('builds bridge from Anywhere backup', () => {
    const bridge = buildBridgeFromAnywhereBackup({
      app: 'custodynote-anywhere',
      attendances: [
        {
          id: 'abc',
          attendanceMode: 'custody',
          status: 'draft',
          data: { forename: 'Jo', surname: 'Bloggs' },
        },
      ],
    });
    assert.equal(bridge.format, BRIDGE_FORMAT);
    assert.equal(bridge.version, 1);
    assert.equal(isBridgePayload(bridge), true);
    assert.equal(bridge.attendances[0].anywhereId, 'abc');
  });

  it('maps to desktop draft shape', () => {
    const mapped = mapBridgeAttendanceToDesktop({
      anywhereId: 'x1',
      attendanceMode: 'telephone',
      status: 'completed',
      data: { forename: 'A' },
    });
    assert.equal(mapped.status, 'draft');
    assert.equal(mapped.data._formType, 'telephone');
    assert.equal(mapped.data._importedFromAnywhereId, 'x1');
  });

  it('rejects unrelated JSON', () => {
    assert.equal(isBridgePayload({ format: 'other', version: 1, attendances: [] }), false);
  });
});
