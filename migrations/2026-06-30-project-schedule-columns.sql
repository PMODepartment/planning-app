-- Migration: Project Schedule — extended columns
-- Run this in the Supabase SQL editor (or the consolidated setup SQL).
-- Safe to run multiple times (uses IF NOT EXISTS / ALTER ... ADD COLUMN IF NOT EXISTS).

-- Add fields missing from the initial project_schedule table:
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS actual_start       date;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS actual_finish      date;
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS activity_type      text    DEFAULT 'Task';
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS status             text    DEFAULT 'Not Started';
ALTER TABLE project_schedule ADD COLUMN IF NOT EXISTS responsible_party  text;

-- Refresh updated_at trigger if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_project_schedule'
  ) THEN
    CREATE TRIGGER set_updated_at_project_schedule
      BEFORE UPDATE ON project_schedule
      FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
  END IF;
EXCEPTION WHEN others THEN NULL;
END;
$$;
