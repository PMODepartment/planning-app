/* Schedule Setup ▸ Activities step — slice-and-execute suite.
   Slices the SHIPPED renderer out of modules/project-schedule/index.html BY NAME (never by line
   number — a 55k-line file under concurrent edit makes a line-numbered slice stale within hours)
   and runs it against a fake host, then asserts what it emitted and what it WIRED.

   Usage:   node modules/project-schedule/test-actsetup.js modules/project-schedule/index.html
   Contrast (must reproduce the OLD behaviour — flat list, Add row / Delete selected rows /
   Download template / Upload, and a per-row trash column):
     git show d0da7cd:modules/project-schedule/index.html > /tmp/base.html
     node modules/project-schedule/test-actsetup.js /tmp/base.html --base

   ⚠️⚠️ PIN THE BASE TO A SHA, NEVER TO HEAD. `git show HEAD:` becomes self-comparison the moment
   you commit, and this repo has already been caught that way twice.

   ⚠️ THE FAKE HOST RETURNS null FOR AN id THE MARKUP DOES NOT CARRY, which is what a real browser
   does — so a handler left wired to a removed button throws here exactly as it would on the page.
   That is the whole reason the wiring is executed rather than grepped.
*/
'use strict';
const fs = require('fs');
const FILE = process.argv[2] || 'modules/project-schedule/index.html';
const IS_BASE = process.argv.indexOf('--base') !== -1;
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0; const fails = [];
function ok(c, label, got) { if (c) pass++; else { fail++; fails.push(label + (got === undefined ? '' : '  [got: ' + JSON.stringify(got).slice(0, 220) + ']')); } }
function eq(a, b, label) { ok(a === b, label + ' (expected ' + JSON.stringify(b) + ')', a); }

/* ---- slicer: `\n<indent>function NAME(` then brace-match, understanding strings, comments and
   REGEX LITERALS. Copied in shape from test-lsm.js, whose own note records why the regex case is
   load-bearing: a slicer without it runs away on `/[’'".,()\-_]/g`. ---------------------------- */
function sliceFn(name, indent) {
  const needle = '\n' + ' '.repeat(indent) + 'function ' + name + '(';
  const i = src.indexOf(needle); if (i === -1) return null;
  const start = i + 1;
  let j = src.indexOf('{', i), depth = 0, inStr = null, inCom = null, inRe = false, prev = '';
  for (; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (inCom === 'line') { if (c === '\n') inCom = null; continue; }
    if (inCom === 'block') { if (c === '*' && n === '/') { inCom = null; j++; } continue; }
    if (inRe) {
      if (c === '\\') { j++; continue; }
      if (c === '[') { while (j < src.length && src[j] !== ']') { if (src[j] === '\\') j++; j++; } continue; }
      if (c === '/') { inRe = false; prev = '/'; }
      continue;
    }
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) { inStr = null; prev = 'x'; } continue; }
    if (c === '/' && n === '/') { inCom = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inCom = 'block'; j++; continue; }
    if (c === '/') { if (prev === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) !== -1) { inRe = true; continue; } prev = '/'; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') { depth++; prev = '{'; continue; }
    if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); prev = '}'; continue; }
    if (!/\s/.test(c)) prev = c;
  }
  return null;
}
function sliceAny(n) { for (const d of [2, 4, 6]) { const s = sliceFn(n, d); if (s) return s; } return null; }

/* ⚠️ A slice that comes back null ABORTS rather than being stubbed. A harness that quietly
   substitutes its own copy of the function under test measures the harness. */
const WANT = ['stActivities', 'xlCellCtl', 'gc'];
/* ⚠ `xlFieldLocked` / `actIsSap` are OPTIONAL for one reason only: they do not exist on the
   pinned base, and the base's own `xlCellCtl` therefore never calls them — so nothing is being
   stubbed in for the function under test. On the working tree both must slice, and 6.0 asserts
   exactly that, so a rename fails loudly instead of quietly reverting the lock. */
/* ⚠️⚠️ THE REAL REFERENCE TABLES, SLICED — NOT STUBBED. The 2026-09-18 pass made the pane read
   `SAP_L1_OF` / `sapKids`, and a stub of a 190-row lookup is a second copy of it: the renderer
   would then be drawing MY hierarchy and the suite would prove nothing about the shipped one. They
   are `null` on the pinned base, where the renderer never calls them. */
function sliceVar(name) {
  const re = new RegExp('\\n\\s*var ' + name + ' = ([\\[{])');
  const m = re.exec(src); if (!m) return null;
  let j = src.indexOf(m[1], m.index), depth = 0, inStr = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (!depth) return src.slice(src.indexOf(m[1], m.index), j + 1); }
  }
  return null;
}
const SAP_L1_SRC = sliceVar('SAP_L1'), SAP_L3_SRC = sliceVar('SAP_L3');
const OPTIONAL = ['sortCatalog', 'xlFieldLocked', 'actIsSap', 'sapKids', 'sapMergeKids', 'actL2Codes',
  /* the merge model — all absent on the base, and the base's renderer calls none of them */
  'actIsMerged', 'actCodes', 'normKids', 'sortActivities', 'actSelActs', 'actSelTrade',
  'actMergeCodeCount', 'mergeActs'];   // absent on the base build, which is the point
const code = {};
for (const n of WANT) { const s = sliceAny(n); if (!s) { console.log('FATAL: could not slice ' + n + ' from ' + FILE); process.exit(1); } code[n] = s; }
for (const n of OPTIONAL) { const s = sliceAny(n); if (s) code[n] = s; }
console.log('sliced: ' + Object.keys(code).join(', ') + (code.sortCatalog ? '' : '   (no sortCatalog — base build)'));

/* ---- fixture ---------------------------------------------------------------------------------
   Deliberately NOT in trade order and NOT in code order on the way in, and it carries a blank-code
   custom activity. A fixture already sorted would let a renderer that sorts nothing pass. */
