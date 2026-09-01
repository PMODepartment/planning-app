/* ============================================================================
   PDScurve — the S-curve engine, shared by the S-Curve module and the dashboard.
   ============================================================================
   ⚠️ WHY THIS FILE EXISTS. The curve is derived from `project_schedule` — it IS
      the schedule, re-cut by month — and that derivation is not trivial: two
      bases (duration and cost), a per-activity spread curve, and an SPI-stretched
      forecast finish. It lived only inside modules/s-curve/index.html until
      2026-09-01, when the dashboard needed the same curve. Copying ~150 lines of
      that onto the dashboard is how two screens come to disagree about one
      project's progress, so the engine moved here and BOTH callers use it.

   ⚠️ THE MODULE'S RPC PATH IS PRESERVED, not replaced. `schedule_scurve_agg`
      returns pre-summed month buckets and is much faster than a per-row fetch on
      a large schedule — but it is duration-only by construction. The module still
      calls it and injects the result via `opts.series`; everything downstream of
      that (the forecast, the month walk, the percentages) is shared. The
      dashboard, which is already holding the rows, passes rows and no series.

   ⚠️ CONTRACT: compute() NEVER invents data. A schedule with no cost loaded
      returns {empty:true, noCost:true} rather than a curve of zeroes, because a
      flat line at zero and "nobody has loaded the costs" look identical on a
      chart and mean completely different things.
   ============================================================================ */
