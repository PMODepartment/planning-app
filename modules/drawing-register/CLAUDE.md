# Module: drawing-register

## Searchable schedule-activity picker (2026-08-03) — fmlozano
Replaced the Activity (need-by) `<input list>` + `<datalist>` with a real searchable dropdown.
- ⚠️ **A datalist physically cannot search by name.** Browsers filter datalist options by the option's
  **`value`**, which must be the `activity_id` we store — the activity name lived only in the display
  text, so typing it matched nothing. This is why it had to be rebuilt rather than tweaked.
- `schedPickerHTML()` renders a search box + hidden `#dr-f-sact` (the stored id) + a selection chip
  (`ID — Name`, with a clear ×). `wireSchedPicker()` handles input/focus/Enter(first match)/Esc/
  outside-click. `schedMatches()` = whitespace-separated **AND** matching over `activity_id + " " +
  activity_name`, lowercased; capped at `SCHED_PICK_MAX` (60) rows/query because schedules reach 40k
  activities, with a "keep typing to narrow" hint when the cap is hit.
- **Lazy-load handling:** the schedule loads after the register, so a form opened early showed a stale
  "not in this project's schedule" warning forever. A capped poller (60 × 500ms, cleared by a wrapped
  `m.close`) refreshes the chip + derived date once `schedPid === pid`.
- Verified `schedMatches()` in a Node harness (by-ID, by-name, multi-term AND, case-insensitivity,
  no-match, cap) + `node --check` + CSS brace-balance. **Not browser-verified.**
- Assets `module.css?v=20260803h` / `module.js?v=20260803j`.

## Chart.js adoption + per-revision drawing files (2026-08-03) — fmlozano
- **Chart.js 4.4.1 + chartjs-plugin-datalabels (CDN) replaces the hand-rolled SVG period chart.**
  ⚠️ **This reverts the `preserveAspectRatio="none"` change from the previous entry, which WAS the
  "S-curve looks stretched" bug** — non-uniform scaling distorts the viewBox's contents (text, point
  markers), not just its box. And the reason hover "didn't work like the prc-app" is simply that PRC
  uses Chart.js; its `interaction:{mode:'index'}` tooltip is the thing being compared against.
  `periodChartSVG` + `wirePeriodHover` (~110 lines) deleted. `.dr-pc-wrap` must keep an explicit
  height — Chart.js with `maintainAspectRatio:false` collapses to 0 without a sized parent.
- **`#`/`%` is one switching button** (`.dr-segswitch`), not a 2-button segmented control.
- **`#dr-view > .pd-card / > .dr-dash-grid { margin-bottom:16px }`** — the Overview's top-level blocks
  had no margin between them, so the Status card collided with the chart below it. Done as one rule
  for the view rather than per-card so new sections inherit the rhythm.
- **Per-revision drawing files.** Each `submissions[]` entry now carries its own `file_url` (upload /
  view / remove per revision in the form); the row-level `file_url` is now specifically the
  **approved** version. **No migration** — `submissions` is already jsonb.
  ⚠️ **Ordering invariants (copied from material-submittal's attachment work, don't "simplify" them):**
  upload before the row write; roll back this save's uploads if the write fails; delete superseded
  objects only after the row points away; ✕ is deferred to Save so cancelling never deletes a file.
  New `allFilesOf(r)` collects the approved file + every revision's file for row/bulk/clear deletes,
  capturing paths before rows leave memory.
  ⚠️ Per-revision file inputs are read by their **current DOM index before `subs` is filtered** —
  filtering first would reindex the array and attach uploads to the wrong revision.
- Assets `module.css?v=20260803g` / `module.js?v=20260803i` + 2 CDN script tags. Verified
  `node --check`, CSS brace-balance, 0 stale refs. **Not browser-verified.**

## Period chart overhaul: PowerBI hover, actual bars, %/# toggle + layout fixes (2026-08-03) — fmlozano
Second round of live-review feedback (Bauhinia). Concrete asks + real bugs found while doing them:
- **Real bug: the chart wasn't actually full width.** `width:100%` + a fixed pixel `height` with no
  `preserveAspectRatio` override means the browser's default `xMidYMid meet` scales the 960×h viewBox
  down to fit *inside* the box while preserving aspect ratio — on a card much wider than the chart's
  own ratio, that letterboxes it (empty space left/right). Fixed with `preserveAspectRatio="none"`
  (safe: every coordinate is already computed from the target pixel dimensions).
- **PowerBI-style hover** (`wirePeriodHover`): a real floating tooltip (`.dr-pc-tip`) + vertical guide
  line, driven by transparent per-period hit-zone rects (`.dr-pc-hit`, drawn last = on top) instead of
  the plain-browser `<title>` tooltip from before.
- **Actual-this-period bars** — grouped bars per period (light-gray Planned + translucent-red Actual),
  not just the cumulative Actual line.
