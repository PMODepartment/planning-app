-- ============================================================================
-- A STAKEHOLDER IS A PERSON, NOT A ROW ON ONE PROJECT
-- 2026-09-08
--
-- THE PROBLEM THIS SOLVES (owner, 2026-09-08): "it would be very tedious to fill
-- this out for every stakeholder. Additionally, the stakeholders for each project
-- could be shared as well. If there is an existing stakeholder it should be able
-- to add it in the stakeholder map of the project."
--
-- `stakeholder_map` is one flat, PROJECT-SCOPED table of ~45 columns. Registering
-- the same City Mayor on a second project means re-typing their name, honorific,
-- nickname, position, institution, sector, group, e-mail, contact, birthday and
-- gift tier, and re-uploading their photograph -- twelve fields and a file that
-- have nothing to do with which project is being planned. Nothing links the two
-- rows, so correcting a misspelled name or a changed position fixes it on one
-- project and silently leaves it wrong on every other.
--
-- THE SPLIT. Two kinds of fact were living in one table:
--
--   GLOBAL, about the PERSON      -- true wherever they appear. Moves here.
--     name, title, nickname, role_title, organization, category (Sector),
--     stakeholder_group, email, contact, birthday, gift_tier, photo.
--
--   PROJECT-LEVEL, about the ENGAGEMENT  -- meaningless without a project.
--     Stays on `stakeholder_map`: the 5-PMLC activity and its process fields,
--     the risk-taxonomy category, Impact x Influence, the response, the costs,
--     the residual re-assessment, the audit plan, the engagement plan, the
--     Megawide counterpart, the relationship owner/champion, current/target
--     relationship, sort order.
--
-- ⚠️ ADD-ONLY, AND THE PERSON COLUMNS STAY ON `stakeholder_map`. They are not
--    dropped and they are not renamed. Three reasons, and the third is the one
--    that matters:
--      1. Every read path in the module -- the register table, the Cards view,
--         the CSV export, the offline cache, the live-collaboration cell paint --
--         reads `row.name` / `row.organization` directly. Dropping the columns
--         would mean rewriting all of them in the same commit as a schema change.
--      2. Rows that predate this migration have no link and must keep working
--         exactly as they do today.
--      3. The columns become a MIRROR of the directory, refreshed on read and on
--         write. `stakeholders` is the source of truth; the mirror is what keeps
--         an export and a dashboard tile correct without a join.
--
-- ⚠️ THE PHOTO PATH IS COPIED, NOT MOVED, AND NOTHING IS RE-UPLOADED. Objects
--    live at <project_id>/<ts>_<rand>_<name>.<ext> in the private
--    `stakeholder-photos` bucket, and that bucket's policies are deliberately NOT
--    project-scoped (see 2026-09-01-stakeholder-register-ops.sql) -- the gate is
--    the app's role check plus the fact that a path is only ever read off a row
--    RLS has already allowed. So a path minted under project A is readable when
--    the same person is shown on project B, and copying the path is sufficient.
--    Moving the object would break every row still pointing at the old key.
--
-- Run in the Supabase SQL editor. IDEMPOTENT -- safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) The directory
-- ---------------------------------------------------------------------------
create table if not exists stakeholders (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  title             text,          -- honorific / formal title ("Hon.", "Engr.")
  nickname          text,
  role_title        text,          -- position ("City Mayor")
  organization      text,          -- institution ("Quezon City LGU")
  category          text,          -- Sector: Government | Private
  stakeholder_group text,          -- LGU | NGA | GOCC | Partners | Consultants | ...
  email             text,
  contact           text,
  birthday          date,
  gift_tier         text,
  photo_path        text,          -- ⚠️ PATH, never a signed URL -- a stored one expires
  photo_thumb_path  text,
  notes             text,          -- about the PERSON; the engagement plan is per project
  created_by        uuid references users(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ⚠️ The de-duplication key is (name, organization), CASE-INSENSITIVELY and with
--    a NULL organization folded to ''. Two different people genuinely can share a
--    name across two institutions, and Postgres treats NULL as DISTINCT in a
--    unique index -- so without the coalesce, "Juan Santos / NULL" could be
--    inserted any number of times and the backfill below would stop being
--    idempotent. This is also what lets the module's "is this person already in
--    the directory?" check be an exact query rather than a fuzzy match.
create unique index if not exists stakeholders_name_org_uidx
  on stakeholders (lower(btrim(name)), lower(coalesce(btrim(organization), '')));

create index if not exists stakeholders_name_idx on stakeholders (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 2) The link
-- ---------------------------------------------------------------------------
-- ⚠️ `on delete set null`, NOT cascade. Deleting a person from the directory must
--    never delete a project's assessment of them -- that assessment is the
--    project's own record and may be the only trace that the engagement happened.
--    The row degrades to a legacy unlinked row, which the module already handles.
alter table stakeholder_map
  add column if not exists stakeholder_id uuid references stakeholders(id) on delete set null;

create index if not exists stakeholder_map_stakeholder_idx
  on stakeholder_map (stakeholder_id);

-- ---------------------------------------------------------------------------
-- 3) RLS
-- ---------------------------------------------------------------------------
-- The directory is a GLOBAL master, so it follows the shape the other global
-- masters in this schema already use (`workspaces`, `activity_code_types`):
-- everyone approved may READ it, and writing is gated on role, not on a project.
--
-- ⚠️ WRITE is is_writer(), not is_planner(). A directory only a planner can add to
--    sends every engineer who meets a new counterpart back to a planner to get
--    the person created, which is exactly the friction this migration exists to
--    remove. is_writer() is "approved and not a viewer" -- the same gate that
--    already lets that person create the project row they are about to link.
-- ⚠️ DELETE is is_planner(). Removing a person affects every project they appear
--    on, so it is not the same privilege as adding one.
alter table stakeholders enable row level security;

do $$
begin
  if to_regprocedure('public.is_writer()') is null then
    raise exception 'is_writer() is missing - run migrations/2026-07-21-viewer-readonly.sql first';
  end if;
  if to_regprocedure('public.is_planner()') is null then
    raise exception 'is_planner() is missing - run migrations/2026-06-30-workspaces-project-selector.sql first';
  end if;
end $$;

drop policy if exists stakeholders_read on stakeholders;
create policy stakeholders_read on stakeholders
  for select using (is_approved());

drop policy if exists stakeholders_ins on stakeholders;
create policy stakeholders_ins on stakeholders
  for insert with check (is_writer() and created_by = auth.uid());

-- ⚠️ No `created_by = auth.uid()` on UPDATE, deliberately. A shared directory that
--    only its creator may correct is not shared. The trail is `updated_at` plus
--    the app's own history, not a lock.
drop policy if exists stakeholders_upd on stakeholders;
create policy stakeholders_upd on stakeholders
  for update using (is_writer()) with check (is_writer());

drop policy if exists stakeholders_del on stakeholders;
create policy stakeholders_del on stakeholders
  for delete using (is_planner());

-- ---------------------------------------------------------------------------
-- 4) Backfill -- every person already on a register becomes a directory entry
-- ---------------------------------------------------------------------------
-- ⚠️ ONE ROW PER (name, organization), assembled from the MOST COMPLETE values
--    across that person's existing project rows rather than from an arbitrary
--    one. A mayor entered fully on one project and name-only on another must end
--    up with the full record; picking "the first row" would lose fields at
--    random. Hence max() over NULLIF-blanked values: it prefers any non-null
--    value, and where two rows genuinely disagree it takes the lexicographically
--    greater one -- arbitrary, but deterministic and therefore re-runnable.
-- ⚠️ Rows with a blank name are SKIPPED rather than given an empty entry:
--    `name` is `not null` here, and a nameless stakeholder is a data-entry
--    accident, not a person. They stay unlinked and keep working as legacy rows.
-- ⚠️ The THUMBNAIL is taken from the same row as the full-size path, not by an
--    independent max(). Two independent maxes can pair project A's photo with
--    project B's thumbnail -- two different pictures of the same person, and the
--    Cards view would show one while the lightbox showed the other.
insert into stakeholders (
  name, title, nickname, role_title, organization, category, stakeholder_group,
  email, contact, birthday, gift_tier, photo_path, photo_thumb_path, created_by
)
select
  btrim(sm.name),
  max(nullif(btrim(sm.title), '')),
  max(nullif(btrim(sm.nickname), '')),
  max(nullif(btrim(sm.role_title), '')),
  max(nullif(btrim(sm.organization), '')),
  max(nullif(btrim(sm.category), '')),
  max(nullif(btrim(sm.stakeholder_group), '')),
  max(nullif(btrim(sm.email), '')),
  max(nullif(btrim(sm.contact), '')),
  max(sm.birthday),
  max(nullif(btrim(sm.gift_tier), '')),
  (array_agg(nullif(btrim(sm.photo_path), '')
     order by nullif(btrim(sm.photo_path), '') desc nulls last))[1],
  (array_agg(nullif(btrim(sm.photo_thumb_path), '')
     order by nullif(btrim(sm.photo_path), '') desc nulls last))[1],
  max(sm.created_by)
