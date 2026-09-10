# Module: portfolio-overview

## 2026-09-10 (u3) — The project filter stops clipping, and A–Z becomes a sticky rail

Owner, items 1 and 2 of six: *"The filter all projects can be combined with the other filter button
where its UI is clipping and bugging… let's just apply the existing UI from other modules so its
consistent"*, and *"when there are 1000+ stakeholders… the A-Z isn't sticky. I want to locate this at
the right side as well."*

### ⚠️⚠️ The clipping had one cause, and it was the positioning, not the width
`.po-projfilter-menu` was `position:absolute; left:0; width:260px` hanging off a **right-aligned**
button — so a 260px menu opened *rightwards* from a button already at the right edge of the page and
ran off it. Every other filter in this app expands **inline** and reflows the page
(`.pd-filtergroup`, `.po-toolbar-fields`), which cannot clip by construction. So it adopts that
idiom rather than being nudged to `right:0`, which would have fixed this one case and left the next
one to be discovered. The z-index and the drop shadow went with the absolute positioning — an inline
panel is in flow and has nothing to lift above.

⚠️ The list is now a `repeat(auto-fill, minmax(240px,1fr))` grid. A single 260px column of 40
projects was most of the reason it wanted to be a floating menu in the first place.

### ⚠️⚠️ One filter button where a view has one, and ONE NODE — never a copy
Four of the thirteen views have an expanding filter panel (Stakeholders, Risk, Issues, Equipment).
`placeScope` **moves** `#po-projfilter-wrap` into that panel, so in those views there is genuinely one
filter control, as asked. The other nine have no panel and the scope still has to be reachable from
every view, so it falls back to its own bar — which is then hidden rather than left as an empty
14px strip.

⚠️ It **moves the element**, so the wiring, the state and the selection travel with it: it is the
same DOM node, and nothing is re-bound. A copy per view is the thing that would need keeping in step.

⚠️ **The at-a-glance scope indication survives, and is the app's own convention.** `projSel` is empty
when every project is in scope, so nothing is ticked and `UI.wireFilterToggle`'s `has-active` state
is off; tick anything and the funnel goes red. **Measured both ways:** inactive with nothing checked,
active the moment one project is. The per-view scope note (*"3 of 40 projects"*) still spells it out.

### The A–Z index is a sticky vertical rail on the right
The owner's point is the one that matters at scale: with 1,000 stakeholders a strip that scrolls away
is useless exactly when you need it, because you are a long way down the list. It is now a 36px rail
beside the cards, `position:sticky`, and it is the iOS-contacts idiom rather than an invention.

- ⚠️ `align-self:flex-start` is **required** — a flex item stretches to the row height by default, and
  `position:sticky` on a full-height item has nothing to travel within. Without it the rail is
  correct in the cascade and does not stick.
- ⚠️ The per-letter **count** does not fit a 22px rail, so it moves into the `title` and each letter
  that has anyone carries a 3px dot. Dropping the count outright would have removed the one thing
  that makes a letter worth clicking.
- ⚠️ The rail is a **sibling after** the cards in source order, so the tab sequence reaches the people
  before the index — the index is navigation, not content.
- ⚠️ **On a phone it reverts to a horizontal strip**, sticky to the top. A 22px column of 27 letters is
  far under the 44px touch target and there is no side channel when the page is one column.

### Verified
Driven in a browser against the real stylesheet, with the toolbar and scope-bar markup lifted
**byte-for-byte** out of the shipped page and `placeScope` **sliced out of it**, over a 224-person
fixture: the panel computes `position:static` and spans 60→771 in a 1265px viewport with **no
overflow either side and no horizontal page scroll** (it ran off the edge before); `placeScope` puts
the node in `po-sh-fields` on Stakeholders and back in `.po-scopebar` on Overview; the rail computes
`sticky`, sits to the right of the cards, and **after scrolling 1,200px it is pinned at `top: 8px`
and still on screen**.

⚠️ A first measurement pass reported `viewportW: 0` — the hidden-tab artefact again. Forced a paint
before re-measuring; the numbers above are from the second pass.
⚠️ **Not verified signed in.**

## 2026-09-10 (u2) — Directory Health: the dashboard half of the adoption

Owner: *"And a dashboard page that can also be adopted."* Asked what it should report, the choice was
**directory health, from our own data** — so this is not a copy of the other app's dashboard, it is
the same idea pointed at the register we actually hold. A third view beside Directory and By project.

⚠️⚠️ **IT ADDS NO QUERY AND WRITES NOTHING.** Every figure is derived from the `dirRows` and `dirUse`
the Directory view has already loaded, so switching to it costs nothing and it cannot disagree with
the list beside it. A duplicate is opened through the **same person panel that already owns Merge**,
rather than this view growing a second merge path that could drift from it — confirmed in a browser:
clicking a pair opens the person with **0 writes**.

Six panels: **Possible duplicates**, **Profile completeness** (per field, least-filled first),
**By sector**, **Organisations**, **People per project**, and **Loose ends**. KPIs above them: people,
completeness, on no project, possible duplicates.

- ⚠️ **The map read stopped filtering out the unlinked rows.** It read `stakeholder_map` with
  `stakeholder_id is not null`; it now reads the whole table and partitions, because rows with a NULL
  `stakeholder_id` are the *"loose ends"* worth counting. **One read answers both questions.**
- ⚠️ An unlinked row is **not breakage** and the panel says so — it is a register entry made before
  the shared directory existed. Left unexplained it reads as data loss.
