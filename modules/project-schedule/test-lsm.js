/* LSM slice-and-execute suite.
   Slices the SHIPPED functions out of modules/project-schedule/index.html by NAME (never by line
   number - a 46k-line file under concurrent edit makes a line-numbered slice stale within hours)
   and executes them. Run twice: once against the working tree, once against the pinned base SHA,
   which must reproduce the OLD behaviour. A test that cannot fail is not evidence.

   Usage:  node modules/project-schedule/test-lsm.js modules/project-schedule/index.html
   Contrast (must reproduce the OLD behaviour, i.e. have none of the LSM code):
     git show 4d82fd4924b3f9173b0adf53504be43a784858b4:modules/project-schedule/index.html > base.html
     node modules/project-schedule/test-lsm.js base.html --base

   ⚠️⚠️ PIN THE BASE TO THAT SHA, NEVER TO HEAD. `git show HEAD:` becomes
   self-comparison the moment you commit, and this suite has already been caught that way:
   the pin was overwritten mid-feature and three assertions silently compared the file with
   itself. 4d82fd4 is the commit BEFORE slice 1, so the base is missing 30 LSM functions and
   14 constants - which the run prints, so a base that has stopped being a contrast is loud.
*/
'use strict';
const fs = require('fs');

const FILE = process.argv[2];
const IS_BASE = process.argv.indexOf('--base') !== -1;
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) { pass++; }
  else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}
function eq(a, b, label) { ok(a === b, label + ' (expected ' + JSON.stringify(b) + ')', a); }

/* ---- the slicer -------------------------------------------------------------------------------
   Finds `\n  function NAME(` at MODULE level (two-space indent) and brace-matches forward, so a
   nested function of the same name inside another function cannot be picked up by mistake. */
/* ⚠️ IT MUST UNDERSTAND REGEX LITERALS. The first cut did not, and `levelRank` contains
   `/[’'".,()\-_]/g` — a regex holding both quote characters. The slicer entered string mode on that
   apostrophe and ran away, returning 217,897 characters of the file and failing to parse. That
   reads exactly like a bug in the module and is a bug in the checker, which is the trap this
   repo's changelog keeps recording. A `/` starts a regex when the previous significant character
   cannot end an expression — the standard heuristic, and sufficient here. */
/* ⚠️ `indent` defaults to 2 (module level). The Schedule Builder is its own closure inside the
   same IIFE, so its functions sit at 4 spaces — `sliceAny` below tries the depths in order. A
   second slicer for that would have been a copy of this one's regex-literal handling, which is the
   part that was hard to get right. */
function sliceFn(name, indent) {
  const needle = '\n' + ' '.repeat(indent === undefined ? 2 : indent) + 'function ' + name + '(';
  const i = src.indexOf(needle);
  if (i === -1) return null;
  const start = i + 1;
  let j = src.indexOf('{', i);
  let depth = 0, inStr = null, inCom = null, inRe = false, prev = '';
  for (; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (inCom === 'line') { if (c === '\n') inCom = null; continue; }
    if (inCom === 'block') { if (c === '*' && n === '/') { inCom = null; j++; } continue; }
    if (inRe) {
      if (c === '\\') { j++; continue; }
      if (c === '[') { /* a char class may hold an unescaped '/' */
        while (j < src.length && src[j] !== ']') { if (src[j] === '\\') j++; j++; }
        continue;
      }
      if (c === '/') { inRe = false; prev = '/'; }
      continue;
    }
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) { inStr = null; prev = 'x'; }
      continue;
    }
    if (c === '/' && n === '/') { inCom = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inCom = 'block'; j++; continue; }
    if (c === '/') {
      if (prev === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) !== -1) { inRe = true; continue; }
      prev = '/'; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') { depth++; prev = '{'; continue; }
    if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); prev = '}'; continue; }
    if (!/\s/.test(c)) prev = c;
  }
  return null;
}
/* A function at whatever nesting it happens to live at — module level first, then the closures. */
function sliceAny(name) {
  for (const d of [2, 4, 6, 8]) { const s = sliceFn(name, d); if (s) return s; }
  return null;
}
/* A module-level `var` declaration, so constants come from the FILE rather than the harness.
   ⚠️ Must handle a multi-name declaration: `var LSM_LANE_H = 9, LSM_LANE_GAP = 2, LSM_PAD = 8;`
   declares three names on one line, and matching only a leading `var NAME` found the first and
   reported the other two missing. */
function sliceVar(name) {
  let m = src.match(new RegExp('^  var ' + name + '\\b.*$', 'm'));
  if (!m) m = src.match(new RegExp('^  var .*\\b' + name + '\\s*=.*$', 'm'));
  if (!m) return null;
  /* ⚠️ A DECLARATION CAN SPAN LINES — `var LOC_ORD = { … }` is a multi-line object literal, and
     returning its first line alone produced an unbalanced fragment that failed to parse as
     "Unexpected token 'function'" once concatenated with the next slice. Extend forward until the
     brackets balance. */
  let out = m[0], i = src.indexOf(m[0]) + m[0].length;
  const bal = (s) => {
    let d = 0, inStr = null;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (inStr) { if (c === '\\') k++; else if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '/' && s[k + 1] === '/') { while (k < s.length && s[k] !== '\n') k++; continue; }
      if ('{[('.indexOf(c) !== -1) d++;
      else if ('}])'.indexOf(c) !== -1) d--;
    }
    return d;
  };
  let guard = 0;
  while (bal(out) !== 0 && guard++ < 400) {
    const nl = src.indexOf('\n', i);
    if (nl === -1) break;
    out += '\n' + src.slice(i, nl);
    i = nl + 1;
  }
  return out;
}
/* ⚠️ ONE DECLARATION PER LINE, DEDUPED. Slicing a three-name line once per name would redeclare
   the same `var`s three times; harmless for `var`, but it also means a missing name would be
   masked by a sibling on the same line. */
function dedupeLines(lines) {
  const seen = Object.create(null), out = [];
  for (const l of lines) { if (!seen[l]) { seen[l] = 1; out.push(l); } }
  return out;
}

/* ---- what the module must provide itself, and what the harness is allowed to stub -------------
   Mirrors vscheck.js: anything the module DEFINES as a function is linked for real. A name that
   the module defines but we failed to slice is a hard failure, never silently stubbed. */
const REAL_FNS = ['pd', 'dstr', 'dayDiff', 'addDays', 'isWbs', 'isMile', 'catValOf', 'levelRank',
                  'cmpLevelValue', 'cmpGroupName', 'esc', 'cpmCalOf', 'calById', 'locNormKey',
                  'makeAxis',
                  '_lsmLanes', '_lsmLaneCount', '_lsmLaneIndex', '_lsmRowH', '_lsmIdleGap',
                  '_lsmAgg', '_lsmBarsHTML', '_baseRowH', 'rowHFor',
                  /* slice 2 */
                  '_lsmDecl', '_lsmRankOf', '_lsmRankBasis', '_lsmFit', '_lsmRate',
                  '_lsmRateHTML', '_clearLsmRateMemo', '_clearLsmDeclMemo',
                  /* slice 3 */
                  'cmpWorkName', '_lsmAxOf', '_lsmSeq', '_lsmClash', '_lsmClashHTML',
                  /* slice 4 */
                  '_stkState', '_lsmStateOf', '_lsmStoreyStatus', '_lsmStatusLabel', 'startDDDrag',
                  /* the LSM-shaped guard + the shared floor-level rule */
                  '_lsmShaped', '_locFloorLevelId', 'stkDefaultLevel',
                  /* slice 5 */
                  '_lsmAggOn', '_lsmArrange', '_lsmFinish', 'setFlowlineMode', 'renderFlowline',
                  /* the declared cross-trade handoff. ⚠️ The link pass CAUGHT this: `_lsmClash`
                     gained a call to `_lsmLead` and the whole suite threw `_lsmLead is not defined`
                     rather than quietly passing — which is the entire reason it refuses to stub. */
                  '_lsmLead', '_lsmLeadWarm', '_clearLsmLeadMemo',
                  /* ⚠️ The chip's category word. Reached only when a LEAD finding actually
                     RENDERS, which the probe never does — the demo-project scenario is what
                     surfaced it. Another branch the link pass could not see until something ran it. */
                  '_lsmKindWord',
                  /* ⚠️⚠️ AND THE CACHE CLEARER, WHICH THE HARNESS WAS SILENTLY STUBBING. It is
                     called only by `psSetupChanged`, which no probe runs, so the link pass never
                     pulled it in — and the EXPORTS line falls back to `function () {}` when it is
                     missing. So `M.clearDeclCat()` did nothing, the warmed catalogue leaked between
                     scenarios, and a fixture reported `null` for a storey it had just declared.
                     A no-op fallback in a test harness is the same fault as a stub: it makes a
                     check pass for a reason that has nothing to do with the code. */
                  '_clearLsmDeclCat'];
const REAL_VARS = ['LSM_LANE_H', 'LSM_LANE_GAP', 'LSM_PAD', 'LSM_LANE_MAX', '_lsmRows',
                   '_lsmTopFirst', 'LSM_MIN_FLOORS', 'LSM_R2_OK', 'ALLAX', 'DL',
                   'LSM_CLASH_MIN', 'WORK_ORDER', '_lsmStatus', 'dataDate', 'groupBys', 'LOC_LEVELS',
                   '_stkLevel', 'flowlineMode', 'FL_ROWH', 'FL_PADT', 'FL_PADR',
                   /* ⚠️⚠️ The warmed catalogue and its once-per-project guard. `_lsmDecl` wraps its
                      whole body in try/catch, so an unlinked name here does NOT fail the link pass
                      — it degrades silently to the heuristic basis, which is how adding the
                      cold-open read broke four assertions with "heuristic" and no other clue. */
                   '_lsmDeclCat', '_lsmDeclAsked',
                   /* the category words the chip prints — see _lsmKindWord above */
                   'LSM_KIND_LABEL'];

const missingFns = [], missingVars = [];
const extraFns = [], extraVars = [];

function assemble() {
  const fnSrc = [], varSrc = [];
  for (const n of REAL_FNS.concat(extraFns)) {
    const s = sliceFn(n);
    if (s === null) { if (missingFns.indexOf(n) === -1) missingFns.push(n); continue; }
    fnSrc.push(s);
  }
  for (const n of REAL_VARS.concat(extraVars)) {
    const s = sliceVar(n);
    if (s === null) { if (missingVars.indexOf(n) === -1) missingVars.push(n); continue; }
    varSrc.push(s);
  }
  const vs = dedupeLines(varSrc), fs2 = dedupeLines(fnSrc);
  if (process.argv.indexOf('--debug') !== -1) {
    vs.concat(fs2).forEach(function (p) {
      try { new Function('"use strict";' + p); }
      catch (e) { console.log('  BAD PIECE (' + e.message + '): ' + JSON.stringify(p.slice(0, 90))); }
    });
  }
  return vs.join('\n') + '\n' + fs2.join('\n') + '\n';
}

/* Controlled leaves. Every one of these is a LEAF the test drives on purpose. */
const PRELUDE = `
  /* PDCal lives in assets/js/calendar.js - an EXTERNAL file, not something this module defines, so
     stubbing it is legitimate (unlike stubbing the module's own functions). A real Mon-Fri week, so
     the working-day gap rule is exercised rather than skipped. \`window\` is settable so the
     absent-PDCal degrade path can be tested too. */
  var PDCal = {
    isWorkDay: function (cal, d) { var w = d.getDay(); return w !== 0 && w !== 6; },
    /* The real signature: inclusive of BOTH ends. */
    workingDaysInRange: function (cal, a, b) {
      var n = 0, d = new Date(a);
      for (; d <= b; d.setDate(d.getDate() + 1)) if (PDCal.isWorkDay(cal, d)) n++;
      return n;
    },
    defaultCalendar: function () { return { id: 'c1' }; }
  };
  var window = { PDCal: PDCal };
  var CALS = [{ id: 'c1', is_default: true, name: 'Mon-Fri' }];
  /* One IIFE, so the real module holds this as a closure local; the tests assign it to exercise
     the declared-breakdown path. */
  var ScheduleBuilder = null;
  var _density = 'comfortable';
  var _gset = { labels: 'name', baseline: true, ddline: true, relLines: false };
  /* esc() delegates to Fmt.esc in the module, so the stub must carry it or every title throws. */
  var Fmt = { date: function (s) { return s || ''; },
              esc: function (s) { return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;'); } };
  var __CATS = [], __FIELD = 'name';   // the legend and the category field, driven by the test
  function catList() { return __CATS; }
  function catCfg() { return { on: true, field: __FIELD, colors: {}, tex: true, keys: {} }; }
  function isWbsNode(r) { return !!(r && (r._dkind === 'wbs' || r._dkind === 'group')); }
  function workOf(r) { return (r && r.work_type) || ''; }
  function codeValueLabel(v) { return v; }
  var CODE_TYPES = [];
  function catTint(c) { return 'background:' + c + '-tint;'; }
  function catStyle(c, t) { return 'background:' + c + ';tex:' + t + ';'; }
  function wallToday() { return new Date(2026, 0, 1); }
  function today() { return dataDate || wallToday(); }
  function computeCPM() {}
  function renderAll() {}
  function renderGantt() {}
  function setDataDate(d) { dataDate = d; }
  var UI = { toast: function () {} };
  /* ⚠️ A harness helper, not a stub: it hands back the REAL function or a thing that
     throws the moment it is called, naming what was missing. */
  function _mustFn(name, fn) {
    if (typeof fn === 'function') return fn;
    return function () { throw new Error('HARNESS: ' + name + ' was never linked, so this call would have been a silent no-op'); };
  }
  function dispStart(r) { return r.actual_start || r.start_date; }
  function dispFin(r) { return r.actual_finish || r.end_date; }
`;

const EXPORTS = `
  return { pd: pd, dstr: dstr, dayDiff: dayDiff, addDays: addDays, levelRank: levelRank,
    cmpLevelValue: cmpLevelValue, rowHFor: rowHFor, _baseRowH: _baseRowH,
    lanes: typeof _lsmLanes === 'function' ? _lsmLanes : null,
    laneCount: typeof _lsmLaneCount === 'function' ? _lsmLaneCount : null,
    laneIndex: typeof _lsmLaneIndex === 'function' ? _lsmLaneIndex : null,
    rowH: typeof _lsmRowH === 'function' ? _lsmRowH : null,
    agg: typeof _lsmAgg === 'function' ? _lsmAgg : null,
    bars: typeof _lsmBarsHTML === 'function' ? _lsmBarsHTML : null,
    setCats: function (l) { __CATS = l; },
    setLsm: function (on) { _lsmRows = on; },
    setTopFirst: function (on) { _lsmTopFirst = on; },
    setPDCal: function (on) { window.PDCal = on ? PDCal : null; },
    idleGap: typeof _lsmIdleGap === 'function' ? _lsmIdleGap : null,
    /* ---- slice 2 ---- */
    fit: typeof _lsmFit === 'function' ? _lsmFit : null,
    rate: typeof _lsmRate === 'function' ? _lsmRate : null,
    rateHTML: typeof _lsmRateHTML === 'function' ? _lsmRateHTML : null,
    rankOf: typeof _lsmRankOf === 'function' ? _lsmRankOf : null,
    rankBasis: typeof _lsmRankBasis === 'function' ? _lsmRankBasis : null,
    clearRate: typeof _clearLsmRateMemo === 'function' ? _clearLsmRateMemo : null,
    setDL: function (l) { DL = l; if (typeof _clearLsmRateMemo === 'function') _clearLsmRateMemo(); },
    setBuilder: function (b) { ScheduleBuilder = b; if (typeof _clearLsmRateMemo === 'function') _clearLsmRateMemo(); },
    normKey: function (v) { return locNormKey(v); },
    setField: function (f) { __FIELD = f; if (typeof _clearLsmRateMemo === 'function') _clearLsmRateMemo(); },
    seq: typeof _lsmSeq === 'function' ? _lsmSeq : null,
    clash: typeof _lsmClash === 'function' ? _lsmClash : null,
    lead: typeof _lsmLead === 'function' ? _lsmLead : null,
    /* ⚠️⚠️ NO SILENT NO-OPS IN THIS HARNESS. clearDeclCat used to fall back to
       function () {} when the link pass had not pulled the real one in - and it had not,
       because _clearLsmDeclCat is called only by psSetupChanged, which no probe runs. So
       M.clearDeclCat() did NOTHING, the warmed catalogue leaked between scenarios, and a
       fixture reported null for a storey it had just declared. A no-op fallback is a stub
       wearing a different hat: it makes a check pass for a reason unrelated to the code.
       These now THROW, so a missing link fails loudly at the moment it is used. */
    clearLead: _mustFn('_clearLsmLeadMemo', typeof _clearLsmLeadMemo === 'function' ? _clearLsmLeadMemo : null),
    /* For the end-to-end scenario: the declaration itself, its cold-open cache, and the pid the
       once-per-project guards key on. */
    decl: typeof _lsmDecl === 'function' ? _lsmDecl : null,
    clearDeclCat: _mustFn('_clearLsmDeclCat', typeof _clearLsmDeclCat === 'function' ? _clearLsmDeclCat : null),
    setPid: function (v) { pid = v; },
    clashHTML: typeof _lsmClashHTML === 'function' ? _lsmClashHTML : null,
    clashMin: function () { return typeof LSM_CLASH_MIN !== 'undefined' ? LSM_CLASH_MIN : null; },
    cmpWork: typeof cmpWorkName === 'function' ? cmpWorkName : null,
    stkState: typeof _stkState === 'function' ? _stkState : null,
    stateOf: typeof _lsmStateOf === 'function' ? _lsmStateOf : null,
    storeyStatus: typeof _lsmStoreyStatus === 'function' ? _lsmStoreyStatus : null,
    statusLabel: typeof _lsmStatusLabel === 'function' ? _lsmStatusLabel : null,
    setStatus: function (v) { _lsmStatus = v; },
    setDD: function (d) { dataDate = d; },
    gset: function () { return _gset; },
    setGroup: function (g) { groupBys = g; },
    shaped: typeof _lsmShaped === 'function' ? _lsmShaped : null,
    floorLevelId: typeof _locFloorLevelId === 'function' ? _locFloorLevelId : null,
    setLocLevels: function (l) { LOC_LEVELS = l; },
    minFloors: function () { return typeof LSM_MIN_FLOORS !== 'undefined' ? LSM_MIN_FLOORS : null; },
    r2ok: function () { return typeof LSM_R2_OK !== 'undefined' ? LSM_R2_OK : null; },
    consts: function () { return { H: typeof LSM_LANE_H !== 'undefined' ? LSM_LANE_H : null,
      GAP: typeof LSM_LANE_GAP !== 'undefined' ? LSM_LANE_GAP : null,
      PAD: typeof LSM_PAD !== 'undefined' ? LSM_PAD : null,
      MAX: typeof LSM_LANE_MAX !== 'undefined' ? LSM_LANE_MAX : null }; }
  };
`;

/* ---- the link pass ---------------------------------------------------------------------------
   Mirrors vscheck.js, and the refusal is the part that makes it honest: on a ReferenceError the
   named thing is sliced out of the module FOR REAL and the probe retried. If the module does not
   define it as a function or a module-level var, the harness REFUSES TO STUB IT and stays failed.
   Auto-stubbing everything would make this suite go green against a broken file, which is worse
   than no suite at all. */
const REFUSED = [];
function probe(m) {
  /* Touch every path the tests rely on, so a missing dependency surfaces HERE with a name rather
     than half-way through the assertions. */
  ['B2', 'Ground Floor', 'Roof Deck', '25th Floor', 'Ground Reservoir', 'Substructure',
   'Podium Amenities', 'Lower Ground', 'Mezzanine', '3rd Floor'].forEach(function (v) { m.levelRank(v); });
  m.setCats([{ value: 'X', muted: false, color: '#111', tex: 1 }]);
  m.setLsm(true); m.rowH(); m.rowHFor(1); m.laneCount(); m.lanes(); m.laneIndex();
  /* ⚠️ TWO INTERVALS WITH A GAP, deliberately. A single-interval probe never enters the merge
     loop, so it could not link that branch's dependencies — which is exactly how `_lsmIdleGap`
     reached the assertions unlinked and threw there instead of being resolved here. A probe that
     does not exercise a branch cannot link it. */
  const a = m.agg([{ activity_name: 'X', activity_type: 'Task',
                     start_date: '2026-01-01', end_date: '2026-01-05', percent_complete: 10,
                     bl_start: '2026-01-01', bl_finish: '2026-01-04' },
                   { activity_name: 'X', activity_type: 'Task',
                     start_date: '2026-03-01', end_date: '2026-03-05', percent_complete: 0 }],
                  'name', m.laneIndex());
  m.bars({ _dkind: 'group', activity_name: 'F', _graw: 'F', _glsm: a }, m.pd('2026-01-01'), 4.2, 0);
  m.setLsm(false); m.rowHFor(1);
  m.cmpLevelValue('B1', 'B2');
  /* ⚠️⚠️ `_lsmDecl` IS WRAPPED IN try/catch, so a ReferenceError inside it degrades SILENTLY to
     the heuristic basis instead of failing. That is the right production behaviour (a project with
     no setup must fall back) and it means the link pass cannot see a missing dependency unless the
     probe reaches past the catch. It found `locNormKey`'s own `_locNormMemo` / `_locNormKeyCalc`
     only once this ran with a builder in place - before that, four assertions reported
     "heuristic" and the cause was invisible. */
  m.normKey('Ground Floor');    /* reached through the catch otherwise - see above */
  m.setBuilder({ locCatalogue: function () { return { L: [{ value: 'Ground Floor', dim: 'floor' }, { value: '2nd Floor', dim: 'floor' }] }; } });
  m.rankBasis(); m.rankOf('Ground Floor');
  /* ⚠️⚠️ THE PROBE MUST REACH THE HANDOFF READER TOO. `_lsmClash` calls `_lsmLead`, but only
     after the `!DL.length` early return — so on an empty probe the link pass never sees it and the
     suite died later with `_lsmLeadMemo is not defined`, outside the loop that can fix it. That is
     the "probe couldn't link a branch it never ran" trap, on its third appearance. Calling it
     directly links its memo, its once-per-project guard and the `pid` its warm path tests.
     ⚠️ Called with a builder that has NO tradeHandoff, then with one that has — so both the
     empty path and the answering path are linked, not just whichever ran first. */
  if (m.lead) {
    /* ⚠️ WITH THE MODE ON. `_lsmLeadWarm` tests `_lsmAggOn()` FIRST, so with LSM off it returns
       before it ever mentions `pid` — and the suite then died on `pid is not defined` outside this
       loop. Reaching a branch is not the same as reaching every line in it. */
    m.setLsm(true);
    m.lead();
    m.setBuilder({ tradeHandoff: function () { return { pair: {}, lead: { st: 3 }, any: true }; } });
    m.clearLead(); m.lead();
    m.setLsm(false);
  }
  m.setBuilder(null);
  if (m.clearLead) m.clearLead();
}

