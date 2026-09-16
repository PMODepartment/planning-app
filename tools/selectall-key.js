// tools/selectall-key.js - run: node tools/selectall-key.js
//
// `PDb.selectAll(table, apply, cols, key)` pages with `.order(key).gt(key, last)` and DEFAULTS
// that cursor to `id`. A keyset cursor must be a single UNIQUE, NON-NULL column, so a relation
// with no `id` cannot be paged that way at all: every read fails with
//   400  42703  column <relation>.id does not exist
// and callers routinely swallow that as "the migration has not run yet".
//
// ⚠️⚠️ THIS HAS SHIPPED FOUR TIMES:
//   class_codes              2026-09-07 (e)  keyed on `code`; the owner re-ran the migration
//                                            repeatedly, correctly, and it could never help.
//   trade_map                2026-09-09 (m2) primary key is the PAIR.
//   vendor_qty_reconciliation 2026-09-12     aggregate view, composite key.
//   vendor_rate_library       2026-09-12     aggregate view, composite key.
// The last two had been returning nothing on EVERY project since the day they were wired, and
// were found only by opening the console on a signed-in page. This checker is so the fifth one
// is found by running a command instead.
//
// WHAT IT DOES NOT COVER, stated rather than implied:
//   - it reads the repo's own SQL, so a relation created outside these files is unknown, and it
//     says so rather than assuming the caller is fine.
//   - `id` existing does not prove it is unique and non-null; a table whose `id` is not the PK
//     would still page wrongly. Every table here declares `id` as its primary key.
//   - a view that SELECTS an id column is fine; the check looks for that before complaining.

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

/* --------------------------------------------------------------- sql side */

function sqlFiles() {
  var out = ['supabase-schema.sql', 'supabase-build.sql', 'supabase-setup.sql']
    .map(function (f) { return path.join(ROOT, f); })
    .filter(fs.existsSync);
  var md = path.join(ROOT, 'migrations');
  if (fs.existsSync(md)) {
    fs.readdirSync(md).filter(function (f) { return /\.sql$/.test(f); })
      .sort()
      .forEach(function (f) { out.push(path.join(md, f)); });
  }
  return out;
}

// ⚠️ SQL COMMENTS MUST GO FIRST. wpm_vendors declares `id uuid primary key` two lines below a
// "-- The WPM vendors.id, carried across..." comment. Without stripping them, a test anchored on
// "start of line or after a comma" misses the real column AND can match the word id inside the
// prose. The first version of this file reported wpm_vendors as broken while the live app was
// paging it successfully on id=gt.<uuid> - a false positive, which is the one thing a checker may
// not do (2026-09-11 uh: "one false finding teaches people to skip the report").
function stripSqlComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// Split a CREATE TABLE body on TOP-LEVEL commas, so numeric(12,2) is one column, not two.
function columns(body) {
  var out = [], depth = 0, cur = '';
  for (var i = 0; i < body.length; i++) {
    var c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && !depth) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(function (x) { return x.trim(); }).filter(Boolean);
}

// True only when a column's NAME is exactly `id` - never a table constraint, never prose.
function declaresId(body) {
  return columns(stripSqlComments(body)).some(function (c) {
    var m = /^"?([a-z_][a-z0-9_]*)"?\s+\S/i.exec(c);
    return !!m && m[1].toLowerCase() === 'id';
  });
}

// Balanced-paren body after `create table <name> (`
function bodyAfter(src, from) {
  var i = src.indexOf('(', from);
  if (i === -1) return null;
  var depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') { depth--; if (!depth) break; }
  }
  return depth ? null : src.slice(i + 1, j);
}

function buildSchema() {
  var rel = {};    // name -> { kind, hasId, where }
  sqlFiles().forEach(function (f) {
    var src = fs.readFileSync(f, 'utf8');
    var where = path.relative(ROOT, f).replace(/\\/g, '/');

    var t = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*)/gi, m;
    while ((m = t.exec(src))) {
      var body = bodyAfter(src, m.index + m[0].length);
      if (body === null) continue;
      var hasId = declaresId(body);
      rel[m[1].replace(/^public\./, '')] = { kind: 'table', hasId: hasId, where: where };
    }

    var v = /create\s+(?:or\s+replace\s+)?(materialized\s+)?view\s+([a-z_][a-z0-9_.]*)([\s\S]{0,4000}?);/gi;
    while ((m = v.exec(src))) {
      var head = stripSqlComments(m[3] || '');
      // does the view actually select an `id` column (or alias one)?
      var selectsId = /(^|,|\s)([a-z_][a-z0-9_]*\.)?id(\s|,|$)/i.test(head.split(/\bfrom\b/i)[0] || '') ||
                      /\bas\s+id\b/i.test(head);
      rel[m[2].replace(/^public\./, '')] = { kind: 'view', hasId: selectsId, where: where };
    }
  });
  return rel;
}

