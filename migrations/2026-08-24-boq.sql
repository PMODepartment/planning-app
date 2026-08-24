-- ============================================================================
-- Migration: BOQ — the client's Bill of Quantities, its class-code mapping,
--            its allocation to schedule activities, and its billing periods.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Implements ROADMAP B1a + B1b + B1c + B1d. Design note: docs/boq-and-pmi.md —
-- every ⚠️ below is a measured finding from the real OPW101 Package 2 workbook
-- (10 sheets, 1,215 priced lines, 5 billing sheets), not a guess.
--
-- WHY THE BOQ AND NOT project_schedule.quantity
--   docs/vendor-performance-chain.md decision #1: the BOQ is the source of
--   planned quantity. A `quantity` column on the activity would make a THIRD
--   place quantities live (client BOQ, allocation, activity) with nothing
--   keeping them in step — and the activity copy is the one everybody reads.
--   An activity's quantity is DERIVED from its allocations (view at the foot).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) boq_revisions — the document, and which revision superseded which
-- ---------------------------------------------------------------------------
-- ⚠️ Revisions are the NORMAL case, not an edge case: the real file is
--    "rev.05 - commented 250925" with a PO issued against it a month later.
create table if not exists boq_revisions (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null references projects(id) on delete cascade,
  rev_no          text not null,                  -- the client's own label: '05', 'rev.05', 'R2'
  issued_date     date,
  source_file     text,                           -- the workbook this came from, verbatim
  sheet_inventory jsonb default '{}'::jsonb,       -- {sheet: {lines, headings, role}} from the import preview
  -- The sheet's / Summary's own STATED contract total. Kept so the reconciliation
  -- gate (§4.5 trap 5) has something authoritative to refuse against, and so a
  -- later revision can be reconciled back to the bid.
  contract_total  numeric,
  po_no           text,
  -- ⚠️ A revision is superseded, never edited away. is_current marks which one
  --    the module reads by default; the prior rows stay readable forever,
  --    because every claim argument turns on what was tendered.
  is_current      boolean not null default true,
  notes           text,
  created_by      uuid references users(id),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Case-insensitive: 'rev.05' and 'REV.05' are one revision to a human, and
-- letting both exist splits the register in two.
create unique index if not exists boq_revisions_project_rev_idx
  on boq_revisions (project_id, lower(rev_no));
create index if not exists boq_revisions_project_idx
  on boq_revisions (project_id, is_current, issued_date desc);

-- ---------------------------------------------------------------------------
-- 2) boq_items — the client's lines, VERBATIM
-- ---------------------------------------------------------------------------
-- ⚠️ APPEND-AND-SUPERSEDE, NEVER EDITED IN PLACE. This is the client's
--    document. A remeasure or a revised BOQ is a NEW revision with the prior
--    retained. Editing stored lines destroys the only record of what was
--    tendered. There is deliberately no UI path that updates a line's
--    description, unit, qty or amount after import.
create table if not exists boq_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    text not null references projects(id) on delete cascade,
  revision_id   uuid not null references boq_revisions(id) on delete cascade,

  -- ⚠️ IDENTITY IS (revision, sheet, source_row) — NOT item_no. Measured: 13 of
  --    901 numbered Architectural lines are duplicates, because the client
  --    numbers rows 17–20 as leaves `1.1.2…1.1.5` under heading `1.1.1` and then
  --    restarts `1.1.2` as a heading at row 21. Their numbering is inconsistent.
  sheet         text not null,
  source_row    integer not null,

  -- ⚠️ item_no is a DISPLAY LABEL. It may PROPOSE nesting for the planner to
  --    confirm; it is never a key and never the hierarchy.
  item_no       text,
  description   text,
  unit          text,
  qty           numeric,

  -- ⚠️ Material and labour are split natively in the source
  --    (UNIT COST → MATERIAL | MATERIAL COST | LABOR + CONS | LABOR COST |
  --    TOTAL AMOUNT) — the same shape as a PMI cost proposal, which is what
  --    makes one line-item table serve both (see scope_type below).
  mat_rate      numeric,
  mat_amount    numeric,
  lab_rate      numeric,
  lab_amount    numeric,

  -- ⚠️ LINE TOTALS ARE AUTHORITATIVE; UNIT RATES ARE ROUNDED DISPLAYS.
  --    Measured on the PMI sheet: recomputing qty × displayed rate gives
  --    ₱8,707,508.60 against the sheet's ₱8,707,500.00 — ₱8.60 wrong on a
  --    TWO-line sheet, compounding across 1,215. Import `amount` as given;
  --    derive the rate for display only, never write a derived rate back.
  amount        numeric,
  -- Set when the client gave a rate but no amount and we computed it, so a
  -- later reconciliation can tell the client's figures from ours.
  derived_amount boolean not null default false,

  -- ⚠️ THE AMOUNT COLUMN IS NOT ALWAYS A NUMBER. Real values found in
  --    TOTAL AMOUNT: 'Included in Package 1' (16), 'n/a' (4), 'By Megaworld'
  --    (2), 'Consideration : One side only' (1). These are SCOPE-BOUNDARY
  --    STATEMENTS, not missing data — they are exactly what a claim turns on.
  --    Stored verbatim and excluded from every roll-up, never coerced to 0.
  --    A zero and a "someone else is doing this" are different facts.
  exclusion_note text,

  -- ⚠️ REQUIRED, NOT COSMETIC. Lump-sum and provisional lines carry money but
  --    no measurable quantity; if they enter a quantity roll-up they silently
  --    corrupt every productivity rate derived from it.
  line_kind     text not null default 'measured'
                check (line_kind in ('measured','lump_sum','provisional','excluded','heading')),

  -- ⚠️ THE MARKER IS THE ONLY RELIABLE HEADING DISCRIMINATOR. A heading carries
  --    'Total of 9.1 >>' / 'Sub-Total of 9.1.1 >>' beside its amount. It can
  --    ALSO carry a unit and a quantity (`DIV 5 | METALS | lot | 1`) — using
  --    "has unit + qty" as the test made HS-SP read sum-of-WT% = 2.000000 and a
  --    contract of ₱114,410,587.84 instead of the true ₱57,205,293.92.
  total_marker  text,

  parent_id     uuid references boq_items(id) on delete set null,
  depth         integer not null default 0,

  -- The colour-coded legend on the source rows (FOR DELETION / FOR INCLUDE TO
  -- OTHER SCOPE OR REGR). ⚠️ Read on import as an ADVISORY FLAG FOR REVIEW,
  -- never as an automatic delete — a colour is one person's markup.
  fill_color    text,

  -- ⚠️ SAME AXIS AS project_schedule.scope_type (2026-08-19-schedule-contract-
  --    scope.sql). A PMI cost proposal IS a BOQ (qty / material / labour /
  --    total), so a variation's priced lines land HERE with
  --    scope_type='change_order' rather than in a parallel table that would
  --    guarantee the two drift. This also closes a real gap: variation work
  --    currently carries no quantities anywhere, so a change order can be
  --    scheduled but its productivity can never be measured.
  -- ⚠️ NO pmi_id COLUMN YET — B2c adds it with the UI that sets it. A pointer
  --    added before anything can populate it produces rows belonging to no PMI
  --    that vanish from any PMI-filtered view (the packages-migration trap).
  scope_type    text not null default 'main_contract'
                check (scope_type in ('main_contract','change_order')),

  sort_order    integer default 0,
  created_by    uuid references users(id),
  created_at    timestamptz default now()
);

