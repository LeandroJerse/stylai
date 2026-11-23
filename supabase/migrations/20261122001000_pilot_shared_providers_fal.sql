-- Multi-provider shared pilot budget & 'fal' provider support over existing private.provider_calls.
-- Preserves all existing records and counters; never resets limits across days, restarts or provider switches.
begin;

-- 1. Expand provider allowlists on existing ledger tables without recreating tables or losing data.
do $$
declare r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in (
        'private.provider_calls'::regclass,
        'private.provider_credit_topups'::regclass,
        'private.ai_pilots'::regclass
      )
      and pg_get_constraintdef(oid) ~ 'provider\s*=\s*ANY|provider\s+IN'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table private.provider_calls
  add constraint provider_calls_provider_check check (provider in ('anthropic','gemini','segmind','fal'));

alter table private.provider_credit_topups
  add constraint provider_credit_topups_provider_check check (provider in ('anthropic','gemini','segmind','fal'));

alter table private.ai_pilots
  add constraint ai_pilots_provider_check check (provider in ('anthropic','gemini','segmind','fal','any'));

alter table private.ai_pilots
  add column if not exists allowed_targets jsonb
  check (allowed_targets is null or jsonb_typeof(allowed_targets) = 'array');

-- 2. Update pilot dispatch gate: share TOTAL ceiling/attempts/in-flight/uncertain lock across all allowed targets.
create or replace function private.reserve_pilot_dispatch(
  p_pilot text, p_call uuid, p_fence bigint, p_mode text, p_params jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pilot private.ai_pilots%rowtype;
declare c private.provider_calls%rowtype;
declare j private.ai_jobs%rowtype;
declare existing private.ai_pilot_dispatches%rowtype;
declare agg record;
declare next_no integer;
declare reason text;
declare target_allowed boolean;
begin
  select * into pilot from private.ai_pilots where id = p_pilot for update;
  select * into c from private.provider_calls where id = p_call for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'call_not_found');
  end if;
  if pilot.id is null then
    if c.status = 'reserved' then
      perform private.settle_provider_call(p_call, 'released', null, '{}'::jsonb, '{}'::jsonb, null, null, null, 'rejected_before_run', 0, 'pilot_not_found');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'pilot_not_found');
  end if;

  -- Idempotent replay for the exact same provider_call_id.
  select * into existing from private.ai_pilot_dispatches where provider_call_id = p_call and pilot_id = p_pilot;
  if found then
    return jsonb_build_object('ok', true, 'attempt_no', existing.attempt_no, 'replayed', true);
  end if;

  if c.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'reason', 'call_not_reserved');
  end if;
  select * into j from private.ai_jobs where id = c.job_id and status = 'running' and fence = p_fence and lease_until > clock_timestamp() for share;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'job_lease_unavailable');
  end if;

  if pilot.allowed_targets is not null then
    select exists(
      select 1
      from jsonb_array_elements(pilot.allowed_targets) t
      where t->>'provider' = c.provider and t->>'model' = c.model
    ) into target_allowed;
  else
    target_allowed := (c.provider = pilot.provider and c.model = pilot.model);
  end if;

  if pilot.paused_at is not null then
    reason := 'pilot_paused';
  elsif p_mode is distinct from pilot.mode then
    reason := 'mode_mismatch';
  elsif not target_allowed then
    reason := 'provider_mismatch';
  elsif j.user_id is distinct from pilot.allowed_user_id then
    reason := 'user_not_allowed';
  elsif j.created_at < pilot.active_since then
    reason := 'job_predates_pilot';
  elsif not exists (
    select 1
    from private.ai_job_selection s
    join public.products p on p.id = s.product_id
    join public.partners pa on pa.id = p.partner_id
    where s.job_id = j.id
      and pa.source = pilot.allowed_source
      and pa.external_seller_id = pilot.allowed_seller
  ) then
    reason := 'item_not_allowed';
  else
    select
      count(*) filter (where pc.status <> 'released')::integer as attempts_used,
      count(*) filter (where pc.status = 'unknown')::integer as uncertain_count,
      count(*) filter (where pc.status in ('reserved','dispatched'))::integer as in_flight,
      coalesce(sum(pc.settled_usd_micros) filter (where pc.status in ('succeeded','failed')), 0)::bigint as spent_usd_micros,
      coalesce(sum(pc.reserved_usd_micros) filter (where pc.status in ('reserved','dispatched','unknown')), 0)::bigint as reserved_usd_micros,
      coalesce(max(d.attempt_no), 0)::integer as max_no
    into agg
    from private.ai_pilot_dispatches d
    join private.provider_calls pc on pc.id = d.provider_call_id
    where d.pilot_id = p_pilot;

    if agg.uncertain_count > 0 then
      reason := 'uncertain_outcome';
    elsif agg.in_flight > 0 then
      reason := 'in_flight';
    elsif agg.attempts_used >= pilot.max_attempts then
      reason := 'max_attempts_reached';
    elsif agg.spent_usd_micros + agg.reserved_usd_micros + c.reserved_usd_micros > pilot.limit_usd_micros then
      reason := 'budget_exhausted';
    end if;
  end if;

  if reason is not null then
    perform private.settle_provider_call(p_call, 'released', null, '{}'::jsonb, '{}'::jsonb, null, null, null, 'rejected_before_run', 0, left('pilot_' || reason, 64));
    return jsonb_build_object('ok', false, 'reason', reason);
  end if;

  next_no := agg.max_no + 1;
  insert into private.ai_pilot_dispatches(pilot_id, provider_call_id, job_id, user_id, attempt_no, params)
  values (p_pilot, p_call, j.id, j.user_id, next_no, coalesce(p_params, '{}'::jsonb));

  return jsonb_build_object('ok', true, 'attempt_no', next_no, 'replayed', false);
