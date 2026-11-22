-- QA-001 / QA-005: the photo that a job uses must be approved by the CURRENT pose rules and support the
-- garment group of the chosen product. Checked atomically in enqueue_look_job (the API pre-check only
-- explains; it is never the guarantee). Unknown category or missing/malformed metadata = refused.
-- Approvals made by older rules are not trusted: they become "revalidate" (same bytes, new rules).
begin;

-- Same map as the worker's categoryMap and packages/contracts CATEGORY_GROUP.
create function private.category_garment_group(p_category text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case p_category when 'tops' then 'upper' when 'jackets' then 'upper' when 'shirts' then 'upper'
    when 'bottoms' then 'lower' when 'pants' then 'lower' when 'dresses' then 'dress' else null end;
$$;

-- Rules version an approval must carry to be used (packages/contracts POSE_RULES_VERSION).
create function private.required_pose_rules() returns text
language sql immutable security invoker set search_path = '' as $$ select 'pose-rules/2'::text $$;

create or replace function private.enqueue_look_job(p_user uuid,p_key text,p_hash text,p_policy text,
  p_product uuid,p_variant uuid,p_parent_version uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare job uuid;
declare current private.ai_jobs%rowtype;
declare photo uuid;
declare category text;
declare garment text;
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
  garment := private.category_garment_group(category);
  if garment is null then raise exception 'category not renderable' using errcode='23514'; end if;
  -- Lock the chosen photo row: a concurrent replacement/removal waits and cannot swap it under the job.
  select id into photo from private.assets where user_id=p_user and kind='body_photo' and body_angle='front' and state='ready'
    and validation_status='approved' and expires_at>statement_timestamp()
    order by created_at desc,id limit 1 for update;
  if photo is null then raise exception 'photo unavailable' using errcode='42501'; end if;
  if not exists (select 1 from private.assets where id=photo
      and split_part(validator_version,'+',2)=private.required_pose_rules()) then
    raise exception 'photo revalidation required' using errcode='SA002';
  end if;
  if not exists (select 1 from private.assets where id=photo and jsonb_typeof(validation->'supports')='object'
      and (validation->'supports'->>garment)='true') then
    raise exception 'photo framing insufficient' using errcode='SA001';
  end if;
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

-- Approvals by older rules stop being "in use": shown as "não foi possível validar" with a retry that
-- re-runs the current rules on the same stored bytes (POST /v1/me/body-photos/:angle/revalidate).
update private.assets set state='rejected', validation_status='error',
  validation=coalesce(validation,'{}'::jsonb) || jsonb_build_object('status','error','supports',
    jsonb_build_object('upper',false,'lower',false,'dress',false),
    'issues',jsonb_build_array(jsonb_build_object('code','rules_updated',
      'message','Atualizamos o validador de fotos. Toque em “Tentar validar de novo” para conferir esta foto.')))
where kind='body_photo' and state='ready' and validation_status='approved'
  and split_part(coalesce(validator_version,''),'+',2)<>private.required_pose_rules();

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261121000300'::text $$;

revoke all on function private.category_garment_group(text), private.required_pose_rules()
  from public,anon,authenticated,service_role;

commit;
