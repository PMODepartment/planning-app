/* PDClaims.agingBuckets — the shared ageing rule, loaded as the browser loads it.
 *
 * ⚠️ This file exists because `agingBuckets` is read by THREE screens — the Contracts & Claims
 * dashboard, the project dashboard's panel and the portfolio view — and the whole point of
 * `assets/js/claims.js` is that they cannot describe the register differently. A change here is a
 * change to all three at once.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* Loaded the way the page loads it: a real `window`, then the IIFE assigns onto it. Requiring a
   rewritten copy would test the rewrite. */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'claims.js'), 'utf8');
const win = {};
new Function('window', SRC)(win);
const PDClaims = win.PDClaims;
if (!PDClaims || !PDClaims.agingBuckets) throw new Error('claims.js did not export PDClaims.agingBuckets');

let pass = 0, fail = 0; const fails = [];
function ok(c, label) { if (c) pass++; else { fail++; fails.push(label); } }
function eq(got, want, label) {
  ok(got === want, label + '  (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}

const TODAY = '2026-09-17';
const AMT = ['eval_amount', 'sub_amount'];
function rec(over) {
  return Object.assign({
    id: 'r1', record_type: 'Change Order', status: 'Pending',
    date_submitted: '2026-09-10', sub_amount: 100
  }, over || {});
}

/* ------------------------------------------------ the row, not only the day count */
{
  /* ⚠️ Owner 2026-09-17, on the Contracts & Claims dashboard: "oldest 45 days" named no record, so
     the one actionable thing the figure supports — go and chase THAT one — meant scrolling the
     register and sorting it by hand. */
  const rows = [
    rec({ id: 'a', reference_no: 'COP-001', date_submitted: '2026-09-10' }),   // 7d
    rec({ id: 'b', reference_no: 'COP-002', date_submitted: '2026-08-03' }),   // 45d
    rec({ id: 'c', reference_no: 'COP-003', date_submitted: '2026-09-15' })    // 2d
  ];
  const ag = PDClaims.agingBuckets(rows, AMT, TODAY);
  eq(ag.oldest, 45, 'oldest: the day count is still what it was');
  ok(!!ag.oldestRow, 'oldest: and the row is returned alongside it');
  eq(ag.oldestRow && ag.oldestRow.reference_no, 'COP-002', 'oldest: it is the RIGHT row');
  eq(ag.n, 3, 'oldest: all three are counted as pending');
}
{
  /* ⚠️⚠️ A RECORD WITH NO SUBMITTED DATE HAS NO AGE AND MUST NOT WIN. It is waiting on US, not on
     the client — the rule this module states in as many words — and `agingOf` returns null for it.
     Letting a null slip through would have named the one record that is not the client's problem. */
  const rows = [
    rec({ id: 'a', reference_no: 'NO-DATE', date_submitted: null }),
    rec({ id: 'b', reference_no: 'COP-009', date_submitted: '2026-09-01' })    // 16d
  ];
  const ag = PDClaims.agingBuckets(rows, AMT, TODAY);
  eq(ag.unsent, 1, 'unsent: the dateless record is counted separately');
  eq(ag.oldest, 16, 'unsent: and does not become the oldest');
  eq(ag.oldestRow && ag.oldestRow.reference_no, 'COP-009', 'unsent: the dated one is named');
}
{
  /* A DECIDED record is not pending and cannot be the oldest thing with the client. */
  const rows = [
    rec({ id: 'a', reference_no: 'OLD-APPROVED', status: 'Approved', date_submitted: '2025-01-01' }),
    rec({ id: 'b', reference_no: 'COP-010', date_submitted: '2026-09-05' })    // 12d
  ];
  const ag = PDClaims.agingBuckets(rows, AMT, TODAY);
  eq(ag.oldest, 12, 'decided: a long-settled record does not age');
  eq(ag.oldestRow && ag.oldestRow.reference_no, 'COP-010', 'decided: the pending one is named');
}
{
  const ag = PDClaims.agingBuckets([], AMT, TODAY);
  eq(ag.oldest, null, 'empty: nothing pending, nothing oldest');
  eq(ag.oldestRow, null, 'empty: and no row, rather than undefined');
  eq(ag.buckets.length, 4, 'empty: all four buckets are still returned, so a chart keeps its axis');
}
{
  /* ⚠️ Ties: `a > oldest` keeps the FIRST of two equally old records rather than the last. Not a
     correctness question, but a stable answer is worth having — the header should not name a
     different record on each render of the same data. */
  const rows = [
    rec({ id: 'a', reference_no: 'FIRST', date_submitted: '2026-08-03' }),
    rec({ id: 'b', reference_no: 'SECOND', date_submitted: '2026-08-03' })
  ];
  const ag = PDClaims.agingBuckets(rows, AMT, TODAY);
  eq(ag.oldestRow && ag.oldestRow.reference_no, 'FIRST', 'ties: the first of two equally old wins, stably');
}

/* --------------------------------- the revised contract sum uses the shared rules */
{
  /* The Contracts & Claims dashboard computes `original + approved change orders`. ⚠️ APPROVED
     CHANGE ORDERS ONLY: a cost claim is a recovery against the existing sum, and anything still
     pending has altered nothing. Asserted here because the dashboard builds it out of these two
     helpers, and a change to either silently changes that headline. */
  const rows = [
    { id: '1', record_type: 'Change Order', status: 'Approved', approved_amount: 400 },
    { id: '2', record_type: 'Change Order', status: 'Pending', approved_amount: 999 },
    { id: '3', record_type: 'Change Order', status: 'Disapproved', approved_amount: 0 },
    { id: '4', record_type: 'Claim', status: 'Approved', approved_amount: 50 },
    { id: '5', record_type: 'EOT', status: 'Approved', approved_days: 30 }
  ];
  const cos = PDClaims.ofType(PDClaims.claimsOnly(rows), 'Change Order');
  const varn = PDClaims.sum(PDClaims.decided(cos), 'approved_amount');
  eq(varn, 400, 'variations: only APPROVED change orders move the contract sum');
  ok(PDClaims.decided(cos).length === 2,
     'variations: "decided" is approved + disapproved, so a rejected CO is judged and adds nothing');
}

console.log('\nclaims: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
