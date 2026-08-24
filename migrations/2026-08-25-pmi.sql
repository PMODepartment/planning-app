-- ============================================================================
-- Migration: PMI TRACKING — the instruction, its case file, and the contractual
--            cost build-up that turns it into priced scope.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Implements ROADMAP B2a + B2b + B2c. Design note: docs/boq-and-pmi.md §5 —
-- grounded in a real 14-page filed PMI (MST347. OPS. VO-PMI 29.2 rev1, My Enso
-- Lofts / PH1 World Developers), measured rather than assumed.
--
-- ⚠️ WHY A SEPARATE TABLE FROM contracts_claims, AND NOT A record_type
--   contracts_claims holds the COMMERCIAL record: a priced claim / change order
--   / EOT moving through Estimated -> Submitted -> Evaluated -> Client Approved.
--   A PMI is the INSTRUCTION that precedes it and may never become one. It
--   arrives, it sits un-responded (which is our exposure and is invisible
--   today), it may be revised three times, and ONE PMI can spawn several
--   proposals that each become their own change order. A record_type would need
--   three self-FKs, a second reference number and a receipt stage bolted onto
--   rows where all of it is meaningless — and a 1:1 with contracts_claims would
--   make the 29 -> 29.2 -> rev1 chain unrepresentable. `claim_id` links the two
--   when a PMI does become priced work, so neither owns the other's state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) contract_profiles — the parts that vary by client (§5.7)
-- ---------------------------------------------------------------------------
-- "The PMI format varies by client" is answered by MODELLING WHAT IS INVARIANT
-- and making the rest configuration. Invariant everywhere: an instruction is
-- issued, it describes scope, we respond with a priced proposal, it is
-- adjudicated, and it may become a change order and/or an EOT. That is the
-- record. What varies is the vocabulary and the paperwork, and it lives here.
create table if not exists contract_profiles (
  id                uuid primary key default gen_random_uuid(),
  project_id        text not null references projects(id) on delete cascade,
  name              text not null,
  -- ⚠️ The LABEL is configuration, not a constant: the same record is a "PMI"
  --    to one client, a "Site Instruction" / "Architect's Instruction" /
  --    "Variation Order" to the next. Hard-coding "PMI" in the UI would make
  --    the screen wrong for most clients.
  instruction_label text not null default 'PMI',
  -- Free text, shown as a hint beside the reference field. Deliberately NOT a
  -- validated regex: a client who changes their own numbering mid-project must
  -- not be blocked from filing the instruction they actually received.
  ref_pattern       text,
  -- Which of the document types below this client demands before a submission
  -- counts as complete (§5.1). Empty = nothing is mandatory.
  required_docs     text[] not null default '{}',
  -- The approval roles on each side, in order. jsonb because the number and the
  -- names differ per client: ours is Office Supervisor -> MEPF & Finishing
  -- Manager -> Project Manager -> COO; theirs is Prepared / Checked / Noted /
  -- Approved plus a D&C Head.
  internal_roles    jsonb not null default '[]'::jsonb,
  client_roles      jsonb not null default '[]'::jsonb,
  is_default        boolean not null default false,
  notes             text,
  created_by        uuid references users(id),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create unique index if not exists contract_profiles_name_idx
  on contract_profiles (project_id, lower(name));
create index if not exists contract_profiles_project_idx
  on contract_profiles (project_id, is_default);

-- ---------------------------------------------------------------------------
-- 2) contract_cost_terms — the build-up as a RATE CARD, not an amount (§5.5)
-- ---------------------------------------------------------------------------
-- The real sheet:
--   A  Direct cost (material + labour), VAT-ex        8,707,500.00
--   B  A + (A x 10%)   markup                         9,578,250.00
--   C  B x 20%         "Fix Cost" — As per Contract    1,915,650.00
--   D  B + C                                         11,493,900.00
--   E  D x 12%         VAT                             1,379,268.00
--   F  D + E           TOTAL                          12,873,168.00
--
-- ⚠️ THE PERCENTAGES ARE MARKED "As per Contract" — THEY ARE PER-CONTRACT TERMS,
--    NOT CONSTANTS. Another client has a different markup, a different fix-cost
--    basis (or none), and a different VAT treatment (zero-rated, or VAT-inclusive
--    as Cash Flow's vat_percent checkbox already handles). Hard-coding 10/20/12
--    produces confidently wrong proposals on the next project — which is exactly
--    the kind of number that gets quoted in a meeting.
--
-- ⚠️ A PROPOSAL'S TOTAL IS DERIVED from its lines + this card, never stored. The
--    same card prints the sheet, so the screen and the paper cannot disagree.
create table if not exists contract_cost_terms (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  profile_id  uuid not null references contract_profiles(id) on delete cascade,
  step_order  integer not null,
  -- The letter the sheet prints (A/B/C/D/E/F). Referenced by basis_codes below,
  -- so it is the step's identity within its card.
  code        text not null,
  label       text not null,
  -- How this step is computed from the ones before it:
  --   direct     — the sum of the proposal's own priced lines (the only leaf)
  --   markup_add — basis x (1 + rate)      e.g. B = A + (A x 10%)
  --   percent_of — basis x rate            e.g. C = B x 20%,  E = D x 12%
  --   sum        — the sum of basis_codes  e.g. D = B + C,    F = D + E
  kind        text not null
              check (kind in ('direct','markup_add','percent_of','sum')),
  -- ⚠️ WHICH EARLIER STEP THIS MULTIPLIES OR SUMS. An array because `sum` takes
  --    several; a single-element array for the multiplying kinds. Codes, not
  --    ids, so a card reads like the sheet it came from.
  basis_codes text[] not null default '{}',
  rate        numeric,
  -- Marks the grand total (F), so a report knows which line to print in bold
  -- without assuming it is the last row.
  is_total    boolean not null default false,
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create unique index if not exists contract_cost_terms_code_idx
  on contract_cost_terms (profile_id, upper(code));
create unique index if not exists contract_cost_terms_order_idx
  on contract_cost_terms (profile_id, step_order);
create index if not exists contract_cost_terms_project_idx
  on contract_cost_terms (project_id);

-- ---------------------------------------------------------------------------
-- 3) pmi_records — the instruction and its lifecycle (§5.2, §5.3, §5.4)
-- ---------------------------------------------------------------------------
create table if not exists pmi_records (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  profile_id  uuid references contract_profiles(id) on delete set null,

  -- ⚠️ TWO REFERENCE NUMBERS, BOTH REAL, BOTH SEARCHABLE. The client's is
  --    'MEL.CON.PMI-029'; ours is 'MST347. OPS. VO-PMI 29.2 (rev1)' — project
  --    code, department, our own sequence. A single reference_no forces a
  --    choice, and the number you drop is the one the other party will cite.
  --    That is how a claim becomes unfindable in the meeting where it matters.
  client_ref  text,
  our_ref     text,

  title       text,
  scope       text,          -- what the instruction tells us to do, verbatim

  -- ⚠️ THREE DISTINCT RELATIONS, not one string. A flat reference_no collapses
  --    all three into something nobody can group by.
  --    parent_id      — PMI 29 is the instruction; 29.2 is one cost proposal
  --                     under it (rangehood only, of rangehood + in-line fan +
  --                     cooktop).
  --    supersedes_id  — rev1 supersedes rev0. Revisions are their OWN ROWS and
  --                     are NEVER overwritten: a superseded proposal is the
  --                     evidence for what changed and why.
  --    spawned_from_id— the form says "Separate PMI for site implementation will
  --                     be issued upon approval of the cost proposal". One PMI
  --                     ISSUES another. That is a third relation; conflating it
  --                     with parent or revision loses the chain.
  parent_id       uuid references pmi_records(id) on delete set null,
  supersedes_id   uuid references pmi_records(id) on delete set null,
  spawned_from_id uuid references pmi_records(id) on delete set null,
  -- Which row in a revision chain is the live one. Derivable, but stored so a
  -- list query does not need a recursive walk per row.
  is_latest       boolean not null default true,

  -- ⚠️ RECEIPT IS A REAL STAGE AND IT COMES FIRST. The existing four-stage
  --    commercial pipeline is correct and is kept; what it did not carry is that
  --    the instruction ARRIVES before we estimate anything, and time sitting on
  --    an un-responded PMI is OUR exposure — invisible today.
  stage       text not null default 'received'
              check (stage in ('received','estimated','submitted','evaluated',
                               'client_approved','rejected','withdrawn')),
  -- Adjudication result, reusing contracts_claims' own vocabulary rather than
  -- inventing a parallel one (the two registers are read side by side).
  outcome     text check (outcome in ('Pending','Approved','Disapproved','Cancelled')),

  -- Real dates from the sample, which is why there are this many: issued
  -- 09-Jan-2025 -> received by MCC 08-Feb-2025 -> testing 25-May-2026 -> cost
  -- proposal 24-Jun-2026. Roughly EIGHTEEN MONTHS.
  date_issued    date,
  date_received  date,
  date_estimated date,
  date_submitted date,
  date_evaluated date,
  date_decided   date,

  -- ⚠️ THE INTERNAL APPROVAL CHAIN WITHIN A STAGE, which the four-stage pipeline
  --    cannot express: a proposal three weeks with the COO is not "Submitted" —
  --    it is NOT SUBMITTED AT ALL. jsonb keyed by role, because the roles are
  --    per-client configuration (contract_profiles.internal_roles/client_roles),
  --    not a fixed set of columns.
  internal_chain jsonb not null default '{}'::jsonb,
  client_chain   jsonb not null default '{}'::jsonb,

  -- Set when this instruction becomes priced commercial work. on delete set
  -- null: deleting the claim must never delete the instruction that caused it.
  claim_id    uuid references contracts_claims(id) on delete set null,
  eot_days    numeric,        -- an instruction can carry time as well as money

  -- ⚠️ The escape hatch for genuinely client-specific header fields, same rule
  --    as activity_codes / udf / location: it is for fields NOTHING QUERIES. Put
  --    anything you need to filter or total into a real column instead.
  raw         jsonb not null default '{}'::jsonb,

  remarks     text,
  created_by  uuid references users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ⚠️ OUR reference is unique per project; the CLIENT'S deliberately is NOT. One
--    client instruction (MEL.CON.PMI-029) legitimately spans a parent, its
--    proposals and every revision of them — they all cite the same client
--    number, and forcing that unique would make a revision impossible to file.
create unique index if not exists pmi_records_our_ref_idx
  on pmi_records (project_id, lower(our_ref)) where our_ref is not null;
create index if not exists pmi_records_client_ref_idx
  on pmi_records (project_id, lower(client_ref));
create index if not exists pmi_records_project_stage_idx
  on pmi_records (project_id, stage, is_latest);
create index if not exists pmi_records_parent_idx     on pmi_records (parent_id);
create index if not exists pmi_records_supersedes_idx on pmi_records (supersedes_id);
create index if not exists pmi_records_spawn_idx      on pmi_records (spawned_from_id);
create index if not exists pmi_records_claim_idx      on pmi_records (claim_id);

-- ⚠️ NO AGING, NO RECOVERY RATE, NO TOTAL COLUMN. All three are derived:
--    - aging is PER STAGE (days since receipt while un-responded, days since
--      submission while pending, days in internal approval). One aging number
--      over a 16-month case answers nothing, and a stored one is wrong the day
--      after it is written.
--    - recovery rate stays over DECIDED records only — the naive denominator
--      read 0.2% on the real fixture where the honest figure was 85.0% of one
--      decided record, and a long-lived PMI register makes that worse, not better.
--    - the proposal total is its priced lines through the rate card (§5.5).

-- ---------------------------------------------------------------------------
-- 4) pmi_attachments — a filed PMI is a CASE FILE, not a form (§5.1)
-- ---------------------------------------------------------------------------
-- The sample is 14 pages and FIVE distinct documents by three different authors:
--   p1     cost proposal (the priced response + its build-up)   Megawide
--   p2     the client's PMI form (ref, scope, signature matrix) PH1 World
--   p3-5   product photos + design-manager approval             Megawide/supplier
--   p8-11  performance testing report EPC-ENG-TRN-26553a        MCC Engineering
--   p12-14 supplier sales contract Kin Long JS20260506-01       Vendor
--
-- ⚠️ SO A PMI NEEDS MANY TYPED ATTACHMENTS, NOT ONE file_url. A single file
--    column cannot answer "has the cost proposal been submitted?" separately
--    from "is the testing report attached?" — which is exactly what a QS asks
--    when chasing one.
create table if not exists pmi_attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  pmi_id      uuid not null references pmi_records(id) on delete cascade,
  doc_type    text not null default 'other'
              check (doc_type in ('cost_proposal','client_form','product_data',
                                  'testing_report','supplier_contract','other')),
  -- ⚠️ THE OBJECT PATH, NOT A URL. The bucket is private, so the URL is signed
  --    on demand; a stored URL expires and is then worse than useless because it
  --    looks like a working link. Same construction as drawing_register.file_url.
  file_path   text not null,
  file_name   text,
  file_size   bigint,
  label       text,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now()
);
-- Several files per type is the normal case (the photos are three pages), so
-- this is deliberately NOT unique on (pmi_id, doc_type).
create index if not exists pmi_attachments_pmi_idx on pmi_attachments (pmi_id, doc_type);
create index if not exists pmi_attachments_project_idx on pmi_attachments (project_id);

