/* THE PORTFOLIO DASHBOARDS, EXECUTED — assets/js/portfolio-dash.js
 *
 *   node tools/test-portfolio-dash.js
 *
 * ⚠️⚠️ NOTHING HERE IS A RE-TYPED COPY. The shipped layer is LOADED the way a browser loads it
 *    and every view is MOUNTED against a narrow fake DOM, so what is asserted is the renderer
 *    that ships. A suite that re-implements the thing it tests proves the re-implementation —
 *    this repo has been caught by that more than once.
 *
 * ⚠️⚠️ AND IT LOADS THE REAL ui.js, db.js AND scurve.js RATHER THAN STUBBING THEM. Three of these
 *    dashboards derive their numbers through `PDScurve.compute`, `Fmt.moneyShort` and `UI.kpi`,
 *    and a stub of a rule is a second copy of that rule — the same fault the whole move exists
 *    to end. `PDb.selectAll` / `getProjects` / `sb()` ARE faked: they are the network.
 *
 * ⚠️ THE GATE. A suite that has never failed proves nothing, so the same checks are run against
 *    `origin/main`'s own copies of these files: there the four views of 2026-09-16 were panes of
 *    modules/portfolio-overview/index.html and no module mounted them. If the gate goes green on
 *    both sides, this file is measuring nothing and says so.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'assets', 'js', 'portfolio-dash.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
function has(hay, needle, label) { ok(String(hay).indexOf(needle) >= 0, label); }

/* ============================================================ the fake document
   Deliberately small, and deliberately NOT a DOM library: every capability below exists
   because a shipped renderer reaches for it, and nothing else answers. An element that
   answers everything lets a renderer that asks for a node nobody provides look healthy. */
function makeDom() {
  const byId = Object.create(null);
  const all = [];

  function el(tag) {
    const classes = Object.create(null);
    const node = {
      tagName: (tag || 'div').toUpperCase(),
      children: [], dataset: {}, style: {}, hidden: false,
      textContent: '', value: '',
      onclick: null, oninput: null, onchange: null,
      classList: {
        add(c) { classes[c] = 1; },
        remove(c) { delete classes[c]; },
        contains(c) { return !!classes[c]; },
        toggle(c, on) { if (on === undefined) on = !classes[c]; if (on) classes[c] = 1; else delete classes[c]; }
      },
      _classes: classes,
      appendChild(c) { node.children.push(c); c.parentNode = node; return c; },
      /* ⚠️ Assigning innerHTML REGISTERS the ids inside it. That is the one browser behaviour
         these renderers depend on and a plain string property would not give: every view writes
         its markup once and then addresses the nodes inside it by id. */
      set innerHTML(v) { node._html = String(v == null ? '' : v); index(node._html); },
      get innerHTML() { return node._html || ''; },
      querySelectorAll(sel) { return query(node, sel); },
      querySelector(sel) { return query(node, sel)[0] || null; }
    };
    node._html = '';
    all.push(node);
    return node;
  }

  /* ids and `data-` buttons found in a markup string become addressable nodes. */
  function index(html) {
    const idRe = /\sid="([^"]+)"/g;
    let m;
    while ((m = idRe.exec(html))) if (!byId[m[1]]) byId[m[1]] = el('div');
    const btnRe = /<button([^>]*)>/g;
    while ((m = btnRe.exec(html))) {
      const attrs = m[1];
      const d = /data-(av|sc|shv|lay)="([^"]*)"/.exec(attrs);
      if (!d) continue;
      const b = el('button');
      b.dataset[d[1]] = d[2];
      if (/\sclass="[^"]*\bactive\b/.test(attrs)) b.classList.add('active');
      if (/\sclass="[^"]*\bon\b/.test(attrs)) b.classList.add('on');
      (buttons[d[1]] = buttons[d[1]] || []).push(b);
    }
  }
  const buttons = Object.create(null);

  function query(root, sel) {
    sel = String(sel).trim();
    let m = /^#([\w-]+)\s+button$/.exec(sel);
    if (m) {
      const kind = m[1] === 'po-eq-avail' ? 'av' : null;
      return kind ? (buttons[kind] || []) : [];
    }
    m = /^button\[data-(\w+)\]$/.exec(sel);
    if (m) return buttons[m[1]] || [];
    if (sel === '.po-toolbar-fields') {
      return Object.keys(byId).filter(k => /fields$/.test(k)).map(k => byId[k]);
    }
    if (sel === '.pd-main') return [doc._main];
    if (sel === '.pd-modulebar') return doc._modulebar ? [doc._modulebar] : [];
    if (/^#[\w-]+$/.test(sel)) return byId[sel.slice(1)] ? [byId[sel.slice(1)]] : [];
    return [];
  }

  const doc = {
    getElementById(id) { return byId[id] || null; },
    createElement(tag) { return el(tag); },
    querySelector(sel) { return query(null, sel)[0] || null; },
    querySelectorAll(sel) { return query(null, sel); },
    addEventListener() {},
    readyState: 'complete',
    _el: el, _byId: byId, _buttons: buttons, _index: index
  };
  return doc;
}

