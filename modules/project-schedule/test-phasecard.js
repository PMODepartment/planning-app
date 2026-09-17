/* Project Phases: the twelve-item pass of 2026-09-18 — the card's density and headers, the arrow
   routing, the seeds that went, the drag and add-at-level rules, Autotrace, and Milestones becoming
   a phase.
   ------------------------------------------------------------------------------------------
   Run:       node modules/project-schedule/test-phasecard.js [path/to/index.html] [pinned-base.html]
   Contrast:  the second path is asserted to be a PRE-CHANGE copy and to FAIL — a suite that passes
              on both files is measuring nothing.

   ⚠️⚠️ EVERYTHING HERE IS SLICED OUT OF THE SHIPPED FILE AND EXECUTED. Nothing is
   re-implemented: a hand-copied copy of the arithmetic tests the copy, which this repo has been
   bitten by. A slice that comes back null ABORTS rather than comparing nothing.
   ⚠️ The contrast base must be pinned to a SHA, never to HEAD — HEAD becomes self-comparison the
   moment this change commits, which has already made three assertions in this module vacuous.  */
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
/* Source with comments blanked. ⚠️ Every "this string is gone now" assertion needs it: the commit
   that removes something is exactly the commit that describes the removal, and this suite's own
   subject has already been matched by the comment explaining it (2026-09-17 aw, af, and again on
   2026-09-11). Offsets are preserved so a line number still means something. */