-- ---------------------------------------------------------------------------
-- 5) boq_items.pmi_id — a PMI cost proposal IS a BOQ (§5.6)
-- ---------------------------------------------------------------------------
-- '1,204 units, material rate, labour rate, total' is exactly the shape of the
-- contract BOQ, so a variation's priced lines go into boq_items with
-- scope_type='change_order' rather than a parallel table that would guarantee
-- the two drift. That makes a variation measurable, mappable to class codes,
-- allocatable to activities, and rollable into the S-curve exactly like contract
-- work — while still reporting separately as where-the-money-came-from.
--
-- ⚠️ THIS IS THE COLUMN 2026-08-24-boq.sql DELIBERATELY WITHHELD. It lands now,
--    with the UI that sets it — a pointer added before anything can populate it
--    produces rows belonging to no PMI that vanish from any PMI-filtered view.
alter table boq_items add column if not exists pmi_id uuid references pmi_records(id) on delete set null;
create index if not exists boq_items_pmi_idx on boq_items (pmi_id);

-- ⚠️ A PMI's priced lines need a REVISION to hang on: boq_items.revision_id is
--    NOT NULL and identity is (revision_id, sheet, source_row). Rather than
--    weaken that (a nullable revision_id makes the unique index toothless,
--    because NULLs are distinct in Postgres), each PMI proposal gets its OWN
--    boq_revision. That is also the honest reading — a revision of the PMI IS a
--    revision of its priced scope — and it keeps change-order lines out of the
--    contract document's revision, so the BOQ tab's contract total is unaffected.
--    The BOQ tab lists `pmi_id is null` revisions; the PMI tab lists its own.
alter table boq_revisions add column if not exists pmi_id uuid references pmi_records(id) on delete cascade;
create index if not exists boq_revisions_pmi_idx on boq_revisions (pmi_id);

