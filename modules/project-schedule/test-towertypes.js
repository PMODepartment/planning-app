/* TOWER TYPES — slice-and-execute suite.
 *
 * Owner 2026-09-18: *"the idea for the towers is that, users are to define the types of towers
 * there are. Meaning Type 1 Tower has 16F and same footprints, number of zones, same sizing etc…
 * and users are to define how many type 1 towers there are in the project."*
 *
 * ⚠️⚠️ WHAT MAKES THIS WORTH A SUITE. A type's floors are stored ONCE, against that type's first
 *    instance (its "representative"), and every other instance reads the same ones. That buys
 *    "every Type 1 tower is identical" by construction instead of by keeping N copies in step —
 *    but it puts a resolution step between a tower and its floors, and a resolution step that
 *    guesses is silent. It already did: an early cut fell back to "the first type" for a tower
 *    carrying no typeId, which collapsed EVERY tower onto tower 1's floors on any cfg that had
 *    not been through normalize(). The schedule still generated. It was just the wrong building.
 *
 * ⚠️⚠️ AND THE uid IS LOAD-BEARING. cfg.links, cfg.actLinks and cfg.scopeOff are all keyed on the
 *    leaf uid that locList emits. The first instance of a type must therefore keep the historical
 *    uid BYTE FOR BYTE, or every saved link and scope answer on every existing project is
 *    silently stranded — and only the instances beyond the first, which are new by definition and
 *    carry no saved keys, may carry a tower segment. Both halves are asserted.
 *
 * ⚠️ The functions are SLICED OUT OF THE SHIPPED index.html BY NAME and executed — nothing here
 *    re-implements the rule under test (see test-slice.js). NOTHING under test is stubbed: the
 *    suite fails loudly if a name it needs is missing, rather than quietly inventing it.
 *
 * Usage:  node modules/project-schedule/test-towertypes.js
 * Contrast build (must NOT have any of this):  the suite runs it itself, pinned below.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { makeSlicer } = require('./test-slice.js');
/* ⚠️ The repo's own string/comment/regex-aware scanner. A "is this text gone" assertion that
   reads the raw file cannot tell the shipped help text from the comment recording that it went. */
const scan = require('../../tools/scan.js');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(__dirname, 'index.html');

/* ⚠️ PINNED, NEVER `HEAD` — `git show HEAD:` becomes self-comparison the moment this commits, and
   this repo has been caught by exactly that. This is the commit that shipped prerequisite gating,
   which is the last one before tower types existed. */
const BASE_SHA = '46b67299';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, got) {
  if (cond) pass++;
  else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got) + ']')); }
}

/* ---------------------------------------------------------------------------------------- */
/* The sandbox, built out of the SHIPPED source.                                              */
/* ---------------------------------------------------------------------------------------- */
const FNS = [
  'zpNormCode', 'floorsOf', 'towerList', 'towerById', 'towerLabel', 'towerIdOf',
  'blankTowers', 'blankTowerTypes',
  'typeList', 'typeById', 'typeLabel', 'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower',
  'floorsOfTower', 'locless', 'leavesOfFloor', 'locList',
  '_twNewInstance', '_twSetCount', '_clampN'
];
const VARS = ['GROUPS', 'GLABEL', 'LOCLESS'];

/* ⚠️⚠️ THE MIGRATION IS LIFTED AS SOURCE TEXT, NOT RETYPED. It lives inside normalize(), which is
   a two-hundred-line function with a tail of dependencies this suite has no business dragging in
   — but re-implementing the migration here would make the suite agree with itself rather than
   with the file. So the SHIPPED lines are cut out by their own anchors and executed as-is: if the
   block is edited into a different shape the cut fails and the suite stops, which is the point. */
