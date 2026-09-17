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



/* ================================================================================
   EXPOSURE OVER TIME — derived from the dates the register already stores.
   ⚠️ Owner 2026-09-17: everything on the dashboard was a snapshot. "Exposure ₱20.70M" says
   nothing about whether it is up or down, which is the first thing anyone asks. */
const AK = ['eval_amount', 'sub_amount'];
function at(rows, iso) { return PDClaims.exposureAt(rows, iso, AK, 'sub_amount', 'approved_amount'); }

{
  /* One change order: submitted 1 Mar, approved 1 Jun at 60 of 100 claimed. */
  const rows = [{ id: '1', record_type: 'Change Order', status: 'Approved',
                  date_submitted: '2026-03-01', date_approved: '2026-06-01',
                  sub_amount: 100, approved_amount: 60 }];
  eq(at(rows, '2026-02-28').total, 0, 'series: before it was submitted, nothing is exposed');
  eq(at(rows, '2026-03-31').pending, 100, 'series: once submitted it is pending at its claimed value');
  eq(at(rows, '2026-03-31').shortfall, 0, 'series: and nothing is cut while it is undecided');
  eq(at(rows, '2026-05-31').pending, 100, 'series: still pending the month before the decision');
  eq(at(rows, '2026-06-30').pending, 0, 'series: after the decision it stops being pending');
  eq(at(rows, '2026-06-30').shortfall, 40, 'series: and the 40 that was cut becomes shortfall');
  eq(at(rows, '2026-06-30').total, 40, 'series: exposure is pending + shortfall, as everywhere else');
}
{
  /* ⚠️ `eval_amount` wins over `sub_amount` while pending — the same key order the headline and
     the ageing bars use. A trend measured on a different basis from the figure above it is the
     mistake `valueOf` exists to prevent. */
  const rows = [{ id: '1', record_type: 'Claim', status: 'Pending',
                  date_submitted: '2026-01-05', sub_amount: 100, eval_amount: 70 }];
  eq(at(rows, '2026-03-31').pending, 70, 'series: a pending record is valued at eval over sub');
}
{
  /* ⚠️⚠️ A DECIDED RECORD WITH NO DECISION DATE IS UNDATABLE. We cannot say when it stopped being
     pending, so it is excluded and COUNTED — the same discipline the ageing band applies to a
     pending record that was never submitted. Assuming a date would draw a confident wrong line. */
  const rows = [{ id: '1', record_type: 'Claim', status: 'Approved',
                  date_submitted: '2026-01-05', sub_amount: 100, approved_amount: 80 }];
  const r = at(rows, '2026-06-30');
  eq(r.undated, 1, 'undated: it is counted');
  eq(r.total, 0, 'undated: and contributes nothing, rather than a guess');
}
{
  /* A disapproved record with only an evaluation date still has a knowable decision date. */
  const rows = [{ id: '1', record_type: 'Claim', status: 'Disapproved',
                  date_submitted: '2026-01-05', date_evaluated: '2026-02-10',
                  sub_amount: 100, approved_amount: 0 }];
  eq(PDClaims.decidedOn(rows[0]), '2026-02-10', 'disapproved: date_evaluated is the decision date');
  eq(at(rows, '2026-01-31').pending, 100, 'disapproved: pending in January');
  eq(at(rows, '2026-02-28').pending, 0, 'disapproved: decided by the end of February');
  eq(at(rows, '2026-02-28').shortfall, 100, 'disapproved: the whole claim is shortfall');
}
{
  /* ⚠️ MONTH ENDS, NOT MONTH STARTS. A record submitted on the 3rd and decided on the 20th of the
     same month never exists at either month start, and a series built on starts would draw a flat
     line through a month that was actually busy. */
  const rows = [{ id: '1', record_type: 'Claim', status: 'Approved',
                  date_submitted: '2026-04-03', date_approved: '2026-04-20',
                  sub_amount: 100, approved_amount: 90 }];
  const s6 = PDClaims.exposureSeries(rows, 6, AK, 'sub_amount', 'approved_amount', '2026-06-15');
  eq(s6.length, 6, 'series: six months returned');
  eq(s6[s6.length - 1].label, 'Jun 26', 'series: ending in the month `today` falls in');
  eq(s6[0].label, 'Jan 26', 'series: and starting five months before it');
  eq(s6[3].iso, '2026-04-30', 'series: each point is the LAST day of its month');
  eq(s6[3].shortfall, 10, 'series: the within-month decision is visible at the month end');
  eq(s6[2].total, 0, 'series: and March, before it was raised, is zero');
}
{
  /* February in a leap year is the Date object's problem, not ours. */
  const s2 = PDClaims.exposureSeries([], 3, AK, 'sub_amount', 'approved_amount', '2028-03-10');
  eq(s2[0].iso, '2028-01-31', 'monthends: January');
  eq(s2[1].iso, '2028-02-29', 'monthends: February in a leap year');
  eq(s2[2].iso, '2028-03-31', 'monthends: March');
}
{
  /* The year boundary: twelve months back from January lands in the previous year. */
  const s12 = PDClaims.exposureSeries([], 12, AK, 'sub_amount', 'approved_amount', '2027-01-20');
  eq(s12[0].label, 'Feb 26', 'monthends: twelve back from January is February of the year before');
  eq(s12[11].label, 'Jan 27', 'monthends: and the last point is January');
}

console.log('\nclaims: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  ' + fails.join('\n  ')); process.exit(1); }
