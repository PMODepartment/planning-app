## Module
<!-- e.g. risk-register -->

## What changed
<!-- short summary -->

## Checklist (see MODULE_CONTRACT.md §8)
- [ ] Only my `modules/<key>/` folder changed (plus my table / enabled flag)
- [ ] Uses shared `AppAuth` / `PDb` / `Fmt` / `UI` (no custom auth)
- [ ] `Fmt.esc()` applied to all user-supplied text injected into HTML
- [ ] Rows stamp `created_by` and `project_id`
- [ ] Project-scoped via `pd_project`
- [ ] Works on desktop + mobile
- [ ] DB changes are idempotent in `supabase-schema.sql`
- [ ] `modules/<key>/CLAUDE.md` updated
