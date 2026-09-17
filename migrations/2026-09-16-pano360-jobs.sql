-- ============================================================================
-- Migration: 2026-09-16 — Server-side 360° stitching (pano360_jobs)
-- Idempotent. Run in the Supabase SQL editor, then fold into supabase-schema.sql.
-- ============================================================================
--
-- WHY THIS EXISTS
-- Progress Photos' 360° capture used to stitch the panorama IN THE BROWSER
-- (OpenCV.js/WASM, see modules/progress-photos/pano360.js) and held the whole
-- draft — including the raw recorded video — only in that tab's own memory
-- and IndexedDB. On iOS Safari specifically, a home-screen "Add to Home
-- Screen" shortcut gets a separate, more aggressively evicted storage
-- context, `beforeunload` does not fire on an app-switcher kill, and iOS can
-- silently discard and reload a memory-heavy backgrounded tab even without an
-- explicit close — so a several-minutes-long in-browser stitch had no way to
-- survive the planner switching apps or letting the screen lock. That is a
-- real platform limitation, not a bug in this app's own code (see this
-- module's own CLAUDE.md, 2026-09-14/15 entries).
--
-- The fix: the browser's job shrinks to "extract frames, upload them, insert
-- one row" — seconds of work, done before anything can be lost — and the
-- actual stitching runs HERE, server-side, entirely within this same free
-- Supabase project. No new paid service. See
-- supabase/functions/pano360-process/index.ts for the worker itself.
--
-- ⚠️⚠️ THE 2-SECOND-CPU-PER-INVOCATION CAP IS WHY THIS IS A JOB QUEUE, NOT ONE
-- FUNCTION CALL. Supabase Edge Functions cap ACTIVE CPU TIME at ~2000ms per
-- invocation regardless of plan (this is a platform limit, not a quota that
-- money raises) — wall-clock time is a separate, much larger budget (150s
-- free / 400s paid), and network I/O (downloading a frame from Storage)
-- doesn't count against the CPU cap at all. So `pano360-process` is written
-- to do exactly ONE bounded step per invocation (align one pair of frames, or
-- paste one small batch of frames into the growing composite) and then
-- re-invoke itself for the next step — a self-chaining, resumable job, driven
-- entirely by this table plus the two mechanisms below. A single invocation
-- attempting all ~47 frame-pairs of a real capture in one call would very
-- plausibly exceed the CPU cap on a cold isolate; chunking removes that risk
-- rather than gambling on it fitting.
--
-- HOW A JOB IS DRIVEN FORWARD (no client polling, no manual dashboard step)
-- Both mechanisms below call the SAME `pano360_invoke(job_id)` helper, so
-- there is exactly one implementation of "how to wake the worker for job X":
--   1. SELF-CHAIN (the normal path, fires within moments): a trigger on
--      INSERT fires the first step; the worker's own last action in every
--      invocation that leaves work remaining is to call `pano360_invoke`
--      again for the same job, via `net.http_post` (the `pg_net` extension —
--      an ASYNC, non-blocking Postgres-level HTTP call, so scheduling the
--      next step costs the current invocation nothing and never risks the
--      2-second cap itself). `net.http_post` schedules the request and
--      returns immediately; pg_net's own background worker actually sends it
--      moments later, off the calling transaction entirely.
--   2. CRON SAFETY NET (self-healing, fires within ~90s of a stall): a
--      `pg_cron` job runs every minute and re-invokes any job whose status is
--      still active but hasn't been touched in 90+ seconds — the only way a
--      self-chain can silently die is one invocation's own `pano360_invoke`
--      call failing to fire (a crash, a network blip inside Postgres/pg_net
--      itself), and this sweep recovers from exactly that without anyone
--      noticing it happened. It is NOT the primary driver — it is a backstop,
--      capped by `attempts` so a systematically broken job cannot retry
--      forever.
-- Both are free — pg_net and pg_cron are plain Postgres extensions with no
-- separate billing, matching this project's existing "free, real
-- infrastructure, no new paid service" constraint.
--
-- ⚠️⚠️ ONE MANUAL, ONE-TIME STEP THAT NO MIGRATION CAN DO FOR YOU: this SQL
-- file cannot know your project's own Function URL or service-role key — both
-- are project-specific secrets. After running this migration AND deploying
-- `pano360-process` (`supabase functions deploy pano360-process --project-ref
-- <ref>`), run, once, in the SQL editor:
--
--   select vault.create_secret(
--     'https://<your-project-ref>.supabase.co/functions/v1/pano360-process',
--     'pano360_function_url', 'Edge Function URL for 360 stitching');
--   select vault.create_secret(
--     '<your service_role key, from Project Settings -> API>',
--     'pano360_service_key', 'Service role key for pano360-process self-invocation');
--
-- Stored in Supabase Vault (encrypted at rest, readable only by a
-- `security definer` function running as the table owner / by `service_role`)
-- rather than a plain table, for the same reason this repo never writes a
-- provider key into two places (see the pormac-chat entries below in
-- CLAUDE.md) — Vault is the one place this secret lives.
-- ⚠️ UNTIL THAT RUNS, `pano360_invoke` is a documented, deliberate no-op (see
-- below) — every job you insert sits at `status='queued'` forever, and the
-- INSERT itself still succeeds (the client's "upload frames, insert a row"
-- step never depends on the worker existing yet). Once the two secrets are
-- created, run `select pano360_sweep_stuck_jobs();` ONCE by hand to wake any
-- jobs that queued up in the meantime — the cron sweep would otherwise reach
-- them within a minute anyway, so this is a convenience, not a requirement.
--
-- ⚠️ pg_net / pg_cron MAY NOT BE ENABLED ON EVERY PROJECT BY DEFAULT. Both
-- `create extension` statements below are unconditional and should succeed
-- for a project owner running this in the SQL editor (Supabase grants the
-- privileges needed for these two specific extensions to the project owner
-- role) — but if either is blocked by your plan/organisation policy, enable
-- it via Dashboard -> Database -> Extensions and re-run this file; it is
-- fully idempotent. The pg_cron portion is additionally wrapped in its own
-- exception handler (see below) so a pg_cron failure alone can never abort
-- the rest of this migration — the self-chain mechanism (pg_net + the
-- trigger) is the one piece this feature cannot work without at all.
-- ============================================================================

