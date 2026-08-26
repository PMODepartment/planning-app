-- ============================================================================
-- Migration: A3's TAIL — package adoption on the Contracts & Claims tables,
--            which also answers design decision #2 (does the BOQ define the
--            packages?). ⚠️ That answer was CORRECTED on 2026-08-26 — see
--            section 2. The column is right; the tool built on it was not.
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
-- 2) boq_items.package_id — DESIGN DECISION #2
-- ---------------------------------------------------------------------------
-- The question was: "Does the BOQ define the packages?"
--
-- FIRST ANSWER (2026-08-25), WRONG, kept here because the correction only makes
-- sense against it: "the BOQ proposes packages — offer one package per trade
-- sheet, never auto-create." That assumed a trade sheet is a commercial lot.
--
-- CORRECTED 2026-08-26 by the owner. A CONTRACT PACKAGE IS A SCOPE DIVISION OF
-- THE PROJECT, NOT A TRADE. His example — one project, two packages:
--     Package 1 — Avesta Residences Tower 1 and General Requirements
--     Package 2 — Avesta Residences Towers 2-7
-- The BOQ workbook belongs TO a package (the real file IS Package 2), and the
-- sheets inside it are whatever breakdown THE CLIENT dictated for that package's
-- progress billing — by trade on this job, by something else on the next.
--
-- ⚠️ SO THE OLD TOOL WAS BACKWARDS AND IS DELETED. One package per trade sheet
--    would have minted four lots ("Architectural", "ACOUSTIC") where the
--    contract has one, and a claim later raised against "package ACOUSTIC"
--    would cite a lot appearing on no contract document.
--    The BOQ tab now only ASSIGNS lines to a package that already exists;
--    packages are created on the Dashboard, from the contract documents.
--
-- ⚠️ ON THE ITEM, NOT ON THE REVISION — and the reason survives the correction.
--    One issued document can cover more than one lot, so a
--    boq_revisions.package_id would force the whole workbook into one package
--    and make a per-package contract value unrepresentable. Assignment is per
--    sheet in bulk; storage stays per line so a re-measured sheet that moves
--    between lots is corrected without touching the others.
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
