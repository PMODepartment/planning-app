/* Schedule Setup ▸ Floors & Zones ▸ Quick setup — the shipped arithmetic, executed.
 *
 *   node modules/project-schedule/test-quicksetup.js [--base <sha>]
 *
 * Owner 2026-09-18: *"in quick set-up simplify the inputs: Basement - ____ floors x ____ zones,
 * Podium - ____ floors x ____ zones, Typical - ____ floors x ____ zones x (checkbox * ____ units
 * if checked), RD - checkbox (*____ zones if checked)"*, and *"for zones and units, minimum is
 * always 1."*
 *
 * ⚠️⚠️ THE ONE ASSERTION THIS SUITE EXISTS FOR: the sentence the dialog shows before you press
 * Create — *"… N locations to schedule"* — is computed by `_qsCalc`, and the floors are built by a
 * DIFFERENT block a hundred lines below it. Those two can disagree, and if they do the planner
 * reads a number that is not what they get. So both are sliced out of the shipped file and RUN,
 * and the count is compared against the shipped `leavesOfFloor` over the rows the generator
 * actually produced. A test that re-implemented either side would agree with itself.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join(__dirname, 'index.html');
const ARGS = process.argv.slice(2);
/* ⚠️⚠️ PINNED TO A SHA, never HEAD: the moment this work commits, HEAD IS the change and every
   contrast becomes self-comparison — a trap this repo has already been caught by twice. */
const BASE_SHA = (ARGS.indexOf('--base') >= 0) ? ARGS[ARGS.indexOf('--base') + 1] : 'c395503';

let pass = 0, fail = 0;
function ok(cond, msg, got) {
  if (cond) { pass++; console.log('  ok  ' + msg); }
  else { fail++; console.log('  X   ' + msg + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}

/* ---- slicing: by name / by anchor, never by line number ---------------------------------- */
function sliceFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let j = src.indexOf('{', i), d = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) break; }
  }
  return src.slice(i, k + 1);
}
/* The generator, cut by its own first and last statements. ⚠️ Anchored on CONTENT: if the block is
   edited into a different shape the cut fails and the suite stops, which is the point. */
function sliceGen(src) {
  /* ⚠️ Cut from `var q = _qsNorm(v);` rather than from mkZones, so the CLAMP is inside the block
     being executed: that is what proves the generator builds from the normalised numbers and not
     from the raw boxes, which is the whole reason the sentence and the floors can be compared. */
  const a = src.indexOf('var q = _qsNorm(v);');
  const z = src.indexOf('zn.floors = _kept.concat(_gen);');
  if (a < 0 || z < 0 || z < a) return null;
  return src.slice(a, z + 'zn.floors = _kept.concat(_gen);'.length);
}
function sliceVar(src, name) {
  const m = new RegExp('(^|\\n)\\s*var ' + name + '\\s*=').exec(src);
  if (!m) return null;
  let i = m.index + m[0].length, d = 0, inS = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if ('([{'.indexOf(c) >= 0) d++;
    else if (')]}'.indexOf(c) >= 0) d--;
    else if (c === ';' && d === 0) break;
  }
  return 'var ' + name + ' =' + src.slice(m.index + m[0].length, i + 1);
}

