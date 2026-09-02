// ============================================================================
// EPC RCM suite — executes the SHIPPED code, never a copy of it
// ----------------------------------------------------------------------------
// Run from the repo root:  node modules/risk-register/test-rcm.js
//
// Covers the shared engine (assets/js/epc-rcm.js) plus the derived helpers of
// BOTH registers, because the whole point of the shared file is that the two
// modules cannot drift — a suite that tested one of them would not see that.
//
// ⚠️ THE GRID FIXTURES ARE THE WORKBOOKS' OWN COMPUTED OUTPUT, not a re-reading
// of the formula. Each pair below was extracted from the cached values of the
// source .xlsx (the value Excel itself last wrote into the Priority Level cell)
// and grouped by its row's Impact / Probability-or-Influence pair. So these
// assert "our lookup answers what the controlled document answers", which is
// the only claim worth making about a transcription.
//
// ⚠️⚠️ THE TWO WORKBOOKS ARE **NOT** THE SAME TEMPLATE FOR THIS GRID, and that is
// the single most load-bearing fact in this file. Both carry a sheet named
// 'Risk Assessment Criteria - old' and both index into D328:H332 on it — but the
// CONTENTS of that range DIFFER between the files:
//
//        risk workbook, row for 4    3rd | 3rd | 2nd | 2nd | 1st
//   stakeholder workbook, row for 4  3rd | 2nd | 1st | 1st | (none)
//
// Deriving the stakeholder grid from the risk workbook's table — which the
// shared formula makes very easy to do by accident — produces a table that is
// wrong in 6 of its 16 cells, and wrong in the direction that UNDER-states a
// stakeholder's priority. RISK_GRID and STK_GRID are therefore two separate
// transcriptions on purpose. Do not "simplify" them into one.
// ============================================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const here = (...p) => path.join(__dirname, ...p);
const root = (...p) => path.join(__dirname, '..', '..', ...p);

let fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS ' + name); }
  else { fails++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b),
     'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// ---------------------------------------------------------------------------
// Load the SHIPPED epc-rcm.js. Only `window` and `Fmt` are stubbed, and Fmt.esc
// is the real escaping contract rather than an identity function — a stub
// kinder than the real thing tests the stub, which this repo has already been
// bitten by (2026-09-01 (l), Fmt.date).
// ---------------------------------------------------------------------------
const sandbox = {
  window: {},
  Fmt: { esc: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;') },
  console,
};
sandbox.window.Fmt = sandbox.Fmt;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(root('assets', 'js', 'epc-rcm.js'), 'utf8'), sandbox,
                { filename: 'epc-rcm.js' });
const E = sandbox.window.EPCRCM;

console.log('\n--- 1. the shared engine loads and exports what both modules call ---');
ok('epc-rcm.js defines window.EPCRCM', !!E);

// Every member the two modules reach for, so a rename here fails loudly rather
// than at runtime in a browser (the ReferenceError class that blanked the Gantt
// on 2026-08-15 survived four commits because the file still PARSED).
const REQUIRED = ['ACTIVITIES', 'activityByNo', 'activityByName', 'CATEGORIES', 'CATEGORY_NAMES',
  'subsOf', 'subNamesOf', 'PROBABILITY', 'IMPACT', 'CONTROL', 'TREATMENTS', 'RESPONSES',
  'CONTROL_TYPES', 'CONTROL_TYPE_NAMES', 'controlsOf', 'PRIORITIES', 'RISK_GRID', 'STK_GRID',
  'MENDELOW', 'APPROACHES', 'riskPriority', 'stkPriority', 'stkResponseCategory', 'stkApproach',
  'residualScore', 'residualBand', 'priorityClass', 'priorityShort', 'priorityRank', 'tbl',
  'gridHTML', 'priorityLegendHTML', 'probabilityTableHTML', 'impactTableHTML', 'controlTableHTML',
  'treatmentTableHTML', 'residualBandTableHTML', 'universeTableHTML', 'controlMasterlistHTML'];
const missing = REQUIRED.filter((k) => E[k] === undefined);
eq('every member the modules call is exported', missing, []);

