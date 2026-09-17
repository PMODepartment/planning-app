/* Critical path at WBS level — the shipped roll-up and lookup, sliced and run.
 *
 * Owner 2026-09-17: *"can we have a feature to have the critical path also show up to WBS level."*
 * `computeCPM` sets `_critical` on ACTIVITIES only, and the pane dimmed every `.ps-sum` bracket in
 * critical mode — so the view that exists to answer "where is the critical work" faded out the
 * structure that says where.
 *
 * ⚠️ Both halves here are SLICED FROM index.html, never retyped: the roll-up block that rides along
 * with the span pass, and `wbsIsCritical`. A retyped copy would pass while the page stayed broken.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const scan = require('../../tools/scan.js');

const PAGE = path.join(__dirname, 'index.html');
const src = fs.readFileSync(PAGE, 'utf8');
const mask = scan.blankComments(src);

function endOf(i) {
  let k = mask.indexOf('{', i), d = 0;
  const BS = String.fromCharCode(92);
  for (; k < mask.length; k++) {
    const ch = mask[k];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; k++;
      while (k < mask.length && mask[k] !== q) { if (mask[k] === BS) k++; k++; }
      continue;
    }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (!d) return k + 1; }
  }
  throw new Error('unbalanced braces from ' + i);
}
function sliceFn(name) {
  const i = mask.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('SLICE FAILED: ' + name + ' — aborting rather than testing nothing');
  const out = src.slice(i, endOf(i));
  try { new Function('return (' + out + ')'); }
  catch (e) { throw new Error('slice of ' + name + ' does not parse: ' + e.message); }
  return out;
}
/* The roll-up is a statement inside rebuild(), not a function, so it is sliced by its opening
   line and matching brace. ⚠️ Anchored in the COMMENT-BLANKED source so the note above it — which
   quotes the same condition — cannot be matched instead of the code. */
function sliceBlock(anchor) {
  const i = mask.indexOf(anchor);
  if (i < 0) throw new Error('SLICE FAILED: ' + JSON.stringify(anchor));
  if (mask.indexOf(anchor, i + 1) >= 0) throw new Error('AMBIGUOUS anchor: ' + JSON.stringify(anchor));
  return src.slice(i, endOf(i));
}

const ROLLUP = sliceBlock('if (r._critical) {');
const LOOKUP = sliceFn('wbsIsCritical');

