/* Schedule Setup ▸ Activities — SAP L1/L2/L3 suite (owner's 2026-09-18 items 2–5).
   Slices the SHIPPED reference tables, the merge model and the pane renderer out of
   modules/project-schedule/index.html BY NAME and EXECUTES them.

   Usage:   node modules/project-schedule/test-sap.js modules/project-schedule/index.html
   Contrast (must FAIL — the base has no SAP_L3 at all):
     git show f1330fc:modules/project-schedule/index.html > /tmp/base.html
     node modules/project-schedule/test-sap.js /tmp/base.html --base

   ⚠️⚠️ PIN THE BASE TO A SHA, NEVER TO HEAD — `git show HEAD:` becomes self-comparison the moment
   you commit, and this repo has been caught that way twice.
*/
'use strict';
const fs = require('fs');
const FILE = process.argv[2] || 'modules/project-schedule/index.html';
const IS_BASE = process.argv.indexOf('--base') !== -1;
const src = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0; const fails = [];
function ok(c, label, got) { if (c) pass++; else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got).slice(0, 240) + ']')); } }
function eq(a, b, label) { ok(a === b, label + ' (expected ' + JSON.stringify(b) + ')', a); }

/* ---- slicer (shape copied from test-lsm.js: strings, comments AND regex literals) ---------- */
function sliceFn(name, indent) {
  const needle = '\n' + ' '.repeat(indent) + 'function ' + name + '(';
  const i = src.indexOf(needle); if (i === -1) return null;
  const start = i + 1;
  let j = src.indexOf('{', i), depth = 0, inStr = null, inCom = null, inRe = false, prev = '';
  for (; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (inCom === 'line') { if (c === '\n') inCom = null; continue; }
    if (inCom === 'block') { if (c === '*' && n === '/') { inCom = null; j++; } continue; }
    if (inRe) {
      if (c === '\\') { j++; continue; }
      if (c === '[') { while (j < src.length && src[j] !== ']') { if (src[j] === '\\') j++; j++; } continue; }
      if (c === '/') { inRe = false; prev = '/'; }
      continue;
    }
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) { inStr = null; prev = 'x'; } continue; }
    if (c === '/' && n === '/') { inCom = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inCom = 'block'; j++; continue; }
    if (c === '/') { if (prev === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) !== -1) { inRe = true; continue; } prev = '/'; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') { depth++; prev = '{'; continue; }
    if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); prev = '}'; continue; }
    if (!/\s/.test(c)) prev = c;
  }
  return null;
}
function sliceAny(n) { for (const d of [2, 4, 6]) { const s = sliceFn(n, d); if (s) return s; } return null; }
/* A top-level `var NAME = <literal>;` — the reference tables. Brace/bracket matched. */
function sliceVar(name) {
  const re = new RegExp('\\n\\s*var ' + name + ' = ([\\[{])');
  const m = re.exec(src); if (!m) return null;
  let j = src.indexOf(m[1], m.index), depth = 0, inStr = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (!depth) return src.slice(src.indexOf(m[1], m.index), j + 1); }
  }
  return null;
}

const SAP_L1_SRC = sliceVar('SAP_L1'), SAP_L3_SRC = sliceVar('SAP_L3'), CCDB_SRC = sliceVar('CLASS_CODE_DB');
if (IS_BASE) {
  /* ⚠️ The contrast is a GATE, not a pass. The base predates the reference tables entirely, so the
     only honest thing it can assert is that they are genuinely absent — if they were present the
     base has stopped being a contrast and every comparison below is self-comparison. */
  ok(!SAP_L3_SRC, 'BASE: SAP_L3 does not exist yet');
  ok(!SAP_L1_SRC, 'BASE: SAP_L1 does not exist yet');
  ok(!/data-sapexp/.test(src), 'BASE: no L3 expander in the pane');
  ok(!/data-sapl1/.test(src), 'BASE: no draggable L1 heading');
  /* ⚠️ THE PAYLOAD KEY, not a bare `class_codes` — that string is also the name of the Finance
     chart TABLE this module reads, so the loose form failed the gate against a base that genuinely
     has no such column. A gate that fails for the wrong reason is as useless as one that passes. */
  ok(!/class_codes:/.test(src), 'BASE: the push writes no class_codes set');
  ok(!/_ccsOf/.test(src), 'BASE: …and the function that builds it does not exist');
  console.log((fail ? 'BASE GATE FAILED' : 'BASE GATE OK') + ': ' + pass + ' passed, ' + fail + ' failed');
  fails.forEach(f => console.log('   x ' + f));
  process.exit(fail ? 1 : 0);
}
if (!SAP_L1_SRC || !SAP_L3_SRC || !CCDB_SRC) { console.log('FATAL: could not slice the reference tables from ' + FILE); process.exit(1); }

