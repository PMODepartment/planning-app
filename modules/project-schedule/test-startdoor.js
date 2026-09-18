/* THE START STEP'S THREE DOORS — slice-and-execute suite.
 *
 * Owner 2026-09-18: *"in step 1, hide first the option to allow importing of external schedules
 * first. Don't delete the codes for that but just hide it visually."*
 *
 * ⚠️⚠️ WHAT MAKES "HIDDEN, NOT DELETED" WORTH A SUITE. Hiding is the easy half; the half that rots
 *    is the promise that it comes BACK. A card left in the source but never rendered is read by
 *    nothing, so the next edit to `stStart` can break it silently and no screen will say so. The
 *    whole point of §2 below is that flipping one word puts the card back INTACT — asserted by
 *    executing the same shipped function twice, once under each value of the flag.
 *
 * ⚠️⚠️ AND THE STAGED-IMPORT CARD IS NOT BEHIND THE FLAG, DELIBERATELY. The module's own toolbar
 *    Import (`#ps-import`) still parses a file and calls `ScheduleBuilder.stageImport`, which lands
 *    the planner on these steps. A staged import is unsaved, session-only work: hiding the card
 *    that continues it would make it unreachable and lose it on the next reload — a tidy-up flag
 *    quietly destroying data. §3 holds that line.
 *
 * ⚠️ `stStart` is SLICED OUT OF THE SHIPPED index.html BY NAME and executed. The stubs are the
 *    document and the host element; every rule about which card appears is the shipped function's.
 *
 * Usage:  node modules/project-schedule/test-startdoor.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSlicer } = require('./test-slice.js');
const scan = require('../../tools/scan.js');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(__dirname, 'index.html');

/* ⚠️ PINNED, NEVER `HEAD` — `git show HEAD:` becomes self-comparison the moment this commits.
   This is the commit immediately before the flag existed. */
const BASE_SHA = '9f4c9860';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) pass++;
  else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}

const SRC = fs.readFileSync(PAGE, 'utf8');
const SRC_NC = scan.blankComments(SRC);

/* ---------------------------------------------------------------------------------------- */
/* The sandbox. `stStart` renders into a host and then wires it; the host answers null to every
   querySelector, which every wiring line below the innerHTML write already guards for — so the
   render is exercised without a DOM.                                                          */
/* ---------------------------------------------------------------------------------------- */
function render(src, opts) {
  opts = opts || {};
  const S = makeSlicer(src);
  const body = S.sliceFn('stStart');
  const host = { innerHTML: '', querySelector: function () { return null; } };
  /* ⚠️ `liveActs` counts non-WBS rows; `sbExecActs` is the execution-phase reading that decides
     whether the "read what is already here" door is offered at all. Both are the DOCUMENT, not a
     rule — which is why they are the only things handed in. */
  const fn = new Function(
    '"use strict";\n' +
    'var rows = ' + JSON.stringify(opts.rows || []) + ';\n' +
    'var imp = ' + (opts.imp ? JSON.stringify(opts.imp) : 'null') + ';\n' +
    'var cfg = { activities: [] };\n' +
    'var _exec = ' + (opts.exec || 0) + ';\n' +
    'function isWbs(r){ return !!r.wbs; }\n' +
    'function e2(s){ return String(s == null ? "" : s); }\n' +
    'function sbExecActs(){ var o = []; for (var i = 0; i < _exec; i++) o.push({}); return o; }\n' +
    'function _stepNo(){ return 1; }\n' +
    'function impPhaseTotals(){ return { dropped: 0, byTarget: {} }; }\n' +
    'function impLeaves(){ return [{}, {}]; }\n' +
    'function impBranches(){ return [{}]; }\n' +
    'var IMPORT_UI = ' + (opts.importUI ? 'true' : 'false') + ';\n' +
    body + '\n' +
    'return stStart;'
  )();
  fn(host);
  return host.innerHTML;
}

/* The flag as SHIPPED, read out of the file rather than assumed. */
const SHIPPED_FLAG = (function () {
  const m = SRC.match(/var IMPORT_UI = (true|false);/);
  return m ? m[1] : null;
})();

console.log('the Start step’s doors — the shipped stStart, executed\n');

/* ================= 1 · shipped: the import door is not on the screen ====================== */
{
  ok(SHIPPED_FLAG === 'false',
    '1.1  ⚠️ `IMPORT_UI` ships OFF — *"hide first the option to allow importing of external schedules"*',
    SHIPPED_FLAG);

  const h = render(SRC, { importUI: false });
  ok(h.indexOf('b-impfile') < 0,
    '1.2  …so the Choose-a-file button is not rendered at all', h.indexOf('b-impfile'));
  ok(h.indexOf('Import an existing programme') < 0,
    '1.3  …nor the card’s heading');
  /* ⚠️ THE LEDE IS THE PART THAT IS EASY TO FORGET, and it is the one that does the damage: a
     sentence naming a door that is not on the screen sends a planner hunting for a button. */
  const live = render(SRC, { importUI: false, rows: [{}, {}, { wbs: 1 }] });
  ok(live.indexOf('2</b> activities') > 0,
    '1.4  a project with a schedule still states how many activities it has', live.slice(0, 120));
  ok(live.indexOf('An import can replace them') < 0,
    '1.5  ⚠️ …but the lede no longer offers the import — the clause goes with the card');

  /* ⚠️ The grid is `1fr 1fr`. One card in it sits at half width beside a hole, which is exactly
     what a fresh project looks like with the import door off and nothing to read back. */
  ok(/class="ps-ck-grid one"/.test(h),
    '1.6  ⚠️ a LONE card collapses the grid to one column rather than sitting at half width');
  const withRead = render(SRC, { importUI: false, exec: 40 });
  ok(withRead.indexOf('b-modederive') > 0 && !/ps-ck-grid one/.test(withRead),
    '1.7  …and it does not when the "read what is already here" door is offered beside it');
}

