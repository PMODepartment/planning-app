// ============================================================================
// Risk Register — REFERENCE MODULE (end-to-end example for all developers)
// ----------------------------------------------------------------------------
// Demonstrates everything the contract asks for:
//   • shared auth (AppAuth) + user bar
//   • shared project context via sessionStorage 'pd_project'
//   • project-scoped Supabase queries
//   • created_by stamping (RLS), Fmt.esc on all injected text
//   • full CRUD via a modal form
//   • derived field (rating = likelihood × impact) computed in the app
//   • a second view (5×5 risk matrix) + filters + KPIs
//
// Copy this structure for other modules; swap TABLE + fields + columns.
// ============================================================================

window.RiskRegister = (function () {
  var TABLE = 'risk_register';
  var profile = null;
  var pid = null;            // current project id (shared key 'pd_project')
  var rows = [];             // current project's risks (raw from DB)
  var filters = { status: '', category: '', search: '', cell: null };

  var CATEGORIES = ['Technical','Commercial','Schedule','Safety','Environmental',
                    'Financial','Regulatory','Resource','External'];
  var RESPONSES = ['Avoid','Mitigate','Transfer','Accept'];
  var STATUSES  = ['Open','In Progress','Closed'];

  function sb() { return AppAuth.getSB(); }

  // ===== live collaboration (presence + who's-editing row cursor) + offline =====
  // Shared PDCollab (Realtime) + PDSync (offline outbox). Modal-edit register, so
  // the cursor is row-level: opening a row's Edit modal flags that row for others.
  var _collab = null, _remoteSel = {}, _collabSelf = {}, PKEY = 'risk_register', PID_PFX = 'rr';
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
  // Attach editing-cursor broadcast to an Edit modal (row-level). Clears on cancel/save/backdrop.
  function wireModalCursor(m, r) {
    if (!r || !r.id) return;
    var oc = m.close; m.close = function () { broadcastCollabSel(null); oc(); };
    broadcastCollabSel(r.id, true);
    m.el.addEventListener('click', function (e) { if (e.target === m.el) broadcastCollabSel(null); });
  }

  // ---- Rating bands (1..25) ----
  function ratingBand(r) {
    if (r >= 15) return { label: 'High',   cls: 'rr-high' };
    if (r >= 8)  return { label: 'Medium', cls: 'rr-med'  };
    if (r >= 1)  return { label: 'Low',    cls: 'rr-low'  };
    return { label: '—', cls: '' };
  }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    _collabSelf = { id: (user && user.id) || (prof && prof.id), name: (prof && (prof.name || prof.email)) || 'Someone' };
    await loadProjects();

    document.getElementById('rr-add').onclick = function () { openForm(null); };
    document.getElementById('rr-project').onchange = function (e) {
      pid = e.target.value;
      sessionStorage.setItem('pd_project', pid);
      load();
      joinCollab();
    };
    ['rr-f-status','rr-f-category','rr-f-search'].forEach(function (id) {
      var el = document.getElementById(id);
      el.oninput = el.onchange = function () {
        filters.status   = document.getElementById('rr-f-status').value;
        filters.category = document.getElementById('rr-f-category').value;
        filters.search   = document.getElementById('rr-f-search').value.toLowerCase().trim();
        render();
      };
    });
    // sidebar view switch
    document.querySelectorAll('.rr-tabs [data-view]').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); switchView(a.dataset.view, a); };
    });

    if (pid) load();
    joinCollab();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = document.getElementById('rr-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);   // shared searchable project picker
    if (!projects.length) {
      document.getElementById('rr-table').innerHTML =
        '<tr><td style="padding:24px;color:var(--pd-muted);">No projects yet. Ask an admin to create one.</td></tr>';
    }
  }

  async function load() {
    if (!pid) return;
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid).order('rating', { ascending: false, nullsFirst: false });
    if (res.error) {
      if (window.PDSync) { var c = await PDSync.cacheGet(PID_PFX + ':' + pid); if (c && c.rows) { rows = c.rows.slice(); render(); return; } }
      UI.toast(res.error.message, 'error'); return;
    }
    rows = res.data || [];
    if (window.PDSync) PDSync.cachePut(PID_PFX + ':' + pid, rows);   // offline read-cache
    // populate category filter from data
    var cats = {};
    rows.forEach(function (r) { if (r.category) cats[r.category] = 1; });
    var csel = document.getElementById('rr-f-category');
    csel.innerHTML = '<option value="">All categories</option>' +
      Object.keys(cats).sort().map(function (c) {
        return '<option' + (filters.category === c ? ' selected' : '') + '>' + Fmt.esc(c) + '</option>';
      }).join('');
    render();
  }

  // ---- filtering ----
  function filtered() {
    return rows.filter(function (r) {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.category && r.category !== filters.category) return false;
      if (filters.cell && (r.likelihood !== filters.cell.l || r.impact !== filters.cell.i)) return false;
      if (filters.search) {
        var hay = [r.risk_code, r.title, r.description, r.owner, r.category]
          .join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    renderKpis();
    renderTable();
    renderMatrix();
    paintRemote();
  }

  function renderKpis() {
    var open = rows.filter(function (r){ return r.status !== 'Closed'; });
    var high = open.filter(function (r){ return (r.rating||0) >= 15; }).length;
    var med  = open.filter(function (r){ var x=r.rating||0; return x>=8 && x<15; }).length;
    var k = document.getElementById('rr-kpis');
    k.innerHTML =
      kpi('Total risks', rows.length, '') +
      kpi('Open', open.length, '') +
      kpi('High', high, 'rr-high') +
      kpi('Medium', med, 'rr-med');
  }
  function kpi(label, val, cls) {
    return '<div class="rr-kpi ' + cls + '"><div class="rr-kpi-val">' + val + '</div>' +
      '<div class="rr-kpi-label">' + label + '</div></div>';
  }

  function renderTable() {
    var data = filtered();
    var t = document.getElementById('rr-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No risks yet for this project. Click “Add risk”.</td></tr>';
      return;
    }
    var head = '<thead><tr>' +
      '<th>Code</th><th>Title</th><th>Category</th><th>L</th><th>I</th>' +
      '<th>Rating</th><th>Response</th><th>Owner</th><th>Status</th><th></th>' +
      '</tr></thead>';
    var body = data.map(function (r) {
      var band = ratingBand(r.rating);
      // data-l = the column heading. Unused on desktop (the <thead> supplies it);
      // below 700px module.css hides the head and stacks each row into a card,
      // where every value needs its own inline label (.rr-table td::before).
      return '<tr>' +
        '<td class="rr-c-code" data-l="Code">' + Fmt.esc(r.risk_code) + '</td>' +
        '<td class="rr-c-title"><strong>' + Fmt.esc(r.title) + '</strong>' +
          (r.description ? '<div class="rr-sub">' + Fmt.esc(r.description) + '</div>' : '') + '</td>' +
        '<td data-l="Category">' + Fmt.esc(r.category) + '</td>' +
        '<td data-l="Likelihood">' + (r.likelihood || '—') + '</td>' +
        '<td data-l="Impact">' + (r.impact || '—') + '</td>' +
        '<td data-l="Rating"><span class="rr-pill ' + band.cls + '">' + (r.rating || '—') + ' · ' + band.label + '</span></td>' +
        '<td data-l="Response">' + Fmt.esc(r.response) + '</td>' +
        '<td data-l="Owner">' + Fmt.esc(r.owner) + '</td>' +
        '<td data-l="Status">' + Fmt.esc(r.status) + '</td>' +
        '<td class="rr-rowacts" style="white-space:nowrap;">' +
          '<button class="pd-btn" data-edit="' + r.id + '">Edit</button> ' +
          '<button class="pd-btn" data-del="' + r.id + '">Delete</button></td>' +
      '</tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="10" style="padding:24px;color:var(--pd-muted);">No risks match the current filters.</td></tr>') + '</tbody>';

    t.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openForm(rows.find(function (x){ return x.id === b.dataset.edit; })); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.dataset.del); };
    });
  }

  // ---- 5×5 matrix ----
  function renderMatrix() {
    var counts = {};
    rows.forEach(function (r) {
      if (r.likelihood && r.impact) {
        var key = r.likelihood + 'x' + r.impact;
        counts[key] = (counts[key] || 0) + 1;
      }
    });
    var html = '<table class="rr-matrix"><tbody>';
    for (var l = 5; l >= 1; l--) {
      html += '<tr><th class="rr-axis">L' + l + '</th>';
      for (var i = 1; i <= 5; i++) {
        var band = ratingBand(l * i);
        var c = counts[l + 'x' + i] || 0;
        var active = filters.cell && filters.cell.l === l && filters.cell.i === i;
        html += '<td class="rr-cell ' + band.cls + (active ? ' rr-cell-active' : '') +
          '" data-l="' + l + '" data-i="' + i + '" title="L' + l + ' × I' + i + ' = ' + (l*i) + '">' +
          (c ? c : '') + '</td>';
      }
      html += '</tr>';
    }
    html += '<tr><th class="rr-axis"></th>';
    for (var x = 1; x <= 5; x++) html += '<th class="rr-axis">I' + x + '</th>';
    html += '</tr></tbody></table>';
    var m = document.getElementById('rr-matrix');
    m.innerHTML = html;
    m.querySelectorAll('.rr-cell').forEach(function (cell) {
      cell.onclick = function () {
        var l = +cell.dataset.l, i = +cell.dataset.i;
        if (filters.cell && filters.cell.l === l && filters.cell.i === i) filters.cell = null;
        else filters.cell = { l: l, i: i };
        switchView('list');
        document.querySelector('.rr-tabs [data-view="list"]').classList.add('active');
        document.querySelector('.rr-tabs [data-view="matrix"]').classList.remove('active');
        render();
      };
    });
  }

  function switchView(view, link) {
    document.getElementById('rr-view-list').style.display   = view === 'list'   ? '' : 'none';
    document.getElementById('rr-view-matrix').style.display = view === 'matrix' ? '' : 'none';
    if (link) {
      document.querySelectorAll('.rr-tabs [data-view]').forEach(function (a){ a.classList.remove('active'); });
      link.classList.add('active');
    }
  }

  // ---- Add / Edit form ----
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    function opts(list, val) {
      return list.map(function (o){ return '<option' + (val === o ? ' selected' : '') + '>' + o + '</option>'; }).join('');
    }
    function num(val) {
      var s = '<option value="">—</option>';
      for (var n = 1; n <= 5; n++) s += '<option value="' + n + '"' + (+val === n ? ' selected' : '') + '>' + n + '</option>';
      return s;
    }
    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Add risk' : 'Edit risk') + '</h2>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:0 0 130px;"><label>Risk code</label><input class="pd-input" id="f-code" value="' + Fmt.esc(r.risk_code) + '" placeholder="R-001"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Title</label><input class="pd-input" id="f-title" value="' + Fmt.esc(r.title) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Description</label><textarea class="pd-textarea" id="f-desc" rows="2">' + Fmt.esc(r.description) + '</textarea></div>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Category</label><select class="pd-select" id="f-cat"><option value="">—</option>' + opts(CATEGORIES, r.category) + '</select></div>' +
        '<div class="pd-field" style="flex:0 0 110px;"><label>Likelihood</label><select class="pd-select" id="f-like">' + num(r.likelihood) + '</select></div>' +
        '<div class="pd-field" style="flex:0 0 110px;"><label>Impact</label><select class="pd-select" id="f-imp">' + num(r.impact) + '</select></div>' +
        '<div class="pd-field" style="flex:0 0 120px;"><label>Rating</label><input class="pd-input" id="f-rating" disabled value="' + (r.rating || '') + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Response</label><select class="pd-select" id="f-resp"><option value="">—</option>' + opts(RESPONSES, r.response) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Owner</label><input class="pd-input" id="f-owner" value="' + Fmt.esc(r.owner) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Status</label><select class="pd-select" id="f-status">' + opts(STATUSES, r.status || 'Open') + '</select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Mitigation plan</label><textarea class="pd-textarea" id="f-mit" rows="2">' + Fmt.esc(r.mitigation) + '</textarea></div>' +
      '<div class="pd-field"><label>Review date</label><input class="pd-input" type="date" id="f-review" value="' + (r.review_date || '') + '"></div>' +
      '<div style="text-align:right;margin-top:6px;"><button class="pd-btn" id="f-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save">Save</button></div>'
    );

    wireModalCursor(m, isNew ? null : r);
    function recalc() {
      var l = +m.el.querySelector('#f-like').value || 0;
      var i = +m.el.querySelector('#f-imp').value || 0;
      m.el.querySelector('#f-rating').value = (l && i) ? (l * i) : '';
    }
    m.el.querySelector('#f-like').onchange = recalc;
    m.el.querySelector('#f-imp').onchange = recalc;
    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var l = +m.el.querySelector('#f-like').value || null;
      var i = +m.el.querySelector('#f-imp').value || null;
      var data = {
        project_id: pid,
        risk_code:   m.el.querySelector('#f-code').value.trim(),
        title:       m.el.querySelector('#f-title').value.trim(),
        description: m.el.querySelector('#f-desc').value.trim(),
        category:    m.el.querySelector('#f-cat').value,
        likelihood:  l,
        impact:      i,
        rating:      (l && i) ? l * i : null,    // derived field, computed app-side
        response:    m.el.querySelector('#f-resp').value,
        owner:       m.el.querySelector('#f-owner').value.trim(),
        status:      m.el.querySelector('#f-status').value,
        mitigation:  m.el.querySelector('#f-mit').value.trim(),
        review_date: m.el.querySelector('#f-review').value || null,
        updated_at:  new Date().toISOString(),
      };
      if (!data.title) { UI.toast('Title is required', 'warn'); return; }
      try {
        if (isNew) {
          data.created_by = profile.id;        // REQUIRED for RLS
          var ins = await sb().from(TABLE).insert(data);
          if (ins.error) throw ins.error;
          UI.toast('Saved', 'ok'); m.close(); load();
        } else {
          Object.assign(r, data);   // optimistic — applies whether online or queued offline
          if (window.PDSync) {
            var w = await PDSync.write({ table: TABLE, op: 'update', id: r.id, patch: data });
            if (!w.ok) throw (w.error || new Error('Save failed'));
            PDSync.cachePut(PID_PFX + ':' + pid, rows);
          } else {
            var upd = await sb().from(TABLE).update(data).eq('id', r.id);
            if (upd.error) throw upd.error;
          }
          UI.toast('Saved', 'ok'); m.close(); render();
        }
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    // Autosave (edit only): debounced re-use of the Save button's own handler,
    // with the modal's close suppressed for the duration of an autosave write.
    if (!isNew && window.Autosave) {
      var asInd = document.createElement('span');
      asInd.className = 'pd-autosave pd-autosave-idle';
      asInd.textContent = 'Autosave on';
      var h2 = m.el.querySelector('h2');
      if (h2) { h2.style.display = 'flex'; h2.style.alignItems = 'center'; h2.style.gap = '10px'; h2.appendChild(asInd); }
      var as = Autosave.wire({ root: m.el, modal: m, saveBtn: m.el.querySelector('#f-save'), indicator: asInd });
      var _rrClose = m.close;
      m.close = function () { as.cancel(); _rrClose(); };
    }
  }

  async function del(id) {
    if (!confirm('Delete this risk? This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