/* --------------------------------------------------------------- js side */

// Extract selectAll(...) call sites with their first argument and their ARITY.
function callSites() {
  var out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'tools') return;
      var p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.(js|html)$/.test(e.name)) return;
      if (/harness/i.test(e.name)) return;
      var src = fs.readFileSync(p, 'utf8');
      var rel = path.relative(ROOT, p).replace(/\\/g, '/');
      if (rel === 'assets/js/db.js') return;                 // the definition itself
      var re = /selectAll\s*\(/g, m;
      while ((m = re.exec(src))) {
        var open = m.index + m[0].length - 1;
        // ⚠️ COMMENTS ARE SKIPPED, NOT ACCUMULATED. `boq.js` documents the cursor rule inside the
        // argument list, and that comment contains commas — so a splitter that only tracks quotes
        // chopped the block comment into "arguments" and reported a CORRECT call site as
        // unreadable. Line numbers are taken from `m.index`, so dropping comment text here cannot
        // move them.
        var depth = 0, j = open, args = [], cur = '', inS = null;
        for (; j < src.length; j++) {
          var c = src[j];
          if (inS) { if (c === inS && src[j-1] !== '\\') inS = null; cur += c; continue; }
          if (c === '"' || c === "'" || c === '`') { inS = c; cur += c; continue; }
          if (c === '/' && src[j+1] === '*') { j = src.indexOf('*/', j + 2); if (j < 0) break; j++; continue; }
          if (c === '/' && src[j+1] === '/') { j = src.indexOf('\n', j + 2); if (j < 0) break; continue; }
          if (c === '(') { depth++; if (depth === 1) continue; }
          else if (c === ')') { depth--; if (!depth) break; }
          if (depth === 1 && c === ',') { args.push(cur); cur = ''; continue; }
          cur += c;
        }
        args.push(cur);
        var a0 = (args[0] || '').trim();
        var tm = /^['"]([a-z_][a-z0-9_]*)['"]$/i.exec(a0);
        // ⚠️ Most call sites pass a CONSTANT (T_REV, TABLE, DIR), not a literal. Leaving those
        // unresolved would have left 35 of 84 sites unchecked - the blind spot big enough to hide
        // the next instance. They are declared in the same file, so resolve them there.
        if (!tm && /^[A-Za-z_$][\w$]*$/.test(a0)) {
          // ⚠️ NOT anchored on `var` - these are multi-declarator statements
          // (`var T_REV = 'boq_revisions', T_ITEM = 'boq_items', ...`), so every name after the
          // first follows a COMMA. Anchoring on the keyword left 13 sites unresolved.
          var cm = new RegExp('\\b' + a0 + "\\s*=\\s*['\"]([a-z_][a-z0-9_]*)['\"]").exec(src);
          if (cm) tm = [null, cm[1]];
        }
        out.push({
          file: rel,
          // for the cols-VARIABLE resolver: where to look, and how far up is still this call
          src: src, index: m.index,
          line: src.slice(0, m.index).split('\n').length,
          table: tm ? tm[1] : null,
          raw: a0.slice(0, 40),
          arity: args.length,
          hasKeyArg: args.length >= 4 && args[3].trim() !== '' && args[3].trim() !== 'undefined',
          // the third and fourth arguments, for the PROJECTION check further down
          colsArg: args.length >= 3 ? args[2] : '',
          keyName: (function () {
            var k = args.length >= 4 ? String(args[3]).trim() : '';
            var km = /^['"]([a-z_][a-z0-9_]*)['"]$/i.exec(k);
            return km ? km[1] : 'id';        // an unreadable key expression is assumed to be id
          })()
        });
      }
    });
  })(ROOT);
  return out;
}

