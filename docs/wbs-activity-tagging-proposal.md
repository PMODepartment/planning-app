# Proposal — Activity-type WBS branches, detected and tagged (an "Activity Breakdown" beside the Location Breakdown)

**Status: proposal. Nothing here is implemented.** Captured 2026-09-03 from the owner's report on
**4PH Strevi Bacoor**, whose schedule was imported from XML.

Owner: *"the breakdown of WBS is not the same as what was intended in the schedule setup of just
purely locations. It also involves activities. So propose a feature wherein it detects those
activities (e.g. Masonry, Dry Works) as WBS and assign them to a tagging just like the purpose of
'location breakdowns'."*

---

## 1. The problem, stated precisely

**Schedule Setup builds a WBS whose every level is a place.** `pushToSchedule` creates
`trade › tower › floor › zone › unit` and nothing else, and the whole downstream stack assumes that:
`_nodeTrade()` reads the trade off the branch directly under the root, the Location Wizard matches
branch names to `location_levels`, and Vertical Stacking draws a building out of the zone level.

**An imported P6/XML WBS does not honour that.** A real planner's tree interleaves *places* and
*kinds of work* at the same depth, with no marker saying which is which. From 4PH Strevi, already
recorded in `modules/project-schedule/CLAUDE.md`:

```
… › Cluster 2 (Units 07 to 12) › Masonry Works      ← place, then KIND OF WORK
… › Fire Exit 2               › Wet Works           ← place, then KIND OF WORK
… › Dry Works                                       ← kind of work, no place at all
```

`Masonry Works`, `Wet Works` and `Dry Works` are **activity classes**, not locations. Today they are
structurally indistinguishable from `Cluster 2` or `Fire Exit 2`, and four consequences follow:

1. **The Location Wizard offers them as locations.** Its candidate list is "WBS branch names", so a
   planner is asked whether `Dry Works` is a Tower, a Level or a Zone. The honest answer is *none of
   these*, and there is no way to say so — so it is either mis-tagged or silently skipped, and a
   skipped branch means every activity under it has no location at all.
2. **Grouping by a location dimension drops them.** `buildNodes()` deliberately refuses to sweep
   valueless activities into an `— Unassigned —` bucket, so work under a purely activity-named
   branch disappears from a Tower › Level › Zone view rather than showing up wrong. Correct
   behaviour, invisible cause.
3. **Vertical Stacking under-reports.** It is driven by the zone level; a branch that never resolved
   one contributes nothing to the building it genuinely belongs to.
4. **`work_type` is doing two jobs.** `project_schedule.work_type` is a single text column, and
   `workOf(r)` falls back to `_nodeTrade()` — the top branch under the root, i.e. the *trade*. There
   is nowhere to put "and within Architectural, this is **Masonry**", which is exactly the
   distinction the imported tree is carrying.

**This is not a data-cleanup problem.** The imported tree is *right*; the app's model of it is too
narrow. The fix is to give activity classes the same first-class treatment locations already have.

---

## 2. The shape: mirror the Location Breakdown exactly

The Location Breakdown (`migrations/2026-08-04-activity-location-work-type.sql`) already solved this
exact problem once — "location existed ONLY as WBS tree structure, so the tree was the one and only
way to group a schedule". The answer was to lift it out of the tree and onto the activity as data.
Do the same thing for activity classes, deliberately with the same shape, so the module's existing
dynamic-column / filter / grouping / wizard machinery applies **unchanged**.

### 2.1 `activity_levels` — an ordered, per-project list of activity dimensions

```sql
create table if not exists activity_levels (
  id uuid primary key default gen_random_uuid(),
  project_id  text not null,
  name        text not null,          -- 'Work Group', 'Work Class', 'Sub-trade' — the project's own words
  sort_order  int default 0,
  match       jsonb default '{}'::jsonb,   -- { "<WBS branch name>": "<value>" }, keyed by NAME
  created_by  uuid,
  created_at  timestamptz default now()
);
alter table project_schedule add column if not exists activity_values jsonb default '{}'::jsonb;
```

Field for field this is `location_levels` + `location_levels.match` + `project_schedule.location`.
That is the point: `allDims()` grows an `act:<level_id>` family beside `loc:<level_id>`, and the
Group menu, the column picker, the filter chips, `dimValOf`/`dimRawOf` and the "grouping also
filters" rule all work with no new concepts.

