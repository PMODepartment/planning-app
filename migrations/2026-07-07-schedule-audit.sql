-- ============================================================================
-- Migration: schedule change audit trail. One row per change event (who changed
-- which activity, which fields from→to, and when). Insert-only for planners;
-- approved users can read. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create table if not exists schedule_audit (
  id            uuid primary key default gen_random_uuid(),
  project_id    text,
  activity_pk   uuid,          -- project_schedule.id (may be null for bulk events)
  activity_id   text,          -- human Activity ID
  activity_name text,
  action        text,          -- 'update' | 'insert' | 'delete' | 'reschedule'
  changes       jsonb,         -- { field: { from, to } }  (or { count } for bulk)
  changed_by    uuid,
  changed_at    timestamptz default now()
);

create index if not exists schedule_audit_project_idx on schedule_audit (project_id, changed_at desc);

alter table schedule_audit enable row level security;

drop policy if exists schedule_audit_read on schedule_audit;
create policy schedule_audit_read on schedule_audit for select using (is_approved());

-- Insert-only (audit rows are immutable) — planners/admins write.
drop policy if exists schedule_audit_write on schedule_audit;
create policy schedule_audit_write on schedule_audit for insert with check (is_planner());

grant select, insert on schedule_audit to authenticated;
