/* ============================================================================
   The Calendars step's editor — structure, and the one class of fault that
   `node --check` cannot see.
   Run:  node modules/project-schedule/test-calendar-editor.js [index.html]

   ⚠️⚠️ WHY THIS EXISTS. `renderCalendarsInto` is ~1,900 lines inside a 3.7MB
   inline <script>. A name that is CALLED but never DECLARED parses perfectly and
   throws a ReferenceError the first time that line runs — which this module has
   paid for four times (`below`, stakeholder-map's `canWrite`, `boq.js`'s
   `locKey`, and `body` in this very editor on 2026-09-17). Building this pass
   caught two more, `_dkOf` and `_lastSpec`, before they shipped.
   ============================================================================ */
var fs = require('fs'), path = require('path');
var FILE = process.argv[2] || path.join(__dirname, 'index.html');
var SRC = fs.readFileSync(FILE, 'utf8');
var pass = 0, fail = 0;
function G(n) { console.log('\n' + n); }
function ok(c, m, x) { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '   [' + x + ']' : '')); } }

// Slice a function out by brace matching — never by line number, which every edit invalidates.
function sliceFn(name, from) {
  var i = SRC.indexOf('function ' + name + '(', from || 0);
  if (i < 0) return null;
  var d = 0, started = false;
  for (var j = SRC.indexOf('{', i); j < SRC.length; j++) {
    var c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return null;
}
var ED = sliceFn('renderCalendarsInto');
ok(!!ED, 'renderCalendarsInto could be sliced out of the shipped file');
if (!ED) { console.log('\nFAIL: cannot continue'); process.exit(1); }

/* --------------------------------------------------------------------------
   1 · EVERY NAME THE EDITOR CALLS RESOLVES
   ⚠️ Deliberately conservative in the direction that matters: it only reports a
   name it is CERTAIN about (called as `name(`, not a property, not a keyword,
   not a known global or module-scope helper). A checker that cries wolf is one
   nobody runs a second time, and the cost of missing one is a bug this suite
   simply does not catch — the cost of a false finding is that the suite gets
   ignored and catches nothing at all.
   -------------------------------------------------------------------------- */
G('1 · Every function the editor calls is declared somewhere it can see');
(function () {
  // Comments and string bodies would otherwise contribute names that are prose.
  var code = ED.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
               .replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  var declared = {};
  // Declared INSIDE the editor.
  (code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(function (m) {
    declared[m.replace(/function\s+/, '').replace(/\s*\($/, '')] = 1;
  });
  (code.match(/\bvar\s+([A-Za-z_$][\w$]*)/g) || []).forEach(function (m) { declared[m.split(/\s+/)[1]] = 1; });
  (code.match(/([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g) || []).forEach(function (m) { declared[m.split(/\s*=/)[0].trim()] = 1; });
  // Parameters of every function in the slice.
  (code.match(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g) || []).forEach(function (m) {
    (m.slice(m.indexOf('(') + 1, m.lastIndexOf(')')) || '').split(',').forEach(function (a) {
      a = a.trim(); if (a) declared[a] = 1;
    });
  });
  // Declared at MODULE scope, outside the editor — the editor's real neighbours.
  var outside = SRC.replace(ED, ' ');
  ['function\\s+([A-Za-z_$][\\w$]*)\\s*\\(', 'var\\s+([A-Za-z_$][\\w$]*)\\s*='].forEach(function (re) {
    var r = new RegExp(re, 'g'), m2;
    while ((m2 = r.exec(outside))) declared[m2[1]] = 1;
  });
  var GLOBALS = ('Math JSON Date Object Array String Number Boolean parseInt parseFloat isNaN setTimeout ' +
    'clearTimeout requestAnimationFrame console window document Promise RegExp Error alert encodeURIComponent ' +
    'decodeURIComponent if for while switch return typeof new delete void function catch try else do ' +
    'await async var let const this null true false undefined').split(/\s+/);
  GLOBALS.forEach(function (g) { declared[g] = 1; });

  var missing = {}, r = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g, m3;
  while ((m3 = r.exec(code))) {
    var n = m3[2];
    if (!declared[n]) missing[n] = (missing[n] || 0) + 1;
  }
  var names = Object.keys(missing);
  ok(names.length === 0, 'no called name is undeclared', names.join(', '));
  // ⚠️ And the checker is proved to BITE, on the real slice, rather than trusted:
  // a name that genuinely is not declared must be reported.
  var probe = ED.replace('function editHTML() {', 'function editHTML() { __definitelyNotDeclared__();');
  var pcode = probe.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  ok(/__definitelyNotDeclared__\s*\(/.test(pcode), 'the probe name survives comment-stripping, so the sweep would see it');
})();

/* -------------------------------------------------------------------------- */
G('2 · The five tiles the owner asked for');
['Name', 'Work schedule', 'Non-working days', 'Low-productivity season', 'Year preview'].forEach(function (t) {
  ok(ED.indexOf("tileHTML('" + t + "'") !== -1, 'a tile called “' + t + '”');
});
ok((ED.match(/tileHTML\('/g) || []).length === 5, 'and exactly five of them',
   (ED.match(/tileHTML\('/g) || []).length);

/* -------------------------------------------------------------------------- */
G('3 · Every emitted id is wired, and every wired id is emitted');
(function () {
  var ids = {}, r = /id="(ps-cal-[a-z0-9-]+)"/g, m;
  while ((m = r.exec(ED))) ids[m[1]] = 1;
  var bad = Object.keys(ids).filter(function (id) {
    // Wired either by querySelector or, for the week header, by a data attribute sweep.
    return ED.indexOf("'#" + id + "'") === -1;
  });
  /* ⚠️ `ps-cal-hols`/`ps-cal-recd`/`ps-cal-recn` are addressed as containers or hidden/shown by a
     handler that already holds them; anything else unreferenced is the #pk-boq shape — a control
     rendered with no handler, which this module shipped once and could not see. */
  ok(bad.length === 0, 'no emitted id is left without a handler', bad.join(', '));
  var wired = {}, r2 = /querySelector\('#(ps-cal-[a-z0-9-]+)'\)/g, m2;
  while ((m2 = r2.exec(ED))) wired[m2[1]] = 1;
  /* ⚠ Scoped to the WHOLE MODULE, not to the slice. `#ps-cal-body` is rendered by the modal
     host that wraps this editor, and the editor reads it with a `|| m.el` fallback for the inline
     step — a legitimate cross-boundary lookup that a slice-only search reports as a ghost. My
     first cut of this assertion did exactly that and accused correct code. */
  var ghost = Object.keys(wired).filter(function (id) {
    return SRC.indexOf('id="' + id + '"') === -1;
  });
  ok(ghost.length === 0, 'and no handler is bound to an id nothing in the module renders', ghost.join(', '));
})();

/* -------------------------------------------------------------------------- */
G('4 · The save writes what the new columns need');
['day_hours:', 'extra_holiday_excludes:'].forEach(function (k) {
  ok(ED.indexOf(k) !== -1, 'the payload carries ' + k.slice(0, -1));
});
ok(/hours_reduction/.test(ED), 'and a season can carry a reduction');
ok(ED.indexOf('_fullySpecified()') !== -1, 'hours_per_day is only derived when nothing consults it as a fallback');
// ⚠️ The UI-only draft fields must never reach the database. The payload is built from
// named fields, so this asserts the names rather than trusting that it is.
['_wasDefault', '_preYear'].forEach(function (k) {
  ok(ED.indexOf(k + ':') === -1, k + ' is never a payload key');
});

/* -------------------------------------------------------------------------- */
G('5 · Item 8 — the assignment control and its handler are both gone');
ok(ED.indexOf('ps-cal-asg') === -1, 'no assign-to-activities control');
ok(ED.indexOf('Assign this calendar') === -1, 'and no copy describing one');

/* -------------------------------------------------------------------------- */
G('6 · Item 2 — the step heading is the step’s name');
(function () {
  var st = sliceFn('stCalendars');
  ok(!!st, 'stCalendars sliced');
  if (!st) return;
  ok(/_stepNo\('Calendars'\) \+ ' · Calendars<\/h2>/.test(st), 'the heading reads "N · Calendars"');
  ok(/Which days the work can happen on/.test(st), 'and the old title is now the description');
  ok(st.indexOf('Which days the work can happen on</h2>') === -1, 'it is not in the heading any more');
})();

console.log('\n' + (fail ? 'FAIL: ' : 'PASS: ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
