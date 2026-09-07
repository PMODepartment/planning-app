-- ============================================================================
-- BOQ DOCUMENTS: a revision series per BOQ, not per project
--
-- Owner, 2026-09-07: *"Each BOQ trade ... have their own revision 00 -> 01 etc, and they
-- should be able to segregate these easily. Right now the wizard only allows me to create by
-- revision and the trades isn't apparent since I will create a trade-based BOQ that will be
-- tagged as revision 01 which is incorrect since this is a new BOQ referring to a different
-- trade."*
--
-- ⚠️⚠️ THE MODEL WAS WRONG, NOT THE PLANNER. 2026-08-24-boq.sql enforces
--
--     create unique index boq_revisions_project_rev_idx on boq_revisions (project_id, lower(rev_no));
--
-- one revision series PER PROJECT. So "General Requirements rev 00" and "Structural rev 00"
-- could not coexist, and creating the second BOQ had to call itself 01 -- a number that is not
-- the second revision of anything. That is the duplicate-key error the owner hit.
--
-- ⚠️ CONFIRMED AGAINST FOUR REAL OPW101 WORKBOOKS, not assumed:
--     "One Portwood Package 2 BOQ ... rev.05"   sheets: Architectural, HS-SP, IFO HL&LL, ACOUSTIC
--     "Package 3 ... (MCC BOQ)"                 sheets: ST, AR, MEPF
--     "PROGRESS BILLING NO. 1 MEPF PO"          sheets: Summary, ST, AR
--     "PROGRESS BILLING NO.7 STRUCTURAL PO"     sheets: Structural (2), SOA
--   Two facts follow, and they shape this file:
--     1. THE REVISION BELONGS TO THE PACKAGE. `rev.05` is Package 2's, not Architectural's.
--        So the revision series hangs off a DOCUMENT, and a document is named by whatever the
--        client's packaging calls it -- "Package 2 BOQ" -- never by a fixed trade list.
--     2. A TRADE CAN APPEAR IN TWO DOCUMENTS. Package 2 has "Architectural" and Package 3 has
--        "AR". So exclusivity is NOT enforced here. Owner: *"let's have the option to split
--        since it varies by client."* ⚠️ This costs nothing arithmetically: lines are distinct
--        rows, so an overlapping trade cannot double-count a sum. Overlap is a tidiness
--        question the UI can warn about, not a correctness one the database must refuse.
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) The document
-- ---------------------------------------------------------------------------
-- ⚠️ `divisions` is ADVISORY, and deliberately so. It records which class-code Level-1
--    divisions this BOQ is meant to cover, so the UI can steer the planner and warn when a
--    line lands outside them -- but it never gates a write. The commercial packaging varies
--    by client (see Package 2 vs Package 3 above), and a schema that hard-codes a trade list
--    would refuse the next client's arrangement.
create table if not exists boq_documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  name         text not null,                 -- 'Package 2 BOQ', 'Structural Works BOQ'
  code         text,                          -- optional short label, e.g. 'PKG2'
  divisions    text[] default '{}',           -- advisory: class_codes.code_l1 values
  package_id   uuid,                          -- optional link to a contract lot, when one exists
  sort_order   integer default 0,
  notes        text,
  created_by   uuid references users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists boq_documents_project_idx on boq_documents (project_id, sort_order);

-- Two BOQs on one project must not share a name, or the revision picker is ambiguous.
create unique index if not exists boq_documents_project_name_idx
  on boq_documents (project_id, lower(name));

-- ---------------------------------------------------------------------------
-- 2) Hang every revision off a document
-- ---------------------------------------------------------------------------
alter table boq_revisions add column if not exists document_id uuid references boq_documents(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3) Backfill — every existing revision gets a document, named from its own contents
-- ---------------------------------------------------------------------------
-- ⚠️ NAMED FROM THE DATA, NOT HARD-CODED. The owner asked that OPW101's existing rev 00 be
--    adopted as "General Requirements BOQ", and it can be -- but only because every one of its
--    127 lines sits on the 'General Requirement' sheet. So the rule is general: if all of a
--    project's existing lines share ONE sheet, the document is named "<that sheet> BOQ";
--    otherwise it is "Main BOQ" and the planner renames it. Special-casing one project id in a
--    migration is how the next project gets a wrong name silently.
-- ⚠️ ONE DOCUMENT PER PROJECT, holding every existing revision. Splitting historical revisions
--    across guessed documents would invent a revision history nobody recorded.
do $$
declare
  p record;
  doc_name text;
  new_doc uuid;