-- ⚠️ TWO DIFFERENT DELETE RULES ON PURPOSE, and the asymmetry is the point:
--    - boq_revisions.pmi_id CASCADES. A proposal's priced scope has no meaning
--      without the instruction that priced it, and boq_items.revision_id already
--      cascades from the revision, so deleting a PMI removes exactly its own
--      lines and nothing else.
--    - boq_items.pmi_id SETS NULL. A CONTRACT BOQ line may be tagged to a PMI
--      for attribution while still belonging to the contract revision; deleting
--      the PMI must not delete contract scope. It loses its tag, not its life.

-- ⚠️ It also closes a real gap: variation work currently carries no quantities
--    anywhere, so a change order can be scheduled but its productivity can never
--    be measured. boq_activity_quantity already covers change-order lines,
--    because it filters on line_kind and never on scope_type.

-- ---------------------------------------------------------------------------
-- 6) Access — the standard project-scoped shape
-- ---------------------------------------------------------------------------
-- read follows project access; write additionally requires planner. A viewer
-- must never file or price an instruction. See 2026-07-21-rls-project-scope-fix.
do $$
declare t text;
begin
  foreach t in array array['contract_profiles','contract_cost_terms',
                           'pmi_records','pmi_attachments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (can_access_project(project_id))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (is_planner() and can_access_project(project_id)) with check (is_planner() and can_access_project(project_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7) updated_at stays honest
-- ---------------------------------------------------------------------------
create or replace function pmi_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['contract_profiles','contract_cost_terms','pmi_records']
  loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function pmi_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8) The private contracts-claims bucket (B2a)