/* ------------------------------------------------- the PROJECTION side (2026-09-16)

   The check above asks whether the RELATION has an `id`. It does not ask whether the
   PROJECTION does — and that is a second, independent way to break the same loop.

   ⚠️⚠️ `selectAll` reads its next cursor off the last RETURNED ROW OBJECT
   (`last = page[page.length - 1][k]`) and stops on `last == null`. A cursor column that the
   relation HAS but the `cols` string does NOT ask for comes back `undefined`, `undefined == null`
   is true, and the loop returns after ONE page: 1000 rows, no error, a plausible smaller number.

   ⚠️ THIS CHECKER PASSED 103/103 WHILE FIVE SITES WERE DOING EXACTLY THAT — one BOQ roll-up
   computing a contract total from the first 1000 items, and three PorMac mirror reads whose
   figures the assistant then stated as fact. Found 2026-09-16 by reading `selectAll`, not by
   running this. That gap is what the rest of this file now closes.

   ⚠️⚠️ AND IT IS NO LONGER FATAL, WHICH IS WHY IT IS REPORTED SEPARATELY. `selectAll` now folds
   the cursor into the projection itself, so these sites page correctly today. Reporting them as
   BROKEN would be a false finding, and this file's own rule is that one false finding teaches
   people to skip the report. What earns the exit code instead is `forcesCursor()` below: if that
   guard ever leaves `db.js`, every site in this list silently truncates again. */

/* ---- resolving a cols VARIABLE, the shape that survived even the projection check ----

   ⚠️ `cash-flow` builds its cols list into a local and passes the local — and on the fallback
   path passes `cols.replace(',trade', '')`. Both read as "dynamic" to a checker that looks only
   at the argument, so both sat in the unreadable list where nobody could tell a fixed site from
   a broken one. They are static in every sense that matters; only the argument slice is not.

   ⚠️⚠️ THIS IS PROXIMITY, NOT SCOPE ANALYSIS, and it is deliberately timid: a WRONG resolution
   reports a broken site as fine, which is the one failure this file must not have. Three
   conditions, all required —
     1. a `var`/`let`/`const` DECLARATION holding one string literal. A bare `x = …`, and
        therefore any function PARAMETER, is never resolved;
     2. within `NEAR` lines above the call, so an identically named local in another function
        further up the file cannot be mistaken for this one;
     3. no other assignment to that name between the declaration and the call.
   Anything else stays unreadable, which is the honest answer. */
var NEAR = 40;
function declLiteral(name, src, before) {
  // ⚠️ Built from REGEX LITERALS via `.source`, never from backslashes typed inside a string:
  // `'\s'` written one layer short is `'\s'`, which is silently the letter `s`, and the
  // resulting checker still parses and still runs. One quote character at a time, too, so no
  // escaped quote class is needed either.
  var hit = null;
  ["'", '"'].forEach(function (q) {
    var re = new RegExp(/\b(?:var|let|const)\s+/.source + name + /\s*=\s*/.source +
                        q + '([^' + q + ']*)' + q, 'g');
    var m;
    while ((m = re.exec(src))) {
      if (m.index >= before) break;
      if (!hit || m.index > hit.index) hit = m;
    }
  });
  if (!hit) return null;
  var lines = src.slice(hit.index, before).split('\n').length - 1;
  if (lines > NEAR) return null;
  // ⚠️ `(?![=>])` so `cols === x` and `cols => …` are not read as assignments. Without it every
  // comparison standing between the declaration and the call would disqualify a readable site.
  var between = src.slice(hit.index + hit[0].length, before);
  if (new RegExp(/\b/.source + name + /\s*=(?![=>])/.source).test(between)) return null;
  return { text: hit[1], line: src.slice(0, hit.index).split('\n').length, away: lines };
}

// `ident`, or `ident` followed by any number of `.replace('a','b')` with LITERAL arguments.
// The replaces are applied with the real `String.prototype.replace`, so what comes out is what
// the browser sends — including that a string argument replaces only the FIRST match.
function resolveCols(expr, ctx) {
  if (!ctx || !ctx.src) return null;
  var m = /^([A-Za-z_$][\w$]*)((?:\s*\.replace\(\s*'[^']*'\s*,\s*'[^']*'\s*\))*)\s*$/.exec(expr);
  if (!m) return null;
  var d = declLiteral(m[1], ctx.src, ctx.index);
  if (!d) return null;
  var text = d.text, rr = /\.replace\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g, r;
  while ((r = rr.exec(m[2]))) text = text.replace(r[1], r[2]);
  return { text: text, via: m[1] + ' declared ' + d.away + ' line(s) above (line ' + d.line + ')' };
}

// The offset `callSites` hands the resolver, rebuilt for the self-tests so they drive the real
// `resolveCols` rather than a retyped copy of it.
function _ctx(src, needle) { return { src: src, index: src.indexOf(needle) }; }

