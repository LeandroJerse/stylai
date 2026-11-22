-- First engine slice: dress one curated garment, swap it, reopen the previous
-- version. Additive only. Money for provider spend is integer USD micros
-- (1 USD = 1_000_000). BRL is presentation/reconciliation evidence only.
begin;

-- Sources: SHEIN chosen by the owner as first live source (capabilities still
-- unverified); 'curated' marks a manually reviewed catalog, never a live feed.
alter table public.partners drop constraint partners_source_check;
alter table public.partners add constraint partners_source_check
  check (source in ('aliexpress','shopee','tiktok_shop','shein','curated'));
alter table private.source_connections drop constraint source_connections_source_check;
alter table private.source_connections add constraint source_connections_source_check
  check (source in ('aliexpress','shopee','tiktok_shop','shein','curated'));
-- Retailer page for the exact listing. Link verification is recorded separately.
alter table public.products add column product_url text check (product_url ~ '^https://[^[:space:]]+$');

-- Look lineage. A version exists only for a succeeded job and is immutable.
create table private.looks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id,id)
);
create table private.look_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  look_id uuid not null,
  version integer not null check (version > 0),
  parent_version_id uuid references private.look_versions(id) on delete set null,
  job_id uuid not null unique,
  asset_id uuid not null,
  product_id uuid not null,
  variant_id uuid not null,
  -- Frozen at generation time: product/variant/price/link/image used.
  selection_snapshot jsonb not null check (jsonb_typeof(selection_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (look_id,version),
  unique (user_id,id),
  foreign key (user_id,look_id) references private.looks(user_id,id) on delete cascade,
  foreign key (user_id,job_id) references private.ai_jobs(user_id,id) on delete cascade,
  foreign key (user_id,asset_id) references private.assets(user_id,id) on delete cascade
);
create index look_versions_by_look on private.look_versions(user_id,look_id,version);

alter table private.ai_jobs
  add column parent_version_id uuid references private.look_versions(id) on delete set null,
  add column lineage_bound boolean not null default false,
  add column failure_code text check (failure_code ~ '^[a-z][a-z0-9_]{0,63}$');

-- Provider spend ledger (USD micros). Limits are configuration; usage rows are
-- counters per period. A missing limit means no paid dispatch.
create table private.provider_budget_limits (
  scope text not null check (scope in ('global','provider','user','job')),
  scope_key text not null check (length(scope_key) between 1 and 64), -- '*' = default for the scope
  period text not null check (period in ('day','month','job')),
  limit_usd_micros bigint not null check (limit_usd_micros between 0 and 1000000000000),
  paused boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (scope,scope_key,period),
  check ((scope = 'job') = (period = 'job'))
);
create table private.provider_budget_usage (
  scope text not null,
  scope_key text not null,
  period text not null,
  period_start date not null,
  reserved_usd_micros bigint not null default 0 check (reserved_usd_micros >= 0),
  spent_usd_micros bigint not null default 0 check (spent_usd_micros >= 0),
  primary key (scope,scope_key,period,period_start)
);

create table private.provider_calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references private.ai_jobs(id) on delete set null,
  user_id uuid,                -- budget key; minimized record kept for reconciliation
  user_ref text not null check (user_ref ~ '^u_[0-9a-f]{16,64}$'), -- HMAC pseudonym for telemetry
  look_version_id uuid references private.look_versions(id) on delete set null,
  provider text not null check (provider in ('anthropic','gemini','segmind')),
  model text not null check (length(model) between 1 and 128),
  price_version text not null check (length(price_version) between 1 and 64),
  operation text not null check (operation in ('interpretation','embedding','search','generation')),
  attempt_key text not null check (attempt_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  environment text not null check (environment in ('development','test','staging','production')),
  status text not null default 'reserved'
    check (status in ('reserved','dispatched','succeeded','failed','unknown','released')),
  provider_request_id text check (length(provider_request_id) <= 200),
  reserved_usd_micros bigint not null check (reserved_usd_micros between 1 and 1000000000000),
  estimated_usd_micros bigint check (estimated_usd_micros >= 0),
  computed_usd_micros bigint check (computed_usd_micros >= 0),
  confirmed_usd_micros bigint check (confirmed_usd_micros >= 0),
  cost_source text not null default 'unknown'
    check (cost_source in ('unknown','estimate','computed_from_usage','provider_reported','provider_confirmed','rejected_before_run')),
  settled_usd_micros bigint check (settled_usd_micros >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  units jsonb not null default '{}' check (jsonb_typeof(units) = 'object'),
  provider_report jsonb not null default '{}' check (jsonb_typeof(provider_report) = 'object'),
  error_code text check (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  budget_day date not null,
  budget_month date not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  latency_ms integer check (latency_ms >= 0),
  unique (job_id,operation,attempt_key),
  unique (attempt_key),
  check ((status in ('succeeded','failed','released')) = (settled_usd_micros is not null)),
  check (status not in ('dispatched','succeeded','failed','unknown') or started_at is not null)
);
create index provider_calls_by_job on private.provider_calls(job_id,created_at);
create index provider_calls_unknown on private.provider_calls(created_at) where status in ('dispatched','unknown');

-- Money paid to a provider and credits received. Never summed with consumption.
create table private.provider_credit_topups (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('anthropic','gemini','segmind')),
  paid_amount_minor bigint not null check (paid_amount_minor > 0),
  paid_currency text not null check (paid_currency ~ '^[A-Z]{3}$'),
  credited_usd_micros bigint not null check (credited_usd_micros >= 0),
  fx_rate numeric(18,8) check (fx_rate > 0),
  fx_source text,
  fx_date date,
  evidence_ref text,
  paid_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check ((fx_rate is null) = (fx_source is null) and (fx_rate is null) = (fx_date is null))
);

-- Durable telemetry outbox. 'unknown' (request may have reached Langfuse) is
-- never resent automatically: Langfuse does not deduplicate re-sent spans.
create table private.telemetry_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) between 1 and 200),
  job_id uuid references private.ai_jobs(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  state text not null default 'pending' check (state in ('pending','sending','sent','unknown','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index telemetry_outbox_ready on private.telemetry_outbox(next_attempt_at) where state in ('pending','sending');

do $$
declare t text;
begin
  foreach t in array array['looks','look_versions','provider_budget_limits','provider_budget_usage','provider_calls',
    'provider_credit_topups','telemetry_outbox'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role',t);
    execute format('grant select on private.%I to service_role',t);
  end loop;
end $$;

-- ---------------------------------------------------------------- API side

-- Category comes from the catalog row and the photo from the actor's own latest
-- ready body photo: neither is trusted from the client.
create function private.enqueue_look_job(p_user uuid,p_key text,p_hash text,p_policy text,
  p_product uuid,p_variant uuid,p_parent_version uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job uuid;
declare current private.ai_jobs%rowtype;
declare photo uuid;
declare category text;
declare variant uuid := p_variant;
begin
  if p_product is null then
    raise exception 'explicit catalog product required' using errcode='23514';
  end if;
  select * into current from private.ai_jobs where user_id=p_user and request_key=p_key;
  if found then
    if current.request_hash<>p_hash or current.parent_version_id is distinct from p_parent_version
       or current.requested_product_id is distinct from p_product
       or (p_variant is not null and current.requested_variant_id is distinct from p_variant) then
      raise exception 'request key conflict' using errcode='23505';
    end if;
    return current.id;
  end if;
  if p_parent_version is not null and not exists(select 1 from private.look_versions where id=p_parent_version and user_id=p_user) then
    raise exception 'parent version unavailable' using errcode='42501';
  end if;
  -- No variant given: only an unambiguous single available variant is accepted.
  if variant is null then
    select min(v.id::text)::uuid into variant from public.product_variants v where v.product_id=p_product and v.available is true
      having count(*)=1;
    if variant is null then raise exception 'variant choice required' using errcode='23514'; end if;
  end if;
  select p.category_id into category from public.products p join public.product_variants v on v.product_id=p.id
    where p.id=p_product and v.id=variant and p.published and p.rights_cleared and v.available is true;
  if category is null then raise exception 'catalog variant unavailable' using errcode='23514'; end if;
  select id into photo from private.assets where user_id=p_user and kind='body_photo' and state='ready' and expires_at>statement_timestamp()
    order by created_at desc,id limit 1;
  if photo is null then raise exception 'photo unavailable' using errcode='42501'; end if;
  job := private.enqueue_ai_job(p_user,p_key,p_hash,photo,category,p_policy,'',p_product,variant);
  select * into current from private.ai_jobs where id=job for update;
  if current.lineage_bound then
    if current.parent_version_id is distinct from p_parent_version then
      raise exception 'request key conflict' using errcode='23505';
    end if;
    return job;
  end if;
  update private.ai_jobs set parent_version_id=p_parent_version,lineage_bound=true where id=job;
  return job;
end $$;

create function private.read_ai_job(p_user uuid,p_job uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'status',j.status,'failure_code',j.failure_code,'created_at',j.created_at,
    'finished_at',j.finished_at,'parent_version_id',j.parent_version_id,
    'product_id',j.requested_product_id,'variant_id',j.requested_variant_id,
    'look_id',v.look_id,'version_id',v.id,'version',v.version)
  from private.ai_jobs j left join private.look_versions v on v.job_id=j.id
  where j.id=p_job and j.user_id=p_user;
$$;

create function private.read_look(p_user uuid,p_look uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',l.id,'created_at',l.created_at,'versions',coalesce((
    select jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'parent_version_id',v.parent_version_id,
      'job_id',v.job_id,'product_id',v.product_id,'variant_id',v.variant_id,'created_at',v.created_at,
      'selection_snapshot',v.selection_snapshot,
      'image_available',exists(select 1 from private.assets a where a.id=v.asset_id and a.state='ready'
        and (a.expires_at is null or a.expires_at>clock_timestamp()))) order by v.version)
    from private.look_versions v where v.look_id=l.id and v.user_id=p_user),'[]'::jsonb))
  from private.looks l where l.id=p_look and l.user_id=p_user;
$$;

create function private.list_looks(p_user uuid,p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) from (
    select l.created_at,jsonb_build_object('id',l.id,'created_at',l.created_at,
      'latest_version_id',(select v.id from private.look_versions v where v.look_id=l.id order by v.version desc limit 1),
      'versions',(select count(*) from private.look_versions v where v.look_id=l.id)) as item
    from private.looks l where l.user_id=p_user order by l.created_at desc limit least(greatest(p_limit,1),50)) x;
$$;

-- One version as a self-contained view (frozen snapshot, never live catalog data).
create function private.read_look_version(p_user uuid,p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',v.id,'look_id',v.look_id,'version',v.version,'parent_version_id',v.parent_version_id,
    'job_id',v.job_id,'product_id',v.product_id,'variant_id',v.variant_id,'created_at',v.created_at,
    'selection_snapshot',v.selection_snapshot,
    'image',(select jsonb_build_object('width',a.width,'height',a.height) from private.assets a where a.id=v.asset_id and a.state='ready'
      and (a.expires_at is null or a.expires_at>clock_timestamp())))
  from private.look_versions v where v.id=p_version and v.user_id=p_user;
$$;

-- Asset location for server-side streaming after the ownership check.
create function private.read_version_asset(p_user uuid,p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,'bytes',a.bytes)
  from private.look_versions v join private.assets a on a.id=v.asset_id and a.user_id=v.user_id
  where v.id=p_version and v.user_id=p_user and a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp());