/* ---- fake globals the sliced functions close over ------------------------------------------- */
const GROUPS = ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'];
const GLABEL = { GR: 'General Requirements', SW: 'Site Works', ST: 'Structural', AR: 'Architectural', MEPF: 'MEPF', SD: 'Site Development', ALLIED: 'Allied Services', OT: 'Others' };
const WANT = ['actIsMerged', 'actCodes', 'normKids', 'sapKids', 'actL2Codes', 'sapMergeKids', 'mergeActs', 'sortActivities', 'actSelActs', 'actSelTrade'];
const fnSrc = {};
for (const n of WANT) { const s = sliceAny(n); if (!s) { console.log('FATAL: could not slice ' + n); process.exit(1); } fnSrc[n] = s; }

const env = { toasts: [] };
/* ⚠️⚠️ `cfg`, `actSel` and `actExp` ARE DECLARED INSIDE THE SANDBOX, NOT PASSED IN AS PARAMETERS,
   and that is not tidiness — the first cut passed them and the suite crashed. `mergeActs` ends with
   `actSel = []`, an ASSIGNMENT: against a parameter it rebinds the local and the harness is left
   holding the old array, so every later `setSel` wrote to something the module no longer read and a
   correct merge reported itself as refused. A stub that cannot see a reassignment measures the
   stub. Accessors are exported instead so the tests drive the real bindings. */
const boot = 'var cfg={activities:[]},actSel=[],actExp={};'
  + 'var SAP_L1=' + SAP_L1_SRC + ';var SAP_L3=' + SAP_L3_SRC + ';var CLASS_CODE_DB=' + CCDB_SRC + ';'
  + 'var SAP_L1_OF=(function(){var m={};SAP_L1.forEach(function(g,i){(g[2]||[]).forEach(function(c){m[c]={i:i,name:g[0],trade:g[1]};});});return m;})();'
  + 'var CC_BY_CODE=(function(){var m={};CLASS_CODE_DB.forEach(function(r){m[r[0]]=r;});return m;})();'
  + WANT.map(n => fnSrc[n]).join('\n')
  + '\nreturn {SAP_L1:SAP_L1,SAP_L3:SAP_L3,CLASS_CODE_DB:CLASS_CODE_DB,SAP_L1_OF:SAP_L1_OF,CC_BY_CODE:CC_BY_CODE,'
  + 'setSel:function(a){cfg.activities=a.slice();actSel=a.map(function(x){return x.id;});},'
  + 'acts:function(){return cfg.activities;},sel:function(){return actSel;},'
  + WANT.map(n => n + ':' + n).join(',') + '};';
const M = new Function('GROUPS', 'GLABEL', 'UI', 'markDirty', 'render', 'uidv',
  '"use strict";' + boot)(
  GROUPS, GLABEL, { toast(m, k) { env.toasts.push({ m, k }); } },
  function () {}, function () {}, (() => { let n = 0; return () => 'u' + (++n); })());
console.log('sliced: ' + WANT.join(', ') + ' + SAP_L1/SAP_L3/CLASS_CODE_DB');

