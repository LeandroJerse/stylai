-- Server-side photo validation bound to the EXACT stored photo version.
-- Upload -> 'processing' (candidate) -> the API runs the local pose validator on the stored bytes
-- -> settle_body_photo_validation records the result for that asset and its sha256:
--   approved                  -> candidate becomes 'ready' and replaces the previous photo of the same angle;
--   needs_adjustment/inconclusive/error -> candidate becomes 'rejected' (kept for display and retry);
--                                the previous ready photo of that angle stays in use.
-- A job only takes a ready FRONT photo whose validation is 'approved' (never a client flag).
begin;

alter table private.assets
  add column content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add column validation_status text check (validation_status in ('approved','needs_adjustment','inconclusive','error')),
  add column validator_version text check (length(validator_version) between 1 and 80),
  add column validation jsonb check (validation is null or jsonb_typeof(validation)='object'),
  add column validated_at timestamptz;

-- Rows written without an angle (earlier code paths, fixtures) are front photos.
create function private.default_body_angle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind='body_photo' and new.body_angle is null then new.body_angle := 'front'; end if;
  return new;
end $$;
create trigger assets_default_body_angle before insert on private.assets
  for each row execute function private.default_body_angle();
revoke all on function private.default_body_angle() from public,anon,authenticated,service_role;

create function private.set_body_photo_hash(p_user uuid,p_asset uuid,p_sha text) returns boolean
language sql security definer set search_path = '' as $$
  with done as (update private.assets set content_sha256=p_sha
    where id=p_asset and user_id=p_user and kind='body_photo' and state in ('processing','rejected') returning 1)
  select exists(select 1 from done);
$$;

-- Records the validator outcome for one candidate. Only the API role calls it, after reading the
-- stored bytes itself; the result is tied to the sha256 recorded for that asset. True = now in use.
create function private.settle_body_photo_validation(p_user uuid,p_asset uuid,p_sha text,p_status text,
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
  if p_status='approved' then
    update private.assets set state='deleting' where user_id=p_user and kind='body_photo' and body_angle=a.body_angle
      and state in ('ready','rejected') and id<>p_asset;
  end if;
  return p_status='approved';
end $$;

-- Reuse: a result already computed for the same bytes and validator version (no second analysis).
create function private.read_cached_photo_validation(p_user uuid,p_sha text,p_version text,p_angle text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status',a.validation_status,'result',a.validation) from private.assets a
  where a.user_id=p_user and a.kind='body_photo' and a.content_sha256=p_sha and a.validator_version=p_version
    and a.body_angle=p_angle and a.validation_status in ('approved','needs_adjustment','inconclusive')
  order by a.validated_at desc limit 1;
$$;

-- Per angle: the photo in use (ready) and, when newer, the latest candidate (processing/rejected).
create or replace function private.list_body_photos(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with live as (
    select * from private.assets where user_id=p_user and kind='body_photo' and state in ('ready','processing','rejected')
      and (expires_at is null or expires_at>clock_timestamp())),
  current as (select distinct on (body_angle) * from live where state='ready' order by body_angle, created_at desc),
  candidate as (select distinct on (l.body_angle) l.* from live l where l.state<>'ready'
    and not exists (select 1 from current c where c.body_angle=l.body_angle and c.created_at>l.created_at)
    order by l.body_angle, l.created_at desc)
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'angle',x.body_angle,'state',x.state,'mime',x.mime,'width',x.width,
    'height',x.height,'created_at',x.created_at,'expires_at',x.expires_at,'validation_status',x.validation_status,
    'validator_version',x.validator_version,'validation',x.validation) order by x.created_at desc),'[]'::jsonb)
  from (select * from current union all select * from candidate) x;
$$;

-- Owner can see their candidate too (display and retry), never a deleted one.
create or replace function private.read_body_photo_asset(p_user uuid,p_asset uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,'bytes',a.bytes)
  from private.assets a where a.id=p_asset and a.user_id=p_user and a.kind='body_photo'
    and a.state in ('ready','processing','rejected') and a.expires_at>clock_timestamp();
$$;

-- Generation requires the approved front photo version.
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
    and validation_status='approved' and expires_at>statement_timestamp() order by created_at desc,id limit 1;
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
language sql immutable security invoker set search_path = '' as $$ select '20261121000200'::text $$;

revoke all on function private.set_body_photo_hash(uuid,uuid,text),
  private.settle_body_photo_validation(uuid,uuid,text,text,text,jsonb),
  private.read_cached_photo_validation(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.set_body_photo_hash(uuid,uuid,text),
  private.settle_body_photo_validation(uuid,uuid,text,text,text,jsonb),
  private.read_cached_photo_validation(uuid,text,text,text) to stylai_api;

commit;
