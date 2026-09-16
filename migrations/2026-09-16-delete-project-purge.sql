-- ============================================================================
-- Migration: admin_delete_project() PURGES instead of refusing.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Owner, 2026-09-16: "I need to have the guard when deleting a project removed
-- since its very difficult to remove a project. I've removed the schedule in the
-- schedule module and still the project can't be removed probably due to the
-- default WBS. instead let's just remove the guard since the guard already is by
-- typing the project code first to be able to delete and this feature is only
-- accessible for super_admins."
--
-- ⚠️ ONE CORRECTION TO THAT, STATED RATHER THAN QUIETLY ACCEPTED: it is NOT
-- super_admin-only. is_admin() -- and AppAuth.requireAdmin on the client -- both
-- allow `admin` AND `super_admin`. The owner's decision was to leave the role as
-- it is, so this migration knowingly widens hard-delete to every admin. If that
-- is not what was wanted, the one-line change is a is_super_admin() test here.
--
-- ⚠️⚠️ WHY THE OWNER COULD NOT DELETE THAT PROJECT, measured rather than guessed.
-- `wbs_nodes` carries a `project_id` -- bare `text not null`, NO FOREIGN KEY at
-- all (2026-07-07-wbs-nodes.sql) -- and is not on the residue whitelist, so it
-- blocked. The schedule module auto-seeds a LOCKED 7-node WBS skeleton every
-- time the project is opened, and BOTH the client's `_clearWbsTree` and the
-- server's `clear_project_wbs_nodes` delete only `is_locked = false` rows. So
-- the skeleton is un-clearable AND self-reseeding: clearing the schedule writes
-- it straight back. The gate was unwinnable by construction -- the same shape as
-- the schedule_audit deadlock the 2026-08-12 migration was written to fix,
-- recurring with a different table.
--
-- ⚠️⚠️ AND REMOVING THE REFUSAL ALONE WOULD NOT HAVE MADE THE DELETE WORK.
-- Re-derived from supabase-build.sql before writing a line of this:
--
--     FKs to projects(id):   30 CASCADE   33 NO ACTION   2 SET NULL
--     tables with a project_id column: 89
--     ...of which NO FK to projects at all: 25  (wbs_nodes, schedule_baselines,
--        activity_*, equipment_*, manpower_*, location_levels, cost_accounts ...)
--
-- 33 NO ACTION means the final `delete from projects` would die on a raw foreign
-- key violation instead of the friendly message, and the 25 FK-less tables are
-- invisible to FK semantics entirely -- they are the actual blocker, and no
-- amount of ON DELETE CASCADE would reach them. THE FIX HAS TO PURGE.
--
-- ⚠️ REJECTED: converting the 33 NO ACTION FKs to ON DELETE CASCADE. It is the
-- purer schema change, and it is wrong here -- it permanently alters behaviour
-- far outside this feature (afterwards `delete from boq_revisions where id = ...`
-- silently takes its items, for every code path, for ever), it still would not
-- cover the 25 FK-less tables, and adding FKs to those would likely fail on
-- pre-existing orphan project codes. Reasonable hygiene later; too wide a side
-- effect to ride in on a delete button.
-- ============================================================================

