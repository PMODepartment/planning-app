/* WHICH BRANCH AN ACTIVITY ENDS UP UNDER — executed, not read.
 *
 *   node modules/project-schedule/test-wbsfile.js
 *
 * Owner 2026-09-16, with the WBS tree open on a builder-pushed schedule: *"pls fix the logic of the
 * grouping or the WBS when generated from the schedule builder. as you can see there are activities
 * that do not fall in the correct location or zoning."*
 *
 * Three activities of ONE zone cannot be split by the builder's grouping: `dimKey` reads `r.loc`,
 * and every activity of a zone shares that object. So the split happened AFTER the push, and the
 * chain that does it is:
 *
 *   1 · the push inserts TWO nodes for one branch  (siblings in one batch are not deduped against
 *       each other, because `existingChild` reads `WBS_NODES` and that is not written until the
 *       insert returns);
 *   2 · `_wbsDedupeSiblingNodes` merges them on the next load — correctly — by moving the loser's
 *       activities onto the survivor, which changes `wbs_node_id` and NOT the dotted code;
 *   3 · `_wbsResyncCodes` then declines to look at activities at all, because its short-circuit
 *       assumed an activity can only drift when a SUMMARY row's code moved.
 *
 * So half a zone keeps a code addressing a branch that no longer exists, and `rebuild()` — which
 * derives the grid's hierarchy by SPLITTING that code — renders those rows after the last surviving
 * branch, detached from the zone their `wbs_node_id` says they are in.
 *
 * ⚠️⚠️ EVERY FUNCTION AND EVERY GUARD UNDER TEST IS READ OUT OF THE SHIPPED index.html. The rules
 *    that are functions are sliced by name and RUN; the two that are control flow inside a
 *    database-paging routine are asserted against the comment-blanked source, which is the only
 *    honest way to pin a branch that cannot be called without a server.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const scan = require('../../tools/scan.js');
const { makeSlicer } = require('./test-slice.js');

const BASE_SHA = 'daca9716';                 // the commit before this chain was closed
const PAGE = path.join(__dirname, 'index.html');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* ---- the source, with comments blanked: a rule inside a comment is not a rule -------------- */
function readSrc(src) {
  const mask = scan.blankComments(src);
  function between(a, b) {
    const i = mask.indexOf(a);
    if (i < 0) return null;
    const j = mask.indexOf(b, i);
    return j < 0 ? mask.slice(i) : mask.slice(i, j);
  }
  return { mask, between };
}

/* ---- the one rule that IS a function: what code a row should carry ------------------------- */
function buildWant(src) {
  const S = makeSlicer(src);
  try {
    return new Function(S.sliceFn('_wbsWantCodeFor') + ';return _wbsWantCodeFor;')();
  } catch (e) { return null; }
}

/* ---- and the sibling dedupe, replayed through the shipped key it uses ---------------------- */
/* ⚠️ `existingChild` is the function whose KEY the push's in-batch dedupe has to match. Sliced and
   run, so "keyed exactly as existingChild keys" is a test rather than a claim in a comment. */
function buildExistingChild(src) {
  const S = makeSlicer(src);
  return new Function('WBS_NODES', S.sliceFn('existingChild') + ';return existingChild;');
}

/* ========================================================================================== */
const src = fs.readFileSync(PAGE, 'utf8');
const R = readSrc(src);

/* ---- 1 · the re-sync must LOOK at activities, always --------------------------------------- */
{
  const body = R.between('async function _wbsResyncCodes()', 'var _dedupingByCode');
  ok(!!body, 'the re-sync is still where this suite thinks it is');
  /* ⚠️ ANCHORED TO THE START OF THE STATEMENT. `/all = all.concat(...)/` alone matches
     `if (0) all = all.concat(...)` too — the first mutation run against this suite survived it. */
  ok(/\n\s*all = all\.concat\(await page\(false\)\);/.test(body || ''),
     'the re-sync pages the ACTIVITIES, unconditionally');
  /* ⚠️⚠️ THE ASSERTION THE OWNER'S REPORT REDUCES TO. Gating that page on summary drift is the
     unsound short-circuit: a summary row cannot see an activity that was re-filed onto a different
     node while every branch kept its code. */
  ok(!/if \(_summaryDrift\)/.test(body || ''),
     'and never gates that on whether a SUMMARY row drifted');
  ok(/all = await page\(true\);/.test(body || ''), 'the summaries are still paged too');
}

