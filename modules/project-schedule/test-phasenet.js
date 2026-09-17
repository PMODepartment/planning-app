/* Project Phases: the relationship network behind the per-phase Gantt.
   ------------------------------------------------------------------------------------------
   Run:  node modules/project-schedule/test-phasenet.js [path/to/index.html]
   Contrast: pass a second path to a pre-change copy and the equivalence block runs against it.

   ⚠️⚠️ EVERYTHING HERE IS SLICED OUT OF THE SHIPPED FILE AND EXECUTED. Nothing is
   re-implemented: a hand-copied copy of the arithmetic tests the copy, which this repo has
   already been bitten by. A slice that comes back null ABORTS rather than comparing nothing.  */
var fs = require('fs'), path = require('path');
var FILE = process.argv[2] || path.join(__dirname, 'index.html');
var BASE = process.argv[3] || null;

function sliceFn(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) i = src.indexOf('async function ' + name + '(');
  if (i < 0) return null;
  var j = src.indexOf('{', i), depth = 0, inS = null, inC = null;
  for (var k = j; k < src.length; k++) {
    var c = src[k], n = src[k + 1];
    if (inC) { if (inC === '//' && c === '\n') inC = null; else if (inC === '/*' && c === '*' && n === '/') { inC = null; k++; } continue; }
    if (inS) { if (c === '\\') { k++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inC = '//'; k++; continue; }
    if (c === '/' && n === '*') { inC = '/*'; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  return null;
}

var DEPS = "\n var SB_PHASE_DEFS=[{v:'initiation',when:'before'},{v:'planning',when:'before'}," +
           "{v:'construction',when:'exec'},{v:'closeout',when:'after'}];\n" +
           " function addD(d,n){var x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;}\n" +
           " function sbPhActs(v){return (PH[v]&&PH[v].acts)||[];}\n" +
           " function sbPhases(){return PH;}\n" +
           " function sbPhOn(v){return !!(PH[v]&&PH[v].on&&PH[v].acts.length);}\n";

function build(src, fns, out, label) {
  var body = fns.map(function (n) {
    var f = sliceFn(src, n);
    if (!f) { console.log('ABORT: cannot slice ' + n + ' from ' + label); process.exit(1); }
    return f;
  }).join('\n');
  return new Function('PH', DEPS + body + '\n return {' + out + '};');
}

var SRC = fs.readFileSync(FILE, 'utf8');
var mkNew = build(SRC, ['sbPhLinks', 'sbPhSchedule', 'sbPhLinkWouldCycle', 'sbPhMaterialise', 'sbPhDays', 'sbPhasePlan'],
  'links:sbPhLinks,sched:sbPhSchedule,cycle:sbPhLinkWouldCycle,mat:sbPhMaterialise,days:sbPhDays,plan:sbPhasePlan', FILE);

var pass = 0, fail = 0, group = '';
function G(t) { group = t; console.log('\n' + t); }
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } }

function acts(sp) {   // "5,3p,2" -> durations; p = the legacy `par` flag
  return sp.split(',').map(function (t, i) {
    return { id: 'a' + i, n: 'A' + i, d: parseInt(t, 10), par: /p$/.test(t) };
  });
}
function P(v, a) { var o = {}; o[v] = { on: true, acts: a }; return o; }
var G0 = { start: new Date(2027, 2, 1), finish: new Date(2028, 5, 30), totalDays: 487 };
function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
var SHAPES = ['5', '5,3', '5,3p', '5,3p,2p', '5,3p,2p,7', '10,2p,9p,1,4p', '1,1,1,1',
              '30,20p,25p,10,5p,5p,5p', '7,7p', '2,9p,3', '99,1p', '4,4,4p,4p,4,4p'];

/* ---------------------------------------------------------------------------------------
   1 · The span is unchanged, and the after-block is unchanged, against the REAL pre-change file.
   ⚠️ This is the equivalence that had to hold: a phase nobody has drawn a link on must occupy
   the same window it always did, or every saved setup silently re-times.
   --------------------------------------------------------------------------------------- */