console.log('\n--- 2. RISK_GRID vs the risk workbook\'s own computed Priority Level ---');
// SLN101. OPS. Risk Register. 2025 07 01.xlsx, sheet "EPC Project Risk Register".
// [impact, probability, priority the workbook computed, rows observed]
const RISK_OBSERVED = [
  [1, 1, '4th Priority', 4],
  [2, 1, '4th Priority', 2],
  [2, 2, '4th Priority', 3],
  [3, 1, '4th Priority', 2],
  [3, 2, '3rd Priority', 2],
  [3, 3, '3rd Priority', 11],
  [3, 5, '2nd Priority', 4],
  [4, 3, '2nd Priority', 2],
  [4, 4, '2nd Priority', 16],
  [5, 2, '2nd Priority', 2],
  [5, 3, '2nd Priority', 1],
  [5, 4, '1st Priority', 4],
  [5, 5, '1st Priority', 2],
];
RISK_OBSERVED.forEach(([i, p, want, n]) => {
  eq(`riskPriority(impact ${i}, probability ${p}) — ${n} row(s) in the workbook`,
     E.riskPriority(i, p), want);
});
ok('the observed pairs cover all four priority levels (a grid that always said "2nd" would pass a narrower fixture)',
   new Set(RISK_OBSERVED.map((r) => r[2])).size === 4);

// ⚠️ The property that makes a lookup table necessary in the first place: one
// product, two answers. A threshold on impact x probability could not produce
// this, so the grid must stay a lookup.
//
// ⚠️ NOTE the example that does NOT work, because the file's own comment used to
// cite it: (5,1) and (1,5) are both 3rd Priority in the sheet. Asserted here so
// nobody "restores" that claim from memory.
eq('a product of 4 as impact 2 x probability 2', E.riskPriority(2, 2), '4th Priority');
eq('...but as impact 1 x probability 4', E.riskPriority(1, 4), '3rd Priority');
eq('...and as impact 4 x probability 1', E.riskPriority(4, 1), '3rd Priority');
ok('so priority is a LOOKUP, not a band on the product — one product, two answers',
   E.riskPriority(2, 2) !== E.riskPriority(1, 4));
eq('and (impact 5, prob 1) really does equal (impact 1, prob 5) — both 3rd, per the sheet',
   [E.riskPriority(5, 1), E.riskPriority(1, 5)], ['3rd Priority', '3rd Priority']);

console.log('\n--- 3. STK_GRID vs the stakeholder workbook\'s own computed Priority Level ---');
// CSF101. OPS. Stakeholder Register. 2026 02 13.xlsx, sheet "EPC Stakeholder Register".
// [impact, influence, priority the workbook computed, rows observed]
const STK_OBSERVED = [
  [2, 2, '3rd Priority', 11],
  [2, 3, '2nd Priority', 1],
  [3, 2, '2nd Priority', 19],
  [3, 3, '2nd Priority', 25],
  [3, 4, '1st Priority', 5],
  [4, 3, '1st Priority', 7],
  [4, 4, '1st Priority', 17],
];
STK_OBSERVED.forEach(([i, f, want, n]) => {
  eq(`stkPriority(impact ${i}, influence ${f}) — ${n} row(s) in the workbook`,
     E.stkPriority(i, f), want);
});

// ⚠️ The contrast assertion. This is what fails if someone ever derives STK_GRID
// from the risk workbook's table because "it's the same template".
ok('STK_GRID is NOT the risk grid restricted to 1-4 — (impact 3, influence 4) is 1st here and 2nd there',
   E.stkPriority(3, 4) === '1st Priority' && E.riskPriority(3, 4) === '2nd Priority',
   E.stkPriority(3, 4) + ' vs ' + E.riskPriority(3, 4));
ok('...and (impact 2, influence 2) is 3rd here where the risk grid says 4th',
   E.stkPriority(2, 2) === '3rd Priority' && E.riskPriority(2, 2) === '4th Priority');