create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1) The job table itself
-- ----------------------------------------------------------------------------
create table if not exists pano360_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null references projects(id),
  created_by      uuid not null default auth.uid() references users(id),

  -- 'queued' (row just inserted, nothing has run yet)
  -- -> 'aligning' (computing one frame-to-frame offset per invocation)
  -- -> 'compositing' (pasting frames into the final image, chunked the same way)
  -- -> 'done' | 'failed' | 'cancelled' (terminal — nothing drives these forward)
  status          text not null default 'queued'
                    check (status in ('queued','aligning','compositing','done','failed','cancelled')),

  -- Storage paths of the extracted frames (progress-photos bucket), IN ORDER —
  -- the client already extracts frames client-side (fast, no WASM stitching)
  -- and uploads them before this row is ever inserted; the worker only ever
  -- reads from Storage, it never receives the original video.
  frame_paths     text[] not null,
  frame_count     int not null,

  -- Meaning depends on `status`: during 'aligning', the index of the NEXT
  -- frame pair to align (0 means align frame_paths[0] with frame_paths[1]);
  -- during 'compositing', the index of the NEXT frame still to be pasted onto
  -- the growing composite. Always the single source of truth for "how far
  -- along is this job", so a self-chained or cron-woken invocation can always
  -- tell exactly where to resume without re-deriving it from anything else.
  step_cursor     int not null default 0,

  -- One entry per aligned frame pair, appended to as 'aligning' progresses:
  -- {dx, dy, score, fallback}. `fallback:true` means no confident match was
  -- found for that pair and a plain horizontal shift was assumed instead —
  -- the exact same honesty this app's client-side pipeline already reports
  -- via `pairsTotal`/`pairsFallback` (pano360.js), continued here so the
  -- eventual client UI can reuse the identical wording.
  offsets         jsonb not null default '[]'::jsonb,
  pairs_total     int,
  pairs_fallback  int not null default 0,

  -- The in-progress composite's own bookkeeping — a raw (uncompressed) pixel
  -- buffer stored in the SAME bucket under this job's own prefix, downloaded,
  -- extended by a few frames, and re-uploaded each 'compositing' invocation.
  -- Kept out of this row (it can be megabytes) — this column only ever holds
  -- {storagePath, width, height} pointing at it.
  composite_state jsonb,

  result_path     text,   -- Storage path of the finished stitched JPEG
  thumb_path      text,   -- Storage path of a 4:3 thumbnail cropped from it
  quality         text,   -- 'ok' | 'poor' — set once 'compositing' finishes

  progress_pct    numeric not null default 0,
  progress_msg    text,
  error           text,

  -- Bumped on every invocation (self-chained or cron-woken) — the cron
  -- sweep's own runaway-cost guard, see pano360_sweep_stuck_jobs() below.
  attempts        int not null default 0,

  -- Capture metadata carried straight through from the client's draft, so
  -- Confirm & Save (client-side, once status='done') can build the final
  -- progress_photos row from THIS row alone with no second round trip to ask
  -- "what was this capture even for": {desc, date, works, locVals, viewName,
  -- tags, pinData} — the same shape the pre-existing in-browser draft object
  -- already carried in `draft.meta` (module.js), continued here unchanged.
  meta            jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pano360_jobs_proj_idx
  on pano360_jobs (project_id, created_at desc);
