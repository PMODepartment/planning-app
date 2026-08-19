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

### A3. Separate Project and Package — Package lives inside Project
- Introduce a `packages` level between project and module data: Project → Package → module
  records. Affects the project switcher (`pd-projsw`), `sessionStorage.pd_project`
  (needs a companion `pd_package`), and every module's project-scoped queries.
- This is the largest structural item and is a prerequisite for C1 (contract packages vs
  change orders). Needs a schema migration + an RLS review before any UI work.

### A4. Project landing page is a **dashboard**, not the module launcher
- `dashboard.html` today is a module-launcher grid (`#module-grid`) titled "Project Home".
- Requirement: landing shows a real dashboard. The module grid moves to a secondary
  "Modules" view (or a sidebar entry); the landing surfaces KPIs instead.

### A5. Dashboard for all modules
- Each module contributes a summary tile/widget to A4's dashboard (schedule health,
  open issues, risk count, drawing register status, claims exposure, cash-flow position, …).
- Extend `MODULE_CONTRACT.md` with a documented "dashboard tile" hook so each module
  publishes its own summary rather than the shell reaching into module tables.

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