/* ================= 2 · HIDDEN, NOT DELETED =============================================== */
/* ⚠️⚠️ THE ASSERTION THE OWNER ACTUALLY ASKED FOR: *"Don't delete the codes for that."* The SAME
   sliced function, run with the flag flipped, must produce the whole card — not a stub of it. */
{
  const h = render(SRC, { importUI: true });
  ok(h.indexOf('id="b-impfile"') > 0,
    '2.1  ⚠️⚠️ one word puts the button back — the card is hidden, not deleted');
  ok(h.indexOf('Import an existing programme') > 0,
    '2.2  …with its heading');
  ok(/Excel activity list[\s\S]*Primavera P6/.test(h),
    '2.3  …and its text intact, rather than a placeholder left where it used to be');
  ok(/ps-ck-grid"/.test(h) && !/ps-ck-grid one/.test(h),
    '2.4  …and with two cards the grid is a grid again');
  const live = render(SRC, { importUI: true, rows: [{}] });
  ok(live.indexOf('An import can replace them') > 0,
    '2.5  …and the lede offers it again, so the two cannot drift apart');

  /* The wiring is not behind a second flag — it is null-safe, which is what lets the card be
     left out of the DOM without touching the handler. */
  ok(/var fb = host\.querySelector\('#b-impfile'\);\s*\n\s*if \(fb\)/.test(SRC_NC),
    '2.6  ⚠️ the handler is guarded on the element existing, which is why hiding needs no second flag');
  ok(SRC.indexOf('var STEPS_IMP = [') > 0,
    '2.7  …and the whole import path (STEPS_IMP) is untouched');
}

/* ================= 3 · a staged import is reachable whatever the flag says ================ */
/* ⚠️⚠️ The toolbar can still stage one. Session-only, unsaved work — hiding the card that
   continues it would lose it on the next reload. */
{
  const staged = { fname: 'P6 export.xer' };
  const off = render(SRC, { importUI: false, imp: staged });
  ok(off.indexOf('Staged import') > 0,
    '3.1  ⚠️⚠️ a staged import is still announced with the flag OFF — it is unsaved session work');
  ok(off.indexOf('b-impgo') > 0 && off.indexOf('b-impdrop') > 0,
    '3.2  …with both ways out of it, continue and discard');
  ok(off.indexOf('P6 export.xer') > 0, '3.3  …named, so it is obvious WHICH file is parked');
  ok(/ps-import'\)\.onclick/.test(SRC_NC) && /ps-import-file'\)\.click\(\)/.test(SRC_NC),
    '3.4  …and the toolbar door that can create one is still wired, which is why 3.1 has to hold');
}

/* ================= 4 · the rail says what the step is ==================================== */
{
  ok(/var STEP_START = \{ t: 'Start', s: IMPORT_UI \?/.test(SRC),
    '4.1  ⚠️ the rail’s subtitle reads the flag — it used to promise "Import, or build new"');
  ok(/'Where the schedule comes from'/.test(SRC),
    '4.2  …and says what the step is for while the import door is off');
  /* ⚠️ The same class of stale label, one step along: "and the site plan" named a control behind
     SITE_PLAN_UI, which is off. Deliberately NOT gated on that flag — it is assigned ~6,000 lines
     below this literal and would read `undefined` here. True by accident is not true. */
  ok(!/s: 'How many, and the site plan'/.test(SRC),
    '4.3  ⚠️ and the Towers subtitle no longer names the site plan, which is behind a flag that is off');
  ok(/t: 'Towers', s: 'Types, and how many of each'/.test(SRC),
    '4.4  …it names what the step is for instead, which survives that flag coming back');
}

/* ================= 5 · the contrast build ================================================ */
/* ⚠️⚠️ A TEST THAT CANNOT FAIL IS NOT EVIDENCE. The pinned base must have none of this. */
{
  let base = null;
  try { base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }); }
  catch (e) { console.log('  (contrast build skipped — ' + BASE_SHA + ' not reachable)\n'); }

  if (base) {
    ok(base.indexOf('IMPORT_UI') < 0, '5.1  base ' + BASE_SHA + ' has no IMPORT_UI at all');
    /* Executed, not read: the base shows the import card unconditionally. */
    const h = render(base, { importUI: false });
    ok(h.indexOf('id="b-impfile"') > 0,
      '5.2  ⚠️⚠️ BASE: the import card renders even with the flag handed in as false — there was nothing reading it',
      h.indexOf('id="b-impfile"'));
    ok(h.indexOf('ps-ck-grid one') < 0,
      '5.3  …and the base has no one-column case, because it always had at least two cards');
  }
}

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
if (fail) { fails.forEach(function (f) { console.log('   x ' + f); }); process.exit(1); }
