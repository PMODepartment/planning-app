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
  '_twNewInstance', '_twRemoveTower', '_clampN',
  /* ⚠️⚠️ THE 2026-09-18 RESHAPE. The ± count control (`_twSetCount`) is gone — owner:
     *"when add type is clicked, a grouping is added. when development is clicked, a row is added
     inside"* — so developments are now added and removed one row at a time. The property that
     control protected (never drop the representative, whose floors the whole type reads) did NOT
     go with it: it moved into `_twRemoveTower`, which moves the floors instead of refusing, and
     section 5 asserts that rather than the arithmetic of a control nobody presses any more. */
  'layoutOwners', 'ownerOfTower', 'towerLinks', 'pruneLinks', 'START', 'END'
];
const VARS = ['GROUPS', 'GLABEL', 'LOCLESS'];

/* ⚠️⚠️ THE MIGRATION IS LIFTED AS SOURCE TEXT, NOT RETYPED. It lives inside normalize(), which is
   a two-hundred-line function with a tail of dependencies this suite has no business dragging in
   — but re-implementing the migration here would make the suite agree with itself rather than
   with the file. So the SHIPPED lines are cut out by their own anchors and executed as-is: if the
   block is edited into a different shape the cut fails and the suite stops, which is the point. */
/* ⚠️ The cut now STARTS at `var _hadTypes`, because that guard is the migration: it is what
   decides whether an untyped tower is a pre-types config to migrate or a standalone development to
   leave alone, and a slice that began below it would test the loop without the question. */
