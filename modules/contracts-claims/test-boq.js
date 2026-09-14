#!/usr/bin/env node
/* =================================================================================================
   test-boq.js — a committed suite for modules/contracts-claims/boq.js
   -------------------------------------------------------------------------------------------------
   Run:  node modules/contracts-claims/test-boq.js
         node modules/contracts-claims/test-boq.js <path-to-a-boq.js>     (for a contrast build)

   ⚠️⚠️ WHY THIS FILE EXISTS. Three defects shipped in this module were found by DRIVING THE LIVE
   APP, not by a test, and every one of them was reachable from pure functions this file already
   exported. The changelog cites suites ("suite-namematch", 243 assertions) that were scratch files
   and are NOT in the repo, so none of it could be re-run by anyone. Concretely, 2026-09-14 (k):
   `applyTagPlan` hardcoded `overwrite = false`, so the Match-names screen wrote nothing for every
   already-coded activity — the exact population it was widened to serve — and reported "Only 0 of
   20 tagged", blaming RLS. That is a unit-testable bug that survived because there was no unit.

   ⚠️ IT EXECUTES THE SHIPPED FILE, it does not re-type it. boq.js is `window.BOQ = (function(){…})()`
   with an `_internals` export, so the real functions are reachable: load the file against a window
   stub (the runner below mirrors tools/wiring-check.js, for the reason stated there), then call
   `BOQ._internals`. `_set()` injects module state, so fixtures are real ITEMS/ACTS/CMAP rather than
   a copy of their shapes.

   ⚠️⚠️ AND IT SELF-TESTS FIRST. A checker that has never failed proves nothing, so before any
   assertion runs it re-injects the z6 outage (an `_internals` key naming a function that does not
   exist) into the real source and aborts unless the loader catches it. If that does not bite, the
   loader is not executing the file and nothing below means anything.
   ================================================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = process.argv[2] || path.join(__dirname, 'boq.js');
const SRC = fs.readFileSync(TARGET, 'utf8');

/* ---------------------------------------------------------------- the sandbox ---------------- */
function makeWindow(extra) {
  const noop = function () {};
  const chain = () => new Proxy(noop, { get: () => chain(), apply: () => chain() });
  const win = {
    document: new Proxy({}, {
      get(t, k) {
        if (k === 'readyState') return 'complete';
        return chain();
      },
    }),
    navigator: { userAgent: 'node', onLine: true },
    location: { href: 'https://x/y.html', pathname: '/y.html', search: '', hash: '', origin: 'https://x' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    setTimeout: (f) => { if (typeof f === 'function') f(); return 0; },
    clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    requestAnimationFrame: (f) => { if (typeof f === 'function') f(); return 0; },
    fetch: () => Promise.reject(new Error('no network in the suite')),
    APP_CONFIG: { SUPABASE_URL: 'https://stub', SUPABASE_ANON_KEY: 'stub' },
    Fmt: { esc: (s) => String(s == null ? '' : s), money: (n) => String(n), date: (s) => String(s) },
    UI: { toast: noop, modal: () => ({ el: chain(), close: noop }) },
    PDb: { selectAll: async () => [] },
    PDLoc: { normKey: (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''), contains: () => false },
    AppAuth: { user: () => ({ id: 'u1' }) },
  };
  Object.assign(win, extra || {});
  return win;
}

/* ⚠️ A browser exposes these as BARE globals, and `new Function` resolves a bare name against the
   real global scope rather than the `window` passed in — the trap tools/wiring-check.js records.
   One runner, used by the self-test and the suite alike, so they cannot diverge. */
function runScript(src, win) {
  return new Function(
    'window', 'self', 'globalThis', 'document', 'console', 'localStorage', 'sessionStorage',
    'navigator', 'location', 'matchMedia', 'addEventListener', 'fetch', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'alert', 'confirm',
    'prompt', 'APP_CONFIG', 'Fmt', 'UI', 'PDb', 'PDLoc', 'AppAuth', 'supabase', src)(
      win, win, win, win.document, { log: () => {}, warn: () => {}, error: () => {} },
      win.localStorage, win.sessionStorage, win.navigator, win.location, win.matchMedia,
      win.addEventListener, win.fetch, win.setTimeout, win.clearTimeout, win.setInterval,
      win.clearInterval, win.requestAnimationFrame,
      () => {}, () => true, () => null,
      win.APP_CONFIG, win.Fmt, win.UI, win.PDb, win.PDLoc, win.AppAuth,
      { createClient: () => win.__sb });
}

/* ------------------------------------------------------------- 0 · does it BITE? -------------- */
(function selfTest() {
  const broken = SRC.replace('_internals: {', '_internals: { locKey: locKey,');
  if (broken === SRC) {
    console.log('  SELFTEST INCONCLUSIVE: could not inject the z6 shape'); return;
  }
  let threw = null;
  const win = makeWindow();
  try { runScript(broken, win); } catch (e) { threw = e; }
  const caught = !!threw && /locKey is not defined/.test(threw.message) && win.BOQ === undefined;
  if (!caught) {
    console.log('  SELFTEST FAILED — the z6 shape was injected and this suite did not catch it.');
    console.log('  The loader is not executing the file. Nothing below can be trusted.');
    process.exit(2);
  }
  console.log('  self-test: z6 reproduced and caught (window.BOQ never assigned)  ok');
})();

/* ------------------------------------------------------------------ load it ------------------- */
const rpcCalls = [];
const toasts = [];
const win = makeWindow({
  __sb: {
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: (args.p_activity_ids || []).length, error: null }; },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
  },
});
win.UI = { toast: (m, k) => toasts.push({ m: String(m), k: k || '' }), modal: () => ({ el: {}, close: () => {} }) };
runScript(SRC, win);

