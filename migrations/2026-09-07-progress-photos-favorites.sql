-- Progress Photos — favorite photos (Gallery star) + portfolio-level favorites-only view
-- ------------------------------------------------------------------------------
-- Idempotent (add column if not exists, drop-then-create policy/function);
-- folds into supabase-schema.sql. Safe to re-run.
--
-- Why a column PLUS a SECURITY DEFINER RPC, not just a plain UPDATE:
-- `progress_photos`' generic module-table UPDATE policy (the DO-block loop
-- near the bottom of supabase-schema.sql, policy `progress_photos_upd`) is
-- OWNER-OR-ADMIN: `is_writer() and can_access_project(project_id) and
-- (created_by = auth.uid() or is_admin())`. A plain client-side
-- `.update({favorite:true})` from a non-owner, non-admin project writer would
-- therefore be SILENTLY REFUSED by Postgres and read back as
-- `{ data: null, error: null }` — a refused write is indistinguishable from a
-- genuine no-op update, the exact false-success trap this module already had
-- to fix once for DELETE (see modules/progress-photos/CLAUDE.md, 2026-09-04
-- "the real reason 3D/360 deletes silently failed"). Favoriting is
-- deliberately a TEAM CURATION action — any project writer should be able to
-- flag a photo as a portfolio highlight, not just whoever originally uploaded
-- it — so this is a narrow, explicit bypass of the ownership check via one
-- SECURITY DEFINER function, never a widening of the table's own UPDATE
-- policy (which would let any writer edit ANY field of ANY photo, not just
-- the one boolean this needs).
alter table progress_photos add column if not exists favorite boolean not null default false;

-- Fast lookup for the Portfolio Overview's favorites-only query (scoped by
-- project, filtered to favorite = true) and for a project's own favorited
-- count. Partial index — the overwhelming majority of rows are not
-- favorited, so indexing only the true rows keeps it small and cheap to
-- maintain on every insert.
create index if not exists progress_photos_favorite_idx
  on progress_photos (project_id) where favorite;

-- set_photo_favorite: toggle a single photo's favorite flag as ANY project
-- writer, bypassing the table's owner-or-admin UPDATE restriction for this
-- one field only. Raises on refusal rather than silently no-oping — never a
-- bare `update ... where ...` with no row-count check, which is exactly the
-- pattern that produced the false-success DELETE bug this module already had
-- to trace and fix once.
create or replace function set_photo_favorite(p_photo_id uuid, p_value boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_project text;
begin
  if not is_writer() then
    raise exception 'You do not have permission to change favorites on this project.';
  end if;

  select project_id into v_project from progress_photos where id = p_photo_id;
  if v_project is null then
    raise exception 'That photo could not be found.';
  end if;
  if not can_access_project(v_project) then
    raise exception 'You do not have access to this project.';
  end if;

  update progress_photos set favorite = p_value, updated_at = now() where id = p_photo_id;
  return p_value;
end $$;
grant execute on function set_photo_favorite(uuid, boolean) to authenticated;
