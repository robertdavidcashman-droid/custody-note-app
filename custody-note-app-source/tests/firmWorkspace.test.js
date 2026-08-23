const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliseFirmWorkspace,
  addSeat,
  removeSeat,
  addSharedTemplate,
  canAddSeat,
} = require('../main/firmWorkspace');

describe('firmWorkspace', () => {
  it('normalises empty workspace', () => {
    const ws = normaliseFirmWorkspace({});
    assert.equal(ws.firmName, '');
    assert.equal(ws.seatLimit, 5);
    assert.deepEqual(ws.seats, []);
    assert.deepEqual(ws.sharedTemplates, []);
  });

  it('adds and removes seats with validation', () => {
    let ws = normaliseFirmWorkspace({ seatLimit: 2 });
    const bad = canAddSeat(ws, 'not-an-email');
    assert.equal(bad.ok, false);
    const a = addSeat(ws, 'a@firm.test', 'admin');
    assert.equal(a.ok, true);
    ws = a.workspace;
    assert.equal(ws.seats.length, 1);
    assert.equal(ws.seats[0].role, 'admin');
    const b = addSeat(ws, 'b@firm.test', 'member');
    assert.equal(b.ok, true);
    ws = b.workspace;
    const over = addSeat(ws, 'c@firm.test', 'member');
    assert.equal(over.ok, false);
    const rm = removeSeat(ws, 'a@firm.test');
    assert.equal(rm.ok, true);
    assert.equal(rm.workspace.seats.length, 1);
  });

  it('adds shared templates', () => {
    const res = addSharedTemplate({}, 'Standard advice', 'Body text');
    assert.equal(res.ok, true);
    assert.equal(res.workspace.sharedTemplates.length, 1);
    assert.equal(res.template.name, 'Standard advice');
  });
});
