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
| `planner` | auto-approve writer, assigned projects only (may create new projects) |
| `user` | assigned projects only |
| `viewer` | read-only |

`status`: `pending` → `approved`/`rejected`. New sign-ups land in `pending`.

---

## Changelog

### 2026-07-22 — Dashboard: remove redundant Program/Workspace tabs from Project Home
- `dashboard.html` (Project Home) is scoped to ONE selected project, but the **Program** and
  **Workspace** tabs rendered cross-project portfolio rollups (same `portfolioHtml`, different ancestor
  node) — redundant with the far richer **Portfolio Overview module** already linked in this page's
  sidebar (donut, budget bars, grouping, filters, S-Curve/Cash Flow), and a scope mix (one-project home
  showing many-project tables). User chose **delete** over repurpose.
- Removed the tab bar + both panels (Project Home is now a clean module launcher) and deleted the dead
  code: `wireTabs`, `renderScaffolds`, `renderProgramTab`, `renderWorkspaceTab`, `portfolioHtml`,
  `breadcrumbHtml`, `schedCell`, `statusPill`, `wirePortfolioRows`, `card`, and the tree helpers
  (`buildChildren`/`childrenOf`/`descendantIds`/`ancestorOfType`/`projectsInSubtree`). Kept
  `pathOf`/`groupHead`/`renderHeader`/`renderSwitcherMenu` (project switcher). 271 → 154 lines.
- **Live-verified** (deployed, logged-in Chrome): Project Home renders no tab bar, 12 module cards, the
  project switcher header (full workspace path + Group Head) and its dropdown (16 projects + All
  projects link) both work, Portfolio Overview still in the sidebar; no console errors. Shell HTML/JS
  only (no shared asset changed), so **no `?v=` bump**.

### 2026-07-22 — Project Schedule: fix cell-nav horizontal autoscroll (cells hidden behind frozen columns)
- User: Left/Right/Tab didn't autoscroll columns correctly. The #, Activity ID, Activity Name columns
  are position:sticky and float over the viewport's left edge, so a cell could be scrolled into view yet
  stay hidden behind them; `scrollCellVisible` ignored that (checked `left < scrollLeft`), so it never
  uncovered left-obscured cells and scrolled pointlessly on frozen targets. Fixed to reserve the frozen
  columns' width as the true left edge and no-op for frozen targets.
- **Live-verified** (GPR101): all 11 visible columns revealed from every scroll position (old algo
  failed all); ArrowRight scrolled 0→274, ArrowLeft 274→0, active cell always visible. Module-local, no
  `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: Gantt timeline no longer starts years before the schedule
- User: Gantt showed bars/timeline from ~2022 though the schedule starts 2025. Not stray data (verified
  live the dates are clean) — `range()` padded the timeline **2 years before / 3 after** the schedule
  (old deep-scroll feature) and opens scrolled to the far-left past. Tightened to ~1 month before / 1
  quarter after; pane still scrolls. Live-verified: GPR101's Gantt header went 2024–2032 → 2026–2029,
  opening at the project start with no empty leading years. Module-local, no `?v=` bump.
  See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: one-call schedule_rows RPC (fast cold load)
- Cache made *reopen* instant; this makes *cold first-open* fast. New SQL function
  `schedule_rows(project_id) returns jsonb` returns ALL of a project's rows as one jsonb array in a
  SINGLE round-trip (scalar jsonb return isn't row-capped), collapsing the ~8 keyset pages into 1.
  `security invoker` so RLS still applies. Migration **`migrations/2026-07-22-schedule-rows-rpc.sql`
  (USER MUST RUN)**; idempotent.
- Client `load()` calls the RPC first and **falls back to keyset pagination if it's absent**, so it's
  safe to deploy before/after the migration. **Live-verified** (migration not yet run): RPC returns 404,
  fallback loads a 17,122-activity project fine — no regression. Speedup activates once the migration
  runs. Module-local JS + new migration, no `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: cache-first load (instant reopen via IndexedDB SWR)
- Goal: eliminate the schedule's loading time on open. **Measured first:** a 6k-activity project
  cold-loads in ~8.9s across ~8 sequential paginated round-trips — the wait is round-trip latency ×
  page count, **not bytes**. So "lean columns" was deliberately skipped (wouldn't cut round-trips, risks
  dropping fields). Instead made **reopen instant** with an IndexedDB stale-while-revalidate cache: paint
  the cached rows immediately (no overlay) + a "Cached · updating…" badge, then re-fetch and reconcile to
  "Live". Edit-guard (`_editSeq`) prevents a mid-fetch edit from being clobbered; cached rows are cleaned
  of computed fields; count round-trip skipped on the cached path.
- **Live-verified:** reopening Avesta painted from cache in **~640ms vs ~8,900ms cold (~14×)**, badge
  cycled Cached→Live, no console errors. Cold first-open unchanged — the real fix for that is a one-call
  server RPC (follow-up, same pattern as `schedule_scurve_agg`). Module-local, no migration, no `?v=`
  bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: inline Status dropdown in the grid (one-click change)
- Changing an activity's status required right-click → Edit activity (tedious on 10,000+ activities).
  The grid Status cell is now a dropdown (the coloured pill IS a `<select>`) for writers, so status
  changes in one click in the grid; read-only users keep the static pill. Routed through `_statusPatch`
  (same completion side-effects as the detail Status field) and the undoable `persist()`. Only ~visible
  rows render a select (grid is virtualized), so no cost on huge schedules.
- **Live-verified** (deployed, logged-in Chrome): renders as enabled selects on real projects; on the
  DEMO01 sandbox a dropdown change persisted through a full DB reload, then was restored. Module-local,
  no migration, no `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: fix grid keyboard shortcuts (Arrow/Tab/etc.) never firing
- User: Arrow keys scrolled the panel instead of moving the selection; Tab traversed page buttons, not
  grid cells. Root cause: the grid keydown handler bailed on a bare `querySelector('.pd-modal-overlay,
  …')` presence check, but `#ps-modal` **is** `.pd-modal-overlay` and is always in the DOM
  (`display:none`) — so it matched every keystroke and returned before any branch, killing all
  Excel-style navigation.
- **Fix:** bail only for overlays that are actually visible (`offsetParent !== null`); the hidden
  `#ps-modal` no longer blocks (its open state is still covered by the display check above). Live-verified
  on the deployed app (ArrowDown moves selection + prevents scroll; Tab sets the active cell + prevents
  button traversal). Module-local, no `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: virtualize the WBS Manager tree (+ live verification)
- Broad searches / Expand-all painted every visible row into the DOM (up to ~7,700 rows → ~1s+). The
  tree render now flattens the visible nodes into a list and only paints the scroll-viewport window
  (~24 rows) offset by `translateY` over a full-height spacer — same virtualization as the grid/Gantt.
  Listeners are delegated on the persistent container so they survive per-scroll window repaints.
- **Live-verified** on the 8,596-node project (deployed, logged-in Chrome): Expand all = **45ms with 23
  DOM rows** (was 1,433ms / 8,596 rows); extreme search "a" = **6,671 matches / 7,691-row set → 24 DOM
  rows, no freeze**; delegated caret/row-select work; no console errors. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: fix wbs_nodes 1000-row truncation + live-verify the WBS Manager
- Verifying the WBS optimization **live on a large project** surfaced a pre-existing bug: `load()`
  fetched `wbs_nodes` with a plain `select('*')` (Supabase caps at 1000), so big P6 imports loaded a
  **truncated tree** — children past row 1000 vanished from the walk. Live symptom: a project showing
  "1000 nodes" but only 2 connected rows. **Fixed** with keyset pagination (same as the audited
  resource/drawing/photo loads); also fixed the copy-WBS-from-project source read. No migration, no `?v=`.
- **Live-verified** (deployed site, logged-in Chrome): the project actually has **8,596 WBS nodes**
  (was capped at 1000). Default load = 6 rows instant; Expand all = 8,596 rows in ~1.4s; Collapse all =
  1 row in ~114ms; caret toggle works; search "Closeout" = 20 matches / 62 rows with correct
  full ancestor chains (6-level-deep match revealed); no console errors. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: optimize the WBS Manager (indexed render + collapse/search)
- `renderWbsManager` was O(N²)/O(N·rows) and rendered every node at once, freezing the tab on
  P6-scale trees (~14k nodes / ~27k activities). Rebuilt around a **one-pass index**
  (`_wbsBuildIndex`: byId / sorted childrenOf / activity counts / codes) so the render walk does no
  per-node scans — benchmarked **11,171ms → 12ms** on a 14,420-node fixture. `computeWbsCodes`
  de-nested the same way (O(N²·log N) → O(N·log N), identical output, verified).
- Added **collapse/expand** per node (only visible rows hit the DOM; large trees default-collapse
  below the top level), toolbar **Expand all / Collapse all**, and a **search box** that reveals
  matches + their ancestors. Editing behavior (all row buttons, rename, select) unchanged.
- Module-local, no migration, no `?v=` bump. Inline script parses; logic unit-verified in a Node
  harness. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: make the merged Last Planner section collapsible
- Follow-up to the merge below. The Last Planner block made the Planner Cockpit a long scroll on load,
  so its section divider is now a toggle (rotating chevron) that collapses/expands the whole weekly
  section; state persists per browser (`localStorage['ps_lp_collapsed']`, default expanded). Module-local
  HTML/CSS/JS only → **no `?v=` bump**. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: merge Last Planner into the Planner Cockpit tab
- User flagged the **Planner Cockpit** and **Last Planner** tabs as redundant / low-value as two
  separate top-level views. Chose to **merge (keep all functionality), not remove**: the Last Planner
  weekly section (week nav, PPC KPIs, weekly commitments, PPC trend, reasons-for-variance) is now a
  section **inside the Planner Cockpit view**, under a divider, below the cockpit KPIs/forecast. The
  separate `lastplanner` tab + `#ps-view-lastplanner` wrapper are gone; `switchTab`/`renderAll` render
  both cockpit + Last Planner when the `planner` tab is active.
- IDs unchanged (`ps-ck-*`/`ps-lp-*` never collided) so all handlers keep working; no DB/migration
  change, module-local HTML/CSS/JS only → **no `?v=` bump**. Verified in-browser: no console errors,
  Last Planner table resolves inside the cockpit view, old view removed, 0 `lastplanner` refs remain.
  See `modules/project-schedule/CLAUDE.md`.

### 2026-07-21 — Project Schedule: remove dead old cost-table code (cleanup after the EVM rebuild)
- Follow-up to the Cost/EVM rebuild below: it orphaned the old per-activity cost table, leaving
  `COST_COLS`, `_vc`, `costW`, `costColW`, `costVisibleCols`, `startCostColResize` and the
  `table.ps-cost-table`/`.ps-cost-th` CSS as dead code. Removed them after verifying **zero live
  references**, and simplified `renderColsMenu` to drop its unreachable `onCost`/`COST_COLS` branch
  (the Columns chooser is Schedule-tab-only — the toolbar is hidden on other tabs).
- **Behavior-preserving** (removed branch was already unreachable; `startCostColResize` had no
  callers; `applyColHidden` used only `gridCols()`). Verified: no dangling references, script parses,
  and on the deployed page the Cost/EVM dashboard + Schedule column chooser both still work.
  Module-only, no `?v` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-21 — Project Schedule: Cost Loading tab rebuilt into a Cost / EVM dashboard
User flagged the Cost Loading tab as a low-value flat table that doesn't reflect how P6/OPC do cost
loading (time-phased). It was also redundant — the Schedule grid already shows per-activity cost
columns and the **Activity Usage** detail tab already draws the time-phased per-activity cost curves.
Rebuilt it as a project-level **EVM dashboard** (tab relabelled **Cost / EVM**):
- **EVM KPIs** at the data date: BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, VAC, TCPI + an over/under-budget ·
  on/behind-schedule status chip.
- **Cost S-curve**: cumulative Planned Value (linear spread over each activity's dates) + EV/AC points
  at the data date + a BAC reference line.
- **Cost variance by WBS**: `_costMap` roll-up (Budget/Actual/Earned/CV/CPI/%Spent), over-budget rows
  flagged, + TOTAL — the "where's the money bleeding" view, distinct from Activity Usage (per-activity
  curves) and Cash Flow (funding timing).
- `renderCost()` guards on `activeTab==='cost'` (heavier than the old table; `renderAll` calls it every
  render). Old flat-table helpers left as inert dead code (the cost-tab toolbar/chooser is hidden).
- Verified: parses clean; EVM aggregation unit-tested (SV −10k/CV −15k/SPI 0.9/CPI 0.857/EAC 350k/VAC
  −50k/TCPI 1.077); browser harness with a cost-loaded fixture rendered KPIs, the PV S-curve, status
  chip, and the WBS variance table with no console errors. No migration, no `?v=` bump.

### 2026-07-21 — Project Schedule: fix the ACTUAL "count populated, grid empty" bug (deferred render)
- **Verified the load-race fix (below) on the deployed page with a real 17,122-activity project and
  found the screenshot bug still reproduced** — so the race fix, though correct, addressed a different
  failure mode. On initial load the footer showed "17122" while the grid read "Select a project." for
  ~8s, then self-corrected.
- **Real root cause (from live timing):** `load()` sets the footer via `rebuild()` right after
  pagination (~2s), then `await`s `loadResourcesAssignments()` + `_wbsEnsureSummaries()` (several
  seconds on a 17k-activity project) and **only rendered the grid AFTER those** — so the grid kept its
  stale "Select a project." paint the whole time.
- **Fix:** `renderAll()` immediately after `rows = all; rebuild()` (collapse block moved up too), then
  load resources, then `renderAll()` again. The grid/Gantt need only `rows`; resources/WBS_NODES are
  for other tabs. Closes the window from ~8s to ~0.
- Verified live that rendering works (a user-triggered switch to the same 17k project paints
  correctly) — only the paint *timing* was wrong. Re-verify on deploy. Module-only, no `?v` bump.

### 2026-07-21 — Project Schedule: fix load race (count populated, grid empty)
- Screenshot showed a 16,409-activity project with the footer count set but the grid reading "Select a
  project." **Root cause: `load()` is async + paginated (~17 sequential round-trips for a 16k schedule)
  with no re-entrancy guard** — switching/deselecting a project mid-load let the stale load commit its
  `rows`/count/render after `pid` had already changed, so the footer and grid disagreed about the
  selection (grid ends up empty or showing a deselected project's rows depending on timing; same bug).
- **Fix: a monotonic `_loadGen` token** — `load()` claims `gen = ++_loadGen` and bails after every
  await if a newer load started; the `!pid` branch also clears the overlay. Applies to every load
  caller (switch, undo/redo, import, scenario restore).
- **Verified in a Node harness** modeling the real load/rebuild/doRender + rAF: without the guard, 2 of
  3 mid-load scenarios leave pid/footer/grid inconsistent; with it, all three are consistent. Parses
  clean. Module-only, no `?v` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-21 — Project Schedule: brand icon beside the title (uniform topbar)
- The Project Schedule title is a **view-switcher button**, so it never carried the brand-red module
  icon every other module shows — the `calendar` icon only lived inside the switcher's dropdown items.
  Added it before the title text (`[calendar] Project Schedule ▾`).
- ⚠️ The existing muted-icon rule for the chevron also matched the new icon; overrode it with
  `.ps-title-btn span.ps-title-ico` (higher specificity) so the module icon is brand-red while the
  chevron stays muted. Verified in a harness (real markup + CSS + icons.js): SVG hydrates, brand-red
  in light and dark, chevron unaffected. Module-only, no `?v` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-21 — Project Schedule Cost Loading: fix WBS/name overlap + duplicate ID
- **WBS code overlapped the Activity Name** ("1.4.2.5.2.3.1Cabinetry", ghosted). Root cause: the Cost
  Loading table is `table-layout:fixed` but `.ps-table td` had no overflow clipping, so a WBS `<code>`
  wider than its column bled into the next cell. Fixed by clipping cells (`overflow:hidden` +
  ellipsis + a `title` tooltip for the full value), widening WBS 90→120px, and monospacing the code.
  Headers now **wrap** instead of clipping mid-word — via `table.ps-cost-table th` to outspecify the
  later `.ps-table th { white-space:nowrap }`.
- **Latent duplicate `id="ps-cost-body"`** (the Cost Loading tbody and the "Cost Accounts (CBS)" modal
  panel) — `renderCostAccounts()` was writing into the wrong element, leaving the CBS manager blank.
  Renamed the panel to `ps-cost-acct-body`.
- The all-₱0 / "—" cells are **not** a bug: that schedule was imported from P6 with no cost loaded.
- Verified in a browser harness with the module's real CSS + the screenshot's long WBS codes at the
  actual 12-column widths: no overlap, headers all wrap without clipping. Module-only change, no `?v`
  bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-21 — Viewer read-only: close the cash_flow_* residual
Extended #7 to the last write surface: the 7 `cash_flow_*` assumption/derived tables
(settings, billing_milestones, dp_tranches, actuals, rollup, trade_packages, scenarios) wrote via
`is_approved()`, so a project-assigned viewer could edit cash-flow assumptions. Their WRITE policies
are now **`is_writer()`** (reads stay `is_approved()` so viewers can still view cash flow). Applied in
`supabase-setup.sql` (statement-level: only `create policy` that is `for all` AND references
`is_approved()` — uniquely the cash_flow writes — swapped; reads and is_planner/is_admin for-all
policies untouched) and appended to `migrations/2026-07-21-viewer-readonly.sql` (explicit name↔table
map since the policy names are non-uniform, e.g. `cash_flow_trade_write`/`cash_flow_scen_write`).
`persistRollup()` is already `try/catch` best-effort, so a viewer's blocked rollup write can't error
their view. **Viewers now write nothing anywhere.** Verified: 0 for-all+is_approved policies remain,
7 cash_flow reads intact, setup.sql still complete (0 tables missing) + balanced. Re-run the migration
(already run once — the added block is idempotent).

### 2026-07-21 — Audit Medium/Low fixes (#6 read-only guards, #7 viewer read-only, #8 portfolio fallback, #10 colors)
- **#6 (Med) — dead read-only guards wired up** (`modules/project-schedule/index.html`).
  `window.__archived` / `window.__viewOnly` were read in ~8 edit guards each but never assigned, so
  archived / view-only projects were fully editable. Now: `__viewOnly = (role === 'viewer')` set at
  login; `__archived = (project.status === 'archived')` set per-project in `load()`. Archived projects
  and viewers are now read-only in the schedule editor. (Defaults to editable if PROJECTS hasn't
  loaded yet, then corrects — safe.)
- **#7 (Med) — 'viewer' is now truly read-only at the DB.** Module-table writes used `is_approved()`
  (true for viewers). Added **`is_writer()`** (approved AND `role <> 'viewer'`) and switched the
  module-table + calendars insert/update/delete policies to it (read unchanged). Migration
  **`migrations/2026-07-21-viewer-readonly.sql` (USER MUST RUN)**; folded into both schema files'
  RLS loops. Also **project-scoped the older 2026-07-07 support-table loop** in setup.sql
  (wbs_nodes/activity_code_*/activity_udf_defs/activity_steps/weekly_commitments/schedule_scenarios/
  _thresholds) so a *fresh* build matches the live #2 RLS fix (it was still `is_approved()` un-scoped
  there). ⚠️ Residual: `cash_flow_*` assumption tables keep `is_approved()` writes (planner-domain;
  a project-assigned viewer could still edit them) — flagged in the migration, tighten later if needed.
- **#8 (Med) — portfolio schedule fallback hardened** (`modules/portfolio-overview/index.html`).
  The non-RPC fallback fetched with parallel OFFSET `.range()` and **no `.order()`** + `select('*')`
  across many large projects → statement-timeout risk *and* unstable paging (duplicate/skipped rows →
  wrong totals). Now keyset-paginated (`order id.asc`, `gt(id,last)`) with the lean 8-column set
  `scCompute` actually reads. (Only runs when `schedule_scurve_agg_multi` RPC is absent.)
- **#10 (Low) — hardcoded `#fff` reviewed, no change.** All instances are deliberate accents, not
  dark-mode surface bugs: the photo-lightbox white mat + caption (a dark theater), the active
  duplicate-legend badge's inverted contrast, and the schedule drag-handle hover / loading-bar-on-dark.
  Left as-is (changing them would regress intentional design).
- **#9 (Low) NOT done — deliberate.** The project-schedule main `load()` `select('*')` (jsonb waste on
  40k-row projects) is the documented "B2" deferral: the only real win is lazy-loading `activity_codes`/
  `udf`, which the module owner already declined as poor risk/reward on the hot path (the columns are
  used for grouping/columns/editor). No safe column-trim exists; left deferred.
- **Verified:** both edited modules' inline scripts parse clean; all three SQL files structurally sound
  (setup.sql 687/687 parens, `$$` paired; schema.sql balanced with comments stripped — its raw
  imbalance is pre-existing comment text; migration balanced); `is_writer()` defined before every loop
  that uses it; 0 module/master/calendars insert policies still on `is_approved()`. JS + SQL only, no `?v=` bump.

### 2026-07-21 — Audit #5 completed: supabase-setup.sql folded to a complete one-paste build
Finished the deferred half of audit finding #5. `supabase-setup.sql` now builds the **entire** DB on
its own — no more "run /migrations too."
- **Method (safe, not blind concat).** Blind date-order concatenation of all 62 migrations is unsafe:
  same-date files sort alphabetically, which **scrambles dependencies** (`wpm-mirror-award-status`
  before `wpm-work-packages-mirror` → ALTER-before-CREATE; `fix-rls-recursion` before
  `project-access-rls` → the RLS-recursion fix gets clobbered by the old `can_access_project`). So I
  wrote an **assembler** (verified) that extracts only what setup.sql was missing and emits it in
  explicit dependency order.
- **Folded in:** the **15 tables** that lived only in /migrations (cash_flow_* ×7, schedule_baselines/
  _snapshots/_audit, activity_expenses, cost_accounts, wpm_work_packages, ppr_presentations/_slides)
  + their indexes/grants/policies, and the **missing columns** on 10 existing tables (contracts_claims,
  drawing_register, issues_lessons, material_submittal, progress_photos, project_schedule, projects,
  resource_assignments, resources, resource_roles) — the module-full migrations had been folded into
  schema.sql but never setup.sql. Ordering fix: tables emitted before the missing-column ALTERs
  because `resource_assignments.cost_account_id` FKs `cost_accounts`.
- **RLS is correct-by-construction:** support tables (cost_accounts/activity_expenses/schedule_baselines/
  _snapshots + schedule_audit) get the **project-scoped** policies from the 2026-07-21 RLS fix; ppr via
  the standard module loop; cash_flow/wpm keep their own (already-scoped / service-role) policies —
  and every captured `create policy` got a preceding `drop policy if exists` so the file stays
  **re-runnable** (`create policy` isn't idempotent on its own).
- **Verified programmatically against the union of all sources:** 0 tables missing, 0 columns missing,
  no duplicate `create table`, every literal policy has a matching drop, parens balanced, `$$` paired.
- Headers updated: `supabase-setup.sql` = ✅ complete one-paste; `supabase-schema.sql` points to it as
  the complete build. (The live DB was already complete; this is the fresh-deploy path.)

### 2026-07-21 — Audit remediation: Critical + High fixes (pagination × 3, RLS scope, schema-drift notes)
Acting on the 2026-07-21 dashboard audit; the Critical + High findings:
- **#1 (Critical) — `resource_assignments` silent truncation in Project Schedule.**
  `loadResourcesAssignments()` fetched assignments with a single `select('*')` (Supabase caps at
  1000; P6/XER imports reach ~51k–55k), silently corrupting Resource/Role Usage, leveling & cost
  roll-ups. Now **keyset-paginated** (`order id.asc, gt(id,last), limit 1000`) —
  [modules/project-schedule/index.html](modules/project-schedule/index.html).
- **#3 (High) — Drawing Register** and **#4 (High) — Progress Photos** loads had the same
  unpaginated `select('*')` (Drawing Register *already* truncated — GPR101 = 1,032 drawings). Both now
  keyset-paginate then restore their display order in memory (drawing: sort_order↑ NULLS-LAST →
  drawing_no; photos: taken_at↓ blank-last → sort_order↑). [modules/drawing-register/module.js](modules/drawing-register/module.js),
  [modules/progress-photos/module.js](modules/progress-photos/module.js).
- **#2 (High) — cross-project RLS exposure.** 12 project-scoped support tables + `schedule_audit`
  (2026-07-07 schedule batch + 2026-07-11 resource-cost-parity) had `read using (is_approved())` and
  `write for all using (is_planner())` — no `can_access_project`, so any approved user could read
  every project's schedule/WBS and **cost** data (activity_expenses, schedule_baselines,
  cost_accounts), and any planner could write across projects. New migration
  **`migrations/2026-07-21-rls-project-scope-fix.sql` (USER MUST RUN)**: read = `can_access_project(project_id)`
  (helper already allows admins + requires approved), write = `is_planner() and can_access_project(project_id)`;
  `schedule_audit` keeps INSERT-ONLY. Idempotent + existence-guarded.
- **#5 (High) — schema drift.** Neither canonical file is standalone-complete (23 tables missing from
  `supabase-schema.sql`, 15 from `supabase-setup.sql`; only `/migrations` is complete), and
  setup.sql falsely claimed to "supersede" the migrations. **Corrected both files' headers** to state
  they're not complete and that a fresh build must run `/migrations` in date order (all idempotent).
  The **full fold** (make setup.sql alone build a complete DB) is deliberately deferred to its own
  verified pass rather than hand-transcribing 15 deploy-critical tables inside this multi-fix change —
  the **live DB is already complete**, so this is fresh-deploy/documentation risk only, now mitigated.
