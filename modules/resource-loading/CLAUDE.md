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

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`, etc.)