console.log('\n--- 4. rating guards: an unrated row derives NOTHING, never a default ---');
// A blank rating must not silently become a priority. "Nobody has assessed this"
// and "this is 4th priority" are opposite facts and only one is a reason to act.
[[null, 3], [3, null], [0, 3], [3, 0], [6, 3], [3, 6], ['', ''], [undefined, undefined]]
  .forEach(([a, b]) => {
    eq(`riskPriority(${JSON.stringify(a)}, ${JSON.stringify(b)}) is blank`, E.riskPriority(a, b), '');
  });
eq('stkPriority rejects 5 — the stakeholder scale is 1-4, not 1-5', E.stkPriority(5, 3), '');
eq('stkPriority rejects influence 5 too', E.stkPriority(3, 5), '');
eq('riskPriority ACCEPTS 5 — the risk scale is 1-5', E.riskPriority(5, 5), '1st Priority');
// Numeric strings: the stakeholder columns store TEXT '1'..'4' (documented
// column reuse), so a strict === on numbers would blank every stored row.
eq('stkPriority accepts the stored TEXT form "3"/"4"', E.stkPriority('3', '4'), '1st Priority');
eq('riskPriority accepts the stored TEXT form', E.riskPriority('5', '5'), '1st Priority');

console.log('\n--- 5. the Mendelow map (Criteria for Assessment, Table 2) ---');
// Transcribed from the stakeholder workbook's own Impact / Influence map:
//   impact 4,3 -> Keep Satisfied | Keep Satisfied | Manage Closely | Manage Closely
//   impact 2,1 -> Monitor        | Monitor        | Keep Informed  | Keep Informed
const MENDELOW_SHEET = {
  4: [null, 'Keep Satisfied', 'Keep Satisfied', 'Manage Closely', 'Manage Closely'],
  3: [null, 'Keep Satisfied', 'Keep Satisfied', 'Manage Closely', 'Manage Closely'],
  2: [null, 'Monitor (Minimum Effort)', 'Monitor (Minimum Effort)', 'Keep Informed', 'Keep Informed'],
  1: [null, 'Monitor (Minimum Effort)', 'Monitor (Minimum Effort)', 'Keep Informed', 'Keep Informed'],
};
let mendelowOk = true;
for (let i = 1; i <= 4; i++) for (let f = 1; f <= 4; f++) {
  if (E.stkApproach(i, f) !== MENDELOW_SHEET[i][f]) {
    mendelowOk = false;
    ok(`stkApproach(impact ${i}, influence ${f})`, false,
       'got ' + E.stkApproach(i, f) + ' want ' + MENDELOW_SHEET[i][f]);
  }
}
ok('all 16 Mendelow cells match the workbook\'s Table 2', mendelowOk);
eq('stkApproach is blank when unrated', E.stkApproach(null, 4), '');

console.log('\n--- 6. Response Category lookup (Criteria for Assessment, E265:F268) ---');
eq('1st Priority -> Manage Closely', E.stkResponseCategory('1st Priority'), 'Manage Closely');
eq('2nd Priority -> Keep Informed', E.stkResponseCategory('2nd Priority'), 'Keep Informed');
eq('3rd Priority -> Keep Satisfied', E.stkResponseCategory('3rd Priority'), 'Keep Satisfied');
eq('4th Priority -> Monitor (Minimum Effort)', E.stkResponseCategory('4th Priority'), 'Monitor (Minimum Effort)');
eq('an unknown priority yields blank, never a guess', E.stkResponseCategory('Whatever'), '');

// ⚠️ THE DISAGREEMENT IS DELIBERATE AND MUST SURVIVE. The workbook carries the
// response category and the management approach as two separate columns computed
// two different ways, and on some cells they disagree. Collapsing them into one
// answer would be inventing a number the source does not give.
eq('at (impact 3, influence 3) the priority lookup says Keep Informed',
   E.stkResponseCategory(E.stkPriority(3, 3)), 'Keep Informed');
eq('...while Table 2 says Manage Closely for the same cell',
   E.stkApproach(3, 3), 'Manage Closely');
ok('so the two stakeholder lookups DISAGREE there, exactly as the workbook does — and both are shown',
   E.stkResponseCategory(E.stkPriority(3, 3)) !== E.stkApproach(3, 3));

