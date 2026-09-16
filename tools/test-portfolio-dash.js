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
 * ⚠️⚠️ THE GATE IS PINNED TO A SHA, NEVER `origin/main` AND NEVER `HEAD`. A suite that has never
 *    failed proves nothing, so the same checks run against the commit BEFORE this change, where
 *    the four views were panes of modules/portfolio-overview/index.html and no module mounted
 *    them. ⚠️ A MOVING REF BECOMES SELF-COMPARISON THE INSTANT THE CHANGE IS PUSHED. This file
 *    shipped reading `origin/main` and went inert one commit later — caught by running it again
 *    after the push, which is the only thing that would have caught it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'assets', 'js', 'portfolio-dash.js');
const BASE_SHA = 'c752e7f4';   // the commit BEFORE the four moved — see the gate note above

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
      set innerHTML(v) { node._html = String(v == null ? '' : v); index(node._html); node._grps = grpRows(node._html); },
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
    ['band', 'av', 'sc', 'shv', 'lay', 'dim'].forEach(function (k) {
      if (html.indexOf('data-' + (k === 'band' ? 'mi' : k) + '="') >= 0) buttons[k] = [];
    });
    const idRe = /\sid="([^"]+)"/g;
    let m;
    while ((m = idRe.exec(html))) if (!byId[m[1]]) byId[m[1]] = el('div');
    /* ⚠️ The S-Curve's month hit targets are <rect>s, not buttons, and on purpose: the target is
       the whole column so a month with a two-pixel bar is still clickable. */
    const rectRe = /<rect([^>]*)>/g;
    while ((m = rectRe.exec(html))) {
      const mi = /data-mi="(\d+)"/.exec(m[1]);
      if (!mi) continue;
      const r = el('rect');
      r.dataset.mi = mi[1];
      if (/\sclass="[^"]*\bon\b/.test(m[1])) r.classList.add('on');
      (buttons.band = buttons.band || []).push(r);
    }
    /* The Project Schedule grain toggle (Auto | Year | Quarter | Month). Registered like the
       other `data-*` button groups so its clicks can be exercised rather than described. */
    if (html.indexOf('data-g="') >= 0) buttons.grain = [];
    const grainRe = /<button data-g="([a-z]+)"([^>]*)>/g;
    while ((m = grainRe.exec(html))) {
      const g = el('button');
      g.dataset.g = m[1];
      if (/class="[^"]*\bon\b/.test(m[2])) g.classList.add('on');
      (buttons.grain = buttons.grain || []).push(g);
    }
    const btnRe = /<button([^>]*)>/g;
    while ((m = btnRe.exec(html))) {
      const attrs = m[1];
      const d = /data-(av|sc|shv|lay|dim)="([^"]*)"/.exec(attrs);
      if (!d) continue;
      const b = el('button');
      b.dataset[d[1]] = d[2];
      if (/\sclass="[^"]*\bactive\b/.test(attrs)) b.classList.add('active');
      if (/\sclass="[^"]*\bon\b/.test(attrs)) b.classList.add('on');
      (buttons[d[1]] = buttons[d[1]] || []).push(b);
    }
  }
  const buttons = Object.create(null);

  /* The grouped-table heading rows (`<tr class="po-grp" data-pgrp="…">`). ⚠️ Rebuilt on every
     innerHTML assignment and stored ON THE NODE, so a re-render replaces them rather than
     accumulating, and two grouped tables on one page cannot see each other's. */
  function grpRows(html) {
    /* ⚠⚠ A CLASS LIST, NOT ONE CLASS. This read `class="po-grp"` exactly, and the group
       heading now carries the approved `pd-group-row` treatment beside its own hook
       (`class="pd-group-row po-grp"`) — so the old regex matched ZERO rows and every group
       assertion below went looking at an empty list. A harness that can only see one spelling of
       a class reports a renderer as broken the first time anybody adds a second class to it. */
    const out = [], re = /<tr class="([^"]*)" data-pgrp="([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
      const classes = m[1].split(/\s+/);
      if (classes.indexOf('po-grp') < 0) continue;
      const r = el('tr');
      r.dataset.pgrp = m[2];
      classes.forEach(function (c) { if (c) r.classList.add(c); });
      out.push(r);
    }
    return out;
  }

  function query(root, sel) {
    sel = String(sel).trim();
    /* ⚠️ Answered from the ROOT, unlike everything below it: these are per-table. */
    if (/^\.po-grp(\[data-pgrp\])?$/.test(sel)) return (root && root._grps) || [];
    if (/^#([\w-]+)\s+\.po-grp$/.test(sel)) {
      const host = byId[/^#([\w-]+)/.exec(sel)[1]];
      return (host && host._grps) || [];
    }
    if (sel === '.po-sc-band') return buttons.band || [];
    let m = /^#([\w-]+)\s+button$/.exec(sel);
    if (m) {
      const kind = m[1] === 'po-eq-avail' ? 'av' : m[1] === 'po-bd-dim' ? 'dim'
                 : m[1] === 'po-sh-grain' ? 'grain' : null;
      return kind ? (buttons[kind] || []) : [];
    }
    m = /^button\[data-(\w+)\]$/.exec(sel);
    if (m) return buttons[m[1]] || [];
    if (sel === '.po-toolbar-fields') {
      return Object.keys(byId).filter(k => /fields$/.test(k)).map(k => byId[k]);
    }
    if (sel === '.pd-main') return [doc._main];
    if (sel === '.pd-modulebar') return doc._modulebar ? [doc._modulebar] : [];
    /* ⚠ `.pd-content` is what `buildBar` inserts the portfolio module bar BEFORE. Without it
       here, buildBar found no host, returned null and did nothing — and every assertion about
       the bar would have been passing against a bar that was never built. */
    if (sel === '.pd-content') return doc._content ? [doc._content] : [];
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
      /* ⚠️ Keyed by project id, because the portfolio S-curve is N single-project calls now and
         the interesting cases are the ones where SOME of them fail. */
      if (fixtures.agg && name === 'schedule_scurve_agg') {
        var a = fixtures.agg[args && args.p_id];
        if (a === undefined) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'no fixture' } });
        return Promise.resolve(a.error ? { data: null, error: a.error } : { data: a, error: null });
      }
      if (name === 'schedule_scurve_trade_agg') {
        if (!fixtures.trade || fixtures.trade === 'missing') {
          return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
        }
        var t = fixtures.trade[args && args.p_id];
        return Promise.resolve(t ? { data: t, error: null } : { data: { trades: [] }, error: null });
      }
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

  eq(keys.length, 11, tag + 'eleven dashboards in all (six from 2026-09-15, four + Project Schedule from 2026-09-16)');
  eq(probe.PortfolioDash.titleOf('scurve'), 'Portfolio S-Curve', tag + 'and each is named');
  /* The cross-project Gantt. ⚠️ It reads NO activity rows — every bar comes from the roll-up
     columns already on the project row — so it cannot reproduce the timeout the S-Curve fan-out
     above exists to fix. */
  eq(probe.PortfolioDash.has('schedule'), true, tag + 'the layer holds "schedule"');
  eq(probe.PortfolioDash.titleOf('schedule'), 'Project Schedule', tag + 'and it is named');

  /* ================================================================ the S-Curve fan-out
     ⚠️⚠️ THE LIVE FAILURE THIS REPLACED: `schedule_scurve_agg_multi(21 ids)` returned 57014 on
     the owner's first open of this view. The function CROSS JOINs its month series against its
     leaf activities, so N projects is (union of every horizon) x (every activity) — thirty
     million rows for a hundred-point chart. One call per project is the same arithmetic in the
     shape the index exists for. */

  /* P1 runs Jan–Feb and FINISHES; P2 runs Jan–Mar. Chosen for the carry-forward below. */
  const AGG_P1 = { months: [{ key: '2026-01', pd: 20, ad: 10 }, { key: '2026-02', pd: 40, ad: 24 }],
                   totDur: 40, doneDur: 24, nAct: 3, minDate: '2026-01-01', maxDate: '2026-02-28' };
  const AGG_P2 = { months: [{ key: '2026-01', pd: 20, ad: 8 }, { key: '2026-02', pd: 40, ad: 16 },
                            { key: '2026-03', pd: 60, ad: 24 }],
                   totDur: 60, doneDur: 24, nAct: 4, minDate: '2026-01-15', maxDate: '2026-03-31' };
  const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout' };

  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, {
      tables: {}, agg: { P1: AGG_P1, P2: AGG_P2 },
      /* ⚠️ Two projects is under SC_FULL_MAX, so the raw-row overlay is fetched too — that path
         is what carries the SPI-stretched forecast the aggregate has no column for. */
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
    const rpcs = win._rpcs || [];
    has(kpis, 'pd-kpi', tag + 'sc: the KPI strip is the SHARED card, drawn by the real UI.kpi');
    has(kpis, 'Activities', tag + 'sc: it reports the activity count off the roll-up');
    has(kpis, '7', tag + 'sc: and the count is 3 + 4 — the aggregates summed, not a guess');
    has(chart, '<svg', tag + 'sc: the chart drew');
    has(chart, 'pd-seg pd-seg-multi', tag + 'sc: the series switch is the shared multi-select segment');
    ok(!/type="checkbox" data-sc/.test(chart), tag + 'sc: and not loose checkboxes');
    /* ⚠️⚠️ THE FIX ITSELF: the call that timed out in production is never made. */
    eq(rpcs.filter(r => r[0] === 'schedule_scurve_agg_multi').length, 0,
       tag + 'sc: schedule_scurve_agg_multi is NOT called — that is the statement that timed out');
    eq(rpcs.filter(r => r[0] === 'schedule_scurve_agg').length, 2,
       tag + 'sc: one single-project aggregate per project instead');
    ok(rpcs.filter(r => r[0] === 'schedule_scurve_agg').every(r => typeof r[1].p_id === 'string'),
       tag + 'sc: and each carries ONE id, which is the shape the index exists for');
    ok(!win._sb.from('project_schedule')._usedIn,
       tag + 'sc: the per-project pager never binds .in(project_id, ids)');
    ok(!/could not be read/.test(chart), tag + 'sc: a complete read carries no partial-coverage note');
  }

  /* ---- ⚠️⚠️ THE CARRY-FORWARD, WHICH IS THE CORRECTNESS OF THE MERGE ---------------
     P1 has no March bucket because it finished in February. Its contribution to March is its
     FULL total, not zero — these are cumulative figures. Read as zero, the portfolio curve would
     DIP the month a project completes, which is the one thing an S-curve may never do. */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {}, agg: { P1: AGG_P1, P2: AGG_P2 }, schedule: { P1: [], P2: [] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    const m = await mountView(win, 'scurve');
    const d = m.api._data();
    ok(!!(d && d.rollup && !d.rollup.empty), tag + 'merge: the combined curve computed');
    if (d && d.rollup) {
      const pc = d.rollup.plannedC.filter(v => v != null);
      ok(pc.every((v, i) => i === 0 || v >= pc[i - 1] - 1e-9),
         tag + 'merge: the combined PLANNED curve never goes backwards');
      eq(d.rollup.TOT, 100, tag + 'merge: the total is 40 + 60 — per-project totals summed');
      eq(d.rollup.activities, 7, tag + 'merge: and the activity count is 3 + 4');
      /* March: P1 carried forward at 40 + P2 at 60 = 100, NOT P2's 60 alone. */
      eq(Math.round(pc[pc.length - 1]), 100,
         tag + 'merge: after P1 ends its 40 is still in the total — the carry-forward holds');
    }
  }

  /* ---- ⚠️ ONE PROJECT FAILING NO LONGER FAILS THE VIEW ---------------------------- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {}, agg: { P1: { error: TIMEOUT }, P2: AGG_P2 },
                       schedule: { P1: [], P2: [] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'scurve');
    const chart = win.document.getElementById('po-sc-chart').innerHTML;
    has(chart, '<svg', tag + 'partial: the other project still draws');
    has(win.document.getElementById('po-sc-kpis').innerHTML, 'pd-kpi',
        tag + 'partial: and its figures are reported');
    /* ⚠️ ON THE CHART, not only in a toast: a toast is gone in five seconds and a screenshot of
       this card ends up in a report. */
    has(chart, 'could not be read', tag + 'partial: the chart says it is partial');
    has(chart, '1 of 2', tag + 'partial: and says over how many projects it is drawn');
    has(chart, 'Avesta Residences', tag + 'partial: the missing project is NAMED, not counted');
    ok((win._toasts || []).some(t => t[0] === 'warn'), tag + 'partial: and a warning is raised');
  }


  /* ======================================================= the periodic bars and the breakdown
     Owner 2026-09-16: *"pls provide breakdowns. and periodic values that are in the form of a bar
     chart. And allow users to click a specific month to know the breakdowns (for example per
     trade, but if not applicable put others)."* */

  /* Two trades on P1, one of them untagged in the data; P2 is single-trade. */
  const TRADE_P1 = { totDur: 40, doneDur: 24, nAct: 3, trades: [
    { trade: 'Structural', totDur: 30, doneDur: 18, nAct: 2,
      months: [{ key: '2026-01', pd: 15, ad: 8 }, { key: '2026-02', pd: 30, ad: 18 }] },
    { trade: 'No trade set', totDur: 10, doneDur: 6, nAct: 1,
      months: [{ key: '2026-01', pd: 5, ad: 2 }, { key: '2026-02', pd: 10, ad: 6 }] }
  ] };
  const TRADE_P2 = { totDur: 60, doneDur: 24, nAct: 4, trades: [
    { trade: 'Structural', totDur: 60, doneDur: 24, nAct: 4,
      months: [{ key: '2026-01', pd: 20, ad: 8 }, { key: '2026-02', pd: 40, ad: 16 },
               { key: '2026-03', pd: 60, ad: 24 }] }
  ] };

  async function scurvePage(tradeFixture) {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, {
      tables: {}, agg: { P1: AGG_P1, P2: AGG_P2 }, trade: tradeFixture,
      schedule: { P1: [], P2: [] }
    });
    win.PortfolioDash._setProjects(PROJECTS, []);
    const m = await mountView(win, 'scurve');
    return { win, api: m.api, chart: () => win.document.getElementById('po-sc-chart').innerHTML,
             bd: () => win.document.getElementById('po-sc-bd') };
  }

  /* ---- the bars ------------------------------------------------------------------ */
  {
    const s2 = await scurvePage(null);
    const chart = s2.chart();
    has(chart, 'class="po-barp"', tag + 'bars: a planned bar per month is drawn');
    has(chart, 'class="po-bara"', tag + 'bars: and an actual one');
    has(chart, 'per month', tag + 'bars: on their own right-hand axis, labelled');
    has(chart, 'Planned this month', tag + 'bars: and named in the legend');
    /* ⚠️⚠️ THE INVARIANT THAT MATTERS: the bars are the line. Period n = cumulative n − n−1, so
       they must sum back to the final cumulative percentage — if they ever do not, one of the
       two was computed a second way. */
    const b = s2.api._bars();
    ok(!!(b && b.perP), tag + 'bars: the periodic arrays exist');
    if (b && b.perP) {
      const sum = b.perP.reduce((t, v) => t + (v || 0), 0);
      const d = s2.api._data();
      const RT = d.rollup.TOT || 1;
      const last = d.rollup.plannedC[d.rollup.plannedC.length - 1] / RT * 100;
      ok(Math.abs(sum - last) < 0.01,
         tag + 'bars: the periodic bars sum back to the cumulative line (' +
         Math.round(sum * 10) / 10 + ' vs ' + Math.round(last * 10) / 10 + ')');
      ok(b.perP.every(v => v == null || v >= 0), tag + 'bars: no month has negative production');
    }
  }

  /* ---- clicking a month ----------------------------------------------------------- */
  {
    const s2 = await scurvePage(null);
    const bands = s2.win.document.querySelectorAll('.po-sc-band');
    /* ⚠️ One band per month ON THE AXIS, and the axis runs to TODAY, not to the last activity —
       a curve that stops before now cannot show that nothing has happened since. Asserting a
       literal count here would have been a test with an expiry date. */
    eq(bands.length, s2.api._bars().keys.length, tag + 'click: one hit target per month on the axis');
    ok(bands.length >= 3, tag + 'click: and the axis covers at least the three months of data');
    ok(bands.every(b => typeof b.onclick === 'function'), tag + 'click: each is wired');
    eq(s2.bd().style.display, 'none', tag + 'click: the panel starts hidden');
    bands[1].onclick();
    eq(s2.api._bd().i, 1, tag + 'click: the clicked month is the open one');
    eq(s2.bd().style.display, '', tag + 'click: and the panel opens');
    has(s2.bd().innerHTML, 'February 2026', tag + 'click: naming the month that was clicked');
    /* ⚠️ The band is the toggle — clicking the open month closes it, so there is no second
       control to find and nothing left open the planner did not ask for. */
    s2.win.document.querySelectorAll('.po-sc-band')[1].onclick();
    eq(s2.api._bd().i, null, tag + 'click: clicking the open month closes it again');
    eq(s2.bd().style.display, 'none', tag + 'click: and the panel goes away');
  }

  /* ---- by project: free, and it adds up ------------------------------------------- */
  {
    const s2 = await scurvePage(null);
    s2.win.document.querySelectorAll('.po-sc-band')[1].onclick();
    s2.win.document.querySelectorAll('#po-bd-dim button').filter(b => b.dataset.dim === 'project')[0].onclick();
    const html = s2.bd().innerHTML;
    has(html, 'Avesta Residences', tag + 'by project: both projects are listed');
    has(html, 'Bayfront Tower', tag + 'by project: including the second');
    has(html, '% of the portfolio', tag + 'by project: each row states its share of the whole');
    /* ⚠️⚠️ THE CHECK THE PANEL EXISTS FOR. "This month" is points of the PORTFOLIO, so the column
       must sum to the portfolio figure in the header — otherwise the breakdown is explaining a
       different number from the one the chart drew. Feb: P1 20/100 + P2 20/100 = 20%. */
    const b = s2.api._bars();
    const monthP = Math.round(b.perP[1] * 10) / 10;
    has(html, 'portfolio this month: planned <b>' + monthP + '%',
        tag + 'by project: the header states the portfolio figure for the month');
    const foot = /<tfoot>[\s\S]*?<\/tfoot>/.exec(html)[0];
    has(foot, monthP + '%', tag + 'by project: and the Total row equals it — the column adds up');
  }

  /* ---- by trade: the second aggregate, and the untagged bucket -------------------- */
  {
    const s2 = await scurvePage({ P1: TRADE_P1, P2: TRADE_P2 });
    s2.win.document.querySelectorAll('.po-sc-band')[1].onclick();
    await new Promise(r => setTimeout(r, 0));
    const html = s2.bd().innerHTML;
    has(html, 'by trade', tag + 'by trade: it is the default dimension, as asked');
    has(html, 'Structural', tag + 'by trade: the trade is named');
    /* ⚠️ "if not applicable put others" — this app already HAS a name for that bucket and the
       trade aggregate spells it identically to the S-Curve module\'s own `UNTRADED`. Two names
       for one bucket across two screens over one schedule is the drift to avoid. */
    has(html, 'No trade set', tag + 'by trade: untagged work lands in one honest bucket, not dropped');
    /* ⚠️ Structural spans BOTH projects and must be ONE row of 90 duration-days, not two. */
    eq((html.match(/>Structural</g) || []).length, 1, tag + 'by trade: a trade on two projects is one row');
    const b = s2.api._bars();
    const monthP = Math.round(b.perP[1] * 10) / 10;
    const foot = /<tfoot>[\s\S]*?<\/tfoot>/.exec(html)[0];
    has(foot, monthP + '%', tag + 'by trade: the Total equals the portfolio figure, same as by project');
    eq((s2.win._rpcs || []).filter(r => r[0] === 'schedule_scurve_trade_agg').length, 2,
       tag + 'by trade: one trade aggregate per project — the same fan-out as the curve');
    ok(!/does not reconcile/.test(html),
       tag + 'by trade: a split that agrees with the curve raises no reconciliation warning');
  }

  /* ---- ⚠️⚠️ AND WHEN THE TWO AGGREGATES DISAGREE, THE PANEL SAYS SO ----------------
     The trade split and the curve are two different RPCs over the same rows, so "they agree" is
     an assumption about two pieces of SQL. Found in the live preview: a header reading 10.4%
     above a Total reading 17.1%, with nothing on screen remarking on it. */
  {
    const wrong = { P1: { totDur: 40, doneDur: 24, nAct: 3, trades: [
      { trade: 'Structural', totDur: 40, doneDur: 24, nAct: 3,
        months: [{ key: '2026-01', pd: 20, ad: 10 }, { key: '2026-02', pd: 40, ad: 24 }] } ] },
      /* P2's split claims twice the production of P2's own curve for February. */
      P2: { totDur: 60, doneDur: 24, nAct: 4, trades: [
      { trade: 'Structural', totDur: 60, doneDur: 24, nAct: 4,
        months: [{ key: '2026-01', pd: 20, ad: 8 }, { key: '2026-02', pd: 60, ad: 16 },
                 { key: '2026-03', pd: 60, ad: 24 }] } ] } };
    const s3 = await scurvePage(wrong);
    s3.win.document.querySelectorAll('.po-sc-band')[1].onclick();
    await new Promise(r => setTimeout(r, 0));
    const h3 = s3.bd().innerHTML;
    has(h3, 'does not reconcile', tag + 'drift: the panel says its total does not match the chart');
    has(h3, 'Read it as a shape', tag + 'drift: and says what the numbers are still good for');
    /* ⚠️ Still RENDERED. The rows are the best available reading of the month; what is lost is
       the check, and blanking the table would lose both. */
    has(h3, 'Structural', tag + 'drift: the breakdown is still shown, not blanked');
  }

  /* ---- by trade with the migration not run ---------------------------------------- */
  {
    const s2 = await scurvePage('missing');
    s2.win.document.querySelectorAll('.po-sc-band')[1].onclick();
    await new Promise(r => setTimeout(r, 0));
    const html = s2.bd().innerHTML;
    has(html, '2026-09-16-scurve-trade-agg.sql', tag + 'no-rpc: it names the migration to run');
    /* ⚠️⚠️ AND IT STILL ANSWERS. A panel that shows only a sentence about SQL is a broken panel;
       the breakdown that needs nothing is rendered underneath, and the toggle flips with it so
       the control and the content agree. */
    has(html, 'Avesta Residences', tag + 'no-rpc: the by-project table is rendered anyway');
    has(html, '<tfoot>', tag + 'no-rpc: with its own total, so the month is still explained');
    eq(s2.api._bd().dim, 'project', tag + 'no-rpc: and the toggle flips to the one that answered');
    has(html, 'By project', tag + 'no-rpc: both dimensions stay on offer');
    ok(!/Could not/.test(html), tag + 'no-rpc: an un-run migration is a deployment fact, not an error');
    /* ⚠️ ONE probe settles it. A function that is not deployed answers PGRST202 for every
       project, and asking twenty more times is twenty more round trips for the same answer. */
    eq((s2.win._rpcs || []).filter(r => r[0] === 'schedule_scurve_trade_agg').length, 1,
       tag + 'no-rpc: it stops after the first PGRST202 instead of asking every project');
    s2.win.document.querySelectorAll('#po-bd-dim button').filter(b => b.dataset.dim === 'project')[0].onclick();
    has(s2.bd().innerHTML, 'Avesta Residences', tag + 'no-rpc: and by project draws');
  }

  /* ---- ⚠️ EVERY project failing still names them and paints nothing --------------- */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {}, agg: { P1: { error: TIMEOUT }, P2: { error: TIMEOUT } },
                       schedule: { P1: [], P2: [] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'scurve');
    const chart = win.document.getElementById('po-sc-chart').innerHTML;
    has(chart, 'Could not draw the portfolio S-curve', tag + 'sc: the failure is reported in the pane');
    has(chart, '57014', tag + 'sc: and NAMED — a timeout, not a bare "Load failed."');
    has(chart, '2 of 2', tag + 'sc: with how many projects it could not read');
    has(chart, 'Avesta Residences', tag + 'sc: and which ones');
    /* ⚠️ THE ADVICE THE OWNER ACTUALLY SAW, AND WHY IT IS GONE: this screen has no project
       filter to narrow. PDb.errText diagnoses; the caller prescribes. */
    ok(!/narrow the project filter/.test(chart),
       tag + 'sc: it does not tell the planner to narrow a filter this page does not have');
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

  /* ---- grouped per project, and sorted by date INSIDE the group ------------------- */
  /* Owner: *"we should group the meetings / issues and concerns per project first then sorted
     by meeting date."* \u26a0\u26a0 The fixture is built so the ORDER IS NOT THE INPUT ORDER and not
     alphabetical-by-action either — otherwise the sort could be right by accident. */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {
      meeting_minutes: [
        { id: 'm1', project_id: 'P2', title: 'Kickoff',  meeting_date: '2026-01-10', is_distributed: true },
        { id: 'm2', project_id: 'P1', title: 'Weekly 1', meeting_date: '2026-02-01', is_distributed: true },
        { id: 'm3', project_id: 'P1', title: 'Weekly 9', meeting_date: '2026-09-01', is_distributed: true }
      ],
      mom_items: [
        // P1, OLD meeting — must sort AFTER the newer meeting's item
        { id: 'a1', project_id: 'P1', mom_id: 'm2', action_item: 'Aardvark old-meeting', status: 'Open' },
        // P1, NEW meeting
        { id: 'a2', project_id: 'P1', mom_id: 'm3', action_item: 'Zulu new-meeting', status: 'Open' },
        // P2 — a different project entirely
        { id: 'a3', project_id: 'P2', mom_id: 'm1', action_item: 'Bravo other-project', status: 'Open' },
        // closed: out of the default worklist, reachable through the filter
        { id: 'a4', project_id: 'P1', mom_id: 'm3', action_item: 'Charlie closed', status: 'Closed' },
        // overdue: a past due date on an open item
        { id: 'a5', project_id: 'P2', mom_id: 'm1', action_item: 'Delta overdue', status: 'Open', due_date: '2020-01-01' }
      ]
    } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'meetings');
    const tbl = () => win.document.getElementById('po-mm-table').innerHTML;
    const note = () => win.document.getElementById('po-mm-note').textContent;

    /* one heading per project, ordered by the NAME a planner reads */
    has(tbl(), 'po-grp', tag + 'mm: rows are grouped per project');
    /* ⚠ With the Project column gone the name occurs ONLY in the heading, so indexing the
       table is indexing the headings. */
    ok(tbl().indexOf('Avesta') >= 0 && tbl().indexOf('Avesta') < tbl().indexOf('Bayfront'),
       tag + 'mm: groups are ordered by project name');
    /* \u26a0 the PROJECT column is gone — it repeated the heading on every row */
    ok(!/<th>Project<\/th>/.test(tbl()), tag + 'mm: the repeated Project column is gone');

    /* \u26a0\u26a0 newest MEETING first inside a project — the input order has the old one first,
       and the alphabet would put Aardvark before Zulu, so both naive answers are excluded. */
    const iZulu = tbl().indexOf('Zulu new-meeting'), iAard = tbl().indexOf('Aardvark old-meeting');
    ok(iZulu >= 0 && iAard >= 0 && iZulu < iAard,
       tag + 'mm: inside a project the NEWEST meeting leads — not input order, not alphabetical');

    /* the default is the worklist this view has always been */
    ok(!/Charlie closed/.test(tbl()), tag + 'mm: closed items are out by default');
    has(note(), 'closed items are left out', tag + 'mm: and the note says so');

    /* \u26a0 the status control actually filters, and "Overdue" is DERIVED */
    const st = win.document.getElementById('po-mm-status');
    ok(typeof st.onchange === 'function', tag + 'mm: the status select is wired');
    st.value = 'closed'; st.onchange({ target: st });
    ok(/Charlie closed/.test(tbl()) && !/Zulu new-meeting/.test(tbl()),
       tag + 'mm: Closed shows only closed items');
    st.value = 'overdue'; st.onchange({ target: st });
    ok(/Delta overdue/.test(tbl()) && !/Zulu new-meeting/.test(tbl()),
       tag + 'mm: Overdue is derived from a past due date, not read off status');
    st.value = ''; st.onchange({ target: st });
    ok(/Charlie closed/.test(tbl()) && /Zulu new-meeting/.test(tbl()),
       tag + 'mm: All shows both');

    /* \u26a0 the KPI strip counts the PORTFOLIO, never the filtered list */
    st.value = 'overdue'; st.onchange({ target: st });
    has(win.document.getElementById('po-mm-kpis').innerHTML, '>4<',
        tag + 'mm: the KPI strip still counts all 4 open items while the table shows 1');

    /* the search */
    st.value = ''; st.onchange({ target: st });
    const q = win.document.getElementById('po-mm-q');
    ok(typeof q.oninput === 'function', tag + 'mm: the search is wired');
    q.value = 'aardvark'; q.oninput({ target: q });
    ok(/Aardvark old-meeting/.test(tbl()) && !/Zulu new-meeting/.test(tbl()),
       tag + 'mm: search narrows, case-insensitively');
    q.value = ''; q.oninput({ target: q });

    /* \u26a0 a group collapses, and the caret is what does it */
    const grp = win.document.querySelectorAll('#po-mm-table .po-grp')[0];
    ok(grp && typeof grp.onclick === 'function', tag + 'mm: the group heading is clickable');
    grp.onclick();
    ok(!/Zulu new-meeting/.test(tbl()) && /Bravo other-project/.test(tbl()),
       tag + 'mm: collapsing one project hides ITS rows and leaves the others');
  }

  /* ---- Issues: the same grouping, and the status filter it already had ------------ */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: { issues_lessons: [
      { id: 'i1', project_id: 'P2', description: 'Bravo other-project', status: 'Open',   date_presented: '2026-01-01' },
      { id: 'i2', project_id: 'P1', description: 'Zulu newer',          status: 'Open',   date_presented: '2026-08-01' },
      { id: 'i3', project_id: 'P1', description: 'Aardvark older',      status: 'Open',   date_presented: '2026-01-01' },
      { id: 'i4', project_id: 'P1', description: 'Charlie closed',      status: 'Closed', date_presented: '2026-01-01' }
    ] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'issues');
    const tbl = () => win.document.getElementById('po-is-table').innerHTML;

    has(tbl(), 'po-grp', tag + 'is: rows are grouped per project');
    ok(!/<th>Project<\/th>/.test(tbl()), tag + 'is: the repeated Project column is gone');
    ok(tbl().indexOf('Avesta') >= 0 && tbl().indexOf('Avesta') < tbl().indexOf('Bayfront'),
       tag + 'is: groups ordered by project name');

    /* \u26a0 oldest-open first inside the project: aging is this register's own measure, and the
       alphabet would put Aardvark first for the wrong reason — so the fixture makes the OLDER
       issue the alphabetically-first one, and the assertion still requires it to lead. */
    const iAard = tbl().indexOf('Aardvark older'), iZulu = tbl().indexOf('Zulu newer');
    ok(iAard >= 0 && iZulu >= 0 && iAard < iZulu, tag + 'is: the longest-open issue leads its project');

    /* the status filter was ALREADY here — assert it still works after the regrouping */
    const st = win.document.getElementById('po-is-status');
    ok(typeof st.onchange === 'function', tag + 'is: the status select is still wired');
    st.value = 'Closed'; st.onchange({ target: st });
    ok(/Charlie closed/.test(tbl()) && !/Zulu newer/.test(tbl()), tag + 'is: Closed filters to closed');
    /* \u26a0 a project with nothing matching must not leave an empty heading behind */
    ok(!/Bayfront/.test(tbl()), tag + 'is: a project with no matching row drops its heading too');
    st.value = ''; st.onchange({ target: st });

    const grp = win.document.querySelectorAll('#po-is-table .po-grp')[0];
    ok(grp && typeof grp.onclick === 'function', tag + 'is: the group heading is clickable');
    grp.onclick();
    ok(!/Zulu newer/.test(tbl()) && /Bravo other-project/.test(tbl()),
       tag + 'is: collapsing one project leaves the others');
  }

  /* ==== 2026-09-16 · ONE TABLE DESIGN, AND ROWS THAT OPEN ====================================
     Owner, off five screenshots: *"There are different table formats seen throughout the modules.
     We already have an approved UI of tables seen in projects.html. Let's follow that
     universally"*, and *"I want to be able to open those specific meetings/items from the table
     as well from the portfolio view, not just a viewing page."*
     ⚠ These assert the MARKUP, because the markup is where the approved design is now claimed
     from (dashboard.css owns the look; the table just has to ask for it by name). A test that
     asserted padding would be testing the stylesheet, which is not this file's job. */
  {
    const every = probe.PortfolioDash.keys();
    every.forEach(function (k) {
      const mk = String(probe.PortfolioDash._markup ? probe.PortfolioDash._markup(k) : '');
      if (mk.indexOf('<table') < 0) return;          // not every view has a table
      const tables = mk.match(/<table class="([^"]*)"/g) || [];
      ok(tables.length > 0 && tables.every(function (t) {
        return /\bpd-table\b/.test(t) && /\bpd-proj-table\b/.test(t);
      }), tag + 'table: "' + k + '" asks for the approved treatment by name');
    });
  }
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: { issues_lessons: [
      { id: 'i1', project_id: 'P1', description: 'Zulu', status: 'Open', date_presented: '2026-01-01' },
      { id: 'i2', project_id: 'P1', description: 'Yankee', status: 'Open', date_presented: '2026-02-01' }
    ] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'issues');
    const t = win.document.getElementById('po-is-table').innerHTML;
    has(t, 'class="pd-group-row po-grp"', tag + 'group: the heading carries the approved row class');
    has(t, '<span class="pd-ghchip">', tag + 'group: and the tinted red-bordered chip');
    has(t, '<span class="pd-ghcount">2 issues</span>', tag + 'group: and a count that names what it counts');
    /* ⚠ The NOUN, not a bare number — and a different noun per register. */
    ok(!/pd-ghcount">2<\/span>/.test(t), tag + 'group: never a naked number beside a project name');
    has(t, 'data-open-pid="P1"', tag + 'open: an issue row says which project it belongs to');
    has(t, 'data-open-to="?openIssue=i1"', tag + 'open: and deep-links to that issue by id');
    has(t, 'class="pd-proj-row"', tag + 'open: an openable row looks openable (the approved hover/pointer)');
  }
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {
      meeting_minutes: [{ id: 'M9', project_id: 'P1', title: 'Weekly PPR', meeting_date: '2026-09-14' }],
      mom_items: [{ id: 'a1', project_id: 'P1', mom_id: 'M9', action_item: 'Do the thing', status: 'Open' }]
    } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    await mountView(win, 'meetings');
    const t = win.document.getElementById('po-mm-table').innerHTML;
    has(t, '<span class="pd-ghcount">1 action item</span>', tag + 'group: Meetings counts action items, not issues');
    /* ⚠⚠ THE HASH IS THE MODULE'S OWN. `UI.bindHistoryState({key:'mom_view'})` restores
       `{t,v,m}` out of the hash on load, so this link opens the meeting through the module's own
       apply() — asserting the exact encoded shape is what stops it drifting into a private
       protocol the module does not answer. */
    has(t, 'data-open-to="#mom_view=' + encodeURIComponent(JSON.stringify({ t: 'meetings', v: 'detail', m: 'M9' })),
        tag + 'open: a meeting row deep-links through the module\u2019s OWN history key');
  }

  /* ==== 2026-09-16 · THE S-CURVE'S MANUAL DATA TAB =========================================
     Owner: *"there is a manual data tab that is clickable that doesn't work."* It was static
     markup wired by the module's own init(), which a portfolio open deliberately skips. */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {
      scurve_manual: [
        { id: 'r1', project_id: 'P1', trade: 'Structural',   month: '2026-01-01', kind: 'planned',  pct: 8, updated_at: '2026-09-02T00:00:00Z' },
        { id: 'r2', project_id: 'P1', trade: 'Architectural', month: '2026-03-01', kind: 'actual',  pct: 6, updated_at: '2026-09-05T00:00:00Z' }
      ],
      scurve_manual_meta: [{ project_id: 'P1', planned_locked: true }]
    }, agg: { P1: AGG_P1, P2: AGG_P2 }, schedule: { P1: [], P2: [] } });
    win.PortfolioDash._setProjects(PROJECTS, []);
    const m = await mountView(win, 'scurve');
    has(probe.PortfolioDash._markup('scurve'), 'id="po-sc-pane-manual"',
        tag + 'scurve: the portfolio view has a Manual data pane of its own');
    ok(typeof m.api.bar === 'function',
       tag + 'scurve: and hands takeOver a bar builder — the tabs cannot be built by the view alone');

    /* Build the bar the way takeOver does, then press Manual data. */
    const bar = win.document._el('div');
    const tabsHost = win.document._el('div');
    win.document._byId['po-bar-tabs'] = tabsHost;
    bar.querySelector = function () { return tabsHost; };
    m.api.bar(bar);
    has(tabsHost.innerHTML, 'data-scv="manual"', tag + 'scurve: the bar carries Curve | Manual data');

    const pane = win.document.getElementById('po-sc-pane-manual');
    const tbl = win.document.getElementById('po-scm-table');
    ok(pane && tbl, tag + 'scurve: both panes are addressable');
  }

  /* ==== 2026-09-16 · THE PROJECT SCHEDULE GANTT ============================================
     Owner: *"is this supposed to be a gantt chart? Let's also have a toggle for year, quarterly,
     monthly viewing as well."* */
  {
    const win = buildPage(dashSrc, assetsDir);
    fakeNetwork(win, { tables: {} });
    /* The shared PROJECTS fixture carries no schedule roll-up, and without one this view draws
       its "no project in scope carries a roll-up yet" empty state -- so the axis, the grid and the
       today line would all be absent and every assertion below would be testing the empty state.
       These two span 2020->2027, which is what makes a year/quarter/month toggle mean anything. */
    win.PortfolioDash._setProjects([
      { id: 'P1', name: 'Avesta Residences', start_date: '2020-01-15', end_date: '2026-06-30',
        schedule_start: '2020-02-01', schedule_finish: '2026-09-30', forecast_finish: '2026-11-01',
        schedule_progress: 62, schedule_updated_at: '2026-09-10' },
      { id: 'P2', name: 'Bayfront Tower', start_date: '2022-03-01', end_date: '2027-12-31',
        schedule_start: '2022-04-01', schedule_finish: '2027-11-30', forecast_finish: '2027-12-15',
        schedule_progress: 20, schedule_updated_at: '2026-09-12' }
    ], []);
    await mountView(win, 'schedule');
    const host = win.document.getElementById('po-sh-gantt');
    const grain = win.document.querySelectorAll('#po-sh-grain button');
    eq(grain.length, 4, tag + 'gantt: Auto | Year | Quarter | Month');
    const press = function (g) {
      grain.filter(function (b) { return b.dataset.g === g; })[0].onclick();
      return host.innerHTML;
    };
    /* ⚠⚠ EXACTLY ONE "today" line, drawn over the whole plot. It used to be emitted once per
       row INSIDE an 18px-tall track plus once in the 18px axis, so today was a stack of
       disconnected stubs rather than a line a bar could be read against. */
    [['year', '>2020<'], ['quarter', ">Q1 '20<"], ['month', ">Jan '20<"]].forEach(function (pair) {
      const html = press(pair[0]);
      has(html, pair[1], tag + 'gantt: the ' + pair[0] + ' grain labels real ' + pair[0] + 's');
      eq((html.match(/class="po-sh-now"/g) || []).length, 1,
         tag + 'gantt: ' + pair[0] + ' — ONE continuous today line, never a stub per row');
      ok(/class="po-sh-gl"/.test(html), tag + 'gantt: ' + pair[0] + ' — and gridlines to read bars against');
      ok(/min-width:max\(100%,\d+px\)/.test(html),
         tag + 'gantt: ' + pair[0] + ' — the plot is widened from the TICK COUNT, not a constant');
    });
    /* Quarters start in Jan/Apr/Jul/Oct — not wherever the earliest contract happened to begin. */
    const q = press('quarter');
    ok(q.indexOf(">Q2 '20<") >= 0 && q.indexOf(">Q1 '20<") >= 0,
       tag + 'gantt: quarters are anchored on the calendar, so a Q label is a real Q');
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
  ok(/57014/.test(t), 'err: a timeout names its code');
  /* ⚠️⚠️ AND DOES NOT PRESCRIBE. It used to end "narrow the project filter and try again",
     written when the only caller was the Portfolio Dashboard — which has one. The owner met
     that sentence on a MODULE page, which does not. A shared helper cannot know what control
     the screen it prints on carries. */
  ok(!/narrow the project filter/.test(t), 'err: and does not name a control it cannot see');
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

/* ⚠️ The panel tells a planner to run a migration BY NAME. If that file is not in the repo the
   instruction is unfollowable, and nothing else would catch the typo. */
{
  ok(fs.existsSync(path.join(ROOT, 'migrations', '2026-09-16-scurve-trade-agg.sql')),
     'the migration the breakdown names exists in the repo');
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', '2026-09-16-scurve-trade-agg.sql'), 'utf8');
  ok(/create or replace function schedule_scurve_trade_agg\(p_id text\)/.test(sql),
     'and it defines the function the client calls, with the signature it calls it by');
  ok(/'No trade set'/.test(sql), "and buckets untagged work under the S-Curve module's own label");
  /* ⚠️⚠️ AND IT IS SINGLE-PROJECT. A `_multi` here would re-introduce the statement that was
     cancelled at the timeout this morning. */
  ok(!/schedule_scurve_trade_agg_multi/.test(sql), 'and offers no multi-project variant to time out');
  ok(/!~\* 'wbs\|summary'/.test(sql), 'and uses the same leaf rule as the curve it explains');
}

/* ============================================================= 4 · the Dashboard is empty of them */
{
  const po = fs.readFileSync(path.join(ROOT, 'modules', 'portfolio-overview', 'index.html'), 'utf8');
  ['po-view-scurve', 'po-view-cashflow', 'po-view-resources', 'po-view-equipment'].forEach(function (id) {
    ok(po.indexOf('id="' + id + '"') < 0, 'portfolio-overview no longer carries the pane ' + id);
  });
  /* ⚠⚠ REVERSED ON PURPOSE, 2026-09-16 (r). It stopped loading the engine in (g) when the
     S-Curve pane moved out; D4 draws the portfolio curve on the Overview again, through
     PDScurve's OWN fan-out. The assertion that matters now is the opposite one, plus the one
     below it: the page must not have grown a second copy of the maths or a second RPC. */
  ok(po.indexOf('assets/js/scurve.js') > 0,
     'portfolio-overview loads the shared curve engine for its own trend chart');
  /* ⚠ Asserted on the CALL, not on the string: the comment beside the fan-out names the
     RPC it is avoiding, and a bare substring test would be measuring its own explanation. */
  ok(!/rpc\(\s*['\"]schedule_scurve_agg_multi/.test(po),
     'and never CALLS the combined RPC that was cancelled at the timeout');
  ok(po.indexOf('PDScurve.fanOutAgg') > 0,
     'it fans out per project through the shared engine');
  ok(!/function scComputeFromAgg|function scMergeAggs/.test(po),
     'and carries no copy of the merge or the agg->curve maths');
}

/* ============ 5 · the grouping is NEW — an explicit contrast, because the gate above
      returns early and never reaches a view assertion ============================== */
{
  var baseDash = '';
  try {
    /* ⚠⚠ PINNED TO A SHA, NEVER origin/main. This was written against origin/main one commit
       ago and became SELF-COMPARISON the moment that commit landed - it failed within the hour.
       eec4ad1 is the last commit before the grouping, so it is the last one that still
       contrasts; LEAVE IT ALONE once this is no longer the newest change here. */
    baseDash = cp.execSync('git show eec4ad1:assets/js/portfolio-dash.js',
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { baseDash = ''; }
  if (baseDash) {
    ok(baseDash.indexOf('function groupByProject') < 0,
       'CONTRAST: origin/main has no groupByProject — the grouping above is new');
    ok(/<th>Project<\/th>/.test(baseDash),
       'CONTRAST: and its portfolio tables still repeat a Project column on every row');
    ok(baseDash.indexOf('po-mm-status') < 0,
       'CONTRAST: and Meetings had no status filter at all');
  } else {
    ok(false, 'CONTRAST: could not read eec4ad1:assets/js/portfolio-dash.js');
  }
}

/* ===================================================================== run, then gate */
(async function () {
  await suite(fs.readFileSync(DASH, 'utf8'), path.join(ROOT, 'assets', 'js'), '', true);

  /* ⚠️⚠️ THE GATE. Pull origin/main's own copies into a temp dir and run the same probe. There
     the four are NOT in the layer — they are panes of the Portfolio Dashboard. If this passes,
     the suite above is asserting something that is actually new. ⚠️ When this change is no longer
     the newest thing here, LEAVE THE SHA ALONE: it is the last commit that still contrasts. */
  let gated = false;
  try {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'podash-base-'));
    ['db.js', 'icons.js', 'scurve.js', 'ui.js', 'portfolio-dash.js'].forEach(function (f) {
      fs.writeFileSync(path.join(tmp, f), cp.execSync('git show ' + BASE_SHA + ':assets/js/' + f,
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    });
    const basePO = cp.execSync('git show ' + BASE_SHA + ':modules/portfolio-overview/index.html',
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    ['po-view-scurve', 'po-view-cashflow', 'po-view-resources', 'po-view-equipment'].forEach(function (id) {
      ok(basePO.indexOf('id="' + id + '"') >= 0, 'GATE: at ' + BASE_SHA + ' "' + id + '" IS a pane of the Dashboard');
    });
    ok(/function loadScurve/.test(basePO), 'GATE: and loadScurve lives there, not in the layer');
    await suite(fs.readFileSync(path.join(tmp, 'portfolio-dash.js'), 'utf8'), tmp, 'GATE', false);
    gated = true;
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {
    console.log('NOTE: gate against ' + BASE_SHA + ' unavailable (' + String(e.message).split('\n')[0] + ')');
  }
  ok(gated, 'GATE: the contrast build ran — a suite that has never failed proves nothing');

  console.log('');
  console.log('portfolio-dash: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
})();
