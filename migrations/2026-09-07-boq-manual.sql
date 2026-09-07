-- ============================================================================
-- Manual BOQ authoring: a DRAFT revision the planner builds from the class-code
-- library, plus the guarded write that tags schedule activities with a code.
--
-- Owner, 2026-09-07: *"Let's enable the users to manually add a BOQ, this would be based
-- on the class code library and from the class code library the planner would be able to
-- tag it to the activities in the schedule module. […] If we make the manual add of BOQ
-- perfect, it would enable us to better execute/implement the import feature."*
--
-- ⚠️ THIS MIGRATION EXISTS TO PROTECT AN INVARIANT, NOT TO RELAX IT.
--    2026-08-24-boq.sql states it plainly: `boq_items` is APPEND-AND-SUPERSEDE, never
--    edited in place, because it is the CLIENT'S document and every claim argument turns
--    on exactly what was tendered. A manual builder needs editable lines, and the lazy
--    reading of that need is "so allow edits". That would silently make the client's
--    tendered BOQ editable too, which is the one thing the table was built to prevent.
--
--    The distinction that resolves it is WHOSE DOCUMENT IT IS *YET*. A revision being
--    authored is nobody's evidence — it is a working draft. A revision that has been
--    ISSUED is the record. So the lifecycle is the fix:
--      · status='draft'  — lines are freely editable and deletable. Never billed against.
--      · status='issued' — the 2026-08-24 rule applies in full, ENFORCED BY A TRIGGER
--                          rather than by every future UI remembering to.
--    An imported revision is issued the moment its import finishes. A manual one is
--    issued when the planner says so.
--
-- ⚠️ THE IMPORTER NOW CREATES ITS REVISION AS A DRAFT AND FLIPS IT AT THE END, because
--    it UPDATEs the rows it just inserted (the parent_id second pass) and the trigger
--    below would refuse that. This is not a workaround — it is more correct than what it
--    replaces: a half-finished import is now visibly a draft, so a failed run can no
--    longer be billed against as though it were the tendered document.
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) The revision lifecycle
-- ---------------------------------------------------------------------------
-- ⚠️ BOTH DEFAULT TO THE PRE-EXISTING BEHAVIOUR, and that is the whole point of the
--    defaults. Every revision that exists today came from an import and is finished, so
--    'issued'/'import' describes it exactly — no back-fill decision, no row that changes
--    meaning when this file runs. A default of 'draft' would retroactively un-issue every
--    BOQ in the database and unlock 1,215 client lines per project.
alter table boq_revisions add column if not exists status text not null default 'issued';
alter table boq_revisions add column if not exists origin text not null default 'import';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boq_revisions_status_ck') then
    alter table boq_revisions add constraint boq_revisions_status_ck
      check (status in ('draft', 'issued'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'boq_revisions_origin_ck') then
    alter table boq_revisions add constraint boq_revisions_origin_ck
      check (origin in ('import', 'manual'));
  end if;
end $$;

-- ⚠️ A DRAFT MAY NOT BE THE CURRENT REVISION. `is_current` is what the BOQ tab reads by
--    default and what the contract value, the POC and the monthly revenue are computed
--    from. A half-built draft sitting there would put a partial contract sum on screen
--    and into a billing conversation. Enforced in the database, not merely avoided in the
--    UI, because it is a money figure that leaves this app inside a claim.
create or replace function boq_revisions_draft_not_current() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'draft' and coalesce(new.is_current, false) then
    raise exception 'A draft BOQ revision cannot be the current one — issue it first.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists boq_revisions_draft_not_current_t on boq_revisions;
create trigger boq_revisions_draft_not_current_t
  before insert or update on boq_revisions
  for each row execute function boq_revisions_draft_not_current();

-- ---------------------------------------------------------------------------
-- 2) Where a line came from
-- ---------------------------------------------------------------------------
-- ⚠️ NOT DERIVABLE FROM THE REVISION, which is why it is its own column. A revision
--    records how it STARTED; a line records who wrote it. The two diverge the first time
--    a planner adds a missing trade to a draft they began by import — and "did the client
--    give us this line, or did we?" is a question a claim turns on.
alter table boq_items add column if not exists origin text not null default 'import';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'boq_items_origin_ck') then
    alter table boq_items add constraint boq_items_origin_ck
      check (origin in ('import', 'manual'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) THE LOCK. An issued revision's document columns are immutable.
-- ---------------------------------------------------------------------------
-- ⚠️ COLUMN-SELECTIVE, DELIBERATELY. A blanket "no UPDATE on an issued revision" would
--    break two writes that are legitimately OURS rather than the client's:
--      · `package_id` — which contract lot a line is administered under
--        (boq.js openAssignPackage). Assigning a lot does not restate the client's BOQ.
--      · `sort_order` — display order.
--    Everything that describes WHAT WAS TENDERED is frozen: item_no, description, unit,
--    qty, the four material/labour figures, amount, derived_amount, exclusion_note,
--    line_kind, total_marker, the identity (sheet, source_row) and the hierarchy
--    (parent_id, depth).
--
-- ⚠️ DELETE IS REFUSED OUTRIGHT on an issued revision. A remeasure is a NEW revision with
--    the prior retained; deleting a tendered line destroys the evidence. Dropping a whole
--    REVISION still cascades — that is an explicit, visible act, which is a different
--    thing from a line quietly disappearing out of one.
--
-- ⚠️ PMI PROPOSAL REVISIONS ARE EXEMPT, and this exemption is load-bearing: `pmi.js`
--    removeLine() DELETEs a priced line, and addLine/removeLine on a cost proposal are
--    normal editing right up until it is submitted. Locking them would break a shipped
--    feature. What preserves a superseded PROPOSAL is not row immutability but
--    `pmi_records.supersedes_id` — a revision is a new row and the old one stays as the
--    evidence (2026-08-25-pmi.sql). Read honestly: this leaves a *submitted* proposal's
--    lines as editable as they are today. That is the status quo, not an improvement — a
--    stage-aware lock on the PMI chain is a separate piece of work.
--    ⚠️ The pmi_id test goes through `to_jsonb`, not `r.pmi_id`, because
--       2026-08-25-pmi.sql may not have been run on a given deployment and a direct
--       reference to a column that does not exist would make this whole file un-runnable.
--       An absent key reads as NULL, which is exactly "not a PMI revision".
create or replace function boq_items_issued_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  rev jsonb;
begin
  select to_jsonb(r) into rev from boq_revisions r
   where r.id = coalesce(old.revision_id, new.revision_id);

  -- No revision (a cascade is removing it), still a draft, or a PMI cost proposal: let it
  -- through. `coalesce` covers the instant between this file's two statements on a live
  -- database, where the column exists on the table but not yet in a cached row.
  if rev is null
     or coalesce(rev->>'status', 'issued') <> 'issued'
     or rev->>'pmi_id' is not null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'BOQ line % belongs to an ISSUED revision and cannot be deleted. Supersede the revision instead.', old.id
      using errcode = 'check_violation';
  end if;

  if new.item_no        is distinct from old.item_no
  or new.description    is distinct from old.description
  or new.unit           is distinct from old.unit
  or new.qty            is distinct from old.qty
  or new.mat_rate       is distinct from old.mat_rate
  or new.mat_amount     is distinct from old.mat_amount
  or new.lab_rate       is distinct from old.lab_rate
  or new.lab_amount     is distinct from old.lab_amount
  or new.amount         is distinct from old.amount
  or new.derived_amount is distinct from old.derived_amount
  or new.exclusion_note is distinct from old.exclusion_note
  or new.line_kind      is distinct from old.line_kind
  or new.total_marker   is distinct from old.total_marker
  or new.parent_id      is distinct from old.parent_id
  or new.depth          is distinct from old.depth
  or new.sheet          is distinct from old.sheet
  or new.source_row     is distinct from old.source_row
  then
    raise exception 'BOQ line % is in an ISSUED revision — its tendered figures are immutable. Only package_id and sort_order may change.', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists boq_items_issued_guard_t on boq_items;
create trigger boq_items_issued_guard_t
  before update or delete on boq_items
  for each row execute function boq_items_issued_guard();

-- ---------------------------------------------------------------------------
-- 4) 'authored' — a class code that was never a guess
-- ---------------------------------------------------------------------------
-- ⚠️ A FOURTH SOURCE, NOT A REUSE OF 'hand_picked'. The three existing values all
--    describe reverse-engineering a code from a description somebody else wrote:
--    suggested (the library proposed it), bulk_accepted (accepted in a batch),
--    hand_picked (a human chose it for a client's line). A manually authored line is the
--    opposite direction — THE CODE CAME FIRST and the line was written from it, so the
--    mapping is a fact, not a judgement. Recording it as 'hand_picked' would file a
--    certainty in the same bucket as an inference, and `boq_class_suggestions` LEARNS
--    from these rows: feeding it "a human decided this description means this code" when
--    the description was generated FROM the code is how a suggestion library starts
--    confidently proposing its own output back to itself.
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'boq_class_map'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%source%hand_picked%'
  loop
    execute format('alter table boq_class_map drop constraint %I', c);
  end loop;
  alter table boq_class_map add constraint boq_class_map_source_check
    check (source in ('suggested', 'bulk_accepted', 'hand_picked', 'authored'));
end $$;

-- ---------------------------------------------------------------------------
-- 5) THE GUARDED WRITE: tag schedule activities with a class code
-- ---------------------------------------------------------------------------
-- ⚠️ THIS IS AN RPC AND NOT A PLAIN UPDATE FOR A MEASURED REASON. The policy is
--
--     project_schedule_upd: is_writer() and can_access_project(project_id)
--                           and (created_by = auth.uid() or is_admin())
--
--   so a planner who did not IMPORT the schedule cannot update its rows — and PostgREST
--   answers an UPDATE that RLS filters down to nothing with **200 and zero rows**. No
--   error. A "Tagged 40 activities" toast over a table that changed nothing is exactly the
--   silent-success failure 2026-09-02-wbs-link-batched.sql documents at length, where
--   16,393 of 16,485 activities kept a NULL and the screen looked perfect.
--
--   SECURITY DEFINER with the checks written out, therefore, and it RETURNS THE ROW COUNT
--   so the caller can report a shortfall instead of inventing a success.
--
-- ⚠️ IT WRITES ONE COLUMN. Definer rights over project_schedule are a large privilege to
--    hand out; this function may set `class_code` and nothing else, so it cannot become a
--    back door onto dates, durations, progress or ownership.
--
-- ⚠️ IT NEVER SILENTLY RETAGS. An activity already carrying a DIFFERENT non-null code is
--    skipped unless p_overwrite is true — a class code drives the cost roll-up, so quietly
--    moving forty activities from one Finance code to another is a reconciliation nobody
--    would know to go looking for. `p_class_code => null` CLEARS a tag, and needs the same
--    deliberate act: with p_overwrite false it clears nothing that is already tagged.
--
-- ⚠️ WBS SUMMARY ROWS ARE NEVER TAGGED. A class code on a summary row would be counted
--    beside its own children by anything rolling up by code — the double-count trap the
--    schedule module documents throughout.
drop function if exists public.boq_tag_activities(text, text, text[], boolean);

