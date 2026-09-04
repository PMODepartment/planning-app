# Proposal — Define the breakdowns FIRST: a two-pane LBS / ABS step in Schedule Setup

**Status: slices 1 and 2 shipped 2026-09-04 (see `modules/project-schedule/CLAUDE.md`). Slices 3-5 are still proposal only.**
Companion to [`wbs-activity-tagging-proposal.md`](wbs-activity-tagging-proposal.md), which specifies the
`activity_levels` half. This one specifies the **location** half, the **step** that edits both, and —
because it is the owner's explicit constraint — a clause-by-clause account of **what it must not
break**.

Owner, 2026-09-04:

> *"what if instead of defining the number of floors basements and the typical podium or basement etc.,
> there should be an earlier step in defining the locations and groupings of activities … on the left
> pane, users could define the level 1 locations (e.g. towers), and then level 2 locations (e.g. levels
> / floors), and then level 3 locations (e.g. zones or substructure or superstructure etc.) … and on the
> right pane is the groupings of activities wherein level 1 can be trades … level 2 is the groupings of
> activities like Wet Works and then level 3 is something like waterproofing. And then after that step,
> that is then shown in an illustration what the zoning of per trade would look like in a vertical
> stacking view. However no logic whatsoever should be conflicted. The purpose is to mitigate the
> difficulty of the matching of WBS especially when a schedule is migrated."*

---

## 1. Why the current shape makes migration hard

Today the location breakdown is assembled from three places that were built at different times and
never introduced to each other:

| what | where it lives | shape |
|---|---|---|
| the **dimensions** (Tower / Level / Zone / Unit) | `location_levels` rows | a project-wide ordered list |
| the **places** (Tower 1, B2, Ground Floor, Zone 1) | `cfg.zoning[trade].floors[].zones[].units[]` | **per trade**, inside the setup JSON |
| the **values on activities** | `project_schedule.location` jsonb, keyed by level id | free strings |

Three consequences, all of which this session has hit:

1. **There is no list of the project's places.** The set of legal Level values is whatever strings
   happen to be in `cfg.zoning` *or* on an activity — so the WBS matcher has to offer a **free-text
   box** and the planner types the value for every branch. That is the "difficulty of matching" in
   the report.
2. **Places are per-trade, so the same floor is authored many times.** `Copy Structural floors/zones →
   all trades` exists precisely because of this. A migrated schedule has one building, not one per
   discipline.
3. **A migrated schedule arrives with the tree already built** — its WBS *is* the breakdown — and the
   setup has no way to say "these branches are my places, adopt them". So the planner re-types them.

The proposal's core move: **make the places a first-class, project-wide list**, authored before the
per-trade work, and make the matcher pick from it instead of accepting free text.

---

## 2. The step

A new step, before *Floors & Zones*, with two panes.

### 2.1 Left pane — the Location Breakdown (LBS)

An indented tree; each row is a place, its level is its depth, and its **type** is a tag on the row.

```
L1  Tower 1
      L2  Basement            [basement]
      L2  GF                  [podium]
      L2  2nd Floor           [typical]
            L3  Zone 1
            L3  Zone 2
      L2  Roof Deck           [roof]
L1  Tower 2
      L2  Basement            [basement]
      L2  Roof Deck           [roof]
```

- The **level names** (L1 = Tower, L2 = Level, L3 = Zone) are the existing `location_levels` rows,
  edited in the pane header. Unchanged table, unchanged meaning.
- The **type** tag is the existing `floor.kind` (`basement` / `podium` / `typical` / `roof`) — the
  vocabulary the Trade-sequence step already groups by. It is a property of a place, not a level.
- Depth is capped by the number of `location_levels`. A project with four levels can nest four deep.

### 2.2 Right pane — the Activity Breakdown (ABS)

The same widget over the `activity_levels` table proposed in the companion document.

```
A1  Structural Works
      A2  Wet Works
            A3  Waterproofing
            A3  Plastering
      A2  Dry Works
A1  MEPF Works
      A2  Roughing-in
```

- A1 defaults to the existing `GROUPS` trades so an existing project starts populated and correct.
- A2/A3 are the *kinds of work* a migrated WBS interleaves with places — the exact shape
  `wbs-activity-tagging-proposal.md` §1 describes on 4PH Strevi (`Cluster 2 › Masonry Works`).

### 2.3 Below both — the stacking preview

The existing tower drawing, rendered from the LBS tree instead of `cfg.zoning`, with a trade selector.
It answers *"if I push this, what will the Vertical Stacking look like?"* **before** the push rather
than after — which is the loop this whole session has been debugging one screenshot at a time.

### 2.4 The payoff: matching becomes picking

*Match WBS to locations* stops being a free-text form. Each WBS branch gets **two dropdowns** — a
place from the LBS tree, or a grouping from the ABS tree, or *neither*. Consequences:

- a value can no longer be typed two ways (`Tower D` vs `TOWER-D`), which is the whole reason
  `locTowerToken` had to be written;
- *Substructure* is unambiguous the moment it is a **node** in one tree or the other, so the
  `locGroupingReason` heuristic — and the assigned/excluded overrides layered on it this week —
  become a **fallback for unmatched branches only**;