function sliceMigration(src) {
  const m = src.match(/\n(\s*)var _hadTypes = Array\.isArray\(c\.towerTypes\);[\s\S]*?d\.towerTypes = d\.towerTypes\.filter\(function \(ty\) \{[^\n]*\n/);
  if (!m) return null;
  return 'function migrateTypes(d, c) {\n' +
    'function _rmk(v) { return String(v == null ? "" : v).trim().slice(0, 300); }\n' +
    m[0] + '\nreturn d;\n}\n';
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
  /* ⚠️ `uiTower` is module state `_twRemoveTower` repoints when the active development goes —
     supplied, like `cfg`, because it IS the document's UI state rather than a rule under test. */
  const pre = 'var cfg = null;\nvar uiTower = null;\nvar _seq = 0;\nfunction uidv() { return "u" + (++_seq); }\n';
  const post = '\nreturn { ' + have.map(function (n) { return n + ': ' + n; }).join(', ') +
    ', setCfg: function (c) { cfg = c; }, getCfg: function () { return cfg; },' +
    ' setUiTower: function (v) { uiTower = v; }, getUiTower: function () { return uiTower; },' +
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
    links: [],
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
  c.towers.push(M._twNewInstance(M.typeById('ty1')));
  c.towers.push(M._twNewInstance(M.typeById('ty1')));
  ok(M.floorsOf('ST').length === before, '3.6  ⚠️⚠️ adding two more developments adds NO floors — nothing is copied', M.floorsOf('ST').length);
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

/* ================= 5 · adding and removing developments ================================= */
/* ⚠️⚠️ THIS SECTION USED TO TEST THE ± COUNT CONTROL, AND IT IS RETARGETED RATHER THAN WEAKENED.
   Owner 2026-09-18 made a development a ROW, so the count control went — but the property it
   existed to protect is unchanged and is now STRICTER: a type's floors hang off its FIRST
   instance, so the old control simply refused to touch that one (it removed from the end).
   `_twRemoveTower` lets you remove any row and MOVES the floors to the next instance instead,
   which is the case the old control could not express at all. */
{
  const c = mkTypedCfg(2); M.setCfg(c); M.setUiTower('tw1');
  const t3 = M._twNewInstance(M.typeById('ty1')); c.towers.push(t3);
  const t4 = M._twNewInstance(M.typeById('ty1')); c.towers.push(t4);
  const names = M.towersOfType('ty1').map(function (t) { return t.name; });
  ok(new Set(names).size === 4, '5.1  ⚠️ each development has a DISTINCT name — the stacking joins areas to developments by name', names);
  const codes = M.towersOfType('ty1').map(function (t) { return t.code; });
  ok(new Set(codes).size === 4, '5.2  …and a distinct code, which is built into every generated activity id', codes);

  const repBefore = M.repTowerOf('ty1');
  c.towerLinks = [{ from: 'tw1', to: t4.id, type: 'FS', lag: 0 }];
  ok(M._twRemoveTower(t4.id) === true, '5.3  removing a development reports that it changed');
  ok(M.towersOfType('ty1').length === 3, '5.4  …and three are left', M.towersOfType('ty1').length);
  ok(M.repTowerOf('ty1') === repBefore, '5.5  removing a NON-representative leaves the representative alone', [M.repTowerOf('ty1'), repBefore]);
  ok(c.towerLinks.length === 0, '5.6  …and a tower relationship naming one that no longer exists goes with it', c.towerLinks);

  /* ⚠️⚠️ THE ONE THAT PROTECTS THE LAYOUT. */
  ok(M.floorsOfTower('ST', repBefore).length === 3, '5.7  precondition: the representative holds the type’s three floors', M.floorsOfTower('ST', repBefore).length);
  const next = M.towersOfType('ty1')[1].id;
  M._twRemoveTower(repBefore);
  ok(M.repTowerOf('ty1') === next, '5.8  removing the representative promotes the next instance', [M.repTowerOf('ty1'), next]);
  ok(M.floorsOfTower('ST', next).length === 3,
    '5.9  ⚠️⚠️ AND THE FLOORS MOVED WITH IT — the layout is still reachable, which is the whole reason the old control refused this',
    M.floorsOfTower('ST', next).length);
  ok(M.floorsOf('ST').length === 3, '5.10  …without copying anything: still three rows', M.floorsOf('ST').length);
  ok(M.getUiTower() !== repBefore, '5.11  …and the active development is no longer one that was deleted', M.getUiTower());

  /* The last development of a type takes the type — and the floors, which nothing is left to own. */
  M._twRemoveTower(M.towersOfType('ty1')[1].id);
  c.towers.push({ id: 'solo1', code: 'CH', name: 'Clubhouse', typeId: '' });
  const last = M.towersOfType('ty1')[0].id;
  M._twRemoveTower(last);
  ok(M.typeById('ty1') === null, '5.12  the last development of a type takes the TYPE with it — a type with no instance has no representative');
  ok(M.floorsOf('ST').length === 0, '5.13  …and its floors, because nothing is left to own them', M.floorsOf('ST').length);

  ok(M._twRemoveTower('solo1') === false,
    '5.14  ⚠️ the ONLY development in the project cannot be removed — the step would have nothing to hang a layout off');
  ok(M.towerList().length === 1, '5.15  …so it is still there', M.towerList().length);
}

/* ================= 5b · layout owners ==================================================== */
/* ⚠️⚠️ A DEVELOPMENT "BESIDE" THE TYPES IS INVISIBLE TO `typeList()`, which is the reason this
   helper exists at all: the selector bar and the Towers table both used to iterate types, so a
   standalone development would have vanished from the chips the moment it was created — leaving
   no way to reach its floors. */
{
  const c = mkTypedCfg(2);
  c.towers.push({ id: 'solo1', code: 'CH', name: 'Clubhouse', typeId: '' });
  c.zoning.ST.floors = c.zoning.ST.floors.concat(mkFloors('solo1', [['F1', 'typical', 1, 0]]));
  M.setCfg(c);
  const O = M.layoutOwners();
  ok(O.length === 2, '5b.1  two owners — one type, one standalone development', O.length);
  ok(O[0].kind === 'type' && O[0].towers.length === 2 && O[0].rep === 'tw1',
    '5b.2  the type owns both of its developments, and its representative is the first', [O[0].kind, O[0].towers.length, O[0].rep]);
  ok(O[1].kind === 'solo' && O[1].rep === 'solo1',
    '5b.3  ⚠️⚠️ …and the standalone one is its OWN owner', [O[1].kind, O[1].rep]);
  ok(M.ownerOfTower('tw2').id === 'ty1', '5b.4  every development resolves to the owner whose floors it reads', M.ownerOfTower('tw2').id);
  ok(M.ownerOfTower('solo1').id === 'solo1', '5b.5  …and a standalone one to itself');
  ok(M.floorsOfTower('ST', 'solo1').length === 1 && M.floorsOfTower('ST', 'tw1').length === 3,
    '5b.6  …and the two read different floors, which is what "beside it" has to mean',
    [M.floorsOfTower('ST', 'solo1').length, M.floorsOfTower('ST', 'tw1').length]);
  ok(M.locList().length === 11, '5b.7  …so the push carries 5 × 2 plus the standalone’s 1', M.locList().length);
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

    /* ⚠️⚠️ THE 2026-09-18 CASE, AND IT IS THE ONE THE MIGRATION COULD SILENTLY UNDO. A
       development BESIDE the types is a tower with NO typeId — the very shape the pre-types
       migration was written to convert. Run unconditionally it would invent a type for it on every
       load, so "beside" would quietly become "a one-instance type" and its row would move under a
       grouping the planner never created. The guard is the presence of the `towerTypes` KEY. */
    const d4 = { towers: [{ id: 'tw1', code: 'T1', name: 'Tower 1', typeId: 'ty1' },
                          { id: 'ch', code: 'CH', name: 'Clubhouse', typeId: '' }] };
    M.migrateTypes(d4, { towerTypes: [{ id: 'ty1', code: 'T1', name: 'Type 1' }] });
    ok(d4.towers[1].typeId === '',
      '7.9  ⚠️⚠️ A STANDALONE DEVELOPMENT SURVIVES THE RELOAD — no type is invented for it',
      d4.towers[1].typeId);
    ok(d4.towerTypes.length === 1, '7.10  …and the type list is not grown by it', d4.towerTypes.length);

    /* ⚠️ A typeId naming a type that is no longer there becomes standalone rather than dangling:
       it would otherwise BEHAVE as standalone (repTowerOfTower falls back to the tower) while
       still reading as typed on every screen. */
    const d5 = { towers: [{ id: 'tw1', code: 'T1', name: 'Tower 1', typeId: 'ty1' },
                          { id: 'tw2', code: 'T2', name: 'Tower 2', typeId: 'gone' }] };
    M.migrateTypes(d5, { towerTypes: [{ id: 'ty1', code: 'T1', name: 'Type 1' }] });
    ok(d5.towers[1].typeId === '', '7.11  a typeId pointing at a type that no longer exists is cleared, not left dangling', d5.towers[1].typeId);

    /* And `remarks` has to be on normalize()'s whitelist or the column empties on the next load. */
    const d6 = { towers: [{ id: 'tw1', code: 'T1', name: 'Tower 1', typeId: 'ty1', remarks: 'north block' }] };
    M.migrateTypes(d6, { towerTypes: [{ id: 'ty1', code: 'T1', name: 'Type 1', remarks: '16F' }] });
    ok(d6.towerTypes[0].remarks === '16F',
      '7.12  ⚠️⚠️ `remarks` SURVIVES normalisation — a key this whitelist does not name is dropped on the next save',
      d6.towerTypes[0].remarks);
  }
}

/* ⚠️ The tower half of the same whitelist, read straight out of the shipped normalize(): the
   migration slice above starts below `d.towers = …`, so it cannot cover it. */
{
  ok(/remarks: _rmk\(t\.remarks\)/.test(SRC),
    '7.13  …and so does a DEVELOPMENT’s, on the same whitelist one line above');
  ok((SRC.match(/remarks: _rmk\(t\.remarks\)/g) || []).length === 2,
    '7.14  …on both, which is what stops one of the two columns emptying on reload',
    (SRC.match(/remarks: _rmk\(t\.remarks\)/g) || []).length);
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
  /* ⚠️⚠️ RETARGETED 2026-09-18, NOT WEAKENED. Owner: *"replace the buttons on top with Add
     Type, Add Development … for this table, strict only to two levels … columns should include
     Name, Code, Remarks."* So the table lists both rungs and the ± count is gone; each assertion
     below names the clause it holds. */
  ok(/\+ Add Type</.test(SRC) && /\+ Add Development</.test(SRC),
    '9.1  the two buttons above the table are Add Type and Add Development');
  ok(/<th>Name<\/th><th>Code<\/th><th>Remarks<\/th>/.test(SRC),
    '9.2a …and the columns are Name, Code, Remarks');
  ok(/\[data-tyk\]/.test(SRC) && /\[data-twk\]/.test(SRC) &&
     /'data-tyk'/.test(SRC) && /'data-twk'/.test(SRC),
    '9.2b …emitted AND wired on BOTH rungs — a type is a grouping row, a development is a row inside it');
  ok(!/data-tyd/.test(SRC_NC),
    '9.2c ⚠️ and the ± count control is GONE, not hidden — three developments are three rows now, so a number beside the type would state the same fact twice');
  ok(/var SITE_PLAN_UI = false/.test(SRC),
    '9.2d ⚠️ the site-plan option is hidden behind one flag — *"Hide first option to add site plans"*');
  ok(/SITE_PLAN_UI && TR\.multi/.test(SRC),
    '9.2e …and the markup is gated on it rather than deleted, so bringing it back is one word');
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
     '_twNewInstance', 'layoutOwners', 'ownerOfTower', '_twRemoveTower'].forEach(function (n) {
      ok(base.indexOf('function ' + n + '(') < 0, '10.x  base ' + BASE_SHA + ' has no ' + n);
    });
    ok(base.indexOf('towerTypes') < 0, '10.9  …and no towerTypes anywhere in it');
    ok(sliceMigration(base) === null, '10.10  …and normalize() has no migration to run');
    /* Executed, not read: the base CANNOT express three towers of one type. */
    const B = build(base, { optional: ['blankTowerTypes', 'typeList', 'typeById', 'typeLabel', 'typeOfTower',
      'towersOfType', 'repTowerOf', 'repTowerOfTower', '_twNewInstance', '_twRemoveTower', '_clampN',
      'layoutOwners', 'ownerOfTower', 'towerLinks'] });
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
