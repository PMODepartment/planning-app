// tools/loc-key-agree.js - run: node tools/loc-key-agree.js
//
// The location merge key exists TWICE on purpose, and this proves the two copies still agree.
//
//   assets/js/locmatch.js            PDLoc.normKey        (shared; contracts-claims loads it)
//   modules/project-schedule/...     _locNormKeyCalc      (private to the schedule module)
//
// ⚠️⚠️ WHY THERE ARE TWO, AND WHY THAT WAS THE RIGHT CALL. The 2026-09-10 (z1) pass extracted
// PDLoc after finding THREE copies, one of which was wrong (it missed "Roof Deck" vs "Roofdeck"
// and matched a 13th-floor leaf to "3rd Floor"). It deliberately did NOT rewrite the schedule's
// copy: that file is ~46k lines under concurrent edit and the function decides every location
// grouping in the Vertical Stacking, so the swap is its own commit with its own verification.
// The stated safety net was "the suite asserts PDLoc agrees with it over a spelling corpus".
//
// ⚠️⚠️ THAT SUITE WAS NEVER COMMITTED, so the net did not exist. This file is it.
//
// ⚠️ IT IS A MONEY PATH, which is why a comment is not enough. boqDerive splits a BOQ line's
// amount across the activities a location match resolves -> project_schedule.planned_cost ->
// schedule_scurve_agg's w_cost -> Cash Flow's cash-in. A normaliser that drifts on one spelling
// moves money to the wrong floor, and every screen downstream reports it as fact.
//
// WHAT IT DOES NOT COVER: PDLoc.contains / bestSpelling / spellRank have no counterpart in the
// schedule, so only the KEY is compared. And agreeing is not the same as being right - both
// could be wrong together; the corpus below is what pins the behaviour itself.

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var PS_REL = 'modules/project-schedule/index.html';
var LM_REL = 'assets/js/locmatch.js';

/* ------------------------------------------------------------------ slicing */

// By NAME, never by line number - a 46k-line file under concurrent edit makes a
// line-numbered slice stale within hours.
function sliceFn(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at === -1) return null;
  var i = src.indexOf('{', at), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return depth ? null : src.slice(at, j + 1);
}

function sliceObjVar(src, name) {
  var m = new RegExp('var\\s+' + name + '\\s*=\\s*\\{').exec(src);
  if (!m) return null;
  var i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return depth ? null : src.slice(m.index, j + 1) + ';';
}

/* ------------------------------------------------------------------ corpus */

// Every entry is a spelling this repo has actually met, or the pair a recorded defect turned on.
var CORPUS = [
  'Roof Deck', 'Roofdeck', 'ROOF DECK', 'Roof  deck',
  '3rd Floor', '3RD FLOOR', 'Third Floor', 'third floor', '3 Floor',
  '13th Floor', 'Thirteenth Floor', '8th Floor', 'Eight Floor', 'Eighth Floor',
  '9th Floor', 'Nineth Floor', 'Ninth Floor', '18th Floor', '10th Floor', 'Tenth Floor',
  'Ground Floor', 'Ground floor', 'GROUND FLOOR', 'Lower Ground', 'Upper Ground',
  'Ground Reservoir', 'Podium Amenities', 'Podium 2', 'Mezzanine',
  'B1', 'B-1', 'Basement 1', 'B3', 'Tower 1', 'Tower D - Substructure',
  'Zone 1', 'Z1', 'Unit A', '2ND FLOOR', '2nd  Floor', "Owner's Suite",
  'Penthouse', 'PH', 'Level 5', 'L5', '5TH Floor', '', null, undefined, '   ', '42'
];

/* ----------------------------------------------------------------- compare */

function strip(s) {
  return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ').trim();
}

// Compare one (ordMap, fn) pair against another. Returns a list of complaints.
function compare(a, b) {
  var out = [];
  var aK = Object.keys(a.ord), bK = Object.keys(b.ord);
  var onlyA = aK.filter(function (k) { return !(k in b.ord); });
  var onlyB = bK.filter(function (k) { return !(k in a.ord); });
  var diff = aK.filter(function (k) { return k in b.ord && a.ord[k] !== b.ord[k]; });
  if (onlyA.length) out.push('ordinal words only in ' + a.name + ': ' + onlyA.join(', '));
  if (onlyB.length) out.push('ordinal words only in ' + b.name + ': ' + onlyB.join(', '));
  if (diff.length) out.push('ordinal words mapping to different numbers: ' + diff.join(', '));
  if (a.body !== b.body) {
    out.push('the function bodies differ once the ORD name is normalised');
    out.push('   ' + a.name + ': ' + a.body);
    out.push('   ' + b.name + ': ' + b.body);
  }
  CORPUS.forEach(function (v) {
    var x = a.fn(v), y = b.fn(v);
    if (x !== y) {
      out.push('"' + String(v) + '" normalises differently: ' + a.name + '=' +
               JSON.stringify(x) + '  ' + b.name + '=' + JSON.stringify(y));
    }
  });
  return out;
}

function build(name, ordSrc, fnSrc, fnName, ordName) {
  var box = {};
  vm.createContext(box);
  vm.runInContext(ordSrc + '\n' + fnSrc + '\nthis.f = ' + fnName + '; this.o = ' + ordName + ';',
                  box, { filename: name });
  return {
    name: name, fn: box.f, ord: box.o,
    body: strip(fnSrc).replace(fnName, 'F').replace(new RegExp(ordName, 'g'), 'ORD')
  };
}