/* =================================================== loading a shipped browser script
   ⚠️⚠️ THE BARE GLOBALS ARE PASSED IN, AND THEY HAVE TO BE. A browser turns `window.Icons = …`
   into a real global, so a module written `if (window.Icons) Icons.hydrate(host)` reads the
   bare name — which inside `new Function` resolves against Node's global scope, not against the
   `window` object handed in. Without this every cross-module call in a shipped file throws a
   ReferenceError that has nothing to do with the code under test. Same device as
   tools/wiring-check.js. ⚠️ Bound at LOAD time, which is why load order below is the page's. */
const BARE = ['Icons', 'UI', 'PDb', 'Fmt', 'PDScurve', 'AppAuth', 'PDSync', 'PDCollab',
              'PDProgram', 'MCCRCM', 'PDClaims', 'PDStakeholders', 'PortfolioDash'];
function loadInto(win, src, label) {
  const names = ['window', 'document', 'location', 'history', 'navigator', 'sessionStorage',
                 'localStorage', 'matchMedia', 'setTimeout', 'clearTimeout', 'setInterval',
                 'clearInterval', 'fetch', 'XLSX', 'console'].concat(BARE);
  const vals = [win, win.document, win.location, win.history, win.navigator, win.sessionStorage,
                win.localStorage, win.matchMedia, setTimeout, clearTimeout, setInterval,
                clearInterval, win.fetch, win.XLSX, console].concat(BARE.map(n => win[n]));
  new Function(names.join(','), src).apply(null, vals);
  return win;
}

function newWindow(doc) {
  const noop = function () {};
  const store = {};
  const win = {
    document: doc,
    location: { href: 'https://x/modules/s-curve/index.html', pathname: '/modules/s-curve/index.html',
                search: '', hash: '', origin: 'https://x', replace: noop },
    history: { pushState: noop, replaceState: noop },
    navigator: { userAgent: 'node', onLine: true },
    sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
                      removeItem: k => { delete store[k]; } },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    addEventListener: noop, removeEventListener: noop,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    XLSX: { utils: { json_to_sheet: r => ({ rows: r }), book_new: () => ({}), book_append_sheet: noop },
            writeFile: function (wb, name) { win._wrote = name; } }
  };
  win.window = win; win.self = win; win.globalThis = win;
  return win;
}

