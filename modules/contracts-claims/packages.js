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
  var esc = function (x) { return Fmt.esc(String(x == null ? '' : x)); };
  function host() { return document.getElementById('cc-view'); }

  function init(deps) { UID = deps.uid; canWrite = !!deps.canWrite; }
  function reset() { loaded = false; PKG = []; }
  async function show(projectId) {
    pid = projectId;
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

  function render() {
    var h = host(); if (!h) return;
    var head = '<div class="boq-filters">' +
      (canWrite ? '<button class="pd-btn pd-btn-primary" id="pk-add">New package</button> ' +
        '<button class="pd-btn" id="pk-push" title="Mirror these packages into the Procurement (WPM) and Engineering apps so their records can be filed under the same contract lots">Share with Procurement &amp; Engineering</button>' : '') +
      '</div>';
    if (!PKG.length) {
      h.innerHTML = head +
        '<div class="pd-card cc-empty"><h3>No contract packages yet</h3>' +
        '<p>A package is a scope division of this project — <b>Package 1 — Tower 1 and General ' +
        'Requirements</b>, <b>Package 2 — Towers 2-7</b>. They come off the contract documents.</p>' +
        '<p class="cc-hint">Record a <b>Contract</b> on the Contract tab and it can define its package as ' +
        'you save it — or add one here directly. Everything downstream files against these: the schedule\'s ' +
        'top-level rows, the BOQ, procurement and engineering.</p></div>';
      wire(h); return;
    }
    var rows = PKG.map(function (k) {
      /* ⚠️ A package with no finish date reads "— not set —", never blank: the schedule's
         EOT arithmetic needs it (revised finish = end_date + granted days), so a missing
         one is a gap to fill, not an empty cell to scroll past. */
      return '<tr data-pk="' + esc(k.id) + '">' +
        '<td><strong>' + esc(k.code) + '</strong></td>' +
        '<td>' + esc(k.name) + '</td>' +
        /* k-active / k-archived are this status's OWN variants. The first cut borrowed
           k-measured, which is legible but means "measured quantity" everywhere else —
           one class with two meanings is how a vocabulary rots. */
        '<td><span class="boq-kind k-' + esc(k.status === 'archived' ? 'archived' : 'active') + '">' +
          esc(k.status || 'active') + '</span></td>' +
        '<td>' + (k.start_date ? esc(Fmt.date(k.start_date)) : '<span class="cc-mut">— not set —</span>') + '</td>' +
        '<td>' + (k.end_date ? esc(Fmt.date(k.end_date)) : '<span class="cc-mut">— not set —</span>') + '</td>' +
        '<td class="cc-r">' + (k.contract_amount != null ? esc(Fmt.moneyShort(k.contract_amount)) : '<span class="cc-mut">—</span>') + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-edit="' + esc(k.id) + '">Edit</button></td>' : '') +
        '</tr>';
    }).join('');
    h.innerHTML = head +
      '<div class="pd-card cc-tablecard"><table class="cc-table"><thead><tr>' +
      '<th>Code</th><th>Name</th><th>Status</th><th>Start</th><th>Finish</th>' +
      '<th class="cc-r">Contract amount</th>' + (canWrite ? '<th class="cc-actcol"></th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="cc-hint">These are what the schedule files its top-level rows under, what the BOQ is ' +
      'assigned to, and what procurement and engineering read once shared. ⚠️ <b>Finish</b> is the ' +
      'contractual completion date the schedule\'s EOT arithmetic revises — a package without one shows ' +
      'no revised finish and no exposure.</p></div>';
    wire(h);
  }
  function wire(h) {
    var a = h.querySelector('#pk-add'); if (a) a.onclick = function () { edit(null); };
    var p = h.querySelector('#pk-push'); if (p) p.onclick = share;
    h.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { edit(PKG.filter(function (k) { return String(k.id) === b.dataset.edit; })[0]); };
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
        contract_amount: num('pk-amt'), sort_order: num('pk-sort') || 0
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