/* ---- build a runnable module out of the shipped pieces ----------------------------------- */
function build(src, opts) {
  opts = opts || {};
  const want = ['_qsNorm', '_qsPer', '_qsCalc', '_qsSentence', '_clampN', 'leavesOfFloor', 'dimLabelOf', 'towerLabel', 'multiTower', 'towerList', 'towerById', 'towerIdOf', 'repTowerOfTower', 'repTowerOf', 'towersOfType', 'typeById', 'typeList'];
  const have = [], bodies = [];
  want.forEach(function (n) {
    const b = sliceFn(src, n);
    if (b) { have.push(n); bodies.push(b); }
    else if (!opts.optional || opts.optional.indexOf(n) < 0) throw new Error('SLICE FAILED: ' + n);
  });
  const gen = sliceGen(src);
  if (!gen && !opts.genOptional) throw new Error('SLICE FAILED: the quick-setup generator');
  ['KIND_ORDER', 'KIND_LABEL', 'DIM_LABEL', 'GLABEL', 'GROUPS'].forEach(function (n) {
    const v = sliceVar(src, n);
    if (!v) throw new Error('SLICE VAR FAILED: ' + n);
    bodies.unshift(v);
  });
  /* ⚠️ Only STATE is supplied — `cfg`, which is the document; `tr`/`_twAct`/`showZones`/`showUnits`,
     which are what the step is currently looking at; and `uidv`, a random-id source a deterministic
     test must control. Every RULE is sliced. */
  const pre =
    'var cfg = null, tr = "ST", _twAct = "tw1", showZones = true, showUnits = true;\n' +
    'var quickN = {}, _twFloors = [], zn = { floors: [] };\n' +
    'var _seq = 0; function uidv() { return "u" + (++_seq); }\n' +
    'function e2(s) { return String(s == null ? "" : s); }\n' +
    'function markDirty() {} function render() {} function pruneLinks() {}\n' +
    'var UI = { toast: function () {} };\n';
  const post = '\nfunction runGen(v) {\n' + (gen || 'throw new Error("no generator");') +
    '\nreturn _gen;\n}\n' +
    'return { ' + have.map(function (n) { return n + ': ' + n; }).join(', ') +
    ', runGen: ' + (gen ? 'runGen' : 'null') +
    ', setCfg: function (c) { cfg = c; }, setZn: function (z) { zn = z; }, getZn: function () { return zn; }' +
    ', setTwFloors: function (f) { _twFloors = f; }, setShow: function (z, u) { showZones = z; showUnits = u; }' +
    ', quickN: function () { return quickN; }, resetIds: function () { _seq = 0; } };';
  return new Function(pre + bodies.join('\n') + post)();
}

const SRC = fs.readFileSync(FILE, 'utf8');
/* ⚠️ A slice that cannot find its function ABORTS with the name, rather than letting a stack
   trace stand in for a finding — the suite comparing nothing is the failure worth naming. */
let M;
try { M = build(SRC); }
catch (e) { console.log('BUILD FAILED — cannot run: ' + e.message + ' — aborting rather than comparing nothing'); process.exit(1); }

function mkCfg() {
  return {
    towerTypes: [{ id: 'ty1', code: 'T1', name: 'Type 1' }],
    towers: [{ id: 'tw1', code: 'T1A', name: 'Tower 1', typeId: 'ty1' }],
    zoning: {}, links: [], towerLinks: [], activities: []
  };
}

console.log('quick setup — the shipped arithmetic, executed\n');

/* ================= 1 · the owner's shape ================================================== */
{
  M.setShow(true, true);
  /* 3 basements × 2 zones, 4 podium × 3, 12 typical × 2 × 4 units, a roof deck × 1. */
  const q = M._qsNorm({ B: 3, P: 4, F: 12, R: true, BZ: 2, PZ: 3, FZ: 2, RZ: 1, HU: true, U: 4 });
  ok(q.B === 3 && q.P === 4 && q.F === 12, '1.1  each category keeps its OWN floor count', [q.B, q.P, q.F]);
  ok(q.z.basement === 2 && q.z.podium === 3 && q.z.typical === 2,
    '1.2  ⚠️⚠️ …and its OWN zone count — one figure for the whole building was the thing being replaced', q.z);
  ok(q.R === 1, '1.3  a roof deck is a TICK stored as a count of 1, so nothing downstream learns a third shape', q.R);
  ok(q.u === 4, '1.4  units hang off the typical floors, behind their own tick', q.u);
}