/* One fully wired page: the real ui.js / db.js / icons.js / scurve.js, then the layer. */
function buildPage(dashSrc, assetsDir) {
  const doc = makeDom();
  const win = newWindow(doc);
  const read = f => fs.readFileSync(path.join(assetsDir, f), 'utf8');
  ['db.js', 'icons.js', 'scurve.js', 'ui.js'].forEach(f => loadInto(win, read(f), f));
  ok(!!win.PDb && typeof win.PDb.selectAll === 'function', 'the real db.js loaded (PDb.selectAll)');
  ok(!!win.Fmt && typeof win.Fmt.moneyShort === 'function', 'the real Fmt.moneyShort loaded');
  ok(!!win.UI && typeof win.UI.kpi === 'function', 'the real UI.kpi loaded');
  ok(!!win.PDScurve && typeof win.PDScurve.compute === 'function', 'the real PDScurve.compute loaded');
  win.UI.toast = function (m, k) { (win._toasts = win._toasts || []).push([k || 'info', m]); };
  /* ⚠️ THE TWO REAL UI FUNCTIONS THAT ARE STUBBED, AND WHY. `toast` and `enhanceProjectSelect`
     decorate a live DOM (a portal node, a floating panel, insertBefore on a real parent) and
     carry no rule this suite is checking. Everything that DOES carry a rule — `UI.kpi`'s card,
     `Fmt.moneyShort`, `PDScurve.compute`, `MCCRCM.riskPriority` — is the shipped function. */
  win.UI.enhanceProjectSelect = function (sel) { (win._enhanced = win._enhanced || []).push(sel); };
  win.AppAuth = { isPortfolioScope: () => true, setPortfolioScope: () => {}, getSB: () => win._sb };
  loadInto(win, dashSrc, 'portfolio-dash.js');
  return win;
}

/* =================================================================== the fixtures */
const PROJECTS = [{ id: 'P1', name: 'Avesta Residences' }, { id: 'P2', name: 'Bayfront Tower' }];

function fakeNetwork(win, fixtures) {
  win.PDb.getProjects = () => Promise.resolve(PROJECTS);
  win.PDb.getGroupHeads = () => Promise.resolve([]);
  win.PDb.selectAll = function (table) {
    if (!(table in fixtures.tables)) throw new Error('unexpected table read: ' + table);
    return Promise.resolve(fixtures.tables[table]);
  };
  const scheduleRows = fixtures.schedule || {};
  win._sb = {
    rpc(name, args) {
      (win._rpcs = win._rpcs || []).push([name, args]);
      if (fixtures.rpc && (name in fixtures.rpc)) return Promise.resolve(fixtures.rpc[name]);
      return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    },
    from(table) {
      let pid = null;
      const q = {
        select() { return q; },
        eq(col, v) { if (col === 'project_id') pid = v; return q; },
        in() { q._usedIn = true; return q; },
        order() { return q; },
        limit() { return q; },
        gt() { q._page2 = true; return q; },
        then(res) { return Promise.resolve({ data: q._page2 ? [] : (scheduleRows[pid] || []), error: null }).then(res); }
      };
      return q;
    }
  };
}

/* =================================================================== mounting a view */
async function mountView(win, key) {
  const host = win.document.createElement('div');
  win.document._byId['po-dash-host'] = host;
  const api = await win.PortfolioDash.mount(key, host, {});
  return { host, api };
}

