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

/* One pass, in order, keeping a live map of what exists. A declaration adds; a
   drop removes. Whatever is still in the map at the end is what the schema should
   actually hold today. */
const live = new Map();   // key -> {migration, kind, obj, col}
const add = (migration, kind, obj, col) => live.set(`${kind}:${obj}:${col}`, { migration, kind, obj, col });
const del = (kind, obj, col) => live.delete(`${kind}:${obj}:${col}`);

for (const f of files) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');

  for (const m of s.matchAll(/create table if not exists\s+(?:public\.)?([a-z0-9_]+)/gi)) add(f, 'table', m[1], '');
  for (const m of s.matchAll(/alter table\s+(?:public\.)?([a-z0-9_]+)\s+add column if not exists\s+([a-z0-9_]+)/gi)) add(f, 'column', m[1], m[2]);
  for (const m of s.matchAll(/create or replace function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) add(f, 'function', m[1], '');

  // Retirements. A dropped table takes its columns with it, or the verifier would
  // go on demanding columns of a table that is supposed to be gone.
  for (const m of s.matchAll(/drop function if exists\s+(?:public\.)?([a-z0-9_]+)/gi)) del('function', m[1], '');
  for (const m of s.matchAll(/alter table\s+(?:public\.)?([a-z0-9_]+)\s+drop column if exists\s+([a-z0-9_]+)/gi)) del('column', m[1], m[2]);
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