- ⚠️ **The search box does not narrow this view.** Completeness over the rows matching a search is not
  the directory's completeness.
- ⚠️ Ties in every ranked list break on the **name**, so two organisations on the same count do not
  swap places between renders and read as data changing.

### ⚠️⚠️ Scoring every pair was too slow to ship, and I only knew because I measured it
The first cut compared every pair. **900 people is 404,550 pairs and 2.3 seconds of blocked main
thread** — measured, not estimated. The scan now lives in the shared `PDStakeholders.duplicatePairs`
and is **blocked**: only pairs that could possibly clear the matcher's surname gate are scored.

⚠️⚠️ **The blocking key is derived FROM that gate, never invented beside it.** A non-zero score needs
the two last tokens to be equal, within one edit, or one to be an initial of the other. Equality and
the one-edit case both fall out of the **deletion neighbourhood** (two strings within one edit always
share a member of it); the initial case needs a one-character last token, which no key can cover, so
those few people are compared against everyone.

**Two further cuts of the cap were both wrong, and both were caught by measuring rather than reading:**

| | 900 people, distinct surnames | 900 people, all one surname |
|---|---|---|
| every pair scored | 2,346 ms | 2,346 ms |
| cap checked *after* enumerating | 132 ms | **11,030 ms** to say *"not scanned"* |
| cost estimated from bucket sizes | 195 ms | 2 ms — but **refused 300 people that were 267ms of honest work** (a ~7× over-count) |
| **shipped:** exact decision, early abort | **208 ms** | **51 ms** |

A cap that only reports after paying the cost is not a cap; an estimate that over-counts sevenfold
refuses work it should do. The decision is now exact and the enumeration aborts the moment it passes
the cap, so **2,000 people with distinct surnames scan in 446ms** where 900 used to take 2.3s.

### Verified
**36 assertions** executing `dirHealth` **sliced out of this file**, plus **19** on `duplicatePairs` in
the shared suite — including the one that matters: ⚠️ **a wrong blocking key is invisible, it drops
duplicates and the screen reports "none found"**, so the suite asserts the blocked scan returns the
**exact pair set an exhaustive scan returns** over a directory built full of near-misses (a surname
typo in the *first* character, typos by insertion and deletion, a one-character surname, a match
reachable only through a nickname). **Three new contrast builds, all biting**; 11 of 11 overall.

Rendered in a browser against the real stylesheet, light and dark: six panels, 24 bars, correct
counts, no fill exceeding its track, no label widening a panel, no horizontal page scroll, and every
colour resolving through `--pd-*` in dark (warn fill → the dark `--pd-muted`, red → `#EE3124`).
Empty-directory and missing-table states both render their own message.

⚠️⚠️ **My harness reported a clean render of invisible bars.** It never loaded `dashboard.css`, so
every `--pd-*` token resolved to nothing and each fill computed to `rgba(0,0,0,0)` — with **perfect
widths**. The width checks passed and said nothing at all about whether a bar was painted. The
harness now loads the shared stylesheet and asserts the fills are **not transparent**. This is the
third time a harness in this repo has reported an unstyled page as a finding.

⚠️ The narrow-viewport check **did not run** — the pane refused to emulate 420px and reported
`clientWidth 980`, so what was measured is a 980px viewport (two columns, no horizontal scroll). The
one-column phone case rests on `repeat(auto-fit, minmax(330px,1fr))` collapsing by construction:
a cascade fact, not a rendered result.

⚠️ **Not verified signed in** — no health figure has been computed from the live directory.

## 2026-09-10 (u1) — The directory becomes a Universe: cards over the whole register, and clickable A–Z bands

Owner, pointing at a separate stakeholder app built by another developer: *"I want to adopt the
feature seeing the whole stakeholders rather than a table and seeing the clickable bands."* Two
things came across from those screenshots — a **card grid over the whole directory**, and an
**alphabet strip with counts** you can click to jump. Both are now the Directory's default.

- **Cards, not rows.** Initials avatar, name, organisation, role, project count, a status dot and a
  favourite star. The table is still there behind a **grid / list** toggle, because a table is the
  better answer to *"who is on more than one project"* and a card grid is the better answer to
  *"who do we know at DPWH"* — the two questions this screen gets asked.
- **The A–Z strip renders every letter, present or not.** A strip that shows only the letters in use
  jumps around as you type in the search box, and a **disabled** letter is the useful answer to *"is
  there anyone under Q?"*. Empty letters are disabled, never hidden. ⚠️ `#` (names not starting with
  a letter) sorts **last**, or a handful of odd rows would head a list of 240 people.
- ⚠️ **Bands are cut on the same NORMALISED name the matcher uses**, so `Engr. Ana Reyes` lands
  under **A** with everyone else rather than under **E** on its honorific. One normaliser, so the
  band strip and the duplicate warning cannot disagree about who a person is.
- **Grouping is a choice** — A–Z, organisation, sector, or none. ⚠️ Switching it **clears the picked
  band**: a letter selected under A–Z means nothing under "group by organisation", and carrying it
  across would filter to an empty screen with a control that looks satisfied.
- ⚠️⚠️ **The favourite star is OPTIMISTIC AND REVERTS ON REFUSAL.** `is_favorite` only exists once
  `migrations/2026-09-10-stakeholder-profile-fields.sql` has been run, so on an un-migrated database
  every click **will** be refused — and RLS answers a refused UPDATE with **200 and zero rows**, the
  silent-success trap this log already records for the merge. Zero rows is treated as failure: the
  star goes back and it says, once, which migration is missing. A star that appears to stick and
  silently did not is worse than one that refuses.

