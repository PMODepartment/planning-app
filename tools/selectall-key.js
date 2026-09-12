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
        var depth = 0, j = open, args = [], cur = '', inS = null;
        for (; j < src.length; j++) {
          var c = src[j];
          if (inS) { if (c === inS && src[j-1] !== '\\') inS = null; cur += c; continue; }
          if (c === '"' || c === "'" || c === '`') { inS = c; cur += c; continue; }
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
          line: src.slice(0, m.index).split('\n').length,
          table: tm ? tm[1] : null,
          raw: a0.slice(0, 40),
          arity: args.length,
          hasKeyArg: args.length >= 4 && args[3].trim() !== '' && args[3].trim() !== 'undefined'
        });
      }
    });
  })(ROOT);
  return out;
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
      !/(^|,|\s)([a-z_][a-z0-9_]*\.)?id(\s|,|$)/i.test('select pa.vendor_id, pa.category ')]
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
process.exit(broken.length ? 1 : 0);