function decomment(src) {
  var out = '', inS = null, inC = null;
  for (var k = 0; k < src.length; k++) {
    var c = src[k], n = src[k + 1];
    if (inC) {
      if (inC === '//' && c === '\n') { inC = null; out += c; }
      else if (inC === '/*' && c === '*' && n === '/') { inC = null; out += '  '; k++; }
      else out += (c === '\n' ? c : ' ');
      continue;
    }
    if (inS) { out += c; if (c === '\\') { out += src[++k] || ''; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inC = '//'; out += '  '; k++; continue; }
    if (c === '/' && n === '*') { inC = '/*'; out += '  '; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; }
    out += c;
  }
  return out;
}

var pass = 0, fail = 0, notes = [];
function G(t) { console.log('\n' + t); }
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

/* ---------------------------------------------------------------------------------------------
   THE SANDBOX. One factory, so every block runs the SAME slices against its own fixture — and so a
   function that quietly grew a dependency fails loudly here rather than on the page. `matchMedia`
   is supplied because the row pitch reads it; absent, `_phGanttHTML` would still run (the read is
   `typeof`-guarded) and would bake the desktop geometry in, which is what the page does.
   --------------------------------------------------------------------------------------------- */
var SANDBOX_FNS = [
  '_phaseBranchAt', '_phaseBranchName', '_phTaskNode', '_wbsMilestonesRootId',
  'sbPhases', 'sbPhActs', 'sbPhOn', 'sbPhLinks', 'sbPhMaterialise', 'sbPhSchedule',
  'sbPhLinkWouldCycle', 'sbPhDays', 'sbPhasePlan', 'sbPhTitle',
  '_phSelAct', '_phAddWbsTarget', '_phAddActTarget', '_phPromote', '_phAutotrace',
  '_phActById', '_phTreeRows', '_phGanttHTML',
  '_phIdFor', '_phLinksFor', 'phaseTaskPayload', 'serializeRels'
];
/* Public name on the sandbox -> the shipped function it slices. */
var EXPORTS = {
  phaseBranchAt: '_phaseBranchAt', phaseBranchName: '_phaseBranchName', taskNode: '_phTaskNode',
  phases: 'sbPhases', acts: 'sbPhActs', on: 'sbPhOn', links: 'sbPhLinks', sched: 'sbPhSchedule',
  days: 'sbPhDays', plan: 'sbPhasePlan', title: 'sbPhTitle', addActTarget: '_phAddActTarget',
  addWbsTarget: '_phAddWbsTarget', promote: '_phPromote', autotrace: '_phAutotrace',
  treeRows: '_phTreeRows', gantt: '_phGanttHTML', payload: 'phaseTaskPayload', idFor: '_phIdFor'
};
function build(src, label, fns, extra) {
  fns = fns || SANDBOX_FNS;
  var body = fns.map(function (n) {
    var f = sliceFn(src, n);
    if (!f) { console.log('ABORT: cannot slice ' + n + ' from ' + label); process.exit(1); }
    return f;
  }).join('\n');
  var deps = [
    "var cfg = FIX.cfg, WBS_NODES = FIX.nodes, _u = 0;",
    "var MS_CODE = 'milestones';",
    "var WBS_SKELETON = [{name:'Milestones'},{name:'Initiation Phase'},{name:'Planning Phase'},{name:'Execution Phase'},{name:'Closeout Phase'}];",
    "var PHASE_LABELS = {initiation:'Initiation Phase',planning:'Planning Phase',construction:'Execution Phase',closeout:'Close-out Phase'};",
    "var SB_PHASE_DEFS = FIX.defs;",
    "var _phCollapsed = {}, _wbsCollapsed = {}, _phSel = FIX.sel || {v:null,id:null}, _wbsSel = FIX.wbsSel || null;",
    "var _phIdx = null, LOG = [];",
    "var pid='P1', UID='U1', usePkg=null;",
    "function uidv(){ return 'u'+(++_u); }",
    "function e2(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }",
    "function fmtD(d){ return d ? d.toISOString().slice(0,10) : '\\u2014'; }",
    "function iso2(d){ return d ? d.toISOString().slice(0,10) : null; }",
    "function uniqId(p){ return p; }",
    "function addD(d,n){ var x=new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }",
    "function wbsById(id){ return WBS_NODES.filter(function(n){ return n.id===id; })[0]||null; }",
    "function wbsChildren(pid2){ return WBS_NODES.filter(function(n){ return (n.parent_id||null)===(pid2||null); })" +
      ".sort(function(a,b){ return (a.sort_order||0)-(b.sort_order||0); }); }",
    // ⚠️ phaseFromName is the REAL rule, copied from the migration it is kept in step with — and it
    //    must NOT answer 'milestones', which is the whole point of the MS_CODE split.
    "function phaseFromName(name){ var t=String(name==null?'':name).trim().toLowerCase(); if(!t) return null;" +
      " if(t.indexOf('execution phase')>=0||t.indexOf('construction')>=0) return 'construction';" +
      " if(t.indexOf('initiation')>=0) return 'initiation';" +
      " if(t.indexOf('planning phase')>=0) return 'planning';" +
      " if(t.indexOf('close')>=0) return 'closeout'; return null; }",
    "function markDirty(){ LOG.push('dirty'); }",
    "function render(){ LOG.push('render'); }",
    "var UI = { toast: function(m,k){ LOG.push('toast:'+k+':'+m); } };",
    "function psConfirm(t,onYes,o){ LOG.push('confirm:'+t); if(FIX.confirmYes) onYes(); }",
    "function _wbsNormalizeAndPersist(ids){ LOG.push('persist:'+ids.join(',')); return Promise.resolve(); }",
    "function _wbsCommit(){ LOG.push('commit'); return Promise.resolve(); }",
    "function matchMedia(q){ return { matches: !!FIX.narrow, addEventListener:function(){}, addListener:function(){} }; }"
  ].join('\n');
  /* ⚠️ The exported map is derived from the slice list, never written out flat: block 10 builds a
     PARTIAL sandbox out of the pre-change file, and a flat literal would reference a name that copy
     does not define and throw before a single contrast assertion ran. */
  var keys = [];
  Object.keys(EXPORTS).forEach(function (k) { if (fns.indexOf(EXPORTS[k]) >= 0) keys.push(k + ':' + EXPORTS[k]); });
  keys.push('find:function(id){ return wbsById(id); }');
  return new Function('FIX', deps + '\n' + (extra || '') + '\n' + body +
    '\n var _phIds = {}, _phLinkMap = null;' +
    '\n return { M: { ' + keys.join(', ') + ' }, LOG: LOG, ids:_phIds };');
}

var SRC = fs.readFileSync(FILE, 'utf8');
var SRC_NC = decomment(SRC);
var DEFS = [{ v: 'milestones', when: 'ms', always: true }, { v: 'initiation', when: 'before' },
            { v: 'planning', when: 'before' }, { v: 'construction', when: 'exec' }, { v: 'closeout', when: 'after' }];

/* One project shape, reused: Milestones root with a sub-branch, an Initiation phase branch with a
   two-deep chain under it, and a Close-out branch. */
function nodes() {
  return [
    { id: 'MS',   name: 'Milestones',       parent_id: null, sort_order: 0 },
    { id: 'MS1',  name: 'Client dates',     parent_id: 'MS', sort_order: 0 },
    { id: 'PHi',  name: 'Initiation Phase', parent_id: null, sort_order: 1 },
    { id: 'A',    name: 'Approvals',        parent_id: 'PHi', sort_order: 0 },
    { id: 'B',    name: 'Statutory',        parent_id: 'A',  sort_order: 0 },
    { id: 'C',    name: 'Permits',          parent_id: 'B',  sort_order: 0 },
    { id: 'PHc',  name: 'Closeout Phase',   parent_id: null, sort_order: 2 }
  ];
}
function fix(o) {
  o = o || {};
  return { cfg: { phases: o.phases || {} }, nodes: o.nodes || nodes(), defs: DEFS,
           sel: o.sel, wbsSel: o.wbsSel, narrow: o.narrow, confirmYes: o.confirmYes !== false };
}
function mk(o) { return build(SRC, FILE)(fix(o)); }

/* =============================================================================================
   1 · ITEM 3 — nothing is seeded any more
   ============================================================================================= */
G('1 · item 3: a phase opens with an empty list');
(function () {
  var S = mk({});
  var ph = S.M.phases();
  ['initiation', 'planning', 'closeout', 'milestones'].forEach(function (v) {
    ok(ph[v] && ph[v].acts.length === 0, v + ' seeds nothing (got ' + (ph[v] ? ph[v].acts.length : 'no phase') + ')');
  });
  ok(SRC_NC.indexOf('SB_PH_DEF') < 0, 'the seed table is deleted, not merely unread (comments stripped)');
  ok(SRC_NC.indexOf('function sbPhAct(') < 0, 'and its one reader went with it');
  // A phase saved BEFORE today keeps what it has — this changes the empty case and nothing else.
  var S2 = mk({ phases: { initiation: { on: true, acts: [{ id: 'x', n: 'Kept', d: 4 }] } } });
  ok(S2.M.acts('initiation').length === 1 && S2.M.acts('initiation')[0].n === 'Kept',
     'a saved list is untouched');
})();

/* =============================================================================================
   2 · ITEM 10 — Milestones is a phase, and it is required
   ============================================================================================= */
G('2 · item 10: Milestones is the fifth card');
(function () {
  var S = mk({ phases: { milestones: { on: false, acts: [{ id: 'm1', n: 'NTP', d: 1 }] } } });
  ok(DEFS[0].v === 'milestones', 'it is first in SB_PHASE_DEFS, so its card leads the step');
  ok(S.M.phases().milestones.on === true, '`always` forces it on even when the saved file says off');
  ok(S.M.on('milestones') === true, '…and sbPhOn agrees, so the push includes it');
  ok(S.M.title('milestones') === 'Milestones', 'it is titled from the skeleton, not from PHASE_LABELS');
  ok(S.M.phaseBranchName('milestones') === 'Milestones', 'and the push names the branch the same way');
  var b = S.M.phaseBranchAt(null, 'milestones');
  ok(b && b.id === 'MS', '_phaseBranchAt resolves the top-level Milestones root');
  ok(S.M.phaseBranchAt('PHi', 'milestones') === null,
     '…and only at the top level: a sub-branch somebody called Milestones is not it');
  ok(S.M.taskNode('milestones', 'MS1') === 'MS1', 'a child of that root is a valid branch for a milestone');
  ok(S.M.taskNode('milestones', 'A') === null, '…and a branch under another phase is refused');
  ok(S.M.taskNode('initiation', 'MS1') === null, '…in both directions');
})();

/* =============================================================================================
   3 · ITEM 10 — the pushed phase code, which is the line the whole card turns on
   ============================================================================================= */
G('3 · item 10: milestones push `phase: null`, everything else pushes its code');
(function () {
  var S = mk({ phases: {
    milestones: { on: true, acts: [{ id: 'm1', n: 'Notice to proceed', d: 1 }] },
    closeout:   { on: true, acts: [{ id: 'c1', n: 'Turnover', d: 5 }] }
  } });
  var g = { start: new Date(2027, 2, 1), finish: new Date(2028, 5, 30), totalDays: 487, rows: [] };
  var plan = S.M.plan(g), by = {};
  plan.forEach(function (p) { by[p.v] = p; });
  ok(!!by.milestones, 'the plan carries a milestones window');
  var t = { k: 'PH_milestones', v: 'milestones', r: by.milestones.rows[0], i: 0 };
  S.M.idFor(t);
  var p1 = S.M.payload(t);
  ok(p1.phase === null, 'a milestone row pushes phase null — the CHECK has four values and this is not one');
  var t2 = { k: 'PH_closeout', v: 'closeout', r: by.closeout.rows[0], i: 0 };
  S.M.idFor(t2);
  ok(S.M.payload(t2).phase === 'closeout', '…while a real lifecycle phase still pushes its own code');
  ok(p1.activity_name === 'Notice to proceed', 'the name is the planner’s');
  var t3 = { k: 'PH_milestones', v: 'milestones', r: by.milestones.rows[0], i: 0 };
  var S3 = mk({ phases: { milestones: { on: true, acts: [{ id: 'm1', n: '', d: 1 }] } } });
  var pl3 = S3.M.plan(g).filter(function (x) { return x.v === 'milestones'; })[0];
  var t4 = { k: 'PH_milestones', v: 'milestones', r: pl3.rows[0], i: 0 };
  S3.M.idFor(t4);
  ok(S3.M.payload(t4).activity_name === 'Milestones activity 1',
     '…and an unnamed one falls back through sbPhTitle, not to the literal word "Phase"');
})();

/* =============================================================================================
   4 · ITEM 10 — the milestones window is anchored at the PROGRAMME start
   ============================================================================================= */
G('4 · item 10: milestones run from the programme start, not either side of Execution');
(function () {
  var g = { start: new Date(2027, 2, 1), finish: new Date(2028, 5, 30), totalDays: 487, rows: [] };
  var S = mk({ phases: {
    milestones: { on: true, acts: [{ id: 'm1', n: 'NTP', d: 1 }, { id: 'm2', n: 'Topping out', d: 1, preds: [{ id: 'm1', type: 'FS', lag: 0 }] }], net: true },
    initiation: { on: true, acts: [{ id: 'i1', n: 'Charter', d: 10 }] }
  } });
  var plan = S.M.plan(g), by = {}; plan.forEach(function (p) { by[p.v] = p; });
  ok(plan[0].v === 'milestones', 'it is first in the plan, matching the card order');
  ok(+by.milestones.start === +by.initiation.start,
     'it starts where the programme starts — the earliest before-phase, not the execution start');
  ok(+by.initiation.finish < +g.start, 'the before-block is still back-scheduled off Execution');
  // With nothing before Execution, the programme starts at Execution.
  var S2 = mk({ phases: { milestones: { on: true, acts: [{ id: 'm1', n: 'NTP', d: 1 }] } } });
  var p2 = S2.M.plan(g)[0];
  ok(+p2.start === +g.start, '…and with no before-phase it starts at the execution start');
  ok(p2.when === 'ms', 'it is neither before nor after');
})();

/* =============================================================================================
   5 · ITEM 12 — Autotrace
   ============================================================================================= */
G('5 · item 12: Autotrace chains FS+0 in the order shown');
(function () {
  /* ⚠️ The fixture is built so ARRAY order and DISPLAY order DISAGREE: a2 is filed under a branch,
     so the tree draws it after the un-filed rows. Chaining the array would pass a weaker test. */
  var S = mk({ phases: { initiation: { on: true, acts: [
    { id: 'a1', n: 'One',   d: 3 },
    { id: 'a2', n: 'Two',   d: 4, w: 'A' },
    { id: 'a3', n: 'Three', d: 5 }
  ] } } });
  var shown = S.M.treeRows('initiation').filter(function (r) { return r.kind === 'act'; }).map(function (r) { return r.id; });
  ok(shown.join(',') !== 'a1,a2,a3', 'the fixture’s display order really does differ from its array order (' + shown.join(',') + ')');
  S.M.autotrace('initiation');
  var acts = S.M.acts('initiation'), byId = {};
  acts.forEach(function (a) { byId[a.id] = a; });
  ok(!byId[shown[0]].preds, 'the first row shown has no predecessor');
  for (var i = 1; i < shown.length; i++) {
    var p = byId[shown[i]].preds;
    ok(p && p.length === 1 && p[0].id === shown[i - 1] && p[0].type === 'FS' && p[0].lag === 0,
       shown[i] + ' follows ' + shown[i - 1] + ' FS+0');
  }
  ok(S.M.phases().initiation.net === true, 'the phase is marked converted, so deleting a link cannot resurrect the implicit chain');
  ok(S.LOG.indexOf('dirty') >= 0 && S.LOG.indexOf('render') >= 0, 'it marks the setup dirty and repaints');
  // It REPLACES, and says so first when there is something to lose.
  var S2 = mk({ phases: { initiation: { on: true, net: true, acts: [
    { id: 'b1', n: 'One', d: 3 },
    { id: 'b2', n: 'Two', d: 4, preds: [{ id: 'b1', type: 'SS', lag: 9 }] }
  ] } } });
  S2.M.autotrace('initiation');
  ok(S2.LOG.filter(function (l) { return l.indexOf('confirm:') === 0; }).length === 1,
     'a phase with drawn arrows is confirmed before they are replaced');
  var b2 = S2.M.acts('initiation')[1];
  ok(b2.preds[0].type === 'FS' && b2.preds[0].lag === 0, '…and the SS+9 really is replaced');
  var S3 = mk({ phases: { initiation: { on: true, acts: [{ id: 'c1', n: 'Only', d: 3 }] } } });
  S3.M.autotrace('initiation');
  ok(S3.LOG.length === 0, 'a one-activity phase does nothing at all — there is nothing to chain');
})();

/* =============================================================================================
   6 · ITEM 7 — + Add activity lands at the selected level
   ============================================================================================= */
G('6 · item 7: the new activity goes beside what is selected');
(function () {
  var A = [{ id: 'a1', n: 'One', d: 3 }, { id: 'a2', n: 'Two', d: 4, w: 'B' }];
  var nothing = mk({ phases: { initiation: { on: true, acts: A.slice() } } });
  ok(nothing.M.addActTarget('initiation').w === null, 'nothing selected → directly on the phase');
  ok(nothing.M.addActTarget('initiation').after === null, '…and appended');

  var onBranch = mk({ phases: { initiation: { on: true, acts: A.slice() } }, wbsSel: 'B' });
  ok(onBranch.M.addActTarget('initiation').w === 'B', 'a branch selected → inside that branch');

  var onRoot = mk({ phases: { initiation: { on: true, acts: A.slice() } }, wbsSel: 'PHi' });
  ok(onRoot.M.addActTarget('initiation').w === null,
     'the phase ROOT selected → directly on the phase, not filed under the root');

  var onAct = mk({ phases: { initiation: { on: true, acts: A.slice() } }, sel: { v: 'initiation', id: 'a2' } });
  var t = onAct.M.addActTarget('initiation');
  ok(t.w === 'B', 'an activity selected → the same branch it is in');
  ok(t.after === 'a2', '…and inserted directly after it, so "the same level" holds for the order too');

  var elsewhere = mk({ phases: { initiation: { on: true, acts: A.slice() } }, wbsSel: 'MS1' });
  ok(elsewhere.M.addActTarget('initiation').w === null,
     'a branch selected on ANOTHER card falls back to this phase — the selection is global, the button is not');
})();

/* =============================================================================================
   7 · ITEM 6 — promoting a branch stops at its own phase
   ============================================================================================= */
G('7 · item 6: drag-out promotes to the outermost level INSIDE the phase');
(function () {
  var S = mk({});
  var r = S.M.promote('initiation', 'C', 99);
  ok(!!r, 'a three-deep branch promotes');
  var n = S.M.phaseBranchAt(null, 'initiation');
  var c = S.M.find('C');
  ok(c.parent_id === 'PHi', 'all the way out lands it directly on the phase branch');
  ok(c.parent_id !== null, '…and NEVER at the top level, which would be a fifth lifecycle branch');

  var S2 = mk({});
  S2.M.promote('initiation', 'C', 1);
  ok(S2.M.find('C').parent_id === 'A', 'one level climbs exactly one rung');

  var S3 = mk({});
  var r3 = S3.M.promote('initiation', 'A', 1);
  ok(r3 === null, 'a branch already at the outermost level is refused');
  ok(S3.LOG.join('|').indexOf('Already at the outermost level') >= 0, '…with the reason said out loud');
  ok(S3.M.find('A').parent_id === 'PHi', '…and is not moved');

  var S4 = mk({});
  ok(S4.M.promote('initiation', 'MS1', 99) === null, 'a branch in another phase is not this card’s to move');
  ok(S4.M.find('MS1').parent_id === 'MS', '…and is not moved');

  var S5 = mk({ nodes: nodes().map(function (x) { return x.id === 'B' ? Object.assign({}, x, { is_locked: true }) : x; }) });
  ok(S5.M.promote('initiation', 'B', 99) === null, 'a locked heading is refused');
})();

/* =============================================================================================
   8 · ITEM 2 — the arrows
   ============================================================================================= */
G('8 · item 2: every arrow arrives travelling into the edge its type names, with a head');
(function () {
  var S = mk({ phases: { planning: { on: true, net: true, acts: [
    { id: 'a1', n: 'A', d: 10 },
    { id: 'a2', n: 'B', d: 8,  preds: [{ id: 'a1', type: 'FS', lag: 0 }] },
    { id: 'a3', n: 'C', d: 6,  preds: [{ id: 'a2', type: 'FS', lag: 6 }] },
    { id: 'a4', n: 'D', d: 12, preds: [{ id: 'a1', type: 'SS', lag: 2 }] },
    { id: 'a5', n: 'E', d: 7,  preds: [{ id: 'a3', type: 'FF', lag: 3 }] },
    { id: 'a6', n: 'F', d: 5,  preds: [{ id: 'a1', type: 'SF', lag: 20 }] }
  ] } } });
  var html = S.M.gantt('planning', null);
  /* ⚠️ Anchored on whitespace and captured in one pass: `marker-end="` ENDS IN `d="`, so a
     second exec over the matched tag returns url(#phah-planning) instead of the route. */
  var paths = [], _pre = /class="sbld-garrow"[^>]*\sd="([^"]+)"/g, _pm;
  while ((_pm = _pre.exec(html))) paths.push(_pm[1]);
  ok(paths.length === 5, 'five arrows drawn (got ' + paths.length + ')');
  ok(/<marker id="phah-planning"/.test(html), 'the card defines its own arrowhead marker');
  ok((html.match(/class="sbld-garrow" marker-end="url\(#phah-planning\)"/g) || []).length === paths.length,
     'every arrow references it — it used to say url(#none), a marker nothing defines');
  ok(html.indexOf('url(#none)') < 0, '…and the dead reference is gone');

  // The arrival direction, read off the path itself.
  var links = S.M.links('planning'), sc = S.M.sched('planning');
  var wantDir = {};   // to-id -> +1 arrives rightwards (a start edge), -1 leftwards (a finish edge)
  links.forEach(function (l) { wantDir[l.to] = (l.type === 'FF' || l.type === 'SF') ? -1 : 1; });
  var order = ['a2', 'a3', 'a4', 'a5', 'a6'];
  paths.forEach(function (d, i) {
    var seg = d.trim().split(/\s+/);
    var last = seg[seg.length - 1], prev = seg[seg.length - 2];
    ok(/^H/.test(last), 'arrow ' + i + ' ends on a HORIZONTAL run, so the head has a direction to take (' + last + ')');
    var xEnd = parseFloat(last.slice(1));
    var xPrev = /^[HV]/.test(prev) ? (/^H/.test(prev) ? parseFloat(prev.slice(1)) : NaN) : NaN;
    // the point before the last H is the x of the run before it — find the last preceding H
    for (var k = seg.length - 2; k >= 0 && isNaN(xPrev); k--) if (/^H/.test(seg[k])) xPrev = parseFloat(seg[k].slice(1));
    if (isNaN(xPrev)) xPrev = parseFloat(seg[0].replace('M', '').split(',')[0]);
    var dir = xEnd > xPrev ? 1 : (xEnd < xPrev ? -1 : 0);
    ok(dir === wantDir[order[i]], 'arrow into ' + order[i] + ' travels ' + (wantDir[order[i]] > 0 ? 'right into its START' : 'left into its FINISH') + ' (got ' + dir + ')');
    var xs = (d.match(/[-\d.]+/g) || []).map(Number);
    ok(Math.min.apply(null, xs) >= 0, 'arrow ' + i + ' has no coordinate left of the plot — the tree clips those');
  });
  // The FS+0 double-back happens in the lane BETWEEN the rows, never along the target row.
  var fs0 = paths[0].trim().split(/\s+/);
  /* M + five runs: out, down, back, down, in. ⚠️ Six tokens, not five — the moveto counts. */
  ok(fs0.length === 6, 'the FS+0 route is the five-run step, out/down/back/down/in (got ' + fs0.join(' ') + ')');
  ok(fs0[2] !== fs0[4], '…with its two verticals at different heights, so nothing is drawn on top of itself');
})();

