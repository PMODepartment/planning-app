-- Activity Details: Notebook (multi-topic notes) + Files (linked documents).
-- Both are per-activity JSON arrays on project_schedule. Safe to re-run.
--   notebook: [{ "topic": "...", "text": "..." }, ...]
--   files:    [{ "name": "...", "url":  "https://..." }, ...]
-- Run once in the Supabase SQL editor. The UI degrades gracefully until then
-- (tabs render, saving shows a "run the migration" hint).
ALTER TABLE public.project_schedule ADD COLUMN IF NOT EXISTS notebook jsonb;
ALTER TABLE public.project_schedule ADD COLUMN IF NOT EXISTS files    jsonb;