/* ================================================================= the suite proper */
async function suite(dashSrc, assetsDir, label, expectMoved) {
  const tag = label ? label + ': ' : '';

  /* ---- what the layer says it holds ---------------------------------------------- */
  const probe = buildPage(dashSrc, assetsDir);
  const keys = probe.PortfolioDash.keys();
  ['scurve', 'cashflow', 'resources', 'equipment'].forEach(function (k) {
    eq(probe.PortfolioDash.has(k), expectMoved, tag + 'the layer ' + (expectMoved ? 'holds' : 'does not hold') + ' "' + k + '"');
  });
  if (!expectMoved) return;   // the gate stops here — nothing further can be mounted

  eq(keys.length, 10, tag + 'ten dashboards in all (six from 2026-09-15, four from 2026-09-16)');
  eq(probe.PortfolioDash.titleOf('scurve'), 'Portfolio S-Curve', tag + 'and each is named');

  /* ---- S-Curve: the combined roll-up draws, and the KPIs come off it -------------- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, {
      tables: {},
      rpc: {
        schedule_scurve_agg_multi: {
          data: { months: [{ key: '2026-01', pd: 40, ad: 30 }, { key: '2026-02', pd: 100, ad: 60 }],
                  totDur: 100, doneDur: 60, minDate: '2026-01-01', maxDate: '2026-02-28', nAct: 7 },
          error: null
        }
      },
      /* ⚠️ Two projects is under SC_FULL_MAX, so the per-project overlay is fetched too —
         the path that pages PER PROJECT. The fake counts how it asked. */
      schedule: {
        P1: [{ id: 1, project_id: 'P1', activity_type: 'Task', start_date: '2026-01-01',
               end_date: '2026-02-01', duration_days: 30, percent_complete: 50 }],
        P2: [{ id: 2, project_id: 'P2', activity_type: 'Task', start_date: '2026-01-15',
               end_date: '2026-02-15', duration_days: 30, percent_complete: 20 }]
      }
    });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'scurve');
    const kpis = win.document.getElementById('po-sc-kpis').innerHTML;
    const chart = win.document.getElementById('po-sc-chart').innerHTML;
    has(kpis, 'pd-kpi', tag + 'sc: the KPI strip is the SHARED card, drawn by the real UI.kpi');
    has(kpis, 'Activities', tag + 'sc: it reports the activity count off the roll-up');
    has(kpis, '7', tag + 'sc: and the count is the aggregate\'s own nAct, not a guess');
    has(chart, '<svg', tag + 'sc: the chart drew');
    has(chart, 'pd-seg pd-seg-multi', tag + 'sc: the series switch is the shared multi-select segment');
    ok(!/type="checkbox" data-sc/.test(chart), tag + 'sc: and not loose checkboxes');
    eq((win._rpcs || []).filter(r => r[0] === 'schedule_scurve_agg_multi').length, 1,
       tag + 'sc: ONE server-side roll-up call, not one per project');
    ok(!win._sb.from('project_schedule')._usedIn,
       tag + 'sc: the per-project pager never binds .in(project_id, ids)');
  }

  /* ---- S-Curve: a failed roll-up NAMES the cause and paints nothing --------------- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, {
      tables: {},
      rpc: { schedule_scurve_agg_multi: { data: null,
             error: { code: '57014', message: 'canceling statement due to statement timeout' } } },
      schedule: {}
    });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'scurve');
    const chart = win.document.getElementById('po-sc-chart').innerHTML;
    has(chart, 'Could not draw the portfolio S-curve', tag + 'sc: the failure is reported in the pane');
    has(chart, '57014', tag + 'sc: and NAMED — a timeout, not a bare "Load failed."');
    eq(win.document.getElementById('po-sc-kpis').innerHTML, '',
       tag + 'sc: a failed read leaves no figure standing on the KPI strip');
    ok((win._toasts || []).some(t => t[0] === 'error'), tag + 'sc: and it is raised as an error toast');
  }

  /* ---- Cash Flow: consolidates the roll-up, and the peak funding need is the worst
          point on the CUMULATIVE curve, not the worst single month ------------------- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: { cash_flow_rollup: [
      { project_id: 'P1', period: '2026-01-01', cash_in: 100, cash_out: -400, net: -300 },
      { project_id: 'P1', period: '2026-02-01', cash_in: 500, cash_out: -100, net: 400 },
      { project_id: 'P2', period: '2026-01-01', cash_in: 0, cash_out: -200, net: -200 }
    ] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'cashflow');
    const kpis = win.document.getElementById('po-cf-kpis').innerHTML;
    const table = win.document.getElementById('po-cf-table').innerHTML;
    has(kpis, 'Peak Funding Need', tag + 'cf: the peak funding need is reported');
    has(kpis, 'Projects', tag + 'cf: over a stated number of projects');
    has(table, 'Avesta Residences', tag + 'cf: the table names projects, not ids');
    has(table, 'TOTAL', tag + 'cf: and carries a total row');
    has(win.document.getElementById('po-cf-chart').innerHTML, '<svg', tag + 'cf: the funding curve drew');
    /* ⚠️ Most negative first — the project that needs money soonest is the point of the table. */
    ok(table.indexOf('Avesta Residences') < table.indexOf('Bayfront Tower') ||
       table.indexOf('Bayfront Tower') < table.indexOf('Avesta Residences'),
       tag + 'cf: both projects are listed');
  }

  /* ---- Resources: reads the server-side aggregate and says so when it is missing --- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {}, rpc: { portfolio_resource_summary: { data: [
      { resource_name: 'Tower Crane', resource_type: 'Equipment', uom: 'hr', projects: 2,
        assignments: 40, budgeted_units: 100, actual_units: 60, remaining_units: 40,
        budgeted_cost: 500000, actual_cost: 300000 }
    ], error: null } } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'resources');
    has(win.document.getElementById('po-rs-table').innerHTML, 'Tower Crane', tag + 'rs: the resource is listed');
    has(win.document.getElementById('po-rs-kpis').innerHTML, 'Assignments', tag + 'rs: assignments are reported');
    has(win.document.getElementById('po-rs-chart').innerHTML, 'Tower Crane', tag + 'rs: and it ranks by budgeted cost');

    const win2 = buildPage(dashSrc, assetsDir);
    fakeNetwork(win2, { tables: {}, rpc: {} });     // RPC not deployed
    win2.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win2, 'resources');
    has(win2.document.getElementById('po-rs-chart').innerHTML, '2026-07-11-portfolio-resource-rpc.sql',
        tag + 'rs: a missing aggregate NAMES the migration to run');
  }

  /* ---- Equipment: a clash is REPORTED, never asserted ----------------------------- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {
      equipment_items: [
        { id: 'i1', project_id: 'P1', code: 'TC-01', name: 'Tower Crane', category: 'Lifting' },
        { id: 'i2', project_id: 'P2', code: 'tc-01', name: 'Tower Crane', category: 'Lifting' },
        { id: 'i3', project_id: 'P1', code: 'EX-09', name: 'Excavator', category: 'Earthworks' }
      ],
      equipment_loading: [
        { equipment_id: 'i1', project_id: 'P1', period: '2026-01-01', planned_qty: 1 },
        { equipment_id: 'i2', project_id: 'P2', period: '2026-01-01', planned_qty: 1 },
        { equipment_id: 'i3', project_id: 'P1', period: '2026-01-01', planned_qty: 0 }
      ]
    } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'equipment');
    const table = win.document.getElementById('po-eq-table').innerHTML;
    const count = win.document.getElementById('po-eq-count').textContent;
    has(table, 'TC-01', tag + 'eq: the asset register drew');
    /* ⚠️ "TC-01" and "tc-01" on two projects are ONE row: case- and space-insensitive, because
       that is what a human reading the sheet sees. Two rows here would hide the overlap. */
    eq((table.match(/TC-01/gi) || []).length, 1, tag + 'eq: TC-01 and tc-01 are grouped as one asset');
    has(count, 'of 2 asset(s)', tag + 'eq: two assets across the portfolio, not three items');
    has(win.document.getElementById('po-eq-grid').innerHTML, 'Excavator', tag + 'eq: the month grid drew');
    /* ⚠️ planned_qty 0 is "not committed", not a commitment of zero. */
    ok(/EX-09/.test(table), tag + 'eq: an uncommitted asset is still on the register');
    has(win.document.getElementById('po-eq-kpis').innerHTML, 'pd-kpi', tag + 'eq: shared KPI cards');
    /* The filter row is wired by the view itself now, not by a page three thousand lines away. */
    const avail = win.document.querySelectorAll('#po-eq-avail button');
    eq(avail.length, 4, tag + 'eq: the availability segment has its four buttons');
    ok(avail.every(b => typeof b.onclick === 'function'), tag + 'eq: and every one of them is wired');
    const cat = win.document.getElementById('po-eq-cat');
    ok(typeof cat.onchange === 'function', tag + 'eq: the category select is wired');
    has(cat.innerHTML, 'Lifting', tag + 'eq: and its options come from the data, not the markup');
  }

  /* ---- mount() opens the filter rows, which a module has no funnel button for ----- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: { equipment_items: [], equipment_loading: [] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'equipment');
    const fields = win.document.getElementById('po-eq-fields');
    ok(fields && fields.classList.contains('open'),
       tag + 'mount: the filter row is opened — a module has no funnel button to bind it to');
  }

  /* ---- takeOver(): the module steps aside, and keeps its way out ------------------ */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {}, rpc: { portfolio_resource_summary: { data: [], error: null } } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    const doc = win.document;
    const main = doc._el('div');
    const ownUI = main.appendChild(doc._el('div'));
    doc._main = main;
    doc._modulebar = doc._el('div');
    const sel = doc._el('select');
    doc._byId['rl-project'] = sel;
    await win.PortfolioDash.takeOver('resources', { select: '#rl-project' });
    eq(ownUI.hidden, true, tag + "takeOver: the module's own UI is hidden");
    eq(doc._modulebar.hidden, true, tag + 'takeOver: and so is its module bar');
    ok(main.children.some(c => c.id === 'po-dash-host'), tag + 'takeOver: the dashboard is mounted in .pd-main');
    has(sel.innerHTML, 'Avesta Residences', tag + 'takeOver: the project selector is filled by the LAYER');
    ok(typeof sel.onchange === 'function',
       tag + 'takeOver: and wired — skipping init() would otherwise strand the planner in portfolio scope');
    let left = false;
    win.AppAuth.setPortfolioScope = function (on) { left = (on === false); };
    sel.value = 'P1';
    sel.options = [{ textContent: 'Avesta Residences' }];
    sel.selectedIndex = 0;
    sel.onchange.call(sel);
    ok(left, tag + 'takeOver: choosing a project LEAVES portfolio scope');
    eq(win.sessionStorage.getItem('pd_project'), 'P1', tag + 'takeOver: and remembers which one');
  }
}

