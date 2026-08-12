-- ============================================================================
-- Migration: admin_delete_project() — stop counting bookkeeping residue as
--            "the project still has data".
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- THE BUG: the delete gate discovers every public table carrying a project_id
-- and refuses the delete if ANY of them has a row. That treats an auto-created
-- default calendar and an append-only audit log exactly like a drawing register
-- full of real submittals. Worse, `schedule_audit` makes the gate unwinnable:
-- clearing a schedule WRITES audit rows, so emptying a project can never make
-- it deletable. NCIT hit precisely this — 0 activities left, blocked by
-- calendars (1), schedule_audit (45), schedule_baselines (1).
--
-- THE FIX: split the discovered tables into two classes.
--   * RESIDUE  — auto-provisioned defaults, append-only logs, and tables
--                DERIVED from the schedule. Never hand-entered, worthless once
--                the project is gone. Purged as part of the delete.
--   * SUBSTANTIVE — everything else. Still blocks, exactly as before.
--
-- Still catalog-driven for the substantive side: a module table added later is
-- covered automatically, because anything not named in the residue list blocks
-- by default. Fail-closed is the right default for a hard delete.
--
-- schedule_baselines is deliberately SUBSTANTIVE. A baseline is a deliberate
-- act of record-keeping — someone chose to freeze that schedule — so it is real
-- user work, not residue, even when the live schedule is gone. Clearing it is
-- a conscious decision the admin makes in the module, not a side effect of
-- pressing Delete.
-- ============================================================================

-- ---- 1) The residue list ---------------------------------------------------
-- A function, not a constant, so admin_delete_project() and any future caller
-- (a cleanup job, a test) agree on one definition.
--
-- calendars           auto-created default working calendar; appears the first
--                     time the schedule module opens, with no user action.
-- schedule_audit      append-only change log. Self-refilling — see above.
-- schedule_snapshots  point-in-time copies taken by the module, not by a user.
-- schedule_thresholds tuning knobs for alerts; defaults on a dead project.
-- s_curve             DERIVED from project_schedule. No schedule, no meaning.
-- cash_flow_rollup    DERIVED aggregate over the cash-flow inputs + S-curve.
--                     The cash-flow INPUT tables (settings, billing_milestones,
--                     dp_tranches, actuals, trade_packages, scenarios) are
--                     hand-entered and stay substantive.
create or replace function project_residue_tables()
returns text[] language sql immutable as $$
  select array[
    'calendars',
    'schedule_audit',
    'schedule_snapshots',
    'schedule_thresholds',
    's_curve',
    'cash_flow_rollup'
  ]
$$;

-- ---- 2) The gate -----------------------------------------------------------
create or replace function admin_delete_project(target text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t        text;
  n        bigint;
  blockers text := '';
  residue  text[] := project_residue_tables();
  tables   text[];
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from projects where id = target) then
    raise exception 'Project % not found', target;
  end if;

  -- Every public table referencing a project, discovered from the catalog so a
  -- module added later is covered without touching this function.
  select array_agg(c.relname order by c.relname) into tables
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r'
     and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped
     and c.relname <> 'projects';

  -- Substantive tables block. Report ALL of them, not just the first, so the
  -- admin learns in one pass what they'd have to clear.
  foreach t in array coalesce(tables, '{}') loop
    if not (t = any(residue)) then
      execute format('select count(*) from %I where project_id = $1', t) into n using target;
      if n > 0 then blockers := blockers || format('%s (%s), ', t, n); end if;
    end if;
  end loop;

  if blockers <> '' then
    raise exception 'Project % still has data in: %. Archive it instead, or clear these first.',
      target, rtrim(blockers, ', ');
  end if;

  -- Nothing substantive left: purge the residue. Intersected with `tables` so a
  -- residue name that does not exist in this database is skipped rather than
  -- erroring — keeps the function safe across environments that are mid-migration.
  foreach t in array coalesce(tables, '{}') loop
    if t = any(residue) then
      execute format('delete from %I where project_id = $1', t) using target;
    end if;
  end loop;

  -- users.projects is a text[] with no FK — strip the id so assignments don't dangle.
  update users set projects = array_remove(projects, target)
   where projects @> array[target];

  delete from projects where id = target;
end $$;

-- ---- 3) Dry-run helper -----------------------------------------------------
-- Answers "why can't I delete this?" without attempting the delete, and shows
-- the residue that WOULD be purged so the decision is made with eyes open.
-- The projects.html modal can call this to preview before it arms the button.
create or replace function admin_project_delete_preview(target text)
returns table (table_name text, row_count bigint, class text)
language plpgsql security definer set search_path = public as $$
declare
  t       text;
  n       bigint;
  residue text[] := project_residue_tables();
begin
  if not is_admin() then raise exception 'Not authorized'; end if;

  for t in
    select c.relname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and a.attname = 'project_id' and a.attnum > 0 and not a.attisdropped
       and c.relname <> 'projects'
     order by c.relname
  loop
    execute format('select count(*) from %I where project_id = $1', t) into n using target;
    if n > 0 then
      table_name := t;
      row_count  := n;
      class      := case when t = any(residue) then 'residue' else 'blocking' end;
      return next;
    end if;
  end loop;
end $$;

grant execute on function project_residue_tables()            to authenticated;
grant execute on function admin_project_delete_preview(text)  to authenticated;

-- ---- 4) Verify -------------------------------------------------------------
-- Run this BEFORE deleting anything. NCIT should now come back with the three
-- rows classed 'residue' + 'blocking' — and only 'blocking' rows can stop it.
--   select * from admin_project_delete_preview('NCIT');
