-- ============================================================================
-- Migration: SPLIT a main-contract activity around a CHANGE ORDER.
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- THE PROBLEM. A variation is rarely a tidy activity bolted onto the end of the
-- schedule. "Additional slab openings on L5" happens PARTWAY THROUGH Formworks
-- L5: the main-contract crew stops, the CO work happens, the crew resumes. On
-- the Gantt that is one line item whose bar is split in two with the change
-- order sitting in the gap.
--
-- WHY TWO ACTIVITIES AND NOT ONE ACTIVITY THAT KNOWS IT IS SPLIT. The tidier
-- model is a single activity carrying a list of suspend/resume spans (P6's
-- idiom). It was rejected on purpose: it would mean teaching the CPM forward and
-- backward passes, the Gantt, the WBS roll-ups, the vertical stacking, the
-- S-curves and every export about a new kind of thing. Two ordinary activities
-- need none of that — every one of those consumers already understands
-- activities — and this module has been bitten repeatedly by clever derived
-- representations drifting out of step with the data (the WBS code that was
-- secretly the tree; phase inheritance; the dotted-prefix roll-up). Two boring
-- rows cannot drift. The single-row APPEARANCE is a rendering concern, and
-- `split_group` is what the renderer joins on.
--
-- WHY THE FINISH EXTENDS. seg1 + CO + seg2 finishes later than the original
-- activity did, and successors move with it. That is the honest CPM result and
-- it is what evidences the variation's time impact; holding the original finish
-- and compressing the remainder would hide exactly the thing a CO claim is
-- about.
-- ============================================================================

-- ---- 1) The columns --------------------------------------------------------
-- split_group: shared by every segment of one original activity (and null on an
-- activity that has never been split, which is almost all of them). Not a
-- foreign key: the group has no row of its own — it IS the set of segments, and
-- inventing a parent row would put the same fact in two places.
alter table project_schedule add column if not exists split_group text;
-- split_seq: 1-based order of the segment within its group. Explicit rather than
-- inferred from dates, because dates move: rescheduling must never silently
-- reorder "part 1 of 3" and "part 2 of 3".
alter table project_schedule add column if not exists split_seq   int;

-- ---- 2) Keep the pair honest ----------------------------------------------
-- Both together or neither. A split_seq with no group is meaningless, and a
-- group member with no sequence has no defined position in its own line item.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_schedule_split_pair_chk') then
    alter table project_schedule add constraint project_schedule_split_pair_chk
      check ((split_group is null and split_seq is null)
          or (split_group is not null and split_seq is not null and split_seq >= 1));
  end if;
end $$;

-- One index, on the lookup the renderer actually does: "give me every segment of
-- this group, in order".
create index if not exists project_schedule_split_group_idx
  on project_schedule (project_id, split_group, split_seq);

-- ---- 3) No back-fill -------------------------------------------------------
-- Nothing to seed. An un-split activity has null/null and renders exactly as it
-- does today, which is the point: this migration changes no existing behaviour.

-- Done. Right-click a main-contract activity -> "Insert change order here…".
