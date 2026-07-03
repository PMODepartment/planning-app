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

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`, etc.)