begin
  for p in select distinct project_id from boq_revisions where document_id is null loop
    select case
             when count(distinct i.sheet) = 1 then max(i.sheet) || ' BOQ'
             else 'Main BOQ'
           end
      into doc_name
      from boq_items i
      join boq_revisions r on r.id = i.revision_id
     where r.project_id = p.project_id
       and i.sheet is not null and i.sheet <> '';

    doc_name := coalesce(doc_name, 'Main BOQ');

    -- Re-runnable: reuse the document if this migration already made one.
    select id into new_doc from boq_documents
     where project_id = p.project_id and lower(name) = lower(doc_name) limit 1;

    if new_doc is null then
      insert into boq_documents (project_id, name, sort_order)
      values (p.project_id, doc_name, 0)
      returning id into new_doc;
    end if;

    update boq_revisions set document_id = new_doc
     where project_id = p.project_id and document_id is null;

    raise notice 'boq_documents: % -> "%"', p.project_id, doc_name;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) is_current becomes one-per-DOCUMENT
-- ---------------------------------------------------------------------------
-- ⚠️ FIX THE DATA BEFORE ADDING THE INDEX, or the migration fails on any project that already
--    has two current revisions. Keep the newest by issued_date then created_at; the others stay
--    readable, they simply stop being the one the module reads by default.
update boq_revisions r
   set is_current = false
 where r.is_current
   and r.document_id is not null
   and exists (
     select 1 from boq_revisions x
      where x.document_id = r.document_id
        and x.is_current
        and (x.issued_date, x.created_at, x.id) > (r.issued_date, r.created_at, r.id)
   );

create unique index if not exists boq_revisions_doc_current_idx
  on boq_revisions (document_id) where is_current;

-- ---------------------------------------------------------------------------
-- 5) THE SWAP: a revision label is unique WITHIN ITS DOCUMENT
-- ---------------------------------------------------------------------------
-- ⚠️ This is the constraint the owner actually hit. Dropped only after the backfill above, so
--    there is never a window where two revisions of one document could share a label.
--    Case-insensitive for the same reason as before: 'rev.05' and 'REV.05' are one revision to
--    a human, and letting both exist splits the register in two.
create unique index if not exists boq_revisions_doc_rev_idx
  on boq_revisions (document_id, lower(rev_no));

drop index if exists boq_revisions_project_rev_idx;

-- Keep a project-wide lookup for the contract-value roll-up, which now spans documents.
create index if not exists boq_revisions_project_doc_idx
  on boq_revisions (project_id, document_id, is_current);

-- ---------------------------------------------------------------------------
-- 6) RLS — same shape as every other boq_* table
-- ---------------------------------------------------------------------------
alter table boq_documents enable row level security;

drop policy if exists boq_documents_read on boq_documents;
create policy boq_documents_read on boq_documents
  for select to authenticated using (can_access_project(project_id));

drop policy if exists boq_documents_write on boq_documents;
create policy boq_documents_write on boq_documents
  for all to authenticated
  using (is_planner() and can_access_project(project_id))
  with check (is_planner() and can_access_project(project_id));

grant select, insert, update, delete on boq_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select d.project_id, d.name, count(r.id) revisions,
--          count(*) filter (where r.is_current) current_revs
--     from boq_documents d left join boq_revisions r on r.document_id = d.id
--    group by 1,2 order by 1,2;             -- current_revs must be 0 or 1 per row
--
--   select count(*) from boq_revisions where document_id is null;   -- expect 0
--
--   -- the label collision that started this is now legal across documents:
--   --   two different documents may each hold a rev '00'; one document may not.
--
--   -- contract value now spans documents (what the module reads):
--   select r.project_id, sum(i.amount) from boq_items i
--     join boq_revisions r on r.id = i.revision_id
--    where r.is_current and i.line_kind <> 'heading'
--    group by 1;