if (!win.BOQ || !win.BOQ._internals) {
  console.log('FAIL: window.BOQ._internals was never assigned — the module did not load.');
  process.exit(1);
}
const I = win.BOQ._internals;

/* ------------------------------------------------------------------ assertions ---------------- */
let pass = 0; const fails = [];
function ok(c, what) { if (c) pass++; else fails.push(what); }
/* ⚠⚠ A BLOCK THAT THROWS MUST FAIL, NOT ABORT THE RUN. This repo has twice recorded a check
   that crashed instead of failing (a raw-dot read of a nested shape; a null regex match), and each
   time it took every assertion after it down with it. Every block runs inside this. */
const RUN = [];
function block(name, fn) { RUN.push({ name: name, fn: fn }); }
function eq(a, b, what) {
  if (a === b) pass++;
  else fails.push(what + '  (expected ' + JSON.stringify(b) + ')  [got: ' + JSON.stringify(a) + ']');
}

/* ===== 1 · THE WRITE PATH CARRIES THE OVERWRITE FLAG (2026-09-14 k) ============================ */
block('1 write path / overwrite flag', async function () {
  ok(typeof I.applyTagPlan === 'function', 'applyTagPlan is exported');
  ok(typeof I.tagRpc === 'function', 'tagRpc is exported');
  if (typeof I.applyTagPlan !== 'function') return;

  const plan = [{ code: '03051', hits: [{ a: { activity_id: 'A1' } }, { a: { activity_id: 'A2' } }] }];

  rpcCalls.length = 0;
  const off = await I.applyTagPlan(plan, null);
  eq(rpcCalls.length, 1, 'one RPC call per code');
  eq(rpcCalls[0].name, 'boq_tag_activities', 'it calls the security-definer RPC, not a plain update');
  /* ⚠️ The DEFAULT stays false: every other caller keeps the safer behaviour. */
  eq(rpcCalls[0].args.p_overwrite, false, 'with no flag the write does NOT overwrite');
  eq(off.wanted, 2, 'it counts what it asked for');

  rpcCalls.length = 0;
  await I.applyTagPlan(plan, null, true);
  /* ⚠️⚠️ THE BUG. This was a hardcoded `false`, so the Match-names screen could never retag an
     activity that already carried a code — the exact population it exists for. Measured live:
     0 of 20 written, while the same RPC returns 1 for the same row with the flag on. */
  eq(rpcCalls[0].args.p_overwrite, true, 'the flag reaches the RPC when asked for');
  eq(rpcCalls[0].args.p_class_code, '03051', 'and carries the code');
  ok(Array.isArray(rpcCalls[0].args.p_activity_ids), 'and the ids');

  /* A plan entry with no hits must not produce a call at all. */
  rpcCalls.length = 0;
  const empty = await I.applyTagPlan([{ code: 'X', hits: [] }], null, true);
  eq(rpcCalls.length, 0, 'a code with no activities issues no write');
  eq(empty.wanted, 0, 'and asks for nothing');
});