function mkCfg() {
  return {
    activities: [
      { id: 'a1', code: '03051', name: 'Rebar', group: 'ST', durInt: 3, durExt: 4 },
      { id: 'a2', code: '', name: 'Client viewing platform', group: 'AR', durInt: 2, durExt: 2 },
      { id: 'a3', code: 'ZZZZZ', name: 'Off-chart thing', group: 'AR', durInt: 1, durExt: 1 }
    ],
    catalog: [
      { id: 'c1', code: '16401', name: 'Painting', group: 'AR' },
      { id: 'c2', code: '01050', name: 'Mobilization', group: 'GR' },
      { id: 'c3', code: '08601', name: 'Masonry', group: 'AR' },
      { id: 'c4', code: '02051', name: 'Excavation', group: 'SW' },
      { id: 'c5', code: '', name: 'Bespoke joinery', group: 'AR' },
      { id: 'c6', code: '01100', name: 'Temp facilities', group: 'GR' }
    ]
  };
}

/* ---- fake DOM: an element exists only if the emitted markup carries its id ------------------- */
function fakeEl(id) {
  return { id: id, onclick: null, dataset: {}, classList: { add() {}, remove() {} }, style: {},
           addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
           focus() {}, select() {} };
}
function makeHost() {
  const host = { innerHTML: '', _wired: [], _missing: [], _el: Object.create(null) };
  const idsIn = (h) => new Set((h.match(/\bid="([^"]+)"/g) || []).map(s => s.slice(4, -1)));
  /* ⚠️ MEMOISED BY id, because a real `querySelector` returns the SAME node twice. The first cut
     handed back a fresh object each call, so the handler the renderer assigned was on an object the
     test then threw away — and `btn.onclick()` was "not a function" against code that is correct.
     A stub that does not behave like the DOM invents its own failures. */
  host.querySelector = function (sel) {
    const m = /^#([\w-]+)$/.exec(sel);
    if (m) {
      if (idsIn(host.innerHTML).has(m[1])) { host._wired.push(m[1]); return (host._el[m[1]] || (host._el[m[1]] = fakeEl(m[1]))); }
      host._missing.push(m[1]); return null;
    }
    return null;                                        // 'table.sbld-xl' etc. — geometry, not under test
  };
  host.querySelectorAll = function (sel) {
    const out = [];
    const attr = /^\[([\w-]+)\]$/.exec(sel);
    if (attr) { const re = new RegExp('\\b' + attr[1] + '="([^"]*)"', 'g'); let m2;
      while ((m2 = re.exec(host.innerHTML))) { const e = fakeEl(null); e.dataset[attr[1].replace(/^data-/, '').replace(/-(\w)/g, (x, y) => y.toUpperCase())] = m2[1]; out.push(e); } }
    return out;
  };
  return host;
}

/* ---- run the shipped renderer ---------------------------------------------------------------- */
function render(cfg, holdCol, catSel, holdQ, actSel, actExp) {
  const sandbox = {
    cfg, holdCol, catSel, holdQ: holdQ || '', holdW: 320, xColW: {},
    actSel: (arguments.length > 4 ? arguments[4] : []) || [], actExp: (arguments.length > 5 ? arguments[5] : {}) || {},
    psPrompt() {}, psConfirm() {},
    XL_COLS: [{ k: 'code', label: 'Code', w: 120 }, { k: 'name', label: 'Activity name', w: 0 },
      { k: 'group', label: 'Trade', w: 150, trade: true }, { k: 'scope', label: 'Duration scope', w: 118, scope: true },
      { k: 'contract', label: 'Contract', w: 138, contract: true },
      { k: 'durInt', label: 'Interior (d)', w: 98, num: true }, { k: 'durExt', label: 'Exterior (d)', w: 98, num: true }],
    GROUPS: ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'],
    GLABEL: { GR: 'General Requirements', SW: 'Site Works', ST: 'Structural', AR: 'Architectural', MEPF: 'MEPF', SD: 'Site Development', ALLIED: 'Allied Services', OT: 'Others' },
    SCOPE_OPTS: [['zone', 'Per zone'], ['floor', 'Per floor']], CONTRACT_OPTS: [['main', 'Main Contract'], ['change_order', 'Change Order']],
    CLASS_CODE_DB: new Array(197),
    /* ⚠ `holdExp` is the L2→L3 fold state the 2026-09-18 pass added; empty here, so the default
       "show only to level 2" is what every assertion below measures — which is the owner's own
       stated default and therefore the right state to be testing. */
    holdExp: {},
    SAP_L1: SAP_L1_SRC ? eval('(' + SAP_L1_SRC + ')') : [],
    SAP_L3: SAP_L3_SRC ? eval('(' + SAP_L3_SRC + ')') : {},
    SAP_L1_OF: (function () {
      if (!SAP_L1_SRC) return {};
      const m = {}; eval('(' + SAP_L1_SRC + ')').forEach(function (g, i) {
        (g[2] || []).forEach(function (c) { m[c] = { i: i, name: g[0], trade: g[1] }; });
      });
      return m;
    })(),
    /* ⚠ The real palettes, read out of the file rather than invented, so 4.8 is asserting the
       colour the page actually paints on the heading. */
    GCOLOR: eval('(' + /var GCOLOR = (\{[^}]*\})/.exec(src)[1] + ')'),
    GCOLOR_DARK: eval('(' + /var GCOLOR_DARK = (\{[^}]*\})/.exec(src)[1] + ')'),
    // the chart IS loaded, so the off-chart marks are live — 'ZZZZZ' must be flagged, '' must not
    CLASS_CODES: [{ code: '03051' }, { code: '16401' }],
    ccByCode: (c) => (c === '03051' || c === '16401' ? { code: c } : null),
    /* ⚠⚠ THE GROUP LEVEL IS IN THE STUB, and it has to be: `_seedCodeUnknown` moved off the
       item-only `ccByCode` onto `ccLevelOf` on 2026-09-18 because every `+ Library` row — the
       standard way of filling this grid — is a level-2 GROUP code and was being marked red on a
       build with nothing wrong. A stub that resolved only items would let that bug pass again. */
    ccLevelOf: (c) => (c === '03051' || c === '16401' ? 'item' : (c === '03050' ? 'group' : null)),
    xlGet: (a, k) => (a[k] == null ? '' : String(a[k])),
    scopeLabel: (v) => v || 'zone', contractLabel: (v) => v || 'main',
    e2: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _stepNo: () => '3', _sbldHow: (h) => '<div class="how">' + h + '</div>',
    uidv: () => 'new1', markDirty() {}, render() {},
    loadClassCodeLibrary() {}, loadBoqCodes() {},
    /* ⚠ For the CONTRAST build only — the base still wires these two, and they are what this
       change deletes. Stubbed rather than sliced because what is under test is whether the
       BUTTONS exist, not what they did. On the working tree nothing references them. */
    actTemplateCsv() {}, uploadActivities() {},
    document: { documentElement: { classList: { contains: () => false } }, querySelector: () => null,
                addEventListener() {}, removeEventListener() {} },
    UI: { toast() {} }, PDGrid: { attach: () => ({ detach() {}, selectedIds: () => [] }) }, _xlG: null,
    xlSetById() {}, _xlBatch: false
  };
  const body = Object.keys(code).map(k => code[k]).join('\n') +
    '\n;var host = __host; ' + (code.sortCatalog ? '' : '') + 'stActivities(host, false); return host;';
  const names = Object.keys(sandbox);
  const fn = new Function(...names, '__host', body);
  const host = makeHost();
  return { host: fn(...names.map(n => sandbox[n]), host), sandbox };
}

