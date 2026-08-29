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