- **Verified:** all three edited modules parse clean (inline + module.js); Node unit tests confirm the
  keyset loop loads all 2,500/2,500 rows (no truncation) and terminates, and both custom re-sorts
  reproduce the prior DB ordering exactly. RLS migration reviewed against `can_access_project`
  (admin-safe). Only module-local JS + SQL changed → **no `?v=` bump**.
- **Deferred to follow-up passes (Medium/Low from the audit):** #6 dead `window.__archived`/`__viewOnly`
  read-only guards, #7 viewer-write role gap, #8 portfolio OFFSET fallback, #9 jsonb `select('*')`
  waste, #10 minor hardcoded `#fff` accents, and the #5 full canonical fold.

### 2026-07-21 — Resource Loading view: live end-to-end verification + assignments pagination fix
- **Verified the Loading view live** (in the owner's logged-in browser) end-to-end: assigned QA
  Engineer → Excavation through the **real Project Schedule → Resource Assignments** form (cost
  auto-derived ₱6,400 = 8 × ₱800), added 3 more assignments via the app's data layer, then opened
  the Resource & Role Master **Loading** tab in the **QADEMO sandbox** — the time-phased utilization
  matrix rendered correctly: Carpentry Crew **120% (OVER, red)** in Aug, Rebar Crew 77%/92%, QA
  Engineer 32%/17%/20%, KPIs 3 resources / 103 units / **₱129,900** / 1 over-allocated. The
  ₱129,900 total confirms the **cost fallback** (Project Schedule's derived-cost assignments store
  `budgeted_cost = null`, so the view falls back to units × resource rate). Demo data left in the
  QADEMO sandbox (2 resources CARP/REBAR + 4 assignments).
- **Fix (assignments pagination):** `loadLoading()` fetched assignments with a single `select`,
  which Supabase caps at 1000 rows — so projects with many assignments (**GPR101 ~51k, XERTEST
  ~55k** from P6/XER imports) would have **silently shown partial data**. Now **keyset-paginated**
  (`order id.asc`, `gt(id, last)`, 1000/page) — the same pattern the S-Curve/schedule loaders use.
  (Heads-up for later: transferring ~50k assignment rows to the browser to aggregate is heavy; a
  server-side monthly aggregate RPC — like `cashflow_schedule_agg` — would be the scalable follow-up
  if the big projects' Loading view feels slow.)
- Harness-regression-checked (matrix still renders, no console errors); module-local only, **no
  `?v=` bump**.

### 2026-07-21 — Resource & Role Master: Loading view + usability polish + cost roll-up
- User asked to improve the module; chose **Loading view + usability polish + cost roll-up**
  (declined Excel import). All in `modules/resource-loading/index.html`; **no DB change, no `?v=`
  bump** (module-local only).
- **Resource Loading view (new 4th tab — the module's namesake).** Reads `resource_assignments`
  (lazy) + the assigned activities' `project_schedule` dates → a **resources × months utilization
  matrix**. Budgeted units/cost are **time-phased** across each activity's dates weighted by the
  resource's working calendar (`PDCal`); **utilization = allocated ÷ (Max Units/Time% × working
  capacity)**, cells colored green ≤85 / amber ≤100 / **red >100** with an OVER tag per
  over-allocated resource. Modes **Utilization % / Units / Cost** + totals row, over-allocated-only
  filter, empty state → Project Schedule's Resource Assignments. This finally makes the
  "resource-loading" module show actual loading.
- **Usability polish.** Per-tab **KPI cards**; **filter bar** (funnel pattern) Type+Role on
  Resources / Discipline on Roles; **"# Resources"** count on Roles & Calendars; **delete guards**
  (FKs have no ON DELETE) — calendar-in-use and resource-with-assignments are **blocked** (the
  latter via a server-side `count` head query), role-in-use warns; **duplicate resource-code**
  blocked on save.
- **Cost roll-up.** Role Price/Unit **cascades** to a resource's rate when empty; total budgeted
  cost KPI + Cost matrix mode (`budgeted_cost` → units × rate fallback).
- **Verified in a stubbed harness** (real module + real ui.js/PDCal, in-memory Supabase seeded
  with resources/roles/calendar/assignments/schedule): matrix spread hand-checked exact (Carpenter
  Mar 2,449/Apr 2,845.1/May 305.9 = 5,600; totals 6,000 units / ₱2.98M; OVER flags + utilization %
  correct), all 3 modes + totals + over-only, KPIs (avg availability 75%), Type filter, role→rate
  cascade (→550), dup-code blocked (no insert), calendar delete blocked before confirm. No console
  errors. (Screenshots impossible in this env — DOM/JS checks.)

### 2026-07-21 — Productivity Rates: filter/control bar consistency (user: "filters in the top bar are clashing")
- Diagnosed against the live site in the user's browser (logged in) + a stubbed harness measuring
  element geometry: **no pixel overlap** at 1280/1568/1920 — the "clash" was a **consistency**
  defect. The Monitoring control row had bare inline labels plus the **data-table toggle floating
  far-right in empty space** (`margin-left:auto`), which read as unbalanced next to the suite's clean
  funnel-icon filter bars (risk-register / stakeholder-map, both confirmed clean live).
- **Fix:** moved the table toggle out of the control row into the **topbar tool cluster** (beside
  Import/Refresh, matching S-Curve; hidden on the Data tab), and restyled `.pr-controls` to the
  suite filter-bar pattern — leading **funnel icon** + contiguous left-aligned controls, same card /
  padding / 34px control height as `.rr-filters`. No stray floating element.
- Verified in the harness (real module code, in-memory backend): funnel icon present, control row
  contiguous (no gap), toggle now in topbar tools and still works (shows table + active fill +
  renders the transposed table), hidden on Data / visible on Monitoring. No console errors.
  Module-local only → **no `?v=` bump**.

### 2026-07-20 — Productivity Rates module built (Productivity Monitoring from the QHL706 workbook)
- **Built `modules/productivity-rates/`** (single-file `index.html`, s-curve/cash-flow inline
  pattern), flipped `enabled: true`. Reverse-engineered the OPS workbook *"QHL706. OPS. Productivity
  Monitoring … (BL02)"* — one sheet per trade, each a monthly **Planned / Actual / Baseline (BL0)**
  monitoring graph tracking manpower loading, output quantity and the **productivity rate**
  (output per man-day), plus a cumulative-output curve with variance.
- **Model = two tables** (`migrations/2026-07-20-productivity-rates-full.sql`, **USER MUST RUN**;
  idempotent, folded into `supabase-schema.sql` + `supabase-setup.sql` + the RLS loop):
  `productivity_activities` (one row per trade) + `productivity_entries` (one row per activity·month:
  `work_days`, `mp_bl0/planned/actual`, `qty_bl0/planned/actual`; unique on (activity_id,period),
  FK `on delete cascade`). The flat Phase-1 `productivity_rates` starter is **superseded** (left
  untouched). **Rate / cumulative / variance are DERIVED in the app** (`rate = output ÷ (resource ×
  work_days)`), never stored — same rule as risk-register's rating.
- **Two views** (uniform sidebar-less topbar, project selector, tabs): **Monitoring** (activity +
  metric picker → SVG BL0/Planned/Actual chart with a "this month" line, 5 KPIs, toggleable
  transposed data table with a Variance row) and **Data** (activities register + a **monthly editor**
  grid with live-derived rate cells and "+ Add month" defaulting `work_days` to the Philippine 6-day
  working calendar via `PDCal`).
- **Excel importer** for the workbook family: detects the four labelled blocks (Manpower/Equipment
  loading · Output · Average Productivity Rate · Cumulative) + the month/year header + the
  subcontractor sub-block. ⚠️ **Block detection invariant:** a *main* block has an empty col-C in the
  row above; a *subcontractor* sub-block (AFCSC/JM2/CEC/GeoExpert) does not — this stopped Excavation
  grabbing its "No. of Backhoe" sub-row as the output block. On import `work_days` is set to
  **reproduce the workbook's own rate** (`qty÷(mp×rate)`), falling back to PDCal for rate-less months.
- **Data sourcing = manual entry + import, not derived from other modules** (deliberate): the
  actuals (crew deployed, quantity installed) are site-reported and have no upstream in the suite —
  so this is a data-entry/monitoring tool like material-submittal, unlike cash-flow (schedule+WPM).
- **Verified across all layers.** Parser in Node+SheetJS against the real file (13 trade sheets,
  correct units/resource types/subcontractors, 307 entries; scratch/Assumptions tabs excluded) and
  re-verified in-browser. Import reconciliation (Node): 187/192 rate-bearing months reproduce the
  workbook's stored rate within 0.5% (≤9% on a few integer-rounded tiny values), 115 rate-less months
  fall back to PDCal. UI/behaviour in a browser harness (real module code, in-memory Supabase stub):
  Monitoring KPIs (cum 870.78, latest 0.717, avg mp 25.7 — hand-checked), chart lines+dots, metric
  switch, transposed table+variance, empty states; Data register; monthly editor live-derive
  (95→190 doubles the rate) + add-month (Sep-2024, PDCal work_days 25) + save/persist (cum 1370.78);
  add-activity modal. **No console errors.** Screenshots still impossible in this env (stalled
  compositor) — checks are DOM/JS-based.
- Only module-local files + the `config.js` enabled flag changed, so **no global `?v=` bump**
  (suite convention).

### 2026-07-20 — Stakeholder Map rebuilt to the real corporate-BD methodology
- The owner supplied the actual **"CORP. BD TCD. Stakeholder Map 2026.xlsx"** (BD Map · TCD Map ·
  Analysis Guide). Reverse-engineered it and **rebuilt `modules/stakeholder-map/`** from the generic
  Power–Interest version to match the workbook. **Kept project-scoped** (owner's call) — the file's
  corporate/SBU grouping (BD/TCD) is out of scope; this is one map per project.
- **Two derivation chains, both DERIVED never stored** (pure functions of the stored 1–4 ratings,
  same principle as risk-register's rating / issues-lessons' aging):
  1. **Impact (1–4) × Interest (1–4) → Importance (1st–4th) → Engagement Approach**
     (Manage Closely / Keep Satisfied / Keep Informed / Monitor). `IMP_GRID` transcribed verbatim
     from the Guide's Table 3.
  2. **Gap = Target − Current relationship → Engagement Strategy → Min Frequency**
     (gap 2–3=Catch up, 1=Enhance, 0=Maintain).
- ⚠️ **Workbook self-discrepancy** (same class as material-submittal's): the *Guide* sheet says
  `Maintain=Semi-annually / Enhance=Quarterly`, but the *live cell formula* the data actually
  reflects says `Catch up=Monthly, Enhance=Every two months, Maintain=Quarterly`. Followed the
  **live formula** (source of truth); documented in the module CLAUDE.md.
- Register view (identity + contact + both analyses + Primary Responsible), a **4×4 Impact×Interest
  grid** colored by Importance rank (click a cell to filter), filters (Sector/Group/Importance/
  search), and a sectioned Add/Edit modal whose Importance+Approach and Strategy+Frequency update
  **live** as the ratings change.
- **Migration `2026-07-20-stakeholder-map-full.sql` (USER MUST RUN)** — add-only/idempotent, folded
  into `supabase-schema.sql` + `supabase-setup.sql`. Reuses starter columns for natural matches
  (`category`=Sector, `organization`=Institution, `role_title`=Position, `influence`=Impact,
  `interest`=Interest, `engagement`=notes) and adds `stakeholder_group, title, nickname, birthday,
  email, current_rel, target_rel, primary_responsible, alternate, gift_tier` + a `(project_id,name)`
  index. Load/save toast a "run the migration" message until applied. **Starts empty** (no importer,
  owner's choice). No shared asset changed → **no `?v` bump**.
- **Browser-verified** (stubbed harness, real module.js/css, DOM inspection): both chains exact for
  all rating combos (incl. unrated→blank), KPIs, 4×4 grid placement, importance + cell-click filters,
  live in-form derivation, add/save (`created_by` stamped, derived fields NOT persisted), wide table
  scrolls inside its card (no page h-scroll), dark-mode tokens with fixed semantic rank colors. No
  console errors.

### 2026-07-20 — Stakeholder Map built (Register + Power–Interest grid)
- **Built `modules/stakeholder-map/`** (index.html + module.css + module.js), flipped
  `enabled: true`. No external app to mirror ("base it on the suite") — built from the suite
  conventions with **risk-register as the reference**, since a stakeholder Power–Interest grid is
  the direct analog of risk-register's 5×5 matrix.
- Two topbar views: **Register** (filterable table + KPIs + engagement-strategy pill) and
  **Influence / Interest** (a 3×3 Power–Interest grid, rows = Influence High→Low, cols = Interest
  Low→High, each cell colored by its engagement quadrant and holding the stakeholders that fall in
  it; click a cell to jump to the filtered register). Add/Edit modal derives the **Strategy** live.
- **Strategy is DERIVED, never stored** (pure function of influence × interest) — same pattern as
  risk-register's rating / issues-lessons' aging, minus the storage. The `engagement` column stays
  free-text notes. **Documented threshold:** "high side" = the **High** band only (Medium is
  not-high), so only genuinely high-power/high-interest stakeholders land in the demanding
  quadrants. Manage Closely (High·High) · Keep Satisfied (High infl.) · Keep Informed (High int.) ·
  Monitor.
- **No migration** — uses the `stakeholder_map` starter columns as-is (name, organization,
  role_title, category, influence, interest, contact, engagement). No storage bucket. No shared
  asset changed (module-local files + the `config.js` enabled flag), so **no `?v` bump**.
- **Browser-verified** with a stubbed harness (real module.js + module.css, mutable in-memory
  store, DOM inspection — screenshots still stall in this env): KPIs (7 / Manage 2 / Satisfy 1 /
  High-infl 3), strategy derivation, all 7 seed stakeholders placed in the correct grid cells
  (sum = 7), cell-click→filter (High·High → 2 rows), search, Clear-toggle, add/save round-trip
  (`created_by` stamped, strategy NOT persisted as a column), no page h-scroll in either view, and
  dark-mode card surfaces on tokens with semantic strategy colors held fixed. No console errors.

### 2026-07-20 — Fix: the two new modules' top bars weren't uniform (missing shared chrome)
- User reported the Material Submittal and Contracts & Claims top bars didn't match the rest of the
  suite, specifically the buttons beside the profile icon. **Same defect as the 2026-07-17 Progress
  Photos pass**: both modules were missing the three shared topbar rules that every uniform module
  carries, so they inherited `dashboard.css`'s `.pd-topbar { gap:14px }` with **no `flex-wrap`**, the
  avatar had **no left divider**, and theme.js's injected toggle kept its default size instead of
  matching the 34×34 tool buttons.
- Copied the block **verbatim** from `drawing-register/module.css` into both, with a comment naming
  what breaks without it so it isn't dropped again when this module gets copied:
  `.pd-topbar{gap:10px;flex-wrap:wrap;row-gap:8px}` · `#user-bar{margin-left/padding-left/border-left}`
  · `#pd-theme-toggle{34×34}`.
- **Verified by computed-style diff against the real drawing-register** (its stylesheet + its actual
  topbar markup inlined into an iframe, theme toggle injected to match runtime) — with a **sanity
  assertion first** that the reference CSS actually loaded, the trap that invalidated the first
  Progress Photos attempt. Every chrome element (topbar, user-bar, theme toggle, back button,
  separator, tabs, project select, primary button) reports **zero differences**.
- **Stronger evidence than the property diff: the geometry is pixel-identical.** Tool cluster right
  edge **1179px**, theme toggle left **1193px**, profile divider left **1247px** — the same in all
  three modules. The only residual property diffs were selector artifacts (drawing-register has a
  *labeled* "+ Level" button the new modules don't) and `margin-left:auto` resolving differently
  because the left-hand content widths differ — the right edge, which is what "beside the profile
  icon" means, matches exactly.
- Re-checked at 1280/1100/900/700/420px: **no horizontal overflow at any width** and the profile +
  theme controls stay visible throughout. Below 900px the new modules wrap to more rows than
  drawing-register simply because they carry more tabs — graceful wrapping, not breakage.
- CSS-only, module-local; no shared asset touched, so **no `?v` bump**. Both test suites still green
  (43/43 contracts-claims, 54/54 material-submittal).

### 2026-07-20 — Contracts & Claims Register built (Contract · Claims/CO · Extension of Time)
- **Built `modules/contracts-claims/`** (index.html + module.css + module.js), flipped
  `enabled: true`, from the Power Apps "Contracts & Claims Register" screenshots. Three tabs as
  specified.
- **Key insight: two of the three screens are the same screen.** Claims/CO and EOT are both a
  four-stage pipeline (*Estimated → Submitted → Evaluated → Client Approved*) with a status, a
  derived aging figure and a project roll-up banner — differing only in **unit** (money vs calendar
  days). Both run off one `VIEWS` config and one renderer. Contract is the odd one out: a flat
  description + amount list, no pipeline, no status.
- **Migration `migrations/2026-07-20-contracts-claims-full.sql` (user must run).** ⚠️ Money and days
  are **separate column sets**, not one generic value + unit discriminator — they're never mixed in a
  view, and separate columns make it impossible to sum pesos and calendar days into one total. Saving
  nulls the pipeline that doesn't belong to the chosen type, so re-typing a record can't leave stale
  pesos on an EOT.
- **Aging and recovery are derived, never stored.** Aging = today − date_submitted, shown only while
  Pending (a stored aging is wrong the next day); UTC maths so DST can't shift it. ⚠️ **Recovery rate
  is measured over DECIDED records only** (Approved + Disapproved) — dividing by everything submitted
  counts still-pending claims as failures, which on the real fixture read as a catastrophic **0.2%**
  where the honest figure is **85.0% of 1 decided record**. Caught during browser verification.
- **Verified 43/43 against the screenshots' own printed roll-ups**, loading the shipped module:
  Hotel 101's EOT banner matches **exactly** (1,048 / 1,095 / 882 / 314) and three of Avesta's four
  claim totals match exactly. Avesta's *estimated* is 387,716,248 vs their printed 387,716,249 — a
  1-peso **display-rounding artefact in their sheet** (cents stored, rounded per cell, then summed),
  asserted explicitly in the test so nobody later "fixes" our arithmetic to match it.
- Browser-verified: app-matching headers, roll-up banner, aging showing **17** on the one Pending EOT
  exactly as the screenshot, type-adaptive Add form (money↔days↔contract), a saved record following
  its type to the right tab instead of vanishing, filters/bulk, dark mode on tokens, and the wide
  table scrolling inside its card with no page h-scroll. No console errors.
- Scoped to the topbar project per contract §6 — the app's cross-project "Overview" screen belongs in
  `portfolio-overview`, not here. No shared asset changed, so **no `?v` bump**.

### 2026-07-20 — Storage: widen DELETE to planners on the remaining two buckets
- `migrations/2026-07-20-storage-planner-delete-all-buckets.sql` (**user must run**) applies the same
  widening already done for material-submittal to **`drawing-register`** and **`progress-photos`**.
  All three module buckets now share one delete rule: `owner = auth.uid() or is_planner()`.
- A **new file** rather than editing the earlier migration — that one has already been run, and
  applied migrations should stay immutable so "what ran" is unambiguous.
- Same reasoning as before: the `owner` branch is kept because both buckets' INSERT policy is
  `is_approved()`, so any approved user can upload; dropping it would remove their ability to delete
  their own file. `supabase-setup.sql`'s override now covers all three buckets in one loop (still
  placed **after** `is_planner()` is defined — a policy's USING expression is parsed at creation).

### 2026-07-20 — Storage: widen the material-submittal bucket's DELETE policy to planners
- Migration `migrations/2026-07-20-material-submittal-storage-delete.sql` (**user must run**).
  The 2026-06-18 storage migration gave all three buckets
  `delete using (owner = auth.uid() or is_admin())`, so a **planner** deleting a submittal they
  didn't upload removed the row but its object delete silently no-opped, orphaning the file.
  Now `owner = auth.uid() or is_planner()`.
- ⚠️ **The `owner` branch is kept deliberately** — this is a widening, not a swap. The bucket's
  INSERT policy is `is_approved()`, so **any** approved user can upload, including the `user`/
  `viewer` roles; replacing the owner check with `is_planner()` alone would take away those users'
  ability to delete their *own* uploads. `is_planner()` is
  `approved AND role in (super_admin, admin, planner)`, so it already subsumes the old `is_admin()`
  branch. Net effect: nobody loses access, planners gain it.
- ⚠️ **Ordering trap when folding into `supabase-setup.sql`:** the override CANNOT live in the
  storage section (~line 278) because `is_planner()` isn't defined until ~line 342, and a policy's
  USING expression is parsed at creation — it would fail on a fresh run. It sits after the function
  definition, with a forward-pointing note left at the storage loop. The migration also guards with
  `to_regprocedure('public.is_planner()')` so a missing dependency raises a readable error instead of
  a bare "function does not exist".
- `supabase-schema.sql` has **no storage section at all** (pre-existing drift, documented 2026-07-16),
  so there was nothing to fold there.
- **Scope: material-submittal only, as asked.** `drawing-register` and `progress-photos` still carry
  the original owner-or-admin rule and have the same orphaning behaviour — the migration widens them
  by adding them to its one array.

### 2026-07-20 — Material Submittal Log: document attachments wired up
- Uses the existing **private** `material-submittal` bucket + `file_url` column — **no migration**.
  Follows drawing-register's pattern: `file_url` stores the object **path**, and the URL is signed
  on demand (60 s) rather than stored (a stored URL would expire and be useless).
- **One document per submittal, deliberately** — the log already carries a single *Type of
  Presentation* per row, and a submittal needing two document types is two rows in the workbook.
- **Ordering is the whole game here, and each case was verified against injected failures:** upload
  runs **before** the row write (a failed upload never leaves a row pointing at a missing object);
  if the row write then fails the uploaded object is **rolled back** (no orphans); on replace the old
  object is deleted only **after** the row points at the new one; and clicking × is **deferred to
  Save**, so cancelling can never delete a document. Row delete / bulk delete / Clear all /
  import-with-Replace all clean up, capturing paths **before** the rows leave memory.
- Grid gained a **Doc** column. `icons.js` has no `paperclip` and is a shared asset the contract
  forbids editing, so it reuses `eye` — **no global `?v=` bump**. ⚠️ The header array is now the
  single source of truth for the column count; the previous hardcoded `COLS + 3` would have silently
  skewed the table the moment a column was added, which is exactly what adding "Doc" did.
- **Browser-verified with a storage stub + failure injection** (all pass, no console errors); the
  54-check workbook suite still passes. **Note:** a first run reported the rollback failing — that was
  the *stub* returning a bare Promise from `insert()` so `.select()` threw. Model supabase-js's
  chaining accurately in harnesses or you'll chase phantom bugs.
- **Known limitation:** the bucket's delete policy is `owner or is_admin()`, so a planner deleting
  someone else's submittal removes the row but its object delete silently no-ops (orphan, not data
  loss). Widen to `is_planner()` if that matters.

### 2026-07-20 — Material Submittal Log built (Dashboard + Log) from the PMO workbook
- **Built `modules/material-submittal/`** (index.html + module.css + module.js), flipped
  `enabled: true`. Two screens as specified: **Dashboard** and **Material Submittal Log**, built
  against `EPC. PMO. Material Submittal List Dashboard. 2025 01 25.xlsx` (all 14 sheets surveyed;
  `Material submittal log` / `Dashboard` / `Library` / `Coding Reference` define behaviour).
- **The workbook's own formulas were treated as the spec** (read off its cells, not guessed): the
  status block is a `COUNTIF` over the Status column (**blank status isn't counted** — which is why
  its total is 107, not 146), and the S-curve is `COUNTIFS` over the **APPROVAL** date pair, *not*
  submission, despite the sheet labelling its own summary rows "Planned/Actual Submission".
- **Found and fixed two defects in that dashboard** (owner chose "fix it, show both"):
  its S-curve grouped by a redundant **"Trades"** column left blank on **40** submittals (silently
  dropped from the chart), and its OVERALL row summed eight discipline rows but listed **"ST"
  twice**, double-counting Structural. At the workbook's own Jan-2025 cutoff the legacy
  reproduction lands **exactly** on its printed **97 / 29**, while the corrected maths gives
  **128 / 27** — so the old chart *under*-reported planned by 31 despite the double count. The
  module groups by `discipline` (always populated), counts each discipline once, and shows an
  amber reconciliation note explaining the difference. `legacyScurve()` exists **only** to render
  that note.
- **Excel importer** for the real layout: 3-tier merged header (read by column index — several
  headers repeat), 23 trade-section rows, an explicit **stop at the sign-off block** (otherwise
  "Project Manager" imports as a submittal), and a row counts as a submittal when it has
  *substance*, not merely an Item (sheet row 33 has a code/dates/status but no Item; requiring one
  put the status total under the workbook's own COUNTIF). ⚠️ **Dates are timezone-hardened** —
  SheetJS returns the cell displaying `18-Mar-24` as `2024-03-17T15:59:17Z`, so local getters give
  the wrong day in some zones; cells are read as **formatted text** and parsed with integer maths.
- **Migration `migrations/2026-07-20-material-submittal-full.sql`** (idempotent). **User must run
  it** — load/import fail with an explicit "run the migration" message until then. Existing starter
  columns are reused for their natural match, so there are no dead duplicate columns.
- **Verified 54/54 automated checks against the real workbook**, loading the shipped `module.js`
  itself (no reimplementation) — including the status table matching its COUNTIF block exactly
  (9/11/2/3/0/14/68, total 107) and the legacy curve reproducing its printed 97/29. Then
  **browser-verified** with that data imported: dashboard weights match the sheet's printed
  percentages to the decimal, 143 rows across 21 populated sections, sticky frozen columns, dark
  mode on tokens, every filter/collapse/selection/modal interaction, no console errors.
- ⚠️ **Verification caveat recorded for this environment:** the compositor is stalled (screenshots
  time out) and **computed styles are stale after a dynamic class change** — flipping `.active`
  reads back the pre-change value even after forcing layout, which looks like inverted tab colours.
  Confirmed the CSS is correct by measuring a **freshly created** element. Measure fresh nodes only.
- No shared asset changed (module-local files + `config.js` enabled flag), so **no `?v` bump**.

### 2026-07-20 — Schedule load speed: server-side S-curve aggregate (A1–A3 + B1)
Consumers of `project_schedule` were pulling every leaf activity (16k–40k rows) to the browser
just to draw ~dozens of monthly points. Fixed by generalizing the existing
`cashflow_schedule_agg` RPC into a shared aggregate and pointing the S-curve consumers at it.
- **A1 — migration `2026-07-20-schedule-scurve-agg.sql` (USER MUST RUN):** adds
  `schedule_scurve_agg_multi(text[])` (core; aggregates the given projects into ONE combined
  monthly curve) + `schedule_scurve_agg(text)` (single project) + rewrites `cashflow_schedule_agg`
  as a thin wrapper (so Cash Flow keeps working before/after). All `security invoker` → caller's
  RLS applies. **B1:** also adds index `project_schedule(project_id, id)` for the editor's keyset
  pages (previously only `wbs_node_id` was indexed).
- **A2 — S-Curve** now calls `schedule_scurve_agg` and derives the curve from the returned
  monthly buckets + totals; refactored `compute()` onto a source-agnostic `baseSeries()` that is
  fed by the RPC when present, else by a **lean, keyset-paginated** full-row fetch (only the 8
  columns the curve needs — replaces the old `select('*')` parallel-OFFSET fetch that risked the
  statement timeout on big projects).
- **A3 — Portfolio S-Curve tab** now calls `schedule_scurve_agg_multi(ids)` (one combined
  aggregate across the scoped projects) via a new `scComputeFromAgg`, falling back to the old
  row fetch + `scCompute` when the RPC is absent.
- **Result:** the heavy modules transfer dozens of rows instead of tens of thousands. Cash Flow
  already used this pattern (unchanged; now backed by the shared function).
- No shared JS/CSS changed (only inline module scripts + a new migration), so **no `?v` bump**.
- Harness-verified S-Curve through BOTH paths on one fixture: RPC path and row-fallback produce
  **identical** KPIs (53.2 / 55.4 / 53.2 / −2.2pp), forecast-row cells, SPI, and forecast finish
  — confirming the refactor is behavior-preserving and the aggregate matches the per-activity
  math. (The real Postgres RPC couldn't be run here; its body is the deployed
  `cashflow_schedule_agg` formula with `= any(p_ids)`.) **Deferred: B2** (lean columns + lazy
  jsonb in the Project Schedule editor's own load) — separate pass.

### 2026-07-17 — Global: project picker is now Project Schedule's OPC folder browser
User: "the project selector dropdown in the project schedule is good — globally apply it."
- **Rewrote the shared `UI.enhanceProjectSelect` (`ui.js`)** to render Project Schedule's
  **OPC folder browser** instead of the flat searchable list: drill Workspace → Program →
  Group one level at a time (folder rows with node-type badge + descendant project count),
  a breadcrumb (`All › … `) to jump back up, and a search box that flattens to matching
  projects across the whole tree. Ported faithfully from `renderProjectSelector`
  (`.ps-pss-*` → shared `.pd-pss-*` in `dashboard.css`).
- **Builds the tree from `PDb.getProjects` + `PDb.getWorkspaces`** (cached per page), but
  **filters projects to the ids present in the module's `<select>` options** — so any
  access filtering a module already applied (e.g. Progress Photos' `canAccessProject`) is
  respected. The `<select>` stays the source of truth (value + `change` still fire), so no
  module code changed — all seven that call `enhanceProjectSelect` upgrade automatically.
  Project Schedule keeps its own (identical) in-module browser.
- Shared assets changed (`ui.js`, `dashboard.css`) → **`?v=` bumped `20260720a` → `20260720b`
  across all 21 HTML files.**
- Harness-verified (gitignored, deleted) against a Workspace→Program→Group fixture: opens
  into the current project's folder with the right breadcrumb; root shows "Production ·3"
  with a workspace badge; drilling shows the program folder (·2) + a directly-parented
  project; search "portwood" flattens to 1 match with the breadcrumb hidden; selecting fires
  exactly one `change` and updates the button label; dark-mode popup on tokens.

### 2026-07-17 — Global: deeper top-bar structural uniformity (all modules)
Completed the follow-up deferred last prompt — every enabled per-project module now shares
the same sidebar-less top bar: **back button · brand-red module icon + title · searchable
project selector (in the topbar) · tool cluster · user-bar divider · theme toggle.**
- **risk-register** — removed the sidebar; the Register/Risk-Matrix view switch moved from
  sidebar nav links to a **segmented tab strip in the topbar** (`.rr-tabs`, module.js view-switch
  selectors repointed `.pd-sidebar [data-view]` → `.rr-tabs [data-view]`, incl. the matrix-cell→
  list jump); project selector + "+ Add risk" moved into the topbar; status/category/search became
  a filter-bar card. Uniform chrome added to `module.css`; `module.css`/`module.js` links now
  cache-busted (`?v=20260720a`).
- **resource-loading** — removed the sidebar; project selector + search + "+ Add" moved into the
  topbar tool cluster; content tabs (Resources/Roles/Calendars) stay in the body. Uniform chrome
  added to the inline `<style>`.
- **cash-flow** — already sidebar-less; moved the project selector out of the body control strip
  into the topbar (`.cf-projctx`); the data-date + S-curve-basis controls stay in the body strip.
- Progress Photos / Issues / Drawing Register / S-Curve were already uniform; **Project Schedule**
  keeps its bespoke Workspace→Program→Group searchable browser (equivalent). No shared-asset change
  this prompt, so **no global `?v` bump** (only risk-register's own module files were re-stamped).
- Harness-verified each (real markup+styles+script, stubbed auth/DB; gitignored `_ui_test.html`,
  deleted): risk-register topbar order back·title·projctx·tabs·tools·user-bar, tab switch +
  matrix-cell→list works, searchable psel built; resource-loading psel shows "Hotel 101", tab
  switch + Add-label update work; cash-flow psel in topbar, removed from viewbar, data-date kept,
  no eval errors. (One "null onclick" scare was a harness bug — the modals live outside `.pd-app`
  and the first harness only injected `.pd-app`; fixed to inject the whole body. Screenshots still
  impossible — compositor stalled.)

### 2026-07-17 — Global: searchable project selector + uniform top-bar icons
Standing workflow set this prompt: **every prompt now logs to CLAUDE.md + commits + pushes**
(saved to memory `commit-log-workflow`).
- **Searchable project selector (shared).** New **`UI.enhanceProjectSelect(sel)`** in `ui.js`
  (+ `.pd-psel*` styles in `dashboard.css`): upgrades a native project `<select>` into a
  searchable combobox that scales to 100+ projects, **without changing module logic** — the
  `<select>` stays the source of truth (value + `change` events still fire), and the trigger
  button copies the select's classes/inline style so each module's per-topbar look carries.
  Wired into **progress-photos, issues-lessons, drawing-register, risk-register, s-curve,
  resource-loading, cash-flow** (one call after each populates its options). **Project Schedule
  already had its own searchable Workspace→Program→Group browser — left as-is.**
- **Uniform top bar — module icon beside the title.** Added the brand-red module icon before
  the `<h1>` title in the three enabled modules that lacked it (**risk-register** = risk,
  **cash-flow** = cash, **resource-loading** = users); Progress Photos / Issues / Drawing
  Register / S-Curve already had theirs. `MODULE_CONTRACT.md` boilerplate updated so new modules
  inherit both the icon-title rule and `enhanceProjectSelect`.
- **Deferred (noted, not done):** deeper structural convergence — moving risk-register/cash-flow/
  resource-loading's project selector out of their body rows into the topbar, and converting
  risk-register's sidebar shell to sidebar-less — was left for a focused pass to avoid regressions
  in those working modules. Disabled placeholder modules (contracts-claims, stakeholder-map,
  material-submittal, productivity-rates) will adopt the pattern when built (contract updated).
- **Shared assets changed** (`ui.js`, `dashboard.css`, `icons.js` earlier), so **`?v=` bumped to
  `20260720a` across all 21 HTML files.**
- Harness-verified the shared selector (gitignored `_ui_test.html`, deleted): native hidden,
  100-project list, live search ("project 7" → 11), selection fires exactly one `change` event,
  per-module button class + max-width carried, dark-mode popup on tokens, Esc closes. Screenshots
  still impossible (compositor stalled).

### 2026-07-17 — S-Curve: Forecast % row in the data table
- The data table (Planned % / Actual %) now also shows a **Forecast %** row — the same
  forecast the chart's red dashed line draws, sampled per month. Computed once in `compute()`
  as `forecastC` (shared by chart + table): follows the remaining plan's shape, time-stretched
  to the forecast finish (SPI-based or pinned), from the actual point up to 100%. Rendered as a
  brand-red italic `<tr>` **only when a forecast exists** (guarded); months before the data date
  show "—". Last cell may read ~99.9% (month-end sampling vs the finish date a few days later).
- Harness-verified (real markup/styles/inline script from index.html, stubbed auth/DB with a
  data-date-straddling schedule): rows Planned/Actual/Forecast %, dashes then monotonic
  53.2%→99.9% one-per-month, red italic, row absent when no forecast. Pure render change — no
  shared assets, no `?v=` bump.

### 2026-07-17 — S-Curve: uniform toolbar / top bar
- Brought the **S-Curve** module's chrome in line with the suite (Progress Photos / Drawing
  Register / Cash Flow / Project Schedule). The separate body `.sc-controls` row is gone —
  everything now lives in the topbar: 36×36 back button · title with the `trendingUp` brand-red
  icon · **project selector in the topbar** (borderless-until-hover) · a tool cluster beside the
  profile (Forecast-finish control + divider + **34×34 icon-only** Show-table & Refresh) ·
  `#user-bar` left-divider · 34×34 theme toggle.
- Show-table is now **icon-only** (toggles `.is-active` red fill + `title` instead of a text
  relabel). Title collapses < 820px; no page h-scroll. **Pure chrome — compute/render untouched;
  no shared-asset change, so no `?v=` bump.**
- Harness-verified (real markup+styles+inline script pulled from `index.html`, stubbed
  auth/DB/schedule; gitignored `_ui_test.html`, deleted): topbar order back·title·project·tools·
  user-bar, 36/34px sizing, brand-red title icon, borderless→hover project select, user-bar
  divider, table toggle reveals the 2-row table with active fill and stays icon-only, KPIs+chart
  render, dark mode, no h-scroll. Also updated the memory guardrail on the exposed service-role
  key (rotation is a user-only dashboard action; new key system decouples secret from publishable).

### 2026-07-17 — Issues, Concerns & Lessons Learned built + Photos filter polish
- **Built `modules/issues-lessons/`** (flipped `enabled: true`) from the Power Apps
  "Issues & Concerns" app, adding a **Lessons Learned** capability the app lacks. Two
  segmented topbar screens:
  - **Issues & Concerns** — the app's log row-for-row: No. · Department · Issue · Caused
    By · Corrective Action · Champion · Status · Date Presented · **Days Aging (derived)**
    · Date Resolved. Filters (search / Status / Department / Champion / aging bucket),
    KPIs, and an Add/Edit modal grouped Details · Issue · Lessons Learned. Statuses are
    **Open | On Hold | Closed** (the app's, not the starter table's "In Progress").
  - **Lessons Learned** — a card library collecting every lesson captured on an issue so
    management/ops can reference them later. It's a filtered view of `issues_lessons`
    (rows with a non-empty `lesson_learned`), **not a separate table** — a lesson is never
    divorced from the issue that produced it. Filters by search / department / category.
- **Days Aging is derived, never stored:** 0 when Closed (matches the app), else
  today − date_presented; > 90 days open renders red.
- **Migration `migrations/2026-07-17-issues-lessons.sql`** — adds `department`,
  `champion`, `caused_by`, `corrective_action`, `date_presented`, `date_resolved`,
  `lesson_learned`, `lesson_category`, `recommendation` + a `(project_id, date_presented
  desc)` index. Idempotent; folded into `supabase-schema.sql`. **User must run it** — the
  new fields render blank until then. (`ISSUE`→`description`, `STATUS`→`status` reuse
  existing columns.)
- **Progress Photos filter polish (user report — "Clear filters seems out of place"):**
  the button used `margin-left:auto`, so on a wrapped filter row it orphaned alone on a
  second line at the far right (visible even on the empty state). Replaced with a subtle
  borderless **`.pp-clear`** ghost (× icon) that sits inline and **only appears when a
  filter is actually set**; applied to both the Photos and PPR screens. Removed the now-
  unused `.pp-filt-right`.
- **Shared assets touched** (`icons.js` gained `x` + `bulb`; `config.js` enabled flag), so
  **`?v=` bumped `20260717g` → `20260717h` across all 20 HTML files.**
- Harness-verified both modules against a mutable in-memory store (real `Fmt`/`UI`/`Icons`,
  gitignored `_ui_test.html`, deleted after use; screenshots still impossible — compositor
  stalled): issues table/KPIs/derived aging (0 on closed, red > 90d), lesson tag, every
  filter + clear-toggle, screen switch hiding the primary tool, add/save round-trip
  (`type='Issue'` + `created_by` stamped + lesson persisted), lessons library counts +
  category filter, dark-mode card surfaces on tokens. No console errors.

### 2026-07-17 — Drawing Register: Project-Schedule-style row interaction (drag reorder + fixes)
- Asked to bring Project Schedule's grid feel to the Drawing Register. **Most of it was already
  there** (inline cell editing, click-to-select + Shift/Ctrl range, keyboard shortcuts, group
  collapse). Four genuine gaps, now fixed:
- **Drag-to-reorder — was missing entirely.** Rows now reorder within their group with PS's
  affordances (dimmed drag row, red insertion line top/bottom, grab cursor). ⚠️ **`sort_order` is
  re-dealt from the group's own pool of values, never renumbered** — phase order is derived from
  each phase's *minimum* sort_order (`phaseOrderKey`), so free renumbering would silently reshuffle
  the phases; re-dealing the same multiset pins every phase's min. Armed only when no filter/search
  is active (mirrors PS's `_reorderEnabled()`), and refused across groups/phases. **No migration** —
  `sort_order` already exists.
- **Collapse only fired on the small label span** — clicking the rest of a group row did nothing,
  which is exactly why collapsing "felt unnatural" next to PS. The **whole group row now toggles**;
  the label keeps dblclick-to-rename.
- **The add target was invisible** — selecting a group set `selCtx` with no visual state. Group rows
  now carry a red left rail (`.dr-grpactive`) that survives re-render.
- **Real bug: Add filed rows under the wrong level.** `selCtx` was only set by *group* clicks, so
  selecting a **drawing** and hitting "+ Add" filed the new row under the last-touched group (or
  ungrouped). Clicking a drawing now sets the context from it, so Add/Enter inserts a sibling —
  verified: click A-201 → Add → `A-202` under AR/Elevation, title editor open.
- **Bug found in my own work while verifying:** `buildModel()` walks `rows` in array order (only
  sorted because `load()` fetches `.order('sort_order')`), so an in-memory `sort_order` change
  persisted but **didn't move the row on screen until reload**. Added `sortRows()` (NULLs last)
  before the optimistic render.
- **Not ported** (deliberate): PS's row virtualization, cell clipboard (TSV copy/paste), column
  chooser/menu, undo/redo — so **reorder is not undoable**; this module has no undo stack.
- Harness-verified with real `DragEvent`s against a mutable store (reorder display+store, cross-
  group/phase refusal, phase order preserved, filter disarms the drag, group-body collapse 6→2,
  active group survives re-render, no regressions in edit/status/select). Assets `?v=20260717g`.

### 2026-07-17 — Progress Photos: UI uniformity pass (chrome now matches the suite)
- The module had shipped with **invented chrome**. Realigned it to Drawing Register / Cash Flow /
  Project Schedule. The real defects, found by comparing against the reference stylesheet rather
  than by eye: the **shared topbar rules were missing entirely** (`.pd-topbar`, `#user-bar`'s
  `margin-left/padding-left/border-left`, the 34×34 `#pd-theme-toggle`) so the avatar had no
  divider; the **filter bar wasn't a card** (the others are `--pd-card` + border + radius +
  `8px 12px`) which is what made it look unfinished; tools were ad-hoc padding instead of the
  uniform **34×34 transparent icon buttons** + `.pp-tb-sep` dividers + one labelled primary; the
  back button wasn't the 36×36 square; the project select was plainly bordered instead of
  borderless-until-hover.
- **Stopped inventing components.** The Photos|PPRs switch is now a **segmented tab strip**
  identical to Register/Progress, and List/Gallery uses the **shared `.pd-viewtoggle`** from
  `dashboard.css` (as `projects.html` does) instead of a third bespoke style. Count + toggle moved
  into a static list bar (`.dr-listbar` pattern). Added Clear-filters + a count to the PPR screen
  for parity. ⚠️ `.pp-tab` now means the *screen* tabs — the view wiring selects `.pd-vt[data-view]`.
- **Verified by computed-style diff against the real `drawing-register/module.css`** (both
  stylesheets inlined into an iframe at matching viewport/theme): all 10 chrome elements report
  **zero differences**. Behaviour re-verified after the restructure; light/dark flip on tokens with
  brand red fixed; icon-only title ≤1150px; no page h-scroll at 375px. Assets bumped `?v=20260717f`.
- Note: a first comparison attempt was **invalid** — the reference stylesheet hadn't loaded in the
  iframe, so it reported unstyled browser defaults (16px text, auto widths) as "differences".
  Inline the CSS and assert a sanity value before trusting such a diff.

### 2026-07-17 — Progress Photos: PPR Presentations + offline export
- **Built the "View PPRs" half** (`modules/progress-photos/ppr.js` + `ppr_presentations` /
  `ppr_slides`): the PPR Presentations Database (PPR Date · Description · No. of Slides, PPR
  date-range filters, numbered **Preview** pane) and the slides viewer/editor (PPR Project /
  Meeting Date / Description / `‹ n › of N`, Trade / Works / Location, before-and-after photos
  with capture dates + italic captions, **Key Plan overlay** toggling on both photos). The module
  now has two top-level screens — **Photos | PPRs** — mirroring the app's home; they share one
  project selector via `ProgressPhotos.onProject()`.
- **Slides reference the Photos Database rather than re-uploading** (owner's decision): a slide's
  before/after are FKs into `progress_photos`, so the library is the single source of truth and
  picking a photo pre-fills the slide's trade/works/location/caption. FKs are `on delete set null`
  **on purpose** — deleting a photo must not silently delete the slide citing it.
- **Download = a self-contained offline copy, not a deck** (owner's requirement: PPRs are opened
  in meetings where the photo library may load slowly or connectivity is poor). It writes a
  **standalone `.html`** — every image inlined as a downscaled data URI, inline CSS, no scripts,
  **zero external references** — that opens with no network and prints one slide per page.
  ⚠️ Photos are fetched to a **blob first**, then drawn via an object URL: drawing a signed
  Supabase URL straight into a canvas taints it cross-origin and makes `toDataURL()` throw. Don't
  "simplify" that round-trip away.
- **Migration `migrations/2026-07-17-ppr-presentations.sql`** (idempotent, standalone-runnable,
  folded into `supabase-schema.sql` incl. its RLS loop). **User must run it** — the PPRs screen is
  empty until then. No new bucket (key plans go to `<project>/keyplans/` in `progress-photos`).
- Harness-verified (list ordering, filters, preview, slides fields, key-plan toggle, PPR + slide
  CRUD, cascade delete, dark mode, 2-col split at 1440px, no console errors). **The export was
  verified as a real artifact**: captured, rendered in a sandboxed no-network iframe — 5/5 images
  decoded, 0 broken, 0 external refs. Screenshots still impossible (stalled compositor).
- **Note:** both false alarms during testing came from the harness, not the module — a global
  `URL.createObjectURL` stub silently breaks image embedding, and a no-op `order()` stub makes
  ordering assertions meaningless. Recorded in the module's CLAUDE.md.

### 2026-07-17 — Progress Photos: Photos Database built (from the Power Apps app)
- **Built `modules/progress-photos/`** against the original Power Apps "Progress Photos |
  Photos Database" screen; flipped `enabled: true`. The Power Apps row is reproduced exactly
  (PHOTO · DESCRIPTION · TRADE · WORKS · LOCATION · CAPTURE DATE + download / view-full-size),
  along with its **List View / Gallery View toggle**, its **filter set** (capture start, capture
  end, Trade, Works, Location — plus a search the original lacked), and its **fullscreen expand**
  as a keyboard-navigable lightbox (←/→/Esc).
- **Two deliberate departures from the app.** (1) The app's "My Projects" selector grouped rows
  by *project*; this module is project-scoped by contract (§6), so the project is the topbar
  selector and **List View groups by Trade** instead (collapsible, counts, persisted). (2) Upload
  is **batched** — one modal takes many files against one set of shared fields and writes a row
  per file (the app uploads one at a time), with per-file progress and per-file failure isolation.
- **Trade vocabulary mirrors WPM's** (Site Works / Structural / Mechanical / Electrical and
  Auxiliary / …) so photos, procurement work packages and Cash Flow's cash-out group by the same
  names. **Works** is free text + a datalist of values already used on the project (the app's
  Works values are project-specific, e.g. "Temporary Facilities", so a fixed enum would fight
  real usage).
- **Migration `migrations/2026-07-17-progress-photos.sql`** — adds `trade`, `works`, `sort_order`
  to `progress_photos` + a `(project_id, taken_at desc)` index (idempotent; folded into
  `supabase-schema.sql`). **User must run it** — Trade/Works render blank until then.
  `description`/`location`/`photo_url`/`taken_at` already existed. Uses the private
  `progress-photos` bucket from the 2026-06-18 storage migration; previews come from **one batched
  `createSignedUrls` per load**, not one signing call per row.
- **Note for the app owner:** `UI.modal()` takes no width and doesn't wire close buttons, so this
  module carries a local `openModal()` helper rather than editing the shared `ui.js` (§1). Worth
  promoting into `ui.js` if other modules want it.
- Harness-verified against a mutable in-memory store (filters, grouping, gallery, lightbox, edit,
  delete, batch upload, dark-mode tokens; no console errors). **Screenshots impossible** — the
  compositor is stalled in this env (`visibilityState` hidden, `screenshot` times out), so
  verification used DOM/computed values; image decode confirmed via `naturalWidth`.
- **Next: the View PPRs screen** (the app's other half).

### 2026-07-17 — Drawing Register: import filename fix, Add fix, frozen columns, dup flag, +features
- **Import fix:** the workbook's "DWG No" column sometimes holds a submitted *filename* (e.g.
  `…SDP v 2.0 02-27-26.pdf`), which was being used as the drawing code. Now the code comes from the
  outline "No" column and the filename is kept as a `File:` note in remarks. Verified on the real
  file (0 codes contain a filename; SDP rows read `A-001`). **Re-import to apply.**
- **"+ Add drawing" fix:** with no row selected it added an ungrouped row under a collapsed group
  (looked like nothing happened); now it expands the target, scrolls to the new row, and starts
  inline editing.
- **Frozen Code + Title columns** (sticky-left, opaque per-state backgrounds; grid `min-width:1080`
  so narrow screens scroll) and **duplicate-code flag** (amber ⚠ when a code repeats within a phase).
- **Progress tab** no longer shows the (irrelevant) filter bar.
- **Persist per-project view + collapse**, **inline date editing** (Latest Sub. / Approval),
  **saved filter views**, and **jump-to-phase**.
- Assets bumped `?v=20260717a`. Harness-verified (dup flag, inline dates, saved views, jump,
  progress-filter hide, opaque frozen backgrounds); frozen-column sticky couldn't be observed under
  the headless stalled compositor but uses the same proven pattern as Project Schedule.

### 2026-07-16 — Drawing Register: topbar consolidation + bulk status
- **Toolbar moved into the topbar** (Project Schedule pattern): project selector + Register/Progress
  tabs on the left; **+ Add / + Level / Import / Export / Clear** as a flat tool cluster beside the
  profile picture. Body keeps only a slim filter bar. Title goes icon-only under 1150px. Dropped the
  leftover "Approved w/o comments" status-filter option.
- **Bulk status change** on the selection bar ("Set status…" → applies to all selected drawings).
- Harness-verified (topbar layout + no overflow at desktop width, tab switch, Add-from-topbar, Level
  menu, bulk-status all work; no console errors). Assets bumped `?v=20260716j`. No migration.

### 2026-07-16 — Drawing Register: sidebar-less shell + level delete + audit
- **Sidebar removed** to match Project Schedule / Cash Flow — `.dr-modback` back button + title
  in the topbar, full-width content (verified: content spans the full window, user-bar right).
- **Delete a level:** group rows get a hover ✕ (planner+) that deletes the phase/discipline/
  category and everything under it (`deleteLevel`, confirm shows the affected drawing count),
  completing level CRUD.
- **Audit** (harness-verified with a mutable in-memory store, no console errors): code chips
  (A-100/A-200/AR-000) render; level delete cascades (group row + node + child drawings);
  discipline rename cascades to drawings + node; add-level / add-drawing / auto-number / inline
  edit / status dropdown / shift-select / delete / keyboard shortcuts all intact.
- Assets bumped `?v=20260716i`. No migration.

### 2026-07-16 — Drawing Register: editable tree grid + faithful-phase import fix
- **Planner workflow (like Project Schedule's WBS):** new **"+ Level"** menu builds the
  phase/discipline/category skeleton as real rows (`node_kind` column, migration
  `2026-07-16-drawing-register-nodes.sql` — **user must run it**; text-keyed so existing
  imports still group and it's backward compatible). **+ Add drawing / Enter** inserts a
  drawing under the selected row, auto-numbers its code, and opens inline title editing.
- **Excel-like inline editing** (double-click cells; **Status = always-on dropdown**, saves
  immediately); full modal kept per-row (✎). **Selection + keyboard:** click / Shift-click
  range / Ctrl-click toggle / ↑↓ (Shift extends) / Ctrl+A / Delete / Esc / Enter. Compact
  one-screen grid.
- **Removed redundant status** "Approved w/o comments" (merged into "Approved").
- **Import fix — false duplicates + missing A-100/A-200 codes:** the workbook has design
  iterations (Schematic Design 1/2/3/4 Schemes, FCD) that the old `mapPhase` collapsed into
  one "Schematic Design 1", so the same A-101/A-102/A-103 from different iterations piled
  into one group and looked duplicated. Phases are now kept **verbatim** (anchored
  `PHASE_RE` + `cleanPhase`, ordered by workbook appearance), and header rows import as
  **structural nodes carrying their codes** (A-100 Floor Plan, AR-000 Architectural), shown
  as code chips. Verified on the real file (SD1 Floor Plan = A-101, A-102 only; phases
  SD1(S1)=96 / SD2(S1)=178 / SD2(S2)=131 / FCD=646). ⚠️ **Re-import (Clear all → Import) to
  apply.** Assets bumped `?v=20260716h`. Harness-verified (build levels, add-under-select +
  auto-number, inline edit, status dropdown, shift-select, delete, node codes, phase split).

### 2026-07-16 — Drawing Register: category as level-3 group + per-level indent/colour
- **Register is now a 4-level tree** — phase → discipline → **category** → drawing. Category was
  previously only a column, so the workbook's level-3 rows (A-100 Floor Plan, A-200 Elevation,
  A-300 Section, …) were "ignored" (never shown as groups); they're now derived from each
  drawing's `category` field and rendered as collapsible L3 roll-ups (category-less drawings sit
  directly under the discipline).
- **Rows indented + colour-coded by level**: left padding grows with depth (10/30/50/70px) and a
  coloured inset rail marks each level (phase=red, discipline=dark gray, category=gray, drawing=
  line) with graded backgrounds. Assets bumped to `?v=20260716f`. Harness-verified (4-level tree,
  indentation, rails); confirmed 688/1032 drawings in the real file carry a category.

### 2026-07-16 — Drawing Register: level-1 accordion (phases collapsed by default + Expand/Collapse all)
- Level-1 **phase** roll-up rows now start **collapsed on load**, so the register opens as a tidy
  list of phase headers you expand into. Added an **Expand all / Collapse all** toggle in the list
  bar (Collapse all folds every phase; Expand all clears all collapse state incl. disciplines).
  Per-row phase/discipline collapse still works. Assets bumped to `?v=20260716e`. Harness-verified
  (default collapsed → 2 phase rows/0 drawings; expand one phase → its disciplines+drawings; toggle
  round-trips). See `modules/drawing-register/CLAUDE.md`.

### 2026-07-16 — Drawing Register: fix import hang + toolbar/table refinement
- **Import hang fixed (root cause):** `gridOf` ran `sheet_to_json(defval:'')` over the workbook's
  bloated dimension — its "Dwg Registry" sheet declares **16,383 columns**, so it allocated ~100M
  empty cells and froze the tab. Rewrote `gridOf` to read a **bounded window via direct cell refs**
  (cols capped at 60, real row range) + `sheetRows:8000` on `XLSX.read`; parse deferred a tick so
  the "Reading…" spinner paints; insert chunks yield (0-ms `await`) so progress repaints. Verified
  on the real file: ~1s read + ~0.4s parse (was hanging), same 1032 drawings.
- **Toolbar** rebuilt into two rows in one card: project · tabs · action cluster (+ Add drawing
  primary, divider, Import/Export, subtle Clear all) / search (grows) + filters.
- **Collapsible phase & discipline groups** (click the roll-up row; caret indicator).
- Module assets bumped to `?v=20260716d`. Harness-verified (toolbar layout, collapse/expand,
  parse perf). See `modules/drawing-register/CLAUDE.md`.

### 2026-07-16 — Drawing Register: planner delete tools + professional UI pass
- **Clear all** (planner/admin/super_admin only): a type-the-project-id confirm modal that
  deletes every drawing for the current project (storage files first) — for fixing a
  wrong-project import (user hit this). **Bulk select**: checkbox column + per-group/select-all
  + "N selected · Delete selected" bar (chunked 100/req). Per-row delete + RLS unchanged.
- **UI pass:** toolbar in a card; sticky table header with zebra hover; monospace drawing codes;
  tinted phase roll-up rows + gradient progress bars; "Showing N of M" count bar; KPI accent bars.
- **Importer hardened:** `canonDiscipline()` drops a non-canonical discipline value (e.g. a stray
  "A-013" from a mis-detected column on a different workbook) so it can't form a bogus group;
  fixed a latent phase-sort comparator bug.
- Module-local assets bumped to `?v=20260716c`. Verified render + selection + Progress KPIs in a
  stubbed harness (screenshot compositor stalls in this env — checked via DOM/read_page + JS).
  See `modules/drawing-register/CLAUDE.md`.

### 2026-07-16 — Drawing Register rebuilt to full fidelity (matches the GPR101 workbook)
- **Replaced the flat 8-field Drawing Register** with a full rebuild mirroring the Megawide
  "Drawing Register & Tracker" workbook (`GPR101. TEC. Drawing Register`). Now:
  - **Structured drawing code** built from the workbook "Coding Reference" tables
    (`<proj>-<building>-<company>-<type>-<discipline>-<floor>-<number>-<rev>`) via dropdowns +
    a live preview in the Add/Edit modal.
  - **Register view** grouped **phase → discipline** with per-group roll-ups (sheets / approved /
    % bar); filters for phase, discipline, status, search.
  - **Multi-revision submission tracking** (`submissions` jsonb `[{rev,planned,actual}]`), planned/
    actual approval dates, and workbook approval statuses (For Review · Revise & Resubmit ·
    Approved w/ comments · Approved w/o comments · Approved · Superseded). Sheet counts + approved %.
  - **Progress dashboard** tab (KPI tiles + Progress-by-Phase and Progress-by-Discipline tables).
  - **Excel importer** (SheetJS) that reads the workbook's flat "Dwg Registry" layout — infers
    phase/discipline/category from sheet-title indentation + code prefix, pulls every revision's
    planned/actual dates, normalises status. Plus filtered **Export** to `.xlsx`. File upload kept.
- **DB migration `migrations/2026-07-16-drawing-register-full.sql`** (idempotent; folded into
  `supabase-schema.sql`) extends `drawing_register` with code parts, phase/category/description/
  responsible, sheet counts + approved %, `submissions` jsonb, planned/actual approval, `sort_order`.
  **User must run this migration.**
- **Verified** the importer offline with Node+SheetJS against the real workbook: 1032 drawings,
  correct phase/discipline split, per-revision planned/actual dates, sheet counts, normalised
  status (~26/1032 edge codes unclassified). Page loads with no console errors; live click-through
  against a real login still pending. See `modules/drawing-register/CLAUDE.md`.

### 2026-07-16 — ONE migration to run + schema-drift audit (collapse NOT yet safe)
- **`migrations/2026-07-16-consolidated.sql`** replaces the two separate 2026-07-16 files
  (planner-project-visibility + admin-archive-delete, both deleted — recoverable via git). Fully
  idempotent; **this is the only migration outstanding**. Also re-asserts the wbs-nodes table +
  `project_schedule.wbs_node_id` as a safety net.
- **AUDIT FINDING — neither "canonical" schema file is complete.** `supabase-setup.sql` and
  `supabase-schema.sql` have **drifted in opposite directions**, and several tables exist ONLY in
  `migrations/`:
  | object | in setup.sql | in schema.sql |
  |---|---|---|
  | `cash_flow_settings` | ✗ | ✓ |
  | `wbs_nodes` | ✓ | ✗ |
  | `schedule_baselines`, `wpm_work_packages`, `cost_accounts`, `schedule_audit` | ✗ | ✗ |
  Measured against `supabase-setup.sql`: **13 tables, 40 columns, 5 functions missing.** So the
  documented "every migration is folded into setup + schema" convention has NOT been holding, and
  **`migrations/` cannot be deleted yet** — it is currently the only definition of several tables.
- **Replay-safety verified:** all 48 migrations are idempotent/replayable in filename order (checked
  for `create table`/`create index`/`add column` without IF NOT EXISTS, `create policy` without a
  preceding drop, and `create function` without OR REPLACE). The only hazards found were in the
  now-superseded planner file and are fixed. So a true single-file consolidation **is** achievable.
- **ORDERING TRAP for whoever does the collapse:** `supabase-setup.sql` already contains the *fixed*
  per-command `projects` policies, while `2026-06-30-workspaces-project-selector.sql` recreates
  `projects_write` **`for all`**. Naive concatenation (setup + migrations) would silently **reopen
  the planner visibility hole**. The 2026-07-16 fix must be applied LAST.
- **Recommended next step:** build one canonical file as `base schema → migrations in date order →
  2026-07-16 fixes last`, verify with the audit (0 missing objects), diff against the live DB, and
  only then delete `migrations/` and reduce `supabase-schema.sql` to a pointer.

### 2026-07-16 — Workspace edit/delete affordance + view-toggle clipping fix
- **`workspaceModal` was unreachable for EXISTING nodes.** It was only ever called as
  `workspaceModal(null)` (Add menu + `#add-ws`), so once a workspace/program was created there was
  **no way to rename, move, or delete it** — and the `Delete…` button added earlier the same day was
  dead code. Tree nodes now carry a **gear** (`.pd-tree-edit`, `canWrite` only) that opens
  `workspaceModal(w)`. It `stopPropagation()`s — the gear sits inside the `[data-ws]` row whose click
  selects the node. Hidden until hover/selection via **opacity** (not `display`) so it stays
  keyboard-reachable; `:focus-visible` reveals it.
- **Card/list view toggle was clipping its second button.** Root cause (reproduced + measured in a
  throwaway `_ui_test.html` harness against the real CSS): `.pd-toolbar-right` gets 272px, but
  search (202) + gap (10) + toggle (80) needs 292. A text input's flex `min-width` defaults to
  `auto` = its intrinsic width, so **the input refused to shrink and the toggle absorbed the whole
  22px squeeze** — and since `.pd-viewtoggle` sets `overflow:hidden`, it silently **clipped its own
  button** instead of overflowing visibly. Measured: original `clientW 58 / scrollW 80` (clipped);
  fixed `80 / 80` (intact). **Fix:** `.pd-viewtoggle{flex:0 0 auto}` (never shrinks) +
  `.pd-toolbar-right .pd-input-sm{flex:0 1 220px;min-width:0}` (input absorbs the shrink) +
  `min-width:0`/`flex-wrap:wrap` on both toolbar halves.
- `dashboard.css` changed → **`dashboard.css?v=` bumped to `20260716` across all 21 HTML files.**
- **WBS root cause CONFIRMED (see the module's own CLAUDE.md).** The `wbs_node_id`-missing theory was
  right: the wbs-nodes migration hadn't been run when those nodes were created, so their projected
  WBS-Summary rows failed. Checking `information_schema` *after* running the migration shows the
  column present — that is post-migration state, not a disproof. The damage (orphan nodes with no
  schedule row) is now self-healed by `_wbsEnsureSummaries()` in the project-schedule module.
  (Naga exists as **both** a `workspaces` program node **and** a project of the same name — the WBS
  work was on the project; the program is the empty node being deleted.)

### 2026-07-16 — Admin: archive / delete for projects & workspaces
- **Why it isn't a plain DELETE:** ~20 module tables carry `project_id text references
  projects(id)` and most predate `on delete cascade`, so deleting a project that has ever
  been used dies on an FK violation. Cascade-wiping construction records was rejected;
  **archive is the primary action, hard delete is the empty-only escape hatch.**
- **No new archive column.** `projects.status` (`active | archived`) already meant this and
  was already wired — portfolio-overview filters on it, dashboard/projects render a muted
  pill, both Edit Project modals expose it. `admin_archive_project(id, bool)` just flips it
  behind an admin guard. `getProjects()` still returns archived projects (they're meant to
  be visible-but-muted, not hidden).
- **New RPCs** (admin-only, `security definer`, mirroring `admin_delete_user`):
  `admin_archive_project(text, boolean)`, `admin_delete_project(text)`,
  `admin_delete_workspace(text)`. `admin_delete_project` discovers referencing tables from
  the **pg catalog** (any `public` table with a `project_id` column) rather than a hardcoded
  list, so modules added later are covered automatically; it refuses with a message naming
  each blocking table + row count, and strips the id from `users.projects` (text[], no FK)
  before deleting. `admin_delete_workspace` refuses while child workspaces/projects exist.
- **UI:** Archive/Restore + `Delete…` in the Edit Project modal (`projects.html` +
  `admin.html`) and `Delete…` in the Edit Workspace modal. Delete opens a **type-the-id-to-
  confirm** dialog; the DB's refusal message is surfaced verbatim via `UI.toast`.
- `db.js`: `PDb.archiveProject/deleteProject/deleteWorkspace`. **`db.js?v=` bumped to
  `20260716` across all 18 HTML files.**
- Migration `migrations/2026-07-16-admin-archive-delete.sql`. **User must run this migration**
  — the UI calls RPCs that don't exist until then.
- **Known pre-existing bug (not fixed here):** `window.__archived` is read in 8 guards in
  `modules/project-schedule/index.html` but **never assigned anywhere**, so the intended
  "archived projects are read-only" behaviour does not currently work. Archiving therefore
  mutes/filters a project but does not yet make the schedule read-only.

### 2026-07-16 — Fix: planners could see unassigned projects (RLS leak)
- **Bug:** `projects_write` was created `for all`, which covers **SELECT**. Postgres ORs
  permissive policies, so `using (is_planner())` handed every approved planner read access
  to every project row — silently defeating the assignment filter in `projects_read`. The
  name said "write"; the grant was all four commands. Introduced by the 2026-06-30 change
  that widened project writes to planners (see below).
- **Fix:** split into per-command `projects_ins` / `projects_upd` / `projects_del`, leaving
  `projects_read` as the only SELECT gate. Update/delete are now also assignment-scoped
  (`is_admin() or can_access_project(id)`) — a planner could previously edit a project they
  couldn't see. **Insert stays `is_planner()`-only**: a new project isn't in anyone's
  `users.projects` array yet, so planners keep **Add Project**.
- Roles table corrected: `planner` is **assigned projects only**, matching
  `canAccessProject()` in `auth.js` (which always filtered planners — the JS and the DB had
  disagreed since 2026-06-30, which is why the leak went unnoticed in the UI).
- Migration `migrations/2026-07-16-planner-project-visibility.sql` (folded into
  `supabase-setup.sql` + `supabase-schema.sql`). **User must run this migration.**
- Not changed: `workspaces_write` and the activity-codes/steps/last-planner policies use the
  same `for all` + `is_planner()` shape, but leak nothing — their reads are `is_approved()`,
  so every approved user sees those rows regardless.

### 2026-07-14 — Prompt 66: Cash Flow rebuilt as a schedule + WPM-driven projection
- **Replaced the manual Cash Flow CRUD** (period/category/planned/actual entries) with a
  **derived monthly projection** matching the Excel "Cashflow" sheet
  (`EPC. PMO. OPW101 Cash Flow rev1`): a Cash In / Cash Out / Net Cash Flow matrix
  (months as columns) + a cumulative funding curve + KPI cards (Contract IBB, Total In,
  Total Out, Closing Balance, **Peak Funding Need**).
- **Cash In** is driven by the **project schedule**: monthly progress billing = contract
  IBB × ΔS-curve% (duration-weighted from `project_schedule` leaves — same math as the
  S-Curve module), run through a **full terms engine** (downpayment, DP recoup, retention
  withheld + released, billing-terms lag). **Cash Out** is read **live from the WPM
  (procurement) Supabase** `work_packages` (budget, `dp_percent`, `retention_percent`,
  `payment_terms_days`, target dates), each spread over its window with its own terms.
- **New `cash_flow_settings` table** (contract IBB/BCB, DP%, retention%, recoup%, terms,
  start month, **`wpm_project_id` mapping**) — migration
  `migrations/2026-07-14-cash-flow-settings.sql`, folded into `supabase-schema.sql`.
  **User must run it.** Editable via an "Assumptions" modal.
- **Cross-Supabase integration**: a second `createClient` points at the WPM project
  (`cayjeqeleenizbdzrums`, anon key). ⚠️ WPM RLS is behind its own Auth, so a Planners
  user's anon read may return `[]` until a shared read path (public view / shared login) is
  enabled on WPM — the module degrades gracefully and reports status via source chips.
  Project ids differ across the two apps → mapped by `wpm_project_id` (defaults to this id).
- Excel export of the full projection. Verified: JS parses; engine math hand-checked on a
  synthetic fixture — DP/billing-net-of-retention&recoup/retention-release/terms lag land in
  the right months and totals conserve (cash in = contract, cash out = Σ WP budgets).
  Not yet run against live logins + live WPM read. See `modules/cash-flow/CLAUDE.md`.

### 2026-07-14 — Prompt 67: Solve WPM cash-out access — server-side sync (no anon exposure)
- Cash Flow's cash-out needed WPM procurement budgets, but WPM's RLS is `to authenticated`
  only and its anon key is public (client JS) — reading budgets client-side would expose
  them. **Chose a server-side mirror** over an anon view / shared login.
- **New `wpm_work_packages` mirror table** in the Planners DB (migration
  `2026-07-14-wpm-work-packages-mirror.sql`, read = approved users, writes only via
  service role). **New Edge Function `supabase/functions/sync-wpm/`** pulls the needed
  columns from the WPM project using the **WPM service_role key held as a function secret
  (never in the browser)** and upserts the mirror (keyed by `wpm_project_id,wp_no`).
  Caller must be an approved admin/super_admin/planner (JWT verified) or present the
  service-role key (cron).
- **Module** now reads the mirror (removed the browser-side WPM anon client) and gives
  admins/planners a **"Sync from WPM"** button that invokes the function; source chips show
  last-synced date. Verified: module + engine parse; function brackets balanced.
- **User deploy steps:** run both 2026-07-14 migrations; `supabase functions deploy sync-wpm`;
  `supabase secrets set WPM_URL/WPM_SERVICE_KEY`; click Sync. See `modules/cash-flow/CLAUDE.md`.

### 2026-07-14 — Prompt 68: Cash Flow — DP tranches + periodic bar chart
- **Downpayment flexibility**: client DP can now be broken into **tranches**, each tagged
  by trade/commercial-agreement category, timed by a **schedule milestone**, a **fixed
  month**, or an **offset from start**, and **recouped proportionally** (rate blank →
  the tranche's own % of contract). New `cash_flow_dp_tranches` table (migration
  `2026-07-14-cash-flow-dp-tranches.sql` — **user must run it**), edited in the
  Assumptions modal's new "Downpayment Tranches" section (add/remove rows, live DP total).
  Engine `resolveTranches()` replaces the single-DP path; falls back to the simple
  `dp_percent` when no tranches exist. Milestone timing reads named/0-duration schedule
  activities. Conservation verified (total cash in = contract IBB).
- **Periodic bar chart** added above the cumulative chart: green up-bars = cash received,
  red down-bars = cash paid, ink line = net per month (matches the Excel periodic view).
- **Net funding line** recolored to theme-aware `--pd-ink` (was `--pd-dark`, invisible on
  dark). All charts on brand tokens (green in / red out / ink net).
- Assumptions modal widened for the tranche editor. Verified: module parses; tranche
  recoup math hand-checked (multi-tranche total recoup = total DP).

### 2026-07-14 — Prompt 69: Cash Flow — true actual cash-out from WPM award status
- Synced WPM `award_status` (+ procurement/delivery status) into the mirror (migration
  `2026-07-14-wpm-mirror-award-status.sql` + `sync-wpm` edge fn — **run migration, redeploy,
  re-sync**). Engine now decomposes cash-out into **actual vs forecast**: an **awarded** WP's
  payments due on/before the data date are actual committed cash-out; awarded remainder +
  un-awarded packages are forecast. `isAwarded()` = award_status ~/award/i or awarded_cost>0
  or actual_awarding_date. Conserves (actual+forecast = total).
- Periodic chart bars now **stacked** solid (actual) + faded (forecast) per period; tooltip
  shows the forecast portion; KPI shows "actual to date". Cash-in actual is still date-based
  (recorded cash-in actuals not wired yet — noted in the chart sub).

### 2026-07-14 — Prompt 70: Cash Flow v2 — tax, staged retention, actuals ledger, portfolio consolidation
- Migration `2026-07-14-cash-flow-v2.sql` (**user must run**): adds `ewt_percent/vat_percent/
  ret_rel1_pct/ret_rel2_months` to `cash_flow_settings`, new tables `cash_flow_actuals` +
  `cash_flow_rollup`.
- **#1 Tax withholdings**: EWT (default 2%) withheld from each billing on the VAT-exclusive
  base (VAT default 12%); shown as a "Less: EWT withheld" matrix row. Total cash in = contract
  − EWT (EWT is creditable, not returned in project cash).
- **#4 Staged retention release**: stage-1 % at completion+lag, remainder at a stage-2 lag
  (defects-liability). rel1_pct=100 → single release (backward compatible). Applied to cash-in
  and cash-out.
- **#2 Recorded actuals ledger**: `cash_flow_actuals` (period/direction/category/amount) with an
  "Actuals" editor modal; an "Actual vs Plan — to data date" variance card appears when actuals
  exist (recorded in/out/net vs the projection through the data date).
- **#3 Portfolio consolidated cash flow**: the Cash Flow module writes a monthly
  `cash_flow_rollup` (cash_in/out/net) per project on load; Portfolio Overview's Cash Flow tab
  now reads that roll-up → consolidated Cash In/Out bars + **Net funding curve** + peak-funding
  KPI + per-project breakdown (was the old manual `cash_flow` planned/actual view).
- Verified both modules parse; cash-in/out conservation hand-checked with EWT + staged retention.

### 2026-07-14 — Prompt 71: Cash Flow — financing cost, funding limit, scenarios, per-trade cash-in, settable data date
- Migration `2026-07-14-cash-flow-v3.sql` (**user must run**): `finance_rate` +
  `funding_limit` on `cash_flow_settings`; new tables `cash_flow_trade_packages`,
  `cash_flow_scenarios`. (Medium-tier items #5–#8 from the roadmap menu.)
- **#5 Financing cost on peak funding**: annual rate on the negative cumulative
  (drawdown × rate/12 per month) → **Financing Cost** KPI; exported.
- **#8 Settable data date + funding-limit alert**: data date is now a toolbar control,
  **shared with Project Schedule** (`ps_datadate_<pid>` as default; override under
  `cf_datadate_<pid>`). `today()` returns it. `funding_limit` (credit line) → red breach
  banner naming the months where cumulative net < −limit; Peak KPI shows the limit.
- **#6 Scenario snapshots**: save the projection (totals/peak/finance/netCum) to
  `cash_flow_scenarios`; mark a **baseline** → dashboard shows current-vs-baseline Δ table
  (Excel "rev1" parity). First snapshot auto-baseline.
- **#7 Per-trade cash-in packages**: split the contract into trades, each billing its share
  over the shared schedule S-curve with its own DP/retention/terms. When any exists it
  **replaces the contract-level cash-in (DP tranches ignored)**; a banner reconciles the
  package total vs Contract IBB. Per-trade schedules not modeled (all share the one schedule).
- Verified: full inline script parses (`new Function`). Not yet run against live logins.

### 2026-07-14 — Prompt 72: Cash Flow — cost/duration S-curve basis switcher
- Cash-in = contract IBB × Δ schedule S-curve; the curve's weighting is now switchable.
  New `cash_flow_settings.scurve_basis` (`'duration'`|`'cost'`, folded into the v3 migration,
  idempotent — **re-run if v3 was already applied**). Toolbar **Duration / Cost** segmented
  switcher persists to the settings row and recomputes live.
- **Duration** = time-weighted (each activity by duration, the prior behavior). **Cost** =
  value-weighted by per-activity `planned_cost` (Planned IBB), falling back to `bl_cost`.
  **Cost auto-reverts to Duration when the schedule has no cost loaded** — a source chip
  shows the active basis + any fallback. Same weight fn drives planned + actual accrual, so
  the projection tracks exactly the schedule's S-curve. Schedule fetch now pulls
  `planned_cost,bl_cost`. Parses; live run still pending.

### 2026-07-14 — Prompt 73: Cash Flow — basis switcher resilience + toolbar UI polish
- **Fixed the "Could not find scurve_basis column" error** on live (v3 migration not yet
  applied): the basis now **always caches to `localStorage['cf_scurvebasis_<pid>']`** and the
  DB write is best-effort (schema-cache/column errors swallowed). `loadSettings` uses the DB
  value when present, else the local cache — so the switcher works before *and* after the
  migration; running v3 upgrades it to cross-user persistence.
- **Cost button auto-disables** (greyed, tooltip) when the schedule has no cost loaded
  (`model.scurveWithCost === 0`), so it's obvious why Cost has no effect.
- **Toolbar redesigned into one unified bar** (was two rows with a large empty gap): a single
  bordered control strip with the view controls (project · data date · S-curve basis) left and
  actions (Refresh/Sync/Export · Actuals/Assumptions) right, dividers between groups, denser
  buttons; stacks cleanly under 1100px.

### 2026-07-14 — Prompt 74: Cash Flow — live funding position, remove what-if, chart readability
- **Live funding position:** Peak Funding Need + Closing Balance KPIs (and the breach
  banner, scenario snapshots, print report) now use a **live cumulative** = booked recorded
  actuals through the data date + projection after (the same series the chart draws), so
  management sees the funding actually required to finish, not the untouched plan. Identical
  to the plan when no actuals are recorded, so always safe. The plan matrix + variance card
  are unchanged.
- **Removed the what-if slider feature** entirely (modal, CSS, `openWhatIf`/`renderWhatIf`/
  `computeWith`, dangling `cf-whatif` wiring) — low value, and its wiring referenced a
  non-existent button.
- **Chart readability:** y-axis now uses **nice round ticks** (1/2/5×10ⁿ via `niceStep`)
  instead of fractions of the max, so bar magnitudes are readable at any project length.
  Per-bar data labels replaced with **significant-only** labels: peak cash-in month, peak
  cash-out month, and a **peak-funding marker** (vertical guide + value + month) — the rest
  stays on hover.
- Verified: full inline script parses; live run pending.

### 2026-07-14 — Prompt 75: Cash Flow — remove sidebar (match Project Schedule), revert data labels
- **Sidebar removed:** the left `.pd-sidebar` is gone, matching the Project Schedule module —
  a `.cf-modback` back-to-modules button (→ `dashboard.html`) sits in the topbar, content is
  full-width. `UI.initShell()` no-ops without a sidebar (returns early), so the call is harmless
  and no stray hamburger is injected.
- **Data labels reverted** to the previous cleaner per-bar style (`showLab` = quarterly or
  band ≥ 44px shows each bar's cash-in above / cash-out below) — removed the significant-only
  labels + peak-funding marker added in Prompt 74. The **nice round y-axis ticks (niceStep)**
  from Prompt 74 are kept.
- Verified: full inline script parses; shell structure balanced; live run pending.

### 2026-07-14 — Prompt 76: Cash Flow — resilient settings save + VAT checkbox
- **Audit fix (schema resilience):** the Assumptions save was all-or-nothing — a single column
  missing from the live `cash_flow_settings` (e.g. `ewt_percent`, when v2 wasn't applied) rejected
  the whole upsert and lost all input. New `tolerantWrite()` self-heals: on a "column not found"
  error it drops that column and retries (settings upsert + tranche/trade inserts), then warns
  *"Saved, but N field(s) not stored — run the pending migration(s): …"*. Real fix is still to run
  the pending migrations (`cash-flow-v2`, `cashout-retention-stages`, `trade-dp-tranches`).
- **VAT input → checkbox:** the `VAT %` numeric field is replaced by **"Contract is VAT-inclusive
  (12%)"** (checked → `vat_percent = 0.12`, unchecked = zero-rated/VAT-exempt → `0`). VAT is never
  *added* (IBB is VAT-inc); the value only derives the VAT-exclusive base for EWT. No migration
  (same `vat_percent` column, just a binary control).
- Verified: full inline script parses; live run pending.

### 2026-07-14 — Prompt 77: S-Curve rename + sidebar removal; Cash Flow schedule load sped up
- **S-Curve module:** renamed "Progress S-Curve" → **"Project S-Curve"** (topbar title, chart
  heading, tab title). Removed the left `.pd-sidebar` (matches Cash Flow / Project Schedule) —
  a `.sc-modback` back-to-modules button in the topbar, full-width content; `UI.initShell()`
  no-ops without a sidebar. ("pp" in the Schedule Variance KPI = **percentage points**, the
  absolute Actual−Planned gap at the data date.)
- **Cash Flow schedule load faster:** `loadSchedule` switched from OFFSET (`.range()`) to
  **keyset pagination** (`order id.asc & id > last, limit 1000`) — each page is an indexed PK
  range scan instead of a re-scan that grows with offset, so large schedules (16k+ activities)
  load without the OFFSET slowdown/timeout (same fix Project Schedule already adopted). Bigger
  win still available later: a server-side monthly S-curve RPC so the browser fetches ~dozens of
  monthly buckets instead of every activity.
- Verified: both modules parse; live run pending.

### 2026-07-14 — Prompt 78: Cash Flow — drill-down symmetry, per-trade cash-out, assumptions nudge, chart polish
- **Server-side S-curve aggregate** was already built (`cashflow_schedule_agg` RPC +
  `2026-07-14-cashflow-schedule-agg-rpc.sql` + client fast-path/fallback); user just runs that
  migration to activate it (else the keyset client aggregate runs). Deleted a duplicate migration.
- **Cash-in drill-down symmetry:** cash-IN matrix cells are now clickable too (was cash-out only).
  `rowDrill(label,arr,comp,dir)` replaces `rowOut`; `renderDrill(dir,comp,mi)` reads `model.inBreak`
  (DP tranches / trades / milestones / progress billing) or `model.outBreak` (work packages).
- **Per-trade cash-out (auto-detect):** the cash-out drill-down groups work packages by **trade**
  with WPM-style collapsible headers (trade · WP count · subtotal). New `trade` column on the
  `wpm_work_packages` mirror (`2026-07-14-wpm-mirror-trade.sql`); `sync-wpm` now selects `*` and
  auto-detects the trade (first present of trade / cost_code_category / category / discipline / …).
  Client `loadWPM` requests `trade` tolerantly (retries without it pre-migration). **Deploy: run the
  migration, redeploy `sync-wpm`, re-Sync.**
- **Assumptions completeness nudge:** a gentle amber card lists unset/zero assumptions (BCB,
  retention, downpayment, EWT, WPM cash-out source) with an "Open Assumptions" button.
- **Narrowed WPM fetch** (explicit columns, not `select('*')`) kept. **Chart polish:** uniform
  9.5px axis/data labels, wider left pad so negative ₱ y-labels don't clip, light vertical
  gridlines at each labelled period to line bars up with the x-axis.
- Verified: full inline script parses; live run pending.

### 2026-07-14 — Prompt 79: Cash Flow — tabbed Assumptions, loading skeleton, confirmed WPM trade
- **Tabbed Assumptions modal:** the long form is split into 5 tabs — Contract · Tax & Retention ·
  Terms & Funding · Downpayment · Billing (all field ids unchanged, so `saveSettings` is untouched).
- **Loading skeleton:** the bare "Loading projection…" line is replaced with shimmering KPI-tile +
  chart placeholders (`skeletonHTML()`).
- **WPM trade auto-detect confirmed:** checked the WPM app schema on disk — `work_packages.trade`
  is the real column (Site Works / Mechanical Works / Electrical and Auxiliary Works …), and the
  WPM app itself groups "by Trade". `sync-wpm` already leads with `w.trade`, so **"Uncategorized"
  only appears until the deploy is done**: run `2026-07-14-wpm-mirror-trade.sql`, redeploy
  `sync-wpm`, re-Sync. Also made the `sync-wpm` upsert **self-healing** (drops a missing mirror
  column like `trade` and retries, reporting `dropped`) so a partial deploy can't fail the whole sync.
- Verified: script parses; all 19 assumption field ids intact.

### 2026-07-14 — Prompt 80: Cash Flow — trade fallback classifier (no more "Uncategorized")
- Cash-out WPs still showed **Uncategorized** because the mirror's `trade` is empty until the
  `sync-wpm` redeploy + re-sync (WPM's `trade` is set from import group headers, authoritative).
  Added a client `tradeOf(w)` / `classifyTrade(desc)` fallback: uses the synced `w.trade` when
  present, else classifies from the description (mirrors WPM's trade keywords + a **General
  Requirements** bucket for overhead — admin/fuel/security/garbage/permits/…). Verified the four
  visible overhead WPs (Admin Workers, Fuel and Oil, Security Services, Garbage Disposal) now group
  under General Requirements. Real WPM trade still wins once synced.

### 2026-07-14 — Prompt 82: Cash Flow — incomplete-terms tracker + drill-down Chart/Table views
- **Incomplete-terms tracker:** WPs whose WPM DP% / Retention% / Terms are blank (so their
  cash-out is un-shaped) are flagged. Engine collects `model.wpIncomplete`; a collapsible card
  ("N work packages with incomplete WPM terms") lists WP / description / trade / missing fields /
  budget, and each such WP gets an amber ⚠ badge in the drill-downs. Behavior unchanged (still
  0-when-blank), just made visible.
- **Better drill-down presentation:** the cash-in / cash-out drill-down now has a **Chart** view
  (ranked horizontal bars sized by share, grouped by trade with subtotals, actual/forecast tags)
  and keeps **Table** as a toggle option (persisted `cf_drillview`; Chart default). `renderDrill`
  remembers `lastDrill` so the toggle re-renders in place.
- Verified: script parses.

### 2026-07-11 — Live DB verification (first real-login check of the schema)
- **Ran the first live audit** of the production Supabase (`planners-app`, project `bgupuqnkqhixpuctyder`)
  against what the code expects — most feature batches to date were only harness-verified. New
  `planning-app/VERIFICATION.md` playbook (security / migration self-check / click-through).
- **Security sweep:** repo is clean — only the anon key (JWT `role:anon`) is in `config.js`; no
  `service_role` key anywhere. The exposed key still needs dashboard rotation (user-only action;
  ⚠️ legacy JWT keys → rotating the secret also rolls the anon key → must update `config.js` + bump
  `?v=`). Captured in VERIFICATION.md §0.
- **Migration gap found + fixed live:** all 21 expected tables present, but `project_schedule` was
  **missing `activity_codes` and `udf`** (both jsonb) — so per-activity Activity-Code and UDF
  assignments had been failing to persist *silently* (tolerant writes). Ran
  `alter table project_schedule add column if not exists activity_codes/udf jsonb default '{}'::jsonb;`
  in the SQL editor; re-check returned 0 missing. The definition tables (activity_code_types/values,
  activity_udf_defs) already existed — only the two jsonb columns were absent.
- **Still pending:** the §2 app click-through (needs a logged-in session on the deployed/preview app),
  and the key rotation.

### 2026-07-06 — Prompt 65: Asset cache-busting (fixes recurring "stale side panel" on deploy)
- User reported the side panel "still needs work" with screenshots showing `Project HomeNone
  selected` jammed on one line and projects.html missing the new PORTFOLIO/PROJECT/SYSTEM
  sections. **Root cause was NOT a code bug** — verified in a preview harness that the source
  `dashboard.css` is correct: a cache-busted fetch returns `.pd-sidebar .pd-navtxt { display:flex;
  flex-direction:column }` and the label stacks (30.8px / two lines, sub-caption 10.5px), but the
  page's `<link>` had loaded a **stale cached copy with no `.pd-navtxt` rule at all**. The three
  screenshots disagreed with each other because each tab had cached CSS/HTML from a different
  deploy. This is the same stale-cache symptom flagged in Prompts 45/53/64.
- **Durable fix:** appended a version query string (`?v=20260706`) to every local `assets/**`
  `.css`/`.js` reference across all 21 HTML pages (132 refs) so each deploy is a fresh cache key
  and browsers pick up changes without a hard refresh. CDN scripts (SheetJS/Supabase, `http` URLs)
  left untouched. The replace is idempotent (pattern requires the extension immediately before `"`,
  so an already-versioned URL won't re-match).
- **⚠️ MAINTENANCE — bump the version every deploy that changes a shared asset.** With PowerShell
  from the repo root (updates all HTML in one pass, no BOM):
  ```powershell
  $old='20260706'; $new='20260707'; $u=New-Object System.Text.UTF8Encoding($false)
  Get-ChildItem planning-app -Recurse -Filter *.html | % {
    $t=[IO.File]::ReadAllText($_.FullName); $n=$t -replace ("\?v="+$old),("?v="+$new)
    if($n -ne $t){ [IO.File]::WriteAllText($_.FullName,$n,$u) } }
  ```
  (Use the deploy date or any monotonic token. Forgetting to bump = the old stale-cache behavior
  returns for changed assets.)

### 2026-07-06 — Prompt 64: Side-panel optimization (sections, caption, project sub-label, icon rail)
- **Grouped the top-level nav into scope sections** — PORTFOLIO (Projects, Portfolio Overview) ·
  PROJECT (Project Home) · SYSTEM (Admin) — on all four shell pages (dashboard, projects, admin,
  portfolio-overview). New `.pd-navsec` label style. The SYSTEM section is gated with the Admin
  link (`#nav-sys` revealed alongside `#nav-admin` for admin/super_admin; admin.html shows it
  since only admins reach it).
- **One consistent brand caption** — the four different red captions under the logo ("Project
  Home"/"Project Portfolio"/"Admin"/"Portfolio Overview") are now all **"Planning Suite"** (the
  active nav item already indicates the page).
- **Current project shown under "Project Home"** — a `.pd-nav-sub` sub-caption filled by
  `UI.initShell` from `sessionStorage['pd_project_name']` (falls back to id, then "None selected").
  Label + sub stack via a new `.pd-navtxt` flex column.
- **Icon-rail collapse** — the hamburger now collapses the sidebar to a slim **64px icon rail**
  (centered icons, `title` tooltips) instead of hiding it to zero width. Bare-text module labels
  collapse via `font-size:0`; wrapped `.pd-navtxt` labels via `display:none` (their sub-caption's
  explicit font-size ignores the font-size:0 trick). This shared change gives every module the
  same icon rail when collapsed (was: fully hidden).
- Verified in a static sidebar harness (expanded + collapsed side by side): sections render,
  caption consistent, project sub-label stacks, rail = 64px with icons only and no leaking text.
  (Note: the preview served a stale cached `dashboard.css` at first — needed a cache-bust query;
  the live GitHub Pages site will likewise need a hard refresh.)

### 2026-07-06 — Prompt 63: Uniform side-panel navigation
- Made the sidebar nav consistent across the app (was divergent: "All Projects" vs "Projects",
  Portfolio Overview/Project Home only on some pages, 6 modules using a raw `&larr; All modules`
  instead of the icon, odd sibling cross-links).
- **Top-level pages now share ONE nav** (dashboard.html, projects.html, admin.html, and the
  portfolio-overview module): **Projects · Project Home · Portfolio Overview · Admin**, each
  marking its own item active; Admin is gated (`#nav-admin`, revealed for admin/super_admin —
  added the reveal to portfolio-overview; admin.html only admins reach so it's shown active).
- **Module pages now uniform**: every module has a single `arrowLeft` **"All modules"** back-link
  + its own in-module view tabs. Fixed the 6 placeholder modules that used a bare `&larr;`; removed
  the inconsistent "Project Schedule" sibling cross-links from **s-curve** and **resource-loading**
  (navigation is back-to-grid + the module's own tabs, like every other module).
- Pure markup (plus one gating line); verified all navs identical per tier and JS still parses.

### 2026-07-06 — Prompt 62: Fix unstyled modal header/footer (sitewide) + Resource Master form polish
- User shared screenshots of the Resource & Role Master Add Resource/Role/Calendar modals: the
  title sat cramped right against the × close button instead of spread across the header. Root
  cause: `.pd-modal-header`/`.pd-modal-close`/`.pd-modal-footer` had **no CSS defined anywhere**
  — not in resource-loading, not in cash-flow or project-schedule (identical markup), not in
  the shared `dashboard.css`. This had been true since project-schedule's Add Activity modal
  was first built, just never flagged before.
- **Fixed at the shared level** (`assets/css/dashboard.css`): header is flex/space-between with
  a bottom border, close button is a proper hoverable square, footer buttons are right-aligned
  with a top border — using negative margins so the fix doesn't disturb the many OTHER modals
  built via `UI.modal()` that dump raw HTML straight into `.pd-modal` without this header/footer
  wrapper. Fixes all three modules that use the pattern in one change.
- **Resource & Role Master modal polish**: Add Resource split into labeled sections
  (Identification / Classification / Availability & Calendar / Notes); the Calendar dropdown
  now **defaults to the project's default calendar** for new resources instead of blank "—"
  (previously every new resource required a manual calendar pick); Add Calendar's one long
  inline label became a short section header + field label + a proper hint paragraph.
- Verified in a stubbed harness: `.pd-modal-header` computes to `display:flex` (was `block`),
  footer is right-aligned, new-resource Calendar select pre-selects "Philippine Standard
  (6-day, 8h) (Default)", old verbose label confirmed gone.

### 2026-07-06 — Prompt 61: Cash Flow built + Portfolio Overview cross-project S-Curve/Cash Flow tabs
- Decided which modules belong in Portfolio Overview: **Project Schedule, S-Curve, Cash Flow,
  Resource Loading** (aggregate meaningfully across projects) — **not** Risk Register, Drawing
  Register, Progress Photos, Contracts & Claims, Material Submittal, Stakeholder Map, Issues &
  Lessons (per-project operational logs with no obvious cross-project rollup). Chose real
  cross-project data views over quick nav tiles (a tile would just duplicate what
  `projects.html` already does).
- **Discovered Cash Flow was never built** — still the bare placeholder screen, no CRUD, so
  `cash_flow` had zero real rows anywhere. **Built it**: project/category/search filters, KPI
  cards, a monthly Planned-vs-Actual chart (bars + cumulative lines), sortable table, Add/Edit
  modal. Flipped `enabled: true`. See `modules/cash-flow/CLAUDE.md`.
- **Corrected a wrong assumption about S-Curve**: the real single-project S-Curve module
  computes its curve live from `project_schedule` (duration-weighted per-activity); the
  `s_curve` DB table is vestigial (no writer, unused). A portfolio S-Curve therefore needs
  either an approximation or a real fetch across projects — chose the real fetch.
- **Portfolio Overview gained a tab strip** (Overview / S-Curve / Cash Flow), the existing
  dashboard moved unchanged into the Overview tab:
  - **S-Curve tab**: fetches real `project_schedule` rows (paginated, `.in('project_id', ids)`)
    across whichever projects the existing multi-select project filter resolves to, and reuses
    the single-project module's exact duration-weighted `compute()` math unmodified — combining
    activities from multiple projects into one array "just works" since the math never looks at
    `project_id`. Warns above 20,000 combined activities.
  - **Cash Flow tab**: fetches `cash_flow` across the same scoped project ids (cheap), monthly
    Planned/Actual bars + cumulative curves + a category breakdown table.
  - Both lazy-load on first tab visit, cache by the current project-id scope, and have a
    Refresh button (so changing the Overview filter while already on a data tab doesn't go
    stale without also refiring a heavy query on every keystroke).
  - Resource Loading's portfolio view is intentionally deferred — its `resource_assignments`
    table showed 27,796 rows for a *single* project in the P6 import (Prompt 60), so it needs a
    server-side aggregation (Postgres view/RPC) before it's safe to query at portfolio scale.
- Verified in stubbed harnesses (no real backend touched): Cash Flow module CRUD+chart+KPIs
  hand-checked exactly; Portfolio's new tabs hand-checked against a synthetic 2-project fixture
  (S-Curve: TOT=186 duration-days, 33.2% overall, 57.9% planned-to-date, -24.7pp variance; Cash
  Flow: ₱1.15M planned/₱990k actual across 4 entries, category breakdown to the peso) and
  confirmed the project filter narrows both new tabs identically to the Overview tab (all-2 →
  1-of-2 project scoping reproduced the correct smaller totals on both).

### 2026-07-06 — Prompt 60: P6 (.xer) import
- **Project Schedule's importer now accepts Oracle Primavera P6 `.xer` exports** (button
  renamed "Import Excel/XER (OPC / P6)", auto-detected by file extension). New `parseXER`
  tokenizes the XER `%T`/`%F`/`%R` tab-delimited table format (Windows-1252 text) and imports:
  **CALENDAR** → the `calendars` table (a hand-rolled recursive-descent parser reads P6's
  proprietary `clndr_data` grammar for the working-day pattern + holiday exceptions), **PROJWBS**
  → WBS rows via the real `parent_wbs_id` tree (not an outline-level guess), **TASK** →
  activities (with milestone typing + calendar linkage), **TASKPRED** → the same predecessor
  text format the CPM engine already parses, **RSRC**/**TASKRSRC** → `resources` +
  `resource_assignments`.
- User supplied a real 26MB/97,906-line cost-loaded P6 export ("JENARA - COSTLOADED.xer",
  27,811 activities, 14,495 WBS nodes) as the test fixture instead of building blind from spec.
  Verified the parser against it directly (Node, extracted from the shipped module code, no
  reimplementation): parses in ~600ms; exact row-count matches on every table; 100% predecessor
  resolution (27,796/27,796); 0 activities missing dates; correct milestone typing (11); a
  spot-checked activity's dates/calendar/predecessor matched the source file exactly. Confirms
  the file's actual working calendar is genuinely a 6-day/8-hour week (Mon–Sat), the same shape
  as the "Philippine Standard" default calendar added this week.
- **Not yet exercised end-to-end against live Supabase** — the parsing/mapping logic is
  verified against real data, but nobody has actually clicked Import against a live login (that
  would write ~42k activity rows + 27.7k assignments into whichever project is selected — left
  for the user to run and confirm rather than done unattended).

### 2026-07-06 — Prompt 59: Resource & Role Master typo, Portfolio multi-project filter, working calendars
- **Typo fix**: `config.js` had the resource-loading module name as the literal string
  `'Resource &amp; Role Master'`. Since module names render through `Fmt.esc()` (which itself
  HTML-escapes `&`), the double-escaping showed literal `&amp;` on the module tile instead of
  `&`. Changed to a plain `&` (matches every other module name).
- **Portfolio Overview project filter is now multi-select**: the old single "All projects /
  one project" dropdown couldn't show "only the projects that are selected" (plural). Replaced
  with a checklist dropdown (search + Select all/Clear); KPIs, donut, budget bars, and table all
  narrow to the checked set, no selection = all projects. Verified in a stubbed harness.
- **Working calendars** (resource-loading + project-schedule): new `calendars` table
  (project-scoped) — a Mon–Sun working-day pattern + hours/day + an editable extra-holiday list
  (for Eid'l Fitr/Eid'l Adha/proclamation-moved dates, announced yearly and not computable
  offline). New shared `assets/js/calendar.js` (`PDCal`) computes Philippine *regular* holidays
  (fixed-date + Easter-derived Maundy Thursday/Good Friday) and working-day counts against a
  calendar. One **"Philippine Standard (6-day, 8h)"** calendar auto-seeds per project.
  - **Resource Master** gets a third **Calendars** tab (CRUD); the Resources tab's Calendar field
    is now a dropdown into `calendars` (`resources.calendar_id`) instead of free text.
  - **Project Schedule**'s Activity modal Calendar field is the same dropdown
    (`project_schedule.calendar_id`); the FTE/Max-Availability histogram (`resCapacity`) now
    computes working-day capacity from **each resource's own assigned calendar** instead of a
    hardcoded 5-day Mon–Fri week (a resource with none assigned falls back to the Philippine
    Standard shape, which is also now the honest default rather than "5-day" being implied).
  - Migration `migrations/2026-07-06-working-calendars.sql` (folded into `supabase-setup.sql`).
    **User must run this migration.**
  - Verified: PDCal's 2026 regular-holiday set and working-day counts hand-checked (June 2026 =
    25 working days on the 6-day calendar, 21 on a 5-day comparison calendar); `resCapacity`
    math against two calendar-shared resources (100%+50% max) reproduced 37.5 exactly. Resource
    Master's Calendars CRUD + Resources' calendar dropdown verified end-to-end in a stubbed
    harness (add calendar → shows in dropdown → resource roster resolves the name).
- **Deferred**: P6 (`.xer`) / MS Project / newer OPC import format detection — user is supplying
  a sample `.xer` file next prompt so the parser can be built and verified against real data
  instead of guessed from spec.
- **Heads-up (not code, carried over)**: Resource & Role Master's "Could not find the table
  'public.resources'" error means `migrations/2026-07-01-resource-role-master.sql` still hasn't
  been run on the live Supabase project — same for this prompt's new
  `2026-07-06-working-calendars.sql`.

### 2026-07-03 — Prompt 58: Portfolio placement + project filter; S-Curve performance-based forecast
- **Portfolio Overview is no longer a per-project module** — removed its `config.js` MODULES entry
  (with a note explaining why) so it doesn't appear in the per-project module grid and can't imply
  it belongs to the open project. It stays reachable from the **Projects selector** (`projects.html`
  top-level nav link, added last prompt). Module files unchanged otherwise.
- **Project filter in Portfolio Overview** — new "All projects / <project>" select in the toolbar;
  `projFilter` narrows every view (KPIs, charts, table) to one project. Verified: selecting a
  project drops the Projects KPI 2→1 and the table to that row.
- **S-Curve forecast-to-finish redone (performance-based + S-curve shape)** — was a straight line
  to a manual/planned date, which let a behind project forecast finishing *early*. Now:
  - **Auto forecast finish** = data date + remaining planned duration ÷ **SPI** (SPI = actual% ÷
    planned% at the data date, clamped 0.1–3). Behind (SPI<1) → finish slips later; ahead → earlier.
  - **Forecast curve** follows the *shape of the remaining planned work*, time-stretched to the
    forecast finish and scaled from the actual% at the data date up to 100% (an S-curve, not a line).
  - The date input shows the effective finish; **set a date to pin/override, clear it to revert to
    auto** (`fcManual` + `localStorage['sc_fc_<pid>']`). Basis line reports SPI + auto date.
  - Verified (one 2024–2027 activity, 20% done at a mid-2026 data date): SPI 0.32, auto finish
    2031-03-07 (far past the 2027 plan — correctly later), 19-point forecast polyline; manual pin
    2028-06-30 + revert-to-auto both work.
- **Heads-up (not code):** Resource & Role Master throws "Could not find the table 'public.resources'"
  — the `migrations/2026-07-01-resource-role-master.sql` migration hasn't been run on the live
  Supabase yet. User must run it (creates `resource_roles`, `resources`, `resource_assignments`).

### 2026-07-03 — Prompt 57: New Portfolio Overview module (cross-project dashboard)
- Built `modules/portfolio-overview/` — a standalone, **project-agnostic** dashboard over ALL
  accessible projects (RLS-scoped), separate from the per-project Project Home. Reads only
  `PDb.getProjects()` + `PDb.getWorkspaces()` (no new table / migration); reuses dashboard.html's
  Workspace→Program→Group-Head tree helpers.
- **KPI cards**: Projects, Active, Avg Schedule %, Original Budget, Estimated Cost, Budget
  Variance, Over Budget count, Behind Schedule count.
- **Schedule Health donut** (SVG): On Track / Behind / No Schedule (behind = slipped vs baseline
  finish or overdue-and-incomplete). **Budget-by-group bars** (SVG): Original vs Estimated, top 8.
- **Grouped sortable table**: group by Workspace / Program / Group Head / Status / None with
  per-group subtotals + grand total, collapsible groups, click-through to a project
  (sets `pd_project` → dashboard.html). Filters (status, behind-only, search) + Excel export.
- **Discovery**: registered in `config.js` MODULES (enabled) so it shows on the module grid, and
  added a top-level nav link in `projects.html`. Icon `barChart`.
- Verified in harness (5 synthetic projects across a Workspace→Program→Group tree): all KPIs,
  donut counts (3/1/1), workspace subtotals (Calimag ₱300M/₱310M/+₱10M), grand total, group
  switching (Group Head), behind-only filter (WCB), and drill-down all correct; screenshot-confirmed.

### 2026-07-03 — Prompt 56: FTE / Max-Availability line in Resource Usage histogram
- Completed the last deferred assignments-phase item. Added a working-calendar capacity model to
  the Resource Usage histogram:
  - **Working calendar**: `workingDaysInMonth` counts Mon–Fri per period (5-day week, cached);
    hour-based UoM assumes an 8h working day (`HPD`), day-based UoM = 1 unit/day.
  - **Max Availability line** (`resCapacity` → `capMax[i]` = Σ `max_units_per_time%` × working-days
    × units-per-full-day): a red dashed stepped line drawn per period on the histogram (bars above
    it = over-allocation), with a legend entry; folded into the chart's y-max so it's always in view.
  - **FTE toggle** (persisted `ps_fte`): converts bars to Full-Time Equivalents by dividing units
    by a *single* full-time resource's period capacity (`perFTE[i]` = working-days × units/day) —
    so a fully-loaded person reads 1.0 and a 2-person team 2.0; the availability line becomes the
    summed max % (e.g. 100%+50% → 1.5 FTE). Axis switches to FTE numbers.
  - `usageChartSVG` gained `opts.maxLine` (stepped red-dashed line + legend + y-max) and an `fte`
    axis-unit; roster entries now carry `maxpct`/`uom` (from the resource master, default 100%/days
    for the Responsible-Party fallback).
- Verified in harness (2 resources on a June activity, 22 units each; June = 22 working days):
  Units mode axis tops at 47d (44 planned ×1.06) with the availability line at 33d (22×100% +
  22×50%); FTE mode axis tops at 2.12 (44÷22 = 2.0 FTE) with the line at 1.5 FTE. Screenshot-confirmed.

### 2026-07-03 — Prompt 55: UI polish pass (topbar, icon toolbar, column menu, tab strip)
- **Removed the duplicate top-bar Download** — kept only the grid-footer Download (OPC has it under
  the grid). Print/undo/redo/health/reports/filter/refresh remain top-bar icons.
- **Icon-only toolbar** — Expand all, Collapse to, Views, Schedule, Layout, Columns, Critical path,
  Link are now square icon buttons with tooltips (no text labels), so the single-row toolbar fits
  without horizontal scrolling. Actions ▾, +Add activity, Group select, zoom seg, and search keep
  labels.
- **OPC column-header menu** — clicking any grid column header opens a menu (verified against OPC's
  Sort / Align / Adjust to fit / Find&Replace / Unpin / Rename / Format): **Sort Ascending /
  Descending** (reorders leaf siblings within their WBS parent, tree structure preserved; ▲/▼
  indicator on the header, persisted), **Adjust to fit content** (auto-sizes the column to its
  widest cell), **Rename Column…** (persisted in `ps_colnames`), **Hide Column** (Activity Name
  locked). `GRID_COLS` remains the single source of truth.
- **Top bar rebuilt** — project name + workspace subline moved next to the title (were pushed to
  the far right, leaving dead space); the select is borderless/title-styled and the workspace
  subline shares its left padding so they line up exactly (verified: both start at the same x).
  Tool icons tightened; theme toggle + avatar stay far right.
- **Single seamless detail-tab strip** — the "Activity Details ▾ / Project Usage ▾" group-toggle is
  gone; all seven tabs (General/Status/Relationships/Trace Logic · Activity/Resource/Role Usage)
  sit in one row separated by a thin divider.
- **Details-panel grip turns red on hover/drag** (adds a `.drag` class), matching the grid/Gantt
  divider affordance.
- **Global Bar Colors moved into the Gantt pane** (it's a Gantt-only feature) — a small floating
  gear button top-right of the Gantt opens the colors menu; removed from the toolbar.
- Sidebar auto-hide was already the shipped behavior (`UI.initShell` defaults collapsed; the
  hamburger toggles it) — the user's expanded state was their own persisted toggle, no code change.
- Verified in harness: download/colors relocation, 7-tab strip, icon toolbar, and the full column
  menu (sort reorders Zebra/Alpha/Mike→Alpha/Mike/Zebra, rename Status→State persists, hide Float,
  fit) all correct; top-bar name/workspace alignment confirmed numerically.

### 2026-07-03 — Prompt 54: Data Date, OPC Schedule dialog, export & Resource-Usage parity
- **Editable Data Date (OPC parity)** — the data date was hard-coded to `today()` at ~15 sites,
  all of which semantically mean the as-of date. Renamed the wall-clock helper to `wallToday()`
  and made `today()` return a settable `dataDate` (fallback = wall clock), so every consumer
  (CPM remaining-work floor, Gantt data-date line, usage remaining spread, look-ahead origin,
  behind-schedule) becomes data-date-aware with no site-by-site changes. Persisted per project
  (`localStorage['ps_datadate_<pid>']`), loaded in `load()`. New **"Data Date: DD-Mon-YY" badge**
  in the top bar beside the title (OPC's badge).
- **Schedule dialog (OPC "Schedule")** — replaced the `Schedule ▾` dropdown with a modal matching
  OPC: tabs **Schedule Project** (data-date radio: system vs specific + date input + "Display
  scheduling log"), **Settings** (Retained Logic / Progress Override + Use-actual-dates), and
  **Multiple Float Paths** (near-critical highlight toggle + float threshold, `mfpOn`/`NEARDAYS`
  now persisted and gate the near-critical display). Footer: **Reset Default Options / View Log… /
  Cancel / Schedule Now**. Schedule Now commits the data date + options, recomputes CPM, re-renders,
  and writes a scheduling log (shown if the log box is ticked, else a toast).
- **Export matches OPC's Download exactly** — `exportExcel` rebuilt to OPC's Activities layout:
  columns `#, ID, Name, Status, BL0 Start, BL0 Finish, Start, Finish, Planned Value POC, Earned
  Value POC, Planned IBB, Actual IBB to date, Earned Value IBB, At Completion IBB, BL Planned IBB,
  Percent Complete Type` (exact order); WBS summary rows included with rolled dates; **OPC date
  format DD-Mon-YY with " A" actual flag** (new `fmtOPCDate` — note the pre-existing `opcDate` is
  the importer's *parser*, kept separate); POC cells as `0.00%`, IBB as `₱#,##0.00`; sheet
  "Activities"; filename "Activities - <project>.xlsx".
- **Resource Usage parity** — roster gains OPC's **ID / Type / Unit of Measure** columns (Type=Labor,
  UoM=days defaults; Default Units/Time & Primary Role still pending the resource-loading module,
  noted in-panel) + a **Download** button exporting the monthly units spread (Planned/Actual/
  Remaining × Total × months) to "Resource Usage - <project>.xlsx".
- Verified in harness: badge/gantt line move with the data date (→15-Jul-26); dialog tabs render &
  persist; export header/dates/%/₱ formats + WBS rows + EAC (A1020 BAC/CPI=180k) all correct;
  resource roster columns + download spread correct.

### 2026-07-03 — Prompt 53: Reports library + column chooser + network auto-filter
- **Reports (OPC "Select Report to Run" parity)** — new clipboard button in the top bar beside
  Health opens a modal with: **View** dropdown (All / Built-in / Saved), **Search**, **Create
  New Report**, a **report list**, a live **preview** pane, and per-report actions **Run (PDF)**,
  **Edit / Edit & Save As**, **Delete**. Five built-in templates (Schedule, Cost/EVM with totals,
  Predecessor & Successor, Critical Path, Look-ahead) render from the loaded schedule; users
  save custom reports (template + name + look-ahead weeks + include-completed) to
  `localStorage['ps_reports']`. **Run** opens a print-ready, brand-styled window and triggers the
  print dialog (Save as PDF) — mirroring OPC's PDF output. Verified: totals correct
  (₱640k/₱200k/₱290k/CPI 1.00), search filters, create/edit/delete round-trip.
- **Column chooser (OPC grid-settings wrench)** — new wrench button in the toolbar (next to
  Layout) lists all 18 grid columns with checkboxes (Activity Name locked as the anchor column)
  + Show-all/Reset. Hides columns via an injected `nth-child` stylesheet scoped to
  `.ps-grid-pane` (columns share CSS classes, so class-based hiding wasn't an option — every row
  emits one `.ps-cell` per `GRID_COLS` entry in order, making `nth-child` exact). Persisted in
  `localStorage['ps_colhidden']`; `GRID_COLS` is now the single source of truth for header + chooser.
- **Activity Network auto-filters to linked activities** — the PERT view now shows only
  activities that have a predecessor or successor by default (was showing every leaf, forcing
  manual filtering), with a header readout ("Showing N of M · K unlinked hidden") and a **Show
  unlinked activities too** toggle. Also raises the ≤300-node ceiling in practice since unlinked
  noise is dropped.
- Repo hygiene: removed a `_ui_test.html` smoke-test harness that leaked into the repo in
  prompt-`0236155`, and added `**/_ui_test.html` to `.gitignore` so throwaway harnesses can't be
  committed again.
- Note: the single-row toolbar + top-bar Print/Export were already live (committed `3612dc2`);
  the screenshot that prompted this showed a stale GitHub Pages cache — hard-refresh to see them.

### 2026-07-03 — Prompt 52: Usage-chart clipping fix + OPC grouped detail tabs
- **Chart clipping fixed** (user: "the whole graph is not seen even when the view is
  extended"): `usageChartSVG` guessed its height from the details-panel height minus an
  assumed header height — the guess overshot the real space, so the SVG overflowed its
  `overflow:hidden` container and the bottom axis/labels were cut off at every panel height.
  Now a **two-pass render**: the layout is inserted with an empty chart div first, then the
  SVG is drawn at the div's real measured `clientWidth/clientHeight` (`drawActUsageChart` /
  the res-chart branch of `wireResUsage`). Verified: SVG height exactly equals container
  height at both default (154px) and extended (354px) panel sizes, no V/H clipping.
- **OPC grouped detail tabs**: "Activity Details ▾" and "Project Usage ▾" are now clickable
  group headers — clicking one shows only that group's tabs and hides the other's (CSS
  `[data-group]` rules on the tab bar), matching OPC's panel-group dropdown behavior. Each
  group remembers its last-used tab (`lastGroupTab`); the active group header is highlighted
  brand-red.

### 2026-07-03 — Prompt 51: Project Usage tabs copied from OPC (Activity + Resource Usage)
- Studied the live Avesta OPC Project Usage panel (Activity Usage settings dialog, Resource
  Usage roster + histogram/spreadsheet views, Role Usage) and replicated it in the details
  panel. **Usage tabs are now project-level** (render without an activity selected, like OPC);
  the per-activity detail tabs (General/Status/Relationships/Trace) still require a selection.
- **Activity Usage** — time-phased monthly **cost chart** (SVG, no libs): 8 OPC series
  (Planned, Period Actual, Remaining Early/Late, Budget At Completion, Period Planned Value,
  Period Earned Value, Estimate To Complete), each toggleable as period **bars** and/or
  cumulative **curves** via a Settings ▾ menu that mirrors OPC's Histogram settings dialog
  (incl. graph options: legend, data-date line, sight lines, values on curves; persisted in
  `localStorage['ps_usage_cfg']`). Defaults match OPC's: curves for Planned/Actual/BAC/ETC.
  Costs spread **linearly (day-weighted)** across each activity's dates — OPC's default spread.
  Remaining uses planned × (1 − %complete) from the data date; Remaining Late shifts by total
  float (late dates); ETC = EAC − Actual (CPI-adjusted). Scope select: All activities /
  Selected activity (OPC's "Show all activities above").
- **Resource Usage** — OPC's roster-left/chart-right layout: roster = distinct **Responsible
  Party** values (name, activity count, Planned/Actual/Remaining labor-unit totals); checkbox
  multi-select aggregates; right pane = **units histogram** (Planned/Actual/Remaining
  Early/Late person-days per month) or the OPC-style **Spreadsheet** (per-resource
  Planned/Actual/Remaining Units rows × Total + monthly columns). Unselected state shows OPC's
  "Select a resource…" prompt. No Max-Availability line or FTE toggle — we have no
  calendar/availability model yet (noted in-panel; full rosters arrive with resource-loading).
- **Role Usage** stays an honest placeholder (no role data model — owned by resource-loading).
- Charts redraw on details-panel resize (grip release). Verified in the harness against a
  3-activity fixture: all four default curve endpoints hand-checked (Planned ₱600k, Actual
  ₱200k, BAC ₱590k incl. bl_cost fallback, ETC ₱390k incl. CPI-adjusted EAC and
  done-activity exclusion); roster totals exact; settings toggles live-update; spreadsheet
  totals match roster.

### 2026-07-02 — Prompt 50: POC/IBB columns into the Activities grid itself
- User asked why the OPC columns (Planned/Earned Value POC, Planned/Actual/EV/At Completion/BL
  IBB, Percent Complete Type) weren't visible in the **activities view** — Prompt 49 had put
  them in the Cost Loading *tab*, but in OPC they're columns of the main Activities grid. Moved
  them into the Schedule grid with **OPC's exact names and order**: ID, Name, Status, BL
  Start/Finish, Start, Finish, Dur, Planned Value POC, Earned Value POC, Planned IBB, Actual
  IBB to date, Earned Value IBB, At Completion IBB, BL Planned IBB, Percent Complete Type,
  Float, Var (BL). The old "%" column became "Earned Value POC" (same field). Grid h-scrolls
  (as OPC's does); all columns resizable/persisted.
- **WBS summary rows roll up like OPC's**: new `_costMap` precomputed in `rebuild()` (one pass,
  same pattern as `_spanMap`) — IBB costs sum up the tree; POC %s are duration-weighted
  (planned POC weighted only over rows that have a baseline — separate denominator). EAC sums
  per-activity estimates. Roll-ups shown in WBS grouping mode; blank on Status/Responsible/Type
  group headers (their members span multiple WBS branches, so per-code roll-ups don't apply).
- **Cost cells are inline-editable** (dblclick, like dates/%): new `'money'` edit type in
  `beginEdit` — the existing `'number'` type clamps to 0–100 (built for %) and would have
  silently corrupted any cost > 100. Money edits go through `persist()` so they're undoable and
  the roll-ups recompute live.
- Excel export renamed/extended to the same OPC vocabulary (Planned/Actual/EV/At Completion/BL
  IBB, Planned Value POC, Percent Complete Type).
- Verified in the harness: 18 headers, all three row branches emit exactly 18 cells (group/WBS/
  task), roll-up math hand-checked (79% weighted POC, ₱159,090.91 EAC sum incl. the
  no-actuals fallback), money edit of ₱75,000 not clamped + roll-up updated live + undo
  reverted both.

### 2026-07-02 — Prompt 49: Match Avesta's live OPC columns
- Pulled the exact column list off Avesta's live "OPS. Edit Cost Load…" view (Primavera Cloud)
  and compared to ours. Gaps closed:
  - **Status** — new column in the Schedule grid (ID, Name, **Status**, BL Start/Finish, Start,
    Finish, matching OPC's order), rendered as a colored pill (muted/amber/green for Not
    Started/In Progress/Completed). Field already existed (used for filtering); just wasn't
    shown as a grid column before.
  - **% Complete Type** — new column in the Cost Loading table (field already existed from the
    2026-07-01 OPC fields migration, wasn't displayed anywhere but the modal).
  - **Planned % (POC)** — new computed column: the schedule-*expected* % complete by today,
    linearly interpolated between baseline start/finish (`plannedPOC()`). We had no per-activity
    "where should this be by now" metric before — only the actual/earned %.
  - **At Completion (EAC)** — new computed column: standard `AC + (BAC-EV)/CPI` estimate-at-
    completion cost, falling back to the plan itself when there's no actual cost/CPI yet
    (`eac()`). No new column needed.
  - **Baseline Cost** (OPC's "BL Planned IBB") — the one true schema gap; we stored baseline
    *dates* (`bl_start`/`bl_finish`) but never a baseline *cost* snapshot. Added `bl_cost`
    (migration `2026-07-02-baseline-cost-column.sql`, seeded from current Planned Cost — same
    pattern as the original bl_start/bl_finish seeding). New field in the Add/Edit modal, new
    column in Cost Loading + the Activity Usage detail tab + Excel export. **User must run this
    migration.**
- Verified against a synthetic fixture with real baseline dates/costs: hand-checked Planned%
  (79% for a Jun 1–Jul 10 baseline as of Jul 2), CPI (0.92), and EAC (₱109,090.91) all computed
  correctly, and confirmed the Baseline Cost field round-trips through the Add/Edit modal into
  the Cost Loading table.

### 2026-07-02 — Prompt 48: Fix FS/SS/FF/SF still reading as "just a label"
- User reported the relationship arrows still weren't "working" after the earlier routing fix.
  Root cause found by testing interactively (drag-to-link, manual predecessor entry, both
  verified end-to-end against a clean fixture — the earlier routing math was correct): the
  arrowhead alone doesn't distinguish types at a glance. FS and SS both end with an arrow
  pointing into the successor's **start**; FF and SF both end pointing into its **finish**. The
  only visual difference between, say, FS and SS is which edge the line *leaves the
  predecessor* from — easy to miss without deliberately tracing the line back to the source bar.
  So in practice it read as "same-looking line + a small FS/SS/FF/SF text tag," exactly what the
  user described not wanting.
- **Fix:** added a filled dot (`.ps-depdot` — the CSS already existed from an earlier prompt but
  was never actually emitted) at the line's origin point on the predecessor bar. Now both ends
  are explicitly marked: a dot at the predecessor's start-or-finish edge, an arrowhead at the
  successor's start-or-finish edge — the relationship type is visible from the shape alone, the
  text label is now reinforcement rather than the only signal.
- Verified against a synthetic 5-activity fixture (one source, one FS/SS/FF/SF descendant each):
  confirmed via computed pixel coordinates that FS/FF dots land exactly on the source's finish
  edge and SS/SF dots land exactly on its start edge, then visually confirmed the rendered SVG
  shapes read correctly at 4x scale. Also re-confirmed the live GitHub Pages deploy matches
  `main` byte-for-byte, ruling out a stale-cache explanation for "not working."

### 2026-07-02 — Prompt 47: Schedule Health Score + Undo/Redo (OPC top-bar icon parity)
- User shared a screenshot of OPC's top-right icon strip (save-status, undo, redo, Schedule
  Health Score, Run Report, Share). Checked each against this module: **Undo/Redo** and
  **Schedule Health Score** were genuine gaps; save-status doesn't apply (we persist per-field
  immediately, no staged commit), Run Report/Share are different-shaped features already loosely
  covered by Export/Views. Built the two real gaps:
- **Schedule Health Score** (`ps-health` toolbar button, `#ps-health-panel` slide-over): a
  DCMA-14-inspired quality checklist computed from data already on hand (no new columns) —
  Open Ends, Dangling Start/Finish, Predecessor Lag/Negative Lag, Out of Sequence, Hard/Soft
  Constraint, Invalid Progress Date, Late Activity, Negative/Large Float (>44d), Large Duration
  (>44d). Each metric shows "count of its own eligible denominator" (e.g. Late Activity is
  scored against activities that HAVE a baseline, not the whole schedule) rather than a bare %,
  and expands to list the affected activities — clicking one selects it in the grid/Gantt and
  opens its Activity Details. Overall score = 100 − average(metric %). Skipped OPC's "No
  Roles/Resources" metric — no resource/role assignment model yet (owned by the future
  `resource-loading` module).
- **Undo/Redo** (`ps-undo`/`ps-redo` toolbar buttons + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, disabled
  when the stack is empty): hooked into `persist()` — the single function already used by inline
  cell edits, Gantt drag/resize, **and** link creation — so all three get undo for free from one
  change. The Add/Edit modal's `save()` now routes edits through `persist()` too (diffs old vs
  new field values) and records its own `insert` entry for new activities (added `.select()` to
  the insert so we get the new row's id back; redo re-inserts with that same id). Bulk ops
  (Import replace/append, Clear schedule) reset the stack instead of being undoable — they
  already have their own confirm/type-to-confirm gates. 50-action cap; stack also resets on
  project switch.
- Verified both features against actual rendered behavior (not just code review) with a
  throwaway local test harness (stubbed `AppAuth`/`PDb`/Supabase with a small **mutable**
  in-memory row store this time, so insert/update/delete round-trip realistically) — confirmed
  Health's math by hand against a synthetic fixture, and the full add → undo (deletes) →
  redo (re-inserts, same id) and edit → undo → redo cycles. Deleted after use.

### 2026-07-02 — Prompt 46: Flatten the toolbar to match OPC's clean look
- User compared a screenshot of live OPC against ours and asked to match its "cleanly executed"
  feel. Root cause: our shared `.pd-btn`/`.pd-select` (used site-wide) always render a visible
  border + card background, so the Project Schedule toolbar read as a row of ~14 separate boxed
  buttons, whereas OPC's toolbar controls are flat/borderless at rest and only pick up a
  background on hover — the row reads as one continuous strip.
- Added toolbar-scoped overrides (`.ps-toolbar .pd-btn:not(.pd-btn-primary)`,
  `.ps-toolbar .pd-select`) that go transparent/borderless at rest, with a light `--pd-bg`
  background on hover/focus. Deliberately scoped to `.ps-toolbar` only — the shared `.pd-btn`/
  `.pd-select` keep their normal bordered look everywhere else (modals, forms, other modules).
  Kept exactly one color-blocked control (**+ Add activity**, red primary) plus existing active-
  state red fills (Quarter/Year zoom, Critical path, Link) — same "one accent CTA, flat
  everything else" pattern OPC uses.
- Verified visually (not just by reading code) via the same throwaway local test harness as
  Prompt 45 (stubbed auth/DB, synthetic rows, deleted after use) — screenshotted both light and
  dark mode before/after.

### 2026-07-02 — Prompt 45: Toolbar consolidation + OPC-style layout + dependency-line fix
- **Removed the bottom "Tip: click any activity cell…" hint line** in Project Schedule —
  it was `flex:none` (fixed height) inside the viewport-height flex column, so removing it
  (plus its now-dead `#ps-view-schedule > p` CSS rule) hands that space straight back to the
  `.ps-split` (grid+Gantt) panel, which is `flex:1 1 auto`.
- **Toolbar rebuilt as a single OPC-style row** (was two rows): compared live against Oracle
  Primavera Cloud (`primavera.oraclecloud.com`) — Actions/Add first, context selectors next,
  layout/view controls grouped with dividers, toggle icons, search docked far right. Rare
  data-ops (**Import Excel, Export, Clear**) consolidated into a new **Actions ▾** menu
  (mirrors OPC's Actions▾), matching the existing `.ps-menu-wrap` pattern; `ps-clear`'s
  admin-only visibility logic unchanged (still keyed off the same element id). Filter and
  Refresh are now icon-only (title tooltip), matching OPC's icon-button density.
- **Fixed FS/SS/FF/SF dependency-line rendering** (Gantt, Critical Path mode): the connector
  always stepped 8px *right* before turning, which is correct for FS/FF (anchored at a bar's
  finish/right edge — stepping right moves away from the bar) but for SS/SF (anchored at a
  bar's *start*/left edge) it stepped straight through the bar's own body, and FF/SF's arrival
  at a target's finish edge cut through the target bar the same way. Now each end steps
  *outward* based on which edge it's anchored to (start-anchors step left, finish-anchors step
  right) before the elbow turn, so the line always approaches/leaves a bar from outside it.
  Verified against actual rendered bar coordinates (synthetic FS/SS/FF/SF fixture) that none
  of the four relationship types' connector paths cross their own source/target bar anymore.
- Verification note: this environment's Preview tool had a stalled compositor (`requestAnimationFrame`
  never fired, screenshots timed out) — worked around for this session only with a throwaway,
  git-ignored test harness (stubbed `AppAuth`/`PDb`/Supabase with synthetic rows, no real
  credentials or backend touched) to confirm the render tree and connector math; deleted after use.

### 2026-07-03 — Prompt 50 (Desktop): Resource assignments phase (real Resource/Role Usage)
- **Resource Assignments tab** added to the details panel (OPC order: General ·
  Status · Resource Assignments · Relationships · Trace Logic). For the selected
  activity: list/add/edit/delete assignments (pick a resource from the master →
  prefills role/UoM; budgeted/actual/remaining units). Writes `resource_assignments`.
- **Resource Usage now aggregates real assignments** when they exist — roster
  grouped by resource (Name/ID/Type/UoM from the master), units **time-phased**
  from each assignment across its activity's dates (histogram/spreadsheet/download
  reused). Falls back to the Responsible-Party + Labor-Units derivation when there
  are no assignments (no regression).
- **Role Usage enabled** — same engine grouped by assigned role (`usageKind`
  switch; `buildRoster(keyFn,nameFn)`).
- Loads `resources` + `resource_assignments` per project on schedule load.
  **Requires migration `2026-07-03-resource-assignments.sql`** (from Prompt 48).
- Remaining: FTE / Max-Availability reference line (needs working-calendar math).

### 2026-07-03 — Prompt 49 (Desktop): Resizable detail sub-panels + Activity ID indent
- **Detail sub-panels are now resizable** with a draggable gutter + **double-click
  to reset**: Relationships (Predecessors ⇄ Successors) and Resource Usage
  (roster ⇄ chart). Reusable `.ps-gutter`/`.ps-vsplit` + `wireDetailSplits()`;
  widths persisted in localStorage (`ps_split_<key>`).
- **Activity ID indented by WBS level** in the grid (`idPad = 4 + min(depth,6)*8`)
  so the hierarchy reads clearly, matching the indented Activity Name.

### 2026-07-03 — Prompt 48 (Desktop): UI density pass, dropdown clip fix, dbl-click auto-size, assignments DB
- **Dropdown clipping fixed:** the single-row toolbar's `overflow-x:auto` was
  clipping the icon-menu popovers (Collapse/Views/Layout/Columns/Colors). Set the
  row `overflow:visible` so menus show fully (like the native WBS Group select).
- **Denser / squarer (OPC-like):** global `--pd-radius` 10px→4px; trimmed the
  schedule module's `.pd-main`/toolbar/legend margins; square split/network edges.
- **Double-click auto-size** on the grid⇄Gantt divider (fits grid to column
  content) and the details-panel grip (fits panel to content).
- **Assignments DB foundation:** `resource_assignments` table (activity↔resource/
  role, budgeted/actual/remaining units) — migration
  `2026-07-03-resource-assignments.sql` + folded into `supabase-setup.sql`.
  **NEXT (in progress):** assignment UI + wire real Resource/Role Usage + FTE.
- **Still to do (this thread's asks):** full assignments UI/usage wiring; make the
  detail sub-panels (Relationships, Resource Usage) resizable + dbl-click auto-size.

### 2026-07-01 — Prompt 47 (Desktop): Title switcher, colors icon, Resource/Role master
- **Project Schedule:** replaced the Schedule/Cost tab strip with a **clickable
  title switcher** (title shows the active view; dropdown switches Project
  Schedule ↔ Cost Loading) to free a row. Moved the **Gantt bar-colors** gear
  out of the Gantt (was overlapping the timescale) into the toolbar with a
  distinct **palette** icon; column chooser got a **columns** icon (both were
  "settings"). Added `columns`/`palette` to icons.js.
- **Resource & Role master built** (`resource-loading` module, enabled): OPC-
  faithful two-tab roster — Resources (ID, Name, Type, Primary Role, Default &
  Max Units/Time %, UoM, Calendar) + Roles (Name, Discipline, UoM). Tables
  `resources` + `resource_roles`; migration `2026-07-01-resource-role-master.sql`
  (folded into `supabase-setup.sql`). **User must run this migration.**
  Next phase: `resource_assignments` → wire Project Schedule Resource/Role Usage
  tabs + FTE/availability line.

### 2026-07-01 — Prompt 46 (Desktop): Activity Network view + toolbar single-row + Print moved
- **Activity Network View** (PERT) added as a Layout option: activities as nodes
  ranked by predecessor depth (columns), relationship arrows between them,
  critical chain in amber, completed nodes tinted. Guarded to ≤300 activities
  (asks to filter beyond that). `renderNetwork()` + `.ps-net-*` styles; toggled
  via Layout ▾ → "Activity Network" (adds `.ps-net-mode` to the schedule view).
- **Print** button moved to the top-bar cluster **beside the Export/download icon**
  (removed from the lower toolbar).
- **Toolbar single row:** the Actions→Link action row is now `nowrap` with
  horizontal scroll on overflow, compact buttons — no more wrapping to two rows.

### 2026-07-01 — Prompt 45 (Desktop): Project Schedule top-bar polish (OPC parity)
- **Workspace subline** under the project name in the top-bar selector (OPC-style
  "project / workspace"), via `PDb.getWorkspaces()` + `projects.workspace_id`
  (falls back to `group_head`).
- **Export to Excel** icon added to the top-bar tool cluster (beside Refresh) —
  convenient placement in addition to the Actions menu.
- **Print / PDF** button beside Schedule (window.print() + a print stylesheet
  that shows only the schedule/Gantt).
- **Layout ▾** menu (next to Schedule): switch **Split / Grid only / Gantt only**
  and toggle the details panel; persisted in localStorage (`ps_layout`,
  `ps_details_hidden`).
- Note: undo/redo/Health/Filter/Refresh/project-selector were already in the top
  bar (Teams line); this pass added the missing OPC-parity items. Added `printer`
  + `layout` icons to `icons.js`.

### 2026-07-01 — Prompt 44 (Desktop): S-Curve forecast line + transposed data table
- Added a **red dashed forecast-to-finish line** from the actual point at the
  data date up to 100% at a **manual Forecast finish date** (date input in the
  controls; per-project, saved in `localStorage['sc_fc_<pid>']`; defaults to the
  planned finish). Timeline extends to cover a slipped forecast. `.sc-forecast`.
- **Data table transposed** to OPC-style: months across the top (scrolls left↔
  right), two rows (Planned % / Actual POC); first column (POC labels) is sticky.

### 2026-07-01 — Prompt 43 (Desktop): S-Curve fix, table toggle, toolbar, critical-path focus
- **S-Curve actual-line bug fixed:** the current (data-date) month failed the
  `mEnd <= tnow` guard so `actualC[ti]` was 0 → the red actual line dropped to
  zero at the data date (and "Actual to date" read 0%). Now the actual curve is
  anchored at the data date to true overall % complete; nothing is drawn past it.
- **S-Curve data table** is now toggleable (Show/Hide data table button; hidden
  by default) — Period / Planned % / Actual %.
- **Data date** clarified: it's the as-of/status date (= today); planned is the
  full baseline, actual is only plotted up to it. (Legitimate; label kept.)
- **Project Schedule toolbar** reorganized into two tidy grouped rows with
  separators + consistent 36px control height (was a scattered single wrap).
- **Critical Path button** made clearly effective: P6-style focus — non-critical
  bars/rows dim, critical bars get an amber outline; toast reports the count (or
  says none found). Previously the red outline blended into the red % bars.

### 2026-07-01 — Prompt 42 (Desktop): Full OPC Activity Details fields
- Added all previously-omitted OPC Activity Details fields to Project Schedule
  (General + Status), matching Oracle Primavera Cloud:
  - **General:** Owner, Work Package, Calendar, Duration Type, % Complete Type,
    Program Milestone.
  - **Status:** Actual Start/Finish (now editable), Expected Finish, Actual &
    Remaining Duration (+ computed At Completion), Free Float, Labor Units
    (Planned/Actual/Remaining + computed At Completion), Primary/Secondary
    Constraints (+dates).
- DB: migration `migrations/2026-07-01-project-schedule-opc-fields.sql` (17 new
  columns); folded into `supabase-schema.sql` + `supabase-setup.sql` (also
  back-filled the earlier evolved columns activity_type/status/responsible_party/
  actual_start/finish/bl_start/finish that were only in migrations before).
  **User must run the migration.**
- Modal grouped into OPC sections (Classification / Status-Dates & Duration /
  Labor Units / Constraints); General & Status detail tabs render the new fields
  in grouped multi-column sections. `.ps-form-sec` header style added.

### 2026-07-01 — Prompt 41 (Desktop): Dock details panel + Resource/Role Usage decision
- **Fixed the "empty / non-resizable" details panel:** its body was rendering
  below the fold (the schedule split was a fixed `62vh`). Made this module's
  `.pd-main` a viewport-height flex column so the schedule split flexes and the
  **Activity Details / Project Usage panel docks at the bottom, always visible**;
  the grip now visibly trades height between schedule and panel.
- Verified against **live OPC** (desktop access): Activity Details (General /
  Status / Relationships / Trace Logic) and Activity Usage already match; OPC's
  **Resource Usage / Role Usage** are a role/resource roster + time-phased usage.
- **Decision:** Resource/Role Usage is **deferred to the dedicated `resource-loading`
  module** (owns the resource/role master + assignments + usage views); Project
  Schedule's usage tabs stay placeholders and will later read from it. Noted in
  `modules/resource-loading/CLAUDE.md`.

### 2026-07-01 — Prompt 40 (Desktop): Details-panel resize + click/dbl-click editing
Project Schedule (`modules/project-schedule/index.html`), continuing here after
Teams usage ran out — this session is now the single line for this module.
- **Removed leftover KPI-card CSS** (`.ps-kpi*`). The KPI cards themselves were
  already gone (no container/render); confirmed the OPC-style **Activity Details
  / Project Usage** panel already exists (General/Status/Relationships/Trace
  Logic + Activity/Resource/Role Usage, driven by selected activity `selId`).
- **Resizable bottom details panel:** added a drag grip (`#ps-details-grip`)
  above the tabs; drag to set `#ps-details-body` height, persisted in
  `localStorage['ps_details_h']` (min 90 / max 700 px).
- **Selection vs editing:** single click on an activity now **selects** it and
  shows its details (row click → `selId`/`renderDetails`); inline cell editing
  now requires **double-click** (`.ps-editable` → `ondblclick` = `beginEdit`).
- Still placeholder: **Resource Usage / Role Usage** tabs (need a resource/role
  assignment model). Possible next: Project Usage S-curve (Planned/Actual/BAC/ETC).

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

### 2026-07-22 — Merge module/project-schedule PR into main

Merged branch `module/project-schedule` (chart builder in Activity Progress) into
`main` (merge commit 7b9fc4e; clean auto-merge, no conflicts despite the branch being
74 commits behind). Verified locally: module loads and runs with no console errors,
inline JS passes `node --check`, no conflict markers. See
`modules/project-schedule/CLAUDE.md` for detail.

### 2026-07-22 — Project Schedule: arrow-key row selection + Excel-like autoscroll

Added keyboard row navigation to the Schedule grid: ↑/↓ move the row selection, PageUp/PageDown
jump a screen, Home/End go to first/last, Shift extends the multi-row selection. The grid
autoscrolls minimally to keep the active row visible (pins to the top/bottom edge, Excel-style),
working with the virtualized renderer. New `moveRowSel`/`scrollRowVisible`/`_gridPageRows` helpers
wired into the existing grid keydown handler; documented in the shortcuts modal. Verified: inline JS
passes `node --check`, module loads with no console errors. Module-only, no `?v=` bump. See
`modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: horizontal active-cell navigation (arrows / Tab / Enter)

Extended the arrow-key row selection into a full Excel-style active-cell cursor: ←/→ move the active
cell across columns, Tab/Shift+Tab move next/previous cell wrapping across rows, Shift+←/→ extend the
cell range, and Enter/F2 edit the active cell. ↑/↓ now preserve the active-cell column so vertical +
horizontal navigation share one cursor. New `moveCell`/`scrollCellVisible`/`_nextRowIdx`/`editActiveCell`
helpers; horizontal autoscroll reveals the target column. Verified: inline JS passes `node --check`,
no console errors on load. Module-only, no `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: Enter/Tab commit-and-advance in the cell editor

While editing a cell inline, Enter now commits and moves the active cell down a row (Shift+Enter up),
and Tab commits and moves to the next cell (Shift+Tab previous, wrapping rows) — Excel-style, keeping
the column and landing in ready mode. Escape still cancels. Wired in `beginEdit` via the existing
`moveRowSel`/`moveCell` cursor. Verified: inline JS passes `node --check`, no console errors on load.
Module-only, no `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: Excel type-down-a-column entry anchor + type-to-edit

Added the classic Excel data-entry flow to the Schedule grid: an entry-column anchor (`_entryCol`) so
Tab walks across columns and Enter drops a row and returns to the column the entry began in; plus
type-to-edit (typing on a selected cell begins editing seeded with the character). Ready-mode Enter now
moves down at the entry column; F2/double-click/typing edit. The anchor resets on plain navigation
(arrows/click/Escape) and persists across Tab/Enter. Verified: inline JS passes `node --check`, no
console errors on load. Module-only, no `?v=` bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: render guard fixes the type-to-edit keystroke race

Fixed the documented race where an in-flight async save re-render could wipe a just-opened inline
editor during fast type-down entry. New `_editing` flag (set in `beginEdit`, cleared at the top of
`commit`) makes `doRender`/`renderWindow` defer repaints while an editor is open and flush the
deferred paint when it closes. The edited value is read synchronously before any repaint, so no data
is lost. Verified: inline JS passes `node --check`, no console errors on load. Module-only, no `?v=`
bump. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: live keyboard verification + hidden-column navigation fix

First signed-in verification of the new grid keyboard navigation, on the real 17,122-activity project.
Confirmed working live: click-to-set active cell, ↓×3 (rows advance, column persists), →×3, Tab×6.
**Found and fixed a real bug** — navigation stepped the active cell into hidden (`display:none`,
zero-width) columns, so the cursor appeared to vanish; `moveCell`/`moveRowSel` now skip hidden columns
via `_colShown`/`_nextVisCol` using the same `colHidden` source of truth as the Columns chooser.
Remaining edit-path checks are blocked by Chrome being backgrounded (rAF suspended, renderer throttled)
and need a scratch project rather than real data. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-22 — Project Schedule: signed-in verification on XERTEST (3 bugs found + fixed)

Ran the full keyboard/data-entry verification signed in, on the XERTEST sandbox. Found and fixed three
real bugs: (1) navigation stepped into hidden columns, (2) in-edit Enter/Tab moved twice because
`blur()` let the keystroke bubble to the document handler past its INPUT guard, (3) a closing editor
could leave an orphaned `<input>` when the commits conditional render was skipped. After fixes,
confirmed live: hidden-column skip, horizontal autoscroll, render guard (input survived forced
repaints), entry-column anchor, single-step Enter/Tab, type-to-edit, and Escape-cancels-without-write.
Data integrity confirmed by direct Supabase query — no test data written, edited row unchanged, and
nothing touched in the real project. See `modules/project-schedule/CLAUDE.md`.

### 2026-07-23 — Merge module/project-schedule (per-chart activity label) into main

Merged `origin/module/project-schedule` into `main` (merge commit `c6bf04c`). **Divergence was much
smaller than the branch age suggested:** the merge base `a1292e1` is itself on the branch (it was
merged into main on 2026-07-22 as `7b9fc4e`), so main already contained everything except **one new
branch commit** — `0683da1` "per-chart activity label field (ID / Name / both)" by ethanrobles10
(2 files, +17/−2). Main meanwhile had 100 commits, 39 of them touching
`modules/project-schedule/index.html`.
- **One conflict, docs only** — `modules/project-schedule/CLAUDE.md`: both sides appended a new
  section at EOF. Resolved by **keeping both**, with the branch's "Chart cards — activity label
  field" note placed next to the surrounding chart docs and main's "Merge to main + verification
  (2026-07-22)" section after it.
- **`index.html` auto-merged clean, and the auto-merge is safe on inspection, not just textually:**
  the branch change is confined to the chart builder (`_chartBuckets` label fn, chart config
  normalization, the `.ps-cset` settings panel), while every main-side change this window was in the
  grid/keyboard/loading paths (cell navigation, cache-first load, `schedule_rows` RPC, Gantt range,
  WBS virtualization, Cost/EVM) — no overlapping regions, no shared state.
- **Verified:** no conflict markers anywhere in the repo, `catField` present in all 3 expected places
  in `index.html`, and the module's 690KB inline script parses clean (`new Function`). **Not**
  browser-verified — no signed-in click-through of the chart settings panel this pass. Module-local
  files only → **no `?v=` bump**.

### 2026-07-23 — Mobile & tablet, part 1: the shared responsive layer

Start of making the dashboard usable on phones and tablets. This pass does the **shared layer only**
(`assets/css/dashboard.css` + `assets/js/ui.js`), which every one of the 21 pages inherits — so all
shell pages and all 13 modules get the baseline without touching module code.
- **New "MOBILE & TABLET" section in `dashboard.css`** with four breakpoints — 1024 tablet · 820
  drawer · 700 phone · 420 small. Covers: off-canvas sidebar drawer + scrim, scrolling tab strips,
  stacked toolbars, tables that scroll inside their card instead of widening the page, sheet-style
  modals, viewport-anchored dropdowns, 44px touch targets, and safe-area insets for notched phones.
  New `.pd-tablewrap` utility for wide tables.
- **Two traps documented in the CSS itself** because both are easy to "fix" back into bugs:
  1. **iOS Safari zooms the page when a focused input is under 16px** — all form controls go to 16px
     at phone width. Do not restore 13/14px to match the desktop look.
  2. **`initShell` adds `.pd-collapsed` by DEFAULT.** Left alone that made the mobile drawer open as
     a **useless 64px icon rail with no labels** — the drawer width/labels are re-asserted at ≤820px.
- **`ui.js` drawer behaviour.** The hamburger previously just toggled a class: no scrim, no dismiss,
  no scroll lock. Now it injects a scrim, locks background scroll, sets `aria-expanded`/`aria-controls`,
  and dismisses on scrim tap / nav tap / Escape. A `resize` past 820px closes the drawer so a tablet
  rotation can't leave a scrim + scroll lock stranded. Mobile open/closed state is deliberately **not**
  persisted (a drawer that reopens itself each page load would cover the content every time).
- **`body { overflow-x: clip }`, not `hidden`** — `hidden` on body breaks `position:sticky`
  descendants, and the topbar plus every sticky table header depends on sticky working.
- **Verified in-browser** (real CSS + real `ui.js`, gitignored `_ui_test.html` harness with stubbed
  auth/DB) at 375 / 768 / 1200: no page-level horizontal scroll at any width; drawer opens to the
  full 290px with labels (not the 64px rail) and sits above the scrim; 44px nav rows; scrim/Escape/
  nav-tap all dismiss; modal is a true bottom sheet (full width, flush to viewport bottom, top-only
  radius); inputs 16px. Also verified on the **real login page**: card fits 375px, 44px targets, no
  errors. ⚠️ Two **measurement artifacts, not defects**, cost time — worth knowing: CSS transitions
  never advance in this environment (backgrounded tab → stalled compositor), so a settled drawer reads
  as still-closed until you inject `transition:none`; and `resize_window` doesn't dispatch a `resize`
  event, so the breakpoint-crossing handler looks dead until you dispatch one manually. Screenshots
  remain impossible here.
- Shared assets changed → **`?v=` bumped `20260720b` → `20260723a` across all 21 HTML files** (154 refs).
- **NOT done — module interiors.** The shared layer fixes chrome, tables, modals and dropdowns
  everywhere, but each module's own dense UI still needs a pass. Hazard scan (fixed min-widths /
  nowrap / fixed grids): `project-schedule` is by far the heaviest (27 min-widths, 39 nowraps — Gantt
  + virtualized 18-column grid + keyboard nav, genuinely a desktop tool); `drawing-register`,
  `material-submittal`, `cash-flow`, `contracts-claims`, `stakeholder-map` are moderate; `s-curve`,
  `resource-loading`, `portfolio-overview` are light.

### 2026-07-23 — Mobile & tablet, part 2: the four field-use modules

Owner chose to prioritise **what people actually open on-site**. Each module got the treatment its
interaction model allows — the deciding question was *"can this be card-stacked without breaking how
it's used?"*, and the answer differed:
- **Progress Photos — restacked (list view).** The list was a 7-column grid at `min-width:980px`.
  Below 700px the header row is dropped and each row becomes a card: thumbnail pinned in a 104px left
  column spanning the stack, every other cell forced into column 2 so they stack and wrap. Cells are
  labelled from a new `data-l` attribute (added in `module.js`) via `::before`. ⚠️ The stacked cells
  must also drop `white-space:nowrap` — inherited from the desktop grid, it ellipsizes them to nothing.
  Lightbox photo gets the screen (96vw) with 44px controls.
- **Issues & Lessons — card-stacked (real `<table>`).** 11 columns at `min-width:980px`. Below 700px
  `thead` is hidden and each `<tr>` becomes a bordered card with labelled cells; the issue text is the
  unlabelled headline. ⚠️ **Selector trap:** the element is `class="pd-table il-table"`, and the shared
  phone rule turns `.pd-table` into a nowrap horizontal scroller — the overrides are deliberately
  written `.pd-table.il-table` / `.il-table td` to outrank it. Dropping the `.pd-table` qualifier
  silently restores side-scrolling.
- **Drawing Register + Material Submittal — kept as scrollers, fixed the FREEZE.** Both are *editable*
  registers (inline cell editing, drag-reorder, range selection, bulk actions), so card-stacking would
  break the interaction model — they stay horizontal scrollers. The actual phone bug was the sticky
  columns: Drawing Register froze checkbox + Code (130px) + Title (300px), and Material Submittal froze
  190px + 230px — **420–430px of frozen columns on a 375px viewport**, so whatever you scrolled to had
  nowhere to land. Below 700px only the identity column (Code) stays frozen; Title / `ms-fz2` release.
- **Verified in-browser** at 375 and 1280 with gitignored harnesses carrying the **row markup copied
  verbatim from each module.js**: at 375 no page- or table-level horizontal scroll, header hidden,
  cells stacked at a single x with labels rendering, 40–42px row buttons, KPIs at 2 columns; at 1280
  **desktop is byte-for-byte unchanged** — 7/11 distinct column x-positions, header visible, `::before`
  labels resolve to `none`, `min-width:980px` intact. For the two scroller modules (whose editable
  grids are impractical to harness faithfully) the change was confirmed by verifying the targeted
  classes are actually emitted by `module.js`, so no rule is a silent no-op.
- Module-local files only; the `?v=20260723a` bump from part 1 already covers their `module.css`/
  `module.js` links, so **no further bump**.
- **Still to do:** Project Schedule's read-only phone view (owner's choice), then the analysis modules
  (S-Curve, Cash Flow, Portfolio Overview) and the remaining registers.

### 2026-07-23 — Mobile & tablet, part 3: Project Schedule read-only phone view

Owner's choice for the heaviest module: **a read-only mobile view**, not pan-and-zoom and not a
"use a bigger screen" notice. Below **700px** the grid+Gantt split is hidden and replaced by a
condensed read-only activity list (`#ps-mobile` / `renderMobile()`); above 700px nothing changes.
- **Same data path, different presentation** — `renderMobile()` reads `displayList()`, so search,
  filters, grouping and collapse state all carry over. Cards show Activity ID, a status pill derived
  exactly as the grid derives it, name, Start/Finish/%/Float and a progress bar; critical-path
  activities get a red left rail. WBS summary rows are skipped. No edit/drag/link/keyboard handlers
  are wired — editing stays desktop/tablet only.
- ⚠️ **`PS_M_CAP = 300` is load-bearing.** The phone list is **not** virtualized (the desktop grid is)
  and real projects here hit 17k+ activities, so painting every card would lock up a phone. Over the
  cap it shows the first 300 and says to narrow with search/filters. Raise it only with virtualization.
- **Verified** at 375px against the module's real stylesheet (cards 351px, no page h-scroll, 4-column
  meta with no overflow, correct status colours, red rail on critical only, 45% fill exact) and at
  1280px **desktop unchanged** (split `flex`, grid 660 + Gantt 588, toolbar/divider visible).
- ⚠️ **Verification gap:** `renderMobile()` was not exercised end-to-end against loaded rows — the
  harness stubs couldn't satisfy this module's `load()` (RPC → keyset fallback), so it rendered its
  real empty state and the card branch was verified by injecting the function's exact template against
  the real CSS. Data binding rests on `node --check` + confirming every helper it calls exists.
  **Worth a signed-in pass on a real project.** See `modules/project-schedule/CLAUDE.md`.
- Module-local only; `?v=20260723a` from part 1 already covers it.

### 2026-07-23 — Mobile & tablet, part 4: the remaining eight modules (suite complete)

Finished the sweep — all 13 modules now have a phone/tablet pass. Same deciding question as part 2
(*can this be card-stacked without breaking how it's used?*), which sorted them into three treatments:
- **Card-stacked (read-mostly registers):** **Risk Register** (10 cols) and **Stakeholder Map**
  (14 cols, `min-width:1180px` ≈ 3 screens of side-scrolling). Both edit via a modal, so nothing is
  lost by stacking. `data-l` labels added in each `module.js`; overrides written `.pd-table.rr-table` /
  `.pd-table.sm-table` to outrank the shared `.pd-table` phone scroller. On Stakeholder Map the
  `.sm-num` right-alignment is reset to left — in a stacked card there is no column to align to, so it
  reads as a stray indent.
- **Kept as scrollers (structure would be destroyed):** **Contracts & Claims** — its columns *are* the
  pipeline stages and are built dynamically per view, it carries a **totals row** that only means
  anything column-aligned, and money is read by comparing down a column. **Resource Loading** — the
  Loading matrix compares resources *across months*. Both got chrome/filter/KPI polish only.
- **Charts (S-Curve, Cash Flow, Portfolio Overview, Productivity Rates).** ⚠️ **The charts were the
  non-obvious problem.** Every SVG already uses `viewBox` + `width:100%`, so they *scale* — which
  looks fine until you check the type: scaling a 900-unit chart into ~351px is a 0.39 factor, rendering
  its 9.5px labels at **3.7px**. Below 700px each chart now keeps a legible minimum width and its card
  scrolls instead of shrinking further — **measured 5.91px** on screen at 375px. Don't "simplify" the
  min-width away; that restores the unreadable version. Cash Flow additionally narrows its sticky
  matrix label column 200px → 118px (200px was 53% of a 375px screen, leaving the months nowhere to land).
- ⚠️ **Method note worth keeping:** every selector was checked against the module's markup *before*
  writing the rule — a first pass had invented ~10 wrapper classes (`sc-controls`, `po-tablewrap`,
  `rl-card`, …) that don't exist. Those would have been **silent no-ops**, not errors, and the modules
  would have looked "done" while nothing applied.
- **Verified in-browser** at 375 and 1280 on the two new patterns: Risk Register card-stack (no page
  or table h-scroll, thead hidden, all cells at one x, labels rendering, title unlabelled) and the
  S-Curve chart (svg pinned at 560px, card scrolls, page does not, label 5.91px). **Desktop unchanged
  at 1280** for both — table `display:table`, 10 distinct column x-positions, `::before` labels `none`,
  chart back to 1202px with all phone min-widths resolving to `0px`. The other six share these two
  verified patterns plus chrome-only changes.
- Module-local only; `?v=20260723a` from part 1 already covers every module's assets.

### 2026-07-23 — Schedule Builder folded INTO Project Schedule (not a standalone module)

Built the bottom-up / location-based **Schedule Builder** (reverse-engineered from the planning
team's whiteboard) as a **view inside the Project Schedule & Cost Loading module** — per the owner,
not a separate module. It's a fourth entry in the title-switcher ("Schedule Builder", between
Project Schedule and Cost / EVM), a 5-step wizard: Activities (class-code list + duration) → Floors
& Zones (location breakdown) → Zone sequence → Scope-per-zone matrix → **Generate** (sequential FS
chain through locations → KPIs, duration-per-zone bars, grouped preview, CSV export).
- Implemented as a self-contained `ScheduleBuilder` closure inside `modules/project-schedule/
  index.html` (own helpers, no collision with the module's `esc`/`pd`/`render`/`load`/`save`/
  `generate`); reads the module's current `pid`/`UID`; `switchTab('builder')` + `renderAll` drive it.
- Table **`schedule_builder`** (project_id PK, config jsonb) — migration
  `migrations/2026-07-23-schedule-builder.sql` (**USER MUST RUN**); project-scoped RLS.
- The earlier standalone `modules/schedule-builder/` + its `config.js` registry entry were
  **removed** (this supersedes them). Generated preview stays in the builder; pushing it into the
  live schedule is the next milestone (whiteboard steps 8–10 also deferred).
- Verified: module + config parse (`node --check`); loads on the local server with no console
  errors (auth gate blocks click-through). See `modules/project-schedule/CLAUDE.md`.
