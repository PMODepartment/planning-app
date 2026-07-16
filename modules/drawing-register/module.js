// ============================================================================
// Drawing Register & Tracker — full-fidelity module
// ----------------------------------------------------------------------------
// Mirrors the Megawide "Drawing Register & Tracker" workbook (GPR101. TEC.):
//   • Structured drawing code built from the Coding Reference tables
//     <proj>-<building>-<company>-<type>-<discipline>-<floor>-<number>-<rev>
//   • Phase → discipline grouping with progress roll-ups
//   • Multi-revision submission tracking (planned/actual per revision)
//   • Approval status + planned/actual approval dates
//   • Sheet counts + approved % ; progress dashboard
//   • Excel import of the workbook's flat "Dwg Registry" layout (SheetJS)
//   • Optional file upload to the private `drawing-register` storage bucket
// ============================================================================

window.DrawingRegister = (function () {
  var TABLE  = 'drawing_register';
  var BUCKET = 'drawing-register';
  var profile = null, uid = null, pid = null, projName = '';
  var rows = [];
  var view = 'register';                       // register | progress
  var filters = { phase: '', discipline: '', status: '', search: '' };
  var selected = {};                           // id -> true (bulk select)
  var collapsed = {};                          // group key -> true (collapsed)
  var canWrite = false;                        // planner+ / admin / super_admin

  // ---- Coding Reference (from the workbook "Coding Reference" sheet) --------
  var BUILDINGS = ['GEN','TW1','TW2','TW3','TW4','TW5','TW6','TW7','TW8','TW9'];
  var COMPANIES = ['MCC'];
  var TYPES = {
    DRC:'Drawing Review Checklist', ECD:'Engineering Concept Design',
    SD1:'Schematic Design 1', SD2:'Schematic Design 2',
    FCD:'For Construction Drawing', CSD:'Combined Services Model',
    ISD:'Individual Services Drawings'
  };
  var DISCIPLINES = {
    AR:'Architectural', ST:'Structural', CV:'Civil', EL:'Electrical',
    AU:'Auxiliary', PL:'Plumbing', ME:'Mechanical', FP:'Fire Protection',
    SD:'Site Development', LA:'Landscape'
  };
  var FLOORS = ['GEN','FD','GF','2F','3F','4F','5F','6F','7F','8F','9F','10F',
                '11F','12F','13F','14F','15F','RDF','RORD'];
  // Design phases, in workbook order
  var PHASES = ['Concept Design','Schematic Design 1','Schematic Design 2',
                'For Construction','As-Built'];
  var STATUSES = ['For Review','Revise & Resubmit','Approved w/ comments',
                  'Approved w/o comments','Approved','Superseded'];

  function sb() { return AppAuth.getSB(); }
  function num(v){ v = parseFloat(v); return isFinite(v) ? v : 0; }
  function disciplineName(code){ return DISCIPLINES[code] || code || ''; }

  // ---------------------------------------------------------------- init -----
  async function init(user, prof) {
    profile = prof; uid = (user && user.id) || (prof && prof.id);
    var role = (prof && prof.role) || window.__role || '';
    canWrite = ['super_admin','admin','planner'].indexOf(role) !== -1;
    await loadProjects();

    document.getElementById('dr-add').onclick = function () { openForm(null); };
    document.getElementById('dr-import').onclick = function () { openImport(); };
    document.getElementById('dr-export').onclick = function () { exportExcel(); };
    var clearBtn = document.getElementById('dr-clear');
    if (clearBtn) { clearBtn.style.display = canWrite ? '' : 'none'; clearBtn.onclick = clearAll; }
    document.getElementById('dr-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid);
      var p = e.target.selectedOptions[0]; projName = p ? p.textContent : '';
      load();
    };
    document.querySelectorAll('.dr-tab').forEach(function (b) {
      b.onclick = function () {
        view = b.dataset.view;
        document.querySelectorAll('.dr-tab').forEach(function (x){ x.classList.toggle('active', x===b); });
        render();
      };
    });
    ['dr-f-phase','dr-f-discipline','dr-f-status','dr-f-search'].forEach(function (id) {
      var el = document.getElementById(id);
      el.oninput = el.onchange = function () {
        filters.phase      = document.getElementById('dr-f-phase').value;
        filters.discipline = document.getElementById('dr-f-discipline').value;
        filters.status     = document.getElementById('dr-f-status').value;
        filters.search     = document.getElementById('dr-f-search').value.toLowerCase().trim();
        render();
      };
    });
    if (pid) load();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = document.getElementById('dr-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>';
      }).join('');
    var cur = projects.find(function (p){ return p.id === pid; });
    projName = cur ? cur.name : '';
  }

  async function load() {
    if (!pid) { rows = []; render(); return; }
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid)
      .order('sort_order', { ascending: true })
      .order('drawing_no', { ascending: true });
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows = res.data || [];
    selected = {};
    render();
  }

  // ---------------------------------------------------------- derivations ----
  function composeCode(r) {
    var parts = [r.proj_code, r.building_ref, r.company, r.drawing_type,
                 r.discipline_code || r.discipline, r.floor_level,
                 r.dwg_number, r.revision];
    parts = parts.filter(function (x){ return x != null && String(x).trim() !== ''; });
    return parts.join('-');
  }
  function pctApproved(r) {
    var tot = num(r.no_of_sheets) || 0, ap = num(r.approved_sheets) || 0;
    if (r.approved_pct != null && r.approved_pct !== '') return num(r.approved_pct);
    return tot ? ap / tot : 0;
  }
  function isApprovedStatus(s) {
    return s === 'Approved' || s === 'Approved w/o comments' || s === 'Approved w/ comments';
  }
  function latestSub(r, which) {
    var subs = Array.isArray(r.submissions) ? r.submissions : [];
    for (var i = subs.length - 1; i >= 0; i--) {
      if (subs[i] && subs[i][which]) return subs[i][which];
    }
    return which === 'actual' ? r.issue_date : (r.due_date || null);
  }

  function filtered() {
    return rows.filter(function (r) {
      if (filters.phase && r.phase !== filters.phase) return false;
      if (filters.discipline &&
          r.discipline !== filters.discipline &&
          disciplineName(r.discipline) !== filters.discipline) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.search) {
        var hay = [r.drawing_no, r.drawing_code, r.title, r.description, r.discipline,
                   r.category, r.phase, r.responsible, r.revision, r.remarks].join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------- rendering ---
  function statusCls(s) {
    if (s === 'Approved' || s === 'Approved w/o comments') return 'dr-ok';
    if (s === 'Approved w/ comments') return 'dr-okc';
    if (s === 'Revise & Resubmit') return 'dr-rr';
    if (s === 'Superseded') return 'dr-old';
    return 'dr-review';
  }

  function render() {
    populateFilterSelects();
    if (view === 'progress') return renderProgress();
    renderRegister();
  }

  function populateFilterSelects() {
    var ph = document.getElementById('dr-f-phase');
    var phSet = {}; rows.forEach(function (r){ if (r.phase) phSet[r.phase]=1; });
    var phList = PHASES.filter(function (p){ return phSet[p]; })
      .concat(Object.keys(phSet).filter(function (p){ return PHASES.indexOf(p)===-1; }));
    ph.innerHTML = '<option value="">All phases</option>' + phList.map(function (p){
      return '<option'+(filters.phase===p?' selected':'')+'>'+Fmt.esc(p)+'</option>'; }).join('');

    var dc = document.getElementById('dr-f-discipline');
    var dSet = {}; rows.forEach(function (r){ if (r.discipline) dSet[r.discipline]=1; });
    var dList = Object.keys(dSet).sort();
    dc.innerHTML = '<option value="">All disciplines</option>' + dList.map(function (d){
      return '<option'+(filters.discipline===d?' selected':'')+'>'+Fmt.esc(d)+'</option>'; }).join('');
  }

  function phaseRank(p){ var i = PHASES.indexOf(p); return i === -1 ? 99 : i; }

  function renderRegister() {
    var host = document.getElementById('dr-view');
    if (!rows.length) {
      host.innerHTML = emptyMsg('No drawings yet for this project. Click “Add drawing” or “Import Excel”.');
      return;
    }
    var data = filtered();

    // group by phase → discipline
    var groups = {}, phaseOrder = [];
    data.forEach(function (r) {
      var ph = r.phase || 'Ungrouped', d = r.discipline || '—';
      if (!groups[ph]) { groups[ph] = {}; phaseOrder.push(ph); }
      (groups[ph][d] = groups[ph][d] || []).push(r);
    });
    phaseOrder.sort(function (a, b) { return phaseRank(a) - phaseRank(b) || a.localeCompare(b); });

    var CB = canWrite;
    var toolbar = '<div class="dr-listbar">' +
      '<div class="dr-listcount">Showing <strong>'+data.length+'</strong> of '+rows.length+' drawings</div>' +
      '<div class="dr-selbar" id="dr-selbar" hidden>' +
        '<span id="dr-selcount"></span>' +
        '<button class="pd-btn pd-btn-sm" id="dr-selclear">Clear</button>' +
        '<button class="pd-btn pd-btn-sm pd-btn-danger" id="dr-seldel">Delete selected</button>' +
      '</div></div>';

    if (!data.length) { host.innerHTML = toolbar + emptyMsg('No drawings match the filters.'); return; }

    var head = '<tr>' +
      (CB ? '<th class="dr-cb"><input type="checkbox" id="dr-selall" title="Select all shown"></th>' : '') +
      '<th>Drawing Code</th><th>Sheet Title / Description</th><th>Disc.</th>' +
      '<th>Cat.</th><th>Rev</th><th>Status</th><th class="dr-r">Sheets</th>' +
      '<th class="dr-r">Appr.</th><th>Latest Sub.</th><th>Approval</th>' +
      '<th>Resp.</th><th>File</th><th class="dr-actcol"></th></tr>';

    var html = toolbar + '<div class="pd-card dr-tablecard">' +
      '<table class="pd-table dr-table"><thead>'+head+'</thead><tbody>';

    phaseOrder.forEach(function (ph) {
      var pr = flat(groups[ph]);
      var pkey = 'P:' + ph;
      html += rollupRow(ph, pr, 'phase', CB, pkey);
      if (collapsed[pkey]) return;
      Object.keys(groups[ph]).sort().forEach(function (d) {
        var dr = groups[ph][d];
        var dkey = 'D:' + ph + '|' + d;
        var dlabel = DISCIPLINES[d] ? DISCIPLINES[d] : disciplineName(d);
        html += rollupRow(dlabel + (DISCIPLINES[d]?' ('+d+')':''), dr, 'disc', CB, dkey);
        if (collapsed[dkey]) return;
        dr.forEach(function (r) { html += drawingRow(r, CB); });
      });
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;
    wireRegister(host, data);
  }

  function wireRegister(host, data) {
    // collapse/expand groups — click the label (not the checkbox)
    host.querySelectorAll('tr.dr-grp .dr-grplabel').forEach(function (lab){
      lab.onclick = function(){
        var key = lab.closest('tr.dr-grp').dataset.grp;
        if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
        render();
      };
    });
    host.querySelectorAll('[data-view]').forEach(function (b){ b.onclick=function(){ viewFile(b.dataset.view); }; });
    host.querySelectorAll('[data-edit]').forEach(function (b){ b.onclick=function(){ openForm(rows.find(function(x){return x.id===b.dataset.edit;})); }; });
    host.querySelectorAll('[data-del]').forEach(function (b){ b.onclick=function(){ del(rows.find(function(x){return x.id===b.dataset.del;})); }; });
    if (!canWrite) return;

    host.querySelectorAll('input[data-sel]').forEach(function (cb){
      cb.onchange = function(){ if (cb.checked) selected[cb.dataset.sel]=true; else delete selected[cb.dataset.sel]; refreshSel(host, data); };
    });
    host.querySelectorAll('input[data-selgrp]').forEach(function (cb){
      cb.onchange = function(){
        cb.dataset.selgrp.split(',').forEach(function (id){ if(!id) return; if (cb.checked) selected[id]=true; else delete selected[id]; });
        refreshSel(host, data);
      };
    });
    var all = host.querySelector('#dr-selall');
    if (all) all.onchange = function(){ data.forEach(function (r){ if(all.checked) selected[r.id]=true; else delete selected[r.id]; }); render(); };
    var clr = host.querySelector('#dr-selclear'); if (clr) clr.onclick = function(){ selected={}; render(); };
    var sd  = host.querySelector('#dr-seldel');   if (sd)  sd.onclick  = deleteSelected;
    refreshSel(host, data);
  }

  function refreshSel(host, data) {
    var ids = Object.keys(selected).filter(function (id){ return data.some(function(r){return r.id===id;}); });
    var bar = host.querySelector('#dr-selbar');
    if (bar) { bar.hidden = ids.length===0; host.querySelector('#dr-selcount').textContent = ids.length + ' selected'; }
    var all = host.querySelector('#dr-selall'); if (all) all.checked = data.length>0 && ids.length===data.length;
  }

  function flat(byDisc){ var a=[]; Object.keys(byDisc).forEach(function(k){ a=a.concat(byDisc[k]); }); return a; }

  function rollupRow(label, list, kind, CB, key) {
    var tot=0, ap=0;
    list.forEach(function (r){ tot += num(r.no_of_sheets)||0; ap += num(r.approved_sheets)||0; });
    var pct = tot ? Math.round(ap/tot*100) : 0;
    var ids = list.map(function(r){return r.id;}).join(',');
    var grpCb = CB ? '<td class="dr-cb"><input type="checkbox" data-selgrp="'+ids+'" title="Select group"></td>' : '';
    var isCol = !!collapsed[key];
    var caret = '<span class="dr-caret'+(isCol?' dr-caret-col':'')+'">▾</span>';
    return '<tr class="dr-grp dr-grp-'+kind+(isCol?' dr-collapsed':'')+'" data-grp="'+Fmt.esc(key)+'">' + grpCb +
      '<td colspan="6"><span class="dr-grplabel">'+caret+'<strong>'+Fmt.esc(label)+'</strong> ' +
        '<span class="dr-count">'+list.length+' dwg</span></span></td>' +
      '<td class="dr-r">'+tot+'</td>' +
      '<td class="dr-r">'+ap+'</td>' +
      '<td colspan="4">'+progressBar(pct)+'</td><td></td></tr>';
  }

  function progressBar(pct) {
    return '<div class="dr-prog"><div class="dr-prog-fill" style="width:'+pct+'%;"></div>' +
           '<span class="dr-prog-txt">'+pct+'%</span></div>';
  }

  function drawingRow(r, CB) {
    var code = r.drawing_code || r.drawing_no || '';
    var tot = num(r.no_of_sheets)||0, ap = num(r.approved_sheets)||0;
    var pct = Math.round(pctApproved(r)*100);
    var sub = latestSub(r,'actual') || latestSub(r,'planned');
    var appr = r.actual_approval || r.planned_approval;
    var cb = CB ? '<td class="dr-cb"><input type="checkbox" data-sel="'+r.id+'"'+(selected[r.id]?' checked':'')+'></td>' : '';
    return '<tr'+(selected[r.id]?' class="dr-selrow"':'')+'>' + cb +
      '<td><span class="dr-code">'+Fmt.esc(code)+'</span></td>' +
      '<td>'+Fmt.esc(r.title)+(r.description?'<div class="dr-sub">'+Fmt.esc(r.description)+'</div>':'')+'</td>' +
      '<td>'+Fmt.esc(r.discipline)+'</td>' +
      '<td>'+Fmt.esc(r.category)+'</td>' +
      '<td>'+Fmt.esc(r.revision)+'</td>' +
      '<td><span class="dr-pill '+statusCls(r.status)+'">'+Fmt.esc(r.status||'—')+'</span></td>' +
      '<td class="dr-r">'+tot+'</td>' +
      '<td class="dr-r">'+ap+' <span class="dr-mini">'+pct+'%</span></td>' +
      '<td class="dr-nowrap">'+(sub?Fmt.date(sub):'—')+'</td>' +
      '<td class="dr-nowrap">'+(appr?Fmt.date(appr):'—')+'</td>' +
      '<td>'+Fmt.esc(r.responsible)+'</td>' +
      '<td>'+(r.file_url?'<button class="pd-btn pd-btn-sm" data-view="'+Fmt.esc(r.file_url)+'">View</button>':'<span class="dr-mut">—</span>')+'</td>' +
      '<td class="dr-nowrap"><button class="dr-rowbtn" data-edit="'+r.id+'" title="Edit">Edit</button> ' +
        '<button class="dr-rowbtn dr-rowbtn-del" data-del="'+r.id+'" title="Delete">Del</button></td>' +
    '</tr>';
  }

  function emptyMsg(msg) {
    return '<div class="pd-card dr-empty">'+Fmt.esc(msg)+'</div>';
  }

  // ----------------------------------------------------- progress dashboard --
  function renderProgress() {
    var host = document.getElementById('dr-view');
    if (!rows.length) { host.innerHTML = emptyMsg('No drawings to summarise yet.'); return; }

    var totSheets=0, subSheets=0, apSheets=0;
    rows.forEach(function (r){
      var t=num(r.no_of_sheets)||0, a=num(r.approved_sheets)||0;
      totSheets+=t; apSheets+=a;
      if (latestSub(r,'actual')) subSheets+=t;
    });
    var balance = totSheets - apSheets;

    var kpis = '<div class="dr-kpis">' +
      kpi(rows.length, 'Drawings') +
      kpi(totSheets, 'Total sheets') +
      kpi(subSheets, 'Submitted') +
      kpi(apSheets, 'Approved') +
      kpi((totSheets?Math.round(apSheets/totSheets*100):0)+'%', 'Approved %', 'ok') +
      kpi(balance, 'Balance', balance>0?'warn':'') +
    '</div>';

    // by phase
    var byPhase = groupAgg('phase');
    var byDisc  = groupAgg('discipline');
    var host2 = '<div class="dr-dash-grid">' +
      progTable('Progress by Phase', byPhase, PHASES) +
      progTable('Progress by Discipline', byDisc, Object.keys(DISCIPLINES).map(disciplineName)) +
    '</div>';

    host.innerHTML = kpis + host2;
  }

  function groupAgg(key) {
    var m = {};
    rows.forEach(function (r) {
      var k = r[key] || '—';
      var g = m[k] || (m[k]={label:k, dwg:0, sheets:0, submitted:0, approved:0});
      var t=num(r.no_of_sheets)||0, a=num(r.approved_sheets)||0;
      g.dwg++; g.sheets+=t; g.approved+=a;
      if (latestSub(r,'actual')) g.submitted+=t;
    });
    return m;
  }

  function progTable(title, m, order) {
    var keys = Object.keys(m).sort(function (a,b){
      var ia=order.indexOf(a), ib=order.indexOf(b);
      if (ia===-1) ia=99; if (ib===-1) ib=99; return ia-ib || a.localeCompare(b);
    });
    var body = keys.map(function (k){
      var g=m[k]; var bal=g.sheets-g.approved;
      var pct=g.sheets?Math.round(g.approved/g.sheets*100):0;
      return '<tr><td>'+Fmt.esc(g.label)+'</td>' +
        '<td class="dr-r">'+g.dwg+'</td><td class="dr-r">'+g.sheets+'</td>' +
        '<td class="dr-r">'+g.submitted+'</td><td class="dr-r">'+g.approved+'</td>' +
        '<td class="dr-r">'+bal+'</td><td style="min-width:120px;">'+progressBar(pct)+'</td></tr>';
    }).join('') || '<tr><td colspan="7" class="dr-mut">No data</td></tr>';
    return '<div class="pd-card"><h3 class="dr-h3">'+title+'</h3>' +
      '<table class="pd-table dr-table"><thead><tr><th>Group</th>' +
      '<th class="dr-r">Dwg</th><th class="dr-r">Sheets</th><th class="dr-r">Sub.</th>' +
      '<th class="dr-r">Appr.</th><th class="dr-r">Bal.</th><th>Approved %</th></tr></thead>' +
      '<tbody>'+body+'</tbody></table></div>';
  }

  function kpi(val, label, cls) {
    return '<div class="dr-kpi '+(cls?'dr-'+cls:'')+'"><div class="dr-kpi-val">'+val+'</div>' +
           '<div class="dr-kpi-label">'+label+'</div></div>';
  }

  // ------------------------------------------------------------ file view ----
  async function viewFile(path) {
    var res = await sb().storage.from(BUCKET).createSignedUrl(path, 60);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    window.open(res.data.signedUrl, '_blank');
  }
  async function uploadFile(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/' + Date.now() + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert:false });
    if (res.error) throw res.error;
    return path;
  }

  // --------------------------------------------------------- add/edit form ---
  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    var subs = Array.isArray(r.submissions) ? r.submissions.slice() : [];
    if (!subs.length) subs = [{ rev:0, planned:'', actual:'' }];

    function opt(list, val, blank){
      return (blank?'<option value="">—</option>':'') + list.map(function (o){
        return '<option'+(val===o?' selected':'')+'>'+o+'</option>'; }).join('');
    }
    function optMap(map, val){
      return '<option value="">—</option>' + Object.keys(map).map(function (k){
        return '<option value="'+k+'"'+(val===k?' selected':'')+'>'+k+' — '+Fmt.esc(map[k])+'</option>'; }).join('');
    }

    var m = UI.modal(
      '<h2 style="margin-top:0;">'+(isNew?'Add drawing':'Edit drawing')+'</h2>' +
      '<div class="dr-form-sec">Drawing code</div>' +
      '<div class="dr-grid4">' +
        field('Project code','<input class="pd-input" id="f-proj" value="'+Fmt.esc(r.proj_code||projCodeGuess())+'">') +
        field('Building ref','<select class="pd-select" id="f-bld">'+opt(BUILDINGS, r.building_ref, true)+'</select>') +
        field('Company','<select class="pd-select" id="f-co">'+opt(COMPANIES, r.company||'MCC', true)+'</select>') +
        field('Drawing type','<select class="pd-select" id="f-type">'+optMap(TYPES, r.drawing_type)+'</select>') +
      '</div>' +
      '<div class="dr-grid4">' +
        field('Discipline','<select class="pd-select" id="f-disc">'+optMap(DISCIPLINES, r.discipline_code||discCodeOf(r.discipline))+'</select>') +
        field('Floor level','<select class="pd-select" id="f-floor">'+opt(FLOORS, r.floor_level, true)+'</select>') +
        field('Drawing no.','<input class="pd-input" id="f-num" value="'+Fmt.esc(r.dwg_number)+'" placeholder="A-101 / 4750">') +
        field('Revision','<input class="pd-input" id="f-rev" value="'+Fmt.esc(r.revision)+'" placeholder="00">') +
      '</div>' +
      '<div class="dr-code-preview">Code: <span id="f-codeprev"></span></div>' +

      '<div class="dr-form-sec">Sheet</div>' +
      '<div class="dr-grid2">' +
        field('Phase','<select class="pd-select" id="f-phase">'+opt(PHASES, r.phase, true)+'</select>') +
        field('Category','<input class="pd-input" id="f-cat" value="'+Fmt.esc(r.category)+'" placeholder="Floor Plan">') +
      '</div>' +
      field('Sheet title','<input class="pd-input" id="f-title" value="'+Fmt.esc(r.title)+'">') +
      field('Description','<textarea class="pd-textarea" id="f-desc" rows="2">'+Fmt.esc(r.description)+'</textarea>') +
      '<div class="dr-grid3">' +
        field('No. of sheets','<input class="pd-input" type="number" min="0" id="f-sheets" value="'+(r.no_of_sheets!=null?r.no_of_sheets:1)+'">') +
        field('Approved sheets','<input class="pd-input" type="number" min="0" id="f-apsheets" value="'+(r.approved_sheets!=null?r.approved_sheets:0)+'">') +
        field('Responsible','<input class="pd-input" id="f-resp" value="'+Fmt.esc(r.responsible)+'" placeholder="ECTA / In-House">') +
      '</div>' +

      '<div class="dr-form-sec">Submissions <button class="pd-btn pd-btn-sm" id="f-addsub" type="button">+ revision</button></div>' +
      '<div id="f-subs"></div>' +

      '<div class="dr-form-sec">Approval</div>' +
      '<div class="dr-grid3">' +
        field('Status','<select class="pd-select" id="f-status">'+opt(STATUSES, r.status||'For Review', false)+'</select>') +
        field('Planned approval','<input class="pd-input" type="date" id="f-papp" value="'+(r.planned_approval||'')+'">') +
        field('Actual approval','<input class="pd-input" type="date" id="f-aapp" value="'+(r.actual_approval||'')+'">') +
      '</div>' +
      field('Remarks','<textarea class="pd-textarea" id="f-rem" rows="2">'+Fmt.esc(r.remarks)+'</textarea>') +
      field('Drawing file (PDF/DWG/image)'+(r.file_url?' — attached; choosing a new one replaces it':''),
            '<input class="pd-input" type="file" id="f-file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg">') +
      '<div style="text-align:right;margin-top:10px;"><button class="pd-btn" id="f-cancel" type="button">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save" type="button">Save</button></div>',
      { wide:true }
    );

    function renderSubs() {
      var host = m.el.querySelector('#f-subs');
      host.innerHTML = subs.map(function (s, i){
        return '<div class="dr-subrow">' +
          '<span class="dr-subrev">Rev '+(s.rev!=null?s.rev:i)+'</span>' +
          '<label>Planned<input class="pd-input" type="date" data-sub="'+i+'" data-k="planned" value="'+(s.planned||'')+'"></label>' +
          '<label>Actual<input class="pd-input" type="date" data-sub="'+i+'" data-k="actual" value="'+(s.actual||'')+'"></label>' +
          (subs.length>1?'<button class="pd-btn pd-btn-sm" type="button" data-rmsub="'+i+'">✕</button>':'') +
        '</div>';
      }).join('');
      host.querySelectorAll('[data-sub]').forEach(function (el){
        el.onchange = function(){ subs[+el.dataset.sub][el.dataset.k] = el.value || ''; };
      });
      host.querySelectorAll('[data-rmsub]').forEach(function (b){
        b.onclick = function(){ subs.splice(+b.dataset.rmsub,1); renderSubs(); };
      });
    }
    renderSubs();
    m.el.querySelector('#f-addsub').onclick = function(){
      subs.push({ rev: subs.length, planned:'', actual:'' }); renderSubs();
    };

    function refreshCode(){
      m.el.querySelector('#f-codeprev').textContent = composeCode({
        proj_code:m.el.querySelector('#f-proj').value.trim(),
        building_ref:m.el.querySelector('#f-bld').value,
        company:m.el.querySelector('#f-co').value,
        drawing_type:m.el.querySelector('#f-type').value,
        discipline:m.el.querySelector('#f-disc').value,
        floor_level:m.el.querySelector('#f-floor').value,
        dwg_number:m.el.querySelector('#f-num').value.trim(),
        revision:m.el.querySelector('#f-rev').value.trim()
      }) || '—';
    }
    ['f-proj','f-bld','f-co','f-type','f-disc','f-floor','f-num','f-rev'].forEach(function (id){
      var el=m.el.querySelector('#'+id); el.oninput=el.onchange=refreshCode;
    });
    refreshCode();

    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var btn = m.el.querySelector('#f-save');
      var discCode = m.el.querySelector('#f-disc').value;
      subs = subs.filter(function (s){ return s.planned || s.actual; })
                 .map(function (s,i){ return { rev:(s.rev!=null?s.rev:i), planned:s.planned||null, actual:s.actual||null }; });
      var sheets = num(m.el.querySelector('#f-sheets').value);
      var apSheets = num(m.el.querySelector('#f-apsheets').value);
      var data = {
        project_id: pid,
        proj_code:    m.el.querySelector('#f-proj').value.trim(),
        building_ref: m.el.querySelector('#f-bld').value,
        company:      m.el.querySelector('#f-co').value,
        drawing_type: m.el.querySelector('#f-type').value,
        discipline:   discCode ? disciplineName(discCode) : '',
        floor_level:  m.el.querySelector('#f-floor').value,
        dwg_number:   m.el.querySelector('#f-num').value.trim(),
        phase:        m.el.querySelector('#f-phase').value,
        category:     m.el.querySelector('#f-cat').value.trim(),
        title:        m.el.querySelector('#f-title').value.trim(),
        description:  m.el.querySelector('#f-desc').value.trim(),
        no_of_sheets: sheets,
        approved_sheets: apSheets,
        approved_pct: sheets ? apSheets/sheets : 0,
        responsible:  m.el.querySelector('#f-resp').value.trim(),
        revision:     m.el.querySelector('#f-rev').value.trim(),
        submissions:  subs,
        status:       m.el.querySelector('#f-status').value,
        planned_approval: m.el.querySelector('#f-papp').value || null,
        actual_approval:  m.el.querySelector('#f-aapp').value || null,
        remarks:      m.el.querySelector('#f-rem').value.trim(),
        updated_at:   new Date().toISOString()
      };
      // build the composed code with the discipline *code* (not the long name)
      data.drawing_code = composeCode({
        proj_code:data.proj_code, building_ref:data.building_ref, company:data.company,
        drawing_type:data.drawing_type, discipline:discCode, floor_level:data.floor_level,
        dwg_number:data.dwg_number, revision:data.revision
      });
      data.drawing_no = data.drawing_code || data.dwg_number;
      // keep first submission as issue/due for backward-compat filters
      data.issue_date = (subs[0] && subs[0].actual) || null;
      data.due_date   = (subs[0] && subs[0].planned) || null;

      if (!data.title && !data.dwg_number) { UI.toast('Sheet title or drawing no. required', 'warn'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var fileEl = m.el.querySelector('#f-file');
        if (fileEl.files && fileEl.files[0]) { btn.textContent='Uploading…'; data.file_url = await uploadFile(fileEl.files[0]); }
        if (isNew) {
          data.created_by = uid;
          data.sort_order = (rows.length ? Math.max.apply(null, rows.map(function(x){return x.sort_order||0;})) : 0) + 1;
          var ins = await sb().from(TABLE).insert(data); if (ins.error) throw ins.error;
        } else {
          var upd = await sb().from(TABLE).update(data).eq('id', r.id); if (upd.error) throw upd.error;
        }
        UI.toast('Saved', 'ok'); m.close(); load();
      } catch (e) {
        UI.toast(e.message, 'error'); btn.disabled=false; btn.textContent='Save';
      }
    };
  }

  function field(label, ctrl){ return '<div class="pd-field"><label>'+label+'</label>'+ctrl+'</div>'; }
  function projCodeGuess(){ return (pid||'').toUpperCase(); }
  function discCodeOf(name){
    if (!name) return '';
    var k = Object.keys(DISCIPLINES).find(function (c){ return DISCIPLINES[c]===name || c===name; });
    return k || '';
  }

  async function del(r) {
    if (!confirm('Delete drawing "' + (r.drawing_code || r.drawing_no || r.title) + '"?')) return;
    if (r.file_url) { try { await sb().storage.from(BUCKET).remove([r.file_url]); } catch (e) {} }
    var res = await sb().from(TABLE).delete().eq('id', r.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  // ---- Bulk delete the currently selected drawings -------------------------
  async function deleteSelected() {
    var ids = Object.keys(selected);
    if (!ids.length) return;
    if (!confirm('Delete ' + ids.length + ' selected drawing(s)? This cannot be undone.')) return;
    var files = rows.filter(function (r){ return selected[r.id] && r.file_url; }).map(function (r){ return r.file_url; });
    if (files.length) { try { await sb().storage.from(BUCKET).remove(files); } catch (e) {} }
    // delete in chunks to keep the URL length sane
    for (var i=0; i<ids.length; i+=100) {
      var res = await sb().from(TABLE).delete().in('id', ids.slice(i, i+100));
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
    }
    UI.toast('Deleted ' + ids.length + ' drawing(s)', 'ok'); selected = {}; load();
  }

  // ---- Clear ALL drawings for this project (type-to-confirm) ---------------
  function clearAll() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    if (!rows.length) { UI.toast('Nothing to clear', 'warn'); return; }
    var m = UI.modal(
      '<h2 style="margin-top:0;">Clear all drawings</h2>' +
      '<p>This permanently deletes <strong>all ' + rows.length + ' drawings</strong> for ' +
      '<strong>' + Fmt.esc(projName || pid) + '</strong>. Useful when a register was imported to the ' +
      'wrong project. This cannot be undone.</p>' +
      '<p class="dr-mut">Type the project id <code>' + Fmt.esc(pid) + '</code> to confirm:</p>' +
      '<input class="pd-input" id="dr-clr-confirm" placeholder="' + Fmt.esc(pid) + '">' +
      '<div style="text-align:right;margin-top:12px;">' +
        '<button class="pd-btn" id="dr-clr-cancel" type="button">Cancel</button> ' +
        '<button class="pd-btn pd-btn-danger" id="dr-clr-go" type="button" disabled>Delete all</button></div>'
    );
    var inp = m.el.querySelector('#dr-clr-confirm'), go = m.el.querySelector('#dr-clr-go');
    inp.oninput = function(){ go.disabled = inp.value.trim() !== pid; };
    m.el.querySelector('#dr-clr-cancel').onclick = m.close;
    go.onclick = async function(){
      go.disabled = true; go.textContent = 'Deleting…';
      var files = rows.filter(function (r){ return r.file_url; }).map(function (r){ return r.file_url; });
      if (files.length) { try { await sb().storage.from(BUCKET).remove(files); } catch (e) {} }
      var res = await sb().from(TABLE).delete().eq('project_id', pid);
      if (res.error) { UI.toast(res.error.message, 'error'); go.disabled=false; go.textContent='Delete all'; return; }
      UI.toast('All drawings cleared', 'ok'); m.close(); selected = {}; load();
    };
  }

  // =============================================================== IMPORT =====
  function openImport() {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var m = UI.modal(
      '<h2 style="margin-top:0;">Import drawings from Excel</h2>' +
      '<p class="dr-mut">Reads a "Drawing Registry" sheet from the Megawide Drawing Register &amp; Tracker workbook. ' +
      'Phase / discipline / category are inferred from the sheet-title indentation; each sheet row becomes a drawing.</p>' +
      field('Workbook (.xlsx)','<input class="pd-input" type="file" id="dr-imp-file" accept=".xlsx,.xls">') +
      field('<label><input type="checkbox" id="dr-imp-replace"> Replace existing drawings for this project</label>','') +
      '<div id="dr-imp-preview" class="dr-mut" style="margin-top:8px;"></div>' +
      '<div style="text-align:right;margin-top:10px;"><button class="pd-btn" id="dr-imp-cancel" type="button">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="dr-imp-go" type="button" disabled>Import</button></div>',
      { wide:true }
    );
    var parsed = null;
    m.el.querySelector('#dr-imp-cancel').onclick = m.close;
    m.el.querySelector('#dr-imp-file').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var prev = m.el.querySelector('#dr-imp-preview');
      prev.innerHTML = '<span class="dr-spin"></span> Reading workbook…';
      var reader = new FileReader();
      reader.onload = function (ev) {
        // defer the (synchronous) parse one tick so the "Reading…" state paints
        setTimeout(function () {
          try {
            // sheetRows caps how many rows SheetJS materialises per sheet — a
            // second guard against oversized sheets.
            var wb = XLSX.read(new Uint8Array(ev.target.result), { type:'array', cellDates:true, sheetRows:8000 });
            parsed = parseWorkbook(wb);
            if (!parsed.length) { prev.textContent = 'No drawing rows found in the workbook.'; return; }
            prev.innerHTML = '<strong>'+parsed.length+'</strong> drawings found. Sample:<br>' +
              parsed.slice(0,6).map(function (d){
                return '• '+Fmt.esc((d.phase||'')+' / '+(d.discipline||'')+' — '+(d.drawing_no||d.title));
              }).join('<br>');
            m.el.querySelector('#dr-imp-go').disabled = false;
          } catch (err) { prev.textContent = 'Parse error: ' + err.message; }
        }, 30);
      };
      reader.readAsArrayBuffer(f);
    };
    m.el.querySelector('#dr-imp-go').onclick = async function () {
      if (!parsed || !parsed.length) return;
      var go = m.el.querySelector('#dr-imp-go'); go.disabled = true; go.textContent = 'Importing…';
      try {
        if (m.el.querySelector('#dr-imp-replace').checked) {
          var d = await sb().from(TABLE).delete().eq('project_id', pid); if (d.error) throw d.error;
        }
        var order = 0;
        var recs = parsed.map(function (p) {
          order++;
          return {
            project_id: pid, created_by: uid, sort_order: order,
            proj_code: p.proj_code||projCodeGuess(), building_ref:p.building_ref, company:p.company,
            drawing_type:p.drawing_type, discipline:p.discipline, floor_level:p.floor_level,
            dwg_number:p.dwg_number, drawing_code:p.drawing_no, drawing_no:p.drawing_no,
            phase:p.phase, category:p.category, title:p.title, description:p.description,
            responsible:p.responsible, no_of_sheets:p.no_of_sheets, approved_sheets:p.approved_sheets,
            approved_pct:(p.no_of_sheets?p.approved_sheets/p.no_of_sheets:0),
            revision:p.revision, submissions:p.submissions, status:p.status,
            planned_approval:p.planned_approval, actual_approval:p.actual_approval,
            issue_date:(p.submissions[0]&&p.submissions[0].actual)||null,
            due_date:(p.submissions[0]&&p.submissions[0].planned)||null,
            remarks:p.remarks
          };
        });
        // chunked insert; yield to the event loop between chunks so the
        // progress text repaints and the tab never looks frozen
        for (var i=0; i<recs.length; i+=200) {
          var chunk = recs.slice(i, i+200);
          var ins = await sb().from(TABLE).insert(chunk); if (ins.error) throw ins.error;
          go.textContent = 'Importing '+Math.min(i+200,recs.length)+' / '+recs.length+'…';
          await new Promise(function (r){ setTimeout(r, 0); });
        }
        UI.toast('Imported '+recs.length+' drawings', 'ok'); m.close(); load();
      } catch (e) { UI.toast(e.message, 'error'); go.disabled=false; go.textContent='Import'; }
    };
  }

  // ---- Parse the workbook's flat "Dwg Registry" layout ---------------------
  function parseWorkbook(wb) {
    // pick the best sheet: prefer one named like a registry with data
    var names = wb.SheetNames.filter(function (n){ return /regist/i.test(n); });
    if (!names.length) names = wb.SheetNames.slice();
    var best = null;
    names.forEach(function (n) {
      var g = gridOf(wb.Sheets[n]);
      var hdr = findHeader(g);
      if (hdr >= 0) {
        var recs = parseGrid(g, hdr);
        if (!best || recs.length > best.recs.length) best = { recs:recs };
      }
    });
    return best ? best.recs : [];
  }

  // Read a BOUNDED window of the sheet via direct cell refs. These workbooks
  // carry a bloated `!ref` (one sheet claims 16,383 columns) — sheet_to_json
  // over that allocates ~100M empty cells and hangs the browser. We cap columns
  // to MAXC (real registers use ~32) and only walk the real row range.
  function gridOf(ws) {
    if (!ws || !ws['!ref']) return [];
    var MAXC = 60;
    var rng = XLSX.utils.decode_range(ws['!ref']);
    var c0 = rng.s.c, c1 = Math.min(rng.e.c, c0 + MAXC);
    var r0 = rng.s.r, r1 = rng.e.r;
    var g = [];
    for (var R = r0; R <= r1; R++) {
      var row = [];
      for (var C = c0; C <= c1; C++) {
        var cell = ws[XLSX.utils.encode_cell({ r:R, c:C })];
        row.push(cell ? (cell.w != null ? cell.w : cell.v) : '');
      }
      g.push(row);
    }
    return g;
  }

  function norm(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim().toLowerCase(); }

  // find the header row: has a "DWG" number col and a "Sheet Title" col
  function findHeader(g) {
    for (var i=0; i<Math.min(g.length,30); i++) {
      var joined = g[i].map(norm).join('|');
      if (joined.indexOf('sheet title') !== -1 &&
          (joined.indexOf('dwg') !== -1 || joined.indexOf('drawing') !== -1)) return i;
    }
    return -1;
  }

  function parseGrid(g, hdr) {
    var H = g[hdr].map(norm);
    function col(){ // first header col matching any of the given substrings
      var subs = Array.prototype.slice.call(arguments);
      for (var c=0;c<H.length;c++){ for (var s=0;s<subs.length;s++){ if (H[c].indexOf(subs[s])!==-1) return c; } }
      return -1;
    }
    var ci = {
      no:          col('no'),        // first "no" — the outline code col
      projectName: col('project name'),
      building:    col('building ref'),
      company:     col('company'),
      type:        col('drawing type'),
      disc:        col('discipline'),
      floor:       col('floor level'),
      dwgno:       col('dwg','drawing      no','drawing no'),
      title:       col('sheet title'),
      category:    col('category'),
      desc:        col('description'),
      resp:        col('reponsible','responsible'),
      sheets:      col('no   of   sheets','no of sheets','of   sheets','of sheets'),
      approvedSh:  col('approved sheets'),
      approvedPct: col('approved %'),
      status:      col('status','approval status'),
      papp:        col('approval date (plan','planned approval'),
      aapp:        col('approval date (actual','actual approval'),
      rem:         col('remarks')
    };
    // submission revision columns (planned/actual pairs), in header order
    var subCols = [];
    for (var c=0;c<H.length;c++){
      var h=H[c];
      if (/subm\.? *date/.test(h) || /submission date/.test(h)) {
        var revM = h.match(/rev *(\d+)/);
        var rev = revM ? parseInt(revM[1],10) : 0;
        var kind = /actual/.test(h) ? 'actual' : 'planned';
        subCols.push({ c:c, rev:rev, kind:kind });
      }
    }
    // the title spans several indent columns → treat any column between title and category as title-indent
    var titleStart = ci.title, titleEnd = (ci.category>ci.title?ci.category:ci.title+4);

    function cell(row, c){ return (c>=0 && c<row.length) ? row[c] : ''; }
    function dateOf(v){
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0,10);
      var s=String(v).trim(); if (!s || /^0*:?0*:?0*$/.test(s)) return null;
      var d=new Date(s); return isNaN(d) ? null : d.toISOString().slice(0,10);
    }
    function intOf(v){ var n=parseInt(String(v).replace(/[^\d.-]/g,''),10); return isFinite(n)?n:0; }

    var recs = [];
    var cur = { phase:'', discipline:'', category:'', building:'', responsible:'' };
    var PHASE_RE = /(concept|schematic|construction|contract|as-?built|design|scheme)/i;
    var DISC_RE  = /^(architectural|structural|civil|electrical|auxil|plumbing|mechanical|fire|site develop|landscape)/i;

    for (var r=hdr+1; r<g.length; r++) {
      var row = g[r]; if (!row || !row.join('').trim()) continue;
      // find which indent column holds the title text
      var indentText = '', indentCol = -1;
      for (var tc=titleStart; tc<=titleEnd && tc<row.length; tc++) {
        if (String(row[tc]).trim()) { indentText = String(row[tc]).trim(); indentCol = tc; break; }
      }
      var noCode = String(cell(row, ci.no)).trim();
      var sheets = intOf(cell(row, ci.sheets));
      var hasDates = subCols.some(function (s){ return dateOf(cell(row,s.c)); });
      var desc = String(cell(row, ci.desc)).trim();
      var dwgno = String(cell(row, ci.dwgno)).trim();

      // ---- classify the row by its title/code, NOT by whether it has dates
      // (discipline group rows carry roll-up dates yet are still headers) -----
      // PHASE header (top of the outline): title is a phase name, no sheet data
      if (indentText && PHASE_RE.test(indentText) && !desc && !dwgno) {
        cur.phase = mapPhase(indentText); cur.discipline=''; cur.category=''; continue;
      }
      // DISCIPLINE header: the title *is* a discipline name (exact-ish match)
      var discHead = disciplineHeader(indentText);
      if (discHead && !desc) {
        cur.discipline = discHead; cur.category='';
        var rp = String(cell(row, ci.resp)).trim(); if (rp) cur.responsible = rp;
        continue;
      }
      // BUILDING / TOWER header
      if (indentText && /^(tower|podium|basement|building|amenity)\b/i.test(indentText) && !desc && !dwgno) {
        cur.building = indentText; continue;
      }
      // CATEGORY header: a sub-group label with no dates and no description
      if (indentText && !hasDates && !desc) { cur.category = indentText; continue; }

      // ---- otherwise it's a drawing sheet ----------------------------------
      var title = indentText || desc;
      if (!title && !dwgno) continue;
      if (!hasDates && !sheets && !desc && !dwgno) continue;

      var subs = [];
      subCols.forEach(function (s){ var d=dateOf(cell(row,s.c)); if (d) push(subs,s.rev,s.kind,d); });
      subs.sort(function(a,b){ return a.rev-b.rev; });

      recs.push({
        proj_code: String(cell(row, ci.projectName)).trim() || undefined,
        building_ref: String(cell(row, ci.building)).trim() || cur.building,
        company: String(cell(row, ci.company)).trim() || undefined,
        drawing_type: String(cell(row, ci.type)).trim() || undefined,
        discipline: canonDiscipline(mapDiscipline(String(cell(row, ci.disc)).trim())) || cur.discipline || disciplineFromCode(dwgno||noCode),
        floor_level: String(cell(row, ci.floor)).trim() || undefined,
        dwg_number: dwgno || noCode,
        drawing_no: dwgno || noCode || title.slice(0,40),
        phase: cur.phase, category: cur.category,
        title: title,
        description: desc && desc!==title ? desc : '',
        responsible: String(cell(row, ci.resp)).trim() || cur.responsible,
        no_of_sheets: sheets || 1,
        approved_sheets: intOf(cell(row, ci.approvedSh)),
        revision: subs.length ? String(subs[subs.length-1].rev).padStart(2,'0') : '',
        submissions: subs,
        status: normalizeStatus(String(cell(row, ci.status)).trim()),
        planned_approval: dateOf(cell(row, ci.papp)),
        actual_approval: dateOf(cell(row, ci.aapp)),
        remarks: String(cell(row, ci.rem)).trim()
      });
    }
    return recs;

    function push(arr, rev, kind, val){
      var e = arr.find(function(x){return x.rev===rev;}); if (!e){ e={rev:rev, planned:null, actual:null}; arr.push(e); } e[kind]=val;
    }
  }

  // Accept a discipline value only if it's one of the canonical names, else ''
  // (guards against a stray code like "A-013" leaking in from a mis-detected column).
  function canonDiscipline(v) {
    if (!v) return '';
    for (var k in DISCIPLINES) { if (DISCIPLINES[k] === v) return v; }
    return '';
  }

  // Infer discipline from the sheet-code prefix (A-101 → Architectural) when
  // no discipline group header was picked up.
  function disciplineFromCode(code) {
    var m = String(code||'').trim().toUpperCase().match(/^([A-Z]{1,2})[\s\-]/);
    if (!m) return '';
    var P = { A:'Architectural', S:'Structural', C:'Civil', M:'Mechanical',
              E:'Electrical', P:'Plumbing', F:'Fire Protection', L:'Landscape',
              SD:'Site Development', AU:'Auxiliary', SW:'Site Development' };
    return P[m[1]] || '';
  }

  // Normalise workbook approval-status text to the module's canonical values.
  function normalizeStatus(s) {
    var t = norm(s); if (!t) return '';
    if (/revise|resubmit/.test(t)) return 'Revise & Resubmit';
    if (/with *comment/.test(t)) return 'Approved w/ comments';
    if (/(w\/o|without) *comment/.test(t)) return 'Approved w/o comments';
    if (/superseded/.test(t)) return 'Superseded';
    if (/approved/.test(t)) return 'Approved';
    if (/review|submitted|for review/.test(t)) return 'For Review';
    return s;
  }

  // Recognise a row whose title *is* a discipline group header (exact-ish),
  // so we don't misread a sheet like "Fire Detection And Alarm System" as one.
  function disciplineHeader(s) {
    var t = norm(s).replace(/s$/,'');
    var MAP = {
      'architectural':'Architectural', 'structural':'Structural', 'civil':'Civil',
      'electrical':'Electrical', 'auxiliary':'Auxiliary', 'auxillary':'Auxiliary',
      'plumbing':'Plumbing', 'plumbing & sanitary':'Plumbing', 'sanitary':'Plumbing',
      'mechanical':'Mechanical', 'fire protection':'Fire Protection',
      'site development':'Site Development', 'landscape':'Landscape'
    };
    return MAP[t] || null;
  }

  function mapDiscipline(s) {
    if (!s) return '';
    var t = norm(s);
    var found = Object.keys(DISCIPLINES).find(function (c){
      return t === c.toLowerCase() || t.indexOf(DISCIPLINES[c].toLowerCase().slice(0,6))===0;
    });
    if (found) return DISCIPLINES[found];
    // caps header like "ARCHITECTURAL"
    var byName = Object.keys(DISCIPLINES).find(function (c){ return norm(DISCIPLINES[c])===t; });
    return byName ? DISCIPLINES[byName] : s.replace(/\b\w/g,function(m){return m.toUpperCase();});
  }
  function mapPhase(s) {
    var t = norm(s);
    if (/concept/.test(t)) return 'Concept Design';
    if (/schematic.*2|scheme *2|sd2/.test(t)) return 'Schematic Design 2';
    if (/schematic|scheme *1|sd1/.test(t)) return 'Schematic Design 1';
    if (/construction|fcd|for const/.test(t)) return 'For Construction';
    if (/as.?built/.test(t)) return 'As-Built';
    if (/contract/.test(t)) return 'For Construction';
    return s.replace(/\b\w/g,function(m){return m.toUpperCase();});
  }

  // =============================================================== EXPORT =====
  function exportExcel() {
    if (!rows.length) { UI.toast('Nothing to export', 'warn'); return; }
    var aoa = [['Drawing Code','Phase','Discipline','Category','Sheet Title','Description',
      'Rev','Status','No. of Sheets','Approved Sheets','Approved %',
      'Latest Planned Sub.','Latest Actual Sub.','Planned Approval','Actual Approval','Responsible','Remarks']];
    filtered().forEach(function (r) {
      aoa.push([r.drawing_code||r.drawing_no, r.phase, r.discipline, r.category, r.title, r.description,
        r.revision, r.status, num(r.no_of_sheets), num(r.approved_sheets),
        Math.round(pctApproved(r)*100)+'%',
        latestSub(r,'planned')||'', latestSub(r,'actual')||'',
        r.planned_approval||'', r.actual_approval||'', r.responsible, r.remarks]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drawing Register');
    XLSX.writeFile(wb, 'Drawing Register - ' + (projName||pid) + '.xlsx');
  }

  return { init: init, _parseWorkbook: parseWorkbook };
})();