$$;

-- ------------------------------------------------------------- worker side

create function private.next_ai_job() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from private.ai_jobs
  where status='queued' or (status='running' and lease_until<=clock_timestamp())
  order by created_at,id limit 1;
$$;

create function private.renew_ai_job_lease(p_job uuid,p_fence bigint) returns boolean
language sql security definer set search_path = '' as $$
  with renewed as (
    update private.ai_jobs set lease_until=clock_timestamp()+interval '2 minutes'
    where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() returning 1)
  select exists(select 1 from renewed);
$$;

create function private.load_ai_job(p_job uuid,p_fence bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'user_id',j.user_id,'category_id',j.category_id,'search_query',j.search_query,
    'parent_version_id',j.parent_version_id,
    'photo',jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime),
    'variant',case when j.requested_variant_id is null then null else (
      select jsonb_build_object('product_id',p.id,'variant_id',v.id,'name',p.name,'category_id',p.category_id,
        'source',pa.source,'partner',pa.name,'external_product_id',p.external_product_id,'external_variant_id',v.external_variant_id,
        'variant_label',v.label,'product_url',p.product_url,'price_minor',p.price_minor,'currency',p.currency,
        'availability',p.availability,'variant_available',v.available,'published',p.published,'rights_cleared',p.rights_cleared,
        'source_updated_at',p.source_updated_at,
        'image_url',(select i.url from public.product_images i where i.product_id=p.id and (i.variant_id=v.id or i.variant_id is null)
          order by (i.variant_id is null),i.position limit 1))
      from public.products p join public.product_variants v on v.product_id=p.id join public.partners pa on pa.id=p.partner_id
      where p.id=j.requested_product_id and v.id=j.requested_variant_id) end)
  from private.ai_jobs j join private.assets a on a.id=j.photo_id
  where j.id=p_job and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp();