/* ===== 2 · THE SHORTFALL MESSAGE NAMES THE REAL CAUSES ======================================== */
block('2 shortfall message', async function () {
  ok(typeof I.reportTagged === 'function', 'reportTagged is exported');
  if (typeof I.reportTagged !== 'function') return;

  toasts.length = 0; I.reportTagged(3, 3, []);
  ok(/Tagged 3/.test(toasts[0].m), 'a complete write reports success');
  eq(toasts[0].k, 'success', 'and as a success');

  toasts.length = 0; I.reportTagged(0, 0, []);
  ok(/Nothing to tag/i.test(toasts[0].m), 'nothing asked for says so');

  toasts.length = 0; I.reportTagged(0, 20, []);
  const m = toasts[0].m;
  /* ⚠️⚠️ IT USED TO SAY "usually because somebody else imported this schedule" — and on DEMO01
     every one of the 20 was skipped because it already carried a code, which the comment above
     the function did not list among its "exactly two causes". */
  ok(/already/i.test(m) && /class code/i.test(m),
     'a shortfall names the already-coded cause, which was the common one');
  ok(/Nothing was skipped silently/i.test(m), 'and still promises nothing was hidden');
  eq(toasts[0].k, 'error', 'reported as an error, not a success');

  toasts.length = 0; I.reportTagged(0, 5, ['03051: boom']);
  ok(/failed/i.test(toasts[0].m), 'a real failure is reported as a failure, not a shortfall');
});

/* ===== 3 · THE MATCH-TO-SCHEDULE CAP REPORTS WHAT IT HIDES (2026-09-14 m) ====================== */
block('3 allocation row cap', async function () {
  /* ⚠️ STRUCTURAL, and labelled as such: the notice is emitted inside a render function this
     export does not reach. Measured live instead — 903 lines, 300 rendered, Structural Works and
     Site Works absent entirely. These assertions pin the mechanism so it cannot silently revert. */
  ok(/ALLOC_ROW_CAP/.test(SRC), 'the cap is a named constant, not a bare slice');
  ok(/_capHidden/.test(SRC), 'and what it holds back is computed');
  ok(/more not shown/.test(SRC), 'and stated on screen');
  ok(!/list\.slice\(0, 300\)\.forEach/.test(SRC), 'the bare unnamed slice is gone');
  ok(/use the search above/i.test(SRC), 'the notice names the way to reach a hidden line');
});

/* ===== 4 · THE MATCHING RULES ================================================================= */
block('4 matching rules', async function () {
  ok(typeof I.matchAct === 'function', 'matchAct is exported');
  if (typeof I.matchAct !== 'function') return;
  /* ⚠⚠ matchAct takes an ACTIVITY OBJECT and a CODE OBJECT and returns {score, why} or
     null — NOT two strings and a number. My first cut of this block passed strings and compared
     to a number: two of the three assertions failed, and the third PASSED FOR THE WRONG REASON —
     a string has no .activity_name, so normKey('') is '' and the empty-name guard returns null
     before the an.length > 6 rung it claimed to pin is ever reached. A null for the wrong cause
     is indistinguishable from a null for the right one. Signature read out of the shipped
     function, not assumed. */
  var act = function (n, wt) { return { activity_name: n, work_type: wt || '' }; };
  var code = function (l3, l2) { return { desc_l3: l3, desc_l2: l2 || '' }; };

  /* ⚠⚠ THE an.length > 6 GUARD, which is the whole of the 2026-09-11 (ue) finding: the
     schedule says "Rebar" (5 characters) and the bill says "Rebar Works", so rung 2 refuses it
     and the tagger reports "no name resembles it". Pinned with a REAL activity, so the null it
     returns is the guard's null. */
  eq(I.matchAct(act('Rebar'), code('Rebar Works')), null,
     'a 5-character name does NOT match on the containment rung');
  /* ⚠ And a longer name in the same shape DOES match — the control that proves the
     assertion above measures the length guard rather than anything else about these strings. */
  var seven = I.matchAct(act('Rebared'), code('Rebared Works'));
  ok(seven && seven.score === 0.85, 'a 7-character name clears it: ' + (seven && seven.score));

  var exact = I.matchAct(act('Rebar Works'), code('Rebar Works'));
  ok(exact && exact.score === 0.95, 'an exact name matches at 0.95');
  eq(exact && exact.why, 'names the item', 'and says which rung found it');
  /* ⚠ 'concrete' is 8 characters, so it clears the guard where 'Rebar' does not — the
     asymmetry (ue) measured, and the reason a threshold cannot fix the specificity gap. */
  var cont = I.matchAct(act('Concrete'), code('Ready Mix Concrete'));
  ok(cont && cont.score === 0.85, 'an 8-character name clears the guard at 0.85');
  eq(cont && cont.why, 'item names it', 'on the containment rung, not the exact one');
  /* ⚠ The trade rung is the one that fires when the NAME says nothing — asserted so a
     future change cannot quietly let a name-less match claim a name-based score. */
  var tr = I.matchAct(act('Mobilization', 'General Requirement'),
                      code('Rental of Flat Bed Truck', 'General Requirement'));
  ok(tr && tr.score === 0.6, 'trade matching the group scores 0.6');
  eq(I.matchAct(act(''), code('Rebar Works')), null, 'a blank activity name matches nothing');
  eq(typeof I.TAG_FLOOR, 'number', 'the confidence floor is a number');
  ok(I.TAG_FLOOR > 0 && I.TAG_FLOOR <= 1, 'and is a fraction');
});

