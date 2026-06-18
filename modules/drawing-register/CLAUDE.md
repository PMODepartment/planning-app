# Module: drawing-register

Developer change log for the **drawing-register** module. Also the **reference
module for file uploads** — copy this pattern for Progress Photos and Material
Submittal. Update this every PR.

## Status
- [x] Schema table reviewed in `supabase-schema.sql` (`drawing_register`)
- [x] CRUD implemented (add / edit / delete / list)
- [x] `enabled: true` set in `assets/js/config.js`

## What it does
- Project-scoped drawing register (reads/writes `pd_project`).
- Filterable table: status (For Review / Approved / Superseded), discipline,
  search. Colored status pills, revision tracking, issue/due dates.
- Add/Edit modal with a **file upload** (PDF / DWG / DXF / image).
- "View" opens the file via a short-lived **signed URL** (private bucket).

## File-upload pattern (the reusable part)
- Bucket: **private** `drawing-register` (see
  `migrations/2026-06-18-storage-buckets.sql` — run it once in Supabase).
- Upload: `sb().storage.from(BUCKET).upload(path, file)` where
  `path = '<project_id>/<timestamp>_<safe-filename>'`. Store **only the path**
  in the table's `file_url` column — never a public URL.
- View: `sb().storage.from(BUCKET).createSignedUrl(path, 60)` → open in a tab.
- Delete: remove the storage object, then the row.

## Notes
- Uses `drawing_register` columns from `supabase-schema.sql` as-is.
- Requires both migrations run: project-access RLS + storage buckets.
