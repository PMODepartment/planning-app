-- Engineering App design-progress MIRROR (Design Development source) -----------
-- The drawing register and material submittal log live in a SEPARATE Supabase
-- project (the Engineering App) and are AUTHORITATIVE there — this app's own
-- `drawing_register` / `material_submittal` tables are the pre-cutover originals
-- and are being retired. Its anon key is public (client JS), so we do NOT read it
-- from the browser: the Edge Function `supabase/functions/sync-eng` reads it
-- SERVER-SIDE with the Engineering service key and writes this mirror. The
-- Project Schedule's Design Development branch then reads this table under normal
-- RLS.
--
-- ⚠️ THIS MIRRORS THE ROLL-UP, NOT THE ROWS — one row per (project, source, top
-- level), i.e. a handful per project rather than the register's 1,500+. Two
-- reasons, both learned from the `wpm_work_packages` mirror:
--   • Pruning becomes inherent. That mirror only ever upserts, so a work package
--     deleted upstream lives in it forever and keeps contributing. `sync-eng`
--     DELETEs a project's rows and re-inserts, so a deleted drawing type simply
--     stops existing here.
--   • Nothing but percentages and two dates crosses the boundary. The schedule
--     needs exactly that; shipping every drawing would expose far more for no gain.
--
-- ⚠️ The two progress bases are computed ONCE, in the Edge Function, because they
-- are not interchangeable: For Construction / Concept / Schematic count 0-or-100
-- TRACKING UNITS at equal weight, Individual Services Drawings count SHEETS with
-- partial credit. `units_total`/`units_done` are therefore units in one mode and
-- sheets in the other, and `basis` says which so a reader can label it honestly.
-- Re-deriving that here, in a second codebase, is how the two silently disagree.

create table if not exists eng_design_progress (
  id                uuid primary key default gen_random_uuid(),
  project_id        text not null,          -- SAME id in both apps: projects are
                                            -- sourced FROM this app (migration 0009
                                            -- there), so no mapping table is needed
                                            -- — unlike the WPM mirror.
  source            text not null,          -- 'drawing' | 'submittal'
  top_level         text not null,          -- 'For Construction Drawings' | …
  basis             text,                   -- 'binary' (units) | 'sheets' | 'items'
  percent_complete  numeric(5,2),
  units_total       integer,
  units_done        integer,
  min_planned       date,                   -- earliest commitment in the set
  max_planned       date,                   -- LATEST commitment: a Gantt bar has to
                                            -- finish on something, and using the
                                            -- earliest for both ends draws a
                                            -- zero-duration bar
  max_actual        date,                   -- only once EVERYTHING is approved
  fallback          boolean default false,  -- no tracking unit flagged upstream, so
                                            -- each leaf drawing counted as its own
  synced_at         timestamptz default now(),
  unique (project_id, source, top_level)
);

create index if not exists idx_eng_progress_proj on eng_design_progress(project_id);

-- Read is PROJECT-SCOPED, not merely approval-gated. The WPM mirror gates on
-- is_approved() alone because it carries no Planners project id; this one carries
-- the real id, so there is no reason to let every approved user read every
-- project's design progress.
grant select on eng_design_progress to authenticated;

alter table eng_design_progress enable row level security;

drop policy if exists eng_design_progress_read on eng_design_progress;
create policy eng_design_progress_read on eng_design_progress
  for select using (can_access_project(project_id));

-- No insert/update/delete policy, deliberately: every write comes from the Edge
-- Function with the service key, which bypasses RLS. The browser can never write.

-- ROLLBACK ------------------------------------------------------------------
-- drop table if exists eng_design_progress;
