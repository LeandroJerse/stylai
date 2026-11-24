-- Explicit visual references are not supplier SKUs or stock declarations.
alter table public.product_variants add column kind text not null default 'sku'
  check (kind in ('sku','image_reference'));
alter table public.product_variants add constraint image_reference_is_not_stock
  check (kind <> 'image_reference' or (available is null and external_variant_id like 'stylai:image-reference%'));
create unique index one_image_reference_per_product on public.product_variants(product_id) where kind='image_reference';
-- Evidence belongs to the authorized URL, never to a mutable image row alone.
create function private.revoke_changed_image_rights() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.url is distinct from old.url or new.product_id is distinct from old.product_id or new.variant_id is distinct from old.variant_id then
  update private.catalog_image_rights set try_on_allowed=false where image_id=old.id;
 end if;
 return new;
end $$;
revoke all on function private.revoke_changed_image_rights() from public,anon,authenticated,service_role;
create trigger revoke_changed_image_rights before update on public.product_images
for each row execute function private.revoke_changed_image_rights();
alter table private.ai_job_items add column expected_image_url text;
alter policy catalog_variants on public.product_variants using (kind='sku' and exists(select 1 from public.products p where p.id=product_variants.product_id));

create or replace function private.catalog_product_json(p public.products) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.id,'name',p.name,'price_minor',p.price_minor,'currency',p.currency,
    'availability',p.availability,'source_updated_at',p.source_updated_at,'product_url',p.product_url,
    'fixture',p.fixture,'created_at',p.created_at,
    'category',(select jsonb_build_object('id',c.id,'label',c.label) from public.categories c where c.id=p.category_id),
    'partner',(select jsonb_build_object('id',pa.id,'name',pa.name,'source',pa.source) from public.partners pa where pa.id=p.partner_id),
    'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'available',v.available) order by v.label,v.id)
      from public.product_variants v where v.product_id=p.id and v.kind='sku'),'[]'::jsonb),
    'images',coalesce((select jsonb_agg(jsonb_build_object('url',i.url,'alt',i.alt,'position',i.position,
      'try_on_allowed',coalesce(r.try_on_allowed,false)) order by i.position)
      from public.product_images i left join private.catalog_image_rights r on r.image_id=i.id where i.product_id=p.id),'[]'::jsonb));
$$;