/* ================= 2 · minimum 1 for a zone and a unit ==================================== */
{
  M.setShow(true, true);
  const q = M._qsNorm({ B: 1, P: 0, F: 1, R: false, BZ: 0, PZ: 0, FZ: 0, RZ: 0, HU: true, U: 0 });
  ok(q.z.basement === 1 && q.z.typical === 1,
    '2.1  ⚠️ a zone count of 0 reads as 1 — owner: *"for zones and units, minimum is always 1"*', q.z);
  ok(q.u === 1, '2.2  …and so does a unit count of 0', q.u);
  const q2 = M._qsNorm({ B: 1, P: 0, F: 1, R: false, BZ: null, PZ: null, FZ: null, RZ: null, HU: false, U: null });
  ok(q2.z.typical === 1, '2.3  …and an EMPTIED box is the minimum, not NaN', q2.z.typical);
  ok(q2.u === 0, '2.4  ⚠️ but with the tick OFF, units are 0 — the minimum applies to a number being ASKED for', q2.u);
  const q3 = M._qsNorm({ B: 999, P: 999, F: 999, R: true, BZ: 999, PZ: 1, FZ: 1, RZ: 1, HU: true, U: 999 });
  ok(q3.B === 20 && q3.P === 30 && q3.F === 80 && q3.z.basement === 20 && q3.u === 20,
    '2.5  …and every box is bounded at the top', [q3.B, q3.P, q3.F, q3.z.basement, q3.u]);
}

/* ================= 3 · the Activity level decides what is even asked ====================== */
{
  M.setShow(false, false);
  const q = M._qsNorm({ B: 2, P: 0, F: 3, R: false, BZ: 5, PZ: 5, FZ: 5, RZ: 5, HU: true, U: 5 });
  ok(q.z.basement === 0 && q.z.typical === 0,
    '3.1  ⚠️ on a project whose Activity level is Floor, no zone is created however the box reads', q.z);
  ok(q.u === 0, '3.2  …and no unit either, so the floor is the leaf', q.u);
  ok(M._qsCalc(q).nl === 5, '3.3  …and the location count is one per FLOOR', M._qsCalc(q).nl);
  M.setShow(true, true);
}

/* ================= 4 · ⚠️⚠️ THE SENTENCE AND THE GENERATOR AGREE ========================== */
/* The claim the dialog makes before anything is written, checked against what it writes. */
{
  const cases = [
    { n: '3 basements ×2, 4 podium ×3, 12 typical ×2 ×4 units, roof ×1',
      v: { B: 3, P: 4, F: 12, R: true, BZ: 2, PZ: 3, FZ: 2, RZ: 1, HU: true, U: 4 } },
    { n: 'typical only, no units',
      v: { B: 0, P: 0, F: 5, R: false, BZ: 1, PZ: 1, FZ: 3, RZ: 1, HU: false, U: 1 } },
    { n: 'a roof deck on its own',
      v: { B: 0, P: 0, F: 0, R: true, BZ: 1, PZ: 1, FZ: 1, RZ: 2, HU: false, U: 1 } },
    { n: 'one of everything',
      v: { B: 1, P: 1, F: 1, R: true, BZ: 1, PZ: 1, FZ: 1, RZ: 1, HU: true, U: 1 } },
    { n: 'nothing at all',
      v: { B: 0, P: 0, F: 0, R: false, BZ: 1, PZ: 1, FZ: 1, RZ: 1, HU: false, U: 1 } }
  ];
  cases.forEach(function (c, i) {
    M.setCfg(mkCfg()); M.setZn({ floors: [] }); M.resetIds();
    const q = M._qsNorm(c.v);
    const said = M._qsCalc(q);
    const gen = M.runGen(c.v);
    const built = gen.length;
    let leaves = 0;
    gen.forEach(function (f) { leaves += M.leavesOfFloor('ST', f).length; });
    ok(built === said.st, '4.' + (i + 1) + 'a  ' + c.n + ' — it creates the STOREYS it said (' + said.st + ')', [built, said.st]);
    ok(leaves === said.nl,
      '4.' + (i + 1) + 'b  ⚠️⚠️ …and the LOCATIONS it said (' + said.nl + ') — the number the planner reads before pressing Create',
      [leaves, said.nl]);
  });
}