(function () {
  'use strict';

  // Columns any caller must select for a rows-based computation. Exported so the
  // two callers cannot drift on the select list — a missing column here does not
  // throw, it silently reads undefined and quietly flattens the curve.
  var COLS = ['id', 'activity_type', 'start_date', 'end_date', 'duration_days',
              'percent_complete', 'actual_start', 'actual_finish', 'planned_cost', 'cost_curve'];

  function pd(v) {
    if (!v) return null;
    // ⚠️ Duck-typed, not `instanceof Date`. This engine is shared, and `instanceof` is per-realm:
    //    a Date handed in from anywhere that is not this exact window — a test harness, a worker,
    //    an iframe — fails the check, falls through to the string branch, and a PINNED forecast
    //    finish silently becomes null. Found by the old-vs-new equivalence run, which passes its
    //    pinned dates in from outside.
    if (typeof v === 'object' && typeof v.getTime === 'function') return isNaN(+v) ? null : v;
    var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function isWbs(r) { return r.activity_type === 'WBS Summary'; }

  /* ⚠️ cdf(0)=0 and cdf(1)=1 for every shape, so a curve moves WHEN the value lands and never HOW
     MUCH: the project total, the final cumulative point and BAC are untouched by the choice.
     ⚠️ An unrecognised value (or null) reads as LINEAR, so a project that has never run the
     migration — and one imported from P6 with its own spelling — draws exactly as it always did. */
  function curveCdf(type, f) {
    if (f <= 0) return 0; if (f >= 1) return 1;
    if (type === 'front') return f * (2 - f);          // density 2(1-f)
    if (type === 'back') return f * f;                 // density 2f
    if (type === 'bell') return f <= 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);  // triangular peak at 0.5
    return f;                                          // linear / unknown / null
  }
  function curveOfRow(a) {
    var k = String(a.cost_curve || '').trim().toLowerCase();
    return (k === 'front' || k === 'back' || k === 'bell') ? k : 'linear';
  }

  /* Duration-weighted base series, per activity. This is the module's own fallback path,
     moved verbatim: a day of work is a day of work, so no spread curve applies. */
  function durSeries(rows) {
    var leaves = rows.filter(function (r) { return !isWbs(r); });
    if (!leaves.length) return null;
    function val(a) {
      if (a.duration_days) return a.duration_days;
      var s = pd(a.start_date), e = pd(a.end_date);
      if (s && e) return (e - s) / 86400000 + 1;
      return 1;
    }
    function done(a) { return val(a) * (Math.max(0, Math.min(100, a.percent_complete || 0)) / 100); }
    var TOT = leaves.reduce(function (s, a) { return s + val(a); }, 0);
    var ds = [], de = [];
    leaves.forEach(function (a) { var s = pd(a.start_date), e = pd(a.end_date); if (s) ds.push(+s); if (e) de.push(+e); });
    if (!ds.length) return null;
    return {
      TOT: TOT, overallDone: leaves.reduce(function (s, a) { return s + done(a); }, 0),
      minDate: new Date(Math.min.apply(null, ds)),
      plannedEnd: new Date(Math.max.apply(null, de.length ? de : ds)),
      nAct: leaves.length,
      plannedAt: function (D) {
        var pv = 0;
        leaves.forEach(function (a) {
          var s = pd(a.start_date), e = pd(a.end_date) || s; if (!s) return;
          var pf = D >= e ? 1 : (D < s ? 0 : (e > s ? (D - s) / (e - s) : 1));
          pv += val(a) * pf;
        });
        return pv;
      },
      actualAt: function (D) {
        var av = 0;
        leaves.forEach(function (a) {
          var aS = pd(a.actual_start || a.start_date), aE = pd(a.actual_finish) || pd(a.end_date) || aS;
          if (!aS) return;
          var af = D >= aE ? 1 : (D < aS ? 0 : (aE > aS ? (D - aS) / (aE - aS) : 1));
          av += done(a) * af;
        });
        return av;
      }
    };
  }

  /* The COST curve: identical maths with money as the weight, and the spread curve applied.
     ⚠️ Activities with NO cost contribute nothing — they are unpriced, not free. Coverage is
     reported (`priced` / `nAct`) rather than left implicit: a curve built from a third of the
     schedule's money looks exactly like a complete one. */
  function costSeries(rows) {
    var leaves = rows.filter(function (r) { return !isWbs(r); });
    if (!leaves.length) return null;
    function val(a) { var c = parseFloat(a.planned_cost); return isFinite(c) && c > 0 ? c : 0; }
    function done(a) { return val(a) * (Math.max(0, Math.min(100, a.percent_complete || 0)) / 100); }
    var TOT = 0, priced = 0, ds = [], de = [], shapes = {};
    leaves.forEach(function (a) {
      var v = val(a);
      if (v > 0) { TOT += v; priced++; var k = curveOfRow(a); shapes[k] = (shapes[k] || 0) + 1; }
      var s = pd(a.start_date), e = pd(a.end_date);
      if (v > 0 && s) ds.push(+s);
      if (v > 0 && e) de.push(+e);
    });
    if (!TOT || !ds.length) return { noCost: true, nAct: leaves.length };
    return {
      TOT: TOT, overallDone: leaves.reduce(function (s, a) { return s + done(a); }, 0),
      minDate: new Date(Math.min.apply(null, ds)),
      plannedEnd: new Date(Math.max.apply(null, de.length ? de : ds)),
      nAct: leaves.length, priced: priced, money: true, shapes: shapes,
      // ⚠️ The elapsed FRACTION is still time; how much money that fraction has delivered is the
      // curve's business, so `pf` goes through curveCdf rather than being used raw.
      plannedAt: function (D) {
        var pv = 0;
        leaves.forEach(function (a) {
          var v = val(a); if (!v) return;
          var s = pd(a.start_date), e = pd(a.end_date) || s; if (!s) return;
          var pf = D >= e ? 1 : (D < s ? 0 : (e > s ? (D - s) / (e - s) : 1));
          pv += v * curveCdf(curveOfRow(a), pf);
        });
        return pv;
      },
      // ⚠️ The EARNED side is curved too, and it has to be: spreading earned value straight-line
      // under a bell-curved plan would manufacture a schedule variance out of the two shapes
      // disagreeing rather than out of anything happening on site.
      actualAt: function (D) {
        var av = 0;
        leaves.forEach(function (a) {
          if (!val(a)) return;
          var aS = pd(a.actual_start || a.start_date), aE = pd(a.actual_finish) || pd(a.end_date) || aS;
          if (!aS) return;
          var af = D >= aE ? 1 : (D < aS ? 0 : (aE > aS ? (D - aS) / (aE - aS) : 1));
          av += done(a) * curveCdf(curveOfRow(a), af);
        });
        return av;
      }
    };
  }

  /* Reports the MIX rather than a single word. A schedule is routinely part-curved, and a note
     reading "bell" over a project where three activities out of 300 are bell-shaped would be a
     confident wrong answer about the whole curve. */
  function shapeNote(sh) {
    var LBL = { linear: 'linear', front: 'front-loaded', back: 'back-loaded', bell: 'bell' };
    var ks = Object.keys(sh || {}).filter(function (k) { return sh[k] > 0; });
    if (!ks.length) return 'straight-line';
    if (ks.length === 1 && ks[0] === 'linear')
      return 'straight-line (no spread curve set yet — choose one per activity in Project Schedule → Cost Loading → Spread over time)';
    ks.sort(function (a, b) { return sh[b] - sh[a]; });
    return 'by their spread curves (' + ks.map(function (k) { return sh[k] + ' ' + LBL[k]; }).join(', ') + ')';
  }

  /* compute(rows, opts)
       opts.basis          'dur' (default) | 'cost'
       opts.forecastFinish Date | null — a pinned finish overrides the SPI projection
       opts.series         an already-built base series (the module's RPC aggregate), which
                           short-circuits the per-row work. Same shape as durSeries() returns. */
  function compute(rows, opts) {
    opts = opts || {};
    var base = opts.series || (opts.basis === 'cost' ? costSeries(rows || []) : durSeries(rows || []));
    // ⚠️ A distinct state from "empty": the schedule is fine, the LOADING has not been done.
    // Saying "no dated activities" there would send a planner to fix a schedule that is correct.
    if (base && base.noCost) return { empty: true, noCost: true, nAct: base.nAct };
    if (!base) return { empty: true };
    var TOT = base.TOT, overallDone = base.overallDone, plannedEnd = base.plannedEnd, minDate = base.minDate;
    var plannedAt = base.plannedAt, actualAt = base.actualAt;
    if (!TOT || !minDate || !plannedEnd) return { empty: true };

    var tnow = opts.today ? pd(opts.today) : today();
    // Performance-based (SPI) forecast finish: SPI = actual% ÷ planned% at the data date; the
    // remaining planned duration is stretched by 1/SPI (behind → later finish). A pinned date
    // overrides; the timeline extends to cover whichever is later.
    var pctNow = TOT ? overallDone / TOT * 100 : 0;
    var plPctNow = TOT ? plannedAt(tnow) / TOT * 100 : 0;
    var spi = plPctNow > 0 ? pctNow / plPctNow : 1;
    spi = Math.max(0.1, Math.min(spi, 3));
    var remMs = Math.max(0, +plannedEnd - +tnow);
    var autoFc = pctNow >= 100 ? tnow : new Date(+tnow + remMs / spi);
    var manual = !!opts.forecastFinish;
    var fc = manual ? pd(opts.forecastFinish) : autoFc;
    var domainMax = new Date(Math.max(+plannedEnd, +tnow, +fc));

    var months = [], c = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (c <= domainMax) { months.push(new Date(c)); c = new Date(c.getFullYear(), c.getMonth() + 1, 1); }
    function monthEnd(m) { return new Date(m.getFullYear(), m.getMonth() + 1, 0); }

    var plannedC = months.map(function (m) { return plannedAt(monthEnd(m)); });
    var ti = -1;
    for (var i = 0; i < months.length; i++) { if (monthEnd(months[i]) >= tnow) { ti = i; break; } }
    if (ti < 0) ti = months.length - 1;
    // Actual only up to the data date; anchor the current month to true overall % complete.
    var actualC = months.map(function (m, idx) { return idx < ti ? actualAt(monthEnd(m)) : 0; });
    actualC[ti] = overallDone;
    // Forecast to finish: follow the remaining plan's shape, time-stretched to fc, from the
    // actual point up to 100%. null before the data date — a forecast of the past is a claim
    // about history, and history is what `actual` is for.
    var forecastC = months.map(function () { return null; });
    var rem = TOT - plannedC[ti];
    if (fc && actualC[ti] < TOT && rem > 0.0001) {
      var fcSpan = +fc - +tnow;
      forecastC[ti] = actualC[ti];
      for (var fj = ti + 1; fj < months.length; fj++) {
        var mE = monthEnd(months[fj]);
        if (fcSpan <= 0) { forecastC[fj] = TOT; continue; }
        var realFrac = (+mE - +tnow) / fcSpan;
        if (realFrac <= 0) { forecastC[fj] = actualC[ti]; continue; }
        if (realFrac >= 1) { forecastC[fj] = TOT; continue; }
        var planDate = new Date(+tnow + realFrac * (+plannedEnd - +tnow));
        var valFrac = Math.min(1, Math.max(0, (plannedAt(planDate) - plannedC[ti]) / rem));
        forecastC[fj] = actualC[ti] + valFrac * (TOT - actualC[ti]);
      }
    }
    var plannedPct = TOT ? plannedC[ti] / TOT * 100 : 0;
    var actualPct = TOT ? actualC[ti] / TOT * 100 : 0;
    var overallPct = TOT ? overallDone / TOT * 100 : 0;
    return {
      empty: false, months: months, plannedC: plannedC, actualC: actualC, forecastC: forecastC,
      TOT: TOT, plannedPct: plannedPct, actualPct: actualPct, overallPct: overallPct,
      variance: actualPct - plannedPct, ti: ti, activities: base.nAct, plannedEnd: plannedEnd,
      fcFinish: fc, autoFc: autoFc, spi: spi, manual: manual,
      money: !!base.money, priced: base.priced || 0, shapes: base.shapes || null
    };
  }

  window.PDScurve = {
    COLS: COLS,
    pd: pd, today: today, isWbs: isWbs,
    curveCdf: curveCdf, curveOfRow: curveOfRow,
    durSeries: durSeries, costSeries: costSeries,
    shapeNote: shapeNote, compute: compute
  };
})();
