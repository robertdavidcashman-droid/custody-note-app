/**
 * Unit tests for renderer/lib/station-visits.js (multi-visit aggregation & migration).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

require('../renderer/lib/station-visits.js');
const SV = globalThis.StationVisits;
assert.ok(SV, 'StationVisits should load on globalThis');

describe('station-visits', () => {
  it('migrates legacy flat fields into one stationVisits row', () => {
    const d = {
      timeSetOff: '09:00',
      timeArrival: '10:00',
      timeDeparture: '12:00',
      timeOfficeHome: '13:00',
      waitingTimeStart: '10:30',
      waitingTimeEnd: '11:00',
      waitingTimeNotes: 'n',
      milesClaimable: '12',
      parkingCost: '3.50',
    };
    SV.migrateLegacyToVisits(d);
    assert.equal(d.stationVisits.length, 1);
    assert.equal(d.stationVisits[0].timeSetOff, '09:00');
    assert.equal(d.stationVisits[0].timeArrival, '10:00');
    assert.equal(d.stationVisits[0].milesClaimable, '12');
  });

  it('aggregateMinuteBuckets sums two visits (weekday)', () => {
    const visits = [
      {
        timeSetOff: '09:00',
        timeArrival: '10:00',
        timeDeparture: '11:00',
        timeOfficeHome: '11:30',
        waitingTimeStart: '10:15',
        waitingTimeEnd: '10:45',
      },
      {
        timeSetOff: '14:00',
        timeArrival: '14:30',
        timeDeparture: '15:00',
        timeOfficeHome: '15:30',
        waitingTimeStart: '',
        waitingTimeEnd: '',
      },
    ];
    const agg = SV.aggregateMinuteBuckets(visits, false);
    assert.ok(agg.travelSocial + agg.travelUnsocial > 0);
    assert.ok(agg.adviceSocial + agg.adviceUnsocial >= 0);
    assert.ok(agg.waitingSocial + agg.waitingUnsocial > 0);
  });

  it('syncLegacyMirror sets first/last times and numAttendances', () => {
    const d = {
      stationVisits: [
        SV.emptyVisit(),
        SV.emptyVisit(),
      ],
    };
    d.stationVisits[0].timeSetOff = '09:00';
    d.stationVisits[0].timeArrival = '10:00';
    d.stationVisits[1].timeDeparture = '16:00';
    d.stationVisits[1].timeOfficeHome = '17:00';
    SV.syncLegacyMirror(d);
    assert.equal(d.timeSetOff, '09:00');
    assert.equal(d.timeArrival, '10:00');
    assert.equal(d.timeDeparture, '16:00');
    assert.equal(d.timeOfficeHome, '17:00');
    assert.equal(d.numAttendances, 2);
    assert.equal(d.multipleJourneys, 'Yes');
  });

  it('getEarliestStationArrival picks min time string', () => {
    const d = {
      stationVisits: [
        { timeArrival: '14:00' },
        { timeArrival: '09:30' },
      ],
    };
    assert.equal(SV.getEarliestStationArrival(d), '09:30');
  });

  it('multiClient uses client start/finish for on-site and clips waiting to that window', () => {
    const v = {
      timeSetOff: '09:00',
      timeArrival: '10:00',
      timeDeparture: '12:00',
      timeOfficeHome: '12:30',
      multiClient: 'Yes',
      clientStartTime: '10:15',
      clientEndTime: '11:00',
      waitingTimeStart: '10:20',
      waitingTimeEnd: '10:50',
    };
    const c = SV.getVisitBucketContribution(v, false);
    // Client window 45m; waiting fully inside 30m; advice 15m. Travel unchanged (set off → arrival, dep → home).
    assert.equal(c.onSiteSpanMins, 45);
    assert.equal(c.waitMins, 30);
    assert.equal(c.adviceMins, 15);
  });

  it('without multiClient, waiting is clipped to station arrival/departure span', () => {
    const v = {
      timeSetOff: '09:00',
      timeArrival: '10:00',
      timeDeparture: '12:00',
      timeOfficeHome: '12:30',
      waitingTimeStart: '10:00',
      waitingTimeEnd: '12:00',
    };
    const c = SV.getVisitBucketContribution(v, false);
    assert.equal(c.onSiteSpanMins, 120);
    assert.equal(c.waitMins, 120);
    assert.equal(c.adviceMins, 0);
  });
});
