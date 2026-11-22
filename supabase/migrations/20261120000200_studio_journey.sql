-- Studio journey: app-session vault entry points, body photo + consent,
-- curated catalog reads with image-rights evidence, active-job recovery and
-- the daily allowance read. Additive. All entry points take an actor UUID that
-- the API derives from a verified Supabase JWT + active app session; passing a
-- UUID here is never authentication by itself.
begin;

-- ------------------------------------------------------------ catalog rights
-- Test data must be identifiable as such (never shown as a real offer).
alter table public.products add column fixture boolean not null default false;

-- Evidence that an image may be displayed and sent to the try-on provider.
-- Private: evidence text is operator material, not catalog content.
create table private.catalog_image_rights (
  image_id uuid primary key references public.product_images(id) on delete cascade,
  basis text not null check (basis in ('owner_authorized','licensed','test_fixture')),
  evidence text not null check (length(btrim(evidence)) between 3 and 500),
  try_on_allowed boolean not null,
  recorded_at timestamptz not null default now()
);
alter table private.catalog_image_rights enable row level security;
revoke all on private.catalog_image_rights from public,anon,authenticated;
grant all on private.catalog_image_rights to service_role;

-- Only images with recorded try-on rights reach the provider.
create or replace function private.load_ai_job(p_job uuid,p_fence bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'user_id',j.user_id,'category_id',j.category_id,'search_query',j.search_query,
    'parent_version_id',j.parent_version_id,
    'photo',jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime),
    'variant',case when j.requested_variant_id is null then null else (
      select jsonb_build_object('product_id',p.id,'variant_id',v.id,'name',p.name,'category_id',p.category_id,
        'source',pa.source,'partner',pa.name,'external_product_id',p.external_product_id,'external_variant_id',v.external_variant_id,
        'variant_label',v.label,'product_url',p.product_url,'price_minor',p.price_minor,'currency',p.currency,
        'availability',p.availability,'variant_available',v.available,'published',p.published,'rights_cleared',p.rights_cleared,
        'source_updated_at',p.source_updated_at,'fixture',p.fixture,
        'image_url',(select i.url from public.product_images i join private.catalog_image_rights r on r.image_id=i.id and r.try_on_allowed
          where i.product_id=p.id and (i.variant_id=v.id or i.variant_id is null)
          order by (i.variant_id is null),i.position limit 1))
      from public.products p join public.product_variants v on v.product_id=p.id join public.partners pa on pa.id=p.partner_id
      where p.id=j.requested_product_id and v.id=j.requested_variant_id) end)
  from private.ai_jobs j join private.assets a on a.id=j.photo_id
  where j.id=p_job and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp();
$$;

create function private.catalog_product_json(p public.products) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.id,'name',p.name,'price_minor',p.price_minor,'currency',p.currency,
    'availability',p.availability,'source_updated_at',p.source_updated_at,'product_url',p.product_url,
    'fixture',p.fixture,'created_at',p.created_at,
    'category',(select jsonb_build_object('id',c.id,'label',c.label) from public.categories c where c.id=p.category_id),
    'partner',(select jsonb_build_object('id',pa.id,'name',pa.name,'source',pa.source) from public.partners pa where pa.id=p.partner_id),
    'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'available',v.available) order by v.label,v.id)
      from public.product_variants v where v.product_id=p.id),'[]'::jsonb),
    'images',coalesce((select jsonb_agg(jsonb_build_object('url',i.url,'alt',i.alt,'position',i.position,
      'try_on_allowed',coalesce(r.try_on_allowed,false)) order by i.position)
      from public.product_images i left join private.catalog_image_rights r on r.image_id=i.id where i.product_id=p.id),'[]'::jsonb));
$$;