-- ---------------------------------------------------------------------------
-- The 2026-06-18 migration created only drawing-register / progress-photos /
-- material-submittal. This is the fourth, and it follows mom-attachments (the
-- 2026-08-21 precedent), NOT the older three.
insert into storage.buckets (id, name, public)
values ('contracts-claims', 'contracts-claims', false)
on conflict (id) do nothing;

-- ⚠️ INSERT is `is_writer()`, NOT the `is_approved()` the 2026-06-18 buckets
--    use. That older rule predates viewer-readonly and lets a VIEWER upload into
--    a register they cannot write a row to — an orphan file by construction. A
--    new bucket has no legacy uploads to protect, so it starts on the correct
--    rule rather than inheriting the drift.
drop policy if exists contracts_claims_read on storage.objects;
create policy contracts_claims_read on storage.objects
  for select using (bucket_id = 'contracts-claims' and is_approved());

drop policy if exists contracts_claims_ins on storage.objects;
create policy contracts_claims_ins on storage.objects
  for insert with check (bucket_id = 'contracts-claims' and is_writer());

-- ⚠️ DELETE keeps the owner branch beside is_planner(), the settled rule on the
--    other four: a planner deleting a PMI someone else attached to must actually
--    remove the object, or the row goes and the file is orphaned — while the
--    uploader keeps the right to remove their own.
drop policy if exists contracts_claims_del on storage.objects;
create policy contracts_claims_del on storage.objects
  for delete using (
    bucket_id = 'contracts-claims' and (owner = auth.uid() or is_planner())
  );

-- ---------------------------------------------------------------------------
-- 9) No seed
-- ---------------------------------------------------------------------------
-- ⚠️ Deliberately NO default contract profile and NO seeded 10/20/12 rate card.
--    A seeded card is the hard-coded percentages by another name: it would be
--    silently applied to the next client's proposal and read as a considered
--    contractual term. The UI offers the sample build-up as a one-click TEMPLATE
--    the planner must accept, which is a different thing entirely.
--
-- Verify:
--   select id, public from storage.buckets where id = 'contracts-claims';
--   select polname from pg_policy where polrelid = 'storage.objects'::regclass
--     and polname like 'contracts_claims%' order by polname;
