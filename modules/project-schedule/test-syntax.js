/* PARSE THE SHIPPED MODULE. Nothing else — no behaviour is asserted here.
 *
 * ⚠️⚠️ WHY THIS EXISTS. `index.html` is ~53,000 lines in ONE inline <script>, and a browser
 *    reports a syntax error in it as a blank page: the whole module, every view, gone, with a
 *    single line in the console. Every other suite in this folder slices ONE function out and
 *    runs it, so all of them still pass while the file as shipped does not parse. On 2026-09-17
 *    the prompt()/confirm() conversion rewrote ~100 call sites across the file; a missing brace
 *    in any one of them is exactly this failure, and nothing here would have caught it.
 * ⚠️ It checks the FILE'S OWN TEXT, not a reconstruction: the inline scripts are cut out
 *    between their real tags and handed to the engine verbatim.
 * ⚠️ `new Function` rather than `require`: the code is browser code (it touches `document` at
 *    load), so it must be PARSED and never RUN.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

/* Every inline <script> with no `src`. ⚠️ `type="module"`/JSON blocks would need different
   handling, so they are reported rather than silently skipped. */
const blocks = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(src)) !== null) {
  const attrs = m[1] || '';
  if (/\ssrc\s*=/.test(attrs)) continue;
  if (/type\s*=\s*"(?!text\/javascript)/i.test(attrs)) { blocks.push({ attrs, skip: true }); continue; }
  const line = src.slice(0, m.index).split('\n').length;
  blocks.push({ attrs, line, code: m[2] });
}

console.log('project-schedule — the shipped file parses');
ok('found the module script', blocks.some(function (b) { return !b.skip && b.code.length > 100000; }),
   blocks.length + ' inline block(s)');

blocks.forEach(function (b, i) {
  if (b.skip) { ok('block ' + i + ' skipped (non-JS type)', true); return; }
  let err = null;
  try { new Function(b.code); } catch (e) { err = e; }
  ok('inline <script> at line ' + b.line + ' (' + b.code.length + ' chars) parses', !err,
     err ? err.message : '');
});

/* ⚠️⚠️ AND NO NATIVE DIALOG IS LEFT. The owner asked for the browser pop-ups to go; a single
   `prompt(` or `confirm(` left behind is one screen that still opens the browser's own box, and
   it is invisible until somebody presses that one button. Comments are blanked first — this file
   describes what it replaced, in prose, dozens of times. */
const scan = require('../../tools/scan.js');
const mask = scan.blankComments(src);
/* Strings are NOT blanked, so a mention inside a message would count. Both words only ever
   appear in prose there, so the match is anchored on the CALL: an identifier boundary before it
   and an open paren after. `.confirm(` (a property) is somebody's own method, not the browser's. */
function nativeCalls(word) {
  const out = [];
  const r = new RegExp('(^|[^\\w.$\'"`-])' + word + '\\s*\\(', 'g');
  let x;
  while ((x = r.exec(mask)) !== null) {
    out.push(mask.slice(0, x.index).split('\n').length);
  }
  return out;
}
const leftPrompt = nativeCalls('prompt');
const leftConfirm = nativeCalls('confirm');
ok('no native prompt() left', leftPrompt.length === 0, 'lines ' + leftPrompt.join(', '));
ok('no native confirm() left', leftConfirm.length === 0, 'lines ' + leftConfirm.join(', '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
