// ============================================================================
// Stakeholder Map — Influence / Interest register + Power–Interest grid
// ----------------------------------------------------------------------------
// Built from the suite conventions (reference: risk-register) since there was no
// external app to mirror. The classic PMI stakeholder tool: log each stakeholder
// with their Influence (power) and Interest, and plot them on a Power–Interest
// grid whose quadrants prescribe an engagement strategy:
//
//     Influence High + Interest High  -> Manage Closely   (key players)
//     Influence High + Interest !High -> Keep Satisfied
//     Influence !High + Interest High -> Keep Informed
//     otherwise                       -> Monitor           (minimum effort)
//
// The engagement STRATEGY is DERIVED in-app from influence × interest and is
// never stored — it is a pure function of two stored fields, so persisting it
// would only let it drift. The `engagement` column stays free-text (the plan /
// notes). Mirrors risk-register's "derived rating" pattern, minus the storage.
// ============================================================================

window.StakeholderMap = (function () {
  var TABLE = 'stakeholder_map';
  var profile = null;
  var pid = null;            // current project id (shared key 'pd_project')
  var rows = [];             // current project's stakeholders (raw from DB)
  var filters = { category: '', influence: '', interest: '', search: '', cell: null };

  var CATEGORIES = ['Internal','Client','Regulator','Vendor','Community','Partner','Other'];
  var LEVELS     = ['Low','Medium','High'];

  function sb() { return AppAuth.getSB(); }

  // ---- Derived engagement strategy (influence × interest) ----------------
  // "High side" = the top band only (High). Medium is treated as not-high, so
  // only genuinely high-power/high-interest stakeholders land in the demanding
  // quadrants — a deliberate, documented threshold choice.
  function strategy(influence, interest) {
    var pHigh = influence === 'High';
    var iHigh = interest  === 'High';
    if (pHigh && iHigh) return { key: 'manage',  label: 'Manage Closely', cls: 'sm-manage' };
    if (pHigh)          return { key: 'satisfy', label: 'Keep Satisfied', cls: 'sm-satisfy' };
    if (iHigh)          return { key: 'inform',  label: 'Keep Informed',  cls: 'sm-inform' };
    if (influence || interest) return { key: 'monitor', label: 'Monitor', cls: 'sm-monitor' };
    return { key: '', label: '—', cls: '' };
  }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    await loadProjects();

    document.getElementById('sm-add').onclick = function () { openForm(null); };
    document.getElementById('sm-project').onchange = function (e) {
      pid = e.target.value;
      sessionStorage.setItem('pd_project', pid);
      load();
    };
    ['sm-f-category','sm-f-influence','sm-f-interest','sm-f-search'].forEach(function (id) {
      var el = document.getElementById(id);
      el.oninput = el.onchange = function () {
        filters.category  = document.getElementById('sm-f-category').value;
        filters.influence = document.getElementById('sm-f-influence').value;
        filters.interest  = document.getElementById('sm-f-interest').value;
        filters.search    = document.getElementById('sm-f-search').value.toLowerCase().trim();
        render();
      };
    });
    document.getElementById('sm-clear').onclick = function () {
      filters = { category: '', influence: '', interest: '', search: '', cell: null };
      document.getElementById('sm-f-category').value = '';
      document.getElementById('sm-f-influence').value = '';
      document.getElementById('sm-f-interest').value = '';
      document.getElementById('sm-f-search').value = '';
      render();
    };
    // view switch
    document.querySelectorAll('.sm-tabs [data-view]').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); switchView(a.dataset.view, a); };
    });

    if (pid) load();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = document.getElementById('sm-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);   // shared searchable project picker
    if (!projects.length) {
      document.getElementById('sm-table').innerHTML =
        '<tr><td style="padding:24px;color:var(--pd-muted);">No projects yet. Ask an admin to create one.</td></tr>';
    }
  }

  async function load() {
    if (!pid) return;
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid).order('name', { ascending: true, nullsFirst: false });
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows = res.data || [];
    render();
  }

  // ---- filtering ----
  function filtered() {
    return rows.filter(function (r) {
      if (filters.category && r.category !== filters.category) return false;
      if (filters.influence && r.influence !== filters.influence) return false;
      if (filters.interest && r.interest !== filters.interest) return false;
      if (filters.cell && (r.influence !== filters.cell.p || r.interest !== filters.cell.i)) return false;
      if (filters.search) {
        var hay = [r.name, r.organization, r.role_title, r.category, r.contact, r.engagement]
          .join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }

  function anyFilter() {
    return !!(filters.category || filters.influence || filters.interest || filters.search || filters.cell);
  }

  function render() {
    renderKpis();
    renderTable();
    renderGrid();
    document.getElementById('sm-clear').classList.toggle('show', anyFilter());
  }

  function renderKpis() {
    var manage = rows.filter(function (r){ return strategy(r.influence, r.interest).key === 'manage'; }).length;
    var satisfy = rows.filter(function (r){ return strategy(r.influence, r.interest).key === 'satisfy'; }).length;
    var highInf = rows.filter(function (r){ return r.influence === 'High'; }).length;
    var k = document.getElementById('sm-kpis');
    k.innerHTML =
      kpi('Stakeholders', rows.length, '') +
      kpi('Manage Closely', manage, 'sm-manage') +
      kpi('Keep Satisfied', satisfy, 'sm-satisfy') +
      kpi('High influence', highInf, '');
  }
  function kpi(label, val, cls) {
    return '<div class="sm-kpi ' + cls + '"><div class="sm-kpi-val">' + val + '</div>' +
      '<div class="sm-kpi-label">' + label + '</div></div>';
  }

  function renderTable() {
    var data = filtered();
    var t = document.getElementById('sm-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No stakeholders yet for this project. Click “Add stakeholder”.</td></tr>';
      return;
    }
    var head = '<thead><tr>' +
      '<th>Name</th><th>Organization</th><th>Role</th><th>Category</th>' +
      '<th>Influence</th><th>Interest</th><th>Strategy</th><th>Contact</th><th></th>' +
      '</tr></thead>';
    var body = data.map(function (r) {
      var st = strategy(r.influence, r.interest);
      return '<tr>' +
        '<td><strong>' + Fmt.esc(r.name) + '</strong>' +
          (r.engagement ? '<div class="sm-sub">' + Fmt.esc(r.engagement) + '</div>' : '') + '</td>' +
        '<td>' + Fmt.esc(r.organization) + '</td>' +
        '<td>' + Fmt.esc(r.role_title) + '</td>' +
        '<td>' + (r.category ? '<span class="sm-cat">' + Fmt.esc(r.category) + '</span>' : '') + '</td>' +
        '<td>' + lvl(r.influence) + '</td>' +
        '<td>' + lvl(r.interest) + '</td>' +
        '<td><span class="sm-pill ' + st.cls + '">' + st.label + '</span></td>' +
        '<td>' + Fmt.esc(r.contact) + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="pd-btn" data-edit="' + r.id + '">Edit</button> ' +
          '<button class="pd-btn" data-del="' + r.id + '">Delete</button></td>' +
      '</tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="9" style="padding:24px;color:var(--pd-muted);">No stakeholders match the current filters.</td></tr>') + '</tbody>';

    t.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openForm(rows.find(function (x){ return x.id === b.dataset.edit; })); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.dataset.del); };
    });
  }
  function lvl(v) {
    if (!v) return '<span style="color:var(--pd-muted);">—</span>';
    return '<span class="sm-lvl sm-l-' + v + '">' + Fmt.esc(v) + '</span>';
  }

  // ---- 3×3 Power–Interest grid ------------------------------------------
  // Rows = Influence (High at top → Low at bottom); Columns = Interest (Low → High).
  function renderGrid() {
    var buckets = {};
    rows.forEach(function (r) {
      if (r.influence && r.interest) {
        var key = r.influence + '|' + r.interest;
        (buckets[key] = buckets[key] || []).push(r);
      }
    });
    var infOrder = ['High','Medium','Low'];   // top → bottom
    var intOrder = ['Low','Medium','High'];   // left → right
    var html = '<table class="sm-grid"><tbody>';
    infOrder.forEach(function (p, ri) {
      html += '<tr>';
      if (ri === 0) html += '<th class="sm-axis sm-axis-y" rowspan="3">Influence →</th>';
      html += '<th class="sm-axis">' + p + '</th>';
      intOrder.forEach(function (i) {
        var st = strategy(p, i);
        var list = buckets[p + '|' + i] || [];
        var active = filters.cell && filters.cell.p === p && filters.cell.i === i;
        var chips = list.slice(0, 3).map(function (r) {
          return '<div class="sm-gchip" title="' + Fmt.esc(r.name) + '">' + Fmt.esc(r.name) + '</div>';
        }).join('');
        if (list.length > 3) chips += '<div class="sm-gchip sm-more">+' + (list.length - 3) + ' more</div>';
        html += '<td class="sm-gcell ' + st.cls + (active ? ' sm-cell-active' : '') +
          '" data-p="' + p + '" data-i="' + i + '" title="' + st.label + ' — Influence ' + p + ' × Interest ' + i + '">' +
          '<span class="sm-gcell-strat">' + st.label + '</span>' +
          (list.length ? '<span class="sm-gcell-count">' + list.length + '</span>' : '') +
          (list.length ? '<div class="sm-gchips">' + chips + '</div>' : '<div class="sm-grid-empty">—</div>') +
          '</td>';
      });
      html += '</tr>';
    });
    // x-axis labels
    html += '<tr><th></th><th></th>';
    intOrder.forEach(function (i) { html += '<th class="sm-axis">' + i + '</th>'; });
    html += '</tr>';
    html += '<tr><th></th><th></th><th class="sm-axis" colspan="3">Interest →</th></tr>';
    html += '</tbody></table>';

    var wrap = document.getElementById('sm-grid');
    wrap.innerHTML = html;
    wrap.querySelectorAll('.sm-gcell').forEach(function (cell) {
      cell.onclick = function () {
        var p = cell.dataset.p, i = cell.dataset.i;
        if (filters.cell && filters.cell.p === p && filters.cell.i === i) filters.cell = null;
        else filters.cell = { p: p, i: i };
        switchView('list');
        document.querySelector('.sm-tabs [data-view="list"]').classList.add('active');
        document.querySelector('.sm-tabs [data-view="grid"]').classList.remove('active');
        render();
      };
    });
  }

  function switchView(view, link) {
    document.getElementById('sm-view-list').style.display = view === 'list' ? '' : 'none';
    document.getElementById('sm-view-grid').style.display = view === 'grid' ? '' : 'none';
    if (link) {
      document.querySelectorAll('.sm-tabs [data-view]').forEach(function (a){ a.classList.remove('active'); });
      link.classList.add('active');
    }
  }

  // ---- Add / Edit form ---------------------------------------------------
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    function opts(list, val) {
      return list.map(function (o){ return '<option' + (val === o ? ' selected' : '') + '>' + o + '</option>'; }).join('');
    }
    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Add stakeholder' : 'Edit stakeholder') + '</h2>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Name</label><input class="pd-input" id="f-name" value="' + Fmt.esc(r.name) + '" placeholder="Jane Dela Cruz"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Organization</label><input class="pd-input" id="f-org" value="' + Fmt.esc(r.organization) + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Role / title</label><input class="pd-input" id="f-role" value="' + Fmt.esc(r.role_title) + '"></div>' +
        '<div class="pd-field" style="flex:0 0 170px;"><label>Category</label><select class="pd-select" id="f-cat"><option value="">—</option>' + opts(CATEGORIES, r.category) + '</select></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Influence (power)</label><select class="pd-select" id="f-inf"><option value="">—</option>' + opts(LEVELS, r.influence) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Interest</label><select class="pd-select" id="f-int"><option value="">—</option>' + opts(LEVELS, r.interest) + '</select></div>' +
        '<div class="pd-field" style="flex:0 0 190px;"><label>Strategy (derived)</label><input class="pd-input" id="f-strat" disabled value="' + Fmt.esc(strategy(r.influence, r.interest).label) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Contact</label><input class="pd-input" id="f-contact" value="' + Fmt.esc(r.contact) + '" placeholder="email / phone"></div>' +
      '<div class="pd-field"><label>Engagement strategy / notes</label><textarea class="pd-textarea" id="f-eng" rows="3">' + Fmt.esc(r.engagement) + '</textarea></div>' +
      '<div style="text-align:right;margin-top:6px;"><button class="pd-btn" id="f-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save">Save</button></div>'
    );

    function recalc() {
      var st = strategy(m.el.querySelector('#f-inf').value, m.el.querySelector('#f-int').value);
      m.el.querySelector('#f-strat').value = st.label;
    }
    m.el.querySelector('#f-inf').onchange = recalc;
    m.el.querySelector('#f-int').onchange = recalc;
    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var data = {
        project_id:   pid,
        name:         m.el.querySelector('#f-name').value.trim(),
        organization: m.el.querySelector('#f-org').value.trim(),
        role_title:   m.el.querySelector('#f-role').value.trim(),
        category:     m.el.querySelector('#f-cat').value,
        influence:    m.el.querySelector('#f-inf').value || null,
        interest:     m.el.querySelector('#f-int').value || null,
        contact:      m.el.querySelector('#f-contact').value.trim(),
        engagement:   m.el.querySelector('#f-eng').value.trim(),
        updated_at:   new Date().toISOString(),
      };
      if (!data.name) { UI.toast('Name is required', 'warn'); return; }
      try {
        if (isNew) {
          data.created_by = profile.id;        // REQUIRED for RLS
          var ins = await sb().from(TABLE).insert(data);
          if (ins.error) throw ins.error;
        } else {
          var upd = await sb().from(TABLE).update(data).eq('id', r.id);
          if (upd.error) throw upd.error;
        }
        UI.toast('Saved', 'ok'); m.close(); load();
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  }

  async function del(id) {
    if (!confirm('Delete this stakeholder? This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
