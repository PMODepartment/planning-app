/* DEAD EXPORTS: a key on a module's public object that NOTHING in the repo ever reads.
 *
 * ⚠️⚠️ THIS CLASS SURVIVED EVERY OTHER CHECKER, AND IT HAS PRODUCED FIVE FINDINGS IN ONE MODULE.
 * `wiring-check.js` proves the other direction — every cross-module CALL names a key its provider
 * really exports — so a call to a missing key is caught. The inverse is not: an export nothing
 * calls is a complete, tested, documented function with no way in. The Project Schedule has shipped
 * that shape five times (`openLocAdopt`, `fillDown`'s change-order branch, `cfg.floorLag`,
 * `cfg.tradeLeads`, and `ScheduleBuilder.setupOrderLabels`, which is what prompted this file).
 *
 * ⚠️ IT ALSO CANNOT SEE CLOSURE-LOCAL SURFACES, which is the specific hole here. `ScheduleBuilder`
 * is a `var` inside the Project Schedule's IIFE — never assigned to `window` — so wiring-check,
 * which loads scripts and enumerates their globals, cannot reach it at all. This reads the SOURCE
 * instead, so `window.X = (function(){...})()` and `var X = (function(){...})()` are both covered.
 *
 * ⚠️⚠️ IT DELIBERATELY UNDER-REPORTS. A key whose name is a common property word (`open`, `render`,
 * `name`) cannot be told apart from an unrelated `.open` elsewhere in the repo, so it is reported as
 * live even if it is not. That is the right way round: `dead-hooks.js` records that findings from an
 * untrustworthy scanner are worse than no findings, because nothing it said got acted on.
 *
 * Usage: node tools/dead-exports.js
 */
'use strict';
const fs = require('fs'), path = require('path');
const scan = require('./scan.js');

const bad = scan.selfTest();
if (bad.length) { console.log('scan.js self-test FAILED — aborting:\n  ' + bad.join('\n  ')); process.exit(2); }

/* ------------------------------------------------------------------ source walking */
const SKIP = new Set(['.git', 'node_modules', 'docs', 'migrations', 'supabase', 'services', 'tools']);
function walk(d, o) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name), o); }
    else o.push(path.join(d, e.name).split(path.sep).join('/'));
  }
  return o;
}

/* Brace-match forward from `i`, skipping strings, template literals and regex literals.
   ⚠️ REGEX LITERALS MATTER: this repo has `/[’'".,()\-_]/g`, which holds both quote characters.
   A matcher that entered string mode on that apostrophe runs away to the end of the file — the
   exact fault the LSM suite's slicer hit and had to be rewritten for. */
function matchBrace(s, i) {
  let depth = 0, inStr = null, inRe = false, prev = '';
  for (let j = i; j < s.length; j++) {
    const c = s[j], n = s[j + 1];
    if (inRe) {
      if (c === '\\') { j++; continue; }
      if (c === '[') { while (j < s.length && s[j] !== ']') { if (s[j] === '\\') j++; j++; } continue; }
      if (c === '/') { inRe = false; prev = '/'; }
      continue;
    }
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) { inStr = null; prev = 'x'; }
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) !== -1)) { inRe = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') { depth++; prev = '{'; continue; }
    if (c === '}') { depth--; if (depth === 0) return j; prev = '}'; continue; }
    if (!/\s/.test(c)) prev = c;
  }
  return -1;
}

