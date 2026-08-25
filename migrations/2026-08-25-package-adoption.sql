-- ============================================================================
-- Migration: A3's TAIL — package adoption on the Contracts & Claims tables,
--            which also answers design decision #2 (does the BOQ define the
--            packages?).
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
-- ⚠️ Requires 2026-08-19-packages.sql and 2026-08-24-boq.sql.
--
-- A3 left this open: `packages` exists and the Dashboard manages it, but no
-- module table carried `package_id`, so selecting a package narrowed nothing.
-- MODULE_CONTRACT §6b sets the rule for closing it — "add the column AND the UI
-- that sets it in the same change, or you create rows belonging to no package
-- that vanish from any package-filtered view." This migration is the column half
-- of exactly that, for the two tables where a package is genuinely load-bearing.
--
-- ⚠️ ADOPTION IS DELIBERATELY NOT UNIVERSAL. It is NOT added to:
--   - risk_register / issues_lessons — a risk or an issue is raised about the
--     project, and forcing a package onto it invents a precision nobody has.
--   - productivity_activities — it already carries `work_package`, a WPM `wp_no`,
--     which is a DIFFERENT axis (what procurement bought). Two package-shaped
--     columns on one table is how a report ends up joining the wrong one.
--   - the cash_flow_* tables — `cash_flow_trade_packages` is already that
--     module's own notion of a package split, and a third would drift from both.
--   - drawing_register / material_submittal — retired as live modules (2026-08-19);
--     their tables are stale history and must not gain new columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) contracts_claims.package_id — a claim is raised AGAINST a package
-- ---------------------------------------------------------------------------
-- The commercial case for a claim, change order or EOT is almost always scoped
-- to one contract package, and "which package is bleeding" is a question the
-- register cannot answer today.
--
-- ⚠️ on delete set null, never cascade. Retiring a package must not delete the
--    claims raised under it — those are the commercial record, and they outlive
--    the lot they were raised against.
alter table contracts_claims add column if not exists package_id uuid
  references packages(id) on delete set null;
create index if not exists idx_contracts_claims_package on contracts_claims (package_id);

-- ---------------------------------------------------------------------------
-- 2) boq_items.package_id — DESIGN DECISION #2, answered
-- ---------------------------------------------------------------------------
-- The question was: "Does the BOQ define the packages? A trade sheet usually maps
-- to a contract package, and the real file IS 'Package 2'."
--
-- ANSWER: the BOQ *proposes* packages; it never creates them.
--   The four trade sheets of the real workbook (Architectural / IFO HL&LL /
--   HS-SP / ACOUSTIC) are exactly how that contract is bought, so offering
--   "create a package per sheet" is cheap and useful. AUTO-creating them is not:
--   a sheet is a measurement convenience as often as it is a commercial lot, the
--   planner's own package codes come off the contract documents (not off a tab
--   name), and a package silently minted by an importer would then be cited in a
--   claim nobody agreed to.
--   So the column lands here, the BOQ tab offers a propose-then-accept tool, and
--   nothing is created without a click. Same propose→preview→apply shape as the
--   class-code mapping and the allocation split.
--
-- ⚠️ ON THE ITEM, NOT ON THE REVISION. One revision spans several trade sheets
--    and therefore several packages — the real file is one document covering
--    four. A `boq_revisions.package_id` would force the whole document into one
--    lot and make a per-sheet contract value unrepresentable. The tool assigns it
--    per sheet in bulk; the storage stays per line so a re-measured sheet that
--    moves between lots can be corrected without touching the others.
--
-- ⚠️ on delete set null: deleting a package must never delete contract scope.
alter table boq_items add column if not exists package_id uuid
  references packages(id) on delete set null;
create index if not exists idx_boq_items_package on boq_items (package_id);

-- ---------------------------------------------------------------------------
-- 3) Reading a package's BOQ value
-- ---------------------------------------------------------------------------
-- ⚠️ security_invoker so the caller's RLS applies — without it this view would
--    report every project's package values to anyone who can select from it.
-- ⚠️ The same money rule the BOQ tab itself uses: heading rows are subtotals of
--    the lines beneath them (double-count) and an excluded line's "amount" is a
--    sentence, so neither contributes. Getting this wrong here would make a
--    package's contract value disagree with the BOQ screen that produced it.
create or replace view boq_package_value
  with (security_invoker = true) as
select i.project_id,
       i.package_id,
       i.revision_id,
       i.scope_type,
       count(*)                       as line_count,
       sum(i.amount)                  as amount,
       sum(i.mat_amount)              as material,
       sum(i.lab_amount)              as labour
from boq_items i
where i.package_id is not null
  and i.line_kind <> 'heading'
  and i.exclusion_note is null
  and i.amount is not null
group by i.project_id, i.package_id, i.revision_id, i.scope_type;

grant select on boq_package_value to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Verify
-- ---------------------------------------------------------------------------
--   select column_name from information_schema.columns
--    where (table_name, column_name) in
--          (('contracts_claims','package_id'), ('boq_items','package_id'));   -- expect 2
--   select * from boq_package_value limit 5;   -- empty until the BOQ tab assigns
--
-- No back-fill and no seed: every existing row keeps package_id NULL, which is
-- the truthful state — nobody has said which lot it belongs to yet.
