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
const MOVER  = slice('      function _catLoad(ids) {', '      host.querySelector(\'#b-load\').onclick');
const WIRING = slice('      function _catLoad(ids) {', '      host.querySelector(\'#b-unload\')');

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
ok(/addEventListener\('drop'[\s\S]{0,420}?_catLoad\(ids\)/.test(WIRING),
   'the drop goes through the SAME _catLoad');

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
  const api = new Function('cfg', 'markDirty', 'render', `
    var catSel = ['c3', 'c1'];
    ${MOVER}
    return { load: _catLoad, ticked: function () { return catSel.slice(); } };
  `)(cfg, () => { dirty++; }, () => { renders++; });

  eq(api.load([]), false, 'an empty id list moves nothing and reports it');
  eq(api.load(['nope']), false, 'an id that is not in the list moves nothing');
  eq(dirty, 0, '… and neither marks the setup dirty');

  eq(api.load(['c2']), true, 'moving one code reports it moved');
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
  ['LD Exterior Lighting Works', "Finance's own class-code chart name"],
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
// ⚠ font:inherit on the cell controls is what carries the rung into every editable cell
ok(/table\.sbld-xl input, table\.sbld-xl select \{[^}]*font:inherit/.test(src),
   'the editable cells inherit the rung rather than restating it');

report();

function report() {
  if (fails.length) console.log(fails.map(f => '  FAIL ' + f).join('\n'));
  console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed'
    + (IS_BASE ? '  (contrast build)' : ''));
  process.exit(fail ? 1 : 0);
}
