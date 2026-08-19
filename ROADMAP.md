# Planners Dashboard — Roadmap (captured 2026-08-19)

Owner's requirement dump of 2026-08-19, broken into scoped work items with the files each
one actually touches. Nothing here is implemented yet — this is the agreed backlog.
Order below is the proposed sequence (shell/navigation first, then per-module features),
not a commitment; the owner picks what ships next.

---

## A. Shell & navigation

### A1. Align UI with the Procurement (PRC) App — same icon/logo sizes ✅ done 2026-08-19
Reconciled to PRC's own values, verified in a browser against the shipped CSS:
- `.pd-brand` is now full-bleed with PRC's `18px 20px 16px`, and `.pd-brand-logo` has **no
  max-width** — the wordmark measures 200px in a 240px sidebar, identical to PRC. The old
  `188px` cap was the whole reason it read smaller.
- Nav rows `9px 12px` / 13px, nav icons **16px** with a 10px gap (`.pd-navico svg` now
  scales the 18px glyph icons.js emits), section labels 9px at a 20px indent, topbar mark 26px.

### A2. Remove project foldering — go straight to projects ✅ done 2026-08-19
**Owner's decision: the group-head data stays, for filtering only.** No migration.
- The left group-head pane and the topbar context chip are gone; `projects.html` opens
  straight onto the project list.
- Group head is now a toolbar `<select>` filter (`#gh-filter`) with counts, plus a gear
  (`#gh-manage`) that edits the selected head — nothing that was reachable in the pane was
  lost. "New Group Head" stays in the **+ Add** menu.
- **Group by** defaults to `None` (was `Group Head`), so the landing view is flat. Grouping
  by group head or status remains available as an opt-in lens.

### A3. Separate Project and Package — Package lives inside Project ⚠️ partly done 2026-08-19
**The entity exists; module adoption does not.**
- `migrations/2026-08-19-packages.sql` (**OWNER MUST RUN**) creates `packages`
  (project_id, code unique-per-project, name, status, dates, contract_amount) with the
  same RLS shape as every project-scoped module table, plus an `updated_at` trigger.
- `PDb.getPackages/createPackage/updatePackage/deletePackage`; the Dashboard manages them
  and selects one into `pd_package` / `pd_package_name` (cleared on any project switch).
- ⚠️ **A package is NOT the Main-Contract/Change-Order split** — that is `scope_type`, an
  activity-level tag from `2026-08-19-schedule-contract-scope.sql`. Orthogonal axes; an
  activity can be "Package 2" *and* "change_order". C1 builds on both, not on one.
- **Still open:** no module table carries `package_id` yet, so selecting a package does not
  filter module data. Adoption is per module — the column and the UI that sets it must land
  together. Contract documented in `MODULE_CONTRACT.md` §6b.

### A4. Project landing page is a **dashboard** ✅ done 2026-08-19
`dashboard.html` is now a real dashboard: project KPIs (status/group head, budget vs estimate,
forecast dates, location), the Packages panel, and the module tiles. The launcher moved to a new
**`modules.html`**, reachable from the sidebar and from a button on the dashboard; module
back-links point at it. `MODULE_V` moved out of `dashboard.html` into the new shared
`assets/js/modules-grid.js` — **bump it there from now on**.

### A5. Dashboard for all modules ✅ done 2026-08-19
Each module publishes its own tile spec as `dash` on its `config.js` entry
(`{table, unit, attention?}`); `PDb.moduleSummary` reads only what the module declared — the
shell never reaches into a module's tables. Tiles show a row count, an optional
"needs attention" figure, and last-updated.
- ⚠️ Counts use a HEAD `count:'exact'` request, **not** `select().length` — PostgREST caps a
  read at 1000 rows, so a big project's schedule would report 1000 activities forever.
- ⚠️ `attention` is declared **only where the schema fixes the vocabulary** (risk_register
  `Open`; issues_lessons `Open`/`On Hold`). Contracts & Claims has a `status` column with no
  fixed vocabulary, so it claims no attention figure — a guessed one reads 0 forever and looks
  like good news. Fixing that is part of B2.
- One module's broken spec (or an unmigrated table) degrades to "Summary unavailable" on that
  tile only.

---

## B. Contracts & Claims (`modules/contracts-claims/`)

### B1. Client BOQ upload → internal class codes → activities
- Upload the client BOQ (xlsx/csv), persist raw line items, then a two-stage mapping UI:
  BOQ item → internal class code → schedule activity. Mappings must be saved, reusable,
  and auditable (who mapped what, when).
- Feeds C1 and the Cash Flow module (BOQ value is the natural S-curve basis).

### B2. Claims Register with PMI tracking
- Claims register with PMI (Potential/Pending Milestone-Impact) tracking per claim:
  status, entitlement, time impact, cost impact, linkage to the schedule activity and to
  the change order it may become.

---

## C. Project Schedule (`modules/project-schedule/`)

### C1. Separate Contract Packages and Change Orders
- The Schedule Builder already tags Main Contract (see the 2026-08-16 log). Formalise the
  split: activities belong to a **contract package** or a **change order**, as distinct
  first-class entities rather than a tag.

### C2. Change Order activities live inside the schedule, easily filtered
- CO activities sit in the same WBS/network as contract activities (so logic and float are
  real), with a prominent CO filter/toggle and a distinct visual treatment on the Gantt.

### C3. Duration scenarios (e.g. rainy-day durations), connected to the Calendar
- Named scenarios that re-derive activity durations (weather/rain-day allowance, resource
  scenarios) against `assets/js/calendar.js` working calendars, comparable side by side
  against the baseline without overwriting it.

### C4. MOM (minutes of meeting), connected to Issues and Concerns
- Capture MOM records against the schedule, with action items that create/link to entries
  in `modules/issues-lessons/`.

---

## D. Issues & Lessons Learned (`modules/issues-lessons/`)

### D1. Departments can also raise issues
- Widen issue creation beyond planners: department-scoped submission with a routing/owner
  field, so Lessons Learned collects input from the whole project org. Needs an RLS policy
  change and a role/department attribute review.

---

## Cross-cutting notes
- A3 (Project/Package) blocks C1; B1 feeds B2, C2 and Cash Flow — sequence accordingly.
- Every schema item needs a numbered file in `migrations/` plus an RLS check.
- Per-prompt workflow (CLAUDE.md log + commit + push, `MODULE_V` / `?v=` bumps) applies to
  all of the above.
