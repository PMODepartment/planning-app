-- ============================================================================
-- Progress Photos — discontinue 360° panoramas: delete all existing captures
-- 2026-09-02
--
-- Owner: "the 360 photo feature is quite buggy. let's discontinue it for now.
-- disable and grey out 360. delete all 360 photos from the database as well."
--
-- ⚠️ This is a DESTRUCTIVE, ONE-TIME cleanup, run by the app owner in the
-- Supabase SQL editor — this repo has no live DB credentials, so it can only
-- ever ship as a migration the owner runs, never as something executed from
-- here. The UI-side change (the 360° option greyed out in both the "+ Add
-- media" dropdown and the upload modal's own type selector) ships alongside
-- this file but does not depend on it — the app degrades correctly with 0
-- panorama rows either way, since `pano.js`'s own gallery strip and floor-plan
-- pins already render nothing when a project has none.
--
-- ⚠️ The 360° CODE is deliberately NOT removed — same "shelve, don't strip"
-- call already made for the 3D/RunPod reconstruction feature (see
-- modules/progress-photos/CLAUDE.md, 2026-09-01). `pano.js`, the `panoramas`
-- table, and every `item_type = 'panorama'` branch in bim.js/module.js stay
-- in place, untouched and simply unreachable from the UI. Re-enabling the
-- feature later is a UI-only change (drop `disabled` on the two buttons);
-- this migration only clears the accumulated buggy captures, it does not
-- retire the feature at the schema level.
--
-- Three things reference a panorama and all three are cleaned up, in an
-- order that never leaves a dangling reference for even one statement:
--   1. floor_plan_pins  — a pin can point at a panorama (item_type='panorama').
--      Deleted FIRST: a pin pointing at an about-to-be-deleted panorama would
--      otherwise become an orphan the app has to degrade around forever,
--      when it could simply not exist.
--   2. storage.objects  — the stitched panorama JPEGs themselves, uploaded to
--      <project_id>/panoramas/<ts>_<rand>.jpg in the shared 'progress-photos'
--      bucket (pano.js's own BUCKET/upload-path constants). Deleted from the
--      row's own `pano_url` column so this can never drift from wherever the
--      app itself actually uploads to.
--   3. panoramas        — the rows themselves, last, once nothing points at
--      them and their files are gone.
--
-- ⚠️ Storage objects are removed via SQL against `storage.objects` directly
-- (Supabase Storage's metadata lives in this same Postgres database) rather
-- than the Storage HTTP API, which the SQL editor has no way to call —
-- exactly why the app's own `pano.js` uses that API instead, and why this
-- file uses SQL instead: whichever surface you're actually running from.
--
-- Idempotent: running this again when the table is already empty is a no-op.
-- ============================================================================

begin;

-- 1. Orphan-proof the pins first.
delete from floor_plan_pins
 where item_type = 'panorama';

-- 2. Remove the stitched panorama files from Storage.
delete from storage.objects
 where bucket_id = 'progress-photos'
   and name in (select pano_url from panoramas where pano_url is not null);

-- 3. Remove the panorama rows themselves.
delete from panoramas;

commit;
