# Module: risk-register

Developer change log for the **risk-register** module. This is also the
**reference module** other developers copy. Update this every PR.

## Status
- [x] Schema table reviewed in `supabase-schema.sql` (`risk_register`)
- [x] CRUD implemented (add / edit / delete / list)
- [x] `enabled: true` set in `assets/js/config.js`

## What it does
- Project-scoped risk register (reads/writes `pd_project` shared context).
- **List view:** filterable table (status, category, search) with colored
  rating pills, KPIs (Total / Open / High / Medium).
- **Matrix view:** 5×5 Likelihood × Impact heat grid; click a cell to filter
  the register to that L×I combination.
- **Add/Edit modal:** full form; `rating` is **derived in the app**
  (`likelihood × impact`, 1–25) and shown live as the dropdowns change.
- Rating bands: Low 1–7 (green), Medium 8–14 (amber), High 15–25 (red).

## Patterns it demonstrates (for other modules)
- Shared `AppAuth.requireLogin` + `UI.renderUserBar`.
- Project picker bound to `sessionStorage['pd_project']`.
- All queries scoped `.eq('project_id', pid)`.
- `created_by = profile.id` stamped on insert (required by RLS).
- `Fmt.esc()` on every user value injected into HTML.
- A computed/derived field saved alongside raw inputs.

## Notes
- Uses the `risk_register` columns from `supabase-schema.sql` as-is; no schema
  changes were needed.
- No file uploads, so no Storage bucket for this module.