console.log('\n--- 7. residual score + bands (Table 3A), including the boundaries ---');
eq('residual = impact x possibility x detectability', E.residualScore(5, 5, 5), 125);
eq('residual of the lowest scores', E.residualScore(1, 1, 1), 1);
eq('residual with one factor unrated is NULL, not 0 — "not re-assessed" is not "no risk"',
   E.residualScore(5, 5, null), null);
eq('residual rejects an out-of-range factor', E.residualScore(5, 5, 6), null);
// The band boundaries are the thing most likely to be typo'd, and an off-by-one
// moves a risk between "acceptable" and "stop work".
eq('score 27 is the top of Low', E.residualBand(27).label, 'Low');
eq('score 28 is the bottom of Moderate', E.residualBand(28).label, 'Moderate');
eq('score 64 is the top of Moderate', E.residualBand(64).label, 'Moderate');
eq('score 65 is the bottom of High', E.residualBand(65).label, 'High');
eq('score 125 is High', E.residualBand(125).label, 'High');
eq('a null score has no band at all', E.residualBand(null).label, '');
ok('each band carries its own action text from the sheet',
   /not acceptable/i.test(E.residualBand(70).action) &&
   /tolerated/i.test(E.residualBand(30).action) &&
   /acceptable, no further action/i.test(E.residualBand(5).action));

console.log('\n--- 8. the taxonomy (MCC Risk Universe + the 5-PMLC spine) ---');
eq('10 categories, matching the workbook\'s Dropdown List', E.CATEGORY_NAMES.length, 10);
eq('20 activities in the 5-PMLC spine', E.ACTIVITIES.length, 20);
ok('activity numbers are 1..20 with no gap or repeat',
   JSON.stringify(E.ACTIVITIES.map((a) => a.no)) ===
   JSON.stringify(Array.from({ length: 20 }, (_, i) => i + 1)));
ok('every activity carries an objective and a description (the panel renders both)',
   E.ACTIVITIES.every((a) => a.objective && a.description && a.subs.length));
eq('activityByNo resolves', E.activityByNo(8).name, 'PROCUREMENT');
eq('activityByNo takes the stored TEXT form', E.activityByNo('8').name, 'PROCUREMENT');
eq('activityByName is case-insensitive', E.activityByName('procurement').no, 8);
eq('an unknown activity is null, not a throw', E.activityByNo(99), null);

// ⚠️ The tolerant category lookup matters because the SOURCE REGISTER itself is
// inconsistent: it writes "ProjectManagement" (no space) in some rows and
// "Technical " (trailing space) in others. A strict match would return an empty
// sub-category picker, which reads as "this category has none" rather than
// "your value is off-taxonomy".
eq('subsOf tolerates the register\'s own "ProjectManagement" spelling',
   E.subNamesOf('ProjectManagement').length, E.subNamesOf('Project Management').length);
ok('...and it is not empty', E.subNamesOf('ProjectManagement').length > 0);
eq('subsOf tolerates a trailing space', E.subNamesOf('Technical ').length, E.subNamesOf('Technical').length);
eq('an off-taxonomy category yields an empty list, not a throw', E.subsOf('Financial'), []);
eq('a blank category yields an empty list', E.subsOf(''), []);
ok('every category offers an "Others" escape hatch — the workbook does, and without it a real value has nowhere to go',
   E.CATEGORIES.every((c) => c.subs.some((s) => s.name === 'Others')));
eq('the four response terms are the register\'s own, not the doctrine list', E.RESPONSES.length, 4);
ok('RESPONSES are the Dropdown List\'s T-words',
   E.RESPONSES.join('|') === 'Tolerate / Accept|Transfer / Share|Terminate / Avoid|Treat / Mitigate');
ok('control masterlist carries 7 control categories', E.CONTROL_TYPES.length === 7);
ok('controlsOf returns suggestions for a known category', E.controlsOf('Independent Review or Audit').length > 0);
eq('controlsOf on an unknown category is empty, not a throw', E.controlsOf('Nope'), []);

