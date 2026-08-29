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
