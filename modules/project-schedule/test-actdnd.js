/* modules/project-schedule/test-actdnd.js
   ==========================================================================================
   Schedule Setup > Activities: the drag-and-drop shuttle, the Internal/External rename, and
   the grid's type rung.  Run:  node modules/project-schedule/test-actdnd.js <index.html>
   Add --base to assert the OPPOSITE (the contrast build, for a pinned pre-change SHA).

   ⚠ Everything executable here is SLICED OUT OF THE SHIPPED FILE and run. A retyped copy of
   `_catLoad` would prove the copy works, which is the trap this repo has been caught by more
   than once.

   ⚠⚠ WHAT THIS SUITE CANNOT SEE, stated rather than implied: a real DragEvent. `dragover`
   calling preventDefault is asserted as SOURCE here, because without a browser there is no
   event to cancel — so the drop being LEGAL is checked by reading, and was separately driven
   through real DragEvents in Chromium against these same slices (26 assertions) before this
   shipped. If you change the drag wiring, re-drive it; a green run here is not that proof.
*/
'use strict';
const fs = require('fs');

const FILE = process.argv[2];
if (!FILE) { console.error('usage: node test-actdnd.js <index.html> [--base]'); process.exit(2); }
const IS_BASE = process.argv.indexOf('--base') !== -1;
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fail++; fails.push(m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b),
  m + '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

/* ---- slicing ---------------------------------------------------------------------------- */
function slice(startNeedle, endNeedle) {
  const i = src.indexOf(startNeedle); if (i < 0) return null;
  const j = src.indexOf(endNeedle, i); if (j < 0) return null;
  return src.slice(i, j);
}
/* ⚠️ ANCHORED ON THE NAME, NOT THE FULL SIGNATURE. This read `function _catLoad(ids) {` and
   aborted the moment the 2026-09-18 pass gave the mover a second parameter (`opts`, which carries
   an L1 drag's merge instruction). The abort was the design working — a slicer that quietly
   matched nothing would have reported a pass over an empty string — but the anchor itself was
   needlessly brittle, so it now matches the declaration rather than its arity. */
const MOVER  = slice('      function _catLoad(ids', '      host.querySelector(\'#b-load\').onclick');
const WIRING = slice('      function _catLoad(ids', '      host.querySelector(\'#b-unload\')');

if (IS_BASE) {
  /* The contrast: none of this exists before the change, and a base that has stopped being a
     contrast is loud rather than quietly self-comparing. */
  ok(MOVER === null, 'BASE has no _catLoad mover');
  ok(!/sbld-dropok/.test(src), 'BASE has no drop-ring class');
  ok(!/draggable="true"\' \+ \' style="--zc/.test(src) && !/data-cat="\' \+ a\.id \+ \'" draggable/.test(src),
     'BASE does not make a library row draggable');
  ok(src.indexOf("label: 'Interior (d)'") >= 0, 'BASE still says Interior (d)');
  ok(src.indexOf("table.sbld-xl { border-collapse:collapse; font-size:var(--pd-fs-sm)") >= 0,
     'BASE grid is still a rung higher (--pd-fs-sm)');
  report();
}
if (!WIRING) { console.error('ABORT: could not slice the drag wiring — it moved or was removed.'); process.exit(1); }

/* ==========================================================================================
   1 · ITEM 1 — drag a class code onto the grid
   ========================================================================================== */

// every library row is draggable
ok(/data-cat="' \+ a\.id \+ '" draggable="true"/.test(src),
   'every library row is emitted with draggable="true"');