-- ---- 1) The purge ----------------------------------------------------------
create or replace function admin_delete_project(target text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r       record;
  t       text;
  tables  text[];
  keep    text[] := '{}';   -- tables whose OWN project_id is declared SET NULL
  pending text[];
  nextq   text[];
  pass    int := 0;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from projects where id = target) then
    raise exception 'Project % not found', target;
  end if;

  -- 1a) UNLINK -- every FK to projects that the SCHEMA ITSELF declares SET NULL.
  --
  -- ⚠️⚠️ READ FROM THE CATALOG, NEVER A HARDCODED LIST, and my own repo grep is
  -- the argument for it: the first pass of that grep found only ONE SET NULL
  -- column, because `packages.planners_project_id` is declared by an
  -- `alter table ... add column` whose `references` clause sits on the NEXT LINE
  -- and the pattern could not cross it. A hardcoded list built from that pass
  -- would have DELETED every sibling package link in the database. The schema's
  -- own declaration is the single source of truth, and it stays that way.
  --
  -- Today this resolves to exactly two, both deliberate and both commented where
  -- they are declared:
  --   user_notes.project_id         -- "archiving a project must not delete
  --                                    somebody's own notes about it"
  --   packages.planners_project_id  -- a sibling-project link; the projects are
  --                                    peers, so one dying must not take it.
  for r in
    select src.relname as tbl, a.attname as col
      from pg_constraint c
      join pg_class src     on src.oid = c.conrelid
      join pg_class tgt     on tgt.oid = c.confrelid
      join pg_namespace ns  on ns.oid  = src.relnamespace
      join pg_attribute a   on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confdeltype = 'n'                 -- 'n' = ON DELETE SET NULL
       and tgt.relname = 'projects'
       and ns.nspname  = 'public'
       and array_length(c.conkey, 1) = 1       -- single-column FKs only
     order by src.relname, a.attname
  loop
    execute format('update %I set %I = null where %I = $1', r.tbl, r.col, r.col)
      using target;
    -- ⚠️ ONLY a SET NULL column actually NAMED project_id excuses its table from
    -- the delete sweep below. `packages` carries BOTH a cascading `project_id`
    -- (its own project -- those rows SHOULD go) and a SET NULL
    -- `planners_project_id` (a pointer from another project's package -- that
    -- row must survive). Excusing the whole table on the strength of the second
    -- column would strand every package of the project being deleted.
    if r.col = 'project_id' then keep := keep || r.tbl; end if;
  end loop;

  -- 1b) Everything else carrying a project_id, discovered from the catalog so a
  -- module added later is covered without touching this function. This is also
  -- what reaches the 25 FK-less tables -- wbs_nodes among them -- which is the
  -- whole reason the delete was impossible.
  select array_agg(c.relname order by c.relname) into tables
    from pg_attribute a
    join pg_class c      on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r'
     and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped
     and c.relname <> 'projects'
     and not (c.relname = any(keep));

  -- ⚠️⚠️ A RETRY LOOP, NOT A TOPOLOGICAL SORT. Deleting in catalog order can
  -- raise a foreign key violation BETWEEN two module tables (measured from the
  -- repo, only three such edges exist today: boq_billing_periods -> boq_revisions,
  -- progress_photos -> wbs_nodes, resource_assignments -> resources; everything
  -- else cascades, is SET NULL, or points at `users`). So: attempt every table,
  -- re-queue the ones that refused, repeat.
  --
  -- This self-orders, needs no graph code, and -- the point -- FAILS LOUDLY and
  -- names the tables if a future module ever introduces a cycle the sweep cannot
  -- resolve, instead of half-deleting a project and reporting success.
  pending := coalesce(tables, '{}');
  while array_length(pending, 1) > 0 and pass < 5 loop
    pass  := pass + 1;
    nextq := '{}';
    foreach t in array pending loop
      begin
        execute format('delete from %I where project_id = $1', t) using target;
      exception
        when foreign_key_violation then nextq := nextq || t;
      end;
    end loop;
    -- No progress this pass means every survivor is blocked by another survivor.
    if array_length(nextq, 1) = array_length(pending, 1) then
      raise exception
        'Could not purge project %: these tables reference each other (%). Nothing was deleted.',
        target, array_to_string(nextq, ', ');
    end if;
    pending := nextq;
  end loop;

  if array_length(pending, 1) > 0 then
    raise exception 'Could not purge project % after % passes; still blocked: %.',
      target, pass, array_to_string(pending, ', ');
  end if;

  -- 1c) users.projects is a text[] with NO foreign key -- strip the id so the
  -- assignment does not dangle on every user who had it.
  update users set projects = array_remove(projects, target)
   where projects @> array[target];

  delete from projects where id = target;
end $$;

-- ⚠️⚠️ THE SINGLE MOST LIKELY CAUSE OF AN OTHERWISE-CORRECT "IT JUST TIMES OUT".
-- PostgREST runs as the `authenticated` role, which this project caps at an 8s
-- statement_timeout. A 100k-row project_schedule purge across 89 tables will go
-- straight through that. The whole function body is ONE transaction, so a
-- timeout rolls all of it back -- which is the correct behaviour, and still a
-- delete that can never succeed. This raises the ceiling for THIS FUNCTION
-- ALONE; every other query keeps the 8s cap.
alter function admin_delete_project(text) set statement_timeout = '120s';

-- ⚠️ `create or replace` preserves privileges, so the grant from
-- 2026-07-16-consolidated.sql survives -- restated anyway so this file stands on
-- its own for a fresh deployment and for anyone reading only this migration.
grant execute on function admin_delete_project(text) to authenticated;

