/* Contracts & Claims Register — modules/contracts-claims/module.js
   Built against the Power Apps "Contracts & Claims Register" app (Overview /
   Claims and Change Orders / Extension of Time screens).

   THE CORE INSIGHT: the Claims/CO screen and the EOT screen are the SAME screen.
   Both are a four-stage pipeline — Estimated → Submitted → Evaluated → Client
   Approved — with a status, a derived aging figure, and a project roll-up banner.
   They differ only in UNIT: Claims/CO are money, EOT is calendar days. So both are
   driven by one `VIEWS` config and one renderer; only the column set changes.

   AGING is derived at render time (today − date_submitted) and shown ONLY while a
   record is Pending, exactly as the app does. It is never stored — a stored aging
   is wrong the day after you write it. */
window.ContractsClaims = (function () {
  'use strict';

  var TABLE = 'contracts_claims';
  var sb = function () { return window.__sb || (window.__sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY)); };

  // ===== live collaboration (presence + who's-editing row cursor) + offline =====
  var _collab = null, _remoteSel = {}, _collabSelf = {}, PKEY = 'contracts_claims', PID_PFX = 'cc';
  function joinCollab() {
    if (!window.PDCollab) return;
    if (_collab) { _collab.leave(); _collab = null; }
    _remoteSel = {};
    if (!pid) { renderPresence([]); return; }
    _collab = PDCollab.join({
      key: PKEY + ':' + pid, table: TABLE, projectId: pid, self: _collabSelf,
      onPresence: function (ms) { renderPresence(ms); _remoteSel = {}; ms.forEach(function (m) { if (!m.self && m.sel) _remoteSel[m.id] = { id: m.id, name: m.name, color: m.color, sel: m.sel }; }); paintRemote(); },
      onSelection: function (d) { if (d.sel) _remoteSel[d.id] = { id: d.id, name: d.name, color: d.color, sel: d.sel }; else delete _remoteSel[d.id]; paintRemote(); },
      onRemoteChange: applyRemoteChange
    });
  }
  function renderPresence(ms) { var el = document.getElementById(PID_PFX + '-presence'); if (el) el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(ms || []) : ''; }
  function broadcastCollabSel(id, editing) { if (_collab) _collab.setSelection(id ? { rowId: id, editing: !!editing } : null); }
  function _collabRow(id) { var rid = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : id; return document.querySelector('tr[data-id="' + rid + '"]') || (function () { var b = document.querySelector('[data-edit="' + rid + '"]'); return b ? b.closest('tr') : null; })(); }
  function paintRemote() { if (!window.PDCollab) return; PDCollab.clearCells(document); Object.keys(_remoteSel).forEach(function (k) { var m = _remoteSel[k]; if (!m || !m.sel || !m.sel.rowId) return; var tr = _collabRow(m.sel.rowId); if (!tr) return; var td = tr.querySelector('td'); if (td) PDCollab.paintCell(td, m); }); }
  function applyRemoteChange(payload) {
    var evt = payload.eventType || payload.event, rec = payload['new'] || payload.record || null, old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') { var did = old && old.id; if (did == null) return; rows = rows.filter(function (x) { return String(x.id) !== String(did); }); }
    else if (rec) { var j = -1; for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(rec.id)) { j = i; break; } } if (j < 0) rows.push(rec); else rows[j] = rec; }
    else return;
    render();
  }
  function wireModalCursor(m, r) { if (!r || !r.id) return; var oc = m.close; m.close = function () { broadcastCollabSel(null); oc(); }; broadcastCollabSel(r.id, true); m.el.addEventListener('click', function (e) { if (e.target === m.el) broadcastCollabSel(null); }); }
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- vocabularies (from the app's own dropdowns) --------------------------
  var STATUSES = ['Pending', 'Approved', 'Disapproved', 'Cancelled'];
  var STATUS_CLS = { 'Pending': 'st-pending', 'Approved': 'st-approved', 'Disapproved': 'st-disapproved', 'Cancelled': 'st-cancelled' };
  var CLAIM_TYPES = ['Claim', 'Change Order'];

  /* One config per tab. `cols` are the four pipeline columns in display order;
     `fmt` is how their values render. Contract has no pipeline — it's a flat
     description + amount list — so it carries a single `amount` column. */
  var VIEWS = {
    /* ⚠️⚠️ THE DASHBOARD IS NOT A REGISTER VIEW, AND IT IS IN HERE ANYWAY — DEFENSIVELY.
       `render()` returns on this view long before anything reads `types` or `cols`, so these
       are never consulted on the happy path. But `cfg()` is `VIEWS[view]` and is called from
       eight places (visibleRows, totals, the table head, kpiHTML, emptyHTML, exportRows,
       printing), and a view key with no entry makes every one of them throw on `undefined`.
       An empty-but-present entry turns "I missed a call site" from a blank screen into a
       harmless no-op. `types: []` matches no record, which is the correct answer for a screen
       that lists none. */
    dashboard: { label: 'Dashboard', types: [], unit: 'amount', cols: [] },
    contract: {
      label: 'Contract', types: ['Contract'], unit: 'amount',
      cols: [{ key: 'amount', head: 'Contract Amount' }]
    },
    claims: {
      label: 'Claims / Change Order', types: CLAIM_TYPES, unit: 'amount',
      cols: [{ key: 'est_amount', head: 'Estimated Amount' }, { key: 'sub_amount', head: 'Submitted Amount' },
             { key: 'eval_amount', head: 'Evaluated Amount' }, { key: 'approved_amount', head: 'Client Approved Amt' }]
    },
    eot: {
      label: 'Extension of Time', types: ['EOT'], unit: 'days',
      cols: [{ key: 'est_days', head: 'Estimated Days' }, { key: 'sub_days', head: 'Submitted Days' },
             { key: 'eval_days', head: 'Evaluated Days' }, { key: 'approved_days', head: 'Client Approved Days' }]
    }
  };

  // ---- state ---------------------------------------------------------------
  /* ⚠️ `view` LANDS ON THE DASHBOARD (2026-09-16). The owner called this the module's front
     page when the band was commissioned, and a summary nobody lands on is a summary nobody
     reads — which is most of how the band went unnoticed for a day. Reversible in one word;
     `UI.bindHistoryState` still restores whatever tab a link names. */
  var UID = null, pid = null, rows = [], view = 'dashboard';
  var histView = null;   // UI.bindHistoryState() handle for the top-level cc-tabs — see init()
  var canWrite = false, isAdmin = false, sel = {};
  var filters = { q: '', type: '', status: '', dateField: '', from: '', to: '', pkg: '' };
  var filterToggle = null;   // UI.wireFilterToggle() handle for #cc-filters
  /* ⚠️⚠️ MONOTONIC LOAD TOKEN — owner 2026-09-15: *"Loading contracts & claims module loads 3
     different views for split seconds then loads properly."*
     `load()` is async and makes FIVE round trips (records → packages → projects → attachments, plus
     the affected-links read fired alongside), and it is called UN-AWAITED from the project-switch
     handler. So two things could paint out of order:
       1. the affected-links repaint landed while `rows` still held the PREVIOUS project's records
          (or nothing at all on a first open), painting a register that was empty or belonged to
          another project before the real one arrived — the flashes being reported; and
       2. two overlapping loads committed whichever finished LAST, not whichever was asked for.
     `_loadGen` settles both: every await re-checks it, and a paint from a superseded load is
     dropped. `_painted` is the generation whose own render has already run — the links repaint is
     only useful AFTER that, because before it the final render will include the chips anyway
     (`affChip` reads the cache `ensureLinks` fills and never fetches).
     ⚠️ Same device, and the same reason, as project-schedule's own `_loadGen`. */
  var _loadGen = 0, _painted = 0;
  /* A3's tail. Loaded tolerantly — `packages` arrives with
     2026-08-19-packages.sql, and until it is run the picker is simply absent. */
  var PKGS = [];
  /* Every project id in the app — read once, used only to refuse a package that restates
     a project (see wizard.js's `codeConflict`). Tolerant like PKGS: a failed read leaves
     it empty and the guard simply finds fewer conflicts, never a false one. */
  var ALL_PROJECTS = [];

  // ---- helpers -------------------------------------------------------------
  var MNAME = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtDate(s) {
    if (!s) return '';
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return esc(s);
    return String(+p[2]).padStart(2, '0') + '-' + MNAME[+p[1] - 1] + '-' + String(p[0]).slice(2);
  }
  function daysBetween(a, b) {   // whole days, UTC so DST can't shift the count
    if (!a || !b) return null;
    var pa = String(a).slice(0, 10).split('-'), pb = String(b).slice(0, 10).split('-');
    if (pa.length !== 3 || pb.length !== 3) return null;
    var ta = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]), tb = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((tb - ta) / 86400000);
  }
  /* The app prints plain grouped numbers with no currency symbol (see the
     screenshots), so this deliberately does NOT use Fmt.money — matching the
     report people already read matters more than site-wide symbol consistency.
     Days render as plain integers through the same path. */
  function num(v) {
    if (v == null || v === '') return '';
    var n = Number(v);
    if (!isFinite(n)) return '';
    var dec = Math.abs(n % 1) > 0.004 ? 2 : 0;
    return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  // Some legacy descriptions carry literal HTML ("…Proposal <br>of Water Ingress").
  // Everything is escaped on output, so this only stops the tag showing as text.
  function clean(s) { return String(s == null ? '' : s).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim(); }

  function statusOf(r) { return (r.status || '').trim(); }
  function isPending(r) { return statusOf(r) === 'Pending'; }
  // Aging = days a submitted record has been waiting. Only meaningful while
  // Pending; null once it's decided (or if it was never submitted).
  function agingOf(r) {
    if (!isPending(r) || !r.date_submitted) return null;
    var d = daysBetween(r.date_submitted, todayISO());
    return d != null && d >= 0 ? d : null;
  }
  function descOf(r) {
    var ref = clean(r.reference_no), d = clean(r.description) || clean(r.title);
    if (ref && d) return ref + ' — ' + d;
    return d || ref || '(untitled)';
  }
  function cfg() { return VIEWS[view]; }

  // ---- filtering -----------------------------------------------------------
  function visibleRows() {
    var c = cfg(), q = filters.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (c.types.indexOf(r.record_type) < 0) return false;
      if (filters.type && r.record_type !== filters.type) return false;
      if (filters.status && statusOf(r) !== filters.status) return false;
      /* ⚠️ '__none' is a REAL scope, not an absence of one: "which claims has
         nobody assigned to a package yet" is the worklist that makes the filter
         worth having. */
      if (filters.pkg === '__none') { if (r.package_id) return false; }
      else if (filters.pkg && String(r.package_id) !== String(filters.pkg)) return false;
      if (filters.dateField && (filters.from || filters.to)) {
        var v = r[filters.dateField];
        if (!v) return false;                       // no date = outside any window
        v = String(v).slice(0, 10);
        if (filters.from && v < filters.from) return false;
        if (filters.to && v > filters.to) return false;
      }
      if (!q) return true;
      return [r.reference_no, r.description, r.title, r.counterparty, r.remarks, r.record_type]
        .some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; });
    });
  }

  function totals(list) {
    var c = cfg(), t = {};
    c.cols.forEach(function (col) {
      t[col.key] = list.reduce(function (a, r) { var n = Number(r[col.key]); return a + (isFinite(n) ? n : 0); }, 0);
    });
    return t;
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================
  /* SUB-VIEWS — the screens that used to be top-level tabs.
     ⚠️ FOLDED, NOT MERGED. The BOQ and PMI keep their own screens because neither is a
        variant of a register row: the BOQ is revisions + 1,200 lines + billing periods,
        and PMI is `pmi_records` with its own stage pipeline, attachments, per-client
        instruction label and approval roles. Flattening either into the claims table
        would cost that machinery for the sake of a shorter list. They simply stop
        competing at the top level — BOQ opens from inside Contract, PMI from inside
        Claims, each with a way back.
     ⚠️ THE BACK BAR IS A SIBLING OF #cc-view, NOT INSIDE IT. Both sub-modules render by
        replacing #cc-view's innerHTML, so a back link placed inside would be wiped the
        moment the screen it belongs to finished loading — leaving no way out. */
  var sub = null;              // null | 'boq' | 'pmi'
  function subBar() { return document.getElementById('cc-subbar'); }
  function clearSubBar() { var b = subBar(); if (b) b.remove(); }
  /* ⚠️ 'boq' NO LONGER OPENS AN OVERLAY — it lives in the Contract tab now. Callers that
     still ask for it (the wizard's hand-off) are sent to the tab and scrolled to the section,
     so that entry point keeps working without a second BOQ surface existing. PMI is unchanged
     and still a sub-screen. */
  function openSub(which) {
    if (which === 'boq') {
      sub = null;
      if (view !== 'contract') switchTab('contract'); else render();
      setTimeout(function () {
        var t = document.getElementById('cc-boq-head');
        if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      return;
    }
    var mod = which === 'boq' ? window.BOQ : window.PMI;
    if (!mod) { UI.toast(which.toUpperCase() + ' did not load.', 'error'); return; }
    sub = which;
    clearSubBar();
    var host = document.getElementById('cc-view');
    var bar = document.createElement('div');
    bar.id = 'cc-subbar';
    bar.className = 'boq-filters';
    bar.innerHTML = '<button class="pd-btn" id="cc-subback">&larr; Back to ' +
      esc(which === 'boq' ? 'Contract' : 'Claims / Change Order') + '</button>' +
      '<span class="cc-mini">' + esc(which === 'boq' ? 'Bill of quantities' : 'Instructions register') + '</span>';
    host.parentNode.insertBefore(bar, host);
    bar.querySelector('#cc-subback').onclick = function () { sub = null; switchTab(view); };
    document.getElementById('cc-filters').style.display = 'none';
    document.getElementById('cc-topbar-tools').style.display = 'none';
    mod.show(pid, projName());
  }

  function wirePmiEntry(host) {
    var b = host && host.querySelector('#cc-open-pmi');
    if (b) b.onclick = function () { openSub('pmi'); };
  }
  /* ⚠️⚠️ THE INLINE BOQ LOADS WHEN IT IS SCROLLED TO, NOT WHEN THE TAB OPENS. The BOQ is
     1,200+ lines plus its mapping, allocations and every billing period — six round-trips that
     the old sub-screen only paid when you chose to open it. Moving it inline would have charged
     every visit to the Contract tab for a screen most sessions never read, so an
     IntersectionObserver defers it until the section nears the viewport. The owner asked for
     nothing to click; this keeps that promise without the bill.
     ⚠️ `_boqFor` stops a reload on every packages re-render (renaming a lot re-runs that
     function): once loaded for a project we re-PAINT rather than re-FETCH. Keyed by project id,
     so switching projects still reloads — a stale bill would show another project's value. */
  var _boqFor = null, _boqIO = null;
  function mountBoqInline() {
    var el = document.getElementById('cc-boq-inline');
    if (!el || !window.BOQ) return;
    BOQ.mountTo('cc-boq-inline');
    if (_boqIO) { _boqIO.disconnect(); _boqIO = null; }
    if (_boqFor === pid && BOQ.isLoaded && BOQ.isLoaded()) { BOQ.render(); return; }
    var go = function () {
      _boqFor = pid;
      Promise.resolve(BOQ.show(pid, projName())).catch(function (e) {
        _boqFor = null;
        try { console.warn('[cc] inline BOQ failed to load', e); } catch (e2) {}
      });
    };
    /* ⚠️⚠️ IF IT IS ALREADY IN VIEW, LOAD NOW rather than wait to be told. An
       IntersectionObserver only delivers during the rendering steps, and A BACKGROUND TAB DOES
       NOT RUN THEM. Measured 2026-09-07: the section sat at top:587 in a 948px viewport —
       comfortably inside the 500px margin — and the callback never fired, because
       document.visibilityState was 'hidden'. The section stayed on "Loading the BOQ…" forever.
       ⚠️ This also covers the hidden-tab geometry artefact: when clientWidth is 0 every rect
       reads 0, which trips this test and loads eagerly. Loading too early is harmless; never
       loading is not. The observer below then handles the genuine scroll case. */
    var r0 = el.getBoundingClientRect();
    if (r0.top < (window.innerHeight || 0) + 500) { go(); return; }
    if (!window.IntersectionObserver) { go(); return; }
    _boqIO = new IntersectionObserver(function (entries) {
      if (entries.some(function (x) { return x.isIntersecting; })) {
        _boqIO.disconnect(); _boqIO = null; go();
      }
    }, { rootMargin: '500px' });   // start a little before it is on screen
    _boqIO.observe(el);
  }

  /* The affected-activity count for one record, as a chip under its description.
     ⚠️ Reads the cache only and NEVER fetches: render() runs on every filter keystroke, and a
     round trip per row per keystroke is the trap this module's `projects()` dep already records.
     An unloaded or un-migrated cache simply yields no chip. */
  function affChip(r) {
    if (!window.CCAffected) return '';
    var n = CCAffected.countFor(r.id);
    if (!n) return '';
    return '<div class="cc-mini cc-affn" title="' + n + ' schedule activit' + (n === 1 ? 'y is' : 'ies are') +
      ' recorded as affected by this record">' + n + ' activit' + (n === 1 ? 'y' : 'ies') + '</div>';
  }

  function render() {
    var host = document.getElementById('cc-view');
    /* The BOQ tab is a different KIND of screen — the client's contract document
       and its billing, not a register of claims — so it owns its own toolbar,
       filters and sub-tabs (boq.js) and this module's filter bar / record tools
       are hidden rather than left showing controls that do nothing there. */
    if (sub) { (sub === 'boq' ? window.BOQ : window.PMI).render(); return; }
    clearSubBar();
    document.getElementById('cc-filters').style.display = '';
    document.getElementById('cc-topbar-tools').style.display = '';
    if (document.getElementById('cc-filttoggle')) document.getElementById('cc-filttoggle').style.display = '';
    /* ⚠️ Reset before any branch hides it, or Export stays gone after leaving the Dashboard —
       the same shape as the filter toggle above, which is reset here for the same reason. */
    if (document.getElementById('cc-export')) document.getElementById('cc-export').style.display = '';

    /* ==========================================================================================
       THE DASHBOARD TAB (2026-09-16). Owner: *"let's just have a separate tab for the
       dashboard."* It was a band at the top of the Contract tab; measured there, it stood 856px
       and pushed the Contract records table to y=961 — so the tab's own content started at the
       very bottom of a laptop screen, and that was AFTER a trim from 1028px. A summary big
       enough to be useful and a register big enough to read do not fit on one screen, and the
       honest answer is two screens rather than a smaller summary.
       ⚠️ It renders `ccDashHTML()` and nothing else — same function, same figures, same call
       site count. Moving it did not fork it.
       ⚠️ Export is hidden: `cfg().types` is empty here, so it would write an empty workbook,
       which is worse than no button. PRINT IS KEPT — `window.print()` needs no table and this
       is the one screen in the module somebody actually wants on paper for a meeting.
       ⚠️ `+ Add` is kept and falls through to 'Contract' (see openNew's ternary), which is the
       right default from a screen headlined by the contract value. */
    if (view === 'dashboard') {
      document.getElementById('cc-filters').style.display = 'none';
      if (document.getElementById('cc-filttoggle')) document.getElementById('cc-filttoggle').style.display = 'none';
      if (document.getElementById('cc-export')) document.getElementById('cc-export').style.display = 'none';
      document.getElementById('cc-count').textContent = '';
      host.innerHTML = ccDashHTML();
      /* ⚠️ NOT awaited: the tab is already readable from `rows` and `PKGS`, and the BOQ read
         must not delay the landing view. It guards itself on `_loadGen`. */
      ccDashFill();
      return;
    }
    /* The Contract tab is now keyed by PACKAGE — a contract defines a package, so one
       list carries both, and a package with no contract (or a contract with no package)
       is shown rather than dropped. packages.js owns that view. */
    if (view === 'contract' && window.CCPackages) {
      document.getElementById('cc-filters').style.display = 'none';
      if (document.getElementById('cc-filttoggle')) document.getElementById('cc-filttoggle').style.display = 'none';
      /* ⚠️⚠️ THE SUMMARY BAND IS NO LONGER PASSED IN, AND THAT IS NOT A REVERT OF THE FIX ABOVE
         IT — IT IS THE SAME FIX, RELOCATED. The band was unreachable because it hung off
         `kpiHTML()` at the bottom of this function, below this `return`; passing it into this
         view made it reachable, and on 2026-09-16 the owner asked for it on a tab of its own
         instead. It now has ONE call site, in the `view === 'dashboard'` branch above. The
         `dashHTML` parameter went from packages.js with it rather than being left accepting an
         argument nobody passes. */
      CCPackages.show(pid, rows.filter(function (r) { return r.record_type === 'Contract'; }), openSub, openNew,
        function (id) { openForm(rows.find(function (r) { return String(r.id) === String(id); })); },
        mountBoqInline);
      return;
    }
    // The Claim/CO type filter only applies to the claims tab.
    document.getElementById('cc-f-type').style.display = view === 'claims' ? '' : 'none';
    syncClearFilt();

    if (!rows.length) {
      host.innerHTML = (view === 'claims'
        ? '<div class="boq-filters"><button class="pd-btn" id="cc-open-pmi">Instructions (PMI) &rarr;</button></div>' : '') +
        emptyHTML();
      wireEmpty(); wirePmiEntry(host); return;
    }
    var c = cfg(), list = visibleRows(), t = totals(list);
    document.getElementById('cc-count').textContent = 'Showing ' + list.length + ' ' + (list.length === 1 ? 'record' : 'records');

    /* PMI lives inside this register now rather than beside it: an instruction is the
       same commercial conversation one step earlier, and it was a sixth tab nobody could
       keep track of. Its own screen is unchanged — this is the way in. */
    var h = (view === 'claims'
      ? '<div class="boq-filters"><button class="pd-btn" id="cc-open-pmi">Instructions (PMI) &rarr;</button>' +
        '<span class="cc-mini">Client instructions, before they become a claim or change order</span></div>'
      : '') + kpiHTML(list, t);

    h += '<div class="pd-card cc-tablecard"><table class="cc-table"><thead><tr>' +
      '<th class="cc-cb"><input type="checkbox" id="cc-xall" title="Select all shown" /></th>' +
      '<th class="cc-desc">' + (view === 'contract' ? 'Contract Description' : 'Project / ' + (view === 'eot' ? 'EOT' : 'Claim') + ' Description') + '</th>' +
      (view === 'claims' ? '<th class="cc-nowrap">Type</th>' : '') +
      c.cols.map(function (col) { return '<th class="cc-r">' + esc(col.head) + '</th>'; }).join('') +
      (view === 'contract' ? '' : '<th>Status</th><th class="cc-r">Aging</th>') +
      (canWrite ? '<th class="cc-actcol"></th>' : '') +
      '</tr></thead><tbody>';

    var span = 2 + (view === 'claims' ? 1 : 0) + c.cols.length + (view === 'contract' ? 0 : 2) + (canWrite ? 1 : 0);

    // Project roll-up banner (the app's gray total row)
    h += '<tr class="cc-total"><td></td><td class="cc-desc"><div class="cc-total-name">' +
      '<span data-ico="folder" data-ico-size="15"></span>' + esc(projName() || pid || 'Project') + '</div></td>' +
      (view === 'claims' ? '<td></td>' : '') +
      c.cols.map(function (col) { return '<td class="cc-r">' + num(t[col.key]) + '</td>'; }).join('') +
      (view === 'contract' ? '' : '<td></td><td></td>') +
      (canWrite ? '<td></td>' : '') + '</tr>';

    if (!list.length) {
      h += '<tr><td colspan="' + span + '" style="text-align:center;padding:34px;" class="cc-mut">No records match these filters.</td></tr>';
    }

    list.forEach(function (r) {
      var st = statusOf(r), age = agingOf(r);
      var ageCls = age == null ? '' : (age >= 90 ? ' bad' : age >= 30 ? ' warn' : '');
      h += '<tr' + (sel[r.id] ? ' class="cc-selrow"' : '') + ' data-id="' + esc(r.id) + '">' +
        '<td class="cc-cb"><input type="checkbox" data-cb="' + esc(r.id) + '"' + (sel[r.id] ? ' checked' : '') + ' /></td>' +
        '<td class="cc-desc"><div class="cc-desc-txt" title="' + esc(descOf(r)) + '">' + esc(descOf(r)) + '</div>' +
          (r.counterparty ? '<div class="cc-mini">' + esc(clean(r.counterparty)) + '</div>' : '') +
          /* How many schedule activities this record touches. ⚠️ ONLY WHEN THERE ARE SOME --
             a "0 activities" chip on every row of a register whose migration has not been run
             would read as a defect, and the absence of a chip is not a claim about anything. */
          affChip(r) + '</td>' +
        (view === 'claims' ? '<td class="cc-nowrap cc-mini">' + esc(r.record_type || '') + '</td>' : '') +
        c.cols.map(function (col) { return '<td class="cc-r">' + num(r[col.key]) + '</td>'; }).join('') +
        (view === 'contract' ? '' :
          '<td><span class="cc-st ' + (STATUS_CLS[st] || '') + '">' + esc(st || '—') + '</span>' +
            (st === 'Approved' && r.date_approved ? '<span class="cc-st-date">' + fmtDate(r.date_approved) + '</span>' : '') + '</td>' +
          '<td class="cc-r"><span class="cc-age' + ageCls + '">' + (age == null ? '' : age) + '</span></td>') +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-edit="' + esc(r.id) + '" title="Edit">&#9998;</button> ' +
          '<button class="pd-btn" data-del="' + esc(r.id) + '" title="Delete">&times;</button></td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>';

    var selN = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
    if (selN && canWrite) {
      h = '<div class="cc-listbar" style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">' +
        '<span style="font-weight:700;color:var(--pd-red);">' + selN + ' selected</span>' +
        '<select class="pd-select" id="cc-bulkstatus" style="max-width:210px;"><option value="">Set status…</option>' +
        STATUSES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
        '<button class="pd-btn" id="cc-bulkdel">Delete selected</button>' +
        '<button class="pd-btn" id="cc-selnone">Clear selection</button></div>' + h;
    }

    host.innerHTML = h;
    wirePmiEntry(host);
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    wire();
    paintRemote();
  }

  /* ==========================================================================================
     THE REGISTER'S OWN DASHBOARD.
     Owner 2026-09-15: *"Let's rework the front page of the contracts & claims module to have an own
     dashboard within it."* Asked where it should live — a new tab, or inside Contract — the owner
     chose INSIDE THE CONTRACT TAB, which is already what the module opens on. That keeps the
     standing three-tab decision (2026-08-26: *"There are too many tabs to keep track of"*) and the
     1460px title breakpoint that the tab count drives.

     ⚠⚠ IT SUMMARISES THE WHOLE REGISTER, NOT THE CONTRACT TAB. `rows` holds every record type,
       so the band reports contract, change orders, claims and EOT together — which is the point of
       a front page. The list under it is still the Contract list; the band is the module's summary,
       the table is the tab's content.
     ⚠⚠ THE SAME FIGURES, IN THE SAME ORDER, AS THE PROJECT DASHBOARD'S PANEL (2026-09-15). Two
       screens reporting the same register must not describe it differently — so the blocks, the
       cell order and the two-figure treatment of "disputed" are deliberately identical. What
       differs is only the source: this one computes from the rows already in memory, so it costs
       no query; the dashboard reads declared metrics through the shell.
     ⚠ UNFILTERED, and on purpose. It reads `rows`, never `visibleRows()`: a summary that moved
       when someone typed in the search box would be reporting the filter, not the register. The
       count line under the toolbar already says what the filter is showing.
     ========================================================================================== */
  /* ==========================================================================================
     THE MONEY HALF — ONE TABLE, THREE ROWS (2026-09-16).
     Owner, on the 22-card band: trim it. MEASURED AT 1400x1000 BEFORE CHANGING ANYTHING — the
     band stood 1028px tall and the Contract records table, which is the tab's own content, began
     at y=1130, BELOW A 1000px VIEWPORT. So the summary had pushed the thing it summarises off the
     screen: the 2026-09-07 finding in this module ("the page led with its rarest case") wearing a
     new costume.

     ⚠️⚠️ THE 15 CARDS WERE ONE TABLE WEARING THREE HEADERS. Change orders, Cost claims and EOT
       carry the SAME five figures in the same order, and as three separate `.cc-kpis` grids they
       sat 105px apart with a heading between each — so the one reading that matters, comparing a
       column DOWN the three record types, was the one reading you could not do at all. Three rows
       of a table give it away for nothing, and cost ~250px less.
     ⚠️⚠️ THE PROJECT-DASHBOARD INVARIANT IS HONOURED, AND IT IS WORTH SAYING WHICH HALF. The rule
       (2026-09-15) is that the two screens must not DESCRIBE THE REGISTER DIFFERENTLY — the same
       figures, in the same order, with the same two-figure treatment of "disputed". All three hold
       here. What changes is presentation, and the two screens are different objects:
       `dashboard.html`'s panel is one small panel among many, where cards suit; this is the page
       you open TO READ THIS REGISTER, where a table does. Do not "re-sync" them by turning this
       back into cards.
     ⚠️ A LAYER OVER `.cc-table`, never a second table class — the rule this module set on
       2026-09-07, when the Procurement idiom was ported rather than copied. It inherits the head,
       the hover and the right-aligned numeric cells. The ONE override is `min-width`: that class
       carries a 1020px floor sized for the 9-column register, which would put a 6-column summary
       into a horizontal scroll on an ordinary laptop.
     ========================================================================================== */
  /* ⚠️ ONE PREDICATE, read by the table and by the legend that explains the table, so the two
     can never disagree about whether there is a pipeline to describe. `PDClaims.claimsOnly` is
     the same rule `ccTimeHTML` already gates itself on — which is why "With the client" was
     correctly absent on OPW101 while the table above it drew fifteen dashes. */
  function ccHasClaims() { return PDClaims.claimsOnly(rows).length > 0; }

  function ccMoneyTable() {
    /* ⚠️⚠️ ALL THREE EMPTY IS THE ORDINARY EARLY STATE OF A PROJECT, AND IT RENDERED AS FIFTEEN
       EM DASHES. Measured on the live OPW101: one contract, zero change orders, zero cost claims,
       zero extensions of time — so a 3x5 grid of nothing, under a heading, above a paragraph
       defining five columns that had no figures in them. That is most of the tab, saying nothing.
       ⚠️ ONLY when all three are empty. A project with three change orders and no EOT must still
       draw the full table with EOT as a row of dashes: "none raised" is a real fact about that
       record type and collapsing the table would hide it. The test is the register, not one row. */
    if (!ccHasClaims()) {
      return '<div class="cc-dash-h">The pipeline</div>' +
        '<p class="cc-hint">No change orders, cost claims or extensions of time have been raised on ' +
        'this project yet. When they are, this is where what was claimed and what came back is ' +
        'summarised — submitted, evaluated, approved, and the shortfall across decided records.</p>';
    }
    var money = function (v) { return (v == null || isNaN(v)) ? '—' : '₱' + num(Number(v) || 0); };
    var days = function (v) { return (v == null || isNaN(v)) ? '—' : num(Number(v) || 0) + 'd'; };
    var of = function (t) { return rows.filter(function (r) { return r.record_type === t; }); };
    /* ⚠️ Money for claims and change orders, DAYS for EOT, never one total — the key pair travels
       with the row rather than being guessed downstream, which is what makes summing pesos into
       calendar days impossible rather than merely unlikely. */
    var DEFS = [
      { label: 'Change orders', list: of('Change Order'), sub: 'sub_amount', ev: 'eval_amount', ap: 'approved_amount', fmt: money },
      { label: 'Cost claims', list: of('Claim'), sub: 'sub_amount', ev: 'eval_amount', ap: 'approved_amount', fmt: money },
      { label: 'Extension of time', list: of('EOT'), sub: 'sub_days', ev: 'eval_days', ap: 'approved_days', fmt: days }
    ];
    var body = DEFS.map(function (d) {
      /* ⚠️⚠️ THE RULES STAY IN PDClaims (assets/js/claims.js), UNCHANGED — decided = Approved +
         Disapproved (Cancelled was never adjudicated), shortfall clamped at 0. They live there
         because this band, the project dashboard's panel and the portfolio view apply the same
         rules to the same register, and three copies is how three screens come to describe it
         differently. Restructuring the presentation must not quietly fork the arithmetic. */
      var sum = PDClaims.sum;
      var decided = PDClaims.decided(d.list);
      var disapRows = d.list.filter(PDClaims.isDisapproved);
      var short = PDClaims.shortfallOf(d.list, d.sub, d.ap);
      /* ⚠️ A COMPUTED ZERO IS A ZERO; ONLY AN EMPTY ROW IS A DASH — ccBlock's rule, kept verbatim.
         `sum` over an empty list returns 0, and printing that as an em dash made this screen say
         "—" where the project dashboard says "0d", for the same register. */
      var f = d.list.length ? d.fmt : function () { return '—'; };
      var ap = sum(d.list, d.ap);
      var disap = sum(disapRows, d.sub);
      return '<tr>' +
        '<th scope="row">' + esc(d.label) +
          '<i>' + d.list.length + ' record' + (d.list.length === 1 ? '' : 's') + '</i></th>' +
        '<td class="cc-r">' + f(sum(d.list, d.sub)) + '</td>' +
        '<td class="cc-r">' + f(sum(d.list, d.ev)) + '</td>' +
        '<td class="cc-r' + (ap ? ' cc-v-good' : '') + '">' + f(ap) + '</td>' +
        '<td class="cc-r' + (disap ? ' cc-v-bad' : '') + '">' + f(disap) + '</td>' +
        '<td class="cc-r' + (short ? ' cc-v-warn' : '') + '">' + f(short) +
          (d.list.length && !decided.length ? '<i>nothing decided yet</i>' : '') + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="cc-dash-h">The pipeline ' +
        '<span class="cc-mini">what was claimed, and what came back</span></div>' +
      '<div class="cc-sumwrap"><table class="cc-table cc-sum">' +
      '<thead><tr>' +
        '<th scope="col"><span class="cc-sr">Record type</span></th>' +
        '<th scope="col" class="cc-r" title="What was claimed, as submitted to the client — before any review.">Submitted<i>as claimed</i></th>' +
        '<th scope="col" class="cc-r" title="The figure after review, before the client has decided.">Evaluated<i>after review</i></th>' +
        '<th scope="col" class="cc-r" title="What the client approved. Claimed, not certified — certification is the bill of quantities.">Approved<i>client approved</i></th>' +
        '<th scope="col" class="cc-r" title="What the client rejected outright. Records still pending a decision count in neither this nor Approved.">Disapproved<i>rejected outright</i></th>' +
        /* ⚠️⚠️ THE BASIS IS IN THE HEADER BECAUSE THE THREE FIGURES DO NOT RECONCILE ON SCREEN.
           Measured on the fixture: Submitted ₱145,400,000 minus Approved ₱68,500,000 is
           ₱76,900,000, while Shortfall reads ₱35,900,000 — because Submitted and Approved sum
           EVERY record while Shortfall sums DECIDED ones only. Three numbers in a row where two
           look like they make the third is the same trap this module already paid for once, when
           the aging bars were measured on a different key from the headline beside them. Saying
           "decided only" at the point of confusion is the fix; the hint paragraph 400px further
           down was not, and had been there the whole time. */
        '<th scope="col" class="cc-r" title="Submitted minus approved, across DECIDED records only — approved plus disapproved. Anything still pending is excluded, which is why these three columns do not reconcile across a row.">Shortfall<i>decided only</i></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  /* ==========================================================================================
     THE DASHBOARD, REBUILT AROUND THE COMMERCIAL POSITION — 2026-09-16.

     Owner, on the live Dashboard of OPW101 — a ₱3.67B contract with no claims raised:
     *"Dashboard needs complete rework"*.

     ⚠️⚠️ THE PAGE HAD NO SUBJECT WHEN ITS ONLY SUBJECT WAS EMPTY. Every block derived from the
     CLAIMS pipeline: `ccTimeHTML()` returns '' outright with no claims, `ccMoneyTable()` collapses
     to one sentence, the legend suppresses itself — and the one non-claims block (packages) was
     empty too. So the whole tab rendered TWO SENTENCES AND ONE NUMBER, then ~700px of nothing,
     on the state a project is in for most of its life. A register is not only its disputes.

     ⚠️ Owner chose the larger of the two answers on offer — commercial first, claims folded in —
     so the subject is now the CONTRACT and where its money has got to, with the pipeline as one
     section of it rather than the whole page.

       1 · a VERDICT line: the contract, who it is with, and what has been certified
       2 · FOUR cards, each triggering a different action
       3 · the CONTRACT RECORD's own facts — reference, counterparty, signed date, ALL of which
           the old dashboard computed nothing from and never showed
       4 · the packages, unchanged — the contract value broken up
       5 · the claims pipeline, and a POSITIVE answer when there is none

     ⚠️⚠️ THE COMMERCIAL FIGURES ARE FILLED IN ASYNCHRONOUSLY and the page is useful before they
     land. `BOQ.commercialSummary()` is a read; the Dashboard is the LANDING view, so blocking the
     first paint on it would make every open of this module wait on the BOQ — which is what the
     Contract tab's lazy mount exists to avoid. Everything here that comes from `rows` and `PKGS`
     is already in memory and renders immediately.

     ⚠️ NOTHING ON THIS TAB MOVES WITH THE FILTERS. It reads `rows`, never `visibleRows()` — a
     summary that changed when someone typed in the search box would be reporting the filter.
     ========================================================================================== */
  function ccDashHTML() {
    var money = function (v) { return (v == null || isNaN(v)) ? '—' : '₱' + num(Number(v) || 0); };
    var short = function (v) {
      return (v == null || isNaN(v)) ? '—' : (window.Fmt && Fmt.moneyShort ? Fmt.moneyShort(v) : money(v));
    };
    var of = function (t) { return rows.filter(function (r) { return r.record_type === t; }); };
    var contracts = of('Contract');
    var ctVal = contracts.reduce(function (a, r) { var v = Number(r.amount); return a + (isFinite(v) ? v : 0); }, 0);
    var pk = (PKGS || []).slice();
    var pkAmt = pk.reduce(function (a, r) { var v = Number(r.contract_amount); return a + (isFinite(v) ? v : 0); }, 0);
    var base = ctVal > 0 ? ctVal : pkAmt;

    /* ---- the contract's own facts, which this tab has never shown -------------------------
       ⚠️ The LARGEST contract record leads. A project routinely carries one; where it carries
       several the biggest is the one a reader means by "the contract", and the rest are counted
       beside it rather than silently dropped. */
    var lead = contracts.slice().sort(function (a, b) {
      return (Number(b.amount) || 0) - (Number(a.amount) || 0);
    })[0] || null;

    /* ---- claims exposure, from rows already in memory -------------------------------------
       ⚠️ Through PDClaims, never a local rule: the module band, the project dashboard panel and
       the portfolio view must not describe this register differently. */
    var claimish = PDClaims.claimsOnly(rows);
    var cash = claimish.filter(function (r) { return PDClaims.typeOf(r) !== 'EOT'; });
    var eots = PDClaims.ofType(claimish, 'EOT');
    var pendVal = cash.length ? PDClaims.pendingValue(cash, 'eval_amount', 'sub_amount') : null;
    var shortfall = cash.length ? PDClaims.shortfallOf(cash, 'sub_amount', 'approved_amount') : null;
    var eotGranted = eots.length ? PDClaims.sum(PDClaims.decided(eots), 'approved_days') : null;
    var eotPending = eots.length ? PDClaims.pendingValue(eots, 'eval_days', 'sub_days') : null;

    /* ⚠️⚠️ EXPOSURE IS PENDING + SHORTFALL, the same pair the portfolio view ranks projects by
       (2026-09-15 q). Pending is what the client has not answered; shortfall is what they
       answered DOWN. Reporting only one of them understates the position in whichever direction
       that project happens to sit. */
    var exposure = (pendVal == null && shortfall == null) ? null : (Number(pendVal || 0) + Number(shortfall || 0));

    /* ⚠️⚠️ THE SHARED COMPONENT, NOT A MODULE-LOCAL CARD. `UI.kpi` reserves the two lines a
       wrapping label needs so that a one-word and a three-word label still line their VALUES up
       across the row, and `UI.kpis` is the shared auto-fit strip. This is the 2026-09-10 (w2)
       convergence, where five modules each hardcoding their own column count and breakpoints was
       the defect — and where `.pd-kpi` being used NOWHERE on a page was itself the finding.
       ⚠️ `--pd-ok` / `--pd-warn` are SURFACE tokens and would fail AA as small text (3.46:1 for
       warn). `.pd-kpi-value` is 20px/800 — LARGE text, a 3:1 threshold — which both clear.
       Checked against the token note rather than assumed. */
    function card(label, val, sub, tone, title) {
      return UI.kpi(label, val, { sub: sub || '', cls: tone ? 'pd-kpi-' + tone : '', title: title || '' });
    }

    /* ⚠️⚠️ "NONE RAISED" IS AN ANSWER, NOT AN ABSENCE, and this is the half the old page got
       wrong. On a clean register the honest reading is *no exposure* — good news, stated as
       such — rather than three empty states apologising for having nothing to show. */
    /* ⚠⚠ SUB-LINES ARE ONE SHORT LINE, NOT A SENTENCE. `.pd-kpi-sub` is
       `white-space:nowrap; text-overflow:ellipsis` by design, so anything past ~34 characters is
       not shortened — it is CUT, mid-figure. Measured in the harness at a 235px card: the full
       peso amounts ran off as "₱632,924,530 of ₱3,670,000,00…", which reads as a DIFFERENT
       NUMBER rather than as a truncation. Every sub here is short-form money and is asserted
       against `scrollWidth > clientWidth`. */
    var expCard = claimish.length
      ? card('Claims exposure', money(exposure),
             short(pendVal) + ' pending · ' + short(shortfall) + ' cut',
             exposure > 0 ? 'warn' : 'ok',
             /* ⚠ The full sentence lives on the TITLE, where it cannot be cut. The sub-line is
                one ellipsised line and "cut" is the register's own word for a shortfall. */
             money(pendVal) + ' awaiting a decision from the client, ' + money(shortfall) +
             ' claimed but not certified across decided records')
      : card('Claims exposure', 'None', 'none raised on this contract', 'ok');

    var timeCard = eots.length
      ? card('Time granted', (eotGranted == null ? '—' : num(eotGranted) + 'd'),
             (eotPending ? num(eotPending) + 'd still with the client' : 'nothing outstanding'),
             null)
      : card('Time granted', 'None', 'no extension of time sought', 'ok');

    /* ---- the verdict ---------------------------------------------------------------------- */
    var who = lead && lead.counterparty ? ' with <b>' + esc(lead.counterparty) + '</b>' : '';
    var when = lead && lead.date_filed ? ' · signed ' + esc(Fmt.date(lead.date_filed)) : '';
    var verdict = ctVal
      ? '<b>' + short(ctVal) + '</b> contract' + who + when
      : (pk.length ? '<b>' + short(pkAmt) + '</b> across ' + pk.length + ' package' + (pk.length === 1 ? '' : 's')
                   : 'No contract recorded on this project yet');

    return '<div class="cc-dash">' +
      '<div class="cc-dash-verdict">' + verdict +
        /* filled by ccDashFill(); the page is readable before it lands */
        '<i id="cc-dash-comm" class="cc-dash-comm">reading the bill of quantities…</i></div>' +

      UI.kpis(
        card('Contract value', money(ctVal),
             pk.length ? 'across ' + pk.length + ' package' + (pk.length === 1 ? '' : 's')
                       : (contracts.length > 1 ? contracts.length + ' contract records' : 'no package breakdown')) +
        '<div id="cc-dash-certcard">' +
          card('Certified to date', '—', 'reading the bill of quantities…') + '</div>' +
        expCard + timeCard) +

      /* ---- the contract record, which the old dashboard never showed --------------------- */
      (lead
        ? '<div class="cc-dash-h">The contract</div>' +
          '<ul class="cc-dash-facts">' +
            (lead.reference_no ? '<li><span>Reference</span><b>' + esc(lead.reference_no) + '</b></li>' : '') +
            (lead.counterparty ? '<li><span>Counterparty</span><b>' + esc(lead.counterparty) + '</b></li>' : '') +
            (lead.date_filed ? '<li><span>Signed</span><b>' + esc(Fmt.date(lead.date_filed)) + '</b></li>' : '') +
            '<li><span>Value</span><b>' + money(Number(lead.amount) || 0) + '</b></li>' +
            (contracts.length > 1
              ? '<li><span>Other records</span><b>' + (contracts.length - 1) + ' more, ' +
                money(ctVal - (Number(lead.amount) || 0)) + '</b></li>' : '') +
          '</ul>' +
          /* ==== THE SCOPE OF WORKS, AS A NAMED FIELD =======================================
             Owner 2026-09-17: *"the contract description UI needs to be improved as well."*
             It was `<p class="cc-hint">` — the same muted style the page uses for asides and
             hints — holding the single most substantive sentence on the tab: the scope of works.
             On OPW101 that is 40 words of comma-separated trades set in the colour the eye is
             trained to skip, running the full width of a 1,900px monitor at roughly 220 characters
             a line, which is about three times a readable measure.
             ⚠️ It is now a labelled block, in body ink, capped at ~78ch. Long scopes clamp to
             four lines behind a plain "Show full scope" toggle — `<details>`, the same disclosure
             the hand-off band uses, so it survives the `innerHTML` rebuild every render does. */
          (lead.description
            ? (function (d) {
                var txt = clean(d);
                var LONG = 320;
                return '<div class="cc-scope">' +
                  '<div class="cc-scope-lbl">Scope of works</div>' +
                  (txt.length > LONG
                    ? '<details class="cc-scope-more"><summary><span>' +
                        esc(txt.slice(0, LONG).replace(/\s+\S*$/, '')) + '…</span></summary>' +
                        '<p>' + esc(txt) + '</p></details>'
                    : '<p>' + esc(txt) + '</p>') +
                  '</div>';
              })(lead.description)
            : '')
        : '<p class="cc-hint">No contract record yet. <b>+ Add</b> records the contract, and its ' +
          'value becomes the basis every claim and change order is measured against.</p>') +

      ccDashPkgHTML(pk, pkAmt, ctVal, base, money) +

      /* ⚠ NO HEADING HERE. `ccMoneyTable` opens with its own `cc-dash-h` "The pipeline" in
         BOTH of its branches, so adding one printed the heading TWICE — measured in the
         harness, on every case. */
      ccMoneyTable() +
      ccTimeHTML() +
      /* ⚠️⚠️ THIS GLOSSARY USED TO BE A PARAGRAPH UNDER THE TABLE. Owner 2026-09-17:
         *"the highlighted UI needs fixing — these are tooltips and not necessarily to be shown in
         the main page."* Four sentences of definitions, printed on every visit, below the figures
         they define, for a reader who by then has already interpreted them. The definitions now sit
         on the COLUMN HEADERS as `title` text — see `ccMoneyTable` — where the word being defined
         actually is, and each header already carries a short `<i>` sub-label so the page still says
         what the column means without being asked.
         ⚠️ The one fact that is NOT a definition is kept, because nothing else on screen
         implies it: this band summarises the whole register and does not follow the filters. It is
         one muted line rather than a paragraph. */
      (ccHasClaims()
        ? '<p class="cc-mini cc-dash-scope">Whole register — this summary does not move with the filters.</p>'
        : '') +
      '</div>';
  }

  /* The packages block, lifted out of ccDashHTML unchanged so the rebuilt dashboard reads as one
     sequence rather than a wall. ⚠️ Every rule it carries is the owner's own from 2026-09-15 (f):
     the packages are the contract value BROKEN UP, not a count beside it; the remainder is a ROW
     because "not allocated to a package" is the useful fact; and the largest three are shown with
     the remainder kept OUT of the fold. */
  function ccDashPkgHTML(pk, pkAmt, ctVal, base, money) {
    /* ⚠️ NOTHING IS PRINTED WHEN THERE ARE NO PACKAGES. Owner 2026-09-17: *"'No package
       breakdown yet…' should be removed — it doesn't provide any valuable information, it just
       states the current."* Right on both counts, and the state it stated is already on screen:
       the Contract value card's own subtext reads **no package breakdown**. A paragraph repeating a
       card three inches above it, in the body of a management dashboard, is noise that every reader
       pays for on every visit so that a first-time reader learns where packages are set up. */
    if (!pk.length) return '';
    var pkRows = pk.sort(function (a, b) { return (Number(b.contract_amount) || 0) - (Number(a.contract_amount) || 0); })
      .map(function (r) {
        var v = Number(r.contract_amount);
        var share = (base && isFinite(v)) ? Math.round(v / base * 100) : null;
        return '<li class="cc-dash-pk"><span>' + esc([r.code, r.name].filter(Boolean).join(' · ') || 'Untitled package') +
          '<i>' + (share == null ? 'no amount set' : share + '% of the contract value') +
          (String(r.status) === 'archived' ? ' · archived' : '') + '</i></span>' +
          '<b>' + money(isFinite(v) ? v : 0) + '</b></li>';
      });
    var rest = ctVal - pkAmt;
    var PK_SHOW = 3;
    var pkHead = pkRows.slice(0, PK_SHOW), pkMore = pkRows.slice(PK_SHOW);
    if (ctVal && rest > 1) {
      pkHead.push('<li class="cc-dash-pk cc-dash-rest"><span>Not allocated to a package' +
        '<i>' + Math.round(rest / base * 100) + '% of the contract value</i></span><b>' + money(rest) + '</b></li>');
    }
    return '<div class="cc-dash-h">Packages <span class="cc-mini">' + money(pkAmt) + ' of ' + money(ctVal) + '</span></div>' +
      '<div class="cc-dash-bar"><i style="width:' +
        Math.max(0, Math.min(100, base ? Math.round(pkAmt / base * 100) : 0)) + '%"></i></div>' +
      '<ul class="cc-dash-pks">' + pkHead.join('') + '</ul>' +
      (pkMore.length
        ? '<details class="cc-more"><summary>' + pkMore.length + ' smaller package' +
          (pkMore.length === 1 ? '' : 's') + '<span>already counted in the bar above</span></summary>' +
          '<ul class="cc-dash-pks">' + pkMore.join('') + '</ul></details>'
        : '') +
      (ctVal && rest < -1
        ? '<p class="cc-hint">The packages total ' + money(pkAmt) + ', more than the contract records add up to. ' +
          'One of the two is wrong — the package amounts or the contract record.</p>' : '');
  }

  /* ==========================================================================================
     THE ASYNC HALF — the commercial position, read once the page is already on screen.

     ⚠️⚠️ GUARDED BY `_loadGen`, THE MODULE'S OWN RACE TOKEN. A project switch bumps it, and a
     summary that resolves after the switch must not paint the previous project's certified
     figure over the new one. That is the exact defect 2026-09-15 (o) was written to fix, and an
     async fill on the LANDING view is the easiest place to reintroduce it.

     ⚠️ Every absent figure says WHICH state it is in rather than printing a zero — no BOQ, a
     draft BOQ (which bills nothing, by the trigger), issued but unbilled, or a failed read.
     ========================================================================================== */
  async function ccDashFill() {
    var gen = _loadGen;
    var slot = document.getElementById('cc-dash-comm');
    var cardSlot = document.getElementById('cc-dash-certcard');
    if (!slot && !cardSlot) return;
    if (!pid || !window.BOQ || !BOQ.commercialSummary) {
      if (slot) slot.textContent = '';
      if (cardSlot) cardSlot.innerHTML = certCard('—', 'no bill of quantities on this project');
      return;
    }
    var s;
    try { s = await BOQ.commercialSummary(pid); }
    catch (e) { s = { state: 'none', err: (e && e.message) || String(e) }; }
    /* the page may have moved on while that was out */
    if (gen !== _loadGen) return;
    slot = document.getElementById('cc-dash-comm');
    cardSlot = document.getElementById('cc-dash-certcard');
    if (!slot && !cardSlot) return;

    var money = function (v) { return (v == null || isNaN(v)) ? '—' : '₱' + num(Number(v) || 0); };
    /* ⚠ SHORT-FORM in the sub-line, full figures in the verdict sentence above it. `.pd-kpi-sub`
       ellipsises at one line, and a cut peso figure reads as a smaller number. */
    var short = function (v) {
      return (v == null || isNaN(v)) ? '—' : (window.Fmt && Fmt.moneyShort ? Fmt.moneyShort(v) : money(v));
    };
    var pctTxt = function (p) { return p == null ? '—' : (p * 100).toFixed(1) + '%'; };

    var line = '', cv = '—', cs = '', tone = null;
    if (s.err) {
      line = ' · the bill of quantities could not be read';
      cs = 'could not be read';
    } else if (s.state === 'none') {
      line = ' · no bill of quantities recorded';
      cs = 'no BOQ on this project';
    } else if (s.state === 'draft') {
      /* ⚠️ Measured 2026-09-14 (q): `is_current` is false on every draft, so a project whose
         BOQ is still a draft genuinely has no contract total to report. Say that, do not print 0. */
      line = ' · the bill of quantities is still a draft, so nothing bills from it yet';
      /* ⚠ PLAIN TEXT, NOT esc()'d. `UI.kpi` escapes `opts.sub` itself, so an ampersand in a
         revision number or a billing reference would arrive here as `&amp;amp;` on screen. */
      cs = 'BOQ rev ' + (s.revNo || '—') + ' is a draft';
    } else if (s.state === 'issued') {
      line = ' · BOQ ' + money(s.contract) + ' issued, nothing billed yet';
      cs = short(s.contract) + ' issued, nothing billed';
    } else {
      line = ' · <b>' + pctTxt(s.poc) + '</b> certified, ' + money(s.revenue) + ' billed to date';
      cv = pctTxt(s.poc);
      cs = short(s.revenue) + ' of ' + short(s.contract) +
           (s.lastBilling ? ' · billing ' + s.lastBilling : '');
      tone = 'ok';
    }
    if (slot) slot.innerHTML = line;
    if (cardSlot) cardSlot.innerHTML = certCard(cv, cs, tone);

    function certCard(v, sub, t) {
      return UI.kpi('Certified to date', v, { sub: sub, cls: t ? 'pd-kpi-' + t : '' });
    }
  }

  /* ==========================================================================================
     THE TIME HALF OF THE DASHBOARD — added 2026-09-15.
     Owner: *"let's develop a dashboard in the contracts & claims register."* The money half
     already existed (`ccDashHTML` above, shipped that morning); what it could not answer is the
     question a commercial meeting actually opens with — **how long has the client been sitting on
     this, and how long do they normally take?**

     ⚠️⚠️ EVERY FIGURE HERE COMES FROM COLUMNS THAT ALREADY EXIST. `date_submitted`,
       `date_evaluated` and `date_approved` have been on this table since 2026-07-20 and nothing
       read them except the register's own per-row aging. No migration, no new field to maintain.
     ⚠️ Money for claims and change orders, DAYS for EOT, never one total — `PDClaims` takes the
       key pair from here rather than guessing, which is what makes that impossible to get wrong.
     ⚠️ Unfiltered, like the band above it: a summary that moved when someone typed in the search
       box would be reporting the filter rather than the register.
     ========================================================================================== */
  function ccTimeHTML() {
    var money = function (v) { return (v == null || isNaN(v)) ? '—' : '₱' + num(Number(v) || 0); };
    var claimish = PDClaims.claimsOnly(rows);
    if (!claimish.length) return '';

    var cash = claimish.filter(function (r) { return PDClaims.typeOf(r) !== 'EOT'; });
    var eots = PDClaims.ofType(claimish, 'EOT');
    var today = PDClaims.todayISO();

    /* ---- what is with the client, and for how long ---- */
    /* ⚠️⚠️ THE SAME KEY LIST `pendingValue` GETS, and the first cut did not do this: the bars
       measured `sub_amount` while the “Pending value” KPI two lines above preferred `eval_amount`,
       so the bars did not add up to the headline beside them. Caught by a test on the portfolio
       view, which shares this rule — the bug was here too and its own test had asserted the wrong
       figure as correct. */
    var AMT = ['eval_amount', 'sub_amount'], DAYS = ['eval_days', 'sub_days'];
    var ag = PDClaims.agingBuckets(cash, AMT, today);
    var eotAg = PDClaims.agingBuckets(eots, DAYS, today);
    var pendVal = PDClaims.pendingValue(cash, 'eval_amount', 'sub_amount');
    var pendDays = PDClaims.pendingValue(eots, 'eval_days', 'sub_days');
    var rec = PDClaims.recoveryOf(cash, 'sub_amount', 'approved_amount');

    var bars = '';
    var worst = Math.max.apply(null, ag.buckets.map(function (b) { return b.value; }).concat([1]));
    ag.buckets.forEach(function (b) {
      /* ⚠️ The bar is scaled to the LARGEST BUCKET, not to the total. Scaled to the total, a
         healthy register (almost everything in 0–30) draws three invisible slivers and the one
         bucket that matters cannot be compared against them. */
      var w = Math.max(b.value ? 2 : 0, Math.round(b.value / worst * 100));
      var tone = b.key === '90+' ? ' cc-age-bad' : (b.key === '61-90' ? ' cc-age-warn' : '');
      bars += '<li class="cc-age' + tone + '"><span class="cc-age-l">' + esc(b.label) + '</span>' +
        '<span class="cc-age-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="cc-age-v">' + (b.n ? money(b.value) + ' · ' + b.n : '—') + '</span></li>';
    });

    /* ---- how long each hand-off takes ---- */
    var st = PDClaims.stageDays(claimish);
    var legs = ['toEvaluate', 'toApprove', 'endToEnd'].map(function (k) {
      var l = st[k];
      /* ⚠️ A leg with no completed records reads "no data", never 0 days. Zero says the client
         turns these round the same day, which is the opposite of "we cannot tell yet". */
      return kpi(l.label, l.days == null ? '—' : l.days + 'd',
                 l.days == null ? 'no decided records yet' : 'average over ' + l.n);
    }).join('');

    /* ⚠️⚠️ THE HEADER COUNTS THE UNSENT ONES TOO, AND THE FIRST CUT DID NOT. `agingBuckets().n`
       is the count of records with an AGE, so a record that is Pending but never submitted was
       missing from this total while appearing on its own row two lines below — a header that
       disagrees with the list under it. Caught by a test asserting the count, not by reading. */
    var pendN = ag.n + ag.unsent + eotAg.n + eotAg.unsent;
    var oldTone = ag.oldest == null ? '' : (ag.oldest > 90 ? ' cc-v-bad' : (ag.oldest > 60 ? ' cc-v-warn' : ''));
    return '<div class="cc-dash-h" title="Aging counts from DATE SUBMITTED, and only while a record is Pending. A record with no submitted date is listed separately — it is waiting on us, not on the client. Hand-off times average the records that carry both dates.">With the client ' +
        '<span class="cc-mini">' + pendN + ' pending' +
        (ag.oldest != null
          ? ' · <b class="cc-oldest' + oldTone + '">oldest ' + ag.oldest + ' days</b>'
          : '') + '</span></div>' +
      '<div class="cc-kpis">' +
        kpi('Pending value', money(pendVal), 'claims & change orders', pendVal ? 'warn' : '') +
        kpi('Pending time', pendDays ? num(pendDays) + 'd' : '—', 'extension of time claimed') +
        /* ⚠️⚠️ THE "OLDEST PENDING" CARD IS GONE BECAUSE IT DUPLICATED ITS OWN SECTION HEADER.
           Measured on screen: the header renders "With the client — 3 pending · oldest 137 days"
           and the card two lines below it read "Oldest pending 137d". One figure, twice, 40px apart.
           ⚠️ What the card DID carry and the header did not is the TONE — amber past 60 days, red
           past 90 — so that moved up into the header rather than going with the card. A
           de-duplication that quietly deletes a signal is not a de-duplication. */
        /* ⚠️ Recovery is null, not 0, until something has been decided — see PDClaims rule 2. */
        kpi('Recovery rate', rec == null ? '—' : Math.round(rec) + '%',
            rec == null ? 'nothing decided yet' : 'approved ÷ submitted, decided only',
            rec == null ? '' : (rec >= 80 ? 'good' : (rec < 50 ? 'bad' : 'warn'))) +
      '</div>' +
      '<ul class="cc-ages">' + bars +
        /* ⚠️ Never-submitted is its own line, never folded into 0–30. "We have not sent it" and
           "they have not answered" are different problems with different owners. */
        (ag.unsent ? '<li class="cc-age cc-age-unsent"><span class="cc-age-l">Not submitted</span>' +
          '<span class="cc-age-bar"></span><span class="cc-age-v">' + money(ag.unsentValue) +
          ' · ' + ag.unsent + '</span></li>' : '') +
      '</ul>' +
      /* ⚠️⚠️ FOLDED, NOT DELETED — and the summary carries the headline so it need not be opened
         to get the answer. These are averages over decided records: a quarterly read, not a
         per-visit one, and three cards of them sat between the aging bars and the register's own
         table. ⚠️ This is the ONLY screen in the app that calls `PDClaims.stageDays` — checked, not
         assumed — so deleting the row outright would have made that rule dead code with nothing on
         screen left to justify keeping it.
         ⚠️ A `<details>` rather than a hand-built popover: it opens and closes itself, is
         keyboard-reachable for free, and has no state to lose — and this band is rebuilt by
         `innerHTML` on every render, which is exactly what strands a hand-rolled toggle. */
      '<details class="cc-more"><summary>How long hand-offs take' +
        '<span>' + (st.endToEnd.days == null
          ? 'nothing decided yet'
          : 'submitted → decided averages ' + st.endToEnd.days + 'd') + '</span></summary>' +
        '<div class="cc-kpis">' + legs + '</div></details>' +
      '';   /* ⚠️ The aging note that used to print here is now the `title` on the "With the
                 client" heading above — owner 2026-09-17: *"these are tooltips and not necessarily
                 to be shown in the main page."* It defined a word (aging) rather than reporting a
                 fact, and it sat three blocks BELOW the bars it defined. */
  }

  function kpiHTML(list, t) {
    var c = cfg();
    /* ⚠ The Contract tab's two KPI cards (`Contracts` / `Total contract value`) are gone: the
       dashboard above carries the contract value with its package breakdown, and a record count is
       already in the toolbar's "Showing N records". */
    /* ⚠️ THE `view === 'contract'` BRANCH IS GONE FROM HERE, and its absence is the point.
       `render()` hands the Contract tab to `CCPackages.show()` and returns before this function is
       ever called, so this line was unreachable — which is exactly how the dashboard came to be
       built, shipped and never seen. `ccDashHTML` is now passed INTO that view. Do not restore a
       call here: one renderer with one call site is what stops the band and the packages view
       disagreeing about the contract value. */
    var pend = list.filter(isPending);
    var ages = pend.map(agingOf).filter(function (a) { return a != null; });
    var oldest = ages.length ? Math.max.apply(null, ages) : 0;
    var appr = list.filter(function (r) { return statusOf(r) === 'Approved'; }).length;
    var subKey = c.cols[1].key, apprKey = c.cols[3].key;
    /* Recovery is measured over DECIDED records only (Approved + Disapproved).
       Dividing by everything submitted would count still-Pending claims as
       failures — on a young register that reads as a catastrophic ~0%, when it
       really just means the client hasn't ruled yet. Cancelled is excluded too:
       a withdrawn claim was never adjudicated. */
    var decided = list.filter(function (r) { var s = statusOf(r); return s === 'Approved' || s === 'Disapproved'; });
    var decSub = decided.reduce(function (a, r) { var n = Number(r[subKey]); return a + (isFinite(n) ? n : 0); }, 0);
    var decAppr = decided.reduce(function (a, r) { var n = Number(r[apprKey]); return a + (isFinite(n) ? n : 0); }, 0);
    var recovery = decSub ? (decAppr / decSub * 100) : null;
    return '<div class="cc-kpis">' +
      kpi(c.label, list.length, 'records shown') +
      kpi('Submitted', num(t[subKey]), view === 'eot' ? 'days claimed' : 'total submitted') +
      kpi('Client approved', num(t[apprKey]), view === 'eot' ? 'days granted' : 'total approved', 'good') +
      kpi('Recovery rate', recovery == null ? '—' : recovery.toFixed(1) + '%',
        decided.length ? 'of ' + decided.length + ' decided ' + (decided.length === 1 ? 'record' : 'records') : 'nothing decided yet') +
      kpi('Pending', pend.length, appr + ' approved', pend.length ? 'warn' : '') +
      kpi('Oldest pending', oldest ? oldest + 'd' : '—', 'days awaiting decision', oldest >= 90 ? 'bad' : oldest >= 30 ? 'warn' : '') +
      '</div>';
  }
  function kpi(label, value, sub, cls) {
    return '<div class="cc-kpi ' + (cls || '') + '"><div class="cc-kpi-l">' + esc(label) + '</div>' +
      '<div class="cc-kpi-v">' + value + '</div><div class="cc-kpi-s">' + esc(sub || '') + '</div></div>';
  }

  function emptyHTML() {
    return '<div class="pd-card cc-empty"><h3>No ' + esc(cfg().label.toLowerCase()) + ' records yet</h3>' +
      '<p>Add contracts, claims, change orders and extension-of-time records to track them through evaluation and client approval.</p>' +
      (canWrite ? '<p style="margin-top:14px;"><button class="pd-btn pd-btn-primary" id="cc-e-add">Add a record</button></p>' : '') + '</div>';
  }
  function wireEmpty() {
    var b = document.getElementById('cc-e-add'); if (b) b.onclick = openNew;
  }

  function wire() {
    var host = document.getElementById('cc-view');
    host.querySelectorAll('[data-cb]').forEach(function (cb) {
      cb.onclick = function (e) { e.stopPropagation(); sel[cb.dataset.cb] = cb.checked; render(); };
    });
    var xall = document.getElementById('cc-xall');
    if (xall) xall.onclick = function () { visibleRows().forEach(function (r) { sel[r.id] = xall.checked; }); render(); };
    host.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openForm(rows.find(function (r) { return String(r.id) === b.dataset.edit; })); };
    });
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); delRow(b.dataset.del); };
    });
    var bs = document.getElementById('cc-bulkstatus'); if (bs) bs.onchange = function () { if (bs.value) bulkStatus(bs.value); };
    var bd = document.getElementById('cc-bulkdel'); if (bd) bd.onclick = bulkDelete;
    var sn = document.getElementById('cc-selnone'); if (sn) sn.onclick = function () { sel = {}; render(); };
  }

  // ==========================================================================
  // CRUD
  // ==========================================================================
  /* THE ONE WRITE PATH for a Contracts & Claims record, shared by the compact edit
     form and the wizard. ⚠️ Extracted rather than copied: two payload builders for one
     table drift, and the half that drifts is always the one you are not looking at.
     Returns { ok, error } — the caller owns its own button state and toasts. */
  /* ⚠️ A COLUMN THIS DATABASE DOES NOT HAVE, CARRYING NOTHING, MUST NOT COST THE SAVE.
     Measured live: `contracts_claims` on this project predates the four
     est/sub/eval/approved columns, so PostgREST rejected the whole insert with
     "Could not find the 'approved_amount' column … in the schema cache" — and a Contract
     sends all four as NULL, because a contract has no claim pipeline. The record was
     unsavable over columns that held nothing.
     ⚠️ ONLY A NULL IS DROPPED. A column carrying a real figure that the database cannot
        store is a genuine failure and still stops the save loudly — silently discarding
        money is the one outcome worse than an error. The retry is bounded, and it names
        the migration either way so the schema still gets fixed. */
  function _dropMissingNull(payload, err) {
    var m = /(?:column|find the)\s+'?"?([a-z_]+)"?'?\s+(?:column\s+)?of/i.exec(err && err.message || '');
    var col = m && m[1];
    if (!col || !(col in payload) || payload[col] !== null) return null;
    var next = Object.assign({}, payload); delete next[col];
    return next;
  }
  async function persistRecord(payload, existing) {
    var body = Object.assign({}, payload), dropped = [];
    if (!existing) { body.created_by = UID; body.sort_order = rows.length; }
    for (var attempt = 0; attempt < 8; attempt++) {
      var err = null, out = null;
      if (existing) {
        if (window.PDSync) {
          var w = await PDSync.write({ table: TABLE, op: 'update', id: existing.id, patch: body });
          if (!w.ok) err = w.error || new Error('Save failed');
        } else {
          var ur = await sb().from(TABLE).update(body).eq('id', existing.id);
          err = ur.error;
        }
      } else {
        var ir = await sb().from(TABLE).insert(body).select().single();
        err = ir.error; out = ir.data;
      }
      if (!err) {
        if (existing) {
          Object.assign(existing, body);   // optimistic — applies whether online or queued offline
          if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);
          return { ok: true, row: existing, dropped: dropped };
        }
        rows.push(out);
        return { ok: true, row: out, dropped: dropped };
      }
      var next = _dropMissingNull(body, err);
      if (!next) return { ok: false, error: err };
      dropped.push(Object.keys(body).filter(function (k) { return !(k in next); })[0]);
      body = next;
    }
    return { ok: false, error: new Error('Too many missing columns — run migrations/2026-07-20-contracts-claims-full.sql.') };
  }
  /* The save succeeded, but this database is missing columns the app expects. Said out
     loud every time rather than once: a silent degrade becomes the permanent state, and
     the columns it drops are the ones a claim's whole pipeline lives in. */
  /* Which migration introduces which column.
     ⚠️ THIS EXISTS BECAUSE THE HINT NAMED THE WRONG FILE. Both messages below used to
        say "run 2026-07-20-contracts-claims-full.sql" for ANY dropped column — but
        `package_id` comes from 2026-08-25-package-adoption.sql, and that file was the one
        actually unrun on the live database (confirmed 2026-08-27 by VERIFY-schema.sql:
        contracts_claims.package_id and boq_items.package_id both absent). So every
        contract save silently dropped its package link, the register listed every contract
        as "not linked to a package", and the toast sent whoever read it to a migration
        that was already applied and would have changed nothing. */
  var COL_MIGRATION = { package_id: 'migrations/2026-08-25-package-adoption.sql' };
  var DEFAULT_MIGRATION = 'migrations/2026-07-20-contracts-claims-full.sql';
  function migrationsFor(cols) {
    var seen = {};
    (cols || []).forEach(function (c) { seen[COL_MIGRATION[c] || DEFAULT_MIGRATION] = 1; });
    return Object.keys(seen);
  }
  function warnDropped(dropped) {
    if (!dropped || !dropped.length) return;
    var files = migrationsFor(dropped);
    UI.toast('Saved, but this database has no ' + dropped.join(', ') + ' column' + (dropped.length > 1 ? 's' : '') +
      ' — that value was NOT recorded. Run ' + files.join(' and ') + ', then save again.', 'warn');
  }
  function recordFailMsg(e) {
    var msg = e.message || '';
    if (!/column|schema cache|PGRST204/i.test(msg)) return msg;
    // Name the column's own migration when the error names the column.
    var hit = Object.keys(COL_MIGRATION).filter(function (c) { return msg.indexOf(c) !== -1; });
    return 'Save failed — run ' + (hit.length ? COL_MIGRATION[hit[0]] : DEFAULT_MIGRATION) + ' first. (' + msg + ')';
  }
  /* Follow the record if its type moved it to another tab, so it does not silently
     "disappear" from the view you are looking at. */
  function gotoTypeTab(t) {
    /* ⚠️ 'Package' must land on Contract, not Claims. The old ternary sent anything
       unrecognised to claims, so a package saved from the wizard would have dropped the
       planner on a register that cannot show it. */
    var target = (t === 'Contract' || t === 'Package') ? 'contract' : t === 'EOT' ? 'eot' : 'claims';
    if (target !== view) switchTab(target); else render();
  }

  /* "+ Add" opens the guided wizard; clicking a row still opens the compact form.
     ⚠️ New records get the guidance, edits stay fast — a wizard that owns editing too
     becomes the slowest path to the most common action. Falls back to the form if
     wizard.js did not load, so the module never loses its Add button. */
  function openNew(type) {
    if (!window.CCWizard) { openForm(null); return; }
    CCWizard.open({
      pid: function () { return pid; },
      uid: function () { return UID; },
      packages: function () { return PKGS; },
      /* Every project in the app, so the wizard can refuse a package that restates one.
         ⚠️ Read from the cache filled at load, never fetched here — the check runs on
         every keystroke in the package step, and a network round trip per character
         would either lag the field or race itself. An empty cache degrades to "no
         conflict found", which is the safe direction: it never blocks a legitimate
         package, it only stops catching the illegitimate one. */
      projects: function () { return ALL_PROJECTS; },
      createPackage: function (p) { return PDb.createPackage(p).then(function (made) { PKGS.push(made); return made; }); },
      /* Rollback for a package this wizard created moments ago and could not use. It is
         guaranteed to have nothing pointing at it, so admin_delete_package's in-use guard
         passes; the local list is trimmed either way so a stale entry cannot make the
         next attempt think the code is taken. */
      deletePackage: function (id) {
        return PDb.deletePackage(id)
          .catch(function (e) { return sb().from('packages').delete().eq('id', id).then(function () { throw e; }); })
          .then(function () { PKGS = PKGS.filter(function (k) { return String(k.id) !== String(id); }); },
                function (e) { PKGS = PKGS.filter(function (k) { return String(k.id) !== String(id); }); throw e; });
      },
      /* Open the BOQ screen AND its importer, so a "BOQ" run in the wizard ends in the
         file picker rather than in a paragraph describing where the file picker lives.
         ⚠️ The importer is opened after `show()` resolves — it reads the current revision
         list to offer "supersede vs new", and opening it against an unloaded module would
         offer neither. */
      /* ⚠️ The wizard CREATES the draft through boq.js rather than inserting the row itself:
         the draft/manual defaults, the is_current rule the database enforces and the reload
         afterwards all live in one place. A second insert path would be a second set of bugs. */
      createBoqDraft: async function (f) {
        if (!window.BOQ || !BOQ.createDraft) throw new Error('BOQ did not load.');
        /* WARNING A NEW BOQ IS A DOCUMENT PLUS ITS FIRST REVISION, in that order. Creating only
           the revision leaves document_id NULL, which orphans it from the per-document series
           installed by 2026-09-07-boq-documents.sql and from the contract-value roll-up. */
        var docId = null;
        if (f.docName && BOQ.createDocument) {
          try {
            var d = await BOQ.createDocument(f.docName, f.divisions || []);
            docId = d && d.id;
          } catch (e) {
            /* WARNING A HALF-APPLIED MIGRATION MUST NOT BLOCK CREATING A BOQ. The READ path
               already treats a missing boq_documents as "no documents" and falls back to the flat
               behaviour; this path did not, so pressing Create draft surfaced a raw
               PGRST205 toast and wrote nothing. Degrade the same way: make the revision without a
               document, and say so plainly rather than failing. */
            var m = (e && e.message) || String(e);
            if (/boq_documents|schema cache|PGRST205|does not exist/i.test(m)) {
              try { UI.toast('Created without a BOQ name - run migrations/2026-09-07-boq-documents.sql to enable named BOQs.', 'info'); } catch (e2) {}
            } else { throw e; }
          }
        }
        return BOQ.createDraft({ rev: f.rev, date: f.date, po: f.po, total: f.total, docId: docId });
      },
      /* WARNING The wizard hosts boq.js's OWN picker rather than carrying a copy. A second ladder
         would drift from the first, which this module has already paid for twice today. */
      /* ⚠ THE WIZARD DOES NOT OWN THE ATTACHMENT LOGIC, exactly as it does not own the write
         (see its own header note: *"Every save goes through module.js's persistRecord()"*). It is
         handed the same panel the compact form draws, so the two create-paths cannot come to
         disagree about the storage path convention or the upload ordering. */
      attPanelHTML: function (recordId, staged) { return attPanelHTML(recordId, staged, canWrite); },
      attPanelWire: function (root, recordId, get, set, paint) { return attPanelWire(root, recordId, get, set, paint); },
      attFlush: function (recordId, staged) { return attFlush(recordId, staged); },
      boqPickerHTML: function () {
        return (window.BOQ && BOQ.codePickerHTML) ? BOQ.codePickerHTML() : '';
      },
      mountBoqPicker: function (root, opts) {
        if (!window.BOQ || !BOQ.mountCodePicker) return Promise.resolve(null);
        return BOQ.mountCodePicker(root, opts || {});
      },
      addBoqLines: function (codes) {
        if (!window.BOQ || !BOQ.addAuthoredLines) return Promise.resolve();
        return BOQ.addAuthoredLines(codes);
      },
      boqDocuments: function () {
        return (window.BOQ && BOQ.documents) ? BOQ.documents() : [];
      },
      /* WARNING The BOQ currently on screen, so the wizard can NAME what a new revision would
         supersede. Returns null before the BOQ section has loaded, which the wizard reads as
         "unknown" and does not claim either way -- the same tolerance as boqDraft above. */
      boqDoc: function () {
        return (window.BOQ && BOQ.currentDocument) ? BOQ.currentDocument() : null;
      },
      boqRevCount: function () {
        return (window.BOQ && BOQ.revisionCount) ? BOQ.revisionCount() : 0;
      },
      /* Whether a draft is already open, so the wizard can offer ADDING TO IT rather than
         starting a rival revision. Returns null when the BOQ has not loaded, which the
         wizard treats as "unknown" and simply does not claim either way. */
      boqDraft: function () {
        return (window.BOQ && BOQ.currentDraft) ? BOQ.currentDraft() : null;
      },
      addBoqTrades: function () {
        if (window.BOQ && BOQ.addTrades) return BOQ.addTrades();
      },
      nextBoqRev: function () {
        return (window.BOQ && BOQ.nextRevLabel) ? BOQ.nextRevLabel() : '00';
      },
      /* ⚠ REOPENS THIS WIZARD AS A BOQ RUN rather than duplicating its fields. Naming a BOQ,
         choosing between a new document and a new revision, and picking trades are three decisions
         that already have a screen; a Contract's BOQ step offering its own copy would be a third
         create-surface on one module. Used by the Contract run's "Build it by hand". */
      openBoqWizard: function () { openNew('BOQ'); },
      openBoqImport: function () {
        openSub('boq');
        var tries = 0;
        (function waitForLoad() {
          /* ⚠️ The readiness signal is the IMPORT BUTTON, not a timer and not a container.
             It appears only once boq.js has rendered AND the user may write — so a viewer
             lands on the BOQ screen and is never shown an importer they cannot use. */
          var btn = document.getElementById('boq-import') || document.getElementById('boq-import2');
          if (btn && window.BOQ && BOQ.openImport) { BOQ.openImport(); return; }
          // ~4s: the first load fetches revisions, items, allocations and periods.
          if (++tries > 40) return;
          setTimeout(waitForLoad, 100);
        })();
      },
      persist: function (payload) { return persistRecord(payload, null); },
      /* AFFECTED ACTIVITIES (2026-09-09). ⚠️ Every one of these is GUARDED on window.CCAffected
         rather than assumed: affected.js is a new file, and a browser holding a cached
         index.html from before it existed would otherwise throw on the wizard's new step -- the
         exact "broken import that was an old parser still executing" failure MODULE_V exists to
         prevent, arriving through the one door MODULE_V cannot close. The wizard already
         optional-guards each of these on its side too; both halves are cheap. */
      affectedPickerHTML: function () {
        return window.CCAffected ? CCAffected.pickerHTML()
          : '<p class="cc-hint">The activity picker is unavailable — reload the page.</p>';
      },
      mountAffectedPicker: function (root, opts) {
        return window.CCAffected ? CCAffected.mount(root, opts) : Promise.resolve(null);
      },
      saveAffected: function (ccId, ids) {
        return window.CCAffected ? CCAffected.saveFor(ccId, ids)
          : Promise.resolve({ err: 'the activity picker is unavailable' });
      },
      /* Starts the schedule read the moment the wizard opens, so the step is ready by the time
         the planner clicks through to it. Never awaited -- see the note in wizard.js open(). */
      prefetchAffected: function () {
        if (!window.CCAffected) return;
        CCAffected.setProject(pid);
        CCAffected.ensureActs(); CCAffected.ensureLevels(); CCAffected.ensureLinks();
      },
      failMsg: recordFailMsg,
      warnDropped: warnDropped,
      done: gotoTypeTab
    }, type);
  }


  /* ==========================================================================================
     ATTACHMENTS ON A RECORD.
     Owner 2026-09-15: *"there should also be an attach a file feature in the contracts, claims,
     eot, and change order"*, and on being shown the wizard: *"Yes there is an existing bucket but
     it can't be accessed / there is no path for planners to upload them."* Both true: the
     `contracts-claims` bucket has existed since 2026-08-25 and its storage policies are already
     BUCKET-wide rather than PMI-scoped, so the only things missing were a table to hang a record's
     files off (migrations/2026-09-15-cc-attachments.sql) and a screen to put them on.

     ⚠️⚠️ THE ORDERING RULES ARE THE FEATURE, and they are pmi.js's, not new ones. Upload runs
       BEFORE the row write, so a failed upload never leaves a row pointing at nothing; the object
       is rolled back if the row write then fails, so a failure leaves no orphan; and on removal the
       ROW goes first, because a failed object delete leaves a recoverable orphan whereas the
       reverse leaves an attachment that will not open.
     ⚠️⚠️ ONE PANEL, TWO MODES, because there are two ways to create a record. The wizard and the
       compact form both need this, and a record has no id until it is saved — so files chosen
       before a save are STAGED in memory and flushed once the row exists. The same panel, given an
       id, talks to the database directly. Two separate implementations of "attach a file" on one
       module is how they come to disagree about the path convention.
     ========================================================================================== */
  /* ⚠⚠ THE ENGINE MOVED TO assets/js/attach.js (PDAttach) ON 2026-09-15, AND WHAT IS LEFT HERE IS
     A SET OF THIN DELEGATES. Nothing about this module's behaviour changed: the panel emits the
     same `cc-att*` classes (PDAttach takes the prefix as `cls`), the same two sentences (it takes
     `parentWord`), and the same `D.att*` names the wizard calls.
     ⚠ WHY IT MOVED: the Project Schedule needs attachments on activities, and the valuable part of
       this code is not the upload — it is the three ORDERING RULES (object before row; roll the
       object back if the row fails; row before object on delete). A second copy of those is a
       second set of ways to get them wrong, and this repo has already paid for a hand-copied
       duplicate three times (the location normaliser, where one of three copies matched a
       13th-floor leaf to "3rd Floor"; the S-curve maths in portfolio-overview; the change-order
       insert). So the schedule gets an INSTANCE of this, not a copy of it.
     ⚠ The local names are kept deliberately, exactly as affected.js did when PDLoc was extracted:
       three call sites, the `D.att*` exports and the `loadAttachments` call in `load()` all keep
       pointing at the same identifiers, so the diff stays checkable.
     ⚠ Same bucket string as pmi.js on purpose: one module, one bucket, and its storage policies
       are keyed on bucket_id rather than on what the file hangs off. */
  var BUCKET = 'contracts-claims';
  var ATT_T = 'cc_attachments';
  var ATT_MIGRATION = 'migrations/2026-09-15-cc-attachments.sql';
  /* The vocabulary a commercial file actually arrives as. ⚠️ Must match the CHECK constraint in
     the migration — a value this list offers and the constraint refuses is an insert that fails
     after the object is already in the bucket. */
  var ATT_TYPES = [
    ['signed_contract',    'Signed contract'],
    ['variation_order',    'Variation order'],
    ['client_instruction', 'Client instruction'],
    ['cost_backup',        'Cost back-up'],
    ['programme_impact',   'Programme impact'],
    ['correspondence',     'Correspondence'],
    ['certificate',        'Certificate'],
    ['other',              'Other']
  ];

  /* ⚠ Built lazily, not at module load. `pid` and `UID` are assigned by init(), and a create()
     evaluated at parse time would capture the getters before either exists — harmless here
     because they ARE getters, but the lazy form also means a page that never opens this module's
     attachments never constructs the instance. */
  var _ATT = null;
  function att() {
    if (!_ATT) {
      if (!window.PDAttach) throw new Error('PDAttach is missing — assets/js/attach.js did not load.');
      _ATT = PDAttach.create({
        sb: sb,
        projectId: function () { return pid; },
        userId: function () { return UID; },
        table: ATT_T, bucket: BUCKET, ownerCol: 'record_id',
        migration: ATT_MIGRATION, types: ATT_TYPES,
        cls: 'cc', pathSeg: 'records', parentWord: 'record'
      });
    }
    return _ATT;
  }

  /* ⚠ ONLY THE FOUR WITH REAL CALLERS SURVIVE. `attLabel`, `attSize`, `attOf`, `attUpload`,
     `attOpen` and `attRemove` were delegated too in the first cut of this extraction and every one
     of them was DEAD: their only callers were inside the panel, and the panel is in the shared
     file now. A delegate that matches nothing reads as a feature that exists — the same finding
     this module already recorded when `bulkPropose` lost its button (2026-09-11 a). Grepped both
     `module.js` and `wizard.js` for each before removing: zero call sites. */
  async function loadAttachments(ids) { return att().load(ids); }
  function attPanelHTML(recordId, staged, canEdit) { return att().panelHTML(recordId, staged, canEdit); }
  function attPanelWire(root, recordId, get, set, paint) { return att().panelWire(root, recordId, get, set, paint); }
  async function attFlush(recordId, staged) { return att().flush(recordId, staged); }

  function openForm(r) {
    if (!canWrite) { UI.toast('You do not have permission to edit records.', 'error'); return; }
    if (!pid) { UI.toast('Select a project first.', 'error'); return; }
    var e = r || {};
    // A new record defaults to the tab you're on, so Add always lands in the
    // right register rather than making you pick the type twice.
    var defType = e.record_type || (view === 'contract' ? 'Contract' : view === 'eot' ? 'EOT' : 'Change Order');
    var ALL_TYPES = ['Contract', 'Claim', 'Change Order', 'EOT'];

    /* ⚠️ `lattrs` goes on the LABEL, not the input. applyType() toggles display on the
       element carrying data-only / data-not, and putting the guard on the input hides
       the box while leaving its caption floating — which is how the four claim dates
       ended up visible on a Contract in the first place. */
    function f(label, id, val, type, attrs, lattrs) {
      return '<label ' + (lattrs || '') + '>' + esc(label) + '<input id="' + id + '" type="' + (type || 'text') + '" ' + (attrs || '') +
        ' value="' + esc(val == null ? '' : (type === 'date' ? String(val).slice(0, 10) : val)) + '" /></label>';
    }
    var isContract = defType === 'Contract', isEot = defType === 'EOT';

    var body =
      '<div class="cc-sec">Record</div>' +
      '<label>Type<select id="cc-f-rtype">' + ALL_TYPES.map(function (t) {
        return '<option' + (defType === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      f('Reference no.', 'cc-f-ref', e.reference_no, 'text', 'placeholder="e.g. CO 01"') +
      '<label class="cc-wide">Description<textarea id="cc-f-desc" placeholder="e.g. Additional Cost for Plumbing Fixtures">' + esc(clean(e.description) || clean(e.title)) + '</textarea></label>' +
      f('Counterparty / client', 'cc-f-cp', e.counterparty) +
      /* ⚠️ THE PACKAGE FIELD POINTS TWO DIFFERENT WAYS, AND THAT IS THE POINT.
         Owner, 2026-08-26: *"In the contract it'll be the one that will define the
         packaging."* He is right, and the original field was wrong for one of the four
         types. `contracts_claims.package_id` was added for CLAIMS — a claim, change
         order or EOT is RAISED AGAINST a lot that already exists — and the same form
         serves every type, so a Contract inherited a picker pointing backwards: it
         asked which package this contract belongs to, when the contract is the document
         that DEFINES the package in the first place.
         ⚠️ This also closes a real chicken-and-egg: until now the ONLY way to create a
            package was the Dashboard, so a project whose contracts were being entered
            here showed "(none on this project)" — exactly the screenshot — and every
            downstream consumer (schedule, BOQ, procurement, engineering) had nothing to
            file against.
         ⚠️ STILL NEVER AUTOMATIC. Decision #2 stands: a package minted without a human
            saying so could later be cited in a claim nobody agreed to. Creating one here
            is an explicit choice in a picker, with its code and name confirmed — which
            is precisely the authoritative act, a planner entering the contract. */
      /* ⚠️ "NONE" IS THE DEFAULT, AND IT IS SAVEABLE. Owner, 2026-08-27, on OPW101:
            *"OPW101 is a one work construction contract without any packages. But this
            requires me to connect it to a package."*
         He could not save. This select's only non-linking option was "— Create from this
         contract —", and the save handler then REFUSED without a package code and name
         (see below). So a single-lot contract — the ordinary case — had no way through
         the form except to invent a package, and the only code to hand was the project's
         own. That is the AVR101 › {AVR101, AVR102} shape, manufactured by a validator.
         ⚠️ `package_id` is nullable on contracts_claims, boq_items, project_schedule and
            wbs_nodes with no back-fill (2026-08-25-package-adoption.sql). Nothing ever
            required this. */
      '<label data-only="Contract">Contract package<select id="cc-f-pkgnew">' +
        '<option value=""' + (e.package_id ? '' : ' selected') + '>— None: this project is the contract lot —</option>' +
        '<option value="__new">— Define a package from this contract —</option>' +
        PKGS.map(function (p2) {
          return '<option value="' + esc(p2.id) + '"' + (String(e.package_id) === String(p2.id) ? ' selected' : '') + '>' +
            'Link to ' + esc((p2.code ? p2.code + ' — ' : '') + (p2.name || '')) + '</option>'; }).join('') +
        '</select></label>' +
      '<div class="cc-wide" data-only="Contract" id="cc-pkgnew-wrap">' +
        '<div class="cc-form" style="padding:0;">' +
        f('Package code', 'cc-f-pkgcode', '', 'text', 'placeholder="e.g. PKG-1"') +
        f('Package name', 'cc-f-pkgname', '', 'text', 'placeholder="e.g. Enabling works"') +
        f('Package start', 'cc-f-pkgstart', '', 'date') +
        f('Package finish', 'cc-f-pkgend', '', 'date') +
        '</div>' +
        '<div id="cc-pkgwarn"></div>' +
        '<p class="cc-hint pd-caution">Only for a division <b>below</b> this project — a lot inside <i>this</i> contract ' +
        'with no project code of its own. A division that already has its own code is a <b>separate project</b>: ' +
        'create it in the projects list and consolidate the two on the Portfolio Overview ' +
        '(<b>Group by → Parent project</b>).</p>' +
        '<p class="cc-hint">The <b>contract amount</b> above becomes its contract value. ' +
        'Seeded once, on save — afterwards the package is edited on the <b>Contract tab</b>, so the two ' +
        'cannot silently drift apart.</p>' +
      '</div>' +
      /* Claims / COs / EOTs keep the original direction: raised AGAINST a package that
         already exists. Optional by design — MODULE_CONTRACT §6b: a package is a
         narrowing, never a requirement, and most projects have none. */
      '<label data-not="Contract">Raised against package' + (PKGS.length ? '' : ' <span class="cc-mini">(none on this project yet)</span>') +
        '<select id="cc-f-pkgid"' + (PKGS.length ? '' : ' disabled') + '><option value="">— none —</option>' +
        PKGS.map(function (p2) {
          return '<option value="' + esc(p2.id) + '"' + (String(e.package_id) === String(p2.id) ? ' selected' : '') + '>' +
            esc((p2.code ? p2.code + ' — ' : '') + (p2.name || '')) + '</option>'; }).join('') +
        /* ⚠️ A stored package absent from the list keeps its own option, or a
           <select> whose value is not among its options reports the FIRST one and
           Save silently re-assigns the claim to another package. */
        (e.package_id && !PKGS.some(function (p2) { return String(p2.id) === String(e.package_id); })
          ? '<option value="' + esc(e.package_id) + '" selected>UNLINKED</option>' : '') +
        '</select></label>' +

      // Contract amount — only relevant to a Contract row.
      '<div class="cc-sec" data-only="Contract">Contract value</div>' +
      '<label data-only="Contract">Contract amount<input id="cc-f-amount" type="text" inputmode="decimal" value="' + esc(e.amount == null ? '' : e.amount) + '" /></label>' +

      // The four-stage pipeline, money or days depending on type.
      '<div class="cc-sec" data-not="Contract">Pipeline</div>' +
      '<p class="cc-hint" data-not="Contract">Estimated → Submitted → Evaluated → Client Approved. ' +
        '<span data-only="EOT">Extension of Time is measured in days.</span>' +
        '<span data-not="EOT">Claims and Change Orders are amounts.</span></p>' +
      '<label data-money>Estimated amount<input id="cc-f-est-a" type="text" inputmode="decimal" value="' + esc(e.est_amount == null ? '' : e.est_amount) + '" /></label>' +
      '<label data-money>Submitted amount<input id="cc-f-sub-a" type="text" inputmode="decimal" value="' + esc(e.sub_amount == null ? '' : e.sub_amount) + '" /></label>' +
      '<label data-money>Evaluated amount<input id="cc-f-eval-a" type="text" inputmode="decimal" value="' + esc(e.eval_amount == null ? '' : e.eval_amount) + '" /></label>' +
      '<label data-money>Client approved amount<input id="cc-f-appr-a" type="text" inputmode="decimal" value="' + esc(e.approved_amount == null ? '' : e.approved_amount) + '" /></label>' +
      '<label data-days>Estimated days<input id="cc-f-est-d" type="text" inputmode="numeric" value="' + esc(e.est_days == null ? '' : e.est_days) + '" /></label>' +
      '<label data-days>Submitted days<input id="cc-f-sub-d" type="text" inputmode="numeric" value="' + esc(e.sub_days == null ? '' : e.sub_days) + '" /></label>' +
      '<label data-days>Evaluated days<input id="cc-f-eval-d" type="text" inputmode="numeric" value="' + esc(e.eval_days == null ? '' : e.eval_days) + '" /></label>' +
      '<label data-days>Client approved days<input id="cc-f-appr-d" type="text" inputmode="numeric" value="' + esc(e.approved_days == null ? '' : e.approved_days) + '" /></label>' +

      '<div class="cc-sec" data-not="Contract">Status &amp; dates</div>' +
      /* ⚠️ `data-statusrow` makes this span both columns — see the note on `.cc-form`. Without it
         Status occupies one cell and shunts the four dates below it by one, which is what split
         "Date filed / Date submitted" across two rows. */
      '<label data-not="Contract" data-statusrow>Status<select id="cc-f-stat"><option value="">—</option>' +
        STATUSES.map(function (s) { return '<option' + (statusOf(e) === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></label>' +
      /* ⚠️ THESE FOUR HAD NO TYPE GUARD while the section header above them and the
         aging hint below them both carried `data-not="Contract"` — so on a Contract the
         header vanished and its four fields stayed, stranded under "Contract value".
         Submitted → Evaluated → Client Approved is the CLAIM pipeline; a construction
         contract is signed, not evaluated. A contract keeps one date, and it is called
         what it is. */
      '<div class="cc-sec" data-only="Contract">Contract dates</div>' +
      f('Date signed', 'cc-f-signed', e.date_filed, 'date', '', 'data-only="Contract"') +
      '<p class="cc-hint" data-only="Contract">The contract\'s own start and finish live on the ' +
        '<b>package</b> it defines, above — they are the dates the schedule and the billing read.</p>' +
      f('Date filed', 'cc-f-filed', e.date_filed, 'date', '', 'data-not="Contract"') +
      f('Date submitted', 'cc-f-subd', e.date_submitted, 'date', '', 'data-not="Contract"') +
      f('Date evaluated', 'cc-f-evald', e.date_evaluated, 'date', '', 'data-not="Contract"') +
      f('Date approved', 'cc-f-apprd', e.date_approved, 'date', '', 'data-not="Contract"') +
      '<p class="cc-hint" data-not="Contract">Aging is calculated from <b>Date submitted</b> while the record is Pending — it is never stored.</p>' +
      /* AFFECTED WORK (2026-09-09). ⚠️ `data-not="Contract"` -- a contract is not raised against
         activities, it defines them; only a Claim, Change Order or EOT is argued from a set of
         work. applyType() toggles this the same way it toggles the money and days pipelines.
         ⚠️ The per-type sentence uses the SAME data-only/data-not spans the days hint above
            already uses, rather than a second mechanism: an EOT selection is EVIDENCE (the days
            stay one contract-level figure) while a change order's is SCOPE, and reading one as
            the other is how a claim goes wrong. */
      (window.CCAffected
        ? '<div class="cc-sec" data-not="Contract">Affected work</div>' +
          '<div class="cc-wide" data-not="Contract">' +
            '<p class="cc-hint">' +
              '<span data-only="EOT">The activities this delay ran through — the <b>basis</b> of the claim. ' +
                'Nothing here carries days; the granted days stay the single figure above.</span>' +
              '<span data-not="EOT">The activities this record affects. Recording them moves no dates — ' +
                'inserting change-order work into them is a separate, previewed step in the Project Schedule.</span>' +
            '</p>' + CCAffected.pickerHTML() +
          '</div>'
        : '') +
      '<label class="cc-wide">Remarks<textarea id="cc-f-rem">' + esc(e.remarks || '') + '</textarea></label>' +
      /* ⚠⚠ FILES ON EVERY TYPE, no `data-only`. Owner 2026-09-15: *"an attach a file feature in
         the contracts, claims, eot, and change order"* — all four. A signed contract, a variation
         order, a client instruction and a programme-impact report are the same kind of evidence at
         different points of the same argument, and a type that could not carry one would be the
         type people keep the file for in their inbox. */
      '<div class="cc-sec">Files</div>' +
      '<div class="cc-wide" id="cc-f-atts"></div>';

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' + (r ? 'Edit' : 'Add') + ' record</h2>' +
      '<button class="pd-modal-close" id="cc-m-x">&times;</button></div>' +
      '<div class="cc-form">' + body + '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="cc-m-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="cc-m-save">Save</button></div>');
    /* ⚠️ `UI.modal()` takes no class, so the width class goes on afterwards — see `.pd-modal.cc-rec`.
       This form carries a money pipeline, four dates, an activity tree with a programme preview
       beside it, remarks and attachments; the shared 520px is a four-field dialog's width. */
    var _recBox = m.el.querySelector('.pd-modal');
    if (_recBox) _recBox.classList.add('cc-rec');

    var el = function (id) { return m.el.querySelector('#' + id); };

    /* ==== AMOUNTS CARRY THEIR COMMAS =========================================================
       Owner 2026-09-17: *"amounts should have a numerical comma."* `58995925` and `5899592` are
       one keystroke apart and look identical at a glance; grouping is what makes the difference
       visible, and every figure this module PRINTS is already grouped. Only the inputs were not.
       ⚠️⚠️ GROUPED ON BLUR, RAW ON FOCUS — not while typing. Rewriting the value on every
       keystroke moves the caret to the end, so "13023058" edited in the middle becomes a fight
       with the field. On focus it goes back to plain digits, which is what a planner wants to edit
       and what a paste lands as.
       ⚠️ SAFE BECAUSE THE PARSER ALREADY SPEAKS COMMAS. `n()` below validates them against
       `\d{1,3}(,\d{3})+` rather than stripping them — see the note there on why "1.000,50" must be
       REFUSED rather than silently read as 1.0005. So a grouped value round-trips, and a value this
       formatter refuses to touch is left exactly as the planner typed it, for `n()` to judge.
       ⚠️ Days are left alone: `data-days` counts run to four digits at most and a claim for
       "1,095 days" reads no better than "1095". `data-money` is the marker the form already uses. */
    function groupAmountInputs() {
      m.el.querySelectorAll('label[data-money] input, #cc-f-amount').forEach(function (inp) {
        if (inp.__ccGrouped) return;
        inp.__ccGrouped = true;
        var raw = function () { return String(inp.value || '').replace(/,/g, ''); };
        var fmt = function () {
          var t = raw().trim();
          if (!t || !/^-?\d*\.?\d+$/.test(t)) return;      // not a plain number: leave it be
          var neg = t.charAt(0) === '-'; if (neg) t = t.slice(1);
          var parts = t.split('.');
          inp.value = (neg ? '-' : '') +
            parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
            (parts.length > 1 ? '.' + parts[1] : '');
        };
        inp.addEventListener('focus', function () { inp.value = raw(); });
        inp.addEventListener('blur', fmt);
        fmt();                                             // and the value it opened with
      });
    }

    /* ⚠ STAGED WHEN THERE IS NO ROW YET. `openForm(null)` is the quick Add path, and a record has
       no id until persistRecord returns — so files chosen here are held and flushed after the save,
       exactly as the wizard does. On an EDIT the id exists and the panel uploads immediately, which
       is why the same panel reads both ways from one call. */
    groupAmountInputs();

    var attStaged = [];
    function paintAtts() {
      var box = el('cc-f-atts'); if (!box) return;
      box.innerHTML = attPanelHTML(r && r.id, attStaged, canWrite);
      attPanelWire(box, r && r.id,
        function () { return attStaged; },
        function (a) { attStaged = a; },
        paintAtts);
    }
    paintAtts();

    // Show only the fields that belong to the chosen type, so a Contract never
    // shows a days pipeline and an EOT never shows peso boxes.
    function applyType() {
      var t = el('cc-f-rtype').value;
      m.el.querySelectorAll('[data-only]').forEach(function (n) { n.style.display = n.dataset.only === t ? '' : 'none'; });
      m.el.querySelectorAll('[data-not]').forEach(function (n) { n.style.display = n.dataset.not === t ? 'none' : ''; });
      m.el.querySelectorAll('[data-money]').forEach(function (n) { n.style.display = (t === 'Claim' || t === 'Change Order') ? '' : 'none'; });
      m.el.querySelectorAll('[data-days]').forEach(function (n) { n.style.display = t === 'EOT' ? '' : 'none'; });
    }
    el('cc-f-rtype').addEventListener('change', function () { applyType(); applyPkgMode(); });
    applyType();

    /* ⚠️ MOUNTED AFTER THE MODAL EXISTS, not built into the body string: the picker reads the
       schedule and needs its container in the document to wire its rows. Same reason the wizard
       mounts it in wireStep() rather than in the step's own HTML.
       ⚠️ `affPicker` stays null on a Contract or an older build, and the save path below checks
          it -- so nothing here can make an ordinary record edit fail. */
    var affPicker = null;
    if (window.CCAffected) {
      CCAffected.setProject(pid);
      CCAffected.mount(m.el, {
        initial: r ? CCAffected.listFor(r.id) : [],
        ccId: r ? r.id : null
      }).then(function (p) { affPicker = p; }).catch(function () { affPicker = null; });
    }

    /* The "create a package from this contract" block only makes sense while
       "— Create from this contract —" is chosen; linking to an existing package must
       not show empty code/name boxes that would look like they need filling in. */
    function applyPkgMode() {
      var sel = el('cc-f-pkgnew'), wrap = m.el.querySelector('#cc-pkgnew-wrap');
      if (!sel || !wrap) return;
      var creating = sel.value === '__new';     // '' now means "none", not "create"
      wrap.style.display = (el('cc-f-rtype').value === 'Contract' && creating) ? '' : 'none';
      // Seed the code and name from what the planner has already typed, without ever
      // overwriting something they edited themselves.
      if (creating) {
        var code = el('cc-f-pkgcode'), name = el('cc-f-pkgname');
        var ref = (el('cc-f-ref').value || '').trim();
        /* ⚠️ NEVER seed a code that names a project — same rule as the wizard. A contract
           on OPW101 is very often referenced "OPW101", and seeding that is the form itself
           proposing the structure the save below refuses. */
        if (code && !code.value && !code.dataset.touched && !pkgConflict(ref)) code.value = ref;
        if (name && !name.value && !name.dataset.touched) name.value = (el('cc-f-desc').value || '').trim().slice(0, 80);
      }
      paintPkgWarn();
    }
    function pkgConflict(code) {
      return (window.CCWizard && CCWizard.codeConflict)
        ? CCWizard.codeConflict(code, pid, ALL_PROJECTS) : null;
    }
    function paintPkgWarn() {
      var box = m.el.querySelector('#cc-pkgwarn'); if (!box) return;
      var sel = el('cc-f-pkgnew');
      var c = (sel && sel.value === '__new') ? pkgConflict((el('cc-f-pkgcode') || {}).value) : null;
      box.innerHTML = c ? '<p class="cc-hint ccw-stop">⛔ <b>' + esc(c.code) + '</b> ' + (c.self
        ? 'is this project\'s own code — a project cannot be a package of itself. Choose <b>None</b> instead.'
        : 'already exists as a <b>separate project</b>' + (c.proj && c.proj.name ? ' (' + esc(c.proj.name) + ')' : '') +
          '. Consolidate the two on the Portfolio Overview (<b>Group by → Parent project</b>) rather than ' +
          'nesting one inside the other.') + '</p>' : '';
    }
    ['cc-f-pkgcode', 'cc-f-pkgname'].forEach(function (id) {
      var x = el(id); if (x) x.addEventListener('input', function () { x.dataset.touched = '1'; paintPkgWarn(); });
    });
    (function () { var s2 = el('cc-f-pkgnew'); if (s2) s2.addEventListener('change', applyPkgMode); })();
    ['cc-f-ref', 'cc-f-desc'].forEach(function (id) {
      var x = el(id); if (x) x.addEventListener('input', applyPkgMode);
    });
    applyPkgMode();

    wireModalCursor(m, r);
    el('cc-m-x').onclick = m.close;
    el('cc-m-cancel').onclick = m.close;
    el('cc-m-save').onclick = async function () {
      var v = function (id) { var x = (el(id).value || '').trim(); return x === '' ? null : x; };
      /* ⚠⚠ THE FIELDS ABOVE ARE type="text", NOT type="number", AND THIS READER IS WHY.
         MEASURED in a real browser: for input[type=number] the DOM returns "" for ANY value the
         spec cannot parse -- and that includes every way a planner actually writes money.
             "1,000"             -> ""
             "1,397,462,269.86"  -> ""      (a real contract amount from this register)
             "₱1,200.50"          -> ""
             "(500)"             -> ""
         `Number("")` is 0, `v()` returns null, and the field saved as NULL. So typing the contract
         amount with the thousands separators everyone uses silently BLANKED it, with no error and
         no way to tell afterwards. The EOT day counts are four digits here too (1,048 / 1,095),
         so they carry the same risk and were switched with them.
         ⚠ The parser mirrors boq.js's `numOf`, which was written for exactly this after the
         same trap was found in the BOQ grid -- see the note at boq.js:1629. Kept as a separate
         copy rather than exported, because boq.js is loaded only on the Contract tab. */
      var n = function (id) {
        var x = v(id);
        if (x == null) return null;
        var t = String(x).trim();
        if (!t) return null;
        var neg = /^\(.*\)$/.test(t);
        t = t.replace(/[()]/g, '').replace(/%$/, '').replace(/[₱$€£\s]/g, '');
        /* ⚠⚠ COMMAS ARE VALIDATED, NOT STRIPPED. Blind stripping corrupts rather than
           rejects: "1.000,50" becomes 1.0005 and "12,5" becomes 125 -- plausible wrong numbers,
           which is worse than a refusal because nothing on screen looks off. A comma used as an
           English thousands separator is ALWAYS followed by exactly three digits, so the whole
           string is matched against that shape first and anything else is refused. */
        if (t.indexOf(',') >= 0) {
          if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return null;
          t = t.replace(/,/g, '');
        }
        if (!/^-?\d*\.?\d+$/.test(t)) return null;
        var y = Number(t);
        if (!isFinite(y)) return null;
        return neg ? -y : y;
      };
      var t = el('cc-f-rtype').value;
      /* WHICH PACKAGE THIS RECORD POINTS AT, resolved per type.
         · Claim / CO / EOT → the package it is raised against (may be none).
         · Contract         → the package it DEFINES: an existing one it is linked to,
                              or a new one created here from the contract itself.
         ⚠️ Created BEFORE the record is written, and a failure aborts the save. A
            contract row saved with a package that could not be created would claim a
            link that does not exist, and nothing downstream would ever notice. */
      var pkgId = (function (el2) { return el2 && el2.value ? el2.value : null; })(el('cc-f-pkgid'));
      if (t === 'Contract') {
        var pkgSel = el('cc-f-pkgnew');
        var pmode = pkgSel ? pkgSel.value : '';
        // '' = none (and it SAVES — that is the fix), '__new' = create, anything else = link.
        pkgId = (pmode && pmode !== '__new') ? pmode : null;
        if (pmode === '__new') {
          var pcode = v('cc-f-pkgcode'), pname = v('cc-f-pkgname');
          if (!pcode || !pname) { UI.toast('Give the package a code and a name, or set the package to "None".', 'error'); return; }
          // Same refusal as the wizard, from the same function — see wizard.js rawConflict.
          var clash = pkgConflict(pcode);
          if (clash) {
            UI.toast(clash.self
              ? '"' + pcode + '" is this project\'s own code — a project cannot be a package of itself. Set the package to "None".'
              : '"' + pcode + '" is a separate project in this app, not a package of ' + (pid || 'this project') +
                '. Consolidate them on the Portfolio Overview (Group by → Parent project) instead.', 'error');
            return;
          }
          try {
            var made = await PDb.createPackage({
              project_id: pid, code: pcode, name: pname,
              description: v('cc-f-desc'),
              // The contract's own value and dates ARE the package's. Seeded once,
              // here; afterwards the Dashboard owns them, so the two cannot drift.
              contract_amount: n('cc-f-amount'),
              start_date: v('cc-f-pkgstart'), end_date: v('cc-f-pkgend'),
              status: 'active', sort_order: PKGS.length, created_by: UID
            });
            pkgId = made.id;
            PKGS.push(made);
          } catch (er) {
            var em = (er && er.message) || String(er);
            UI.toast(/duplicate key/i.test(em)
              ? 'A package with code "' + pcode + '" already exists on this project — link to it instead.'
              : ('Could not create the package: ' + em +
                 (/relation|does not exist/i.test(em) ? ' — run migrations/2026-08-19-packages.sql.' : '')), 'error');
            return;
          }
        }
      }
      var payload = {
        project_id: pid, record_type: t,
        reference_no: v('cc-f-ref'), description: v('cc-f-desc'), counterparty: v('cc-f-cp'),
        package_id: pkgId,
        amount: t === 'Contract' ? n('cc-f-amount') : null,
        est_amount: null, sub_amount: null, eval_amount: null, approved_amount: null,
        est_days: null, sub_days: null, eval_days: null, approved_days: null,
        status: t === 'Contract' ? null : v('cc-f-stat'),
        /* One column, two labels: a Contract writes its signing date into the same
           `date_filed` column the claim pipeline uses for filing. No schema change,
           and the form never shows both. */
        date_filed: t === 'Contract' ? v('cc-f-signed') : v('cc-f-filed'),
        date_submitted: t === 'Contract' ? null : v('cc-f-subd'),
        date_evaluated: t === 'Contract' ? null : v('cc-f-evald'),
        date_approved: t === 'Contract' ? null : v('cc-f-apprd'),
        remarks: v('cc-f-rem'), updated_at: new Date().toISOString()
      };
      // Only the pipeline belonging to this type is written; the other is nulled
      // so a type change can't leave stale pesos on an EOT (or vice versa).
      if (t === 'Claim' || t === 'Change Order') {
        payload.est_amount = n('cc-f-est-a'); payload.sub_amount = n('cc-f-sub-a');
        payload.eval_amount = n('cc-f-eval-a'); payload.approved_amount = n('cc-f-appr-a');
      } else if (t === 'EOT') {
        payload.est_days = n('cc-f-est-d'); payload.sub_days = n('cc-f-sub-d');
        payload.eval_days = n('cc-f-eval-d'); payload.approved_days = n('cc-f-appr-d');
      }
      if (!payload.description && !payload.reference_no) { UI.toast('Give the record a description or a reference number.', 'error'); return; }

      var btn = el('cc-m-save'); btn.disabled = true; btn.textContent = 'Saving…';
      var res = await persistRecord(payload, r);
      if (!res.ok) { btn.disabled = false; btn.textContent = 'Save'; UI.toast(recordFailMsg(res.error), 'error'); return; }
      /* ⚠️ AFTER the record, and NEVER allowed to fail it -- the same ordering and the same rule
         as the wizard's finish(). On an edit the id already exists; on an insert it is the row
         persistRecord just returned. A link write that fails is reported by name and the record
         stands, because the record is what the planner came to save and the links can be
         re-picked here in one click. */
      /* ⚠ AFTER the record and never allowed to fail it — the rule the affected-work write below
         already follows. A record whose PDF would not upload is still the commercial fact the
         planner came to save; losing it because of the attachment is the worse trade, and the file
         can be re-attached from this same form in one click. */
      await attFlush((r && r.id) || (res.row && res.row.id), attStaged);
      attStaged = [];

      var affMsg = '';
      if (affPicker) {
        var affId = (r && r.id) || (res.row && res.row.id);
        if (affId) {
          var ar = await CCAffected.saveFor(affId, affPicker.ids());
          if (ar && ar.err) {
            affMsg = String(ar.err).indexOf('no-migration:') === 0
              ? ' Affected activities were NOT saved — run ' + String(ar.err).slice('no-migration:'.length) + '.'
              : ' Affected activities were NOT saved: ' + ar.err;
          } else if (ar && (ar.added || ar.removed)) {
            affMsg = ' Affected work updated' +
              (ar.added ? ', +' + ar.added : '') + (ar.removed ? ', −' + ar.removed : '') + '.';
          }
        }
      }
      m.close(); UI.toast((r ? 'Record updated.' : 'Record added.') + affMsg,
        /* ⚠️ `affMsg.indexOf('') >= 0` — what this said until 2026-09-17 — is ALWAYS TRUE:
           `indexOf` of the empty string is 0 in every JavaScript engine, so every successful save
           toasted as a warning, including the ordinary ones with no affected-work message at all.
           The needle had been lost from the source at some point; what it has to test is whether
           the affected-work write is the half that failed, and both of its failure branches above
           say `NOT saved`. */
        affMsg.indexOf('NOT saved') >= 0 ? 'warn' : 'success');
      warnDropped(res.dropped);
      gotoTypeTab(t);
    };

    // Autosave (edit only): debounced re-use of the Save button's own handler.
    if (r && window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var hdr = m.el.querySelector('.pd-modal-header');
      if (hdr) hdr.insertBefore(asInd, hdr.querySelector('.pd-modal-close'));
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: el('cc-m-save'), indicator: asInd });
      var _ccClose = m.close;
      m.close = function () { as.cancel(); _ccClose(); };
    }
  }

  async function delRow(id) {
    var r = rows.find(function (x) { return String(x.id) === String(id); });
    if (!r || !confirm('Delete "' + descOf(r).slice(0, 70) + '"? This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows = rows.filter(function (x) { return String(x.id) !== String(id); });
    delete sel[id];
    UI.toast('Record deleted.', 'success'); render();
  }

  async function bulkStatus(status) {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    if (!ids.length) return;
    rows.forEach(function (r) { if (sel[r.id]) r.status = status; });   // optimistic
    var patch = { status: status, updated_at: new Date().toISOString() };
    if (window.PDSync) {
      var failed = 0;
      for (var i = 0; i < ids.length; i++) { var w = await PDSync.write({ table: TABLE, op: 'update', id: ids[i], patch: patch }); if (!w.ok) failed++; }
      PDSync.cachePut(PID_PFX + ':' + pid, rows);
      if (failed) UI.toast(failed + ' change(s) could not be saved.', 'error');
    } else {
      var res = await sb().from(TABLE).update(patch).in('id', ids);
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
    }
    UI.toast('Updated ' + ids.length + ' record' + (ids.length === 1 ? '' : 's') + '.', 'success');
    sel = {}; render();
  }

  async function bulkDelete() {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    if (!ids.length || !confirm('Delete ' + ids.length + ' record' + (ids.length === 1 ? '' : 's') + '? This cannot be undone.')) return;
    for (var i = 0; i < ids.length; i += 100) {
      var res = await sb().from(TABLE).delete().in('id', ids.slice(i, i + 100));
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
    }
    rows = rows.filter(function (r) { return !sel[r.id]; });
    sel = {}; UI.toast('Deleted ' + ids.length + ' record' + (ids.length === 1 ? '' : 's') + '.', 'success'); render();
  }

  async function clearAll() {
    if (!isAdmin) { UI.toast('Clearing the register is restricted to admins.', 'error'); return; }
    var m = UI.modal('<h2 style="margin-top:0;">Clear contracts &amp; claims</h2>' +
      '<p style="color:var(--pd-muted);font-size:13px;">This permanently deletes <strong>all ' + rows.length + ' records</strong> ' +
      '(contracts, claims, change orders and EOT) for project <strong>' + esc(pid) + '</strong> and cannot be undone. ' +
      'To confirm, type the project code below.</p>' +
      '<input class="pd-input" id="cc-clr-in" placeholder="Type ' + esc(pid) + ' to confirm" autocomplete="off" />' +
      '<div style="text-align:right;margin-top:12px;"><button class="pd-btn" id="cc-clr-x">Cancel</button> ' +
      '<button class="pd-btn pd-btn-danger" id="cc-clr-go" disabled>Delete all records</button></div>');
    var inp = m.el.querySelector('#cc-clr-in'), go = m.el.querySelector('#cc-clr-go');
    inp.oninput = function () { go.disabled = inp.value.trim() !== String(pid); };
    inp.focus();
    m.el.querySelector('#cc-clr-x').onclick = m.close;
    go.onclick = async function () {
      if (inp.value.trim() !== String(pid)) return;
      m.close();
      var res = await sb().from(TABLE).delete().eq('project_id', pid);
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
      rows = []; sel = {}; UI.toast('Register cleared.', 'success'); render();
    };
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================
  /* ⚠ SPLIT so the chooser below can put this sheet in the SAME workbook as the BOQ. Returns
     rows and writes nothing; null when there is nothing to export, so the chooser can say so
     rather than emit an empty sheet. */
  function recordsSheet() {
    var c = cfg(), list = visibleRows();
    if (!list.length) return null;
    var aoa = list.map(function (r) {
      var o = { 'Reference': r.reference_no || '', 'Description': clean(r.description) || clean(r.title) };
      if (view === 'claims') o['Type'] = r.record_type || '';
      c.cols.forEach(function (col) { o[col.head] = r[col.key] == null ? '' : Number(r[col.key]); });
      if (view !== 'contract') {
        o['Status'] = statusOf(r);
        o['Aging (days)'] = agingOf(r) == null ? '' : agingOf(r);
        o['Date Submitted'] = fmtDate(r.date_submitted);
        o['Date Evaluated'] = fmtDate(r.date_evaluated);
        o['Date Approved'] = fmtDate(r.date_approved);
      }
      o['Counterparty'] = r.counterparty || '';
      o['Remarks'] = r.remarks || '';
      return o;
    });
    // Totals row, so the exported sheet reconciles with the on-screen banner.
    var t = totals(list), tot = { 'Reference': '', 'Description': 'TOTAL' };
    if (view === 'claims') tot['Type'] = '';
    c.cols.forEach(function (col) { tot[col.head] = t[col.key]; });
    aoa.push(tot);
    return { name: c.label, rows: aoa };
  }

  /* ---- the topbar export ----------------------------------------------------
     Owner: *"There is an export button at the title bar we can have option to export to excel for
     which items contracts/boq/ or all"*. It used to export whatever register tab you were on and
     nothing else, silently -- so a planner wanting the BOQ had to know to find a second Export
     button further down the page. That button is gone; this asks.
     ⚠ BOTH SHEETS COME FROM THEIR OWN MODULE, never re-derived here. `BOQ.sheet()` decides what a
     BOQ export contains; `recordsSheet()` decides what a register export contains. A chooser that
     rebuilt either column set would be a second definition of the same thing.
     ⚠ An option with nothing behind it is DISABLED and says why, rather than being offered and
     then producing an empty file. */
  function exportSheets(which) {
    var out = [];
    if (which !== 'boq') { var r = recordsSheet(); if (r) out.push(r); }
    if (which !== 'records' && window.BOQ && BOQ.sheet) { var b = BOQ.sheet(); if (b) out.push(b); }
    if (!out.length) { UI.toast('Nothing to export.', 'error'); return; }
    var wb = XLSX.utils.book_new();
    out.forEach(function (sh) {
      var ws = XLSX.utils.json_to_sheet(sh.rows);
      ws['!cols'] = Object.keys(sh.rows[0]).map(function (k) {
        return { wch: k === 'Description' ? 46 : Math.max(13, k.length + 2) };
      });
      XLSX.utils.book_append_sheet(wb, ws, String(sh.name).slice(0, 28));
    });
    var label = out.length > 1 ? 'Contracts and BOQ' : out[0].name;
    XLSX.writeFile(wb, label + ' - ' + (projName() || pid) + '.xlsx');
  }

  function exportExcel() {
    var hasRec = !!recordsSheet();
    var hasBoq = !!(window.BOQ && BOQ.sheet && BOQ.sheet());
    if (!hasRec && !hasBoq) { UI.toast('Nothing to export.', 'error'); return; }
    var c = cfg();
    function opt(v, label, sub, on) {
      return '<label class="ccx-opt' + (on ? '' : ' off') + '">' +
        '<input type="radio" name="ccx" value="' + v + '"' + (on ? '' : ' disabled') + '>' +
        '<span><b>' + esc(label) + '</b><small>' + esc(sub) + '</small></span></label>';
    }
    /* ⚠ The same header shape boq.js's `mHead` emits, written out rather than imported: `mHead`
       is module-local to boq.js and exporting a formatting helper across files to save four lines
       would couple the two for nothing. */
    var m = UI.modal('<div class="pd-modal-header"><div><h2 style="margin:0;">Export to Excel</h2>' +
      '<div class="pd-modal-sub">One workbook. Choose what goes in it.</div></div>' +
      '<button class="pd-modal-close" id="ccx-x">&times;</button></div>' +
      '<div class="pd-modal-body ccx-body">' +
        opt('records', c.label, hasRec ? 'What this tab is showing, with its totals row.'
                                       : 'Nothing on this tab to export.', hasRec) +
        opt('boq', 'Bill of quantities', hasBoq ? 'The current revision, under the filters set on it.'
                                                : 'No BOQ lines on this project yet.', hasBoq) +
        opt('all', 'Both', (hasRec && hasBoq) ? 'Two sheets in one workbook.'
                                              : 'Needs records and a BOQ.', hasRec && hasBoq) +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ccx-c">Cancel</button>' +
      '<button class="pd-btn pd-btn-primary" id="ccx-go">Export</button></div>');
    var first = m.el.querySelector('input[name="ccx"]:not([disabled])');
    if (first) first.checked = true;
    m.el.querySelectorAll('#ccx-x,#ccx-c').forEach(function (b) { b.onclick = m.close; });
    m.el.querySelector('#ccx-go').onclick = function () {
      var sel = m.el.querySelector('input[name="ccx"]:checked');
      if (!sel) return;
      m.close();
      exportSheets(sel.value);
    };
  }
  function projName() {
    var s = document.getElementById('cc-project');
    return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent : '';
  }

  // ==========================================================================
  // SHELL
  // ==========================================================================
  function syncClearFilt() {
    var on = !!(filters.q || filters.type || filters.status || filters.dateField || filters.from || filters.to || filters.pkg);
    var b = document.getElementById('cc-f-clear'); if (b) b.hidden = !on;
  }

  function fillFilters() {
    function fill(id, values, cur) {
      var s = document.getElementById(id);
      s.innerHTML = s.options[0].outerHTML + values.map(function (v) {
        return '<option' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    }
    fill('cc-f-type', CLAIM_TYPES, filters.type);
    var ps = document.getElementById('cc-f-pkg');
    if (ps) {
      // Hidden entirely when the project has no packages — an empty picker is
      // worse than no picker.
      ps.style.display = PKGS.length ? '' : 'none';
      ps.innerHTML = '<option value="">All packages</option>' +
        PKGS.map(function (p2) {
          return '<option value="' + esc(p2.id) + '"' + (filters.pkg === String(p2.id) ? ' selected' : '') + '>' +
            esc((p2.code ? p2.code + ' — ' : '') + (p2.name || '')) + '</option>'; }).join('') +
        '<option value="__none"' + (filters.pkg === '__none' ? ' selected' : '') + '>— no package —</option>';
    }
    fill('cc-f-status', STATUSES, filters.status);
  }

  async function load() {
    var gen = ++_loadGen;
    /* Every paint this load makes goes through here, so a superseded load cannot write to the
       screen and `_painted` cannot be set by one. */
    function paint() {
      if (gen !== _loadGen) return;
      _painted = gen;
      render();
    }
    // Portfolio scope: no single project is selected, but every project the planner can
    // see is in scope — consolidate the register across all of them instead of refusing
    // for lack of one project id. See AppAuth.isPortfolioScope().
    var portfolio = window.AppAuth && AppAuth.isPortfolioScope();
    if (!pid && !portfolio) { rows = []; paint(); return; }
    document.getElementById('cc-view').innerHTML = '<div class="pd-card cc-empty"><h3><span class="cc-spin"></span>Loading…</h3></div>';
    // ⚠️ Keyset-paginated (see PDb.selectAll) — a plain .select() truncates at 1000 rows server-side
    // with no error, and a truncated register would silently understate the roll-up banner totals,
    // which are the headline numbers of this module. Shaped as {data}/{error} so the offline-cache +
    // migration-hint branch below is untouched. No display sort here — the renderer sorts.
    var res;
    try {
      var portfolioIds = null;
      if (portfolio) {
        portfolioIds = await (window.UI && UI.allProjectIds ? UI.allProjectIds() : Promise.resolve([]));
        if (gen !== _loadGen) return;
        if (!portfolioIds.length) { rows = []; fillFilters(); paint(); return; }
      }
      res = {
        data: await PDb.selectAll(TABLE, function (q) {
          return portfolio ? q.in('project_id', portfolioIds) : q.eq('project_id', pid);
        })
      };
    }
    catch (err) { res = { error: err }; }
    if (gen !== _loadGen) return;
    // ⚠️ Affected-work links, packages and the wizard's project-conflict cache are all
    // single-project concepts (a change order's scope, a contract lot) — they have no
    // honest cross-project reading, so they are skipped entirely in portfolio scope
    // rather than being fetched against a null/undefined project id.
    /* ⚠️ NOT AWAITED INTO THE CRITICAL PATH, and not allowed to fail this load. The register must
       render whether or not 2026-09-09-cc-affected-activities.sql has been run; the counts are an
       annotation on it. Fired here rather than lazily because render() may not fetch (see
       affChip), so something has to fill the cache once.
       ⚠️⚠️ AND THE REPAINT IS GATED ON THIS LOAD HAVING ALREADY PAINTED. It used to repaint the
       moment the links landed — which, on a small table racing four other round trips, was almost
       always BEFORE `rows` existed, so it drew an empty register (first open) or the previous
       project's one (a switch) and then replaced it. Nothing is lost by waiting: if the links land
       first, the cache is already full and `paint()` below draws the chips anyway. */
    if (!portfolio && window.CCAffected) {
      CCAffected.setProject(pid);
      CCAffected.ensureLinks().then(function () {
        if (gen !== _loadGen || _painted !== gen) return;
        if (document.getElementById('cc-view')) render();
      }).catch(function () {});
    }
    if (res.error) {
      if (!portfolio && window.PDSync) {
        var c = await PDSync.cacheGet(PID_PFX + ':' + pid);
        if (gen !== _loadGen) return;
        if (c && c.rows) { rows = c.rows.slice(); fillFilters(); paint(); return; }
      }
      if (gen !== _loadGen) return;
      var missing = /column|schema cache|PGRST204|does not exist/i.test(res.error.message || '');
      document.getElementById('cc-view').innerHTML = '<div class="pd-card cc-empty"><h3>Could not load the register</h3><p>' +
        esc(res.error.message) + '</p>' + (missing
          ? '<p class="cc-mut">Run <code>migrations/2026-07-20-contracts-claims-full.sql</code> in the Supabase SQL editor, then reload.</p>' : '') + '</div>';
      return;
    }
    if (!portfolio) {
      var _pkgs;
      try { _pkgs = await PDb.selectAll('packages', function (q) { return q.eq('project_id', pid).order('sort_order'); }); }
      catch (e) { _pkgs = []; }
      /* ⚠️ Assigned only AFTER the staleness check, never before it. `PKGS` is module state that the
         renderer and the wizard both read, so a superseded load writing to it would hand the current
         project another project's packages — a wrong screen rather than merely an early one. */
      if (gen !== _loadGen) return;
      PKGS = _pkgs;
    } else {
      PKGS = [];
    }
    // Cheap (a few dozen rows) and read once per project switch, so the wizard's
    // per-keystroke conflict check never touches the network. Skipped in portfolio scope —
    // the wizard (raising a new record) is not reachable there anyway, since writes are blocked.
    if (!portfolio) {
      var _projs;
      try { _projs = await PDb.getProjects(); }
      catch (e) { _projs = []; }
      if (gen !== _loadGen) return;
      ALL_PROJECTS = _projs;
    }
    rows = res.data || [];
    rows.sort(function (a, b) {
      var d = (a.sort_order || 0) - (b.sort_order || 0); if (d) return d;
      return String(a.reference_no || '').localeCompare(String(b.reference_no || ''), undefined, { numeric: true });
    });
    if (!portfolio && window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);   // offline read-cache
    /* ⚠ One read for the whole register rather than one per record opened. The rows are a few
       dozen, the attachment rows fewer, and a per-open fetch would put a round trip between
       clicking Edit and seeing the form. Tolerant by construction — see loadAttachments. */
    await loadAttachments(rows.map(function (r) { return r.id; }).filter(Boolean));
    if (gen !== _loadGen) return;
    fillFilters();
    paint();
  }

  function switchTab(v) {
    view = v;
    document.querySelectorAll('.cc-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === v); });
    sel = {};
    if (v !== 'claims') { filters.type = ''; var ft = document.getElementById('cc-f-type'); if (ft) ft.value = ''; }
    /* ⚠️ The BOQ loads on first open, not with the register. A BOQ is 1,200+
       lines plus its mapping, allocations and every billing period — six extra
       round-trips on every project switch, paid by everyone for a screen most
       sessions never open. */
    sub = null;                       // leaving a tab always leaves its sub-view
    render();
  }

  async function init(user, profile) {
    UID = (user && user.id) || (profile && profile.id) || null;
    _collabSelf = { id: UID, name: (profile && (profile.name || profile.email)) || 'Someone' };
    isAdmin = !!(profile && (profile.role === 'admin' || profile.role === 'super_admin'));
    canWrite = !!(profile && ['super_admin', 'admin', 'planner'].indexOf(profile.role) !== -1);
    UI.initShell();

    document.getElementById('cc-clear').style.display = isAdmin ? '' : 'none';
    if (!canWrite) { var a = document.getElementById('cc-add'); if (a) a.style.display = 'none'; }

    // ---- project selector ----
    var selEl = document.getElementById('cc-project');
    var projects = [];
    try { projects = (await PDb.getProjects()) || []; } catch (e) { projects = []; }
    projects = projects.filter(function (p) { return !AppAuth.canAccessProject || AppAuth.canAccessProject(profile, p.id); });
    selEl.innerHTML = projects.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name || p.id) + '</option>'; }).join('');
    // ⚠️⚠️ PORTFOLIO SCOPE NEVER FALLS BACK TO A REAL PROJECT — arriving via the Portfolio
    // sidebar, pid stays null on purpose (see AppAuth.isPortfolioScope()). load() below
    // consolidates the register across every accessible project instead of substituting one.
    var portfolioScope = window.AppAuth && AppAuth.isPortfolioScope();
    if (!portfolioScope) {
      var stored = sessionStorage.getItem('pd_project');
      if (stored && projects.some(function (p) { return String(p.id) === String(stored); })) selEl.value = stored;
      pid = selEl.value || (projects[0] && projects[0].id) || null;
    } else {
      pid = null;
    }
    if (UI.enhanceProjectSelect) UI.enhanceProjectSelect(selEl);
    selEl.addEventListener('change', function () {
      pid = selEl.value; sessionStorage.setItem('pd_project', pid); sel = {};
      // A BOQ belongs to ONE project, so its whole cache is dropped on a switch
      // rather than filtered — a stale revision id would silently show another
      // project's contract document.
      if (window.CCPackages) CCPackages.reset();
    if (window.BOQ) BOQ.reset();
    /* ⚠️ A PROJECT SWITCH MUST DROP THE CACHED ACTIVITIES AND LINKS. Keeping them would offer
       the previous project's activities under the new project's name -- and `setProject` is a
       no-op when the id has not changed, so this is safe to call on every switch. */
    if (window.CCAffected) CCAffected.setProject(pid);
      if (window.PMI) PMI.reset();
      if (view === 'boq' && window.BOQ) { BOQ.show(pid, projName()); joinCollab(); return; }
      if (view === 'pmi' && window.PMI) { PMI.show(pid, projName()); joinCollab(); return; }
      load(); joinCollab();
    });

    var deps = { uid: UID, canWrite: canWrite, isAdmin: isAdmin };
    /* ⚠️⚠️ THE PMI TAB WRITES A CLAIM THROUGH THE CLAIMS REGISTER'S OWN persistRecord, never with
       an insert of its own. `2026-08-25-pmi.sql` put `claim_id` on `pmi_records` — *"set when this
       instruction becomes priced commercial work"* — and nothing has ever set it: grep found
       `claim_id` exactly ONCE in pmi.js, in a read-only chip. So the register showed a "claim"
       badge that could not be earned, and the promotion the roadmap calls for was a SQL statement.
       ⚠️ persistRecord carries the whole missing-column degrade (`_dropMissingNull`, eight
       attempts, `warnDropped` naming the right migration per column). A second insert path here
       would be a second set of bugs on the one table whose schema is provably incomplete on the
       live database — 2026-08-27 confirmed `contracts_claims.package_id` absent. */
    var pmiDeps = Object.assign({}, deps, {
      createClaim: async function (payload) {
        var res = await persistRecord(payload, null);
        if (!res.ok) throw (res.error || new Error('Could not create the claim.'));
        warnDropped(res.dropped);
        return res.row;
      },
      /* ⚠️ THE ROLLBACK, and it is not optional. The claim is written FIRST because the PMI needs
         its id, so a failed link leaves a real commercial record with nothing pointing at it —
         indistinguishable from a duplicate somebody filed by hand. Exactly the trap the wizard's
         package rollback was added for after the owner hit it twice. */
      deleteClaim: async function (id) {
        var d = await sb().from(TABLE).delete().eq('id', id);
        if (d.error) throw d.error;
        rows = rows.filter(function (x) { return String(x.id) !== String(id); });
      },
      claimById: function (id) { return rows.filter(function (x) { return String(x.id) === String(id); })[0] || null; },
      gotoClaim: function (t) { gotoTypeTab(t); }
    });
    if (window.CCPackages) CCPackages.init(deps);
    /* The BOQ screen reaches the wizard through module.js rather than building its own
       dependency object - one wizard, one set of deps, no drift. */
    if (window.BOQ) BOQ.init(Object.assign({}, deps, { openWizard: openNew }));
    if (window.CCAffected) CCAffected.init(deps);
    if (window.PMI) PMI.init(pmiDeps);
    document.querySelectorAll('.cc-tab').forEach(function (t) { t.onclick = function () { switchTab(t.dataset.view); if (histView) histView.push(); }; });
    // Browser-history integration (UI.bindHistoryState, ui.js) for the top-level
    // Contract/Claims/Extension-of-Time tabs — without it the browser's native Back
    // button jumps straight past a tab switch to the module launcher. Scoped to
    // these three tabs only; the BOQ/PMI sub-screens (`sub`) are a deeper drill-down
    // left for a follow-up, same as this app's other modules.
    histView = UI.bindHistoryState({
      key: 'cc_view',
      get: function () { return { v: view }; },
      apply: function (s) { switchTab(s.v); }
    });
    /* ⚠️ `openNew`, NOT `openNew` AS THE HANDLER — the difference is the whole bug.
       Bound directly, the browser passes the PointerEvent as `type`, and CCWizard.open does
       `st.type = type || 'Contract'`. A PointerEvent is truthy, so the wizard opened with its
       record type set to a DOM event: no card was highlighted, and `liveSteps()` computed the
       rail from a type that matches nothing — so the BOQ step was missing from the step count
       until the planner happened to click a card. It recovered on that click, which is why it
       survived; it was never right. */
    /* Pre-selects the type THIS TAB shows, so + Add on the EOT register does not open on
       Contract. The Claims tab covers two, and takes its own label's first — Change Order is
       one click away in the same step. ⚠️ Never pass a falsy type to skip the choice:
       CCWizard reads `type || 'Contract'`, so "no preference" silently means Contract. */
    document.getElementById('cc-add').onclick = function () {
      openNew(view === 'eot' ? 'EOT' : view === 'claims' ? 'Claim' : 'Contract');
    };
    document.getElementById('cc-export').onclick = exportExcel;
    document.getElementById('cc-print').onclick = function () { window.print(); };
    document.getElementById('cc-clear').onclick = clearAll;

    var q = document.getElementById('cc-f-search'), timer = null;
    q.addEventListener('input', function () {
      clearTimeout(timer); timer = setTimeout(function () { filters.q = q.value; render(); }, 160);
    });
    document.getElementById('cc-f-type').addEventListener('change', function (e) { filters.type = e.target.value; render(); });
    document.getElementById('cc-f-status').addEventListener('change', function (e) { filters.status = e.target.value; render(); });
    var pkgSel = document.getElementById('cc-f-pkg');
    if (pkgSel) pkgSel.addEventListener('change', function (e) { filters.pkg = e.target.value; render(); });
    document.getElementById('cc-f-datefield').addEventListener('change', function (e) { filters.dateField = e.target.value; render(); });
    document.getElementById('cc-f-from').addEventListener('change', function (e) { filters.from = e.target.value; render(); });
    document.getElementById('cc-f-to').addEventListener('change', function (e) { filters.to = e.target.value; render(); });
    document.getElementById('cc-f-clear').onclick = function () {
      filters = { q: '', type: '', status: '', dateField: '', from: '', to: '', pkg: '' };
      q.value = '';
      ['cc-f-type', 'cc-f-status', 'cc-f-datefield', 'cc-f-from', 'cc-f-to', 'cc-f-pkg'].forEach(function (id) { var e = document.getElementById(id); if (e) e.value = ''; });
      render();
      if (filterToggle) filterToggle.sync(); // fields reset programmatically — no native change event
    };
    // The whole filter bar hides behind one funnel toggle instead of sitting
    // permanently open (see the "Filter bar" comment in module.css) — the dot
    // stays in sync with the panel's own controls automatically.
    filterToggle = UI.wireFilterToggle(document.getElementById('cc-filttoggle'), document.getElementById('cc-filters'));

    await load();
    joinCollab();
  }

  return {
    init: init,
    _internals: { agingOf: agingOf, daysBetween: daysBetween, totals: totals, num: num, clean: clean,
      descOf: descOf, visibleRows: visibleRows, VIEWS: VIEWS,
      _set: function (o) { if (o.rows) rows = o.rows; if (o.view) view = o.view; if (o.filters) filters = o.filters; if (o.pid) pid = o.pid; } }
  };
})();