/* ---- 2 · the push must not insert two nodes for one branch in one batch -------------------- */
{
  const body = R.between('for (var dep = 1; dep <= maxDepth', 'ROLL THE PARTIAL TREE BACK');
  ok(!!body, 'the node-insert loop is still where this suite thinks it is');
  /* ⚠️ The GUARD, anchored — not a mention of the map somewhere inside the branch. A first pass of
     this suite asserted only `/_pendingByKey\[_dk\]/`, which the store line satisfies on its own, so
     disabling the guard left the suite green. */
  ok(/\n\s*if \(_pendingByKey\[_dk\]\) \{/.test(body || ''),
     'siblings already queued in this batch are recognised, and that test is the guard');
  ok(/\n\s*_pendingByKey\[_dk\] = nd\.key;/.test(body || ''),
     'and every desc that IS queued registers itself under that key');
  ok(/nd\.sameAs = _pendingByKey\[_dk\]/.test(body || ''),
     'and the duplicate is folded onto the first desc rather than inserted again');
  ok(/if \(nd\.sameAs && keyToNodeId\[nd\.sameAs\]\) keyToNodeId\[nd\.key\] = keyToNodeId\[nd\.sameAs\]/
       .test(scan.blankComments(src)),
     'and resolved to that node id once the inserts are done');
  /* ⚠️ A folded desc must not write a second WBS-Summary row for one node — that is the
     "two rows for one wbs_node_id" duplication the push already guards elsewhere. */
  ok(/nd\.sameAs = _pendingByKey\[_dk\]; reused\[nd\.key\] = 1;/.test(body || ''),
     'and writes no second summary row for the same node');
}

/* ---- 3 · the insert response is matched by identity, never by position --------------------- */
{
  const body = R.between('var bres = await sb().from(\'wbs_nodes\').insert(slice_).select();',
                         'doneN += descs_.length;');
  ok(!!body, 'the match-back is still where this suite thinks it is');
  /* ⚠️⚠️ The positional path trusted PostgREST to return rows in payload order, and fell back to
     matching only when the response was SHORT — so a full-length REORDERED response was matched
     positionally and handed every branch a sibling's node id. */
  ok(!/bres\.data\[k2\]\.id/.test(body || ''),
     'no desc is matched to a returned row by its position');
  ok(!/bres\.data\.length === slice_\.length/.test(body || ''),
     'and a full-length response is not treated as a proof of order');
  ok(/pool\[pi\]\.parent_id \|\| null\) === \(want\.parent_id \|\| null\) && pool\[pi\]\.name === want\.name/.test(body || ''),
     'every desc is matched by (parent_id, name)');
}

/* ---- 4 · the dedupe key is the key `existingChild` itself uses ----------------------------- */
{
  const mk = buildExistingChild(src);
  const NODES = [
    { id: 'n1', parent_id: 'p', name: 'Z2', created_at: '1' },
    { id: 'n2', parent_id: 'p', name: ' z2 ', created_at: '2' },
    { id: 'n3', parent_id: null, name: 'Z2', created_at: '3' }
  ];
  const ec = mk(NODES);
  eq(ec('p', 'Z2').id, 'n1', 'existingChild: matches under the parent');
  eq(ec('p', ' z2 ').id, 'n1', 'existingChild: trims and lower-cases, so two spellings are one branch');
  eq(ec(null, 'Z2').id, 'n3', 'existingChild: a null parent is the top level, not a wildcard');
  /* ⚠️ The push's in-batch key must collide wherever this does, or the dedupe would let through a
     pair the database will then hold as two branches. */
  const dk = (p, n) => String(p || '') + '\u0000' + String(n == null ? '' : n).trim().toLowerCase();
  eq(dk('p', 'Z2'), dk('p', ' z2 '), 'the in-batch key collides on the same two spellings');
  ok(dk('p', 'Z2') !== dk(null, 'Z2'), 'and never across parents');
}

/* ---- 5 · the code a row should carry, run on the shipped rule ------------------------------ */
{
  const want = buildWant(src);
  ok(!!want, 'the target-code rule is a function this suite can run');
  if (want) {
    /* A builder-pushed activity is filed AT its node and carries exactly the node's code. */
    eq(want({ activity_type: 'Task', wbs: '4.2.1.7' }, '4.2.1.3.1'), '4.2.1.3.1',
       'a pushed activity takes its branch code outright — the misfiled row is refiled');
    /* ⚠️ An IMPORTED activity sits one level below its branch and keeps its own tail segment.
       Rewriting it to the branch code would collapse every activity in a branch onto one code,
       which rebuild() then reads as ancestry — 16,393 rows on the measured project. */
    eq(want({ activity_type: 'Task', wbs: '4.2.3.9.5' }, '4.2.3.1'), '4.2.3.1.5',
       'an imported activity keeps its own tail segment');
    eq(want({ activity_type: 'WBS Summary', wbs: '4.2.1.9' }, '4.2.1.3'), '4.2.1.3',
       'a summary row IS its node');
    eq(want({ activity_type: 'Task', wbs: '4.2.1.3.1' }, '4.2.1.3.1'), '4.2.1.3.1',
       'a row already in the right place is unchanged');
    eq(want({ activity_type: 'Task', wbs: '4.2.1.7' }, null), null,
       'a row whose node has no code is left alone');
  }
}

