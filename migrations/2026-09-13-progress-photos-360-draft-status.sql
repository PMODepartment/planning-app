-- Progress Photos: a 360° capture can now be saved as a draft while its
-- stitching pipeline keeps running in the background ("since this portion
-- takes long, allow uploading 360 as draft during the session to work the
-- stitching in the background").
--
-- stitch_status distinguishes a background-processing draft from an
-- ordinary, already-finished row:
--   null        -- normal row (every existing photo/video/360, and any 360
--                  saved the ordinary interactive way, unchanged)
--   'processing' -- a draft inserted the moment "Save as draft" is clicked;
--                  photo_url/thumb_url are still null
--   'failed'     -- the background stitch/upload could not finish; the row
--                  is left for the planner to delete and re-add (there is
--                  no raw video stored to retry from)
--
-- Idempotent — safe to re-run.
alter table progress_photos add column if not exists stitch_status text;

comment on column progress_photos.stitch_status is
  'null = normal row; ''processing''/''failed'' only for a 360 draft whose stitch is running/failed in the background (see module.js open360Upload/saveAsBackgroundDraft).';