### The list view is the same grouping, not a second one
`dirRender` became a dispatcher; the old table body is now `dirRenderList`, fed the **same band
groups** the grid draws. ⚠️ It gets its own container rather than swapping `innerHTML` on one node —
the two layouts share no structure, so one node would make each render pay for the other's markup.

### New KPI: *On no project*
A person added and never assigned is the actionable state this screen exists to surface, and nothing
counted it. Counted, not hidden.

### Verified
The shipped directory code was **sliced out of `index.html` and driven in a browser** against the
real stylesheet: **27 bands rendered, 26 with people**, empty ones **disabled rather than hidden**,
`#` ordered last; clicking **F** filters to 3 cards and clicking an empty letter is refused;
group-by-organisation reproduces the right counts; no grouping gives 0 sections, 0 bands, 32 cards;
the list layout draws 26 band rows + 32 people = **58 rows**; and card heights are **uniform at
102px**.

⚠️ **Two of my own defects, both caught by measuring rather than reading.** Card heights came back
ragged (`[85, 102]`) because an empty role line collapsed — fixed with `min-height`, ⚠️ **not** the
`::after` escape I tried first, which wrote a **literal NUL byte** into this file and rendered as
mojibake on the card. And my first harness asserted `capOverflows: ? false : false` — a claim that
cannot fail — now a real clip-and-height check.

⚠️ **Not verified signed in.** No card has been drawn from the live directory, and no favourite has
been written.

## 2026-09-10 (s5) — The Stakeholders tab stops being read-only: a directory you can author

Owner: *"By Portfolio Overview and accessing the stakeholder map, planners can create stakeholders
from this and assign it to different projects."* The second half of Stage 4; the first half stopped
new duplicates at the point of entry, this one is the portfolio-level master list itself.

The tab had a search box and a table over the `stakeholder_map` **mirror** — no create, no assign,
no row click. It now carries two views:

- **Directory** — one row per `stakeholders` person: name, organisation, role, sector, and how many
  projects they are on. ⚠️ That count reads the FULL map, never the project-filtered one: "on N
  projects" is a fact about the person, and scoping it would make the same person read 3 on one
  screen and 1 on another. The scope note is hidden in this view for the same reason.
  ⚠️ A person on **0** projects shows `0`, not an em dash — it is a real and actionable state
  (someone in the directory nobody has assigned yet), and a dash would read as "unknown".
- **By project** — the existing mirror view, unchanged. It answers a different question.

**+ Add person** creates a directory row. ⚠️ The duplicate warning fires **while typing**, not after
saving: telling a planner they have made a duplicate once it exists is worse than useless, because by
then somebody has to merge it. It uses the same shared matcher as the module's save path, so the two
screens cannot propose different answers.

**Assign to projects** ticks projects and writes `stakeholder_map` rows carrying the link, the
`created_by` RLS needs, and the mirrored person fields. ⚠️ Projects the person is already on render
disabled and are skipped rather than inserted twice. ⚠️ The toast reports the count that came BACK —
`stakeholder_map_ins` requires `can_access_project`, so a project the planner cannot write to must
not be counted as done.

### ⚠️⚠️ Merge, and the two ways it refuses

`mergePeople` re-points the loser's project rows, fills only the winner's EMPTY fields, and deletes
the duplicate. It refuses in two situations rather than guessing:

- **Both people are on the same project.** Re-pointing would put two rows for one person on one
  project; deleting one would destroy that project's own assessment of them — influence, interest,
  engagement plan — which is real, unrecoverable work and not a merge dialog's decision. The message
  names the project.
- ⚠️⚠️ **Fewer rows moved than expected.** `stakeholder_map_upd` is
  `(created_by = auth.uid() or is_admin())`, and **PostgREST answers an RLS-filtered UPDATE with 200
  and zero rows** — the silent-success trap this repo has recorded since `boq_tag_activities`. So
  re-pointing rows another planner created returns success and changes nothing. Every write is
  `.select('id')`ed and counted; a shortfall **stops the merge and deletes nothing**, because
  deleting the loser then would orphan the rows that did not move (`on delete set null` turns them
  into unlinked legacy rows). The message says how many of how many moved and why.

⚠️ `photo_path` and `photo_thumb_path` are only ever taken **together, from one person** — a merge
that filled them independently would pair one person's photo with another's thumbnail, the identical
trap the backfill migration solves with `(array_agg(... order by ...))[1]`.
⚠️ A delete the policy refuses (`stakeholders_del` is `is_planner()`) is **reported**, not claimed:
the people are merged but the duplicate row survives, and the planner is told.

### Verified

**26 assertions on the shipped data operations**, executed against a Supabase-shaped stub that can be
told to behave like RLS — accept the call, return 200, hand back fewer rows than were asked for.
Plus the 41 matcher assertions, and **8 contrast builds, all biting**.

⚠️ **One contrast did not bite at first and the fixture was at fault, not the code:** the
"loser overwrites a field the winner has" build passed because the loser's `role_title` was `null`,
so an overwrite had nothing to overwrite with. The fixture now gives it a real conflicting value, and
the assertion checks the PATCH rather than only the report.
⚠️ **My first Supabase stub made `.select()` terminal**, so shipped code threw *"ilike is not a
function"* — a stub bug that reads exactly like a code bug. The real builder is chainable and
thenable, and the stub now is too.

