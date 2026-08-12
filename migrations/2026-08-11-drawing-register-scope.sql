-- Drawing Register: Scope column (Main Contract / Change Order).
-- Idempotent. Existing rows default to 'Main Contract' (the common case; nothing
-- was previously tracked as a Change Order, so this is not a guess that could be wrong).

alter table drawing_register add column if not exists scope text not null default 'Main Contract';

-- Keep any legacy nulls (rows written before the column existed on an old cached
-- client) aligned with the default.
update drawing_register set scope = 'Main Contract' where scope is null;