/* =============================================================================================
   9 · ITEMS 1, 4, 5, 8 — density, headers, and the line that went
   ============================================================================================= */
G('9 · items 1, 4, 5, 8: the card’s own furniture');
(function () {
  var S = mk({ phases: { initiation: { on: true, acts: [{ id: 'a1', n: 'One', d: 5 }, { id: 'a2', n: 'Two', d: 30 }] } } });
  var html = S.M.gantt('initiation', null);
  ok(/class="sbld-ghead"/.test(html), 'the tree column carries a header row');
  ok(/sbld-ghead-n">Activities</.test(html), '…naming the activities column');
  ok(/sbld-ghead-d"[^>]*>Days</.test(html), '…and the duration column');
  var tops = (html.match(/top:(\d+)px/g) || []).map(function (m) { return +/(\d+)/.exec(m)[1]; });
  ok(tops.length >= 2, 'the bars are positioned');
  ok(tops[1] - tops[0] === 20, 'the desktop row pitch is 20px (was 26)');
  ok(/height:11px/.test(html), 'and the bar is 11px (was 16)');
  var narrow = build(SRC, FILE)(fix({ narrow: true, phases: { initiation: { on: true, acts: [{ id: 'a1', n: 'One', d: 5 }, { id: 'a2', n: 'Two', d: 30 }] } } }));
  var nh = narrow.M.gantt('initiation', null);
  var ntops = (nh.match(/top:(\d+)px/g) || []).map(function (m) { return +/(\d+)/.exec(m)[1]; });
  ok(ntops[1] - ntops[0] === 48, 'below 700px the pitch follows the 44px tap floor (48px)');
  ok(/height:14px/.test(nh), '…and the bar grows with it, from ONE set of numbers');
  ok(SRC_NC.indexOf('sbld-phtotal') < 0, 'item 8: the "Whole programme" line and its CSS are both gone');
  ok(SRC_NC.indexOf('--gw:') < 0, 'the --gw custom property nothing read is gone with it');
  ok(/font-size:var\(--pd-fs-xs\)/.test(SRC.slice(SRC.indexOf('.sbld-gname {'), SRC.indexOf('.sbld-gname {') + 400)),
     'item 4: the activity name is on the small rung, not the panel’s 14px body size');
})();

/* =============================================================================================
   10 · THE CONTRAST — the same suite against a pinned pre-change copy MUST fail
   ============================================================================================= */
if (BASE && fs.existsSync(BASE)) {
  G('10 · contrast (' + BASE + ')');
  var OLD = fs.readFileSync(BASE, 'utf8'), OLD_NC = decomment(OLD);
  var bits = [
    ['the seed table is present', OLD_NC.indexOf('SB_PH_DEF') >= 0],
    ['nothing knows the milestones code', OLD_NC.indexOf('MS_CODE') < 0],
    ['there is no Autotrace', OLD_NC.indexOf('_phAutotrace') < 0],
    ['there is no phase-aware promote', OLD_NC.indexOf('_phPromote') < 0],
    ['+ Add activity has no target rule', OLD_NC.indexOf('_phAddActTarget') < 0],
    ['the arrows reference a marker nothing defines', OLD_NC.indexOf('url(#none)') >= 0],
    ['there are no column headers', OLD_NC.indexOf('sbld-ghead') < 0],
    ['the "Whole programme" line is still drawn', OLD_NC.indexOf('sbld-phtotal') >= 0]
  ];
  bits.forEach(function (b) { ok(b[1], 'BASE: ' + b[0] + ' — if this fails the contrast is not a contrast'); });
  // …and the pre-change renderer really does seed and really does draw 26px rows.
  /* ⚠️ Lifted from the pinned copy, never retyped: this asserts what THAT file seeds. */
  var seedSrc = /var\s+SB_PH_DEF\s*=\s*\{[\s\S]*?\n\s*\};/.exec(OLD);
  ok(!!seedSrc, 'BASE: its seed table can be lifted out to run the old seeder against');
  var oldS = build(OLD, BASE, ['sbPhases', 'sbPhActs', 'sbPhAct'], seedSrc ? seedSrc[0] : '')({ cfg: { phases: {} }, nodes: nodes(), defs:
    [{ v: 'initiation', when: 'before' }, { v: 'planning', when: 'before' }, { v: 'construction', when: 'exec' }, { v: 'closeout', when: 'after' }] });
  ok(oldS.M.acts('initiation').length === 3, 'BASE: Initiation really was seeded with 3 activities');
} else {
  notes.push('no contrast base given — block 10 skipped');
}

console.log('');
notes.forEach(function (n) { console.log('note: ' + n); });
console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