/* =============================================================================================
   1 · THE FOUR REMOVED CONTROLS
   ============================================================================================= */
{
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  ok(!/id="b-delrows"/.test(h), '1.1 "Delete selected rows" is gone');
  ok(!/id="b-add"/.test(h), '1.2 "+ Add row" is gone');
  ok(!/id="b-tmpl"/.test(h), '1.3 "Download template" is gone');
  ok(!/id="b-upl"/.test(h) && !/id="b-uplfile"/.test(h), '1.4 "Upload CSV / Excel" and its file input are gone');
  ok(!/Download template/.test(h) && !/Upload CSV/.test(h), '1.5 …and so are their labels');
  ok(/id="b-seed"/.test(h), '1.6 "Load typical set" survives — the owner did not ask for it');
  ok(/id="b-load"/.test(h) && /id="b-unload"/.test(h), '1.7 the ← / → shuttle survives (the removal route)');
  // the per-row trash column, which was dead in the same way
  ok(!/xl-rowact/.test(h), '1.8 the dead per-row trash column is gone');
  ok(!/data-del=/.test(h), '1.9 …and with it the last unhandled data-del in this step');
  /* ⚠⚠ THIS IS THE ASSERTION THE WHOLE SUITE EXISTS FOR, and it had to be sharpened rather than
     relaxed. A handler left behind over deleted markup is `#pk-boq` again: `querySelector` returns
     null, `.onclick =` throws, and every control wired BELOW it in the same function is silently
     never bound. The stub returns null for a missing id exactly as the DOM does, so an unguarded
     one throws here just as it would on the page — that is what `render()` completing at all
     proves. What `_missing` cannot see is whether the caller GUARDED the lookup, so a bare
     `length === 0` fails on a control that is conditionally rendered and correctly guarded
     (`#b-holdq`, which appears only above 8 codes or while a query is live — this fixture has 6).
     So: nothing REMOVED may be looked up, and anything else that misses must be on this list with
     its guard named. */
  const OPTIONAL = { 'b-holdq': 'rendered only above 8 codes or while a query is live — wired behind `if (hq)`',
                     'b-aclear': 'rendered only while rows are ticked in the gutter — wired behind `if (acBtn)`' };
  const REMOVED = ['b-delrows', 'b-add', 'b-tmpl', 'b-upl', 'b-uplfile'];
  eq(host._missing.filter(id => REMOVED.indexOf(id) >= 0).join(','), '',
     '1.10 EXECUTED: no handler is left wired to a control this pass removed');
  eq(host._missing.filter(id => !OPTIONAL[id]).join(','), '',
     '1.11 EXECUTED: and every other lookup that misses is a conditionally-rendered control, guarded');
  // and the source agrees: the removed ids are not referenced anywhere in the file, handler or not
  eq(REMOVED.filter(id => new RegExp("querySelector\\(['\"]#" + id + "['\"]").test(src)).join(','), '',
     '1.12 …nothing anywhere in the module still queries a removed id');
}

/* =============================================================================================
   2 · + CUSTOM — the add control, in the class-code list, blank code
   ============================================================================================= */
{
  const cfg = mkCfg();
  const { host } = render(cfg, {}, []);
  const h = host.innerHTML;
  ok(/id="b-custom"/.test(h), '2.1 "+ Custom" exists');
  ok(host._wired.indexOf('b-custom') !== -1, '2.2 EXECUTED: it is wired');
  /* ⚠⚠ RETARGETED, NOT DELETED, and these two used to assert the OPPOSITE: 2.3 read *"it lives
     in the All class codes header, not the grid toolbar"* and 2.4 *"…so the grid toolbar holds only
     Load typical set"*. Both were correct until the owner moved it — *"the add custom activities
     button should be beside load typical set"* (2026-09-17) — so they now pin the new position with
     the same strictness, in both directions. On the pinned base they fail, which is what keeps the
     contrast honest. */
  const hdr = /<div class="sbld-hold-h">([\s\S]*?)<\/div>/.exec(h);
  ok(!!hdr && hdr[1].indexOf('id="b-custom"') === -1, '2.3 it has LEFT the SAP Activities header');
  const acts = /<div class="sbld-sec-actions">([\s\S]*?)<\/div>/.exec(h);
  ok(!!acts && acts[1].indexOf('id="b-custom"') !== -1, '2.4 …and sits beside "Load typical set"');
  ok(!!acts && acts[1].indexOf('id="b-seed"') < acts[1].indexOf('id="b-custom"'),
     '2.4b "Load typical set" first, "+ Custom" beside it — the owner\'s own order');
  // clicking it adds ONE row with a blank code
  const before = cfg.activities.length;
  const btn = host.querySelector('#b-custom');
  // ⚠ Guarded so the CONTRAST build reports three failures instead of throwing on a null and
  // taking every later section down with it — a suite that crashes proves nothing about the rest.
  if (btn && typeof btn.onclick === 'function') btn.onclick();
  eq(cfg.activities.length, before + 1, '2.5 EXECUTED: one row added');
  /* ⚠⚠ FOUND BY ID, NOT BY POSITION — and this assertion used to read
     `cfg.activities[cfg.activities.length - 1]`, which stopped being the new row the moment the
     build became trade-sorted (2026-09-17): a fresh custom row defaults to Structural and lands in
     the ST run, with the Architectural rows after it. The handler was always right — it focuses
     the cell by the id it just minted — so this is the TEST's assumption breaking, not the code's.
     Keyed on the id now, which is true under any ordering. */
  const known = new Set(mkCfg().activities.map(x => x.id));
  const added = cfg.activities.find(x => !known.has(x.id)) || {};
  eq(added.code, '', '2.6 …with a BLANK class code — a custom activity');
  eq(added.contract, 'main', '2.7 …on the main contract, like any other new row');
}