/* ---- 6 · the gate in front of the whole chain must SEE a re-filed activity ----------------- */
{
  const S = makeSlicer(src);
  const mk = new Function('rows', 'WBS_NODES', 'isWbs',
    S.sliceVarLine('_HEAL_SIG_V') + S.sliceFn('_hash32') + S.sliceFn('_healFingerprint') +
    ';return _healFingerprint;');
  const isWbs = r => r.activity_type === 'WBS Summary';
  const NODES = [{ id: 'n1', parent_id: 'p', sort_order: 0, code: null },
                 { id: 'n2', parent_id: 'p', sort_order: 1, code: null }];
  const base = [{ activity_type: 'WBS Summary', wbs: '4.1', wbs_node_id: 'n1' },
                { activity_type: 'Task', wbs: '4.1', wbs_node_id: 'n1' }];
  const moved = [{ activity_type: 'WBS Summary', wbs: '4.1', wbs_node_id: 'n1' },
                 { activity_type: 'Task', wbs: '4.1', wbs_node_id: 'n2' }];
  const drift = [{ activity_type: 'WBS Summary', wbs: '4.1', wbs_node_id: 'n1' },
                 { activity_type: 'Task', wbs: '4.9', wbs_node_id: 'n1' }];
  const f = rs => mk(rs, NODES, isWbs)();
  /* ⚠️⚠️ Both of these leave every SUMMARY row and every NODE untouched — which is precisely the
     shape the old signature could not see, so the repair chain was skipped and the project stayed
     broken load after load. */
  ok(f(base) !== f(moved), 'an activity re-filed onto another node moves the signature');
  ok(f(base) !== f(drift), 'and so does an activity whose dotted code drifted');
  ok(/^v2\./.test(f(base)), 'the signature carries its version, so widening it re-runs the repairs once');
}

/* ---- 7 · THE CONTRAST: the pinned base must show all three holes --------------------------- */
{
  let base = null;
  try {
    base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
      { cwd: path.join(__dirname, '..', '..'), maxBuffer: 268435456 }).toString('utf8');
  } catch (e) { base = null; }
  if (!base) {
    console.log('CONTRAST SKIPPED: could not read ' + BASE_SHA + ' - a green run here proves less.');
  } else {
    const B = readSrc(base);
    const rs = B.between('async function _wbsResyncCodes()', 'var _dedupingByCode');
    ok(/if \(_summaryDrift\)/.test(rs || ''),
       'BASE: the re-sync looks at activities only if a SUMMARY row drifted - the reported defect');
    const ins = B.between('for (var dep = 1; dep <= maxDepth', 'ROLL THE PARTIAL TREE BACK');
    ok(!/_pendingByKey/.test(ins || ''),
       'BASE: two descs for one branch are both inserted');
    ok(/bres\.data\[k2\]\.id/.test(ins || ''),
       'BASE: and a full-length response is matched by position');
    ok(!buildWant(base), 'BASE: the target-code rule is buried in a paging loop, unrunnable');
    /* ⚠️⚠️ And the gate in front of the whole chain was blind to it too, which is why the project
       stayed broken across loads rather than healing on the next one. */
    const BS = makeSlicer(base);
    const bmk = new Function('rows', 'WBS_NODES', 'isWbs',
      BS.sliceFn('_hash32') + BS.sliceFn('_healFingerprint') + ';return _healFingerprint;');
    const bIsWbs = r => r.activity_type === 'WBS Summary';
    const bNodes = [{ id: 'n1', parent_id: 'p', sort_order: 0, code: null },
                    { id: 'n2', parent_id: 'p', sort_order: 1, code: null }];
    const bBase = [{ activity_type: 'WBS Summary', wbs: '4.1', wbs_node_id: 'n1' },
                   { activity_type: 'Task', wbs: '4.1', wbs_node_id: 'n1' }];
    const bMoved = [{ activity_type: 'WBS Summary', wbs: '4.1', wbs_node_id: 'n1' },
                    { activity_type: 'Task', wbs: '4.1', wbs_node_id: 'n2' }];
    eq(bmk(bBase, bNodes, bIsWbs)(), bmk(bMoved, bNodes, bIsWbs)(),
       'BASE: a re-filed activity does not move the signature, so the repairs never run');
  }
}

console.log('');
console.log('wbs filing: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log(''); fails.forEach(f => console.log('  ' + f)); process.exitCode = 1; }
