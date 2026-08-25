-- ============================================================================
-- Migration: F1 — VENDOR IDENTITY in the Planners app.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Implements ROADMAP F1. Design note: docs/vendor-performance-chain.md §3.
--
-- THE GAP THIS CLOSES
--   schedule → package → procurement → vendor is four-fifths built (A3, C1, E1,
--   E2 + WPM's own vendor management). The missing link is that the Planners app
--   has NO VENDOR ENTITY AT ALL: `wpm_work_packages` mirrors budgets, dates and
--   award status but not who won the package, and
--   `productivity_activities.subcontractor` is free text that joins to nothing.
--   Without this, "how is this vendor performing" cannot be asked.
--
-- ⚠️ MIRROR, NEVER A LIVE BROWSER READ. WPM's anon key ships in its client JS and
--    its `vendors` table sits beside `vendor_rates`. Reading it from the browser
--    would expose commercial data, which is exactly why E1 established the
--    server-side mirror for budgets. Writes here happen ONLY through the
--    `sync-wpm` Edge Function using WPM's service-role key.
--
-- ⚠️ COLUMN NAMES ARE TAKEN FROM WPM'S OWN MIGRATIONS, NOT GUESSED —
--    MIGRATION_vendor_management.sql (name, trade_categories, status),
--    MIGRATION_vendor_accreditation.sql (accreditation, accreditation_date),
--    MIGRATION_vendor_code.sql (vendor_code) and MIGRATION_vendor_merge.sql
--    (work_packages.awarded_vendor_ids / awarded_vendor_amounts). A guessed name
--    reads NULL forever and looks like "this vendor has no packages".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) wpm_vendors — the mirror
-- ---------------------------------------------------------------------------
-- ⚠️ NAMES AND TRADES ONLY. No contact_person / contact_number / contact_email /
--    address, and no rates. Vendor commercial and personal data stays in WPM;
--    this app needs only enough to say WHO did the work and in WHICH trade.
--    Adding a contact column here would quietly turn a performance mirror into a
--    second contacts database with no owner.
create table if not exists wpm_vendors (
  -- The WPM `vendors.id`, carried across as the primary key so every
  -- `vendor_id` in this app means the same thing it means in WPM.
  id               uuid primary key,
  name             text not null,
  vendor_code      text,
  -- WPM's subset of the 10 canonical WP trades.
  trade_categories text[] not null default '{}',
  -- 'accredited' | 'unaccredited' | 'problematic' (WPM's own vocabulary,
  -- nullable there and here — an unassessed vendor is not "unaccredited").
  accreditation      text,
  accreditation_date date,
  -- 'pending_review' | 'approved' | 'inactive' | 'rejected'
  status           text,
  synced_at        timestamptz default now()
);
create index if not exists idx_wpm_vendors_name on wpm_vendors (lower(name));
create index if not exists idx_wpm_vendors_status on wpm_vendors (status);

-- Same access shape as the work-package mirror: readable by any approved user
-- (the mirror is not mapped to a Planners project id, so it gates on approval
-- only), and NO write policy — the Edge Function's service-role key bypasses RLS.
alter table wpm_vendors enable row level security;
drop policy if exists wpm_vendors_read on wpm_vendors;
create policy wpm_vendors_read on wpm_vendors
  for select using (is_approved());
grant select on wpm_vendors to authenticated;

-- ---------------------------------------------------------------------------
-- 2) The award columns on the work-package mirror
-- ---------------------------------------------------------------------------
-- Additive to the same upsert the Edge Function already performs; dates, budget
-- and award status already come across.
alter table wpm_work_packages add column if not exists vendor_id uuid;
-- ⚠️ awarded_vendor_ids AND awarded_vendor_amounts ARE INDEX-ALIGNED in WPM
--    (see MIGRATION_vendor_merge.sql, which maintains that alignment when two
--    vendor records merge). They must be mirrored as a PAIR and read by index —
--    sorting or de-duplicating one without the other silently reassigns money to
--    the wrong vendor.
alter table wpm_work_packages add column if not exists awarded_vendor_ids uuid[];
alter table wpm_work_packages add column if not exists awarded_vendor_amounts numeric[];
-- WPM's display string. Kept because it is what the buyer typed and it stays
-- readable when a vendor row is later merged or renamed.
alter table wpm_work_packages add column if not exists contractor text;

create index if not exists idx_wpm_mirror_vendor on wpm_work_packages (vendor_id);

-- ---------------------------------------------------------------------------
-- 3) The productivity link
-- ---------------------------------------------------------------------------
-- ⚠️ NO FOREIGN KEY TO wpm_vendors, deliberately — the same call as
--    project_schedule.class_code. This is a MIRROR that the sync refreshes
--    wholesale: a vendor that leaves WPM (or has not been synced yet) would make
--    an FK either block the sync or cascade real productivity history away. A
--    plain uuid that resolves to "unknown vendor" on screen is recoverable; a
--    deleted month of site records is not.
alter table productivity_activities add column if not exists vendor_id uuid;
create index if not exists idx_prod_act_vendor on productivity_activities (vendor_id);

-- ⚠️ THE FREE-TEXT `subcontractor` IS KEPT AND IS NOT BACK-FILLED HERE.
--    It is the legacy value the site actually typed ("AFCSC", "JM2", "CEC",
--    "GeoExpert") and it stays the display fallback — exactly as E2 kept an
--    unresolvable `work_package` visible as UNLINKED rather than blanking it.
--    Matching those strings to vendor rows is a judgement (they are abbreviations,
--    and two projects may abbreviate differently), so the module offers a
--    one-by-one picker and never guesses.

-- ---------------------------------------------------------------------------
-- 4) Verify
-- ---------------------------------------------------------------------------
--   select count(*) from wpm_vendors;                       -- 0 until sync-wpm runs
--   select column_name from information_schema.columns
--    where table_name = 'wpm_work_packages'
--      and column_name in ('vendor_id','awarded_vendor_ids',
--                          'awarded_vendor_amounts','contractor');   -- expect 4
--
-- ⚠️ AFTER RUNNING THIS: redeploy the Edge Function and re-sync, or every column
--    above stays NULL and the vendor screens read "no vendors" rather than
--    erroring:
--      supabase functions deploy sync-wpm --project-ref bgupuqnkqhixpuctyder
--    then press "Sync from WPM" in Cash Flow (or POST the function).
--    The function self-heals against a partly-migrated mirror — it drops a column
--    the mirror lacks and reports it in `dropped` — so the order is forgiving,
--    but nothing appears until both halves are done.
