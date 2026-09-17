/* ============================================================================
   Regenerates migrations/VERIFY-schema.sql from the migration files themselves.

     node migrations/gen-verify.js

   Run it after adding a migration, so the verifier never lags the repo. It reads
   the .sql files and writes one .sql file; it touches no database.

   ⚠️ IT MODELS SUPERSESSION, and it has to. The first cut did not, and its very
      first run reported `admin_delete_workspace` missing from
      2026-07-16-consolidated.sql — when 2026-08-12-group-heads-replace-workspaces
      DROPS that function and the `workspaces` table outright. The function is
      correctly absent. A verifier that cries wolf about deliberately retired
      objects trains people to skim its output, which costs more than the check
      is worth: the four REAL findings in that same run were sitting next to the
      false one.

   ⚠️ ORDER IS FILENAME ORDER, which is date-prefixed and therefore the order the
      files were meant to be applied in. A drop only cancels a declaration that
      came BEFORE it — a later re-create must still be checked for.
   ============================================================================ */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname);
const files = fs.readdirSync(DIR).filter(f => /^2026-\d\d-\d\d-.*\.sql$/.test(f)).sort();

/* ⚠️⚠️ THE REGEXES BELOW MUST NEVER SEE A COMMENT, A STRING LITERAL, OR A
   DOLLAR-QUOTED FUNCTION BODY — a naive scan does, and it is wrong in both
   directions this repo has already been bitten by elsewhere (tools/scan.js,
   uicopy.py, cellcount.py): text that only LOOKS like DDL inside a string or a
   comment gets treated as real DDL. Two real instances shipped in this very
   file's own migrations before this mask existed:
     - 2026-09-10-scurve-manual-poc.sql's `raise exception` message ADVISES an
       operator to run `drop table if exists scurve_manual` by hand on a type
       mismatch — inside a single-quoted string. The unmasked regex read that
       as a real drop and cancelled the table this migration creates.
     - 2026-09-12-pormac.sql's own commented-out rollback instructions
       (`-- drop table if exists pormac_conversations;`, etc.) read the same
       way — a `--` comment explaining how to UNDO the migration, not code.
   Both cancelled real, still-live tables and made this generator silently
   drop them from VERIFY-schema.sql. `maskSql` blanks every comment, string
   literal and dollar-quoted body to spaces (preserving newlines, so nothing
   downstream needs line numbers to shift) before either pass runs. */
function maskSql(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '-' && s[i + 1] === '-') {
      while (i < n && s[i] !== '\n') { out += s[i] === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      out += '  '; i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === "'") {
      out += ' '; i++;
      while (i < n) {
        if (s[i] === "'" && s[i + 1] === "'") { out += '  '; i += 2; continue; } // '' escape
        if (s[i] === "'") { out += ' '; i++; break; }
        out += s[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    if (c === '$') {
      // Dollar-quote tag: $$ or $tag$ — [A-Za-z_][A-Za-z0-9_]* between the dollars.
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i));
      if (m) {
        const tag = m[0];
        out += ' '.repeat(tag.length); i += tag.length;
        const close = s.indexOf(tag, i);
        const end = close === -1 ? n : close;
        for (; i < end; i++) out += s[i] === '\n' ? '\n' : ' ';
        if (close !== -1) { out += ' '.repeat(tag.length); i += tag.length; }
        continue;
      }
    }
    out += c; i++;
  }
  return out;
}

/* ⚠️ Self-tests run before a single real file is read. A masker that has
   never been shown the exact shapes that broke this generator proves
   nothing — these three are the two real bugs above, plus a control. */
