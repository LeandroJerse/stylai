-- P04 (docs/qa/2026-11-23-piloto-segmind-achados.md): a multi-layer job reserves one provider call per layer, in
-- sequence. Without a pre-check, layer 1 can be PAID and layer 2 refused by the job/day/pilot budget (no version,
-- money spent). This read-only check runs before layer 1: the whole chain (layers x reserve) must fit every scope
-- (job, global day/month, provider day/month, user day) and the pilot's remaining money/attempts. ADDITIVE:
-- no limit, reserve or pilot counter is changed. Rollback: drop the function and restore boundary 20261123210932.
begin;

create function private.check_layer_budget(p_job uuid, p_fence bigint, p_provider text, p_layers integer,
  p_reserve bigint, p_pilot text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare d date := (statement_timestamp() at time zone 'UTC')::date;
declare m date := date_trunc('month',(statement_timestamp() at time zone 'UTC'))::date;
declare needed bigint;
declare s record;
declare lim private.provider_budget_limits%rowtype;
declare used bigint;
declare remaining bigint;
declare min_remaining bigint := null;
declare scopes jsonb := '[]'::jsonb;
declare limiting jsonb := '[]'::jsonb;
declare pilot private.ai_pilots%rowtype;
declare pilot_used bigint;
declare pilot_attempts integer;
declare pilot_json jsonb := null;
begin
  if p_layers is null or p_layers not between 1 and 3 or p_reserve is null or p_reserve not between 1 and 1000000000000 then
    raise exception 'invalid layer budget request' using errcode='23514';
  end if;
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp();
  if not found then raise exception 'job lease unavailable' using errcode='42501'; end if;
  needed := p_layers::bigint * p_reserve;
  for s in select * from (values
      (1,'global','*','day',d),(2,'global','*','month',m),
      (3,'provider',p_provider,'day',d),(4,'provider',p_provider,'month',m),
      (5,'user',job.user_id::text,'day',d),(6,'job',p_job::text,'job',date '1970-01-01')) as t(ord,scope,scope_key,period,period_start)
    order by ord loop
    select * into lim from private.provider_budget_limits l where l.scope=s.scope and l.period=s.period and l.scope_key in (s.scope_key,'*')
      order by (l.scope_key='*') limit 1;
    if not found then
      limiting := limiting || to_jsonb(s.scope); continue;   -- unconfigured scope: reserve_provider_call would refuse too
    end if;
    select coalesce(sum(u.reserved_usd_micros+u.spent_usd_micros),0) into used from private.provider_budget_usage u
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start;
    remaining := case when lim.paused then 0 else greatest(lim.limit_usd_micros-used,0) end;
    min_remaining := least(coalesce(min_remaining,remaining),remaining);
    scopes := scopes || jsonb_build_object('scope',s.scope,'period',s.period,'limit_usd_micros',lim.limit_usd_micros,
      'used_usd_micros',used,'remaining_usd_micros',remaining,'paused',lim.paused);
    if remaining < needed and not (limiting ? s.scope) then limiting := limiting || to_jsonb(s.scope); end if;
  end loop;
  if p_pilot is not null then
    select * into pilot from private.ai_pilots where id=p_pilot;
    if not found then
      limiting := limiting || '"pilot_missing"'::jsonb;
    else
      select coalesce(sum(case when c.status in ('succeeded','failed') then coalesce(c.settled_usd_micros,0) else c.reserved_usd_micros end),0),
             count(*) into pilot_used, pilot_attempts
        from private.ai_pilot_dispatches pd join private.provider_calls c on c.id=pd.provider_call_id
        where pd.pilot_id=p_pilot and c.status<>'released';
      pilot_json := jsonb_build_object('limit_usd_micros',pilot.limit_usd_micros,'used_usd_micros',pilot_used,
        'remaining_usd_micros',greatest(pilot.limit_usd_micros-pilot_used,0),'max_attempts',pilot.max_attempts,
        'remaining_attempts',greatest(pilot.max_attempts-pilot_attempts,0),'paused',pilot.paused_at is not null);
      min_remaining := least(coalesce(min_remaining,greatest(pilot.limit_usd_micros-pilot_used,0)),greatest(pilot.limit_usd_micros-pilot_used,0));
      if pilot.paused_at is not null then limiting := limiting || '"pilot_paused"'::jsonb; end if;
      if greatest(pilot.limit_usd_micros-pilot_used,0) < needed then limiting := limiting || '"pilot_budget"'::jsonb; end if;
      if pilot.max_attempts-pilot_attempts < p_layers then limiting := limiting || '"pilot_attempts"'::jsonb; end if;
    end if;
  end if;
  return jsonb_build_object('ok',jsonb_array_length(limiting)=0,'layers',p_layers,'reserve_usd_micros',p_reserve,
    'needed_usd_micros',needed,'effective_ceiling_usd_micros',coalesce(min_remaining,0),
    'max_layers',least(3,coalesce(min_remaining,0)/p_reserve,
      coalesce((pilot_json->>'remaining_attempts')::bigint,3)),
    'limiting',limiting,'scopes',scopes,'pilot',pilot_json);
end $$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261123231214'::text $$;

revoke all on function private.check_layer_budget(uuid,bigint,text,integer,bigint,text) from public, anon, authenticated, service_role;
grant execute on function private.check_layer_budget(uuid,bigint,text,integer,bigint,text) to stylai_ai_worker;

commit;