console.log('\n--- 9. presentation helpers ---');
eq('priorityRank orders 1st..4th', E.PRIORITIES.map(E.priorityRank), [1, 2, 3, 4]);
eq('an unranked value sorts LAST, never first — a blank must not head a priority-sorted list',
   E.priorityRank(''), 99);
eq('priorityShort trims the noise word', E.priorityShort('1st Priority'), '1st');
eq('priorityShort on blank is blank', E.priorityShort(''), '');
eq('priorityClass maps each level', E.PRIORITIES.map(E.priorityClass), ['rcm-p1', 'rcm-p2', 'rcm-p3', 'rcm-p4']);
eq('priorityClass on an unknown value is blank', E.priorityClass('x'), '');
// Escaping: every one of these renders user-supplied or sheet-supplied text.
ok('tbl() escapes its caption', /&lt;script&gt;/.test(E.tbl('<script>', ['a'], [['x']])));
ok('gridHTML escapes its axis labels',
   /&lt;b&gt;/.test(E.gridHTML({ xMax: 2, yMax: 2, xLabel: '<b>', yLabel: 'y', cell: () => '' })));
ok('the criteria tables render without throwing',
   [E.probabilityTableHTML, E.impactTableHTML, E.controlTableHTML, E.treatmentTableHTML,
    E.residualBandTableHTML, E.universeTableHTML, E.controlMasterlistHTML]
     .every((f) => typeof f() === 'string' && f().length > 100));
// ⚠️ The probability-rate column is backwards IN THE SOURCE. It is kept verbatim
// because this is a transcription of a controlled document — but it must be
// flagged on screen, or a planner scores from a column that contradicts itself.
ok('the probability table FLAGS its own backwards rate column rather than silently "fixing" it',
   /transcribed verbatim/i.test(E.probabilityTableHTML()) && /backwards|runs backwards/i.test(E.probabilityTableHTML()));
ok('the grid renders one cell per combination', (E.gridHTML({
  xMax: 5, yMax: 5, xLabel: 'Impact', yLabel: 'Probability', cell: () => 'x',
}).match(/rcm-gcell/g) || []).length === 25);

// ---------------------------------------------------------------------------
// The module-level derived helpers. Sliced out of the SHIPPED module.js by
// brace matching and executed — never reimplemented here, or the suite would
// pass against a copy that has drifted from what ships.
// ---------------------------------------------------------------------------
function slice(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function ' + name + ' NOT FOUND in the shipped file');
  let i = src.indexOf('{', start), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, j + 1);
}

console.log('\n--- 10. stakeholder-map derived values (sliced from the shipped module.js) ---');
const smSrc = fs.readFileSync(root('modules', 'stakeholder-map', 'module.js'), 'utf8');
const smNames = ['n4', 'impactOf', 'influenceOf', 'importanceOf', 'priorityOf', 'responseOf',
                 'approachOf', 'residualOf', 'gapOf', 'strategyOf', 'freqOf'];
const smCtx = { E: () => E, console };
vm.createContext(smCtx);
vm.runInContext(smNames.map((n) => slice(smSrc, n)).join('\n'), smCtx, { filename: 'sm-sliced.js' });

// ⚠️ THE COLUMN REUSE IS LOAD-BEARING AND COUNTER-INTUITIVE: `influence` stores
// IMPACT and `interest` stores INFLUENCE, both as TEXT. config.js's dashboard
// tile declares those column names, so renaming them breaks the tile silently.
// If this assertion ever fails, the reuse has been "tidied" and every stored
// stakeholder's priority has just been transposed.
const row = { influence: '4', interest: '3' }; // impact 4, influence 3
eq('impactOf reads the `influence` COLUMN (documented reuse)', smCtx.impactOf(row), 4);
eq('influenceOf reads the `interest` COLUMN (documented reuse)', smCtx.influenceOf(row), 3);
eq('importance = impact x influence', smCtx.importanceOf(row), 12);
eq('priorityOf routes through the shared grid', smCtx.priorityOf(row), E.stkPriority(4, 3));
eq('priorityOf on that row is 1st, per the workbook', smCtx.priorityOf(row), '1st Priority');
eq('importanceOf on an unrated row is null, not 0', smCtx.importanceOf({}), null);
eq('priorityOf on an unrated row is blank', smCtx.priorityOf({}), '');