**Driven in a browser** against the shipped stylesheet with the directory code sliced out of the
page: the list renders with correct per-person project counts; the person panel disables the projects
they are already on; assign writes exactly one row for the untouched project with the mirror fields;
a clean merge repoints, fills `email` + the photo pair, leaves `role_title` alone and deletes the
loser; the same-project refusal **writes nothing at all**; and the partial-repoint refusal leaves the
loser **undeleted** and the winner **un-updated**. The live duplicate warning surfaces both Fernandos
while typing and clears for an unrelated name — matching "Megawide Construction **Corp**" against
"…**Corporation**", which is the corporate-suffix folding working.

`stakeholders.js` → `?v=20260910s5`; `MODULE_V` → `20260910s5`.
⚠️ **Not verified signed in** — no person has been created, assigned or merged against the live
directory, and the RLS refusal paths above are reasoned from the policy text plus a stub, never
observed. The first real merge is the thing most worth watching.

## 2026-09-09 (p3) — The 13 in-page tabs go, the Group Head column goes, and the S-curve becomes per-project

Owner's three Portfolio Dashboard items.

### 1 — The tab strip was a second copy of the sidebar

*"The tabs in the page itself is redundant with the buttons of the side panel."* Correct:
`UI.renderNav`'s portfolio section already deep-links into every one of those views through
`#po_view=`. The 13-button `.po-tabs` strip is removed.

- ⚠️ **Routing survives untouched** — `switchView` is driven by `UI.bindHistoryState` off the URL hash,
  never by the buttons, so every existing deep link still works. The `.active` toggle, the click wiring
  and the role-gating loop are **deleted, not left dead**.
- ⚠️⚠️ **MILESTONES WOULD HAVE BECOME UNREACHABLE.** It has no module, so `PORTFOLIO_TAB` (which maps
  module keys) cannot produce it, and the strip was its only entry point. `ui.js` now lists it
  explicitly in the portfolio section. `overview` needs no row — the plain "Dashboard" link lands there.
- ⚠️⚠️ **THE PROJECT FILTER WAS A CHILD OF THE STRIP** and scopes *every* view, so it could not go with
  it. It keeps its own `.po-scopebar` rather than moving into the Overview toolbar, where the other
  twelve views could not reach it. ⚠️ That bar must never become an `overflow-x` container — the menu
  is `position:absolute` and would be clipped, which the removed comment recorded and this one keeps.
- ⚠️⚠️ **THE ROLE GATE MOVED INTO `switchView`, AND IT IS STRICTLY STRONGER THAN WHAT IT REPLACES.** It
  used to set `hidden` on five tab buttons — which never stopped anyone typing the `#po_view=` hash,
  because the hash goes straight to `switchView`. Gating the view closes the door the tabs never did.
  Same five as before, matching `superAdminOnly` in `config.js`, which is also what gates the sidebar.
  UI visibility only, no RLS change — unchanged from before.

### 2 — Group Head column removed

Redundant with the group-head row segregator. ⚠️ `groupHead()` itself **stays**: it feeds the search,
the row grouping and the Excel export. ⚠️ Removing a column means four other places must follow, and
they are the easy thing to miss — the `colspan="3"` group row's fillers, the TOTAL row's fillers, and
the empty state's `colspan`. **Asserted**: header, body row, group subtotal, TOTAL and empty state all
count **8**. ⚠️ The empty-state anchor was scoped to the projects table — the identical
`colspan="9" class="po-empty"` string appears in the Resources and Equipment tables, which still have
nine columns of their own and must not be touched. ⚠️ My first cell counter reported the subtotal row
as 6 against a header of 8; the row was correct and the COUNTER was wrong (an optional colspan group
with a lazy quantifier is simply skipped, so `colspan="3"` counted as 1). Rewritten before it was used
to justify anything.

### 3 — One chart, colour = project, line style = series

*"a chart s-curve showing the different s-curves of different projects … however, I am thinking how
this would look if there are even 2 projects with different s-curves (BL, Actual, Forecast)."*

- ⚠️⚠️ **`scCompute` WAS A HAND-COPIED DUPLICATE of `assets/js/scurve.js` and is now a wrapper over the
  shared engine.** That duplicate is exactly the drift the 2026-09-01 extraction into `PDScurve`
  existed to prevent, and it had already cost something real: the *"Overall Progress" ≡ "Actual to
  date"* identity bug has to be reasoned about in three places instead of one. Fixing the engine now
  fixes this page too — which is what makes the Stage-5 KPI work land once instead of three times.
- ⚠️⚠️ **THE Y AXIS IS PER-PROJECT PERCENT, NOT A SHARED ABSOLUTE TOTAL.** Duration units are not
  comparable across projects: a 40,000-day programme would flatten a 2,000-day one into the axis and
  the comparison would say nothing. Every curve runs 0→100% of its own total.
- ⚠️ **`project_id` added to the lean select.** Its absence is precisely *why* a per-project overlay
  was impossible — every row arrived anonymous. The rest of the column list now mirrors `PDScurve.COLS`
  so the fetch and the engine cannot drift about which columns the maths needs.
- ⚠️ **The RPC fast path is kept, for the KPI strip only.** `schedule_scurve_agg_multi` returns one
  combined aggregate and cannot produce per-project series, so the overlay comes from rows — but
  rendering the roll-up KPIs off the RPC first means the strip still appears immediately instead of
  waiting on a 40k-row fetch, which is what it always did.