from stakeholder_map sm
where coalesce(btrim(sm.name), '') <> ''
group by lower(btrim(sm.name)), lower(coalesce(btrim(sm.organization), '')), btrim(sm.name)
on conflict (lower(btrim(name)), lower(coalesce(btrim(organization), ''))) do nothing;

-- Link every project row to its person.
update stakeholder_map sm
   set stakeholder_id = s.id
  from stakeholders s
 where sm.stakeholder_id is null
   and coalesce(btrim(sm.name), '') <> ''
   and lower(btrim(sm.name)) = lower(btrim(s.name))
   and lower(coalesce(btrim(sm.organization), '')) = lower(coalesce(btrim(s.organization), ''));

-- ---------------------------------------------------------------------------
-- 5) What the migration actually did -- READ THIS OUTPUT, do not assume
-- ---------------------------------------------------------------------------
do $$
declare
  people int; linked int; unlinked int; multi int;
begin
  select count(*) into people from stakeholders;
  select count(*) into linked   from stakeholder_map where stakeholder_id is not null;
  select count(*) into unlinked from stakeholder_map where stakeholder_id is null;
  select count(*) into multi from (
    select stakeholder_id from stakeholder_map
     where stakeholder_id is not null
     group by stakeholder_id having count(distinct project_id) > 1) t;
  raise notice 'stakeholders directory: % people', people;
  raise notice 'stakeholder_map: % rows linked, % still unlinked (blank name)', linked, unlinked;
  raise notice 'people already appearing on more than one project: %', multi;
end $$;
