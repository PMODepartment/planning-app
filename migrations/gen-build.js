/* ============================================================================
   Builds `supabase-build.sql` — ONE file that creates the whole database.

     node migrations/gen-build.js

   WHY THIS EXISTS
     `supabase-schema.sql` and `supabase-setup.sql` have both drifted, in opposite
     directions, since 2026-07-16 — measured 2026-08-27 at **52** and **29** live
     tables missing respectively, out of 63. Neither can build the app, and both
     claim to. The drift is structural: every migration has to be remembered in two
     more places by hand, and it has now been forgotten dozens of times.

     So this file is GENERATED from `/migrations`, which is the only complete
     definition, and it is regenerated rather than edited. Adding a migration means
     running this script; there is nothing left to forget.

   ⚠️ FILENAME ORDER ALONE IS NOT SAFE, and that is the whole difficulty. Measured
      against the current 115 migrations, a naive date-order concatenation breaks in
      two ways, both silent-ish and both verified before this script was written:

      1. ALTER BEFORE CREATE (4 real cases). Same-date files sort alphabetically, so
         `2026-07-14-wpm-mirror-award-status.sql` runs before
         `2026-07-14-wpm-work-packages-mirror.sql` CREATES the table it alters.
         Also billing-milestones→cash_flow_settings and
         equipment-code-and-sharing→equipment_items.

      2. A FIX CLOBBERED BY THE FILE IT FIXED. `2026-06-18-fix-rls-recursion.sql`
         marks `can_access_project` SECURITY DEFINER to stop an RLS infinite
         recursion — and sorts BEFORE `2026-06-18-project-access-rls.sql`, whose
         version has no `security definer`. Date order therefore reinstates the
         stack-depth crash that fix exists to prevent.

   ⚠️ ORDER IS COMPUTED, NOT HAND-LISTED. A hand-kept order is the same maintenance
      burden as the two files this replaces. Dependencies are read out of the SQL
      (an ALTER depends on the CREATE) and a stable topological sort keeps filename
      order everywhere the dependencies do not care. The only hand-written input is
      PINS below — for a dependency no parser can see, i.e. "this fix must be last".
   ============================================================================ */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, '..', 'supabase-build.sql');

/* ⚠️ THE BASE SCHEMA COMES FIRST, AND IT IS NOT OPTIONAL. `/migrations` does NOT create
   `projects`, `users`, or the Phase-1 module starter tables (risk_register,
   drawing_register, ...) — every one of them lives only in `supabase-schema.sql`.
   A migrations-only build therefore fails on the very first foreign key to
   `projects(id)`. Checked, not assumed: `grep -l "create table if not exists projects"
   migrations/*.sql` returns nothing. */
const BASE = path.join(DIR, '..', 'supabase-schema.sql');
if (!fs.existsSync(BASE)) throw new Error('SANITY GATE: base schema not found at ' + BASE);
const baseSql = fs.readFileSync(BASE, 'utf8');
for (const must of ['projects', 'users']) {
  if (!new RegExp('create table if not exists\\s+' + must + '\\b').test(baseSql)) {
    throw new Error('SANITY GATE: base schema does not create ' + must + ' — refusing to build');
  }
}

const files = fs.readdirSync(DIR)
  .filter(f => /^\d{4}-\d{2}-\d{2}-.*\.sql$/.test(f))
  .sort();
if (files.length < 50) throw new Error('SANITY GATE: only ' + files.length + ' migrations found');

const body = new Map();
for (const f of files) body.set(f, fs.readFileSync(path.join(DIR, f), 'utf8'));
const codeOf = (f) => body.get(f).split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/* ⚠️ PINS — "A must run after B", for dependencies the SQL does not state.
   Keep this list as short as it can be, and say WHY for each: an unexplained pin is
   indistinguishable from a mistake the next time someone reads it. */
const PINS = [
  // fix-rls-recursion makes the helpers SECURITY DEFINER; project-access-rls redefines
  // can_access_project WITHOUT it. Alphabetically the fix sorts first, so without this
  // the build ships the recursing version.
  ['2026-06-18-fix-rls-recursion.sql', '2026-06-18-project-access-rls.sql'],
];

