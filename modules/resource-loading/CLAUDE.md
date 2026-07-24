# Module: resource-loading

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Resource Loading** (Phase 2). Your DB table is `resource_loading`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD with period/quantity fields)**.
> 4. Work only inside this folder, on branch `module/resource-loading`, then PR to `main`.
> 5. Update this file as you build.

## Status
- [ ] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [ ] Copied a reference module as the starting point
- [ ] CRUD implemented (add / edit / view / list / delete)
- [ ] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [ ] `Fmt.esc()` on all user text injected into HTML
- [ ] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`

## Scope note — owns Resource/Role Usage (decision 2026-07-01)
This module is the home for **resource & role loading** (OPC-style). It should define:
- a **resource/role master** (name, type e.g. Labor/Equipment/Material, unit of measure);
- **assignments** linking a role/resource to a `project_schedule` activity with
  budgeted (and actual) units, time-phased by period;
- **usage views** (per resource/role → time-phased units/cost, FTE toggle,
  chart / spreadsheet), mirroring OPC's Resource Usage / Role Usage.

The **Project Schedule** module's "Resource Usage" / "Role Usage" tabs are
intentionally placeholders today; once this module exists they will **read from
it** (by `project_id` + `activity_id`) rather than duplicating a resource engine.
Coordinate the shared shape with the Project Schedule owner before building.

## Built — Resource & Role master (2026-07-01)
Two-tab roster (OPC-faithful), enabled in config:
- **Resources**: ID (`resource_code`), Name, Type (Labor/Nonlabor/Material),
  Primary Role, **Default Units/Time %**, **Max Units/Time %** (availability),
  UoM, Calendar. Full CRUD.
- **Roles**: Name, Discipline, UoM, Remarks. Full CRUD (feeds the Primary Role
  picker on resources).
Tables `resources` + `resource_roles` — migration
`../../migrations/2026-07-01-resource-role-master.sql` (folded into
supabase-setup.sql). **Next phase:** `resource_assignments` (activity↔resource
budgeted/actual units, time-phased) to drive Project Schedule's Resource/Role
Usage tabs + FTE/availability line.

## Built — Working calendars (2026-07-06)
Third tab **Calendars** (Resources / Roles / Calendars): name, hours/day, a
Mon–Sun working-day checklist, and an editable extra-holiday list (for
Eid'l Fitr/Eid'l Adha/proclamation-moved dates, which are announced yearly and
can't be computed offline). Table `calendars` — migration
`../../migrations/2026-07-06-working-calendars.sql` (folded into
`supabase-setup.sql`). **User must run this migration.**
- One **"Philippine Standard (6-day, 8h)"** calendar is auto-seeded per project
  (`ensureDefaultCalendar`) the first time its Calendars tab loads, so
  Resources/Activities always have something to pick without a manual setup
  step. PH *regular* holidays (fixed + Easter-derived) are computed at render
  time by the new shared `assets/js/calendar.js` (`PDCal`), not stored.
- The Resources tab's **Calendar** field is now a dropdown into `calendars`
  (`resources.calendar_id`, FK) instead of free text. The old `calendar` text
  column is kept only as a display fallback for pre-migration rows.
- Project Schedule's FTE/Max-Availability histogram (`resCapacity`) now reads
  each resource's own calendar for working-day math instead of a hardcoded
  5-day week — see that module's CLAUDE.md.

## Modal UI polish (2026-07-06)
User shared screenshots showing the Add Resource/Role/Calendar modal titles cramped right up
against the × close button instead of spread across the header. Root cause: `.pd-modal-header`
/`.pd-modal-close`/`.pd-modal-footer` had **no CSS anywhere** — not in this module, not in
`cash-flow` or `project-schedule` (which use the identical markup), not in the shared
`assets/css/dashboard.css`. Fixed at the shared level (`dashboard.css`) so all three modals get
it for free: header is now flex/space-between with a bottom border, close button is a proper
hover-able square, footer buttons are right-aligned with a top border (using negative margins
so modals that dump raw HTML straight into `.pd-modal` without this header/footer wrapper keep
their existing padding untouched).
- **Add Resource** form grouped into sections (Identification / Classification / Availability &
  Calendar / Notes) instead of one flat 8-field grid.
- **Calendar dropdown now defaults to the project's default calendar** for new resources
  (`calOptions` falls back to the `is_default` calendar when nothing is selected yet) — every
  new resource used to default to "—" (no calendar), requiring a manual pick every time.
- **Add Calendar** form: the long inline label ("Extra holidays (movable/proclaimed — one
  YYYY-MM-DD per line, e.g. Eid'l Fitr)") split into a short section header + field label +
  a proper hint paragraph below, added `sec()`/`hint()` helpers for this.
- Verified in a stubbed harness: confirmed `.pd-modal-header` computes to `display:flex` (was
  `block`), footer is `flex`/`flex-end`, new-resource Calendar select pre-selects "Philippine
  Standard (6-day, 8h) (Default)", and the Add Calendar form's old verbose label is gone.

## Built — Loading view + usability polish + cost roll-up (2026-07-21)
User asked to improve the module (chose: Loading view + usability polish + cost roll-up).
- **Resource Loading view (4th tab, the module's namesake).** Reads `resource_assignments`
  (lazy, on first visit) + the assigned activities' `project_schedule` dates and renders a
  **resources × months utilization matrix**. Each assignment's budgeted units/cost are
  **time-phased** across its activity's date range, weighted by working days from the resource's
  calendar (`PDCal`); a cell's **utilization = allocated ÷ (Max Units/Time% × working capacity)**
  (capacity = maxpct × working days × hours/day for hour-UoM resources, × days otherwise). Cells
  color green ≤85% / amber ≤100% / **red > 100%**; a resource with any month > 100% gets an OVER
  tag. Display modes **Utilization % / Units / Cost** (+ totals row for units/cost — utilization
  doesn't sum across resources), an **over-allocated-only** filter, and an empty state pointing to
  Project Schedule's Resource Assignments. Units on dateless activities are counted in totals only
  (noted in-view).
- **Usability polish.** Per-tab **KPI cards** (Resources/Roles/Calendars/Avg-max-availability on
  the master tabs; Assigned/Units/Cost/Over-allocated on Loading). **Filter bar** (suite funnel
  pattern): Type + Role on Resources, Discipline on Roles. **"# Resources" count** column on Roles
  and Calendars. **Delete guards** (the FKs have no ON DELETE, so an in-use delete would fail with
  a raw PG error): a calendar in use is **blocked** with a reassign message; a resource with
  assignments is **blocked** (server-side `count` head query — assignments aren't loaded on master
  tabs); deleting a role warns it leaves the primary-role text on N resources. **Duplicate
  resource-code** is blocked on save (case-insensitive, within the project).
- **Cost roll-up.** A role's Price/Unit **cascades** to a resource's rate when picking that role
  with no rate set; total budgeted resource **cost KPI** + a **Cost** matrix mode (uses
  `budgeted_cost`, falling back to units × resource rate).
- **No DB change** — reuses `resources`/`resource_roles`/`calendars`/`resource_assignments` and
  `project_schedule` as-is. Module-local only → **no `?v=` bump**.
- **Verified in a stubbed harness** (real module code + real ui.js/PDCal, in-memory Supabase stub
  seeded with 2 resources / 2 roles / 1 calendar / 3 assignments / 2 dated activities): matrix
  spread hand-checked exact (Carpenter Mar 2,449 / Apr 2,845.1 / May 305.9 = 5,600; footer + KPI
  totals 6,000 units / ₱2.98M; both crews flagged OVER with the right utilization %), Units/Cost/
  Utilization modes + totals + over-only, KPIs (avg availability 75%), Type filter (Nonlabor → "No
  resources match", Labor → 2), role→rate cascade (Carpenter → 550), dup-code blocked (no row
  inserted), calendar delete blocked before confirm with "2 resource(s) use this calendar". No
  console errors. Screenshots still impossible in this env — checks are DOM/JS-based.

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`, etc.)