- ⚠️ **Above 5 projects the chart defaults to Actual-only and SAYS SO on screen.** N projects × 3
  series is 3N lines. It is a default, not a limit — three checkboxes bring Baseline and Forecast back,
  and **no project is ever silently dropped from a chart**.
- ⚠️ Series are drawn as runs split on nulls, not one polyline through the gaps — a single polyline
  would draw a straight line across months a project does not cover. Cumulative values carry forward
  after a project ends, because a gap there would read as progress going away.

**Verified** by slicing the shipped overlay out of the page and executing it against seven-, three- and
two-project fixtures built through the real `PDScurve.compute`: 2 projects → **6 polylines in 2
colours**; 3 → **9 in 3**; 7 → **7 solid lines with the note shown**; 7 with every series ticked →
**21 lines, 7 colours, note gone**; y-axis 0–100%; and **no drawn point outside the plot box**, which is
what proves the per-project percent normalisation. Rendered and screenshotted in dark mode.

⚠️ `.po-planned2` / `.po-actual2` deleted rather than left dead — they styled the two polylines of the
old single combined curve, and colour is per project now, so it cannot come from a static class.

`MODULE_V` → `20260909p3`; the page now loads `scurve.js`.
⚠️ **Not verified signed in** — no real project schedule has been drawn.

Cross-project **Portfolio Overview** dashboard (Phase 2). Unlike other modules it is
**project-agnostic** — it reads ALL projects the signed-in user can access (RLS-scoped) plus
the workspace tree, and does not use `pd_project`.

## Data
- `PDb.getProjects()` + `PDb.getWorkspaces()` only — no own table, no migration.
- Uses the same Workspace→Program→Group-Head tree model as `dashboard.html`
  (`ancestorOfType`, `groupHead`, `childrenMap`, `pathOf`).
- Reads existing `projects` fields: `status, workspace_id, group_head, original_budget,
  estimated_cost, schedule_progress, schedule_start/finish, forecast_start/finish,
  start_date/end_date` (the schedule_* rollups are written by the project-schedule module).

## Contents
- **KPI cards**: Projects, Active, Avg Schedule %, Original Budget, Estimated Cost, Budget
  Variance (est−orig), Over Budget count, Behind Schedule count.
- **Schedule Health donut** (SVG, no libs): On Track / Behind / No Schedule.
  `health(p)` = no schedule_progress → none; slipped vs baseline finish OR overdue-and-incomplete
  → behind; else on track.
- **Budget-by-group bars** (SVG): Original vs Estimated per group, top 8 by estimated.
- **Grouped, sortable portfolio table**: group by Workspace / Program / Group Head / Status /
  None; per-group subtotals + grand total; sort any column; collapse groups; click a project
  row to drill in (sets `pd_project`/name/workspace → `dashboard.html`).
- **Filters**: status, behind-schedule-only, text search. **Export** to Excel.

## Discovery
- Registered in `assets/js/config.js` MODULES (`enabled: true`) → appears on the Project Home
  module grid.
- Top-level nav link added in `projects.html` (sits with "All Projects").

## Notes
- Pure vanilla + shared APIs (AppAuth/PDb/Fmt/UI/Icons); XLSX from CDN for export.
- No schema changes.

## Project selector filter (2026-07-06)
The single "All projects / one project" dropdown became a **multi-select checklist**
(search + Select all/Clear); KPIs/donut/bars/table all narrow to the checked set (`projSel`
map; empty = all projects). Verified in a stubbed harness.

## Cross-project S-Curve + Cash Flow tabs (2026-07-06)
Added a tab strip (**Overview / S-Curve / Cash Flow**) above the existing dashboard, which
moved into a `#po-view-overview` container unchanged. The two new tabs are **real** cross-
project views (not just a nav shortcut) — decided after finding the actual data-cost tradeoffs
per module:
- **S-Curve**: fetches real `project_schedule` rows (paginated, `.in('project_id', ids)`)
  across whichever projects the Overview tab's project filter currently resolves to, and
  reuses the **exact duration-weighted math** the single-project S-Curve module computes
  with (`compute()` in `modules/s-curve/index.html`) — `project_id` doesn't matter to that
  math, so a combined multi-project activity list works without modification. Warns (toast)
  if a combined fetch exceeds 20,000 activities. **Not the vestigial `s_curve` table** — that
  table has no writer anywhere and isn't used by the real S-Curve module either.
- **Cash Flow**: fetches `cash_flow` rows across the same scoped project ids (cheap — one row
  per project per month), aggregates into monthly Planned/Actual bars + cumulative curves +
  a category breakdown table.
- Both tabs are lazy-loaded on first visit and cache by the current project-id scope; a
  Refresh button force-reloads (so changing the Overview filter while already on a data tab
  doesn't silently go stale, but also doesn't refire a heavy query on every keystroke).
- Verified in a stubbed harness (synthetic 2-project, multi-activity, multi-category fixture):
  hand-checked S-Curve math (TOT=186 duration-days, overall 33.2%, planned-to-date 57.9%,
  variance -24.7pp) and Cash Flow aggregation (₱1.15M planned / ₱990k actual across 4 entries,
  category breakdown to the peso) both matched exactly; confirmed the project filter narrows
  both new tabs identically to the Overview tab.