if (BASE && fs.existsSync(BASE)) {
  var OLD = fs.readFileSync(BASE, 'utf8');
  var mkOld = build(OLD, ['sbPhDays', 'sbPhasePlan'], 'days:sbPhDays,plan:sbPhasePlan', BASE);
  G('1 · equivalence with the group chain it replaced (contrast: ' + BASE + ')');
  SHAPES.forEach(function (sp) {
    ['initiation', 'planning', 'closeout'].forEach(function (v) {
      var A = mkOld(P(v, acts(sp))), B = mkNew(P(v, acts(sp)));
      ok(A.days(v) === B.days(v), 'span ' + v + ' [' + sp + ']: old ' + A.days(v) + ' new ' + B.days(v));
      var pa = A.plan(G0)[0], pb = B.plan(G0)[0];
      if (!pa || !pb) return;
      if (v === 'closeout') {
        // ⚠️ The after-block must be BYTE-IDENTICAL: nothing about it changed.
        pa.rows.forEach(function (r, k) {
          ok(iso(r.start) === iso(pb.rows[k].start) && iso(r.finish) === iso(pb.rows[k].finish),
             'after-phase row ' + k + ' [' + sp + ']');
        });
      } else {
        /* ⚠️ A before-phase still ENDS the day before execution starts and still occupies the
           same number of days. What moves inside it is asserted in block 2. */
        ok(iso(pb.finish) === iso(addDx(G0.start, -1)), 'before-phase finishes execStart-1 [' + sp + ']');
        ok(Math.round((pb.finish - pb.start) / 864e5) + 1 === A.days(v),
           'before-phase span matches old [' + sp + ']');
      }
    });
  });
} else {
  G('1 · equivalence  — SKIPPED (no contrast file given)');
}
function addDx(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

/* ---------------------------------------------------------------------------------------
   2 · The one deliberate behaviour change, asserted rather than left to be discovered.
   --------------------------------------------------------------------------------------- */
G('2 · concurrent activities START together, in BOTH directions');
['initiation', 'closeout'].forEach(function (v) {
  var pl = mkNew(P(v, acts('5,3p'))).plan(G0)[0];
  ok(iso(pl.rows[0].start) === iso(pl.rows[1].start),
     v + ': the 3-day concurrent row starts with its 5-day leader (' +
     iso(pl.rows[0].start) + ' vs ' + iso(pl.rows[1].start) + ')');
  ok(pl.rows[1].finish < pl.rows[0].finish, v + ': …and finishes early, which is what "alongside" means');
});

G('3 · a plain row follows the WHOLE concurrent group, not just its last member');
(function () {
  // 10 days, then 2 and 9 alongside it, then 1: the 1 must wait for the 10-day group, not the 9.
  var pl = mkNew(P('closeout', acts('10,2p,9p,1'))).plan(G0)[0];
  var grpFin = [0, 1, 2].reduce(function (m, i) { return pl.rows[i].finish > m ? pl.rows[i].finish : m; }, 0);
  ok(+pl.rows[3].start === +addDx(new Date(grpFin), 1),
     'the following row starts the day after the LONGEST member finishes');
})();

/* ---------------------------------------------------------------------------------------
   4 · The four relationship types and lag, each asserted on its own arithmetic.
   --------------------------------------------------------------------------------------- */
G('4 · FS / SS / FF / SF and lag');
function net(spec, preds) {
  var a = acts(spec); a.forEach(function (x) { delete x.par; });
  Object.keys(preds).forEach(function (i) { a[+i].preds = preds[i]; });
  return a;
}
function sc(a) { return mkNew(P('closeout', a)).sched('closeout'); }
(function () {
  var s = sc(net('5,3', { 1: [{ id: 'a0', type: 'FS', lag: 0 }] }));
  ok(s.es.a1 === 5, 'FS+0: successor starts the day after (es ' + s.es.a1 + ', want 5)');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'FS', lag: 2 }] }));
  ok(s.es.a1 === 7, 'FS+2: two days of lag (es ' + s.es.a1 + ', want 7)');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'FS', lag: -2 }] }));
  ok(s.es.a1 === 3, 'FS-2: negative lag overlaps (es ' + s.es.a1 + ', want 3)');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'SS', lag: 0 }] }));
  ok(s.es.a1 === 0 && s.ef.a1 === 2, 'SS+0: starts together, finishes on its own duration');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'SS', lag: 2 }] }));
  ok(s.es.a1 === 2, 'SS+2');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'FF', lag: 0 }] }));
  ok(s.ef.a1 === 4 && s.es.a1 === 2, 'FF+0: finishes together (ef ' + s.ef.a1 + ', es ' + s.es.a1 + ')');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'FF', lag: 3 }] }));
  ok(s.ef.a1 === 7, 'FF+3');
  s = sc(net('5,3', { 1: [{ id: 'a0', type: 'SF', lag: 4 }] }));
  ok(s.ef.a1 === 4, 'SF+4: successor FINISHES 4 days after the predecessor STARTS');
  // the max over several incoming links
  s = sc(net('5,10,2', { 2: [{ id: 'a0', type: 'FS', lag: 0 }, { id: 'a1', type: 'FS', lag: 0 }] }));
  ok(s.es.a2 === 10, 'two predecessors: the later one drives (es ' + s.es.a2 + ', want 10)');
  // a negative lag that would start the phase before day 0 is shifted, not left negative
  s = sc(net('5,5', { 0: [{ id: 'a1', type: 'SS', lag: -3 }] }));
  var lo = Math.min(s.es.a0, s.es.a1);
  ok(lo === 0, 'the earliest start is normalised to day 0 (got ' + lo + ')');
})();

