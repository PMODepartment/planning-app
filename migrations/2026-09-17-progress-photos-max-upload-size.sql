-- ============================================================================
-- Migration: Explicit max upload size for the `progress-photos` Storage
-- bucket. Run in the Supabase SQL editor. Idempotent.
--
-- ⚠️⚠️ WHY THIS EXISTS: `storage.buckets.file_size_limit` was never set for
-- this bucket (migrations/2026-06-18-storage-buckets.sql only sets
-- id/name/public) -- it has therefore always been NULL, which means every
-- upload was silently governed by whatever this PROJECT's own global
-- "Max upload size" setting happens to be (Dashboard -> Project Settings ->
-- Storage), a value nothing in this repo can read or verify. A real capture
-- (DJI_0594.MP4, 2.20 GB) hit that invisible ceiling and failed with the
-- storage server's own raw message, "The object exceeded the maximum
-- allowed size" -- surfaced to the planner unchanged, with no client-side
-- warning beforehand (see modules/progress-photos/module.js's MAX_UPLOAD_
-- BYTES comment for the client-side half of this fix).
--
-- This sets an EXPLICIT, known, in-repo limit instead of an invisible
-- platform default -- 5 GiB, chosen so the reported 2.20 GB capture (and
-- similar or somewhat longer walkthrough recordings) succeeds with
-- headroom, while still bounding how large a single object this project
-- will store. Keep this number in lock-step with `MAX_UPLOAD_BYTES` in
-- module.js -- that constant exists specifically so the client can refuse
-- an oversized file BEFORE spending any upload bandwidth on it, and the two
-- numbers disagreeing would mean the client either wrongly refuses a file
-- the server would have accepted, or wrongly promises success on a file the
-- server is about to reject anyway.
--
-- ⚠️ This does NOT by itself make a 5 GiB upload reliable over one HTTP
-- request -- that is what the client's new resumable (TUS) upload path is
-- for (files at/above 6 MB now upload in 6 MB chunks via Supabase Storage's
-- own built-in `/storage/v1/upload/resumable` endpoint, subject to this
-- SAME file_size_limit and the SAME RLS policies as a plain upload -- no
-- Edge Function or other backend change was needed for this, confirmed by
-- driving a real (RLS-refused, so no object was actually created) request
-- against the live project from a throwaway harness before this migration
-- was written).
-- ============================================================================

update storage.buckets
   set file_size_limit = 5368709120   -- 5 GiB = 5 * 1024^3 bytes
 where id = 'progress-photos';

-- Nothing to verify via migrations/VERIFY-schema.sql -- that generator only
-- tracks tables/columns/functions, never storage.buckets configuration.