## Project selector moved to the tab bar (2026-07-11)
User feedback during live testing: on the S-Curve tab there was no project selector — it lived only in
the Overview toolbar, so you had to switch back to Overview to change scope. Moved `#po-projfilter-wrap`
out of the Overview toolbar into the always-visible `.po-tabs` bar (right-aligned, `margin-left:auto`),
so the same multi-select filter scopes Overview + S-Curve + Cash Flow from any tab. Handlers are keyed
by id (no JS change); the scope notes on the S-Curve/Cash Flow tabs now read "the project filter above"
instead of "set on the Overview tab". Behaviour unchanged: changing scope while on a data tab still needs
the tab's **Refresh** (cached by scope, per the 2026-07-06 note).

## Resources tab — cross-project resource demand (2026-07-11)
4th tab (Overview / S-Curve / Cash Flow / **Resources**), scoped by the same project filter. Because
`resource_assignments` can be 27k+ rows for ONE project, it does NOT fetch raw rows — it calls a new
**`portfolio_resource_summary(text[])` RPC** (migration `../../migrations/2026-07-11-portfolio-resource-rpc.sql`,
**USER MUST RUN**) that GROUP-BYs on the server and returns one compact row per resource identity
(name/type/uom) across the scoped projects: distinct projects, assignment count, Σ budgeted/actual/
remaining units, Σ budgeted/actual cost. UI = KPI row + a top-12-resources-by-budgeted-cost bar list
+ a full per-resource table with a TOTAL row. Lazy-loaded + cached by scope (Refresh button), same as
the S-Curve/Cash-Flow tabs. **Tolerant:** if the RPC isn't installed, shows a "run the migration"
nudge (verified live 2026-07-11 — tab opens, nudge shows). RPC is `security invoker` so the caller's
RLS (`resource_assignments` read = `is_approved`) applies.

## Live collaboration (presence) + offline read (2026-07-27) — fmlozano
Portfolio spans **all** projects and is a **read-only rollup**, so it gets **presence-only + offline
read-cache** — no per-project live stream (cross-project unfiltered would be broad) and no editing cursor.
- **Presence:** `PDCollab.join({ key:'portfolio', … })` with **no `tables`/`projectId`** (presence +
  broadcast only, no postgres_changes) — shows who else is viewing the portfolio right now, avatars in
  `#po-presence`. Live per-project data still arrives via the per-tab **Refresh** + the modules that
  write the rollups.
- **Offline:** the `PDb.getProjects()` + `getWorkspaces()` load is cached under `po:all`; on a failed
  fetch the last-cached portfolio renders so the dashboard still opens offline (the lazy S-Curve/Cash
  Flow/Resources tabs still need a connection).
- No migration (presence needs no server change). Verified: inline script parses. Live verification
  pending. Assets: `offline.js?v=20260726d` + `collab.js?v=20260727a`.

## Cash Flow module now real (2026-07-06)
Cash Flow was flipped to `enabled: true` in `config.js` because it stopped being a placeholder
— see `modules/cash-flow/CLAUDE.md`. This tab reads its `cash_flow` table.

## Equipment availability across the portfolio (2026-08-24) — fmlozano

A fifth tab, **Equipment**, answering the one question a project-scoped register cannot: *where is
each asset committed, and when does it come free?* No migration — it reads `equipment_items` +
`equipment_loading` for the scoped projects.

**The month grid is the answer, and availability is its negative space.** One row per asset, one
cell per month, coloured by the project that has it; an empty cell means free. A KPI band, four
availability filters (All / Free now / Free within 3 months / Double-booked), category + search, an
asset register below it, and an Excel export that emits **the same picture** (a column per month) so
the sheet and the screen cannot tell different stories.

⚠️ **The asset identity is `equipment_items.code`, and that column is unique per PROJECT — which is
exactly why the same code on two projects is reported, not judged.** It is either one asset that
moved between them or two projects that both numbered their first crane TC-01, and *nothing in the
data distinguishes those*. So a month where two projects both plan one code is marked "planned on two
projects" with both names in the tooltip; calling it an error would be a guess presented as a fact.
Codes are merged case- and space-insensitively, because "TC-01" and "tc-01" are the same asset to
every human reading the sheet.

⚠️ **Only PLANNED quantities drive the grid.** Actuals say where an asset *has been*; availability is
a forward question. A planned quantity of **0 or blank is not a commitment** — those are how the
Equipment Loading module records "not reported" and "none on site", and treating either as a booking
would report a free asset as busy.

⚠️ **`PDb.selectAll`, never a bare select.** One row per equipment per month across a whole portfolio
passes PostgREST's 1000-row cap easily, and a truncated read here would report an asset as free in
months it is actually committed — the most dangerous failure this screen has, and a silent one.

⚠️ **"Free from" is read off the same grid the planner is looking at**, so the number in the table and
the picture in the strip can never disagree. This month is always on the axis even when nothing is
committed near it — "free now" is a claim about the present and needs the present on screen to be
checkable. The window is capped at 48 months and **says so** when it truncates.

⚠️ **Project colours are keyed by project id, not by position in the filtered list** — otherwise
every filter change repaints the grid in different colours and the legend has to be re-read.

**Four real defects found by measuring, none of which would have shown up in a code read.**
1. The inline `style="background:…"` shorthand **reset `background-image`**, so the diagonal hatch
   marking a double-booked month never rendered — measured as `background-image: none` on a cell that
   should carry it. It is `background-color` now.
2. `min-width:100%` with auto table layout let the browser widen the columns past their declared
   widths; with `table-layout:fixed; width:100%; min-width:max-content` the strip fills the card
   (it previously huddled in ~610px of a 1400px card) and still scrolls when the portfolio is long.
