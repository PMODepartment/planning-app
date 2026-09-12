-- Pormac — in-browser AI assistant module ------------------------------------
-- ============================================================================
-- Adds the tables behind the new `pormac` module: an AI chat assistant that
-- runs inference IN THE BROWSER (WebLLM/WebGPU) so the module costs nothing to
-- operate, with a server-side hosted-model fallback for devices that cannot
-- run it locally (see supabase/functions/pormac-chat).
--
-- ⚠️⚠️ THIS DOES NOT GIVE PORMAC LIVE ACCESS TO THE PROCUREMENT (WPM) OR
-- ENGINEERING APP DATABASES, AND THAT IS DELIBERATE, NOT A GAP TO FILL LATER
-- BY QUERYING THEM DIRECTLY. Those are separate Supabase projects with their
-- own auth — a Planners-app user has no session there, so a browser-side call
-- to either would run as an anonymous stranger against another department's
-- database, gated only by their RLS for the `anon` role (which should refuse
-- it; if it didn't, that would be a leak in THEIR app, not a feature in this
-- one). MODULE_CONTRACT.md §5 already states the rule for modules inside this
-- one app — "cross-module data comes later, through the main app owner" — and
-- it applies with MORE force across genuinely separate applications.
--
-- What Pormac actually reads for procurement/engineering context is the
-- MIRRORS THIS APP ALREADY MAINTAINS for exactly this reason:
--   wpm_work_packages / wpm_vendors  — synced from WPM by supabase/functions/sync-wpm
--   eng_design_progress              — synced from Engineering by supabase/functions/sync-eng
-- Both are read under this app's OWN RLS, by the user's own session, exactly
-- like Cash Flow and the Schedule's Design Development branch already do. They
-- are as-of-last-sync, not live — Pormac's answers say so wherever it cites
-- them (see module.js `CONTEXT_PROVIDERS`), the same honesty the sync-eng
-- function itself insists on for its own consumers.
--
-- Idempotent; safe to re-run.
-- ============================================================================

-- ---- Access control: "open to all" vs "selected users" ---------------------
-- A single settings row (never more than one — enforced by the check on `id`)
-- an admin flips between the two modes. Default is 'selected' with an EMPTY
-- allow-list — i.e. admin/super_admin only — until an admin deliberately opens
-- it wider, the same safe-by-default posture new modules ship with
-- (`enabled:false` / `superAdminOnly:true`) rather than defaulting to "open".
create table if not exists pormac_settings (
  id            smallint primary key default 1,
  access_mode   text not null default 'selected' check (access_mode in ('all', 'selected')),
  updated_by    uuid references users(id),
  updated_at    timestamptz default now(),
  constraint pormac_settings_singleton check (id = 1)
);
insert into pormac_settings (id) values (1) on conflict (id) do nothing;

create table if not exists pormac_allowed_users (
  user_id     uuid primary key references users(id) on delete cascade,
  added_by    uuid references users(id),
  added_at    timestamptz default now()
);

-- Helper: may the current user talk to Pormac at all? Admin/super_admin always
-- can (so they can never lock themselves out while configuring it); everyone
-- else needs either access_mode='all' or a row in the allow-list. Mirrors the
-- shape of is_admin()/is_writer() elsewhere in this file.
create or replace function pormac_can_use() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    where u.id = auth.uid() and u.status = 'approved'
      and (
        u.role in ('admin', 'super_admin')
        or (select access_mode from pormac_settings where id = 1) = 'all'
        or exists (select 1 from pormac_allowed_users a where a.user_id = auth.uid())
      )
  );
$$;
grant execute on function pormac_can_use() to authenticated;

grant select, insert, update on pormac_settings to authenticated;
alter table pormac_settings enable row level security;
drop policy if exists pormac_settings_read on pormac_settings;
create policy pormac_settings_read on pormac_settings for select using (is_approved());
drop policy if exists pormac_settings_write on pormac_settings;
create policy pormac_settings_write on pormac_settings for update
  using (is_admin()) with check (is_admin());
-- No insert policy beyond the seeded row above: the singleton is created once
-- by this migration, never by the app.

grant select, insert, delete on pormac_allowed_users to authenticated;
alter table pormac_allowed_users enable row level security;
drop policy if exists pormac_allowed_users_read on pormac_allowed_users;
-- A non-admin may see their OWN row (so the settings screen can honestly say
-- "you personally have access") but never the whole list.
create policy pormac_allowed_users_read on pormac_allowed_users for select
  using (is_admin() or user_id = auth.uid());
