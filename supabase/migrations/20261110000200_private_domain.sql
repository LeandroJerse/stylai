-- Server-only domain storage. Keep private outside the Supabase Data API schema list.
begin;

create table private.source_connections (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('aliexpress','shopee','tiktok_shop')),
  environment text not null check (environment in ('sandbox','production')),
  market text not null,
  external_account_id text not null,
  external_shop_id text not null,
  scopes text[] not null default '{}',
  credentials_ciphertext text,
  key_version text,
  credentials_expires_at timestamptz,
  capability_version bigint not null default 1 check (capability_version > 0),
  capabilities jsonb not null default '{}' check (jsonb_typeof(capabilities) = 'object'),
  evidence_ref text,
  revoked_at timestamptz,
  unique (source, environment, market, external_account_id, external_shop_id),
  check ((credentials_ciphertext is null) = (key_version is null))
);

create table private.source_variants (
  connection_id uuid not null references private.source_connections(id),
  external_product_id text not null,
  external_variant_id text not null,
  product_id uuid not null,
  variant_id uuid not null,
  procurement_minor bigint check (procurement_minor >= 0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  source_updated_at timestamptz,
  primary key (connection_id, external_product_id, external_variant_id),
  foreign key (product_id, variant_id) references public.product_variants(product_id,id),
  check ((procurement_minor is null) = (currency is null))
);
create index source_variants_catalog on private.source_variants(product_id,variant_id);

create table private.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.source_connections(id),
  state text not null check (state in ('running','succeeded','failed','cancelled')),
  cursor text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((state = 'running') = (finished_at is null))
);
create index catalog_sync_history on private.catalog_sync_runs(connection_id,started_at desc);

create table private.photo_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_version text not null check (length(policy_version) between 1 and 100),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id,id),
  check (revoked_at is null or revoked_at >= granted_at)
);
create unique index photo_consents_one_active on private.photo_consents(user_id) where revoked_at is null;

create table private.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('body_photo','reference','generated_look')),
  state text not null check (state in ('processing','ready','rejected','deleting','deleted')),
  bucket_id text not null references storage.buckets(id),
  object_key text not null check (length(object_key) between 1 and 512 and object_key !~ '[:?]'),
  bytes integer check (bytes between 1 and 12582912),
  mime text check (mime in ('image/jpeg','image/png','image/webp')),
  width integer check (width between 1 and 24000000),
  height integer check (height between 1 and 24000000),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (bucket_id,object_key),
  unique (user_id,id),
  check ((kind,bucket_id) in (('body_photo','body-photos'),('reference','references'),('generated_look','generated-looks'))),
  check (state <> 'ready' or (bytes is not null and mime is not null and width is not null and height is not null)),
  check (width::bigint * height <= 24000000),
  check (expires_at is null or expires_at <= created_at + interval '168 hours'),
  check (kind = 'generated_look' or expires_at is not null)
);
create index assets_expiring on private.assets(expires_at) where state in ('processing','ready','rejected');

create table private.preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  is_default boolean not null default false,
  rules_version integer not null check (rules_version > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  unique (user_id,id)
);
create unique index preferences_one_default on private.preferences(user_id) where is_default;

create table private.admin_role_grants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('catalog_manager','finance','fulfillment','support','platform_admin')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, role)
);

create table private.settings_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pricing','shipping','membership','render')),
  scope text not null,
  version bigint not null check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  effective_at timestamptz not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 1 and 400),
  unique (kind,scope,version)
);

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 400),
  occurred_at timestamptz not null default now()
);
create index audit_events_resource on private.audit_events(resource_id,occurred_at desc);

create table private.ai_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_version_id uuid not null references private.settings_versions(id),
  environment text not null check (environment in ('sandbox','production')),
  merchant_ref text not null,
  provider_subscription_id text not null,
  provider_payment_id text not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  revoked_at timestamptz,
  unique (environment,merchant_ref,provider_payment_id),
  check (valid_until > valid_from)
);
create index ai_memberships_active on private.ai_memberships(user_id,valid_until) where revoked_at is null;

create table private.ai_daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  reserved integer not null default 0 check (reserved >= 0),
  spent integer not null default 0 check (spent >= 0),
  primary key (user_id,usage_date),
  check (reserved + spent <= 12)
);

