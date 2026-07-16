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
                  'Approved','Superseded'];
  var NODE_LABELS = { phase:'Phase', discipline:'Discipline', category:'Category', drawing:'Drawing' };

  // selection ordering (display order of drawing ids) for shift-click + arrows
  var visibleIds = [];
  var lastClickedId = null;

  function sb() { return AppAuth.getSB(); }
  function num(v){ v = parseFloat(v); return isFinite(v) ? v : 0; }
  function disciplineName(code){ return DISCIPLINES[code] || code || ''; }

  // ---------------------------------------------------------------- init -----
  async function init(user, prof) {
    profile = prof; uid = (user && user.id) || (prof && prof.id);
    var role = (prof && prof.role) || window.__role || '';
    canWrite = ['super_admin','admin','planner'].indexOf(role) !== -1;
    await loadProjects();

    document.getElementById('dr-add').onclick = function () { addDrawing(); };
    document.getElementById('dr-import').onclick = function () { openImport(); };
    document.getElementById('dr-export').onclick = function () { exportExcel(); };
    var clearBtn = document.getElementById('dr-clear');
    if (clearBtn) { clearBtn.style.display = canWrite ? '' : 'none'; clearBtn.onclick = clearAll; }
    // "+ Level" menu: build the phase/discipline/category skeleton
    var lvlBtn = document.getElementById('dr-addlevel'), lvlMenu = document.getElementById('dr-addlevel-menu');
    if (lvlBtn) {
      lvlBtn.style.display = canWrite ? '' : 'none';
      if (!canWrite && document.getElementById('dr-add')) document.getElementById('dr-add').style.display='none';
      lvlBtn.onclick = function (e){ e.stopPropagation(); lvlMenu.hidden = !lvlMenu.hidden; };
      document.addEventListener('click', function(){ if (lvlMenu) lvlMenu.hidden = true; });
      lvlMenu.querySelectorAll('[data-add]').forEach(function (b){
        b.onclick = function(){ lvlMenu.hidden = true; addLevel(b.dataset.add); };
      });
    }
    document.getElementById('dr-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid);
      var p = e.target.selectedOptions[0]; projName = p ? p.textContent : '';
      load({ reset:true });
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
    if (pid) load({ reset:true });
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

  async function load(opts) {
    opts = opts || {};
    if (!pid) { rows = []; render(); return; }
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid)
      .order('sort_order', { ascending: true })
      .order('drawing_no', { ascending: true });
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows = res.data || [];
    if (opts.reset) {
      // fresh view (project switch / import / clear): reset selection + collapse
      selected = {}; lastClickedId = null; selCtx = { phase:'', discipline:'', category:'', level:0 };
      collapsed = {};
      rows.forEach(function (r){ collapsed['P:' + (r.phase || 'Ungrouped')] = true; });
    }
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

  function isNode(r){ return r.node_kind && r.node_kind !== 'drawing'; }
  function drawingRows(){ return rows.filter(function (r){ return !isNode(r); }); }
  function structuralNodes(){ return rows.filter(isNode); }
  function anyFilter(){ return !!(filters.phase || filters.discipline || filters.status || filters.search); }

  function filtered() {
    return drawingRows().filter(function (r) {
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
  var SEP = '';

  // First-appearance order (by sort_order) so imported design iterations read
  // in workbook order instead of being force-sorted into a fixed vocabulary.
  function phaseOrderKey(ph){
    var min = Infinity;
    rows.forEach(function(r){ if((r.phase||'Ungrouped')===ph){ var s=r.sort_order||0; if(s<min) min=s; } });
    return min===Infinity ? 1e9 : min;
  }
  function nodeCode(n){ return n && n.dwg_number ? n.dwg_number : ''; }

  // Build an ordered flat display model that merges explicit structural node
  // rows (node_kind phase/discipline/category) with groups derived from the
  // drawings' phase/discipline/category text. Also fills `visibleIds`.
  function buildModel() {
    var draws = filtered();
    var nodes = structuralNodes();
    var pNode={}, dNode={}, cNode={};
    nodes.forEach(function (n){
      if (n.node_kind==='phase')       pNode[n.phase||n.title||'(unnamed)'] = n;
      else if (n.node_kind==='discipline') dNode[(n.phase||'')+SEP+(n.discipline||'')] = n;
      else if (n.node_kind==='category')   cNode[(n.phase||'')+SEP+(n.discipline||'')+SEP+(n.category||'')] = n;
    });

    // group drawings
    var byP = {};
    draws.forEach(function (r) {
      var ph=r.phase||'Ungrouped', d=r.discipline||'—', c=(r.category||'').trim();
      var P=(byP[ph]=byP[ph]||{disc:{},order:[]});
      var D=P.disc[d]; if(!D){ D=P.disc[d]={cat:{},order:[],nocat:[]}; P.order.push(d); }
      if(c){ if(!D.cat[c]){ D.cat[c]=[]; D.order.push(c); } D.cat[c].push(r); } else D.nocat.push(r);
    });

    var filt = anyFilter();
    var phaseSet={}; Object.keys(pNode).forEach(function(p){phaseSet[p]=1;}); Object.keys(byP).forEach(function(p){phaseSet[p]=1;});
    var phases=Object.keys(phaseSet).sort(function(a,b){return phaseOrderKey(a)-phaseOrderKey(b) || phaseRank(a)-phaseRank(b) || a.localeCompare(b);});

    var disp=[]; visibleIds=[];
    phases.forEach(function (ph) {
      var P=byP[ph]||{disc:{},order:[]};
      var pDraws=collectDraws(P);
      if (filt && !pDraws.length) return;
      var pkey='P:'+ph;
      disp.push({type:'phase',level:1,key:pkey,label:ph,code:nodeCode(pNode[ph]),ctx:{phase:ph},nodeId:node_(pNode[ph]),list:pDraws});
      if (collapsed[pkey]) return;

      var discSet={}; Object.keys(dNode).forEach(function(k){var p=k.split(SEP); if(p[0]===ph)discSet[p[1]]=1;});
      (P.order||[]).forEach(function(d){discSet[d]=1;});
      Object.keys(discSet).sort().forEach(function (d) {
        var D=P.disc[d]||{cat:{},order:[],nocat:[]};
        var dDraws=collectDisc(D);
        if (filt && !dDraws.length) return;
        var dkey='D:'+ph+'|'+d;
        var dlabel=DISCIPLINES[d]?DISCIPLINES[d]+' ('+d+')':disciplineName(d);
        disp.push({type:'disc',level:2,key:dkey,label:dlabel,code:nodeCode(dNode[ph+SEP+d]),ctx:{phase:ph,discipline:d},nodeId:node_(dNode[ph+SEP+d]),list:dDraws});
        if (collapsed[dkey]) return;

        // no-category drawings sit directly under the discipline (level 3)
        D.nocat.forEach(function(r){ disp.push({type:'drawing',level:3,row:r}); visibleIds.push(r.id); });

        var catSet={}; Object.keys(cNode).forEach(function(k){var p=k.split(SEP); if(p[0]===ph&&p[1]===d)catSet[p[2]]=1;});
        (D.order||[]).forEach(function(c){catSet[c]=1;});
        Object.keys(catSet).forEach(function (c) {
          var list=D.cat[c]||[];
          if (filt && !list.length) return;
          var ckey='C:'+ph+'|'+d+'|'+c;
          disp.push({type:'cat',level:3,key:ckey,label:c,code:nodeCode(cNode[ph+SEP+d+SEP+c]),ctx:{phase:ph,discipline:d,category:c},nodeId:node_(cNode[ph+SEP+d+SEP+c]),list:list});
          if (collapsed[ckey]) return;
          list.forEach(function(r){ disp.push({type:'drawing',level:4,row:r}); visibleIds.push(r.id); });
        });
      });
    });
    return disp;

    function node_(n){ return n ? n.id : null; }
    function collectDraws(P){ var a=[]; Object.keys(P.disc).forEach(function(d){ a=a.concat(collectDisc(P.disc[d])); }); return a; }
    function collectDisc(D){ var a=D.nocat.slice(); D.order.forEach(function(c){ a=a.concat(D.cat[c]); }); return a; }
  }

  function renderRegister() {
    var host = document.getElementById('dr-view');
    var draws = drawingRows();
    var disp = buildModel();
    var shown = disp.filter(function(x){return x.type==='drawing';}).length;

    var CB = canWrite;
    var anyOpen = disp.some(function (x){ return x.type==='phase' && !collapsed[x.key]; });
    var toolbar = '<div class="dr-listbar">' +
      '<button class="dr-rowbtn dr-xall" id="dr-xall">' + (anyOpen ? 'Collapse all' : 'Expand all') + '</button>' +
      '<div class="dr-listcount">Showing <strong>'+shown+'</strong> of '+draws.length+' drawings</div>' +
      '<div class="dr-selbar" id="dr-selbar" hidden>' +
        '<span id="dr-selcount"></span>' +
        '<button class="pd-btn pd-btn-sm" id="dr-selclear">Clear</button>' +
        '<button class="pd-btn pd-btn-sm pd-btn-danger" id="dr-seldel">Delete selected</button>' +
      '</div>' +
      (canWrite ? '<div class="dr-hint">Click to select · Shift-click range · double-click a cell to edit · Enter=add · Del=delete</div>' : '') +
    '</div>';

    if (!draws.length && !structuralNodes().length) {
      host.innerHTML = toolbar + emptyMsg('No drawings yet. Build levels with “+ Level”, add rows with “+ Add drawing”, or “Import Excel”.');
      return;
    }
    if (!disp.length) { host.innerHTML = toolbar + emptyMsg('Nothing matches the filters.'); return; }

    var head = '<tr>' +
      (CB ? '<th class="dr-cb"><input type="checkbox" id="dr-selall" title="Select all shown"></th>' : '') +
      '<th class="dr-c-code">Code</th><th>Sheet Title / Description</th>' +
      '<th class="dr-c-rev">Rev</th><th class="dr-c-status">Status</th>' +
      '<th class="dr-r dr-c-sh">Sh</th><th class="dr-r dr-c-ap">Appr</th>' +
      '<th class="dr-c-date">Latest Sub.</th><th class="dr-c-date">Approval</th>' +
      '<th class="dr-c-resp">Resp.</th><th class="dr-actcol"></th></tr>';

    var html = toolbar + '<div class="pd-card dr-tablecard"><table class="pd-table dr-table dr-grid" tabindex="0"><thead>'+head+'</thead><tbody>';
    disp.forEach(function (item) {
      html += item.type==='drawing' ? drawRowHTML(item, CB) : groupRowHTML(item, CB);
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;
    wireRegister(host, disp);
  }

  var COLSPAN_LABEL = 3;   // Code + Title + Rev under a group label
  function groupRowHTML(item, CB) {
    var tot=0, ap=0;
    item.list.forEach(function (r){ tot += num(r.no_of_sheets)||0; ap += num(r.approved_sheets)||0; });
    var pct = tot ? Math.round(ap/tot*100) : 0;
    var ids = item.list.map(function(r){return r.id;}).join(',');
    var grpCb = CB ? '<td class="dr-cb"><input type="checkbox" data-selgrp="'+ids+'" title="Select group"></td>' : '';
    var isCol = !!collapsed[item.key];
    var caret = '<span class="dr-caret'+(isCol?' dr-caret-col':'')+'">▾</span>';
    var kindTag = item.type==='cat' ? '' : '';
    return '<tr class="dr-grp dr-grp-'+item.type+' dr-lvl-'+item.level+(isCol?' dr-collapsed':'')+'"'+
        ' data-grp="'+Fmt.esc(item.key)+'" data-kind="'+item.type+'" data-nodeid="'+(item.nodeId||'')+'"'+
        ' data-phase="'+Fmt.esc(item.ctx.phase||'')+'" data-disc="'+Fmt.esc(item.ctx.discipline||'')+'" data-cat="'+Fmt.esc(item.ctx.category||'')+'">' + grpCb +
      '<td colspan="'+COLSPAN_LABEL+'" class="dr-indent"><span class="dr-grplabel">'+caret+
        (item.code?'<span class="dr-gcode">'+Fmt.esc(item.code)+'</span> ':'')+
        '<strong class="dr-glabel">'+Fmt.esc(item.label)+'</strong> <span class="dr-count">'+item.list.length+' dwg</span></span></td>' +
      '<td></td>' +   // Status col
      '<td class="dr-r">'+tot+'</td>' +
      '<td class="dr-r">'+ap+'</td>' +
      '<td colspan="2">'+progressBar(pct)+'</td>' +
      '<td></td><td></td></tr>';
  }

  function progressBar(pct) {
    return '<div class="dr-prog"><div class="dr-prog-fill" style="width:'+pct+'%;"></div>' +
           '<span class="dr-prog-txt">'+pct+'%</span></div>';
  }

  function statusSelect(r) {
    return '<select class="dr-stsel dr-st-'+statusCls(r.status)+'" data-stat="'+r.id+'">' +
      '<option value=""'+(!r.status?' selected':'')+'>—</option>' +
      STATUSES.map(function(s){ return '<option'+(r.status===s?' selected':'')+'>'+s+'</option>'; }).join('') +
    '</select>';
  }

  function drawRowHTML(item, CB) {
    var r = item.row;
    var code = r.drawing_code || r.drawing_no || '';
    var tot = num(r.no_of_sheets)||0, ap = num(r.approved_sheets)||0;
    var pct = Math.round(pctApproved(r)*100);
    var sub = latestSub(r,'actual') || latestSub(r,'planned');
    var appr = r.actual_approval || r.planned_approval;
    var cb = CB ? '<td class="dr-cb"><input type="checkbox" data-sel="'+r.id+'"'+(selected[r.id]?' checked':'')+'></td>' : '';
    var ed = CB ? ' dr-ed' : '';
    return '<tr class="dr-drow dr-lvl-'+(item.level||4)+(selected[r.id]?' dr-selrow':'')+'" data-id="'+r.id+'">' + cb +
      '<td class="dr-indent'+ed+'" data-f="code" data-t="text"><span class="dr-code">'+Fmt.esc(code)+'</span></td>' +
      '<td class="'+ed+'" data-f="title" data-t="text">'+Fmt.esc(r.title)+(r.description?'<div class="dr-sub">'+Fmt.esc(r.description)+'</div>':'')+'</td>' +
      '<td class="dr-c-rev'+ed+'" data-f="revision" data-t="text">'+Fmt.esc(r.revision)+'</td>' +
      '<td class="dr-c-status">'+(CB?statusSelect(r):'<span class="dr-pill '+statusCls(r.status)+'">'+Fmt.esc(r.status||'—')+'</span>')+'</td>' +
      '<td class="dr-r dr-c-sh'+ed+'" data-f="no_of_sheets" data-t="num">'+tot+'</td>' +
      '<td class="dr-r dr-c-ap'+ed+'" data-f="approved_sheets" data-t="num">'+ap+' <span class="dr-mini">'+pct+'%</span></td>' +
      '<td class="dr-nowrap dr-c-date">'+(sub?Fmt.date(sub):'—')+'</td>' +
      '<td class="dr-nowrap dr-c-date">'+(appr?Fmt.date(appr):'—')+'</td>' +
      '<td class="dr-c-resp'+ed+'" data-f="responsible" data-t="text">'+Fmt.esc(r.responsible)+'</td>' +
      '<td class="dr-nowrap dr-actcol">'+(r.file_url?'<button class="dr-iconbtn" data-view="'+Fmt.esc(r.file_url)+'" title="View file">▤</button>':'')+
        '<button class="dr-iconbtn" data-edit="'+r.id+'" title="Full editor">✎</button>' +
        '<button class="dr-iconbtn dr-rowbtn-del" data-del="'+r.id+'" title="Delete">✕</button></td>' +
    '</tr>';
  }

  function emptyMsg(msg) {
    return '<div class="pd-card dr-empty">'+Fmt.esc(msg)+'</div>';
  }

  // ------------------------------------------------------------- wiring ------
  function wireRegister(host, disp) {
    var xall = host.querySelector('#dr-xall');
    if (xall) xall.onclick = function(){
      var pkeys = disp.filter(function(x){return x.type==='phase';}).map(function(x){return x.key;});
      var anyOpen = pkeys.some(function (k){ return !collapsed[k]; });
      if (anyOpen) pkeys.forEach(function (k){ collapsed[k] = true; });
      else collapsed = {};
      render();
    };
    // group collapse + rename-on-dblclick + context select
    host.querySelectorAll('tr.dr-grp').forEach(function (tr){
      var lab = tr.querySelector('.dr-grplabel');
      var glabel = tr.querySelector('.dr-glabel');
      if (lab) lab.onclick = function(e){
        if (e.target === glabel) return;   // let dblclick handle rename
        setContextFromRow(tr);
        var key = tr.dataset.grp;
        if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
        render();
      };
      if (glabel && canWrite) glabel.ondblclick = function(e){ e.stopPropagation(); beginRenameGroup(tr, glabel); };
      tr.addEventListener('click', function(){ setContextFromRow(tr); });
    });

    host.querySelectorAll('[data-view]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); viewFile(b.dataset.view); }; });
    host.querySelectorAll('[data-edit]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); openForm(rows.find(function(x){return x.id===b.dataset.edit;})); }; });
    host.querySelectorAll('[data-del]').forEach(function (b){ b.onclick=function(e){ e.stopPropagation(); del(rows.find(function(x){return x.id===b.dataset.del;})); }; });
    if (!canWrite) { return; }

    // status dropdowns (always visible)
    host.querySelectorAll('select[data-stat]').forEach(function (sel){
      sel.onclick = function(e){ e.stopPropagation(); };
      sel.onchange = async function(){
        var r = rows.find(function(x){return x.id===sel.dataset.stat;}); if(!r) return;
        await persistCell(r, { status: sel.value });
        sel.className = 'dr-stsel dr-st-'+statusCls(sel.value);
      };
    });

    // inline edit (double-click a cell)
    host.querySelectorAll('td.dr-ed').forEach(function (td){
      td.ondblclick = function(e){ e.stopPropagation(); beginEdit(td); };
    });

    // row selection (single click)
    host.querySelectorAll('tr.dr-drow').forEach(function (tr){
      tr.addEventListener('click', function(e){
        if (e.target.closest('.dr-ed') && e.detail>1) return;  // ignore the dblclick-to-edit
        if (e.target.closest('button,select,input,.dr-editing')) return;
        clickSelect(tr.dataset.id, e);
      });
    });

    // checkboxes
    host.querySelectorAll('input[data-sel]').forEach(function (cb){
      cb.onclick = function(e){ e.stopPropagation(); };
      cb.onchange = function(){ if (cb.checked) selected[cb.dataset.sel]=true; else delete selected[cb.dataset.sel]; lastClickedId=cb.dataset.sel; refreshSel(host); };
    });
    host.querySelectorAll('input[data-selgrp]').forEach(function (cb){
      cb.onclick = function(e){ e.stopPropagation(); };
      cb.onchange = function(){
        cb.dataset.selgrp.split(',').forEach(function (id){ if(!id) return; if (cb.checked) selected[id]=true; else delete selected[id]; });
        refreshSel(host);
      };
    });
    var all = host.querySelector('#dr-selall');
    if (all) all.onclick=function(e){e.stopPropagation();}, all.onchange = function(){ visibleIds.forEach(function (id){ if(all.checked) selected[id]=true; else delete selected[id]; }); render(); };
    var clr = host.querySelector('#dr-selclear'); if (clr) clr.onclick = function(){ selected={}; render(); };
    var sd  = host.querySelector('#dr-seldel');   if (sd)  sd.onclick  = deleteSelected;

    // keyboard shortcuts (grid focused)
    var grid = host.querySelector('.dr-grid');
    if (grid) grid.onkeydown = onGridKey;

    refreshSel(host);
  }

  function refreshSel(host) {
    host = host || document;
    var ids = Object.keys(selected).filter(function (id){ return visibleIds.indexOf(id)!==-1; });
    var bar = host.querySelector('#dr-selbar');
    if (bar) { bar.hidden = ids.length===0; var c=host.querySelector('#dr-selcount'); if(c) c.textContent = ids.length + ' selected'; }
    var all = host.querySelector('#dr-selall'); if (all) all.checked = visibleIds.length>0 && ids.length===visibleIds.length;
    // reflect row highlight without full re-render
    host.querySelectorAll('tr.dr-drow').forEach(function (tr){
      tr.classList.toggle('dr-selrow', !!selected[tr.dataset.id]);
      var cb = tr.querySelector('input[data-sel]'); if (cb) cb.checked = !!selected[tr.dataset.id];
    });
  }

  // ------------------------------------------------- context / selection ----
  var selCtx = { phase:'', discipline:'', category:'', level:0 };

  function setContextFromRow(tr){
    if (tr.classList.contains('dr-drow')) {
      var r = rows.find(function(x){return x.id===tr.dataset.id;});
      if (r) selCtx = { phase:r.phase||'', discipline:r.discipline||'', category:(r.category||'').trim(), level:4 };
    } else {
      selCtx = { phase:tr.dataset.phase||'', discipline:tr.dataset.disc||'', category:tr.dataset.cat||'',
                 level: tr.dataset.kind==='phase'?1 : tr.dataset.kind==='disc'?2 : 3 };
    }
  }

  function clickSelect(id, e){
    if (e.shiftKey && lastClickedId) {
      var a=visibleIds.indexOf(lastClickedId), b=visibleIds.indexOf(id);
      if (a>-1 && b>-1) {
        if (!(e.ctrlKey||e.metaKey)) selected = {};
        var lo=Math.min(a,b), hi=Math.max(a,b);
        for (var i=lo;i<=hi;i++) selected[visibleIds[i]] = true;
      }
    } else if (e.ctrlKey||e.metaKey) {
      if (selected[id]) delete selected[id]; else selected[id]=true; lastClickedId=id;
    } else {
      selected = {}; selected[id]=true; lastClickedId=id;
    }
    refreshSel(document);
  }

  function onGridKey(e){
    if (!canWrite) return;
    var tag=(e.target.tagName||'').toLowerCase();
    if (tag==='input'||tag==='select'||tag==='textarea'||e.target.isContentEditable) return;
    if (e.key==='Escape'){ selected={}; lastClickedId=null; refreshSel(document); return; }
    if ((e.ctrlKey||e.metaKey) && (e.key==='a'||e.key==='A')){ e.preventDefault(); visibleIds.forEach(function(id){selected[id]=true;}); refreshSel(document); return; }
    if (e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      var idx = lastClickedId ? visibleIds.indexOf(lastClickedId) : -1;
      idx += (e.key==='ArrowDown'?1:-1);
      if (idx<0) idx=0; if (idx>=visibleIds.length) idx=visibleIds.length-1;
      var id=visibleIds[idx]; if(!id) return;
      if (e.shiftKey && lastClickedId) selected[id]=true; else { selected={}; selected[id]=true; }
      lastClickedId=id; refreshSel(document);
      var tr=document.querySelector('tr.dr-drow[data-id="'+id+'"]'); if(tr) tr.scrollIntoView({block:'nearest'});
      return;
    }
    if (e.key==='Delete'||e.key==='Backspace'){ if(Object.keys(selected).length){ e.preventDefault(); deleteSelected(); } return; }
    if (e.key==='Enter'){ e.preventDefault(); addDrawing(); return; }
  }

  // ------------------------------------------------------- inline editing ----
  async function persistCell(r, patch){
    if ('no_of_sheets' in patch || 'approved_sheets' in patch) {
      var ns = ('no_of_sheets' in patch) ? num(patch.no_of_sheets) : num(r.no_of_sheets);
      var as = ('approved_sheets' in patch) ? num(patch.approved_sheets) : num(r.approved_sheets);
      patch.approved_pct = ns ? as/ns : 0;
    }
    patch.updated_at = new Date().toISOString();
    Object.assign(r, patch);
    var res = await sb().from(TABLE).update(patch).eq('id', r.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return false; }
    return true;
  }

  function beginEdit(td){
    if (!canWrite || td.classList.contains('dr-editing')) return;
    var tr=td.closest('tr.dr-drow'); if(!tr) return;
    var r=rows.find(function(x){return x.id===tr.dataset.id;}); if(!r) return;
    var f=td.dataset.f, t=td.dataset.t;
    var cur = f==='code' ? (r.drawing_code||r.drawing_no||'') : (r[f]!=null?r[f]:'');
    td.classList.add('dr-editing');
    var input=document.createElement('input');
    input.className='dr-editin'; input.type = (t==='num'?'number':'text'); input.value=cur;
    td.innerHTML=''; td.appendChild(input); input.focus(); input.select();
    var done=false;
    function commit(save){
      if (done) return; done=true;
      td.classList.remove('dr-editing');
      if (!save) { render(); return; }
      var val=input.value.trim(), patch={};
      if (f==='code'){ patch.dwg_number=val; patch.drawing_no=val; patch.drawing_code=val; }
      else if (t==='num'){ patch[f]=num(val); }
      else patch[f]=val;
      persistCell(r, patch).then(function(){ render(); });
    }
    input.onkeydown=function(e){ if(e.key==='Enter'){e.preventDefault();commit(true);} else if(e.key==='Escape'){e.preventDefault();commit(false);} };
    input.onblur=function(){ commit(true); };
  }

  function editRowField(id, f){
    var td=document.querySelector('tr.dr-drow[data-id="'+id+'"] td[data-f="'+f+'"]');
    if (td){ td.scrollIntoView({block:'nearest'}); beginEdit(td); }
  }

  // ----------------------------------------------- rename a structural level --
  function beginRenameGroup(tr, glabel){
    var kind=tr.dataset.kind;
    var oldLabel = kind==='phase'?tr.dataset.phase : kind==='disc'?tr.dataset.disc : tr.dataset.cat;
    var input=document.createElement('input'); input.className='dr-editin'; input.value=oldLabel||'';
    glabel.replaceWith(input); input.focus(); input.select();
    var done=false;
    function commit(save){
      if (done) return; done=true;
      var v=input.value.trim();
      if (!save || !v || v===oldLabel){ render(); return; }
      renameGroup(tr.dataset, kind, oldLabel, v).then(function(){ load(); });
    }
    input.onkeydown=function(e){ if(e.key==='Enter'){e.preventDefault();commit(true);} else if(e.key==='Escape'){e.preventDefault();commit(false);} };
    input.onblur=function(){ commit(true); };
  }

  async function renameGroup(ds, kind, oldVal, newVal){
    var patch = kind==='phase'?{phase:newVal} : kind==='disc'?{discipline:newVal} : {category:newVal};
    var q = sb().from(TABLE).update(patch).eq('project_id', pid);
    if (kind==='phase') q=q.eq('phase', oldVal);
    else if (kind==='disc') q=q.eq('phase', ds.phase).eq('discipline', oldVal);
    else q=q.eq('phase', ds.phase).eq('discipline', ds.disc).eq('category', oldVal);
    var res=await q; if (res.error) UI.toast(res.error.message,'error');
    // keep collapse state under the renamed key
    if (kind==='phase'){ if(collapsed['P:'+oldVal]){ collapsed['P:'+newVal]=true; delete collapsed['P:'+oldVal]; } }
  }

  // ------------------------------------------------ add levels / drawings -----
  function nextOrder(){ return (rows.length ? Math.max.apply(null, rows.map(function(x){return x.sort_order||0;})) : 0) + 1; }
  function phaseNames(){ var s={}; rows.forEach(function(r){ if(r.phase)s[r.phase]=1; }); return Object.keys(s); }
  function discNames(ph){ var s={}; rows.forEach(function(r){ if((r.phase||'')===ph && r.discipline)s[r.discipline]=1; }); return Object.keys(s); }
  function catNames(ph,d){ var s={}; rows.forEach(function(r){ if((r.phase||'')===ph&&(r.discipline||'')===d&&r.category)s[r.category]=1; }); return Object.keys(s); }
  function uniqueName(base, taken){ var n=base, i=2; while(taken.indexOf(n)!==-1){ n=base+' '+(i++); } return n; }

  async function addLevel(kind){
    if (!pid){ UI.toast('Select a project first','warn'); return; }
    var ctx=selCtx||{};
    var data={ project_id:pid, created_by:uid, node_kind:kind, no_of_sheets:0, approved_sheets:0, sort_order:nextOrder() };
    if (kind==='phase'){ data.phase=uniqueName('New Phase', phaseNames()); }
    else if (kind==='discipline'){ if(!ctx.phase){ UI.toast('Select a phase first','warn'); return; } data.phase=ctx.phase; data.discipline=uniqueName('New Discipline', discNames(ctx.phase)); }
    else if (kind==='category'){ if(!ctx.phase||!ctx.discipline){ UI.toast('Select a discipline first','warn'); return; } data.phase=ctx.phase; data.discipline=ctx.discipline; data.category=uniqueName('New Category', catNames(ctx.phase,ctx.discipline)); }
    data.title = data.category||data.discipline||data.phase;
    var res=await sb().from(TABLE).insert(data); if(res.error){ UI.toast(res.error.message,'error'); return; }
    if (kind!=='phase') delete collapsed['P:'+ctx.phase];
    if (kind==='category') delete collapsed['D:'+ctx.phase+'|'+ctx.discipline];
    await load();
    UI.toast(NODE_LABELS[kind]+' added — double-click its name to rename', 'ok');
  }

  function autoNumber(group, ctx){
    var nums=group.map(function(r){ var m=String(r.dwg_number||r.drawing_no||'').match(/(\d+)\s*$/); return m?parseInt(m[1],10):null; }).filter(function(x){return x!=null;});
    var next=(nums.length?Math.max.apply(null,nums):0)+1;
    var proto=group.find(function(r){ return /\d/.test(String(r.dwg_number||r.drawing_no||'')); });
    if (proto){ var pm=String(proto.dwg_number||proto.drawing_no).match(/^(.*?)(\d+)\s*$/); if(pm){ return pm[1]+String(next).padStart(pm[2].length,'0'); } }
    var dc=discCodeOf(ctx.discipline); var letter=dc?dc[0]:(ctx.discipline?ctx.discipline[0].toUpperCase():'D');
    return letter+'-'+String(next).padStart(3,'0');
  }

  async function addDrawing(){
    if (!pid){ UI.toast('Select a project first','warn'); return; }
    var ctx=selCtx||{phase:'',discipline:'',category:''};
    var group=drawingRows().filter(function(r){
      return (r.phase||'')===(ctx.phase||'') && (r.discipline||'')===(ctx.discipline||'') && ((r.category||'').trim())===((ctx.category||''));
    });
    var code=autoNumber(group, ctx);
    var data={ project_id:pid, created_by:uid, node_kind:'drawing',
      phase:ctx.phase||'', discipline:ctx.discipline||'', category:ctx.category||'',
      title:'', status:'For Review', no_of_sheets:1, approved_sheets:0, approved_pct:0,
      submissions:[], dwg_number:code, drawing_no:code, drawing_code:code, sort_order:nextOrder() };
    var res=await sb().from(TABLE).insert(data); if(res.error){ UI.toast(res.error.message,'error'); return; }
    if (ctx.phase) delete collapsed['P:'+ctx.phase];
    if (ctx.phase&&ctx.discipline) delete collapsed['D:'+ctx.phase+'|'+ctx.discipline];
    if (ctx.category) delete collapsed['C:'+ctx.phase+'|'+ctx.discipline+'|'+ctx.category];
    await load();
    // focus the newly-added row's title for immediate typing
    var added=drawingRows().filter(function(r){
      return (r.phase||'')===(ctx.phase||'') && (r.discipline||'')===(ctx.discipline||'') &&
             ((r.category||'').trim())===((ctx.category||'')) && r.dwg_number===code && !r.title;
    }).pop();
    if (added){ lastClickedId=added.id; editRowField(added.id, 'title'); }
  }

  // ----------------------------------------------------- progress dashboard --
  function renderProgress() {
    var host = document.getElementById('dr-view');
    var draws = drawingRows();
    if (!draws.length) { host.innerHTML = emptyMsg('No drawings to summarise yet.'); return; }

    var totSheets=0, subSheets=0, apSheets=0;
    draws.forEach(function (r){
      var t=num(r.no_of_sheets)||0, a=num(r.approved_sheets)||0;
      totSheets+=t; apSheets+=a;
      if (latestSub(r,'actual')) subSheets+=t;
    });
    var balance = totSheets - apSheets;

    var kpis = '<div class="dr-kpis">' +
      kpi(draws.length, 'Drawings') +
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
    drawingRows().forEach(function (r) {
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
        node_kind: 'drawing',
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
      UI.toast('All drawings cleared', 'ok'); m.close(); load({ reset:true });
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
            var nDraw = parsed.filter(function(p){ return (p.node_kind||'drawing')==='drawing'; }).length;
            var nNode = parsed.length - nDraw;
            prev.innerHTML = '<strong>'+nDraw+'</strong> drawings' + (nNode?' + '+nNode+' level rows':'') + ' found. Sample:<br>' +
              parsed.filter(function(p){return (p.node_kind||'drawing')==='drawing';}).slice(0,6).map(function (d){
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
          var subs = p.submissions || [];
          return {
            project_id: pid, created_by: uid, sort_order: order,
            node_kind: p.node_kind || 'drawing',
            proj_code: p.proj_code||projCodeGuess(), building_ref:p.building_ref, company:p.company,
            drawing_type:p.drawing_type, discipline:p.discipline, floor_level:p.floor_level,
            dwg_number:p.dwg_number, drawing_code:p.drawing_no, drawing_no:p.drawing_no,
            phase:p.phase, category:p.category, title:p.title, description:p.description,
            responsible:p.responsible, no_of_sheets:p.no_of_sheets, approved_sheets:p.approved_sheets,
            approved_pct:(p.no_of_sheets?p.approved_sheets/p.no_of_sheets:0),
            revision:p.revision, submissions:subs, status:p.status,
            planned_approval:p.planned_approval, actual_approval:p.actual_approval,
            issue_date:(subs[0]&&subs[0].actual)||null,
            due_date:(subs[0]&&subs[0].planned)||null,
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
        var dc = recs.filter(function(x){return (x.node_kind||'drawing')==='drawing';}).length;
        UI.toast('Imported '+dc+' drawings', 'ok'); m.close(); load({ reset:true });
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
    // Anchored so only genuine phase-block titles match — NOT category/sheet
    // titles that merely contain "schematic"/"construction" (e.g. "Schematic
    // Diagrams", "Construction Notes", "Neighbor's As-Built and Crack Mapping").
    var PHASE_RE = /^\s*(concept design|schematic design\s*\d|design development|design analysis|detailed design|contract document|for\s+construction|construction drawing|as[- ]?built drawing|as[- ]?built\s*$|pre[- ]?engineering|tender)\b/i;
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
      // (discipline group rows carry roll-up dates yet are still headers).
      // Header rows are emitted as STRUCTURAL NODES carrying their code (A-100,
      // AR-000, …) so the tree skeleton + codes survive import. ---------------
      // PHASE header (top of the outline): keep the *exact* block name so design
      // iterations (Schematic Design 1/2/3/4, FCD, Scheme 1/2…) stay distinct.
      if (indentText && PHASE_RE.test(indentText) && !desc && !dwgno) {
        cur.phase = cleanPhase(indentText); cur.discipline=''; cur.category='';
        recs.push(nodeRec('phase', noCode, indentText)); continue;
      }
      // DISCIPLINE header: the title *is* a discipline name (exact-ish match)
      var discHead = disciplineHeader(indentText);
      if (discHead && !desc) {
        cur.discipline = discHead; cur.category='';
        var rp = String(cell(row, ci.resp)).trim(); if (rp) cur.responsible = rp;
        recs.push(nodeRec('discipline', noCode, indentText)); continue;
      }
      // BUILDING / TOWER header (kept on `cur`, not a render level)
      if (indentText && /^(tower|podium|basement|building|amenity)\b/i.test(indentText) && !desc && !dwgno) {
        cur.building = indentText; continue;
      }
      // CATEGORY header: a sub-group label with no dates and no description
      if (indentText && !hasDates && !desc) {
        cur.category = indentText;
        recs.push(nodeRec('category', noCode, indentText)); continue;
      }

      // ---- otherwise it's a drawing sheet ----------------------------------
      var title = indentText || desc;
      if (!title && !dwgno) continue;
      if (!hasDates && !sheets && !desc && !dwgno) continue;

      var subs = [];
      subCols.forEach(function (s){ var d=dateOf(cell(row,s.c)); if (d) push(subs,s.rev,s.kind,d); });
      subs.sort(function(a,b){ return a.rev-b.rev; });

      recs.push({
        node_kind: 'drawing',
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

    // A structural node (phase/discipline/category) carrying its code + rollup.
    function nodeRec(kind, code, label){
      return { node_kind:kind,
        phase: cur.phase,
        discipline: kind==='phase' ? '' : cur.discipline,
        category: kind==='category' ? cur.category : '',
        dwg_number: code||'', drawing_no: code||'', drawing_code: code||'',
        title: label||'',
        no_of_sheets: 0, approved_sheets: 0, submissions: [], status: '' };
    }

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
    if (/(w\/o|without) *comment/.test(t)) return 'Approved';   // merged: redundant with "Approved"
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
  // Keep the workbook's exact phase-block name (title-cased) so design
  // iterations stay distinct — do NOT normalise 3/4 down to 1.
  function cleanPhase(s) {
    return String(s||'').replace(/\s+/g,' ').trim()
      .toLowerCase().replace(/\b([a-z])/g, function(m,c){ return c.toUpperCase(); })
      .replace(/\bFcd\b/i,'FCD');
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