end $$;

-- 3. Update sanitized status report with allowed_targets and per-provider/model breakdown.
create or replace function private.pilot_status(p_pilot text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pilot private.ai_pilots%rowtype;
declare agg record;
declare dispatches jsonb;
declare by_provider jsonb;
declare blocked text;
begin
  select * into pilot from private.ai_pilots where id = p_pilot;
  if not found then return null; end if;

  select
    count(*) filter (where pc.status <> 'released')::integer as attempts_used,
    count(*) filter (where pc.status = 'succeeded')::integer as succeeded_count,
    count(*) filter (where pc.status = 'failed')::integer as failed_count,
    count(*) filter (where pc.status = 'unknown')::integer as uncertain_count,
    count(*) filter (where pc.status in ('reserved','dispatched'))::integer as in_flight,
    count(*) filter (where pc.status = 'released')::integer as released_count,
    count(*) filter (where d.usable is true)::integer as usable_count,
    coalesce(sum(pc.settled_usd_micros) filter (where pc.status in ('succeeded','failed')), 0)::bigint as spent_usd_micros,
    coalesce(sum(pc.confirmed_usd_micros) filter (where pc.status in ('succeeded','failed') and pc.confirmed_usd_micros is not null), 0)::bigint as confirmed_usd_micros,
    coalesce(sum(pc.computed_usd_micros) filter (where pc.status in ('succeeded','failed') and pc.computed_usd_micros is not null), 0)::bigint as computed_usd_micros,
    coalesce(sum(pc.reserved_usd_micros) filter (where pc.status in ('reserved','dispatched','unknown')), 0)::bigint as reserved_usd_micros
  into agg
  from private.ai_pilot_dispatches d
  join private.provider_calls pc on pc.id = d.provider_call_id
  where d.pilot_id = p_pilot;

  blocked := case
    when pilot.paused_at is not null then 'pilot_paused'
    when agg.uncertain_count > 0 then 'uncertain_outcome'
    when agg.in_flight > 0 then 'in_flight'
    when agg.attempts_used >= pilot.max_attempts then 'max_attempts_reached'
    when agg.spent_usd_micros + agg.reserved_usd_micros >= pilot.limit_usd_micros then 'budget_exhausted'
    else null
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'provider', g.provider,
    'model', g.model,
    'attempts_used', g.attempts_used,
    'succeeded_count', g.succeeded_count,
    'failed_count', g.failed_count,
    'uncertain_count', g.uncertain_count,
    'in_flight', g.in_flight,
    'spent_usd_micros', g.spent_usd_micros,
    'reserved_usd_micros', g.reserved_usd_micros
  ) order by g.provider, g.model), '[]'::jsonb)
  into by_provider
  from (
    select
      pc.provider,
      pc.model,
      count(*) filter (where pc.status <> 'released')::integer as attempts_used,
      count(*) filter (where pc.status = 'succeeded')::integer as succeeded_count,
      count(*) filter (where pc.status = 'failed')::integer as failed_count,
      count(*) filter (where pc.status = 'unknown')::integer as uncertain_count,
      count(*) filter (where pc.status in ('reserved','dispatched'))::integer as in_flight,
      coalesce(sum(pc.settled_usd_micros) filter (where pc.status in ('succeeded','failed')), 0)::bigint as spent_usd_micros,
      coalesce(sum(pc.reserved_usd_micros) filter (where pc.status in ('reserved','dispatched','unknown')), 0)::bigint as reserved_usd_micros
    from private.ai_pilot_dispatches d
    join private.provider_calls pc on pc.id = d.provider_call_id
    where d.pilot_id = p_pilot
    group by pc.provider, pc.model
  ) g;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attempt_no', d.attempt_no,
    'provider_call_id', d.provider_call_id,
    'job_id', d.job_id,
    'status', pc.status,
    'provider', pc.provider,
    'model', pc.model,
    'price_version', pc.price_version,
    'provider_request_id', pc.provider_request_id,
    'reserved_usd_micros', pc.reserved_usd_micros,
    'computed_usd_micros', pc.computed_usd_micros,
    'confirmed_usd_micros', pc.confirmed_usd_micros,
    'settled_usd_micros', pc.settled_usd_micros,
    'cost_source', pc.cost_source,
    'units', pc.units,
    'provider_report', pc.provider_report,
    'params', d.params,
    'latency_ms', pc.latency_ms,
    'error_code', pc.error_code,
    'usable', d.usable,
    'usable_note', d.usable_note,
    'created_at', pc.created_at,
    'finished_at', pc.finished_at
  ) order by d.attempt_no), '[]'::jsonb)
  into dispatches
  from private.ai_pilot_dispatches d
  join private.provider_calls pc on pc.id = d.provider_call_id
  where d.pilot_id = p_pilot;

  return jsonb_build_object(
    'id', pilot.id,
    'provider', pilot.provider,
    'model', pilot.model,
    'allowed_targets', coalesce(pilot.allowed_targets, jsonb_build_array(jsonb_build_object('provider', pilot.provider, 'model', pilot.model))),
    'mode', pilot.mode,
    'limit_usd_micros', pilot.limit_usd_micros,
    'max_attempts', pilot.max_attempts,
    'active_since', pilot.active_since,
    'paused', pilot.paused_at is not null,
    'paused_at', pilot.paused_at,
    'paused_reason', pilot.paused_reason,
    'attempts_used', agg.attempts_used,
    'attempts_remaining', greatest(pilot.max_attempts - agg.attempts_used, 0),
    'succeeded_count', agg.succeeded_count,
    'failed_count', agg.failed_count,
    'uncertain_count', agg.uncertain_count,
    'in_flight', agg.in_flight,
    'released_count', agg.released_count,
    'usable_count', agg.usable_count,
    'spent_usd_micros', agg.spent_usd_micros,
    'confirmed_usd_micros', agg.confirmed_usd_micros,
    'computed_usd_micros', agg.computed_usd_micros,
    'reserved_usd_micros', agg.reserved_usd_micros,
    'remaining_usd_micros', greatest(pilot.limit_usd_micros - agg.spent_usd_micros - agg.reserved_usd_micros, 0),
    'blocked_reason', blocked,
    'by_provider', by_provider,
    'dispatches', dispatches
  );
end $$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261122001000'::text $$;

commit;