- **Data labels above bars** when ≤20 periods (`showLabels`); beyond that, hover carries the detail.
- **`periodValueMode` (# / %) toggle** — `periodScaled()` rescales every value as a % of `draws.length`
  when active; y-axis pins to 0–100 in % mode (the conventional S-curve reading).
- **Legend centered** (`.dr-pc-legend { justify-content:center }`).
- **KPI accent color** — was brand red on every card by default (six neutral metrics all "flagged red"
  read as clashing); default is now a muted neutral, red/green/amber reserved for `.dr-warn`/`.dr-ok`.
- **`.dr-dash-grid` `align-items:start`** — CSS Grid's default `stretch` was forcing the 4-row
  "Progress by Phase" table to match the height of the 11-row Trade table beside it, leaving a big
  blank gap. Real bug, not a spacing preference.
- **"Progress by Discipline" → "Progress by Trade"** (heading text only, `groupAgg('discipline')`
  unchanged).
- Assets `module.css?v=20260803f` / `module.js?v=20260803h`. Verified `node --check` + CSS
  brace-balance. **Not browser-verified** (auth wall) — reasoned from the SVG/DOM spec, not observed
  in a live render.

## KPI card polish + chart readability pass (2026-08-03) — fmlozano
User reviewed a live screenshot of the Bauhinia Overview and called out three things:
- **KPI cards "too close together" / "maximize the space" / "look professionally built":** `.dr-kpis`
  went from a fixed `repeat(6,1fr)` grid to `repeat(auto-fit, minmax(170px,1fr))`, gap 12→18px, card
  padding 16/18→20/22px, value font 26→32px, added `box-shadow` + hover lift, thicker 4px accent bar.
  Cards now claim real width on a wide screen instead of being squeezed into six equal narrow slots.
- **"Open Items by Aging doesn't look very helpful":** Bauhinia has 997 of 1,010 open items with no
  schedule link, so the old bar (built from ALL 5 buckets incl. "No due date") was one giant grey blob
  — the genuinely actionable overdue/tight buckets were reduced to a barely-visible sliver. The
  proportional bar (`AGING_DATED`) now excludes "No due date" entirely; it's reported as a separate
  line below ("+N open items not yet linked…") instead of competing for bar space. If zero items have
  a date, the card says so explicitly instead of rendering an all-grey bar.
- **"The s-curve doesn't look very nice"** (the Period chart): taller (220→280px), rounded bar tops,
  a translucent gradient area fill under Cumulative Planned (the classic S-curve "target band" look),
  point markers on both cumulative lines, dashed gridlines, and the planned line recolored from
  `currentColor` (which reads washed-out, same tone as the muted axis labels) to `var(--pd-ink)` —
  theme-correct but a solid, clearly visible line.
- Assets `module.css?v=20260803e` / `module.js?v=20260803g`. Verified `node --check`. **Not
  browser-verified against a real render** — this pass was visual-design work against the user's
  screenshot, not something `node --check` can confirm looks right.

## Live UI review fixes: Backlog scroll containment, sentinel-date bug, KPI sections (2026-08-03) — fmlozano
Reviewed the live deployed site against a real project (Bauhinia, BAU101) and GPR101; found and fixed:
- **Backlog scroll containment.** Bauhinia has **1,010 open items** — rendering all of them as one
  page-length table was the "vastness" the user hit. `renderBacklog()` now wraps the table in
  `.dr-bk-scroll` (`max-height:min(62vh,640px); overflow-y:auto`) so the KPI row + card header stay
  fixed and only the table body scrolls, **and** only paints the first `BK_PAGE` (200) sorted rows
  until "show all" is clicked (`bkShowAll`) — DOM stays light even on a huge backlog. Sort/filter
  always operate on the full list before slicing, so paging can never hide the worst-ranked rows.
- **Real bug found live: "Jan '00" on the new Period chart.** A live Supabase query (run from the
  browser console against the deployed site) turned up ~9 GPR101 drawings with
  `actual_approval = "2000-01-06"` — a legacy-import sentinel/placeholder, not a real date — which
  stretched the whole chart's x-axis to a 25-year span. `periodKeyOf()` and `agingDays()` now discard
  any date outside 2015–2100 as "no date."
- **`kpiSection()`** — wraps a KPI row with a small uppercase eyebrow label ("Register Overview" /
  "Backlog Overview"), matching WPM's "Cost Overview" / "Work Package Status" section-label pattern.
- Assets `module.css?v=20260803d` / `module.js?v=20260803f`. Verified `node --check`; the sentinel-date
  bug and Bauhinia's row count were confirmed live before fixing (not guessed).

## Overview: Aging bar + Period chart (2026-08-03) — fmlozano
Added the two remaining WPM Overview charts, on top of the status donut from the previous pass.
- **`agingBuckets()`/`agingBarSVG()`** — a stacked horizontal bar over the whole project's open items
  (not status-approved), bucketed by `agingDays()` (>60d overdue / 30-60d overdue / 0-30d current /
  Future / No due date). Deliberately **unfiltered** — an aggregate independent of the Registry/Backlog
  filter bar's current selection, same scope as the status donut.
- **`periodBuckets()`/`periodChartSVG()`** — bar+line chart (grey bars = drawings planned to be
  approved that period, dark line = cumulative planned, red line = cumulative actual) grouped by
  `planned_approval`/`actual_approval`, with a Monthly/Quarterly toggle (`periodMode`, `.dr-seg`
  buttons wired after render).
- Both live in the Overview tab (`renderProgress`), above the existing Progress-by-Phase/Discipline
  tables. New CSS: `.dr-seg`/`.dr-seg-btn` (segmented toggle, mirrors the existing tab-strip style).
- Assets `module.css?v=20260803c` / `module.js?v=20260803e`. Verified `node --check`. **Not
  browser-verified** (auth wall).

## Pattern the WPM Backlog/Overview look further: Aging column, sortable headers, status donut (2026-08-03) — fmlozano
Follow-up after the tabs shipped: user pointed at the live WPM (Procurement) project view and asked to
match its look more closely.
- **`agingDays(r)`**: `today − requiredApprovalOf(r)` (falls back to `planned_approval` when unlinked to
  a schedule activity) — positive = N days overdue, negative = N days still to go, same convention as
  WPM's Aging(d) column. Added as a 7th Backlog column.
- **Sortable Backlog headers** (`bkSort`/`BK_COLS`/`bkSortVal`/`bkSetSort`): click any header to sort by
  it, click again to flip direction (▲/▼ indicator). Default is unchanged from before (most urgent
  first, via the existing `backlogUrgency`).
- **`donutSVG()` + `statusCounts()`** on the Overview tab: a ring chart (pure inline SVG, no library)
  showing drawing count by approval status, using `STATUS_COLOR` mapped to the same colors as the
  Registry's status pills (`statusCls`) so the two views agree visually.
- Assets `module.css?v=20260803b` / `module.js?v=20260803d`. Verified `node --check`. **Not
  browser-verified** (auth wall).

## Overview / Backlog / Registry tabs — procurement-style project view (2026-08-03) — fmlozano
Restructured the topbar from Register/Progress into three tabs matching the Procurement (WPM)
project-view pattern: **Overview | Backlog | Registry**.
- **Overview** = the existing "Progress" dashboard (`renderProgress`), unchanged.
- **Registry** = the existing "Register" grid (`renderRegister`), unchanged — this is "the current
  page folded into the Registry tab."
- **Backlog** (new): `backlogRows()` = drawings not `isApprovedStatus` OR still `Revise & Resubmit`;
  sorted by `backlogUrgency()` (uses the existing schedule-link `docFloatOf()` — negative/late first,
  then tight ≤3d, then un-linked rows ranked by status). KPIs (open items / late vs need-by / due
  ≤3d / Revise & Resubmit) + a table (Code/Title/Phase/Discipline/Status pill/Need-by chip); clicking
  a row opens the existing `openForm(r)` edit modal. Reuses `statusCls`/`needByCellHtml`/`kpi` — no
  new visual language introduced.
- `view` default changed `'register'` → `'overview'`; `restoreUI()` migrates old persisted values
  (`register`→`registry`, `progress`→`overview`) so a returning user's saved tab still resolves.
- No DB/migration change. Assets `module.css?v=20260803a` / `module.js?v=20260803b`. Verified
  `node --check` + confirmed all called helpers exist. **Not browser-verified** (auth wall).

## BAU101 (Bauhinia) migration prep: 5 new disciplines recognized (2026-08-03) — fmlozano
Preparing to migrate the Bauhinia project's real drawing register (multiple candidate sheets in
`EPC. OPS. BAU101 Drawing Register Version 01. 2025 03 14.xlsx`) surfaced construction-methodology
"disciplines" the importer didn't recognize: **Temporary Facilities** (workbook also spells this
"Temporary Works" in an older tab), **Safety Protection**, **Construction Equipment**, **Other
Specialties**, **MEPF Combined**. Without recognizing them, `disciplineHeader()` fell through to
the category-classifier and mis-nested those drawings under whichever discipline preceded them.
- Added all 5 as new `DISCIPLINES` entries + matching `disciplineHeader()` MAP keys — **purely
  additive** (new recognized labels only; every existing key/value/behavior for GPR101-style
  imports is untouched). `module.js?v=` bumped `20260726a`→`20260803a`.
