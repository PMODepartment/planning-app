-- ============================================================================
-- Stakeholder Map — full corporate-BD methodology
-- ----------------------------------------------------------------------------
-- Extends the starter `stakeholder_map` table to match Megawide's real
-- "CORP. BD TCD. Stakeholder Map" workbook (BD Map / TCD Map + Analysis Guide).
--
-- Reused starter columns (no dead duplicates), by natural match:
--   name         -> Name
--   organization -> Institution        (the agency/company, e.g. "Board of Investments")
--   role_title   -> Position           (e.g. "City Mayor")
--   category     -> Sector             (Government | Private)
--   influence    -> Impact  rating 1-4 (the "capability to disrupt business" axis;
--                                        the workbook renames Influence -> Impact)
--   interest     -> Interest rating 1-4
--   contact      -> Contact
--   engagement   -> free-text engagement notes (optional; the workbook has no
--                                        notes column, this is a useful add)
--
-- DERIVED IN-APP, never stored (pure functions of the columns above):
--   Importance (1st-4th) + Engagement Approach  <- Impact x Interest grid
--   Engagement Strategy + Minimum Frequency      <- (Target - Current) relationship gap
--
-- Ratings kept as text ('1'..'4') in the reused influence/interest columns
-- (idempotent add-only migration, no type ALTER); the module parses them.
-- ============================================================================

alter table stakeholder_map add column if not exists stakeholder_group   text;   -- LGU | NGA | GOCC | Partners | Consultants | ...
alter table stakeholder_map add column if not exists title               text;   -- honorific / formal title
alter table stakeholder_map add column if not exists nickname            text;
alter table stakeholder_map add column if not exists birthday            date;
alter table stakeholder_map add column if not exists email               text;
alter table stakeholder_map add column if not exists current_rel         smallint;  -- Current Relationship 1-4
alter table stakeholder_map add column if not exists target_rel          smallint;  -- Target Relationship 1-4
alter table stakeholder_map add column if not exists primary_responsible text;
alter table stakeholder_map add column if not exists alternate           text;
alter table stakeholder_map add column if not exists gift_tier           text;

-- Helpful index for the project-scoped list (ordered by name).
create index if not exists stakeholder_map_project_name_idx
  on stakeholder_map (project_id, name);
