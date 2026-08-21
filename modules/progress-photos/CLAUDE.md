# Module: progress-photos

Developer change log for the **progress-photos** module. Update every PR.

## Works: exclude floor-completion milestones, scope choices to the selected Trade
## (2026-08-13c)
Owner tested the previous entry live and flagged two remaining defects in the same Works
datalist: floor-level milestones ("10th Floor", "11th Floor", …) were showing up as if they were
real work activities, and picking a Trade did nothing to narrow the choices — the screenshot
showed "Structural Works" selected while the Works dropdown still offered unrelated floor names
and only one genuine activity.
- **Floor markers excluded.** They weren't WBS Summary rows (already excluded) — they're real
  Project Schedule rows with `activity_type` **`Start Milestone`/`Finish Milestone`**, and a
  schedule commonly names a floor-completion milestone after the floor itself. `distinctScheduleWorks()`
  now excludes both milestone types explicitly, leaving only genuine `Task` rows (and anything with
  no/other type, so a legacy row that predates consistent typing isn't hidden by accident).
- **Works now scoped to the picked Trade**, per the owner's explicit ask ("all activity under that
  trade will be the choices for the works, to avoid wrong selection of works under a specific
  trade"). Project Schedule's own Discipline/Trade grouping lives in `project_schedule.work_type`
  (added to `loadSchedule()`'s select) as one of **8 canonical buckets** — General Requirements /
  Site Works / Structural Works / Architectural Works / MEPF Works / Site Development / Allied
  Services / Others (see `modules/project-schedule/index.html`'s `GWORK`/`WORK_ORDER`). This
  module's own Trade vocabulary is **finer-grained** — it mirrors the WPM procurement list and
  splits MEPF into Mechanical / Electrical and Auxiliary / Plumbing and Sanitary / Fire Protection —
  so one Trade maps to several `work_type` keywords, matched case-insensitively (`workTypeMatchesTrade`
  + `TRADE_WORK_TERMS`) rather than by exact string equality, so a schedule using slightly different
  wording still matches on its own vocabulary. Picking any of the four MEPF-side trades correctly
  offers the SAME activities (the schedule doesn't discriminate further than "MEPF Works") — this
  is the honest limit of the real data, not a bug.
- **New `wireTradeWorks(idPrefix)`**: seeds the Works datalist from the modal's current Trade value
  on open (so the Edit modal, which pre-fills an existing photo's Trade, is correctly scoped from
  the moment it opens, with no re-touch needed) and re-scopes it live on every Trade change in both
  the Add and Edit modals. `worksOptions(tradeFilter)` also scopes the union half (values already
  typed on this project's own captured photos) to photos captured under that same Trade
  (`distinctCapturedWorks`), so a stale unrelated free-text entry from a different trade doesn't
  leak into a newly-scoped list. Leaving Trade blank still shows everything (unchanged from before).
- Harness-verified (fresh v9 fixture, 10 schedule rows incl. 2 floor milestones, 1 WBS Summary, and
  Task rows spanning Structural/Site/Architectural/MEPF `work_type`s): no-trade-selected datalist
  showed exactly the 6 real activities (milestones and the summary row absent); selecting
  "Structural Works" narrowed to exactly its 2 activities; "Electrical and Auxiliary Works" and
  "Fire Protection Works" both correctly resolved to the same 2 MEPF-bucketed activities;
  "Architectural Works" isolated to its own 1 activity; clearing back to blank restored all 6; the
  Edit modal on a photo already tagged "Structural Works" opened already scoped to its 2 activities
  with no extra interaction. No functional console errors (only the same harmless stub artifacts
  noted in the prior entry).
- Assets bumped `module.js?v=20260813c` (module.css unchanged this round).

## Live-app follow-up: Works had no choices, capture fields weren't actually required
## (2026-08-13b)
Two bugs found testing the previous entry's rebuild against the real deployed app on Avesta
Residences: the Works field's datalist was empty (screenshot showed only "e.g. Temporary
Facilities" placeholder text with no suggestions), and Capture date / Trade / Works / Location
Breakdown were all skippable despite reading as important fields.
- **Works datalist was scoped to the wrong source.** It only ever built from `distinct('works')`
  — values already typed on this project's OWN captured photos — so a brand-new project (or one
  where nobody had typed a Works value yet) showed nothing at all. New `distinctScheduleWorks()`
  reads distinct `activity_name` values off `SCHED_ACTS` (the same Project Schedule activities
  already loaded for the Location Breakdown feature) and `worksOptions()` unions it with the
  existing captured-values list, so both sources suggest and neither is lost.
  ⚠️ **Deduplicated by NAME, not by row** — a real schedule commonly repeats an activity name
  across many WBS branches/floors (e.g. "Rebar Installation" on every level of every tower), and
  offering one option per *row* would flood the datalist with hundreds of duplicate strings.
  WBS Summary rows are already excluded upstream (`loadSchedule`'s `.neq('activity_type','WBS
  Summary')`), so they don't leak into Works either.
- ⚠️ **Fixed a load-order gap that would have silently limited this on the FIRST page view.**
  `init()`/the project-switch handler called `renderLocFilterSelects()` after `loadSchedule()`
  finished, but never re-ran `fillFilterOptions()` (which builds the Works datalist) — so
  `SCHED_ACTS` would be populated in memory but the Works datalist would still reflect whatever
  it was built from during `load()`, which runs *before* `loadSchedule()`. Both call sites now
  call `fillFilterOptions()` (a superset — it already calls `renderLocFilterSelects()` internally)
  after `loadSchedule()`.
- **Capture date, Trade, Works, and Location Breakdown (at least one level) are now required**
  in both the Add-photos and Edit-photo modals. These fields live in a plain `<div>`, not a
  `<form>`, so the native `required` attribute (added for semantics/accessibility) has no
  automatic enforcement — the actual gate is a new `requiredFieldsMissing(idPrefix)` check called
  at the top of both save handlers, returning a specific message ("Capture date is required." /
  "Trade is required." / "Works is required." / "Select at least one Location Breakdown value.")
  shown via `UI.toast('...', 'warn')`, save aborted (row untouched, modal stays open).
  ⚠️ **Location Breakdown requires only ONE filled level, not every level** — a capture legitimately
  stopping at "Tower B" with no Level/Zone picked is still valid per the design in the entry below
  ("a capture can stop at any depth is a deliberate choice"); the new rule only forbids submitting
  with **zero** Location Breakdown values at all. The section header now shows a red `*` + "(at
  least one level)" hint; Description stays optional (unchanged).
- Harness-verified (fresh v8 fixture, 3 location levels, 6 schedule activities including a
  repeated-name pair across two WBS branches and one WBS-Summary row to prove exclusion, run via
  a real local HTTP server rather than `file://` — this environment's Browser pane renders
  `file://` pages as inert static snapshots this session, unlike earlier rounds, so a throwaway
  PowerShell `HttpListener` static server was used instead): Works datalist showed exactly
  `Formworks / MEP Rough-in / Rebar Installation / Site Grading` (4 options, not 5 — the repeated
  name deduped, the WBS Summary row excluded); Add-modal save sequentially blocked on Trade →
  Works → Location Breakdown with the correct message each time, then succeeded once all four were
  filled (row persisted with correct `trade`/`works`/`location_values`/`activity_id`/
  `activity_name`); Edit-modal save blocked identically when Works was cleared. No functional
  console errors (only expected stub artifacts — fake `blob:` image URLs and one cosmetic 404 for
  a shared stylesheet outside the throwaway server's root).
- Assets bumped `module.css/js?v=20260813b`.

## Rebuilt the location picker onto Project Schedule's real "Location Breakdown" system, not
## wbs_nodes (2026-08-13)
Owner's correction after confirming the full WBS tree now renders (previous entry): **"it should
show the Location Breakdown options not the WBS."** Project Schedule has a second, purpose-built
location system, entirely separate from the generic `wbs_nodes` tree this module had been reading —
confirmed by code inspection (research agent) before touching anything, per the standing "inspect
before coding" instruction.
- **The real data model**: `location_levels` (`{id, project_id, name, sort_order, match}` — a
  per-project, **ordered list of free-form level names**, e.g. Tower/Level/Zone, no fixed count or
  labels) + `project_schedule.location` (jsonb `{"<location_level_id>": "value string"}` — one plain
  string per level, **not a node tree**: two activities with the same string under the same level are
  literally the same value, there's no parent-child FK to walk). This is architecturally distinct
  from `wbs_nodes`/the WBS Manager tree, which Project Schedule keeps for structural breakdown only —
  conflating the two was the exact mistake being corrected.
- **Project Schedule's own UI for this is `<input>` + `<datalist>` free text, not `<select>`, and NOT
  hard-cascading** (`locValuesFor(levelId)` just scans loaded rows for distinct values with no
  cross-level filtering) — this module now matches that convention exactly rather than inventing a
  stricter one, so a value schedule planners already typed is always pickable and a not-yet-typed
  one can still be entered fresh.
- **Replaced the entire WBS cascade with a Location Breakdown cascade**: `LOC_LEVELS` (was
  `WBS`/`WBS_BY_ID`/`WBS_LEAVES`) loads `location_levels` ordered by `sort_order`; one `<input
  list=…>` + `<datalist>` per level (`locFieldsHTML`/`locLevelFieldHTML`), each level's datalist
  built by `distinctLocValues(levelId, priorVals)` — a **soft cascade**: prior levels' current values
  narrow the datalist suggestions (UX convenience only, verified: picking "Tower B" narrows Level to
  just "Ground Floor" and empties Zone), but typing an unlisted value is never blocked, since the
  underlying data has no enforced parent-child link to block against.
- **`wbs_node_id` is no longer written by new captures.** New `progress_photos.location_values` jsonb
  column mirrors `project_schedule.location`'s shape exactly (migration
  `../../migrations/2026-08-12-progress-photos-location-breakdown.sql`, folded into
  `supabase-schema.sql`. **User must run it** — until then the column is missing and
  `tolerantWrite`'s missing-column retry silently drops it, same tolerance pattern as
  `activity_id`/`activity_name`). `wbs_node_id` itself is untouched/not migrated — it just stops
  being written; existing rows keep whatever they had.
- **Activity resolution + "last captured here" now match by subset-equality on `location_values`**
  (`resolveActivity`/`lastCaptureAt`) — a pick matches any schedule row/photo whose `location` (or
  `location_values`) agrees on every **non-empty** key in the current pick, so stopping at "Tower B ›
  Ground Floor" with no Zone still resolves correctly (verified: resolves "Site Grading" with no Zone
  needed), and two same-Tower/Level-different-Zone activities correctly disambiguate once Zone is
  picked (verified: Zone 1 → "Rebar Installation", Zone 2 → "MEP Rough-in").
- **Photos-page filtering** is now one `<select>` per location level (`renderLocFilterSelects`,
  replacing the old descendant-inclusive WBS-node filter — there's no node tree to be descendant-
  inclusive over now), each populated from **distinct values actually present on captured photos**
  (`distinctPhotoLocValues`), narrowing `visible()` by exact per-level match.
- **Today's Rounds now enumerates distinct location-value combinations** (`locCombos()`) across
  schedule activities, keyed by joining each level's value with U+241F (`␟`, an internal dedup key
  only — never shown) since there's no single node id to key off anymore. Recent/Other split,
  walkthrough chain (Skip/End), and Capture-from-Rounds all carry `{key, values, label}` combos
  through `_roundsComboByKey` instead of node ids.
- **Bug found + fixed during this pass**: "End walkthrough" (early exit) only closed the modal and
  nulled `walkState`, unlike natural completion which also clears `roundsSelected` and re-renders —
  so ending early left the selection bar showing stale "N selected" with boxes still checked. Now
  matches natural completion (`m.close(); walkState = null; roundsSelected = {}; renderRounds();`).
- Harness-verified end-to-end against a fresh v7 fixture (3 `location_levels` Tower/Level/Zone, 3
  schedule activities incl. two sharing Tower A/5th Floor with different Zones for disambiguation +
  one Tower B/Ground Floor with no Zone for stop-early matching, one seeded photo): per-level filter
  selects, Add-photos picker (input+datalist, soft cascade, breadcrumb, activity resolution,
  disambiguation), a real save persisting `location`/`location_values`/`activity_id`/`activity_name`
  with **no `wbs_node_id`**, Photos-page filter narrowing 2→1, Rounds enumerating 3 combos split
  Recent/Other, walkthrough Start → pre-filled modal (breadcrumb + resolved activity + "last
  captured here" reference photo) → Skip advances "1 of 2" → "2 of 2" with the correct disambiguated
  combo → natural completion clears selection, **and the End-walkthrough bug above, both before and
  after the fix**, Edit-modal pre-fill (existing `location_values` correctly populates all three
  inputs) with the "Location label" field proven independent (changing Zone recomputes the breadcrumb
  + resolved activity live but never touches the typed label), and the save round-trip. No console
  errors beyond expected `file://` favicon 404s (noted as harmless in every prior round).
- **Not re-verified this round** (unchanged plumbing, not touched by this rewrite): the offline blob
  queue's failure/retry/Sync-now cycle — it treats the whole row as opaque metadata and was already
  confirmed to not care about field shape in the 2026-08-11 entry; re-deriving that generic result
  wasn't repeated in the interest of not gold-plating what didn't change.

## Bug fix: live "WBS Location" only showed one root node (2026-08-12b)
Reported live on Avesta Residences (real screenshot: the depth-0 select showed only
"Milestones" instead of the project's real Construction/Tower/… tree) — the previous entry's
harness never caught this because a stub of a few dozen fake rows can't reproduce a
**row-count** bug.
- **Root cause**: `loadSchedule()`'s `wbs_nodes` (and `project_schedule`) reads were single,
  unpaginated `select()` calls. Supabase enforces a server-side row cap (commonly 1000)
  **regardless of any client `.limit()`**, silently truncating the result to whatever falls
  in the first page by sort order — this is the *exact* problem Project Schedule's own
  `load()` already had to solve for its schedule fetches (documented in its own CLAUDE.md),
  just never applied here. Avesta's real WBS (imported/built over time) exceeds 1000 rows;
  its real "Construction" branch simply wasn't in the truncated set that came back, while an
  early-created "Milestones" skeleton root was.
- **Fix**: new shared `fetchAllPages(table, selectCols, extraFilter)` — the same keyset-by-id
  pagination pattern (`order('id') + .gt('id', last)`, loop until a page returns <1000) this
  module's own `load()` already uses for `progress_photos`. Applied to both the `wbs_nodes`
  fetch and the `project_schedule` (SCHED_ACTS) fetch (which had a `.limit(5000)` that was
  **also silently capped to the server's real limit** — a client `.limit()` can't exceed it).
- **Verified the actual mechanism, not just "it looks right"**: harness seeded 1,201 real rows
  (1 root + 1,200 children, ids ordered so a naive fetch would cut off `Child 1001`–`Child
  1200`) against a fake backend that enforces the same 1000-row server cap Supabase does.
  Confirmed exactly 2 pages fetched, all 1,201 rows present in the picker (`Child 1001`/
  `Child 1200` included) — proving the fix, not assuming it from code review.
- No schema/behavior change beyond this — the picker logic from the entry below is otherwise
  unchanged.

## Phase 1 correction: no preset hierarchy at all — pure dynamic WBS, code-inspected
## first (2026-08-12)
Owner's explicit correction after reviewing the real Schedule/WBS Manager: **every** preset tried so
far (Location>Zone>Discipline/Trade, then Discipline/Trade>Tower>Level>Zone>Orientation) was still
assuming a shape. A WBS has none — confirmed by inspecting Project Schedule's actual code before
touching anything (not assumed): `wbs_nodes` is `{id, parent_id, code, name, sort_order}` with **no
node-type/category column whatsoever** — nothing distinguishes "this node is a location" from "this
node is a discipline" or a phase. Per-project depth and terminology are genuinely arbitrary.
- **Removed `WBS_LEVEL_LABELS` entirely** — no more hardcoded per-level names, in either direction.
  Each cascade `<select>` is now bare (no label above it) and shows real WBS data — the option text
  is `"<code>  <name>"`, reusing **Project Schedule's own convention verbatim** (its Add-Activity WBS
  dropdown, `wbsPickerOptions()`, formats options identically) rather than inventing a new one.
- **The resolved path is now its own dedicated, read-only breadcrumb** (`.pp-wbscrumb`, painted by
  `paintActCtx`) — e.g. `Construction › Construction Phase › Tower 1 › Structural Works ›
  Superstructure › Ground Floor › Zone 1 › Vertical`, matching the exact 8-level Avesta example in
  the brief. **The free-text "Location label" is no longer auto-filled from it** — it's a fully
  independent, purely optional caption now, so it can never be mistaken for or silently replace the
  structured WBS path (the breadcrumb is always visible regardless of what's typed there).
- ⚠️ **The stored `location` text column still gets the breadcrumb as a fallback when Location
  label is left blank** (`location: $('...-loctxt').value.trim() || breadcrumbOf(wbsNodeId) || null`)
  — this is a deliberate, narrow exception to "never auto-fill the label the user sees": it keeps
  search/List-View-Location/PPR display meaningful for the common case (no custom caption typed)
  without ever touching what's shown in the editable input itself.
- **Photos-page location filtering is now WBS-based, descendant-inclusive, per brief §13** —
  `pp-f-location` is populated by `wbsFlatOptionsHTML()` (a full flattened, indented, code+name walk
  of the whole tree, same convention as the cascade) instead of a distinct-text-values list. Picking
  a node matches that node **or any descendant** (`isNodeUnder`, already built for `resolveActivity`)
  — picking "Ground Floor" correctly returned photos captured at "Zone 1 › Vertical" several levels
  under it in the harness, and correctly returned 0 for an unrelated sibling branch.
- **No other behavior changed** — `resolveActivity`'s descendant matching, the offline blob queue,
  `tolerantWrite`/PDSync routing, Rounds (still WBS-leaf + capture-history driven, no separate
  location list), and the single `wbs_node_id` storage model were already correct per the brief's
  core requirement (§19: `Photo → wbs_node_id`, no `level_id`/`area_id`/`zone_id`) — confirmed by
  inspection, not rebuilt.
- **No data migration** — every existing `wbs_node_id` value was already a valid FK reference; only
  the picker's *display* logic changed, never what gets stored.
- **Harness-verified against the brief's own 8-level Avesta example** (`Construction ›
  Construction Phase › Tower 1 › Structural Works › Superstructure › Ground Floor › Zone 1 ›
  Vertical/Horizontal`, plus a sibling `General Requirements` branch and a second `Zone 2` to prove
  siblings/unrelated branches behave correctly): the cascade renders exactly 8 selects (no phantom
  9th level) with codes matching `4.2.1.1.2.1.1.1`-style dotted numbers; each depth's options are
  strictly that node's own children (verified depth 1 shows only `General Requirements`/`Construction
  Phase`, depth 6 shows only `Zone 1`/`Zone 2`); the breadcrumb matches the brief's example
  character-for-character; Location label stays empty through the whole drill-down; save persists
  the breadcrumb into `location` as a fallback + `wbs_node_id`/`activity_id`/`activity_name`
  correctly; the WBS filter is descendant-inclusive (Ground Floor → 2/2 photos) and correctly
  excludes an unrelated branch (General Requirements → 0/2); Rounds lists all leaves with
  unambiguous full paths. No console errors.

## Location picker rebuilt as a generic N-level WBS cascade: Discipline/Trade > Tower >
## Level > Zone > Orientation (2026-08-11c)
Owner's explicit second follow-up: the preset flips again — Discipline/Trade is now the **top**
tier (not a separate Activity-Code lookup layered on last, per the entry below), followed by
**Tower > Level > Zone > Orientation**, five tiers total.
- **Why this isn't an Activity Code any more:** a real schedule commonly puts discipline ABOVE the
  spatial breakdown — `Structural Works > Tower A > Level 5 > Zone 2` and `Architectural Works >
  Tower A > Level 5 > Zone 2` are two *different* WBS branches for the same physical space, not one
  branch with a discipline tag. So Discipline/Trade is now **WBS depth 0**, read the exact same way
  as Tower/Level/Zone/Orientation — no more `activity_code_types` name-matching, no more `discTag`/
  `existingDiscId` round-trip. `DISC_TYPE`/`DISC_VALUES`/`WBS_LOCATIONS`/`zonesInLocation` are gone;
  the generic Activity-Code overlay (for whatever *other*, unrelated code types a project has) is
  back to iterating every type with no exclusion, since there's no special one to skip anymore.
- **The picker is a fully generic N-level cascade**, not hardcoded to 3 or 5 selects:
  `wbsCascadeHTML()` walks `wbsChildren()` one depth at a time, rendering one `<select>` per depth
  up to wherever the real tree stops, labelled via `WBS_LEVEL_LABELS = ['Discipline/Trade', 'Tower',
  'Level', 'Zone', 'Orientation']` (a depth beyond those five falls back to "Level N"; a shallower
  branch — verified live: the Mechanical Works branch in the harness is only 4 deep — just doesn't
  render a 5th select, it doesn't fabricate an empty "Orientation" nobody can pick). Picking a level
  rebuilds every select from that depth down (`wireCascade` regenerates `#…-cascade`'s innerHTML and
  rewires it) — the simplest robust way to keep n cascading `<select>`s in sync without a framework.
- **A capture can stop at any depth** — "just this Tower" is a valid, deliberate choice, not an
  error state. `currentCascadeNodeId()` reads the deepest select that actually has a value.
  `resolveActivity()` correspondingly matches the picked node **or any of its descendants**
  (`isNodeUnder`), so stopping at "Level 5" still surfaces whichever activity is happening somewhere
  under it, instead of requiring the full 5-deep pick to find anything.
- **`breadcrumbOf()`/`wbsLeaf()` now work for ANY node id**, not only registered leaves — needed
  because a capture can legitimately target an intermediate depth. `WBS_LEAVES` (finest-grain nodes
  only) is still what Rounds enumerates, unchanged.
- ⚠️ **Labelling is positional (by depth), not by matching the node's real meaning** — if a
  project's actual WBS doesn't follow this exact 5-tier order on some branch, a node still gets
  whatever label its depth implies (e.g. a depth-1 node would read "Tower" even if it's actually
  something else). This is cosmetic, not a data-integrity problem: the stored value is always the
  real `wbs_node_id` the user actually clicked through to, correctly representing the tree — only
  the on-screen label for that step could read oddly on an irregular branch. Noted rather than
  solved: Project Schedule's own tooling (the "match WBS to locations" wizard) had to build
  keyword-based matching for exactly this irregularity in a different context (bulk classification);
  here the user is driving the cascade live and always sees the tree's real structure at each step,
  so it doesn't need the same fix.
- **Harness-verified against a 5-level tree built specifically to test the discipline-first
  design**: two disciplines (Structural Works / Mechanical Works) each with their OWN `Tower A >
  Level 5 > Zone 2` branch and a concurrent activity at each. Confirmed: the Edit modal reopens all
  5 levels correctly pre-selected for a 5-deep photo; switching Discipline/Trade at depth 0 correctly
  collapses and repopulates every deeper select; drilling through the Mechanical Works branch (only
  4 deep) resolves to "MEP Rough-in" and correctly does **not** render a 5th "Orientation" select;
  the Structural Works branch at the same Tower/Level/Zone names resolves to "Rebar Installation" —
  proving the two same-named physical branches never cross-resolve; a full save persists
  `location`/`wbs_node_id`/`activity_id`/`activity_name` correctly; Rounds still enumerates all 3
  real leaves with distinguishing full breadcrumbs. No console errors.

## Location picker restructured to the Location > Zone > Discipline/Trade preset (2026-08-11b)
Owner's explicit follow-up to the Phase 1 entry below: pull location/zone/area/activity from
Project Schedule on a **fixed 3-tier preset** rather than one flat WBS-leaf dropdown.
- **Location = a top-level WBS node** (`WBS_LOCATIONS`, depth-0 — the physical/spatial root: a
  building, site, tower). **Zone/Area = a WBS node under that Location** (`zonesInLocation()`) —
  Zone and Area are treated as the same tier, since a project's `wbs_nodes` is the one spatial
  hierarchy Project Schedule maintains; there's no separate "Area" table to pull from.
- **Discipline/Trade is deliberately NOT a WBS depth** — disciplines cut *across* zones (structural
  and MEP crews both work the same column grid), so it comes from the schedule's **Activity Codes**
  instead: whichever code type is named like `/disciplin|trade/i` (planner-defined per project, the
  same mechanism Project Schedule's own grouping/filtering already uses). If a project hasn't set
  one up, that tier simply isn't offered — the picker still works as Location > Zone.
- **Capture/Edit modals are now a real cascade**: pick Location → Zone options repopulate to that
  Location's leaves (`zoneOptionsHTML`) → optional Discipline/Trade select. `resolveActivity(zoneId,
  discValueId)` now also matches the activity's own `activity_codes[disciplineTypeId]`, so a zone
  with two concurrent activities (e.g. Structural doing rebar, Mechanical doing rough-in at the same
  column grid) resolves to the *right* one once a discipline is picked — verified in harness: without
  a discipline both activities are candidates and the earliest-start In-Progress one wins; picking
  "Mechanical" switches the resolved activity to the Mechanical one specifically.
  `project_schedule` select now also pulls `activity_codes` (added to `loadSchedule()`).
- **The Discipline/Trade pick is recorded as a tag** (`"<code type name>: <value>"`, e.g.
  `"Discipline: Mechanical"`) via `discTag()`/`existingDiscId()` — same `"<type>: <value>"` shape as
  the generic Activity-Code overlay, but it has its own dedicated select rather than a checkbox
  since it's a required-feeling tier of the hierarchy, not an optional extra. The **generic overlay
  now excludes** whichever code type resolved as Discipline/Trade, so it isn't offered twice.
  Verified the full round-trip: save with Location=Site Grounds/Zone=Perimeter Fence/
  Discipline=Mechanical → tag `"Discipline: Mechanical"` lands on the row → re-opening Edit
  pre-selects Location/Zone/Discipline correctly (the reverse lookup).
- **Existing progress-photos' own `trade` field is untouched** — deliberately did not let arbitrary
  schedule discipline text overwrite it. `trade` mirrors the fixed WPM vocabulary shared with
  Cash Flow/work-packages (a documented decision below); a schedule's Activity Code values are
  planner-typed free text and could easily not match that vocabulary. Discipline/Trade from the
  schedule is a separate, additional signal (tag + activity narrowing), not a replacement.
- **Rounds screen unchanged in granularity** (still one row per Zone, not per Zone×Discipline) —
  enumerating every zone/discipline combination would blow up the list for a modest UX gain: the
  Discipline/Trade tier is still available inside the Capture modal opened from a Rounds row.
  Flagged as a possible follow-up, not done here.
- Harness-verified (two Locations, a real "Discipline" Activity Code type, two concurrent
  activities at one zone tagged to different discipline values): Location→Zone cascade repopulates
  correctly on Location change, Zone's own location auto-derived for pre-selection (Capture-from-
  Rounds and Edit both preselect the right Location), discipline-narrowed activity resolution,
  discipline auto-tag save + reverse-lookup on Edit, generic overlay correctly empty when Discipline
  is the project's only code type, walkthrough chain unaffected. No console errors.

## Schedule App integration + streamlined capture — Phase 1 of the 6-phase 360°/BIM/drone
## roadmap (2026-08-11)

Owner's brief specced a 6-phase roadmap (schedule integration → reporting → 360° panoramas →
3D/measurements → BIM overlay → drone). Explicit instruction: audit the existing app and confirm
the schedule integration path **before** writing code, and don't start a phase until the previous
one ships. This entry is Phase 1 only — Phase 2 (report templates), Phase 3+ are NOT started.

- **Audit finding:** `location` was free text with no link to anything; "+ Add photos" was a
  batch-metadata upload (good primitive) but had no walkthrough/checklist UX and **no offline
  queue at all** — a failed upload just failed. The PPR module (already built) is most of Phase 2
  already; the gap there is a *template* concept, not slide assembly itself.
- **"Schedule app" = the `project-schedule` module in this same repo/Supabase project** — not an
  external system. Integration is a plain cross-module table read (same pattern Cash Flow/
  Portfolio Overview already use for `project_schedule`), not a new API.
- **Data model decision (owner's call): WBS nodes are the primary location source, Activity Codes
  are an optional overlay.** `progress_photos` gained `wbs_node_id` (FK → `wbs_nodes`, `on delete
  set null` — deleting a schedule zone must not delete photos captured there), `activity_id` /
  `activity_name` (a SNAPSHOT of the schedule's "current" activity for that zone at capture time —
  deliberately not a live join, so reports don't change retroactively when the schedule updates;
  same convention as `bl_cost`). Migration
  `../../migrations/2026-08-10-progress-photos-schedule-integration.sql`, folded into
  `supabase-schema.sql`. **User must run it** — until then the module tolerates the missing
  columns (see below) but zones aren't recorded.
- **`location` (existing free-text column) is kept as the display cache**, auto-filled from the
  picked zone's breadcrumb but still editable/typeable — a photo not tied to any WBS zone (site-
  wide shots, signage) can still be tagged, per contract §6 ("reference the schedule, don't force
  everything to be tracked"). This also means every existing filter/group/report code path
  (List View's Trade grouping, the Location filter dropdown, PPR slides) needed **zero changes** —
  they all just keep reading `location` text.
- **Activity Code overlay reuses the existing, previously-unused `tags text[]` column** — no new
  column needed. If a project has Activity Code Types defined in Project Schedule, the Add/Edit
  modal shows one optional checkbox group per type; ticked values save as `"<Type>: <Value>"`
  strings in `tags`.
- **"Current activity" resolution (`resolveActivity`)**: among `project_schedule` Task rows sharing
  the picked zone's `wbs_node_id`, prefer In Progress (earliest start), else the next Not Started,
  else whatever's there. Shown as a read-only context line in the capture/edit modals and on each
  Rounds row (e.g. "Rebar Installation").
- **Today's Rounds** (new third top-level screen, `Photos | Rounds | PPRs`): every WBS leaf node
  for the project, split into **Recent rounds** (has a prior capture here, newest first) and
  **Other schedule zones** (never captured, alphabetical) — so the usual walkthrough locations
  surface first without hiding zones nobody's shot yet. Each row shows the last photo + date +
  resolved activity, a checkbox, and a one-tap **Capture** button.
- **One-tap repeat capture**: opening Capture on a zone that already has a photo shows that photo
  inline ("Last captured here <date> — frame a similar shot for comparison") right in the upload
  modal, next to the resolved activity line.
- **Batch walkthrough**: check several Rounds rows → **Start walkthrough** opens the capture modal
  for the first ("Capture — 1 of N"), and on Upload/Skip it auto-advances to the next selected zone
  without returning to the Rounds screen; **End walkthrough** stops the chain early. Uses the same
  `openUpload(preset)` as the plain "+ Add photos" button — just pre-filled and chained.
- **Offline queue (plain IndexedDB, no library)**: a capture tries to save immediately; a thrown
  upload (or `navigator.onLine === false`) queues the file blob + metadata in `pp_offline_v1`
  instead of losing the shot. A topbar **"N pending — Sync now"** button (hidden at 0) replays the
  queue on click and auto-flushes on the browser's `online` event. This directly answers brief §4's
  "offline queueing still required" — the old module had none.
- **Migration-tolerant writes**: every insert/update carrying the three new columns retries once
  without them on a "column does not exist" error (same convention as Cash Flow's `tolerantWrite`),
  warning once per session rather than losing the capture. Verified this path explicitly (forced a
  simulated missing-column error) — the photo still saves, just without the zone link, until the
  migration runs.
- **Reconciled with the collaboration/offline-editing work already on `main`** (this branch was
  originally built against an older snapshot — see below): rather than inventing a second, competing
  offline system, new-capture uploads now go through a **narrow addition on top of the existing
  `PDSync` outbox**, not around it —
  - `PDSync` (offline.js) already queues DB row **writes**, but has no concept of a Storage
    **upload**; it can't hold an unsent image blob. So a capture that can't even *start* uploading
    (offline, or the upload call itself throws) is queued in a small **IndexedDB blob queue**
    (`pp_offline_v1`) — file + metadata — retried (upload, then the row write) on reconnect or a
    topbar **"N pending — Sync now"** button (auto-flushes on the browser's `online` event).
  - Once a file's bytes are actually on Storage, the row write **always** goes through the same
    `tolerantWrite()` → `PDSync.write()` path every other insert/update in this module now uses — a
    transient network hiccup on just the row write is PDSync's problem to queue and retry, not a
    second queue of mine. (If that write comes back permanently, `tolerantWrite` retries once
    without the schedule-link columns for a not-yet-migrated DB; if it's still not `ok`, the file's
    already uploaded, so it's re-queued as a row-write-only retry rather than re-uploading.)
  - This **revises the "Upload (file) stays online-only" scope note** below (2026-07-26) — that was
    the right call before schedule integration needed captures to survive going offline mid-
    walkthrough (brief §4 requires it); it's superseded, not contradicted.
- **Rounds stays live-consistent** with collaboration: hooked into the same `render()` that
  `paintRemote()` already runs at the end of — so a teammate's capture (via `applyRemoteChange`) or
  this device's own `load()` both refresh the visible Rounds list, not just the Photos grid.
- **Deliberately not built this round**: Report Templates (brief §5/Phase 2), 360° capture (Phase
  3+). Rounds' "Recent vs Other" ranking is capture-history + WBS only — no separate "usual
  locations" list to hand-maintain, which was the actual ask in §4.

### Verified (2026-08-11)
Harness-verified (stubbed `AppAuth`/`PDb`/a hand-rolled Supabase-query-builder stub + `storage` +
minimal `PDSync`/`PDCollab`/`Autosave` stubs, mutable in-memory store seeded with a 2-level WBS
tree, two schedule activities, one Activity Code type, one pre-existing photo; no real
credentials/backend touched; harness deleted after use). Confirmed **end-to-end, by driving the
actual DOM**: Rounds correctly splits Recent/Other and resolves the right activity per zone; the
capture modal preselects the right WBS node, auto-fills the location label, shows the resolved
activity, and shows the "last captured here" reference with thumbnail; a real upload (via a
`DataTransfer`-injected `File`, no OS file dialog) saves through `tolerantWrite`/`PDSync.write` and
the Rounds list's "Last captured" date updates live; the walkthrough chain advances 1-of-2 → 2-of-2
on Skip and stops cleanly on End; the offline blob queue catches a simulated upload failure, shows
the pending badge, and Sync now flushes it through the same write path; the migration-tolerant
retry fires and still saves the photo when the new columns are simulated as missing; the Edit-photo
modal preselects the existing zone/location correctly and still routes through `broadcastCollabSel`
+ Autosave unchanged; the pre-existing Photos screen (filters, grouping, live collaboration
presence/row-cursor, edit) is unaffected.
Screenshots weren't attempted (this session's Preview tool file:// pages don't reliably reload —
confirmed via a page-global marker that a second navigate/`location.reload()` to the same file://
URL doesn't re-execute JS); DOM/text verification was used instead, same as this module's prior
compositor-stall workaround.

### Pending
- Migration must be run on the live DB (see above).
- Live click-through against a real login + a real project with a WBS built in Project Schedule.
- The offline **blob** queue (new-capture path) hasn't been exercised through a real DevTools-
  offline cycle against live Supabase — same caveat the 2026-07-26 entry already notes for the
  metadata-edit path.
- Phase 2 (Report Templates) — not started.

## Live collaboration + offline metadata edits (Phase 1 & 2) (2026-07-26) — fmlozano
Wired the shared **PDCollab** (Realtime) + **PDSync** (offline outbox) layers. Progress Photos is the
**"presence + live, offline-limited"** case: it's uploads, so photo *blobs* can't be queued offline —
but presence, the live gallery stream, the row cursor and **metadata** edits all work.
- **Phase 1 (presence + live gallery + row cursor):** `joinCollab()` on load / project switch
  (`key = progress_photos:<pid>`). Topbar avatars (`#pp-presence`). `openForm(r)` broadcasts "editing
  this photo"; every close path (×/Cancel/Save) clears it. `paintRemote()` (called at the end of
  `render()`) flags the photo's `.pp-row .pp-thumbcell` (List) or `.pp-card .pp-cardimg` (Gallery) of
  whoever has it open. `applyRemoteChange` patches `rows` from postgres_changes (INSERT/UPDATE/DELETE)
  and re-renders — and **signs a newly-arrived photo's URL** (`signOne`) so the preview shows live.
- **Phase 2 (offline, metadata only):** the **Edit modal save** routes through `PDSync.write`
  (field-level LWW: description / trade / works / location / capture date), applied optimistically so
  it survives offline and syncs on reconnect. **Read-offline:** `load()` caches rows (`pp:<pid>`) and
  renders from cache on a failed fetch — but **signed image URLs can't be minted offline, so previews
  show the placeholder**. ⚠️ **Scope:** **Upload (file), delete and download stay online-only** — image
  blobs can't be queued and a delete removes a storage object. Offline covers **metadata edit + read**.
- **Migration `../../migrations/2026-07-26-realtime-collab-progress-photos.sql` (USER MUST RUN)** —
  adds `progress_photos` to `supabase_realtime` + `replica identity full`. Presence/cursors/offline
  work without it; only the live-value stream needs it.
- Verified: `node --check` (module.js + ppr.js). Assets: new `offline.js?v=20260726d` +
  `collab.js?v=20260726c`; `module.js?v=20260726d`.
- **LIVE-VERIFIED two-session (2026-07-27, deployed site, signed in as Fernando Lozano on GPR101).**
  Migration confirmed applied — the module's channel reports `state:"joined"`. A simulated second user
  (independent Supabase client, distinct id, same `collab:progress_photos:GPR101` channel) proved every
  path against the real deployed module: **presence** roster rendered both avatars (FL + TU);
  **live gallery** streamed a DB INSERT (0→1 live), UPDATE (description/trade patched live) and DELETE
  (row removed live, 0); **row cursor** — user B's "editing this photo" painted the correct photo's
  `.pp-thumbcell` with B's colour + "TU" flag, and it **survives subsequent live re-renders** (verified
  by a follow-up UPDATE). No console errors; test row cleaned up (0 leftover).
- ⚠️ **Leave-reconciliation caveat (all collab modules, not PP-specific):** a peer that disconnects
  **abruptly** (killed socket, no clean websocket close) may leave a **stale avatar** on other clients
  until they re-sync/reload — a fresh join shows the correct roster. A real browser-tab close sends a
  clean close, so `collab.js`'s bound `leave` handler fires normally. Confirmed: after B's abrupt
  disconnect, reloading tab A showed only FL server-side.
- ⚠️ **Not exercised live:** the **offline** path (queue an edit with the network down → reconnect →
  sync) — that needs a real offline cycle, which the console-driven harness can't fake convincingly.
  The online metadata-save-through-PDSync path is exercised implicitly (write() does the same direct op
  online). Worth a manual DevTools-offline pass.

## Audit fix: paginate the photo load (2026-07-21)
`load()` used a single `select('*')` (Supabase caps at 1000), so once a project's library exceeds
1000 photos the excess were invisible in List/Gallery, unavailable to the PPR slide picker, and
missed by bulk/Clear actions. Now **keyset-paginated** by `id`, then re-sorted in memory to the
previous order (`taken_at` DESC blank-last → `sort_order` ASC NULLS-LAST). `signAll()` still batch-signs
in one call. Verified: parses clean; Node test confirms the re-sort + full load. No migration, no `?v=` bump.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from the Power Apps "Progress Photos" app (drawing-register used as the
      file-upload reference)
- [x] CRUD implemented (upload / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`
- [x] **View PPRs** — PPR Presentations Database + slides viewer/editor + offline export

## Clear-filters polish (2026-07-17)
The app owner reported "Clear filters seems out of place." Root cause: the button lived in
a `.pp-filt-right` wrapper with `margin-left:auto`, so when the filter row wrapped it was
pushed onto a second line, orphaned at the far right — and it showed even on the empty
state. Replaced with a subtle borderless **`.pp-clear`** ghost (× icon, muted, fills on
hover) that sits **inline** after the filters and is **`hidden` unless a filter is
actually set** (toggled in `render()` for Photos and `renderList()` for PPRs). Removed
`.pp-filt-right`. Uses the new shared `x` icon in `icons.js`. Assets bumped `?v=20260717h`.

## UI uniformity pass (2026-07-17)

The module had been built with its own invented chrome. Realigned it to the suite's
existing patterns (Drawing Register / Cash Flow / Project Schedule). **These rules are a
copy of Drawing Register's — keep them in sync; don't re-invent.**

What was actually wrong (each verified against the reference stylesheet, not eyeballed):
- **The shared topbar rules were missing entirely.** `.pd-topbar`, `#user-bar`
  (`margin-left:10px; padding-left:10px; border-left`) and `#pd-theme-toggle` (34×34) are
  declared by all three reference modules; this one declared none of them, so the avatar
  had no divider and the theme toggle was unsized.
- **The filter bar wasn't a card** — the others are `--pd-card` + border + radius +
  `8px 12px`. Ours was a bare flex row, which is what made it look unfinished.
- **Tools were ad-hoc** (`padding:6px 9px`) instead of the uniform 34×34 transparent icon
  buttons that fill on hover, with `.pp-tb-sep` dividers and one labelled primary action.
- **Back button** was padding-based, not the 36×36 square.
- **Project select** was a plain bordered select; the convention is borderless until
  hover/focus (`.dr-project`), so the title area reads as one unit.
- **Two invented tab styles.** Replaced: the Photos|PPRs switch is now a **segmented
  `.pp-tabs`** (identical to Register/Progress), and List/Gallery now uses the **shared
  `.pd-viewtoggle`/`.pd-vt`** component from `dashboard.css` (as `projects.html` does)
  rather than a third bespoke style. `.pp-tab` therefore now means the *screen* tabs —
  the view wiring selects `.pd-vt[data-view]`, not `.pp-tab`.
- Count + view toggle moved into a static `.pp-listbar` (Drawing Register's `.dr-listbar`)
  so they aren't rebuilt on every render; destructive actions use `--pd-bad`.
- Added a **Clear filters** + **count** to the PPR screen for parity with Photos.

**Verified by diffing computed styles against the real `drawing-register/module.css`**
(both stylesheets inlined into an iframe at the same viewport/theme): all 10 chrome
elements — back button, icon tool, primary button, active tab, project select, filter bar,
user-bar divider, theme toggle, separator, count text — report **zero differences**.
Behaviour re-verified after the restructure (view toggle, screen tabs not hijacked, live
counts, per-screen tools, slides view hiding filters+count); light/dark surfaces flip on
tokens while brand red stays fixed; title collapses to icon-only at ≤1150px; no page
h-scroll at 375px (the photo table scrolls inside its own container: 341 visible / 998
content).

## PPR Presentations built (2026-07-17)

Replaces the Power Apps **PPR PRESENTATIONS DATABASE** and **EDIT PROGRESS PHOTO
SLIDES** screens. A PPR is one monthly Project Performance Review presentation; each
slide is a **before/after pair** at one location — last month's photo beside this
month's — tagged Trade / Works / Location with an optional Key Plan overlay.

- **Two top-level screens** (the app's home: *View Photos* / *View PPRs*) as a
  `Photos | PPRs` switch in the topbar, persisted in `localStorage['pp_screen']`. Both
  share one project selector: `ProgressPhotos.onProject(fn)` publishes the current
  project and `ProgressPhotos.trades()` shares the trade vocabulary, so the two screens
  never disagree.
- **Database screen:** PPR Date · Description · No. of Slides, with **PPR date start/end
  filters** and a **Preview pane** showing numbered slide thumbnails (the app's exact
  "No slides to show." wording when a PPR is empty). Clicking a thumbnail jumps straight
  to that slide.
- **Slides screen:** PPR Project / PPR Meeting Date / PPR Description / `‹ n › of N`
  header, Trade / Works / Location / Key Plan meta, and the two photos side by side with
  each one's capture date and italic caption. **Key Plan toggles an overlay on both
  photos**, matching the app's expand/collapse control.
- **Slide photos are picked from the Photos Database, never re-uploaded** (owner's call).
  `before_photo_id` / `after_photo_id` reference `progress_photos`; picking a photo
  **pre-fills the slide's trade/works/location/caption** from that photo, since the
  library already carries them. Key plans are the one exception — they're not progress
  photos, so they upload to `<project>/keyplans/` in the same bucket.
- **`on delete set null`, deliberately:** deleting a photo must not silently delete the
  PPR slide citing it. The slide survives with an empty frame so a planner sees what went
  missing and re-picks.

### Download = a self-contained offline copy (owner's requirement)
The app owner's brief: *"an offline view of that PPR Date in case the photos database
loads slowly due to connectivity or the sheer amount of photos."* So Download does **not**
produce a deck — it writes a **standalone `.html`** with every image inlined as a
downscaled data URI (max 1600px, JPEG q0.82), inline CSS, **no scripts and no external
references at all**. It opens instantly with no network and no dependency on Supabase
being reachable, and prints one slide per page.
- Photos are fetched to a **blob first**, then drawn via an object URL — a signed
  Supabase URL drawn straight into a canvas would be **cross-origin and taint it**, making
  `toDataURL()` throw. The blob round-trip keeps the canvas same-origin. Don't "simplify"
  this to `img.src = signedUrl`.
- Downscaling is not cosmetic: full-resolution site photos would make the file enormous
  and slow to open — the opposite of the point.

## Verified (2026-07-17)
Harness-verified against a mutable in-memory store (stubbed `AppAuth`/`PDb`/Supabase +
storage; deleted after use). Confirmed: PPR list newest-first (and a newly created PPR
sorts to the top); date-range filter; preview thumbnails + "No slides to show."; slides
header/meta reproducing the app's fields exactly; capture dates ("June 8, 2026" /
"June 25, 2026") and italic captions; key plan overlaying **both** photos and absent when
a slide has none; slide nav with end-disabled arrows; PPR + slide CRUD incl. blank-date
refusal, tag pre-fill on photo pick, and cascade delete; topbar tools following the inner
screen; Photos screen unaffected by the two-screen restructure; dark mode on all PPR
surfaces (`#2B2C2B`, light text); two-column split at 1440px with no horizontal overflow.

**The offline export was verified as a real artifact, not just by structure:** the
generated file was captured, written into a sandboxed iframe with no network, and
rendered — **5/5 images decoded, 0 broken, key plan present, brand-red header, two-column
pairs, 0 external references**.

⚠️ **Testing note for whoever tests this next:** two false alarms came from the *harness*,
not the module. (1) Stubbing `URL.createObjectURL` globally breaks `blobToImage`, so every
image "fails to embed" — scope the stub to the `text/html` blob only. (2) A no-op
`order()` stub makes ordering assertions meaningless; the stub now really sorts.

## Pending
- Live click-through against a real login, the real bucket, and real photo sizes — the
  export's file size and embed time have only been measured against small fixtures.

## Photos Database built (2026-07-17)

Replaces the Power Apps **Progress Photos | Photos Database** screen.

- **The row is the Power Apps row:** PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION ·
  CAPTURE DATE, with per-row **download** + **view full size**, plus edit/delete for
  planner+.
- **List View / Gallery View toggle** (the app's bottom-right switch), persisted per
  project in `localStorage` (`pp_view_<pid>`). List = a compact grid with thumbnails;
  Gallery = large photo cards with the detail table beneath, matching the app's layout.
- **Filters mirror the app's**: capture start, capture end, Trade, Works, Location —
  plus a free-text search the original lacked. Trade/Works/Location options are derived
  from the project's own rows (no empty dropdowns), and a "Clear filters" button resets.
- **List View groups by Trade** (collapsible, with counts, persisted in
  `pp_collapsed_<pid>`). The Power Apps grouped by *project* because its selector was
  "My Projects" (multi-project); this module is project-scoped by contract (§6), so the
  project is the topbar selector and Trade is the useful grouping.
- **Lightbox** = the app's fullscreen expand: click any thumbnail/photo, navigate with
  ← / → or the on-screen arrows, Esc closes, caption shows trade · works · location ·
  date and an N/M counter.
- **Batch upload:** one modal takes many files against one set of shared fields
  (description/date/trade/works/location) and writes a row per file, then you edit any
  individual photo afterwards. Progress is reported per file; a failure on one file
  doesn't abort the batch.
- **Shell:** sidebar-less topbar (matches Project Schedule / Cash Flow / Drawing
  Register) — back button, title, project selector, view tabs, tools beside the profile.

## Trade / Works vocabulary
`TRADES` mirrors the **WPM (procurement) trade list** (Site Works, Civil, Structural,
Architectural, Mechanical, Electrical and Auxiliary, Plumbing and Sanitary, Fire
Protection, General Requirements) so photos, work packages and Cash Flow's cash-out all
group by the same names. **Works** is free text with a datalist of the values already
used on the project (the app's Works list is project-specific — e.g. "Temporary
Facilities" — so a fixed enum would fight real usage). Revisit if a canonical Works
list is issued.

## Storage
Private **`progress-photos`** bucket (already created by
`migrations/2026-06-18-storage-buckets.sql`). Path = `<project_id>/<ts>_<rand>_<safe
name>`; the table stores the path in `photo_url`, never a public URL. Previews use
**batch-signed URLs** — one `createSignedUrls(paths, 3600)` per load rather than one
signing round-trip per row — cached in `urlCache` and refreshed on reload.

## DB
- **Run migration `migrations/2026-07-17-progress-photos.sql`** — adds `trade`, `works`,
  `sort_order` to `progress_photos` + a `(project_id, taken_at desc)` index. Idempotent;
  folded into `supabase-schema.sql`. **The module shows blank Trade/Works until it runs.**
- `description` / `location` / `photo_url` / `taken_at` (capture date) already existed on
  the starter table. `tags` (text[]) is now used by the 2026-08-11 Activity Code overlay
  (`"<code type>: <value>"` strings) — see that entry.

## Notes / decisions
- `UI.modal()` takes no width and does **not** wire close buttons, so the module has a
  local `openModal(html, width)` helper that sets `max-width` and wires `[data-close]`
  rather than editing the shared `ui.js` (contract §1 forbids shared edits). Worth
  promoting into `ui.js` by the app owner if other modules want it.

## Verified (2026-07-17)
Harness-verified against a mutable in-memory store (stubbed `AppAuth`/`PDb`/Supabase +
storage, no real credentials or backend touched; deleted after use). Confirmed: trade
grouping + collapse/expand; every filter (trade → 3/5, date-from → 2/5, search → 1/5,
clear → 5/5); gallery toggle (5 cards); lightbox open/next/close with correct captions
and 1/5 counter; edit round-trip persists to the row; delete removes it; batch upload of
2 files → 2 rows + new trade group + refreshed filter options; dark mode (grid bg
`#2B2C2B`, light text — tokens, no hard-coded white); modal width + `[data-close]`
wiring; no console errors.

**Screenshots were not possible** — this environment's compositor is stalled
(`visibilityState` stays `hidden`, `computer{screenshot}` times out), the same condition
noted in earlier prompts. Verification was done via DOM/computed values instead. Photo
`<img>` decode was confirmed directly (`naturalWidth` 400 on both thumbnails and the
lightbox), so the `loading="lazy"` thumbnails are proven to load.

## Pending
- **View PPRs** (the app's other screen) — not built yet.
- Live click-through against a real login + the real `progress-photos` bucket.