create unique index if not exists boq_items_identity_idx
  on boq_items (revision_id, sheet, source_row);
create index if not exists boq_items_revision_idx
  on boq_items (revision_id, sort_order);
create index if not exists boq_items_project_idx on boq_items (project_id);
create index if not exists boq_items_parent_idx on boq_items (parent_id);

-- ---------------------------------------------------------------------------
-- 3) boq_import_profiles — because the format varies PER SHEET
-- ---------------------------------------------------------------------------
-- ⚠️ Measured in ONE workbook: header row 12 / 10 / 7 and first column A / B / B
--    across the trade sheets and their billing twins. A single hard-coded parser
--    cannot even read one file, so header detection must be a SEARCH (the
--    Drawing Register's findHeader pattern) and the accepted map is saved.
-- ⚠️ DETECTION PROPOSES; THE PLANNER ACCEPTS. A silently-wrong column map
--    produces a BOQ that looks complete and is wrong in the money column.
create table if not exists boq_import_profiles (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  -- Free text so the same client's next project can reuse it by name.
  client_key   text,
  sheet        text not null,
  header_row   integer,
  first_col    text,
  col_map      jsonb not null default '{}'::jsonb,  -- {field: column index}
  heading_rule jsonb not null default '{}'::jsonb,  -- {marker_col, marker_re, leaf_is_location}
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create unique index if not exists boq_import_profiles_key_idx
  on boq_import_profiles (project_id, sheet);

-- ---------------------------------------------------------------------------
-- 4) boq_class_map — BOQ line → Finance class code
-- ---------------------------------------------------------------------------
-- ⚠️ SCOPED TO THE BOQ REVISION. There is deliberately NO global
--    "description → class code" table that silently applies itself: two clients
--    calling something "Wall Systems and Cladding" may legitimately mean
--    different Finance codes, and a global map would apply one project's
--    judgement to another with nothing on screen to say it had.
-- ⚠️ NO FK TO class_codes, for the same reason project_schedule.class_code has
--    none: a code can predate a template revision, and rejecting the mapping is
--    worse than holding a code the chart no longer lists.
-- ⚠️ NEVER DE-ZERO THE CODE. '015051' (Gen Req › Earthmoving) collides with
--    '15051' (Metal Works › Railings), and '017151' with '17151'. The merge
--    looks like a successful match, so nothing errors. The padded code is the key.
create table if not exists boq_class_map (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  revision_id uuid not null references boq_revisions(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  class_code  text not null,
  -- ⚠️ HOW it was arrived at, so a later audit can tell a considered mapping
  --    from a bulk accept. Only ACCEPTED mappings are ever stored.
  source      text not null default 'hand_picked'
              check (source in ('suggested','bulk_accepted','hand_picked')),
  confidence  numeric,
  created_by  uuid references users(id),
  created_at  timestamptz default now()
);
create unique index if not exists boq_class_map_item_idx on boq_class_map (boq_item_id);
create index if not exists boq_class_map_rev_idx on boq_class_map (revision_id);
create index if not exists boq_class_map_code_idx on boq_class_map (project_id, class_code);

-- ---------------------------------------------------------------------------
-- 5) boq_class_suggestions — the learned library (portfolio-wide)
-- ---------------------------------------------------------------------------
-- Mapping ~1,200 lines by hand per project is not viable, so accepted mappings
-- accumulate here and are offered as PROPOSALS on the next import.
-- ⚠️ Open decision #3, resolved: suggest across the portfolio, ALWAYS show the
--    source, NEVER auto-accept. Cross-portfolio learns fastest; auto-applying it
--    is what would put one client's vocabulary into another's BOQ unseen.
-- ⚠️ Matches on the item-number PATH too ('DIV 9 › 9.1 › Wall Systems and
--    Cladding') and on the client's own division headings, which map onto
--    Finance divisions far more stably than free text does.
create table if not exists boq_class_suggestions (
  id           uuid primary key default gen_random_uuid(),
  norm_desc    text not null default '',   -- normalised description text
  path_key     text not null default '',   -- normalised item-number / heading path
  class_code   text not null,
  hits         integer not null default 1,
  last_project_id text,
  last_used_at timestamptz default now(),
  created_at   timestamptz default now()
);
create unique index if not exists boq_class_suggestions_key_idx
  on boq_class_suggestions (norm_desc, path_key, class_code);
create index if not exists boq_class_suggestions_desc_idx
  on boq_class_suggestions (norm_desc, hits desc);

-- ---------------------------------------------------------------------------
-- 6) boq_allocations — one class code covers MANY activities
-- ---------------------------------------------------------------------------
-- `class_code` on an activity is a TAG, not a key: "Rebar Works" is one code
-- carried by forty floor-level activities. So a BOQ line cannot be attributed
-- to AN activity; it must be ALLOCATED ACROSS them.
-- ⚠️ Open decision #1, resolved: per LINE, not per class code, because the line
--    carries the quantity and the money. Bulk tools apply one split across a
--    whole heading or division.
-- ⚠️ POINTS AT project_schedule.activity_id (the P6/business key), NOT the row
--    uuid — same call as 2026-07-25-schedule-document-links.sql, because the
--    uuid changes on every P6/XER "Replace" re-import.
-- ⚠️ A PROPOSED SPLIT MUST BE ACCEPTED BEFORE IT IS STORED. An auto-split
--    written silently becomes indistinguishable from a planner's own figures,
--    which defeats the point of an auditable allocation table.
create table if not exists boq_allocations (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  boq_item_id  uuid not null references boq_items(id) on delete cascade,
  activity_id  text not null,
  qty          numeric not null default 0,
  method       text not null default 'manual'
               check (method in ('location','prorata','manual')),
  accepted_by  uuid references users(id),
  accepted_at  timestamptz default now()
);
create unique index if not exists boq_allocations_pair_idx
  on boq_allocations (boq_item_id, activity_id);
create index if not exists boq_allocations_activity_idx
  on boq_allocations (project_id, activity_id);

-- ---------------------------------------------------------------------------
-- 7) boq_billing_periods + boq_progress — monthly POC and revenue
-- ---------------------------------------------------------------------------
-- ⚠️ THE ONLY STORED INPUT IS rel_pct. Verified against the real sheets, every
--    identity closes exactly:
--      WT %  = line amount / SHEET total   (sum of WT % = 1.000000 on all five)
--      %Wt.  = WT % × Rel. %age
--      Amt.  = line amount × Rel. %age
--      previous + this period = to date    (9.6718% + 7.5741% = 17.2459%)
--      POC   = Σ %Wt.        Revenue = Σ Amt. = contract × POC
--    (verified ₱241,004,906.59 at 17.2459%). Persisting %Wt. or Amt. means they
--    silently disagree with the BOQ the moment a revision changes a quantity —
--    the same derive-don't-persist rule as risk-register's rating.
--
-- ⚠️ WT % IS RELATIVE TO ITS OWN SHEET, NOT THE CONTRACT. Architectural is
--    87.90% of the contract, ACOUSTIC 1.65%. So WT % cannot be summed or
--    compared across sheets and a project POC is NOT the average of the four —
--    it must be re-weighted by each trade's share, or ACOUSTIC would move the
--    project POC as much as Architectural.
--
-- ⚠️ EACH PERIOD SNAPSHOTS THE REVISION IT WAS BILLED AGAINST (revision_id),
--    or a later remeasure retroactively rewrites a submitted billing.
--
-- ⚠️ THE BILLING PERIOD IS NOT A CALENDAR MONTH: the real one runs
--    26-Feb-2026 → 25-Mar-2026 (PO 4100125091, PROGRESS BILLING NO. 3). Cash
--    Flow and the S-curve are monthly, so the period→month mapping is explicit
--    (open decision #6) and never assumed.
create table if not exists boq_billing_periods (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null references projects(id) on delete cascade,
  revision_id    uuid not null references boq_revisions(id),
  billing_no     text not null,
  period_start   date,
  period_end     date,
  po_no          text,
  contract_total numeric,
  status         text not null default 'draft'
                 check (status in ('draft','submitted','approved')),
  notes          text,
  created_by     uuid references users(id),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists boq_billing_periods_no_idx
  on boq_billing_periods (project_id, lower(billing_no));
create index if not exists boq_billing_periods_project_idx
  on boq_billing_periods (project_id, period_end);

-- `previous` is never stored: it is the to-date of the prior period.
create table if not exists boq_progress (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  period_id   uuid not null references boq_billing_periods(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id) on delete cascade,
  -- Cumulative-to-date relative percentage for this line, 0..1 as the sheet
  -- stores it (0.272727 = 27.2727%).
  rel_pct     numeric not null default 0,
  created_by  uuid references users(id),
  updated_at  timestamptz default now()
);
create unique index if not exists boq_progress_pair_idx
  on boq_progress (period_id, boq_item_id);
create index if not exists boq_progress_project_idx on boq_progress (project_id);

-- ---------------------------------------------------------------------------
-- 8) Access — identical shape to every project-scoped module table
-- ---------------------------------------------------------------------------
-- read follows project access; write additionally requires planner (a viewer
-- must never write). See 2026-07-21-rls-project-scope-fix.sql.
-- ⚠️ Open decision #4, resolved: PLANNER-OWNED. class_codes is admin-owned
--    Finance data, but BOQ mapping is a QS/planner act, so the rows are stamped
--    with author + timestamp under the standard project-scoped RLS.
do $$
declare t text;
begin
  foreach t in array array['boq_revisions','boq_items','boq_import_profiles',
                           'boq_class_map','boq_allocations',
                           'boq_billing_periods','boq_progress']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- The suggestion library has no project scope by design (§5, open decision #3).
-- Read for any approved user; write for planners, since it is written as a
-- side-effect of accepting a mapping.
alter table boq_class_suggestions enable row level security;
drop policy if exists boq_class_suggestions_read on boq_class_suggestions;
create policy boq_class_suggestions_read on boq_class_suggestions
  for select to authenticated using (is_approved());
drop policy if exists boq_class_suggestions_write on boq_class_suggestions;
create policy boq_class_suggestions_write on boq_class_suggestions
  for all to authenticated using (is_planner()) with check (is_planner());
grant select, insert, update, delete on boq_class_suggestions to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Keep updated_at honest on the tables that are edited after creation
-- ---------------------------------------------------------------------------
create or replace function boq_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['boq_revisions','boq_import_profiles',
                           'boq_billing_periods','boq_progress']
  loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function boq_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10) The derived activity quantity (this is the whole point of B1c)
-- ---------------------------------------------------------------------------
-- ⚠️ A VIEW, NOT A COLUMN on project_schedule. See the header note: an
--    activity's quantity is derived from its allocations so there is exactly one
--    place a quantity can be wrong.
-- ⚠️ security_invoker so the caller's RLS applies (same rule as
--    schedule_scurve_agg). Without it this view would leak across projects.
create or replace view boq_activity_quantity
  with (security_invoker = true) as
select a.project_id,
       a.activity_id,
       i.unit,
       sum(a.qty)              as qty,
       count(*)                as line_count,
       max(i.scope_type)       as scope_type
from boq_allocations a
join boq_items i on i.id = a.boq_item_id
-- ⚠️ Lump-sum, provisional, excluded and heading lines carry money but no
--    measurable quantity. Letting them into a quantity roll-up is what silently
--    corrupts every productivity rate derived from it.
where i.line_kind = 'measured'
group by a.project_id, a.activity_id, i.unit;

grant select on boq_activity_quantity to authenticated;

-- ---------------------------------------------------------------------------
-- 11) No seed
-- ---------------------------------------------------------------------------
-- A project with no BOQ is a truthful state. A placeholder revision would
-- assert a contract document nobody uploaded.
