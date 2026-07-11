-- ============================================================================
-- Migration: Portfolio resource demand — server-side aggregation RPC (2026-07-11)
-- resource_assignments can be 27k+ rows for a SINGLE project, so a portfolio-scale
-- client fetch is unsafe. This RPC aggregates on the server (GROUP BY) and returns
-- one compact row per resource identity across the requested projects.
-- security invoker → the caller's RLS applies (resource_assignments read = is_approved),
-- matching the portfolio's RLS-scoped model. Run in the Supabase SQL editor. Idempotent.
-- ============================================================================

create or replace function portfolio_resource_summary(p_ids text[])
returns table (
  resource_name  text,
  resource_type  text,
  uom            text,
  projects       bigint,
  assignments    bigint,
  budgeted_units numeric,
  actual_units   numeric,
  remaining_units numeric,
  budgeted_cost  numeric,
  actual_cost    numeric
)
language sql
stable
security invoker
as $$
  select
    coalesce(r.name, ra.resource_code, ra.role, 'Unassigned')     as resource_name,
    coalesce(r.type, 'Labor')                                     as resource_type,
    coalesce(ra.uom, 'hours')                                     as uom,
    count(distinct ra.project_id)                                 as projects,
    count(*)                                                      as assignments,
    coalesce(sum(ra.budgeted_units), 0)                           as budgeted_units,
    coalesce(sum(ra.actual_units), 0)                             as actual_units,
    coalesce(sum(ra.remaining_units), 0)                          as remaining_units,
    coalesce(sum(ra.budgeted_cost), 0)                            as budgeted_cost,
    coalesce(sum(ra.actual_cost), 0)                              as actual_cost
  from resource_assignments ra
  left join resources r on r.id = ra.resource_id
  where ra.project_id = any(p_ids)
  group by 1, 2, 3
  order by budgeted_cost desc nulls last, budgeted_units desc nulls last;
$$;

grant execute on function portfolio_resource_summary(text[]) to authenticated;
