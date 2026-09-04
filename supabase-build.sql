-- ============================================================================
-- PLANNERS DASHBOARD — COMPLETE DATABASE BUILD
--
-- GENERATED FILE. Do not hand-edit: run `node migrations/gen-build.js`.
-- Source of truth is /migrations; this is those files concatenated in an order
-- that satisfies their dependencies.
--
-- CONTENTS: supabase-schema.sql (the base tables) followed by every migration.
-- ⚠️ It does NOT seed the DEMO01 sandbox or promote the bootstrap admin — those are
--    deliberate one-off acts, not schema, and they live in supabase-setup.sql.
--
-- Paste the whole file into the Supabase SQL editor and run it. Every migration
-- is individually idempotent (verified: 0 `create policy` without a preceding
-- drop across all 142), so this file is safe to re-run.
--
-- ⚠️ ORDER IS NOT FILENAME ORDER. 9 file(s) are moved to satisfy a
--    dependency the filenames get wrong — see gen-build.js for the two failure
--    modes this prevents (ALTER before CREATE, and a fix clobbered by the file it
--    fixes). Do not re-sort this file.
--
-- ⚠️ 4 base statement(s) run AFTER the migrations — they touch tables
--    that only /migrations creates. Do not move them back to the top.
--
-- ⚠️ Verify afterwards with migrations/VERIFY-schema.sql, which reports any
--    declared table, column or function that is missing.
--
-- Generated from 142 migrations. Order changes vs filename order:
--   * 2026-06-18-grants.sql  (now at position 2)
--   * 2026-06-18-phase2-modules.sql  (now at position 3)
--   * 2026-06-18-project-access-rls.sql  (now at position 4)
--   * 2026-06-18-fix-rls-recursion.sql  (now at position 5)
--   * 2026-07-14-wpm-work-packages-mirror.sql  (now at position 45)
--   * 2026-07-14-wpm-mirror-award-status.sql  (now at position 46)
--   * 2026-07-14-wpm-mirror-trade.sql  (now at position 47)
--   * 2026-08-24-equipment-loading.sql  (now at position 98)
--   * 2026-08-24-equipment-code-and-sharing.sql  (now at position 99)
-- ============================================================================

-- ==========================================================================
-- [000] supabase-schema.sql  (BASE — projects, users and the Phase-1 tables)
-- ==========================================================================
-- ============================================================================
-- Planners Dashboard — Supabase schema (Phase 1)
-- Run this in the Supabase SQL Editor of the NEW planning project.
-- All statements are idempotent (IF NOT EXISTS) and safe to re-run.
--
-- ⚠️ NOT the complete DB, and the pointer that used to be here was wrong.
-- This is the Phase-1 BASE only; measured 2026-08-27 it is missing 52 of the 63
-- live tables. It previously sent readers to `supabase-setup.sql` "for a complete
-- one-paste build" — that file has since drifted too (29 tables missing).
--
-- ➡️ FOR A COMPLETE BUILD, RUN `supabase-build.sql` (generated:
--    `node migrations/gen-build.js`).
--
-- ⚠️ THIS FILE IS AN INPUT TO THAT GENERATOR, so it is not dead — it is the only
-- place `projects`, `users` and the Phase-1 module tables are created, and the
-- generated build starts with it. Keep adding a new module's base table here per
-- MODULE_CONTRACT.md; do NOT fold whole migrations in.
--
-- ⚠️ Its tail already ALTERs `wbs_nodes`, a table only /migrations creates, so
-- the generator defers those statements to the end of the build. Adding more
-- hand-folded migration bodies here makes that worse, not better.
--
-- Conventions for module developers (see MODULE_CONTRACT.md):
--   * Every module owns its own table(s), prefixed with the module key,
--     e.g. risk_register, drawing_register, material_submittal.
--   * Every module table has: id (uuid PK), project_id (text FK -> projects),
--     created_by (uuid), created_at, updated_at.
--   * Enable RLS and add the standard policies (template at the bottom).
-- ============================================================================

-- ---- Shared: projects ------------------------------------------------------
create table if not exists projects (
  id          text primary key,                 -- e.g. 'AVR101'
  name        text not null,
  location    text,
  status      text default 'active',            -- active | archived
  start_date  date,
  end_date    date,
  created_at  timestamptz default now()
);

-- ---- Shared: users (profiles, FK to auth.users) ----------------------------
create table if not exists users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  role        text default 'user'
                check (role in ('super_admin','admin','planner','user','viewer')),
  status      text default 'pending'
                check (status in ('pending','approved','rejected')),
  projects    text[] default '{}',              -- assigned project ids
  last_login  timestamptz,
  created_at  timestamptz default now()
);

-- ============================================================================
-- MODULE TABLES (Phase 1)
-- Each block is owned by the module's developer. Columns here are a STARTING
-- POINT — developers extend their own table via ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS and document it in their module's CLAUDE.md.
-- ============================================================================

-- 1) Progress Photos ---------------------------------------------------------
create table if not exists progress_photos (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  title       text,
  description text,
  photo_url   text,                  -- Supabase Storage path
  taken_at    date,                  -- capture date
  location    text,
  trade       text,                  -- DEPRECATED: first-selected value only, see trades below
  works       text,                  -- DEPRECATED: first-selected value only, see works_multi below
  trades      text[] default '{}'::text[],       -- multi-select (2026-08-29 feedback item 2)
  works_multi text[] default '{}'::text[],        -- multi-select (2026-08-29 feedback item 2)
  sort_order  integer,
  tags        text[],                -- optional Activity Code overlay, "<code type>: <value>"
  wbs_node_id uuid,                   -- legacy (Phase 1 first cut); references wbs_nodes(id) if ever set,
                                       -- no longer written by new captures — see location_values below
  activity_id text,                   -- snapshot of the schedule's "current" activity at capture time
  activity_name text,
  location_values jsonb default '{}'::jsonb,   -- { "<location_level_id>": "value string" } — mirrors
                                       -- project_schedule.location's shape exactly (migrations/2026-08-12-*.sql);
                                       -- Project Schedule's real "Location Breakdown", NOT the wbs_nodes tree
  key_plan_url text,                  -- Storage path (progress-photos bucket, <project>/keyplans/).
                                       -- Key plan is per PHOTO, not per PPR slide (migrations/2026-08-28-*.sql):
                                       -- one comparison can pair two photos with different key plans.
  archived    boolean default false,  -- soft-archive (Gallery batch action, 2026-08-29 follow-up) — never a hard delete
  media_type  text default 'photo',  -- 'photo' | 'video' (18-item list item 4) — never related to 360/3D/Gaussian Splatting
  markup      jsonb default '[]'::jsonb,  -- vector annotation layer (18-item list item 13), hidden on Gallery tiles
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 1b) PPR Presentations (progress-photos module) -----------------------------
-- A PPR = one monthly Project Performance Review presentation; each slide is a
-- before/after pair referencing two `progress_photos` rows (the photo library
-- stays the single source of truth). See migrations/2026-07-17-ppr-presentations.sql
create table if not exists ppr_presentations (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  ppr_date    date,                  -- PPR meeting date
  description text,                  -- e.g. "PPR ftm of June 2026"
  archived    boolean default false, -- soft-archive (Presentations-list row action, 2026-08-29 follow-up)
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

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
  before_caption  text,
  after_caption   text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists ppr_presentations_proj_date_idx
  on ppr_presentations (project_id, ppr_date desc);

-- Report Templates (brief Section 5 / Phase 2) — a saved, re-runnable report
-- definition. See migrations/2026-08-29-ppr-report-templates.sql for the full
-- design rationale (jsonb locations array, comparison_rule semantics).
create table if not exists ppr_report_templates (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  name            text not null,
  meeting_type    text default 'client',
  comparison_rule text default 'previous',
  locations       jsonb default '[]'::jsonb,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists ppr_report_templates_proj_idx
  on ppr_report_templates (project_id, name);

-- Panoramic Capture (brief Section 6 / Phase 3). See
-- migrations/2026-08-29-panoramas.sql for the full design rationale.
create table if not exists panoramas (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  location_values jsonb default '{}'::jsonb,
  location        text,
  activity_id     text,
  activity_name   text,
  pano_url        text,
  frame_count     integer,
  stitch_quality  text default 'ok',
  taken_at        date,
  source          text default 'ground', -- 'ground' | 'drone' (brief 6C / Phase 6)
  archived        boolean default false, -- soft-archive (Gallery batch action, 2026-08-29 follow-up)
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists panoramas_proj_idx on panoramas (project_id, taken_at desc);

-- 3D Reconstruction Requests (brief 6A / Phase 4) — admin-approval-gated
-- ahead of a PAID GPU processing step. See
-- migrations/2026-08-29-reconstruction-requests.sql for the full RLS
-- rationale — this table is deliberately NOT in the generic module-table
-- RLS loop below (its update policy must be admin-only, not own-row).
create table if not exists reconstruction_requests (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text references projects(id),
  location_values       jsonb default '{}'::jsonb,
  location              text,
  activity_id           text,
  activity_name         text,
  video_url             text,
  video_source          text default 'ground',
  requested_note        text,
  status                text default 'pending_approval',
  requested_by          uuid references users(id),
  approved_by           uuid references users(id),
  approved_at           timestamptz,
  rejected_reason       text,
  runpod_job_id         text,
  webhook_token         text,
  result_pointcloud_url text,
  result_splat_url      text,
  result_stats          jsonb,
  error_message         text,
  archived              boolean default false, -- soft-archive (Gallery batch action, 2026-08-29 follow-up)
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists reconstruction_requests_proj_idx
  on reconstruction_requests (project_id, created_at desc);
create index if not exists reconstruction_requests_status_idx
  on reconstruction_requests (project_id, status);
alter table reconstruction_requests enable row level security;
drop policy if exists reconstruction_requests_read on reconstruction_requests;
create policy reconstruction_requests_read on reconstruction_requests
  for select using (can_access_project(project_id));
drop policy if exists reconstruction_requests_ins on reconstruction_requests;
create policy reconstruction_requests_ins on reconstruction_requests
  for insert with check (
    is_writer() and requested_by = auth.uid() and can_access_project(project_id)
    and status = 'pending_approval'
  );
drop policy if exists reconstruction_requests_upd on reconstruction_requests;
create policy reconstruction_requests_upd on reconstruction_requests
  for update using (is_admin() and can_access_project(project_id))
  with check (is_admin() and can_access_project(project_id));
-- 2026-09-04: a requester may also delete their own TERMINAL (done/failed)
-- request, not only a still-pending one — see migrations/2026-09-04-
-- reconstruction-delete-terminal.sql for why (no live RunPod job left to
-- orphan once a request is terminal).
drop policy if exists reconstruction_requests_del on reconstruction_requests;
create policy reconstruction_requests_del on reconstruction_requests
  for delete using (
    (is_admin() and can_access_project(project_id))
    or (requested_by = auth.uid() and status in ('pending_approval', 'done', 'failed'))
  );

-- Floor Plan overlay (brief Section 6B / Phase 5). See
-- migrations/2026-08-29-floor-plans.sql for the scope note (pin navigator,
-- not true BIM/IFC registration). Read-all-approved / write-writers-only,
-- like the generic module-table shape, but kept explicit here (not folded
-- into the generic RLS loop below) since it's two tables sharing one rule
-- rather than one table matching the loop's single-table assumption.
create table if not exists floor_plans (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id),
  name         text not null,
  level_order  integer default 0,
  image_url    text,
  width_px     integer,
  height_px    integer,
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_floor_plans_project on floor_plans(project_id);
alter table floor_plans enable row level security;
drop policy if exists floor_plans_read on floor_plans;
create policy floor_plans_read on floor_plans for select using (can_access_project(project_id));
drop policy if exists floor_plans_rw on floor_plans;
create policy floor_plans_rw on floor_plans for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

create table if not exists floor_plan_pins (
  id            uuid primary key default gen_random_uuid(),
  floor_plan_id uuid references floor_plans(id) on delete cascade,
  project_id    text references projects(id),
  item_type     text not null check (item_type in ('panorama', 'reconstruction', 'photo')),
  item_id       uuid not null,
  x_norm        double precision not null check (x_norm >= 0 and x_norm <= 1),
  y_norm        double precision not null check (y_norm >= 0 and y_norm <= 1),
  direction_deg double precision, -- camera facing, 0-360 clockwise from up (Batch E) — NULL = not recorded
  label         text,
  created_by    uuid references users(id),
  created_at    timestamptz default now()
);
create index if not exists idx_floor_plan_pins_plan on floor_plan_pins(floor_plan_id);
create index if not exists idx_floor_plan_pins_project on floor_plan_pins(project_id);

-- Top-view photo -> floor plan registration (Batch H). See
-- migrations/2026-08-29-floor-plan-registration.sql for the full rationale.
create table if not exists floor_plan_registrations (
  id             uuid primary key default gen_random_uuid(),
  floor_plan_id  uuid references floor_plans(id) on delete cascade,
  photo_id       uuid references progress_photos(id) on delete cascade,
  project_id     text references projects(id),
  point_pairs    jsonb not null default '[]'::jsonb,
  homography     jsonb,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (floor_plan_id, photo_id)
);
create index if not exists floor_plan_registrations_plan_idx on floor_plan_registrations (floor_plan_id);
alter table floor_plan_registrations enable row level security;
drop policy if exists floor_plan_registrations_read on floor_plan_registrations;
create policy floor_plan_registrations_read on floor_plan_registrations for select using (can_access_project(project_id));
drop policy if exists floor_plan_registrations_ins on floor_plan_registrations;
create policy floor_plan_registrations_ins on floor_plan_registrations for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists floor_plan_registrations_upd on floor_plan_registrations;
create policy floor_plan_registrations_upd on floor_plan_registrations for update
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
  with check (is_writer() and can_access_project(project_id));
drop policy if exists floor_plan_registrations_del on floor_plan_registrations;
create policy floor_plan_registrations_del on floor_plan_registrations for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));

-- Presentation-only markup overlay (Batch F, item 14). See
-- migrations/2026-08-29-markup.sql for the full rationale — separate from
-- progress_photos.markup (the photo's own permanent annotation) on purpose.
create table if not exists ppr_slide_markups (
  id            uuid primary key default gen_random_uuid(),
  ppr_slide_id  uuid references ppr_slides(id) on delete cascade,
  project_id    text references projects(id),
  pane          text not null check (pane in ('before', 'after')),
  markup        jsonb default '[]'::jsonb,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (ppr_slide_id, pane)
);
create index if not exists ppr_slide_markups_slide_idx on ppr_slide_markups (ppr_slide_id);
alter table ppr_slide_markups enable row level security;
drop policy if exists ppr_slide_markups_read on ppr_slide_markups;
create policy ppr_slide_markups_read on ppr_slide_markups for select using (can_access_project(project_id));
drop policy if exists ppr_slide_markups_ins on ppr_slide_markups;
create policy ppr_slide_markups_ins on ppr_slide_markups for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists ppr_slide_markups_upd on ppr_slide_markups;
create policy ppr_slide_markups_upd on ppr_slide_markups for update
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
  with check (is_writer() and can_access_project(project_id));
drop policy if exists ppr_slide_markups_del on ppr_slide_markups;
create policy ppr_slide_markups_del on ppr_slide_markups for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
alter table floor_plan_pins enable row level security;
drop policy if exists floor_plan_pins_read on floor_plan_pins;
create policy floor_plan_pins_read on floor_plan_pins for select using (can_access_project(project_id));
drop policy if exists floor_plan_pins_rw on floor_plan_pins;
create policy floor_plan_pins_rw on floor_plan_pins for all
  using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

create index if not exists ppr_slides_ppr_idx
  on ppr_slides (ppr_id, slide_no);

-- 2) Issues, Concerns & Lessons Learned --------------------------------------
create table if not exists issues_lessons (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id),
  type        text,                  -- Issue | Concern | Lesson Learned
  title       text,
  description text,                  -- the ISSUE text (Power Apps "Issue:")
  category    text,
  severity    text,                  -- Low | Medium | High | Critical
  status      text default 'Open',   -- Open | On Hold | Closed
  raised_by   text,
  date_raised date,
  resolution  text,
  date_closed date,
  -- Power Apps "Issues & Concerns" fields (2026-07-17-issues-lessons.sql):
  department        text,
  champion          text,
  caused_by         text,
  corrective_action text,
  date_presented    date,
  date_resolved     date,
  -- Lessons Learned (this module's addition) — captured on the issue itself:
  lesson_learned    text,
  lesson_category   text,
  recommendation    text,
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists issues_lessons_proj_date_idx
  on issues_lessons (project_id, date_presented desc);

-- 3) Contracts & Claims Register ---------------------------------------------
create table if not exists contracts_claims (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  record_type   text,                -- Contract | Claim | Change Order
  reference_no  text,
  title         text,
  counterparty  text,
  description    text,
  amount        numeric(18,2),
  status        text,
  date_filed    date,
  date_resolved date,
  remarks       text,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 4) Risk Register -----------------------------------------------------------
create table if not exists risk_register (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  risk_code     text,
  title         text,
  description   text,
  category      text,
  likelihood    int,                 -- 1..5
  impact        int,                 -- 1..5
  rating        int,                 -- likelihood * impact (app-computed)
  response      text,                -- Avoid | Mitigate | Transfer | Accept
  mitigation    text,
  owner         text,
  status        text default 'Open',
  review_date   date,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 5) Stakeholder Map ---------------------------------------------------------
create table if not exists stakeholder_map (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  name          text,
  organization  text,                -- Institution (agency / company)
  role_title    text,                -- Position (e.g. City Mayor)
  category      text,                -- Sector: Government | Private
  influence     text,                -- Impact rating 1-4 (capability to disrupt business)
  interest      text,                -- Interest rating 1-4
  contact       text,
  engagement    text,                -- free-text engagement notes (optional)
  -- corporate-BD methodology (2026-07-20-stakeholder-map-full.sql).
  -- DERIVED, never stored: Importance(1st-4th)+Approach from Impact×Interest;
  -- Engagement Strategy+Frequency from (target_rel - current_rel) gap.
  stakeholder_group   text,          -- LGU | NGA | GOCC | Partners | Consultants | ...
  title               text,          -- honorific / formal title
  nickname            text,
  birthday            date,
  email               text,
  current_rel         smallint,      -- Current Relationship 1-4
  target_rel          smallint,      -- Target Relationship 1-4
  primary_responsible text,
  alternate           text,
  gift_tier           text,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 6) Drawing Register --------------------------------------------------------
create table if not exists drawing_register (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  drawing_no     text,
  title          text,
  discipline     text,
  revision       text,
  status         text,               -- For Review | Revise & Resubmit | Approved w/ comments | Approved w/o comments | Approved | Superseded
  issue_date     date,
  due_date       date,
  file_url       text,
  remarks        text,
  -- Full-fidelity fields (2026-07-16-drawing-register-full.sql) --------------
  proj_code      text,               -- structured drawing-code parts (Coding Reference sheet)
  building_ref   text,               -- TW1..TW9 / GEN
  company        text,               -- MCC (Megawide) / subcontractor acronym
  drawing_type   text,               -- ECD/SD1/SD2/FCD/CSD/ISD/DRC
  floor_level    text,               -- GEN/FD/GF/2F.. / RDF / RORD
  dwg_number     text,               -- numeric sheet no (4750, A-101)
  drawing_code   text,               -- full composed code
  phase          text,               -- Concept Design / Schematic Design 1 / 2 / For Construction
  category       text,               -- Floor Plan / Elevation / Section
  description    text,
  responsible    text,               -- consultant / party (ECTA, RBS, In-House)
  no_of_sheets    integer default 1,
  approved_sheets integer default 0,
  approved_pct    numeric,           -- 0..1
  submissions    jsonb default '[]'::jsonb,  -- [{rev,planned,actual}]
  planned_approval date,
  actual_approval  date,
  sort_order      integer default 0,
  node_kind       text default 'drawing',   -- phase | discipline | category | drawing (tree skeleton)
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 7) Material Submittal Log --------------------------------------------------
create table if not exists material_submittal (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  submittal_no    text,
  material        text,
  specification   text,
  supplier        text,
  status          text,              -- Submitted | Under Review | Approved | Rejected
  date_submitted  date,
  date_required   date,
  date_approved   date,
  file_url        text,
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================================
-- MODULE TABLES (Phase 2) — starter columns only; developers extend as needed.
-- ============================================================================

-- Project Schedule, Cost Loading & S-Curve ----------------------------------
create table if not exists project_schedule (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  activity_id     text,
  activity_name   text,
  wbs             text,
  start_date      date,
  end_date        date,
  duration_days   numeric,
  percent_complete numeric,        -- 0..100
  predecessors    text,
  planned_cost    numeric(18,2),   -- cost loading
  actual_cost     numeric(18,2),
  earned_value    numeric(18,2),
  period          date,            -- for S-curve bucketing
  remarks         text,
  -- evolved schedule columns (see migrations 2026-06-30 / 2026-07-01)
  activity_type   text default 'Task',
  status          text default 'Not Started',
  responsible_party text,
  actual_start    date,
  actual_finish   date,
  bl_start        date,
  bl_finish       date,
  bl_cost         numeric(18,2),   -- baseline planned cost (migration 2026-07-02-baseline-cost-column.sql)
  -- OPC Activity Details fields (migration 2026-07-01-project-schedule-opc-fields.sql)
  owner                   text,
  work_package            text,
  calendar                text,
  duration_type           text default 'Fixed Duration & Units/Time',
  percent_complete_type   text default 'Duration',
  program_milestone       boolean default false,
  expected_finish         date,
  actual_duration         numeric,
  remaining_duration      numeric,
  free_float              numeric,
  planned_labor_units     numeric,
  actual_labor_units      numeric,
  remaining_labor_units   numeric,
  primary_constraint      text,
  primary_constraint_date date,
  secondary_constraint    text,
  secondary_constraint_date date,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Resource Loading -----------------------------------------------------------
create table if not exists resource_loading (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  resource_name   text,
  resource_type   text,            -- Labor | Equipment | Material
  unit            text,
  period          date,
  planned_qty     numeric,
  actual_qty      numeric,
  rate            numeric(18,2),
  cost            numeric(18,2),
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Productivity Rates ---------------------------------------------------------
create table if not exists productivity_rates (
  id                uuid primary key default gen_random_uuid(),
  project_id        text references projects(id),
  activity          text,
  unit              text,
  output_qty        numeric,
  manhours          numeric,
  productivity_rate numeric,       -- output per manhour (app-computed)
  crew              text,
  period            date,
  remarks           text,
  created_by        uuid references users(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
-- Productivity Monitoring (full module — supersedes the flat productivity_rates
-- starter above). One row per trade + monthly Planned/Actual/BL0 manpower &
-- output; rate/cumulative/variance are DERIVED in the app. See
-- migrations/2026-07-20-productivity-rates-full.sql.
create table if not exists productivity_activities (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  name           text not null,
  category       text,
  unit           text,
  resource_type  text default 'Manpower',
  resource_unit  text default 'pax',
  subcontractor  text,
  sort_order     numeric,
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create table if not exists productivity_entries (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  activity_id    uuid references productivity_activities(id) on delete cascade,
  period         date not null,
  work_days      numeric,
  mp_bl0 numeric, mp_planned numeric, mp_actual numeric,
  qty_bl0 numeric, qty_planned numeric, qty_actual numeric,
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists productivity_entries_uq  on productivity_entries(activity_id, period);
create index        if not exists productivity_entries_prj on productivity_entries(project_id, period);
create index        if not exists productivity_act_prj     on productivity_activities(project_id, sort_order);

-- Cash Flow ------------------------------------------------------------------
create table if not exists cash_flow (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  period          date,
  category        text,            -- Inflow | Outflow
  description     text,
  planned_amount  numeric(18,2),
  actual_amount   numeric(18,2),
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Cash Flow — projection settings (see migrations/2026-07-14-cash-flow-settings.sql).
-- The Cash Flow module is a DERIVED projection (cash-in from the schedule S-curve,
-- cash-out from the WPM procurement work packages); this row holds only the
-- contract/terms assumptions + the WPM project-id mapping. RLS/grants are set in
-- that migration (project-scoped, shared row — not created_by-gated).
create table if not exists cash_flow_settings (
  id                        uuid primary key default gen_random_uuid(),
  project_id                text references projects(id) on delete cascade unique,
  contract_ibb              numeric(18,2),
  contract_bcb              numeric(18,2),
  dp_percent                numeric(6,5) default 0,
  retention_percent         numeric(6,5) default 0.10,
  dp_recoup_percent         numeric(6,5),
  billing_terms_months      integer default 1,
  retention_release_months  integer default 1,
  start_period              date,
  wpm_project_id            text,
  remarks                   text,
  created_by                uuid references users(id),
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- Cash Flow — DP tranches (see migrations/2026-07-14-cash-flow-dp-tranches.sql).
-- Client downpayment broken into tranches, each tagged by trade/agreement, timed
-- by milestone / fixed month / offset, recouped proportionally. RLS in that migration.
create table if not exists cash_flow_dp_tranches (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id) on delete cascade,
  seq             integer default 0,
  label           text,
  category        text,
  basis           text default 'percent',
  percent         numeric(6,5),
  amount          numeric(18,2),
  timing_mode     text default 'offset',
  timing_month    date,
  timing_offset   integer default 0,
  milestone       text,
  recoup_percent  numeric(6,5),
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- S-Curve --------------------------------------------------------------------
create table if not exists s_curve (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text references projects(id),
  period             date,
  planned_value      numeric(18,2),   -- per-period planned
  actual_value       numeric(18,2),   -- per-period actual
  planned_cumulative numeric(18,2),
  actual_cumulative  numeric(18,2),
  percent_planned    numeric,         -- 0..100
  percent_actual     numeric,         -- 0..100
  remarks            text,
  created_by         uuid references users(id),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ============================================================================
-- TABLE PRIVILEGES (GRANTs) — required IN ADDITION to RLS.
-- PostgREST runs queries as the `authenticated`/`anon` role; without these
-- grants every request fails with "42501 permission denied", before RLS runs.
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- Baseline policy: any authenticated, approved user may read; insert/update/
-- delete allowed for the row's creator or admins. Tighten per module later.
-- ============================================================================

-- Helpers are SECURITY DEFINER so they read `users` bypassing RLS — this
-- prevents infinite recursion (54001) when policies (including users' own
-- policy) call them. `set search_path` keeps them safe; each only inspects the
-- current auth.uid()'s own attributes.

-- Helper: is the current user an approved admin?
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid()
      and u.status = 'approved'
      and u.role in ('admin','super_admin')
  );
$$;

create or replace function is_approved() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved');
$$;

-- Helper: may the current user WRITE? Approved and NOT a 'viewer' (viewer is
-- read-only per the roles model). Gates module-table insert/update/delete so a
-- viewer can read every accessible project but change nothing.
create or replace function is_writer() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved' and u.role <> 'viewer');
$$;

-- Helper: may the current user access this project? Admins: all. Others: only
-- projects listed in their users.projects array. This enforces the admin
-- "Assign projects" feature at the database level.
create or replace function can_access_project(pid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved'
      and (u.role in ('admin','super_admin') or pid = any(u.projects))
  );
$$;

-- Admin "delete user completely": removes auth.users (cascades to public.users),
-- freeing the email for future re-registration. Admin-only; no self-delete;
-- only a super_admin may delete a super_admin. Authorship is nulled (data kept).
create or replace function admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if target = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  if exists (select 1 from users where id = target and role = 'super_admin')
     and not exists (select 1 from users where id = auth.uid() and role = 'super_admin') then
    raise exception 'Only a super admin can delete a super admin';
  end if;
  for r in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'created_by' loop
    execute format('update public.%I set created_by = null where created_by = %L', r.table_name, target);
  end loop;
  delete from auth.users where id = target;
end $$;
grant execute on function admin_delete_user(uuid) to authenticated;

-- users + projects
alter table users    enable row level security;
alter table projects enable row level security;

drop policy if exists users_self_read on users;
create policy users_self_read on users for select using (auth.uid() = id or is_admin());
drop policy if exists users_self_insert on users;
create policy users_self_insert on users for insert with check (auth.uid() = id);
drop policy if exists users_admin_update on users;
create policy users_admin_update on users for update using (auth.uid() = id or is_admin());

drop policy if exists projects_read on projects;
create policy projects_read on projects for select using (is_admin() or can_access_project(id));
drop policy if exists projects_admin_write on projects;
create policy projects_admin_write on projects for all using (is_admin()) with check (is_admin());

-- ---- Module-table RLS (apply the same pattern to every module table) -------
-- Run this DO block; it loops over all Phase-1 module tables and creates the
-- standard read-all-approved / write-own-or-admin policies for each.
do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','ppr_presentations','ppr_slides','ppr_report_templates','panoramas',
    'issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal',
    'project_schedule','resource_loading','productivity_rates','cash_flow','s_curve',
    'productivity_activities','productivity_entries'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('create policy %I on %I for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id))', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('create policy %I on %I for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id))', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format('create policy %I on %I for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t||'_del', t);
  end loop;
end $$;

-- ============================================================================
-- BOOTSTRAP: after you self-register through the app, promote yourself.
-- Replace the email below, then run:
--   update users set role = 'super_admin', status = 'approved'
--   where email = 'fmlozano@megawide.com.ph';
-- ============================================================================

-- ============================================================================
-- Workspaces (Workspace → Program → Project hierarchy) + Project Selector
-- Added 2026-06-30. Mirrors Oracle Primavera Cloud structure. Idempotent.
-- (Standalone copy: migrations/2026-06-30-workspaces-project-selector.sql)
-- ============================================================================
create table if not exists workspaces (
  id text primary key, name text not null, code text,
  parent_id text references workspaces(id),
  node_type text default 'workspace' check (node_type in ('workspace','program','group')),
  group_head text, sort_order int default 0, created_at timestamptz default now()
);
alter table projects add column if not exists workspace_id    text references workspaces(id);
alter table projects add column if not exists group_head      text;
alter table projects add column if not exists description     text;
alter table projects add column if not exists project_manager text;
alter table projects add column if not exists forecast_start  date;
alter table projects add column if not exists forecast_finish date;
alter table projects add column if not exists original_budget numeric;
alter table projects add column if not exists estimated_cost  numeric;
create or replace function is_planner() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from users where id = auth.uid() and status = 'approved'
    and role in ('super_admin','admin','planner')); $fn$;
alter table workspaces enable row level security;
drop policy if exists workspaces_read on workspaces;
create policy workspaces_read on workspaces for select using (is_approved());
drop policy if exists workspaces_write on workspaces;
create policy workspaces_write on workspaces for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on workspaces to authenticated;
drop policy if exists projects_admin_write on projects;
-- Per-command, never `for all`: `for all` covers SELECT too, which would OR with
-- projects_read and let planners see unassigned projects. Insert stays unfiltered
-- because a new project isn't in anyone's users.projects array yet.
drop policy if exists projects_write on projects;
drop policy if exists projects_ins on projects;
drop policy if exists projects_upd on projects;
drop policy if exists projects_del on projects;
create policy projects_ins on projects for insert
  with check (is_planner());
create policy projects_upd on projects for update
  using (is_planner() and (is_admin() or can_access_project(id)))
  with check (is_planner() and (is_admin() or can_access_project(id)));
create policy projects_del on projects for delete
  using (is_planner() and (is_admin() or can_access_project(id)));
insert into workspaces (id, name, code, parent_id, node_type, group_head, sort_order) values
  ('CORP','Corporate Root','Corp',null,'workspace',null,0),
  ('NONPROD','Non Production','NonP','CORP','workspace',null,1),
  ('PROD','Production','Prod','CORP','workspace',null,2),
  ('EPC','Megawide EPC','EPC','PROD','workspace',null,0),
  ('HOLDCO','Megawide HoldCo','HoldCo','PROD','workspace',null,1),
  ('BIDS','Bids','Bids','EPC','workspace',null,0),
  ('OPS','Operations','Ops','EPC','workspace',null,1),
  ('PMO','PMO','PMO','EPC','program',null,2),
  ('CALIMAG','Calimag Group','CAL','OPS','group','Calimag Group',0),
  ('RODRIN','Rodrin Group','ROD','OPS','group','Rodrin Group',1),
  ('RONQUILLO','Ronquillo Group','RON','OPS','group','Ronquillo Group',2),
  ('TAN','Tan Group','TAN','OPS','group','Tan Group',3),
  ('FLORES','Flores Group','FLO','OPS','group','Flores Group',4)
on conflict (id) do nothing;
update projects set workspace_id='PMO' where id='DEMO01' and workspace_id is null;

-- ---- project-schedule: Contract Scope (main contract vs change order) -------
-- Idempotent, per MODULE_CONTRACT section 8. These were only ever shipped as
-- migrations/2026-08-19-schedule-contract-scope.sql, so a project rebuilt from
-- this file alone had no Contract Scope columns and every scope edit failed.
-- Full rationale (why a tag and not a WBS branch, why execution phase only,
-- why no back-fill) lives in that migration file.
alter table project_schedule add column if not exists scope_type       text;
alter table project_schedule add column if not exists change_order_ref text;
create index if not exists project_schedule_scope_type_idx on project_schedule (project_id, scope_type);

-- ---- project-schedule: split a main-contract activity around a change order --
-- Idempotent, per MODULE_CONTRACT section 8. Rationale (why two activities and
-- not one activity that knows it is split; why the finish extends) lives in
-- migrations/2026-08-21-schedule-split-change-orders.sql.
alter table project_schedule add column if not exists split_group text;
alter table project_schedule add column if not exists split_seq   int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_split_pair_chk') then
    alter table project_schedule add constraint project_schedule_split_pair_chk
      check ((split_group is null and split_seq is null)
          or (split_group is not null and split_seq is not null and split_seq >= 1));
  end if;
end $$;
create index if not exists project_schedule_split_group_idx
  on project_schedule (project_id, split_group, split_seq);

-- ==========================================================================
-- [001/142] 2026-06-18-admin-delete-user.sql
-- ==========================================================================
-- ============================================================================
-- Feature: admin "Delete user completely". Run in the Supabase SQL editor.
-- Idempotent.
--
-- Deletes the auth.users row (which cascades to public.users), freeing the
-- email so the person can Request Access again later. Authorship (created_by)
-- on their data rows is set to NULL first so foreign keys don't block deletion;
-- their data is kept. Guarded so only admins can call it, no self-delete, and
-- only a super_admin can delete a super_admin.
-- ============================================================================

create or replace function admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;
  if exists (select 1 from users where id = target and role = 'super_admin')
     and not exists (select 1 from users where id = auth.uid() and role = 'super_admin') then
    raise exception 'Only a super admin can delete a super admin';
  end if;

  -- Keep their data, drop their authorship link (avoids FK restrict on delete).
  for r in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'created_by'
  loop
    execute format('update public.%I set created_by = null where created_by = %L', r.table_name, target);
  end loop;

  -- Removing the auth user cascades to public.users (FK on delete cascade).
  delete from auth.users where id = target;
end $$;

grant execute on function admin_delete_user(uuid) to authenticated;


-- ==========================================================================
-- [002/142] 2026-06-18-grants.sql
-- ==========================================================================
-- ============================================================================
-- Migration: table privileges (GRANTs) for the API roles.
-- Run in the Supabase SQL editor. Idempotent.
--
-- WHY: PostgREST queries run as the `authenticated` (logged-in) or `anon`
-- (logged-out) Postgres role. Those roles need table-level GRANTs IN ADDITION
-- to passing RLS — they are two separate checks. Without these grants every
-- request fails with "42501 permission denied for table ...", even for admins.
--
-- Security note: GRANTs only open the door; ROW-LEVEL SECURITY (already set up
-- in supabase-schema.sql) still decides which rows each user actually sees.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Logged-in users: full DML on all app tables (RLS narrows it per user/project).
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Anonymous role needs no table access (login/registration go through Supabase
-- Auth; the profile insert on sign-up runs as `authenticated`). Leave anon with
-- no table grants.

-- Make sure tables added LATER by module developers are auto-granted too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;


-- ==========================================================================
-- [003/142] 2026-06-18-phase2-modules.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Phase 2 module tables (Project Schedule / Cost Loading & S-Curve,
-- Resource Loading, Productivity Rates, Cash Flow). Run in the Supabase SQL
-- editor. Idempotent. Assumes the helper functions can_access_project() /
-- is_admin() / is_approved() already exist (from the base schema + RLS migration).
-- ============================================================================

create table if not exists project_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  activity_id text, activity_name text, wbs text,
  start_date date, end_date date, duration_days numeric, percent_complete numeric,
  predecessors text, planned_cost numeric(18,2), actual_cost numeric(18,2),
  earned_value numeric(18,2), period date, remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists resource_loading (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  resource_name text, resource_type text, unit text, period date,
  planned_qty numeric, actual_qty numeric, rate numeric(18,2), cost numeric(18,2),
  remarks text, created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists productivity_rates (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  activity text, unit text, output_qty numeric, manhours numeric,
  productivity_rate numeric, crew text, period date, remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists cash_flow (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  period date, category text, description text,
  planned_amount numeric(18,2), actual_amount numeric(18,2), remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- Grants (authenticated role) — default privileges from the base schema cover
-- new tables, but grant explicitly to be safe.
grant select, insert, update, delete
  on project_schedule, resource_loading, productivity_rates, cash_flow
  to authenticated;

-- RLS: same per-project policy template as the Phase-1 module tables.
do $$
declare t text;
begin
  foreach t in array array['project_schedule','resource_loading','productivity_rates','cash_flow'] loop
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


-- ==========================================================================
-- [004/142] 2026-06-18-project-access-rls.sql
-- ==========================================================================
-- ============================================================================
-- Migration: per-project access control (database-enforced)
-- Run this in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Effect: admins & super_admins see ALL projects and module rows. Everyone else
-- (planner / user / viewer) can only read/write rows for projects listed in
-- their users.projects array. This turns the admin "Assign projects" feature
-- into a real security boundary, not just a UI convenience.
-- ============================================================================

-- Helper: may the current user access this project id?
create or replace function can_access_project(pid text)
returns boolean language sql stable as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid()
      and u.status = 'approved'
      and (u.role in ('admin','super_admin') or pid = any(u.projects))
  );
$$;

-- Projects: non-admins only see assigned projects (drives the project pickers).
drop policy if exists projects_read on projects;
create policy projects_read on projects for select
  using (is_admin() or can_access_project(id));

-- Module tables: read/write gated on project membership.
do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal'
  ] loop
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


-- ==========================================================================
-- [005/142] 2026-06-18-fix-rls-recursion.sql
-- ==========================================================================
-- ============================================================================
-- Bug fix: RLS infinite recursion ("stack depth limit exceeded", code 54001).
-- Run in the Supabase SQL editor. Idempotent.
--
-- Cause: RLS policies call is_admin()/is_approved()/can_access_project(), which
-- SELECT from `users`. The `users` table's own policy also calls is_admin(),
-- which re-queries `users` → the policy recurses until the stack overflows.
-- Empty tables didn't trip it (no rows to evaluate); tables WITH rows (projects,
-- risk_register, drawing_register — incl. the DEMO01 seed) did.
--
-- Fix: mark the helpers SECURITY DEFINER so they read `users` as the function
-- owner, bypassing RLS on `users` and breaking the recursion. `set search_path`
-- keeps them safe. They only inspect the current auth.uid()'s own attributes.
-- ============================================================================

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved' and u.role in ('admin','super_admin')
  );
$$;

create or replace function is_approved() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved');
$$;

create or replace function can_access_project(pid text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved'
      and (u.role in ('admin','super_admin') or pid = any(u.projects))
  );
$$;


-- ==========================================================================
-- [006/142] 2026-06-18-s-curve-module.sql
-- ==========================================================================
-- ============================================================================
-- Migration: split S-Curve into its own module → add `s_curve` table.
-- Run in the Supabase SQL editor. Idempotent. Assumes helper functions
-- (can_access_project / is_admin / is_approved) already exist.
-- ============================================================================

create table if not exists s_curve (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  period date,
  planned_value numeric(18,2),
  actual_value numeric(18,2),
  planned_cumulative numeric(18,2),
  actual_cumulative numeric(18,2),
  percent_planned numeric,
  percent_actual numeric,
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

grant select, insert, update, delete on s_curve to authenticated;

alter table s_curve enable row level security;
drop policy if exists s_curve_read on s_curve;
create policy s_curve_read on s_curve for select using (can_access_project(project_id));
drop policy if exists s_curve_ins on s_curve;
create policy s_curve_ins on s_curve for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists s_curve_upd on s_curve;
create policy s_curve_upd on s_curve for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
drop policy if exists s_curve_del on s_curve;
create policy s_curve_del on s_curve for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


-- ==========================================================================
-- [007/142] 2026-06-18-storage-buckets.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Storage buckets + policies for modules that upload files.
-- Run in the Supabase SQL editor. Idempotent.
--
-- One PRIVATE bucket per module key. Private = files are only reachable via a
-- short-lived signed URL (createSignedUrl), so drawings/photos aren't public.
-- Approved users may read/upload; admins may delete. Tighten later if needed.
-- ============================================================================

-- Create buckets (private) for the file-bearing Phase-1 modules.
insert into storage.buckets (id, name, public) values
  ('drawing-register',   'drawing-register',   false),
  ('progress-photos',    'progress-photos',    false),
  ('material-submittal', 'material-submittal', false)
on conflict (id) do nothing;

-- Policy template applied to each bucket.
do $$
declare b text;
begin
  foreach b in array array['drawing-register','progress-photos','material-submittal'] loop
    execute format('drop policy if exists %I on storage.objects', b||'_read');
    execute format('create policy %I on storage.objects for select using (bucket_id = %L and is_approved())', b||'_read', b);

    execute format('drop policy if exists %I on storage.objects', b||'_ins');
    execute format('create policy %I on storage.objects for insert with check (bucket_id = %L and is_approved())', b||'_ins', b);

    execute format('drop policy if exists %I on storage.objects', b||'_del');
    execute format('create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_admin()))', b||'_del', b);
  end loop;
end $$;


-- ==========================================================================
-- [008/142] 2026-06-30-add-flores-group.sql
-- ==========================================================================
-- ============================================================================
-- Migration: add "Flores Group" group head under Operations.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================
insert into workspaces (id, name, code, parent_id, node_type, group_head, sort_order) values
  ('FLORES', 'Flores Group', 'FLO', 'OPS', 'group', 'Flores Group', 4)
on conflict (id) do nothing;


-- ==========================================================================
-- [009/142] 2026-06-30-project-schedule-columns.sql
-- ==========================================================================
-- Migration: Project Schedule — extended columns
-- Run this in the Supabase SQL editor (or the consolidated setup SQL).
-- Safe to run multiple times (uses IF NOT EXISTS / ALTER ... ADD COLUMN IF NOT EXISTS).

-- Add fields missing from the initial project_schedule table:
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS actual_start       date;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS actual_finish      date;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS activity_type      text    DEFAULT 'Task';
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS status             text    DEFAULT 'Not Started';
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS responsible_party  text;

-- Refresh updated_at trigger if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_project_schedule'
  ) THEN
    CREATE TRIGGER set_updated_at_project_schedule
      BEFORE UPDATE ON project_schedule
      FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
  END IF;
EXCEPTION WHEN others THEN NULL;
END;
$$;


-- ==========================================================================
-- [010/142] 2026-06-30-schedule-baseline-columns.sql
-- ==========================================================================
-- ============================================================================
-- Migration: baseline (BL0) columns for the Project Schedule Gantt.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================
alter table project_schedule add column if not exists bl_start  date;
alter table project_schedule add column if not exists bl_finish date;

-- Optional: seed BL0 from the current plan where not set, so existing rows
-- immediately show a baseline bar (comment out if you prefer blank baselines).
update project_schedule
   set bl_start  = coalesce(bl_start,  start_date),
       bl_finish = coalesce(bl_finish, end_date)
 where bl_start is null or bl_finish is null;


-- ==========================================================================
-- [011/142] 2026-06-30-schedule-predecessors-and-rollup.sql
-- ==========================================================================
-- ============================================================================
-- Migration: predecessors column (dependencies / critical path) + per-project
-- schedule rollup columns surfaced in the Portfolio / Program / Workspace views.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

-- Dependencies: comma-separated predecessor Activity IDs on each activity.
alter table project_schedule add column if not exists predecessors text;

-- Portfolio rollup summary stored on the project (written by the schedule module
-- whenever a schedule is loaded/imported/edited, so the Portfolio can read it cheaply
-- without re-scanning thousands of activity rows).
alter table projects add column if not exists schedule_progress   numeric;   -- overall % complete (0-100)
alter table projects add column if not exists schedule_start      date;
alter table projects add column if not exists schedule_finish     date;
alter table projects add column if not exists schedule_activities integer;
alter table projects add column if not exists schedule_updated_at  timestamptz;


-- ==========================================================================
-- [012/142] 2026-06-30-workspaces-project-selector.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Workspaces (Workspace → Program → Project hierarchy) + Project
--            Selector support columns + Group Head assignment basis.
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Mirrors the Oracle Primavera Cloud structure:
--   Workspace tree (Corporate Root → … → Group) owns Projects.
--   The "Group" nodes (Calimag/Rodrin/Ronquillo/Tan) are the Group Heads —
--   the basis for assignments per project.
-- ============================================================================

-- ---- 1) Workspaces: self-referencing tree ---------------------------------
create table if not exists workspaces (
  id          text primary key,                  -- short code, e.g. 'PMO', 'CALIMAG'
  name        text not null,                      -- display name
  code        text,                               -- short prefix shown in list grouping (e.g. 'EPC')
  parent_id   text references workspaces(id),     -- null = root
  node_type   text default 'workspace'
                check (node_type in ('workspace','program','group')),
  group_head  text,                               -- group head name (assignment basis)
  sort_order  int  default 0,
  created_at  timestamptz default now()
);

-- ---- 2) Extend projects ----------------------------------------------------
alter table projects add column if not exists workspace_id    text references workspaces(id);
alter table projects add column if not exists group_head      text;
alter table projects add column if not exists description     text;
alter table projects add column if not exists project_manager text;
alter table projects add column if not exists forecast_start  date;
alter table projects add column if not exists forecast_finish date;
alter table projects add column if not exists original_budget numeric;
alter table projects add column if not exists estimated_cost  numeric;

-- ---- 3) Helper: is the current user a planner (auto-approve writer)? -------
-- SECURITY DEFINER + fixed search_path so it bypasses users-table RLS (avoids
-- the recursion class of bug fixed in 2026-06-18-fix-rls-recursion.sql).
create or replace function is_planner() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users
    where id = auth.uid() and status = 'approved'
      and role in ('super_admin','admin','planner')
  );
$$;

-- ---- 4) RLS + grants for workspaces ---------------------------------------
alter table workspaces enable row level security;

-- Everyone approved can read the tree (it is org structure, not project data).
drop policy if exists workspaces_read on workspaces;
create policy workspaces_read on workspaces for select using (is_approved());

-- Admins + planners can create / edit / delete workspace nodes.
drop policy if exists workspaces_write on workspaces;
create policy workspaces_write on workspaces for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on workspaces to authenticated;

-- ---- 5) Let planners (not just admins) manage projects --------------------
drop policy if exists projects_admin_write on projects;
drop policy if exists projects_write on projects;
create policy projects_write on projects for all
  using (is_planner()) with check (is_planner());

-- ---- 6) Seed the Megawide workspace tree (idempotent) ----------------------
insert into workspaces (id, name, code, parent_id, node_type, group_head, sort_order) values
  ('CORP',     'Corporate Root',  'Corp',  null,   'workspace', null, 0),
  ('NONPROD',  'Non Production',  'NonP',  'CORP', 'workspace', null, 1),
  ('PROD',     'Production',      'Prod',  'CORP', 'workspace', null, 2),
  ('EPC',      'Megawide EPC',    'EPC',   'PROD', 'workspace', null, 0),
  ('HOLDCO',   'Megawide HoldCo', 'HoldCo','PROD', 'workspace', null, 1),
  ('BIDS',     'Bids',            'Bids',  'EPC',  'workspace', null, 0),
  ('OPS',      'Operations',      'Ops',   'EPC',  'workspace', null, 1),
  ('PMO',      'PMO',             'PMO',   'EPC',  'program',   null, 2),
  ('CALIMAG',  'Calimag Group',   'CAL',   'OPS',  'group', 'Calimag Group',   0),
  ('RODRIN',   'Rodrin Group',    'ROD',   'OPS',  'group', 'Rodrin Group',    1),
  ('RONQUILLO','Ronquillo Group', 'RON',   'OPS',  'group', 'Ronquillo Group', 2),
  ('TAN',      'Tan Group',       'TAN',   'OPS',  'group', 'Tan Group',       3),
  ('FLORES',   'Flores Group',    'FLO',   'OPS',  'group', 'Flores Group',    4)
on conflict (id) do nothing;

-- ---- 7) Place the existing demo project under PMO (if present) -------------
update projects set workspace_id = 'PMO'
  where id = 'DEMO01' and workspace_id is null;

-- ---- 8) Optional sample projects (only inserted if absent) -----------------
-- Gives the selector a populated look across multiple workspace nodes.
insert into projects (id, name, location, status, workspace_id, group_head, description) values
  ('CP104',  'EPC. CP104 Project (Engineering)',           'Metro Manila', 'active', 'PMO',     null,           'Engineering package'),
  ('MCSP',   'EPC. PMO. 2025 Megawide Construction Strategic Plan','HO',   'active', 'PMO',     null,           'Strategic plan'),
  ('WCB363', 'Westside City Site B (Main Contract)',       'Entertainment City','active','CALIMAG','Calimag Group','Main Contract, MEPF, Change Orders'),
  ('HOR102', 'HO Renovation',                              'HO',           'active', 'RODRIN',  'Rodrin Group', 'Head office renovation')
on conflict (id) do nothing;

-- Done. Project Selector + Workspace hierarchy are ready.


-- ==========================================================================
-- [013/142] 2026-07-01-project-schedule-opc-fields.sql
-- ==========================================================================
-- ============================================================================
-- Migration: add remaining Oracle Primavera Cloud (OPC) Activity Details fields
-- to project_schedule. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table project_schedule
  -- General
  add column if not exists owner text,
  add column if not exists work_package text,
  add column if not exists calendar text,
  add column if not exists duration_type text default 'Fixed Duration & Units/Time',
  add column if not exists percent_complete_type text default 'Duration',
  add column if not exists program_milestone boolean default false,
  -- Status: dates / duration
  add column if not exists expected_finish date,
  add column if not exists actual_duration numeric,
  add column if not exists remaining_duration numeric,
  add column if not exists free_float numeric,
  -- Status: labor units
  add column if not exists planned_labor_units numeric,
  add column if not exists actual_labor_units numeric,
  add column if not exists remaining_labor_units numeric,
  -- Status: constraints
  add column if not exists primary_constraint text,
  add column if not exists primary_constraint_date date,
  add column if not exists secondary_constraint text,
  add column if not exists secondary_constraint_date date;


-- ==========================================================================
-- [014/142] 2026-07-01-resource-role-master.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Resource & Role master (OPC-faithful) for the resource-loading
-- module. Run in the Supabase SQL editor. Idempotent.
--
-- Mirrors Oracle Primavera Cloud's Resources/Roles: a role roster (Primary
-- Role) and a resource roster with ID, Type, Default & Max Units/Time (the
-- availability line), UoM and Calendar. Time-phased assignment usage (feeding
-- Project Schedule's Resource/Role Usage tabs) comes in a later phase.
-- ============================================================================

create table if not exists resource_roles (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text,                       -- Primary Role, e.g. "Planning Engineer"
  discipline text,                 -- e.g. Labor | Engineering | Field
  uom text default 'hours',        -- unit of measure
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  resource_code text,              -- OPC "ID", e.g. R150082
  name text,
  type text default 'Labor',       -- Labor | Nonlabor | Material
  primary_role text,               -- links (by name) to resource_roles.name
  default_units_per_time numeric default 100,  -- % (OPC Default Units/Time)
  max_units_per_time numeric default 100,      -- % availability (Max Units/Time)
  uom text default 'hours',
  calendar text,                   -- e.g. "MCC Project Calendar 2020-2049 5-2-1"
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

grant select, insert, update, delete on resource_roles, resources to authenticated;

do $$
declare t text;
begin
  foreach t in array array['resource_roles','resources'] loop
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


-- ==========================================================================
-- [015/142] 2026-07-02-baseline-cost-column.sql
-- ==========================================================================
-- ============================================================================
-- Migration: baseline planned cost (matches OPC's "BL Planned IBB" column).
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================
alter table project_schedule add column if not exists bl_cost numeric(18,2);

-- Optional: seed BL0 cost from the current Planned Cost where not set, mirroring
-- how bl_start/bl_finish were seeded from the current plan dates (see
-- 2026-06-30-schedule-baseline-columns.sql). Comment out if you prefer blank baselines.
update project_schedule
   set bl_cost = planned_cost
 where bl_cost is null;


-- ==========================================================================
-- [016/142] 2026-07-03-resource-assignments.sql
-- ==========================================================================
-- ============================================================================
-- Migration: resource_assignments — links activities to resources/roles with
-- budgeted/actual units (OPC Resource Assignments). Feeds Project Schedule's
-- Resource Usage / Role Usage (time-phased across the activity's dates).
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists resource_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  activity_id text,                -- matches project_schedule.activity_id (by code)
  resource_id uuid references resources(id),
  resource_code text,              -- denormalized (roster convenience)
  role text,                       -- role name (for role-usage rollups)
  budgeted_units numeric,          -- planned units (e.g. person-days / hours)
  actual_units numeric,
  remaining_units numeric,
  uom text default 'hours',
  remarks text,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

grant select, insert, update, delete on resource_assignments to authenticated;

alter table resource_assignments enable row level security;
drop policy if exists resource_assignments_read on resource_assignments;
create policy resource_assignments_read on resource_assignments for select using (can_access_project(project_id));
drop policy if exists resource_assignments_ins on resource_assignments;
create policy resource_assignments_ins on resource_assignments for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists resource_assignments_upd on resource_assignments;
create policy resource_assignments_upd on resource_assignments for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
drop policy if exists resource_assignments_del on resource_assignments;
create policy resource_assignments_del on resource_assignments for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


-- ==========================================================================
-- [017/142] 2026-07-06-working-calendars.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Working calendars for the resource-loading + project-schedule
-- modules. Run in the Supabase SQL editor. Idempotent.
--
-- Adds a `calendars` master (project-scoped, same pattern as resources/roles):
-- a working-day pattern (which weekdays are worked + hours/day) plus an
-- editable list of extra (movable/proclaimed) holiday dates. The Philippine
-- *regular* holidays with fixed or Easter-derived dates are computed in JS
-- (assets/js/calendar.js) rather than stored — only Eid'l Fitr/Eid'l Adha and
-- any ad-hoc proclamation-moved dates need to be added here by hand, since
-- those are announced yearly by the Philippine government and can't be
-- computed offline.
--
-- `resources.calendar_id` / `project_schedule.calendar_id` replace the old
-- free-text `calendar` column as the source of truth going forward; the text
-- column is kept for legacy display fallback (rows saved before this
-- migration) but is no longer written by the app.
-- ============================================================================

create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text not null,
  hours_per_day numeric default 8,
  work_mon boolean default true,
  work_tue boolean default true,
  work_wed boolean default true,
  work_thu boolean default true,
  work_fri boolean default true,
  work_sat boolean default true,
  work_sun boolean default false,
  extra_holidays date[] default '{}',   -- movable/proclaimed holidays (Eid'l Fitr, Eid'l Adha, proclamation-moved dates, etc.)
  is_default boolean default false,
  created_by uuid references users(id),
  created_at timestamptz default now(), updated_at timestamptz default now()
);

alter table resources add column if not exists calendar_id uuid references calendars(id) on delete set null;
alter table project_schedule add column if not exists calendar_id uuid references calendars(id) on delete set null;

grant select, insert, update, delete on calendars to authenticated;

do $$
begin
  alter table calendars enable row level security;
  drop policy if exists calendars_read on calendars;
  create policy calendars_read on calendars for select using (can_access_project(project_id));
  drop policy if exists calendars_ins on calendars;
  create policy calendars_ins on calendars for insert with check (is_approved() and created_by = auth.uid() and can_access_project(project_id));
  drop policy if exists calendars_upd on calendars;
  create policy calendars_upd on calendars for update using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
  drop policy if exists calendars_del on calendars;
  create policy calendars_del on calendars for delete using (can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
end $$;


-- ==========================================================================
-- [018/142] 2026-07-07-activity-codes.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Activity Codes (OPC-style project-defined code dictionaries, e.g.
-- Phase / Area / Zone) for grouping and filtering the schedule orthogonally to
-- the WBS. Each project defines its own code TYPES; each type has a list of
-- VALUES; each activity is assigned at most one value per type, stored as a
-- compact jsonb map on project_schedule ({ "<code_type_id>": "<code_value_id>" })
-- rather than a join table, matching the schedule_baselines jsonb-snapshot
-- convention already used in this module.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists activity_code_types (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists activity_code_values (
  id uuid primary key default gen_random_uuid(),
  code_type_id uuid references activity_code_types(id) on delete cascade,
  project_id text not null,
  value text not null,
  color text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists activity_code_types_project_idx on activity_code_types(project_id);
create index if not exists activity_code_values_type_idx on activity_code_values(code_type_id);

alter table project_schedule add column if not exists activity_codes jsonb default '{}'::jsonb;

alter table activity_code_types enable row level security;
drop policy if exists activity_code_types_read on activity_code_types;
create policy activity_code_types_read on activity_code_types for select using (is_approved());
drop policy if exists activity_code_types_write on activity_code_types;
create policy activity_code_types_write on activity_code_types for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_code_types to authenticated;

alter table activity_code_values enable row level security;
drop policy if exists activity_code_values_read on activity_code_values;
create policy activity_code_values_read on activity_code_values for select using (is_approved());
drop policy if exists activity_code_values_write on activity_code_values;
create policy activity_code_values_write on activity_code_values for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_code_values to authenticated;


-- ==========================================================================
-- [019/142] 2026-07-07-activity-steps.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Weighted Steps (OPC-style per-activity checklist) that rolls up
-- into a weighted "physical % complete", which is written back onto
-- project_schedule.percent_complete so every existing consumer (CPM, EVM,
-- Cost Loading, forecasts, the Planner Cockpit, Monte Carlo actuals) benefits
-- automatically with no further changes. Keyed by activity_id (the human
-- code), matching the resource_assignments convention already used here.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists activity_steps (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  activity_id text,                 -- matches project_schedule.activity_id (by code)
  name text not null,
  weight numeric(10,2) default 1,
  percent_complete numeric(5,2) default 0,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists activity_steps_project_activity_idx on activity_steps(project_id, activity_id);

alter table activity_steps enable row level security;
drop policy if exists activity_steps_read on activity_steps;
create policy activity_steps_read on activity_steps for select using (is_approved());
drop policy if exists activity_steps_write on activity_steps;
create policy activity_steps_write on activity_steps for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_steps to authenticated;


-- ==========================================================================
-- [020/142] 2026-07-07-assignment-curve.sql
-- ==========================================================================
-- ============================================================================
-- Migration: resource/cost distribution curve per assignment (P6 "Resource
-- Curves"). Controls how an assignment's units/cost are time-phased across its
-- activity's dates in the Resource Usage histogram/spreadsheet, instead of the
-- default uniform (linear) spread: linear | front | back | bell.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table resource_assignments add column if not exists curve text default 'linear';

comment on column resource_assignments.curve is
  'Distribution curve for time-phasing this assignment: linear (uniform), front '
  '(front-loaded), back (back-loaded), or bell (peak mid-activity).';


-- ==========================================================================
-- [021/142] 2026-07-07-risk-3point-duration.sql
-- ==========================================================================
-- ============================================================================
-- Migration: per-activity 3-point duration override for the Monte Carlo schedule
-- risk simulation (Actions ▾ → Schedule risk). When set, an activity's own
-- Optimistic %/Pessimistic % of plan is used instead of the simulation-wide
-- default (which otherwise applies the same relative spread to every activity).
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

alter table project_schedule add column if not exists risk_optimistic_pct numeric(6,2);
alter table project_schedule add column if not exists risk_pessimistic_pct numeric(6,2);

comment on column project_schedule.risk_optimistic_pct is
  'Per-activity Monte Carlo override: optimistic duration as a % of plan (e.g. 85 = 85%). '
  'Null = use the simulation-wide Optimistic % entered in the Schedule Risk dialog.';
comment on column project_schedule.risk_pessimistic_pct is
  'Per-activity Monte Carlo override: pessimistic duration as a % of plan (e.g. 150 = 150%). '
  'Null = use the simulation-wide Pessimistic % entered in the Schedule Risk dialog.';


-- ==========================================================================
-- [022/142] 2026-07-07-schedule-audit.sql
-- ==========================================================================
-- ============================================================================
-- Migration: schedule change audit trail. One row per change event (who changed
-- which activity, which fields from→to, and when). Insert-only for planners;
-- approved users can read. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_audit (
  id            uuid primary key default gen_random_uuid(),
  project_id    text,
  activity_pk   uuid,          -- project_schedule.id (may be null for bulk events)
  activity_id   text,          -- human Activity ID
  activity_name text,
  action        text,          -- 'update' | 'insert' | 'delete' | 'reschedule'
  changes       jsonb,         -- { field: { from, to } }  (or { count } for bulk)
  changed_by    uuid,
  changed_at    timestamptz default now()
);

create index if not exists schedule_audit_project_idx on schedule_audit (project_id, changed_at desc);

alter table schedule_audit enable row level security;

drop policy if exists schedule_audit_read on schedule_audit;
create policy schedule_audit_read on schedule_audit for select using (is_approved());

-- Insert-only (audit rows are immutable) — planners/admins write.
drop policy if exists schedule_audit_write on schedule_audit;
create policy schedule_audit_write on schedule_audit for insert with check (is_planner());

grant select, insert on schedule_audit to authenticated;


-- ==========================================================================
-- [023/142] 2026-07-07-schedule-baselines.sql
-- ==========================================================================
-- ============================================================================
-- Migration: multiple named schedule baselines (OPC-style). Each baseline is one
-- row holding a compact per-activity snapshot as jsonb ({ "<activity_id>":
-- [start, finish, duration_days, planned_cost] }). One baseline can be flagged
-- primary; setting it primary also writes bl_start/bl_finish/bl_cost back onto
-- project_schedule so the existing Gantt baseline bar + variance keep working.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_baselines (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  name           text,
  taken_at       timestamptz default now(),
  created_by     uuid,
  is_primary     boolean default false,
  activity_count int,
  activities     jsonb default '{}'::jsonb
);

create index if not exists schedule_baselines_project_idx on schedule_baselines (project_id, taken_at desc);

alter table schedule_baselines enable row level security;

drop policy if exists schedule_baselines_read on schedule_baselines;
create policy schedule_baselines_read on schedule_baselines for select using (is_approved());

drop policy if exists schedule_baselines_write on schedule_baselines;
create policy schedule_baselines_write on schedule_baselines for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on schedule_baselines to authenticated;


-- ==========================================================================
-- [024/142] 2026-07-07-schedule-contract-date.sql
-- ==========================================================================
-- ============================================================================
-- Migration: per-activity Contract Date (obligation/LD date) on project_schedule.
-- Lets the Planner Cockpit flag activities/milestones whose forecast finish is
-- LATER than the contractual date (liquidated-damages exposure).
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

alter table project_schedule add column if not exists contract_date date;

comment on column project_schedule.contract_date is
  'Contractual / obligation finish date for this activity or milestone. When the '
  'forecast finish (actual_finish || end_date) is later, the cockpit flags LD exposure.';


-- ==========================================================================
-- [025/142] 2026-07-07-schedule-scenarios.sql
-- ==========================================================================
-- ============================================================================
-- Migration: What-if scenarios (P6/OPC "Reflections") — a named, restorable
-- checkpoint of the whole schedule. Capture the current schedule as a scenario,
-- experiment freely on the live schedule, compare live-vs-scenario deltas, then
-- keep the experiment or RESTORE the scenario (roll it back). One row per
-- scenario, activities stored as a compact jsonb snapshot keyed by activity_id
-- (matching the schedule_baselines convention).
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_scenarios (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null,
  name           text,
  taken_at       timestamptz default now(),
  created_by     uuid,
  activity_count int,
  -- summary captured at snapshot time (for a cheap compare without rehydrating jsonb):
  project_finish date,
  critical_count int,
  total_cost     numeric,
  -- per-activity snapshot: { "<activity_id>": [start, finish, duration_days, percent_complete,
  --                          predecessors, planned_cost, bl_start, bl_finish] }
  activities     jsonb default '{}'::jsonb
);

create index if not exists schedule_scenarios_project_idx on schedule_scenarios (project_id, taken_at desc);

alter table schedule_scenarios enable row level security;
drop policy if exists schedule_scenarios_read on schedule_scenarios;
create policy schedule_scenarios_read on schedule_scenarios for select using (is_approved());
drop policy if exists schedule_scenarios_write on schedule_scenarios;
create policy schedule_scenarios_write on schedule_scenarios for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on schedule_scenarios to authenticated;


-- ==========================================================================
-- [026/142] 2026-07-07-schedule-snapshots.sql
-- ==========================================================================
-- ============================================================================
-- Migration: schedule snapshots — "where we said we'd be". One row per snapshot
-- holding a project SUMMARY plus every MILESTONE's forecast/baseline/contract
-- date (as jsonb), so planners can chart milestone drift over time without
-- storing all activities. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null,
  label              text,
  data_date          date,
  taken_at           timestamptz default now(),
  created_by         uuid,
  -- summary
  pct_complete       numeric,
  activities_total   int,
  activities_behind  int,
  milestones_total   int,
  milestones_at_risk int,
  project_finish     date,
  -- [{ id, name, forecast, baseline, contract }] per milestone
  milestones         jsonb default '[]'::jsonb
);

create index if not exists schedule_snapshots_project_idx on schedule_snapshots (project_id, taken_at desc);

-- RLS: approved users read; planners/admins write (mirrors workspaces/projects policies,
-- reusing the is_approved()/is_planner() helpers from the workspaces migration).
alter table schedule_snapshots enable row level security;

drop policy if exists schedule_snapshots_read on schedule_snapshots;
create policy schedule_snapshots_read on schedule_snapshots for select using (is_approved());

drop policy if exists schedule_snapshots_write on schedule_snapshots;
create policy schedule_snapshots_write on schedule_snapshots for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on schedule_snapshots to authenticated;


-- ==========================================================================
-- [027/142] 2026-07-07-schedule-thresholds.sql
-- ==========================================================================
-- ============================================================================
-- Migration: schedule threshold monitors (P6 "Thresholds") — rules that watch a
-- schedule parameter (total float, finish variance, LD/contract exposure,
-- overdue days) and generate Issues (into issues_lessons) when an activity
-- breaches them. Definitions live here; generated issues live in the existing
-- issues_lessons table (type='Issue', category='Schedule Threshold').
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_thresholds (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text,
  metric text not null,          -- float_below | finish_var_above | contract_var_above | overdue_days
  value numeric not null,
  severity text default 'Medium', -- Low | Medium | High
  enabled boolean default true,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists schedule_thresholds_project_idx on schedule_thresholds(project_id);

alter table schedule_thresholds enable row level security;
drop policy if exists schedule_thresholds_read on schedule_thresholds;
create policy schedule_thresholds_read on schedule_thresholds for select using (is_approved());
drop policy if exists schedule_thresholds_write on schedule_thresholds;
create policy schedule_thresholds_write on schedule_thresholds for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on schedule_thresholds to authenticated;


-- ==========================================================================
-- [028/142] 2026-07-07-user-defined-fields.sql
-- ==========================================================================
-- ============================================================================
-- Migration: User-Defined Fields (UDFs, P6/OPC "User Defined Fields") — project-
-- defined typed custom fields (Text / Number / Date / Cost) attached to
-- activities. Definitions live in activity_udf_defs; each activity's values are
-- a compact jsonb map on project_schedule ({ "<def_id>": value }), matching the
-- activity_codes convention.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists activity_udf_defs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  field_type text default 'text' check (field_type in ('text','number','date','cost')),
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists activity_udf_defs_project_idx on activity_udf_defs(project_id);

alter table project_schedule add column if not exists udf jsonb default '{}'::jsonb;

alter table activity_udf_defs enable row level security;
drop policy if exists activity_udf_defs_read on activity_udf_defs;
create policy activity_udf_defs_read on activity_udf_defs for select using (is_approved());
drop policy if exists activity_udf_defs_write on activity_udf_defs;
create policy activity_udf_defs_write on activity_udf_defs for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_udf_defs to authenticated;


-- ==========================================================================
-- [029/142] 2026-07-07-wbs-nodes.sql
-- ==========================================================================
-- ============================================================================
-- Migration: first-class Work Breakdown Structure (P6 PROJWBS). The WBS tree is
-- authored in wbs_nodes (unlimited depth via parent_id); each node's dotted code
-- is auto-numbered from tree position but can be overridden (code_custom).
--
-- Integration: wbs_nodes is the source of truth for the TREE. On every tree edit
-- the app PROJECTS the nodes into the existing project_schedule WBS-Summary rows
-- (one row per node, linked by wbs_node_id, carrying the node's code + name), so
-- the whole existing grid / roll-up / CPM / importer pipeline — which keys off the
-- dotted project_schedule.wbs code — keeps working unchanged. Activities link to
-- their node via project_schedule.wbs_node_id and carry the denormalized code in
-- project_schedule.wbs.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references wbs_nodes(id) on delete cascade,
  code text,                         -- dotted code (auto from position, or custom)
  code_custom boolean default false, -- true = user overrode the code; auto-numbering keeps it
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists wbs_nodes_project_idx on wbs_nodes(project_id);
create index if not exists wbs_nodes_parent_idx on wbs_nodes(parent_id);

-- Link an activity (or a projected WBS-Summary row) to its WBS node.
alter table project_schedule add column if not exists wbs_node_id uuid;
create index if not exists project_schedule_wbs_node_idx on project_schedule(wbs_node_id);

alter table wbs_nodes enable row level security;
drop policy if exists wbs_nodes_read on wbs_nodes;
create policy wbs_nodes_read on wbs_nodes for select using (is_approved());
drop policy if exists wbs_nodes_write on wbs_nodes;
create policy wbs_nodes_write on wbs_nodes for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on wbs_nodes to authenticated;


-- ==========================================================================
-- [030/142] 2026-07-07-weekly-commitments.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Last Planner System weekly work plan + Percent Plan Complete (PPC).
-- Each row is one weekly commitment (a specific piece of work promised for a
-- given week), optionally linked to a project_schedule activity. At week's
-- end each commitment is marked Complete or Not Complete (with a reason code
-- if not) — PPC = Complete ÷ (Complete + Not Complete) for the week.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists weekly_commitments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  week_start date not null,          -- Monday of the committed week
  activity_id text,                  -- optional link to project_schedule.activity_id
  description text not null,
  responsible text,
  status text default 'Open',        -- Open | Complete | Not Complete
  reason_code text,                  -- set when status = 'Not Complete'
  reason_notes text,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create index if not exists weekly_commitments_project_week_idx on weekly_commitments(project_id, week_start);

alter table weekly_commitments enable row level security;
drop policy if exists weekly_commitments_read on weekly_commitments;
create policy weekly_commitments_read on weekly_commitments for select using (is_approved());
drop policy if exists weekly_commitments_write on weekly_commitments;
create policy weekly_commitments_write on weekly_commitments for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on weekly_commitments to authenticated;


-- ==========================================================================
-- [031/142] 2026-07-11-activity-seq-order.sql
-- ==========================================================================
-- ============================================================================
-- Migration: manual activity sequence for drag-and-drop row reorder (2026-07-11)
-- Adds project_schedule.seq_order — a per-activity manual sequence used to order
-- leaf siblings WITHIN their WBS parent (when no column sort is active). Null =
-- unset (falls back to Activity-ID order, i.e. today's behaviour). The grid drag-
-- and-drop renumbers a WBS's siblings 0,1,2,… on drop. Run in the Supabase SQL
-- editor. Idempotent.
-- ============================================================================

alter table project_schedule add column if not exists seq_order numeric;


-- ==========================================================================
-- [032/142] 2026-07-11-portfolio-resource-rpc.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Portfolio resource demand — server-side aggregation RPC (2026-07-11)
-- resource_assignments can be 27k+ rows for a SINGLE project, so a portfolio-scale
-- client fetch is unsafe. This RPC aggregates on the server (GROUP BY) and returns
-- one compact row per resource identity across the requested projects.
-- security invoker → the caller's RLS applies (resource_assignments read = is_approved),
-- matching the portfolio's RLS-scoped model. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create or replace function portfolio_resource_summary(p_ids text[])
returns table (
  resource_name  text,
  resource_type  text,
  uom            text,
  projects       bigint,
  assignments    bigint,
  budgeted_units numeric,
  actual_units   numeric,
  remaining_units numeric,
  budgeted_cost  numeric,
  actual_cost    numeric
)
language sql
stable
security invoker
as $$
  select
    coalesce(r.name, ra.resource_code, ra.role, 'Unassigned')     as resource_name,
    coalesce(r.type, 'Labor')                                     as resource_type,
    coalesce(ra.uom, 'hours')                                     as uom,
    count(distinct ra.project_id)                                 as projects,
    count(*)                                                      as assignments,
    coalesce(sum(ra.budgeted_units), 0)                           as budgeted_units,
    coalesce(sum(ra.actual_units), 0)                             as actual_units,
    coalesce(sum(ra.remaining_units), 0)                          as remaining_units,
    coalesce(sum(ra.budgeted_cost), 0)                            as budgeted_cost,
    coalesce(sum(ra.actual_cost), 0)                              as actual_cost
  from resource_assignments ra
  left join resources r on r.id = ra.resource_id
  where ra.project_id = any(p_ids)
  group by 1, 2, 3
  order by budgeted_cost desc nulls last, budgeted_units desc nulls last;
$$;

grant execute on function portfolio_resource_summary(text[]) to authenticated;


-- ==========================================================================
-- [033/142] 2026-07-11-resource-cost-parity.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Resource / cost-side OPC parity (2026-07-11)
-- One migration covering the four approved gaps:
--   (3a) cost_accounts        — project cost-breakdown structure (CBS tree)
--   (3b) price_per_unit        — rate on resources + roles; cost fields on
--        resource_assignments  assignments so cost = units × rate (or manual)
--   (3c) activity_expenses     — itemized non-labor costs per activity
--   + project_schedule.cost_rollup — opt-in flag: when true, an activity's
--        planned/actual/earned cost is DERIVED from its assignments + expenses;
--        default false keeps today's manual direct-entry behaviour unchanged.
-- Run in the Supabase SQL editor. Idempotent. RLS: read=is_approved, write=is_planner.
-- ============================================================================

-- (3a) Cost Accounts / CBS -----------------------------------------------------
create table if not exists cost_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references cost_accounts(id) on delete set null,  -- CBS tree
  code text,                       -- e.g. "01-100"
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists cost_accounts_project_idx on cost_accounts(project_id);
alter table cost_accounts enable row level security;
drop policy if exists cost_accounts_read on cost_accounts;
create policy cost_accounts_read on cost_accounts for select using (is_approved());
drop policy if exists cost_accounts_write on cost_accounts;
create policy cost_accounts_write on cost_accounts for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on cost_accounts to authenticated;

-- (3b) Rates + cost on assignments --------------------------------------------
alter table resources       add column if not exists price_per_unit numeric(14,2);
alter table resource_roles  add column if not exists price_per_unit numeric(14,2);

alter table resource_assignments add column if not exists budgeted_cost  numeric(16,2);
alter table resource_assignments add column if not exists actual_cost    numeric(16,2);
alter table resource_assignments add column if not exists remaining_cost numeric(16,2);
alter table resource_assignments add column if not exists cost_account_id uuid references cost_accounts(id) on delete set null;
-- 'derived' = cost computed as units × price_per_unit; 'manual' = typed directly.
alter table resource_assignments add column if not exists rate_source text default 'derived';

-- (3c) Itemized expenses (non-labor) ------------------------------------------
create table if not exists activity_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  activity_id text,                -- matches project_schedule.activity_id (by code)
  name text not null,
  cost_account_id uuid references cost_accounts(id) on delete set null,
  planned_cost numeric(16,2),
  actual_cost  numeric(16,2),
  remarks text,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists activity_expenses_project_activity_idx on activity_expenses(project_id, activity_id);
alter table activity_expenses enable row level security;
drop policy if exists activity_expenses_read on activity_expenses;
create policy activity_expenses_read on activity_expenses for select using (is_approved());
drop policy if exists activity_expenses_write on activity_expenses;
create policy activity_expenses_write on activity_expenses for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on activity_expenses to authenticated;

-- Opt-in bottom-up cost roll-up flag (default false = current manual behaviour) -
alter table project_schedule add column if not exists cost_rollup boolean default false;


-- ==========================================================================
-- [034/142] 2026-07-14-billing-milestones.sql
-- ==========================================================================
-- Milestone-based progress billing --------------------------------------------
-- Some contracts bill fixed lump-sum amounts on reaching project milestones
-- (e.g. "Structural Foundation ₱33M", "Structural 3rd Floor ₱43M") rather than on
-- % POC. billing_basis switches the contract-level cash-in between the two; the
-- milestones themselves live in cash_flow_billing_milestones.

alter table cash_flow_settings
  add column if not exists billing_basis text default 'poc';   -- 'poc' (S-curve) | 'milestone'

create table if not exists cash_flow_billing_milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id) on delete cascade,
  seq            integer default 0,
  description    text,                                 -- e.g. "Structural Foundation"
  basis          text default 'amount' check (basis in ('amount','percent')),
  amount         numeric(18,2),                        -- fixed ₱ when basis='amount'
  percent        numeric(6,5),                         -- of contract IBB when basis='percent'
  trigger_mode   text default 'milestone'
                   check (trigger_mode in ('milestone','month','offset')),
  milestone      text,                                 -- schedule milestone name when 'milestone'
  trigger_month  date,                                 -- when 'month'
  trigger_offset integer default 0,                    -- months from start when 'offset'
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cf_bill_ms_proj on cash_flow_billing_milestones(project_id);
grant select, insert, update, delete on cash_flow_billing_milestones to authenticated, service_role;
alter table cash_flow_billing_milestones enable row level security;
drop policy if exists cash_flow_billing_milestones_read on cash_flow_billing_milestones;
create policy cash_flow_billing_milestones_read on cash_flow_billing_milestones for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_billing_milestones_write on cash_flow_billing_milestones;
create policy cash_flow_billing_milestones_write on cash_flow_billing_milestones for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));


-- ==========================================================================
-- [035/142] 2026-07-14-cash-flow-dp-tranches.sql
-- ==========================================================================
-- Cash Flow — downpayment tranches ------------------------------------------
-- The client downpayment is rarely a single lump sum: per the commercial
-- agreement it can be split into multiple tranches, each tagged by trade /
-- category, timed differently (a fixed month, an offset from NTP, or a schedule
-- milestone), and recouped proportionally against billings. One row per tranche.

create table if not exists cash_flow_dp_tranches (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id) on delete cascade,
  seq             integer default 0,            -- display / apply order
  label           text,                         -- e.g. "DP Tranche 1"
  category        text,                          -- trade / commercial tag (ST, AR, MEPF, …)
  basis           text default 'percent'
                    check (basis in ('percent','amount')),
  percent         numeric(6,5),                 -- of contract IBB (0..1) when basis='percent'
  amount          numeric(18,2),                -- fixed ₱ when basis='amount'
  timing_mode     text default 'offset'
                    check (timing_mode in ('month','offset','milestone')),
  timing_month    date,                          -- when timing_mode='month'
  timing_offset   integer default 0,             -- months from project start when 'offset'
  milestone       text,                          -- schedule milestone name when 'milestone'
  recoup_percent  numeric(6,5),                 -- per-billing claw-back rate (null → = tranche % of contract)
  remarks         text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_cf_dp_tranches_proj on cash_flow_dp_tranches(project_id);

grant select, insert, update, delete on cash_flow_dp_tranches to authenticated, service_role;

alter table cash_flow_dp_tranches enable row level security;

drop policy if exists cash_flow_dp_tranches_read on cash_flow_dp_tranches;
create policy cash_flow_dp_tranches_read on cash_flow_dp_tranches
  for select using (is_approved() and can_access_project(project_id));

drop policy if exists cash_flow_dp_tranches_write on cash_flow_dp_tranches;
create policy cash_flow_dp_tranches_write on cash_flow_dp_tranches
  for all using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));


-- ==========================================================================
-- [036/142] 2026-07-14-cash-flow-settings.sql
-- ==========================================================================
-- Cash Flow — projection settings (one row per project) ----------------------
-- The Cash Flow module is a DERIVED projection: cash-in timing comes from the
-- project_schedule S-curve, cash-out comes from the WPM (procurement) work
-- packages. This table only stores the contract/terms ASSUMPTIONS that aren't
-- derivable from either source (contract value, DP%, retention%, payment terms,
-- and the mapping to the WPM project id, since project ids differ across apps).

create table if not exists cash_flow_settings (
  id                        uuid primary key default gen_random_uuid(),
  project_id                text references projects(id) on delete cascade unique,
  contract_ibb              numeric(18,2),          -- contract amount IBB (VAT inc) — cash-in base
  contract_bcb              numeric(18,2),          -- contract amount BCB (cost base, reference)
  dp_percent                numeric(6,5) default 0, -- client downpayment % (0..1)
  retention_percent         numeric(6,5) default 0.10, -- retention withheld from each billing (0..1)
  dp_recoup_percent         numeric(6,5),           -- % recouped from each billing (null → = dp_percent)
  billing_terms_months      integer default 1,      -- lag: certified billing → cash received (client side)
  retention_release_months  integer default 1,      -- lag after completion for retention release
  start_period              date,                   -- cashflow month 0 (null → schedule start)
  wpm_project_id            text,                   -- maps to the WPM app's projects.id (cash-out scope)
  remarks                   text,
  created_by                uuid references users(id),
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- Grants (PostgREST runs as authenticated/anon) + per-project RLS.
grant select, insert, update, delete on cash_flow_settings to authenticated;

alter table cash_flow_settings enable row level security;

drop policy if exists cash_flow_settings_read on cash_flow_settings;
create policy cash_flow_settings_read on cash_flow_settings
  for select using (is_approved() and can_access_project(project_id));

drop policy if exists cash_flow_settings_write on cash_flow_settings;
create policy cash_flow_settings_write on cash_flow_settings
  for all using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));


-- ==========================================================================
-- [037/142] 2026-07-14-cash-flow-v2.sql
-- ==========================================================================
-- Cash Flow v2: tax withholdings, staged retention, recorded actuals, roll-up ---

-- (1) Tax withholdings + (4) staged retention release — on the settings row.
alter table cash_flow_settings add column if not exists ewt_percent      numeric(6,5) default 0.02;  -- creditable withholding tax on billings
alter table cash_flow_settings add column if not exists vat_percent      numeric(6,5) default 0.12;  -- to derive the VAT-exclusive EWT base
alter table cash_flow_settings add column if not exists ret_rel1_pct     numeric(6,5) default 1;     -- fraction of retention released at stage 1 (1 = single release)
alter table cash_flow_settings add column if not exists ret_rel2_months  integer      default 12;    -- stage-2 (remainder) release: months after completion

-- (2) Recorded actuals ledger — real cash movements booked against the project.
create table if not exists cash_flow_actuals (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  period       date not null,                       -- month the cash moved
  direction    text not null check (direction in ('in','out')),
  category     text,                                -- DP / Billing / Retention / Payment / …
  amount       numeric(18,2) not null,              -- positive magnitude
  description  text,
  remarks      text,
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_cf_actuals_proj on cash_flow_actuals(project_id);
grant select, insert, update, delete on cash_flow_actuals to authenticated, service_role;
alter table cash_flow_actuals enable row level security;
drop policy if exists cash_flow_actuals_read on cash_flow_actuals;
create policy cash_flow_actuals_read on cash_flow_actuals for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_actuals_write on cash_flow_actuals;
create policy cash_flow_actuals_write on cash_flow_actuals for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));

-- (3) Monthly roll-up per project — cheap source for the Portfolio consolidated view.
create table if not exists cash_flow_rollup (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  period       date not null,
  cash_in      numeric(18,2) default 0,
  cash_out     numeric(18,2) default 0,   -- stored as a negative
  net          numeric(18,2) default 0,
  updated_at   timestamptz default now(),
  unique (project_id, period)
);
create index if not exists idx_cf_rollup_proj on cash_flow_rollup(project_id);
grant select, insert, update, delete on cash_flow_rollup to authenticated, service_role;
alter table cash_flow_rollup enable row level security;
drop policy if exists cash_flow_rollup_read on cash_flow_rollup;
create policy cash_flow_rollup_read on cash_flow_rollup for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_rollup_write on cash_flow_rollup;
create policy cash_flow_rollup_write on cash_flow_rollup for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));


-- ==========================================================================
-- [038/142] 2026-07-14-cash-flow-v3.sql
-- ==========================================================================
-- Cash Flow v3: (#5) financing cost, (#8) funding limit, (#6) scenario snapshots,
-- (#7) per-trade cash-in packages. Data date is stored client-side (localStorage),
-- shared with the Project Schedule module's `ps_datadate_<pid>` key — no column.

-- (#5) financing cost rate + (#8) funding (credit-line) limit — on the settings row.
alter table cash_flow_settings add column if not exists finance_rate  numeric(7,5) default 0;   -- ANNUAL interest applied to negative cumulative (drawdowns)
alter table cash_flow_settings add column if not exists funding_limit numeric(18,2);            -- credit-line ceiling; cumulative net below -limit = breach (null = none)

-- Cash-in S-curve weighting basis: 'duration' (time-weighted) or 'cost' (per-activity
-- planned_cost/Planned IBB). Cost mode auto-falls-back to duration when the schedule has
-- no cost loaded. Makes the projection track whichever S-curve the schedule supports.
alter table cash_flow_settings add column if not exists scurve_basis text default 'duration';

-- (#7) Per-trade cash-in packages — split the contract into trades (ST / AR / MEPF …),
-- each with its own share of the contract and its own DP / retention / billing terms.
-- When any package exists it REPLACES the single contract-level cash-in (the packages
-- should sum to the contract IBB; the module surfaces the reconciliation). All packages
-- share the schedule S-curve shape (we have one project schedule); per-trade curves can
-- be added later if per-trade schedules are ever loaded.
create table if not exists cash_flow_trade_packages (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id) on delete cascade,
  seq            integer default 0,
  name           text,                                 -- trade / package label (ST, AR, MEPF, …)
  basis          text not null default 'percent' check (basis in ('percent','amount')),
  percent        numeric(9,6),                         -- share of contract IBB (when basis = percent)
  amount         numeric(18,2),                         -- fixed ₱ (when basis = amount)
  dp_percent        numeric(9,6) default 0,             -- this trade's downpayment %
  retention_percent numeric(9,6) default 0,             -- this trade's retention %
  billing_terms_months integer default 0,               -- this trade's billing lag (blank/0 → settings default)
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cf_trade_proj on cash_flow_trade_packages(project_id);
grant select, insert, update, delete on cash_flow_trade_packages to authenticated, service_role;
alter table cash_flow_trade_packages enable row level security;
drop policy if exists cash_flow_trade_read on cash_flow_trade_packages;
create policy cash_flow_trade_read on cash_flow_trade_packages for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_trade_write on cash_flow_trade_packages;
create policy cash_flow_trade_write on cash_flow_trade_packages for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));

-- (#6) Scenario snapshots — save a projection version (its computed monthly series +
-- headline totals) to compare a later revision against, mirroring the Excel "rev1".
create table if not exists cash_flow_scenarios (
  id           uuid primary key default gen_random_uuid(),
  project_id   text references projects(id) on delete cascade,
  name         text not null,                          -- e.g. "Baseline", "Rev 1"
  is_baseline  boolean default false,                  -- the version deltas are measured against
  snapshot     jsonb not null,                         -- { totalIn, totalOut, closing, peak, finance, months:[…], netCum:[…] }
  created_by   uuid references users(id),
  created_at   timestamptz default now()
);
create index if not exists idx_cf_scen_proj on cash_flow_scenarios(project_id);
grant select, insert, update, delete on cash_flow_scenarios to authenticated, service_role;
alter table cash_flow_scenarios enable row level security;
drop policy if exists cash_flow_scen_read on cash_flow_scenarios;
create policy cash_flow_scen_read on cash_flow_scenarios for select using (is_approved() and can_access_project(project_id));
drop policy if exists cash_flow_scen_write on cash_flow_scenarios;
create policy cash_flow_scen_write on cash_flow_scenarios for all
  using (is_approved() and can_access_project(project_id))
  with check (is_approved() and can_access_project(project_id));


-- ==========================================================================
-- [039/142] 2026-07-14-cashflow-schedule-agg-rpc.sql
-- ==========================================================================
-- Server-side monthly S-curve aggregate for the Cash Flow module ---------------
-- The Cash Flow projection needs each month's duration- AND cost-weighted
-- cumulative planned + actual progress. Computing that in the browser means
-- pulling every leaf activity (16k+ on large schedules) each load. This RPC does
-- the per-activity × per-month spread on the server and returns ONE compact JSON:
-- ~1 row per month + totals + milestones. security invoker → the caller's RLS
-- (project_schedule read = can_access_project) applies.

create or replace function cashflow_schedule_agg(p_id text)
returns jsonb
language sql
stable
security invoker
as $$
  with leaves as (
    select
      coalesce(nullif(duration_days, 0), (end_date - start_date) + 1, 1)::numeric as w_dur,
      coalesce(planned_cost, bl_cost, 0)::numeric                                  as w_cost,
      start_date::date                                                             as s,
      coalesce(end_date, start_date)::date                                         as e,
      coalesce(actual_start, start_date)::date                                     as as_,
      coalesce(actual_finish, end_date, actual_start, start_date)::date            as ae_,
      greatest(0, least(100, coalesce(percent_complete, 0)))::numeric / 100.0      as pc,
      activity_name, activity_type, duration_days
    from project_schedule
    where project_id = p_id
      and start_date is not null
      and coalesce(activity_type, '') !~* 'wbs|summary'
  ),
  bounds as (select min(s) as mn, max(e) as mx from leaves),
  months as (
    select (generate_series(date_trunc('month', mn), date_trunc('month', mx), interval '1 month'))::date as m
    from bounds where mn is not null
  ),
  agg as (
    select
      to_char(mo.m, 'YYYY-MM') as key,
      sum(l.w_dur          * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric  / (l.e   - l.s)   else 1 end)) as pd,
      sum(l.w_cost         * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric  / (l.e   - l.s)   else 1 end)) as pc,
      sum(l.w_dur  * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ad,
      sum(l.w_cost * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ac
    from months mo
    cross join lateral (select (mo.m + interval '1 month - 1 day')::date as me) d
    cross join leaves l
    group by mo.m
    order by mo.m
  )
  select jsonb_build_object(
    'months',     coalesce((select jsonb_agg(jsonb_build_object('key', key, 'pd', pd, 'pc', pc, 'ad', ad, 'ac', ac) order by key) from agg), '[]'::jsonb),
    'totDur',     coalesce((select sum(w_dur)  from leaves), 0),
    'totCost',    coalesce((select sum(w_cost) from leaves), 0),
    'doneDur',    coalesce((select sum(w_dur  * pc) from leaves), 0),
    'doneCost',   coalesce((select sum(w_cost * pc) from leaves), 0),
    'nAct',       (select count(*) from leaves),
    'nCost',      (select count(*) from leaves where w_cost > 0),
    'minDate',    (select mn from bounds),
    'maxDate',    (select mx from bounds),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('name', activity_name, 'date', s) order by s)
                            from leaves where activity_name is not null
                              and (activity_type ~* 'milestone' or coalesce(duration_days, 0) = 0)), '[]'::jsonb)
  );
$$;

grant execute on function cashflow_schedule_agg(text) to authenticated;


-- ==========================================================================
-- [040/142] 2026-07-14-cashout-retention-stages.sql
-- ==========================================================================
-- Separate cash-OUT retention release staging ---------------------------------
-- Subcontract retention terms can differ from the client's. These optional
-- columns let cash-out retention release on its own schedule; when null, the
-- engine falls back to the cash-in staging (ret_rel1_pct / retention_release_months
-- / ret_rel2_months) so existing projects are unchanged.

alter table cash_flow_settings add column if not exists co_ret_rel1_pct    numeric(6,5);  -- fraction released at stage 1 (null → = cash-in)
alter table cash_flow_settings add column if not exists co_ret_rel1_months integer;       -- stage-1 lag, months after WP completion
alter table cash_flow_settings add column if not exists co_ret_rel2_months integer;       -- stage-2 (remainder) lag


-- ==========================================================================
-- [041/142] 2026-07-14-ev-poc.sql
-- ==========================================================================
-- Project Schedule: separate Earned Value (physical) POC, independent of the schedule Duration POC
-- (percent_complete). ev_poc is informational/physical progress and does NOT drive dates.
alter table public.project_schedule
  add column if not exists ev_poc numeric(6,2);

comment on column public.project_schedule.percent_complete is 'Duration POC (%) — schedule progress; drives remaining duration + forecast finish.';
comment on column public.project_schedule.ev_poc is 'Earned Value POC (%) — physical/earned-value progress; informational, does not drive dates.';


-- ==========================================================================
-- [042/142] 2026-07-14-grant-service-role.sql
-- ==========================================================================
-- Grant table privileges to service_role -------------------------------------
-- The original schema granted DML only to `authenticated` (app users run as that
-- role under RLS). Server-side code using the new `sb_secret_…` key runs as
-- `service_role`, which was never granted on these tables → "permission denied
-- for table users" / failed mirror writes from the sync-wpm Edge Function.
-- This grants service_role full DML on existing + future public tables.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;


-- ==========================================================================
-- [043/142] 2026-07-14-seed-sln101-trades.sql
-- ==========================================================================
-- One-time backfill of WPM trades into the mirror for SLN101 --------------------------
-- The authoritative trade for every SLN101 work package, taken from the WPM import
-- ("EPC. PMO. Import WP. SLN101. 2026 06 11"). Run this in the Supabase SQL editor
-- (Planners project) to populate wpm_work_packages.trade immediately, without waiting
-- on a sync-wpm redeploy. Idempotent (re-runnable). Requires the trade column first
-- (migrations/2026-07-14-wpm-mirror-trade.sql).
--
-- NOTE: this is a SNAPSHOT. The durable source is the sync-wpm Edge Function (which now
-- copies trade). Once that is redeployed + re-synced, every sync keeps trade current and
-- this script is no longer needed.

update wpm_work_packages m
set trade = v.trade
from (values
    ('1','General Requirements'),
    ('2','General Requirements'),
    ('3','General Requirements'),
    ('4','General Requirements'),
    ('5','General Requirements'),
    ('6','General Requirements'),
    ('7','General Requirements'),
    ('8','General Requirements'),
    ('9','General Requirements'),
    ('10','General Requirements'),
    ('11','General Requirements'),
    ('12','General Requirements'),
    ('13','General Requirements'),
    ('14','General Requirements'),
    ('15','General Requirements'),
    ('16','General Requirements'),
    ('17','General Requirements'),
    ('18','General Requirements'),
    ('19','General Requirements'),
    ('20','General Requirements'),
    ('21','General Requirements'),
    ('22','General Requirements'),
    ('23','General Requirements'),
    ('24','General Requirements'),
    ('25','General Requirements'),
    ('26','General Requirements'),
    ('27','Structural Works'),
    ('28','Structural Works'),
    ('29','Structural Works'),
    ('30','Structural Works'),
    ('31','Structural Works'),
    ('32','Structural Works'),
    ('33','Structural Works'),
    ('34','Structural Works'),
    ('35','Structural Works'),
    ('36','Structural Works'),
    ('37','Structural Works'),
    ('38','Structural Works'),
    ('39','Structural Works'),
    ('40','Structural Works'),
    ('41','Architectural Works'),
    ('42','Architectural Works'),
    ('43','Architectural Works'),
    ('44','Architectural Works'),
    ('45','Architectural Works'),
    ('46','Architectural Works'),
    ('47','Architectural Works'),
    ('48','Architectural Works'),
    ('49','Architectural Works'),
    ('50','Architectural Works'),
    ('51','Architectural Works'),
    ('52','Architectural Works'),
    ('53','Architectural Works'),
    ('54','Architectural Works'),
    ('55','Architectural Works'),
    ('56','Architectural Works'),
    ('57','Architectural Works'),
    ('58','Architectural Works'),
    ('59','Architectural Works'),
    ('60','Architectural Works'),
    ('61','Architectural Works'),
    ('62','Mechanical Works'),
    ('63','Mechanical Works'),
    ('64','Electrical and Auxiliary Works'),
    ('65','Electrical and Auxiliary Works'),
    ('66','Electrical and Auxiliary Works'),
    ('67','Fire Protection Works'),
    ('68','Electrical and Auxiliary Works'),
    ('69','Electrical and Auxiliary Works'),
    ('70','Electrical and Auxiliary Works'),
    ('71','Plumbing Works'),
    ('72','Mechanical Works'),
    ('73','Mechanical Works'),
    ('74','Mechanical Works'),
    ('75','Plumbing Works'),
    ('76','Plumbing Works'),
    ('77','Mechanical Works'),
    ('78','Fire Protection Works'),
    ('79','Mechanical Works'),
    ('80','Mechanical Works'),
    ('81','Mechanical Works'),
    ('82','Mechanical Works'),
    ('83','Mechanical Works'),
    ('84','Mechanical Works'),
    ('85','Mechanical Works'),
    ('86','Mechanical Works'),
    ('87','Plumbing Works')
) as v(wp_no, trade)
where m.wpm_project_id = 'SLN101' and m.wp_no = v.wp_no
  and (m.trade is null or m.trade = '' or m.trade is distinct from v.trade);

-- Verify: should return 0 rows once every WP is traded.
-- select wp_no, description from wpm_work_packages
-- where wpm_project_id = 'SLN101' and (trade is null or trade = '') order by wp_no;


-- ==========================================================================
-- [044/142] 2026-07-14-trade-dp-tranches.sql
-- ==========================================================================
-- Per-trade DP tranches -------------------------------------------------------
-- A cash-in trade package can break its downpayment into tranches (each with its
-- own %/amount, timing, and recoup rate), same shape as the contract-level DP
-- tranches. Stored as JSON on the trade row (trades are saved delete+insert, so a
-- JSON column is more robust than an FK).

alter table cash_flow_trade_packages
  add column if not exists dp_tranches jsonb default '[]'::jsonb;


-- ==========================================================================
-- [045/142] 2026-07-14-wpm-work-packages-mirror.sql
-- ==========================================================================
-- WPM work-packages MIRROR (cash-out source for the Cash Flow module) ---------
-- Procurement budgets live in a SEPARATE Supabase project (the WPM app). Its
-- anon key is public (client JS), so we do NOT read it from the browser. Instead
-- an Edge Function (supabase/functions/sync-wpm) uses the WPM service_role key
-- SERVER-SIDE to copy the columns the cashflow needs into this table. The module
-- then reads this mirror under normal RLS. Budgets are never exposed to anon.
--
-- Keyed by (wpm_project_id, wp_no). The Edge Function upserts on that key.

create table if not exists wpm_work_packages (
  id                    uuid primary key default gen_random_uuid(),
  wpm_project_id        text not null,          -- the WPM app's projects.id
  wp_no                 text not null,
  description           text,
  approved_budget_bcb   numeric(18,2),
  awarded_cost          numeric(18,2),
  total_awarded         numeric(18,2),
  dp_percent            numeric(6,5),
  retention_percent     numeric(6,5),
  payment_terms_days    integer,
  awarding_date         date,
  actual_awarding_date  date,
  target_delivery       date,
  target_installation   date,
  target_completion     date,
  source_id             uuid,                   -- the WPM work_packages.id (traceability)
  synced_at             timestamptz default now(),
  unique (wpm_project_id, wp_no)
);

create index if not exists idx_wpm_mirror_proj on wpm_work_packages(wpm_project_id);

-- Read for any approved user (the mirror isn't mapped to a Planners project id,
-- so we gate on approval only). WRITES happen exclusively via the Edge Function
-- using the service_role key, which bypasses RLS — no write policy is granted to
-- authenticated/anon, so the browser can never tamper with the mirror.
grant select on wpm_work_packages to authenticated;

alter table wpm_work_packages enable row level security;

drop policy if exists wpm_work_packages_read on wpm_work_packages;
create policy wpm_work_packages_read on wpm_work_packages
  for select using (is_approved());


-- ==========================================================================
-- [046/142] 2026-07-14-wpm-mirror-award-status.sql
-- ==========================================================================
-- Add award/procurement/delivery status to the WPM mirror -------------------
-- Lets the Cash Flow module ground "actual" cash-out in real awarded status:
-- awarded work packages whose payments fall on/before the data date are actual;
-- awarded remainder + un-awarded packages are forecast.

alter table wpm_work_packages add column if not exists award_status       text;
alter table wpm_work_packages add column if not exists procurement_status text;
alter table wpm_work_packages add column if not exists delivery_status     text;


-- ==========================================================================
-- [047/142] 2026-07-14-wpm-mirror-trade.sql
-- ==========================================================================
-- Trade / cost-code group on the WPM mirror -----------------------------------------
-- The Cash Flow cash-out drill-down groups work packages by trade (SITE WORKS /
-- MECHANICAL WORKS / ELECTRICAL AND AUXILIARY WORKS …, as the WPM app does). The
-- sync-wpm Edge Function auto-detects the trade from the WPM work_packages row
-- (first present of trade / cost_code_category / cost_code_group / category /
-- discipline / division / cost_code) and writes it here. Null → "Uncategorized".

alter table wpm_work_packages add column if not exists trade text;


-- ==========================================================================
-- [048/142] 2026-07-16-consolidated.sql
-- ==========================================================================
-- ============================================================================
-- 2026-07-16 — ONE migration covering everything outstanding. Run this alone.
-- Supersedes (and replaces) the separate 2026-07-16 planner-project-visibility
-- and admin-archive-delete files.
--
-- Fully idempotent — safe to re-run, and safe if you already ran either of the
-- superseded files. Every policy is dropped before it is created; every table /
-- column / index uses IF NOT EXISTS; every function is CREATE OR REPLACE.
--
-- Contents
--   1. wbs-nodes safety net  — re-assert the table + project_schedule.wbs_node_id.
--   2. Planner visibility fix — planners see ONLY their assigned projects.
--   3. Admin archive / delete — projects & workspaces.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WBS NODES SAFETY NET
-- Re-asserted here because supabase-schema.sql never received this migration
-- (0 mentions of wbs_nodes) — so a DB built from that file lacks the table AND
-- project_schedule.wbs_node_id. A missing wbs_node_id is what silently broke the
-- WBS-Summary projection (nodes visible in the WBS Manager, absent from the
-- Project Schedule). No-op if you already ran 2026-07-07-wbs-nodes.sql.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists wbs_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  parent_id uuid references wbs_nodes(id) on delete cascade,
  code text,
  code_custom boolean default false,
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists wbs_nodes_project_idx on wbs_nodes(project_id);
create index if not exists wbs_nodes_parent_idx  on wbs_nodes(parent_id);

alter table project_schedule add column if not exists wbs_node_id uuid;
create index if not exists project_schedule_wbs_node_idx on project_schedule(wbs_node_id);

alter table wbs_nodes enable row level security;
drop policy if exists wbs_nodes_read on wbs_nodes;
create policy wbs_nodes_read on wbs_nodes for select using (is_approved());
drop policy if exists wbs_nodes_write on wbs_nodes;
create policy wbs_nodes_write on wbs_nodes for all using (is_planner()) with check (is_planner());
grant select, insert, update, delete on wbs_nodes to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PLANNER PROJECT VISIBILITY  (security fix)
-- `projects_write` was created `for all`, which covers SELECT. Postgres ORs
-- permissive policies together, so `using (is_planner())` gave every approved
-- planner read access to EVERY project, defeating the assignment filter in
-- projects_read. Split into per-command policies so projects_read is the only
-- SELECT gate. Update/delete are assignment-scoped too (a planner could
-- previously edit a project they couldn't see). INSERT stays is_planner()-only:
-- a new project isn't in anyone's users.projects array yet, so scoping it would
-- make "Add Project" impossible for planners.
--
-- MUST come after any older statement that recreates projects_write `for all`
-- (e.g. 2026-06-30-workspaces-project-selector.sql) or the hole reopens.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists projects_admin_write on projects;
drop policy if exists projects_write on projects;
drop policy if exists projects_ins on projects;
drop policy if exists projects_upd on projects;
drop policy if exists projects_del on projects;

create policy projects_ins on projects for insert
  with check (is_planner());

create policy projects_upd on projects for update
  using (is_planner() and (is_admin() or can_access_project(id)))
  with check (is_planner() and (is_admin() or can_access_project(id)));

create policy projects_del on projects for delete
  using (is_planner() and (is_admin() or can_access_project(id)));


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ADMIN ARCHIVE / DELETE
-- ~20 module tables carry `project_id references projects(id)` and most predate
-- `on delete cascade`, so deleting a used project dies on an FK violation.
-- Archive is the primary action; hard delete is the empty-only escape hatch.
-- No new archive column: projects.status ('active' | 'archived') already means
-- this and is already wired (portfolio-overview filters it, both Edit Project
-- modals expose it).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function admin_archive_project(target text, archive boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from projects where id = target) then
    raise exception 'Project % not found', target;
  end if;
  update projects
     set status = case when archive then 'archived' else 'active' end
   where id = target;
end $$;

-- Refuses unless the project is empty across every table referencing it. The
-- table list is discovered from the pg catalog, not hardcoded, so a module added
-- later is covered automatically.
create or replace function admin_delete_project(target text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t        text;
  n        bigint;
  blockers text := '';
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from projects where id = target) then
    raise exception 'Project % not found', target;
  end if;

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
    if n > 0 then blockers := blockers || format('%s (%s), ', t, n); end if;
  end loop;

  if blockers <> '' then
    raise exception 'Project % still has data in: %. Archive it instead, or clear these first.',
      target, rtrim(blockers, ', ');
  end if;

  -- users.projects is a text[] with no FK — strip the id so assignments don't dangle.
  update users set projects = array_remove(projects, target)
   where projects @> array[target];

  delete from projects where id = target;
end $$;

create or replace function admin_delete_workspace(target text)
returns void language plpgsql security definer set search_path = public as $$
declare kids bigint; projs bigint;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from workspaces where id = target) then
    raise exception 'Workspace % not found', target;
  end if;

  select count(*) into kids  from workspaces where parent_id    = target;
  select count(*) into projs from projects   where workspace_id = target;

  if kids > 0 or projs > 0 then
    raise exception
      'Cannot delete %: it still contains % child workspace/program(s) and % project(s). Move or remove them first.',
      target, kids, projs;
  end if;

  delete from workspaces where id = target;
end $$;

grant execute on function admin_archive_project(text, boolean) to authenticated;
grant execute on function admin_delete_project(text)           to authenticated;
grant execute on function admin_delete_workspace(text)         to authenticated;


-- ==========================================================================
-- [049/142] 2026-07-16-drawing-register-full.sql
-- ==========================================================================
-- ============================================================================
-- Drawing Register — full-fidelity rebuild (matches the Megawide "Drawing
-- Register & Tracker" workbook: GPR101. TEC. Drawing Register).
-- Extends the starter `drawing_register` table with the structured drawing-code
-- parts, phase/discipline grouping, multi-revision submission tracking, and
-- approval/progress fields. Idempotent — safe to re-run.
-- ============================================================================

-- Structured drawing-code parts (from the workbook "Coding Reference" sheet):
--   <proj_code>-<building_ref>-<company>-<drawing_type>-<discipline>-<floor_level>-<dwg_number>-<revision>
alter table drawing_register add column if not exists proj_code    text;   -- e.g. GPR101 / NPL
alter table drawing_register add column if not exists building_ref  text;  -- TW1..TW9 / GEN
alter table drawing_register add column if not exists company       text;  -- MCC (Megawide) / subcon acronym
alter table drawing_register add column if not exists drawing_type  text;  -- ECD/SD1/SD2/FCD/CSD/ISD/DRC
alter table drawing_register add column if not exists floor_level   text;  -- GEN/FD/GF/2F.. / RDF / RORD
alter table drawing_register add column if not exists dwg_number    text;  -- the numeric sheet no (e.g. 4750, A-101)
alter table drawing_register add column if not exists drawing_code  text;  -- full composed code (also = drawing_no)

-- Grouping / classification
alter table drawing_register add column if not exists phase        text;   -- Concept Design / Schematic Design 1 / 2 / For Construction ...
alter table drawing_register add column if not exists category     text;   -- Floor Plan / Elevation / Section ...
alter table drawing_register add column if not exists description  text;   -- long description of the sheet
alter table drawing_register add column if not exists responsible  text;   -- consultant / party (e.g. ECTA, RBS, In-House)

-- Progress
alter table drawing_register add column if not exists no_of_sheets    integer default 1;
alter table drawing_register add column if not exists approved_sheets  integer default 0;
alter table drawing_register add column if not exists approved_pct     numeric;   -- 0..1 (approved_sheets / no_of_sheets)

-- Submission tracking across revisions 0..N:
--   [{ "rev": 0, "planned": "2025-04-28", "actual": "2025-05-05" }, ...]
alter table drawing_register add column if not exists submissions jsonb default '[]'::jsonb;

-- Approval tracking
alter table drawing_register add column if not exists planned_approval date;
alter table drawing_register add column if not exists actual_approval  date;

-- Ordering (preserves import / hierarchy order)
alter table drawing_register add column if not exists sort_order integer default 0;

-- `status` values now allowed (workbook approval outcomes), kept as free text so
-- existing rows aren't broken:
--   For Review | Revise & Resubmit | Approved w/ comments | Approved w/o comments
--   | Approved | Superseded

create index if not exists drawing_register_project_sort_idx
  on drawing_register (project_id, sort_order);


-- ==========================================================================
-- [050/142] 2026-07-16-drawing-register-nodes.sql
-- ==========================================================================
-- ============================================================================
-- Drawing Register — structural tree nodes.
-- Lets planners build the level skeleton (phase → discipline → category) as real
-- rows, then add drawings under a selected node. Backward compatible: existing
-- imported rows default to node_kind='drawing' and still render via their
-- phase/discipline/category text. Idempotent.
-- ============================================================================

alter table drawing_register add column if not exists node_kind text default 'drawing';
  -- one of: phase | discipline | category | drawing

update drawing_register set node_kind = 'drawing' where node_kind is null;

create index if not exists drawing_register_kind_idx
  on drawing_register (project_id, node_kind, sort_order);


-- ==========================================================================
-- [051/142] 2026-07-17-issues-lessons.sql
-- ==========================================================================
-- ============================================================================
-- Issues, Concerns & Lessons Learned — module columns
-- ----------------------------------------------------------------------------
-- The starter `issues_lessons` table (supabase-schema.sql) predates the Power
-- Apps "Issues & Concerns" screen this module reproduces. That screen's fields:
--   STATUS · DEPARTMENT · CHAMPION · ISSUE · CAUSED BY · CORRECTIVE ACTION ·
--   DATE PRESENTED · DAYS AGING (derived) · DATE RESOLVED
-- plus this module's addition — a LESSON LEARNED captured per issue so
-- management/operations can reference it later.
--
-- Field mapping to the existing table:
--   ISSUE          -> `description` (existing)
--   STATUS         -> `status`      (existing; Open | On Hold | Closed)
-- Genuinely new fields are added below. `type` is set to 'Issue' by the module
-- for these rows; a captured lesson lives on the same row (lesson_* columns) so
-- a lesson is never divorced from the issue that produced it.
--
-- Days Aging is DERIVED in the app (not stored): 0 when Closed, else
-- today − date_presented — so it is always live and needs no column.
--
-- Idempotent — safe to re-run. Folded into supabase-schema.sql.
-- Requires the project-access RLS + grants migrations.
-- ============================================================================

alter table issues_lessons add column if not exists department        text;
alter table issues_lessons add column if not exists champion          text;
alter table issues_lessons add column if not exists caused_by         text;
alter table issues_lessons add column if not exists corrective_action text;
alter table issues_lessons add column if not exists date_presented    date;
alter table issues_lessons add column if not exists date_resolved     date;

-- Lessons Learned (the module's addition) — captured on the issue itself.
alter table issues_lessons add column if not exists lesson_learned    text;
alter table issues_lessons add column if not exists lesson_category   text;
alter table issues_lessons add column if not exists recommendation    text;

-- Log is always project-scoped and ordered newest-presented first.
create index if not exists issues_lessons_proj_date_idx
  on issues_lessons (project_id, date_presented desc);


-- ==========================================================================
-- [052/142] 2026-07-17-ppr-presentations.sql
-- ==========================================================================
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


-- ==========================================================================
-- [053/142] 2026-07-17-progress-photos.sql
-- ==========================================================================
-- ============================================================================
-- Progress Photos — Photos Database columns
-- ----------------------------------------------------------------------------
-- The starter `progress_photos` table (supabase-schema.sql) predates the Power
-- Apps "Photos Database" screen it replaces. That screen's row is:
--   PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION · CAPTURE DATE
-- `description`, `location`, `photo_url` and `taken_at` (capture date) already
-- exist; `trade` and `works` are the two genuinely new fields. `sort_order`
-- keeps a stable order for photos captured on the same day.
--
-- Idempotent — safe to re-run. Folded into supabase-schema.sql.
-- Requires the earlier storage-buckets migration (private `progress-photos`
-- bucket) and the project-access RLS migration.
-- ============================================================================

alter table progress_photos add column if not exists trade      text;
alter table progress_photos add column if not exists works      text;
alter table progress_photos add column if not exists sort_order integer;

-- Filters are always project-scoped and usually date-ordered.
create index if not exists progress_photos_proj_date_idx
  on progress_photos (project_id, taken_at desc);


-- ==========================================================================
-- [054/142] 2026-07-20-contracts-claims-full.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Contracts & Claims Register — full fidelity against the Power Apps
-- "Contracts & Claims Register" app (Overview / Claims and Change Orders /
-- Extension of Time screens).
--
-- The starter table had a single `amount`, which only fits a Contract row. Both
-- the Claims/CO and the EOT screens are a FOUR-STAGE PIPELINE:
--     Estimated -> Submitted -> Evaluated -> Client Approved
-- identical in shape, differing only in unit: Claims/CO are money, EOT is DAYS.
--
-- Money and days are kept as SEPARATE column sets rather than one generic
-- value + unit discriminator: they are never mixed in a view, the roll-up totals
-- are per-screen, and separate columns make it impossible to accidentally sum
-- pesos and calendar days together.
--
-- record_type discriminates the three parts of the module:
--     'Contract' | 'Claim' | 'Change Order' | 'EOT'
-- ('Claim' and 'Change Order' share the Claims/CO screen; the app's
--  "Select Claim/CO" filter switches between them.)
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- ---- Claims / Change Order: the money pipeline -----------------------------
alter table contracts_claims add column if not exists est_amount      numeric(18,2);
alter table contracts_claims add column if not exists sub_amount      numeric(18,2);
alter table contracts_claims add column if not exists eval_amount     numeric(18,2);
alter table contracts_claims add column if not exists approved_amount numeric(18,2);

-- ---- Extension of Time: the same pipeline in DAYS --------------------------
alter table contracts_claims add column if not exists est_days      integer;
alter table contracts_claims add column if not exists sub_days      integer;
alter table contracts_claims add column if not exists eval_days     integer;
alter table contracts_claims add column if not exists approved_days integer;

-- ---- Pipeline dates --------------------------------------------------------
-- date_submitted drives AGING: the app shows an aging figure only while a record
-- is Pending (days since it was submitted to the client). Aging is DERIVED at
-- render time, never stored, so it can't go stale.
alter table contracts_claims add column if not exists date_submitted date;
alter table contracts_claims add column if not exists date_evaluated date;
alter table contracts_claims add column if not exists date_approved  date;

-- ---- Ordering --------------------------------------------------------------
alter table contracts_claims add column if not exists sort_order integer default 0;

create index if not exists contracts_claims_project_idx on contracts_claims(project_id);
create index if not exists contracts_claims_type_idx    on contracts_claims(project_id, record_type);
create index if not exists contracts_claims_status_idx  on contracts_claims(project_id, status);

comment on column contracts_claims.record_type is
  'Contract | Claim | Change Order | EOT — selects which screen the row belongs to.';
comment on column contracts_claims.status is
  'Pending | Approved | Disapproved | Cancelled';
comment on column contracts_claims.amount is
  'Contract amount. Only meaningful for record_type = ''Contract''; Claims/CO use the *_amount pipeline and EOT the *_days pipeline.';
comment on column contracts_claims.date_submitted is
  'Date submitted to the client — drives the derived Aging shown while Pending.';

-- RLS + grants already exist for this table (Phase-1 module table, see
-- supabase-schema.sql). Adding columns does not change either.


-- ==========================================================================
-- [055/142] 2026-07-20-material-submittal-full.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Material Submittal Log — full fidelity against the PMO workbook
-- ("EPC. PMO. Material Submittal List Dashboard").
--
-- The starter table carried only 8 business columns. The real log has 28, built
-- around a 7-part structured submittal number (the same coding convention the
-- Drawing Register uses) plus TWO date pairs that the dashboard depends on:
--   submission: plan_submission_date / date_submitted (actual)
--   approval  : plan_approval_date   / date_approved  (actual)
-- The S-curve is driven by the APPROVAL pair, not submission — see the module's
-- CLAUDE.md for the derivation proof against the workbook's own formulas.
--
-- Existing starter columns are REUSED for their natural match rather than
-- duplicated, so there are no dead columns:
--   material   = Item          specification = Specification
--   supplier   = Vendor        status        = Status
--   remarks    = Remarks       submittal_no  = full composed code
--   date_required  = Required Date Baseline
--   date_submitted = Actual Submission Date
--   date_approved  = Actual Approval Date
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- ---- 7-part structured submittal number -----------------------------------
-- <project>-<building>-<company>-<doctype>-<discipline>-<floor>-<number>
-- e.g. TMS-SUB-MCC-MT-CL-FND-1000
alter table material_submittal add column if not exists code_project    text;
alter table material_submittal add column if not exists code_building   text;
alter table material_submittal add column if not exists code_company    text;
alter table material_submittal add column if not exists code_doctype    text;
alter table material_submittal add column if not exists code_discipline text;
alter table material_submittal add column if not exists code_floor      text;
alter table material_submittal add column if not exists code_number     text;

-- ---- classification --------------------------------------------------------
-- trade_section = the workbook's section header rows (GENERAL REQUIREMENT,
-- SITEWORKS, REBAR, …) — 23 of them; the log is grouped by these.
alter table material_submittal add column if not exists trade_section text;
-- discipline = CL/ST/AR/ME/EL/PL/FP… Drives the dashboard S-curve.
-- NOTE: the workbook has a REDUNDANT "Trades" column that its S-curve grouped
-- by; it was blank on 39 of 141 rows, silently dropping them from the chart.
-- This module groups by `discipline` (always populated) instead. Deliberate.
alter table material_submittal add column if not exists discipline    text;
-- The workbook's redundant "Trades" column, preserved ONLY so the dashboard can
-- reproduce the legacy Excel figure for reconciliation ("Excel parity" line).
-- Nothing else reads it — never group new work by this column.
alter table material_submittal add column if not exists trade_code    text;
alter table material_submittal add column if not exists floor_levels  text;
alter table material_submittal add column if not exists location      text;

-- ---- item detail -----------------------------------------------------------
alter table material_submittal add column if not exists reference_document text;
alter table material_submittal add column if not exists brand              text;
-- Sample Board | Mock Up | Brochure and Technical Data Sheet | Sample |
-- Product Certification | Test Results   (workbook "Library" sheet)
alter table material_submittal add column if not exists type_presentation  text;

-- ---- the planned half of each date pair ------------------------------------
alter table material_submittal add column if not exists plan_submission_date date;
alter table material_submittal add column if not exists plan_approval_date   date;

-- ---- approval / revision ---------------------------------------------------
alter table material_submittal add column if not exists approver_consultant text;
alter table material_submittal add column if not exists approver_client     text;
alter table material_submittal add column if not exists revision_no         text;
alter table material_submittal add column if not exists mas_id              text;

-- ---- ordering --------------------------------------------------------------
-- seq_no = the workbook's visible "NO." column (display only, may repeat/blank).
-- sort_order = the module's own stable ordering within a trade section.
alter table material_submittal add column if not exists seq_no     int;
alter table material_submittal add column if not exists sort_order int default 0;

create index if not exists material_submittal_project_idx    on material_submittal(project_id);
create index if not exists material_submittal_discipline_idx on material_submittal(project_id, discipline);
create index if not exists material_submittal_status_idx     on material_submittal(project_id, status);

-- Status vocabulary (workbook "Library" sheet, with its letter codes):
--   A Approved · B Approved w/ Comments · C Resubmit · D Rejected
--   F For Information · P For Submission · (no code) Pending Approval
comment on column material_submittal.status is
  'Approved | Approved w/ Comments | Resubmit | Rejected | For Information | For Submission | Pending Approval';
comment on column material_submittal.discipline is
  'Discipline code (CL/ST/AR/ME/EL/PL/FP…) — drives the dashboard S-curve grouping.';
comment on column material_submittal.plan_approval_date is
  'Planned approval date — the PLANNED series of the dashboard S-curve.';
comment on column material_submittal.date_approved is
  'Actual approval date — the ACTUAL series of the dashboard S-curve.';

-- RLS + grants already exist for this table (Phase-1 module table, see
-- supabase-schema.sql). Adding columns does not change either.


-- ==========================================================================
-- [056/142] 2026-07-20-material-submittal-storage-delete.sql
-- ==========================================================================
-- ============================================================================
-- Migration: widen the material-submittal bucket's DELETE policy to planners.
--
-- WHY: the 2026-06-18 storage migration gave all three buckets
--   delete using (bucket_id = <b> and (owner = auth.uid() or is_admin()))
-- so a PLANNER deleting a submittal they did not upload removed the row but its
-- storage object delete silently no-opped, orphaning the file in the bucket.
-- (Not data loss — the row is gone — but the bucket accumulates junk, and the
-- module's row/bulk/clear delete paths all hit this.)
--
-- `is_planner()` is `approved AND role in (super_admin, admin, planner)`, so it
-- already subsumes the old `is_admin()` branch.
--
-- ⚠️ The `owner = auth.uid()` branch is KEPT deliberately. The bucket's INSERT
-- policy is `is_approved()`, i.e. ANY approved user can upload — including the
-- `user`/`viewer` roles. Replacing the owner check with `is_planner()` alone
-- would take away those users' ability to delete their own uploads, which would
-- be a NARROWING, not a widening. Keeping both makes this purely additive: no
-- one loses access, planners gain it.
--
-- SCOPE: material-submittal only, as requested. `drawing-register` and
-- `progress-photos` still carry the original owner-or-admin rule and have the
-- same orphaning behaviour — to widen those too, add them to the array below
-- and re-run.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- Guard: this policy references is_planner() (added by
-- 2026-06-30-workspaces-project-selector.sql). A policy's USING expression is
-- parsed at creation, so without it you'd get a bare "function does not exist".
do $$
begin
  if to_regprocedure('public.is_planner()') is null then
    raise exception 'is_planner() is missing — run migrations/2026-06-30-workspaces-project-selector.sql first';
  end if;
end $$;

do $$
declare b text;
begin
  foreach b in array array['material-submittal'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_del');
    execute format(
      'create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_planner()))',
      b || '_del', b);
  end loop;
end $$;

-- Verify (expects one row, qual naming is_planner):
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'storage.objects'::regclass and polname = 'material-submittal_del';


-- ==========================================================================
-- [057/142] 2026-07-20-productivity-rates-full.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Productivity Rates — full module schema (Productivity Monitoring)
--
-- Reverse-engineered from the Megawide OPS workbook
--   "QHL706. OPS. Productivity Monitoring … (BL02)"
-- where every construction trade lives on its own sheet as a monthly
-- Planned / Actual / Baseline (BL0) monitoring graph tracking THREE series:
--   1. Manpower (or Equipment) loading    — crew size per month
--   2. Output quantity                     — kg / m3 / m2 / pcs / unit installed
--   3. Average Productivity Rate           — output per man-day  (DERIVED)
-- plus a cumulative-output curve with Planned-vs-Actual variance.
--
-- MODEL: two tables. `productivity_activities` = one row per trade (the sheet
-- header: name, output unit, resource type/unit, subcontractor). Manpower and
-- output are stored INPUTS; `work_days` (working days that month) is the input
-- man-day divisor. The productivity RATE, the cumulative and the variance are
-- DERIVED in the app (rate = output ÷ (resource × work_days)) and never stored
-- — the same "derive, don't persist" rule risk-register uses for its rating, so
-- a stored figure can never drift from its inputs.
--
-- The Phase-1 starter table `productivity_rates` (flat activity/output/manhours
-- row) is SUPERSEDED by these two purpose-built tables; it is left in place
-- untouched so nothing that referenced it breaks.
--
-- Run in the Supabase SQL editor. Idempotent / add-only.
-- ============================================================================

-- ---- One row per trade / activity ------------------------------------------
create table if not exists productivity_activities (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  name           text not null,
  category       text,                        -- optional grouping (e.g. Substructure / Superstructure / Precast)
  unit           text,                        -- output unit: kg | m3 | m2 | pcs | unit
  resource_type  text default 'Manpower',     -- Manpower | Equipment
  resource_unit  text default 'pax',          -- pax | unit | man-day
  subcontractor  text,                         -- executing subcontractor (AFCSC / JM2 / CEC / GeoExpert …)
  sort_order     numeric,
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ---- One row per (activity, month) — the monthly monitoring point ----------
-- Each series (Baseline BL0 / Planned / Actual) has its own manpower + output
-- column. `work_days` is the working-day count for that month (the man-day
-- divisor); on import it is set to reproduce the workbook's own rate, and for
-- manual entry it defaults to the Philippine 6-day working calendar (PDCal).
create table if not exists productivity_entries (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  activity_id    uuid references productivity_activities(id) on delete cascade,
  period         date not null,               -- first day of the month
  work_days      numeric,                      -- working days this month (man-day divisor)
  mp_bl0         numeric, mp_planned numeric, mp_actual numeric,    -- resource loading
  qty_bl0        numeric, qty_planned numeric, qty_actual numeric,  -- output quantity
  remarks        text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists productivity_entries_uq  on productivity_entries(activity_id, period);
create index        if not exists productivity_entries_prj on productivity_entries(project_id, period);
create index        if not exists productivity_act_prj     on productivity_activities(project_id, sort_order);

comment on table productivity_activities is 'Productivity Monitoring: one row per construction trade/activity (per project).';
comment on table productivity_entries    is 'Productivity Monitoring: monthly Planned/Actual/BL0 manpower + output per activity. Rate/cumulative/variance are derived in the app.';
comment on column productivity_entries.work_days is 'Working days in the month = the man-day divisor. rate = output ÷ (resource × work_days).';

-- ---- Grants (explicit; the schema also grants future tables by default) -----
grant select, insert, update, delete on productivity_activities to authenticated;
grant select, insert, update, delete on productivity_entries    to authenticated;

-- ---- RLS: the standard read-all-accessible / write-own-or-admin pattern -----
-- (same shape as every other module table in supabase-schema.sql). Both rows
-- carry project_id + created_by so the project-access + authorship gates apply.
do $$
declare t text;
begin
  foreach t in array array['productivity_activities','productivity_entries'] loop
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


-- ==========================================================================
-- [058/142] 2026-07-20-schedule-scurve-agg.sql
-- ==========================================================================
-- ============================================================================
-- Shared server-side monthly S-curve aggregate (generalizes cashflow_schedule_agg)
-- ----------------------------------------------------------------------------
-- Every consumer of the schedule (S-Curve, Cash Flow, Portfolio) needs the same
-- thing: per-month duration- AND cost-weighted cumulative PLANNED + ACTUAL
-- progress. Computing that in the browser means pulling every leaf activity
-- (16k–40k rows on large schedules) each load. These functions do the
-- per-activity × per-month spread on the server and return ONE compact JSON
-- (~1 row per month + totals + milestones), so the browser fetches dozens of
-- rows instead of tens of thousands.
--
--   schedule_scurve_agg_multi(text[])  — core; aggregates the given projects
--                                        into ONE combined curve (Portfolio).
--   schedule_scurve_agg(text)          — single project (S-Curve).
--   cashflow_schedule_agg(text)        — kept as a thin wrapper so Cash Flow
--                                        keeps working before/after redeploy.
--
-- security invoker → the caller's RLS (project_schedule read = can_access_project)
-- applies, so a user only ever aggregates projects they can already see.
-- Idempotent (create or replace). Run once in the Supabase SQL editor.
-- ============================================================================

create or replace function schedule_scurve_agg_multi(p_ids text[])
returns jsonb
language sql
stable
security invoker
as $$
  with leaves as (
    select
      coalesce(nullif(duration_days, 0), (end_date - start_date) + 1, 1)::numeric as w_dur,
      coalesce(planned_cost, bl_cost, 0)::numeric                                  as w_cost,
      start_date::date                                                             as s,
      coalesce(end_date, start_date)::date                                         as e,
      coalesce(actual_start, start_date)::date                                     as as_,
      coalesce(actual_finish, end_date, actual_start, start_date)::date            as ae_,
      greatest(0, least(100, coalesce(percent_complete, 0)))::numeric / 100.0      as pc,
      activity_name, activity_type, duration_days
    from project_schedule
    where project_id = any(p_ids)
      and start_date is not null
      and coalesce(activity_type, '') !~* 'wbs|summary'
  ),
  bounds as (select min(s) as mn, max(e) as mx from leaves),
  months as (
    select (generate_series(date_trunc('month', mn), date_trunc('month', mx), interval '1 month'))::date as m
    from bounds where mn is not null
  ),
  agg as (
    select
      to_char(mo.m, 'YYYY-MM') as key,
      sum(l.w_dur          * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric  / (l.e   - l.s)   else 1 end)) as pd,
      sum(l.w_cost         * (case when d.me >= l.e   then 1 when d.me < l.s   then 0 when l.e   > l.s   then (d.me - l.s)::numeric  / (l.e   - l.s)   else 1 end)) as pc,
      sum(l.w_dur  * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ad,
      sum(l.w_cost * l.pc  * (case when d.me >= l.ae_ then 1 when d.me < l.as_ then 0 when l.ae_ > l.as_ then (d.me - l.as_)::numeric / (l.ae_ - l.as_) else 1 end)) as ac
    from months mo
    cross join lateral (select (mo.m + interval '1 month - 1 day')::date as me) d
    cross join leaves l
    group by mo.m
    order by mo.m
  )
  select jsonb_build_object(
    'months',     coalesce((select jsonb_agg(jsonb_build_object('key', key, 'pd', pd, 'pc', pc, 'ad', ad, 'ac', ac) order by key) from agg), '[]'::jsonb),
    'totDur',     coalesce((select sum(w_dur)  from leaves), 0),
    'totCost',    coalesce((select sum(w_cost) from leaves), 0),
    'doneDur',    coalesce((select sum(w_dur  * pc) from leaves), 0),
    'doneCost',   coalesce((select sum(w_cost * pc) from leaves), 0),
    'nAct',       (select count(*) from leaves),
    'nCost',      (select count(*) from leaves where w_cost > 0),
    'minDate',    (select mn from bounds),
    'maxDate',    (select mx from bounds),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object('name', activity_name, 'date', s) order by s)
                            from leaves where activity_name is not null
                              and (activity_type ~* 'milestone' or coalesce(duration_days, 0) = 0)), '[]'::jsonb)
  );
$$;

create or replace function schedule_scurve_agg(p_id text)
returns jsonb language sql stable security invoker
as $$ select schedule_scurve_agg_multi(array[p_id]); $$;

-- Back-compat: Cash Flow calls cashflow_schedule_agg — keep it as a wrapper.
create or replace function cashflow_schedule_agg(p_id text)
returns jsonb language sql stable security invoker
as $$ select schedule_scurve_agg(p_id); $$;

grant execute on function schedule_scurve_agg_multi(text[]) to authenticated;
grant execute on function schedule_scurve_agg(text)        to authenticated;
grant execute on function cashflow_schedule_agg(text)      to authenticated;

-- B1: composite index for the editor's keyset pagination
--   (where project_id = ? and id > ? order by id) — an indexed range scan per page.
create index if not exists project_schedule_proj_id_idx on project_schedule (project_id, id);


-- ==========================================================================
-- [059/142] 2026-07-20-stakeholder-map-full.sql
-- ==========================================================================
-- ============================================================================
-- Stakeholder Map — full corporate-BD methodology
-- ----------------------------------------------------------------------------
-- Extends the starter `stakeholder_map` table to match Megawide's real
-- "CORP. BD TCD. Stakeholder Map" workbook (BD Map / TCD Map + Analysis Guide).
--
-- Reused starter columns (no dead duplicates), by natural match:
--   name         -> Name
--   organization -> Institution        (the agency/company, e.g. "Board of Investments")
--   role_title   -> Position           (e.g. "City Mayor")
--   category     -> Sector             (Government | Private)
--   influence    -> Impact  rating 1-4 (the "capability to disrupt business" axis;
--                                        the workbook renames Influence -> Impact)
--   interest     -> Interest rating 1-4
--   contact      -> Contact
--   engagement   -> free-text engagement notes (optional; the workbook has no
--                                        notes column, this is a useful add)
--
-- DERIVED IN-APP, never stored (pure functions of the columns above):
--   Importance (1st-4th) + Engagement Approach  <- Impact x Interest grid
--   Engagement Strategy + Minimum Frequency      <- (Target - Current) relationship gap
--
-- Ratings kept as text ('1'..'4') in the reused influence/interest columns
-- (idempotent add-only migration, no type ALTER); the module parses them.
-- ============================================================================

alter table stakeholder_map add column if not exists stakeholder_group   text;   -- LGU | NGA | GOCC | Partners | Consultants | ...
alter table stakeholder_map add column if not exists title               text;   -- honorific / formal title
alter table stakeholder_map add column if not exists nickname            text;
alter table stakeholder_map add column if not exists birthday            date;
alter table stakeholder_map add column if not exists email               text;
alter table stakeholder_map add column if not exists current_rel         smallint;  -- Current Relationship 1-4
alter table stakeholder_map add column if not exists target_rel          smallint;  -- Target Relationship 1-4
alter table stakeholder_map add column if not exists primary_responsible text;
alter table stakeholder_map add column if not exists alternate           text;
alter table stakeholder_map add column if not exists gift_tier           text;

-- Helpful index for the project-scoped list (ordered by name).
create index if not exists stakeholder_map_project_name_idx
  on stakeholder_map (project_id, name);


-- ==========================================================================
-- [060/142] 2026-07-20-storage-planner-delete-all-buckets.sql
-- ==========================================================================
-- ============================================================================
-- Migration: widen the DELETE policy on the remaining two module buckets
-- (drawing-register, progress-photos) to planners — same change already applied
-- to material-submittal by 2026-07-20-material-submittal-storage-delete.sql.
--
-- A NEW file rather than editing that one: it has already been run, and applied
-- migrations should stay immutable so "what ran" is unambiguous.
--
-- WHY: the 2026-06-18 storage migration set
--   delete using (bucket_id = <b> and (owner = auth.uid() or is_admin()))
-- so a PLANNER deleting a drawing/photo they did not upload removed the row but
-- its storage object delete silently no-opped, orphaning the file.
--
-- ⚠️ The `owner = auth.uid()` branch is KEPT deliberately. Both buckets' INSERT
-- policy is `is_approved()`, i.e. ANY approved user can upload — including the
-- `user`/`viewer` roles. Replacing the owner check with `is_planner()` alone
-- would take away those users' ability to delete their own uploads: a NARROWING,
-- not a widening. `is_planner()` (approved AND role in super_admin/admin/planner)
-- already subsumes the old `is_admin()` branch, so this is purely additive.
--
-- After this, all three module buckets share one delete rule.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

-- Guard: the policy references is_planner() (added by
-- 2026-06-30-workspaces-project-selector.sql). A policy's USING expression is
-- parsed at creation, so without it you'd get a bare "function does not exist".
do $$
begin
  if to_regprocedure('public.is_planner()') is null then
    raise exception 'is_planner() is missing — run migrations/2026-06-30-workspaces-project-selector.sql first';
  end if;
end $$;

do $$
declare b text;
begin
  foreach b in array array['drawing-register','progress-photos'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_del');
    execute format(
      'create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_planner()))',
      b || '_del', b);
  end loop;
end $$;

-- Verify (expects 3 rows, every using_expr naming is_planner):
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'storage.objects'::regclass and polname like '%\_del'
--   order by polname;


-- ==========================================================================
-- [061/142] 2026-07-21-rls-project-scope-fix.sql
-- ==========================================================================
-- ============================================================================
-- Migration: RLS project-scope fix for the schedule / cost support tables
--
-- AUDIT FINDING (2026-07-21). A cluster of PROJECT-SCOPED tables created by the
-- 2026-07-07 schedule batch + the 2026-07-11 resource-cost-parity migration were
-- given policies that ignore the project boundary:
--     read  : using (is_approved())          -- any approved user, ANY project
--     write : for all using (is_planner())   -- any planner, ANY project
-- Neither gate calls can_access_project(project_id), so every approved user could
-- READ every project's schedule/WBS and — worse — its COST data (activity_expenses,
-- schedule_baselines, cost_accounts), and any planner could WRITE across projects.
-- This contradicts the app's per-project access model; the cash_flow_* tables were
-- already scoped correctly, this brings the rest in line.
--
-- FIX: read  = can_access_project(project_id)   -- helper already allows admins +
--                                                  requires status='approved'
--      write = is_planner() and can_access_project(project_id)
-- schedule_audit keeps its INSERT-ONLY write (it is an immutable change log).
--
-- Idempotent + existence-guarded (skips any table whose own migration wasn't run).
-- Run in the Supabase SQL editor.
-- ============================================================================
do $$
declare t text;
begin
  -- Read + full (planner) write, both project-scoped.
  foreach t in array array[
    'schedule_baselines','cost_accounts','activity_expenses','wbs_nodes',
    'activity_code_types','activity_code_values','activity_steps','activity_udf_defs',
    'schedule_scenarios','schedule_snapshots','schedule_thresholds','weekly_commitments'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;   -- migration not run → skip
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
  end loop;

  -- schedule_audit: project-scoped read, INSERT-ONLY write (immutable log).
  if to_regclass('public.schedule_audit') is not null then
    execute 'alter table schedule_audit enable row level security';
    execute 'drop policy if exists schedule_audit_read on schedule_audit';
    execute 'create policy schedule_audit_read on schedule_audit for select using (can_access_project(project_id))';
    execute 'drop policy if exists schedule_audit_write on schedule_audit';
    execute 'create policy schedule_audit_write on schedule_audit for insert with check (is_planner() and can_access_project(project_id))';
  end if;
end $$;


-- ==========================================================================
-- [062/142] 2026-07-21-viewer-readonly.sql
-- ==========================================================================
-- ============================================================================
-- Migration: make the 'viewer' role truly read-only (audit finding #7, 2026-07-21)
--
-- Module-table write policies gated on is_approved(), which is true for EVERY
-- approved user including 'viewer' — so a viewer (documented as read-only) could
-- insert/update/delete their own rows in any accessible project. This adds an
-- is_writer() helper (approved AND role <> 'viewer') and re-applies the module
-- tables' insert/update/delete policies to use it. Reads are unchanged.
--
-- Covers: the module tables (loop below), calendars, AND the cash_flow_* assumption/
-- derived tables (bottom block) — so a viewer can read every accessible project but
-- WRITE NOTHING anywhere. (The schedule/cost SUPPORT tables — cost_accounts,
-- activity_expenses, schedule_baselines/_snapshots/_audit, wbs_nodes, activity_code_*,
-- etc. — already write via is_planner(), which also excludes viewers.)
--
-- Idempotent + existence-guarded. Run in the Supabase SQL editor.
-- ============================================================================
create or replace function is_writer() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.status = 'approved' and u.role <> 'viewer');
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'progress_photos','ppr_presentations','ppr_slides',
    'issues_lessons','contracts_claims','risk_register',
    'stakeholder_map','drawing_register','material_submittal',
    'project_schedule','resource_loading','productivity_rates','cash_flow','s_curve',
    'resource_roles','resources','resource_assignments',
    'productivity_activities','productivity_entries'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;   -- table not present → skip
    execute format('drop policy if exists %I on %I', t || '_ins', t);
    execute format('create policy %I on %I for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id))', t || '_ins', t);
    execute format('drop policy if exists %I on %I', t || '_upd', t);
    execute format('create policy %I on %I for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id))', t || '_upd', t);
    execute format('drop policy if exists %I on %I', t || '_del', t);
    execute format('create policy %I on %I for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))', t || '_del', t);
  end loop;

  -- calendars uses named per-command policies (not the loop's <table>_ins/_upd/_del names).
  if to_regclass('public.calendars') is not null then
    drop policy if exists calendars_ins on calendars;
    create policy calendars_ins on calendars for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
    drop policy if exists calendars_upd on calendars;
    create policy calendars_upd on calendars for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id));
    drop policy if exists calendars_del on calendars;
    create policy calendars_del on calendars for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));
  end if;
end $$;

-- cash_flow_* assumption/derived tables: writes were is_approved() (a project-assigned viewer
-- could edit cash-flow assumptions / the rollup cache). Re-create their WRITE policies with
-- is_writer() so viewers write nothing anywhere. Reads (cash_flow_*_read) stay is_approved so
-- viewers can still view cash flow. Policy names are non-uniform, so map them explicitly.
do $$
declare
  pol text[] := array['cash_flow_settings_write','cash_flow_billing_milestones_write','cash_flow_dp_tranches_write','cash_flow_actuals_write','cash_flow_rollup_write','cash_flow_trade_write','cash_flow_scen_write'];
  tbl text[] := array['cash_flow_settings','cash_flow_billing_milestones','cash_flow_dp_tranches','cash_flow_actuals','cash_flow_rollup','cash_flow_trade_packages','cash_flow_scenarios'];
  i int;
begin
  for i in 1 .. array_length(pol, 1) loop
    if to_regclass('public.' || tbl[i]) is null then continue; end if;
    execute format('drop policy if exists %I on %I', pol[i], tbl[i]);
    execute format('create policy %I on %I for all using (is_writer() and can_access_project(project_id)) with check (is_writer() and can_access_project(project_id))', pol[i], tbl[i]);
  end loop;
end $$;


-- ==========================================================================
-- [063/142] 2026-07-22-schedule-rows-rpc.sql
-- ==========================================================================
-- One-call schedule fetch RPC (Project Schedule cold-load speedup)
-- ------------------------------------------------------------------------------------------------
-- Loading a big schedule was dominated by ~8 sequential keyset-paginated round-trips (measured:
-- ~8.9s for a 6k-activity project), because PostgREST caps each table read at 1000 rows. This
-- function returns ALL of a project's activity rows as a SINGLE jsonb array in ONE round-trip:
-- a SCALAR (jsonb) return is not subject to the max-rows cap, so the whole schedule comes back at
-- once. The client (modules/project-schedule) calls this first and falls back to keyset pagination
-- if the function is absent, so it is safe to deploy the client before or after this migration.
--
-- SECURITY INVOKER (the default) → the function runs as the CALLER, so Row-Level Security on
-- project_schedule still applies: a user only receives rows for projects they can access. Do NOT
-- change this to SECURITY DEFINER — that would bypass RLS and leak cross-project data.
--
-- Idempotent: create-or-replace + a re-granted execute privilege. Safe to run multiple times.

create or replace function public.schedule_rows(p_project_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from public.project_schedule t
  where t.project_id = p_project_id;
$$;

-- Logged-in app users authenticate via Supabase Auth, so their requests run as `authenticated`.
grant execute on function public.schedule_rows(text) to authenticated;


-- ==========================================================================
-- [064/142] 2026-07-23-schedule-builder.sql
-- ==========================================================================
-- ============================================================================
-- Schedule Builder sub-module — bottom-up / location-based schedule setup.
-- One config row per project (the whole builder state as jsonb). The generated
-- output is previewed in-module and will later be pushed into project_schedule.
-- Idempotent; safe to re-run.
-- ============================================================================

create table if not exists schedule_builder (
  project_id  text primary key references projects(id) on delete cascade,
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

alter table schedule_builder enable row level security;

grant select, insert, update, delete on schedule_builder to authenticated;

-- Project-scoped RLS (matches the 2026-07-21 project-scope convention):
--   read  = approved AND can access the project
--   write = writer role AND can access the project
drop policy if exists schedule_builder_read  on schedule_builder;
drop policy if exists schedule_builder_write on schedule_builder;

create policy schedule_builder_read on schedule_builder
  for select using ( can_access_project(project_id) );

create policy schedule_builder_write on schedule_builder
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );


-- ==========================================================================
-- [065/142] 2026-07-25-schedule-document-links.sql
-- ==========================================================================
-- ============================================================================
-- Migration: link the Drawing Register + Material Submittal Log to the
-- Project Schedule.
--
-- A drawing / material submittal is a PREREQUISITE for construction work: the
-- linked schedule activity's start date is the "need-by / required-on-site"
-- date, and (start − lead_days) is the date the document must be APPROVED by.
-- That drives the register's planned-approval field automatically, and any
-- activity whose enabling documents aren't approved by their need-by date is a
-- schedule-readiness risk.
--
-- LINK TARGET = project_schedule.activity_id (the P6/business key), NOT the row
-- uuid. Schedule re-imports (P6/XER "Replace") delete + re-insert every row, so
-- the uuid changes each time while activity_id (e.g. A1010) is stable — the link
-- survives a re-import. Stored as plain text scoped by project_id; no FK, since
-- the schedule row may not exist yet at link time and must not block the write.
--
-- Run in the Supabase SQL editor. Idempotent. RLS/grants unchanged (both are
-- existing module tables — adding columns doesn't alter either).
-- ============================================================================

-- ---- Drawing Register ------------------------------------------------------
alter table drawing_register add column if not exists schedule_activity_id text;
-- Optional coarser link: a WBS code, when a drawing enables a whole trade/zone
-- rather than one activity. activity link wins when both are set.
alter table drawing_register add column if not exists schedule_wbs text;
-- Approval-before-start lead time (days). NULL falls back to the project default
-- (drawings typically approved ~30 days before the work they enable).
alter table drawing_register add column if not exists lead_days int;

create index if not exists drawing_register_sched_act_idx
  on drawing_register (project_id, schedule_activity_id);

comment on column drawing_register.schedule_activity_id is
  'Links to project_schedule.activity_id (business key, survives re-import). '
  'The activity''s start is the drawing''s need-by date.';
comment on column drawing_register.lead_days is
  'Days the drawing must be approved BEFORE the linked activity starts. '
  'NULL = project default (~30). required_approval = activity_start − lead_days.';

-- ---- Material Submittal Log ------------------------------------------------
alter table material_submittal add column if not exists schedule_activity_id text;
alter table material_submittal add column if not exists schedule_wbs text;
alter table material_submittal add column if not exists lead_days int;

create index if not exists material_submittal_sched_act_idx
  on material_submittal (project_id, schedule_activity_id);

comment on column material_submittal.schedule_activity_id is
  'Links to project_schedule.activity_id (business key, survives re-import). '
  'The activity''s start is the submittal''s need-by date.';
comment on column material_submittal.lead_days is
  'Days the material must be approved BEFORE the linked activity starts '
  '(procurement + delivery lead). NULL = project default (~45). '
  'required_approval = activity_start − lead_days.';


-- ==========================================================================
-- [066/142] 2026-07-26-realtime-collab-material-submittal.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for the Material Submittal Log (PDCollab).
--
-- Companion to 2026-07-26-realtime-collab.sql (drawing_register) and
-- 2026-07-26-realtime-collab-project-schedule.sql. Wires live-value streaming
-- for material_submittal: another user saves / bulk-updates a submittal → every
-- other open client patches its log live.
--
-- Presence (who's here) + the "who's editing this submittal" cursor need NO
-- server change — only this live-value stream does. RLS still applies to
-- Realtime, so a client only receives changes for rows it can already SELECT.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'material_submittal'
  ) then
    execute 'alter publication supabase_realtime add table public.material_submittal';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id, which the client subscription filters on (project_id=eq.<pid>).
alter table public.material_submittal replica identity full;


-- ==========================================================================
-- [067/142] 2026-07-26-realtime-collab-progress-photos.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for Progress Photos (PDCollab).
--
-- Companion to 2026-07-26-realtime-collab.sql (drawing_register),
-- 2026-07-26-realtime-collab-project-schedule.sql,
-- 2026-07-26-realtime-collab-material-submittal.sql and
-- 2026-07-26-realtime-collab-registers.sql. Wires live-value streaming for
-- progress_photos: another user uploads / edits / deletes a photo → every other
-- open client patches its gallery live (the new photo's preview is signed on the
-- change; images themselves still need a connection).
--
-- Presence (who's here) + the "who's editing this photo" cursor need NO server
-- change — only this live-value stream does. RLS still applies to Realtime, so a
-- client only receives changes for rows it can already SELECT.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'progress_photos'
  ) then
    execute 'alter publication supabase_realtime add table public.progress_photos';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id, which the client subscription filters on (project_id=eq.<pid>).
alter table public.progress_photos replica identity full;


-- ==========================================================================
-- [068/142] 2026-07-26-realtime-collab-project-schedule.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for the Project Schedule (PDCollab).
--
-- Companion to 2026-07-26-realtime-collab.sql (which did drawing_register).
-- Wires live-value streaming for project_schedule: another user saves an
-- activity → every other open client patches its grid live.
--
-- Presence (who's here) + cursor broadcast (which cell someone edits) need NO
-- server change — only this live-value stream does. RLS still applies to
-- Realtime, so a client only receives changes for rows it can already SELECT.
--
-- NOTE ON SCALE: project_schedule is large (tens of thousands of rows) and P6/XER
-- imports insert ~40k rows at once. That fans out as ~40k change events; the
-- client COALESCES them and, past a threshold, does ONE reload instead of
-- per-row patching (see the module's _flushCollab storm guard). So this is safe,
-- but do not add REPLICA IDENTITY FULL to other high-write tables unless their
-- module actually consumes the stream.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_schedule'
  ) then
    execute 'alter publication supabase_realtime add table public.project_schedule';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id, which the client subscription filters on (project_id=eq.<pid>).
-- The default (primary key only) omits project_id, so filtered UPDATE/DELETE
-- events would never reach the subscriber. (INSERTs are unaffected — the new row
-- is always sent in full.)
alter table public.project_schedule replica identity full;


-- ==========================================================================
-- [069/142] 2026-07-26-realtime-collab-registers.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for the modal-edit registers (PDCollab).
--
-- Companion to the drawing_register / project_schedule / material_submittal
-- realtime migrations. Wires the live-value stream (another user saves → my grid
-- updates) for the four modal-edit registers:
--   risk_register, issues_lessons, contracts_claims, stakeholder_map
--
-- Presence (who's here) + the "who's editing this row" cursor need NO server
-- change — only this live-value stream does. RLS still applies to Realtime, so a
-- client only receives changes for rows it can already SELECT.
--
-- (resource-loading is intentionally NOT here: it's low-traffic master data wired
-- for presence + offline only, with no live-value stream — so its tables
-- resources / resource_roles / calendars are left out on purpose.)
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['risk_register','issues_lessons','contracts_claims','stakeholder_map']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    -- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry project_id (the client
    -- filter is project_id=eq.<pid>); the default (PK only) omits it.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;


-- ==========================================================================
-- [070/142] 2026-07-26-realtime-collab.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for live collaboration (PDCollab).
--
-- Presence (who's here) and cursor broadcast (which cell someone is editing)
-- work with NO server change — they ride the Realtime websocket directly.
-- Only the LIVE-VALUE stream (postgres_changes: another user saved → my grid
-- updates) needs the table added to the `supabase_realtime` publication.
--
-- RLS still applies to Realtime: a client only receives change events for rows
-- it is already allowed to SELECT, so this exposes nothing new.
--
-- Scope: drawing_register only — the proving ground for the shared collab layer.
-- Extend to project_schedule / material_submittal / risk_register / etc. as each
-- module is wired (one `add table` + `replica identity full` per table). NOTE:
-- project_schedule is a very high-row, high-write table, so only add it when its
-- collaboration is actually built (REPLICA IDENTITY FULL adds a little WAL per
-- UPDATE) — not preemptively.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'drawing_register'
  ) then
    execute 'alter publication supabase_realtime add table public.drawing_register';
  end if;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE change payloads carry every column —
-- including project_id, which the client subscription filters on
-- (filter: project_id=eq.<pid>). The default (primary key only) omits project_id,
-- so a filtered DELETE/UPDATE would never reach the subscriber.
alter table public.drawing_register replica identity full;


-- ==========================================================================
-- [071/142] 2026-07-27-realtime-collab-cash-flow.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for Cash Flow (PDCollab).
--
-- Cash Flow is a DERIVED projection whose editable inputs live across several
-- tables. Streaming these lets a co-editor's saved assumptions recompute every
-- other open client's projection live.
--
--   • cash_flow_settings        — the assumptions row (per project)
--   • cash_flow_actuals         — recorded real cash movements
--   • cash_flow_dp_tranches     — downpayment tranches
--   • cash_flow_trade_packages  — per-trade cash-in split
--
-- Presence (who's here) + the avatar "editing" indicator need NO server change —
-- only this live-value stream does. RLS still applies to Realtime.
--
-- (S-Curve reuses project_schedule, covered by
-- 2026-07-26-realtime-collab-project-schedule.sql. Portfolio Overview is
-- presence-only — no table stream, no migration.)
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'cash_flow_settings', 'cash_flow_actuals', 'cash_flow_dp_tranches', 'cash_flow_trade_packages'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;   -- skip if the table isn't created yet
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute 'alter publication supabase_realtime add table public.' || t;
    end if;
    execute 'alter table public.' || t || ' replica identity full';
  end loop;
end $$;


-- ==========================================================================
-- [072/142] 2026-07-27-realtime-collab-productivity-rates.sql
-- ==========================================================================
-- ============================================================================
-- Migration: enable Supabase Realtime for Productivity Rates (PDCollab).
--
-- Companion to the other 2026-07-26 realtime-collab migrations. This module
-- spans TWO tables, so BOTH are streamed: another user adds/edits an activity
-- or its monthly entries → every other open client patches its register +
-- monitoring live.
--
-- Presence (who's here) + the "who's editing this activity" cursor need NO
-- server change — only this live-value stream does. RLS still applies to
-- Realtime, so a client only receives changes for rows it can already SELECT.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['productivity_activities', 'productivity_entries'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute 'alter publication supabase_realtime add table public.' || t;
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE payloads carry every column — including
-- project_id (the subscription filter) and, for entries, activity_id (needed to
-- locate the row's bucket client-side on DELETE).
alter table public.productivity_activities replica identity full;
alter table public.productivity_entries    replica identity full;


-- ==========================================================================
-- [073/142] 2026-08-03-wbs-skeleton.sql
-- ==========================================================================
-- ============================================================================
-- Migration: auto-generated WBS skeleton support.
-- Adds two columns to wbs_nodes so the Project Schedule module can seed a fixed
-- outline (Milestones / Initiation / Planning [Project Execution Plan / Design
-- Development / Procurement] / Execution) on a project's first load:
--   is_locked   — a skeleton heading: can't be renamed, recoded, moved, or deleted.
--   source_kind — a "special" heading whose contents come from ANOTHER module,
--                 not manual activities ('design_development' | 'procurement').
--                 Blocks "+ Add activity" / "+ Add WBS" under it.
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table wbs_nodes add column if not exists is_locked boolean default false;
alter table wbs_nodes add column if not exists source_kind text;


-- ==========================================================================
-- [074/142] 2026-08-04-activity-location-work-type.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Location Breakdown Structure (LBS) + work type on schedule activities.
--
-- WHY: location/zone previously existed ONLY as WBS tree structure, so the tree was
-- the one and only way to group a schedule (Location > Zone > Activity). Storing them
-- as activity DATA lets the grid group in any order — notably Activity > Location >
-- Zone — without touching the WBS tree.
--
-- SHAPE: the levels are per-project and configurable (Building / Level / Zone / Unit /
-- whatever a project uses), so this is an ordered list of LEVELS plus a compact jsonb
-- value map on each activity keyed by level id:
--     project_schedule.location = { "<location_level_id>": "Tower A", ... }
-- That is deliberately the SAME shape as activity_codes (a jsonb map keyed by a
-- definition-table id, not a join table), so the module's existing dynamic-column,
-- filter and grouping machinery applies to it unchanged.
--
-- ⚠️ Values are plain text per level, NOT a node tree. Zone "Z1" under two different
-- locations is the same string — they stay separate because grouping NESTS Zone under
-- Location. Grouping by Zone alone deliberately merges them ("everything in Z1").
--
-- RLS is project-scoped from the start (the 2026-07-21 fix pattern), not the older
-- un-scoped is_approved()/is_planner() shape that had to be corrected later.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists location_levels (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists location_levels_project_idx on location_levels(project_id, sort_order);

alter table project_schedule add column if not exists location jsonb default '{}'::jsonb;
alter table project_schedule add column if not exists work_type text;

-- Grouping/filtering by work type scans this column on 17k–40k-row schedules.
create index if not exists project_schedule_work_type_idx on project_schedule(project_id, work_type);

alter table location_levels enable row level security;
drop policy if exists location_levels_read on location_levels;
create policy location_levels_read on location_levels
  for select using (can_access_project(project_id));
drop policy if exists location_levels_write on location_levels;
create policy location_levels_write on location_levels
  for all using (is_planner() and can_access_project(project_id))
  with check (is_planner() and can_access_project(project_id));
grant select, insert, update, delete on location_levels to authenticated;


-- ==========================================================================
-- [075/142] 2026-08-05-drawing-register-sheets.sql
-- ==========================================================================
-- ============================================================================
-- Drawing Register — per-sheet tracking matrix.
--
-- A drawing may be broken out into one row PER SHEET. A sheet is an ordinary
-- `drawing_register` row (node_kind='drawing', no_of_sheets=1) that points at its
-- parent drawing via `parent_id`. The parent keeps the things that belong to the
-- whole drawing — the single planned approval date, the schedule link, the title
-- — and its sheet counters (no_of_sheets / approved_sheets / approved_pct /
-- actual_approval) become DERIVED roll-ups over its children, written back by the
-- app so every existing consumer (Overview KPIs, progress tables, export, backlog)
-- keeps working unchanged.
--
-- Aggregate mode is unaffected: a drawing with NO children is exactly what it was
-- before — one row carrying no_of_sheets=100 / approved_sheets=37 by hand. Which
-- mode a drawing uses is per drawing, chosen by the Technical Officer.
--
-- Idempotent — safe to re-run.
-- ============================================================================

alter table drawing_register
  add column if not exists parent_id uuid references drawing_register(id) on delete cascade;

-- The grid looks children up by parent on every render, and the cascade above
-- means a parent delete scans this too.
create index if not exists drawing_register_parent_idx
  on drawing_register (parent_id);

comment on column drawing_register.parent_id is
  'Sheet rows point at their parent drawing. NULL = a normal drawing (or a structural node).';


-- ==========================================================================
-- [076/142] 2026-08-05-location-level-match.sql
-- ==========================================================================
-- ============================================================================
-- Migration: remember which WBS names a planner matched to each location level.
--
-- WHY: the Location Wizard lets a planner state "the WBS node 'Ground Floor' IS
-- the Level 'Ground Floor'", "'Tower D - Substructure' IS the Tower 'Tower D'".
-- Without somewhere to keep that, the matching is a one-shot action that has to
-- be redone by hand after every re-import — and a re-import is exactly when it
-- is needed. Storing it makes the mapping a reusable, editable project asset,
-- and lets a later import apply the same matching automatically.
--
-- SHAPE: one jsonb map per level, keyed by the WBS node NAME as written in the
-- schedule, valued by the location value to write:
--     location_levels.match = { "Tower D - Substructure": "Tower D",
--                               "Tower D - Superstructure": "Tower D" }
-- Keyed by NAME, not by wbs node id, deliberately: the same name recurs under
-- every tower and trade (Avesta's "9th Floor" sits under 7 towers × 3 trades),
-- so matching by name is one decision instead of twenty-one, and it survives a
-- re-import that renumbers every node id.
--
-- ⚠️ Tolerant by design: the app treats a missing column as "no saved matching"
-- and still applies the wizard's result, so this migration is not a hard
-- prerequisite for the feature — only for remembering it.
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table location_levels add column if not exists match jsonb default '{}'::jsonb;

-- No index: the map is read with the level rows themselves (a handful per
-- project) and is never queried by its contents.


-- ==========================================================================
-- [077/142] 2026-08-10-progress-photos-schedule-integration.sql
-- ==========================================================================
-- ============================================================================
-- Progress Photos — Schedule App integration (Phase 1)
-- ----------------------------------------------------------------------------
-- Locations are no longer a separate hand-maintained list: the picker in the
-- module now reads live from Project Schedule's `wbs_nodes` tree (already
-- shared in this same Supabase project — no new API, just a cross-module
-- read). This adds the columns needed to REFERENCE a zone rather than copy it:
--   - wbs_node_id : FK into wbs_nodes. `on delete set null` deliberately —
--     deleting a schedule zone must not delete photos captured there.
--   - activity_id / activity_name : a SNAPSHOT of the schedule activity that
--     was "current" for that zone at capture time (e.g. "Rebar Installation").
--     Deliberately NOT a live join — reports must keep showing what was true
--     when the photo was taken, even if the schedule activity later finishes
--     or is renamed. This mirrors the bl_cost / schedule_baselines snapshot
--     convention already used elsewhere in this app.
-- `location` (existing text column) is kept as the display cache — auto-filled
-- from the zone's breadcrumb when one is picked, but still free-text so a
-- photo that isn't tied to any schedule zone (site-wide shots, signage, etc.)
-- can still be tagged. This is intentional per MODULE_CONTRACT §6 (reference
-- the schedule app's data, don't force everything to be tracked).
--
-- Idempotent / safe to re-run.
-- ============================================================================

alter table progress_photos add column if not exists wbs_node_id uuid references wbs_nodes(id) on delete set null;
alter table progress_photos add column if not exists activity_id text;
alter table progress_photos add column if not exists activity_name text;

create index if not exists progress_photos_wbs_node_idx on progress_photos(project_id, wbs_node_id);

-- No RLS change needed: progress_photos' existing per-project policies already
-- cover the new columns, and wbs_nodes/activity_code_types/activity_code_values
-- are already readable by any approved user (is_approved()) per their own
-- policies — same as every other module that cross-reads the schedule.


-- ==========================================================================
-- [078/142] 2026-08-11-drawing-register-scope.sql
-- ==========================================================================
-- Drawing Register: Scope column (Main Contract / Change Order).
-- Idempotent. Existing rows default to 'Main Contract' (the common case; nothing
-- was previously tracked as a Change Order, so this is not a guess that could be wrong).

alter table drawing_register add column if not exists scope text not null default 'Main Contract';

-- Keep any legacy nulls (rows written before the column existed on an old cached
-- client) aligned with the default.
update drawing_register set scope = 'Main Contract' where scope is null;


-- ==========================================================================
-- [079/142] 2026-08-11-fix-privilege-escalation.sql
-- ==========================================================================
-- ============================================================================
-- SECURITY FIX — privilege escalation via the users UPDATE policy
-- Planners Dashboard (bgupuqnkqhixpuctyder)                        2026-08-11
-- ----------------------------------------------------------------------------
-- Idempotent. Safe to re-run. Rollback at the bottom.
--
-- THE HOLE
-- Any approved user can make themselves super_admin with a single request:
--
--     await getSB().from('users').update({ role: 'super_admin' }).eq('id', myUid);
--
-- That grants every project, the Administration screen, and (in the Engineering
-- App) approval authority. It also works for `status` and `projects`.
--
-- CAUSE — the policy in supabase-schema.sql:559
--
--     create policy users_admin_update on users for update
--       using (auth.uid() = id or is_admin());
--
-- The `auth.uid() = id` branch is legitimate and necessary: users update their
-- own `name`, and db.js writes `last_login` on every sign-in. But the policy has
--   • no WITH CHECK clause, and
--   • no restriction on WHICH COLUMNS may change,
-- so "update your own row" silently included "update your own role".
--
-- WHY A TRIGGER AND NOT A BETTER POLICY
-- An RLS WITH CHECK expression is evaluated against the NEW row only — it cannot
-- see OLD, so it cannot express "role must not have changed". Postgres has no
-- column-level RLS. A BEFORE UPDATE trigger is the correct mechanism.
--
-- ⚠️ THIS SAME FIX IS ALREADY RUNNING IN PRODUCTION on the Engineering App
-- (zkxzaijznutmiueeurbb), migrations 0005 + 0006, where it was verified by
-- demoting a real account and confirming: escalation refused with 42501, while
-- admin user-management through admin.html still worked. The logic below is that
-- code with both lessons already folded in.
--
-- ============================================================================
-- COMPATIBILITY REVIEW — every existing write to `users` was checked first
-- ----------------------------------------------------------------------------
--   assets/js/auth.js  register()      inserts role='user', status='pending',
--                                      projects='{}'          → allowed by §2
--   assets/js/auth.js  ensureProfile() same three values       → allowed by §2
--   assets/js/db.js    updateUser()    admin.html only, is_admin() → exempt
--   assets/js/db.js    updateLastLogin() touches only last_login → unaffected,
--                        which matters: it runs for EVERY user on EVERY login
--   admin_delete_project() / admin_archive_project()
--                      `update users set projects = array_remove(...)`, but both
--                      begin with `if not is_admin() then raise exception`, so the
--                      caller is always an admin → exempt
--   auth.js isAutoApprove() is exported but never used to WRITE a status, so no
--                      client path self-assigns 'approved'
--
-- Nothing in the app changes behaviour. Only self-escalation stops working.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Block a non-admin changing their own privileges
-- ---------------------------------------------------------------------------
create or replace function users_guard_self_escalation() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() IS NULL = a trusted server-side session: the Supabase SQL editor,
  -- a service_role call, psql, a scheduled job. Those must stay able to
  -- administer, otherwise the documented bootstrap
  --     update users set role='super_admin' where email='…';
  -- stops working and a locked-out project becomes unrecoverable. (The Engineering
  -- App hit exactly that; it took a follow-up migration to undo.)
  --
  -- Not a new hole: the `anon` role also has no JWT, but anon never reaches this
  -- trigger — users_admin_update requires (auth.uid() = id or is_admin()), both
  -- false for anon, so RLS rejects the statement before any trigger fires. This
  -- guard stops a SIGNED-IN user escalating; RLS is what stops untrusted callers.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'You may not change your own role.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'You may not change your own account status.' using errcode = '42501';
  end if;
  if new.projects is distinct from old.projects then
    raise exception 'You may not change your own project assignments.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'You may not change a profile id.' using errcode = '42501';
  end if;

  return new;
end $$;

-- ⚠️ Plain BEFORE UPDATE, deliberately NOT `before update of role, status, …`.
-- An `UPDATE OF <cols>` trigger fires only when those columns appear in the SET
-- list, which makes the protection depend on how the client phrases its request.
-- For a security guard that is the wrong trade: always fire, then compare. (The
-- Engineering App's approval guard was written the other way and did not fire.)
drop trigger if exists users_guard_self_escalation on users;
create trigger users_guard_self_escalation
  before update on users
  for each row execute function users_guard_self_escalation();


-- ---------------------------------------------------------------------------
-- 2. Block a self-registration declaring itself pre-approved
-- ---------------------------------------------------------------------------
-- users_self_insert only checks `auth.uid() = id`, so a new registration could
-- self-declare role='super_admin', status='approved'. auth.js always sends
-- user/pending — but nothing enforced it, and the client is not the authority.
create or replace function users_guard_self_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if new.role is distinct from 'user' or new.status is distinct from 'pending'
     or coalesce(array_length(new.projects, 1), 0) <> 0 then
    raise exception
      'A new account must be created as role=user, status=pending with no '
      'project assignments; an administrator grants access afterwards.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists users_guard_self_insert on users;
create trigger users_guard_self_insert
  before insert on users
  for each row execute function users_guard_self_insert();


-- ============================================================================
-- 3. VERIFY — do this, do not assume
-- ----------------------------------------------------------------------------
-- (a) Triggers installed and enabled ('O'):
--
--     select tgrelid::regclass as tbl, tgname, tgenabled
--     from pg_trigger
--     where not tgisinternal and tgname like 'users_guard%';
--
-- (b) The SQL editor can still administer (this must SUCCEED — if it raises,
--     the auth.uid() exemption is not working and you must roll back):
--
--     update users set role = 'planner'  where email = 'YOUR_TEST_ACCOUNT';
--     update users set role = 'planner'  where email = 'YOUR_TEST_ACCOUNT';  -- idempotent
--
-- (c) From the browser as a NON-ADMIN account (have an admin demote a test
--     account, or use a `user`/`planner` account) — all must be REFUSED 42501:
--
--     await getSB().from('users').update({ role:'super_admin' }).eq('id', myUid);
--     await getSB().from('users').update({ status:'approved'  }).eq('id', myUid);
--     await getSB().from('users').update({ projects:['AVR101'] }).eq('id', myUid);
--
--     …and these must still WORK:
--     await getSB().from('users').update({ name:'New Name' }).eq('id', myUid);
--     // plus: sign out and back in — last_login must still be written
--
-- (d) As an ADMIN, through admin.html — all must still work:
--       change someone's role, approve/reject an account, assign projects,
--       delete a user, archive and delete a project.
--
-- (e) Registration end to end: request access with a fresh email, confirm the
--     new row is role=user / status=pending, then approve it in admin.html.
-- ============================================================================


-- ============================================================================
-- ROLLBACK — if anything above misbehaves, this fully reverts the change.
-- The triggers are additive; dropping them restores the previous behaviour
-- exactly (including, deliberately, the escalation hole).
-- ----------------------------------------------------------------------------
--   drop trigger if exists users_guard_self_escalation on users;
--   drop trigger if exists users_guard_self_insert     on users;
--   drop function if exists users_guard_self_escalation();
--   drop function if exists users_guard_self_insert();
-- ============================================================================


-- ==========================================================================
-- [080/142] 2026-08-12-delete-project-residue.sql
-- ==========================================================================
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


-- ==========================================================================
-- [081/142] 2026-08-12-group-heads-replace-workspaces.sql
-- ==========================================================================
-- ============================================================================
-- Migration: replace the Workspace → Program → Group tree with a flat
--            GROUP HEAD tag on each project.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY: the tree was three levels deep to express one fact — which group head
-- owns the project. Every consumer (dashboard caption, portfolio grouping,
-- project selector) ultimately resolved the tree back down to `group_head`,
-- so the tree was ceremony around a single tag. This collapses it.
--
-- ⚠️ DESTRUCTIVE at the end: it drops `projects.workspace_id`, `projects.
-- group_head` (text) and the `workspaces` table. Everything they carried is
-- backfilled into `projects.group_head_id` FIRST, in the same transaction-safe
-- order, and step 9 refuses to drop if any project would lose its group head.
-- ============================================================================

-- ---- 1) The lookup table ---------------------------------------------------
-- A tag, not a tree. `active=false` retires a group head without breaking the
-- projects that still reference it (history stays readable).
create table if not exists group_heads (
  id          text primary key,          -- short code, e.g. 'CALIMAG'
  name        text not null,             -- display name, e.g. 'Calimag Group'
  sort_order  int  default 0,
  active      boolean default true,
  created_at  timestamptz default now()
);

create unique index if not exists group_heads_name_idx on group_heads (lower(name));

-- ---- 2) Seed from the retired workspace tree's group nodes ----------------
insert into group_heads (id, name, sort_order) values
  ('CALIMAG',  'Calimag Group',   0),
  ('RODRIN',   'Rodrin Group',    1),
  ('RONQUILLO','Ronquillo Group', 2),
  ('TAN',      'Tan Group',       3),
  ('FLORES',   'Flores Group',    4)
on conflict (id) do nothing;

-- ---- 3) The new column on projects ----------------------------------------
alter table projects add column if not exists group_head_id text references group_heads(id);
create index if not exists projects_group_head_idx on projects (group_head_id);

-- ---- 4) Backfill: the project's OWN group_head text wins -------------------
-- Matched case-insensitively on name, because the text column was free-form.
update projects p
   set group_head_id = g.id
  from group_heads g
 where p.group_head_id is null
   and p.group_head is not null
   and lower(trim(p.group_head)) = lower(g.name);

-- ---- 5) Backfill: otherwise inherit from the workspace ancestry ------------
-- Same rule the app used: walk up from the project's workspace node and take
-- the first ancestor carrying a group_head. Guarded so this file still runs on
-- a database where `workspaces` was already dropped.
do $$
begin
  if to_regclass('public.workspaces') is not null then
    with recursive up as (
      select p.id as project_id, w.id as node_id, w.parent_id, w.group_head, 0 as depth
        from projects p
        join workspaces w on w.id = p.workspace_id
       where p.group_head_id is null
      union all
      select u.project_id, w.id, w.parent_id, w.group_head, u.depth + 1
        from up u
        join workspaces w on w.id = u.parent_id
       where u.group_head is null
    ),
    resolved as (
      select distinct on (project_id) project_id, group_head
        from up
       where group_head is not null
       order by project_id, depth
    )
    update projects p
       set group_head_id = g.id
      from resolved r
      join group_heads g on lower(trim(r.group_head)) = lower(g.name)
     where p.id = r.project_id
       and p.group_head_id is null;
  end if;
end $$;

-- ---- 6) Any group-head NAME that existed but has no lookup row ------------
-- Adopt it rather than dropping it on the floor. Code = uppercased first word,
-- de-duplicated with a suffix if it collides.
do $$
declare r record; base text; cand text; n int;
begin
  for r in
    select distinct trim(group_head) as gh
      from projects
     where group_head_id is null and coalesce(trim(group_head), '') <> ''
  loop
    base := upper(regexp_replace(split_part(r.gh, ' ', 1), '[^A-Za-z0-9]', '', 'g'));
    if base = '' then base := 'GROUP'; end if;
    cand := base; n := 1;
    while exists (select 1 from group_heads where id = cand) loop
      n := n + 1; cand := base || n::text;
    end loop;
    insert into group_heads (id, name, sort_order)
      values (cand, r.gh, 90) on conflict do nothing;
    update projects set group_head_id = cand
     where group_head_id is null and trim(group_head) = r.gh;
  end loop;
end $$;

-- ---- 7) RLS + grants -------------------------------------------------------
alter table group_heads enable row level security;

-- Org structure, not project data — every approved user reads it.
drop policy if exists group_heads_read on group_heads;
create policy group_heads_read on group_heads for select using (is_approved());

drop policy if exists group_heads_write on group_heads;
create policy group_heads_write on group_heads for all
  using (is_planner()) with check (is_planner());

grant select, insert, update, delete on group_heads to authenticated;

-- ---- 8) Refuse the delete of a group head still in use ---------------------
-- Mirrors admin_delete_project's "name what's blocking" behaviour so the admin
-- sees why, instead of a bare FK violation.
create or replace function admin_delete_group_head(target text)
  returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then
    raise exception 'Only an admin can delete a group head.';
  end if;
  select count(*) into n from projects where group_head_id = target;
  if n > 0 then
    raise exception 'Cannot delete: % project(s) are still assigned to this group head. Reassign them first, or set the group head inactive.', n;
  end if;
  delete from group_heads where id = target;
end $$;

revoke all on function admin_delete_group_head(text) from public;
grant execute on function admin_delete_group_head(text) to authenticated;

-- ---- 9) Drop the tree ------------------------------------------------------
-- Guarded: if any project still carries a group head that did NOT make it into
-- group_head_id, stop with a readable error instead of destroying the source.
do $$
declare lost int;
begin
  select count(*) into lost
    from projects
   where group_head_id is null and coalesce(trim(group_head), '') <> '';
  if lost > 0 then
    raise exception 'Aborting drop: % project(s) have a group_head that was not migrated. Fix them, then re-run.', lost;
  end if;
end $$;

drop function if exists admin_delete_workspace(text);

alter table projects drop column if exists workspace_id;
alter table projects drop column if exists group_head;

drop table if exists workspaces;

-- Done. Projects now carry one Group Head tag; the workspace tree is gone.


-- ==========================================================================
-- [082/142] 2026-08-12-progress-photos-location-breakdown.sql
-- ==========================================================================
-- ============================================================================
-- Progress Photos — switch from wbs_nodes to Project Schedule's real
-- "Location Breakdown" (location_levels + project_schedule.location)
-- ----------------------------------------------------------------------------
-- Correction: wbs_nodes is the general WBS tree (phases, disciplines, work
-- packages, …) — Project Schedule itself deliberately does NOT use it for
-- physical location, precisely because conflating the two was a past mistake
-- (see modules/project-schedule/CLAUDE.md's 2026-08-04 entry: "location and
-- zone existed only as WBS tree structure... Fix = make them activity data").
-- The real location system is `location_levels` (per-project, ordered,
-- free-form level names like Tower/Level/Zone — migrations/2026-08-04-*.sql)
-- plus a `location` jsonb on each `project_schedule` row, keyed by level id,
-- always a plain string value — NOT a node tree.
--
-- progress_photos mirrors that exact shape rather than inventing a new one:
--   location_values jsonb = { "<location_level_id>": "value string", ... }
-- (same convention as project_schedule.location and activity_codes).
--
-- wbs_node_id / activity_id / activity_name are UNCHANGED and NOT migrated —
-- wbs_node_id simply stops being written by new captures (kept nullable for
-- any already-saved rows); activity_id/activity_name keep meaning exactly
-- what they always did (a snapshot of the "current" activity at capture
-- time), just resolved by matching location_values instead of a WBS node.
--
-- Idempotent / safe to re-run.
-- ============================================================================

alter table progress_photos add column if not exists location_values jsonb default '{}'::jsonb;

-- No RLS change needed: progress_photos' existing per-project policies already
-- cover the new column, and location_levels is already readable by any
-- approved user with project access (can_access_project()) per its own
-- policy — same cross-module read pattern already used for wbs_nodes.


-- ==========================================================================
-- [083/142] 2026-08-12-schedule-project-phase.sql
-- ==========================================================================
-- ============================================================================
-- Migration: project PHASE (Initiation / Planning / Construction / Close-out)
--            as a tag on schedule activities and WBS nodes.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY a tag and not four seeded WBS roots: the WBS is already the file's own
-- structure (P6/OPC imports bring their own tree, and the locked skeleton has
-- its own shape). Forcing four roots would reshuffle every existing schedule.
-- A tag composes with the N-level grouping engine instead — Phase becomes just
-- another dimension you can group, filter and roll up by, exactly like
-- Location, Work Type and Work Package.
-- ============================================================================

-- ---- 1) The column ---------------------------------------------------------
-- Nullable on purpose: an untagged activity is "not yet classified", which is
-- the honest state for every row that already exists. It buckets into
-- "— No phase —" in the grid rather than being silently called Construction.
alter table project_schedule add column if not exists phase text;
alter table wbs_nodes       add column if not exists phase text;

-- ---- 2) Constrain the vocabulary ------------------------------------------
-- Four phases, fixed. A free-text phase fragments the grouping the same way a
-- free-text group head would — and this one drives roll-ups, so a typo would
-- silently split a project's S-curve in two.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_phase_chk') then
    alter table project_schedule add constraint project_schedule_phase_chk
      check (phase is null or phase in ('initiation','planning','construction','closeout'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_phase_chk') then
    alter table wbs_nodes add constraint wbs_nodes_phase_chk
      check (phase is null or phase in ('initiation','planning','construction','closeout'));
  end if;
end $$;

create index if not exists project_schedule_phase_idx on project_schedule (project_id, phase);
create index if not exists wbs_nodes_phase_idx        on wbs_nodes (project_id, phase);

-- ---- 3) Seed from the locked WBS skeleton ---------------------------------
-- The skeleton already names these branches, so the first classification is
-- free and correct. Name-matched (not id-matched) because the skeleton nodes
-- are created per project. Only fills NULLs — never overwrites a planner's tag.
update wbs_nodes set phase = 'initiation'
 where phase is null and lower(name) like '%initiation%';

update wbs_nodes set phase = 'planning'
 where phase is null and lower(name) like '%planning phase%';

update wbs_nodes set phase = 'construction'
 where phase is null and (lower(name) like '%execution phase%' or lower(name) like '%construction%');

update wbs_nodes set phase = 'closeout'
 where phase is null and (lower(name) like '%close-out%' or lower(name) like '%closeout%'
                       or lower(name) like '%close out%');

-- ---- 4) Cascade the seeded node phase down to its activities --------------
-- An activity inherits the nearest tagged ancestor. Done once here so existing
-- schedules arrive already classified; from then on the app resolves inheritance
-- at read time, so re-parenting a branch doesn't need a data migration.
with recursive tree as (
  select id, project_id, parent_id, phase, phase as eff
    from wbs_nodes where parent_id is null
  union all
  select c.id, c.project_id, c.parent_id, c.phase, coalesce(c.phase, t.eff)
    from wbs_nodes c join tree t on c.parent_id = t.id
)
update project_schedule ps
   set phase = t.eff
  from tree t
 where ps.wbs_node_id = t.id
   and ps.phase is null
   and t.eff is not null;

-- Done. Group / filter / roll up the schedule by Phase.


-- ==========================================================================
-- [084/142] 2026-08-19-department-issues.sql
-- ==========================================================================
-- ============================================================================
-- Migration: (D1) DEPARTMENTS CAN RAISE ISSUES.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHAT THE AUDIT ACTUALLY FOUND, WHICH IS NOT WHAT THE REQUIREMENT ASSUMED.
--    "Departments can also add issues" reads like a permission that needs opening
--    up. It is not: `issues_lessons` is covered by the standard module-table
--    policy `for all using (is_writer() and can_access_project(project_id))`, and
--    `is_writer()` is "approved AND role <> 'viewer'" — so the `user` role could
--    ALREADY insert. The block was in the UI, which gated every write on
--    planner/admin/super_admin.
--
--    But the same policy is also too LOOSE in the other direction: it lets any
--    approved non-viewer UPDATE or DELETE *anyone else's* issue. Nobody intended
--    a department to be able to rewrite another department's entry, and once the
--    UI is opened up that stops being theoretical.
--
--    So this migration WIDENS nothing at the DB and TIGHTENS the write side:
--      insert  — any approved non-viewer, on a project they can access, and only
--                stamped as themselves.
--      update  — planner+ on anything; everyone else only their OWN rows.
--      delete  — planner+ only. A department raising an issue must not be able to
--                make it disappear; closing it is a status, and the record of a
--                problem having existed is the point of a register.
-- ============================================================================

-- ---- 1) The submitter's department ----------------------------------------
-- ⚠️ On `users`, not typed per issue. A department is a property of the PERSON
-- raising the issue; asking them to pick it every time invites a typo that
-- silently fragments the register's own Department filter — the same failure the
-- group_heads lookup exists to prevent. The issue keeps its own `department`
-- column (it is what the register groups by), defaulted from the profile.
alter table users add column if not exists department text;

-- ---- 2) The register's own write rules ------------------------------------
-- Replaces the generic loop policy for THIS table only; every other module table
-- keeps the standard rule.
alter table issues_lessons enable row level security;

drop policy if exists issues_lessons_read on issues_lessons;
create policy issues_lessons_read on issues_lessons
  for select using (can_access_project(project_id));

-- ⚠️ The generic `_write` policy must go, or it stays as a second permissive
-- policy and Postgres ORs them together — which would leave the loose behaviour
-- exactly as it was while this file looked like it had fixed it.
drop policy if exists issues_lessons_write on issues_lessons;

drop policy if exists issues_lessons_ins on issues_lessons;
create policy issues_lessons_ins on issues_lessons
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    -- Stamped as yourself. Without this a department user could file an issue
    -- under someone else's name, and "who raised this?" stops being answerable.
    -- ⚠️ Planners/admins are exempt: the Minutes-of-Meeting "raise as issue" flow
    -- and any future bulk import legitimately create rows on behalf of others.
    and (created_by = auth.uid() or is_planner())
  );

drop policy if exists issues_lessons_upd on issues_lessons;
create policy issues_lessons_upd on issues_lessons
  for update using (
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  ) with check (
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  );

drop policy if exists issues_lessons_del on issues_lessons;
create policy issues_lessons_del on issues_lessons
  for delete using (is_planner() and can_access_project(project_id));

grant select, insert, update, delete on issues_lessons to authenticated;

-- ---- 3) No back-fill ------------------------------------------------------
-- ⚠️ Existing rows with a null `created_by` (imported, or created before the
-- stamp) become editable by planners only. That is the correct outcome: there is
-- no way to know whose they were, and guessing an owner would hand someone edit
-- rights over a record they never touched.

-- Done. A department can raise and maintain its own issues; planners still own
-- the register as a whole.


-- ==========================================================================
-- [085/142] 2026-08-19-duration-scenarios-and-mom.sql
-- ==========================================================================
-- ============================================================================
-- Migration: (C3) DURATION SCENARIOS and (C4) MINUTES OF MEETING.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Two unrelated features share one file only because they ship together; the
-- two halves are independent and either can be dropped without the other.
-- ============================================================================


-- ============================================================================
-- C3) DURATION SCENARIOS — "what does this schedule look like in a wet season?"
--
-- ⚠️ NOT the same thing as `schedule_scenarios`, which already exists. That is a
--    whole-schedule SNAPSHOT (P6/OPC "Reflections") you restore. This is a set
--    of RULES that derives adjusted durations from the live schedule, so it
--    stays meaningful as the schedule changes underneath it. A snapshot answers
--    "what did it look like on Tuesday"; a duration scenario answers "what would
--    it look like if every exterior activity ran 25% slower from June".
--
-- WHY rules and not a second copy of the durations: a copy is stale the moment
-- anyone edits an activity, and a planner would have to re-apply the wet-season
-- assumption by hand after every change. Rules re-evaluate.
-- ============================================================================
create table if not exists duration_scenarios (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references projects(id) on delete cascade,
  name          text not null,
  description   text,
  -- ⚠️ THE CALENDAR LINK — this is what makes a scenario mean anything in DATES
  -- rather than in day-counts. A stretched duration only moves a finish date if
  -- something knows which days are working days; that is the calendar's job
  -- (working-day pattern + extra_holidays). Null = use each activity's own
  -- calendar, which is the honest default for a project with several.
  calendar_id   uuid references calendars(id) on delete set null,
  -- Ordered list of rules. Each:
  --   { "id": "...", "label": "Wet season - exterior",
  --     "months": [6,7,8,9,10,11],        -- calendar months it applies in (1-12); [] = all year
  --     "trades": ["Structural Works"],   -- work_type match; [] = any
  --     "phases": ["construction"],       -- phase match; [] = any
  --     "scope":  "",                     -- '' | 'main' | 'change_order'
  --     "factor": 1.25,                   -- multiply the duration
  --     "add_days": 0 }                   -- ...then add this many
  -- ⚠️ Rules are evaluated IN ORDER and their effects COMPOUND, which is why the
  -- list is ordered and not a set: "wet season +25%" then "high-rise +2 days"
  -- is a different (and intended) answer from applying only the larger of the two.
  rules         jsonb default '[]'::jsonb,
  -- ⚠️ RAIN DAYS are a SECOND, different mechanism from `rules`, and conflating
  -- them is the mistake this comment exists to prevent:
  --   a RULE stretches a duration      — "this work runs 25% slower when it is wet"
  --   a RAIN DAY removes a working day — "we lose 8 days to weather in July"
  -- A planner needs both, and they compose: 10 days x 1.25 = 13 days of work, then
  -- laid onto a calendar that gives up 8 of July's working days.
  -- Shape: { "6": 4, "7": 8, "8": 8, "9": 6 } — calendar month (1-12) -> days lost.
  -- ⚠️ Held on the SCENARIO, not written into the calendar's extra_holidays: a
  -- calendar is shared by every activity and every scenario on the project, so
  -- baking one scenario's weather assumption into it would silently move dates in
  -- the live schedule and in every other scenario.
  rain_days     jsonb default '{}'::jsonb,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists duration_scenarios_project_idx on duration_scenarios (project_id, name);

alter table duration_scenarios enable row level security;
drop policy if exists duration_scenarios_read on duration_scenarios;
create policy duration_scenarios_read on duration_scenarios
  for select using (can_access_project(project_id));
drop policy if exists duration_scenarios_write on duration_scenarios;
create policy duration_scenarios_write on duration_scenarios
  for all using (is_planner() and can_access_project(project_id))
       with check (is_planner() and can_access_project(project_id));
grant select, insert, update, delete on duration_scenarios to authenticated;


-- ============================================================================
-- C4) MINUTES OF MEETING — captured against the project, with action items that
--     become entries in the Issues & Concerns register.
--
-- WHY the action items are their own table and not jsonb on the MOM: an action
-- item has to be findable, assignable and closable on its own, and it has to be
-- able to POINT AT an issue row. A jsonb blob can hold the text but cannot be
-- joined, filtered by owner, or referenced by the issue it raised.
-- ============================================================================
create table if not exists meeting_minutes (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references projects(id) on delete cascade,
  title         text not null,
  meeting_date  date,
  location      text,
  attendees     text,
  notes         text,
  -- Optional link to the schedule the meeting was about. Free text on purpose:
  -- it holds `project_schedule.activity_id` (the stable P6/business key), NOT the
  -- row uuid — the same rule the drawing-register link follows, because a row
  -- uuid changes on every "Replace" import while the activity id does not.
  schedule_activity_id text,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists mom_items (
  id            uuid primary key default gen_random_uuid(),
  mom_id        uuid not null references meeting_minutes(id) on delete cascade,
  project_id    text not null references projects(id) on delete cascade,
  seq           int default 0,
  description   text not null,
  owner         text,
  due_date      date,
  status        text default 'Open' check (status in ('Open', 'In Progress', 'Closed')),
  -- ⚠️ The link to the register. `on delete set null`, deliberately: deleting the
  -- issue must not delete the minute it came out of — the MOM is the record of
  -- what was said, and it stays true whatever happens to the issue afterwards.
  issue_id      uuid references issues_lessons(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists meeting_minutes_project_idx on meeting_minutes (project_id, meeting_date desc);
create index if not exists mom_items_mom_idx on mom_items (mom_id, seq);
create index if not exists mom_items_issue_idx on mom_items (issue_id);

-- The reciprocal pointer, so the register can say "this came out of a meeting"
-- without scanning mom_items.
alter table issues_lessons add column if not exists mom_id uuid references meeting_minutes(id) on delete set null;
create index if not exists issues_lessons_mom_idx on issues_lessons (mom_id);

do $$
declare t text;
begin
  foreach t in array array['meeting_minutes', 'mom_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- Keep updated_at honest on all three (the registers report "last activity").
create or replace function touch_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['duration_scenarios', 'meeting_minutes', 'mom_items'] loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Done.


-- ==========================================================================
-- [086/142] 2026-08-19-eng-design-progress-mirror.sql
-- ==========================================================================
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


-- ==========================================================================
-- [087/142] 2026-08-19-packages.sql
-- ==========================================================================
-- ============================================================================
-- Migration: PACKAGES — a contract package lives INSIDE a project.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHAT THIS IS
--   Project → Package → (eventually) module records. A package is a contract
--   package / lot within one project: "Package 1 — Substructure", "PKG-03 —
--   MEPF Fit-out". It is a real entity with its own code, dates and contract
--   amount, not a label typed onto rows.
--
-- ⚠️ WHAT THIS IS *NOT*: the Main-Contract vs Change-Order split.
--   That axis already exists and is deliberately NOT a package — see
--   2026-08-19-schedule-contract-scope.sql: `scope_type` is a TAG on an
--   activity/WBS node so a change order can sit inside the construction
--   sequence where the WORK is, while still reporting where the MONEY comes
--   from. Packages are the orthogonal axis: WHICH contract package the work
--   belongs to. An activity can be "Package 2" AND "change_order"; forcing one
--   of those to model the other is what this note exists to prevent.
--
-- ⚠️ SCOPE OF THIS MIGRATION: it creates the entity and its access rules only.
--   No module table gets a `package_id` yet, and nothing is back-filled. Module
--   adoption is per-module and deliberate — a `package_id` added to a module
--   table before that module's UI can set it produces rows that belong to no
--   package and silently vanish from any package-filtered view.
-- ============================================================================

-- ---- 1) The table ----------------------------------------------------------
create table if not exists packages (
  id              uuid primary key default gen_random_uuid(),
  -- Cascade: a package cannot outlive its project. admin_delete_project already
  -- refuses while real work exists, so this only ever fires on an empty project.
  project_id      text not null references projects(id) on delete cascade,
  -- The planner's own package number off the contract documents ("PKG-01",
  -- "P2"). Unique WITHIN a project, never globally — two projects both having a
  -- "Package 1" is the normal case, not a clash.
  code            text not null,
  name            text not null,
  description     text,
  -- Same vocabulary as projects.status, so "archived" means the same thing at
  -- both levels and one filter idiom works for both.
  status          text default 'active' check (status in ('active', 'archived')),
  sort_order      int  default 0,
  start_date      date,
  end_date        date,
  contract_amount numeric,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Case-insensitive: "PKG-01" and "pkg-01" are the same package to a human, and
-- letting both exist splits every future package-scoped total in two.
create unique index if not exists packages_project_code_idx
  on packages (project_id, lower(code));
create index if not exists packages_project_idx on packages (project_id, sort_order);

-- ---- 2) Access -------------------------------------------------------------
-- Identical shape to every project-scoped module table (see
-- 2026-07-21-rls-project-scope-fix.sql): read follows project access, write
-- additionally requires planner. A viewer must never create a package.
alter table packages enable row level security;

drop policy if exists packages_read on packages;
create policy packages_read on packages
  for select using (can_access_project(project_id));

drop policy if exists packages_write on packages;
create policy packages_write on packages
  for all using (is_planner() and can_access_project(project_id))
       with check (is_planner() and can_access_project(project_id));

grant select, insert, update, delete on packages to authenticated;

-- ---- 3) Keep updated_at honest --------------------------------------------
-- The dashboard reports "last activity" per project from these timestamps; an
-- updated_at that only ever records the INSERT would quietly report a package
-- edited this morning as untouched since it was created.
create or replace function packages_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists packages_touch on packages;
create trigger packages_touch before update on packages
  for each row execute function packages_touch_updated_at();

-- ---- 4) No seed ------------------------------------------------------------
-- Deliberately NOT inventing a "Main Package" for every existing project. A
-- project with no packages is a truthful state ("nobody has broken this one
-- down yet"), and the app says exactly that. A seeded placeholder would instead
-- assert a package structure that no planner agreed to, and every later real
-- package would have to be reconciled against it.

-- Done. Packages are readable/writable; module adoption comes per module.


-- ==========================================================================
-- [088/142] 2026-08-19-schedule-contract-scope.sql
-- ==========================================================================
-- ============================================================================
-- Migration: CONTRACT SCOPE on schedule activities — is this line of work part
--            of the MAIN CONTRACT, or is it a CHANGE ORDER / variation?
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY a column and not a WBS branch: a change order is almost never a tidy
-- branch hanging off the end of the schedule. A CO for "additional slab
-- openings on L5" belongs *inside* the structural sequence, between two main
-- contract activities, linked to both. Modelling it as a branch would force the
-- planner to choose between logical position and contractual identity. A tag
-- lets an activity sit where the WORK sits while still reporting where the
-- MONEY comes from — and the grid can then filter to Main contract only,
-- Change orders only, or blended (both), which is the whole point.
--
-- WHY execution phase only: initiation / planning / close-out activities are
-- project overhead, not contracted scope, so tagging them would invite a
-- meaningless "is the design review a change order?" question. The app only
-- surfaces the field on activities whose (inherited) phase is 'construction';
-- the column is nullable everywhere else, which reads as "not applicable".
-- ============================================================================

-- ---- 1) The columns --------------------------------------------------------
-- scope_type: null = untagged. On an execution-phase activity the app READS an
-- untagged row as Main Contract (the honest default — everything is main
-- contract until someone says otherwise), but it is stored as null so a real,
-- deliberate 'main' tag stays distinguishable from "never looked at".
alter table project_schedule add column if not exists scope_type       text;
-- The CO reference the planner writes on the sheet — "VO-014", "CO-2026-03".
-- Free text on purpose: change-order numbering is a contract convention, not
-- ours to constrain, and these come off the client's own correspondence.
alter table project_schedule add column if not exists change_order_ref text;
-- WBS nodes carry the same tag so a whole CO branch can be labelled once and
-- its activities inherit it (same inheritance rule as `phase`).
alter table wbs_nodes add column if not exists scope_type       text;
alter table wbs_nodes add column if not exists change_order_ref text;

-- ---- 2) Constrain the vocabulary ------------------------------------------
-- Two values, fixed. Free text here would fragment the filter the same way a
-- free-text phase would — and this one gates cost reporting, so "CO" vs
-- "Change Order" vs "change order" splitting a project's variation total into
-- three buckets is a real and expensive failure.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_scope_type_chk') then
    alter table project_schedule add constraint project_schedule_scope_type_chk
      check (scope_type is null or scope_type in ('main', 'change_order'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_scope_type_chk') then
    alter table wbs_nodes add constraint wbs_nodes_scope_type_chk
      check (scope_type is null or scope_type in ('main', 'change_order'));
  end if;
end $$;

create index if not exists project_schedule_scope_type_idx on project_schedule (project_id, scope_type);
create index if not exists wbs_nodes_scope_type_idx        on wbs_nodes (project_id, scope_type);

-- ---- 3) No back-fill -------------------------------------------------------
-- Deliberately NOT seeding every existing execution-phase row to 'main'. The
-- app already reads null as Main Contract, so a back-fill would buy nothing and
-- would destroy the one thing null is good for: telling a planner which rows
-- have actually been reviewed for contractual scope.

-- Done. Group / filter / roll up the schedule by Contract Scope.


-- ==========================================================================
-- [089/142] 2026-08-19-schedule-package.sql
-- ==========================================================================
-- ============================================================================
-- Migration: CONTRACT PACKAGE on schedule activities — WHICH package does this
--            line of work belong to?
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- Requires 2026-08-19-packages.sql (the `packages` table) to have been run.
--
-- ⚠️ THIS IS A DIFFERENT AXIS FROM `scope_type`, AND THE DISTINCTION IS THE
--    WHOLE POINT OF THIS MIGRATION.
--      scope_type  = WHERE THE MONEY COMES FROM — main contract or a change
--                    order (2026-08-19-schedule-contract-scope.sql).
--      package_id  = WHICH CONTRACT PACKAGE the work belongs to.
--    They are orthogonal: an activity can be "Package 2" AND "change_order" —
--    a variation raised against the MEPF package is exactly that. Modelling
--    either one with the other collapses a real distinction and makes the
--    reports lie, which is why they are two columns and not one.
--
-- WHY a column and not a WBS branch: same reasoning as scope_type. A package's
-- work does not sit in one tidy branch — a package cuts across floors, trades
-- and phases, and the planner must be free to put an activity where the WORK
-- belongs in the sequence. A tag lets the grid filter, group and roll up by
-- package without dictating the shape of the WBS.
-- ============================================================================

-- ---- 1) The columns --------------------------------------------------------
-- null = not assigned to a package. ⚠️ Read as "unassigned", NEVER defaulted to
-- a package: unlike scope_type (where untagged execution work is honestly main
-- contract), there is no defensible default package — guessing one would file
-- real work under a contract lot nobody put it in.
alter table project_schedule add column if not exists package_id uuid;
-- WBS nodes carry the same tag so a whole branch can be assigned once and its
-- activities inherit it (same inheritance rule as `phase` and `scope_type`).
alter table wbs_nodes        add column if not exists package_id uuid;

-- ---- 2) Referential integrity ---------------------------------------------
-- ⚠️ ON DELETE SET NULL, deliberately. A package is a contractual grouping; the
-- activities are the work itself. Deleting a package must never delete the
-- schedule — the work becomes unassigned and shows up as such, which is a
-- visible, recoverable state. (The app additionally refuses the delete while
-- anything still points at it — see admin_delete_package below — so this
-- constraint is the backstop, not the everyday path.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_package_fk') then
    alter table project_schedule add constraint project_schedule_package_fk
      foreign key (package_id) references packages(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_package_fk') then
    alter table wbs_nodes add constraint wbs_nodes_package_fk
      foreign key (package_id) references packages(id) on delete set null;
  end if;
end $$;

create index if not exists project_schedule_package_idx on project_schedule (project_id, package_id);
create index if not exists wbs_nodes_package_idx        on wbs_nodes        (project_id, package_id);

-- ---- 3) Guarded delete -----------------------------------------------------
-- Mirrors admin_delete_group_head / admin_delete_project: refuse while the
-- package is in use and NAME what is blocking, rather than silently unassigning
-- a few hundred activities (which the ON DELETE SET NULL above would otherwise
-- do without anyone noticing). Setting the package's status to 'archived' is
-- the non-destructive way to retire one.
create or replace function admin_delete_package(target uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  n_act int; n_wbs int; proj text;
begin
  select project_id into proj from packages where id = target;
  if proj is null then
    raise exception 'Package not found.';
  end if;
  -- Same rule the table's own write policy applies, re-checked here because a
  -- security definer function bypasses RLS.
  if not (is_planner() and can_access_project(proj)) then
    raise exception 'Not authorized to delete this package.';
  end if;
  select count(*) into n_act from project_schedule where package_id = target;
  select count(*) into n_wbs from wbs_nodes        where package_id = target;
  if n_act > 0 or n_wbs > 0 then
    raise exception 'Cannot delete: % activity/activities and % WBS branch(es) are still assigned to this package. Reassign them first, or set the package to archived.', n_act, n_wbs;
  end if;
  delete from packages where id = target;
end $$;

grant execute on function admin_delete_package(uuid) to authenticated;

-- ---- 4) No back-fill -------------------------------------------------------
-- Deliberately NOT assigning existing activities to anything. There is no rule
-- that could infer a package from the current data, and a guessed assignment is
-- worse than an honest blank: the grid's "— No package —" bucket is exactly the
-- list a planner needs to work through.

-- Done. Filter / group / roll up the schedule by contract package, independently
-- of the main-contract vs change-order tag.


-- ==========================================================================
-- [090/142] 2026-08-20-department-minutes.sql
-- ==========================================================================
-- ============================================================================
-- Migration: DEPARTMENTS CAN RECORD MINUTES (the other half of D1).
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY: `meeting_minutes` / `mom_items` were created (2026-08-19-duration-scenarios-
-- and-mom.sql) under the standard planner rule — `for all using (is_planner())` —
-- because the screen that edited them lived inside the Project Schedule module,
-- which is a planner tool. Minutes of Meeting has since moved into the Issues &
-- Concerns register, which is department-facing, and the owner has asked for
-- departments to record minutes there too. So this file does to minutes exactly
-- what D1 did to issues.
--
-- ⚠️ IT IS NOT A BLANKET WIDENING. `for all using (is_planner())` is one rule for
--    four commands; replacing it with `is_writer()` in the same shape would let any
--    approved non-viewer rewrite or delete ANOTHER department's minutes — a record
--    of what was said in a meeting they may not have attended. The three commands
--    get three different rules, mirroring the register beside them:
--      insert — any approved non-viewer, on a project they can access, stamped as
--               themselves.
--      update — planner+ on anything; everyone else only minutes THEY recorded.
--      delete — planner+ on anything; everyone else only their own, and only while
--               nothing has been raised from them (see the delete note below).
--
-- ⚠️ OWNERSHIP OF AN ACTION ITEM IS DERIVED, NOT STORED. `mom_items` has no
--    `created_by` and is not getting one: an action item belongs to its minute (it
--    is already `on delete cascade` from it), so "may I touch this action?" is the
--    same question as "may I edit the minute it is on?". A second ownership column
--    would be a second answer to that question, free to disagree with the first —
--    e.g. someone else's action item sitting inside minutes you own.
--
-- ⚠️ If 2026-08-19-duration-scenarios-and-mom.sql is ever re-run (it is idempotent,
--    so that is a reasonable thing to do), its do-block recreates the generic
--    `*_write` policies this file drops. Postgres ORs permissive policies, so that
--    would not re-narrow anything — those policies only ever grant to planners, who
--    already have everything here — but the file would then be misleading about what
--    governs writes. Re-run THIS file after it.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "function does not exist" -----
do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
  if to_regclass('public.meeting_minutes') is null then
    raise exception 'meeting_minutes is missing — run migrations/2026-08-19-duration-scenarios-and-mom.sql first';
  end if;
end $$;


-- ---- 1) Helpers -------------------------------------------------------------
-- ⚠️ SECURITY DEFINER + a pinned search_path, like every other helper here: these
-- are called from inside RLS policies, and a policy whose sub-select is itself
-- filtered by RLS is how this schema got a stack-depth recursion bug once already
-- (see 2026-06-18-fix-rls-recursion.sql).

-- "Are these my minutes?" — the ownership question every mom_items rule asks.
create or replace function mom_is_mine(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meeting_minutes m
    where m.id = p_mom and m.created_by = auth.uid()
  );
$$;

-- "Has anything been raised out of these minutes?" — the delete guard.
create or replace function mom_has_raised(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mom_items i
    where i.mom_id = p_mom and i.issue_id is not null
  );
$$;

grant execute on function mom_is_mine(uuid), mom_has_raised(uuid) to authenticated;


-- ---- 2) meeting_minutes ----------------------------------------------------
alter table meeting_minutes enable row level security;

-- Reading is unchanged: anyone on the project reads the minutes. A meeting record
-- the site cannot read is not a record of anything.
drop policy if exists meeting_minutes_read on meeting_minutes;
create policy meeting_minutes_read on meeting_minutes
  for select using (can_access_project(project_id));

-- ⚠️ The generic policy MUST go, or it stays as a second permissive policy and
-- Postgres ORs them — leaving the file looking like it had changed the rules.
drop policy if exists meeting_minutes_write on meeting_minutes;

drop policy if exists meeting_minutes_ins on meeting_minutes;
create policy meeting_minutes_ins on meeting_minutes
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    -- Stamped as yourself, so "who recorded this?" stays answerable — and because
    -- the update rule below is built on that answer. ⚠️ Planners are exempt for the
    -- same reason as the register: an import or a minute typed up on someone else's
    -- behalf is legitimate.
    and (created_by = auth.uid() or is_planner())
  );

drop policy if exists meeting_minutes_upd on meeting_minutes;
create policy meeting_minutes_upd on meeting_minutes
  for update using (
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  ) with check (
    -- ⚠️ Asserted in BOTH clauses. With `using` alone a row could be updated OUT of
    -- your own ownership (hand it to someone else, or to nobody) and you would keep
    -- neither the right to fix it nor the record of having written it.
    can_access_project(project_id)
    and (is_planner() or (is_writer() and created_by = auth.uid()))
  );

drop policy if exists meeting_minutes_del on meeting_minutes;
create policy meeting_minutes_del on meeting_minutes
  for delete using (
    can_access_project(project_id)
    and (
      is_planner()
      -- ⚠️ WHY OWN-DELETE IS ALLOWED AT ALL, when the register's is not: the "+ New
      -- minutes" button INSERTS immediately and then lets you type, so a mis-click
      -- leaves a real empty row. Without this, every stray draft would need a
      -- planner to clear it.
      -- ⚠️ AND WHY IT IS GUARDED: once an action item has been raised, issues in the
      -- register point back at these minutes for their provenance ("Raised at: …",
      -- the From MOM tag). `on delete set null` means deleting the minute does not
      -- delete those issues — it silently strips where they came from. That is a
      -- planner's call, not a side effect of tidying your own drafts.
      or (is_writer() and created_by = auth.uid() and not mom_has_raised(id))
    )
  );

grant select, insert, update, delete on meeting_minutes to authenticated;


-- ---- 3) mom_items ----------------------------------------------------------
alter table mom_items enable row level security;

drop policy if exists mom_items_read on mom_items;
create policy mom_items_read on mom_items
  for select using (can_access_project(project_id));

drop policy if exists mom_items_write on mom_items;

-- All three write rules are the same question — "may I edit the minute this is on?"
-- ⚠️ Note there is NO own-row exemption on delete here, unlike the minute itself: an
-- action item is a line inside someone's minutes, so the minute's owner (or a
-- planner) maintains it. Removing a line never touches an issue raised from it —
-- `mom_items.issue_id` is the only link, and the issue is its own row.
drop policy if exists mom_items_ins on mom_items;
create policy mom_items_ins on mom_items
  for insert with check (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  );

drop policy if exists mom_items_upd on mom_items;
create policy mom_items_upd on mom_items
  for update using (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  ) with check (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  );

drop policy if exists mom_items_del on mom_items;
create policy mom_items_del on mom_items
  for delete using (
    is_writer() and can_access_project(project_id)
    and (is_planner() or mom_is_mine(mom_id))
  );

grant select, insert, update, delete on mom_items to authenticated;


-- ---- 4) No back-fill ------------------------------------------------------
-- ⚠️ Existing minutes with a null `created_by` (recorded before this, or by an
-- import) become planner-only to edit. That is correct and deliberate: there is no
-- way to know whose they were, and guessing would hand someone edit rights over a
-- meeting record they never wrote. The UI says so on the row rather than showing a
-- disabled form with no explanation.

-- Done.


-- ==========================================================================
-- [091/142] 2026-08-21-class-codes.sql
-- ==========================================================================
-- Class codes: Finance's chart of scope, and a first-class column on the schedule ----------
-- Source: "EPC. FIN. Class Code Mapping Template" (sheet "Excel Temp", header row 9).
-- 702 Level-3 codes across 42 Level-1 divisions and 205 Level-2 groups.
--
-- WHY THIS TABLE EXISTS AT ALL. The class code is the only vocabulary the Planners app and
-- the Procurement (WPM) app genuinely share: WPM's `work_packages.cost_code` is the same
-- Finance code. Until now neither app held it properly -- the schedule had NO code column,
-- the Schedule Builder carried a hardcoded 197-code subset it threw away on push, and WPM's
-- cost_code is a free-text box. So the two apps nominally spoke Finance's language and in
-- practice shared nothing, which is why "should activities point at packages or the reverse?"
-- had no good answer. With a shared code, a work package's scope can be DERIVED from the
-- schedule (group activities by code x location) instead of hand-linked in either app.
--
-- ⚠️ THE PADDED LEVEL-3 CODE IS THE KEY. Do NOT strip its leading zeros. The template also
-- carries a de-zeroed column and it is NOT unique -- de-zeroing collides two genuinely
-- different items:
--     015051  General Requirement > Support Equipment > Earthmoving
--      15051  Metal Works         > Railings          > Railings
--     017151  General Requirement > Bonds/Permits     > Misc. LGU and Estate Tax
--      17151  Aluminum Glass      > Swing Windows     > Aluminum Swing Windows
-- Both members of each pair are seeded below. A de-zeroing "tidy-up" silently merges two
-- unrelated cost codes -- and because the merge looks like a successful match, nothing errors.
-- It is also why the code must be PICKED from this table, never typed free-hand.
--
-- ⚠️ LEVELS ARE STORED, NOT PARSED. code_l1 is not reliably the first 2 characters of the
-- code: 5 rows break that rule (the unpadded 1102x rows sit under L1 '01', and NOBDT under
-- '61'). Slicing the string to get a division would mis-file them. Group by code_l1 /
-- code_l2 via this table instead -- which is also what makes packaging granularity a
-- SELECTABLE level (division / group / item) rather than a rule baked into a query.
--
-- ⚠️ ORG-WIDE, NOT PER PROJECT. The template's header block has a "Project Name" field, so a
-- copy is transmitted per project, but the chart itself is Finance's standard and identical
-- across projects -- 702 rows x 20 projects of identical data would be pure duplication. If a
-- project ever needs its own variant, add a nullable project_id override column rather than
-- copying the whole chart.
--
-- Two source rows were dropped as duplicates of the padded code: '51000' (an exact repeat)
-- and a placeholder row 'NOBDT' under a non-numeric L1 'NO' (the real 'No Budget' row under
-- L1 '61' is kept). Deterministic: on a duplicate code the numeric-L1 row wins.
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
-- ---------------------------------------------------------------------------------------

create table if not exists class_codes (
  code        text primary key,          -- padded Level 3, e.g. '015051' (leading zeros significant)
  code_l1     text not null,             -- division, e.g. '01'
  code_l2     text not null,             -- group,    e.g. '01500'
  desc_l1     text not null,             -- 'General Requirement'
  desc_l2     text not null,             -- 'Support Equipment'
  desc_l3     text not null,             -- 'Earthmoving'
  sort_order  integer,                   -- template order, so pickers read in Finance's sequence
  active      boolean not null default true,
  created_at  timestamptz default now()
);

create index if not exists idx_class_codes_l1 on class_codes(code_l1);
create index if not exists idx_class_codes_l2 on class_codes(code_l2);

grant select on class_codes to authenticated;

alter table class_codes enable row level security;

-- READ for any approved user: it is reference data every planner needs to pick from.
-- WRITE is admin-only -- this is Finance's chart, not something a project edits in passing.
drop policy if exists class_codes_read on class_codes;
create policy class_codes_read on class_codes
  for select to authenticated using (is_approved());

drop policy if exists class_codes_write on class_codes;
create policy class_codes_write on class_codes
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---- The activity's own class code -----------------------------------------------------
-- ⚠️ Deliberately NOT named cost_code: this module already has `cost_accounts` +
-- `resource_assignments.cost_account_id` + `activity_expenses.cost_account_id`, which are the
-- internal CBS and a different concept entirely. It joins to WPM's `work_packages.cost_code`;
-- the differing names are documented on both sides rather than risking a local confusion.
--
-- ⚠️ No FK to class_codes. An imported P6/OPC schedule can carry a code that predates a
-- template revision, and rejecting the import (or silently nulling the value) is worse than
-- holding a code that does not resolve -- an unresolved code is a visible data-quality signal.
alter table project_schedule add column if not exists class_code text;

create index if not exists idx_project_schedule_class_code
  on project_schedule(project_id, class_code);

-- ---- Seed ------------------------------------------------------------------------------
-- on conflict updates the descriptions/levels so a template revision can be re-run over this.
insert into class_codes (code, code_l1, code_l2, desc_l1, desc_l2, desc_l3, sort_order) values
  ('01051','01','01050','General Requirement','Mobilization / Demobilization','Mobilization',0),
  ('01052','01','01050','General Requirement','Mobilization / Demobilization','Demobilization',10),
  ('010521','01','01050','General Requirement','Mobilization / Demobilization','Rental of Flat Bed Truck',20),
  ('010522','01','01050','General Requirement','Mobilization / Demobilization','Rental of 50T',30),
  ('010523','01','01050','General Requirement','Mobilization / Demobilization','Rental of 10-Wheeler Truck w/ Boom',40),
  ('010524','01','01050','General Requirement','Mobilization / Demobilization','Rental of Skidloader',50),
  ('01101','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Office',60),
  ('011011','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Office - Megawide & Owner',70),
  ('01102','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Barracks',80),
  ('011021','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Barracks',90),
  ('011022','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Supply of Modular Houses',100),
  ('01103','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Staging Area',110),
  ('011031','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Staging Area',120),
  ('011032','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Utilities',130),
  ('01104','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Fence & Gate',140),
  ('01105','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Toilet & Utilities',150),
  ('11011','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Office - Megawide & Owner',160),
  ('11021','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Barracks',170),
  ('11031','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Staging Area',180),
  ('11032','01','01100','General Requirement','Temp. Facil. - Site Devt., Offices & Utilities','Utilities',190),
  ('01151','01','01150','General Requirement','Temp. Facil. - Utilities Installed in Bldg.','Temp Facil - Office MEP',200),
  ('011511','01','01150','General Requirement','Temp. Facil. - Utilities Installed in Bldg.','Site - Power Consumption',210),
  ('01152','01','01150','General Requirement','Temp. Facil. - Utilities Installed in Bldg.','Temp Facil - Building (MEP)',220),
  ('01201','01','01200','General Requirement','Office Equip & Supplies','Office Equipment & Furniture',230),
  ('012011','01','01200','General Requirement','Office Equip & Supplies','Office Equipment & Furniture',240),
  ('012012','01','01200','General Requirement','Office Equip & Supplies','Office Furniture',250),
  ('012013','01','01200','General Requirement','Office Equip & Supplies','Others (Software License)',260),
  ('01202','01','01200','General Requirement','Office Equip & Supplies','Office Supplies',270),
  ('012021','01','01200','General Requirement','Office Equip & Supplies','Office Supplies',280),
  ('01251','01','01250','General Requirement','Site Management Organization (HR) (No. of Staffs)','Site Management',290),
  ('012511','01','01250','General Requirement','Site Management Organization (HR) (No. of Staffs)','Site Management',300),
  ('01301','01','01300','General Requirement','Support Crew - Admin Workers','House Keeping',310),
  ('013011','01','01300','General Requirement','Support Crew - Admin Workers','Housekeeping',320),
  ('01302','01','01300','General Requirement','Support Crew - Admin Workers','Maintenance Crew',330),
  ('013021','01','01300','General Requirement','Support Crew - Admin Workers','Maintenance Crew',340),
  ('01303','01','01300','General Requirement','Support Crew - Admin Workers','QRT for Punchlist',350),
  ('01304','01','01300','General Requirement','Support Crew - Admin Workers','QRT for DLP',360),
  ('01351','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Power',370),
  ('013511','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Power Consumption',380),
  ('01352','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Water',390),
  ('013521','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Water Consumption',400),
  ('01353','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Communication',410),
  ('013531','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Communication Consumption',420),
  ('01354','01','01350','General Requirement','Utilities (Power/ Water/ Comm)','Utilities Miscellaneous',430),
  ('01401','01','01400','General Requirement','Security Services','Security Services - 4N/S and 4D/S',440),
  ('014011','01','01400','General Requirement','Security Services','Security Services - 4N/S and 4D/S',450),
  ('01451','01','01450','General Requirement','Housekeeping & Sanitation Services','Fogging / Misting / Pest Control',460),
  ('014511','01','01450','General Requirement','Housekeeping & Sanitation Services','Fogging / Misting / Pest Control',470),
  ('014512','01','01450','General Requirement','Housekeeping & Sanitation Services','Pest Control Treatment (Mega Manila)',480),
  ('01452','01','01450','General Requirement','Housekeeping & Sanitation Services','Garbage Disposal',490),
  ('014521','01','01450','General Requirement','Housekeeping & Sanitation Services','Garbage Disposal',500),
  ('01453','01','01450','General Requirement','Housekeeping & Sanitation Services','Cleaning Consumables',510),
  ('014531','01','01450','General Requirement','Housekeeping & Sanitation Services','Cleaning Consumables',520),
  ('01454','01','01450','General Requirement','Housekeeping & Sanitation Services','Declogging and Siphoning Works',530),
  ('01501','01','01500','General Requirement','Support Equipment','Vertical Equipment (Rental)',540),
  ('015011','01','01500','General Requirement','Support Equipment','Vertical Equipment (Tower Crane Rental Extension)',550),
  ('015012','01','01500','General Requirement','Support Equipment','Vertical Equipment (Passenger Hoist Rental Extension)',560),
  ('01502','01','01500','General Requirement','Support Equipment','Concrete Pumps',570),
  ('01503','01','01500','General Requirement','Support Equipment','Light Equipment',580),
  ('015031','01','01500','General Requirement','Support Equipment','Light Equipment (Power Tools)',590),
  ('01504','01','01500','General Requirement','Support Equipment','Transport Truck',600),
  ('015041','01','01500','General Requirement','Support Equipment','Transport Truck',610),
  ('01505','01','01500','General Requirement','Support Equipment','Earthmoving',620),
  ('015051','01','01500','General Requirement','Support Equipment','Earthmoving',630),
  ('01506','01','01500','General Requirement','Support Equipment','Mobile Crane',640),
  ('01507','01','01500','General Requirement','Support Equipment','Construction Methodology Plan & 3rd Party Certification',650),
  ('015071','01','01500','General Requirement','Support Equipment','3rd Party Certification',660),
  ('01508','01','01500','General Requirement','Support Equipment','Service Vehicles',670),
  ('015081','01','01500','General Requirement','Support Equipment','Services (Site / Manager Services)',680),
  ('01551','01','01550','General Requirement','Fuel and Oil','Fuel and Oil',690),
  ('015511','01','01550','General Requirement','Fuel and Oil','Fuel and Oil',700),
  ('01601','01','01600','General Requirement','Safety Provisions, Safety Measures and First Aid Support','Falsework',710),
  ('01602','01','01600','General Requirement','Safety Provisions, Safety Measures and First Aid Support','Personal Protective Equipment and First Aid Support',720),
  ('016021','01','01600','General Requirement','Safety Provisions, Safety Measures and First Aid Support','PPE Materials',730),
  ('016022','01','01600','General Requirement','Safety Provisions, Safety Measures and First Aid Support','Fire Extinguishers',740),
  ('016023','01','01600','General Requirement','Safety Provisions, Safety Measures and First Aid Support','Safety Signages',750),
  ('01651','01','01650','General Requirement','Drawing Services','Structural Design',760),
  ('01652','01','01650','General Requirement','Drawing Services','Structural Design for Tower Crane Foundation',770),
  ('01653','01','01650','General Requirement','Drawing Services','Architectural Design',780),
  ('01654','01','01650','General Requirement','Drawing Services','Plumbing / Sanitary Design',790),
  ('01655','01','01650','General Requirement','Drawing Services','Fire Protection Design',800),
  ('01656','01','01650','General Requirement','Drawing Services','Mechanical Design',810),
  ('016561','01','01650','General Requirement','Drawing Services','Design Consultancy Fee',820),
  ('016562','01','01650','General Requirement','Drawing Services','Bim Outsource Services',830),
  ('016563','01','01650','General Requirement','Drawing Services','As Built (Signed And Sealed)',840),
  ('01657','01','01650','General Requirement','Drawing Services','Design Coordination Services',850),
  ('01658','01','01650','General Requirement','Drawing Services','Electrical Design',860),
  ('01659','01','01650','General Requirement','Drawing Services','In-house Drawing and Services (As Built, Shop Drawing, Cutting List, Sign and Sealed)',870),
  ('01660','01','01650','General Requirement','Drawing Services','3rd Party Design Certification',880),
  ('01661','01','01650','General Requirement','Drawing Services','Sign and Seal of Plans',890),
  ('01700','01','01700','General Requirement','Bonds, Insurances & Permits','Bonds and Insurances',900),
  ('01701','01','01700','General Requirement','Bonds, Insurances & Permits','Performance Bond',910),
  ('017011','01','01700','General Requirement','Bonds, Insurances & Permits','Performance Bond',920),
  ('01702','01','01700','General Requirement','Bonds, Insurances & Permits','Surety Bond',930),
  ('017021','01','01700','General Requirement','Bonds, Insurances & Permits','Surety Bond',940),
  ('01703','01','01700','General Requirement','Bonds, Insurances & Permits','Guarantee Bond',950),
  ('01704','01','01700','General Requirement','Bonds, Insurances & Permits','Building Permits',960),
  ('01705','01','01700','General Requirement','Bonds, Insurances & Permits','Contractors Tax',970),
  ('01706','01','01700','General Requirement','Bonds, Insurances & Permits','Occupancy Permit',980),
  ('01707','01','01700','General Requirement','Bonds, Insurances & Permits','CARI',990),
  ('01708','01','01700','General Requirement','Bonds, Insurances & Permits','Permit to Operate Tower Crane',1000),
  ('01709','01','01700','General Requirement','Bonds, Insurances & Permits','Contractor''s Employees Accident Insurance and CGLI',1010),
  ('01710','01','01700','General Requirement','Bonds, Insurances & Permits','Excavation Permit',1020),
  ('01711','01','01700','General Requirement','Bonds, Insurances & Permits','Safety Permit',1030),
  ('017111','01','01700','General Requirement','Bonds, Insurances & Permits','Safety Permit',1040),
  ('01712','01','01700','General Requirement','Bonds, Insurances & Permits','Barangay Representation Expense',1050),
  ('01713','01','01700','General Requirement','Bonds, Insurances & Permits','Municipal Representation Expense',1060),
  ('017131','01','01700','General Requirement','Bonds, Insurances & Permits','Other Statutory Permits, Certificates and Licenses',1070),
  ('01714','01','01700','General Requirement','Bonds, Insurances & Permits','Design Permit',1080),
  ('017141','01','01700','General Requirement','Bonds, Insurances & Permits','Design Liability Insurance (Professional Liability)',1090),
  ('01715','01','01700','General Requirement','Bonds, Insurances & Permits','Miscellaneous LGU and Estate Permits',1100),
  ('017151','01','01700','General Requirement','Bonds, Insurances & Permits','Misc. LGU and Estate  Tax (Hauling Permit)',1110),
  ('01716','01','01700','General Requirement','Bonds, Insurances & Permits','Delivery and Hauling Permits',1120),
  ('01717','01','01700','General Requirement','Bonds, Insurances & Permits','Road Usage and Permit',1130),
  ('01719','01','01700','General Requirement','Bonds, Insurances & Permits','Participation Fee',1140),
  ('01751','01','01750','General Requirement','Material Testing','Rebar Testing',1150),
  ('01752','01','01750','General Requirement','Material Testing','Concrete Testing',1160),
  ('01753','01','01750','General Requirement','Material Testing','CHB Testing',1170),
  ('01754','01','01750','General Requirement','Material Testing','Field Density Test',1180),
  ('01755','01','01750','General Requirement','Material Testing','Geotechnical Study / Testing',1190),
  ('01801','01','01800','General Requirement','Property Damage','Property Damage',1200),
  ('018011','01','01800','General Requirement','Property Damage','Property Damage',1210),
  ('01851','01','01850','General Requirement','Project, Owner and Consultant Details','LEED Services',1220),
  ('01852','01','01850','General Requirement','Project, Owner and Consultant Details','Other Client''s Requirements Stated in the Contract',1230),
  ('018521','01','01850','General Requirement','Project, Owner and Consultant Details','HR Plan',1240),
  ('018522','01','01850','General Requirement','Project, Owner and Consultant Details','Petty Cash',1250),
  ('01901','01','61000','General Requirement','Advances','Advances to Subcon',1260),
  ('02051','02','02050','Site Works','Excavation & Backfilling','Excavation',1270),
  ('02052','02','02050','Site Works','Excavation & Backfilling','Hauling-out Debris',1280),
  ('02053','02','02050','Site Works','Excavation & Backfilling','De-watering',1290),
  ('02054','02','02050','Site Works','Excavation & Backfilling','Backfill Hauling',1300),
  ('02055','02','02050','Site Works','Excavation & Backfilling','Backfilling and Compaction',1310),
  ('02056','02','02050','Site Works','Excavation & Backfilling','Gravel Bedding',1320),
  ('02057','02','02050','Site Works','Excavation & Backfilling','Lean Concrete',1330),
  ('02058','02','02050','Site Works','Excavation & Backfilling','Trimming',1340),
  ('02059','02','02050','Site Works','Excavation & Backfilling','Earthworks Cut',1350),
  ('02060','02','02050','Site Works','Excavation & Backfilling','Earthworks Clearing and Grubbing',1360),
  ('02101','02','02100','Site Works','Piling Works','Bored Pile',1370),
  ('02102','02','02100','Site Works','Piling Works','Micro-Pile',1380),
  ('02103','02','02100','Site Works','Piling Works','Driven Pile Concrete Square Pile',1390),
  ('02104','02','02100','Site Works','Piling Works','Driven Pile Concrete Sheet Pile',1400),
  ('02105','02','02100','Site Works','Piling Works','Sheet Pile Steel',1410),
  ('02106','02','02100','Site Works','Piling Works','Secant Pile',1420),
  ('02107','02','02100','Site Works','Piling Works','Screw Piles',1430),
  ('02108','02','02100','Site Works','Piling Works','Helical Piles',1440),
  ('02151','02','02150','Site Works','Soil Protection','Soil Nailing w/ Shotcreting',1450),
  ('02152','02','02150','Site Works','Soil Protection','Soil Nailing w/ Shotcreting & Rock Anchoring (Post-tensioning)',1460),
  ('02153','02','02150','Site Works','Soil Protection','Jet Grouting for Vertical Protection w/ Reinforcement',1470),
  ('02154','02','02150','Site Works','Soil Protection','Jet Grouting for Hor. Bulk-head w/ Anchoring Reinforcement & Walling Supp.',1480),
  ('02201','02','02200','Site Works','Chemical Treatment','Soil Poisoning / Termite Control, Anti-Termite Reticulation System',1490),
  ('02202','02','02200','Site Works','Chemical Treatment','Chemical Treatment Bentonite Solution',1500),
  ('03051','03','03050','Rebar','Rebar','Rebar Works',1510),
  ('03052','03','03050','Rebar','Rebar','Rebar Consumables',1520),
  ('03053','03','03050','Rebar','Rebar','Rebar Coupler',1530),
  ('04051','04','04050','Formworks','Formworks','Formworks',1540),
  ('04052','04','04050','Formworks','Formworks','Formworks Consumables',1550),
  ('04053','04','04050','Formworks','Formworks','Shoring Works',1560),
  ('05051','05','05050','Concrete','Concrete','Ready Mix Concrete',1570),
  ('05052','05','05050','Concrete','Concrete','Concrete Consumables',1580),
  ('06051','06','06050','Precast Works','Precast Works','PC Beams',1590),
  ('06052','06','06050','Precast Works','Precast Works','PC Slab',1600),
  ('06053','06','06050','Precast Works','Precast Works','PC Stairs',1610),
  ('06054','06','06050','Precast Works','Precast Works','PC Columns',1620),
  ('06055','06','06050','Precast Works','Precast Works','Precast Consumables',1630),
  ('06056','06','06050','Precast Works','Precast Works','PC Shearwall',1640),
  ('06057','06','06050','Precast Works','Precast Works','PC Girder',1650),
  ('06058','06','06050','Precast Works','Precast Works','PC Ledge / Balcony',1660),
  ('06059','06','06050','Precast Works','Precast Works','PC Retaining Wall',1670),
  ('07051','07','07050','Structural Steel','Structural Steel','Wide Flange Beam',1680),
  ('07052','07','07050','Structural Steel','Structural Steel','Steel Decking',1690),
  ('07053','07','07050','Structural Steel','Structural Steel','Roof Steel Member',1700),
  ('07054','07','07050','Structural Steel','Structural Steel','Other Structural Steel Works',1710),
  ('08051','08','08050','Masonry','Block Works','Block Works',1720),
  ('08101','08','08100','Masonry','Spraycrete Wall','Spraycrete Wall',1730),
  ('08151','08','08150','Masonry','PC Exterior Walls','PC Exterior Walls',1740),
  ('08201','08','08200','Masonry','PC Interior Walls','PC Interior Walls',1750),
  ('08251','08','08250','Masonry','Sealant Works - Backer Rod and Sealant','Sealant Works - Backer Rod and Sealant',1760),
  ('08301','08','08300','Masonry','Straight To Finish w/ Concrete Hardener and Sealer','Straight To Finish w/ Concrete Hardener and Sealer',1770),
  ('08351','08','08350','Masonry','Concrete Topping','Concrete Topping',1780),
  ('08401','08','08400','Masonry','Plastering Window and Door Opening','Plastering Window and Door Opening',1790),
  ('08451','08','08450','Masonry','Skimcoating Works','Skimcoating Works',1800),
  ('08501','08','08500','Masonry','Grinding, Sanding and Mortar Jointing to Slab Soffit for Cast in Situ (Termination Only)','Grinding, Sanding, and Mortar Jointing to Slab Soffit for Cast in Situ (Termination Only)',1810),
  ('08551','08','08550','Masonry','Mortar Jointing to Exposed PC Half Slab Soffit (Termination Only)','Mortar Jointing to Exposed PC Half Slab Soffit (Termination Only)',1820),
  ('08601','08','08600','Masonry','Masonry Concrete','Masonry Concrete',1830),
  ('08651','08','08650','Masonry','Masonry Consumables','Masonry Consumables',1840),
  ('08701','08','08700','Masonry','PC Toilet','PC Toilet',1850),
  ('09051','09','09050','Stoneworks','Marble Stone','Marble Stone',1860),
  ('09101','09','09100','Stoneworks','Granite Stone','Granite Stone',1870),
  ('09151','09','09150','Stoneworks','Stone Works Consumables','Stone Works Consumables',1880),
  ('10051','10','10050','Tiling Works','Homogenous Tiles','Homogenous Tiles',1890),
  ('10101','10','10100','Tiling Works','Ceramic Tiles','Ceramic Tiles',1900),
  ('10151','10','10150','Tiling Works','Rustic Tiles','Rustic Tiles',1910),
  ('10201','10','10200','Tiling Works','Paver Tiles','Paver Tiles',1920),
  ('10251','10','10250','Tiling Works','Urra Tiles','Urra Tiles',1930),
  ('10301','10','10300','Tiling Works','Porcelain Tiles','Porcelain Tiles',1940),
  ('10351','10','10350','Tiling Works','Vinyl Tiles','Vinyl Tiles',1950),
  ('10401','10','10400','Tiling Works','Carpet Tiles','Carpet Tiles',1960),
  ('10451','10','10450','Tiling Works','Rubber Tiles','Rubber Tiles',1970),
  ('10501','10','10500','Tiling Works','Non-skid Concrete Tiles','Non-skid Concrete Tiles',1980),
  ('10551','10','10550','Tiling Works','Tile Works Consumables','Tile Works Consumables',1990),
  ('11051','11','11050','Drywall & Ceiling Works','Drywall Partition','Drywall Partition',2000),
  ('11101','11','11100','Drywall & Ceiling Works','Board Ceiling','Board Ceiling',2010),
  ('11151','11','11150','Drywall & Ceiling Works','Special Ceiling','Special Ceiling',2020),
  ('110111','11','61000','Drywall & Ceiling Works','Temp Facil - Building (MEP)','Temp Facil - Building (MEP)',2030),
  ('110114','11','61000','Drywall & Ceiling Works','Temp Facil - Building (MEP)','Temp Facil - Building (MEP)',2040),
  ('110211','11','61000','Drywall & Ceiling Works','Temp Facil - Building (MEP)','Temp Facil - Building (MEP)',2050),
  ('110311','11','61000','Drywall & Ceiling Works','Temp Facil - Building (MEP)','Temp Facil - Building (MEP)',2060),
  ('110314','11','61000','Drywall & Ceiling Works','Temp Facil - Building (MEP)','Temp Facil - Building (MEP)',2070),
  ('110321','11','61000','Drywall & Ceiling Works','Temp Facil - Building (MEP)','Temp Facil - Building (MEP)',2080),
  ('12051','12','12050','Thermal & Moisture Protection','Damproofing and Waterproofing','Damproofing and Waterproofing',2090),
  ('12101','12','12100','Thermal & Moisture Protection','Cementitious Waterproof','Cementitious Waterproof',2100),
  ('12151','12','12150','Thermal & Moisture Protection','Epoxy Tank Lining','Epoxy Tank Lining',2110),
  ('12201','12','12200','Thermal & Moisture Protection','Flexible Cementitious','Flexible Cementitious',2120),
  ('12251','12','12250','Thermal & Moisture Protection','PU Waterproof','PU Waterproof',2130),
  ('12301','12','12300','Thermal & Moisture Protection','Floor Hardener','Floor Hardener',2140),
  ('12351','12','12350','Thermal & Moisture Protection','HDPE Geotextile Dimple Sheet Membrane','HDPE Geotextile Dimple Sheet Membrane',2150),
  ('12401','12','12400','Thermal & Moisture Protection','Waterstop (Structural Joint)','Waterstop (Structural Joint)',2160),
  ('12451','12','12450','Thermal & Moisture Protection','Integral Waterproofing Works','Integral Waterproofing Works',2170),
  ('12501','12','12500','Thermal & Moisture Protection','Capillary Waterproofing','Capillary Waterproofing',2180),
  ('13051','13','13050','Door And Jamb','Fire Rated Metal Doors w/ Jamb','Fire Rated Metal Doors w/ Jamb',2190),
  ('13101','13','13100','Door And Jamb','Metal Doors & Jamb','Metal Doors & Jamb',2200),
  ('13151','13','13150','Door And Jamb','Wooden Panel Door & Jamb','Wooden Panel Door & Jamb',2210),
  ('13201','13','13200','Door And Jamb','PVC Door','PVC Door',2220),
  ('13251','13','13250','Door And Jamb','Laminated Fire Rated Door & Jamb','Laminated Fire Rated Door & Jamb',2230),
  ('13301','13','13300','Door And Jamb','Laminated Door & Jamb','Laminated Door & Jamb',2240),
  ('13351','13','13350','Door And Jamb','Wooden Flush Door & Jamb','Wooden Flush Door & Jamb',2250),
  ('13401','13','13400','Door And Jamb','Doors and Jamb Consumables','Doors and Jamb Consumables',2260),
  ('14051','14','14050','Hardwares','Metal Door Hardware','Metal Door Hardware',2270),
  ('14101','14','14100','Hardwares','Wooden Door Hardware','Wooden Door Hardware',2280),
  ('14151','14','14150','Hardwares','PVC Door Hardware','PVC Door Hardware',2290),
  ('15051','15','15050','Metal Works','Railings','Railings',2300),
  ('15052','15','15050','Metal Works','Railings','Steel Grab Bar',2310),
  ('15061','15','15060','Metal Works','Steel Grilles','Steel Grilles',2320),
  ('15101','15','15100','Metal Works','Ladder Rung','Ladder Rung',2330),
  ('15151','15','15150','Metal Works','ACU Cover/ Ledge','ACU Cover/ Ledge',2340),
  ('15201','15','15200','Metal Works','Manhole Cover','Manhole Cover',2350),
  ('15251','15','15250','Metal Works','Trench Drain','Trench Drain',2360),
  ('15301','15','15300','Metal Works','Column Guard','Column Guard',2370),
  ('15351','15','15350','Metal Works','Bollard','Bollard',2380),
  ('15401','15','15400','Metal Works','Water Tank','Water Tank',2390),
  ('15451','15','15450','Metal Works','Elevator Separator Beam','Elevator Separator Beam',2400),
  ('15501','15','15500','Metal Works','Stair Nosing','Stair Nosing',2410),
  ('15551','15','15550','Metal Works','Steel Skirting','Steel Skirting',2420),
  ('15601','15','15600','Metal Works','Metal Sheet','Metal Sheet',2430),
  ('15651','15','15650','Metal Works','Steel Hoisting Beam','Steel Hoisting Beam',2440),
  ('16051','16','16050','Painting Works','Latex Paint','Latex Paint',2450),
  ('16101','16','16100','Painting Works','Elastomeric Paint','Elastomeric Paint',2460),
  ('16151','16','16150','Painting Works','Epoxy  Paint','Epoxy  Paint',2470),
  ('16201','16','16200','Painting Works','Acrytex Paint','Acrytex Paint',2480),
  ('16251','16','16250','Painting Works','QDE','QDE',2490),
  ('16301','16','16300','Painting Works','Automotive Paint','Automotive Paint',2500),
  ('16351','16','16350','Painting Works','Varnish','Varnish',2510),
  ('16401','16','16400','Painting Works','Painting Works Miscellaneous','Painting Works Miscellaneous',2520),
  ('16451','16','16450','Painting Works','Enamel Paint','Enamel Paint',2530),
  ('17051','17','17050','Aluminum Glass & Glazing Works','Curtain Wall','Curtain Wall',2540),
  ('17101','17','17100','Aluminum Glass & Glazing Works','Aluminum Punch Windows','Aluminum Punch Windows',2550),
  ('17151','17','17150','Aluminum Glass & Glazing Works','Aluminum Swing Windows','Aluminum Swing Windows',2560),
  ('17201','17','17200','Aluminum Glass & Glazing Works','Aluminum Sliding Windows','Aluminum Sliding Windows',2570),
  ('17251','17','17250','Aluminum Glass & Glazing Works','Aluminum Doors','Aluminum Doors',2580),
  ('17301','17','17300','Aluminum Glass & Glazing Works','Louvers & Vents','Louvers & Vents',2590),
  ('17351','17','17350','Aluminum Glass & Glazing Works','Aluminum Cladding Panel','Aluminum Cladding Panel',2600),
  ('17401','17','17400','Aluminum Glass & Glazing Works','Glass Door and Window','Glass Door and Window',2610),
  ('17451','17','17450','Aluminum Glass & Glazing Works','Glass Railing','Glass Railing',2620),
  ('17501','17','17500','Aluminum Glass & Glazing Works','Wall Glass/ Mirror Finish','Wall Glass / Mirror Finish',2630),
  ('17551','17','17550','Aluminum Glass & Glazing Works','Canopy','Glass Canopy',2640),
  ('18051','18','18050','Cabinetry','Kitchen Cabinet','Kitchen Cabinet',2650),
  ('18101','18','18100','Cabinetry','Kitchen Countertop','Kitchen Countertop',2660),
  ('18151','18','18150','Cabinetry','Bedroom Closet','Bedroom Closet',2670),
  ('18201','18','18200','Cabinetry','Reception Counter','Reception Counter',2680),
  ('19051','19','19050','Landscape & Amenities','Hardscape','Hardscape',2690),
  ('19101','19','19100','Landscape & Amenities','Softscape','Softscape',2700),
  ('19151','19','19150','Landscape & Amenities','Swimming Pool','Swimming Pool',2710),
  ('191511','19','19150','Landscape & Amenities','Swimming Pool','Swimming Pool',2720),
  ('19201','19','19200','Landscape & Amenities','Water Features','Water Features',2730),
  ('20051','20','20050','Specialties','Signage','Signage',2740),
  ('20052','20','20050','Specialties','Signage','Bulletin Board',2750),
  ('20101','20','20100','Specialties','Cubicle Partition','Cubicle Partition',2760),
  ('20151','20','20150','Specialties','Equipment and Appliances','Equipment and Appliances',2770),
  ('201511','20','20150','Specialties','Equipment and Appliances','MEPF Provisional Cost - Kitchen Equipment',2780),
  ('20201','20','20200','Specialties','Wall Paper Finishes','Wall Paper Finishes',2790),
  ('20251','20','20250','Specialties','Lockers and Mailbox','Lockers and Mailbox',2800),
  ('20301','20','20300','Specialties','Prefabricated Toilet','Prefabricated Toilet',2810),
  ('21051','21','21050','Laminates & Plastic Finishes','Laminates & Plastic Finishes','Wall Laminate Wood Finish',2820),
  ('22051','22','22050','Roof Sheeting & Insulation','Roof Sheeting & Insulation','Roofing Materials',2830),
  ('23051','23','23050','Architectural Miscellaneous Works','Architectural Miscellaneous works','Scaffolding works (Rental)',2840),
  ('23052','23','23050','Architectural Miscellaneous Works','Architectural Miscellaneous works','Fitout Works',2850),
  ('24051','24','24050','Mill Works','Mill Works','Carpentry Works',2860),
  ('25051','25','25050','Mechanical Equipment','Mechanical Equipment','ME Air Handling Units (AHU)',2870),
  ('250511','25','25050','Mechanical Works','Mechanical Equipment','ME Air Handling Units (AHU)',2880),
  ('25052','25','25050','Mechanical Equipment','Mechanical Equipment','ME Primary Air Handling Units  (PAHU)',2890),
  ('250521','25','25050','Mechanical Works','Mechanical Equipment','ME Primary Air Handling Units (PAHU)',2900),
  ('25053','25','25050','Mechanical Equipment','Mechanical Equipment','ME Fan Coil Units (FCU)',2910),
  ('250531','25','25050','Mechanical Works','Mechanical Equipment','ME Fan Coil Units (FCU)',2920),
  ('25054','25','25050','Mechanical Equipment','Mechanical Equipment','ME Air Cooled Condensing Units (ACCU)',2930),
  ('25055','25','25050','Mechanical Equipment','Mechanical Equipment','ME Window Airconditioning Units (WAC)',2940),
  ('250551','25','25050','Mechanical Works','Mechanical Equipment','ME Window Airconditioning Units (WAC)',2950),
  ('25056','25','25050','Mechanical Equipment','Mechanical Equipment','ME Exhaust Fan (EF)',2960),
  ('250561','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Exhaust Fan (EF)',2970),
  ('250562','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Toilet Exhaust Fan (TEF)',2980),
  ('250563','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Smoke Extraction Fan (SEF)',2990),
  ('250564','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Smoke Make-up Fans (SMF)',3000),
  ('250565','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Kitchen Exhaust Fans (KEF)',3010),
  ('250566','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Kitchen Supply Fans (KSF)',3020),
  ('250567','25','25050','Mechanical Works','Mechanical Equipment','OSM - ME Kitchen Steam Exhaust Fans (KSEF)',3030),
  ('25057','25','25050','Mechanical Equipment','Mechanical Equipment','ME Fresh Air Fan (FAF)',3040),
  ('250571','25','25050','Mechanical Works','Mechanical Equipment','ME Fresh Air Fan (FAF)',3050),
  ('25058','25','25050','Mechanical Equipment','Mechanical Equipment','ME Pressurization Fan (PF)',3060),
  ('250581','25','25050','Mechanical Works','Mechanical Equipment','ME Pressurization Fan (PF)',3070),
  ('25059','25','25050','Mechanical Equipment','Mechanical Equipment','ME Jet Fan (JF)',3080),
  ('250591','25','25050','Mechanical Works','Mechanical Equipment','ME Jet Fan (JF)',3090),
  ('25060','25','25050','Mechanical Equipment','Mechanical Equipment','ME Refrigerant Gas',3100),
  ('25061','25','25050','Mechanical Equipment','Mechanical Equipment','ME Carbon Monoxide Monitoring System',3110),
  ('25062','25','25050','Mechanical Equipment','Mechanical Equipment','ME Cooling Tower',3120),
  ('250621','25','25050','Mechanical Works','Mechanical Equipment','ME Cooling Tower',3130),
  ('250622','25','25050','Mechanical Works','Mechanical Equipment','ME Water Chiller (OSM)',3140),
  ('250623','25','25050','Mechanical Works','Mechanical Equipment','Cooling Tower Piping Works (B.I Pipes OSM)',3150),
  ('25063','25','25050','Mechanical Equipment','Mechanical Equipment','ME Water Chiller',3160),
  ('25064','25','25050','Mechanical Equipment','Mechanical Equipment','ME Electrostatic Precipitator',3170),
  ('250641','25','25050','Mechanical Works','Mechanical Equipment','ME Electrostatic Precipitator',3180),
  ('25065','25','25050','Mechanical Equipment','Mechanical Equipment','ME Air Ionizer / Smoke Purifier',3190),
  ('250651','25','25050','Mechanical Works','Mechanical Equipment','ME Air Ionizer / Smoke Purifier',3200),
  ('25101','25','25100','Mechanical Equipment','Refrigerant Pipe Works','Refrigerant Pipe, Fittings, and Insulation',3210),
  ('251011','25','25100','Mechanical Works','Refrigerant Pipe Works','Refrigerant Pipe, Fittings, and Insulation',3220),
  ('25102','25','25100','Mechanical Equipment','Refrigerant Pipe Works','Electrical Works - FCU',3230),
  ('251021','25','25100','Mechanical Works','Refrigerant Pipe Works','Electrical Works - FCU - Air Side',3240),
  ('25103','25','25100','Mechanical Equipment','Refrigerant Pipe Works','Electrical Works - ACCU',3250),
  ('251031','25','25100','Mechanical Works','Refrigerant Pipe Works','Electrical Works - ACCU - Water Side',3260),
  ('25104','25','25100','Mechanical Equipment','Refrigerant Pipe Works','Refrigerant Drain and Accessories',3270),
  ('25151','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Condenser Riser',3280),
  ('251511','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Condenser Riser (B.I Pipes)',3290),
  ('25152','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Condenser Branch',3300),
  ('251521','25','25150','Mechanical Works','Chilled Water AC Works','Condensate Drain, Tapping to the Nearest Drain',3310),
  ('251522','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Condenser Branch',3320),
  ('25153','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Evaporator Riser',3330),
  ('251531','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Evaporator Riser (B.I Pipes)',3340),
  ('25154','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Evaporator Branch',3350),
  ('251541','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Evaporator Branch (B.I Pipes)',3360),
  ('25155','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Valves and Accessories',3370),
  ('251551','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Valves and Accessories (Valves)',3380),
  ('25156','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Evaporator Pumps and Accessories',3390),
  ('251561','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Evaporator Pumps and Accessories (B.I Pipes)',3400),
  ('25157','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Condenser Pumps and Accessories',3410),
  ('251571','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Condenser Pumps and Accessories (B.I Pipes)',3420),
  ('25158','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Water Expansion Tank',3430),
  ('251581','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Water Expansion Tank & Air Separator (B.I Pipes)',3440),
  ('25159','25','25150','Mechanical Equipment','Chilled Water AC Works','Chilled Chemical Treatment',3450),
  ('251591','25','25150','Mechanical Works','Chilled Water AC Works','OSM - Chilled Chemical Treatment (B.I Pipes)',3460),
  ('25201','25','25200','Mechanical Equipment','Chilled Water AC Works','Fresh Air Duct Riser',3470),
  ('252011','25','25200','Mechanical Works','Chilled Water AC Works','Fresh Air Duct Riser',3480),
  ('25202','25','25200','Mechanical Equipment','Chilled Water AC Works','Fresh Air Duct Branch',3490),
  ('252021','25','25200','Mechanical Works','Chilled Water AC Works','Fresh Air Duct Branch',3500),
  ('25203','25','25200','Mechanical Equipment','Chilled Water AC Works','Fresh Air Duct Miscellaneous and Accessories',3510),
  ('252031','25','25200','Mechanical Works','Chilled Water AC Works','Fresh Air Duct Miscellaneous and Accessories',3520),
  ('25211','25','25210','Mechanical Equipment','Smoke Extraction Ducting Works','Smoke Extraction  Duct Riser',3530),
  ('252111','25','25210','Mechanical Works','Smoke Extraction Ducting Works','Smoke Extraction Duct Riser',3540),
  ('25212','25','25210','Mechanical Equipment','Smoke Extraction Ducting Works','Smoke Extraction  Branch',3550),
  ('25213','25','25210','Mechanical Equipment','Smoke Extraction Ducting Works','Smoke Extraction Miscellaneous and Accessories',3560),
  ('25251','25','25250','Mechanical Equipment','Exhaust Air Ducting Works','Exhaust Air Duct Riser',3570),
  ('252511','25','25250','Mechanical Works','Exhaust Air Ducting Works','Exhaust Air Duct Riser',3580),
  ('25252','25','25250','Mechanical Equipment','Exhaust Air Ducting Works','Exhaust Air Duct Branch',3590),
  ('252521','25','25250','Mechanical Works','Exhaust Air Ducting Works','Exhaust Air Duct Branch',3600),
  ('25253','25','25250','Mechanical Equipment','Exhaust Air Ducting Works','Exhaust Air Duct Miscellaneous and Accessories',3610),
  ('252531','25','25250','Mechanical Works','Exhaust Air Ducting Works','Exhaust Air Duct Miscellaneous and Accessories',3620),
  ('25301','25','25300','Mechanical Equipment','Toilet Exhaust Air Ducting Works','Toilet Exhaust Air Duct Riser',3630),
  ('253011','25','25300','Mechanical Works','Toilet Exhaust Air Ducting Works','Toilet Exhaust Air Duct Riser',3640),
  ('25302','25','25300','Mechanical Equipment','Toilet Exhaust Air Ducting Works','Toilet Exhaust Air Duct Branch',3650),
  ('253021','25','25300','Mechanical Works','Toilet Exhaust Air Ducting Works','Toilet Exhaust Air Duct Branch',3660),
  ('25303','25','25300','Mechanical Equipment','Toilet Exhaust Air Ducting Works','Toilet Exhaust Air Duct Miscellaneous and Accessories',3670),
  ('253031','25','25300','Mechanical Works','Toilet Exhaust Air Ducting Works','Toilet Exhaust Air Duct Miscellaneous and Accessories',3680),
  ('25351','25','25350','Mechanical Equipment','Air Cooled Ducting Works','AC Ducting Riser',3690),
  ('253511','25','25350','Mechanical Works','Air Cooled Ducting Works','AC Ducting Riser',3700),
  ('25352','25','25350','Mechanical Equipment','Air Cooled Ducting Works','AC Ducting Branch',3710),
  ('253521','25','25350','Mechanical Works','Air Cooled Ducting Works','AC Ducting Branch',3720),
  ('25353','25','25350','Mechanical Equipment','Air Cooled Ducting Works','AC Duct Miscellaneous and Accessories',3730),
  ('253531','25','25350','Mechanical Works','Air Cooled Ducting Works','OSM - ME Variable Air Volume (VAV)',3740),
  ('253532','25','25350','Mechanical Works','Air Cooled Ducting Works','AC Duct Miscellaneous and Accessories',3750),
  ('25401','25','25400','Mechanical Equipment','Return Air Ducting Works','Air Duct Return Riser',3760),
  ('25402','25','25400','Mechanical Equipment','Return Air Ducting Works','Air Duct Return Branch',3770),
  ('25403','25','25400','Mechanical Equipment','Return Air Ducting Works','Air Duct Miscellaneous and Accessories',3780),
  ('25451','25','25450','Mechanical Equipment','Pre Cooled Ducting Works','Pre Cooled Duct Riser',3790),
  ('25452','25','25450','Mechanical Equipment','Pre Cooled Ducting Works','Pre Cooled Duct Branch',3800),
  ('25453','25','25450','Mechanical Equipment','Pre Cooled Ducting Works','Pre Cooled Duct Miscellaneous and Accessories',3810),
  ('25501','25','25500','Mechanical Equipment','Stair Pressurization Ducting Works','Stair Pressurization Duct Riser',3820),
  ('255011','25','25500','Mechanical Works','Stair Pressurization Ducting Works','Stair Pressurization Duct Riser',3830),
  ('25502','25','25500','Mechanical Equipment','Stair Pressurization Ducting Works','Stair Pressurization Duct Branch',3840),
  ('255021','25','25500','Mechanical Works','Return Air Ducting Works','Air Duct Return Branch',3850),
  ('255022','25','25500','Mechanical Works','Stair Pressurization Ducting Works','Stair Pressurization Duct Branch',3860),
  ('25503','25','25500','Mechanical Equipment','Stair Pressurization Ducting Works','Stair Pressurization Miscellaneous and Accessories',3870),
  ('255031','25','25500','Mechanical Works','Return Air Ducting Works','Air Duct Return Miscellaneous and Accessories',3880),
  ('255032','25','25500','Mechanical Works','Stair Pressurization Ducting Works','Stair Pressurization Miscellaneous and Accessories',3890),
  ('25504','25','25500','Mechanical Equipment','Stair Pressurization Ducting Works','Pressurization Sensor',3900),
  ('255041','25','25500','Mechanical Works','Stair Pressurization Ducting Works','Stair Pressurization Duct Riser',3910),
  ('255042','25','25500','Mechanical Works','Stair Pressurization Ducting Works','Pressurization Sensor',3920),
  ('25551','25','25550','Mechanical Equipment','Stair Pressurization Ducting Works','Kitchen Exhaust Air Duct Riser',3930),
  ('255511','25','25550','Mechanical Works','Kitchen Exhaust Ducting Works','Smoke Extraction Duct Branch',3940),
  ('255512','25','25550','Mechanical Works','Kitchen Exhaust Ducting Works','Kitchen Exhaust Air Duct Riser',3950),
  ('25552','25','25550','Mechanical Equipment','Stair Pressurization Ducting Works','Kitchen Exhaust Air Duct Branch',3960),
  ('255521','25','25550','Mechanical Works','Kitchen Exhaust Ducting Works','Smoke Extraction Miscellaneous and Accessories',3970),
  ('255522','25','25550','Mechanical Works','Kitchen Exhaust Ducting Works','Kitchen Exhaust Air Duct Branch',3980),
  ('25553','25','25550','Mechanical Equipment','Stair Pressurization Ducting Works','Kitchen Exhaust Air Duct Miscellaneous and Accessories',3990),
  ('255532','25','25550','Mechanical Works','Kitchen Exhaust Ducting Works','Kitchen Exhaust Air Duct Miscellaneous and Accessories',4000),
  ('25601','25','25600','Mechanical Equipment','Generator and Fuel Piping Works','Generator Equipment',4010),
  ('256011','25','25600','Mechanical Works','Generator and Fuel Piping Works','Generator Equipment',4020),
  ('25602','25','25600','Mechanical Equipment','Generator and Fuel Piping Works','Generator Fuel Piping Works',4030),
  ('25603','25','25600','Mechanical Equipment','Generator and Fuel Piping Works','Generator Fuel Storage Tank Works',4040),
  ('25604','25','25600','Mechanical Equipment','Generator and Fuel Piping Works','Generator Level Controller and Accessories Works',4050),
  ('25605','25','25600','Mechanical Equipment','Generator and Fuel Piping Works','Generator Fuel Pumps',4060),
  ('25606','25','25600','Mechanical Works','Generator and Fuel Piping Works','LPG System',4070),
  ('25611','25','25610','Mechanical Equipment','LPG System','LPG System Main Pipe',4080),
  ('25612','25','25610','Mechanical Equipment','LPG System','LPG System Pipe Branches',4090),
  ('25613','25','25610','Mechanical Equipment','LPG System','LPG System Miscellaneous and Accessories',4100),
  ('256131','25','25610','Mechanical Works','LPG System','LPG System Miscellaneous and Accessories',4110),
  ('25651','25','25650','Mechanical Equipment','Mechanical Works Miscellaneous','Mechanical Works Miscellaneous',4120),
  ('256511','25','25650','Mechanical Works','Generator and Fuel Piping Works','Air Side System - Testing and Commissioning',4130),
  ('256512','25','25650','Mechanical Works','Generator and Fuel Piping Works','Air Side System - Hanger, Supports, and Others',4140),
  ('256513','25','25650','Mechanical Works','Generator and Fuel Piping Works','Water Side System - Testing and Commissioning',4150),
  ('256514','25','25650','Mechanical Works','Generator and Fuel Piping Works','Water Side System - Hanger, Supports, and Others',4160),
  ('25652','25','25650','Mechanical Equipment','Mechanical Works Miscellaneous','Mechanical Works Preliminaries',4170),
  ('256521','25','25650','Mechanical Works','Generator and Fuel Piping Works','General Requirements - Air Side',4180),
  ('256522','25','25650','Mechanical Works','Generator and Fuel Piping Works','General Requirements - Water Side',4190),
  ('25653','25','25650','Mechanical Works','Generator and Fuel Piping Works','Smoke Extraction  Miscellaneous and Accessories',4200),
  ('25701','25','25700','Mechanical Works','LPG System Main Pipe','LPG System Main Pipe',4210),
  ('25751','25','25750','Mechanical Works','Mechanical Works Miscellaneous','Mechanical Works Miscellaneous',4220),
  ('250541','25','61000','Mechanical Works','Mechanical Equipment','ME Air Cooled Condensing Units (ACCU)',4230),
  ('255531','25','61000','Mechanical Works','Mechanical Equipment','Smoke Sensor',4240),
  ('26051','26','26050','Electrical Works','Power System Works','Power System Conduits Works',4250),
  ('260511','26','26050','Electrical Works','Power System Works','Power System Conduits Works',4260),
  ('26052','26','26050','Electrical Works','Power System Works','Power System Boxes',4270),
  ('260521','26','26050','Electrical Works','Power System Works','Power System Boxes',4280),
  ('26053','26','26050','Electrical Works','Power System Works','Power System Feeder and Sub Feeder Line',4290),
  ('26054','26','26050','Electrical Works','Power System Works','Power System Grounding Works',4300),
  ('260541','26','26050','Electrical Works','Power System Works','Power System Grounding Works',4310),
  ('26101','26','26100','Electrical Works','Power System Utilities, Hallways, Lobby, Wiring, Wiring Devices, Lighting Works','Power System Utilities, Hallways, Lobby, Wiring, Wiring Devices, Lighting Works',4320),
  ('26151','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Panel Board',4330),
  ('261511','26','26150','Electrical Works','Power System Switchboard and Panel Board','Power System Switchboard and Panel Board - HV & LV',4340),
  ('261512','26','26150','Electrical Works','Power System Switchboard and Panel Board','Power System Switchboard and Panel Board - Power & Lighting',4350),
  ('26152','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Emergency Panel Board',4360),
  ('261521','26','26150','Electrical Works','Power System Switchboard and Panel Board','Power System Emergency Panel Board',4370),
  ('26153','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Car Lift Power Panel Board',4380),
  ('26154','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Lighting Panel Board',4390),
  ('26155','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Main Distribution Panelboard',4400),
  ('26156','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Low Voltage Switch Gear (LVSG)',4410),
  ('26157','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Automatic Transfer Switch (ATS)',4420),
  ('26158','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Manual Transfer Switch (MTS)',4430),
  ('26159','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Enclosed Circuit Breaker (ECB)',4440),
  ('26160','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Uninterruptible Power Supply',4450),
  ('261601','26','26150','Electrical Works','Power System Switchboard and Panel Board','Roughing-ins',4460),
  ('261602','26','26150','Electrical Works','Power System Switchboard and Panel Board','EL-04 UPS Equipment',4470),
  ('26161','26','26150','Electrical Works','Power System Switchboard and Panel board','Power System Synchronizing Panel',4480),
  ('261611','26','26150','Electrical Works','Power System Switchboard and Panel Board','Power System Synchronizing Panel',4490),
  ('26201','26','26200','Electrical Works','Power System Meter Center','Power System Meter Center',4500),
  ('26251','26','26250','Electrical Works','Power System Bus Duct','Power System Bus Way',4510),
  ('262512','26','26250','Electrical Works','Power System Bus Duct','Power System Bus Way',4520),
  ('26252','26','26250','Electrical Works','Power System Bus Duct','Power System Bus Way Accessories',4530),
  ('26301','26','26300','Electrical Works','Small Power Roughing-ins, Wires, Wiring Devices, Panel Board, ECB, Lighting Works','Small Power Roughing-ins, Wires, Wiring Devices, Panel Board, ECB, Lighting Works',4540),
  ('263011','26','26300','Electrical Works','Small Power Roughing-ins, Wires, Wiring Devices, Panel Board, ECB, Lighting Works','Small Power Roughing-ins, Wires, Wiring Devices, Lighting Works',4550),
  ('263012','26','26300','Electrical Works','MEPF Provisional','MEPF Provisional Cost - ELV',4560),
  ('26350','26','26350','Electrical Works','Lighting System Outdoor Works','Lighting System Outdoor Conduit Works',4570),
  ('26351','26','26350','Electrical Works','Lighting System Outdoor Works','Lighting System Outdoor Conduit Works',4580),
  ('26352','26','26350','Electrical Works','Lighting System Outdoor Works','Lighting System Outdoor Boxes',4590),
  ('26353','26','26350','Electrical Works','Lighting System Outdoor Works','Lighting System Outdoor Wires and Cable',4600),
  ('26354','26','26350','Electrical Works','Lighting System Outdoor Works','Lighting System Outdoor Wiring Devices',4610),
  ('26355','26','26350','Electrical Works','Lighting System Outdoor Works','Lighting System Outdoor Fixtures',4620),
  ('26401','26','26400','Electrical Works','Telephone System Works','Telephone System Conduits, Boxes, and Raceway',4630),
  ('26402','26','26400','Electrical Works','Telephone System Works','Telephone System Wires and Cables',4640),
  ('26403','26','26400','Electrical Works','Telephone System Works','Telephone System Wiring Devices and Equipment',4650),
  ('26451','26','26450','Electrical Works','Cable Antenna Television System (CATV)','Cable Antenna Television System Conduits, Boxes and Raceway',4660),
  ('26452','26','26450','Electrical Works','Cable Antenna Television System (CATV)','Cable Antenna Television System Wires and Cables',4670),
  ('26453','26','26450','Electrical Works','Cable Antenna Television System (CATV)','Cable Antenna Television System Wiring Devices and Equipment',4680),
  ('26501','26','26500','Electrical Works','Closed Circuit Television System (CCTV)','Closed Circuit Television System Conduits, Boxes and Raceway',4690),
  ('265011','26','26500','Electrical Works','Closed Circuit Television System (CCTV)','Security Systems',4700),
  ('265012','26','26500','Electrical Works','Closed Circuit Television System (CCTV)','Surveillance System',4710),
  ('26502','26','26500','Electrical Works','Closed Circuit Television System (CCTV)','Closed Circuit Television System Wires and Cables',4720),
  ('26503','26','26500','Electrical Works','Closed Circuit Television System (CCTV)','Closed Circuit Television System Wiring Devices and Equipment',4730),
  ('26551','26','26550','Electrical Works','Intercommunication System','Intercommunication System Conduits, Boxes and Raceway',4740),
  ('26552','26','26550','Electrical Works','Intercommunication System','Intercommunication System Wires and Cables',4750),
  ('26553','26','26550','Electrical Works','Intercommunication System','Intercommunication System Wiring Devices and Equipment',4760),
  ('26601','26','26600','Electrical Works','Entry Phone System','Entry Phone System Conduits, Boxes and Raceway',4770),
  ('26602','26','26600','Electrical Works','Entry Phone System','Entry Phone System Wires and Cables',4780),
  ('26603','26','26600','Electrical Works','Entry Phone System','Entry Phone System Wiring Devices and Equipment',4790),
  ('26651','26','26650','Electrical Works','Internet Systems','Internet System Conduits, Boxes and Raceway',4800),
  ('266511','26','26650','Electrical Works','Internet Systems','Internet System Conduits, Boxes and Raceway',4810),
  ('26652','26','26650','Electrical Works','Internet Systems','Internet System Wires and Cables',4820),
  ('26653','26','26650','Electrical Works','Internet Systems','Internet System Wiring Devices and Equipment',4830),
  ('26701','26','26700','Electrical Works','Public Address and Background Music (PABGM)','Public Address and Background Music Conduits, Boxes',4840),
  ('267011','26','26700','Electrical Works','Public Address and Background Music (PABGM)','Public Address and Background Music Conduits, Boxes',4850),
  ('26702','26','26700','Electrical Works','Public Address and Background Music (PABGM)','Public Address and Background Music Wires and Cables',4860),
  ('267021','26','26700','Electrical Works','Public Address and Background Music (PABGM)','Public Address and Background Music Wires and Cables',4870),
  ('26703','26','26700','Electrical Works','Public Address and Background Music (PABGM)','Public Address and Background Music Wiring Devices and Equipment',4880),
  ('26751','26','26750','Electrical Works','Fire Detection and Alarm System (FDAS)','Fire Detection and Alarm System Conduits, Boxes and Raceway',4890),
  ('267511','26','26750','Electrical Works','Fire Detection and Alarm System (FDAS)','Fire Detection and Alarm System Conduits, Boxes and Raceway',4900),
  ('26752','26','26750','Electrical Works','Fire Detection and Alarm System (FDAS)','Fire Detection and Alarm System Wires and Cables',4910),
  ('26753','26','26750','Electrical Works','Fire Detection and Alarm System (FDAS)','Fire Detection and Alarm System Wiring Devices and Equipment',4920),
  ('26801','26','26800','Electrical Works','Building Management Systems (BMS)','Building Management System Miscellaneous Works',4930),
  ('268011','26','26800','Electrical Works','Building Management Systems (BMS)','BMS',4940),
  ('268012','26','26800','Electrical Works','Building Management Systems (BMS)','Room Control Unit',4950),
  ('26802','26','26800','Electrical Works','Building Management Systems (BMS)','Building Management System Software / Program',4960),
  ('26851','26','26850','Electrical Works','Electrical Works Miscellaneous','Electrical Works Miscellaneous',4970),
  ('268511','26','26850','Electrical Works','Electrical Works Miscellaneous','Electrical Miscellaneous Works',4980),
  ('26852','26','26850','Electrical Works','Electrical Works Miscellaneous','Electrical Works Preliminaries',4990),
  ('268521','26','26850','Electrical Works','Electrical Works Miscellaneous','General Requirements - HV & LV',5000),
  ('268522','26','26850','Electrical Works','Electrical Works Miscellaneous','General Requirements - Busduct',5010),
  ('262012','26','61000','Electrical Works','Power System Switchboard and Panel Board','Power System Meter Center',5020),
  ('27051','27','27050','Plumbing Works','Plumbing Fixtures','Plumbing Fixtures - Type 1',5030),
  ('270511','27','27050','Plumbing Works','Plumbing Fixtures','Plumbing Fixtures - Type 1',5040),
  ('270512','27','27050','Plumbing Works','Plumbing Fixtures','Contingency - Structured Cabling System',5050),
  ('27052','27','27050','Plumbing Works','Plumbing Fixtures','Plumbing Fixtures - Type 2',5060),
  ('27053','27','27050','Plumbing Works','Plumbing Fixtures','Plumbing Fixtures - Type 3',5070),
  ('27054','27','27050','Plumbing Works','Plumbing Fixtures','Plumbing Fixtures - Type 4',5080),
  ('27055','27','27050','Plumbing Works','Plumbing Fixtures','Plumbing Fixtures - Type 5',5090),
  ('27101','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Main Source',5100),
  ('271011','27','27100','Plumbing Works','Waterline Distribution System','Cold Water line Main Source',5110),
  ('27102','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Upfeed',5120),
  ('271021','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Upfeed',5130),
  ('27103','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Downfeed',5140),
  ('27104','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Branches - Hallway',5150),
  ('271041','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Branches - Hallway',5160),
  ('27105','27','27100','Plumbing Works','Waterline Distribution System','Cold water line branches - Utilities',5170),
  ('271051','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Branches - Utilities',5180),
  ('27106','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Valves',5190),
  ('271061','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Valves',5200),
  ('27107','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Accessories',5210),
  ('271071','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Accessories',5220),
  ('27108','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Pumps',5230),
  ('271081','27','27100','Plumbing Works','Waterline Distribution System','Cold Water Line Pumps',5240),
  ('27151','27','27150','Plumbing Works','Sanitary Drainage System','Soil Stack',5250),
  ('271511','27','27150','Plumbing Works','Sanitary Drainage System','Soil Stack',5260),
  ('271512','27','27150','Plumbing Works','Sanitary Drainage System','Storm Drainage System - SOG',5270),
  ('27152','27','27150','Plumbing Works','Sanitary Drainage System','Soil Pipe',5280),
  ('271521','27','27150','Plumbing Works','Sanitary Drainage System','Soil Pipe',5290),
  ('27153','27','27150','Plumbing Works','Sanitary Drainage System','Waste Pipe',5300),
  ('271531','27','27150','Plumbing Works','Sanitary Drainage System','Waste Pipe',5310),
  ('271532','27','27150','Plumbing Works','Sanitary Drainage System','Waste Pipe - Tapping of External Damage',5320),
  ('27154','27','27150','Plumbing Works','Sanitary Drainage System','Waste Stack',5330),
  ('271541','27','27150','Plumbing Works','Sanitary Drainage System','Waste Stack',5340),
  ('271542','27','27150','Plumbing Works','Sanitary Drainage System','Soil, Waste and Vent System - SOG',5350),
  ('271543','27','27150','Plumbing Works','Sanitary Drainage System','Kitchen Waste System',5360),
  ('27201','27','27200','Plumbing Works','Storm Drainage System','Downspout',5370),
  ('272011','27','27200','Plumbing Works','Storm Drainage System','Downspout',5380),
  ('27202','27','27200','Plumbing Works','Storm Drainage System','Drain Pipe',5390),
  ('272021','27','27200','Plumbing Works','Storm Drainage System','Drain Pipe',5400),
  ('272022','27','27200','Plumbing Works','Storm Drainage System','Sundries',5410),
  ('27203','27','27200','Plumbing Works','Storm Drainage System','Drain and Accessories',5420),
  ('272031','27','27200','Plumbing Works','Storm Drainage System','Drain and Accessories',5430),
  ('27204','27','27200','Plumbing Works','Storm Drainage System','Vent Branches',5440),
  ('27251','27','27250','Plumbing Works','Pipe Vents System','Vent Stack',5450),
  ('272511','27','27250','Plumbing Works','Pipe Vents System','Vent Stack',5460),
  ('27252','27','27250','Plumbing Works','Pipe Vents System','Vent Branches',5470),
  ('272521','27','27250','Plumbing Works','Pipe Vents System','Vent Branches',5480),
  ('27301','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Pipe Sleeving / Blockouts',5490),
  ('27302','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Concrete Plinth and Pad',5500),
  ('27303','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Trench Drain and Grating',5510),
  ('273031','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Trench Drain and Grating',5520),
  ('27304','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Hangers, Support, and Thrust Blocks',5530),
  ('273041','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Hangers, Support, and Thrust Blocks',5540),
  ('27305','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Plumbing Consumables',5550),
  ('273051','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Plumbing Consumables',5560),
  ('27306','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Excavation, Backfilling, and Compaction',5570),
  ('27307','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Sand / Gravel Bedding',5580),
  ('27308','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Plumbing Works Testing / Flushing  / Commissioning',5590),
  ('273081','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Plumbing Works Testing / Flushing / Commissioning',5600),
  ('27309','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Plumbing Works Preliminaries',5610),
  ('273091','27','27300','Plumbing Works','Plumbing Miscellaneous Works','Tapping to External Drainage System',5620),
  ('273092','27','27300','Plumbing Works','Plumbing Miscellaneous Works','General Requirements - Waterline System, Sanitary & Vent System',5630),
  ('273093','27','27300','Plumbing Works','Plumbing Miscellaneous Works','General Requirements - Strom Drainage, Pumps Including Electrical Works & Condensate Drain',5640),
  ('273094','27','27300','Plumbing Works','Plumbing Miscellaneous Works','General Requirement - Plumbing and Drainage Works - SOG',5650),
  ('27351','27','27350','Plumbing Works','Sewer Treatment Plant (STP)','STP Mechanical Equipment and Works',5660),
  ('273511','27','27350','Plumbing Works','Sewer Treatment Plant (STP)','STP Mechanical Equipment and Works',5670),
  ('27352','27','27350','Plumbing Works','Sewer Treatment Plant (STP)','STP Electrical Equipment and Works',5680),
  ('27353','27','27350','Plumbing Works','Sewer Treatment Plant (STP)','STP Plumbing and Sanitary Works',5690),
  ('27401','27','27400','Plumbing Works','Plumbing Pumps and Equipment','Overhead Water Tank (OHP)',5700),
  ('274011','27','27400','Plumbing Works','Plumbing Pumps and Equipment','Overhead Water Tank (OHP)',5710),
  ('27402','27','27400','Plumbing Works','Plumbing Pumps and Equipment','Plumbing Pump and Accessories',5720),
  ('274021','27','27400','Plumbing Works','Plumbing Pumps and Equipment','Plumbing Pump and Accessories',5730),
  ('274022','27','27400','Plumbing Works','Plumbing Pumps and Equipment','Heat Pump Water Heating System',5740),
  ('27403','27','27400','Plumbing Works','Plumbing Pumps and Equipment','Plumbing Controllers',5750),
  ('27215','27','61000','Plumbing Works','Soil Pipe','Soil Pipe',5760),
  ('28051','28','28050','Fire Protection Works','Fire Protection Wet Stand Pipe Works','Fire Protection Wet Stand Pipe Riser',5770),
  ('280511','28','28050','Fire Protection Works','Fire Protection Wet Stand Pipe Works','Fire Protection Wet Stand Pipe Riser',5780),
  ('28052','28','28050','Fire Protection Works','Fire Protection Wet Stand Pipe Works','Fire Protection Wet Stand Valves and Accessories',5790),
  ('280521','28','28050','Fire Protection Works','Fire Protection Wet Stand Pipe Works','Fire Protection Wet Stand Valves and Accessories',5800),
  ('28101','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Feedmain',5810),
  ('281011','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Feedmain',5820),
  ('28102','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Feedmain Valve and Assembly',5830),
  ('281021','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Feedmain Valve and Assembly',5840),
  ('28103','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Cross Main',5850),
  ('281031','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Cross Main',5860),
  ('28104','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Branch Line',5870),
  ('281041','28','28100','Fire Protection Works','Fire Protection Main Fire Line Works','Fire Protection Branch Line',5880),
  ('28151','28','28150','Fire Protection Works','Fire Protection Drain Pipe Works','Fire Protection Drain Pipe Riser',5890),
  ('281511','28','28150','Fire Protection Works','Fire Protection Drain Pipe Works','Fire Protection Drain Pipe Riser',5900),
  ('28201','28','28200','Fire Protection Works','Fire Protection Dry Stand Pipe Works','Fire Protection Dry Stand Pipe Riser',5910),
  ('28251','28','28250','Fire Protection Works','Fire Protection Equiptment and Accessories Works','Fire Protection Sprinkler Head',5920),
  ('282511','28','28250','Fire Protection Works','Fire Protection Equiptment and Accessories Works','Fire Protection Sprinkler Head',5930),
  ('28252','28','28250','Fire Protection Works','Fire Protection Equiptment and Accessories Works','Fire Protection and Cabinet Works',5940),
  ('282521','28','28250','Fire Protection Works','Fire Protection Equiptment and Accessories Works','Fire Protection and Cabinet Works',5950),
  ('28253','28','28250','Fire Protection Works','Fire Protection Equiptment and Accessories Works','Fire Protection Pumps and Accessories',5960),
  ('282531','28','28250','Fire Protection Works','Fire Protection Equiptment and Accessories Works','Fire Protection Pumps and Accessories',5970),
  ('28301','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Hanger and Support',5980),
  ('283011','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Hanger and Support',5990),
  ('28302','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Pipe Sleeving / Blockouts',6000),
  ('28303','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Excavation, Backfilling, and Compaction',6010),
  ('28304','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Sand / Gravel Bedding',6020),
  ('28305','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Testing and Commissioning',6030),
  ('283051','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Suppression Testing and Commissioning',6040),
  ('28306','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Protection Preliminaries',6050),
  ('283061','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','General Requirements - FP-01',6060),
  ('283062','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','General Requirements - FP-02',6070),
  ('283063','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','General Requirements - FP-03',6080),
  ('28307','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Protection Firefighting Agent',6090),
  ('283071','28','28300','Fire Protection Works','Fire Protection Miscellaneous Works','Fire Protection Firefighting Agent',6100),
  ('29051','29','29050','Other Allied Services','Elevators','Passenger Elevator',6110),
  ('29052','29','29050','Other Allied Services','Elevators','Service Elevator',6120),
  ('29101','29','29100','Other Allied Services','Building Management Unit','BMU and Accessories',6130),
  ('29151','29','29150','Other Allied Services','Transformer','Transformer Equipment and accessories',6140),
  ('29201','29','29200','Other Allied Services','Escalator','Escalator',6150),
  ('29251','29','29250','Other Allied Services','Other Allied Miscellaneous Works','Other Allied Miscellaneous Works',6160),
  ('292511','29','29250','Other Allied Services','Other Allied Miscellaneous Works','Other Allied Miscellaneous Works',6170),
  ('29252','29','29250','Other Allied Services','Other Allied Miscellaneous Works','Generator',6180),
  ('30051','30','30050','Site Developments Works (Outside Bldg)','Site Development Works - Outside the Building','Site Development Works - Outside Building',6190),
  ('30052','30','30050','Site Developments Works (Outside Bldg)','Site Development Works - Outside the Building','Site Development Works - Lot Benching',6200),
  ('31051','31','31050','Defect Liability Period','Defect Liability Period','Defect Liability Period',6210),
  ('32051','32','32050','Rectification Works','Structural Rectification','Structural Rectification',6220),
  ('32101','32','32100','Rectification Works','Architectural Rectification','Architectural Rectification',6230),
  ('32151','32','32150','Rectification Works','MEPF Rectification','MEPF Rectification',6240),
  ('321511','32','32150','Rectification Works','MEPF Rectification','MEPF Rectification',6250),
  ('33051','33','33050','Change Order','Change Order','Change Order General Requirements',6260),
  ('33052','33','33050','Change Order','Change Order','Change Order Siteworks',6270),
  ('33053','33','33050','Change Order','Change Order','Change Order Structural Works',6280),
  ('33054','33','33050','Change Order','Change Order','Change Order Architectural Works',6290),
  ('33055','33','33050','Change Order','Change Order','Change Order Mechanical Works',6300),
  ('33056','33','33050','Change Order','Change Order','Change Order Electrical Works',6310),
  ('33057','33','33050','Change Order','Change Order','Change Order Plumbing Works',6320),
  ('33058','33','33050','Change Order','Change Order','Change Order Fire Protection Works',6330),
  ('33059','33','33050','Change Order','Change Order','Change Order Materials Escalation',6340),
  ('33060','33','33050','Change Order','Change Order','Change Order Labor Escalation',6350),
  ('330551','33','61000','Change Order','Change Order','Change Order Mechanical Works',6360),
  ('330553','33','61000','Change Order','Change Order','Change Order Mechanical Works',6370),
  ('330563','33','61000','Change Order','Change Order','Change Order Electrical Works',6380),
  ('330572','33','61000','Change Order','Change Order','Change Order Plumbing Works',6390),
  ('330573','33','61000','Change Order','Change Order','Change Order Plumbing Works',6400),
  ('34051','34','34050','Contingency','Contingency','Contingency',6410),
  ('340511','34','34050','Contingency',';','Contingency - Power System Main Feeder Works',6420),
  ('340512','34','34050','Contingency','Contingency','Contingency - Small Power Roughing-ins, Wires, Wiring Devices, Lighting Works',6430),
  ('35051','35','35050','Buyback','Buyback','Buyback',6440),
  ('36051','36','36050','Advances','Advances','Advance to Subcon',6450),
  ('36052','36','36050','Advances','Advances','Advance to Employee',6460),
  ('36053','36','36050','Advances','Advances','Advance to Client',6470),
  ('37051','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Roadworks',6480),
  ('37052','37','37050','Infrastructure Works','Solar Energy Infrastructure','Construction of Guard House',6490),
  ('37053','37','37050','Infrastructure Works','Solar Energy Infrastructure','Construction of Guard Post',6500),
  ('37054','37','37050','Infrastructure Works','Solar Energy Infrastructure','Construction of Materials Recovery Facility',6510),
  ('37055','37','37050','Infrastructure Works','Solar Energy Infrastructure','Construction of Warehouse',6520),
  ('37056','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Maintenance and Other Services',6530),
  ('37057','37','37050','Infrastructure Works','Solar Energy Infrastructure','Solar Mounting Structures',6540),
  ('37058','37','37050','Infrastructure Works','Solar Energy Infrastructure','Photovoltaic Modules',6550),
  ('37059','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF String Inverters',6560),
  ('37060','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Medium Voltages Stations',6570),
  ('37061','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Low Voltages Stations',6580),
  ('37062','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Weather Stations',6590),
  ('37063','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF String Cables',6600),
  ('37064','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF MVAC Cables',6610),
  ('37065','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF LVAC Cables',6620),
  ('37066','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF FO Cables',6630),
  ('37067','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Instrument Cables',6640),
  ('37068','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Testing and Commissioning',6650),
  ('37069','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Spares',6660),
  ('37070','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Cable Trenching',6670),
  ('37071','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Inverter Foundation',6680),
  ('37072','37','37050','Infrastructure Works','Solar Energy Infrastructure','Weather  Foundation',6690),
  ('37073','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Drainage Works',6700),
  ('37074','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Bridge Works',6710),
  ('37075','37','37050','Infrastructure Works','Solar Energy Infrastructure','SF Culvert Works',6720),
  ('38051','38','38050','Horizontal Housing Works','Horizontal Housing','Labor Works Horizontal Housing',6730),
  ('39051','39','39050','Land Development Works','LD Roadworks','LD Roadworks',6740),
  ('39052','39','39050','Land Development Works','LD Roadworks','LD Curb and Gutter',6750),
  ('39053','39','39050','Land Development Works','LD Roadworks','LD Cut and Fill Works',6760),
  ('39054','39','39050','Land Development Works','LD Roadworks','LD Sub-base and Base Coarse',6770),
  ('39055','39','39050','Land Development Works','LD Roadworks','LD Concreting Works',6780),
  ('39056','39','39050','Land Development Works','LD Roadworks','LD Asphalting Works',6790),
  ('39101','39','39100','Land Development Works','LD Drainage Works','LD Drainage Line Works',6800),
  ('39102','39','39100','Land Development Works','LD Drainage Works','LD Drainage Line accessories',6810),
  ('39151','39','39150','Land Development Works','LD Potable Waterline Works','LD Potable Waterline Works',6820),
  ('39152','39','39150','Land Development Works','LD Potable Waterline Works','LD Potable Waterline Accessories',6830),
  ('39201','39','39200','Land Development Works','LD Sewerline Works','LD Sewer Pipe Works',6840),
  ('39202','39','39200','Land Development Works','LD Sewerline Works','LD Sewer Pipe Manhole',6850),
  ('39203','39','39200','Land Development Works','LD Sewerline Works','LD Sewer Pipe Accessories',6860),
  ('39251','39','39250','Land Development Works','LD Underground Distribution System','LD Electrical Manhole Works',6870),
  ('39252','39','39250','Land Development Works','LD Underground Distribution System','LD Ductbank Works',6880),
  ('39253','39','39250','Land Development Works','LD Underground Distribution System','LD Miscellaneous and Accessories',6890),
  ('39301','39','39300','Land Development Works','LD Telecom Works','LD Telecom Manhole Works',6900),
  ('39302','39','39300','Land Development Works','LD Telecom Works','LD Telecom Duct Bank Works',6910),
  ('39303','39','39350','Land Development Works','LD Exterior Lighting Works','LD Telecom Miscellaneous and Accessories',6920),
  ('39351','39','39350','Land Development Works','LD Exterior Lighting Works','LD Exterior Light Electrical Works',6930),
  ('39352','39','39350','Land Development Works','LD Exterior Lighting Works','LD Exterior Light Duct bank',6940),
  ('39353','39','39350','Land Development Works','LD Exterior Lighting Works','LD Exterior Light Chamber',6950),
  ('39354','39','39350','Land Development Works','LD Exterior Lighting Works','LD Exterior Light Miscellaneous and Accessories',6960),
  ('39401','39','39400','Land Development Works','LD Sewer Pumps Works','LD Sewer Pumps and Valve  Works',6970),
  ('39402','39','39400','Land Development Works','LD Sewer Pumps Works','LD Sewer Pumps and Valve Miscellaneous and Accessories',6980),
  ('50000','50','50000','Due To / From Other Database','Due To / From Other Database','Due To / From Other Database',6990),
  ('51000','51','51000','Petty Cash','Petty Cash','Petty Cash',7000),
  ('NOBDT','61','61000','No Budget','No Budget','No Budget',7010)
on conflict (code) do update set
  code_l1 = excluded.code_l1, code_l2 = excluded.code_l2,
  desc_l1 = excluded.desc_l1, desc_l2 = excluded.desc_l2, desc_l3 = excluded.desc_l3,
  sort_order = excluded.sort_order;

-- Sanity checks:
--   select count(*) from class_codes;                                    -- expect 702
--   select count(distinct code_l1), count(distinct code_l2) from class_codes;  -- 42, 205
--   select code, desc_l1, desc_l3 from class_codes
--    where code in ('015051','15051','017151','17151') order by code;    -- expect 4 distinct rows


-- ==========================================================================
-- [092/142] 2026-08-21-mom-schema-carryover-distribute.sql
-- ==========================================================================
-- ============================================================================
-- Migration: MINUTES OF MEETING — richer item schema, carry-over, draft/distribute.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run) —
-- but see the ⚠️ ONE-SHOT BACKFILL note in section 2, which is guarded so that a
-- re-run cannot move the same text twice.
--
-- Three changes the owner asked for together, in the order they depend on:
--
--   1. mom_items gains the fields the standalone mom-app has and this table did
--      not (`item_no` / `category` / `type` / `issue`, plus `action_item`), so the
--      PDF export stops mapping three printed blocks onto one stored field.
--   2. Carry-over: a new meeting can be seeded with the still-open actions of an
--      earlier one, CARRYING THE REGISTER LINK rather than re-raising.
--   3. Draft → Distribute: minutes are private to their recorder until issued.
--
-- ⚠️ 2 AND 3 ARE WHY THIS IS ONE FILE AND NOT THREE. Carry-over copies `issue_id`,
--    which changes what `mom_has_raised()` should mean (section 4), and the delete
--    policy that calls it was written in 2026-08-20-department-minutes.sql. And
--    distribution gates BOTH what can be read (section 5) and what may be raised
--    into the register (section 6). Split apart, any one of them leaves the other
--    two describing rules that are no longer true.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "column does not exist" -------
do $$
begin
  if to_regclass('public.meeting_minutes') is null then
    raise exception 'meeting_minutes is missing — run migrations/2026-08-19-duration-scenarios-and-mom.sql first';
  end if;
  if to_regprocedure('public.mom_is_mine(uuid)') is null then
    raise exception 'mom_is_mine() is missing — run migrations/2026-08-20-department-minutes.sql first';
  end if;
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
end $$;


-- ============================================================================
-- 1) mom_items: the fields mom-app has and this table did not
-- ============================================================================
-- `seq` is NOT replaced by `item_no`. They answer different questions: `seq` is
-- the sort key the app maintains, `item_no` is the label a chair types on the
-- agenda ("3b", "carried from #12"). mom-app's `no` is free text for exactly that
-- reason, so this is text too — an int would refuse half the numbers in real use.
alter table mom_items add column if not exists item_no  text;
alter table mom_items add column if not exists category text;

-- The three-way classification the PDF badges. ⚠️ Constrained, unlike mom-app,
-- which lets any string in and then colours only three of them — a typo there
-- prints in the default grey and nobody finds out until the sheet is issued.
alter table mom_items add column if not exists type text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mom_items_type_chk') then
    alter table mom_items add constraint mom_items_type_chk
      check (type is null or type in ('Issue', 'FYI', 'Report'));
  end if;
end $$;

-- `issue` is the agenda topic — what was raised. `description` is the elaboration.
-- `action_item` is what somebody will now go and do. mom-app carries all three;
-- this table carried one.
alter table mom_items add column if not exists issue text;


-- ============================================================================
-- 2) ⚠️ ONE-SHOT BACKFILL: the action text moves out of `description`
-- ============================================================================
-- ⚠️ READ THIS BEFORE EDITING. `mom_items.description` has, since the table was
-- created, held THE ACTION — "Resequence L4 formworks", not a description of
-- anything. The PDF export already maps it to the sheet's "Action Item" block for
-- that reason. Now that `action_item` exists as its own column, leaving the text
-- in `description` would mean the same field means the action on old rows and the
-- elaboration on new ones, and no query could tell which.
--
-- So the text MOVES: description -> action_item, and description is emptied.
--
-- ⚠️ GUARDED ON THE COLUMN NOT HAVING EXISTED, not on the data. The obvious
--    idempotency test — "backfill where action_item is null" — is wrong: once a
--    user legitimately clears an action_item, a re-run would refill it from a
--    description that is now a different field, silently. Doing the move only in
--    the run that creates the column makes a re-run a no-op by construction.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mom_items' and column_name = 'action_item'
  ) then
    alter table mom_items add column action_item text;
    update mom_items set action_item = description where coalesce(description, '') <> '';
    update mom_items set description = '' where coalesce(description, '') <> '';
    raise notice 'mom_items: action text moved from description to action_item.';
  end if;
end $$;

-- `description` was `not null` because it WAS the action and an action with no
-- text is not an action. It is now the optional middle block, so the constraint
-- goes — but the default stays '' rather than null so nothing has to handle both
-- kinds of empty.
alter table mom_items alter column description drop not null;
alter table mom_items alter column description set default '';


-- ============================================================================
-- 3) Carry-over provenance
-- ============================================================================
-- Which item this one was carried from, and which meeting a minute was seeded
-- from. Both `on delete set null`: deleting the SOURCE meeting must not delete
-- the meeting that carried its actions forward — that would destroy the newer
-- record to tidy the older one.
alter table mom_items add column if not exists carried_from_item_id uuid
  references mom_items(id) on delete set null;
alter table meeting_minutes add column if not exists carried_from_mom_id uuid
  references meeting_minutes(id) on delete set null;

create index if not exists mom_items_carried_idx on mom_items (carried_from_item_id);


-- ============================================================================
-- 4) ⚠️ `mom_has_raised()` is re-defined, because carry-over changes what it means
-- ============================================================================
-- The delete policy in 2026-08-20-department-minutes.sql lets you delete your own
-- minutes only while nothing has been raised from them. The reason was precise:
-- issues in the register point BACK at the minute they came from, and
-- `on delete set null` strips that provenance silently rather than failing.
--
-- ⚠️ CARRY-OVER BREAKS THAT TEST AS WRITTEN. A carried item has an `issue_id` —
--    it is the same issue, still being chased — so the moment you seed a new
--    meeting from an old one, the OLD test says "something has been raised here"
--    and your brand-new draft becomes planner-delete-only. Nobody raised anything.
--
-- The provenance pointer (`issues_lessons.mom_id`) names the meeting the issue was
-- FIRST raised from, and carry-over never moves it. So deleting a meeting that
-- merely CARRIED the action destroys no provenance at all, and the test is
-- correspondingly narrowed to actions first raised HERE.
create or replace function mom_has_raised(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from mom_items i
    where i.mom_id = p_mom
      and i.issue_id is not null
      and i.carried_from_item_id is null   -- carried, not raised here
  );
$$;


-- ============================================================================
-- 5) Draft → Distribute
-- ============================================================================
alter table meeting_minutes add column if not exists is_distributed boolean not null default false;
alter table meeting_minutes add column if not exists distributed_by uuid references users(id);

-- ⚠️ EXISTING MINUTES ARE BACKFILLED TO DISTRIBUTED, and the column defaults to
--    false only for rows created from here on. Every minute already in the table
--    was written in a world with no draft concept: it is already being read by the
--    site and already has actions raised off it. Letting the `false` default apply
--    to them would retroactively hide the entire history from everyone except each
--    minute's recorder — a data-loss-shaped event with no data lost.
--
-- ⚠️ Guarded on `distributed_at` NOT HAVING EXISTED, the same construction as the
--    section-2 backfill and for the same reason. The tempting data test — "nothing
--    is distributed yet, so this must be the first run" — is wrong: it is also true
--    of a project that has distributed nothing, or has reverted everything to
--    draft, and on those a re-run would publish every draft in the table.
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meeting_minutes' and column_name = 'distributed_at'
  ) then
    alter table meeting_minutes add column distributed_at timestamptz;
    update meeting_minutes set is_distributed = true,
                               distributed_at = coalesce(updated_at, created_at, now());
    get diagnostics n = row_count;
    raise notice 'meeting_minutes: % pre-existing minute(s) marked distributed.', n;
  end if;
end $$;

-- "Can this person see this minute at all?" — drafts are private to their
-- recorder (and to planners, who maintain the register).
create or replace function mom_is_visible(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meeting_minutes m
    where m.id = p_mom
      and (m.is_distributed or m.created_by = auth.uid() or is_planner())
  );
$$;

-- "Has this minute been issued?" — the guard on raising into the register.
create or replace function mom_is_distributed(p_mom uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select m.is_distributed from meeting_minutes m where m.id = p_mom), false);
$$;

grant execute on function mom_is_visible(uuid), mom_is_distributed(uuid) to authenticated;

-- ⚠️ READ is narrowed — this is the only part of draft/distribute that is a
--    SECURITY boundary, and so the only part enforced here. The "a distributed
--    minute is locked for editing" half is UI-only, deliberately: it is a workflow
--    guard, not a permission, and the person it stops is the one who may legally
--    revert it to draft two clicks later. (UI stricter than RLS is safe; the
--    reverse is the silent-failure trap the department-issues migration removed.)
drop policy if exists meeting_minutes_read on meeting_minutes;
create policy meeting_minutes_read on meeting_minutes
  for select using (
    can_access_project(project_id)
    and (is_distributed or created_by = auth.uid() or is_planner())
  );

-- ⚠️ mom_items MUST match, or a draft's action items are readable by everyone
--    while the minute heading them is not — which is the leak, not a lesser
--    version of it: the actions are the substance.
drop policy if exists mom_items_read on mom_items;
create policy mom_items_read on mom_items
  for select using (
    can_access_project(project_id) and mom_is_visible(mom_id)
  );


-- ============================================================================
-- 6) An action cannot be raised into the register out of an undistributed minute
-- ============================================================================
-- ⚠️ The register is the shared artefact. Raising from a draft publishes a line
--    out of a meeting record nobody has issued — and worse, the issue's "Raised
--    at: …" provenance would point at a minute the reader is not allowed to open
--    (section 5). Enforced in the DATABASE rather than the UI because, unlike the
--    edit lock, this one leaves a permanent row behind if it slips through.
drop policy if exists issues_lessons_ins on issues_lessons;
create policy issues_lessons_ins on issues_lessons
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    -- Stamped as yourself. Without this a department user could file an issue
    -- under someone else's name, and "who raised this?" stops being answerable.
    -- ⚠️ Planners/admins are exempt: the Minutes-of-Meeting "raise as issue" flow
    -- and any future bulk import legitimately create rows on behalf of others.
    and (created_by = auth.uid() or is_planner())
    -- New in this migration. An issue with no `mom_id` is a normal register entry
    -- and is unaffected.
    and (mom_id is null or mom_is_distributed(mom_id))
  );


-- ============================================================================
-- 7) Grants unchanged
-- ============================================================================
grant select, insert, update, delete on meeting_minutes to authenticated;
grant select, insert, update, delete on mom_items to authenticated;

-- Done.


-- ==========================================================================
-- [093/142] 2026-08-21-mom-type-and-attachments.sql
-- ==========================================================================
-- ============================================================================
-- Migration: MINUTES OF MEETING — meeting type + per-action attachments.
--
-- The second and last batch of mom-app parity. Run this whole file in the
-- Supabase SQL editor. Idempotent (safe to re-run).
--
-- Run 2026-08-21-mom-schema-carryover-distribute.sql FIRST — this file assumes
-- the columns it added.
--
-- Two things the standalone mom-app has that this module did not:
--   1. `meeting_type` on the minute. ⚠️ In mom-app this is not decoration: the
--      meetings list is GROUPED by it, which is what keeps a project's weekly
--      coordination minutes from being buried among its client meetings.
--   2. An attachment per action item — the photo or PDF someone tabled.
-- ============================================================================

-- ---- 0) Guard: fail readably rather than with "column does not exist" -------
do $$
begin
  if to_regclass('public.mom_items') is null then
    raise exception 'mom_items is missing — run migrations/2026-08-19-duration-scenarios-and-mom.sql first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mom_items' and column_name = 'action_item'
  ) then
    raise exception 'run migrations/2026-08-21-mom-schema-carryover-distribute.sql first';
  end if;
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
  if to_regprocedure('public.is_planner()') is null then
    raise exception 'is_planner() is missing — run migrations/2026-06-30-workspaces-project-selector.sql first';
  end if;
end $$;


-- ============================================================================
-- 1) meeting_type
-- ============================================================================
-- ⚠️ FREE TEXT, NO CHECK CONSTRAINT — deliberately, and this is the opposite
--    call from `mom_items.type` in the previous migration. `type` has three
--    fixed values the PDF badges by name, so a typo there prints in the default
--    grey and nobody finds out until the sheet is issued. A meeting type is
--    project vocabulary ("Weekly Coordination", "Client Progress Meeting",
--    "Safety Toolbox") that nobody can enumerate up front — mom-app lets an
--    admin add one at runtime, and a CHECK would turn that into a migration.
--
-- ⚠️ The fragmentation risk a CHECK would have covered is handled in the UI
--    instead: the control offers the canonical starter list UNION every type
--    already used on this project, so the second person to minute a weekly
--    coordination meeting picks the existing spelling rather than inventing one.
--    That is the same construction the drawing register's `phaseOptions()` uses.
alter table meeting_minutes add column if not exists meeting_type text;

-- The meetings list groups by type and orders by date within each group.
create index if not exists meeting_minutes_type_idx
  on meeting_minutes (project_id, meeting_type, meeting_date desc);


-- ============================================================================
-- 2) Per-action attachment
-- ============================================================================
-- ⚠️ `attachment_url` HOLDS THE OBJECT PATH, NOT A URL, despite the name — which
--    is kept for parity with mom-app's column. The same deliberate mismatch as
--    `drawing_register.file_url`, and for the same reason: the bucket is PRIVATE,
--    so the only way to read the file is a short-lived signed URL minted on
--    demand. Storing a URL would store one that has already expired.
alter table mom_items add column if not exists attachment_url  text;
alter table mom_items add column if not exists attachment_name text;


-- ============================================================================
-- 3) Storage bucket
-- ============================================================================
-- ⚠️ PRIVATE. mom-app's bucket is PUBLIC and it stores
--    `/storage/v1/object/public/…` URLs, so anybody holding the link reads the
--    file with no login at all. That is not copied here: minutes attachments are
--    site photos and commercial documents, and every other bucket in this app is
--    private + signed-URL. Deliberate divergence from parity.
insert into storage.buckets (id, name, public)
values ('mom-attachments', 'mom-attachments', false)
on conflict (id) do nothing;

-- ⚠️ INSERT is `is_writer()`, NOT the `is_approved()` the 2026-06-18 buckets use.
--    That older rule predates the viewer-readonly work and lets a VIEWER upload
--    into a register they cannot write a row to — an orphan file by construction,
--    since they cannot attach it to anything. A new bucket has no legacy uploads
--    to protect, so it starts on the correct rule rather than inheriting the drift.
--
-- ⚠️ DELETE keeps the `owner = auth.uid()` branch beside `is_planner()`, matching
--    the settled rule on the other three buckets: a planner deleting an action
--    someone else attached to must actually remove the object, or the row goes and
--    the file is orphaned — while the uploader keeps the right to remove their own.
drop policy if exists mom_attachments_read on storage.objects;
create policy mom_attachments_read on storage.objects
  for select using (bucket_id = 'mom-attachments' and is_approved());

drop policy if exists mom_attachments_ins on storage.objects;
create policy mom_attachments_ins on storage.objects
  for insert with check (bucket_id = 'mom-attachments' and is_writer());

drop policy if exists mom_attachments_del on storage.objects;
create policy mom_attachments_del on storage.objects
  for delete using (
    bucket_id = 'mom-attachments' and (owner = auth.uid() or is_planner())
  );

-- Verify:
--   select id, public from storage.buckets where id = 'mom-attachments';
--   select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--   from pg_policy where polrelid = 'storage.objects'::regclass
--     and polname like 'mom_attachments%' order by polname;

-- Done.


-- ==========================================================================
-- [094/142] 2026-08-21-schedule-split-change-orders.sql
-- ==========================================================================
-- ============================================================================
-- Migration: SPLIT a main-contract activity around a CHANGE ORDER.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- THE PROBLEM. A variation is rarely a tidy activity bolted onto the end of the
-- schedule. "Additional slab openings on L5" happens PARTWAY THROUGH Formworks
-- L5: the main-contract crew stops, the CO work happens, the crew resumes. On
-- the Gantt that is one line item whose bar is split in two with the change
-- order sitting in the gap.
--
-- WHY TWO ACTIVITIES AND NOT ONE ACTIVITY THAT KNOWS IT IS SPLIT. The tidier
-- model is a single activity carrying a list of suspend/resume spans (P6's
-- idiom). It was rejected on purpose: it would mean teaching the CPM forward and
-- backward passes, the Gantt, the WBS roll-ups, the vertical stacking, the
-- S-curves and every export about a new kind of thing. Two ordinary activities
-- need none of that — every one of those consumers already understands
-- activities — and this module has been bitten repeatedly by clever derived
-- representations drifting out of step with the data (the WBS code that was
-- secretly the tree; phase inheritance; the dotted-prefix roll-up). Two boring
-- rows cannot drift. The single-row APPEARANCE is a rendering concern, and
-- `split_group` is what the renderer joins on.
--
-- WHY THE FINISH EXTENDS. seg1 + CO + seg2 finishes later than the original
-- activity did, and successors move with it. That is the honest CPM result and
-- it is what evidences the variation's time impact; holding the original finish
-- and compressing the remainder would hide exactly the thing a CO claim is
-- about.
-- ============================================================================

-- ---- 1) The columns --------------------------------------------------------
-- split_group: shared by every segment of one original activity (and null on an
-- activity that has never been split, which is almost all of them). Not a
-- foreign key: the group has no row of its own — it IS the set of segments, and
-- inventing a parent row would put the same fact in two places.
alter table project_schedule add column if not exists split_group text;
-- split_seq: 1-based order of the segment within its group. Explicit rather than
-- inferred from dates, because dates move: rescheduling must never silently
-- reorder "part 1 of 3" and "part 2 of 3".
alter table project_schedule add column if not exists split_seq   int;

-- ---- 2) Keep the pair honest ----------------------------------------------
-- Both together or neither. A split_seq with no group is meaningless, and a
-- group member with no sequence has no defined position in its own line item.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_split_pair_chk') then
    alter table project_schedule add constraint project_schedule_split_pair_chk
      check ((split_group is null and split_seq is null)
          or (split_group is not null and split_seq is not null and split_seq >= 1));
  end if;
end $$;

-- One index, on the lookup the renderer actually does: "give me every segment of
-- this group, in order".
create index if not exists project_schedule_split_group_idx
  on project_schedule (project_id, split_group, split_seq);

-- ---- 3) No back-fill -------------------------------------------------------
-- Nothing to seed. An un-split activity has null/null and renders exactly as it
-- does today, which is the point: this migration changes no existing behaviour.

-- Done. Right-click a main-contract activity -> "Insert change order here…".


-- ==========================================================================
-- [095/142] 2026-08-22-unify-mom-status.sql
-- ==========================================================================
-- 2026-08-22 — one status vocabulary for minutes and the register
--
-- ⚠️ READ THIS BEFORE EDITING.
-- `mom_items.status` and `issues_lessons.status` were two different lists:
--
--     mom_items        Open | In Progress | Closed
--     issues_lessons   Open | On Hold     | Closed
--
-- That drift was visible to the owner: an action raised into the register had to be
-- TRANSLATED on the way (`In Progress` -> `On Hold`), the minute's own filter had to
-- offer BOTH vocabularies because momItemStatus() could return either, and a raised
-- action's row could be filtered by a word its own dropdown did not contain.
--
-- The register's vocabulary wins (the owner's call): `On Hold`, not `In Progress`.
-- The register is the authoritative record of what is being chased, minutes feed it,
-- and its word is the one that appears on the dashboard's attention band
-- (assets/js/config.js -> attention.values = ['Open', 'On Hold']).
--
-- ⚠️ ORDER MATTERS. The existing CHECK forbids 'On Hold' and the new one forbids
-- 'In Progress', so neither can be added while rows or the other constraint disagree:
--   1) drop the old CHECK   2) move the rows   3) add the new CHECK
-- Doing (3) before (2) fails on every in-flight action in the database.

-- 1) ---------------------------------------------------------------------------
-- Dropped by DEFINITION, not by name: the constraint came from an inline `check`
-- in the create-table, so its name is Postgres-generated and is not guaranteed to
-- be `mom_items_status_check` on an instance that has been through a table rewrite.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'mom_items'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%In Progress%'
  loop
    execute format('alter table public.mom_items drop constraint %I', c.conname);
    raise notice 'mom_items: dropped old status CHECK %', c.conname;
  end loop;
end $$;

-- 2) ---------------------------------------------------------------------------
-- ⚠️ ONE-SHOT and idempotent: after this runs no row can hold 'In Progress' again,
-- because the CHECK added in (3) refuses it. Re-running is a no-op, not a second
-- translation — this maps a value to a value, it does not move a column.
update public.mom_items set status = 'On Hold' where status = 'In Progress';

-- Legacy rows predating any default. The column is nullable (default 'Open'), and a
-- null would render as 'Open' in a select that has no blank option — write the value
-- the screen already claims, so the data and the display agree.
update public.mom_items set status = 'Open' where status is null;

-- 3) ---------------------------------------------------------------------------
-- `not valid` is deliberately NOT used: (2) has just made every row conform, and a
-- constraint left unvalidated would not be trusted by later reads or by anyone
-- reading the schema to learn what the column may hold.
-- ⚠️ DROP-THEN-ADD BY NAME, not a bare `add constraint` — Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS` for table constraints (unlike columns, indexes
-- and policies elsewhere in this repo), so a bare add fails with "already exists"
-- on any re-run once this migration has applied once. This constraint's name is
-- OURS (chosen here, not Postgres-generated), so dropping it by name is safe —
-- unlike step (1) above, which has to hunt the OLD constraint by definition
-- because its name was never under our control.
alter table public.mom_items drop constraint if exists mom_items_status_chk;
alter table public.mom_items
  add constraint mom_items_status_chk
  check (status in ('Open', 'On Hold', 'Closed'));

-- 4) ---------------------------------------------------------------------------
-- The register side is left ALONE on purpose. `issues_lessons.status` already holds
-- exactly this vocabulary and carries no CHECK of its own (the column predates these
-- migrations); adding one here would be a separate decision about a separate table,
-- and it would fail on any historical row holding a word neither list anticipated.
-- Verify before considering it:
--     select status, count(*) from issues_lessons group by 1 order by 2 desc;

do $$
begin
  raise notice 'status vocabulary unified: Open | On Hold | Closed';
end $$;


-- ==========================================================================
-- [096/142] 2026-08-24-boq.sql
-- ==========================================================================
-- ============================================================================
-- Migration: BOQ — the client's Bill of Quantities, its class-code mapping,
--            its allocation to schedule activities, and its billing periods.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Implements ROADMAP B1a + B1b + B1c + B1d. Design note: docs/boq-and-pmi.md —
-- every ⚠️ below is a measured finding from the real OPW101 Package 2 workbook
-- (10 sheets, 1,215 priced lines, 5 billing sheets), not a guess.
--
-- WHY THE BOQ AND NOT project_schedule.quantity
--   docs/vendor-performance-chain.md decision #1: the BOQ is the source of
--   planned quantity. A `quantity` column on the activity would make a THIRD
--   place quantities live (client BOQ, allocation, activity) with nothing
--   keeping them in step — and the activity copy is the one everybody reads.
--   An activity's quantity is DERIVED from its allocations (view at the foot).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) boq_revisions — the document, and which revision superseded which
-- ---------------------------------------------------------------------------
-- ⚠️ Revisions are the NORMAL case, not an edge case: the real file is
--    "rev.05 - commented 250925" with a PO issued against it a month later.
create table if not exists boq_revisions (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null references projects(id) on delete cascade,
  rev_no          text not null,                  -- the client's own label: '05', 'rev.05', 'R2'
  issued_date     date,
  source_file     text,                           -- the workbook this came from, verbatim
  sheet_inventory jsonb default '{}'::jsonb,       -- {sheet: {lines, headings, role}} from the import preview
  -- The sheet's / Summary's own STATED contract total. Kept so the reconciliation
  -- gate (§4.5 trap 5) has something authoritative to refuse against, and so a
  -- later revision can be reconciled back to the bid.
  contract_total  numeric,
  po_no           text,
  -- ⚠️ A revision is superseded, never edited away. is_current marks which one
  --    the module reads by default; the prior rows stay readable forever,
  --    because every claim argument turns on what was tendered.
  is_current      boolean not null default true,
  notes           text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Case-insensitive: 'rev.05' and 'REV.05' are one revision to a human, and
-- letting both exist splits the register in two.
create unique index if not exists boq_revisions_project_rev_idx
  on boq_revisions (project_id, lower(rev_no));
create index if not exists boq_revisions_project_idx
  on boq_revisions (project_id, is_current, issued_date desc);

-- ---------------------------------------------------------------------------
-- 2) boq_items — the client's lines, VERBATIM
-- ---------------------------------------------------------------------------
-- ⚠️ APPEND-AND-SUPERSEDE, NEVER EDITED IN PLACE. This is the client's
--    document. A remeasure or a revised BOQ is a NEW revision with the prior
--    retained. Editing stored lines destroys the only record of what was
--    tendered. There is deliberately no UI path that updates a line's
--    description, unit, qty or amount after import.
create table if not exists boq_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references projects(id) on delete cascade,
  revision_id   uuid not null references boq_revisions(id) on delete cascade,

  -- ⚠️ IDENTITY IS (revision, sheet, source_row) — NOT item_no. Measured: 13 of
  --    901 numbered Architectural lines are duplicates, because the client
  --    numbers rows 17–20 as leaves `1.1.2…1.1.5` under heading `1.1.1` and then
  --    restarts `1.1.2` as a heading at row 21. Their numbering is inconsistent.
  sheet         text not null,
  source_row    integer not null,

  -- ⚠️ item_no is a DISPLAY LABEL. It may PROPOSE nesting for the planner to
  --    confirm; it is never a key and never the hierarchy.
  item_no       text,
  description   text,
  unit          text,
  qty           numeric,

  -- ⚠️ Material and labour are split natively in the source
  --    (UNIT COST → MATERIAL | MATERIAL COST | LABOR + CONS | LABOR COST |
  --    TOTAL AMOUNT) — the same shape as a PMI cost proposal, which is what
  --    makes one line-item table serve both (see scope_type below).
  mat_rate      numeric,
  mat_amount    numeric,
  lab_rate      numeric,
  lab_amount    numeric,

  -- ⚠️ LINE TOTALS ARE AUTHORITATIVE; UNIT RATES ARE ROUNDED DISPLAYS.
  --    Measured on the PMI sheet: recomputing qty × displayed rate gives
  --    ₱8,707,508.60 against the sheet's ₱8,707,500.00 — ₱8.60 wrong on a
  --    TWO-line sheet, compounding across 1,215. Import `amount` as given;
  --    derive the rate for display only, never write a derived rate back.
  amount        numeric,
  -- Set when the client gave a rate but no amount and we computed it, so a
  -- later reconciliation can tell the client's figures from ours.
  derived_amount boolean not null default false,

  -- ⚠️ THE AMOUNT COLUMN IS NOT ALWAYS A NUMBER. Real values found in
  --    TOTAL AMOUNT: 'Included in Package 1' (16), 'n/a' (4), 'By Megaworld'
  --    (2), 'Consideration : One side only' (1). These are SCOPE-BOUNDARY
  --    STATEMENTS, not missing data — they are exactly what a claim turns on.
  --    Stored verbatim and excluded from every roll-up, never coerced to 0.
  --    A zero and a "someone else is doing this" are different facts.
  exclusion_note text,

  -- ⚠️ REQUIRED, NOT COSMETIC. Lump-sum and provisional lines carry money but
  --    no measurable quantity; if they enter a quantity roll-up they silently
  --    corrupt every productivity rate derived from it.
  line_kind     text not null default 'measured'
                check (line_kind in ('measured','lump_sum','provisional','excluded','heading')),

  -- ⚠️ THE MARKER IS THE ONLY RELIABLE HEADING DISCRIMINATOR. A heading carries
  --    'Total of 9.1 >>' / 'Sub-Total of 9.1.1 >>' beside its amount. It can
  --    ALSO carry a unit and a quantity (`DIV 5 | METALS | lot | 1`) — using
  --    "has unit + qty" as the test made HS-SP read sum-of-WT% = 2.000000 and a
  --    contract of ₱114,410,587.84 instead of the true ₱57,205,293.92.
  total_marker  text,

  parent_id     uuid references boq_items(id) on delete set null,
  depth         integer not null default 0,

  -- The colour-coded legend on the source rows (FOR DELETION / FOR INCLUDE TO
  -- OTHER SCOPE OR REGR). ⚠️ Read on import as an ADVISORY FLAG FOR REVIEW,
  -- never as an automatic delete — a colour is one person's markup.
  fill_color    text,

  -- ⚠️ SAME AXIS AS project_schedule.scope_type (2026-08-19-schedule-contract-
  --    scope.sql). A PMI cost proposal IS a BOQ (qty / material / labour /
  --    total), so a variation's priced lines land HERE with
  --    scope_type='change_order' rather than in a parallel table that would
  --    guarantee the two drift. This also closes a real gap: variation work
  --    currently carries no quantities anywhere, so a change order can be
  --    scheduled but its productivity can never be measured.
  -- ⚠️ NO pmi_id COLUMN YET — B2c adds it with the UI that sets it. A pointer
  --    added before anything can populate it produces rows belonging to no PMI
  --    that vanish from any PMI-filtered view (the packages-migration trap).
  scope_type    text not null default 'main_contract'
                check (scope_type in ('main_contract','change_order')),

  sort_order    integer default 0,
  created_by    uuid references users(id),
  created_at    timestamptz default now()
);

create unique index if not exists boq_items_identity_idx
  on boq_items (revision_id, sheet, source_row);
create index if not exists boq_items_revision_idx
  on boq_items (revision_id, sort_order);
create index if not exists boq_items_project_idx on boq_items (project_id);
create index if not exists boq_items_parent_idx on boq_items (parent_id);

-- ---------------------------------------------------------------------------
-- 3) boq_import_profiles — because the format varies PER SHEET
-- ---------------------------------------------------------------------------
-- ⚠️ Measured in ONE workbook: header row 12 / 10 / 7 and first column A / B / B
--    across the trade sheets and their billing twins. A single hard-coded parser
--    cannot even read one file, so header detection must be a SEARCH (the
--    Drawing Register's findHeader pattern) and the accepted map is saved.
-- ⚠️ DETECTION PROPOSES; THE PLANNER ACCEPTS. A silently-wrong column map
--    produces a BOQ that looks complete and is wrong in the money column.
create table if not exists boq_import_profiles (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  -- Free text so the same client's next project can reuse it by name.
  client_key   text,
  sheet        text not null,
  header_row   integer,
  first_col    text,
  col_map      jsonb not null default '{}'::jsonb,  -- {field: column index}
  heading_rule jsonb not null default '{}'::jsonb,  -- {marker_col, marker_re, leaf_is_location}
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create unique index if not exists boq_import_profiles_key_idx
  on boq_import_profiles (project_id, sheet);

-- ---------------------------------------------------------------------------
-- 4) boq_class_map — BOQ line → Finance class code
-- ---------------------------------------------------------------------------
-- ⚠️ SCOPED TO THE BOQ REVISION. There is deliberately NO global
--    "description → class code" table that silently applies itself: two clients
--    calling something "Wall Systems and Cladding" may legitimately mean
--    different Finance codes, and a global map would apply one project's
--    judgement to another with nothing on screen to say it had.
-- ⚠️ NO FK TO class_codes, for the same reason project_schedule.class_code has
--    none: a code can predate a template revision, and rejecting the mapping is
--    worse than holding a code the chart no longer lists.
-- ⚠️ NEVER DE-ZERO THE CODE. '015051' (Gen Req › Earthmoving) collides with
--    '15051' (Metal Works › Railings), and '017151' with '17151'. The merge
--    looks like a successful match, so nothing errors. The padded code is the key.
create table if not exists boq_class_map (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  revision_id uuid not null references boq_revisions(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  class_code  text not null,
  -- ⚠️ HOW it was arrived at, so a later audit can tell a considered mapping
  --    from a bulk accept. Only ACCEPTED mappings are ever stored.
  source      text not null default 'hand_picked'
              check (source in ('suggested','bulk_accepted','hand_picked')),
  confidence  numeric,
  created_by  uuid references users(id),
  created_at  timestamptz default now()
);
create unique index if not exists boq_class_map_item_idx on boq_class_map (boq_item_id);
create index if not exists boq_class_map_rev_idx on boq_class_map (revision_id);
create index if not exists boq_class_map_code_idx on boq_class_map (project_id, class_code);

-- ---------------------------------------------------------------------------
-- 5) boq_class_suggestions — the learned library (portfolio-wide)
-- ---------------------------------------------------------------------------
-- Mapping ~1,200 lines by hand per project is not viable, so accepted mappings
-- accumulate here and are offered as PROPOSALS on the next import.
-- ⚠️ Open decision #3, resolved: suggest across the portfolio, ALWAYS show the
--    source, NEVER auto-accept. Cross-portfolio learns fastest; auto-applying it
--    is what would put one client's vocabulary into another's BOQ unseen.
-- ⚠️ Matches on the item-number PATH too ('DIV 9 › 9.1 › Wall Systems and
--    Cladding') and on the client's own division headings, which map onto
--    Finance divisions far more stably than free text does.
create table if not exists boq_class_suggestions (
  id           uuid primary key default gen_random_uuid(),
  norm_desc    text not null default '',   -- normalised description text
  path_key     text not null default '',   -- normalised item-number / heading path
  class_code   text not null,
  hits         integer not null default 1,
  last_project_id text,
  last_used_at timestamptz default now(),
  created_at   timestamptz default now()
);
create unique index if not exists boq_class_suggestions_key_idx
  on boq_class_suggestions (norm_desc, path_key, class_code);
create index if not exists boq_class_suggestions_desc_idx
  on boq_class_suggestions (norm_desc, hits desc);

-- ---------------------------------------------------------------------------
-- 6) boq_allocations — one class code covers MANY activities
-- ---------------------------------------------------------------------------
-- `class_code` on an activity is a TAG, not a key: "Rebar Works" is one code
-- carried by forty floor-level activities. So a BOQ line cannot be attributed
-- to AN activity; it must be ALLOCATED ACROSS them.
-- ⚠️ Open decision #1, resolved: per LINE, not per class code, because the line
--    carries the quantity and the money. Bulk tools apply one split across a
--    whole heading or division.
-- ⚠️ POINTS AT project_schedule.activity_id (the P6/business key), NOT the row
--    uuid — same call as 2026-07-25-schedule-document-links.sql, because the
--    uuid changes on every P6/XER "Replace" re-import.
-- ⚠️ A PROPOSED SPLIT MUST BE ACCEPTED BEFORE IT IS STORED. An auto-split
--    written silently becomes indistinguishable from a planner's own figures,
--    which defeats the point of an auditable allocation table.
create table if not exists boq_allocations (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  boq_item_id  uuid not null references boq_items(id) on delete cascade,
  activity_id  text not null,
  qty          numeric not null default 0,
  method       text not null default 'manual'
               check (method in ('location','prorata','manual')),
  accepted_by  uuid references users(id),
  accepted_at  timestamptz default now()
);
create unique index if not exists boq_allocations_pair_idx
  on boq_allocations (boq_item_id, activity_id);
create index if not exists boq_allocations_activity_idx
  on boq_allocations (project_id, activity_id);

-- ---------------------------------------------------------------------------
-- 7) boq_billing_periods + boq_progress — monthly POC and revenue
-- ---------------------------------------------------------------------------
-- ⚠️ THE ONLY STORED INPUT IS rel_pct. Verified against the real sheets, every
--    identity closes exactly:
--      WT %  = line amount / SHEET total   (sum of WT % = 1.000000 on all five)
--      %Wt.  = WT % × Rel. %age
--      Amt.  = line amount × Rel. %age
--      previous + this period = to date    (9.6718% + 7.5741% = 17.2459%)
--      POC   = Σ %Wt.        Revenue = Σ Amt. = contract × POC
--    (verified ₱241,004,906.59 at 17.2459%). Persisting %Wt. or Amt. means they
--    silently disagree with the BOQ the moment a revision changes a quantity —
--    the same derive-don't-persist rule as risk-register's rating.
--
-- ⚠️ WT % IS RELATIVE TO ITS OWN SHEET, NOT THE CONTRACT. Architectural is
--    87.90% of the contract, ACOUSTIC 1.65%. So WT % cannot be summed or
--    compared across sheets and a project POC is NOT the average of the four —
--    it must be re-weighted by each trade's share, or ACOUSTIC would move the
--    project POC as much as Architectural.
--
-- ⚠️ EACH PERIOD SNAPSHOTS THE REVISION IT WAS BILLED AGAINST (revision_id),
--    or a later remeasure retroactively rewrites a submitted billing.
--
-- ⚠️ THE BILLING PERIOD IS NOT A CALENDAR MONTH: the real one runs
--    26-Feb-2026 → 25-Mar-2026 (PO 4100125091, PROGRESS BILLING NO. 3). Cash
--    Flow and the S-curve are monthly, so the period→month mapping is explicit
--    and never assumed.
--    DECISION #6 — RESOLVED 2026-08-26 by the owner: the billing dates are a
--    commercial term and are NEVER moved to suit a report, but a report may cut
--    at month end. The Billing tab therefore derives a monthly view by spreading
--    each period's INCREMENT straight-line across the calendar days it spans.
--    ⚠️ NOTHING IS STORED FOR IT. No column here holds a month, and no month is
--    writable — rel_pct remains the only input. The pro-rata is a reporting
--    convention living in boq.js (monthlyRevenue), so a later change of
--    convention cannot corrupt a submitted billing.
create table if not exists boq_billing_periods (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null references projects(id) on delete cascade,
  revision_id    uuid not null references boq_revisions(id),
  billing_no     text not null,
  period_start   date,
  period_end     date,
  po_no          text,
  contract_total numeric,
  status         text not null default 'draft'
                 check (status in ('draft','submitted','approved')),
  notes          text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists boq_billing_periods_no_idx
  on boq_billing_periods (project_id, lower(billing_no));
create index if not exists boq_billing_periods_project_idx
  on boq_billing_periods (project_id, period_end);

-- `previous` is never stored: it is the to-date of the prior period.
create table if not exists boq_progress (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  period_id   uuid not null references boq_billing_periods(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  -- Cumulative-to-date relative percentage for this line, 0..1 as the sheet
  -- stores it (0.272727 = 27.2727%).
  rel_pct     numeric not null default 0,
  created_by  uuid references users(id),
  updated_at  timestamptz default now()
);
create unique index if not exists boq_progress_pair_idx
  on boq_progress (period_id, boq_item_id);
create index if not exists boq_progress_project_idx on boq_progress (project_id);

-- ---------------------------------------------------------------------------
-- 8) Access — identical shape to every project-scoped module table
-- ---------------------------------------------------------------------------
-- read follows project access; write additionally requires planner (a viewer
-- must never write). See 2026-07-21-rls-project-scope-fix.sql.
-- ⚠️ Open decision #4, resolved: PLANNER-OWNED. class_codes is admin-owned
--    Finance data, but BOQ mapping is a QS/planner act, so the rows are stamped
--    with author + timestamp under the standard project-scoped RLS.
do $$
declare t text;
begin
  foreach t in array array['boq_revisions','boq_items','boq_import_profiles',
                           'boq_class_map','boq_allocations',
                           'boq_billing_periods','boq_progress']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- The suggestion library has no project scope by design (§5, open decision #3).
-- Read for any approved user; write for planners, since it is written as a
-- side-effect of accepting a mapping.
alter table boq_class_suggestions enable row level security;
drop policy if exists boq_class_suggestions_read on boq_class_suggestions;
create policy boq_class_suggestions_read on boq_class_suggestions
  for select to authenticated using (is_approved());
drop policy if exists boq_class_suggestions_write on boq_class_suggestions;
create policy boq_class_suggestions_write on boq_class_suggestions
  for all to authenticated using (is_planner()) with check (is_planner());
grant select, insert, update, delete on boq_class_suggestions to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Keep updated_at honest on the tables that are edited after creation
-- ---------------------------------------------------------------------------
create or replace function boq_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['boq_revisions','boq_import_profiles',
                           'boq_billing_periods','boq_progress']
  loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function boq_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10) The derived activity quantity (this is the whole point of B1c)
-- ---------------------------------------------------------------------------
-- ⚠️ A VIEW, NOT A COLUMN on project_schedule. See the header note: an
--    activity's quantity is derived from its allocations so there is exactly one
--    place a quantity can be wrong.
-- ⚠️ security_invoker so the caller's RLS applies (same rule as
--    schedule_scurve_agg). Without it this view would leak across projects.
create or replace view boq_activity_quantity
  with (security_invoker = true) as
select a.project_id,
       a.activity_id,
       i.unit,
       sum(a.qty)              as qty,
       count(*)                as line_count,
       max(i.scope_type)       as scope_type
from boq_allocations a
join boq_items i on i.id = a.boq_item_id
-- ⚠️ Lump-sum, provisional, excluded and heading lines carry money but no
--    measurable quantity. Letting them into a quantity roll-up is what silently
--    corrupts every productivity rate derived from it.
where i.line_kind = 'measured'
group by a.project_id, a.activity_id, i.unit;

grant select on boq_activity_quantity to authenticated;

-- ---------------------------------------------------------------------------
-- 11) No seed
-- ---------------------------------------------------------------------------
-- A project with no BOQ is a truthful state. A placeholder revision would
-- assert a contract document nobody uploaded.


-- ==========================================================================
-- [097/142] 2026-08-24-dedupe-existing-calendars.sql
-- ==========================================================================
-- ============================================================================
-- ONE-OFF CLEANUP: collapse the duplicate calendars left behind by repeated XER
-- imports. Run in the Supabase SQL editor, BLOCK BY BLOCK, in order.
--
-- Background: the importer used to insert every calendar in a P6 file
-- unconditionally, so each re-import copied the whole set (one live project
-- reached 30+ rows: 5x "Performance Bond-1-1-1-1", 4x "Surety Bond-2-1-1", ...).
-- The importer now reuses a matching calendar, so this is a one-time tidy-up and
-- not a tool — nothing here needs to run again.
--
-- ⚠️⚠️ THIS DELETES ROWS AND REPOINTS LIVE SCHEDULE DATA. Read BLOCK A's output
-- before running BLOCK B. The plan is written to a table first precisely so that
-- what you review is exactly what gets executed — a report that re-derives its
-- own grouping can disagree with the action that follows it.
--
-- ⚠️ WHY REPOINTING IS NOT OPTIONAL. All three foreign keys are
-- `on delete set null`, so deleting a duplicate WITHOUT repointing first would
-- silently blank the reference and drop those activities onto the project default
-- calendar. That is a schedule change with nothing on screen to explain it.
-- Referencing tables: project_schedule.calendar_id, resources.calendar_id,
-- duration_scenarios.calendar_id.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- BLOCK A — build the plan, then review it. Makes NO changes to any calendar.
-- ---------------------------------------------------------------------------
drop table if exists calendars_dedupe_plan;

create table calendars_dedupe_plan as
with ident as (
  select
    c.id, c.project_id, c.name, c.is_default, c.created_at,
    -- ⚠️ THE IDENTITY, deliberately the same rule the importer now uses
    -- (name + working week + hours). Two calendars sharing a name but working
    -- different weeks are different calendars, and collapsing them would
    -- repoint activities onto the wrong week.
    lower(btrim(c.name))                                          as name_key,
    coalesce(c.hours_per_day, 8)                                  as hours_key,
    (c.work_mon::int::text || c.work_tue::int::text || c.work_wed::int::text ||
     c.work_thu::int::text || c.work_fri::int::text || c.work_sat::int::text ||
     c.work_sun::int::text)                                       as days_key,
    coalesce(array_length(c.extra_holidays, 1), 0)                as holiday_count,
    -- Rows a planner has actually worked on, in this app rather than in P6.
    case when (case when jsonb_typeof(coalesce(c.seasons, '[]'::jsonb)) = 'array'
                    then jsonb_array_length(coalesce(c.seasons, '[]'::jsonb)) else 0 end) > 0
              or c.climate_type is not null
              or coalesce(c.observe_special_days, false)
         then 1 else 0 end                                        as curated
  from calendars c
  -- ⚠️ project_id is nullable on this table. NULLs form ONE partition, so two
  -- orphaned calendars belonging to different projects would be treated as
  -- duplicates of each other and activities repointed ACROSS projects. Orphans are
  -- left completely alone; if any exist, deal with them by hand (see A5).
  where c.project_id is not null
),
ranked as (
  select i.*,
    count(*) over wpart                                           as group_size,
    -- ⚠️ SURVIVOR ORDER, and why each step is where it is:
    --   is_default  — the project's default must remain the default.
    --   curated     — never discard seasons / climate type / special-days in
    --                 favour of a raw P6 copy that knows nothing about them.
    --   holidays    — keep the RICHEST proclaimed-holiday list. Repointed
    --                 activities then GAIN non-working days rather than losing
    --                 them: dates move later, which is the safe direction for a
    --                 programme, and no hand-entered holiday is thrown away.
    --   created_at  — the original, not a copy of it.
    --   id          — a deterministic tiebreak so re-running cannot pick
    --                 differently from what was reviewed.
    row_number() over word                                        as rank_in_group,
    first_value(i.id) over word                                   as keep_id,
    first_value(i.name) over word                                 as keep_name
  from ident i
  -- ⚠️ TWO windows, and the split is not cosmetic. count(*) over an ORDERED
  -- window is a RUNNING count (1,2,3…), so sharing one window here would have
  -- made group_size read 1 for every group's first row and `group_size > 1`
  -- would have dropped every survivor from the plan — repointing activities at
  -- rows the delete then removed. group_size takes the unordered partition.
  window
    wpart as (partition by i.project_id, i.name_key, i.hours_key, i.days_key),
    word  as (partition by i.project_id, i.name_key, i.hours_key, i.days_key
              order by i.is_default desc nulls last, i.curated desc, i.holiday_count desc,
                       i.created_at asc nulls last, i.id asc)
)
select
  r.project_id, r.name_key, r.hours_key, r.days_key, r.group_size,
  r.id                                    as cal_id,
  r.name                                  as cal_name,
  r.keep_id, r.keep_name,
  (r.id = r.keep_id)                      as is_survivor,
  r.is_default, r.holiday_count, r.curated, r.created_at,
  (select count(*) from project_schedule   s where s.calendar_id = r.id) as activities,
  (select count(*) from resources          x where x.calendar_id = r.id) as resources,
  (select count(*) from duration_scenarios d where d.calendar_id = r.id) as scenarios
from ranked r
where r.group_size > 1;

-- A1. Headline: how much collapses.
select
  count(*) filter (where is_survivor)       as groups_kept,
  count(*) filter (where not is_survivor)   as rows_to_delete,
  coalesce(sum(activities) filter (where not is_survivor), 0) as activities_to_repoint,
  coalesce(sum(resources)  filter (where not is_survivor), 0) as resources_to_repoint,
  coalesce(sum(scenarios)  filter (where not is_survivor), 0) as scenarios_to_repoint
from calendars_dedupe_plan;

-- A2. The plan, group by group. KEEP rows are the survivors.
select project_id, keep_name, group_size,
       case when is_survivor then 'KEEP' else 'delete' end as action,
       cal_name, holiday_count, curated, is_default,
       activities, resources, scenarios, cal_id
from calendars_dedupe_plan
order by project_id, name_key, days_key, is_survivor desc, cal_name;

-- A3. ⚠️ REVIEW THIS ONE. Groups where the duplicates disagree about how many
-- proclaimed holidays they carry. Those activities' dates WILL move when they are
-- repointed (the survivor holds the richest list, so they gain non-working days).
-- If any line here looks wrong, fix that group by hand before running BLOCK B.
select project_id, keep_name,
       min(holiday_count) as fewest_holidays,
       max(holiday_count) as most_holidays,
       sum(activities) filter (where not is_survivor) as activities_affected
from calendars_dedupe_plan
group by project_id, keep_name, name_key, days_key, hours_key
having min(holiday_count) <> max(holiday_count)
order by 5 desc nulls last;

-- A4. ADVISORY ONLY — never actioned by this script. Near-duplicates whose names
-- differ only by P6's copy suffixes ("CARI1-1-1" vs "CARI1-1-1-1", "Copy of X").
-- ⚠️ These are NOT collapsed: the names come verbatim from the XER's clndr_name,
-- so a suffix may mark a genuinely different P6 calendar. Judge these by eye and
-- merge any you recognise by hand.
select project_id,
       regexp_replace(regexp_replace(lower(btrim(name)), '^copy of ', ''), '(-[0-9]+)+$', '') as family,
       count(*) as variants,
       string_agg(distinct name, ' | ' order by name) as names
from calendars
group by 1, 2
having count(*) > 1
order by variants desc;


-- A5. Orphaned calendars (no project) — EXCLUDED from the plan above, listed so
-- their exclusion is visible rather than assumed. Normally zero rows.
select id, name, is_default, created_at,
       (select count(*) from project_schedule s where s.calendar_id = calendars.id) as activities
from calendars where project_id is null order by name;


-- ---------------------------------------------------------------------------
-- BLOCK B — apply the reviewed plan. ⚠️ DESTRUCTIVE. Run only after BLOCK A.
-- One transaction: either every reference is repointed and every duplicate is
-- gone, or nothing changed. A half-applied cleanup would leave activities
-- pointing at rows that no longer exist (nulled by the FK) — the exact silent
-- schedule change this whole script exists to avoid.
-- ---------------------------------------------------------------------------
begin;

-- Repoint FIRST, delete last.
update project_schedule s
   set calendar_id = p.keep_id
  from calendars_dedupe_plan p
 where s.calendar_id = p.cal_id
   and not p.is_survivor;

update resources x
   set calendar_id = p.keep_id
  from calendars_dedupe_plan p
 where x.calendar_id = p.cal_id
   and not p.is_survivor;

update duration_scenarios d
   set calendar_id = p.keep_id
  from calendars_dedupe_plan p
 where d.calendar_id = p.cal_id
   and not p.is_survivor;

-- ⚠️ Carry the default flag across if it sat on a row being deleted. The survivor
-- order already prefers is_default, so this should be a no-op — it is here so that
-- a project cannot come out of this with NO default calendar, which would send
-- every unassigned activity to the hard-coded Philippine standard instead.
update calendars c
   set is_default = true
 where c.id in (select distinct keep_id from calendars_dedupe_plan
                 where not is_survivor and is_default);

delete from calendars c
 where c.id in (select cal_id from calendars_dedupe_plan where not is_survivor);

commit;


-- ---------------------------------------------------------------------------
-- BLOCK C — verify. Expect: zero orphan groups, zero references left dangling,
-- and exactly one default per project.
-- ---------------------------------------------------------------------------
-- C1. No exact-identity duplicates remain.
select project_id, lower(btrim(name)) as name_key, count(*) as still_duplicated
from calendars
group by project_id, lower(btrim(name)), coalesce(hours_per_day, 8),
         (work_mon, work_tue, work_wed, work_thu, work_fri, work_sat, work_sun)
having count(*) > 1;

-- C2. RECONCILIATION — the check that can actually fail. ⚠️ A "nothing points at a
-- deleted calendar" query would be worthless here: the FKs are `on delete set null`,
-- so Postgres nulls any straggler and such a query reports 0 whether the repoint
-- worked or not. Instead compare what the plan recorded against what the survivors
-- now hold: each group's survivor must carry its own references plus every loser's.
-- Expect ZERO rows. A row here means references were lost, not repointed.
select p.keep_id, max(p.keep_name) as keep_name,
       sum(p.activities) as expected_activities,
       (select count(*) from project_schedule s where s.calendar_id = p.keep_id) as actual_activities,
       sum(p.resources)  as expected_resources,
       (select count(*) from resources x where x.calendar_id = p.keep_id) as actual_resources,
       sum(p.scenarios)  as expected_scenarios,
       (select count(*) from duration_scenarios d where d.calendar_id = p.keep_id) as actual_scenarios
from calendars_dedupe_plan p
group by p.keep_id
having sum(p.activities) <> (select count(*) from project_schedule s where s.calendar_id = p.keep_id)
    or sum(p.resources)  <> (select count(*) from resources x where x.calendar_id = p.keep_id)
    or sum(p.scenarios)  <> (select count(*) from duration_scenarios d where d.calendar_id = p.keep_id);

-- C3. One default per project.
select project_id, count(*) filter (where is_default) as defaults, count(*) as calendars
from calendars group by project_id order by defaults desc, project_id;

-- The plan table is left in place on purpose: it is the record of which row
-- survived and what was repointed. Drop it once you are satisfied:
--   drop table calendars_dedupe_plan;


-- ==========================================================================
-- [098/142] 2026-08-24-equipment-loading.sql
-- ==========================================================================
-- ============================================================================
-- Equipment Loading (per project) — 2026-08-24
--
-- Three objects, and the split is the design:
--   equipment_items    one row per piece of equipment on the project (the register)
--   equipment_loading  one row per (equipment, month) carrying planned + actual qty
--   equipment_site_plan  ONE row per project holding the site-dev blocks as jsonb
--
-- ⚠️ The monthly quantities are their own table, not a jsonb blob on the item. A blob
-- can hold the numbers but cannot be filtered, summed per month by the database, or
-- edited by two people without one clobbering the other's month. Same call the
-- productivity module made for productivity_entries.
--
-- ⚠️ The site plan IS a jsonb blob, deliberately the opposite call: it is geometry
-- (x/y/w/h of each block on a plan view) read and written as one picture, never
-- queried a block at a time. Same shape as schedule_builder.config.
--
-- ⚠️ equipment_items.site_block stores the block's ID, never its NAME. Renaming a
-- tower must not orphan every assignment — the WBS-code lesson, where a name-derived
-- key drifted the moment the tree was renumbered.
--
-- RLS is project-scoped from the start (the 2026-07-21 fix pattern). Writes are
-- is_writer() (approved, not a viewer) rather than resource-loading's
-- created_by-or-admin: an equipment register is maintained by the whole project
-- team, and "only the person who typed it may fix it" is how a register goes stale.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists equipment_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  category text not null default 'Ground Equipment',
  acquisition text,                       -- Purchase | Rental
  unit text,                              -- unit / set / lot
  site_block text,                        -- id of a block in equipment_site_plan.plan
  monthly_rate numeric,                   -- rental/ownership cost per unit per month
  supplier text,
  remarks text,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists equipment_loading (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  equipment_id uuid not null references equipment_items(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_qty numeric,
  actual_qty numeric,
  remarks text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists equipment_site_plan (
  project_id text primary key,
  plan jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_at timestamptz default now()
);

-- One row per equipment per month. Without this two browsers can each insert the
-- same month and the matrix silently double-counts it.
create unique index if not exists equipment_loading_uni
  on equipment_loading(equipment_id, period);
create index if not exists equipment_loading_project_idx
  on equipment_loading(project_id, period);
create index if not exists equipment_items_project_idx
  on equipment_items(project_id, sort_order);

-- ---- Distinct location values, for seeding the site plan from the schedule ----
-- ⚠️ An RPC because PostgREST cannot do DISTINCT: the alternative is paging every
-- activity row (40k on a real project, capped at 1000 per read) to find perhaps six
-- tower names. security INVOKER, so the caller's RLS on project_schedule still applies —
-- never definer, which would leak another project's locations.
create or replace function public.project_location_values(p_project_id text, p_key text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('value', v, 'n', n) order by v), '[]'::jsonb)
  from (
    select trim(location ->> p_key) as v, count(*) as n
    from project_schedule
    where project_id = p_project_id
      and coalesce(activity_type, '') <> 'WBS Summary'
      and nullif(trim(coalesce(location ->> p_key, '')), '') is not null
    group by 1
  ) t;
$$;
grant execute on function public.project_location_values(text, text) to authenticated;

grant select, insert, update, delete on equipment_items, equipment_loading, equipment_site_plan to authenticated;

alter table equipment_items enable row level security;
alter table equipment_loading enable row level security;
alter table equipment_site_plan enable row level security;

do $$
declare t text;
begin
  foreach t in array array['equipment_items','equipment_loading','equipment_site_plan'] loop
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all using (is_writer() and can_access_project(project_id)) with check (is_writer() and can_access_project(project_id))', t||'_write', t);
  end loop;
end $$;

-- Keep updated_at honest: the register reports "last updated" per item, and an
-- updated_at that only records the INSERT reports an item edited this morning as
-- untouched. Same reasoning as the packages table.
create or replace function public.equipment_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists equipment_items_touch on equipment_items;
create trigger equipment_items_touch before update on equipment_items
  for each row execute function public.equipment_touch();
drop trigger if exists equipment_loading_touch on equipment_loading;
create trigger equipment_loading_touch before update on equipment_loading
  for each row execute function public.equipment_touch();
drop trigger if exists equipment_site_plan_touch on equipment_site_plan;
create trigger equipment_site_plan_touch before update on equipment_site_plan
  for each row execute function public.equipment_touch();


-- ==========================================================================
-- [099/142] 2026-08-24-equipment-code-and-sharing.sql
-- ==========================================================================
-- ============================================================================
-- Equipment Loading — a unique equipment CODE, and equipment shared between towers
-- 2026-08-24
--
-- Two changes, and they exist for the same reason: a piece of equipment is a
-- physical asset, not a line on a sheet.
--
-- 1) equipment_items.code — the asset's own identifier (TC-01, TC-02). Unique per
--    project, case-insensitively; the NAME is deliberately left free to repeat,
--    because a project really does have three "Tower Crane" rows and telling them
--    apart by name is impossible. The code is what a portfolio-level view will
--    later join on to answer "where is TC-01 and when is it free", so it must be
--    stable and unique from the start.
--
--    ⚠️ Unique per PROJECT, not globally: two projects legitimately both number
--    their first crane TC-01, and a global constraint would refuse the second
--    project's register with an error nobody could act on. A cross-project asset
--    register is a different table and a later decision.
--
-- 2) equipment_tower_links — one row per (equipment, tower). Replaces the single
--    equipment_items.site_block.
--
--    ⚠️ A many-to-many table, not an array column, because sharing is the point:
--    a tower crane serving two towers is one asset with two placements, and the
--    question asked of it ("which equipment does Tower B have?", and later "is
--    TC-01 free in March?") is a per-placement question. An array can hold the
--    ids but cannot be joined, counted per tower by the database, or extended
--    with a placement's own dates later without rewriting every reader.
--
--    ⚠️ site_block is BACKFILLED into it and then left in place, unread. Dropping
--    the column in the same migration that starts using the new table leaves no
--    way back if the backfill was wrong; it is stale from this migration on and
--    should be dropped in a later, separate one.
--
-- ⚠️ block_id is the shape's ID from equipment_site_plan.plan, so there is no FK
-- to enforce it — the same reason site_block had none. Deleting a shape therefore
-- has to delete its links explicitly, which the module does.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table equipment_items add column if not exists code text;

-- Seed a code for every existing row so the unique index can be created and the
-- register is never left with a blank identifier: category initials + a per-project
-- sequence, which a planner can then rename to the site's own numbering.
with seeded as (
  select id,
         upper(left(regexp_replace(coalesce(category, 'EQ'), '[^A-Za-z]', '', 'g'), 2)) as pfx,
         row_number() over (partition by project_id, category order by sort_order, created_at, id) as n
  from equipment_items
  where code is null or btrim(code) = ''
)
update equipment_items e
   set code = s.pfx || '-' || lpad(s.n::text, 2, '0')
  from seeded s
 where e.id = s.id;

create unique index if not exists equipment_items_code_uni
  on equipment_items(project_id, lower(btrim(code)));

create table if not exists equipment_tower_links (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  equipment_id uuid not null references equipment_items(id) on delete cascade,
  block_id text not null,
  created_by uuid,
  created_at timestamptz default now()
);

-- One row per (equipment, tower). Without this two browsers can each add the same
-- placement and every per-tower count double-reports it.
create unique index if not exists equipment_tower_links_uni
  on equipment_tower_links(equipment_id, block_id);
create index if not exists equipment_tower_links_project_idx
  on equipment_tower_links(project_id, block_id);

-- Backfill the existing single assignment. Guarded on the link not already existing,
-- so re-running cannot duplicate a placement a planner has since removed and re-added.
insert into equipment_tower_links (project_id, equipment_id, block_id, created_by)
select i.project_id, i.id, i.site_block, i.created_by
  from equipment_items i
 where nullif(btrim(coalesce(i.site_block, '')), '') is not null
   and not exists (
     select 1 from equipment_tower_links l
      where l.equipment_id = i.id and l.block_id = i.site_block);

grant select, insert, update, delete on equipment_tower_links to authenticated;
alter table equipment_tower_links enable row level security;

drop policy if exists equipment_tower_links_read on equipment_tower_links;
create policy equipment_tower_links_read on equipment_tower_links
  for select using (can_access_project(project_id));
drop policy if exists equipment_tower_links_write on equipment_tower_links;
create policy equipment_tower_links_write on equipment_tower_links
  for all using (is_writer() and can_access_project(project_id))
       with check (is_writer() and can_access_project(project_id));


-- ==========================================================================
-- [100/142] 2026-08-24-equipment-schedule-link.sql
-- ==========================================================================
-- ============================================================================
-- Equipment Loading â link a line item's DURATION to the project schedule
-- 2026-08-24
--
-- The register already says what equipment the project has and how much of it is
-- on site each month. What it could not say is WHY a month is loaded: the planned
-- months were typed by hand, so when the schedule moved the loading sheet did not.
-- That is the failure mode the OPS sheet has today.
--
-- This adds the link. One equipment line item points at either ONE schedule
-- activity or a WBS BRANCH, and its planned months are then derived from that
-- activity's / branch's dates Ã a quantity:
--
--   link_mode      null | 'activity' | 'wbs'
--   link_activity_id  project_schedule.activity_id (mode 'activity')
--   link_wbs       WBS path prefix (mode 'wbs') â every activity under it
--   link_qty       units on site for every month the link spans
--   lead_months    mobilise this many months BEFORE the linked start
--   lag_months     stay this many months AFTER the linked finish
--   link_start / link_finish  the span resolved at the last sync (cached)
--   link_synced_at when that was
--
-- â ï¸ link_activity_id stores the schedule's own activity_id TEXT, not the row's
-- uuid. A re-import of the same programme replaces every project_schedule row
-- (new uuids) while the activity ids are exactly what stays stable â keying on
-- the uuid is how the drawing register lost its schedule links once already.
--
-- â ï¸ The cached span is a CACHE, never the truth. The module re-resolves it from
-- the schedule on load and shows a drift warning; it does not silently trust
-- these two columns. They exist so the register can render a duration without
-- a query per row, and so "the schedule moved" is detectable at all.
--
-- equipment_loading.source records who wrote a month: 'schedule' rows are owned
-- by the sync and are overwritten by it; anything else is a planner's own number
-- and the sync leaves it alone. Without this column a re-sync cannot tell its own
-- previous output from a hand correction, and would either wipe corrections or
-- keep stale months forever.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table equipment_items add column if not exists link_mode text;
alter table equipment_items add column if not exists link_activity_id text;
alter table equipment_items add column if not exists link_wbs text;
alter table equipment_items add column if not exists link_label text;
alter table equipment_items add column if not exists link_qty numeric;
alter table equipment_items add column if not exists lead_months int default 0;
alter table equipment_items add column if not exists lag_months int default 0;
alter table equipment_items add column if not exists link_start date;
alter table equipment_items add column if not exists link_finish date;
alter table equipment_items add column if not exists link_synced_at timestamptz;

alter table equipment_loading add column if not exists source text default 'manual';

-- ⚠️ Which location level is the "tower" level is remembered in the site plan's own
-- jsonb (plan.level_id), not in a new column — the plan is read and written as one
-- picture, and a second write path for one field is how the two drift apart.
-- location_levels are per-project and free-form (Tower / Building / Zone / …), so
-- there is no fixed key to hard-code: the first version of this module passed the
-- literal string 'tower' as the level id, which matches nothing on any project.

-- Resolving a link means "earliest start and latest finish under this WBS branch".
-- Two indexed reads per item, so both need to be indexed reads.
create index if not exists project_schedule_actid_idx
  on project_schedule(project_id, activity_id);
create index if not exists project_schedule_wbs_idx
  on project_schedule(project_id, wbs);


-- ==========================================================================
-- [101/142] 2026-08-24-seasonal-calendars.sql
-- ==========================================================================
-- ============================================================================
-- Migration: SEASONAL working calendars + opt-in Philippine special days.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Extends the existing `calendars` master (2026-07-06-working-calendars.sql).
-- Nothing here is required: every column defaults to the behaviour calendars
-- already had, so rows saved before this migration keep resolving to exactly
-- the same dates.
-- ============================================================================

-- ---- 1) Seasonal work patterns ---------------------------------------------
-- ⚠️ WHY THIS LIVES ON THE CALENDAR AND NOT IN A DURATION SCENARIO. A scenario's
-- rain profile answers "how many working days does weather TAKE from us" — a
-- what-if, held per scenario so it cannot move the live schedule. A season
-- answers "which days do we WORK in the monsoon" — a decision the project has
-- already made, that must apply to the live schedule and to every scenario
-- alike. Modelling a wet-season 5-day week as rain days would silently make a
-- deliberate policy look like weather damage, and would vanish the moment the
-- planner previewed a different scenario.
--
-- Shape: [{ "id": "s1a2b3", "label": "Wet season - reduced week",
--           "months": [6,7,8,9],          -- calendar months (1-12) it governs
--           "hours_per_day": 6,           -- null/absent = use the calendar's own
--           "work_mon": true, ... "work_sun": false }]   -- absent = base pattern
-- Months no season covers fall back to the calendar's base pattern. The FIRST
-- season whose months include a date wins; the editor refuses to save
-- overlapping months rather than averaging them.
alter table calendars add column if not exists seasons jsonb default '[]'::jsonb;

-- ---- 2) Philippine special (non-working) days ------------------------------
-- ⚠️ OPT-IN, and the default must stay false. A special day is "no work, no pay"
-- rather than a regular holiday, and many sites work them; defaulting this to
-- true would have removed ~5 working days a year from every existing project's
-- calendar the moment it shipped, moving live forecast dates with nothing on
-- screen to explain it. The dates themselves are computed in JS
-- (assets/js/calendar.js) exactly like the regular holidays are.
alter table calendars add column if not exists observe_special_days boolean default false;

-- ---- 3) PAGASA climate type ------------------------------------------------
-- 'I' | 'II' | 'III' | 'IV' — the modified Coronas classification for where the
-- site is. Purely an INPUT to the presets: it seeds the season months in the
-- calendar editor and the rain-day profile in a duration scenario, and nothing
-- reads it at schedule time. Held here because it is a property of the project's
-- location, and re-picking it in every scenario is how a Mindanao project ends
-- up planned against a Luzon wet season.
alter table calendars add column if not exists climate_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calendars_climate_type_chk') then
    alter table calendars add constraint calendars_climate_type_chk
      check (climate_type is null or climate_type in ('I','II','III','IV'));
  end if;
end $$;


-- ==========================================================================
-- [102/142] 2026-08-24-site-plan-bucket.sql
-- ==========================================================================
-- ============================================================================
-- Equipment Loading — storage for the site development plan image
-- 2026-08-24
--
-- The Site Plan view draws each tower as a shape over the project's own site
-- development plan. The plan itself is an image, so it needs a bucket.
--
-- ⚠️ PRIVATE, like every other bucket in this app. A site development plan shows
-- a client's site layout; a public bucket hands it to anyone holding the link,
-- with no login. equipment_site_plan.plan.image_path stores the object PATH and
-- the module signs a short-lived URL on demand — the same construction the
-- drawing register uses, and the reason it does NOT store a URL (a stored one
-- expires and is then useless).
--
-- ⚠️ Objects are laid out as <project_id>/plan-<timestamp>.<ext>, and the policies
-- below are NOT project-scoped: storage.objects has no project column to join on,
-- so the gate is the app's own role check. Anyone approved and not a viewer can
-- upload; the module only ever reads the path stored on a row the caller's RLS
-- already let them read.
--
-- INSERT is is_writer() (approved, not a viewer) rather than the older is_approved()
-- the 2026-06-18 buckets use: that predates viewer-readonly and lets a viewer upload
-- into a plan they cannot write a row for — an orphan by construction. DELETE keeps
-- the owner branch beside is_planner(), matching the settled rule on the other buckets.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('site-plans', 'site-plans', false)
on conflict (id) do nothing;

do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing — run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
end $$;

drop policy if exists site_plans_read on storage.objects;
create policy site_plans_read on storage.objects
  for select using (bucket_id = 'site-plans' and public.is_approved());

drop policy if exists site_plans_insert on storage.objects;
create policy site_plans_insert on storage.objects
  for insert with check (bucket_id = 'site-plans' and public.is_writer());

drop policy if exists site_plans_update on storage.objects;
create policy site_plans_update on storage.objects
  for update using (bucket_id = 'site-plans' and public.is_writer());

-- Replacing a plan deletes the object it replaced, and the person replacing it is
-- rarely the person who uploaded it — hence is_planner() beside the owner branch.
drop policy if exists site_plans_delete on storage.objects;
create policy site_plans_delete on storage.objects
  for delete using (bucket_id = 'site-plans' and (owner = auth.uid() or public.is_planner()));


-- ==========================================================================
-- [103/142] 2026-08-25-equipment-icons.sql
-- ==========================================================================
-- ============================================================================
-- Equipment Loading — a chosen icon per piece of equipment
-- 2026-08-25
--
-- The Site Plan draws each asset as a plant pictogram (tower crane, excavator,
-- boom lift, …) on the chip, the register row and inside the tower it works on.
-- The icon is normally READ FROM THE NAME, and this column is the override.
--
-- ⚠️ NULL means "auto", and that is deliberate rather than storing the guessed
-- key. Freezing the guess would mean renaming "Crane" to "Tower Crane 2" kept the
-- mobile-crane pictogram forever; a null lets the guess keep up with the name.
--
-- ⚠️ No CHECK constraint and no lookup table. The icon set is a client-side list
-- of SVG paths, so a constraint here would have to be edited in lockstep with a
-- JS array — and a retired icon key would then block saves on rows nobody is
-- editing. The module falls back to the guess for a key it does not recognise.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table equipment_items add column if not exists icon text;


-- ==========================================================================
-- [104/142] 2026-08-25-package-adoption.sql
-- ==========================================================================
-- ============================================================================
-- Migration: A3's TAIL — package adoption on the Contracts & Claims tables,
--            which also answers design decision #2 (does the BOQ define the
--            packages?). ⚠️ That answer was CORRECTED on 2026-08-26 — see
--            section 2. The column is right; the tool built on it was not.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-19-packages.sql and 2026-08-24-boq.sql.
--
-- A3 left this open: `packages` exists and the Dashboard manages it, but no
-- module table carried `package_id`, so selecting a package narrowed nothing.
-- MODULE_CONTRACT §6b sets the rule for closing it — "add the column AND the UI
-- that sets it in the same change, or you create rows belonging to no package
-- that vanish from any package-filtered view." This migration is the column half
-- of exactly that, for the two tables where a package is genuinely load-bearing.
--
-- ⚠️ ADOPTION IS DELIBERATELY NOT UNIVERSAL. It is NOT added to:
--   - risk_register / issues_lessons — a risk or an issue is raised about the
--     project, and forcing a package onto it invents a precision nobody has.
--   - productivity_activities — it already carries `work_package`, a WPM `wp_no`,
--     which is a DIFFERENT axis (what procurement bought). Two package-shaped
--     columns on one table is how a report ends up joining the wrong one.
--   - the cash_flow_* tables — `cash_flow_trade_packages` is already that
--     module's own notion of a package split, and a third would drift from both.
--   - drawing_register / material_submittal — retired as live modules (2026-08-19);
--     their tables are stale history and must not gain new columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) contracts_claims.package_id — a claim is raised AGAINST a package
-- ---------------------------------------------------------------------------
-- The commercial case for a claim, change order or EOT is almost always scoped
-- to one contract package, and "which package is bleeding" is a question the
-- register cannot answer today.
--
-- ⚠️ on delete set null, never cascade. Retiring a package must not delete the
--    claims raised under it — those are the commercial record, and they outlive
--    the lot they were raised against.
alter table contracts_claims add column if not exists package_id uuid
  references packages(id) on delete set null;
create index if not exists idx_contracts_claims_package on contracts_claims (package_id);

-- ---------------------------------------------------------------------------
-- 2) boq_items.package_id — DESIGN DECISION #2
-- ---------------------------------------------------------------------------
-- The question was: "Does the BOQ define the packages?"
--
-- FIRST ANSWER (2026-08-25), WRONG, kept here because the correction only makes
-- sense against it: "the BOQ proposes packages — offer one package per trade
-- sheet, never auto-create." That assumed a trade sheet is a commercial lot.
--
-- CORRECTED 2026-08-26 by the owner. A CONTRACT PACKAGE IS A SCOPE DIVISION OF
-- THE PROJECT, NOT A TRADE. His example — one project, two packages:
--     Package 1 — Avesta Residences Tower 1 and General Requirements
--     Package 2 — Avesta Residences Towers 2-7
-- The BOQ workbook belongs TO a package (the real file IS Package 2), and the
-- sheets inside it are whatever breakdown THE CLIENT dictated for that package's
-- progress billing — by trade on this job, by something else on the next.
--
-- ⚠️ SO THE OLD TOOL WAS BACKWARDS AND IS DELETED. One package per trade sheet
--    would have minted four lots ("Architectural", "ACOUSTIC") where the
--    contract has one, and a claim later raised against "package ACOUSTIC"
--    would cite a lot appearing on no contract document.
--    The BOQ tab now only ASSIGNS lines to a package that already exists;
--    packages are created on the Dashboard, from the contract documents.
--
-- ⚠️ ON THE ITEM, NOT ON THE REVISION — and the reason survives the correction.
--    One issued document can cover more than one lot, so a
--    boq_revisions.package_id would force the whole workbook into one package
--    and make a per-package contract value unrepresentable. Assignment is per
--    sheet in bulk; storage stays per line so a re-measured sheet that moves
--    between lots is corrected without touching the others.
--
-- ⚠️ on delete set null: deleting a package must never delete contract scope.
alter table boq_items add column if not exists package_id uuid
  references packages(id) on delete set null;
create index if not exists idx_boq_items_package on boq_items (package_id);

-- ---------------------------------------------------------------------------
-- 3) Reading a package's BOQ value
-- ---------------------------------------------------------------------------
-- ⚠️ security_invoker so the caller's RLS applies — without it this view would
--    report every project's package values to anyone who can select from it.
-- ⚠️ The same money rule the BOQ tab itself uses: heading rows are subtotals of
--    the lines beneath them (double-count) and an excluded line's "amount" is a
--    sentence, so neither contributes. Getting this wrong here would make a
--    package's contract value disagree with the BOQ screen that produced it.
create or replace view boq_package_value
  with (security_invoker = true) as
select i.project_id,
       i.package_id,
       i.revision_id,
       i.scope_type,
       count(*)                       as line_count,
       sum(i.amount)                  as amount,
       sum(i.mat_amount)              as material,
       sum(i.lab_amount)              as labour
from boq_items i
where i.package_id is not null
  and i.line_kind <> 'heading'
  and i.exclusion_note is null
  and i.amount is not null
group by i.project_id, i.package_id, i.revision_id, i.scope_type;

grant select on boq_package_value to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Verify
-- ---------------------------------------------------------------------------
--   select column_name from information_schema.columns
--    where (table_name, column_name) in
--          (('contracts_claims','package_id'), ('boq_items','package_id'));   -- expect 2
--   select * from boq_package_value limit 5;   -- empty until the BOQ tab assigns
--
-- No back-fill and no seed: every existing row keeps package_id NULL, which is
-- the truthful state — nobody has said which lot it belongs to yet.


-- ==========================================================================
-- [105/142] 2026-08-25-pmi.sql
-- ==========================================================================
-- ============================================================================
-- Migration: PMI TRACKING — the instruction, its case file, and the contractual
--            cost build-up that turns it into priced scope.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Implements ROADMAP B2a + B2b + B2c. Design note: docs/boq-and-pmi.md §5 —
-- grounded in a real 14-page filed PMI (MST347. OPS. VO-PMI 29.2 rev1, My Enso
-- Lofts / PH1 World Developers), measured rather than assumed.
--
-- ⚠️ WHY A SEPARATE TABLE FROM contracts_claims, AND NOT A record_type
--   contracts_claims holds the COMMERCIAL record: a priced claim / change order
--   / EOT moving through Estimated -> Submitted -> Evaluated -> Client Approved.
--   A PMI is the INSTRUCTION that precedes it and may never become one. It
--   arrives, it sits un-responded (which is our exposure and is invisible
--   today), it may be revised three times, and ONE PMI can spawn several
--   proposals that each become their own change order. A record_type would need
--   three self-FKs, a second reference number and a receipt stage bolted onto
--   rows where all of it is meaningless — and a 1:1 with contracts_claims would
--   make the 29 -> 29.2 -> rev1 chain unrepresentable. `claim_id` links the two
--   when a PMI does become priced work, so neither owns the other's state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) contract_profiles — the parts that vary by client (§5.7)
-- ---------------------------------------------------------------------------
-- "The PMI format varies by client" is answered by MODELLING WHAT IS INVARIANT
-- and making the rest configuration. Invariant everywhere: an instruction is
-- issued, it describes scope, we respond with a priced proposal, it is
-- adjudicated, and it may become a change order and/or an EOT. That is the
-- record. What varies is the vocabulary and the paperwork, and it lives here.
create table if not exists contract_profiles (
  id                uuid primary key default gen_random_uuid(),
  project_id        text not null references projects(id) on delete cascade,
  name              text not null,
  -- ⚠️ The LABEL is configuration, not a constant: the same record is a "PMI"
  --    to one client, a "Site Instruction" / "Architect's Instruction" /
  --    "Variation Order" to the next. Hard-coding "PMI" in the UI would make
  --    the screen wrong for most clients.
  instruction_label text not null default 'PMI',
  -- Free text, shown as a hint beside the reference field. Deliberately NOT a
  -- validated regex: a client who changes their own numbering mid-project must
  -- not be blocked from filing the instruction they actually received.
  ref_pattern       text,
  -- Which of the document types below this client demands before a submission
  -- counts as complete (§5.1). Empty = nothing is mandatory.
  required_docs     text[] not null default '{}',
  -- The approval roles on each side, in order. jsonb because the number and the
  -- names differ per client: ours is Office Supervisor -> MEPF & Finishing
  -- Manager -> Project Manager -> COO; theirs is Prepared / Checked / Noted /
  -- Approved plus a D&C Head.
  internal_roles    jsonb not null default '[]'::jsonb,
  client_roles      jsonb not null default '[]'::jsonb,
  is_default        boolean not null default false,
  notes             text,
  created_by        uuid references users(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create unique index if not exists contract_profiles_name_idx
  on contract_profiles (project_id, lower(name));
create index if not exists contract_profiles_project_idx
  on contract_profiles (project_id, is_default);

-- ---------------------------------------------------------------------------
-- 2) contract_cost_terms — the build-up as a RATE CARD, not an amount (§5.5)
-- ---------------------------------------------------------------------------
-- The real sheet:
--   A  Direct cost (material + labour), VAT-ex        8,707,500.00
--   B  A + (A x 10%)   markup                         9,578,250.00
--   C  B x 20%         "Fix Cost" — As per Contract    1,915,650.00
--   D  B + C                                         11,493,900.00
--   E  D x 12%         VAT                             1,379,268.00
--   F  D + E           TOTAL                          12,873,168.00
--
-- ⚠️ THE PERCENTAGES ARE MARKED "As per Contract" — THEY ARE PER-CONTRACT TERMS,
--    NOT CONSTANTS. Another client has a different markup, a different fix-cost
--    basis (or none), and a different VAT treatment (zero-rated, or VAT-inclusive
--    as Cash Flow's vat_percent checkbox already handles). Hard-coding 10/20/12
--    produces confidently wrong proposals on the next project — which is exactly
--    the kind of number that gets quoted in a meeting.
--
-- ⚠️ A PROPOSAL'S TOTAL IS DERIVED from its lines + this card, never stored. The
--    same card prints the sheet, so the screen and the paper cannot disagree.
create table if not exists contract_cost_terms (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  profile_id  uuid not null references contract_profiles(id) on delete cascade,
  step_order  integer not null,
  -- The letter the sheet prints (A/B/C/D/E/F). Referenced by basis_codes below,
  -- so it is the step's identity within its card.
  code        text not null,
  label       text not null,
  -- How this step is computed from the ones before it:
  --   direct     — the sum of the proposal's own priced lines (the only leaf)
  --   markup_add — basis x (1 + rate)      e.g. B = A + (A x 10%)
  --   percent_of — basis x rate            e.g. C = B x 20%,  E = D x 12%
  --   sum        — the sum of basis_codes  e.g. D = B + C,    F = D + E
  kind        text not null
              check (kind in ('direct','markup_add','percent_of','sum')),
  -- ⚠️ WHICH EARLIER STEP THIS MULTIPLIES OR SUMS. An array because `sum` takes
  --    several; a single-element array for the multiplying kinds. Codes, not
  --    ids, so a card reads like the sheet it came from.
  basis_codes text[] not null default '{}',
  rate        numeric,
  -- Marks the grand total (F), so a report knows which line to print in bold
  -- without assuming it is the last row.
  is_total    boolean not null default false,
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create unique index if not exists contract_cost_terms_code_idx
  on contract_cost_terms (profile_id, upper(code));
create unique index if not exists contract_cost_terms_order_idx
  on contract_cost_terms (profile_id, step_order);
create index if not exists contract_cost_terms_project_idx
  on contract_cost_terms (project_id);

-- ---------------------------------------------------------------------------
-- 3) pmi_records — the instruction and its lifecycle (§5.2, §5.3, §5.4)
-- ---------------------------------------------------------------------------
create table if not exists pmi_records (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  profile_id  uuid references contract_profiles(id) on delete set null,

  -- ⚠️ TWO REFERENCE NUMBERS, BOTH REAL, BOTH SEARCHABLE. The client's is
  --    'MEL.CON.PMI-029'; ours is 'MST347. OPS. VO-PMI 29.2 (rev1)' — project
  --    code, department, our own sequence. A single reference_no forces a
  --    choice, and the number you drop is the one the other party will cite.
  --    That is how a claim becomes unfindable in the meeting where it matters.
  client_ref  text,
  our_ref     text,

  title       text,
  scope       text,          -- what the instruction tells us to do, verbatim

  -- ⚠️ THREE DISTINCT RELATIONS, not one string. A flat reference_no collapses
  --    all three into something nobody can group by.
  --    parent_id      — PMI 29 is the instruction; 29.2 is one cost proposal
  --                     under it (rangehood only, of rangehood + in-line fan +
  --                     cooktop).
  --    supersedes_id  — rev1 supersedes rev0. Revisions are their OWN ROWS and
  --                     are NEVER overwritten: a superseded proposal is the
  --                     evidence for what changed and why.
  --    spawned_from_id— the form says "Separate PMI for site implementation will
  --                     be issued upon approval of the cost proposal". One PMI
  --                     ISSUES another. That is a third relation; conflating it
  --                     with parent or revision loses the chain.
  parent_id       uuid references pmi_records(id) on delete set null,
  supersedes_id   uuid references pmi_records(id) on delete set null,
  spawned_from_id uuid references pmi_records(id) on delete set null,
  -- Which row in a revision chain is the live one. Derivable, but stored so a
  -- list query does not need a recursive walk per row.
  is_latest       boolean not null default true,

  -- ⚠️ RECEIPT IS A REAL STAGE AND IT COMES FIRST. The existing four-stage
  --    commercial pipeline is correct and is kept; what it did not carry is that
  --    the instruction ARRIVES before we estimate anything, and time sitting on
  --    an un-responded PMI is OUR exposure — invisible today.
  stage       text not null default 'received'
              check (stage in ('received','estimated','submitted','evaluated',
                               'client_approved','rejected','withdrawn')),
  -- Adjudication result, reusing contracts_claims' own vocabulary rather than
  -- inventing a parallel one (the two registers are read side by side).
  outcome     text check (outcome in ('Pending','Approved','Disapproved','Cancelled')),

  -- Real dates from the sample, which is why there are this many: issued
  -- 09-Jan-2025 -> received by MCC 08-Feb-2025 -> testing 25-May-2026 -> cost
  -- proposal 24-Jun-2026. Roughly EIGHTEEN MONTHS.
  date_issued    date,
  date_received  date,
  date_estimated date,
  date_submitted date,
  date_evaluated date,
  date_decided   date,

  -- ⚠️ THE INTERNAL APPROVAL CHAIN WITHIN A STAGE, which the four-stage pipeline
  --    cannot express: a proposal three weeks with the COO is not "Submitted" —
  --    it is NOT SUBMITTED AT ALL. jsonb keyed by role, because the roles are
  --    per-client configuration (contract_profiles.internal_roles/client_roles),
  --    not a fixed set of columns.
  internal_chain jsonb not null default '{}'::jsonb,
  client_chain   jsonb not null default '{}'::jsonb,

  -- Set when this instruction becomes priced commercial work. on delete set
  -- null: deleting the claim must never delete the instruction that caused it.
  claim_id    uuid references contracts_claims(id) on delete set null,
  eot_days    numeric,        -- an instruction can carry time as well as money

  -- ⚠️ The escape hatch for genuinely client-specific header fields, same rule
  --    as activity_codes / udf / location: it is for fields NOTHING QUERIES. Put
  --    anything you need to filter or total into a real column instead.
  raw         jsonb not null default '{}'::jsonb,

  remarks     text,
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ⚠️ OUR reference is unique per project; the CLIENT'S deliberately is NOT. One
--    client instruction (MEL.CON.PMI-029) legitimately spans a parent, its
--    proposals and every revision of them — they all cite the same client
--    number, and forcing that unique would make a revision impossible to file.
create unique index if not exists pmi_records_our_ref_idx
  on pmi_records (project_id, lower(our_ref)) where our_ref is not null;
create index if not exists pmi_records_client_ref_idx
  on pmi_records (project_id, lower(client_ref));
create index if not exists pmi_records_project_stage_idx
  on pmi_records (project_id, stage, is_latest);
create index if not exists pmi_records_parent_idx     on pmi_records (parent_id);
create index if not exists pmi_records_supersedes_idx on pmi_records (supersedes_id);
create index if not exists pmi_records_spawn_idx      on pmi_records (spawned_from_id);
create index if not exists pmi_records_claim_idx      on pmi_records (claim_id);

-- ⚠️ NO AGING, NO RECOVERY RATE, NO TOTAL COLUMN. All three are derived:
--    - aging is PER STAGE (days since receipt while un-responded, days since
--      submission while pending, days in internal approval). One aging number
--      over a 16-month case answers nothing, and a stored one is wrong the day
--      after it is written.
--    - recovery rate stays over DECIDED records only — the naive denominator
--      read 0.2% on the real fixture where the honest figure was 85.0% of one
--      decided record, and a long-lived PMI register makes that worse, not better.
--    - the proposal total is its priced lines through the rate card (§5.5).

-- ---------------------------------------------------------------------------
-- 4) pmi_attachments — a filed PMI is a CASE FILE, not a form (§5.1)
-- ---------------------------------------------------------------------------
-- The sample is 14 pages and FIVE distinct documents by three different authors:
--   p1     cost proposal (the priced response + its build-up)   Megawide
--   p2     the client's PMI form (ref, scope, signature matrix) PH1 World
--   p3-5   product photos + design-manager approval             Megawide/supplier
--   p8-11  performance testing report EPC-ENG-TRN-26553a        MCC Engineering
--   p12-14 supplier sales contract Kin Long JS20260506-01       Vendor
--
-- ⚠️ SO A PMI NEEDS MANY TYPED ATTACHMENTS, NOT ONE file_url. A single file
--    column cannot answer "has the cost proposal been submitted?" separately
--    from "is the testing report attached?" — which is exactly what a QS asks
--    when chasing one.
create table if not exists pmi_attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  pmi_id      uuid not null references pmi_records(id) on delete cascade,
  doc_type    text not null default 'other'
              check (doc_type in ('cost_proposal','client_form','product_data',
                                  'testing_report','supplier_contract','other')),
  -- ⚠️ THE OBJECT PATH, NOT A URL. The bucket is private, so the URL is signed
  --    on demand; a stored URL expires and is then worse than useless because it
  --    looks like a working link. Same construction as drawing_register.file_url.
  file_path   text not null,
  file_name   text,
  file_size   bigint,
  label       text,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now()
);
-- Several files per type is the normal case (the photos are three pages), so
-- this is deliberately NOT unique on (pmi_id, doc_type).
create index if not exists pmi_attachments_pmi_idx on pmi_attachments (pmi_id, doc_type);
create index if not exists pmi_attachments_project_idx on pmi_attachments (project_id);

-- ---------------------------------------------------------------------------
-- 5) boq_items.pmi_id — a PMI cost proposal IS a BOQ (§5.6)
-- ---------------------------------------------------------------------------
-- '1,204 units, material rate, labour rate, total' is exactly the shape of the
-- contract BOQ, so a variation's priced lines go into boq_items with
-- scope_type='change_order' rather than a parallel table that would guarantee
-- the two drift. That makes a variation measurable, mappable to class codes,
-- allocatable to activities, and rollable into the S-curve exactly like contract
-- work — while still reporting separately as where-the-money-came-from.
--
-- ⚠️ THIS IS THE COLUMN 2026-08-24-boq.sql DELIBERATELY WITHHELD. It lands now,
--    with the UI that sets it — a pointer added before anything can populate it
--    produces rows belonging to no PMI that vanish from any PMI-filtered view.
alter table boq_items add column if not exists pmi_id uuid references pmi_records(id) on delete set null;
create index if not exists boq_items_pmi_idx on boq_items (pmi_id);

-- ⚠️ A PMI's priced lines need a REVISION to hang on: boq_items.revision_id is
--    NOT NULL and identity is (revision_id, sheet, source_row). Rather than
--    weaken that (a nullable revision_id makes the unique index toothless,
--    because NULLs are distinct in Postgres), each PMI proposal gets its OWN
--    boq_revision. That is also the honest reading — a revision of the PMI IS a
--    revision of its priced scope — and it keeps change-order lines out of the
--    contract document's revision, so the BOQ tab's contract total is unaffected.
--    The BOQ tab lists `pmi_id is null` revisions; the PMI tab lists its own.
alter table boq_revisions add column if not exists pmi_id uuid references pmi_records(id) on delete cascade;
create index if not exists boq_revisions_pmi_idx on boq_revisions (pmi_id);

-- ⚠️ TWO DIFFERENT DELETE RULES ON PURPOSE, and the asymmetry is the point:
--    - boq_revisions.pmi_id CASCADES. A proposal's priced scope has no meaning
--      without the instruction that priced it, and boq_items.revision_id already
--      cascades from the revision, so deleting a PMI removes exactly its own
--      lines and nothing else.
--    - boq_items.pmi_id SETS NULL. A CONTRACT BOQ line may be tagged to a PMI
--      for attribution while still belonging to the contract revision; deleting
--      the PMI must not delete contract scope. It loses its tag, not its life.

-- ⚠️ It also closes a real gap: variation work currently carries no quantities
--    anywhere, so a change order can be scheduled but its productivity can never
--    be measured. boq_activity_quantity already covers change-order lines,
--    because it filters on line_kind and never on scope_type.

-- ---------------------------------------------------------------------------
-- 6) Access — the standard project-scoped shape
-- ---------------------------------------------------------------------------
-- read follows project access; write additionally requires planner. A viewer
-- must never file or price an instruction. See 2026-07-21-rls-project-scope-fix.
do $$
declare t text;
begin
  foreach t in array array['contract_profiles','contract_cost_terms',
                           'pmi_records','pmi_attachments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) updated_at stays honest
-- ---------------------------------------------------------------------------
create or replace function pmi_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['contract_profiles','contract_cost_terms','pmi_records']
  loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function pmi_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8) The private contracts-claims bucket (B2a)
-- ---------------------------------------------------------------------------
-- The 2026-06-18 migration created only drawing-register / progress-photos /
-- material-submittal. This is the fourth, and it follows mom-attachments (the
-- 2026-08-21 precedent), NOT the older three.
insert into storage.buckets (id, name, public)
values ('contracts-claims', 'contracts-claims', false)
on conflict (id) do nothing;

-- ⚠️ INSERT is `is_writer()`, NOT the `is_approved()` the 2026-06-18 buckets
--    use. That older rule predates viewer-readonly and lets a VIEWER upload into
--    a register they cannot write a row to — an orphan file by construction. A
--    new bucket has no legacy uploads to protect, so it starts on the correct
--    rule rather than inheriting the drift.
drop policy if exists contracts_claims_read on storage.objects;
create policy contracts_claims_read on storage.objects
  for select using (bucket_id = 'contracts-claims' and is_approved());

drop policy if exists contracts_claims_ins on storage.objects;
create policy contracts_claims_ins on storage.objects
  for insert with check (bucket_id = 'contracts-claims' and is_writer());

-- ⚠️ DELETE keeps the owner branch beside is_planner(), the settled rule on the
--    other four: a planner deleting a PMI someone else attached to must actually
--    remove the object, or the row goes and the file is orphaned — while the
--    uploader keeps the right to remove their own.
drop policy if exists contracts_claims_del on storage.objects;
create policy contracts_claims_del on storage.objects
  for delete using (
    bucket_id = 'contracts-claims' and (owner = auth.uid() or is_planner())
  );

-- ---------------------------------------------------------------------------
-- 9) No seed
-- ---------------------------------------------------------------------------
-- ⚠️ Deliberately NO default contract profile and NO seeded 10/20/12 rate card.
--    A seeded card is the hard-coded percentages by another name: it would be
--    silently applied to the next client's proposal and read as a considered
--    contractual term. The UI offers the sample build-up as a one-click TEMPLATE
--    the planner must accept, which is a different thing entirely.
--
-- Verify:
--   select id, public from storage.buckets where id = 'contracts-claims';
--   select polname from pg_policy where polrelid = 'storage.objects'::regclass
--     and polname like 'contracts_claims%' order by polname;


-- ==========================================================================
-- [106/142] 2026-08-25-schedule-cost-loading.sql
-- ==========================================================================
-- ============================================================================
-- Cost Loading (Project Schedule) — how a project's cost is assigned to activities.
-- 2026-08-25
--
-- One config row per project. The config holds the WORKING state of the loading
-- exercise: a total per named activity, and how that total is distributed across
-- the sub-WBS instances of that name.
--
-- ⚠️ The MONEY ITSELF is not stored here. Applying the loading writes
-- `project_schedule.planned_cost` on each activity row — the column the Cost/EVM
-- dashboard, the exports and Cash Flow's cost-basis S-curve already read. A second
-- place holding per-activity cost would let two screens disagree about the same
-- peso, which is the failure this app has already had to fix in the equipment
-- matrix and the BOQ billing sheets.
--
-- ⚠️ The config keys its instances by `activity_id` (the P6/business key), NEVER by
-- the schedule row's uuid: a re-import replaces every row and mints new uuids while
-- the activity ids stay stable, so a uuid-keyed distribution would silently reset
-- to "equal" on the next import.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_cost_loading (
  project_id  text primary key references projects(id) on delete cascade,
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

alter table schedule_cost_loading enable row level security;

grant select, insert, update, delete on schedule_cost_loading to authenticated;

-- Project-scoped RLS (the 2026-07-21 convention):
--   read  = approved AND can access the project
--   write = writer role AND can access the project
drop policy if exists schedule_cost_loading_read  on schedule_cost_loading;
drop policy if exists schedule_cost_loading_write on schedule_cost_loading;

create policy schedule_cost_loading_read on schedule_cost_loading
  for select using ( can_access_project(project_id) );

create policy schedule_cost_loading_write on schedule_cost_loading
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );


-- ==========================================================================
-- [107/142] 2026-08-25-vendor-identity.sql
-- ==========================================================================
-- ============================================================================
-- Migration: F1 — VENDOR IDENTITY in the Planners app.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Implements ROADMAP F1. Design note: docs/vendor-performance-chain.md §3.
--
-- THE GAP THIS CLOSES
--   schedule → package → procurement → vendor is four-fifths built (A3, C1, E1,
--   E2 + WPM's own vendor management). The missing link is that the Planners app
--   has NO VENDOR ENTITY AT ALL: `wpm_work_packages` mirrors budgets, dates and
--   award status but not who won the package, and
--   `productivity_activities.subcontractor` is free text that joins to nothing.
--   Without this, "how is this vendor performing" cannot be asked.
--
-- ⚠️ MIRROR, NEVER A LIVE BROWSER READ. WPM's anon key ships in its client JS and
--    its `vendors` table sits beside `vendor_rates`. Reading it from the browser
--    would expose commercial data, which is exactly why E1 established the
--    server-side mirror for budgets. Writes here happen ONLY through the
--    `sync-wpm` Edge Function using WPM's service-role key.
--
-- ⚠️ COLUMN NAMES ARE TAKEN FROM WPM'S OWN MIGRATIONS, NOT GUESSED —
--    MIGRATION_vendor_management.sql (name, trade_categories, status),
--    MIGRATION_vendor_accreditation.sql (accreditation, accreditation_date),
--    MIGRATION_vendor_code.sql (vendor_code) and MIGRATION_vendor_merge.sql
--    (work_packages.awarded_vendor_ids / awarded_vendor_amounts). A guessed name
--    reads NULL forever and looks like "this vendor has no packages".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) wpm_vendors — the mirror
-- ---------------------------------------------------------------------------
-- ⚠️ NAMES AND TRADES ONLY. No contact_person / contact_number / contact_email /
--    address, and no rates. Vendor commercial and personal data stays in WPM;
--    this app needs only enough to say WHO did the work and in WHICH trade.
--    Adding a contact column here would quietly turn a performance mirror into a
--    second contacts database with no owner.
create table if not exists wpm_vendors (
  -- The WPM `vendors.id`, carried across as the primary key so every
  -- `vendor_id` in this app means the same thing it means in WPM.
  id               uuid primary key,
  name             text not null,
  vendor_code      text,
  -- WPM's subset of the 10 canonical WP trades.
  trade_categories text[] not null default '{}',
  -- 'accredited' | 'unaccredited' | 'problematic' (WPM's own vocabulary,
  -- nullable there and here — an unassessed vendor is not "unaccredited").
  accreditation      text,
  accreditation_date date,
  -- 'pending_review' | 'approved' | 'inactive' | 'rejected'
  status           text,
  synced_at        timestamptz default now()
);
create index if not exists idx_wpm_vendors_name on wpm_vendors (lower(name));
create index if not exists idx_wpm_vendors_status on wpm_vendors (status);

-- Same access shape as the work-package mirror: readable by any approved user
-- (the mirror is not mapped to a Planners project id, so it gates on approval
-- only), and NO write policy — the Edge Function's service-role key bypasses RLS.
alter table wpm_vendors enable row level security;
drop policy if exists wpm_vendors_read on wpm_vendors;
create policy wpm_vendors_read on wpm_vendors
  for select using (is_approved());
grant select on wpm_vendors to authenticated;

-- ---------------------------------------------------------------------------
-- 2) The award columns on the work-package mirror
-- ---------------------------------------------------------------------------
-- Additive to the same upsert the Edge Function already performs; dates, budget
-- and award status already come across.
alter table wpm_work_packages add column if not exists vendor_id uuid;
-- ⚠️ awarded_vendor_ids AND awarded_vendor_amounts ARE INDEX-ALIGNED in WPM
--    (see MIGRATION_vendor_merge.sql, which maintains that alignment when two
--    vendor records merge). They must be mirrored as a PAIR and read by index —
--    sorting or de-duplicating one without the other silently reassigns money to
--    the wrong vendor.
alter table wpm_work_packages add column if not exists awarded_vendor_ids uuid[];
alter table wpm_work_packages add column if not exists awarded_vendor_amounts numeric[];
-- WPM's display string. Kept because it is what the buyer typed and it stays
-- readable when a vendor row is later merged or renamed.
alter table wpm_work_packages add column if not exists contractor text;

create index if not exists idx_wpm_mirror_vendor on wpm_work_packages (vendor_id);

-- ---------------------------------------------------------------------------
-- 3) The productivity link
-- ---------------------------------------------------------------------------
-- ⚠️ NO FOREIGN KEY TO wpm_vendors, deliberately — the same call as
--    project_schedule.class_code. This is a MIRROR that the sync refreshes
--    wholesale: a vendor that leaves WPM (or has not been synced yet) would make
--    an FK either block the sync or cascade real productivity history away. A
--    plain uuid that resolves to "unknown vendor" on screen is recoverable; a
--    deleted month of site records is not.
alter table productivity_activities add column if not exists vendor_id uuid;
create index if not exists idx_prod_act_vendor on productivity_activities (vendor_id);

-- ⚠️ THE FREE-TEXT `subcontractor` IS KEPT AND IS NOT BACK-FILLED HERE.
--    It is the legacy value the site actually typed ("AFCSC", "JM2", "CEC",
--    "GeoExpert") and it stays the display fallback — exactly as E2 kept an
--    unresolvable `work_package` visible as UNLINKED rather than blanking it.
--    Matching those strings to vendor rows is a judgement (they are abbreviations,
--    and two projects may abbreviate differently), so the module offers a
--    one-by-one picker and never guesses.

-- ---------------------------------------------------------------------------
-- 4) Verify
-- ---------------------------------------------------------------------------
--   select count(*) from wpm_vendors;                       -- 0 until sync-wpm runs
--   select column_name from information_schema.columns
--    where table_name = 'wpm_work_packages'
--      and column_name in ('vendor_id','awarded_vendor_ids',
--                          'awarded_vendor_amounts','contractor');   -- expect 4
--
-- ⚠️ AFTER RUNNING THIS: redeploy the Edge Function and re-sync, or every column
--    above stays NULL and the vendor screens read "no vendors" rather than
--    erroring:
--      supabase functions deploy sync-wpm --project-ref bgupuqnkqhixpuctyder
--    then press "Sync from WPM" in Cash Flow (or POST the function).
--    The function self-heals against a partly-migrated mirror — it drops a column
--    the mirror lacks and reports it in `dropped` — so the order is forgiving,
--    but nothing appears until both halves are done.


-- ==========================================================================
-- [108/142] 2026-08-25-vendor-performance.sql
-- ==========================================================================
-- ============================================================================
-- Migration: F2 / F3 / F4 / F5 — VENDOR PERFORMANCE.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-25-vendor-identity.sql (F1) and 2026-08-24-boq.sql (B1).
--
-- Design note: docs/vendor-performance-chain.md §3.
--
-- ⚠️ EVERY FUNCTION HERE IS `security invoker`, like schedule_scurve_agg_multi.
--    These read project_schedule across projects; a definer function would hand
--    every caller the whole portfolio regardless of their project assignments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- F2a) The productivity → work-package link
-- ---------------------------------------------------------------------------
-- ⚠️ A WPM `wp_no`, the SAME key and the same picker `project_schedule.work_package`
--    already uses (2026-08-20). A second, differently-keyed link would make
--    "this vendor's planned vs actual" unjoinable without a translation table.
alter table productivity_activities add column if not exists work_package text;
create index if not exists idx_prod_act_wp on productivity_activities (project_id, work_package);

-- ---------------------------------------------------------------------------
-- F2b) Planned (BOQ) vs actual (productivity) quantity — the reconciliation
-- ---------------------------------------------------------------------------
-- ⚠️ THESE TWO NUMBERS ARE NOT THE SAME NUMBER AND MUST NOT BE FORCED TO AGREE.
--    BOQ quantity is measured FOR PAYMENT; productivity output is measured FOR
--    PROGRESS. Waste, remeasure, provisional sums and cut allowances separate
--    them legitimately. The variance is itself the information — over-consumption
--    on one side, a remeasure claim on the other. This view REPORTS it; nothing
--    anywhere reconciles it away.
--
-- ⚠️ GROUPED BY UNIT, AND UNITS ARE NEVER CONVERTED. If the BOQ measures a
--    package in m2 and the site reports it in kg, that is a fact to show, not a
--    conversion to invent — a wrong factor here silently rescales a vendor's
--    entire performance record.
create or replace view vendor_qty_reconciliation
  with (security_invoker = true) as
with planned as (
  -- Planned quantity reaches an activity through boq_allocations (B1), and only
  -- 'measured' lines contribute — lump-sum and provisional lines carry money but
  -- no measurable quantity, and letting them in corrupts every rate derived here.
  select ps.project_id,
         ps.work_package,
         q.unit,
         sum(q.qty) as qty_planned
  from boq_activity_quantity q
  join project_schedule ps
    on ps.project_id = q.project_id
   and ps.activity_id = q.activity_id
  where ps.work_package is not null
  group by ps.project_id, ps.work_package, q.unit
),
actual as (
  select pa.project_id,
         pa.work_package,
         pa.unit,
         sum(coalesce(pe.qty_actual, 0))  as qty_actual,
         sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) as man_days,
         min(pe.period) as first_period,
         max(pe.period) as last_period
  from productivity_activities pa
  join productivity_entries pe on pe.activity_id = pa.id
  where pa.work_package is not null
  group by pa.project_id, pa.work_package, pa.unit
)
select coalesce(p.project_id, a.project_id)     as project_id,
       coalesce(p.work_package, a.work_package) as work_package,
       coalesce(p.unit, a.unit)                 as unit,
       -- ⚠️ Null, not 0, when a side has nothing: "no BOQ line allocated here"
       --    and "allocated zero" are different facts, and only one of them is a
       --    reason to go and look.
       p.qty_planned,
       a.qty_actual,
       case when p.qty_planned is not null and a.qty_actual is not null
            then a.qty_actual - p.qty_planned end as qty_variance,
       -- ⚠️ Only meaningful when both sides measure the SAME unit. A full outer
       --    join on unit means a mismatch shows as two rows with one side null,
       --    which is exactly the signal a planner needs.
       case when p.unit is not distinct from a.unit then true else false end as units_agree,
       a.man_days,
       case when a.man_days > 0 then a.qty_actual / a.man_days end as rate_per_man_day,
       a.first_period, a.last_period
from planned p
full outer join actual a
  on  a.project_id   = p.project_id
  and a.work_package = p.work_package
  and a.unit is not distinct from p.unit;

grant select on vendor_qty_reconciliation to authenticated;

-- ---------------------------------------------------------------------------
-- F3) The vendor S-curve
-- ---------------------------------------------------------------------------
-- ⚠️ THIS IS schedule_scurve_agg_multi's BODY WITH ONE EXTRA FILTER on the leaf
--    CTE — deliberately, so a vendor curve and the project curve can never
--    disagree about what a month or a weight means. If that function's weighting
--    changes, change it here too.
--
-- ⚠️ THE PLANNERS→WPM PROJECT MAPPING IS CASH FLOW'S
--    (`cash_flow_settings.wpm_project_id`, falling back to the project id). Two
--    modules disagreeing about which WPM project a schedule belongs to would show
--    different packages for the same job.
--
-- ⚠️ CO-AWARDED PACKAGES ARE ATTRIBUTED TO THE PRIMARY `vendor_id` ONLY (open
--    decision #2). Counting a shared package for both co-awardees would
--    double-count the project total. The omission is NOT silent: `coAwarded`
--    below reports how many packages named this vendor only as a co-awardee, so
--    a curve that looks short can be explained rather than doubted.
create or replace function schedule_scurve_agg_vendor(p_ids text[], p_vendor_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
  with wp as (
    -- The vendor's packages, per Planners project, through Cash Flow's mapping.
    select p.id as project_id, m.wp_no, m.vendor_id, m.awarded_vendor_ids
    from unnest(p_ids) as p(id)
    left join cash_flow_settings cs on cs.project_id = p.id
    join wpm_work_packages m
      on m.wpm_project_id = coalesce(cs.wpm_project_id, p.id)
  ),
  mine as (
    select project_id, wp_no from wp where vendor_id = p_vendor_id
  ),
  leaves as (
    select
      coalesce(nullif(ps.duration_days, 0), (ps.end_date - ps.start_date) + 1, 1)::numeric as w_dur,
      coalesce(ps.planned_cost, ps.bl_cost, 0)::numeric                                    as w_cost,
      ps.start_date::date                                                                  as s,
      coalesce(ps.end_date, ps.start_date)::date                                           as e,
      coalesce(ps.actual_start, ps.start_date)::date                                       as as_,
      coalesce(ps.actual_finish, ps.end_date, ps.actual_start, ps.start_date)::date        as ae_,
      greatest(0, least(100, coalesce(ps.percent_complete, 0)))::numeric / 100.0           as pc,
      ps.activity_name, ps.activity_type, ps.duration_days,
      ps.actual_finish, ps.bl_finish
    from project_schedule ps
    join mine on mine.project_id = ps.project_id and mine.wp_no = ps.work_package
    where ps.project_id = any(p_ids)
      and ps.start_date is not null
      and coalesce(ps.activity_type, '') !~* 'wbs|summary'
  ),
  bounds as (select min(s) as mn, max(e) as mx from leaves),
  months as (
    select (generate_series(date_trunc('month', mn), date_trunc('month', mx), interval '1 month'))::date as m
    from bounds where mn is not null
  ),
  agg as (
    select
      to_char(mo.m, 'YYYY-MM') as key,
      sum(l.w_dur  * greatest(0, least(1, (d.me - l.s + 1)::numeric / greatest(1, (l.e - l.s + 1))))) as pd,
      sum(l.w_cost * greatest(0, least(1, (d.me - l.s + 1)::numeric / greatest(1, (l.e - l.s + 1))))) as pc,
      sum(l.w_dur  * l.pc * greatest(0, least(1, (d.me - l.as_ + 1)::numeric / greatest(1, (l.ae_ - l.as_ + 1))))) as ad,
      sum(l.w_cost * l.pc * greatest(0, least(1, (d.me - l.as_ + 1)::numeric / greatest(1, (l.ae_ - l.as_ + 1))))) as ac
    from months mo
    cross join leaves l
    cross join lateral (select (mo.m + interval '1 month - 1 day')::date as me) d
    group by mo.m
  )
  select jsonb_build_object(
    'vendorId',   p_vendor_id,
    'months',     coalesce((select jsonb_agg(jsonb_build_object('key', key, 'pd', pd, 'pc', pc, 'ad', ad, 'ac', ac) order by key) from agg), '[]'::jsonb),
    'totDur',     coalesce((select sum(w_dur)  from leaves), 0),
    'totCost',    coalesce((select sum(w_cost) from leaves), 0),
    'doneDur',    coalesce((select sum(w_dur  * pc) from leaves), 0),
    'doneCost',   coalesce((select sum(w_cost * pc) from leaves), 0),
    'nAct',       (select count(*) from leaves),
    'nCost',      (select count(*) from leaves where w_cost > 0),
    'minDate',    (select mn from bounds),
    'maxDate',    (select mx from bounds),
    'nPackages',  (select count(*) from mine),
    -- ⚠️ Packages where this vendor is only a CO-awardee, excluded from the curve
    --    above. Reported so a short curve is explainable, never silently short.
    'coAwarded',  (select count(*) from wp
                    where vendor_id is distinct from p_vendor_id
                      and p_vendor_id = any(coalesce(awarded_vendor_ids, '{}'::uuid[]))),
    -- F4 inputs: slip on the vendor's own activities, derived here so the
    -- client never has to pull the leaves to compute it.
    'slipDays',   coalesce((select sum(l.actual_finish - l.bl_finish)
                            from leaves l where l.actual_finish is not null and l.bl_finish is not null), 0),
    'nSlipped',   (select count(*) from leaves l
                    where l.actual_finish is not null and l.bl_finish is not null and l.actual_finish > l.bl_finish),
    'nFinished',  (select count(*) from leaves l where l.actual_finish is not null)
  );
$$;

-- ---------------------------------------------------------------------------
-- F5) The portfolio roll-up — one row per vendor, across projects
-- ---------------------------------------------------------------------------
-- ⚠️ FOLLOWS THE PORTFOLIO RPC PATTERN (2026-07-11-portfolio-resource-rpc.sql),
--    NOT a browser loop. A cross-project vendor ranking read one project at a
--    time is N round-trips and, on this app's real data, tens of thousands of
--    rows in the browser to produce a dozen numbers.
create or replace function vendor_scorecard_multi(p_ids text[])
returns jsonb
language sql
stable
security invoker
as $$
  with wp as (
    select p.id as project_id, m.wp_no, m.vendor_id, m.contractor,
           m.awarded_vendor_ids, m.total_awarded, m.awarded_cost,
           m.target_installation, m.delivery_status
    from unnest(p_ids) as p(id)
    left join cash_flow_settings cs on cs.project_id = p.id
    join wpm_work_packages m
      on m.wpm_project_id = coalesce(cs.wpm_project_id, p.id)
    where m.vendor_id is not null
  ),
  acts as (
    select w.vendor_id, w.project_id, w.wp_no,
           ps.start_date, ps.end_date, ps.actual_finish, ps.bl_finish,
           greatest(0, least(100, coalesce(ps.percent_complete, 0)))::numeric / 100.0 as pc,
           coalesce(nullif(ps.duration_days, 0), (ps.end_date - ps.start_date) + 1, 1)::numeric as w_dur
    from wp w
    join project_schedule ps
      on ps.project_id = w.project_id and ps.work_package = w.wp_no
    where coalesce(ps.activity_type, '') !~* 'wbs|summary'
      and ps.start_date is not null
  ),
  -- Need-by adherence: the schedule's earliest start for the package against
  -- WPM's Target Installation — the same comparison E2 already surfaces.
  -- ⚠️ There is NO actual-delivery date anywhere in the mirror, so this measures
  --    PLANNED adherence, not delivered-on-time. Naming it otherwise would be a
  --    number nobody could defend.
  needby as (
    select w.vendor_id, w.project_id, w.wp_no,
           min(a.start_date) as need_by,
           w.target_installation,
           (w.target_installation - min(a.start_date)) as slack_days
    from wp w
    join acts a on a.project_id = w.project_id and a.wp_no = w.wp_no
    where w.target_installation is not null
    group by w.vendor_id, w.project_id, w.wp_no, w.target_installation
  )
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.vendor_name), '[]'::jsonb)
  from (
    select v.id                                    as vendor_id,
           coalesce(v.name, min(w.contractor))     as vendor_name,
           v.vendor_code, v.trade_categories, v.accreditation, v.status,
           count(distinct w.project_id)            as n_projects,
           count(distinct (w.project_id || '|' || w.wp_no)) as n_packages,
           sum(coalesce(w.total_awarded, w.awarded_cost, 0)) as awarded_value,
           (select count(*) from acts a where a.vendor_id = v.id)          as n_activities,
           (select coalesce(sum(a.w_dur * a.pc), 0) / nullif(sum(a.w_dur), 0)
              from acts a where a.vendor_id = v.id)                        as pct_complete,
           (select coalesce(sum(a.actual_finish - a.bl_finish), 0) from acts a
             where a.vendor_id = v.id and a.actual_finish is not null and a.bl_finish is not null) as slip_days,
           (select count(*) from acts a
             where a.vendor_id = v.id and a.actual_finish is not null
               and a.bl_finish is not null and a.actual_finish > a.bl_finish) as n_slipped,
           (select count(*) from needby n where n.vendor_id = v.id and n.slack_days < 0) as n_needby_late,
           (select count(*) from needby n where n.vendor_id = v.id)          as n_needby_checked
    from wp w
    join wpm_vendors v on v.id = w.vendor_id
    group by v.id, v.name, v.vendor_code, v.trade_categories, v.accreditation, v.status
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- F6) The rate library — vendor x trade x unit, from real months
-- ---------------------------------------------------------------------------
-- ⚠️ SAMPLE SIZE AND DATE RANGE TRAVEL WITH THE RATE, ALWAYS. A productivity
--    rate from two months of one crew is not the same claim as one from thirty,
--    and a duration offered without saying which it came from is how a schedule
--    acquires false confidence.
--
-- ⚠️ RATE IS RECOMPUTED FROM THE MONTHLY TOTALS, NOT AVERAGED FROM THE MONTHLY
--    RATES. Averaging per-month rates weights a 3-day month equally with a
--    26-day one; Σqty ÷ Σman-days is the honest figure.
create or replace view vendor_rate_library
  with (security_invoker = true) as
select pa.vendor_id,
       pa.category                                    as trade,
       pa.unit,
       pa.resource_type,
       count(*)                                       as n_months,
       count(distinct pa.project_id)                  as n_projects,
       sum(coalesce(pe.qty_actual, 0))                as qty_total,
       sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) as man_days_total,
       case when sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) > 0
            then sum(coalesce(pe.qty_actual, 0))
               / sum(coalesce(pe.mp_actual, 0) * coalesce(pe.work_days, 0)) end as rate_per_man_day,
       min(pe.period) as first_period,
       max(pe.period) as last_period
from productivity_activities pa
join productivity_entries pe on pe.activity_id = pa.id
-- ⚠️ Only months that actually recorded BOTH sides. A month with output but no
--    manpower (or vice versa) is an incomplete record, and including it drags the
--    rate toward a number no crew ever achieved.
where coalesce(pe.qty_actual, 0) > 0
  and coalesce(pe.mp_actual, 0) > 0
  and coalesce(pe.work_days, 0) > 0
group by pa.vendor_id, pa.category, pa.unit, pa.resource_type;

grant select on vendor_rate_library to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select * from vendor_qty_reconciliation limit 5;
--   select * from vendor_rate_library limit 5;
--   select schedule_scurve_agg_vendor(array['OPW101'], '<a wpm_vendors.id>');
--   select vendor_scorecard_multi(array['OPW101','AVR101']);
--
-- ⚠️ All of these read empty until `sync-wpm` has been redeployed and re-run —
--    `wpm_work_packages.vendor_id` is the join key and it is NULL until then.


-- ==========================================================================
-- [109/142] 2026-08-26-activity-cost-curve.sql
-- ==========================================================================
-- Cost Loading: the spread curve travels with the money.
--
-- Owner 2026-08-26: "there should be a step wherein the manner of distribution of an activity is
-- defined… if bell curve, front loaded, back loaded, linear distribution. This is in order to give a
-- more accurate projection. … And then after all that data, that should be reported in the s-curve."
--
-- ⚠️ WHY A COLUMN ON project_schedule AND NOT JUST schedule_cost_loading.config.
-- `schedule_cost_loading` holds the Cost Loading exercise's WORKING STATE, and the settled rule for
-- this module is that applying writes the RESULT onto the activity: `planned_cost` is the column
-- Cost/EVM, the Excel export and the S-Curve's cost basis already read. The curve is the other half
-- of that same fact — how the activity's money is spent over its dates — so it has to travel the same
-- way. The S-Curve module reads `project_schedule` and nothing else; making it reach into another
-- module's working-state table would be a second source of truth for the same number, which is
-- exactly what "no new home for the money" exists to prevent.
--
-- ⚠️ NO CHECK CONSTRAINT, deliberately. The vocabulary is the client-side `curveCdf` set
-- (linear / front / back / bell) and `curveCdf` already falls back to linear for anything it does not
-- recognise. A CHECK would make adding a fifth shape a migration, and would reject a P6/XER import
-- carrying its own spelling instead of quietly reading it as linear. Same call as `wbs_nodes.name`
-- and `project_schedule.activity_type`, which is also an open vocabulary.
--
-- ⚠️ NULL MEANS LINEAR, and nothing is back-filled. `curveCdf('linear')` is the identity, so every
-- activity in every existing project keeps spreading exactly as it does today until a planner
-- deliberately chooses a shape. Back-filling 'linear' would write ~40k rows to assert the default.
--
-- Idempotent; safe to re-run.

alter table public.project_schedule
  add column if not exists cost_curve text;

comment on column public.project_schedule.cost_curve is
  'How this activity''s planned_cost is spent across its own dates: linear (default/null), front, back, bell. Written by Cost Loading''s "Spread over time" step; read by the S-Curve''s cost basis and the Activity Usage curves. Open vocabulary - an unrecognised value reads as linear.';


-- ==========================================================================
-- [110/142] 2026-08-26-boq-claimed-vs-certified.sql
-- ==========================================================================
-- ============================================================================
-- Migration: CLAIMED vs CERTIFIED progress — making DISPUTE measurable.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-24-boq.sql.
--
-- WHY
--   Decision #7 landed on: reported (the programme) → certified (billed) → paid,
--   with the first gap reported as accrued revenue. The owner then named the
--   case that model could not express: "there will be incidents that actual work
--   of the contractor reported will be disputed by the client."
--
--   It could not be expressed because `boq_progress` stored ONE number per line
--   — `rel_pct` — and that number is the CERTIFIED one, the figure the client
--   approved and pays against. What the contractor SUBMITTED before the client
--   cut it was nowhere, so a dispute was invisible and the whole gap had to be
--   attributed to "not yet billed".
--
-- WHAT THIS ADDS
--   rel_pct_claimed — the cumulative relative % the contractor SUBMITTED for
--   this line in this billing period. `rel_pct` keeps its meaning untouched:
--   CERTIFIED. Dispute is then claimed − certified, per line, in money:
--       Σ boq_items.amount × (claimed − certified)
--
-- ⚠️ NULL MEANS "NOT SEPARATELY RECORDED", NEVER ZERO. Every existing row keeps
--    NULL, and the app reads effective-claimed as coalesce(rel_pct_claimed,
--    rel_pct). Defaulting to 0 would make every historical line read as a 100%
--    dispute the moment this ran — a project-wide fiction, instantly, in the
--    one report a commercial manager would take to a meeting. There is
--    deliberately NO default and NO back-fill.
--
-- ⚠️ NOT A SECOND POC. Nothing derives a project percentage from the claimed
--    column. POC and revenue stay on `rel_pct` (certified), because that is what
--    the client pays against; the claimed figure exists to size the gap, not to
--    bill from it. A "claimed POC" headline would be read as revenue within a
--    week of existing.
--
-- ⚠️ CLAIMED BELOW CERTIFIED IS NOT NETTED AWAY. The client certifying MORE than
--    was submitted is rare and usually a data-entry error, so the app reports it
--    separately as an anomaly instead of quietly cancelling it against genuine
--    disputes elsewhere. No CHECK constraint enforces claimed >= certified:
--    refusing the save would only push the wrong number somewhere unrecorded.
-- ============================================================================

alter table boq_progress add column if not exists rel_pct_claimed numeric;

comment on column boq_progress.rel_pct        is
  'CERTIFIED cumulative relative % (0..1) — what the client approved. POC and revenue derive from this one.';
comment on column boq_progress.rel_pct_claimed is
  'CLAIMED cumulative relative % (0..1) — what the contractor submitted. NULL = not separately recorded (read as equal to rel_pct). Never billed from.';

-- ---------------------------------------------------------------------------
-- Reading dispute per billing period
-- ---------------------------------------------------------------------------
-- ⚠️ security_invoker so the caller's RLS applies — without it this view would
--    report every project's commercial exposure to anyone who can select it.
-- ⚠️ The same money rule the BOQ tab uses: heading rows are subtotals of the
--    lines beneath them (double-count) and an excluded line's "amount" is a
--    sentence, not a number. Getting this wrong here would make the dispute
--    total disagree with the screen that produced it.
create or replace view boq_period_dispute
  with (security_invoker = true) as
select p.project_id,
       p.period_id,
       count(*) filter (where coalesce(p.rel_pct_claimed, p.rel_pct) > p.rel_pct)  as lines_disputed,
       count(*) filter (where coalesce(p.rel_pct_claimed, p.rel_pct) < p.rel_pct)  as lines_over_certified,
       sum(i.amount * (coalesce(p.rel_pct_claimed, p.rel_pct) - p.rel_pct))
         filter (where coalesce(p.rel_pct_claimed, p.rel_pct) > p.rel_pct)         as amount_disputed,
       sum(i.amount * (p.rel_pct - coalesce(p.rel_pct_claimed, p.rel_pct)))
         filter (where coalesce(p.rel_pct_claimed, p.rel_pct) < p.rel_pct)         as amount_over_certified,
       count(*) filter (where p.rel_pct_claimed is not null)                       as lines_with_claim
from boq_progress p
join boq_items i on i.id = p.boq_item_id
where i.line_kind <> 'heading'
  and i.exclusion_note is null
  and i.amount is not null
group by p.project_id, p.period_id;

grant select on boq_period_dispute to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'boq_progress' and column_name = 'rel_pct_claimed';
--        -- expect: YES / null default
--   select * from boq_period_dispute limit 5;
--        -- expect: empty amounts until a claimed figure is entered, never zeros


-- ==========================================================================
-- [111/142] 2026-08-26-lessons-learned.sql
-- ==========================================================================
-- ============================================================================
-- Migration: LESSONS LEARNED BECOMES ITS OWN RECORD.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY A TABLE AND NOT THREE MORE COLUMNS. A lesson used to live as
--    `lesson_learned` / `lesson_category` / `recommendation` ON the issue, which
--    forced three things that are all wrong:
--      1. ONE lesson per issue. A six-month dispute teaches more than one thing,
--         and the second one had nowhere to go.
--      2. NO lesson without an issue. Meetings produce lessons that were never
--         a problem anybody logged, and a lesson learned on another project has
--         no issue in THIS register at all.
--      3. The capture form was welded to the issue form — you could not write a
--         lesson without opening the issue that "owned" it.
--
--    A lesson is a knowledge artefact with its own life: it is captured once and
--    read on future projects long after the issue that produced it closed. It
--    LINKS to what produced it (an issue, a meeting, or an action item) and all
--    three links are OPTIONAL — an unlinked lesson is a legitimate record, not a
--    broken one.
--
-- ⚠️ THE OLD COLUMNS ARE KEPT AND ARE NOT DROPPED. They are backfilled into this
--    table below, and the app stops writing them. Dropping them would destroy the
--    only copy for anyone still running an older tab, and they cost nothing left
--    in place. Do not "tidy" them away without checking every deployed client.
-- ============================================================================

create table if not exists lessons_learned (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),

  -- ---- What produced this lesson. ALL THREE ARE OPTIONAL --------------------
  -- ⚠️ `on delete set null`, never cascade. A lesson outlives its source: that is
  -- the whole point of a lessons library. Deleting the issue must strip the link,
  -- not the knowledge.
  issue_id       uuid references issues_lessons(id) on delete set null,
  mom_id         uuid references meeting_minutes(id) on delete set null,
  mom_item_id    uuid references mom_items(id) on delete set null,

  department     text,
  category       text,                    -- Schedule | Cost | Quality | …
  lesson         text,                    -- what was learned
  recommendation text,                    -- what to do differently next time
  date_captured  date default current_date,

  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists lessons_learned_proj_idx
  on lessons_learned (project_id, date_captured desc);
-- The two lookups the module actually does: "what did this issue teach us" and
-- "what did this meeting teach us".
create index if not exists lessons_learned_issue_idx on lessons_learned (issue_id);
create index if not exists lessons_learned_mom_idx   on lessons_learned (mom_id);

-- ---- Write rules ----------------------------------------------------------
-- Mirrors issues_lessons (2026-08-19-department-issues.sql) with ONE deliberate
-- difference, at DELETE.
alter table lessons_learned enable row level security;

drop policy if exists lessons_learned_read on lessons_learned;
create policy lessons_learned_read on lessons_learned
  for select using (can_access_project(project_id));

-- The generic loop policy must go or Postgres ORs it back in.
drop policy if exists lessons_learned_write on lessons_learned;

drop policy if exists lessons_learned_ins on lessons_learned;
create policy lessons_learned_ins on lessons_learned
  for insert with check (
    is_writer()
    and can_access_project(project_id)
    and (created_by = auth.uid() or is_planner())
  );

drop policy if exists lessons_learned_upd on lessons_learned;
create policy lessons_learned_upd on lessons_learned
  for update using (
    can_access_project(project_id)
    and (is_planner() or created_by = auth.uid())
  );

-- ⚠️ DELETE IS WIDER HERE THAN ON THE REGISTER, ON PURPOSE. An issue may not be
-- deleted by the department that raised it: the record of a problem having
-- existed is the point of a register, and closing it is a status. A lesson is
-- not a record of a problem — it is something someone wrote down. A lesson typed
-- into the wrong project, or duplicated, is noise in a library everyone reads,
-- and its author is the right person to remove it.
drop policy if exists lessons_learned_del on lessons_learned;
create policy lessons_learned_del on lessons_learned
  for delete using (
    can_access_project(project_id)
    and (is_planner() or created_by = auth.uid())
  );

-- ---- Backfill --------------------------------------------------------------
-- Every lesson captured on an issue becomes a row here, linked back to it.
-- ⚠️ Guarded by `not exists`, so re-running this file does not duplicate a
-- lesson someone has since edited here.
insert into lessons_learned
  (project_id, issue_id, mom_id, department, category, lesson, recommendation,
   date_captured, created_by, created_at)
select
  i.project_id, i.id, i.mom_id, i.department, i.lesson_category,
  i.lesson_learned, i.recommendation,
  coalesce(i.date_resolved, i.date_presented, i.created_at::date),
  i.created_by, coalesce(i.updated_at, i.created_at, now())
from issues_lessons i
where i.lesson_learned is not null
  and btrim(i.lesson_learned) <> ''
  and not exists (
    select 1 from lessons_learned l where l.issue_id = i.id
  );

-- ⚠️ NOT DONE, DELIBERATELY: clearing issues_lessons.lesson_learned after the
-- copy. If this file is ever re-run against a database where someone deleted a
-- backfilled lesson on purpose, a cleared source column means the `not exists`
-- guard silently resurrects nothing — but a cleared column ALSO means an older
-- deployed tab reading the issue shows a lesson that has vanished. Leaving the
-- source intact keeps both readings truthful; the app is what decides which one
-- is authoritative, and it reads this table.


-- ==========================================================================
-- [112/142] 2026-08-26-package-scoped-schedule.sql
-- ==========================================================================
-- ============================================================================
-- Migration: PACKAGE-SCOPED SCHEDULING — named Builder setups per package,
--            a push history, and package roots in the WBS.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-07-23-schedule-builder.sql, 2026-08-19-packages.sql and
--    2026-08-19-schedule-package.sql.
--
-- WHY
--   Owner, 2026-08-26: "For cases with projects that have multiple packages
--   let's modify the project schedule module to show this multiple packaged
--   project but tracked and monitored separately as a package. Each package will
--   have its own WBS and own activities depending on the scope of that package.
--   The schedule builder now will consider which package should it push and the
--   schedule builder should have an option to save schedules and go back to that
--   saved schedule."
--
--   A project like Avesta Residences is ONE project bought as Package 1 (Tower 1
--   and General Requirements) and Package 2 (Towers 2-7). Each is administered,
--   progressed, billed and disputed on its own, so each needs its own WBS branch,
--   its own builder setup, and its own push / import / clear.
--
-- ⚠️ THE PACKAGE AXIS AND THE CHANGE-ORDER AXIS STAY ORTHOGONAL. Owner's call,
--    same day: a change order BELONGS TO a package. package_id says which
--    contract lot; scope_type says main-contract vs change-order. A variation
--    raised against Package 2 is both, and the grid's Blended / Main / Change
--    orders control keeps working INSIDE whichever package is shown. Neither
--    column is ever derived from the other — see 2026-08-19-schedule-package.sql,
--    which exists to say exactly this.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) schedule_builder: one row per project → many named setups per package
-- ---------------------------------------------------------------------------
-- The old table was keyed by project_id alone, so a project could hold exactly
-- one builder state. That is the thing being fixed, so the primary key has to
-- move — carefully, because a live project already has a setup in it.
--
-- ⚠️ THE EXISTING ROW IS PRESERVED AND BECOMES A NAMED SETUP, never dropped.
--    A planner's builder state is hours of work; losing it to a migration would
--    be the most expensive possible way to add a feature.
-- ⚠️ NO package_id IS GUESSED for it. The existing setup predates packages, so
--    it lands with package_id NULL — "not yet assigned to a package", which is
--    honest and visible, rather than silently filed under whichever package
--    happens to sort first.
do $$
begin
  -- Fresh installs: nothing to migrate, the table below is created outright.
  if to_regclass('public.schedule_builder') is null then
    return;
  end if;
  -- Already migrated (id column present) → nothing to do.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'schedule_builder'
                and column_name = 'id') then
    return;
  end if;
  alter table schedule_builder drop constraint if exists schedule_builder_pkey;
  alter table schedule_builder add column id uuid not null default gen_random_uuid();
  alter table schedule_builder add primary key (id);
  alter table schedule_builder add column package_id uuid;
  alter table schedule_builder add column name text;
  alter table schedule_builder add column created_at timestamptz default now();
  alter table schedule_builder add column created_by uuid;
  -- The pre-existing setup keeps its config and gains a name that says what it is.
  update schedule_builder set name = 'Original setup' where name is null;
end $$;

create table if not exists schedule_builder (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  -- ⚠️ on delete set null, never cascade: retiring a package must not delete the
  --    setups that built its schedule. They become unassigned and visibly so.
  package_id  uuid references packages(id) on delete set null,
  name        text,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz default now(),
  created_by  uuid,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

-- The FK is added separately so BOTH paths above (migrated table, fresh table)
-- end up constrained the same way.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedule_builder_package_fk') then
    alter table schedule_builder add constraint schedule_builder_package_fk
      foreign key (package_id) references packages(id) on delete set null;
  end if;
end $$;

create index if not exists schedule_builder_project_idx on schedule_builder (project_id, package_id);
-- ⚠️ coalesce, because NULLs are DISTINCT in a unique index: without it a project
--    could hold five unassigned setups all called "Draft" and the picker would
--    show five identical rows.
create unique index if not exists schedule_builder_name_idx
  on schedule_builder (project_id, coalesce(package_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(coalesce(name, '')));

-- ---------------------------------------------------------------------------
-- 2) schedule_builder_pushes — what was pushed, from which setup, when
-- ---------------------------------------------------------------------------
-- "Go back to that saved schedule in case of any error" needs more than the
-- current config: it needs the config AS IT WAS at the moment of a push, because
-- the setup keeps being edited afterwards.
--
-- ⚠️ THE SNAPSHOT IS A FULL COPY OF config, not a reference to the setup row.
--    A pointer would follow later edits and quietly stop describing the schedule
--    it produced — which is exactly the failure this table exists to prevent.
-- ⚠️ setup_id is on delete SET NULL: deleting a setup must not erase the record
--    that a push happened. The snapshot stands on its own.
create table if not exists schedule_builder_pushes (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  setup_id    uuid references schedule_builder(id) on delete set null,
  package_id  uuid references packages(id) on delete set null,
  setup_name  text,
  config      jsonb not null,
  n_activities int,
  wbs_root_id uuid,
  note        text,
  pushed_at   timestamptz default now(),
  pushed_by   uuid
);
create index if not exists schedule_builder_pushes_project_idx
  on schedule_builder_pushes (project_id, pushed_at desc);

-- ---------------------------------------------------------------------------
-- 3) Access — unchanged shape, re-applied so both tables match the convention
-- ---------------------------------------------------------------------------
alter table schedule_builder        enable row level security;
alter table schedule_builder_pushes enable row level security;
grant select, insert, update, delete on schedule_builder        to authenticated;
grant select, insert, update, delete on schedule_builder_pushes to authenticated;

drop policy if exists schedule_builder_read  on schedule_builder;
drop policy if exists schedule_builder_write on schedule_builder;
create policy schedule_builder_read on schedule_builder
  for select using ( can_access_project(project_id) );
create policy schedule_builder_write on schedule_builder
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );

drop policy if exists schedule_builder_pushes_read  on schedule_builder_pushes;
drop policy if exists schedule_builder_pushes_write on schedule_builder_pushes;
create policy schedule_builder_pushes_read on schedule_builder_pushes
  for select using ( can_access_project(project_id) );
create policy schedule_builder_pushes_write on schedule_builder_pushes
  for all using ( is_writer() and can_access_project(project_id) )
          with check ( is_writer() and can_access_project(project_id) );

-- ---------------------------------------------------------------------------
-- 4) Package roots in the WBS
-- ---------------------------------------------------------------------------
-- The grid shows each package as a top-level row with its own WBS beneath, so a
-- package needs a real root node — not a filter. `wbs_nodes.package_id` already
-- exists (2026-08-19-schedule-package.sql) and the app creates the root on push;
-- this flag marks it as THE root for that package so a second push adopts it
-- instead of creating a sibling beside it.
--
-- ⚠️ A FLAG, NOT A NAME MATCH. Matching on the node's name would break the first
--    time someone renames "PKG-2 — Towers 2-7" to "Towers 2 to 7", and the next
--    push would silently build a second root holding half the schedule.
alter table wbs_nodes add column if not exists is_package_root boolean not null default false;

-- ⚠️ One root per package, enforced. Two roots is the failure mode that makes a
--    package total half-right, which is worse than an error at insert time.
create unique index if not exists wbs_nodes_package_root_idx
  on wbs_nodes (project_id, package_id) where is_package_root;

-- ---------------------------------------------------------------------------
-- 5) Verify
-- ---------------------------------------------------------------------------
--   select id, project_id, package_id, name from schedule_builder;
--        -- expect: every pre-existing row still here, named 'Original setup'
--   select column_name from information_schema.columns
--    where table_name = 'wbs_nodes' and column_name = 'is_package_root';   -- expect 1
--   select count(*) from schedule_builder_pushes;                          -- expect 0
--
-- No back-fill of package_id anywhere: an existing setup, activity or WBS node
-- belongs to no package until a planner says which, and guessing would file real
-- work under a contract lot nobody put it in.


-- ==========================================================================
-- [113/142] 2026-08-26-people-and-assignment.sql
-- ==========================================================================
-- ============================================================================
-- Migration: CHAMPIONS AND RESPONSIBLES BECOME PEOPLE, NOT TYPED TEXT.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Two things, and the second one is the reason for the first:
--   1. A roster an ordinary user may read, so Champion / Responsible can be a
--      dropdown instead of free text.
--   2. Assignment stored as user ids, so "show me what I own" is answerable.
--      A typed name cannot be resolved to an account, so a personal view built
--      on `champion` text would be a string match — and this register already
--      contains "Ronquillo, Jules Norman; Agcaoili, Heherson", which no
--      equality test will ever match against a login.
-- ============================================================================

-- ---- 1) The roster ---------------------------------------------------------
-- ⚠️ THIS IS A DELIBERATE, NARROW WIDENING OF WHO CAN SEE WHOM, and it needs to
-- be understood before it is extended. `users_self_read` is
-- `auth.uid() = id or is_admin()`, so until now a planner could not see that
-- anybody else existed. That is the correct default for a table holding email,
-- role, status and each person's project assignments.
--
-- ⚠️ SO THE POLICY IS NOT TOUCHED. Widening `users_self_read` would expose
-- email, role, `projects[]` and last_login to every approved user — far more
-- than a picker needs, and impossible to walk back once code depends on it.
-- Instead this function returns THREE columns and nothing else.
--
-- ⚠️ SECURITY DEFINER with a pinned search_path, like every other helper here
-- (an RLS-filtered sub-select inside a policy is how this schema acquired a
-- stack-depth recursion bug once — see 2026-06-18-fix-rls-recursion.sql).
--
-- ⚠️ DROP FIRST. This was originally a safe bare `create or replace` (this file
-- was the only definition of app_people() in existence), but
-- 2026-08-28-people-directory.sql later WIDENS this same function's return
-- type to 5 columns. On any database where that later migration has already
-- applied, running this file again — e.g. a full from-scratch rebuild that
-- doesn't know what has already run — hits Postgres's "cannot change return
-- type of existing function" (42P13), because CREATE OR REPLACE cannot narrow
-- a function's OUT columns back down. Dropping first makes this file safe
-- regardless of which order its sibling has or hasn't already run in.
drop function if exists app_people();

create or replace function app_people()
returns table (id uuid, name text, department text)
language sql
security definer
set search_path = public
stable
as $$
  -- ⚠️ Callers who are not themselves approved get an EMPTY set, not an error.
  -- A pending or rejected account must not be able to enumerate the staff list,
  -- and a picker that renders empty is a better failure than one that throws.
  select u.id, u.name, u.department
  from users u
  where is_approved()
    and u.status = 'approved'
    -- ⚠️ A viewer is excluded: they cannot write anything, so making them a
    -- champion would assign work to someone the database will not let act on it.
    and u.role <> 'viewer'
  order by u.name;
$$;

revoke all on function app_people() from public;
grant execute on function app_people() to authenticated;

-- ---- 2) Assignment by id ---------------------------------------------------
-- ⚠️ ARRAYS, not a single uuid. The register's real data carries several
-- champions on one issue ("A; B"), and the Power Apps screen this reproduces
-- allowed it. A single-id column would silently drop the second name on the
-- first save, which is data loss disguised as a schema decision.
alter table issues_lessons add column if not exists champion_ids uuid[] default '{}';
alter table mom_items     add column if not exists owner_ids     uuid[] default '{}';

-- ⚠️ THE FREE-TEXT COLUMNS ARE KEPT AND ARE STILL WRITTEN. Three reasons, and
-- none of them is nostalgia:
--   * Not every champion has an account. A subcontractor's engineer is named on
--     an issue and will never log in; forcing ids would make them unnameable.
--   * Every existing row's champion is text, and exports/reports read it.
--   * The ids are the machine-readable half; the text is what a printed sheet
--     shows. The app writes BOTH on save so they cannot disagree.
--
-- ⚠️ AND THERE IS DELIBERATELY NO BACKFILL. Mapping "Ronquillo, Jules Norman"
-- to an account is a guess, and a wrong guess assigns one person's work to
-- another — the same reasoning that stopped `productivity_activities.
-- subcontractor` being auto-matched to a vendor. Ids fill in as rows are next
-- saved, and until then the text is still displayed. A row with no ids simply
-- does not appear in anyone's personal view, which is honest: nobody has said
-- whose it is in a way the database can act on.

-- GIN, because every personal-view query is a containment test
-- (`champion_ids @> array[auth.uid()]`) and a btree cannot serve that.
create index if not exists issues_lessons_champion_ids_idx
  on issues_lessons using gin (champion_ids);
create index if not exists mom_items_owner_ids_idx
  on mom_items using gin (owner_ids);

-- The personal view also asks "what did I raise", across every project.
create index if not exists issues_lessons_created_by_idx on issues_lessons (created_by);
create index if not exists lessons_learned_created_by_idx on lessons_learned (created_by);

-- ---- 3) Notes on what is NOT changed --------------------------------------
-- ⚠️ No RLS change on issues_lessons / mom_items / lessons_learned. Being a
-- champion does NOT grant edit rights: the rules stay
-- 2026-08-19-department-issues.sql (your own rows, or a planner) and
-- 2026-08-20-department-minutes.sql. Assignment says who OWES the work, not who
-- may rewrite the record — conflating the two would let anyone grant themselves
-- edit rights by putting their own name in the Champion box.
--
-- ⚠️ The personal view therefore needs NO new read policy either: it queries the
-- same tables under the same project-scoped rules, so it can only ever show a
-- user work on projects they can already access.


-- ==========================================================================
-- [114/142] 2026-08-27-manpower-loading.sql
-- ==========================================================================
-- ============================================================================
-- Manpower Loading (per project) — 2026-08-27
--
-- The HRD "Manpower Report" sheet, as tables. Four objects, and the split is
-- the design:
--
--   manpower_positions  one row per POSITION LINE on the project (the requirement)
--   manpower_loading    one row per (position, month) carrying FOUR headcount series
--   manpower_roster     one row per PERSON — the employee masterlist behind the numbers
--   manpower_months     one row per (project, month): the project phase + the four COSTS
--
-- ⚠️ FOUR quantity columns on one row, not four rows with a `series` column.
-- The sheet's own bands are Planned / Revised / Proposed / Actual for the SAME
-- (position, month), every reader wants all four together, and the unique index
-- that stops two browsers double-inserting a month has to be on (position,
-- month) — with a series column that index no longer prevents the thing it
-- exists to prevent, it just moves the duplicate one column over.
--
-- ⚠️ Monthly quantities are their own table, not a jsonb blob on the position —
-- the same call equipment_loading and productivity_entries made. A blob cannot
-- be summed per month by the database, filtered, or edited by two people
-- without one clobbering the other's month.
--
-- ⚠️ COSTS ARE PROJECT-MONTH, NOT PER POSITION. The reference sheet types them
-- that way because they come off payroll, which is issued for the project as a
-- whole and never equals rate × headcount (it carries overtime, allowances,
-- separation pay). Storing a per-position cost would force the module to invent
-- a split nobody has. The module still DERIVES rate × headcount when a month
-- has no typed cost, and says on screen which of the two it is showing.
--
-- ⚠️ `manpower_months` carries a surrogate `id` even though (project_id, period)
-- is the natural key: PDb.selectAll paginates by `id`, so a table without one
-- silently reads at most 1000 rows and reports the rest as absent.
--
-- ⚠️ Columns are `position_title` and `job_rank`, not `position` and `rank`.
-- Both bare names are Postgres keywords (POSITION is a col_name_keyword, rank()
-- a window function); they are legal as column names today and are exactly the
-- kind of thing that starts needing quotes inside a view or a function later.
--
-- RLS is project-scoped from the start (the 2026-07-21 pattern). Writes are
-- is_writer() rather than created_by-or-admin: a manpower report is maintained
-- by the project team and HRD together, and "only whoever typed it may fix it"
-- is how a register goes stale.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists manpower_positions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  code text,                              -- unique per project, case-insensitively
  workforce text not null default 'Staff',-- Staff | Skilled
  department text not null default 'OFFICE',
  position_title text not null,
  job_rank text,                          -- Managerial | Supervisory | Rank & File | Skilled | Helper
  monthly_rate numeric,                   -- cost per head per month, for the derived cost curve
  remarks text,
  sort_order int default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manpower_loading (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  position_id uuid not null references manpower_positions(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_qty numeric,                    -- B0, the original plan
  approved_qty numeric,                   -- B1, the latest APPROVED revision
  forecast_qty numeric,                   -- proposed / for approval
  actual_qty numeric,                     -- what was actually deployed
  remarks text,
  source text,                            -- 'hand' | 'schedule' — who wrote the month
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manpower_roster (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  position_id uuid references manpower_positions(id) on delete set null,
  employee_name text not null,            -- 'TBH' is a real, meaningful value: an unfilled slot
  employee_status text,                   -- Full-time | Part-time | Project-based
  job_rank text,
  allocation text,                        -- FULL-TIME | SHARED
  date_hired date,
  contract_start date,
  contract_end date,                      -- drives the demobilisation summary
  remarks text,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manpower_months (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  period date not null,
  phase text,                             -- Earthworks | Structural | Architectural | MEPF | …
  planned_cost numeric,
  approved_cost numeric,
  forecast_cost numeric,
  actual_cost numeric,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One row per position per month. Without this two browsers can each insert the
-- same month and every total silently double-counts it.
create unique index if not exists manpower_loading_uni
  on manpower_loading(position_id, period);
create unique index if not exists manpower_months_uni
  on manpower_months(project_id, period);
create index if not exists manpower_loading_project_idx
  on manpower_loading(project_id, period);
create index if not exists manpower_positions_project_idx
  on manpower_positions(project_id, sort_order);
create index if not exists manpower_roster_project_idx
  on manpower_roster(project_id, position_id);

-- ⚠️ Unique per PROJECT, not globally, and case-insensitively. Two projects
-- legitimately both number their first field engineer FE-01, and a global
-- constraint would refuse the second with an error nobody could act on.
create unique index if not exists manpower_positions_code_uni
  on manpower_positions(project_id, lower(code)) where code is not null and code <> '';

grant select, insert, update, delete
  on manpower_positions, manpower_loading, manpower_roster, manpower_months
  to authenticated;

alter table manpower_positions enable row level security;
alter table manpower_loading   enable row level security;
alter table manpower_roster    enable row level security;
alter table manpower_months    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['manpower_positions','manpower_loading','manpower_roster','manpower_months'] loop
    execute format('drop policy if exists %I on %I', t||'_read', t);
    execute format('create policy %I on %I for select using (can_access_project(project_id))', t||'_read', t);
    execute format('drop policy if exists %I on %I', t||'_write', t);
    execute format('create policy %I on %I for all using (is_writer() and can_access_project(project_id)) with check (is_writer() and can_access_project(project_id))', t||'_write', t);
  end loop;
end $$;

-- Keep updated_at honest: the register reports "last updated" per position, and
-- an updated_at that only records the INSERT reports a row edited this morning
-- as untouched.
create or replace function public.manpower_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['manpower_positions','manpower_loading','manpower_roster','manpower_months'] loop
    execute format('drop trigger if exists %I on %I', t||'_touch', t);
    execute format('create trigger %I before update on %I for each row execute function public.manpower_touch()', t||'_touch', t);
  end loop;
end $$;


-- ==========================================================================
-- [115/142] 2026-08-27-package-external-codes.sql
-- ==========================================================================
-- ============================================================================
-- Migration: a contract package carries the CODES IT BUYS UNDER
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-19-packages.sql.
--
-- WHY — the gap this closes, stated plainly
--   Owner, 2026-08-27: "How should we resolve this especially in connecting the
--   procurement from AVR102? Currently AVR101's schedule covers all 7 towers and
--   general requirements."
--
--   Two axes that do not line up:
--     · THE WORK is one construction sequence — shared tower cranes, shared
--       general requirements, predecessors running between towers. One schedule.
--     · THE MONEY is two contracts — AVR101 and AVR102 — each with its own
--       procurement scope, its own billing and its own claims, and each existing
--       as its own project in the Procurement (WPM) and Engineering apps.
--
--   Everything in this app is scoped by `projects.id`, so it forced those two to
--   be the same thing. The result: AVR101's schedule holds AVR102's work, while
--   AVR102's work packages sit in a WPM project nothing in that schedule maps to.
--
--   The join that was missing is HERE, on the package. A package already says
--   *what work*; these columns say *which contract buys it*.
--
-- THE MODEL THIS SETTLES (see planning-app/CLAUDE.md for the full write-up)
--   1. A Planners project = a contract code. AVR101 and AVR102 both stay — WPM
--      and Engineering key on the code, and merging them breaks the 1:1 that
--      every cross-app push relies on.
--   2. A schedule belongs to a DEVELOPMENT, not to a code. One project hosts it.
--   3. Each contract lot inside that schedule is a `package` on the host, named
--      for its SCOPE ("Towers 2-7"), never for a project code.
--   4. The package carries the codes it maps to. That is this migration.
--
-- ⚠️ WHY NOT NAME THE PACKAGE AFTER THE CODE. Because that is the exact shape
--    refused on 2026-08-27 — a package called AVR102 inside project AVR101 makes
--    one contract lot exist twice inside one app, and every per-package total
--    then double-counts or splits depending on which identity a report read. The
--    scope description and the contract code are DIFFERENT FACTS and get
--    different fields. That is what makes the guard and this column consistent
--    rather than in tension.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) The three mappings
-- ---------------------------------------------------------------------------
-- ⚠️ ALL NULLABLE, NOTHING BACK-FILLED, and that is the safety property that
--    makes this deployable on every project at once: a package with no mapping
--    behaves exactly as it does today (the schedule falls back to the
--    project-level `cash_flow_settings.wpm_project_id`). Only a package someone
--    deliberately maps changes anything.

-- The Procurement (WPM) project whose work packages fund this lot.
-- ⚠️ Free text, no FK — WPM is a SEPARATE Supabase project (cayjeqeleenizbdzrums)
--    and Postgres cannot reference across databases. Same call as
--    cash_flow_settings.wpm_project_id, which this deliberately mirrors rather
--    than re-inventing: two columns meaning "which WPM project" that could
--    disagree is worse than one that is sometimes blank.
alter table packages add column if not exists wpm_project_id text;

-- The Engineering app's project id for this lot.
-- ⚠️ Engineering currently reuses the Planners project id verbatim (see
--    supabase/functions/push-packages), so this is blank on every existing
--    package and the push keeps its present behaviour until one is set.
alter table packages add column if not exists eng_project_id text;

-- The SIBLING PLANNERS PROJECT that holds this lot's own commercial record.
-- AVR102's contract, claims, billing and cash flow live on the AVR102 project;
-- its WORK lives in AVR101's schedule. This is the link between the two.
-- ⚠️ A real FK, unlike the two above, because both rows live in THIS database —
--    and `on delete set null`, never cascade: deleting a project must not delete
--    the package that describes a scope division of somebody else's schedule.
-- ⚠️ It is NOT a parent/child link and must not be read as one. It says "this
--    lot's paperwork is filed over there", not "this project belongs to that
--    one" — a hierarchy is what produced the nesting this whole model removes.
alter table packages add column if not exists planners_project_id text
  references projects(id) on delete set null;

comment on column packages.wpm_project_id is
  'Procurement (WPM) project id this lot buys under. Blank = fall back to the '
  'host project mapping in cash_flow_settings.wpm_project_id. Set it when one '
  'schedule spans several contract codes (AVR101 hosting AVR102 work).';
comment on column packages.eng_project_id is
  'Engineering app project id for this lot. Blank = the Planners project id, '
  'which is what push-packages already uses.';
comment on column packages.planners_project_id is
  'The sibling Planners project holding this lot''s own contracts, claims and '
  'billing. NOT a parent/child link — the projects stay peers.';

-- ---------------------------------------------------------------------------
-- 2) Indexes
-- ---------------------------------------------------------------------------
-- The schedule asks "which WPM projects does this project's packages map to?"
-- once per load, and the cross-app pushes ask it per package.
create index if not exists packages_wpm_project_idx on packages (wpm_project_id)
  where wpm_project_id is not null;
create index if not exists packages_planners_project_idx on packages (planners_project_id)
  where planners_project_id is not null;

-- ---------------------------------------------------------------------------
-- 3) A guard rail, as a REPORT rather than a constraint
-- ---------------------------------------------------------------------------
-- ⚠️ NOT a CHECK constraint, deliberately. Two packages of one project pointing
--    at the same WPM project is a mistake almost every time — but it is legal
--    while someone is halfway through re-mapping a development, and a constraint
--    would refuse the save and lose their work rather than telling them. The
--    same reasoning as boq_progress's claimed-vs-certified: report the anomaly,
--    never block the write.
create or replace view package_mapping_conflicts as
  select p.project_id,
         p.wpm_project_id,
         count(*)                      as packages_sharing_it,
         string_agg(p.code, ', ' order by p.code) as codes
    from packages p
   where p.wpm_project_id is not null
     and p.status <> 'archived'
   group by p.project_id, p.wpm_project_id
  having count(*) > 1;

-- security_invoker so the caller's RLS on `packages` applies — a view is
-- otherwise evaluated as its owner and would leak other projects' packages.
alter view package_mapping_conflicts set (security_invoker = true);
grant select on package_mapping_conflicts to authenticated;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- No policy change. `packages` already carries read = can_access_project and
-- write = is_planner() and can_access_project (2026-08-19-packages.sql); new
-- columns inherit them.


-- ==========================================================================
-- [116/142] 2026-08-27-project-program.sql
-- ==========================================================================
-- ============================================================================
-- Migration: projects.program — an explicit PARENT PROJECT override
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY
--   Owner, 2026-08-27: "AVR101 and AVR101 are treated separately. LCR352 and
--   LCR102 are treated the same way. Let's do a global approach for this in the
--   planning-app first."
--
--   Megawide buys one development as several PROJECTS, each with its own code
--   (AVR101 + AVR102 = Avesta Residences). Procurement and Engineering hold them
--   the same way, so the codes are the shared key across all three apps. The app
--   groups them by the leading letters of the project id, which every code in
--   this portfolio already follows — so the rollup works with NO data entry.
--
--   This column exists only for the cases the convention cannot express:
--     · two unrelated developments that happen to share a prefix;
--     · one development split across prefixes after a rebrand or a re-coding.
--
-- ⚠️ NULL IS THE NORMAL STATE AND NOTHING IS BACK-FILLED. A blank `program`
--    means "use the code prefix", which is the right answer for almost every
--    project. Back-filling it with the prefix would turn a convention that
--    self-corrects when a project is re-coded into ~20 stored strings that go
--    stale silently — and would make a genuine override indistinguishable from
--    a value the migration wrote.
--
-- ⚠️ IT IS A ROLLUP, NOT A HIERARCHY. There is deliberately NO parent_id and no
--    `programs` table. A project is never a child row of another project: the
--    apps map one Planners project to one downstream project each, and a real
--    parent-child link would invite the AVR101 › {AVR101, AVR102} nesting this
--    whole change exists to remove. Grouping happens at read time.
--
-- ⚠️ NO FOREIGN KEY AND NO LOOKUP TABLE, deliberately unlike `group_heads`.
--    A group head is an assignment that drives access and reporting, so a typo
--    there fragments something load-bearing. A parent project is a display
--    grouping over ids that already agree; a lookup table would be a second
--    place to maintain the same fact, and the prefix would still be the real key.
-- ============================================================================

alter table projects add column if not exists program text;

comment on column projects.program is
  'Optional parent-project override. Blank (the normal case) means the app '
  'groups this project by the leading letters of its id (AVR101 -> AVR). Set it '
  'only when the code prefix is wrong: two developments sharing a prefix, or one '
  'development split across prefixes. Grouping is a reporting rollup only — the '
  'projects stay separate rows, which is what keeps the 1:1 mapping to the '
  'Procurement and Engineering apps intact.';

-- Case-insensitive, so 'AVR' and 'avr' group together rather than forming two
-- parents that look identical on screen.
create index if not exists projects_program_idx on projects (upper(program));

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- No policy change. `projects` already carries per-command policies
-- (projects_read / _ins / _upd / _del, see 2026-07-16-consolidated.sql) and a
-- new column inherits them. ⚠️ Do NOT add a policy here: the 2026-07-16 fix
-- exists because a `for all` policy on this table silently granted every planner
-- read access to every project, and re-introducing one would reopen that.


-- ==========================================================================
-- [117/142] 2026-08-28-people-directory.sql
-- ==========================================================================
-- ============================================================================
-- Migration: A CHAMPION WHO HAS NO ACCOUNT IS STILL A PERSON.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- Requires 2026-08-26-people-and-assignment.sql to have been run first.
--
-- THE PROBLEM THIS SOLVES. The people picker offers the roster (`app_people()`,
-- accounts only) plus a free-text line for everyone else. Free text works for
-- printing a sheet and nothing else:
--   * "Engr. Cruz" typed on one issue and "R. Cruz" on the next are two strings
--     nobody can group, filter or count — the exact fragmentation the group_heads
--     lookup table exists to prevent, and the reason the migration before this one
--     refused to guess a name -> account mapping.
--   * A second planner cannot REFERENCE that person. They retype the name, spell
--     it differently, and the register quietly holds three people who are one.
--
-- So: a directory of people who do not have (or do not yet have) a login, created
-- from the picker itself, stored ONCE, and offered to everyone from then on.
-- ============================================================================

-- ---- 1) The directory -------------------------------------------------------
-- ⚠️ ORG-WIDE, NOT PROJECT-SCOPED, and that is deliberate. A subcontractor's
-- engineer or a client's rep appears on several jobs; scoping the row to one
-- project would force the same person to be created again on each of them, which
-- is the fragmentation this table exists to end. `company` is what distinguishes
-- two people who share a surname, so it is the first thing the picker shows.
create table if not exists people_directory (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,                 -- subcontractor / consultant / client
  department  text,                 -- the discipline, when it is one of ours
  email       text,                 -- optional, for the day they get an account
  notes       text,
  -- ⚠️ Soft retirement, never a delete path in the app. A directory person is
  -- referenced by `champion_ids` / `owner_ids`, which carry NO foreign key
  -- (deliberately — see below), so deleting the row would leave every issue they
  -- own resolving to nothing. `active = false` drops them from the picker while
  -- every historical row still resolves to their name.
  active      boolean not null default true,
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ⚠️ Case-insensitive uniqueness on (name, company), so the second planner to
-- reach for "Engr. Cruz" gets the EXISTING row rather than a second one. Nulls
-- are distinct in Postgres, so coalesce the company or two rows with no company
-- would both be allowed through.
create unique index if not exists people_directory_ident_idx
  on people_directory (lower(trim(name)), lower(coalesce(trim(company), '')));

create index if not exists people_directory_active_idx on people_directory (active, name);

alter table people_directory enable row level security;

-- Read: any approved user. The picker is useless if you cannot see the roster,
-- and this table deliberately holds no more than a name, a company and a
-- department — the same three-column shape `app_people()` settled on.
drop policy if exists people_directory_read on people_directory;
create policy people_directory_read on people_directory
  for select using (is_approved());

-- ⚠️ Insert: any approved NON-VIEWER, stamped as themselves. Anyone who can raise
-- an issue must be able to name whoever owns it, or the picker sends them back to
-- free text and the fragmentation returns. A viewer writes nothing anywhere.
drop policy if exists people_directory_ins on people_directory;
create policy people_directory_ins on people_directory
  for insert with check (is_writer() and (created_by = auth.uid() or is_planner()));

-- ⚠️ Update: the person who created the entry, or a planner. A typo in a name
-- everyone now references has to be fixable by someone; letting ANY writer rename
-- a shared directory entry would let one project's correction rewrite another's.
-- `with check` as well as `using`, or a row can be updated out of your own
-- ownership, leaving you neither the right to fix it nor the record of writing it.
drop policy if exists people_directory_upd on people_directory;
create policy people_directory_upd on people_directory
  for update
  using (is_planner() or (is_writer() and created_by = auth.uid()))
  with check (is_planner() or (is_writer() and created_by = auth.uid()));

-- ⚠️ NO DELETE POLICY AT ALL, which means nobody can delete — including planners.
-- That is the point: `champion_ids` has no FK, so a delete cannot cascade or be
-- refused, it just silently turns every issue that person owns into an unresolvable
-- id. Retire with `active = false` instead. Add a delete policy only alongside a
-- migration that first re-points every array referencing the row.

-- ---- 2) One roster, two kinds of person -------------------------------------
-- ⚠️ `app_people()` GAINS A COLUMN, so it must be DROPPED first — Postgres cannot
-- change a function's return type with CREATE OR REPLACE, and the error it raises
-- is easy to mistake for a syntax problem.
drop function if exists app_people();

create or replace function app_people()
returns table (id uuid, name text, department text, company text, kind text)
language sql
security definer
set search_path = public
stable
as $$
  -- ⚠️ Callers who are not themselves approved get an EMPTY set, not an error.
  -- A pending or rejected account must not enumerate the staff list, and a picker
  -- that renders empty is a better failure than one that throws.
  select u.id, u.name, u.department, null::text as company, 'account'::text as kind
  from users u
  where is_approved() and u.status = 'approved' and u.role <> 'viewer'

  union all

  -- ⚠️ The directory is returned by the SAME function, so a caller cannot read one
  -- list and forget the other — which is precisely how a picker ends up offering
  -- accounts only and sending everyone back to free text. `kind` is what lets the
  -- UI say which people can actually be signed in as, without splitting the list.
  select d.id, d.name, d.department, d.company, 'contact'::text as kind
  from people_directory d
  where is_approved() and d.active

  order by 2;
$$;

revoke all on function app_people() from public;
grant execute on function app_people() to authenticated;

-- ---- 3) Notes on what is NOT changed ---------------------------------------
-- ⚠️ `issues_lessons.champion_ids` / `mom_items.owner_ids` are UNCHANGED and still
-- carry no foreign key. A directory id and an account id are both uuids and live
-- in the same array, because "who owns this" is one question with one answer list.
-- Adding an FK now would have to point at one table or the other and could not
-- express both.
--
-- ⚠️ THE CONSEQUENCE, STATED PLAINLY: a directory person can be a champion, but
-- they have no login, so the work assigned to them appears on NOBODY's My Work
-- page. That is honest rather than a gap — there is no account to show it to. The
-- register is where their items are chased, and the picker marks them so the
-- planner assigning the work knows which of the two they picked.
--
-- ⚠️ No back-fill of existing free text into the directory. Splitting
-- "Ronquillo, Jules Norman; Agcaoili, Heherson" into rows and guessing which
-- existing person each half is would assign one person's work to another — the
-- same reasoning that stopped the champion text being auto-matched to an account.
-- The free-text columns are still written and still displayed; entries appear in
-- the directory as planners create them.


-- ==========================================================================
-- [118/142] 2026-08-28-photo-keyplan-and-ppr-meeting.sql
-- ==========================================================================
-- ============================================================================
-- Migration: 2026-08-28 — Progress Photos / PPR feedback round
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================

-- Key Plan moves from the SLIDE to the PHOTO (owner feedback: "Key plan should
-- be per photo, not per slide" — each before/after photo now carries its own
-- key plan, so a slide's two panes can show different key plans instead of one
-- overlay shared across both).
alter table progress_photos add column if not exists key_plan_url text;

-- ppr_slides.key_plan_url is now DEPRECATED (kept, not dropped, so existing
-- rows/back-references don't break) — new code reads/writes the key plan on
-- progress_photos instead. Safe to drop in a later cleanup migration once
-- confirmed nothing still reads it.
comment on column ppr_slides.key_plan_url is
  'Deprecated 2026-08-28 — key plan is now per-photo (progress_photos.key_plan_url). Left in place for old rows; no longer written by new code.';

-- ppr_slides.trade / works / location are also DEPRECATED for the same reason
-- (owner feedback: before/after can be different locations, so a single
-- slide-level location no longer makes sense) — the slide now shows each
-- photo's own trade/works/location. Columns kept for backward compatibility.
comment on column ppr_slides.trade is
  'Deprecated 2026-08-28 — trade is now read from each slide''s before/after photo.';
comment on column ppr_slides.works is
  'Deprecated 2026-08-28 — works is now read from each slide''s before/after photo.';
comment on column ppr_slides.location is
  'Deprecated 2026-08-28 — location is now read from each slide''s before/after photo.';


-- ==========================================================================
-- [119/142] 2026-08-29-archive-flag.sql
-- ==========================================================================
-- Progress Photos — soft-archive flag (2026-08-29 follow-up feedback)
-- ------------------------------------------------------------------------------
-- Owner: Presentations-list rows become Download / Preview / Archive, and the
-- Gallery gains a batch "Archive" action. Both need a non-destructive way to
-- retire a record without deleting it — a real delete would destroy a
-- meeting's history / a photo that a past presentation still cites (FKs are
-- `on delete set null`, so a hard delete already silently orphans slides that
-- reference it; archiving is the alternative that keeps the record intact).
--
-- Deliberately the SAME column name/shape on all four tables (`archived
-- boolean default false`) so the Gallery's unified merge (module.js's
-- mediaStripItems / the batch-action bar) can treat photos, panoramas and
-- reconstructions identically, and so a presentation list-row hides on the
-- same rule. Default false + no back-fill, so every existing row is
-- unaffected until someone explicitly archives it.
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos          add column if not exists archived boolean default false;
alter table ppr_presentations        add column if not exists archived boolean default false;
alter table panoramas                add column if not exists archived boolean default false;
alter table reconstruction_requests  add column if not exists archived boolean default false;

create index if not exists progress_photos_archived_idx         on progress_photos (project_id, archived);
create index if not exists ppr_presentations_archived_idx       on ppr_presentations (project_id, archived);


-- ==========================================================================
-- [120/142] 2026-08-29-floor-plan-registration.sql
-- ==========================================================================
-- Top-view photo -> floor plan registration (18-item list, Batch H, item 17)
-- ------------------------------------------------------------------------------
-- Real point-based image registration: the planner clicks 3-4 matching points
-- on the DRAWING and on an uploaded TOP-VIEW PHOTO; cv.findHomography (OpenCV.js,
-- already loaded for panorama stitching) computes the 3x3 perspective transform
-- that warps the photo into the drawing's own coordinate frame. This is what
-- lets pins/clusters drawn in the drawing's normalized 0..1 space land in the
-- correct place on the "actual" (photo) view too.
--
-- One registration per (floor_plan, photo) pair — a plan can have at most one
-- active registration per photo, since two different point-pair sets for the
-- same photo would produce two disagreeing warps of the same image.
--
-- `homography` is STORED, not recomputed on every view: findHomography is a
-- few dozen milliseconds of OpenCV.js work per registration, and re-running it
-- on every render of the Plans screen for no reason is wasted GPU-adjacent
-- work in the browser. It's invalidated (this migration doesn't automate that
-- — the app recomputes and re-saves it) only when point_pairs changes.
--
-- Idempotent; folded into supabase-schema.sql.

create table if not exists floor_plan_registrations (
  id             uuid primary key default gen_random_uuid(),
  floor_plan_id  uuid references floor_plans(id) on delete cascade,
  photo_id       uuid references progress_photos(id) on delete cascade,
  project_id     text references projects(id),
  point_pairs    jsonb not null default '[]'::jsonb,  -- [{planX,planY,photoX,photoY}, ...] normalized 0..1
  homography     jsonb,                                -- the computed 3x3 matrix, [9 numbers], row-major
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (floor_plan_id, photo_id)
);
create index if not exists floor_plan_registrations_plan_idx on floor_plan_registrations (floor_plan_id);

alter table floor_plan_registrations enable row level security;
drop policy if exists floor_plan_registrations_read on floor_plan_registrations;
create policy floor_plan_registrations_read on floor_plan_registrations for select using (can_access_project(project_id));
drop policy if exists floor_plan_registrations_ins on floor_plan_registrations;
create policy floor_plan_registrations_ins on floor_plan_registrations for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists floor_plan_registrations_upd on floor_plan_registrations;
create policy floor_plan_registrations_upd on floor_plan_registrations for update
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
  with check (is_writer() and can_access_project(project_id));
drop policy if exists floor_plan_registrations_del on floor_plan_registrations;
create policy floor_plan_registrations_del on floor_plan_registrations for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


-- ==========================================================================
-- [121/142] 2026-08-29-floor-plans.sql
-- ==========================================================================
-- Progress Photos — Floor Plan overlay (brief Section 6B / Phase 5)
-- ------------------------------------------------------------------
-- "BIM Model Overlay" here means what the brief's own examples describe:
-- placing a captured panorama / 3D reconstruction / photo as a PIN on a 2D
-- floor plan image, so a reviewer can click around a floor plan the way
-- Matterport's dollhouse/floor-plan view works. It deliberately does NOT mean
-- importing or registering against a real BIM/IFC model — that is a much
-- larger, separate undertaking (true 3D<->3D registration against an
-- authored BIM model) and was not attempted; noted plainly in
-- modules/progress-photos/CLAUDE.md rather than silently scoped down.
--
-- Idempotent; folded into supabase-schema.sql's per-module RLS loop.

create table if not exists floor_plans (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id),
  name text not null,
  level_order integer default 0,
  image_url text,          -- storage object path in the progress-photos bucket, signed on demand
  width_px integer,
  height_px integer,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_floor_plans_project on floor_plans(project_id);

-- One row per pin. item_type + item_id is a soft polymorphic reference
-- (panoramas / reconstruction_requests / progress_photos), not three
-- separate FK columns — a pin's target kind never changes after it's placed,
-- so this avoids three nullable FK columns where only one is ever non-null.
-- No hard FK to any of the three target tables: a pin surviving its target's
-- deletion (rendered as a broken/removable pin, never silently vanishing) is
-- safer than a cross-table trigger the module would have to maintain by hand.
create table if not exists floor_plan_pins (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid references floor_plans(id) on delete cascade,
  project_id text references projects(id),
  item_type text not null check (item_type in ('panorama', 'reconstruction', 'photo')),
  item_id uuid not null,
  x_norm double precision not null check (x_norm >= 0 and x_norm <= 1),
  y_norm double precision not null check (y_norm >= 0 and y_norm <= 1),
  label text,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

create index if not exists idx_floor_plan_pins_plan on floor_plan_pins(floor_plan_id);
create index if not exists idx_floor_plan_pins_project on floor_plan_pins(project_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'floor_plans' and policyname = 'floor_plans_rw') then
    execute 'alter table floor_plans enable row level security';
    execute 'create policy floor_plans_rw on floor_plans for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plans_read on floor_plans for select
      using (can_access_project(project_id))';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_plan_pins' and policyname = 'floor_plan_pins_rw') then
    execute 'alter table floor_plan_pins enable row level security';
    execute 'create policy floor_plan_pins_rw on floor_plan_pins for all
      using (is_writer() and can_access_project(project_id))
      with check (is_writer() and can_access_project(project_id))';
    execute 'create policy floor_plan_pins_read on floor_plan_pins for select
      using (can_access_project(project_id))';
  end if;
end $$;


-- ==========================================================================
-- [122/142] 2026-08-29-markup.sql
-- ==========================================================================
-- Photo/slide markup & annotation (18-item list, Batch F, items 13/14)
-- ------------------------------------------------------------------------------
-- Two SEPARATE stores, because a presentation slide's markup is explicitly
-- "native only to the presentation, not inherited by the photo" (the owner's
-- own wording):
--   1. progress_photos.markup  — the PHOTO's own permanent markup, follows the
--      photo everywhere it's used (Gallery lightbox, every slide that cites it).
--   2. ppr_slide_markups       — a PRESENTATION-ONLY overlay, keyed by
--      (ppr_slide_id, pane). Editing it never touches the photo's own markup,
--      and deleting the photo/slide takes its markup with it (cascade) rather
--      than leaving an orphaned annotation layer nobody can reach.
--
-- Format: a JSON ARRAY of vector drawing objects — {type, points/position,
-- color, strokeWidth, rotation, text, icon, ...} depending on `type`
-- ('pen'|'rect'|'circle'|'arrow'|'text'|'icon') — VECTOR, not a second
-- rasterized image, so it stays small, can be toggled on/off losslessly, and
-- re-renders correctly at any zoom level.
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists markup jsonb default '[]'::jsonb;
comment on column progress_photos.markup is 'Vector annotation layer: [{type,points|position,color,strokeWidth,rotation,text,icon}]. Hidden on Gallery tiles; shown only when a photo is opened.';

create table if not exists ppr_slide_markups (
  id            uuid primary key default gen_random_uuid(),
  ppr_slide_id  uuid references ppr_slides(id) on delete cascade,
  project_id    text references projects(id),
  pane          text not null check (pane in ('before', 'after')),
  markup        jsonb default '[]'::jsonb,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (ppr_slide_id, pane)
);
create index if not exists ppr_slide_markups_slide_idx on ppr_slide_markups (ppr_slide_id);

-- Same read-all-approved / write-own-or-admin shape as every other module
-- table (see supabase-schema.sql's generic RLS loop) — restated standalone
-- here so this migration is a complete, runnable unit on its own.
alter table ppr_slide_markups enable row level security;
drop policy if exists ppr_slide_markups_read on ppr_slide_markups;
create policy ppr_slide_markups_read on ppr_slide_markups for select using (can_access_project(project_id));
drop policy if exists ppr_slide_markups_ins on ppr_slide_markups;
create policy ppr_slide_markups_ins on ppr_slide_markups for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
drop policy if exists ppr_slide_markups_upd on ppr_slide_markups;
create policy ppr_slide_markups_upd on ppr_slide_markups for update
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
  with check (is_writer() and can_access_project(project_id));
drop policy if exists ppr_slide_markups_del on ppr_slide_markups;
create policy ppr_slide_markups_del on ppr_slide_markups for delete
  using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


-- ==========================================================================
-- [123/142] 2026-08-29-panoramas.sql
-- ==========================================================================
-- ============================================================================
-- Migration: 2026-08-29 — Panoramic Capture (brief Section 6 / Phase 3)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================

-- One row per stitched panorama. Location tagging mirrors progress_photos
-- exactly (location_values jsonb keyed by location_level id + a display-cache
-- `location` text) so the SAME location picker / Rounds-style combo logic
-- already built for photos works unmodified for panoramas.
create table if not exists panoramas (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  location_values jsonb default '{}'::jsonb,
  location        text,
  activity_id     text,             -- snapshot of the "current activity" at capture
  activity_name   text,             -- time, same convention as progress_photos (not a live join)
  pano_url        text,             -- Storage path (progress-photos bucket, <project>/panoramas/)
  frame_count     integer,          -- how many source frames were stitched
  -- 'ok' | 'poor' — set by the CLIENT'S stitch-quality heuristic (match count
  -- / warp coverage), never silently upgraded. A 'poor' panorama is still
  -- saved (better than losing the walkthrough entirely) but flagged for
  -- re-capture rather than presented as a finished result. See brief 6.2:
  -- "Flag sessions with poor stitching quality... rather than silently
  -- publishing a bad panorama."
  stitch_quality  text default 'ok',
  taken_at        date,
  -- 'ground' | 'drone' (brief 6C / Phase 6) — mirrors
  -- reconstruction_requests.video_source. A panorama's stitching pipeline is
  -- identical either way; this is purely a provenance tag shown as a badge,
  -- same convention as the 3D request list's Drone badge.
  source          text default 'ground',
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists panoramas_proj_idx on panoramas (project_id, taken_at desc);

-- Idempotent add for a project where this migration already ran before the
-- `source` column existed (this migration is being edited in place while
-- still un-run everywhere — but add-if-missing costs nothing and protects
-- against exactly that race).
alter table panoramas add column if not exists source text default 'ground';

-- RLS: folded into supabase-schema.sql's generic module-table loop (same
-- read/write shape as progress_photos — no special approval gate here, unlike
-- 2026-08-29's reconstruction_requests). If running standalone before that
-- fold lands:
--   alter table panoramas enable row level security;
--   create policy panoramas_read on panoramas for select using (can_access_project(project_id));
--   create policy panoramas_ins on panoramas for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
--   create policy panoramas_upd on panoramas for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin())) with check (is_writer() and can_access_project(project_id));
--   create policy panoramas_del on panoramas for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


-- ==========================================================================
-- [124/142] 2026-08-29-photo-media-type.sql
-- ==========================================================================
-- Progress Photos — Video as a first-class media type (18-item list item 4)
-- ------------------------------------------------------------------------------
-- "Gallery accepts Photos, Videos, and 360/3D captures" — a video is a plain,
-- unprocessed upload (no relation to Gaussian Splatting/RunPod, which stays on
-- hold). It reuses EVERY existing progress_photos column (trade/works/location/
-- key plan/pins all apply the same way to a video clip as a photo); the only
-- new thing is WHICH element renders it.
--
-- Default 'photo' so every existing row is unaffected. No CHECK constraint —
-- the Gallery only ever writes 'photo'/'video' itself, and a CHECK would need
-- its own migration to loosen if a third kind is ever added; the enum lives in
-- the app (module.js), matching this repo's own convention elsewhere (e.g.
-- ppr_presentations.meeting_type has none either, for the same reason).
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists media_type text default 'photo';

comment on column progress_photos.media_type is '''photo'' | ''video'' — how the Gallery renders photo_url (<img> vs <video>). Never any relation to 360°/3D/Gaussian Splatting.';


-- ==========================================================================
-- [125/142] 2026-08-29-photo-trades-works-multi.sql
-- ==========================================================================
-- Progress Photos — Trade/Works become multi-select (2026-08-29 feedback item 2)
-- ------------------------------------------------------------------------------
-- "Trades can also be multiple" — a photo can now carry several trades and
-- several works values at once. The existing singular `trade`/`works` text
-- columns are kept, deprecated: they hold the FIRST-selected value as a
-- display-cache fallback for any older code path that still reads them (the
-- same "kept in step, never re-derived from the array" convention already
-- used elsewhere in this module for `location` / `ppr_slides`' legacy
-- trade/works/location / `wbs_node_id`).
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists trades text[] default '{}'::text[];
alter table progress_photos add column if not exists works_multi text[] default '{}'::text[];

comment on column progress_photos.trade is 'Deprecated: first-selected value only. See trades (text[]).';
comment on column progress_photos.works is 'Deprecated: first-selected value only. See works_multi (text[]).';


-- ==========================================================================
-- [126/142] 2026-08-29-pin-direction.sql
-- ==========================================================================
-- Floor Plan pins — direction/POV capture (18-item list, Batch E)
-- ------------------------------------------------------------------------------
-- A pin marks WHERE a photo/panorama/3D-scan was taken; direction_deg records
-- which way the camera was FACING, so the Floor Plan view can draw a cone
-- showing field of view, not just a dot.
--
-- Nullable, no default: a pin with no recorded direction is a perfectly valid
-- pin (older pins, or one placed without dragging out a direction) — it just
-- has no cone drawn. Degrees, 0-360, matching standard screen/compass
-- convention (0 = up/north on the plan image, clockwise) — the SAME
-- convention `atan2` on screen-space vectors naturally produces once negated
-- for screen Y being flipped, so the app's direction math and this column
-- agree without a stored offset.
--
-- Idempotent; folded into supabase-schema.sql.

alter table floor_plan_pins add column if not exists direction_deg double precision;

comment on column floor_plan_pins.direction_deg is 'Camera facing direction in degrees, 0-360 clockwise from up on the plan image. NULL = no direction recorded (valid).';


-- ==========================================================================
-- [127/142] 2026-08-29-ppr-report-templates.sql
-- ==========================================================================
-- ============================================================================
-- Migration: 2026-08-29 — PPR Report Templates (brief Section 5, Phase 2)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================

-- A Report Template is a SAVED DEFINITION of a recurring report ("Weekly Client
-- Update — Tower B"): which locations to include, in what order, and how the
-- before/after comparison is chosen. Running it ("Generate") produces an
-- ordinary Meeting (ppr_presentations + ppr_slides) with slides auto-populated
-- from the CURRENT photo library — the template itself is never rendered
-- directly and holds no photos of its own.
--
-- `locations` is a JSONB array, not a join table — same call as
-- equipment_site_plan.plan (2026-08-24): it is read and written as ONE ordered
-- list in a single builder screen, never queried location-by-location, so a
-- relational table would only add round-trips for no query benefit. Shape:
--   [{ key, label, values, baseline_photo_id }]
-- - `key`   — the location's combo key (see progress-photos module.js
--             locCombos(): location_values levels joined with U+241F), OR any
--             string if a location was added by hand. Only used to detect
--             "this location is already in the template" in the builder UI.
-- - `label` — the display breadcrumb ("Tower A › 5th Floor › Zone 2"), so a
--             regenerated report and the template editor can show something
--             human-readable even if the underlying location_levels are later
--             renamed or removed.
-- - `values` — the location_values map (level_id -> value string) used to
--             resolve photos at generate time via superset match, the exact
--             mechanism resolveActivity()/lastCaptureAt() already use.
-- - `baseline_photo_id` — only meaningful when comparison_rule = 'baseline';
--             a SOFT reference (no FK — it's inside jsonb), resolved against
--             progress_photos at generate time and reported, not assumed, if
--             the photo no longer exists (deleted since the template was set up).
create table if not exists ppr_report_templates (
  id              uuid primary key default gen_random_uuid(),
  project_id      text references projects(id),
  name            text not null,
  -- Free text, no CHECK: same call as meeting_minutes.meeting_type
  -- (2026-08-20) — "client"/"internal" are the brief's two examples, not an
  -- exhaustive vocabulary a planner should be blocked from extending.
  meeting_type    text default 'client',
  -- 'previous' = latest photo vs the one before it at that location, always
  -- live; 'baseline' = latest vs a photo pinned once per location (see
  -- locations[].baseline_photo_id above). Template-level, per the brief's
  -- own phrasing ("the comparison window... this week vs last week, or this
  -- week vs baseline") — one rule for the whole report, not per-location.
  comparison_rule text default 'previous',
  locations       jsonb default '[]'::jsonb,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists ppr_report_templates_proj_idx
  on ppr_report_templates (project_id, name);

-- RLS: folded into the generic module-table loop in supabase-schema.sql
-- (read = can_access_project, write = is_writer() + own-row-or-admin). If
-- running this file standalone before that fold lands, apply the same shape
-- by hand:
--   alter table ppr_report_templates enable row level security;
--   create policy ppr_report_templates_read on ppr_report_templates
--     for select using (can_access_project(project_id));
--   create policy ppr_report_templates_ins on ppr_report_templates
--     for insert with check (is_writer() and created_by = auth.uid() and can_access_project(project_id));
--   create policy ppr_report_templates_upd on ppr_report_templates
--     for update using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()))
--     with check (is_writer() and can_access_project(project_id));
--   create policy ppr_report_templates_del on ppr_report_templates
--     for delete using (is_writer() and can_access_project(project_id) and (created_by = auth.uid() or is_admin()));


-- ==========================================================================
-- [128/142] 2026-08-29-reconstruction-requests.sql
-- ==========================================================================
-- ============================================================================
-- Migration: 2026-08-29 — 3D Reconstruction Requests (brief 6A / Phase 4)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================
--
-- A 3D reconstruction (video -> COLMAP -> OpenSplat, run on a rented GPU) is a
-- REAL PER-JOB COST, unlike every other write in this app. The owner's explicit
-- requirement: a request must be approved by an admin BEFORE it is sent to
-- the paid processing service — this is not a UI nicety, it is enforced here
-- at the RLS level, because a UI-only gate is one unauthenticated API call
-- away from being bypassed by anyone who can read this table's schema.
--
-- ⚠️ This table is DELIBERATELY NOT folded into the generic module-table RLS
-- loop (supabase-schema.sql's `foreach t in array [...]` block). That loop's
-- shape is "insert = own row, update = own row or admin" — applied here, a
-- REQUESTER could update their own row's `status` to 'approved' and defeat
-- the entire gate. This table gets its own, narrower policies instead.

create table if not exists reconstruction_requests (
  id                    uuid primary key default gen_random_uuid(),
  project_id            text references projects(id),
  location_values       jsonb default '{}'::jsonb,
  location              text,
  activity_id           text,
  activity_name         text,
  video_url             text,                 -- Storage path of the uploaded walkthrough video
  -- 'ground' (phone, Phase 4) | 'drone' (Phase 6) — same pipeline either way,
  -- per the brief's explicit "drone footage feeds the same underlying
  -- pipeline... rather than introducing a separate parallel system."
  video_source          text default 'ground',
  requested_note        text,                 -- optional context from the requester
  -- 'pending_approval' -> 'approved' | 'rejected' ; 'approved' -> 'queued' ->
  -- 'processing' -> 'done' | 'failed'. Every transition past 'pending_approval'
  -- either comes from an admin action (approve/reject) or from the trusted
  -- server-side webhook (queued/processing/done/failed) — never from the
  -- requester directly. See the RLS policies below.
  status                text default 'pending_approval',
  requested_by          uuid references users(id),
  approved_by           uuid references users(id),
  approved_at           timestamptz,
  rejected_reason       text,
  runpod_job_id         text,
  -- A per-request random token, generated at submit time and echoed back on
  -- the RunPod webhook call — the only thing standing between "a webhook
  -- claiming to be RunPod" and "the real one". Not a full HMAC signature
  -- scheme (RunPod's own webhook signing was not verified against here, since
  -- doing so needs a live RunPod account this environment doesn't have) but a
  -- real, non-guessable secret is far better than an open callback endpoint.
  webhook_token         text,
  result_pointcloud_url text,   -- COLMAP's scaled sparse/dense point cloud (.ply) — for measurement
  result_splat_url      text,   -- the trained Gaussian Splat (.ply) — for the navigable viewer
  result_stats          jsonb,  -- frame_count, colmap/opensplat timings, point count, etc.
  error_message         text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists reconstruction_requests_proj_idx
  on reconstruction_requests (project_id, created_at desc);
create index if not exists reconstruction_requests_status_idx
  on reconstruction_requests (project_id, status);

alter table reconstruction_requests enable row level security;

-- READ: same transparency rule as every other register in this app — anyone
-- who can see the project can see its requests (so a requester can track
-- their own, and other planners can see what's already been asked for before
-- asking again). Visibility is not the gate; who can APPROVE is.
drop policy if exists reconstruction_requests_read on reconstruction_requests;
create policy reconstruction_requests_read on reconstruction_requests
  for select using (can_access_project(project_id));

-- INSERT: any approved non-viewer may REQUEST — but only as themselves, and
-- only ever starting at 'pending_approval'. The WITH CHECK on status is what
-- stops a crafted insert from creating a pre-approved row.
drop policy if exists reconstruction_requests_ins on reconstruction_requests;
create policy reconstruction_requests_ins on reconstruction_requests
  for insert with check (
    is_writer() and requested_by = auth.uid() and can_access_project(project_id)
    and status = 'pending_approval'
  );

-- UPDATE: admin-only, full stop. This is the actual gate — approving,
-- rejecting, and every status transition after that (queued/processing/
-- done/failed, written by the webhook using the service role, which bypasses
-- RLS entirely) all require this row, not a client-side check.
drop policy if exists reconstruction_requests_upd on reconstruction_requests;
create policy reconstruction_requests_upd on reconstruction_requests
  for update using (is_admin() and can_access_project(project_id))
  with check (is_admin() and can_access_project(project_id));

-- DELETE: admin any time, OR the original requester retracting their OWN
-- request while it is STILL pending — never once it has been approved (by
-- then a job may already be queued/running/billed, and retracting a row out
-- from under a job that references it would orphan the RunPod job).
drop policy if exists reconstruction_requests_del on reconstruction_requests;
create policy reconstruction_requests_del on reconstruction_requests
  for delete using (
    (is_admin() and can_access_project(project_id))
    or (requested_by = auth.uid() and status = 'pending_approval')
  );


-- ==========================================================================
-- [129/142] 2026-08-30-photos-round2.sql
-- ==========================================================================
-- Progress Photos — 2026-08-30 feedback round, schema additions
-- ------------------------------------------------------------------------------
-- Idempotent (add column if not exists throughout); folds into supabase-schema.sql.
-- Every reader in the app is TOLERANT of these not existing yet (see module.js's
-- tolerantWrite / bim.js's savePinForItem / openPlanForm) — running this migration
-- late costs nothing already saved, it just starts storing the fields it enables.

-- Item 7: a required, free-text "view name" for the specific photo/view, kept
-- separate from `description` (which is optional and often blank) and from the
-- schedule-derived `location` (which names WHERE, not WHAT this particular shot
-- shows — e.g. "Facing east stairwell").
alter table progress_photos add column if not exists view_name text;
comment on column progress_photos.view_name is 'Required, free-text name for what this specific photo/view shows (2026-08-30 item 7). Distinct from description (optional) and location (schedule-derived, WHERE not WHAT).';

-- Item 28: the field-of-view cone is now two independently-draggable edge
-- points (normalized 0..1 of the plan image, same convention as x_norm/y_norm),
-- rather than a single angle+spread — "drag the end points... to adjust angle
-- AND range" needs two points, each with its own bearing and its own reach.
-- `direction_deg` (existing column) keeps being written as the bisector bearing
-- between the two edges, purely so renderers that only ever read that one
-- column (the Plans-page pin marker, the Gallery's key-plan preview popup)
-- keep drawing a sensible cone without being rewritten to understand edges.
-- `direction_na`: an EXPLICIT "this does not apply" mark for a top-view/aerial
-- photo, distinct from "nobody has set a direction yet" (NULL) — double-
-- clicking the cone in the Add/Edit Photo form sets this rather than merely
-- deleting the cone, so the distinction between "unknown" and "not applicable"
-- survives.
alter table floor_plan_pins add column if not exists edge1_x double precision;
alter table floor_plan_pins add column if not exists edge1_y double precision;
alter table floor_plan_pins add column if not exists edge2_x double precision;
alter table floor_plan_pins add column if not exists edge2_y double precision;
alter table floor_plan_pins add column if not exists direction_na boolean not null default false;
comment on column floor_plan_pins.edge1_x is 'Normalized x (0..1) of the field-of-view cone''s first edge endpoint, relative to the plan image. NULL = no cone drawn.';
comment on column floor_plan_pins.edge2_x is 'Normalized x (0..1) of the field-of-view cone''s second edge endpoint.';
comment on column floor_plan_pins.direction_na is 'Explicitly marked "does not apply" (e.g. a top-view/aerial photo with no facing direction) — distinct from direction_deg simply being unset.';

-- Item 12: a floor plan can now be tied to ONE node of the project's schedule
-- Location Breakdown (the same "pick any single node, any depth" model item 7
-- uses for photos), so uploading a plan asks for the location instead of a
-- typed name/level-order. Same jsonb shape as progress_photos.location_values
-- for consistency — a plan usually carries exactly one key, but the shape
-- allows more if a project ever needs it.
alter table floor_plans add column if not exists location_values jsonb not null default '{}'::jsonb;
comment on column floor_plans.location_values is 'The one schedule Location Breakdown node this floor plan corresponds to (2026-08-30 item 12). Empty object = not tied to a location (legacy plans, or a project with no Location Breakdown at all).';


-- ==========================================================================
-- [130/142] 2026-08-30-photos-round3.sql
-- ==========================================================================
-- Progress Photos — fourth feedback round, schema additions
-- ------------------------------------------------------------------------------
-- Idempotent (add column if not exists throughout); folds into supabase-schema.sql.
-- Every reader/writer in the app is TOLERANT of these not existing yet (see
-- module.js's tolerantWrite / thumbUrlOf) — running this migration late costs
-- nothing already saved, it just starts storing/serving the field it enables.

-- Item 1: a REAL, separately-uploaded, downscaled preview file, produced
-- client-side at upload time (module.js's uploadThumbnailFor/
-- makeThumbnailBlob) and stored as its own Storage object alongside the
-- original -- NOT a request-time transform of the original. The prior
-- attempt at this (Supabase Storage's image-transform add-on) silently
-- degrades to full-resolution the moment that add-on isn't enabled on the
-- project's plan, which reads to a planner as "still slow" with no visible
-- cause; storing a genuinely smaller file removes that dependency entirely.
-- NULL for every row captured before this column existed (or before this
-- migration ran) -- thumbUrlOf() falls back to the transform request, then
-- to the full-resolution original, exactly as it already did.
alter table progress_photos add column if not exists thumb_url text;
comment on column progress_photos.thumb_url is 'Storage path of a client-generated downscaled JPEG preview (2026-08-30 item 1, fourth round), signed on demand like photo_url. NULL = no thumbnail yet (pre-migration capture, or generation failed) -- List/Gallery/Stack views then fall back to the Storage image-transform request, then to the full-resolution original.';

-- Item 5: non-destructive exposure/brightness/contrast/sharpness, applied at
-- RENDER time (CSS filter for the first three, a canvas convolution for
-- sharpness in the lightbox/editor only) -- the original file is never
-- touched or re-uploaded. Empty object (or column absent) = every value at
-- its default (0, unchanged); module.js's adjustmentsOf() fills in the
-- {exposure,brightness,contrast,sharpness} shape either way, so no reader
-- has to special-case a missing key.
alter table progress_photos add column if not exists adjustments jsonb default '{}'::jsonb;
comment on column progress_photos.adjustments is 'Non-destructive {exposure,brightness,contrast,sharpness} (each -100..100, 0=unchanged), 2026-08-30 item 5. Applied at render time only -- photo_url/thumb_url are never modified, so resetting to 0 always recovers exactly what the camera captured.';


-- ==========================================================================
-- [131/142] 2026-08-31-issues-workflow-history.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Issues & Concerns status workflow (Update / Put On Hold / Close)
-- plus a per-issue audit history.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY TWO NEW TEXT COLUMNS INSTEAD OF REUSING `corrective_action`.
--    The owner's workflow replaces the free-standing status dropdown with three
--    buttons — Update Issue / Put On Hold / Close Issue — and each of the latter
--    two now REQUIRES its own narrative: a reason for the hold, and a closure
--    report (plus a lessons-learned entry, captured separately in
--    `lessons_learned`). Overloading `corrective_action` for all three would
--    make an On-Hold issue's "planned actions" text silently mean "why we
--    paused" instead, and a Closed issue's mean "how we closed it" — three
--    different questions sharing one column is exactly how a report ends up
--    quoting the wrong thing. `corrective_action` keeps meaning what it always
--    has (actions taken/planned while the issue is OPEN); `hold_reason` and
--    `closure_report` are shown INSTEAD of it once the issue leaves Open.
--
-- ⚠️ WHY A HISTORY TABLE AND NOT A jsonb ARRAY COLUMN ON THE ISSUE.
--    An array column embedded on the row it audits can be edited by anyone who
--    can edit the row — the audit and the thing it audits would share one
--    write permission. A separate, insert-only table with its own RLS (no
--    update/delete policy at all) is the only shape where "the previous issue
--    details are logged" can't itself be edited or deleted by whoever is
--    editing the issue.
-- ============================================================================

alter table issues_lessons add column if not exists hold_reason    text;
alter table issues_lessons add column if not exists closure_report text;

create table if not exists issues_lessons_history (
  id                    uuid primary key default gen_random_uuid(),
  issue_id              uuid not null references issues_lessons(id) on delete cascade,
  -- Denormalized project_id: RLS on this table reads it directly rather than
  -- joining back to issues_lessons on every read, and it survives even if the
  -- parent issue is one day allowed to move projects (it currently cannot).
  project_id            text references projects(id),
  -- 'create' | 'update' | 'hold' | 'close'. Free text, not an enum: this is an
  -- audit label read by the app, never a value anything else joins against.
  action                text not null,
  -- The hold reason / closure report AT THE TIME of this change, if the action
  -- carried one. Kept alongside the snapshot so the history reads as a story
  -- ("put on hold: waiting on client survey") without decoding jsonb.
  note                  text,
  -- The FULL issue row as it stood BEFORE this change was applied — "the
  -- previous issue details", verbatim, so any field's prior value can be
  -- recovered even if this specific history entry's `note` does not mention it.
  snapshot              jsonb,
  changed_by            uuid references users(id),
  -- ⚠️ Denormalized at write time from the actor's OWN profile, not resolved
  -- later by joining `users` — a department user has no business being
  -- granted a read of `users` just so a history entry can say who touched it,
  -- and department (not a name) is this app's established privacy floor for
  -- "whose was this" (see raisedByLabel() in the Issues module).
  changed_by_department text,
  changed_at            timestamptz not null default now()
);

create index if not exists issues_lessons_history_issue_idx
  on issues_lessons_history (issue_id, changed_at desc);

alter table issues_lessons_history enable row level security;

drop policy if exists issues_lessons_history_read on issues_lessons_history;
create policy issues_lessons_history_read on issues_lessons_history
  for select using (can_access_project(project_id));

-- The generic loop policy (if this table is ever swept into the module-table
-- array elsewhere) must go, or Postgres ORs it back in and a history row
-- becomes editable/deletable by anyone who can write the project.
drop policy if exists issues_lessons_history_write on issues_lessons_history;

drop policy if exists issues_lessons_history_ins on issues_lessons_history;
create policy issues_lessons_history_ins on issues_lessons_history
  for insert with check (
    is_writer() and can_access_project(project_id)
  );

-- ⚠️ NO UPDATE POLICY. NO DELETE POLICY. On purpose, and it is the whole
-- point: an audit trail that anyone (including a planner) could edit or
-- remove after the fact is not an audit trail. If a bad entry is ever written
-- by a bug, fixing it is a manual, logged, out-of-band DBA action — never a
-- feature this app exposes.


-- ==========================================================================
-- [132/142] 2026-08-31-manpower-org-schedule-manhours.sql
-- ==========================================================================
-- ============================================================================
-- Manpower Loading — Table of Organization, schedule/location tagging, manhours
-- 2026-08-31
--
-- Adds what the existing manpower_positions/manpower_loading/manpower_roster
-- tables (2026-08-27) could not yet do:
--
--   1. A real reporting-line hierarchy for the Table of Organization view, kept
--      OPTIONAL — a position with no manager still renders, grouped by
--      department, exactly as today. `reports_to_id` is a self-reference so a
--      planner who wants a true org tree can build one without a schema change.
--
--   2. `manpower_roster` gains the SAME schedule-link shape equipment_items
--      already carries (`2026-08-24-equipment-schedule-link.sql`) — one
--      activity or one WBS branch, plus a `location` jsonb keyed by
--      `location_levels.id` (the same shape `project_schedule.location`
--      already uses). ⚠️ This is a TAG, not a second source of derived
--      months — manpower_loading is still driven by the roster's own
--      contract_start/contract_end (2026-08-28's derivation). Linking a
--      subcontractor to an activity says WHERE they work, for the
--      Activities×Subcontractor matrix and the vertical stacking view; it
--      does not compute a duration a second, possibly-disagreeing way.
--
--   3. `manpower_manhours` — one row per (roster entry, month), planned and
--      actual hours. ⚠️ Its own table, not a jsonb blob and not columns on
--      manpower_roster, for the same reason manpower_loading is its own
--      table: two people editing different months must not clobber each
--      other, and the database needs to sum it per month.
--
-- ⚠️ `location` on manpower_roster is intentionally NOT restricted to any
-- workforce category at the database level. The UI only offers it for Skilled
-- Self-Performed / Subcontractors (an office-based Project Staff profile has
-- no site location to tag), but that is a UI decision, not a data rule the
-- schema should enforce — a category renamed or reused later must not need a
-- migration to keep working.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

alter table manpower_positions add column if not exists reports_to_id uuid
  references manpower_positions(id) on delete set null;
create index if not exists manpower_positions_reports_to_idx
  on manpower_positions(reports_to_id);

alter table manpower_roster add column if not exists link_mode text;         -- null | 'activity' | 'wbs'
alter table manpower_roster add column if not exists link_activity_id text;  -- project_schedule.activity_id
alter table manpower_roster add column if not exists link_wbs text;          -- WBS path prefix
alter table manpower_roster add column if not exists link_label text;        -- cached display name
alter table manpower_roster add column if not exists link_start date;        -- resolved span, cached
alter table manpower_roster add column if not exists link_finish date;
alter table manpower_roster add column if not exists link_synced_at timestamptz;
alter table manpower_roster add column if not exists location jsonb default '{}'::jsonb;

-- Same two indexed reads equipment_items' link resolution relies on.
create index if not exists project_schedule_actid_idx on project_schedule(project_id, activity_id);
create index if not exists project_schedule_wbs_idx on project_schedule(project_id, wbs);

create table if not exists manpower_manhours (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  roster_id uuid not null references manpower_roster(id) on delete cascade,
  period date not null,                   -- first day of the month
  planned_hours numeric,
  actual_hours numeric,
  source text,                            -- 'hand' — reserved for a future derivation source
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- One row per roster entry per month, for the same reason manpower_loading has
-- one per (position, month): without it two browsers can each insert the same
-- month and every manhours total silently double-counts it.
create unique index if not exists manpower_manhours_uni
  on manpower_manhours(roster_id, period);
create index if not exists manpower_manhours_project_idx
  on manpower_manhours(project_id, period);

grant select, insert, update, delete on manpower_manhours to authenticated;
alter table manpower_manhours enable row level security;
drop policy if exists manpower_manhours_read on manpower_manhours;
create policy manpower_manhours_read on manpower_manhours
  for select using (can_access_project(project_id));
drop policy if exists manpower_manhours_write on manpower_manhours;
create policy manpower_manhours_write on manpower_manhours
  for all using (is_writer() and can_access_project(project_id))
  with check (is_writer() and can_access_project(project_id));

drop trigger if exists manpower_manhours_touch on manpower_manhours;
create trigger manpower_manhours_touch before update on manpower_manhours
  for each row execute function public.manpower_touch();

-- ⚠️ Re-declared here (identical to 2026-08-24-equipment-loading.sql) so this
-- module does not depend on Equipment Loading's migration having been run
-- first. `create or replace` on an identical body is a no-op if it already
-- exists; SECURITY INVOKER so the caller's own RLS on project_schedule still
-- applies — never DEFINER, which would leak another project's locations.
create or replace function public.project_location_values(p_project_id text, p_key text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('value', v, 'n', n) order by v), '[]'::jsonb)
  from (
    select trim(location ->> p_key) as v, count(*) as n
    from project_schedule
    where project_id = p_project_id
      and coalesce(activity_type, '') <> 'WBS Summary'
      and nullif(trim(coalesce(location ->> p_key, '')), '') is not null
    group by 1
  ) t;
$$;
grant execute on function public.project_location_values(text, text) to authenticated;


-- ==========================================================================
-- [133/142] 2026-09-01-issues-lessons-reorder.sql
-- ==========================================================================
-- Issues, Concerns & Lessons Learned: manual drag-to-reorder.
-- ----------------------------------------------------------------------------
-- Adds a plain, nullable `sort_order` to both tables. NULL means "no manual
-- order has been set yet" — the log falls back to its existing date-based
-- order (newest first) exactly as before. Dragging a row in the Issues log,
-- the closed-issues table on the Lessons Learned screen, or the standalone
-- lesson cards assigns sort_order (spaced by 10, so a later drop can slot
-- between two existing values without renumbering everything) and from then
-- on that list's display order is sort_order ascending, with unordered rows
-- falling back to the date-based order after the ordered ones.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table issues_lessons add column if not exists sort_order integer;
alter table lessons_learned add column if not exists sort_order integer;


-- ==========================================================================
-- [134/142] 2026-09-01-issues-reopen-action-plan.sql
-- ==========================================================================
-- Issues & Concerns: reopening an On Hold issue back to Open.
-- ----------------------------------------------------------------------------
-- Item 1: On Hold now has its own way back to Open (a "Reopen Issue" button,
-- mirroring the existing Put On Hold / Close Issue reveal-panel workflow) and
-- it always asks for an Action Plan before the transition is allowed — the
-- same "narrative required before the status changes" rule Hold (Reason for
-- Hold) and Close (Closure Report) already follow. `action_plan` is a plain
-- nullable column: most rows never touch this transition, so there is nothing
-- to back-fill.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table issues_lessons add column if not exists action_plan text;


-- ==========================================================================
-- [135/142] 2026-09-01-mom-schedules-attendees-item-history.sql
-- ==========================================================================
-- ============================================================================
-- Migration: Minutes of Meeting — recurring schedules, structured attendees,
-- venue/link/recording, and a per-action-item audit history + hold/close
-- narrative (mirroring the Issues & Concerns workflow shipped 2026-08-31).
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- ⚠️ WHY A SEPARATE `mom_schedules` TABLE INSTEAD OF A "frequency" COLUMN ON
--    `meeting_minutes`. A schedule describes a RECURRING COMMITMENT ("every
--    first Monday of the month") that exists independently of any meeting
--    that has actually happened yet — it needs to be defined, shown on the
--    calendar as a run of PLANNED dates, and used to pre-fill the next
--    occurrence, all before a single `meeting_minutes` row exists for it.
--    A column on the meeting row can only ever describe a meeting that has
--    already been created.
--
-- ⚠️ WHY `mom_items` GETS ITS OWN HISTORY TABLE RATHER THAN REUSING
--    `issues_lessons_history`. The two audit an unrelated primary key
--    (`issue_id` vs `item_id`) and unrelated rows — an insert-only audit
--    trail that mixed them would need a nullable, mutually-exclusive pair of
--    foreign keys, which is exactly the shape that lets a bug insert a row
--    naming neither. Two small tables, one obvious foreign key each.
--
-- ⚠️ NO UPDATE POLICY, NO DELETE POLICY on `mom_items_history` — same as
--    `issues_lessons_history` (2026-08-31): an audit trail a planner could
--    edit or remove after the fact is not an audit trail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recurring meeting schedules
-- ---------------------------------------------------------------------------
create table if not exists mom_schedules (
  id             uuid primary key default gen_random_uuid(),
  project_id     text references projects(id),
  title          text not null,
  -- 'Internal' | 'External' — item #21's grouping. Free text, not a CHECK:
  -- the app's own picker only ever offers these two, but a CHECK would turn
  -- a legacy or hand-entered value into a hard failure rather than something
  -- the UI can still display and correct.
  meeting_group  text not null default 'Internal',
  -- 'weekly' | 'monthly_date' | 'monthly_weekday' | 'quarterly'. A biweekly
  -- (or any every-N-weeks) cadence is 'weekly' with interval_n=2 — one
  -- recurrence shape, not two, since they differ only in the step size.
  frequency      text not null default 'monthly_date',
  -- weekly: 0=Monday..6=Sunday, the day it recurs on.
  -- monthly_weekday: the weekday within week_ordinal (e.g. "first Monday").
  weekday        int,
  -- monthly_weekday only: 1..4, or -1 for "last" (the last such weekday
  -- in the month, so "last Friday" is still expressible in a short month).
  week_ordinal   int,
  -- monthly_date / quarterly: the day-of-month it recurs on (1..31; a month
  -- shorter than this clamps to its own last day — see PDCal-style clamping
  -- in the client, not enforced here).
  day_of_month   int,
  start_date     date not null default current_date,
  active         boolean not null default true,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists mom_schedules_project_idx on mom_schedules(project_id);

alter table mom_schedules enable row level security;

drop policy if exists mom_schedules_read on mom_schedules;
create policy mom_schedules_read on mom_schedules
  for select using (can_access_project(project_id));

-- Drop the generic loop policy in case a later sweep of "every module table"
-- ever adds one back — Postgres ORs permissive policies, so leaving it would
-- silently widen writes back to is_planner()-only or is_writer()-for-all.
drop policy if exists mom_schedules_write on mom_schedules;

-- ⚠️ Same per-row shape as meeting_minutes (2026-08-20-department-minutes.sql):
-- any approved non-viewer may define a schedule; a planner maintains all of
-- them, everyone else only the ones they created.
drop policy if exists mom_schedules_ins on mom_schedules;
create policy mom_schedules_ins on mom_schedules
  for insert with check (is_writer() and can_access_project(project_id));

drop policy if exists mom_schedules_upd on mom_schedules;
create policy mom_schedules_upd on mom_schedules
  for update using (
    can_access_project(project_id) and (is_planner() or created_by = auth.uid())
  ) with check (
    can_access_project(project_id) and (is_planner() or created_by = auth.uid())
  );

drop policy if exists mom_schedules_del on mom_schedules;
create policy mom_schedules_del on mom_schedules
  for delete using (
    can_access_project(project_id) and (is_planner() or created_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. meeting_minutes — link to a schedule, structured attendees, venue/link/
--    recording (item #20).
-- ---------------------------------------------------------------------------
alter table meeting_minutes add column if not exists schedule_id uuid references mom_schedules(id) on delete set null;
-- 'Internal' | 'External' (item #21) — independent of `meeting_type`, which
-- stays free text for the *label* ("PPR Meeting", "Client Meeting", …). A
-- one-off meeting with no recurring schedule still needs a group of its own,
-- so this is not derived from schedule_id.
alter table meeting_minutes add column if not exists meeting_group text;
alter table meeting_minutes add column if not exists venue text;
alter table meeting_minutes add column if not exists meeting_link text;
alter table meeting_minutes add column if not exists recording_url text;
-- ⚠️ jsonb, not a champion_ids-array + text pair per attendee tier (the
-- pattern `champion_ids`/`champion` uses) — three attendee tiers would
-- otherwise need six columns for what is fundamentally one shape
-- ({ids:[...], text:'...'}) repeated three times. Each is read/written as
-- one object by the client's existing People Picker component.
alter table meeting_minutes add column if not exists attendees_required jsonb;
alter table meeting_minutes add column if not exists attendees_optional jsonb;
alter table meeting_minutes add column if not exists attendees_actual   jsonb;

-- ---------------------------------------------------------------------------
-- 3. mom_items — hold/close narrative (item #23, mirroring issues_lessons).
-- ---------------------------------------------------------------------------
alter table mom_items add column if not exists hold_reason    text;
alter table mom_items add column if not exists closure_report text;

create table if not exists mom_items_history (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references mom_items(id) on delete cascade,
  project_id            text references projects(id),
  action                text not null,   -- 'create' | 'update' | 'hold' | 'close'
  note                  text,
  snapshot              jsonb,
  changed_by            uuid references users(id),
  changed_by_department text,
  changed_at            timestamptz not null default now()
);
create index if not exists mom_items_history_item_idx on mom_items_history (item_id, changed_at desc);

alter table mom_items_history enable row level security;

drop policy if exists mom_items_history_read on mom_items_history;
create policy mom_items_history_read on mom_items_history
  for select using (can_access_project(project_id));

drop policy if exists mom_items_history_write on mom_items_history;

drop policy if exists mom_items_history_ins on mom_items_history;
create policy mom_items_history_ins on mom_items_history
  for insert with check (is_writer() and can_access_project(project_id));

-- ⚠️ NO UPDATE POLICY. NO DELETE POLICY. On purpose — see the header comment.


-- ==========================================================================
-- [136/142] 2026-09-01-risk-register-rcm.sql
-- ==========================================================================
-- ============================================================================
-- Risk Register -> the real EPC Risk and Control Matrix (RCM)
-- Source: "SLN101. OPS. Risk Register. 2025 07 01.xlsx" (EPC Project Risk Register)
-- 2026-09-01
--
-- WHAT WAS MISSING. The starter table modelled a generic risk list: code, title,
-- category, L x I, response, owner. The register Megawide actually runs is an RCM
-- with SIX bands across the sheet, and five of them had nowhere to live:
--
--   RISK IDENTIFICATION | RISK APPETITE | RISK ASSESSMENT | RISK RESPONSE
--   | RESIDUAL RISK ASSESSMENT | AUDIT PLAN
--
-- The consequence was not cosmetic. Without the identification band a risk is
-- not attached to the 5-PMLC activity that owns it, so the register cannot be
-- read the way the sheet is read (by business process) and the process owner
-- has no column to be named in. Without the residual band there is no way to
-- record that a control WORKED — the register keeps showing inherent scores
-- forever, which is precisely the number a control is supposed to move.
--
-- ⚠️ ADD-ONLY. Every pre-existing column keeps its meaning, because the dashboard
-- tile (`config.js` -> risk-register.dash.metrics) counts `status` and plots
-- `impact` x `likelihood`, and a rename here silently zeroes that tile:
--   title      = Risk Event          (col H)
--   category   = Risk Category       (col F)   -- now the workbook's 10-term taxonomy
--   likelihood = Probability 1..5    (col N)
--   impact     = Impact 1..5         (col M)
--   rating     = IMPORTANCE          (col O)   = impact x probability
--   response   = Control Category    (col Q)   -- Treat/Transfer/Terminate/Tolerate
--   mitigation = Control Description (col R)
--   owner      = Risk Owner          (col I)
--
-- ⚠️ PRIORITY / LEVEL (col P) IS NOT STORED. It is a pure lookup of
-- (impact, probability) into the workbook's 5x5 heat map, so storing it would
-- only let it drift out of step with the two numbers it is made of — the same
-- rule `rating` already follows in this module. Derived in `module.js`
-- (PRIORITY_GRID). Same for the residual band's own priority.
--
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

-- ---- RISK IDENTIFICATION (cols A-E) ----------------------------------------
-- The 5-PMLC activity the risk belongs to. `activity_no` is the sheet's own
-- Activity No. and is what the register groups and orders by; the three text
-- columns are the activity's header block, repeated on each of its risks so a
-- row is self-describing when it is filtered out of its group.
alter table risk_register add column if not exists activity_no          int;
alter table risk_register add column if not exists activity             text;
alter table risk_register add column if not exists sub_process          text;
alter table risk_register add column if not exists process_objectives   text;
alter table risk_register add column if not exists process_description  text;

-- Risk Sub-Category (col G) — the second level of the EPC Risk Universe
-- ("Commercial > IBB", "Operational > Safety"). Free text in the DB on purpose:
-- the taxonomy is a workbook sheet that grows, and a check constraint here would
-- reject a legitimate new sub-category until someone shipped a migration.
alter table risk_register add column if not exists sub_category         text;

alter table risk_register add column if not exists risk_champion        text;   -- col J
alter table risk_register add column if not exists risk_appetite        text;   -- col K

-- ---- RISK RESPONSE (cols Q-T) ----------------------------------------------
-- `control_type` is the Control Masterlist's L1 category (Framework/Policy,
-- Document Review and Approval, Management Review, Independent Review or Audit,
-- Physical Inspection, Quality Control, Control Self-Assessment). It is NOT the
-- same field as `response`, which the sheet confusingly also labels "Control
-- Category" while filling it with the four treatment terms.
alter table risk_register add column if not exists control_type         text;
alter table risk_register add column if not exists control_owner        text;   -- col S
alter table risk_register add column if not exists response_cost        numeric;-- col T (PHP)

-- ---- RESIDUAL RISK ASSESSMENT (cols U-Z) -----------------------------------
-- Scored 1..5 each; IMPORTANCE = product (1..125) and the band is
-- Low 1-27 / Moderate 28-64 / High 65-125 per "Table 3A - RISK RATING".
-- Derived in the app, not stored, for the reason in the header.
alter table risk_register add column if not exists res_impact           int;    -- severity after control
alter table risk_register add column if not exists res_possibility      int;    -- occurrence after control
alter table risk_register add column if not exists res_detectability    int;    -- degree of control (Table 1C)
alter table risk_register add column if not exists res_response_cost    numeric;

-- ---- AUDIT PLAN (cols AA-AD) ------------------------------------------------
alter table risk_register add column if not exists audit_procedures     text;
alter table risk_register add column if not exists required_documents   text;
alter table risk_register add column if not exists audit_contact        text;
alter table risk_register add column if not exists audit_timing         text;

-- ---- Housekeeping -----------------------------------------------------------
-- `sort_order` keeps hand-arranged order inside an activity. Without it the only
-- stable order is rating desc, which shuffles a register every time a score is
-- edited — the sheet's rows do not move when a number changes.
alter table risk_register add column if not exists sort_order           int default 0;
alter table risk_register add column if not exists identified_date      date;
alter table risk_register add column if not exists target_date          date;

-- Grouped reads are the module's default view, so the index matches them.
create index if not exists risk_register_activity_idx
  on risk_register (project_id, activity_no, sort_order);


-- ==========================================================================
-- [137/142] 2026-09-01-stakeholder-register-ops.sql
-- ==========================================================================
-- ============================================================================
-- Stakeholder Map -> the real EPC Stakeholder Register (+ stakeholder photos)
-- Source: "CSF101. OPS. Stakeholder Register. 2026 02 13.xlsx"
-- 2026-09-01
--
-- TWO CHANGES, ONE MODULE.
--
-- 1) THE REGISTER. The module was built from the corporate-BD map
--    ("CORP. BD TCD. Stakeholder Map 2026.xlsx"), which is a flat list of people
--    with an Impact x Interest rating. The OPS register is the same shape as the
--    Risk and Control Matrix: a stakeholder is registered AGAINST a 5-PMLC
--    activity, assessed Impact x Influence, given a response and a relationship
--    owner, costed, re-assessed for residual risk, and handed an engagement plan
--    with a named Megawide counterpart. None of those bands existed here.
--
-- 2) PHOTOS. A register of 85 people that prints only names is unusable at the
--    one moment it matters -- walking into a meeting with a client's operations
--    head you have never met. So a face per row, in a PRIVATE bucket.
--
-- ⚠️ ADD-ONLY, and the two pre-existing rating columns keep their storage:
--      influence = Impact 1..4    (col M)   -- named `influence` since 2026-07-20
--      interest  = Influence 1..4 (col N)   -- the OPS axis; BD called it Interest
--    The dashboard tile plots `interest` x `influence` (`config.js` ->
--    stakeholder-map.dash.metrics), so renaming either would zero that tile. The
--    module relabels them in the UI instead. `category` stays Sector
--    (Government / Private) from the BD map -- the OPS register's own
--    "Stakeholder Category" is a DIFFERENT vocabulary (the risk taxonomy) and
--    gets its own column below rather than overwriting live data.
--
-- ⚠️ PRIORITY LEVEL, RESPONSE CATEGORY AND THE ENGAGEMENT APPROACH ARE DERIVED.
--    Priority = a 4x4 lookup of (Impact, Influence); Response Category = a lookup
--    of Priority; Approach = the Impact/Influence (Mendelow) map. All three are
--    pure functions of the two ratings, so they live in `module.js`. Only
--    `mgmt_approach` is stored, and only as a deliberate OVERRIDE -- the workbook's
--    own AF column is hand-typed and disagrees with its own grid on ~10 rows, so
--    the module has to be able to hold a planner's judgement call without
--    pretending it was computed.
--
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
-- ============================================================================

-- ---- STAKEHOLDER IDENTIFICATION (cols A-J) ---------------------------------
alter table stakeholder_map add column if not exists activity_no           int;
alter table stakeholder_map add column if not exists activity              text;
alter table stakeholder_map add column if not exists sub_process           text;
alter table stakeholder_map add column if not exists process_objectives    text;
alter table stakeholder_map add column if not exists process_description   text;

-- The OPS register's Stakeholder Category / Sub-Category (cols F-G). Same
-- 10-term EPC taxonomy the risk register uses, NOT the BD map's Sector.
alter table stakeholder_map add column if not exists stk_category          text;
alter table stakeholder_map add column if not exists stk_sub_category      text;

alter table stakeholder_map add column if not exists relationship_champion text;   -- col J

-- ---- STAKEHOLDER RESPONSE (cols Q-U) ---------------------------------------
-- `response_category` is an override of the derived lookup, for the same reason
-- `mgmt_approach` is. `relationship_owner` is col S and is NOT the same field as
-- the BD map's `primary_responsible`, which is kept: one is who owns the
-- relationship in the register, the other is who the BD sheet nominates to keep
-- it warm, and on real rows they differ.
alter table stakeholder_map add column if not exists response_category     text;
alter table stakeholder_map add column if not exists response_description  text;
alter table stakeholder_map add column if not exists relationship_owner    text;
alter table stakeholder_map add column if not exists impact_cost           numeric;  -- col T (PHP)
alter table stakeholder_map add column if not exists response_cost         numeric;  -- col U (PHP)

-- ---- RESIDUAL RISK ASSESSMENT (cols V-AA) ----------------------------------
alter table stakeholder_map add column if not exists res_impact            int;
alter table stakeholder_map add column if not exists res_possibility       int;
alter table stakeholder_map add column if not exists res_detectability     int;
alter table stakeholder_map add column if not exists res_response_cost     numeric;

-- ---- AUDIT PLAN (cols AB-AE) ------------------------------------------------
alter table stakeholder_map add column if not exists audit_procedures      text;
alter table stakeholder_map add column if not exists required_documents    text;
alter table stakeholder_map add column if not exists audit_contact         text;
alter table stakeholder_map add column if not exists audit_timing          text;

-- ---- STAKEHOLDER ENGAGEMENT (cols AF-AH) -----------------------------------
alter table stakeholder_map add column if not exists mgmt_approach         text;   -- override of the derived approach
alter table stakeholder_map add column if not exists engagement_plan       text;   -- col AG
alter table stakeholder_map add column if not exists megawide_counterpart  text;   -- col AH

-- ---- Photos ----------------------------------------------------------------
-- ⚠️ PATHS, NOT URLS. The bucket is private, so the module signs a short-lived
-- URL on demand; a stored signed URL expires and is then a broken image forever.
-- Same construction as progress_photos / drawing_register.
-- `photo_thumb_path` is a real, separate, small JPEG made client-side at upload
-- time -- not a transform parameter -- so the Cards view stays fast without
-- depending on Supabase's image-transform add-on being enabled on the plan.
alter table stakeholder_map add column if not exists photo_path            text;
alter table stakeholder_map add column if not exists photo_thumb_path      text;

-- ---- Housekeeping -----------------------------------------------------------
alter table stakeholder_map add column if not exists sort_order            int default 0;

create index if not exists stakeholder_map_activity_idx
  on stakeholder_map (project_id, activity_no, sort_order);

-- ============================================================================
-- Storage bucket: stakeholder-photos
--
-- ⚠️ PRIVATE, like every other bucket in this app. These are photographs of
-- named individuals -- a client's CEO, an LGU official -- sitting beside a note
-- on how much influence they hold over the project. A public bucket hands that
-- to anyone with the link and no login.
--
-- ⚠️ The policies are NOT project-scoped: storage.objects has no project column
-- to join on, so the gate is the app's own role check, and the module only ever
-- reads a path off a row the caller's RLS already let them read. Objects are laid
-- out as <project_id>/<timestamp>_<rand>_<name>.<ext>.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('stakeholder-photos', 'stakeholder-photos', false)
on conflict (id) do nothing;

do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing - run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
end $$;

drop policy if exists stakeholder_photos_read on storage.objects;
create policy stakeholder_photos_read on storage.objects
  for select using (bucket_id = 'stakeholder-photos' and public.is_approved());

drop policy if exists stakeholder_photos_insert on storage.objects;
create policy stakeholder_photos_insert on storage.objects
  for insert with check (bucket_id = 'stakeholder-photos' and public.is_writer());

drop policy if exists stakeholder_photos_update on storage.objects;
create policy stakeholder_photos_update on storage.objects
  for update using (bucket_id = 'stakeholder-photos' and public.is_writer());

-- Replacing a photo deletes the object it replaced, and the person replacing it
-- is rarely the person who uploaded it -- hence is_planner() beside the owner branch.
drop policy if exists stakeholder_photos_delete on storage.objects;
create policy stakeholder_photos_delete on storage.objects
  for delete using (bucket_id = 'stakeholder-photos' and (owner = auth.uid() or public.is_planner()));


-- ==========================================================================
-- [138/142] 2026-09-01-wbs-link-rpc.sql
-- ==========================================================================
-- One-call WBS link RPC (Project Schedule — WBS adoption after a big import)
-- ------------------------------------------------------------------------------------------------
-- After an import, `wbsAdopt()` builds one wbs_node per WBS-Summary row and then has to write
-- project_schedule.wbs_node_id back onto every row. It did that with one single-row PATCH per row
-- (40 in flight): 12,465 requests / 312 sequential waves for the 4PH Strevi Residences .xer — the
-- app looks hung for minutes, and any wave that fails leaves nodes unlinked. An unlinked node reads
-- to `_wbsEnsureSummaries()` as "this node has no summary row", which it heals by INSERTING one,
-- sequentially — the duplicate-WBS-row runaway seen on Avesta (AVR101).
--
-- This function does the whole set as a SINGLE UPDATE ... FROM jsonb_to_recordset. It matches on the
-- dotted WBS code, so it links the summary row AND any activity carrying that same code (a Builder
-- push / manually-added activity), which is exactly what the client loop did.
--
-- SECURITY INVOKER (the default) → the function runs as the CALLER, so Row-Level Security on
-- project_schedule still applies: a user can only relink rows in projects they can write. Do NOT
-- change this to SECURITY DEFINER — that would let any caller rewrite another project's tree links.
--
-- The client calls this first and falls back to per-row updates if the function is absent, so it is
-- safe to deploy the client before or after this migration.
--
-- Idempotent: create-or-replace + a re-granted execute privilege. Safe to run multiple times.

create or replace function public.wbs_link_codes(p_project_id text, p_map jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_schedule s
     set wbs_node_id = m.node_id
    from jsonb_to_recordset(coalesce(p_map, '[]'::jsonb)) as m(code text, node_id uuid)
   where s.project_id = p_project_id
     and s.wbs = m.code
     and s.wbs_node_id is distinct from m.node_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Logged-in app users authenticate via Supabase Auth, so their requests run as `authenticated`.
grant execute on function public.wbs_link_codes(text, jsonb) to authenticated;


-- ================================================================================================
-- 2) Attach IMPORTED ACTIVITIES to their WBS branch.
-- ------------------------------------------------------------------------------------------------
-- `wbs_link_codes` above links rows whose dotted code EQUALS a branch's code — summary rows, and the
-- Builder-pushed / manually-added activities that are filed AT a branch. An IMPORTED activity is not
-- one of those: it carries its own LEAF code ("4.2.3.1.5" under branch "4.2.3.1"), so it matched
-- nothing and every import left `wbs_node_id` NULL on every activity. Measured on the real exports:
-- 4,393 of 4,393 (Avesta) and 16,393 of 16,393 (4PH Strevi).
--
-- The grid never showed it, because rebuild() derives ancestry by SPLITTING the dotted code. What
-- broke was everything keyed on the NODE:
--   * the WBS Manager's "N activities" read 0 on all 1,623 / 12,464 nodes;
--   * phaseOf() is `r.phase || _nodePhase(r.wbs_node_id)`, so every activity had NO phase —
--     isExecPhase() was false everywhere and Vertical Stacking reported "0 execution-phase
--     activities stacked" on a project holding 3,874 of them;
--   * workOf() had no branch to infer a trade from, and Contract Scope read "—".
--
-- ⚠️ NO PAYLOAD. The project's own WBS-Summary rows ARE the (dotted code -> node id) map, so the
-- join runs entirely inside the database. That is the point: the client-side alternative is one
-- PATCH per activity — 16,393 requests, the runaway `wbs_link_codes` was written to kill — so the
-- client has NO row-by-row fallback for this one and reports the missing function instead.
--
-- Matching rule: an activity belongs to the branch whose code is its own code minus the last
-- segment. `regexp_replace(wbs, '\.[^.]+$', '')` is exactly that, and the `like '%.%'` guard keeps a
-- single-segment code (which has no parent) from matching a top-level branch as its own parent.
--
-- The sub-select collapses the code -> node map with min(), so a project that still carries two
-- summary rows sharing one dotted code resolves deterministically instead of picking at random.
--
-- SECURITY INVOKER (the default) — runs as the CALLER, so RLS on project_schedule still applies.
-- Idempotent, and safe to re-run: rows that already carry the right node are excluded by the
-- `is distinct from` test, so a second run reports 0.

create or replace function public.wbs_link_activity_parents(p_project_id text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_schedule a
     set wbs_node_id = s.node_id
    from (
      select wbs, min(wbs_node_id::text)::uuid as node_id
        from public.project_schedule
       where project_id = p_project_id
         and activity_type = 'WBS Summary'
         and wbs_node_id is not null
         and wbs is not null
       group by wbs
    ) s
   where a.project_id = p_project_id
     and a.activity_type is distinct from 'WBS Summary'
     and a.wbs_node_id is null
     and a.wbs is not null
     and a.wbs like '%.%'
     and s.wbs = regexp_replace(a.wbs, '\.[^.]+$', '')
     and a.wbs_node_id is distinct from s.node_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_link_activity_parents(text) to authenticated;


-- ==========================================================================
-- [139/142] 2026-09-02-clear-project-rpc.sql
-- ==========================================================================
-- One-call project CLEAR (Project Schedule — "Clear schedule" and every REPLACE import)
-- ================================================================================================
-- WHY THIS EXISTS, and why the obvious fix was not enough.
--
-- `Clear schedule` was a single `delete ... where project_id = $1` from PostgREST. On SLN101 that
-- returned **"canceling statement due to statement timeout"** and cleared nothing. The 2026-09-02
-- client fix chunked it into `delete ... where id in (<200 ids>)` requests, which WORKS but is
-- brutally slow: measured by the owner at **100-200 activities per 2 seconds**, i.e. ~10ms per row.
--
-- ⚠️ THAT 10ms IS NOT DATABASE TIME. `project_schedule` carries no trigger, no rule and nothing
-- referencing it (`grep -rn "references project_schedule"` over the whole schema: no matches), and
-- it is indexed on `(project_id, id)`. Deleting 16,485 rows server-side is one index scan. The cost
-- is the HTTP ROUND TRIP: 200 ids is already close to the practical URL length for a PostgREST
-- `in.(...)` filter (36-char uuids + encoding ≈ 8KB), so the chunk size cannot simply be raised —
-- 20,000 rows means ~100 sequential requests whatever we do on the client. The fix has to move the
-- loop into the database.
--
-- 4PH Strevi Bacoor is 16,485 activities and 12,465 WBS nodes. At 200 per round trip that is ~145
-- requests and minutes of spinner; here it is one call.
--
-- WHY A ROW LIMIT RATHER THAN A BARE `delete where project_id = $1`:
-- the bare form is what timed out in the first place. `statement_timeout` is a property of the
-- deployment, not of this function — a plpgsql loop inside one call does NOT get a fresh timeout per
-- iteration, because the timer is armed once when the top-level statement starts. So the bound has
-- to be visible to the CALLER, which can then come back for more. `p_limit` is that bound: the
-- client asks for a batch, gets the count, and calls again until it gets 0. It also lets the client
-- HALVE the batch and retry when a call does time out, instead of failing the whole operation.
--
-- SECURITY INVOKER (the default) — the function runs as the CALLER, so Row-Level Security still
-- applies and a user can only clear projects they can already write. ⚠️ Do NOT change this to
-- SECURITY DEFINER: these functions delete a whole project's schedule, and definer rights would let
-- any authenticated caller wipe any project.
--
-- The client calls these first and falls back to its id-chunking loop when the function is absent,
-- so it is safe to deploy the client before or after this migration.
--
-- Idempotent: create-or-replace + re-granted execute. Safe to run more than once.

-- 1) The activities. -------------------------------------------------------------------------
create or replace function public.clear_project_schedule(p_project_id text, p_limit integer default 20000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.project_schedule
   where id in (
     select id from public.project_schedule
      where project_id = p_project_id
      limit greatest(1, coalesce(p_limit, 20000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.clear_project_schedule(text, integer) to authenticated;


-- 2) The WBS tree. ---------------------------------------------------------------------------
-- ⚠️ `is_locked = false` ONLY, exactly like the client's `_clearWbsTree`. The standard Milestones /
-- Initiation / Planning / Execution Phase skeleton is locked and must survive a clear — the whole
-- app assumes it exists, and an import re-adopts underneath it.
-- ⚠️ Children before parents is NOT needed: `wbs_nodes.parent_id` is
-- `references wbs_nodes(id) on delete cascade`, so a batch that deletes a parent takes its subtree
-- with it. That also means the returned count UNDER-reports what actually went, which is why the
-- client loops until it gets 0 rather than counting up to a total it predicted.
create or replace function public.clear_project_wbs_nodes(p_project_id text, p_limit integer default 20000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.wbs_nodes
   where id in (
     select id from public.wbs_nodes
      where project_id = p_project_id
        and coalesce(is_locked, false) = false
      limit greatest(1, coalesce(p_limit, 20000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.clear_project_wbs_nodes(text, integer) to authenticated;


-- 3) Resource assignments, cleared by both REPLACE paths alongside the activities. -------------
create or replace function public.clear_project_resource_assignments(p_project_id text, p_limit integer default 20000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.resource_assignments
   where id in (
     select id from public.resource_assignments
      where project_id = p_project_id
      limit greatest(1, coalesce(p_limit, 20000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.clear_project_resource_assignments(text, integer) to authenticated;


-- ==========================================================================
-- [140/142] 2026-09-02-wbs-link-batched.sql
-- ==========================================================================
-- Batch the activity->branch link, because the single-statement version times out on a real project
-- ================================================================================================
-- MEASURED, not theorised. Called against 4PH Strevi (SLN101) in the owner's signed-in browser:
--
--     rpc('wbs_link_activity_parents', { p_project_id: 'SLN101' })
--       -> 57014  "canceling statement due to statement timeout"   after 8,173 ms
--
-- So the deployment's `statement_timeout` is ~8s and this function needs more: it is ONE update over
-- 16,485 activities joined against a GROUP BY over 12,473 WBS-summary rows, with the join key
-- computed per row (`regexp_replace(wbs, '\.[^.]+$', '')`), which no index can serve.
--
-- ⚠️ THE CONSEQUENCE WAS SILENT AND SEVERE. `_wbsLinkActivityParents` catches the error and only
-- toasts when not silent — and every caller that matters passes silent. So the import finished, the
-- WBS tree was complete (12,473 nodes, all summary rows linked), and **16,393 of 16,485 activities
-- kept `wbs_node_id = NULL`** with nothing said. That is the exact state documented in
-- 2026-09-01-wbs-link-rpc.sql: `phaseOf()` null for every activity, so `isExecPhase()` false
-- everywhere and Vertical Stacking draws nothing; `workOf()` finds no trade; every WBS Manager count
-- reads 0 — while the grid looks perfect, because `rebuild()` derives ancestry by splitting the
-- dotted code and never reads the node id.
--
-- THE FIX IS THE ONE THE CLEAR ALREADY USES: bound the work per call and let the caller come back.
-- A plpgsql loop inside one call would NOT help — the timeout is armed once, when the top-level
-- statement starts — so the bound has to be visible to the client, which loops until it gets 0 and
-- halves `p_limit` if a call still times out.
--
-- ⚠️ `drop function` first, deliberately. Adding a defaulted second parameter to the existing
-- one-argument function would leave BOTH in the catalog, and PostgREST cannot resolve
-- `wbs_link_activity_parents(p_project_id)` against two candidates — it answers PGRST203
-- (ambiguous). Replacing it outright keeps exactly one signature, and the default keeps any older
-- client that calls it with one argument working.
--
-- SECURITY INVOKER — runs as the CALLER, so RLS on project_schedule still applies. Idempotent: rows
-- already carrying the right node are excluded, so a second run reports 0.

drop function if exists public.wbs_link_activity_parents(text);
drop function if exists public.wbs_link_activity_parents(text, integer);

create or replace function public.wbs_link_activity_parents(p_project_id text, p_limit integer default 4000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with map as (
    select wbs, min(wbs_node_id::text)::uuid as node_id
      from public.project_schedule
     where project_id = p_project_id
       and activity_type = 'WBS Summary'
       and wbs_node_id is not null
       and wbs is not null
     group by wbs
  ),
  targets as (
    select a.id, m.node_id
      from public.project_schedule a
      join map m on m.wbs = regexp_replace(a.wbs, '\.[^.]+$', '')
     where a.project_id = p_project_id
       and a.activity_type is distinct from 'WBS Summary'
       and a.wbs_node_id is null
       and a.wbs is not null
       and a.wbs like '%.%'
     limit greatest(1, coalesce(p_limit, 4000))
  )
  update public.project_schedule s
     set wbs_node_id = t.node_id
    from targets t
   where s.id = t.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_link_activity_parents(text, integer) to authenticated;


-- ==========================================================================
-- [141/142] 2026-09-02-wbs-unlink-batched.sql
-- ==========================================================================
-- Batch the "clear dangling wbs_node_id" pass of Reset WBS tree
-- ================================================================================================
-- Reset WBS tree deletes the unlocked nodes and then has to clear every `project_schedule.
-- wbs_node_id` that pointed at them. It did that as ONE update:
--
--     update project_schedule set wbs_node_id = null
--      where project_id = $1 and wbs_node_id is not null and wbs_node_id not in (<locked ids>)
--
-- ⚠️ On 4PH Strevi that is ~28,958 rows in one statement, and this deployment's `statement_timeout`
-- is **~8 seconds** — measured, not assumed: `wbs_link_activity_parents` returned 57014 after
-- 8,173ms on 16,485 rows the same afternoon. So Reset WBS tree — the documented recovery from a
-- broken tree — would itself fail on exactly the projects that need it, leaving the nodes deleted
-- and every row still pointing at them.
--
-- ⚠️ NO KEEP-LIST. The old form had to be told which nodes survived, and passed them as a
-- `not in (…)` of ids. This asks the better question: null the rows whose node **no longer exists**.
-- After the delete that is precisely the dangling set, it cannot be wrong about which nodes
-- survived, and it needs no argument that grows with the tree.
--
-- ⚠️ Bounded by `p_limit` for the same reason as every other statement here: a plpgsql loop inside
-- one call does NOT get a fresh timeout per iteration, because the timer is armed once when the
-- top-level statement starts. The caller loops until it gets 0 and halves the batch on 57014.
--
-- SECURITY INVOKER — runs as the CALLER, so RLS still applies. Idempotent: a second run finds
-- nothing dangling and returns 0.

create or replace function public.wbs_unlink_dangling(p_project_id text, p_limit integer default 4000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_schedule s
     set wbs_node_id = null
   where s.id in (
     select a.id
       from public.project_schedule a
      where a.project_id = p_project_id
        and a.wbs_node_id is not null
        and not exists (select 1 from public.wbs_nodes w where w.id = a.wbs_node_id)
      limit greatest(1, coalesce(p_limit, 4000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_unlink_dangling(text, integer) to authenticated;


-- ================================================================================================
-- 2) Orphan NODES — a node no WBS-summary row points at.
-- ------------------------------------------------------------------------------------------------
-- Adopting twice against a stale in-memory copy inserts a second node for every branch that already
-- had one. Measured on 4PH Strevi: `wbs_nodes` went 12,473 -> **18,323** against 12,473 summary
-- rows, i.e. 5,850 duplicates — exactly the number the first adopt had left outstanding.
--
-- ⚠️ Duplicates do not sit still. `_wbsEnsureSummaries()` projects a summary row for any node without
-- one, so the next load manufactures a summary row per duplicate, which the next adopt then adopts.
-- That is the duplicate-WBS-row runaway.
--
-- ⚠️ THIS DELETES LEAVES ONLY (`not exists (child)`), and that is the whole safety argument.
-- `wbs_nodes.parent_id` is `on delete cascade`, so deleting an orphan that happens to be the PARENT
-- of a referenced node would silently take the good node with it. Peeling only childless orphans,
-- repeatedly, can never do that: a node is removed only once nothing hangs beneath it. The caller
-- loops until it returns 0, so a duplicated SUBTREE still goes completely, one layer at a time.
-- ⚠️ Locked skeleton nodes are excluded outright — they are legitimately unreferenced.

create or replace function public.wbs_delete_orphan_leaves(p_project_id text, p_limit integer default 2000)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.wbs_nodes
   where id in (
     select w.id
       from public.wbs_nodes w
      where w.project_id = p_project_id
        and coalesce(w.is_locked, false) = false
        and not exists (select 1 from public.wbs_nodes c where c.parent_id = w.id)
        and not exists (select 1 from public.project_schedule s
                         where s.project_id = p_project_id and s.wbs_node_id = w.id)
      limit greatest(1, coalesce(p_limit, 2000))
   );
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wbs_delete_orphan_leaves(text, integer) to authenticated;


-- ==========================================================================
-- [142/142] 2026-09-04-reconstruction-delete-terminal.sql
-- ==========================================================================
-- ============================================================================
-- Migration: 2026-09-04 — let a requester delete their own DONE/FAILED 3D
-- reconstruction, not only a still-pending one.
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================
--
-- Bug: "i cant delete 360/3D media from the photos gallery" — panoramas had
-- no delete UI anywhere (fixed client-side, see modules/progress-photos/
-- pano.js's deletePanoById + module.js's openMediaKindDeleteConfirm), but a
-- DONE 3D reconstruction has a second, DATABASE-level blocker: the original
-- 2026-08-29-reconstruction-requests.sql DELETE policy lets an admin delete
-- any row at any status, but a non-admin REQUESTER only their OWN row while
-- it is still 'pending_approval'.
--
-- That restriction exists for a real reason — retracting a row out from under
-- a job that's already 'approved'/'queued'/'processing' would orphan a real,
-- billed RunPod job with nothing in the database pointing at it (see that
-- migration's own comment). But the reasoning STOPS applying the moment the
-- job reaches a TERMINAL state: a 'done' or 'failed' request has no live job
-- left to orphan — RunPod has already finished with it — so there is no
-- reason a requester should need an admin just to remove their own completed
-- (or failed) 3D scan from their own project's gallery.
--
-- This widens the requester's own-row delete to also cover 'done'/'failed',
-- while the active-job window ('pending_approval' still handled the same as
-- before is a no-op here since it's unioned, and 'approved'/'queued'/
-- 'processing' remain admin-only) stays exactly as protected as before.

drop policy if exists reconstruction_requests_del on reconstruction_requests;
create policy reconstruction_requests_del on reconstruction_requests
  for delete using (
    (is_admin() and can_access_project(project_id))
    or (requested_by = auth.uid() and status in ('pending_approval', 'done', 'failed'))
  );

-- ==========================================================================
-- [143] supabase-schema.sql — DEFERRED TAIL
-- These base statements touch tables that only /migrations creates (see
-- gen-build.js), so they run last. All are idempotent.
-- ==========================================================================

alter table wbs_nodes        add column if not exists scope_type       text;
alter table wbs_nodes        add column if not exists change_order_ref text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_scope_type_chk') then
    alter table project_schedule add constraint project_schedule_scope_type_chk
      check (scope_type is null or scope_type in ('main', 'change_order'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wbs_nodes_scope_type_chk') then
    alter table wbs_nodes add constraint wbs_nodes_scope_type_chk
      check (scope_type is null or scope_type in ('main', 'change_order'));
  end if;
end $$;
create index if not exists wbs_nodes_scope_type_idx        on wbs_nodes (project_id, scope_type);

