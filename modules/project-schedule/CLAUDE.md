# Module: project-schedule

## Schedule Builder: library trades + "Others", resizable step-1, step-3 scroll + level-detail fix (2026-08-13g) — eprobles
Follow-ups on the class-code library + linking UX.
- **Library items now carry their real trade.** Re-parsed the mapping workbook's **"Excel Temp"**
  sheet, which has a trade column (**Description 1** — General Requirement / Site Works / Rebar /
  Concrete / … / Electrical / Plumbing / Fire Protection / …), keyed by the same base code. Mapped
  each of the 197 Level-3 items to an app trade group and stored it as the 3rd tuple field; the
  loader files them under that group instead of defaulting all to ST. Counts: GR 17 · SW 15 · ST 5 ·
  AR 101 · MEPF 46 · ALLIED 5 · **OT 8**.
- **New trade "Others" (OT).** Added to `GROUPS`/`GLABEL`/`GCOLOR` (teal `#0d9488`) + `parseTrade`,
  used for the misc/financial codes (DLP, rectification, change order, contingency, buyback, …).
- **Step 1: resizable grid columns** — the grid is now `table-layout:fixed` with a `<colgroup>`;
  each header has a drag grip (`.xl-colgrip`) writing per-column widths into `xColW` (persist across
  re-renders). **Resizable library pane** — a drag grip on the "All class codes" pane's left edge
  (`holdW`, 180–720px, default widened 260→320) fixes the cramped-on-the-right complaint.
- **Step 3: long linking is scrollable** — `.sbld-canvaswrap` capped at `max-height:62vh` with visible
  scrollbars, so a tall/wide zone diagram scrolls inside its pane instead of growing the page.
- **Level-3/4 detail bug fixed** — when the **Activity level** is Floor or Zone, the deeper controls
  (unit +/- at Zone, zones+units at Floor) and the tower's unit/zone splits are now **hidden**
  (`showZones`/`showUnits` gates in `stLevels` + `towerSVG`), matching `leavesOfFloor`. Previously
  level-4 (unit) controls showed even when scheduling at level 3, which read as a bug.
- **Linking bug fixed** — clicking a schedule **bar** now only **inspects** (highlights preds/succs);
  it no longer also toggles the bar into the pending link selection. Linking is done from the tower
  nodes (step 3) / class-code list (step 4) on the left.
- `MODULE_V` → `20260813c`. Verified: inline script parses; all symbols present; trade mapping
  produced 0 unmatched. ⚠️ NOT browser-verified (auth wall).

## Schedule Builder: class-code library + predecessor/successor inspection + bigger duration fields (2026-08-13f) — eprobles
Three asks against the Schedule Builder (`ScheduleBuilder` closure in `index.html`), all additive:
- **Class-code library (right side of step 1).** Extracted **197 codes** from *EPC. FIN. Class Code
  Mapping Template (12).xlsx* — **Class Code number Level 3** (column 5) + **Description 3** (column 6),
  filtered to non-empty rows — into a `CLASS_CODE_DB` constant. A **+ Library** button in step 1's
  "All class codes" holding pane header seeds `cfg.catalog` with any not-already-present codes
  (`loadClassCodeLibrary`, group defaults ST, dur 0). They appear on the right; tick + `←` loads them
  into the build, and **Save** persists (catalog already rides in the `schedule_builder.config` jsonb).
  Re-loading never duplicates (dedup by trimmed code across build + list).
- **Predecessor/Successor inspection on bar select (steps 3 & 4).** Main already had a cross-highlight
  (`seqFocus` array / `actFocus`) that highlighted the *same* node across tower & gantt. Extended it:
  when a bar is focused, `scheduleSVG` / `actSchedSVG` / `actGanttSVG` now also mark its
  **predecessors** (green `.prednode`, links `.hotpred`), **successors** (amber `.succnode`,
  `.hotsucc`), and dim the rest (`.dimnode` / `.dimlink`) — computed from `cfg.links` / `cfg.actLinks`
  relative to the focused id(s). A legend + **Clear selection** button (`focusLegendHTML`) sits above
  each schedule. So with multiple predecessors/successors, clicking a bar makes the drivers obvious.
- **Bigger Int/Ext duration fields (step 4 inline editors).** `.sbld-actdur input` 48×24px/11px →
  82×38px/16px bold centered, labels 10.5px→13px, with a focus ring — far more readable.
- `MODULE_V` bumped `20260813a → 20260813b`. Verified: inline script parses (`new Function`), all new
  symbols present. ⚠️ **NOT browser-verified** — the module is auth-gated (no live session here), the
  standing constraint for this module. ⚠️ **Branch note:** the edits were re-applied onto **main**
  (52268c3) — the local `module/schedule-builder` branch was 7 commits stale and main had meanwhile
  added the `seqFocus`/`actFocus` cross-highlight this work builds on, so a stale-branch patch would
  have conflicted/duplicated.

## Schedule Builder: fully-dynamic per-trade auto-trace questions (+ cure lag, zone order) (2026-08-13e) — eprobles
The auto-trace dialog now asks each trade ONLY the questions that apply to what it actually has, and
adds two new takt inputs the user asked for. Per trade, dynamically shown:
- **Starts how many floors behind <previous trade>** (only when it has a preceding trade) — stored on
  the leading trade's `cfg.tradeBatch`.
- **Cure / lag between floors (days)** — only when the trade has >1 floor. NEW `cfg.floorLag[tr]`,
  applied as the FS lag on every vertical floor→floor link in `autoTrace` step 1.
- **Zones at once per floor** (only when >1 zone) — `cfg.zoneSimul`.
- **Zone order** — a reorderable ↑/↓ list of the trade's distinct zone codes (only when >1 zone). NEW
  `cfg.zoneOrder[tr]`; `autoTrace` step 1b sorts each floor's zones by this order before the
  simultaneity sliding-window, so the sequence zones are worked in is honoured.
- **Units at once per zone** (only when >1 unit) — `cfg.unitSimul`.
- Sections with no applicable question are omitted (respects `cfg.locLevel`: floor-level hides
  zone/unit questions, zone-level hides unit questions).
- Save uses clean `data-atkind`/`data-attr` attributes (an earlier hyphen-in-attribute approach
  mangled the key via camelCase — avoided). Additive jsonb (`floorLag`/`zoneOrder`); no migration.
- Verified: inline JS parses; cure-lag-on-vertical-link + zone-order chaining unit-checked. **NOT
  browser-verified** (auth-gated).

## Schedule Builder: level-link cascade to units + push start = data date (2026-08-13d) — eprobles
- **Zone-sequence collapsed-group linking now cascades to the unit level.** Linking two collapsed nodes
  (Level 1–3) previously created a full cross-product of every source leaf × every destination leaf.
  New `linkMapped(srcs, dsts, type, lag)` (used by `nodeConfirm`) instead maps each source unit-leaf to
  the destination unit-leaf that shares its **sub-location** (`cellKey` = zone#unit) — so linking Floor 5
  → Floor 6 establishes Z1U1→Z1U1, Z1U2→Z1U2, … (unit-to-unit relationships "followed" down the level).
  Falls back to the every-source×every-destination link only when no sub-locations match (e.g. a genuine
  cross-zone single pick). Unit-checked (group→group = clean 1:1; cross-zone single = 1 link).
- **Trade sequence → per-unit activities (already worked, confirmed):** `generate` iterates `locList()`
  (per-leaf = per-unit at unit level) and `pushToSchedule` applies each trade's `cfg.actLinks` WITHIN
  every location — so the class-code sequence is established per unit and replicated to all unit-level
  locations from step 2. No change needed.
- **Push start date = project Data Date.** `openPushModal` now shows a Start date: when the project's
  `dataDate` is set the schedule builds from it (read-only, with a note); when NO data date is defined
  the user is prompted to pick a start date (required). `generate(basis, startOverride)` +
  `pushToSchedule(..., startISO)` thread it through. (Preview panel still uses `cfg.startDate`.)
- Verified: inline JS parses; `linkMapped` + start logic unit-checked. **NOT browser-verified** (auth-gated).

## Schedule Builder: step-3/4 viewing — stacked layout, cross-highlight, L1–L4 collapse (2026-08-13c) — eprobles
Viewing/UX features for the Zone-sequence (step 3) and Trade-sequence (step 4) screens. UI-only, no
config/model change.
- **Stacked layout toggle** (`seqLayout` split|stack, shared by both steps). Split = building/list on
  the left, gantt on the right (original). **Stack = building view on TOP, gantt on the BOTTOM**, with
  the trades laid out **side-by-side** across the top (`.sbld-twr-hz` / `.sbld-twr-col` /
  `.sbld-seqstack`). Toggle in each step's action bar (Split/Stacked).
- **Click cross-highlight** (like the project-schedule row highlight). Clicking a zone/unit node or a
  gantt bar highlights the SAME location in both views via `.sbld-focus` (amber outline). Step 3 uses
  `seqFocus` (uids); step 4 uses `actFocus` (class-code id). Bars/nodes carry the focus class in
  `scheduleSVG`/`actSchedSVG`/`actGanttSVG` and the tower/list.
- **L1–L4 collapse (step 3 only)** — `seqLevel` 1=Trade / 2=Floor / 3=Zone / 4=Unit, via a "Detail
  1 2 3 4" button group. `towerNodesFor`/`seqTowerCol` build the tower at the chosen depth; a collapsed
  node carries ALL its descendant leaf uids (`data-uids`), so linking/highlighting it acts on the whole
  group (`nodeSelectMany`). Respects `cfg.locLevel`.
- Verified: inline JS parses (`new Function`). **NOT browser-verified** — module is auth-gated (local
  server redirects to sign-in), so no signed-in click-through of the new layout/highlight/collapse yet.

## Schedule Builder: auto-trace takt questions — zones/units simultaneity + unit sequencing (2026-08-13b) — eprobles
Step-3 auto-trace now asks the significant takt questions BEFORE building, and actually sequences units.
- **`openAutoTraceDialog` expanded** into a per-trade section asking: (a) how many **zones** run at the
  same time per floor, (b) how many **units** at the same time per zone, (c) how many **floors** finish
  before the following trade starts. Each question only shows when it applies (trade has >1 zone / >1
  unit / has a follower) and respects `cfg.locLevel` (floor/zone remaps hide the deeper questions).
  Stored in new per-trade `cfg.zoneSimul[tr]` / `cfg.unitSimul[tr]` (+ existing `cfg.tradeBatch`).
- **`autoTrace` gained intra-floor sequencing (step 1b)** — the fix for units. Previously units/zones
  within a floor ran fully parallel (only the vertical cellKey chain existed). Now a sliding-window
  chain (`leaf[i]` waits on `leaf[i-N]`) enforces "≤ N zones per floor / ≤ N units per zone at once":
  N = the answered simultaneity (0/blank or ≥ count = all parallel = old behaviour). Reads
  `leavesOfFloor` so it honours `cfg.locLevel`. Cross-trade floor batch + Start/End bookends unchanged.
- Additive `jsonb` keys (`zoneSimul`/`unitSimul`), tolerated by `normalize`; no migration. Verified:
  inline JS parses; sequencing unit-checked (fully-seq, zones-seq/units-parallel, zones-parallel/units-
  seq, all-parallel, 2-at-a-time window all correct). **NOT browser-verified** (module auth-gated).

## Schedule Builder: per-trade takt batch + global activity-level remap (2026-08-13) — eprobles
Three additive changes to the `ScheduleBuilder` closure in `index.html` (⚠️ re-applied directly onto
main — the session's original edits were made on the stale `module/schedule-builder` branch, which is
97 commits behind main and has a divergent, older Schedule Builder; that branch was NOT merged):
- **Auto-trace reworked to a per-TRADE "floors at a time" question** (was per cross-trade pair).
  `openAutoTraceDialog` now asks, for each leading trade, *"How many floors at a time does <trade> do
  before <next> follows?"* → new `cfg.tradeBatch[<trade>]`. `autoTrace`'s cross-trade lead reads
  `cfg.tradeBatch[prev]` (falls back to legacy per-pair `cfg.tradeLeads`, then `floorLead`).
- **Global activity-level remap** — new `cfg.locLevel` (`auto`|`floor`|`zone`|`unit`), chosen from a
  selector in **step 2**. `leavesOfFloor` honours it: `floor` = one leaf per floor, `zone` = one per
  zone (units ignored), `unit`/`auto` = deepest defined. Because `locList`/`cellKey`/`locLabel`/
  auto-trace/scope/`generate`/`pushToSchedule` all key off these leaves, one setting remaps the whole
  builder. Changing it clears `cfg.links` (leaf uids change). This is the "switch floors/zones to
  activity level" ask.
- Push-to-schedule already retains relationships (FS/SS/FF/SF + lag as predecessors) + files under the
  picked WBS with optional Trade→Floor→Zone→Unit grouping — unchanged, confirmed.
- Additive `jsonb` keys (`tradeBatch`/`locLevel`), tolerated by `normalize`; no migration. Verified:
  inline JS parses (`new Function`); leaf-remap counts unit-checked. **NOT browser-verified** (module
  is auth-gated; local server redirects to sign-in).

## Location matching scoped to Execution Phase only (2026-08-06) — fmlozano
User: location/zone describes construction, so the Location Wizard (and grouping by a location
level) must not touch activities outside the Execution Phase WBS branch.
- **New `execPhaseCode()` / `locCodeUnder()` / `locExecScopedActs()`.** `execPhaseCode()` locates
  the skeleton's locked top-level "Execution Phase" WBS-Summary row and returns its dotted code;
  `locCodeUnder(code, ancestor)` is the boundary-safe prefix test (`"4"` matches `"4.1"`, never
  `"40.1"`). `locExecScopedActs()` is the shared entry point both write paths now call instead of
  scanning every activity with a WBS code.
- **Both writers scoped:** `openLocWizard()` and `openLocBackfill()` ("Fill location from the WBS
  tree…") now only scan/match/write against Execution-Phase activities — a name like "Design
  Review" under Planning Phase can never be offered a Tower/Level/Zone value, and Apply can never
  write `location` onto a non-construction activity. The wizard's own description text says so.
  When the project has no Execution Phase branch (skeleton not seeded / pre-dates it), warns and
  falls back to the whole schedule rather than silently doing nothing.
- **Grouping scoped too, not just writing.** Follow-up in the same prompt: grouping by a location
  level (`Location > Zone > Activity` or `Activity > Location > Zone`) was still bucketing
  Initiation/Planning/Milestone activities into an "— Unassigned —" location group alongside real
  Execution-Phase work — visually mixing phases that have nothing to do with location. `buildNodes()`
  now carves non-Execution-Phase activities out of the location-dim walk and renders them as their
  own top-level group ("— Other phases (not location-grouped) —"), always by their own WBS path
  regardless of the chosen dims — visible, never lost, never mixed into a location bucket. Only
  triggers when the active `groupBys` actually include a `loc:` dimension; every other grouping
  (Status/Type/Work Package/Activity Codes/plain WBS) is untouched.
- Verified: inline script (`new Function`) parses clean. **Not browser-verified against a live
  login** — same environment constraint as the rest of this session's work on this module.

## Location Wizard: real fix for the modal's horizontal overflow, plus bulk-assign audit (2026-08-06) — fmlozano
User reported the "Match the WBS to your location breakdown" wizard (`openLocWizard`) was scrollable
and wanted the popup to show whole, then reported it was "still the same" after a first attempted fix.
- ⚠️ **Root cause, found by reading `UI.modal()` rather than guessing again after the first fix
  looked right but didn't help:** `UI.modal()` always wraps caller HTML in its own `<div
  class="pd-modal">`, and the shared stylesheet caps that element at `max-width:520px`. Because that
  same element also has `overflow-y:auto`, CSS computes its `overflow-x` to `auto` too. The wizard's
  first attempt only set a width on an INNER div — a child of that still-520px box — so the wide
  content overflowed it, and since the whole `.pd-modal` became one scrolling region, the header and
  buttons scrolled sideways along with the table instead of staying put.
- **Real fix:** after `UI.modal()` returns, grab the actual `.pd-modal` element
  (`m.el.querySelector('.pd-modal')`) and set its `style.maxWidth`/`overflowX` directly — an inline
  style always wins regardless of the class rule's specificity. The inner div now just fills that box
  (`width:100%`) instead of fighting it with its own competing width.
- ⚠️ **Why the first attempt never showed up live:** this repo (`planning-app`) is a git repo tracked
  against `origin/main`, which is what GitHub Pages deploys from — but the first fix was only ever
  saved to the local file, never committed or pushed. "Still the same" was accurate: the live site
  hadn't changed at all. This prompt's fix is committed + pushed.
- **Wizard audit (previous prompt, same session):** fixed a real inconsistency where "Assign all
  shown to…" (bulk level-assign) skipped the value re-clean that the per-row level dropdown does,
  leaving a stale/uncleaned value under the newly assigned level; removed a dead `s.touched` flag;
  added a full-text `title` tooltip on the truncated ancestry trail; added a "N names shown" hint next
  to the bulk controls so it's clear which rows a bulk action will affect.
- Verified: inline script (`new Function`) parses clean. **Not browser-verified against a live login**
  — this environment has no session for the deployed app; verification here is static/parse-level plus
  reasoning through the actual `.pd-modal`/`UI.modal()` CSS cascade, not a rendered screenshot.

## Autosave added to the Add/Edit Activity modal (2026-08-06) — fmlozano
Extended the shared autosave pass (`assets/js/autosave.js`, wired into 5 other modules the same
prompt) to this module's Activity modal — the one place here that didn't fit the shared helper.
- ⚠️ **This modal isn't `UI.modal()`-based** — it's a static `#ps-modal` overlay shown/hidden via
  `style.display`, and `save()` is a bare module-scope function that unconditionally calls
  `closeModal()` (hides the modal + clears `editId`) on success. The shared `Autosave.wire` trick
  (temporarily no-op `modal.close`) doesn't apply — there's no object whose `.close` property
  `save()` calls through. So autosave here is a **small inline implementation** instead of the
  shared helper: a debounced (1.2s) `_asSchedule()`/`_asFlush()` pair that calls the existing
  `save()` directly, then **reopens the modal and restores `editId`** immediately after
  `closeModal()` ran inside it — same end effect (modal stays open, edit continues) via a different
  mechanism suited to this modal's shape. `UI.toast` is monkey-patched to a no-op for the duration
  of the tick so "Activity updated." doesn't fire on every autosave.
- **Edit only** — `_asSchedule()` no-ops when `editId` is null (a new, not-yet-inserted activity).
  `closeModal()` now also cancels the pending autosave timer, so cancelling/closing the modal can't
  fire a stray save afterward.
- Status badge `#ps-modal-autosave` beside the modal title (reuses the shared `.pd-autosave` CSS
  from `dashboard.css`), shown only when editing.
- Verified: inline script (`new Function`) parses clean. **Not browser-verified** — auth wall, same
  as the rest of this module's recent work.


## Documents tab removed (2026-08-05) — fmlozano
Both registers dropped the per-document → activity link, so nothing can author one any more and this
tab would be **permanently empty** — exactly the "empty promise" the Design Development node was
before it got a real writer. Removed the tab button, its render dispatch, the `DOC_DRAWINGS` /
`DOC_SUBMITTALS` lazy loads, and `detDocs` / `wireDocs` / `docsFor` / `docReadiness` / `_docChip` /
`_docApprovedDr` / `_docApprovedMs` / `_docLeadDefault`.
- **`syncDesignDevelopment()` is now the ONE connection** between this module and the two registers:
  progress flows register → schedule, and those rows are read-only here.
- ⚠️ Two fewer cross-module queries in `loadResourcesAssignments()` on every project load.
- ⚠️ `project_schedule` never stored the link (it lived on the register rows), so there is nothing to
  clean up here; the register-side columns are left in the DB unused.
- Verified: inline script parses, 0 leftover references, the DD sync intact.
  ⚠️ Not verified signed-in. `index.html` isn't cache-busted — hard-refresh.

## Design Development is now actually populated from the two registers (2026-08-05) — fmlozano
⚠️ **The 2026-08-03 skeleton entry's deferred item is now built.** That pass created the Design
Development node, locked it, labelled it "synced from Drawing Register + Material Submittal Log" and
blocked manual adds — but **nothing ever populated it. Zero writers.** The label was a promise the
code didn't keep.
- **`syncDesignDevelopment()`** (called from `load()` after `_wbsEnsureSummaries`, so the DD node and
  real dotted codes exist) mirrors both registers into the branch: two locked child nodes —
  **Drawing Register** / **Material Submittal Log** — each with one activity per discipline carrying
  `percent_complete`, `start_date` (min planned approval) and `end_date` (max actual once every item
  is approved, else the commitment).
- ⚠️ **Idempotent by deterministic `activity_id`** (`DD-DWG-<slug>` / `DD-MAT-<slug>`): a re-sync
  patches in place, writes only changed fields, and deletes rows for disciplines that vanished. This
  is deliberately the shape that avoids the duplicate-projection bug `_wbsEnsureSummaries` had to heal.
- ⚠️ **Drawings count SHEETS, submittals count ITEMS** — different measures, kept as separate
  branches rather than summed. The drawing side mirrors the register's own `approvedOf()`: a
  single-sheet drawing is approved by its **status**, not its counter.
- ⚠️ **`.is('parent_id', null)`** excludes the register's per-sheet child rows — their counters are
  already inside the parent drawing's, so counting both double-counts the register.
- ⚠️ **Tolerant throughout** — any failure leaves the branch untouched rather than blocking the load.
- **`isSyncedRow(r)`** gates `beginEdit`: a mirrored row can't be edited here, because the next sync
  would silently overwrite it. A node's own WBS Summary row is NOT gated (it is real structure).
- **This is the opposite direction to the Documents tab.** Design Development = the register IS the
  work (progress flows register → schedule). Execution Phase = a document ENABLES the work (the date
  flows schedule → register). Both registers now warn when a document is linked to a non-Execution
  activity — see `modules/drawing-register/CLAUDE.md`.
- **Verified 36/36** in a Node harness over the shipped `_ddAggregate`/`_ddSlug`/`_ddValidDate`/
  `isSyncedRow` (sliced, not reimplemented). Inline script parses. ⚠️ **Not verified signed-in** — no
  live sync has run. `index.html` isn't cache-busted; hard-refresh to pick it up.

### Live verification on BAU101 (2026-08-05) — 1 real bug found
First live sync, signed in. BAU101 had the skeleton's **Design Development node at `3.2` with zero
children** and 0 generated rows; the sync created the `Drawing Register` child node and **11
discipline activities**.
- ⚠️ **REAL BUG FOUND AND FIXED — zero-duration bars.** `end_date` fell back to `minPlan`, so
  `start === finish`. Architectural's planned approvals actually span **2025-03-18 → 2026-05-11** and
  the row rendered as a **single day on 2025-03-18**. The finish is now the **latest** planned
  approval (the commitment to have the whole discipline approved), replaced by the last actual once
  every item lands. Re-verified live: Architectural `2025-03-18 → 2026-05-11`, Structural
  `2024-12-06 → 2025-02-28`.
- **Idempotency proven on live data:** the second sync left **11 rows, not 22** — it patched in place.
- **Reconciles exactly with the register.** All 11 disciplines match the Drawing Register's own totals
  computed with the same `approvedOf()` rule (539 of 1,257 sheets, 43%); 0 mismatches.
- **Read-only guard confirmed:** double-clicking a synced row's name opened no editor and toasted
  *"This row is synced from the Drawing Register / Material Submittal Log — edit it there."*
- **Material Submittal Log node correctly absent** — BAU101 has 0 submittals, and the sync only
  creates a branch when there is data.
- **Need-by scoping proven both ways** by temporarily linking two drawings and reverting: one to a
  real Execution activity (`4.6-A1030`, start 14-Sep-26) → **"Aug 15, 2026"**; one to
  `DD-DWG-ARCHITECTURAL` → **"✕ Not execution"** with the explanatory tooltip. The picker tagged
  **11 of 20** offered activities as non-execution while still allowing them.
- **Cleanup:** both test links removed (BAU101 and GPR101 back to 0 linked documents). ⚠️ The Design
  Development branch itself is **left in place on BAU101** — that is the feature working, not test data.

## Location Wizard — match the detected WBS to the location levels (2026-08-05) — fmlozano
User: rather than describing the values with keywords, let the planner **match what the importer
detected**. Group menu → **Match WBS to locations…** (`openLocWizard`).
- **Matching is by WBS node NAME, not by node.** Measured first: the same name recurs under every
  tower and trade (Avesta's `9th Floor` sits under 7 towers × 3 trades), so a name is **one** decision
  instead of twenty-one, and it survives a re-import that renumbers every node id. Distinct ancestor
  names are only **160 (Avesta) / 127 (Jab) / 365 (Caticlan)**, and names appearing at more than one
  depth are rare (Jab 0, Caticlan 10, Avesta 19), so a name's meaning is stable enough to key on.
- **The planner confirms, not types.** Each row is a detected name + how many activities sit under it
  + its ancestry trail (so you can see *where* it sits) + a level dropdown + **the value to write**,
  which is editable. Pre-classified by `locGuessLevel`; sorted by activity coverage so the
  high-impact names come first; search (matches the name **and** the trail, so searching a branch
  finds everything under it), a Proposed/Not-matched/All filter, and bulk assign-all-shown.
- ⚠️ **Two pre-fill defects found by testing against the real files, not by reading:**
  (1) Jab's towers are `Tower A - Superstructure` etc., so the pre-filled VALUE repeated the work
  and split one tower in two — the value is now pre-cleaned through `locTrimSeg`, giving **34 names →
  17 clean tower values**. (2) `Cluster 1 (TD, TC, TE and TF) of Superstructure` — a cluster of
  *towers* — was classified as a **Level** because it contains "Superstructure". `locTermHit` now
  picks the level whose term appears **earliest** in the name: the head of a name says what the thing
  IS, so "Cluster" at position 0 beats "Superstructure" at 24, and `Tower D - Substructure` is a
  Tower for the same reason.
- **Trade variation needs no per-trade config** (the user's chosen model: one level set, deepest
  wins). Tagging `Superstructure`/`Substructure` as Levels means a structural activity under
  `Superstructure › 9th Floor` still resolves to **9th Floor** (deepest), while one under
  `Substructure › Foundation` falls back to the structure part. Verified as three explicit cases.
- **Reuses the whole existing pipeline:** the wizard only builds a name→value table per level and
  hands it to `locSrcsAssigned` → `locMapPlan` → `locPreviewHTML`. So the spelling merge, the
  distinct-value preview and the write path are shared with the importers and the backfill — nothing
  forked.
- **The matching is remembered** in `location_levels.match` (migration
  `../../migrations/2026-08-05-location-level-match.sql`, **USER MUST RUN**), so it is re-runnable
  and editable rather than one-shot, and a re-import can reuse it. ⚠️ **Tolerant:** without the
  migration the values are still applied and only the memory is lost — it warns rather than fails.
- **Out-of-the-box coverage from the pre-fill alone:** Avesta **Tower 91.8% / Level 82.4% / Zone
  27.7%** (46 of 160 names proposed); Jab **Tower 99.3% / Level 99.3% / Zone 99.3%** (61 of 127).
  ⚠️ Jab's Zone figure is **inflated**: the five `Cluster N (…) of Superstructure` nodes are tower
  clusters, not zones, and the planner should set them to "not a location" — exactly the correction
  the wizard exists for.
- **Verified 15/15 in Node** over the real Avesta + Jab trees (scan counts, review-list size, clean
  tower values, and the three trade-variation cases) and **32/32 in a real browser** driving the
  actual wizard end-to-end — pre-classification, the pre-cleaned value, one row for a name recurring
  under two trades, level-change re-cleaning the value, search/filter/bulk, the debounced preview,
  and **Apply**, asserting the exact `location` written for each activity plus the saved per-level
  matching. ⚠️ Three browser assertions failed first and **all three were my assertion** — search
  matching the ancestry trail is deliberate, and my bulk-assign step had cleared `9th Floor` because
  its trail contains "Works". Other suites (24/18/33/27) and the 9-file regression still green.
  ⚠️ Not verified signed-in.
- **Open question the user flagged:** whether walking the WBS tree would be more practical on
  multi-tower projects. Names-with-trail-context ships first so it can be judged against real data;
  a tree view remains a possible addition rather than a replacement.

## Spelling merge for location values (2026-08-05) — fmlozano
User's explicit call after the duplicates were flagged: merge differently-spelled values of the same
location automatically. ⚠️ **Deliberately lossy** — two genuinely different names that normalise
alike WILL be merged. The trade-off was raised, the user confirmed, and the preview names every merge
so it is visible rather than silent. Correcting the WBS is still the real fix.
- **`locNormKey`** folds case, spacing/joined words (`Roof Deck` = `Roofdeck`), punctuation, and
  worded↔numeric ordinals incl. the typo forms actually present (`Nineth`→9, `Eight`→8). It does NOT
  fold different numbers, different words, `8th` vs `18th`, or `Ground` vs `1st`.
- **Merging lives inside `locMapPlan`** — it needs the whole value SET per level, so it resolves in
  one pass up front. Both importers, the backfill and the preview therefore agree **by construction**
  rather than by three call sites remembering to do the same thing.
- ⚠️ **`locSpellRank` — choosing the winner by frequency picked the WORST spelling on real data.**
  It kept Avesta's typos (`Nineth Floor`, `Eight Floor`) over `9th`/`8th Floor`, and Jab's `Roofdeck`
  over `Roof Deck`, because the sloppy spelling happened to be commoner/shorter. The winner is now
  chosen on legibility first — a variant containing a **digit** (also making the grid's natural sort
  order 2/9/10 correctly, where `Ninth`/`Tenth` sort alphabetically), then more word separators, then
  more Title-Cased words, then frequency/shortest/alphabetical as a deterministic tail.
- **Measured on the real trees:** Avesta floors **26 → 13 values**, now reading
  `2nd … 12th Floor | Ground Floor | Roof Deck` (was a mix of `Eight Floor`, `Nineth Floor`,
  `Ground floor`); Jab **7 → 6**, keeping `Roof Deck`. Towers and zones were already clean and are
  untouched, and **coverage is unchanged** — only spellings collapse, no activity gains or loses a
  location.
- **Verified 27/27 in Node** over both real trees (what merges, what must NOT merge, the spelling
  choice, order-independence — reversing the row order yields the same kept spelling — and that the
  reported `keep`/`dropped` match what is actually written), plus **9/9 in a browser** on the preview
  note. The 24/18/33 suites and the 9-file regression run are still green; script parses.
  ⚠️ Not verified signed-in.

## Jab: "grouping by location returns Unassigned" — plus a real defect it exposed (2026-08-05) — fmlozano
User created Tower/Level/Zone levels on **4PH Jab Greenwoods Dasmariñas** (17,122 activities),
grouped by them and got three nested **"— Unassigned —(17122)"**.
- **Not a bug in grouping.** Creating a level only DEFINES it; it writes nothing to
  `project_schedule.location`. Jab was imported long before any mapping existed, so every activity
  still had `location = {}`. The fix is to run **Location Breakdown… → Fill location from the WBS
  tree…** once. ⚠️ Worth stating in the UI — "create a level" reads like it should populate it.
- ⚠️ **REAL DEFECT the screenshot exposed: a location qualified by the work it holds split into two
  groups.** Jab names its towers **`Tower D - Substructure`** and **`Tower D - Superstructure`**, so
  the keyword source returned **34 tower values for 17 towers** — every tower duplicated. Avesta
  never showed this because its nodes are plain (`Tower 3`).
- **Fix — `locTrimSeg`:** the matched segment is trimmed to the smallest separator-delimited part
  that STILL matches the terms (`Tower D - Substructure` → `Tower D`), while an unqualified name is
  returned untouched. ⚠️ The separator must be **spaced** (` - `, ` – `, ` — `, ` : `, ` | `) so a
  hyphenated code like `T1-L05` is never split; and the part kept is whichever side matches, so
  `Substructure - Tower D` works too. If no single part matches, the whole name is kept.
- **Measured on the real Jab .xer (17,122 activities, an exact count match with the live project):**
  Tower **99.3% → exactly 17 values, Tower A…Q** (was 34); Level **95.4%**, 7 values; Zone
  (`Area, Zone`) **14.9%**, Area 1/Area 2. **Avesta is byte-for-byte unchanged** — its names carry no
  separator, so the trim is inert there.
- **Recommended terms** — Jab: `Tower` · `Floor, Roof Deck, Roofdeck` · `Area, Zone`.
  Avesta: `Tower, -Handover` · `Floor, Storey, Roof Deck, -Finishes, -Coating` · `Zone`.
- ⚠️ **Data-quality issues the value list makes visible, which are the USER's to fix, not ours to
  silently merge:** Jab has both **`Roof Deck` and `Roofdeck`** (two groups for one level); Avesta
  has **`Ground Floor` / `Ground floor`** and worded-vs-numeric duplicates (`Eight Floor` vs
  `8th Floor`) — 26 values for ~13 real floors. Case-folding or fuzzy-merging these automatically
  would silently merge names that a project might legitimately distinguish; the preview shows them so
  the planner can correct the WBS.
- **Verified 33/33 in Node** (the 26 from the previous entry plus 7 for the trim: qualified name,
  unqualified untouched, en/em dash, colon, the unspaced-hyphen guard, match-on-either-side, and the
  no-part-matches fallback), run over both real trees. Script parses; the 24/18/9-file suites still
  green. ⚠️ Not verified signed-in.
- ⚠️ **`index.html` is NOT cache-busted** (documented) — the deployed page needs a hard refresh
  (Ctrl+Shift+R) before this appears.

## Location from the WBS by KEYWORD — the source that actually works on a P6 tree (2026-08-05) — fmlozano
Built so Avesta's location breakdown can be filled from its import. ⚠️ **I first proposed a source
that reads the ACTIVITY NAME, and that was wrong** — measured on the real file, only **1.1%** of
Avesta's 4,393 activity names contain "Tower" (the 49 milestones) and **0%** contain Zone/Level/T1/Z1.
The names are generic (`Formworks`, `Rebar`, `3rd Fix`). Building it would have shipped a feature that
fills nothing.
- **Where the location really is: the WBS tree** —
  `Execution Phase > Construction Phase > Tower 5 > Structural Works > Superstructure > 9th Floor >
  Zone 2 > Vertical`. ⚠️ **But NOT at a fixed depth**, which is why the existing depth mapping can't
  express it: the floor is at depth 6 under MEPF/Architectural Works and at depth **7** under
  Structural Works (which inserts Substructure/Superstructure). Depth 6 therefore means "Eleventh
  Floor" for one trade and "Superstructure" for another.
- **New source kind `locSrcsWbsWords`:** instead of a depth, the planner says **what the value looks
  like** and the source scans the whole ancestry for it — how they read their own tree anyway. Terms
  are comma-separated, matched as **whole words**, and a `-term` **excludes**. The **deepest**
  matching ancestor wins (the nearest enclosing location is the most specific).
- ⚠️ **Whole-word matching is not fussiness:** `Ground` matched "Bac**kground** Music" in the real
  file. And the exclude term exists because `Tower` also catches "Tower Handover" and `Floor` also
  catches "Floor Finishes" — both real nodes in this schedule.
- **The mapper needed one new capability:** a source can declare `needsArg`, and the row then shows a
  second input (seeded from the level's own name, so a level called Tower starts with `Tower`);
  `read()` resolves it via `src.make(arg)` into an ordinary `{key,name,get}`, so **`locMapPlan`,
  the importers and the backfill are unchanged**. A blank argument leaves the level unmapped rather
  than contributing an empty column.
- **The preview now lists the DISTINCT VALUES per level with counts**, replacing the old
  count-plus-two-sample-rows in all three call sites. With a keyword matcher this is the only way the
  planner can SEE that "Floor" caught "Floor Finishes" — it is what makes the exclude term
  discoverable, and it is how both false positives above were found.
- **Measured on the REAL Avesta .xer** (terms `Tower, -Handover` / `Floor, Storey, Roof Deck,
  Basement, Podium, -Finishes, -Coating` / `Zone`): **Tower 91.4%, Floor 79.2%, Zone 27.7%**; Zone
  resolves to exactly `Zone 1`/`Zone 2`; **every zoned activity also carries its tower and floor**;
  and the 379 unmatched activities are correctly the Initiation/Planning/Design work, which has no
  location. **Every activity under Construction Phase resolves to a real `Tower 1..7`** — the odd
  residual values (`FCD Tower`, `BOQ Tower`, `Tower 2, 5, 6, 7`) are Planning-branch design nodes and
  cannot contaminate construction work, since they are in a different branch.
- ⚠️ **Two test assertions failed and BOTH were my assertion, not the code** — worth keeping because
  each taught something: (1) some zoned activities had no floor because the floor node is
  **"Roof Deck"**, which "Floor, Storey" simply doesn't cover; (2) the extra Tower values are design
  nodes. Neither was visible from reading the tree.
- **Generality (measured across all 8 real .xer files with one generic term set):** Jab **99%**,
  Jenara **100%**, Strevi **97%**, Avesta **92%** tower coverage; Caticlan is not a tower project but
  gets **Zone 78% / Floor 83%**; Hotel 101 **Floor 51%**; OPW101 **20%**; DepED **0%**. So **the
  mechanism generalises, the WORDS do not** — each project needs terms matching its own vocabulary,
  which the preview shows in seconds. DepED has activity codes instead (`Priority`, on 185 tasks).
- **Verified 26/26 in Node against the shipped source** run over the **real 4,393-activity Avesta
  tree** (all the numbers above, plus whole-word/exclude/case/phrase/regex-metacharacter handling,
  deepest-wins on a synthetic nested tree, and inert behaviour before an argument is supplied), plus
  **17/17 in a real browser** on the UI (input reveal, seeding, hint, `make()` resolution, deepest
  floor across differing depths, the false positive appearing in the preview and an exclude term
  removing it, per-value counts, blank-argument un-mapping). Earlier 24/24 + 18/18 + the 9-file
  regression run all still green; script parses, 0 console errors.
- ⚠️ **Not verified signed-in.** The intended path for Avesta is **Location Breakdown… → Fill location
  from the WBS tree…**, which now offers this source against the already-imported schedule — no
  re-import needed.
- ⚠️ **Concurrent edit:** another session was editing this same file (`syncDesignDevelopment`) while
  this landed; the changes are in disjoint regions and were committed separately.
- Module-local; no migration, no `?v=` bump.

## Excel/OPC location mapping — and what the REAL exports actually contain (2026-08-05) — fmlozano
Completes the import mapping: the Excel/OPC path now retains the columns its fixed header detection
doesn't claim and offers them to the shared mapper, so an xlsx `Tower`/`Level`/`Zone` column can be
mapped onto the location levels. Same modal section, same planner, same preview as the P6 path.
- **`parseWorkbook` keeps unmatched columns** as `rec.extra = { "<header as written>": value }`.
  ⚠️ Headers repeat in real OPC exports and `extra` is keyed by header, so duplicates are
  **uniquified** (`Zone`, `Zone (2)`) — otherwise the second column silently overwrote the first on
  every row. Blank headers and blank cells are skipped; WBS rows get `extra: null`.
- **Third source kind `locSrcsCols`**, ~6 lines, because sources were already reduced to
  `{key,name,get(rec)}` — the mapper, the preview, the planner and the level-creation path needed
  **no changes at all**. That was the point of the shape.
- **⚠️ THE IMPORTANT FINDING — this does not help Avesta, and I checked rather than assumed.** I ran
  the **shipped** parsers over the **real exports on disk** (9 xlsx + 8 xer):
  - The **Avesta xlsx** has 4 spare columns and they are **Planned Value POC / At Completion IBB /
    BL Planned IBB / Percent Complete Type** — no location column. Nothing to map.
  - **Its WBS rows carry no Name at all** (the export writes only a code in the ID column: `AVE`,
    `1.4`, `1.4.4`), so in the Excel path the WBS-depth sources yield **codes, not readable names**.
  - The **Avesta .xer** WBS *does* have real names, but they are **Phase › Discipline › Trade**, and
    tower/zone appear at irregular depths as groupings (`Tower 1 + Gen Req***`, `Towers 2-7` at
    depth 5; `Zone 1`/`Zone 2` at depth 8, alongside `Mat Footing`/`SOG`). **No single depth maps
    cleanly to Tower or Zone.**
  - The **Avesta .xer has no usable activity codes** — one type (`View`) with one value, on **0**
    tasks. (Other projects do: Caticlan has `Trades` on 2,947 tasks and `High Level Trade SMC 1` on
    2,076 — so the P6 code path earns its keep, just not here.)
  - Avesta's location lives in the **activity names** (`Tower 1 Topping Off`).
  → So the remaining planned source kind — **a pattern/delimiter on the activity name** — is the one
  that would actually serve this project. It is NOT built yet.
- **Verified.** 18/18 in Node against the shipped `parseWorkbook` + mapper (claimed columns not
  duplicated into extras, duplicate-header uniquifying, blank header and blank cells skipped, dates/%
  still parsed, WBS rows null, mixing a WBS depth with a column in one mapping, and the same
  zone-name-under-two-towers case). Plus a **real-file regression run**: all 9 OPC exports
  (~50k activities incl. a 20,716-row one) parse, and every record is **byte-identical to the
  previously committed parser on every pre-existing field** — `extra` is purely additive. The
  earlier 24/24 mapper suite and 20/20 browser UI suite still pass; script parses.
- ⚠️ Still **not verified signed-in** — no live click-through of an actual import.
- Module-local; no migration, no `?v=` bump.

## P6 activity codes imported + a shared location mapper for imports (2026-08-05) — fmlozano
User: with the location breakdown added (Avesta = Tower › Level › Zone), the OPC/P6 imports don't
offer it. They couldn't: **neither importer ever wrote `location`**, so every imported activity
landed with `location = {}` and the Location group-by showed one "— Unassigned —" bucket. The XER
path was also **dropping P6's activity codes entirely** (it read CALENDAR/PROJWBS/TASK/TASKPRED/
RSRC/TASKRSRC/UDF but not ACTVTYPE/ACTVCODE/TASKACTV) — which is exactly where a P6 schedule keeps
Tower/Level/Zone when it isn't in the WBS.
- **XER activity codes now import.** `ACTVTYPE` → `activity_code_types`, `ACTVCODE` →
  `activity_code_values`, `TASKACTV` → each activity's `activity_codes`. Worth doing on its own
  merit: those dictionaries were previously only ever created by hand, so the existing `code:`
  grouping/filtering columns had nothing to work with on an imported project.
  ⚠️ **P6 nests code values** (`parent_actv_code_id`) and the app's dictionaries are flat — nesting
  is dropped, the values stay distinct, which is all grouping needs. ⚠️ P6 allows several values of
  one type on an activity; the app stores one per type, so **last assignment wins** (same as the
  grid editor). Resource-scoped types (`AS_Resource`) are skipped — they aren't activity codes.
  Values label as `SHORT - Description`, collapsing to one when they're equal.
- **New shared location mapper** — `locSrcsWbs` / `locSrcsCodes` / `locMapUI` / `locMapPlan` /
  `locEnsureLevels`. A **SOURCE** is anything that can yield a location value for a record and is
  reduced to `{key, name, get(rec)}` **before the UI sees it**, so adding a source kind (a
  spreadsheet column next) is a new builder function and nothing else. Records are plain objects
  too — DB rows in the backfill, parsed import recs in the importer — which is what lets **one**
  planner serve both.
- **`openLocBackfill` was rewritten onto it** rather than duplicated: same modal, same live
  count + sample, but it now also offers **activity codes** as sources, so a project whose codes
  carry the location no longer has to re-import to use them.
- **The XER import preview gained a "Location breakdown" step** listing the file's own WBS depths
  and code types (each with a 3-value sample) mapped onto the location levels. It can **create
  levels** — a project being imported into for the first time has none — and `location` is stamped
  onto the payloads so it rides in the **same insert**, no second pass over 40k rows.
  ⚠️ `locEnsureLevels` returns false if a level can't be created and the caller then skips the
  mapping: proceeding would write values under placeholder keys that nothing reads.
- ⚠️ **Code values are matched back by `(type,value)`, not by insert order** — PostgREST does not
  promise returned rows come back in the order sent, and these are chunked 500 at a time.
- **Verified 24/24 in Node against the SHIPPED functions** (sliced out of `index.html`, never
  reimplemented) — resource-scoped types dropped, `SHORT - Description` labelling incl. the equal
  and missing-short cases, label-less and unknown-value assignments ignored, WBS sources returning
  null on shallower rows, mixed WBS+code mappings landing together, no mutation of the caller's
  location map, an already-correct row planning no write, and **the crux case: the same zone name
  under two towers keeps its own tower**. Plus **20/20 in a real browser** on `locMapUI` (jsdom
  isn't available and `read()` drives everything): default guesses, name-match beating the depth
  guess, skipped levels excluded, the add/remove/prefill flow, new rows reading placeholder keys, a
  nameless new row refused, no page overflow. Script parses; 0 console errors.
- ⚠️ **Not verified signed-in** — needs a real `.xer` imported into a scratch project. **Excel/OPC
  is NOT covered yet**: its header detection still discards unmatched columns, so a `Tower`/`Level`/
  `Zone` column in an xlsx is dropped before the mapper could see it. That's the remaining piece —
  retain unmatched columns on each record and expose them as a third source kind.
- Module-local; no migration (reuses `location_levels` / `activity_code_*`), no `?v=` bump.

## SIGNED-IN verification of the location/grouping work — migration run, 1 real bug found (2026-08-04) — fmlozano
First live run of everything from this batch. **Migration `2026-08-04-activity-location-work-type.sql`
was executed on the production Supabase** (`planners-app`) and verified by querying the catalog, not
by trusting the success message: `location_levels` table = 1, `project_schedule.location` = 1,
`.work_type` = 1, policies = 2, indexes = 2.

- ⚠️ **REAL BUG FOUND AND FIXED — both Location Breakdown menu buttons were dead.**
  `renderGroupMenu` is module scope but called `closeMenus()`, which is declared in the **init/wiring
  scope**, so clicking "Location Breakdown…" or "Fill location from the WBS tree…" threw
  `ReferenceError: closeMenus is not defined` and did nothing. **The Node harness stubs `closeMenus`,
  so it passed there** — only the real page caught it. Fixed by closing the menu directly.
  Audited every other helper the new code calls: all module scope; this was the only one.
- **Duplicate-WBS heal proven end-to-end.** Planted the exact reported bug on the `Test` scratch
  project (a second projection of `Procurement` + `Execution Phase` → 9 summary rows for 7 nodes,
  matching the user's screenshot), then loaded the app: the grid came up with **7 rows**, and a
  follow-up SQL check confirmed the extras were **deleted from the database** (every node back to
  exactly 1 copy). Not a render filter — a real repair.
- **Both grouping layouts verified live** on 2 locations × 2 zones × 2 work types:
  `Location › Zone › Activity` and `Activity › Location › Zone`, 22 rows / 14 group headers, correct
  nesting and per-group counts, and **"Zone 1" stays a separate group under each location** — the
  case the whole design turns on. Order persists across a reload (`ps_groupbys_<pid>`).
- **Inline location editing verified with REAL mouse + keyboard**: double-click a Location cell, type
  "Tower B", Enter → persisted to the DB and the grid **re-grouped live** (Loc 1 4→3, a new Tower B
  branch appeared). Value suggestions in the datalist came from the project's existing values.
- ⚠️ **Method note that cost time: synthetic events do NOT drive this grid editor.** Dispatching
  `dblclick` + setting `input.value` + `blur()` / a synthetic `KeyboardEvent` opened the editor but
  never committed, and once left the cell visually blank while the DB was untouched — which looks
  exactly like a persistence bug and isn't. Use the real `computer` mouse/keyboard path to test it.
- ⚠️ **Environment:** screenshots of the module time out (stalled compositor, as documented) and the
  1MB page intermittently wedges CDP; verification is measured DOM + direct Supabase queries. One
  fresh load showed the correct grouping label with a stale grid, but it did not reproduce across a
  10-sample timeline (correct from the first frame), so it reads as an automation artifact rather
  than a defect — worth an eye on a foreground tab.
- **Left in place:** `Test` project now has 2 location levels (Location, Zone) and 8 demo activities
  so the feature is inspectable. **`XERTEST` still holds one genuine pre-existing duplicate**
  (`Execution Phase` ×2) that will self-heal the next time it is opened in the app.

## Builder push: flat by default, structure comes from grouping (2026-08-04) — fmlozano
Follow-up to the location-as-data work; the user picked this as the real simplification. The push
used to *materialise* the location breakdown as a Trade › Floor › Zone sub-WBS on every run. Now
that each activity carries `work_type` + `location`, that branch is redundant for most projects —
the same structure is a **view** you can flip, and it costs nothing to change your mind.
- **"Group into a sub-WBS" now defaults OFF.** A flat push adds the activities under the chosen WBS
  node and nothing else. The reason is stated in the dialog rather than left implicit, and the hint
  and the WBS-structure editor are mutually exclusive (`syncStructVisibility` toggles both).
- **Flat push names the activity for the WORK, not the place** — `taskPayload(r, r.act.name)`
  instead of `"Structural F5 · Z1 — Formworks"`. The location was crammed into the name only because
  it had nowhere else to live; it now has its own columns and grouping levels. ⚠️ This is also what
  made grouping-by-name useless before: every instance had a unique name.
- ⚠️ **A flat push switches the schedule to Activity › Location › Zone** (`setGroupBys`, only when
  `!grouped` and the project has levels). Without it the planner lands on a WBS-grouped list of a
  few hundred rows all reading "Formworks"/"Rebar" and reasonably concludes the push failed. The
  setting is written to the per-project key *before* the `load()`, so it survives the reload.
- **The sub-WBS path is untouched** and still the right choice when the WBS codes themselves must
  encode location (client-mandated coding). ⚠️ Another session had meanwhile rebuilt that dialog with
  a configurable ordered dimension list (`cfg.wbsOrder` / `renderStruct`); this change is deliberately
  surgical around it — default, hint, naming, post-push grouping — and preserves that editor intact.
- Verified: 9 static assertions on the shipped file (default flipped, hint wired, naming changed,
  grouping applied only on the flat path, grouped path + structure editor preserved) plus the
  33/39/16 suites still green and a clean parse. ⚠️ **Not verified signed-in** — the push writes to a
  real project, so the end-to-end run is the user's.

## Two bugs from a live Builder run: invisible "Structural", duplicated WBS rows (2026-08-04) — fmlozano

**1. "Structural" was unreadable in the Auto-trace dialog — measured, not guessed.**
`GCOLOR.ST` was the brand Dark Gray `#2B2C2B`, which is **exactly `--pd-card` in dark mode**, so the
trade name rendered at a **1.00:1 contrast ratio** — the same colour as its background. The dialog
literally read *"How many ___ floors must be completed before Architectural can start?"*. MEPF's deep
blue `#3a6098` was nearly as bad at 2.21:1.
- Fix: a `gc(trade)` accessor with dark-theme substitutes (`ST #a9aeb4`, `MEPF #7d9fd6`) — **6.28:1
  and 5.21:1** on the dark card, with the light-theme colours untouched (both still ≥3:1 on white).
  All **17** read sites now go through `gc()`; never read `GCOLOR` directly.
- This affected far more than the dialog: the tower trade headings, zone tags, trade chips, Gantt
  bars and the per-zone duration bars all used the same invisible colour on dark.
- ⚠️ Colours are baked into `innerHTML` at render time, so a *live* theme toggle leaves stale colours
  until the next builder re-render (step change / reopen). Acceptable; noted rather than hidden.
- ⚠️ **Self-inflicted trap worth remembering:** the bulk regex that rewrote the call sites used
  `GCOLOR\[([^\]]+)\]`, which stops at the FIRST `]` — so the nested `GCOLOR[p[0]]` became the
  syntax error `gc(p[0)]`, and it landed on the exact line the user reported. Caught by the parse
  check, not by eye. Don't bulk-rewrite bracket expressions without re-parsing.

**2. Duplicated WBS rows after a Builder push + Clear (screenshot: 9 schedule rows, 7 nodes).**
Root cause found by reading, then proven by test: **`ensureWbsSkeleton()` discarded the summary rows
it inserted** — `await _insertWbsSummary(...)` with the result thrown away, so the freshly created
rows never entered the in-memory `rows`. The `_wbsEnsureSummaries()` that runs immediately after in
`load()` then saw every skeleton node as un-projected and inserted a **second** row for it.
- Fix: push the inserted row into `rows` (the one-line root cause).
- **Self-heal**, so the user's already-broken project repairs itself on next load:
  `_wbsEnsureSummaries()` now removes duplicate projections first — one node must have exactly ONE
  summary row; it keeps the **earliest** and deletes the rest, then rebuilds (the deleted rows are
  still in `_sorted` and the roll-up maps until a re-sort) and reports what it removed.
  ⚠️ Safe because activities reference a WBS by dotted **code + `wbs_node_id`**, never by the summary
  row's id. ⚠️ Legacy rows with no `wbs_node_id` are deliberately left alone (they're the un-adopted
  import case that "Adopt existing WBS" owns).
- **Re-entrancy guard** (`_seedingSkeleton`): seeding is fired from `load()`, and `load()` overlaps
  on a project switch or the reload after Clear — two runs both seeing an empty `WBS_NODES` would
  each seed a whole skeleton. `ensureWbsSkeleton` is now a guarded wrapper around `_seedSkeleton`.

**Verified: 16/16 in Node against the shipped `_wbsEnsureSummaries`** — healthy project untouched,
the reported duplicate case deleting exactly the extras while keeping the first, no re-insert after
cleaning, a mixed dedupe-and-restore pass, legacy unlinked rows never touched, plus the WCAG contrast
maths above. Existing 33/33 grouping + 39/39 keyboard suites still green; script parses.
⚠️ **Not verified signed-in** — needs a real Builder push + Clear cycle to confirm end-to-end.

## Location + Work Type as activity DATA — grouping order is now interchangeable (2026-08-04) — fmlozano
User: activities are grouped Location > Zone > Activity, and that should be flippable to
**Activity > Location > Zone**. Root problem: location and zone existed **only as WBS tree
structure**, so the tree was the one and only grouping. Fix = make them activity data and let the
grid nest by any ordered set of levels. **The WBS tree is not modified** (user's call): grouping is
a view, so codes, cost roll-ups, EVM, exports and the document links all keep working.

**Migration `../../migrations/2026-08-04-activity-location-work-type.sql` (USER MUST RUN)** — a
`location_levels` table (ordered, per-project) + `project_schedule.location jsonb` +
`project_schedule.work_type`. Tolerant everywhere: no table → no levels → the feature is simply
absent and nothing else changes.

- **Location levels are per-project and free-form** (user chose "generic, configurable levels" over
  a fixed Location+Zone pair) — a tower, a viaduct and a plant don't share a vocabulary.
  `location` is a jsonb map keyed by level id, **deliberately the same shape as `activity_codes`**,
  so the existing dynamic-column / filter machinery applies to it unchanged.
  ⚠️ Values are plain text per level, **not a node tree**. "Z1" under two locations is the same
  string; they stay separate because grouping NESTS Zone under Location. Grouping by Zone alone
  deliberately merges them ("everything in Z1") — verified as an explicit test case.
- **`buildNodes()` generalised from single-level to N-level grouping.** `groupBy` (a string) became
  **`groupBys` (an ordered list)**; Location>Zone>Activity and Activity>Location>Zone are now the
  same engine with the list reversed. ⚠️ **'wbs' is a hierarchy, not a flat key** — alone it means
  the plain WBS tree, and as the LAST entry it means "show each group's WBS path". It is forced out
  of the middle by `normalizeGroupBys()`, which also drops levels/codes that no longer exist.
- ⚠️ **Legacy saved views are migrated, not reinterpreted.** A stored `groupBy:'status'` used to
  render each group's WBS path underneath; it loads as `['status','wbs']` so the user sees exactly
  what they saved. Plain `['status']` now means "group headers → activities", which is new.
- **Grouping picker** (replaces the `<select>`): presets for the two layouts a planner actually
  flips between, plus an ordered add/remove/▲▼ list. Persisted **per project** (`ps_groupbys_<pid>`).
- **Editable in the grid**: Work Type + one column per level, inline-editable via a new `xcol` type
  in `beginEdit` (with a datalist of values already used on the project — a typo silently creates a
  second group). Location columns default to VISIBLE (you created the level deliberately); Work Type
  stays opt-in like codes/UDFs so it doesn't widen every existing project's grid.
- **The Schedule Builder now stamps what it already knew.** It computes each generated activity's
  work type and floor/zone/unit and then **threw it away**, baking it into the activity NAME and the
  WBS nesting. `taskPayload` now carries `work_type` + `location`; `ensureLocLevels()` creates
  Location/Zone(/Unit) on first push if the project has none.
- **Backfill for existing schedules** (`openLocBackfill`): reads each activity's WBS ancestry and
  copies the names onto the new fields. ⚠️ The **depth→level mapping is shown and editable, not
  guessed** — a Phase>Location>Zone tree maps differently from Location>Zone — with a live count and
  a sample of what will change, an overwrite toggle, and a local apply before the batched write.
- Search now also matches work type + every location value.

**Verified: 33/33 in Node against the SHIPPED `buildNodes`** (extracted, not reimplemented) — the
WBS path unchanged, Opt 1 and Opt 2 shapes/depths/ancestry, order-swap keeping all activities, the
same-zone-name-under-two-locations case, ancestry chains being prefix-ordered and every ancestor
existing (collapse depends on it), missing values bucketing + sorting last, work-type falling back
to the activity name, filters pruning empty groups, `normalizeGroupBys` invariants, and group bars
rolling up child dates. Plus **in-browser** against the real stylesheet: the picker renders its 4
sections, highlights the active preset, disables ▲/▼ at the ends, actually reorders on click, 16×16
badges, 305px menu, no overflow. Existing 39/39 keyboard suite still green; script parses.
⚠️ **Not verified signed-in** — the migration hasn't been run, so no live click-through of the
backfill, the builder push, or a real 17k-row regroup. Screenshots impossible here.

## WBS Manager: the keyboard now works on a SELECTED ROW, not just a focused input (2026-08-04) — fmlozano
Follow-up to the build-speed work below. Every outliner key was bound to `keydown` on the row's
**name `<input>`**, so the moment focus left that input — click a row, arrow onto one, or select a
locked/synced heading that has no input at all — the keyboard was dead. New **document-level handler**
(next to the grid's, same scoping shape: bails while a field has focus, while any overlay is visible,
or when `#ps-view-wbs` isn't the visible tab) driving the selected row:
- **↑ ↓** move the selection · **Alt+↑↓** reorder among siblings · **Home/End** first/last.
- **← →** collapse / expand — and, once open, **→** steps into the first child while **←** steps out
  to the parent. Standard tree behaviour, and the reason a row selection is now genuinely navigable.
- **Enter / F2** enters edit mode on the name (a second Enter, now inside the input, adds the next
  WBS — so the two layers chain); **Shift+Enter** sub-WBS; **Insert** sibling after; **Tab /
  Shift+Tab** indent/outdent; **Delete** delete; **Esc** deselect.
- **No selection?** The first ↑/↓ lands on the top row, so the keyboard is always a way in rather
  than needing a click first. A selection filtered out by the search box recovers the same way.
- **Read-only** (`__viewOnly` / `__archived`): navigation and collapse/expand still work, every
  mutating key is inert.

⚠️ **The non-obvious bug this had to solve: `document.activeElement`.** The handler must bail when a
field has focus (otherwise it would hijack the search box's own arrow keys), but clicking a row did
**not** move focus — rows weren't focusable, so the search box kept it and the handler bailed on
every keystroke. Rows now carry `tabindex="-1"` and are explicitly `.focus()`ed on select, which both
fixes that and gives the tree a real focus target. `_wbsGoto(id, edit)` focuses the **row** when
navigating and the **input** when editing. Verified in-browser: focus goes `INPUT#ps-wbs-search` →
`DIV.ps-wbs-row`, so the guard passes. `focus({preventScroll:true})` everywhere — the function does
its own scroll-into-view and the browser's would fight it.

⚠️ **`_wbsNeighbourId` gained an `editableOnly` flag.** Name-editing navigation must *skip* locked /
synced rows (they render fixed text, not an input), but row *selection* must be able to land on them.
Both existing callers were updated to pass `true`; the new handler passes nothing.

⚠️ **Tab is swallowed while a row is selected** (it indents, matching the in-input behaviour), so it
no longer moves browser focus out of the tree. Escape clears the selection and hands Tab back.

**Verified: 39/39 in Node against the SHIPPED handler** (extracted from `index.html`, not
reimplemented) — all three focus guards, overlay guard, hidden-view guard, every key's routing,
selection landing on a synced row, end-of-list no-ops, the no-selection and filtered-out-selection
recovery paths, expand-then-step-into vs collapse-then-step-out, locked/synced Enter warning instead
of editing, and the full read-only matrix (navigation allowed, all 5 mutating keys inert).
**In-browser** against the real stylesheet + real `_wbsRowHTML`: `tabindex="-1"` on every row, the
search-box→row focus handover, `outline:none` on focus, no scroll jump, legend text, no page
h-scroll. ⚠️ **Not verified signed-in.** Screenshots remain impossible here (stalled compositor).
Module-local, no migration, no `?v=` bump.

## WBS Manager: make it fast to BUILD a WBS (2026-08-04) — fmlozano
The Manager was good at *editing* an existing tree and slow at *creating* one: every node cost a
modal round-trip (`wbsAddChild` → type a name → Save → re-render), and the only bulk paths were
"Adopt existing WBS" (import-only) and "Add WBS from Project", which was buried in the **grid's**
right-click menu and unreachable from the WBS view. Four ways in, aimed at how a planner actually
starts a WBS:

- **Type-to-build outliner (the main one).** `＋`/"Add WBS" now inserts a **blank node inline** and
  puts the cursor in it (`wbsQuickAdd` + `_wbsFocusName`) — no modal. From there the keyboard does
  the rest: **Enter** = next WBS at the same level, **Shift+Enter** = sub-WBS, **Tab/Shift+Tab** =
  indent/outdent, **Alt+↑↓** = move among siblings, **↑↓** = move the cursor, **Esc** = revert the
  field. **Enter on a still-blank name deletes that node** (`_wbsDeleteBlank`, guarded to leaf +
  0 activities + not locked) — the standard outliner way to undo an over-shoot. A persistent legend
  under the card header spells the keys out; without it they're invisible.
- **Paste an outline** (`openWbsOutline` + `parseWbsOutline`): paste from Excel/Word/notes, get a
  live preview of the tree with the codes it will receive, then build it in one go. Levels come from
  **dotted numbering** (`1.2.3 Name`) when the paste is demonstrably hierarchically numbered, else
  from **indentation rank** (tabs or any consistent spacing). Bullets are stripped; a paste can never
  skip a level. Optional "keep the pasted numbers as custom codes".
- **Duplicate a branch** (`wbsDuplicate`), row action `⧉`: copies a node + its whole subtree as
  siblings, N times, with a `#` placeholder in the name → "Level #" × 20 gives Level 1…Level 20.
  This is the typical-floor / tower / building case that otherwise means retyping the same subtree.
- **"From project…" surfaced** in the WBS toolbar (`wbsFromProject` already existed but was only
  reachable from the grid's context menu), and the empty state now offers the three starting points
  instead of a sentence.

**Behaviour notes / traps:**
- ⚠️ **`_wbsRenderWindow` now skips a repaint when the same slice is already painted.** Scrolling a
  row into view to focus its input fires `scroll`, whose rAF repaint would replace the window's
  `innerHTML` and **destroy the input mid-typing**. `renderWbsManager` always empties `.ps-wbs-win`
  when it rebuilds the skeleton, so a genuine re-render still paints. Don't "simplify" the guard away.
- ⚠️ **`_wbsNormalizeAndPersist(forceIds)` — `forceIds` is load-bearing.** It used to persist
  `parent_id`+`sort_order` for **every** node on every move (200 round-trips on an 8.6k-node tree);
  it now persists only the diff. But normalization can land a re-parented node on the **same integer
  `sort_order` it already had**, so the diff alone would silently skip its `parent_id` write —
  callers that re-parent MUST pass their moved ids. Verified in Node: a re-parent that keeps
  sort_order 0 is still persisted.
- **Renames during keyboard nav don't run the full `_wbsCommit`** (`_wbsCommitName`): a rename can't
  change any code, so the re-number/re-sync pass isn't needed and would steal focus. A `wbsDone` flag
  on the input stops the browser's change-on-blur firing a second (full) rename.
- ⚠️ **Batch builders don't rely on PostgREST insert ordering.** `_wbsInsertNodes` stashes a unique
  throwaway token in `code` (inert — `code_custom` stays false, so `computeWbsCodes` ignores it) and
  maps created ids back by token; `_wbsCommit` overwrites `code` with the real dotted code straight
  after. Both builders insert **one depth level per round-trip** (the `wbsAdopt` pattern).
- Indent now refuses to move a node under a `source_kind` (synced) parent and un-collapses the new
  parent, so an indented node can't vanish into a collapsed branch.
- New nodes are created with a **blank name** (placeholder-guided) rather than "New WBS", which is
  what makes Enter-on-blank a safe delete.

**Verified.** 19/19 in Node on the **shipped** `parseWbsOutline`/`_wbsOutlineCodes` (tab-indented,
dotted-code with no indentation at all, bullets + blank lines, uneven indent widths, first-line
over-indent, empty input, and the preview codes both at top level and under an existing parent).
⚠️ **Two real defects came out of those tests, not out of reading the code:** an ordinary name like
**"2 Storey Annex"** silently lost its "2", and "100 Preliminaries" was split into code+name — both
because the leading number was stripped before the mode was decided. Fixed by only splitting a code
in hierarchical-numbering mode. Plus 10/10 in Node on `_wbsNormalizeAndPersist` (re-parent at equal
sort_order, mid-list insert via the 0.5 slot, no-op writes nothing, duplicate-copy ordering).
**In-browser** against the module's real `<style>` + real `_wbsRowHTML`: 34px rows, locked headings
render fixed text with only ＋Act/＋, `source_kind` rows show the synced badge and **zero** buttons,
editable rows carry all 9 (incl. the new ⧉), no row or page h-scroll, name field 668px at 1280px
(the 9th button costs nothing), hint text correct, 0 console errors.
⚠️ **Not verified signed-in** — no live click-through of the actual insert/duplicate/paste writes.
Module-local, **no migration**, no `?v=` bump.

## Auto-generated WBS skeleton (2026-08-03) — fmlozano
Every project's WBS Manager now auto-seeds a **fixed 7-node outline** on first load (when
`WBS_NODES` is empty for that project, `ensureWbsSkeleton()` in `load()`'s resource-loading step):
- **L1** Milestones · Initiation Phase · Planning Phase · Execution Phase
- **L2** (under Planning Phase) Project Execution Plan · **Design Development** · **Procurement**

**Two new `wbs_nodes` columns** (migration `migrations/2026-08-03-wbs-skeleton.sql`, **USER MUST
RUN** — tolerant/no-op until then, just skips seeding):
- `is_locked` — every seeded node; blocks rename/recode/move/delete (`wbsRename`/`wbsMove`/
  `wbsEditCode`/`wbsDelete` all guard on it and toast). Add-activity/Add-child stay allowed so the
  L1 headings + Project Execution Plan remain normal, usable WBS nodes.
- `source_kind` — only **Design Development** (`'design_development'`) and **Procurement**
  (`'procurement'`): blocks **+Add activity** and **+Add child WBS** entirely (their data is meant to
  come from another module, not manual entry) and shows a "🔒 synced" badge instead of the usual
  action buttons in the WBS Manager row.
- `SOURCE_KIND_LABEL` names the intended source in every toast/tooltip: Design Development →
  "Drawing Register + Material Submittal Log"; Procurement → "the Procurement (WPM) app" (the
  existing `wpm_work_packages` mirror already used by Cash Flow — see [[cashflow-module-model]]).
- **Deliberately NOT built this pass:** the actual data pipe populating those two nodes' rollups
  from `drawing_register`/`material_submittal`/`wpm_work_packages` — this change only builds the
  skeleton + the "can't add activities here" guardrails. A follow-up can add a rollup summary (counts/
  status) read into each locked node's row, the same pattern as the Documents tab or the WPM mirror.
- Existing projects (already-nonempty `WBS_NODES`) are **untouched** — the skeleton only seeds a
  brand-new tree, it never merges into or reshapes an existing WBS.
- Verified: inline JS passes `node --check`. **Not browser-verified** (auth wall) — needs a signed-in
  check that a new/scratch project seeds the 7 nodes correctly and the locked/synced guards actually
  block the UI actions.

## Fix: "Critical path only" filter had zero effect (2026-07-30) — fmlozano
User asked for critical-path activities to be isolated (hide the rest, with an easy way to show them
again) — this feature **already existed** as Filter → Schedule → "Critical path only" (`filters.crit`,
added 2026-07-14), but testing it live on **Bauhinia (BAU101)** found it did **nothing**: toggling the
checkbox on/off left the grid showing all 246 activities regardless.
- **Root cause: `anyFilter()` never checked `filters.crit`.** `buildNodes()`'s WBS-mode branch only
  runs `rowMatches` filtering when `anyFilter()` returns true; that gate function ORs together search/
  behind/look/status/type/codes/col/adv but **omitted `filters.crit` entirely**, so toggling Critical-
  path-only **alone** (no other filter active) left `anyFilter()` false and the whole filter pass never
  ran — `rowMatches`'s own `if (filters.crit && !isWbs(r) && !r._critical) return false;` line was
  correct and simply never got invoked. Same bug hit the non-WBS grouped-mode branch (same `anyFilter()`
  gate). Confirmed via direct DOM inspection on the live site: checkbox toggled to `checked=true`,
  `filters.crit` verified true, grid still rendered all 246 rows (Cabinets Handles/Solid Wood Riser
  Detail/etc., all with 100+ day float, still visible) — not a UI-interaction miss, a real logic gap.
- **Fix:** one-token addition — `anyFilter()` now includes `filters.crit` in its OR chain.
- **Verified live on the deployed site** (BAU101, post-deploy hard-reload): checking "Critical path
  only" narrowed 246 → 4 critical activities + their WBS ancestors (Landscape/Bath House/Fence PC -
  Modularize under Designs, ACCU/Chiller under Construction → Mechanical — matching the Critical Path
  Report exactly); combined with the existing **"Hide empty groups"** toggle, childless ancestor
  branches (Milestones, Procurement) drop out too, leaving just the critical chain with real WBS
  context. Unchecking the filter instantly restores all 246 — the "show again" half the user asked
  for was already there, just inert until this fix. Module-local, no migration, no `?v=` bump.

## Mobile Gantt view (read-only, touch-scroll) (2026-07-26) — fmlozano
The phone view (`#ps-mobile`, <700px) was a card list only; added a **List | Gantt** segmented toggle
(persisted `ps_mview`). `renderMobile()` now dispatches to `renderMobileList(acts)` (the old cards) or
**`renderMobileGanttBody(nodes)`** — a self-contained compact Gantt (NOT the desktop virtualized pane,
which stays hidden on phones):
- Same `displayList()` data (respects search/filters/grouping/collapse), capped at `PS_M_CAP` (300) rows.
- Frozen sticky-left label column (`position:sticky;left:0`) + horizontally-scrollable timeline; month
  header (sticky-top); task bars with red %-fill, WBS-summary roll-up bars (`wbsSpan`), milestone
  diamonds (`isFinishMile` anchors on finish), a red data-date line, critical outline.
- Auto-fit scale: `dayw = clamp(1600/totalDays, 1.2, 6)` so the timeline is ~1600px then scrolls.
- Verified: `node --check`; geometry harness confirms month-cell widths **sum exactly to the timeline
  width** (header aligns with bars, diff 0), 1-day bars get a 3px min, data-date maps in range. Read-only
  (no edit/drag). **NOT browser-verified at 375px** (auth wall) — worth an eyeball on a real phone. CSS
  `.ps-mg-*` in the `@media (max-width:700px)` block; module-local, no `?v=` bump.

## Live collaboration — signed-in re-verification (2026-07-27) — fmlozano
Re-verified the PDCollab wiring on the deployed site, signed in, with a simulated second user
(independent Supabase client on the same channel). **Migration `2026-07-26-realtime-collab-project-schedule.sql`
is confirmed APPLIED.**
- ✅ **Presence** — GPR101 + XERTEST both show the topbar avatars; a 2nd member (Test B) appeared live.
- ✅ **Cell cursor** — Test B broadcasting `sel:{rowId,field:'activity_name'}` painted that exact grid
  cell with B's colour + "TB" flag (`paintRemoteCollab`), on the real row `92fa6007…`.
- ✅ **Live-value stream — infrastructure proven.** An isolated probe channel (light page, fresh client)
  subscribing to `postgres_changes` on `project_schedule` returned **SUBSCRIBED** and **received the
  INSERT event** for a test row (filter `project_id=eq.XERTEST`). So the table IS in the
  `supabase_realtime` publication, RLS/JWT allow the stream, and events deliver.
- ⚠️ **The module's own live-apply could NOT be confirmed end-to-end in-session.** On the heavy ~690KB
  Project Schedule page, while Chrome sits **behind** the Claude app (backgrounded), the tab throttles
  hard: the module's realtime channel goes to **CHANNEL_ERROR** (heartbeat starved) and CDP `evaluate`
  calls that `await` across a rAF-gated render **time out at 45s**. A test insert therefore did not visibly
  patch the grid *in that throttled state*. This is the **same documented automation artifact** as the
  rAF/screenshot caveats above — NOT a product defect: the probe proves the stream delivers, and the
  lightweight page (progress-photos) streamed fine in the same session. **Needs a real foreground
  two-session test** to watch the grid patch itself (open two browsers on the same project, edit in one).
- **Two-tab foreground attempt (2026-07-27, same session) — blocked by the environment, not the code.**
  Opened Project Schedule on **XERTEST** in two Chrome tabs; **both channels reported `joined`** (the
  lighter page kept its sockets alive, unlike the 25k GPR101 page). Fired a DB insert from tab A and
  sync-read tab B's grid — but tab B showed **0 painted rows**: its grid render is **rAF-gated**, and a
  Chrome tab that is not the OS-foreground window (Chrome sits behind the Claude app during automation)
  throttles rAF to a standstill, so the observer DOM never repaints even though the realtime event is
  delivered. Async fetch callbacks on the backgrounded heavy page also stall. **Conclusion: the visual
  grid-patch cannot be observed from automation** — it requires two real on-screen browser windows.
  Everything that does not need a live repaint is green (migration applied, stream delivers, presence,
  cursor) and the apply→rebuild→render logic is Node-harness-verified. Test insert cleaned up (0 leftover).
- **Data integrity:** all writes were on the XERTEST sandbox or a single restored GPR101 field
  (`percent_complete` 0→42→0, confirmed back to 0); every test row deleted (0 leftover, exact
  `activity_id` match). Nothing left in any real project.
- The `collab.js` **buildMembers sel-ref fix** (`?v=20260727b`, prior turn) applies here too — the avatar
  editing dot no longer masked by a stale presence ref when a user has multiple tabs.

## UI batch: collab cursor on all columns + keyboard, data-date line, network, L1/L2 IDs (2026-07-27) — fmlozano
Verified live on **Test Project** (id `Test`, 80 activities) throughout.
- **Collab cursor on every column, not just Activity Name.** `_setCellFromClick` broadcast the field via
  the stale `_CELL_META[ci]` (legacy built-in column order, out of sync with the live grid), so most
  columns sent the wrong field or null (null → painted the name cell). Now it reads the **clicked cell's
  own `data-field`**. Also added `data-field="status"` to the status cell (both pill + dropdown branches)
  so the cursor lands there too.
- **Cursor follows keyboard navigation.** New `broadcastActiveCell()` (reads the painted
  `.ps-cell-active` `data-field`) called from `moveRowSel` + `moveCell`, so arrow / Tab / Enter movement
  broadcasts, not only clicks.
- **Data-date line: label removed + drawn above the row highlight.** Removed the Gantt "Data date …"
  text label and the topbar "Data Date:" badge. The line lived in the static layer (z1) while the
  highlight band (`.ps-gantt-selband`) is in the bars layer (z3) → band drew over it ("broken"). Moved
  the line to a **top-level child of `.ps-tl`** (sibling of both layers) so its z6 wins — verified with
  `elementFromPoint` that the line is the topmost element over a highlighted row.
- **Activity Network never blank.** When no activity has links it showed only a hint. Now it renders
  **every activity as a node** (edgeless network) with a note; once links exist, behaviour is unchanged
  (linked set by default, toggle for the rest). Verified: 80 nodes render on the link-less Test Project.
- **Grid-only / Gantt-only confirmed working** (not a code change) — grid-only hides the gantt + grid
  full-width; gantt-only narrows the grid to 300px (OPC-style, intentional) + gantt fills. Both render
  visible content live; the only broken-looking view was the Network empty state (fixed above).
- **Hide Activity ID (WBS code) on WBS L1 + L2** (depth 0/1) in the grid — cleaner summary rows; L3+
  unchanged. Verified: Structure/F1/F2 blank, Z1/Z2 show `1.1.1`/`1.1.2`.
- Module-local (index.html inline), no migration, no `?v=` (index.html isn't cache-busted — hard-refresh
  to pick up).

## Offline editing + sync — Phase 2 (2026-07-26) — fmlozano
Wired the shared **PDSync** outbox (`assets/js/offline.js`): inline-edit the schedule offline, sync on
reconnect.
- **`persist()`** routes its `update` through `PDSync.write` (falls back to a direct write if PDSync is
  absent). The local apply (`r[k]=patch[k]`), `_myWrites` echo-stamp, undo, audit and `rebuild()` all run
  as before — a queued offline write returns ok and flows through the same optimistic path.
- **Read-offline** already existed (the IndexedDB stale-while-revalidate cache + `_cacheSaveSoon`, so an
  offline edit persists to the read cache too).
- **Field-level LWW**; online behaviour byte-identical to before. Composes with Phase-1 Realtime: a
  flushed offline edit streams to other viewers like any save.
- ⚠️ **Scope:** offline covers the **inline-edit `persist()` path only.** Bulk paths (import / global
  change / clear / leveling / bulk progress) and activity **delete/insert** stay **online-only** — not
  field scenarios, and queueing 40k offline rows is impractical. No migration. Verified: `node --check` +
  the shared outbox Node harness. NOT browser-verified (needs a real offline→online cycle). Assets: new
  `offline.js?v=20260726d`.

## Live collaboration — presence + live cell editing (2026-07-26) — fmlozano
Wired the shared **PDCollab** layer (`assets/js/collab.js`, Supabase Realtime) into the schedule grid —
same pattern proven on Drawing Register, plus two schedule-specific hardenings.
- **Wiring:** `maybeJoinCollab()` (re)joins a per-project channel in `load()` (guarded on pid change;
  `leaveCollab()` when no project); `key = project_schedule:<pid>`. `renderCollabPresence` → `#ps-presence`
  avatars. `broadcastCollabSel` fires from `_setCellFromClick` (column index → field via `_CELL_META`)
  and on `beginEdit`/commit. `paintRemoteCollab()` outlines each remote user's `.ps-grid-row[data-rowid]
  .ps-cell[data-field]` cell — called from the end of `highlightCells()`, so it re-applies after every
  virtualized `renderWindow` repaint. Only paints on the schedule tab (only it has cells).
- **Hardening 1 — coalesced remote changes + storm guard.** `_onRemoteChange` buffers postgres_changes
  and `_flushCollab` (180ms) applies the batch in ONE `rebuild()`+`renderAll()`. A **bulk storm**
  (import/global-change/clear fans out thousands of events) past **300** buffered → ONE `load()` reload
  instead of per-row patching. Essential: this is a 40k-row virtualized grid, not a small register.
- **Hardening 2 — echo suppression.** `persist()` stamps `_myWrites[id]`; `_applyRemoteRow` skips the
  Realtime echo of my own write for 4s (my optimistic local state is already correct), so an inline edit
  doesn't cause a redundant rebuild+render ~180ms later. Remote changes are also **deferred while an
  inline editor is open** (`_editing`).
- **Conflict model:** last-write-wins per cell (grid, not rich text); different fields of one row both
  win, same-cell clashes converge via each write's echo.
- **Migration `../../migrations/2026-07-26-realtime-collab-project-schedule.sql` (USER MUST RUN)** — adds
  `project_schedule` to `supabase_realtime` + `replica identity full`. Presence/cursors work WITHOUT it;
  only the live-value stream needs it.
- Verified: `node --check` + a Node harness for the coalesce/storm/echo/delete/defer logic (1 render for
  a 3-change burst, 0 for my own echo, 1 reload for 400 events, deferred-then-applied while editing).
  **NOT browser-verified** — needs two signed-in sessions. Assets `collab.js?v=20260726b`.

## Documents tab — schedule↔document link, phase 4 (2026-07-26) — fmlozano
Reciprocal of the Drawing Register / Material Submittal "Need-by" work: the schedule side of the
document connection. A drawing / submittal gates an activity's start, so each activity can now show
its enabling documents + whether they're approved in time.
- **New "Documents" detail tab** (`detDocs`/`wireDocs`, between Expenses and Relationships): lists every
  Drawing Register + Material Submittal row whose `schedule_activity_id` = this activity's `activity_id`,
  with type (DWG/MAT), name/desc, approval status (✓ when approved), lead days, and an **"Approve by"**
  date (need-by − lead). Header shows the activity's need-by (= its start) + a **readiness chip**.
- **`docReadiness(r)`** → ready / pending / at-risk (≤14d to need-by) / late (need-by passed) / null
  (nothing linked). Approved = drawing `Approved[ w/(o) comments]`, submittal `Approved[ w/ Comments]`
  (mirrors each register's own rule).
- **Lazy load** in `loadResourcesAssignments`: `DOC_DRAWINGS`/`DOC_SUBMITTALS` fetched with an explicit
  column list filtered to `schedule_activity_id NOT NULL` (only the linked subset — a handful/project,
  so one read, no pagination). **Tolerant** — if `migrations/2026-07-25-schedule-document-links.sql`
  hasn't run the column is absent, the query errors, caches stay empty, and the tab shows a hint.
- **Read-only** — linking is done from the register side (each document points at the activity it gates).
- Verified: inline script parses (`new Function`, 1 block, 0 fail). **Not browser-verified** (auth wall +
  needs a real project with linked documents + the migration run).
- **Deferred (deliberate):** a schedule-GRID document-readiness column + filter. The per-activity chip
  already surfaces the risk; a grid column across the virtualized 3-branch render (cell-count alignment +
  nth-child hide) is the risky change in this ~690KB concurrently-edited file — same call the register
  side made about grid changes. No `?v=` bump (module-local, no shared asset).

## Cell-nav horizontal autoscroll fixed (cells hidden behind frozen columns) (2026-07-22) — fmlozano
User: Left/Right/Tab cell navigation didn't autoscroll the columns correctly. Root cause in
`scrollCellVisible(r, c)`: the leading **#, Activity ID, Activity Name** columns are `position:sticky`
and float OVER the left edge of the scroll viewport, so a non-frozen cell can be scrolled *into* the
viewport yet stay **hidden behind those sticky columns**. The old check `if (left < sc.scrollLeft)`
ignored the frozen overlay entirely, so it never scrolled to uncover a left-obscured cell — and it
also scrolled pointlessly when the target itself was a frozen column.
- **Fix:** treat the frozen columns' combined width as the true left edge — reveal a left-obscured
  cell to `left − frozen − 4` (just past them), keep the right-edge case, and **no-op for frozen target
  columns** (they're always on-screen). `frozen` is summed from the row's first 3 children's live
  `offsetWidth` (hidden columns measure 0, so it's correct when columns are hidden/reordered off).
- **Verified live** (deployed, GPR101): deterministic replay of the exact math against real cell
  geometry — **all 11 visible columns are revealed from every scroll position (0 failures)** where the
  OLD algorithm failed all 21 in the tucked-behind-frozen case; the "failures" in a first pass were all
  hidden (width-0) cost columns, not real. End-to-end with real key events: ArrowRight scrolled 0→274
  (active cell revealed past the frozen columns), ArrowLeft scrolled 274→0 (active cell walked back,
  always visible). Module-local, no `?v=` bump.

## Gantt timeline no longer starts years before the schedule (2026-07-22) — fmlozano
User: the Gantt showed bars/timeline "all the way from 2022" though the schedule starts 2025.
**Not stray data** — verified live that the project's dates are clean (GPR101: all dates 2025–2029,
zero rows before 2024). Root cause: `range()` padded the scrollable timeline **2 YEARS before the
earliest activity and 3 after the latest** (`_min − 730` / `_max + 1095` days — the old "deep past/
future scroll" feature), and the Gantt opens at `scrollLeft 0`, so a 2025 schedule opened showing
empty years back to ~2023 (2024 for a project whose earliest start is late-2025; ~2022 for one
starting 2024). Confirmed live: GPR101's header spanned **2024–2032** for work that's really 2026–2027.
- **Fix:** padding tightened to a small margin — `_min − 31` days (≈1 month before) / `_max + 92`
  (≈1 quarter after; `_max` already extends +2 months). The pane still scrolls horizontally.
- **Verified live** (deployed): GPR101's header went **2024–2032 → 2026–2029**, opening at Nov/Dec 2025
  (the project starts Dec 22 2025) with summary bars at the left edge, no empty leading years; no
  console errors. Module-local, no `?v=` bump.

## One-call schedule_rows RPC — fast cold load (2026-07-22) — fmlozano
Follow-up to the cache-first work: cache makes *reopen* instant, but *cold first-open* was still ~8
sequential keyset round-trips (PostgREST caps table reads at 1000 rows). New SQL function
**`schedule_rows(p_project_id text) returns jsonb`** (migration
**`migrations/2026-07-22-schedule-rows-rpc.sql` — USER MUST RUN**) returns ALL of a project's rows as
a **single jsonb array in ONE round-trip** — a scalar jsonb return isn't subject to the max-rows cap.
`jsonb_agg(to_jsonb(t))` auto-includes every column (future-proof). **`security invoker`** so the
caller's RLS on `project_schedule` still applies (⚠️ never make it `security definer` — that would leak
cross-project rows). `grant execute … to authenticated`. Idempotent (create-or-replace + grant); lives
only in the migration, matching the sibling `schedule_scurve_agg` precedent (not in setup/schema).
- **Client:** `load()` calls `sb().rpc('schedule_rows', {p_project_id})` **first**; if it errors / isn't
  deployed, it **falls back to the keyset pagination loop** — so the app works before AND after the
  migration. Composes with the IndexedDB cache (RPC = fast cold/first open; cache = instant reopen).
- **Verified live** (deployed, migration NOT yet run): the RPC endpoint returns **404**, the client
  falls back to keyset, and a **17,122-activity project (Naga) loaded correctly** with no regression.
  The RPC *speedup* itself can't be verified until the migration runs (DDL needs DB privileges the
  in-browser anon client doesn't have) — after running it, the ~8 round-trips collapse to 1 automatically.

## Cache-first load — instant reopen (IndexedDB stale-while-revalidate) (2026-07-22) — fmlozano
User: "eliminate the loading time when the schedule is opened." **Measured the real bottleneck live**
first: Avesta (6,017 activities) cold-loaded in **~8.9s across ~8 sequential paginated round-trips** —
the wait is **round-trip latency × page count, NOT bytes**. So column-trimming ("lean columns") was
**deliberately not done** — it wouldn't cut the round-trips and risks silently dropping fields; the
real cold-load lever is a one-call server RPC (follow-up). Instead made **reopen instant**:
- **IndexedDB SWR** (`ps_schedule_cache`, store `rows`, keyed by project id). On open: if a cached row
  set exists (and its `uid` matches the logged-in user), paint it immediately with **no loading
  overlay** (`rebuild()` + `renderAll()` from cache), show a **"Cached · updating…"** badge, then
  re-fetch from the DB in the background and reconcile → **"Live"** (badge auto-hides), or
  **"Cached (offline)"** if the refresh fails. First open per project is unchanged (normal overlay).
- **Cached value is cleaned** — `_cachePut` strips `_`-prefixed fields `rebuild()`/CPM attach (some
  reference other rows → would bloat / break structured-clone); `rebuild()` recomputes them on load.
- **Edit-guard:** `_editSeq` bumps on every inline `persist()`; the background reconcile skips the
  `rows =` replace if an edit happened mid-fetch (that edit already hit the DB) so it never clobbers a
  live edit. `persist()` also debounce-recaches (`_cacheSaveSoon`).
- The cosmetic **count round-trip is skipped** on the cached path.
- **Verified live** (deployed, logged-in Chrome): reopening Avesta painted from cache in **~640ms vs
  ~8,900ms cold (~14×)** — the "Cached · updating…" badge fired (proving cache paint before network),
  then reconciled to "Live" and auto-hid; no console errors. The residual ~0.6s is local `rebuild()`
  (CPM/rollups), not network. Module-local, no migration, no `?v=` bump.
- **Follow-up for cold first-load:** a server-side RPC returning the whole schedule in one call (same
  pattern as `schedule_scurve_agg`) to collapse the ~8 round-trips into 1; and optional cross-project
  cache warming from the picker.

## Inline Status dropdown in the grid — one-click change (2026-07-22) — fmlozano
Changing an activity's status meant right-click → Edit activity → change the Status field — tedious on
10,000+ activity projects. The grid Status cell is now a **`<select>` styled as the coloured pill**
(`statusCellHtml`), so a writer changes status in one click directly in the grid. Read-only users
(`!canWrite` / `window.__viewOnly` / `__archived`) still get the static `<span>` pill.
- `change` is wired via re-attachment in `renderWindow` (rows are virtualized/windowed, like the
  `.ps-editable` dblclick wiring) and routed through **`_statusPatch`** (Completed → Actual Finish +
  100% + 0 remaining; In Progress → clear finish, reseed remaining; Not Started → clear actuals) and the
  undoable **`persist()`** — identical write path to the other inline cell edits, so it's undoable and
  has the same side-effect semantics as the detail-panel Status field. `mousedown`/`click`
  `stopPropagation` so opening the dropdown doesn't trigger row-select / cell-nav.
- WBS-summary / group rows keep an empty status cell (unchanged). Only ~visible rows render a select
  (grid virtualization), so no cost on huge schedules. Module-local, no migration, no `?v=` bump.
- **Verified live** (deployed, logged-in Chrome): on Avesta (real) the cells render as enabled selects
  with correct values; on the DEMO01 sandbox, changing M2003 Not Started → In Progress via the dropdown
  **persisted through a full DB reload** (searched it back, read "In Progress"), then restored to
  "Not Started". Screenshot shows every task row's Status as a "· ⌄" dropdown pill; WBS rows blank.

## Grid keyboard shortcuts never fired — hidden overlay tripped the guard (2026-07-22) — fmlozano
User: Arrow keys scrolled the panel instead of moving the selection; Tab traversed page buttons
instead of grid cells (not Excel-like). Root cause: the grid-shortcut `keydown` handler bailed on
`if (document.querySelector('.pd-modal-overlay, .ps-back.open, .ps-rep-back.open')) return;` — a
**bare presence** check. But `#ps-modal` **is** `.pd-modal-overlay` and is always in the DOM
(`display:none`), so the selector always matched and the handler returned before ANY branch
(Arrow/Tab/Enter/PageUp-Down/Home/End/F2/type-to-edit/Delete/Esc/Ctrl-C-X-V-D) — every key fell
through to the browser default (panel scroll / focus traversal). The line above already gates
`#ps-modal` via a `display` check, so this term was both redundant and wrong.
- **Fix:** iterate the overlay matches and bail only when one is actually **visible** (`offsetParent
  !== null`), so the always-present hidden `#ps-modal` no longer blocks; real open modals / `.ps-back.open`
  still block. Module-local, no `?v=` bump.
- **Verified live** (deployed app, logged-in Chrome) by reproducing the exact condition (temporarily
  removing the `.pd-modal-overlay` class from the hidden `#ps-modal`, which is what the visibility guard
  achieves): ArrowDown then prevents default (no scroll) and moves the selection across rows; Tab
  prevents default (focus stays in the grid, no button traversal) and sets the active grid cell.

## WBS Manager tree virtualized + verified live (2026-07-22) — fmlozano
Broad searches / Expand-all painted every visible row into the DOM (7,691 rows for a broad search on
the 8,596-node project → ~1s+). Now the render flattens the visible tree into `_wbsFlat` and only the
scroll-viewport window (+8-row buffer, ~24 rows) is in the DOM at once, offset by `translateY` over a
spacer that reserves the full scroll height — mirrors the grid/Gantt virtualization (`WBS_ROWH=34`).
- **Event delegation** on the persistent `#ps-wbs-tree` (attached once via `_wbsWire`) replaces per-row
  `onclick` — the window's rows are recreated on every scroll, so per-row handlers couldn't survive.
  Buttons dispatch by `data-*` key; focusing a name input selects its row via a class toggle (no full
  re-render → no blur mid-edit); scroll position is preserved across full re-renders (searches reset to
  top). Row height is fixed (34px) to match `WBS_ROWH`.
- **Verified live** on the 8,596-node project (deployed, logged-in Chrome): default 6 rows instant;
  **Expand all = 45ms with only 23 DOM rows** (was 1,433ms / 8,596 rows); search "Tower" = 34 matches /
  48-row set → 24 DOM rows; **extreme search "a" = 6,671 matches / 7,691-row set → 24 DOM rows, no
  freeze** (~400ms); delegated caret-collapse (→1 row) and row-select both work; screenshot shows the
  tree rendering correctly (hierarchy/codes/badges/carets/scrollbar). Window-slicing math unit-verified
  (~30 rows constant across 8,596). No console errors.
- ⚠️ **Caveat:** scroll-driven window repaint is gated behind `requestAnimationFrame` (same as the
  grid/Gantt). rAF is throttled when the tab isn't the OS-foreground window, so in the automated session
  programmatic `scrollTop` changes didn't repaint the window; in normal interactive use rAF fires and the
  window follows the scrollbar. The synchronous paths (expand/collapse/search) were verified directly.

## wbs_nodes load truncated at 1000 (fixed) + WBS Manager verified live (2026-07-22) — fmlozano
Found while verifying the WBS optimization **live on a large project** (deployed GitHub Pages, in the
user's logged-in Chrome). `load()` fetched `wbs_nodes` with a plain `select('*')` — Supabase caps at
1000 rows, so a big P6 import loaded a **truncated** tree; nodes whose parent fell past row 1000
dropped out of the walk. Live symptom: project **“4PH Jab Greenwoods Dasmariñas”** reported "1000
nodes" but rendered only 2 connected rows. **Fix:** keyset-paginate by `id` (the render/index re-sorts
by `sort_order`, so load order is irrelevant); same fix applied to the copy-WBS-from-project source
read. Same bug class as the audited resource_assignments/drawing/photos loads. No migration, no `?v=`.
- **After the fix, verified live** the project actually has **8,596 WBS nodes** (was capped at 1000):
  default load renders **6 rows** (large-tree collapse) instantly; **Expand all** → all 8,596 rows in
  ~1.4s (worst case); **Collapse all** → 1 row in ~114ms; caret toggle collapses/expands correctly;
  **Search** "Closeout" → 20 matches / 62 rows revealing each match **plus its full ancestor chain**
  (verified a 6-level-deep node: 1 → 1.4 Execution → 1.4.3 Superstructure → … → Closeout) in ~1s; clearing
  search restores the collapsed default. No console errors. (Very broad search terms render
  proportionally many rows — expected, same cost as Expand all.)

## WBS Manager optimized: indexed render + collapse/expand + search (2026-07-22) — fmlozano
`renderWbsManager` was O(N²)/O(N·rows) and painted **every** node at once — on a P6-scale tree
(~14k nodes / ~27k activities) it froze the tab. Per node it called `wbsActivityCount` (a full
`rows.filter` — ~378M iterations total), `wbsChildren` (filter+sort of all nodes), and `wbsDepthOf`
(linear `wbsById` walk). Fixes:
- **New `_wbsBuildIndex()`** builds `byId` / `childrenOf` (sorted) / `actCount` / `codeOf` in **one
  pass** at the top of the render; the walk uses those (no per-node scans). Benchmarked on a
  14,420-node / 27,600-activity fixture: the per-node-scan render cost dropped **11,171ms → 12ms**.
- **`computeWbsCodes` de-nested** the same way (was calling `wbsChildren` per level → O(N²·log N),
  now O(N·log N)). **Pure, identical output** (custom `code_custom` codes preserved, same sibling
  numbering + comparator) — verified against the old algorithm on a mixed fixture.
- **Collapse/expand** per node via a caret glyph (`_wbsCollapsed` set); only visible (expanded) rows
  are emitted, so the DOM stays small. Large trees (>300 nodes) **default-collapse** below the top
  level on load (`_wbsCollapseInit`, reset in `load()` + `selectProject`). Toolbar **Expand all /
  Collapse all** buttons. Adding a child auto-expands its parent so the new node is visible.
- **Search box** (`_wbsSearch`, 180ms debounce): reveals nodes whose code/name matches **plus their
  ancestors** (so matches are reachable), ignoring collapse on the matched path; shows a match count.
- Editing behavior unchanged — all existing row buttons (＋Act/＋/▲▼/→←/✎/✕), row-click select, and
  name-input rename are untouched. State (`_wbsCollapsed`/`_wbsSearch`/`_wbsCollapseInit`) resets on
  project switch + Clear. Module-local, no migration, no `?v=` bump. Inline script parses; index /
  codes / activity counts / search-visibility unit-verified in a Node harness.

## Last Planner section made collapsible (2026-07-22) — fmlozano
Follow-up to the merge below: the merged Last Planner block made the cockpit a long scroll on load,
so the `.ps-ck-secdiv` divider is now a **toggle button** (`#ps-lp-toggle`, a `<button>` styled as the
divider) with a rotating chevron; it collapses `#ps-lp-section` (all LP content wrapped in it) via a
`.collapsed` class → `display:none`. State persists in `localStorage['ps_lp_collapsed']`, applied on
init (default expanded). Wired next to the title-menu handler (same proven pattern). ⚠️ The chevron
`.ps-ck-secdiv-chev` needs `display:inline-flex` for the `rotate(-90deg)` to apply (an un-hydrated
inline icon span isn't transformable). Verified in a browser snapshot: only the `.collapsed` rule sets
the chevron transform, section toggles block↔none, no console errors. (Computed-transform readout is
unreliable in the static-snapshot renderer after a dynamic class change — the known quirk — so the
rotation was confirmed via the selector engine + the collapsed-state matrix, not the stale post-toggle
read.) Module-local, no `?v=` bump.

## Merged Last Planner into the Planner Cockpit tab (2026-07-22) — fmlozano
User felt the separate **Planner Cockpit** and **Last Planner** tabs were redundant / low-value as
two top-level views. Chose to **merge, not remove** (kept all functionality). The Last Planner
weekly section (week nav toolbar, PPC KPIs, weekly commitments table, PPC trend, reasons-for-variance)
now lives **inside `#ps-view-planner`**, below the cockpit KPIs/forecast, under a new
`.ps-ck-secdiv` divider ("Weekly Work Plan · Last Planner"). The `#ps-view-lastplanner` wrapper and
the `lastplanner` title-menu item are gone; `switchTab`/`renderAll` now call **both** `renderPlanner()`
and `openLastPlanner()` when the `planner` tab is active. All element IDs unchanged
(`ps-ck-*` vs `ps-lp-*` never collided), so every existing event handler keeps working; no DB change,
no `weekly_commitments` migration touched, no `?v=` bump (module-local HTML/CSS/JS only). Verified in
the browser: no console errors, `#ps-lp-table` resolves inside `#ps-view-planner`, `ps-view-lastplanner`
removed, menu down to planner/wbs/schedule/cost. Zero `lastplanner` references remain in the file.

## Cleanup: remove the dead old cost-TABLE code (2026-07-21)
Follows the Cost/EVM rebuild below, which orphaned the old per-activity cost table. Removed the
now-inert cluster (verified zero live refs first): `COST_COLS`, `_vc`, `costW`, `costColW`,
`costVisibleCols`, `startCostColResize`, and the now-dead `table.ps-cost-table` / `.ps-cost-th` CSS
(my WBS-overlap fix from `a109ae3` — that table no longer exists). Also simplified `renderColsMenu` to
drop its `onCost`/`COST_COLS` branch: the Columns chooser is only reachable on the Schedule tab (the
whole toolbar is `display:none` on other tabs, per `switchTab`), and the rebuilt Cost tab has no
hideable columns. **Behavior-preserving** — the removed branch was already unreachable,
`startCostColResize` had no callers, `applyColHidden` only ever used `gridCols()`. Verified: zero
remaining references to any removed symbol, script parses, and on the deployed page the Cost/EVM
dashboard renders and the Schedule column chooser still works.

## Cost Loading rebuilt → Cost / EVM dashboard (2026-07-21)
The old "Cost Loading" tab was a flat per-activity cost table — redundant (the Schedule grid already
shows per-activity Planned/Actual/EV/At-Completion IBB columns; the **Activity Usage** detail tab
already draws the time-phased per-activity cost curves) and low-value. Rebuilt into a **project-level
EVM dashboard** (tab relabelled **Cost / EVM**):
- **EVM KPI cards** at the data date: BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, VAC, TCPI + an over/under-
  budget · on/behind-schedule status chip. Math: PV = Σ budget × plannedPOC (planned % by data date);
  EV = Σ earned_value (fallback planned_cost × %); AC = Σ actual_cost; EAC = AC + (BAC−EV)/CPI;
  TCPI = (BAC−EV)/(BAC−AC).
- **Cost S-curve**: cumulative PV spread linearly across each activity's planned dates, with EV/AC
  plotted as points at the data date (no cost history is stored) + a BAC reference line.
- **Cost variance by WBS**: `_costMap` roll-up (Budget/Actual/Earned/CV/CPI/%Spent per branch),
  over-budget rows flagged red, + a project TOTAL row.
- `renderCost()` early-returns unless `activeTab==='cost'` (the EVM compute is heavier than the old
  table and `renderAll()` calls it every render). New DOM ids: `#ps-cost-status/-kpis/-curve/-note/-wbs`.
- The old flat-table helpers (`COST_COLS`, `startCostColResize`, `costColW/costVisibleCols`) are now
  dead code — left in place (inert; the cost-tab toolbar/column-chooser is hidden anyway). Minor cleanup TODO.
- Verified: inline script parses; EVM aggregation unit-tested (SV −10k/CV −15k/SPI 0.9/CPI 0.857/EAC
  350k/VAC −50k/TCPI 1.077 on a fixture); browser harness with a cost-loaded fixture rendered the KPIs
  (BAC 300k/EV 90k/AC 105k…), PV S-curve (13 months), status chip, and WBS table with no console errors.
  No migration, no `?v=` bump.

## THE ACTUAL "count populated, grid empty" bug: deferred render (2026-07-21)
**Verified on the deployed page** with a real 17,122-activity project (GPR101), driving the user's
logged-in Chrome. The screenshot bug reproduces on initial load: for ~8 seconds the footer reads
"Total: 17122 activities" while the grid still shows **"Select a project."**, then it self-corrects
at ~t=10s. **This is NOT the switch race fixed just below — that fix was correct but addressed a
different failure mode.** Root cause, from the live timing (footer set at t≈2s, grid painted at
t≈10s, overlay already hidden in between):
- `load()` finishes pagination (~2s), `hideLoading()`, `rows = all; rebuild()` → **footer count set
  immediately**.
- It then `await`s `loadResourcesAssignments()` + `_wbsEnsureSummaries()` — several seconds for a 17k
  activity project (many resource/assignment rows) — and **only called `renderAll()` AFTER those**.
- So the grid kept the stale pid=null "Select a project." paint for the whole resource-load window
  while the footer already showed the count.
- **Fix:** call `renderAll()` right after `rows = all; rebuild()` (and moved the large-schedule
  collapse block up before it), *then* load resources, *then* `renderAll()` again. The grid/Gantt
  only need `rows`; resources + WBS_NODES are for the Resource-Usage tab and WBS Manager, so painting
  before them is safe. Window drops from ~8s to ~0 (pagination is covered by the loading overlay).
- Verified live that the render itself works (a user-triggered switch to the same 17k project paints
  correctly — footer + grid consistent); the only defect was the *timing* of the paint. Re-verify on
  the deployed page after this ships. Module-only, no `?v` bump.

## Load race: footer count populated while grid shows "Select a project." (2026-07-21)
Reported from a screenshot: a big schedule (16,409 activities) with the footer reading
"Total: 16409 activities" but the grid showing "Select a project." — the count and the grid
disagreeing about whether a project was even selected.
- **Root cause: `load()` was async + keyset-paginated (up to ~17 sequential round-trips for a 16k-row
  project) with NO re-entrancy guard.** Switching or deselecting a project mid-load left the STALE
  load to run its terminal `rows = all; rebuild(); … renderAll()` after `pid` had already changed —
  clobbering `rows`, the footer count, and the rendered grid with the wrong project's state. The exact
  visible symptom depends on the precise rAF/await interleaving (grid can end up empty *or* showing a
  deselected project's rows); both are the same bug.
- **Fix: a monotonic load token `_loadGen`.** `load()` does `var gen = ++_loadGen` at entry and, after
  **every await** (each pagination page, the catch, before the commit `rows = all`, after
  `loadResourcesAssignments`, after `_wbsEnsureSummaries`), bails with `if (gen !== _loadGen) return`
  if a newer load has started. The `!pid` early-return branch now also `hideLoading()`s, since a stale
  load aborts silently and never touches the overlay (the newest/terminal load owns it). Covers every
  `load()` caller (project switch, undo/redo, import, scenario restore) uniformly.
- **Verified in a Node harness** modeling the real `load()`/`rebuild()`/`doRender()` + rAF deferral:
  WITHOUT the guard, deselecting or switching mid-load leaves pid/footer/grid inconsistent in 2 of 3
  scenarios; WITH the guard all three are consistent (deselect → "Select a project." + count 0;
  re-select same project → loads normally). Full inline script still parses. No shared asset, no `?v`
  bump. (Live click-through needs a real 16k-row project + a mid-load switch — the harness stands in.)

## Brand icon beside the title (2026-07-21)
The title is a **view-switcher button** (`.ps-title-btn`), so unlike every other module it never had
the brand-red module icon before its text — the `calendar` icon (the module's `config.js` icon) only
appeared inside the dropdown menu items. Added `<span class="ps-title-ico" data-ico="calendar">` before
`#ps-title-txt` inside the button, so it's `[calendar] Project Schedule ▾` matching the suite.
- ⚠️ Existing `.ps-title-btn [data-ico] { color:var(--pd-muted) }` (for the chevron) also matches the
  new icon. Override with **`.ps-title-btn span.ps-title-ico`** (0,2,1) which outspecifies it (0,2,0)
  regardless of source order. Verified the icon is brand-red (`#EE3124`) while the **chevron stays
  muted** — the override is scoped, not bleeding to the chevron.
- Kept it inside the switcher button on purpose: clicking the icon still opens the view switcher.
- Verified in a harness (real title markup + module CSS + icons.js): icon hydrates to SVG, brand-red
  via `currentColor`, 20×20, left of the text, chevron muted, order ICON→TEXT→chevron, and stays
  brand-red in dark mode. Screenshot still impossible (compositor stall) — measured via
  getComputedStyle. Module-only, no shared asset, no `?v` bump.

## Cost Loading tab: WBS/name overlap + duplicate-ID fixes (2026-07-21)
Reported: the Cost Loading table's WBS code visually overlapped the Activity Name (e.g.
"1.4.2.5.2.3.1Cabinetry" with ghosted text). Two real bugs found:
- **Overlap (visible).** `.ps-cost-table` is `table-layout:fixed`, but `.ps-table td` had **no
  overflow clipping** — so a WBS `<code>` wider than its 90px column bled straight into the next
  cell. Fixed with `table.ps-cost-table td { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`
  (full value now on hover via a `title` attr set in `renderCost`), widened the WBS column 90→120,
  and monospaced the code. ⚠️ **Specificity gotcha:** headers wrap via `table.ps-cost-table th` (0,1,2)
  because plain `.ps-cost-th`/`.ps-cost-table th` (0,1,1) is *outspecified* by `.ps-table th`'s
  `white-space:nowrap` which appears later in the sheet — so headers now WRAP ("Planned % (POC)"
  instead of clipping to "(PC") instead of being cut mid-word.
- **Duplicate `id="ps-cost-body"` (latent).** The Cost Loading `<tbody>` AND the "Cost Accounts (CBS)"
  modal panel both used it. `renderCostAccounts()` grabbed the first match (the hidden cost tbody),
  so the CBS manager wrote into the wrong element and appeared empty. Renamed the panel to
  `ps-cost-acct-body` + its one reader.
- Scope is safe: the new rules match `table.ps-cost-table` only — the two import-preview `.ps-table`
  tables lack that class and the Schedule grid uses `.ps-grid-*`, so neither is touched.
- **NOT a bug: the ₱0 / "—" cells.** That project's schedule was imported from P6/OPC with no cost
  loaded, so planned/actual/EV are genuinely 0 and baseline/CPI are null (—). Nothing to "fix" there.
- Verified in a browser harness using the module's real `<style>` + long screenshot WBS codes at the
  actual 12-column widths (sanity-asserting the CSS loaded first): WBS cell clips with no overlap into
  Activity Name, title tooltip present, and all 12 headers wrap to 2 lines with **none clipped**.
  Screenshot still impossible (compositor stall) — measured via `getBoundingClientRect` /
  `getComputedStyle`. Module-only change (project-schedule/index.html), no shared asset, no `?v` bump.

## Audit fix: paginate resource_assignments (2026-07-21)
`loadResourcesAssignments()` fetched `resource_assignments` with a single `select('*')` — Supabase
caps at 1000 rows, so P6/XER projects (~51k–55k assignments) silently loaded only the first 1000,
corrupting Resource/Role Usage, resource leveling and cost roll-ups. Now **keyset-paginated**
(`order id.asc`, `gt(id,last)`, `limit 1000`), matching the main activity `load()`. Assignment order
is irrelevant (aggregated by activity). Verified: parses clean; Node test confirms the loop loads all
rows (2500/2500) and terminates. No migration, no `?v=` bump. (Also see the RLS project-scope fix
migration `2026-07-21-rls-project-scope-fix.sql` — the schedule support tables' reads/writes are now
project-scoped.)

## Clear didn't clear, and re-import duplicated every WBS level (2026-07-17) — fmlozano
Two reports, **one root cause**: `wbs_nodes` was never deleted by any destructive path. Clear schedule
and both importers' "Replace existing" only ever ran `delete().eq('project_id', pid)` on `TABLE`
(`project_schedule`). The tree is a **separate table**, and the grid's WBS rows are only a *projection*
of it — so the nodes always survived, and the two symptoms fall straight out of that:
- **"Clear did nothing."** Clear deleted the summary rows, then `load()` → **`_wbsEnsureSummaries()`**
  (the orphan self-heal added 2026-07-16) faithfully re-projected a summary row for every surviving
  node. The rows were genuinely deleted and then immediately recreated — working as designed, on a
  tree that should no longer have existed. ⚠️ **These two features are only correct together**: the
  self-heal makes any path that drops schedule rows *without* dropping nodes look like a no-op.
- **Re-import duplicated the WBS levels.** "Replace" wiped `project_schedule`, so the importer's fresh
  summary rows all arrived with `wbs_node_id = null` → `autoAdoptAfterImport()` → `wbsAdopt()` mapped
  **every** legacy row to a new node payload with no check against the codes already in `WBS_NODES`
  (`nodeByCode` was seeded from them, but only ever *read* for parent lookup). One extra node per code
  per import, each then re-projected by the self-heal into another summary row.
- **Fixes.** (1) New **`_clearWbsTree()`** — deletes the project's `wbs_nodes` and resets the in-memory
  `WBS_NODES`; tolerant of a DB without the wbs-nodes migration (nothing to clear is not an error).
  Called by the Clear handler (which now also resets `_wbsSel`, and says "activities **and the entire
  WBS tree**" — it always destroyed more than the old copy admitted) and by the `replace` branch of
  **both** `doImport` and `doImportXER`; the tree is rebuilt from the incoming file by the existing
  `autoAdoptAfterImport()`. (2) `wbsAdopt` now builds node payloads only for codes **not already in
  `nodeByCode`** — the link loop below it already resolves each code through `nodeByCode`, so an
  existing node is **adopted and linked** rather than re-inserted. Belt-and-braces: it makes adopt
  idempotent on its own, so a re-run can't duplicate even if a tree survives some other way.
  ⚠️ Do **not** "simplify" this by filtering the `legacy` list instead — skipping those rows leaves
  them with `wbs_node_id = null`, and the self-heal then duplicates the *summary rows* instead.
- **Verified in a node simulation** of the real cycle (import → re-import ×3 → load) against a mutable
  store, mirroring `wbsAdopt` + `_wbsEnsureSummaries`. Reproduced the bug from the **shipped** code
  exactly — 4 codes → `1 x4, 1.1 x4, 1.2 x4, 1.1.1 x4`, self-heal adding 12 rows (matching the
  reported screenshot's repeated "1.1 Project Milestones") — and confirmed the fix holds at 4 nodes /
  4 summary rows / 0 duplicates / 0 unlinked across 3 re-imports; Clear+load now leaves **0** rows
  (was 4 resurrected). Not yet clicked through on a live login (needs a session + a project).
- **Existing duplicated data is not migrated** — the fix stops new duplicates, it doesn't clean up the
  ones already in the DB. Remediation is now possible for the first time: **Clear schedule → re-import**.
- **No migration.** `project_schedule.wbs_node_id` is a plain uuid with **no FK** to `wbs_nodes`, so
  deleting nodes first can't raise a constraint error and the delete order doesn't matter.

## Column chooser clipped by the details panel (2026-07-16) — fmlozano
The `+` column chooser (`#ps-cols-menu`) was cut off mid-list — worse the further up the details
panel was dragged.
- **Root cause:** `.ps-split` sets **`overflow:hidden`** (line ~243, for its border-radius + pane
  clipping), and `.ps-cols-corner`/`.ps-cols-menu` are absolutely positioned **inside**
  `.ps-grid-pane` within it. So the menu was clipped at the split's bottom edge — i.e. wherever the
  details panel happened to push it. The chooser's own `max-height:340px; overflow-y:auto` was
  useless here: the **ancestor** did the clipping, so the scrollable remainder was unreachable (this
  is a *different* bug from the 2026-07-14 cascade fix below, which made it scroll at its own cap).
- **Fix:** `positionColsMenu()` pins the menu to the **viewport** (`position:fixed`, re-anchored to
  the button's rect on every open) — which escapes every ancestor's overflow — and caps
  `max-height` to the real space below the button (`innerHeight − r.bottom − 16`, floor 180). Same
  approach `openRowMenu` already uses. Re-anchored on `resize` + `scroll` (capture phase, so it also
  catches ancestor scrolls) while open, since fixed positioning is viewport-relative.
- **Verified in a browser harness** against the module's real CSS, using `elementFromPoint` (CSS
  overflow clipping doesn't shrink `getBoundingClientRect`, so a rect check would have missed it):
  with a 280px split — before: content 726px, capped to 340px, **103px of that clipped away**, bottom
  not hittable (`bottomOfMenuActuallyVisible:false`); after: fully visible. At a 600px-tall viewport:
  menu bottom 588 ≤ 600 (fits), scrolls internally (517px box / 707px content), scrolls to the end,
  right edge still aligned to the button.

## WBS added in the Manager didn't appear in the Schedule (2026-07-16) — fmlozano
Reported on **Naga City Integrated Terminal**: adding a WBS Level 1 in the WBS Manager showed the node
in the tree but **nothing in the Project Schedule**; an activity added under it *did* appear.
- **Mechanism (explains both halves).** The tree lives in `wbs_nodes`; the grid only ever renders
  **projected `project_schedule` WBS-Summary rows**. Two writers, inconsistent treatment of
  `wbs_node_id`: the activity `save()` deliberately keeps it **out** of the main payload and writes it
  after in its own try/catch ("so a not-yet-migrated DB never breaks the main save"), but
  `wbsAddChild`'s projection insert put `wbs_node_id` **in** the payload — so on a DB missing that
  column the activity insert survives and the summary insert fails. And the failure was **silent**:
  `if (!sres.error && sres.data) rows.push(...)` dropped the error on the floor. Node in the tree, no
  schedule row, no message.
- **Fix:** new **`_insertWbsSummary(payload)`** — retries without `wbs_node_id` when the error names
  that column (warn toast: "Saved without the WBS link — run the wbs-nodes migration"), and **surfaces
  any other error** instead of swallowing it. Used by `wbsAddChild` and the copy-from-another-project
  path (which had the identical swallow).
- **CONFIRMED (2026-07-16):** the column really was missing — the user ran
  `migrations/2026-07-07-wbs-nodes.sql` only after hitting this, so every node created before that ran
  lost its projection. (An `information_schema` check *after* the migration shows the column present,
  which briefly looked like a disproof — it isn't; it's just post-migration state.)
- **Orphan nodes + `_wbsEnsureSummaries()` (the actual repair).** The failure left Naga with 3 nodes in
  `wbs_nodes` and **zero** WBS-Summary rows: visible in the WBS Manager, absent from the Schedule, and
  **unrepairable** — "Adopt existing WBS" only runs the other direction (summary rows → nodes), and its
  button is hidden precisely when there are no summary rows to adopt. New `_wbsEnsureSummaries()`
  re-projects any node lacking a summary row; it is **additive + idempotent** (keyed on
  `wbs_node_id`, so a reload can't duplicate) and gated on the new module-scope **`canWrite`**
  (super_admin/admin/planner — mirrors `is_planner()`) so a read-only user never triggers a write on
  load. Called from `load()` (after `loadResourcesAssignments`, which populates `WBS_NODES`) and at the
  top of `_wbsCommit()`. No-op on healthy projects. Verified in a node harness against Naga's exact
  state: 3 nodes → codes 1/2/3, second pass finds 0 missing, activities at `wbs "1"` nest under the
  restored Pre-Development row.
- **Related inconsistency (not fixed):** `2026-07-07-wbs-nodes.sql` was folded into `supabase-setup.sql`
  but **NOT into `supabase-schema.sql`** (0 mentions of `wbs_nodes`/`wbs_node_id` there), so any DB
  built from `supabase-schema.sql` lacks both the table and the column — i.e. this bug is still
  reproducible from a fresh schema build. Worth reconciling.
- **Dead read-only guards (pre-existing, NOT fixed):** neither `window.__viewOnly` nor
  `window.__archived` is **ever assigned** anywhere in the repo — both are read in ~8 guards each and
  are permanently `undefined`, so the intended "read-only / archived project" protections do nothing.
  This is why `canWrite` above had to be introduced rather than reusing `__viewOnly`.

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Project Schedule & Cost Loading** (Phase 2). Your DB table is `project_schedule`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; add a Gantt/cost-loading table as needed)**.
> 4. Work only inside this folder, on branch `module/project-schedule`, then PR to `main`.
> 5. Update this file as you build.

## Activity Progress: centered %-cells + Pie presentation with activity data-selection (2026-07-17c) — jasantos2 / eprobles
- **Centered cells:** No. / Planned Value % / Activity % Complete cells centered for task + WBS rows
  (`PROG_DEF[k].center` → `.ps-prog-cc`), matching the centered headers.
- **Presentation toggle (Table / Pie chart):** persisted `ps_progpres`. Pie mode (`renderProgressPie`)
  draws an SVG pie where each **selected** activity is a slice, sized by a metric (`ps_progmetric`:
  Activity % Complete or Planned Value %), full-circle when a single 100% slice; colours matched between
  slices and the legend.
- **Data selection:** a checklist of activities with All/Clear (`ps_progsel` per project; null = all) —
  tick which activities appear in the pie; `wireProgCtrls` handles the toggle, metric, checkboxes.
- Parses clean; served-file check passed.

## Duration model: baseline-locked planned, live actual, independent remaining, at-completion (2026-07-17b) — jasantos2 / eprobles
- **Planned (original) duration = BASELINE span** (`_origDurOf` prefers BL finish − BL start + 1), else the
  current span, else duration_days. **Locked/read-only when a baseline exists** — grid DUR cell drops
  `ps-editable`, detail shows `_gro` "baseline (locked)" instead of the editable `_gfPdur`. New `_durLocked`.
- **Actual Duration is computed LIVE** = data date − actual start (or actual finish − start once done) via
  `actualDurLive`; the detail field is now read-only (was an editable stored number), so it tracks the
  data date. Actualize today → actual 0; data date next week → actual = 7.
- **Remaining Duration is independent**: on start (`_fcFields` / actualize) it seeds to the **full planned
  (baseline) duration** (so "actualized today → remaining = planned"), then only changes on explicit edit
  (no auto-reduction as the data date advances).
- **At Completion = actual duration + remaining duration** (`_atCompletion`; = planned duration when not
  started). Verified: baseline 10 → actualized today {actual 0, rem 10, AC 10}; data date +7 {actual 7,
  rem 10, AC 17}; planned = baseline 10 (not current-span 20). Parses clean.

## Fix: CPM successors now follow the in-progress forecast finish (2026-07-17) — jasantos2 / eprobles
- **Bug:** an FS successor (e.g. Milestone 2) didn't move to follow its in-progress predecessor's
  forecast finish on Schedule. Cause: `cpmLogic` set a started activity's `_ef = es + scheduled span`,
  ignoring Remaining Duration — so the predecessor's early finish used its original span (later than the
  displayed forecast) and the successor clung to that.
- **Fix (retained logic):** for a started, not-finished activity with a Remaining Duration, `_ef` is now
  `max(es, dataDate) + remaining` (exclusive) — the forecast finish that the grid/Gantt already show —
  so successors reschedule off the forecast. Milestones stay 0-duration. Verified: Activity 2 forecast
  Sep-3 → Milestone 2 schedules to Sep-4 (was stuck at Sep-7). Parses clean.

## Progress-view No. col + centering + per-cell formatting; grid renames + cell format; Gantt header fix (2026-07-16z) — jasantos2 / eprobles
- **Activity Progress view:** added a **No.** column (running activity number; default first). **All
  headers centered**; **Planned Value % / Activity % Complete cells centered** (`.ps-prog-ctr`).
  Renamed columns to **Planned Value %** / **Activity % Complete**.
- **Per-cell manual formatting** (both views): new store `ps_cellfmt` = {pid:{rowId:{col:{b,i,sz,fg,bg}}}}
  + `openCellFmt` popover (Bold / Italic / Size / Text colour / Fill / Clear). Progress cells:
  right-click. Grid cells: right-click → **Format cell…** in the row menu. Applied on render
  (`_cellFmtStyleAttr` inline for Progress; `applyCellFmtGrid` post-paint for the virtualized grid,
  keyed by data-id + data-field).
- **Grid column renames:** `Planned Value POC` → **Planned Value %**, `Physical % Complete` →
  **Activity % Complete** (GRID_COLS).
- **Fix — Gantt date header vanished when the details panel was unchecked:** `syncHeadHeights` set the
  Gantt header to the grid header's measured height, which could read 0 mid-relayout after the toggle.
  Now floored to the natural header height (68px with the column-filter row, else 38px) and re-synced on
  the next frame after `applyLayout`.
- Parses clean; served-file check passed.

## Specific Description → remarks (always saves) + remove Notebook/Files tabs (2026-07-16y) — jasantos2 / eprobles
- **Specific Description now persists reliably** — stored in the existing `remarks` column (a real
  project_schedule column) instead of the un-migrated `specific_description`, so it always saves with no
  "run the pending migration" toast. The Progress-view desc cell + wiring now use `remarks`; the General
  detail "Notes/Remarks" field is relabeled **Specific Description** (same `remarks` field), so the two
  views stay in sync. Deleted the unused `2026-07-16-activity-specific-description.sql` migration.
- **Removed the Notebook and Files detail tabs** (buttons + render cases) — they wrote to un-migrated
  `notebook`/`files` columns and surfaced the tolerant-write migration warning. (`detNotebook`/`detFiles`
  left in as dead code, no longer reachable.)
- Parses clean; no console errors.

## Activity Progress view — resizable rows + columns (bars scale) (2026-07-16x) — jasantos2 / eprobles
- **Column width resize** (Progress view only): drag a header's right edge (`.ps-prog-colres`) → per-column
  width persisted to `ps_progcolw`; table is `table-layout:fixed`. The resizer suppresses the header's
  drag-reorder (`th.draggable=false` during the drag).
- **Row height resize**: drag any row's bottom edge (`.ps-prog-rowres`) → **uniform** row height (`--prog-rh`,
  persisted `ps_progrh`, clamped 22–200). The dual bar tracks are sized `calc((--prog-rh − 16)/2)`, so bars
  **scale with row height**. Default 38px.
- **Scoped to the Progress view** — the Gantt/grid `ROWH` is unchanged (Gantt rows not resizable).
- Parses clean; served-file check confirms colres/rowres/bar-scale present and Gantt ROWH untouched.

## Progress view revisions + Megawide WBS colors (2026-07-16w) — jasantos2 / eprobles
- **Dual progress bars:** the Progress column now shows two bars — **P** (grey = Planned POC) over **A**
  (red = Actual/Physical %), each with its %.
- **Configurable column order:** default **ID · Activity Name · Specific Description · Progress · Planned
  POC · Physical %**; headers are **drag-to-reorder**, persisted to `ps_progcols` (`progColOrder` +
  `PROG_DEF`/`_progCell` render columns from the order array).
- **WBS rows match the grid scheme** in the Progress table (same `--wl` level palette, red left accent).
- **WBS colors → Megawide black/grey/red:** `.ps-wl0…5` re-tinted to a greyscale gradient (main WBS
  darkest → deepest lightest) with **red / dark-red / black** left accents (light + dark), replacing the
  blue tint. Same palette mirrored onto `.ps-prog-table .ps-wl*`.
- Parses clean; served-file feature check passed.

## Physical % gate, WBS Duration roll-up + shades, Activity Progress view (2026-07-16v) — jasantos2 / eprobles
- **Physical % Complete edit gate:** editing `percent_complete` now requires an **Actual Start** (toast
  otherwise) and is forced to **100%** when the activity is complete — enforced in the grid `beginEdit`,
  the Status-tab `wireEditFields`, and the new Progress view.
- **WBS Duration % Complete roll-up:** `_costMap` now accumulates `wdur` (Σ original duration) and
  `wdurE` (Σ origDur × durPct/100); WBS `c-durpct` cell shows `wdurE/wdur` (duration-weighted). Verified
  33% for od 10@50% + od 20@25%.
- **WBS level shading:** `.ps-wl0…5` re-tinted to clearly distinct stepped blue-grays (main WBS darkest
  → deepest sub-WBS lightest) with a per-level left accent bar; matching stepped dark-mode palette.
- **Activity Progress view** (new): toolbar **Progress** toggle (`ps-progressbtn` → `.ps-progress-mode`
  hides the split/network/legend, shows `#ps-progress`). Dateless table — **ID · Activity Name ·
  Progress bar (fill = Physical %, line marker = Planned Value POC) · Physical % (editable, gated) ·
  Planned POC · Specific Description (editable)**. WBS rows show the duration-weighted roll-ups and level
  shade. New `specific_description` text column — migration
  `migrations/2026-07-16-activity-specific-description.sql` (**user must run**); saved tolerantly via
  `_saveActField` so it works pre-migration. `renderProgressView` hooked into `renderAll` when active.
- Parses clean; served-file feature check + roll-up math verified.

## Duration % Complete edit gate: started-only, complete=100% (2026-07-16u) — jasantos2 / eprobles
- **Duration % Complete is only editable once the activity is started** (has an Actual Start) — both the
  grid `dpct` commit and the Status-tab `dpct` handler reject the edit with a toast when `actual_start`
  is missing, and block editing when the activity is complete (it's fixed at 100%). `_durPct` already
  returns 100 for a completed activity (Actual Finish / status Completed). Parses clean.

## Duration % Complete grid column — editable (2026-07-16t) — jasantos2 / eprobles
- Added a **Duration % Complete** column to the activities grid (after Physical % Complete). New
  `['durpct','Duration % Complete','c-durpct']` in GRID_COLS, `--c-durpct` width + `.c-durpct` CSS, cell
  in all three `costCellsHtml` branches (value on tasks; blank on WBS/group, no duration-% roll-up).
- **Editable** (double-click) via a new `dpct` type in the grid `beginEdit` — sets **Remaining Duration**
  = original × (1 − %), leaving Physical % Complete untouched (same behavior as the Status-tab field).
  Verified: 40% on a 20-day original → remaining 12 → reads back 40%. Parses clean.

## Fix: negative lag merged into hyphenated activity ID on drag-to-link (2026-07-16s) — jasantos2 / eprobles
- **Bug:** linking with a negative lag via drag-to-link stored e.g. `2-A1010-15` (id merged, lag 0)
  instead of `2-A1010 FS-15`. Cause: `commitLink` appended the lag with **no separator** when the type
  was FS, and since activity IDs contain hyphens the parser's ID group swallowed the `-15`.
- **Fix:** `commitLink` now emits the type token (`FS`) as a separator whenever there's a type **or** a
  lag — matching `serializeRels`/`addPred` which were already correct. Verified: `2-A1010 FS-15` →
  id `2-A1010`, lag −15. (Existing bad predecessors must be removed + re-added.) Parses clean.

## Negative lag (lead) — confirmed supported + link-chooser hint (2026-07-16r) — jasantos2 / eprobles
- **Negative lag was already honored end-to-end**: all lag inputs (Add modal `#ps-pred-lag`,
  Relationships `#ps-rel-lag`, drag-to-link chooser) are unbounded number fields; `predRels` parses the
  sign; `relCandidateES` FS = `p._ef + lag` (SS/FF/SF likewise), so a negative lag pulls the successor's
  early start before the predecessor's finish (verified: A ef=10, B `FS-3` → es=7, overlap).
- Added the **"negative = lead/overlap"** hint + `title` to the drag-to-link chooser lag input (the
  other two lag inputs already had it). Applied on **Schedule** (CPM reschedule); the data-date floor
  still prevents scheduling an unstarted start before the data date. Parses clean.

## Baseline (planned) milestone marker in the Gantt (2026-07-16q) — jasantos2 / eprobles
- Milestones now show a **baseline/planned diamond** like activity bars show a baseline bar. New
  `.ps-mile-bl` (hollow diamond in the baseline colour) drawn at the milestone's baseline date —
  `bl_finish` for a Finish Milestone, `bl_start` otherwise — when `_gset.baseline` is on. It sits above
  the current (solid) diamond, which drops to `top+15·oY` when a baseline is present (baseline-above/
  current-below, matching the bars). No baseline → current diamond stays centered. Parses clean.

## Milestone types reduced to Start/Finish + point-event logic (2026-07-16p) — jasantos2 / eprobles
- **Removed the generic "Milestone" type** from all dropdowns (Add/Edit modal, General detail, Filter)
  — only **Start Milestone** / **Finish Milestone** remain. Legacy `Milestone` rows still read as
  milestones (isMile keeps it) so old data isn't broken.
- **Point-event logic:** milestones are zero-duration single-date events. `_origDurOf` returns 0 for
  any milestone. New `_dateEditPatch` milestone branch: editing the planned date sets **start_date =
  end_date** (single point); setting an actual date **achieves** the milestone (both actuals = the
  point, Completed/100%/0 remaining); clearing reopens it. Gantt anchors a **Finish Milestone on the
  finish**, a Start Milestone on the start.
- **Imports classify correctly:** XER uses `task_type` (`TT_FinMile` → Finish Milestone, else Start
  Milestone); the Excel importer maps finish-only 0-day rows → Finish Milestone, else Start Milestone.
- Verified: start/finish date edits sync both dates, actualizing completes the milestone, legacy
  Milestone still recognized. Parses clean.

## Start/Finish milestone types + no-predecessor milestone rides the data date (2026-07-16o) — jasantos2 / eprobles
- **Two milestone classifications:** added **Start Milestone** and **Finish Milestone** to the type
  dropdowns (Add/Edit modal `#ps-f-type-sel` + General detail). `isMile` recognizes both; new
  `isFinishMile`. In the Gantt a **Finish Milestone anchors on the finish date** (`e`), a Start
  Milestone / generic Milestone on the start (`s`).
- **No-predecessor milestone follows the data date:** in `shiftUnstartedToDataDate`, an unstarted
  milestone with **no predecessor** (nothing drives its date) now snaps **exactly to the data date**
  in either direction (a "you are here" start/finish anchor). Milestones that DO have a predecessor are
  left alone (they follow the predecessor via CPM). This runs on **Schedule** (with Retained Logic +
  Use-actual-dates on, the defaults), so hitting the data date + Schedule moves the milestone.
- Verified: no-pred milestone at Aug-12 or Sep-05 → snaps to data date Aug-18; with-predecessor
  milestone → not snapped; both new types read as milestones. Parses clean.

## Fix: actualizing a future start collapsed the finish to the start (2026-07-16n) — jasantos2 / eprobles
- **Bug:** actualizing a start that falls AFTER the data date made the finish equal the start. Cause:
  `forecastFin` scheduled remaining work from `today()` (data date), so `data date + remaining − 1`
  landed before the (future) actual start and the `if (f<as) f=as` guard clamped it to the start.
- **Fix:** remaining work is now scheduled from **max(data date, actual start)**, so a future actual
  start forecasts (actual start + remaining − 1) and retains its duration. Verified: actual start
  Sep-3 + remaining 8 (data date Aug-18) → finish Sep-10 (was Sep-3). Parses clean.

## Bar-border color + fix Actualize Start missing from context menu (2026-07-16m) — jasantos2 / eprobles
- **Bar border editing:** added a **Bar border** color to the Colors menu (`--ps-bar-bd`, default
  transparent). `.ps-bar` now has `border: var(--ps-bar-bw,1.5px) solid var(--ps-bar-bd,transparent)`
  with `box-sizing:border-box` (no size change); persists per project, clears on Reset to brand.
- **Fix: Actualize Start was missing** from the right-click menu. When the Start cell was rebound to
  `start_date` (scheduled) until actualized (prompt 16k), the menu's `showStart` still only matched
  `actual_start`, so right-clicking a not-started Start cell hid the Start actions (Finish still showed).
  `showStart` now also matches `start_date`. Parses clean.

## Fix: negative CPM duration corrupted successor scheduling (2026-07-16l) — jasantos2 / eprobles
- **Bug:** a successor (e.g. "Signing of Contract", FS pred = "Contract Final review") scheduled far
  too early. Root cause: `cpmLogic` set `t._dur = (end_date − start_date)/day + 1`, so an activity with
  an inconsistent **end_date before its start_date** got a **negative** `_dur` (−66 in the repro) →
  its early finish landed before its start → the FS successor's early start (= predecessor finish) was
  pulled way back.
- **Fix:** `_dur` is now clamped — milestones = 0, everything else `Math.max(1, span)` (falls back to
  `duration_days`, then 1) — so inconsistent dates can never make it negative. After this, running
  **Schedule** pushes the successor to follow its predecessor correctly.
- Note: successor dates apply on **Schedule** (CPM reschedule, like P6's F9), not automatically on each
  edit. Also fix the source row whose finish precedes its start (edit its Finish/Duration). Parses clean.

## Interactive Start/Finish/Duration + WBS baseline roll-up dates (2026-07-16k) — jasantos2 / eprobles
- **Planned Duration is now the interactive span** = (scheduled finish − effective start + 1);
  `_origDurOf` derives it from `dispStart`/`end_date` (not the forecast, so no loop with Remaining/%).
  Editing the **scheduled Start** keeps the Finish and adjusts the duration; editing the **Finish**
  (not-started) keeps the Start and adjusts the duration; editing the **Duration** keeps the start and
  moves the Finish (`_pdurPatch`). Verified: 10 → edit finish 15 → edit start 13 → edit dur 8 (finish
  moves).
- **Start cell binds to `start_date` (scheduled) until actualized**, then to `actual_start`. So a
  not-yet-actual start is a plain scheduling edit; the right-click **Actualize** converts it to actual
  and **retains the planned duration** (the span is preserved because the finish is unchanged and the
  actual start equals the scheduled start). Verified retained (8 stays 8 after actualize).
- **In-progress Finish edit drives the forecast:** once started, the Finish cell shows the forecast, so
  editing it sets **Remaining Duration** (forecast = data date + remaining − 1) and leaves the planned
  finish intact — Remaining Duration ↔ Duration % Complete remain the linked schedule pair.
- **WBS baseline roll-up dates now display:** the BL Start / BL Finish cells on WBS summary rows were
  blank; they now show the rolled-up baseline span via `wbsBlSpan` (`_blSpanMap`).
- Parses clean; no console errors.

## Fix: relationship lines render backwards on finish-before-start rows (2026-07-16j) — jasantos2 / eprobles
- **Bug:** an activity with a stored `end_date` earlier than its `start_date` (inconsistent/legacy data)
  drew its bar and its dependency arrows **backwards** (finish anchored left of the start). Reported as
  a "relationship lines bug" (e.g. row with Start Sep-14 / Finish Jul-9).
- **Fix:** `dispFin` now clamps the DISPLAYED finish to be ≥ `dispStart` (stored values untouched), so
  bars and relationship arrows can never render backwards regardless of inconsistent stored dates.
  Verified: start Sep-14 / end_date Jul-9 → displayed finish Sep-14 (not backwards). Parses clean.
  (Underlying data still has the reversed pair; editing that activity's Finish/Duration corrects it.)

## Fix: Actualize records the cell's date, not the data date (2026-07-16i) — jasantos2 / eprobles
- **Bug:** Actualize Start/Finish always reverted to the data date. Cause: `actualizeDates` capped the
  date to the data date and routed through `_dateEditPatch`, which rejects dates after the data date.
- **Fix:** it now builds the patch directly from the displayed cell date (`dispStart`/`dispFin`) with no
  capping — records exactly what's in the Start/Finish cell (future dates included). Only guard kept:
  a finish can't precede its start. Verified: future Sep-10 start / Sep-20 finish record as-is (were
  reverting to Aug-14). Parses clean.

## Actualize via right-click context menu (multi-row) (2026-07-16h) — jasantos2 / eprobles
- **Replaced the Actualize Start/Finish buttons with right-click context-menu actions.** Right-clicking
  a grid cell now offers **Actualize Start / Un-actualize Start / Actualize Finish / Un-actualize
  Finish**, and they operate on **all selected activity rows** (Ctrl/Shift-select then right-click).
  Context-aware: right-clicking a Start cell shows only Start actions, a Finish cell only Finish
  actions, any other cell shows both. New `actualizeDates(ids, which, on)` loops the target rows and
  reuses `_dateEditPatch` / `_statusPatch` (Actualize Start → In Progress; Actualize Finish → Completed
  w/ Physical %100 & Remaining 0; Un-actualize clears the actual date). Buttons + `.ps-actualize`
  wiring removed from the detail panel; a one-line hint points to the right-click. Parses clean.

## Editable Duration % Complete + wider Gantt range (2026-07-16g) — jasantos2 / eprobles
- **Duration % Complete is now an editable input** (Status detail), not just a derived readout. Editing
  it back-computes **Remaining Duration = original × (1 − p/100)** — a schedule-side input — and never
  touches Physical % Complete (`_gfDpct` + a `dpct` handler in `wireEditFields`). Verified: 25% on a
  20-day original → remaining 15.
- **Gantt timeline extended + scrollable:** `range()` padding widened from −14/+62 days to **2 years
  before the earliest** activity and **3 years after the latest** (−730 / +1095 days), so the planner
  can scroll into the deep past/future. Verified the bounds (earliest Aug-2026 → Aug-2024; latest
  Jan-2027 → Jan-2030). Parses clean.

## Actualize Start / Finish buttons (2026-07-16f) — jasantos2 / eprobles
- Added **Actualize Start** and **Actualize Finish** buttons in the Status detail's Dates group. They
  convert the scheduled date into a recorded actual: **Actualize Start** sets `actual_start` to the
  scheduled start (capped at the data date) and marks In Progress; **Actualize Finish** sets
  `actual_finish` to the scheduled finish (capped at the data date), defaulting an Actual Start if
  missing, and completes the activity (Physical % = 100, Remaining = 0) via `_statusPatch`. Each button
  disables once that date is already actual. Wired in `wireEditFields`; verified (future scheduled
  dates cap to the data date; finish path completes correctly). Parses clean.

## Physical % Complete vs schedule separation — project-controls policy (2026-07-16e) — jasantos2 / eprobles
- Adopted the professional project-controls rule: **Physical % Complete is the primary, official
  accomplishment measure** (reporting / EVM / dashboards / S-curve / completion) and the **scheduling
  engine is independent of it** — forecast dates come from Actual Start + Remaining Duration (+
  calendars / constraints / relationships).
- **Mapping:** Physical % Complete = `percent_complete` (the field already wired into every consumer)
  — relabeled "Duration POC" → **"Physical % Complete"** in the grid column and the Status detail.
  `ev_poc` stays as the secondary "Earned Value POC". Added a read-only **Duration % Complete**
  (derived = (original − remaining) / original) as a pure schedule metric.
- **Decoupled both directions:**
  - Editing **Physical % Complete no longer modifies Remaining Duration or forecast dates** — removed
    the `_progressFields` call and the "enter Actual Start before %" gate from both the grid `beginEdit`
    and the detail `wireEditFields`; `_progressFields` deleted. Editing the % now just stores the value.
  - Editing **Remaining Duration drives the forecast** (via `forecastFin`) and does **not** change
    Physical %. `_fcFields` no longer uses the % (remaining = original − elapsed, a schedule estimate).
- **Completion is now driven by Status / Actual Finish, not by typing a %.** New `_statusPatch`:
  Completed → records Actual Finish (default data date) + sets **Physical % = 100 and Remaining = 0**;
  In Progress → clears Actual Finish, reseeds Remaining; Not Started → clears actuals + %, restores
  Remaining to the original duration. Recording an **Actual Finish** likewise sets Physical % = 100 /
  Remaining = 0 (in `_dateEditPatch`). The Finish field edits the **actual** finish when the activity
  is complete (past date allowed) and the **scheduled** finish otherwise.
- Verified end-to-end (standalone replica): Physical-%-edit leaves forecast+remaining untouched;
  Remaining-edit moves the forecast with Physical % unchanged (Duration % derives to 80%); complete →
  100 % / 0 remaining / actual finish set; un-complete → In Progress with finish cleared + remaining
  restored. Script parses clean.
- **Note (cross-module):** the S-Curve / Cash-Flow / Portfolio modules read `percent_complete`, which
  is now the Physical % — so they automatically use the official accomplishment measure. No change
  needed there; flagged for awareness.

## Finish edit = scheduled finish (≥ data date); grid/detail Start-Finish now match (2026-07-16d) — jasantos2 / eprobles
- **Finish date validation flipped.** The "Finish" is the scheduled/forecast finish, so it may be
  **later** than the data date (a future finish) but **not earlier** than it (remaining work can't be
  scheduled into the past). The grid Finish cell + detail Finish now edit `end_date` (was
  `actual_finish`, which forced status=Completed and rejected any date after the data date). The
  `end_date` branch of `_dateEditPatch` rejects finish-before-start and finish-before-data-date, sets
  `duration_days` (keep start, move finish), and for an in-progress activity sets `remaining_duration`
  so the forecast finish equals the entered date.
- **Grid ⇄ detail Start/Finish now match.** The detail panel showed the raw (often blank) actual
  fields while the grid showed `dispStart`/`dispFin`. New `_gfDate(label, field, showVal)` renders the
  detail Start/Finish with the same `dispStart`/`dispFin` values and edits the same fields
  (`actual_start` / `end_date`); the read-only General "Dates" Start now uses `dispStart` too.
- Verified: future finish (Nov 30 vs Aug 14 data date) allowed (duration/remaining set, forecast =
  entry); finish before data date and finish before start both rejected; script parses clean.

## Editable Planned Duration + removed "P" date badge (2026-07-16c) — jasantos2 / eprobles
- **Removed the "P" (planned, no-actual) badge** from the Start/Finish grid cells — noise. Now: **A**
  when an actual is entered, **C** for a primary constraint on Start, nothing otherwise.
- **Planned Duration is now editable** in both the activities grid (DUR column, double-click) and the
  Status detail form. New pseudo-field `planned_duration` (type `pdur`) → `_pdurPatch` stores
  `duration_days` and re-spans the current schedule from the start anchor (keeps start, moves finish);
  the baseline is a snapshot and left untouched. `_origDurOf` reverted to prefer an explicit
  `duration_days` (so the edited value is the display source), then BL span, then current span,
  clamped ≥ 0. Wired in `beginEdit` (grid) and `wireEditFields` (detail).
- Verified: the previously −21d activity now reads its BL span (8d); editing Planned Duration to 12
  stores 12 and re-spans Aug 11 → Aug 22 (12d inclusive); script parses clean.

## Removed Planned Start/Finish fields; BL-based planned duration; arrows on current bar (2026-07-16b) — jasantos2 / eprobles
- **Removed the Planned Start / Planned Finish fields** (both the read-only General detail and the
  editable Status form) — redundant with **BL Start / BL Finish**, which is now the plan basis. The
  root cause of the residual negative Planned Duration was an inconsistent start_date/end_date pair
  (planned start later than planned finish) left by an earlier edit; dropping those fields removes
  the source. `start_date`/`end_date` still exist internally (current-schedule bar + CPM) and are set
  via drag/import/actuals, just no longer hand-edited as "planned" dates.
- **Planned Duration is now baseline-based** everywhere (DUR grid column + both detail views) via
  `_origDurOf`, which now prefers the **BL span** (→ duration_days → current span) and is clamped
  **≥ 0** — so it can never show negative again.
- **Relationship arrows now connect to the current-schedule bar.** The connector endpoints were
  anchored to a fixed row-offset (row-top + 16px) using the planned start/end x-span, so they ran
  through the gap between the baseline bar and the current bar. They now use `dispStart`/`dispFin`
  for the x-span and the actual current-bar vertical centre (recomputed with the same
  baseline/no-baseline geometry as `ganttRowHTML`), so each arrow lands on the current bar itself.

## Planned duration decoupled from actuals + retained-logic forecast (2026-07-16) — jasantos2 / eprobles
- **Bug fixed: planned duration went negative** when an Actual Start earlier than the Planned
  Start was entered. Root cause: the forecast finish was being written into `end_date` (which is
  ALSO the planned finish), so an early actual start could push the planned finish before the
  planned start → negative planned duration.
- **Fix — planned start/finish/duration are now fully independent of actuals.** Entering an Actual
  Start or a Duration POC no longer writes `end_date` or `duration_days`; it only stores
  `actual_duration` + `remaining_duration`. `_fcFields`/`_progressFields`/`_dateEditPatch` no longer
  touch the planned dates. Planned Duration everywhere (DUR grid column + detail) = planned finish −
  planned start (inclusive), always ≥ 0.
- **Forecast finish is now DISPLAY-ONLY (retained logic).** New `forecastFin(r)` = data date +
  remaining_duration − 1 (not before the actual start), computed live; `dispFin(r)` = actual finish
  → forecast (if started) → planned finish. Because it reads the data date live, the forecast finish
  **slides forward as the data date moves while the remaining duration (from the Duration POC) is
  retained** — planning-software retained logic on the Duration POC. Shown in the grid/Gantt Finish
  and as a read-only "Forecast Finish" line in the Status detail. (EV POC still excluded from dates.)
- Verified arithmetically: planned Jul10–Jul20 (dur 11) + actual start Jul5 + 40% POC → planned
  duration stays **11** (was going negative), planned finish stays Jul20, forecast finish = **Jul22**
  (data date Jul16 + remaining 7 − 1); module script parses clean.

## Forecast-on-actual-start, POC gate, Duration/EV POC split, dep lines behind bars (2026-07-14) — jasantos2 / eprobles
- **Forecast flow when Actual Start is entered.** Entering an Actual Start on a started (not
  finished) activity now computes **actual duration = data date − actual start**, **remaining =
  origDur × (1−POC)** (or origDur − elapsed when no POC), and a **forecast Finish = data date +
  remaining − 1** written to `end_date` (shown in the Finish field). At-Completion = actual +
  remaining. Shared helper `_fcFields` also drives `_progressFields` so % edits stay consistent.
  Verified: actual-start Jul 10 (10-day, no POC) → remaining 6, forecast finish Jul 19, at-comp 10;
  then Duration POC 60% → remaining 4, forecast finish Jul 17, at-comp 8.
- **POC screening.** Recording a % (Duration POC) now **requires an Actual Start first** (grid + detail)
  — you can't have progress with no start. Blocked with an error toast; `_progressFields` no longer
  auto-fills the actual start.
- **Duration POC vs Earned Value POC.** Renamed the schedule `%` column/field label **"Earned Value
  POC" → "Duration POC"** (drives the schedule). Added a **separate "Earned Value POC (%)"** detail
  field (physical/EV progress, informational — does NOT drive dates), stored in a new tolerant column
  `ev_poc` (migration `migrations/2026-07-14-ev-poc.sql` — **user must run**; safe before it's run via
  `_saveActField`). Export headers keep OPC's "Earned Value POC" name.
- **Relationship lines behind the bars.** The dep-line SVG z-index dropped from 5 → 2 (below the
  bars' z-index 3), so connectors render behind the activity/summary/milestone elements.

## Date-edit intelligence: actual duration, actual-start≤data-date guard, OPC planned duration (2026-07-14) — jasantos2 / eprobles
Central `_dateEditPatch(r,field,val)` now handles every date-cell edit (grid + detail), returning
`{error}` (reject, toast, no save) or `{patch}`:
- **Actual Start can't be later than the Data Date** → error toast, edit reverts.
- **Actual Duration = data date − actual start** (elapsed), or actual finish − actual start once
  finished (`actualDurOf`). Set whenever Actual Start/Finish is edited *and* by `_progressFields`.
- **Actual Finish can't precede Actual Start** → error.
- **Planned duration is now independent (OPC):** editing **Planned Start** keeps the original
  duration and **moves Planned Finish** (no longer recomputes a duration that could go negative when
  start < old start). Editing **Planned Finish** sets duration = finish − start (rejected if before
  start). The **DUR column** shows the stored `duration_days` (clamped ≥0), not a raw span.
- Verified in-browser: future actual-start rejected; actual-start Jul 10 → actual duration 4;
  planned-start Jul 1→Jun 25 keeps 10-day duration (finish → Jul 4); planned-finish before start rejected.

## Fix: progress re-adjust only worked once (pin original duration) (2026-07-14) — jasantos2 / eprobles
Tester: editing Earned Value POC re-adjusted the finish the first time but not on subsequent edits.
Root cause: when an activity has no stored `duration_days` (common for imported rows — the grid just
computes the "5d" from the dates), `_progressFields` derived the original duration from the current
`start…finish` span. The first edit moves the finish, so the *second* edit re-derived "original" off
the already-shortened bar → remaining barely changed → looked frozen. Fix: `_progressFields` now
resolves the original duration as duration_days → baseline span → planned span, and **pins it to
`duration_days`** on the first progress edit, so every later % edit recomputes remaining/finish from
the same base. Verified in-browser: a 10-day (no duration_days) activity edited 40%→60% now pins
duration 10 and recomputes remaining 6→4, finish Jul 19→Jul 17.

## Start/Finish columns show actual (fall back to planned) + detail relabel (2026-07-14) — jasantos2 / eprobles
Tester's model: the grid **Start/Finish** should reflect ACTUAL dates, with planned as the basis.
Chosen behavior (confirmed): *actual when set, else planned; editing writes the actual*.
- New accessors **`dispStart(r)=actual_start||start_date`**, **`dispFin(r)=actual_finish||end_date`**
  used for: grid Start/Finish cell display, the Gantt bar (`s/e`), column sort (`colSortVal`) and
  per-column filter (`_colText`). Grid Start/Finish cells now `data-field="actual_start"/"actual_finish"`
  (editing writes the actual); `beginEdit` prefills those cells with the displayed (fallback) date; a
  cell badge shows **A** (actual entered) or **P** (planned, no actual yet).
- **Gantt drag** operates on the displayed bar and writes to the shown field — actual when the
  activity has one, else planned (planned drag still recomputes duration; actual drag doesn't touch
  planned duration). Cell clipboard `_CELL_META` for those two columns now targets the actual fields.
- **Detail panel relabeled**: Status tab "Actual Start/Finish" → **"Start"/"Finish"** (editable +
  read-only). "Planned Start/Finish" stay as the plan/basis. (The Add/Edit modal still says "Actual
  Start/Finish" + "Planned Start/Finish" — left as the full editor.)
- Export already emitted actual-||-planned for Start/Finish (unchanged). DUR column still reflects
  planned duration. Note: editing an *un-started* activity's Start now creates an actual_start (marks
  it started) — that's the chosen "editing writes actual" behavior; adjust the plan via "Planned Start".

## Progress intelligence — POC-driven remaining/finish + retained-logic data-date shift (2026-07-14) — jasantos2 / eprobles
Two scheduling-logic features, both toggle-gated in the **Schedule dialog → Settings** (default ON).
- **Progress-driven dates (`progressDriven`).** Editing **% Complete (Earned Value POC)** — in the
  grid cell or the Status/General detail tab — now runs `_progressFields(r,pct)`: keeps
  `duration_days` as the original/planned duration and derives **remaining_duration =
  round(origDur × (1 − POC))**, actual_duration, status, actual_start, and an auto **finish =
  data date + remaining − 1** (remaining work scheduled from the data date). 100% → Completed,
  finish = data date, remaining 0; 0% → Not Started, remaining = full duration (dates untouched).
  All fields persist together through `persist()` (undoable + audited; `end_date`/`percent_complete`
  are in `_RECOMPUTE_FIELDS` so CPM/rollups refresh). Unit-checked: 40%→6d rem & finish +5;
  100%→finish at data date; shift keeps span.
- **Retain un-started work at the data date (`ddRetainOn`).** New `shiftUnstartedToDataDate()`:
  on **Schedule → Schedule Now**, any activity with 0% POC / no actual start whose planned start is
  **before** the data date is moved forward to start on the data date, **keeping its duration**
  (finish moves by the same delta). Runs for all tasks regardless of relationships (chunked bulk
  write, audited), *before* the CPM recompute + the existing relationship reschedule, so linked and
  unlinked schedules both self-adjust when the data date advances. (This complements the CPM's
  existing data-date flooring for linked activities.)
- **Verified:** full inline script parses; `_progressFields` + shift math hand-checked in-browser.
  Live click-through pending a session. (Note: with progress-driven ON, % edits move finish dates —
  a real scheduling action; the toggle lets teams that hand-manage dates turn it off.)

## Baseline bars above current + baseline roll-up + equal/full bar heights (2026-07-14) — jasantos2 / eprobles
- **Baseline (BL0) bar now drawn ABOVE the current schedule bar** (was below at +24). Activity bar
  geometry reworked: **with a baseline present**, planned + current are two **equal-height** bars
  (~11px each, density-scaled) stacked baseline-over-current; **without a baseline**, the current bar
  fills nearly the whole row height (`ROWH − 8`). Heights set inline (overriding the fixed
  `.ps-bl`/`.ps-bar` CSS heights). Bar label vertically centered on the current bar.
- **WBS summaries now roll up baseline dates.** New `_blSpanMap` (built in `rebuild()` from
  bl_start/bl_finish up the WBS tree, same walk as `_spanMap`) + `wbsBlSpan()`; the summary branch
  draws a rolled-up baseline bar above the summary bar (WBS grouping; keyed by dotted code). Summary
  bar shifts down to sit below it when a baseline roll-up is present.
- Milestones unchanged (point marker). Note: dep-line anchor Y left as-is (approximate elbow) — bars
  moving down a few px in baseline mode is cosmetically fine.

## Detail-form layout fix + import baseline (2026-07-14) — jasantos2 / eprobles
- **Fixed the cramped/overlapping Status (and General) editable detail form.** The forms wrapped
  their groups in `.ps-det-groups` (auto-fit `minmax(250px,1fr)`) while *each group* also had an
  inner 2-col field grid — at 250px the date inputs overlapped. New **`.ps-edit-groups`** wrapper
  (auto-fit `minmax(360px,1fr)`) gives each group room for its 2-col fields; the "Editing…" hint
  spans full width (`grid-column:1/-1`). detGeneralEdit + detStatusEdit now use it.
- **Import baseline (Excel).** The "set baseline from current schedule" flow already exists
  (Actions ▸ Baselines… ▸ **Capture current as baseline**). Added the requested **alternative**:
  a **Import baseline (Excel)…** button + file input in the Baselines modal → reuses the schedule
  importer's `parseWorkbook`, then `importBaselineFile()` stores the parsed start/finish/dur/
  planned-cost as a `schedule_baselines` snapshot **keyed by Activity ID, without touching the live
  schedule**. Set it primary to apply it to BL0/variance. (XLSX only for now; `.xer` baseline import
  can follow — the main importer's XER path is a different shape.)

## Theme-aware line colors, dark-mode WBS/activity contrast, full-row selection (2026-07-14) — jasantos2 / eprobles
- **Relationship lines + data-date line are now theme-aware** and editable. New CSS vars
  `--ps-dep` (relationship lines/dots/label/arrowhead) and `--ps-dd` (data-date line + label +
  legend swatch) on `#ps-view-schedule`: default **black in light mode, white in dark**. Both were
  hard-red before. Added **Relationship lines** + **Data date line** color pickers to the Colors
  menu (COLORDEFS `dep`/`dd`); a user override applies in both themes (inline var beats the
  theme default), Reset reverts to the black/white default.
- **Dark-mode WBS/sub-WBS shading brightened + stepped** (`--wl` per level was #3a…#21, nearly
  invisible on the #1C bg) → #56…#2a, clearly distinct per depth; added a left-accent bar to WBS
  levels 3–5 in dark (was only 0–2) so sub-WBS depth reads. Activity zebra stripe strengthened in
  dark (`.ps-alt` .03→.06) so activity rows separate.
- **Full-row selection highlight across both panes.** Clicking a WBS or activity now tints the
  **entire grid row** (`.ps-row-sel` full-width bg + red left inset) and draws a matching
  **`.ps-gantt-selband`** spanning that row across the Gantt (behind the bars). Emitted in
  `ganttRowHTML` for full renders and managed imperatively in `highlightRow` so a plain click (no
  Gantt re-render) still shows it; `highlightRow` also now matches WBS rows via `data-wbsid`.

## Arrow routing v2 (gap-routed) + Month default zoom (2026-07-14) — jasantos2 / eprobles
- **Dependency connector no longer runs its horizontal over a bar.** Previous routing kept a single
  vertical just outside the destination and ran the horizontal along the *source row* (a.y) — for
  adjacent FS bars that meant a visible back-track over the predecessor's tail. New **Z-route**: leave
  the source edge with a short stub (`S=9` outside the anchor), drop to the **midpoint Y between the
  two rows**, run the horizontal there (in the inter-row gap, no bars), drop to the destination row,
  then a short stub into its anchor edge. Only the two short end-stubs touch bar rows; the long run is
  always in the gap. Source stub direction follows the anchor (start-anchored SS/SF step left,
  finish-anchored FS/FF step right); destination vertical sits just outside its start (FS/SS) or finish
  (FF/SF). Label/dot repositioned to the new geometry.
- **Default timeline zoom is now Month** (was Quarter): `var zoom='month'` + the `.active` class moved
  to the Month segment button. Users can still switch to Quarter/Year (and saved layouts restore their
  own zoom).

## Colors menu was inaccessible — restored (2026-07-14) — jasantos2 / eprobles
- Tester asked "where is the Colors menu". Root cause: the `.ps-gantt-tools` CSS and
  `renderColorsMenu()` existed, but the **palette button + `#ps-colors-menu` element were missing
  from the Gantt-pane markup** (dropped at some point), so `renderColorsMenu` returned early and there
  was no way to open it. This means the earlier "bar colors already exist" note (below) was wrong —
  the feature was orphaned. **Fix:** added the `.ps-gantt-tools` palette button + `#ps-colors-menu`
  back into `.ps-gantt-pane` (top-right floating gear), declared `colorsMenu`, added it to
  `closeMenus()` + stop-propagation, and wired `#ps-colorsbtn` to `renderColorsMenu()` + toggle
  (same pattern as the other menus). The menu contents (Task bar / Progress fill / Summary / Baseline
  / Milestone pickers + per-WBS overrides + Reset) were already implemented — now reachable again.
  So item #2 (differentiate + modify WBS vs activity bar colors) is genuinely delivered.

## Gantt/print/filter batch (2026-07-14) — jasantos2 / eprobles
From a multi-item tester list; implemented the genuine gaps (several items were already built — see
"already existed" note at the end).
- **WBS bar progress fill (#1).** Summary bars now show a duration-weighted rolled-up %-complete fill
  (`_costMap[code].wearn/wd`) as a `.ps-sum-fill` child clipped to the bracket shape, plus the % on
  the bar label and title. Group headers (non-WBS grouping) don't get a fill.
- **Succeeding months (#3).** `range()` now pads the timeline: ~2 extra trailing months after the last
  activity (`addDays(_max, 62)`) + 14-day lead, so the Gantt shows context beyond the activity span.
- **Critical-path-only filter (#5b).** New **Filter → Schedule → "Critical path only"** (`filters.crit`);
  `rowMatches` excludes non-critical activities (WBS rows pass so ancestors are kept). This *excludes*
  the others, unlike the Critical Path toolbar toggle which only dims them.
- **Project title on print (#4).** The Print button injects a `#ps-print-head` banner (project name +
  data date + print date) shown only in `@media print`, at the top of the printed schedule.
- **Already existed (confirmed, no change needed):** progress override (#6 — Schedule dialog Settings:
  Retained Logic / Progress Override); differentiated + editable WBS vs activity bar colors (#2 — the
  Colors menu sets Task bar / Summary / Milestone separately); constraints + actual-date/data-date
  logic (#8 — primary/secondary constraints, constraint-aware CPM, use-actual-dates); a P6-style
  Advanced filter builder (#5a — `filters.adv`, Match All/Any rules).
- **Deferred / needs scoping:** #5a "time-based" filter condition (the Advanced builder exists — needs
  a date/duration operator added); #7 extra complete/activity types (Start Milestone, Finish Milestone,
  Resource Dependent) — needs decisions on how each renders/behaves (milestone side + duration-type).

## Quick-add default dates (2026-07-14) — jasantos2 / eprobles
- **New activities now default to start on the data date with a 5-day duration.** `quickAddActivity`
  stamps `start_date = today()` (the data date, `dataDate || wallToday()`), `end_date = today()+4`
  (5 inclusive days), and `duration_days = 5` on the insert payload (was blank/no dates). So a
  freshly-added activity shows a real bar on the Gantt immediately and can be nudged from there.

## Visible Schedule button + dependency-arrow routing fix (2026-07-14) — jasantos2 / eprobles
- **Schedule button is now a visible red primary button** (`pd-btn pd-btn-primary`, calculator icon +
  "Schedule" text) matching the "+ Add activity" button, instead of an icon-only `.ps-icobtn` whose
  label only showed in Labels mode. Same `#ps-schedbtn` id/handler (`openSchedule`).
- **Dependency arrows no longer run across the linked bar.** The elbow used to turn at
  `predecessorFinish + 8`, which for adjacent FS bars sat on top of the successor bar (per the
  tester's screenshot). Now the vertical turns just **outside the destination bar's anchor edge** —
  `toX − 10` (left of its start for FS/SS) or `toX + 10` (right of its finish for FF/SF) — so the
  connector leaves the source edge, runs along the source row to the turn, drops to the successor
  row, and enters with a short 10px stub, never crossing the linked bar. Origin dot + type/lag label
  repositioned to the new turn X.

## Wrapping column headers (2026-07-14) — jasantos2 / eprobles
- **Grid column headers now wrap** instead of truncating with an ellipsis, so long labels stay
  readable when a column is narrow / being resized. Header cells (`.ps-grid-row.head .ps-cell`) get
  `white-space:normal; overflow-wrap/word-break:break-word; text-overflow:clip`; data cells keep
  `nowrap`/ellipsis (verified in-browser: header WS=`normal`, data WS=`nowrap`).
- **Header row grows to fit the wrapped lines** (`.ps-grid-row.head` → `min-height:38px; height:auto`)
  and a new **`syncHeadHeights()`** sets the Gantt header's height (border-box) equal to the grid
  header's measured height, so the first data row stays aligned across the two panes. Called from
  `renderHeader()`, the end of `doRender()`, and live during `startColResize` (mou…move + up). This
  also makes the two heads exactly equal by measurement (previously both relied on matching fixed CSS
  heights, incl. the `.ps-colf-on` 68px filter-row case, which the inline sync now supersedes).

## Column chooser scroll + Schedule reschedules by default (2026-07-14) — jasantos2 / eprobles
- **Column chooser (grid-header "+" / `#ps-cols-menu`) now scrolls.** Root cause: `.ps-menu`
  (line ~550) sets `overflow:hidden` and, being *later* in source than `.ps-cols-menu` (line ~158,
  `overflow:auto`) at equal specificity, won the cascade — so the menu clipped at its `max-height:340px`
  with no scrollbar (visible in the tester's screenshot, cut off at "Planned Value"). Added
  `.ps-cols-menu { overflow-y:auto }` *after* `.ps-menu` so the chooser scrolls again.
- **Schedule now reschedules dependent activities by default.** The CPM (`cpmLogic`) already honors
  **multiple predecessors** per activity (each successor's early start = **max** candidate across all
  its `_relObjs`, topological pass), and `applyScheduleDates()` writes those dates back — but it only
  ran when the Schedule dialog's "Reschedule dependent activities" box was ticked, which defaulted
  **off**. Changed `reschedOn` to default **on** (respects an explicit user off-setting), so hitting
  **Schedule → Schedule Now** moves successors' Start/Finish along their FS/SS/FF/SF + lag links
  (completed activities keep actuals; started ones keep their Start). Still confirms before the bulk
  write. No relationships → it warns instead of moving.

## WBS click-to-select, WBS-scoped Activity ID, scrollable menus (2026-07-14) — jasantos2 / eprobles
Follow-ups from tester feedback. No migration, no schema change.
- **Clicking a WBS row now SELECTS it** (instead of toggling collapse every time). Expand/collapse is
  now **only** via the ▼/► chevron. Real WBS summary rows carry `data-wbsid` + get `ps-row-sel`, and
  the `.ps-wbs-row` click handler selects the node (sets `selId`/`_wbsSel`, re-renders) so it becomes
  the Add-activity target; synthetic **group** headers keep click-to-collapse. Chevron clicks are
  guarded (`closest('[data-toggle]')`) so they never fall through to selection.
- **Activity ID is now WBS-scoped** as **`<wbs>-A<num>`**: `nextActivityId(wbs)` uses the prefix
  `"<wbs>-A"` and numbers in increments of 10 from **1000** (e.g. WBS 1.1 → `1.1-A1000`, then
  `1.1-A1010`, …), continuing from the highest number already used under that exact WBS prefix and
  skipping collisions. No WBS → plain `A<num>`. `quickAddActivity` passes the target `wbs`.
  (Unit-checked in-browser: fresh 1.1→`1.1-A1000`; with A1000/A1010→`1.1-A1020`; per-WBS isolated;
  no-WBS continues the `A` series.)
- **Popup menus scroll instead of clipping.** `.ps-menu` had `overflow:hidden` + no height cap, so a
  tall **row context menu** (Add activity / Edit / clipboard / WBS / Delete) ran off-screen with no
  scroll. Added `.ps-rowctx, .ps-colhdr-menu { max-height:82vh; overflow-y:auto }` and, in
  `openRowMenu`, an explicit `max-height = viewportHeight − top − 10px` so the menu always fits the
  space below its anchor and scrolls when taller.

## Auto Activity ID + editable Status & Relationships tabs (2026-07-14) — jasantos2 / eprobles
Follow-up to the interactive-Add work below. No migration, no schema change.
- **Auto-generated Activity ID on quick-add.** `quickAddActivity` now stamps `activity_id =
  nextActivityId()` instead of leaving it blank. `nextActivityId()` takes the max existing numeric
  Activity ID in the project, rounds **up to the next multiple of 10** (P6/OPC-style — `…1010`→`1020`,
  `1013`→`1020`), and keeps whatever prefix the highest ID uses (e.g. `A1020`→`A1030`). Starts at
  `1010` when the project has no numeric IDs; skips collisions. (Logic unit-checked in-browser:
  empty→1010, `A1010/A1020/A1005`→`A1030`, `A1013`→`A1020`, collision→next free.)
- **Editable Status tab.** `renderDetails` status branch now renders `detStatusEdit(r)` + the shared
  `wireEditFields` (same live-editor pattern as General): Status, % Complete, Expected Finish, all
  Planned/Actual/Baseline dates, Actual/Remaining Duration, Free Float, Planned/Actual/Remaining Labor
  Units, and Primary/Secondary Constraints (+dates) are editable and persist on change. Computed
  fields (Planned/At-Completion Duration, Total Float, Critical, Finish Variance) stay read-only via
  the new `_gro()` helper. Added a `num` field type (non-negative, unbounded) to `_gf`/`wireEditFields`
  for durations/labor units (the existing `number` type stays 0–100, used for % Complete).
- **Editable Relationships tab.** `detRelsEdit(r)` + `wireRels` replace the read-only tables:
  predecessors get a **× remove** per row and an **add row** (activity datalist + FS/SS/FF/SF type +
  lag), mirroring the modal's predecessor picker. Edits reserialize to the predecessor token text via
  `serializeRels()` (verified to match the CPM `predRels` format — `1010 SS+3`, `1010 FS-2`) and go
  through `persist()` (undoable + audited + CPM rebuild). **Successors stay read-only** (derived as the
  inverse of other activities' predecessors).
- Resource Assignments / Steps / Expenses / Notebook / Files were already editable (CRUD) — unchanged.
- **Verification:** full inline script parses clean (module page loads, zero console errors);
  `nextActivityId`/`serializeRels` logic unit-checked in-browser. **Live click-through still pending a
  real login** (needs an approved session + a project with data).

## Interactive Add-activity + editable General tab (2026-07-14) — jasantos2 / eprobles
Requested: make "Add activity" contextual — select a WBS or activity first, then Add places the new
activity under that respective WBS and lets you edit its details in the panel below (no migration,
no schema change).
- **Contextual Add.** The toolbar **Add activity** button (`#ps-add`) and the right-click **"Add
  activity below"** now call the new **`quickAddActivity(sel)`** instead of always opening the modal.
  Placement is uniform: `wbs = sel.wbs`, `wbs_node_id = sel.wbs_node_id` — a selected **WBS summary**
  gets a child activity under it; a selected **activity** gets a sibling in the same WBS. It inserts a
  blank `Task` ("New Activity", Not Started, 0%) via the same insert + `pushUndo({type:'insert'})` +
  `logAudit` path as the modal `save()`, appends to `rows` locally (no full `load()` refetch),
  `rebuild()`s, un-collapses the new row's WBS ancestry, selects it, and scrolls it into view
  (deferred one rAF since `DL` is rebuilt inside the render frame). `wbs_node_id` is written
  separately + tolerantly (column-missing safe), like `save()`. **No selection → falls back to the
  full modal** (with a hint toast), so the modal path is unchanged and still reachable.
- **Editable General detail tab.** `renderDetails()`'s General tab now renders **`detGeneralEdit(r)`**
  + `wireGeneral()` (the old read-only `detGeneral` is kept, now unused). Core fields are live inputs —
  Activity ID, Name, Work Package, Type, Duration Type, % Complete Type, Status, % Complete,
  Responsible, Owner, Planned Start/Finish, Predecessors, Remarks (WBS shown read-only, since it's set
  by the parent). Each control persists **on `change`** through the existing `persist()` (so edits are
  undoable + audited + trigger the rebuild/CPM), then `renderGrid()`/`renderGantt()` refresh; Start/
  Finish recompute `duration_days` exactly like the inline grid editor. Activity Codes / UDFs stay
  read-only here (managed via the modal / their own editors).
- **New module-scope hook `_openDetail(tab)`** — assigned in init (where `setDetCollapsed`/
  `setDetailTab` are in scope) so `quickAddActivity` can expand a collapsed panel and jump to General.
- **Verification:** the full inline script parses clean (page loads at `/modules/project-schedule/`
  with zero console errors, then redirects via `AppAuth.requireLogin`). **Live click-through against a
  real login is still pending** (needs an approved session + a project with a WBS — same constraint as
  prior batches). Manual test: select a WBS/activity → Add activity → confirm a "New Activity" row
  appears under that WBS, is selected, and the General tab below is editable and persists.

## UX improvements batch 2 (2026-07-13) — shortcuts help, density, pinned data-date, dark-mode audit
The remaining four build-improvement asks (3, 4, 6, 7); no migration, no schema change.
- **3. Keyboard-shortcut help.** New **"?"** button in the toolbar (next to Labels) + the **?** key
  open `openShortcuts()` — a modal listing the previously-invisible grid shortcuts (Insert / Delete /
  Ctrl+C·X·V / Ctrl+D fill-down / Ctrl+Z·Y / Esc) plus mouse gestures (shift-click cell range,
  ctrl-click row, drag bar/edge, Ctrl+scroll zoom, drag-to-reorder). Also **wired Ctrl+D** into the
  grid keydown handler (was right-click-menu only): fills the active cell's field down to the selected
  rows via the existing `fillDown`. `.ps-kbd`/`.ps-sc-*` styles.
- **6. Row-density toggle (comfortable/compact).** `ROWH` is now driven by `_density`
  (`localStorage.ps_density`; 34px comfortable / 27px compact). A **Row density** section in the
  **Layout ▾** menu (`applyDensity`) reassigns ROWH + toggles `.ps-compact` on `.ps-split` and
  re-renders. Grid rows tighten via CSS (`.ps-split.ps-compact .ps-grid-row:not(.head):not(.ps-filter-row)`);
  Gantt bar offsets were refactored to scale with row height (`oY = ROWH/34`, so comfortable is
  byte-identical) — summary/baseline/milestone/bar tops + the dependency-line anchor Y all derive
  from it, keeping the two panes aligned at either density.
- **7. Pinned data-date label.** The Gantt data-date label (`#ps-datedate-lbl`) is now a readable
  pill (card bg + red border) and `renderWindow` sets its `top` to the current vertical scrollTop on
  every scroll, so it stays at the top of the Gantt viewport instead of scrolling out of view.
- **4. Dark-mode consistency audit.** Swept the named suspects — chart/SVG `<text>` labels, the
  `.ps-mini` tables, `.ps-trace-node`/trace logic, `.ps-net-node`/PERT text, dependency labels, the
  bar-colour vars + legend swatches. All already resolve through `var(--pd-*)` / the
  `#ps-view-schedule`-scoped `--ps-*` bar vars with a `html.pd-dark` override (the fix the original
  legend bug landed). No remaining mismatches found; the new elements added this session (WBS shading,
  import card, shortcuts panel, data-date pill) all include dark-mode-safe vars.
- Verified: full inline script parses clean (`new Function`, 537k chars). Live click-through still
  pending (needs a session + data), same as batch 1.

## UX improvements batch (2026-07-13) — toolbar labels, WBS shading, import feedback
Three of the seven build-improvement asks (1, 2, 5); no migration, no schema change.
- **1. Toolbar discoverability — labeled-mode toggle.** The secondary view cluster
  (Outline/Layouts/Schedule/Layout/Analyze) was icon-only + tooltips. Added a **"Labels"** toggle
  button (`#ps-tb-labeltoggle`, eye icon, far right of the toolbar before the search box) that adds a
  `.ps-tb-labeled` class to `.ps-toolbar`; CSS reveals each icon button's word via
  `.ps-icobtn[data-label]::after { content:attr(data-label) }` (the five buttons carry `data-label`
  = Outline/Layouts/Schedule/Layout/Analyze). Persisted in `localStorage.ps_tb_labels`; toggle shows
  an active red state. Pure CSS reveal — no change to the button render paths or their handlers.
- **2. WBS level visual hierarchy — depth shading.** WBS summary rows previously all shared
  `var(--pd-bg)`. `gridRowHTML`'s WBS branch now adds `ps-wl{min(depth,5)}`; CSS tints the row + its
  frozen c-num/c-id/c-name cells via a `--wl` custom prop (shallower = darker), light + dark variants,
  plus a left accent (inset box-shadow, no layout reflow) on the name cell for the top 3 levels
  (red / red-mid / muted). Group rows keep their red-light background (untouched — separate branch).
- **5. Import feedback — progress bar + "what came in" card.** The loading overlay gained a
  determinate progress bar (`#ps-load-bar`/`#ps-load-fill`); `setProgress(frac)` (null = hide) is
  driven by the chunked-insert loops in both `doImport` (Excel) and `doImportXER` (P6). After a
  successful import, `showImportSummary({title,file,tiles,warnings,note})` shows a modal card of
  counts (Excel: Activities / WBS nodes / With predecessors; XER also Calendars / Resources /
  Assignments / UDFs) plus warnings (e.g. activities missing start/finish) — replacing the old bare
  success toast. `fname` is now threaded into both `doImport`/`doImportXER`.
- Verified: full inline script block parses clean (`new Function`, 532k chars). Not yet clicked
  through on a live login (needs a session + an import file).

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from scratch (Primavera Cloud reference, not a module copy)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] Run DB migration (see below)
- [ ] PR opened into `main`

## Schema additions (2026-06-30)

Run `../../migrations/2026-06-30-project-schedule-columns.sql` in the Supabase
SQL editor before testing. Adds:

| Column | Type | Default |
|---|---|---|
| `actual_start` | date | — |
| `actual_finish` | date | — |
| `activity_type` | text | `'Task'` |
| `status` | text | `'Not Started'` |
| `responsible_party` | text | — |

## Schema additions (2026-07-01) — OPC Activity Details fields
Run `../../migrations/2026-07-01-project-schedule-opc-fields.sql`. Adds:
`owner, work_package, calendar, duration_type, percent_complete_type,
program_milestone(bool), expected_finish, actual_duration, remaining_duration,
free_float, planned_labor_units, actual_labor_units, remaining_labor_units,
primary_constraint, primary_constraint_date, secondary_constraint,
secondary_constraint_date`. All editable in the Add/Edit modal and shown in the
General/Status detail tabs (At-Completion Duration/Labor are computed).

## Schema additions (2026-07-02) — Baseline cost
Run `../../migrations/2026-07-02-baseline-cost-column.sql`. Adds `bl_cost` (baseline
planned cost, matches OPC's "BL Planned IBB"), seeded from the current Planned Cost.
Editable in the modal; shown in the Cost Loading table.

## Import (2026-07-06) — P6 .xer support
The Import button ("Import Excel/XER (OPC / P6)") now also accepts Oracle Primavera P6
`.xer` exports (auto-detected by extension, read as Windows-1252 text). `parseXER` tokenizes
the `%T`/`%F`/`%R` tab-delimited tables and imports:
- **CALENDAR** → the new `calendars` table (a hand-rolled recursive-descent parser reads P6's
  proprietary `clndr_data` grammar for the Mon–Sun working-day pattern + non-working
  Exceptions/holidays; exceptions that carry a shift-time override are treated as special
  working days, not holidays, and skipped).
- **PROJWBS** → WBS rows, using the *real* `parent_wbs_id` tree (not an outline-level guess
  like the Excel path) to generate dotted codes.
- **TASK** → activities (task_type TT_Mile/TT_FinMile → Milestone), linked to their imported
  calendar via `calendar_id`.
- **TASKPRED** → resolved into the same `predecessors` text format the CPM engine already
  parses (`predRels`) — `"<code> <FS|SS|FF|SF>+<lagDays>"`, lag hours rounded to whole days.
- **RSRC** / **TASKRSRC** → `resources` + `resource_assignments` (added alongside anything
  already in Resource & Role Master, not replacing it).
Verified against a real 26MB/97,906-line cost-loaded P6 export (~600ms parse): exact row-count
matches (14,495 WBS + 27,811 activities, 2 calendars, 2 resources, 27,744 assignments), 100%
predecessor resolution (27,796/27,796), 0 activities missing dates, correct milestone typing,
and a spot-checked activity's dates/calendar/predecessor all matched the source file exactly.
(Not yet run end-to-end against a live Supabase project — the parsing/mapping logic is
verified, but nobody has clicked Import on a real login yet.)

## Perf hardening (2026-07-07) — topological CPM + compute dedup
The scheduling engine is the hot path on large imports (27k+ activities). Two changes, no behaviour
change (verified 0 mismatches vs the old algorithm across 2,000 random DAGs):
- **`cpmLogic` forward/backward passes rewritten from fixed-point relaxation to a single
  topological-order pass (Kahn).** The old `while (chg && guard++ < tasks.length+5) { tasks.forEach }`
  was **O(n²)** on a long dependency chain — a 27k chain = ~730M iterations, which froze the tab.
  Now each pass is O(n + edges): build `_indeg` (= `_relObjs.length`; each node gets exactly that
  many decrements via predecessors' `_out`, so duplicate edges are safe), Kahn queue → `order`,
  forward pass over `order` (preds precede), backward pass over reverse `order` (succs precede).
  Cycles (bad data) leave nodes un-queued → appended so none is dropped. Measured: 27k-chain **19ms**.
- **CPM compute dedup**: `_cpmDirty` flag + `ensureCPM()` (recompute only if dirty). `rebuild()` sets
  dirty then computes (clears it); read/render paths that used to each call `computeCPM()` fresh —
  `renderPlanner`, `_snapSummary`, `exportLookahead`, `computeHealth`, `repCritical`, and the
  redundant post-`rebuild()` calls in `saveBulkUpdate`/`applyScheduleDates` — now call `ensureCPM()`
  (no-op right after a rebuild). Data-changing/option-changing paths (`scheduleNow`, link creation,
  `recomputeCPM`, crit-toggle) still force `computeCPM()`.
- Data fetch was already paged (`load()` fetches all `.range()` pages in parallel) and the Gantt/grid
  already window rows — those were not regressed.
- **Incremental `rebuild(structural)`**: `rebuild()` ran on every single-cell edit / drag / bulk save
  and re-did a full O(n log n) WBS sort (~129ms at 27k rows in node, worse in-browser via
  `localeCompare`). Now `structural` (default true) gates the sort; pure field edits that can't change
  ordering pass `false` and **reuse the existing `_sorted`** (which holds live row references, so
  edits still show). Callers passing `false`: `persist` when the patch has no `wbs`/`activity_id`
  (`rebuild(!!(patch && ('wbs' in patch || 'activity_id' in patch)))`), `saveBulkUpdate`,
  `applyScheduleDates`. Add/delete/import/column-sort/grouping/WBS-or-ID edits stay structural.
  A `_sorted.length !== rows.length` guard force-sorts if the row count changed anyway. WBS-derived
  `_segs/_depth/_anc` are also cached per row (`_segsWbs`) and recomputed only when `wbs` changes.
  The rollups (`_spanMap`/`_costMap`/`_min`/`_max`) + CPM still refresh every rebuild (needed after
  date/cost edits); only the sort + segs recompute are skipped.
- **Cosmetic-edit skip (in `persist`)**: a patch is classified against `_RECOMPUTE_FIELDS` (the fields
  feeding the sort / WBS roll-ups / CPM). If it touches **none** of them — a purely cosmetic edit
  (status, responsible_party, remarks, owner, PO fields, …) — `persist` **skips `rebuild()` entirely**;
  `_sorted`/`_spanMap`/`_costMap`/`_critical`/`_float` are all unchanged and still valid, and the
  renderers read the live row, so the value shows with zero recompute. WBS/Activity-ID/Type edits set
  `structural` (re-sort); any roll-up/CPM field triggers a `rebuild(structural)`. **Guard:** when the
  OPC column-sort (`colSort`) is active, leaf-sibling order can depend on the edited field, so an edit
  then forces a structural rebuild regardless. (Grouped views regroup from live rows in `buildNodes`
  every render, so they need no special handling.) Note: date/%/cost edits still pay the roll-up + CPM
  recompute — true incremental roll-ups were deliberately NOT added: CPM (~19ms, topological) is the
  floor and must recompute on any date/predecessor change, and `_spanMap`'s min/max isn't safely
  reversible, so the risk/reward was poor. Server-side WBS lazy-loading was also rejected — the grid
  is already windowed (`renderWindow`, cached `DL`, scroll never rebuilds) and client-side
  CPM/critical-path/roll-ups require the full dataset in memory.

## OPC clipboard extras (2026-07-11) — cell-level Cut/Copy/Paste
Follows the existing row clipboard (whole-activity Copy/Cut/Paste). Adds an Excel/OPC-style **cell**
clipboard operating on individual grid cells, independent of the row selection/clipboard.
- **Cell-range selection** (`_cellSel` = a rectangle in DL-row × grid-column index space; `_cellAnchor`
  = shift-extend anchor). A plain grid click sets the active cell (still selects the row for the
  details panel); **Shift-click extends a rectangular block**. Wired via `_setCellFromClick(rw,e)` in
  both the row click and contextmenu handlers (computes the column index from the clicked `.ps-cell`'s
  DOM position minus the `#` gutter — the DOM stays in data order, so this equals the `gridCols()`
  index). Painted by `highlightCells()` (called from `highlightRow()`, so it survives virtualization
  scroll/re-render): `.ps-cell-sel` tinted block, `.ps-cell-active` solid box, `.ps-cell-cut` dashed box.
- **`_CELL_META`** = per-column (GRID_COLS order, built-ins only) `{f, edit, t}`. Editable: Activity ID/
  Name, BL Start/Finish, Start, Finish, % Complete, Planned/Actual/EV/BL IBB. Computed columns (POC,
  At-Completion, Dur, Float, Var, Status, % Complete Type) are **copy-only** (paste skips them, counted
  in the toast). Extra code/UDF columns are out of scope (jsonb).
- **`copyCells(mode)`** packs the rectangle into `_cellClip` `{h,w,cells,cut,refs,tsv}` — each cell keeps
  its raw `val` (editable source, for a clean round-trip) plus display `text`; also writes a **TSV to the
  system clipboard** (`navigator.clipboard.writeText`, best-effort) so cells can be pasted into Excel.
  Clears `_clip` (row clipboard) so Ctrl+V stays unambiguous; `copyRows` reciprocally clears `_cellClip`.
- **`pasteCells()`** (async): single copied cell **fills** the whole target rectangle; a block **pastes
  once** from the top-left. Values coerce to the *target* column's type (`_coerceCell`: number clamps
  0–100, money ≥0 strips currency/commas, date via `_isoFromAny`). Writes are grouped per row and go
  through **`persist()`** (undoable + audited + triggers rebuild/CPM); **duration recomputes** when
  Start/Finish are pasted. A **cut** clears its source cells after paste (except any that were themselves
  paste targets). Falls back to reading the **system clipboard** (Excel paste) when nothing was copied
  in-grid. Non-editable targets are skipped and reported.
- **Keyboard:** Ctrl+C/X/V act on the cell selection when one exists (Excel-style), else fall back to the
  row clipboard; paste prefers whichever clipboard was filled last. **Esc** clears both selections. The
  right-click menu shows a **Copy/Cut/Paste cell(s)** section (Ctrl+C/X/V) above the relabeled **Copy/Cut
  row(s)** / **Paste N rows here** items.
- Verified: the 467k inline module block parses clean; a node harness hand-checked `_coerceCell`/
  `_isoFromAny` (150→100, "50%"→50, "₱1,250.5"→1250.5, iso+human dates→ISO, empty→null) and the
  block-vs-fill paste index mapping (2×2 block expands from a single target cell; a 1-cell clip fills a
  3×2 target). Page loads with no console errors. **Not yet exercised end-to-end against a live login**
  (same constraint as prior batches — needs a real session + data to click through).

## Details panel collapse/expand chevron (2026-07-11)
OPC-style inline toggle (`#ps-det-collapse`) at the right of the detail-tab strip: collapses/expands the
panel BODY while keeping the tab strip visible (so it can be reopened). Chevron rotates 180° when
collapsed (`.up`; only `chevronDown` exists in icons.js). Hides `#ps-details-body` + the resize grip;
state persisted (`ps_details_collapsed`). Clicking any tab while collapsed auto-expands. Independent of
the Layout-menu "hide whole panel" toggle. Verified live on Avesta (collapse→body/grip display:none +
chevron up; expand→restored).

## Trace Logic multi-level · auto-adopt on import · sidebar→back button (2026-07-11)
- **Trace Logic (multi-level):** `detTrace` now walks predecessor/successor chains N levels deep
  (`_traceWalk` = BFS with a `seen` set for dedup + cycle safety), rendering one column per level
  (deepest predecessors far-left). Persisted **Predecessor/Successor Levels** number inputs
  (`ps_trace_levels`, default 3, up to 99); `.ps-trace` scrolls both ways as it grows. Verified live on
  Avesta: A1005 now shows L1 A1100 Concept Design + **L2 A1149 Release of NTP** (matching OPC; the old
  single-level view only showed the immediate predecessor).
- **Auto-adopt WBS on import:** `wbsAdopt` rewritten to insert a whole **depth level at a time**
  (chunked, `.insert(batch).select()` → map code→id), instead of one node per await (which stalled on
  big P6 imports). Resumes cleanly from a partial adoption (seeds `nodeByCode`/`sibCount` from existing
  `WBS_NODES`). `silent` param skips confirm/toasts. `doImport`/`doImportXER` now `await load()` then
  `autoAdoptAfterImport()` (tolerant — never blocks the import). The manual WBS-Manager Adopt uses the
  same fast path now.
- **Sidebar removed:** the left `.pd-sidebar` (which duplicated the title dropdown's view switcher) is
  gone; a `.ps-modback` back-to-modules button (→ `../../dashboard.html`) sits where the hamburger was.
  `UI.initShell()` no-ops without a sidebar (harmless). Verified live: sidebar absent, back button
  present + correct href, content full-width, grid loads, title dropdown still switches views.

## Drag-and-drop row reorder within a WBS (2026-07-11)
**Migration `../../migrations/2026-07-11-activity-seq-order.sql` (RUN):** adds `project_schedule.seq_order`.
- **Sort:** in `rebuild()`, leaf siblings (same WBS parent) order by `seq_order` (unset = last → falls
  back to Activity-ID order = pre-feature behaviour), before the Activity-ID tiebreaker. colSort still
  takes precedence when active (its sibling branch runs first).
- **DnD:** task rows get `draggable=true` only when `_reorderEnabled()` (WBS grouping + no colSort +
  not view-only). Drag listeners rebind each `renderWindow` (rows are windowed). A red insertion line
  (`.ps-drop-above/.ps-drop-below`) marks the drop position; drop only lands within the SAME WBS parent.
  `reorderWithinWbs(draggedId,targetId,before)` renumbers that WBS's leaf siblings 0,1,2,… (from the
  current `_sorted` order) and persists changed `seq_order`s via parallel updates, then rebuild/render.
  Gantt auto-syncs (same `_sorted`/DL). Not undo-integrated (reversible by dragging back).
- **Extended to sibling WBS nodes (2026-07-11):** first cut only reordered activities SHARING a WBS —
  but P6 imports (e.g. Avesta) put one activity per WBS leaf (M6001 = WBS 1.1.1.5), so there were no
  same-WBS siblings and drag did nothing ("no red line"). Now the sort honors a **node-level**
  `seq_order` via `_seqByCode` (built from each WBS code's representative row — summary preferred, else
  a lone leaf activity), and a drop between two different WBS leaves under the **same parent** reorders
  those NODES by writing `seq_order` on their representative rows. **No code renumbering, no wbs_nodes
  dependency, update-only.** `dragover` allows any drop where the two rows share a WBS parent
  (`parentCodeOf`); `reorderDrop` dispatches to `reorderWithinWbs` (same wbs) or `reorderWbsSiblings`.
- **Undo/redo (2026-07-11):** both reorder paths record `pushUndo({type:'reorder', changes:[{id,before,after}]})`
  capturing each affected row's old→new `seq_order`; new `reorder` branch in `undo()`/`redo()` calls
  `_reorderApply(changes,'before'|'after')` (seq-only writes + `rebuild(true)`+render, no refetch). So
  Ctrl+Z/Ctrl+Y and the toolbar undo/redo revert/replay a drag reorder.
- **Verified LIVE on Avesta (2026-07-11):** node-level comparator unit-tested; then on the real
  4,393-row project, setting `seq_order` on the 7 "Topping Off" milestones (each its own WBS leaf,
  1.1.1.1–1.1.1.7) reversed their grid order exactly (M7001…M3001) — the exact path a drop triggers —
  then reverted. Confirms sort + reorder end-to-end. (The literal mouse drag-drop gesture still wants a
  human confirm; draggable rows + the same-parent drop rule are in place.)
- **Known limitation:** if a WBS node has MULTIPLE activities AND is itself reordered as a sibling, the
  node's `seq_order` (taken from one activity) can overlap with that activity's leaf-order meaning.
  Neither Avesta nor typical data hits this; documented for later.

## P6 .xer import RUN LIVE (2026-07-11) — import verified, load-timeout bug found
The P6 importer had never run end-to-end against live Supabase (parser-only verified). Imported a real
`.xer` into scratch project **XERTEST**: **42,306 activities, 14,495 WBS summaries, 27,796 predecessors
resolved, 11 milestones, 4 calendars, 5 resources, 55,489 assignments** — counts match the offline
parser verification exactly. **Import writes correctly at scale.**
- **BUG FOUND (new task):** opening a 42k-row project fails with *"canceling statement due to statement
  timeout."* `load()` fetches ~43 pages via `.range()` **OFFSET** pagination in parallel; far pages
  (offset ~41k) re-scan tens of thousands of rows each → exceeds Supabase's statement_timeout. 4.4k-row
  projects (Avesta) load fine; the threshold is a few thousand rows. **Fix planned:** keyset pagination
  (`order=id.asc&id=gt.<last>&limit=N`) so every page is an indexed range scan. Hot path — verify on a
  small project + XERTEST before shipping. (A single ordered 1000-row page measured 1.4s.)
- **FIXED + verified live (`1aaecfb`):** `load()` now uses keyset pagination (`order=id.asc & id>last,
  limit 1000`) instead of `.range()`/OFFSET — each page is an indexed PK range scan. REST simulation
  fetched all 42,306 rows across 43 pages (max page ~1.05s, ~12s total, no timeout); then the live app
  loaded XERTEST fully — **27,811 activities** + 14,495 WBS, Gantt with milestones + dependency lag
  labels rendering, no timeout toast. Sequential (each page needs the prior page's last id) so mid-size
  projects load marginally slower than the old parallel fetch, but nothing times out. Small projects =
  single page (unaffected).

## Resource/cost-side OPC parity — in progress (2026-07-11)
User approved building all four gaps. **Migration `../../migrations/2026-07-11-resource-cost-parity.sql`
(USER MUST RUN):** `cost_accounts` (CBS tree), `price_per_unit` on `resources`+`resource_roles`,
`budgeted/actual/remaining_cost`+`cost_account_id`+`rate_source` on `resource_assignments`,
`activity_expenses` table, and `project_schedule.cost_rollup` (opt-in bottom-up cost derivation;
default false = current manual behaviour preserved). Build sequence (UI, next):
- **3a Cost Accounts / CBS manager** — DONE + deployed (`871279c`). Actions ▾ → Cost Accounts…: a
  single-pane indented CBS **tree** manager (add top-level / add child / edit / delete with child+usage
  guards). `COST_ACCTS`/`EXPENSES` loaded in `loadResourcesAssignments` (tolerant). Helpers
  `costAcctTree`/`costAcctOptions`/`costAcctLabel`/`costAcctUsage` ready for 3b/3c pickers. Tree
  ordering/indentation node-verified; interactive smoke-test blocked by the 4,393-row render freeze
  (needs a small project, same blocker as §2 write-actions).
- **3b Price/Unit + assignment cost + roll-up** — DONE + deployed (`1fdc9b8`). Resource-master
  Price/Unit field on resources+roles (roster column) — verified live on DEMO01. Assignment form:
  budgeted/actual/remaining COST + cost-account picker + Derived (units × `resRate`) / Manual toggle
  (`recalcCost` auto-fills + disables cost inputs when derived); cost fields written tolerantly with
  `curve`. Panel shows cost + account columns + total + a per-activity **cost_rollup** toggle;
  `syncActivityCost(r)` sums Σ assignment + Σ expense cost → activity planned/actual via `persist()`
  (undoable) ONLY when the flag is on (default off = manual preserved), called after assignment
  save/delete. (Assignment-form interactive test blocked by the 4,393-row grid freeze — code-verified.)
- **3c Expenses tab** — DONE + deployed (`3a05035`). New **Expenses** detail tab (between Resource
  Assignments and Relationships): per-activity CRUD (name, cost account, planned/actual cost, remarks)
  + Total row (`detExpenses`/`wireExpenses`/`openExpenseForm`/`delExpense`, copied from Steps/Assignments).
  Feeds `syncActivityCost` so expenses roll into the activity's Planned/Actual cost when `cost_rollup`
  is on. Tolerant of the not-yet-run migration.
**Batch complete + verified LIVE end-to-end (2026-07-11).** Created a small scratch project
`XERTEST` (via the authenticated session) to escape the 4,393-row render freeze, then drove the full
flow on the live app: added a rated resource (₱500/unit), a cost account (01 Preliminaries), an
assignment (20 units → derived ₱10,000, tagged to the account), and an expense (₱2,500); toggling the
activity's **Roll cost up** ran `syncActivityCost` → activity `planned_cost` = **₱12,500** in the DB
(10,000 + 2,500). Confirms 3a (account shown), 3b (assignment cost + toggle + sync), and 3c (expense
feeding the rollup) all working together. Resource-master Price/Unit + roster column also verified live.
`XERTEST` is left in place as the responsive venue for the P6-import test + future interactive checks.

## Excel export now includes dynamic columns (2026-07-11)
`exportExcel` previously used a fixed header set — the Activity-Code/UDF dynamic grid columns were
grid-only. Now it appends the extras **currently shown in the grid** (`extraColDefs().filter(c=>!colHidden[colKey(c)])`
— WYSIWYG; extras default hidden so a plain schedule still exports the 16 built-ins only). Per-row
value via `extraCellVal` (blank on WBS rows, matching the grid). Header labels are **uniquified**
against the built-ins and each other (a UDF named "Status" → "Status (2)"; duplicate "Zone" →
"Zone"/"Zone (2)") so the `json_to_sheet` object keys can't collide. Verified the uniquifier in a node
harness. Widths default 18 for extras.

## Clipboard fixes from live DEMO01 testing (2026-07-11)
Two bugs surfaced during the first real-login click-through (VERIFICATION.md §2), both fixed:
- **Shift-click made a native browser text-selection** (blue highlight + the browser's selection
  toolbar) that buried the red cell-range block and made Ctrl+C/X/V feel tied to inline editing. Fix:
  `user-select:none` on `.ps-grid-pane .ps-cell` (re-enabled `user-select:text` on `.ps-cell input`
  so editing still allows text selection). The cell block is now the only visible selection and the
  keyboard clipboard acts on it directly.
- **Row Copy/Paste (right-click → Copy/Paste row(s)) wasn't undoable** — `pasteRows` inserted directly
  and never recorded undo. Fix: new **`insertMany`** undo action. `pasteRows` now collects the inserted
  rows (`_dbPayload(res.data)` = the row minus underscore-prefixed computed props) and, on a cut, the
  deleted source rows; `undo()` deletes the pasted rows + re-inserts cut sources; `redo()` reverses it;
  both `await load()` to resync. (Cell paste was already undoable — it routes through `persist()`.)

## OPC parity batch: Activity Codes, Weighted Steps, Last Planner/PPC (2026-07-07)
Three requested together (user prioritization: build the one that's more foundational/necessary
where it matters — see the per-feature notes below).

**1. Activity Codes + code-based grouping/filtering.**
**Migration:** `../../migrations/2026-07-07-activity-codes.sql` (`activity_code_types`,
`activity_code_values`, both RLS via `is_approved()`/`is_planner()`; `project_schedule.activity_codes
jsonb default '{}'` — a compact `{ "<code_type_id>": "<code_value_id>" }` map, matching the
`schedule_baselines` jsonb-snapshot convention rather than a join table).
- **Actions ▾ → Activity Codes…** (`#ps-codes-back`, `openCodes`/`renderCodesList`/`renderCodesDetail`)
  — a two-pane manager (list of code TYPES on the left — e.g. Phase, Area, Zone — their VALUES on
  the right), reusing the Snapshots modal's `.ps-snap-list`/`.ps-snap-detail` two-pane CSS. Rename/
  delete a type, add/delete its values; each value's detail row shows how many activities currently
  use it.
  - **Add/Edit Activity modal** gets one dynamic `<select>` per code type (`populateCodesFields`,
    `#ps-f-codes-wrap`/`#ps-f-codes-fields`, hidden entirely when the project has no code types
    yet). Written **separately + tolerantly** after the main save (own try/catch, same pattern as
    `contract_date`/`risk_*_pct`).
  - **Grouping**: `#ps-group` gets one auto-populated "Group: <name>" option per code type
    (`populateGroupSelect`, called after every project load and after any code-type CRUD); `groupKeyOf`
    resolves `groupBy==='code:<id>'` via the activity's `activity_codes[id]` → the value's label
    (falls back to "— Unassigned —"). The existing non-WBS grouping path in `buildNodes()` is fully
    generic, so no grouping-logic changes were needed beyond `groupKeyOf`.
  - **Filtering**: `filters.codes = { "<code_type_id>": { "<code_value_id>": true } }`, one checkbox
    section per code type in the filter menu (`buildFilterMenu`), ANDed across types / ORed within a
    type in `rowMatches`.
- Deliberately **not** added as a grid column this round — the sticky-column chain (contiguous-from-
  the-left invariant noted elsewhere in this file) is easy to break, and grouping+filtering already
  satisfies the ask; a column can follow later if wanted.

**2. Weighted Steps → physical % complete.**
**Migration:** `../../migrations/2026-07-07-activity-steps.sql` (`activity_steps`, keyed by
`activity_id` like `resource_assignments`, not the row's uuid).
- New **Steps** tab in the Activity Details panel (between Status and Resource Assignments —
  `detSteps`/`wireSteps`/`openStepForm`/`delStep`, copied structurally from `detAssign`/
  `wireAssign`/`openAssignForm`/`delAssign`): a per-activity checklist, each step has a name/weight/
  %-complete. Shows the rolled-up "Weighted physical % complete" above the list.
- **`physicalPct(activityId)`**: weight-weighted average of each step's own % complete
  (`Σ(weight·pct)/Σ(weight)`); returns `null` when the activity has no steps (manual entry still
  applies, no behavior change for activities that don't use Steps).
- **`syncPhysicalPct(r)`** writes the rolled-up value back onto `project_schedule.percent_complete`
  via the existing `persist()` (not a raw update) every time a step is added/edited/deleted — so
  undo, audit, and the CPM/rebuild trigger (`percent_complete` is already in `_RECOMPUTE_FIELDS`)
  all fire exactly as they would for a manual edit. This is the entire point of the feature: CPM,
  EVM, Cost Loading, forecasts, the Planner Cockpit, and Monte Carlo actuals all read
  `percent_complete` already, so they benefit with **zero further changes**.
- The Add/Edit modal's **% Complete** field is disabled (with an explanatory title) when the
  activity has steps, pointing to the Steps tab — purely a UX affordance; the field still submits
  its (already-synced) value if somehow re-enabled, so nothing breaks if steps are deleted mid-edit.

**3. Last Planner System — weekly work plan + Percent Plan Complete (PPC).**
**Migration:** `../../migrations/2026-07-07-weekly-commitments.sql` (`weekly_commitments`: project +
`week_start` (Monday) + description + optional `activity_id` link + responsible + status
(Open/Complete/Not Complete) + reason_code/notes).
- New 4th view/tab (**Last Planner**, sidebar `data-view="lastplanner"` + title-menu
  `data-tab="lastplanner"`, `#ps-view-lastplanner`) — same top-level pattern as Planner/Schedule/
  Cost Loading. The Schedule-only toolbar (Add activity/Group/Zoom/etc.) is hidden here too, same
  as on Planner/Cost Loading.
- **Week navigator** (`_lpWeek`, `mondayOf(d)`, prev/next/"This week", persisted per-project in
  localStorage) + **Add commitment** modal (description, optional linked activity picked from the
  live schedule, responsible).
- **Weekly commitments table**: inline **Status** (Open/Complete/Not Complete) and **Reason code**
  selects per row (reason select disabled unless status is Not Complete) — changes save immediately
  (`lpUpdate`), matching a real Friday-afternoon review workflow rather than requiring the edit modal
  for every status flip. Reason codes are a fixed Last-Planner-standard list (`LP_REASONS`: Materials,
  Manpower/Labor, Equipment, Prior Work Not Complete, Design/Information, Weather, Owner/Client
  Decision, Rework, Other).
- **PPC KPI** for the selected week = `Complete ÷ (Complete + Not Complete)` — **Open (not yet
  reviewed) commitments are excluded from the denominator** so a PPC number doesn't read artificially
  low mid-week before the review happens; the KPI row also shows the raw Open count so it's clear
  not everything's been assessed yet.
- **PPC trend chart** (`renderLPPpcTrend`): all weeks with ≥1 assessed commitment, plotted against a
  dashed 80% Lean-Construction benchmark line. **PPC trend / Reasons for variance** panels reuse the
  cockpit's `.ps-ck-trend-card`/`.ps-risk-torn-row` visual language rather than inventing new chart
  chrome.
- **Reasons for variance** (`renderLPReasons`): a Pareto-style ranked bar list of reason codes across
  **all** Not-Complete commitments (not just the current week), so recurring root causes are visible
  even if this week's variance count is small.
- Verified in throwaway gitignored harnesses (`_ui_test.html`): `mondayOf()` hand-checked against all
  7 weekdays (Sun correctly maps back to the *previous* Monday, Mon–Sat map to their own week);
  `physicalPct` weighted-average matched a hand calc (2·100+3·80+3·0+2·0)/10 = 44%; the Activity-
  Codes assignment `<select>`s correctly pre-select an activity's existing code values; screenshotted
  the PPC trend chart and — same lesson as the Milestone Outlook timeline earlier — caught and fixed
  an edge-label clipping bug (last x-axis date ran off the SVG's right edge) before shipping.

## First-class WBS (2026-07-07) — WBS Manager + dedicated wbs_nodes table
User wanted the Work Breakdown Structure built FIRST (unlimited depth), then activities placed under
any main- or sub-node — rather than hand-typing dotted codes. **Migration:** `../../migrations/
2026-07-07-wbs-nodes.sql` (`wbs_nodes` table + `project_schedule.wbs_node_id`).
- **Architecture (chosen by user): dedicated `wbs_nodes` table** (id, parent_id, code, code_custom,
  name, sort_order) as the AUTHORING source of truth for the tree. Codes are **auto-numbered from
  tree position** (`computeWbsCodes` → 1, 1.1, 1.1.2…) but **editable** (`code_custom` keeps a typed
  code e.g. `CIV-100`; its subtree is prefixed by it).
- **Projection (key integration):** the existing grid/roll-up/CPM/importer pipeline keys off the
  dotted `project_schedule.wbs` code + `activity_type='WBS Summary'` rows, so on every tree edit the
  app PROJECTS the nodes into those summary rows (`_wbsCommit`: recompute codes → update each node's
  `wbs_nodes.code`, its linked WBS-Summary row's `wbs`+`activity_name`, and the `wbs` of activities
  under any re-coded node; batched via `_batchUpdate`). This keeps the entire tested pipeline
  UNCHANGED — no rewrite of grouping/rollups/importers.
- **WBS Manager** — new view (`#ps-view-wbs`, sidebar `data-view="wbs"` + title menu `data-tab="wbs"`,
  `renderWbsManager`): indented tree with per-node Add-child, Move up/down, **Indent/Outdent**, Edit
  code, Delete; inline name edit; badges (sub-count · activity-count). Node CRUD: `wbsAddChild`/
  `wbsAddRoot` (inserts node + a projected WBS-Summary row), `wbsRename`, `wbsMove` (up/down/indent/
  outdent using the verified tree algos + `_wbsNormalizeAndPersist`), `wbsEditCode`, `wbsDelete`
  (**guarded** — blocks if the node still has sub-nodes or activities). Tree algorithms
  (auto-numbering, custom codes, move/indent/outdent, guards) unit-tested in a node harness.
- **Adopt existing WBS** (`wbsAdopt`) — one-time bridge for imported/legacy projects: builds `wbs_nodes`
  from the current WBS-Summary rows (parents resolved by dotted-code prefix, depth-ordered so parents
  exist first; codes preserved as `code_custom`), then links the summary rows + matching activities via
  `wbs_node_id`. Importers stay unchanged (they still create summary rows); Adopt pulls them into the
  manager. The Adopt button auto-shows only when un-adopted summary rows exist.
- **Add/Edit activity** — new **Parent WBS picker** (`#ps-f-wbs-node`, indented `wbsPickerOptions`)
  before the WBS Code field: picking a node auto-fills + locks the code and sets `wbs_node_id`
  (written tolerantly, like `contract_date`). Direct code entry still works when no tree exists yet
  (back-compat). `wbs_node_id` also added to the Add/Edit save + activity save paths.

## Toolbar/topbar de-clutter (2026-07-07) — File menu + labeled groups
The top area had ~22 icon-only buttons, several sharing a glyph (pulse=Health & Spotlight, risk=
Critical & Threshold/Monte-Carlo, listView=Layouts & UDF/GlobalChange, layers=Expand & Baselines) —
so planners had to guess. Reworked to labeled controls + grouping (no logic changes to the underlying
actions; ids preserved so all existing handlers work unchanged):
- **File ▾ menu** (topbar, `#ps-filebtn`/`#ps-file-menu`): **Import, Export, Print** combined. Import/
  Export were removed from the **Actions ▾** menu and the standalone Print icon removed from the topbar;
  the three item buttons keep their original ids (`ps-import`/`ps-export`/`ps-print`) so their handlers
  are untouched. `.ps-tb-labeled` gives topbar buttons auto width (icon + word); `.ps-tb-sep` dividers.
- **Topbar** now: undo · redo │ **File ▾** · **Reports** · **Health** (last two now show text labels) │
  filter · refresh. Undo/redo/filter/refresh stay icon-only (universally understood).
- **Lower toolbar** relabeled every icon button to icon+word: **Expand · Outline ▾ · Layouts ▾ ·
  Schedule · Layout ▾ · Columns ▾ · Colors ▾** (all keep their existing `.ps-menu-wrap` popovers +
  ids/handlers — just labels + drop `.ps-icobtn` fixed width).
- **Analyze ▾ menu** (`#ps-analyzebtn`/`#ps-analyze-menu`): the four analysis controls — **Critical
  path · Show dependencies · Link mode · Progress Spotlight** (advance 1/2wk·1mo·clear) — grouped into
  one labeled dropdown. The crit/deps/linkmode items keep their ids so their toggle handlers are
  unchanged; `analyzeMenu` stops click propagation so several can be toggled without closing, and
  `_syncAnalyzeBtn()` (module scope) mirrors any-active (crit/deps/link/`_spotlight.on`) onto the
  Analyze button (`#ps-analyzebtn.active`). The standalone `#ps-spotlight` button was removed (its
  `#ps-spotlight-menu` data-spot items now live inside Analyze); `advanceSpotlight`/`clearSpotlight`
  call `_syncAnalyzeBtn()` instead of touching the old button.
- `closeMenus()` gained `fileMenu` + `analyzeMenu`. Net: ~22 mystery icons → labeled words + 2 grouped
  dropdowns (File, Analyze), collisions gone.

## Advanced scheduling batch (2026-07-07) — 9 features, easiest→hardest
All in `modules/project-schedule/index.html`. Each feature was unit-tested (pure logic extracted
into a node harness) and committed+pushed separately. **User must run the new migrations** listed.

1. **Progress Spotlight / data-date advancement** (no migration). Toolbar Spotlight menu (`#ps-spotlight`,
   `advanceSpotlight`/`clearSpotlight`/`spotlightRow`): advance the data date 1/2 weeks or 1 month and
   blue-highlight (+dim the rest, mirroring critMode) the incomplete activities whose planned work fell
   in the window just passed — the exact set to status. `_spotlight={on,start,end}`; row class
   `ps-spotrow`, bar class `ps-spot`, `ps-spotmode` on grid-scroll + gantt-pane.
2. **Constraint-aware CPM** (no migration; uses existing primary/secondary constraint fields). `cpmLogic`
   now honors date constraints in both passes via `taskConstraints`/`fwdConstrain`/`bwdConstrain`:
   Start/Finish On·On-or-After·Mandatory pin/floor early dates (forward, applied LAST after the data-date
   floor); Start/Finish On-or-Before·Mandatory cap the late finish (backward); As-Late-As-Possible sits
   the activity at its late dates. **Critical is now `_float <= 0`** (was `=== 0`) so over-constrained
   (negative-float) activities flag critical — the point of the feature.
3. **Global Change** (no migration). Actions ▸ Global Change: WHERE conditions (field/op/value, ANDed;
   blank=all) + THEN changes (Set/Add/Subtract/Multiply/Clear · text/num, Set/Shift-days · date) with a
   live Preview count. `GC_FIELDS` catalog with per-type ops; `gcMatch`/`gcBuildPatch`; moving start/finish
   auto-recomputes duration. Chunked writes, resets undo, confirms first (same safety model as the bulk
   progress grid).
4. **Resource leveling / over-allocation resolver** (no migration). Actions ▸ Resource leveling
   (`levelScan`/`renderLeveling`/`levelDelay`): scans each resource's monthly planned demand vs calendar
   capacity (reuses `spreadAdd`+`resCapacity`), reports over-allocated periods + peak overage, lists the
   flexible (positive-float, not-started) contributors, and delays one within its own total float per
   click (through `persist()` → undoable + recomputes CPM; report re-scans). Never moves the project
   finish; critical/started contributors untouched.
5. **What-if scenarios (reflections)** — **migration `2026-07-07-schedule-scenarios.sql`**
   (`schedule_scenarios`). Actions ▸ What-if scenarios: capture the schedule as a named jsonb checkpoint
   (dates/dur/%/predecessors/cost), experiment on the live schedule, compare live-vs-scenario deltas
   (finish / critical count / planned cost / activities that moved), or **Restore** to roll the experiment
   back. Mirrors the baselines two-pane modal.
6. **User-Defined Fields** — **migration `2026-07-07-user-defined-fields.sql`** (`activity_udf_defs` +
   `project_schedule.udf jsonb`). Actions ▸ User-Defined Fields defines typed fields (Text/Number/Date/
   Cost); Add/Edit modal renders one typed input per def (`populateUdfFields`, saved tolerantly to `udf`
   jsonb, same pattern as `activity_codes`); values show in the details General tab. `UDF_DEFS` loaded in
   `loadResourcesAssignments`.
7. **Resource/cost distribution curves** — **migration `2026-07-07-assignment-curve.sql`**
   (`resource_assignments.curve`). Assignment modal gains a Distribution curve (Linear/Front/Back/Bell);
   new `curveCdf`+`spreadCurveAdd` shape how planned+remaining units are time-phased in Resource Usage
   (actuals stay linear). `spreadCurveAdd` uses each curve's cumulative fn → O(months), exact,
   total-conserving; `linear` reduces to `spreadAdd` exactly (verified). Curve written tolerantly.
8. **Saved layouts** (no migration; localStorage `ps_views`). The Saved-views control now bundles the
   FULL working arrangement — filter + grouping (incl. `code:<id>` groups) + zoom/search + the whole
   column setup (hidden columns / column sort / renamed headers / `--c-*` widths). `applyView` restores
   all of it and writes back to the same localStorage keys the renderers read; old saved views still
   apply (each field guarded).
9. **Threshold monitoring → auto-issues** — **migration `2026-07-07-schedule-thresholds.sql`**
   (`schedule_thresholds`). Actions ▸ Threshold monitoring: rules watching a per-activity metric
   (`float_below` / `finish_var_above` / `contract_var_above` / `overdue_days`) at a severity. "Scan now"
   (`scanThresholds`/`thrValue`/`thrBreached`) lists breaches; "Generate issues" writes them into the
   shared **`issues_lessons`** table (type=Issue, category='Schedule Threshold'), **deduplicated** against
   still-open threshold issues for the same activity+rule (deterministic `_thrIssueTitle`) so repeated
   scans don't spam duplicates.

## Monte Carlo: per-activity 3-point duration override (2026-07-07)
**Migration:** `../../migrations/2026-07-07-risk-3point-duration.sql` (`project_schedule.risk_optimistic_pct`/
`risk_pessimistic_pct`, both `numeric(6,2)`, nullable — folded into `supabase-setup.sql`).
Prioritized over adding a criticality-index output: the simulation previously applied ONE global
Optimistic%/Pessimistic% to every activity regardless of type, so a 2-day punch-list item and a
180-day long-lead procurement activity got the identical relative spread — an input-fidelity gap
that limits every downstream output (P50/P80/P90, tornado). A criticality index would instead need
a **backward pass per iteration** (to get float), roughly doubling compute right where 27k-activity/
1000-iteration runs are already flagged as heavy, and its result would mostly just re-derive what
the tornado already shows under a uniform-variance model. The override is compute-neutral (same
forward-pass-only architecture, per-node opt/pess instead of one global pair) and improves every
existing output immediately, so it came first.
- **Add/Edit Activity modal** gained **Risk: Optimistic %**/**Risk: Pessimistic %** fields (next to
  Contract Date) — blank (the default) means "use the simulation-wide default"; set only on the
  activities a planner actually has a stronger/weaker view on (e.g. long-lead procurement,
  permitting, weather-sensitive site work). Written **separately + tolerantly** after the main
  save (own try/catch, like `contract_date`), so a not-yet-migrated DB doesn't break saves — and so
  a missing `risk_*` column can't also swallow the `contract_date` write, or vice versa (kept as
  two independent tolerant updates rather than one combined payload).
- **`_riskPrep()`** captures `riskOpt`/`riskPess` (the activity's own %, `/100`, or `null`) per node.
  **`runRisk()`** computes each varied node's *effective* range once before the iteration loop
  (`nd._opt`/`nd._pess` = the override or the global default; re-clamped so pess>opt exactly like
  the global pair already was) — not per-iteration, since it's invariant across samples — and the
  sampling loop calls `_triSample(nd._opt, 1, nd._pess)` instead of the global `opt`/`pess`.
- **Results surface which activities used a custom estimate**: the count line adds "· N with a
  custom 3-point estimate", and any overridden activity in the **tornado** (top duration drivers)
  gets a small "(custom)" tag next to its name.
- Verified in a node harness (no DOM/backend touched): the effective-range fallback/clamp logic
  hand-checked across 5 cases (both null → global; one overridden → mixed; both overridden with
  pess≤opt → guard re-clamps, matching the global pair's own guard); `_triSample` re-verified with a
  realistic per-activity override range (opt 70%/pess 115%) — sampled mean matched `(a+c+b)/3`
  exactly over 300k draws, bounds respected.

## OPC parity: Multiple baselines + Monte Carlo risk (2026-07-07)
Both reached from the **Actions ▾** menu (`#ps-baselines`, `#ps-risk`).

**Multiple baselines** — **Migration:** `../../migrations/2026-07-07-schedule-baselines.sql`
(`schedule_baselines`: one row/baseline, `activities` jsonb `{ "<activity_id>":[start,finish,dur,
planned_cost] }`, `is_primary`, RLS via `is_approved`/`is_planner`). Modal `#ps-bl-back` (list + compare
panes). `captureBaseline()` snapshots all leaf activities; `setPrimaryBaseline()` flags one primary AND
**writes its dates back onto `project_schedule.bl_start/bl_finish/bl_cost`** (chunked, then `load()`) so
the existing Gantt BL0 bar + `finVar` variance use it; `showBlCompare()` shows per-activity
current-vs-baseline finish variance (top 300, sorted by slip, avg + late count); `deleteBaseline()`.
Tolerant of a missing table (shows a "run the migration" note).

**Monte Carlo schedule risk** — **no migration** (pure client compute). Modal `#ps-risk-back`.
`_riskPrep()` builds the task graph + topological `order` (same Kahn approach as `cpmLogic`) once;
`_riskForward(prep,durs)` is a single forward pass returning project finish (max EF) for a given
duration array. `runRisk()` samples each **incomplete, not-started** activity's duration from a
**triangular** distribution between Optimistic% and Pessimistic% of plan (mode = 100%; completed/started
keep actuals) via `_triSample`, runs N iterations (default 1000, chunked 100/frame with a progress %
so the UI never freezes — leverages the O(n+e) CPM), and accumulates running sums for a
**duration-sensitivity** (Pearson r of each activity's sampled duration vs the finish — no per-iteration
backward pass needed). `finalizeRisk()` shows P50/P80/P90 finish dates, deterministic (plan) finish,
P80-vs-plan slip, a 30-bin finish-date histogram, and a **tornado of the top duration drivers**. Finish
date = `base + EF − 1` (inclusive, matches `applyScheduleDates`). Verified in a node harness: triangular
mean = (o+m+p)/3 exactly, bounds respected, percentiles monotonic and right-skewed of the deterministic
finish.

## PWA / offline resilience (2026-07-07) — app-wide
For flaky site connectivity. Three new pieces, all safe-by-construction:
- **`sw.js`** (repo root) — a **network-first** service worker: only same-origin GET is handled;
  writes and ALL cross-origin (Supabase REST/auth) pass straight through (never cached/queued).
  Online it always fetches fresh then refreshes the cache; offline it falls back to the last cached
  asset/page. Because network is tried first, it can only ADD an offline fallback — never serves
  stale while online. Bump `CACHE` (`pd-shell-v*`) to purge.
- **`manifest.webmanifest`** (repo root) — installable (name/icons/theme `#EE3124`, `display:standalone`).
- **`assets/js/theme.js`** (loaded on every page) now, app-wide: derives the app root from its own
  script URL (works at any page depth), injects the `<link rel=manifest>` + `theme-color` meta,
  registers `sw.js` on `load`, and shows a fixed **offline indicator** ("Offline — … changes won't
  save") toggled by `online`/`offline` events (pure UI, no caching risk).
- **NOT offline writes** — edits still require connectivity (the indicator says so). Full offline
  write-queue/sync is deliberately out of scope (auth + conflict complexity).
- Module `?v=` → 20260709 (theme.js changed). NOTE: could not be tested against the live GitHub
  Pages origin from here; network-first is the safest strategy but verify install/offline on staging.

## Planner batch 7 (2026-07-07) — Cockpit redeveloped as a client-facing outlook, not tables
User feedback after batch 6 (which had already turned the two list panels into bar charts): "still
doesn't feel very useful... shouldn't be full of tables," and asked what a **Client** would want to
see. Agreed direction: are-we-on-track, when-will-it-finish, what's-at-risk — a snapshot/outlook,
not an activity punch list. Rebuilt the passive dashboard content (kept the `.ps-ck-bar` action
buttons — Update progress/Export lookahead/Take snapshot/Snapshots/Change history — since those are
on-demand tools, not part of the problem):
- **Status banner** (`_ckStatusHTML`, `#ps-ck-status`, top of the page): a traffic-light chip (On
  Track / At Risk / Behind Schedule — thresholds 0d / 30d off the forecast-vs-planned finish) plus
  one auto-generated sentence: "{Project} is X% complete. At the current pace, forecast finish is
  {date}, {N days past / on pace with} the planned finish ({date}). N milestones at risk. N exposed
  to contract-date (LD) risk." This is the single thing a client should read first.
- **New hero chart — Progress S-Curve & Forecast** (`_ckSCurveCompute`/`_ckSCurveSVG`, replaces
  batch 6's snapshot-based "Progress Trend" line): duration-weighted Planned / Actual / Forecast-
  to-finish curves, **ported verbatim from the standalone `modules/s-curve/` module's
  `compute()`/`renderChart()`** (same math — SPI-based forecast clamped 0.1–3, S-curve-shaped
  forecast tail, data-date line) but reusing this module's **already-loaded `rows`** for the current
  project instead of a second fetch, so it draws instantly with zero network cost. Strictly better
  than the snapshot trend it replaced: always available (no dependency on planners remembering to
  take weekly snapshots), and it's the chart a client actually recognizes from monthly reports. No
  manual forecast-override input here (that stays a feature of the dedicated s-curve module) — the
  cockpit's version is auto/SPI-only by design, kept simple.
- **New "Milestone Outlook" timeline** (`_ckMilestoneTimeline`, replaces the "Milestones at risk"
  list): every milestone plotted on a single date axis as a dumbbell — a faint gray dot at its
  baseline finish, a colored dot at its current forecast/actual finish, joined by a line when they
  differ. Color = status (green on-track / amber ≤14d late / red >14d late, thresholds intentionally
  tighter than the project-level status banner since a single milestone slipping 2 weeks matters
  more than the overall project doing so). Shows the WHOLE milestone set, not just the late ones —
  a client wants "what's coming up," not only "what's already broken." Only at-risk/late milestones
  get a text label (alternating above/below to reduce overlap); labels are clamped inside the
  viewBox (`padL+22`/`padL+cw-22`) so the first/last milestone's label doesn't clip off the edge —
  caught by screenshotting a throwaway harness before shipping.
- **"Top risk drivers"** (was "Most behind schedule"): same ranked bar rows as batch 6, just capped
  to the top 5 with a "+N more — see Update progress/Export lookahead" footer instead of a 60-row
  scrolling list.
- **Critical-path drivers**: kept the batch-6 float-bucket strip chart; the scrolling row-list below
  it became compact non-scrolling **pills** (`fillPills`, `.ps-ck-pill`, up to 18 + "+N more") — a
  name badge per activity, click still jumps to the Schedule view with that activity selected.
- **"3-week lookahead" panel removed from the passive view entirely** — it's an action checklist,
  not an outlook metric, and the same scope is still fully available via "Update progress…" (the
  bulk-edit grid, which has its own Due-2/3/6-weeks scope filter) and "Export lookahead" (the XLSX
  site-meeting handout); only its count remains, folded into the KPI strip.
- KPI strip condensed from 7 tiles to 6, swapping "Activities behind"/"Data date" (now in the
  headline sentence / chart data-date line) for "Forecast finish" (with a +Nd-vs-plan sub-label).
- Removed the now-dead snapshot-trend code (`_ckLoadTrend`/`_renderCkTrend`/`_ckTrendSVG` and the
  `_ckTrend` cache/invalidation call in `takeSnapshot`) rather than leaving it unused — "Take
  snapshot"/"Snapshots"/"Change history" still work exactly as before, just no longer feed a trend
  chart (the S-curve replaced that need).
- Verified with a throwaway gitignored harness (`_ui_test.html`) against a hand-built 12-activity/
  6-milestone fixture (mobilization on-time, substructure done-but-late, superstructure behind,
  MEPF/finishes not started) with a pinned data date: screenshotted the status banner (correctly
  read "Behind Schedule", 35% complete, forecast 186 days past plan), the S-curve (planned/actual/
  dashed-forecast rendered correctly, actual line flat past the data date as expected), and the
  milestone timeline (all four status colors present, dumbbell baseline-vs-forecast lines correct,
  labels legible and non-clipping after the padding fix above).

## Planner Cockpit (2026-07-07) — batch 1 of the planner roadmap
New third view (`#ps-view-planner`, sidebar `data-view="planner"` + title menu `data-tab="planner"`,
`activeTab==='planner'`). `renderPlanner()` (called from `switchTab`/`renderAll`) is a read-only
weekly cockpit built entirely from existing columns (no schema change): KPI row (overall % complete,
activities behind baseline, milestones at risk, critical count, due-in-3-weeks, data date) + four
lists — **Milestones at risk** & **Most behind schedule** (via `finVar` = forecast finish − baseline
finish, days late), **3-week lookahead** (incomplete activities whose start/finish falls in
[data date, +21d]), **Critical-path drivers** (`_critical` from `computeCPM`). Rows click → jump to
the Schedule view with the activity selected. CSS `.ps-ck-*`.

## Planner batch 6 (2026-07-07) — Cockpit charts (replace list rows) + Schedule-only toolbar hidden
User feedback: the four cockpit panels were "just scrollable tables," not useful for reporting/
tracking; also the Schedule grid's toolbar (Actions/Add activity/Group/Zoom/Expand/Views/Schedule/
Layout/Columns/Colors/Critical path/Link/Search) showed on the Planner and Cost Loading tabs where
none of it applies.
- **Milestones at risk / Most behind schedule are now ranked bar charts, not plain rows**: each row
  (`barRow()` in `renderPlanner()`) got a horizontal bar (`.ps-ck-bartrack`/`.ps-ck-barfill`) whose
  width is the item's slip days relative to the worst item in that same list (so the worst offender
  reads as a full bar, not just a bigger number), colored by severity tier (`sev-1/2/3`: ≤7d / 8–21d
  / >21d, via opacity on `var(--pd-red)`). Same click-to-jump-to-Schedule behavior as before (still
  `.ps-ck-row`).
- **New "Progress Trend" chart** (`#ps-ck-trend`, above the 2×2 grid): an SVG line chart
  (`_ckTrendSVG`) plotting `pct_complete` across the project's saved **Schedule Snapshots**
  (`schedule_snapshots` — the same table "Take snapshot" already writes to), so a planner can see
  week-over-week whether the project is catching up or slipping instead of re-reading one static
  KPI. Lazy-loaded per project (`_ckLoadTrend`/`_ckTrend` cache, invalidated when a project switches
  or a new snapshot is taken) so opening the cockpit isn't blocked on a network round-trip. Needs
  ≥2 snapshots to draw a line; otherwise shows an empty-state nudging the user toward "Take
  snapshot." Tolerant of a missing table (shows a migration hint, same pattern as the rest of the
  cockpit).
- **Critical-path drivers gained a float-bucket summary strip** (`_ckFloatBuckets`, `#ps-ck-buckets`,
  above the existing driver list): a segmented bar + legend counting incomplete activities into
  Critical (0d) / 1–5d / 6–15d / >15d float, so the panel reads as "how much slack is left in the
  schedule" before drilling into names.
- **3-week lookahead is unchanged** (stays a plain list) — it's an action checklist for the coming
  weeks, not a trend or ranking, so a chart wouldn't add anything.
- **Schedule-only toolbar now hidden outside the Schedule tab**: `switchTab()` toggles
  `.ps-toolbar` display — visible only when `tab==='schedule'`, hidden on Planner Cockpit AND Cost
  Loading (matches how `#ps-view-schedule`/`#ps-view-cost`/`#ps-view-planner` are already toggled).
- Verified with a throwaway gitignored harness (`_ui_test.html`, matches the `**/_ui_test.html`
  gitignore pattern from Prompt 53) rendering the real CSS + the new functions against synthetic
  data, screenshotted, then deleted: bar widths/severity shading scale correctly against each
  list's own max, LD tags still render, the float-bucket counts matched a hand-count (2 critical /
  1 each in the other three buckets from a 7-task fixture), and the trend SVG drew a 6-point line
  with correct gridlines/date labels/end-value callout.

## Planner batch 5 (2026-07-07) — Change history (audit trail)
**Migration:** `../../migrations/2026-07-07-schedule-audit.sql` (`schedule_audit`, insert-only for
planners, read for approved). `logAudit(r, action, changes)` is **fire-and-forget + tolerant** (a
missing table never breaks a save). Hooked into `persist()` (inline/grid/drag/link/tracker edits —
`_auditChanges(prev, patch)` diff), modal `save()` insert, `saveBulkUpdate()` (per row), and
`applyScheduleDates()` (one `reschedule` event with a count). Cockpit **Change history**
(`openAudit`, `#ps-audit-back`) lists the last 400 changes (When / Who [resolved via
`PDb.getAllUsers`] / Activity / field from→to), `_auditSummary` formats dates.

## Planner batch 4 (2026-07-07) — Schedule snapshots (milestones + summary)
**Migration:** `../../migrations/2026-07-07-schedule-snapshots.sql` (`schedule_snapshots` table +
RLS via `is_approved()`/`is_planner()`). Cockpit **Take snapshot** (`takeSnapshot`) captures a
summary (avg % / activities total+behind / milestones total+at-risk / project finish) plus every
milestone's forecast/baseline/contract date as `milestones` jsonb — one row per snapshot (scales to
27k activities). **Snapshots** (`openSnapshots`, `#ps-snap-back`) lists them; selecting one shows a
**milestone drift** table (Then forecast vs Now forecast, +Nd drift). `deleteSnapshot` removes one.
Fully tolerant — missing table just shows a "run the migration" note, never breaks the cockpit.

## Planner batch 3 (2026-07-07) — Contract date + LD tracker
**Migration:** `../../migrations/2026-07-07-schedule-contract-date.sql` (adds
`project_schedule.contract_date date`). A **Contract Date** field is in the Add/Edit modal
(`#ps-f-contract`, next to Baseline Finish). To avoid breaking saves on a not-yet-migrated DB,
`contract_date` is written **separately + tolerantly** after the main save (a missing-column error
is swallowed) — it is NOT in the main payload. `contractVar(r)` = forecast finish − contract date
(+ = LD exposure). Cockpit adds a **"Contract dates at risk"** KPI and an **"LD +Nd"** tag on the
Milestones-at-risk / Most-behind rows when the forecast passes the contract date.

## Planner batch 2 (2026-07-07) — bulk progress update + lookahead export
Both schema-free, driven from the cockpit action bar (`.ps-ck-bar`).
- **Bulk "Update Progress" grid** (`#ps-bulk-back` overlay): `openBulkUpdate()` → `renderBulkBody()`
  lists incomplete activities filtered by `#ps-bulk-scope` (Due 2/3/6 wks / In progress / All
  incomplete) + a text filter, each row with inline Status / % Complete / Actual start / Actual
  finish inputs. Edits accumulate in `_bulkEdits{id:{field:val}}` (row goes `.dirty`);
  `saveBulkUpdate()` writes changed rows in chunks of 40 via direct `update().eq('id')`, updates
  local `rows`, `rebuild()/computeCPM()/renderAll()`. Overdue target-finish flagged red.
- **Lookahead window + export**: `_ckLookWeeks` (2/3/4/6, `#ps-ck-weeks`) drives BOTH the cockpit
  "N-week lookahead" panel (`_ckLookSet()`) and `exportLookahead()` (XLSX handout: ID/Activity/
  Status/Start/Finish/%/Critical/Float/Responsible for the window).

## Topbar + project browser (2026-07-07)
- **Topbar tools spacing**: the global tool cluster (`#ps-topbar-tools`: undo/redo/health/reports/
  filter/refresh/print) now uses uniform 34×34 buttons, `gap:4px`, a left divider, and a divider
  before `#user-bar`; the theme toggle (`#pd-theme-toggle`, injected by theme.js before `#user-bar`)
  is sized to match. Removed the conflicting `width:36px` vs `padding:0 9px` rules.
- **OPC-style project browser (folder navigator — scales to 100+ schedules)**: the flat project
  `<select>` is hidden (kept as source of truth for `projName()` / load) behind `#ps-projsel-btn`,
  which opens `#ps-projsel-menu`. `renderProjectSelector()` shows **one folder level at a time**
  (state `_pssPath` = current workspace id, `''` = root): sub-folders (workspace/program/group nodes
  from the `workspaces` tree, with a node-type badge + a **descendant project count**) then the
  projects directly under the folder. A **breadcrumb** (`.ps-pss-crumb`, `_pssCrumbs`) walks back up;
  clicking a folder drills in. A **search box** (`_pssSearch`) flattens to matching projects across
  the whole tree (breadcrumb hidden while searching). Opening the menu sets `_pssPath` to the current
  project's `workspace_id` so it lands in context. Picking a project → `selectProject(id)` (syncs the
  hidden select + labels, reloads). `folder` icon added to icons.js. `.ps-projctx` is
  `position:relative` (NOT `.ps-menu-wrap`, which forces inline-block and breaks the name/workspace
  column). Module `?v=` → 20260708.

## Gantt timeline scale (2026-07-07) — adjustable period-column width
The Gantt timescale width is `dayw = DAYW[zoom] * ganttScale`. `DAYW` sets the base px/day per
Month/Quarter/Year; **`ganttScale`** (persisted `localStorage.ps_ganttscale`, clamped 0.35–6) lets
the user widen/narrow the period columns. Two gestures adjust it (the +/− buttons were removed):
- **Excel-style drag**: each date-header cell (`.ps-yr`/`.ps-mo`) carries a right-edge grip
  (`.ps-ts-grip`, `data-days` = its day span). `startTsResize(e, days)` rescales uniformly —
  `newDayw = startDayw + dragDx/days` → `ganttScale = newDayw / DAYW[zoom]` — re-rendering per rAF,
  saving on mouseup.
- **Ctrl + mouse-wheel** over `#ps-gantt-scroll`: `applyGanttScale(ganttScale × 1.15^±1)`, keeping
  the date under the cursor fixed (capture content-x ratio before, restore `scrollLeft` after a
  double-rAF since `renderGantt→scheduleRender` batches `doRender` one frame later).
`applyGanttScale(v)` / `_saveGanttScale()` are module-scope. (This is the Gantt month/qtr/year
column width — NOT the activity-grid columns.)

## Column drag-to-reorder (2026-07-08)
Header cells are `draggable` (HTML5 DnD): drag one onto another to reorder. Implemented purely via CSS
flex `order` — `applyColOrder()` writes `.ps-cell:nth-child(i){order:p}` rules keyed to each column's
DOM/data index, so the **DOM stays in data order** and everything positional keeps working (nth-child
hide, `data-ci`→`openColMenu`, `colSortVal`, resize) while only the VISUAL order changes. State is a
persisted `ps_colorder` list of `colKey`s; `normalizeColOrder()` appends new columns / drops removed
ones; `moveCol(src,tgt)` drops src before tgt. The resize grip preventDefaults its mousedown so it
resizes (not drags); a plain click still opens the column menu. Columns ▾ **Reset** also clears the
order back to default. NOTE (2026-07-08): removed the Procurement-flavoured UDF example text
("Cost Code / PO Number / Vendor / Risk Owner") — those belong to the separate Procurement Dashboard,
not the Planning App; the UDF prompt/empty-state are now domain-neutral.

## Dynamic columns (2026-07-08) — Activity Codes + UDFs as grid columns
"Define columns" now matches OPC: the project's **Activity Codes** and **User-Defined Fields** appear
as real, choosable grid columns (no new migration — reuses `CODE_TYPES`/`CODE_VALUES`/`UDF_DEFS` +
`project_schedule.activity_codes`/`udf` jsonb). `extraColDefs()` maps them to `[key,label,'c-x',meta]`
tuples; `gridCols() = GRID_COLS.concat(extraColDefs())` is the single source the whole column pipeline
now iterates (`renderHeader`, `applyColHidden`, `openColMenu`, `fitColumn`, `renderColsMenu`,
`colSortVal`). `gridRowHTML` appends `gridExtraHtml(r)` to ALL three row kinds (value on leaf tasks,
blank on group/WBS) so cell counts — and the `nth-child` hide rules — stay aligned. `extraCellVal`
reads the code value (`codeValueLabel`) or UDF (`udfFmt`). Extra columns share the resizable `--c-x`
width. **Collision-safe:** hide/rename use `colKey(c)` — built-ins keep their LABEL key (back-compat),
extras use their unique id (`code:<id>`/`udf:<id>`), so a code/UDF named e.g. "Status" can't hide the
built-in Status. Extras **default hidden** (`seedExtraHidden` + `ps_colseen`) — OPC-style deliberate
add via the Columns ▾ chooser, which now has an "Activity Codes & User-Defined Fields" sub-section
(Show all / Hide all / Reset — Reset re-seeds extras hidden). New codes/UDFs appear as columns when
their editor modal closes (`closeCodes`/`closeUdf` → `renderHeader`+`renderGrid`). Verified in a node
harness (collision-safety + hide-index alignment). NOTE: the Excel export still uses its fixed header
set — extra columns are grid-only for now.

## Columns (2026-07-07) — eye-icon show/hide, resize everywhere, export toggle
- **Eye-icon multi-select chooser**: the toolbar column button is now an **eye** icon
  (`icons.js` gained `eye`/`eyeOff`). `renderColsMenu()` shows a checkbox per column (ticked =
  visible) with a per-row eye glyph + **Show all / Hide all / Reset** footer. It is
  **context-aware**: on the Schedule tab it lists `GRID_COLS`; on the Cost Loading tab it lists
  `COST_COLS` (driven by `activeTab`, set in `switchTab`). Hidden state persists in
  `localStorage.ps_colhidden` (keyed by label; `saveColHidden()`).
- **Cost Loading table is now dynamic** (was static HTML). `COST_COLS` defines label / num /
  locked / default width / `cell(r)` / `tot(T)` renderers; `renderCost()` builds `<colgroup>` +
  `<thead>` (with `.ps-colgrip` handles) + `<tbody>`, **skipping hidden columns** and applying
  persisted widths (`localStorage.ps_costcols`, `startCostColResize`). Table is `table-layout:fixed`;
  the totals row now emits one cell per visible column (no colspan) so hide/resize line up.
- **Gantt-only layout keeps the columns**: `.ps-split.ps-gantt-only .ps-grid-pane` no longer
  `display:none` — it stays as a compact (300px default) **resizable + hideable** activity-column
  table beside the bars (Primavera-style). Drag the divider / hide columns for a leaner view.
- **Export honors hidden columns**: `exportExcel(includeHidden)` filters out headers whose grid
  column is hidden (`EXP_TO_GRID`/`expHeaderHidden`); % and ₱ number formats + column widths are
  resolved by header NAME (so positions stay correct when columns are dropped). `downloadSchedule()`
  (wired to `#ps-download`) prompts "Include hidden columns?" only when an exportable column is
  hidden, else exports directly.
- Module page `?v=` bumped to **20260707** (icons.js changed — shared asset, cache-busted).

## Scheduling (2026-07-06) — Reschedule dependent activities (relationship-driven dates)
The CPM forward pass (`cpmLogic`) computes each activity's early start/finish (`_es`/`_ef`,
day offsets from `_cpmBase`) honoring FS/SS/FF/SF + lag, actual dates, the data date, and
Retained-Logic/Progress-Override — but historically only used them for critical-path highlight.
`applyScheduleDates()` now WRITES those back so a successor's Start/Finish moves when a
predecessor's (actual or planned) dates change. Rules: completed activities (actual finish) keep
their dates; started-but-unfinished keep their Start (actual-pinned) and only Finish moves;
milestones snap to `_es`. `_ef` is start+duration (one past the inclusive last day) so finish =
`off(_ef - 1)`. Bulk-writes in chunks of 40 via direct `update().eq('id')`, updates local rows,
then `rebuild()/computeCPM()/renderAll()`; confirms first and is not per-step undoable
(`resetUndo()`). Wired into the **Schedule** dialog: a **"Reschedule dependent activities"**
checkbox (`#ps-dd-resched`, persisted `localStorage.ps_resched`, state `reschedOn`); `scheduleNow()`
runs `computeCPM()` then, if checked and `mode==='logic'`, calls `applyScheduleDates()`. Without
relationships it warns instead (nothing to drive the moves). This is P6-F9-style manual reschedule
(explicit, not automatic on every edit) to avoid silently rewriting dates.

## Import (2026-07-06) — Predecessors + Successors columns (Excel/OPC)
`parseWorkbook` now detects BOTH the **Predecessors** (`cPred`) and **Successors**
(`cSucc`) columns of an OPC/Primavera Cloud `.xlsx` export. Relationships are stored
as `predecessors` text only (single source of truth); the CPM engine derives successors
as the inverse. To make the imported graph complete regardless of which column an edge
lives in, `mergeSuccessors()` (end of `parseWorkbook`) folds each row's Successors into
the target activity's predecessors — a successor edge `A→B` is identical to `B` listing
`A` as a predecessor. Merge is de-duplicated by Activity ID (`predIds`), so symmetric
exports add 0 duplicates. Verified on the Avesta 4PH file (4,578 activities): both
columns fully symmetric → 6,841 edges, 0 extra. No schema change (uses existing
`predecessors` column). OPC exports here use plain comma-separated IDs (no FS/lag);
`predRels` defaults those to `FS+0`.

## Schema additions (2026-07-06) — Working calendars
Run `../../migrations/2026-07-06-working-calendars.sql` (adds `project_schedule.calendar_id`
+ the new `calendars` table, owned by resource-loading). The Activity modal's
Calendar field is now a dropdown into `calendars` instead of free text. The
FTE/Max-Availability histogram (`resCapacity`, Resource Usage tab) was rewritten
to use each resource's *actual assigned calendar* (working-day pattern + hours/day,
via the shared `assets/js/calendar.js` `PDCal` helper — 6-day/8h Philippine
Standard by default, PH regular holidays computed automatically) instead of a
hardcoded 5-day Mon–Fri week. See `modules/resource-loading/CLAUDE.md` for the
calendar CRUD UI.

## Module design

**Three-tab layout (Primavera Cloud reference):**

- **Schedule tab** — WBS, Activity ID, Activity Name, Type, Status, Planned Start/Finish,
  Actual Start/Finish, Duration, % Complete (progress bar), Responsible Party, Edit/Delete
- **Gantt tab** — Oracle Primavera-style: frozen Activities column (Activity ID + name,
  WBS-indented) on the left + time-scaled bar chart on the right. Planned bars with a
  progress fill (% complete), green Actual bars (actual_start→actual_finish||today),
  milestone diamonds, WBS-summary brackets, month/year timescale, **Week/Month/Quarter
  zoom**, month gridlines, and a red **Data date** (today) line. Pure HTML/CSS — no libs.
  Respects the same Status/Type/Search filters. `renderGantt()` in the IIFE; `pdate/dDiff/iso`
  date helpers; `ganttZoom` + `PX_PER_DAY` control scale.
  - **Baseline (BL0) bar** (`.ps-bl`): drawn under each activity bar from `bl_start`/`bl_finish`.
    Restyled 2026-07-06 for visibility — was a 5px hollow light-gray (`#9a9a9a`) outline that was
    effectively invisible; now an **8px solid blue bar** (`--ps-bl` `#2F6FB0` light / `#5AA0E6` dark)
    with a subtle border + shadow. Legend swatch (`.lg-bl`) and the Gantt color-picker default
    (`COLORDEFS` `bl` = `#2F6FB0`) updated to match. Blue was chosen to stay clear of the red
    progress fill / amber critical-path outline.
  - **Relationship (FS/SS/FF/SF) lines**: drawn in `renderWindow()` as an absolutely-positioned
    SVG overlay (`.ps-deps`, arrow marker `#ps-arrow`) from each visible task's `_relObjs`. Anchored
    on the correct bar edges per type (SS/SF leave the start edge, FF/SF arrive at the finish edge),
    with an origin dot + a type/lag label (non-FS). Only edges whose BOTH endpoints are in the
    rendered window draw (same as critical-path lines). **Toggle:** the toolbar **`#ps-deps`** button
    (arrow icon, next to Critical Path) controls visibility via `depsOn` (persisted in
    `localStorage.ps_deps`, **default ON**). The draw block runs when `critMode || depsOn`, so
    imported dependencies now show WITHOUT turning on Critical Path (previously they were gated behind
    `critMode` only — the reason imported FS/SS/FF/SF links didn't appear on the Gantt).
- **Cost Loading tab** — WBS, Activity Name, Planned Cost, Actual Cost, Earned Value,
  Cost Variance, CPI, % Complete — with TOTALS row

**KPI cards:** Overall % Complete, Completed count, In Progress count,
Planned Cost / Actual Cost, CPI (green/red), SPI (green/red)

**Filters:** Status, Activity Type, text search across WBS / ID / Name / Responsible Party

**Modal fields:** WBS Code, Activity ID, Activity Name, Activity Type, Status,
Planned Start, Planned Finish, Actual Start, Actual Finish, % Complete,
Responsible Party, Planned Cost, Actual Cost, Earned Value, Predecessors, Remarks

**Predecessors activity picker (2026-07-06):** below the free-text `#ps-f-pred` field, a picker
row (`#ps-pred-search` datalist of `ID — Name` for all leaf activities, `#ps-pred-type` FS/SS/FF/SF,
`#ps-pred-lag` days, `#ps-pred-add`) lets the user **select an activity from the schedule** instead
of typing the Activity ID. `setupPredPicker(row)` (called from `openForm`) rebuilds the datalist
(excludes the current activity + WBS summaries, sorted numeric by ID), and Add appends a
`predRels`-parseable token (`ID [type][±lag]`, FS omitted unless a lag is set) to `#ps-f-pred`,
de-duplicated by ID (via `predIds`), rejecting self-links and unknown IDs. The text field is kept
as the source of truth (typing + CSV/XER import unchanged); the picker only appends to it.

---

## Activity Progress — view transition + configurable chart builder (2026-07-21)

**Transition:** switching into/out of the Activity Progress view now fades/slides in
(`@keyframes ps-viewin`, `.ps-anim` on `.ps-progress`/`.ps-split`/`.ps-network`).
`_animIn(el)` reflow-restarts the animation; `setProgressMode(on)` triggers it on toggle.

**Chart builder** (replaces the fixed pie). The presentation toggle is now **Table / Chart**.
In Chart mode a control bar exposes:
- **Chart type** (`#ps-chart-type`): Pie, Pie (hollow core / donut), Column, Horizontal bar,
  Stacked column, Stacked bar. Types listed in `CHART_TYPES`.
- **X-axis category** (`#ps-chart-cat`): Activity / WBS / Status (`CHART_CATS`).
- **Y-axis series** (`[data-series]` checkboxes): any of Activity % Complete (`phys`),
  Planned Value % (`plan`), Duration % Complete (`durpct`) — multiple = planned-vs-actual
  comparison. Defined in `CHART_METRICS` (label + color + `val(row)`).

Config persisted per project in `localStorage ps_chartcfg = { <pid>: {type,cat,series[]} }`
via `chartCfg()`/`setChartCfg(patch)`. Activity data-selection checklist (`.ps-pie-chk`,
All/Clear) still filters which leaf activities feed the chart (reuses `progSelSet`/`setProgSel`).

**Multiple independent resizable charts (2026-07-21b):** the Chart mode is now a **workspace**
(`.ps-chart-ws`, large wrapping grid) holding any number of chart **cards**, each fully independent.
Storage moved to `localStorage ps_charts = { <pid>: [ {id,type,cat,series[],sel,w,h}, … ] }`
(`chartsList()`/`setCharts()`/`chartById()`/`updateChart(id,patch)`/`addChart()`/`removeChart(id)`;
legacy `ps_chartcfg` auto-migrated to the first card). Top bar = Table/Charts toggle + **+ Add chart**.
Each card (`_chartCard(cfg)`) has its own toolbar: type select, X-axis (By Activity/WBS/Status),
Y-series swatches, a **Data ▾** toggle opening a per-card activity checklist (`_chartDataPanel`,
`.ps-cchk`, All/Clear — `sel` array per card, null = all), and a **✕** delete. Bottom-right
**resize handle** (`.ps-chart-res`) drag-sets the card width + body height (persisted live). SVGs use
`preserveAspectRatio` + `.ps-chart-svg{width/height:100%}` so they scale to the card. Edits redraw
only the affected card in place (`_redrawCard`/`_wireChartCard`, Data-panel open state kept in
`_openData`) — no full-view rerender, so resizing/tweaking one chart never disturbs the others.
`_chartBuckets(cfg)` now filters by the card's own `cfg.sel` instead of the shared selection.

Rendering: `_chartBuckets(cfg)` groups selected leaf activities by category and means each metric;
`_pieSVG(buckets,metric,hollow)` (donut = center hole), `_barsSVG(buckets,cfg,horizontal,stacked)`
(grouped or stacked, 0–100 grid, rotated category labels). Pie/donut use the first series only
(note shown when >1 selected). `renderProgressChart()` dispatches by type; `wireProgCtrls` handles
the type/category selects + series checkboxes (keeps ≥1 series). Back-compat: old stored
`ps_progpres='pie'` maps to `'chart'`.

**Chart cards — data labels, moving, dark-mode text (2026-07-21c):**
- **Pie/donut data labels:** each pie card gets a **labels** select (No labels / % of total /
  Value % / Category / Category + %), stored per chart as `labels`. `_pieLabel(mode,d,frac)` +
  `_pieSVG(…,labelMode)` draw label text at the slice centroid (only for slices > 4%);
  `.ps-pie-dl` = white glyph + dark outline (`paint-order:stroke`) so it reads on any slice
  colour in either theme.
- **Move the whole box:** a grip handle (`.ps-chart-grip`) makes the card `draggable`;
  HTML5 drag-and-drop reorders cards in the workspace via `moveChart(id,toIdx)` + `_dragCard`
  (`.ps-card-drag`/`.ps-card-over` visuals).
- **Move the chart inside the box:** dragging inside `.ps-chart-body` pans the `.ps-chart-pan`
  wrapper (persisted `ox`/`oy`); double-click recenters. Cursor grab/grabbing.
- **Dark-mode text fix:** SVG axis/label text used the **undefined** `--pd-ink-soft` var (fell back
  to black → invisible on dark). Switched all SVG text fills to `var(--pd-muted)`; legend/notes
  already inherit `--pd-ink`. (`--pd-ink-soft` does not exist in dashboard.css — only
  `--pd-ink/-muted/-line/-bg/-card` remap under `html.pd-dark`.)
- Resize (bottom-right `.ps-chart-res`) unchanged and still per-card/persisted.

**Chart cards — Excel-like formatting (2026-07-21d):** each card gained a **⚙ options** panel
(toggle `.ps-chart-settog`, open-state in `_openSet`, `_chartSettingsPanel`) exposing:
- **Chart title** (`title`) — rendered centered above the plot at `titleSize` px.
- **Axis titles** — `xTitle` / `yTitle` drawn on the bar/column axes (rotated Y); margins grow
  to fit them.
- **Font sizes** — `titleSize` (chart title), `tickFont` (axis tick labels), `titleFont`
  (axis titles), `dlFont` (pie data labels); all resizable 6–48 px.
- **Element toggles** — `legend` (pie inline legend / bar series legend `_seriesLegend`) and
  `grid` (bar/column gridlines) hide/show.
- **Series colours** — colour pickers for Actual / Planned / Duration write **project-scoped**
  `ps_seriescolor` (`seriesColor`/`setSeriesColor`) shared by the charts AND the Activity
  Progress **table bars** (`_progBar` now inlines them) — per the request, recolouring is
  limited to those two features. `chartColor(cfg,m)` allows a per-chart override (`cfg.colors`)
  over the project colour; the toolbar swatches + bar fills use it. Changing a colour
  re-renders the whole workspace (panels reopen from `_openData`/`_openSet`).
- `_barsSVG` rewritten around margins (mL/mR/mT/mB) so axis titles/fonts/gridline toggles all
  compose; `_pieSVG(buckets,cfg)` now reads legend + dlFont from cfg.

**Chart cards — activity label field (2026-07-21e):** each chart's ⚙ options panel gained an
**Activity label** select (`catField`: `both` / `id` / `name`) controlling how activities are
labelled everywhere the chart shows them — axis category labels, pie/donut slice legend, and
data labels. Default `both` = "ID  Name"; `id` = Activity ID only; `name` = Activity name only
(each falls back to the other when its field is blank). Applied in `_chartBuckets` for the
Activity X-axis; wired via the generic `.ps-cset-f` handler. Persisted per chart in `ps_charts`.

## Merge to main + verification (2026-07-22)

Merged branch `module/project-schedule` (commit a1292e1, "Excel-like configurable
chart builder in Activity Progress") into `main` via a no-ff merge commit (7b9fc4e).
Branch was 74 commits behind main and both `index.html` and this `CLAUDE.md` had also
been heavily edited on main since the merge base, but git auto-merged with **no
conflicts**.

**Verification:** served locally (python http.server) and loaded the module in-browser —
scripts executed cleanly and performed the Supabase auth redirect with **zero console
errors**. Static checks: no conflict markers; inline JS (~668K chars) passes
`node --check`; both the new chart-builder code and main-branch code present. Logged-in
visual render not verified (auth wall / no credentials) — recommend a manual eyeball of
Activity Progress once signed in.

## Arrow-key row selection with Excel-like autoscroll (2026-07-22) — fmlozano

The grid had click / shift-click / ctrl-click row selection but no keyboard navigation. Added
Excel-style arrow-key row selection to the Schedule grid:
- **↑ / ↓** move the active row selection to the previous / next visible display-list (`DL`) row;
  **PageUp / PageDown** jump one viewport of rows (`_gridPageRows()` = floor(viewport/ROWH)−1);
  **Home / End** jump to the first / last row. **Shift** + any of these extends the multi-row
  selection from the anchor (reuses `_selRange`/`_selSet`/`_selAnchor`).
- `moveRowSel(delta, extend, absolute)` computes the target index in `DL`, **skips id-less group
  headers** in the direction of travel, sets `selId` + `_selSet`, then autoscrolls and re-highlights
  + `renderDetails()`.
- **`scrollRowVisible(idx)`** is the Excel-like minimal autoscroll: pins the row to the **top** edge
  when it moved above the viewport, to the **bottom** edge when below — unlike `scrollSelIntoView`
  which re-centers. Works with the virtualized grid (setting `scrollTop` fires the scroll listener →
  rAF → `renderWindow`, which repaints the window and re-runs `highlightRow`).
- Wired into the existing grid keydown handler (same guards: suppressed while editing a field, over a
  modal, when the Schedule view is hidden, or view-only/archived). Documented in the ？ shortcuts modal.
- Verified: inline JS passes `node --check`; module loads in-browser with no console errors. Live
  keyboard interaction needs a login (auth wall). Module-only, no migration, no `?v=` bump.

## Horizontal active-cell navigation — arrows / Tab / Enter (2026-07-22b) — fmlozano

Extended the arrow-key work above into a full Excel-style active-cell cursor on the Schedule grid:
- **← / →** move the active cell one column left / right (clamped to the visible columns).
- **Tab / Shift+Tab** move to the next / previous cell, **wrapping to the next / previous row** at the
  row ends (`_nextRowIdx` skips id-less group headers; the row selection + details panel sync when a
  wrap changes rows).
- **Shift+← / →** extend the cell rectangle from the anchor (`_cellSel`), complementing the existing
  Shift+click range and Shift+↑/↓ row-extend.
- **Enter / F2** begin inline editing of the active cell (`editActiveCell` → `beginEdit`, only for
  `.ps-editable` columns).
- **↑ / ↓** now also **preserve the active-cell column** (Excel column-persistence) and paint the
  active cell, so vertical + horizontal navigation share one cursor.
- `moveCell(dc, tab, extend)` seeds the cursor from `selId` (or the first real row) on first press;
  `scrollCellVisible(r,c)` is the horizontal autoscroll (reveals the target column via the rendered
  cells offsetLeft/offsetWidth; frozen sticky columns are always visible so only non-sticky cells
  scroll). Deferred one rAF so a Tab-wrapped row is painted before the cell is scrolled/highlighted.
- Wired into the grid keydown handler (same guards); shortcuts modal updated.
- Verified: inline JS passes `node --check`; module loads with no console errors. Live keyboard test
  needs a login. Module-only, no migration, no `?v=` bump.

## Enter/Tab commit-and-advance in the inline cell editor (2026-07-22c) — fmlozano

Excel-style commit navigation from within an active inline cell edit (`beginEdit`):
- **Enter** commits the edit and moves the active cell **down one row** (Shift+Enter up), keeping
  the column — via `moveRowSel(±1, false)`, which preserves the `_cellAnchor` column.
- **Tab** commits and moves to the **next cell** (Shift+Tab previous), wrapping across rows — via
  `moveCell(±1, true, false)`.
- **Escape** still cancels without advancing.
- The move runs right after `inp.blur()` triggers `commit()`. `commit()`s DB write is async, so
  `selId`/`_cellAnchor` advance immediately and the later re-render (`persist().then` → `renderGrid`
  → `renderWindow`/`highlightRow`) re-highlights by id — correct even if a date/cost edit reorders
  rows. Advance lands in ready (not editing) mode, matching Excel.
- Shortcuts modal updated (Editing section). Verified: inline JS passes `node --check`, module loads
  with no console errors. Live keyboard test needs a login. Module-only, no migration, no `?v=` bump.

## Excel type-down-a-column entry anchor + type-to-edit (2026-07-22d) — fmlozano

Completes the Excel data-entry flow on the Schedule grid with an **entry-column anchor** (`_entryCol`):
- Editing a cell anchors the column the current row-entry began in. **Tab** walks across columns
  keeping the anchor; **Enter** commits, drops to the next row, and **returns to the anchor column**
  (classic Excel type-a-row-then-Enter-back-to-start). Enter with no Tab just goes straight down the
  same column. Shift+Enter goes up.
- **Type-to-edit:** pressing a printable key on a ready (selected, not-editing) editable cell now
  **begins editing seeded with that character** (text cells and numeric-compatible chars on number
  cells; date cells just open) — so you can keep typing down/across without F2 each time.
- **Ready-mode Enter** now moves down (at the entry column) instead of opening the editor; **F2**
  (or double-click, or typing) opens the editor — matching Excel.
- The anchor is **reset** by any non-entry navigation (arrows, PageUp/Down, Home/End, mouse click via
  `_setCellFromClick`, Escape) so the next fresh edit re-anchors; Tab/Enter preserve it.
- Implementation: `_entryCol`/`_resetEntry()`; `beginEdit` sets `_entryCol` when null; the in-edit
  Enter and ready-mode Enter set `_cellAnchor.c = _entryCol` before `moveRowSel`; type-to-edit lives
  in the grid keydown handler after the `?` branch (so `?` still opens shortcuts).
- ⚠️ **Known minor race:** type-to-edit opens the editor on the current DOM; a still-in-flight prior
  `persist().then → renderGrid` could repaint and drop that just-opened input if the next keystroke
  lands before the async write returns. Pre-existing for any fast edit-then-edit; acceptable for
  normal-paced entry. A render guard (skip re-render while an input is open) is the follow-up if it bites.
- Shortcuts modal updated. Verified: inline JS passes `node --check`, module loads with no console
  errors. Live keyboard test needs a login. Module-only, no migration, no `?v=` bump.

## Render guard: defer repaints while an inline editor is open (2026-07-22e) — fmlozano

Fixes the documented type-to-edit keystroke race from 22d. A still-in-flight `persist().then →
renderGrid` (or any scheduled repaint) could replace `#ps-grid-rows` innerHTML and destroy a
freshly opened inline `<input>`, dropping a keystroke during fast type-down entry.
- New **`_editing`** flag: set true in `beginEdit` right after the input is appended, cleared at the
  **top of `commit()`** (so it is false the instant the editor starts closing).
- **`doRender()` and `renderWindow()`** both early-return while `_editing`, setting **`_pendingWin`**
  instead of repainting — so neither the grid rows nor the Gantt bars layer (`#ps-tl-bars`, cleared in
  doRender) get wiped under an open editor.
- The closing editor **flushes** the deferred paint: `commit()` clears `_editing` then, if
  `_pendingWin`, calls `scheduleRender()`. Guaranteed even on a failed save (whose branch skips its
  own `renderGrid`). `_rafP` dedups the flush against the branchs own render within a frame.
- Correct because the edited value is read synchronously in `commit` before any repaint; the flush
  repaint (and the branchs own `.then` render) run after, on fresh `rows`. Arrow/click nav cant
  reach here — the global keydown returns early while focus is in the input, so the editor only closes
  via blur/Enter/Tab/Escape, all of which run `commit`. No stuck-`_editing` path.
- Verified: inline JS passes `node --check`, module loads with no console errors. Live keyboard test
  needs a login. Module-only, no migration, no `?v=` bump.

## LIVE verification of the keyboard navigation — found + fixed a hidden-column bug (2026-07-22f) — fmlozano

First signed-in run of the 22a–22e keyboard work, driven in the owners logged-in Chrome against the
deployed site on the real **4PH Jab Greenwoods Dasmariñas** project (17,122 activities).
- **Verified working live** with real key events (DOM-inspected after each): active cell set by click
  (row 2 / col 0 / "A227380"); **↓×3** moved rows 2→5 with the **column held at 0** (column
  persistence) and the row selection following; **→×3** moved col 0→3 with the row unchanged;
  **Tab×6** moved col 3→9. Deployed build confirmed to contain every new symbol.
- **BUG FOUND (now fixed): navigation stepped into HIDDEN columns.** That project hides 6 of its 19
  grid columns (indices 11–16 → `display:none`, width 0 — the cost/IBB block). `moveCell` walked raw
  column indices, so ←/→/Tab marched the cursor through zero-width invisible cells: measured the
  active cell at `offsetLeft 0 / width 0 / text ""` after Tabbing past column 10. The user would press
  → and watch the active-cell box vanish for six presses.
  **Fix:** `_colShown(ci)` (reads the same `colHidden`/`colKey` source of truth as the Columns chooser
  and `applyColHidden`s nth-child rules) + `_nextVisCol`/`_firstVisCol`/`_lastVisCol`; `moveCell`
  now steps to the next VISIBLE column (Tab wrap uses first/last visible; arrows stay put when there
  is no further visible column), and `moveRowSel` snaps to the first visible column if the preserved
  one is hidden. Shipped + deployed.
- ⚠️ **Environment blocker for the rest.** Chrome sits BEHIND the Claude app, so the tab is
  `visibilityState:"hidden"` → **rAF never fires** (measured: no callback in 1.2s) and the renderer is
  throttled hard enough that `Page.captureScreenshot` times out. Since `scheduleRender`/`doRender` and
  `scrollCellVisible` are rAF-gated, a reload in that state paints **0 rows** (the `_rafP` latch is set
  by a render that can never run). Same caveat already documented for the WBS virtualization work.
  Swapping `window.requestAnimationFrame` for a `setTimeout` shim revives the paths, but only if
  installed BEFORE module init — not achievable post-navigation.
- **Still unverified live, needs Chrome focused + a scratch project** (must not write to a real
  17k-activity schedule): horizontal autoscroll (`scrollCellVisible`), Enter/Tab commit-and-advance,
  the `_entryCol` type-down anchor, type-to-edit, and the `_editing` render guard.

## Signed-in verification on XERTEST — 3 bugs found + fixed, all behaviours confirmed (2026-07-22g) — fmlozano

Full keyboard/entry verification driven in the owners logged-in Chrome against the deployed site,
on the **XERTEST** sandbox (the safe venue — the earlier pass deliberately refused to write to the
real 17k-activity project).

**Bugs found by this pass, each fixed + redeployed + re-verified:**
1. **Navigation stepped into HIDDEN columns** (`4f8661c`). XERTEST/4PH hide 6 of 19 columns
   (`display:none`, width 0). `moveCell` walked raw indices, so →/Tab parked the cursor on invisible
   cells (measured `offsetLeft 0 / width 0 / text ""`). Fixed with `_colShown`/`_nextVisCol`/
   `_firstVisCol`/`_lastVisCol` off the same `colHidden` source of truth as the Columns chooser.
   **Re-verified: col 10 → 17, skipping 11–16.**
2. **In-edit Enter/Tab moved TWICE** (`11e6551`). `inp.blur()` switches `document.activeElement` to
   `<body>` synchronously, so the keystroke kept bubbling to the document-level grid handler whose
   "focus is in an INPUT → bail" guard no longer matched — the move ran twice (**Enter skipped 2 rows
   (4→6), Tab skipped 2 columns (1→4)**). Fixed with `e.stopPropagation()` on the editors
   Enter/Tab/Escape. **Re-verified: Enter 4→5, Tab×2 = col 1→3.**
3. **Closing editor left an orphaned `<input>`** (`86d2ea1`). `commit()`s per-branch renders are
   conditional (`if (ok) renderGrid()`), so a no-op/failed persist skipped the repaint and left the
   input sitting in the cell with blank text — newly visible now that Tab/Enter navigate away from it.
   `commit()` now always `scheduleRender()`s. (Pre-existing; only surfaced by the new navigation.)

**Verified PASSING live:** click sets active cell · ↓×3 rows advance with the column held · →×3 ·
Tab×6 · **hidden-column skip** · **horizontal autoscroll** (`scrollLeft` 0→504) · **render guard**
(input survived 6 forced repaint cycles as the SAME DOM node with its uncommitted value intact) ·
**Escape cancels with no write** · **entry-column anchor** (Enter from col 3 returned to col 1 on the
next row) · **single-step Enter/Tab** · **type-to-edit** (typing `z` opened an editor seeded with `z`,
focus in the input).

**Data integrity confirmed by direct Supabase query** (not just the DOM): `project_schedule` in
XERTEST has **0 rows named `z`**, and the row whose editor was Tab/Enter-committed still holds its
original `activity_name` ("Start of Precast Production") — the commits wrote the unchanged value back,
nothing was corrupted. No writes at all reached the real 4PH project.

⚠️ **Environment notes for the next person automating this.** Chrome sits behind the Claude app, so the
tab is `visibilityState:"hidden"` → **native rAF never fires** and `Page.captureScreenshot` times out.
Workaround: overwrite `window.requestAnimationFrame` with a `setTimeout` shim (the module reads it at
call time via `(window.requestAnimationFrame || fallback)(fn)`, so a post-load swap works). ⚠️ But if
any `scheduleRender()` latched `_rafP = true` under the NATIVE rAF before the shim, that latch never
clears and every later `scheduleRender` no-ops — the grid then paints 0 rows and commits appear not to
repaint. The scroll path (`onVScroll`, own `winRaf` guard) still repaints and can be nudged with a
synthetic `scroll` event. Both are automation artifacts, NOT product defects.

## Phone read-only activity list (2026-07-23)

Below **700px** the grid+Gantt split is hidden outright (`.ps-split`, `.ps-divider`, `.ps-toolbar`,
`.ps-legend`, `#ps-details` all `display:none`) and replaced by **`#ps-mobile`** — a condensed
**read-only** activity list painted by `renderMobile()`. Rationale: this module is an 18-column
virtualized grid beside a time-scaled Gantt with Excel-style keyboard navigation and drag-to-link;
none of that survives a 375px touch screen, and the owner chose a read-only field view over
pan-and-zoom.

- **Same data path, different presentation.** `renderMobile()` reads `displayList()`, so the active
  search / filters / grouping / collapse state all carry over. It renders only `_dkind === 'task'`
  nodes (WBS summary rows are skipped) as cards: Activity ID, status pill (derived the same way as
  the grid — `isComplete()` → Completed, `actual_start` → In Progress, else Not Started), name,
  Start / Finish / % Complete / Float, and a progress bar. Critical-path activities get a red left rail.
- **Deliberately read-only** — no edit, drag, link or keyboard handlers are wired to these cards.
- ⚠️ **`PS_M_CAP = 300` is a real guard, not a nicety.** This list is **not virtualized** (the desktop
  grid is), and projects here reach 17k+ activities — painting every card would lock up a phone. Over
  the cap it renders the first 300 and tells the user to narrow with search/filters. Only raise it
  together with virtualization.
- `renderAll()` calls `renderMobile()` only when already at phone width; a debounced `resize`
  listener repaints on the way in, so rotating from desktop into phone can't reveal an empty pane.
- **Verified** at 375px against the module's real stylesheet: cards 351px wide with no page-level
  horizontal scroll, 4-column meta grid with no cell overflow, correct status colours
  (muted/amber/green), red rail on critical-path only, progress fill exact (45% → 0.45), toolbar
  hidden. At 1280px **desktop is unchanged** — mobile list `display:none`, split `flex`
  (grid 660px + Gantt 588px), divider and toolbar visible.
- ⚠️ **Verification gap, stated plainly:** `renderMobile()` was **not** exercised end-to-end against
  loaded rows. The harness stubs could not satisfy this module's `load()` path (RPC → keyset
  fallback), so it rendered its genuine empty state and the card branch was verified by injecting
  `renderMobile()`'s exact template against the real CSS. The data binding itself rests on
  `node --check` plus confirming every helper it calls (`esc`, `dispStart`, `dispFin`, `isComplete`,
  `displayList`, `Fmt.date`) exists. **Worth a signed-in pass on a real project.**

### 2026-07-23 — Schedule Builder view (bottom-up / location-based setup)
- Added a **Schedule Builder** view to the title-switcher (between Project Schedule and Cost/EVM):
  a 5-step wizard implementing the planning team's whiteboard flow (steps 1–7). Steps: **Activities**
  (class-code list — code/name/group ST·AR·OTHER/required duration, drag to reorder = trade sequence)
  → **Floors & Zones** (Location Breakdown) → **Zone sequence** (drag; default floor×zone) →
  **Scope per zone** (location×activity checkbox matrix, stored inverted as `scopeOff`) →
  **Generate** (sequential FS chain through locations from a start date → KPIs, duration-per-zone
  bars, grouped preview, CSV export; "Push to Project Schedule" is a stub for the next milestone).
- Code: a self-contained `ScheduleBuilder` closure with its OWN helpers (`e2`/`pdd`/`iso2`/`render`/
  `load`/`save`/`generate`…) so nothing collides with the module's same-named functions. Reads the
  module's live `pid`/`UID`. Wired via `switchTab('builder')` (view `#ps-view-builder`, rail
  `#ps-bld-rail`, panel `#ps-bld-panel`) + a `renderAll` hook so switching project while on the tab
  reloads it. `.sbld-*` CSS added to the module `<style>`.
- Storage: one jsonb `config` per project in **`schedule_builder`** — migration
  `migrations/2026-07-23-schedule-builder.sql` (**USER MUST RUN**; project-scoped RLS, read
  `can_access_project` / write `is_writer()`+`can_access_project`). Save/load show a "run migration"
  toast until applied. Icons: drag grip is the text glyph ⠇ (no `menu` in icons.js); Save uses `check`.
- **Standalone `modules/schedule-builder/` was removed** — this integrated view supersedes it.
- Verified: inline JS parses (`node --check`); loads with no console errors (auth gate blocks the
  click-through). Not yet exercised signed-in.

### 2026-07-23 — Schedule Builder: per-trade zoning + tower visual + Gantt link canvas
- **Trades expanded** to ST · AR · MEPF · Allied · Other (`GROUPS`/`GLABEL`/`GCOLOR`); step-1
  activity group select uses them.
- **Step 2 rebuilt — per-trade, per-floor zoning.** Trade chips select the trade being edited;
  per trade you add floors (drag to reorder) and set each floor's zone count (± stepper, zones
  auto-name Z1..Zn), or bulk "Quick: N floors × M zones". A **tower/high-rise SVG visual**
  (`towerSVG`) renders the selected trade's floors stacked (ground at bottom) with zone cells in
  the trade colour. Model: `config.zoning[trade].floors[].zones[]`.
- **Step 3 rebuilt — Gantt link canvas.** Every zone(-trade) is a bar (length = its trade's
  day-sum); drag the dot on a bar's right edge onto another bar to create a finish-to-start link
  (`addLink`, with cycle guard via `reaches`); click a connector to remove it. Bars slide to the
  longest-path earliest start (`computeStarts`). Auto-chain / Clear links buttons. Self-contained
  SVG + a single document-level mouseup (`upWired`) resolving the drop target by `elementFromPoint`.
- **Step 4 (scope)** now renders one matrix per trade (that trade's locations × its activities);
  `scopeOff` keyed by `locUid|activityId` where `locUid = trade/floorId/zoneId`.
- **Step 5 (generate)** iterates per-trade locations, offsets each by its link-derived start, and
  FS-chains that trade's activities within the location; per-zone bars coloured by trade.
- Config model changed (`zoning`+`links` replace flat `floors`/`zones`/`sequence`) — same
  `schedule_builder` table/jsonb; old flat configs are ignored by `normalize` (feature is new).
- Verified: inline JS parses (`node --check`); scheduling math (longest-path starts, total, cycle
  guard) unit-checked in Node; module loads with no console errors. Not yet exercised signed-in.

### 2026-07-24 — Schedule Builder step 3: Start/End milestones + auto-traced interphase logic
- **Start & End nodes** added to the link canvas: a green **START** milestone (top row) and a red
  **END** milestone (bottom row, at the project's longest-path end). START has a source handle;
  END is a terminal drop target. Both are valid link endpoints (markers, 0 duration — they bookend
  the network without affecting timing). `Auto-chain` now also links Start→first and last→End.
- **Auto-trace of construction logic.** New helpers `locKeyOf` (floor+zone), `tryLink` (dedupe +
  cycle-safe), `traceInterphase`, `autoTrace`. When you draw a link between two zones **at the same
  location** (same floor+zone across trades), the builder auto-chains the remaining trades there in
  order **ST → AR → MEPF → Allied → Other** — the structural→architectural→MEPF interphasing.
  A new **Auto-trace logic** button builds it for the whole building: interphase every location's
  trades, then bookend Start→sources and sinks→End. All additions are cycle-guarded via `reaches`.
- Verified: inline JS parses (`node --check`); loads with no console errors. Signed-in click-through
  (drag-to-link firing the interphase trace, Start/End rendering) still pending — auth-gated here.

### 2026-07-24 — Schedule Builder step 3 redesign: takt floor-lead logic + tower-connect UI
- **Zone-sequence logic is now takt/location-based.** `autoTrace` rebuilds the flow from rules:
  (1) each trade climbs its own floors zone-by-zone (vertical progression), (2) a following trade
  stays a configurable **floor lead** behind the previous one — e.g. "Structure leads by 4 floors
  before the next trade starts" (Architecture on the ground floor can't begin until Structure is
  4 floors up), (3) bookended by Start → sources and sinks → End. New `cfg.floorLead` (default 4),
  editable inline in step 3. Helpers `floorsOf`/`zoneByCode`/`uidFor`/`floorAxis`. First cross-trade
  transition uses the lead; later ones stay 1 floor behind. Unit-checked in Node: with ST dur 2/floor
  and lead 4, AR ground start = day 8 (= 4 structural floors) — correct staircase.
- **Linking UI rebuilt as a tower + schedule split.** LEFT: a tower (floors stacked, ground at
  bottom; union of floor codes) where every zone is a clickable **node** grouped by trade and
  coloured by trade. Click a source node then a target to connect them (finish-to-start, with the
  same-location interphase auto-trace + cycle guard); the pending source is outlined. RIGHT: the
  **resulting schedule** (`scheduleSVG`) — read-only takt bars from the links with Start/End +
  arrows; click an arrow to remove that link. Replaces the SVG drag-handle canvas (drag-to-link).
- Verified: inline JS parses (`node --check`); takt scheduling unit-checked; module loads with no
  console errors. Signed-in click-through still pending (auth-gated here).

### 2026-07-24 — Schedule Builder: "Push to Project Schedule" hand-off (add + choose WBS)
- Step 5's **Push to Project Schedule** now actually writes the generated activities into the live
  `project_schedule` — **adds** to the existing schedule (never replaces). A modal asks which **WBS**
  to file them under (dropdown of existing WBS-Summary rows, or "Top level"), plus a checkbox to
  **organise into Trade → Floor → Zone sub-WBS** (on by default; off = flat under the chosen WBS).
- New builder fns `nextChildIndex(base)` (next free dotted-code child under a parent), `openPushModal`,
  `pushToSchedule(parentCode, grouped)`: builds WBS-Summary + Task payloads (dates + baseline from the
  takt result, unique `activity_id`s vs existing rows, `created_by=UID`), chunked-inserts to `TABLE`,
  then `switchTab('schedule')` + module `load()` to repaint the Gantt.
- Enabler: the builder's internal `load` was renamed **`loadCfg`** so it no longer shadows the
  module's schedule `load()` (needed to reload after the insert). `open()` updated accordingly.
- Verified: inline JS parses (`node --check`); loads with no console errors. Signed-in click-through
  of the actual insert still pending (auth-gated here).

### 2026-07-24 — Schedule Builder step 3: typed/lagged links, unlink, multi-link, narrow tower, zoomable/editable schedule
- **Relationship type + lag.** Links now carry `type` (FS/SS/FF/SF) + `lag` (days). A dialog
  (`openLinkDialog`) asks both whenever you connect two nodes; `computeStarts` honours them via
  `linkStart()` (FS/SS/FF/SF math, negatives floored to 0). Arrows on the schedule show a
  `TYPE±lag` label and anchor from the correct edge (start for SS/SF, finish for FS/FF).
- **Unlink + edit.** Click any arrow (or re-click a linked pair) to open the dialog with an
  **Unlink** button and editable type/lag (`linkOf`/`removeLink`). Removed the old auto-interphase-
  on-manual-link (surprising now that linking is explicit); the bulk logic stays in **Auto-trace**.
- **Multiple linking.** The source node stays selected after a link so you can fan out to several
  targets; **Done linking** / clicking the source again releases it.
- **Narrower vertical tower.** Zone nodes are compact fixed-width squares and floors are tighter, so
  the left pane reads as a stacked tower; the split is now ~270px tower : expanded schedule.
- **Zoomable, editable schedule.** Right pane uses a `seqZoom` px/day scale with − / + buttons;
  schedule **bars are clickable** (act as link source/target too, so you can wire relationships from
  the Gantt), and arrows are clickable to edit/unlink.
- Verified: inline JS parses (`node --check`); FS/SS/FF/SF + lag math unit-checked; loads with no
  console errors. Signed-in click-through still pending (auth-gated here).

### 2026-07-24 — Schedule Builder step 3: draggable tower/schedule split + scaling nodes
- Step 3 is now a **draggable split** (`.sbld-seq2` flex + `.sbld-seq2-grip` col-resize divider,
  width in `seqLeftW`): drag to give more room to the tower or the schedule. Min 150px tower,
  schedule keeps ≥260px.
- Zone **nodes now flex** to fill their (resizable) trade cell (`flex:1 1 22px; min 20 / max 72px`),
  so they grow when the tower pane is widened and shrink when narrowed — no longer a fixed tiny size.
- Verified: inline JS parses; loads with no console errors.

### 2026-07-24 — Fix: "Gantt only" layout did nothing when clicked

Owner: the Gantt-only layout view isn't working when clicked. **Reproduced and root-caused, not guessed.**
- **Cause: an inline style silently beat the stylesheet.** Gantt-only narrows the activities grid purely
  via `.ps-split.ps-gantt-only .ps-grid-pane { flex:0 0 300px }`. But the divider drag handler — and the
  `ps_grid_w` width it restores on every load — writes **`gridPane.style.flexBasis` inline**, and an
  inline declaration outranks any normal stylesheet rule. So the class was applied, the CSS was correct,
  and nothing moved.
- **Measured, with the module's real stylesheet:** fresh browser (never dragged, empty localStorage)
  660px → **300px**, works; after a drag (inline basis set) 660px → **660px**, dead. That's why it would
  have looked fine on a clean profile — every real user who had ever touched the divider had it broken.
- **Fix:** the width is now applied **imperatively** in `_applyGridPaneWidth()`, called from
  `applyLayout()`, and only on the **mode transition** — so a divider drag *while in* Gantt-only isn't
  snapped back on the next render. Leaving Gantt-only restores the user's saved `ps_grid_w`, or clears
  the inline value so the 660px stylesheet default returns when there is none.
- ⚠️ **Second, load-order half of the bug:** the divider's saved-width restore block runs **after**
  `applyLayout()` during init, so it re-clobbered the 300px for anyone whose persisted `ps_layout` was
  already `gantt` — Gantt-only would have been broken on page load even with the fix above. That restore
  now skips while `layoutMode === 'gantt'`.
- ⚠️ **Why not `!important`:** it would also win against the inline style, but it would then block the
  divider drag in Gantt-only mode — and that pane is deliberately meant to stay resizable there (the
  whole point of the 2026-07-07 "Gantt-only keeps the columns" change).
- **Verified in-browser** by extracting the **shipped** `_applyGridPaneWidth` out of `index.html` and
  running it against the module's real CSS — 5/5: Gantt-only narrows to 300px with a dragged width
  present; returning to Split restores the user's 660px; Grid-only still hides the Gantt pane; a drag to
  420px inside Gantt-only survives a re-render; with no saved width, leaving Gantt-only falls back to the
  660px CSS default. Inline script parses; module loads with no console errors (auth-gated here, so no
  signed-in click-through). Module-local, no migration, no `?v=` bump.

## Signed-in verification of the phone view (2026-07-25)

Closed the verification gap left when the phone list shipped: `renderMobile()` had never run against
real loaded rows. Checked on the deployed site, signed in, against **GPR101** (4PH Jab Greenwoods,
17k+ activities) and **OPW101** (One Portwood, 862 rows / 698 leaf activities).

**Confirmed working.** `renderMobile()` renders real rows correctly: 112 cards on GPR101's default
(collapsed) outline with 0 blank IDs, 0 blank names and 0 missing dates; status derivation matched the
data (20 Completed / 39 In Progress / 53 Not Started); 38 critical-path cards carried the red rail;
progress bars matched `percent_complete`. **`PS_M_CAP` verified live on OPW101** — expanding all gave
*"300 of 698 activities"*, exactly 300 cards, and the *"398 more activities not shown"* note.

**BUG FOUND AND FIXED — date overflow.** The real `Fmt.date` renders **"Feb 15, 2027"**, which measures
**80px** at the card's 12.5px meta font, but a meta column is only **~77px on a 375px phone** — it
overflowed. It fit at 390px by a single pixel, which is why nothing looked wrong at first glance. The
local harness had stubbed `Fmt.date` with a short form, so **this was invisible to harness testing and
could only surface against real data.** Fixed by using this module's own `fmtOPCDate` (DD-Mon-YY, 65px),
plus a 2×2 meta fallback below 380px. Re-verified live: max date width now 66px vs 77px available.

⚠️ **PERFORMANCE FINDING — not fixed, needs a decision.** The phone view hides the desktop UI with CSS
but **does not stop it being built**: `renderAll()` still runs `renderGrid()`, `renderGantt()`,
`renderCost()` and `renderDetails()` at phone width, and then `renderMobile()` on top — so a phone pays
for the desktop pipeline *plus* the card list. Measured on OPW101 (698 activities, desktop CPU):
`renderMobile()` alone is **~865ms median** (3 runs: 172 / 865 / 868), isolated by confirming a resize
with phone mode off leaves `#ps-mobile` untouched. On GPR101, clicking **Expand all** (17k activities)
**froze the renderer** — that test drove the desktop grid+Gantt rebuild simultaneously so the freeze is
not attributable to `renderMobile` alone, but it does show the combined cost is not phone-safe.
The cost is `displayList()`/`buildNodes()`, which sorts and filters every row — `PS_M_CAP` caps the
*cards painted*, not that traversal. **Recommended fix:** gate `renderGrid()`/`renderGantt()` on
`!psIsPhone()` inside `renderAll()` and repaint them when crossing back above 700px. Deliberately NOT
done here — `index.html` is under active concurrent development (the Schedule Builder view landed
mid-session) and restructuring `renderAll()` risks regressing the desktop path.

**Note on scope:** the phone block hides `.ps-toolbar`, which is a **shared** element sitting outside
`#ps-view-schedule` — so it is hidden for the Cost/EVM, Planner, WBS Manager and the new Schedule
Builder views too, not just the schedule. That is coherent with "read-only on a phone" (the toolbar is
all authoring controls), but it was not a considered decision for Builder, which arrived later.
`#ps-mobile` itself is correctly nested inside `#ps-view-schedule`, so it only appears on that view.

⚠️ **Method note:** the Chrome window could not be resized below ~1432px in this environment, so the
phone path was exercised by patching `window.matchMedia` (which `psIsPhone()` reads at call time) and
firing the module's own debounced resize handler. That verifies the **data binding and the cap against
live data**, which was the open gap; the **CSS presentation at a true 375px viewport** remains verified
only in the local harness.

## Render-pipeline fix for the phone view (2026-07-25)

Closed the performance finding from the signed-in check. The phone view hid the desktop UI in CSS but
still BUILT it: `renderAll()` ran `renderGrid`/`renderGantt`/`renderCost`/`renderDetails` at phone width
and then `renderMobile()` on top, so a phone paid for the full desktop pipeline plus the card list.
- **Fix (three coordinated changes):** `renderAll()` now returns after `renderMobile()` when
  `psIsPhone()`; `doRender()` (the single choke point every grid+Gantt build funnels through, also poked
  by scroll/edit/load-reconcile) bails to `renderMobile()` on phone as a safety net; and the debounced
  `resize` handler tracks `_psWasPhone` so crossing phone→desktop runs a full `renderAll()` to build the
  grid/Gantt that were skipped while phone.
- **Verified live, signed in** (deployed):
  - OPW101 (698 activities), phone mode, Expand-all: grid DOM stays unbuilt, list updates to "300 of 698",
    cap holds, no freeze.
  - **GPR101 (17,122 activities), phone mode, Expand-all: no freeze (~83ms to rAF), grid unbuilt, list
    "300 of 17122", cap holds.** This is the operation that appeared to freeze before.
  - Round-trip: desktop 380 grid cells → phone 112 cards → back to desktop **380 cells rebuilt**, split
    visible. Clean desktop reload renders normally (380 cells, 44 Gantt bars, real data). No console errors.

⚠️ **CORRECTION to the 2026-07-25 check entry above.** That entry said GPR101 Expand-all "froze the
renderer" and attributed it to the desktop render cost. **That was wrong.** Re-testing with the fix
deployed, the freeze reproduced *identically even with the grid build now skipped* — the actual cause is
the Expand-all handler's **blocking `window.confirm()`** (shown when `rows.length > 4000`): with no user
to dismiss it, the main thread blocks and CDP times out at 45s. It was never a render cost. The
`renderMobile`-alone ~865ms measurement on OPW101 stands (OPW is < 4000, no dialog), and the pipeline fix
is still a real improvement — a phone no longer builds the desktop grid at all — but the "17k froze the
renderer" claim was a mis-diagnosis of a modal dialog.

### 2026-07-24 — Schedule Builder step 2: optional Zone → Unit hierarchy (Trade → Floor → Zone? → Unit?)
- Recovered from a stray git stash-pop that left conflict markers on the stale `module/project-schedule`
  branch; re-applied this work cleanly on `main` (which already had the builder + typed links + resize).
- **Model:** each zone now has `units[]`. Leaves (`leavesOfFloor`/`locList`): a floor with no zones is a
  leaf; a zone with no units is a leaf; else each unit is a leaf. `locLabel` joins present codes;
  `cellKey`=zone#unit code for cross-trade matching; `floorIndexOf` for the takt index.
- **Step 2 editor** rebuilt as a nested per-floor card: floor code/name + **+ Zone**; each zone row has a
  **Units ± stepper** (0 = none) + delete; "Quick" now floors × zones × units. Tower visual nests
  floors → zones → units.
- **autoTrace** reworked to index leaves by (trade, floorIdx, cellKey) so the vertical climb + cross-trade
  floor-lead match by zone+unit. **Step 3 tower** nodes, **scope** matrix, and **Push-to-Schedule**
  grouping (Trade → Floor → Zone → Unit sub-WBS, each level optional) all leaf-aware.
- Verified: inline JS parses; leaves/cellKey unit-checked (2 floors × 1 zone × 2 units = 8 leaves,
  keys Z1#U1/Z1#U2); loads with no console errors. Change Order incorporation still pending (next).

### 2026-07-24 — Schedule Builder: bigger tower, centered steppers, relationships carried on push
- **Tower visual enlarged** (W 320→430, floor height 40→52, bigger fonts) and its column widened
  (minmax(400px,460px)); floor/zone/unit labels are more legible.
- **± steppers centered** (`display:inline-flex; align-items:center; justify-content:center`) and
  slightly larger; count font bumped.
- **Relationships carried into the pushed schedule.** `pushToSchedule` now assigns clean sequential
  activity ids (`SB1`, `SB2`… — dotted WBS codes would break the predecessor parser), chains each
  location's activities FS internally, and maps every zone→zone link (FS/SS/FF/SF + lag) onto the
  correct end-activities as `predecessors` tokens (e.g. `SB5+3`, `SB2 SS+2`, `SB9 FF-1`) — matching
  the module's `predRels` format. Start/End markers are skipped. So the generated CPM logic lands in
  the live schedule, not just the dates.
- Verified: inline JS parses; predecessor-token + leaves/cellKey logic unit-checked; loads with no
  console errors.

### 2026-07-24 — Data date badge restored, actual-duration fix, Activity-Progress collapse, per-project saved views
- **Data Date badge back in the header.** `renderDataDateBadge` targeted `#ps-datadate-badge`, but the
  element had been dropped from the topbar (only the CSS class remained) so it silently no-op'd. Re-added
  a clickable badge next to the tools cluster; clicking it opens the Schedule dialog to change the date.
- **Duration now updates on actualised finish.** The grid **Dur** column showed `_origDurOf` (planned/
  baseline span via `end_date`), so changing an actualised activity's finish never moved it. For a
  completed activity (has `actual_finish`) the Dur cell now shows the **actual span** (`actualDurLive` =
  actual finish − actual start + 1), read-only, updating live when the finish changes.
- **Activity Progress table: WBS collapsible** like the Gantt. Added ▼/► carets on WBS rows (toggle the
  shared `collapsed` map → `renderProgressView`) + **Expand/Collapse all** buttons in the table control bar.
  It already respected `hiddenRow`, so it inherits the schedule's default-collapsed depth too.
- **Saved layouts are now PER PROJECT and include the chart template.** `ps_views` re-keyed to
  `{ <pid>: { name: view } }` (`loadViews`/`saveViews`); a saved layout also captures the
  Activity-Progress **charts** (`chartsList()`) and `applyView` restores them (`setCharts`). Columns
  (hidden/order/widths/renames) + filters + grouping + zoom were already in a view. Tooltip updated.
- Verified: inline JS parses; module loads with no console errors. Change Order incorporation still pending.

### 2026-07-24 — Activity Progress chart: fix scroll reset when picking activities
- Ticking an activity in a chart card's Data checklist called `_redrawCard` (full card rebuild), so the
  checklist re-rendered and its scroll snapped to the top after every click. The `.ps-cchk` handler now
  updates only the chart body (`.ps-chart-pan` innerHTML = `_chartSVG(cfg)`) and the "Data (N)" count in
  place — the checklist DOM + scroll position are preserved, so you can tick multiple activities in a row.

### 2026-07-24 — Activity Progress chart: "Full labels" option (untruncated, scale with resize)
- Category/pie labels were truncated to ~14–16 chars with an ellipsis, so long activity/WBS names were
  cut off. Added a **Full labels** toggle to each chart's ⚙ settings (`cfg.fullLabels`). When on,
  `_pieLabel` and `_barsSVG` render the whole text; `_barsSVG` also reserves margin for it (horizontal:
  wider left margin `max(92, lblPx+10)`; column: extra bottom margin `lblPx*0.36`, `lblPx ≈ maxLabelLen
  × tickFont × 0.58, capped 280). Since chart SVGs scale to the card via viewBox, resizing the card
  bigger enlarges the full labels so the whole text is readable. Combine with the Data-label / Axis-label
  font-size controls already in the panel.

### 2026-07-24 — Planning logic: consistent duration recompute + contradiction errors on actual dates
- `_dateEditPatch` hardened so actualising / re-actualising dates keeps every duration field consistent
  and blocks contradictions with clear toasts:
  - **Actual Finish requires an Actual Start** ("an activity can't finish before it has started").
  - Actual Finish before Actual Start / after Data Date → error (kept, message improved).
  - **Actual Start can't be after an existing Actual Finish**, and you can't clear an Actual Start while
    an Actual Finish is set (reopen the finish first).
  - Re-actualising the finish recomputes Actual = finish−start+1, Remaining = 0, %=100, Completed;
    Planned + At-Completion are derived from these so they update on render. Clearing the finish reopens
    to In Progress, reseeds Remaining, and drops % below 100.
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — Schedule Builder: Internal vs External durations (per activity, generate both)
- Each activity now carries **two durations** — `durInt` (internal / target) and `durExt` (external /
  contract). Step 1's editor has Int./Ext. columns (legacy single `duration` auto-migrates into both).
- `nodeDays(loc, basis)` + `generate(basis)` take a basis (`'int'`|`'ext'`); `actDur(a, basis)` picks the
  field. Step 3's link canvas uses internal for its bar lengths (relationships are basis-independent).
- **Step 5 shows BOTH schedules side by side** (`_genPanel` × Internal/External): each with total
  duration, start, finish, duration-per-zone bars, and the grouped activity table — so you can compare
  the target vs contract finish dates. Separate CSV per basis.
- **Push** modal gained a "Schedule to push" select (Internal / External); `pushToSchedule(pc, grp, basis)`
  generates that basis before writing (relationships still carried).
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — WBS status pills, WBS selection highlight, dark-mode highlight, push relationships confirmed
- **WBS/summary rows now show a rolled-up status pill** (Completed / In Progress / Not Started). Counters
  (`done`/`prog`/`total`) added to the `_costMap` roll-up in `rebuild`; `_wbsStatusPill(code)` renders the
  pill in the WBS row's status cell (all done → Completed, any started/done → In Progress, else Not Started).
- **Clicking a WBS now highlights it.** Root cause: the WBS row's `--wl` shade on its frozen cells has
  higher CSS specificity than `.ps-row-sel`, so the selection tint was hidden. Added
  `.ps-grid-pane .ps-wbs-row.ps-row-sel > .c-num/.c-id/.c-name { background:var(--pd-red-light) }` (selId was
  already being set on WBS click).
- **Dark-mode highlight fixed.** `--pd-red-light` is a near-black maroon in dark mode, so the selection/
  spotlight barely read. Added `html.pd-dark` overrides using translucent red (`rgba(238,49,36,.22)`) for
  the selected row + frozen cells + Gantt sel-band, and a theme-neutral translucent blue
  (`rgba(37,99,235,.12)`) for `.ps-spotrow` (works in both light and dark).
- **Push relationships confirmed migrating.** `pushToSchedule` already maps each zone link (FS/SS/FF/SF +
  lag) onto the pushed activities' `predecessors` (SB-ids) and chains each location FS internally — verified
  the block is intact after the earlier git recovery. (Arrows show once Critical Path / relationship lines
  are toggled on.)
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — Schedule Builder: renamed trades + basements (substructure)
- **Trades** are now **Structural · Architectural · MEPF · Allied Services** (GLABEL/GROUPS updated;
  dropped the old 'Other'; ST/AR relabelled). Existing 'OTHER' zoning/activities normalise away
  (activities fall back to ST).
- **Basements / substructure.** Floors carry an optional `sub:true`. Step 2 gains a **+ Basement**
  button (inserts at index 0 = deepest, so takt builds bottom-up) and a **basements** field in Quick
  (`B bsmt + F flr × Z zn × U un`). Basement rows show a **BSMT** badge (dashed card, red header).
  The **tower** now splits at a **grade line**: superstructure above, basements below (dashed, lower
  opacity, labelled B1…deepest) with a "grade" marker.
- Verified: inline JS parses; module loads with no console errors. (Internal/External durations were
  already served — confirmed via curl; the "not reflected" was a stale browser cache → hard-refresh.)

### 2026-07-24 — Schedule Builder step 3 equal bars + step 1 row layout
- **Step 3 schedule bars are now equal-length, laid out by dependency rank** (`computeRanks` =
  topological depth) instead of day-length. Uniform 44px+ bars spaced by rank → always visible and
  easy to hit when connecting (previously 0-duration zones collapsed to tiny/overlapping bars). Zoom
  scales the bar width. Arrows/anchors unchanged.
- **Step 1 row rebalanced**: Activity Name shortened (`.sbld-actname`, flex 1 130 / max 220) and more
  room given to Trade (170px, now showing the full trade label) and Interior/Exterior durations (90px
  each). Header labels updated to Interior/Exterior.
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — Schedule Builder: activity template download/upload + robust step-3 nodes
- **Step 1 template import/export.** New **Download template** (CSV: Code, Activity Name, Trade,
  Interior Duration, Exterior Duration + examples) and **Upload CSV/Excel** buttons. `importActivities`
  maps columns case-insensitively, resolves the Trade by label or code (Structural/ST → ST, etc.),
  reads Interior→durInt / Exterior→durExt, and asks replace-vs-append when activities already exist.
  CSV parsed inline (`parseCsv`), .xlsx via the already-loaded SheetJS (`XLSX`).
- **Step 3 "no nodes" fixed.** The tower was a floor×trade MATRIX keyed off `floorAxis()` code-matching,
  which could render empty cells (no visible nodes). Rebuilt as **per-trade sections** — each trade
  heading → its floors (top first) → a row of zone/unit node buttons — so every location in `locList()`
  is guaranteed to appear as a clickable node. (Bars on the right remain the equal-length connect targets.)
- Verified: inline JS parses; module loads with no console errors.

### 2026-08-04 — Fix: Duplicate branch failed — fractional sort_order into an integer column
User report: "Duplicate failed: invalid input syntax for type integer: "3.001"" (and `"0.001"`).
- **Root cause:** `wbs_nodes.sort_order` is an **integer** column, but `wbsDuplicate` inserted its
  copies at `(n.sort_order||0) + c/1000` — a fractional "slot" meant to keep the copies immediately
  after the original until `_wbsNormalizeAndPersist` renumbered the sibling group. That trick only
  works **in memory** (which is why `outdent`'s `+0.5` is fine — it's overwritten with an integer
  before any write); on an INSERT the fraction reaches Postgres and is rejected outright. Nothing was
  created, hence "duplicate not working".
- **Same latent bug in `wbsQuickAdd`:** a mid-list insert (Enter after an existing sibling) wrote
  `(after.sort_order||0) + 0.5`, so it would fail identically — the docs' "mid-list insert via the
  0.5 slot" was never exercised against the real integer column.
- **Fix — make room with integers instead.** New `_wbsMakeRoom(parentId, after, count)`: renumbers the
  sibling group so everything after `after` is bumped by `count` (persisting only the diff, via
  `_batchUpdate`) and returns the first free integer slot. `wbsQuickAdd` takes one slot; `wbsDuplicate`
  reserves `count` and places copy *c* at `slot0 + (c-1)`. `_wbsNormalizeAndPersist` still runs after
  and compacts to 0..k-1.
- Verified in Node against the shipped logic: duplicating 3× after the first of three siblings gives
  order `a, a1, a2, a3, b, c` with **every** sort_order an integer (was `3.001`/`0.001`). Script
  parses. ⚠️ Not verified signed-in — needs a live Duplicate click. Module-local, no migration, no
  `?v=` bump.

### 2026-08-04 — Work Package is now a grouping dimension
`work_package` was a stored-only OPC parity field (form + General tab + row copy + Global Change);
nothing read it. It is now a real grouping level, so the grid can nest by deliverable/contract package.
- Three sites, matching how every other flat dimension is wired: `dimValOf` (`'wp'` → trimmed
  `work_package`, blank → `— No work package —`), `dimLabel` (`'Work Package'`), `allDims` (after
  `type`, so it appears in the picker's "Add a level" list). Nothing else needed — `buildNodes`,
  `normalizeGroupBys`, collapse, group bars and the per-project `ps_groupbys_<pid>` persistence are
  all dimension-agnostic.
- Composes with the existing levels, e.g. **Work Package › Location › Activity** or
  **Work Package › WBS** (wbs stays forced-last by `normalizeGroupBys`).
- Search now also matches `work_package`, consistent with work type + location values.
- ⚠️ **No grid column** — the value is only settable in the Add/Edit form (or in bulk via Actions ▸
  Global Change, which already lists Work Package). An inline-editable column would need a 4th
  `costCellsHtml` cell across all three row branches; deferred as it wasn't asked for.
- **Verified: 11/11 in Node against the shipped `dimValOf`/`dimLabel`/`allDims`/`normalizeGroupBys`**
  (extracted, not reimplemented) — value, trimming, all three blank forms bucketing together, `wp`
  accepted by the normalizer, `wbs` still forced last from either order, `wp` alone surviving, an
  unknown dim still dropped. Script parses; only those 3 sites enumerate dimensions, so nothing else
  needed updating. ⚠️ Not verified signed-in. Module-local, no migration, no `?v=` bump.

## WBS import: the last double-layer + the duplicate children the merge fix created (2026-08-08) — fmlozano
After another AVR101 reimport the user reported the main WBS still double-layered. Queried the live
tree (1,627 nodes): the previous merge fix **worked for Initiation / Planning / Execution Phase** but
left two real defects.
- ⚠️ **`Milestones > Project Milestones` still nested.** The merge test was exact name equality, but
  `_impGuessTarget` files that branch under Milestones via the **keyword hint** (`/milestone|key date/`),
  not by name — so `sameName` was false and it nested. New **`_wbsNameKey()`** normalises before
  comparing: case/punctuation folded, parentheticals dropped, a leading generic qualifier stripped
  (`the|project|overall|main|general|key`), trailing plural tolerated. Deliberately conservative —
  it does **not** fold distinct words, so `Tower 1 Execution Phase` still nests under `Execution
  Phase` rather than being merged away (asserted as a test case).
- ⚠️ **The merge fix itself created duplicate CHILDREN — my regression, found by querying the live
  tree rather than by re-reading the code.** Merging lifted the branch's children up as **new
  siblings** of the target's existing children, so Planning Phase ended up with three name-collided
  pairs — locked skeleton `Procurement` / `Design Development` / `Project Execution Plan` (0 grandkids
  each) sitting **beside** the file's unlocked ones (1 / 7 / 3 grandkids). `_wbsDedupeSkeleton()`
  cannot heal these: it only merges pairs where **both** nodes are `is_locked`.
  `_wbsSkeletonTargets()` now also returns each target's `childCode` (normalised child name → dotted
  code), and a moved child that matches an existing child is filed **into** it; only genuinely new
  children (e.g. `Preparation and Approval of BOQ`) take a fresh slot.
- ⚠️ **Why filing into the existing code is safe rather than a duplicate summary row:** `_clearWbsTree()`
  only drops unlocked nodes, so the locked skeleton child survives a replace-import. The file's row
  then lands on that node's code, `wbsAdopt` links **every** legacy row of that code to the existing
  node (`group.forEach`, no re-insert), and `_wbsEnsureSummaries()`'s duplicate-projection heal deletes
  the extra summary row on the next load. Self-healing, not an orphan.
- **Verified in Node against the SHIPPED `_wbsNameKey` + `applyWbsPlacement`** (sliced out, not
  reimplemented, with stubbed skeleton targets): 5/5 name-key cases incl. the two that must NOT fold,
  and a full placement run reproducing the live AVR101 shape — `Project Milestones` merges (child at
  `1.1`, no extra layer), `Procurement`→`3.3` and `Design Development`→`3.2` land on the **existing**
  children, and the new BOQ branch takes `3.4`. Inline script parses.
  ⚠️ **Not verified signed-in** — needs a hard refresh (`index.html` is not `?v=` cache-busted) and
  another Avesta reimport. ⚠️ The location + discipline wizards must be re-run after any reimport;
  a reimport wipes `work_type` and `location`.

## Import WBS-placement picker was missing Closeout Phase (2026-08-08) — fmlozano
Screenshot: AVR101's import placement dialog offered Milestones / Initiation / Planning / Execution
Phase but no Closeout Phase, even though the file carries 70 leaf activities under it and Closeout
Phase exists live as a top-level branch.
- ⚠️ **Root cause is the documented AVR101 quirk, now actually biting.** `_wbsSkeletonTargets()`
  only offers **locked** top-level nodes. Closeout Phase was added to `WBS_SKELETON` after AVR101 was
  already seeded, so on AVR101 it was never auto-seeded/locked — a previous reimport instead created
  it as an ordinary **unlocked** top-level branch ("its own top-level branch"). The locked-only filter
  silently drops it, so the picker can never route the file's own Closeout Phase branch there — every
  reimport re-creates it as a fresh unlocked top-level sibling instead of filing into the one that
  already exists, i.e. the exact duplicate-top-level symptom this whole placement feature exists to
  prevent, just for one branch the locked filter can't see.
- **Fix:** after the locked pass, also fold in any **unlocked** top-level node whose name matches (via
  the existing `_wbsNameKey()`) an entry in the `WBS_SKELETON` constant — i.e. a phase the constant
  knows about but this project's tree never got to lock. Deduplicated by name key so a project that
  *does* have a locked match isn't given a second target.
- Verified in Node against the shipped `_wbsSkeletonTargets`/`_wbsNameKey` (sliced, not reimplemented)
  with a fixture mirroring AVR101 exactly (4 locked + 1 unlocked Closeout Phase): all 5 phases now
  returned as targets. Inline script parses. ⚠️ Not verified signed-in — hard-refresh then reimport.

## Import now reuses the saved location matching + stamps Discipline/Trade (2026-08-08) — fmlozano
User reimported AVR101 and reported Discipline/Trade and Level both unrecognised. **Diagnosed by
querying the live project, not by reading code** — two independent root causes, both measured:
- ⚠️ **Level written on ZERO activities while Tower got 4,021 and Zone 1,218.** The importer's
  Location breakdown offers only the keyword matcher, whose argument `locMapUI` seeds from **the
  level's own name**. That works by pure coincidence for levels called Tower/Zone (Avesta's nodes
  really are "Tower 5"/"Zone 2") and matches nothing for a level called **Level**: measured
  **0 of 1,623** WBS node names contain the word "level" — they read "Nineth Floor"/"Roof Deck".
  Meanwhile the project already held a **planner-confirmed 29-name match table** for Level whose
  **every key still exists in the tree** (verified 29/29) — the importer simply never offered it.
  **Fix: `locSrcsSavedMatch()`** exposes each level's saved `location_levels.match` as a source and
  `guessFor()` prefers it, per level. A level with no saved match still falls back to the keyword
  source, so a first-ever import is unchanged.
- ⚠️ **`work_type` blank on ALL 4,393 activities.** The import writes `location` but has never
  written `work_type`, and a reimport **wipes** the column — so the trade grouping reads
  "— No discipline/trade —" after every reimport until someone remembers the wizard. The wizard's
  matching is `localStorage`-only, so it doesn't even survive a browser change. **Fix:
  `discStampFromWbs()`** derives the trade from the WBS ancestry via the existing `discCanonOf()`.
  Deterministic — no saved state — so it works on a first-ever import too. Both import dialogs gained
  a default-on checkbox (`discImportRowHTML`) that shows the **real coverage and the exact trades
  found in this file** before importing, and disables itself when the WBS has no recognisable trade
  headings. The wizard remains the way to refine/exclude.
- **Verified against the shipped functions** (sliced, not reimplemented): on Avesta's documented WBS
  shape the stamp yields exactly the canonical trades — Fire Protection/Electrical/Plumbing → **MEPF
  Works**, Wet/Finishing → **Architectural Works**, Superstructure/Substructure/Earthworks →
  **Structural Works** — while Planning-branch and milestone activities correctly get **none**. The
  saved-match source resolves a deep code to `Tower 5` / `9th Floor` / `Zone 2` (including the
  spelling merge "Nineth Floor" → "9th Floor"), and each level defaults to **its own** saved match,
  falling back to the keyword source when it has none. Inline script parses.
- ⚠️ **Live-probe caveat:** the module page is ~1MB and a full 6,400-row scan **froze and then killed
  the tab**; the lighter `projects.html` carries the same session and is the better place to query
  from. A row count that climbs between two reads means an import is in flight — measurements taken
  then are of a half-written table (one read returned 500 rows mid-insert).

## Existing projects never received newly-added skeleton phases — Closeout Phase backfill (2026-08-08) — fmlozano
User: *"Closeout phase is not recognized in the import wizard. We added closeout phase as one of the
main default WBS."* Diagnosed by **querying the live tree**, which showed AVR101 sitting at **7 nodes
— four top-level phases and no Closeout Phase at all.**
- ⚠️ **Root cause: `ensureWbsSkeleton()` only ever seeded an EMPTY tree** (`if (WBS_NODES.length) return`),
  so a phase appended to `WBS_SKELETON` after a project was first seeded could never reach it. AVR101
  predates Closeout Phase, so it was never seeded/locked there. This was noted as an aside in an earlier
  session and is the actual defect.
- ⚠️ **The previous fix (`b13bd86`) could not cover it.** That one widened the import picker to also
  offer *unlocked* top-level nodes whose name matches `WBS_SKELETON` — which worked only while a prior
  import's unlocked "Closeout Phase" branch happened to exist. **`_clearWbsTree()` drops unlocked
  nodes**, so Clear schedule deleted it and the picker was empty again. Compensating for a missing node
  only works while the node exists; the fix has to create it.
- **`_wbsBackfillSkeleton()`** now runs when the tree is non-empty: inserts any missing top-level
  skeleton phase **locked**, in its constant position, with its skeleton children. Matched by
  `_wbsNameKey`, so an existing **locked or unlocked** node of that name is **adopted, never
  duplicated**. Sort order prefers the constant's own index and falls past the end if something already
  occupies it, so a user's own top-level branch is never renumbered underneath them. Summary-row
  projection is left to `_wbsEnsureSummaries()` (runs straight after in `load()`) rather than duplicating
  the projector. Tolerant: an insert error just means no backfill.
- **Verified 12/12 in Node against the SHIPPED `_wbsNameKey`/`_wbsBackfillSkeleton`** (sliced out, not
  reimplemented) using AVR101's exact live shape: exactly one phase added, locked, top-level, at
  sort_order 4 (after Execution Phase); **second run is a no-op**; an unlocked same-name node is adopted
  rather than duplicated; and a tree holding only Milestones gets the other four phases + Planning's
  three children with no duplicate sort_order and no re-created Milestones. Inline script parses.
- ⚠️ **Not verified signed-in** — `index.html` is not `?v=` cache-busted, so **hard-refresh
  (Ctrl+Shift+R) before reimporting**; the phase appears on the next project load, then the import
  picker offers it.

## Two location levels that are really ONE dimension — merge levels (2026-08-08) — fmlozano
User: *"There are location breakdown that are the same levels which are horizontal and vertical. This
shows unassigned"*, with the intended shape drawn as `Tower > Level > Zone > {Vertical, Horizontal}` —
note Vertical and Horizontal at the **same depth**, i.e. siblings, i.e. two **values**, not two levels.
- **Measured live on AVR101 before changing anything.** The project has 5 `location_levels`:
  Tower(0) / Level(1) / Zone(2) / **Vertical(3)** / **Horizontal(4)**. The Vertical level holds exactly
  one distinct value — `"Vertical"`, on 720 activities; Horizontal holds exactly `"Horizontal"`, on 498.
  **`haveBOTH: 0`** — no activity carries a value at both. So the "— Unassigned —" rows are not a
  grouping bug: grouping by two mutually-exclusive levels *must* leave each blank under the other.
- ⚠️ **The keyword matcher leads straight into this.** Name a level "Vertical", let `locMapUI` seed its
  own name as the search term, and every matching WBS node yields the value `"Vertical"` — a degenerate
  level whose only value is its own name. Both of these levels have `match: {}` (0 saved keys), i.e.
  they were filled by keyword, never through the wizard.
- **`_locMergePlan(srcId, tgtId)` + `openLocMergeLevel()`** — a **Merge into another level** (`⤵`)
  action on each row of the Location Breakdown editor. Plans first and shows the counts, the values
  being carried over, and any conflicts before writing.
  ⚠️ **A conflict never overwrites.** An activity that already holds a value at the target keeps it;
  only its source value is dropped. Silently discarding a real location value to satisfy a merge would
  be data loss.
  ⚠️ **The source key is deleted from `location` on conflict rows too**, not just moved rows — otherwise
  the deleted level would leave orphaned keys behind in the jsonb.
  The saved WBS `match` tables are folded together (target's entries win), the merged level can be
  renamed in the same dialog (Vertical+Horizontal → e.g. "Orientation"), and the source level is deleted.
- **Verified 7/7 in Node against the SHIPPED `_locMergePlan`/`locValOf`/`isWbs`** (sliced, not
  reimplemented) over a fixture built from AVR101's exact live shape: 498 activities move, **0
  conflicts** (matching the measured `haveBOTH: 0`), WBS-summary rows excluded, a planted both-values
  row is classed a conflict that keeps the **target** value, and merged coverage lands on **1,218** —
  exactly the live `Vertical 720 + Horizontal 498`. Inline script parses; every helper the new code
  calls confirmed to exist.
- ⚠️ **Not verified signed-in** — `index.html` is not `?v=` cache-busted, so hard-refresh before using
  Group menu → **Location Breakdown…** → `⤵` on Horizontal → merge into Vertical → rename.

### ⚠️ Live audit caught a regression in that backfill — it must COMPLETE a skeleton, never impose one
Auditing the backfill across **all 19 live projects** (top-level nodes only, per project — a single
cross-project `.is('parent_id',null)` scan froze the tab) showed the first cut was **wrong for 8 of
them**:
- **8 projects carry a real hand-built/imported WBS with NO skeleton** — CDP101, CP104, **GPR101**,
  LCIT, MWD101, OPW101, PSP101, SLN101. They predate the skeleton feature, so `lockedSkeletonPhases`
  is 0 and the backfill would have injected **five empty locked phases as new top-level branches into
  every one of them** — on GPR101 that is five empty headings dropped into an 8,596-node P6 tree.
- Only **4** genuinely wanted it (BAU101, BAU101-TEST, Test, XERTEST → Closeout Phase). AVR101 was
  already repaired by the live run. 6 empty-tree projects seed normally and are unaffected.
- **Guard:** backfill now runs only when the project already has a **locked top-level node bearing a
  skeleton name** — the signal that `ensureWbsSkeleton()` actually seeded it. A project with a tree and
  no skeleton has opted out; leave it alone.
- **Verified 6/6 in Node against the shipped function** over each real shape: a legacy imported root and
  a hand-built two-branch tree are both **untouched**; a seeded 4-phase project gets exactly Closeout
  Phase, locked; a complete skeleton is a no-op; and a seeded tree that also holds imported branches
  gets its missing phases without colliding sort_order or touching "Tower 1".
- ⚠️ **Lesson:** "additive and idempotent" is not the same as "safe" — this was both, and still wrong
  for 42% of projects, because it changed *which* projects the feature applies to. Measure the blast
  radius across real data before shipping anything that runs on every project load.

## The .xer importer silently discarded the WBS placement step (2026-08-09) — fmlozano
User cleared + reimported AVR101 and it mis-filed again. **Root cause found by grep, not by theory:
`parsed.wbsPlacement` was written once (line ~5270) and READ NOWHERE.** The XER preview dialog
collected the planner's per-branch placement choices and threw them away — `doImportXER` had the
full explanatory comment for the placement step but **no `applyWbsPlacement` call**. Every `.xer`
import ever run ignored placement. Avesta is a `.xer`.
- ⚠️ **The failure is silent and worse than "branches sit beside the skeleton".** Dotted codes are
  COMPUTED from position (locked skeleton nodes store `code=null` — confirmed live), so Milestones
  computes to code `"1"` — exactly a .xer's own project-root code. `wbsAdopt` then resolves the
  file's root ONTO the Milestones node and the entire file lands as its children. Nothing errors.
- **Measured live after the user's reimport** (waited for the row count to settle first — 6,606
  rows / 387 nodes): `Milestones desc=379`, and its children were the file's own branches
  `Project Milestones(5) · Initiation Phase(9) · Planning Phase(89) · Execution Phase(272)`, all
  unlocked, while the locked `Execution Phase` held **0**. `nodesWithStoredCode: 379` vs the
  skeleton's null codes is the fingerprint of the adopt path.
- ⚠️ **My first two hypotheses were both WRONG and were disproved by testing the SHIPPED code, not
  by reading it.** (a) A code-collision + `moves.sort`-by-string-length bug in `applyWbsPlacement`:
  disproved — run against the real file shape it distributes correctly in BOTH skeleton
  configurations (5 targets, and the 4-target pre-backfill state from the user's screenshot, where
  Closeout correctly becomes top-level `5`). (b) A stale cached build (this file is not `?v=`
  cache-busted, so it was the plausible suspect): disproved by the reimport reproducing it, and
  finally by the grep. **When a function tests clean against real data, check whether it is being
  called at all.**
- **Fix:** one line in `doImportXER`, placed to satisfy both surrounding comments' stated
  invariants — after location mapping (which keys off ORIGINAL codes), before the disc stamp and
  `xerRecToPayload` (which reads the FINAL code as `wbs`). Verified by index: `locMapping <
  placement < discStamp < payloads`.
- **Verified:** inline block parses (1,039,020 chars); `applyWbsPlacement` declared in the same
  block as the new call; and a simulation of the shipped functions over AVR101's exact measured
  shape turns `Milestones 379 / Initiation 0 / Planning 3 / Execution 0` into
  `Milestones 5 / Initiation 9 / Planning 89 / Execution 272`, root wrapper dropped, **0 stray
  top-level nodes**. ⚠️ **Not verified signed-in** — needs one more Clear + reimport.
- ⚠️ **The Excel path was always correct** (line ~4689) — only the XER path was missing the call.
  Worth checking whether both import paths consume every option the shared dialog collects.

## Code audit + 4 fixes: seeding, cache-busting, dead code, collapse memory (2026-08-10) — fmlozano
User asked for an architecture audit ("does the code work or not"), then for the fixes it surfaced.

**Audit verdict: it works.** Static scan found **0** duplicate module-scope function names, **0**
duplicate static DOM ids (294), **0** genuine undeclared references, and a clean parse. The problem is
scale, not correctness: **1.21 MB / 15,198 lines in ONE file**, a single ~1.03 M-char inline `<script>`,
**683 module-scope functions in one IIFE sharing ~144 mutable vars**, 334 `.onclick=` rebinds against a
virtualized grid, 156 scattered `.from()` calls, **0 committed tests, no build step**. Function-level
decomposition is fine (median 7 lines, largest 183, none over 200) — the risk is change-safety.

⚠️ **THREE of my own analysis tools produced confidently wrong numbers before I caught them. Any scan
of this file needs a sanity gate.**
1. A Bash **heredoc silently collapsed `\\b` into a backspace character**, so every `new RegExp('\\b…')`
   matched nothing and the dead-code scan reported **all 826 functions as dead**. Caught only because
   "rebuild is never called" is obviously false. Write analysis scripts with the file tool, not heredocs.
2. My comment/string **stripper is broken** — stripped brace balance is **4, must be 0** (it mis-tokenises
   regex literals and apostrophes in comments). Every statistic derived from it is unreliable; the
   headline counts above were re-derived from the RAW file with a sanity gate.
3. The same stripper deleted newlines inside block comments, so line numbers drifted and two runs of the
   `ScheduleBuilder` coupling measurement disagreed (**1,325 vs 2,712 lines**). Fixed by preserving
   newlines — but a naive brace-matcher still can't tokenise this file, so **there is no trustworthy way
   to find a closure boundary here without a real parser** (none available: no `package.json`).

**Fix 1 — location-wizard keyword seeding (`locSeedTerms`).** The matcher's default argument was the
level's **own name**, which only works when that name happens to be the tree's vocabulary. Measured on
AVR101: a level called **"Level" matched 0 of 159 distinct WBS node names** (the tree says "Nineth
Floor"/"Roof Deck"), so Level imported blank on all 4,393 activities while Tower and Zone filled at 88%
and 28%. Now seeds the **synonym family** via `locLevelTerms()` — the same list `locGuessLevel` already
pre-classifies with, so wizard suggestion and importer default agree by construction.
- **Measured on the live tree: Level 0 → 30 of 159 names.** ⚠️ Tower gains 2 false-positive *names*
  (`Building Management Systems`, `Building Watertightness`), so I re-ran the full deepest-wins
  resolution over all **3,874 Execution-Phase activities**: **3,814 Tower values before and after,
  0 activities changed.** Safe. `locLevelTerms` also deduped (order/duplicate-independent, so no
  classification change).
- ⚠️ Known-visible false positives remain by design — "Floor Finishes"/"Ground Reservoir" match the
  Level family and appear in the wizard's distinct-value preview for the planner to exclude.
- **15/15 against sliced shipped functions**, including the two cases that must NOT fold.

**Fix 2 — module pages are now cache-busted** (`dashboard.html`). Every shared asset carried `?v=` but
each module's own `index.html` did not, so returning users kept serving a cached page — mis-diagnosed as
a code bug more than once in this changelog. `MODULE_V` lives in dashboard.html, **not** config.js:
config.js is itself cache-busted from 22 HTML files, so versioning it there would mean a 22-file bump
for a one-module change. Covers all 13 modules. **Bump `MODULE_V` on any deploy that changes a module.**

**Fix 3 — 21 dead functions + one dead `var atDur` removed** (−162 lines). ⚠️ Every candidate was
re-verified against the **RAW** source including strings, which caught **2 false positives**
(`isDirty`, `drivingPath` ARE referenced). ⚠️ `mergeSuccessors` is `(function mergeSuccessors(){…})()`
— a named IIFE that IS invoked; my remover's line-start anchor skipped it **by luck, not design**.
Verified after: 0 of the removed names appear anywhere, `renderDetails()` dispatches only to surviving
functions, and `detStatusEdit` has its own `dd`/`nz` helpers so nothing was orphaned.

**Fix 4 — collapse state remembered per grouping** (user request). `setGroupBys` did `collapsed = {}`,
so flipping WBS ↔ Discipline/Tower/Level meant re-collapsing a 1,623-node tree by hand every time.
⚠️ The map is keyed by `_dcode`, which is **generated from the active groupBys** — one shared map cannot
serve two groupings, which is why it was wiped. Now one map **per grouping signature**, per project,
persisted (`ps_collapsed_<pid>`).
- ⚠️ **Adversarial review found 3 real defects in my first cut — all confirmed against the code and
  fixed before shipping:**
  1. **BLOCKER:** `doRender()` arms a 500 ms debounced save on load's first paint (line 2784/2841), but
     the store wasn't read until `loadGroupBys()` at 2856 — behind three awaits including the paginated
     resource fetches. The timer won, writing the **empty init object over the project's saved trees**.
     Fixed with a `_colStorePid` guard + reading the store at the TOP of `load()`.
  2. **BLOCKER:** `selectProject()` changes `pid` without cancelling the pending save, so `_colKey()`
     returned the NEW project while `collapsedStore` still held the OLD one — project A's trees written
     under project B's key. `_dcode` keys collide across projects, so B would open with unrelated
     branches hidden. Fixed by the same guard + `_cancelCollapseSave()` in `selectProject`.
  3. **MAJOR:** `restoreCollapsedFor` overwrote `collapsed` unconditionally and runs *after*
     `_applyBigCollapse()`, discarding the large-schedule default — a 17k-activity schedule would open
     fully expanded. Fixed with `keepIfMissing`: load-time keeps the default, grouping-switch resets.
- **12/12 against sliced shipped functions**, including a regression test for each of the three.

**Bonus real bug found while scoping the data layer:** `activity_steps` used a bare `.select('*')`
(capped at 1000 rows) while every growable neighbour already paginated. It holds one row **per step per
activity**, and truncation feeds `physicalPct()` → `syncPhysicalPct()` → **writes a wrong
`percent_complete`** into the schedule, corrupting EVM, the S-curve and every roll-up. Now routed
through `selectAllPaged` (exactly equivalent — the call had no `.order()`).

⚠️ **NOT verified signed-in.** The deployed site serves the old build and a local `file://` load renders
as a static snapshot without executing scripts, so every check above is static analysis plus harnesses
that **execute functions sliced from the shipped file**. Smoke-test after deploy.
⚠️ **Deferred: splitting the file.** One inbound entry point (`ScheduleBuilder.open`) but heavy outbound
coupling to module helpers — it needs an explicit shared-state object first, and a boundary I can prove.

## Stage 1 of the file split: explicit shared-state surface (`PS` / `window.__PS`) (2026-08-10) — fmlozano
Groundwork for splitting the 1.2 MB file, done **without moving a single line of code**.
- ⚠️ **What actually blocks a split is not size, it is implicit sharing.** All **684** module-scope
  functions freely read and write **174** mutable bindings in one closure; code moved to another
  `<script>` loses the closure and the state with it. The scaffold exposes that surface explicitly:
  `Object.defineProperties` accessors that **close over the real bindings**, so `PS.state.rows` **is**
  `rows` — reads and writes both hit the live variable, no copy, no synchronisation.
- **Curated call-back surface, not all 684.** `PS.fn` exposes **29** functions an extracted module would
  realistically call back into (load/rebuild/renderAll/persist/switchTab/displayList/buildNodes/…).
  Functions move with their code; shared mutable state does not — so state gets full coverage and
  functions get a deliberate subset. `PS.meta` records the real counts so the scale is measured by the
  code rather than by a regex over it.
- ⚠️ **Wrapped in try/catch by design** — a refactor scaffold must never be able to break the module. If
  any accessor fails to build, `PS` is simply `null` and everything runs exactly as before. A startup
  self-check reads every accessor once so a mis-generated name fails loudly instead of latently.
- **Generated, not hand-written.** The 174 names came from a scanner that parses multi-declarator lists
  (`var a = 1, b, c;` — the shape that produced false positives earlier), then were **cross-checked by a
  second, independently-written test**: 174/174 confirmed declared, 0 rejected, 0 referenced-only-once,
  and a sanity gate requiring 9 known-real names to survive.
- **Verified additive by diff: 0 lines removed or changed, 250 added.** `PS` and `_psBad` collide with
  nothing (0 prior occurrences; `PS_M_CAP` is a distinct identifier). `window.__PS` follows this module's
  existing `window.__archived` / `window.__viewOnly` precedent.
- ⚠️ **Cost: +23,634 chars (~2%) on a file whose problem is size.** Accepted only because it is the
  enabler for removing far more later; it should shrink as code actually moves out.

**⚠️ The bigger win: this module can now be EXECUTED locally.** `run-scaffold.js` runs the real 1 MB IIFE
in a Node `vm` sandbox with stubbed DOM/Supabase/AppAuth (`requireLogin` never fires its callback, so
only module-scope code runs). **12/12**, including proof that a write through `PS.state` reaches the
live binding. That lifts the "cannot verify without deploying" constraint this module has carried all
session — future changes here can be executed before they ship, not just parsed.
⚠️ One test failed first and it was **my stub, not the code**: `esc()` is `return Fmt.esc(s)`, and my
`Fmt` proxy returned the input unchanged, so the assertion was testing the stub. Stub the real
behaviour or the test proves nothing.

**Stage 2 (not started):** move one subsystem out (Schedule Builder is the best candidate — a single
inbound entry point) so it reads state through `PS` instead of the closure, with a verifiable step
between each move. ⚠️ Still blocked on a trustworthy closure boundary: a naive brace-matcher cannot
tokenise this file and there is no parser available (no `package.json`).

### 2026-08-10 — Execution Phase wrapper + "Execution Phase only" toggle, and a load-order grouping flash fixed
User: with location grouping on, Execution Phase's content (grouped by Discipline/Location) has no
"Execution Phase" heading above it — unlike Milestones/Initiation/Planning, which do show as headings
(they render by real WBS path, since they're carved out of the location walk). Confirmed as **by
design**, not a bug — 3,874 of 4,393 activities are under Execution Phase, so wrapping it would be a
container holding 88% of the schedule with no filtering value. User asked for the wrapper anyway (for
visual consistency with the other phases) plus a toggle to isolate just Execution Phase.
- **Synthetic "Execution Phase" wrapper heading.** When a location dimension is grouped, a
  `_dkind:'group'` node (named from the real WBS row, falling back to "Execution Phase") is pushed
  before the Discipline/Location walk, and the walk's `parentCode`/`parentAnc` are seeded from it —
  so Structural Works / Tower 1 / … now nest one level deeper, under the heading. Purely cosmetic;
  the underlying carve-out (`otherPhaseActs` vs `acts`) is unchanged.
- **"Execution Phase only" toggle** (Group menu → new **View** section, checkbox `#ps-gm-execonly`,
  persisted `localStorage.ps_execonly`). Drops Milestones/Initiation/Planning/Closeout entirely
  instead of rendering them before/after — reuses the same `execPhaseCode()`/`locCodeUnder()` scoping
  the carve-out already does, extended to also scope when **no** location dimension is active (the
  plain WBS-tree view): the project's own Execution Phase WBS-summary row + everything under it is
  kept, with no synthetic wrapper needed there since the real row already is the top-level heading.
- ⚠️ **REAL BUG FOUND AND FIXED while investigating a separate report: `groupBys` flashes the wrong
  value on every project open/switch.** User showed two screenshots — one glitchy (blank grid rows,
  "Group: WBS") that "reverts back to being okay" (correct grouping, real data) a moment later.
  Traced to `load()`: `groupBys` is a shared module var never reset per-project, and the per-project
  saved grouping isn't read from storage (`loadGroupBys()`) until **near the very end** of `load()` —
  after the schedule rows, WBS tree and resource assignments have all loaded (several seconds on a
  large project). But the grid **renders twice before that** (once from the IndexedDB cache, once
  from the fresh DB fetch), both painting with whatever `groupBys` was left over — the bare `['wbs']`
  default on a fresh load, or literally the **previous project's** grouping on a project switch.
  `loadGroupBys()`'s later, fully-validated read then flips it to correct — the visible "revert."
- **Fix:** `load()` now reads the saved grouping from `localStorage` **immediately**, before either
  of the two early renders, so they already paint correctly. Deliberately **un-validated** at this
  point (`normalizeGroupBys()`/`allDims()` need `LOC_LEVELS`, which isn't loaded yet — validating
  early would silently drop a saved `loc:` dimension) — the existing `loadGroupBys()` call still runs
  its full validated read+normalize later, now normally a no-op repaint instead of a visible flip.
  Also restores this grouping's collapse tree at the same early point (`restoreCollapsedFor`), which
  composes cleanly with the existing `_applyBigCollapse()` large-tree default (guarded on
  `collapsed` being empty — verified no conflict).
- Verified: inline script parses; the exact added read/fallback logic unit-tested in isolation
  (picks up a saved grouping, falls back to `['wbs']` for a project with none, fails safe — no throw —
  on a corrupted saved value). ⚠️ **Not verified signed-in for the flash fix** — needs a project with a
  non-default saved grouping reopened a few times to confirm the flash is gone; the wrapper/toggle
  feature's implementation predates this entry (built in the same session) and is likewise unverified
  signed-in. Module-local, no migration, no `?v=` bump (`index.html` isn't cache-busted — hard-refresh).

## Activity legend (LSM-style) + vertical stacking view on a month click (2026-08-13) — fmlozano
User asked for the two LSM features from the OPW101 deck: a **legend for the activities in the Gantt**,
and **clicking a month to show progress as a vertical stack** of floors.
- ⚠️ **The existing `.ps-legend` is not that legend.** It explains bar SHAPES (task / summary /
  baseline / milestone / data date) — one entry per bar KIND. An LSM legend maps a colour to a
  repeating work TYPE (Structural Works · MEPF 1st Fix · Plastering …), which recurs on every floor.
  So the new legend is a second strip (`#ps-actlegend`) keyed by a category FIELD, not by row.
- **Category colour engine** (`ps_catcolors` per project, alongside the existing `ps_wbscolors` /
  `ps_actcolors`): `catCfg` / `catValOf` / `catList` / `catColor`. The field is selectable —
  **Activity name · Discipline/Trade (`work_type`) · Activity type · any Activity Code type** —
  because a P6 import may carry the trade in any of them. Colours auto-assign from an 18-colour
  palette and every swatch in the legend is an editable `<input type=color>`.
- ⚠️ **Categories are ordered by when the work first starts, not alphabetically** — that is what makes
  the legend read like an LSM one (Structural → Masonry → Plastering → Finishes falls out of the
  schedule itself). Dateless categories sort last; WBS/summary rows and blank values are excluded (a
  summary rolls up several categories, so it has no single colour).
- **Bar colour precedence is now `actColor(r) || catColor(r) || effWbsColor(r)`** — a per-activity
  override still wins, and the legend is **off by default**, so no existing project's Gantt changes
  colour until the planner turns it on.
- **Vertical stacking view** (`#ps-stack-back`, `openStackView`/`renderStackView`): every month (or
  quarter) cell in the Gantt header is clickable and opens *"Planned status as of &lt;period&gt;"* —
  one band per location value, top level first, coloured with the same legend colours. Per band:
  fill = % of that location's categories complete at the cut-off, text = *"On-going X"* / *"X
  complete"* / *"Not started"*.
  - ⚠️ **The grip inside the same header cell is a DRAG, not a click** — the handler ignores clicks
    landing on `.ps-ts-grip`, or resizing the timescale would pop the panel open every time.
  - ⚠️ Rows are sorted by **earliest start** and then reversed, not by name — floor names are text
    ("Nineth Floor", "Roof Deck") and sort meaninglessly; build order is the honest vertical order.
    Falls back to a numeric-aware name sort when starts are missing.
  - Level is chosen from `LOC_LEVELS` (defaults to the one whose name matches /floor|level|storey/),
    switchable in the panel. Uses `dispStart`/`dispFin`, so it reads actuals where recorded.
  - Honest empty states rather than a blank panel: no Location Breakdown → points at
    **Group ▸ Location Breakdown…**; levels defined but unfilled → points at
    **Group ▸ Match WBS to locations…**; no categories on the chosen field → points back at the legend.
- ⚠️ Only Month and Quarter zoom produce clickable period cells (Year zoom renders `.ps-yr` only).
- **Verified 12/12 in Node against the SHIPPED `_stkState`/`catList`/`catValOf`/`catCfg`** (sliced out
  of index.html, not reimplemented): all five state cases incl. finish-exactly-on-the-cut-off counting
  as done and started-but-unfinished beating a later done; category ordering by first start, dateless
  last, WBS + blank excluded, counts aggregated, palette cycling. Inline script parses (1 block, 0
  fail); the module page loads with no console errors.
  ⚠️ **Not verified signed-in** — needs a project with a location breakdown to eyeball the stack.
  `MODULE_V` bumped to `20260813a` (module `index.html` is cache-busted from dashboard.html).

## LSM pass 2: textures, filling bars, WBS composition, side-by-side stacking (2026-08-13) — fmlozano
Owner feedback on the first LSM pass, verified **signed in on AVR101 (Avesta, 6,016 rows)** this time.
- **Legend colours were too close together → colour + TEXTURE, as the reference sheet does it.**
  New `CAT_TEXTURES` (solid / hatch / dots / vertical / back-hatch / crosshatch / horizontal / grid)
  rendered as `background-image` over the base colour by `catStyle()`, cycling **one step per legend
  entry** so neighbours differ in hue *and* pattern; palette re-ordered for maximum adjacent
  separation. A **Textures** checkbox turns it off. ⚠️ A native `<input type=color>` can only show a
  flat swatch, so the legend swatch is a styled button with the colour input hidden behind it.
  **Verified live: 6 trades, 6 distinct colours, 5 distinct textures.**
- **Bars now FILL UP.** `catTint()` paints the remainder in the same colour at 0.26 alpha and the
  `.ps-bar-fill` carries the solid textured colour. ⚠️ Alpha rather than a blend toward white, so it
  reads in both themes. **Verified live: bar `rgba(0,176,240,.26)` / fill `rgb(0,176,240)` + texture,
  widths 0 / 53 / 100% matching `percent_complete`.**
- **WBS summary bars show what is INSIDE them** (`_sumSegsHTML`): each descendant activity as a
  segment at its own dates, tinted + filled by its own progress — so a summary reads as its sequence
  of trades, not one flat block. ⚠️ Built from a **one-pass `_segMap`** (each leaf pushed into every
  ancestor's bucket, capped at 400) rather than scanning `_sorted` per visible row, which would be
  O(rows × visible) on a 17k schedule. **Verified live: 378 segments on Avesta's default outline.**
- **Stacking view rebuilt.**
  - ⚠️ **Level order was wrong and it was not a sort-stability issue — the values are text.** Ordering
    by earliest start interleaved basements among the upper floors. New `levelRank()` ranks
    structurally (basements negative, ground 0, mezzanine 0.5, floors by number, roof last) and
    `cmpLevelValue` falls back to a numeric-aware name sort. **Two defects the live run caught that no
    fixture would have:** `Substructure` was unrankable and floated to the TOP of the tower (now −50,
    below the basements), and **`Ground Reservoir` matched the bare word "ground" and ranked as level
    0**, wedging a water tank between 2nd Floor and Ground Floor (the ground match now needs the floor
    sense). Values that are not a storey are appended **below** the stack instead of reversing with it.
    **Verified live: Roof Deck → 12th … 2nd → Ground Floor → grade line → Substructure → Ground
    Reservoir.**
  - **Bands are aligned** — the status column is a fixed `168px` grid track, not `auto`. With `auto`
    the widest label won and every band ended at a different x, which read as cantilevered floors.
    **Verified live: every band's right edge at exactly 918px.**
  - "Stack by" is a real 150×30 select on its own label, no longer colliding with its own text.
- **Docked stacking pane** (`.ps-stackpane`, third column of `.ps-split`): one band per level, placed
  at `DL index × ROWH` and scroll-synced by `transform`, so the stack sits **beside** the Gantt on the
  same row axis. It only aligns when the grid is **grouped by that level**, and offers a one-click
  "Group by <level>"; location groups then order by `cmpLevelValue` (top-first or bottom-first,
  shared with the stack) — the WBS grouping is never touched.
  ⚠️ **`normalizeGroupBys()` silently DROPS a `loc:` dimension whose level isn't in `LOC_LEVELS`**, so
  clicking that button before the project's levels finish loading did nothing at all. Confirmed as the
  live symptom (4/4 in Node) and now guarded with a toast instead of a silent no-op.
- **Verified 49 checks in Node against the SHIPPED functions** (sliced, not reimplemented): 12 state/
  category + 33 level-rank / ordering / tint / stackModel + 4 grouping-normalisation. Inline script
  parses. ⚠️ **The docked pane's row alignment is the one thing NOT confirmed live** — switching a
  6k-row project's grouping repeatedly timed out CDP on a backgrounded tab.
- ⚠️ **Environment note that finally paid off:** the tab reports `visibilityState:"hidden"`, so rAF
  never fires and the Gantt does not repaint after a state change. **`window.__PS.fn.doRender()` (the
  stage-1 scaffold) calls the render choke point directly and bypasses it** — that is how the bars and
  segments were measurable at all.

## LSM pass 3: tower scoping + the two clipped selects (2026-08-13) — fmlozano
Owner feedback on pass 2, all four items, verified signed in on AVR101.
- ⚠️ **THE REAL ONE — the stack ignored TOWER logic.** Avesta is `Tower › Level › Zone ›
  Orientation`, so stacking by Level merged **seven different buildings' 9th floors into one band**.
  That is not a display nit: Tower 1 can be topped out while Tower 5 is still in substructure, and a
  merged band cannot represent both. **Levels above the stacked one are now a SCOPE**
  (`_stkScope` + `stkOuterLevels`/`stkScopeValues`/`stkInScope`/`stkEnsureScope`), one selector per
  outer level, defaulting to the **first real value rather than a merge**, named in the panel title
  and the pane header. Scoping cascades: the Zone stack is scoped by Tower **and** Level.
  **Verified live: Tower 1 → 13 levels (tops out at the 11th), Tower 3 and Tower 5 → 14 (they have a
  12th) — three different buildings, three different stacks, from one project.**
- ⚠️ **Two selects were clipping their own text** (`Colour activities by`, then `Stack by` + the new
  Tower selector) — all three had a **fixed** `height` (28/30px) that the 12–12.5px option text
  overflowed, so the descenders were cut and it read as a smudge. Height is a **minimum** now and the
  box grows with its content. **Verified live: 32px box, 30px needed, `clipped:false` on all three.**
- **Label spill-over in the modal.** The level column wrapped "Ground Reservoir" onto two lines and
  the status column cut "Architectural Works complete" — and a wrapped label pushed its own row out
  of alignment with the others. Both side columns are fixed and wide enough (118 / 215px) and clip
  with a tooltip instead of wrapping; panel 1000px. **Verified live: 0 two-line labels, 0 clipped
  statuses, every band's right edge at 976px.**
- ⚠️ **The docked pane looked empty, and grouping by the level was NOT enough to fix it.** Each level
  group is followed by its whole subtree, so on Avesta two level rows sit hundreds of rows apart and
  no scroll position shows two bands. The pane now offers **"Collapse to one row per <level>"**
  (`stkCollapseToLevels`), which is what actually produces the side-by-side of the reference sheet.
- ⚠️ **My own ordering slip, caught live:** `renderStackView` built the title *before* resolving the
  scope, so the first open never said which tower you were looking at. Scope resolves first now.
- **60 checks green against the SHIPPED functions** (12 + 33 + 4 + 11), the new suite covering
  outer-level detection, cascading scope, first-value defaulting, per-tower models, and the
  **unscoped merge as an explicit regression case**. ⚠️ **Still not verified live: the docked pane's
  collapse-to-levels alignment** — regrouping a 6k-row project repeatedly timed out CDP.
- ⚠️ **Method note:** `window.__PS.fn.doRender()` (the stage-1 scaffold) is the only way to measure
  anything here — the tab reports `visibilityState:"hidden"`, so rAF never fires and the Gantt never
  repaints after a state change. Every measurement above came through it.
