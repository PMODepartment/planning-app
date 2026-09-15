/* Portfolio Dashboard — executable checks for the 2026-09-15 load-failure fix.
 *
 *   node modules/portfolio-overview/test-portfolio.js
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html AND EXECUTED.
 *    Nothing here is a re-typed copy: a suite that asserts against its own reimplementation
 *    proves the reimplementation. This repo has been caught by that four times.
 *
 * ⚠️ THE CONTRAST BASE IS A PINNED SHA, NEVER `HEAD`. `git show HEAD:` silently becomes
 *    self-comparison the moment this change is committed — recorded on 2026-09-14 (n), where
 *    two suites went green on BOTH sides for exactly that reason.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const scan = require('../../tools/scan.js');

const PAGE = path.join(__dirname, 'index.html');
const BASE_SHA = 'aae4752';                 // the commit BEFORE the fix
const REL = 'modules/portfolio-overview/index.html';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(label); }
}
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* ---------------------------------------------------------------- the slicer */
function inlineScript(html) {
  const m = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!m) throw new Error('no inline <script> found');
  return m[1];
}
function sliceFn(src, name) {
  const c = scan.clean('x.js', src);
  const i = c.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const start = c.slice(Math.max(0, i - 6), i) === 'async ' ? i - 6 : i;
  let j = c.indexOf('{', i);
  if (j < 0) return null;
  let depth = 0, k = j;
  for (; k < c.length; k++) {
    if (c[k] === '{') depth++;
    else if (c[k] === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  const out = src.slice(start, k);
  // ⚠️ A slice that cannot be read must ABORT, never quietly compare nothing.
  try { new Function('return (' + out.replace(/^async\s+/, 'async ') + ')'); }
  catch (e) { throw new Error('slice of ' + name + ' does not parse: ' + e.message); }
  return out;
}

const html = fs.readFileSync(PAGE, 'utf8');
const JS = inlineScript(html);

let baseJS = null;
try {
  baseJS = inlineScript(cp.execSync('git show ' + BASE_SHA + ':' + REL, {
    cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  }));
} catch (e) {
  console.log('NOTE: contrast base ' + BASE_SHA + ' unavailable (' + e.message.split('\n')[0] + ')');
}

/* ============================================================ 1 · the dispatch
   A1: the project filter must re-run the ACTIVE view, not just repaint Overview. */
function dispatchSandbox(viewName) {
  const body = 'var _viewLoadT = null;\n' +
    sliceFn(JS, 'renderCurrent') + '\n' + sliceFn(JS, 'viewLoaders') + '\n' +
    'return { renderCurrent: renderCurrent, viewLoaders: viewLoaders };';
  const calls = [];
  const timers = [];
  const loaderNames = ['loadScurve', 'loadCashflow', 'loadResources', 'loadEquipment',
    'loadMilestones', 'loadRisks', 'loadStakeholders', 'loadIssues', 'loadMeetings',
    'loadContracts', 'loadPhotos', 'loadProductivity'];
  const args = [
    function renderAll() { calls.push(['renderAll']); },
    viewName,
    function setTimeout(fn) { timers.push(fn); return timers.length; },
    function clearTimeout(id) { if (id) timers[id - 1] = null; }
  ];
  const names = ['renderAll', 'view', 'setTimeout', 'clearTimeout'];
  loaderNames.forEach(function (n) {
    names.push(n);
    args.push(function (force) { calls.push([n, force]); });
  });
  const api = new Function(names.join(','), body).apply(null, args);
  return {
    api: api, calls: calls,
    flush: function () { timers.forEach(function (t) { if (t) t(); }); timers.length = 0; }
  };
}

const VIEW_LOADER = {
  scurve: 'loadScurve', cashflow: 'loadCashflow', resources: 'loadResources',
  equipment: 'loadEquipment', milestones: 'loadMilestones', risk: 'loadRisks',
  stakeholders: 'loadStakeholders', issues: 'loadIssues', meetings: 'loadMeetings',
  contracts: 'loadContracts', photos: 'loadPhotos', productivity: 'loadProductivity'
};

Object.keys(VIEW_LOADER).forEach(function (v) {
  const s = dispatchSandbox(v);
  s.api.renderCurrent();
  ok(s.calls.length === 1 && s.calls[0][0] === 'renderAll', v + ': Overview repaints immediately');
  s.flush();
  const loaded = s.calls.filter(function (c) { return c[0] === VIEW_LOADER[v]; });
  eq(loaded.length, 1, v + ': its own loader runs');
  eq(loaded[0] && loaded[0][1], true, v + ': loader is forced past the id-list cache');
});

/* ⚠️ The Overview itself has no loader — it IS renderAll. Asserting this stops a future
   edit inventing a phantom loadOverview and firing a network read for nothing. */
{
  const s = dispatchSandbox('overview');
  s.api.renderCurrent(); s.flush();
  eq(s.calls.length, 1, 'overview: repaints and loads nothing');
}

/* ⚠️ THE DEBOUNCE. Forcing on every tick would mean five fetches for five checkboxes; the
   Overview still repaints on each one, so the page never feels stalled. */
{
  const s = dispatchSandbox('scurve');
  s.api.renderCurrent(); s.api.renderCurrent(); s.api.renderCurrent();
  eq(s.calls.filter(function (c) { return c[0] === 'renderAll'; }).length, 3,
     'three ticks repaint the Overview three times');
  s.flush();
  eq(s.calls.filter(function (c) { return c[0] === 'loadScurve'; }).length, 1,
     'three ticks produce ONE view load, not three');
}

/* ⚠️ One list, two readers. If switchView stops going through viewLoaders(), a view can be
   wired for arrival and forgotten when the filter changes — the defect this fixes. */
{
  const sw = sliceFn(JS, 'switchView');
  ok(/viewLoaders\(\)\[v\]/.test(sw), 'switchView dispatches through viewLoaders()');
  ok(!/if \(v === 'scurve'\) loadScurve/.test(sw), 'switchView no longer carries its own copy of the list');
  const keys = Object.keys(new Function(sliceFn(JS, 'viewLoaders') +
    '\nreturn viewLoaders.toString();')().match(/\{[\s\S]*\}/)[0]
    .split('\n').join(' ').match(/(\w+):/g).reduce(function (a, k) { a[k.slice(0, -1)] = 1; return a; }, {}));
  eq(keys.length, 12, 'viewLoaders names all twelve lazy views');
}

/* -- the contrast: on the pinned base the same gesture reaches NO loader ---- */
if (baseJS) {
  const baseAfter = /var after = function \(\) \{[\s\S]*?\};/.exec(baseJS);
  const fixAfter = /var after = function \(\) \{[\s\S]*?\};/.exec(JS);
  ok(baseAfter && /renderAll\(\);/.test(baseAfter[0]) && !/renderCurrent/.test(baseAfter[0]),
     'BASE: the filter handler calls renderAll (and so loads nothing)');
  ok(fixAfter && /renderCurrent\(\);/.test(fixAfter[0]),
     'FIX:  the filter handler calls renderCurrent');

  // executed, not merely read: BASE's renderAll reaches none of the twelve loaders
  const ra = sliceFn(baseJS, 'renderAll');
  const hit = [];
  const stub = function (n) { return function () { hit.push(n); }; };
  new Function('filtered,renderKPIs,renderDonut,renderBars,renderTable,loadScurve',
    ra + '\nrenderAll();')(function () { return []; }, stub('kpi'), stub('donut'),
    stub('bars'), stub('table'), stub('loadScurve'));
  eq(hit.filter(function (h) { return h === 'loadScurve'; }).length, 0,
     'BASE: renderAll reaches no view loader — the reported defect, reproduced');
}

/* ================================================ 2 · the cross-project pager
   A3: per-project keyset paging, no exact count, one project's failure named. */
function pagerSandbox(opts) {
  const seen = { selects: [], eq: 0, in: 0, projects: [] };
  function makeQuery(pid) {
    let rowsLeft = opts.rows[pid] === undefined ? 10 : opts.rows[pid];
    let sent = 0;
    const q = {
      eq: function (col, v) { seen.eq++; seen.projects.push(v); return q; },
      in: function () { seen.in++; return q; },
      order: function () { return q; },
      limit: function (n) { q._lim = n; return q; },
      gt: function () { return q; },
      then: function (res) {
        if (opts.failFor && opts.failFor.indexOf(pid) !== -1) {
          return res({ error: { code: '57014', message: 'canceling statement due to statement timeout' } });
        }
        const take = Math.min(q._lim, rowsLeft - sent);
        const page = [];
        for (let i = 0; i < take; i++) page.push({ id: pid + '-' + (sent + i), project_id: pid });
        sent += take;
        return res({ data: page, error: null });
      }
    };
    return q;
  }
  let curPid = null;
  const sb = function () {
    return { from: function () {
      return { select: function (cols, opt2) { seen.selects.push(opt2 || null); return makeQuery(curPid); } };
    } };
  };
  const body = sliceFn(JS, 'fetchScheduleForIds') +
    '\nreturn function (ids, cb) { return fetchScheduleForIds(ids, function (i, n) { curPid = ids[i]; if (cb) cb(i, n); }); };';
  const run = new Function('sb,window,PDScurve,setCur', body)(
    function () { return sb(); }, {}, null, null);
  // curPid must be set BEFORE the select — wire it through the progress callback
  const wrapped = function (ids) {
    let idx = { i: 0 };
    curPid = ids[0];
    return run(ids, function (i) { curPid = ids[i]; });
  };
  return { run: wrapped, seen: seen };
}

{
  const ids = [];
  for (let i = 1; i <= 21; i++) ids.push('P' + i);
  const rows = {}; ids.forEach(function (p) { rows[p] = 10; });
  const s = pagerSandbox({ rows: rows, failFor: ['P7'] });
  s.run(ids).then(function (res) {
    eq(res.failed.length, 1, 'pager: one project failed');
    eq(res.failed[0].id, 'P7', 'pager: the failure is NAMED, not anonymous');
    eq(res.rows.length, 200, 'pager: the other twenty projects still loaded');
    eq(s.seen.in, 0, 'pager: never uses .in(project_id, ids) — the plan that degenerates');
    ok(s.seen.eq >= 21, 'pager: one .eq(project_id) per project — the shape the index exists for');
    eq(s.seen.selects.filter(function (o) { return o && o.count; }).length, 0,
       'pager: no count:exact pre-read remains');
    raceSuite().then(report);
  });
}

/* ============================================ 2b · the overlapping-load race
   A2: the owner's screenshot IS this bug — the filter button read "2 projects" while the
   pane still read "Loading schedules across 21 project(s)…", because a superseded load was
   left holding the screen. Executed, not asserted on source. */
function deferred() {
  let res; const p = new Promise(function (r) { res = r; });
  return { promise: p, resolve: res };
}
function scurveSandbox(mutate) {
  const log = { charts: 0, kpis: 0, toasts: [], html: [] };
  let ids = [];
  const rpcs = [];
  const el = function () {
    return { set innerHTML(v) { log.html.push(v); }, get innerHTML() { return ''; },
             set textContent(v) {}, get textContent() { return ''; } };
  };
  let fnSrc = sliceFn(JS, 'loadScurve');
  if (mutate) fnSrc = mutate(fnSrc);
  const body = 'var _scGen = 0, scLoadedIds = null, scData = null;\n' +
    fnSrc + '\n' +
    'return { loadScurve: loadScurve, state: function () { return { ids: scLoadedIds, data: scData }; } };';
  const api = new Function(
    'scopedProjectIds,document,scopeLabel,sb,scComputeFromAgg,PROJ,SC_FULL_MAX,' +
    'fetchScheduleForIds,scCompute,scRenderKpis,scRenderChart,esc,UI,scErrText',
    body)(
    function () { return ids; },
    { getElementById: el },
    function (x) { return x.length + ' projects'; },
    function () { return { rpc: function () { const d = deferred(); rpcs.push(d); return d.promise; } }; },
    function (a) { return { empty: false, months: [new Date()], plannedC: [0], actualC: [0],
                            TOT: 1, ti: 0, variance: 0, _from: a._tag }; },
    [],
    5,
    function () { return Promise.resolve({ rows: [], failed: [] }); },
    function () { return { empty: true }; },
    function () { log.kpis++; },
    function () { log.charts++; },
    function (s) { return s; },
    { toast: function (m, k) { log.toasts.push([k, m]); } },
    function (e) { return String((e && e.message) || e); }
  );
  return { api: api, log: log, rpcs: rpcs, setIds: function (v) { ids = v; } };
}

async function raceSuite() {
  const s = scurveSandbox();
  const big = []; for (let i = 1; i <= 21; i++) big.push('P' + i);

  s.setIds(big);
  const a = s.api.loadScurve(true);          // gen 1 — 21 projects, RPC left pending
  s.setIds(['P1', 'P2']);
  const b = s.api.loadScurve(true);          // gen 2 — supersedes it

  // the NEWER load answers first, then the stale one comes back
  s.rpcs[1].resolve({ data: { months: [{ key: '2026-01', pd: 1, ad: 1 }], _tag: 'B' }, error: null });
  await b;
  s.rpcs[0].resolve({ data: { months: [{ key: '2026-01', pd: 1, ad: 1 }], _tag: 'A' }, error: null });
  await a;

  eq(s.log.charts, 1, 'race: ONE paint, not two');
  eq(s.api.state().ids.length, 2, 'race: the surviving scope is the NEWER one (2 projects)');
  eq(s.api.state().data.nProjects, 2, 'race: the stale 21-project load committed nothing');
  ok(!s.log.html.some(function (h) { return /21 project/.test(h); }),
     'race: no "…21 project(s)" message is left holding the screen');

  /* ⚠️ And the ordinary case still paints: a lone load is not suppressed by its own token. */
  const s2 = scurveSandbox();
  s2.setIds(['P1', 'P2']);
  const c = s2.api.loadScurve(true);
  s2.rpcs[0].resolve({ data: { months: [{ key: '2026-01', pd: 1, ad: 1 }] }, error: null });
  await c;
  eq(s2.log.charts, 1, 'race: an un-superseded load does paint');

  /* ⚠️ A failing RPC with no rows to fall back on must NAME the cause, not print a bare
     "Load failed." — and must not leave the KPI strip claiming a figure. */
  const s3 = scurveSandbox();
  s3.setIds(big);
  const d = s3.api.loadScurve(true);
  s3.rpcs[0].resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  await d;
  eq(s3.log.charts, 0, 'race: a failed roll-up draws no chart');
  ok(s3.log.html.some(function (h) { return /Could not draw the portfolio S-curve/.test(h); }),
     'race: the failure is reported in the pane');
  ok(s3.log.toasts.some(function (t) { return t[0] === 'error'; }),
     'race: and raised as an error toast');

  /* ⚠️⚠️ THE NEGATIVE BUILD — a suite that has never failed proves nothing.
     Strip the generation guard out of the SHIPPED function and the owner's screenshot comes
     back: both loads paint, and the stale 21-project one wins because it answered last.
     Same device as tools/wiring-check.js, which re-injects the z6 outage before it will
     trust its own green run. */
  const stripGuard = function (s) {
    const out = s.split('if (gen !== _scGen) return;').join('');
    if (out === s) throw new Error('negative build is inert — the guard text moved');
    return out;
  };
  const n = scurveSandbox(stripGuard);
  n.setIds(big);
  const na = n.api.loadScurve(true);
  n.setIds(['P1', 'P2']);
  const nb = n.api.loadScurve(true);
  n.rpcs[1].resolve({ data: { months: [{ key: '2026-01', pd: 1, ad: 1 }] }, error: null });
  await nb;
  n.rpcs[0].resolve({ data: { months: [{ key: '2026-01', pd: 1, ad: 1 }] }, error: null });
  await na;
  ok(n.log.charts === 2, 'NEGATIVE: without the guard both loads paint (bug reproduced)');
  ok(n.api.state().ids.length === 21,
     'NEGATIVE: without the guard the STALE 21-project load wins — the owner\'s screenshot');
}

function report() {
  /* ======================================================= 3 · the error text
     A5: a timeout, a missing migration and an RLS refusal must not read alike. */
  const se = new Function(sliceFn(JS, 'scErrText') + '\nreturn scErrText;')();
  const t = se({ code: '57014', message: 'canceling statement due to statement timeout' });
  const m = se({ code: 'PGRST202', message: 'Could not find the function' });
  const r = se({ code: '42501', message: 'permission denied for table project_schedule' });
  const o = se({ message: 'socket hang up' });
  ok(/57014/.test(t) && /narrow/i.test(t), 'err: a timeout says so and says what to do');
  ok(/2026-07-20-schedule-scurve-agg\.sql/.test(m), 'err: a missing function names its migration');
  ok(/permission/i.test(r), 'err: an RLS refusal says permission');
  eq(o, 'socket hang up', 'err: anything else passes through unchanged');
  ok(new Set([t, m, r, o]).size === 4, 'err: all four causes read differently');

  /* ⚠️ A message-only match must still work: PostgREST does not always populate `code`. */
  ok(/57014/.test(se({ message: 'canceling statement due to statement timeout' })),
     'err: recognised from the message alone when no code is given');

  /* ===================================================== 4 · source invariants
     ⚠️⚠️ COMMENTS ARE STRIPPED FIRST, AND BOTH OF THESE FAILED UNTIL THEY WERE.
     The only `count:'exact'` left on the page is inside the comment explaining that the
     pre-read was REMOVED, and two of the three "Load failed." are comments quoting the
     message this change deleted. A checker that reads its own explanation and reports it as
     a finding is the `cellcount.py` trap, third occurrence in this repo. */
  const CODE = scan.clean('x.js', JS);
  ok(!/count:\s*'exact'/.test(CODE), 'no count:exact remains in CODE (comments stripped)');
  ok(/\.eq\('project_id', pid\)/.test(CODE), 'the pager binds one project at a time');
  ok(/_scGen/.test(CODE), 'the S-curve load carries a generation token');
  ok((CODE.match(/if \(gen !== _scGen\) return;/g) || []).length >= 5,
     'every await in loadScurve re-checks the token');

  /* ⚠️ Scoped to the S-CURVE loader. Cash Flow still prints "Load failed." and is a
     different view, deliberately out of this change — asserting page-wide would fail for a
     reason that is not this fix's, which is how a suite gets disabled. */
  const scLoad = sliceFn(JS, 'loadScurve');
  ok(!/Load failed\./.test(scan.clean('x.js', scLoad)),
     'the bare "Load failed." is gone from the S-curve loader');
  ok(/scErrText\(/.test(scLoad), 'the S-curve loader reports through scErrText');

  console.log('');
  console.log('portfolio-overview: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
}