- **Also found and worked around (not a code fix — a data-shaping one) during the same
  reverse-engineering pass:** the importer's category-vs-drawing classifier only distinguishes the
  two by "has at least one submission date OR a description" — it does **not** look at the drawing
  code at all. A drawing row with neither (exactly what you get when deliberately importing a
  design phase with no real submission history, i.e. skipping fabricated dates) is silently
  swallowed as a phantom category node. Not fixed in `parseGrid` itself (GPR101's own workbook
  apparently never hits this — its real drawings always carry a date or description — so changing
  the classifier's rule risks that primary format instead). Worked around **in the import file
  itself**: any dateless/descriptionless drawing gets its own (truthful, unembellished) title
  copied into Description before import, which is enough to survive classification.
- Verified by extracting the real `parseWorkbook`/`gridOf`/`findHeader`/`parseGrid` functions
  straight out of this file and running them in Node against the generated import workbook (not a
  reimplementation) — confirms the shipped importer, unmodified beyond the 5 new disciplines, parses
  the prepared BAU101 file into the intended phase→discipline→category→drawing tree with 0 drawings
  landing with a blank discipline and 0 stray dates on the dateless early-phase drawings.

## Offline editing + sync — Phase 2 (2026-07-26) — fmlozano
Wired the shared **PDSync** outbox (`assets/js/offline.js`): edit inline with no connection, sync on
reconnect.
- **`persistCell`** routes its update through `PDSync.write({table,op:'update',id,patch})` (falls back to
  a direct write if PDSync is absent). Optimistic `Object.assign(r,patch)` is unchanged, so the edit
  shows instantly whether online or queued.
- **Read-offline:** `load()` caches rows via `PDSync.cachePut('dr:'+pid, rows)` on success and, when the
  fetch fails (offline), renders from `PDSync.cacheGet`. `persistCell` re-caches after each edit so an
  offline reload shows the pending change (the outbox re-applies it on reconnect regardless).
- **Field-level LWW**, online behaviour byte-identical to before (see main CLAUDE.md).
- ⚠️ **Scope:** offline covers **inline cell UPDATES only.** The modal Add/Edit, single/bulk **delete**,
  Clear-all, and Excel import stay **online-only** (desk activities; deletes still call `load()`). No
  migration. Verified: `node --check` + the shared outbox Node harness. NOT browser-verified (needs a real
  offline→online cycle). Assets: new `offline.js?v=20260726d`.

## Live collaboration — presence + live cell editing (2026-07-26) — fmlozano
Proving ground for the app-wide **PDCollab** layer (shared `assets/js/collab.js`, Supabase Realtime).
Google-Sheets/Teams-style co-editing: topbar avatars of who's viewing the project, colored outlines of
the cell each person is editing, and live row updates when someone else saves.
- **Wiring:** `joinCollab()` (re)joins a per-project channel on load + project switch (`key =
  drawing_register:<pid>`, `table = drawing_register`). `renderPresence` → `#dr-presence` avatars.
  `broadcastSel(rowId,field,editing)` fires on cell click + on `beginEdit`/commit. `paintRemote()`
  (called at the end of `render()`) outlines each remote user's `tr.dr-drow[data-id] td[data-f]` cell
  via `PDCollab.paintCell`. `applyRemoteChange` patches `rows` from postgres_changes (INSERT/UPDATE/
  DELETE) and re-renders — **deferred while `.dr-editing` is open** (`_deferredRemote`) so a remote save
  can't wipe my inline input, then flushed on commit.
- **Conflict model:** last-write-wins per cell (a grid, not rich text). Two users on different fields of
  the same row both win; same-cell simultaneous edits converge via each write's own echo (brief flash).
- **Migration `../../migrations/2026-07-26-realtime-collab.sql` (USER MUST RUN)** — adds
  `drawing_register` to the `supabase_realtime` publication + `replica identity full`. Presence/cursors
  work WITHOUT it; only the live-value stream needs it. Without the migration the module still works
  (avatars + cursors), just no live row updates.
- Verified: `node --check` + presence-render unit checks. **NOT browser-verified** — needs two
  signed-in sessions to observe presence/cursors. Assets `?v=20260726a` (+ new shared `collab.js`).
- **Next:** once live-verified with 2 users, the same pattern drops into Project Schedule.

Developer change log for the **drawing-register** module. Also the **reference
module for file uploads** (private bucket + signed-URL viewing). Update every PR.

## Project Schedule link — Need-by column + auto-derived planned approval (2026-07-25)
Connected the register to the Project Schedule. A drawing is a prerequisite for construction work:
the linked activity's **start** is the drawing's **need-by** date, and (start − `lead_days`) is the
date it must be **approved by**.
- **Migration `../../migrations/2026-07-25-schedule-document-links.sql` (USER MUST RUN).** Adds
  `schedule_activity_id` (links to `project_schedule.activity_id`, the **business key** — survives P6/XER
  re-imports, which delete+reinsert rows and change the uuid), `schedule_wbs` (reserved for a coarser
  WBS-level link), and `lead_days` (NULL → `LEAD_DEFAULT` = 30).
- **Schedule cache** (`ensureSchedule`/`loadSchedule`): keyset-loads the project's leaf activities
  (`activity_id`, `activity_name`, `start_date`, `actual_start`) lazily after the main load, then
  re-renders the register. Skips WBS-Summary rows. Degrades quietly if the schedule can't be read.
- **New "Need-by" grid column** (`needByCellHtml`): shows the required-approval deadline + a **float
  chip** — green slack / amber ≤3d / red late — comparing the actual-or-planned approval date against
  the deadline. Blank when the drawing isn't linked. ⚠️ Adding the column touched **both** the header
  and `groupRowHTML`'s cell count (added the th + two empty `<td>`s so the group-row spans still align);
  `.dr-grid` min-width bumped 1080→1180.
- **Add/Edit form — "Schedule link" section:** an activity datalist (`schedOptions`, capped 3000),
  `lead_days`, a read-only **Required approval** preview, and a live hint that offers to **set it as the
  Planned approval** (checkbox, default on when the drawing has no planned approval yet). Saved via a
  **tolerant write** (strips the two new fields + warns if the migration hasn't run, so saves never break).
- Verified: `node --check` passes. **Not yet browser-verified** (auth wall + the schedule cache needs a
  real project with a schedule). Assets `?v=20260725a`.
- **Reciprocal not built here:** the Project Schedule "Documents" tab / document-readiness flag (the
  schedule-side view of the same link) is a follow-up in `modules/project-schedule/`.

## Audit fix: paginate the register load (2026-07-21)
`load()` used a single `select('*')` (Supabase caps at 1000) — the register **already truncated**
(the GPR101 workbook is 1,032 drawings), so the grid, Progress KPIs, phase/discipline roll-ups,
export and Clear-all silently operated on only the first 1000. Now **keyset-paginated** by `id`, then
re-sorted in memory to the previous DB order (`sort_order` ASC NULLS-LAST → `drawing_no`). Verified:
parses clean; Node test confirms the re-sort reproduces the DB order and the loop loads all rows. No
migration, no `?v=` bump.

## Status
- [x] Full-fidelity rebuild matching the Megawide "Drawing Register & Tracker"
      workbook (`GPR101. TEC. Drawing Register`).
- [x] CRUD + Excel import + export + progress dashboard
- [x] `enabled: true` in `assets/js/config.js`

## Project-Schedule-style row interaction (2026-07-17)

Asked to bring Project Schedule's grid feel here. **Most of it was already present** —
inline cell editing, click-to-select + Shift/Ctrl range, keyboard shortcuts, and group
collapse all existed. The genuine gaps were these four, each fixed:

1. **Drag-to-reorder rows — was entirely missing.** Drawings are now `draggable` and
   reorder within their own group, with Project Schedule's affordances: dimmed drag row
   (`.dr-rowdragging`), a red insertion line on the hovered target's top/bottom edge
   (`.dr-drop-above/-below`), and a grab cursor only while reorder is armed.
   - ⚠️ **`sort_order` is re-dealt from the group's OWN pool of values, never renumbered.**
     Phase order comes from each phase's *minimum* `sort_order` (`phaseOrderKey`), so free
     renumbering would silently reshuffle the phases. Re-dealing the same multiset keeps
     every phase's min fixed. Verified: after a reorder the SD1 pool is still `[10,11,12]`
     and phase order is unchanged. A NULL in the pool simply re-deals to whichever row
     should sort last (matching Postgres ASC NULLS LAST).
   - **Armed only when no filter/search is active** (`reorderEnabled()`), mirroring PS's
     `_reorderEnabled()`: with a filter on you'd be reordering against rows you can't see.
   - Reorder is refused across groups **and** across phases (dragover won't even accept the
     drop; an explicit toast explains why).
   - No migration — `sort_order` already exists on `drawing_register`.
2. **Collapse only fired on the small label span**, so clicking anywhere else on a group
   row did nothing — this is what made collapsing "feel unnatural" vs PS. The **whole group
   row now toggles** (PS's Excel-style behaviour); the label still owns dblclick-to-rename
   and buttons/checkboxes own their clicks.
3. **The add target was invisible.** Selecting a group set `selCtx` but showed no state, so
   "+ Add drawing" inserted into a level the user couldn't see was chosen. Group rows now
   carry `.dr-grpactive` (a red left rail, so the level tints still read) and it survives
   re-renders via `activeGrpKey`.
4. **Real bug — Add filed rows under the wrong level.** `selCtx` was only ever set from
   *group* row clicks, so selecting a **drawing** and hitting "+ Add" filed the new row
   under whatever group was last touched (or ungrouped). Clicking a drawing now sets the
   context from that drawing, so Add/Enter inserts a **sibling** next to it — PS's
   behaviour. Verified: click A-201 → Add → new row is `A-202` under AR/Elevation with the
   title editor open.

**Bug found in my own work during verification:** `buildModel()` walks `rows` in array
order (only sorted because `load()` fetches `.order('sort_order')`), so mutating
`sort_order` in memory persisted correctly but the row **didn't move on screen until a
reload**. Added `sortRows()` (NULLs last) before the optimistic `render()`.

**Not ported** (deliberate — large, and not what was asked): PS's row virtualization, cell
clipboard (TSV copy/paste), column chooser/column menu, and undo/redo. **Reorder is
therefore not undoable** — PS pushes a `reorder` undo entry, but this module has no undo
stack at all.

Harness-verified with a mutable store + real `DragEvent`s: move-to-top and move-back both
update display *and* store (`A-103@10, A-101@11, A-102@12`); cross-group and cross-phase
drags refused; phase order preserved; filters disarm and re-arm the drag; group-body click
collapses (6→2 rows) and re-expands; active group survives re-render; no regressions in
inline edit, status dropdown, single/shift select, or checkboxes.

## Shift-click text-selection + duplicate legend (2026-07-17)
- **Shift-click no longer drags a native text selection.** The `user-select:none` rule was gated on
  `.dr-grid.dr-reorder` (only during reorder), so range-selecting still highlighted text + popped the
  browser selection menu. Now `user-select:none` applies to all `.dr-grid td/th` unconditionally, with
  `user-select:text` restored on inputs/selects/textarea/`.dr-editin`. Verified: shift-click selects a
  4-row range with **0 characters natively selected**.
- **Duplicate-code flag redesigned.** Dropped the two-tone amber cell background (looked off). Kept a
  clearer round ⚠ badge on each duplicate code, and added a **legend chip** in the list bar —
  "⚠ N duplicate code(s)" — that is always visible when duplicates exist and **clicking it filters to
  duplicates only** (`filters.dupsOnly`; toggles back). Verified: legend counts distinct duplicated
  codes, badge on both offending rows, filter shows only the dupes and restores. `?v=20260717i`.

## "+ Add" no-selection fix (2026-07-17)
- **Root cause of "Add not working":** with nothing selected (the default all-collapsed view),
  `addDrawing` inserted an **ungrouped orphan** row (`D-001`, empty phase) at the bottom under a new
  "Ungrouped" phase — off-screen among the collapsed phases, so it read as "nothing happened."
- **Fix (matches Project Schedule):** when no phase/discipline/category/drawing is selected, "+ Add"
  now **opens the full Add form** (`openForm(null)`) so the planner sets the location explicitly.
  When a row/group IS selected it still inline quick-adds a sibling in that context (auto-numbered,
  editor opens). Verified in a harness: no-selection → form opens, 0 orphan rows; drawing selected →
  inline A-103 into Floor Plan with the title editor open; no console errors. `module.js?v=20260717h`.

## Topbar icons match Cash Flow (2026-07-17)
- The text **"Clear"** button abutted the dark-mode toggle (clash). Reworked the topbar tool
  cluster to match Cash Flow: **all secondary tools are icon-only** — Import (`upload`), Export
  (`download`), Clear (`trash`, red-tinted, hover→solid red). Kept `+ Add` (primary) and `+ Level`
  as the two labeled actions. Theme toggle `margin-left:4px` + user-bar `margin-left:10px`/border-left
  now exactly match Cash Flow spacing (14px gap Clear→toggle, no overlap; verified numerically).
- Added shared icons **`trash`** + **`upload`** to `assets/js/icons.js` (additive; drawing-register's
  `icons.js?v=` bumped to `20260717b`). Assets bumped `?v=20260717b`.

## Import fix, Add fix, + feature batch 1–6 (2026-07-17)
- **Import bug fixed — filename-as-code.** The workbook's "DWG No" column sometimes holds a
  submitted *file reference* (e.g. `2.3 4PH JAB RES SDP v 2.0 02-27-26.pdf`) instead of a code;
  the parser was using it as the drawing code. Now the code comes from the outline **"No" column
  (A)** and any filename in "DWG No" is kept as a `File: …` note in remarks (`fileRef`/`cleanDwgno`).
  Verified on the real file: 0 codes contain a filename; the two SDP rows now read `A-001` with the
  file note. **Re-import to apply.**
- **"+ Add drawing" fixed.** With nothing selected it inserted an *ungrouped* drawing under a
  collapsed "Ungrouped" phase → looked like it did nothing. Now it expands the target group
  (using `ph||'Ungrouped'`), scrolls to the new row, opens inline title editing, and warns when
  added ungrouped.
- **Feature 3 — persist per-project UI:** last view (Register/Progress) + collapse state saved to
  `localStorage` (`dr_view_<pid>`, `dr_collapsed_<pid>`) and restored on load (`saveUI`/`restoreUI`/
  `syncTabs`).
- **Feature 4 — inline date editing:** Latest Sub. + Approval columns are now double-click editable
  (`data-t="date"`); Latest Sub. writes the latest revision's `actual` (+`issue_date`), Approval
  writes `actual_approval`.
- **Feature 5 — saved filter views:** a **Views** menu in the filter bar saves/applies/deletes named
  filter presets per project (`dr_views_<pid>`).
- **Feature 6 — jump-to-phase:** a "Jump to phase…" select in the list bar (shown when >1 phase)
  expands + smooth-scrolls to that phase.
- **Feature 1 — frozen Code + Title columns:** sticky-left on the checkbox/Code/Title cells with
  opaque backgrounds per row-state (drawing/hover/selected + phase/disc/cat group tints, light+dark)
  so the drawing identity stays visible when scrolling right. Group label spans Code+Title
  (COLSPAN_LABEL 3→2 + explicit Rev cell). `.dr-grid` gets `min-width:1080px` so narrow viewports
  actually scroll. (Sticky repositioning is compositor-driven; couldn't observe it under the headless
  stalled compositor, but it's the same pattern Project Schedule uses and the sticky header works.)
- **Feature 2 — duplicate-code flag:** a code repeated within the same **phase** gets an amber ⚠ on
  the code cell (`computeDups`/`dupSet`/`dupKey`) so planners reconcile genuine source repeats.
- **Progress tab:** the filter bar is hidden on the Progress view (it only applies to the Register).
- Assets bumped `?v=20260717a`. Verified in a mutable-store harness: dup flag, inline date persist,
  saved views, jump, progress-filter hide, opaque frozen backgrounds, no console errors.

## Topbar consolidation + bulk status (2026-07-16)
- **Toolbar moved into the topbar** (matches Project Schedule): project selector + Register/Progress
  tabs sit left; the action cluster (**+ Add**, **+ Level ▾**, then icon buttons Import / Export /
  Clear) sits **beside the profile** in `.dr-topbar-tools` (flat, hover-fill; theme toggle + user-bar
  after it). Body keeps only a **slim filter bar** (search + phase/discipline/status). Title collapses
  to icon-only under 1150px. Removed the stray "Approved w/o comments" option from the status filter.
- **Bulk status change:** the selection bar gains a "Set status…" dropdown that applies a status to all
  selected drawings (`setStatusSelected`) — for approving/rejecting a batch at once.
- Harness-verified: project/tabs/tools all in the topbar, tools pushed right, no overflow at desktop
  width, tab switch + Add-from-topbar + Level menu + bulk-status all work; no console errors.

## Sidebar-less shell + level delete + audit (2026-07-16)
- **Sidebar removed** (matches Project Schedule / Cash Flow): a `.dr-modback` back-to-modules
  button + title in the topbar, full-width content (`.pd-content{width:100%}`; user-bar
  pushed right). More horizontal room for the grid.
- **Delete a level:** group rows now show a ✕ (planner+, hover) that deletes that phase/
  discipline/category **and everything under it** (`deleteLevel`, confirm with drawing count)
  — completes level CRUD (build / rename / add-under / delete).
- **Audit (harness-verified against a mutable store):** sidebar gone + back button; category/
  discipline **code chips** (A-100, A-200, AR-000) render; level delete cascades (row + node +
  child drawings gone); discipline rename cascades to drawings + node; add-level/add-drawing/
  auto-number/inline-edit/status-dropdown/shift-select/delete/keyboard all intact; no console
  errors. Import phase-split confirmed on the real file (see below).

## Editable tree grid + structural nodes (2026-07-16)
- **Build the level skeleton first:** a **"+ Level"** menu (planner+) inserts phase /
  discipline / category rows (`node_kind` on `drawing_register`, migration
  `2026-07-16-drawing-register-nodes.sql` — **user must run it**). Keyed by the
  phase/discipline/category text, so it stays backward compatible: existing imported
  drawings still group via their text; structural nodes just add explicit, code-bearing
  headers. Double-click a group name to rename (cascades to descendant drawings' text).
- **Add drawings under a selected row** (project-schedule style): select any group/row →
  **+ Add drawing** (or **Enter**) inserts a drawing in that phase/discipline/category,
  **auto-numbers** the code (increments the group's numeric suffix), and drops straight
  into inline title editing.
- **Excel-like inline editing:** double-click a cell (code / title / rev / sheets /
  approved / responsible) to edit in place; **Status is an always-on dropdown** that saves
  immediately. Full-editor modal still available per row (✎) for the code builder,
  submissions and file upload.
- **Selection + shortcuts:** click to select, **Shift-click** range, **Ctrl/Cmd-click**
  toggle, **↑/↓** move (Shift extends), **Ctrl+A** select-all-visible, **Delete** delete
  selected, **Esc** clear, **Enter** add drawing. Bulk "Delete selected" bar.
- **Status list:** dropped **"Approved w/o comments"** (redundant with "Approved");
  `normalizeStatus` maps the workbook's "without comments" → "Approved".
- **Compact one-screen grid:** sticky header, condensed columns, internal scroll.

## Importer: faithful phases + level codes (2026-07-16)
- **Phase blocks kept verbatim** (`cleanPhase`, anchored `PHASE_RE`): the workbook has
  design iterations — *Schematic Design 1/2/3/4 (Scheme 1/2…)* and *For Construction
  (FCD)* — that were previously **collapsed into one "Schematic Design 1"** (old `mapPhase`
  only knew 1 & 2), producing false "duplicate" A-101/A-102/A-103 across iterations. Now
  each block is its own phase, ordered by workbook appearance (`phaseOrderKey` = min
  sort_order). Verified on the real file: SD1(S1)=96, SD2(S1)=178, SD2(S2)=131, FCD=646;
  SD1 Floor Plan correctly = A-101, A-102 only.
- **Header rows import as structural nodes carrying their code** — A-100 Floor Plan,
  A-200 Elevation, AR-000 Architectural — shown as a red code chip on the group row (the
  codes were previously discarded). ⚠️ **Existing imports predate this — re-import
  (Clear all → Import) to get faithful phases + level codes.**
- Anchored `PHASE_RE` stops category/sheet titles ("Schematic Diagrams", "Construction
  Notes", "Neighbor's As-Built…") from being misread as phases.

## What it does
Project-scoped drawing register that mirrors the workbook:
- **Structured drawing code** from the "Coding Reference" sheet:
  `<proj>-<building>-<company>-<type>-<discipline>-<floor>-<number>-<rev>`.
  The Add/Edit modal builds it from dropdowns (types ECD/SD1/SD2/FCD/CSD/ISD/DRC,
  disciplines AR/ST/CV/EL/AU/PL/ME/FP/SD/LA, floors GEN/FD/GF/2F.., buildings
  TW1–TW9/GEN) with a live code preview.
- **Register view** grouped by **phase → discipline** with per-group roll-ups
  (sheets, approved, % bar). Filters: phase, discipline, status, search.
- **Multi-revision submission tracking** (`submissions` jsonb: `[{rev,planned,actual}]`)
  + planned/actual approval dates + approval status
  (For Review · Revise & Resubmit · Approved w/ comments · Approved w/o comments ·
  Approved · Superseded).
- **No. of sheets / approved sheets / approved %** per drawing; roll-ups per
  phase & discipline.
- **Progress dashboard** tab: KPI tiles (drawings, total/submitted/approved sheets,
  approved %, balance) + Progress-by-Phase and Progress-by-Discipline tables.
- **Import Excel**: reads the workbook's flat "Dwg Registry" layout (SheetJS).
  Infers phase/discipline/category from the sheet-title indentation + code prefix,
  extracts every revision's planned/actual submission dates, normalises status.
  Optional "replace existing"; chunked insert (200/req).
- **Export** the filtered register to `.xlsx`.
- **File upload** (unchanged): private `drawing-register` bucket, store the path,
  view via 60s signed URL.

## Importer notes (verified against the real GPR101 workbook)
- Picks the sheet whose header has both "Sheet Title" and a DWG/drawing column and
  yields the most rows. Header found by scanning the first 30 rows.
- Row classification is **title/code-driven, not date-driven** (discipline group
  rows carry roll-up dates yet are headers): phase header (title matches a phase
  name), discipline header (`disciplineHeader()` exact-ish match), building/tower
  header, else category header (title, no dates/desc), else a drawing sheet.
- Discipline falls back to the code prefix (`disciplineFromCode`, A→Architectural,
  M→Mechanical, …) when no group header applied.
- Verified offline with Node+SheetJS: 1032 drawings, correct phase/discipline
  split, per-revision (0–2) planned/actual dates, sheet counts, normalised status;
  only ~26/1032 edge codes (CS-/R-) left unclassified.
- `DrawingRegister._parseWorkbook(wb)` is exposed for testing (harmless).

## DB
- **Run migration `migrations/2026-07-16-drawing-register-full.sql`** — extends
  `drawing_register` with the code parts, phase/category/description/responsible,
  sheet counts + approved %, `submissions` jsonb, planned/actual approval dates,
  `sort_order`. Idempotent; folded into `supabase-schema.sql`.
- Requires the earlier project-access RLS + storage-buckets migrations (for the
  private `drawing-register` bucket used by file upload).

## Delete / bulk actions (planner+)
- **Clear all** button (shown only to super_admin/admin/planner) — deletes every
  drawing for the current project via a **type-the-project-id** confirm modal;
  removes attached storage files first. For fixing a wrong-project import.
- **Bulk select** — a checkbox column (planner+), per-group and select-all
  checkboxes, and a "N selected · Delete selected" bar. Chunked delete (100/req).
- Per-row Edit/Del unchanged. RLS still governs who can delete which rows
  (creator or admin), so a planner clears what they imported.

## Hierarchy & level styling (2026-07-16)
- Register is now a **4-level tree**: phase (L1) → discipline (L2) → **category (L3)** →
  drawing sheet (L4). Category was previously only a column, so the workbook's level-3
  rows (A-100 Floor Plan, A-200 Elevation, A-300 Section, …) never appeared as groups —
  now derived from each drawing's `category` field and shown as collapsible L3 roll-ups.
  A drawing with no category renders directly under its discipline (at L3).
- **Indentation + colour by level**: the first cell gets left padding per depth
  (10/30/50/70px) and a coloured inset rail (phase=red, discipline=dark gray, category=gray,
  drawing=line) plus graded row backgrounds. Each level is independently collapsible.
- Verified against the real workbook: 688/1032 drawings carry a category (78 distinct:
  Floor Plan, Elevation, Section, …), so the L3 groups populate.

## Import performance (2026-07-16)
- **Root cause of the hang:** `gridOf` used `sheet_to_json(..., {defval:''})` over the
  sheet's bloated `!ref` (the workbook's "Dwg Registry" sheet claims **16,383 columns**),
  allocating ~100M empty cells. Rewrote `gridOf` to read a **bounded window via direct cell
  refs** (columns capped at 60, real row range only). Added `sheetRows:8000` to `XLSX.read`.
  Parse now deferred one tick (so "Reading…" paints) and insert chunks `await` a 0-ms timeout
  (so progress repaints). Verified against the real workbook: read ~1s + parse ~0.4s (was
  hanging), same 1032 drawings.

## UI (2026-07-16 professional pass + toolbar/table refinement)
- **Toolbar** reorganised into two rows inside one card: row 1 = project selector · Register/
  Progress tabs · action cluster (**+ Add drawing** primary, divider, Import/Export, subtle
  **Clear all**); row 2 = search (grows) + phase/discipline/status filters.
- **Collapsible groups**: click a phase or discipline roll-up row to collapse/expand (caret
  indicator, `collapsed` state). **Level-1 (phase) groups start collapsed on load** so the
  register opens as a clean list of phase rows; an **Expand all / Collapse all** toggle in the
  list bar flips every phase at once (Expand all clears all collapse state incl. disciplines).
- Toolbar in a bordered card; segmented Register/Progress tabs.
- Table: sticky header, zebra hover, monospace drawing codes, tinted phase
  roll-up rows, gradient progress bars, compact row buttons, a "Showing N of M"
  count bar, selection bar.
- KPI tiles get an accent bar; dashboard tables restyled.
- Import guard: `canonDiscipline()` rejects a non-canonical discipline value
  (e.g. a stray "A-013" from a mis-detected column) so it can't become a group.

## Pending
- Live click-through against a real login + this project's data (module +
  UI harness-verified; importer tested against the actual workbook).