/* ================= 5 · what the generator builds, in detail =============================== */
{
  M.setCfg(mkCfg()); M.setZn({ floors: [] }); M.resetIds();
  const gen = M.runGen({ B: 2, P: 3, F: 4, R: true, BZ: 2, PZ: 3, FZ: 2, RZ: 1, HU: true, U: 5 });
  const codes = gen.map(function (f) { return f.code; });
  ok(codes.join(',') === 'B2,B1,F1,F2,F3,F4,F5,F6,F7,F8',
    '5.1  ⚠️⚠️ ONE above-grade numbering sequence, not three — podium, typical and roof share F1…F8', codes.join(','));
  ok(gen.slice(0, 2).every(function (f) { return f.kind === 'basement' && f.sub === true; }),
    '5.2  …the basements are deepest-first and carry sub=true, which the tower grade line reads');
  const kinds = gen.slice(2).map(function (f) { return f.kind; });
  ok(kinds.join(',') === 'podium,podium,podium,typical,typical,typical,typical,roof',
    '5.3  …and the CATEGORY says what each floor is, in order', kinds.join(','));
  const byKind = {};
  gen.forEach(function (f) { byKind[f.kind] = (byKind[f.kind] || []).concat([f.zones.length]); });
  ok(byKind.basement.join() === '2,2' && byKind.podium.join() === '3,3,3' && byKind.typical.join() === '2,2,2,2',
    '5.4  ⚠️ each floor gets ITS CATEGORY’S zone count', byKind);
  const typ = gen.filter(function (f) { return f.kind === 'typical'; });
  const oth = gen.filter(function (f) { return f.kind !== 'typical'; });
  ok(typ.every(function (f) { return f.zones.every(function (z) { return z.units.length === 5; }); }),
    '5.5  …and only a TYPICAL floor gets units');
  ok(oth.every(function (f) { return f.zones.every(function (z) { return z.units.length === 0; }); }),
    '5.6  ⚠️⚠️ …never a basement, podium or roof — asking for those is asking for a number that is always 0');
  ok(gen.every(function (f) { return f.towerId === 'tw1'; }), '5.7  every generated floor is stamped with the tower being edited');
}

/* ================= 6 · it replaces only THIS tower's floors =============================== */
{
  M.setCfg(mkCfg()); M.resetIds();
  const keep = [{ id: 'old1', towerId: 'tw9', code: 'X1', kind: 'typical', zones: [] },
                { id: 'old2', towerId: 'tw1', code: 'Y1', kind: 'typical', zones: [] }];
  const zn = { floors: keep.slice() };
  M.setZn(zn);
  M.runGen({ B: 0, P: 0, F: 2, R: false, BZ: 1, PZ: 1, FZ: 1, RZ: 1, HU: false, U: 1 });
  const after = M.getZn().floors;
  ok(after.some(function (f) { return f.id === 'old1'; }),
    '6.1  ⚠️⚠️ another tower’s floors SURVIVE — this was `zn.floors = []`, so generating Tower 2 destroyed Tower 1');
  ok(!after.some(function (f) { return f.id === 'old2'; }), '6.2  …and this tower’s own are replaced');
  ok(after.length === 3, '6.3  …leaving one kept plus two generated', after.length);
}

