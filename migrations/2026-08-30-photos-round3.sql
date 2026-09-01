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
