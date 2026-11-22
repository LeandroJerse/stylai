-- QA-002: physical removal of private objects. Removal of USE stays immediate (state 'deleting', no job
-- can pick it); bytes are then removed by the worker with a lease, retries and backoff, and the row
-- becomes 'deleted' only after the store confirms the object is gone. Metadata rows are kept (audit,
-- job/version history); bytes are not. Expired body photos are queued the same way.
begin;

alter table private.assets
  add column purge_attempts integer not null default 0 check (purge_attempts >= 0),
  add column purge_after timestamptz,
  add column purge_lease_until timestamptz,
  add column purge_last_error text check (purge_last_error is null or length(purge_last_error) <= 80),
  add column deleted_at timestamptz;
create index assets_purge_queue on private.assets(purge_after) where state='deleting';

-- Worker: claim up to p_limit objects to remove (lease 2 min; concurrent workers skip locked rows).
create function private.claim_asset_purges(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  -- Expired user photos stop being usable and join the queue.
  update private.assets set state='deleting'
  where kind in ('body_photo','reference') and state in ('ready','processing','rejected')
    and expires_at is not null and expires_at<=clock_timestamp();
  with picked as (
    select id from private.assets
    where state='deleting' and (purge_after is null or purge_after<=clock_timestamp())
      and (purge_lease_until is null or purge_lease_until<=clock_timestamp())
    order by purge_after nulls first, created_at, id
    limit least(greatest(p_limit,1),50) for update skip locked),
  leased as (
    update private.assets a set purge_lease_until=clock_timestamp()+interval '2 minutes', purge_attempts=a.purge_attempts+1
    from picked where a.id=picked.id returning a.id,a.bucket_id,a.object_key)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket_id,'object_key',object_key)),'[]'::jsonb) into out from leased;
  return out;
end $$;

-- Worker: result of one removal. Success = object confirmed absent. Failure = retry with backoff.
create function private.finish_asset_purge(p_asset uuid,p_ok boolean,p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update private.assets set state='deleted',deleted_at=clock_timestamp(),purge_lease_until=null,purge_last_error=null
    where id=p_asset and state='deleting';
  else
    update private.assets set purge_lease_until=null,purge_last_error=left(coalesce(p_error,'unknown'),80),
      purge_after=clock_timestamp()+least(interval '1 hour', interval '30 seconds'*power(2,least(purge_attempts,7)))
    where id=p_asset and state='deleting';
  end if;
  return found;
end $$;

-- A newer candidate (approved or not) also retires older non-approved candidates of the same angle,
-- so failed attempts do not keep bytes until expiry.
create or replace function private.settle_body_photo_validation(p_user uuid,p_asset uuid,p_sha text,p_status text,
  p_version text,p_result jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a private.assets%rowtype;
begin
  if p_status not in ('approved','needs_adjustment','inconclusive','error') then raise exception 'invalid status' using errcode='22023'; end if;
  select * into a from private.assets where id=p_asset and user_id=p_user and kind='body_photo'
    and state in ('processing','rejected') for update;
  if not found then raise exception 'photo unavailable' using errcode='42501'; end if;
  if a.content_sha256 is distinct from p_sha then raise exception 'photo version mismatch' using errcode='40001'; end if;
  update private.assets set validation_status=p_status,validator_version=p_version,validation=p_result,validated_at=now(),
    state=case when p_status='approved' then 'ready' else 'rejected' end
  where id=p_asset;
  update private.assets set state='deleting' where user_id=p_user and kind='body_photo' and body_angle=a.body_angle
    and id<>p_asset and (state='rejected' or (p_status='approved' and state='ready'));
  return p_status='approved';
end $$;

-- The worker sees whether the job photo is still usable (removed/replaced = do not use it).
create or replace function private.load_ai_job(p_job uuid,p_fence bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'user_id',j.user_id,'category_id',j.category_id,'search_query',j.search_query,
    'parent_version_id',j.parent_version_id,
    'photo',jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,
      'usable',a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())),
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

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261121000400'::text $$;

revoke all on function private.claim_asset_purges(integer), private.finish_asset_purge(uuid,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function private.claim_asset_purges(integer), private.finish_asset_purge(uuid,boolean,text) to stylai_ai_worker;

commit;