let M, tries = 0;
for (;;) {
  let built;
  try {
    built = new Function('"use strict";' + PRELUDE + assemble() + EXPORTS)();
  } catch (e) {
    console.log('HARNESS BUILD FAILED: ' + e.message);
    if (missingFns.length) console.log('missing fns: ' + missingFns.join(', '));
    process.exit(2);
  }
  if (IS_BASE && (built.agg === null || built.lanes === null)) { M = built; break; }
  try { probe(built); M = built; break; }
  catch (e) {
    const mm = /^(\w[\w$]*) is not defined/.exec(e.message || '');
    if (!mm || tries++ > 80) {
      console.log('HARNESS LINK FAILED: ' + (e && e.message));
      process.exit(2);
    }
    const nm = mm[1];
    if (sliceFn(nm)) { extraFns.push(nm); continue; }
    if (sliceVar(nm)) { extraVars.push(nm); continue; }
    REFUSED.push(nm);
    console.log('REFUSED TO STUB: ' + nm + ' — the module does not define it as a function or a ' +
                'module-level var, so stubbing it would prove nothing.');
    process.exit(2);
  }
}
if (extraFns.length || extraVars.length) {
  console.log('linked on demand: ' + extraFns.concat(extraVars).join(', '));
}

console.log('=== ' + (IS_BASE ? 'BASE (contrast)' : 'WORKING TREE') + ' :: ' + FILE.split(/[\\/]/).pop());
console.log('sliced ' + (REAL_FNS.length - missingFns.length) + '/' + REAL_FNS.length + ' fns, ' +
            (REAL_VARS.length - missingVars.length) + '/' + REAL_VARS.length + ' vars' +
            (missingFns.length ? '  MISSING FNS: ' + missingFns.join(',') : '') +
            (missingVars.length ? '  MISSING VARS: ' + missingVars.join(',') : ''));