/* ================= 7 · the sentence itself =============================================== */
{
  M.setShow(true, true); M.setCfg(mkCfg()); M.setTwFloors([]);
  const s = M._qsSentence(M._qsNorm({ B: 2, P: 0, F: 3, R: false, BZ: 2, PZ: 1, FZ: 2, RZ: 1, HU: false, U: 1 }));
  ok(/<b>5<\/b> storeys/.test(s), '7.1  it states the storeys', s);
  ok(/<b>10<\/b>/.test(s), '7.2  …the zones (2×2 + 3×2)', s);
  ok(/<b>10<\/b> locations to schedule/.test(s), '7.3  …and the locations, which is what the next steps are sized by', s);
  ok(!/Replaces/.test(s), '7.4  …and says nothing about replacing when there is nothing there');
  M.setTwFloors([{}, {}, {}]);
  const s2 = M._qsSentence(M._qsNorm({ B: 0, P: 0, F: 1, R: false, BZ: 1, PZ: 1, FZ: 1, RZ: 1, HU: false, U: 1 }));
  ok(/Replaces the 3 floors/.test(s2),
    '7.5  ⚠️ …but warns, with a COUNT, when it would replace floors that are already there', s2);
  const s3 = M._qsSentence(M._qsNorm({ B: 0, P: 0, F: 0, R: false, BZ: 1, PZ: 1, FZ: 1, RZ: 1, HU: false, U: 1 }));
  ok(/<b>0<\/b> storeys/.test(s3) && /no zones/.test(s3), '7.6  an empty setup says so rather than reading as a fault', s3);
  M.setTwFloors([]);
}

/* ================= 8 · the disabled-box rule is in the source ============================= */
/* ⚠️ Read, not executed: `_qsGate` needs the modal's own DOM. What is asserted is that the two
   conditional boxes are DISABLED rather than merely ignored — a live-looking box whose value
   changes nothing is the looks-wired-does-nothing failure this module keeps recording. */
{
  const g = sliceFn(SRC, '_qsGate');
  ok(!!g, '8.1  _qsGate is still there');
  ok(g && /rz\.disabled = !\(/.test(g), '8.2  the roof’s zone box is disabled until the roof tick is on', g);
  ok(g && /u\.disabled = !\(/.test(g), '8.3  …and the unit box until the unit tick is on', g);
  const p = sliceFn(SRC, '_qsPrev');
  ok(p && /_qsGate\(\)/.test(p) && /_qsSentence\(_qsNorm\(_qsRaw\(\)\)\)/.test(p),
    '8.4  ⚠️ and the live preview runs the SAME clamp the generator does, so the two cannot disagree', p);
  ok(/addEventListener\('input', _qsPrev\)/.test(SRC),
    '8.5  …on input, not change — the point is to answer WHILE the number is being typed');
}

/* ================= 9 · contrast against the base ========================================== */
/* ⚠️⚠️ PINNED TO A SHA, never HEAD: the moment this work commits, HEAD IS the change and every
   contrast becomes self-comparison. */
if (BASE_SHA) {
  console.log('\n  contrast: ' + BASE_SHA);
  let base = null;
  try { base = execFileSync('git', ['show', BASE_SHA + ':modules/project-schedule/index.html'], { cwd: __dirname, maxBuffer: 1 << 28 }).toString(); }
  catch (e) { console.log('  !! could not read the base: ' + e.message); }
  if (base) {
    ok(!/BZ:\s*num\('BZ'\)/.test(base) && !/q\.z\[k\]/.test(base),
      '9.1  BASE has no per-category zone count — one figure for the whole building');
    const bg = sliceGen(base);
    ok(!bg || !/kind === 'typical' \? q\.u : 0/.test(bg),
      '9.2  …and no typical-only units');
    /* Executed: the base CANNOT express a podium zoned differently from the floors above it. */
    let B = null;
    try { B = build(base, { optional: ['_qsPer'], genOptional: true }); } catch (e) { B = null; }
    if (B && B._qsNorm) {
      const bq = B._qsNorm({ B: 2, P: 3, F: 4, Z: 2, U: 0, BZ: 9, PZ: 9, FZ: 9, R: true });
      const perCat = bq.z && (bq.z.podium !== bq.z.typical);
      ok(!perCat, '9.3  ⚠️⚠️ BASE: a podium and the typical floors above it cannot be zoned differently — the defect this ships to fix', bq.z);
    } else {
      ok(true, '9.3  BASE has no _qsNorm at all — the clamp is new');
    }
  }
}

console.log('\n' + (fail ? 'FAIL: ' : 'PASS: ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