create index if not exists pano360_jobs_active_idx
  on pano360_jobs (status, updated_at)
  where status in ('queued', 'aligning', 'compositing');

alter table pano360_jobs enable row level security;

-- READ: same transparency rule as every other register in this app — anyone
-- who can see the project can see its 360° jobs (so a planner can find their
-- own in-flight capture from a different tab/device, and a teammate can see
-- one is running), matching progress_photos' own visibility rule.
drop policy if exists pano360_jobs_read on pano360_jobs;
create policy pano360_jobs_read on pano360_jobs
  for select using (can_access_project(project_id));

-- INSERT: any project writer, but only ever starting at 'queued' with a
-- step_cursor of 0 and no progress already claimed — the same "cannot insert
-- a pre-approved/pre-finished row" shape reconstruction_requests already
-- established (see that migration's own comment on this exact pattern).
drop policy if exists pano360_jobs_ins on pano360_jobs;
create policy pano360_jobs_ins on pano360_jobs
  for insert with check (
    is_writer() and created_by = auth.uid() and can_access_project(project_id)
    and status = 'queued' and step_cursor = 0
  );

-- UPDATE: the ONLY thing an ordinary client is ever allowed to do to a job
-- row directly is cancel it. Every real progress write (offsets, cursor,
-- composite_state, result/thumb paths, status transitions past 'queued') is
-- made by the worker using the service-role key, which bypasses RLS
-- entirely — matching the reconstruction_requests / reconstruction-webhook
-- precedent, where only the trusted server-side path can move a job forward.
-- ⚠️⚠️ Column-level GRANT is what actually enforces "status only" — a
-- `using`/`with check` pair alone cannot stop an authenticated client from
-- writing to OTHER columns of a row they otherwise have UPDATE rights to; it
-- can only gate WHICH ROWS and WHAT VALUES land in whichever columns the
-- GRANT already allows them to touch. Without narrowing the grant, a crafted
-- REST call could set `result_path` to an attacker-controlled Storage path
-- and have Confirm & Save (client-side) copy it into a permanent
-- progress_photos row. See the REVOKE/GRANT pair directly below.
drop policy if exists pano360_jobs_upd on pano360_jobs;
create policy pano360_jobs_upd on pano360_jobs
  for update
  using (
    (created_by = auth.uid() or is_admin())
    and status in ('queued', 'aligning', 'compositing')
  )
  with check (
    (created_by = auth.uid() or is_admin())
    and status = 'cancelled'
  );

revoke update on pano360_jobs from authenticated;
grant update (status) on pano360_jobs to authenticated;

-- DELETE: the owner or an admin may remove a job once it is no longer active
-- — never a queued/aligning/compositing one, or the row a chained invocation
-- is about to read/write out from under it would simply vanish mid-run.
drop policy if exists pano360_jobs_del on pano360_jobs;
create policy pano360_jobs_del on pano360_jobs
  for delete using (
    (created_by = auth.uid() or is_admin())
    and status in ('done', 'failed', 'cancelled')
  );

-- ----------------------------------------------------------------------------
-- 2) The one place that knows how to wake the worker for a given job
-- ----------------------------------------------------------------------------
-- `security definer` so it can read the Vault secrets (only the table owner /
-- service_role can) regardless of who/what calls it — the trigger below, the
-- cron sweep below, and the worker's OWN self-chain call (via
-- `admin.rpc('pano360_invoke', {p_job_id})`) all go through this one
-- function, so there is exactly one implementation of "how to invoke
-- pano360-process for job X" to ever get wrong.
create or replace function pano360_invoke(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'pano360_function_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pano360_service_key';

  -- ⚠️ A DELIBERATE, DOCUMENTED NO-OP, not an error — see the migration's own
  -- header. Until the owner runs the two `vault.create_secret` calls (which
  -- this file cannot do on their behalf, since it doesn't know their project
  -- ref or service key), every job simply stays 'queued'. The INSERT that
  -- creates it must still succeed either way, which is why this is silent
  -- rather than `raise exception`.
  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('job_id', p_job_id)
  );
