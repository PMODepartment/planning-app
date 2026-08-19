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

### C1. Separate Contract Packages and Change Orders ✅ done 2026-08-19
**The two axes are now separate columns and separately filterable — that separation *is* C1.**
- `migrations/2026-08-19-schedule-package.sql` (**OWNER MUST RUN**) adds `package_id` to
  `project_schedule` **and** `wbs_nodes` (FK to `packages`, `on delete set null`), plus
  `admin_delete_package()` which refuses while activities/branches are still assigned and says
  how many. `PDb.deletePackage` now calls that RPC.
- The schedule gets a **Package** column (inline-editable, inherited down the WBS like `phase`
  and `scope_type`, "Mixed" roll-up on branches), a **Contract package** filter including
  "— Not assigned —", a **Contract Package** grouping dimension, a field in the activity form,
  and a Package column in the Excel export.
- ⚠️ **`scope_type` (main vs change order) is untouched and stays a separate column.** An
  activity can be Package 2 **and** a change order — a variation raised against the MEPF package
  is exactly that. Deriving either from the other would collapse a real distinction.
- ⚠️ **No default package.** `scopeOf` can honestly fall back to "main contract"; there is no
  equivalent for a package, so unassigned stays unassigned and the "— No package —" bucket is the
  planner's worklist.
- **Not included:** the Schedule Builder push does not set a package (it produces main-contract
  work under no package), and the Dashboard's package rows do not yet show activity counts.

### C2. Change Order activities live inside the schedule, easily filtered ✅ done 2026-08-19
The activities already sat in the same WBS/network (that is what `scope_type` being a tag buys —
logic and float are real). What was missing was seeing and finding them:
- ⚠️ **`.ps-cobar` existed in the CSS and was never emitted** — the Gantt had no change-order
  treatment at all. Now wired, re-cut as a **box-shadow ring** because critical-path (solid red)
  and near-critical (dashed amber) already own `outline` on the same element; a critical change
  order would have had both and one meaning would have vanished. Milestones ring too, and a branch
  whose activities are **all** change orders rings as well (a blended one deliberately does not —
  the Scope column already says "Mixed").
- **A prominent toolbar switch**: Blended / Main / Change orders, each with a live count, sitting
  beside the zoom control instead of three clicks deep in the Filter menu. It hides itself on a
  project with no change orders, and stays in sync with the Filter menu's radios in both directions.
- The bar tooltip now names the change order (with its CO reference) and the package.

### C3. Duration scenarios (rain days), connected to the Calendar ✅ done 2026-08-19
`migrations/2026-08-19-duration-scenarios-and-mom.sql` (**OWNER MUST RUN**). A scenario is a set of
**rules**, not a copy of the durations — a copy is stale the moment anyone edits an activity.
- ⚠️ **Season-aware, because a PH project spans many seasons.** The first cut matched a rule against
  the activity's **start month**, which was wrong twice over: a Feb→Nov activity got no wet-season
  allowance at all, and a Jun–Jul one got it applied to its dry days too. Durations are now split
  **month by month across the span**, and a rule stretches only the months it names.
- ⚠️ **Two mechanisms, not one.** A **rule** makes work slower (×1.25); a **rain day** removes a
  working day outright. They compose, in that order.
- ⚠️ **Rain is per exposure, not per project** — excavation loses half a wet month, interior fit-out
  loses nothing. Profiles are matched by trade, with a no-trade default.
- **Wet/Dry season presets** (Jun–Nov) so months are not retyped on every rule and profile.
- Preview writes nothing; **Apply** is a separate confirmed act and is undoable.
- ⚠️ **First-order by design and stated in the UI:** the month split comes from current dates and the
  preview does not push the change through predecessor logic. It always under-states a slip.

**Working Calendars became a first-class view** (title switcher). The schedule could read and assign
calendars but never create or edit one — the editor lived in Resource & Role Master, which made C3
unusable at the moment a planner needs it. Includes extra non-working days and **bulk-assign a
calendar to a trade**, which is what makes multi-calendar projects practical.

### C4. MOM (minutes of meeting), connected to Issues and Concerns ✅ done 2026-08-19
A new **Minutes of Meeting** view in the schedule's title switcher (tables ship in the same
`2026-08-19-duration-scenarios-and-mom.sql` migration).
- A meeting produces two different things and they are modelled apart: the **record** of what was
  said (`meeting_minutes`, which stays true forever) and **action items** (`mom_items`, each with an
  owner, a due date and a life of its own). Minutes can optionally name the schedule activity
  discussed.
- **Raise as issue** copies an action into the Issues & Concerns register and links the two; the
  register then shows a **From MOM** tag with the meeting it came from.
- ⚠️ **One-way on purpose.** After raising, the register is authoritative for how the issue is
  chased and the minute keeps saying what the meeting said. Two-way sync would give two screens a
  claim on one status.
- ⚠️ Raising is **idempotent**, an empty action is refused, and a failed link never leaves an action
  falsely marked "Raised".
- ⚠️ Deleting an action or the whole minutes **never deletes issues already raised** — said out loud
  in both confirmations, because the opposite is a reasonable thing to assume.

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