- ⚠️ **Keyed by branch NAME, not node id** — the same reasoning `location_levels.match` records:
  `Masonry Works` recurs under every cluster and every floor, so matching by name is one decision
  instead of hundreds, **and it survives a re-import that renumbers every node id.** A re-import is
  precisely when the mapping is needed.
- ⚠️ **A jsonb value map, not a node tree.** `Masonry Works` under two clusters is the same string.
  They stay separate because grouping NESTS the activity dimension under the location one; grouping
  by the activity dimension alone deliberately merges them ("all masonry, everywhere"), which is the
  trade-progress question a planner actually asks.
- ⚠️ **Tolerant of an un-run migration**, exactly like `PACKAGES` / `LOC_LEVELS` / `location_levels.match`:
  a missing table or column means "no activity levels", the family of dimensions is simply not
  offered, and nothing else changes. This must never be a hard prerequisite for opening a schedule.

### 2.2 The tree keeps its shape

**Nothing is re-parented and nothing is deleted.** The tag is *additional* metadata on the activity;
the branch stays exactly where the file put it. This is the single most important constraint in the
proposal — this module's changelog records repeated damage from passes that rewrote an imported tree
(`wbsAdopt` rooting 14 branches, `_wbsResyncCodes` then making it permanent, the SLN101 loss). A
tagging feature that only *reads* the tree cannot repeat any of that, and it can be re-run, undone,
or ignored at no cost.

---

## 3. The detector: which branches are places and which are kinds of work?

A new `_wbsClassifyBranches()` runs over the distinct branch names of the loaded tree and returns,
per name, one of `location` / `activity` / `unknown` **plus the evidence**. It is a *suggestion
engine for a dialog*, never an automatic writer.

Signals, strongest first:

