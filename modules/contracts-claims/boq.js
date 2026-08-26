/* BOQ — the client's Bill of Quantities, inside the Contracts & Claims module.
   Implements ROADMAP B1a (revisions + items + import profiles), B1b (class-code
   mapping + suggestion library), B1c (allocation to activities), B1d (billing
   periods → POC + revenue).

   Design note: docs/boq-and-pmi.md. Every ⚠️ here is a MEASURED finding from the
   real OPW101 Package 2 workbook (10 sheets, 1,215 priced lines, 5 billing
   sheets), not a guess. Read those before changing the parser — most of them
   describe a way of being confidently wrong in the money column.

   THE CORE INSIGHT: the format varies not just between clients but between
   SHEETS OF THE SAME WORKBOOK (header row 12/10/7, first column A/B/B). So
   header detection is a SEARCH, never a fixed offset, and the accepted column
   map is saved per sheet as a profile for the next revision.

   Hosted by ContractsClaims (see module.js) the same way ppr.js is hosted by
   progress-photos: this file owns the BOQ tab and nothing else. */
window.BOQ = (function () {
  'use strict';

  var T_REV = 'boq_revisions', T_ITEM = 'boq_items', T_PROF = 'boq_import_profiles',
      T_MAP = 'boq_class_map', T_SUGG = 'boq_class_suggestions', T_ALLOC = 'boq_allocations',
      T_PER = 'boq_billing_periods', T_PROG = 'boq_progress';
  var MIGRATION = 'migrations/2026-08-24-boq.sql';

  var sb = function () { return window.__sb || (window.__sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY)); };
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- state ---------------------------------------------------------------
  var UID = null, canWrite = false, isAdmin = false, pid = null, projLabel = '';
  var REVS = [], REVID = null, ITEMS = [], CMAP = {}, ALLOC = [], PERIODS = [], PROG = {};
  /* CLAIMED progress, period_id -> { item_id: 0..1 }, from
     2026-08-26-boq-claimed-vs-certified.sql. Kept SEPARATE from PROG rather
     than folded into it: PROG is the certified figure every POC, revenue and
     monthly number derives from, and a single map holding both would eventually
     be read by something that bills the wrong one.
     ⚠️ ONLY LINES WITH A STORED CLAIM APPEAR HERE. A missing entry means "not
        separately recorded", i.e. claimed = certified — never zero. */
  var CLAIM = {};
  var CODES = null, ACTS = null;            // lazy: class_codes chart, schedule activities
  /* A3's tail / decision #2. PKGS is this project's `packages` rows, loaded
     tolerantly: the table arrives with 2026-08-19-packages.sql and the column
     with 2026-08-25-package-adoption.sql, and until both are run the BOQ must
     behave exactly as it did before. */
  var PKGS = [];
  /* DESIGN DECISION #7 — "which POC leads a report?"
     ANSWER: neither, because they are not rivals. They are the same work at two
     stages — reported on the programme, then certified by the client — and the
     distance between them is ACCRUED REVENUE, an unbilled receivable. It is
     shown as money, with the gap named, and nothing reconciles one to the other.
     SCHED holds schedule_scurve_agg's output: duration- or cost-weighted
     `percent_complete`, i.e. CONTRACTOR-REPORTED progress. The billing POC on
     this tab is the CERTIFIED one the client pays against.
     ⚠️ Dispute (claimed minus certified) BECAME measurable on 2026-08-26 —
     boq_progress gained rel_pct_claimed beside the certified rel_pct, so the
     accrual splits into "claimed and cut" and "never submitted". Where no claim
     is recorded the line reads claimed = certified, NEVER claimed-zero. */
  var SCHED = null, schedErr = null;
  var sub = 'items';
  var filt = { q: '', sheet: '', kind: '', mapped: '' };
  var loaded = false;

  // ==========================================================================
  // NUMBER / TEXT HELPERS
  // ==========================================================================
  /* ⚠️ The amount column is not always a number. Real values found in
     TOTAL AMOUNT: 'Included in Package 1' (16), 'n/a' (4), 'By Megaworld' (2),
     'Consideration : One side only' (1) — and the Summary sheet carries a
     literal '#REF!', a broken formula in the client's own file. numOf returns
     null for all of those rather than 0: a zero and a "someone else is doing
     this" are different facts, and the import must survive error values. */
  function numOf(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s || /^#(ref|value|div\/0|n\/a|name)/i.test(s)) return null;
    // Strip currency symbols, thousands separators and a trailing/leading unit.
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '').replace(/[₱$€£,\s]/g, '');
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }
  function txt(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function norm(s) { return txt(s).toLowerCase(); }
  /* Normalised key for the suggestion library and for location matching:
     lowercase, punctuation dropped, whitespace collapsed. */
  function normKey(s) { return norm(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* Ordinal folding, so "3rd floor" and "third floor" and "3/f" agree. The
     schedule module has a richer locNormKey but it lives inside that module's
     closure and is not reachable from here; this is the subset the BOQ leaves
     actually need. Kept deliberately small — folding too much is how "8th" and
     "18th" get merged. */
  var ORD = { first:'1', second:'2', third:'3', fourth:'4', fifth:'5', sixth:'6', seventh:'7',
              eighth:'8', eight:'8', ninth:'9', nineth:'9', tenth:'10', eleventh:'11', twelfth:'12',
              ground:'g', roof:'roof', basement:'b' };
  function locKey(s) {
    var k = normKey(s);
    k = k.replace(/(\d+)\s*(st|nd|rd|th)\b/g, '$1');
    k = k.replace(/\b([a-z]+)\b/g, function (m, w) { return ORD[w] || w; });
    return k.replace(/\b(floor|flr|level|lvl|storey|story)\b/g, 'floor').replace(/\s+/g, ' ').trim();
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function qtyStr(n) {
    if (n == null || !isFinite(n)) return '';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  function pct(n, dp) { return n == null || !isFinite(n) ? '—' : (n * 100).toFixed(dp == null ? 2 : dp) + '%'; }

  // ==========================================================================
  // PARSER
  // ==========================================================================
  /* ⚠️ Bounded window read, not sheet_to_json. The Drawing Register learned this
     the hard way: a client workbook can declare 16,383 columns, and a full
     sheet_to_json over that dimension allocates ~100M empty cells and freezes
     the tab. Read real cells by reference, cap the columns. */
  function gridOf(ws) {
    if (!ws || !ws['!ref']) return [];
    var MAXC = 80, rng = XLSX.utils.decode_range(ws['!ref']);
    var c0 = rng.s.c, c1 = Math.min(rng.e.c, c0 + MAXC), g = [];
    for (var R = rng.s.r; R <= rng.e.r; R++) {
      var row = [];
      for (var C = c0; C <= c1; C++) {
        var cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        // Prefer the FORMATTED text (cell.w): a date or a rounded rate read as
        // displayed is what the planner is reconciling against, and cell.v on a
        // date is a timezone trap this repo has been bitten by three times.
        row.push(cell ? (cell.w != null ? cell.w : cell.v) : '');
      }
      g.push(row);
    }
    return g;
  }

  /* ⚠️ THE HEADER ROW AND COLUMN OFFSET DIFFER PER SHEET INSIDE ONE FILE
     (Architectural 12/A, HS-SP+IFO+ACOUSTIC 10/B, the four billing twins 7/B).
     So this searches for the header rather than trusting an offset. It requires
     a description-ish column AND one of unit/qty/amount, so a title block
     mentioning "description" in prose cannot be mistaken for the header. */
  function findHeader(g) {
    for (var i = 0; i < Math.min(g.length, 40); i++) {
      var j = g[i].map(norm).join('|');
      if (j.indexOf('description') === -1 && j.indexOf('particular') === -1) continue;
      if (/\bunit\b|\bqty\b|quantity|amount|\bu\/m\b|\buom\b/.test(j)) return i;
    }
    return -1;
  }

  /* Column map. Order matters in two places and both are measured:
     - 'material cost' must be tested before 'material', or the COST column
       claims the RATE slot (the source groups them UNIT COST → MATERIAL |
       MATERIAL COST | LABOR + CONS | LABOR COST | TOTAL AMOUNT).
     - the amount column is 'total amount'; a bare 'amount' also appears in the
       billing groups, so plain 'amount' is only accepted when nothing better
       matched. */
  function colMapOf(H) {
    function find(res, from) {
      for (var c = (from || 0); c < H.length; c++) {
        for (var i = 0; i < res.length; i++) if (res[i].test(H[c])) return c;
      }
      return -1;
    }
    var m = {
      item_no:     find([/^item\b/, /item ?no/, /^no\.?$/, /^ref\b/]),
      description: find([/description/, /particular/]),
      unit:        find([/^unit$/, /^u\/m$/, /^uom$/, /unit of measure/]),
      qty:         find([/^qty$/, /quantit/]),
      mat_amount:  find([/material cost/]),
      lab_amount:  find([/labor cost/, /labour cost/]),
      amount:      find([/total amount/])
    };
    // Rates sit inside the UNIT COST group, BEFORE their cost columns.
    m.mat_rate = find([/^material$/, /^material\b(?! cost)/]);
    m.lab_rate = find([/^labor ?\+/, /^labour ?\+/, /^labor$/, /^labour$/]);
    if (m.amount < 0) m.amount = find([/^amount/, /^total$/]);
    return m;
  }

  /* ⚠️ THE ONLY RELIABLE HEADING DISCRIMINATOR IS THE 'Total of X >>' /
     'Sub-Total of X >>' MARKER, NEVER the presence of unit+qty. A heading can
     carry both (`DIV 5 | METALS | lot | 1`), and using "has unit + qty" as the
     test double-counts an entire sheet's weights: HS-SP then reads
     sum-of-WT% = 2.000000 and a contract of ₱114,410,587.84 against the true
     ₱57,205,293.92. */
  var MARKER_RE = /(^|\s)(sub-?\s*)?total\s+of\b|>>\s*$/i;
  function markerIn(row) {
    for (var c = 0; c < row.length; c++) {
      var s = txt(row[c]);
      if (s && MARKER_RE.test(s)) return s;
    }
    return '';
  }

  /* Billing sheets are the trade BOQ plus ten columns. ⚠️ There are THREE
     Rel/%Wt/Amt groups (Previous, This Period, To Date) and the to-date group is
     the LAST one — it is also the only one preceded by Qty/MATERIALS/LABOR. We
     read only the to-date Rel. %age, because that is the cumulative figure and
     `previous` is derivable as the prior period's to-date (§4.2). */
  function billingColsOf(H) {
    var rel = [], wt = -1;
    for (var c = 0; c < H.length; c++) {
      if (/rel\.? ?%age|rel\.? ?%|relative ?%/.test(H[c])) rel.push(c);
      if (wt < 0 && /^wt ?%/.test(H[c])) wt = c;
    }
    return rel.length ? { rel_todate: rel[rel.length - 1], rel_all: rel, wt: wt } : null;
  }

  /* The sheet's own stated Total Contract/Project Cost. ⚠️ This is the
     reconciliation gate's oracle and it is per SHEET, not per contract:
     Architectural is 87.90% of the contract and ACOUSTIC 1.65%. */
  function statedTotalOf(g) {
    for (var i = g.length - 1; i >= 0 && i > g.length - 400; i--) {
      var j = g[i].map(norm).join(' ');
      if (!/total (contract|project)|contract (cost|amount|price)|project cost/.test(j)) continue;
      for (var c = g[i].length - 1; c >= 0; c--) {
        var n = numOf(g[i][c]);
        if (n != null && Math.abs(n) > 1000) return n;
      }
    }
    return null;
  }

  /* Detect one sheet: role, header, column map, and the line inventory the
     preview shows the planner. Returns null for a sheet that carries no BOQ. */
  function detectSheet(name, ws) {
    var g = gridOf(ws);
    if (!g.length) return null;
    var hdr = findHeader(g);
    if (hdr < 0) return null;
    var H = g[hdr].map(norm);
    var map = colMapOf(H);
    if (map.description < 0) return null;
    var bill = billingColsOf(H);
    var d = {
      sheet: name, header_row: hdr, first_col: 0, col_map: map,
      billing: bill, kind: bill ? 'billing' : 'trade',
      stated_total: statedTotalOf(g), _grid: g,
      lines: 0, headings: 0, nonNumeric: [], sample: []
    };
    // first_col: the leftmost column the header actually uses. Reported so the
    // planner can see the per-sheet offset the design note warns about.
    var used = Object.keys(map).map(function (k) { return map[k]; }).filter(function (v) { return v >= 0; });
    d.first_col = used.length ? Math.min.apply(null, used) : 0;

    var rows = parseSheet(d);
    d.lines = rows.filter(function (r) { return r.line_kind !== 'heading'; }).length;
    d.headings = rows.length - d.lines;
    d.sum = rows.reduce(function (a, r) { return a + (moneyLine(r) ? (r.amount || 0) : 0); }, 0);
    d.nonNumeric = rows.filter(function (r) { return r.exclusion_note; })
                       .map(function (r) { return { row: r.source_row, note: r.exclusion_note }; });
    d.sample = rows.slice(0, 6);
    d._rows = rows;
    return d;
  }

  /* ⚠️ A line contributes to a money roll-up only when it is not a heading and
     carries no exclusion note. Heading amounts are subtotals of the lines below
     them (double-count), and an excluded line's "amount" is a sentence. */
  function moneyLine(r) { return r.line_kind !== 'heading' && !r.exclusion_note && r.amount != null; }
  /* ⚠️ A line contributes to a QUANTITY roll-up only when it is 'measured'.
     Lump-sum and provisional lines carry money but no measurable quantity; in a
     quantity roll-up they silently corrupt every productivity rate. */
  function qtyLine(r) { return r.line_kind === 'measured' && r.qty != null; }

  function parseSheet(d) {
    var g = d._grid, m = d.col_map, out = [], stack = [];
    for (var i = d.header_row + 1; i < g.length; i++) {
      var row = g[i];
      var desc = txt(row[m.description]);
      var itemNo = m.item_no >= 0 ? txt(row[m.item_no]) : '';
      var marker = markerIn(row);
      var rawAmt = m.amount >= 0 ? row[m.amount] : '';
      var amt = numOf(rawAmt);
      var unit = m.unit >= 0 ? txt(row[m.unit]) : '';
      var qty = m.qty >= 0 ? numOf(row[m.qty]) : null;

      // Nothing on the row at all → skip. A blank row is layout, not data.
      if (!desc && !itemNo && amt == null && !unit && qty == null) continue;
      // A row whose only content is the marker is the sheet's own subtotal line.
      if (!desc && !itemNo && marker) continue;

      var isHead = !!marker;
      var note = null, kind;
      if (isHead) kind = 'heading';
      else if (amt == null && txt(rawAmt)) {
        /* ⚠️ SCOPE-BOUNDARY STATEMENT, not missing data. 'Included in Package 1'
           and 'By Megaworld' are contractually load-bearing — they are exactly
           what a claim turns on later. Stored verbatim, flagged, and excluded
           from every roll-up. */
        note = txt(rawAmt); kind = 'excluded';
      } else if (qty == null && amt != null) {
        /* Money with no measurable quantity. Called lump_sum rather than
           measured so it can never enter a productivity rate; 'provisional' is
           the planner's call afterwards, not something the sheet tells us. */
        kind = 'lump_sum';
      } else kind = 'measured';

      var matRate = m.mat_rate >= 0 ? numOf(row[m.mat_rate]) : null;
      var labRate = m.lab_rate >= 0 ? numOf(row[m.lab_rate]) : null;
      var matAmt = m.mat_amount >= 0 ? numOf(row[m.mat_amount]) : null;
      var labAmt = m.lab_amount >= 0 ? numOf(row[m.lab_amount]) : null;
      var derived = false;
      /* ⚠️ Where the client gives a rate but no amount we compute it AND MARK IT
         DERIVED, so a later reconciliation can tell the client's figures from
         ours. We never write a derived RATE back the other way — the displayed
         rate 5,892.86 against the true 5,892.857142… is an ₱8.60 error on a
         two-line sheet. */
      if (amt == null && !note && qty != null && (matRate != null || labRate != null)) {
        amt = qty * ((matRate || 0) + (labRate || 0)); derived = true;
      }

      // Nesting: proposed from the heading/leaf structure, with item_no only
      // used to suggest a depth. ⚠️ Never keyed on item_no — 13 of 901 numbered
      // Architectural lines are duplicates.
      var dots = itemNo ? (itemNo.match(/\./g) || []).length : 0;
      var depth = itemNo && /^\s*\d+(\.\d+)*\s*$/.test(itemNo) ? dots : (isHead ? 0 : (stack.length ? stack[stack.length - 1].depth + 1 : 0));
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      var parentKey = stack.length ? stack[stack.length - 1].key : null;

      var rec = {
        sheet: d.sheet, source_row: i + 1, item_no: itemNo || null, description: desc || null,
        unit: unit || null, qty: qty, mat_rate: matRate, mat_amount: matAmt,
        lab_rate: labRate, lab_amount: labAmt, amount: amt, derived_amount: derived,
        exclusion_note: note, line_kind: kind, total_marker: marker || null, depth: depth,
        _parentKey: parentKey, _key: d.sheet + '#' + (i + 1),
        _path: stack.map(function (s) { return s.desc; }).concat(desc ? [desc] : []),
        _rel: d.billing && d.billing.rel_todate >= 0 ? numOf(row[d.billing.rel_todate]) : null
      };
      rec.key = rec._key;
      out.push(rec);
      if (isHead || kind === 'heading') stack.push({ depth: depth, key: rec._key, desc: desc });
      else if (!stack.length) stack.push({ depth: depth, key: rec._key, desc: desc });
    }
    return out;
  }

  /* ⚠️ THE SINGLE MOST VALUABLE GATE IN THE IMPORTER. Reconcile the sum of the
     lines against the sheet's OWN stated contract total and refuse on mismatch.
     Worked example from the design analysis: a plausible-looking filter that
     skipped rows whose unit text contained "unit" silently dropped
     ₱20,667,260.59 of plant (Tower Crane, Elevators, Generator Set, Skidloader —
     UoM literally `unit`). The sheet was fine; the reader was wrong, and only
     the reconciliation caught it.
     ⚠️ TOLERANCE IS ABSOLUTE-AND-SMALL (1 peso or 0.01%), because the real
     files carry genuine rounding artefacts of exactly that size: the PMI prints
     12,873,167.99 where D + E is exactly 12,873,168.00. Assert those; never
     widen the tolerance to make a real ₱20M hole pass. */
  function reconcile(sum, stated) {
    if (stated == null) return { ok: true, unknown: true, diff: null };
    var diff = sum - stated;
    var tol = Math.max(1, Math.abs(stated) * 0.0001);
    return { ok: Math.abs(diff) <= tol, diff: diff, stated: stated, sum: sum, tol: tol };
  }

  // ==========================================================================
  // DERIVED MATH — POC and revenue (§4.2: rel_pct is the ONLY stored input)
  // ==========================================================================
  /* Per-sheet total, because WT % is relative to its own SHEET. */
  function sheetTotals(items) {
    var t = {};
    items.forEach(function (r) { if (moneyLine(r)) t[r.sheet] = (t[r.sheet] || 0) + Number(r.amount); });
    return t;
  }
  function contractSum(items) {
    return items.reduce(function (a, r) { return a + (moneyLine(r) ? Number(r.amount) : 0); }, 0);
  }
  /* WT % = line amount / its sheet's total. Sum of WT % = 1.000000 per sheet —
     verified on all five billing sheets. */
  function wtOf(r, st) { var t = st[r.sheet]; return (moneyLine(r) && t) ? Number(r.amount) / t : 0; }

  /* Project POC and revenue for one period.
     ⚠️ Computed as Σ(amount × rel) / contract rather than by averaging the four
     sheets' POCs. Algebraically that IS the trade-share re-weighting the design
     note demands (Σ_sheets share × sheetPOC), but expressed in a form that
     cannot be mis-implemented as a naive average — which would let ACOUSTIC
     (1.65% of the contract) move the project POC as much as Architectural
     (87.90%). */
  function periodTotals(items, relMap, contractTotal) {
    var rev = 0, mat = 0, lab = 0;
    items.forEach(function (r) {
      if (!moneyLine(r)) return;
      var rel = Number(relMap[r.id] || 0);
      if (!rel) return;
      rev += Number(r.amount) * rel;
      if (r.mat_amount != null) mat += Number(r.mat_amount) * rel;
      if (r.lab_amount != null) lab += Number(r.lab_amount) * rel;
    });
    var base = contractTotal || contractSum(items);
    return { revenue: rev, materials: mat, labor: lab, poc: base ? rev / base : null, base: base };
  }
  /* Per-sheet POC, for the breakdown table. Kept separate so nobody is tempted
     to average these into a project figure. */
  function sheetPocs(items, relMap) {
    var st = sheetTotals(items), out = {};
    items.forEach(function (r) {
      if (!moneyLine(r)) return;
      var rel = Number(relMap[r.id] || 0);
      out[r.sheet] = out[r.sheet] || { poc: 0, amt: 0, total: st[r.sheet] || 0 };
      out[r.sheet].poc += wtOf(r, st) * rel;
      out[r.sheet].amt += Number(r.amount) * rel;
    });
    return out;
  }
  /* ==========================================================================
     DISPUTE — claimed minus certified, in money.
     Decision #7 left this unmeasurable: boq_progress stored one rel_pct per
     line, the CERTIFIED one, so a submission the client cut was nowhere and the
     whole reported-vs-certified gap had to be called "not yet billed".
     2026-08-26-boq-claimed-vs-certified.sql adds rel_pct_claimed beside it.

     ⚠️ EFFECTIVE CLAIMED = the stored claim, ELSE the certified figure. A line
        with no claim recorded is not a line claimed at zero; treating it as zero
        would price the entire BOQ as disputed the day the migration ran.
     ⚠️ NOT NETTED. Certified-above-claimed is reported on its own as an anomaly
        (almost always a typo) rather than cancelling genuine disputes elsewhere:
        netting them would hide both.
     ⚠️ NEVER BILLED FROM. Nothing derives POC or revenue from the claim — those
        stay on the certified figure, because that is what the client pays. */
  function claimedOf(perId, itemId) {
    var c = CLAIM[perId];
    if (c && c[itemId] != null) return Number(c[itemId]) || 0;
    var p = PROG[perId];
    return (p && p[itemId] != null) ? Number(p[itemId]) || 0 : 0;
  }
  function disputeOf(perId) {
    var out = { disputed: 0, over: 0, nDisputed: 0, nOver: 0, nClaims: 0 };
    var certMap = PROG[perId] || {}, claimMap = CLAIM[perId] || {};
    out.nClaims = Object.keys(claimMap).length;
    // Union of both maps: a line claimed but not certified at all is exactly the
    // dispute that matters most, and it has no entry in PROG.
    var seen = {};
    Object.keys(certMap).forEach(function (k) { seen[k] = 1; });
    Object.keys(claimMap).forEach(function (k) { seen[k] = 1; });
    Object.keys(seen).forEach(function (iid) {
      var r = ITEMS.find(function (x) { return String(x.id) === String(iid); });
      if (!r || !moneyLine(r)) return;
      var cert = Number(certMap[iid] || 0), clm = claimedOf(perId, iid);
      var d = (clm - cert) * Number(r.amount);
      if (d > 0) { out.disputed += d; out.nDisputed++; }
      else if (d < 0) { out.over += -d; out.nOver++; }
    });
    return out;
  }

  function periodsOrdered() {
    return PERIODS.slice().sort(function (a, b) {
      return String(a.period_end || '').localeCompare(String(b.period_end || '')) ||
             String(a.billing_no).localeCompare(String(b.billing_no), undefined, { numeric: true });
    });
  }
  /* `previous` is never stored — it is the to-date of the prior period (§4.2). */
  function prevPeriodOf(p) {
    var ord = periodsOrdered(), i = ord.findIndex(function (x) { return x.id === p.id; });
    return i > 0 ? ord[i - 1] : null;
  }


  // ==========================================================================
  // DECISION #6 — RESOLVED 2026-08-26. THE BILLING PERIOD IS CONTRACTUAL; THE
  // REPORTING MONTH IS CALENDAR. THEY ARE NOT THE SAME OBJECT.
  // ==========================================================================
  /* The real period runs 26-Feb → 25-Mar (PO 4100125091, BILLING NO. 3). Cash
     Flow and the S-curve are monthly. The owner's ruling: billing dates are a
     commercial term and are never moved to suit a report — but a report may
     cut at month end. So a period's INCREMENT (its revenue less the prior
     period's to-date) is spread straight-line across the calendar days it
     spans and assigned to the months those days fall in.

     ⚠️ THE PRO-RATA IS A REPORTING CONVENTION, NOT A MEASUREMENT. Nothing here
     is written back to boq_progress, no billing_no acquires a month, and the
     Billing table above still shows the contractual periods untouched. If the
     two ever disagree, the contractual period wins — it is the one the client
     signed against.

     ⚠️ THE TAIL OF THE CURRENT MONTH IS LEFT BLANK, NOT ACCRUED. Days after the
     last period_end have been certified by nobody. Filling them from the
     schedule's progress would smuggle decision #7's other POC into a revenue
     figure, which is the one thing that module refuses to do. */
  var DAY_MS = 86400000;
  var MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* 'YYYY-MM-DD' → UTC millis. UTC throughout: a local-time Date shifts a date
     across a month boundary for anyone east or west of the server, which would
     silently move revenue between months. */
  function dnum(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function isoOf(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function monthKey(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  function monthLabel(k) { var p = k.split('-'); return MON_ABBR[+p[1] - 1] + ' ' + p[0]; }
  function daysInMonthKey(k) { var p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }
  /* Calendar days of [a..b] INCLUSIVE, bucketed by month. Inclusive because a
     26th→25th period is 28 days in February, not 27: both endpoints are billed. */
  function spreadDays(a, b) {
    var days = {}, n = 0;
    for (var t = a; t <= b; t += DAY_MS) { var k = monthKey(t); days[k] = (days[k] || 0) + 1; n++; }
    return { days: days, n: n };
  }

  /* Monthly revenue, derived — nothing here is stored.
     ⚠️ Spreads the INCREMENT, never the to-date figure. To-date is cumulative;
     spreading it would bill the same money into every month it touches. */
  function monthlyRevenue(items, contractFallback) {
    var ord = periodsOrdered();
    var months = {}, undated = [], covTo = null;
    var prev = { revenue: 0, materials: 0, labor: 0 };
    ord.forEach(function (p, i) {
      var base = p.contract_total != null ? Number(p.contract_total) : contractFallback;
      var t = periodTotals(items, PROG[p.id] || {}, base);
      var inc = { revenue: t.revenue - prev.revenue, materials: t.materials - prev.materials, labor: t.labor - prev.labor };
      prev = t;
      var end = dnum(p.period_end), start = dnum(p.period_start);
      /* A missing start is recoverable — it is the day after the prior period
         closed. A missing END is not: it is the thing that decides the month. */
      if (start == null && i > 0) { var pe = dnum(ord[i - 1].period_end); if (pe != null) start = pe + DAY_MS; }
      if (end == null || start == null || start > end) { undated.push({ p: p, inc: inc }); return; }
      if (covTo == null || end > covTo) covTo = end;
      var sp = spreadDays(start, end);
      Object.keys(sp.days).forEach(function (k) {
        var w = sp.days[k] / sp.n;
        var m = months[k] || (months[k] = { revenue: 0, materials: 0, labor: 0, days: 0, from: [] });
        m.revenue += inc.revenue * w; m.materials += inc.materials * w; m.labor += inc.labor * w;
        m.days += sp.days[k];
        if (m.from.indexOf(p.billing_no) === -1) m.from.push(p.billing_no);
      });
    });
    var cum = 0;
    var rows = Object.keys(months).sort().map(function (k) {
      var m = months[k], dim = daysInMonthKey(k);
      cum += m.revenue;
      return { key: k, label: monthLabel(k), revenue: m.revenue, cumulative: cum,
               materials: m.materials, labor: m.labor, days: m.days, daysInMonth: dim,
               full: m.days >= dim, from: m.from };
    });
    return {
      rows: rows, undated: undated, coveredTo: covTo, total: cum,
      /* Days of the last covered month that no billing reaches. */
      gapDays: covTo == null ? 0 : daysInMonthKey(monthKey(covTo)) - new Date(covTo).getUTCDate()
    };
  }

  // ==========================================================================
  // LOAD
  // ==========================================================================
  function migrationHint(err) {
    var m = (err && err.message) || '';
    return /does not exist|schema cache|PGRST20|relation/i.test(m)
      ? ' Run <code>' + MIGRATION + '</code> in the Supabase SQL editor, then reload.' : '';
  }

  async function load() {
    loaded = false;
    REVS = []; ITEMS = []; CMAP = {}; ALLOC = []; PERIODS = []; PROG = {}; CLAIM = {};
    if (!pid) { render(); return; }
    try {
      REVS = await PDb.selectAll(T_REV, function (q) { return q.eq('project_id', pid); });
      REVS.sort(function (a, b) { return String(b.issued_date || '').localeCompare(String(a.issued_date || '')) || String(b.rev_no).localeCompare(String(a.rev_no), undefined, { numeric: true }); });
      var cur = REVS.find(function (r) { return r.is_current; }) || REVS[0];
      REVID = (REVID && REVS.some(function (r) { return r.id === REVID; })) ? REVID : (cur && cur.id) || null;
      if (REVID) {
        ITEMS = await PDb.selectAll(T_ITEM, function (q) { return q.eq('revision_id', REVID); });
        ITEMS.sort(function (a, b) { return String(a.sheet).localeCompare(String(b.sheet)) || (a.source_row - b.source_row); });
        var maps = await PDb.selectAll(T_MAP, function (q) { return q.eq('revision_id', REVID); });
        CMAP = {}; maps.forEach(function (m) { CMAP[m.boq_item_id] = m; });
        ALLOC = await PDb.selectAll(T_ALLOC, function (q) { return q.eq('project_id', pid); });
        PERIODS = await PDb.selectAll(T_PER, function (q) { return q.eq('project_id', pid); });
        var prog = await PDb.selectAll(T_PROG, function (q) { return q.eq('project_id', pid); });
        PROG = {}; CLAIM = {};
        prog.forEach(function (p) {
          (PROG[p.period_id] = PROG[p.period_id] || {})[p.boq_item_id] = Number(p.rel_pct) || 0;
          /* ⚠️ null (the column un-run, or no claim recorded) must NOT become 0 —
             that would read as a 100% dispute on every historical line. */
          if (p.rel_pct_claimed != null)
            (CLAIM[p.period_id] = CLAIM[p.period_id] || {})[p.boq_item_id] = Number(p.rel_pct_claimed) || 0;
        });
      }
      try { PKGS = await PDb.selectAll('packages', function (q) { return q.eq('project_id', pid).order('sort_order'); }); }
      catch (e) { PKGS = []; }   // no packages table yet: the feature is simply absent
      loaded = true;
    } catch (err) {
      document.getElementById('cc-view').innerHTML = '<div class="pd-card cc-empty"><h3>Could not load the BOQ</h3><p>' +
        esc(err.message || String(err)) + '</p><p class="cc-mut">' + migrationHint(err) + '</p></div>';
      return;
    }
    render();
  }

  async function ensureCodes() {
    if (CODES) return CODES;
    try { CODES = await PDb.selectAll('class_codes', function (q) { return q.eq('active', true).order('sort_order'); }, 'code,code_l1,code_l2,desc_l1,desc_l2,desc_l3'); }
    catch (e) { CODES = []; }
    return CODES;
  }
  /* The schedule's own POC, via the shared RPC — one round-trip returning a few
     dozen monthly buckets rather than every activity.
     ⚠️ Uses schedule_scurve_agg, the SAME function the S-Curve module and Cash
     Flow read. A second implementation here would let this tab and the S-Curve
     screen disagree about the project's progress, which is precisely the kind of
     contradiction a PM cannot act on. */
  async function ensureSched() {
    if (SCHED || schedErr) return SCHED;
    try {
      var r = await sb().rpc('schedule_scurve_agg', { p_id: pid });
      if (r.error) throw r.error;
      SCHED = r.data || null;
    } catch (e) { schedErr = e; SCHED = null; }
    return SCHED;
  }
  /* Duration-weighted progress, 0..1. ⚠️ Returns null rather than 0 when the
     project has no schedule loaded: "no programme to compare against" and "no
     progress" are different facts, and only one of them is a variance. */
  function schedPoc() {
    if (!SCHED) return null;
    var tot = Number(SCHED.totDur) || 0;
    if (!tot) return null;
    return (Number(SCHED.doneDur) || 0) / tot;
  }

  /* Schedule activities, lazily. ⚠️ LEAF ACTIVITIES ONLY and only the columns
     the allocator needs — a project can hold 40k rows and this is a side
     register most sessions never open. */
  async function ensureActs() {
    if (ACTS) return ACTS;
    try {
      var rows = await PDb.selectAll('project_schedule', function (q) { return q.eq('project_id', pid); },
        'id,activity_id,activity_name,class_code,location,work_type,duration_days,activity_type,scope_type');
      ACTS = rows.filter(function (r) { return r.activity_type !== 'WBS Summary' && r.activity_id; });
    } catch (e) { ACTS = []; }
    return ACTS;
  }

  // ==========================================================================
  // RENDER — shell
  // ==========================================================================
  var SUBS = [
    { key: 'items',  label: 'BOQ Items' },
    { key: 'codes',  label: 'Class Codes' },
    { key: 'alloc',  label: 'Allocations' },
    { key: 'billing', label: 'Billing / POC' }
  ];

  function render() {
    var host = document.getElementById('cc-view');
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pd-card cc-empty"><h3>Select a project</h3></div>'; return; }
    if (!loaded) { host.innerHTML = '<div class="pd-card cc-empty"><h3><span class="cc-spin"></span>Loading the BOQ…</h3></div>'; return; }

    var h = '<div class="boq-bar">' +
      '<div class="boq-subtabs">' + SUBS.map(function (s) {
        return '<button class="boq-subtab' + (sub === s.key ? ' active' : '') + '" data-sub="' + s.key + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' +
      '<span class="boq-spacer"></span>' + revPickerHTML() +
      (canWrite ? '<button class="pd-btn pd-btn-primary" id="boq-import">Import BOQ…</button>' : '') +
      '</div>';

    if (!REVS.length) {
      h += '<div class="pd-card cc-empty"><h3>No BOQ imported yet</h3>' +
        '<p>Import the client\'s Bill of Quantities workbook. Each import is a <strong>revision</strong> — ' +
        'the prior one is kept, because every claim argument turns on what was tendered.</p>' +
        (canWrite ? '<p style="margin-top:14px;"><button class="pd-btn pd-btn-primary" id="boq-import2">Import BOQ…</button></p>' : '') +
        '</div>';
    } else {
      h += sub === 'items' ? itemsHTML()
         : sub === 'codes' ? codesHTML()
         : sub === 'alloc' ? allocHTML()
         : billingHTML();
    }
    host.innerHTML = h;
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    wireShell(host);
  }

  function revPickerHTML() {
    if (!REVS.length) return '';
    return '<label class="boq-inline">Revision <select class="pd-select" id="boq-rev">' +
      REVS.map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (r.id === REVID ? ' selected' : '') + '>' +
          esc('rev ' + r.rev_no + (r.issued_date ? ' · ' + String(r.issued_date).slice(0, 10) : '') + (r.is_current ? ' · current' : ' · superseded')) +
          '</option>'; }).join('') + '</select></label>';
  }

  function wireShell(host) {
    host.querySelectorAll('[data-sub]').forEach(function (b) {
      b.onclick = function () { sub = b.dataset.sub; render(); };
    });
    var rv = host.querySelector('#boq-rev');
    if (rv) rv.onchange = function () { REVID = rv.value; load(); };
    ['boq-import', 'boq-import2'].forEach(function (id) {
      var b = host.querySelector('#' + id); if (b) b.onclick = openImport;
    });
    if (sub === 'items') wireItems(host);
    if (sub === 'codes') wireCodes(host);
    if (sub === 'alloc') wireAlloc(host);
    if (sub === 'billing') {
      wireBilling(host);
      // Lazy: only the Billing tab needs it, and it is one round-trip.
      if (!SCHED && !schedErr) ensureSched().then(function () { if (sub === 'billing') render(); });
    }
  }

  // ==========================================================================
  // TAB 1 — BOQ Items
  // ==========================================================================
  function filtered() {
    var q = normKey(filt.q);
    return ITEMS.filter(function (r) {
      if (filt.sheet && r.sheet !== filt.sheet) return false;
      if (filt.kind && r.line_kind !== filt.kind) return false;
      if (filt.mapped === 'yes' && !CMAP[r.id]) return false;
      if (filt.mapped === 'no' && (CMAP[r.id] || r.line_kind === 'heading')) return false;
      if (!q) return true;
      return normKey([r.item_no, r.description, r.unit].join(' ')).indexOf(q) >= 0;
    });
  }
  function sheetList() {
    var s = {}; ITEMS.forEach(function (r) { s[r.sheet] = 1; }); return Object.keys(s).sort();
  }

  function itemsHTML() {
    var st = sheetTotals(ITEMS), total = contractSum(ITEMS);
    var rev = REVS.find(function (r) { return r.id === REVID; }) || {};
    var recon = reconcile(total, rev.contract_total);
    var measured = ITEMS.filter(qtyLine).length;
    var excl = ITEMS.filter(function (r) { return r.exclusion_note; });

    var h = '<div class="cc-kpis">' +
      kpi('Lines', ITEMS.filter(function (r) { return r.line_kind !== 'heading'; }).length, ITEMS.filter(function (r) { return r.line_kind === 'heading'; }).length + ' headings') +
      kpi('Contract value', money(total), 'sum of priced lines') +
      kpi('Measured lines', measured, 'carry a quantity') +
      kpi('Scope boundaries', excl.length, 'excluded from roll-ups', excl.length ? 'warn' : '') +
      kpi('Mapped to class codes', Object.keys(CMAP).length, 'of ' + ITEMS.filter(mappable).length + ' mappable') +
      '</div>';

    if (!recon.ok && !recon.unknown) {
      h += '<div class="boq-alert bad"><strong>This revision does not reconcile.</strong> The lines sum to ' +
        money(recon.sum) + ' against the document\'s stated ' + money(recon.stated) + ' — a difference of ' +
        money(recon.diff) + '. Do not bill against it until the difference is explained.</div>';
    }
    if (excl.length) {
      h += '<div class="boq-alert warn"><strong>' + excl.length + ' scope-boundary line' + (excl.length === 1 ? '' : 's') + '.</strong> ' +
        'These carry a statement instead of an amount (' + esc(excl.slice(0, 3).map(function (r) { return r.exclusion_note; }).join('; ')) +
        (excl.length > 3 ? '; …' : '') + ') and are excluded from every quantity and money roll-up — they are not zeros.</div>';
    }

    h += '<div class="boq-filters">' +
      '<input class="pd-input" id="boq-f-q" placeholder="Search item no., description, unit…" value="' + esc(filt.q) + '" />' +
      '<select class="pd-select" id="boq-f-sheet"><option value="">All sheets</option>' +
        sheetList().map(function (s) { return '<option' + (filt.sheet === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<select class="pd-select" id="boq-f-kind"><option value="">All line kinds</option>' +
        ['measured', 'lump_sum', 'provisional', 'excluded', 'heading'].map(function (k) {
          return '<option value="' + k + '"' + (filt.kind === k ? ' selected' : '') + '>' + esc(kindLabel(k)) + '</option>'; }).join('') + '</select>' +
      '<select class="pd-select" id="boq-f-mapped"><option value="">Mapped or not</option>' +
        '<option value="yes"' + (filt.mapped === 'yes' ? ' selected' : '') + '>Mapped</option>' +
        '<option value="no"' + (filt.mapped === 'no' ? ' selected' : '') + '>Unmapped</option></select>' +
      '<span class="cc-count">' + filtered().length + ' of ' + ITEMS.length + '</span>' +
      '<span class="boq-spacer"></span>' +
      (canWrite ? '<button class="pd-btn" id="boq-pkgs">Assign to contract package…</button>' : '') +
      '<button class="pd-btn" id="boq-export">Export</button>' +
      '</div>';

    h += '<div class="pd-card cc-tablecard"><table class="cc-table boq-table"><thead><tr>' +
      '<th class="boq-no">Item</th><th class="cc-desc">Description</th><th>Unit</th>' +
      '<th class="cc-r">Qty</th><th class="cc-r">Material</th><th class="cc-r">Labour</th>' +
      '<th class="cc-r">Amount</th><th>Kind</th><th>Class code</th><th>Package</th><th class="cc-r">Alloc.</th>' +
      '</tr></thead><tbody>';

    var list = filtered();
    if (!list.length) h += '<tr><td colspan="10" class="cc-mut" style="text-align:center;padding:30px;">No lines match these filters.</td></tr>';
    list.forEach(function (r) {
      var head = r.line_kind === 'heading';
      var cm = CMAP[r.id];
      var al = allocOf(r.id);
      h += '<tr class="' + (head ? 'boq-head' : '') + '" data-id="' + esc(r.id) + '">' +
        '<td class="boq-no" style="padding-left:' + (6 + Math.min(r.depth || 0, 6) * 12) + 'px">' + esc(r.item_no || '') + '</td>' +
        '<td class="cc-desc"><div class="cc-desc-txt" title="' + esc(r.description || '') + '">' + esc(r.description || '') + '</div>' +
          (r.exclusion_note ? '<div class="boq-excl">' + esc(r.exclusion_note) + '</div>' : '') +
          '<div class="cc-mini">' + esc(r.sheet) + ' · row ' + r.source_row + (r.derived_amount ? ' · amount derived' : '') + '</div></td>' +
        '<td>' + esc(r.unit || '') + '</td>' +
        '<td class="cc-r">' + qtyStr(r.qty) + '</td>' +
        '<td class="cc-r">' + money(r.mat_amount) + '</td>' +
        '<td class="cc-r">' + money(r.lab_amount) + '</td>' +
        '<td class="cc-r">' + (r.exclusion_note ? '<span class="cc-mut">—</span>' : money(r.amount)) + '</td>' +
        '<td><span class="boq-kind k-' + esc(r.line_kind) + '">' + esc(kindLabel(r.line_kind)) + '</span></td>' +
        '<td>' + (cm ? '<span class="boq-code" title="' + esc(cm.source) + '">' + esc(cm.class_code) + '</span>' : (mappable(r) ? '<span class="cc-mut">—</span>' : '')) + '</td>' +
        '<td>' + pkgCell(r) + '</td>' +
        '<td class="cc-r">' + (qtyLine(r) ? allocChip(r, al) : '') + '</td>' +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }
  function pkgName(id) {
    if (!id) return null;
    var p = PKGS.find(function (x) { return String(x.id) === String(id); });
    /* ⚠️ A package that no longer exists reads UNLINKED rather than blank — the
       FK is `on delete set null`, so this only shows while PKGS has not loaded,
       but "no package" and "a package that vanished" must not look alike. */
    return p ? (p.code || p.name) : 'UNLINKED';
  }
  function pkgCell(r) {
    var n = pkgName(r.package_id);
    if (!n) return '<span class="cc-mut">—</span>';
    return n === 'UNLINKED' ? '<span class="boq-alloc none">UNLINKED</span>'
                            : '<span class="boq-code">' + esc(n) + '</span>';
  }
  function kindLabel(k) {
    return { measured: 'Measured', lump_sum: 'Lump sum', provisional: 'Provisional', excluded: 'Excluded', heading: 'Heading' }[k] || k;
  }
  /* ⚠️ Headings and excluded lines are NOT mappable-and-unmapped — they are
     not mappable at all. Counting them in the "still to map" denominator makes
     a fully-mapped BOQ read as permanently incomplete. */
  function mappable(r) { return r.line_kind !== 'heading' && r.line_kind !== 'excluded'; }

  function allocOf(itemId) {
    return ALLOC.filter(function (a) { return a.boq_item_id === itemId; });
  }
  /* ⚠️ ALLOCATIONS MUST RECONCILE AND THE UI MUST SAY WHEN THEY DON'T.
     Σ allocated ≤ line qty, with the remainder shown. Silent over-allocation is
     a wrong S-curve. */
  function allocSum(list) { return list.reduce(function (a, x) { return a + (Number(x.qty) || 0); }, 0); }
  function allocChip(r, list) {
    var s = allocSum(list), q = Number(r.qty) || 0;
    if (!list.length) return '<span class="boq-alloc none">unallocated</span>';
    var cls = s > q + 1e-6 ? 'over' : Math.abs(s - q) < 1e-6 ? 'full' : 'part';
    return '<span class="boq-alloc ' + cls + '" title="' + qtyStr(s) + ' of ' + qtyStr(q) + ' across ' + list.length + ' activities">' +
      (q ? (s / q * 100).toFixed(0) + '%' : qtyStr(s)) + '</span>';
  }
  function kpi(label, value, sub2, cls) {
    return '<div class="cc-kpi ' + (cls || '') + '"><div class="cc-kpi-l">' + esc(label) + '</div>' +
      '<div class="cc-kpi-v">' + value + '</div><div class="cc-kpi-s">' + esc(sub2 || '') + '</div></div>';
  }

  function wireItems(host) {
    var q = host.querySelector('#boq-f-q'), t = null;
    if (q) q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { filt.q = q.value; render(); }, 160); });
    [['boq-f-sheet', 'sheet'], ['boq-f-kind', 'kind'], ['boq-f-mapped', 'mapped']].forEach(function (p) {
      var el = host.querySelector('#' + p[0]);
      if (el) el.onchange = function () { filt[p[1]] = el.value; render(); };
    });
    var ex = host.querySelector('#boq-export'); if (ex) ex.onclick = exportItems;
    var pk = host.querySelector('#boq-pkgs'); if (pk) pk.onclick = openAssignPackage;
  }

  function exportItems() {
    var list = filtered();
    if (!list.length) { UI.toast('Nothing to export.', 'error'); return; }
    var aoa = list.map(function (r) {
      return {
        'Sheet': r.sheet, 'Source Row': r.source_row, 'Item No': r.item_no || '',
        'Description': r.description || '', 'Unit': r.unit || '',
        'Qty': r.qty == null ? '' : Number(r.qty),
        'Material Cost': r.mat_amount == null ? '' : Number(r.mat_amount),
        'Labour Cost': r.lab_amount == null ? '' : Number(r.lab_amount),
        // ⚠️ Exported as given, and the note travels with the line. A reader who
        // gets a 0 where the contract says "By Megaworld" will bill for it.
        'Amount': r.amount == null ? '' : Number(r.amount),
        'Scope Note': r.exclusion_note || '', 'Line Kind': kindLabel(r.line_kind),
        'Class Code': (CMAP[r.id] || {}).class_code || '',
        'Allocated Qty': allocSum(allocOf(r.id)) || ''
      };
    });
    var ws = XLSX.utils.json_to_sheet(aoa), wb = XLSX.utils.book_new();
    ws['!cols'] = Object.keys(aoa[0]).map(function (k) { return { wch: k === 'Description' ? 50 : Math.max(12, k.length + 2) }; });
    XLSX.utils.book_append_sheet(wb, ws, 'BOQ');
    XLSX.writeFile(wb, 'BOQ - ' + (projLabel || pid) + '.xlsx');
  }

  /* ==========================================================================
     DESIGN DECISION #2 — RE-ANSWERED 2026-08-26. THE FIRST ANSWER WAS WRONG.

     A CONTRACT PACKAGE IS A SCOPE DIVISION OF THE PROJECT, NOT A TRADE.
     The owner's own example — Avesta Residences is ONE project, bought as:
        Package 1 — Avesta Residences Tower 1 and General Requirements
        Package 2 — Avesta Residences Towers 2-7
     The BOQ workbook belongs TO a package. The sheets inside it are whatever
     breakdown the CLIENT dictated for that package's progress billing — by
     trade on this job, by something else on the next. The client decides that,
     not the importer and not us.

     ⚠️ THE OLD "PACKAGES FROM SHEETS" TOOL HAD IT EXACTLY BACKWARDS and is
     deleted, not extended. Minting one package per trade sheet would have
     produced four packages ("Architectural", "ACOUSTIC") where the real
     contract has one — the workbook IS Package 2 — and a claim later raised
     against "package ACOUSTIC" would name a lot that appears on no contract
     document. That is the same failure the refusal-to-auto-create was written
     to prevent, one level down: a sheet name is not a commercial lot.

     So packages are created on the Dashboard from the contract documents, and
     this tool only ASSIGNS existing ones. ⚠️ IT CANNOT CREATE A PACKAGE — there
     is no insert in this function, deliberately.
     ========================================================================== */
  /* What package do a sheet's lines currently carry? 'mixed' is a real answer —
     a sheet split across lots is unusual but legitimate, and hiding it behind
     the first line's value would make a wrong assignment invisible. */
  function sheetPkgState(sh) {
    var seen = {}, n = 0;
    ITEMS.forEach(function (r) {
      if (r.sheet !== sh) return;
      n++; seen[r.package_id || ''] = (seen[r.package_id || ''] || 0) + 1;
    });
    var keys = Object.keys(seen);
    if (!n) return { label: 'no lines', n: 0 };
    if (keys.length > 1) return { label: 'mixed — ' + keys.length + ' lots', n: n, mixed: true };
    return { label: keys[0] ? esc(pkgName(keys[0])) : '<span class="cc-mut">unassigned</span>', n: n };
  }

  function openAssignPackage() {
    if (!canWrite) { UI.toast('You do not have permission to assign packages.', 'error'); return; }

    /* ⚠️ NO PACKAGES → NO GUESSING. The honest move is to say where they come
       from, not to offer to invent one from the workbook. */
    if (!PKGS.length) {
      var m0 = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">No contract packages yet</h2>' +
        '<button class="pd-modal-close" id="ap-x0">&times;</button></div>' +
        '<div class="boq-imp"><p class="cc-hint">A contract package is a <strong>scope division of this project</strong> ' +
        '— "Package 1 — Tower 1 and General Requirements", "Package 2 — Towers 2-7". It comes off the contract ' +
        'documents, so it is created once on the <strong>Dashboard</strong> and then used by the schedule, the claims ' +
        'register and this BOQ alike.</p>' +
        '<p class="cc-hint">⚠️ This tool will not create one from a sheet name. The workbook\'s sheets are the ' +
        'client\'s billing breakdown <em>within</em> a package (by trade here, by something else elsewhere) — they are ' +
        'not the packages themselves, and a lot minted from a tab name would later be cited in a claim nobody agreed ' +
        'to.</p></div>' +
        '<div class="pd-modal-footer"><button class="pd-btn pd-btn-primary" id="ap-c0">Close</button></div>');
      m0.el.querySelector('#ap-x0').onclick = m0.close;
      m0.el.querySelector('#ap-c0').onclick = m0.close;
      return;
    }

    var st = sheetTotals(ITEMS);
    var sheets = sheetList().map(function (sh) {
      var state = sheetPkgState(sh);
      return { sheet: sh, total: st[sh] || 0, n: state.n, state: state, pick: false };
    });
    var target = PKGS[0].id;   // '' means "clear the assignment"

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Assign BOQ to a contract package</h2>' +
      '<button class="pd-modal-close" id="ap-x">&times;</button></div>' +
      '<div class="boq-imp" id="ap-body"></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ap-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ap-go">Apply</button></div>');
    var body = m.el.querySelector('#ap-body');

    function paint() {
      var chosen = sheets.filter(function (x) { return x.pick; });
      body.innerHTML =
        '<p class="cc-hint">A contract package is a <strong>scope division of the project</strong> (Package 1 — Tower 1 ' +
        'and General Requirements; Package 2 — Towers 2-7). This BOQ belongs to one of them; its sheets are the ' +
        'breakdown the <strong>client</strong> dictated for that package\'s progress billing. ' +
        '<strong>Nothing is written until you press Apply, and no package is ever created here</strong> — they come off ' +
        'the contract documents, on the Dashboard.</p>' +
        '<label>Package<select class="pd-input" id="ap-pkg">' +
          PKGS.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (String(target) === String(p.id) ? ' selected' : '') + '>' +
              esc((p.code ? p.code + ' — ' : '') + p.name) + '</option>';
          }).join('') +
          /* Correcting a wrong assignment must be possible without a DB console. */
          '<option value=""' + (target === '' ? ' selected' : '') + '>— remove assignment —</option>' +
        '</select></label>' +
        '<p class="cc-hint"><button class="pd-btn boq-sm" id="ap-all">Select every sheet</button> ' +
        '<button class="pd-btn boq-sm" id="ap-none">Select none</button> ' +
        'Most workbooks are one package end to end. Choose sheet by sheet only when the client issued one document ' +
        'covering more than one lot.</p>' +
        '<table class="boq-prevtab"><thead><tr><th></th><th>Sheet</th><th class="cc-r">Lines</th>' +
        '<th class="cc-r">Sheet value</th><th>Currently</th></tr></thead><tbody>' +
        sheets.map(function (x, i) {
          return '<tr><td><input type="checkbox" data-p="' + i + '"' + (x.pick ? ' checked' : '') + ' /></td>' +
            '<td>' + esc(x.sheet) + '</td><td class="cc-r">' + x.n + '</td>' +
            '<td class="cc-r">' + (x.total ? money(x.total) : '<span class="cc-mut">unpriced</span>') + '</td>' +
            '<td class="cc-mini">' + x.state.label + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<p class="cc-hint">' + (chosen.length
          ? chosen.reduce(function (a, x) { return a + x.n; }, 0) + ' line(s) across ' + chosen.length + ' sheet(s) worth ' +
            '<strong>' + money(chosen.reduce(function (a, x) { return a + x.total; }, 0)) + '</strong> will be ' +
            (target ? 'assigned to <strong>' + esc(pkgName(target)) + '</strong>.' : '<strong>unassigned</strong>.')
          : 'Nothing selected.') +
        ' ⚠️ Re-assigning overwrites whatever those lines carry now — a sheet reading <em>mixed</em> is currently split ' +
        'across lots, and applying here collapses it into one.</p>';

      body.querySelector('#ap-pkg').onchange = function () { target = this.value; paint(); };
      body.querySelector('#ap-all').onclick = function () { sheets.forEach(function (x) { x.pick = x.n > 0; }); paint(); };
      body.querySelector('#ap-none').onclick = function () { sheets.forEach(function (x) { x.pick = false; }); paint(); };
      body.querySelectorAll('[data-p]').forEach(function (cb) {
        cb.onchange = function () { sheets[+cb.dataset.p].pick = cb.checked; paint(); };
      });
    }
    paint();
    m.el.querySelector('#ap-x').onclick = m.close;
    m.el.querySelector('#ap-c').onclick = m.close;
    m.el.querySelector('#ap-go').onclick = async function () {
      var take = sheets.filter(function (x) { return x.pick && x.n; });
      if (!take.length) { UI.toast('Nothing selected.', 'error'); return; }
      var btn = m.el.querySelector('#ap-go'); btn.disabled = true; btn.textContent = 'Applying…';
      var pkgId = target || null;
      try {
        for (var i = 0; i < take.length; i++) {
          var sh = take[i].sheet;
          // Chunked by id: a wide sheet would otherwise exceed the URL length of
          // a single .in() filter.
          var ids = ITEMS.filter(function (r) { return r.sheet === sh; }).map(function (r) { return r.id; });
          for (var j = 0; j < ids.length; j += 200) {
            var up = await sb().from(T_ITEM).update({ package_id: pkgId }).in('id', ids.slice(j, j + 200));
            if (up.error) throw up.error;
          }
          ITEMS.forEach(function (r) { if (r.sheet === sh) r.package_id = pkgId; });
        }
        m.close();
        UI.toast(pkgId ? 'Assigned ' + take.length + ' sheet(s) to ' + pkgName(pkgId) + '.'
                       : 'Cleared the package on ' + take.length + ' sheet(s).', 'success');
        render();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Apply';
        UI.toast((err.message || String(err)) +
          (/package_id|packages/.test(err.message || '') ? ' — run migrations/2026-08-25-package-adoption.sql.' : ''), 'error');
      }
    };
  }
  function txtOf(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // ==========================================================================
  // IMPORT — detect → preview → accept → import verbatim
  // ==========================================================================
  function openImport() {
    if (!canWrite) { UI.toast('You do not have permission to import.', 'error'); return; }
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Import BOQ</h2>' +
      '<button class="pd-modal-close" id="bi-x">&times;</button></div>' +
      '<div class="boq-imp" id="bi-body">' +
      '<p class="cc-hint">Pick the client\'s BOQ workbook. Nothing is written until you accept the preview — ' +
      '<strong>detection proposes, you accept</strong>. A silently-wrong column map produces a BOQ that looks ' +
      'complete and is wrong in the money column.</p>' +
      '<input type="file" id="bi-file" accept=".xlsx,.xlsm,.xls" />' +
      '<div id="bi-prev"></div></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="bi-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="bi-go" disabled>Import</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('bi-x').onclick = m.close; el('bi-cancel').onclick = m.close;

    var detected = null;
    el('bi-file').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      el('bi-prev').innerHTML = '<p class="cc-mut"><span class="cc-spin"></span>Reading ' + esc(f.name) + '…</p>';
      var rd = new FileReader();
      rd.onload = function () {
        // Deferred a tick so the "Reading…" line actually paints before the
        // parse blocks the thread on a 1,200-line workbook.
        setTimeout(function () {
          try {
            var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: false, sheetRows: 8000 });
            detected = { file: f.name, sheets: [] };
            wb.SheetNames.forEach(function (nm) {
              /* ⚠️ THE SHEET NAME CAN CARRY A TRAILING SPACE — 'BILLING BREAKDOWN '
                 in the real file. An exact-name lookup throws, so sheets are
                 always addressed by the name the workbook gave, never retyped. */
              var d = detectSheet(nm, wb.Sheets[nm]);
              if (d) detected.sheets.push(d);
            });
            el('bi-prev').innerHTML = previewHTML(detected);
            wirePreview(m, detected);
            el('bi-go').disabled = !detected.sheets.length;
          } catch (err) {
            el('bi-prev').innerHTML = '<div class="boq-alert bad">Could not read the workbook: ' + esc(err.message || String(err)) + '</div>';
          }
        }, 0);
      };
      rd.readAsArrayBuffer(f);
    };
    el('bi-go').onclick = function () { if (detected) doImport(m, detected); };
  }

  function previewHTML(d) {
    var h = '<div class="boq-imp-grid">' +
      '<label>Revision no.<input class="pd-input" id="bi-rev" value="' + esc(guessRev(d.file)) + '" /></label>' +
      '<label>Issued date<input class="pd-input" id="bi-date" type="date" /></label>' +
      '<label>PO no.<input class="pd-input" id="bi-po" /></label>' +
      '<label>Stated contract total<input class="pd-input" id="bi-total" type="number" step="0.01" value="' + esc(sumStated(d) || '') + '" /></label>' +
      '</div>' +
      '<p class="cc-hint">The stated total is the <strong>reconciliation gate</strong>. Pre-filled from the sheets\' own ' +
      'stated Total Contract/Project Cost where they carry one. If the imported lines do not sum to it, the revision ' +
      'is flagged and must not be billed against.</p>';

    h += '<table class="boq-prevtab"><thead><tr><th></th><th>Sheet</th><th>Role</th><th class="cc-r">Header row</th>' +
      '<th class="cc-r">Lines</th><th class="cc-r">Headings</th><th class="cc-r">Sum of lines</th>' +
      '<th class="cc-r">Stated</th><th>Reconciles</th></tr></thead><tbody>';
    d.sheets.forEach(function (s, i) {
      var rc = reconcile(s.sum, s.stated_total);
      // A billing sheet's lines are matched back to the trade sheet, so it is
      // not imported as items by default; a trade sheet is.
      var on = s.kind === 'trade';
      h += '<tr><td><input type="checkbox" data-sheet="' + i + '"' + (on ? ' checked' : '') + ' /></td>' +
        '<td>' + esc(s.sheet) + '</td>' +
        '<td><select class="pd-select boq-sm" data-role="' + i + '">' +
          ['trade', 'billing', 'skip'].map(function (k) { return '<option value="' + k + '"' + (s.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') +
        '</select></td>' +
        '<td class="cc-r">' + (s.header_row + 1) + '</td>' +
        '<td class="cc-r">' + s.lines + '</td><td class="cc-r">' + s.headings + '</td>' +
        '<td class="cc-r">' + money(s.sum) + '</td>' +
        '<td class="cc-r">' + (s.stated_total == null ? '<span class="cc-mut">not stated</span>' : money(s.stated_total)) + '</td>' +
        '<td>' + (rc.unknown ? '<span class="cc-mut">unknown</span>' : rc.ok ? '<span class="boq-ok">yes</span>' : '<span class="boq-bad">off by ' + money(rc.diff) + '</span>') + '</td>' +
        '</tr>';
      if (s.nonNumeric.length) {
        h += '<tr class="boq-prevnote"><td></td><td colspan="8"><strong>' + s.nonNumeric.length +
          ' non-numeric amount' + (s.nonNumeric.length === 1 ? '' : 's') + '</strong> stored verbatim as scope boundaries: ' +
          esc(s.nonNumeric.slice(0, 4).map(function (x) { return 'row ' + x.row + ' “' + x.note + '”'; }).join(', ')) +
          (s.nonNumeric.length > 4 ? ', …' : '') + '</td></tr>';
      }
    });
    h += '</tbody></table>';

    var bad = d.sheets.filter(function (s) { var r = reconcile(s.sum, s.stated_total); return !r.ok && !r.unknown; });
    if (bad.length) {
      h += '<div class="boq-alert bad"><strong>' + bad.length + ' sheet' + (bad.length === 1 ? '' : 's') +
        ' do not reconcile against their own stated total.</strong> Import is still allowed — the difference may be ' +
        'a real rounding artefact in the client\'s file — but the revision is flagged and the sheet, the sum and the ' +
        'difference are recorded so it can be argued about later. Check the column map before accepting.</div>';
    }
    // ⚠️ The twins are not reliably the same data: ACOUSTIC's trade sheet is
    // entirely unpriced (₱0.00) while its billing twin carries ₱19,082,190.24,
    // with only 2 of 48 lines agreeing. Importing trade sheets only would
    // silently lose a whole trade's value — so the disagreement is SHOWN and the
    // planner picks the priced source.
    var unpriced = d.sheets.filter(function (s) { return s.kind === 'trade' && !s.sum; });
    if (unpriced.length) {
      h += '<div class="boq-alert warn"><strong>' + unpriced.length + ' trade sheet' + (unpriced.length === 1 ? ' is' : 's are') +
        ' entirely unpriced</strong> (' + esc(unpriced.map(function (s) { return s.sheet; }).join(', ')) + '). ' +
        'If a billing twin carries the price, set that twin\'s role to <code>trade</code> instead — otherwise this ' +
        'trade\'s whole value is lost with nothing on screen to say so.</div>';
    }
    return h;
  }
  function guessRev(file) {
    var m = String(file || '').match(/rev\.?\s*0*(\d+)/i);
    return m ? m[1] : '1';
  }
  /* Sum of the STATED totals of the sheets we would import as trade sheets —
     ⚠️ never including a billing twin (double-count) and never including a
     different scope. In the real file the four Package 2 trade sheets sum to
     ₱1,155,577,055.60 = the Summary bid × 1.12 (VAT confirmed, set complete). */
  function sumStated(d) {
    var s = 0, any = false;
    d.sheets.forEach(function (x) { if (x.kind === 'trade' && x.stated_total != null) { s += x.stated_total; any = true; } });
    return any ? Math.round(s * 100) / 100 : '';
  }

  function wirePreview(m, d) {
    m.el.querySelectorAll('[data-role]').forEach(function (s) {
      s.onchange = function () {
        d.sheets[+s.dataset.role].kind = s.value;
        var cb = m.el.querySelector('[data-sheet="' + s.dataset.role + '"]');
        if (cb) cb.checked = s.value !== 'skip';
        var t = m.el.querySelector('#bi-total'); if (t) t.value = sumStated(d) || '';
      };
    });
  }

  async function doImport(m, d) {
    var el = function (id) { return m.el.querySelector('#' + id); };
    var revNo = (el('bi-rev').value || '').trim();
    if (!revNo) { UI.toast('Give the revision a number.', 'error'); return; }
    var picked = [];
    m.el.querySelectorAll('[data-sheet]').forEach(function (cb) { if (cb.checked) picked.push(d.sheets[+cb.dataset.sheet]); });
    var trades = picked.filter(function (s) { return s.kind === 'trade'; });
    var bills = picked.filter(function (s) { return s.kind === 'billing'; });
    if (!trades.length) { UI.toast('Pick at least one sheet to import as a trade BOQ.', 'error'); return; }

    var go = el('bi-go'); go.disabled = true; go.textContent = 'Importing…';
    var body = el('bi-body');
    function say(s) { body.innerHTML = '<p><span class="cc-spin"></span>' + esc(s) + '</p>'; }

    try {
      say('Creating revision ' + revNo + '…');
      // ⚠️ A new revision supersedes, it does not replace: the prior rows are
      // left alone and only is_current moves. Deleting them would destroy the
      // only record of what was tendered.
      await sb().from(T_REV).update({ is_current: false }).eq('project_id', pid);
      var inv = {};
      picked.forEach(function (s) { inv[s.sheet] = { role: s.kind, lines: s.lines, headings: s.headings, sum: s.sum, stated: s.stated_total, header_row: s.header_row + 1 }; });
      var rev = await sb().from(T_REV).insert({
        project_id: pid, rev_no: revNo,
        issued_date: el('bi-date').value || null, po_no: (el('bi-po').value || '').trim() || null,
        contract_total: numOf(el('bi-total').value), source_file: d.file,
        sheet_inventory: inv, is_current: true, created_by: UID
      }).select().single();
      if (rev.error) throw rev.error;
      var revId = rev.data.id;

      // ---- items, verbatim -------------------------------------------------
      var payload = [], keyIndex = {};
      trades.forEach(function (s) {
        s._rows.forEach(function (r, i) {
          keyIndex[r._key] = payload.length;
          payload.push({
            project_id: pid, revision_id: revId, sheet: r.sheet, source_row: r.source_row,
            item_no: r.item_no, description: r.description, unit: r.unit, qty: r.qty,
            mat_rate: r.mat_rate, mat_amount: r.mat_amount, lab_rate: r.lab_rate, lab_amount: r.lab_amount,
            amount: r.amount, derived_amount: r.derived_amount, exclusion_note: r.exclusion_note,
            line_kind: r.line_kind, total_marker: r.total_marker, depth: r.depth,
            sort_order: i, created_by: UID, _pk: r._parentKey, _k: r._key
          });
        });
      });
      var inserted = [];
      for (var i = 0; i < payload.length; i += 400) {
        say('Importing lines ' + (i + 1) + '–' + Math.min(i + 400, payload.length) + ' of ' + payload.length + '…');
        var chunk = payload.slice(i, i + 400).map(function (p) { var c = Object.assign({}, p); delete c._pk; delete c._k; return c; });
        var res = await sb().from(T_ITEM).insert(chunk).select('id,sheet,source_row');
        if (res.error) throw res.error;
        inserted = inserted.concat(res.data);
      }
      // Parent links in a second pass, keyed on (sheet, source_row) — the real
      // identity. ⚠️ Never on item_no, which repeats.
      var byRow = {};
      inserted.forEach(function (r) { byRow[r.sheet + '#' + r.source_row] = r.id; });
      var links = payload.filter(function (p) { return p._pk && byRow[p._pk] && byRow[p._k]; })
        .map(function (p) { return { id: byRow[p._k], parent_id: byRow[p._pk] }; });
      for (var j = 0; j < links.length; j += 200) {
        say('Linking hierarchy ' + (j + 1) + ' of ' + links.length + '…');
        for (var k = j; k < Math.min(j + 200, links.length); k++) {
          await sb().from(T_ITEM).update({ parent_id: links[k].parent_id }).eq('id', links[k].id);
        }
      }

      // ---- import profiles, so the next revision needs no re-deciding -----
      say('Saving import profiles…');
      for (var p2 = 0; p2 < picked.length; p2++) {
        var s2 = picked[p2];
        await sb().from(T_PROF).upsert({
          project_id: pid, sheet: s2.sheet, header_row: s2.header_row, first_col: String(s2.first_col),
          col_map: s2.col_map, heading_rule: { marker_re: String(MARKER_RE), role: s2.kind },
          created_by: UID, updated_at: new Date().toISOString()
        }, { onConflict: 'project_id,sheet' });
      }

      // ---- billing twins → a period of progress ---------------------------
      if (bills.length) {
        say('Importing ' + bills.length + ' billing sheet(s)…');
        await importBilling(revId, bills, byRow, el);
      }

      UI.toast('Imported ' + payload.length + ' lines as revision ' + revNo + '.', 'success');
      m.close();
      REVID = revId;
      CODES = null; ACTS = null;
      await load();
    } catch (err) {
      body.innerHTML = '<div class="boq-alert bad"><strong>Import failed.</strong> ' + esc(err.message || String(err)) +
        '<p class="cc-mut">' + migrationHint(err) + '</p></div>';
      go.disabled = false; go.textContent = 'Import';
    }
  }

  /* ⚠️ A BILLING SHEET IS NOT A VIEW OF THE TRADE SHEET. It is the same lines
     plus a period's progress — and for ACOUSTIC it is the only priced copy. So
     the trade sheet supplies the lines and each billing sheet supplies a
     PERIOD, matched back to the items by (sheet, source_row).
     ⚠️ The match is by the TRADE sheet's row, so a billing twin whose name
     differs ('Architectural (Billing)') maps onto 'Architectural'. */
  async function importBilling(revId, bills, byRow, el) {
    var billNo = 1 + PERIODS.length;
    var per = await sb().from(T_PER).insert({
      project_id: pid, revision_id: revId, billing_no: String(billNo),
      period_start: null, period_end: el('bi-date').value || null,
      po_no: (el('bi-po').value || '').trim() || null, contract_total: numOf(el('bi-total').value),
      status: 'draft', notes: 'Imported from ' + bills.map(function (b) { return b.sheet; }).join(', '),
      created_by: UID
    }).select().single();
    if (per.error) throw per.error;
    var rows = [];
    bills.forEach(function (b) {
      var base = b.sheet.replace(/\s*\(billing\)\s*$/i, '').trim();
      b._rows.forEach(function (r) {
        if (r._rel == null || r.line_kind === 'heading') return;
        var id = byRow[base + '#' + r.source_row] || byRow[b.sheet + '#' + r.source_row];
        if (!id) return;    // a billing line with no trade line is reported, not invented
        rows.push({ project_id: pid, period_id: per.data.id, boq_item_id: id, rel_pct: r._rel, created_by: UID });
      });
    });
    for (var i = 0; i < rows.length; i += 400) {
      var res = await sb().from(T_PROG).insert(rows.slice(i, i + 400));
      if (res.error) throw res.error;
    }
  }

  // ==========================================================================
  // TAB 2 — Class-code mapping (B1b)
  // ==========================================================================
  var SUGG = null;
  async function ensureSugg() {
    if (SUGG) return SUGG;
    try { SUGG = await PDb.selectAll(T_SUGG, function (q) { return q; }); } catch (e) { SUGG = []; }
    return SUGG;
  }
  /* The path key: the client's own heading chain. ⚠️ It matches far more stably
     than free text does, because a client's division headings map onto Finance
     divisions even when their line wording is bespoke. */
  function pathOf(r) {
    var parts = [], seen = 0, cur = r;
    while (cur && seen++ < 8) {
      if (cur.description) parts.unshift(cur.description);
      cur = cur.parent_id ? ITEMS.find(function (x) { return x.id === cur.parent_id; }) : null;
    }
    return normKey(parts.join(' > '));
  }
  /* Propose a class code. Returns {code, confidence, why} or null.
     ⚠️ PROPOSES ONLY. Nothing is stored until the planner accepts, and each
     accepted row records HOW it was arrived at. */
  function suggestFor(r) {
    if (!SUGG || !SUGG.length) return null;
    var nd = normKey(r.description || ''), pk = pathOf(r);
    var best = null;
    SUGG.forEach(function (s) {
      var score = 0, why = '';
      if (s.path_key && pk && s.path_key === pk) { score = 0.9; why = 'same heading path'; }
      else if (s.norm_desc && nd && s.norm_desc === nd) { score = 0.8; why = 'same description'; }
      else if (s.path_key && pk && (pk.indexOf(s.path_key) === 0 || s.path_key.indexOf(pk) === 0)) { score = 0.6; why = 'heading path prefix'; }
      else if (s.norm_desc && nd && nd.length > 8 && (nd.indexOf(s.norm_desc) >= 0 || s.norm_desc.indexOf(nd) >= 0)) { score = 0.5; why = 'description overlap'; }
      else return;
      // Hits nudge, they never dominate: a bulk-accepted mapping used 200 times
      // must not outrank an exact-path match made once.
      score += Math.min(0.08, (s.hits || 1) / 500);
      if (!best || score > best.confidence) best = { code: s.class_code, confidence: score, why: why, project: s.last_project_id };
    });
    return best;
  }

  function codesHTML() {
    var mappables = ITEMS.filter(mappable);
    var unmapped = mappables.filter(function (r) { return !CMAP[r.id]; });
    // Headings first: mapping 40 headings covers 187 location leaves on the
    // fit-out sheets. ⚠️ That is the difference between a viable workflow and an
    // unusable one, and it falls out of the document's own structure.
    var heads = ITEMS.filter(function (r) { return r.line_kind === 'heading'; });

    var h = '<div class="cc-kpis">' +
      kpi('Mapped', Object.keys(CMAP).length, 'of ' + mappables.length + ' mappable lines') +
      kpi('Unmapped', unmapped.length, 'the worklist', unmapped.length ? 'warn' : 'good') +
      kpi('Headings', heads.length, 'map here where the sheet supports it') +
      kpi('Suggestion library', SUGG ? SUGG.length : '—', 'learned across the portfolio') +
      '</div>';

    h += '<p class="cc-hint"><strong>Mapping is a judgement, and it is scoped to this BOQ revision.</strong> ' +
      'There is deliberately no global description→code table that applies itself: two clients calling something ' +
      '“Wall Systems and Cladding” may mean different Finance codes. Suggestions come from mappings accepted ' +
      'elsewhere and always name their source — they are never auto-accepted.</p>';

    h += '<div class="boq-filters">' +
      '<input class="pd-input" id="boq-c-q" placeholder="Search lines…" value="' + esc(filt.q) + '" />' +
      '<select class="pd-select" id="boq-c-sheet"><option value="">All sheets</option>' +
        sheetList().map(function (s) { return '<option' + (filt.sheet === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<button class="pd-btn" id="boq-c-suggest">Propose codes</button>' +
      (canWrite ? '<button class="pd-btn" id="boq-c-acceptall">Accept all proposals…</button>' : '') +
      '</div>';

    // Worst-confidence-first: the lines needing a human are at the top.
    var list = ITEMS.filter(function (r) {
      if (!mappable(r) && r.line_kind !== 'heading') return false;
      if (filt.sheet && r.sheet !== filt.sheet) return false;
      if (filt.q && normKey([r.item_no, r.description].join(' ')).indexOf(normKey(filt.q)) < 0) return false;
      return true;
    }).map(function (r) { return { r: r, s: CMAP[r.id] ? null : suggestFor(r) }; })
      .sort(function (a, b) {
        var am = CMAP[a.r.id] ? 2 : 0, bm = CMAP[b.r.id] ? 2 : 0;
        if (am !== bm) return am - bm;
        return ((a.s && a.s.confidence) || 0) - ((b.s && b.s.confidence) || 0);
      });

    h += '<div class="pd-card cc-tablecard"><table class="cc-table boq-table"><thead><tr>' +
      '<th class="boq-no">Item</th><th class="cc-desc">Description</th><th>Kind</th>' +
      '<th>Proposal</th><th class="cc-r">Confidence</th><th>Class code</th>' +
      (canWrite ? '<th class="cc-actcol"></th>' : '') + '</tr></thead><tbody>';
    list.slice(0, 400).forEach(function (x) {
      var r = x.r, cm = CMAP[r.id];
      h += '<tr data-id="' + esc(r.id) + '"' + (r.line_kind === 'heading' ? ' class="boq-head"' : '') + '>' +
        '<td class="boq-no">' + esc(r.item_no || '') + '</td>' +
        '<td class="cc-desc"><div class="cc-desc-txt">' + esc(r.description || '') + '</div>' +
          '<div class="cc-mini">' + esc(r.sheet) + ' · row ' + r.source_row + '</div></td>' +
        '<td><span class="boq-kind k-' + esc(r.line_kind) + '">' + esc(kindLabel(r.line_kind)) + '</span></td>' +
        '<td>' + (x.s ? '<span class="boq-sugg" title="' + esc(x.s.why + (x.s.project ? ' · last used on ' + x.s.project : '')) + '">' +
            esc(x.s.code) + '</span> <span class="cc-mini">' + esc(x.s.why) + '</span>' : '<span class="cc-mut">—</span>') + '</td>' +
        '<td class="cc-r">' + (x.s ? (x.s.confidence * 100).toFixed(0) + '%' : '') + '</td>' +
        '<td>' + (cm ? '<span class="boq-code">' + esc(cm.class_code) + '</span> <span class="cc-mini">' + esc(cm.source.replace('_', ' ')) + '</span>' : '<span class="cc-mut">unmapped</span>') + '</td>' +
        (canWrite ? '<td class="cc-actcol">' +
          '<button class="pd-btn" data-pick="' + esc(r.id) + '" title="Pick a class code">Map…</button>' +
          (x.s ? ' <button class="pd-btn" data-accept="' + esc(r.id) + '" title="Accept the proposal">✓</button>' : '') +
          (cm ? ' <button class="pd-btn" data-unmap="' + esc(r.id) + '" title="Remove the mapping">&times;</button>' : '') +
          '</td>' : '') +
        '</tr>';
    });
    if (list.length > 400) h += '<tr><td colspan="7" class="cc-mut" style="text-align:center;padding:14px;">Showing the first 400 of ' + list.length + ' lines — narrow with the filters above.</td></tr>';
    h += '</tbody></table></div>';
    return h;
  }

  function wireCodes(host) {
    var q = host.querySelector('#boq-c-q'), t = null;
    if (q) q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { filt.q = q.value; render(); }, 200); });
    var sh = host.querySelector('#boq-c-sheet'); if (sh) sh.onchange = function () { filt.sheet = sh.value; render(); };
    var sg = host.querySelector('#boq-c-suggest');
    if (sg) sg.onclick = async function () { sg.disabled = true; await ensureSugg(); await ensureCodes(); render(); };
    var aa = host.querySelector('#boq-c-acceptall'); if (aa) aa.onclick = acceptAllProposals;
    host.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { pickCode(b.dataset.pick); }; });
    host.querySelectorAll('[data-accept]').forEach(function (b) {
      b.onclick = function () {
        var r = ITEMS.find(function (x) { return x.id === b.dataset.accept; });
        var s = suggestFor(r);
        if (s) saveMap(r, s.code, 'suggested', s.confidence);
      };
    });
    host.querySelectorAll('[data-unmap]').forEach(function (b) { b.onclick = function () { unmap(b.dataset.unmap); }; });
  }

  async function pickCode(itemId) {
    var r = ITEMS.find(function (x) { return x.id === itemId; });
    if (!r) return;
    await ensureCodes();
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Map to a class code</h2>' +
      '<button class="pd-modal-close" id="pk-x">&times;</button></div>' +
      '<div class="boq-pick"><p class="cc-hint">' + esc(r.description || r.item_no || '') + '</p>' +
      '<input class="pd-input" id="pk-q" placeholder="Search code, division, group or item…" autocomplete="off" />' +
      '<div class="boq-picklist" id="pk-list"></div>' +
      '<p class="cc-hint">⚠️ Never de-zero a code. <code>015051</code> (Gen Req › Earthmoving) is a different code ' +
      'from <code>15051</code> (Metal Works › Railings) — the padded code is the key, which is why this is a ' +
      'picker and not a text box.</p></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="pk-cancel">Cancel</button></div>');
    var q = m.el.querySelector('#pk-q'), list = m.el.querySelector('#pk-list');
    m.el.querySelector('#pk-x').onclick = m.close;
    m.el.querySelector('#pk-cancel').onclick = m.close;
    function paint() {
      var k = normKey(q.value);
      var hits = (CODES || []).filter(function (c) {
        if (!k) return true;
        return (c.code + ' ' + normKey([c.desc_l1, c.desc_l2, c.desc_l3].join(' '))).indexOf(k) >= 0;
      }).slice(0, 120);
      list.innerHTML = hits.length ? hits.map(function (c) {
        return '<button class="boq-pickrow" data-code="' + esc(c.code) + '"><code>' + esc(c.code) + '</code>' +
          '<span>' + esc(c.desc_l1) + ' › ' + esc(c.desc_l2) + ' › <strong>' + esc(c.desc_l3) + '</strong></span></button>';
      }).join('') : '<p class="cc-mut">No codes match. ' + ((CODES || []).length ? '' : 'The class-code chart is empty — run migrations/2026-08-21-class-codes.sql.') + '</p>';
      list.querySelectorAll('[data-code]').forEach(function (b) {
        b.onclick = function () { m.close(); saveMap(r, b.dataset.code, 'hand_picked', null); };
      });
    }
    q.addEventListener('input', paint); paint(); q.focus();
  }

  async function saveMap(r, code, source, confidence) {
    if (!canWrite || !r) return;
    var payload = { project_id: pid, revision_id: REVID, boq_item_id: r.id, class_code: code,
                    source: source, confidence: confidence, created_by: UID };
    var res = await sb().from(T_MAP).upsert(payload, { onConflict: 'boq_item_id' }).select().single();
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    CMAP[r.id] = res.data;
    await learn(r, code);
    render();
  }
  /* The library learns only from ACCEPTED mappings, and records where it last
     saw one so a suggestion can always name its source. */
  async function learn(r, code) {
    var nd = normKey(r.description || ''), pk = pathOf(r);
    if (!nd && !pk) return;
    var existing = (SUGG || []).find(function (s) { return s.norm_desc === nd && s.path_key === pk && s.class_code === code; });
    try {
      if (existing) {
        await sb().from(T_SUGG).update({ hits: (existing.hits || 1) + 1, last_used_at: new Date().toISOString(), last_project_id: pid }).eq('id', existing.id);
        existing.hits = (existing.hits || 1) + 1; existing.last_project_id = pid;
      } else {
        var res = await sb().from(T_SUGG).insert({ norm_desc: nd, path_key: pk, class_code: code, hits: 1, last_project_id: pid }).select().single();
        if (!res.error && res.data) (SUGG = SUGG || []).push(res.data);
      }
    } catch (e) { /* the library is an optimisation; failing to learn must never fail the mapping */ }
  }

  async function unmap(itemId) {
    var res = await sb().from(T_MAP).delete().eq('boq_item_id', itemId);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    delete CMAP[itemId]; render();
  }

  /* Bulk accept, with the count and the confidence floor stated up front.
     ⚠️ Stored as source='bulk_accepted', so a later audit can tell a considered
     mapping from a bulk accept. That distinction is the whole reason the column
     exists. */
  async function acceptAllProposals() {
    await ensureSugg();
    var cands = ITEMS.filter(function (r) { return mappable(r) && !CMAP[r.id]; })
      .map(function (r) { return { r: r, s: suggestFor(r) }; }).filter(function (x) { return x.s; });
    if (!cands.length) { UI.toast('No proposals to accept — run “Propose codes” first.', 'error'); return; }
    var m = UI.modal('<h2 style="margin-top:0;">Accept proposals</h2>' +
      '<p class="cc-hint">' + cands.length + ' unmapped line(s) currently carry a proposal. Accept only those at or above:</p>' +
      '<label>Minimum confidence <select class="pd-select" id="aa-c">' +
        [90, 80, 60, 50].map(function (v) { return '<option value="' + (v / 100) + '"' + (v === 80 ? ' selected' : '') + '>' + v + '%</option>'; }).join('') +
      '</select></label><p class="cc-hint" id="aa-n"></p>' +
      '<div style="text-align:right;margin-top:12px;"><button class="pd-btn" id="aa-x">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="aa-go">Accept</button></div>');
    var sel2 = m.el.querySelector('#aa-c'), note = m.el.querySelector('#aa-n');
    function upd() {
      var min = Number(sel2.value);
      note.textContent = cands.filter(function (x) { return x.s.confidence >= min; }).length + ' line(s) will be mapped, recorded as a bulk accept.';
    }
    sel2.onchange = upd; upd();
    m.el.querySelector('#aa-x').onclick = m.close;
    m.el.querySelector('#aa-go').onclick = async function () {
      var min = Number(sel2.value), take = cands.filter(function (x) { return x.s.confidence >= min; });
      m.close();
      var rowsIns = take.map(function (x) {
        return { project_id: pid, revision_id: REVID, boq_item_id: x.r.id, class_code: x.s.code,
                 source: 'bulk_accepted', confidence: x.s.confidence, created_by: UID };
      });
      for (var i = 0; i < rowsIns.length; i += 300) {
        var res = await sb().from(T_MAP).upsert(rowsIns.slice(i, i + 300), { onConflict: 'boq_item_id' });
        if (res.error) { UI.toast(res.error.message, 'error'); return; }
      }
      UI.toast('Mapped ' + rowsIns.length + ' line(s).', 'success');
      await load();
    };
  }

  // ==========================================================================
  // TAB 3 — Allocations (B1c)
  // ==========================================================================
  /* ⚠️ One class code covers MANY activities: `class_code` on an activity is a
     TAG, not a key — "Rebar Works" is one code carried by forty floor-level
     activities. So a BOQ line cannot be attributed to AN activity; it must be
     ALLOCATED ACROSS them. Three ways, offered in this order:
       1. by LOCATION MATCH — the leaf text ("to Hallway & Lift Lobby at 3rd
          floor") against project_schedule.location. On the fit-out sheets this
          is near-exact, which is why it is tried FIRST and not as an afterthought.
       2. PRO-RATA by activity duration.
       3. BY HAND — always available, and the only defensible option on a
          lump-sum line.
     'Unallocated' is a real, visible state and the planner's worklist. */
  function candidatesFor(r) {
    var cm = CMAP[r.id];
    if (!cm || !ACTS) return [];
    return ACTS.filter(function (a) { return a.class_code === cm.class_code; });
  }
  function locMatch(r, acts) {
    var key = locKey(r.description || '');
    if (!key) return [];
    return acts.filter(function (a) {
      var vals = [];
      if (a.location && typeof a.location === 'object') Object.keys(a.location).forEach(function (k) { if (a.location[k]) vals.push(a.location[k]); });
      return vals.some(function (v) { var lk = locKey(v); return lk && key.indexOf(lk) >= 0; });
    });
  }
  /* Propose a split. ⚠️ RETURNS A PROPOSAL — it writes nothing. An auto-split
     written silently becomes indistinguishable from a planner's own figures,
     which defeats the point of an auditable allocation table. Same rule the
     schedule's location wizard already follows: propose → preview → apply. */
  function proposeSplit(r, acts) {
    var q = Number(r.qty) || 0;
    if (!q || !acts.length) return { method: null, parts: [] };
    var loc = locMatch(r, acts);
    if (loc.length) {
      // A location match is a statement about WHERE, so an equal split across
      // the matched locations is the honest reading — not a duration weighting,
      // which would silently make a slower floor take more of the quantity.
      var each = q / loc.length;
      return { method: 'location', parts: loc.map(function (a) { return { activity_id: a.activity_id, name: a.activity_name, qty: each }; }) };
    }
    var totalDur = acts.reduce(function (s, a) { return s + (Number(a.duration_days) || 0); }, 0);
    if (totalDur > 0) {
      return { method: 'prorata', parts: acts.map(function (a) {
        return { activity_id: a.activity_id, name: a.activity_name, qty: q * (Number(a.duration_days) || 0) / totalDur }; }) };
    }
    var e2 = q / acts.length;
    return { method: 'prorata', parts: acts.map(function (a) { return { activity_id: a.activity_id, name: a.activity_name, qty: e2 }; }) };
  }

  function allocHTML() {
    var lines = ITEMS.filter(qtyLine);
    var mapped = lines.filter(function (r) { return CMAP[r.id]; });
    var done = mapped.filter(function (r) { return allocOf(r.id).length; });
    var over = lines.filter(function (r) { return allocSum(allocOf(r.id)) > (Number(r.qty) || 0) + 1e-6; });

    var h = '<div class="cc-kpis">' +
      kpi('Measured lines', lines.length, 'carry an allocatable quantity') +
      kpi('Mapped', mapped.length, 'have a class code to allocate along') +
      kpi('Allocated', done.length, (mapped.length - done.length) + ' still unallocated', done.length === mapped.length && mapped.length ? 'good' : 'warn') +
      kpi('Over-allocated', over.length, 'Σ allocated exceeds the line qty', over.length ? 'bad' : '') +
      kpi('Activities', ACTS ? ACTS.length : '—', 'leaf activities loaded') +
      '</div>';

    if (over.length) {
      h += '<div class="boq-alert bad"><strong>' + over.length + ' line' + (over.length === 1 ? '' : 's') +
        ' allocate more quantity than the BOQ line carries.</strong> Silent over-allocation is a wrong S-curve — ' +
        'fix these before anything downstream reads the derived activity quantities.</div>';
    }

    h += '<p class="cc-hint">A class code is a <strong>tag</strong>, not a key — one code is carried by many activities — ' +
      'so a BOQ line is allocated <em>across</em> them: by location match first, then pro-rata by duration, then by hand. ' +
      '<strong>A proposal is never stored until you apply it.</strong> An activity\'s quantity is derived from these ' +
      'allocations; there is deliberately no quantity column on the activity.</p>';

    if (!ACTS) {
      h += '<div class="pd-card cc-empty"><h3>Schedule not loaded</h3><p>The allocator needs this project\'s leaf activities ' +
        'and their class codes.</p><p><button class="pd-btn pd-btn-primary" id="boq-a-load">Load schedule</button></p></div>';
      return h;
    }

    h += '<div class="boq-filters">' +
      '<input class="pd-input" id="boq-a-q" placeholder="Search lines…" value="' + esc(filt.q) + '" />' +
      (canWrite ? '<button class="pd-btn" id="boq-a-auto">Propose splits for all unallocated…</button>' : '') +
      '</div>';

    h += '<div class="pd-card cc-tablecard"><table class="cc-table boq-table"><thead><tr>' +
      '<th class="cc-desc">Line</th><th>Class code</th><th class="cc-r">BOQ qty</th>' +
      '<th class="cc-r">Allocated</th><th class="cc-r">Remainder</th><th class="cc-r">Activities</th><th>Method</th>' +
      (canWrite ? '<th class="cc-actcol"></th>' : '') + '</tr></thead><tbody>';
    var list = mapped.filter(function (r) { return !filt.q || normKey([r.item_no, r.description].join(' ')).indexOf(normKey(filt.q)) >= 0; });
    // Unallocated first — this table IS the worklist.
    list.sort(function (a, b) { return allocOf(a.id).length - allocOf(b.id).length; });
    if (!list.length) h += '<tr><td colspan="8" class="cc-mut" style="text-align:center;padding:30px;">No mapped measured lines yet — map class codes first.</td></tr>';
    list.slice(0, 300).forEach(function (r) {
      var al = allocOf(r.id), s = allocSum(al), q = Number(r.qty) || 0, rem = q - s;
      h += '<tr data-id="' + esc(r.id) + '">' +
        '<td class="cc-desc"><div class="cc-desc-txt">' + esc(r.description || '') + '</div>' +
          '<div class="cc-mini">' + esc(r.sheet) + ' · row ' + r.source_row + ' · ' + esc(r.unit || '') + '</div></td>' +
        '<td><span class="boq-code">' + esc(CMAP[r.id].class_code) + '</span></td>' +
        '<td class="cc-r">' + qtyStr(q) + '</td>' +
        '<td class="cc-r">' + qtyStr(s) + '</td>' +
        '<td class="cc-r' + (rem < -1e-6 ? ' boq-bad' : '') + '">' + qtyStr(rem) + '</td>' +
        '<td class="cc-r">' + al.length + '</td>' +
        '<td>' + esc(al.length ? al[0].method : '') + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-split="' + esc(r.id) + '">Allocate…</button></td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function wireAlloc(host) {
    var l = host.querySelector('#boq-a-load');
    if (l) l.onclick = async function () { l.disabled = true; l.textContent = 'Loading…'; await ensureActs(); render(); };
    var q = host.querySelector('#boq-a-q'), t = null;
    if (q) q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { filt.q = q.value; render(); }, 200); });
    host.querySelectorAll('[data-split]').forEach(function (b) { b.onclick = function () { openSplit(b.dataset.split); }; });
    var au = host.querySelector('#boq-a-auto'); if (au) au.onclick = bulkPropose;
  }

  function openSplit(itemId) {
    var r = ITEMS.find(function (x) { return x.id === itemId; });
    if (!r) return;
    var acts = candidatesFor(r);
    var existing = allocOf(r.id);
    var prop = existing.length
      ? { method: existing[0].method, parts: existing.map(function (a) { var ac = acts.find(function (x) { return x.activity_id === a.activity_id; }); return { activity_id: a.activity_id, name: ac ? ac.activity_name : '', qty: Number(a.qty) }; }) }
      : proposeSplit(r, acts);

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Allocate quantity</h2>' +
      '<button class="pd-modal-close" id="sp-x">&times;</button></div>' +
      '<div class="boq-split" id="sp-body"></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="sp-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="sp-go">Apply</button></div>');
    var body = m.el.querySelector('#sp-body');

    function paint() {
      var q = Number(r.qty) || 0, s = prop.parts.reduce(function (a, p) { return a + (Number(p.qty) || 0); }, 0);
      var rem = q - s;
      body.innerHTML =
        '<p class="cc-hint"><strong>' + esc(r.description || '') + '</strong><br>' +
        esc(r.sheet) + ' row ' + r.source_row + ' · ' + qtyStr(q) + ' ' + esc(r.unit || '') +
        ' · class code <code>' + esc((CMAP[r.id] || {}).class_code || '') + '</code></p>' +
        (prop.method ? '<p class="cc-hint">Proposed by <strong>' + esc(prop.method === 'location' ? 'location match' : prop.method) + '</strong>. ' +
          'Adjust any figure, then Apply. Nothing is stored until you do.</p>' : '') +
        (acts.length ? '' : '<div class="boq-alert warn">No activity on this project carries class code <code>' +
          esc((CMAP[r.id] || {}).class_code || '') + '</code>. Allocate by hand, or tag the activities first.</div>') +
        '<table class="boq-splittab"><thead><tr><th>Activity</th><th class="cc-r">Qty</th><th></th></tr></thead><tbody>' +
        prop.parts.map(function (p, i) {
          return '<tr><td><code>' + esc(p.activity_id) + '</code> <span class="cc-mini">' + esc(p.name || '') + '</span></td>' +
            '<td class="cc-r"><input class="pd-input boq-qin" type="number" step="0.001" data-i="' + i + '" value="' + esc(p.qty) + '" /></td>' +
            '<td><button class="pd-btn" data-rm="' + i + '" title="Remove">&times;</button></td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="boq-splitadd"><select class="pd-select" id="sp-add"><option value="">Add an activity…</option>' +
          (ACTS || []).slice(0, 800).map(function (a) {
            return '<option value="' + esc(a.activity_id) + '">' + esc(a.activity_id + ' — ' + (a.activity_name || '')) + '</option>'; }).join('') +
        '</select></div>' +
        // ⚠️ The remainder is always shown, both ways. Silent over-allocation is
        // a wrong S-curve, and a silent shortfall is work nobody has planned.
        '<p class="boq-recon ' + (Math.abs(rem) < 1e-6 ? 'ok' : rem < 0 ? 'bad' : 'warn') + '">' +
          'Allocated ' + qtyStr(s) + ' of ' + qtyStr(q) + ' — ' +
          (Math.abs(rem) < 1e-6 ? 'reconciles exactly.' : rem > 0 ? qtyStr(rem) + ' ' + esc(r.unit || '') + ' still unallocated.' :
            '<strong>over-allocated by ' + qtyStr(-rem) + '</strong>.') + '</p>';

      body.querySelectorAll('.boq-qin').forEach(function (inp) {
        inp.onchange = function () { prop.parts[+inp.dataset.i].qty = Number(inp.value) || 0; prop.method = 'manual'; paint(); };
      });
      body.querySelectorAll('[data-rm]').forEach(function (b) {
        b.onclick = function () { prop.parts.splice(+b.dataset.rm, 1); prop.method = 'manual'; paint(); };
      });
      var add = body.querySelector('#sp-add');
      add.onchange = function () {
        var aid = add.value; if (!aid) return;
        if (prop.parts.some(function (p) { return p.activity_id === aid; })) { add.value = ''; return; }
        var a = (ACTS || []).find(function (x) { return x.activity_id === aid; });
        prop.parts.push({ activity_id: aid, name: a ? a.activity_name : '', qty: Math.max(0, rem) });
        prop.method = 'manual'; paint();
      };
    }
    paint();
    m.el.querySelector('#sp-x').onclick = m.close;
    m.el.querySelector('#sp-cancel').onclick = m.close;
    m.el.querySelector('#sp-go').onclick = async function () {
      var parts = prop.parts.filter(function (p) { return p.activity_id && Number(p.qty); });
      // Replace-then-insert: an allocation set is one decision, so a partial
      // overwrite would leave a mixture of two planners' splits on one line.
      var del = await sb().from(T_ALLOC).delete().eq('boq_item_id', r.id);
      if (del.error) { UI.toast(del.error.message, 'error'); return; }
      if (parts.length) {
        var ins = await sb().from(T_ALLOC).insert(parts.map(function (p) {
          return { project_id: pid, boq_item_id: r.id, activity_id: p.activity_id,
                   qty: Number(p.qty), method: prop.method || 'manual', accepted_by: UID };
        }));
        if (ins.error) { UI.toast(ins.error.message, 'error'); return; }
      }
      m.close();
      ALLOC = ALLOC.filter(function (a) { return a.boq_item_id !== r.id; })
        .concat(parts.map(function (p) { return { boq_item_id: r.id, activity_id: p.activity_id, qty: Number(p.qty), method: prop.method || 'manual', project_id: pid }; }));
      UI.toast('Allocation applied.', 'success'); render();
    };
  }

  /* Bulk propose. ⚠️ Still propose → preview → APPLY: it shows what it would
     write and how many lines it cannot resolve, and writes nothing until the
     planner accepts. */
  async function bulkPropose() {
    await ensureActs();
    var todo = ITEMS.filter(function (r) { return qtyLine(r) && CMAP[r.id] && !allocOf(r.id).length; });
    var plans = todo.map(function (r) { return { r: r, p: proposeSplit(r, candidatesFor(r)) }; });
    var ok = plans.filter(function (x) { return x.p.parts.length; });
    var none = plans.length - ok.length;
    var byLoc = ok.filter(function (x) { return x.p.method === 'location'; }).length;
    var m = UI.modal('<h2 style="margin-top:0;">Propose allocations</h2>' +
      '<p class="cc-hint">' + plans.length + ' unallocated mapped line(s). <strong>' + ok.length + '</strong> can be split: ' +
      byLoc + ' by location match, ' + (ok.length - byLoc) + ' pro-rata by activity duration. ' +
      '<strong>' + none + '</strong> cannot — no activity on this project carries their class code, so they stay ' +
      'unallocated rather than being spread over something arbitrary.</p>' +
      '<p class="cc-hint">Applying records each split with its method, so a later audit can tell a proposal from a ' +
      'hand-made decision.</p>' +
      '<div style="text-align:right;margin-top:12px;"><button class="pd-btn" id="bp-x">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="bp-go"' + (ok.length ? '' : ' disabled') + '>Apply ' + ok.length + ' split(s)</button></div>');
    m.el.querySelector('#bp-x').onclick = m.close;
    m.el.querySelector('#bp-go').onclick = async function () {
      m.close();
      var payload = [];
      ok.forEach(function (x) {
        x.p.parts.forEach(function (p) {
          payload.push({ project_id: pid, boq_item_id: x.r.id, activity_id: p.activity_id,
                         qty: Number(p.qty), method: x.p.method, accepted_by: UID });
        });
      });
      for (var i = 0; i < payload.length; i += 300) {
        var res = await sb().from(T_ALLOC).upsert(payload.slice(i, i + 300), { onConflict: 'boq_item_id,activity_id' });
        if (res.error) { UI.toast(res.error.message, 'error'); return; }
      }
      UI.toast('Applied ' + ok.length + ' allocation(s).', 'success');
      await load();
    };
  }

  // ==========================================================================
  // TAB 4 — Billing / POC (B1d)
  // ==========================================================================
  function billingHTML() {
    var rev = REVS.find(function (r) { return r.id === REVID; }) || {};
    var contract = rev.contract_total != null ? Number(rev.contract_total) : contractSum(ITEMS);
    var ord = periodsOrdered();
    var cur = ord[ord.length - 1] || null;
    var relCur = cur ? (PROG[cur.id] || {}) : {};
    var tot = periodTotals(ITEMS, relCur, contract);
    var prev = cur ? prevPeriodOf(cur) : null;
    var totPrev = prev ? periodTotals(ITEMS, PROG[prev.id] || {}, contract) : { revenue: 0, poc: 0 };

    var h = '<div class="cc-kpis">' +
      kpi('Contract', money(contract), 'basis for POC and revenue') +
      kpi('POC to date', pct(tot.poc, 4), cur ? 'billing ' + esc(cur.billing_no) : 'no billing yet') +
      kpi('This period', pct(tot.poc == null ? null : tot.poc - (totPrev.poc || 0), 4), 'movement since the prior billing') +
      kpi('Revenue to date', money(tot.revenue), 'contract × POC', 'good') +
      kpi('Materials / Labour', money(tot.materials) + ' / ' + money(tot.labor), 'split survives into revenue') +
      /* ⚠️ Shown ONLY once a claimed figure exists on this billing. A permanent
         "Dispute ₱0.00" tile would assert agreement nobody recorded. */
      (function () {
        var d = cur ? disputeOf(cur.id) : null;
        return (d && d.nClaims)
          ? kpi('In dispute', money(d.disputed), d.nDisputed + ' line(s) claimed but not certified', d.disputed ? 'warn' : 'good')
          : '';
      })() +
      '</div>';

    h += '<p class="cc-hint"><strong>Only <code>rel_pct</code> is stored.</strong> WT %, %Wt. and Amt. are pure functions of ' +
      'the line amount, its sheet total and rel_pct — persisting them means they silently disagree with the BOQ the ' +
      'moment a revision changes a quantity. Each period also snapshots the revision it was billed against, so a ' +
      'remeasure cannot retroactively rewrite a submitted billing.</p>';

    h += pocCompareHTML(tot, contract, cur);

    h += '<div class="boq-filters">' + (canWrite ? '<button class="pd-btn pd-btn-primary" id="boq-b-new">New billing period…</button>' : '') + '</div>';

    if (!ord.length) {
      h += '<div class="pd-card cc-empty"><h3>No billing periods yet</h3><p>A billing period is the BOQ plus one number ' +
        'per line: its cumulative relative percentage. Everything else is derived.</p></div>';
      return h;
    }

    h += '<div class="pd-card cc-tablecard"><table class="cc-table"><thead><tr>' +
      '<th>Billing</th><th>Period</th><th>PO</th><th>Revision</th><th>Status</th>' +
      '<th class="cc-r">POC</th><th class="cc-r">This period</th><th class="cc-r">Revenue to date</th>' +
      (canWrite ? '<th class="cc-actcol"></th>' : '') + '</tr></thead><tbody>';
    ord.forEach(function (p, i) {
      var t = periodTotals(ITEMS, PROG[p.id] || {}, p.contract_total != null ? Number(p.contract_total) : contract);
      var pv = i > 0 ? periodTotals(ITEMS, PROG[ord[i - 1].id] || {}, p.contract_total != null ? Number(p.contract_total) : contract) : { poc: 0 };
      var pr = REVS.find(function (r) { return r.id === p.revision_id; });
      h += '<tr data-per="' + esc(p.id) + '">' +
        '<td><strong>' + esc(p.billing_no) + '</strong></td>' +
        '<td>' + esc((p.period_start || '?') + ' → ' + (p.period_end || '?')) + '</td>' +
        '<td>' + esc(p.po_no || '') + '</td>' +
        '<td>' + esc(pr ? 'rev ' + pr.rev_no : '—') + '</td>' +
        '<td><span class="boq-kind k-' + esc(p.status) + '">' + esc(p.status) + '</span></td>' +
        '<td class="cc-r">' + pct(t.poc, 4) + '</td>' +
        '<td class="cc-r">' + pct(t.poc == null ? null : t.poc - (pv.poc || 0), 4) + '</td>' +
        '<td class="cc-r">' + money(t.revenue) + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-editper="' + esc(p.id) + '">Progress…</button></td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>';

    h += monthlyHTML(contract);

    // Per-sheet breakdown. ⚠️ These POCs are per SHEET and must NOT be averaged
    // into a project figure — ACOUSTIC is 1.65% of the contract and
    // Architectural 87.90%, so an average would let the small trade move the
    // project POC as much as the big one. The project figure above is
    // Σ(amount × rel) / contract, which is the trade-share re-weighting.
    if (cur) {
      var sp = sheetPocs(ITEMS, relCur), st = sheetTotals(ITEMS);
      h += '<div class="pd-card cc-tablecard"><h3 class="boq-h3">Per-sheet weighting — billing ' + esc(cur.billing_no) + '</h3>' +
        '<table class="cc-table"><thead><tr><th>Sheet</th><th class="cc-r">Sheet total</th>' +
        '<th class="cc-r">Share of contract</th><th class="cc-r">Sheet POC</th><th class="cc-r">Amount to date</th>' +
        '</tr></thead><tbody>';
      Object.keys(st).sort().forEach(function (s) {
        var x = sp[s] || { poc: 0, amt: 0 };
        h += '<tr><td>' + esc(s) + '</td><td class="cc-r">' + money(st[s]) + '</td>' +
          '<td class="cc-r">' + pct(contract ? st[s] / contract : null) + '</td>' +
          '<td class="cc-r">' + pct(x.poc, 4) + '</td><td class="cc-r">' + money(x.amt) + '</td></tr>';
      });
      h += '<tr class="cc-total"><td><strong>Project</strong></td><td class="cc-r">' + money(contract) + '</td>' +
        '<td class="cc-r">100.00%</td><td class="cc-r"><strong>' + pct(tot.poc, 4) + '</strong></td>' +
        '<td class="cc-r"><strong>' + money(tot.revenue) + '</strong></td></tr>';
      h += '</tbody></table>' +
        '<p class="cc-hint">⚠️ These are the <em>certified</em> percentages — what the client has already paid ' +
        'against. The schedule\'s S-curve is <em>reported</em> progress, and the two must not be silently merged: ' +
        'their difference is the accrual shown above, never an error to correct in either direction.</p></div>';
    }
    return h;
  }

  /* DECISION #6, on screen. The contractual periods stay exactly as they are in
     the table above; this is the same money re-cut at calendar month ends so it
     can sit beside Cash Flow and the S-curve without either being bent.
     ⚠️ NOTHING HERE IS AN INPUT. Editing a month is impossible by design — the
     only stored number is still rel_pct, per line, per billing period. */
  function monthlyHTML(contract) {
    var mr = monthlyRevenue(ITEMS, contract);
    if (!mr.rows.length && !mr.undated.length) return '';

    var h = '<div class="pd-card cc-tablecard"><h3 class="boq-h3">Monthly reporting view — each period cut at month end</h3>' +
      '<p class="cc-hint"><strong>Reporting only — the contract is untouched.</strong> A billing period runs 26th → 25th ' +
      'because that is a commercial term, and it stays that way above. Cash Flow and the S-curve are monthly, so here each ' +
      'period\'s <em>increment</em> (its revenue less the prior period\'s to-date) is spread straight-line across the calendar ' +
      'days it spans and assigned to the months those days fall in. The straight line is the single assumption in this table, ' +
      'and it is a reporting convention — never a measurement, never written back.</p>';

    if (mr.rows.length) {
      h += '<table class="cc-table"><thead><tr><th>Month</th><th class="cc-r">Revenue in month</th>' +
        '<th class="cc-r">Cumulative</th><th class="cc-r">Materials</th><th class="cc-r">Labour</th>' +
        '<th>From billing</th><th class="cc-r">Days covered</th></tr></thead><tbody>';
      mr.rows.forEach(function (r) {
        h += '<tr><td><strong>' + esc(r.label) + '</strong></td>' +
          '<td class="cc-r">' + money(r.revenue) + '</td>' +
          '<td class="cc-r">' + money(r.cumulative) + '</td>' +
          '<td class="cc-r">' + money(r.materials) + '</td>' +
          '<td class="cc-r">' + money(r.labor) + '</td>' +
          '<td class="cc-mini">' + esc(r.from.join(', ')) + '</td>' +
          '<td class="cc-r' + (r.full ? '' : ' cc-mini') + '">' + r.days + ' / ' + r.daysInMonth +
            (r.full ? '' : ' <span class="boq-kind k-draft">part</span>') + '</td></tr>';
      });
      h += '<tr class="cc-total"><td><strong>Total</strong></td><td class="cc-r"><strong>' + money(mr.total) + '</strong></td>' +
        '<td class="cc-r"></td><td class="cc-r"></td><td class="cc-r"></td><td></td><td class="cc-r"></td></tr>';
      h += '</tbody></table>';
    }

    /* ⚠️ A PART-COVERED MONTH IS NORMAL AT BOTH ENDS AND MEANS DIFFERENT THINGS.
       The first month is short because the project started mid-month; the last
       is short because the next billing has not been raised. Neither is a defect,
       and neither is filled in. */
    if (mr.coveredTo != null && mr.gapDays > 0) {
      h += '<p class="cc-hint">Billing is certified to <strong>' + esc(isoOf(mr.coveredTo)) + '</strong>, so ' +
        esc(monthLabel(monthKey(mr.coveredTo))) + ' is short its last <strong>' + mr.gapDays + ' day(s)</strong>. ' +
        'Those days are left blank rather than accrued: nobody has certified them, and filling them from the schedule\'s ' +
        'progress would push the other POC (decision #7) into a revenue figure — the one merge this module refuses.</p>';
    }
    if (mr.undated.length) {
      h += '<p class="cc-hint">⚠️ <strong>' + mr.undated.length + ' billing period(s) fall in no month</strong> — ' +
        esc(mr.undated.map(function (u) { return u.p.billing_no; }).join(', ')) +
        ' — because the period end date is missing. Their revenue is excluded from the table above rather than guessed into a ' +
        'month, so the Total here is below Revenue to date until those dates are set.</p>';
    }
    return h + '</div>';
  }

  /* DECISION #7 — REFRAMED 2026-08-26. Still "neither leads", but the gap now
     has a name and a peso figure instead of only a percentage.

     The owner's point: the S-curve IS actual progress, the client verifies it,
     and the contractor bills against what was verified. So the two figures are
     not two rival opinions of the same thing — they are the SAME work at two
     stages of the same pipeline:
        done (reported)  →  certified (billed)  →  paid
     and the distance between the first two is ACCRUED REVENUE — work performed
     and not yet certified, an unbilled receivable.

     ⚠️ ONE CORRECTION TO THAT PICTURE, AND IT MATTERS. The schedule figure here
     is `percent_complete` typed on the programme (schedule_scurve_agg weights
     it by duration or cost). It is CONTRACTOR-REPORTED, not client-verified —
     nothing in this app records a client's verification of a schedule activity.
     So the gap is accrual PLUS whatever the client would knock off on
     inspection, and the two are not separable from what is stored.

     ⚠️ DISPUTE IS THEREFORE NOT MEASURABLE YET, and this panel says so rather
     than implying it is. A dispute is claimed-minus-certified, and boq_progress
     holds ONE rel_pct per line — the certified one. Measuring dispute needs a
     claimed figure stored beside it; that is a schema decision, not something
     to fake from the schedule.

     ⚠️ STILL NO WRITE-BACK, IN EITHER DIRECTION. The accrual is a report. */
  function pocCompareHTML(tot, contract, cur) {
    var bill = tot.poc, prog = schedPoc();
    var h = '<div class="pd-card boq-poc">' +
      '<h3 class="boq-h3">Reported, certified, and the accrual between them</h3>';

    if (prog == null) {
      h += '<p class="cc-hint">' + (schedErr
        ? 'The schedule\'s own progress could not be read (' + esc(schedErr.message || String(schedErr)) + ').'
        : 'This project has no loaded schedule, so there is no reported progress to compare against.') +
        ' The certified POC above stands on its own, and no accrual can be computed.' +
        (schedErr && /schedule_scurve_agg/.test(String(schedErr.message || ''))
          ? ' Run <code>migrations/2026-07-20-schedule-scurve-agg.sql</code>.' : '') + '</p></div>';
      return h;
    }

    /* Signed so that POSITIVE = work done and not yet certified = money the
       contractor is owed but cannot yet invoice. Negative is the other way and
       is the more serious of the two: billing has run ahead of the work. */
    var accrPct = (bill == null) ? null : prog - bill;
    var accrAmt = (accrPct == null || !contract) ? null : accrPct * contract;
    var cls = accrPct == null ? '' : Math.abs(accrPct) < 0.02 ? 'ok' : Math.abs(accrPct) < 0.10 ? 'warn' : 'bad';
    h += '<div class="boq-poc-row">' +
      '<div class="boq-poc-cell"><span class="cc-mini">Reported (the schedule)</span>' +
        '<div class="boq-poc-v">' + pct(prog, 4) + '</div>' +
        '<span class="cc-mini">contractor-reported, ' + (Number(SCHED.nAct) || 0) + ' activities</span></div>' +
      '<div class="boq-poc-cell"><span class="cc-mini">Certified (billed)</span>' +
        '<div class="boq-poc-v">' + pct(bill, 4) + '</div>' +
        '<span class="cc-mini">what the client pays against</span></div>' +
      '<div class="boq-poc-cell ' + cls + '"><span class="cc-mini">' +
        (accrPct == null || accrPct >= 0 ? 'Accrued — done, not yet certified' : 'Billed ahead of the work') + '</span>' +
        '<div class="boq-poc-v">' + (accrAmt == null ? '—' : money(Math.abs(accrAmt))) + '</div>' +
        '<span class="cc-mini">' + (accrPct == null ? 'nothing billed yet'
          : (accrPct >= 0 ? '+' : '') + (accrPct * 100).toFixed(2) + ' pp · ' +
            (accrPct >= 0 ? 'unbilled receivable' : 'certified beyond reported progress')) + '</span></div>' +
      '</div>';

    h += '<p class="cc-hint"><strong>The same work at two stages, not two rival numbers.</strong> ' +
      'Work is reported on the programme, certified by the client, then paid. The distance between the first two is ' +
      '<strong>accrued revenue</strong> — earned, not yet invoiceable. ' +
      (accrPct != null && accrPct < 0
        ? '⚠️ Here it runs the <em>other</em> way: certification is ahead of reported progress, which is either ' +
          'front-loaded measurement, an advance, or a programme that has not been updated. Worth resolving before the ' +
          'next billing.'
        : 'Carry it as an unbilled receivable in the accrual, and it converts to AR at the next certification.') + '</p>';

    /* DECISION #7's SECOND HALF, now measurable. The accrual splits into the two
       things a commercial manager treats completely differently:
         · claimed and not certified  → in DISPUTE, argue it
         · not claimed at all         → not yet submitted, bill it
       ⚠️ The split only appears once a claimed figure exists. With none recorded,
          claiming a zero dispute would be a statement nobody made. */
    var dsp = cur ? disputeOf(cur.id) : null;
    if (dsp && (dsp.nClaims || dsp.disputed || dsp.over)) {
      var unclaimed = (accrAmt != null && accrAmt > 0) ? Math.max(0, accrAmt - dsp.disputed) : null;
      h += '<div class="boq-poc-row">' +
        '<div class="boq-poc-cell ' + (dsp.disputed ? 'warn' : 'ok') + '"><span class="cc-mini">In dispute (claimed, not certified)</span>' +
          '<div class="boq-poc-v">' + money(dsp.disputed) + '</div>' +
          '<span class="cc-mini">' + dsp.nDisputed + ' line' + (dsp.nDisputed === 1 ? '' : 's') + ' cut by the client</span></div>' +
        '<div class="boq-poc-cell"><span class="cc-mini">Not yet claimed</span>' +
          '<div class="boq-poc-v">' + (unclaimed == null ? '—' : money(unclaimed)) + '</div>' +
          '<span class="cc-mini">' + (unclaimed == null ? 'no accrual to split' : 'reported done, never submitted') + '</span></div>' +
        '<div class="boq-poc-cell ' + (dsp.over ? 'bad' : '') + '"><span class="cc-mini">⚠️ Certified above claimed</span>' +
          '<div class="boq-poc-v">' + money(dsp.over) + '</div>' +
          '<span class="cc-mini">' + (dsp.nOver ? dsp.nOver + ' line(s) — check the entry' : 'none') + '</span></div>' +
        '</div>' +
        '<p class="cc-hint"><strong>Dispute is claimed minus certified, per line, on billing ' + esc(cur.billing_no) + '.</strong> ' +
        'Lines with no claimed figure recorded are read as <em>claimed = certified</em>, never as claimed-zero, so they ' +
        'add nothing to the dispute. ' + dsp.nClaims + ' line(s) carry a claimed figure. ' +
        '⚠️ The two are <strong>not netted</strong>: certification above what was claimed is almost always a keying ' +
        'error, and cancelling it against genuine disputes elsewhere would hide both.</p>';
    } else if (accrPct != null && accrPct > 0) {
      h += '<p class="cc-hint"><strong>No claimed figures recorded on this billing</strong>, so the accrual above cannot ' +
        'yet be split into <em>disputed</em> and <em>not yet submitted</em>. Enter Claimed % beside Certified % in the ' +
        'Progress dialog and both appear here. ⚠️ Absent claims are read as <em>claimed = certified</em> — never as a ' +
        'dispute of the whole amount.</p>';
    }

    /* ⚠️ THE HONEST LIMIT, ON SCREEN. Overstating what the number proves is how
       an accrual figure ends up in a report nobody can defend. */
    h += '<p class="cc-hint">⚠️ <strong>The reported figure is the contractor\'s own.</strong> It is ' +
      '<code>percent_complete</code> entered on the programme; nothing in this app records the client\'s verification ' +
      'of a schedule activity. So this accrual is <em>work claimed as done and not yet certified</em>, which includes ' +
      'anything the client would still knock off on inspection. ' +
      '<strong>Dispute is a different measurement</strong>, taken from the claimed figures below, and it only covers ' +
      'what was actually submitted — work reported on the programme but never put in a billing is not disputed, it is ' +
      'simply unclaimed.</p>';

    h += (contract && Math.abs(contract - contractSum(ITEMS)) > 1
        ? '<p class="cc-hint">⚠️ The certified figure is computed on the revision\'s stated contract total, which ' +
          'differs from the sum of its lines — see the reconciliation warning on the Items tab.</p>' : '') +
      '</div>';
    return h;
  }

  function wireBilling(host) {
    var n = host.querySelector('#boq-b-new'); if (n) n.onclick = newPeriod;
    host.querySelectorAll('[data-editper]').forEach(function (b) { b.onclick = function () { openProgress(b.dataset.editper); }; });
  }

  function newPeriod() {
    var ord = periodsOrdered(), last = ord[ord.length - 1];
    var rev = REVS.find(function (r) { return r.id === REVID; }) || {};
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">New billing period</h2>' +
      '<button class="pd-modal-close" id="np-x">&times;</button></div>' +
      '<div class="boq-imp-grid">' +
      '<label>Billing no.<input class="pd-input" id="np-no" value="' + esc(last ? String(Number(last.billing_no) + 1 || '') : '1') + '" /></label>' +
      '<label>Period start<input class="pd-input" id="np-s" type="date" /></label>' +
      '<label>Period end<input class="pd-input" id="np-e" type="date" /></label>' +
      '<label>PO no.<input class="pd-input" id="np-po" value="' + esc(rev.po_no || '') + '" /></label>' +
      '</div>' +
      '<p class="cc-hint">⚠️ A billing period is <strong>not a calendar month</strong> — the real ones run 26th to 25th. ' +
      'Cash Flow and the S-curve are monthly, so the mapping from a period to a month stays explicit rather than assumed.<br>' +
      'This period is billed against <strong>revision ' + esc(rev.rev_no || '?') + '</strong> and keeps that snapshot even if a ' +
      'later remeasure changes the BOQ.' +
      (last ? '<br>Progress starts from billing ' + esc(last.billing_no) + '\'s to-date figures — <code>previous</code> is never ' +
        'stored, it <em>is</em> the prior period\'s to-date.' : '') + '</p>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="np-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="np-go">Create</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('np-x').onclick = m.close; el('np-c').onclick = m.close;
    el('np-go').onclick = async function () {
      var no = (el('np-no').value || '').trim();
      if (!no) { UI.toast('Give the billing a number.', 'error'); return; }
      var res = await sb().from(T_PER).insert({
        project_id: pid, revision_id: REVID, billing_no: no,
        period_start: el('np-s').value || null, period_end: el('np-e').value || null,
        po_no: (el('np-po').value || '').trim() || null,
        contract_total: rev.contract_total != null ? rev.contract_total : contractSum(ITEMS),
        status: 'draft', created_by: UID
      }).select().single();
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
      // Seed from the prior period's to-date, because a cumulative figure never
      // goes backwards and re-typing 1,200 lines is not a workflow.
      if (last && PROG[last.id]) {
        var lastClaim = CLAIM[last.id] || {};
        var seed = Object.keys(PROG[last.id]).map(function (iid) {
          return { project_id: pid, period_id: res.data.id, boq_item_id: iid, rel_pct: PROG[last.id][iid],
                   /* Claimed is cumulative too, so it seeds from the prior claim —
                      but only where one was recorded. Seeding it from the certified
                      figure would erase the very difference it exists to hold. */
                   rel_pct_claimed: lastClaim[iid] == null ? null : lastClaim[iid],
                   created_by: UID };
        });
        for (var i = 0; i < seed.length; i += 400) {
          var sres = await sb().from(T_PROG).insert(seed.slice(i, i + 400));
          // Un-run migration: seed the certified half rather than seeding nothing.
          if (sres && sres.error && /rel_pct_claimed/.test(sres.error.message || '')) {
            await sb().from(T_PROG).insert(seed.slice(i, i + 400).map(function (x) {
              return { project_id: x.project_id, period_id: x.period_id, boq_item_id: x.boq_item_id,
                       rel_pct: x.rel_pct, created_by: x.created_by };
            }));
          }
        }
      }
      m.close(); UI.toast('Billing period ' + no + ' created.', 'success');
      await load(); openProgress(res.data.id);
    };
  }

  function openProgress(perId) {
    var p = PERIODS.find(function (x) { return x.id === perId; });
    if (!p) return;
    var rel = Object.assign({}, PROG[perId] || {});
    /* Claimed is a SEPARATE map with separate emptiness: an absent entry means
       "no claim recorded", which reads as equal to certified — not as zero. */
    var claim = Object.assign({}, CLAIM[perId] || {});
    var prev = prevPeriodOf(p), relPrev = prev ? (PROG[prev.id] || {}) : {};
    var contract = p.contract_total != null ? Number(p.contract_total) : contractSum(ITEMS);
    var st = sheetTotals(ITEMS);
    var lines = ITEMS.filter(moneyLine);
    var q = '';

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Progress — billing ' + esc(p.billing_no) + '</h2>' +
      '<button class="pd-modal-close" id="pg-x">&times;</button></div>' +
      '<div class="boq-prog" id="pg-body"></div>' +
      '<div class="pd-modal-footer"><span class="cc-mini" id="pg-sum"></span> ' +
      '<button class="pd-btn" id="pg-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="pg-go">Save progress</button></div>');
    var body = m.el.querySelector('#pg-body'), sumEl = m.el.querySelector('#pg-sum');

    function paint() {
      var t = periodTotals(ITEMS, rel, contract);
      /* Live dispute while typing, from the maps being edited rather than from
         the loaded CLAIM/PROG — otherwise the footer reports the last save. */
      var dsp = 0, dspN = 0, ovr = 0;
      lines.forEach(function (r2) {
        var cert = Number(rel[r2.id] || 0);
        var clm = claim[r2.id] == null ? cert : Number(claim[r2.id]);
        var d = (clm - cert) * Number(r2.amount);
        if (d > 0) { dsp += d; dspN++; } else if (d < 0) { ovr += -d; }
      });
      sumEl.innerHTML = 'POC <strong>' + pct(t.poc, 4) + '</strong> · revenue <strong>' + money(t.revenue) + '</strong>' +
        (dsp ? ' · in dispute <strong>' + money(dsp) + '</strong> (' + dspN + ' line' + (dspN === 1 ? '' : 's') + ')' : '') +
        (ovr ? ' · ⚠️ certified above claimed <strong>' + money(ovr) + '</strong>' : '');
      var list = lines.filter(function (r) { return !q || normKey([r.item_no, r.description, r.sheet].join(' ')).indexOf(normKey(q)) >= 0; });
      body.innerHTML =
        '<p class="cc-hint">Enter each line\'s <strong>cumulative</strong> relative % complete (0–100). %Wt. and Amt. below ' +
        'are derived live from the line amount and its sheet total — they are never stored.</p>' +
        '<p class="cc-hint"><strong>Claimed</strong> is what you submitted; <strong>certified</strong> is what the client ' +
        'approved. Leave Claimed blank when they are the same — blank means <em>not separately recorded</em>, never zero. ' +
        'Only the certified column bills: POC, revenue and the monthly view all derive from it. Their difference is ' +
        'reported as <strong>dispute</strong> on the Billing tab.</p>' +
        '<input class="pd-input" id="pg-q" placeholder="Search lines…" value="' + esc(q) + '" />' +
        '<table class="boq-progtab"><thead><tr><th>Line</th><th class="cc-r">Amount</th><th class="cc-r">WT %</th>' +
        '<th class="cc-r">Prev %</th><th class="cc-r">Claimed %</th><th class="cc-r">Certified %</th>' +
        '<th class="cc-r">%Wt.</th><th class="cc-r">Amt.</th>' +
        '</tr></thead><tbody>' +
        list.slice(0, 400).map(function (r) {
          var w = wtOf(r, st), rl = Number(rel[r.id] || 0), pv = Number(relPrev[r.id] || 0);
          var cm = claim[r.id] == null ? null : Number(claim[r.id]);
          return '<tr><td class="cc-desc"><div class="cc-desc-txt">' + esc(r.description || '') + '</div>' +
            '<div class="cc-mini">' + esc(r.sheet) + ' · row ' + r.source_row + '</div></td>' +
            '<td class="cc-r">' + money(r.amount) + '</td>' +
            '<td class="cc-r">' + pct(w, 4) + '</td>' +
            '<td class="cc-r cc-mut">' + pct(pv, 2) + '</td>' +
            '<td class="cc-r"><input class="pd-input boq-clm" type="number" step="0.01" min="0" max="100" ' +
              'placeholder="same" title="What was submitted. Blank means the same as certified." ' +
              'data-id="' + esc(r.id) + '" value="' + (cm == null ? '' : (cm * 100).toFixed(2)) + '" /></td>' +
            '<td class="cc-r"><input class="pd-input boq-rel" type="number" step="0.01" min="0" max="100" ' +
              'title="What the client certified. This is the figure that bills." ' +
              'data-id="' + esc(r.id) + '" value="' + (rl ? (rl * 100).toFixed(2) : '') + '" /></td>' +
            '<td class="cc-r">' + pct(w * rl, 6) + '</td>' +
            '<td class="cc-r">' + money(Number(r.amount) * rl) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        (list.length > 400 ? '<p class="cc-mut">Showing the first 400 of ' + list.length + ' lines — narrow with the search.</p>' : '');
      var qi = body.querySelector('#pg-q'), tm = null;
      qi.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { q = qi.value; paint(); qi = body.querySelector('#pg-q'); qi.focus(); }, 220); });
      body.querySelectorAll('.boq-clm').forEach(function (inp) {
        inp.onchange = function () {
          var v = inp.value;
          /* ⚠️ EMPTY DELETES THE CLAIM, it does not store 0. "Not separately
             recorded" and "submitted nothing" are different facts, and only the
             second one is a dispute. */
          if (String(v).trim() === '') { delete claim[inp.dataset.id]; }
          else {
            var n = Number(v);
            if (!isFinite(n) || n < 0) { delete claim[inp.dataset.id]; }
            else claim[inp.dataset.id] = Math.min(n, 100) / 100;
          }
          paint();
        };
      });
      body.querySelectorAll('.boq-rel').forEach(function (inp) {
        inp.onchange = function () {
          var v = Number(inp.value);
          if (!isFinite(v) || v <= 0) { delete rel[inp.dataset.id]; }
          // Clamped at 100: a cumulative relative percentage above 100 would
          // bill more than the line is worth, and the sheet's own identities
          // (Σ %Wt. = POC) would stop closing.
          else rel[inp.dataset.id] = Math.min(v, 100) / 100;
          paint();
        };
      });
    }
    paint();
    m.el.querySelector('#pg-x').onclick = m.close;
    m.el.querySelector('#pg-c').onclick = m.close;
    m.el.querySelector('#pg-go').onclick = async function () {
      /* ⚠️ THE UNION, NOT Object.keys(rel). A line claimed and certified at NOTHING
         is the sharpest dispute there is — fully submitted, fully rejected — and
         it has no entry in `rel`. Keying off the certified map alone would drop
         exactly the rows the dispute report exists to show. */
      var idset = {};
      Object.keys(rel).forEach(function (k) { idset[k] = 1; });
      Object.keys(claim).forEach(function (k) { idset[k] = 1; });
      var ids = Object.keys(idset);
      var payload = ids.map(function (iid) {
        return { project_id: pid, period_id: perId, boq_item_id: iid,
                 rel_pct: rel[iid] || 0,
                 // null, never 0 — "no claim recorded" reads as equal to certified.
                 rel_pct_claimed: claim[iid] == null ? null : claim[iid],
                 created_by: UID };
      });
      // Rows dropped to zero on BOTH figures are deleted rather than stored as 0,
      // so "never billed" and "explicitly zero this period" stay different rows.
      var gone = Object.keys(PROG[perId] || {}).concat(Object.keys(CLAIM[perId] || {}))
        .filter(function (iid, i2, a2) { return a2.indexOf(iid) === i2 && !(iid in idset); });
      for (var i = 0; i < gone.length; i += 100) {
        await sb().from(T_PROG).delete().eq('period_id', perId).in('boq_item_id', gone.slice(i, i + 100));
      }
      /* Tolerant of the un-run migration, the same way PKGS is: strip the claimed
         column and save the certified figures rather than losing the whole edit,
         and say which migration restores the other half. */
      var noClaimCol = false;
      for (var j = 0; j < payload.length; j += 300) {
        var chunk = payload.slice(j, j + 300);
        var body2 = noClaimCol ? chunk.map(function (x) {
          return { project_id: x.project_id, period_id: x.period_id, boq_item_id: x.boq_item_id,
                   rel_pct: x.rel_pct, created_by: x.created_by };
        }) : chunk;
        var res = await sb().from(T_PROG).upsert(body2, { onConflict: 'period_id,boq_item_id' });
        if (res.error && !noClaimCol && /rel_pct_claimed/.test(res.error.message || '')) {
          noClaimCol = true; j -= 300; continue;              // retry this chunk without it
        }
        if (res.error) { UI.toast(res.error.message, 'error'); return; }
      }
      if (noClaimCol) {
        UI.toast('Certified progress saved, but the CLAIMED figures were not — run ' +
          'migrations/2026-08-26-boq-claimed-vs-certified.sql.', 'error');
      }
      m.close(); UI.toast('Progress saved.', 'success'); await load();
    };
  }

  // ==========================================================================
  // HOST API
  // ==========================================================================
  function init(deps) {
    UID = deps.uid; canWrite = !!deps.canWrite; isAdmin = !!deps.isAdmin;
  }
  async function show(projectId, label) {
    pid = projectId; projLabel = label || '';
    await ensureSugg();
    await load();
  }
  function reset() { loaded = false; REVS = []; ITEMS = []; CMAP = {}; ALLOC = []; PERIODS = []; PROG = {}; REVID = null; CODES = null; ACTS = null; SCHED = null; schedErr = null; PKGS = []; }

  return {
    init: init, show: show, reset: reset, render: render,
    _internals: {
      numOf: numOf, normKey: normKey, locKey: locKey, findHeader: findHeader, colMapOf: colMapOf,
      markerIn: markerIn, MARKER_RE: MARKER_RE, parseSheet: parseSheet, reconcile: reconcile,
      sheetTotals: sheetTotals, contractSum: contractSum, wtOf: wtOf, periodTotals: periodTotals,
      sheetPocs: sheetPocs, moneyLine: moneyLine, qtyLine: qtyLine, mappable: mappable,
      proposeSplit: proposeSplit, locMatch: locMatch, allocSum: allocSum, suggestFor: suggestFor,
      statedTotalOf: statedTotalOf, billingColsOf: billingColsOf, guessRev: guessRev, sumStated: sumStated,
      pkgName: pkgName, pkgCell: pkgCell, schedPoc: schedPoc, sheetPkgState: sheetPkgState,
      /* Decision #7's second half: dispute, testable against the shipped rule. */
      disputeOf: disputeOf, claimedOf: claimedOf,
      /* Decision #6's derivation. Exported so the monthly split is testable
         against the shipped function rather than a reimplementation. */
      monthlyRevenue: monthlyRevenue, spreadDays: spreadDays, dnum: dnum, isoOf: isoOf,
      monthKey: monthKey, daysInMonthKey: daysInMonthKey,
      _set: function (o) {
        if (o.ITEMS) ITEMS = o.ITEMS; if (o.CMAP) CMAP = o.CMAP; if (o.ALLOC) ALLOC = o.ALLOC;
        if (o.PERIODS) PERIODS = o.PERIODS; if (o.PROG) PROG = o.PROG; if (o.SUGG) SUGG = o.SUGG;
        if (o.CLAIM) CLAIM = o.CLAIM;
        if (o.ACTS) ACTS = o.ACTS; if (o.pid) pid = o.pid; if (o.PKGS) PKGS = o.PKGS;
        if (o.SCHED !== undefined) SCHED = o.SCHED; if (o.schedErr !== undefined) schedErr = o.schedErr;
      }
    }
  };
})();