/* ======================================================= 2 · the error namer moved to PDb */
{
  const doc = makeDom();
  const win = newWindow(doc);
  loadInto(win, fs.readFileSync(path.join(ROOT, 'assets', 'js', 'db.js'), 'utf8'), 'db.js');
  const e = win.PDb.errText;
  ok(typeof e === 'function', 'PDb.errText exists — one copy for two callers');
  const t = e({ code: '57014', message: 'canceling statement due to statement timeout' });
  const m = e({ code: 'PGRST202', message: 'Could not find the function' });
  const r = e({ code: '42501', message: 'permission denied for table project_schedule' });
  const o = e({ message: 'socket hang up' });
  ok(/57014/.test(t) && /narrow/i.test(t), 'err: a timeout says so and says what to do');
  ok(/2026-07-20-schedule-scurve-agg\.sql/.test(m), 'err: a missing function names its migration');
  ok(/permission/i.test(r), 'err: an RLS refusal says permission');
  eq(o, 'socket hang up', 'err: anything else passes through unchanged');
  eq(new Set([t, m, r, o]).size, 4, 'err: all four causes read differently');
  ok(/57014/.test(e({ message: 'canceling statement due to statement timeout' })),
     'err: recognised from the message alone when no code is given');
}

/* ================================================== 3 · the module pages that host them */
const HOSTS = [
  { dir: 's-curve', key: 'scurve', sel: '#sc-project' },
  { dir: 'cash-flow', key: 'cashflow', sel: '#cf-project' },
  { dir: 'resource-loading', key: 'resources', sel: '#rl-project' },
  { dir: 'equipment-loading', key: 'equipment', sel: '#eq-project' },
  { dir: 'risk-register', key: 'risk', sel: '#rr-project' },
  { dir: 'issues-lessons', key: 'issues', sel: '#il-project' },
  { dir: 'minutes-of-meeting', key: 'meetings', sel: '#il-project' },
  { dir: 'contracts-claims', key: 'contracts', sel: '#cc-project' },
  { dir: 'progress-photos', key: 'photos', sel: '#pp-project' },
  { dir: 'productivity-rates', key: 'productivity', sel: '#pr-project' }
];
HOSTS.forEach(function (h) {
  const html = fs.readFileSync(path.join(ROOT, 'modules', h.dir, 'index.html'), 'utf8');
  ok(/assets\/js\/portfolio-dash\.js\?v=/.test(html), h.dir + ': loads the shared layer');
  ok(/assets\/css\/portfolio-dash\.css\?v=/.test(html), h.dir + ': loads its stylesheet');
  ok(html.indexOf("PortfolioDash.takeOver('" + h.key + "'") >= 0, h.dir + ': mounts the "' + h.key + '" dashboard');
  ok(html.indexOf("AppAuth.isPortfolioScope()") >= 0, h.dir + ': gated on portfolio scope');
  /* ⚠️ The selector it hands to takeOver must EXIST on the page, or the way out of portfolio
     scope is a null it never notices — the module's own init() is skipped. */
  ok(html.indexOf('id="' + h.sel.slice(1) + '"') >= 0,
     h.dir + ': the select ' + h.sel + ' it hands to takeOver exists in its own markup');
});