end;
$$;

grant execute on function pano360_invoke(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3) Trigger: fire the first step the instant a job is inserted
-- ----------------------------------------------------------------------------
create or replace function pano360_jobs_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'queued' then
    perform pano360_invoke(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists pano360_jobs_notify on pano360_jobs;
create trigger pano360_jobs_notify
  after insert on pano360_jobs
  for each row execute function pano360_jobs_after_insert();

-- ----------------------------------------------------------------------------
-- 4) Cron safety net — re-wakes a job whose self-chain silently died
-- ----------------------------------------------------------------------------
-- ⚠️⚠️ `attempts` is the runaway-cost guard. Every real invocation does a
-- SMALL, bounded amount of work (one frame pair, or a small composite batch)
-- regardless of how many times it's woken, so even a systematically broken
-- job (e.g. one whose frames were deleted from Storage) costs at most 200
-- cheap invocations before this sweep gives up on it — the worker itself
-- (see pano360-process/index.ts) also marks a job 'failed' outright on any
-- caught error, so `attempts` capping out is the LAST resort, not the normal
-- failure path.
create or replace function pano360_sweep_stuck_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select id from pano360_jobs
    where status in ('queued', 'aligning', 'compositing')
      and updated_at < now() - interval '90 seconds'
      and attempts < 200
    order by updated_at asc
    limit 25
  loop
    update pano360_jobs set attempts = attempts + 1, updated_at = now() where id = r.id;
    perform pano360_invoke(r.id);
  end loop;

  -- A job that has been retried past the cap is not "still running" by any
  -- honest reading — mark it failed with a real, named reason rather than
  -- leaving it silently stuck at 'aligning'/'compositing' forever, which
  -- would read to a planner as "still processing" indefinitely.
  update pano360_jobs
  set status = 'failed',
      error = 'Stopped after ' || attempts || ' retries with no progress — the frame files may be missing from storage.',
      updated_at = now()
  where status in ('queued', 'aligning', 'compositing') and attempts >= 200;
end;
$$;

grant execute on function pano360_sweep_stuck_jobs() to service_role, postgres;

-- ⚠️ Wrapped so a pg_cron failure (extension not permitted on this
-- plan/organisation, or already scheduled under a different owner) cannot
-- abort the self-chain mechanism above, which is fully functional without
-- this. Re-run this file after enabling pg_cron via the Dashboard if this
-- block warns.
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.unschedule('pano360-sweep') where exists (
    select 1 from cron.job where jobname = 'pano360-sweep'
  );
  perform cron.schedule('pano360-sweep', '* * * * *', 'select pano360_sweep_stuck_jobs();');
exception when others then
  raise notice 'pano360-jobs: could not schedule the pg_cron safety net (%). Self-chaining via pg_net still works on its own; enable pg_cron via Dashboard -> Database -> Extensions and re-run this file to add the safety net.', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- Storage: no new bucket, no new storage policy. Frames/composite/result all
-- live in the EXISTING `progress-photos` bucket (migrations/2026-06-18-
-- storage-buckets.sql), under `<project_id>/pano360-jobs/<job_id>/...` — that
-- bucket's existing policies already let any approved user read/insert any
-- object in it, and the worker's service-role key bypasses Storage RLS
-- entirely, exactly like every other bucket in this app.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- VERIFY (run as a single statement — the SQL editor only shows the LAST
-- statement's result; see this repo's own repeated note on that trap).
-- ============================================================================
-- select
--   (select count(*) from information_schema.columns
--     where table_name = 'pano360_jobs' and column_name = 'step_cursor') as has_step_cursor,
--   (select count(*) from pg_trigger where tgname = 'pano360_jobs_notify') as has_trigger,
--   (select count(*) from pg_proc where proname = 'pano360_invoke') as has_invoke_fn,
--   (select count(*) from pg_proc where proname = 'pano360_sweep_stuck_jobs') as has_sweep_fn,
--   (select count(*) from vault.decrypted_secrets where name in ('pano360_function_url','pano360_service_key')) as vault_secrets_set,
--   (select count(*) from cron.job where jobname = 'pano360-sweep') as cron_scheduled;
