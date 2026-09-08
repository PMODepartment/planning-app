/* ============================================================================
   CONTRACT PACKAGES — managed where they are defined (window.CCPackages)

   Owner, 2026-08-26: *"I think the packages in the dashboard is misplaced it should be
   within the contract module itself."* He is right, and it is the same principle that
   corrected the Add-record form earlier the same day: a contract package is a scope
   division that comes off the CONTRACT DOCUMENTS — "Package 1 — Tower 1 and General
   Requirements", "Package 2 — Towers 2-7". The contract defines it, so the contract
   module owns it.

   ⚠️ ONE FINDING FROM THE MOVE, WORTH KEEPING: the Dashboard's "Select" button wrote
      `pd_package` into sessionStorage and NOTHING EVER READ IT. Only projects.html
      cleared it on a project switch. A planner picking a package there was told, by the
      panel's own note, that module data would not narrow — and it never did, because no
      consumer existed. The button is not carried over; a control that does nothing is
      worse than no control, and every module that actually narrows by package
      (the schedule, the BOQ, procurement, engineering) has its own filter.

   ⚠️ THE PACKAGE IS STILL THE SAME ROW. This is a move, not a fork: same `packages`
      table, same PDb calls, same guarded delete RPC. Nothing about the data changed, so
      every consumer built on it keeps working untouched.
   ============================================================================ */
