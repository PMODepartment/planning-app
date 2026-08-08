-- ============================================================================
-- Progress Photos — PPR Presentations (the "View PPRs" side of the app)
-- ----------------------------------------------------------------------------
-- A PPR is a monthly Project Performance Review presentation: one row per
-- meeting (project + PPR date + description, e.g. "PPR ftm of June 2026").
-- Each slide is a BEFORE/AFTER pair at one location — last month's photo beside
-- this month's — tagged Trade / Works / Location, with an optional Key Plan.
--
-- The two photos are REFERENCES into `progress_photos`, not fresh uploads: the
-- Photos Database stays the single source of truth for imagery, and a slide is
-- a curated pairing of two shots already in the library.
--   • on delete set null — deleting a photo must not silently delete the PPR
--     slide that cites it; the slide survives with an empty frame so a planner
--     can see what went missing and re-pick.
--
-- Idempotent — safe to re-run. Folded into supabase-schema.sql.
-- ============================================================================

-- 1) The presentation (one per PPR meeting) --------------------------------
create table if not exists ppr_presentations (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  ppr_date    date,                  -- PPR meeting date
  description text,                  -- e.g. "PPR ftm of June 2026"
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 2) The slides (a before/after pair each) ---------------------------------
create table if not exists ppr_slides (
  id              uuid primary key default gen_random_uuid(),
  ppr_id          uuid references ppr_presentations(id) on delete cascade,
  project_id      text references projects(id),
  slide_no        integer default 1,
  trade           text,
  works           text,
  location        text,
  key_plan_url    text,              -- Storage path (progress-photos bucket)
  before_photo_id uuid references progress_photos(id) on delete set null,
  after_photo_id  uuid references progress_photos(id) on delete set null,
  before_caption  text,              -- e.g. "Aerial View facing Marikina River ftm of May 2026."
  after_caption   text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists ppr_presentations_proj_date_idx
  on ppr_presentations (project_id, ppr_date desc);
create index if not exists ppr_slides_ppr_idx
  on ppr_slides (ppr_id, slide_no);

-- 3) Grants + RLS ----------------------------------------------------------
-- Same shape as every other module table: read = project access, write = own
-- rows or admin. (The schema's RLS loop covers these two tables as well; this
-- block makes the migration standalone-runnable.)
grant select, insert, update, delete on ppr_presentations to authenticated;
grant select, insert, update, delete on ppr_slides        to authenticated;

do $$
declare t text;
begin
  foreach t in array array['ppr_presentations','ppr_slides'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('create policy %I on %I for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id))', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('create policy %I on %I for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format('create policy %I on %I for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_del', t);
  end loop;
end $$;
