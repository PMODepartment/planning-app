# Planners Dashboard — Main App Change Log

This file tracks the **main app** (shell) work, maintained by the Planning team
owner. Each module keeps its own `modules/<key>/CLAUDE.md`. One entry per prompt.

---

## 👋 START HERE if you are building a module (read before writing code)

If you are a developer (or a developer's Claude) assigned ONE module, do this:

1. **Read [`MODULE_CONTRACT.md`](MODULE_CONTRACT.md)** — the rules: folder layout,
   required HTML boilerplate, the shared APIs you must use (`AppAuth`, `PDb`,
   `Fmt`, `UI`), database rules, and the definition of done. This is mandatory.
2. **Read [`CONTRIBUTING.md`](CONTRIBUTING.md)** — git workflow: work on branch
   `module/<your-key>`, edit ONLY your `modules/<your-key>/` folder, PR to `main`.
3. **Copy a reference module** as your starting point:
   - `modules/risk-register/` — plain CRUD + filters + KPIs + a derived field.
   - `modules/drawing-register/` — same, PLUS the **file-upload** pattern
     (private Supabase Storage bucket + signed-URL viewing).
   - `modules/_template/` — the minimal skeleton.
4. **Do NOT edit** shared files (`assets/**`, other modules, the HTML shell).
   The only shared edits allowed: add YOUR table to `supabase-schema.sql`, and
   flip YOUR module's `enabled: true` in `assets/js/config.js`.
5. **Keep `modules/<your-key>/CLAUDE.md` updated** each PR (what you built, any
   columns/buckets you added).

Supabase URL + anon key are already in `assets/js/config.js`. Ask the app owner
for a test login. The shell (login, roles, project picker context via the
`pd_project` sessionStorage key, branding) is already done — just build your
module's screens against the shared APIs.

## Project summary
Consolidated dashboard for construction Planning Engineers (Megawide). Replaces
an existing Power Apps tool. Seven Phase-1 modules, each built by a separate
developer, plug into one shared shell.

**Architecture decisions (locked 2026-06-18):**
- Stack: vanilla HTML/CSS/JS, no build step, GitHub Pages hosting
- Backend: one shared **new** Supabase project (Postgres + Auth + Storage)
- Integration: shared shell + documented contract (`MODULE_CONTRACT.md`), single repo
- Auth: shared Supabase Auth + roles across all modules
  (`super_admin > admin > planner > user > viewer`)

**Reference:** Procurement WPM app —
`C:\Users\fmlozano\...\Procurement Dashboard\wpm\CLAUDE.md`
(same vanilla + Supabase + GitHub Pages pattern; Phase 2 will integrate with it).

## Key files
| File | Purpose |
|---|---|
| `assets/js/config.js` | Supabase creds + `MODULES` registry (flip `enabled` per module; `icon` = icon **name**) |
| `assets/js/auth.js` | `AppAuth` — login, roles, `requireLogin/requireRole/requireAdmin`. Login lands on `projects.html` |
| `assets/js/db.js` | `PDb` (projects/users/**workspaces**) + `Fmt` formatters |
| `assets/js/ui.js` | `UI` — toasts, avatar/user menu, modal, collapsible sidebar (`initShell`) |
| `assets/js/icons.js` | `Icons.svg(name,size)` + `data-ico` auto-hydration — the pro line-icon set (replaces emoji) |
| `assets/js/theme.js` | Dark mode (`html.pd-dark`), sun/moon toggle, FOUC guard |
| `assets/css/dashboard.css` | Global styles + design tokens (`--pd-*`) |
| `projects.html` | **Project Selector** (entry point): Workspace→Program→Project tree + project list |
| `dashboard.html` | **Project Home** for the selected project (Project/Program/Workspace tabs + module grid) |
| `admin.html` | User approval/roles/project-assignment + project & workspace management |
| `supabase-schema.sql` / `supabase-setup.sql` | All shared + module tables, RLS, grants, helpers, bootstrap |
| `MODULE_CONTRACT.md` | Rules every module developer must follow |

## Roles
| Role | Notes |
|---|---|
| `super_admin` | full control, only role that can set super_admin |
| `admin` | manage users/projects, all modules |
| `planner` | auto-approve writer, all projects |
| `user` | assigned projects only |
| `viewer` | read-only |

`status`: `pending` → `approved`/`rejected`. New sign-ups land in `pending`.

---

## Changelog

### 2026-07-01 — Prompt 39: Typed drag-to-link + per-WBS bar colors
- **Typed relationship on link drop.** Dropping a drag-to-link now opens a chooser
  (`openLinkChooser`) for relationship type **FS / SS / FF / SF** and **lag (days)** instead of
  always FS. `commitLink` builds the correct predecessor token (`1020`, `1020+5`, `1020 SS+3`,
  `1020 FF-2`, …) and appends it; round-trip through `predRels` verified for all types/lag signs.
- **Per-WBS bar colors (global + overrides).** Kept the global palette and added per-WBS color
  overrides that **cascade to descendant activity bars** (nearest branch wins via
  `effWbsColor`, checking self → ancestors). Managed in the **Colors ▾** menu "By WBS branch"
  section: pick a WBS, choose a color, Add; edit/remove existing ones inline. Stored per project
  in localStorage (`ps_wbscolors[pid]`), applied as inline bar background in `ganttRowHTML`
  (WBS summary + its activities + milestones), cached per-pid and invalidated on change.
- Validated token round-trips and the WBS-color cascade in isolation; syntax-checked the new
  UI functions. (OneDrive bash mount still stale → no full-file `node --check`.)

### 2026-07-01 — Prompt 38: Relationship-aware CPM, successors, bar colors, drag-to-link
- **Relationship-type + lag aware CPM.** `cpmLogic` rewritten: forward/backward passes now
  honor **FS / SS / FF / SF + lag** (previously all treated as FS with 0 lag — types/lag were
  drawn but ignored in the math). New `relCandidateES()` computes each successor's earliest
  start per relationship type.
- **Actual dates + data date.** With "Use actual dates" on: `actual_start`/`actual_finish`
  pin ES/EF, and unstarted future work is floored at the **data date** (today). New
  **Schedule ▾** menu exposes **Retained Logic** vs **Progress Override** (started activities
  ignore predecessor logic for remaining work) and the actual-dates toggle; both persist to
  localStorage (`ps_schedmode`, `ps_useactuals`) and recompute on change.
- **Successors (derived).** `computeCPM` now builds `_succObjs` (inverse of predecessors, with
  type/lag). Shown as a read-only field in the activity form and a new **Successors** column
  in the Excel export.
- **Global Gantt colors.** New **Colors ▾** menu with pickers for Task bar / Progress fill /
  Summary bar / Baseline / Milestone, applied via CSS vars (`--ps-bar/-prog/-sum/-bl/-mile`),
  persisted (`ps_colors`), with "Reset to brand" (reverts to Brandbook defaults incl.
  dark-mode overrides).
- **Drag-to-link.** New **Link** toolbar toggle: drag from one activity bar to another to
  create a Finish-to-Start predecessor (rubber-band line + target highlight), with
  already-linked and simple circular-link guards; auto-enables Critical-path view so the new
  arrow shows. Mirrors OPC's node-drag linking.
- Validated the CPM engine in isolation across FS chains, FS/SS lag, parallel float, and
  actuals+data-date scenarios; syntax-checked all new UI functions in isolation (OneDrive
  bash mount is serving a stale copy, so full-file `node --check` wasn't possible this run).
- **Note on scope:** before this, the schedule did NOT consider relationship type/lag in the
  math, nor Retained Logic / Progress Override, and used actuals only in the date-driven
  fallback. All four are now handled.

### 2026-07-01 — Prompt 37: Nested Group-by (WBS / Status / Responsible / Type)
- **"Group:" toolbar select** (WBS default / Status / Responsible / Activity Type). WBS keeps
  the original behavior; the other modes build a **nested tree**: group header → each group's
  pruned WBS ancestry → the group's activities.
- Refactored the renderer onto a **display-node model** (`buildNodes()`): every rendered row is
  a node annotated with `_dcode` (unique display code), `_ddepth`, `_danc` (ancestor codes),
  `_dkind` (`group` | `wbs` | `task`). Collapse/expand, span rollups, virtualization,
  critical-path connectors, and `Collapse to → Level N` all key off `_dcode`/`_dkind` now
  (was `data-wbs` / `isWbs`).
- Grouped mode clones WBS ancestor rows per group (originals untouched), recomputes summary
  bar spans per display code (`_dspan`), and shows an activity **count** on each group header.
- Group headers render with `.ps-group-row` (red-tinted) in the grid and `.ps-sum-group` in
  the Gantt to distinguish them from WBS summaries.
- Validated `buildNodes()` in isolation against synthetic multi-WBS data across all four modes
  incl. collapse behavior; nesting, counts, and span keys confirmed correct.

### 2026-06-30 — Prompt 36: Look-ahead + saved views + typed FS/SS/FF arrows
- **Look-ahead filter:** Filter → Schedule → Look-ahead (All / next 2/4/8/12 weeks) keeps
  activities active within the window (start ≤ window end and finish ≥ today).
- **Saved views:** "Views ▾" toolbar menu saves/loads/deletes named views (zoom + search +
  filters) in localStorage (`ps_views`).
- **Typed dependency arrows:** predecessor parsing now captures **relationship type
  (FS/SS/FF/SF) + lag** (`predRels`); Critical-Path arrows anchor by type (SS/SF from
  predecessor start, FF/SF to successor finish) with arrowheads and a type/lag label.
- Next: **Group-by** (WBS / Status / Responsible) — needs a careful pass on the virtualized
  tree renderer, doing it next.

### 2026-06-30 — Prompt 35: Build the S-Curve module (progress; EVM deferred)
- Built the dedicated **S-Curve module** (`modules/s-curve/`, enabled in config): live
  **Planned vs Actual cumulative-% progress curve** derived from `project_schedule`
  (paginated load), **duration-weighted**, with a data-date line, month/year axis, legend,
  and a monthly Planned%/Actual% table. KPIs: Overall progress, Planned-to-date,
  Actual-to-date, Schedule Variance (pp, red/green).
- **EVM intentionally excluded** (SPI/CPI/EAC/PV/EV/AC, cost) — a separate team owns the EVM
  dashboard. (An earlier draft that read the IBB cost columns was reverted per that scope.)
  Brand-colored: planned line dark gray, actual line red.

### 2026-06-30 — Prompt 34: Baseline variance + behind-schedule + near-critical
- **Var (BL) column** (resizable, persisted): finish variance vs BL0 finish in days —
  **+red = late, −green = early** (uses actual finish when set). Shown for activities & WBS.
- **Behind-schedule filter:** Filter → Schedule → "Behind schedule (overdue / late vs
  baseline)" — keeps activities that are late vs baseline or past-due & incomplete (plus WBS ancestors).
- **Near-critical highlighting:** activities with total float ≤ 5 days (but not critical) get an
  **amber dashed** bar/row when Critical Path is on. `NEARDAYS` tunable.
- Next round (remaining from the batch): S-curve + EVM metrics; look-ahead + group-by + saved
  views; typed FS/SS/FF dependency arrows with lag.

### 2026-06-30 — Prompt 33: Relationship (predecessor) import from OPC
- Importer now detects a **Predecessors / Relationships** column and stores it. The critical-path
  parser (`predIds`) extracts leading Activity IDs from OPC cell formats — `A1010 (FS)`,
  `A1010: FS+2d`, `A1010; A1020`, `1010,1020` — so relationships come in automatically.
- When predecessors are present the critical path uses **true logic-based CPM** (float from
  the network); otherwise it falls back to the date-driven driving path. No new column needed
  (`predecessors` already exists).

### 2026-06-30 — Prompt 32: Float column + CP tag in the activities grid
- Added a **Float** column to the activities grid (resizable, `--c-flt`, persisted). Each
  activity shows its total float in days; **critical/driving activities show a red "CP" tag**.
  Always visible (computeCPM runs in rebuild), so planners see float without toggling.

### 2026-06-30 — Prompt 31: Automatic critical path from dates + WBS levels
- Critical path is now **auto-derived from the schedule dates** (no predecessors required):
  a **driving-path** walk starting at the project follows the **latest-finishing child down
  each WBS level** to the leaves. Effective finish = `actual_finish` if set, else planned
  `end_date`, so it reflects actuals. Explicit predecessor logic (CPM) is still used when
  predecessors exist.
- **Auto-updates:** `computeCPM()` now runs inside `rebuild()`, so the path recomputes on
  every load/import and on any edit to planned or actual dates. The Critical Path toggle just
  shows/hides the highlight (bars + rows red, dependency lines when logic exists).
- Validated on Westside: driving path = Project → Phase 1 → Package 2 (Superstructure),
  the branch that sets the 21-Dec-2025 finish.

### 2026-06-30 — Prompt 30: Support the newer OPC export format (Avesta) in the importer
- The Avesta export uses OPC's richer layout (`ID, Name, Status, BL0 Start, BL0 Finish, Start,
  Finish, Planned/Earned Value POC, Planned/Actual/Earned Value IBB, …`) which broke the old
  importer: the activity name is in **Name** (not `Activity`), and loose matching grabbed
  **BL0 Start** for "Start".
- Rewrote `parseWorkbook` column detection to be **format-agnostic** (exact-match first,
  normalized headers): maps Name/Activity → name, real Start/Finish (not baseline),
  **BL0 Start/Finish → baseline bars**, **Status → activity status**, **Earned Value POC → %**,
  and **Planned/Actual/Earned Value IBB → planned/actual/earned cost** (₱ parsed). Old
  `Activity/Percent Complete/Planned Duration` exports still import unchanged.
- Verified by dry-run against both files (Avesta: 6,017 rows, names/status/baselines/costs
  correct; Westside old format: unchanged). No new migration — all fields already exist.
- **Action:** re-import the Avesta file with "Replace existing" to refresh it correctly.

### 2026-06-30 — Prompt 29: Fix schedule headers vanishing on Expand-all
- Grid + Gantt column headers disappeared when the schedule was fully expanded: in the flex
  column, the huge scroll content was shrinking the auto-height header to 0. Fixed with
  `flex:none` on `.ps-grid-head` / `.ps-gantt-head` and `min-height:0` on the scroll panes.

### 2026-06-30 — Prompt 28: Export to Excel + dependencies/critical-path + portfolio rollup
- **Export to Excel:** toolbar Export button writes the full schedule to `.xlsx` (SheetJS) —
  WBS, IDs, names, type, status, baseline/plan dates, duration, %, predecessors, cost fields.
- **Dependencies + critical path:** activities take a **Predecessors** field (Activity IDs) in
  the editor; a **Critical Path** toggle runs a CPM forward/backward pass (total float →
  critical when float=0), highlights critical bars/rows in red, and draws **dependency
  connector lines** between visible related activities. (The OPC export has no relationship
  data, so it prompts to add predecessors first.) New `project_schedule.predecessors` column.
- **Portfolio rollup:** the schedule module writes a per-project summary
  (`projects.schedule_progress / schedule_start / schedule_finish / schedule_activities`) on
  load; the Portfolio → Program/Workspace tables now show an **Avg Schedule %** KPI and a
  per-project **Schedule** progress bar.
- Migration `migrations/2026-06-30-schedule-predecessors-and-rollup.sql`. **User must run it.**

### 2026-06-30 — Prompt 27: Brand-color Gantt + legend + timeline header + admin-gated Clear
- **Brandbook colors only** (red #EE3124 / dark red / dark gray #2B2C2B / black #231F20 /
  construction gray #DCDBDB): recolored the Gantt — activity bar = dark gray track with a
  **red %-complete fill**, WBS summary = black bracket, milestone = red diamond, baseline =
  gray outline, data-date = red line. Bars use `--ps-bar/--ps-sum/--ps-bl` tokens that flip
  **lighter in dark mode** (the old dark summary bars were invisible on the dark theme).
- **Legend** added above the Gantt explaining each mark.
- **Timeline header fixed:** two tiers — year band on top, period labels below
  (Month → Jan/Feb…, Quarter → "Q1 ’20" with the year embedded, Year → years). Previously
  the top showed nothing useful when scrolled.
- **Excel-style collapse:** clicking anywhere on a WBS summary row expands/collapses it
  (the ▼/► toggle still works too).
- **Clear is admin-only** (hidden for non-admins) and now requires **typing the project code
  to confirm** instead of a browser popup. Note: a real password is intentionally NOT used —
  it can't be verified securely in client-side code; role restriction + type-to-confirm is the
  secure equivalent (RLS also blocks non-admin deletes server-side).

### 2026-06-30 — Prompt 26: Gantt virtualization + Clear button
- **Row virtualization:** the grid and Gantt now render only the rows in the viewport
  (+buffer) via a windowed renderer (`doRender` builds the shell + timeline scale + static
  layer once; `renderWindow` paints just the visible slice on scroll, rAF-throttled).
  Grid uses a full-height spacer with a `translateY` window; Gantt bars go in `#ps-tl-bars`
  over a static `.ps-tl-static` layer; row striping via `.ps-alt`. **Expand-all on 20k rows
  is now smooth** (only ~40 rows in the DOM at a time). renderGrid/renderGantt collapse to a
  single rAF render to avoid double work.
- **Clear button** — deletes all activities for the current project (confirm) for clean re-imports.
- Vertical scroll (either pane) drives the window; header still H-scroll-syncs.
- Remaining from the batch (next): Export-to-Excel, dependencies + critical path, portfolio rollup.

### 2026-06-30 — Prompt 25: Resizable columns, header fix, big-file perf optimization
- **Resizable columns:** each column header has a drag grip; widths driven by CSS vars
  (`--c-id/-name/-date/-dur/-pct`) so header + all rows stay aligned; widths persist
  (localStorage `ps_cols`). Date columns share one width.
- **Header always visible:** moved the column header out of `renderGrid` into a static
  `renderHeader()` rendered at init (was blank until data finished loading).
- **Performance (20k rows):** the sort + per-row segment parsing + date-range scan now run
  **once per data change** (`rebuild()`), not on every Collapse/Filter click; `hiddenRow`
  walks precomputed ancestor codes (O(depth)) instead of scanning all collapsed keys;
  **WBS roll-up spans precomputed** into `_spanMap` (summary bars were rescanning all rows).
  Collapse-to / Filter clicks are now near-instant.
- **Faster load:** `load()` gets the row count then fetches all pages **in parallel**
  (`Promise.all`) instead of 21 sequential requests (~1 min → a few seconds); grid header
  horizontal-scrolls in sync with the rows.
- Known follow-up: **row virtualization** so "Expand all" on 20k rows is smooth.

### 2026-06-30 — Prompt 24: OPC-style outline/refresh/filter + big-file import fixes
- Audited the FULL Westside export ("… (2).xlsx"): **20,716 rows** (16,223 activities +
  WBS), nested to **14 levels**, many 0-day milestones. Drove these changes:
- **Collapse-To dropdown** (replaces the 1-2-3 level bar): "Collapse to ▾ → WBS Level N",
  matching OPC's menu; "Expand all" kept (guarded with a confirm above 4,000 rows).
- **Refresh button** — re-fetches the schedule from the DB and re-renders (for when the
  Gantt should re-sync after edits).
- **Filter** (OPC-style dropdown) — by Activity **Status** (Not Started/In Progress/
  Completed) and **Type** (WBS Summary/Task/Milestone); keeps matching rows' WBS ancestors.
- **Milestone detection on import:** 0-day / date-only leaves import as **Milestone**
  (diamonds) with a single date.
- **Paginated load** (`.range()` loop) — Supabase caps at 1000 rows/req, so the full 20k
  now loads; **chunked insert raised to 500/req**; **large schedules default to a collapsed
  outline** (levels ≤3) so the browser doesn't render thousands of rows at once.
- Known follow-up: true **row virtualization** for "Expand all" on 20k-row schedules.

### 2026-06-30 — Prompt 23: Schedule UX — per-level outline, import loader, resizable split
- **Audited** the Westside City Site B OPC export against the parser: all 17 rows import
  cleanly (4 WBS + 13 activities), no missing dates/%/durations. (Row count varies by
  export because OPC only exports expanded rows; leaf WBS with no children import as activities.)
- **Per-level expand/collapse:** added a "Levels: 1 2 3 …" segmented control (auto-sized to
  the deepest WBS) that expands the outline to a chosen depth; per-row ▼/► toggles and
  Expand/Collapse-all remain.
- **Import loading indicator:** full-screen spinner overlay with live status
  ("Reading …", "Clearing …", "Importing N of M …") during parse + chunked insert.
- **Resizable split:** draggable divider between the activities grid and the Gantt
  (drag to favor either pane; min 240px each; width persisted in localStorage).

### 2026-06-30 — Prompt 22: Import OPC Excel export into Project Schedule
- Added an **Import Excel (OPC)** button to the Project Schedule toolbar. Parses an
  Oracle Primavera Cloud "Activities" `.xlsx` export **entirely in-browser** (SheetJS
  from cdnjs) and loads it into `project_schedule` for the current project.
- **Hierarchy from outline level:** OPC encodes the WBS tree via row outline levels
  (`!rows[r].level`), not columns — the parser reads those and generates dotted WBS
  codes (1, 1.1, 1.1.1, …). It also recomputes the sheet range because OPC writes a
  stale `<dimension>` that otherwise hides most rows.
- **Field mapping:** ID/Name, Activity (→ leaf task), Start/Finish (`DD-Mon-YY`, ` A`
  = actual → also fills actual_start/finish), Percent Complete (fraction → %),
  Planned Duration (`2,422d` → days). Leaf nodes import as **Task** (draggable bars),
  parents as **WBS Summary** (roll-ups) — so the whole tree shows on the Gantt.
- Preview modal (row counts + sample + "Replace existing" toggle) before writing;
  chunked inserts. `displayList` refactored to render a **full WBS tree** by dotted code.
- Verified: parser dry-run against the actual Westside City Site B export produced the
  correct tree (17 rows → 4 WBS / 13 activities) with right dates, %, durations.
- **Fix:** inserts were rejected by RLS (`created_by = auth.uid()`) because this app's
  `auth.js` has no `AppAuth.getUser()` — the module now captures the user id from the
  `requireLogin(user, profile)` callback (`UID`) and stamps `created_by` on both import
  inserts and the Add-activity form. (Delete/replace already worked via `is_admin()`.)

### 2026-06-30 — Prompt 21: Project Schedule → OPC-style Activities + interactive Gantt
- Rebuilt the **Schedule tab** of `modules/project-schedule/` into a Primavera-Cloud-style
  **split view**: WBS-grouped, collapsible **activities grid** (left) beside an
  **interactive Gantt** (right), with synced vertical scroll and a shared timeline.
- **Inline (Excel-like) editing at the activity level only** — click any activity cell
  (ID, Name, BL Start/Finish, Start, Finish, %) to edit; saves to Supabase on Enter/blur and
  recomputes duration. WBS summary rows are read-only and roll up their children's span.
- **Interactive Gantt:** drag a bar to move, drag edges to resize (updates start/finish +
  duration, persists); WBS summary bars, milestone diamonds, **baseline (BL0) bars**,
  **%-complete fill**, month grid, and a red **data-date line** (today). Month/Quarter/Year
  zoom; Expand/Collapse all; activity search.
- **DB:** `project_schedule` gains `bl_start`, `bl_finish` (migration
  `migrations/2026-06-30-schedule-baseline-columns.sql`, seeds BL0 from current plan).
  **User must run this migration.**
- Cost Loading tab, KPIs, Add/Edit modal preserved (modal now also takes baseline dates).

### 2026-06-30 — Catch-up (Desktop): Project Schedule build + design direction
Recorded here to sync the Desktop CLAUDE.md with the Teams ("Planners App
Project") work that has since landed on `main`.

- **`project-schedule` module built** (Primavera Cloud reference, not a module
  copy) and `enabled`. Two-tab layout: **Schedule** (WBS / Activity ID / Name /
  Type / Status / Planned & Actual Start-Finish / Duration / % Complete progress
  bar / Responsible Party) and **Cost Loading** (Planned/Actual cost, Earned
  Value, Cost Variance, CPI, % Complete + TOTALS). KPI cards (Overall % Complete,
  Completed, In Progress, Planned/Actual Cost, CPI, SPI). Filters + add/edit
  modal. Schema add: `migrations/2026-06-30-project-schedule-columns.sql`
  (`actual_start/finish`, `activity_type`, `status`, `responsible_party`).
  **No Gantt chart yet** — see direction below.

- **NEW DESIGN DIRECTION (2026-06-30):** mirror the **Procurement (WPM)** app —
  a **Portfolio Overview** and a **Project View**. **Focus the Project View
  first.** For **Project Schedule**, add an **Oracle Primavera Cloud (OPC)-style
  Gantt**: an **Activities grid on the left** (the existing Schedule table) with
  a **time-scaled Gantt bar chart on the right** (planned vs actual bars, today
  line, WBS grouping, zoom by day/week/month). The Gantt lives **inside the
  `project-schedule` module**, as a third view/tab alongside Schedule and Cost
  Loading. (Sample of the OPC activities + Gantt view to be provided by owner.)
- De-emoji / professional UI pass is complete (icons.js); the codebase contains
  no emoji. Any emoji still seen in the browser = stale GitHub Pages cache
  (hard-refresh) rather than source.

### 2026-06-30 — Prompt 20: Professional UI pass (de-emoji, SVG icon set)
- Replaced playful emoji throughout the app with a **professional monochrome
  line-icon set**. New `assets/js/icons.js` (`Icons.svg(name,size)` + `data-ico`
  auto-hydration); dependency-free, brand-colored via `currentColor`.
- `config.js` module `icon` values now icon **names** (camera, clipboard,
  contract, risk, compass, ruler, box, calendar, trendingUp, users, barChart, cash).
- Updated shell + pages to use icons: `dashboard.html` (sidebar nav, project
  switcher, module tiles, KPI cards, rollup tables), `projects.html` (nav,
  workspace tree, toolbar Add/▾/search/list-grid toggle, project rows & cards,
  workspace context chip), `admin.html` (nav). `theme.js` sun/moon toggle now
  inline SVG. Module pages (risk-register, drawing-register, project-schedule,
  _template) nav + tabs de-emojified and load `icons.js`.
- `dashboard.css`: icon alignment/theming block (`.pd-ico`, `.pd-navico`,
  module-tile glyph = brand red, tree/KPI/toolbar glyph alignment).
- Net effect: cleaner, enterprise-grade look appropriate for a construction firm;
  no functional changes. Auth-page `←`/`✓` kept (typographic, not playful).

### 2026-06-30 — Prompt 19: Program/Workspace rollups + Flores Group
- **Program & Workspace tabs now show real portfolio rollups** (no longer scaffold).
  Program tab = nearest Program ancestor (falls back to the Group Head node when a
  branch has no Program); Workspace tab = the project's workspace branch (node +
  descendants). Each shows KPI cards (Projects / Active / Original Budget /
  Estimated Cost / Budget Variance) and a project table (status, forecast dates,
  original vs estimated cost + variance). Rows are clickable to switch the active
  project. New tree helpers in `dashboard.html` (descendantIds, ancestorOfType,
  projectsInSubtree).
- **Added Group Head "Flores Group"** under Operations. Folded into the main
  migration seed + `supabase-setup.sql` + `supabase-schema.sql`; standalone
  `migrations/2026-06-30-add-flores-group.sql` for the live DB. **Run it (or
  re-run the workspaces migration) in Supabase.**

### 2026-06-30 — Prompt 18: Project Selector + Workspace hierarchy (Primavera-style)
- **New entry flow:** login now lands on **`projects.html`** (a Project Selector),
  not the module grid. You pick a project, then enter its **Project Home**.
- **Workspace → Program → Project hierarchy** (mirrors Oracle Primavera Cloud):
  new `workspaces` table (self-referencing tree; `node_type` workspace/program/
  group; `group_head` on group nodes = the assignment basis). Seeded the Megawide
  tree (Corporate Root → Production → Megawide EPC → Operations → Calimag/Rodrin/
  Ronquillo/Tan Groups, + PMO program, HoldCo, Bids).
- **`projects.html`:** left **workspace tree** (filter by node, counts) + right
  **projects list** grouped by workspace (Name/ID/Status/Group Head/forecast dates/
  budget) with **card/list toggle**, project search, workspace-scope context chip.
  **Add Project** and **Add Workspace/Program** (admin + planner) via modals.
  Selecting a project sets `pd_project`/`pd_project_name`/`pd_workspace` → Project Home.
- **`dashboard.html` → Project Home:** requires a selected project (else bounces to
  selector); topbar **project switcher** (jump between projects / back to selector);
  **Primavera-style tab bar Project | Program | Workspace** — module grid lives under
  **Project**, Program/Workspace are scaffold landing areas showing group-head + scope.
- **DB:** `projects` gains `workspace_id, group_head, description, project_manager,
  forecast_start, forecast_finish, original_budget, estimated_cost`. New `is_planner()`
  helper (SECURITY DEFINER). **Projects write policy widened to admins + planners**
  (`projects_write`); `workspaces` RLS (read = approved, write = planner+).
  Migration `migrations/2026-06-30-workspaces-project-selector.sql` (folded into
  `supabase-setup.sql` + `supabase-schema.sql`). **User must run this migration.**
- `db.js`: `PDb.getWorkspaces/createWorkspace/updateWorkspace`. Login redirects in
  `index.html` + `auth.js` fallback now point to `projects.html`.

### 2026-06-30 — Team restructure + priority modules
- **New developer assignments (priority phase):**
  - Cash Flow → **Georgette Dela Cruz** (gvymd)
  - Contracts, PMI & Claims Register → **Rachelle Ann Lungsod** (rachellelungsod)
  - Project Schedule & Cost Loading → **Loz Lozano** (fmlozano-pmo / PMODepartment)
- Georgette reassigned from `issues-lessons` to `cash-flow`; `issues-lessons` now unassigned.
- ONBOARDING.md tracker updated; priority modules marked.
- Development sequence: Cash Flow, Contracts & Claims, and Project Schedule are
  built first before resuming other modules.

---

### 2026-06-18 — Prompt 1: Foundation scaffold
- Initial project structure, shared shell, and developer contract.
- Added: `index.html` (login), `register.html`, `pending.html`, `dashboard.html`
  (module launcher driven by `APP_CONFIG.MODULES`).
- Added shared JS: `config.js`, `auth.js` (AppAuth), `db.js` (PDb + Fmt),
  `ui.js` (UI). Added global `dashboard.css` with design tokens.
- Added `supabase-schema.sql`: `projects`, `users`, starter table per Phase-1
  module, `is_admin()/is_approved()` helpers, and RLS policies (read-all-approved,
  write-own-or-admin) applied to every module table.
- Added `MODULE_CONTRACT.md` (folder layout, required boilerplate, shared APIs,
  DB rules, git branch-per-module + PR workflow, definition of done).
- Added `modules/_template/` (full working CRUD example) and placeholder
  `index.html` + `CLAUDE.md` for all 7 module folders.
- Added `README.md`, `.gitignore`.
### 2026-06-18 — Prompt 2: Admin screen + multi-dev git workflow
- Added `admin.html`: Users tab (approve/reject, inline role change with
  super_admin guard, per-user project assignment modal) + Projects tab
  (create/edit/archive via modal). Admin-gated by `AppAuth.requireAdmin`.
- Multi-developer collaboration handling:
  - `CONTRIBUTING.md` — per-developer git author identity, branch-per-module,
    rebase-before-PR, PR-into-main workflow. Recommends individual GitHub
    collaborator accounts over a shared login.
  - `.github/CODEOWNERS` — shared files → app owner, module folders → dev
    (placeholders to fill once devs assigned).
  - `.github/pull_request_template.md` — contract checklist.
  - `ONBOARDING.md` — copy/paste per-developer message + assignment tracker.

### 2026-06-18 — Prompt 3: Supabase wiring + Risk Register reference module
- Supabase project connected: URL `https://bgupuqnkqhixpuctyder.supabase.co`
  set in `config.js`. **anon key still pending** (user to paste; service_role
  key they shared was flagged for rotation — must NEVER be in client code).
- Schema already run by user in Supabase SQL editor. GitHub Pages enabled
  (deploy from `main`).
- Built **Risk Register** as the end-to-end reference module
  (`modules/risk-register/`): list view with filters + KPIs, 5×5 risk matrix,
  add/edit modal with app-computed `rating = likelihood × impact`, delete.
  Demonstrates every contract pattern (auth, pd_project, created_by, Fmt.esc).
- Flipped `risk-register` to `enabled: true` in `config.js`.

### 2026-06-18 — Prompt 4: Per-project RLS + Drawing Register reference module
- **anon key** pasted into `config.js` (verified role=anon). App can now reach DB.
- **Per-project access enforced at the DB level:** added `can_access_project()`
  helper; rewrote `projects` + all module-table RLS so admins see everything and
  planner/user/viewer only see projects in their `users.projects` array.
  Migration: `migrations/2026-06-18-project-access-rls.sql` (also folded into
  `supabase-schema.sql`). **User must run this migration in Supabase.**
- Built **Drawing Register** (`modules/drawing-register/`) as the file-upload
  reference module: status/discipline/search filters, revision + status pills,
  add/edit modal with file upload to a **private** Storage bucket, view via
  short-lived signed URL, delete (removes object + row). Enabled in `config.js`.
- Storage setup migration `migrations/2026-06-18-storage-buckets.sql` creates
  private buckets (`drawing-register`, `progress-photos`, `material-submittal`)
  + policies. **User must run this migration too.**

### 2026-06-18 — Prompt 5: Live verification
- GitHub Pages live at `https://pmodepartment.github.io/planning-app/`; login
  page + deployed `config.js` (correct URL + anon key) confirmed serving.
- **Bug found via live REST probe:** all tables returned `42501 permission
  denied` for `anon`/`authenticated` — table GRANTs were missing (separate layer
  from RLS). Fix: `migrations/2026-06-18-grants.sql` (grant DML to authenticated
  + default privileges for future module tables); folded into `supabase-schema.sql`.
  **User must run this migration.**

### 2026-06-18 — Prompt 6: Fix index↔dashboard redirect loop
- Verified data layer live: authed REST queries now return 200 (grants fix
  confirmed), RLS returns [] for unapproved users, anon blocked.
- **Bug:** infinite redirect loop index.html ↔ dashboard.html for users whose
  `auth.users` account has no `users` profile row (the promote UPDATE matched 0
  rows because the row never existed). `requireLogin` sent profile-less sessions
  back to index.html, which bounces sessions to dashboard → loop.
- **Fix (auth.js):** added `ensureProfile()` self-heal — a sessioned user with
  no profile row gets a `pending` row created, then goes to pending.html (never
  back to index.html). Hard stop signs out if profile truly can't be created.

### 2026-06-18 — Prompt 7: Brand alignment (Brandbook 2026)
- Adapted `assets/css/dashboard.css` design tokens to the Megawide Brandbook:
  Red `#EE3124`, Dark Red `#C42127`, Dark Gray `#2B2C2B` (dark surfaces), Black
  `#231F20` (text), Construction Gray `#DCDBDB` (lines), bg `#F4F4F4`.
- Typeface: Gotham (primary, licensed/not bundled) → **Montserrat** web fallback
  via Google Fonts `@import` (same convention as the Procurement WPM app). New
  `--pd-font` token; body + headings use it.
- Sidebar/topbar-dark and toast now use brand Dark Gray; brand wordmark heavier
  (800). Status colors kept distinct from brand red so errors ≠ brand.
- Single source of truth: all pages/modules inherit branding from dashboard.css;
  no per-page changes needed. If a Gotham webfont license is obtained, self-host
  it and it's picked up automatically (first in the font stack).

### 2026-06-18 — Prompt 9: Logo + favicon across all pages
- Added brand assets in `assets/img/`: `favicon.png` (red Megawide "M" block
  icon), `logo-white.png` (white wordmark, cropped to content), `icon.png`
  (apple-touch). Mirrors the Procurement WPM convention.
- Favicon + apple-touch link injected into every page's `<head>` (root + all
  module pages, with correct `../../` prefix).
- Sidebar `.pd-brand` now leads with the white wordmark (`.pd-brand-logo`) and
  shows the page label as a caption; auth pages show the red mark
  (`.pd-auth-mark`). CSS added to `dashboard.css`.
- `MODULE_CONTRACT.md` boilerplate updated so new modules include favicon + logo.
  Reference modules + `_template` already updated, so future modules inherit it.

### 2026-06-18 — Prompt 10: Dashboard UX polish (PowerApps-inspired)
- Topbar: title "Modules" → **"Project Management Portal"** with the red
  Megawide "M" mark (`.pd-topbar-mark`) beside it; user-bar pushed right.
- **Collapsible sidebar:** `UI.initShell()` (ui.js) auto-injects a hamburger
  toggle into the topbar of every shell page; desktop collapses sidebar to zero
  width (persisted in localStorage `pd_sidebar_collapsed`), mobile slides it in.
- Logo sizing optimized (sidebar wordmark 150px; topbar mark 30px).
- **Module cards redesigned** for the big white space: fixed 4-col grid
  (→3/2/1 responsive) so 7 cards distribute as 4+3; larger tiles with
  red-tinted icon squares, brand-red hover accent strip, clearer CTA/badge.
- Added welcome header ("Welcome, <first name>") above the grid.
- New tokens `--pd-red-light` / `--pd-red-mid`.

### 2026-06-18 — Prompt 11: Dark mode (shared, automatic)
- Followed the Procurement app pattern: token remap on `html.pd-dark`, applied
  before paint to avoid FOUC, persisted in localStorage `pd_theme`, with
  `color-scheme: dark` for native controls.
- New `assets/js/theme.js` (loaded in every page's `<head>`): applies saved/
  system theme immediately + auto-injects a 🌙/☀️ toggle into the top bar
  (shell pages) or as a floating round button (auth pages). Zero work for devs.
- `dashboard.css`: converted hard-coded `#fff`/`#fafbfc`/`#fbfbfb` component
  backgrounds to tokens so they adapt; added the `html.pd-dark` override block
  (bg #1C1C1C, card #2B2C2B, sidebar #161717, light text/borders) + toggle btn
  styles.
- `MODULE_CONTRACT.md`: boilerplate now includes `theme.js`; added a "dark mode
  is automatic — use tokens, never hard-code #fff/#000" rule. Reference modules
  + `_template` already wired via injection, so new modules inherit dark mode.

### 2026-06-18 — Prompt 12: Sidebar default-collapsed, PRC-style logo, profile menu, split name, forgot-password
- Sidebar now **collapsed by default** on entry (clean look); only an explicit
  expand (localStorage `pd_sidebar_collapsed='0'`) keeps it open.
- Sidebar brand restyled to match PRC-App: white wordmark fills width
  (left-aligned), red uppercase app label, divider beneath.
- **Profile avatar menu** (PRC-style): `UI.renderUserBar` now renders a round
  initials avatar; click → dropdown with name, role, and **Sign out**. Outside-
  click closes. Token-based (dark-mode ready).
- `register.html`: Full name split into **First name / Last name** (joined into
  `users.name`).
- New **forgot-password.html** (shared styles + theme.js) using
  `resetPasswordForEmail` with a redirect back to `index.html`; linked from the
  login page ("Forgot password?").

### 2026-06-18 — Prompt 13: Add 4 Phase-2 modules to the dashboard
- Registered 4 new modules in `config.js` (enabled:false → "In development"
  cards): `project-schedule` (Project Schedule, Cost Loading & S-Curve),
  `resource-loading`, `productivity-rates`, `cash-flow`.
- Created each module folder with a branded placeholder `index.html` +
  onboarding `CLAUDE.md` (same pattern as Phase-1 placeholders).
- Added starter tables to `supabase-schema.sql` + the RLS array; new migration
  `migrations/2026-06-18-phase2-modules.sql` (tables + grants + per-project RLS).
  **User must run this migration in Supabase.**
- Updated ONBOARDING.md assignment tracker.

### 2026-06-18 — Prompt 14: Handover readiness kit
- **`supabase-setup.sql`** — one-paste consolidated setup (all tables, grants,
  helpers, RLS, storage buckets, **demo project `DEMO01` + sample risk/drawing
  rows**, bootstrap admin). Supersedes running individual migrations.
- **`SETUP.md`** — owner checklist: config keys, run the SQL, **Supabase Auth
  settings** (email confirmation OFF, password-reset redirect URLs), bootstrap,
  GitHub Pages/branch-protection/CODEOWNERS, per-dev onboarding (self-register +
  approve + assign DEMO01), troubleshooting (42501 grants, login loop).
- **`REVIEW_CHECKLIST.md`** — PR review checklist against the contract.
- **`CONTRIBUTING.md` §1b** — run-locally runbook (static server, DEMO01 login).
- Updated README, ONBOARDING (DEMO01 access flow).
- Decision: developers get access via **self-register + owner approval**.

### 2026-06-18 — Prompt 17: Admin "delete user completely"
- New SECURITY DEFINER function `admin_delete_user(uuid)` — deletes `auth.users`
  (cascades to `public.users`), **freeing the email so the person can Request
  Access again**. Nulls their `created_by` authorship first (data kept) so FKs
  don't block. Admin-only; no self-delete; only super_admin deletes super_admin.
  Migration `2026-06-18-admin-delete-user.sql`; folded into setup + schema.
  **User must run this migration.**
- `PDb.deleteUser(id)` → calls the RPC; `admin.html` red **Delete** button per
  user (hidden on own row) with a confirm modal; shared `.pd-btn-danger` style.

### 2026-06-18 — Prompt 16: Split S-Curve into its own module + KPI contrast fix
- Renamed `project-schedule` to **"Project Schedule & Cost Loading"**; added a
  separate **`s-curve`** module (📈) with folder, placeholder, onboarding CLAUDE.md.
- New `s_curve` table (period, planned/actual value + cumulative, % planned/
  actual) in `supabase-schema.sql` + `supabase-setup.sql` + RLS arrays; migration
  `migrations/2026-06-18-s-curve-module.sql`. **User must run it on the live DB.**
- ONBOARDING tracker updated (now 13 modules total).
- Fixed Risk Register KPI card contrast (High/Medium were unreadable): scoped
  rating-band backgrounds to pills + matrix cells only; KPI cards keep the card
  surface with a token-colored number.

### 2026-06-18 — Prompt 16: Split S-Curve into its own module
- `project-schedule` renamed to **"Project Schedule & Cost Loading"**; new
  **`s-curve`** module ("S-Curve", 📈) added to `config.js`.
- New `modules/s-curve/` folder (placeholder + onboarding CLAUDE.md); refreshed
  `project-schedule` placeholder for the new name.
- DB: new `s_curve` table (period, planned/actual + cumulative, % planned/actual)
  in `supabase-schema.sql` + `supabase-setup.sql` + RLS arrays; migration
  `migrations/2026-06-18-s-curve-module.sql`. **User must run this migration.**
- ONBOARDING tracker updated (project-schedule renamed + s-curve row).

### 2026-06-18 — Prompt 15: Verify setup + fix RLS recursion (54001)
- Verified live: pages serve latest (forgot-password, theme.js, phase2 config);
  Phase-2 tables exist + grants OK (200 []).
- **Bug found:** `projects`/`risk_register`/`drawing_register` returned
  `500 — 54001 stack depth limit exceeded` (RLS infinite recursion via helper
  functions querying `users`, whose own policy calls them back). Surfaced only
  now because those tables have rows (DEMO01 seed); empty tables didn't trip it.
- **Fix:** helper functions `is_admin()/is_approved()/can_access_project()` now
  `SECURITY DEFINER set search_path = public` (bypass `users` RLS → no recursion).
  Migration `2026-06-18-fix-rls-recursion.sql`; folded into both
  `supabase-setup.sql` and `supabase-schema.sql`. SETUP.md troubleshooting noted.
  **User must run the fix migration on the live DB.**

- **Still TODO (handover):** run `2026-06-18-fix-rls-recursion.sql` (or re-run
  the helper-function block of supabase-setup.sql) on the live DB; run
  `supabase-setup.sql` (adds DEMO01 + phase2
  tables); set Auth email-confirmation OFF + reset redirect URL; add devs as
  collaborators + fill CODEOWNERS usernames; send ONBOARDING messages.
  buckets via the migration; branch protection on `main`; live end-to-end test;
  remaining modules (issues-lessons, contracts-claims, stakeholder-map,
  material-submittal, progress-photos) — or hand to developers.