- **Adopt from the WBS**: a button that walks the imported tree and offers to create LBS/ABS nodes
  from the branches it already has. For a migrated schedule this is the whole job, once.

---

## 3. ⚠️ What must not break — the constraint, taken literally

The owner's *"no logic whatsoever should be conflicted"* is the hard part of this proposal, not the
UI. Each existing behaviour, and how it survives:

| existing behaviour | why it might conflict | resolution |
|---|---|---|
| **Per-trade zoning** (`cfg.zoning[trade].floors`) — trades genuinely have different floors | the LBS is project-wide | The LBS is the **catalogue of places**; which places a trade touches stays in step 9 *Scope per zone*, which already has `cfg.scopeOff` for exactly this. **No trade loses the ability to differ.** The per-trade lists become a *selection over* the catalogue rather than a private copy of it. |
| `location_levels` and its `match` table | the LBS adds nodes | Levels are unchanged. `match` keeps working; the dropdown simply writes the same value it writes today. |
| The `location` jsonb on every activity | it stores **strings**, not node ids | ⚠️ **Keep storing strings.** Storing node ids would orphan every existing row and every imported one. The LBS node supplies the string; it does not replace it. This is the single most important constraint in the document. |
| `locTowerToken`, `locGroupingReason`, the assigned/excluded overrides | they guess what the LBS would now know | They stay, unchanged, as the fallback for branches nobody has matched. A guess that is never consulted costs nothing; deleting it would break every project that has not run the new step. |
| `floor.kind` and the Trade-sequence step | the type tag moves into the LBS | Same field, same values, edited in a new place. The consumer does not change. |
| `towerId` on floors, `multiTower()` | L1 becomes the tower | Same field. A one-node L1 still means one tower, and the WBS still skips a single-tower level. |
| The push (`buildTree`, `dimKey`, `dimOrderIndex`) | it reads `cfg.zoning` | It keeps reading `cfg.zoning`, which is **derived from** the LBS rather than typed. `generate()` is untouched. |
| Existing saved setups | they have no LBS | ⚠️ **The LBS is derived on first open** from `cfg.zoning` + `cfg.towers` + `location_levels`, so a project that never opens the new step behaves exactly as it does today. The step is *additive*. |

⚠️ **The rule that makes all of the above safe:** the new step is an **authoring surface over the data
that already exists**, not a new source of truth. Nothing downstream learns a new format.

---

## 4. Storage

One new table, mirroring `location_levels`' shape and the companion proposal's `activity_levels`:

```
location_nodes                          activity_nodes
  id            uuid pk                   id            uuid pk
  project_id    uuid                      project_id    uuid
  level_id      uuid -> location_levels   level_id      uuid -> activity_levels
  parent_id     uuid -> location_nodes    parent_id     uuid -> activity_nodes
  name          text     -- the VALUE written to location jsonb
  kind          text     -- basement | podium | typical | roof   (LBS only)
  sort_order    int
```

⚠️ `name` is the value, not a label. That is what keeps §3's string rule true.
⚠️ Both tables are **optional**: absent → the step derives its tree in memory and the rest of the
module is unaffected, exactly as `packages` and `activity_udf_defs` already degrade.

---

## 5. Deliberately not proposed

- **No re-parenting of existing activities.** The step edits the breakdown, never the schedule.
- **No removal of the free-text box.** It becomes the escape hatch for a branch the trees do not
  cover; removing it would make an unmatched branch unmatchable.
- **No numbering scheme** (`L1`/`L2` are the display, not stored ids) — same reasoning as *BL0* vs an
  invented *BL1*.
- **No change to `generate()`, the sequencing, or the push.** They read `cfg.zoning`, which continues
  to exist.

---

## 6. Sequencing, smallest useful first

1. ✅ **SHIPPED 2026-09-04 — derive-from-existing**, as `ScheduleBuilder.locCatalogue()`. The tree EDITOR is not built; the derived catalogue is. **LBS tree editor + derive-from-existing.** Read-only value for the planner immediately: one place
   that shows the project's actual places. No consumer changes.
2. ✅ **SHIPPED 2026-09-04** — a datalist of the defined places per level, a defined/near-miss/new badge, and one explicit "adopt the defined spelling" button. The free-text box is kept. **Matcher picks from the tree** (dropdown beside the free-text box). This alone is most of the
   "mitigate the difficulty of matching" benefit.
3. **Adopt from the WBS.** The migration button.
4. **ABS tree** (needs `activity_levels` from the companion proposal).
5. **Stacking preview in the step.**

Each step is shippable alone and none of them requires the next.

---

## 7. Open questions for the owner

1. **Is per-trade zoning still wanted at all?** §3 preserves it, but if every trade in practice uses
   the same places, *Scope per zone* could become the only per-trade surface and the copy buttons
   could go. That is a simplification, not a fix — worth deciding deliberately.
2. **Should the LBS depth be free, or capped at `location_levels`?** Capped is proposed; free would
   mean the levels list stops describing the tree.
3. **When a branch is matched to an ABS node, should the activity store it?** The companion proposal
   says yes (`act:<id>` beside `loc:<id>`). Confirm before either is built.
4. **Order of work** — §6 as listed, or the matcher dropdown first?
