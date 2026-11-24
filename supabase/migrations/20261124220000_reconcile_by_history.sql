-- Automatic reconciliation by the provider's own request history. ADDITIVE: the same read-only list, with what a match
-- needs (why it is unknown, when it ended, and the request ids that already belong to other calls around it).
-- Rollback: restore list_unreconciled_calls of 20261120000100 and server_boundary_version() 20261124210000.
begin;
create or replace function private.list_unreconciled_calls(p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'job_id',c.job_id,'provider',c.provider,'model',c.model,
    'attempt_key',c.attempt_key,'provider_request_id',c.provider_request_id,'status',c.status,'started_at',c.started_at,
    'finished_at',c.finished_at,'error_code',c.error_code,'environment',c.environment,
    -- Requests already accounted for: one history row is never used for two calls.
    'taken',coalesce((select jsonb_agg(coalesce(o.provider_request_id,o.provider_report->>'request_id')) from private.provider_calls o where o.provider=c.provider and o.id<>c.id
      and coalesce(o.provider_request_id,o.provider_report->>'request_id') is not null and o.started_at between c.started_at-interval '15 minutes' and c.started_at+interval '15 minutes'),'[]'::jsonb),
    -- Another unidentified call of the same model around it: a row could belong to either.
    'rivals',(select count(*) from private.provider_calls o where o.provider=c.provider and o.model=c.model and o.id<>c.id and o.provider_request_id is null
      and o.status in ('dispatched','unknown') and o.started_at between c.started_at-interval '5 minutes' and c.started_at+interval '5 minutes'))),'[]'::jsonb)
  from (select * from private.provider_calls where status in ('dispatched','unknown')
    and started_at<clock_timestamp()-interval '30 seconds' order by created_at limit least(greatest(p_limit,1),100)) c;
$$;
create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261124220000'::text $$;
commit;
