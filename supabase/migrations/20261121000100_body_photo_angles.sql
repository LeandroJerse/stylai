-- Body photos per angle (front / side / profile), all managed in the Perfil.
-- The current try-on provider uses ONLY the front photo: side and profile can be stored, replaced
-- and removed, but never feed a job. Additive: earlier entry points keep working (front).
begin;

alter table private.assets add column body_angle text check (body_angle in ('front','side','profile'));
update private.assets set body_angle='front' where kind='body_photo' and body_angle is null;
alter table private.assets add constraint assets_body_angle_kind check ((kind='body_photo') = (body_angle is not null));

-- Database first (processing), then the object upload, then finish (same order as before).
create function private.begin_body_photo_at(p_user uuid,p_angle text,p_policy text,p_object_key text,p_bytes integer,
  p_mime text,p_width integer,p_height integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare asset uuid;
begin
  if p_angle is null or p_angle not in ('front','side','profile') then raise exception 'invalid angle' using errcode='22023'; end if;
  if not exists (select 1 from private.photo_consents where user_id=p_user and policy_version=p_policy and revoked_at is null) then
    raise exception 'consent unavailable' using errcode='42501';
  end if;
  if left(p_object_key,37)<>p_user::text||'/' then raise exception 'object key outside actor prefix' using errcode='42501'; end if;
  insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,body_angle)
  values (p_user,'body_photo','processing','body-photos',p_object_key,p_bytes,p_mime,p_width,p_height,now()+interval '168 hours',p_angle)
  returning id into asset;
  return asset;
end $$;

-- Earlier entry point: the front slot.
create or replace function private.begin_body_photo(p_user uuid,p_policy text,p_object_key text,p_bytes integer,p_mime text,
  p_width integer,p_height integer) returns uuid
language sql security definer set search_path = '' as $$
  select private.begin_body_photo_at(p_user,'front',p_policy,p_object_key,p_bytes,p_mime,p_width,p_height);
$$;

-- The newest ready photo of the SAME angle replaces the previous one of that angle only.
create or replace function private.finish_body_photo(p_user uuid,p_asset uuid,p_ok boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare angle text;
begin
  select body_angle into angle from private.assets where id=p_asset and user_id=p_user and kind='body_photo' and state='processing';
  if angle is null then return false; end if;
  if p_ok then
    update private.assets set state='deleting' where user_id=p_user and kind='body_photo' and body_angle=angle
      and state in ('ready','rejected') and id<>p_asset;
    update private.assets set state='ready' where id=p_asset;
  else
    update private.assets set state='rejected' where id=p_asset;
  end if;
  return true;
end $$;

-- Latest usable row per angle.
create or replace function private.list_body_photos(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'angle',a.body_angle,'state',a.state,'mime',a.mime,'width',a.width,
    'height',a.height,'created_at',a.created_at,'expires_at',a.expires_at) order by a.created_at desc),'[]'::jsonb)
  from (select distinct on (body_angle) * from private.assets
    where user_id=p_user and kind='body_photo' and state in ('ready','processing','rejected')
      and (expires_at is null or expires_at>clock_timestamp())
    order by body_angle, (state='ready') desc, created_at desc) a;
$$;

-- Removes one angle at once for use (storage cleanup stays the pending 'deleting' workflow).
create function private.remove_body_photo_at(p_user uuid,p_angle text) returns integer
language sql security definer set search_path = '' as $$
  with removed as (
    update private.assets set state='deleting'
    where user_id=p_user and kind='body_photo' and body_angle=p_angle and state in ('ready','processing','rejected')
    returning 1)
  select count(*)::integer from removed;
$$;

-- Same rules as 20261120000100, but the job photo is the actor's latest ready FRONT photo:
-- the provider uses only the front view, side/profile never reach it.
create or replace function private.enqueue_look_job(p_user uuid,p_key text,p_hash text,p_policy text,
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
  if variant is null then
    select min(v.id::text)::uuid into variant from public.product_variants v where v.product_id=p_product and v.available is true
      having count(*)=1;
    if variant is null then raise exception 'variant choice required' using errcode='23514'; end if;
  end if;
  select p.category_id into category from public.products p join public.product_variants v on v.product_id=p.id
    where p.id=p_product and v.id=variant and p.published and p.rights_cleared and v.available is true;
  if category is null then raise exception 'catalog variant unavailable' using errcode='23514'; end if;
  select id into photo from private.assets where user_id=p_user and kind='body_photo' and body_angle='front' and state='ready'
    and expires_at>statement_timestamp() order by created_at desc,id limit 1;
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

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261121000100'::text $$;

revoke all on function private.begin_body_photo_at(uuid,text,text,text,integer,text,integer,integer),
  private.remove_body_photo_at(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.begin_body_photo_at(uuid,text,text,text,integer,text,integer,integer),
  private.remove_body_photo_at(uuid,text) to stylai_api;

commit;