/* ---------------------------------------------------------------------------------------
   5 · Drawing the FIRST link must not silently re-time the phase.
   ⚠️ This is the property that makes the implicit/explicit split safe: materialising the
   legacy order+par chain into real links has to be a no-op on the dates.
   --------------------------------------------------------------------------------------- */
G('5 · materialising the implicit chain does not move a single date');
SHAPES.forEach(function (sp) {
  ['initiation', 'closeout'].forEach(function (v) {
    var before = mkNew(P(v, acts(sp))).plan(G0)[0];
    var ph = P(v, acts(sp)), api = mkNew(ph);
    ok(api.mat(v) === true, 'materialise reports it converted [' + sp + ' ' + v + ']');
    var after = api.plan(G0)[0];
    var same = before.rows.every(function (r, k) {
      return iso(r.start) === iso(after.rows[k].start) && iso(r.finish) === iso(after.rows[k].finish);
    });
    ok(same, 'dates unchanged across materialisation [' + sp + ' ' + v + ']');
    ok(ph[v].acts.every(function (a) { return a.par === undefined; }),
       '`par` is cleared, so the flag and the links cannot both claim to describe the sequence');
    ok(api.mat(v) === false, 'materialise is a no-op the second time [' + sp + ']');
  });
});
(function () {
  /* ⚠️⚠️ DELETING THE LAST LINK MUST NOT RESURRECT THE IMPLICIT CHAIN. Without the
     `net` marker this test fails: a converted phase with no arrows left reads as a legacy phase
     again, so the dependency the planner just deleted comes straight back and the bar jumps. */
  var ph = P('closeout', acts('5,3'));
  var api = mkNew(ph);
  api.mat('closeout');
  ok(ph.closeout.net === true, 'materialising marks the phase as a network');
  ok(api.sched('closeout').es.a1 === 5, 'converted: a1 still follows a0');
  delete ph.closeout.acts[1].preds;                       // the planner deletes the only arrow
  ok(api.links('closeout').length === 0, 'with the arrow gone there are no links left');
  ok(api.sched('closeout').es.a1 === 0, 'a1 is genuinely independent — the deleted link stays deleted');
})();
(function () {
  // …and it must never overwrite arrows a planner has already drawn.
  var a = net('5,3', { 1: [{ id: 'a0', type: 'SS', lag: 1 }] });
  var ph = P('closeout', a);
  ok(mkNew(ph).mat('closeout') === false, 'materialise refuses a phase that already has links');
  ok(a[1].preds[0].type === 'SS' && a[1].preds[0].lag === 1, '…and leaves them exactly as drawn');
})();