create table private.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null check (length(request_key) between 1 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  photo_id uuid not null,
  consent_id uuid not null,
  category_id text not null references public.categories(id),
  search_query text not null default '' check (length(search_query)<=500),
  requested_product_id uuid,
  requested_variant_id uuid,
  usage_date date not null,
  allowance smallint not null check (allowance in (3,12)),
  status text not null default 'queued' check (status in ('queued','running','succeeded','no_results','failed','cancelled')),
  fence bigint not null default 0 check (fence >= 0),
  lease_until timestamptz,
  result_asset_id uuid unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id,request_key),
  unique (user_id,id),
  foreign key (user_id,photo_id) references private.assets(user_id,id) on delete cascade,
  foreign key (user_id,consent_id) references private.photo_consents(user_id,id) on delete cascade,
  foreign key (requested_product_id,requested_variant_id) references public.product_variants(product_id,id) match full,
  foreign key (user_id,usage_date) references private.ai_daily_usage(user_id,usage_date),
  foreign key (user_id,result_asset_id) references private.assets(user_id,id) on delete set null (result_asset_id),
  check ((status = 'running') = (lease_until is not null)),
  check ((status in ('queued','running')) = (finished_at is null)),
  check (result_asset_id is null or status = 'succeeded')
);
create unique index ai_jobs_one_active on private.ai_jobs(user_id) where status in ('queued','running');
create index ai_jobs_claimable on private.ai_jobs(created_at,id) where status in ('queued','running');
create index ai_jobs_photo on private.ai_jobs(user_id,photo_id);

create table private.ai_job_selection (
  job_id uuid primary key references private.ai_jobs(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid not null,
  search_snapshot jsonb not null check (jsonb_typeof(search_snapshot) = 'object'),
  foreign key (product_id,variant_id) references public.product_variants(product_id,id)
);

create table private.saved_looks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid,
  asset_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id,id),
  unique (user_id,asset_id),
  foreign key (user_id,job_id) references private.ai_jobs(user_id,id) on delete set null (job_id),
  foreign key (user_id,asset_id) references private.assets(user_id,id) on delete cascade
);

create table private.favorite_products (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (user_id,product_id)
);

create table private.saved_look_products (
  user_id uuid not null,
  look_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (user_id,look_id,product_id),
  foreign key (user_id,look_id) references private.saved_looks(user_id,id) on delete cascade
);

create table private.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  state text not null default 'pending' check (state in ('pending','running','done')),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((state = 'done') = (finished_at is not null))
);

-- Existing migration provides schema USAGE for the profile policy helper. Deny
-- table and function privileges separately, including Supabase default grants.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'source_connections','source_variants','catalog_sync_runs','photo_consents','assets','preferences',
    'admin_role_grants','settings_versions','audit_events','ai_memberships','ai_daily_usage','ai_jobs',
    'ai_job_selection','saved_looks','favorite_products','saved_look_products','deletion_requests'
  ] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role',table_name);
  end loop;
end $$;

grant select on private.ai_jobs, private.ai_daily_usage, private.deletion_requests, private.settings_versions,
  private.admin_role_grants, private.saved_looks, private.saved_look_products, private.favorite_products,
  private.ai_job_selection, private.audit_events, private.ai_memberships to service_role;
grant select,insert,update on private.source_connections,private.source_variants,private.catalog_sync_runs,private.photo_consents,private.assets,private.preferences to service_role;