window.CCPackages = (function () {
  'use strict';
  var UID = null, canWrite = false, pid = null, PKG = [], loaded = false;
  var CONTRACTS = [], onSub = null, onNew = null, onEditRecord = null;   // contracts to join, the BOQ, the wizard, the record form
  var onBoq = null;                 // mounts the inline BOQ section - see module.js
  var esc = function (x) { return Fmt.esc(String(x == null ? '' : x)); };
  function host() { return document.getElementById('cc-view'); }

  function init(deps) { UID = deps.uid; canWrite = !!deps.canWrite; }
  function reset() { loaded = false; PKG = []; }
  async function show(projectId, contracts, openSub, openNew, editRecord, mountBoq) {
    pid = projectId;
    CONTRACTS = contracts || [];
    onSub = openSub || null;
    onNew = openNew || null;
    /* The record form lives in module.js (types, the claim pipeline, the tolerant-column
       save). This view only needs the way IN to it, so the pencil on a contract row opens
       the same form the Claims register does rather than a second, thinner copy. */
    onEditRecord = editRecord || null;
    onBoq = mountBoq || null;
    await load();
  }
  async function load() {
    var h = host(); if (!h) return;
    h.innerHTML = '<div class="cc-empty"><h3>Loading packages…</h3></div>';
    try { PKG = await PDb.getPackages(pid); loaded = true; }
    catch (e) {
      /* ⚠️ Names the likely cause. Before the migration runs this table does not exist,
         and a bare "failed" sends someone hunting in the app instead of in SQL. */
      h.innerHTML = '<div class="cc-empty"><h3>Could not load packages</h3><p>' + esc(e.message) +
        '</p><p class="cc-hint">If this says the relation does not exist, run ' +
        '<code>migrations/2026-08-19-packages.sql</code>.</p></div>';
      return;
    }
    render();
  }


  /* THE MERGED CONTRACT VIEW — one row per package, carrying the contract that defines it.
     Owner: *"Contracts and packages are the same thing isn't it?"* Nearly, and in practice
     one-to-one — but not identically, and the gap is what this view must not hide:
       · a package with NO contract record (created directly, or before the contract was
         entered) is real and must still appear, or it silently drops off the screen the
         schedule and BOQ file against;
       · a contract record with NO package is also real (the link is optional) and is
         listed separately rather than dropped.
     ⚠️ MATCHED ON package_id, never on code or name. A contract's reference has no
        relationship to a package's code, and matching on text would pair the wrong two
        the first time someone renamed one. */
  function contractFor(pkgId) {
    return CONTRACTS.filter(function (r) { return String(r.package_id || '') === String(pkgId); })[0] || null;
  }
  /* ⚠️ FULL PESOS IN A TABLE CELL, ABBREVIATED ONLY IN A SUMMARY STRIP. `Fmt.moneyShort`
     turns ₱3,670,000,000 into "₱3.67B", which is the right thing above a table and the
     wrong thing inside one: a contract amount is a figure that gets typed into a claim, and
     a column of right-aligned abbreviations cannot be compared or checked. The old records
     list used moneyShort for the amount itself — so the only place this screen showed the
     contract value, it showed it rounded to three significant figures. */
  function money(n) { return n == null ? null : Fmt.money(n); }
  function moneyShort(n) { return n == null ? null : Fmt.moneyShort(n); }

  /* ==========================================================================
     THE CONTRACT TAB, REORDERED — records first, lots last (2026-09-07)
     ==========================================================================
     Owner: *"Let's just make the page cleaner. Let's just move the packages section at
     the bottom. And it should be like a table. The UI right now looks garbage. There is
     a new package and +Add button which are the same let's consolidate."*

     Three separate faults, and they compound:

     1. ⚠️ THE PAGE LED WITH ITS RAREST CASE. Packages came first and, on the ordinary
        single-lot project, that first screen was a 48px-padded card headlining "No
        packages" followed by three paragraphs explaining why that is fine. The actual
        subject of the tab — the contract, ₱3.67B of it — was pushed below the fold and
        rendered as a `<table>` WITH NO `<thead>` AT ALL: a bold reference, a wrapped
        description, a name and an amount, with nothing saying which was which. The prose
        was written to stop planners inventing packages (that history is real and the
        reasoning is kept below) but it had been left in the position of a headline, so
        every project was greeted by a disclaimer.

     2. ⚠️ TWO PRIMARY BUTTONS FOR ONE JOB. `New package` sat top-left in brand red
        beside `Share with Procurement & Engineering`, while the topbar carried `+ Add` —
        also red, also "add something here". They are consolidated the way the buttons
        themselves suggest: ONE primary per screen (`+ Add`, the topbar wizard, which is
        where a contract is recorded) and the package action moved INSIDE the packages
        card, scoped to the table it acts on. A lot is added where lots are listed.
        ⚠️ It opens the compact FORM, not the wizard — which is what wizard.js's own
           note says should happen ("The Contract tab's 'New package' button now opens
           the compact form, which is the right tool for adding one lot"). It was still
           calling `onNew('Package')`, i.e. the wizard, whose type step deliberately no
           longer offers a Package card. The two had drifted apart.

     3. ⚠️ NEITHER TABLE HAD A HEADER STRIP, so nothing on the page said what it was.
        Both now use the `.cc-dt*` layer ported from the Procurement Dashboard's
        `.data-table`: a titled card header carrying the row count and that table's own
        actions, sortable columns, and a footer for the note that used to be a headline.

     WHAT IS DELIBERATELY UNCHANGED: the data, the matching rule (`package_id`, never
     code or name), the guarded delete, and the ARGUMENT of the notes below. A
     single-lot contract still needs no package and the screen still says so — as a
     footnote under the lots table, which is where a footnote goes. */

  /* Sort state, per table. ⚠️ Held on the module rather than in the DOM so a re-render
     (a save, a package created) does not silently reset the planner's chosen order. */
  var csort = { key: 'reference_no', dir: 1 };
  var psort = { key: 'code', dir: 1 };

  function cmp(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  /* ⚠️ BLANKS SORT LAST IN *BOTH* DIRECTIONS, so the null test sits OUTSIDE the direction
     multiplier. The first cut had it inside `cmp` and multiplied the result by `st.dir`,
     which flipped it: sorting contract amount descending put the three lots with NO amount
     at the TOP of the table, above ₱3.2B. Caught by measuring, not by reading — ascending
     looked perfect. An empty cell is not the smallest value, it is an absent one, and a
     column sorted to surface the largest figures must not lead with the unknowns. */
  function sortBy(list, st, valOf) {
    return list.slice().sort(function (x, y) {
      var a = valOf(x, st.key), b = valOf(y, st.key);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return cmp(a, b) * st.dir;
    });
  }
  /* ⚠️ `st` IS REQUIRED and this throws when it is missing rather than defaulting to
     one of the two sort states. Three of these calls shipped without it in the first cut,
     and the render harness caught it as `Cannot read properties of undefined (reading
     'key')` — loudly, which is the point. Defaulting to `csort` would have made the
     packages table's headers silently drive the CONTRACTS table's order: every header
     still clickable, every click reordering the wrong table. */
  function th(label, key, st, cls) {
    if (!st) throw new Error('th("' + label + '") needs its sort state — csort or psort.');
    return '<th class="cc-sort' + (cls ? ' ' + cls : '') + (st.key === key ? (st.dir > 0 ? ' asc' : ' desc') : '') +
      '" data-sort="' + esc(key) + '">' + esc(label) + '</th>';
  }

  /* ---- Table 1: the contract records ------------------------------------- */
  /* ⚠️ EVERY contract record, not just the unlinked ones. The old `orphanHTML` showed
     only contracts with no `package_id` — so on a project that DID have packages, a
     contract properly linked to one appeared nowhere on this table, only as a one-line
     summary inside its package's row. The register's own subject was reachable only as
     a subtitle of something else. Where a contract belongs to a lot, the lot is a
     COLUMN. */
  function contractsHTML() {
    var list = sortBy(CONTRACTS, csort, function (r, k) {
      if (k === 'amount') return r.amount == null ? null : Number(r.amount);
      if (k === 'package') return pkgLabel(r.package_id);
      return r[k] == null || r[k] === '' ? null : r[k];
    });
    var total = CONTRACTS.reduce(function (a, r) { var n = Number(r.amount); return a + (isFinite(n) ? n : 0); }, 0);
    var hasPkgs = PKG.length > 0;

    var h = '<div class="pd-card cc-dtcard"><div class="cc-dthead">' +
      '<h3>Contract records</h3>' +
      '<span class="cc-dtcount">' + CONTRACTS.length + (CONTRACTS.length === 1 ? ' record' : ' records') +
        (total ? ' · ' + esc(moneyShort(total)) : '') + '</span>' +
      '<span class="cc-dtspacer"></span>' +
      /* ⚠️ THERE IS NO BOQ BUTTON HERE ANY MORE, and its absence is the point. It existed for
         about a day, to fix the BOQ having no entry point at all while it was still a separate
         sub-screen you navigated to. Moving the BOQ inline onto this same page made it
         redundant the same afternoon — owner, 2026-09-07: *"there is also a BOQ button in the
         contract records which is redundant when we have already moved the BOQ section to the
         contract page"*. A button that scrolls you a few hundred pixels down the page you are
         already looking at is noise in a card header that should carry actions, not navigation.
         ⚠️ `openSub('boq')` still exists in module.js and still switches tab + scrolls, because
         the contract wizard's BOQ step hands off through it. That is a hand-off from another
         screen, not a control on this one. */
      /* ⚠️ The ONLY way to create a first contract lot from this screen, now that the empty
         Contract lots section is not rendered at all. Writers only, and deliberately quiet: for
         almost every project the right number of lots is zero, so this is an escape hatch rather
         than an invitation. Once a lot exists the full section appears below and carries its own
         `+ Lot`, and this one stops being the only route. */
      /* WARNING QUIETER THAN A pd-btn, DELIBERATELY. Owner: *"+Lot button needs UI rework"*.
         With the Contract lots section hidden on a project with no lots, this is the only
         thing left in that header - and for almost every project the right number of lots is
         ZERO. A primary-weight button there reads as a step to take. It is an escape hatch,
         so it looks like one: a text-weight control that gains a border on hover. */
      (canWrite && !PKG.length
        ? '<button class="boq-ghostbtn" id="pk-addfirst" title="A contract lot is a division BELOW this project. If the division already has its own project code it is a separate project, not a lot.">+ Lot</button>'
        : '') +
      '</div>';

    if (!CONTRACTS.length) {
      /* ⚠️ The way in is HERE, at the point of need, rather than only in the topbar —
         but it is the SAME wizard the topbar opens, not a second path. */
      h += '<div class="cc-dtnone"><b>No contract record for this project yet.</b><br>' +
        'The signed contract is what the claims, the BOQ and the billing are all raised against.' +
        (canWrite ? '<div style="margin-top:12px;"><button class="pd-btn pd-btn-primary" id="pk-newcontract">Record the contract</button></div>' : '') +
        '</div></div>';
      return h;
    }

    h += '<div class="cc-tablewrap"><table class="cc-table"><thead><tr>' +
      th('Reference', 'reference_no', csort) +
      th('Description', 'description', csort, 'cc-desc') +
      th('Counterparty', 'counterparty', csort) +
      (hasPkgs ? th('Lot', 'package', csort) : '') +
      th('Signed', 'date_filed', csort, 'cc-nowrap') +
      th('Contract amount', 'amount', csort, 'cc-r') +
      (canWrite ? '<th class="cc-actcol"></th>' : '') +
      '</tr></thead><tbody>';

    list.forEach(function (r) {
      h += '<tr data-id="' + esc(r.id) + '">' +
        '<td class="cc-ref">' + esc(r.reference_no || '—') + '</td>' +
        '<td class="cc-desc"><div class="cc-desc-txt" title="' + esc(r.description || '') + '">' +
          (r.description ? esc(r.description) : '<span class="cc-mut">(no description)</span>') + '</div>' +
          /* ⚠️ The contract-vs-package disagreement keeps its warning, moved from the
             package row to the contract row — it is the contract's figure that is at
             odds, and this is the table where that figure is read. */
          (amtWarn(r) ? '<div class="cc-mini cc-warn">' + amtWarn(r) + '</div>' : '') + '</td>' +
        '<td>' + (r.counterparty ? esc(r.counterparty) : '<span class="cc-mut">—</span>') + '</td>' +
        (hasPkgs ? '<td>' + (r.package_id
            ? '<span class="boq-code">' + esc(pkgLabel(r.package_id)) + '</span>'
            /* ⚠️ NOT a warning pill. 2026-08-27: a contract outside every lot is only a
               gap because this project has lots at all — and even then the schedule, the
               BOQ, procurement and engineering all still read it at project level. */
            : '<span class="cc-badge b-mut">whole project</span>') + '</td>' : '') +
        '<td class="cc-nowrap">' + (r.date_filed ? esc(Fmt.date(r.date_filed)) : '<span class="cc-mut">— not set —</span>') + '</td>' +
        '<td class="cc-r">' + (r.amount == null ? '<span class="cc-mut">—</span>' : '<strong>' + esc(money(r.amount)) + '</strong>') + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-cedit="' + esc(r.id) + '" title="Edit this contract record">&#9998;</button></td>' : '') +
        '</tr>';
    });

    // The roll-up, only where it says something a single row does not.
    if (CONTRACTS.length > 1) {
      h += '<tr class="cc-total"><td></td><td class="cc-desc">Total of ' + CONTRACTS.length + ' contract records</td>' +
        '<td></td>' + (hasPkgs ? '<td></td>' : '') + '<td></td>' +
        '<td class="cc-r">' + esc(money(total)) + '</td>' + (canWrite ? '<td></td>' : '') + '</tr>';
    }
    h += '</tbody></table></div>';

    /* The footnote that used to be the headline. It only fires where it is TRUE: a
       contract sitting outside the lots of a project that has lots. */
    var loose = CONTRACTS.filter(function (r) { return !r.package_id; });
    if (hasPkgs && loose.length) {
      h += '<div class="cc-dtfoot"><p>⚠️ ' + loose.length + ' of these sit outside every lot, so they are ' +
        'missing from any lot-filtered view — though the schedule, BOQ, procurement and engineering still read ' +
        'them at project level. Open one and link it to the lot it belongs to if that is wrong.</p></div>';
    }
    return h + '</div>';
  }

  function pkgLabel(id) {
    if (!id) return null;
    var p = PKG.filter(function (x) { return String(x.id) === String(id); })[0];
    /* ⚠️ A lot that no longer exists reads UNLINKED, never blank. The FK is ON DELETE SET
       NULL, so "no lot" and "a lot that vanished" must not look alike. */
    return p ? (p.code || p.name) : 'UNLINKED';
  }
  /* ⚠️ The contract's amount and its lot's are seeded from one another and then edited
     apart, and a silent disagreement between the two is exactly the drift that only
     surfaces in a billing dispute. */
  function amtWarn(c) {
    if (!c.package_id || c.amount == null) return '';
    var p = PKG.filter(function (x) { return String(x.id) === String(c.package_id); })[0];
    if (!p || p.contract_amount == null || Number(p.contract_amount) === Number(c.amount)) return '';
    return '⚠ lot ' + esc(p.code || p.name) + ' says ' + esc(money(p.contract_amount));
  }

  /* ---- Table 2: the contract lots (packages) ----------------------------- */
  /* The inline BOQ's shell. The heading is ours so the section is legible before the BOQ
     has loaded (and if it never does); everything inside #cc-boq-inline belongs to boq.js. */
  function boqSectionHTML() {
    return '<div class="cc-sechead" id="cc-boq-head"><h2>Bill of quantities</h2>' +
      '<span class="cc-sechead-rule"></span></div>' +
      '<div id="cc-boq-inline"><div class="cc-empty"><p class="cc-mut">Loading the BOQ…</p></div></div>';
  }

  function packagesHTML() {
    /* ⚠️⚠️ NO LOTS -> NO SECTION. Owner, 2026-09-07: *"in case the project doesn't have any
       packages can't we just have this disappear and only appear when the project has
       packaging"*. It was ~200px of card, empty state and three-sentence footnote explaining, at
       length, that the correct answer for almost every project is **nothing** — the header itself
       said "none — the usual case". A screen that spends its most valuable space teaching you
       about a feature you should not use is worse than one that omits the feature until it
       applies.
       ⚠️ THE WAY IN IS NOT LOST, it moves: `+ Lot` now sits in the Contract records head beside
       BOQ (see contractsHTML), and the contract wizard's package step still creates lots. Deleting
       the section without leaving a route would have made the first lot uncreatable from this
       screen. The moment a project HAS a lot, the full section returns exactly as before. */
    if (!PKG.length) return '';

    var h = '<div class="cc-sechead"><h2>Contract lots</h2><span class="cc-sechead-rule"></span></div>' +
      '<div class="pd-card cc-dtcard"><div class="cc-dthead">' +
      '<h3>Packages</h3>' +
      '<span class="cc-dtcount">' + PKG.length + (PKG.length === 1 ? ' lot' : ' lots') + '</span>' +
      '<span class="cc-dtspacer"></span>' +
      (canWrite ? '<button class="pd-btn" id="pk-add">+ Lot</button>' : '') +
      (canWrite ? '<button class="pd-btn" id="pk-push" title="Mirror these lots into the Procurement (WPM) and Engineering apps so their records can be filed under the same contract lots">Share with Procurement &amp; Engineering</button>' : '') +
      '</div>';

    var list = sortBy(PKG, psort, function (k, key) {
      if (key === 'contract_amount') return k.contract_amount == null ? null : Number(k.contract_amount);
      return k[key] == null || k[key] === '' ? null : k[key];
    });

    h += '<div class="cc-tablewrap"><table class="cc-table"><thead><tr>' +
      th('Code', 'code', psort) + th('Name', 'name', psort, 'cc-desc') +
      th('Status', 'status', psort) + th('Start', 'start_date', psort, 'cc-nowrap') +
      th('Finish', 'end_date', psort, 'cc-nowrap') +
      th('Contract amount', 'contract_amount', psort, 'cc-r') +
      '<th>Contract record</th><th>Buys under</th>' +
      (canWrite ? '<th class="cc-actcol"></th>' : '') +
      '</tr></thead><tbody>';

    list.forEach(function (k) {
      var c = contractFor(k.id);
      h += '<tr data-pk="' + esc(k.id) + '">' +
        '<td class="cc-ref">' + esc(k.code) + '</td>' +
        '<td class="cc-desc"><div class="cc-desc-txt">' + esc(k.name) + '</div></td>' +
        /* k-active / k-archived are this status's OWN variants. The first cut borrowed
           k-measured, which is legible but means "measured quantity" everywhere else —
           one class with two meanings is how a vocabulary rots. */
        '<td><span class="boq-kind k-' + esc(k.status === 'archived' ? 'archived' : 'active') + '">' +
          esc(k.status || 'active') + '</span></td>' +
        '<td class="cc-nowrap">' + (k.start_date ? esc(Fmt.date(k.start_date)) : '<span class="cc-mut">— not set —</span>') + '</td>' +
        /* ⚠️ A lot with no finish date reads "— not set —", never blank: the schedule's
           EOT arithmetic needs it (revised finish = end_date + granted days), so a
           missing one is a gap to fill, not an empty cell to scroll past. */
        '<td class="cc-nowrap">' + (k.end_date ? esc(Fmt.date(k.end_date)) : '<span class="cc-mut">— not set —</span>') + '</td>' +
        '<td class="cc-r">' + (k.contract_amount != null ? esc(money(k.contract_amount)) : '<span class="cc-mut">—</span>') + '</td>' +
        /* ⚠️ A lot with NO contract record is real (created directly, or before the
           contract was entered) and must still say so rather than look complete. */
        '<td>' + (c ? '<span class="cc-badge b-ok">' + esc(c.reference_no || 'recorded') + '</span>'
                    : '<span class="cc-badge b-warn">none yet</span>') + '</td>' +
        /* The mapping has to be VISIBLE on the list. A lot silently pointing at another
           project's procurement is exactly the kind of thing nobody finds until a buyer
           reports an empty picker. */
        '<td>' + (k.wpm_project_id
          ? '<code title="Procurement project this lot buys under">' + esc(k.wpm_project_id) + '</code>'
          : '<span class="cc-mut">this project</span>') + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-edit="' + esc(k.id) + '">Edit</button></td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="cc-dtfoot"><p>These are what the schedule files its top-level rows under, what the BOQ is ' +
      'assigned to, and what procurement and engineering read once shared. ⚠️ <b>Finish</b> is the contractual ' +
      'completion date the schedule\'s EOT arithmetic revises — a lot without one shows no revised finish and no ' +
      'exposure.</p></div></div>';
    return h;
  }

  function render() {
    var h = host(); if (!h) return;
    /* ⚠️⚠️ THE BOQ IS A SECTION OF THIS TAB, NOT A SCREEN YOU LEAVE FOR. Owner, 2026-09-07:
       *"Can't the BOQ page be relocated in the contracts page?"* — chosen over a fourth
       top-level tab, which was the alternative on offer. It is emitted as an EMPTY container
       and filled by module.js, because the BOQ owns six round-trips of its own and this
       function is re-run on every package edit; re-rendering it here would refetch the whole
       bill each time somebody renames a lot. */
    h.innerHTML = contractsHTML() + packagesHTML() + boqSectionHTML();
    if (window.Icons && Icons.hydrate) Icons.hydrate(h);
    wire(h);
    if (onBoq) onBoq();
  }

  function wire(h) {
    /* ⚠️ ONE PRIMARY PER SCREEN. `+ Add` in the topbar opens the wizard (a contract, and
       its package step defines as many lots as the contract has); `+ Lot` here opens the
       compact form, which is the right tool for one lot and the same one Edit uses. */
    /* WARNING BOTH + Lot BUTTONS OPEN THE WIZARD, NOT THE COMPACT FORM. Owner, 2026-09-07:
       *"when I clicked on it showed the new package window wherein I thought we created the
       wizard where all additions will go through the wizard"*. They did - this screen was the
       exception, on the reasoning that a compact form is the right tool for one lot. That
       reasoning ignored what the wizard KNOWS and the form does not: it refuses a lot that
       restates an existing project code (the AVR101/AVR102 mistake), it explains what a lot is
       before asking you to name one, and it gives a Package no details or dates step because
       those belong to the contract. The bare form asks for a code with none of that, which is
       how a lot that should have been a separate project gets created.
       WARNING `edit()` is NOT dead - the pencil on an existing lot still opens it. Creating and
       editing are different acts here: creation is the one that needs the guard rails. */
    var a = h.querySelector('#pk-add');
    if (a) a.onclick = function () { if (onNew) onNew('Package'); else edit(null); };
    var af = h.querySelector('#pk-addfirst');
    if (af) af.onclick = function () { if (onNew) onNew('Package'); else edit(null); };
    var nc = h.querySelector('#pk-newcontract');
    if (nc) nc.onclick = function () { if (onNew) onNew('Contract'); else edit(null); };
    var p = h.querySelector('#pk-push'); if (p) p.onclick = share;
    h.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { edit(PKG.filter(function (k) { return String(k.id) === b.dataset.edit; })[0]); };
    });
    /* Editing a CONTRACT record from this tab. ⚠️ Delegated up to module.js rather than
       reimplemented — the record form knows about types, the claim pipeline and the
       tolerant-column save, none of which belongs in the packages view. */
    h.querySelectorAll('[data-cedit]').forEach(function (b) {
      b.onclick = function () { if (onEditRecord) onEditRecord(b.dataset.cedit); };
    });
    // Sorting. Which table a header belongs to is read off its own table element, so the
    // two never drive one another's order.
    h.querySelectorAll('th[data-sort]').forEach(function (t) {
      t.onclick = function () {
        var inPkgTable = !!t.closest('table').querySelector('th[data-sort="code"]');
        var st = inPkgTable ? psort : csort, k = t.dataset.sort;
        if (st.key === k) st.dir = -st.dir; else { st.key = k; st.dir = 1; }
        render();
      };
    });
  }

  function edit(k) {
    var isNew = !k; k = k || {};
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' +
      (isNew ? 'New package' : 'Edit package') + '</h2>' +
      '<button class="pd-modal-close" id="pk-x">&times;</button></div>' +
      '<div class="cc-form">' +
      '<label>Code<input id="pk-code" value="' + esc(k.code) + '" placeholder="e.g. PKG-1" /></label>' +
      '<label>Status<select id="pk-status">' +
        ['active', 'archived'].map(function (s) { return '<option' + (k.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="cc-wide">Name<input id="pk-name" value="' + esc(k.name) + '" placeholder="e.g. Tower 1 and General Requirements" /></label>' +
      '<label class="cc-wide">Description<input id="pk-desc" value="' + esc(k.description) + '" /></label>' +
      '<label>Start<input id="pk-fs" type="date" value="' + esc(k.start_date ? String(k.start_date).slice(0, 10) : '') + '" /></label>' +
      '<label>Finish<input id="pk-ff" type="date" value="' + esc(k.end_date ? String(k.end_date).slice(0, 10) : '') + '" /></label>' +
      '<label>Contract amount<input id="pk-amt" type="number" step="0.01" value="' + esc(k.contract_amount == null ? '' : k.contract_amount) + '" /></label>' +
      '<label>Sort order<input id="pk-sort" type="number" value="' + esc(k.sort_order == null ? PKG.length : k.sort_order) + '" /></label>' +
      /* WHICH CONTRACT CODE THIS LOT BUYS UNDER.
         The gap this closes: one schedule can span several contract codes (AVR101's
         schedule covers all 7 towers, but Towers 2-7 are bought under AVR102, a different
         project in the Procurement app). Without these the schedule can only ever read one
         Procurement project, so the other lot's work packages never reach the activities
         that consume them.
         WARN: BLANK IS THE NORMAL CASE and means "the same project this package is on".
            Only fill these in when a lot genuinely buys under a different code -- a value
            set by habit would point a lot's procurement at the wrong project silently. */
      '<div class="cc-wide" style="margin-top:6px;border-top:1px solid var(--pd-line);padding-top:10px;">' +
        '<strong style="font-size:12px;">Contract codes this lot buys under</strong>' +
        '<p class="cc-hint" style="margin-top:2px;">Leave blank unless this lot is bought under a ' +
        '<b>different project code</b> from the one it sits on. Only then does the schedule read a ' +
        'second Procurement project.</p></div>' +
      '<label>Procurement (WPM) project<input id="pk-wpm" value="' + esc(k.wpm_project_id || '') +
        '" placeholder="' + esc(pid || '') + '" /></label>' +
      '<label>Engineering project<input id="pk-eng" value="' + esc(k.eng_project_id || '') +
        '" placeholder="' + esc(pid || '') + '" /></label>' +
      '<label class="cc-wide">This lot\'s own Planners project<input id="pk-plan" value="' + esc(k.planners_project_id || '') +
        '" placeholder="e.g. AVR102 — where its contract, claims and billing are filed" /></label>' +
      '<p class="cc-hint cc-wide">⚠️ <b>Finish</b> is the contractual completion date. The schedule reads it ' +
      'to compute a revised finish once approved EOT days are granted, so a package without one reports no ' +
      'revised finish and no liquidated-damages exposure.</p>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
      (isNew ? '' : '<button class="pd-btn pd-btn-danger" id="pk-del">Delete...</button>') +
      '<span style="flex:1;"></span>' +
      '<button class="pd-btn" id="pk-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="pk-save">Save</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('pk-x').onclick = m.close; el('pk-cancel').onclick = m.close;
    if (!isNew) el('pk-del').onclick = function () { m.close(); del(k); };
    el('pk-save').onclick = async function () {
      var num = function (id) { var v = (el(id).value || '').trim(); return v === '' ? null : Number(v); };
      var data = {
        project_id: pid,
        code: (el('pk-code').value || '').trim(),
        name: (el('pk-name').value || '').trim(),
        description: (el('pk-desc').value || '').trim() || null,
        status: el('pk-status').value,
        start_date: el('pk-fs').value || null,
        end_date: el('pk-ff').value || null,
        contract_amount: num('pk-amt'), sort_order: num('pk-sort') || 0,
        // Empty means "same as this project", so it is stored as NULL rather than ''.
        wpm_project_id: (el('pk-wpm').value || '').trim() || null,
        eng_project_id: (el('pk-eng').value || '').trim() || null,
        planners_project_id: (el('pk-plan').value || '').trim() || null
      };
      if (!data.code) { UI.toast('Give the package a code - it comes off the contract.', 'error'); return; }
      if (!data.name) { UI.toast('Give the package a name.', 'error'); return; }
      var btn = el('pk-save'); btn.disabled = true; btn.textContent = 'Saving...';
      try {
        if (isNew) { data.created_by = UID; await PDb.createPackage(data); }
        else await PDb.updatePackage(k.id, data);
        m.close(); UI.toast('Package saved.', 'success'); await load();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save';
        UI.toast(/duplicate key/i.test(e.message || '')
          ? 'A package with code "' + data.code + '" already exists on this project.'
          : (e.message || String(e)), 'error');
      }
    };
  }

  function del(k) {
    /* ⚠️ The delete is GUARDED SERVER-SIDE (admin_delete_package) and refuses while any
       schedule activity or WBS branch still points at the package, naming how many. That
       guard is the point: the FK is ON DELETE SET NULL, so an unguarded delete would
       silently unassign a few hundred activities and nobody would notice until a package
       total came out short. Archiving is the non-destructive way to retire one. */
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Delete package ' + esc(k.code) + '?</h2>' +
      '<button class="pd-modal-close" id="pd-x">&times;</button></div>' +
      '<div style="padding:14px 16px;">' +
      '<p class="cc-hint" style="margin-top:0;">This cannot be undone. It is refused while any <b>schedule ' +
      'activity or WBS branch is still assigned</b> to this package, and the error says how many - reassign ' +
      'them first, or set the package to <b>archived</b> instead, which retires it without touching the ' +
      'schedule.</p>' +
      '<p class="cc-hint">⚠️ Claims, change orders and BOQ lines raised against it are <b>not</b> deleted - ' +
      'they keep the commercial record and simply stop pointing at a lot.</p></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="pd-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-danger" id="pd-go">Delete package</button></div>');
    m.el.querySelector('#pd-x').onclick = m.close;
    m.el.querySelector('#pd-c').onclick = m.close;
    m.el.querySelector('#pd-go').onclick = async function () {
      var b = m.el.querySelector('#pd-go'); b.disabled = true; b.textContent = 'Deleting...';
      try { await PDb.deletePackage(k.id); m.close(); UI.toast('Package deleted.', 'success'); await load(); }
      catch (e) { b.disabled = false; b.textContent = 'Delete package'; UI.toast(e.message || String(e), 'error'); }
    };
  }

  /* Mirror these packages into the Procurement (WPM) and Engineering apps.
     ⚠️ THREE SEPARATE SUPABASE PROJECTS, so neither can read `packages` across the
        wire - push-packages writes a read-only mirror into each. Explicit, never
        automatic: a half-typed lot appearing in a buyer's picker the instant it is saved
        is worse than a button pressed once the contract is settled. */
  async function share() {
    if (!PKG.length) { UI.toast('This project has no packages to share yet.', 'warn'); return; }
    var btn = document.getElementById('pk-push');
    if (btn) { btn.disabled = true; btn.textContent = 'Sharing...'; }
    try {
      var res = await sb().functions.invoke('push-packages', { body: { project_id: pid } });
      if (res && res.error) throw res.error;
      var t = (res && res.data && res.data.targets) || {}, ok = [], bad = [];
      Object.keys(t).forEach(function (k2) {
        if (t[k2] && t[k2].error) bad.push(k2 + ': ' + t[k2].error + (t[k2].hint ? ' (' + t[k2].hint + ')' : ''));
        else ok.push(k2 + ' ' + ((t[k2] && t[k2].written) || 0));
      });
      // ⚠️ A partial success is reported as one. "Shared" while engineering
      //    received nothing is the single outcome nobody could act on.
      if (bad.length) UI.toast('Shared to ' + (ok.join(', ') || 'nothing') + '. Failed - ' + bad.join(' | '), 'error');
      else UI.toast('Packages shared: ' + ok.join(', ') + '.', 'success');
    } catch (e) {
      var msg = (e && e.message) || String(e);
      UI.toast(/not found|404/i.test(msg)
        ? 'push-packages is not deployed - run: supabase functions deploy push-packages'
        : ('Could not share packages: ' + msg), 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Share with Procurement & Engineering'; }
  }
  function sb() { return AppAuth.getSB(); }

  return { init: init, show: show, reset: reset, render: render, list: function () { return PKG; } };
})();