let pass = 0, fail = 0; const fails = [];
function ok(c, label) { if (c) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* Run the shipped roll-up over a fixture. `codes` is the dotted-code ancestry (self first),
   `nodes` the real-tree ancestry — exactly what the span pass hands it. */
function rollUp(rows) {
  const _critMap = {}, _critMapN = {};
  const run = new Function('rows', '_critMap', '_critMapN',
    'rows.forEach(function (r) { var codes = r.codes, nodes = r.nodes; ' + ROLLUP + ' });');
  run(rows, _critMap, _critMapN);
  return { _critMap, _critMapN };
}
function lookup(maps, w) {
  const fn = new Function('_critMap', '_critMapN', 'dcode',
    LOOKUP + '; return wbsIsCritical;')(maps._critMap, maps._critMapN, w => (w && w.wbs) || '');
  return fn(w);
}

/* ------------------------------------------------- the roll-up marks every ancestor */
{
  const maps = rollUp([
    { _critical: true,  codes: ['4.3.8.2', '4.3.8', '4.3', '4'], nodes: ['n-z2', 'n-6f', 'n-t1', 'n-root'] },
    { _critical: false, codes: ['4.1.1', '4.1', '4'],            nodes: ['n-f1', 'n-gr', 'n-root'] }
  ]);
  eq(maps._critMap['4.3.8.2'], true, 'rollup: the branch the critical activity sits on');
  eq(maps._critMap['4.3.8'], true, 'rollup: and its parent');
  eq(maps._critMap['4'], true, 'rollup: all the way to the top');
  eq(maps._critMap['4.1.1'], undefined, 'rollup: a branch with no critical work is NOT marked');
  eq(maps._critMap['4.1'], undefined, 'rollup: nor its parent');
  eq(maps._critMapN['n-z2'], true, 'rollup: the real tree is marked too');
  eq(maps._critMapN['n-root'], true, 'rollup: up to the root node');
  eq(maps._critMapN['n-f1'], undefined, 'rollup: and a clean node is left alone');
}
{
  /* ⚠️⚠️ A CRITICAL ACTIVITY WITH NO DATES STILL MARKS ITS BRANCH. The roll-up deliberately sits
     BEFORE the span merge, which skips any row with neither a start nor a finish — putting it after
     would have silently dropped exactly the rows most likely to be on a broken critical chain. */
  const maps = rollUp([{ _critical: true, codes: ['9.9'], nodes: ['n-x'] }]);
  eq(maps._critMap['9.9'], true, 'rollup: a dateless critical activity still marks its branch');
}
{
  const maps = rollUp([{ _critical: true, codes: [], nodes: [] }]);
  eq(Object.keys(maps._critMap).length, 0, 'rollup: an activity with no ancestry marks nothing');
}

/* ------------------------------------------------------ the lookup tries both keys */
{
  /* ⚠️ The case this exists for: imported dotted codes and the real WBS tree routinely disagree.
     A branch that answers to only ONE of them must still light up — the same rule wbsSpan uses. */
  const byCode = { _critMap: { '4.3': true }, _critMapN: {} };
  ok(lookup(byCode, { wbs: '4.3', wbs_node_id: 'n-nope' }) === true,
     'lookup: found by dotted code when the node id is unknown');

  const byNode = { _critMap: {}, _critMapN: { 'n-t1': true } };
  ok(lookup(byNode, { wbs: 'drifted', wbs_node_id: 'n-t1' }) === true,
     'lookup: found by node id when the code has drifted');

  const neither = { _critMap: { '4.1': true }, _critMapN: { 'n-f1': true } };
  ok(lookup(neither, { wbs: '4.3', wbs_node_id: 'n-t1' }) === false,
     'lookup: a branch in neither map is not critical');
  ok(lookup(neither, null) === false, 'lookup: and no row is not critical, rather than throwing');
}

/* ------------------------------- the dimming rule that caused the report is scoped */
{
  /* ⚠️⚠️ THIS IS THE ACTUAL BUG THE OWNER SAW. `.ps-gantt-pane.ps-critmode .ps-sum { opacity:.22 }`
     with no `:not(.ps-crit)` faded EVERY bracket, including the ones the critical chain runs
     through. Asserted against the stylesheet text because that one missing selector is the whole
     defect and it is invisible in any behavioural test of the roll-up above. */
  const css = scan.blankComments(src);
  ok(/\.ps-gantt-pane\.ps-critmode \.ps-sum:not\(\.ps-crit\)/.test(css),
     'css: a bracket dims only when nothing under it is critical');
  ok(!/\.ps-gantt-pane\.ps-critmode \.ps-sum,/.test(css),
     'css: the unconditional `.ps-sum,` dimming rule is gone');
  ok(/\.ps-sum\.ps-crit\s*\{[^}]*outline/.test(css),
     'css: and a critical bracket is outlined, not merely left undimmed');
  /* The bar and the grid row must both consult it, or the roll-up is computed and never shown. */
  ok(/var _sumCrit = \(critMode && wbsIsCritical\(r\)\)/.test(css),
     'wiring: the summary bar asks whether its branch is critical');
  ok(/isWbs\(r\) && wbsIsCritical\(r\)/.test(css),
     'wiring: and so does the grid row');
}

/* ================================================================================
   THE GANTT PANE ANSWERS THE SAME GESTURES AS THE GRID
   Owner 2026-09-17: *"should we allow to right click in the schedule?"* It already was - on the
   ACTIVITY GRID. The Gantt pane had no handler, so a right-click on a BAR fell through to the
   browser's own menu, which is what the owner's screenshot shows.
   ⚠️ Asserted structurally, and labelled as such: this is DOM event wiring on a pane that only
   exists in a real browser, so what a test can honestly check is that the listener is bound, that
   it reuses the GRID's menu rather than growing a second one, and that it still leaves empty space
   to the browser. The behaviour of `openRowMenu` itself is the grid's to prove. */
{
  const code = scan.blankComments(src);
  const NEEDLE = "gz.addEventListener('contextmenu'";
  ok(code.indexOf(NEEDLE) >= 0, 'ctx: the Gantt pane binds contextmenu');
  ok(code.indexOf(".ps-bar[data-id], .ps-sum[data-id], .ps-mile[data-id]") >= 0,
     'ctx: it resolves bars, brackets and milestones by data-id');
  const from = code.indexOf(NEEDLE);
  const body = from < 0 ? '' : code.slice(from, from + 1400);
  ok(body.indexOf('openRowMenu(e, r)') >= 0,
     "ctx: and opens the GRID's menu, not a second one of its own");
  ok(body.indexOf('if (!el) return;') >= 0,
     'ctx: a right-click on empty chart space is left to the browser');
  ok(body.indexOf('e.preventDefault()') > body.indexOf('if (!el) return;'),
     'ctx: preventDefault happens only AFTER a bar has been found');
  ok(body.indexOf('if (!_selSet.has(id))') >= 0,
     'ctx: selection follows the click the same way the grid does');
  ok(code.indexOf("host.addEventListener('contextmenu'") >= 0,
     'ctx: and the grid still has its own handler, or "the same menu" means nothing');
}

console.log('\ncritical-path-wbs: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
