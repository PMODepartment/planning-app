/* The record form's two pure gatekeepers, SLICED from module.js and run.
 *
 * ⚠️⚠️ BOTH OF THESE CAN BREAK EVERY SAVE IN THE MODULE, which is why they are tested and the
 * rendering around them is not:
 *
 *   `_dropMissingNull`  decides whether a save survives a database that is missing a column.
 *                       It dropped only `null`, and the Responsible field (2026-09-17) sends
 *                       `owner_ids: []` and `owner: ''` — so before this change every save on a
 *                       database without that migration would have failed, including the
 *                       overwhelming majority that never touched the new field.
 *
 *   `ownerExtraOf`      is the inverse of `ownerText`. Get it wrong and every edit re-prepends the
 *                       resolved names onto an already-name-bearing string: "Alvarez; Alvarez;
 *                       Cruz" after three saves. That exact bug was reported on the Issues
 *                       register's champion field and then reproduced when the pattern was copied
 *                       to Minutes of Meeting.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const scan = require('../../tools/scan.js');

const SRC = fs.readFileSync(path.join(__dirname, 'module.js'), 'utf8');
const mask = scan.blankComments(SRC);
const BS = String.fromCharCode(92);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const BT = String.fromCharCode(96);

function endOf(i) {
  let k = mask.indexOf('{', i), d = 0;
  for (; k < mask.length; k++) {
    const ch = mask[k];
    if (ch === DQ || ch === SQ || ch === BT) {
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
  const out = SRC.slice(i, endOf(i));
  try { new Function('return (' + out + ')'); }
  catch (e) { throw new Error('slice of ' + name + ' does not parse: ' + e.message); }
  return out;
}

let pass = 0, fail = 0; const fails = [];
function ok(c, label) { if (c) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

/* ---------------------------------------------------------------- the save gate */
const DROP = new Function(
  sliceFn('_isEmptyVal') + sliceFn('_dropMissingNull') + '; return _dropMissingNull;')();

/* The shape PostgREST actually returns for an unknown column. */
function pgErr(col) {
  return { message: "Could not find the '" + col + "' column of 'contracts_claims' in the schema cache" };
}
{
  const base = { owner_ids: [], owner: '', sub_amount: 100, package_id: null, remarks: '' };
  const a = DROP(base, pgErr('owner_ids'));
  ok(a && !('owner_ids' in a), 'drop: an EMPTY ARRAY is dropped, so the save survives');
  ok(a && a.sub_amount === 100, 'drop: and nothing else is touched');
  const b = DROP(base, pgErr('owner'));
  ok(b && !('owner' in b), 'drop: an EMPTY STRING is dropped too');
  const c = DROP(base, pgErr('package_id'));
  ok(c && !('package_id' in c), 'drop: null is still dropped — the original behaviour');
}
{
  /* ⚠️⚠️ A VALUE THAT WAS ACTUALLY ENTERED MUST STILL REFUSE. Dropping it would silently discard
     what the planner typed; `recordFailMsg` names the migration instead. This half is unchanged
     and it is the reason the widening above is safe. */
  const entered = { owner_ids: ['u-1'], owner: 'Alvarez', sub_amount: 100 };
  eq(DROP(entered, pgErr('owner_ids')), null, 'refuse: an assigned owner_ids refuses the save');
  eq(DROP(entered, pgErr('owner')), null, 'refuse: and so does a typed name');
  eq(DROP({ sub_amount: 100 }, pgErr('sub_amount')), null,
     'refuse: a pipeline figure is never dropped');
  eq(DROP({ sub_amount: 0 }, pgErr('sub_amount')), null,
     'refuse: ZERO is a figure, not an absence — it must not be treated as empty');
  eq(DROP({ approved_days: 0 }, pgErr('approved_days')), null,
     'refuse: nor is a zero-day extension');
}
{
  eq(DROP({ a: 1 }, { message: 'some unrelated failure' }), null,
     'drop: an error that names no column is not a missing column');
  eq(DROP({ a: 1 }, pgErr('not_in_payload')), null,
     'drop: a column that is not in the payload cannot be dropped');
}

/* ------------------------------------------------- the name round-trip */
const PEOPLE = [{ id: 'u-1', name: 'Alvarez' }, { id: 'u-2', name: 'Cruz' }];
const OWN = new Function('PEOPLE',
  sliceFn('peopleNamesOf') + sliceFn('ownerText') + sliceFn('ownerExtraOf') +
  '; return { text: ownerText, extra: ownerExtraOf };')(PEOPLE);

{
  eq(OWN.text(['u-1'], ''), 'Alvarez', 'text: a picked person renders as their name');
  eq(OWN.text([], 'The consultant QS'), 'The consultant QS',
     'text: someone with no account is carried by the free-text half');
  eq(OWN.text(['u-1'], 'The consultant QS'), 'Alvarez; The consultant QS',
     'text: and both together, joined');
  eq(OWN.text([], ''), '', 'text: nobody is an empty string, which the save gate above drops');
}
{
  /* ⚠️⚠️ THE ROUND TRIP. `owner` as stored is already `ownerText(ids, extra)`. Reopening the form
     must recover ONLY the typed extra, or the next save prepends the resolved name again. */
  const stored = { owner_ids: ['u-1'], owner: 'Alvarez; The consultant QS' };
  eq(OWN.extra(stored), 'The consultant QS',
     'roundtrip: the form recovers only the typed extra, not the resolved name');
  const again = OWN.text(stored.owner_ids, OWN.extra(stored));
  eq(again, stored.owner, 'roundtrip: so saving again reproduces the same string, not a longer one');
  const third = OWN.text(stored.owner_ids, OWN.extra({ owner_ids: stored.owner_ids, owner: again }));
  eq(third, stored.owner, 'roundtrip: and a third save still does — no creeping concatenation');
}
{
  /* Order-independent: the stored string may list the extra first. */
  const stored = { owner_ids: ['u-2'], owner: 'Someone Else; Cruz' };
  eq(OWN.extra(stored), 'Someone Else', 'roundtrip: the resolved name is stripped wherever it sits');
}
{
  /* ⚠️ A row saved BEFORE the roster existed has text and no ids. Everything must be kept — it is
     the only record of who was responsible. */
  eq(OWN.extra({ owner_ids: [], owner: 'Alvarez' }), 'Alvarez',
     'roundtrip: with no ids, the whole text is the extra');
  eq(OWN.extra({ owner_ids: null, owner: null }), '', 'roundtrip: and nothing is empty, not a crash');
  eq(OWN.extra(null), '', 'roundtrip: no record at all is empty too');
}
{
  /* ⚠️ An id whose person is no longer in the roster (account removed) resolves to nothing. The
     text must survive — it is the last remaining record of the name. */
  const stored = { owner_ids: ['u-gone'], owner: 'Departed Person' };
  eq(OWN.text(stored.owner_ids, 'x'), 'x', 'stale id: an unresolvable id contributes no name');
  eq(OWN.extra(stored), 'Departed Person', 'stale id: and the stored text is kept in full');
}

console.log('\ncc-record: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