/* ================================ 1 · the reference tables ================================== */
const L1 = M.SAP_L1, L3 = M.SAP_L3, DB = M.CLASS_CODE_DB;
eq(L1.length, 39, '1.1 39 level-1 groups');
eq(Object.keys(L3).length, 190, '1.2 190 level-2 groups carry level-3 items');
const l3all = [].concat(...Object.keys(L3).map(k => L3[k].map(x => x[0])));
eq(l3all.length, 447, '1.3 447 level-3 items');
eq(new Set(l3all).size, 447, '1.4 …and every one is distinct');
/* ⚠️⚠️ THE PADDING ASSERTION, and it is the one that matters most: the workbook ships 43 L2 and
   129 L3 codes DE-ZEROED, and `docs/boq-and-pmi.md` forbids that transformation outright because
   the de-zeroed space is not unique ('015051' collides with '15051'). */
ok(l3all.every(c => c.length === 5), '1.5 every level-3 code is five characters — none de-zeroed',
  l3all.filter(c => c.length !== 5).slice(0, 8));
ok(Object.keys(L3).every(c => c.length === 5), '1.6 every level-2 key is five characters');
const dbCodes = new Set(DB.map(r => r[0]));
ok(Object.keys(L3).every(c => dbCodes.has(c)), '1.7 every SAP_L3 key is a code CLASS_CODE_DB holds');
eq(Object.keys(L3).filter(c => !dbCodes.has(c)).length, 0, '1.8 …and none of the seven retired LD sub-works came back');
['39100', '39150', '39200', '39250', '39300', '39350', '39400'].forEach(c => {
  ok(!L3[c] && !dbCodes.has(c), '1.9 retired ' + c + ' is absent from both tables');
});
ok(!l3all.some(c => dbCodes.has(c)), '1.10 no level-3 code collides with a level-2 group code');
/* Every L1 names exactly one trade, and every L2 it lists is a code the chart holds. */
const l1trades = {};
L1.forEach(g => { ok(GROUPS.indexOf(g[1]) >= 0, '1.11 L1 "' + g[0] + '" names a real trade', g[1]); l1trades[g[1]] = 1; });
ok(L1.every(g => g[2].every(c => dbCodes.has(c))), '1.12 every L1 lists only codes the chart holds');
eq(L1.reduce((n, g) => n + g[2].length, 0), 190, '1.13 the L1 lists cover all 190 groups');
eq(new Set([].concat(...L1.map(g => g[2]))).size, 190, '1.14 …with no group claimed by two L1s');
/* ⚠️ The 18 single-L2 groups are the whole reason the pane suppresses the heading. */
eq(L1.filter(g => g[2].length > 1).length, 21, '1.15 21 L1 groups hold more than one L2');
eq(L1.filter(g => g[2].length === 1).length, 18, '1.16 …and 18 hold exactly one (no heading drawn)');
/* The chart's own two deliberate name disagreements must NOT have been overwritten from the file. */
eq(M.CC_BY_CODE['25200'][1], 'Fresh Air Ducting Works', '1.17 25200 keeps this file’s name, not the chart’s copy-down error');
eq(M.CC_BY_CODE['25550'][1], 'Kitchen Exhaust Ducting Works', '1.18 25550 likewise');
ok(M.SAP_L1_OF['01050'] && M.SAP_L1_OF['01050'].name === 'General Requirement', '1.19 the L2→L1 index resolves');
eq(Object.keys(M.SAP_L1_OF).length, 190, '1.20 …for all 190 groups');

/* ================================ 2 · sapKids / sapMergeKids ================================ */
eq(M.sapKids('01050').length, 2, '2.1 01050 has two level-3 items');
eq(M.sapKids('01050')[0][1], 'Mobilization', '2.2 …named from the workbook');
eq(M.sapKids('ZZZZZ'), null, '2.3 an unknown code has no children');
eq(M.sapKids(''), null, '2.4 a blank code has no children');
eq(M.sapKids('01051'), null, '2.5 a LEVEL-3 code has no children of its own (+ From BOQ works at L3)');
const km = M.sapMergeKids('01050', 'GR');
eq(km.length, 2, '2.6 sapMergeKids returns one record per level-3 item');
eq(km[0].code, '01051', '2.7 …carrying the item code');
eq(km[0].group, 'GR', '2.8 …and the group’s trade');
ok(!km.some(k => k.code === '01050'), '2.9 ⚠ the group’s OWN code is never among its kids (actCodes prepends it)');
eq(M.sapMergeKids('ZZZZZ', 'GR'), null, '2.10 nothing to merge for an unknown code');