-- Offset cursor is enough for a hand-curated catalog; bounded page size.
create function private.list_catalog_products(p_limit integer,p_offset integer,p_category text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total',(select count(*) from public.products p where p.published and p.rights_cleared and (p_category is null or p.category_id=p_category)),
    'items',coalesce((select jsonb_agg(private.catalog_product_json(x) order by x.created_at desc,x.id) from (
      select p.* from public.products p where p.published and p.rights_cleared and (p_category is null or p.category_id=p_category)
      order by p.created_at desc,p.id offset greatest(p_offset,0) limit least(greatest(p_limit,1),48)) x),'[]'::jsonb));
$$;

create function private.read_catalog_product(p_product uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.catalog_product_json(p) from public.products p where p.id=p_product and p.published and p.rights_cleared;
$$;

create function private.catalog_facets() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total',(select count(*) from public.products p where p.published and p.rights_cleared),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'label',c.label,'count',x.n) order by c.label) from (
      select p.category_id,count(*) n from public.products p where p.published and p.rights_cleared and p.category_id is not null group by 1) x
      join public.categories c on c.id=x.category_id),'[]'::jsonb),
    'partners',coalesce((select jsonb_agg(jsonb_build_object('id',pa.id,'label',pa.name,'count',x.n) order by pa.name) from (
      select p.partner_id,count(*) n from public.products p where p.published and p.rights_cleared group by 1) x
      join public.partners pa on pa.id=x.partner_id),'[]'::jsonb));
$$;

