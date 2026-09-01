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
