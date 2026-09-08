-- ============================================================================
-- trade_map: Finance's cost classes <-> Procurement's letting trades
--
-- Owner: *"let's do the proper mapping if you think that would help us in the finance and
-- procurement connectivity."*
--
-- ⚠️⚠️ THE TWO LISTS ARE NOT A MISTAKE TO BE MERGED, AND THIS FILE EXISTS BECAUSE OF THAT.
--    An earlier reading of mine was wrong and is corrected here for the record: I reported that
--    the two vocabularies "join to nothing, silently" and recommended rewriting one to match the
--    other. There is no join. `PRC_TRADE_ORDER` in modules/project-schedule/index.html is a
--    DISPLAY SORT ORDER for work packages -- its own comment says an unlisted trade "is NOT
--    dropped: it sorts after these under its own name" -- and `project_schedule` has no trade
--    column at all. Nothing was ever joining.
--
--    What actually exists is two legitimate classifications of the same work:
--      · class_codes.trade   -- SEVEN values. How Finance classifies COST.
--      · work_packages.trade -- TEN values (WPM's XL_TRADES). How Procurement LETS the work.
--    MEPF Works is one cost class and four separate subcontracts, and the owner's own billing
--    proves it: "PROGRESS BILLING NO. 1 MEPF PO" and "NO.7 STRUCTURAL PO" are separate POs.
--    Forcing either list to impersonate the other would destroy a real distinction.
--
-- ⚠️ SO THIS TRANSLATES RATHER THAN MERGES. One Finance trade maps to one or more Procurement
--    trades. That is the shape of the truth: a BOQ line priced under "MEPF Works" is delivered by
--    up to four different subcontracts, and a report that wants to walk from a bill of quantities
--    to the package that buys it needs to know which.
--
-- ⚠️ A TABLE, NOT A CONSTANT IN CODE. Finance revises this chart, and the mapping is the kind of
--    thing that changes without a deploy. It is also readable by both apps, which a constant in
--    one module's JavaScript is not.
--
-- Run in the Supabase SQL editor (Planners project). Idempotent / re-runnable.
-- ============================================================================

create table if not exists trade_map (
  finance_trade      text not null,   -- class_codes.trade
  procurement_trade  text not null,   -- work_packages.trade (WPM XL_TRADES)
  note               text,
  primary key (finance_trade, procurement_trade)
);

create index if not exists idx_trade_map_fin on trade_map (finance_trade);
create index if not exists idx_trade_map_prc on trade_map (procurement_trade);

-- ---------------------------------------------------------------------------
-- The mapping
-- ---------------------------------------------------------------------------
-- ⚠️ Six of the seven are one-to-one and differ only in wording; MEPF is the real one-to-many.
--    "Others" is deliberately LEFT UNMAPPED -- it is Finance's catch-all (94 codes), not a trade,
--    and inventing a procurement counterpart for it would put real work under a heading nobody
--    lets a subcontract against. A line under Others resolves to no procurement trade, which is
--    the honest answer and is visible rather than silently wrong.
insert into trade_map (finance_trade, procurement_trade, note) values
  ('General Requirement',   'General Requirements',           'wording differs only in the plural'),
  ('Site Works',            'Site Works',                     null),
  ('Structural Works',      'Structural Works',               null),
  ('Architectural Works',   'Architectural Works',            null),
  ('Allied Services Works', 'Allied Services',                'wording differs only in the suffix'),
  ('MEPF Works',            'Mechanical Works',               'MEPF is one cost class, four subcontracts'),
  ('MEPF Works',            'Electrical and Auxiliary Works', 'MEPF is one cost class, four subcontracts'),
  ('MEPF Works',            'Plumbing Works',                 'MEPF is one cost class, four subcontracts'),
  ('MEPF Works',            'Fire Protection Works',          'MEPF is one cost class, four subcontracts')
on conflict (finance_trade, procurement_trade) do update set note = excluded.note;

-- ---------------------------------------------------------------------------
-- RLS -- reference data every planner reads, admins maintain
-- ---------------------------------------------------------------------------
alter table trade_map enable row level security;

drop policy if exists trade_map_read on trade_map;
create policy trade_map_read on trade_map
  for select to authenticated using (is_approved());

drop policy if exists trade_map_write on trade_map;
create policy trade_map_write on trade_map
  for all to authenticated using (is_admin()) with check (is_admin());

grant select, insert, update, delete on trade_map to authenticated;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
--   select finance_trade, count(*) procurement_trades,
--          string_agg(procurement_trade, ', ' order by procurement_trade)
--     from trade_map group by 1 order by 1;
--     -- expect 6 rows at 1 each, MEPF Works at 4
--
--   -- which Finance trades have no procurement counterpart? (expect exactly: Others)
--   select distinct c.trade from class_codes c
--    where c.active and c.trade is not null
--      and not exists (select 1 from trade_map m where m.finance_trade = c.trade);
--
--   -- and the reverse: which procurement trades no Finance trade maps to?
--   -- (expect: Site Development Works -- WPM lets it, Finance files it under Site Works/Others)
--   select unnest(array['General Requirements','Site Works','Structural Works','Architectural Works',
--                       'Mechanical Works','Electrical and Auxiliary Works','Plumbing Works',
--                       'Fire Protection Works','Allied Services','Site Development Works']) as prc
--   except select procurement_trade from trade_map;