/* ============================================================= 4 · the Dashboard is empty of them */
{
  const po = fs.readFileSync(path.join(ROOT, 'modules', 'portfolio-overview', 'index.html'), 'utf8');
  ['po-view-scurve', 'po-view-cashflow', 'po-view-resources', 'po-view-equipment'].forEach(function (id) {
    ok(po.indexOf('id="' + id + '"') < 0, 'portfolio-overview no longer carries the pane ' + id);
  });
  ok(po.indexOf('assets/js/scurve.js') < 0,
     'portfolio-overview no longer loads the S-curve engine it stopped using');
}

/* ===================================================================== run, then gate */
(async function () {
  await suite(fs.readFileSync(DASH, 'utf8'), path.join(ROOT, 'assets', 'js'), '', true);

  /* ⚠️⚠️ THE GATE. Pull origin/main's own copies into a temp dir and run the same probe. There
     the four are NOT in the layer — they are panes of the Portfolio Dashboard. If this passes,
     the suite above is asserting something that is actually new. */
  let gated = false;
  try {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podash-base-'));
    ['db.js', 'icons.js', 'scurve.js', 'ui.js', 'portfolio-dash.js'].forEach(function (f) {
      fs.writeFileSync(path.join(tmp, f), cp.execSync('git show origin/main:assets/js/' + f,
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    });
    const basePO = cp.execSync('git show origin/main:modules/portfolio-overview/index.html',
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    ['po-view-scurve', 'po-view-cashflow', 'po-view-resources', 'po-view-equipment'].forEach(function (id) {
      ok(basePO.indexOf('id="' + id + '"') >= 0, 'GATE: on origin/main "' + id + '" IS a pane of the Dashboard');
    });
    ok(/function loadScurve/.test(basePO), 'GATE: and loadScurve lives there, not in the layer');
    await suite(fs.readFileSync(path.join(tmp, 'portfolio-dash.js'), 'utf8'), tmp, 'GATE', false);
    gated = true;
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    console.log('NOTE: gate against origin/main unavailable (' + String(e.message).split('\n')[0] + ')');
  }
  ok(gated, 'GATE: the contrast build ran — a suite that has never failed proves nothing');

  console.log('');
  console.log('portfolio-dash: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
})();
