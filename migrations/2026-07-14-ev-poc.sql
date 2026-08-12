-- Project Schedule: separate Earned Value (physical) POC, independent of the schedule Duration POC
-- (percent_complete). ev_poc is informational/physical progress and does NOT drive dates.
alter table public.project_schedule
  add column if not exists ev_poc numeric(6,2);

comment on column public.project_schedule.percent_complete is 'Duration POC (%) — schedule progress; drives remaining duration + forecast finish.';
comment on column public.project_schedule.ev_poc is 'Earned Value POC (%) — physical/earned-value progress; informational, does not drive dates.';