/* --------------------------------------------------------------- self-test */

// Each mutation below is a way the two copies could really drift. A checker that has never
// failed proves nothing, so every check must be shown to fire before any of them is trusted.
function selfTest() {
  var ORD = 'var ORD = { third: 3, eighth: 8, nineth: 9 };';
  var FN = 'function F(v) {\n' +
    "  var s = String(v == null ? '' : v).toLowerCase();\n" +
    '  s = s.replace(/[a-z]+/g, function (w) { return ORD[w] != null ? String(ORD[w]) : w; });\n' +
    '  s = s.replace(/(\\d+)(st|nd|rd|th)(?![a-z])/g, "$1");\n' +
    '  return s.replace(/[^a-z0-9]+/g, "");\n}';
  var base = build('base', ORD, FN, 'F', 'ORD');

  var cases = [
    ['identical copies raise nothing', build('twin', ORD, FN, 'F', 'ORD'), 0],
    ['a MISSING ordinal word is caught',
     build('twin', 'var ORD = { third: 3, eighth: 8 };', FN, 'F', 'ORD'), 1],
    ['an ordinal word mapped to the WRONG number is caught',
     build('twin', 'var ORD = { third: 3, eighth: 80, nineth: 9 };', FN, 'F', 'ORD'), 1],
    ['a dropped ordinal-suffix strip is caught',
     build('twin', ORD, FN.replace(/\s*s = s\.replace\(\/\(\\d\+\).*\n/, '\n'), 'F', 'ORD'), 1],
    ['a dropped separator strip is caught',
     build('twin', ORD, FN.replace("return s.replace(/[^a-z0-9]+/g, \"\");", 'return s;'),
           'F', 'ORD'), 1]
  ];

  var bad = 0;
  cases.forEach(function (c) {
    var found = compare(base, c[1]).length;
    var pass = c[2] === 0 ? found === 0 : found > 0;
    if (!pass) bad++;
    console.log('  ' + (pass ? 'ok  ' : 'FAIL') + '  ' + c[0] +
                (pass ? '' : '   [complaints: ' + found + ']'));
  });
  return bad;
}

/* -------------------------------------------------------------------- main */

console.log('self-tests:');
if (selfTest()) { console.error('\nSELF-TEST FAILED - not reporting.'); process.exit(2); }
console.log('');

var PS = fs.readFileSync(path.join(ROOT, PS_REL), 'utf8');
var LM = fs.readFileSync(path.join(ROOT, LM_REL), 'utf8');

var psCalc = sliceFn(PS, '_locNormKeyCalc');
var psOrd = sliceObjVar(PS, 'LOC_ORD');
var lmCalc = sliceFn(LM, '_normCalc');
var lmOrd = sliceObjVar(LM, 'ORD');

// ⚠️ A slice that silently returns null must ABORT, never quietly compare nothing and pass.
[['_locNormKeyCalc', psCalc], ['LOC_ORD', psOrd], ['_normCalc', lmCalc], ['ORD', lmOrd]]
  .forEach(function (p) {
    if (!p[1]) {
      console.error('COULD NOT SLICE ' + p[0] + ' - it was renamed or moved. ' +
                    'That is a finding, not a pass.');
      process.exit(2);
    }
  });

var schedule = build('schedule', psOrd, psCalc, '_locNormKeyCalc', 'LOC_ORD');
var shared = build('PDLoc', lmOrd, lmCalc, '_normCalc', 'ORD');

// PDLoc must also really assign itself - the z6 outage was an export that threw on the way out.
var box = { window: {} };
vm.createContext(box);
vm.runInContext(LM, box, { filename: LM_REL });
if (!box.window.PDLoc || typeof box.window.PDLoc.normKey !== 'function') {
  console.error('locmatch.js did not assign window.PDLoc.normKey'); process.exit(2);
}

var complaints = compare(schedule, shared);

console.log('ordinal maps: schedule ' + Object.keys(schedule.ord).length +
            ' words, PDLoc ' + Object.keys(shared.ord).length + ' words');
console.log('corpus: ' + CORPUS.length + ' spellings executed through BOTH implementations');
console.log('');

if (complaints.length) {
  console.log('=== THE TWO COPIES HAVE DRIFTED (' + complaints.length + ') ===');
  complaints.forEach(function (c) { console.log('  ' + c); });
  console.log('');
  console.log('This is a money path: a key that drifts moves a BOQ line to the wrong floor.');
  process.exit(1);
}

// The behaviour itself, not merely agreement - both could be wrong together.
var f = schedule.fn, props = [
  ['"Roof Deck" and "Roofdeck" merge', f('Roof Deck') === f('Roofdeck')],
  ['"3rd Floor" and "Third Floor" merge', f('3rd Floor') === f('Third Floor')],
  ['13th and 3rd stay APART', f('13th Floor') !== f('3rd Floor')],
  ['8th and 18th stay APART', f('8th Floor') !== f('18th Floor')],
  ['the "Nineth" typo folds onto 9th', f('Nineth Floor') === f('9th Floor')]
];
var pbad = 0;
props.forEach(function (p) {
  if (!p[1]) pbad++;
  console.log('  ' + (p[1] ? 'ok  ' : 'FAIL') + '  ' + p[0]);
});
console.log('');
if (pbad) { console.log('=== ' + pbad + ' BEHAVIOUR CHECK(S) FAILED ==='); process.exit(1); }
console.log('=== the schedule\'s private copy and the shared PDLoc agree, and both behave ===');