/* ===== 5 · normKey KEEPS SPACES, AND IS NOT PDLoc.normKey ===================================== */
block('5 normKey', async function () {
  ok(typeof I.normKey === 'function', 'normKey is exported');
  if (typeof I.normKey !== 'function') return;
  /* ⚠️⚠️ 2026-09-11 (ue) recorded a harness that injected PDLoc.normKey here — which STRIPS every
     separator, so "Rebar Works" became one token and the whole-word rule matched nothing. The
     module has its own, and it keeps spaces. Asserted before anything that depends on it. */
  eq(I.normKey('Rebar Works'), 'rebar works', 'normKey keeps the space');
  ok(I.normKey('  Rebar   Works  ') === 'rebar works', 'and collapses whitespace');
});

/* ===== 6 · THE FOUR LINK STATES =============================================================== */
block('6 link states', async function () {
  ok(typeof I.lineLinkState === 'function', 'lineLinkState is exported');
  if (typeof I.lineLinkState !== 'function' || typeof I._set !== 'function') return;
  /* A preliminary: no activity carries its code AND its trade is absent from the programme. */
  I._set({
    pid: 'T1',
    ITEMS: [{ id: 'L1', item_no: '01051', description: 'Mobilization', line_kind: 'measured', sheet: 'General Requirement' }],
    ACTS: [{ activity_id: 'A1', activity_name: 'Rebar', class_code: '03051', work_type: 'Structural Works' }],
    CMAP: {}, ALLOC: [], CODES: [],
  });
  const st = I.lineLinkState({ id: 'L1', item_no: '01051', description: 'Mobilization', line_kind: 'measured' });
  ok(st && typeof st === 'object', 'it returns a state object');
  ok('kind' in st, 'carrying a kind');
});

/* ------------------------------------------------------------------ runner + report ------------
   ⚠⚠ THE REPORT MUST BE AWAITED PAST EVERY BLOCK. Measured on the first cut of this suite:
   block 1 is async, the report was top-level and synchronous, so 9 of 41 assertions — every one
   about the overwrite flag, which is the entire bug this file exists for — resolved AFTER the
   summary printed and were never counted. It reported "PASS: 32" while nine results were still
   pending; had all nine failed it would have said PASS just the same. A suite that cannot see its
   own assertions is worse than none. Blocks are registered, then awaited in order, then reported. */
(async function () {
  for (const b of RUN) {
    try { await b.fn(); }
    catch (e) { fails.push(b.name + ' THREW: ' + ((e && e.message) || e)); }
  }
  report();
})();

function report() {
console.log('\n=== ' + path.relative(process.cwd(), TARGET));
if (fails.length) {
  console.log('FAIL: ' + pass + ' assertions passed, ' + fails.length + ' failed');
  fails.forEach((f) => console.log('   x ' + f));
  process.exitCode = 1;
} else {
  console.log('PASS: ' + pass + ' assertions passed, 0 failed');
}
}
