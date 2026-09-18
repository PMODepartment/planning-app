/* ZONE SCOPING — the step split out of Activity sequence on 2026-09-18, executed.
 *
 *   node modules/project-schedule/test-zonescope.js [contrast-base.html]
 *
 * Owner's three items, and what each one costs to get wrong:
 *   1. "name the title of the step as Activity sequence" — the title is also the LOOKUP KEY for
 *      SB_MANUAL, both alias tables and every `_stepNo(...)` cross-reference, so a rename that
 *      misses one prints a BLANK where a step number belongs and reads as a broken app.
 *   3. "separate Scope per zone as a separate Step 9 before Generate … group these also per floor,
 *      per zone, and per unit" — the rail's own shape, and the table's.
 *
 * ⚠️⚠️ EVERY FUNCTION UNDER TEST IS SLICED OUT OF THE SHIPPED index.html BY NAME AND RUN, through
 *    the repo's own `test-slice.js` (comment-aware, and it verifies each slice parses). Nothing
 *    here re-implements the rule under test.
 * ⚠️ Pass a pinned checkout as argv[2] to run the contrast. It is NOT defaulted to HEAD: HEAD
 *    becomes self-comparison the moment this change commits, which this repo has been caught by.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { makeSlicer } = require('./test-slice.js');

const PAGE = process.argv[2] || path.join(__dirname, 'index.html');
const src = fs.readFileSync(PAGE, 'utf8');
const { sliceFn, sliceVarObj } = makeSlicer(src);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  x ' + m); } };
const eq = (a, b, m) => ok(a === b, m + ' — got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));

function grab(re, what) { const m = src.match(re); if (!m) throw new Error('GRAB FAILED: ' + what); return m[0]; }

/* ============================================================================================
   1 · THE RAIL, AND EVERY TITLE THAT STILL HAS TO RESOLVE TO A NUMBER
   ========================================================================================== */