// ⚠⚠ ONE mover. Two copies is how the button and the drag come to disagree about a selection.
eq((src.match(/function _catLoad\s*\(/g) || []).length, 1, 'exactly ONE _catLoad is declared');
ok(/#b-load'\)\.onclick = function \(\) \{[\s\S]{0,260}?_catLoad\(catSel\.slice\(\)\)/.test(src),
   'the ← button goes through _catLoad');
/* ⚠️ RETARGETED: the drop now passes a second argument — an L1 drag's merge instruction — so the
   old exact-arity pattern `_catLoad(ids)` stopped matching. The property under test is unchanged
   and is the one that matters: the drop reaches the SAME mover the button does. */
ok(/addEventListener\('drop'[\s\S]{0,520}?_catLoad\(ids\b/.test(WIRING),
   'the drop goes through the SAME _catLoad');
/* ---- the 2026-09-18 L1 drag ------------------------------------------------------------- */
ok(/\[data-sapl1\]/.test(WIRING) || /data-sapl1/.test(src), 'an L1 heading is wired for dragstart');
ok(/_dragMerge = null/.test(WIRING), '⚠ a plain code drag CLEARS the L1 flag — a stale one would merge rows nobody asked to merge');
ok(/mergeAll: true/.test(WIRING), 'an L1 drop asks the mover to merge outright');

// ⚠⚠ preventDefault on dragover is what MAKES a drop legal. Without it the browser refuses
//    the drop and the whole gesture silently does nothing.
ok(/addEventListener\('dragover', function \(ev\) \{[\s\S]{0,200}?ev\.preventDefault\(\)/.test(WIRING),
   'dragover calls preventDefault, WITHOUT WHICH THE DROP IS REFUSED');
ok(/addEventListener\('drop', function \(ev\) \{[\s\S]{0,160}?ev\.preventDefault\(\)/.test(WIRING),
   'drop calls preventDefault');

// ⚠ dragleave fires crossing every child boundary, so an unguarded handler flickers the ring
//   off while the cursor is still inside the grid.
ok(/addEventListener\('dragleave', function \(ev\) \{\s*if \(ev\.target === _xlDrop\)/.test(WIRING),
   'dragleave only clears the ring when leaving the WRAPPER, not a child cell');

// the ring goes on and comes off
ok(/dragover[\s\S]{0,260}?classList\.add\('sbld-dropok'\)/.test(WIRING), 'dragover paints the drop ring');
ok(/drop'[\s\S]{0,200}?classList\.remove\('sbld-dropok'\)/.test(WIRING), 'drop clears the drop ring');

// ⚠ a ticked row carries the whole ticked set; an un-ticked one carries only itself
ok(/_dragIds = \(catSel\.indexOf\(id\) >= 0\) \? catSel\.slice\(\) : \[id\]/.test(WIRING),
   'dragging a TICKED row carries the tick set, an un-ticked row carries only itself');
// ⚠ and a drop with nothing in flight must move nothing
ok(/addEventListener\('drop', function \(ev\) \{\s*if \(!_dragIds\) return;/.test(WIRING),
   'a drop with no drag in flight is a no-op');
ok(/dragend[\s\S]{0,120}?_dragIds = null/.test(WIRING), 'dragend releases the drag');

// ⚠ the button survives: it is the discoverable gesture and the only keyboard-reachable one
ok(/id="b-load"/.test(src), 'the ← button is still there — drag ADDS a gesture, it replaces none');

/* ---- and now EXECUTE the mover ---------------------------------------------------------- */
(function () {
  let dirty = 0, renders = 0;
  const cfg = {
    catalog: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
    activities: [{ id: 'a0' }]
  };
  // the mover reassigns `catSel`, so it must be a closure var of the compiled scope, exactly
  // as it is a closure var of stActivities. A parameter would take the assignment instead.
  /* ⚠ `_catLoad` gained three dependencies on 2026-09-17 — it now sorts the build into trade
     order and OFFERS a merge when several same-trade codes arrive at once. They are stubbed here
     because what this suite tests is the MOVE; `test-actsetup` executes the merge itself.
     ⚠ `psConfirm` is a no-op rather than an auto-yes: a stub that accepted would make every
     assertion below measure a merged row instead of the rows that moved. */
  let asked = 0, merged = 0, mergedName = null;
  /* ⚠️⚠️ `actIsMerged` AND `sapMergeKids` ARE SLICED, NOT STUBBED, and `SAP_L3` is the real table.
     The 2026-09-18 pass made the mover attach an SAP group's level-3 items on the way in, and that
     IS a rule — a stub of it would have this suite proving that MY hierarchy is attached rather
     than the shipped one. `mergeActs` stays a counter: what it does is `test-actsetup`'s subject,
     what matters here is that an L1 drag reaches it at all and an ordinary one does not. */
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
  const L3SRC = sliceVar('SAP_L3');
  const FN = (n) => { const i = src.indexOf('\n    function ' + n + '('); if (i < 0) return ''; 
    let j = src.indexOf('{', i), d = 0; for (; j < src.length; j++) { const c = src[j];
      if (c === '{') d++; else if (c === '}') { d--; if (!d) return src.slice(i + 1, j + 1); } } return ''; };
  const DEPS = 'var SAP_L3 = ' + L3SRC + ';\n' + FN('sapKids') + '\n' + FN('sapMergeKids') + '\n' + FN('actIsMerged') + '\n';
  const api = new Function('cfg', 'markDirty', 'render', 'psConfirm', 'GLABEL', 'sortActivities', 'mergeActs', `
    var catSel = ['c3', 'c1'];
    var actSel = [];
    ${DEPS}
    ${MOVER}
    return { load: _catLoad, ticked: function () { return catSel.slice(); },
             picked: function () { return actSel.slice(); } };
  `)(cfg, () => { dirty++; }, () => { renders++; }, () => { asked++; }, {}, () => {},
     (nm) => { merged++; mergedName = nm; return true; });

  eq(api.load([]), false, 'an empty id list moves nothing and reports it');
  eq(api.load(['nope']), false, 'an id that is not in the list moves nothing');
  eq(dirty, 0, '… and neither marks the setup dirty');

  eq(api.load(['c2']), true, 'moving one code reports it moved');
  /* ---- 2026-09-18: an SAP group arrives carrying its level-3 items -------------------------- */
  eq(cfg.activities.find(a => a.id === 'c2').kids, undefined,
     '⚠ a row whose code is NOT an SAP group gets no children — nothing becomes merged by accident');
  eq(cfg.activities.map(a => a.id), ['a0', 'c2'], 'the code lands at the END of the build');
  eq(cfg.catalog.map(a => a.id), ['c1', 'c3'], 'and leaves the list');
  eq(dirty, 1, 'the move marks the setup dirty');
  eq(renders, 1, 'and repaints once');

  // ⚠ rows keep the LIST's order, not the order the drag was assembled in
  api.load(['c3', 'c1']);
  eq(cfg.activities.map(a => a.id), ['a0', 'c2', 'c1', 'c3'],
     'a multi-code move keeps the LIST order (c1 before c3), not the order given');
  // ⚠ the ticks go with them, or ← would try to move rows that are no longer in the list
  eq(api.ticked(), [], 'the moved codes lose their ticks');
  /* ⚠ The two-code move above is all one (absent) trade, so the merge offer fires — and the rows
     are in the build BEFORE it is asked. That ordering is the point: cancelling must leave the
     planner with what they asked for, not with nothing and a dismissed dialog. */
  eq(asked, 1, 'a multi-code move OFFERS a merge, once');
  eq(cfg.activities.map(a => a.id), ['a0', 'c2', 'c1', 'c3'],
     '… and the rows are already in the build when it asks');

  /* ==========================================================================================
     2026-09-18 — an SAP group arrives carrying its level-3 items, and an L1 drag merges outright
     ⚠ EXECUTED against the REAL `SAP_L3`, so these assert the shipped hierarchy rather than a
     fixture of my own. `01050` is General Requirement › Mobilization / Demobilization, which the
     workbook gives exactly two items.
     ========================================================================================== */
  cfg.catalog = [{ id: 'g1', code: '01050', name: 'Mob/Demob', group: 'GR' },
                 { id: 'g2', code: '01100', name: 'Temp facilities', group: 'GR' },
                 { id: 'g3', code: 'ZZZZZ', name: 'Not a group', group: 'GR' }];
  cfg.activities = [];
  asked = 0; merged = 0; mergedName = null;
  api.load(['g1']);
  const got = cfg.activities.find(a => a.id === 'g1');
  ok(!!(got && got.kids && got.kids.length === 2),
     '⚠⚠ dragging a LEVEL 2 brings its level-3 items in with it, as one merged activity',
     got && got.kids);
  eq((got.kids || []).map(k => k.code).join(','), '01051,01052',
     '… the real item codes from the workbook, padded');
  ok(!(got.kids || []).some(k => k.code === '01050'),
     '⚠ the group’s OWN code is never among its children — actCodes prepends it');
  eq(got.code, '01050', '… and the row itself still IS the group');
  eq(merged, 0, 'a single L2 drag does not go through mergeActs — there is nothing to merge');

  api.load(['g3']);
  eq(cfg.activities.find(a => a.id === 'g3').kids, undefined,
     '⚠ a code that is not an SAP group arrives exactly as before — additive, never a surprise');

  /* An L1 drag: several groups, merged outright, named for the L1 rather than the first group. */
  cfg.catalog = [{ id: 'h1', code: '01050', name: 'Mob/Demob', group: 'GR' },
                 { id: 'h2', code: '01100', name: 'Temp facilities', group: 'GR' }];
  cfg.activities = []; asked = 0; merged = 0;
  api.load(['h1', 'h2'], { mergeAll: true, name: 'General Requirement' });
  eq(merged, 1, '⚠⚠ an L1 drag merges OUTRIGHT — it is what the gesture MEANS, not an offer');
  eq(mergedName, 'General Requirement', '… named for the L1, not for the first group under it');
  eq(asked, 0, '⚠ …and it never asks, unlike an ordinary multi-row arrival');
  ok(cfg.activities.every(a => a.kids && a.kids.length),
     '… every group still arrived carrying its own items for the merge to flatten');
})();

/* ==========================================================================================
   2 · ITEM 2 — Interior/Exterior become Internal/External
   ========================================================================================== */
const LABELS = [
  ["label: 'Internal (d)'", 2, 'both duration grids head their columns Internal (d)'],
  ["label: 'External (d)'", 2, 'both duration grids head their columns External (d)'],
  ["[['int', 'Internal'], ['ext', 'External']]", 1, 'the trade-sequence Dur toggle reads Internal / External'],
  ["<b>Internal / External</b> duration.", 1, 'the how-to bullet reads Internal / External'],
  ["(tradeBasis === 'ext' ? 'external' : 'internal')", 1, 'the trade-sequence caption names the live basis in the new words'],
];
LABELS.forEach(([needle, n, msg]) => eq((src.split(needle).length - 1), n, msg));

ok(src.indexOf("label: 'Interior (d)'") < 0 && src.indexOf("label: 'Exterior (d)'") < 0,
   'no Interior/Exterior COLUMN LABEL survives anywhere');

// ⚠⚠ THE STORED SHAPE IS UNTOUCHED. This is a label change: `durInt`/`durExt` are the field
//    names every reader, the push and every saved setup use, and 'int'/'ext' are the basis
//    values. Renaming either would be a data migration wearing a typography change's clothes.
ok(src.indexOf('durInt') > 0 && src.indexOf('durExt') > 0, 'durInt / durExt field names are untouched');
ok(/\[\['int', 'Internal \(target\)'\], \['ext', 'External \(contract\)'\]\]/.test(src),
   "the stacking's own basis values are still 'int' / 'ext'");

/* ⚠⚠ THREE ASSERTIONS WERE RETIRED HERE, AND THE SUBJECT THEY GUARDED NO LONGER EXISTS — which
   is a different thing from them having been wrong. They pinned the CSV template's own header row
   and the upload matcher's tolerance of the OLD `interior`/`exterior` spelling, so that a planner
   uploading a template downloaded before the rename would not silently read 0-day durations. Both
   were correct. The owner then asked for the surface itself: *"remove download template and upload
   excel buttons. no need for this"*, and the whole chain — `actTemplateCsv`, `parseCsv`,
   `importActivities`, `uploadActivities` — went with the two buttons that were its only callers.
   An assertion against a deleted function is a suite that cannot go green, so they are replaced by
   the stronger statement: the chain is gone WHOLE, not half-deleted, and nothing still calls it. */
/* ⚠ COUNTED IN CODE, NOT IN PROSE. The deletion note left at the old call site NAMES all four
   functions, so a raw scan over the file reports the comment that explains the removal as evidence
   the removal did not happen — a checker measuring its own explanation. `tools/scan.js` is this
   repo's own string- and comment-aware blanker, self-tested before any caller trusts it. */
const CODE = require('../../tools/scan.js').blankComments(src);
['actTemplateCsv', 'parseCsv', 'importActivities', 'uploadActivities'].forEach(function (fn) {
  eq((CODE.split(new RegExp('\\b' + fn + '\\b')).length - 1), 0,
     'the CSV template / upload chain is gone whole — no trace of ' + fn + ' in code');
});
ok(src.indexOf('id="b-tmpl"') < 0 && src.indexOf('id="b-upl"') < 0,
   '…and neither button that called it survives to throw on a missing handler');

// ⚠⚠ The legitimate survivors, named so a future sweep does not "fix" them. Each is a
//    DIFFERENT SUBJECT from the duration basis, and renaming it would make the file wrong.
const SURVIVORS = [
  ['PC Exterior Walls',   "Finance's own class-code chart name"],
  ['PC Interior Walls',   "Finance's own class-code chart name"],
  /* ⚠ `LD Exterior Lighting Works` WAS on this list and is not any more — not because the
     Interior/Exterior sweep took it, but because the owner retired class code 39350 outright on
     2026-09-17 along with the other six LD sub-works. Dropped from the guard rather than the guard
     being weakened: the five below still carry "Interior"/"Exterior" for reasons that have nothing
     to do with a duration basis, and this suite still fails if a sweep renames any of them. */
  ['exterior concrete',   'WEATHER EXPOSURE, not the duration basis'],
  ['interior fit-out',    'WEATHER EXPOSURE, not the duration basis'],
  ['Exterior Wall Complete', "verbatim from the LSM training deck's own chart"],
];
SURVIVORS.forEach(([needle, why]) => ok(src.indexOf(needle) >= 0,
  'LEFT ALONE deliberately (' + why + '): ' + needle));

/* ==========================================================================================
   3 · ITEM 3 — the grid drops a rung of the shared type scale
   ========================================================================================== */
ok(/table\.sbld-xl \{ border-collapse:collapse; font-size:var\(--pd-fs-xs\);/.test(src),
   'the grid is on --pd-fs-xs (11px), one rung down from --pd-fs-sm');
ok(!/table\.sbld-xl \{[^}]*font-size:\s*1[01](\.\d)?px/.test(src),
   'and reaches for a RUNG, never a fresh literal');
ok(/table\.sbld-xl th, table\.sbld-xl td \{ border:1px solid var\(--pd-line\); padding:4px 7px;/.test(src),
   'cell padding tightens with the type (smaller type in the same box reads as a gap)');
ok(/table\.sbld-xl thead th \{[^}]*color:var\(--pd-muted\)/.test(src),
   'the header is muted, matching .pd-table th — it was competing with the data for the eye');
// ⚠ font:inherit on the cell controls is what carries the rung into every editable cell.
// ⚠⚠ RETARGETED, NOT WEAKENED: this used to pin the literal selector
// `table.sbld-xl input, table.sbld-xl select {`. That rule now excludes checkboxes
// (`input:not([type="checkbox"])`), because the bare `width:100%` in it was stretching the new
// gutter checkbox across its whole cell - the third time a text-field width rule has caught a
// checkbox in this app. The property under test is unchanged; only the selector moved.
ok(/table\.sbld-xl input:not\(\[type="checkbox"\]\), table\.sbld-xl select \{[^}]*font:inherit/.test(src),
   'the editable cells inherit the rung rather than restating it');

report();

function report() {
  if (fails.length) console.log(fails.map(f => '  FAIL ' + f).join('\n'));
  console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed'
    + (IS_BASE ? '  (contrast build)' : ''));
  process.exit(fail ? 1 : 0);
}