3. The brand red on the red tint used by the code chip reads **3.60:1** — under AA at 12px bold. Ink
   on the same tint is **14.25:1 light / 13.45:1 dark**, and a red left border keeps the brand cue
   (the same treatment as the PRC group-head chip).
4. In dark mode the "free now" green read **2.61:1** and the flag colour **4.02:1**. The dark
   overrides take those to 7.26 and 6.12. A single colour for both themes cannot satisfy either.

**Verified** — 24 checks executing the shipped `eqBuild` / `eqVisible` / `eqColorFor` (sliced from the
file, never reimplemented): codes merged case-insensitively into one asset, sequential months across
two projects **not** flagged while the same month **is**, zero and blank ignored, a registered but
unplanned asset carrying no months, an uncoded item kept + flagged + sorted last, "free from" landing
on the first uncommitted month, this month always on the axis, a 12-year span capped at 48 with the
truncation reported, and every filter. Plus a real browser against the shipped CSS at 1440 and a
375px layout viewport: 23 rows × 13 months, sticky asset column and header, the hatch present, all
five KPIs, 0 page horizontal scroll at either width, the grid and the register each scrolling inside
their own card, every control ≥44px on the phone, and light/dark contrast at **min 5.37:1**.

⚠️ **Not verified signed in** — the anon key has no grants on the equipment tables, so the
cross-project read itself is untested against real data.
⚠️ **This module's `index.html` is NOT cache-busted** (it is reached by a plain sidebar href, not
through `MODULE_V`), so hard-refresh once after the deploy.

## Milestone calendar (2026-08-26) — fmlozano

Owner: *"For portfolio dashboard, let's have a calendar view of the milestones as well."* A sixth
tab, **Milestones**, scoped by the same project filter as every other tab. **No migration** — it
reads `project_schedule` for the scoped projects.

**A month grid with an agenda under it.** Chips sit in day cells colour-coded achieved / overdue /
due; month arrows and a Today button move the window; clicking a chip opens the milestone with its
slip against baseline. Filters are project, state and a programme-milestones-only toggle. The KPI
band reads Milestones · Overdue · Next 30 days · Achieved · Undated.

⚠️ **A milestone is `activity_type ILIKE '%milestone%'` OR `program_milestone = true`, matched
server-side.** Both, because the two disagree in the real data: P6 exports type them (`Start
Milestone` / `Finish Milestone`) while the flag is set by hand here, and either test alone silently
drops a whole class of them. The `ILIKE` also catches the `Milestone`/`milestone` casing both spellings
appear in.

⚠️ **`PDb.selectAll`, never a bare select.** Milestones across a whole portfolio pass PostgREST's
1000-row cap, and a truncated read would report a project as having no milestones this month — a
silent wrong answer on the screen whose entire job is "what is due".

⚠️ **UNDATED MILESTONES ARE COUNTED AND NAMED, never dropped.** A milestone with no date cannot be
placed on a grid, so the tempting thing is to filter it out — but "no milestone this month" and
"nobody has dated this milestone" are opposite facts, and only the second is a reason to go and
look. It gets its own KPI reading "1 (cannot be placed on the calendar)".

⚠️ **Achieved is `actual_finish`, and it is reported against BASELINE, not against the current
plan.** Comparing an actual to `end_date` measures nothing — the plan moves, so a milestone that
slipped six months reads as on time the moment someone re-baselines the date. `bl_finish` is the
committed date and the slip is the variance from it. Falls back to the planned date only when there
is no baseline, and says which it used.

⚠️ **Overdue means past AND not achieved.** A date in the past is not by itself a problem.

⚠️ **All date arithmetic is UTC string maths** (`ymd`/`isoOf`/`addDays`), never `new Date(str)`.
Local parsing of a bare `YYYY-MM-DD` is midnight UTC rendered in local time, which east of Greenwich
is the previous day — the off-by-one that has bitten this repo repeatedly (see the drawing-register
importer and the MoM aging fixtures).

⚠️ **The grid is Monday-first with a fixed 42 cells** (`lead = (getUTCDay() + 6) % 7`). Six weeks
always, so the calendar does not change height as you page through months and the chips do not jump.

⚠️ **The `+N more` overflow is a BUTTON that opens the day, not a label.** The cap is 3 chips per
cell; a "+2 more" you cannot click is the same as hiding them.

**Two real contrast failures, found by measuring rather than reading.** The first measurement was
itself wrong — it ignored alpha, so a tint of the same hue read as ratio 1.00 and looked fine.
Compositing over the actual ancestor background surfaced `.po-cal-more` and `.po-ms-prog` at
**3.40:1 dark / 4.12:1 light**, under the AA floor for small bold text. Both now use body ink (with a
red border on the programme mark to keep the brand cue): **all 13 marks pass, min 4.86 light / 4.81
dark.**

⚠️ **A pre-existing phone defect, which I made worse and therefore fixed.** An A/B against my own
added tab measured `.po-tabs` at **573px in a 375px viewport before this change** and **685px
after** — it already overflowed, and the 6th tab widened it by 112px. It was `flex-wrap: nowrap;
overflow-x: visible`, so the later tabs simply spilled off-screen unreachable.
⚠️ **It now WRAPS rather than scrolling, and that is deliberate:** `#po-projfilter-wrap` is a *child*
of `.po-tabs` and its dropdown is `position:absolute`, so an `overflow-x` scroller here would
establish a clipping context and cut the project filter's own menu off — the exact trap the module
topbar hit in the 2026-07-24 part-6 pass. The filter takes its own full-width row. Measured after:
strip **355px**, all 6 tabs on screen over 2 rows, 44px targets, dropdown clipped by nothing.