/* ================================ 3 · an L2 arrival ========================================= */
const a2 = { id: 'x1', code: '01050', name: 'Mobilization / Demobilization', group: 'GR' };
a2.kids = M.sapMergeKids(a2.code, a2.group);
ok(M.actIsMerged(a2), '3.1 an SAP group arrives as a merged activity');
eq(M.actCodes(a2).join(','), '01050,01051,01052', '3.2 …carrying its own code first, then its items');
eq(M.actCodes(a2).length, 3, '3.3 …three codes where the scalar carried one');
eq(M.actL2Codes(a2).join(','), '01050', '3.4 the L2-level codes it covers is just the group');

/* ================================ 4 · merging, and the union fix ============================ */
const setSel = M.setSel;
function mk(id, code, name, group) { const a = { id, code, name, group, durInt: 2, durExt: 3 }; const k = M.sapMergeKids(code, group); if (k) a.kids = k; return a; }
{
  const g1 = mk('m1', '01050', 'Mobilization / Demobilization', 'GR');
  const g2 = mk('m2', '01100', 'Temp. Facil.', 'GR');
  setSel([g1, g2]);
  env.toasts.length = 0;
  ok(M.mergeActs('General Requirement'), '4.1 two SAP groups in one trade merge');
  const merged = M.acts()[0];
  eq(M.acts().length, 1, '4.2 …replaced by one row');
  /* ⚠️⚠️ THE ASSERTION THAT CATCHES THE OLD FLATTEN. `mergeActs` used to take a merged row's KIDS
     and drop its own code — correct while a merged row's code was always kids[0], and silently
     lossy the moment an SAP group arrived with a code that is not among its children. */
  ok(M.actCodes(merged).indexOf('01050') >= 0, '4.3 ⚠ the first GROUP code survives the merge');
  ok(M.actCodes(merged).indexOf('01100') >= 0, '4.4 ⚠ the second GROUP code survives too');
  eq(M.actCodes(merged).length, 9, '4.5 2 groups + 7 items = 9 distinct codes', M.actCodes(merged));
  eq(M.actL2Codes(merged).join(','), '01050,01100', '4.6 it covers both groups at L2');
  eq(merged.durInt, 4, '4.7 durations are summed');
  eq(merged.group, 'GR', '4.8 …and it sits in the one trade');
}
{
  /* ⚠️ Cross-trade: refused, and the refusal NAMES the trades — the owner's item 4. */
  const a = mk('c1', '01050', 'Mobilization', 'GR'), b = mk('c2', '03050', 'Rebar', 'ST');
  setSel([a, b]);
  env.toasts.length = 0;
  ok(!M.mergeActs('nope'), '4.9 a cross-trade merge is refused');
  eq(M.acts().length, 2, '4.10 …and nothing is changed');
  eq(env.toasts.length, 1, '4.11 …with exactly one notification');
  eq(env.toasts[0].k, 'error', '4.12 ⚠ reported as an ERROR, not a warn — nothing happened');
  ok(/General Requirements/.test(env.toasts[0].m) && /Structural/.test(env.toasts[0].m),
    '4.13 ⚠ the message NAMES both trades, which is what makes it actionable', env.toasts[0].m);
  ok(/Cannot merge/.test(env.toasts[0].m), '4.14 …and says plainly that it did not happen');
}
{
  /* Two plain rows with no SAP children — the pre-existing case, unchanged. */
  const a = { id: 'p1', code: 'ZZZ01', name: 'One', group: 'AR', durInt: 1, durExt: 1 };
  const b = { id: 'p2', code: 'ZZZ02', name: 'Two', group: 'AR', durInt: 1, durExt: 1 };
  setSel([a, b]);
  ok(M.mergeActs('Both'), '4.15 two plain rows still merge');
  eq(M.actCodes(M.acts()[0]).join(','), 'ZZZ01,ZZZ02', '4.16 …carrying exactly their two codes');
  eq(M.actL2Codes(M.acts()[0]).length, 0, '4.17 …and covering no L2 group (so → splits, as before)');
}
{
  /* Custom rows carry no code at all: blanks must NOT be deduped into one. */
  const a = { id: 'q1', code: '', name: 'Bespoke A', group: 'AR' };
  const b = { id: 'q2', code: '', name: 'Bespoke B', group: 'AR' };
  setSel([a, b]);
  ok(M.mergeActs('Both bespoke'), '4.18 two custom rows merge');
  eq(M.acts()[0].kids.length, 2, '4.19 ⚠ two blank-code kids stay two, not deduped to one');
}