// The override rule: a stored value wins, and the derived value is the fallback.
eq('responseOf falls back to the derived category', smCtx.responseOf(row), 'Manage Closely');
eq('responseOf honours a stored override', smCtx.responseOf({ ...row, response_category: 'Keep Informed' }), 'Keep Informed');
eq('approachOf falls back to Mendelow', smCtx.approachOf(row), E.stkApproach(4, 3));
eq('approachOf honours a stored override', smCtx.approachOf({ ...row, mgmt_approach: 'Monitor (Minimum Effort)' }), 'Monitor (Minimum Effort)');

// Relationship gap -> strategy -> frequency.
eq('gap = target - current', smCtx.gapOf({ current_rel: '1', target_rel: '4' }), 3);
eq('gap 3 -> Catch up', smCtx.strategyOf(3), 'Catch up');
eq('gap 2 -> Catch up', smCtx.strategyOf(2), 'Catch up');
eq('gap 1 -> Enhance', smCtx.strategyOf(1), 'Enhance');
eq('gap 0 -> Maintain', smCtx.strategyOf(0), 'Maintain');
eq('a NEGATIVE gap is N/A, not Maintain — the relationship is already past target', smCtx.strategyOf(-1), 'N/A');
eq('an unrated gap yields no strategy', smCtx.strategyOf(null), '');
eq('gapOf with one side unrated is null', smCtx.gapOf({ current_rel: '2' }), null);
// ⚠️ The Guide sheet and the live formula disagree; the live formula wins,
// because that is what the register's own data reflects.
eq('Catch up -> Monthly', smCtx.freqOf('Catch up'), 'Monthly');
eq('Enhance -> Every two months (the LIVE formula, not the stale Guide sheet)', smCtx.freqOf('Enhance'), 'Every two months');
eq('Maintain -> Quarterly (the LIVE formula, not the stale Guide sheet)', smCtx.freqOf('Maintain'), 'Quarterly');
eq('N/A has no frequency', smCtx.freqOf('N/A'), '');

console.log('\n--- 11. risk-register derived values (sliced from the shipped module.js) ---');
const rrSrc = fs.readFileSync(root('modules', 'risk-register', 'module.js'), 'utf8');
const rrCtx = { E: () => E, console };
vm.createContext(rrCtx);
vm.runInContext(['importanceOf', 'priorityOf', 'residualOf'].map((n) => slice(rrSrc, n)).join('\n'),
                rrCtx, { filename: 'rr-sliced.js' });
eq('importance = impact x likelihood', rrCtx.importanceOf({ impact: 4, likelihood: 4 }), 16);
eq('importanceOf on an unrated risk is null, not 0', rrCtx.importanceOf({}), null);
eq('priorityOf routes through the shared grid', rrCtx.priorityOf({ impact: 5, likelihood: 4 }), '1st Priority');
eq('priorityOf on an unrated risk is blank', rrCtx.priorityOf({}), '');
eq('residualOf routes through the shared score',
   rrCtx.residualOf({ res_impact: 5, res_possibility: 4, res_detectability: 4 }), 80);
eq('residualOf on a not-re-assessed risk is null', rrCtx.residualOf({}), null);

// ⚠️ BOTH registers must reach the SAME engine for the same question. This is
// the assertion that the shared file is actually doing its job.
ok('both modules derive residual through the one shared function',
   rrCtx.residualOf({ res_impact: 3, res_possibility: 3, res_detectability: 3 }) ===
   smCtx.residualOf({ res_impact: 3, res_possibility: 3, res_detectability: 3 }));

console.log('\n--- 12. structural: nothing ships half-wired ---');
const rrHtml = fs.readFileSync(root('modules', 'risk-register', 'index.html'), 'utf8');
const smHtml = fs.readFileSync(root('modules', 'stakeholder-map', 'index.html'), 'utf8');
ok('risk-register/index.html loads epc-rcm.js', /epc-rcm\.js\?v=/.test(rrHtml));
ok('stakeholder-map/index.html loads epc-rcm.js', /epc-rcm\.js\?v=/.test(smHtml));
ok('both load epc-rcm.css', /epc-rcm\.css\?v=/.test(rrHtml) && /epc-rcm\.css\?v=/.test(smHtml));