-- ---- 2) The preview, repurposed --------------------------------------------
-- Same signature, so `create or replace` works and the existing grant survives.
-- ⚠️ Its `class` column changes MEANING: it was 'residue' | 'blocking' -- words
-- describing a gate that no longer exists -- and is now 'delete' | 'unlink',
-- which is the only distinction left that a person needs before pressing a
-- button with no undo. It had ZERO callers (its own comment says "the
-- projects.html modal can call this to preview before it arms the button" -- it
-- never did), so repurposing it costs nothing and breaks nobody.
--
-- ⚠️ `project_residue_tables()` is deliberately LEFT ALONE. Nothing blocks any
-- more, so it no longer gates anything -- but it is referenced by
-- migrations/VERIFY-schema.sql and by the 2026-08-12 migration's own header, and
-- deleting a function to tidy up is how a verify script starts failing for a
-- reason nobody can trace.
create or replace function admin_project_delete_preview(target text)
returns table (table_name text, row_count bigint, class text)
language plpgsql security definer set search_path = public as $$
declare
  r    record;
  n    bigint;
  keep text[] := '{}';
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  -- Rows that will be KEPT and unlinked. Counted on the FK's own column, which
  -- is not always called project_id.
  for r in
    select src.relname as tbl, a.attname as col
      from pg_constraint c
      join pg_class src     on src.oid = c.conrelid
      join pg_class tgt     on tgt.oid = c.confrelid
      join pg_namespace ns  on ns.oid  = src.relnamespace
      join pg_attribute a   on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confdeltype = 'n'
       and tgt.relname = 'projects' and ns.nspname = 'public'
       and array_length(c.conkey, 1) = 1
     order by src.relname, a.attname
  loop
    if r.col = 'project_id' then keep := keep || r.tbl; end if;
    execute format('select count(*) from %I where %I = $1', r.tbl, r.col)
      into n using target;
    if n > 0 then
      table_name := r.tbl; row_count := n; class := 'unlink';
      return next;
    end if;
  end loop;

  -- Rows that will be DELETED.
  for r in
    select c.relname as tbl
      from pg_attribute a
      join pg_class c      on c.oid = a.attrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped
       and c.relname <> 'projects'
       and not (c.relname = any(keep))
     order by c.relname
  loop
    execute format('select count(*) from %I where project_id = $1', r.tbl)
      into n using target;
    if n > 0 then
      table_name := r.tbl; row_count := n; class := 'delete';
      return next;
    end if;
  end loop;
end $$;

grant execute on function admin_project_delete_preview(text) to authenticated;

-- ---- 3) ⚠️ ACCEPTED RESIDUE, NAMED RATHER THAN PAPERED OVER -----------------
-- If somebody has the schedule module open in another tab while this runs, its
-- `ensureWbsSkeleton()` can re-insert wbs_nodes rows AFTER the sweep has passed
-- that table -- there is no FK to stop it, which is the same fact that made the
-- old gate unwinnable. The result is a handful of orphan wbs_nodes rows keyed to
-- a project that no longer exists. They are invisible to every screen, and they
-- can be swept with:
--     delete from wbs_nodes w
--      where not exists (select 1 from projects p where p.id = w.project_id);

-- ---- 4) ⚠️ EXPLICITLY OUT OF SCOPE: STORAGE ---------------------------------
-- Seven private buckets hold objects under project-code-prefixed folders --
-- drawing-register, progress-photos, material-submittal, mom-attachments,
-- site-plans, contracts-claims, project-schedule -- and NOTHING here deletes
-- them. Scoped out on technical grounds, not laziness: `delete from
-- storage.objects` removes the METADATA ROWS but leaves the bytes in the backing
-- store (Supabase only reclaims those through the storage API), so the files
-- would become unreachable AND stay billed, which is worse than doing nothing.
-- Doing it properly needs an Edge Function holding the service-role key: a
-- different trust boundary and a different deployment artefact.
--
-- The delete dialog says the files remain. This reports what is left behind:
--     select bucket_id, count(*), pg_size_pretty(sum((metadata->>'size')::bigint))
--       from storage.objects where split_part(name, '/', 1) = 'CODE'
--      group by bucket_id;

-- ---- 5) Verify -------------------------------------------------------------
-- (a) Read the blast radius BEFORE deleting anything. Every row now comes back
--     'delete' or 'unlink'; nothing is 'blocking' any more.
--       select * from admin_project_delete_preview('TESTCODE');
--
-- (b) ⚠️ THE HONEST END-TO-END REHEARSAL -- destructive, then undone. Run it on
--     the SMALLEST real project and OFF-HOURS: it holds locks on 60+ tables for
--     its duration, and `rollback` cannot undo anything outside the database.
--       begin;
--         select * from admin_project_delete_preview('TESTCODE');
--         select admin_delete_project('TESTCODE');
--         select count(*) from projects   where id = 'TESTCODE';     -- expect 0
--         select count(*) from user_notes where project_id is null;  -- notes survived
--       rollback;
--
-- (c) The live FK inventory, which is the only real evidence -- VERIFICATION.md
--     documents measured drift between /migrations and this database.
--       select src.relname child, a.attname col, c.conname,
--              case c.confdeltype when 'a' then 'NO ACTION' when 'c' then 'CASCADE'
--                   when 'n' then 'SET NULL' when 'r' then 'RESTRICT' end on_delete
--         from pg_constraint c
--         join pg_class src on src.oid = c.conrelid
--         join pg_class tgt on tgt.oid = c.confrelid
--         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--        where c.contype = 'f' and tgt.relname = 'projects' order by on_delete, child;
--
-- (d) The timeout actually took:
--       select proname, proconfig from pg_proc where proname = 'admin_delete_project';
--     Expect proconfig to carry BOTH search_path=public and statement_timeout=120s.
