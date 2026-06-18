# Module: issues-lessons

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Issues, Concerns & Lessons Learned**. Your DB table is `issues_lessons`
>    (already defined in `../../supabase-schema.sql`).
> 3. Best reference to copy: **risk-register (plain CRUD, no file uploads)**.
> 4. Work only inside this folder, on branch `module/issues-lessons`, then PR to `main`.
> 5. Update this file as you build.

## Status
- [ ] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [ ] Copied a reference module as the starting point
- [ ] CRUD implemented (add / edit / view / list / delete)
- [ ] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [ ] `Fmt.esc()` on all user text injected into HTML
- [ ] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`

## Notes
(Record decisions, columns added via `alter table ... add column if not exists`,
storage buckets, etc.)