const stepsNewSrc = grab(/var STEPS_NEW = \[[\s\S]*?\n    \];/, 'STEPS_NEW');
const railNew = ['Start'].concat(
  [...stepsNewSrc.matchAll(/\{ t: '((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")));

const aliasSrc = sliceVarObj('STEP_ALIAS');
const ALIAS = new Function(aliasSrc + '; return STEP_ALIAS;')();

function stepNo(t) {
  let i = railNew.indexOf(t);
  if (i < 0 && ALIAS[t]) i = railNew.indexOf(ALIAS[t]);
  return i < 0 ? '' : i + 1;
}

console.log('rail: ' + railNew.map((t, i) => (i + 1) + ' ' + t).join('  →  '));
eq(railNew.length, 10, 'the build rail is Start + nine steps');
eq(stepNo('Activity sequence'), 8, 'Activity sequence is step 8');
eq(stepNo('Zone scoping'), 9, 'Zone scoping is step 9 — the owner asked for "a separate Step 9"');
eq(stepNo('Generate'), 10, 'Generate follows it');
eq(railNew[railNew.indexOf('Zone scoping') + 1], 'Generate', 'Zone scoping is the step BEFORE Generate');
ok(railNew.indexOf('Activity Sequence') < 0, 'the capital-S title is gone from the rail');
ok(railNew.indexOf('Scope per zone') < 0, 'and so is Scope per zone');

/* ⚠️⚠️ A RETIRED TITLE MUST STILL RESOLVE. `_stepNo` answers the EMPTY STRING for a name it
   cannot find, and a blank where a step number belongs reads as a broken cross-reference, not as
   a missing feature. Both old spellings are aliased. */
eq(stepNo('Activity Sequence'), 8, 'the retired capital-S title still resolves');
eq(stepNo('Trade sequence'), 8, 'the retired view name still resolves');
eq(stepNo('Scope per zone'), 9, 'the retired view name resolves to its OWN step now, not to 8');

/* Every `_stepNo('X')` written anywhere in the module resolves on one of the two rails. */
const stepsImpSrc = grab(/var STEPS_IMP = \[[\s\S]*?\n    \];/, 'STEPS_IMP');
const railImp = ['Start'].concat(
  [...stepsImpSrc.matchAll(/\{ t: '((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")));
const blanks = [...new Set([...src.matchAll(/_stepNo\('([^']+)'\)/g)].map(m => m[1]))]
  .filter(t => !railNew.includes(t) && !railImp.includes(t) &&
               !railNew.includes(ALIAS[t]) && !railImp.includes(ALIAS[t]));
ok(blanks.length === 0, 'every _stepNo call site resolves on a rail: ' + JSON.stringify(blanks));

/* SB_MANUAL is keyed by step TITLE — `sbManualFor` reads STEPS[i].t — so a page left under the
   old key silently falls through to the "No manual page for this step yet." stub. */
const manualSrc = grab(/var SB_MANUAL = \{[\s\S]*?\n    \};/, 'SB_MANUAL');
const manKeys = [...manualSrc.matchAll(/^      '([^']+)':/gm)].map(m => m[1]);
ok(railNew.every(t => manKeys.includes(t)),
   'every rail title has a manual page: ' + JSON.stringify(railNew.filter(t => !manKeys.includes(t))));
ok(manKeys.includes('Zone scoping'), 'Zone scoping has one of its own');
ok(!manKeys.includes('Activity Sequence'), 'and the old key is gone rather than shadowing it');

/* `gotoStep` reads its OWN private alias map and never consults STEP_ALIAS — two tables that both
   have to be updated on any rename. Every target must be a real step, or an external deep link
   lands nowhere and fails silently. */
const alSrc = grab(/var _al = \{[\s\S]*?\};/, "gotoStep's _al");
const alTargets = [...new Set([...alSrc.matchAll(/st:\s*'([^']+)'/g)].map(m => m[1]))];
const alBad = alTargets.filter(t => !railNew.includes(t) && !railImp.includes(t));
ok(alBad.length === 0, "every gotoStep alias points at a real step: " + JSON.stringify(alBad));
ok(/'Scope per zone': \{ st: 'Zone scoping' \}/.test(alSrc), 'the deep link lands on Zone scoping');
ok(!/'Activity [Ss]equence'[^}]*tab:/.test(alSrc),
   'no alias still asks for a TAB on a step that has none — setStepTabQuiet would no-op silently');

/* ============================================================================================
   2 · THE TAB STRIP, AND THE FOOTER WALK
   ========================================================================================== */
const tabsSrc = sliceVarObj('STEP_TABS');
const TABS = new Function(tabsSrc + '; return STEP_TABS;')();
/* ⚠️⚠️ ONE VIEW IS NOT A TAB STRIP. This file's own rule: a strip of one button "is a control that
   cannot do anything". With Scope per zone gone, Activity sequence must be ABSENT from STEP_TABS
   rather than present with a single entry — which is also what removes the doubled heading the
   owner asked about ("7 · Activity Sequence — Trade sequence"). */
eq(Object.keys(TABS).length, 1, 'exactly one step still has tabs');
ok(TABS['Location Sequence'] && TABS['Location Sequence'].length === 2, 'and it is Location Sequence, with two views');
ok(!TABS['Activity sequence'] && !TABS['Activity Sequence'], 'Activity sequence carries no tab strip');
ok(!TABS['Zone scoping'], 'nor does Zone scoping');
ok(/function stActSeq\(host\) \{ stTradeSeq\(host\); \}/.test(src),
   'stActSeq renders its one view directly rather than through the pill shell');
eq((src.match(/stPillStep\(host, '/g) || []).length, 1, 'stPillStep has exactly one caller left');

/* The walk itself, driven — the expressions are lifted out of render() verbatim. `_stepReady` and
   `_stepNo` are SLICED, never stubbed: `_stepReady` is one of the functions this change edits, and
   a stub of a rule is a second copy of that rule. */
const walkSrc = grab(/var _tabs = stepTabs\(STEPS\[step\]\.t\)[\s\S]*?var _prevTab = \(_tabs && _ti > 0\) \? _tabs\[_ti - 1\] : null;/, 'the walk');
const enterSrc = grab(/function _enterStep\(i, atEnd\) \{[\s\S]*?\n      \}/, '_enterStep');
const walk = new Function('localStorage', `
  ${tabsSrc}
  var _stepTabSel = {};
  ${sliceFn('stepTabs')}
  ${sliceFn('stepTabKey')}
  ${aliasSrc}
  ${sliceFn('_stepNo')}
  var STEPS = ${JSON.stringify(railNew.map(t => ({ t: t, s: '' })))};
  var mode = 'new', cfg = { activities: [{ id: 'a1' }] };
  function locGroups() { return ['ST']; }
  function floorsOf() { return [{ id: 'f1' }]; }
  ${sliceFn('_stepReady')}
  function setStepTabQuiet(title, k) { var T = stepTabs(title); if (!T) return; _stepTabSel[title] = k; }
  function render() {}
  ${enterSrc}
  var step = 0, trail = [];
  for (var g = 0; g < 60; g++) {
    ${walkSrc}
    trail.push(STEPS[step].t + (_tabs ? ' \\u00b7 ' + (_tabs.filter(function (x) { return x.k === stepTabKey(STEPS[step].t); })[0] || {}).t : ''));
    if (_nextTab) { setStepTabQuiet(STEPS[step].t, _nextTab.k); continue; }
    if (step < STEPS.length - 1) { _enterStep(step + 1, false); continue; }
    break;
  }
  cfg = { activities: [] };
  var gated = STEPS.map(function (x) { return [x.t, _stepReady(x.t)]; }).filter(function (p) { return p[1]; });
  return { trail: trail, gated: gated };
`)({ getItem: () => null, setItem: () => {} });

console.log('walk: ' + walk.trail.join('  →  '));
const wantWalk = ['Start', 'Calendars', 'Project phases', 'Activities', 'Towers', 'Floors & Zones',
  'Location Sequence · Tower Sequence', 'Location Sequence · Zone sequence',
  'Activity sequence', 'Zone scoping', 'Generate'];
eq(JSON.stringify(walk.trail), JSON.stringify(wantWalk),
   'Next walks Location Sequence’s two views, then one screen each for Activity sequence and Zone scoping');

const gatedT = walk.gated.map(p => p[0]);
console.log('gated with no activities: ' + JSON.stringify(gatedT));
ok(gatedT.includes('Zone scoping'), 'Zone scoping is gated on there being activities — it has no columns without them');
ok(gatedT.includes('Activity sequence'), 'so is Activity sequence');
ok(walk.gated.every(p => /step \d/.test(p[1])),
   'every refusal names a real step NUMBER: ' + JSON.stringify(walk.gated.map(p => p[1])));

/* ============================================================================================
   3 · THE GROUPED TABLE
   ========================================================================================== */
const e2 = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const locLabel = l => [l.floor.code || l.floor.name || 'Flr']
  .concat(l.zone ? [l.zone.code || l.zone.name || 'Zn'] : [], l.unit ? [l.unit.code || l.unit.name || 'Un'] : [])
  .join(' · ');
let OFF = {};
const included = (uid, aid) => !OFF[uid + '|' + aid];
const tocs = new Function('e2', 'locLabel', 'included', sliceFn('tocs') + '; return tocs;')(e2, locLabel, included);

const acts = [{ id: 'a1', name: 'Rebar' }, { id: 'a2', name: 'Formworks' }];
function rows(html) {
  const out = [];
  const re = /<tr class="sbld-scope-grp"><td colspan="(\d+)" data-d="(\d+)">([^<]*)<|<td class="sbld-scope-row"[^>]*data-d="(\d+)"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) out.push({ kind: 'grp', span: +m[1], d: +m[2], t: m[3] });
    else out.push({ kind: 'row', d: +m[4], t: m[5] });
  }
  return out;
}
const fl = (id, code) => ({ id, code, zones: [] });
/* ⚠️⚠️ INDEX THROUGH `at`, NEVER `r[i]` DIRECTLY. Against a contrast base there are no group rows
   at all, so `at(r, 1).kind` THROWS and the suite reports nothing about the ~30 assertions after it —
   which is the difference between a contrast that names the change and one that merely dies. */
const at = (r, i) => r[i] || { kind: '(missing row ' + i + ')', d: -1, t: '(missing)' };

{ /* floor → zone → unit, one tower */
  const F5 = fl('f5', '5th Floor'), F6 = fl('f6', '6th Floor');
  const Z1 = { id: 'z1', code: 'Z1' }, Z2 = { id: 'z2', code: 'Z2' };
  const L = [];
  [F5, F6].forEach(f => [Z1, Z2].forEach(z => ['A', 'B'].forEach(u =>
    L.push({ uid: f.id + '/' + z.id + '/' + u, trade: 'ST', floor: f, zone: z,
             unit: { id: 'u' + u, code: u }, towerId: 't1', tower: 'Tower 1' }))));
  const r = rows(tocs(L, acts));
  eq(r.filter(x => x.kind === 'row').length, 8, 'all eight leaves are drawn');
  eq(r.filter(x => x.kind === 'grp').length, 6, 'two floor headings + four zone headings');
  ok(at(r, 0).kind === 'grp' && at(r, 0).d === 1 && at(r, 0).t === '5th Floor', 'the floor leads');
  ok(at(r, 1).kind === 'grp' && at(r, 1).d === 2 && at(r, 1).t === 'Z1', 'its zone follows, one rung in');
  ok(at(r, 2).kind === 'row' && at(r, 2).d === 3 && at(r, 2).t === 'A',
     'and the ROW is the unit alone — the prefix its headings already said is not repeated');
  ok(r.every(x => x.kind !== 'grp' || x.span === acts.length + 1), 'every heading spans the whole table');
  ok(!r.some(x => x.kind === 'grp' && /Tower/.test(x.t)),
     'a SINGLE-tower project gets no tower heading — one group is not a hierarchy');
}
{ /* ⚠️⚠️ THE TOWER RUNG IS NOT COSMETIC: locList clones a type's floors per instance and locLabel
     carries no tower, so two towers' leaves were indistinguishable in a flat list. */
  const F5 = fl('f5', '5th Floor'), Z1 = { id: 'z1', code: 'Z1' }, U = { id: 'ua', code: 'A' };
  const L = [
    { uid: 'ST/f5/z1', trade: 'ST', floor: F5, zone: Z1, unit: U, towerId: 't1', tower: 'Tower 1' },
    { uid: 'ST@t2/f5/z1', trade: 'ST', floor: F5, zone: Z1, unit: U, towerId: 't2', tower: 'Tower 2' }];
  const r = rows(tocs(L, acts));
  eq(r.filter(x => x.kind === 'grp' && /^Tower/.test(x.t)).length, 2, 'both towers get a heading');
  ok(at(r, 0).d === 1 && at(r, 1).d === 2 && at(r, 2).d === 3, 'every rung shifts down one to make room');
  ok(r.filter(x => x.kind !== 'grp').every(x => x.d === 4), 'the unit row sits at depth 4');
  eq(locLabel(L[0]), locLabel(L[1]), 'control: locLabel alone cannot tell the two towers apart');
}
{ /* a zoneless floor IS the leaf — no heading may repeat its own name above it */
  const L = [{ uid: 'GR/f1', trade: 'GR', floor: fl('f1', 'Ground Floor'), zone: null, unit: null,
               towerId: 't1', tower: 'Tower 1' }];
  const r = rows(tocs(L, acts));
  eq(r.length, 1, 'one row, no heading');
  ok(at(r, 0).kind === 'row' && at(r, 0).t === 'Ground Floor' && at(r, 0).d === 1, 'the row carries the floor itself');
}
{ /* a unitless zone is a row under a floor heading, not a heading of its own */
  const F = fl('f1', '2nd Floor');
  const L = [{ id: 'z1', code: 'Z1' }, { id: 'z2', code: 'Z2' }].map(z =>
    ({ uid: 'ST/f1/' + z.id, trade: 'ST', floor: F, zone: z, unit: null, towerId: 't1', tower: 'T1' }));
  const r = rows(tocs(L, acts));
  eq(r.length, 3, 'one floor heading and two zone rows');
  ok(at(r, 1).kind === 'row' && at(r, 1).t === 'Z1' && at(r, 1).d === 2, 'the zone is a row');
  ok(!r.some(x => x.kind === 'grp' && x.t === 'Z1'), 'with no heading duplicating it');
}
{ /* mixed depths inside ONE trade — cfg.locLevel and a zoneless floor both produce this */
  const A = fl('fa', 'Roof Deck'), B = fl('fb', '3rd Floor'), Z1 = { id: 'z1', code: 'Z1' };
  const L = [
    { uid: 'ST/fa', trade: 'ST', floor: A, zone: null, unit: null, towerId: 't1', tower: 'T1' },
    { uid: 'ST/fb/z1/ua', trade: 'ST', floor: B, zone: Z1, unit: { id: 'ua', code: 'A' }, towerId: 't1', tower: 'T1' }];
  const r = rows(tocs(L, acts));
  ok(at(r, 0).kind === 'row' && at(r, 0).t === 'Roof Deck', 'the zoneless floor is a bare row');
  ok(at(r, 1).kind === 'grp' && at(r, 1).t === '3rd Floor', 'the zoned floor gets a heading');
  ok(at(r, 3).kind === 'row' && at(r, 3).t === 'A', 'leaving the unit as its row');
}
{ /* ⚠️ THIS REGROUPS AND NEVER RE-SORTS: the order is the setup's own floor/zone order, and a row
     that moved because it was grouped would be this change rewriting the planner's sequence. */
  const F = fl('f1', 'F1'), order = ['Z3', 'Z1', 'Z2'];
  const L = order.map(c => ({ uid: 'ST/f1/' + c, trade: 'ST', floor: F, zone: { id: 'z' + c, code: c },
                              unit: null, towerId: 't1', tower: 'T1' }));
  const html = tocs(L, acts);
  eq(JSON.stringify(rows(html).filter(x => x.kind === 'row').map(x => x.t)), JSON.stringify(order),
     'row order is the caller’s');
  order.forEach(c => acts.forEach(a => ok(
    html.indexOf('data-uid="ST/f1/' + c + '" data-act="' + a.id + '"') >= 0,
    'the checkbox for ' + c + '/' + a.id + ' still carries its own uid')));
  eq((html.match(/type="checkbox"/g) || []).length, 6, 'three locations × two activities');
}
{ /* the tick still comes from cfg.scopeOff, through the grouping */
  const L = [{ uid: 'ST/f1', trade: 'ST', floor: fl('f1', 'F1'), zone: null, unit: null, towerId: 't1', tower: 'T1' }];
  OFF = { 'ST/f1|a2': true };
  const html = tocs(L, acts);
  ok(/data-act="a1" checked/.test(html), 'an included activity is ticked');
  ok(!/data-act="a2" checked/.test(html), 'an excluded one is not');
  OFF = {};
}

/* Group rows carry no handler: the column and row toggles are the controls on this screen, and a
   third bulk toggle where a heading belongs is a mis-click away from clearing a whole storey. */
ok(!/sbld-scope-grp[^\n]*data-(tr|uid)=/.test(src), 'no heading carries a toggle hook');

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed'
  + (process.argv[2] ? '   (contrast base: ' + process.argv[2] + ')' : ''));
process.exit(fail ? 1 : 0);
