/**
 * station-visits.js — multiple same-day station visits on one attendance (pure helpers + migration).
 * Used by app.js for aggregation, PDF, and validation. Unit-tested without the full app.
 */
(function (global) {
  'use strict';

  function emptyVisit() {
    return {
      label: '',
      timeSetOff: '',
      timeArrival: '',
      timeDeparture: '',
      timeOfficeHome: '',
      waitingTimeStart: '',
      waitingTimeEnd: '',
      waitingTimeNotes: '',
      milesClaimable: '',
      parkingCost: '',
      notes: '',
      multiClient: '',
      clientStartTime: '',
      clientEndTime: ''
    };
  }

  /**
   * For visits where the user dealt with more than one client during the same trip,
   * the on-station window for THIS client's billing is clientStartTime..clientEndTime.
   * Travel out and travel back are NOT substituted (the actual journey times still apply).
   * Returns the effective on-site arrival / departure to use when computing the on-site
   * (advice + waiting) buckets for this visit.
   */
  function getVisitOnSiteArrival(v) {
    if (!v) return '';
    if (v.multiClient === 'Yes' && v.clientStartTime) return String(v.clientStartTime);
    return v.timeArrival ? String(v.timeArrival) : '';
  }
  function getVisitOnSiteDeparture(v) {
    if (!v) return '';
    if (v.multiClient === 'Yes' && v.clientEndTime) return String(v.clientEndTime);
    return v.timeDeparture ? String(v.timeDeparture) : '';
  }

  function _timeToMins(t) {
    if (!t || typeof t !== 'string') return NaN;
    var p = t.split(':');
    if (p.length < 2) return NaN;
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return NaN;
    return h * 60 + m;
  }
  function _minsToHHMM(m) {
    var x = m % 1440;
    if (x < 0) x += 1440;
    var hh = Math.floor(x / 60);
    var mm = x % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /**
   * Intersect [ws,we] with the on-station client window [winStart,winEnd] for waiting minutes.
   * When multiClient, winStart/End are client start/finish; otherwise they match arrival/departure.
   */
  function clipWaitingToOnSite(ws, we, winStart, winEnd) {
    if (!ws || !we || !winStart || !winEnd) return { start: '', end: '' };
    var w1 = _timeToMins(ws);
    var w2 = _timeToMins(we);
    var a = _timeToMins(winStart);
    var b = _timeToMins(winEnd);
    if ([w1, w2, a, b].some(isNaN)) return { start: ws, end: we };
    if (w2 < w1) w2 += 1440;
    if (b < a) b += 1440;
    var lo = Math.max(w1, a);
    var hi = Math.min(w2, b);
    if (hi <= lo) return { start: '', end: '' };
    return { start: _minsToHHMM(lo), end: _minsToHHMM(hi) };
  }

  /**
   * Returns a fresh array sorted by timeSetOff ascending; blank set-off times go last.
   * Stable: preserves original index order on ties so the user-facing visit numbering
   * (which mirrors disbursements[].visitIndex) does not jump around for equal times.
   */
  function sortVisitsChronologically(visits) {
    if (!Array.isArray(visits)) return [];
    var indexed = visits.map(function (v, i) { return { v: v, i: i }; });
    indexed.sort(function (a, b) {
      var at = (a.v && a.v.timeSetOff) ? String(a.v.timeSetOff).trim() : '';
      var bt = (b.v && b.v.timeSetOff) ? String(b.v.timeSetOff).trim() : '';
      if (!at && !bt) return a.i - b.i;
      if (!at) return 1;
      if (!bt) return -1;
      if (at === bt) return a.i - b.i;
      return at < bt ? -1 : 1;
    });
    return indexed.map(function (x) { return x.v; });
  }

  /**
   * Split a time span into social (09:30–17:30 weekday) and unsocial minutes.
   * Mirrors app.js splitSocialUnsocial for consistent billing.
   */
  function splitSocialUnsocial(startTime, endTime, isWeekendBH, crossesMidnight) {
    if (!startTime || !endTime) return { social: 0, unsocial: 0 };
    var sh = Number(startTime.split(':')[0]);
    var sm = Number(startTime.split(':')[1]);
    var eh = Number(endTime.split(':')[0]);
    var em = Number(endTime.split(':')[1]);
    var startMins = sh * 60 + sm;
    var endMins = eh * 60 + em;
    if (crossesMidnight === true) {
      if (endMins <= startMins) endMins += 1440;
    } else {
      if (endMins < startMins) endMins += 1440;
    }
    if (endMins === startMins && !crossesMidnight) return { social: 0, unsocial: 0 };
    var social = 0;
    var unsocial = 0;
    for (var m = startMins; m < endMins; m++) {
      var hh = m % 1440;
      if (isWeekendBH || hh < 570 || hh >= 1050) unsocial++;
      else social++;
    }
    return { social: social, unsocial: unsocial };
  }

  function migrateLegacyToVisits(d) {
    if (!d || typeof d !== 'object') return;
    if (Array.isArray(d.stationVisits) && d.stationVisits.length > 0) return;
    var v = emptyVisit();
    v.timeSetOff = d.timeSetOff != null ? String(d.timeSetOff) : '';
    v.timeArrival = d.timeArrival != null ? String(d.timeArrival) : '';
    v.timeDeparture = d.timeDeparture != null ? String(d.timeDeparture) : '';
    v.timeOfficeHome = d.timeOfficeHome != null ? String(d.timeOfficeHome) : '';
    v.waitingTimeStart = d.waitingTimeStart != null ? String(d.waitingTimeStart) : '';
    v.waitingTimeEnd = d.waitingTimeEnd != null ? String(d.waitingTimeEnd) : '';
    v.waitingTimeNotes = d.waitingTimeNotes != null ? String(d.waitingTimeNotes) : '';
    if (d.milesClaimable != null && d.milesClaimable !== '') {
      v.milesClaimable = String(d.milesClaimable);
    }
    if (d.parkingCost != null && d.parkingCost !== '') {
      v.parkingCost = String(d.parkingCost);
    }
    d.stationVisits = [v];
  }

  function ensureStationVisits(d) {
    if (!d || typeof d !== 'object') return;
    migrateLegacyToVisits(d);
    if (!Array.isArray(d.stationVisits) || d.stationVisits.length === 0) {
      d.stationVisits = [emptyVisit()];
    }
  }

  function parseNum(x) {
    var n = parseFloat(x);
    return isNaN(n) ? 0 : n;
  }

  /** Sum per-visit miles; falls back to legacy flat miles when single visit and visit miles empty. */
  function sumVisitMiles(visits, legacyMiles) {
    if (!visits || !visits.length) return parseNum(legacyMiles);
    var sum = 0;
    var any = false;
    for (var i = 0; i < visits.length; i++) {
      var m = visits[i] && visits[i].milesClaimable;
      if (m !== undefined && m !== null && String(m).trim() !== '') {
        sum += parseNum(m);
        any = true;
      }
    }
    if (any) return sum;
    if (visits.length === 1) return parseNum(legacyMiles);
    return parseNum(legacyMiles);
  }

  function sumVisitParking(visits, legacyParking) {
    if (!visits || !visits.length) return parseNum(legacyParking);
    var sum = 0;
    var any = false;
    for (var i = 0; i < visits.length; i++) {
      var p = visits[i] && visits[i].parkingCost;
      if (p !== undefined && p !== null && String(p).trim() !== '') {
        sum += parseNum(p);
        any = true;
      }
    }
    if (any) return sum;
    if (visits.length === 1) return parseNum(legacyParking);
    return parseNum(legacyParking);
  }

  /**
   * Writes legacy flat keys from stationVisits for exports and older code paths.
   */
  function syncLegacyMirror(d) {
    if (!d || !Array.isArray(d.stationVisits) || !d.stationVisits.length) return;
    var vis = d.stationVisits;
    var first = vis[0] || emptyVisit();
    var last = vis[vis.length - 1] || first;
    d.timeSetOff = first.timeSetOff != null ? String(first.timeSetOff) : '';
    d.timeArrival = first.timeArrival != null ? String(first.timeArrival) : '';
    d.timeDeparture = last.timeDeparture != null ? String(last.timeDeparture) : '';
    d.timeOfficeHome = last.timeOfficeHome != null ? String(last.timeOfficeHome) : '';
    if (vis.length === 1) {
      d.waitingTimeStart = first.waitingTimeStart != null ? String(first.waitingTimeStart) : '';
      d.waitingTimeEnd = first.waitingTimeEnd != null ? String(first.waitingTimeEnd) : '';
      d.waitingTimeNotes = first.waitingTimeNotes != null ? String(first.waitingTimeNotes) : '';
    } else {
      d.waitingTimeStart = '';
      d.waitingTimeEnd = '';
      d.waitingTimeNotes = '';
    }
    d.multipleJourneys = vis.length > 1 ? 'Yes' : (d.multipleJourneys || 'No');
    d.numAttendances = vis.length;
    var totalMiles = sumVisitMiles(vis, d.milesClaimable);
    d.milesClaimable = totalMiles > 0 ? String(totalMiles) : (d.milesClaimable != null ? String(d.milesClaimable) : '');
    var totalPark = sumVisitParking(vis, d.parkingCost);
    d.parkingCost = totalPark > 0 ? String(totalPark) : (d.parkingCost != null ? String(d.parkingCost) : '');
  }

  function getEarliestStationArrival(d) {
    ensureStationVisits(d);
    var best = '';
    (d.stationVisits || []).forEach(function (v) {
      var t = (v && v.timeArrival) ? String(v.timeArrival).trim() : '';
      if (!t) return;
      if (!best || t < best) best = t;
    });
    return best || (d.timeArrival || '').trim();
  }

  function getEffectiveTimeArrival(d) {
    ensureStationVisits(d);
    var v0 = d.stationVisits && d.stationVisits[0];
    if (v0 && v0.timeArrival) return String(v0.timeArrival).trim();
    return (d.timeArrival || '').trim();
  }

  /**
   * Per-visit buckets (travel, waiting, advice) using client window for on-site + clipped waiting
   * when "more than one client" (multiClient) is set. Travel out/back always use real journey times.
   */
  function getVisitBucketContribution(v, isWBH) {
    if (!v) {
      return {
        travelSocial: 0, travelUnsocial: 0, waitingSocial: 0, waitingUnsocial: 0,
        adviceSocial: 0, adviceUnsocial: 0, onSiteSpanMins: 0, travelMins: 0, waitMins: 0, adviceMins: 0
      };
    }
    var travelSocial = 0;
    var travelUnsocial = 0;
    if (v.timeSetOff && v.timeArrival) {
      var o = splitSocialUnsocial(v.timeSetOff, v.timeArrival, isWBH);
      travelSocial += o.social;
      travelUnsocial += o.unsocial;
    }
    if (v.timeDeparture && v.timeOfficeHome) {
      var r = splitSocialUnsocial(v.timeDeparture, v.timeOfficeHome, isWBH);
      travelSocial += r.social;
      travelUnsocial += r.unsocial;
    }
    var onArr = getVisitOnSiteArrival(v);
    var onDep = getVisitOnSiteDeparture(v);
    var effWS = v.waitingTimeStart;
    var effWE = v.waitingTimeEnd;
    if (v.waitingTimeStart && v.waitingTimeEnd && onArr && onDep) {
      var clip = clipWaitingToOnSite(v.waitingTimeStart, v.waitingTimeEnd, onArr, onDep);
      effWS = clip.start;
      effWE = clip.end;
    }
    var waitingSocial = 0;
    var waitingUnsocial = 0;
    if (effWS && effWE) {
      var wk = splitSocialUnsocial(effWS, effWE, isWBH);
      waitingSocial = wk.social;
      waitingUnsocial = wk.unsocial;
    }
    var adviceSocial = 0;
    var adviceUnsocial = 0;
    if (onArr && onDep) {
      var station = splitSocialUnsocial(onArr, onDep, isWBH);
      var wSoc = 0;
      var wUns = 0;
      if (effWS && effWE) {
        var wPart = splitSocialUnsocial(effWS, effWE, isWBH);
        wSoc = wPart.social;
        wUns = wPart.unsocial;
      }
      adviceSocial = Math.max(0, station.social - wSoc);
      adviceUnsocial = Math.max(0, station.unsocial - wUns);
    }
    var onSiteSpanMins = 0;
    if (onArr && onDep) {
      var st = splitSocialUnsocial(onArr, onDep, isWBH);
      onSiteSpanMins = st.social + st.unsocial;
    }
    return {
      travelSocial: travelSocial,
      travelUnsocial: travelUnsocial,
      waitingSocial: waitingSocial,
      waitingUnsocial: waitingUnsocial,
      adviceSocial: adviceSocial,
      adviceUnsocial: adviceUnsocial,
      onSiteSpanMins: onSiteSpanMins,
      travelMins: travelSocial + travelUnsocial,
      waitMins: waitingSocial + waitingUnsocial,
      adviceMins: adviceSocial + adviceUnsocial
    };
  }

  /**
   * Returns aggregate minute buckets matching app.js autoCalcTimes semantics (summed across visits).
   */
  function aggregateMinuteBuckets(visits, isWBH) {
    var travelSocial = 0;
    var travelUnsocial = 0;
    var waitingSocial = 0;
    var waitingUnsocial = 0;
    var adviceSocial = 0;
    var adviceUnsocial = 0;
    (visits || []).forEach(function (v) {
      var c = getVisitBucketContribution(v, isWBH);
      travelSocial += c.travelSocial;
      travelUnsocial += c.travelUnsocial;
      waitingSocial += c.waitingSocial;
      waitingUnsocial += c.waitingUnsocial;
      adviceSocial += c.adviceSocial;
      adviceUnsocial += c.adviceUnsocial;
    });
    return {
      travelSocial: travelSocial,
      travelUnsocial: travelUnsocial,
      waitingSocial: waitingSocial,
      waitingUnsocial: waitingUnsocial,
      adviceSocial: adviceSocial,
      adviceUnsocial: adviceUnsocial
    };
  }

  global.StationVisits = {
    emptyVisit: emptyVisit,
    splitSocialUnsocial: splitSocialUnsocial,
    migrateLegacyToVisits: migrateLegacyToVisits,
    ensureStationVisits: ensureStationVisits,
    syncLegacyMirror: syncLegacyMirror,
    sumVisitMiles: sumVisitMiles,
    sumVisitParking: sumVisitParking,
    getEarliestStationArrival: getEarliestStationArrival,
    getEffectiveTimeArrival: getEffectiveTimeArrival,
    aggregateMinuteBuckets: aggregateMinuteBuckets,
    sortVisitsChronologically: sortVisitsChronologically,
    getVisitOnSiteArrival: getVisitOnSiteArrival,
    getVisitOnSiteDeparture: getVisitOnSiteDeparture,
    getVisitBucketContribution: getVisitBucketContribution,
    clipWaitingToOnSite: clipWaitingToOnSite
  };
})(typeof window !== 'undefined' ? window : globalThis);