drop policy if exists pormac_allowed_users_write on pormac_allowed_users;
create policy pormac_allowed_users_write on pormac_allowed_users for insert
  with check (is_admin());
drop policy if exists pormac_allowed_users_del on pormac_allowed_users;
create policy pormac_allowed_users_del on pormac_allowed_users for delete
  using (is_admin());

-- ---- Chat history ------------------------------------------------------
-- Deliberately NOT folded into the generic module-table RLS loop further up
-- this file: every other module table there is a shared team record (anyone
-- with project access reads every row); a chat transcript is personal, so it
-- is gated on OWNERSHIP first and project access second, plus the
-- pormac_can_use() feature gate neither of those tables carry.
create table if not exists pormac_conversations (
  id            uuid primary key default gen_random_uuid(),
  project_id    text references projects(id),
  title         text,
  created_by    uuid references users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_pormac_conv_owner on pormac_conversations (created_by, updated_at desc);

create table if not exists pormac_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references pormac_conversations(id) on delete cascade,
  role              text not null check (role in ('user', 'assistant', 'system')),
  content           text not null,
  -- Which inference tier answered ('local-full' | 'local-lite' | 'remote'), and
  -- which context providers were pulled into the prompt (e.g. {schedule,risk}) —
  -- shown back to the planner under the reply so it is never a black box about
  -- what data an answer is grounded in. Both null for a plain 'user' message.
  model_tier        text,
  context_used      text[],
  created_at        timestamptz default now()
);
create index if not exists idx_pormac_msg_conv on pormac_messages (conversation_id, created_at);

grant select, insert, update, delete on pormac_conversations to authenticated;
grant select, insert on pormac_messages to authenticated;

alter table pormac_conversations enable row level security;
drop policy if exists pormac_conv_read on pormac_conversations;
create policy pormac_conv_read on pormac_conversations for select
  using (pormac_can_use() and (created_by = auth.uid() or is_admin()));
drop policy if exists pormac_conv_ins on pormac_conversations;
create policy pormac_conv_ins on pormac_conversations for insert
  with check (pormac_can_use() and created_by = auth.uid() and (project_id is null or can_access_project(project_id)));
drop policy if exists pormac_conv_upd on pormac_conversations;
create policy pormac_conv_upd on pormac_conversations for update
  using (pormac_can_use() and created_by = auth.uid())
  with check (pormac_can_use() and created_by = auth.uid());
drop policy if exists pormac_conv_del on pormac_conversations;
create policy pormac_conv_del on pormac_conversations for delete
  using (pormac_can_use() and created_by = auth.uid());

alter table pormac_messages enable row level security;
drop policy if exists pormac_msg_read on pormac_messages;
create policy pormac_msg_read on pormac_messages for select
  using (pormac_can_use() and exists (
    select 1 from pormac_conversations c
    where c.id = conversation_id and (c.created_by = auth.uid() or is_admin())
  ));
drop policy if exists pormac_msg_ins on pormac_messages;
create policy pormac_msg_ins on pormac_messages for insert
  with check (pormac_can_use() and exists (
    select 1 from pormac_conversations c
    where c.id = conversation_id and c.created_by = auth.uid()
  ));
-- No update/delete on messages: a transcript is append-only, same as every
-- other audit-shaped log in this app.

-- ---- Remote-tier usage (soft daily cap, per user) ---------------------
-- The hosted fallback (supabase/functions/pormac-chat) spends a SHARED free
-- quota on a provider like Groq. Without a cap, one user on an unsupported
-- device could exhaust it for the whole org. Written ONLY by the Edge
-- Function (service role, bypasses RLS) — never by the browser, so a planner
-- cannot reset their own counter.
create table if not exists pormac_usage (
  user_id       uuid not null references users(id),
  day           date not null default current_date,
  remote_calls  int not null default 0,
  primary key (user_id, day)
);
alter table pormac_usage enable row level security;
grant select on pormac_usage to authenticated;
drop policy if exists pormac_usage_read on pormac_usage;
create policy pormac_usage_read on pormac_usage for select
  using (user_id = auth.uid() or is_admin());
-- No write policy for authenticated — see comment above.

-- ROLLBACK --------------------------------------------------------------
-- drop table if exists pormac_usage;
-- drop table if exists pormac_messages;
-- drop table if exists pormac_conversations;
-- drop table if exists pormac_allowed_users;
-- drop table if exists pormac_settings;
-- drop function if exists pormac_can_use();
