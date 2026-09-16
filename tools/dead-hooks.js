/* DEAD HOOKS: a class a module queries that nothing in the app ever emits.
 *
 * ⚠️ THE INVERSE CHECK IS THE USELESS ONE. "A class with no CSS rule" flags every JS query hook —
 * `.boq-clm`, `.ec-in`, `.ec-basis`, `.ec-tot` all exist purely to be found by querySelectorAll and
 * have no style by design. An audit reporting those is noise.
 *
 * What IS a defect is the other direction, and this repo has shipped it: 2026-09-07 (b) found
 * `#pk-boq` — a correct handler bound to an id no markup carried, so the BOQ had no entry point at
 * all. A wiring function that matches nothing reads as a feature that exists.
 *
 * ⚠️⚠️ THE FIRST VERSION OF THIS FILE WAS THROWN AWAY, AND THAT IS WHY IT USES scan.js. It stripped
 * comments with a line regex, which ate every line containing a double slash inside a string, and
 * reported four live equipment-loading classes as dead. Findings from an untrustworthy scanner are
 * worse than no findings, so nothing it said was acted on. scan.js self-tests before this runs.
 */
'use strict';
const fs = require('fs'), path = require('path');
const scan = require('./scan.js');

const bad = scan.selfTest();
if (bad.length) { console.log('scan.js self-test FAILED — aborting:\n  ' + bad.join('\n  ')); process.exit(2); }

const SKIP = new Set(['.git', 'node_modules', 'docs', 'migrations', 'supabase', 'services', 'tools']);
function walk(d, o) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name), o); }
    else o.push(path.join(d, e.name).split(path.sep).join('/'));
  }
  return o;
}
const FILES = walk('.', []).filter(f => /\.(js|html)$/.test(f) && !/harness|test\.js$/.test(f));
const CLEAN = new Map(FILES.map(f => [f, scan.clean(f, fs.readFileSync(f, 'utf8'))]));

/* Every class this app EMITS. ⚠️ A class attribute here is usually built by CONCATENATION —
   `class="a' + v + ' b"` — so inside a double-quoted attribute only a double quote ends it; take
   everything to the next one and pull the literal words out. */
const emitted = new Set();
const addWords = t => { for (const c of t.split(/[^\w-]+/)) if (c && /^[a-zA-Z][\w-]*$/.test(c)) emitted.add(c); };
for (const s of CLEAN.values()) {
  for (const m of s.matchAll(/class\s*=\s*"([^"]*)"/g)) addWords(m[1]);
  for (const m of s.matchAll(/class\s*=\s*'([^']*)'/g)) addWords(m[1]);
  for (const m of s.matchAll(/className\s*(?:=|\+=)\s*[^;]{0,200}/g)) addWords(m[0]);
  for (const m of s.matchAll(/classList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g))
    for (const c of m[1].matchAll(/["'`]([\w-]+)["'`]/g)) emitted.add(c[1]);
  for (const m of s.matchAll(/setAttribute\(\s*["']class["']\s*,([^)]*)\)/g)) addWords(m[1]);
  /* ⚠️ A CLASS LIST BUILT IN AN ARRAY. equipment-loading does `cls.push('eq-edit')` and joins it
     into the attribute later, so none of the patterns above ever see it and `.eq-edit` — which is
     styled, emitted and queried — was reported dead. Any pushed class-shaped literal counts.
     This over-accepts on purpose: for a checker, missing a real dead hook is far cheaper than
     crying wolf, because one false finding is all it takes to teach people to skip the report. */
  for (const m of s.matchAll(/\.push\(\s*["']([a-zA-Z][\w-]*)["']\s*\)/g)) emitted.add(m[1]);
}

let checked = 0;
const dead = [];
for (const [f, s] of CLEAN) {
  const q = new Map();
  const grab = (sel, where) => {
    for (const c of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) if (!q.has(c[1])) q.set(c[1], where);
  };
  for (const m of s.matchAll(/querySelector(?:All)?\(\s*["'`]([^"'`]+)["'`]/g)) grab(m[1], m[1]);
  for (const m of s.matchAll(/\.closest\(\s*["'`]([^"'`]+)["'`]/g)) grab(m[1], m[1]);
  for (const [c, where] of q) {
    checked++;
    // ⚠️ A trailing-hyphen selector is a PREFIX built by concatenation ('.c-' + key) — not a class.
    if (/-$/.test(c)) continue;
    if (!emitted.has(c)) dead.push({ file: f, cls: c, sel: where });
  }
}

console.log('='.repeat(76));
console.log('DEAD HOOKS — a class queried but never emitted');
console.log('='.repeat(76));
console.log('  ' + checked + ' queried class references across ' + FILES.length + ' files');
if (!dead.length) console.log('  none — every queried class is emitted somewhere\n');
else {
  console.log('');
  for (const d of dead) console.log('  ' + d.file.padEnd(44) + '.' + d.cls + '   in  ' + d.sel);
  console.log('');
}
process.exit(dead.length ? 1 : 0);