create function private.enqueue_ai_job(p_user uuid,p_key text,p_hash text,p_photo uuid,p_category text,p_policy text,
  p_query text default '',p_product uuid default null,p_variant uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_state text;
  prior private.ai_jobs%rowtype;
  consent uuid;
  day date := (statement_timestamp() at time zone 'UTC')::date;
  allowance integer;
  job uuid;
begin
  select deletion_state into actor_state from public.profiles where id=p_user for update;
  if actor_state is distinct from 'active' then raise exception 'inactive account' using errcode='42501'; end if;
  select * into prior from private.ai_jobs where user_id=p_user and request_key=p_key;
  if found then
    if (prior.request_hash,prior.photo_id,prior.category_id,prior.search_query,prior.requested_product_id,prior.requested_variant_id)
       is distinct from (p_hash,p_photo,p_category,p_query,p_product,p_variant) then
      raise exception 'request key conflict' using errcode='23505';
    end if;
    return prior.id;
  end if;
  if not exists (select 1 from private.assets where id=p_photo and user_id=p_user and kind='body_photo' and state='ready' and expires_at>statement_timestamp()) then
    raise exception 'photo unavailable' using errcode='42501';
  end if;
  select id into consent from private.photo_consents where user_id=p_user and policy_version=p_policy and revoked_at is null;
  if consent is null then raise exception 'consent unavailable' using errcode='42501'; end if;
  if exists (select 1 from private.ai_jobs where user_id=p_user and status in ('queued','running')) then
    raise exception 'active request exists' using errcode='23505';
  end if;
  select case when exists (select 1 from private.ai_memberships where user_id=p_user and revoked_at is null
    and valid_from<=statement_timestamp() and valid_until>statement_timestamp()) then 12 else 3 end into allowance;
  insert into private.ai_daily_usage(user_id,usage_date) values(p_user,day) on conflict do nothing;
  update private.ai_daily_usage set reserved=reserved+1 where user_id=p_user and usage_date=day and reserved+spent<allowance;
  if not found then raise exception 'daily allowance exhausted' using errcode='23514'; end if;
  insert into private.ai_jobs(user_id,request_key,request_hash,photo_id,consent_id,category_id,usage_date,allowance,search_query,requested_product_id,requested_variant_id)
    values(p_user,p_key,p_hash,p_photo,consent,p_category,day,allowance,p_query,p_product,p_variant) returning id into job;
  return job;
end $$;

create function private.claim_ai_job(p_job uuid) returns bigint
language sql security definer set search_path = '' as $$
  update private.ai_jobs j set status='running', fence=j.fence+1, lease_until=clock_timestamp()+interval '2 minutes'
  where j.id=p_job and (j.status='queued' or (j.status='running' and j.lease_until<=clock_timestamp()))
    and exists (select 1 from public.profiles p where p.id=j.user_id and p.deletion_state='active')
    and exists (select 1 from private.assets a where a.id=j.photo_id and a.state='ready' and a.expires_at>clock_timestamp())
    and exists (select 1 from private.photo_consents c where c.id=j.consent_id and c.revoked_at is null)
  returning j.fence;
$$;

create function private.finish_ai_job(p_job uuid,p_fence bigint,p_status text,p_asset uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare actor uuid;
begin
  if p_status is null or p_status not in ('succeeded','no_results','failed') or ((p_status='succeeded') <> (p_asset is not null)) then
    raise exception 'invalid terminal result' using errcode='23514';
  end if;
  select user_id into actor from private.ai_jobs where id=p_job;
  perform 1 from public.profiles where id=actor and deletion_state='active' for update;
  if not found then return false; end if;
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if p_status='succeeded' then
    perform 1 from private.photo_consents where id=job.consent_id and revoked_at is null for share;
    if not found then raise exception 'consent unavailable' using errcode='42501'; end if;
    perform 1 from private.assets where id=job.photo_id and state='ready' and expires_at>clock_timestamp() for share;
    if not found then raise exception 'photo unavailable' using errcode='42501'; end if;
    perform 1 from private.assets where id=p_asset and user_id=actor and kind='generated_look'
      and state='ready' and expires_at>clock_timestamp() for share;
    if not found or not exists(select 1 from private.ai_job_selection where job_id=p_job) then
      raise exception 'output or selection unavailable' using errcode='42501';
    end if;
  end if;
  update private.ai_jobs set status=p_status,lease_until=null,result_asset_id=p_asset,finished_at=clock_timestamp() where id=p_job;
  update private.ai_daily_usage set reserved=reserved-1,spent=spent+case when p_status in ('succeeded','no_results') then 1 else 0 end
    where user_id=actor and usage_date=job.usage_date;
  return true;
end $$;

create function private.cancel_ai_job(p_user uuid,p_job uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare day date;
begin
  perform 1 from public.profiles where id=p_user for update;
  update private.ai_jobs set status='cancelled',fence=fence+1,lease_until=null,finished_at=clock_timestamp()
    where id=p_job and user_id=p_user and status in ('queued','running') returning usage_date into day;
  if not found then return false; end if;
  update private.ai_daily_usage set reserved=reserved-1 where user_id=p_user and usage_date=day;
  return true;
end $$;

create function private.request_account_deletion(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
declare job_id uuid;
begin
  update public.profiles set deletion_state='deleting' where id=p_user;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  update private.app_sessions set revoked_at=clock_timestamp() where user_id=p_user and revoked_at is null;
  update private.photo_consents set revoked_at=clock_timestamp() where user_id=p_user and revoked_at is null;
  for job_id in select id from private.ai_jobs where user_id=p_user and status in ('queued','running') loop
    perform private.cancel_ai_job(p_user,job_id);
  end loop;
  insert into private.deletion_requests(user_id) values(p_user) on conflict (user_id) do nothing;
  select id into request_id from private.deletion_requests where user_id=p_user;
  return request_id;
end $$;

revoke all on function private.enqueue_ai_job(uuid,text,text,uuid,text,text,text,uuid,uuid),private.claim_ai_job(uuid),
  private.finish_ai_job(uuid,bigint,text,uuid),private.cancel_ai_job(uuid,uuid),private.request_account_deletion(uuid)
  from public,anon,authenticated;
grant execute on function private.enqueue_ai_job(uuid,text,text,uuid,text,text,text,uuid,uuid),private.claim_ai_job(uuid),
  private.finish_ai_job(uuid,bigint,text,uuid),private.cancel_ai_job(uuid,uuid),private.request_account_deletion(uuid)
  to service_role;

commit;
