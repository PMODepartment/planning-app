// ============================================================================
// Stakeholder Map — Megawide corporate-BD methodology (project-scoped)
// ----------------------------------------------------------------------------
// Faithful to "CORP. BD TCD. Stakeholder Map 2026.xlsx" (BD/TCD Map + Analysis
// Guide). Each stakeholder carries identity + contact + two rated analyses:
//
//   1) Impact (1-4) × Interest (1-4)  ->  Importance rank (1st..4th)
//                                     ->  Engagement Approach
//   2) Current & Target Relationship (1-4) -> gap -> Engagement Strategy
//                                                  -> Minimum Engagement Frequency
//
// Both chains are DERIVED IN-APP and NEVER STORED — they are pure functions of
// the stored ratings, so persisting them would only let them drift. Formulas
// transcribed verbatim from the workbook (the LIVE cell formulas, which differ
// from the stale Guide sheet on frequency — see freqOf()).
//
// DB reuse (see 2026-07-20-stakeholder-map-full.sql): category=Sector,
// organization=Institution, role_title=Position, influence=Impact,
// interest=Interest, engagement=notes.
// ============================================================================

window.StakeholderMap = (function () {
  var TABLE = 'stakeholder_map';
  var profile = null;
  var pid = null;
  var rows = [];
  var filters = { sector: '', group: '', importance: '', search: '', cell: null };

  var SECTORS = ['Government','Private'];
  var GROUPS  = ['LGU','NGA','GOCC','National','Legislative','State University',
                 'Partners','Consultants','External Stakeholders','Other'];

  function sb() { return AppAuth.getSB(); }
  function n(v) { var x = parseInt(v, 10); return (x >= 1 && x <= 4) ? x : null; }

  // ---- Chain 1: Impact × Interest → Importance → Approach -----------------
  // Grid transcribed from the Guide "Table 3 – IMPACT-INTEREST GRID".
  // IMP_GRID[impact][interest] = rank.
  var IMP_GRID = {
    4: { 1:'3rd', 2:'2nd', 3:'1st', 4:'1st' },
    3: { 1:'3rd', 2:'3rd', 3:'2nd', 4:'1st' },
    2: { 1:'4th', 2:'3rd', 3:'3rd', 4:'2nd' },
    1: { 1:'4th', 2:'4th', 3:'3rd', 4:'3rd' }
  };
  function importanceOf(impact, interest) {
    var p = n(impact), i = n(interest);
    if (!p || !i) return '';
    return IMP_GRID[p][i];
  }
  function approachOf(rank) {
    return { '1st':'Manage Closely', '2nd':'Keep Satisfied',
             '3rd':'Keep Informed', '4th':'Monitor (Minimum Effort)' }[rank] || '';
  }
  function rankClass(rank) {
    return { '1st':'sm-imp-1', '2nd':'sm-imp-2', '3rd':'sm-imp-3', '4th':'sm-imp-4' }[rank] || '';
  }

  // ---- Chain 2: relationship gap → Strategy → Frequency -------------------
  function gapOf(cur, tgt) {
    var c = n(cur), t = n(tgt);
    if (c == null || t == null) return null;
    return t - c;
  }
  function strategyOf(gap) {
    if (gap == null) return '';
    if (gap >= 2) return 'Catch up';   // workbook: gap 2 and 3 both "Catch up"
    if (gap === 1) return 'Enhance';
    if (gap === 0) return 'Maintain';
    return 'N/A';                        // negative gap (target below current)
  }
  // LIVE workbook formula (column S). NB: the Guide sheet disagrees (says
  // Maintain=Semi-annually / Enhance=Quarterly) — the data follows this formula,
  // so this is the source of truth. Documented in the module CLAUDE.md.
  function freqOf(strategy) {
    return { 'Catch up':'Monthly', 'Enhance':'Every two months',
             'Maintain':'Quarterly' }[strategy] || '';
  }

  // ========================================================================
  async function init(user, prof) {
    profile = prof;
    await loadProjects();

    document.getElementById('sm-add').onclick = function () { openForm(null); };
    document.getElementById('sm-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid); load();
    };
    ['sm-f-sector','sm-f-group','sm-f-importance','sm-f-search'].forEach(function (id) {
      var el = document.getElementById(id);
      el.oninput = el.onchange = function () {
        filters.sector     = document.getElementById('sm-f-sector').value;
        filters.group      = document.getElementById('sm-f-group').value;
        filters.importance = document.getElementById('sm-f-importance').value;
        filters.search     = document.getElementById('sm-f-search').value.toLowerCase().trim();
        render();
      };
    });
    document.getElementById('sm-clear').onclick = function () {
      filters = { sector: '', group: '', importance: '', search: '', cell: null };
      ['sm-f-sector','sm-f-group','sm-f-importance','sm-f-search'].forEach(function (id){ document.getElementById(id).value = ''; });
      render();
    };
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
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);
    if (!projects.length) {
      document.getElementById('sm-table').innerHTML =
        '<tr><td style="padding:24px;color:var(--pd-muted);">No projects yet. Ask an admin to create one.</td></tr>';
    }
  }

  async function load() {
    if (!pid) return;
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid).order('name', { ascending: true, nullsFirst: false });
    if (res.error) {
      var msg = /column .* does not exist|schema cache/i.test(res.error.message || '')
        ? 'Run the migration 2026-07-20-stakeholder-map-full.sql first.' : res.error.message;
      UI.toast(msg, 'error'); return;
    }
    rows = res.data || [];
    // populate the Group filter from data + the canonical list
    var groups = {};
    GROUPS.forEach(function (g){ groups[g] = 1; });
    rows.forEach(function (r){ if (r.stakeholder_group) groups[r.stakeholder_group] = 1; });
    var gsel = document.getElementById('sm-f-group');
    gsel.innerHTML = '<option value="">All groups</option>' +
      Object.keys(groups).sort().map(function (g){
        return '<option' + (filters.group === g ? ' selected' : '') + '>' + Fmt.esc(g) + '</option>';
      }).join('');
    render();
  }

  // ---- filtering ----
  function filtered() {
    return rows.filter(function (r) {
      if (filters.sector && r.category !== filters.sector) return false;
      if (filters.group && r.stakeholder_group !== filters.group) return false;
      if (filters.importance && importanceOf(r.influence, r.interest) !== filters.importance) return false;
      if (filters.cell && (n(r.influence) !== filters.cell.p || n(r.interest) !== filters.cell.i)) return false;
      if (filters.search) {
        var hay = [r.name, r.nickname, r.organization, r.role_title, r.title, r.category,
                   r.stakeholder_group, r.email, r.contact, r.primary_responsible, r.engagement]
          .join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }
  function anyFilter() {
    return !!(filters.sector || filters.group || filters.importance || filters.search || filters.cell);
  }

  function render() {
    renderKpis();
    renderTable();
    renderGrid();
    document.getElementById('sm-clear').classList.toggle('show', anyFilter());
  }

  function renderKpis() {
    var manage = 0, satisfy = 0, catchup = 0;
    rows.forEach(function (r) {
      var imp = importanceOf(r.influence, r.interest);
      if (imp === '1st') manage++;
      if (imp === '2nd') satisfy++;
      if (strategyOf(gapOf(r.current_rel, r.target_rel)) === 'Catch up') catchup++;
    });
    document.getElementById('sm-kpis').innerHTML =
      kpi('Stakeholders', rows.length, '') +
      kpi('Manage Closely', manage, 'sm-manage') +
      kpi('Keep Satisfied', satisfy, 'sm-satisfy') +
      kpi('Catch-up needed', catchup, 'sm-catchup');
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
      '<th>Name</th><th>Sector</th><th>Group</th><th>Institution</th><th>Position</th>' +
      '<th>Imp</th><th>Int</th><th>Importance</th><th>Approach</th>' +
      '<th>Rel (C→T)</th><th>Strategy</th><th>Frequency</th><th>Responsible</th><th></th>' +
      '</tr></thead>';
    var body = data.map(function (r) {
      var imp = importanceOf(r.influence, r.interest);
      var strat = strategyOf(gapOf(r.current_rel, r.target_rel));
      var relTxt = (n(r.current_rel) || '—') + ' → ' + (n(r.target_rel) || '—');
      // data-l = the column heading. Unused on desktop (the <thead> supplies it);
      // below 700px module.css hides the head and stacks each row into a card,
      // where every value needs its own inline label (.sm-table td::before).
      return '<tr>' +
        '<td class="sm-c-name"><strong>' + Fmt.esc(r.name) + '</strong>' +
          (r.nickname ? ' <span class="sm-nick">“' + Fmt.esc(r.nickname) + '”</span>' : '') +
          (r.engagement ? '<div class="sm-sub">' + Fmt.esc(r.engagement) + '</div>' : '') + '</td>' +
        '<td data-l="Sector">' + (r.category ? '<span class="sm-cat">' + Fmt.esc(r.category) + '</span>' : '') + '</td>' +
        '<td data-l="Group">' + Fmt.esc(r.stakeholder_group) + '</td>' +
        '<td data-l="Institution">' + Fmt.esc(r.organization) + '</td>' +
        '<td data-l="Position">' + Fmt.esc(r.role_title) + '</td>' +
        '<td class="sm-num" data-l="Impact">' + (n(r.influence) || '—') + '</td>' +
        '<td class="sm-num" data-l="Interest">' + (n(r.interest) || '—') + '</td>' +
        '<td data-l="Importance">' + (imp ? '<span class="sm-pill ' + rankClass(imp) + '">' + imp + '</span>' : '—') + '</td>' +
        '<td data-l="Approach">' + Fmt.esc(approachOf(imp)) + '</td>' +
        '<td class="sm-num" data-l="Rel (C→T)">' + relTxt + '</td>' +
        '<td data-l="Strategy">' + (strat && strat !== 'N/A' ? '<span class="sm-strat sm-s-' + strat.replace(/\s/g,'') + '">' + Fmt.esc(strat) + '</span>' : Fmt.esc(strat)) + '</td>' +
        '<td data-l="Frequency">' + Fmt.esc(freqOf(strat)) + '</td>' +
        '<td data-l="Responsible">' + Fmt.esc(r.primary_responsible) + '</td>' +
        '<td class="sm-rowacts" style="white-space:nowrap;">' +
          '<button class="pd-btn" data-edit="' + r.id + '">Edit</button> ' +
          '<button class="pd-btn" data-del="' + r.id + '">Delete</button></td>' +
      '</tr>';
    }).join('');
    t.innerHTML = head + '<tbody>' + (body ||
      '<tr><td colspan="14" style="padding:24px;color:var(--pd-muted);">No stakeholders match the current filters.</td></tr>') + '</tbody>';

    t.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openForm(rows.find(function (x){ return x.id === b.dataset.edit; })); };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.dataset.del); };
    });
  }

  // ---- 4×4 Impact × Interest grid ---------------------------------------
  // Rows = Impact (4 at top → 1 at bottom); columns = Interest (1 → 4),
  // matching the Guide's "Table 3" orientation. Cells colored by importance rank.
  function renderGrid() {
    var buckets = {};
    rows.forEach(function (r) {
      var p = n(r.influence), i = n(r.interest);
      if (p && i) (buckets[p + '|' + i] = buckets[p + '|' + i] || []).push(r);
    });
    var html = '<table class="sm-grid"><tbody>';
    for (var p = 4; p >= 1; p--) {
      html += '<tr>';
      if (p === 4) html += '<th class="sm-axis sm-axis-y" rowspan="4">Impact →</th>';
      html += '<th class="sm-axis">' + p + '</th>';
      for (var i = 1; i <= 4; i++) {
        var rank = IMP_GRID[p][i];
        var list = buckets[p + '|' + i] || [];
        var active = filters.cell && filters.cell.p === p && filters.cell.i === i;
        var chips = list.slice(0, 3).map(function (r) {
          return '<div class="sm-gchip" title="' + Fmt.esc(r.name) + '">' + Fmt.esc(r.name) + '</div>';
        }).join('');
        if (list.length > 3) chips += '<div class="sm-gchip sm-more">+' + (list.length - 3) + ' more</div>';
        html += '<td class="sm-gcell ' + rankClass(rank) + (active ? ' sm-cell-active' : '') +
          '" data-p="' + p + '" data-i="' + i + '" title="' + rank + ' · ' + approachOf(rank) + ' — Impact ' + p + ' × Interest ' + i + '">' +
          '<span class="sm-gcell-strat">' + rank + ' · ' + approachOf(rank) + '</span>' +
          (list.length ? '<span class="sm-gcell-count">' + list.length + '</span>' : '') +
          (list.length ? '<div class="sm-gchips">' + chips + '</div>' : '<div class="sm-grid-empty">—</div>') +
          '</td>';
      }
      html += '</tr>';
    }
    html += '<tr><th></th><th></th>';
    for (var x = 1; x <= 4; x++) html += '<th class="sm-axis">' + x + '</th>';
    html += '</tr>';
    html += '<tr><th></th><th></th><th class="sm-axis" colspan="4">Interest →</th></tr>';
    html += '</tbody></table>';

    var wrap = document.getElementById('sm-grid');
    wrap.innerHTML = html;
    wrap.querySelectorAll('.sm-gcell').forEach(function (cell) {
      cell.onclick = function () {
        var p = +cell.dataset.p, i = +cell.dataset.i;
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
    // 1-4 rating select with the Guide's descriptors as option text.
    function rate(val, labels) {
      var s = '<option value="">—</option>';
      for (var k = 4; k >= 1; k--) s += '<option value="' + k + '"' + (n(val) === k ? ' selected' : '') + '>' + k + ' — ' + labels[k] + '</option>';
      return s;
    }
    var IMPACT_L   = {4:'Grave / direct effect',3:'Significant impact',2:'Moderate / limited',1:'Little impact'};
    var INTEREST_L = {4:'Constant scrutiny',3:'Frequent',2:'Occasional',1:'Seldom'};
    var REL_L      = {4:'Good friend',3:'Acquaintance',2:'Formal only',1:'No relationship'};

    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Add stakeholder' : 'Edit stakeholder') + '</h2>' +

      '<div class="sm-form-sec">Identity</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:2;"><label>Name</label><input class="pd-input" id="f-name" value="' + Fmt.esc(r.name) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Nickname</label><input class="pd-input" id="f-nick" value="' + Fmt.esc(r.nickname) + '"></div>' +
      '</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Sector</label><select class="pd-select" id="f-sector"><option value="">—</option>' + opts(SECTORS, r.category) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Group</label><select class="pd-select" id="f-group"><option value="">—</option>' + opts(GROUPS, r.stakeholder_group) + '</select></div>' +
        '<div class="pd-field" style="flex:0 0 110px;"><label>Gift Tier</label><input class="pd-input" id="f-gift" value="' + Fmt.esc(r.gift_tier) + '"></div>' +
      '</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:2;"><label>Institution</label><input class="pd-input" id="f-org" value="' + Fmt.esc(r.organization) + '" placeholder="agency / company"></div>' +
        '<div class="pd-field" style="flex:2;"><label>Position</label><input class="pd-input" id="f-role" value="' + Fmt.esc(r.role_title) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Title</label><input class="pd-input" id="f-title" value="' + Fmt.esc(r.title) + '"></div>' +
      '</div>' +

      '<div class="sm-form-sec">Contact</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Email</label><input class="pd-input" id="f-email" value="' + Fmt.esc(r.email) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Contact no.</label><input class="pd-input" id="f-contact" value="' + Fmt.esc(r.contact) + '"></div>' +
        '<div class="pd-field" style="flex:0 0 150px;"><label>Birthday</label><input class="pd-input" type="date" id="f-bday" value="' + (r.birthday || '') + '"></div>' +
      '</div>' +

      '<div class="sm-form-sec">Analysis — Impact × Interest' +
        ' <span class="sm-derived" id="f-imp-out">' + Fmt.esc(derivedAnalysisText(r.influence, r.interest)) + '</span></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Impact (1–4)</label><select class="pd-select" id="f-impact">' + rate(r.influence, IMPACT_L) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Interest (1–4)</label><select class="pd-select" id="f-interest">' + rate(r.interest, INTEREST_L) + '</select></div>' +
      '</div>' +

      '<div class="sm-form-sec">Relationship — Current → Target' +
        ' <span class="sm-derived" id="f-rel-out">' + Fmt.esc(derivedRelText(r.current_rel, r.target_rel)) + '</span></div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Current (1–4)</label><select class="pd-select" id="f-cur">' + rate(r.current_rel, REL_L) + '</select></div>' +
        '<div class="pd-field" style="flex:1;"><label>Target (1–4)</label><select class="pd-select" id="f-tgt">' + rate(r.target_rel, REL_L) + '</select></div>' +
      '</div>' +

      '<div class="sm-form-sec">Ownership &amp; notes</div>' +
      '<div class="sm-frow">' +
        '<div class="pd-field" style="flex:1;"><label>Primary Responsible</label><input class="pd-input" id="f-prim" value="' + Fmt.esc(r.primary_responsible) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Alternate</label><input class="pd-input" id="f-alt" value="' + Fmt.esc(r.alternate) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Engagement notes</label><textarea class="pd-textarea" id="f-eng" rows="2">' + Fmt.esc(r.engagement) + '</textarea></div>' +

      '<div style="text-align:right;margin-top:6px;"><button class="pd-btn" id="f-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save">Save</button></div>'
    );

    function q(id){ return m.el.querySelector(id); }
    q('#f-impact').onchange = q('#f-interest').onchange = function () {
      q('#f-imp-out').textContent = derivedAnalysisText(q('#f-impact').value, q('#f-interest').value);
    };
    q('#f-cur').onchange = q('#f-tgt').onchange = function () {
      q('#f-rel-out').textContent = derivedRelText(q('#f-cur').value, q('#f-tgt').value);
    };
    q('#f-cancel').onclick = m.close;
    q('#f-save').onclick = async function () {
      var data = {
        project_id:          pid,
        name:                q('#f-name').value.trim(),
        nickname:            q('#f-nick').value.trim(),
        category:            q('#f-sector').value,           // Sector
        stakeholder_group:   q('#f-group').value,            // Group
        gift_tier:           q('#f-gift').value.trim(),
        organization:        q('#f-org').value.trim(),       // Institution
        role_title:          q('#f-role').value.trim(),      // Position
        title:               q('#f-title').value.trim(),
        email:               q('#f-email').value.trim(),
        contact:             q('#f-contact').value.trim(),
        birthday:            q('#f-bday').value || null,
        influence:           q('#f-impact').value || null,   // Impact 1-4 (text)
        interest:            q('#f-interest').value || null,  // Interest 1-4 (text)
        current_rel:         n(q('#f-cur').value),
        target_rel:          n(q('#f-tgt').value),
        primary_responsible: q('#f-prim').value.trim(),
        alternate:           q('#f-alt').value.trim(),
        engagement:          q('#f-eng').value.trim(),
        updated_at:          new Date().toISOString(),
      };
      if (!data.name) { UI.toast('Name is required', 'warn'); return; }
      try {
        if (isNew) {
          data.created_by = profile.id;
          var ins = await sb().from(TABLE).insert(data);
          if (ins.error) throw ins.error;
        } else {
          var upd = await sb().from(TABLE).update(data).eq('id', r.id);
          if (upd.error) throw upd.error;
        }
        UI.toast('Saved', 'ok'); m.close(); load();
      } catch (e) {
        var msg = /column .* does not exist|schema cache/i.test(e.message || '')
          ? 'Run the migration 2026-07-20-stakeholder-map-full.sql first.' : e.message;
        UI.toast(msg, 'error');
      }
    };
  }

  function derivedAnalysisText(impact, interest) {
    var imp = importanceOf(impact, interest);
    return imp ? (imp + ' · ' + approachOf(imp)) : 'set both to derive';
  }
  function derivedRelText(cur, tgt) {
    var gap = gapOf(cur, tgt);
    if (gap == null) return 'set both to derive';
    var s = strategyOf(gap);
    return 'gap ' + gap + ' · ' + s + (freqOf(s) ? ' · ' + freqOf(s) : '');
  }

  async function del(id) {
    if (!confirm('Delete this stakeholder? This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
