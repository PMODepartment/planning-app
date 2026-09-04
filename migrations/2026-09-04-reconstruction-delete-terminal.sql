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