/* ---------------------------------------------------------------------------------------
   6 · A cycle must be refused at draw time, and must not hang if one arrives anyway.
   --------------------------------------------------------------------------------------- */
G('6 · cycles');
(function () {
  var a = net('5,3,2', { 1: [{ id: 'a0', type: 'FS', lag: 0 }], 2: [{ id: 'a1', type: 'FS', lag: 0 }] });
  var api = mkNew(P('closeout', a));
  ok(api.cycle('closeout', 'a2', 'a0') === true, 'a2 -> a0 closes the loop and is refused');
  ok(api.cycle('closeout', 'a0', 'a2') === false, 'a0 -> a2 is a legal extra link');
  ok(api.cycle('closeout', 'a0', 'a0') === true, 'an activity cannot depend on itself');
  // a cyclic network arriving some other way terminates and reports
  var b = net('5,3', { 0: [{ id: 'a1', type: 'FS', lag: 0 }], 1: [{ id: 'a0', type: 'FS', lag: 0 }] });
  var t0 = Date.now(), s = mkNew(P('closeout', b)).sched('closeout');
  ok(Date.now() - t0 < 500, 'a cyclic network terminates rather than hanging');
  ok(s.cycle.length === 2, 'both members are reported as unschedulable (got ' + s.cycle.length + ')');
  ok(s.days > 0, '…and the phase still reports a span rather than NaN');
})();

/* ---------------------------------------------------------------------------------------
   7 · A stale link — one naming an activity that has been deleted — constrains nothing.
   --------------------------------------------------------------------------------------- */
G('7 · stale links');
(function () {
  var a = net('5,3', { 1: [{ id: 'GONE', type: 'FS', lag: 0 }] });
  var s = mkNew(P('closeout', a)).sched('closeout');
  ok(s.es.a1 === 0, 'a link to a deleted activity schedules against nothing rather than throwing');
})();

/* ---------------------------------------------------------------------------------------
   8 · What the PUSH writes into `predecessors`.
   ⚠️⚠️ The old push chained every row onto the one before it with a bare FS — including a row
   the DATES placed alongside its neighbour. So a pushed phase arrived with its dates and its
   logic contradicting each other, and the schedule's own CPM believes the logic.
   --------------------------------------------------------------------------------------- */
G('8 · the pushed predecessor string');
var PUSH_DEPS =
  " var PHASE_LABELS={initiation:'Initiation Phase',planning:'Planning Phase',construction:'Execution Phase',closeout:'Close-out Phase'};\n" +
  " var pid='P1', UID='U1', usePkg=null;\n" +
  " function uniqId(p){ return p; }\n" +
  " function iso2(d){ return d? d.toISOString().slice(0,10):null; }\n";
