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
  /* The manual builder's own migration. ⚠️ Named separately so a database that has the
     BOQ tables but not the lifecycle columns is pointed at the right file, not the first one. */
  var MIGRATION_MANUAL = 'migrations/2026-09-07-boq-manual.sql';

  var sb = function () { return window.__sb || (window.__sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY)); };
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- state ---------------------------------------------------------------
  var UID = null, canWrite = false, isAdmin = false, pid = null, projLabel = '';
  var REVS = [], REVID = null, ITEMS = [], CMAP = {}, ALLOC = [], PERIODS = [], PROG = {};
  /* ⚠️⚠️ A BOQ IS A DOCUMENT WITH ITS OWN REVISION SERIES (2026-09-07-boq-documents.sql).
     Before that migration `boq_revisions` was unique on (project_id, lower(rev_no)) — one
     series per PROJECT — so a second trade BOQ had to call itself 01, a number that is not
     the second revision of anything. `DOCS` is this project's BOQs; `DOCID` is the one on
     screen. Confirmed against OPW101's own workbooks: 'Package 2 BOQ rev.05' is the
     package's revision, not Architectural's. */
  var DOCS = [], DOCID = null;
  /* ⚠️⚠️ THE PROJECT'S CONTRACT VALUE IS THE SUM ACROSS DOCUMENTS, NOT THIS ONE'S TOTAL.
     Once a project holds several BOQs the headline figure was only the BOQ you happened to be
     looking at — a wrong number on screen, and the kind that gets quoted. `ALLREVS` keeps the
     unfiltered revision list (REVS is narrowed to the selected document) and `PROJTOTAL` is
     the sum of every document's CURRENT revision.
     ⚠️ Only computed when there is more than one document. With one, this document's total IS
     the project total, and the extra read would be pure cost on every load. */
  var ALLREVS = [], PROJTOTAL = null;
  /* WARNING Finance trade -> the procurement trades that actually let the work
     (2026-09-07-trade-map.sql). NOT a merge of the two vocabularies: they classify different
     things, cost versus subcontract, and MEPF Works is one cost class bought as four POs --
     which the owner's own billing shows ("MEPF PO", "STRUCTURAL PO"). This translates between
     them so a bill of quantities can say which package will deliver each trade. */
  var TRADEMAP = {};
  /* CLAIMED progress, period_id -> { item_id: 0..1 }, from
     2026-08-26-boq-claimed-vs-certified.sql. Kept SEPARATE from PROG rather
     than folded into it: PROG is the certified figure every POC, revenue and
     monthly number derives from, and a single map holding both would eventually
     be read by something that bills the wrong one.
     ⚠️ ONLY LINES WITH A STORED CLAIM APPEAR HERE. A missing entry means "not
        separately recorded", i.e. claimed = certified — never zero. */
  var CLAIM = {};
  var CODES = null, ACTS = null;            // lazy: class_codes chart, schedule activities
  /* ⚠️ WBSNAME is a plain `{}` and NOT part of the `[]`-is-truthy family: it is filled by the
     same read as ACTS and is meaningless without it, so ACTS's own load state governs both.
     LOCMATCH is `null` until read, because an empty saved table and an unread one are different
     facts and only the second should be retried. */
  var WBSNAME = {};                         // dotted wbs code → branch name, from the WBS Summary rows
  var LOCMATCH = null;                      // WBS branch name → place, from location_levels.match
  /* ⚠️ THE BOQ NO LONGER OWNS THE SCREEN. It used to write straight into `#cc-view`, which
     is the module's whole view area — fine for a full-screen sub-view, impossible for a
     section living inside the Contract tab. Owner, 2026-09-07: *"Can't the BOQ page be
     relocated in the contracts page?"* `mountTo()` moves the target; everything else in this
     file renders through `hostEl()` and does not care where it lands. Falls back to cc-view
     so a caller that never mounts behaves exactly as before. */
  var HOST_ID = 'cc-view';
  var codesErr = null;                      // why the chart is empty - see ensureCodes()
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
  /* ⚠️ COLLAPSED HEADINGS, keyed by row id. Owner, 2026-09-07: *"we should also have the
     collapsible option for the header rows"* — OPW101's draft is **924 rows under 223
     headings**, which is unnavigable as a flat list.
     ⚠️ Kept in memory only, and deliberately NOT persisted: it describes how you are reading
     the bill right now, not anything about the bill. A collapse state written to the database
     would be shared with everyone on the project, and a planner who collapsed a trade would
     hide it from somebody else's screen. Cleared on reset(), so switching revision or project
     starts expanded rather than hiding rows the new bill never collapsed. */
  var COLLAPSED = {};
  /* Selected line ids, draft only. Same reasoning as COLLAPSED: a selection is how you are
     working right now, not a property of the bill, so it is never persisted. */
  var SEL = {};
  var _grid = null;            // the PDGrid instance bound to the current render
  /* WARNING The column spec of the render that just happened. itemsHTML() builds it and
     wireItems() needs it, and they are different functions - `var COLS` inside itemsHTML is
     invisible there and would have thrown a ReferenceError the first time a draft rendered.
     Module-scoped rather than passed, because wireItems is called from the shared wire path
     that does not know which tab produced the markup. */
  var LASTCOLS = null;
  var openWizard = null;       // module.js's openNew(type) - see init()
  var loaded = false;
  /* The class-code chart folded into division › group › item for the builder's tree.
     Cached: regrouping 702 rows on every keystroke of the tree's search box is a cost that
     only shows up on the machine with the most codes. */
  var CODETREE = null;

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
  /* ⚠️⚠️ THE PRIVATE `locKey` IS GONE — location matching now goes through the SHARED
     `PDLoc` (`assets/js/locmatch.js`), which is the schedule's own normaliser.

     What was here was a third copy of that normaliser and the only one not cross-asserted
     against the others, and measuring it against the schedule's found two real defects:

       1. IT MISSED "Roof Deck" vs "Roofdeck" — a real pair on the Jab schedule. It kept the
          spaces; the schedule strips every separator. So the stacking merged that floor and
          the BOQ allocator did not, and a line measured on the roof deck matched nothing.
       2. IT MATCHED A 13th-FLOOR LEAF TO "3rd Floor". `"…at 13 floor".indexOf("3 floor")` is a
          hit, so a 3rd-floor quantity was offered the 13th floor's activities. Exactly the
          "8th and 18th get merged" trap this function's own comment warned about, arriving
          from the other direction. `PDLoc.contains` rejects a digit sitting outside a numeric
          edge, which is why it is not a one-line `indexOf`.

     Both are asserted in the suite with the old function executed as the contrast. */
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
  /* ⚠️⚠️ MATCHING AND MEASURING ARE TWO DIFFERENT JOBS, AND THEY DO NOT HAPPEN AT THE SAME TIME.
     Owner 2026-09-07: *"if it is matching to schedule, users are able to link despite the qts or
     amount not being assigned"*.
     Right: the tab was gated on `qtyLine`, so a line with no quantity could not even be SEEN in
     Match to schedule, and the whole tab showed a "No line carries a quantity yet" wall. But
     saying WHICH ACTIVITIES A BOQ LINE COVERS is a scope decision, and it is knowable long before
     anyone has measured the line — it is the thing a QS does first, off the drawings. Forcing the
     quantity in first meant either waiting, or typing a placeholder figure, and a placeholder
     quantity is indistinguishable from a measured one the moment it is stored.
     So the link stands on its own: `qty = 0` on the allocation row means MATCHED, NOT YET
     QUANTIFIED. Nothing downstream needed changing for that — every reader sums qty, and 0 adds
     nothing — and it needs no migration, because boq_allocations.qty is `not null default 0`
     already. When the quantity arrives, the same Allocate dialog spreads it across the links that
     are already there.
     ⚠️ Excluded lines and headings are still out: a heading is layout, and an exclusion is a
     positive statement that the work is somebody else's scope. */
  function linkLine(r) {
    return r.line_kind !== 'heading' && !r.exclusion_note &&
      (r.line_kind === 'measured' || r.line_kind === 'lump_sum' || r.line_kind === 'provisional');
  }
  // Does this line have a quantity to spread, as opposed to only a link to record?
  function hasQty(r) { return r && r.qty != null && Number(r.qty) > 0; }

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
      /* ⚠️ Tolerant of the migration not having been run: a missing table or column reads as
         'no documents', and the module falls back to the old flat behaviour rather than
         erroring. Every other schema addition in this file is loaded the same way. */
      try { DOCS = await PDb.selectAll('boq_documents', function (q) { return q.eq('project_id', pid).order('sort_order'); }); }
      catch (e) { DOCS = []; }
      /* Reference data, tiny and shared, loaded the same tolerant way: without the migration it
         is an empty map and the trade chips simply carry no counterpart.
         WARNING A PLAIN SELECT, NOT PDb.selectAll. selectAll pages with .order(key).gt(key, last)
         and needs a UNIQUE key; trade_map's primary key is the PAIR, so 'MEPF Works' appears four
         times and a page boundary landing inside that group would silently drop the rest of it.
         The whole table is nine rows -- one request, no cursor, nothing to get wrong. */
      try {
        var tmr = await sb().from('trade_map').select('finance_trade,procurement_trade')
                            .order('finance_trade').order('procurement_trade').limit(500);
        if (tmr.error) throw tmr.error;
        TRADEMAP = {};
        (tmr.data || []).forEach(function (r) {
          (TRADEMAP[r.finance_trade] = TRADEMAP[r.finance_trade] || []).push(r.procurement_trade);
        });
      } catch (e) { TRADEMAP = {}; }
      REVS = await PDb.selectAll(T_REV, function (q) { return q.eq('project_id', pid); });
      ALLREVS = REVS.slice();
      REVS.sort(function (a, b) { return String(b.issued_date || '').localeCompare(String(a.issued_date || '')) || String(b.rev_no).localeCompare(String(a.rev_no), undefined, { numeric: true }); });
      /* ⚠️ The DOCUMENT is chosen before the revision, because 'the current revision' only
         means anything inside one. Keep the planner's document if it still exists — a reload
         after adding lines must not silently jump them to another BOQ. */
      if (DOCS.length) {
        if (!DOCID || !DOCS.some(function (d) { return d.id === DOCID; })) DOCID = DOCS[0].id;
        REVS = REVS.filter(function (r) { return !r.document_id || r.document_id === DOCID; });
      }
      await computeProjectTotal();
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
      hostEl().innerHTML = '<div class="pd-card cc-empty"><h3>Could not load the BOQ</h3><p>' +
        esc(err.message || String(err)) + '</p><p class="cc-mut">' + migrationHint(err) + '</p></div>';
      return;
    }
    render();
  }

  /* ⚠⚠ AN EMPTY RESULT IS NOT A CACHE. This read `if (CODES) return CODES;`, and **an empty
     array is truthy in JavaScript** — so the first call on a database whose chart had not been
     seeded stored `[]` and every later call returned it without ever querying again. Owner,
     2026-09-07: *"I've run the migration for the class codes already. But the error statement
     is still the same."* It was: the page had cached the empty answer before the migration ran,
     and only a reload could clear it. The failure mode is the worst kind — the fix is applied,
     the app keeps reporting the old problem, and the migration looks broken.
     ⚠️ Re-querying while empty costs one round-trip per attempt, and ONLY in the broken case:
     as soon as a single row comes back it caches normally and never asks again.
     ⚠️ `codesErr` is kept so the message can tell an EMPTY chart (run the migration) apart
     from a REFUSED read (RLS — `class_codes_read` requires `is_approved()`, so an unapproved
     account sees zero rows and no error). Those need opposite actions and read identically. */
  async function ensureCodes() {
    if (CODES && CODES.length) return CODES;
    try {
      /* ⚠️ Paged on `code`, not `id` — this table's primary key IS the padded Finance code and
         there is no `id` column. ⚠️ `sort_order` is fetched and applied IN MEMORY because
         selectAll orders by its cursor; the migration is explicit that this order is Finance's
         own template sequence, which is how a QS expects to read the chart. */
      CODES = await PDb.selectAll('class_codes', function (q) { return q.eq('active', true); },
                                  'code,code_l1,code_l2,desc_l1,desc_l2,desc_l3,sort_order,trade', 'code') || [];
      CODES.sort(function (a, b) {
        var x = a.sort_order, y = b.sort_order;
        if (x == null && y == null) return String(a.code) < String(b.code) ? -1 : 1;
        if (x == null) return 1;
        if (y == null) return -1;
        return x - y;
      });
      codesErr = null;
    } catch (e) { CODES = []; codesErr = e; }
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
    /* ⚠⚠ `ACTS && ACTS.length`, NOT `ACTS`. An empty array is TRUTHY, so the plain guard
       cached BOTH failure states for the whole session: the `catch` below sets `[]` on any error
       (an RLS refusal, an 8s statement timeout), and a project with no schedule yet also yields
       `[]`. Either way the allocator went on reporting "no activities" after the cause was fixed,
       and only a reload could clear it. This is the identical defect ensureCodes documents at
       :703 -- fixed there, left standing in this sibling 60 lines below it. */
    if (ACTS && ACTS.length) return ACTS;
    try {
      /* ⚠️ `wbs` is selected so the matcher has a THIRD rung. The dotted code is the only
         reliable ancestry on this table: `2026-09-01-wbs-link-rpc.sql` measured `wbs_node_id`
         NULL on 16,393 of 16,393 activities after an import, and the schedule's own grid never
         noticed because `rebuild()` splits the code instead. Never read `wbs_node_id` here. */
      var rows = await PDb.selectAll('project_schedule', function (q) { return q.eq('project_id', pid); },
        'id,activity_id,activity_name,class_code,location,work_type,duration_days,activity_type,scope_type,wbs');
      /* ⚠️⚠️ THE `WBS Summary` ROWS ARE KEPT, AS A CODE→NAME MAP ONLY. They are the only place a
         branch's NAME is stored, so discarding them (as this function did) left the WBS rung with
         codes and no words to match against. `affected.js`'s own loader had to make exactly this
         change for exactly this reason.
         ⚠️ They stay OUT of `ACTS`: a BOQ line allocated to a summary row would double-count
         everything beneath it, which is the trap `schedule_scurve_agg` excludes them for. */
      WBSNAME = {};
      rows.forEach(function (r) {
        if (r.activity_type === 'WBS Summary' && r.wbs && r.activity_name) WBSNAME[String(r.wbs)] = r.activity_name;
      });
      ACTS = rows.filter(function (r) { return r.activity_type !== 'WBS Summary' && r.activity_id; });
    } catch (e) { ACTS = []; WBSNAME = {}; }
    return ACTS;
  }

  /* The branch names above an activity, nearest-last, derived by splitting the dotted `wbs`
     code — '4.1.2' → ['4', '4.1', '4.1.2'] — and naming each prefix from WBSNAME. A prefix the
     summary rows do not name contributes nothing rather than a bare number, which would match
     any line whose item_no happened to contain that digit. */
  function wbsNamesOf(a) {
    var code = String((a && a.wbs) || '').trim();
    if (!code) return [];
    var segs = code.split('.'), out = [], acc = '';
    for (var i = 0; i < segs.length; i++) {
      acc = acc ? acc + '.' + segs[i] : segs[i];
      var n = WBSNAME[acc];
      if (n) out.push(n);
    }
    return out;
  }

  /* The saved WBS-branch → place table the schedule's Match-WBS-to-locations wizard writes
     (`location_levels.match`, keyed by branch NAME). Read-only here, and the single most useful
     thing this module can borrow: it is a planner's own confirmed statement that a branch IS a
     given place, which no heuristic can beat.
     ⚠️ Tolerant of the column being absent — `2026-08-05-location-level-match.sql` may not have
     been run, and the schedule's own reader treats a missing column as "no saved matching". */
  async function ensureLocMatch() {
    if (LOCMATCH) return LOCMATCH;
    var m = {};
    try {
      var r = await sb().from('location_levels').select('id,name,sort_order,match').eq('project_id', pid).order('sort_order');
      if (r.error) throw r.error;
      (r.data || []).forEach(function (l) {
        var t = l && l.match;
        if (t && typeof t === 'object') Object.keys(t).forEach(function (branch) { if (t[branch]) m[branch] = t[branch]; });
      });
    } catch (e) { /* no column, no grant, or no levels — all mean "no saved matching". */ }
    LOCMATCH = m;
    return LOCMATCH;
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

  /* ⚠⚠ A HAND-BUILT DRAFT SHOWS TWO TABS, NOT FOUR — owner, 2026-09-07: *"the BOQ is
     complicated to use and difficult to manage when it's really simple: you just have a BOQ and
     a class code library and you just have to match it with the activities in the schedule."*
     That is an accurate description of the manual job, and two of the four tabs have no part in
     it:
       · **Class Codes** maps a CLIENT'S DESCRIPTIONS onto codes, with proposals, confidence and
         a suggestion library. On an authored line the CODE CAME FIRST and the description was
         written from it — there is nothing to infer. This is exactly why 2026-09-07-boq-manual
         added a fourth source value, `authored`, instead of reusing `hand_picked`: the mapping
         is a fact, not a judgement. Showing a judgement UI over facts invites re-deciding what
         was never in doubt, and `boq_class_suggestions` LEARNS from that tab.
       · **Billing / POC** cannot do anything before the revision is issued — a draft never
         bills, which the database enforces. It was four screens of accrual vocabulary offering
         a "New billing period" button on a document that cannot be billed.
     ⚠️ GATED ON `origin='manual' AND status='draft'`, so an IMPORT IS COMPLETELY UNTOUCHED, and
     the full four tabs return the moment the revision is issued — nothing is removed from the
     product, it is deferred until it means something. `Allocations` is also renamed here to
     **Match to schedule**, which is the owner's own phrase for it; the import path keeps the
     quantity-allocation wording it shares with the reconciliation screens. */
  function isManualDraft() {
    var r = curRev() || {};
    return revStatus(r) === 'draft' && r.origin === 'manual';
  }
  function subsFor() {
    if (!isManualDraft()) return SUBS;
    return [
      { key: 'items', label: 'Lines' },
      { key: 'alloc', label: 'Match to schedule' }
    ];
  }

  function hostEl() {
    return document.getElementById(HOST_ID) || document.getElementById('cc-view');
  }
  function render() {
    var host = hostEl();
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pd-card cc-empty"><h3>Select a project</h3></div>'; return; }
    if (!loaded) { host.innerHTML = '<div class="pd-card cc-empty"><h3><span class="cc-spin"></span>Loading the BOQ…</h3></div>'; return; }

    /* ⚠️ If the visible set shrank under us — issuing flips it back to four, and picking a
       different revision can too — a `sub` that is no longer on offer would render a blank body
       with no tab lit. Fall back to the one tab that always exists. */
    var subs = subsFor();
    if (!subs.some(function (x) { return x.key === sub; })) sub = 'items';

    var h = '<div class="boq-bar">' +
      '<div class="boq-subtabs">' + subs.map(function (s) {
        return '<button class="boq-subtab' + (sub === s.key ? ' active' : '') + '" data-sub="' + s.key + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' +
      '<span class="boq-spacer"></span>' +
      /* ⚠️ The whole-BOQ run sits in the BAR, not on a tab, because it spans three of them — two
         passes live on Class Codes and one on Match to schedule, and a control that runs all three
         belongs to none of them. ⚠️ Writers only, and only once a revision exists: on an empty BOQ
         there is nothing to match and the button would open a modal reading zero, zero, zero. */
      /* ⚠️ NAMED FOR THE ACT, NOT THE DESTINATION. It first shipped as "Match to the schedule…",
         which is almost exactly the name of the sub-tab two inches to its left — owner, 2026-09-10:
         *"There are two buttons for match to schedule."* One is a PLACE (the allocation worklist)
         and one is an ACTION over the whole bill, and two controls a tab apart reading the same is
         how a planner learns to distrust both. The three passes are the honest label, and they also
         teach the model the preview then explains. */
      (canWrite && REVS.length
        ? '<button class="pd-btn" id="boq-matchall" title="One run over the WHOLE bill: map the ' +
          'lines to class codes, tag the schedule activities with them, then allocate the ' +
          'quantities. One preview — nothing is written until you confirm.">Code, tag and allocate…</button>'
        : '') +
      revPickerHTML() +
      /* ⚠⚠ BUILDING BY HAND IS THE PRIMARY ACT; IMPORT IS THE CONVENIENCE — owner, 2026-09-07:
         *"Let's make sure that the manual add of BOQ is a priority and the import feature is
         only a convenience."* This REVERSES the weighting shipped that morning, which argued
         import is the faster path when a file exists. True, but it ranked the two by the speed
         of the happy case rather than by which one always works: a workbook arrives late, in a
         shape the parser has never seen, or not at all. The hand build has no external
         dependency, and its lines carry class codes from the start — which is what the schedule
         tagging and the cost roll-up actually read.
         ⚠️ Primary sits RIGHTMOST, as in every other toolbar here, so the two swap places as
         well as swapping weight. */
      /* ⚠️⚠️ NO STANDALONE IMPORT BUTTON. Owner, 2026-09-07: *"there is also an import BOQ button
         where in this is already available in the wizard. Having a separate button for this would
         defeat the purpose of processes going to the wizard first."* Exactly right — a second door
         into the same room is how two paths drift, which is the whole reason `+ Lot` and `New BOQ`
         were routed through the wizard earlier today. **Add BOQ** opens the wizard, and the wizard
         asks build-by-hand or import.
         ⚠️ `openImport()` stays exported — the wizard's import branch calls it. What is removed is
         the button that bypassed the question, not the capability. */
      /* ⚠⚠ THE "Add BOQ" BUTTON IS GONE FROM HERE. Owner: *"There is an +Add button in the
         title bar and another Add BOQ at the bottom. Let's just remove the one at the bottom."*
         Right: the topbar + Add opens the same wizard, and the wizard's BOQ step creates a NEW BOQ
         document (boqPath() === "add"), not only a revision on an existing one. Two primary buttons
         for one job, a few hundred pixels apart, is how a planner learns to distrust both.
         ⚠ The empty-state button below STAYS: with no BOQ at all this section is otherwise a dead
         end, and a call to action is not a duplicate of a control you can already see. */
      '</div>';

    if (!REVS.length) {
      /* WARNING TWO DIFFERENT EMPTY STATES, and one message used to answer both. With a document
         on screen the picker above is showing its NAME, so "No BOQ on this project yet" directly
         contradicts what the planner can read one line higher. A named BOQ holding no revision is
         now a reachable state -- deleting the only revision leaves it, and the wizard fills it --
         so the copy has to tell the two apart. */
      var emptyDoc = (DOCS || []).filter(function (x) { return x.id === DOCID; })[0] || null;
      h += '<div class="pd-card cc-empty"><h3>' +
        (emptyDoc ? esc(emptyDoc.name) + ' has no revision yet' : 'No BOQ on this project yet') + '</h3>' +
        '<p>Build one from the class-code library — or import the client\'s workbook if you ' +
        'have it. Each is a <strong>revision</strong>, and the prior one is always kept.</p>' +
        (canWrite ? '<p style="margin-top:14px;">' +
          '<button class="pd-btn pd-btn-primary" id="boq-new2">Add BOQ…</button></p>' : '') +
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
    /* ⚠️ The document picker comes FIRST and is shown even with one document, so the planner can
       see which BOQ they are in without having to infer it from the revision label. Hidden only
       when the migration has not run and there are no documents at all. */
    var docSel = DOCS.length
      ? '<label class="boq-inline">BOQ <select class="pd-select" id="boq-doc">' +
        DOCS.map(function (d) {
          return '<option value="' + esc(d.id) + '"' + (d.id === DOCID ? ' selected' : '') + '>' +
            esc(d.name) + '</option>';
        }).join('') + '</select></label>' +
        /* ⚠️ A NAME MUST BE FIXABLE. The backfill names a document from its own data — one distinct
           sheet becomes "<sheet> BOQ", otherwise "Main BOQ" — so OPW101 came out as "Main BOQ"
           simply because its draft was empty when the migration ran. A generated name with no way
           to correct it is a permanent scar from a one-off migration. */
        (canWrite ? '<button class="boq-iconbtn" id="boq-docname" aria-label="Rename this BOQ" ' +
          'title="Rename this BOQ">\u270e</button>' : '') +
        /* WARNING A surrogate PAIR, not \u1f5d1 -- a JS \u escape takes exactly four hex digits,
           so the five-digit form would render as the character \u1f5d followed by a literal 1. */
        (canWrite ? '<button class="boq-iconbtn boq-iconbtn-danger" id="boq-docdel" ' +
          'aria-label="Delete this BOQ" title="Delete this BOQ">\ud83d\uddd1</button>' : '') + ' '
      : '';
    if (!REVS.length) return docSel;
    /* WARNING THE TRASH SITS ON THE REVISION TOO, and only on a DRAFT one. Deleting a BOQ was all
       or nothing: a planner who authored the wrong revision -- wrong trades, wrong labels, a
       remeasure started against the wrong scope -- could delete the whole named bill or nothing.
       Owner, 2026-09-08: *"I need a delete BOQ as well, not just the lines within the BOQ just in
       case."* Three granularities now exist and they are different jobs: the lines (Delete
       selected), one revision (here), the whole BOQ (beside its name).
       WARNING Rendered only for a draft. An ISSUED revision is the client's tendered document and
       this module's central invariant is supersede-never-edit-away; a delete control that appeared
       over it would have to refuse on click, and a button whose only behaviour is to refuse is
       worse than no button -- it teaches the planner the module is arbitrary. */
    var curR = curRev();
    var revDel = (canWrite && curR && revStatus(curR) === 'draft')
      ? '<button class="boq-iconbtn boq-iconbtn-danger" id="boq-revdel" ' +
        'aria-label="Delete this draft revision" title="Delete this draft revision">\ud83d\uddd1</button>'
      : '';
    return docSel + '<label class="boq-inline">Revision <select class="pd-select" id="boq-rev">' +
      REVS.map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (r.id === REVID ? ' selected' : '') + '>' +
          /* ⚠️ A DRAFT SAYS SO IN THE PICKER. It is neither current nor superseded, and
             labelling it "superseded" (which the old ternary did, having only two states)
             would describe a BOQ being written as one that had been replaced. */
          esc('rev ' + r.rev_no + (r.issued_date ? ' · ' + String(r.issued_date).slice(0, 10) : '') +
              (revStatus(r) === 'draft' ? ' · DRAFT' : r.is_current ? ' · current' : ' · superseded')) +
          '</option>'; }).join('') + '</select></label>' + revDel;
  }

  function wireShell(host) {
    host.querySelectorAll('[data-sub]').forEach(function (b) {
      b.onclick = function () { sub = b.dataset.sub; render(); };
    });
    var ma = host.querySelector('#boq-matchall');
    if (ma) ma.onclick = openMatchAll;
    var rv = host.querySelector('#boq-rev');
    if (rv) rv.onchange = function () { REVID = rv.value; load(); };
    var dv = host.querySelector('#boq-doc');
    /* ⚠️ REVID is cleared, not kept: the revision on screen belongs to the OLD document and
       would not be found in the new one's list, leaving the picker on a revision whose lines
       are not the ones displayed. load() picks that document's current revision. */
    if (dv) dv.onchange = function () { DOCID = dv.value; REVID = null; load(); };
    var dd = host.querySelector('#boq-docdel');
    /* WARNING DELETING A BOQ DESTROYS EVERY REVISION AND EVERY LINE UNDER IT -- boq_items and
       boq_class_map both cascade from boq_revisions, which cascades from boq_documents. So this
       refuses more than it allows:
         - an ISSUED revision is never deletable. It is the client's tendered document and the
           evidence a claim argument turns on; this module's model is "superseded, never edited
           away", and a delete that ignored it would undo that in one click.
         - a billing period BLOCKS it in the database itself: boq_billing_periods references
           boq_revisions WITHOUT cascade, so Postgres refuses. That refusal is translated into
           plain language instead of surfacing a foreign-key error.
         - the confirm names the counts, because "delete this BOQ?" hides how much is going.
       WARNING The LAST document is not deletable either: every revision must hang off one, so
       removing the only document would orphan the next revision and leave the picker empty. */
    if (dd) dd.onclick = async function () {
      var d = DOCS.filter(function (x) { return x.id === DOCID; })[0];
      if (!d) return;
      /* WARNING THE "LAST DOCUMENT" REFUSAL IS GONE, and it was over-cautious. Its stated reason
         was that removing the only document "orphans the next revision and leaves the picker
         empty" -- but boq_revisions CASCADES from boq_documents, so there is no next revision to
         orphan, and an empty picker is a state this screen already renders on purpose: every
         project starts there, and render() answers it with "No BOQ on this project yet" and an
         Add BOQ button. Owner, 2026-09-08: *"I need a delete BOQ as well, not just the lines
         within the BOQ just in case."* On a project with exactly one BOQ -- which is most of them,
         and the case a wrong first attempt actually happens in -- the control refused every time,
         so from where he stood it did not exist. The gates that protect real evidence (an issued
         revision, a recorded billing period) are untouched below; this one protected nothing. */
      var mine = ALLREVS.filter(function (r) { return r.document_id === d.id; });
      var issued = mine.filter(function (r) { return revStatus(r) !== 'draft'; });
      if (issued.length) {
        UI.toast(d.name + ' holds ' + issued.length + ' issued revision' +
          (issued.length === 1 ? '' : 's') + '. An issued BOQ is the tendered document and is never ' +
          'deleted - supersede it with a new revision instead.', 'error');
        return;
      }
      var nLines = mine.some(function (r) { return r.id === REVID; }) ? ITEMS.length : 0;
      /* WARNING The confirm NAMES THE COUNTS -- "Delete this BOQ?" hides how much is going -- and
         when this is the only BOQ it says so, because "the project will have no BOQ" is a
         materially different outcome from "one of several is going" and the planner cannot see
         which case they are in from the trash icon alone. */
      var lastOne = DOCS.length < 2;
      if (!confirm('Delete "' + d.name + '" and its ' + mine.length + ' draft revision' +
                   (mine.length === 1 ? '' : 's') +
                   (nLines ? ' (' + nLines + ' lines on the open one)' : '') + '?' +
                   String.fromCharCode(10) + String.fromCharCode(10) +
                   (lastOne ? 'This is the only BOQ on the project - it will be left with no BOQ at all, ' +
                              'and the contract value will read zero until another is created.' +
                              String.fromCharCode(10) + String.fromCharCode(10) : '') +
                   'This cannot be undone.')) return;
      var del = await sb().from('boq_documents').delete().eq('id', d.id);
      if (del.error) {
        var m2 = del.error.message || '';
        UI.toast(/violates foreign key|still referenced/i.test(m2)
          ? d.name + ' has billing periods recorded against it, so it cannot be deleted. Remove ' +
            'those first, or keep the BOQ and supersede it.'
          : m2, 'error');
        return;
      }
      UI.toast('Deleted ' + d.name + '.', 'success');
      DOCID = null; REVID = null;
      await load();
    };

    /* WARNING DELETING A DRAFT REVISION DESTROYS ITS LINES -- boq_items and boq_class_map both
       cascade from boq_revisions. Same shape of control as the document trash above, and the same
       three real gates: issued is never deletable, a recorded billing period is refused by the
       DATABASE (boq_billing_periods references boq_revisions WITHOUT cascade, so Postgres says no
       and the foreign-key error is translated rather than shown raw), and the confirm names the
       line count.
       WARNING THE ONLY REVISION OF A BOQ IS REFUSED, and this is a real gate rather than caution:
       no path in this module adds a revision to a document that has none. openNewRev() writes
       document_id from DOCID but the wizard's revision path is offered only when the document
       already holds one, so a document emptied this way would be a shell nothing could fill. The
       message names the control that does work -- the trash beside the BOQ name, which since
       today deletes the last BOQ too. */
    var rd = host.querySelector('#boq-revdel');
    if (rd) rd.onclick = async function () {
      var r = curRev();
      if (!r) return;
      if (revStatus(r) !== 'draft') {
        UI.toast('rev ' + r.rev_no + ' is issued. An issued BOQ is the tendered document and is never ' +
          'deleted - supersede it with a new revision instead.', 'error');
        return;
      }
      /* WARNING THE "ONLY REVISION" REFUSAL IS GONE, and it was mine, from earlier today. Its
         reasoning was sound at the time -- no path added a revision to a document with none, so
         emptying one left a shell nothing could fill -- and the honest fix was to remove the dead
         end rather than to guard it. The wizard's revision path is now offered on a document with
         ZERO revisions ("Create the first revision of NAME"), and the empty state above names the
         document instead of denying it exists. A refusal that exists only because a neighbouring
         screen is incomplete should be removed with the incompleteness, not kept as a monument. */
      var sibs = REVS.filter(function (x) { return x.document_id === r.document_id; });
      var lastRev = sibs.length < 2;
      var dnm = (DOCS.filter(function (x) { return x.id === DOCID; })[0] || {}).name;
      if (!confirm('Delete draft rev ' + r.rev_no + ' and its ' + ITEMS.length + ' line' +
                   (ITEMS.length === 1 ? '' : 's') + '?' +
                   String.fromCharCode(10) + String.fromCharCode(10) +
                   (lastRev ? 'This is the only revision of ' + (dnm || 'this BOQ') +
                              ', which will be left empty. The BOQ itself is kept -- add a revision ' +
                              'to it from Add BOQ, or delete the BOQ with the trash beside its name.' +
                              String.fromCharCode(10) + String.fromCharCode(10) : '') +
                   'This cannot be undone.')) return;
      var del = await sb().from(T_REV).delete().eq('id', r.id);
      if (del.error) {
        var m3 = del.error.message || '';
        UI.toast(/violates foreign key|still referenced/i.test(m3)
          ? 'rev ' + r.rev_no + ' has billing periods recorded against it, so it cannot be deleted. ' +
            'Remove those first, or keep it and supersede it.'
          : m3, 'error');
        return;
      }
      UI.toast('Deleted draft rev ' + r.rev_no + '.', 'success');
      REVID = null;
      await load();
    };

    var dn = host.querySelector('#boq-docname');
    if (dn) dn.onclick = async function () {
      var d = DOCS.filter(function (x) { return x.id === DOCID; })[0];
      if (!d) return;
      var name = prompt('Name this BOQ — the way the client packages it, e.g. "Package 2 BOQ".', d.name);
      if (name == null) return;
      name = String(name).trim();
      if (!name || name === d.name) return;
      var up = await sb().from('boq_documents').update({ name: name, updated_at: new Date().toISOString() }).eq('id', d.id);
      if (up.error) {
        /* The unique index on (project_id, lower(name)) is the real authority; say which rule
           was hit rather than echoing a constraint name at the planner. */
        UI.toast(/duplicate key|unique/i.test(up.error.message || '')
          ? 'Another BOQ on this project is already called that.'
          : up.error.message, 'error');
        return;
      }
      d.name = name;
      UI.toast('Renamed to ' + name + '.', 'success');
      render();
    };
    /* ⚠️ Both import buttons are gone (the wizard asks build-or-import now), so this binding is
       dead markup-side. Removed rather than left as a harmless no-op: a handler for an id nothing
       renders is exactly the shape of the `#pk-boq` bug that hid the BOQ screen for a day. */
    /* ⚠️⚠️ CREATION GOES THROUGH THE WIZARD, EVERYWHERE. Owner, 2026-09-07: *"the add BOQ
       also pops up a new type of window wherein it should go through the wizard as we have
       agreed before. Let's make this global."* This screen was the last exception — + Lot had
       already been routed there the same day. Three different "create" dialogs on one module
       is three places to explain the same model, and they had already drifted: the wizard
       refuses a lot that restates a project code, the bare forms did not.
       ⚠️ `openNewRev` is the FALLBACK, not dead code — if wizard.js failed to load, creating a
       BOQ by hand must still be possible rather than silently unavailable. */
    ['boq-new', 'boq-new2'].forEach(function (id) {
      var b = host.querySelector('#' + id);
      if (b) b.onclick = function () { if (openWizard) openWizard('BOQ'); else openNewRev(); };
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
  /* ⚠️⚠️ THE BILL IS ALREADY SPLIT BY TRADE; NOTHING SAID SO. Owner, 2026-09-07:
     *"you mentioned that I already have the trade-based BOQs. It wasn't apparent that this was
     available when I am creating the BOQ manually."* Correct, and the fault is entirely in the
     presentation. `addAuthoredLines()` maps DIVISION → SHEET, so a hand-built bill already has a
     General Requirement section, a Concrete section, an Aluminum Glass & Glazing Works section —
     42 of them on OPW101 — and `sheetTotals()` has always summed per sheet. The only way to see
     any of that was a dropdown in the filter bar reading **"All sheets"**, which is import
     vocabulary (a *sheet* is a tab in the client's workbook) and means nothing on a BOQ you typed.
     Same class of leak as "Rev no.".
     ⚠️ So the structure gets a bar of its own, above the filters: one chip per trade with its line
     count and its value, and the current filter lit. It is not a new model — it is the model that
     was there, made visible.
     ⚠️ Only rendered when there is more than one trade. On a single-trade bill the bar would be
     one chip that filters to everything, which teaches nothing and costs a row of screen. */
  function tradeBarHTML() {
    var list = sheetList();
    if (list.length < 2) return '';
    var totals = sheetTotals(ITEMS), counts = {};
    ITEMS.forEach(function (r) {
      if (r.line_kind === 'heading') return;
      counts[r.sheet] = (counts[r.sheet] || 0) + 1;
    });
    var word = isManualDraft() ? 'trade' : 'sheet';
    return '<div class="boq-trades">' +
      '<span class="boq-trades-lbl">By ' + word + '</span>' +
      '<button class="boq-trade' + (filt.sheet ? '' : ' on') + '" data-trade="">' +
        'All<span class="boq-trade-n">' + ITEMS.filter(function (r) { return r.line_kind !== 'heading'; }).length + '</span></button>' +
      list.map(function (sh) {
        /* WARNING The tooltip names the PROCUREMENT trades this cost class is let under, which is
           the question a planner has in front of a BOQ: who buys this? "Others" maps to nothing and
           says so, rather than being quietly given a counterpart it does not have.
           WARNING Line breaks via fromCharCode. Every backslash escape that crossed
           bash -> python -> JS today lost a layer somewhere; this form has none to lose. */
        var prcList = TRADEMAP[sh];
        var nl2 = String.fromCharCode(10) + String.fromCharCode(10);
        /* WARNING Only on a hand-built bill, where the chip IS a Finance trade. On an IMPORT the
           chip is the client's own sheet name ("BILLING BREAKDOWN ", trailing space and all), so
           looking it up would miss every time and the tooltip would tell a planner that a sheet
           has no procurement trade -- a statement about the mapping that is really a statement
           about a name the mapping was never asked about. */
        var tip = sh + ' — ' + money(totals[sh] || 0) +
          (word !== 'trade' || !Object.keys(TRADEMAP).length ? ''
            : prcList && prcList.length ? nl2 + 'Let under: ' + prcList.join(', ')
            : nl2 + 'No procurement trade maps to this.');
        return '<button class="boq-trade' + (filt.sheet === sh ? ' on' : '') + '" data-trade="' + esc(sh) + '"' +
          ' title="' + esc(tip) + '">' +
          esc(sh) + '<span class="boq-trade-n">' + (counts[sh] || 0) + '</span></button>';
      }).join('') +
      '</div>';
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
      /* ⚠️ When several BOQs exist the headline is the PROJECT figure and the sub-line names
         this document's share, because the contract is the sum of its bills. With one BOQ the
         two are identical and saying so twice would be noise. */
      (PROJTOTAL != null
        ? kpi('Contract value', money(PROJTOTAL), 'all ' + DOCS.length + ' BOQs · this one ' + money(total))
        : kpi('Contract value', money(total), 'sum of priced lines')) +
      kpi('Measured lines', measured, 'carry a quantity') +
      kpi('Scope boundaries', excl.length, 'excluded from roll-ups', excl.length ? 'warn' : '') +
      kpi('Mapped to class codes', Object.keys(CMAP).length, 'of ' + ITEMS.filter(mappable).length + ' mappable') +
      '</div>';

    h += tradeBarHTML();

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

    /* THE DRAFT BANNER. ⚠️ Every figure below it is provisional and a draft that looks
       like an issued BOQ is a number that gets quoted in a meeting, so it is the loudest
       thing on the screen and it carries the two actions a draft needs. */
    if (isDraft()) {
      h += '<div class="boq-draft">' +
        '<span class="boq-draft-txt"><strong>Draft — not issued.</strong> Lines are editable and nothing bills ' +
        'against it. Issue it when complete.</span>' +
        (canWrite ?
          /* WARNING TWO DOORS, AND THE ORDER SAYS WHICH IS WHICH. "From the schedule" is the one
             the owner's process asks for at this point -- the detailed bill is read off the
             detailed programme -- and it produces lines that arrive already matched. The class-code
             ladder stays for work the programme does not carry yet, and for the FIRST, high-level
             bill, which is written before any schedule exists. Primary sits rightmost here, as in
             every other toolbar in this module. */
          '<button class="pd-btn" id="boq-addsched">Add lines from the schedule…</button> ' +
          '<button class="pd-btn pd-btn-primary" id="boq-addcodes">Add lines from class codes…</button> ' +
          '<button class="pd-btn" id="boq-issue">Issue revision…</button>' : '') +
        '</div>';
    }

    h += '<div class="boq-filters">' +
      '<input class="pd-input" id="boq-f-q" placeholder="Search item no., description, unit…" value="' + esc(filt.q) + '" />' +
      /* Same word as the trade bar above, for the same reason - "sheet" is the client's
         workbook tab and means nothing on a bill somebody typed. */
      '<select class="pd-select" id="boq-f-sheet"><option value="">' +
        (isManualDraft() ? 'All trades' : 'All sheets') + '</option>' +
        sheetList().map(function (s) { return '<option' + (filt.sheet === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<select class="pd-select" id="boq-f-kind"><option value="">All line kinds</option>' +
        ['measured', 'lump_sum', 'provisional', 'excluded', 'heading'].map(function (k) {
          return '<option value="' + k + '"' + (filt.kind === k ? ' selected' : '') + '>' + esc(kindLabel(k)) + '</option>'; }).join('') + '</select>' +
      '<select class="pd-select" id="boq-f-mapped"><option value="">Mapped or not</option>' +
        '<option value="yes"' + (filt.mapped === 'yes' ? ' selected' : '') + '>Mapped</option>' +
        '<option value="no"' + (filt.mapped === 'no' ? ' selected' : '') + '>Unmapped</option></select>' +
      '<span class="cc-count">' + filtered().length + ' of ' + ITEMS.length + '</span>' +
      '<span class="boq-spacer"></span>' +
      /* Only worth showing when there is a hierarchy to act on. */
      (ITEMS.some(function (x) { return x.line_kind === 'heading'; })
        ? '<button class="pd-btn" id="boq-collapse">Collapse all</button>' +
          '<button class="pd-btn" id="boq-expand">Expand all</button>' : '') +
      /* ⚠️ Only rendered when something IS selected. A permanently-visible "Delete selected (0)"
         is a destructive control sitting armed on a screen whose whole job is data entry. */
      /* ⚠️⚠️ `isDraft() && canWrite`, NOT the `draft` local — SECOND instance of the same bug in
         this one filter bar. `draft` is declared ~17 lines BELOW here, so `var` hoisting makes it
         `undefined` and the condition is always false: the owner ticked every row and asked
         *"where is the delete lines?"* because the button had never once rendered. The keyboard
         hint two lines up had the identical fault and was caught; this one was not, because both
         were written in the same edit and only one was re-read.
         ⚠️ Anything added to this bar must use `isDraft()`, not `draft`. */
      (isDraft() && canWrite && selCount()
        ? '<button class="pd-btn pd-btn-danger" id="boq-delsel">Delete ' +
          selCount() + ' selected</button>' : '') +
      /* ⚠️⚠️ HIDDEN WHEN THE PROJECT HAS NO LOTS. Owner, 2026-09-07: *"there is also an assign to
         contract package button where there is no contract package. In this case it should apply
         to the whole contract."* It already does — a line with `package_id` null belongs to the
         project, which is what every roll-up reads — so with no lots defined the button could only
         ever open a picker with nothing in it. Offering it implies there is an assignment to make
         and that the current state is unassigned; both are wrong. Same argument as hiding the
         Contract lots section: a control with nothing to act on is worse than no control, because
         it invents a decision.
         ⚠️ `canWrite` alone is not enough and `PKGS` is the right test, not `packages` on the
         contract: this is per-BOQ-line assignment, and the lots it assigns to are this project's. */
      (canWrite && PKGS.length
        ? '<button class="pd-btn" id="boq-pkgs">Assign to contract lot…</button>' : '') +
      /* ⚠ The keyboard hint and Export have BOTH left this bar. The hint moved to the FOOT of the
         grid it describes (see itemsHTML); Export moved to the topbar, which now asks what to
         export -- owner: *"There is an export button at the title bar we can have option to export
         to excel for which items contracts/boq/ or all"*. What is left here is only what narrows
         the view, which is what a filter bar is for. */
      '</div>';

    /* ⚠️ ON A DRAFT THE MONEY COLUMNS BECOME RATE COLUMNS, and that is the honest
       header. An imported line's `mat_amount` is the client's own figure; an authored one's
       is qty × the rate we typed. Showing "Material" over an input the planner fills with a
       RATE is how a rate gets entered as an amount. */
    var draft = isDraft() && canWrite;
    /* ⚠️⚠️ ITEM AND CLASS CODE ARE THE SAME COLUMN ON AN AUTHORED BILL. Owner, 2026-09-07:
       *"there is an item column which is just the same with the class code column"*. Correct, and
       only there: `addAuthoredLines()` writes the class code AS the item number, because a line
       written FROM a code has no other identity. On an IMPORTED bill they are different facts —
       `item_no` is the client's own numbering (1.1, A-3, 2.04) and the class code is the Finance
       code somebody mapped onto it — so both columns carry information and both must stay.
       ⚠️ Decided from the DATA, not from `origin`, because a draft can hold both authored and
       imported lines once somebody adds to an imported revision. Only when EVERY mapped line's
       code equals its own item number is the column redundant.
       ⚠️ ITEM is the one kept. It is the leftmost column, it carries the indent and the collapse
       caret, and dropping it would take the tree controls with it. */
    var codeIsItem = (function () {
      var n = 0;
      for (var i = 0; i < ITEMS.length; i++) {
        var r = ITEMS[i], cm = CMAP[r.id];
        if (!cm) continue;
        n++;
        if (String(cm.class_code) !== String(r.item_no || '')) return false;
      }
      return n > 0;
    })();
    /* ⚠️ `boq-fillable` ONLY ON A DRAFT. The cells are transparent inputs with transparent
       borders — invisible until hovered — which is right for an ISSUED bill, where they are
       read far more often than touched and the trigger refuses writes anyway. On a draft it is
       exactly wrong: owner, 2026-09-07, *"the table is not apparent to be filled out"*. Measured
       on OPW101's draft: **701 priceable rows x 5 numeric fields = 3,505 invisible inputs**,
       each `background: rgba(0,0,0,0)` with `border: 1px solid rgba(0,0,0,0)` and no
       placeholder. Nothing on screen said any of it could be typed into. */
    /* ⚠️ `pdg-grid` carries WPM review.html's grid SKIN (assets/js/xlgrid.js injects it):
       tight cells, a sticky uppercase header band, zebra stripes, tabular numerals and a
       cell-shaped cursor. Applied on an ISSUED revision too, not just a draft — the owner
       asked to follow that grid's design, and a bill should not change shape depending on
       whether you may type in it. `boq-fillable` still gates only the EDITABLE affordances. */
    /* ⚠️ A REAL <colgroup>, WHICH IS WHAT MAKES THE WIDTHS PROPORTIONAL. Owner: *"the column
       width is not proportional to the content"*. It could not be: the table was hand-written
       <td>s with no declared widths, so every column was whatever the browser inferred from the
       longest cell it happened to see. `w` on each column spec is now a real declaration, and
       Description gets 300px because it is prose while UoM gets 74 because it holds "m2". */
    var COLS = boqCols(draft, codeIsItem);
    LASTCOLS = COLS;
    h += '<div class="pd-card cc-tablecard"><table class="cc-table boq-table pdg-grid' +
      (draft ? ' boq-fillable' : '') + '" style="table-layout:fixed;min-width:' +
      COLS.reduce(function (a, c) { return a + c.w; }, 0) + 'px">' +
      '<colgroup>' + COLS.map(function (c) { return '<col style="width:' + c.w + 'px">'; }).join('') + '</colgroup>' +
      '<thead><tr>' +
      COLS.map(function (c) {
        return '<th' + (c.r ? ' class="cc-r"' : '') + '>' +
          (c.k === '_act'
            ? '<input type="checkbox" id="boq-selall" title="Select every line the filters currently show" />'
            : esc(c.label)) + '</th>';
      }).join('') + '</tr></thead><tbody>';

    var list = filtered();
    var span = COLS.length;
    /* ⚠️ AN EMPTY DRAFT IS NOT A FAILED SEARCH. This said "No lines match these filters" on a
       BOQ that had just been created and had no lines to filter — technically true and useless,
       and it was the first thing a planner saw after choosing to build one by hand. The two
       cases are now distinguished: nothing here YET (say what to do) versus nothing matching
       (say how to clear it). Owner, 2026-09-07: *"make sure that the BOQ manual add is
       intuitive and easy to use."* */
    if (!list.length) {
      var filtering = !!(filt.q || filt.sheet || filt.kind || filt.mapped);
      var body;
      if (filtering) {
        body = '<b>No lines match these filters.</b><br><span class="cc-mut">Clear the search '
             + 'or the dropdowns above to see the whole bill.</span>';
      } else if (draft) {
        /* ⚠️⚠️ BLOCK ELEMENTS, NOT AN INLINE <b> FOLLOWED BY AN INLINE-BLOCK. The first version
           put the heading in a `<b>` and the steps in a `display:inline-block` div, so the two
           shared one line box: inside a `text-align:center` cell the heading was baseline-aligned
           against a tall inline-block and rendered **between steps 2 and 3**. Owner, seeing it:
           *"the tips indicated within the section isn't appropriate"* — it read as broken because
           it was. A heading above a list is two blocks; anything else is a coincidence waiting to
           break. ⚠️ And a real <ol> rather than hand-typed "1." "2." "3." with <br>s, so the
           numbering cannot drift from the order and the indent is the browser's problem. */
        body = '<div class="boq-empty-h">This BOQ is empty — build it in three steps.</div>'
             + '<ol class="boq-empty-steps">'
             + '<li><b>Add lines from class codes</b> — tick a whole division and every code under '
             + 'it comes in as a line. Each division becomes its own <b>trade section</b>.</li>'
             + '<li>Fill in the <b>quantity and rates</b>, right here in the table.</li>'
             + '<li><b>Match to schedule</b> — spread each line across the activities carrying its code.</li>'
             + '</ol>'
             + '<div class="boq-empty-foot">Then <b>Issue revision</b> when it is complete. '
             + 'Until you do, nothing bills and the contract value does not move.</div>';
      } else {
        body = '<b>This revision has no lines.</b>';
      }
      h += '<tr><td colspan="' + span + '" class="cc-mut" style="text-align:center;padding:30px;">'
         + body + '</td></tr>';
    }
    /* How many rows each heading owns, in the CURRENT (filtered, ordered) list. A heading owns
       every following row deeper than itself, up to the next row at its own depth or shallower —
       derived from `depth` rather than `parent_id`, so it stays correct against exactly what is on
       screen even when a filter has removed rows from the middle of a branch. */
    var kids = {};
    for (var ki = 0; ki < list.length; ki++) {
      if (list[ki].line_kind !== 'heading') continue;
      var kd = list[ki].depth || 0, kn = 0;
      for (var kj = ki + 1; kj < list.length && (list[kj].depth || 0) > kd; kj++) kn++;
      kids[list[ki].id] = kn;
    }
    var skipDepth = null;   // while set, anything deeper than this is inside a collapsed heading
    var rowNo = 0;

    list.forEach(function (r) {
      var rd = r.depth || 0;
      if (skipDepth !== null) {
        if (rd > skipDepth) return;
        skipDepth = null;
      }
      var head = r.line_kind === 'heading';
      if (head && COLLAPSED[r.id]) skipDepth = rd;
      var cm = CMAP[r.id];
      var al = allocOf(r.id);
      // A heading holds no figures, so its cells stay empty rather than becoming inputs.
      var ed = draft && !head;
      if (!head) rowNo++;

      h += '<tr class="' + (head ? 'boq-head' : '') + '" data-id="' + esc(r.id) + '">' +
        COLS.map(function (c) {
          var cls = c.r ? ' class="cc-r"' : '';

          if (c.k === '_row') {
            /* Numbered over what is ON SCREEN, so it always matches what the planner is counting
               down. A number tied to the stored row would skip wherever a filter or a collapsed
               heading hides something, which is worse than no number. */
            return '<td class="cc-r pdg-rownum">' + (head ? '' : rowNo) + '</td>';
          }
          if (c.k === 'item_no') {
            return '<td class="boq-no"' + ' style="padding-left:' + (6 + Math.min(rd, 6) * 12) + 'px">' +
              (head && kids[r.id]
                ? '<button class="boq-caret" data-tog="' + esc(r.id) + '" title="' +
                  (COLLAPSED[r.id] ? 'Expand' : 'Collapse') + '" aria-expanded="' +
                  (COLLAPSED[r.id] ? 'false' : 'true') + '">' + (COLLAPSED[r.id] ? '\u25b8' : '\u25be') +
                  '</button>' : '') +
              esc(r.item_no || '') +
              (head && COLLAPSED[r.id] ? ' <span class="boq-hidden-n">' + kids[r.id] + '</span>' : '') +
              '</td>';
          }
          if (c.k === 'description') {
            return '<td class="cc-desc" title="' + esc((r.sheet || '') + ' \u00b7 row ' + r.source_row) + '">' +
              (draft
                ? '<input class="boq-cell boq-cell-t" data-f="description" data-i="' + esc(r.id) + '" value="' + esc(r.description || '') + '" />'
                : '<div class="cc-desc-txt">' + esc(r.description || '') + '</div>') +
              (r.exclusion_note && !draft ? '<div class="boq-excl">' + esc(r.exclusion_note) + '</div>' : '') +
              '<div class="cc-mini">' + esc(r.sheet) + ' \u00b7 row ' + r.source_row + '</div></td>';
          }
          if (c.k === 'unit') return '<td>' + (head ? '' : uomCell(r, ed)) + '</td>';

          /* ⚠️⚠️ A COMPUTED COLUMN IS RENDERED, NEVER TYPED INTO. recalc() already maintains
             mat_amount / lab_amount / amount on every qty or rate change; these cells simply show
             what it produced. Rendering an <input> here would invite an edit that the next recalc
             silently overwrites — a figure that will not stay where you put it is worse than one
             you cannot edit at all. */
          if (c.calc === true) {
            return '<td class="cc-r boq-calc" title="' + esc(c.label + ' = quantity x rate') + '">' +
              (head ? '' : money2(r[c.k])) + '</td>';
          }
          if (c.k === 'amount') {
            /* Derived by default, typed by exception — `derived_amount` records which. */
            if (head) return '<td class="cc-r"></td>';
            if (r.derived_amount !== false && !ed) return '<td class="cc-r boq-calc">' + money2(r.amount) + '</td>';
            return '<td class="cc-r' + (r.derived_amount !== false ? ' boq-calc' : '') + '">' +
              (ed ? cellIn(r, 'amount', 'num') : (r.exclusion_note ? '<span class="cc-mut">\u2014</span>' : money2(r.amount))) + '</td>';
          }
          if (c.type === 'num') {
            return '<td class="cc-r">' + (head ? '' : (ed ? cellIn(r, c.k, 'num')
              : (c.k === 'qty' ? qtyStr(r.qty) : money2(r[c.k])))) + '</td>';
          }
          if (c.k === 'line_kind') {
            return '<td>' + (ed
              ? '<select class="boq-cellsel" data-f="line_kind" data-i="' + esc(r.id) + '">' +
                ['measured', 'lump_sum', 'provisional', 'excluded', 'heading'].map(function (k) {
                  return '<option value="' + k + '"' + (r.line_kind === k ? ' selected' : '') + '>' + esc(kindLabel(k)) + '</option>';
                }).join('') + '</select>'
              : '<span class="boq-kind k-' + esc(r.line_kind) + '">' + esc(kindLabel(r.line_kind)) + '</span>') + '</td>';
          }
          if (c.k === '_class') {
            return '<td>' + (cm ? '<span class="boq-code" title="' + esc(cm.source) + '">' + esc(cm.class_code) + '</span>'
              : (mappable(r) ? '<span class="cc-mut">\u2014</span>' : '')) + '</td>';
          }
          if (c.k === '_pkg') return '<td>' + pkgCell(r) + '</td>';
          if (c.k === '_alloc') return '<td class="cc-r">' + (qtyLine(r) ? allocChip(r, al) : '') + '</td>';
          if (c.k === '_act') {
            /* ⚠️ NO PER-ROW DELETE. Owner: *"delete this line button in the row shouldn't be here
               as well since we have the checkbox already."* Two ways to delete one line is one
               too many, and the × was the more dangerous of the pair: a single unconfirmed click
               sitting at the end of every row, next to a checkbox, on a table you scroll fast.
               Selection + "Delete N selected" is the same act with a confirm and a count.
               ⚠️ delLine() is kept — openSplit and the import preview still call it. */
            return '<td class="cc-actcol"><input type="checkbox" class="boq-selbox" data-sel="' + esc(r.id) + '"' +
              (SEL[r.id] ? ' checked' : '') + ' title="Select this line" /></td>';
          }
          return '<td' + cls + '></td>';
        }).join('') + '</tr>';
    });
    h += '</tbody></table></div>';
    /* ⚠⚠ THE SHORTCUT HINT SITS UNDER THE GRID, NOT ABOVE IT. Owner: *"Can we move the keyboard
       tooltips at the bottom of the BOQ grid."* In the filter bar it put a line of keyboard syntax
       between the planner and the first row on every open -- read once, then in the way forever. At
       the foot it is where you look when you want it and nowhere when you do not.
       ⚠ `isDraft() && canWrite`, NOT the `draft` local: that is declared BELOW this point, so `var`
       hoisting would make it `undefined` and the hint would silently never render. The comment
       travels with the line, because the trap travels with it. */
    if (isDraft() && canWrite && window.PDGrid) {
      h += '<div class="boq-gridfoot">' + PDGrid.hintHTML() + '</div>';
    }
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

  /* ==========================================================================
     upsertAllocs — the ONE writer for boq_allocations, and the un-run-migration degrade
     ==========================================================================
     `matched_by` / `match_score` arrive with `2026-09-10-boq-match-rung.sql`. Until it is run
     PostgREST answers a payload naming them with PGRST204 ("column not found in schema cache")
     and REJECTS THE WHOLE BATCH — so without this the matcher would ship and every Apply would
     fail on a database nobody had migrated yet.

     ⚠️ It drops the two new keys and retries ONCE, then reports what it gave up. Same shape as
     `module.js`'s `_dropMissingNull` on `contracts_claims`, and the same reason: this repo has
     more than one live database and the module must work on the un-migrated one. The rung is an
     audit annotation — losing it is a smaller harm than refusing to record the allocation.
     ⚠️ It does NOT swallow other errors. An RLS refusal or a constraint violation must still
     surface, or a failed write reads as a success. */
  var _allocRungOk = true;
  var _allocScopeOk = true;   // cleared once per session by the degrade above
  async function upsertAllocs(rows) {
    if (!rows.length) return { ok: true, dropped: '' };
    var strip = function (list) {
      return list.map(function (p) { var c = Object.assign({}, p); delete c.matched_by; delete c.match_score; return c; });
    };
    /* ⚠️⚠️ A PROJECT-SCOPED ROW CANNOT DEGRADE, and this is the one place in this file where
       dropping a column would be WRONG. Without `scope` the row is indistinguishable from an
       activity allocation, and `activity_id` is still NOT NULL on that database — so the insert
       would either fail anyway or, worse, land as an activity allocation naming no activity. It is
       refused with the migration named instead. Everything else still degrades as before. */
    var wantsScope = rows.some(function (p) { return String(p.scope || 'activity') === 'project'; });
    var stripScope = function (list) {
      return list.map(function (p) { var c = Object.assign({}, p); delete c.scope; return c; });
    };
    var send = async function (list) {
      for (var i = 0; i < list.length; i += 300) {
        var res = await sb().from(T_ALLOC).upsert(list.slice(i, i + 300), { onConflict: 'boq_item_id,activity_id' });
        if (res.error) return res.error;
      }
      return null;
    };
    var err = await send(_allocScopeOk ? (_allocRungOk ? rows : strip(rows))
                                       : stripScope(_allocRungOk ? rows : strip(rows)));
    if (!err) return { ok: true, dropped: _allocRungOk ? '' : 'The match rung was not recorded — run migrations/2026-09-10-boq-match-rung.sql.' };
    var msg = String(err.message || err);
    if (_allocScopeOk && /\bscope\b/i.test(msg) && /PGRST204|schema cache|column/i.test(msg)) {
      _allocScopeOk = false;
      if (wantsScope) {
        return { ok: false, msg: 'This line is allocated to the project, which needs ' +
                 'migrations/2026-09-10-boq-project-scope.sql. Run it, then apply again — nothing was saved.' };
      }
      var err0 = await send(stripScope(_allocRungOk ? rows : strip(rows)));
      if (!err0) return { ok: true, dropped: '' };
      return { ok: false, msg: String(err0.message || err0) };
    }
    if (_allocRungOk && /matched_by|match_score|PGRST204|schema cache/i.test(msg)) {
      _allocRungOk = false;                                   // ⚠️ once per session, not per row
      var err2 = await send(strip(rows));
      if (!err2) return { ok: true, dropped: 'The match rung was not recorded — run migrations/2026-09-10-boq-match-rung.sql.' };
      return { ok: false, msg: String(err2.message || err2) };
    }
    return { ok: false, msg: msg };
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
    host.querySelectorAll('[data-trade]').forEach(function (b) {
      b.onclick = function () { filt.sheet = b.dataset.trade || ''; render(); };
    });
    var pk = host.querySelector('#boq-pkgs'); if (pk) pk.onclick = openAssignPackage;
    var ac = host.querySelector('#boq-addcodes'); if (ac) ac.onclick = openCodeBuilder;
    var asch = host.querySelector('#boq-addsched'); if (asch) asch.onclick = openSeedFromSchedule;
    var is = host.querySelector('#boq-issue'); if (is) is.onclick = issueRev;
    /* ⚠️ SAVED ON `change`, NOT ON `input`. On input every keystroke of a quantity is a
       round trip and a re-render that steals focus mid-number — which reads as the field
       fighting you. change fires on blur or Enter, i.e. once the figure is finished. */
    host.querySelectorAll('.boq-cell[data-f]').forEach(function (inp) {
      inp.onchange = function () { saveCell(inp.dataset.i, inp.dataset.f, inp.value); };
    });
    /* WARNING SPREADSHEET KEYS COME FROM THE SHARED assets/js/xlgrid.js, NOT FROM HERE. The cells
       already carried data-i and data-f before that file existed, which is precisely why PDGrid
       attaches to a table instead of rendering one: this module keeps its own columns, formatting
       and validation, and gains Tab/Enter navigation, Shift-select, Ctrl+D fill-down, Ctrl+Z and
       paste-a-column-from-Excel without a single change to how it renders.
       WARNING onSet goes through saveCell, the SAME path an ordinary edit takes, so a pasted or
       filled value gets the identical parsing, the identical 1,000-is-not-empty guard and the
       identical persistence. A second write path would be a second set of bugs.
       WARNING Re-attached on every render because render() replaces the whole table; the previous
       instance's listeners die with the DOM it was bound to. detach() is still called so a
       long-lived host does not accumulate them. */
    if (window.PDGrid) {
      if (_grid) { try { _grid.detach(); } catch (e) {} }
      _grid = PDGrid.attach({
        root: host,
        cell: '.boq-cell[data-f]',
        /* WARNING The SPEC is what unlocks the ported features: `w` drives the colgroup and the
           resize, `req` drives the empty-cell bar, `setAll` says which columns are safe to write
           wholesale. Without it PDGrid still works, it just has nothing to lay out. */
        columns: LASTCOLS || [],
        storageKey: 'boq',
        onSet: function (id, field, value) { saveCell(id, field, value); },
        onSetColumn: function (col) {
          var v = prompt('Set ' + col.label + ' for every line shown on this tab:', '');
          if (v == null) return;
          v = String(v).trim();
          var list2 = filtered().filter(function (r) { return r.line_kind !== 'heading'; });
          if (!list2.length) return;
          if (!confirm('Set ' + col.label + ' to "' + v + '" on ' + list2.length + ' line' +
                       (list2.length === 1 ? '' : 's') + '?')) return;
          /* Sequential, through saveCell, so each write gets the same parsing and the same
             recalc a typed edit would - and so a failure stops rather than half-applying. */
          (async function () {
            for (var i = 0; i < list2.length; i++) await saveCell(list2[i].id, col.k, v);
            UI.toast('Set ' + col.label + ' on ' + list2.length + ' lines.', 'success');
          })();
        }
      });
    }
    host.querySelectorAll('.boq-cellsel[data-f]').forEach(function (selEl) {
      selEl.onchange = function () { saveCell(selEl.dataset.i, selEl.dataset.f, selEl.value); };
    });
    host.querySelectorAll('[data-tog]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.tog;
        if (COLLAPSED[id]) delete COLLAPSED[id]; else COLLAPSED[id] = 1;
        render();
      };
    });
    var cAll = host.querySelector('#boq-collapse');
    if (cAll) cAll.onclick = function () {
      ITEMS.forEach(function (x) { if (x.line_kind === 'heading') COLLAPSED[x.id] = 1; });
      render();
    };
    var eAll = host.querySelector('#boq-expand');
    if (eAll) eAll.onclick = function () { COLLAPSED = {}; render(); };
    host.querySelectorAll('.boq-selbox[data-sel]').forEach(function (cb) {
      cb.onchange = function () {
        if (cb.checked) SEL[cb.dataset.sel] = 1; else delete SEL[cb.dataset.sel];
        render();
      };
    });
    /* ⚠️ Select-all means every line THE FILTERS CURRENTLY SHOW, not every line in the bill —
       a checkbox that silently reaches past what is on screen is how people delete work they
       could not see. Rows hidden inside a collapsed heading ARE included: they are matched by
       the filters and the planner collapsed them for reading, not to exclude them. */
    var sa = host.querySelector('#boq-selall');
    if (sa) sa.onchange = function () {
      var vis = filtered();
      if (sa.checked) vis.forEach(function (r) { SEL[r.id] = 1; });
      else vis.forEach(function (r) { delete SEL[r.id]; });
      render();
    };
    var ds = host.querySelector('#boq-delsel');
    if (ds) ds.onclick = delSelected;
    /* ⚠️ The per-row × is gone (selection + "Delete N selected" replaces it), so nothing in the
       items table renders `data-del` any more. Removed rather than left as a harmless no-op —
       twice today a handler bound to an id nothing renders has cost real time (`#pk-boq` hid the
       BOQ screen for a day; `#boq-import` outlived its buttons). `delLine()` itself stays: the
       import preview still calls it. */
  }
  /* One input per editable cell.
     ⚠️ NUMERIC CELLS ARE type="text", NOT type="number", AND THIS IS THE OPPOSITE OF THE
        OBVIOUS CHOICE. Measured in the render harness: with type="number", typing anything
        the browser cannot parse makes `input.value` read back as the EMPTY STRING — so
        `1,000`, the way every planner writes a thousand, arrived here as "" and SILENTLY
        CLEARED the quantity. No error, no rejection, just a figure gone from a BOQ.
        As text, `numOf` does the parsing instead, and it already strips thousands
        separators, ₱/$/€/£ and parenthesised negatives because the importer needed exactly
        that. So `1,000` and `₱1,200.50` are accepted, and genuine nonsense is REFUSED OUT
        LOUD (see saveCell) rather than written as a null.
        `inputmode="decimal"` keeps the numeric keypad on a phone, which is the only thing
        type="number" was buying. */
  /* A placeholder is the cheapest possible 'you may type here'. ⚠️ It is deliberately the
     SHAPE of the expected value (0.00 for money, 0 for a count, the word unit for text)
     rather than a label — the column header already names the field, and repeating it in every
     one of 3,505 cells is noise. Shown muted so an empty cell never reads as a real zero. */
  var CELL_PH = { qty: '0', mat_rate: '0.00', lab_rate: '0.00', amount: '0.00', unit: 'unit' };
  function cellIn(r, field, kind) {
    var v = r[field], ph = CELL_PH[field];
    return '<input class="boq-cell" data-f="' + field + '" data-i="' + esc(r.id) + '"' +
      (kind === 'num' ? ' inputmode="decimal"' : '') +
      (ph ? ' placeholder="' + ph + '"' : '') +
      ' value="' + esc(v == null ? '' : v) + '" />';
  }

  /* ⚠ SPLIT IN TWO so the topbar's "export what?" chooser can put this alongside the contract
     records in ONE workbook. `boqSheet()` returns rows and writes nothing; `exportItems()` is the
     one-sheet download. A chooser that re-implemented these columns would be a second definition of
     what a BOQ export contains, and the two would drift the first time a column moved. */
  function boqSheet() {
    var list = filtered();
    if (!list.length) return null;
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
    return { name: 'BOQ', rows: aoa };
  }
  function exportItems() {
    var sh = boqSheet();
    if (!sh) { UI.toast('Nothing to export.', 'error'); return; }
    var ws = XLSX.utils.json_to_sheet(sh.rows), wb = XLSX.utils.book_new();
    ws['!cols'] = Object.keys(sh.rows[0]).map(function (k) { return { wch: k === 'Description' ? 50 : Math.max(12, k.length + 2) }; });
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
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
      /* ⚠️ Reframed 2026-08-27. This modal used to headline "No contract packages yet"
         and hold up the Avesta pair as the model — but Avesta is TWO PROJECTS, and a BOQ
         needs no package at all: `boq_items.package_id` is nullable and unfilled by
         design. Assigning is a way to NARROW a BOQ, never a precondition for having one. */
      var m0 = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">This project has no packages</h2>' +
        '<button class="pd-modal-close" id="ap-x0">&times;</button></div>' +
        '<div class="boq-imp"><p class="cc-hint">Nothing is wrong: assigning a package <strong>narrows</strong> a BOQ ' +
        'to one lot, it is never required. This BOQ already belongs to the project, and the billing reads it either ' +
        'way. Most projects are a single lot and need no package.</p>' +
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

    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">Assign BOQ to a contract lot</h2><div class="pd-modal-sub">Which lot these lines are administered under</div></div>' +
      '<button class="pd-modal-close" id="ap-x">&times;</button></div>' +
      '<div class="boq-imp" id="ap-body"></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ap-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ap-go">Apply</button></div>');
    var body = m.el.querySelector('#ap-body');

    function paint() {
      var chosen = sheets.filter(function (x) { return x.pick; });
      body.innerHTML =
        '<p class="cc-hint">A package is a <strong>division below this project</strong> — a lot inside one contract ' +
        'with no project code of its own. This BOQ belongs to one of them; its sheets are the ' +
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
    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">Import BOQ</h2><div class="pd-modal-sub">Read the client&#39;s workbook — you accept the column map before anything is written</div></div>' +
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
      /* ⚠️⚠️ SCOPED TO THE DOCUMENT, NOT THE PROJECT. This cleared `is_current` across every
         revision of the project, which was right while a project had one BOQ and is a data
         corruption now that it has several: importing a Structural BOQ would un-current the
         Architectural one, and the contract value — which sums each document's current
         revision — would quietly drop that BOQ's whole amount. */
      var _sup = sb().from(T_REV).update({ is_current: false });
      _sup = DOCID ? _sup.eq('document_id', DOCID) : _sup.eq('project_id', pid).is('document_id', null);
      await _sup;
      var inv = {};
      picked.forEach(function (s) { inv[s.sheet] = { role: s.kind, lines: s.lines, headings: s.headings, sum: s.sum, stated: s.stated_total, header_row: s.header_row + 1 }; });
      /* ⚠️ CREATED AS A DRAFT AND ISSUED AT THE END (2026-09-07). Two reasons, and the
         second is the better one:
           1. the parent_id second pass below UPDATEs the rows it just inserted, and the
              issued-revision trigger in 2026-09-07-boq-manual.sql refuses that;
           2. a half-finished import is now visibly a draft. Before this, a run that died
              between the insert and the hierarchy pass left an is_current revision with a
              partial contract sum sitting on screen as though it were the tendered document.
         ⚠️ is_current cannot be set here either — the database refuses a current draft —
            so it moves in the same update that issues it, once the lines are all in. */
      var rev = await sb().from(T_REV).insert({
        project_id: pid, rev_no: revNo,
        issued_date: el('bi-date').value || null, po_no: (el('bi-po').value || '').trim() || null,
        contract_total: numOf(el('bi-total').value), source_file: d.file,
        sheet_inventory: inv, status: 'draft', origin: 'import', is_current: false, created_by: UID,
        document_id: DOCID || null
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

      /* Now it is complete: issue it and make it current, in ONE update so the
         draft-not-current trigger sees a consistent row. */
      say('Issuing revision ' + revNo + '…');
      var fin = await sb().from(T_REV)
        .update({ status: 'issued', is_current: true, updated_at: new Date().toISOString() })
        .eq('id', revId);
      if (fin.error) throw fin.error;

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
  // MANUAL AUTHORING (2026-09-07) — a BOQ built from the class-code library
  // ==========================================================================
  /* Owner: *"Let's enable the users to manually add a BOQ, this would be based on the
     class code library and from the class code library the planner would be able to tag
     it to the activities in the schedule module. Let's think of a better way to do this
     (bulk connect, per trade etc.). If we make the manual add of BOQ perfect, it would
     enable us to better execute/implement the import feature."*

     THE INVERSION THAT MAKES THIS WORTH BUILDING, and it is not a UI convenience.
     The import chain runs BACKWARDS from the client's words:

         client's description  ──►  guess a class code  ──►  find activities with it

     Every arrow there is a place to be confidently wrong. The middle one is the whole of
     `boq_class_map` and its suggestion library — a judgement, revision-scoped, never
     auto-accepted, because two clients saying "Wall Systems and Cladding" may mean
     different Finance codes. The right-hand one fails silently in the common case: no
     activity carries the code, so nothing is proposed.

     Authoring runs the chain FORWARDS:

         class code  ──►  the line  ──►  the activities

     The code is now the ORIGIN, not an inference, so the middle arrow stops being a
     judgement at all — which is why these mappings are stored as `source='authored'` and
     not 'hand_picked' (see the migration's §4: the suggestion library learns from these
     rows, and feeding it a description that was GENERATED from the code is how it starts
     proposing its own output back to itself).

     WHY THIS MAKES THE IMPORTER BETTER, which is what the owner is actually after: the
     importer's hard problem is that it must INFER structure — where the header row is,
     which lines are headings, what a code might be. Authoring produces the same tables
     with all of that KNOWN. So a manually built BOQ is a correctness oracle: the shape
     the importer is trying to reconstruct, available in a form where every field is
     certain. Divisions become sheets, groups become headings, items become leaves — the
     import's `Total of X >>` marker hunt has no counterpart here because nothing needs
     discriminating.

     ⚠️ WHAT IS DELIBERATELY NOT RELAXED. `boq_items` stays append-and-supersede for
        anything ISSUED, enforced by a trigger in the migration rather than by this file
        remembering to. Draft lines are editable because a draft is nobody's evidence
        yet. The instant it is issued the 2026-08-24 rule applies in full. */

  function curRev() { return REVS.find(function (r) { return r.id === REVID; }) || null; }
  /* ⚠️ ABSENT READS AS 'issued', WHICH IS HOW THIS DEGRADES. On a database where
     2026-09-07-boq-manual.sql has not run there is no `status` column, every revision
     reads as issued, and this whole feature is simply not offered — the tab behaves
     exactly as it did before. The opposite default would unlock every client BOQ in the
     app the moment someone deployed the JS ahead of the SQL. */
  function revStatus(r) { return (r && r.status) || 'issued'; }
  function isDraft() { return revStatus(curRev()) === 'draft'; }
  function manualHint(err) {
    var m = (err && err.message) || '';
    return /status|origin|does not exist|schema cache|PGRST204|boq_tag_activities|PGRST202/i.test(m)
      ? ' Run <code>' + MIGRATION_MANUAL + '</code> in the Supabase SQL editor, then reload.' : '';
  }

  /* ⚠️ IDENTITY IS (revision, sheet, source_row), so an authored line needs a row number
     that is free ON ITS SHEET. Taken from the current maximum rather than from the line
     count: deleting line 3 of 5 and adding another would otherwise reuse 5 and collide. */
  function nextRow(sheet) {
    var max = 0;
    ITEMS.forEach(function (r) { if (r.sheet === sheet && r.source_row > max) max = r.source_row; });
    return max + 1;
  }

  /* The chart folded into division › group › item. Order comes from `sort_order`, which
     ensureCodes already sorts on, so the tree reads in Finance's own sequence. */
  /* WARNING THE TOP RUNG IS THE TRADE, NOT THE DIVISION. Owner, 2026-09-07: *"the trade is not
     properly adopted in the new class code mapping update."* Right: the pane was headed TRADE but
     listed `desc_l1` -- 42 Finance divisions (Rebar, Formworks, Concrete, Stoneworks...). The
     updated template added a real Trade column and 2026-09-07-class-code-trades.sql landed it, so
     there are now SEVEN trades, and they are the vocabulary the SCHEDULE speaks. Grouping by
     division meant the BOQ and the schedule could never agree on what a trade is, which is the
     whole reason the column was added.
     WARNING Division is not lost, it is implicit: a group's code carries it (01050 sits under 01),
     and grouping by trade collapses the 42 into the 7 a planner actually packages by.
     WARNING Falls back to desc_l1 for any code with no trade, so a half-run migration degrades to
     the old behaviour rather than piling every code under a blank heading. */
  /* ⚠️⚠️ FOUR LEVELS, NOT THREE. Owner: *"what happened to the third ladder? there should be 4
     descriptions not 3."* Correct, and the collapse was mine. The template carries Trade,
     Description 1 (division), Description 2 (group) and Description 3 (item); I folded division
     away when the Trade column arrived, on the reasoning that a group's code implies it.
     ⚠️ It does not, at this scale. Architectural Works spans many divisions, so dropping one rung
     put **104 groups in a single flat pane** — worse than the accordion the ladder replaced,
     because at least the accordion showed which division a group belonged to.
     ⚠️ Falls back to desc_l1 as the trade for any code with none, so a half-run
     class-code-trades migration degrades instead of piling everything under a blank heading. */
  function buildTree() {
    if (CODETREE) return CODETREE;
    var byT = {}, out = [];
    (CODES || []).forEach(function (c) {
      var tkey = (c.trade && String(c.trade).trim()) || c.desc_l1;
      var t = byT[tkey];
      if (!t) { t = byT[tkey] = { code: tkey, desc: tkey, divs: {}, order: [] }; out.push(t); }
      var d = t.divs[c.code_l1];
      if (!d) { d = t.divs[c.code_l1] = { code: c.code_l1, desc: c.desc_l1, groups: {}, order: [] }; t.order.push(d); }
      var g = d.groups[c.code_l2];
      if (!g) { g = d.groups[c.code_l2] = { code: c.code_l2, desc: c.desc_l2, items: [] }; d.order.push(g); }
      g.items.push(c);
    });
    CODETREE = out;
    return CODETREE;
  }
  function codeRow(code) { return (CODES || []).find(function (c) { return c.code === code; }) || null; }

  // ---- Create a draft revision to author into -------------------------------
  /* The actual insert, shared by the wizard and by openNewRev()'s fallback dialog.
     ⚠️ `is_current` stays FALSE and the database enforces it for a draft: the contract value on
     screen must keep coming from the issued document until this one is issued. */
  /* ⚠️⚠️ RETRIES ON A DUPLICATE LABEL INSTEAD OF FAILING. Owner hit
     `duplicate key value violates unique constraint "boq_revisions_project_rev_idx"` creating a
     second BOQ: the suggested label came back "00" when rev 00 already existed. The cause is load
     ORDER, not arithmetic — `nextRevLabel()` reads the in-memory REVS, and the BOQ section loads
     lazily when it scrolls into view, so opening the wizard from the top of the page asks an
     empty list what the next number is and is told zero.
     ⚠️ Fixed here rather than only in the suggestion, because ANY caller can race that load, and
     because two planners can pick the same label at the same moment however good the default is.
     The unique index is the real authority; this asks it and moves on. The label actually used is
     returned, so the caller reports what happened rather than what it intended. */
  async function createDraft(f) {
    var label = String(f.rev || '').trim() || '00';
    for (var attempt = 0; attempt < 12; attempt++) {
      var ins = await sb().from(T_REV).insert({
        project_id: pid, rev_no: label, issued_date: f.date || null,
        po_no: f.po || null, contract_total: numOf(f.total),
        source_file: null, sheet_inventory: {},
        status: 'draft', origin: 'manual', is_current: false,
        notes: 'Built by hand from the class-code library.', created_by: UID,
        /* ⚠️ Without this every new BOQ is written with a NULL document_id — orphaned from the
           model the migration just installed, and invisible to the per-document revision series
           and the contract-value roll-up. `f.docId` lets a caller create the document first. */
        document_id: f.docId || DOCID || null
      }).select().single();
      if (!ins.error) {
        REVID = ins.data.id; sub = 'items';
        await load();
        return ins.data;
      }
      var msg = ins.error.message || '';
      var dup = ins.error.code === '23505' || /duplicate key|already exists/i.test(msg);
      if (!dup) throw ins.error;
      // Take the number off the end and step it, so 'INTERNAL-01' becomes 'INTERNAL-02'.
      var m = label.match(/^(.*?)(\d+)$/);
      if (m) {
        var n = String(parseInt(m[2], 10) + 1);
        while (n.length < m[2].length) n = '0' + n;
        label = m[1] + n;
      } else {
        label = label + '-2';
      }
    }
    throw new Error('Could not find a free revision label after 12 tries.');
  }

  /* The draft this project is already building, if any. Exported for the wizard, which must not
     offer "start a new revision" as the way to add another trade - see its BOQ step. */
  /* Create a BOQ document — the thing that owns a revision series. `divisions` is advisory:
     it records which trades this BOQ is meant to cover so the UI can steer, and never gates a
     write, because the commercial packaging varies by client (Package 2 holds Architectural,
     Package 3 holds AR — the same trade in two documents). */
  async function createDocument(name, divisions) {
    var ins = await sb().from('boq_documents').insert({
      project_id: pid, name: String(name || '').trim(),
      divisions: divisions || [], sort_order: DOCS.length, created_by: UID
    }).select().single();
    if (ins.error) throw ins.error;
    DOCS.push(ins.data);
    DOCID = ins.data.id;
    return ins.data;
  }

  /* ⚠️ One read, and only when it can differ from what is already on screen. The `in.(...)`
     filter is safe here however many BOQs exist — it lists CURRENT revisions, one per document,
     nowhere near the ~200-uuid URL cap that bites elsewhere in this app. */
  async function computeProjectTotal() {
    PROJTOTAL = null;
    if (DOCS.length < 2) return;
    var ids = ALLREVS.filter(function (r) { return r.is_current && r.document_id; })
                     .map(function (r) { return r.id; });
    if (!ids.length) { PROJTOTAL = 0; return; }
    try {
      var rows = await PDb.selectAll(T_ITEM, function (q) { return q.in('revision_id', ids); },
                                     'amount,line_kind,exclusion_note');
      PROJTOTAL = rows.reduce(function (a, r) { return a + (moneyLine(r) ? Number(r.amount) : 0); }, 0);
    } catch (e) { PROJTOTAL = null; }   // a failed roll-up shows this document's figure, never a wrong one
  }

  function currentDraft() {
    return (REVS || []).filter(function (r) { return revStatus(r) === 'draft'; })[0] || null;
  }

  /* The next free numeric label, so nobody has to invent an identifier. Exported shape is a
     plain string because rev_no is text and a client's own label may not be numeric at all. */
  function nextRevLabel() {
    var ns = (REVS || []).map(function (r) {
      var mm = String(r.rev_no || '').match(/(\d+)/);
      return mm ? parseInt(mm[1], 10) : null;
    }).filter(function (n) { return n != null && isFinite(n); });
    var next = ns.length ? Math.max.apply(null, ns) + 1 : 0;
    return (next < 10 ? '0' : '') + next;
  }

  function openNewRev() {
    /* ⚠⚠ THE REVISION LABEL IS PREFILLED, and that answers a real confusion — owner,
       2026-09-07: *"why does it say Rev no.?"* Because `boq_revisions.rev_no` is `text not
       null` and was designed to hold THE CLIENT'S OWN LABEL off an imported workbook ('05',
       'rev.05', 'R2'). That is import thinking leaking into the manual path: a BOQ you are
       authoring has no client label to copy, so the dialog demanded the planner invent an
       identifier before they could begin. It stays editable and the column stays NOT NULL, so
       imports are untouched and still carry whatever the client called it. */
    var nextRev = (function () {
      var ns = (REVS || []).map(function (r) {
        var mm = String(r.rev_no || '').match(/(\d+)/);   // 'rev.05' -> 5, 'INTERNAL-01' -> 1
        return mm ? parseInt(mm[1], 10) : null;
      }).filter(function (n) { return n != null && isFinite(n); });
      var next = ns.length ? Math.max.apply(null, ns) + 1 : 0;
      return (next < 10 ? '0' : '') + next;
    })();
    /* WARNING WHICH BOQ THIS LANDS IN, said out loud, because this dialog cannot ask. It is the
       fallback for a page where wizard.js failed to load, so it stays deliberately one screen --
       but "New BOQ" over a project that already has three of them is a promise it does not keep:
       the revision goes into the BOQ currently on screen. */
    var nrDoc = (DOCS || []).filter(function (x) { return x.id === DOCID; })[0] || null;
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' +
      (nrDoc ? 'New revision of ' + esc(nrDoc.name) : 'New BOQ &mdash; build it by hand') + '</h2>' +
      '<button class="pd-modal-close" id="nr-x">&times;</button></div>' +
      '<div class="cc-form">' +
      '<p class="cc-hint" style="margin-top:0;">An empty draft. Add lines from the class-code ' +
      'library, price them, then <strong>issue</strong> it. <b>A draft never bills and never ' +
      'shows as the contract value</b>, so nothing downstream moves until you say so.</p>' +
      (nrDoc
        ? '<p class="cc-hint">This becomes a revision of <b>' + esc(nrDoc.name) + '</b>. For a ' +
          'separately named BOQ, use <b>Add BOQ\u2026</b> \u2014 this short form is the fallback for when ' +
          'the wizard could not load, and it cannot create one.</p>'
        : '') +
      '<label>Revision label<input class="pd-input" id="nr-rev" value="' + esc(nextRev) + '" /></label>' +
      '<p class="cc-hint">Prefilled, and yours to change — <b>this is your label, not the ' +
      'client\'s</b>. An imported BOQ carries whatever the client called it; one you author has ' +
      'none to copy.</p>' +
      '<label>Issued date<input class="pd-input" id="nr-date" type="date" /></label>' +
      '<label>PO no. (optional)<input class="pd-input" id="nr-po" /></label>' +
      '<label>Stated contract total (optional)<input class="pd-input" id="nr-total" type="number" step="0.01" /></label>' +
      /* ⚠️ THE STATED TOTAL IS THE RECONCILIATION GATE'S ONLY FOOTHOLD, and on an authored
         BOQ it is the one figure that does not come from the lines. Give it the contract
         value and issuing will refuse a draft whose lines do not add up to it — which is
         the single most valuable check in the importer, made available to a hand build. */
      '<p class="cc-hint">From the signed contract, if you have it — issuing then reconciles the lines ' +
      'against it to ₱1 or 0.01%.</p>' +
      '</div><div class="pd-modal-footer"><button class="pd-btn" id="nr-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="nr-go">Create draft</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('nr-x').onclick = m.close; el('nr-c').onclick = m.close;
    el('nr-go').onclick = async function () {
      var revNo = txtOf(el('nr-rev').value);
      // Prefilled above, so this fires only if it was deliberately cleared. rev_no is NOT NULL,
      // so there is nothing sensible to fall back to.
      if (!revNo) { UI.toast('The revision needs a label — it is how this BOQ is named ' +
        'everywhere else. \u201c' + nextRev + '\u201d is fine.', 'error'); return; }
      var b = el('nr-go'); b.disabled = true; b.textContent = 'Creating…';
      try {
        /* WARNING ⚠️⚠️ THIS INSERT WROTE NO `document_id`, SO EVERY REVISION IT MADE WAS AN ORPHAN.
           `2026-09-07-boq-documents.sql` made the document the owner of a revision series, and
           `createDraft` was given `document_id: f.docId || DOCID || null` for exactly that reason
           -- but this dialog kept its own copy of the insert from before the migration and never
           gained the column. An orphan is not invisible, which is what made it survive: `load()`
           filters `!r.document_id || r.document_id === DOCID`, so a null-document revision shows
           under EVERY BOQ on the project. Two BOQs would both list it, the per-document contract
           roll-up (`computeProjectTotal`, which requires `is_current && document_id`) would count
           it under neither, and nothing would error.
           WARNING Fixed by DELETING the second insert path rather than adding the column to it.
           A rival insert also lacked the duplicate-label retry that `createDraft` grew after the
           owner hit `boq_revisions_project_rev_idx` -- so this dialog would still fail outright on
           a label collision that the wizard recovers from. One writer, one set of rules. */
        var made = await createDraft({ rev: revNo, date: el('nr-date').value,
                                       po: txtOf(el('nr-po').value), total: el('nr-total').value });
        m.close();
        // createDraft already set REVID, sub and reloaded -- it is the one writer now.
        /* createDraft retries a taken label and returns the one it actually used, so this reports
           what happened rather than what was asked for. */
        var got = (made && made.rev_no) || revNo;
        UI.toast('Draft revision ' + got +
          (got !== revNo ? ' created (' + revNo + ' was already taken).' : ' created.') +
          ' Add lines from the class-code library.', 'success');
      } catch (err) {
        b.disabled = false; b.textContent = 'Create draft';
        var msg = (err.message || String(err));
        UI.toast(msg + manualHint(err).replace(/<\/?code>/g, ''), 'error');
      }
    };
  }

  // ---- The class-code tree: pick the scope, in bulk -------------------------
  /* ⚠️ A TREE WITH A CHECKBOX ON EVERY LEVEL, not a search-and-add-one picker. The chart
     is 702 items under 205 groups under 42 divisions, and a QS builds a BOQ a TRADE at a
     time — which is exactly the "per trade" the owner asked for. Ticking a division takes
     everything visible under it in one action, so a 40-line concrete package is one click
     plus a review, not forty searches. The existing `pickCode` picker stays for what it is
     good at: mapping ONE imported line. */
  /* ⚠️⚠️ THE PICKER'S MARKUP AND WIRING ARE SHARED, NOT COPIED. Owner asked for the class-code
     library to live inside the wizard as well as in its own dialog. The tempting answer is to
     paste the ladder into wizard.js; the honest one is that a second copy drifts, and this module
     has already paid for that twice today (two create-dialogs, two import doors). So the markup is
     one function and the behaviour is one mount, and both hosts call them.
     ⚠️ `root` is whatever element contains the markup — a modal here, a wizard step body there.
     Nothing below reaches for `document` or for the modal. */
  function codePickerHTML() {
    return '<div class="boq-ladwrap">' +
      '<input class="pd-input" id="cb-q" placeholder="Search code, trade, group or item…" autocomplete="off" />' +
      '<div class="boq-lad" id="cb-tree"></div>' +
      '<div class="boq-tpicked" id="cb-count"></div></div>';
  }

  /* Mount the ladder into `root`. Returns the live selection so a host can read it when its own
     button is pressed — the picker never decides what happens next. */
  async function mountCodePicker(root, opts) {
    opts = opts || {};
    await ensureCodes();
    if (!(CODES || []).length) {
      UI.toast(codesErr
        ? 'Could not read the class-code chart: ' + (codesErr.message || codesErr)
        : 'The class-code chart is empty — run migrations/2026-08-21-class-codes.sql, then reload this page.',
        'error');
      return null;
    }
    return _mountPicker(root, opts);
  }

  /* The ladder itself: state, filtering, painting and wiring. Hosted by openCodeBuilder in a
     modal and by the wizard in a step body — see codePickerHTML(). Returns the live selection so
     the HOST decides what happens next; the picker never writes anything itself. */
  function _mountPicker(root, opts) {
    var el = function (id) { return root.querySelector('#' + id); };
    buildTree();
    /* ⚠️ `open` is gone with the tree — a ladder has no collapsed state, it has a position. */
    var picked = {}, q = '', curTrade = null, curDiv = null, curGroup = null;

    /* ⚠️ The one place a planner decides the shape of the bill, so it is the one place worth
       saying what ticking a division actually does. Without this the trade split is a surprise
       discovered later, if at all. */
    /* ⚠️⚠️ A LADDER, NOT A TREE. Owner, 2026-09-07: *"the class code library should map out the
       trades first (Description 1). I think its better to present this as a ladder selection
       rather than presenting it this way. Right now it will be very tedious for the planner to add
       class codes selecting manually which to add."* He is right, and the numbers say why: one
       column holding 42 divisions, 205 groups and 702 items means the planner scrolls a 949-row
       accordion to find one trade. A BOQ is built A TRADE AT A TIME, so the trade is the first
       question, not something to hunt for.
       ⚠️ Three panes, Finder-style: Trade → Group → Item, each filtering the next. Ticking is
       still available at EVERY level — a whole trade in one click stays the fast path — but
       drilling in no longer costs an expanding accordion that pushes everything else off screen.
       ⚠️ The header follows the standard modal shape (title + one-line subtitle) rather than a
       paragraph of theory; what "division → sheet" means belongs in the result, not in the way. */

    /* Which items survive the search. ⚠️ A division or group matches on its OWN text too,
       and then keeps all of its items — searching "concrete" must not hide the items of a
       group called Concrete Works merely because the word is not repeated in each one. */
    /* ⚠️ A hit on ANY ancestor keeps everything beneath it — searching "concrete" must not hide
       the items of a division called Concrete Works merely because the word is not repeated in
       each one. Checked trade-first so the broadest match wins earliest. */
    function itemsOf(g, d, t) {
      if (!q) return g.items;
      var k = normKey(q);
      if (normKey(t.desc).indexOf(k) >= 0) return g.items;
      if ((d.code + ' ' + normKey(d.desc)).indexOf(k) >= 0) return g.items;
      if ((g.code + ' ' + normKey(g.desc)).indexOf(k) >= 0) return g.items;
      return g.items.filter(function (c) { return (c.code + ' ' + normKey(c.desc_l3)).indexOf(k) >= 0; });
    }
    function visible() {
      return buildTree().map(function (t) {
        var ds = t.order.map(function (d) {
          var gs = d.order.map(function (g) { return { g: g, items: itemsOf(g, d, t) }; })
                          .filter(function (x) { return x.items.length; });
          return { d: d, gs: gs };
        }).filter(function (x) { return x.gs.length; });
        return { t: t, ds: ds };
      }).filter(function (x) { return x.ds.length; });
    }
    /* Every item under a node, at whatever depth — one helper so the three parent rungs count and
       tick identically instead of each re-deriving the walk. */
    function itemsUnderTrade(x) {
      return x.ds.reduce(function (a, y) {
        return a.concat(y.gs.reduce(function (b, z) { return b.concat(z.items); }, []));
      }, []);
    }
    function itemsUnderDiv(y) {
      return y.gs.reduce(function (b, z) { return b.concat(z.items); }, []);
    }
    function nPicked() { return Object.keys(picked).length; }

    /* One row, used at all three rungs so they stay typographically identical. */
    function ladRow(kind, code, name, on, total, active) {
      /* ⚠️⚠️ A LEAF HAS NO CHILDREN, SO `total` IS 0 AND THE PARENT TEST CANNOT BE REUSED. The
         checked test was `total && on === total`, which short-circuits to falsy for every item
         row — so ticking a trade selected all 127 codes (the footer said so) while every Item
         checkbox rendered UNCHECKED. Owner: *"I checked the General Requirement in the trade
         column and the Item did not check? Is this intentional?"* No: the state was right and the
         control was lying about it, which is worse than either being wrong on its own. */
      var leaf = !total;
      var isOn = leaf ? !!on : (total > 0 && on === total);
      var part = !leaf && on > 0 && on < total;
      return '<div class="boq-lad-row' + (active ? ' on' : '') + '" data-rung="' + kind + '" data-key="' + esc(code) + '">' +
        '<input type="checkbox" data-' + (kind === 'trade' ? 't' : kind === 'div' ? 'd' : kind === 'group' ? 'g' : 'c') + '="' + esc(code) + '"' +
          (isOn ? ' checked' : '') + (part ? ' data-part="1"' : '') + ' />' +
        /* A trade is its own label, so the code chip is suppressed rather than printing the
           same words twice; groups and items keep theirs, which is what makes them scannable. */
        (code && code !== name ? '<span class="boq-lad-code">' + esc(code) + '</span>' : '') +
        '<span class="boq-lad-name">' + esc(name) + '</span>' +
        (total ? '<span class="boq-lad-n">' + (on ? on + '/' : '') + total + '</span>' : '') +
        '</div>';
    }

    function paint() {
      var vis = visible();
      if (!vis.length) {
        el('cb-tree').innerHTML = '<p class="cc-mut" style="padding:24px;text-align:center;">No codes match that search.</p>';
      } else {
        /* ⚠️ The position is RE-VALIDATED against the filtered set every paint. Typing a search
           that excludes the trade you were standing on must move you somewhere real, not leave
           two empty panes beside a list that no longer contains your selection. */
        /* ⚠️ Each position is re-validated against the filtered set, TRADE FIRST then division
           then group, because a search that excludes your trade also invalidates everything
           below it. Resolving them independently would leave a division from one trade showing
           beside the groups of another. */
        var tsel = vis.filter(function (x) { return x.t.code === curTrade; })[0] || vis[0];
        curTrade = tsel.t.code;
        var dsel = tsel.ds.filter(function (y) { return y.d.code === curDiv; })[0] || tsel.ds[0];
        curDiv = dsel ? dsel.d.code : null;
        var gsel = dsel ? (dsel.gs.filter(function (z) { return z.g.code === curGroup; })[0] || dsel.gs[0]) : null;
        curGroup = gsel ? gsel.g.code : null;

        var tradesHTML = vis.map(function (x) {
          var all = itemsUnderTrade(x);
          var on = all.filter(function (c) { return picked[c.code]; }).length;
          return ladRow('trade', x.t.code, x.t.desc, on, all.length, x.t.code === curTrade);
        }).join('');

        var divsHTML = tsel.ds.map(function (y) {
          var all = itemsUnderDiv(y);
          var on = all.filter(function (c) { return picked[c.code]; }).length;
          return ladRow('div', y.d.code, y.d.desc, on, all.length, y.d.code === curDiv);
        }).join('');

        var groupsHTML = dsel ? dsel.gs.map(function (z) {
          var on = z.items.filter(function (c) { return picked[c.code]; }).length;
          return ladRow('group', z.g.code, z.g.desc, on, z.items.length, z.g.code === curGroup);
        }).join('') : '';

        var itemsHTML = gsel ? gsel.items.map(function (c) {
          return ladRow('item', c.code, c.desc_l3, picked[c.code] ? 1 : 0, 0, false);
        }).join('') : '';

        function col(label, n, inner) {
          return '<div class="boq-lad-col"><div class="boq-lad-h">' + label + '<span>' + n + '</span></div>' +
            '<div class="boq-lad-body">' + inner + '</div></div>';
        }
        el('cb-tree').innerHTML =
          col('Trade', vis.length, tradesHTML) +
          col('Division', tsel.ds.length, divsHTML) +
          col('Group', dsel ? dsel.gs.length : 0, groupsHTML) +
          col('Item', gsel ? gsel.items.length : 0, itemsHTML);
      }

      var divs = {};
      Object.keys(picked).forEach(function (k) {
        var c = codeRow(k); if (c) divs[(c.trade && String(c.trade).trim()) || c.desc_l1] = 1;
      });
      el('cb-count').innerHTML = nPicked()
        ? '<b>' + nPicked() + '</b> item' + (nPicked() === 1 ? '' : 's') + ' · ' +
          Object.keys(divs).length + ' trade' + (Object.keys(divs).length === 1 ? '' : 's')
        : '<span class="cc-mut">Nothing selected yet.</span>';
      /* ⚠️⚠️ THE PICKER DOES NOT TOUCH THE HOST'S BUTTON. This read `el('cb-go').disabled = …`,
         which is the MODAL's Add-lines button — and in the wizard there is no `#cb-go`, so it threw
         a TypeError that aborted paint() before `wireTree()` ran. The panes rendered, and not one
         checkbox had a handler: a picker that looks completely normal and silently does nothing.
         The host is told the count through `opts.onCount` and labels its own control; that is the
         whole point of the split, and this line was the last thing still crossing it. */
      wireTree();
    }

    function setAll(list, on) { list.forEach(function (c) { if (on) picked[c.code] = 1; else delete picked[c.code]; }); }
    function wireTree() {
      var tree = el('cb-tree');
      /* ⚠️ Clicking the ROW moves the ladder; clicking its CHECKBOX picks. Without the guard the
         checkbox click bubbles to the row and does both, so ticking a trade would also jump you
         into it — which is precisely the kind of "it did something I did not ask for" that makes
         a picker feel unsafe on 702 rows. */
      tree.querySelectorAll('.boq-lad-row').forEach(function (row) {
        row.onclick = function (e) {
          if (e.target && e.target.tagName === 'INPUT') return;
          var rung = row.dataset.rung;
          /* Moving up a rung clears everything below it — standing on a division that belongs to
             a different trade is the bug this prevents. */
          if (rung === 'trade') { curTrade = row.dataset.key; curDiv = null; curGroup = null; paint(); }
          else if (rung === 'div') { curDiv = row.dataset.key; curGroup = null; paint(); }
          else if (rung === 'group') { curGroup = row.dataset.key; paint(); }
        };
      });
      tree.querySelectorAll('[data-c]').forEach(function (cb) {
        cb.onchange = function () { if (cb.checked) picked[cb.dataset.c] = 1; else delete picked[cb.dataset.c]; paint(); };
      });
      tree.querySelectorAll('[data-g]').forEach(function (cb) {
        cb.onchange = function () {
          visible().forEach(function (x) {
            x.ds.forEach(function (y) {
              y.gs.forEach(function (z) { if (z.g.code === cb.dataset.g) setAll(z.items, cb.checked); });
            });
          });
          paint();
        };
      });
      /* ⚠️ A division is only ticked WITHIN THE TRADE ON SCREEN. Division codes are not unique
         across trades once "Others" exists, so matching on the code alone would tick a division
         the planner is not looking at. */
      tree.querySelectorAll('[data-d]').forEach(function (cb) {
        cb.onchange = function () {
          visible().forEach(function (x) {
            if (x.t.code !== curTrade) return;
            x.ds.forEach(function (y) {
              if (y.d.code !== cb.dataset.d) return;
              setAll(itemsUnderDiv(y), cb.checked);
            });
          });
          paint();
        };
      });
      tree.querySelectorAll('[data-t]').forEach(function (cb) {
        cb.onchange = function () {
          visible().forEach(function (x) {
            if (x.t.code !== cb.dataset.t) return;
            setAll(itemsUnderTrade(x), cb.checked);
          });
          paint();
        };
      });
      // A partially-selected division reads as indeterminate rather than as "off": a bare
      // unticked box over "12 / 40" says the opposite of what is true.
      tree.querySelectorAll('[data-part]').forEach(function (cb) { cb.indeterminate = true; });
    }

    var t = null;
    el('cb-q').addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(function () { q = el('cb-q').value; paint(); }, 160);
    });
    var _t = null;
    var qi = el('cb-q');
    if (qi) qi.addEventListener('input', function () {
      clearTimeout(_t); _t = setTimeout(function () { q = qi.value; paint(); }, 160);
    });
    /* The host is told the count on every change so it can label its own button — "Add 40 lines"
       is a different promise from "Add lines", and only the host knows where to put it. */
    if (opts.onCount) { var _p = paint; paint = function () { _p(); opts.onCount(nPicked()); }; }
    paint();
    return {
      codes: function () { return Object.keys(picked); },
      count: function () { return nPicked(); },
      repaint: function () { paint(); }
    };
  }

  async function openCodeBuilder() {
    if (!isDraft()) { UI.toast('Lines can only be added to a draft revision.', 'error'); return; }
    var m = UI.modal(mHead('Add lines',
        'Pick a trade, then take the whole trade or drill into its groups', 'cb-x') +
      codePickerHTML() +
      '<div class="pd-modal-footer"><button class="pd-btn" id="cb-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="cb-go">Add lines</button></div>');
    // Four panes side by side need the wide shell, not the 760px one.
    m.el.querySelector('.pd-modal').classList.add('boq-wide');
    m.el.querySelector('#cb-x').onclick = m.close;
    m.el.querySelector('#cb-c').onclick = m.close;
    var go = m.el.querySelector('#cb-go');
    var p = await mountCodePicker(m.el, {
      onCount: function (n) { go.disabled = !n; go.textContent = n ? 'Add ' + n + ' lines' : 'Add lines'; }
    });
    if (!p) { m.close(); return; }
    go.onclick = function () { m.close(); addAuthoredLines(p.codes()); };
  }

  /* Write the picked codes in as lines.
     ⚠️ DIVISION → SHEET, GROUP → HEADING, ITEM → LEAF. This is not an arbitrary mapping,
        it is the shape the importer spends 300 lines trying to recover from a spreadsheet:
        `sheetTotals` and every WT % are computed PER SHEET, so making the division the
        sheet puts the trade-share weighting on the right axis for free. A single flat
        sheet would make one project-wide WT % denominator and quietly break the billing
        arithmetic the module already verified against the real sheets.
     ⚠️ HEADINGS CARRY NO AMOUNT. An imported heading holds the client's own printed
        subtotal (which is evidence, and reconciled against). An authored one would be
        holding OUR sum of its own children — a second source of truth that goes stale the
        first time a child's quantity changes. `moneyLine()` excludes headings from every
        roll-up anyway, so the subtotal is derived where it is displayed.
     ⚠️ A GROUP ALREADY PRESENT IS REUSED, never duplicated. Adding "more concrete items"
        to a division must extend the existing heading, or the sheet ends up with two
        identical headings and the tree reads as two unrelated groups. */
  // ==========================================================================
  // HAND-OFF 2 — THE DETAILED SCHEDULE SEEDS THE DETAILED BOQ
  // ==========================================================================
  /* Owner's process, 2026-09-08: *"high level BOQ will be the basis -> detailed schedule will be
     developed -> detailed BOQ will be based on the detailed schedule."* The third step had no
     bridge. `addAuthoredLines` reads the class-code LIBRARY — 702 codes for the whole business —
     so a planner whose schedule was already tagged had to find those same codes again in a ladder,
     and then match every resulting line back to the activities it came from on another tab.

     This reads the direction the process actually runs: the activities that already carry a class
     code become the bill, and the lines arrive with their allocations already written, so the
     Match-to-schedule worklist starts EMPTY instead of at 122.

     ⚠️⚠️ ONE LINE PER CLASS CODE, ALLOCATED ACROSS ITS ACTIVITIES — not one line per activity.
     The tempting reading of "detailed" is a line per place (Rebar 3F, Rebar 4F, …), and this
     module already has the machinery for the other shape: `boq_allocations` carries the per-place
     split, `boq_activity_quantity` derives each activity's quantity from it, and Cost Loading's new
     step-2 reader splits a LINE's amount over its allocations. A line per activity would give forty
     lines each needing their own rate for one item, and — the part that matters — it would make the
     bill's line count a function of the programme's zone breakdown, so re-zoning the schedule would
     silently change the shape of the tendered bill. The allocation is where the detail belongs.

     ⚠️ NOTHING IS WRITTEN BY PROPOSING. Propose -> preview -> apply, the module's standing rule:
     every code is listed with how many activities carry it and whether it is already on the bill,
     and the planner unticks what they do not want. */
  function scheduleSeedPlan(acts, items, cmap, codeOf) {
    var by = {}, order = [];
    (acts || []).forEach(function (a) {
      var code = String((a && a.class_code) || '').trim();
      if (!code) return;
      var e = by[code];
      if (!e) { e = by[code] = { code: code, acts: [], onBill: false, chart: null }; order.push(e); }
      /* ⚠️ DEDUPED ON activity_id, never on the row uuid. An import reinserts every row, so the
         uuid changes and the activity_id does not — the rule `schedule-document-links` records and
         the one `boq_allocations.activity_id` is typed `text` for. */
      if (a.activity_id && e.acts.indexOf(a.activity_id) < 0) e.acts.push(a.activity_id);
    });
    /* Already on the bill = some line on this revision is MAPPED to that code. Checked through the
       class map rather than by matching item_no, because an imported line's item_no is the client's
       own numbering and has nothing to do with the code it was mapped to. */
    var mapped = {};
    Object.keys(cmap || {}).forEach(function (itemId) {
      var c = cmap[itemId]; if (c && c.class_code) mapped[String(c.class_code).trim()] = 1;
    });
    order.forEach(function (e) {
      e.onBill = !!mapped[e.code];
      e.chart = codeOf ? codeOf(e.code) : null;
    });
    /* Chart order where the chart knows the code, then the unknown ones, so the preview reads in
       Finance's own sequence like every other list in this module. */
    order.sort(function (x, y) {
      var a = x.chart ? (x.chart.sort_order == null ? 1e9 : x.chart.sort_order) : 2e9;
      var b = y.chart ? (y.chart.sort_order == null ? 1e9 : y.chart.sort_order) : 2e9;
      return a - b || String(x.code).localeCompare(String(y.code));
    });
    return order;
  }

  async function openSeedFromSchedule() {
    if (!canWrite) { UI.toast('You do not have permission to add lines.', 'error'); return; }
    if (!isDraft()) { UI.toast('Only a draft can take new lines. An issued revision is superseded, never edited.', 'error'); return; }
    await ensureCodes();
    await ensureActs();
    var plan = scheduleSeedPlan(ACTS, ITEMS, CMAP, codeRow);
    var takeable = plan.filter(function (e) { return !e.onBill; });

    if (!plan.length) {
      /* ⚠️ THE TWO EMPTY CASES ARE DIFFERENT QUESTIONS and get different answers. No schedule at
         all is "import or build one"; a schedule nobody has tagged is "tag it", and the control
         that does that is one tab away. Collapsing them into "nothing to add" sends the planner
         hunting on the wrong screen. */
      var nAct = (ACTS || []).length;
      var em = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Nothing to seed from yet</h2>' +
        '<button class="pd-modal-close" id="ss-x">&times;</button></div><div class="cc-form">' +
        (nAct
          ? '<p class="cc-hint" style="margin-top:0;">This project has <b>' + nAct + '</b> activit' +
            (nAct === 1 ? 'y' : 'ies') + ', and <b>not one of them carries a class code</b>. The bill ' +
            'is built from those codes, so there is nothing to read yet.</p>' +
            '<p class="cc-hint">Tag the programme first — <b>Match to schedule</b> on this BOQ proposes ' +
            'activities for each code you already have, or set the Class Code column in the Project ' +
            'Schedule. The Schedule Setup can also load its activities <b>from this BOQ</b>, which ' +
            'tags them as it goes.</p>'
          : '<p class="cc-hint" style="margin-top:0;">This project has <b>no schedule activities</b> ' +
            'yet. Build or import one in the Project Schedule, tag it with class codes, then come ' +
            'back — a detailed bill is read off a detailed programme.</p>') +
        '</div><div class="pd-modal-footer"><button class="pd-btn" id="ss-c">Close</button></div>');
      em.el.querySelectorAll('#ss-x,#ss-c').forEach(function (b) { b.onclick = em.close; });
      return;
    }

    var picked = {};
    takeable.forEach(function (e) { picked[e.code] = 1; });

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Add lines from the schedule</h2>' +
      '<p class="pd-modal-sub">One line per class code, already matched to the activities that carry it</p>' +
      '<button class="pd-modal-close" id="ss-x">&times;</button></div>' +
      '<div class="cc-form" id="ss-body"></div>' +
      '<div class="pd-modal-footer"><span class="cc-mini" id="ss-cnt"></span> ' +
      '<button class="pd-btn" id="ss-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ss-go">Add lines</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('ss-x').onclick = m.close; el('ss-c').onclick = m.close;

    function nPicked() { return Object.keys(picked).length; }
    function nActs() {
      return plan.reduce(function (t, e) { return t + (picked[e.code] ? e.acts.length : 0); }, 0);
    }
    function paint() {
      var onBill = plan.length - takeable.length;
      var h = '<p class="cc-hint" style="margin-top:0;">' +
        '<b>' + plan.length + '</b> class code' + (plan.length === 1 ? '' : 's') + ' on this programme, ' +
        'carried by <b>' + plan.reduce(function (t, e) { return t + e.acts.length; }, 0) + '</b> activities' +
        (onBill ? '. <b>' + onBill + '</b> already on this bill and unticked' : '') + '.</p>' +
        /* ⚠️ Says what the quantity will be, because "matched" and "measured" are different states
           and a bill of zero-quantity lines is alarming if you do not know it is deliberate. */
        '<p class="cc-hint">Each line is created <b>measured with no quantity</b> and linked to its ' +
        'activities at <b>quantity 0</b> — matched, not yet measured. Nothing rolls up until you ' +
        'enter the figures; then <b>Match to schedule</b> spreads each quantity over the links that ' +
        'are already there.</p>' +
        '<table class="boq-splittab"><thead><tr><th style="width:28px;"></th><th>Class code</th>' +
        '<th>Description</th><th class="cc-r">Activities</th><th>Trade</th></tr></thead><tbody>';
      plan.forEach(function (e) {
        var c = e.chart;
        h += '<tr' + (e.onBill ? ' class="cc-mut"' : '') + '>' +
          '<td><input type="checkbox" data-ss="' + esc(e.code) + '"' + (picked[e.code] ? ' checked' : '') + ' /></td>' +
          '<td><code>' + esc(e.code) + '</code>' + (e.onBill ? '<div class="cc-mini">already on this bill</div>' : '') + '</td>' +
          '<td>' + esc(c ? c.desc_l3 : '') +
            (c ? '<div class="cc-mini">' + esc(c.desc_l2 || '') + '</div>'
               /* ⚠️ A code the chart does not list is SHOWN, not dropped. It is on the programme, it
                  is what a planner tagged, and hiding it would make the bill quietly narrower than
                  the schedule with nothing saying so. It lands on its own sheet below. */
               : '<div class="cc-mini boq-bad">not in the class-code chart — it will be filed under Others</div>') + '</td>' +
          '<td class="cc-r">' + e.acts.length + '</td>' +
          '<td>' + esc(c ? ((c.trade && String(c.trade).trim()) || c.desc_l1 || '') : 'Others') + '</td>' +
          '</tr>';
      });
      h += '</tbody></table>';
      el('ss-body').innerHTML = h;
      el('ss-cnt').textContent = nPicked() + ' code(s) · ' + nActs() + ' link(s)';
      el('ss-go').disabled = !nPicked();
      el('ss-body').querySelectorAll('[data-ss]').forEach(function (cb) {
        cb.onchange = function () {
          if (cb.checked) picked[cb.dataset.ss] = 1; else delete picked[cb.dataset.ss];
          el('ss-cnt').textContent = nPicked() + ' code(s) · ' + nActs() + ' link(s)';
          el('ss-go').disabled = !nPicked();
        };
      });
    }
    paint();

    el('ss-go').onclick = async function () {
      var codes = plan.filter(function (e) { return picked[e.code]; });
      if (!codes.length) return;
      /* ⚠️ Only codes the CHART knows can become a line, because addAuthoredLines files a line by
         its chart row (trade -> sheet, group -> heading, desc_l3 -> description) and has nothing to
         file an unknown code under. Reported rather than silently skipped — the count is the
         planner's next job, on the chart or on the activity. */
      var known = codes.filter(function (e) { return !!e.chart; });
      var unknown = codes.length - known.length;
      if (!known.length) {
        UI.toast('None of the ticked codes are in the class-code chart, so no line can be filed. ' +
          'Fix the code on those activities, or add the codes to the chart.', 'error');
        return;
      }
      var alloc = {};
      known.forEach(function (e) { alloc[e.code] = e.acts; });
      m.close();
      await addAuthoredLines(known.map(function (e) { return e.code; }), alloc);
      if (unknown) {
        UI.toast(unknown + ' ticked code(s) are not in the class-code chart and were skipped — ' +
          'nothing can be filed under a code the chart does not list.', 'warn');
      }
    };
  }

  /* `alloc` (optional) maps a class code to the activity_ids that carry it, and turns this from
     "add lines" into "add lines that are already matched to the programme" — hand-off 2. See
     seedFromSchedule below for why that is the whole point of the feature. */
  async function addAuthoredLines(codes, alloc) {
    if (!canWrite || !isDraft() || !codes.length) return;
    var m = UI.modal('<h2 style="margin-top:0;">Adding lines…</h2><p id="ad-say"><span class="cc-spin"></span>Preparing…</p>');
    var say = function (s) { var e = m.el.querySelector('#ad-say'); if (e) e.innerHTML = '<span class="cc-spin"></span>' + esc(s); };
    try {
      // Group the picks by division (sheet) then by group (heading).
      var sheets = {};
      codes.forEach(function (code) {
        var c = codeRow(code); if (!c) return;
        /* WARNING SHEET = TRADE, not division. This is what makes a hand-built BOQ's sections the
           same seven names the schedule uses, so 'Structural Works' means one thing in both.
           It was desc_l1, which produced up to 42 sections per bill and none of them a trade. */
        var tkey = (c.trade && String(c.trade).trim()) || c.desc_l1;
        var sh = (sheets[tkey] = sheets[tkey] || { div: c.code_l1, groups: {}, order: [] });
        var g = sh.groups[c.code_l2];
        if (!g) { g = sh.groups[c.code_l2] = { code: c.code_l2, desc: c.desc_l2, items: [] }; sh.order.push(g); }
        g.items.push(c);
      });

      var newLines = [], leafKeys = [];
      Object.keys(sheets).forEach(function (shName) {
        var sh = sheets[shName], row = nextRow(shName), order = ITEMS.filter(function (r) { return r.sheet === shName; }).length;
        sh.order.forEach(function (g) {
          /* ⚠️ THE LEAVES ARE DECIDED FIRST, AND THE HEADING ONLY IF ANY SURVIVE. The first
             cut emitted the heading and then filtered the items, so re-adding a division
             whose items were already present wrote a heading with NOTHING UNDER IT. Measured
             in the render harness: re-picking all of Concrete Works, with 03101/03102/03201
             already on the revision, wrote heading 03200 as an orphan — a group row that
             reads as an empty trade on the items table and in every export. */
          var todo = g.items.filter(function (c) {
            // A code already on this sheet is not added twice.
            return !ITEMS.some(function (r) { return r.sheet === shName && String(r.item_no) === String(c.code); });
          });
          if (!todo.length) return;

          // Reuse an existing heading for this group if the sheet already has one.
          var existing = ITEMS.find(function (r) {
            return r.sheet === shName && r.line_kind === 'heading' && String(r.item_no) === String(g.code);
          });
          var headKey = null;
          if (existing) headKey = shName + '#' + existing.source_row;
          else {
            headKey = shName + '#' + row;
            newLines.push({
              project_id: pid, revision_id: REVID, sheet: shName, source_row: row++,
              item_no: g.code, description: g.desc, unit: null, qty: null,
              mat_rate: null, mat_amount: null, lab_rate: null, lab_amount: null,
              amount: null, derived_amount: false, exclusion_note: null,
              line_kind: 'heading', total_marker: null, depth: 0,
              sort_order: order++, origin: 'manual', created_by: UID, _k: headKey, _pk: null
            });
          }
          todo.forEach(function (c) {
            var key = shName + '#' + row;
            newLines.push({
              project_id: pid, revision_id: REVID, sheet: shName, source_row: row++,
              item_no: c.code, description: c.desc_l3, unit: null, qty: null,
              mat_rate: null, mat_amount: null, lab_rate: null, lab_amount: null,
              amount: null, derived_amount: false, exclusion_note: null,
              /* ⚠️ 'measured' with a NULL quantity, deliberately. The line kind is a
                 statement about whether the work is measurable, and a concrete item is —
                 the quantity is simply not typed yet. Defaulting to 'lump_sum' to "match
                 the empty qty" would put every authored line outside the quantity
                 roll-up, i.e. outside the activity-quantity view this whole chain exists
                 to feed. The kind is editable per row for the lines that really are lump
                 sum or provisional. */
              line_kind: 'measured', total_marker: null, depth: 1,
              sort_order: order++, origin: 'manual', created_by: UID, _k: key, _pk: headKey
            });
            leafKeys.push({ key: key, code: c.code });
          });
        });
      });

      if (!newLines.length) { m.close(); UI.toast('Every code you picked is already on this revision.', 'warn'); return; }

      var inserted = [];
      for (var i = 0; i < newLines.length; i += 300) {
        say('Writing lines ' + (i + 1) + '–' + Math.min(i + 300, newLines.length) + ' of ' + newLines.length + '…');
        var chunk = newLines.slice(i, i + 300).map(function (p) {
          var c2 = Object.assign({}, p); delete c2._k; delete c2._pk; return c2;
        });
        var res = await sb().from(T_ITEM).insert(chunk).select('id,sheet,source_row');
        if (res.error) throw res.error;
        inserted = inserted.concat(res.data);
      }

      // Parent links, keyed on (sheet, source_row) — the real identity, never item_no.
      var byRow = {};
      inserted.forEach(function (r) { byRow[r.sheet + '#' + r.source_row] = r.id; });
      var links = newLines.filter(function (p) { return p._pk && byRow[p._k] && byRow[p._pk]; });
      say('Linking ' + links.length + ' line(s) to their headings…');
      for (var j = 0; j < links.length; j++) {
        var up = await sb().from(T_ITEM).update({ parent_id: byRow[links[j]._pk] }).eq('id', byRow[links[j]._k]);
        if (up.error) throw up.error;
      }

      /* The class map, `source='authored'`.
         ⚠️ HEADINGS ARE NOT MAPPED. `mappable()` excludes them, and a heading carrying a
            group code as a *mapping* would be counted in the mapped total and then
            allocated across activities — a group is not a scope item. */
      var maps = leafKeys.filter(function (x) { return byRow[x.key]; }).map(function (x) {
        return { project_id: pid, revision_id: REVID, boq_item_id: byRow[x.key],
                 class_code: x.code, source: 'authored', confidence: 1, created_by: UID };
      });
      for (var k2 = 0; k2 < maps.length; k2 += 300) {
        say('Recording class codes ' + (k2 + 1) + ' of ' + maps.length + '…');
        var mr = await sb().from(T_MAP).upsert(maps.slice(k2, k2 + 300), { onConflict: 'boq_item_id' });
        if (mr.error) throw mr.error;
      }

      /* ==========================================================================
         HAND-OFF 2 — THE LINES ARE BORN MATCHED
         ==========================================================================
         ⚠️⚠️ ONE ALLOCATION PER (LINE, ACTIVITY), AT qty 0. `qty = 0` is not a missing figure: the
         2026-09-07h change established it as *matched, not yet quantified*, the column is
         `numeric not null default 0`, and every reader SUMS qty — so a link contributes nothing to
         any derived quantity until the measure arrives. That is exactly the state a BOQ seeded
         from the programme should be in: the scope decision is made, the measurement is not.
         ⚠️ `method` is 'manual' because the constraint allows only location/prorata/manual and
         NEITHER of the other two happened here. Calling it 'prorata' would claim an arithmetic
         that was never performed — the same reason proposeSplit leaves method null at qty 0.
         ⚠️ UPSERT on the pair index (`boq_allocations_pair_idx` is unique on
         (boq_item_id, activity_id)), so a re-run cannot double-link. */
      var allocRows = [];
      if (alloc) {
        leafKeys.forEach(function (x) {
          var id = byRow[x.key]; if (!id) return;
          (alloc[x.code] || []).forEach(function (actId) {
            if (!actId) return;
            allocRows.push({ project_id: pid, boq_item_id: id, activity_id: String(actId),
                             qty: 0, method: 'manual', accepted_by: UID });
          });
        });
        for (var a2 = 0; a2 < allocRows.length; a2 += 300) {
          say('Matching to the programme ' + (a2 + 1) + ' of ' + allocRows.length + '…');
          var ar = await sb().from(T_ALLOC).upsert(allocRows.slice(a2, a2 + 300),
                                                   { onConflict: 'boq_item_id,activity_id' });
          if (ar.error) throw ar.error;
        }
      }

      m.close();
      /* ⚠️ Counts the sheets actually WRITTEN TO, not the sheets picked. Re-picking a
         division whose items are all present touches none of them, and "across 1 sheet"
         over zero new lines on that sheet is a claim the table would contradict. */
      var touched = {};
      newLines.forEach(function (l) { touched[l.sheet] = 1; });
      UI.toast('Added ' + leafKeys.length + ' line(s) across ' + Object.keys(touched).length + ' sheet(s)' +
        (allocRows.length ? ', matched to ' + allocRows.length + ' activit' + (allocRows.length === 1 ? 'y' : 'ies') +
          '. Now measure and price them.' : '. Now price them.'), 'success');
      await load();
    } catch (err) {
      var msg = (err.message || String(err));
      m.el.innerHTML = '<h2 style="margin-top:0;">Could not add the lines</h2>' +
        '<div class="boq-alert bad">' + esc(msg) + '<p class="cc-mut">' + manualHint(err) + migrationHint(err) + '</p></div>' +
        '<div style="text-align:right;margin-top:12px;"><button class="pd-btn" id="ad-x">Close</button></div>';
      /* ⚠️ Closing RELOADS. A failure part-way through leaves some lines written, and the
         planner must see which — a stale screen showing none of them invites a second run
         that duplicates the ones that did land. */
      var b = m.el.querySelector('#ad-x'); if (b) b.onclick = function () { m.close(); load(); };
    }
  }

  // ---- Editing a draft line -------------------------------------------------
  /* ⚠️ THE DERIVATION RULE, AND WHY IT IS NOT THE IMPORTER'S RULE.
     For an IMPORTED line, `qty × displayed rate` is wrong — measured at ₱8.60 out on a
     two-line sheet, because the client's printed rate is a rounded display of a figure we
     never see. So the amount is taken as given and never recomputed.
     For a line WE author, the rate is the exact input and the amount is its product. So it
     IS computed — and flagged `derived_amount = true`, which is precisely what that column
     was added for: telling our figures from the client's in a later reconciliation.
     ⚠️ AN AMOUNT TYPED BY HAND WINS AND STOPS THE DERIVATION (`derived_amount = false`),
        because a lump-sum line has an amount and no rate at all. Clearing it hands the
        line back to the rates. */

  /* ==========================================================================
     THE COLUMN SPEC — width, type and read-only are DATA, not markup
     ==========================================================================
     Owner, 2026-09-07: *"some of the columns here should be computed automatically not manually
     inputted i.e. qty mat rate lab rate amount"*, *"the unit should be a dropdown list of unit of
     measurements and let's call it UoM rather than Unit"*, *"the column width is not proportional
     to the content"*, and *"the grid does not follow the Procurement Dashboard's review.html grid
     completely"*.

     ⚠️⚠️ ALL FOUR ARE THE SAME MISSING THING: review.html drives its grid from `XL_COLS`, a list
     of `{k, label, w, type, ro}`. This table was hand-written `<td>`s, so a width could only be
     guessed in CSS, a type could not be declared at all, and "computed" had nowhere to live. With
     a spec, `w` gives a real <colgroup> (proportional widths), `type` picks the editor, and `calc`
     marks a column as derived.

     ⚠️ THE ARITHMETIC WAS ALREADY THERE AND INVISIBLE. `recalc()` has always computed
     mat_amount = qty x mat_rate, lab_amount = qty x lab_rate, amount = the two summed, and
     saveCell() has always called it. What the screen showed was three EDITABLE money columns
     (Mat. rate, Lab. rate, Amount) and neither computed column — so it read as "type everything".
     Nothing about the maths changes here; the derived figures simply become visible and read-only.

     ⚠️ THE COLUMN SET IS OPW101's OWN BOQ HEADER, read out of
     "One Portwood Package 2 BOQ ... rev.05", sheet Architectural, rows 12-13:
         ITEM NO. | ITEM DESCRIPTION | UNIT | QUANTITY | UNIT COST(MATERIAL) |
         MATERIAL COST | LABOR + CONS | LABOR COST | TOTAL AMOUNT
     so Material cost and Labor cost are columns the planner reads, not fields they fill. */

  /* ⚠️ DERIVED FROM THE OWNER'S OWN BILLS, not invented: the units on every OPW101 line that
     carries a numeric quantity are m2 (623), lm (112), set (76), lot (42), sets (15), mos (12),
     ea (7), unit (4), pc (3), kg (2). `sets` and `l.m` are variants of `set` and `lm` and are not
     offered again. The rest are standard construction units the bills simply had no line for yet.
     ⚠️ AN OFF-LIST VALUE IS NEVER LOST — see uomCell(). An imported bill carries units this list
     has never heard of, and a <select> that silently drops one would erase a tendered figure's
     unit on the next save. */
  var UOM = ['lot', 'set', 'pc', 'ea', 'unit', 'm', 'lm', 'm2', 'm3', 'kg', 'tonne',
             'L', 'bag', 'roll', 'sheet', 'mos', 'day', 'hr'];

  function money2(v) { return v == null ? '' : Fmt.money(v); }

  /* ⚠️⚠️ ONE HEADER SHAPE FOR EVERY DIALOG IN THIS MODULE. Owner: *"let's make all pop-up
     windows consistent"*. There were ELEVEN headers and one of them had a subtitle — the rest
     opened with a bare title and then explained themselves in a paragraph sitting on top of
     the controls, which is what made the module read as assembled rather than designed.
     ⚠️ A helper rather than a convention, because a convention is what produced eleven
     variants. `sub` is one line: what this dialog is for, not how it works. */
  function mHead(title, sub, closeId) {
    return '<div class="pd-modal-header"><div><h2 style="margin:0;">' + title + '</h2>' +
      (sub ? '<div class="pd-modal-sub">' + sub + '</div>' : '') + '</div>' +
      '<button class="pd-modal-close" id="' + closeId + '">&times;</button></div>';
  }

  function boqCols(draft, codeIsItem) {
    var C = [];
    /* WARNING A ROW-NUMBER GUTTER, as review.html has. On a 700-line bill "which row was that?"
       is asked constantly - when reading a rate back to somebody, when comparing against the
       client's printed BOQ, when saying where an error is. The item code does not answer it
       because it is not sequential and repeats across trades. Narrow, muted, never editable. */
    C.push({ k: '_row', label: '#', w: 44, ro: true, r: true });
    C.push({ k: 'item_no', label: codeIsItem ? 'Class code' : 'Item', w: 96, mono: true, ro: true });
    C.push({ k: 'description', label: 'Description', w: 300, type: 'text' });
    /* setAll is offered on UoM and Kind only - a vocabulary, where one value down a whole
       trade is normal. It is NOT offered on any money column: a blanket write there is a way
       to destroy a bill in one click. */
    C.push({ k: 'unit', label: 'UoM', w: 74, type: 'uom', setAll: true, req: true });
    C.push({ k: 'qty', label: 'Quantity', w: 92, type: 'num', r: true, req: true });
    C.push({ k: 'mat_rate', label: 'Mat. rate', w: 100, type: 'num', r: true });
    C.push({ k: 'mat_amount', label: 'Mat. cost', w: 112, type: 'money', r: true, calc: true });
    C.push({ k: 'lab_rate', label: 'Lab. rate', w: 100, type: 'num', r: true });
    C.push({ k: 'lab_amount', label: 'Lab. cost', w: 112, type: 'money', r: true, calc: true });
    /* ⚠️ Total stays OVERRIDABLE, and `derived_amount` is the flag that already records which it
       is. A lump-sum line has an amount and no quantity to derive it from, so refusing the entry
       would make those lines unrepresentable. It is derived by DEFAULT and typed by exception. */
    C.push({ k: 'amount', label: 'Total amount', w: 124, type: 'num', r: true, calc: 'soft' });
    C.push({ k: 'line_kind', label: 'Kind', w: 112, type: 'kind', setAll: true });
    if (!codeIsItem) C.push({ k: '_class', label: 'Class code', w: 100 });
    /* ⚠️ NO PACKAGE COLUMN WHEN THE PROJECT HAS NO LOTS. Owner: *"why is there a package column
       when there is no package in this contract at all?"* — right, and it is the third place this
       has come up (the Contract lots section and the Assign-to-lot button were the others). With
       no lots every cell reads "—" forever, and a column of em-dashes is not information, it is a
       column of questions. A line with a null package_id already belongs to the whole contract. */
    if (PKGS.length) C.push({ k: '_pkg', label: 'Package', w: 96 });
    /* ⚠️ "Alloc." meant nothing to anybody. Owner: *"what is the Alloc. column referring to?"* It
       is how much of this line's quantity has been spread across schedule activities — the state
       the Match to schedule tab manages — so it now carries that tab's own word. Shown only on a
       revision that has something to match: it is empty on every line until quantities exist. */
    C.push({ k: '_alloc', label: 'Matched', w: 84, r: true });
    if (draft) C.push({ k: '_act', label: '', w: 58 });
    return C;
  }

  /* A <select> that can never lose what it is given. */
  function uomCell(r, ed) {
    var v = r.unit == null ? '' : String(r.unit);
    if (!ed) return esc(v);
    var opts = UOM.slice();
    if (v && opts.indexOf(v) < 0) opts.unshift(v);   // keep an imported unit this list lacks
    return '<select class="boq-cellsel" data-f="unit" data-i="' + esc(r.id) + '">' +
      '<option value=""' + (v ? '' : ' selected') + '></option>' +
      opts.map(function (u) {
        return '<option value="' + esc(u) + '"' + (u === v ? ' selected' : '') + '>' + esc(u) + '</option>';
      }).join('') + '</select>';
  }

  function recalc(n) {
    var q = n.qty, mr = n.mat_rate, lr = n.lab_rate;
    var ma = (q != null && mr != null) ? q * mr : null;
    var la = (q != null && lr != null) ? q * lr : null;
    var out = { mat_amount: ma, lab_amount: la };
    if (n.derived_amount === false && n.amount != null) { out.amount = n.amount; out.derived_amount = false; }
    else if (ma != null || la != null) { out.amount = (ma || 0) + (la || 0); out.derived_amount = true; }
    else { out.amount = null; out.derived_amount = false; }
    return out;
  }

  async function saveCell(id, field, raw) {
    var r = ITEMS.find(function (x) { return x.id === id; });
    if (!r || !canWrite) return;
    if (!isDraft()) { UI.toast('This revision is issued — its lines are immutable.', 'error'); render(); return; }

    var patch = {};
    if (field === 'description' || field === 'unit') patch[field] = txtOf(raw) || null;
    else if (field === 'line_kind') patch.line_kind = raw;
    else if (field === 'exclusion_note') patch.exclusion_note = txtOf(raw) || null;
    else {
      var s = txtOf(raw);
      if (s === '') patch[field] = null;
      else {
        /* ⚠️ `numOf`, not `Number`. Number('1,000') is NaN; numOf strips the separator.
           And an unparseable entry is REFUSED AND RE-RENDERED — which restores the stored
           figure in the cell. Writing null for it would be the silent clear this whole
           input type exists to prevent, and null vs 0 vs "a wrong number" are three
           different facts in a money column. */
        var v = numOf(s);
        if (v == null) {
          UI.toast('“' + s + '” is not a number — the cell is unchanged.', 'error');
          render(); return;
        }
        patch[field] = v;
      }
      /* An amount the planner typed is theirs, so it is not derived. Clearing it is also
         not derived — recalc() below then hands the line back to the rates. Both branches
         are false, which is why this is not a condition. */
      if (field === 'amount') patch.derived_amount = false;
    }

    var next = Object.assign({}, r, patch);
    /* A heading holds no money — see addAuthoredLines. Changing a line's kind TO heading
       therefore clears its figures rather than leaving an orphaned amount that no roll-up
       reads and every export prints. */
    if (next.line_kind === 'heading') {
      Object.assign(patch, { qty: null, mat_rate: null, mat_amount: null, lab_rate: null,
                             lab_amount: null, amount: null, derived_amount: false });
    } else if (['qty', 'mat_rate', 'lab_rate', 'amount', 'line_kind'].indexOf(field) >= 0) {
      Object.assign(patch, recalc(next));
    }

    var up = await sb().from(T_ITEM).update(patch).eq('id', id);
    if (up.error) {
      UI.toast(up.error.message + manualHint(up.error).replace(/<\/?code>/g, ''), 'error');
      await load(); return;
    }
    Object.assign(r, patch);
    render();
  }

  function selCount() { return Object.keys(SEL).length; }

  /* ⚠️⚠️ CHUNKED, because a bulk delete here is exactly the shape that has bitten this app before.
     Owner, 2026-09-07: they ticked almost the whole class-code library as a test and needed the
     lines gone — 924 rows on OPW101. Two hard limits apply (see the schedule module's notes):
       · PostgREST's `in.(...)` lives in the URL, which caps out around 200 uuids;
       · `statement_timeout` is ~8s, and one delete of everything can exceed it (error 57014).
     So: 150 ids per request, sequential, with the count reported as it goes. ⚠️ It stops at the
     FIRST failure and reports how many were actually removed rather than claiming success for the
     whole set — a delete that half-worked and said "done" is worse than one that says where it got
     to. `parent_id` is `on delete set null`, so removing a heading un-parents its children instead
     of silently taking them with it. */
  async function delSelected() {
    if (!canWrite || !isDraft()) { UI.toast('Lines can only be deleted from a draft revision.', 'error'); return; }
    var ids = Object.keys(SEL);
    if (!ids.length) return;
    var heads = ids.filter(function (id) {
      var r = ITEMS.find(function (x) { return x.id === id; });
      return r && r.line_kind === 'heading';
    }).length;
    if (!confirm('Delete ' + ids.length + ' line' + (ids.length === 1 ? '' : 's') + ' from this draft?' +
        (heads ? String.fromCharCode(10) + String.fromCharCode(10) + heads +
          ' of them are headings; the lines under them are kept and simply un-parented.' : '')))
      return;

    var CHUNK = 150, done = 0;
    for (var i = 0; i < ids.length; i += CHUNK) {
      var slice = ids.slice(i, i + CHUNK);
      var del = await sb().from(T_ITEM).delete().in('id', slice);
      if (del.error) {
        await load();
        UI.toast('Deleted ' + done + ' of ' + ids.length + ', then failed: ' +
          del.error.message + manualHint(del.error).replace(/<\/?code>/g, ''), 'error');
        return;
      }
      done += slice.length;
    }
    SEL = {};
    UI.toast('Deleted ' + done + ' line' + (done === 1 ? '' : 's') + '.', 'success');
    await load();
  }

  async function delLine(id) {
    if (!canWrite || !isDraft()) return;
    var r = ITEMS.find(function (x) { return x.id === id; });
    if (!r) return;
    var kids = ITEMS.filter(function (x) { return x.parent_id === id; });
    if (!confirm(kids.length
        ? 'Delete “' + (r.description || r.item_no) + '” and un-parent its ' + kids.length + ' line(s)?'
        : 'Delete “' + (r.description || r.item_no) + '”?')) return;
    var del = await sb().from(T_ITEM).delete().eq('id', id);
    if (del.error) {
      UI.toast(del.error.message + manualHint(del.error).replace(/<\/?code>/g, ''), 'error');
      return;
    }
    await load();
  }

  // ---- Issue the draft ------------------------------------------------------
  /* ⚠️ THE RECONCILIATION GATE, ON THE WAY OUT. The importer's most valuable check runs
     at the moment of import; a hand build has no equivalent moment, so it runs here. The
     tolerance is the same absolute-and-small ₱1 / 0.01% — widening it to 5% is exactly
     how the ₱20,667,260.59 plant hole passed on the real workbook. */
  function issueRev() {
    var rev = curRev(); if (!rev || !isDraft()) return;
    var sum = contractSum(ITEMS);
    var recon = reconcile(sum, rev.contract_total);
    var priced = ITEMS.filter(moneyLine).length;
    var unpriced = ITEMS.filter(function (r) { return r.line_kind !== 'heading' && !r.exclusion_note && r.amount == null; });
    var otherCurrent = REVS.some(function (r) { return r.id !== REVID && r.is_current; });

    var body = '<p class="cc-hint" style="margin-top:0;">Issuing freezes these lines. A remeasure is then a ' +
      '<strong>new revision</strong>.</p>' +
      '<table class="ccw-review"><tbody>' +
      '<tr><td>Priced lines</td><td><strong>' + priced + '</strong></td></tr>' +
      '<tr><td>Lines sum to</td><td><strong>' + money(sum) + '</strong></td></tr>' +
      '<tr><td>Stated contract total</td><td>' + (rev.contract_total == null
        ? '<span class="cc-mut">not given</span>' : money(rev.contract_total)) + '</td></tr>' +
      '</tbody></table>';

    if (!priced) {
      body += '<div class="boq-alert bad"><strong>Nothing is priced.</strong> Issuing this would file a ₱0 BOQ.</div>';
    }
    if (unpriced.length) {
      body += '<div class="boq-alert warn"><strong>' + unpriced.length + ' line' + (unpriced.length === 1 ? ' carries' : 's carry') +
        ' no amount</strong> and add' + (unpriced.length === 1 ? 's' : '') + ' nothing to the total. If the work is another ' +
        'party\'s, mark the line <b>Excluded</b> and say why.</div>';
    }
    if (!recon.ok && !recon.unknown) {
      body += '<div class="boq-alert bad"><strong>Does not reconcile.</strong> Lines sum to ' + money(recon.sum) +
        ' against the stated ' + money(recon.stated) + ' — off by ' + money(recon.diff) + '.</div>';
    }

    /* ⚠️ "Make this the current revision" IS A CHOICE AND IS NEVER PRE-TICKED WHEN
       ANOTHER REVISION IS ALREADY CURRENT. `is_current` is what the contract value, the
       POC and the monthly revenue read; silently moving it would change every one of
       those figures from a checkbox nobody looked at. Where nothing is current yet there
       is nothing to displace, so it defaults on. */
    body += '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;">' +
      '<input type="checkbox" id="is-cur"' + (otherCurrent ? '' : ' checked') + ' style="width:15px;height:15px;accent-color:var(--pd-red);" />' +
      '<span>Make this the <strong>current</strong> revision' +
      (otherCurrent ? ' — replaces the one the contract value, POC and revenue read.'
                    : ' (nothing is current yet).') + '</span></label>';

    var blocked = !priced || (!recon.ok && !recon.unknown);
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Issue revision ' + esc(rev.rev_no) + '</h2>' +
      '<button class="pd-modal-close" id="ir-x">&times;</button></div>' +
      '<div style="padding:2px 16px 6px;">' + body + '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ir-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ir-go"' + (blocked ? ' disabled' : '') + '>Issue revision</button></div>');
    m.el.querySelector('#ir-x').onclick = m.close;
    m.el.querySelector('#ir-c').onclick = m.close;
    var go = m.el.querySelector('#ir-go');
    if (blocked) return;
    go.onclick = async function () {
      var makeCurrent = m.el.querySelector('#is-cur').checked;
      go.disabled = true; go.textContent = 'Issuing…';
      try {
        // ⚠️ Clear the others FIRST. Two current revisions is the state that makes the
        //    contract value depend on row order.
        if (makeCurrent) {
          var cl = await sb().from(T_REV).update({ is_current: false }).eq('project_id', pid);
          if (cl.error) throw cl.error;
        }
        // ⚠️ status and is_current in ONE update: the draft-not-current trigger reads the
        //    NEW row, so setting is_current first would be refused.
        var up = await sb().from(T_REV).update({ status: 'issued', is_current: !!makeCurrent, updated_at: new Date().toISOString() }).eq('id', REVID);
        if (up.error) throw up.error;
        m.close();
        UI.toast('Revision ' + rev.rev_no + ' issued' + (makeCurrent ? ' and is now current.' : '.'), 'success');
        await load();
      } catch (err) {
        go.disabled = false; go.textContent = 'Issue revision';
        UI.toast((err.message || String(err)) + manualHint(err).replace(/<\/?code>/g, ''), 'error');
      }
    };
  }

  // ==========================================================================
  // BULK CONNECT — a class code to the schedule's activities
  // ==========================================================================
  /* Owner: *"from the class code library the planner would be able to tag it to the
     activities in the schedule module … (bulk connect, per trade etc.)"*

     THE GAP THIS CLOSES. `candidatesFor()` offers only activities that ALREADY carry the
     line's class code, and `proposeSplit` returns nothing when there are none — correct
     behaviour (never spread a quantity over something arbitrary) but on a freshly authored
     BOQ that is EVERY line, because nobody has tagged the schedule. The allocator was
     therefore unreachable by design for exactly the workflow it exists to serve. Tagging
     is the missing direction, and it runs from here because this is where the codes are
     known to be right.

     ⚠️ IT WRITES THROUGH `boq_tag_activities`, NOT A PLAIN UPDATE, and the row count it
        returns is checked. `project_schedule_upd` restricts UPDATE to
        `created_by = auth.uid() or is_admin()`, so a planner who did not import the
        schedule cannot touch its rows — and PostgREST answers an RLS-filtered UPDATE with
        200 and zero rows. "Tagged 40 activities" over a table that changed nothing is the
        same silent success that left 16,393 of 16,485 activities un-linked in
        2026-09-02-wbs-link-batched.sql. See the migration's §5.
     ⚠️ PROPOSE → PREVIEW → APPLY, the module's standing rule. Nothing is written by
        matching; a proposal above the confidence floor is pre-ticked, everything else is
        shown with its reason and left for the planner. */
  function tokensOf(s) { return normKey(s).split(' ').filter(function (w) { return w.length > 3; }); }
  /* ⚠️ EVERY MATCH NAMES ITS REASON, and the reason is shown on screen. A bare highlight
     is unauditable: the planner cannot tell "the words all matched" from "the trade field
     agreed", and those deserve different amounts of trust. */
  function matchAct(a, c) {
    var an = normKey(a.activity_name || '');
    if (!an) return null;
    var l3 = normKey(c.desc_l3 || ''), l2 = normKey(c.desc_l2 || '');
    if (l3 && an.indexOf(l3) >= 0) return { score: 0.95, why: 'names the item' };
    if (l3 && l3.indexOf(an) >= 0 && an.length > 6) return { score: 0.85, why: 'item names it' };
    var t3 = tokensOf(c.desc_l3 || '');
    if (t3.length) {
      var hit = t3.filter(function (w) { return an.indexOf(w) >= 0; }).length;
      if (hit === t3.length) return { score: 0.8, why: 'all item words' };
      if (hit >= 2) return { score: 0.55, why: hit + ' of ' + t3.length + ' item words' };
    }
    var wt = normKey(a.work_type || '');
    if (wt && l2 && (l2.indexOf(wt) >= 0 || wt.indexOf(l2) >= 0)) return { score: 0.6, why: 'trade matches group' };
    if (l2 && an.indexOf(l2) >= 0) return { score: 0.5, why: 'names the group' };
    var t2 = tokensOf(c.desc_l2 || '');
    if (t2.length) {
      var h2 = t2.filter(function (w) { return an.indexOf(w) >= 0; }).length;
      if (h2 >= 2) return { score: 0.35, why: h2 + ' group words' };
    }
    return null;
  }
  var TAG_FLOOR = 0.8;   // pre-ticked at or above this; proposed-but-unticked below it

  function codesInBoq() {
    var seen = {}, out = [];
    ITEMS.forEach(function (r) {
      var cm = CMAP[r.id]; if (!cm) return;
      var e = seen[cm.class_code];
      if (!e) { e = seen[cm.class_code] = { code: cm.class_code, lines: 0 }; out.push(e); }
      e.lines++;
    });
    out.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
    return out;
  }
  function actsWith(code) {
    return (ACTS || []).filter(function (a) { return a.class_code === code; });
  }

  /* ==========================================================================
     PASS B's PLAN, at module scope — every code on this revision, matched at once.
     ==========================================================================
     ⚠️ Lifted out of the tag dialog so the whole-BOQ run can PROPOSE the same tags without
     opening it. One planner, two callers: a second copy would let the orchestrator's preview
     and the dialog's own preview disagree about the same project. It reads only ACTS, the
     chart and CMAP (through `codesInBoq`), and writes nothing — which is also what makes the
     dry run below able to overlay state and simulate it. */
  function planTags() {
    return codesInBoq().map(function (e) {
      var c = codeRow(e.code); if (!c) return null;
      var hits = (ACTS || []).map(function (a) { return { a: a, m: matchAct(a, c) }; })
        .filter(function (x) { return x.m && x.m.score >= TAG_FLOOR; })
        /* ⚠️ UNTAGGED ACTIVITIES ONLY. One already carrying THIS code needs nothing, and
           one carrying ANOTHER must not be moved in bulk — a class code drives the cost
           roll-up, so retagging forty activities at once is a reconciliation nobody would
           know to go looking for. Both cases fall out of the same test. */
        .filter(function (x) { return !x.a.class_code; });
      return { code: e.code, c: c, hits: hits, lines: e.lines };
    }).filter(Boolean);
  }

  /* The write half of pass B. ⚠️ Chunked and shortfall-aware through `tagRpc`, and it
     REPORTS rather than returns silently — see `reportTagged`. `onStep` drives the caller's
     own progress label; the loop is identical whichever button started it. */
  async function applyTagPlan(plan, onStep) {
    var wrote = 0, wanted = 0, failed = [];
    for (var i = 0; i < plan.length; i++) {
      var p = plan[i];
      if (!p.hits.length) continue;
      var ids = p.hits.map(function (x) { return x.a.activity_id; });
      wanted += ids.length;
      if (onStep) onStep(i + 1, plan.length);
      try { wrote += await tagRpc(p.code, ids, false); }
      catch (e) { failed.push(p.code + ': ' + (e.message || e)); }
    }
    return { wrote: wrote, wanted: wanted, failed: failed };
  }

  async function openTagActivities() {
    await ensureCodes();
    await ensureActs();
    var codes = codesInBoq();
    if (!codes.length) {
      UI.toast('No line on this revision carries a class code yet — map or author some first.', 'warn');
      return;
    }
    var cur = codes[0].code, aq = '', pickedActs = {}, overwrite = false, mode = 'one';

    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">Tag schedule activities</h2><div class="pd-modal-sub">Write a class code onto the activities it covers, in bulk</div></div>' +
      '<button class="pd-modal-close" id="tg-x">&times;</button></div>' +
      '<div style="padding:2px 16px 6px;" id="tg-body"></div>' +
      '<div class="pd-modal-footer" id="tg-foot"></div>');
    /* ⚠️ WIDENED, and this is not cosmetic. `.pd-modal` is max-width 520px; measured in
       the render harness at 1440px, the two-pane grid inside it left the activity list
       about 200px wide — every row wrapped onto three lines behind two nested scrollbars.
       A code list beside a candidate list needs the width the wizard's `.ccw` takes. */
    m.el.querySelector('.pd-modal').classList.add('boq-wide');
    var body = m.el.querySelector('#tg-body'), foot = m.el.querySelector('#tg-foot');
    m.el.querySelector('#tg-x').onclick = m.close;

    function curCode() { return codeRow(cur) || { code: cur, desc_l1: '', desc_l2: '', desc_l3: cur }; }

    /* Mode B — the per-trade bulk run. One matcher, one RPC, every code at once, with a
       preview that says how many activities each code would take and how it found them.
       ⚠️ The PLAN is `planTags()` at module scope — this dialog and the whole-BOQ run
       ("Match to the schedule…") must propose the same tags or the preview lies. */
    function bulkPlan() { return planTags(); }

    function paintBulk() {
      var plan = bulkPlan();
      var total = plan.reduce(function (s, p) { return s + p.hits.length; }, 0);
      var withNone = plan.filter(function (p) { return !p.hits.length; }).length;
      body.innerHTML = '<div class="boq-filters"><button class="pd-btn" id="tg-mode1">← One code at a time</button>' +
        '<span class="cc-mini">Every code on this BOQ, matched at once</span></div>' +
        '<p class="cc-hint" style="margin-top:0;">' + plan.length + ' code(s) · <strong>' + total + '</strong> tag(s) ' +
        'at ≥' + (TAG_FLOOR * 100).toFixed(0) + '% confidence · <strong>' + withNone + '</strong> match nothing, left alone.<br>' +
        '⚠️ Activities carrying another code are excluded — re-tagging is a per-code decision.</p>' +
        '<div class="cc-tablewrap" style="max-height:38vh;overflow:auto;border:1px solid var(--pd-line);border-radius:var(--pd-radius);">' +
        '<table class="cc-table" style="min-width:0;"><thead><tr><th>Class code</th><th class="cc-desc">Item</th>' +
        '<th class="cc-r">BOQ lines</th><th class="cc-r">Would tag</th><th>How</th></tr></thead><tbody>' +
        plan.map(function (p) {
          var whys = {};
          p.hits.forEach(function (x) { whys[x.m.why] = (whys[x.m.why] || 0) + 1; });
          return '<tr><td><span class="boq-code">' + esc(p.code) + '</span></td>' +
            '<td class="cc-desc"><div class="cc-desc-txt">' + esc(p.c.desc_l3) + '</div>' +
            '<div class="cc-mini">' + esc(p.c.desc_l1) + ' › ' + esc(p.c.desc_l2) + '</div></td>' +
            '<td class="cc-r">' + p.lines + '</td>' +
            '<td class="cc-r">' + (p.hits.length ? '<strong>' + p.hits.length + '</strong>' : '<span class="cc-mut">—</span>') + '</td>' +
            '<td>' + (Object.keys(whys).length
              ? Object.keys(whys).map(function (w) { return '<span class="boq-why">' + esc(w) + ' ×' + whys[w] + '</span>'; }).join(' ')
              : '<span class="cc-mut">no name resembles it</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      foot.innerHTML = '<button class="pd-btn" id="tg-c">Close</button><span style="flex:1;"></span>' +
        '<button class="pd-btn pd-btn-primary" id="tg-bulkgo"' + (total ? '' : ' disabled') + '>Apply ' + total + ' tag(s)</button>';
      foot.querySelector('#tg-c').onclick = m.close;
      body.querySelector('#tg-mode1').onclick = function () { mode = 'one'; paint(); };
      var bg = foot.querySelector('#tg-bulkgo');
      if (bg) bg.onclick = function () { applyBulk(plan, bg); };
    }

    async function applyBulk(plan, btn) {
      btn.disabled = true;
      var res = await applyTagPlan(plan, function (i, n) {
        btn.textContent = 'Applying ' + i + ' of ' + n + '…';
      });
      await refreshActs();
      m.close();
      reportTagged(res.wrote, res.wanted, res.failed);
      render();
    }

    function paintOne() {
      var c = curCode();
      var mine = actsWith(cur);
      var scored = (ACTS || []).map(function (a) { return { a: a, m: matchAct(a, c) }; });
      var k = normKey(aq);
      var list = scored.filter(function (x) {
        if (x.a.class_code === cur) return true;                  // already ours — shown, ticked, done
        if (k) return normKey([x.a.activity_id, x.a.activity_name, x.a.work_type].join(' ')).indexOf(k) >= 0;
        return !!x.m;                                             // with no search, only proposals
      }).sort(function (p, q2) {
        return ((q2.m && q2.m.score) || 0) - ((p.m && p.m.score) || 0) ||
               String(p.a.activity_id).localeCompare(String(q2.a.activity_id));
      }).slice(0, 300);

      body.innerHTML = '<div class="boq-filters"><button class="pd-btn" id="tg-modeb">Bulk — every code at once →</button>' +
        '<span class="cc-mini">' + codes.length + ' code(s) on this revision · ' + (ACTS || []).length + ' leaf activities</span></div>' +
        '<div class="boq-tag">' +
        '<div class="boq-taglist">' + codes.map(function (e) {
          var cr = codeRow(e.code), n = actsWith(e.code).length;
          return '<button class="boq-tagcode' + (e.code === cur ? ' on' : '') + '" data-code="' + esc(e.code) + '">' +
            '<span class="boq-tagcode-c">' + esc(e.code) + '</span>' +
            '<span class="boq-tagcode-d">' + esc(cr ? cr.desc_l3 : '(not in the chart)') + '</span>' +
            '<span class="' + (n ? 'boq-why' : 'boq-taken') + '">' + (n ? n + ' act' : 'none') + '</span></button>';
        }).join('') + '</div>' +
        '<div class="boq-tagpane">' +
        '<p class="cc-hint" style="margin-top:0;"><span class="boq-code">' + esc(c.code) + '</span> ' +
          esc(c.desc_l1 || '') + ' › ' + esc(c.desc_l2 || '') + ' › <strong>' + esc(c.desc_l3 || '') + '</strong><br>' +
          'On <strong>' + mine.length + '</strong> activit' + (mine.length === 1 ? 'y' : 'ies') + ' today. ' +
          'Matches ≥' + (TAG_FLOOR * 100).toFixed(0) + '% are pre-ticked; weaker ones show their reason.</p>' +
        '<input class="pd-input" id="tg-q" placeholder="Search activity id, name or trade…" value="' + esc(aq) + '" />' +
        '<div class="boq-tagacts">' + (list.length ? list.map(function (x) {
          var a = x.a, isMine = a.class_code === cur;
          var taken = a.class_code && !isMine;
          var pre = isMine || (pickedActs[a.activity_id] != null ? pickedActs[a.activity_id]
                    : (!!x.m && x.m.score >= TAG_FLOOR && !taken));
          return '<label class="boq-tagact">' +
            '<input type="checkbox" data-a="' + esc(a.activity_id) + '"' + (pre ? ' checked' : '') +
              (isMine ? ' disabled' : '') + (taken && !overwrite ? ' disabled' : '') + ' />' +
            '<span class="boq-tagact-id">' + esc(a.activity_id) + '</span>' +
            '<span class="boq-tagact-n">' + esc(a.activity_name || '') +
              (a.work_type ? ' <span class="cc-mini">· ' + esc(a.work_type) + '</span>' : '') + '</span>' +
            '<span class="boq-tagact-w">' +
              (isMine ? '<span class="boq-why">tagged</span>'
               : taken ? '<span class="boq-taken">has ' + esc(a.class_code) + '</span>'
               : x.m ? '<span class="boq-why">' + esc(x.m.why) + ' ' + (x.m.score * 100).toFixed(0) + '%</span>' : '') +
            '</span></label>';
        }).join('') : '<p class="cc-mut" style="padding:16px;text-align:center;">No name resembles this. ' +
            'Search to pick by hand.</p>') +
        '</div></div></div>';

      var n = Object.keys(pickedActs).filter(function (id) {
        if (!pickedActs[id]) return false;
        var a = (ACTS || []).find(function (x) { return x.activity_id === id; });
        return a && a.class_code !== cur;
      }).length;

      foot.innerHTML =
        '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;">' +
        '<input type="checkbox" id="tg-ow"' + (overwrite ? ' checked' : '') + ' style="width:15px;height:15px;accent-color:var(--pd-red);" />' +
        '<span>Allow re-tagging</span></label>' +
        '<span style="flex:1;"></span><button class="pd-btn" id="tg-c">Close</button> ' +
        '<button class="pd-btn pd-btn-primary" id="tg-go"' + (n ? '' : ' disabled') + '>Tag ' + n + ' activit' + (n === 1 ? 'y' : 'ies') + '</button>';

      // Seed pickedActs from what is on screen, so the footer count matches the boxes.
      body.querySelectorAll('[data-a]').forEach(function (cb) {
        if (cb.disabled) return;
        if (pickedActs[cb.dataset.a] == null) pickedActs[cb.dataset.a] = cb.checked;
        cb.onchange = function () { pickedActs[cb.dataset.a] = cb.checked; paintFoot(); };
      });
      body.querySelectorAll('[data-code]').forEach(function (b) {
        b.onclick = function () { cur = b.dataset.code; pickedActs = {}; aq = ''; paint(); };
      });
      body.querySelector('#tg-modeb').onclick = function () { mode = 'bulk'; paint(); };
      var qi = body.querySelector('#tg-q'), t = null;
      qi.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { aq = qi.value; paint(); }, 180); });
      wireFoot();
      paintFoot();
    }

    function selectedIds() {
      return Object.keys(pickedActs).filter(function (id) {
        if (!pickedActs[id]) return false;
        var a = (ACTS || []).find(function (x) { return x.activity_id === id; });
        return a && a.class_code !== cur;
      });
    }
    function paintFoot() {
      var n = selectedIds().length, go = foot.querySelector('#tg-go');
      if (!go) return;
      go.disabled = !n;
      go.textContent = 'Tag ' + n + ' activit' + (n === 1 ? 'y' : 'ies');
    }
    function wireFoot() {
      foot.querySelector('#tg-c').onclick = m.close;
      var ow = foot.querySelector('#tg-ow');
      if (ow) ow.onchange = function () { overwrite = ow.checked; paint(); };
      var go = foot.querySelector('#tg-go');
      if (go) go.onclick = async function () {
        var ids = selectedIds();
        if (!ids.length) return;
        go.disabled = true; go.textContent = 'Tagging…';
        try {
          var wrote = await tagRpc(cur, ids, overwrite);
          await refreshActs();
          pickedActs = {};
          reportTagged(wrote, ids.length, []);
          paint(); render();
        } catch (e) {
          go.disabled = false; paintFoot();
          UI.toast((e.message || String(e)) + manualHint(e).replace(/<\/?code>/g, ''), 'error');
        }
      };
    }

    function paint() { if (mode === 'bulk') paintBulk(); else paintOne(); }
    paint();
  }

  /* ⚠️ CHUNKED AT 200 IDs. A `text[]` parameter travels in the POST body so it is not
     under the `in.()` URL cap, but a project can hold 16k activities and one array of
     that size is a statement timeout waiting to happen (the 8s ceiling measured in
     2026-09-02-wbs-link-batched.sql). The counts are summed across the calls. */
  async function tagRpc(code, ids, overwrite) {
    var wrote = 0;
    for (var i = 0; i < ids.length; i += 200) {
      var res = await sb().rpc('boq_tag_activities', {
        p_project_id: pid, p_class_code: code,
        p_activity_ids: ids.slice(i, i + 200), p_overwrite: !!overwrite
      });
      if (res.error) throw res.error;
      wrote += Number(res.data) || 0;
    }
    return wrote;
  }
  /* ⚠️ THE SHORTFALL IS REPORTED, NEVER SWALLOWED. Fewer rows written than asked for has
     exactly two causes and the planner can act on both: RLS refused the rows (they did not
     import this schedule), or the activity id no longer exists (the schedule was
     re-imported since this screen was opened). Saying "done" would hide both. */
  function reportTagged(wrote, wanted, failed) {
    if (failed && failed.length) {
      UI.toast('Some codes failed — ' + failed.join(' | '), 'error');
      return;
    }
    if (!wanted) { UI.toast('Nothing to tag.', 'warn'); return; }
    if (wrote >= wanted) { UI.toast('Tagged ' + wrote + ' activit' + (wrote === 1 ? 'y' : 'ies') + '.', 'success'); return; }
    UI.toast('Only ' + wrote + ' of ' + wanted + ' tagged — the rest were refused, usually because somebody else ' +
      'imported this schedule. Nothing was skipped silently.', 'error');
  }
  // ⚠️ WBSNAME is rebuilt by the same read, so it must be cleared with ACTS or a re-read after an
  //    import would keep naming branches the previous schedule's way.
  /* ⚠️ `clearTradeActs()` here is load-bearing: this runs right after the tagger writes, so a
     stale per-trade count would go on reporting a trade as absent from a schedule that was
     just tagged — telling the planner their own work had no effect. */
  async function refreshActs() { ACTS = null; WBSNAME = {}; clearTradeActs(); await ensureActs(); }

  // ==========================================================================
  // TAB 2 — Class-code mapping (B1b)
  // ==========================================================================
  var SUGG = null;
  async function ensureSugg() {
    // ⚠ Same empty-array trap as ensureActs / ensureCodes: `[]` is truthy, and this one starts
    //   legitimately empty on a fresh deployment, so it would never query twice.
    if (SUGG && SUGG.length) return SUGG;
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

    /* ⚠️⚠️ THE NUMERATOR AND THE DENOMINATOR WERE COUNTING DIFFERENT THINGS. `Object.keys(CMAP)`
       is every mapping on the revision INCLUDING headings, while `mappables` excludes them
       (`mappable()` — and `addAuthoredLines` states the reason: on a bill we authored, a heading
       is a group and a group is not a scope item). So on a bill mapped at the heading — the shape
       this very tab invites, three lines below — "Mapped" could exceed "of N mappable lines" and
       read as a defect. They are separated rather than merged, because both facts are real and
       they are not the same fact: a mapped heading covers its leaves, it is not itself scope.
       ⚠️ `mappable()` is deliberately NOT widened. It gates the suggestion and accept-all paths
       and the authored-bill invariant above; the allocator reaches an inherited code through
       `codeFor` instead, which is where that question actually belongs. */
    var headsMapped = heads.filter(function (r) { return CMAP[r.id]; }).length;
    var leavesMapped = mappables.filter(function (r) { return CMAP[r.id]; }).length;
    /* What the allocator can actually act on: a leaf with its own code, or one inheriting a
       heading's. This is the number that predicts whether the Match-to-schedule tab has work. */
    var effective = mappables.filter(function (r) { return codeFor(r); }).length;

    var h = '<div class="cc-kpis">' +
      kpi('Mapped', leavesMapped, 'of ' + mappables.length + ' mappable lines') +
      kpi('Unmapped', unmapped.length, 'the worklist', unmapped.length ? 'warn' : 'good') +
      kpi('Headings mapped', headsMapped + ' / ' + heads.length,
          headsMapped ? 'covering ' + (effective - leavesMapped) + ' more line(s)' : 'map here where the sheet supports it') +
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
      /* ⚠️ THE OTHER DIRECTION, and it belongs on this tab. Mapping answers "which code
         is this line?"; tagging answers "which activities carry that code?" — and without the
         second the allocator has no candidates and proposes nothing, which on a freshly
         authored BOQ is every line. */
      (canWrite ? '<button class="pd-btn" id="boq-c-tag" title="Give schedule activities these class codes">Tag schedule activities…</button>' : '') +
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
    var tg = host.querySelector('#boq-c-tag'); if (tg) tg.onclick = openTagActivities;
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
    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">Map to a class code</h2><div class="pd-modal-sub">Give this imported line the Finance code it files under</div></div>' +
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
      }).join('') : '<p class="cc-mut">No codes match. ' + ((CODES || []).length ? '' : 'The class-code chart is empty — run migrations/2026-08-21-class-codes.sql, then reload this page.') + '</p>';
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
  /* ==========================================================================
     PASS A's PLAN — which unmapped lines currently carry a code proposal.
     ==========================================================================
     ⚠️ Lifted for the same reason as `planTags`: the whole-BOQ run has to propose exactly what
     this dialog proposes. `minConf` is applied by the caller, not here, because this dialog
     lets the planner move the floor and watch the count change. */
  function planCodeMap() {
    return ITEMS.filter(function (r) { return mappable(r) && !CMAP[r.id]; })
      .map(function (r) { return { r: r, s: suggestFor(r) }; }).filter(function (x) { return x.s; });
  }

  /* The write half of pass A. ⚠️ `source:'bulk_accepted'` is the whole reason that column
     exists — a later audit must be able to tell a bulk accept from a considered mapping. */
  async function applyCodeMap(take) {
    var rowsIns = take.map(function (x) {
      return { project_id: pid, revision_id: REVID, boq_item_id: x.r.id, class_code: x.s.code,
               source: 'bulk_accepted', confidence: x.s.confidence, created_by: UID };
    });
    for (var i = 0; i < rowsIns.length; i += 300) {
      var res = await sb().from(T_MAP).upsert(rowsIns.slice(i, i + 300), { onConflict: 'boq_item_id' });
      if (res.error) return { ok: false, msg: res.error.message, wrote: 0 };
    }
    return { ok: true, wrote: rowsIns.length };
  }

  async function acceptAllProposals() {
    await ensureSugg();
    var cands = planCodeMap();
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
      var res = await applyCodeMap(take);
      if (!res.ok) { UI.toast(res.msg, 'error'); return; }
      UI.toast('Mapped ' + res.wrote + ' line(s).', 'success');
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
  /* ==========================================================================
     codeFor — a HEADING's class code reaches its leaves
     ==========================================================================
     ⚠️⚠️ HEADING MAPPING WAS HALF-BUILT AND BOUGHT NOTHING. The Class Codes tab lists headings
     and its own KPI reads "Headings — map here where the sheet supports it", and
     `docs/boq-and-pmi.md` §3.3 is an argument for mapping AT the heading: on the OPW101 fit-out
     sheets one heading covers 2–16 location leaves, so ~40 headings cover ~190 lines. But
     `candidatesFor` read `CMAP[r.id]` — the leaf's OWN map — so a mapped heading was invisible
     to the allocator and the planner had to map all 190 anyway.

     ⚠️ The DIRECT map always wins. An inherited code is a fallback, never an override: a leaf
     mapped by hand to something other than its heading has been deliberately corrected, and
     silently replacing that would undo a judgement.
     ⚠️ Bounded at 8 hops, the same bound `pathOf` already uses, so a cyclic parent_id (which a
     bad import can produce, the column being a plain self-reference) cannot hang the tab. */
  function codeFor(r) {
    if (!r) return null;
    var direct = CMAP[r.id];
    if (direct && direct.class_code) return { class_code: direct.class_code, from: null };
    var cur = r, seen = 0;
    while (cur && cur.parent_id && seen++ < 8) {
      cur = ITEMS.find(function (x) { return x.id === cur.parent_id; });
      if (!cur) break;
      var cm = CMAP[cur.id];
      if (cm && cm.class_code) return { class_code: cm.class_code, from: cur };
    }
    return null;
  }

  /* ==========================================================================
     THE CODE GATE HAS TWO LEVELS, BECAUSE AN ACTIVITY IS COARSER THAN A BILL LINE
     ==========================================================================
     ⚠️⚠️ A BOQ line carries a Finance LEVEL-3 item code ('03101'); a schedule activity built from
     the Schedule Builder's library carries a LEVEL-2 GROUP code ('03100'). Both are valid — a
     group ("Concrete Works") is the size of something you schedule, an item ("Rebar Works") the
     size of something you bill — but they are different strings, so an exact-equality gate matched
     NOTHING between them. On a schedule built that way the allocator had no candidates at all and
     silently proposed nothing, for every line.

     ⚠️ EXACT WINS AS A SET, AND THE GROUP GATE IS ONLY A FALLBACK. If any activity carries the
     line's own item code, those are the candidates and the coarser ones are not offered at all —
     mixing them would let a whole-group activity dilute a split that had an exact answer. The
     group gate opens only when the exact one found nobody, which is exactly the schedule-builder
     case it exists for.
     ⚠️ `code_l2` comes off the chart row, never from string surgery on the code. Deriving a group
     by truncating '03101' to '0310' would be the de-zeroing mistake in another costume — the code
     is an opaque key and only the chart says what its group is. */
  function groupOfCode(code) {
    var c = codeRow(String(code == null ? '' : code).trim());
    var g = c && c.code_l2 != null ? String(c.code_l2).trim() : '';
    return g || null;
  }
  function candidatesFor(r) {
    var cf = codeFor(r);
    if (!cf || !ACTS) return [];
    var exact = ACTS.filter(function (a) { return a.class_code === cf.class_code; });
    if (exact.length) return exact;
    var grp = groupOfCode(cf.class_code);
    if (!grp) return [];
    /* ⚠️ Never match an activity whose own code IS the line's group when that code is also a real
       item code — four of the 205 groups double as an L3 item, and there the activity means the
       item, not the whole group. `codeRow` answering tells them apart. */
    return ACTS.filter(function (a) {
      var k = String(a.class_code || '').trim();
      return k && k === grp && !codeRow(k);
    });
  }
  /* ⚠️ The haystack is the leaf's text PLUS its heading chain. On three of the four OPW101
     sheets the heading carries the spec and the leaf carries the place — but the place is
     sometimes named on the heading instead ("WF-1.02C … at 3rd floor" over bare leaves), and
     reading the leaf alone silently loses those. `pathOf` is the chain the class-code
     suggestion library already keys on, so this adds no new notion of a line's ancestry. */
  function locHaystack(r) {
    var parts = [], seen = 0, cur = r;
    while (cur && seen++ < 8) {
      if (cur.description) parts.unshift(cur.description);
      cur = cur.parent_id ? ITEMS.find(function (x) { return x.id === cur.parent_id; }) : null;
    }
    return parts.join(' ');
  }
  function locValsOf(a) {
    var vals = [];
    if (a && a.location && typeof a.location === 'object') {
      Object.keys(a.location).forEach(function (k) { if (a.location[k]) vals.push(a.location[k]); });
    }
    return vals;
  }
  function locMatch(r, acts) {
    var hay = locHaystack(r);
    if (!hay) return [];
    return acts.filter(function (a) {
      return locValsOf(a).some(function (v) { return PDLoc.contains(hay, v); });
    });
  }

  /* ==========================================================================
     scoreCandidates — the four rungs, and every match says which one found it
     ==========================================================================
     ⚠️⚠️ WHY THIS IS NOT JUST `candidatesFor`. A class code is a TAG: "Rebar Works" is one code
     on forty floor-level activities. Returning all forty and splitting pro-rata by duration was
     the whole of the old proposal — and it is not merely imprecise, it MOVES MONEY. Cost
     Loading's `boqDerive` (project-schedule) splits a line's amount across exactly the
     activities it is allocated to, and that lands in `project_schedule.planned_cost`, which is
     the cost-basis S-curve and Cash Flow's cash-in. A 3rd-floor line spread over forty floors
     puts 95% of its cost on floors it does not touch.

     THE RUNGS, strongest first. The code is a GATE (it narrows); the other three SCORE.

       location  0.90  the line's text + heading chain names the activity's own location value
       wbs       0.70  a WBS branch above the activity is named by the line's heading chain,
                       or is a branch the planner has already declared to be that place
       name      ≤0.6  `matchAct`'s word overlap — the weakest signal and a TIEBREAK ONLY
       code      0.10  carries the code and nothing else agrees; still a real candidate

     ⚠️ ONLY THE BEST RUNG IS REPORTED per activity, not a blended score. "Matched on location"
     and "matched on a 0.55 word overlap that also happened to share a floor" deserve different
     trust, and a single number hides which one you have. The `why` string is what the planner
     reads and what `matched_by` stores.

     ⚠️ RETURNS A PROPOSAL AND WRITES NOTHING. Propose → preview → apply, unchanged. */
  var RUNG_SCORE = { location: 0.90, wbs: 0.70, name: 0.60, code: 0.10 };
  var RUNG_ORDER = ['location', 'wbs', 'name', 'code'];
  var RUNG_LABEL = {
    location: 'location match',
    wbs: 'WBS branch',
    name: 'name similarity',
    code: 'class code only — split pro-rata by duration'
  };

  function scoreCandidates(r) {
    var acts = candidatesFor(r);
    var cf = codeFor(r);
    /* ⚠️ NO CODE IS NOT NO ANSWER, but it is a different one. With nothing to narrow on, the
       candidate set would be the whole schedule — 16k rows — so the weaker rungs are run over
       it only when they can actually discriminate: location, which is a positive statement
       about a place, and never the name rung, which at floor 0.35 would return hundreds. */
    var gated = !!cf;
    if (!gated) acts = locMatch(r, ACTS || []);
    if (!acts.length) return { gated: gated, code: cf, list: [] };

    var hay = locHaystack(r);
    var pathKey = normKey(hay);
    // ⚠️ The chart row is deliberately NOT read here — see the name rung below for why.
    /* Did the gate fall back to the group? Read off the resolved set ONCE — `candidatesFor`
       returns exact matches or group matches, never a mixture, so one member answers for all of
       them and no second filter over ACTS is needed. */
    var viaGroup = gated && !!acts.length && acts[0].class_code !== cf.class_code;
    var grpCode = viaGroup ? String(acts[0].class_code || '').trim() : '';

    var list = acts.map(function (a) {
      var best = null;
      var bump = function (rung, why) {
        if (!best || RUNG_SCORE[rung] > best.score) best = { rung: rung, score: RUNG_SCORE[rung], why: why };
      };

      /* rung 4 — the code alone, the floor every gated candidate stands on.
         ⚠️ It SAYS when it matched at group level. "carries 03101" and "in group 03100, which holds
            03101" are different claims, and the second is the weaker one — a planner accepting a
            split needs to know which they are looking at. */
      if (gated) {
        bump('code', viaGroup
          ? 'in group ' + grpCode + ', which holds ' + cf.class_code
          : 'carries ' + cf.class_code);
      }

      /* rung 3 — name similarity against THE LINE'S OWN TEXT, and deliberately NOT against the
         class code's chart description.
         ⚠️⚠️ Scoring against the chart was the first cut and it was worse than useless. An
         activity carries a code BECAUSE its name resembles that code's description — that is
         what `matchAct` does for the tagger, which is the right place for it. So inside a
         code-gated set every candidate scores ~0.95 on the chart, the rung never discriminates,
         and its only effect is to relabel a code match as a name match and switch the split
         from pro-rata to equal. Measured on the fixture: a provisional-sum line naming nothing
         came back as 20 activities on rung `name`. The line's OWN description is the signal
         that varies within a code, so it is the only one read here. */
      if (r.description) {
        var md = matchAct(a, { desc_l3: r.description, desc_l2: '' });
        if (md) bump('name', md.why);
      }

      // rung 2 — the WBS branch.
      var branches = wbsNamesOf(a);
      for (var i = 0; i < branches.length; i++) {
        var bn = branches[i];
        // (a) the line's heading chain names this branch outright
        if (bn.length > 3 && pathKey.indexOf(normKey(bn)) >= 0) { bump('wbs', 'under WBS “' + bn + '”'); break; }
        // (b) the planner has already declared this branch to BE a place, and the line names it
        var declared = LOCMATCH && LOCMATCH[bn];
        if (declared && PDLoc.contains(hay, declared)) { bump('wbs', 'WBS “' + bn + '” is ' + declared); break; }
      }

      // rung 1 — the location values stored on the activity itself.
      var lv = locValsOf(a);
      for (var j = 0; j < lv.length; j++) {
        if (PDLoc.contains(hay, lv[j])) { bump('location', 'at ' + lv[j]); break; }
      }

      return { act: a, rung: best.rung, score: best.score, why: best.why };
    });

    list.sort(function (p, q2) {
      return q2.score - p.score || String(p.act.activity_id).localeCompare(String(q2.act.activity_id));
    });
    return { gated: gated, code: cf, list: list };
  }

  /* The winning rung's members — the set a proposal is actually built from.
     ⚠️ TOP RUNG ONLY, never "everything above a threshold". If three activities matched on
     location and thirty-seven only on the code, the answer is those three: including the
     thirty-seven at a lower weight is the pro-rata smear this whole change exists to remove.
     A weaker rung is a FALLBACK for when the stronger one found nothing, not a supplement. */
  function topRung(scored) {
    var list = (scored && scored.list) || [];
    if (!list.length) return { rung: null, list: [] };
    var top = list[0].rung;
    return { rung: top, list: list.filter(function (x) { return x.rung === top; }) };
  }
  /* Propose a split. ⚠️ RETURNS A PROPOSAL — it writes nothing. An auto-split
     written silently becomes indistinguishable from a planner's own figures,
     which defeats the point of an auditable allocation table. Same rule the
     schedule's location wizard already follows: propose → preview → apply. */
  /* ⚠️ It now takes the SCORED result, so the split is made over the winning rung's members
     rather than over everything carrying the code. The old signature took a flat activity
     array; an array is still accepted so nothing that has not been updated breaks. */
  function proposeSplit(r, scored) {
    var s = (scored && scored.list) ? scored
          : { gated: true, code: codeFor(r),
              list: (scored || []).map(function (a) { return { act: a, rung: 'code', score: RUNG_SCORE.code, why: 'candidate' }; }) };
    var top = topRung(s);
    var picked = top.list;
    if (!picked.length) return { method: null, rung: null, parts: [], scored: s };

    var part = function (x, qty) {
      return { activity_id: x.act.activity_id, name: x.act.activity_name, qty: qty,
               rung: x.rung, why: x.why };
    };
    var q = Number(r.qty) || 0;

    /* ⚠️ NO QUANTITY IS NOT NOTHING TO PROPOSE. It used to return an empty set, so a planner opening
       an un-measured line got a blank dialog and had to add every activity from an 800-entry select —
       which is friction precisely where the owner asked for none. The candidates ARE the proposal;
       only the split is unknown, so each part comes back at 0 and the link is one press of Apply.
       Method stays null: nothing has been split, and labelling this 'prorata' would claim an
       arithmetic that did not happen. */
    if (!q) return { method: null, rung: top.rung, scored: s,
                     parts: picked.map(function (x) { return part(x, 0); }) };

    /* ⚠️ A LOCATION OR WBS MATCH IS A STATEMENT ABOUT *WHERE*, SO THE SPLIT IS EQUAL. Weighting
       those by duration would silently give a slower floor more of the quantity — the floors
       were named, not measured, and the arithmetic must not invent a measurement the match did
       not make. Only the un-discriminated code rung falls back to duration pro-rata, which is
       what the old function did for every case. */
    if (top.rung === 'location' || top.rung === 'wbs' || top.rung === 'name') {
      var each = q / picked.length;
      return { method: 'location', rung: top.rung, scored: s,
               parts: picked.map(function (x) { return part(x, each); }) };
    }
    var totalDur = picked.reduce(function (t, x) { return t + (Number(x.act.duration_days) || 0); }, 0);
    if (totalDur > 0) {
      return { method: 'prorata', rung: top.rung, scored: s, parts: picked.map(function (x) {
        return part(x, q * (Number(x.act.duration_days) || 0) / totalDur); }) };
    }
    var e2 = q / picked.length;
    return { method: 'prorata', rung: top.rung, scored: s,
             parts: picked.map(function (x) { return part(x, e2); }) };
  }

  /* ⚠️⚠️ THIS TAB USED TO SHOW FIVE ZEROS AND A WALL. Owner, 2026-09-07: *"match to schedule tab
     needs UI rework"*. On a freshly built BOQ every figure on it is legitimately 0 — `qtyLine()`
     requires `qty != null`, and nothing has been priced yet — so the screen reported a true state
     in a way that read as broken, under a four-line paragraph and a "Load schedule" button asking
     the planner to fetch data the tab cannot function without.
     ⚠️ ALLOCATION HAS A CHAIN OF FOUR PRECONDITIONS, and only one of them is ever the actual
     blocker at a given moment:
         measured lines  →  with quantities  →  with class codes  →  activities carrying those codes
     The rework names the FIRST unmet link and offers the button that fixes it, instead of
     presenting the whole apparatus and leaving the planner to work out which zero matters.
     ⚠️ The explanation moves behind a <details>. It is genuinely important (a class code is a tag,
     not a key) but it is a thing you read ONCE, and it was occupying the space where the answer
     to "what do I do now?" belongs. */
  function allocStage(lines, mapped) {
    if (!ACTS) return 'loading';
    // ⚠️ 'noqty' IS GONE as a blocking stage — see linkLine. What used to stop the tab dead now
    // stops nothing; a line with no quantity is listed and linkable, and the missing quantity is
    // reported per line instead of as a wall in front of the whole worklist.
    if (!lines.length) return 'nolines';
    if (!mapped.length) return 'nocodes';
    if (!ACTS.length) return 'nosched';
    if (!ACTS.filter(function (a) { return a.class_code; }).length) return 'notagged';
    return 'ready';
  }

  function allocHTML() {
    var lines = ITEMS.filter(linkLine);
    /* ⚠️ `codeFor`, not `CMAP[r.id]`. This count drives `allocStage`, which decides whether the
       tab says "map some lines first" or shows the worklist — so on a bill mapped at the
       HEADING (the shape `docs/boq-and-pmi.md` §3.3 recommends and the Class Codes tab already
       invites) it used to report zero mapped lines and send the planner back to a tab where
       the work was already done. */
    var mapped = lines.filter(function (r) { return codeFor(r); });
    var done = mapped.filter(function (r) { return allocOf(r.id).length; });
    // ⚠️ Over-allocation is only meaningful against a quantity that EXISTS. A line with none
    // cannot be over-allocated, and testing `> 0 + 1e-6` would have flagged every link on every
    // un-measured line as an over-allocation the moment this tab started listing them.
    var over = lines.filter(function (r) { return hasQty(r) && allocSum(allocOf(r.id)) > (Number(r.qty) || 0) + 1e-6; });
    var noQ = mapped.filter(function (r) { return !hasQty(r); });
    var linkedNoQ = noQ.filter(function (r) { return allocOf(r.id).length; });
    var coded = ACTS ? ACTS.filter(function (a) { return a.class_code; }).length : null;
    var stage = allocStage(lines, mapped);

    var h = '<div class="cc-kpis">' +
      kpi('Lines to match', lines.length, (lines.length - noQ.length) + ' carry a quantity to spread') +
      kpi('Mapped', mapped.length, 'have a class code to allocate along') +
      kpi('Allocated', done.length, (mapped.length - done.length) + ' still unallocated',
          mapped.length ? (done.length === mapped.length ? 'good' : 'warn') : '') +
      kpi('Over-allocated', over.length, 'Σ allocated exceeds the line qty', over.length ? 'bad' : '') +
      /* ⚠️ Activities CARRYING A CODE, not activities loaded. The raw count answers a question
         nobody has; what gates allocation is how many of them the allocator can actually reach. */
      kpi('Coded activities', ACTS ? coded : '—',
          ACTS ? 'of ' + ACTS.length + ' leaf activities' : 'loading the schedule…',
          ACTS && !coded ? 'warn' : '') +
      '</div>';

    if (over.length) {
      h += '<div class="boq-alert bad"><strong>' + over.length + ' line' + (over.length === 1 ? '' : 's') +
        ' allocate more quantity than the BOQ line carries.</strong> Silent over-allocation is a wrong S-curve — ' +
        'fix these before anything downstream reads the derived activity quantities.</div>';
    }
    // ⚠️ Stated as a fact, not as an obstacle. The links are real and useful; what they cannot do
    // yet is carry a quantity into the S-curve, and that is the sentence a planner needs.
    if (noQ.length) {
      h += '<div class="boq-alert"><strong>' + noQ.length + ' line' + (noQ.length === 1 ? '' : 's') +
        ' carry no quantity yet.</strong> You can still match ' + (noQ.length === 1 ? 'it' : 'them') +
        ' to activities — the link is stored on its own and contributes <b>0</b> to any derived quantity until ' +
        'the figure arrives. ' + (linkedNoQ.length ? linkedNoQ.length + ' of them ' + (linkedNoQ.length === 1 ? 'is' : 'are') +
        ' already linked. ' : '') + 'Fill in <b>Qty</b> on the Lines tab and the same dialog will spread it across ' +
        'the links already there.</div>';
    }

    /* ⚠️⚠️ THIS PARAGRAPH WAS ALSO WRONG, not merely long. Owner, 2026-09-10: *"is lengthy and wrap
       texts incorrectly."* It described **three** rungs — "location match first, then pro-rata by
       duration, then by hand" — which is the behaviour BEFORE the 2026-09-10 (z1) ladder. There are
       four, and pro-rata is now the LAST of them rather than the second. A caption that names the
       wrong order teaches the planner to distrust the Method column, which reports the real one.
       ⚠️ The old last sentence — "there is deliberately no quantity column on the activity" — is a
       SCHEMA decision, not something a planner acts on. It lives in `docs/vendor-performance-chain.md`
       and in the migration; it is off the screen, not lost.
       ⚠️ One idea per line, so it wraps at the line breaks the author chose instead of wherever a
       900px measure happens to land. `.boq-how p` is capped at 70ch for the same reason. */
    h += '<details class="boq-how"><summary>How matching works</summary>' +
      '<p>One class code is carried by <strong>many</strong> activities, so a line is spread ' +
      '<em>across</em> them — never attached to one.</p>' +
      '<p>The strongest rung that finds anything wins:<br>' +
      '<strong>location</strong> → <strong>WBS branch</strong> → <strong>name</strong> → ' +
      '<strong>class code alone</strong> (split pro-rata by duration).</p>' +
      '<p><strong>Nothing is saved until you press Apply.</strong></p></details>';

    if (stage !== 'ready') {
      var S = {
        loading:    ['Loading the schedule…',
                     'Reading this project\'s leaf activities and their class codes.', '', ''],
        nolines:    ['Nothing to match yet',
                     'Matching applies to <b>measured</b>, <b>lump sum</b> and <b>provisional</b> lines. This revision ' +
                     'has none of those — only headings, or lines marked <b>Excluded</b>. ' +
                     '<br><br>A quantity is <b>not</b> needed to match a line: link it to its activities now and the ' +
                     'quantities can follow.',
                     'Go to Lines', 'items'],
        /* ⚠️ THE BUTTON IS WITHHELD ON A MANUAL DRAFT, because the Class Codes tab is not on
           screen there — subsFor() shows only Lines and Match to schedule, since mapping a
           description onto a code is meaningless for a line the code was written FROM. Offering
           a button that sets `sub = 'codes'` would hit the fallback in render() and land the
           planner back on Lines, having apparently done nothing. And on a hand-built bill this
           stage means something different anyway: the codes should already be there, so their
           absence is a fault to report, not a step to go and do. */
        nocodes:    isManualDraft()
                    ? ['These lines carry no class code',
                       'Lines built from the class-code library carry their code from the start, so this should ' +
                       'not happen. Re-add the affected lines from <b>Add lines from class codes</b>; if it ' +
                       'persists, the class-map write is failing and the console will say why.', '', '']
                    : ['These lines carry no class code',
                       'A line is matched to activities <b>through its class code</b>. Imported lines are mapped ' +
                       'on the <b>Class Codes</b> tab, which proposes a code per description for you to accept.',
                       'Go to Class Codes', 'codes'],
        nosched:    ['This project has no schedule yet',
                     'Matching needs activities to spread the quantities across. Build the programme in <b>Schedule ' +
                     'Setup</b>, then come back — the BOQ waits, and nothing here is lost.', '', ''],
        notagged:   ['No schedule activity carries a class code',
                     'The activities exist but none is tagged, so there is nothing for a line to match against. ' +
                     '<b>Tag schedule activities</b> writes the codes onto them in bulk — one code, many activities.',
                     'Tag schedule activities…', 'tag']
      }[stage];
      h += '<div class="pd-card cc-empty boq-stage">' +
        (stage === 'loading' ? '<h3><span class="cc-spin"></span>' : '<h3>') + esc(S[0]) + '</h3>' +
        '<p>' + S[1] + '</p>' +
        (S[2] && canWrite ? '<p style="margin-top:14px;"><button class="pd-btn pd-btn-primary" ' +
          'data-stage-go="' + S[3] + '">' + esc(S[2]) + '</button></p>' : '') +
        '</div>';
      return h;
    }

    h += '<div class="boq-filters">' +
      '<input class="pd-input" id="boq-a-q" placeholder="Search lines…" value="' + esc(filt.q) + '" />' +
      (canWrite ? '<button class="pd-btn" id="boq-a-auto">Propose splits for all unallocated…</button>' : '') +
      (canWrite ? '<button class="pd-btn" id="boq-a-tag" title="Give schedule activities these class codes">Tag schedule activities…</button>' : '') +
      '</div>';

    h += '<div class="pd-card cc-tablecard"><table class="cc-table boq-table"><thead><tr>' +
      '<th class="cc-desc">Line</th><th>Class code</th><th class="cc-r">BOQ qty</th>' +
      '<th class="cc-r">Allocated</th><th class="cc-r">Remainder</th><th class="cc-r">Activities</th><th>Method</th>' +
      (canWrite ? '<th class="cc-actcol"></th>' : '') + '</tr></thead><tbody>';
    var list = mapped.filter(function (r) { return !filt.q || normKey([r.item_no, r.description].join(' ')).indexOf(normKey(filt.q)) >= 0; });
    // Unallocated first — this table IS the worklist.
    list.sort(function (a, b) { return allocOf(a.id).length - allocOf(b.id).length; });
    /* ⚠️ Reached only when the stage chain says everything is ready, so an empty list here can
       ONLY be the search box — saying "map class codes first" would have been a lie at this point,
       and it was what this said. */
    if (!list.length) h += '<tr><td colspan="8" class="cc-mut" style="text-align:center;padding:30px;">' +
      'No line matches “' + esc(filt.q) + '”. Clear the search to see the worklist.</td></tr>';
    list.slice(0, 300).forEach(function (r) {
      var al = allocOf(r.id), s = allocSum(al), qOn = hasQty(r), q = Number(r.qty) || 0, rem = q - s;
      h += '<tr data-id="' + esc(r.id) + '">' +
        '<td class="cc-desc"><div class="cc-desc-txt">' + esc(r.description || '') + '</div>' +
          '<div class="cc-mini">' + esc(r.sheet) + ' · row ' + r.source_row + ' · ' + esc(r.unit || '') +
          (qOn ? '' : ' · <b>no qty yet</b>') + '</div></td>' +
        /* ⚠️⚠️ `codeFor`, and it is a CRASH FIX as well as a feature. This read was
           `CMAP[r.id].class_code` with no guard — safe only while the list above it filtered on
           that same direct map. The moment a heading-mapped leaf reached this row it would have
           thrown on `undefined.class_code` and taken the whole worklist with it.
           ⚠️ An inherited code says so on the chip rather than passing itself off as the line's
           own: which line carries the mapping is exactly what a planner needs to know to change it. */
        '<td>' + (function () {
          var cf = codeFor(r); if (!cf) return '<span class="cc-mut">—</span>';
          return '<span class="boq-code"' + (cf.from ? ' title="inherited from heading ' +
                   esc(cf.from.item_no || cf.from.description || '') + '"' : '') + '>' +
                 esc(cf.class_code) + '</span>' +
                 (cf.from ? ' <span class="cc-mini">inherited</span>' : '');
        })() + '</td>' +
        // ⚠️ An em dash, not 0. A qty-less line showing "0" allocated "0" with "0" remaining reads
        // as a finished line, which is the opposite of what it is.
        '<td class="cc-r">' + (qOn ? qtyStr(q) : '<span class="cc-mut">—</span>') + '</td>' +
        '<td class="cc-r">' + (qOn ? qtyStr(s) : (al.length ? '<span class="cc-mut">linked</span>' : '<span class="cc-mut">—</span>')) + '</td>' +
        '<td class="cc-r' + (qOn && rem < -1e-6 ? ' boq-bad' : '') + '">' + (qOn ? qtyStr(rem) : '<span class="cc-mut">—</span>') + '</td>' +
        /* ⚠️ "0" answered three different questions identically: not tried yet, tried and nothing
           matched, and "this trade is not in the schedule at all". Only the last is not a worklist
           item, and it was the majority of the owner's 122. The count is kept for the linked rows;
           the rest say which case they are in. */
        '<td class="cc-r">' + (function () {
          var st = lineLinkState(r);
          /* ⚠️ Checked BEFORE the count, because a project-scoped line HAS an allocation and would
             otherwise read "1" — a number that means "one activity", which is the one thing it is
             not. */
          if (st.kind === 'project') return '<span class="boq-why" title="Allocated to the project ' +
            'as a whole — a preliminary. Its cost is spread across the programme pro-rata by ' +
            'duration.">project-wide</span>';
          if (al.length) return String(al.length);
          if (st.kind === 'nocode') return '<span class="cc-mut">no code</span>';
          if (st.kind === 'ready') return '<span class="boq-why" title="' + st.n +
            ' activit' + (st.n === 1 ? 'y carries' : 'ies carry') + ' this class code — press ' +
            (qOn ? 'Allocate' : 'Link') + '">' + st.n + ' ready</span>';
          if (st.notInSchedule) return '<span class="cc-mut boq-prelim" title="No activity on this ' +
            'project carries a code in ' + esc(st.trade) + ' — that trade is not on the programme at ' +
            'all. Normal for preliminaries (mobilisation, site offices, plant hire), which are not ' +
            'scheduled work.">not scheduled</span>';
          return '<span class="cc-mut" title="' + st.inTrade + ' activit' +
            (st.inTrade === 1 ? 'y is' : 'ies are') + ' in ' + esc(st.trade) + ', but none carries ' +
            'this line’s code. Tag more of the schedule, or link by hand.">0</span>';
        })() + '</td>' +
        /* ⚠️ The RUNG is what a planner needs here — "location" answers "can I trust this?" in a
           way "prorata" does not. Falls back to the split method on rows written before
           2026-09-10-boq-match-rung.sql, where `matched_by` is legitimately null. */
        '<td>' + (al.length
          ? '<span class="boq-why">' + esc(al[0].matched_by || al[0].method || '') + '</span>'
          : '') + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-split="' + esc(r.id) + '">' + (qOn ? 'Allocate…' : 'Link…') + '</button></td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  var _actsLoading = false;
  function wireAlloc(host) {
    /* ⚠️⚠️ THE SCHEDULE LOADS ITSELF. It was behind a "Load schedule" button, which asked the
       planner to fetch the data the tab cannot do anything without — the answer is always yes, so
       the question was pure friction. `ensureActs()` is already leaf-only and column-limited for
       exactly this reason. ⚠️ `_actsLoading` guards the re-render: ensureActs() → render() →
       wireAlloc() would otherwise start a second fetch while the first is in flight, and on a
       40k-row project that is two large reads racing each other. */
    if (!ACTS && !_actsLoading) {
      _actsLoading = true;
      ensureActs().then(function () { _actsLoading = false; if (sub === 'alloc') render(); })
                  .catch(function () { _actsLoading = false; });
    }
    host.querySelectorAll('[data-stage-go]').forEach(function (b) {
      b.onclick = function () {
        var to = b.dataset.stageGo;
        if (to === 'tag') { openTagActivities(); return; }
        sub = to; render();
      };
    });
    var q = host.querySelector('#boq-a-q'), t = null;
    if (q) q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { filt.q = q.value; render(); }, 200); });
    host.querySelectorAll('[data-split]').forEach(function (b) { b.onclick = function () { openSplit(b.dataset.split); }; });
    var au = host.querySelector('#boq-a-auto'); if (au) au.onclick = bulkPropose;
    var tg2 = host.querySelector('#boq-a-tag'); if (tg2) tg2.onclick = openTagActivities;
  }

  function openSplit(itemId) {
    var r = ITEMS.find(function (x) { return x.id === itemId; });
    if (!r) return;
    var scored = scoreCandidates(r);
    var acts = scored.list.map(function (x) { return x.act; });
    var existing = allocOf(r.id);
    /* ⚠️ A STORED allocation shows the rung it was SAVED with (`matched_by`), not the rung the
       matcher would pick today. The row is a record of a decision, and re-deriving its reason
       from current data would relabel a planner's hand-made link as whatever the heuristic now
       thinks — the audit trail `boq_allocations` exists for. */
    var prop = existing.length
      ? { method: existing[0].method, rung: null, scored: scored, parts: existing.map(function (a) {
          var ac = acts.find(function (x) { return x.activity_id === a.activity_id; });
          return { activity_id: a.activity_id, name: ac ? ac.activity_name : '', qty: Number(a.qty),
                   rung: a.matched_by || null, why: null }; }) }
      : proposeSplit(r, scored);

    var qOn = hasQty(r);
    /* B · SCOPE. A line is allocated ACROSS ACTIVITIES or to the PROJECT AS A WHOLE
       (migrations/2026-09-10-boq-project-scope.sql). The second is what preliminaries need:
       mobilisation, site offices, plant hire are time-related costs that belong to no activity,
       and until now the only way to record one was to attach it to an activity it does not belong
       to - which flows into planned_cost, the S-curve and Cash Flow as a fact.
       Seeded from what is already stored, so re-opening a project-scoped line shows it as one. */
    var projScope = existing.length
      ? existing.some(function (a) { return String(a.scope || 'activity') === 'project'; })
      : false;
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' +
      (qOn ? 'Allocate quantity' : 'Link to activities') + '</h2>' +
      '<button class="pd-modal-close" id="sp-x">&times;</button></div>' +
      '<div class="boq-split" id="sp-body"></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="sp-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="sp-go">Apply</button></div>');
    var body = m.el.querySelector('#sp-body');

    function paint() {
      var q = Number(r.qty) || 0, s = prop.parts.reduce(function (a, p) { return a + (Number(p.qty) || 0); }, 0);
      var rem = q - s;
      var cf = codeFor(r), cfc = cf ? cf.class_code : '';
      body.innerHTML =
        '<p class="cc-hint"><strong>' + esc(r.description || '') + '</strong><br>' +
        esc(r.sheet) + ' row ' + r.source_row + ' · ' + qtyStr(q) + ' ' + esc(r.unit || '') +
        ' · class code <code>' + esc(cfc) + '</code>' +
        (cf && cf.from ? ' <span class="cc-mini">inherited from heading ' +
          esc(cf.from.item_no || cf.from.description || '') + '</span>' : '') + '</p>' +
        /* The choice sits ABOVE everything, because it decides what the rest of the dialog even
           means - a parts table under a project-scoped line would be answering a question that no
           longer applies. */
        '<div class="boq-scope">' +
          '<label class="boq-scopeopt' + (projScope ? '' : ' on') + '">' +
            '<input type="radio" name="sp-scope" value="activity"' + (projScope ? '' : ' checked') + '>' +
            '<span><strong>Across activities</strong><br><span class="cc-mini">The work is on the ' +
            'programme. Its quantity and money follow the activities it covers.</span></span></label>' +
          '<label class="boq-scopeopt' + (projScope ? ' on' : '') + '">' +
            '<input type="radio" name="sp-scope" value="project"' + (projScope ? ' checked' : '') + '>' +
            '<span><strong>The project as a whole</strong><br><span class="cc-mini">A preliminary — ' +
            'mobilisation, site office, plant hire. It belongs to no single activity, and its cost ' +
            'is spread across the programme pro-rata by duration.</span></span></label>' +
        '</div>' +
        /* ⚠️ The RUNG is named, not just the split arithmetic. "Proposed by location match" and
           "proposed by prorata" are the difference between a figure a planner can accept at a
           glance and one they must check — and until now the screen only ever said the latter. */
        (prop.rung ? '<p class="cc-hint">Matched on <strong>' + esc(RUNG_LABEL[prop.rung] || prop.rung) + '</strong>' +
          (prop.method === 'location' ? ', split equally' : ', split pro-rata by duration') + '. ' +
          'Adjust any figure, then Apply. Nothing is stored until you do.</p>' : '') +
        (qOn ? '' : '<p class="cc-hint">Add the activities this line covers. <b>Qty can stay 0</b> — you are recording ' +
          'scope, not measurement, and the link is kept either way.</p>') +
        (acts.length ? '' : '<div class="boq-alert warn">No activity on this project carries class code <code>' +
          esc(cfc) + '</code>. Allocate by hand, or tag the activities first.</div>') +
        '<table class="boq-splittab"><thead><tr><th>Activity</th><th class="cc-r">Qty</th><th></th></tr></thead><tbody>' +
        prop.parts.map(function (p, i) {
          return '<tr><td><code>' + esc(p.activity_id) + '</code> <span class="cc-mini">' + esc(p.name || '') + '</span>' +
            // ⚠️ Every proposed row says which rung found it. A bare list of activities is
            //    unauditable: "at 3rd Floor" and "2 of 3 item words" deserve different trust.
            (p.why ? ' <span class="boq-why">' + esc(p.why) + '</span>' : '') + '</td>' +
            /* ⚠️⚠️ `type="text"`, NEVER `type="number"`. This is the documented data-loss trap and
               it was live in this dialog: `input[type=number].value` returns "" for anything the
               spec cannot parse — `1,000`, `1,397,462,269.86`, `₱1,200.50` — and the handler below
               did `Number(inp.value) || 0`, so typing a quantity with thousands separators wrote a
               silent ZERO into an allocation. `boq.js` fixed exactly this for the Lines grid in
               August (see the column spec's note) and the allocator was never brought across. */
            '<td class="cc-r"><input class="pd-input boq-qin" type="text" inputmode="decimal" data-i="' + i + '" value="' + esc(p.qty) + '" /></td>' +
            '<td><button class="pd-btn" data-rm="' + i + '" title="Remove">&times;</button></td></tr>';
        }).join('') +
        '</tbody></table>' +
        /* ⚠️⚠️ THIS WAS A RAW `<select>` OF `ACTS.slice(0, 800)`, AND ON A REAL PROJECT IT COULD NOT
           REACH MOST OF THE SCHEDULE. Owner, 2026-09-10, on OPW101 (2,561 activities): *"Right now
           the linking is still not easy."* Measured: **1,761 activities — 69% — were not in the list
           at all**, it had no search, no grouping, no order anyone could predict, and `onchange`
           added exactly ONE activity per interaction. Linking a line to a floor's worth of work was
           forty passes through a list that could not reach two thirds of the project.
           ⚠️ It is replaced by `CCAffected`'s ladder + WBS tree + search — the SAME picker the change
           order wizard uses, with its change-order preview suppressed. That component already
           answers this exact question ("which activities does this cover?"), is already verified,
           and lets a place or a whole branch be taken in one click. Building a second one here is
           the drift this module has already paid for twice. */
        (projScope
          /* Everything below answers "which activities", which is the question project scope
             removes. Replaced by what the choice MEANS, in the terms the planner will see it in
             again on the schedule's Cost Loading tab. */
          ? '<p class="cc-hint boq-projnote">This line is allocated to <strong>the project</strong>. ' +
            'It names no activity, and its ' + (qOn ? 'quantity stays with the line while its ' : '') +
            'cost is spread across the programme <strong>pro-rata by duration</strong> — so it ' +
            'reaches the cost-loaded S-curve without being attributed to work it does not belong to. ' +
            'Project Schedule → Cost Loading names the total.</p>'
          : '') +
        (projScope ? '' :
        '<div class="boq-splitadd">' +
          (window.CCAffected
            ? '<button class="pd-btn pd-btn-primary" id="sp-pick">Choose activities…</button>' +
              '<span class="cc-mini">Search, or take a whole place or WBS branch at once</span>'
            : '<span class="cc-mini">The activity picker did not load — reload the page to link by hand.</span>') +
        '</div>') +
        // ⚠️ The remainder is always shown, both ways. Silent over-allocation is
        // a wrong S-curve, and a silent shortfall is work nobody has planned.
        // ⚠️ A line with no quantity must NOT report "reconciles exactly": 0 of 0 satisfies the
        // arithmetic and says the opposite of the truth, which is that nothing has been measured
        // yet. It reports what it actually is — a link, and what will happen when the figure lands.
        (qOn
          ? '<p class="boq-recon ' + (Math.abs(rem) < 1e-6 ? 'ok' : rem < 0 ? 'bad' : 'warn') + '">' +
            'Allocated ' + qtyStr(s) + ' of ' + qtyStr(q) + ' — ' +
            (Math.abs(rem) < 1e-6 ? 'reconciles exactly.' : rem > 0 ? qtyStr(rem) + ' ' + esc(r.unit || '') + ' still unallocated.' :
              '<strong>over-allocated by ' + qtyStr(-rem) + '</strong>.') + '</p>'
          : '<p class="boq-recon warn">This line carries <strong>no quantity</strong> yet, so this stores the ' +
            '<strong>link only</strong> — ' + prop.parts.length + ' activit' + (prop.parts.length === 1 ? 'y' : 'ies') +
            ', each contributing 0 to any derived quantity. Enter <b>Qty</b> on the Lines tab and come back here to ' +
            'spread it across these same activities.</p>');

      body.querySelectorAll('.boq-qin').forEach(function (inp) {
        /* ⚠️ `numOf`, not `Number()` — the field is now text, so it can carry "1,000" and this is
           the parser that already understands the shapes a planner types. `|| 0` stays: an
           allocation part is `not null default 0` and a cleared box means "link, no quantity".
           ⚠️ The edited part loses its rung: it is a hand figure now, not a proposal. */
        inp.onchange = function () {
          var p = prop.parts[+inp.dataset.i];
          p.qty = numOf(inp.value) || 0; p.rung = null; p.why = null;
          prop.method = 'manual'; prop.rung = null; paint();
        };
      });
      body.querySelectorAll('[data-rm]').forEach(function (b) {
        b.onclick = function () { prop.parts.splice(+b.dataset.rm, 1); prop.method = 'manual'; prop.rung = null; paint(); };
      });
      var pk = body.querySelector('#sp-pick');
      if (pk) pk.onclick = openPicker;
      body.querySelectorAll('input[name="sp-scope"]').forEach(function (rd) {
        rd.onchange = function () {
          projScope = rd.value === 'project';
          /* The two shapes cannot coexist — the database refuses a line holding both (the trigger
             in 2026-09-10-boq-project-scope.sql), and more importantly the same money would be in
             the per-activity map AND the project-wide spread. Switching TO project drops the parts;
             switching back leaves none, which is the honest starting point for re-picking. */
          prop.parts = [];
          prop.method = 'manual'; prop.rung = null;
          paint();
        };
      });
    }

    /* The picker takes over the dialog body rather than opening a modal on top of it — a modal
       over a modal is the trap this file already records: the planner ends up clicking a pane they
       cannot reach. ⚠️ The dialog also widens while picking (`boq-wide`), because a ladder plus a
       WBS tree inside `.pd-modal`'s 520px is the ~200px squeeze `.boq-wide` was added to fix, and
       narrows back on return so the quantity table keeps its own proportions. */
    async function openPicker() {
      var modal = m.el.querySelector('.pd-modal');
      modal.classList.add('boq-wide');
      body.innerHTML = '<p class="cc-hint" style="margin-top:0;">Pick the activities <strong>' +
        esc(r.description || '') + '</strong> covers. Ticking a place or a branch takes all of it.</p>' +
        window.CCAffected.pickerHTML();
      var foot = m.el.querySelector('.pd-modal-footer');
      var footWas = foot.innerHTML;
      foot.innerHTML = '<button class="pd-btn" id="sp-pcancel">Back</button>' +
        '<span style="flex:1;"></span>' +
        '<button class="pd-btn pd-btn-primary" id="sp-puse">Use <span id="sp-pn">0</span> activit<span id="sp-pys">ies</span></button>';

      var handle = null;
      function done(commit) {
        modal.classList.remove('boq-wide');
        foot.innerHTML = footWas;
        /* ⚠️ The footer's own handlers died with its innerHTML, so they are re-bound. Missing this
           leaves Cancel and Apply inert — the dialog looks fine and does nothing. */
        m.el.querySelector('#sp-cancel').onclick = m.close;
        m.el.querySelector('#sp-go').onclick = applyAlloc;
        if (commit && handle) mergePicked(handle.ids());
        paint();
      }
      foot.querySelector('#sp-pcancel').onclick = function () { done(false); };
      foot.querySelector('#sp-puse').onclick = function () { done(true); };

      try {
        /* ⚠️ Defensive, and free: `setProject` returns immediately when the id is unchanged, so
           this costs nothing on the normal path and guarantees the picker cannot offer ANOTHER
           project's activities if the BOQ was ever reached without module.js's own call running.
           A picker showing the wrong project's schedule is the exact failure that comment guards. */
        window.CCAffected.setProject(pid);
        handle = await window.CCAffected.mount(body, {
          /* ⚠️ The selection STARTS from what is already on the line, so opening the picker to add
             one activity cannot silently drop the nine already there. */
          initial: prop.parts.map(function (p) { return p.activity_id; }),
          preview: false,
          onCount: function (n) {
            var el = m.el.querySelector('#sp-pn'), ys = m.el.querySelector('#sp-pys');
            if (el) el.textContent = String(n);
            if (ys) ys.textContent = n === 1 ? 'y' : 'ies';
          }
        });
      } catch (e) {
        body.innerHTML = '<p class="cc-hint">The schedule could not be read — ' + esc(e && e.message || e) + '</p>';
      }
    }

    function mergePicked(ids) {
      prop.parts = mergePickedParts(prop.parts, ids, Number(r.qty) || 0, ACTS || []);
      /* ⚠️ Hand-picking retires the proposal's rung: the split is the planner's now, and leaving
         "proposed by location match" on it would credit the matcher for a human decision — the
         audit distinction `matched_by` exists for. */
      prop.method = 'manual'; prop.rung = null;
    }
    paint();
    m.el.querySelector('#sp-x').onclick = m.close;
    m.el.querySelector('#sp-cancel').onclick = m.close;
    m.el.querySelector('#sp-go').onclick = applyAlloc;
    /* ⚠️ NAMED, because the picker replaces the modal footer wholesale and has to put this handler
       back. An inline function here would be unreachable from there, and the re-bound Apply button
       would look right and do nothing. */
    async function applyAlloc() {
      // ⚠️⚠️ WAS `p.activity_id && Number(p.qty)` — which DISCARDED every zero-quantity part, so a
      // link recorded before the line was measured vanished on Apply with a success toast. That is
      // the second half of the owner's 2026-09-07 ask, and it was the half that lost data: the
      // dialog would have listed the activities, the planner would have pressed Apply, and nothing
      // would have been stored. A part now needs only an ACTIVITY — qty 0 is a link awaiting its
      // quantity, which is a decision worth keeping.
      /* ⚠️ ONE ROW, no activity, carrying the whole line. The quantity is NOT divided — there is
         nothing to divide it across — and `boqDerive` reads the line's own amount rather than this
         qty, so it is stored for completeness and never used as a weight. */
      var parts = projScope
        ? [{ activity_id: null, scope: 'project', qty: Number(r.qty) || 0 }]
        : prop.parts.filter(function (p) { return p.activity_id; });
      // Replace-then-insert: an allocation set is one decision, so a partial
      // overwrite would leave a mixture of two planners' splits on one line.
      var del = await sb().from(T_ALLOC).delete().eq('boq_item_id', r.id);
      if (del.error) { UI.toast(del.error.message, 'error'); return; }
      if (parts.length) {
        /* ⚠️ A part the planner ADDED or RETYPED carries no rung — `manual` is the honest label,
           and it must not inherit the rung of the proposal it was edited out of. `prop.method`
           is already reset to 'manual' by every edit handler for the same reason. */
        var ins = await upsertAllocs(parts.map(function (p) {
          return { project_id: pid, boq_item_id: r.id, activity_id: p.activity_id,
                   scope: p.scope || 'activity',
                   qty: Number(p.qty), method: prop.method || 'manual', accepted_by: UID,
                   matched_by: (prop.method === 'manual' ? 'manual' : (p.rung || null)),
                   match_score: (prop.method === 'manual' ? null : (RUNG_SCORE[p.rung] || null)) };
        }));
        if (!ins.ok) { UI.toast(ins.msg, 'error'); return; }
      }
      m.close();
      ALLOC = ALLOC.filter(function (a) { return a.boq_item_id !== r.id; })
        /* ⚠️ `scope` is mirrored, or the worklist would repaint the line as an ordinary activity
           allocation until the next full load — the screen disagreeing with what was just saved. */
        .concat(parts.map(function (p) { return { boq_item_id: r.id, activity_id: p.activity_id, scope: p.scope || 'activity', qty: Number(p.qty), method: prop.method || 'manual', project_id: pid }; }));
      UI.toast('Allocation applied.', 'success'); render();
    }
  }

  /* Bulk propose. ⚠️ Still propose → preview → APPLY: it shows what it would
     write and how many lines it cannot resolve, and writes nothing until the
     planner accepts. */
  /* ==========================================================================
     PASS C's PLAN — every unallocated, coded, measured line, split on its strongest rung.
     ==========================================================================
     ⚠️ Lifted alongside `planCodeMap` / `planTags` so the whole-BOQ run proposes exactly what
     this button proposes. Returns the counts the preview needs as well as the plans, because
     "how many cannot, and why" is the half a planner acts on. */
  function planAllocs() {
    // ⚠️ `codeFor`, not `CMAP[r.id]` — a leaf whose HEADING carries the code is allocatable now,
    //    and it was this filter that kept those lines out of the bulk run entirely.
    var todo = ITEMS.filter(function (r) { return qtyLine(r) && codeFor(r) && !allocOf(r.id).length; });
    var plans = todo.map(function (r) { return { r: r, p: proposeSplit(r, scoreCandidates(r)) }; });
    var ok = plans.filter(function (x) { return x.p.parts.length; });
    var byRung = {};
    ok.forEach(function (x) { byRung[x.p.rung] = (byRung[x.p.rung] || 0) + 1; });
    return { todo: plans.length, ok: ok, none: plans.length - ok.length, byRung: byRung };
  }

  /* The write half of pass C — one upsert for the whole run, not one per line.
     ⚠️ The RUNG and the split METHOD are recorded on every part, so a later audit can tell a
     proposal from a hand-made decision. */
  async function applyAllocPlans(ok) {
    var payload = [];
    ok.forEach(function (x) {
      x.p.parts.forEach(function (p) {
        payload.push({ project_id: pid, boq_item_id: x.r.id, activity_id: p.activity_id,
                       qty: Number(p.qty), method: x.p.method, accepted_by: UID,
                       matched_by: p.rung || null, match_score: RUNG_SCORE[p.rung] || null });
      });
    });
    return await upsertAllocs(payload);
  }

  /* ⚠️⚠️ WHY PASS C FOUND NOTHING — the message a planner can act on.
     `candidatesFor()` needs the ACTIVITY to already carry the line's class code, so on a schedule
     nobody has tagged, EVERY line reports "cannot" and the screen used to give no hint that the
     fix is one button on the previous tab. Distinguish the two cases by measurement: no activity
     tagged at all is a missing PREREQUISITE; some tagged but not these is a genuine mismatch. */
  function allocBlockReason() {
    var tagged = (ACTS || []).filter(function (a) { return a.class_code; }).length;
    var total = (ACTS || []).length;
    if (!total) return { kind: 'noacts', tagged: 0, total: 0 };
    if (!tagged) return { kind: 'untagged', tagged: 0, total: total };
    return { kind: 'mismatch', tagged: tagged, total: total };
  }

  /* ==========================================================================
     WHY A LINE HAS NOTHING TO LINK TO — measured per TRADE, not guessed from its name
     ==========================================================================
     ⚠️⚠️ Owner, 2026-09-10, on OPW101: 122 General Requirement lines, every one coded, against a
     schedule whose 2,561 activities are every one coded — and **zero** candidates for all 122. The
     screen said "0 activities" and left it there, which reads as 122 failures.

     It is not a failure. Mobilization, Demobilization, Rental of Skidloader, Barracks, Site Office
     are TIME-RELATED PRELIMINARIES — a structural programme has no activity called "Rental of Flat
     Bed Truck", and inventing a link to one would push a fabricated relationship into
     `planned_cost` → the S-curve → Cash Flow.

     ⚠️ So the distinction is DERIVED, never taken from the trade's name. A hard-coded
     "General Requirement" list would be a guess about Finance's chart and would rot the first time
     it was revised. Instead: does ANY activity on this project carry a code belonging to this
     line's trade? If the whole trade is absent from the schedule, that is a measurement, and it is
     the thing worth telling the planner. */
  var _tradeActs = null;
  function tradeActivityCounts() {
    if (_tradeActs) return _tradeActs;
    var byCode = {};
    (CODES || []).forEach(function (c) { if (c && c.code) byCode[String(c.code).trim()] = c; });
    var out = {};
    (ACTS || []).forEach(function (a) {
      var c = byCode[String(a.class_code || '').trim()];
      var t = c && c.desc_l1 ? String(c.desc_l1).trim() : '';
      if (t) out[t] = (out[t] || 0) + 1;
    });
    _tradeActs = out;
    return out;
  }
  /* ⚠️ Cleared wherever the two inputs change — a stale count would report a trade as absent from a
     schedule that has just been tagged, which is the opposite of helpful. */
  function clearTradeActs() { _tradeActs = null; }

  /* ⚠️⚠️ THE MERGE IS BY ACTIVITY, AND AN EXISTING PART KEEPS ITS QUANTITY. The picker answers
     "which activities", never "how much" — so re-opening it to add one more activity must not reset
     the nine figures the planner already typed. Newly-picked parts take an equal share of whatever
     is still unallocated; on a line with no quantity that is 0, which is exactly the link-only case
     the 2026-09-07 change made storable.
     ⚠️ Pure and at module scope so the invariant above is executable rather than asserted in prose.
     De-selecting in the picker DOES drop a part — that is the planner saying "not this one". */
  function mergePickedParts(parts, ids, qty, acts) {
    var keep = {}; (ids || []).forEach(function (i) { keep[String(i)] = 1; });
    var kept = (parts || []).filter(function (p) { return keep[String(p.activity_id)]; });
    var have = {}; kept.forEach(function (p) { have[String(p.activity_id)] = 1; });
    var added = (ids || []).filter(function (i) { return !have[String(i)]; });
    var used = kept.reduce(function (a, p) { return a + (Number(p.qty) || 0); }, 0);
    var each = added.length ? Math.max(0, (Number(qty) || 0) - used) / added.length : 0;
    added.forEach(function (aid) {
      var a = (acts || []).find(function (x) { return String(x.activity_id) === String(aid); });
      kept.push({ activity_id: aid, name: a ? a.activity_name : '',
                  qty: Math.round(each * 100) / 100, rung: null, why: null });
    });
    return kept;
  }

  function lineLinkState(r) {
    var al0 = allocOf(r.id);
    if (al0.length) {
      return al0.some(function (a) { return String(a.scope || 'activity') === 'project'; })
        ? { kind: 'project' } : { kind: 'linked' };
    }
    var cf = codeFor(r);
    if (!cf) return { kind: 'nocode' };
    if (candidatesFor(r).length) return { kind: 'ready', n: candidatesFor(r).length };
    var row = codeRow(cf.class_code);
    var trade = row && row.desc_l1 ? String(row.desc_l1).trim() : '';
    var counts = tradeActivityCounts();
    var inTrade = trade ? (counts[trade] || 0) : 0;
    /* ⚠️ `notInSchedule` is the measured claim — nothing in this trade is on the programme at all.
       It is stated as a fact about the schedule, and the preliminaries reading is offered as the
       usual EXPLANATION rather than asserted as the cause. The planner knows which it is. */
    return { kind: 'nocand', trade: trade, inTrade: inTrade, notInSchedule: !!trade && inTrade === 0 };
  }

  async function bulkPropose() {
    await ensureActs();
    await ensureLocMatch();
    var pl = planAllocs();
    var ok = pl.ok, none = pl.none, byRung = pl.byRung;
    var m = UI.modal('<h2 style="margin-top:0;">Propose allocations</h2>' +
      '<p class="cc-hint">' + pl.todo + ' unallocated mapped line(s). <strong>' + ok.length + '</strong> can be split, ' +
      'each on the strongest rung that found it:</p>' +
      '<ul class="cc-hint" style="margin-top:0;">' +
      RUNG_ORDER.map(function (k) {
        return byRung[k] ? '<li><strong>' + byRung[k] + '</strong> by ' + RUNG_LABEL[k] + '</li>' : '';
      }).join('') + '</ul>' +
      /* ⚠️ The reason is MEASURED, not a fixed sentence. "No activity carries their class code" is
         true either way, but on an untagged schedule it is a missing prerequisite with a button
         attached, and saying only the general form is what made this a dead end. */
      (function () {
        if (!none) return '';
        var why = allocBlockReason();
        if (why.kind === 'untagged') {
          return '<p class="cc-hint boq-blocked"><strong>' + none + '</strong> cannot — and the reason is the ' +
            'same for all of them: <strong>not one of this project\'s ' + why.total + ' activities carries a class ' +
            'code yet</strong>, so there is nothing for a line to attach to. Tag the schedule first — it is one ' +
            'bulk run on the Class Codes tab.</p>' +
            '<p style="margin:6px 0 0;"><button class="pd-btn" id="bp-tag">Tag schedule activities…</button></p>';
        }
        if (why.kind === 'noacts') {
          return '<p class="cc-hint boq-blocked"><strong>' + none + '</strong> cannot — this project has no ' +
            'schedule activities loaded, so there is nothing to allocate to.</p>';
        }
        return '<p class="cc-hint"><strong>' + none + '</strong> cannot — no activity carries their class code ' +
          '(' + why.tagged + ' of ' + why.total + ' activities are tagged), so they stay unallocated rather than ' +
          'being spread over something arbitrary. Tagging more of the schedule is what brings them in.</p>';
      })() +
      /* ⚠️ Says the quiet part out loud, because it is the change that moves money: a line
         matched on location takes ONLY the activities at that location, where it used to take
         every activity sharing the code and smear the quantity across them by duration. */
      '<p class="cc-hint">A line matched on a place takes <strong>only the activities in that place</strong>, split ' +
      'equally — never every activity sharing the code. Applying records the rung and the split method, so a later ' +
      'audit can tell a proposal from a hand-made decision.</p>' +
      '<div style="text-align:right;margin-top:12px;"><button class="pd-btn" id="bp-x">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="bp-go"' + (ok.length ? '' : ' disabled') + '>Apply ' + ok.length + ' split(s)</button></div>');
    m.el.querySelector('#bp-x').onclick = m.close;
    /* ⚠️ Closes this modal BEFORE opening the tag dialog — that one is a modal too, and stacking
       it under this overlay leaves the planner clicking a pane they cannot reach. Same rule the
       wizard's own hand-off follows. */
    var bt = m.el.querySelector('#bp-tag');
    if (bt) bt.onclick = function () { m.close(); openTagActivities(); };
    m.el.querySelector('#bp-go').onclick = async function () {
      m.close();
      var wrote = await applyAllocPlans(ok);
      if (!wrote.ok) { UI.toast(wrote.msg, 'error'); return; }
      UI.toast('Applied ' + ok.length + ' allocation(s).' + (wrote.dropped ? ' ' + wrote.dropped : ''), 'success');
      await load();
    };
  }


  // ==========================================================================
  // MATCH THE WHOLE BOQ TO THE SCHEDULE — the three passes as one action
  // ==========================================================================
  /* Owner, 2026-09-10: *"How would the planner easily batch the BOQ to the activities in the
     schedule?"* Every engine for it already existed, in three places, in a load-bearing order
     that was written down nowhere on screen:

       A · map BOQ lines to class codes      (Class Codes tab → Propose codes → Accept all)
       B · tag schedule activities with them (Class Codes tab → Tag schedule activities…)
       C · allocate the lines to activities  (Match to schedule tab → Propose splits…)

     ⚠️⚠️ B IS A HARD PREREQUISITE FOR C and nothing said so. `candidatesFor()` returns nothing
     unless the ACTIVITY already carries the line's code, so on an untagged schedule pass C
     reports "0 can be split" — accurate, and a dead end. This runs the three in order behind ONE
     preview.

     ⚠️ It adds NO matching logic. Every number below comes from `planCodeMap` / `planTags` /
     `planAllocs`, the same planners the three buttons use, so this preview and those dialogs
     cannot disagree about the same project. */

  /* ⚠️⚠️ THE PREVIEW IS EXACT, NOT AN ESTIMATE — and that is only possible because the three
     planners are SYNCHRONOUS and PURE over module state. B's plan depends on what A would write
     and C's on what B would write, so a preview computed against today's state would be wrong
     about two of the three passes. Instead the overlays are applied in memory, the planners are
     run, and the state is restored in `finally`. Nothing is written and nothing can interleave.
     ⚠️ The overlays COPY — `CMAP` gets a fresh object and each tagged activity a fresh row —
     because mutating the real `ACTS` entries would leave the module quietly holding codes that
     are not in the database if any of this threw. */
  function matchAllDryRun(minConf) {
    var snapCmap = CMAP, snapActs = ACTS;
    try {
      var a = planCodeMap().filter(function (x) { return x.s.confidence >= minConf; });
      CMAP = Object.assign({}, CMAP);
      a.forEach(function (x) {
        CMAP[x.r.id] = { boq_item_id: x.r.id, class_code: x.s.code, confidence: x.s.confidence,
                         source: 'bulk_accepted' };
      });

      var b = planTags();
      var tagged = {};
      b.forEach(function (p) { p.hits.forEach(function (h) { tagged[h.a.activity_id] = p.code; }); });
      ACTS = (ACTS || []).map(function (act) {
        return tagged[act.activity_id]
          ? Object.assign({}, act, { class_code: tagged[act.activity_id] })
          : act;
      });

      var c = planAllocs();
      return {
        a: a,
        b: b, bTags: b.reduce(function (s, p) { return s + p.hits.length; }, 0),
        c: c,
        parts: c.ok.reduce(function (s, x) { return s + x.p.parts.length; }, 0)
      };
    } finally { CMAP = snapCmap; ACTS = snapActs; }
  }

  async function openMatchAll() {
    await ensureCodes();
    await ensureActs();
    await ensureSugg();
    await ensureLocMatch();
    if (!ITEMS.length) { UI.toast('This revision has no lines yet.', 'warn'); return; }

    var minConf = 0.8;
    /* ⚠️ The heading matches the BUTTON that opened it, not the sub-tab beside it — a dialog titled
       after a tab leaves the planner unsure which of the two controls they just pressed. */
    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">Code, tag and allocate</h2>' +
      '<div class="pd-modal-sub">The whole bill, in the order the three passes depend on each other</div></div>' +
      '<button class="pd-modal-close" id="ma-x">&times;</button></div>' +
      '<div style="padding:2px 16px 6px;" id="ma-body"></div>' +
      '<div class="pd-modal-footer" id="ma-foot"></div>');
    m.el.querySelector('.pd-modal').classList.add('boq-wide');
    var body = m.el.querySelector('#ma-body'), foot = m.el.querySelector('#ma-foot');
    m.el.querySelector('#ma-x').onclick = m.close;

    function paint() {
      var d = matchAllDryRun(minConf);
      var total = d.a.length + d.bTags + d.c.ok.length;
      var rungs = RUNG_ORDER.filter(function (k) { return d.c.byRung[k]; })
        .map(function (k) { return '<span class="boq-why">' + d.c.byRung[k] + ' by ' + esc(RUNG_LABEL[k]) + '</span>'; })
        .join(' ');

      body.innerHTML =
        '<p class="cc-hint" style="margin-top:0;">Nothing is written until you press Run. Each pass feeds the next, ' +
        'so the second and third counts already account for what the passes above them would do.</p>' +
        '<div class="boq-ma">' +
          step(1, 'Code the BOQ lines', d.a.length, 'line(s) will be mapped',
               d.a.length ? 'From the suggestion library, at or above the confidence floor below.'
                          : 'Every mappable line already carries a code — nothing to do.') +
          step(2, 'Tag the schedule activities', d.bTags, 'activity tag(s) will be written',
               d.bTags ? 'Across ' + d.b.filter(function (p) { return p.hits.length; }).length +
                         ' code(s), at ≥' + (TAG_FLOOR * 100).toFixed(0) + '% name confidence. ' +
                         'Activities already carrying a code are never moved in bulk.'
                       : 'No untagged activity resembles any code on this BOQ — nothing to do.') +
          step(3, 'Allocate the quantities', d.c.ok.length, 'line(s) will be split into ' + d.parts + ' allocation(s)',
               d.c.ok.length ? rungs : 'Nothing can be split, even after the passes above.') +
        '</div>' +
        (d.c.none ? '<p class="cc-hint"><strong>' + d.c.none + '</strong> line(s) still could not be allocated ' +
          'afterwards — they stay unallocated rather than being spread over something arbitrary, and the ' +
          'Match to schedule tab lists them.</p>' : '') +
        '<label class="cc-hint" style="display:block;margin-top:10px;">Minimum confidence for pass 1 ' +
          '<select class="pd-select" id="ma-c" style="width:auto;">' +
          [90, 80, 60, 50].map(function (v) {
            return '<option value="' + (v / 100) + '"' + (Math.abs(v / 100 - minConf) < 1e-9 ? ' selected' : '') +
              '>' + v + '%</option>';
          }).join('') + '</select></label>';

      foot.innerHTML = '<button class="pd-btn" id="ma-c2">Cancel</button><span style="flex:1;"></span>' +
        '<button class="pd-btn pd-btn-primary" id="ma-go"' + (total ? '' : ' disabled') + '>' +
        (total ? 'Run all three passes' : 'Nothing to do') + '</button>';
      foot.querySelector('#ma-c2').onclick = m.close;
      body.querySelector('#ma-c').onchange = function () { minConf = Number(this.value); paint(); };
      var go = foot.querySelector('#ma-go');
      if (go) go.onclick = function () { run(go); };
    }

    function step(n, title, count, unit, note) {
      var on = count > 0;
      return '<div class="boq-ma-step' + (on ? '' : ' off') + '">' +
        '<span class="boq-ma-n">' + n + '</span>' +
        '<span class="boq-ma-t"><strong>' + esc(title) + '</strong>' +
          '<span class="cc-mini">' + note + '</span></span>' +
        '<span class="boq-ma-c">' + (on ? '<strong>' + count + '</strong> ' + esc(unit)
                                        : '<span class="cc-mut">skipped</span>') + '</span></div>';
    }

    /* ⚠️⚠️ THE RUN RE-PLANS FROM REAL STATE BETWEEN PASSES rather than replaying the simulation.
       A pass can write fewer rows than it asked for — RLS refuses activities the planner did not
       import, and PostgREST answers a filtered UPDATE with 200 and zero rows — so pass C must be
       built from what pass B actually achieved, not from what it hoped to. Replaying the plan
       would allocate against tags that do not exist. */
    async function run(btn) {
      btn.disabled = true;
      var done = [];
      try {
        // ---- pass A
        var a = planCodeMap().filter(function (x) { return x.s.confidence >= minConf; });
        if (a.length) {
          btn.textContent = 'Coding ' + a.length + ' line(s)…';
          var ra = await applyCodeMap(a);
          if (!ra.ok) { UI.toast('Pass 1 failed — ' + ra.msg, 'error'); m.close(); return; }
          done.push(ra.wrote + ' line(s) coded');
          await reloadMaps();
        }

        // ---- pass B
        var b = planTags();
        var want = b.reduce(function (s, p) { return s + p.hits.length; }, 0);
        if (want) {
          btn.textContent = 'Tagging activities…';
          var rb = await applyTagPlan(b, function (i, n) { btn.textContent = 'Tagging ' + i + ' of ' + n + '…'; });
          await refreshActs();
          done.push(rb.wrote + ' activity tag(s)' + (rb.wrote < rb.wanted ? ' of ' + rb.wanted + ' asked' : ''));
          if (rb.failed.length) UI.toast('Some codes failed to tag — ' + rb.failed.join(' | '), 'error');
        }

        // ---- pass C
        var pc = planAllocs();
        if (pc.ok.length) {
          btn.textContent = 'Allocating ' + pc.ok.length + ' line(s)…';
          var rc = await applyAllocPlans(pc.ok);
          if (!rc.ok) { UI.toast('Pass 3 failed — ' + rc.msg, 'error'); m.close(); await load(); return; }
          done.push(pc.ok.length + ' line(s) allocated');
          if (rc.dropped) done.push(rc.dropped);
        }

        m.close();
        UI.toast(done.length ? 'Matched — ' + done.join(' · ') + '.' : 'Nothing needed doing.', 'success');
        await load();
      } catch (e) {
        m.close();
        UI.toast('Stopped — ' + (e && e.message ? e.message : e) +
                 (done.length ? ' (already applied: ' + done.join(' · ') + ')' : ''), 'error');
        await load();
      }
    }

    paint();
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
    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">New billing period</h2><div class="pd-modal-sub">A period is the BOQ plus one cumulative percentage per line</div></div>' +
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
    /* ⚠️ How this screen reaches the wizard. Supplied by module.js, which owns the wizard's
       dependency object; boq.js must not build one of its own or the two would drift. */
    openWizard = deps.openWizard || null;
  }
  async function show(projectId, label) {
    pid = projectId; projLabel = label || '';
    await ensureSugg();
    await load();
  }
  /* WARNING ALLREVS and PROJTOTAL belong here too: a project switch that kept them would show
     the previous project's contract value under the new project's name. */
  function reset() { COLLAPSED = {}; SEL = {}; loaded = false; DOCS = []; DOCID = null; TRADEMAP = {}; clearTradeActs();
    ALLREVS = []; PROJTOTAL = null; REVS = []; ITEMS = []; CMAP = {}; ALLOC = []; PERIODS = []; PROG = {}; REVID = null; CODES = null; CODETREE = null; ACTS = null; WBSNAME = {}; LOCMATCH = null; SCHED = null; schedErr = null; PKGS = []; }

  return {
    init: init, show: show, reset: reset, render: render,
    /* ⚠ For the topbar's "export what?" chooser. Returns the CURRENT revision's rows under the
       filters on screen, or null when there is nothing -- so the chooser can grey the option
       rather than produce an empty sheet. It writes no file; the caller owns the workbook. */
    sheet: boqSheet,
    /* ⚠️ Exported so the WIZARD can create the draft rather than reimplementing the insert.
       The trigger, the is_current rule and the draft/manual defaults all live in one place. */
    createDraft: createDraft, nextRevLabel: nextRevLabel, currentDraft: currentDraft,
    createDocument: createDocument,
    /* WARNING The BOQ THE PLANNER IS STANDING IN, exported so the wizard can name it. Without it
       the wizard could only offer "a new revision" in the abstract, and the whole confusion this
       answers is that "new revision" and "another BOQ" were indistinguishable on screen. A
       revision belongs to a document; the offer has to say which one. */
    currentDocument: function () {
      var d = (DOCS || []).filter(function (x) { return x.id === DOCID; })[0];
      return d ? { id: d.id, name: d.name } : null;
    },
    /* How many revisions the CURRENT document already holds. `rev` is only a meaningful offer
       when there is something to supersede -- on a document with none it is just "create". */
    revisionCount: function () { return (REVS || []).length; },
    /* The class-code ladder, so the WIZARD can host it in a step instead of carrying a copy. */
    codePickerHTML: codePickerHTML,
    mountCodePicker: mountCodePicker,
    addAuthoredLines: function (codes) { return addAuthoredLines(codes); },
    documents: function () { return DOCS.slice(); },
    /* Opens the class-code picker on the existing draft - the wizard's "add a trade" path. */
    addTrades: function () { sub = 'items'; render(); return openCodeBuilder(); },
    mountTo: function (id) { HOST_ID = id || 'cc-view'; },
    isLoaded: function () { return loaded; },
    /* ⚠️ EXPORTED so the wizard can HAND OFF instead of giving directions. The BOQ
       wizard type used to end on "Done", write nothing, and tell the planner to go to
       the BOQ tab and find the importer themselves — owner, 2026-08-27: *"I don't
       understand the BOQ wizard. How will I add the BOQ then if this is the case?"* A
       wizard that ends by describing the next screen instead of opening it is a
       three-step detour. `finish()` now calls this. */
    openImport: function () { openImport(); },
    _internals: {
      /* ⚠️⚠️ `locKey` WAS EXPORTED HERE AND THE FUNCTION WAS DELETED (2026-09-10 z1), WHICH KILLED
         THE WHOLE MODULE. This object literal is evaluated when the IIFE returns, so a name that
         no longer exists throws `ReferenceError: locKey is not defined` right there — `window.BOQ`
         is never assigned, and every BOQ feature reports "BOQ did not load."
         ⚠️ It is REMOVED, not re-pointed at `PDLoc.normKey`: that is a different function (it
         strips every separator, which is the whole reason the private one was retired), so keeping
         the old name would hand a reader the retired semantics under the retired spelling.
         `affected.js` kept thin delegates for exactly this reason; this file deleted outright and
         missed the export. Anything testing location matching goes to `PDLoc` directly. */
      numOf: numOf, normKey: normKey, findHeader: findHeader, colMapOf: colMapOf,
      markerIn: markerIn, MARKER_RE: MARKER_RE, parseSheet: parseSheet, reconcile: reconcile,
      sheetTotals: sheetTotals, contractSum: contractSum, wtOf: wtOf, periodTotals: periodTotals,
      sheetPocs: sheetPocs, moneyLine: moneyLine, qtyLine: qtyLine, mappable: mappable,
      proposeSplit: proposeSplit, locMatch: locMatch, allocSum: allocSum, suggestFor: suggestFor,
      /* The three planners and the dry run that chains them — exported so a suite can assert the
         whole-BOQ preview equals what the three buttons would do, without a database. */
      planCodeMap: planCodeMap, planTags: planTags, planAllocs: planAllocs,
      lineLinkState: lineLinkState, tradeActivityCounts: tradeActivityCounts,
      clearTradeActs: clearTradeActs, mergePickedParts: mergePickedParts,
      matchAllDryRun: matchAllDryRun, allocBlockReason: allocBlockReason,
      /* Hand-off 2's proposal, so what the schedule becomes is testable without a database, and
         the dialog itself so it can be rendered in a browser rather than a copy of its markup. */
      scheduleSeedPlan: scheduleSeedPlan, openSeedFromSchedule: openSeedFromSchedule,
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
        /* Enough state for a harness to open a real dialog rather than a copy of its markup —
           isDraft() reads curRev(), and codeRow() reads CODES. */
        if (o.REVS) REVS = o.REVS; if (o.REVID) REVID = o.REVID;
        if (o.CODES) CODES = o.CODES; if (o.canWrite != null) canWrite = !!o.canWrite;
        if (o.DOCS) DOCS = o.DOCS; if (o.loaded != null) loaded = !!o.loaded;
        if (o.SCHED !== undefined) SCHED = o.SCHED; if (o.schedErr !== undefined) schedErr = o.schedErr;
      }
    }
  };
})();