$$;

create function private.register_generated_asset(p_job uuid,p_fence bigint,p_object_key text,p_bytes integer,p_mime text,
  p_width integer,p_height integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare asset uuid;
begin
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then raise exception 'job lease unavailable' using errcode='42501'; end if;
  if p_object_key not like job.user_id::text || '/' || p_job::text || '/%' then
    raise exception 'object key outside job scope' using errcode='23514';
  end if;
  insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at)
    values(job.user_id,'generated_look','ready','generated-looks',p_object_key,p_bytes,p_mime,p_width,p_height,now()+interval '168 hours')
    on conflict (bucket_id,object_key) do nothing returning id into asset;
  if asset is null then
    select id into asset from private.assets where bucket_id='generated-looks' and object_key=p_object_key and user_id=job.user_id;
  end if;
  return asset;
end $$;

create function private.complete_look_job(p_job uuid,p_fence bigint,p_asset uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare selection private.ai_job_selection%rowtype;
declare look uuid;
declare next_version integer;
declare version_id uuid;
begin
  -- No row lock here: finish_ai_job takes profile then job locks (global order).
  select * into job from private.ai_jobs where id=p_job;
  if not found then return null; end if;
  select * into selection from private.ai_job_selection where job_id=p_job;
  if not found then raise exception 'selection unavailable' using errcode='42501'; end if;
  if not private.finish_ai_job(p_job,p_fence,'succeeded',p_asset) then return null; end if;
  if job.parent_version_id is null then
    insert into private.looks(user_id) values(job.user_id) returning id into look;
  else
    select look_id into look from private.look_versions where id=job.parent_version_id and user_id=job.user_id;
    if look is null then raise exception 'parent version unavailable' using errcode='42501'; end if;
  end if;
  perform 1 from private.looks where id=look for update;
  select coalesce(max(version),0)+1 into next_version from private.look_versions where look_id=look;
  insert into private.look_versions(user_id,look_id,version,parent_version_id,job_id,asset_id,product_id,variant_id,selection_snapshot)
    values(job.user_id,look,next_version,job.parent_version_id,p_job,p_asset,selection.product_id,selection.variant_id,selection.search_snapshot)
    returning id into version_id;
  update private.provider_calls set look_version_id=version_id where job_id=p_job;
  return version_id;
end $$;

create function private.fail_look_job(p_job uuid,p_fence bigint,p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.finish_ai_job(p_job,p_fence,'failed',null) then return false; end if;
  update private.ai_jobs set failure_code=p_code where id=p_job;
  return true;
end $$;

-- Atomic multi-scope reservation, fixed lock order. Idempotent per attempt key.
create function private.reserve_provider_call(p_job uuid,p_fence bigint,p_provider text,p_model text,p_price_version text,
  p_operation text,p_key text,p_reserve bigint,p_user_ref text,p_environment text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare previous private.provider_calls%rowtype;
declare d date := (statement_timestamp() at time zone 'UTC')::date;
declare m date := date_trunc('month',(statement_timestamp() at time zone 'UTC'))::date;
declare s record;
declare lim private.provider_budget_limits%rowtype;
declare call_id uuid;
begin
  if p_reserve is null or p_reserve not between 1 and 1000000000000 then
    raise exception 'invalid spend ceiling' using errcode='23514';
  end if;
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then raise exception 'job lease unavailable' using errcode='42501'; end if;
  select * into previous from private.provider_calls where attempt_key=p_key;
  if found then
    if previous.job_id is distinct from p_job or previous.reserved_usd_micros<>p_reserve or previous.provider<>p_provider
       or previous.operation<>p_operation then
      raise exception 'attempt conflict' using errcode='23505';
    end if;
    return previous.id;
  end if;
  if p_operation='generation' and not exists(select 1 from private.ai_job_selection where job_id=p_job) then
    raise exception 'verified catalog selection required' using errcode='23514';
  end if;
  for s in select * from (values
      (1,'global','*','day',d),(2,'global','*','month',m),
      (3,'provider',p_provider,'day',d),(4,'provider',p_provider,'month',m),
      (5,'user',job.user_id::text,'day',d),(6,'job',p_job::text,'job',date '1970-01-01')) as t(ord,scope,scope_key,period,period_start)
    order by ord loop
    select * into lim from private.provider_budget_limits l where l.scope=s.scope and l.period=s.period and l.scope_key in (s.scope_key,'*')
      order by (l.scope_key='*') limit 1;
    if not found then raise exception 'provider budget not configured: % %',s.scope,s.period using errcode='23514'; end if;
    insert into private.provider_budget_usage(scope,scope_key,period,period_start) values(s.scope,s.scope_key,s.period,s.period_start)
      on conflict do nothing;
    update private.provider_budget_usage u set reserved_usd_micros=u.reserved_usd_micros+p_reserve
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start
        and not lim.paused and u.reserved_usd_micros+u.spent_usd_micros+p_reserve<=lim.limit_usd_micros;
    if not found then raise exception 'provider budget exhausted: % %',s.scope,s.period using errcode='23514'; end if;
  end loop;
  insert into private.provider_calls(job_id,user_id,user_ref,provider,model,price_version,operation,attempt_key,environment,
      reserved_usd_micros,estimated_usd_micros,cost_source,budget_day,budget_month)
    values(p_job,job.user_id,p_user_ref,p_provider,p_model,p_price_version,p_operation,p_key,p_environment,
      p_reserve,null,'unknown',d,m) returning id into call_id;
  return call_id;
end $$;

-- Persist dispatch intent before the network request. False = do not send.
create function private.begin_provider_call(p_call uuid,p_fence bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c private.provider_calls%rowtype;
begin
  select * into c from private.provider_calls where id=p_call for update;
  if not found or c.status<>'reserved' then return false; end if;
  perform 1 from private.ai_jobs where id=c.job_id and status='running' and fence=p_fence and lease_until>clock_timestamp() for share;
  if not found then return false; end if;
  update private.provider_calls set status='dispatched',started_at=clock_timestamp() where id=p_call;
  return true;
end $$;

create function private.apply_provider_spend(c private.provider_calls,p_settled bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  for s in select * from (values
      (1,'global','*','day',c.budget_day),(2,'global','*','month',c.budget_month),
      (3,'provider',c.provider,'day',c.budget_day),(4,'provider',c.provider,'month',c.budget_month),
      (5,'user',coalesce(c.user_id::text,'deleted'),'day',c.budget_day),(6,'job',coalesce(c.job_id::text,'deleted'),'job',date '1970-01-01'))
      as t(ord,scope,scope_key,period,period_start) order by ord loop
    update private.provider_budget_usage u set reserved_usd_micros=greatest(u.reserved_usd_micros-c.reserved_usd_micros,0),
      spent_usd_micros=u.spent_usd_micros+p_settled
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start;
  end loop;
end $$;
revoke all on function private.apply_provider_spend(private.provider_calls,bigint) from public,anon,authenticated,service_role;

-- Settle a call. Unknown cost keeps the reservation until reconciliation.
-- p_status: succeeded|failed|unknown|released (released = never dispatched).
create function private.settle_provider_call(p_call uuid,p_status text,p_request_id text,p_units jsonb,p_report jsonb,
  p_estimated bigint,p_computed bigint,p_confirmed bigint,p_source text,p_latency integer,p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c private.provider_calls%rowtype;
declare settled bigint;
begin
  if p_status not in ('succeeded','failed','unknown','released') then raise exception 'invalid status' using errcode='23514'; end if;
  select * into c from private.provider_calls where id=p_call for update;
  if not found then return false; end if;
  if c.status in ('succeeded','failed','released') then return false; end if;
  if p_status='released' and c.status<>'reserved' then raise exception 'dispatched call cannot be released' using errcode='23514'; end if;
  if p_status<>'released' and c.status='reserved' then raise exception 'call was not dispatched' using errcode='23514'; end if;
  settled := case when p_status='released' then 0 else coalesce(p_confirmed,p_computed,
    case when p_source='rejected_before_run' then 0 end) end;
  if p_status in ('succeeded','failed') and settled is null then p_status := 'unknown'; end if;
  update private.provider_calls set status=p_status,
    provider_request_id=coalesce(p_request_id,provider_request_id),
    units=coalesce(p_units,'{}'::jsonb),provider_report=coalesce(p_report,'{}'::jsonb),
    estimated_usd_micros=p_estimated,computed_usd_micros=p_computed,confirmed_usd_micros=p_confirmed,
    cost_source=coalesce(p_source,'unknown'),
    settled_usd_micros=case when p_status in ('succeeded','failed','released') then settled end,
    finished_at=clock_timestamp(),latency_ms=p_latency,error_code=p_error
    where id=p_call returning * into c;
  if p_status in ('succeeded','failed','released') then perform private.apply_provider_spend(c,settled); end if;
  return true;
end $$;

-- Later reconciliation of a dispatched/unknown call with provider evidence.
create function private.reconcile_provider_call(p_call uuid,p_status text,p_confirmed bigint,p_source text,p_report jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c private.provider_calls%rowtype;
begin
  if p_status not in ('succeeded','failed') or p_confirmed is null or p_confirmed<0 then
    raise exception 'invalid reconciliation' using errcode='23514';
  end if;
  select * into c from private.provider_calls where id=p_call for update;
  if not found or c.status not in ('dispatched','unknown') then return false; end if;
  update private.provider_calls set status=p_status,settled_usd_micros=p_confirmed,
    confirmed_usd_micros=case when p_source='provider_confirmed' then p_confirmed else confirmed_usd_micros end,
    computed_usd_micros=case when p_source='computed_from_usage' then p_confirmed else computed_usd_micros end,
    cost_source=p_source,provider_report=provider_report||coalesce(p_report,'{}'::jsonb),finished_at=coalesce(finished_at,clock_timestamp())
    where id=p_call returning * into c;
  perform private.apply_provider_spend(c,p_confirmed);
  return true;
end $$;

-- Calls left dispatched/unknown, for the reconciliation loop.
create function private.list_unreconciled_calls(p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'job_id',c.job_id,'provider',c.provider,'model',c.model,
    'attempt_key',c.attempt_key,'provider_request_id',c.provider_request_id,'status',c.status,'started_at',c.started_at)),'[]'::jsonb)
  from (select * from private.provider_calls where status in ('dispatched','unknown')
    and started_at<clock_timestamp()-interval '30 seconds' order by created_at limit least(greatest(p_limit,1),100)) c;
$$;

create function private.enqueue_telemetry_event(p_key text,p_job uuid,p_payload jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.telemetry_outbox(event_key,job_id,payload) values(p_key,p_job,p_payload) on conflict(event_key) do nothing;
  return found;
end $$;

create function private.claim_telemetry_events(p_limit integer) returns jsonb
language sql security definer set search_path = '' as $$
  with picked as (
    select id from private.telemetry_outbox
    where (state='pending' and next_attempt_at<=clock_timestamp()) or (state='sending' and lease_until<=clock_timestamp())
    order by created_at limit least(greatest(p_limit,1),100) for update skip locked),
  claimed as (
    update private.telemetry_outbox o set state='sending',attempts=o.attempts+1,lease_until=clock_timestamp()+interval '1 minute'
    from picked where o.id=picked.id returning o.id,o.event_key,o.payload,o.attempts)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'event_key',event_key,'payload',payload,'attempts',attempts)),'[]'::jsonb) from claimed;
$$;

-- 'retry' only for definite non-delivery; 'unknown' freezes the event.
create function private.mark_telemetry_event(p_id uuid,p_outcome text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('sent','retry','unknown','dead') then raise exception 'invalid outcome' using errcode='23514'; end if;
  update private.telemetry_outbox set
    state=case p_outcome when 'retry' then case when attempts>=8 then 'dead' else 'pending' end else p_outcome end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(power(2,attempts)::int,600)),
    lease_until=null,sent_at=case when p_outcome='sent' then clock_timestamp() end
    where id=p_id and state='sending';
  return found;
end $$;

-- Operator report (service_role/psql). Topups and consumption stay separate.
create view private.provider_cost_summary with (security_invoker=true) as
  select c.provider,c.budget_day as day,c.environment,
    count(*) as calls,
    count(*) filter (where c.status in ('dispatched','unknown')) as unreconciled_calls,
    sum(c.settled_usd_micros) as settled_usd_micros,
    sum(c.reserved_usd_micros) filter (where c.status in ('reserved','dispatched','unknown')) as open_reserved_usd_micros,
    sum(c.confirmed_usd_micros) as confirmed_usd_micros
  from private.provider_calls c group by 1,2,3;
revoke all on private.provider_cost_summary from public,anon,authenticated;
grant select on private.provider_cost_summary to service_role;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261120000100'::text $$;

revoke all on function private.enqueue_look_job(uuid,text,text,text,uuid,uuid,uuid),private.read_ai_job(uuid,uuid),
  private.read_look(uuid,uuid),private.read_look_version(uuid,uuid),private.list_looks(uuid,integer),private.read_version_asset(uuid,uuid),
  private.next_ai_job(),private.renew_ai_job_lease(uuid,bigint),private.load_ai_job(uuid,bigint),
  private.register_generated_asset(uuid,bigint,text,integer,text,integer,integer),private.complete_look_job(uuid,bigint,uuid),
  private.fail_look_job(uuid,bigint,text),
  private.reserve_provider_call(uuid,bigint,text,text,text,text,text,bigint,text,text),private.begin_provider_call(uuid,bigint),
  private.settle_provider_call(uuid,text,text,jsonb,jsonb,bigint,bigint,bigint,text,integer,text),
  private.reconcile_provider_call(uuid,text,bigint,text,jsonb),private.list_unreconciled_calls(integer),
  private.enqueue_telemetry_event(text,uuid,jsonb),private.claim_telemetry_events(integer),private.mark_telemetry_event(uuid,text)
  from public,anon,authenticated,service_role;

grant execute on function private.enqueue_look_job(uuid,text,text,text,uuid,uuid,uuid),private.read_ai_job(uuid,uuid),
  private.read_look(uuid,uuid),private.read_look_version(uuid,uuid),private.list_looks(uuid,integer),private.read_version_asset(uuid,uuid) to stylai_api;

grant execute on function private.next_ai_job(),private.renew_ai_job_lease(uuid,bigint),private.load_ai_job(uuid,bigint),
  private.register_generated_asset(uuid,bigint,text,integer,text,integer,integer),private.complete_look_job(uuid,bigint,uuid),
  private.fail_look_job(uuid,bigint,text),
  private.reserve_provider_call(uuid,bigint,text,text,text,text,text,bigint,text,text),private.begin_provider_call(uuid,bigint),
  private.settle_provider_call(uuid,text,text,jsonb,jsonb,bigint,bigint,bigint,text,integer,text),
  private.reconcile_provider_call(uuid,text,bigint,text,jsonb),private.list_unreconciled_calls(integer),
  private.enqueue_telemetry_event(text,uuid,jsonb),private.claim_telemetry_events(integer),private.mark_telemetry_event(uuid,text)
  to stylai_ai_worker;

commit;
