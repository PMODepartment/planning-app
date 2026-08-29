-- Progress Photos — Trade/Works become multi-select (2026-08-29 feedback item 2)
-- ------------------------------------------------------------------------------
-- "Trades can also be multiple" — a photo can now carry several trades and
-- several works values at once. The existing singular `trade`/`works` text
-- columns are kept, deprecated: they hold the FIRST-selected value as a
-- display-cache fallback for any older code path that still reads them (the
-- same "kept in step, never re-derived from the array" convention already
-- used elsewhere in this module for `location` / `ppr_slides`' legacy
-- trade/works/location / `wbs_node_id`).
--
-- Idempotent; folded into supabase-schema.sql.

alter table progress_photos add column if not exists trades text[] default '{}'::text[];
alter table progress_photos add column if not exists works_multi text[] default '{}'::text[];

comment on column progress_photos.trade is 'Deprecated: first-selected value only. See trades (text[]).';
comment on column progress_photos.works is 'Deprecated: first-selected value only. See works_multi (text[]).';
