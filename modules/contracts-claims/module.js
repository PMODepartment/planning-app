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
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- vocabularies (from the app's own dropdowns) --------------------------
  var STATUSES = ['Pending', 'Approved', 'Disapproved', 'Cancelled'];
  var STATUS_CLS = { 'Pending': 'st-pending', 'Approved': 'st-approved', 'Disapproved': 'st-disapproved', 'Cancelled': 'st-cancelled' };
  var CLAIM_TYPES = ['Claim', 'Change Order'];

  /* One config per tab. `cols` are the four pipeline columns in display order;
     `fmt` is how their values render. Contract has no pipeline — it's a flat
     description + amount list — so it carries a single `amount` column. */
  var VIEWS = {
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
  var UID = null, pid = null, rows = [], view = 'contract';
  var canWrite = false, isAdmin = false, sel = {};
  var filters = { q: '', type: '', status: '', dateField: '', from: '', to: '' };

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
  function render() {
    var host = document.getElementById('cc-view');
    // The Claim/CO type filter only applies to the claims tab.
    document.getElementById('cc-f-type').style.display = view === 'claims' ? '' : 'none';
    syncClearFilt();

    if (!rows.length) { host.innerHTML = emptyHTML(); wireEmpty(); return; }
    var c = cfg(), list = visibleRows(), t = totals(list);
    document.getElementById('cc-count').textContent = 'Showing ' + list.length + ' ' + (list.length === 1 ? 'record' : 'records');

    var h = kpiHTML(list, t);

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
          (r.counterparty ? '<div class="cc-mini">' + esc(clean(r.counterparty)) + '</div>' : '') + '</td>' +
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
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    wire();
  }

  function kpiHTML(list, t) {
    var c = cfg();
    if (view === 'contract') {
      return '<div class="cc-kpis">' +
        kpi('Contracts', list.length, 'records on this project') +
        kpi('Total contract value', num(t.amount), 'sum of all contracts') +
        '</div>';
    }
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
    var b = document.getElementById('cc-e-add'); if (b) b.onclick = function () { openForm(null); };
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
  function openForm(r) {
    if (!canWrite) { UI.toast('You do not have permission to edit records.', 'error'); return; }
    if (!pid) { UI.toast('Select a project first.', 'error'); return; }
    var e = r || {};
    // A new record defaults to the tab you're on, so Add always lands in the
    // right register rather than making you pick the type twice.
    var defType = e.record_type || (view === 'contract' ? 'Contract' : view === 'eot' ? 'EOT' : 'Change Order');
    var ALL_TYPES = ['Contract', 'Claim', 'Change Order', 'EOT'];

    function f(label, id, val, type, attrs) {
      return '<label>' + esc(label) + '<input id="' + id + '" type="' + (type || 'text') + '" ' + (attrs || '') +
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

      // Contract amount — only relevant to a Contract row.
      '<div class="cc-sec" data-only="Contract">Contract value</div>' +
      '<label data-only="Contract">Contract amount<input id="cc-f-amount" type="number" step="0.01" value="' + esc(e.amount == null ? '' : e.amount) + '" /></label>' +

      // The four-stage pipeline, money or days depending on type.
      '<div class="cc-sec" data-not="Contract">Pipeline</div>' +
      '<p class="cc-hint" data-not="Contract">Estimated → Submitted → Evaluated → Client Approved. ' +
        '<span data-only="EOT">Extension of Time is measured in days.</span>' +
        '<span data-not="EOT">Claims and Change Orders are amounts.</span></p>' +
      '<label data-money>Estimated amount<input id="cc-f-est-a" type="number" step="0.01" value="' + esc(e.est_amount == null ? '' : e.est_amount) + '" /></label>' +
      '<label data-money>Submitted amount<input id="cc-f-sub-a" type="number" step="0.01" value="' + esc(e.sub_amount == null ? '' : e.sub_amount) + '" /></label>' +
      '<label data-money>Evaluated amount<input id="cc-f-eval-a" type="number" step="0.01" value="' + esc(e.eval_amount == null ? '' : e.eval_amount) + '" /></label>' +
      '<label data-money>Client approved amount<input id="cc-f-appr-a" type="number" step="0.01" value="' + esc(e.approved_amount == null ? '' : e.approved_amount) + '" /></label>' +
      '<label data-days>Estimated days<input id="cc-f-est-d" type="number" step="1" value="' + esc(e.est_days == null ? '' : e.est_days) + '" /></label>' +
      '<label data-days>Submitted days<input id="cc-f-sub-d" type="number" step="1" value="' + esc(e.sub_days == null ? '' : e.sub_days) + '" /></label>' +
      '<label data-days>Evaluated days<input id="cc-f-eval-d" type="number" step="1" value="' + esc(e.eval_days == null ? '' : e.eval_days) + '" /></label>' +
      '<label data-days>Client approved days<input id="cc-f-appr-d" type="number" step="1" value="' + esc(e.approved_days == null ? '' : e.approved_days) + '" /></label>' +

      '<div class="cc-sec" data-not="Contract">Status &amp; dates</div>' +
      '<label data-not="Contract">Status<select id="cc-f-stat"><option value="">—</option>' +
        STATUSES.map(function (s) { return '<option' + (statusOf(e) === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></label>' +
      f('Date filed', 'cc-f-filed', e.date_filed, 'date') +
      f('Date submitted', 'cc-f-subd', e.date_submitted, 'date') +
      f('Date evaluated', 'cc-f-evald', e.date_evaluated, 'date') +
      f('Date approved', 'cc-f-apprd', e.date_approved, 'date') +
      '<p class="cc-hint" data-not="Contract">Aging is calculated from <b>Date submitted</b> while the record is Pending — it is never stored.</p>' +
      '<label class="cc-wide">Remarks<textarea id="cc-f-rem">' + esc(e.remarks || '') + '</textarea></label>';

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' + (r ? 'Edit' : 'Add') + ' record</h2>' +
      '<button class="pd-modal-close" id="cc-m-x">&times;</button></div>' +
      '<div class="cc-form">' + body + '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="cc-m-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="cc-m-save">Save</button></div>');

    var el = function (id) { return m.el.querySelector('#' + id); };

    // Show only the fields that belong to the chosen type, so a Contract never
    // shows a days pipeline and an EOT never shows peso boxes.
    function applyType() {
      var t = el('cc-f-rtype').value;
      m.el.querySelectorAll('[data-only]').forEach(function (n) { n.style.display = n.dataset.only === t ? '' : 'none'; });
      m.el.querySelectorAll('[data-not]').forEach(function (n) { n.style.display = n.dataset.not === t ? 'none' : ''; });
      m.el.querySelectorAll('[data-money]').forEach(function (n) { n.style.display = (t === 'Claim' || t === 'Change Order') ? '' : 'none'; });
      m.el.querySelectorAll('[data-days]').forEach(function (n) { n.style.display = t === 'EOT' ? '' : 'none'; });
    }
    el('cc-f-rtype').addEventListener('change', applyType);
    applyType();

    el('cc-m-x').onclick = m.close;
    el('cc-m-cancel').onclick = m.close;
    el('cc-m-save').onclick = async function () {
      var v = function (id) { var x = (el(id).value || '').trim(); return x === '' ? null : x; };
      var n = function (id) { var x = v(id); if (x == null) return null; var y = Number(x); return isFinite(y) ? y : null; };
      var t = el('cc-f-rtype').value;
      var payload = {
        project_id: pid, record_type: t,
        reference_no: v('cc-f-ref'), description: v('cc-f-desc'), counterparty: v('cc-f-cp'),
        amount: t === 'Contract' ? n('cc-f-amount') : null,
        est_amount: null, sub_amount: null, eval_amount: null, approved_amount: null,
        est_days: null, sub_days: null, eval_days: null, approved_days: null,
        status: t === 'Contract' ? null : v('cc-f-stat'),
        date_filed: v('cc-f-filed'), date_submitted: v('cc-f-subd'),
        date_evaluated: v('cc-f-evald'), date_approved: v('cc-f-apprd'),
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
      var res;
      if (r) res = await sb().from(TABLE).update(payload).eq('id', r.id).select().single();
      else { payload.created_by = UID; payload.sort_order = rows.length; res = await sb().from(TABLE).insert(payload).select().single(); }
      if (res.error) {
        btn.disabled = false; btn.textContent = 'Save';
        var msg = /column|schema cache|PGRST204/i.test(res.error.message || '')
          ? 'Save failed — run migrations/2026-07-20-contracts-claims-full.sql first. (' + res.error.message + ')'
          : res.error.message;
        UI.toast(msg, 'error'); return;
      }
      if (r) Object.assign(r, res.data); else rows.push(res.data);
      m.close(); UI.toast(r ? 'Record updated.' : 'Record added.', 'success');
      // Follow the record if its type moved it to another tab, so it doesn't
      // silently "disappear" from the view you're looking at.
      var target = t === 'Contract' ? 'contract' : t === 'EOT' ? 'eot' : 'claims';
      if (target !== view) switchTab(target); else render();
    };
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
    var res = await sb().from(TABLE).update({ status: status, updated_at: new Date().toISOString() }).in('id', ids);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows.forEach(function (r) { if (sel[r.id]) r.status = status; });
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
  function exportExcel() {
    var c = cfg(), list = visibleRows();
    if (!list.length) { UI.toast('Nothing to export.', 'error'); return; }
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

    var ws = XLSX.utils.json_to_sheet(aoa);
    ws['!cols'] = Object.keys(aoa[0]).map(function (k) { return { wch: k === 'Description' ? 46 : Math.max(13, k.length + 2) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, c.label.slice(0, 28));
    XLSX.writeFile(wb, c.label + ' - ' + (projName() || pid) + '.xlsx');
  }
  function projName() {
    var s = document.getElementById('cc-project');
    return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent : '';
  }

  // ==========================================================================
  // SHELL
  // ==========================================================================
  function syncClearFilt() {
    var on = !!(filters.q || filters.type || filters.status || filters.dateField || filters.from || filters.to);
    var b = document.getElementById('cc-f-clear'); if (b) b.hidden = !on;
  }

  function fillFilters() {
    function fill(id, values, cur) {
      var s = document.getElementById(id);
      s.innerHTML = s.options[0].outerHTML + values.map(function (v) {
        return '<option' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    }
    fill('cc-f-type', CLAIM_TYPES, filters.type);
    fill('cc-f-status', STATUSES, filters.status);
  }

  async function load() {
    if (!pid) { rows = []; render(); return; }
    document.getElementById('cc-view').innerHTML = '<div class="pd-card cc-empty"><h3><span class="cc-spin"></span>Loading…</h3></div>';
    var res = await sb().from(TABLE).select('*').eq('project_id', pid);
    if (res.error) {
      var missing = /column|schema cache|PGRST204|does not exist/i.test(res.error.message || '');
      document.getElementById('cc-view').innerHTML = '<div class="pd-card cc-empty"><h3>Could not load the register</h3><p>' +
        esc(res.error.message) + '</p>' + (missing
          ? '<p class="cc-mut">Run <code>migrations/2026-07-20-contracts-claims-full.sql</code> in the Supabase SQL editor, then reload.</p>' : '') + '</div>';
      return;
    }
    rows = res.data || [];
    rows.sort(function (a, b) {
      var d = (a.sort_order || 0) - (b.sort_order || 0); if (d) return d;
      return String(a.reference_no || '').localeCompare(String(b.reference_no || ''), undefined, { numeric: true });
    });
    fillFilters();
    render();
  }

  function switchTab(v) {
    view = v;
    document.querySelectorAll('.cc-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === v); });
    sel = {};
    if (v !== 'claims') { filters.type = ''; var ft = document.getElementById('cc-f-type'); if (ft) ft.value = ''; }
    render();
  }

  async function init(user, profile) {
    UID = (user && user.id) || (profile && profile.id) || null;
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
    var stored = sessionStorage.getItem('pd_project');
    if (stored && projects.some(function (p) { return String(p.id) === String(stored); })) selEl.value = stored;
    pid = selEl.value || (projects[0] && projects[0].id) || null;
    if (UI.enhanceProjectSelect) UI.enhanceProjectSelect(selEl);
    selEl.addEventListener('change', function () {
      pid = selEl.value; sessionStorage.setItem('pd_project', pid); sel = {}; load();
    });

    document.querySelectorAll('.cc-tab').forEach(function (t) { t.onclick = function () { switchTab(t.dataset.view); }; });
    document.getElementById('cc-add').onclick = function () { openForm(null); };
    document.getElementById('cc-export').onclick = exportExcel;
    document.getElementById('cc-print').onclick = function () { window.print(); };
    document.getElementById('cc-clear').onclick = clearAll;

    var q = document.getElementById('cc-f-search'), timer = null;
    q.addEventListener('input', function () {
      clearTimeout(timer); timer = setTimeout(function () { filters.q = q.value; render(); }, 160);
    });
    document.getElementById('cc-f-type').addEventListener('change', function (e) { filters.type = e.target.value; render(); });
    document.getElementById('cc-f-status').addEventListener('change', function (e) { filters.status = e.target.value; render(); });
    document.getElementById('cc-f-datefield').addEventListener('change', function (e) { filters.dateField = e.target.value; render(); });
    document.getElementById('cc-f-from').addEventListener('change', function (e) { filters.from = e.target.value; render(); });
    document.getElementById('cc-f-to').addEventListener('change', function (e) { filters.to = e.target.value; render(); });
    document.getElementById('cc-f-clear').onclick = function () {
      filters = { q: '', type: '', status: '', dateField: '', from: '', to: '' };
      q.value = '';
      ['cc-f-type', 'cc-f-status', 'cc-f-datefield', 'cc-f-from', 'cc-f-to'].forEach(function (id) { document.getElementById(id).value = ''; });
      render();
    };

    await load();
  }

  return {
    init: init,
    _internals: { agingOf: agingOf, daysBetween: daysBetween, totals: totals, num: num, clean: clean,
      descOf: descOf, visibleRows: visibleRows, VIEWS: VIEWS,
      _set: function (o) { if (o.rows) rows = o.rows; if (o.view) view = o.view; if (o.filters) filters = o.filters; if (o.pid) pid = o.pid; } }
  };
})();