/* Top-level keys of the object literal whose `{` is at `open`. */
function keysOf(s, open) {
  const end = matchBrace(s, open);
  if (end === -1) return [];
  const out = [];
  let depth = 0, inStr = null, inRe = false, prev = '', lineStart = open;
  for (let j = open; j <= end; j++) {
    const c = s[j], n = s[j + 1];
    if (inRe) {
      if (c === '\\') { j++; continue; }
      if (c === '[') { while (j <= end && s[j] !== ']') { if (s[j] === '\\') j++; j++; } continue; }
      if (c === '/') { inRe = false; prev = '/'; }
      continue;
    }
    if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) { inStr = null; prev = 'x'; } continue; }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(prev) !== -1)) { inRe = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; prev = c; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; prev = c; continue; }
    /* depth 1 = directly inside the object literal */
    if (depth === 1 && /[A-Za-z_$]/.test(c) && !/[\w$.]/.test(prev || ' ')) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(s.slice(j, j + 80));
      if (m) { out.push(m[1]); j += m[0].length - 1; prev = ':'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

/* The `{` of the object returned by the IIFE ITSELF — the one `return` that sits directly in the
   body, at brace depth 0 relative to it.
   ⚠️⚠️ "THE LAST `return {` IN THE BODY" IS WRONG, AND IT IS WRONG SILENTLY. That was the first
   version, and on `ScheduleBuilder` it picked a nested helper's return object: it reported six keys
   (`code, rows, inExec, fellBack, milestones, allLeaves`) none of which are exports, missed all
   ~20 real ones INCLUDING the dead `setupOrderLabels` this file was written for, and then declared
   two of the wrong object's keys dead. A scanner that confidently names the wrong thing is worse
   than one that finds nothing. */
function returnObjAtDepth1(s, open, end) {
  /* ⚠️⚠️ BY STRUCTURE, NOT BY WALKING A DEPTH COUNTER ACROSS 800 KB.
     The second attempt tracked brace depth from the IIFE's `{` and took the first `return {` at
     depth 0. Over the Project Schedule's ~800 KB body the counter drifts — one mis-read regex or
     template literal and it never returns to 0 again — and it found NOTHING at all, which is the
     same silent wrongness as the first attempt in the other direction.
     The export object has an exact, local signature instead: it is the `return {...}` whose closing
     brace is the LAST thing in the body, with only whitespace and semicolons between it and the
     IIFE's own `}`. That is checkable in a few characters and cannot drift. */
  let at = open;
  for (;;) {
    const r = s.indexOf('return', at);
    if (r === -1 || r > end) return -1;
    at = r + 6;
    if (!/^\s*\{/.test(s.slice(r + 6, r + 46))) continue;
    if (/[\w$.]/.test(s[r - 1] || ' ')) continue;          /* not the keyword */
    const objOpen = s.indexOf('{', r);
    const objEnd = matchBrace(s, objOpen);
    if (objEnd === -1) continue;
    if (/^[\s;]*$/.test(s.slice(objEnd + 1, end))) return objOpen;
  }
}

/* The public surface of every `NAME = (function () { ... return {...}; })()`.
   ⚠️⚠️ EVERY PARSE IS VERIFIED, AND AN UNVERIFIED ONE IS SKIPPED AND NAMED.
   `matchBrace` is a heuristic tokenizer, and on the Project Schedule's ~800 KB inline script it
   OVER-RAN: ScheduleBuilder's "body end" landed past the end of the NEXT closure, so the export
   object it found belonged to neither. Two earlier versions of this file reported confident
   nonsense from that (`inExec`, `allLeaves` — keys of an internal helper).
   So the body's closing brace must actually be followed by the IIFE's own `)()`. If it is not, the
   tokenizer drifted somewhere inside and nothing about this surface can be trusted: it goes on the
   UNPARSED list instead of into the findings. A checker that says "I could not read this one" is
   usable; one that quietly reads the wrong thing is not. */
const unparsed = [];
function surfaces(src, file) {
  const out = [];
  const re = /(?:window\.|var\s+|const\s+|let\s+)([A-Z][\w$]*)\s*=\s*\(\s*(?:async\s+)?function\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const bodyOpen = src.indexOf('{', m.index + m[0].length);
    if (bodyOpen === -1) continue;
    const bodyEnd = matchBrace(src, bodyOpen);
    if (bodyEnd === -1) { unparsed.push({ file, name: m[1], why: 'no closing brace found' }); continue; }
    if (!/^\s*\)\s*\(\s*\)/.test(src.slice(bodyEnd + 1, bodyEnd + 12))) {
      unparsed.push({ file, name: m[1], why: 'brace match did not land on the IIFE close' });
      continue;
    }
    const objOpen = returnObjAtDepth1(src, bodyOpen, bodyEnd);
    if (objOpen !== -1) out.push({ name: m[1], keys: keysOf(src, objOpen), at: objOpen });
    re.lastIndex = bodyEnd;
  }
  return out;
}

/* ------------------------------------------------------------------ self-test
   ⚠️ A checker that has never been shown to catch the thing it exists for is a decoration. */
function selfTest() {
  const fail = [];
  /* ⚠️⚠️ THE NESTED-RETURN TRAP IS THE FIRST CASE, because it is the bug this file shipped with.
     `helper()` returns an object LATER in the text than the real export, so "the last return {"
     picked it and named `wrongKey` as the public surface. */
  const SRC = [
    'window.Demo = (function () {',
    '  function used() { return 1; }',
    '  function never() { return 2; }',
    '  return {',
    '    usedKey: used, deadKey: never, nested: { inner: 1 },',
    '    tricky: function () { try { return { wrongKey: 1 }; } catch (e) { return { alsoWrong: 2 }; } }',
    '  };',
    '})();'
  ].join('\n');
  const s = surfaces(SRC, 'selftest');
  if (s.length !== 1) fail.push('expected one surface, got ' + s.length);
  else {
    const k = s[0].keys;
    if (s[0].name !== 'Demo') fail.push('surface name: ' + s[0].name);
    if (!k.includes('usedKey')) fail.push('missed usedKey');
    if (!k.includes('deadKey')) fail.push('missed deadKey');
    if (k.includes('inner')) fail.push('picked up a NESTED key (inner) as a top-level export');
    if (k.includes('wrongKey') || k.includes('alsoWrong'))
      fail.push('took a NESTED FUNCTION’s return object as the public surface (the shipped bug)');
  }
  /* the regex-literal trap that broke an earlier slicer in this repo */
  const RE = "window.R = (function () { var x = /[’'\".,()\\-_]/g; return { alive: 1 }; })();";
  const r = surfaces(RE, 'selftest');
  if (r.length !== 1 || !r[0].keys.includes('alive')) fail.push('a regex holding both quotes broke the matcher');
  return fail;
}

const st = selfTest();
if (st.length) { console.log('dead-exports self-test FAILED — aborting:\n  ' + st.map(x => '  ' + x).join('\n')); process.exit(2); }
console.log('  self-test: a dead key is found, a nested key is not, a two-quote regex does not break the matcher ✓');

/* ------------------------------------------------------------------ the sweep */
/* ⚠️⚠️ THE TWO FILE SETS ARE NOT THE SAME, AND THE FIRST VERSION GOT IT WRONG.
   SURFACES come from shipped source only — a harness or a test must not be able to declare a
   public API. But READS must include tests and harnesses, because a key exported specifically so
   `module.test.js` can reach it IS being read. Scanning one set for both reported ~40 live test
   hooks in Progress Photos as dead, which is exactly the untrustworthy-scanner failure that
   `dead-hooks.js` was rewritten to avoid. */
const ALL = walk('.', []).filter(f => /\.(js|html)$/.test(f));
const FILES = ALL.filter(f => !/harness|test\.js$/.test(f));
const CLEAN = new Map(FILES.map(f => [f, scan.clean(f, fs.readFileSync(f, 'utf8'))]));
const READS = new Map(ALL.map(f => [f, scan.clean(f, fs.readFileSync(f, 'utf8'))]));

const found = [];
for (const [f, s] of CLEAN) for (const surf of surfaces(s, f)) found.push({ file: f, ...surf });

let checked = 0;
const dead = [];
for (const surf of found) {
  for (const key of surf.keys) {
    checked++;
    /* A read is `.key` anywhere, or the key as a string (bracket access / a name table). The
       DEFINITION site is `key:`, which neither pattern matches, so it cannot count as its own use. */
    const dot = new RegExp('\\.' + key.replace(/\$/g, '\\$') + '\\b');
    const str = new RegExp('[\'"`]' + key.replace(/\$/g, '\\$') + '[\'"`]');
    let live = false;
    for (const s of READS.values()) { if (dot.test(s) || str.test(s)) { live = true; break; } }
    if (!live) dead.push({ file: surf.file, name: surf.name, key });
  }
}

console.log('\n==============================================================================');
console.log('DEAD EXPORTS — a key on a public object that nothing in the repo reads');
console.log('==============================================================================');
console.log('  ' + found.length + ' public surfaces, ' + checked + ' exported keys checked across ' +
            FILES.length + ' shipped files (' + ALL.length + ' scanned for reads)\n');
if (!dead.length) console.log('  none\n');
for (const d of dead) console.log('  ' + d.file.padEnd(42) + d.name + '.' + d.key);

/* ⚠️⚠️ WHAT WAS NOT READ IS PART OF THE RESULT, NOT A FOOTNOTE. A checker that reports 44 findings
   while silently skipping the largest surface in the repo invites "dead-exports is clean" to be said
   about code it never looked at. `ScheduleBuilder` is exactly that case today — it is a closure-local
   surface inside an ~800 KB inline script, the tokenizer drifts somewhere inside it, and it is the
   very surface whose dead `setupOrderLabels` prompted this file. So it is named, loudly. */
if (unparsed.length) {
  console.log('\n  ' + unparsed.length + ' surface(s) NOT read — findings above do NOT cover these:');
  for (const u of unparsed) console.log('    ' + u.file.padEnd(42) + u.name + '  (' + u.why + ')');
}
console.log('');
process.exit(dead.length ? 1 : 0);