// The `cols` argument, when it can be read statically. A runtime expression
// (`Object.keys(want).join(',')`) cannot be, and is reported as unreadable rather than as a pass.
// ⚠️ TWO SHAPES THAT LOOK DYNAMIC AND ARE NOT, both of which this file reported wrongly on its
// first run — and a checker that cries wolf on correct code is the failure mode this file's own
// header warns about:
//   1. a COMMENT inside the argument list. `boq.js` documents the cursor rule right where the
//      cols string is passed, and the raw slice then begins with `/* ... */`.
//   2. a CONCATENATED literal. `portfolio-overview` splits a 14-column list over two lines with
//      `'…,' + '…'`, which is still entirely static.
function colsOf(arg, ctx) {
  var t = String(arg || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments
    .replace(/^\s*\/\/[^\n]*$/gm, ' ')       // line comments
    .trim();
  if (!t) return { kind: 'star' };           // no cols -> '*', which carries every column
  // a `+`-chain of string literals is static: join them and carry on
  var parts = t.split('+').map(function (x) { return x.trim(); });
  var lits = parts.map(function (x) { return /^['"]([^'"]*)['"]$/.exec(x); });
  if (!lits.every(Boolean)) {
    // ⚠️ Re-ENTERS colsOf with the resolved literal instead of re-parsing it here. A
    // second copy of the name-splitting is a second thing to drift, which is the trap
    // the self-tests above exist to close.
    var res = resolveCols(t, ctx);
    if (res) { var r = colsOf("'" + res.text + "'"); r.via = res.via; return r; }
  }
  if (!lits.every(Boolean)) return { kind: 'dynamic', raw: t.replace(/\s+/g, ' ').slice(0, 52) };
  var text = lits.map(function (m) { return m[1]; }).join('');
  // A PostgREST select list may carry aliases (`a:b`) and embedded resources (`p:projects(name)`).
  // Only the bare top-level column NAMES can satisfy the cursor.
  var names = text.split(',').map(function (c) {
    return c.trim().split(/[\s:(]/)[0];
  }).filter(Boolean);
  return { kind: 'list', names: names, text: text };
}

// Is the projection-forcing guard still in `selectAll`? This is the assertion that carries the
// exit code, because it is what makes every "advisory" site above safe.
// ⚠️ Asserted on the SHIPPED SOURCE, not on a copy of it retyped here — the same rule the
// self-tests follow, and the reason a silent removal cannot pass this file.
function forcesCursor() {
  var src = fs.readFileSync(path.join(ROOT, 'assets/js/db.js'), 'utf8');
  var body = /async selectAll\s*\([^)]*\)\s*\{([\s\S]*?)\n    \},/.exec(src);
  if (!body) return { ok: false, why: 'could not locate the selectAll body in assets/js/db.js' };
  var b = body[1];
  var hasNeed = /var\s+need\s*=/.test(b) && /\.select\(\s*need\s*\)/.test(b);
  var hasTest = /split\(\s*','\s*\)/.test(b) && /=== *k\b/.test(b);
  var hasPrepend = /k\s*\+\s*','\s*\+\s*cols/.test(b);
  if (hasNeed && hasTest && hasPrepend) return { ok: true };
  return {
    ok: false,
    why: 'selectAll no longer folds the cursor column into its projection' +
         ' (need=' + hasNeed + ', membership-test=' + hasTest + ', prepend=' + hasPrepend + ')'
  };
}

/* ------------------------------------------------------------- self-test */

function selfTest() {
  var cases = [
    // ⚠️ These call declaresId ITSELF. An earlier version re-typed its regex here and asserted on
    // the copy, so the real function could drift without a single test failing - the same trap the
    // LSM suite was caught by four times.
    ['a table declaring id is fine', declaresId('\n  id uuid primary key,\n  name text')],
    ['a table with no id column is caught', !declaresId('\n  code text primary key,\n  name text')],
    ['a column merely CONTAINING id is not an id',
      !declaresId('\n  project_id text,\n  wpm_project_id text')],
    ['an id below a -- comment is still found (the wpm_vendors false positive)',
      declaresId('\n  -- The WPM vendors.id, carried across\n  id uuid primary key,\n  name text')],
    ['id appearing ONLY inside a comment is not a column',
      !declaresId('\n  -- joins to other.id here\n  code text primary key,\n  name text')],
    ['numeric(12,2) does not split into a phantom column',
      declaresId('\n  amount numeric(12,2),\n  id uuid primary key')],
    ['a view selecting an id is fine',
      /(^|,|\s)([a-z_][a-z0-9_]*\.)?id(\s|,|$)/i.test('select pa.id, pa.name ')],
    ['an aggregate view with no id is caught',
      !/(^|,|\s)([a-z_][a-z0-9_]*\.)?id(\s|,|$)/i.test('select pa.vendor_id, pa.category ')],
    // ---- the projection side. ⚠️ These call colsOf / forcesCursor THEMSELVES, for the same
    // reason the cases above call declaresId: a retyped copy lets the real function drift.
    ['no cols argument means * , which carries the cursor', colsOf('').kind === 'star'],
    ['an expression cols cannot be read statically and is not a pass',
      colsOf("Object.keys(want).join(',')").kind === 'dynamic'],
    ['a literal cols listing id is fine',
      colsOf("'id,amount,line_kind'").names.indexOf('id') === 0],
    ['a literal cols WITHOUT id is caught (the 2026-09-16 class)',
      colsOf("'amount,line_kind,exclusion_note'").names.indexOf('id') === -1],
    ['a column merely ENDING in _id does not satisfy the cursor',
      colsOf("'project_id,percent_complete'").names.indexOf('id') === -1],
    ['spaces around the names are tolerated',
      colsOf("'id, amount, sheet'").names.indexOf('id') === 0],
    ['an embedded resource is not mistaken for a column name',
      colsOf("'id,proj:projects(name)'").names.join('|') === 'id|proj'],
    // ---- the cols VARIABLE. ⚠️ Same rule again: these drive the real `colsOf`/`resolveCols`,
    // and `_ctx` builds the offset the way `callSites` does, off the `selectAll(` itself.
    ['a cols variable declared just above is resolved',
      colsOf('cols', _ctx("var cols = 'id,wp_no,trade';\nawait PDb.selectAll(T, f, cols);", 'selectAll(')).names.indexOf('id') === 0],
    ['a .replace() on it is APPLIED, not guessed (the cash-flow fallback)',
      colsOf("cols.replace(',trade', '')", _ctx("var cols = 'id,wp_no,trade';\nawait PDb.selectAll(T, f, cols.replace(',trade', ''));", 'selectAll(')).text === 'id,wp_no'],
    ['a replace that strips the CURSOR is caught, not excused',
      colsOf("cols.replace('id,', '')", _ctx("var cols = 'id,wp_no,trade';\nawait PDb.selectAll(T, f, cols.replace('id,', ''));", 'selectAll(')).names.indexOf('id') === -1],
    ['a PARAMETER is never resolved (no var/let/const, so no binding to trust)',
      colsOf('cols', _ctx("function read(cols) {\n  return PDb.selectAll(T, f, cols);\n}", 'selectAll(')).kind === 'dynamic'],
    ['a declaration BELOW the call is not resolved',
      colsOf('cols', _ctx("await PDb.selectAll(T, f, cols);\nvar cols = 'id,wp_no';", 'selectAll(')).kind === 'dynamic'],
    ['a reassignment between the declaration and the call disqualifies it',
      colsOf('cols', _ctx("var cols = 'id,wp_no';\ncols = other;\nawait PDb.selectAll(T, f, cols);", 'selectAll(')).kind === 'dynamic'],
    ['a comparison between them does NOT disqualify it',
      colsOf('cols', _ctx("var cols = 'id,wp_no';\nif (cols === x) y();\nawait PDb.selectAll(T, f, cols);", 'selectAll(')).names.indexOf('id') === 0],
    ['a declaration further than NEAR lines above is out of reach',
      colsOf('cols', _ctx("var cols = 'id,wp_no';\n" + '\n'.repeat(NEAR + 2) + "await PDb.selectAll(T, f, cols);", 'selectAll(')).kind === 'dynamic']
    // (`forcesCursor` is deliberately NOT a self-test: a self-test failure aborts before the
    //  report, and the whole value of that check is naming the sites it just broke.)
  ];
  var bad = 0;
  cases.forEach(function (c) {
    if (!c[1]) bad++;
    console.log('  ' + (c[1] ? 'ok  ' : 'FAIL') + '  ' + c[0]);
  });
  return bad;
}

/* ------------------------------------------------------------------ main */

console.log('self-tests:');
if (selfTest()) { console.error('\nSELF-TEST FAILED - not reporting.'); process.exit(2); }
console.log('');

var schema = buildSchema();
var sites = callSites();

var broken = [], unknown = [], dynamic = [], ok = 0;
sites.forEach(function (s) {
  if (!s.table) { dynamic.push(s); return; }
  var r = schema[s.table];
  if (!r) { unknown.push(s); return; }
  if (r.hasId || s.hasKeyArg) { ok++; return; }
  broken.push({ site: s, rel: r });
});

console.log('selectAll call sites: ' + sites.length +
            '  (' + ok + ' safe, ' + broken.length + ' broken, ' +
            unknown.length + ' unknown relation, ' + dynamic.length + ' non-literal table)');
console.log('relations parsed from the repo SQL: ' + Object.keys(schema).length);
console.log('');

if (broken.length) {
  console.log('=== ' + broken.length + ' CALL SITE(S) PAGING ON AN `id` THAT DOES NOT EXIST ===');
  broken.forEach(function (b) {
    console.log('  ' + b.site.file + ':' + b.site.line + '   ' + b.site.table +
                '   (' + b.rel.kind + ', declared in ' + b.rel.where + ')');
  });
  console.log('');
  console.log('Each returns 400 / 42703 on EVERY read. Use a plain select: a keyset cursor must');
  console.log('be a single unique non-null column, so a composite key has nothing to pass as `key`.');
}
if (unknown.length) {
  console.log('=== ' + unknown.length + ' relation(s) not found in the repo SQL - NOT a pass ===');
  [...new Set(unknown.map(function (u) { return u.table; }))].forEach(function (t) {
    console.log('  ' + t + '   (' + unknown.filter(function (u) { return u.table === t; })
      .map(function (u) { return u.file + ':' + u.line; }).join(', ') + ')');
  });
}
if (dynamic.length) {
  console.log('=== ' + dynamic.length + ' call site(s) with a non-literal table name ===');
  dynamic.forEach(function (d) { console.log('  ' + d.file + ':' + d.line + '   ' + d.raw); });
}

/* ---- the projection side: does the cols list carry the cursor? ---- */
var guard = forcesCursor();
var thin = [], dynCols = [], resolved = [];
sites.forEach(function (s) {
  var c = colsOf(s.colsArg, { src: s.src, index: s.index });
  if (c.kind === 'star') return;
  if (c.kind === 'dynamic') { dynCols.push({ site: s, raw: c.raw }); return; }
  if (c.via) resolved.push({ site: s, c: c });
  if (c.names.indexOf(s.keyName) === -1) thin.push({ site: s, c: c });
});

if (!guard.ok) {
  console.log('=== FATAL - ' + guard.why.toUpperCase() + ' ===');
  console.log('Every call site below then truncates at 1000 rows again, silently. Restore the');
  console.log('`need` guard in `selectAll` (it folds the cursor column into the projection) or');
  console.log('add the cursor to each cols string by hand.');
  console.log('');
}

if (thin.length) {
  console.log('=== ' + thin.length + ' cols list(s) that do NOT name the cursor column ===');
  thin.forEach(function (t) {
    console.log('  ' + t.site.file + ':' + t.site.line + '   cursor "' + t.site.keyName +
                '" absent   -> ' + t.c.text.slice(0, 58));
  });
  console.log(guard.ok
    ? '  Safe TODAY only because `selectAll` folds the cursor in for them (see forcesCursor).\n' +
      '  Advisory, not a failure. Any code that pages WITHOUT going through selectAll -- the\n' +
      '  Edge Functions roll their own -- gets no such protection and must select its cursor.'
    : '  THESE ARE LIVE TRUNCATIONS: the guard that was covering them is gone.');
  console.log('');
}
// Not a finding — the opposite. Printed so that a site read through a variable cannot drop
// out of the report altogether, which is how the cash-flow pair stayed invisible through
// the round that was meant to catch exactly it.
if (resolved.length) {
  console.log('=== ' + resolved.length + ' cols list(s) read through a VARIABLE (resolved) ===');
  resolved.forEach(function (r) {
    console.log('  ' + r.site.file + ':' + r.site.line + '   ' + r.c.via);
    console.log('      -> ' + r.c.text.slice(0, 58));
  });
  console.log('');
}
if (dynCols.length) {
  console.log('=== ' + dynCols.length + ' cols list(s) built at runtime - NOT a pass, just unreadable ===');
  dynCols.forEach(function (d) { console.log('  ' + d.site.file + ':' + d.site.line + '   ' + d.raw); });
  console.log('');
}

process.exit((broken.length || !guard.ok) ? 1 : 0);