(function selfTestMaskSql() {
  const cases = [
    {
      name: 'drop-inside-single-quoted-string (scurve-manual-poc shape)',
      src: "raise exception 'drop table if exists scurve_manual;';\ncreate table if not exists scurve_manual (id int);",
      mustNotMatch: /drop table if exists\s+scurve_manual\b/i,
      mustMatch: /create table if not exists\s+scurve_manual\b/i,
    },
    {
      name: 'drop-inside-line-comment (pormac shape)',
      src: '-- drop table if exists pormac_conversations;\ncreate table if not exists pormac_conversations (id int);',
      mustNotMatch: /drop table if exists\s+pormac_conversations\b/i,
      mustMatch: /create table if not exists\s+pormac_conversations\b/i,
    },
    {
      name: 'create-inside-block-comment',
      src: '/* create table if not exists ghost (id int); */\nselect 1;',
      mustNotMatch: /create table if not exists\s+ghost\b/i,
    },
    {
      name: 'real-drop-outside-any-mask still fires',
      src: 'drop table if exists retired_thing;',
      mustMatch: /drop table if exists\s+retired_thing\b/i,
    },
    {
      name: 'dollar-quoted function body hides its own text but not the CREATE keyword',
      src: "create or replace function foo() returns void as $$\nbegin\n  -- drop table if exists bar;\n  execute 'drop table if exists bar';\nend;\n$$ language plpgsql;",
      mustMatch: /create or replace function\s+foo\s*\(/i,
      mustNotMatch: /drop table if exists\s+bar\b/i,
    },
  ];
  for (const t of cases) {
    const masked = maskSql(t.src);
    if (t.mustNotMatch && t.mustNotMatch.test(masked)) {
      throw new Error(`gen-verify.js self-test FAILED (${t.name}): masked text still matches ${t.mustNotMatch}`);
    }
    if (t.mustMatch && !t.mustMatch.test(masked)) {
      throw new Error(`gen-verify.js self-test FAILED (${t.name}): masked text lost ${t.mustMatch}`);
    }
  }
})();

/* ⚠️⚠️ A COMMA-CHAINED `alter table X add column …, add column …, add column …;`
   ONLY EVER MATCHED ITS FIRST COLUMN under the old per-clause regex — it
   required "alter table X" immediately before "add column", which is only
   ever true once per statement. Real instance: 2026-07-01-project-schedule-
   opc-fields.sql chains 17 columns onto one `alter table project_schedule`;
   16 of them were never tracked. `alterBlocks(s)` finds each whole
   `alter table X ... ;` statement and returns its table name plus body, so
   every `add column` / `drop column` clause inside that body — however many —
   is then found by a second, block-scoped scan. Self-tested against exactly
   that shape below, so a regression here fails loudly rather than silently
   going back to "first column only". */
function alterBlocks(s) {
  return [...s.matchAll(/alter table\s+(?:public\.)?([a-z0-9_]+)\s+([\s\S]*?);/gi)]
    .map(m => ({ table: m[1], body: m[2] }));
}
(function selfTestAlterBlocks() {
  const src = 'alter table project_schedule\n' +
    '  add column if not exists owner text,\n' +
    '  add column if not exists work_package text,\n' +
    "  add column if not exists duration_type text default 'Fixed';\n" +
    'alter table other_table drop column if exists old_a, drop column if exists old_b;';
  const blocks = alterBlocks(maskSql(src));
  const cols = (table) => blocks.filter(b => b.table === table)
    .flatMap(b => [...b.body.matchAll(/add column if not exists\s+([a-z0-9_]+)/gi)].map(m => m[1]));
  const got = cols('project_schedule');
  const expected = ['owner', 'work_package', 'duration_type'];
  if (got.join(',') !== expected.join(',')) {
    throw new Error(`gen-verify.js self-test FAILED (multi-column add column): got [${got}], expected [${expected}]`);
  }
  const dropBlock = blocks.find(b => b.table === 'other_table');
  const drops = dropBlock ? [...dropBlock.body.matchAll(/drop column if exists\s+([a-z0-9_]+)/gi)].map(m => m[1]) : [];
  if (drops.join(',') !== 'old_a,old_b') {
    throw new Error(`gen-verify.js self-test FAILED (multi-column drop column): got [${drops}]`);
  }
})();

/* One pass, in order, keeping a live map of what exists. A declaration adds; a
   drop removes. Whatever is still in the map at the end is what the schema should
   actually hold today. */
const live = new Map();   // key -> {migration, kind, obj, col}
const add = (migration, kind, obj, col) => live.set(`${kind}:${obj}:${col}`, { migration, kind, obj, col });
const del = (kind, obj, col) => live.delete(`${kind}:${obj}:${col}`);

for (const f of files) {
  const s = maskSql(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const blocks = alterBlocks(s);

  for (const m of s.matchAll(/create table if not exists\s+(?:public\.)?([a-z0-9_]+)/gi)) add(f, 'table', m[1], '');
  for (const { table, body } of blocks)
    for (const cm of body.matchAll(/add column if not exists\s+([a-z0-9_]+)/gi)) add(f, 'column', table, cm[1]);
  for (const m of s.matchAll(/create or replace function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) add(f, 'function', m[1], '');

  // Retirements. A dropped table takes its columns with it, or the verifier would
  // go on demanding columns of a table that is supposed to be gone.
  for (const m of s.matchAll(/drop function if exists\s+(?:public\.)?([a-z0-9_]+)/gi)) del('function', m[1], '');
  for (const { table, body } of blocks)
    for (const cm of body.matchAll(/drop column if exists\s+([a-z0-9_]+)/gi)) del('column', table, cm[1]);
  for (const m of s.matchAll(/drop table if exists\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    del('table', m[1], '');
    for (const k of [...live.keys()]) if (k.startsWith(`column:${m[1]}:`)) live.delete(k);
  }
}

const rows = [...live.values()].sort((a, b) =>
  a.migration.localeCompare(b.migration) || a.kind.localeCompare(b.kind) ||
  a.obj.localeCompare(b.obj) || a.col.localeCompare(b.col));

const vals = rows.map(r => `    ('${r.migration}','${r.kind}','${r.obj}','${r.col}')`).join(',\n');

const sql = [
'-- ============================================================================',
'-- MIGRATION VERIFIER — Planners Dashboard',
'--',
'-- GENERATED FILE. Do not hand-edit: run `node migrations/gen-verify.js` instead,',
'-- which rebuilds it from the migration files themselves.',
'--',
'-- Paste the whole file into the Supabase SQL editor and run it. IT WRITES NOTHING.',
'-- It returns one row per migration whose declared tables / columns / functions are',
'-- not all present, naming exactly which objects are missing.',
'--',
'-- NO ROWS RETURNED = every migration in the repo is applied. Any row listed is a',
'-- migration that has not been fully applied: run that file, then re-run this.',
'--',
'-- ⚠️ IT CHECKS OBJECT EXISTENCE ONLY — not RLS policies, grants, index definitions,',
'--    trigger bodies or back-fills. A file can look complete here and still have had',
'--    its policy block skipped, so read a clean result as "the schema is there", not',
'--    as "every migration ran end to end".',
'-- ⚠️ A column is only checked when its TABLE exists, so a missing table is reported',
'--    once rather than dragging every one of its columns in behind it.',
'-- ⚠️ SUPERSEDED OBJECTS ARE EXCLUDED. Anything a later migration drops (the',
'--    `workspaces` table and `admin_delete_workspace`, for one) is correctly absent',
'--    and is not asked for. See gen-verify.js for why that matters.',
'-- ============================================================================',
'with expected(migration, kind, obj, col) as (values',
vals,
'),',
'missing as (',
'  select e.* from expected e',
"  where (e.kind = 'table'    and to_regclass('public.' || e.obj) is null)",
"     or (e.kind = 'function' and not exists (",
'           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace',
"            where n.nspname = 'public' and p.proname = e.obj))",
"     or (e.kind = 'column'   and to_regclass('public.' || e.obj) is not null",
'           and not exists (',
'           select 1 from information_schema.columns c',
"            where c.table_schema = 'public' and c.table_name = e.obj",
'              and c.column_name = e.col))',
')',
'select migration,',
'       count(*) as missing_objects,',
"       string_agg(kind || ' ' || obj || coalesce('.' || nullif(col, ''), ''), ', '",
'                  order by kind, obj, col) as what_is_missing',
'  from missing',
' group by migration',
' order by migration;'
].join('\n');

fs.writeFileSync(path.join(DIR, 'VERIFY-schema.sql'), sql + '\n');
console.log(`VERIFY-schema.sql: ${rows.length} live objects from ${files.length} migrations`);
