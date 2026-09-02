-- Progress Photos — Presentations gain a Report Type (Internal / External-Client)
-- ------------------------------------------------------------------------------
-- Owner ask: distinguish and filter Internal vs External (client-facing)
-- presentations in the "View PPRs" list.
--
-- ⚠️ Reuses the SAME two-value vocabulary ppr_report_templates.meeting_type
-- already established ('internal' / 'client') rather than inventing a second
-- spelling of the same classification (the "internal/external" vs
-- "internal/client" drift is exactly the class of bug this app's own history
-- has been bitten by more than once — see the mom-app category dropdowns and
-- the two status vocabularies). Free text, no CHECK — same call as
-- meeting_type itself and meeting_minutes.meeting_type (2026-08-20): the
-- vocabulary lives in the app, not a schema constraint, since a planner may
-- reasonably want a third label later. The UI shows 'client' as
-- "External (Client)".
--
-- ⚠️ NO DEFAULT on purpose. `add column ... default 'internal'` would
-- backfill EVERY existing presentation — including ones already named
-- "External Weekly Report" in their own free-text Description — to
-- "Internal", which is a wrong guess dressed up as a migration. Existing
-- presentations are left NULL (unclassified) rather than guessed from their
-- text; they show under "All" in the new filter and simply don't match
-- either specific option until a planner opens one and picks a value.
-- The app's own Add/Edit Presentation form defaults its picker to Internal
-- for NEW presentations only — a visible, changeable default, not a silent
-- backend one.
--
-- Idempotent; folded into supabase-schema.sql.

alter table ppr_presentations add column if not exists report_type text;

comment on column ppr_presentations.report_type is '''internal'' | ''client'' (shown as "External (Client)"). NULL = not yet classified (legacy row). Same vocabulary as ppr_report_templates.meeting_type; no CHECK.';