-- ------------------------------------------------------------ session vault
-- The cookie value never reaches the database: only its SHA-256. Provider
-- tokens are AES-GCM ciphertext produced by the API with a versioned key.
create function private.create_app_session(p_user uuid,p_provider_session uuid,p_cookie_hash text,p_ciphertext text,
  p_key_version text,p_token_ttl_seconds integer,p_session_ttl_seconds integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare session uuid;
begin
  if not exists (select 1 from public.profiles where id=p_user and deletion_state='active') then
    raise exception 'account unavailable' using errcode='42501';
  end if;
  insert into private.app_sessions(user_id,provider_session_id,cookie_hash,token_payload_ciphertext,key_version,token_expires_at,expires_at)
  values (p_user,p_provider_session,p_cookie_hash,p_ciphertext,p_key_version,
    clock_timestamp()+make_interval(secs=>least(greatest(p_token_ttl_seconds,30),3600)),
    clock_timestamp()+make_interval(secs=>least(greatest(p_session_ttl_seconds,300),2592000)))
  on conflict (provider_session_id) do update set cookie_hash=excluded.cookie_hash,
    token_payload_ciphertext=excluded.token_payload_ciphertext,key_version=excluded.key_version,
    token_expires_at=excluded.token_expires_at,version=private.app_sessions.version+1,refresh_lease_until=null
    where private.app_sessions.user_id=excluded.user_id and private.app_sessions.revoked_at is null
  returning id into session;
  if session is null then raise exception 'session unavailable' using errcode='42501'; end if;
  return session;
end $$;

-- leased: caller refreshes with the provider, then completes or releases.
-- fresh: tokens are still valid (another tab just refreshed): reuse them.
-- busy: another instance holds the lease; retry shortly.
create function private.begin_session_refresh(p_cookie_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.app_sessions%rowtype;
begin
  select * into s from private.app_sessions where cookie_hash=p_cookie_hash for update;
  if not found or s.revoked_at is not null or s.expires_at<=clock_timestamp()
     or not exists (select 1 from public.profiles where id=s.user_id and deletion_state='active') then
    return null;
  end if;
  if s.token_expires_at>clock_timestamp()+interval '120 seconds' then
    return jsonb_build_object('state','fresh','id',s.id,'user_id',s.user_id,'version',s.version,
      'ciphertext',s.token_payload_ciphertext,'key_version',s.key_version);
  end if;
  if s.refresh_lease_until is not null and s.refresh_lease_until>clock_timestamp() then
    return jsonb_build_object('state','busy');
  end if;
  update private.app_sessions set refresh_lease_until=clock_timestamp()+interval '15 seconds' where id=s.id;
  return jsonb_build_object('state','leased','id',s.id,'user_id',s.user_id,'version',s.version,
    'ciphertext',s.token_payload_ciphertext,'key_version',s.key_version);
end $$;

create function private.complete_session_refresh(p_session uuid,p_version bigint,p_ciphertext text,p_key_version text,
  p_token_ttl_seconds integer) returns boolean
language sql security definer set search_path = '' as $$
  with done as (
    update private.app_sessions set token_payload_ciphertext=p_ciphertext,key_version=p_key_version,
      token_expires_at=clock_timestamp()+make_interval(secs=>least(greatest(p_token_ttl_seconds,30),3600)),
      version=version+1,refresh_lease_until=null
    where id=p_session and version=p_version and revoked_at is null and expires_at>clock_timestamp() returning 1)
  select exists(select 1 from done);
$$;

create function private.release_session_refresh(p_session uuid,p_version bigint) returns boolean
language sql security definer set search_path = '' as $$
  with done as (update private.app_sessions set refresh_lease_until=null where id=p_session and version=p_version returning 1)
  select exists(select 1 from done);
$$;

-- Returns the ciphertext so the API can also end the provider session.
create function private.revoke_app_session(p_cookie_hash text) returns jsonb
language sql security definer set search_path = '' as $$
  with done as (
    update private.app_sessions set revoked_at=clock_timestamp(),refresh_lease_until=null
    where cookie_hash=p_cookie_hash and revoked_at is null
    returning user_id,token_payload_ciphertext,key_version)
  select jsonb_build_object('user_id',user_id,'ciphertext',token_payload_ciphertext,'key_version',key_version) from done;
$$;

-- A valid JWT is not enough: its Supabase session must map to an active app session.
create function private.check_app_session(p_user uuid,p_provider_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_sessions s join public.profiles p on p.id=s.user_id
    where s.user_id=p_user and s.provider_session_id=p_provider_session and s.revoked_at is null
      and s.expires_at>clock_timestamp() and p.deletion_state='active');
$$;

create function private.read_profile(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.id,'name',p.name,'deletion_state',p.deletion_state,'created_at',p.created_at)
  from public.profiles p where p.id=p_user;
$$;

-- --------------------------------------------------------- photo + consent
create function private.record_photo_consent(p_user uuid,p_policy text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare consent uuid;
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  select id into consent from private.photo_consents where user_id=p_user and revoked_at is null and policy_version=p_policy;
  if consent is not null then return consent; end if;
  update private.photo_consents set revoked_at=clock_timestamp() where user_id=p_user and revoked_at is null;
  insert into private.photo_consents(user_id,policy_version) values (p_user,p_policy) returning id into consent;
  return consent;
end $$;

create function private.read_photo_consent(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'policy_version',c.policy_version,'granted_at',c.granted_at)
  from private.photo_consents c where c.user_id=p_user and c.revoked_at is null;
$$;

-- Database first (processing), then the object upload, then finish: a failed
-- upload never leaves a 'ready' row pointing at nothing.
create function private.begin_body_photo(p_user uuid,p_policy text,p_object_key text,p_bytes integer,p_mime text,
  p_width integer,p_height integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare asset uuid;
begin
  if not exists (select 1 from private.photo_consents where user_id=p_user and policy_version=p_policy and revoked_at is null) then
    raise exception 'consent unavailable' using errcode='42501';
  end if;
  if left(p_object_key,37)<>p_user::text||'/' then raise exception 'object key outside actor prefix' using errcode='42501'; end if;
  insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at)
  values (p_user,'body_photo','processing','body-photos',p_object_key,p_bytes,p_mime,p_width,p_height,now()+interval '168 hours')
  returning id into asset;
  return asset;
end $$;

-- The newest ready photo is the one used; older ones stop being usable and
-- wait for the (pending) storage cleanup workflow.
create function private.finish_body_photo(p_user uuid,p_asset uuid,p_ok boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update private.assets set state='deleting' where user_id=p_user and kind='body_photo' and state='ready' and id<>p_asset;
    update private.assets set state='ready' where id=p_asset and user_id=p_user and kind='body_photo' and state='processing';
  else
    update private.assets set state='rejected' where id=p_asset and user_id=p_user and kind='body_photo' and state='processing';
  end if;
  return found;
end $$;

create function private.list_body_photos(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'state',a.state,'mime',a.mime,'width',a.width,'height',a.height,
    'created_at',a.created_at,'expires_at',a.expires_at) order by a.created_at desc),'[]'::jsonb)
  from (select * from private.assets where user_id=p_user and kind='body_photo' and state in ('ready','processing','rejected')
    and (expires_at is null or expires_at>clock_timestamp()) order by created_at desc limit 3) a;
$$;

create function private.read_body_photo_asset(p_user uuid,p_asset uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,'bytes',a.bytes)
  from private.assets a where a.id=p_asset and a.user_id=p_user and a.kind='body_photo' and a.state='ready'
    and a.expires_at>clock_timestamp();
$$;

-- -------------------------------------------------- job recovery + allowance
-- Restores the followed job after a page reload (one active job per user).
create function private.read_active_ai_job(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.read_ai_job(p_user,j.id) from private.ai_jobs j
  where j.user_id=p_user and j.status in ('queued','running') order by j.created_at desc limit 1;
$$;

create function private.read_ai_allowance(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with day as (select (statement_timestamp() at time zone 'UTC')::date as d),
  allowance as (select case when exists (select 1 from private.ai_memberships where user_id=p_user and revoked_at is null
    and valid_from<=statement_timestamp() and valid_until>statement_timestamp()) then 12 else 3 end as n)
  select jsonb_build_object('allowance',(select n from allowance),
    'reserved',coalesce(u.reserved,0),'spent',coalesce(u.spent,0),
    'resets_at',(((select d from day)+1)::timestamp at time zone 'UTC'))
  from (select 1) one left join private.ai_daily_usage u on u.user_id=p_user and u.usage_date=(select d from day);
$$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261120000200'::text $$;

revoke all on function private.catalog_product_json(public.products),
  private.list_catalog_products(integer,integer,text),private.read_catalog_product(uuid),private.catalog_facets(),
  private.create_app_session(uuid,uuid,text,text,text,integer,integer),private.begin_session_refresh(text),
  private.complete_session_refresh(uuid,bigint,text,text,integer),private.release_session_refresh(uuid,bigint),
  private.revoke_app_session(text),private.check_app_session(uuid,uuid),private.read_profile(uuid),
  private.record_photo_consent(uuid,text),private.read_photo_consent(uuid),
  private.begin_body_photo(uuid,text,text,integer,text,integer,integer),private.finish_body_photo(uuid,uuid,boolean),
  private.list_body_photos(uuid),private.read_body_photo_asset(uuid,uuid),
  private.read_active_ai_job(uuid),private.read_ai_allowance(uuid)
  from public,anon,authenticated,service_role;

grant execute on function
  private.list_catalog_products(integer,integer,text),private.read_catalog_product(uuid),private.catalog_facets(),
  private.create_app_session(uuid,uuid,text,text,text,integer,integer),private.begin_session_refresh(text),
  private.complete_session_refresh(uuid,bigint,text,text,integer),private.release_session_refresh(uuid,bigint),
  private.revoke_app_session(text),private.check_app_session(uuid,uuid),private.read_profile(uuid),
  private.record_photo_consent(uuid,text),private.read_photo_consent(uuid),
  private.begin_body_photo(uuid,text,text,integer,text,integer,integer),private.finish_body_photo(uuid,uuid,boolean),
  private.list_body_photos(uuid),private.read_body_photo_asset(uuid,uuid),
  private.read_active_ai_job(uuid),private.read_ai_allowance(uuid)
  to stylai_api;

commit;