/* =============================================================================================
   3 · CUSTOM ACTIVITIES ARE IDENTIFIED
   ============================================================================================= */
{
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  ok(/data-f="code"[^>]*placeholder="custom"|placeholder="custom"[^>]*data-f="code"/.test(h),
     '3.1 the Code cell says "custom" when it is blank');
  // and only the code cell — a blank NAME must not claim to be a custom activity
  const phs = (h.match(/placeholder="custom"/g) || []).length;
  eq(phs, cfg0CodeCells(h), '3.2 …on every code cell and nowhere else');
  function cfg0CodeCells(html) { return (html.match(/data-f="code"/g) || []).length; }
  // the off-chart warning must NOT fire on a blank code
  ok(!/sbld-badcode[^>]*>\s*<input[^>]*data-f="code"[^>]*value=""/.test(h), '3.3 a blank code is not marked as an unknown code');
  const badCells = (h.match(/sbld-badcode/g) || []).length;
  eq(badCells, 1, '3.4 exactly one row is marked off-chart (ZZZZZ), not the blank-code one');
}

/* =============================================================================================
   4 · THE CLASS-CODE LIST: grouped by trade, collapsible, not bold
   ============================================================================================= */
{
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  const heads = [...h.matchAll(/class="sbld-hold-gname">([^<]+)</g)].map(m => m[1]);
  ok(heads.length > 0, '4.1 the list is grouped');
  eq(heads.join(' | '), 'General Requirements | Site Works | Architectural',
     '4.2 one heading per trade, in the app\'s own GROUPS order — and no heading for a trade with no codes');
  const counts = [...h.matchAll(/class="sbld-hold-gn">(\d+)</g)].map(m => +m[1]);
  eq(counts.join(','), '2,1,3', '4.3 each heading carries its own count');
  eq(counts.reduce((a, b) => a + b, 0), 6, '4.4 …and they sum to the catalogue — no code is dropped by the grouping');
  /* ⚠⚠ RETARGETED ONTO THE MARKUP THAT SHIPS, NOT WEAKENED. This section was written against
     this pass's own `<div class="sbld-hold-grp fold"><button class="sbld-hold-gh" data-catgrp>`
     group header. A native `<details>`/`<summary>` group landed on `main` first (PR #138) and is
     what the renderer emits, so every assertion below now names `data-grp` and the `open`
     attribute. The PROPERTY each one protects is unchanged — grouped, counted, foldable, open by
     default, colour on the heading and not on the row. */
  ok(/data-grp="GR"/.test(h) && /data-grp="AR"/.test(h), '4.5 every group is addressable, so it can be folded');
  eq((h.match(/<details class="sbld-hold-grp" open /g) || []).length, 3,
     '4.6 open by default — what the flat list already showed');
  // the per-item trade label is gone — it restated the heading
  ok(!/Architectural<\/span><\/button>/.test(h.replace(/sbld-hold-gname">Architectural<\/span>/g, '')),
     '4.7 an item no longer repeats its own trade under a trade heading');
  // the colour moved from the item to the heading
  ok(/<details class="sbld-hold-grp"[^>]*style="--zc:/.test(h), '4.8 the trade colour is on the heading');
  ok(!/class="sbld-hold-item[^"]*" data-cat="[^"]*"[^>]*style="--zc:/.test(h),
     '4.9 …and no longer on every row — the rail it fed is gone, so the variable would be unread');
}

/* 4b · folding actually shuts that group, and nothing else */
{
  const { host } = render(mkCfg(), { AR: 1 }, []);
  const h = host.innerHTML;
  ok(/<details class="sbld-hold-grp" data-grp="AR"/.test(h),
     '4.10 a folded group is a <details> with no `open`');
  ok(/<details class="sbld-hold-grp" open data-grp="GR"/.test(h), '4.11 …while its siblings stay open');
  eq((h.match(/class="sbld-hold-gn">/g) || []).length, 3, '4.12 folding shuts a group, it never removes the heading');
  /* ⚠⚠ A LIVE SEARCH OVERRIDES THE FOLD — the one property of this pair most easily lost, and the
     reason the shipped code keeps the fold state rather than clearing it: a trade folded shut while
     the query matches inside it reads as "nothing found". Same fold state, a query on top. */
  const hq = render(mkCfg(), { AR: 1 }, [], '0860').host.innerHTML;
  ok(/<details class="sbld-hold-grp" open data-grp="AR"/.test(hq),
     '4.13 …unless a query is live, in which case the folded trade opens to show its hits');
  ok(!/<details class="sbld-hold-grp"[^>]*data-grp="GR"/.test(hq),
     '4.14 …and a trade with no hit is not rendered at all, rather than shown empty');
}

/* =============================================================================================
   5 · sortCatalog — the array, not just the view
   ============================================================================================= */
if (code.sortCatalog) {
  const cfg = mkCfg();
  const fn = new Function('cfg', 'GROUPS', code.sortCatalog + '\n;sortCatalog(); return cfg.catalog;');
  const out = fn(cfg, ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT']);
  eq(out.map(a => a.group + ':' + (a.code || '-')).join(' '),
     'GR:01050 GR:01100 SW:02051 AR:08601 AR:16401 AR:-',
     '5.1 trade order, then code ascending, blank (custom) last within its trade');
  ok(out[0].code === '01050', '5.2 a leading zero is never stripped — string compare, not numeric');
  // idempotent, and it is the ARRAY that is sorted, so ← loads in the order you see
  const again = fn({ catalog: out.slice() }, ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT']);
  eq(again.map(a => a.id).join(','), out.map(a => a.id).join(','), '5.3 stable / idempotent');
} else {
  ok(IS_BASE, '5.0 sortCatalog exists (absent here — base build)');
}

/* 5b · the rendered order follows the sorted array */
if (code.sortCatalog) {
  const cfg = mkCfg();
  new Function('cfg', 'GROUPS', code.sortCatalog + '\n;sortCatalog();')(cfg, ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT']);
  const { host } = render(cfg, {}, []);
  const codes = [...host.innerHTML.matchAll(/class="sbld-hold-code">([^<]*)</g)].map(m => m[1]);
  eq(codes.join(' '), '01050 01100 02051 08601 16401 custom',
     '5.4 what the planner reads is the order ← will load them in');
}

/* 5c · the LOAD path sorts too, so a setup saved before this change reads sorted on first paint */
if (code.sortCatalog) {
  const arr = [{ id: 'x', code: '16401', group: 'AR' }, { id: 'y', code: '01050', group: 'GR' }];
  const out = new Function('GROUPS', 'cfg', code.sortCatalog + '\n;return sortCatalog(arguments[2]);')
    (['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'], null, arr);
  eq(out.map(a => a.id).join(','), 'y,x', '5.5 sortCatalog sorts an array it is handed, with no cfg at all');
  ok(out === arr, '5.6 …and RETURNS it, so `d.catalog = sortCatalog(...)` cannot yield undefined');
  eq(new Function('GROUPS', 'cfg', code.sortCatalog + '\n;return sortCatalog([]).length;')
    (['GR'], null), 0, '5.7 an empty catalogue survives the round trip as []');
  ok(/d\.catalog = sortCatalog\(/.test(src), '5.8 normalize() runs it on load');
}

/* =============================================================================================
   6 · NOTHING ELSE MOVED
   ============================================================================================= */
{
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  ok(/id="b-boq"/.test(h) && /id="b-lib"/.test(h), '6.1 + From BOQ and + Library survive');
  ok(/id="b-holdgrip"/.test(h), '6.2 the resize grip survives');
  ok(/class="sbld-cell"/.test(h) || /sbld-cell/.test(h), '6.3 the grid still emits PDGrid cells');
  const cells = (h.match(/data-f="code"/g) || []).length;
  eq(cells, 3, '6.4 one row per activity, still');
  ok(/Load typical set/.test(h), '6.5 Load typical set still reachable');
}

/* =============================================================================================
   7 · THE LOCKED CELLS — Code never editable, Trade locked on a SAP row
   Owner 2026-09-17: *"when adding custom activity, code should not be editable and should always
   be blank. if activity comes from SAP, trade should also be not editable/locked."*
   ⚠⚠ The rule is asserted BOTH on the predicate (executed) and on what the renderer emits, because
   a readonly attribute alone stops typing and nothing else — paste, Ctrl+D and Delete all reach
   `xlSetById`, and that is what `xlFieldLocked` is there to refuse.
   ============================================================================================= */
if (!IS_BASE) {
  ok(!!code.xlFieldLocked && !!code.actIsSap, '7.0 both predicates slice on the working tree');
  const F = new Function('GROUPS', 'GLABEL',
    code.actIsSap + '\n' + code.xlFieldLocked + '\n; return { actIsSap: actIsSap, xlFieldLocked: xlFieldLocked };')(
    ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'], {});
  const sap = { id: 'x', code: '03051', group: 'ST' };
  const cust = { id: 'y', code: '', group: 'AR' };

  ok(F.actIsSap(sap) === true, '7.1 a row carrying a code came from SAP');
  ok(F.actIsSap(cust) === false, '7.2 a blank code is a custom activity');
  ok(F.actIsSap({ code: '   ' }) === false, '7.3 whitespace is not a code');

  ok(F.xlFieldLocked(sap, 'code') === true, '7.4 Code is locked on a SAP row');
  ok(F.xlFieldLocked(cust, 'code') === true, '7.5 Code is locked on a custom row too — always blank');
  ok(F.xlFieldLocked(sap, 'group') === true, '7.6 Trade is locked on a SAP row');
  ok(F.xlFieldLocked(cust, 'group') === false, '7.7 …and EDITABLE on a custom row, which is the only way to trade it');
  /* ⚠ The columns that must stay editable. Locking one of these by accident is the failure this
     block would otherwise never notice — a lock is invisible until somebody tries to type. */
  ['name', 'durInt', 'durExt', 'scope', 'contract'].forEach(k => {
    ok(F.xlFieldLocked(sap, k) === false, '7.8 ' + k + ' stays editable on a SAP row');
    ok(F.xlFieldLocked(cust, k) === false, '7.9 ' + k + ' stays editable on a custom row');
  });

  // …and the renderer actually emits it
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  const codeCells = h.match(/<input[^>]*data-f="code"[^>]*>/g) || [];
  eq(codeCells.length, 3, '7.10 three Code cells');
  ok(codeCells.every(c => /readonly/.test(c)), '7.11 EVERY Code cell is readonly');
  ok(codeCells.every(c => /sbld-cell/.test(c) && /data-f="code"/.test(c)),
     '7.12 …and still a PDGrid cell, so the column order cannot shift');
  // a1/a3 carry codes -> locked trade; a2 is custom -> a real <select>
  const tradeSel = h.match(/<select[^>]*data-f="group"[^>]*>/g) || [];
  const tradeLock = h.match(/<input[^>]*data-f="group"[^>]*>/g) || [];
  eq(tradeSel.length, 1, '7.13 exactly one editable Trade — the custom row');
  eq(tradeLock.length, 2, '7.14 …and the two SAP rows are locked');
  ok(tradeLock.every(c => /readonly/.test(c)), '7.15 the locked Trade cells are readonly');
  ok(/placeholder="custom"/.test(h), '7.16 the blank code still reads "custom"');
}

/* =============================================================================================
   8 · THE WRITER REFUSES A LOCKED FIELD — the half a readonly attribute cannot do
   ============================================================================================= */
if (!IS_BASE) {
  ok(/function xlSetById\(id, k, text\) \{\s*\n\s*var a = xlActById\(id\); if \(!a\) return;\s*\n\s*if \(xlFieldLocked\(a, k\)\) return;/.test(src),
     '8.1 xlSetById refuses a locked field BEFORE any branch runs');
  ok(/function t4Set\(a, k, text\) \{[\s\S]{0,400}?if \(xlFieldLocked\(a, k\)\) return;/.test(src),
     '8.2 the trade-sequence grid obeys the same rule through its own writer');
}

/* =============================================================================================
   9 · THE BUILD GRID IS GROUPED BY TRADE — and it groups the ARRAY, not the view
   Owner 2026-09-17: *"The selected activity table should also be grouped by trade."*
   ⚠⚠ The load-bearing assertion is 9.4: this step's own hint says row order IS the fallback
   sequence and `generate()` reads `cfg.activities` in order, so a renderer that grouped only what
   it drew would show one order and build another. Same argument `sortCatalog` already won.
   ============================================================================================= */
if (!IS_BASE) {
  const cfg = mkCfg();               // ST, AR, AR on the way in — deliberately not grouped
  cfg.activities.push({ id: 'a4', code: '01051', name: 'Mobilization', group: 'GR', durInt: 1, durExt: 1 });
  const { host } = render(cfg, {}, []);
  const h = host.innerHTML;

  const heads = [...h.matchAll(/<span class="sbld-xlgrp-n">([^<]*)<\/span>/g)].map(m => m[1]);
  eq(heads.join(' | '), 'General Requirements | Structural | Architectural',
     '9.1 one heading per trade, in the app\'s own GROUPS order');
  const counts = [...h.matchAll(/<span class="sbld-xlgrp-c">(\d+)<\/span>/g)].map(m => +m[1]);
  eq(counts.join(','), '1,1,2', '9.2 each heading carries its own count');
  eq(counts.reduce((a, b) => a + b, 0), cfg.activities.length,
     '9.3 …and they sum to the build — no activity is dropped by the grouping');

  /* ⚠ THE ARRAY ITSELF. If this ever passes while 9.1 fails, the renderer has started sorting its
     own output and the push will build a different order from the one on screen. */
  eq(cfg.activities.map(a => a.group).join(','), 'GR,ST,AR,AR',
     '9.4 sortActivities reordered cfg.activities, not just the drawing');
  /* ⚠ STABLE: a2 and a3 were in that relative order on the way in and must stay in it — the
     sequence a planner set inside a trade is not the grouping's to change. */
  eq(cfg.activities.filter(a => a.group === 'AR').map(a => a.id).join(','), 'a2,a3',
     '9.5 …and stably, so the order INSIDE a trade survives');

  // a trade with nothing in it gets no heading at all
  ok(heads.indexOf('MEPF') === -1, '9.6 a trade with no activities gets no heading');
  // an unknown trade is bucketed, never dropped
  const cfg2 = mkCfg();
  cfg2.activities.push({ id: 'a9', code: '99999', name: 'Odd one', group: 'NOPE', durInt: 1, durExt: 1 });
  const h2 = render(cfg2, {}, []).host.innerHTML;
  ok(/sbld-xlgrp-n">Unclassified</.test(h2), '9.7 a row with an unknown trade lands in a named bucket');
  eq([...h2.matchAll(/<span class="sbld-xlgrp-c">(\d+)<\/span>/g)].map(m => +m[1]).reduce((a, b) => a + b, 0),
     cfg2.activities.length, '9.8 …and is still counted');
}

/* =============================================================================================
   10 · THE CHECKBOX GUTTER
   Owner 2026-09-17: *"on the left, instead of numbers, use checkboxes."*
   ============================================================================================= */
if (!IS_BASE) {
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  const cks = h.match(/<input type="checkbox" class="sbld-xlck"[^>]*>/g) || [];
  eq(cks.length, 3, '10.1 one checkbox per activity');
  ok(cks.every(c => /data-asel="/.test(c)), '10.2 …each addressing its own row');
  /* ⚠ The gutter must NOT be a PDGrid cell, or ticking a box would move the grid's cell focus and
     the Tab order would run through a control that writes nothing. */
  ok(!/<td class="xl-rn"[^>]*>[\s\S]{0,200}?sbld-cell/.test(h),
     '10.3 the gutter carries no .sbld-cell — PDGrid does not index it');
  ok(!/<td class="xl-rn"[^>]*>\s*\d+\s*<\/td>/.test(h), '10.4 and the row NUMBER is gone');

  // ticked state round-trips, and the heading counts it
  const h3 = render(mkCfg(), {}, [], '', ['a2', 'a3']).host.innerHTML;
  eq((h3.match(/class="sbld-xlck"[^>]*checked/g) || []).length, 2, '10.5 a ticked row renders checked');
  ok(/sbld-xlgrp-s">2 selected</.test(h3), '10.6 …and its trade heading says how many');
  ok(/id="b-aclear"/.test(h3), '10.7 a Clear button appears once anything is ticked');
  ok(!/id="b-aclear"/.test(h), '10.8 …and not before');
}

/* =============================================================================================
   11 · MERGING — the rule, the payload, and the refusals
   Owner 2026-09-17: *"this merged activity carries the class codes of all its child activities.
   activity merging is only allowed within the same trade."*
   ============================================================================================= */
if (!IS_BASE) {
  const mk = (sel) => {
    const cfg = mkCfg();
    cfg.activities = [
      { id: 'm1', code: '03051', name: 'Rebar', group: 'ST', durInt: 3, durExt: 4 },
      { id: 'm2', code: '04051', name: 'Formworks', group: 'ST', durInt: 2, durExt: 2 },
      { id: 'm3', code: '10101', name: 'Tiling', group: 'AR', durInt: 5, durExt: 5 }
    ];
    return cfg;
  };
  const run = (cfg, sel, name) => {
    const toasts = [];
    const sandbox = {
      cfg, GROUPS: ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'],
      GLABEL: { GR: 'General Requirements', SW: 'Site Works', ST: 'Structural', AR: 'Architectural', MEPF: 'MEPF', SD: 'Site Development', ALLIED: 'Allied Services', OT: 'Others' },
      actExp: {}, uidv: () => 'MERGED', markDirty() {}, render() {},
      UI: { toast: (t, k) => toasts.push(k + ': ' + t) }
    };
    /* ⚠⚠ `actSel` IS DECLARED INSIDE THE BODY, NOT PASSED AS A PARAMETER. `mergeActs` clears the
       selection with `actSel = []`, which in the real module rebinds a module-scope var — but a
       parameter of the same name is a LOCAL binding, so the reassignment would be invisible from
       out here and 11.8 would fail against correct code. Declaring it in the body and handing it
       back makes the clear observable, which is the only way to assert it at all. */
    const body = 'var actSel = __sel;\n' +
      ['actCodes', 'actIsMerged', 'normKids', 'sortActivities', 'actSelActs', 'actSelTrade', 'mergeActs']
      .map(k => code[k]).join('\n') + '\n; return { ok: mergeActs(__name), sel: actSel };';
    const names = Object.keys(sandbox);
    const r = new Function(...names, '__name', '__sel', body)(...names.map(n => sandbox[n]), name, sel);
    return { cfg, outcome: r.ok, toasts, actSel: r.sel };
  };

  // --- the happy path
  {
    const r = run(mk(), ['m1', 'm2'], 'Structural frame');
    ok(r.outcome === true, '11.1 EXECUTED: a same-trade merge succeeds');
    eq(r.cfg.activities.length, 2, '11.2 two rows became one');
    const m = r.cfg.activities.find(a => a.id === 'MERGED') || {};
    eq(m.name, 'Structural frame', '11.3 it takes the name it was given');
    eq(m.group, 'ST', '11.4 …and the trade both children were in');
    eq((m.kids || []).map(k => k.code).join(','), '03051,04051',
       '11.5 it CARRIES BOTH class codes — the whole point of the merge');
    eq(m.code, '03051', '11.6 …and pushes the first, because project_schedule stores one');
    eq(m.durInt + '/' + m.durExt, '5/6', '11.7 durations are summed, not maxed');
    eq(r.actSel.length, 0, '11.8 the selection is cleared — nothing is left primed');
    ok(r.toasts.some(t => /success/.test(t) && /class code/.test(t)), '11.9 …and it says what it did');
  }
  // --- the refusal that matters
  {
    const r = run(mk(), ['m1', 'm3']);
    ok(r.outcome === false, '11.10 EXECUTED: a cross-trade merge is REFUSED');
    eq(r.cfg.activities.length, 3, '11.11 …and nothing is changed');
    /* ⚠️⚠️ RETARGETED, NOT WEAKENED — the property under test is unchanged and the bar is HIGHER.
       This read `/warn/ && /different trades/`. Owner 2026-09-18: *"when merging activities from
       different trades, although it does not push thru, provide error notif."* So the refusal is
       now an `error` rather than a `warn` (nothing happened — a warn toast in this app reads as
       "it went through, with a caveat"), and it NAMES the trades instead of saying only that they
       differ. Both are asserted; the old wording would now pass a message that named neither. */
    ok(r.toasts.some(t => /error/.test(t) && /Cannot merge/.test(t)),
       '11.12 …refused out loud, as an error rather than a warning');
    ok(r.toasts.some(t => /Structural/.test(t) && /Architectural/.test(t)),
       '11.12b …and the message NAMES both trades, which is what makes it actionable', r.toasts);
  }
  // --- one row is not a merge
  {
    const r = run(mk(), ['m1']);
    ok(r.outcome === false, '11.13 one selected row cannot merge');
    eq(r.cfg.activities.length, 3, '11.14 …and nothing is changed');
  }
  // --- merging a merged row FLATTENS rather than nests
  {
    const cfg = mk();
    cfg.activities = [
      { id: 'p1', code: '03051', name: 'Frame', group: 'ST', durInt: 5, durExt: 6,
        kids: [{ code: '03051', name: 'Rebar', group: 'ST' }, { code: '04051', name: 'Formworks', group: 'ST' }] },
      { id: 'p2', code: '05051', name: 'Concreting', group: 'ST', durInt: 2, durExt: 3 }
    ];
    const r = run(cfg, ['p1', 'p2'], 'Structure');
    const m = r.cfg.activities.find(a => a.id === 'MERGED') || {};
    eq((m.kids || []).map(k => k.code).join(','), '03051,04051,05051',
       '11.15 a merge of a merged row FLATTENS — one list of codes, never a tree');
    ok((m.kids || []).every(k => !k.kids), '11.16 …and no child carries children of its own');
  }
  // --- a custom activity has no code to carry, and must not fabricate one
  {
    const cfg = mk();
    cfg.activities = [
      { id: 'c1', code: '', name: 'Bespoke joinery', group: 'AR', durInt: 2, durExt: 2 },
      { id: 'c2', code: '10101', name: 'Tiling', group: 'AR', durInt: 5, durExt: 5 }
    ];
    const r = run(cfg, ['c1', 'c2'], 'Finishes');
    const m = r.cfg.activities.find(a => a.id === 'MERGED') || {};
    eq((m.kids || []).length, 2, '11.17 a code-less child is still carried — by name');
    eq((m.kids || []).map(k => k.code).join(','), ',10101', '11.18 …with its code left blank, not invented');
    eq(m.code, '', '11.19 …and the merged row leads with the first child, blank or not');
  }
}

/* =============================================================================================
   12 · MERGED ROWS RENDER AS A COLLAPSIBLE GROUPING
   ============================================================================================= */
if (!IS_BASE) {
  const cfg = mkCfg();
  cfg.activities = [{ id: 'g1', code: '03051', name: 'Frame', group: 'ST', durInt: 5, durExt: 6,
    kids: [{ code: '03051', name: 'Rebar', group: 'ST' }, { code: '04051', name: 'Formworks', group: 'ST' }] }];

  const shut = render(cfg, {}, [], '', [], {}).host.innerHTML;
  ok(/data-actexp="g1"/.test(shut), '12.1 a merged row gets a caret');
  ok(/aria-expanded="false"/.test(shut), '12.2 …shut by default');
  eq((shut.match(/sbld-xlkid/g) || []).length, 0, '12.3 …and its children are not drawn');
  ok(/sbld-xlmore"[^>]*>\s*\+1</.test(shut) || /sbld-xlmore/.test(shut),
     '12.4 the Code cell says it carries more than one');

  const open = render(cfg, {}, [], '', [], { g1: true }).host.innerHTML;
  ok(/aria-expanded="true"/.test(open), '12.5 expanding flips the caret');
  eq((open.match(/<tr class="sbld-xlkid">/g) || []).length, 2, '12.6 …and draws one row per child');
  ok(/Rebar/.test(open) && /Formworks/.test(open), '12.7 …naming each of them');
  /* ⚠ A child row must carry NO editable cell: it is a record on `kids`, and `xlSetById` would
     answer null for its id — a cell PDGrid indexes but no writer can reach. */
  const kidRows = open.match(/<tr class="sbld-xlkid">[\s\S]*?<\/tr>/g) || [];
  ok(kidRows.length && kidRows.every(r => r.indexOf('sbld-cell') === -1),
     '12.8 a child row is read-only by construction — no .sbld-cell at all');
  // an ordinary row is untouched by any of it
  const plain = render(mkCfg(), {}, []).host.innerHTML;
  eq((plain.match(/data-actexp=/g) || []).length, 0, '12.9 an unmerged row has no caret');
  eq((plain.match(/sbld-xlmore/g) || []).length, 0, '12.10 …and no extra-codes badge');
}

/* =============================================================================================
   13 · + Library SKIPS WHAT THE BUILD ALREADY HAS — including inside a merge
   Owner 2026-09-17: *"when adding Library, if activity is already in the activity list, no need to
   include in SAP Activities list."*
   ============================================================================================= */
if (!IS_BASE) {
  const F = new Function('GROUPS', code.actCodes + '\n; return actCodes;')(['ST']);
  eq(F({ code: '03051' }).join(','), '03051', '13.1 an ordinary activity carries its own code');
  eq(F({ code: '03051', kids: [{ code: '03051' }, { code: '04051' }] }).join(','), '03051,04051',
     '13.2 a MERGED activity carries every child code, deduped');
  eq(F({ code: '' }).length, 0, '13.3 a custom activity carries none');
  eq(F(null).length, 0, '13.4 …and a missing row does not throw');
  /* ⚠ The loaders must read `actCodes`, not `a.code` — reading the bare field would re-offer every
     code a merge had swallowed. Asserted on the source because both loaders are async and reach
     the network; what matters is which reader they use. */
  const dedup = (src.match(/\(cfg\.activities \|\| \[\]\)\.concat\(cfg\.catalog \|\| \[\]\)\.forEach\(function \(a\) \{ actCodes\(a\)/g) || []).length;
  eq(dedup, 2, '13.5 BOTH loaders dedupe on actCodes — + Library and + From BOQ');
  ok(!/forEach\(function \(a\) \{ if \(a\.code\) have\[/.test(src),
     '13.6 …and neither reads the bare `a.code` any more, which would miss a merged row\'s children');
}

/* =============================================================================================
   14 · THE CONTRAST'S OWN HALF — what the base build must still look like
   ⚠⚠ Sections 9-13 are gated `if (!IS_BASE)` because the functions they execute do not exist on
   the pinned base and a slice that came back null would abort the run. That gate would let the new
   work go unproved, so these run on the BASE instead and assert the OLD shape. They must FAIL on
   the working tree and PASS on the base — which is what makes "30 failures on the base" mean the
   change is real rather than merely that the base is old.
   ============================================================================================= */
{
  const { host } = render(mkCfg(), {}, []);
  const h = host.innerHTML;
  if (IS_BASE) {
    ok(/<td class="xl-rn" data-r="0">1<\/td>/.test(h), '14.1 BASE: the gutter is a row NUMBER');
    ok(h.indexOf('sbld-xlck') === -1, '14.2 BASE: there are no checkboxes');
    ok(h.indexOf('sbld-xlgrp') === -1, '14.3 BASE: the build grid is flat — no trade headings');
    ok(h.indexOf('id="b-merge"') === -1, '14.4 BASE: there is no Merge control');
  } else {
    ok(!/<td class="xl-rn" data-r="0">1<\/td>/.test(h), '14.1 the row number is gone');
    ok(h.indexOf('sbld-xlck') !== -1, '14.2 checkboxes replace it');
    ok(h.indexOf('sbld-xlgrp') !== -1, '14.3 the build grid carries trade headings');
    ok(h.indexOf('id="b-merge"') !== -1, '14.4 …and a Merge control');
  }
}


/* =============================================================================================
   15 · THE OFF-CHART MARK RESOLVES BOTH LEVELS  (2026-09-18)
   ⚠️⚠️ THE BUG THIS CATCHES: `_seedCodeUnknown` used the ITEM-ONLY `ccByCode`, so every level-2
   GROUP code read as "not in the chart" — and `+ Library`, the standard way of filling this grid,
   loads nothing but group codes. A healthy build lit a red mark on all 190 of its own rows and a
   counted caution above them. `offChartCount` at the foot of the step had been corrected for
   exactly this on 2026-09-10; the per-cell mark and its banner were left behind.
   ============================================================================================= */
if (!IS_BASE) {
  const cfg = { activities: [
      { id: 'g1', code: '03050', name: 'Rebar (group)', group: 'ST', durInt: 1, durExt: 1 },
      { id: 'g2', code: '03051', name: 'Rebar (item)', group: 'ST', durInt: 1, durExt: 1 },
      { id: 'g3', code: 'ZZZZZ', name: 'Off chart', group: 'ST', durInt: 1, durExt: 1 },
      { id: 'g4', code: '', name: 'Custom', group: 'ST', durInt: 1, durExt: 1 }
    ], catalog: [] };
  const H = render(cfg, {}, [], '').host.innerHTML;
  const bad = (H.match(/sbld-badcode/g) || []).length;
  eq(bad, 1, '15.1 ⚠⚠ exactly ONE row is marked off-chart — the group code is NOT accused', bad);
  ok(/<b>1<\/b> of 4 codes/.test(H), '15.2 …and the banner counts the same one', H.slice(H.indexOf('pd-caution'), H.indexOf('pd-caution') + 140));
  ok(!/is not in the class-code chart/.test(H), '15.3 the old wording is gone — banner AND cell tooltip');
  ok(/at either level/.test(H), '15.4 …replaced by one that says which levels were tried');
  ok(/re-pick from/i.test(H), '15.5 …and names the remedy the lower warning used to carry');
  /* ⚠️ ONE warning, not two: the foot of the step used to restate this 200px lower. */
  eq((H.match(/at either level/g) || []).length, 1, '15.6 ⚠ stated ONCE, not at both ends of the screen');
  /* And a clean build says nothing at all. */
  const clean = render({ activities: [{ id: 'c1', code: '03050', name: 'Rebar', group: 'ST', durInt: 1, durExt: 1 }], catalog: [] }, {}, [], '').host.innerHTML;
  eq((clean.match(/sbld-badcode/g) || []).length, 0, '15.7 a build of GROUP codes is marked nowhere');
  ok(!/pd-caution/.test(clean), '15.8 …and raises no caution at all');
}

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' assertions passed, ' + fail + ' failed');
fails.forEach(f => console.log('  x ' + f));
process.exit(fail ? 1 : 0);