function sliceMigration(src) {
  const m = src.match(/\n(\s*)d\.towerTypes = \(Array\.isArray\(c\.towerTypes\)[\s\S]*?d\.towerTypes = d\.towerTypes\.filter\(function \(ty\) \{[^\n]*\n/);
  if (!m) return null;
  return 'function migrateTypes(d, c) {\n' + m[0] + '\nreturn d;\n}\n';
}

function build(src, opts) {
  opts = opts || {};
  const S = makeSlicer(src);
  const bodies = [];
  const have = [];
  FNS.forEach(function (n) {
    if (opts.optional && opts.optional.indexOf(n) >= 0 && src.indexOf('function ' + n + '(') < 0) return;
    bodies.push(S.sliceFn(n)); have.push(n);
  });
  VARS.forEach(function (n) { bodies.push(S.sliceVarLine(n)); });
  const mig = sliceMigration(src);
  if (mig) { bodies.push(mig); have.push('migrateTypes'); }
  /* ⚠️ `cfg` and `uidv` are the ONLY things provided: `cfg` is the document under edit (the
     fixture IS the document) and `uidv` is a random-id source a deterministic test must control.
     Every rule being tested is sliced. */
  const pre = 'var cfg = null;\nvar _seq = 0;\nfunction uidv() { return "u" + (++_seq); }\n';
  const post = '\nreturn { ' + have.map(function (n) { return n + ': ' + n; }).join(', ') +
    ', setCfg: function (c) { cfg = c; }, getCfg: function () { return cfg; },' +
    ' resetIds: function () { _seq = 0; } };';
  return new Function(pre + bodies.join('\n') + post)();
}

const SRC = fs.readFileSync(PAGE, 'utf8');
const SRC_NC = scan.blankComments(SRC);
let M;
try { M = build(SRC); }
catch (e) { console.error('BUILD FAILED — cannot run: ' + e.message); process.exit(1); }

/* ---------------------------------------------------------------------------------------- */
/* Fixtures.                                                                                  */
/* ---------------------------------------------------------------------------------------- */
let seq = 0;
function fid() { return 'f' + (++seq); }

/* Floors for ONE tower: [code, kind, nZones, nUnitsPerZone] */
function mkFloors(twId, rows) {
  return rows.map(function (r) {
    const zs = [];
    for (let j = 1; j <= (r[2] || 0); j++) {
      const us = [];
      for (let k = 1; k <= (r[3] || 0); k++) us.push({ id: fid(), code: 'U' + k });
      zs.push({ id: fid(), code: 'Z' + j, units: us });
    }
    return { id: fid(), code: r[0], name: '', kind: r[1], sub: r[1] === 'basement', towerId: twId, zones: zs };
  });
}

const SHAPE = [['B1', 'basement', 1, 0], ['F1', 'typical', 2, 0], ['F2', 'typical', 2, 0]];

/* One type, N instances. The floors hang off the FIRST instance only — which is the whole model. */
function mkTypedCfg(n) {
  seq = 0;
  const towers = [];
  for (let i = 1; i <= n; i++) towers.push({ id: 'tw' + i, code: 'T' + i, name: 'Tower ' + i, typeId: 'ty1' });
  return {
    locLevel: 'auto',
    towerTypes: [{ id: 'ty1', code: 'T1', name: 'Type 1' }],
    towers: towers,
    towerLinks: [],
    activities: [{ id: 'a1', group: 'ST' }],
    zoning: {
      GR: { floors: [] }, SW: { floors: [] },
      ST: { floors: mkFloors('tw1', SHAPE) },
      AR: { floors: [] }, MEPF: { floors: [] }, SD: { floors: [] }, ALLIED: { floors: [] }, OT: { floors: [] }
    }
  };
}

console.log('tower types — the shipped functions, executed\n');

/* ================= 1 · the model's own vocabulary ======================================== */
{
  const c = mkTypedCfg(1); M.setCfg(c);
  ok(M.typeList().length === 1, '1.1  typeList reads cfg.towerTypes', M.typeList().length);
  ok(M.typeById('ty1').name === 'Type 1', '1.2  typeById finds one by id');
  ok(M.typeById('nope') === null, '1.3  …and answers null for one that is not there');
  ok(M.typeLabel('ty1') === 'Type 1', '1.4  typeLabel prefers the name');
  ok(M.typeOfTower('tw1') === 'ty1', '1.5  typeOfTower reads the tower’s own typeId');
  ok(M.repTowerOf('ty1') === 'tw1', '1.6  the representative is the FIRST instance in list order');
  ok(M.repTowerOfTower('tw1') === 'tw1', '1.7  …and a lone instance is its own representative');
  /* blank() must produce a type, or a brand-new project has towers pointing at nothing. */
  const bt = M.blankTowerTypes(), bw = M.blankTowers();
  ok(bt.length === 1, '1.8  blankTowerTypes produces exactly one type', bt.length);
  ok(bw[0].typeId === bt[0].id,
    '1.9  ⚠️ blankTowers’ tower POINTS AT IT — two literals that must agree is how they stop agreeing',
    [bw[0].typeId, bt[0].id]);
}

/* ================= 2 · NO GUESSING: an untyped tower is its own type ===================== */
/* ⚠️⚠️ THE REGRESSION THIS SUITE EXISTS FOR. An early cut resolved a tower with no typeId to
   "the first type", and repTowerOf fell back to "the first tower" — so on any cfg that had not
   been through normalize() every tower read tower 1's floors. The schedule still generated. */
{
  const c = mkTypedCfg(1);
  c.towers = [{ id: 'twA', code: 'TA', name: 'Tower A' }, { id: 'twB', code: 'TB', name: 'Tower B' }];
  c.towerTypes = [];
  c.zoning.ST.floors = mkFloors('twA', SHAPE).concat(mkFloors('twB', [['F1', 'typical', 1, 0]]));
  M.setCfg(c);
  ok(M.typeOfTower('twB') === '', '2.1  an untyped tower has NO type — it is never resolved to the first one', M.typeOfTower('twB'));
  ok(M.towersOfType('').length === 0, '2.2  and the empty type instantiates nothing', M.towersOfType('').length);
  ok(M.repTowerOfTower('twB') === 'twB', '2.3  so an untyped tower is its OWN representative', M.repTowerOfTower('twB'));
  ok(M.floorsOfTower('ST', 'twB').length === 1, '2.4  ⚠️ it therefore reads ITS OWN floor, not tower A’s three', M.floorsOfTower('ST', 'twB').length);
  ok(M.floorsOfTower('ST', 'twA').length === 3, '2.5  …and tower A still reads its own three', M.floorsOfTower('ST', 'twA').length);
  ok(M.locList().length === 6, '2.6  …and the push carries both towers’ locations, 5 + 1', M.locList().length);
}

/* ================= 3 · one set of floors, N buildings ==================================== */
{
  const c = mkTypedCfg(3); M.setCfg(c);
  ok(M.floorsOf('ST').length === 3, '3.1  the floors are stored ONCE — three rows for three storeys, not nine', M.floorsOf('ST').length);
  ['tw1', 'tw2', 'tw3'].forEach(function (id, i) {
    ok(M.floorsOfTower('ST', id).length === 3,
      '3.2.' + (i + 1) + '  every instance of the type reads the same three floors (' + id + ')',
      M.floorsOfTower('ST', id).length);
  });
  /* B1 has one zone, F1 and F2 have two each → 5 leaves per tower at auto level. */
  const L = M.locList();
  ok(L.length === 15, '3.3  ⚠️ the PUSH fans out: 5 locations × 3 towers', L.length);
  const byTower = {};
  L.forEach(function (l) { byTower[l.towerId] = (byTower[l.towerId] || 0) + 1; });
  ok(byTower.tw1 === 5 && byTower.tw2 === 5 && byTower.tw3 === 5,
    '3.4  …five each, and every leaf carries the tower it belongs to', byTower);
  ok(L.filter(function (l) { return l.tower === 'Tower 2'; }).length === 5,
    '3.5  …with that tower’s own LABEL, which is what the stacking and the site plan join on');
  /* Raising the count must not touch the floors. */
  const before = M.floorsOf('ST').length;
  M._twSetCount('ty1', 5);
  ok(M.floorsOf('ST').length === before, '3.6  ⚠️⚠️ adding two more towers adds NO floors — nothing is copied', M.floorsOf('ST').length);
  ok(M.locList().length === 25, '3.7  …but the push now carries 5 × 5', M.locList().length);
}

/* ================= 4 · the uid contract ================================================== */
/* ⚠️⚠️ cfg.links, cfg.actLinks and cfg.scopeOff are keyed on these. */
{
  const one = mkTypedCfg(1); M.setCfg(one);
  const base = M.locList().map(function (l) { return l.uid; });

  const three = mkTypedCfg(3); M.setCfg(three);
  const L = M.locList();
  const first = L.filter(function (l) { return l.towerId === 'tw1'; }).map(function (l) { return l.uid; });
  ok(JSON.stringify(first) === JSON.stringify(base),
    '4.1  ⚠️⚠️ THE FIRST INSTANCE’S uids ARE BYTE-FOR-BYTE THE SINGLE-TOWER ONES — every saved link and scope answer survives',
    [first, base]);
  const second = L.filter(function (l) { return l.towerId === 'tw2'; }).map(function (l) { return l.uid; });
  ok(second.every(function (u, i) { return u !== first[i]; }),
    '4.2  …and the later instances do NOT collide with them');
  ok(second.every(function (u) { return u.indexOf('@tw2/') > 0; }),
    '4.3  …because they carry a tower segment, which only they need', second[0]);
  ok(new Set(L.map(function (l) { return l.uid; })).size === L.length,
    '4.4  every uid in the push is unique', L.length);
  ok(second.every(function (u) { return u.indexOf('ST') === 0; }),
    '4.5  …and still starts with its trade, which every reader of a uid splits on', second[0]);
}

/* ================= 5 · the count control ================================================= */
{
  const c = mkTypedCfg(2); M.setCfg(c);
  const repBefore = M.repTowerOf('ty1');
  ok(M._twSetCount('ty1', 4) === true, '5.1  raising the count reports that it changed');
  ok(M.towersOfType('ty1').length === 4, '5.2  …and there are four towers of the type', M.towersOfType('ty1').length);
  const names = M.towersOfType('ty1').map(function (t) { return t.name; });
  ok(new Set(names).size === 4, '5.3  ⚠️ each has a DISTINCT name — the site plan joins areas to towers by name', names);
  const codes = M.towersOfType('ty1').map(function (t) { return t.code; });
  ok(new Set(codes).size === 4, '5.4  …and a distinct code, which is built into every generated activity id', codes);
  ok(M._twSetCount('ty1', 4) === false, '5.5  setting it to what it already is changes nothing');

  /* ⚠️⚠️ THE ONE THAT PROTECTS THE LAYOUT. */
  c.towerLinks = [{ from: 'tw1', to: M.towersOfType('ty1')[3].id, type: 'FS', lag: 0 }];
  M._twSetCount('ty1', 2);
  ok(M.repTowerOf('ty1') === repBefore,
    '5.6  ⚠️⚠️ LOWERING THE COUNT REMOVES FROM THE END — the representative, which holds every floor, is untouched',
    [M.repTowerOf('ty1'), repBefore]);
  ok(M.floorsOfTower('ST', repBefore).length === 3, '5.7  …so the layout is still reachable', M.floorsOfTower('ST', repBefore).length);
  ok(c.towerLinks.length === 0, '5.8  …and a tower relationship naming a tower that no longer exists goes with it', c.towerLinks);

  M._twSetCount('ty1', 0);
  ok(M.towersOfType('ty1').length === 1,
    '5.9  ⚠️ a type NEVER drops below one tower — with no instance it has no representative and its floors are unreachable',
    M.towersOfType('ty1').length);
  M._twSetCount('ty1', 999);
  ok(M.towersOfType('ty1').length === 60, '5.10  …and is bounded at the top', M.towersOfType('ty1').length);
  ok(M._twSetCount('nosuchtype', 3) === false, '5.11  a type that does not exist cannot be counted');
}

/* ================= 6 · naming a new instance ============================================= */
{
  const c = mkTypedCfg(1);
  c.towers.push({ id: 'twX', code: 'T2', name: 'Tower 2', typeId: 'ty1' });
  M.setCfg(c);
  const t = M._twNewInstance(M.typeById('ty1'));
  ok(t.name !== 'Tower 1' && t.name !== 'Tower 2',
    '6.1  ⚠️ a new tower steps over names ALREADY TAKEN, whatever order they were created in', t.name);
  ok(t.code !== 'T1' && t.code !== 'T2', '6.2  …and over taken codes', t.code);
  ok(t.typeId === 'ty1', '6.3  …and belongs to the type it was made for');
  /* Two types must not collide with each other either. */
  c.towerTypes.push({ id: 'ty2', code: 'P', name: 'Podium block' });
  c.towers.push(t);
  const u = M._twNewInstance(M.typeById('ty2'));
  ok(u.name !== t.name && u.code !== t.code,
    '6.4  ⚠️⚠️ uniqueness is PROJECT-WIDE, not per type — two towers sharing a name makes a traced site area ambiguous',
    [u.name, t.name]);
}

/* ================= 7 · migrating a config written before types existed =================== */
{
  ok(typeof M.migrateTypes === 'function',
    '7.0  ⚠️ the migration block was found in normalize() — if this fails the shape changed and the rest of this section is meaningless');
  if (typeof M.migrateTypes === 'function') {
    /* Exactly what a saved cfg looks like: towers, no typeId, no towerTypes at all. */
    const legacy = { towers: [{ id: 'twA', code: 'TA', name: 'Tower A' }, { id: 'twB', code: 'TB', name: 'Tower B' }] };
    const d = { towers: legacy.towers.map(function (t) { return { id: t.id, code: t.code, name: t.name, typeId: '' }; }) };
    M.migrateTypes(d, legacy);
    ok(d.towerTypes.length === 2,
      '7.1  ⚠️⚠️ ONE TYPE PER TOWER — one tower, one type, one layout, which is precisely the pre-types behaviour',
      d.towerTypes.length);
    ok(d.towers[0].typeId !== d.towers[1].typeId, '7.2  …and the two towers are NOT merged onto one type');
    ok(d.towerTypes.every(function (ty) { return d.towers.some(function (t) { return t.typeId === ty.id; }); }),
      '7.3  every type has an instance');

    /* Each tower is its own representative afterwards, so no floor moves. */
    const c = { locLevel: 'auto', towerTypes: d.towerTypes, towers: d.towers, activities: [],
      zoning: { GR: { floors: [] }, SW: { floors: [] },
        ST: { floors: mkFloors('twA', SHAPE).concat(mkFloors('twB', [['F1', 'typical', 1, 0]])) },
        AR: { floors: [] }, MEPF: { floors: [] }, SD: { floors: [] }, ALLIED: { floors: [] }, OT: { floors: [] } } };
    M.setCfg(c);
    ok(M.floorsOfTower('ST', 'twA').length === 3 && M.floorsOfTower('ST', 'twB').length === 1,
      '7.4  ⚠️⚠️ AND NO FLOOR MOVES — two differently-shaped towers stay two differently-shaped towers',
      [M.floorsOfTower('ST', 'twA').length, M.floorsOfTower('ST', 'twB').length]);
    ok(M.locList().length === 6, '7.5  …and the push is byte-identical in COUNT to the pre-types one, 5 + 1', M.locList().length);

    /* A type nothing points at is dropped, or the step shows a count of zero. */
    const d2 = { towers: [{ id: 'tw1', code: 'T1', name: 'Tower 1', typeId: 'keep' }] };
    M.migrateTypes(d2, { towerTypes: [{ id: 'keep', code: 'K', name: 'Kept' }, { id: 'orphan', code: 'O', name: 'Orphan' }] });
    ok(d2.towerTypes.length === 1 && d2.towerTypes[0].id === 'keep',
      '7.6  ⚠️ a type NOTHING instantiates is dropped — its floors hang off a representative that does not exist',
      d2.towerTypes.map(function (t) { return t.id; }));

    /* An already-migrated config must pass through untouched. */
    const d3 = { towers: [{ id: 'tw1', code: 'T1', name: 'Tower 1', typeId: 'ty1' }, { id: 'tw2', code: 'T2', name: 'Tower 2', typeId: 'ty1' }] };
    M.migrateTypes(d3, { towerTypes: [{ id: 'ty1', code: 'T1', name: 'Type 1' }] });
    ok(d3.towerTypes.length === 1, '7.7  ⚠️⚠️ and re-running it on an ALREADY typed config invents nothing — normalize runs on every load', d3.towerTypes.length);
    ok(d3.towers[0].typeId === 'ty1' && d3.towers[1].typeId === 'ty1', '7.8  …both towers still share their one type');
  }
}

/* ================= 8 · the number clamp ================================================== */
{
  ok(M._clampN(null, 0, 20) === 0, '8.1  an emptied number box reads as the minimum, not NaN', M._clampN(null, 0, 20));
  ok(M._clampN(999, 0, 20) === 20, '8.2  …and a value typed past the max is clamped', M._clampN(999, 0, 20));
  ok(M._clampN(-4, 0, 20) === 0, '8.3  …and below the min');
  ok(M._clampN(3.7, 0, 20) === 4, '8.4  …and a fraction is rounded, because a floor count is whole', M._clampN(3.7, 0, 20));
}

/* ================= 9 · the shipped step, read ============================================ */
/* ⚠️ These four are the only READ assertions in the suite, and they cover the things that live in
   a render function this harness cannot execute. Each names one owner requirement. */
{
  ok(/one row per type, not per tower/i.test(SRC) && /var body = types\.map\(/.test(SRC),
    '9.1  the Towers step lists TYPES, one row each');
  ok(/data-tyd="-1"/.test(SRC) && /data-tyd="1"/.test(SRC),
    '9.2  …with a − / + count control on the row — *"how many type 1 towers there are"*');
  ok(/id=\\?"b-tyadd\\?"/.test(SRC) || /id="b-tyadd"/.test(SRC),
    '9.3  …and the bar adds a TYPE, not a tower');
  ok(!/there is no separate type field/.test(SRC_NC),
    '9.4  ⚠️⚠️ the help text that said the OPPOSITE is gone, not merely softened');
  ok(/there is no separate type field/.test(SRC),
    '9.4b …and the ⚠️ note recording that it once said the opposite is KEPT — a reversal with no record is a reversal that gets reversed back');
  /* Quick setup: a pop-up, asking the four categories the owner named. */
  ok(/id="b-quick"/.test(SRC) && !/id="q-base"/.test(SRC),
    '9.5  Quick setup is a BUTTON now — the inline boxes are gone, not hidden');
  ok(/Quick setup — ' \+ GLABEL\[tr\]/.test(SRC),
    '9.6  …and it opens a psAsk dialog — *"in a pop-up window"*');
  ok(/KIND_LABEL\.basement/.test(SRC) && /KIND_LABEL\.podium/.test(SRC) &&
     /KIND_LABEL\.typical/.test(SRC) && /KIND_LABEL\.roof/.test(SRC),
    '9.7  …asking all four CATEGORIES — *"basement, podium / commercial, typical, roof deck"* — in the step’s own words');
  ok(/_kinds\.forEach\(function \(k, ix\) \{/.test(SRC) && /code: 'F' \+ \(ix \+ 1\)/.test(SRC),
    '9.8  …and the above-grade floors are ONE F1…Fn sequence, with the category saying what each floor is');
  ok(/the detailed pane below can be adjusted|Adjust anything afterwards on the floor list below/.test(SRC),
    '9.9  …and the detailed pane below is still the way to change it afterwards');
}

/* ================= 10 · the contrast build =============================================== */
/* ⚠️⚠️ A TEST THAT CANNOT FAIL IS NOT EVIDENCE. The pinned base must have none of this — and its
   floorsOfTower must NOT resolve through a type, which is the whole behaviour under test. */
{
  let base = null;
  try { base = cp.execSync('git show ' + BASE_SHA + ':modules/project-schedule/index.html',
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }); }
  catch (e) { console.log('  (contrast build skipped — ' + BASE_SHA + ' not reachable)\n'); }

  if (base) {
    ['blankTowerTypes', 'typeList', 'typeOfTower', 'towersOfType', 'repTowerOf', 'repTowerOfTower',
     '_twNewInstance', '_twSetCount'].forEach(function (n) {
      ok(base.indexOf('function ' + n + '(') < 0, '10.x  base ' + BASE_SHA + ' has no ' + n);
    });
    ok(base.indexOf('towerTypes') < 0, '10.9  …and no towerTypes anywhere in it');
    ok(sliceMigration(base) === null, '10.10  …and normalize() has no migration to run');
    /* Executed, not read: the base CANNOT express three towers of one type. */
    const B = build(base, { optional: ['blankTowerTypes', 'typeList', 'typeById', 'typeLabel', 'typeOfTower',
      'towersOfType', 'repTowerOf', 'repTowerOfTower', '_twNewInstance', '_twSetCount', '_clampN'] });
    const c = mkTypedCfg(3); B.setCfg(c);
    ok(B.floorsOfTower('ST', 'tw2').length === 0,
      '10.11  ⚠️⚠️ BASE: the second tower of a type reads NO floors — the defect this ships to fix',
      B.floorsOfTower('ST', 'tw2').length);
    ok(B.locList().length === 5,
      '10.12  …so the base pushes ONE tower’s locations for a three-tower project', B.locList().length);
  }
}

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
if (fail) { fails.forEach(function (f) { console.log('   x ' + f); }); process.exit(1); }
