-- ============================================================================
-- Migration: Storage buckets + policies for modules that upload files.
-- Run in the Supabase SQL editor. Idempotent.
--
-- One PRIVATE bucket per module key. Private = files are only reachable via a
-- short-lived signed URL (createSignedUrl), so drawings/photos aren't public.
-- Approved users may read/upload; admins may delete. Tighten later if needed.
-- ============================================================================

-- Create buckets (private) for the file-bearing Phase-1 modules.
insert into storage.buckets (id, name, public) values
  ('drawing-register',   'drawing-register',   false),
  ('progress-photos',    'progress-photos',    false),
  ('material-submittal', 'material-submittal', false)
on conflict (id) do nothing;

-- Policy template applied to each bucket.
do $$
declare b text;
begin
  foreach b in array array['drawing-register','progress-photos','material-submittal'] loop
    execute format('drop policy if exists %I on storage.objects', b||'_read');
    execute format('create policy %I on storage.objects for select using (bucket_id = %L and is_approved())', b||'_read', b);

    execute format('drop policy if exists %I on storage.objects', b||'_ins');
    execute format('create policy %I on storage.objects for insert with check (bucket_id = %L and is_approved())', b||'_ins', b);

    execute format('drop policy if exists %I on storage.objects', b||'_del');
    execute format('create policy %I on storage.objects for delete using (bucket_id = %L and (owner = auth.uid() or is_admin()))', b||'_del', b);
  end loop;
end $$;
