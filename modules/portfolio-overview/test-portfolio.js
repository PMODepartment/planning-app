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

/* ====================== 0a · THE OVERVIEW TRIM (2026-09-16) ==================================
   Owner, on the live page: *"What lands next what's the purpose of this? Let's just remove this"*,
   *"the s-curve needs to be spaced evenly between other cards"*, *"there is already a portfolio
   s-curve, can't we just reference that than create a new one"* and *"highlighted tooltips need to
   be simplified."* */
{
  /* --- the look-ahead is GONE, renderer and all ------------------------------------------- */
  eq((html.match(/po-look/g) || []).length, 0, 'the "What lands next" markup is gone');
  eq((JS.match(/renderLookahead/g) || []).length, 0, 'and its renderer with it — not merely unwired');
  /* ⚠️ The `ms` read it shared must STAY: the "Milestones due in 30 days" KPI still needs it,
     and removing a read because one of its two consumers went is how a figure silently empties. */
  ok(/settle\('ms'/.test(JS), 'the milestone read is kept — the 30-day KPI still reads it');

  /* --- the curve card REFERENCES the S-Curve module rather than standing alone ------------- */
  ok(/po-seclink/.test(html), 'the curve card carries a link out');
  const href = /<a class="po-seclink" href="([^"]+)"/.exec(html);
  ok(!!href, 'and the link has an href');
  if (href) {
    const target = href[1].split('#')[0];
    ok(/s-curve/.test(target), 'which points at the S-Curve module');
    /* ⚠️ The path must RESOLVE. A link to a page that is not there is worse than no link,
       and the only way to notice is to click it. */
    ok(fs.existsSync(path.join(__dirname, '..', '..', 'modules', 'portfolio-overview', target)) ||
       fs.existsSync(path.join(__dirname, target)),
       'and that page exists on disk: ' + target);
    ok(/#pd_scope=portfolio/.test(href[1]), 'and opens it in PORTFOLIO scope, not on one project');
  }
  /* ⚠️⚠️ AND THE CURVE IS STILL THE SHARED ENGINE'S. "Reference it, do not rebuild it" is
     only true while these three calls are what produce the numbers — if this page ever computes
     its own curve, the card becomes the second implementation the owner asked us to avoid. */
  ['PDScurve.fanOutAgg', 'PDScurve.mergeAggs', 'PDScurve.computeFromAgg'].forEach(fn => {
    ok(JS.indexOf(fn) >= 0, 'the curve still comes from the shared engine — ' + fn);
  });

  /* --- even spacing, and a label that does not break mid-phrase ---------------------------- */
  /* ⚠️ Read here rather than reusing the `PODCSS` declared further down — that `const` is
     below this block, and a `const` is not hoisted into it. */
  const POD = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'css', 'portfolio-dash.css'), 'utf8');
  ok(/#po-view-overview\s*\{[^}]*display:\s*flex/.test(POD),
     'the Overview is a flex column, so its gap belongs to the container');
  ok(/#po-view-overview\s*\{[^}]*gap:/.test(POD), 'and it declares one gap for every card');
  /* ⚠️ The two ad-hoc margins must be zeroed, or the container gap is DOUBLED under them —
     which is the uneven spacing this fixes, reintroduced by the fix. */
  ok(/#po-view-overview > \.pd-kpis\s*\{[^}]*margin-bottom:\s*0/.test(POD),
     'and the KPI strip no longer adds its own margin on top of that gap');
  ok(/\.po-chk\s*\{[^}]*white-space:\s*nowrap/.test(POD),
     'a checkbox/label phrase does not wrap between its words');

  /* --- the notes are a line, not a paragraph ------------------------------------------------ */
  const rank = /note\.innerHTML = ([\s\S]*?);\n/.exec(JS);
  ok(!!rank, 'the rank note is still set');
  if (rank) {
    ok(!/there is no combined score/.test(rank[1]),
       'the rank note no longer explains the ranking rationale under the table');
    ok(!/narrow the project filter and try again/.test(rank[1]),
       'and no longer tells the planner to work around a read that now succeeds');
  }
  ok(!/so the figures above are computed over what is there, not over all of them/.test(JS),
     'the coverage note drops the clause that restated what its own list implies');
}

