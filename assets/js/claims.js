/* ============================================================================
 * PDClaims — the rules a contracts & claims figure is derived by, in ONE place.
 *
 * ⚠️⚠️ WHY THIS FILE EXISTS. The same four rules were already written twice —
 * `ccRow` in dashboard.html (the project dashboard panel) and `ccBlock` in
 * contracts-claims/module.js (the register's own band) — and the portfolio
 * rebuild was about to be the third. Every previous time this repo let that
 * happen, the copies drifted and the one that drifted was the one nobody was
 * looking at: three location normalisers (one matched a 13th-floor leaf to
 * "3rd Floor"), the S-curve maths hand-copied into portfolio-overview, the
 * change-order insert.
 *
 * ⚠️ IT IS RULES, NOT A RENDERER, AND IT HOLDS NO STATE. The two existing
 * callers read different SHAPES — the project dashboard reads server-side
 * aggregates declared in config.js (`m.coSub`), the register reads rows — so
 * this exposes both a scalar form and a row form of each rule rather than
 * forcing one caller to reshape its data to suit the other.
 *
 * The four rules, and why each is what it is:
 *
 *  1. DECIDED = Approved + Disapproved. Cancelled is NOT decided — a withdrawn
 *     claim was never adjudicated — and Pending obviously is not.
 *  2. RECOVERY is measured over decided records ONLY. Dividing by everything
 *     submitted counts still-pending claims as failures, which on a young
 *     register reads as a catastrophic ~0% when the client simply has not ruled.
 *  3. SHORTFALL is clamped at 0. An approval ABOVE what was submitted is a
 *     data-entry question, not a credit, and a negative "−₱2.1M disputed" cell
 *     reads as money owed to us.
 *  4. AGING is derived, never stored — a stored aging is wrong the next morning.
 *     It is null once decided, null if never submitted, and never negative.
 *
 * ⚠️ MONEY AND DAYS ARE NEVER MIXED. Claims and change orders carry `*_amount`,
 * EOT carries `*_days`, and they are separate column sets in the schema
 * precisely so no one can sum pesos and calendar days into one total. Every
 * function here takes the key pair from its caller rather than guessing.
 * ========================================================================== */
