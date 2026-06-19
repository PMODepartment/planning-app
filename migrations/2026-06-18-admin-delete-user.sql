-- ============================================================================
-- Feature: admin "Delete user completely". Run in the Supabase SQL editor.
-- Idempotent.
--
-- Deletes the auth.users row (which cascades to public.users), freeing the
-- email so the person can Request Access again later. Authorship (created_by)
-- on their data rows is set to NULL first so foreign keys don't block deletion;
-- their data is kept. Guarded so only admins can call it, no self-delete, and
-- only a super_admin can delete a super_admin.
-- ============================================================================

create or replace function admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;
  if exists (select 1 from users where id = target and role = 'super_admin')
     and not exists (select 1 from users where id = auth.uid() and role = 'super_admin') then
    raise exception 'Only a super admin can delete a super admin';
  end if;

  -- Keep their data, drop their authorship link (avoids FK restrict on delete).
  for r in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'created_by'
  loop
    execute format('update public.%I set created_by = null where created_by = %L', r.table_name, target);
  end loop;

  -- Removing the auth user cascades to public.users (FK on delete cascade).
  delete from auth.users where id = target;
end $$;

grant execute on function admin_delete_user(uuid) to authenticated;