/* ================================ 5 · the push payload ====================================== */
const ccsSrc = sliceAny('_ccsOf');
ok(!!ccsSrc, '5.1 _ccsOf exists in the push');
if (ccsSrc) {
  const _ccsOf = new Function('actCodes', '"use strict";' + ccsSrc + ';return _ccsOf;')(M.actCodes);
  eq(_ccsOf({ act: { code: 'ZZZ01' } }), null, '5.2 ⚠ a single-code activity writes NULL, not a 1-element array');
  const g = mk('s1', '01050', 'Mob', 'GR');
  const got = _ccsOf({ act: g });
  eq(got.join(','), '01050,01051,01052', '5.3 a merged activity writes every code it covers');
  eq(got[0], g.code, '5.4 ⚠ element 0 equals the scalar class_code every existing reader still uses');
  eq(_ccsOf({}), null, '5.5 a row with no activity writes nothing');
}
/* The payload line itself, and the degrade. */
ok(/class_codes:\s*_ccsOf\(r\)/.test(src), '5.6 taskPayload writes class_codes');
ok(/class_code:\s*\(r\.act && r\.act\.code\)/.test(src), '5.7 ⚠ …and class_code is UNCHANGED beside it');
ok(/function _dropCcSet\(\)/.test(src), '5.8 a missing column degrades rather than failing the push');
ok(/!ccSetDropped && \/class_codes\//.test(src), '5.9 …on the plural spelling only');
ok(/2026-09-18-schedule-class-codes\.sql/.test(src), '5.10 …and the summary names the migration to run');

/* ================================ 6 · the pane markup ======================================= */
ok(/data-sapexp/.test(src), '6.1 the pane emits a per-L2 expander');
ok(/data-sapl1/.test(src), '6.2 …and a draggable L1 heading');
ok(/holdExp\[a\.code\]/.test(src), '6.3 the expander state is keyed on the L2 code');
ok(/holdQ = ''; holdCol = \{\}; holdExp = \{\};/.test(src), '6.4 ⚠ it is cleared on a project switch, like the other two');
ok(/\.sbld-hold-row > \.sbld-hold-item/.test(src), '6.5 ⚠ the direct-child rule was retargeted to the new wrapper');
/* ⚠️⚠️ COMMENTS STRIPPED FIRST. This assertion failed on its first run against CORRECT code: the
   rule was retargeted, and the comment recording that quotes the old selector verbatim — so the
   checker was measuring its own explanation. The commit that removes a thing is exactly the commit
   that describes it; this repo has now been caught by that four times. */
const srcNoCom = src.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/\.sbld-hold-grp > \.sbld-hold-item/.test(srcNoCom), '6.6 …and the old one that would match nothing is gone');
ok(/\.sbld-hold-grp > \.sbld-hold-item/.test(src), '6.7 ⚠ …while the note recording the retarget survives');

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' assertions passed, ' + fail + ' failed');
fails.forEach(f => console.log('   x ' + f));
process.exit(fail ? 1 : 0);
