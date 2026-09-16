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

/* ⚠️ THREE VIEWS, AND THE LIST IS THE POINT. Ten of the thirteen moved to the modules they
   describe (2026-09-15 and 2026-09-16); what a name left in here would buy is a green run
   over a loader this page no longer has. */
const VIEW_LOADER = {
  overview: 'loadOverview', milestones: 'loadMilestones', stakeholders: 'loadStakeholders'
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
  const s = dispatchSandbox('stakeholders');
  s.api.renderCurrent(); s.api.renderCurrent(); s.api.renderCurrent();
  eq(s.calls.filter(function (c) { return c[0] === 'renderAll'; }).length, 3,
     'three ticks repaint the Overview three times');
  s.flush();
  eq(s.calls.filter(function (c) { return c[0] === 'loadStakeholders'; }).length, 1,
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
  eq(keys.length, 3, 'viewLoaders names the two lazy views this page still hosts, plus Overview');
  /* ⚠️⚠️ AND NOT THE SIX THAT MOVED. Owner 2026-09-15: the dropdown was a second home for six
     modules, and their dashboards now live in the modules themselves
     (assets/js/portfolio-dash.js). A loader left behind here would be a second copy of a
     renderer that is no longer on this page — the drift the move exists to end. */
  ['risk', 'issues', 'meetings', 'contracts', 'photos', 'productivity',
   'scurve', 'cashflow', 'resources', 'equipment'].forEach(function (k) {
    ok(keys.indexOf(k) < 0, 'viewLoaders no longer names "' + k + '" — it moved to its module');
  });
  /* ⚠️⚠️ AND NEITHER DOES THE FILE. A loader can be dropped from the list and left in the
     source, where the next reader takes it for the live one — which is a second copy of a
     renderer, the exact fault this move exists to end. Every renderer of the four that left
     on 2026-09-16 must be GONE, not merely unreferenced. */
  ['loadScurve', 'scRenderChart', 'scComputeFromAgg', 'fetchScheduleForIds', 'scErrText',
   'loadCashflow', 'cfRenderChart', 'cfMonthlySeries',
   'loadResources', 'rsRenderTable',
   'loadEquipment', 'eqBuild', 'eqRenderGrid', 'eqExport'].forEach(function (fn) {
    eq((JS.match(new RegExp('\\b' + fn + '\\b', 'g')) || []).length, 0,
       fn + ' does not occur in this page at all any more');
  });
  /* ⚠️ A deep link to one of them must still resolve, to the module that owns it now. */
  const MOVED = new Function('return ' + /var PO_MOVED_VIEWS = (\{[\s\S]*?\});/.exec(JS)[1])();
  eq(Object.keys(MOVED).length, 10, 'all ten moved views still resolve from an old #po_view= link');
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
  /* ⚠️ And the three that stayed are NOT in the table, or the page would redirect to itself. */
  ['overview', 'milestones', 'stakeholders'].forEach(function (k) {
    ok(!MOVED[k], '"' + k + '" stays on this page and is not redirected');
  });
  ok(/location\.replace\(/.test(sw), 'switchView redirects rather than pushing a dead tab onto Back');
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
    sliceFn(JS, 'kpi2') + '\n' + sliceFn(JS, 'msKpi') +
    '\nvar KPI_VARIANT = { "--pd-ok": "pd-kpi-ok", "--pd-warn": "pd-kpi-warn", "--pd-bad": "pd-kpi-bad" };' +
    '\nvar MS_VARIANT = { good: "pd-kpi-ok", warn: "pd-kpi-warn", bad: "pd-kpi-bad" };' +
    '\nreturn { kpi2: kpi2, msKpi: msKpi };')(UI, s => String(s));

  const plain = kpiFns.kpi2('Planned to date', '42%');
  ok(/class="pd-kpi"/.test(plain), 'kpi2 emits the SHARED card');
  ok(!/po-kpi2/.test(plain), 'kpi2 emits no private class');
  ok(/pd-kpi-label/.test(plain) && /pd-kpi-value/.test(plain), 'kpi2 keeps label and value');

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

  const ms = kpiFns.msKpi('Overdue', '3', 'across 4 projects', 'bad');
  ok(/class="pd-kpi pd-kpi-bad"/.test(ms), 'msKpi maps its own good/warn/bad vocabulary');
  ok(/pd-kpi-sub/.test(ms), 'msKpi keeps its sub-line');
  ok(!/pd-kpi-sub/.test(kpiFns.msKpi('x', '1', '', '')),
     'msKpi emits no empty sub-line when there is nothing to say');

  /* B6: one funnel for thirteen views, and every panel it names must exist. */
  const FP = JSON.parse(JSON.stringify(
    new Function('return ' + /var FILTER_PANEL = (\{[\s\S]*?\});/.exec(CODE)[1])()));
  eq(Object.keys(FP).length, 2, 'filter: two views declare a panel — equipment took its own with it');
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

report();