// ⚠️ MODULE_V is what makes a changed index.html reach a returning browser. Both
// index.html files changed structurally this round (new <script>/<link> tags and
// a renamed tab), so a stale MODULE_V serves the OLD page, which never loads
// epc-rcm.js and throws on first use. This repo has mis-diagnosed that as a code
// bug more than once (2026-08-25 (m)).
const dashV = (fs.readFileSync(root('dashboard.html'), 'utf8').match(/modules-grid\.js\?v=([^"']+)/) || [])[1];
const modsV = (fs.readFileSync(root('modules.html'), 'utf8').match(/modules-grid\.js\?v=([^"']+)/) || [])[1];
ok('dashboard.html and modules.html agree on MODULE_V', dashV && dashV === modsV, dashV + ' vs ' + modsV);
ok('MODULE_V was bumped past the pre-RCM 20260901e', dashV > '20260901e', 'MODULE_V=' + dashV);

// A stale-view bookmark must not render a void. The 5x5 grid used to be
// 'matrix'; that hash now matches no view.
ok('risk-register normalises the retired #rr_view=matrix hash to the heat map',
   /if \(view === 'matrix'\) view = 'heat';/.test(rrSrc));
ok('...and falls back to the register for anything else unrecognised',
   /VIEWS\.indexOf\(view\) === -1\) view = 'list'/.test(rrSrc));
ok('stakeholder-map has the same fallback guard',
   /VIEWS\.indexOf\(view\) === -1\) view = 'list'/.test(smSrc));

// The two migrations must be reachable by name from the code that degrades when
// they have not been run — a toast naming the wrong file sends the owner to a
// migration that changes nothing (the 2026-08-27 (3) trap).
ok('the risk migration exists', fs.existsSync(root('migrations', '2026-09-01-risk-register-rcm.sql')));
ok('the stakeholder migration exists', fs.existsSync(root('migrations', '2026-09-01-stakeholder-register-ops.sql')));
ok('stakeholder-map names its own migration when the photo bucket is missing',
   /2026-09-01-stakeholder-register-ops\.sql/.test(smSrc));
ok('risk-register names its own migration', /2026-09-01-risk-register-rcm\.sql/.test(rrSrc));

// The regenerated verifier must actually know about them, or a clean run proves
// nothing about this round (the 2026-09-01 (d) blind spot).
const verify = fs.readFileSync(root('migrations', 'VERIFY-schema.sql'), 'utf8');
ok('VERIFY-schema.sql was regenerated and covers the risk migration',
   verify.includes('2026-09-01-risk-register-rcm'));
ok('VERIFY-schema.sql covers the stakeholder migration',
   verify.includes('2026-09-01-stakeholder-register-ops'));
ok('VERIFY-schema.sql expects the new residual columns', /res_detectability/.test(verify));
ok('VERIFY-schema.sql expects the photo columns', /photo_thumb_path/.test(verify));
const build = fs.readFileSync(root('supabase-build.sql'), 'utf8');
ok('supabase-build.sql was regenerated and carries the storage bucket',
   build.includes('stakeholder-photos'));
ok('supabase-build.sql carries the new residual columns', /res_detectability/.test(build));

// The bucket is private and its policies are re-runnable. A public bucket would
// expose every stakeholder's photograph to anyone holding a URL.
const stkMig = fs.readFileSync(root('migrations', '2026-09-01-stakeholder-register-ops.sql'), 'utf8');
ok('the stakeholder-photos bucket is created PRIVATE', /'stakeholder-photos'[\s\S]{0,80}false/.test(stkMig));
ok('every storage policy is preceded by a drop, so the migration is re-runnable',
   (stkMig.match(/create policy/gi) || []).length ===
   (stkMig.match(/drop policy if exists/gi) || []).length);
ok('the migration pre-flights is_writer() rather than failing obscurely',
   /is_writer\(\) is missing/.test(stkMig));
ok('photo columns store PATHS, signed on demand — not URLs, which expire',
   /photo_path/.test(stkMig) && /photo_thumb_path/.test(stkMig));

console.log('\n--- 13. admin is REACHABLE (the 2026-09-01 access regression) ---');
// ⚠️ renderNav's 'project' branch deliberately emits no Admin/Projects link, and
// home.html has no sidebar at all — so if the account menu does not carry the
// system destinations, "+ Add project" and user management are unreachable from
// every page a planner actually uses. That is a NAVIGATION defect, not a
// permissions one, and no role check anywhere would have caught it.
const uiSrc = fs.readFileSync(root('assets', 'js', 'ui.js'), 'utf8');
const authSrc = fs.readFileSync(root('assets', 'js', 'auth.js'), 'utf8');
const userBar = uiSrc.slice(uiSrc.indexOf('function renderUserBar'),
                            uiSrc.indexOf('function renderUserBar') + 4000);
ok('the account menu links to projects.html (where "+ Add project" lives)',
   /pd-usermenu-link[^]*projects\.html/.test(userBar));
ok('the account menu links to admin.html', /pd-usermenu-link[^]*admin\.html/.test(userBar));
ok('Admin is gated on the profile role, in ONE place rather than 20 call sites',
   /\['admin', 'super_admin'\]\.indexOf\(profile\.role\)/.test(userBar));
ok('...and it is genuinely conditional, not always rendered',
   /isAdmin\s*\?[^]*admin\.html/.test(userBar));
ok('the links resolve from a module page too (appBase gives ../../)',
   /var base = appBase\(\);/.test(userBar));
ok('every renderNav "project"-mode page still gets Admin via the account menu, since renderNav itself offers none there',
   !/mode === 'project'[^]*admin\.html/.test(uiSrc));
// The CSS must exist or the links render unstyled inside the menu.
const css = fs.readFileSync(root('assets', 'css', 'dashboard.css'), 'utf8');
ok('.pd-usermenu-link is styled', /\.pd-usermenu-link\s*\{/.test(css));
ok('.pd-usermenu-links group is styled', /\.pd-usermenu-links\s*\{/.test(css));
ok('the menu links meet the 44px touch minimum on a phone',
   /\.pd-usermenu-link\s*\{\s*min-height:\s*44px/.test(css.replace(/\s+/g, ' ')));

// ⚠️ The stale-profile half: a role change must reach a tab that already cached
// the old profile, or an admin promoting someone appears to do nothing.
ok('the profile cache is revalidated against the server in the background',
   /function revalidateProfile/.test(authSrc) && /revalidateProfile\(user, cached\)/.test(authSrc));
ok('a transient network error keeps the cache rather than signing the user out',
   /keep the cache, never sign the user out/.test(authSrc));
ok('only role/status changes interrupt the page — other edits just correct the cache',
   /r\.data\.role === cached\.role && r\.data\.status === cached\.status/.test(authSrc));
ok('the reload guard is keyed on the OBSERVED STATE, so a second real change still applies',
   /var sig = r\.data\.role \+ '\|' \+ r\.data\.status;/.test(authSrc));
ok('the reload marker is cleared by logout (it shares the pd_prof_ prefix)',
   /pd_prof_rl_/.test(authSrc) && /k\.indexOf\('pd_prof_'\) === 0/.test(authSrc));

// One version per shared asset — a page left a version behind serves the OLD
// account menu and stays locked out, which is exactly how this hid.
['ui.js', 'auth.js', 'dashboard.css'].forEach((asset) => {
  const versions = new Set();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
    else if (e.name.endsWith('.html')) {
      const m = fs.readFileSync(p, 'utf8').match(new RegExp(asset.replace('.', '\\.') + '\\?v=([^"\']+)', 'g'));
      if (m) m.forEach((x) => versions.add(x));
    }
  });
  walk(root());
  eq(`${asset} is served at exactly one version app-wide`, [...versions].length, 1);
});

console.log('\n================ ' + passes + ' passed, ' + fails + ' failed ================');
process.exit(fails ? 1 : 0);