create or replace function public.boq_tag_activities(
  p_project_id   text,
  p_class_code   text,
  p_activity_ids text[],
  p_overwrite    boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_writer() then
    raise exception 'Not permitted: a viewer cannot tag schedule activities.'
      using errcode = 'insufficient_privilege';
  end if;
  if not can_access_project(p_project_id) then
    raise exception 'Not permitted: no access to project %.', p_project_id
      using errcode = 'insufficient_privilege';
  end if;
  if p_activity_ids is null or array_length(p_activity_ids, 1) is null then
    return 0;
  end if;

  -- ⚠️ Keyed on activity_id (the schedule's own business key), NOT the row uuid — see the
  --    module note: a schedule import REINSERTS every row, so a uuid captured on screen
  --    minutes ago may already be gone while the activity it named is still there.
  update project_schedule s
     set class_code = p_class_code
   where s.project_id = p_project_id
     and s.activity_id = any(p_activity_ids)
     and s.activity_type is distinct from 'WBS Summary'
     and s.class_code is distinct from p_class_code
     and (p_overwrite
          or ((s.class_code is null or s.class_code = '') and p_class_code is not null));
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.boq_tag_activities(text, text, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select status, origin, count(*) from boq_revisions group by 1,2;   -- all issued/import
--   select origin, count(*) from boq_items group by 1;                 -- all import
--
--   -- the lock bites (expect: ERROR … tendered figures are immutable)
--   update boq_items set qty = coalesce(qty,0) + 1
--    where id = (select i.id from boq_items i join boq_revisions r on r.id = i.revision_id
--                 where r.status = 'issued' limit 1);
--
--   -- package_id still moves on an issued revision (expect: UPDATE 1)
--   update boq_items set sort_order = sort_order
--    where id = (select i.id from boq_items i join boq_revisions r on r.id = i.revision_id
--                 where r.status = 'issued' limit 1);
--
--   -- a draft cannot be current (expect: ERROR … issue it first)
--   insert into boq_revisions (project_id, rev_no, status, origin, is_current)
--   values ('OPW101', 'ZZ-TEST', 'draft', 'manual', true);