window.PDClaims = (function () {
  'use strict';

  var PENDING = 'Pending', APPROVED = 'Approved', DISAPPROVED = 'Disapproved';

  function statusOf(r) { return String((r && r.status) || '').trim(); }
  function isPending(r) { return statusOf(r) === PENDING; }
  function isApproved(r) { return statusOf(r) === APPROVED; }
  function isDisapproved(r) { return statusOf(r) === DISAPPROVED; }
  /* Rule 1. */
  function isDecided(r) { var s = statusOf(r); return s === APPROVED || s === DISAPPROVED; }
  function decided(rows) { return (rows || []).filter(isDecided); }
  function pending(rows) { return (rows || []).filter(isPending); }

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function sum(rows, key) {
    return (rows || []).reduce(function (a, r) { return a + n(r && r[key]); }, 0);
  }

  /* Rule 3, scalar — for the project dashboard, which holds totals not rows. */
  function shortfall(decSub, decAppr) { return Math.max(0, n(decSub) - n(decAppr)); }
  /* Rule 3, rows. ⚠️ Over DECIDED rows only, or a pending claim's un-approved
     value would be reported as money the client refused. */
  function shortfallOf(rows, subKey, apprKey) {
    var d = decided(rows);
    return shortfall(sum(d, subKey), sum(d, apprKey));
  }

  /* Rule 2, scalar. Null (not 0) when nothing has been decided — "we recover
     0%" and "nothing has been ruled on yet" are opposite facts. */
  function recovery(decSub, decAppr) {
    var s = n(decSub);
    return s ? (n(decAppr) / s * 100) : null;
  }
  function recoveryOf(rows, subKey, apprKey) {
    var d = decided(rows);
    return recovery(sum(d, subKey), sum(d, apprKey));
  }

  // ---- dates ---------------------------------------------------------------
  /* ⚠️ UTC integer arithmetic, never `new Date(str)`. Parsing a bare date string
     as local time shifts it a day either side of Greenwich — the off-by-one this
     repo has hit in both registers and the drawing importer. Copied from
     contracts-claims' own `daysBetween` so the two cannot disagree. */
  function daysBetween(a, b) {
    if (!a || !b) return null;
    var pa = String(a).slice(0, 10).split('-'), pb = String(b).slice(0, 10).split('-');
    if (pa.length !== 3 || pb.length !== 3) return null;
    var ta = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]), tb = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / 86400000);
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* Rule 4. `today` is injectable so a test is not at the mercy of the clock. */
  function agingOf(r, today) {
    if (!isPending(r) || !r || !r.date_submitted) return null;
    var d = daysBetween(r.date_submitted, today || todayISO());
    return (d != null && d >= 0) ? d : null;
  }

  /* ⚠️ Buckets are inclusive-low / inclusive-high and the last is open-ended, so
     every pending age lands in exactly one. A record pending but never submitted
     has NO age and is counted separately rather than dropped — "we have not sent
     it" is a different problem from "they have not answered", and both are the
     planner's to act on. */
  var AGE_BUCKETS = [
    { key: '0-30',  label: '0–30 days',   lo: 0,  hi: 30 },
    { key: '31-60', label: '31–60 days',  lo: 31, hi: 60 },
    { key: '61-90', label: '61–90 days',  lo: 61, hi: 90 },
    { key: '90+',   label: 'over 90 days', lo: 91, hi: Infinity }
  ];
  function bucketOf(days) {
    if (days == null) return null;
    for (var i = 0; i < AGE_BUCKETS.length; i++) {
      if (days >= AGE_BUCKETS[i].lo && days <= AGE_BUCKETS[i].hi) return AGE_BUCKETS[i].key;
    }
    return null;
  }
  /* The value of a record, taking the first key that carries one. ⚠️ Shared by
     `agingBuckets` and `pendingValue` so a bucket total can never be measured on a
     different basis from the headline figure above it — which it was, until the
     portfolio test caught the two disagreeing by ₱20K on the same screen. */
  function valueOf(r, keys) {
    var list = Array.isArray(keys) ? keys : [keys];
    for (var i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      if (r && r[list[i]] != null) return n(r[list[i]]);
    }
    return 0;
  }

  /* ==== WHAT THE POSITION LOOKED LIKE ON A PAST DATE =========================================
     Owner 2026-09-17, on the Contracts & Claims dashboard: everything on it is a snapshot —
     *"Claims exposure ₱20.70M"* says nothing about whether that is up or down, which is the first
     thing anyone asks. This derives the history from the dates the register ALREADY stores, so it
     needs no new table, no snapshotting job and no migration.

     ⚠️⚠️ A RECORD IS PENDING AT T IF IT HAD BEEN SUBMITTED BY THEN AND NOT YET DECIDED.
     That is the only honest reading of these columns, and it is exactly the same rule `isPending`
     applies to today — walked backwards.
     ⚠️ WHEN a record was decided is `date_approved`, and for a disapproved one that never
     got an approval date, `date_evaluated`. A record whose status is decided but which carries
     NEITHER date is **undatable**: we cannot say when it stopped being pending, so it is excluded
     from the series and COUNTED, the same discipline the ageing band already applies to a pending
     record that was never submitted. Quietly assuming a date would draw a confident wrong line.
     ⚠️ Shortfall accrues at the moment of decision, so it enters the series on the same
     date the record leaves `pending`. Exposure = pending + shortfall, the same pair the dashboard
     and the portfolio ranking use; measuring the trend on a different basis from the headline is
     the mistake `valueOf` exists to prevent. */
  function decidedOn(r) {
    if (!isDecided(r)) return null;
    return r.date_approved || (isDisapproved(r) ? r.date_evaluated : null) || null;
  }
  function exposureAt(rows, iso, valueKey, subKey, apprKey) {
    var pend = 0, short = 0, undated = 0;
    (rows || []).forEach(function (r) {
      if (!r) return;
      var dec = decidedOn(r);
      if (isDecided(r) && !dec) { undated++; return; }
      var sub = r.date_submitted;
      if (!sub || sub > iso) return;                 // not yet with the client on that date
      if (!dec || dec > iso) { pend += valueOf(r, valueKey); return; }
      short += shortfall(n(r[subKey]), n(r[apprKey]));
    });
    return { pending: pend, shortfall: short, total: pend + short, undated: undated };
  }

  /* `months` month-ENDS up to and including the month `today` falls in.
     ⚠️ Month ends, not month starts: a record submitted on the 3rd and decided on the 20th
     of the same month never existed at either month start, and a series built on starts would show
     a flat line through a month that was actually busy. */
  function exposureSeries(rows, months, valueKey, subKey, apprKey, today) {
    var t = today || todayISO();
    var y = +t.slice(0, 4), m = +t.slice(5, 7);
    var out = [], nMonths = months || 12;
    for (var i = nMonths - 1; i >= 0; i--) {
      var yy = y, mm = m - i;
      while (mm <= 0) { mm += 12; yy--; }
      /* Day 0 of the NEXT month is the last day of this one — no month-length table, and February
         in a leap year is the Date object's problem rather than ours. */
      var end = new Date(Date.UTC(yy, mm, 0));
      var iso = end.toISOString().slice(0, 10);
      var at = exposureAt(rows, iso, valueKey, subKey, apprKey);
      at.iso = iso;
      at.label = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mm - 1] +
                 ' ' + String(yy).slice(2);
      out.push(at);
    }
    return out;
  }

  /* Returns one entry per bucket (always all four, so a chart has a stable axis)
     plus `unsent` and `oldest`. `valueKey` may be one key or a LIST tried in order
     — pass the same list `pendingValue` gets, or the bars will not add up to the
     total printed beside them. */
  function agingBuckets(rows, valueKey, today) {
    var t = today || todayISO();
    var out = {}, unsent = 0, unsentVal = 0, oldest = null, total = 0, totalVal = 0;
    /* ⚠️ The ROW, not only the number of days. "oldest 45 days" says there is a problem;
       it does not say which record to go and chase, which is the only action the figure supports.
       Additive — every existing caller reads `oldest` and is untouched. */
    var oldestRow = null;
    AGE_BUCKETS.forEach(function (b) { out[b.key] = { key: b.key, label: b.label, n: 0, value: 0 }; });
    pending(rows).forEach(function (r) {
      var v = valueKey ? valueOf(r, valueKey) : 0;
      var a = agingOf(r, t);
      if (a == null) { unsent++; unsentVal += v; return; }
      var k = bucketOf(a);
      if (!k) return;
      out[k].n++; out[k].value += v;
      total++; totalVal += v;
      if (oldest == null || a > oldest) { oldest = a; oldestRow = r; }
    });
    return {
      buckets: AGE_BUCKETS.map(function (b) { return out[b.key]; }),
      unsent: unsent, unsentValue: unsentVal,
      oldest: oldest, oldestRow: oldestRow, n: total, value: totalVal
    };
  }

  /* How long each hand-off actually takes, averaged over the records that have
     BOTH dates. ⚠️ Per stage, and each stage counts its own population: a record
     evaluated but not yet approved contributes to `toEvaluate` and to nothing
     else. Averaging over all records instead would report a fast client as slow
     purely because some records have not finished.
     ⚠️ Negative spans are DROPPED, not clamped to 0 — a record approved before it
     was submitted is a data-entry error, and folding it in as "0 days" would
     quietly pull the average down and hide it. The count of them is returned. */
  function stageDays(rows, today) {
    var legs = [
      { key: 'toEvaluate', from: 'date_submitted', to: 'date_evaluated', label: 'Submitted → evaluated' },
      { key: 'toApprove',  from: 'date_evaluated', to: 'date_approved',  label: 'Evaluated → decided' },
      { key: 'endToEnd',   from: 'date_submitted', to: 'date_approved',  label: 'Submitted → decided' }
    ];
    var out = { bad: 0 };
    legs.forEach(function (leg) {
      var tot = 0, cnt = 0;
      (rows || []).forEach(function (r) {
        if (!r || !r[leg.from] || !r[leg.to]) return;
        var d = daysBetween(r[leg.from], r[leg.to]);
        if (d == null) return;
        if (d < 0) { out.bad++; return; }
        tot += d; cnt++;
      });
      out[leg.key] = { label: leg.label, days: cnt ? Math.round(tot / cnt) : null, n: cnt };
    });
    return out;
  }

  /* What a pending record is WORTH. ⚠️ The best figure available, in order:
     evaluated (the client has put a number on it) then submitted (ours). Never
     `approved_*` — a pending record has no approved value, and reading one would
     mean the status and the money disagree. */
  function pendingValue(rows, evalKey, subKey) {
    return pending(rows).reduce(function (a, r) { return a + valueOf(r, [evalKey, subKey]); }, 0);
  }

  // ---- record types --------------------------------------------------------
  var T_CONTRACT = 'Contract', T_CLAIM = 'Claim', T_CO = 'Change Order', T_EOT = 'EOT';
  function typeOf(r) { return String((r && r.record_type) || '').trim(); }
  function ofType(rows, t) { return (rows || []).filter(function (r) { return typeOf(r) === t; }); }
  /* Everything that is NOT the contract itself — the things with a pipeline and
     a status. The contract is a different kind of row and has neither. */
  function claimsOnly(rows) { return (rows || []).filter(function (r) { return typeOf(r) !== T_CONTRACT; }); }
  function contractValue(rows) { return sum(ofType(rows, T_CONTRACT), 'amount'); }

  return {
    PENDING: PENDING, APPROVED: APPROVED, DISAPPROVED: DISAPPROVED,
    T_CONTRACT: T_CONTRACT, T_CLAIM: T_CLAIM, T_CO: T_CO, T_EOT: T_EOT,
    AGE_BUCKETS: AGE_BUCKETS,
    statusOf: statusOf, isPending: isPending, isApproved: isApproved,
    isDisapproved: isDisapproved, isDecided: isDecided,
    decided: decided, pending: pending, sum: sum, valueOf: valueOf,
    shortfall: shortfall, shortfallOf: shortfallOf,
    recovery: recovery, recoveryOf: recoveryOf,
    daysBetween: daysBetween, todayISO: todayISO, agingOf: agingOf,
    bucketOf: bucketOf, agingBuckets: agingBuckets,
    stageDays: stageDays, pendingValue: pendingValue,
    typeOf: typeOf, ofType: ofType, claimsOnly: claimsOnly, contractValue: contractValue,
    decidedOn: decidedOn, exposureAt: exposureAt, exposureSeries: exposureSeries
  };
})();