**Verified in a browser harness against the shipped markup and CSS**, at a 375px layout viewport and
at 1280: 42 cells in a 7-column grid, Monday first / Sunday last, today highlighted; KPIs read
`12 / 1 overdue / 7 next-30 / 2 achieved (1 late) / 1 undated`; the `+2 more` overflow opens and
shows all 5; an empty month says *"Nothing in November 2026 — use the arrows, or Today, to move."*;
the agenda's first row reads `2026-08-11 | One Portwood Residences | Topping Off — Tower 1 program |
Construction | Achieved planned 2026-08-06 | +5d`. Desktop confirmed byte-for-byte unchanged
(`nowrap`, one row, 38px tabs, filter right-aligned, no page scroll). Inline script parses, CSS
braces balanced, **0 functions lost / 21 added**, and the BOQ (112), PMI (82) and push (22) suites
are still green.

⚠️ **Not verified signed in** — the anon key has no grants on `project_schedule`, so the query
itself is exercised against a fixture, not against real data. The `.or()` filter string in particular
is untested against PostgREST.
⚠️ **This module's `index.html` is NOT cache-busted** — it is not in the `MODULES` registry and all
five hrefs to it are plain links, so `MODULE_V` does not reach it. **Hard-refresh once after the
deploy** or the new tab will not appear.

### 2026-08-27 — "Parent project": AVR101 + AVR102 consolidate without becoming one project

Owner: *"Let's just consolidate the two into a portfolio view… similar to how procurement dashboard
works."* Avesta Residences is bought as **AVR101** (Tower 1 and General Requirements) and **AVR102**
(Towers 2-7). Both are real, separate projects here — and in Procurement and Engineering, which is the
constraint that decided the design.

⚠️ **A ROLLUP, NOT A MERGE, and that is the whole point.** Folding them into one Planners project holding
two `packages` rows is what produced the `AVR101 › {AVR101, AVR102}` nesting the owner reported, and it
breaks the cross-app link: `push-packages` resolves **one** downstream project per Planners project
(`cash_flow_settings.wpm_project_id`), while WPM and Engineering each hold AVR101 and AVR102 as their own
projects. Keeping the rows separate keeps that 1:1 intact and costs no data change.

**Ported from `wpm/index.html`** (`_progKey` / `_progLabel` / `_progTotals`) rather than re-invented — the
Procurement dashboard hit this first and its answer is already the one the buyers read.

- **`Group by → Parent project`**, alongside Group Head / Status / None. The key is the **leading letters
  of the project code** (AVR101, AVR102 → AVR), overridable by a `program` column if one is ever added.
  ⚠️ Not a guess: it is the convention every id here already follows (AVR, BAU, GPR, SLN, SLT), so it
  needs **no data entry** to start working, and a project with a unique prefix forms a group of one that
  reads exactly as it does today.
- **The group is named by the words its members' names actually share** — "Avesta Residences", not "AVR".
  ⚠️ Falls back to the code when they share fewer than 3 characters, which is the honest answer for an
  accidental prefix collision; inventing a shared name for two unrelated projects would be worse than
  showing the bare code.
- ⚠️ **The key groups, a separate function names.** Collapse state and sorting stay on the KEY, so
  renaming a project never loses a collapsed group.
- ⚠️ **GROUP PROGRESS IS WEIGHTED BY ACTIVITY COUNT, never a plain mean** — the single number that makes
  this rollup worth having. AVR101 carries ~4,393 activities and AVR102 far fewer; averaging 60% and 10%
  to **35%** describes no real project, where the weighted answer is **58%**. Same principle as WPM's note
  on award rate: *"a 2-WP package at 100% and a 200-WP package at 10% is not 55%."* Falls back to the
  unweighted mean only when no member reports a count, and the cell's tooltip **says which method it
  used** rather than presenting the two alike.
- **The project filter groups too**, so the consolidation reaches past the overview table: ticking
  **Avesta Residences** puts both packages into the S-curve, Cash Flow, Equipment, Milestones and
  Resources tabs at once. The parent checkbox is tri-state; searching "Avesta" keeps AVR102 even though
  its own name reads "Towers 2-7". ⚠️ A program of one renders **flat, with no parent header** — a
  hierarchy above a single project is the same invention this change exists to remove.
- **The label answers "what am I looking at?"** — one whole parent selected reads *"Avesta Residences
  (2 packages)"*, not *"2 projects"*.
- **The Excel export carries a `Parent project` column** so a pivot consolidates the same way.
  ⚠️ Computed over the whole portfolio, not the filtered list, or a filter hiding AVR102 would rename
  AVR101's parent to AVR101's own title.

**Verified 23/23 in Node against the shipped functions** (extracted from this file by brace-matching, not
re-typed): the AVR pair keys together; `program` overrides the prefix; the shared-name label, its
punctuation trim and its collision fallback; weighted 58% vs the naive 35%; a project with no progress
excluded rather than counted as zero; group ordering and membership; all four filter-label states.
Group-header and checklist markup rendered and inspected.

⚠️ **Not clicked through signed in** — the app is auth-gated and this session had no credentials. Class
audit clean (`po-pf-prog` / `po-pf-child` / `po-pf-count` all defined); the only undefined classes are the
pre-existing `po-scope` and `po-tablecard`.