create or replace function private.ai_variant_json(p_product uuid, p_variant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('product_id',p.id,'variant_id',v.id,'name',p.name,'category_id',p.category_id,
    'source',pa.source,'partner',pa.name,'external_product_id',p.external_product_id,'reference_kind',v.kind,'external_variant_id',case when v.kind='sku' then v.external_variant_id else null end,
    'variant_label',v.label,'product_url',p.product_url,'price_minor',p.price_minor,'currency',p.currency,
    'availability',p.availability,'variant_available',v.available,'published',p.published,'rights_cleared',p.rights_cleared,
    'source_updated_at',p.source_updated_at,'fixture',p.fixture,
    'image_url',(select i.url from public.product_images i join private.catalog_image_rights r on r.image_id=i.id and r.try_on_allowed
      where i.product_id=p.id and (i.variant_id=v.id or i.variant_id is null)
      order by (i.variant_id is null),i.position limit 1))
  from public.products p join public.product_variants v on v.product_id=p.id join public.partners pa on pa.id=p.partner_id
  where p.id=p_product and v.id=p_variant;
$$;

create or replace function private.enqueue_composition_job(p_user uuid, p_key text, p_hash text, p_policy text, p_items jsonb,
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
        where pv.product_id=(it.v->>'product_id')::uuid and (pv.available is true or pv.kind='image_reference') having count(*)=1;
      if variant is null then raise exception 'variant choice required' using errcode='23514'; end if;
    end if;
    select p.category_id into category from public.products p join public.product_variants pv on pv.product_id=p.id
      where p.id=(it.v->>'product_id')::uuid and pv.id=variant and p.published and p.rights_cleared and (pv.available is true or pv.kind='image_reference');
    if category is null then raise exception 'catalog variant unavailable' using errcode='23514'; end if;
    if private.slot_of_category(category) is distinct from (it.v->>'slot') then
      raise exception 'piece does not match slot' using errcode='23514';
    end if;
    if (private.ai_variant_json((it.v->>'product_id')::uuid, variant)->>'image_url') is null then
      raise exception 'try-on rights missing' using errcode='SA003';
    end if;
    if exists(select 1 from public.product_variants where id=variant and kind='image_reference')
      and (it.v->>'image_url') is distinct from (private.ai_variant_json((it.v->>'product_id')::uuid,variant)->>'image_url') then
      raise exception 'composition image changed' using errcode='SA004';
    end if;
    if (it.v->>'slot') = any(slots) then raise exception 'duplicate slot' using errcode='23514'; end if;
    slots := slots || (it.v->>'slot');
    resolved := resolved || jsonb_build_object('slot',it.v->>'slot','product_id',it.v->>'product_id','variant_id',variant,'category_id',category,'image_url',it.v->>'image_url');
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
  insert into private.ai_job_items(job_id,position,slot,product_id,variant_id,category_id,expected_image_url)
    select job, row_number() over (order by private.slot_render_rank(value->>'slot')), value->>'slot',
      (value->>'product_id')::uuid, (value->>'variant_id')::uuid, value->>'category_id',value->>'image_url'
    from jsonb_array_elements(resolved);
  update private.ai_jobs set parent_version_id=p_parent_version, lineage_bound=true, composition_id=p_composition where id=job;
  return job;
end $$;

create or replace function private.record_job_item_snapshot(p_job uuid, p_fence bigint, p_position smallint, p_snapshot jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare item private.ai_job_items%rowtype;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'invalid snapshot' using errcode='23514'; end if;
  perform 1 from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  select * into item from private.ai_job_items where job_id=p_job and position=p_position for update;
  if not found then raise exception 'job item unavailable' using errcode='42501'; end if;
  if not exists (select 1 from public.products p join public.product_variants v on v.product_id=p.id
      where p.id=item.product_id and v.id=item.variant_id and p.published and p.rights_cleared and (v.available is true or v.kind='image_reference'))
     or (private.ai_variant_json(item.product_id,item.variant_id)->>'image_url') is null then
    raise exception 'try-on rights missing' using errcode='SA003';
  end if;
  if item.expected_image_url is not null and
    (item.expected_image_url is distinct from p_snapshot->>'garment_image_url' or
     item.expected_image_url is distinct from private.ai_variant_json(item.product_id,item.variant_id)->>'image_url') then
    raise exception 'composition image changed' using errcode='SA004';
  end if;
  if item.snapshot is not null then
    -- A recovered job whose piece changed (price/title/link) must fail explicitly, not look like a lost lease.
    if item.snapshot is distinct from p_snapshot then raise exception 'job item snapshot changed' using errcode='SA004'; end if;
    return true;
  end if;
  update private.ai_job_items set snapshot=p_snapshot where job_id=p_job and position=p_position;
  return true;
end $$;

create or replace function private.record_ai_selection(p_job uuid,p_fence bigint,p_product uuid,p_variant uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare owner_id uuid;
begin
  select user_id into owner_id from private.ai_jobs where id=p_job;
  perform 1 from public.profiles where id=owner_id and deletion_state='active' for update;
  if not found then return false; end if;
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if job.requested_variant_id is not null and (p_product,p_variant) is distinct from (job.requested_product_id,job.requested_variant_id) then
    raise exception 'requested variant cannot be substituted' using errcode='23514';
  end if;
  if not exists(select 1 from public.products p join public.product_variants v on v.product_id=p.id
    where p.id=p_product and v.id=p_variant and p.category_id=job.category_id and p.published and p.rights_cleared and (v.available is true or (v.kind='image_reference' and private.ai_variant_json(p.id,v.id)->>'image_url' is not null))) then
    raise exception 'catalog variant unavailable' using errcode='23514';
  end if;
  insert into private.ai_job_selection(job_id,product_id,variant_id,search_snapshot) values(p_job,p_product,p_variant,p_snapshot)
    on conflict(job_id) do nothing;
  if found then return true; end if;
  if not exists(select 1 from private.ai_job_selection where job_id=p_job
    and (product_id,variant_id,search_snapshot) is not distinct from (p_product,p_variant,p_snapshot)) then
    raise exception 'job selection already recorded' using errcode='23505';
  end if;
  return false;
end $$;

-- Read-only, bounded resolution. The API cannot authorize new images or write catalog rows.
create function private.read_source_generation_references(p_source text,p_items jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('externalProductId',p.external_product_id,'imageUrl',i.url,
   'productId',p.id,'variantId',v.id,'referenceKind',v.kind)),'[]'::jsonb)
 from (select value from jsonb_array_elements(case when jsonb_typeof(p_items)='array' then p_items else '[]'::jsonb end) limit 36) requested
 join public.partners pa on pa.source=p_source and p_source='aliexpress'
 join public.products p on p.partner_id=pa.id and p.external_product_id=requested.value->>'externalProductId'
 join public.product_variants v on v.product_id=p.id and v.kind='image_reference'
 join public.product_images i on i.product_id=p.id and i.url=requested.value->>'imageUrl'
 join private.catalog_image_rights r on r.image_id=i.id and r.try_on_allowed
 where p.published and p.rights_cleared and p.availability<>'unavailable'
   and private.ai_variant_json(p.id,v.id)->>'image_url'=i.url;
$$;
revoke all on function private.read_source_generation_references(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.read_source_generation_references(text,jsonb) to stylai_api;
-- Check at each paid dispatch, including layers after an earlier render has completed.
create or replace function private.begin_provider_call(p_call uuid,p_fence bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.provider_calls%rowtype; declare item record; declare current_image text;
begin
 select * into c from private.provider_calls where id=p_call for update;
 if not found or c.status<>'reserved' then return false; end if;
 perform 1 from private.ai_jobs where id=c.job_id and status='running' and fence=p_fence and lease_until>clock_timestamp() for share;
 if not found then return false; end if;
 if c.operation='generation' then
  for item in select i.product_id,i.variant_id,i.expected_image_url,i.snapshot from private.ai_job_items i where i.job_id=c.job_id loop
   current_image := private.ai_variant_json(item.product_id,item.variant_id)->>'image_url';
   if current_image is null or not exists(select 1 from public.products p where p.id=item.product_id and p.published and p.rights_cleared and p.availability<>'unavailable') then
    raise exception 'try-on rights missing at dispatch' using errcode='SA003';
   end if;
   if (item.expected_image_url is not null and current_image is distinct from item.expected_image_url)
     or (item.snapshot->>'garment_image_url' is not null and current_image is distinct from item.snapshot->>'garment_image_url') then
    raise exception 'selected image changed at dispatch' using errcode='SA004';
   end if;
  end loop;
 end if;
 update private.provider_calls set status='dispatched',started_at=clock_timestamp() where id=p_call;
 return true;
end $$;
create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path='' as $$ select '20261124003226'::text $$;
create or replace function private.load_ai_job(p_job uuid,p_fence bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'user_id',j.user_id,'category_id',j.category_id,'search_query',j.search_query,
    'parent_version_id',j.parent_version_id,'composition_id',j.composition_id,
    'photo',jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,
      'usable',a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())),
    'variant',case when j.requested_variant_id is null then null else private.ai_variant_json(j.requested_product_id,j.requested_variant_id) end,
    'items',coalesce((select jsonb_agg(private.ai_variant_json(i.product_id,i.variant_id) || jsonb_build_object('slot',i.slot,'position',i.position) || coalesce((select jsonb_build_object('canonical_id',candidate->>'id','affiliate_url',candidate->'links'->>'affiliateUrl')
        from private.look_compositions lc, jsonb_array_elements(lc.plan->'slots') sl, jsonb_array_elements(sl->'candidates') candidate
        where lc.id=j.composition_id and candidate->'generationReference'->>'productId'=i.product_id::text
          and candidate->'generationReference'->>'variantId'=i.variant_id::text limit 1),'{}'::jsonb)
      order by i.position) from private.ai_job_items i where i.job_id=j.id),'[]'::jsonb))
  from private.ai_jobs j join private.assets a on a.id=j.photo_id
  where j.id=p_job and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp();
$$;

alter table private.ai_pilots add column allowed_product_ids uuid[] check (allowed_product_ids is null or cardinality(allowed_product_ids) between 1 and 12);
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
  elsif not exists(select 1 from private.ai_job_selection where job_id=j.id) or exists (
    select 1 from (
      select product_id from private.ai_job_items where job_id=j.id
      union all select product_id from private.ai_job_selection where job_id=j.id
        and not exists(select 1 from private.ai_job_items where job_id=j.id)
    ) selected
    join public.products p on p.id=selected.product_id join public.partners pa on pa.id=p.partner_id
    where pa.source is distinct from pilot.allowed_source or
      case when pilot.allowed_product_ids is not null then not (p.id=any(pilot.allowed_product_ids))
        else pa.external_seller_id is distinct from pilot.allowed_seller end
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
