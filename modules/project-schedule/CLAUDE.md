# Module: project-schedule

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Project Schedule & Cost Loading** (Phase 2). Your DB table is `project_schedule`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; add a Gantt/cost-loading table as needed)**.
> 4. Work only inside this folder, on branch `module/project-schedule`, then PR to `main`.
> 5. Update this file as you build.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from scratch (Primavera Cloud reference, not a module copy)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] Run DB migration (see below)
- [ ] PR opened into `main`

## Schema additions (2026-06-30)

Run `../.