/* =====================================================================
   ⚠️ A BASE STATEMENT THAT TOUCHES A TABLE THE BASE DOES NOT CREATE MUST RUN LAST.
   `supabase-schema.sql` has had migrations hand-folded into it over the months, so
   its tail ALTERs `wbs_nodes` — a table ONLY /migrations creates. Emitting the base
   first therefore puts an ALTER before its CREATE, and no reordering of the
   migrations can fix that: the offending statement is in the base, not in them.

   The rule is general, not a hardcode for wbs_nodes: any base statement that
   references a table the base itself does not create is deferred to the very end
   of the build, where that table exists. Every such statement is idempotent
   (`add column if not exists`, a guarded `do $$`, `create index if not exists`),
   so running it late changes nothing except that it now succeeds.
   ===================================================================== */
function splitSql(sql) {
  // Statement splitter that understands the three things a naive split on ";" gets
  // wrong here: $$-quoted bodies, '...'-quoted literals, and -- line comments.
  const out = [];
  let buf = '', i = 0;
  while (i < sql.length) {
    if (sql.startsWith('$$', i)) {
      const end = sql.indexOf('$$', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      buf += sql.slice(i, stop); i = stop; continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      buf += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      const stop = nl < 0 ? sql.length : nl + 1;
      buf += sql.slice(i, stop); i = stop; continue;
    }
    if (sql[i] === ';') { out.push(buf + ';'); buf = ''; i++; continue; }
    buf += sql[i]; i++;
  }
  if (buf.length) out.push(buf);   // .length, not .trim() — the splitter must be exactly lossless,
                                   // or a future base statement could be dropped in silence.
  return out;
}

const baseCreates = new Set(
  [...baseSql.matchAll(/create table if not exists\s+(?:public\.)?([a-z0-9_]+)/gi)].map(m => m[1])
);
function baseTablesTouched(stmt) {
  const code = stmt.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const t = new Set();
  for (const m of code.matchAll(/alter table\s+(?:public\.)?([a-z0-9_]+)/gi)) t.add(m[1]);
  for (const m of code.matchAll(/create index[\s\S]*?\son\s+(?:public\.)?([a-z0-9_]+)/gi)) t.add(m[1]);
  return [...t];
}
const baseHead = [], baseTail = [];
for (const st of splitSql(baseSql)) {
  const refs = baseTablesTouched(st);
  (refs.length && refs.some(t => !baseCreates.has(t)) ? baseTail : baseHead).push(st);
}

// ---- dependencies -----------------------------------------------------------
const createdBy = new Map();          // table -> file that first creates it
// The base is emitted first by construction, so mark its tables as already created —
// otherwise an ALTER of `projects` has no CREATE to be ordered after and the graph
// silently drops the constraint.
for (const m of baseSql.matchAll(/create table if not exists\s+(?:public\.)?([a-z0-9_]+)/gi)) {
  if (!createdBy.has(m[1])) createdBy.set(m[1], '__base__');
}
for (const f of files) {
  for (const m of codeOf(f).matchAll(/create table if not exists\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    if (!createdBy.has(m[1])) createdBy.set(m[1], f);
  }
}

const after = new Map(files.map(f => [f, new Set()]));   // f must come after each of these
for (const f of files) {
  for (const m of codeOf(f).matchAll(/alter table\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    const c = createdBy.get(m[1]);
    if (c && c !== f && c !== '__base__') after.get(f).add(c);   // the base is always first
  }
}
for (const [a, b] of PINS) {
  if (!after.has(a)) throw new Error('PIN references a missing migration: ' + a);
  if (!after.has(b)) throw new Error('PIN references a missing migration: ' + b);
  after.get(a).add(b);
}

// ---- stable topological sort ------------------------------------------------
// Repeatedly take the FIRST file (in filename order) whose dependencies are all
// emitted. Stable by construction, so the output stays as close to date order as the
// dependencies allow — which keeps the diff readable when a migration is added.
const order = [];
const done = new Set();
const remaining = files.slice();
while (remaining.length) {
  const i = remaining.findIndex(f => [...after.get(f)].every(d => done.has(d)));
  if (i === -1) {
    throw new Error('CYCLE among: ' + remaining.slice(0, 6).join(', ') +
      ' — a migration cannot depend on one that depends on it. Check PINS.');
  }
  const f = remaining.splice(i, 1)[0];
  order.push(f);
  done.add(f);
}

// ---- emit -------------------------------------------------------------------
const moved = order.filter((f, i) => f !== files[i]);
const head = [
  '-- ============================================================================',
  '-- PLANNERS DASHBOARD — COMPLETE DATABASE BUILD',
  '--',
  '-- GENERATED FILE. Do not hand-edit: run `node migrations/gen-build.js`.',
  '-- Source of truth is /migrations; this is those files concatenated in an order',
  '-- that satisfies their dependencies.',
  '--',
  '-- CONTENTS: supabase-schema.sql (the base tables) followed by every migration.',
  '-- ⚠️ It does NOT seed the DEMO01 sandbox or promote the bootstrap admin — those are',
  '--    deliberate one-off acts, not schema, and they live in supabase-setup.sql.',
  '--',
  '-- Paste the whole file into the Supabase SQL editor and run it. Every migration',
  '-- is individually idempotent (verified: 0 `create policy` without a preceding',
  '-- drop across all ' + files.length + '), so this file is safe to re-run.',
  '--',
  '-- ⚠️ ORDER IS NOT FILENAME ORDER. ' + moved.length + ' file(s) are moved to satisfy a',
  '--    dependency the filenames get wrong — see gen-build.js for the two failure',
  '--    modes this prevents (ALTER before CREATE, and a fix clobbered by the file it',
  '--    fixes). Do not re-sort this file.',
  '--',
  '-- ⚠️ ' + baseTail.length + ' base statement(s) run AFTER the migrations — they touch tables',
  '--    that only /migrations creates. Do not move them back to the top.',
  '--',
  '-- ⚠️ Verify afterwards with migrations/VERIFY-schema.sql, which reports any',
  '--    declared table, column or function that is missing.',
  '--',
  '-- Generated from ' + files.length + ' migrations. Order changes vs filename order:',
  moved.length
    ? moved.map(f => '--   * ' + f + '  (now at position ' + (order.indexOf(f) + 1) + ')').join('\n')
    : '--   (none)',
  '-- ============================================================================',
  '',
].join('\n');

const basePart = [
  '',
  '-- ' + '='.repeat(74),
  '-- [000] supabase-schema.sql  (BASE — projects, users and the Phase-1 tables)',
  '-- ' + '='.repeat(74),
  baseHead.join('').replace(/\r\n/g, '\n').replace(/\s*$/, ''),
  '',
].join('\n');

const parts = order.map((f, i) => [
  '',
  '-- ' + '='.repeat(74),
  '-- [' + String(i + 1).padStart(3, '0') + '/' + files.length + '] ' + f,
  '-- ' + '='.repeat(74),
  body.get(f).replace(/\r\n/g, '\n').replace(/\s*$/, ''),
  '',
].join('\n'));

const tailPart = baseTail.length ? [
  '',
  '-- ' + '='.repeat(74),
  '-- [' + String(files.length + 1).padStart(3, '0') + '] supabase-schema.sql — DEFERRED TAIL',
  '-- These base statements touch tables that only /migrations creates (see',
  '-- gen-build.js), so they run last. All are idempotent.',
  '-- ' + '='.repeat(74),
  baseTail.join('').replace(/\r\n/g, '\n').replace(/\s*$/, ''),
  '',
].join('\n') : '';

fs.writeFileSync(OUT, head + basePart + parts.join('\n') + tailPart + '\n');
console.log('supabase-build.sql: ' + files.length + ' migrations, ' + moved.length + ' reordered');
moved.forEach(f => console.log('   moved: ' + f));
console.log('base: ' + baseHead.length + ' statements first, ' + baseTail.length + ' deferred to the end');
