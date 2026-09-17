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
const OPTIONAL = ['sortCatalog'];           // absent on the base build, which is the point
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
function render(cfg, catFold, catSel) {
  const sandbox = {
    cfg, catFold, catSel, holdW: 320, xColW: {},
    XL_COLS: [{ k: 'code', label: 'Code', w: 120 }, { k: 'name', label: 'Activity name', w: 0 },
      { k: 'group', label: 'Trade', w: 150, trade: true }, { k: 'scope', label: 'Duration scope', w: 118, scope: true },
      { k: 'contract', label: 'Contract', w: 138, contract: true },
      { k: 'durInt', label: 'Interior (d)', w: 98, num: true }, { k: 'durExt', label: 'Exterior (d)', w: 98, num: true }],
    GROUPS: ['GR', 'SW', 'ST', 'AR', 'MEPF', 'SD', 'ALLIED', 'OT'],
    GLABEL: { GR: 'General Requirements', SW: 'Site Works', ST: 'Structural', AR: 'Architectural', MEPF: 'MEPF', SD: 'Site Development', ALLIED: 'Allied Services', OT: 'Others' },
    SCOPE_OPTS: [['zone', 'Per zone'], ['floor', 'Per floor']], CONTRACT_OPTS: [['main', 'Main Contract'], ['change_order', 'Change Order']],
    CLASS_CODE_DB: new Array(197),
    /* ⚠ The real palettes, read out of the file rather than invented, so 4.8 is asserting the
       colour the page actually paints on the heading. */
    GCOLOR: eval('(' + /var GCOLOR = (\{[^}]*\})/.exec(src)[1] + ')'),
    GCOLOR_DARK: eval('(' + /var GCOLOR_DARK = (\{[^}]*\})/.exec(src)[1] + ')'),
    // the chart IS loaded, so the off-chart marks are live — 'ZZZZZ' must be flagged, '' must not
    CLASS_CODES: [{ code: '03051' }, { code: '16401' }],
    ccByCode: (c) => (c === '03051' || c === '16401' ? { code: c } : null),
    offChartCount: () => 1,
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
  eq(host._missing.length, 0, '1.10 EXECUTED: no handler is wired to an id the markup does not carry');
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
  // it sits INSIDE the class-code list's own header, not in the grid toolbar
  const hdr = /<div class="sbld-hold-h">([\s\S]*?)<\/div>/.exec(h);
  ok(!!hdr && hdr[1].indexOf('id="b-custom"') !== -1, '2.3 it lives in the All class codes header, not the grid toolbar');
  const acts = /<div class="sbld-sec-actions">([\s\S]*?)<\/div>/.exec(h);
  ok(!!acts && acts[1].indexOf('b-custom') === -1, '2.4 …so the grid toolbar holds only "Load typical set"');
  // clicking it adds ONE row with a blank code
  const before = cfg.activities.length;
  const btn = host.querySelector('#b-custom');
  // ⚠ Guarded so the CONTRAST build reports three failures instead of throwing on a null and
  // taking every later section down with it — a suite that crashes proves nothing about the rest.
  if (btn && typeof btn.onclick === 'function') btn.onclick();
  eq(cfg.activities.length, before + 1, '2.5 EXECUTED: one row added');
  const added = cfg.activities[cfg.activities.length - 1] || {};
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
  ok(/data-catgrp="GR"/.test(h) && /data-catgrp="AR"/.test(h), '4.5 every heading is a toggle');
  ok(/aria-expanded="true"/.test(h) && !/aria-expanded="false"/.test(h), '4.6 open by default (what the flat list already showed)');
  // the per-item trade label is gone — it restated the heading
  ok(!/Architectural<\/span><\/button>/.test(h.replace(/sbld-hold-gname">Architectural<\/span>/g, '')),
     '4.7 an item no longer repeats its own trade under a trade heading');
  // the colour moved from the item to the heading
  ok(/class="sbld-hold-grp[^"]*" style="--zc:/.test(h), '4.8 the trade colour is on the heading');
  ok(!/class="sbld-hold-item[^"]*" data-cat="[^"]*" style="--zc:/.test(h), '4.9 …and no longer on every row');
}

/* 4b · folding actually hides that group's rows, and nothing else */
{
  const { host } = render(mkCfg(), { AR: 1 }, []);
  const h = host.innerHTML;
  const grp = /<div class="sbld-hold-grp fold" style="--zc:[^"]*"><button class="sbld-hold-gh" data-catgrp="AR"/.test(h);
  ok(grp, '4.10 a folded group carries .fold');
  ok(/data-catgrp="AR"[^>]*aria-expanded="false"/.test(h), '4.11 …and says so to assistive tech');
  ok(/data-catgrp="GR"[^>]*aria-expanded="true"/.test(h), '4.12 …while its siblings stay open');
  // the rows are still in the DOM (CSS hides them) but the heading and count survive
  eq((h.match(/class="sbld-hold-gn">/g) || []).length, 3, '4.13 folding hides rows, never the headings');
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

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' assertions passed, ' + fail + ' failed');
fails.forEach(f => console.log('  x ' + f));
process.exit(fail ? 1 : 0);