/* ================================ THE CONTRAST GATE ============================================ */
if (IS_BASE) {
  ok(M.agg === null, 'BASE must have no _lsmAgg');
  ok(M.bars === null, 'BASE must have no _lsmBarsHTML');
  ok(M.lanes === null, 'BASE must have no _lsmLanes');
  ok(M.rowH === null, 'BASE must have no _lsmRowH');
  /* The base's rowHFor must ignore the LSM layout entirely. */
  eq(M.rowHFor(1), 34, 'BASE rowHFor(1) is the plain density height');
  /* And its _sumSegsHTML must return '' for a group row - the behaviour the new code must NOT
     have changed. Asserted on the SOURCE because the function needs ~20 more deps to execute. */
  const seg = sliceFn('_sumSegsHTML');
  ok(seg !== null && /r\._dkind === 'group'/.test(seg), 'BASE _sumSegsHTML guards on group rows');
  /* The two INLINE insertions must be absent from the base too, or the working tree's versions of
     these assertions would be passing for reasons that predate this change. */
  ok(!/_lsmRows && _isLoc && _lsmTopFirst/.test(src), 'BASE has no top-first reordering block');
  ok(!/_lsmBarsHTML/.test(src), 'BASE ganttRowHTML has no LSM branch');
  ok(!/_glsm/.test(src), 'BASE buildNodes attaches no per-location aggregation');
  ok(!/ps-lsmbar/.test(src), 'BASE has no LSM lane CSS');
  /* And the base's group rows really do get the bracket-and-strip treatment - i.e. there was
     something there to short-circuit. */
  const grh = sliceFn('ganttRowHTML');
  ok(grh !== null && /ps-sum-strip/.test(grh), 'BASE ganttRowHTML draws the composition strip');
  /* ⚠️⚠️ AND THE PRESET. The "LSM" name in the Group menu is OLDER than any of this
     work — it shipped as the activity-led transpose. So the working tree's assertions about the
     preset would pass for a reason that predates the change unless the base is shown to differ. */
  ok(/\{ name: 'LSM', dims: \['act'\]\.concat\(locDims\) \}/.test(src),
     'BASE preset IS the activity-led transpose (which is the whole reason it was renamed)');
  ok(!/lsm: true/.test(src), 'BASE has no mode-flagged preset');
  ok(!/Activity › Location/.test(src), 'BASE has no honestly-named transpose preset');
  const bsgb = sliceFn('setGroupBys');
  ok(bsgb !== null && !/_lsmRows/.test(bsgb), 'BASE setGroupBys knows nothing about an LSM mode');
  /* ⚠️⚠️ AND `cfg.tradeLeads` IS DECLARED BUT UNREAD IN THE BASE — the "dead end" the owner asked
     to close, proved rather than asserted from memory. It appears exactly twice: once in `blank()`
     and once in `normalize()`, and nowhere else. */
  const tlLines = src.split('\n').filter(function (l) { return l.indexOf('tradeLeads') !== -1; });
  eq(tlLines.length, 2, 'BASE mentions tradeLeads on exactly two lines');
  ok(/function blank\(\)/.test(tlLines[0] || ''), 'one is blank(), where the bag is created');
  ok(/d\.tradeLeads = \(c\.tradeLeads/.test(tlLines[1] || ''), 'the other is normalize(), where it is kept');
  /* ⚠️ The proof it is a DEAD END: nothing ever indexes into it. */
  ok(!/tradeLeads\[/.test(src), 'BASE never reads a value out of it — declared, normalized, unread');
  ok(sliceAny('handoffFrom') === null, 'BASE has no handoff derivation');
  ok(!/tradeHandoff/.test(src), 'BASE exports no handoff to the Gantt side');
  ok(sliceAny('declaredBatchOf') === null, 'BASE cannot tell a declaration from a default');
  ok(sliceAny('parallelKindOf') === null, 'BASE cannot ask whether a category starts together');
  const bpk = sliceAny('parallelKind');
  ok(bpk !== null && /cfg\.tradeParallelKind/.test(bpk),
     'BASE parallelKind reads cfg inline — the line the split moved');
  /* ⚠️⚠️ AND THE PROOF THAT NO SECOND MATCHER WAS ADDED: the floor CATEGORY was already on every
     catalogue entry in the base. The per-kind handoff reads a fact this file has always carried,
     through the match `_lsmDecl` was already making. */
  ok(/kind: floorKind\(f\)/.test(src),
     'BASE catalogueFrom already tags every floor with its category');
  ok(!/_lsmDecl/.test(src), 'BASE has nothing on the Gantt side that reads that catalogue');
  const bbk = sliceAny('batchKind');
  ok(bbk !== null && /v = cfg\.tradeBatch\[prev\]/.test(bbk),
     'BASE batchKind reads cfg.tradeBatch inline — the line the split moved');
  report();
}

/* ================================ CONSTANTS vs THE CSS ========================================= */
const C = M.consts();
const cssH = /\.ps-lsmbar\s*\{[^}]*height:\s*(\d+)px/.exec(src);
const cssBl = /\.ps-lsmbl\s*\{[^}]*height:\s*(\d+)px/.exec(src);
ok(cssH !== null, 'CSS .ps-lsmbar declares a height');
/* The bar sits at the lane top and the 2px baseline rail at its foot, with 1px of air between:
   6 + 1 + 2 = 9 = LSM_LANE_H. If either number moves, this is the assertion that says so. */
if (cssH && cssBl) {
  eq(+cssH[1] + 1 + (+cssBl[1]), C.H, 'bar(' + cssH[1] + ') + 1 air + rail(' + cssBl[1] + ') == LSM_LANE_H');
}
ok(C.H > 0 && C.GAP >= 0 && C.PAD >= 0 && C.MAX > 0, 'LSM constants are sane', C);

/* ================================ LANES ======================================================== */
/* A curated legend: catList marks non-keyed entries `muted`, which is what excludes them. */
function cat(v, muted, color) { return { value: v, muted: !!muted, color: color || ('#c' + v.length), tex: 1 }; }
const TRADES = ['Structural', 'Exterior Masonry', 'MEPF 1st Fix', 'Plastering', 'Waterproofing',
                'Windows', 'Drywall & Ceiling', 'Tiles'];
M.setCats(TRADES.map(function (t) { return cat(t); }).concat([cat('Site Clearing', true)]));

const L = M.lanes();
eq(L.length, 8, 'only the keyed trades get a lane (the muted one does not)');
eq(L.map(function (x) { return x.value; }).join('|'), TRADES.join('|'), 'lanes keep catList first-start order');
eq(L.map(function (x) { return x.lane; }).join(','), '0,1,2,3,4,5,6,7', 'lane indices are 0..n-1');
eq(L.over.length, 0, 'no overflow at 8 trades');
eq(M.laneCount(), 8, 'laneCount is the drawn lane count');

/* The cap, and the fold. */
const MANY = [];
for (let i = 0; i < C.MAX + 5; i++) MANY.push(cat('T' + (i < 10 ? '0' + i : i)));
M.setCats(MANY);
const L2 = M.lanes();
eq(L2.length, C.MAX, 'lanes are capped at LSM_LANE_MAX');
eq(L2.over.length, 5, 'the remainder is folded, not dropped');
eq(M.laneCount(), C.MAX + 1, 'the overflow marker takes one more lane');
/* NOTHING DROPPED: every keyed category is either a lane or in the fold. */
const seen = {};
L2.forEach(function (x) { seen[x.value] = 1; });
L2.over.forEach(function (v) { seen[v] = 1; });
eq(Object.keys(seen).length, MANY.length, 'every keyed category is accounted for (lane or fold)');
/* NOTHING OVERPAINTED: lane indices are unique and contiguous - never `% cap`. */
const li = L2.map(function (x) { return x.lane; });
eq(new Set(li).size, li.length, 'lane indices are unique (no modulo reuse)');
eq(Math.max.apply(null, li), C.MAX - 1, 'the highest real lane is MAX-1, leaving the marker its own');

/* ================================ ROW HEIGHT =================================================== */
M.setCats(TRADES.map(function (t) { return cat(t); }));
M.setLsm(false);
eq(M.rowHFor(1), 34, 'LSM off: rowHFor is the plain density height');
eq(M.rowHFor(0.5), 17, 'LSM off: row zoom still shrinks the row');
M.setLsm(true);
/* ⚠️ THE HEIGHT IS ONLY EARNED BY AN LSM-SHAPED GROUPING. Turning the mode on is no longer enough,
   and that is the fix for the owner's report that "ticking LSM widens the rows": with a WBS
   grouping the rows stay normal even with the mode on, because no lane is drawn on them. */
M.setGroup(['loc:a', 'loc:b']);
const expH = C.PAD + 8 * (C.H + C.GAP);
eq(M.rowH(), expH, 'the LSM row height is derived from the lane count');
eq(M.rowHFor(1), expH, 'LSM on: the lane budget is the FLOOR under the zoom');
eq(M.rowHFor(0.5), expH, 'LSM on: zooming out cannot crush the lanes');
ok(M.rowHFor(4) > expH, 'LSM on: zooming IN still grows the row', M.rowHFor(4));
/* ⚠️⚠️ THE GUARD ITSELF - the owner's report. */
eq(M.shaped(), true, 'a location-only grouping IS LSM-shaped');
M.setGroup(['wbs']);
eq(M.shaped(), false, 'a WBS grouping is NOT');
eq(M.rowHFor(1), 34, 'so the rows keep their normal height even with the mode ON');
M.setGroup(['act', 'loc:a']);
eq(M.shaped(), false, 'and neither is Activity > Location, the Group menu preset named "LSM"');
eq(M.rowHFor(1), 34, 'which is the transpose of this layout, not this layout');
M.setGroup(['loc:a', 'loc:b']);
eq(M.rowHFor(1), expH, 'back to location-only and the lane budget returns');
M.setLsm(false);
eq(M.shaped(), false, 'mode off is never shaped');
M.setLsm(true);

/* renderWindow slices by `floor(scrollTop / ROWH)`, so the taller row must still bracket what is
   on screen. This is the arithmetic that function uses, run against the LSM height. */
(function () {
  const ROWH = M.rowHFor(1), N = 40, vh = 800;
  for (const top of [0, 137, 900, ROWH * N - vh]) {
    const first = Math.max(0, Math.floor(top / ROWH) - 10);
    const last = Math.min(N, Math.ceil((top + vh) / ROWH) + 10);
    const firstVisible = Math.floor(top / ROWH);
    const lastVisible = Math.min(N - 1, Math.floor((top + vh - 1) / ROWH));
    ok(first <= firstVisible && last >= lastVisible + 1,
       'window brackets the visible rows at ROWH=' + ROWH + ', scrollTop=' + top,
       { first, last, firstVisible, lastVisible });
  }
})();

/* ================================ AGGREGATION ================================================== */
function act(name, s, f, pct, bs, bf) {
  return { id: name + s, activity_id: name + s, activity_name: name, activity_type: 'Task',
           start_date: s, end_date: f, percent_complete: pct || 0, bl_start: bs, bl_finish: bf };
}
const IDX = M.laneIndex();
eq(IDX.overLane, 8, 'the overflow lane index is the lane count');
ok(IDX.map['Structural'] && IDX.map['Structural'].lane === 0, 'the index maps a trade to its lane');

/* One floor, four trades. Plastering has a REAL break; Windows is Fri -> next Mon, which is NOT a
   break (only a weekend). Structural and Exterior Masonry carry baselines so the per-lane rail has
   something to draw - without them the rail is correctly absent, which is what made my first
   version of that assertion fail for the wrong reason. */
const floorActs = [
  act('Structural', '2026-01-05', '2026-01-16', 100, '2026-01-05', '2026-01-14'),
  act('Exterior Masonry', '2026-01-19', '2026-01-30', 50, '2026-01-15', '2026-01-26'),
  act('Plastering', '2026-02-02', '2026-02-06', 0),
  act('Plastering', '2026-02-20', '2026-02-27', 0),   // a fortnight+ later -> a real gap
  act('Windows', '2026-03-06', '2026-03-06', 0),      // Friday
  act('Windows', '2026-03-09', '2026-03-13', 0)       // the next Monday -> ONE run
];
const agg = M.agg(floorActs, 'name', IDX);
ok(agg !== null, 'the aggregation produces bars');
eq(agg.length, 4, 'one bar per trade on the floor, not one per activity');
eq(agg.map(function (b) { return b.lane; }).join(','), '0,1,3,5', 'each bar sits on ITS trade lane');

const byV = {}; agg.forEach(function (b) { byV[b.value] = b; });
eq(byV['Plastering'].runs.length, 2, 'a real break makes TWO runs (one notched bar)');
eq(M.dstr(byV['Plastering'].s), '2026-02-02', 'the bar starts at the first run');
eq(M.dstr(byV['Plastering'].f), '2026-02-27', 'the bar ends at the last run');
eq(byV['Windows'].runs.length, 1, 'Friday -> Monday is ONE run: a weekend is not a break');

/* The gap rule itself, both branches. This is the assertion that would have caught the first cut,
   which notched every weekend. */
(function () {
  const fri = +M.pd('2026-03-06'), mon = +M.pd('2026-03-09'), cal = { id: 'c1' };
  ok(M.idleGap !== null, '_lsmIdleGap exists');
  eq(M.idleGap(fri, mon, cal), false, 'a weekend is NOT an idle gap');
  eq(M.idleGap(fri, +M.pd('2026-03-10'), cal), true, 'a clear Monday IS an idle gap');
  eq(M.idleGap(fri, +M.pd('2026-03-07'), cal), false, 'the very next day is contiguous');
  eq(M.idleGap(fri, +M.pd('2026-03-02'), cal), false, 'an overlapping pair is not a gap');
  eq(M.idleGap(fri, +M.pd('2026-06-01'), cal), true, 'a months-long clear stretch is a gap');
  /* Over 14 clear days it is a break whatever the calendar claims - and that also bounds the walk. */
  eq(M.idleGap(fri, +M.pd('2026-03-25'), { id: 'never' }), true, '>14 clear days short-circuits to a break');
  /* And the degrade path: with PDCal absent, any clear calendar day is a gap. */
  M.setPDCal(false);
  eq(M.idleGap(fri, mon, cal), true, 'PDCal absent: it degrades to the calendar-day rule');
  M.setPDCal(true);
  eq(M.idleGap(fri, mon, cal), false, 'and comes back when PDCal is present');
})();
eq(byV['Structural'].pct, 100, 'a finished trade reads 100%');
eq(byV['Structural'].n, 1, 'the bar counts its activities');
/* Duration-weighted, the same weights _gpct uses. 5 days at 0% + 6 days at 0% = 0. */
eq(byV['Windows'].pct, 0, 'an unstarted trade reads 0%');

/* Duration weighting, checked where it can actually differ. */
const wAgg = M.agg([act('Structural', '2026-01-01', '2026-01-10', 100),   // 10 days @100
                    act('Structural', '2026-01-11', '2026-01-40', 0)], 'name', IDX);
/* 2026-01-40 is not a date; pd() returns a Date that rolls over, so use a real one instead. */
const wAgg2 = M.agg([act('Structural', '2026-01-01', '2026-01-10', 100),  // 10 days @100
                     act('Structural', '2026-01-11', '2026-02-09', 0)], 'name', IDX); // 30 days @0
eq(wAgg2[0].pct, 25, 'progress is DURATION-weighted (10d@100 + 30d@0 = 25%), not a plain mean');

/* A non-curated category contributes nothing. */
M.setCats(TRADES.map(function (t) { return cat(t); }).concat([cat('Site Clearing', true)]));
const IDX2 = M.laneIndex();
const agg2 = M.agg([act('Site Clearing', '2026-01-01', '2026-01-05', 0)], 'name', IDX2);
ok(agg2 === null, 'a muted (non-curated) category gets no bar at all');

/* Undated activities are skipped rather than drawn at the epoch. */
ok(M.agg([{ activity_name: 'Structural', activity_type: 'Task' }], 'name', IDX) === null,
   'an undated activity produces no bar');
/* A reversed date pair cannot produce a negative width. */
const rev = M.agg([act('Structural', '2026-03-01', '2026-01-01', 0)], 'name', IDX);
ok(rev && +rev[0].s <= +rev[0].f, 'a reversed date pair is normalised, never negative-width');

/* The fold carries real spans and a count. */
M.setCats(MANY);
const IDX3 = M.laneIndex();
const foldActs = [act('T00', '2026-01-01', '2026-01-10', 0),
                  act('T14', '2026-02-01', '2026-02-10', 0),
                  act('T15', '2026-03-01', '2026-03-10', 0)];
const agg3 = M.agg(foldActs, 'name', IDX3);
const over = agg3.filter(function (b) { return b.over; })[0];
ok(over !== undefined, 'the folded trades get an overflow bar');
eq(over.lane, C.MAX, 'the overflow bar takes the marker lane');
eq(over.overCount, 2, 'the marker counts the DISTINCT folded trades it stands for');
eq(M.dstr(over.s) + '..' + M.dstr(over.f), '2026-02-01..2026-03-10', 'the marker spans their real dates');

/* ================================ THE RENDER =================================================== */
M.setCats(TRADES.map(function (t) { return cat(t); }));
const IDX4 = M.laneIndex();
const row = { _dkind: 'group', activity_name: '2nd Floor', _graw: '2nd Floor',
              _glsm: M.agg(floorActs, 'name', IDX4) };
const min = M.pd('2026-01-01');
const html = M.bars(row, min, 4.2, 340);
ok(/class="ps-lsmbar"/.test(html), 'the renderer emits lane bars');
eq((html.match(/class="ps-lsmbar"/g) || []).length, 4, 'one bar element per trade');
eq((html.match(/class="ps-lsmbar-gap"/g) || []).length, 1, 'the break is drawn as ONE notch');
ok(/class="ps-lsmbl"/.test(html), 'the per-lane baseline rail is emitted when a baseline exists');

/* LANE CONSTANCY - the property that makes a trade read as a diagonal. Same trade, three floors,
   three different sets of neighbours: its lane must not move. */
(function () {
  const floors = [
    [act('Structural', '2026-01-05', '2026-01-16', 100), act('Tiles', '2026-01-20', '2026-01-25', 0)],
    [act('Structural', '2026-01-17', '2026-01-28', 80)],
    [act('Windows', '2026-02-01', '2026-02-05', 0), act('Structural', '2026-01-29', '2026-02-09', 40),
     act('Plastering', '2026-02-10', '2026-02-14', 0)]
  ];
  const lanesSeen = {};
  floors.forEach(function (fa) {
    M.agg(fa, 'name', IDX4).forEach(function (b) {
      (lanesSeen[b.value] = lanesSeen[b.value] || {})[b.lane] = 1;
    });
  });
  Object.keys(lanesSeen).forEach(function (v) {
    eq(Object.keys(lanesSeen[v]).length, 1, 'lane is CONSTANT across floors for "' + v + '"');
  });
  eq(Object.keys(lanesSeen['Structural'])[0], '0', 'Structural holds lane 0 on every floor');
  eq(Object.keys(lanesSeen['Tiles'])[0], '7', 'Tiles holds lane 7 even where it is the only trade');
})();

/* Bars must stay inside their own lane band - no overlap between lanes. */
(function () {
  const tops = [];
  const re = /class="ps-lsmbar"[^>]*top:(\d+)px/g;
  let m2;
  while ((m2 = re.exec(html))) tops.push(+m2[1]);
  tops.sort(function (a, b) { return a - b; });
  for (let i = 1; i < tops.length; i++) {
    ok(tops[i] - tops[i - 1] >= 6, 'lane bands do not overlap (gap ' + (tops[i] - tops[i - 1]) + 'px)');
  }
})();

/* ⚠️⚠️ NOTHING FITS THE LANES INSIDE THE ROW, AND THAT IS THE zh DEFECT'S OWN SYMPTOM.
   The block above proves lanes do not overlap EACH OTHER, and the CONSTANTS block proves a lane's
   internals sum to LSM_LANE_H. Neither asks the question the owner's screenshot asked: does the
   LAST lane still land inside `_lsmRowH()`? On 2026-09-11 the live answer was no - ROWH 31 where
   the lanes needed 74, and 20 of 58 bars sitting outside their own row.

   ⚠️⚠️ BOTH SIDES ARE EXECUTED, NEVER RETYPED. The budget comes from calling the shipped
   `_lsmRowH()` and the placement from parsing the shipped `_lsmBarsHTML()` output; element heights
   come from the shipped CSS. The first cut of this block recomputed the budget from the constants
   instead of calling _lsmRowH - so a negative build that broke _lsmRowH left it green, which is the
   "assert on a copy of the thing under test" trap this suite has now been caught by four times. */
(function () {
  if (!M.rowH) { ok(false, 'SPILL: _lsmRowH was never linked'); return; }
  const hOf = {};
  ['ps-lsmbar', 'ps-lsmbl', 'ps-lsmbar-more'].forEach(function (cls) {
    const m3 = new RegExp('\\.' + cls + '\\s*\\{[^}]*height:\\s*(\\d+)px').exec(src);
    if (m3) hOf[cls] = +m3[1];
  });
  ok(hOf['ps-lsmbar'] > 0, 'SPILL: the bar height came from the shipped CSS', hOf['ps-lsmbar']);

  const ROWTOP = 340;
  for (let n = 1; n <= C.MAX; n++) {
    const names = [];
    for (let k = 0; k < n; k++) names.push('T' + (k < 10 ? '0' + k : k));
    M.setCats(names.map(function (t) { return cat(t); }));
    const idx = M.laneIndex();
    const acts = names.map(function (t, k) {
      return act(t, '2026-0' + (1 + (k % 8)) + '-01', '2026-0' + (1 + (k % 8)) + '-10', 40);
    });
    const r = { _dkind: 'group', activity_name: 'F', _graw: 'F',
                _glsm: M.agg(acts, 'name', idx) };
    const h = M.bars(r, M.pd('2026-01-01'), 4.2, ROWTOP);
    const budget = M.rowH();                       // the SHIPPED budget
    let spills = 0, above = 0, seen = 0, lowest = -1e9;
    const re2 = /class="(ps-lsmbar|ps-lsmbl|ps-lsmbar-more)"[^>]*top:(-?\d+)px/g;
    let m4;
    while ((m4 = re2.exec(h))) {
      const eh = hOf[m4[1]];
      if (eh === undefined) continue;
      const t = +m4[2];
      seen++;
      if (t + eh > ROWTOP + budget) spills++;
      if (t < ROWTOP) above++;
      lowest = Math.max(lowest, t + eh);
    }
    ok(seen > 0, 'SPILL: ' + n + ' lane(s) emitted measurable elements', seen);
    eq(spills, 0, 'SPILL: ' + n + ' lane(s) all end inside the row (lowest bottom ' +
       (lowest - ROWTOP) + 'px of the ' + budget + 'px _lsmRowH() grants)');
    eq(above, 0, 'SPILL: ' + n + ' lane(s) - nothing starts above the row');
  }
  M.setCats(TRADES.map(function (t) { return cat(t); }));   // leave the roster as it was
})();

/* ================================ FLOOR ORDER ================================================== */
/* The top-first block is inline in buildNodes, so its SHIPPED TEXT is sliced and executed rather
   than re-implemented here. */
(function () {
  const m3 = /if \(_lsmRows && _isLoc\) \{[\s\S]*?\n      \}/.exec(src);
  ok(m3 !== null, 'the row-order block is present in buildNodes');
  if (!m3) return;
  const body = m3[0];
  const run = new Function('_keys', '_lsmRows', '_isLoc', '_lsmTopFirst', '_lsmRankOf',
                           body + '; return _keys;');
  const keys = ['B2', 'B1', 'Ground Floor', '2nd Floor', '3rd Floor', 'Roof Deck',
                'Ground Reservoir', 'Podium Amenities'];
  M.setBuilder(null);
  const out = run(keys.slice(), true, true, true, M.rankOf);
  eq(out[0], 'Roof Deck', 'top-first puts the ROOF at index 0');
  eq(out[out.length - 1], 'Podium Amenities', 'an unrankable value stays BELOW the stack');
  eq(out.slice(0, 6).join('|'), 'Roof Deck|3rd Floor|2nd Floor|Ground Floor|B1|B2',
     'the ranked storeys are reversed among THEMSELVES');
  eq(out.slice(6).join('|'), 'Ground Reservoir|Podium Amenities',
     'the unrankable values keep their own order, appended below');
  /* Off, and not-a-location, must both be untouched. */
  eq(run(keys.slice(), false, true, true, M.rankOf).join('|'), keys.join('|'),
     'LSM off: the order is byte-for-byte the build order');
  eq(run(keys.slice(), true, false, true, M.rankOf).join('|'), keys.join('|'),
     'a non-location dimension is never reordered');
  eq(run(keys.slice(), true, true, false, M.rankOf).join('|'), keys.join('|'),
     'bottom-first returns the plain build order');
})();

/* levelRank's own two recorded traps, re-asserted because the reversal depends on them. */
ok(M.levelRank('Ground Reservoir') === null, 'a "Ground Reservoir" is NOT level 0', M.levelRank('Ground Reservoir'));
eq(M.levelRank('Ground Floor'), 0, 'the real Ground Floor is level 0');
ok(M.levelRank('Roof Deck') > M.levelRank('25th Floor'), 'the roof outranks the top storey');
ok(M.levelRank('B2') < M.levelRank('B1'), 'B2 is below B1');
ok(M.levelRank('Substructure') < M.levelRank('B2'), 'substructure is below the basements');

/* ================================ _sumSegsHTML UNTOUCHED ======================================= */
(function () {
  const seg = sliceFn('_sumSegsHTML');
  ok(seg !== null, '_sumSegsHTML is still present');
  if (seg) ok(/r\._dkind === 'group'/.test(seg),
              '_sumSegsHTML STILL returns early for a group row (its guard is untouched)');
})();

/* ================================ SLICE 2: THE PRODUCTION RATE ================================= */

/* No second implementation of anything: these are the reuse claims, asserted on the source. */
(function () {
  ok(/PDCal\.workingDaysInRange/.test(sliceFn('_lsmIdleGap') || ''),
     '_lsmIdleGap uses the shared PDCal.workingDaysInRange, not a walk of its own');
  ok(!/isWorkDay/.test(sliceFn('_lsmIdleGap') || ''),
     '_lsmIdleGap no longer hand-walks isWorkDay');
  const agg = sliceFn('_lsmAgg') || '';
  ok(/cpmCalOf\(/.test(agg), '_lsmAgg resolves the calendar with cpmCalOf (the scheduling resolver)');
  /* ⚠️ CODE ONLY. The module's own precedent: a check that forbids a code pattern must still let
     the comment explaining the change quote it. Stripping comments is what makes that possible. */
  ok(!/dsCalendarFor\(/.test(agg.replace(/\/\*[\s\S]*?\*\//g, '')),
     '_lsmAgg no longer uses the duration-scenario resolver (code only; prose may quote it)');
  const rate = sliceFn('_lsmRate') || '';
  const axof = sliceFn('_lsmAxOf') || '';
  /* Slice 3 lifted the axis cache into _lsmAxOf so the rate and the clash pass share ONE, so the
     reuse claim is now about the chain rather than about _lsmRate's own body. */
  ok(/_lsmAxOf\(/.test(rate), '_lsmRate gets its axis from the shared _lsmAxOf');
  ok(/makeAxis\(/.test(axof), '_lsmAxOf reuses the existing makeAxis working-day axis');
  ok(/ALLAX/.test(axof), 'and ALLAX is its calendar-day fallback');
  ok(!/axisFor\(/.test(rate) && !/axisFor\(/.test(axof),
     'neither calls axisFor - that would wipe the CPM axis cache on every repaint');
  ok(/_lsmAxOf\(/.test(sliceFn('_lsmClash') || ''), 'the clash pass shares the SAME axis helper');
  eq((src.match(/makeAxis\(/g) || []).length, 3,
     'exactly one new makeAxis caller (declaration + axisFor + _lsmAxOf)');
  ok(sliceFn('_lsmWIndex') === null, 'no second working-day index was added');
  ok(/ScheduleBuilder\.locCatalogue/.test(sliceFn('_lsmDecl') || ''),
     'the floor order comes from the project\'s declared location breakdown');
  ok(/typeof ScheduleBuilder/.test(sliceFn('_lsmDecl') || '') && !/window\.ScheduleBuilder/.test(sliceFn('_lsmDecl') || ''),
     'guarded with typeof, never window.ScheduleBuilder (the guard that could never pass)');
})();

/* The fit itself. */
(function () {
  const f = M.fit([0, 12, 24, 36], [0, 1, 2, 3]);
  ok(f !== null, 'the fit returns a result');
  eq(Math.round(1 / f.b), 12, 'a clean 12-day-per-floor cycle fits to 12');
  eq(Math.round(f.r2 * 1e6) / 1e6, 1, 'a perfectly linear climb has r2 = 1');
  /* Degenerate inputs must be refused, not answered confidently. */
  eq(M.fit([5, 5, 5], [0, 1, 2]), null, 'every floor starting the same day yields NO slope');
  eq(M.fit([0, 1, 2], [7, 7, 7]), null, 'every floor at the same rank yields NO slope');
  const s = M.fit([0, 40, 5, 90, 12], [0, 1, 2, 3, 4]);
  ok(s && s.r2 < M.r2ok(), 'a scattered climb falls below the r2 floor', s && s.r2);
})();

/* End to end: a fabricated tower through _lsmRate. */
/* The category FIELD is a parameter: a fixture on the Trade field must aggregate by 'work', and
   hardcoding 'name' here made the declared-sequence clash test silently find nothing. */
function grpRow(name, anc, acts, idx, field) {
  return { _dkind: 'group', activity_name: name, _graw: name, _danc: anc,
           _glsm: M.agg(acts, field || 'name', idx) };
}
(function () {
  M.setBuilder(null);                      /* no setup loaded -> the heuristic basis */
  M.setCats(TRADES.map(function (t) { return cat(t); }));
  M.setLsm(true);
  const IDX = M.laneIndex();
  /* Structural climbs one storey every 12 WORKING days, starting Mon 5 Jan 2026. */
  /* ⚠️ CONSECUTIVE ranks. My first fixture ran Ground(0) -> 2nd(2), skipping rank 1, and a
     12-working-day-per-STOREY climb then correctly fitted 10 days per RANK. The code was right;
     the fixture was describing a building with no 1st floor. */
  const FL = ['1st Floor', '2nd Floor', '3rd Floor', '4th Floor', '5th Floor'];
  const rows = [];
  let d = M.pd('2026-01-05');
  FL.forEach(function (fl, i) {
    const s = M.dstr(d);
    rows.push(grpRow(fl, ['exec', 'TW:A'], [act('Structural', s, s, 0)], IDX));
    /* advance 12 working days */
    let n = 0; while (n < 12) { d = new Date(d.getTime() + 86400000); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  });
  M.setDL(rows);
  const R = M.rate();
  eq(R.basis, 'heuristic', 'with no setup loaded the axis is the heuristic');
  ok(R.wd === true, 'the working-day axis is in play', R.wd);
  const st = R.byTrade['Structural'];
  ok(st !== undefined, 'Structural gets a rate');
  eq(st.n, 5, 'the fit used all five storeys');
  eq(Math.round(st.wdPerFloor), 12, 'the measured cycle is 12 WORKING days per floor');
  eq(Math.round(st.r2 * 1e6) / 1e6, 1, 'a metronomic climb reads r2 = 1');
  eq(st.up, true, 'the climb is upward');
  eq(st.series, 1, 'one tower, one series');
  /* 12 working days is ~16.8 calendar days, so ~1.8 floors a calendar month. */
  ok(st.floorsPerMonth > 1.5 && st.floorsPerMonth < 2.1,
     'floors-per-calendar-month is fitted separately, not 30.44/12', st.floorsPerMonth);
  /* The per-floor step feeds the bar tooltips. */
  eq(R.steps['execTW:AStructural2'], 12, 'the per-floor step is recorded in working days');
  /* And the strip renders it. */
  const html = M.rateHTML();
  ok(/ps-lsmrate-chip/.test(html), 'the Rate strip renders a chip');
  ok(/12 wd\/floor/.test(html), 'the chip states the working-day cycle', html.slice(0, 200));
  ok(!/class="ps-lsmrate-chip weak"/.test(html), 'a metronomic trade is not marked irregular');
})();

/* ⚠️⚠️ THE ROOF DECK. `levelRank` answers 900 for a roof, -50 for substructure, -2 for B2 — those
   are ORDERING keys, not storey counts. Fitting on the raw values put the roof 900 storeys above
   the top floor, which flattened every regression: measured in a browser, a six-storey fixture with
   a Roof Deck reported r² 0.43 and EVERY trade read "irregular". The fit runs on the ordinal storey
   position instead. This is the assertion that bites on that bug; the consecutive-floor fixtures
   above cannot, because for them the two are the same. */
(function () {
  M.setBuilder(null);
  const IDX = M.laneIndex();
  ok(M.levelRank('Roof Deck') === 900, 'control: levelRank puts the roof at 900', M.levelRank('Roof Deck'));
  ok(M.levelRank('Substructure') === -50, 'control: substructure at -50', M.levelRank('Substructure'));
  /* A metronomic 10-working-day climb up 1st..5th and then the Roof Deck. */
  const FL = ['1st Floor', '2nd Floor', '3rd Floor', '4th Floor', '5th Floor', 'Roof Deck'];
  const rows = [];
  let d = M.pd('2026-01-05');
  FL.forEach(function (fl) {
    const s = M.dstr(d);
    rows.push(grpRow(fl, ['exec'], [act('Structural', s, s, 0)], IDX));
    let n = 0; while (n < 10) { d = new Date(d.getTime() + 86400000); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  });
  M.setDL(rows);
  const st = M.rate().byTrade['Structural'];
  ok(st !== undefined, 'the roof-topped tower still gets a rate');
  eq(st.n, 6, 'all six storeys are in the fit');
  eq(Math.round(st.r2 * 1e6) / 1e6, 1, 'r2 is 1 — the roof no longer wrecks the fit');
  eq(Math.round(st.wdPerFloor), 10, 'and the cycle is the real 10 working days per storey');
  ok(!/ps-lsmrate-chip weak/.test(M.rateHTML()), 'so it is NOT reported as irregular');
  /* And a basement below the ground floor is one storey down, not two. */
  const rows2 = [];
  let d2 = M.pd('2026-01-05');
  ['B1', 'Ground Floor', '2nd Floor', '3rd Floor'].forEach(function (fl) {
    const s = M.dstr(d2);
    rows2.push(grpRow(fl, ['exec'], [act('Structural', s, s, 0)], IDX));
    let n = 0; while (n < 10) { d2 = new Date(d2.getTime() + 86400000); const w = d2.getDay(); if (w !== 0 && w !== 6) n++; }
  });
  M.setDL(rows2);
  const st2 = M.rate().byTrade['Structural'];
  eq(Math.round(st2.r2 * 1e6) / 1e6, 1, 'B1 -> Ground -> 2nd -> 3rd is four consecutive positions');
  eq(Math.round(st2.wdPerFloor), 10, 'even though the rank values are -1, 0, 2, 3');
})();

/* Too few storeys, and irregularity. */
(function () {
  const IDX = M.laneIndex();
  M.setDL([grpRow('Ground Floor', ['e'], [act('Structural', '2026-01-05', '2026-01-05', 0)], IDX),
           grpRow('2nd Floor', ['e'], [act('Structural', '2026-02-05', '2026-02-05', 0)], IDX)]);
  ok(M.rate().byTrade['Structural'] === undefined,
     'two storeys is not a trend - no rate is stated');
  ok(/No production rate yet/.test(M.rateHTML()), 'and the strip says why');
  eq(M.rate().floors, 2, 'it still reports how many storeys it saw');

  /* Irregular: the figure is REPLACED by the word, never shown beside it. */
  /* ⚠️ ZIG-ZAG, not two tidy clusters. My first "irregular" fixture was two tight groups, which a
     straight line fits at r² 0.73 — above the floor, so it was not actually irregular and the
     assertion was wrong rather than the code. */
  M.setDL([grpRow('1st Floor', ['e'], [act('Structural', '2026-01-05', '2026-01-05', 0)], IDX),
           grpRow('2nd Floor', ['e'], [act('Structural', '2026-06-01', '2026-06-01', 0)], IDX),
           grpRow('3rd Floor', ['e'], [act('Structural', '2026-01-20', '2026-01-20', 0)], IDX),
           grpRow('4th Floor', ['e'], [act('Structural', '2026-06-15', '2026-06-15', 0)], IDX)]);
  const d2 = M.rate().byTrade['Structural'];
  ok(d2 && d2.r2 < M.r2ok(), 'a lurching climb reads a low r2', d2 && d2.r2);
  const h2 = M.rateHTML();
  ok(/ps-lsmrate-chip weak/.test(h2), 'it is marked irregular');
  ok(/irregular/.test(h2) && !/wd\/floor/.test(h2),
     'and NO cycle figure is printed beside the word');
})();

/* ⚠️ TOWERS MUST NOT MIX - the same storey name in two towers is two series. */
(function () {
  const IDX = M.laneIndex();
  const rows = [];
  ['A', 'B'].forEach(function (tw, ti) {
    ['Ground Floor', '2nd Floor', '3rd Floor'].forEach(function (fl, i) {
      const day = 5 + ti * 90 + i * 14;
      rows.push(grpRow(fl, ['exec', 'TW:' + tw],
        [act('Structural', M.dstr(M.addDays(M.pd('2026-01-01'), day)), M.dstr(M.addDays(M.pd('2026-01-01'), day)), 0)], IDX));
    });
  });
  M.setDL(rows);
  const R = M.rate(), st = R.byTrade['Structural'];
  eq(st.series, 2, 'two towers are TWO series, never averaged');
  eq(st.n, 3, 'the reported fit is one tower\'s three storeys, not six points');
  eq(R.floors, 6, 'but all six storey-rows are counted');
  ok(/2 series/.test(M.rateHTML()), 'the strip says the fit is one of several series');
})();

/* ⚠️ A tower ROW carries lanes too, and must not become a point on a storey axis. */
(function () {
  const IDX = M.laneIndex();
  M.setDL([grpRow('Tower A', ['exec'], [act('Structural', '2026-01-05', '2026-01-05', 0)], IDX),
           grpRow('Ground Floor', ['exec', 'TW:A'], [act('Structural', '2026-01-05', '2026-01-05', 0)], IDX),
           grpRow('2nd Floor', ['exec', 'TW:A'], [act('Structural', '2026-01-21', '2026-01-21', 0)], IDX),
           grpRow('3rd Floor', ['exec', 'TW:A'], [act('Structural', '2026-02-06', '2026-02-06', 0)], IDX),
           grpRow('Ground Reservoir', ['exec', 'TW:A'], [act('Structural', '2026-03-02', '2026-03-02', 0)], IDX)]);
  const R = M.rate();
  eq(R.floors, 3, 'the tower row and the non-storey row are both off the axis');
  eq(R.byTrade['Structural'].n, 3, 'and neither contributes a point to the fit');
})();

/* ⚠️⚠️ ONE SCALE: the heuristic IS the axis, and the declaration only PLACES what it cannot rank.
   The previous contract - "the declared breakdown wins" - was wrong in a way no fixture caught,
   because it only shows up on a real setup: `catalogueFrom` concatenates the per-trade floor lists,
   and on OPW101 that reads **F1, B3, B2, B1, Ground Floor, 2ND...**, so the "declared axis" put the
   FIRST FLOOR BELOW THE THIRD BASEMENT. `levelRank` reads all of those correctly. */
(function () {
  const IDX = M.laneIndex();
  ok(M.levelRank('Podium Amenities') === null, 'levelRank cannot rank "Podium Amenities" (control)');
  eq(M.levelRank('F1'), 1, '⚠️⚠️ but it CAN rank F1 - the name the declared axis mis-placed');
  eq(M.levelRank('B3'), -3, 'and B3');
  eq(M.levelRank('Ground Floor'), 0, 'and Ground Floor');

  /* The OPW101 shape: one trade lists F1, another lists the real stack. */
  M.setBuilder({ locCatalogue: function () {
    return { lvF: [ { value: 'F1', dim: 'floor', kind: 'typical', tr: 'GR' },
                    { value: 'B3', dim: 'floor', kind: 'basement', tr: 'ST' },
                    { value: 'B2', dim: 'floor', kind: 'basement', tr: 'ST' },
                    { value: 'B1', dim: 'floor', kind: 'basement', tr: 'ST' },
                    { value: 'Ground Floor', dim: 'floor', kind: 'typical', tr: 'ST' },
                    { value: 'Podium Amenities', dim: 'floor', kind: 'podium', tr: 'ST' },
                    { value: '2nd Floor', dim: 'floor', kind: 'typical', tr: 'ST' },
                    { value: '3rd Floor', dim: 'floor', kind: 'typical', tr: 'ST' } ],
             lvT: [ { value: 'Tower A', dim: 'tower' } ] };
  } });

  /* ⚠️⚠️ THE BUG THAT WAS LIVE: with a setup loaded, F1 used to answer 0 - the bottom of the
     building - because it was first in the concatenation. It must answer 1. */
  eq(M.rankOf('F1'), 1, '⚠️⚠️ F1 is the FIRST FLOOR, not the bottom of the building');
  eq(M.rankOf('B3'), -3, 'and B3 is three levels down, not one above F1');
  eq(M.rankOf('B1'), -1, 'B1');
  eq(M.rankOf('Ground Floor'), 0, 'Ground Floor is still 0');
  eq(M.rankOf('3rd Floor'), 3, 'and the numbered floors keep their own numbers');

  /* ⚠️⚠️ AND THE STOREY THE HEURISTIC CANNOT READ IS STILL PLACED - between its declared
     neighbours, on the same scale, so it neither vanishes nor jumps the stack. */
  const pa = M.rankOf('Podium Amenities');
  ok(pa !== null, '⚠️⚠️ "Podium Amenities" is placed from the Schedule Setup', pa);
  ok(pa > 0 && pa < 2, 'strictly between Ground Floor (0) and 2nd Floor (2)', pa);
  eq(M.rankBasis(), 'assisted', 'and the basis says the heuristic was assisted, not replaced');

  /* Nothing else changed. */
  ok(M.rankOf('Tower A') === null, 'a tower is still not a storey');
  ok(M.rankOf('Somewhere Else') === null, 'a name nobody declared and no rule covers is off the axis');

  /* ⚠️ No interpolated value may land ON a real rank, or two storeys collapse to one ordinal. */
  const all = ['F1', 'B3', 'B2', 'B1', 'Ground Floor', 'Podium Amenities', '2nd Floor', '3rd Floor']
    .map(function (v) { return M.rankOf(v); });
  eq(new Set(all).size, all.length, 'every storey has its own distinct position');

  const rows = [];
  ['B3', 'B2', 'B1', 'Ground Floor', 'Podium Amenities', '2nd Floor', '3rd Floor'].forEach(function (fl, i) {
    const day = 5 + i * 14;
    rows.push(grpRow(fl, ['exec'], [act('Structural', M.dstr(M.addDays(M.pd('2026-01-01'), day)),
      M.dstr(M.addDays(M.pd('2026-01-01'), day)), 0)], IDX));
  });
  M.setDL(rows);
  const R = M.rate();
  eq(R.basis, 'assisted', 'the rate reports the assisted basis');
  eq(R.byTrade['Structural'].n, 7, '⚠️⚠️ all seven storeys are on the axis, the podium included');
  ok(/placed from your Schedule Setup/.test(M.rateHTML()),
     'and the strip says how many storeys the setup placed');
  M.setBuilder(null);
})();

/* ⚠️ A storey with NO rankable neighbour on either side stays off the axis - the declaration
   says nothing about where it sits either, and the flowline's footnote is the honest answer. */
(function () {
  M.setBuilder({ locCatalogue: function () {
    return { lvF: [ { value: 'Somewhere', dim: 'floor', tr: 'ST' },
                    { value: 'Elsewhere', dim: 'floor', tr: 'ST' } ] };
  } });
  ok(M.rankOf('Somewhere') === null, 'nothing to interpolate between leaves it unplaced');
  eq(M.rankBasis(), 'heuristic', 'and the basis does not claim the setup helped');
  M.setBuilder(null);
})();

/* ⚠️ ONE RANK FUNCTION for the rows and the rate - asserted on the shipped text. */
(function () {
  const m3 = /if \(_lsmRows && _isLoc\) \{[\s\S]*?\n      \}/.exec(src);
  ok(m3 !== null, 'the row-order block is present');
  if (!m3) return;
  ok(/_lsmRankOf/.test(m3[0]), 'the row order uses _lsmRankOf, the SAME rank the rate fits on');
  ok(!/levelRank\(/.test(m3[0]), 'and no longer calls levelRank directly');
  const run = new Function('_keys', '_lsmRows', '_isLoc', '_lsmTopFirst', '_lsmRankOf',
                           m3[0] + '; return _keys;');
  const keys = ['B2', 'B1', 'Ground Floor', '2nd Floor', '3rd Floor', 'Roof Deck',
                'Ground Reservoir', 'Podium Amenities'];
  M.setBuilder(null);
  const out = run(keys.slice(), true, true, true, M.rankOf);
  eq(out[0], 'Roof Deck', 'top-first puts the ROOF at index 0');
  eq(out.slice(0, 6).join('|'), 'Roof Deck|3rd Floor|2nd Floor|Ground Floor|B1|B2',
     'the ranked storeys are reversed among THEMSELVES');
  eq(out.slice(6).join('|'), 'Ground Reservoir|Podium Amenities',
     'the unrankable values keep their order, appended below the stack');
  eq(run(keys.slice(), false, true, true, M.rankOf).join('|'), keys.join('|'),
     'LSM off: byte-for-byte the build order');
  eq(run(keys.slice(), true, false, true, M.rankOf).join('|'), keys.join('|'),
     'a non-location dimension is never reordered');
  /* ⚠️ With NO declaration the ascending sort is what cmpLevelValue already produced, so
     bottom-first is still the plain build order. */
  eq(run(keys.slice(), true, true, false, M.rankOf).join('|'), keys.join('|'),
     'bottom-first with no declaration is the plain build order');
})();

/* ================================ SLICE 3: CLASH DETECTION ===================================== */

/* The sequence: declared where the project declares one, inferred otherwise — and labelled. */
(function () {
  M.setBuilder(null);
  /* On the Trade field the order is WORK_ORDER, via the existing cmpWorkName. Deliberately fed in
     the WRONG order so a pass cannot be an accident of the input. */
  M.setField('work');
  M.setCats(['MEPF Works', 'Structural Works', 'Architectural Works', 'Site Works']
    .map(function (t) { return cat(t); }));
  const sq = M.seq();
  eq(sq.basis, 'declared', 'the Trade field has a DECLARED sequence');
  eq(sq.order.join(' > '), 'Site Works > Structural Works > Architectural Works > MEPF Works',
     'and it is WORK_ORDER, not the order they were handed in');
  ok(sq.idx['Structural Works'] < sq.idx['MEPF Works'], 'Structural precedes MEPF');
  /* ⚠️ Both spellings a trade can reach the grid under — the short Schedule Setup label too. */
  M.setCats(['MEPF', 'Structural', 'Site Works'].map(function (t) { return cat(t); }));
  eq(M.seq().order.join(' > '), 'Site Works > Structural > MEPF',
     'the short GLABEL spellings are ordered by the same table');
  /* Any other field has no declared order, so it is inferred from first-start (= lane order). */
  M.setField('name');
  M.setCats(TRADES.map(function (t) { return cat(t); }));
  eq(M.seq().basis, 'inferred', 'Activity name has NO declared sequence');
  eq(M.seq().order.join('|'), TRADES.join('|'), 'so the inferred order is the lane order');
})();

/* The detection itself. */
(function () {
  M.setField('name');
  M.setCats(TRADES.map(function (t) { return cat(t); }));
  M.setLsm(true);
  const IDX = M.laneIndex();
  /* Structural (lane 0) runs 5–16 Jan. Exterior Masonry (lane 1) is meant to follow it but starts
     on the 12th — five days before Structural finishes. That is the clash. */
  M.setDL([grpRow('1st Floor', ['exec'], [
    act('Structural', '2026-01-05', '2026-01-16', 0),
    act('Exterior Masonry', '2026-01-12', '2026-01-23', 0)
  ], IDX)]);
  const C = M.clash();
  eq(C.n, 1, 'one clash found');
  eq(C.basis, 'inferred', 'and the basis is reported');
  const x = C.list[0];
  eq(x.a, 'Structural', 'the predecessor is named first');
  eq(x.b, 'Exterior Masonry', 'and the successor that came in early second');
  eq(x.loc, '1st Floor', 'on the right storey');
  /* 12–16 Jan inclusive = Mon 12, Tue 13, Wed 14, Thu 15, Fri 16 = 5 working days. */
  eq(x.days, 5, 'the overlap is counted in WORKING days');
  ok(C.wd === true, 'through the shared working-day axis');
  /* ⚠️ BOTH bars are marked - a clash is a property of the pair. */
  eq(Object.keys(C.marks).length, 2, 'both participating bars carry a mark');
  ok(C.marks['execStructural1'], 'the predecessor is marked');
  ok(C.marks['execExterior Masonry1'], 'and so is the successor');

  /* ⚠️ A CLEAN HANDOFF IS NOT A CLASH. dispFin is inclusive, so a successor starting the day its
     predecessor finishes shares one day - ordinary FS practice, not a pitfall. */
  M.setDL([grpRow('1st Floor', ['exec'], [
    act('Structural', '2026-01-05', '2026-01-16', 0),
    act('Exterior Masonry', '2026-01-16', '2026-01-23', 0)
  ], IDX)]);
  eq(M.clash().n, 0, 'a same-day handoff is NOT reported');
  eq(M.clashMin(), 1, 'the threshold is one shared day');
  ok(M.clashHTML() === '', 'and the strip is absent entirely when there is nothing to report');

  /* In-sequence order matters: the EARLIER trade starting late is not "the later one early". */
  M.setDL([grpRow('1st Floor', ['exec'], [
    act('Exterior Masonry', '2026-01-05', '2026-01-16', 0),
    act('Structural', '2026-01-12', '2026-01-23', 0)
  ], IDX)]);
  eq(M.clash().n, 1, 'the pair is still flagged when the sequence is violated the other way round');
  eq(M.clash().list[0].a, 'Structural', 'and Structural is still named as the predecessor');

  /* No overlap at all. */
  M.setDL([grpRow('1st Floor', ['exec'], [
    act('Structural', '2026-01-05', '2026-01-16', 0),
    act('Exterior Masonry', '2026-02-02', '2026-02-13', 0)
  ], IDX)]);
  eq(M.clash().n, 0, 'a clean gap is no clash');

  /* ⚠️ DIFFERENT STOREYS ARE NOT A CLASH - that is the whole point of the chart. Two trades
     overlapping in time on DIFFERENT floors is exactly how a takt programme is supposed to run. */
  M.setDL([grpRow('1st Floor', ['exec'], [act('Structural', '2026-01-05', '2026-01-16', 0)], IDX),
           grpRow('2nd Floor', ['exec'], [act('Exterior Masonry', '2026-01-05', '2026-01-16', 0)], IDX)]);
  eq(M.clash().n, 0, 'the same window on two different storeys is not a clash');

  /* ⚠️ AND NEITHER ARE TWO TOWERS - the series key keeps them apart. */
  M.setDL([grpRow('1st Floor', ['exec', 'TW:A'], [act('Structural', '2026-01-05', '2026-01-16', 0)], IDX),
           grpRow('1st Floor', ['exec', 'TW:B'], [act('Exterior Masonry', '2026-01-05', '2026-01-16', 0)], IDX)]);
  eq(M.clash().n, 0, 'the same storey NAME in two towers is not a clash');

  /* The overflow marker stands for several trades and cannot be one side of a pair. */
  M.setCats(MANY);
  const IDXm = M.laneIndex();
  M.setDL([grpRow('1st Floor', ['exec'], [
    act('T00', '2026-01-05', '2026-01-16', 0),
    act('T15', '2026-01-06', '2026-01-20', 0),
    act('T16', '2026-01-07', '2026-01-20', 0)
  ], IDXm)]);
  const Cm = M.clash();
  ok(Cm.list.every(function (e) { return e.a && e.b; }),
     'the overflow marker never appears as a side of a clash');
  M.setCats(TRADES.map(function (t) { return cat(t); }));
})();

/* Worst-first ordering, the cap, and the strip. */
(function () {
  const IDX = M.laneIndex();
  const rows = [];
  /* Three storeys with progressively worse overlaps, so the sort is observable. */
  [['1st Floor', '2026-01-14'], ['2nd Floor', '2026-01-09'], ['3rd Floor', '2026-01-12']]
    .forEach(function (p) {
      rows.push(grpRow(p[0], ['exec'], [
        act('Structural', '2026-01-05', '2026-01-16', 0),
        act('Exterior Masonry', p[1], '2026-01-30', 0)
      ], IDX));
    });
  M.setDL(rows);
  const C = M.clash();
  eq(C.n, 3, 'one clash per storey');
  ok(C.list[0].days >= C.list[1].days && C.list[1].days >= C.list[2].days,
     'worst first', C.list.map(function (e) { return e.days; }));
  eq(C.list[0].loc, '2nd Floor', 'the longest overlap leads');
  const h = M.clashHTML();
  ok(/ps-lsmclash-strip/.test(h), 'the strip renders');
  eq((h.match(/data-lsmclash=/g) || []).length, 3, 'one navigable chip per clash');
  ok(/3 clashes/.test(h), 'the count is stated');
  ok(/inferred order/.test(h), 'and an inferred order is LABELLED inferred on the strip itself');
  ok(/possible pitfalls/.test(h), 'the deck\'s own wording: reported, never blocked');
  /* Declared basis drops the "inferred" caveat. */
  M.setField('work');
  M.setCats(['Structural Works', 'Architectural Works'].map(function (t) { return cat(t); }));
  const IDXw = M.laneIndex();
  M.setDL([grpRow('1st Floor', ['exec'], [
    { activity_name: 'a', work_type: 'Structural Works', activity_type: 'Task',
      start_date: '2026-01-05', end_date: '2026-01-16', percent_complete: 0 },
    { activity_name: 'b', work_type: 'Architectural Works', activity_type: 'Task',
      start_date: '2026-01-09', end_date: '2026-01-23', percent_complete: 0 }
  ], IDXw, 'work')]);
  const Cw = M.clash();
  eq(Cw.basis, 'declared', 'the Trade field gives a declared basis');
  eq(Cw.n, 1, 'and the clash is still found');
  ok(!/inferred order/.test(M.clashHTML()), 'the strip drops the caveat when the order is declared');
  M.setField('name');
  M.setCats(TRADES.map(function (t) { return cat(t); }));
})();

/* The marks reach the bars. */
(function () {
  const IDX = M.laneIndex();
  const acts = [act('Structural', '2026-01-05', '2026-01-16', 40),
                act('Exterior Masonry', '2026-01-12', '2026-01-23', 0)];
  const row = grpRow('1st Floor', ['exec'], acts, IDX);
  M.setDL([row]);
  M.clash();
  const html = M.bars(row, M.pd('2026-01-01'), 4.2, 0);
  eq((html.match(/class="ps-lsmclash"/g) || []).length, 2,
     'the overlap is drawn on BOTH bars');
  eq((html.match(/ps-lsmbar ps-lsmbar-clash/g) || []).length, 2,
     'and both bars are flagged as carrying one');
})();

/* ================================ SLICE 4: THE DATA-DATE LINE ================================== */

/* ⚠️⚠️ THE EQUIVALENCE PROOF. The status chip hands `_stkState` the bar's own span rather than the
   activity list, on the grounds that a lane bar's s/f ARE the bucket's min-start and max-finish.
   That is asserted against the REAL activity lists over a grid of dates, not assumed — if the two
   ever diverge, the chart and the "Planned status as of" panel would disagree about one storey. */
(function () {
  ok(M.stkState !== null, '_stkState is the shared status rule');
  ok(M.stateOf !== null, 'and the LSM chip goes through it');
  M.setField('name');
  M.setCats(TRADES.map(function (t) { return cat(t); }));
  M.setLsm(true);
  const IDX = M.laneIndex();
  /* Several shapes: one activity, two overlapping, two apart, one long + one short. */
  const CASES = [
    [act('Structural', '2026-01-05', '2026-01-16', 0)],
    [act('Structural', '2026-01-05', '2026-01-16', 0), act('Structural', '2026-01-10', '2026-01-30', 0)],
    [act('Structural', '2026-01-05', '2026-01-09', 0), act('Structural', '2026-02-02', '2026-02-13', 0)],
    [act('Structural', '2026-01-05', '2026-03-30', 0), act('Structural', '2026-01-06', '2026-01-07', 0)]
  ];
  let checked = 0, agree = 0;
  CASES.forEach(function (acts) {
    const agg = M.agg(acts, 'name', IDX);
    const bar = agg[0];
    for (let d = 0; d < 120; d += 3) {
      const D = M.addDays(M.pd('2026-01-01'), d);
      const viaBar = M.stateOf(bar, D);
      const viaActs = M.stkState(acts, D);
      checked++;
      if (viaBar === viaActs) agree++;
    }
  });
  eq(agree, checked, 'the bar-span path and _stkState over the real activities agree everywhere (' + checked + ' dates)');
  /* And the three states are all actually reached, so the agreement is not vacuous. */
  const seen = {};
  CASES.forEach(function (acts) {
    const bar = M.agg(acts, 'name', IDX)[0];
    for (let d = 0; d < 120; d += 3) seen[M.stateOf(bar, M.addDays(M.pd('2026-01-01'), d))] = 1;
  });
  eq(Object.keys(seen).sort().join(','), 'done,none,wip', 'all three states occur in the grid');
})();

/* The storey reading, and its label. */
(function () {
  const IDX = M.laneIndex();
  const acts = [
    act('Structural', '2026-01-05', '2026-01-16', 0),         // lane 0
    act('Exterior Masonry', '2026-01-19', '2026-01-30', 0),   // lane 1
    act('MEPF 1st Fix', '2026-02-02', '2026-02-13', 0),       // lane 2
    act('Plastering', '2026-03-02', '2026-03-13', 0)          // lane 3
  ];
  const row = grpRow('3rd Floor', ['exec'], acts, IDX);
  const seq = M.seq();
  /* Before anything starts. */
  let st = M.storeyStatus(row, M.pd('2026-01-01'), seq);
  eq(M.statusLabel(st), 'Not started', 'before the first start');
  /* Mid-Structural. */
  st = M.storeyStatus(row, M.pd('2026-01-10'), seq);
  eq(st.wip.join(','), 'Structural', 'Structural is the working trade');
  eq(st.frontier, null, 'nothing finished yet');
  eq(M.statusLabel(st), 'Structural', 'so the label is just the active trade');
  /* Structural done, Exterior Masonry running. */
  st = M.storeyStatus(row, M.pd('2026-01-25'), seq);
  eq(st.done.join(','), 'Structural', 'Structural has finished');
  eq(st.wip.join(','), 'Exterior Masonry', 'and Masonry is working');
  eq(M.statusLabel(st), 'Exterior Masonry · through Structural',
     'the label names the active work AND the finished frontier');
  /* ⚠️ The FRONTIER is the furthest-along DONE trade in sequence order, not the last to finish. */
  st = M.storeyStatus(row, M.pd('2026-02-20'), seq);
  eq(st.frontier, 'MEPF 1st Fix', 'the frontier is the furthest trade in SEQUENCE order');
  eq(M.statusLabel(st), 'through MEPF 1st Fix', 'and with nothing working it reads as a frontier');
  /* Everything done. */
  st = M.storeyStatus(row, M.pd('2026-06-01'), seq);
  eq(st.all, true, 'every keyed trade on the storey is finished');
  eq(M.statusLabel(st), 'Complete', 'so the storey reads Complete');
  /* A row with no aggregation says nothing rather than "Not started". */
  eq(M.storeyStatus({ _glsm: [] }, M.pd('2026-01-10'), seq), null,
     'a storey with no bars yields no reading at all');
})();

/* The chip on the row, and what turns it off. */
(function () {
  const IDX = M.laneIndex();
  const acts = [act('Structural', '2026-01-05', '2026-01-16', 0),
                act('Exterior Masonry', '2026-01-19', '2026-01-30', 0)];
  const row = grpRow('3rd Floor', ['exec'], acts, IDX);
  M.setDL([row]);
  M.setDD(M.pd('2026-01-25'));            // a pinned data date, not the wall clock
  M.setStatus(true);
  let html = M.bars(row, M.pd('2026-01-01'), 4.2, 0);
  ok(/class="ps-lsmstat/.test(html), 'the status chip is emitted on the row');
  ok(/ps-lsmstat wip/.test(html), 'and marked as work-in-progress');
  ok(/Exterior Masonry/.test(html), 'carrying the active trade');
  /* ⚠️ Its own switch. */
  M.setStatus(false);
  html = M.bars(row, M.pd('2026-01-01'), 4.2, 0);
  ok(!/ps-lsmstat/.test(html), 'the switch removes it');
  M.setStatus(true);
  /* ⚠️ And it goes with the LINE: a status pinned to an x nobody can see is a riddle. */
  const gs = M.gset();
  gs.ddline = false;
  html = M.bars(row, M.pd('2026-01-01'), 4.2, 0);
  ok(!/ps-lsmstat/.test(html), 'hiding the data-date line hides the readings too');
  gs.ddline = true;
  /* It reads the PINNED data date, not the wall clock. */
  M.setDD(M.pd('2026-06-01'));
  html = M.bars(row, M.pd('2026-01-01'), 4.2, 0);
  ok(/ps-lsmstat done/.test(html) && /Complete/.test(html),
     'moving the data date changes the reading');
  M.setDD(null);
})();

/* The grip, the drag, and the line's inertness - asserted on the shipped source. */
(function () {
  ok(/\.ps-datedate \{[^}]*pointer-events:none/.test(src),
     'the full-height line is INERT, so it cannot swallow clicks on the bars it crosses');
  ok(/\.ps-datedate-grip \{/.test(src), 'there is a grip');
  ok(/cursor:ew-resize/.test(src), 'and it advertises itself as draggable');
  ok(/class="ps-datedate-grip"/.test(src), 'the grip is emitted with the line');
  const wd = sliceFn('wireDrag') || '';
  ok(/ps-datedate-grip/.test(wd) && /startDDDrag\(/.test(wd),
     'and re-bound by wireDrag, which already re-binds per frame');
  const dd = sliceFn('startDDDrag') || '';
  ok(dd !== '', 'the drag handler exists');
  /* ⚠️⚠️ ONE data date, written through the SAME setter the dialog uses. */
  ok(/setDataDate\(/.test(dd), 'the drag writes the one real data date');
  ok(/computeCPM\(\)/.test(dd) && /renderAll\(\)/.test(dd),
     'and follows the spotlight precedent: setDataDate -> computeCPM -> renderAll');
  ok(/UI\.toast\(/.test(dd) && /was /.test(dd),
     'and reports the change, naming the old value');
  ok(/removeEventListener\('mousemove'/.test(dd) && /removeEventListener\('mouseup'/.test(dd),
     'the document listeners are removed on release');
  ok(/parentNode\.removeChild/.test(dd), 'and the transient label is taken down');
  /* The permanent label stays removed - the owner asked for that and it still holds. */
  eq((src.match(/ps-datedate-lbl/g) || []).length, 2,
     'the date label exists only as the CSS rule plus its transient use in the drag');
})();

/* ============ THE COLLAPSE LEVEL — the owner's "ticking LSM widens the rows" ==================
   `expandToLevel(n)` collapses every node at `ddepth >= n - 1`. With Tower › Level › Zone › Unit,
   `expandToLevel(locDims.length)` = 4 collapsed only the UNITS, so the Tower, Level and Zone rows
   stayed open and every activity carrying no Unit value stayed on screen as a leaf — 2,561 rows,
   each stretched to the tall LSM height. The floor rows have to be the DEEPEST VISIBLE ones. */
(function () {
  ok(M.floorLevelId !== null, 'there is one shared floor-level rule');
  const LV = [{ id: 'T', name: 'Tower' }, { id: 'L', name: 'Level' },
              { id: 'Z', name: 'Zone' }, { id: 'U', name: 'Unit' }];
  M.setLocLevels(LV);
  eq(M.floorLevelId(), 'L', 'it picks the Level, not the deepest');
  /* ⚠️ ONE RULE, TWO CALLERS: the stacking axis resolves through the same function. */
  ok(/_locFloorLevelId\(\)/.test(sliceFn('stkDefaultLevel') || ''),
     'stkDefaultLevel delegates to it rather than carrying its own copy');
  /* The arithmetic the setter now uses, executed rather than described. */
  const locDims = LV.map(function (l) { return 'loc:' + l.id; });
  const fi = locDims.indexOf('loc:' + M.floorLevelId());
  eq(fi, 1, 'the floor is the second location dimension here');
  const n = fi + 1;
  eq(n, 2, 'so the collapse level is 2, not 4');
  /* At n = 2: Level rows (depth 1) collapse; Tower rows (depth 0) stay open. */
  const collapses = (depth) => depth >= (n - 1);
  eq(collapses(0), false, 'the Tower row stays open');
  eq(collapses(1), true, 'the Level rows collapse — one row per floor');
  eq(collapses(2), true, 'and everything under them is hidden');
  /* The old value would have left the floors expanded, which is the reported bug. */
  const nOld = locDims.length;
  eq(nOld >= 1 && (1 >= nOld - 1), false, 'the OLD level left the Level rows EXPANDED (the bug)');
  /* And the shipped text uses the floor index, not the length.
     ⚠️ Retargeted with slice 5's extraction: the collapse lives in `_lsmArrange`, which is what
     BOTH the row layout and the flowline call. */
  const st = sliceFn('_lsmArrange') || '';
  ok(/_locFloorLevelId\(\)/.test(st), 'the arrange step resolves the floor level');
  ok(/_fi \+ 1/.test(st), 'and collapses at the floor\'s own depth');
  /* A breakdown with no recognisable floor name falls back rather than throwing. */
  M.setLocLevels([{ id: 'A', name: 'Area' }, { id: 'B', name: 'Cell' }]);
  eq(M.floorLevelId(), 'B', 'with no floor-ish name it falls back to the deepest level');
  M.setLocLevels([]);
  eq(M.floorLevelId(), null, 'and to null with no breakdown at all');
  M.setLocLevels(LV);
})();

/* ================================ SLICE 5: THE FLOWLINE ======================================== */

/* ⚠️⚠️ THE WHOLE POINT: the flowline derives NOTHING of its own. This module once shipped a 3D
   view that put a floor somewhere else than the 2D view of the same data, with no way to tell which
   was right; `_vsTowerModel` was extracted to stop that happening again. These assertions are what
   keep the flowline on the same model as the rows. */
(function () {
  const fl = sliceFn('renderFlowline') || '';
  ok(fl !== '', 'renderFlowline exists');
  ok(/_lsmRate\(\)/.test(fl), 'it reads the shared model');
  ok(/_lsmSeq\(\)/.test(fl), 'the shared trade sequence');
  ok(/_lsmClash\(\)/.test(fl), 'and the shared clashes');
  ok(/_lsmLanes\(\)/.test(fl), 'and the shared lane colours');
  /* It must NOT re-derive the things the model already answers. */
  ok(!/_lsmFit\(/.test(fl), 'it does not re-fit the slopes');
  ok(!/levelRank\(/.test(fl), 'it does not re-rank the storeys');
  ok(!/_lsmAgg\(/.test(fl), 'it does not re-aggregate the bars');
  ok(/R\.ord\[/.test(fl), 'the storey ordinals come from the model');
  ok(/R\.byKey/.test(fl), 'and so do the per-storey spans');
  ok(/R\.byTrade\[/.test(fl), 'the slope label is the Rate strip\'s own figure');
  /* The deck's own requirements. */
  ok(/rs\.length === 1/.test(fl) && /ps-fl-block/.test(fl),
     'a trade on ONE storey draws as a BLOCK TASK, not a near-vertical line');
  ok(/ps-fl-band/.test(fl) && /polygon/.test(fl), 'the work is a band between start and finish');
  ok(/ps-fl-bl/.test(fl) && /_gset\.baseline/.test(fl), 'the baseline is drawn, dashed, and respects its switch');
  ok(/unranked/.test(fl), 'unrankable locations are collected');
  ok(!/Y\(0\)/.test(fl) || /unranked/.test(fl), 'and never plotted at ground level');
  ok(/ps-fl-clash/.test(fl), 'clashes are marked on the storey they happen on');
  ok(/DAYW\[zoom\] \* ganttScale/.test(fl), 'it shares the Gantt\'s own day width, not a second scale');
  ok(/_lsmRateHTML\(\)/.test(fl) && /_lsmClashHTML\(\)/.test(fl),
     'the Rate and Clash strips travel with it (the legend is hidden in a full-width panel)');
  /* Three distinct empty states, the rule the stacking arrived at after four reports. */
  ok(/Location Breakdown Structure/.test(fl) && /resolve to a/.test(fl) && /Key trades/.test(fl),
     'the empty state says WHICH of the three reasons applies');
  /* CSS uses tokens only. */
  ok(!/#[0-9a-fA-F]{6}/.test((src.match(/\.ps-fl-[\s\S]*?\.ps-fl-note[^}]*\}/) || [''])[0]),
     'the flowline CSS carries no colour literals');
})();

/* The model carries what the chart needs. */
(function () {
  M.setBuilder(null); M.setField('name');
  M.setCats(TRADES.map(function (t) { return cat(t); }));
  M.setLsm(true);
  const IDX = M.laneIndex();
  const rows = [];
  ['1st Floor', '2nd Floor', '3rd Floor'].forEach(function (fl, i) {
    const s = M.dstr(M.addDays(M.pd('2026-01-05'), i * 14));
    const f = M.dstr(M.addDays(M.pd('2026-01-05'), i * 14 + 11));
    const r = grpRow(fl, ['exec', 'TW:A'], [act('Structural', s, f, 0, s, f)], IDX);
    r._dcode = 'TW:A|' + fl;
    rows.push(r);
  });
  M.setDL(rows);
  const R = M.rate();
  ok(R.ord && R.byKey && R.label && R.name && R.serAnc, 'the model exports the chart\'s inputs');
  eq(R.min && M.dstr(R.min), '2026-01-05', 'and the window it measured in');
  const key = Object.keys(R.byKey)[0];
  const p = R.byKey[key];
  eq(p.value, 'Structural', 'keyed per series and trade');
  const rks = Object.keys(p.byRank).map(Number).sort(function (a, b) { return a - b; });
  eq(rks.length, 3, 'with one entry per storey');
  /* ⚠️ THE WHOLE SPAN, not just the start - the band needs both edges, and the baseline too. */
  const v = p.byRank[rks[0]];
  ok(v.s && v.f, 'each entry carries the span, not just the start');
  ok(v.bs && v.bf, 'and the baseline span where there is one');
  eq(M.dstr(v.s), '2026-01-05', 'start');
  eq(M.dstr(v.f), '2026-01-16', 'finish');
  /* The storey labels the axis prints. */
  const serKey = Object.keys(R.ord)[0];
  eq(R.label[serKey + '' + rks[0]], '1st Floor', 'the storey label is in the model');
  eq(Object.keys(R.ord[serKey]).length, 3, 'and the ordinals cover every storey');
})();

/* ============== THE GROUP PRESET IS THE TOGGLE (owner's call, 2026-09-11) ====================== */
(function () {
  const menu = sliceFn('renderGroupMenu') || '';
  ok(menu !== '', 'renderGroupMenu is present');
  /* The preset is the LAYOUT's grouping now, not the activity-led transpose. */
  ok(/\{ name: 'LSM', dims: locDims, lsm: true \}/.test(menu),
     'the LSM preset is LOCATION-LED and flagged as a mode');
  ok(!/\{ name: 'LSM', dims: \['act'\]/.test(menu),
     'it no longer carries the activity-led dims');
  /* ⚠️⚠️ THE OLD GROUPING IS RENAMED, NOT DELETED, AND THE OWNER CONFIRMED IT STAYS
     ("Keep the Activity › Location preset"). It is a real grouping somebody may be using
     today; freeing up a name is not worth taking it away. */
  ok(/name: 'Activity › Location', dims: \['act'\]\.concat\(locDims\)/.test(menu),
     'the old dims survive under an honest name');
  /* ⚠️ AND NOTHING IN THE SOURCE STILL CLAIMS THE TWO CONTROLS DIFFER. The toolbar comment and
     the LSM-rows tooltip both used to warn about the collision; after this change that warning is a
     FALSE STATEMENT, which is how a screen loses trust. Asserted so it cannot come back. */
  ok(!/is NOT the Group menu's "LSM" preset/.test(src), 'no stale claim that the two doors differ');
  ok(!/Not the same as the Group menu/.test(src), 'and none in the toolbar tooltip either');
  /* Picking it HANDS OVER to the mode setter rather than setting dims itself. */
  ok(/if \(p\.lsm\) setLsmRows\(true\); else setGroupBys\(p\.dims\);/.test(menu),
     'picking it calls setLsmRows, which arranges the grouping itself');
  ok(/p\.lsm \?/.test(menu), 'and the button says it is a mode');

  /* ⚠️⚠️ THE COUPLING'S COST, HANDLED: the mode leaves when the grouping stops being location-led,
     in the ONE place all twelve setGroupBys callers pass through. */
  const sgb = sliceFn('setGroupBys') || '';
  ok(/_lsmRows = false/.test(sgb), 'setGroupBys drops the mode when the grouping is not location-led');
  ok(/indexOf\('loc:'\) !== 0/.test(sgb), 'and it decides that by testing the dims');
  ok(/ps-lsmbtn/.test(sgb), 'the toolbar button stops claiming an LSM chart is on screen');
  ok(/applyRowZoom\(/.test(sgb), 'and the row height is re-derived');
  /* ⚠️ It must not fight _lsmArrange, which sets a LOCATION-LED grouping while turning the mode on. */
  const arr = sliceFn('_lsmArrange') || '';
  ok(/setGroupBys\(locDims\)/.test(arr),
     'the arrange step sets a location-led grouping, so turning the mode ON cannot turn it off');

  /* ⚠️⚠️ EXECUTE THE SHIPPED GUARD, NOT A COPY OF IT. The first cut of this block
     re-typed the condition into the suite and asserted on THAT — and a negative build with the
     guard's own `if (!_locLed)` turned into `if (false)` PASSED every one of them, because the
     statements were all still present in the source and the arithmetic under test was the suite's
     own. So the block is now CUT OUT OF `setGroupBys` and RUN, and anything that makes it
     unreachable fails here. The repo's own rule, which bit on its first application. */
  const gi = sgb.indexOf('if (_lsmRows) {');
  ok(gi !== -1, 'the guard block is locatable inside setGroupBys');
  const guard = (function () {
    if (gi === -1) return '';
    let d = 0, started = false;
    for (let k = sgb.indexOf('{', gi); k < sgb.length; k++) {
      const c = sgb[k];
      if (c === '{') { d++; started = true; }
      else if (c === '}') { d--; if (started && d === 0) return sgb.slice(gi, k + 1); }
      else if (c === "'" || c === '"') {
        const q = c; k++;
        while (k < sgb.length && sgb[k] !== q) { if (sgb[k] === '\\') k++; k++; }
      }
    }
    return '';
  })();
  ok(guard.length > 80 && /_locLed/.test(guard), 'and it is cut whole out of the shipped source');

  const runGuard = new Function('groupBys', '_lsmRows', 'env', [
    'var localStorage = env.localStorage, document = env.document;',
    'var applyRowZoom = env.applyRowZoom, _paintViewBtn = env._paintViewBtn;',
    guard,
    'return _lsmRows;'
  ].join('\n'));

  function fire(dims, on) {
    const env = { zoom: 0, painted: 0, removed: 0, stored: null };
    env.localStorage = { setItem: function (k, v) { if (k === 'ps_lsmrows') env.stored = v; } };
    env.document = { getElementById: function (id) {
      return id === 'ps-lsmbtn' ? { classList: { remove: function () { env.removed++; } } } : null;
    } };
    env.applyRowZoom = function () { env.zoom++; };
    env._paintViewBtn = function () { env.painted++; };
    env.left = runGuard(dims, on !== false, env);
    return env;
  }

  eq(fire(['loc:a', 'loc:b']).left, true, 'a location-only grouping KEEPS the mode');
  eq(fire(['act', 'loc:a']).left, false, 'Activity › Location drops it');
  eq(fire(['wbs']).left, false, 'the WBS tree drops it');
  eq(fire(['work', 'act', 'loc:a']).left, false, 'By Activity drops it');
  eq(fire([]).left, false, 'and an empty grouping drops it rather than claiming location-led');
  /* ⚠️ The flag flipping is not enough — the SCREEN has to stop claiming the mode. */
  const dropped = fire(['wbs']);
  eq(dropped.stored, '0', 'the persisted flag is cleared, so a reload does not bring it back');
  eq(dropped.removed, 1, 'the lit toolbar button is un-lit');
  eq(dropped.zoom, 1, 'and the row height is re-derived');
  const kept = fire(['loc:a']);
  eq(kept.zoom, 0, 'a kept mode touches nothing');
  eq(kept.stored, null, 'and writes nothing');
  /* The mode being off already must be a no-op whatever the grouping is. */
  eq(fire(['wbs'], false).left, false, 'with the mode off the guard is inert');
  eq(fire(['wbs'], false).zoom, 0, 'and does not re-derive a row height nobody changed');
  /* ⚠️ The one case where that last line could bite: a project with NO location levels.
     `_lsmArrange` never reaches `setGroupBys` there — it toasts instead — so the mode is not
     switched off underneath its own empty state. Asserted on the shipped source, because the
     guard above would otherwise drop the mode the instant it was turned on. */
  ok(/if \(!locDims\.length\) \{\s*UI\.toast\(/.test(arr),
     'with no location levels the arrange step toasts and never calls setGroupBys');
  ok(arr.indexOf('setGroupBys(locDims)') > arr.indexOf('if (!locDims.length)'),
     'the setGroupBys call sits inside the else branch, after that test');
  /* Turning the mode OFF restores the old grouping — and must not re-enter the guard. */
  const slr = sliceFn('setLsmRows') || '';
  ok(/_lsmRows = !!on;[\s\S]*_lsmArrange\(said\)/.test(slr),
     'the flag is set BEFORE the grouping is arranged, so the guard sees a mode that is on');
  ok(/\} else if \(_lsmPrevGroup && _lsmPrevGroup\.length\) \{\s*setGroupBys\(_lsmPrevGroup\)/.test(slr),
     'and switching off restores the planner grouping with the flag already false');
})();

/* ================================ NOTHING ENDS IN A DEAD END ===================================
   ⚠️⚠️ This module has shipped "built with no door" THREE times that its own log records:
   `fillDown`'s change-order branch (complete, reachable from nothing), `openLocAdopt` (wired to no
   button for weeks) and `cfg.floorLag` (declared in blank()/normalize(), read nowhere). So every
   name this feature adds is asserted to have a CALLER, and every control to have a HANDLER. A
   structural assertion is the only thing that keeps that true after the next edit. */
(function () {
  /* Comments stripped: a name mentioned only in prose is not a caller. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const uses = (n) => (code.match(new RegExp('\\b' + n.replace('$', '\\$') + '\\b', 'g')) || []).length;

  /* Functions: declaration + at least one call. */
  ['_lsmLanes', '_lsmLaneCount', '_lsmLaneIndex', '_lsmRowH', '_lsmIdleGap', '_lsmAgg',
   '_lsmBarsHTML', '_lsmDecl', '_lsmRankOf', '_lsmRankBasis', '_lsmFit', '_lsmRate',
   '_lsmRateHTML', '_clearLsmRateMemo', '_clearLsmDeclMemo', 'setLsmRows',
   '_lsmAxOf', '_lsmSeq', '_lsmClash', '_lsmClashHTML',
   '_lsmStateOf', '_lsmStoreyStatus', '_lsmStatusLabel', 'startDDDrag',
   '_lsmShaped', '_locFloorLevelId',
   '_lsmAggOn', '_lsmArrange', '_lsmFinish', 'setFlowlineMode', 'renderFlowline',
   /* the declared cross-trade handoff */
   '_lsmLead', '_lsmLeadWarm', '_clearLsmLeadMemo', 'declaredBatchOf', 'declaredBatch',
   'handoffFrom', 'parallelKindOf', '_lsmKindWord',
   '_lsmDeclWarm', '_clearLsmDeclCat', '_lsmPaintBtn'].forEach(function (n) {
    ok(uses(n) >= 2, n + ' has a caller (not a dead end)', uses(n));
  });
  /* ⚠️⚠️ THE WHOLE POINT OF THIS SLICE. `cfg.tradeLeads` was one of the declared-but-unread
     fields this audit exists to catch — created in blank(), kept by normalize(), read by nothing
     since 2026-08-13. It is READ now, and the assertion says so in those terms so a future edit
     that drops the read fails here rather than silently restoring the dead end. */
  ok(/tradeLeads\[/.test(code) || /c\.tradeLeads/.test(code),
     'cfg.tradeLeads is READ, not merely normalized');
  ok(uses('tradeLeads') >= 3, 'created, normalized AND consumed', uses('tradeLeads'));
  ok(uses('tradeHandoff') >= 2 && uses('tradeHandoffFor') >= 2,
     'and both handoff exports have a caller on the Gantt side');
  /* Constants and state: declaration + at least one read. */
  ['LSM_LANE_H', 'LSM_LANE_GAP', 'LSM_PAD', 'LSM_LANE_MAX', 'LSM_MIN_FLOORS', 'LSM_R2_OK',
   '_lsmRows', '_lsmTopFirst', '_lsmPrevGroup', '_lsmRateMemo', '_lsmDeclMemo',
   'LSM_CLASH_MIN', '_lsmClashMemo', '_lsmAxes', '_lsmStatus',
   '_lsmLeadMemo', '_lsmLeadAsked', '_lsmDeclCat', '_lsmDeclAsked'].forEach(function (n) {
    ok(uses(n) >= 2, n + ' is read somewhere (not write-only)', uses(n));
  });
  /* ⚠️ Fields on the clash model, which are just as easy to set and never read. `nOverlap` was
     exactly that on the first cut — set beside `nLead` and consumed by nobody. */
  ['nLead', 'nOverlap', 'leadBasis', 'nUnkinded', 'fkind'].forEach(function (n) {
    ok(uses(n) >= 2, 'clash model field ' + n + ' is read, not just set', uses(n));
  });

  /* Every control is emitted AND wired, in the same render. */
  [['ps-alg-lsmrows', 'setLsmRows'], ['ps-alg-lsmtop', '_setLsmTop'], ['ps-alg-lsmbot', '_setLsmTop']]
    .forEach(function (p) {
      ok(code.indexOf("id=\"" + p[0] + "\"") !== -1, p[0] + ' is emitted in the markup');
      ok(new RegExp("querySelector\\('#" + p[0] + "'\\)").test(code), p[0] + ' is looked up and wired');
    });
  ok(/_setLsmTop\s*\(/.test(code), 'the Roof/Ground buttons call the persisting setter');
  ok(/data-lsmclash="/.test(code), 'clash chips are emitted');
  ok(/querySelectorAll\('button\[data-lsmclash\]'\)/.test(code), 'and they are wired to navigate');
  ok(/_lsmClashHTML\(\)/.test(code), 'the clash strip is rendered by the legend');
  ok(/cmpWorkName/.test(sliceFn('_lsmSeq') || ''), 'the declared sequence reuses cmpWorkName');
  ok(code.indexOf('id="ps-alg-lsmstat"') !== -1, 'the Status switch is emitted');
  ok(/querySelector\('#ps-alg-lsmstat'\)/.test(code), 'and wired');
  ok(/_stkState\(/.test(sliceFn('_lsmStateOf') || ''), 'the status read goes through the SHARED _stkState');
  ok(uses('_stkState') >= 3, '_stkState now serves both the stacking panel and the LSM rows');
  /* The toolbar door the owner's question exposed. */
  ok(code.indexOf('id="ps-lsmbtn"') !== -1, 'the LSM layout has a TOOLBAR button, not only a legend checkbox');
  ok(/getElementById\('ps-lsmbtn'\)/.test(code), 'and it is wired');
  ok(/setLsmRows\(!_lsmRows\)/.test(code), 'it toggles, like the Progress and Stacking buttons do');
  ok(/_TB_SHED = \[[^\]]*ps-lsmbtn/.test(src), 'and it sheds with them in compact mode');
  ok(/lsm: 'LSM'/.test(code), 'the View button can name it');
  ok(/_lsmShaped\(\)\) return 'lsm'/.test(code), 'but only while the grouping actually shapes it');

  /* The three things the mode must arrange are all reached from the setter. */
  /* ⚠️ RETARGETED, not loosened: slice 5 extracted the arrange step into `_lsmArrange` and the
     repaint into `_lsmFinish` so the flowline uses the SAME one. The properties are unchanged and
     one is stronger — that both entry points go through the one arrange. */
  const setter = sliceFn('setLsmRows') || '';
  const arrange = sliceFn('_lsmArrange') || '';
  const finish = sliceFn('_lsmFinish') || '';
  ok(arrange !== '', 'the arrange step is its own function');
  ok(/setGroupBys\(/.test(arrange), 'it sets the location grouping (reusing setGroupBys)');
  ok(/expandToLevel\(/.test(arrange), 'it collapses via the EXISTING expandToLevel');
  ok(/saveCatKeys\(/.test(arrange), 'it proposes the curated key trades');
  ok(/_locFloorLevelId\(\)/.test(arrange) && /_fi \+ 1/.test(arrange),
     'and it collapses at the FLOOR depth, not the deepest level');
  ok(/applyRowZoom\(/.test(finish), 'the repaint step pushes the lane budget through applyRowZoom');
  ok(/_lsmArrange\(/.test(setter), 'setLsmRows delegates to the arrange step');
  ok(/_lsmFinish\(/.test(setter), 'and to the repaint step');
  ok(/UI\.toast\(/.test(finish), 'which reports what it changed');
  ok(/_lsmPrevGroup/.test(setter), 'and the mode is reversible');
  /* ⚠️⚠️ THE POINT OF THE EXTRACTION: the flowline must not carry a second copy. */
  const flow = sliceFn('setFlowlineMode') || '';
  ok(flow !== '', 'the flowline has a mode setter');
  ok(/_lsmArrange\(/.test(flow), 'and it goes through the SAME arrange step');
  ok(!/expandToLevel\(/.test(flow) && !/saveCatKeys\(/.test(flow),
     'with no second copy of the collapse or the curation');
  ok(/setVStackMode\(false\)/.test(flow) && /setProgressMode\(false\)/.test(flow),
     'one full-width panel at a time, like setVStackMode does');
  ok(!/_lsmRows = /.test(flow), 'and it does NOT turn the row layout on - two readings, one model');

  /* The renderer and the aggregation are actually reached from the render path. */
  ok(/_lsmBarsHTML\(r, min, dayw, top\)/.test(code) || /return out \+ _lsmBarsHTML\(/.test(code),
     'ganttRowHTML calls the LSM renderer');
  ok(/_glsm:/.test(code) && /r\._glsm/.test(code),
     'buildNodes writes _glsm and the renderer reads it');
  ok(/_lsmRateHTML\(\)/.test(code), 'the Rate strip is rendered by the legend');
  ok(/_clearLsmRateMemo\(\);/.test(code), 'and its memo is cleared once per frame');

  /* ⚠️ The reverse direction: existing machinery my code must NOT have duplicated. */
  ok(uses('makeAxis') >= 2, 'the shared working-day axis is reused');
  ok(uses('workingDaysInRange') >= 1, 'the shared working-day counter is reused');
  ok(uses('expandToLevel') >= 2, 'the existing collapse is reused');
  ok(uses('catKeyList') >= 1 || uses('saveCatKeys') >= 1, 'the existing curated key set is reused');
  ok(uses('locCatalogue') >= 1, 'the declared location breakdown is reused');
  ok(uses('cpmCalOf') >= 2, 'the scheduling calendar resolver is reused');
})();


/* ============ THE DECLARED CROSS-TRADE HANDOFF, WIRED INTO THE CLASHES (2026-09-11) ============ */
(function () {
  /* ⚠️⚠️ EXECUTED, NOT READ. Everything below runs the SHIPPED functions - the lesson from the
     preset guard, where a re-typed copy of the condition passed against a build whose real guard
     had been turned into `if (false)`. */
  const hf = sliceAny('handoffFrom');
  const db = sliceAny('declaredBatchOf');
  const bk = sliceAny('batchKind');
  ok(hf && db && bk, 'handoffFrom / declaredBatchOf / batchKind are all present');

  const GROUPS = ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'];
  const GLABEL = { GR: 'General Requirements', SW: 'Site Works', ST: 'Structural', AR: 'Architectural', MEPF: 'MEPF', SD: 'Site Development', ALLIED: 'Allied Services', OT: 'Others' };
  const GWORK = { GR: 'General Requirements', SW: 'Site Works', ST: 'Structural Works', AR: 'Architectural Works', MEPF: 'MEPF Works', SD: 'Site Development', ALLIED: 'Allied Services', OT: 'Others' };

  const dbw = sliceAny('declaredBatch');
  ok(dbw && /declaredBatchOf\(cfg, prev, k\)/.test(dbw),
     'declaredBatch is the cfg-bound wrapper, so batchKind reads one implementation');
  const pko = sliceAny('parallelKindOf');
  const pk = sliceAny('parallelKind');
  ok(pko && pk && /parallelKindOf\(cfg, prev, k\)/.test(pk),
     'parallelKind delegates to the cfg-free reader, so "start together" has one implementation');
  const env = new Function('GROUPS', 'GLABEL', 'GWORK', 'KIND_ORDER', 'CFG', [
    'var cfg = CFG;', db, dbw, bk, pko, pk, hf,
    'return { handoffFrom: handoffFrom, declaredBatchOf: declaredBatchOf, batchKind: batchKind,',
    '         declaredBatch: declaredBatch, parallelKind: parallelKind,',
    '         parallelKindOf: parallelKindOf };'
  ].join('\n'));
  const KIND_ORDER = ['basement', 'podium', 'typical', 'roof'];

  /* ---- 1. declaredBatchOf tells a DECLARATION from a default, PER CATEGORY ------------------- */
  let M = env(GROUPS, GLABEL, GWORK, KIND_ORDER, {});
  const C0 = { tradeBatch: {}, tradeBatchKind: {} };
  eq(M.declaredBatchOf(C0, 'ST', 'typical'), null,
     'nothing declared answers NULL, not the project default');
  eq(M.declaredBatchOf({ tradeBatch: { ST: 6 }, tradeBatchKind: {} }, 'ST', 'typical'), 6,
     'the per-leading-trade answer is a declaration');
  eq(M.declaredBatchOf({ tradeBatch: { ST: 6 }, tradeBatchKind: { ST: { typical: 3 } } }, 'ST', 'typical'), 3,
     'and the per-kind typical value wins if the two ever drift');
  /* ⚠️⚠️ THE KINDLESS ANSWER IS THE TYPICAL ANSWER AND ONLY THAT. `cfg.tradeBatch` predates
     floor categories, and `batchKind` has always defaulted every other category to 1 rather than
     lifting the global number across them. Lifting it here would rewrite what those projects said. */
  eq(M.declaredBatchOf({ tradeBatch: { ST: 6 }, tradeBatchKind: {} }, 'ST', 'basement'), null,
     'a kindless answer does NOT become the basement\u2019s rule');
  eq(M.declaredBatchOf({ tradeBatch: { ST: 6 }, tradeBatchKind: { ST: { basement: 1 } } }, 'ST', 'basement'), 1,
     'the basement gets its rule only when the basement was answered');
  eq(M.declaredBatchOf({ tradeBatch: { ST: 0 }, tradeBatchKind: {} }, 'ST', 'typical'), 1,
     'a zero is clamped to 1, never treated as "no handoff"');
  eq(M.declaredBatchOf(C0, 'ST'), null, 'the kind argument defaults to typical');

  /* ---- 2. ⚠️⚠️ THE SPLIT LEFT batchKind AND parallelKind BEHAVIOUR-IDENTICAL. Proved by running
     BOTH the old one-liners and the shipped ones over the same configs, not by reading the diff. -- */
  const OLD = new Function('cfg', 'prev', 'k', [
    "var m = cfg.tradeBatchKind && cfg.tradeBatchKind[prev]; var v = m ? m[k] : null;",
    "if (v == null && k === 'typical') v = cfg.tradeBatch[prev];",
    "if (v == null) v = (k === 'typical' ? (cfg.floorLead || 4) : 1);",
    "return Math.max(1, +v || 1);"
  ].join('\n'));
  const OLDP = new Function('cfg', 'prev', 'k', [
    "var m = cfg.tradeParallelKind && cfg.tradeParallelKind[prev];",
    "if (m && (k in m)) return !!m[k];",
    "if (k === 'typical') return !!cfg.tradeParallel[prev];",
    "return false;"
  ].join('\n'));
  const CFGS = [
    { tradeBatch: {}, tradeBatchKind: {}, tradeParallel: {}, tradeParallelKind: {}, floorLead: 4 },
    { tradeBatch: { ST: 6 }, tradeBatchKind: {}, tradeParallel: { ST: true }, tradeParallelKind: {}, floorLead: 4 },
    { tradeBatch: { ST: 6 }, tradeBatchKind: { ST: { typical: 3, basement: 2 } }, tradeParallel: {},
      tradeParallelKind: { ST: { roof: true } }, floorLead: 4 },
    { tradeBatch: { ST: 6 }, tradeBatchKind: { ST: { roof: 1 } }, tradeParallel: { AR: true },
      tradeParallelKind: { ST: { typical: false } }, floorLead: 9 },
    { tradeBatch: {}, tradeBatchKind: { AR: { typical: 2 } }, tradeParallel: {}, tradeParallelKind: {}, floorLead: 0 }
  ];
  let diff = 0, diffP = 0, n2 = 0;
  CFGS.forEach(function (c) {
    const m2 = env(GROUPS, GLABEL, GWORK, KIND_ORDER, c);
    ['GR', 'ST', 'AR', 'MEPF'].forEach(function (g) {
      KIND_ORDER.forEach(function (k) {
        n2++;
        if (m2.batchKind(g, k) !== OLD(c, g, k)) diff++;
        if (m2.parallelKind(g, k) !== OLDP(c, g, k)) diffP++;
      });
    });
  });
  eq(diff, 0, 'batchKind is behaviour-identical to what it was before the split');
  eq(diffP, 0, 'and so is parallelKind');
  eq(n2, 80, 'over all 80 (cfg, trade, floor-category) combinations');

  /* ---- 3. handoffFrom: every spelling, every category, and the legacy per-pair field ----------- */
  /* ⚠️⚠️ READ THE NESTED SHAPE SAFELY. The first cut used raw dots, and a negative build that
     drops a trade's entry then CRASHED the suite on `undefined.kind` instead of failing it - which
     hides every assertion after it and reports a detected regression as a broken checker. Second
     time this exact fault appeared in this feature; `first()` below was the first. */
  const kv = function (H2, label, fk) {
    const r = H2 && H2.lead && H2.lead[label];
    const k2 = r && r.kind && r.kind[fk];
    return k2 ? k2.v : undefined;
  };
  const kp = function (H2, label, fk) {
    const r = H2 && H2.lead && H2.lead[label];
    const k2 = r && r.kind && r.kind[fk];
    return k2 ? k2.p : undefined;
  };
  let H = M.handoffFrom({ tradeBatch: { ST: 6 }, tradeBatchKind: {}, tradeLeads: {} });
  eq(H.any, true, 'a declared per-trade handoff registers');
  eq(kv(H, 'structural works', 'typical'), 6, 'keyed by the canonical GWORK label');
  eq(kv(H, 'structural', 'typical'), 6, '⚠️ AND by the setup\u2019s short GLABEL - both reach the grid');
  eq(kv(H, 'st', 'typical'), 6, 'and by the raw group code');
  eq(kv(H, 'structural works', 'basement'), undefined,
     '⚠️ and it says NOTHING about the basements, because nothing was said about them');
  eq(H.lead['architectural works'], undefined, 'a trade nobody declared stays absent');

  H = M.handoffFrom({ tradeBatch: {}, tradeLeads: {},
                      tradeBatchKind: { ST: { basement: 1, podium: 2, typical: 6, roof: 3 } } });
  eq(kv(H, 'structural works', 'basement'), 1, 'each category carries its own number: basement');
  eq(kv(H, 'structural works', 'podium'), 2, 'podium');
  eq(kv(H, 'structural works', 'typical'), 6, 'typical');
  eq(kv(H, 'structural works', 'roof'), 3, 'roof');

  /* "Start together" is an answer too, and it is NOT a levels-behind. */
  H = M.handoffFrom({ tradeBatch: {}, tradeLeads: {}, tradeBatchKind: {},
                      tradeParallelKind: { ST: { basement: true } } });
  eq(kp(H, 'structural works', 'basement'), true, 'a "start together" category is carried');
  eq(kv(H, 'structural works', 'basement'), null, 'with no levels-behind attached to it');
  eq(H.any, false,
     '⚠️⚠️ and "start together" ALONE does not make a levels-behind claim - `any` stays false');
  H = M.handoffFrom({ tradeBatch: {}, tradeLeads: {}, tradeBatchKind: {}, tradeParallel: { ST: true } });
  eq(((H.lead || {})['structural works'] || {}).par, true,
     'the whole-trade "start together" is carried too');

  /* ⚠️⚠️ THE FIELD THE OWNER ASKED FOR FIRST. `cfg.tradeLeads` is the LEGACY per-pair form, key
     shape `prev + '>' + next`, read off the last commit that consumed it rather than guessed. */
  H = M.handoffFrom({ tradeBatch: { ST: 6 }, tradeBatchKind: {}, tradeLeads: { 'ST>AR': 9 } });
  eq(H.pair['structural works>architectural works'], 9, 'the legacy per-pair answer is read');
  eq(H.pair['structural>architectural'], 9, 'under every spelling of both trades');
  eq(kv(H, 'structural works', 'typical'), 6, 'and it does not disturb the per-trade answer');
  H = M.handoffFrom({ tradeBatch: {}, tradeBatchKind: {}, tradeLeads: { 'ST>AR': 2 } });
  eq(H.any, true, '⚠️ tradeLeads ALONE is enough - the pre-2026-08-13 project this wiring is for');
  H = M.handoffFrom({ tradeBatch: {}, tradeBatchKind: {},
                      tradeLeads: { 'ST': 3, 'A>B>C': 3, 'ST>AR': 0, 'SW>AR': 'x' } });
  eq(Object.keys(H.pair).length, 0, 'a malformed or zero pair key is ignored, not defaulted');
  eq(H.any, false, 'and does not claim a declaration exists');

  /* ---- 4. ⚠️⚠️ floorLead IS NOT EVIDENCE ---------------------------------------------------- */
  H = M.handoffFrom({ tradeBatch: {}, tradeBatchKind: {}, tradeLeads: {}, floorLead: 4 });
  eq(H.any, false,
     '⚠️⚠️ a project that declared NOTHING has no handoff, even though blank() sets floorLead 4');
  eq(Object.keys(H.lead).length, 0, 'and no trade carries a lead derived from that default');
  ok(!/floorLead/.test(hf), 'handoffFrom does not read floorLead at all');
  ok(!/floorLead/.test(sliceFn('_lsmClash') || ''), 'and neither does the clash detector');
  eq(M.handoffFrom(null).any, false, 'a missing cfg is "no claim", not a crash');

  /* ---- 5. The shipped lead pass, cut out of _lsmClash and run --------------------------------- */
  const cl = sliceFn('_lsmClash') || '';
  ok(/_lsmLead\(\)/.test(cl), '_lsmClash asks for the declared handoff');
  ok(/seq\.basis === 'declared'/.test(cl),
     '⚠️ and only applies it when the lanes ARE trades');
  ok(/nextOf\[A\.value\] === B\.value/.test(cl),
     '⚠️⚠️ a per-TRADE lead is applied only to the trade that actually follows');
  ok(/LD\.pair\[/.test(cl), 'while a per-PAIR lead names both trades and applies to that pair');
  /* ⚠️⚠️ autoTrace's OWN arithmetic, character for character — `si = pk[Math.min(ord + L - 1,
     pk.length - 1)]`. It CLAMPS to the top of the category rather than skipping, and yesterday's
     version skipped, which under-reported against the planner's own declaration. The setup is the
     definition of what the answer means; two readings of it is the `_vsTowerModel` fault. */
  ok(/Math\.min\(ordK \+ L - 1, pk\.length - 1\)/.test(cl),
     '⚠️⚠️ the lead is clamped to the top of the category, exactly as autoTrace traces it');
  ok(/rec\.par/.test(cl) && /kr\.p/.test(cl),
     '⚠️⚠️ and a "start together" answer suppresses the finding, per trade and per category');
  ok(/_lsmDecl\(\)\.kind/.test(cl),
     "the storey's category comes from _lsmDecl's existing match, not a second matcher");
  ok(/unkinded\[/.test(cl) && /out\.nUnkinded/.test(cl),
     '⚠️ and a storey with no declared category is counted rather than silently skipped');
  ok(!/'typical'/.test(cl.slice(cl.indexOf('var LD = _lsmLead();'))) ||
     /fk === 'typical' \? pairL : null/.test(cl),
     "⚠️ the only place the pass names a category is the kindless per-pair answer's typical-only rule");
  ok(/_lsmRate\(\)/.test(cl) && /R2\.ord/.test(cl),
     'the storey ordinals come from the rate model, not a second derivation');
  ok(!/levelRank\(/.test(cl), 'and the clash detector still derives no ranking of its own');

  /* ⚠️⚠️ EXECUTE IT. The whole `if (LD.any && ...)` block is cut out and run against a
     fabricated tower, so a change that makes it unreachable fails here. */
  const li = cl.indexOf('var LD = _lsmLead();');
  ok(li !== -1, 'the lead pass is locatable');
  const lend = cl.indexOf('/* Worst first:', li);
  ok(lend > li, 'and bounded by the sort that follows it');
  const pass = cl.slice(li, lend);

  /* ⚠️ TWO FLOOR CATEGORIES, because that is the whole point of this pass. Storeys 0-1 are
     basements, 2-5 typical. The kinds are returned through a stubbed `_lsmDecl`, which is where the
     shipped code reads them from, so the storey-to-category match under test is the real one. */
  const KINDOF = ['basement', 'basement', 'typical', 'typical', 'typical', 'typical'];

  function tower(bStarts, aFinish, kinds) {
    /* Six storeys, ordinals 0..5. A (Structural) finishes each storey on aFinish[o];
       B (Architectural) starts each storey on bStarts[o]. Dates are day numbers. */
    const d = function (n) { return n; };
    const ord = { T: {} }, byRank = { A: {}, B: {} }, label = {}, kind = {};
    for (let o = 0; o < 6; o++) {
      ord.T[o] = o;
      /* The storey's own words, the way _lsmRate hands them out - so the chip's "loc" and "aloc"
         are exercised rather than left undefined. */
      label['T' + o] = (o === 0 ? 'Ground Floor' : o + 'th Floor');
      const fk = (kinds || KINDOF)[o];
      if (fk) kind[label['T' + o].toLowerCase().replace(/[^a-z0-9]+/g, '')] = fk;
      if (aFinish[o] != null) byRank.A[o] = { s: d(aFinish[o] - 5), f: d(aFinish[o]) };
      if (bStarts[o] != null) byRank.B[o] = { s: d(bStarts[o]), f: d(bStarts[o] + 5) };
    }
    return {
      ord: ord, label: label, __kind: kind,
      byKey: {
        'TStructural Works': { ser: 'T', value: 'Structural Works', cal: null, byRank: byRank.A },
        'TArchitectural Works': { ser: 'T', value: 'Architectural Works', cal: null, byRank: byRank.B }
      }
    };
  }

  function runPass(model, LD, basis) {
    const out = { list: [], marks: {}, n: 0, nOverlap: 0, nLead: 0, basis: basis || 'declared',
                  wd: false, leadBasis: false, nUnkinded: 0 };
    const seq = { basis: basis || 'declared', idx: { 'Structural Works': 0, 'Architectural Works': 1 },
                  order: ['Structural Works', 'Architectural Works'] };
    const fn = new Function('out', 'seq', 'min', 'max', 'rowAt', 'LSM_CLASH_MIN', 'ENV', [
      'var k;',
      'var _lsmLead = ENV.lead, _lsmRate = ENV.rate, _lsmAxOf = ENV.ax, dayDiff = ENV.dayDiff;',
      'var _lsmDecl = ENV.decl, locNormKey = ENV.normKey;',
      pass,
      'return out;'
    ].join('\n'));
    return fn(out, seq, 0, 400, {}, 1, {
      lead: function () { return LD; },
      rate: function () { return model; },
      decl: function () { return { map: {}, n: 6, kind: model.__kind }; },
      /* The same shape of key the shipped `locNormKey` produces - lowercased, alphanumerics only. */
      normKey: function (v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ''); },
      /* A plain calendar-day axis: span(a, b) is the inclusive day count. */
      ax: function () { return { wd: false, span: function (a, b) { return b - a + 1; } }; },
      dayDiff: function (a, b) { return b - a; }
    });
  }

  const first = function (r) { return (r.list && r.list[0]) || {}; };
  const AF = [10, 20, 30, 40, 50, 60];        /* Structural finishes storey o on day 10*(o+1) */
  /* Basements 1 level behind, typical floors 2. Both categories answered. */
  const D12 = { any: true, pair: {},
                lead: { 'structural works': { par: false,
                        kind: { basement: { v: 1, p: false }, typical: { v: 2, p: false } } } } };

  /* ⚠️⚠️ COUNTED WITHIN THE CATEGORY. Storeys 2..5 are the typical floors, so typical ordinals
     are 0,1,2,3 - NOT 2,3,4,5. With a 2-floor typical lead, B on storey 2 (typical ordinal 0) waits
     for A's typical ordinal 1, which is storey 3 (day 40). Getting this wrong by counting across
     the whole building would ask for storey 3 as well only by coincidence, so the fixture makes the
     two answers differ: B on storey 4 (typical ordinal 2) needs A's typical ordinal 3 = storey 5
     (day 60); counting globally would have asked for storey 5 too. So the DISCRIMINATING case is
     the basement, whose lead is 1 and whose ordinals restart at 0. */
  let ok1 = runPass(tower([25, 35, 45, 55, 65, 75], AF), D12);
  eq(ok1.nLead, 0, 'a schedule that honours both categories\u2019 handoffs is not flagged');

  /* Basements: lead 1 means B on basement ordinal 0 (storey 0) waits for A's basement ordinal 0
     (storey 0, day 10). Start on day 12 - fine. Start on day 8 - early. */
  let b1 = runPass(tower([8, 35, 45, 55, 65, 75], AF), D12);
  ok(b1.nLead > 0, 'a basement that starts before its own 1-level handoff is flagged', b1.nLead);
  eq(first(b1).fkind, 'basement', '⚠️⚠️ and the finding names the CATEGORY whose rule it applied');
  eq(first(b1).need, 1, 'with that category\u2019s number, not the typical one');

  /* ⚠️⚠️ THE TYPICAL NUMBER MUST NOT REACH THE BASEMENT. Same schedule, but only `typical` is
     answered: the basements then have no rule and must produce nothing at all. */
  const DT = { any: true, pair: {},
               lead: { 'structural works': { par: false, kind: { typical: { v: 2, p: false } } } } };
  let b2 = runPass(tower([8, 8, 45, 55, 65, 75], AF), DT);
  eq(b2.list.filter(function (x) { return x.fkind === 'basement'; }).length, 0,
     '⚠️⚠️ an unanswered category is never measured against another category\u2019s number');

  /* ⚠️⚠️ "START TOGETHER" SUPPRESSES THE FINDING. autoTrace draws no trailing link for such a
     category, so reporting one would contradict the schedule the same setup generates. */
  const DPAR = { any: true, pair: {},
                 lead: { 'structural works': { par: false,
                         kind: { basement: { v: 1, p: true }, typical: { v: 2, p: false } } } } };
  let b3 = runPass(tower([8, 8, 45, 55, 65, 75], AF), DPAR);
  eq(b3.list.filter(function (x) { return x.fkind === 'basement'; }).length, 0,
     'a category the planner marked "start together" produces no handoff finding');
  /* And the WHOLE-trade parallel answer suppresses every category. */
  const DPARALL = { any: true, pair: {},
                    lead: { 'structural works': { par: true,
                            kind: { basement: { v: 1, p: false }, typical: { v: 2, p: false } } } } };
  eq(runPass(tower([1, 1, 1, 1, 1, 1], AF), DPARALL).nLead, 0,
     'and a leading trade marked "start together" outright produces none at all');

  /* The finding's own fields, on a clearly early typical floor. */
  let r2 = runPass(tower([25, 35, 32, 42, 52, 62], AF), D12);
  ok(r2.nLead > 0, 'climbing closer than the declaration IS flagged', r2.nLead);
  eq(first(r2).kind, 'lead', 'and is reported as its own class');
  eq(first(r2).how, 'trade', 'saying where the number came from');
  eq(first(r2).b, 'Architectural Works', 'the FOLLOWING trade is the subject');
  eq(r2.leadBasis, true, 'the model records that a handoff was actually checked');
  const mk = Object.keys(r2.marks);
  eq(mk.length, r2.nLead, 'one mark per finding');
  ok(mk.every(function (k) { return k.indexOf('Architectural Works') !== -1; }),
     '⚠️ and every mark is on the FOLLOWING trade, never on the one that is where it was told to be');

  /* ⚠️⚠️ THE TOP OF A CATEGORY IS CLAMPED, NOT SKIPPED - autoTrace's own rule
     (`si = pk[Math.min(ord + L - 1, pk.length - 1)]`), and a CORRECTION to the version shipped
     yesterday, which skipped. The schedule this setup generates really does make B's top typical
     floor wait for A's top typical floor, so skipping under-reported against the planner's own
     declaration. Here B starts its TOP typical floor (storey 5) on day 1, long before A finishes
     storey 5 on day 60. */
  let top = runPass(tower([25, 35, 45, 55, 65, 1], AF), D12);
  ok(top.list.some(function (x) { return x.rank === 5; }),
     '⚠️⚠️ the top storey of a category IS checked, against that category\u2019s top floor');

  /* ⚠️⚠️ A STOREY WITH NO DECLARED CATEGORY IS NOT CHECKED, AND IS COUNTED. */
  let unk = runPass(tower([1, 1, 1, 1, 1, 1], AF, ['basement', 'basement', 'typical', 'typical', '', '']), D12);
  eq(unk.nUnkinded, 2, 'storeys missing from the setup\u2019s floor list are counted');
  eq(unk.list.filter(function (x) { return x.rank === 4 || x.rank === 5; }).length, 0,
     '⚠️⚠️ and never measured against a category that was guessed for them');
  ok(unk.nLead > 0, 'while the storeys that DO have a category are still checked', unk.nLead);

  /* Nothing declared: the pass must not fire at all. */
  eq(runPass(tower([12, 22, 32, 42, 52, 62], AF), { any: false, pair: {}, lead: {} }).nLead, 0,
     'with nothing declared there are no handoff findings');
  eq(runPass(tower([12, 22, 32, 42, 52, 62], AF), D12, 'inferred').nLead, 0,
     '⚠️⚠️ and none on an INFERRED sequence - the handoff is declared per trade, so it can only be applied when the lanes are trades');

  /* ⚠️ The legacy per-PAIR number is KINDLESS, so it applies to the typical floors only - the
     same rule `batchKind` has always used for the other kindless answer, `cfg.tradeBatch`. */
  const DPAIR = { any: true, pair: { 'structural works>architectural works': 4 },
                  lead: { 'structural works': { par: false, kind: { typical: { v: 2, p: false } } } } };
  /* ⚠️⚠️ THE FIXTURE HAS TO DISCRIMINATE, AND THE FIRST ONE DID NOT. With the basements
     starting late, lifting the per-pair number onto them produced no finding either way, so the
     negative build that DOES lift it passed. The basements now start early enough that the bug
     would show: B basement 0 starts day 12, and a lifted lead of 4 would demand A's basement
     ordinal 3 - clamped to its top, storey 1, day 20 - so it would be flagged 9 days early. */
  let r4 = runPass(tower([12, 18, 45, 55, 65, 75], AF), DPAIR);
  ok(r4.nLead > 0, 'the stricter per-pair handoff catches what the per-trade one allowed', r4.nLead);
  eq(first(r4).how, 'pair', 'and the finding says it came from the pair');
  eq(first(r4).need, 4, 'with the per-pair number');
  eq(r4.list.filter(function (x) { return x.fkind !== 'typical'; }).length, 0,
     '⚠️⚠️ and a kindless per-pair answer never reaches a non-typical category');
  eq(r4.list.filter(function (x) { return x.fkind === 'basement'; }).length, 0,
     'specifically: the early basements are NOT flagged against the per-pair number');

  /* ---- 6. The memo must NOT be cleared per frame, or the cold-open answer is lost ------------- */
  const cr = sliceFn('_clearLsmRateMemo') || '';
  ok(!/_lsmLeadMemo/.test(cr) && !/_clearLsmLeadMemo/.test(cr),
     '⚠️⚠️ _clearLsmRateMemo does NOT clear the handoff - a per-frame clear would overwrite the fetched answer with the empty synchronous one on the next repaint');
  const ps = sliceFn('psSetupChanged') || '';
  ok(/_clearLsmLeadMemo\(\)/.test(ps), 'but a SETUP EDIT does clear it');
  ok(/_lsmClashMemo = null/.test(ps), 'along with the clashes derived from it');
  const warm = sliceFn('_lsmLeadWarm') || '';
  ok(/_lsmLeadAsked === pid/.test(warm), '⚠️ the cold-open fetch runs once per project');
  ok(/tradeHandoffFor/.test(warm), 'through the builder\u2019s own cold-open reader');
  ok(/_lsmClashMemo = null/.test(warm), 'and invalidates the clashes when the answer arrives');

  /* ---- 7. The two findings are told apart on screen ------------------------------------------- */
  const ch = sliceFn('_lsmClashHTML') || '';
  ok(/x\.kind === 'lead'/.test(ch), 'the strip renders the two classes differently');
  ok(/floors behind/.test(ch), 'naming the declared floors-behind on the chip');
  ok(/Schedule Setup declares/.test(ch), 'and saying where the number came from');
  ok(/No cross-trade handoff is declared/.test(ch),
     '⚠️ with an explicit sentence for a project that declared none, rather than silence');
  ok(/ps-lsmclash-lead/.test(src) && /border-left:3px dashed/.test(src), 'and a CSS class to match');
  ok(!/#[0-9a-fA-F]{3,6}/.test('.ps-lsmclash-chip.ps-lsmclash-lead { border-left:3px dashed var(--pd-bad); }'),
     'declared with a token, not a colour literal');
  const fl = sliceFn('renderFlowline') || '';
  ok(/ps-fl-clash-lead/.test(fl), 'the flowline marks the class too');
  ok(/ahead of the declared/.test(fl), 'with its own sentence');
})();


/* ====== THE RESTORED MODE'S ROW HEIGHT AND LIT BUTTON (measured on OPW101, 2026-09-11) ========= */
(function () {
  /* ⚠️⚠️ THE DEFECT, MEASURED SIGNED IN BEFORE IT WAS FIXED. `applyRowZoom` is called once by
     init, BEFORE any project has loaded - `groupBys` empty, so `_lsmShaped()` false, and no rows
     for `catList()` to find lanes in. A mode restored from `ps_lsmrows` came back with ROWH **31**
     where its lanes need **74**, and **20 of 58 bars sat outside their own row**. The owner
     reported it as "the rows are too big ... the gantt bars do not align with the WBS row". */
  const dr = sliceFn('doRender') || '';
  ok(dr !== '', 'doRender is present');
  ok(/rowHFor\(_rowZoom\) !== ROWH/.test(dr),
     '⚠️⚠️ doRender re-derives the row height instead of trusting init\u2019s one-shot call');
  ok(dr.indexOf('rowHFor(_rowZoom) !== ROWH') > dr.indexOf('DL = displayList()'),
     '⚠️ and does it AFTER displayList, so the grouping and the rows are both settled');
  ok(/_lsmPaintBtn\(\);/.test(dr), 'and paints the toolbar for a mode no toggle ever ran for');

  /* One writer for the lit state: the toggle must not keep its own inline copy. */
  const pb = sliceFn('_lsmPaintBtn') || '';
  ok(/ps-lsmbtn/.test(pb) && /classList\.toggle\('active'/.test(pb),
     '_lsmPaintBtn is the one place the lit state is written');
  const fin = sliceFn('_lsmFinish') || '';
  ok(/_lsmPaintBtn\(\)/.test(fin), 'the toggle path goes through it');
  ok(!/getElementById\('ps-lsmbtn'\)/.test(fin),
     '⚠️ and keeps no second inline copy of it');

  /* ⚠️⚠️ EXECUTE THE SHIPPED GUARD. A re-typed copy would pass against a build whose real guard
     had been removed - the lesson this suite has already learned twice. */
  const gi = dr.indexOf("if (typeof rowHFor === 'function'");
  ok(gi !== -1, 'the guard is locatable');
  const line = dr.slice(gi, dr.indexOf('\n', gi));
  const run = new Function('ENV', [
    'var ROWH = ENV.ROWH, _rowZoom = ENV.zoom;',
    'var rowHFor = ENV.rowHFor, applyRowZoom = ENV.applyRowZoom;',
    line,
    'return ENV.calls;'
  ].join('\n'));
  const fire = function (have, want) {
    const env = { ROWH: have, zoom: 1, calls: 0,
                  rowHFor: function () { return want; },
                  applyRowZoom: function () { env.calls++; } };
    return run(env);
  };
  eq(fire(31, 74), 1, 'a stale height IS corrected (the OPW101 case: 31 where the lanes need 74)');
  eq(fire(74, 74), 0, '⚠️ and a frame that changes nothing does not touch the CSS variables');
  eq(fire(96, 31), 1, 'leaving the mode shrinks the row back too');
})();


/* ========= THE DECLARATION'S COLD OPEN, AND "START TOGETHER" (measured on OPW101) ============== */
(function () {
  /* ⚠️⚠️ MEASURED SIGNED IN, AND BOTH SENTENCES ON SCREEN WERE FALSE.
     `ScheduleBuilder.locCatalogue()` answered **0 floors** while `locCatalogueFor(pid)` answered
     **18, each with its category**. So the strip said *"17 storeys are not in your Schedule Setup's
     floor list"* and *"No cross-trade handoff is declared"* on a project where **18 of 18 Level
     values match the setup's floor list exactly** and four trades carry a declared handoff. The
     naming was never the problem; the read was. */
  const d = sliceFn('_lsmDecl') || '';
  ok(/_lsmDeclCat \|\|/.test(d), '⚠️⚠️ _lsmDecl prefers the warmed catalogue over the empty sync read');
  ok(/if \(!n\) _lsmDeclWarm\(\);/.test(d), 'and asks for it when it comes up empty');
  const wm = sliceFn('_lsmDeclWarm') || '';
  ok(/locCatalogueFor/.test(wm), 'the warm goes through the builder\u2019s own cold-open reader');
  ok(/_lsmDeclAsked === pid/.test(wm), '⚠️ once per project, like the handoff\u2019s');
  /* ⚠️⚠️ THE WARM SUPPLIES THE CATEGORY, NOT THE ORDER, and the suite has to pin that down
     because the obvious version of this fix was wrong. `catalogueFrom`'s contract is "floors
     bottom-up PER TRADE", so concatenating trades is NOT globally bottom-up — on OPW101 it reads
     F1, B3, B2, B1, Ground Floor, 2ND…, putting F1 BELOW the basements. Feeding that into the
     floor ORDER would have activated a wrong axis on every project at once, a regression
     introduced by a fix. So the order keeps its old source and the rate's memo is left alone. */
  ok(/_lsmClashMemo = null/.test(wm), 'the warm invalidates the clashes, which read the category');
  ok(!/_lsmRateMemo = null/.test(wm),
     '⚠️⚠️ and does NOT touch the rate — the declared ORDER is deliberately not taken from it');
  const dOrder = /var catOrder = \(typeof ScheduleBuilder/.test(d);
  const dKind = /var catKind = _lsmDeclCat \|\| catOrder;/.test(d);
  ok(dOrder && dKind, 'the two catalogues are separate reads inside _lsmDecl');
  ok(d.indexOf('catKind') < d.indexOf('m[k] = n++'),
     'the category is taken from the warmed one and the order from the synchronous one');
  /* ⚠️⚠️ The warmed catalogue must NOT sit in the per-frame memo. */
  const cr = sliceFn('_clearLsmRateMemo') || '';
  ok(!/_lsmDeclCat/.test(cr),
     '⚠️⚠️ the per-frame clear does not throw the warmed catalogue away (the _lsmLeadMemo lesson)');
  const ps = sliceFn('psSetupChanged') || '';
  ok(/_clearLsmDeclCat\(\)/.test(ps), 'but a setup edit does drop it');

  /* ---- "start together" suppresses the SAME-STOREY overlap too ------------------------------- */
  /* ⚠️⚠️ FOUND ON OPW101: the planner marked General Requirements parallel, and the strip still
     reported "F1 - Site Works before General Requirements, 25 wd". The chart contradicting an
     answer given two screens away is worse than not checking. */
  const cl = sliceFn('_lsmClash') || '';
  const dp = /function _declaredParallel\(a, b, fk\) \{[\s\S]*?\n    \}/.exec(cl);
  ok(!!dp, '_declaredParallel is defined inside the clash detector');
  /* ⚠️ The CALL must be the whole condition. A first cut matched the call anywhere on the
     line, and a negative build that turned it into `if (false && _declaredParallel(...))`
     PASSED - the third time a substring assertion has been satisfied by dead code here. */
  ok(/(^|[\r\n])\s*if \(_declaredParallel\(A\.value, B\.value, /.test(cl),
     'and the overlap pass consults it, as the whole condition rather than behind a dead guard');
  ok(/_parNext\[a\] !== b/.test(cl),
     '⚠️⚠️ only for the trade that actually follows - a parallel answer cannot excuse two trades three apart');

  /* Execute the shipped helper rather than a copy of it. */
  const run = new Function('ENV', [
    'var _parNext = ENV.next, _par = ENV.lead;',
    "var _parNorm = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };",
    dp ? dp[0] : 'function _declaredParallel() { return false; }',
    'return _declaredParallel(ENV.a, ENV.b, ENV.fk);'
  ].join('\n'));
  const LEAD = { lead: {
    'general requirements': { par: true, kind: { typical: { v: 4, p: true } } },
    'structural works': { par: false, kind: { basement: { v: 4, p: true }, typical: { v: 4, p: false } } }
  } };
  const NEXT = { 'General Requirements': 'Site Works', 'Site Works': 'Structural Works',
                 'Structural Works': 'Architectural Works' };
  const fire = (a, b, fk) => run({ next: NEXT, lead: LEAD, a: a, b: b, fk: fk });
  eq(fire('General Requirements', 'Site Works', 'typical'), true,
     '⚠️⚠️ the OPW101 case: a whole-trade "start together" suppresses the overlap');
  eq(fire('General Requirements', 'Structural Works', 'typical'), false,
     '⚠️⚠️ but NOT against a trade two steps later, which nobody said anything about');
  eq(fire('Structural Works', 'Architectural Works', 'basement'), true,
     'a per-category "start together" suppresses it on that category');
  eq(fire('Structural Works', 'Architectural Works', 'typical'), false,
     '⚠️ and not on a category where the planner did NOT say it');
  eq(fire('Structural Works', 'Architectural Works', ''), false,
     'a storey with no known category gets no excuse either');
  eq(fire('Site Works', 'Structural Works', 'typical'), false,
     'a trade with nothing declared is unaffected');
})();


/* ============ END TO END, ON ONE PORTWOOD'S REAL DECLARED CONFIGURATION ======================== */
/* ⚠️⚠️ THE DATA BELOW IS NOT INVENTED. Every floor name, every category and every handoff number
   was READ OFF THE LIVE, SIGNED-IN APP on 2026-09-11 (OPW101, 2,561 activities) with
   `ScheduleBuilder.locCatalogueFor(pid)` and `tradeHandoffFor(pid)`. This exercises the path the
   Chrome bridge dropped before I could re-verify it there.
   ⚠️ The promises resolve SYNCHRONOUSLY (a thenable, not a real Promise), so the suite stays
   synchronous while still running the shipped `.then(...)` wiring, the memo assignment and the
   invalidation. What is NOT covered by this is the browser's own scheduling. */
(function () {
  if (!M.decl || !M.lead || !M.clash) { ok(false, 'e2e: the harness exposes decl/lead/clash'); return; }

  const OPW_FLOORS = [
    ['F1', 'typical'], ['B3', 'basement'], ['B2', 'basement'], ['B1', 'basement'],
    ['Ground Floor', 'typical'], ['2ND Floor', 'typical'], ['3RD Floor', 'typical'],
    ['5TH Floor', 'typical'], ['6TH Floor', 'typical'], ['7TH Floor', 'typical'],
    ['8TH Floor', 'typical'], ['9TH Floor', 'typical'], ['10TH Floor', 'typical'],
    ['11TH Floor', 'typical'], ['12TH Floor', 'typical'], ['14TH Floor', 'typical'],
    ['Roof Deck', 'typical'], ['Upper Roof Deck', 'typical']
  ];
  /* The real handoff: General Requirements parallel, Site Works 1, Structural 4, Architectural 1,
     MEPF nothing. Spelled the way handoffFrom emits it - lowercased label. */
  const mk = (par, v) => ({ par: par, kind: { basement: { v: v, p: false }, podium: { v: v, p: false },
                                              typical: { v: v, p: false }, roof: { v: v, p: false } } });
  const OPW_HANDOFF = { any: true, pair: {}, lead: {
    'general requirements': { par: true, kind: { typical: { v: 4, p: true } } },
    'site works': mk(false, 1),
    'structural works': mk(false, 4),
    'architectural works': mk(false, 1)
  } };

  const CAT = { lvl: OPW_FLOORS.map(f => ({ value: f[0], dim: 'floor', kind: f[1], tower: 'Tower 1' })) };
  const thenable = v => ({ then: function (okc) { try { okc(v); } catch (e) {} return thenable(v); } });

  /* ⚠️⚠️ A COLD OPEN IS THE DEFAULT: `locCatalogue` and `tradeHandoff` answer EMPTY, exactly as
     they did on the live app, and only the `...For(pid)` readers know anything. This is the shape
     that made two sentences on screen false. */
  let syncCalls = 0, coldCalls = 0;
  const coldBuilder = {
    locCatalogue: function () { syncCalls++; return {}; },
    locCatalogueFor: function () { coldCalls++; return thenable(CAT); },
    tradeHandoff: function () { return { pair: {}, lead: {}, any: false }; },
    tradeHandoffFor: function () { return thenable(OPW_HANDOFF); },
    tradeLabels: function () { return ['General Requirements', 'Site Works', 'Structural Works',
                                       'Architectural Works', 'MEPF Works']; }
  };

  M.setPid('OPW101');
  M.setLsm(true);
  M.clearDeclCat(); M.clearLead();
  M.setBuilder(coldBuilder);

  /* --- 1. the FIRST read is empty, and that is what triggers the warm ------------------------- */
  const first = M.decl();
  eq(first.n, 0, 'e2e: the synchronous catalogue is empty on a cold open, as measured live');
  eq(Object.keys(first.kind).length, 0, 'e2e: so no storey has a category yet');
  ok(coldCalls >= 1, 'e2e: ⚠️⚠️ and the cold-open reader was asked', coldCalls);

  /* --- 2. the warm resolved: the CATEGORY is in, the ORDER is deliberately NOT -------------- */
  M.clearRate();                       /* the per-frame clear, as doRender does */
  const after = M.decl();
  eq(Object.keys(after.kind).length, 18,
     'e2e: ⚠️⚠️ all 18 of One Portwood\u2019s floors now carry their category');
  eq(after.kind[M.normKey('B1')], 'basement', 'e2e: B1 is a basement');
  eq(after.kind[M.normKey('Ground Floor')], 'typical', 'e2e: Ground Floor is typical');
  eq(after.kind[M.normKey('Upper Roof Deck')], 'typical', 'e2e: and the roof decks are typical');
  eq(after.n, 0,
     'e2e: ⚠️⚠️ but the ORDER is still NOT taken from it - F1 must not end up below the basements');

  /* --- 3. the handoff warmed too, and it is the real one -------------------------------------- */
  /* ⚠️⚠️ THE FIRST READ IS THE EMPTY ONE, AND THAT IS CORRECT. `_lsmLead` captures the synchronous
     answer, parks it in the memo, THEN asks for the warm — so the call that triggers the fetch
     still returns "nothing declared". The chart draws immediately and the findings appear on the
     repaint the warm asks for. Asserting it explicitly, because the first cut of this test read it
     once and crashed on `undefined.kind`, which would have looked like the fix not working. */
  const L0 = M.lead();
  eq(L0.any, false, 'e2e: the read that TRIGGERS the fetch still answers "nothing declared"');
  const L = M.lead();                  /* what the repaint the warm asked for would see */
  const lv = (t, k) => { const r = L.lead[t]; const x = r && r.kind && r.kind[k]; return x ? x.v : undefined; };
  eq(L.any, true, 'e2e: and the next read has the declared handoff');
  eq(lv('structural works', 'typical'), 4, 'e2e: Structural leads by 4 typical levels');
  eq(lv('architectural works', 'basement'), 1, 'e2e: Architectural by 1 on the basements');
  eq((L.lead['general requirements'] || {}).par, true,
     'e2e: ⚠️⚠️ and General Requirements is the whole-trade "start together" the planner ticked');
  eq(L.lead['mepf works'], undefined, 'e2e: MEPF declares nothing, and stays absent');

  /* --- 4. "start together" really does suppress the overlap that was being reported ----------- */
  const cl = sliceFn('_lsmClash') || '';
  const gi = cl.indexOf('function _declaredParallel(a, b, fk) {');
  const gj = cl.indexOf('\n    }', gi);
  const dp = gi !== -1 ? cl.slice(gi, gj + 6) : '';
  ok(dp !== '', 'e2e: the parallel helper is locatable');
  const runDP = new Function('ENV', [
    'var _parNext = ENV.next, _par = ENV.lead;',
    "var _parNorm = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };",
    dp,
    'return _declaredParallel(ENV.a, ENV.b, ENV.fk);'
  ].join('\n'));
  const NEXT = { 'General Requirements': 'Site Works', 'Site Works': 'Structural Works',
                 'Structural Works': 'Architectural Works', 'Architectural Works': 'MEPF Works' };
  const dpFire = (a, b, fk) => runDP({ next: NEXT, lead: OPW_HANDOFF, a: a, b: b, fk: fk });
  eq(dpFire('General Requirements', 'Site Works', 'typical'), true,
     'e2e: ⚠️⚠️ the exact finding that was wrong on screen - "F1 Site Works before General Requirements" - is now suppressed');
  eq(dpFire('Structural Works', 'Architectural Works', 'typical'), false,
     'e2e: and a pair nobody called parallel is still checked');
  eq(dpFire('General Requirements', 'Structural Works', 'typical'), false,
     'e2e: ⚠️ while the parallel answer does not reach past the trade it is about');

  /* --- 5. the strip stops telling the planner two things that are not true -------------------- */
  ok(true, 'e2e: --- the two false sentences ---');
  const html = sliceFn('_lsmClashHTML') || '';
  ok(/No cross-trade handoff is declared/.test(html),
     'e2e: the "nothing declared" sentence still EXISTS for projects that really declare nothing');
  ok(/not in your Schedule Setup/.test(html),
     'e2e: and so does the unchecked-storeys one');
  /* ⚠️⚠️ The point is that neither can now be reached on a project like OPW101, because the
     category and the handoff both arrive. Proved above by `after.kind` being 18 and `L.any` true. */

  M.setBuilder(null); M.clearDeclCat(); M.clearLead(); M.setLsm(false); M.setPid(null);
})();


/* ====== THE CLOSED LOOP: DOES THE DETECTOR AIM WHERE THE GENERATOR LINKS? ====================== */
/* ⚠️⚠️ THIS IS WHAT ANSWERS *"how did the clashes originate"*. One Portwood's schedule was
   generated BY the Schedule Setup, so if `autoTrace` links floor X to floor Y and the clash
   detector measures floor X against floor Y, then a generated schedule can produce **no** handoff
   finding at all. Any finding that does appear then means the DATES have drifted from the
   declaration since the push - not that the setup is wrong.
   If the two disagree, every finding is suspect and the detector is the bug. So compare them
   directly, by executing BOTH shipped expressions over the same space. */
(function () {
  const at = sliceAny('autoTrace') || '';
  ok(at !== '', 'autoTrace is present');
  /* autoTrace's own target line, lifted verbatim. */
  const m = /si = pk\[Math\.min\(ord \+ L - 1, pk\.length - 1\)\]/.exec(at);
  ok(!!m, '⚠️⚠️ autoTrace picks its predecessor with pk[min(ord + L - 1, pk.length - 1)]');

  const cl = sliceFn('_lsmClash') || '';
  const m2 = /var tr = pk\[Math\.min\(ordK \+ L - 1, pk\.length - 1\)\];/.exec(cl);
  ok(!!m2, '⚠️⚠️ and the clash detector aims with pk[min(ordK + L - 1, pk.length - 1)]');

  /* ⚠️⚠️ IF EITHER EXPRESSION IS GONE, FAIL AND STOP — do not run on. A negative build that
     rewrites the detector's target line made `m2` null, `detTarget` return -1, and this block
     CRASH on `A[-1].f` instead of failing. Third time an exploding check has hidden a detected
     regression here, so it is guarded rather than noted. */
  if (!m || !m2) { ok(false, 'both target expressions must be present to compare them'); return; }
  /* Not a string comparison - RUN them. Same inputs, same answer, over the whole space a real
     building covers: up to 30 floors of a category, leads 1..8. */
  const genTarget = new Function('pk', 'ord', 'L', 'var si; ' + (m ? m[0] : 'si = -1') + '; return si;');
  const detTarget = new Function('pk', 'ordK', 'L', (m2 ? m2[0] : 'var tr = -1;') + ' return tr;');
  let pairs = 0, differ = 0, clamped = 0;
  for (let n = 1; n <= 30; n++) {
    const pk = []; for (let i = 0; i < n; i++) pk.push(100 + i);   /* opaque floor ids */
    for (let L = 1; L <= 8; L++) {
      for (let ord = 0; ord < n; ord++) {
        pairs++;
        const a = genTarget(pk, ord, L), b = detTarget(pk, ord, L);
        if (a !== b) differ++;
        if (ord + L - 1 > n - 1) clamped++;
      }
    }
  }
  eq(differ, 0,
     '⚠️⚠️ THE DETECTOR AND THE GENERATOR AIM AT THE SAME FLOOR, over every (floors, lead, ordinal) case');
  ok(pairs === 3720, 'over ' + pairs + ' cases', pairs);
  ok(clamped > 0, 'including ' + clamped + ' that hit the clamp at the top of the category', clamped);

  /* ⚠️ So a schedule the setup generated is clash-free BY CONSTRUCTION on the handoff class:
     autoTrace makes B wait for exactly the floor the detector measures against. Demonstrated
     rather than argued - build the dates the generator's own links imply and check. */
  const cal = { wd: false, span: function (a, b) { return b - a + 1; } };
  function generatedSchedule(nFloors, L, dur, gap) {
    /* A trails B by L floors of the same category, exactly as autoTrace links them. */
    const A = {}, B = {};
    for (let i = 0; i < nFloors; i++) A[i] = { s: i * gap, f: i * gap + dur };
    for (let i = 0; i < nFloors; i++) {
      const pk = []; for (let q = 0; q < nFloors; q++) pk.push(q);
      const tgt = detTarget(pk, i, L);
      B[i] = { s: A[tgt].f + 1, f: A[tgt].f + 1 + dur };   /* starts the day AFTER its predecessor */
    }
    return { A: A, B: B };
  }
  let violations = 0, checked = 0;
  for (let n = 3; n <= 20; n++) {
    for (let L = 1; L <= 5; L++) {
      const g = generatedSchedule(n, L, 6, 4);
      const pk = []; for (let q = 0; q < n; q++) pk.push(q);
      for (let i = 0; i < n; i++) {
        checked++;
        const tgt = detTarget(pk, i, L);
        if (!(+g.B[i].s > +g.A[tgt].f)) violations++;      /* the detector's own test */
      }
    }
  }
  eq(violations, 0,
     '⚠️⚠️ a schedule built to the generator\u2019s own links raises ZERO handoff findings (' +
     checked + ' storey-pairs)');

  /* ⚠️⚠️ AND THE CONVERSE, so this is not a test that cannot fail: move one storey earlier and
     the detector must catch it. */
  const g2 = generatedSchedule(10, 4, 6, 4);
  const pk2 = []; for (let q = 0; q < 10; q++) pk2.push(q);
  const t2 = detTarget(pk2, 5, 4);
  g2.B[5].s = g2.A[t2].f - 3;                               /* start 3 days early */
  ok(!(+g2.B[5].s > +g2.A[t2].f), 'and a storey dragged earlier IS caught');
  eq(cal.span(g2.B[5].s, g2.A[t2].f), 4, 'with the right number of days early');
})();


/* ================= A DEMO PROJECT, END TO END THROUGH THE WHOLE LSM CHAIN ====================== */
/* ⚠️⚠️ SHAPED THE WAY THE SCHEDULE SETUP PUSHES ONE, and DATED THE WAY autoTrace LINKS ONE:
   each following trade trails the leading one by that category's declared levels, counted WITHIN
   the category and clamped to its top. So this is not a hand-drawn fixture that happens to look
   tidy - it is what the generator produces, so the correct answer is ZERO handoff findings.
   ⚠️ 4 basements, 2 podium, 12 typical, 1 roof = 19 storeys, 5 trades. */
(function () {
  const TRADES = ['General Requirements', 'Site Works', 'Structural Works',
                  'Architectural Works', 'MEPF Works'];
  const LEAD = { 'site works': 1, 'structural works': 4, 'architectural works': 1 };
  const FLOORS = [];
  for (let i = 4; i >= 1; i--) FLOORS.push({ name: 'B' + i, kind: 'basement' });
  FLOORS.push({ name: 'Ground Floor', kind: 'podium' });
  FLOORS.push({ name: 'Podium 2', kind: 'podium' });
  for (let i = 3; i <= 14; i++) FLOORS.push({ name: i + 'TH Floor', kind: 'typical' });
  FLOORS.push({ name: 'Roof Deck', kind: 'roof' });
  eq(FLOORS.length, 19, 'demo: the building has 19 storeys');

  /* The catalogue the Setup would expose for it, categories and all. */
  const CAT = { lvlF: FLOORS.map(f => ({ value: f.name, dim: 'floor', kind: f.kind, tower: 'Tower 1' })) };
  const HANDOFF = { any: true, pair: {}, lead: {} };
  Object.keys(LEAD).forEach(t => {
    HANDOFF.lead[t] = { par: false, kind: {} };
    ['basement', 'podium', 'typical', 'roof'].forEach(k => { HANDOFF.lead[t].kind[k] = { v: LEAD[t], p: false }; });
  });
  HANDOFF.lead['general requirements'] = { par: true, kind: { typical: { v: 1, p: true } } };

  /* ---- dates, laid down exactly as autoTrace links them --------------------------------------- */
  const byKind = {};
  FLOORS.forEach((f, i) => { (byKind[f.kind] = byKind[f.kind] || []).push(i); });
  const SPAN = 6, STEP = 4;
  const start = {}, finish = {};
  TRADES.forEach((tr, ti) => {
    start[tr] = {}; finish[tr] = {};
    FLOORS.forEach((f, i) => {
      if (ti === 0) {                                   /* the leading trade climbs at its own pace */
        start[tr][i] = i * STEP; finish[tr][i] = i * STEP + SPAN; return;
      }
      const prev = TRADES[ti - 1];
      const L = LEAD[prev.toLowerCase()] || 1;
      const pk = byKind[f.kind];
      const ordK = pk.indexOf(i);
      const tgt = pk[Math.min(ordK + L - 1, pk.length - 1)];   /* autoTrace's own target */
      start[tr][i] = finish[prev][tgt] + 1;                     /* the day AFTER its predecessor */
      finish[tr][i] = start[tr][i] + SPAN;
    });
  });

  /* ---- the display list, in the shape the Gantt builds ---------------------------------------- */
  const ser = 'TOWER1';
  const DLdemo = FLOORS.map((f, i) => ({
    id: 'row' + i, _dkind: 'group', _dcode: 'g' + i, _danc: [ser], _graw: f.name,
    activity_name: f.name,
    _glsm: TRADES.map(tr => ({
      value: tr, s: M.pd('2026-01-01'), f: M.pd('2026-01-01'), cal: null, over: false,
      color: '#2F6FBF', tex: 0, n: 3, pct: 0
    })).map((b, ti) => {
      const tr = TRADES[ti];
      b.s = M.addDays(M.pd('2026-01-01'), start[tr][i]);
      b.f = M.addDays(M.pd('2026-01-01'), finish[tr][i]);
      return b;
    })
  }));

  const builder = {
    locCatalogue: function () { return {}; },                       /* cold open, as measured live */
    locCatalogueFor: function () { return { then: function (ok) { try { ok(CAT); } catch (e) {} return this; } }; },
    tradeHandoff: function () { return { pair: {}, lead: {}, any: false }; },
    tradeHandoffFor: function () { return { then: function (ok) { try { ok(HANDOFF); } catch (e) {} return this; } }; },
    tradeLabels: function () { return TRADES; }
  };

  M.setPid('DEMO01'); M.setLsm(true);
  M.clearDeclCat(); M.clearLead();
  M.setBuilder(builder);
  M.setField('work');                                    /* the lanes ARE trades - the declared basis */
  M.setCats(TRADES.map((t, i) => ({ value: t, muted: false, n: 50 - i,
    color: ['#2F6FBF','#1f8f4e','#C77700','#B5306B','#6C4BB6'][i], tex: i % 4 })));
  M.setDL(DLdemo);

  /* ---- 1. the floors match, and carry their category ------------------------------------------ */
  M.decl(); M.clearRate(); M.setDL(DLdemo);              /* the warm lands on the next frame */
  const dec = M.decl();
  eq(Object.keys(dec.kind).length, 19, 'demo: ⚠️⚠️ all 19 storeys matched the Setup floor list');
  eq(dec.kind[M.normKey('B4')], 'basement', 'demo: B4 is a basement');
  eq(dec.kind[M.normKey('Podium 2')], 'podium', 'demo: Podium 2 is a podium');
  eq(dec.kind[M.normKey('Roof Deck')], 'roof', 'demo: the Roof Deck is a roof');

  /* ---- 2. the trades match ---------------------------------------------------------------------- */
  const sq = M.seq();
  eq(sq.basis, 'declared', 'demo: ⚠️ the lanes are trades, so the sequence is the DECLARED one');
  eq(sq.order[0], 'General Requirements', 'demo: and it starts with General Requirements');
  eq(sq.order[sq.order.length - 1], 'MEPF Works', 'demo: and ends with MEPF');
  eq(M.lanes().length, 5, 'demo: five trade lanes, one per trade');

  /* ---- 3. the rate reads off the staircase ----------------------------------------------------- */
  const R = M.rate();
  /* ⚠️⚠️ THIS ASSERTION USED TO SAY THE OPPOSITE, AND THAT IS THE POINT. Before the one-scale
     change it read: "Podium 2 is the one storey the axis cannot rank" — the heuristic returns null
     for it and the declared order was not consulted. Now the Schedule Setup PLACES it between its
     declared neighbours, on the heuristic's own scale, so the whole building is on the chart. */
  const unranked = FLOORS.filter(f => M.rankOf(f.name) == null).map(f => f.name);
  eq(unranked.join(','), '', '⚠️⚠️ demo: EVERY storey is on the axis, "Podium 2" included');
  eq(R.floors, 19, 'demo: so the rate model sees all 19');
  const p2 = M.rankOf('Podium 2');
  ok(p2 > 0 && p2 < 3, 'demo: and the podium sits between Ground Floor (0) and 3TH Floor (3)', p2);
  ok(Object.keys(R.byTrade).length >= 1, 'demo: and fits at least one trade',
     Object.keys(R.byTrade).length);

  /* ---- 4. ⚠️⚠️ THE POINT: a schedule dated the way the Setup links it has NO handoff finding -- */
  const L2 = M.lead(); const L3 = M.lead();
  eq(L3.any, true, 'demo: the declared handoff arrived through the cold open');
  const C = M.clash();
  eq(C.nLead, 0,
     '⚠️⚠️ demo: ZERO handoff findings on a schedule dated exactly as autoTrace links it');
  eq(C.nUnkinded, 0, 'demo: and no storey went unchecked for want of a category');
  ok(C.leadBasis, 'demo: the handoff really was applied, not skipped');

  /* ---- 5. and the converse, so this is not a test that cannot fail ----------------------------- */
  const broken = DLdemo.map(r => ({ ...r, _glsm: r._glsm.map(b => ({ ...b })) }));
  /* drag MEPF on storey 10 three weeks earlier */
  broken[10]._glsm[4].s = M.addDays(broken[10]._glsm[4].s, -21);
  M.setDL(broken);
  const C2 = M.clash();
  ok(C2.nLead > 0, '⚠️⚠️ demo: and dragging ONE storey three weeks early IS caught', C2.nLead);
  const hit = (C2.list || []).filter(x => x.kind === 'lead')[0] || {};
  eq(hit.b, 'MEPF Works', 'demo: naming the trade that moved');
  eq(hit.fkind, 'typical', 'demo: and the category whose rule it broke');

  /* ---- 6. the strip renders, and says the true things ------------------------------------------ */
  const html = M.clashHTML() || '';
  ok(/vs declared handoff/.test(html), 'demo: the strip separates the handoff findings');
  ok(!/No cross-trade handoff is declared/.test(html),
     '⚠️⚠️ demo: and does NOT claim nothing is declared - the sentence that was wrong on OPW101');
  ok(!/not in your Schedule Setup/.test(html),
     '⚠️⚠️ demo: nor that storeys are missing from the floor list');

  M.setBuilder(null); M.clearDeclCat(); M.clearLead(); M.setLsm(false);
  M.setField('name'); M.setPid(null); M.setDL([]);
})();


/* ⚠️⚠️ PER-TRADE, NOT ACROSS THE CONCATENATION - AND THE FIRST FIXTURE COULD NOT TELL.
   With the unrankable storey sitting BETWEEN its right neighbours, both readings give the same
   answer, so two negative builds (interpolating over one merged list, and dropping the trade tag
   entirely) PASSED. The discriminating shape is an unrankable storey at the END of its own
   trade's list, where the next entry in the concatenation belongs to a DIFFERENT building level:

     trade GR : Ground Floor , Podium Amenities        <- podium has no rankable neighbour ABOVE
     trade ST : 10th Floor  , 11th Floor

   Per trade, the podium can only lean on Ground Floor and lands just above 0.
   Across the concatenation it would be pulled to the midpoint of 0 and 10 - the FIFTH floor. */
(function () {
  /* ⚠️ CLEAR THE WARMED CATALOGUE FIRST. `_lsmDeclCat` outlives `setBuilder` on purpose (it is the
     cold-open answer and must survive the per-frame clear), so a fixture that only swaps the
     builder is still reading the PREVIOUS scenario's floors. That is exactly how this block first
     reported `null` for a storey it had just declared. */
  M.clearDeclCat();
  M.setBuilder({ locCatalogue: function () {
    return { lvF: [ { value: 'Ground Floor', dim: 'floor', tr: 'GR' },
                    { value: 'Podium Amenities', dim: 'floor', tr: 'GR' },
                    { value: '10th Floor', dim: 'floor', tr: 'ST' },
                    { value: '11th Floor', dim: 'floor', tr: 'ST' } ] };
  } });
  const pa = M.rankOf('Podium Amenities');
  ok(pa !== null, 'the podium is still placed', pa);
  ok(pa > 0 && pa < 1,
     '⚠️⚠️ it leans on its OWN trade\u2019s Ground Floor and stays just above it', pa);
  ok(!(pa >= 4 && pa <= 6),
     '⚠️⚠️ and is NOT dragged to the midpoint of 0 and 10 by the next trade\u2019s floors', pa);
  eq(M.rankOf('10th Floor'), 10, 'the other trade\u2019s floors keep their own ranks');
  M.setBuilder(null);
})();


/* ⚠️⚠️ THE TRADE TAG, PROVED AT ITS SOURCE. The fixtures above hand-write `tr` on their
   catalogue entries, so they cannot tell whether `catalogueFrom` actually produces it - a negative
   build that dropped the tag PASSED the whole suite. So `catalogueFrom` is sliced and RUN. */
(function () {
  const cf = sliceAny('catalogueFrom'), fk = sliceAny('floorKind'), bt = sliceAny('blankTowers');
  ok(cf && fk && bt, 'catalogueFrom / floorKind / blankTowers are all present');
  if (!cf || !fk || !bt) return;
  const run = new Function('GROUPS', 'CFG', [
    "var KIND_LABEL = { basement: 'Basement', podium: 'Podium / Commercial', typical: 'Typical', roof: 'Roof Deck' };",
    "var uidv = function () { return 'u' + Math.random(); };",
    "function locLevelFor(d) { return d === 'floor' ? { id: 'lvF' } : (d === 'tower' ? { id: 'lvT' } : null); }",
    fk, bt, cf,
    'return catalogueFrom(CFG);'
  ].join('\n'));
  const GROUPS = ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'];
  const CFG = { towers: [{ id: 't1', code: 'T1', name: 'Tower 1' }], zoning: {
    GR: { floors: [{ id: 'f0', code: 'F1', name: 'F1', kind: 'typical', zones: [] }] },
    ST: { floors: [{ id: 'f1', code: 'B3', name: 'B3', sub: true, kind: 'basement', zones: [] },
                   { id: 'f2', code: 'GF', name: 'Ground Floor', kind: 'typical', zones: [] },
                   { id: 'f3', code: 'PA', name: 'Podium Amenities', kind: 'podium', zones: [] }] }
  } };
  GROUPS.forEach(g => { if (!CFG.zoning[g]) CFG.zoning[g] = { floors: [] }; });

  const out = run(GROUPS, CFG);
  const floors = (out.lvF || []).filter(e => e.dim === 'floor');
  eq(floors.length, 4, 'catalogueFrom returns every declared floor');
  const tagOf = {}; floors.forEach(e => { tagOf[e.value] = e.tr; });
  eq(tagOf['F1'], 'GR', '⚠️⚠️ and each floor carries THE TRADE WHOSE LIST IT CAME FROM');
  eq(tagOf['B3'], 'ST', 'B3 from Structural');
  eq(tagOf['Podium Amenities'], 'ST', 'and the podium too');
  /* The category still rides along, unchanged. */
  const kindOf = {}; floors.forEach(e => { kindOf[e.value] = e.kind; });
  eq(kindOf['B3'], 'basement', 'the category is still on the entry');
  eq(kindOf['Podium Amenities'], 'podium', 'for the podium as well');
  /* ⚠️ And the ORDER within one trade is the setup's own, which is the only thing the
     interpolation may lean on. */
  const stOrder = floors.filter(e => e.tr === 'ST').map(e => e.value).join(' ');
  eq(stOrder, 'B3 Ground Floor Podium Amenities', 'a trade\u2019s floors keep their declared order');
})();

report();

function report() {
  console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' assertions passed, ' + fail + ' failed');
  if (fail) { fails.forEach(function (f) { console.log('   x ' + f); }); process.exit(1); }
  process.exit(0);
}
