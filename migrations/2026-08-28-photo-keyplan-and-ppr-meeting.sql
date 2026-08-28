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
