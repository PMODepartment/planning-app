-- ============================================================================
-- Migration: CLAIMED vs CERTIFIED progress — making DISPUTE measurable.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-24-boq.sql.
--
-- WHY
--   Decision #7 landed on: reported (the programme) → certified (billed) → paid,
--   with the first gap reported as accrued revenue. The owner then named the
--   case that model could not express: "there will be incidents that actual work
--   of the contractor reported will be disputed by the client."
--
--   It could not be expressed because `boq_progress` stored ONE number per line
--   — `rel_pct` — and that number is the CERTIFIED one, the figure the client
--   approved and pays against. What the contractor SUBMITTED before the client
--   cut it was nowhere, so a dispute was invisible and the whole gap had to be
--   attributed to "not yet billed".
--
-- WHAT THIS ADDS
--   rel_pct_claimed — the cumulative relative % the contractor SUBMITTED for
--   this line in this billing period. `rel_pct` keeps its meaning untouched:
--   CERTIFIED. Dispute is then claimed − certified, per line, in money:
--       Σ boq_items.amount × (claimed − certified)
--
-- ⚠️ NULL MEANS "NOT SEPARATELY RECORDED", NEVER ZERO. Every existing row keeps
--    NULL, and the app reads effective-claimed as coalesce(rel_pct_claimed,
--    rel_pct). Defaulting to 0 would make every historical line read as a 100%
--    dispute the moment this ran — a project-wide fiction, instantly, in the
--    one report a commercial manager would take to a meeting. There is
--    deliberately NO default and NO back-fill.
--
-- ⚠️ NOT A SECOND POC. Nothing derives a project percentage from the claimed
--    column. POC and revenue stay on `rel_pct` (certified), because that is what
--    the client pays against; the claimed figure exists to size the gap, not to
--    bill from it. A "claimed POC" headline would be read as revenue within a
--    week of existing.
--
-- ⚠️ CLAIMED BELOW CERTIFIED IS NOT NETTED AWAY. The client certifying MORE than
--    was submitted is rare and usually a data-entry error, so the app reports it
--    separately as an anomaly instead of quietly cancelling it against genuine
--    disputes elsewhere. No CHECK constraint enforces claimed >= certified:
--    refusing the save would only push the wrong number somewhere unrecorded.
-- ============================================================================

alter table boq_progress add column if not exists rel_pct_claimed numeric;

comment on column boq_progress.rel_pct        is
  'CERTIFIED cumulative relative % (0..1) — what the client approved. POC and revenue derive from this one.';
comment on column boq_progress.rel_pct_claimed is
  'CLAIMED cumulative relative % (0..1) — what the contractor submitted. NULL = not separately recorded (read as equal to rel_pct). Never billed from.';

-- ---------------------------------------------------------------------------
-- Reading dispute per billing period
-- ---------------------------------------------------------------------------
-- ⚠️ security_invoker so the caller's RLS applies — without it this view would
--    report every project's commercial exposure to anyone who can select it.
-- ⚠️ The same money rule the BOQ tab uses: heading rows are subtotals of the
--    lines beneath them (double-count) and an excluded line's "amount" is a
--    sentence, not a number. Getting this wrong here would make the dispute
--    total disagree with the screen that produced it.
create or replace view boq_period_dispute
  with (security_invoker = true) as
select p.project_id,
       p.period_id,
       count(*) filter (where coalesce(p.rel_pct_claimed, p.rel_pct) > p.rel_pct)  as lines_disputed,
       count(*) filter (where coalesce(p.rel_pct_claimed, p.rel_pct) < p.rel_pct)  as lines_over_certified,
       sum(i.amount * (coalesce(p.rel_pct_claimed, p.rel_pct) - p.rel_pct))
         filter (where coalesce(p.rel_pct_claimed, p.rel_pct) > p.rel_pct)         as amount_disputed,
       sum(i.amount * (p.rel_pct - coalesce(p.rel_pct_claimed, p.rel_pct)))
         filter (where coalesce(p.rel_pct_claimed, p.rel_pct) < p.rel_pct)         as amount_over_certified,
       count(*) filter (where p.rel_pct_claimed is not null)                       as lines_with_claim
from boq_progress p
join boq_items i on i.id = p.boq_item_id
where i.line_kind <> 'heading'
  and i.exclusion_note is null
  and i.amount is not null
group by p.project_id, p.period_id;

grant select on boq_period_dispute to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'boq_progress' and column_name = 'rel_pct_claimed';
--        -- expect: YES / null default
--   select * from boq_period_dispute limit 5;
--        -- expect: empty amounts until a claimed figure is entered, never zeros