| # | Signal | Why it is trustworthy |
|---|--------|----------------------|
| 1 | The name matches a **class code** in `CLASS_CODES` (Finance's 702-code chart) or a class code already used in this project's Schedule Setup | This is the vocabulary that *defines* an activity class. `Masonry`, `Waterproofing`, `Tiling`, `Painting` are all in it. Highest confidence, and it is org-wide reference data that is already loaded. |
| 2 | The name matches a **trade / work-group vocabulary** — `Wet Works`, `Dry Works`, `Fit-out`, `Rough-in`, `Finishes`, `Site Works`, `<trade> Works` | Small, explicit, reviewable list. Deliberately a list and not a regex over "Works": `Site Works` and `Tower A Works` differ. |
| 3 | The name matches a **location vocabulary** — `Level/Floor/Fl/L<n>`, `Basement/B<n>`, `Podium`, `Roof Deck`, `Tower <x>`, `Building <x>`, `Cluster <x>`, `Zone <x>`, `Unit <x>`, `Wing`, `Block`, `Fire Exit <n>` | The complement. It is what Schedule Setup itself generates, so it is also the set the Location Wizard is good at. |
| 4 | **Sibling homogeneity** — a branch whose siblings are overwhelmingly one class is very likely that class | An imported tree is regular locally even when it is irregular globally. `Cluster 1 … Cluster 6` and `Masonry / Wet / Dry Works` are each internally consistent. |
| 5 | **Depth consistency** — the same name at the same depth under many parents | `Masonry Works` appearing as a leaf-most branch under 40 clusters is a dimension, not a place. |
| 6 | **A location value already resolves** for activities under it | If the Location Wizard already tagged it, it is a location; do not offer it twice. |

⚠️ **`unknown` is a first-class answer and must stay one.** Guessing is what put `Dry Works` in the
Location Wizard's list in the first place. An unclassified branch is *shown* to the planner as
unclassified, with the count of activities it holds, and is left untagged until they say. Every
existing conservative default in the import path (`_impGuessTarget` defaulting to "its own top-level
branch", `_wbsNameKey` refusing to fold distinct words) is the same instinct.

---

## 4. The user-facing surface

### 4.1 "Activity tagging" — a wizard beside the Location Wizard

Reached the same way, and laid out the same way, so a planner who has used one has used both. One
row per distinct branch name, grouped by the detector's verdict, each row showing:

- the branch name, and **how many activities sit under it** (the number that says whether the row matters);
- the verdict + the signal that produced it, in words: *"class code — Masonry (Finance 03-xx)"*, *"looks like a place — Cluster &lt;n&gt;"*;
- a select: which **activity level** this branch feeds (`Work Group`, `Work Class`, …), or `—` to leave it alone;
- the **value** to write, pre-filled with the name, editable — so `Masonry Works`, `MASONRY WORKS` and `Masonry` collapse to one value.

Bulk actions do the real work: *"tag all 6 detected class-code branches into Work Class"*. Nobody
should click 40 rows.

Every decision is written to `activity_levels.match`, so:

- it is **re-applied automatically on the next import** — which is the whole reason `match` exists on
  `location_levels`, and the whole reason a planner is willing to spend ten minutes on this dialog;
- it is **editable afterwards** on the same screen the Location Breakdown levels are managed on
  (rename, reorder, merge two levels — the `location_levels` manager already has all four).

### 4.2 The Schedule Setup side

Schedule Setup's step **9 · Scope per zone** already answers *which class codes apply to which
location* — i.e. the app's own model is **location × activity class** even though the WBS it pushes
only expresses the location half. So Setup's push should **also** write `activity_values` (the class
code / trade of each generated activity) rather than leaving the activity half implicit in the branch
name. Two consequences worth having:

- an imported schedule and a generated one become **groupable the same way**, which they are not today;
- the WBS step's promise — "the branches this setup needs" — stops being the only place the activity
  dimension is recorded, so a planner can regroup without re-pushing.

### 4.3 Where the tag pays off

- **Group by** `Tower › Level › Work Class` — the view 4PH Strevi's tree is shaped for and the grid
  cannot currently produce.
- **Filter** to one work class across the whole project ("show me all masonry").
- **Vertical Stacking** per work class instead of per pushed trade branch.
- **Progress and S-curves per class**, which is what `phaseOf`/`workOf` roll-ups already do for
  trade — one more dimension through the same code.
- **Procurement (WPM).** `work_packages.cost_code` is the same Finance code as `CLASS_CODES`, and
  `modules/project-schedule/CLAUDE.md` calls that the *only* vocabulary the two apps genuinely share.
  Tagging with it is what makes a work package's scope **derivable** from an imported schedule
  (group activities by class × location) instead of hand-linked — which is the case for signal #1
  above being the strongest one.

---

## 5. What is deliberately *not* proposed

- **No automatic tagging.** The detector proposes; the planner decides. See §3.
- **No tree rewriting.** No re-parenting, no renaming, no deleting. See §2.2.
- **No new `work_type` semantics.** `work_type` stays the trade, and `workOf()` keeps its current
  meaning, so nothing that reads it changes. The activity levels sit *beside* it, finer-grained.
- **No hard migration dependency.** Un-run migration ⇒ the feature is absent, not broken. See §2.1.
- **Not a replacement for the Location Wizard.** It is its sibling: the wizard now has a defensible
  answer for the branches it should never have been offering, which is *"that one is not a place."*

---

## 6. Rough sequencing

| Step | Work | Notes |
|------|------|-------|
| 1 | `migrations/<date>-activity-levels.sql` | Copy `location_levels` + `match` + the RLS/grant pattern verbatim. |
| 2 | `ACT_LEVELS` load + `act:<id>` dimensions | Mirrors `LOC_LEVELS` / `loc:<id>`; tolerant load. Grouping, columns and filters come along for free. |
| 3 | `_wbsClassifyBranches()` + a slice-and-execute suite | Pure function over `(WBS_NODES, rows, CLASS_CODES)` — no I/O, so it is fully testable against the 4PH Strevi tree before any UI exists. Build this against real branch names. |
| 4 | The Activity-tagging wizard | Reuse the Location Wizard's dialog, list and bulk-action shape. |
| 5 | Re-apply `match` on import | Alongside the existing location matching, in the same pass. |
| 6 | Schedule Setup writes `activity_values` on push | §4.2. Last, because it is the only step that changes what a push produces. |

Steps 1–3 are independently useful: with the detector landed and nothing else, the Location Wizard
can already stop offering `Dry Works` as a Tower.

---

## 7. Open questions for the owner

1. **How many activity levels does a project need?** One (`Work Class`) covers 4PH Strevi. Two
   (`Work Group` → `Work Class`, e.g. `Wet Works` → `Masonry`) matches how the imported tree is
   actually nested. The table is an ordered list either way, so this is a default, not a limit.
2. **Should the value default to the Finance class code, or to the branch name as written?** The code
   is what makes §4.3's Procurement link work; the name is what the planner recognises. Storing the
   code and *displaying* the name is possible but is a third concept.
3. **Is `Site Works` a place or a kind of work?** It is in `WBS_SKELETON`'s Execution Phase as a
   branch and reads as both. Worth settling once, in the vocabulary list, rather than per project.