/* ============================== 0 · THE READS THAT WERE FAILING (2026-09-16) ==================
   Owner, off the live page: the Open Issues column was a row of `?`, Behind plan said
   *"unavailable — the database cancelled the read on a timeout (57014)"*, and both milestone
   blocks were blank. Three separate reads, two separate causes. */
{
  /* --- a. the phantom column ------------------------------------------------------------
     `issues_lessons` has no `priority`. PostgREST answers an unknown column with 42703, so that
     read threw EVERY time — and issCell() renders a failed read as `?`. A typo, not a timeout.
     ⚠️ Asserted against the REPO SQL, not against a list retyped here: a test that carries its
     own idea of the schema agrees with itself while the app disagrees with Postgres. */
  const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase-schema.sql'), 'utf8');
  const ddl = /create table if not exists issues_lessons\s*\(([\s\S]*?)\n\);/.exec(SQL);
  ok(!!ddl, 'issues_lessons DDL found in supabase-schema.sql');
  const cols = new Set((ddl ? ddl[1] : '').split('\n')
    .map(l => (/^\s{2,}([a-z_]+)\s/.exec(l) || [])[1]).filter(Boolean));
  ok(cols.has('status') && cols.has('project_id'), 'and it names the columns the Overview reads');
  ok(!cols.has('priority'), 'issues_lessons has NO `priority` column — the bug this pins');

  const iss = /settle\('iss',[\s\S]*?\)\);/.exec(JS);
  ok(!!iss, 'the issues read is still there');
  const proj = /'([a-z_,]+)'\s*\)\);/.exec(iss ? iss[0] : '');
  const asked = proj ? proj[1].split(',') : [];
  ok(asked.length > 0, 'and it names an explicit projection');
  asked.forEach(c => ok(cols.has(c),
    'the issues read asks only for columns issues_lessons really has — "' + c + '"'));
}
{
  /* --- b. the two reads that were cancelled at the 8s statement_timeout -------------------
     `project_schedule` is the biggest table in the app, and a leading-wildcard ILIKE over
     eighteen projects at once cannot use an index. Both now go one project at a time through
     `PDb.fanOut`, the same shape `project_schedule_proj_id_idx (project_id, id)` exists for. */
  const ms = /settle\('ms',[\s\S]*?\n    \}\)\(\)\);/.exec(JS);
  ok(!!ms, 'the milestone read is still there');
  if (ms) {
    ok(/PDb\.fanOut\(ids,/.test(ms[0]), 'ms: reads one project at a time');
    ok(/q\.eq\('project_id', id\)/.test(ms[0]), 'ms: and scopes each call with .eq, not .in');
    ok(!/\.in\('project_id', ids\)/.test(ms[0]), 'ms: the cross-project .in is gone');
    /* ⚠️ A project that fails must not blank the page — only a TOTAL failure throws. */
    ok(/if \(!r\.results\.length && r\.failed\.length\) throw/.test(ms[0]),
       'ms: one project failing leaves the rest drawn');
  }
  const st = /settle\('status',[\s\S]*?\n    \}\)\(\)\);/.exec(JS);
  ok(!!st, 'the behind-plan read is still there');
  if (st) {
    ok(/PDb\.fanOut\(ids,/.test(st[0]), 'status: fans the RPC out per project');
    ok(/p_ids: \[id\]/.test(st[0]), 'status: and hands it ONE id, not the whole list');
    ok(!/p_ids: ids/.test(st[0]), 'status: the all-ids call that timed out is gone');
  }
  /* ⚠️⚠️ AND NO READ ANYWHERE ON THIS PAGE MAY GO BACK TO `.in('project_id', ids)` AGAINST
     `project_schedule`. That is the shape that produced 57014; naming the table keeps the check
     specific enough to stay true (the small per-record tables are fine with `.in`). */
  /* ⚠️ THE CALL SITE, NOT A CHARACTER WINDOW. The first version of this check looked ±400
     characters either side of every mention of the table — which swept in the COMMENTS that
     explain the fix and the perfectly legitimate `issues_lessons` read sitting just below them,
     and failed a correct file. A proximity test over prose is not a test of code. */
  const calls = [...JS.matchAll(/(?:selectAll|from)\(\s*'project_schedule'/g)];
  ok(calls.length > 0, 'the page still reads project_schedule somewhere');
  calls.forEach((c, i) => {
    const body = JS.slice(c.index, c.index + 400);
    ok(!/\.in\('project_id',\s*ids\)/.test(body),
       'project_schedule read #' + (i + 1) + ' does not use .in(project_id, ids)');
  });
}

/* ============================================================ 1 · the dispatch
   A1: the project filter must re-run the ACTIVE view, not just repaint Overview. */
function dispatchSandbox(viewName) {
  const body = 'var _viewLoadT = null;\n' +
    sliceFn(JS, 'renderCurrent') + '\n' + sliceFn(JS, 'viewLoaders') + '\n' +
    'return { renderCurrent: renderCurrent, viewLoaders: viewLoaders };';
  const calls = [];
  const timers = [];
  const loaderNames = ['loadOverview', 'loadScurve', 'loadCashflow', 'loadResources',
    'loadEquipment', 'loadMilestones', 'loadRisks', 'loadStakeholders', 'loadIssues',
    'loadMeetings', 'loadContracts', 'loadPhotos', 'loadProductivity'];
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

/* ⚠️⚠️ ONE VIEW, AND THE LIST IS THE POINT. All twelve of the others moved to the
   modules they describe (2026-09-15, then 2026-09-16 twice); what a name left in here would buy
   is a green run over a loader this page no longer has. Owner on the last two: *"Stakeholder map
   is here why? This is just a duplicate from the stakeholder map module that can already be
   navigated in the side panel. Let's just remove the milestones tab as well."* */
const VIEW_LOADER = { overview: 'loadOverview' };

Object.keys(VIEW_LOADER).forEach(function (v) {
  const s = dispatchSandbox(v);
  s.api.renderCurrent();
  ok(s.calls.length === 1 && s.calls[0][0] === 'renderAll', v + ': Overview repaints immediately');
  s.flush();
  const loaded = s.calls.filter(function (c) { return c[0] === VIEW_LOADER[v]; });
  eq(loaded.length, 1, v + ': its own loader runs');
  eq(loaded[0] && loaded[0][1], true, v + ': loader is forced past the id-list cache');
});

/* ⚠️⚠️ THIS ASSERTION IS THE REVERSE OF WHAT IT WAS, DELIBERATELY. Until Phase D the
   Overview had no loader — it painted from PROJ and read nothing, and this suite asserted
   exactly that. The decision surface gave it four enrichment reads, so it now has one, and
   the suite was changed to match the design rather than the design bent to keep it green.
   What still matters is that the Overview repaints FIRST and reads second: the first paint
   must not wait on a round trip. */
{
  const s = dispatchSandbox('overview');
  s.api.renderCurrent();
  eq(s.calls.length, 1, 'overview: paints from PROJ before any read is issued');
  eq(s.calls[0][0], 'renderAll', 'overview: and that first call is the repaint');
  s.flush();
  eq(s.calls.filter(c => c[0] === 'loadOverview').length, 1, 'overview: then loads, once');
}

/* ⚠️ THE DEBOUNCE. Forcing on every tick would mean five fetches for five checkboxes; the
   Overview still repaints on each one, so the page never feels stalled. */
{
  const s = dispatchSandbox('overview');
  s.api.renderCurrent(); s.api.renderCurrent(); s.api.renderCurrent();
  eq(s.calls.filter(function (c) { return c[0] === 'renderAll'; }).length, 3,
     'three ticks repaint the Overview three times');
  s.flush();
  eq(s.calls.filter(function (c) { return c[0] === 'loadOverview'; }).length, 1,
     'three ticks produce ONE view load, not three');
}

/* ⚠️ One list, two readers. If switchView stops going through viewLoaders(), a view can be
   wired for arrival and forgotten when the filter changes — the defect this fixes. */
{
  const sw = sliceFn(JS, 'switchView');
  ok(/viewLoaders\(\)\[v\]/.test(sw), 'switchView dispatches through viewLoaders()');
  ok(!/if \(v === 'milestones'\) loadMilestones/.test(sw), 'switchView no longer carries its own copy of the list');
  const keys = Object.keys(new Function(sliceFn(JS, 'viewLoaders') +
    '\nreturn viewLoaders.toString();')().match(/\{[\s\S]*\}/)[0]
    .split('\n').join(' ').match(/(\w+):/g).reduce(function (a, k) { a[k.slice(0, -1)] = 1; return a; }, {}));
  eq(keys.length, 1, 'viewLoaders names the one view this page still hosts');
  /* ⚠️⚠️ AND NOT THE SIX THAT MOVED. Owner 2026-09-15: the dropdown was a second home for six
     modules, and their dashboards now live in the modules themselves
     (assets/js/portfolio-dash.js). A loader left behind here would be a second copy of a
     renderer that is no longer on this page — the drift the move exists to end. */
  ['risk', 'issues', 'meetings', 'contracts', 'photos', 'productivity',
   'scurve', 'cashflow', 'resources', 'equipment', 'milestones', 'stakeholders'].forEach(function (k) {
    ok(keys.indexOf(k) < 0, 'viewLoaders no longer names "' + k + '" — it moved to its module');
  });
  /* ⚠️⚠️ AND NEITHER DOES THE FILE. A loader can be dropped from the list and left in the
     source, where the next reader takes it for the live one — which is a second copy of a
     renderer, the exact fault this move exists to end. Every renderer of the four that left
     on 2026-09-16 must be GONE, not merely unreferenced. */
  ['loadScurve', 'scRenderChart', 'scComputeFromAgg', 'fetchScheduleForIds', 'scErrText',
   'loadCashflow', 'cfRenderChart', 'cfMonthlySeries',
   'loadResources', 'rsRenderTable',
   'loadEquipment', 'eqBuild', 'eqRenderGrid', 'eqExport',
   /* ⚠️⚠️ AND THE LAST TWO VIEWS, 2026-09-16. These are the ones that were NOT merely
      unreferenced before -- 1,016 lines of milestone calendar and stakeholder directory/matrix
      came out with them. A renderer left in the source is one the next reader takes for the live
      one, which is the whole reason this list exists. */
   'loadMilestones', 'renderMilestones', 'msVisible', 'msStateOf', 'msKpi', 'wireMilestones',
   'loadStakeholders', 'shRender', 'shVisible',
   'dirRender', 'dirRenderUniverse', 'dirRenderHealth', 'openDirAdd', 'dirCard'].forEach(function (fn) {
    eq((JS.match(new RegExp('\\b' + fn + '\\b', 'g')) || []).length, 0,
       fn + ' does not occur in this page at all any more');
  });
  /* ⚠️ A deep link to one of them must still resolve, to the module that owns it now. */
  const MOVED = new Function('return ' + /var PO_MOVED_VIEWS = (\{[\s\S]*?\});/.exec(JS)[1])();
  eq(Object.keys(MOVED).length, 12, 'all twelve moved views still resolve from an old #po_view= link');
  /* ⚠️⚠️ THE TWO REMOVED ON 2026-09-16 REDIRECT RATHER THAN 404. `#po_view=` links to
     both have been in the sidebar, in bookmarks and in messages for months. */
  eq(MOVED.stakeholders, 'stakeholder-map', 'the Stakeholder Map deep link lands on that module');
  eq(MOVED.milestones, 'project-schedule',
     'and Milestones lands on Project Schedule, whose portfolio view is the same dates as a Gantt');
  eq(MOVED.risk, 'risk-register', 'and they name the module that hosts them');
  eq(MOVED.scurve, 's-curve', 'the S-Curve deep link lands on the S-Curve module');
  eq(MOVED.cashflow, 'cash-flow', 'the Cash Flow deep link lands on the Cash Flow module');
  eq(MOVED.resources, 'resource-loading', 'the Resources deep link lands on Resource Loading');
  eq(MOVED.equipment, 'equipment-loading', 'the Equipment deep link lands on Equipment Loading');
  /* ⚠️ Every moved view names a module that EXISTS on disk. A typo here is a redirect to a
     404, and the only way to notice it is to click the link. */
  Object.keys(MOVED).forEach(function (k) {
    ok(fs.existsSync(path.join(__dirname, '..', MOVED[k], 'index.html')),
       'the module ' + MOVED[k] + ' that "' + k + '" redirects to exists on disk');
  });
  /* ⚠️ And the ONE that stayed is not in the table, or the page would redirect to itself. */
  ok(!MOVED.overview, '"overview" stays on this page and is not redirected');
  ok(/location\.replace\(/.test(sw), 'switchView redirects rather than pushing a dead tab onto Back');
  /* ⚠️⚠️ AND THE DROPDOWN ITSELF IS GONE. Owner: *"remove the dropdown selector. Having
     the 'Overview' itself is already a duplicate of the Portfolio Dashboard name."* A dropdown
     over one entry names the page you are already standing on. */
  /* ⚠️ `html`, not `JS` — these are MARKUP facts, and `JS` is only the inline <script>.
     Asserted against the extracted script they would all have passed for the wrong reason
     (nothing in a <script> says `class="po-tabs"`), which is a green light over an unrun test. */
  eq((html.match(/class="po-tabs/g) || []).length, 0, 'the .po-tabs strip is not in the markup');
  eq((html.match(/tabsToDropdown\(/g) || []).length, 0, 'and nothing tries to convert it');
  eq((html.match(/id="po-view-milestones"/g) || []).length, 0, 'the Milestones pane is gone');
  eq((html.match(/id="po-view-stakeholders"/g) || []).length, 0, 'the Stakeholder Map pane is gone');
  ok(/id="po-view-overview"/.test(html), 'and the Overview is still here');
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

/* ⚠️⚠️ THE S-CURVE SUITE MOVED WITH THE S-CURVE (2026-09-16).
   The cross-project pager, the overlapping-load race and the error-text cases used to live
   here because `loadScurve` did. It is `assets/js/portfolio-dash.js` now and the error namer
   is `PDb.errText`, so the tests that execute them are `tools/test-portfolio-dash.js`.
   ⚠️ NOT DELETED AND NOT DUPLICATED: a test left behind slicing a function this page no longer
   contains would abort on a null slice, and a copy kept "just in case" is the second renderer
   problem in test form. Run both suites. */

function report() {
  const CODE = scan.clean('x.js', JS);   // comments blanked, string bodies kept

  /* ================================================ 3b · the chrome (Phase B)
     B8: one KPI component. The two private producers are executed through the REAL
     UI.kpi — loaded the way tools/wiring-check.js loads a browser script — so this
     proves the shipped page emits the shared card, not that a stub does. */
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'ui.js'), 'utf8');
  const win = { document: { addEventListener() {}, readyState: 'complete',
                            querySelector: () => null, querySelectorAll: () => [] },
                addEventListener() {}, location: { hash: '' }, history: {}, matchMedia: () => ({}) };
  win.window = win;
  new Function('window', 'document', 'location', 'history', 'matchMedia', 'navigator', uiSrc)
    (win, win.document, win.location, win.history, win.matchMedia, {});
  const UI = win.UI;
  ok(UI && typeof UI.kpi === 'function', 'kpi: the real UI.kpi loaded');

  const kpiFns = new Function('UI', 'esc',
    sliceFn(JS, 'kpi2') +
    '\nvar KPI_VARIANT = { "--pd-ok": "pd-kpi-ok", "--pd-warn": "pd-kpi-warn", "--pd-bad": "pd-kpi-bad" };' +
    '\nvar MS_VARIANT = { good: "pd-kpi-ok", warn: "pd-kpi-warn", bad: "pd-kpi-bad" };' +
    '\nreturn { kpi2: kpi2 };')(UI, s => String(s));

  const plain = kpiFns.kpi2('Planned to date', '42%');
  ok(/class="pd-kpi"/.test(plain), 'kpi2 emits the SHARED card');
  ok(!/po-kpi2/.test(plain), 'kpi2 emits no private class');
  ok(/pd-kpi-label/.test(plain) && /pd-kpi-value/.test(plain), 'kpi2 keeps label and value');

  /* ==== "pp" IS GONE FROM THE SCREEN ========================================================
     Owner 2026-09-17: *"what does the pp mean in the behind plan? it's not a widely used unit of
     measurement."* It was percentage points — correct, and read by almost nobody — and under a card
     headed "Behind plan" the minus sign made it a double negative.
     ⚠️⚠️ THE SHIPPED FORMATTER, NOT A COPY OF IT. `Fmt.vsPlan` is sliced out of db.js and
     run here, so this fails if the wording is reverted OR if the rounding stops deciding the word.
     ⚠️ The last case is the one that is easy to get wrong: +0.04 prints as "0.0", so it must
     say "on plan" rather than "0.0% ahead" — otherwise the number and the word disagree on screen. */
  {
    const DB = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'db.js'), 'utf8');
    const i = DB.indexOf('vsPlan: function'), j = DB.indexOf('moneyShort: function');
    if (i < 0 || j < 0 || j < i) throw new Error('SLICE FAILED: Fmt.vsPlan');
    const body = DB.slice(i, j).replace(/,\s*$/, '').replace(/^vsPlan:\s*/, '');
    const F = {};
    new Function('F', 'F.vsPlan = (' + body + ');')(F);
    eq(F.vsPlan(-4.2), '4.2% behind', 'vsPlan: behind is said in words, with no sign to misread');
    eq(F.vsPlan(4.2), '4.2% ahead', 'vsPlan: and ahead likewise');
    eq(F.vsPlan(0), 'on plan', 'vsPlan: dead level is neither');
    eq(F.vsPlan(0.04), 'on plan', 'vsPlan: and so is anything that ROUNDS to nothing');
    eq(F.vsPlan(null), '—', 'vsPlan: no measurement is a dash, not a zero');
    ok(!/ pp/.test(F.vsPlan(-4.2) + F.vsPlan(4.2) + F.vsPlan(0)),
       'vsPlan: the string "pp" appears nowhere in what it produces');
  }
  /* And the page itself must not have kept a second spelling. */
  ok(!/'\s*pp'|" pp"/.test(JS),
     'portfolio-overview no longer formats anything as "pp"');

  const bad = kpiFns.kpi2('Schedule Variance', '-8 pp', '--pd-bad');
  ok(/pd-kpi-bad/.test(bad), 'kpi2 maps --pd-bad to the shared semantic variant');
  ok(!/style="color:var\(--pd-bad\)/.test(bad),
     'kpi2 uses the variant, not an inline colour, so the accent bar is tinted too');
  ok(/pd-kpi-ok/.test(kpiFns.kpi2('x', '1', '--pd-ok')), 'kpi2 maps --pd-ok');
  ok(/pd-kpi-warn/.test(kpiFns.kpi2('x', '1', '--pd-warn')), 'kpi2 maps --pd-warn');

  /* ⚠️ An UNRECOGNISED token must still colour the value. Silently dropping it would
     make a caller's meaning disappear with no error — the failure this repo calls a
     silent nothing. */
  const odd = kpiFns.kpi2('x', '1', '--po-ms-info');
  ok(/var\(--po-ms-info\)/.test(odd), 'kpi2 falls back to an inline colour for an unknown token');

  /* ⚠️ `msKpi` was the Milestone calendar's own KPI vocabulary and went with that view
     (2026-09-16). Its assertions are not rewritten against `kpi2` -- that would be a new test
     wearing an old one's name; the "does not occur in this page at all" list above is what now
     covers it. */

  /* B6: one funnel for thirteen views, and every panel it names must exist. */
  const FP = JSON.parse(JSON.stringify(
    new Function('return ' + /var FILTER_PANEL = (\{[\s\S]*?\});/.exec(CODE)[1])()));
  eq(Object.keys(FP).length, 1,
     'filter: one view declares a panel — the Stakeholder Map took its own with it (2026-09-16)');
  ok(!FP.equipment, 'filter: the Equipment panel left with the Equipment view');
  Object.keys(FP).forEach(k =>
    ok(new RegExp('id="' + FP[k] + '"').test(html), 'filter: panel ' + FP[k] + ' exists in the markup'));
  eq((html.match(/class="pd-filttoggle"/g) || []).length, 1, 'filter: exactly ONE funnel in the markup');
  /* ⚠️⚠️ READ FROM THE STYLESHEET, NOT THE PAGE. The whole <style> block moved to
     assets/css/portfolio-dash.css on 2026-09-15, because the ten dashboards that now live in their
     own modules are drawn with these classes and a module cannot reach a <style> block inside
     another page. Asserting against the HTML here would have passed only until somebody looked. */
  const PODCSS = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'css', 'portfolio-dash.css'), 'utf8');
  ok(/\.po-topbar-tools \.pd-filttoggle\[hidden\]/.test(PODCSS),
     'filter: the [hidden] specificity tie is handled (inline-flex ties the UA rule)');
  ok(/portfolio-dash\.css/.test(html), 'and the page links the stylesheet those rules moved into');

  /* B9's series-segment checks went with scRenderChart — tools/test-portfolio-dash.js. */

  /* ============================================ 3c · the decision surface (D)
     Every derivation sliced out of the shipped page and executed. */
  function surface(ovX) {
    const body = 'var ovX = OVX;\n' +
      ['pd', 'num', 'variance', 'progressOf', 'isOverdue', 'behindPP', 'slipDays',
       'claimsOf', 'openIssues', 'flagsOf', 'rankSort'].map(n => sliceFn(JS, n)).join('\n') +
      '\nreturn { behindPP, slipDays, claimsOf, openIssues, flagsOf, rankSort };';
    return new Function('OVX', 'today', 'PDClaims', body)(
      ovX, () => new Date(2026, 8, 16), win.PDClaims || null);
  }
  // PDClaims is a separate shared file; load it the same way as ui.js.
  const claimsSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'claims.js'), 'utf8');
  new Function('window', claimsSrc)(win);
  ok(win.PDClaims && typeof win.PDClaims.pendingValue === 'function', 'D: the real PDClaims loaded');

  const ST = {
    // behind plan: (done - planned) / tot * 100
    ALPHA: { tot_dur: 100, planned_dur: 50, done_dur: 30 },   // -20 pp, badly behind
    BRAVO: { tot_dur: 100, planned_dur: 50, done_dur: 49 },   //  -1 pp, a shade behind
    CHARLIE: { tot_dur: 100, planned_dur: 40, done_dur: 55 }  // +15 pp, ahead
  };
  const S = surface({ status: ST, claims: [], ms: null, iss: [], err: {} });

  eq(Math.round(S.behindPP({ id: 'ALPHA' })), -20, 'D: behindPP is (actual − planned) over the weight');
  eq(Math.round(S.behindPP({ id: 'CHARLIE' })), 15, 'D: ahead of plan is POSITIVE');
  eq(S.behindPP({ id: 'NOPE' }), null, 'D: a project with no status row yields null, never 0');
  eq(surface({ status: null, claims: null, ms: null, iss: null, err: {} })
       .behindPP({ id: 'ALPHA' }), null, 'D: before the read lands it is null, not 0');
  /* ⚠️ A zero-weight project must not divide by zero and must not read as "on plan". */
  eq(surface({ status: { X: { tot_dur: 0, planned_dur: 0, done_dur: 0 } }, err: {} })
       .behindPP({ id: 'X' }), null, 'D: a zero-duration project yields null, not NaN or 0');

  /* slipDays uses forecast_finish || end_date — the rule the table already displays. */
  eq(S.slipDays({ schedule_finish: '2026-12-31', forecast_finish: '2026-12-01' }), 30,
     'D: slip counts days past the typed forecast');
  eq(S.slipDays({ schedule_finish: '2026-12-31', end_date: '2026-12-01' }), 30,
     'D: and falls back to the contract end date when no forecast is typed');
  eq(S.slipDays({ schedule_finish: '2026-11-01', forecast_finish: '2026-12-01' }), -30,
     'D: finishing early is negative, not clamped');
  eq(S.slipDays({ forecast_finish: '2026-12-01' }), null, 'D: no programme finish yields null');

  /* ⚠️⚠️ THE ORDERING FIXTURE IS BUILT SO ALPHABETICAL AND ATTENTION DISAGREE — otherwise
     the ranking could be right by accident. Alphabetically Alpha, Bravo, Charlie; by
     attention it must be Bravo (4 flags), Alpha (1), Charlie (0). */
  const P_ALPHA   = { id: 'ALPHA', name: 'Alpha', schedule_finish: '2026-09-01',
                      forecast_finish: '2026-09-30', estimated_cost: 1, original_budget: 1 };
  const P_BRAVO   = { id: 'BRAVO', name: 'Bravo', schedule_finish: '2027-06-30',
                      forecast_finish: '2026-01-01', estimated_cost: 900, original_budget: 100,
                      schedule_progress: 10 };
  const P_CHARLIE = { id: 'CHARLIE', name: 'Charlie', schedule_finish: '2026-09-01',
                      forecast_finish: '2026-12-31', estimated_cost: 100, original_budget: 100 };
  const S2 = surface({ status: ST, claims: [], ms: null, iss: [], err: {} });
  const order = [P_ALPHA, P_BRAVO, P_CHARLIE].sort(S2.rankSort).map(p => p.name);
  eq(order.join(' '), 'Bravo Alpha Charlie',
     'D: ranked Bravo · Alpha · Charlie where the alphabet says the reverse');
  eq(S2.flagsOf(P_CHARLIE).length, 0, 'D: a healthy project raises no flag');
  ok(order[order.length - 1] === 'Charlie',
     'D: and is still LISTED, at the bottom — a view that hides the healthy ones cannot say "these are fine"');
  ok(S2.flagsOf(P_BRAVO).length > S2.flagsOf(P_ALPHA).length,
     'D: more signals ranks higher');
  /* ⚠️ Every flag must be a NAMED reason, since the row's tooltip prints them. */
  ok(S2.flagsOf(P_BRAVO).every(f => typeof f === 'string' && f.length),
     'D: each raised signal names itself');

  /* ⚠️ Money and days never meet: exposure is money, EOT is days, and claimsOf keeps them
     in separate fields rather than summing them into one "exposure" figure. */
  const cl = surface({ status: ST, err: {}, claims: [
    { project_id: 'ALPHA', record_type: 'Cost Claim', status: 'Pending',
      sub_amount: 1000, eval_amount: 900, submitted_date: '2026-01-01' }
  ] }).claimsOf('ALPHA');
  ok(cl && typeof cl.exposure === 'number' && typeof cl.eotDays === 'number',
     'D: exposure (money) and eotDays (days) are separate fields');


  console.log('');
  console.log('portfolio-overview: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
}

/* ================================================================== D4 - the portfolio curve */
{
  const src = fs.readFileSync(PAGE, 'utf8');
  const fn = sliceFn(src, 'renderTrends');
  const mini = sliceFn(src, 'miniChart');
  const moLab = sliceFn(src, 'moLabelLocal');

  /* the hosts the renderer writes into */
  function hosts() {
    const h = { 'po-tr-sc': { innerHTML: '' }, 'po-tr-note': { innerHTML: '', textContent: '' } };
    return h;
  }
  function run(ovX) {
    const h = hosts();
    const document = { getElementById: (id) => h[id] || null };
    const esc = (x) => String(x == null ? '' : x);
    new Function('ovX', 'document', 'esc', mini + '\n' + moLab + '\n' + fn + '\n renderTrends();')
      (ovX, document, esc);
    return { html: h['po-tr-sc'].innerHTML, note: h['po-tr-note'].innerHTML || h['po-tr-note'].textContent };
  }

  const months = [new Date(2026,0,1), new Date(2026,1,1), new Date(2026,2,1), new Date(2026,3,1), new Date(2026,4,1)];
  const curve = { empty: false, months: months, TOT: 100,
                  plannedC: [10, 30, 50, 70, 90], actualC: [8, 22, 35, 0, 0],
                  ti: 2, plannedPct: 50, actualPct: 35, variance: -15 };

  const r = run({ err: {}, curve: { curve: curve, drawn: 3, failed: 0 } });
  ok(/<svg/.test(r.html), 'D4: a curve is drawn');

  /* ⚠️⚠️ THE ACTUAL LINE STOPS AT THE DATA DATE. Everything past `ti` is MODELLED, not recorded,
     and a confident actual line running into the future is the one thing this chart may not do.
     The planned line runs the whole span, so counting points tells the two apart. */
  const planPts = (r.html.match(/class="po-tr-plan" points="([^"]*)"/g) || []).join(' ');
  const actPts = (r.html.match(/class="po-tr-act" points="([^"]*)"/g) || []).join(' ');
  eq((planPts.match(/,/g) || []).length, 5, 'D4: the planned line covers all five months');
  eq((actPts.match(/,/g) || []).length, 3, 'D4: the actual line stops at the data date (3 of 5)');

  /* the marker and the data-date rule sit at ti */
  ok(/po-tr-now/.test(r.html), 'D4: the data date is marked');
  ok(/po-tr-mark/.test(r.html), 'D4: and the actual is dotted at it');

  /* ⚠️ the variance is in PERCENTAGE POINTS and labelled as a variance, not as progress */
  ok(/-15\.0 pts/.test(r.note), 'D4: the variance reads in percentage points');
  ok(/po-bad/.test(r.note), 'D4: a negative variance is toned as bad');
  ok(/50\.0% planned to date/.test(r.note) && /35\.0% actual/.test(r.note), 'D4: both figures are stated');
  ok(/3 project\(s\) drawn/.test(r.note), 'D4: and how many projects it was drawn over');

  const ahead = run({ err: {}, curve: { curve: Object.assign({}, curve, { variance: 4 }), drawn: 3, failed: 0 } });
  ok(/\+4\.0 pts/.test(ahead.note) && /po-ok/.test(ahead.note), 'D4: ahead of plan is signed and toned ok');

  /* ⚠️ a project that could not be read is COUNTED, never silently dropped from the picture */
  const partial = run({ err: {}, curve: { curve: curve, drawn: 2, failed: 1 } });
  ok(/1 could not be read/.test(partial.note), 'D4: a failed project is named in the note');

  /* the three states that are not a chart */
  ok(/could not be read/.test(run({ err: { curve: new Error('x') }, curve: null }).html),
     'D4: a failed read is named, not drawn as an empty chart');
  ok(/Reading the schedule roll-up/.test(run({ err: {}, curve: null }).html),
     'D4: a pending read says so');
  ok(/no curve to draw/.test(run({ err: {}, curve: { curve: { empty: true }, drawn: 0, failed: 0 } }).html),
     'D4: nothing baselined says so rather than drawing a flat line at zero');

  /* ⚠️ and the page must not have grown its own copy of the maths */
  const clean = scan.clean(REL, src);
  ok(clean.indexOf('function scMergeAggs') < 0 && clean.indexOf('function scComputeFromAgg') < 0,
     'D4: the page carries no copy of the merge or the agg->curve maths');
  ok(clean.indexOf('PDScurve.fanOutAgg') > 0, 'D4: it fans out through the shared engine');
}

report();
