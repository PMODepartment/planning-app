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
