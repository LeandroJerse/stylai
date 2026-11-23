-- Multi-piece composition (docs/decisions/2026-11-23-composicao-multipeca.md). ADDITIVE:
--   * private.look_compositions: durable snapshot of the agent's composition (any source, incl. AliExpress),
--     so a look's origin never depends on an in-memory cache;
--   * private.ai_job_items: ordered pieces (render order) of a generation job; the first is the job's primary
--     product (keeps ai_jobs/look_versions single-product columns valid for old readers);
--   * private.look_version_items: pieces frozen per version, copied by trigger at version creation.
-- One-piece looks keep working unchanged (no items rows; readers fall back to the version's product).
-- Rollback: drop the new functions/trigger/tables and the ai_jobs.composition_id column (no existing data changes).
begin;

create table private.look_compositions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('curated','aliexpress_affiliate','tiktok_shop')),
  selection_method text not null check (selection_method in ('agent','rules_fallback')),
  model text check (model is null or length(model) between 1 and 128),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 131072),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);
create index look_compositions_user_created on private.look_compositions(user_id, created_at desc);

alter table private.ai_jobs add column composition_id uuid references private.look_compositions(id) on delete set null;
create index ai_jobs_composition on private.ai_jobs(composition_id) where composition_id is not null;

create table private.ai_job_items (
  job_id uuid not null references private.ai_jobs(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  slot text not null check (slot in ('upper','lower','dress','outer')),
  product_id uuid not null,
  variant_id uuid not null,
  category_id text not null,
  snapshot jsonb check (snapshot is null or jsonb_typeof(snapshot) = 'object'),
  primary key (job_id, position),
  unique (job_id, slot)
);

create table private.look_version_items (
  version_id uuid not null references private.look_versions(id) on delete cascade,
  user_id uuid not null,
  position smallint not null check (position between 1 and 3),
  slot text not null check (slot in ('upper','lower','dress','outer')),
  product_id uuid not null,
  variant_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  primary key (version_id, position)
);
create index look_version_items_user on private.look_version_items(user_id);

alter table private.look_compositions enable row level security;
alter table private.ai_job_items enable row level security;
alter table private.look_version_items enable row level security;
revoke all on private.look_compositions, private.ai_job_items, private.look_version_items
  from public, anon, authenticated, service_role, stylai_api, stylai_ai_worker;

-- Same groups as packages/contracts composition.ts (SLOT_CATEGORIES).
create function private.slot_of_category(p_category text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case p_category when 'tops' then 'upper' when 'shirts' then 'upper' when 'pants' then 'lower'
    when 'bottoms' then 'lower' when 'dresses' then 'dress' when 'jackets' then 'outer' else null end;
$$;
create function private.slot_render_rank(p_slot text) returns integer
language sql immutable security invoker set search_path = '' as $$
  select case p_slot when 'dress' then 1 when 'lower' then 2 when 'upper' then 3 when 'outer' then 4 else null end;
$$;
-- Photo framing group needed by a slot (outer layer is worn on the upper body).
create function private.slot_photo_group(p_slot text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case p_slot when 'dress' then 'dress' when 'lower' then 'lower' else 'upper' end;
$$;

-- Product + variant + AUTHORIZED try-on image (null when none): the rights gate used everywhere below.
create function private.ai_variant_json(p_product uuid, p_variant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('product_id',p.id,'variant_id',v.id,'name',p.name,'category_id',p.category_id,
    'source',pa.source,'partner',pa.name,'external_product_id',p.external_product_id,'external_variant_id',v.external_variant_id,
    'variant_label',v.label,'product_url',p.product_url,'price_minor',p.price_minor,'currency',p.currency,
    'availability',p.availability,'variant_available',v.available,'published',p.published,'rights_cleared',p.rights_cleared,
    'source_updated_at',p.source_updated_at,'fixture',p.fixture,
    'image_url',(select i.url from public.product_images i join private.catalog_image_rights r on r.image_id=i.id and r.try_on_allowed
      where i.product_id=p.id and (i.variant_id=v.id or i.variant_id is null)
      order by (i.variant_id is null),i.position limit 1))
  from public.products p join public.product_variants v on v.product_id=p.id join public.partners pa on pa.id=p.partner_id
  where p.id=p_product and v.id=p_variant;
$$;

-- Durable composition snapshot; bounded per person/day against abuse of paid interpretation.
create function private.save_look_composition(p_user uuid, p_source text, p_method text, p_model text, p_plan jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform 1 from public.profiles p where p.id=p_user and p.deletion_state='active';
  if not found then raise exception 'inactive account' using errcode='42501'; end if;
  if (select count(*) from private.look_compositions where user_id=p_user and created_at>statement_timestamp()-interval '1 day') >= 100 then
    raise exception 'composition limit reached' using errcode='23514';
  end if;
  insert into private.look_compositions(user_id,source,selection_method,model,plan) values(p_user,p_source,p_method,p_model,p_plan)
    returning look_compositions.id into new_id;
  return new_id;
end $$;

create function private.read_look_composition(p_user uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'source',c.source,'selection_method',c.selection_method,'model',c.model,'plan',c.plan,'created_at',c.created_at)
  from private.look_compositions c where c.id=p_id and c.user_id=p_user;
$$;

-- p_items: [{slot, product_id, variant_id|null}] (1..3). All pieces must be catalog products with rights AND an
-- authorized try-on image; the photo must support every garment group. Atomic with the daily allowance.
create function private.enqueue_composition_job(p_user uuid, p_key text, p_hash text, p_policy text, p_items jsonb,
  p_parent_version uuid, p_composition uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare job uuid;
declare current private.ai_jobs%rowtype;
declare photo uuid;
declare it record;
declare variant uuid;
declare category text;
declare slots text[] := '{}';
declare resolved jsonb := '[]'::jsonb;
declare primary_item jsonb;
declare n integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'items required' using errcode='23514'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 3 then raise exception 'one to three pieces required' using errcode='23514'; end if;
  select * into current from private.ai_jobs where user_id=p_user and request_key=p_key;
  if found then
    if current.request_hash<>p_hash or current.parent_version_id is distinct from p_parent_version
       or current.composition_id is distinct from p_composition then
      raise exception 'request key conflict' using errcode='23505';
    end if;
    return current.id;
  end if;
  if p_parent_version is not null and not exists(select 1 from private.look_versions where id=p_parent_version and user_id=p_user) then
    raise exception 'parent version unavailable' using errcode='42501';
  end if;
  if p_composition is not null and not exists(select 1 from private.look_compositions where id=p_composition and user_id=p_user) then
    raise exception 'composition unavailable' using errcode='42501';
  end if;
  for it in select value as v from jsonb_array_elements(p_items) loop
    if (it.v->>'product_id') is null or (it.v->>'product_id') !~ '^[0-9a-f-]{36}$' then
      raise exception 'catalog product required' using errcode='23514';
    end if;
    variant := nullif(it.v->>'variant_id','')::uuid;
    if variant is null then
      select min(pv.id::text)::uuid into variant from public.product_variants pv
        where pv.product_id=(it.v->>'product_id')::uuid and pv.available is true having count(*)=1;
      if variant is null then raise exception 'variant choice required' using errcode='23514'; end if;
    end if;
    select p.category_id into category from public.products p join public.product_variants pv on pv.product_id=p.id
      where p.id=(it.v->>'product_id')::uuid and pv.id=variant and p.published and p.rights_cleared and pv.available is true;
    if category is null then raise exception 'catalog variant unavailable' using errcode='23514'; end if;
    if private.slot_of_category(category) is distinct from (it.v->>'slot') then
      raise exception 'piece does not match slot' using errcode='23514';
    end if;
    if (private.ai_variant_json((it.v->>'product_id')::uuid, variant)->>'image_url') is null then
      raise exception 'try-on rights missing' using errcode='SA003';
    end if;
    if (it.v->>'slot') = any(slots) then raise exception 'duplicate slot' using errcode='23514'; end if;
    slots := slots || (it.v->>'slot');
    resolved := resolved || jsonb_build_object('slot',it.v->>'slot','product_id',it.v->>'product_id','variant_id',variant,'category_id',category);
  end loop;
  if 'dress' = any(slots) and ('upper' = any(slots) or 'lower' = any(slots)) then
    raise exception 'dress excludes top and bottom' using errcode='23514';
  end if;
  select id into photo from private.assets where user_id=p_user and kind='body_photo' and body_angle='front' and state='ready'
    and validation_status='approved' and expires_at>statement_timestamp()
    order by created_at desc,id limit 1 for update;
  if photo is null then raise exception 'photo unavailable' using errcode='42501'; end if;
  if not exists (select 1 from private.assets where id=photo and split_part(validator_version,'+',2)=private.required_pose_rules()) then
    raise exception 'photo revalidation required' using errcode='SA002';
  end if;
  if exists (select 1 from unnest(slots) s where not exists (select 1 from private.assets a where a.id=photo
      and jsonb_typeof(a.validation->'supports')='object' and (a.validation->'supports'->>private.slot_photo_group(s))='true')) then
    raise exception 'photo framing insufficient' using errcode='SA001';
  end if;
  select value into primary_item from jsonb_array_elements(resolved) order by private.slot_render_rank(value->>'slot') limit 1;
  job := private.enqueue_ai_job(p_user,p_key,p_hash,photo,primary_item->>'category_id',p_policy,'',
    (primary_item->>'product_id')::uuid,(primary_item->>'variant_id')::uuid);
  select * into current from private.ai_jobs where id=job for update;
  if current.lineage_bound then
    if current.parent_version_id is distinct from p_parent_version or current.composition_id is distinct from p_composition then
      raise exception 'request key conflict' using errcode='23505';
    end if;
    return job;
  end if;
  insert into private.ai_job_items(job_id,position,slot,product_id,variant_id,category_id)
    select job, row_number() over (order by private.slot_render_rank(value->>'slot')), value->>'slot',
      (value->>'product_id')::uuid, (value->>'variant_id')::uuid, value->>'category_id'
    from jsonb_array_elements(resolved);
  update private.ai_jobs set parent_version_id=p_parent_version, lineage_bound=true, composition_id=p_composition where id=job;
  return job;
end $$;

-- Worker load: unchanged fields plus ordered items (each re-reads rights at load time).
create or replace function private.load_ai_job(p_job uuid,p_fence bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'user_id',j.user_id,'category_id',j.category_id,'search_query',j.search_query,
    'parent_version_id',j.parent_version_id,'composition_id',j.composition_id,
    'photo',jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,
      'usable',a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())),
    'variant',case when j.requested_variant_id is null then null else private.ai_variant_json(j.requested_product_id,j.requested_variant_id) end,
    'items',coalesce((select jsonb_agg(private.ai_variant_json(i.product_id,i.variant_id) || jsonb_build_object('slot',i.slot,'position',i.position)
      order by i.position) from private.ai_job_items i where i.job_id=j.id),'[]'::jsonb))
  from private.ai_jobs j join private.assets a on a.id=j.photo_id
  where j.id=p_job and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp();
$$;

-- Worker freezes each piece just before dispatch; the rights gate is re-checked (revocation fails closed).
create function private.record_job_item_snapshot(p_job uuid, p_fence bigint, p_position smallint, p_snapshot jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare item private.ai_job_items%rowtype;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'invalid snapshot' using errcode='23514'; end if;
  perform 1 from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  select * into item from private.ai_job_items where job_id=p_job and position=p_position for update;
  if not found then raise exception 'job item unavailable' using errcode='42501'; end if;
  if not exists (select 1 from public.products p join public.product_variants v on v.product_id=p.id
      where p.id=item.product_id and v.id=item.variant_id and p.published and p.rights_cleared and v.available is true)
     or (private.ai_variant_json(item.product_id,item.variant_id)->>'image_url') is null then
    raise exception 'try-on rights missing' using errcode='SA003';
  end if;
  if item.snapshot is not null then
    -- A recovered job whose piece changed (price/title/link) must fail explicitly, not look like a lost lease.
    if item.snapshot is distinct from p_snapshot then raise exception 'job item snapshot changed' using errcode='SA004'; end if;
    return true;
  end if;
  update private.ai_job_items set snapshot=p_snapshot where job_id=p_job and position=p_position;
  return true;
end $$;

-- Freeze the pieces into the version the moment it is created (same transaction as complete_look_job).
create function private.copy_job_items_to_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.look_version_items(version_id,user_id,position,slot,product_id,variant_id,snapshot)
    select new.id,new.user_id,i.position,i.slot,i.product_id,i.variant_id,i.snapshot
    from private.ai_job_items i where i.job_id=new.job_id and i.snapshot is not null;
  return new;
end $$;
create trigger look_versions_copy_items after insert on private.look_versions
  for each row execute function private.copy_job_items_to_version();

create function private.list_look_version_items(p_user uuid, p_version uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('position',i.position,'slot',i.slot,'product_id',i.product_id,
    'variant_id',i.variant_id,'snapshot',i.snapshot) order by i.position),'[]'::jsonb)
  from private.look_version_items i where i.version_id=p_version and i.user_id=p_user;
$$;

-- Global external-call budget shared by every API replica (in-memory caches are not a global limit).
create table private.provider_call_windows (
  provider text not null check (provider in ('aliexpress','anthropic')),
  window_start timestamptz not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (provider, window_start)
);
alter table private.provider_call_windows enable row level security;
revoke all on private.provider_call_windows from public, anon, authenticated, service_role, stylai_api, stylai_ai_worker;

-- Atomic per-minute slot: true = the caller may make ONE external call (retries must take their own slot).
create function private.take_provider_call_slot(p_provider text, p_limit integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := date_trunc('minute', clock_timestamp());
begin
  if p_provider not in ('aliexpress','anthropic') or p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'invalid call budget' using errcode='23514';
  end if;
  insert into private.provider_call_windows(provider,window_start,calls) values (p_provider,w,1)
    on conflict (provider,window_start) do update set calls=private.provider_call_windows.calls+1
    where private.provider_call_windows.calls < p_limit;
  if not found then return false; end if;
  delete from private.provider_call_windows where provider=p_provider and window_start < w - interval '1 hour';
  return true;
end $$;

-- Daily global ceiling as well (a per-minute window alone allows ~43k calls/day).
create table private.provider_call_days (
  provider text not null check (provider in ('aliexpress','anthropic')),
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (provider, day)
);
alter table private.provider_call_days enable row level security;
revoke all on private.provider_call_days from public, anon, authenticated, service_role, stylai_api, stylai_ai_worker;

create function private.take_provider_daily_slot(p_provider text, p_limit integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare d date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_provider not in ('aliexpress','anthropic') or p_limit is null or p_limit not between 1 and 1000000 then
    raise exception 'invalid call budget' using errcode='23514';
  end if;
  insert into private.provider_call_days(provider,day,calls) values (p_provider,d,1)
    on conflict (provider,day) do update set calls=private.provider_call_days.calls+1
    where private.provider_call_days.calls < p_limit;
  return found;
end $$;

-- Cheap pre-check BEFORE paid interpretation (save_look_composition still enforces it atomically).
create function private.composition_quota_available(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from private.look_compositions where user_id=p_user and created_at>statement_timestamp()-interval '1 day') < 100;
$$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261123210932'::text $$;

revoke all on function private.slot_of_category(text), private.slot_render_rank(text), private.slot_photo_group(text),
  private.ai_variant_json(uuid,uuid), private.save_look_composition(uuid,text,text,text,jsonb),
  private.read_look_composition(uuid,uuid), private.enqueue_composition_job(uuid,text,text,text,jsonb,uuid,uuid),
  private.record_job_item_snapshot(uuid,bigint,smallint,jsonb), private.copy_job_items_to_version(),
  private.list_look_version_items(uuid,uuid), private.take_provider_call_slot(text,integer),
  private.take_provider_daily_slot(text,integer), private.composition_quota_available(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.save_look_composition(uuid,text,text,text,jsonb), private.read_look_composition(uuid,uuid),
  private.enqueue_composition_job(uuid,text,text,text,jsonb,uuid,uuid), private.list_look_version_items(uuid,uuid),
  private.take_provider_call_slot(text,integer), private.take_provider_daily_slot(text,integer),
  private.composition_quota_available(uuid) to stylai_api;
grant execute on function private.record_job_item_snapshot(uuid,bigint,smallint,jsonb) to stylai_ai_worker;

commit;
