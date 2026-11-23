-- Supervised real try-on pilot: persistent TOTAL ceiling (USD micros + attempts) over the existing
-- private.provider_calls ledger. Never renewed by day, restart or re-queue; concurrency 1; uncertain
-- outcomes pause new dispatches until reconciled; restricted to allowed account and pilot catalog.
begin;

create table private.ai_pilots (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  provider text not null check (provider in ('anthropic','gemini','segmind')),
  model text not null check (length(model) between 1 and 128),
  mode text not null check (mode in ('real','simulated')),
  limit_usd_micros bigint not null check (limit_usd_micros between 1 and 1000000000000),
  max_attempts integer not null check (max_attempts between 1 and 1000),
  allowed_user_id uuid not null references auth.users(id),
  allowed_source text not null check (length(allowed_source) between 1 and 64),
  allowed_seller text not null check (length(allowed_seller) between 1 and 128),
  authorization_note text not null check (length(authorization_note) between 1 and 500),
  active_since timestamptz not null default now(),
  paused_at timestamptz,
  paused_reason text check (paused_reason is null or length(paused_reason) between 1 and 200),
  created_at timestamptz not null default now()
);

create table private.ai_pilot_dispatches (
  pilot_id text not null references private.ai_pilots(id),
  provider_call_id uuid primary key references private.provider_calls(id),
  job_id uuid not null references private.ai_jobs(id),
  user_id uuid not null,
  attempt_no integer not null check (attempt_no >= 1),
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  usable boolean,
  usable_note text check (usable_note is null or length(usable_note) <= 300),
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pilot_id, attempt_no)
);
create index ai_pilot_dispatches_pilot on private.ai_pilot_dispatches(pilot_id, created_at);

alter table private.ai_pilots enable row level security;
alter table private.ai_pilot_dispatches enable row level security;
revoke all on private.ai_pilots, private.ai_pilot_dispatches from public, anon, authenticated, service_role;
grant select on private.ai_pilots, private.ai_pilot_dispatches to service_role;

-- Worker gate placed between reserve_provider_call and begin_provider_call.
-- Fixed lock order: ai_pilots -> provider_calls -> ai_jobs -> ai_pilot_dispatches.
-- On any refusal of a reserved call, releases the provider_calls reservation so no budget is leaked.
create function private.reserve_pilot_dispatch(
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

  -- Determine refusal reason (if any).
  if pilot.paused_at is not null then
    reason := 'pilot_paused';
  elsif p_mode is distinct from pilot.mode then
    reason := 'mode_mismatch';
  elsif c.provider is distinct from pilot.provider or c.model is distinct from pilot.model then
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

-- Sanitized pilot status: spend, reserves, attempts, usable count and blocking reason (no secrets or URLs).
create function private.pilot_status(p_pilot text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pilot private.ai_pilots%rowtype;
declare agg record;
declare dispatches jsonb;
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
    'dispatches', dispatches
  );
end $$;

-- Operator-only controls (never granted to stylai_api, stylai_ai_worker, anon or authenticated).
create function private.pause_pilot(p_pilot text, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.ai_pilots set paused_at = coalesce(paused_at, clock_timestamp()), paused_reason = left(coalesce(nullif(trim(p_reason), ''), 'operator_paused'), 200)
  where id = p_pilot;
  return found;
end $$;

create function private.resume_pilot(p_pilot text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.ai_pilots set paused_at = null, paused_reason = null where id = p_pilot;
  return found;
end $$;

create function private.mark_pilot_dispatch_usable(p_pilot text, p_call uuid, p_usable boolean, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.ai_pilot_dispatches set usable = p_usable, usable_note = left(p_note, 300), marked_at = clock_timestamp()
  where pilot_id = p_pilot and provider_call_id = p_call;
  return found;
end $$;

-- Releases ONLY a call that never reached begin_provider_call (status = 'reserved').
-- A dispatched or unknown call can never be released as unsent.
create function private.release_unsent_pilot_call(p_pilot text, p_call uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.ai_pilot_dispatches where pilot_id = p_pilot and provider_call_id = p_call) then
    return false;
  end if;
  return private.settle_provider_call(p_call, 'released', null, '{}'::jsonb, '{}'::jsonb, null, null, null, 'rejected_before_run', 0, left(coalesce(nullif(trim(p_reason), ''), 'operator_released'), 64));
end $$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261121235500'::text $$;

revoke all on function private.reserve_pilot_dispatch(text,uuid,bigint,text,jsonb),
  private.pilot_status(text),
  private.pause_pilot(text,text),
  private.resume_pilot(text),
  private.mark_pilot_dispatch_usable(text,uuid,boolean,text),
  private.release_unsent_pilot_call(text,uuid,text)
  from public, anon, authenticated, service_role;

grant execute on function private.reserve_pilot_dispatch(text,uuid,bigint,text,jsonb),
  private.pilot_status(text) to stylai_ai_worker;
grant execute on function private.pilot_status(text),
  private.pause_pilot(text,text),
  private.resume_pilot(text),
  private.mark_pilot_dispatch_usable(text,uuid,boolean,text),
  private.release_unsent_pilot_call(text,uuid,text) to service_role;

commit;