function pushRunner(src, label, isNew) {
  var fns = isNew
    ? ['serializeRels', 'sbPhLinks', 'sbPhSchedule', 'sbPhDays', 'sbPhasePlan', '_phIdFor', '_phLinksFor', 'phaseTaskPayload']
    : ['sbPhDays', 'sbPhasePlan', 'phaseTaskPayload'];
  var body = fns.map(function (n) {
    var f = sliceFn(src, n);
    if (!f) { console.log('ABORT: cannot slice ' + n + ' from ' + label); process.exit(1); }
    return f;
  }).join('\n');
  var pre = isNew ? ' var _phIds={}; var _phLinkMap=null;\n' : ' var _phPrevId={};\n';
  return new Function('PH', 'G', DEPS + PUSH_DEPS + pre + body +
    "\n var plan = sbPhasePlan(G), tasks = [];" +
    "\n plan.forEach(function(pp){ pp.rows.forEach(function(r,i){ tasks.push({k:'PH_'+pp.v, v:pp.v, r:r, i:i}); }); });" +
    (isNew ? "\n tasks.forEach(function(t){ _phIdFor(t); });" : "") +
    "\n return tasks.map(function(t){ var p = phaseTaskPayload(t);" +
    "   return {id:p.activity_id, pred:p.predecessors, s:p.start_date, e:p.end_date}; });");
}
var pushNew = pushRunner(SRC, FILE, true);
(function () {
  var out = pushNew(P('closeout', acts('5,3,2')), G0);
  ok(out.length === 3 && !out[0].pred, 'a legacy phase: the first activity has no predecessor');
  ok(out[1].pred === out[0].id && out[2].pred === out[1].id,
     '…and the rest still chain, so a phase nobody drew on does not push zero logic');
  out = pushNew(P('closeout', acts('5,3p')), G0);
  ok(/SS/.test(out[1].pred || ''), 'a concurrent legacy row is pushed as SS (' + out[1].pred + ')');
  ok(out[1].s === out[0].s, '…and its pushed start equals its neighbour’s, which is what SS means');
})();
(function () {
  var a = acts('5,3,4'); a.forEach(function (x) { delete x.par; });
  a[1].preds = [{ id: 'a0', type: 'SS', lag: 2 }];
  a[2].preds = [{ id: 'a0', type: 'FS', lag: 0 }, { id: 'a1', type: 'FF', lag: -1 }];
  var ph = P('closeout', a); ph.closeout.net = true;
  var out = pushNew(ph, G0);
  ok(/SS\+2/.test(out[1].pred || ''), 'SS+2 survives the push (' + out[1].pred + ')');
  ok((out[2].pred || '').split(',').length === 2, 'both predecessors are written (' + out[2].pred + ')');
  ok(/FF-1/.test(out[2].pred || ''), 'a negative lag survives (' + out[2].pred + ')');
})();
(function () {
  /* ⚠️ A link can point FORWARD, which the old chain could not express at all — so the id has to
     exist before the earlier row's payload is built. */
  var a = acts('5,3'); a.forEach(function (x) { delete x.par; });
  a[0].preds = [{ id: 'a1', type: 'SS', lag: 0 }];
  var ph = P('closeout', a); ph.closeout.net = true;
  var out = pushNew(ph, G0);
  ok(!!out[0].pred && out[0].pred.indexOf(out[1].id) === 0,
     'a forward link resolves (' + out[0].pred + ')');
})();
(function () {
  var a = acts('5,3'); a.forEach(function (x) { delete x.par; });
  a[1].preds = [{ id: 'GONE', type: 'FS', lag: 0 }];
  var ph = P('closeout', a); ph.closeout.net = true;
  ok(pushNew(ph, G0)[1].pred === null, 'a link to an activity outside the push is dropped, not written dangling');
})();
(function () {
  var out = pushNew({ initiation: { on: true, acts: acts('4,3') }, closeout: { on: true, acts: acts('6,2') } }, G0);
  ok(out.length === 4 && !out[0].pred && !out[2].pred, 'each phase starts with an unlinked activity');
  ok(out[3].pred === out[2].id, '…and chains within itself only, never into the next phase');
})();
if (BASE && fs.existsSync(BASE)) {
  /* ⚠️ The contrast that makes block 8 mean something: HEAD wrote a bare FS onto a row it had
     just dated to start alongside its neighbour. */
  var pushOld = pushRunner(fs.readFileSync(BASE, 'utf8'), BASE, false);
  var o = pushOld(P('closeout', acts('5,3p')), G0);
  ok(o[1].pred === o[0].id && !/SS/.test(o[1].pred || ''),
     'CONTRAST: HEAD pushed a bare FS here (' + o[1].pred + ')');
  ok(o[1].s === o[0].s, 'CONTRAST: …while giving it the same start date — the dates and the logic disagreed');
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
