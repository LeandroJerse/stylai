-- Autonomous outfit flow (docs/superpowers/plans/2026-11-24-fluxo-autonomo.md). ADDITIVE:
--   * source_image_policies + register_source_reference: automatic, auditable, revocable product references
--     (one policy per source; the API can register under an ACTIVE policy only, never widen it);
--   * outfit_searches / outfit_sets / outfit_set_revisions: every suggestion survives a reload, choices are append-only;
--   * outfit_renders (individual = 1 panel, comparison = 2..4): existing ai_jobs under one batch whose whole budget
--     (money scopes, pilot money and pilot attempts) is held atomically before the first job exists;
--   * ai_pilots.allow_policy_references (default FALSE): a pilot keeps refusing automatic references until the
--     operator opens it. No limit, attempt or licence changes here.
-- Rollback: drop the new functions/tables/columns and restore the previous function bodies (20261124011126).
begin;

-- ------------------------------------------------------------------ complete sets as a garment slot
insert into public.categories(id,label) values ('outfit_sets','Conjuntos') on conflict (id) do nothing;
create or replace function private.slot_of_category(p_category text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case p_category when 'tops' then 'upper' when 'shirts' then 'upper' when 'pants' then 'lower'
    when 'bottoms' then 'lower' when 'dresses' then 'dress' when 'jackets' then 'outer' when 'outfit_sets' then 'set' else null end;
$$;
create or replace function private.slot_render_rank(p_slot text) returns integer
language sql immutable security invoker set search_path = '' as $$
  select case p_slot when 'set' then 0 when 'dress' then 1 when 'lower' then 2 when 'upper' then 3 when 'outer' then 4 else null end;
$$;
-- A complete set covers the whole body, like a one-piece.
create or replace function private.slot_photo_group(p_slot text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case p_slot when 'set' then 'dress' when 'dress' then 'dress' when 'lower' then 'lower' else 'upper' end;
$$;
alter table private.ai_job_items drop constraint ai_job_items_slot_check;
alter table private.ai_job_items add constraint ai_job_items_slot_check check (slot in ('upper','lower','dress','outer','set'));
alter table private.look_version_items drop constraint look_version_items_slot_check;
alter table private.look_version_items add constraint look_version_items_slot_check check (slot in ('upper','lower','dress','outer','set'));

-- ------------------------------------------------------------------ revocable source policy + reference cache
create table private.source_image_policies (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  source text not null check (source in ('aliexpress')),
  version integer not null check (version > 0),
  scope text not null check (length(scope) between 3 and 200),
  evidence text not null check (length(btrim(evidence)) between 20 and 500),
  image_hosts text[] not null check (cardinality(image_hosts) between 1 and 8),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) between 1 and 200),
  unique (source, version)
);
create unique index one_active_source_policy on private.source_image_policies(source) where revoked_at is null;
insert into private.source_image_policies(id,source,version,scope,evidence,image_hosts) values
  ('aliexpress-try-on-v1','aliexpress',1,'Imagem principal do anúncio como referência do provador StylAI',
   'Declaração do operador Leandro (2026-11-23, reiterada em 2026-11-24): imagens de produtos AliExpress podem ser usadas no provador. Declaração não verificada independentemente; não cobre outras fontes.',
   array['alicdn.com','aliexpress-media.com']);

alter table private.catalog_image_rights
  add column policy_id text references private.source_image_policies(id),
  -- Null with try_on_allowed=false = withdrawn by the operator: never granted again automatically.
  add column withdrawn_by text check (withdrawn_by in ('url_changed','policy'));

create table private.source_reference_cache (
  image_id uuid primary key references public.product_images(id) on delete cascade,
  policy_id text not null references private.source_image_policies(id),
  url text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_key text not null check (object_key ~ '^catalog/[A-Za-z0-9_.-]{1,120}$'),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  bytes integer not null check (bytes between 1 and 4194304),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '72 hours'
);
create index source_reference_cache_expiry on private.source_reference_cache(expires_at);
create index source_reference_cache_object on private.source_reference_cache(object_key);

create or replace function private.revoke_changed_image_rights() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.url is distinct from old.url or new.product_id is distinct from old.product_id or new.variant_id is distinct from old.variant_id then
  update private.catalog_image_rights set try_on_allowed=false,withdrawn_by='url_changed' where image_id=old.id and try_on_allowed;
  delete from private.source_reference_cache where image_id=old.id;
 end if;
 return new;
end $$;
-- Withdrawing a policy closes everything registered under it, immediately and without a deploy.
create function private.withdraw_policy_rights() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    update private.catalog_image_rights set try_on_allowed=false,withdrawn_by='policy' where policy_id=new.id and try_on_allowed;
    update private.source_reference_cache set expires_at=clock_timestamp() where policy_id=new.id;
  end if;
  return new;
end $$;
create trigger withdraw_policy_rights after update of revoked_at on private.source_image_policies
  for each row execute function private.withdraw_policy_rights();

-- The API already downloaded and validated the bytes; this records them under the ACTIVE policy of that source.
-- Never trusts the client: the host, category and product identity are checked again here.
create function private.register_source_reference(p_source text,p_item jsonb,p_check jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy private.source_image_policies%rowtype;
declare host text := lower(substring(p_item->>'imageUrl' from '^https://([A-Za-z0-9.-]+)/'));
declare external text := p_item->>'externalProductId';
declare partner uuid; declare product uuid; declare owner_partner uuid; declare variant uuid; declare image uuid; declare n integer;
declare rights private.catalog_image_rights%rowtype;
begin
  select * into policy from private.source_image_policies where source=p_source and revoked_at is null for share;
  if not found then raise exception 'no active image policy for source' using errcode='SA003'; end if;
  if host is null or not exists(select 1 from unnest(policy.image_hosts) h where host=h or host like '%.'||h) then
    raise exception 'image host outside policy' using errcode='SA003';
  end if;
  if external !~ '^[0-9]{1,24}$' or length(btrim(coalesce(p_item->>'name',''))) < 1 or private.slot_of_category(p_item->>'category') is null then
    raise exception 'invalid source item' using errcode='23514';
  end if;
  if coalesce(p_item->>'productUrl','') !~ '^https://([a-z0-9-]+\.)*aliexpress\.(com|us)/' then raise exception 'invalid product url' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_source||':'||external,0));
  insert into public.categories(id,label) values (p_item->>'category',p_item->>'category') on conflict (id) do nothing;
  insert into public.partners(source,external_seller_id,region,name) values (p_source,left(p_item->>'seller',120),'BR',left(p_item->>'sellerName',200))
    on conflict (source,region,external_seller_id) do update set name=excluded.name returning id into partner;
  select count(*) into n from public.products p join public.partners pa on pa.id=p.partner_id where pa.source=p_source and p.external_product_id=external;
  if n > 1 then raise exception 'ambiguous source product' using errcode='SA006'; end if;
  select p.id,p.partner_id into product,owner_partner from public.products p join public.partners pa on pa.id=p.partner_id
    where pa.source=p_source and p.external_product_id=external;
  if product is not null then
    if owner_partner<>partner then raise exception 'source product seller changed' using errcode='SA006'; end if;
    if exists(select 1 from public.product_variants where product_id=product and kind<>'image_reference') then
      raise exception 'supplier SKUs require review' using errcode='SA006';
    end if;
    update public.products set name=left(p_item->>'name',160),category_id=p_item->>'category',price_minor=(p_item->>'priceMinor')::bigint,
      product_url=p_item->>'productUrl',source_updated_at=(p_item->>'observedAt')::timestamptz,published=true,rights_cleared=true where id=product;
  else
    insert into public.products(partner_id,external_product_id,category_id,name,price_minor,currency,product_url,availability,published,rights_cleared,fixture,source_updated_at)
      values(partner,external,p_item->>'category',left(p_item->>'name',160),(p_item->>'priceMinor')::bigint,'BRL',p_item->>'productUrl','unknown',true,true,false,(p_item->>'observedAt')::timestamptz)
      returning id into product;
  end if;
  insert into public.product_variants(product_id,external_variant_id,label,available,kind)
    values(product,'stylai:image-reference','Referência visual; tamanho não informado',null,'image_reference')
    on conflict (product_id,external_variant_id) do update set label=excluded.label returning id into variant;
  select id into image from public.product_images where product_id=product and position=0 for update;
  if image is null then
    insert into public.product_images(product_id,variant_id,url,position) values(product,variant,p_item->>'imageUrl',0) returning id into image;
  else
    update public.product_images set url=p_item->>'imageUrl',variant_id=variant where id=image and (url is distinct from p_item->>'imageUrl' or variant_id is distinct from variant);
  end if;
  select * into rights from private.catalog_image_rights where image_id=image for update;
  if found and not rights.try_on_allowed and rights.withdrawn_by is null then
    raise exception 'image withdrawn by the operator' using errcode='SA003';
  end if;
  insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed,policy_id)
    values(image,'owner_authorized',left('Política '||policy.id||' v'||policy.version||': '||policy.evidence,500),true,policy.id)
    on conflict (image_id) do update set try_on_allowed=true,withdrawn_by=null,
      -- A manual, per-image authorization keeps its own evidence; policy grants are always traceable to the policy.
      policy_id=case when private.catalog_image_rights.try_on_allowed and private.catalog_image_rights.policy_id is null then null else excluded.policy_id end,
      evidence=case when private.catalog_image_rights.try_on_allowed and private.catalog_image_rights.policy_id is null then private.catalog_image_rights.evidence else excluded.evidence end,
      recorded_at=case when private.catalog_image_rights.try_on_allowed then private.catalog_image_rights.recorded_at else now() end;
  insert into private.source_reference_cache(image_id,policy_id,url,sha256,object_key,mime,bytes,width,height)
    values(image,policy.id,p_item->>'imageUrl',p_check->>'sha256',p_check->>'objectKey',p_check->>'mime',(p_check->>'bytes')::integer,(p_check->>'width')::integer,(p_check->>'height')::integer)
    on conflict (image_id) do update set policy_id=excluded.policy_id,url=excluded.url,sha256=excluded.sha256,object_key=excluded.object_key,mime=excluded.mime,
      bytes=excluded.bytes,width=excluded.width,height=excluded.height,verified_at=now(),expires_at=now()+interval '72 hours';
  return jsonb_build_object('externalProductId',external,'imageUrl',p_item->>'imageUrl','productId',product,'variantId',variant,'referenceKind','image_reference');
end $$;

-- Fresh cached references of this source (no new download while verified bytes exist).
create function private.read_cached_source_references(p_source text,p_items jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(r || jsonb_build_object('sha256',c.sha256)),'[]'::jsonb)
  from jsonb_array_elements(private.read_source_generation_references(p_source,p_items)) r
  join public.product_images i on i.product_id=(r->>'productId')::uuid and i.url=r->>'imageUrl'
  join private.source_reference_cache c on c.image_id=i.id and c.url=i.url and c.expires_at>clock_timestamp()+interval '1 hour';
$$;

-- Cached bytes are discarded when they expire or their policy is withdrawn; shared objects stay while any row needs them.
create function private.claim_reference_purges(p_limit integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(object_key),'[]'::jsonb) from (
    select c.object_key from private.source_reference_cache c group by c.object_key
    having max(c.expires_at)<=clock_timestamp() limit least(greatest(p_limit,1),50)) x;
$$;
create function private.finish_reference_purge(p_key text,p_ok boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not p_ok then return false; end if;
  delete from private.source_reference_cache where object_key=p_key and expires_at<=clock_timestamp();
  return found;
end $$;

-- Automatic references are try-on material, not local catalog content.
create or replace function private.list_catalog_products(p_limit integer,p_offset integer,p_category text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with listed as (
    select p.* from public.products p where p.published and p.rights_cleared and (p_category is null or p.category_id=p_category)
      and not exists(select 1 from public.product_variants v where v.product_id=p.id and v.kind='image_reference'))
  select jsonb_build_object('total',(select count(*) from listed),
    'items',coalesce((select jsonb_agg(private.catalog_product_json(x::public.products) order by x.created_at desc,x.id) from (
      select * from listed p order by p.created_at desc,p.id offset greatest(p_offset,0) limit least(greatest(p_limit,1),48)) x),'[]'::jsonb));
$$;

-- ------------------------------------------------------------------ searches, sets, revisions
create table private.outfit_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  prompt text not null check (length(btrim(prompt)) between 1 and 500),
  source text not null check (source in ('curated','aliexpress_affiliate')),
  model text check (model is null or length(model) between 1 and 128),
  status text not null default 'running' check (status in ('running','succeeded','empty','failed','cancelled')),
  stage text not null default 'interpreting' check (stage in ('interpreting','planning','searching','selecting','preparing','done')),
  stage_detail jsonb not null default '{}' check (jsonb_typeof(stage_detail)='object' and octet_length(stage_detail::text)<=8192),
  selection_method text check (selection_method in ('agent','rules_fallback')),
  error_code text check (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  plan jsonb not null default '{}' check (jsonb_typeof(plan)='object' and octet_length(plan::text)<=262144),
  lease_until timestamptz not null default clock_timestamp()+interval '2 minutes',
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id,request_key),
  unique (user_id,id),
  check ((status='running') = (finished_at is null))
);
create index outfit_searches_history on private.outfit_searches(user_id,created_at desc);
create table private.outfit_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  search_id uuid not null,
  position smallint not null check (position between 1 and 4),
  kind text not null check (kind in ('bundle','assembled')),
  recommended boolean not null default false,
  title text not null check (length(title) between 1 and 80),
  rationale text not null default '' check (length(rationale)<=200),
  missing_slots jsonb not null default '[]',
  current_revision integer not null default 1 check (current_revision>0),
  created_at timestamptz not null default now(),
  unique (search_id,position),
  unique (user_id,id),
  foreign key (user_id,search_id) references private.outfit_searches(user_id,id) on delete cascade
);
create index outfit_sets_by_search on private.outfit_sets(user_id,search_id);
create table private.outfit_set_revisions (
  set_id uuid not null,
  revision integer not null check (revision>0),
  user_id uuid not null,
  origin text not null check (origin in ('suggested','swap','resuggest','refresh')),
  pieces jsonb not null check (jsonb_typeof(pieces)='array' and jsonb_array_length(pieces) between 1 and 3 and octet_length(pieces::text)<=16384),
  locked jsonb not null default '[]' check (jsonb_typeof(locked)='array' and jsonb_array_length(locked)<=3),
  total_minor bigint check (total_minor>=0),
  created_at timestamptz not null default now(),
  primary key (set_id,revision),
  foreign key (user_id,set_id) references private.outfit_sets(user_id,id) on delete cascade
);

create function private.create_outfit_search(p_user uuid,p_key text,p_hash text,p_prompt text,p_source text,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.outfit_searches%rowtype; declare new_id uuid;
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'inactive account' using errcode='42501'; end if;
  select * into prior from private.outfit_searches where user_id=p_user and request_key=p_key;
  if found then
    if prior.request_hash<>p_hash then raise exception 'request key conflict' using errcode='23505'; end if;
    return jsonb_build_object('id',prior.id,'created',false);
  end if;
  if exists(select 1 from private.outfit_searches where user_id=p_user and status='running' and lease_until>clock_timestamp()) then
    raise exception 'active search exists' using errcode='23505';
  end if;
  if (select count(*) from private.outfit_searches where user_id=p_user and created_at>statement_timestamp()-interval '1 day')>=60 then
    raise exception 'daily search limit' using errcode='23514';
  end if;
  insert into private.outfit_searches(user_id,request_key,request_hash,prompt,source,model) values(p_user,p_key,p_hash,p_prompt,p_source,p_model) returning id into new_id;
  return jsonb_build_object('id',new_id,'created',true);
end $$;

create function private.update_outfit_search(p_user uuid,p_id uuid,p_stage text,p_detail jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update private.outfit_searches set stage=p_stage,stage_detail=coalesce(p_detail,'{}'),lease_until=clock_timestamp()+interval '2 minutes'
    where id=p_id and user_id=p_user and status='running';
  return found;
end $$;

create function private.finish_outfit_search(p_user uuid,p_id uuid,p_status text,p_error text,p_method text,p_plan jsonb,p_sets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; declare i integer := 0; declare new_id uuid; declare ids jsonb := '[]'::jsonb;
begin
  if p_status not in ('succeeded','empty','failed') then raise exception 'invalid status' using errcode='23514'; end if;
  if p_status='succeeded' and (jsonb_typeof(p_sets) is distinct from 'array' or jsonb_array_length(p_sets) not between 1 and 4) then
    raise exception 'one to four outfits required' using errcode='23514';
  end if;
  update private.outfit_searches set status=p_status,stage='done',error_code=p_error,selection_method=p_method,plan=coalesce(p_plan,'{}'),finished_at=clock_timestamp()
    where id=p_id and user_id=p_user and status='running';
  if not found then return null; end if;
  if p_status='succeeded' then
    for s in select value from jsonb_array_elements(p_sets) loop
      i := i+1;
      insert into private.outfit_sets(user_id,search_id,position,kind,recommended,title,rationale,missing_slots)
        values(p_user,p_id,i,s->>'kind',coalesce((s->>'recommended')::boolean,false),s->>'title',coalesce(s->>'rationale',''),coalesce(s->'missingSlots','[]')) returning id into new_id;
      insert into private.outfit_set_revisions(set_id,revision,user_id,origin,pieces,total_minor)
        values(new_id,1,p_user,'suggested',s->'pieces',(s->>'totalMinor')::bigint);
      ids := ids || to_jsonb(new_id);
    end loop;
  end if;
  return ids;
end $$;

create function private.cancel_outfit_search(p_user uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update private.outfit_searches set status='cancelled',finished_at=clock_timestamp() where id=p_id and user_id=p_user and status='running';
  return found;
end $$;

create function private.outfit_set_json(s private.outfit_sets) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'search_id',s.search_id,'position',s.position,'kind',s.kind,'recommended',s.recommended,'title',s.title,
    'rationale',s.rationale,'missing_slots',s.missing_slots,'revision',s.current_revision,'created_at',s.created_at,
    'pieces',r.pieces,'locked',r.locked,'total_minor',r.total_minor,'origin',r.origin)
  from private.outfit_set_revisions r where r.set_id=s.id and r.revision=s.current_revision;
$$;
create function private.read_outfit_search(p_user uuid,p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',q.id,'prompt',q.prompt,'source',q.source,'model',q.model,
    -- The API process died mid-search: an explicit, recoverable state instead of an eternal spinner.
    'status',case when q.status='running' and q.lease_until<=clock_timestamp() then 'interrupted' else q.status end,
    'stage',q.stage,'stage_detail',q.stage_detail,'selection_method',q.selection_method,'error_code',q.error_code,'plan',q.plan,
    'created_at',q.created_at,'finished_at',q.finished_at,
    'sets',coalesce((select jsonb_agg(private.outfit_set_json(s) order by s.position) from private.outfit_sets s where s.search_id=q.id),'[]'::jsonb))
  from private.outfit_searches q where q.id=p_id and q.user_id=p_user;
$$;
create function private.list_outfit_searches(p_user uuid,p_limit integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]'::jsonb) from (
    select q.created_at,jsonb_build_object('id',q.id,'prompt',q.prompt,'created_at',q.created_at,
      'status',case when q.status='running' and q.lease_until<=clock_timestamp() then 'interrupted' else q.status end,
      'sets',(select count(*) from private.outfit_sets s where s.search_id=q.id)) as item
    from private.outfit_searches q where q.user_id=p_user order by q.created_at desc limit least(greatest(p_limit,1),30)) x;
$$;
create function private.read_outfit_set(p_user uuid,p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.outfit_set_json(s) || jsonb_build_object('plan',q.plan,'source',q.source,
    'revisions',(select jsonb_agg(jsonb_build_object('revision',r.revision,'origin',r.origin,'pieces',r.pieces,'locked',r.locked,'total_minor',r.total_minor,'created_at',r.created_at) order by r.revision)
      from private.outfit_set_revisions r where r.set_id=s.id))
  from private.outfit_sets s join private.outfit_searches q on q.id=s.search_id where s.id=p_id and s.user_id=p_user;
$$;
-- Append-only; a stale base (another tab changed the set) is refused instead of overwritten.
create function private.save_outfit_set_revision(p_user uuid,p_set uuid,p_base integer,p_origin text,p_pieces jsonb,p_locked jsonb,p_total bigint) returns integer
language plpgsql security definer set search_path='' as $$
declare s private.outfit_sets%rowtype;
begin
  select * into s from private.outfit_sets where id=p_set and user_id=p_user for update;
  if not found then raise exception 'outfit unavailable' using errcode='42501'; end if;
  if s.current_revision<>p_base then raise exception 'stale revision' using errcode='40001'; end if;
  if s.current_revision>=200 then raise exception 'revision limit' using errcode='23514'; end if;
  insert into private.outfit_set_revisions(set_id,revision,user_id,origin,pieces,locked,total_minor) values(p_set,p_base+1,p_user,p_origin,p_pieces,p_locked,p_total);
  update private.outfit_sets set current_revision=p_base+1 where id=p_set;
  return p_base+1;
end $$;

-- Locks are a working preference of the current revision (kept across reloads), not content: no new revision.
create function private.set_outfit_locks(p_user uuid,p_set uuid,p_base integer,p_locked jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare s private.outfit_sets%rowtype;
begin
  select * into s from private.outfit_sets where id=p_set and user_id=p_user for update;
  if not found then raise exception 'outfit unavailable' using errcode='42501'; end if;
  if s.current_revision<>p_base then raise exception 'stale revision' using errcode='40001'; end if;
  if jsonb_typeof(p_locked) is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(p_locked) l
      where l not in (select x->>'slot' from private.outfit_set_revisions r, jsonb_array_elements(r.pieces) x where r.set_id=p_set and r.revision=p_base)) then
    raise exception 'lock without piece' using errcode='23514';
  end if;
  update private.outfit_set_revisions set locked=p_locked where set_id=p_set and revision=p_base;
  return true;
end $$;

-- ------------------------------------------------------------------ renders (batches), panels, budget holds
create table private.outfit_renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('individual','comparison')),
  photo_id uuid not null,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  provider text not null, model text not null,
  reserve_usd_micros bigint not null check (reserve_usd_micros between 1 and 1000000000),
  pilot_id text references private.ai_pilots(id),
  -- individual: not_applicable. comparison: waiting -> pending -> building -> ready | failed.
  comparison_state text not null check (comparison_state in ('not_applicable','waiting','pending','building','ready','failed')),
  comparison_asset_id uuid references private.assets(id) on delete set null,
  comparison_layout jsonb,
  comparison_error text check (comparison_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  comparison_attempts integer not null default 0,
  fence bigint not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id,request_key),
  unique (user_id,id),
  check ((mode='individual') = (comparison_state='not_applicable'))
);
create index outfit_renders_history on private.outfit_renders(user_id,created_at desc);
create index outfit_renders_buildable on private.outfit_renders(created_at) where comparison_state in ('pending','building');
create table private.outfit_render_panels (
  render_id uuid not null,
  panel smallint not null check (panel between 1 and 4),
  user_id uuid not null,
  set_id uuid not null,
  revision integer not null,
  label text not null check (length(label) between 1 and 80),
  dropped boolean not null default false,
  primary key (render_id,panel),
  foreign key (user_id,render_id) references private.outfit_renders(user_id,id) on delete cascade,
  foreign key (set_id,revision) references private.outfit_set_revisions(set_id,revision) on delete cascade
);
create index outfit_render_panels_set on private.outfit_render_panels(set_id);

alter table private.ai_jobs
  add column render_id uuid references private.outfit_renders(id) on delete set null,
  add column panel smallint check (panel between 1 and 4);
create index ai_jobs_by_panel on private.ai_jobs(render_id,panel,created_at) where render_id is not null;
drop index private.ai_jobs_one_active;
-- Still one active request per person: panels of ONE batch are the only exception (enforced under the profile lock).
create unique index ai_jobs_one_active on private.ai_jobs(user_id) where status in ('queued','running') and render_id is null;
create unique index ai_jobs_one_active_panel on private.ai_jobs(render_id,panel) where status in ('queued','running') and render_id is not null;
alter table private.ai_job_items add column commerce jsonb check (commerce is null or jsonb_typeof(commerce)='object');

-- Money and attempts of the WHOLE batch, held before any job runs. One hold per job, turned into the job's own
-- provider_call reservation at dispatch time, or released when the job ends without one.
create table private.outfit_budget_holds (
  job_id uuid primary key references private.ai_jobs(id) on delete cascade,
  user_id uuid not null,
  provider text not null,
  pilot_id text references private.ai_pilots(id),
  held_usd_micros bigint not null check (held_usd_micros between 1 and 1000000000),
  budget_day date not null,
  budget_month date not null,
  released_at timestamptz
);
create index outfit_budget_holds_open on private.outfit_budget_holds(pilot_id) where released_at is null;

alter table private.ai_pilots add column allow_policy_references boolean not null default false;

create function private.release_outfit_hold(p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare h private.outfit_budget_holds%rowtype; declare s record;
begin
  update private.outfit_budget_holds set released_at=clock_timestamp() where job_id=p_job and released_at is null returning * into h;
  if not found then return false; end if;
  for s in select * from (values (1,'global','*','day',h.budget_day),(2,'global','*','month',h.budget_month),
      (3,'provider',h.provider,'day',h.budget_day),(4,'provider',h.provider,'month',h.budget_month),(5,'user',h.user_id::text,'day',h.budget_day))
      as t(ord,scope,scope_key,period,period_start) order by ord loop
    update private.provider_budget_usage u set reserved_usd_micros=greatest(u.reserved_usd_micros-h.held_usd_micros,0)
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start;
  end loop;
  return true;
end $$;
create function private.release_hold_of_settled_job() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('queued','running') and old.status in ('queued','running') then perform private.release_outfit_hold(new.id); end if;
  return new;
end $$;
create trigger ai_jobs_release_hold after update of status on private.ai_jobs for each row execute function private.release_hold_of_settled_job();

-- Read-only budget picture for a batch: what fits, what does not and why (shown BEFORE confirmation, enforced again at enqueue).
create function private.outfit_budget(p_user uuid,p_provider text,p_model text,p_reserve bigint,p_calls integer,p_pilot text,p_products uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d date := (statement_timestamp() at time zone 'UTC')::date;
declare m date := date_trunc('month',(statement_timestamp() at time zone 'UTC'))::date;
declare needed bigint; declare s record; declare lim private.provider_budget_limits%rowtype; declare used bigint; declare remaining bigint;
declare min_remaining bigint; declare limiting jsonb := '[]'::jsonb; declare pilot private.ai_pilots%rowtype; declare agg record; declare held record; declare pilot_json jsonb;
begin
  if p_calls is null or p_calls not between 1 and 4 or p_reserve is null or p_reserve not between 1 and 1000000000 then raise exception 'invalid budget request' using errcode='23514'; end if;
  needed := p_calls*p_reserve;
  for s in select * from (values (1,'global','*','day',d),(2,'global','*','month',m),(3,'provider',p_provider,'day',d),(4,'provider',p_provider,'month',m),
      (5,'user',p_user::text,'day',d)) as t(ord,scope,scope_key,period,period_start) order by ord loop
    select * into lim from private.provider_budget_limits l where l.scope=s.scope and l.period=s.period and l.scope_key in (s.scope_key,'*') order by (l.scope_key='*') limit 1;
    if not found then limiting := limiting || to_jsonb(s.scope); min_remaining := 0; continue; end if;
    select coalesce(sum(u.reserved_usd_micros+u.spent_usd_micros),0) into used from private.provider_budget_usage u
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start;
    remaining := case when lim.paused then 0 else greatest(lim.limit_usd_micros-used,0) end;
    min_remaining := least(coalesce(min_remaining,remaining),remaining);
    if remaining<needed and not (limiting ? s.scope) then limiting := limiting || to_jsonb(s.scope); end if;
  end loop;
  select * into lim from private.provider_budget_limits l where l.scope='job' and l.period='job' and l.scope_key='*';
  if not found or lim.paused or lim.limit_usd_micros<p_reserve then limiting := limiting || '"job"'::jsonb; end if;
  if p_pilot is not null then
    select * into pilot from private.ai_pilots where id=p_pilot;
    if not found then limiting := limiting || '"pilot_missing"'::jsonb; min_remaining := 0;
    else
      select count(*) filter (where pc.status<>'released')::integer as attempts, count(*) filter (where pc.status='unknown')::integer as uncertain,
        coalesce(sum(pc.settled_usd_micros) filter (where pc.status in ('succeeded','failed')),0)::bigint
          + coalesce(sum(pc.reserved_usd_micros) filter (where pc.status in ('reserved','dispatched','unknown')),0)::bigint as money
        into agg from private.ai_pilot_dispatches pd join private.provider_calls pc on pc.id=pd.provider_call_id where pd.pilot_id=p_pilot;
      select count(*)::integer as calls,coalesce(sum(held_usd_micros),0)::bigint as money into held from private.outfit_budget_holds where pilot_id=p_pilot and released_at is null;
      remaining := greatest(pilot.limit_usd_micros-agg.money-held.money,0);
      min_remaining := least(min_remaining,remaining);
      pilot_json := jsonb_build_object('id',pilot.id,'remaining_usd_micros',remaining,'limit_usd_micros',pilot.limit_usd_micros,'max_attempts',pilot.max_attempts,
        'remaining_attempts',greatest(pilot.max_attempts-agg.attempts-held.calls,0),'paused',pilot.paused_at is not null);
      if pilot.paused_at is not null then limiting := limiting || '"pilot_paused"'::jsonb; end if;
      if pilot.allowed_user_id is distinct from p_user then limiting := limiting || '"pilot_user"'::jsonb; end if;
      if agg.uncertain>0 then limiting := limiting || '"pilot_uncertain"'::jsonb; end if;
      if pilot.max_attempts-agg.attempts-held.calls<p_calls then limiting := limiting || '"pilot_attempts"'::jsonb; end if;
      if remaining<needed then limiting := limiting || '"pilot_budget"'::jsonb; end if;
      if not (case when pilot.allowed_targets is null then pilot.provider=p_provider and pilot.model=p_model
          else exists(select 1 from jsonb_array_elements(pilot.allowed_targets) t where t->>'provider'=p_provider and t->>'model'=p_model) end) then
        limiting := limiting || '"pilot_target"'::jsonb; end if;
      if exists(select 1 from unnest(coalesce(p_products,'{}')) x where not private.pilot_allows_product(pilot.id,x)) then limiting := limiting || '"pilot_items"'::jsonb; end if;
    end if;
  end if;
  return jsonb_build_object('ok',jsonb_array_length(limiting)=0,'calls',p_calls,'reserve_usd_micros',p_reserve,'needed_usd_micros',needed,
    'remaining_usd_micros',coalesce(min_remaining,0),'limiting',limiting,'pilot',pilot_json);
end $$;

-- A pilot's closed product list, optionally extended (operator switch) to references under an ACTIVE source policy.
create function private.pilot_allows_product(p_pilot text,p_product uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.ai_pilots pilot, public.products p join public.partners pa on pa.id=p.partner_id
    where pilot.id=p_pilot and p.id=p_product and pa.source=pilot.allowed_source and (
      case when pilot.allowed_product_ids is not null then p.id=any(pilot.allowed_product_ids) else pa.external_seller_id=pilot.allowed_seller end
      or (pilot.allow_policy_references and exists(select 1 from public.product_images i join private.catalog_image_rights r on r.image_id=i.id and r.try_on_allowed
        join private.source_image_policies sp on sp.id=r.policy_id and sp.revoked_at is null and sp.source=pa.source where i.product_id=p.id))));
$$;

-- ------------------------------------------------------------------ job creation shared by every path
create function private.insert_ai_job(p_user uuid,p_key text,p_hash text,p_photo uuid,p_category text,p_policy text,p_query text,p_product uuid,p_variant uuid,
  p_render uuid,p_panel smallint) returns uuid
language plpgsql security definer set search_path = '' as $$
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
  if exists (select 1 from private.ai_jobs where user_id=p_user and status in ('queued','running') and (p_render is null or render_id is distinct from p_render)) then
    raise exception 'active request exists' using errcode='23505';
  end if;
  select case when exists (select 1 from private.ai_memberships where user_id=p_user and revoked_at is null
    and valid_from<=statement_timestamp() and valid_until>statement_timestamp()) then 12 else 3 end into allowance;
  insert into private.ai_daily_usage(user_id,usage_date) values(p_user,day) on conflict do nothing;
  update private.ai_daily_usage set reserved=reserved+1 where user_id=p_user and usage_date=day and reserved+spent<allowance;
  if not found then raise exception 'daily allowance exhausted' using errcode='23514'; end if;
  insert into private.ai_jobs(user_id,request_key,request_hash,photo_id,consent_id,category_id,usage_date,allowance,search_query,requested_product_id,requested_variant_id,render_id,panel)
    values(p_user,p_key,p_hash,p_photo,consent,p_category,day,allowance,p_query,p_product,p_variant,p_render,p_panel) returning id into job;
  return job;
end $$;
create or replace function private.enqueue_ai_job(p_user uuid,p_key text,p_hash text,p_photo uuid,p_category text,p_policy text,
  p_query text default '',p_product uuid default null,p_variant uuid default null)
returns uuid language sql security definer set search_path = '' as $$
  select private.insert_ai_job(p_user,p_key,p_hash,p_photo,p_category,p_policy,p_query,p_product,p_variant,null,null);
$$;

-- Same rules as before (rights, image match, slots, photo framing); p_render/p_panel bind a batch panel.
create function private.insert_composition_job(p_user uuid, p_key text, p_hash text, p_policy text, p_items jsonb,
  p_parent_version uuid, p_composition uuid, p_render uuid, p_panel smallint) returns uuid
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
    resolved := resolved || jsonb_build_object('slot',it.v->>'slot','product_id',it.v->>'product_id','variant_id',variant,'category_id',category,
      'image_url',it.v->>'image_url','commerce',it.v->'commerce');
  end loop;
  if 'dress' = any(slots) and ('upper' = any(slots) or 'lower' = any(slots)) then
    raise exception 'dress excludes top and bottom' using errcode='23514';
  end if;
  if 'set' = any(slots) and ('upper' = any(slots) or 'lower' = any(slots) or 'dress' = any(slots)) then
    raise exception 'a complete set excludes top, bottom and one-piece' using errcode='23514';
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
  -- Panels of one batch always use one photo.
  if p_render is not null and not exists(select 1 from private.outfit_renders where id=p_render and user_id=p_user and photo_id=photo) then
    raise exception 'photo replaced since the batch started' using errcode='SA010';
  end if;
  select value into primary_item from jsonb_array_elements(resolved) order by private.slot_render_rank(value->>'slot') limit 1;
  job := private.insert_ai_job(p_user,p_key,p_hash,photo,primary_item->>'category_id',p_policy,'',
    (primary_item->>'product_id')::uuid,(primary_item->>'variant_id')::uuid,p_render,p_panel);
  select * into current from private.ai_jobs where id=job for update;
  if current.lineage_bound then
    if current.parent_version_id is distinct from p_parent_version or current.composition_id is distinct from p_composition then
      raise exception 'request key conflict' using errcode='23505';
    end if;
    return job;
  end if;
  insert into private.ai_job_items(job_id,position,slot,product_id,variant_id,category_id,expected_image_url,commerce)
    select job, row_number() over (order by private.slot_render_rank(value->>'slot')), value->>'slot',
      (value->>'product_id')::uuid, (value->>'variant_id')::uuid, value->>'category_id',value->>'image_url',nullif(value->'commerce','null'::jsonb)
    from jsonb_array_elements(resolved);
  update private.ai_jobs set parent_version_id=p_parent_version, lineage_bound=true, composition_id=p_composition where id=job;
  return job;
end $$;
create or replace function private.enqueue_composition_job(p_user uuid, p_key text, p_hash text, p_policy text, p_items jsonb,
  p_parent_version uuid, p_composition uuid) returns uuid
language sql security definer set search_path = '' as $$
  select private.insert_composition_job(p_user,p_key,p_hash,p_policy,p_items,p_parent_version,p_composition,null,null);
$$;

-- Holds p_calls reservations in every scope and in the pilot, or fails without leaving anything.
create function private.hold_outfit_budget(p_user uuid,p_provider text,p_model text,p_reserve bigint,p_pilot text,p_jobs uuid[],p_products uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare d date := (statement_timestamp() at time zone 'UTC')::date;
declare m date := date_trunc('month',(statement_timestamp() at time zone 'UTC'))::date;
declare total bigint := p_reserve*cardinality(p_jobs); declare s record; declare lim private.provider_budget_limits%rowtype; declare q jsonb;
begin
  if p_pilot is not null then perform 1 from private.ai_pilots where id=p_pilot for update; end if;
  q := private.outfit_budget(p_user,p_provider,p_model,p_reserve,cardinality(p_jobs),p_pilot,p_products);
  if not (q->>'ok')::boolean then raise exception 'batch budget unavailable: %',q->'limiting' using errcode='SA007'; end if;
  for s in select * from (values (1,'global','*','day',d),(2,'global','*','month',m),(3,'provider',p_provider,'day',d),(4,'provider',p_provider,'month',m),
      (5,'user',p_user::text,'day',d)) as t(ord,scope,scope_key,period,period_start) order by ord loop
    select * into lim from private.provider_budget_limits l where l.scope=s.scope and l.period=s.period and l.scope_key in (s.scope_key,'*') order by (l.scope_key='*') limit 1;
    insert into private.provider_budget_usage(scope,scope_key,period,period_start) values(s.scope,s.scope_key,s.period,s.period_start) on conflict do nothing;
    update private.provider_budget_usage u set reserved_usd_micros=u.reserved_usd_micros+total
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start
        and not lim.paused and u.reserved_usd_micros+u.spent_usd_micros+total<=lim.limit_usd_micros;
    if not found then raise exception 'batch budget exhausted: % %',s.scope,s.period using errcode='SA007'; end if;
  end loop;
  insert into private.outfit_budget_holds(job_id,user_id,provider,pilot_id,held_usd_micros,budget_day,budget_month)
    select x,p_user,p_provider,p_pilot,p_reserve,d,m from unnest(p_jobs) x;
end $$;

-- p_panels: [{set_id, revision, label, items:[{slot,product_id,variant_id,image_url,commerce}]}]
create function private.enqueue_outfit_render(p_user uuid,p_key text,p_hash text,p_policy text,p_mode text,p_provider text,p_model text,p_reserve bigint,
  p_pilot text,p_panels jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior private.outfit_renders%rowtype; declare n integer; declare photo uuid; declare render uuid; declare pn jsonb; declare i integer := 0;
declare jobs uuid[] := '{}'; declare products uuid[];
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'inactive account' using errcode='42501'; end if;
  select * into prior from private.outfit_renders where user_id=p_user and request_key=p_key;
  if found then
    if prior.request_hash<>p_hash then raise exception 'request key conflict' using errcode='23505'; end if;
    return prior.id;
  end if;
  if jsonb_typeof(p_panels) is distinct from 'array' then raise exception 'panels required' using errcode='23514'; end if;
  n := jsonb_array_length(p_panels);
  if p_mode='individual' and n<>1 or p_mode='comparison' and n not between 2 and 4 or p_mode not in ('individual','comparison') then
    raise exception 'invalid number of outfits' using errcode='23514';
  end if;
  if (select count(distinct value->>'set_id') from jsonb_array_elements(p_panels))<>n then raise exception 'repeated outfit' using errcode='23514'; end if;
  if exists(select 1 from private.ai_jobs where user_id=p_user and status in ('queued','running')) then raise exception 'active request exists' using errcode='23505'; end if;
  select id into photo from private.assets where user_id=p_user and kind='body_photo' and body_angle='front' and state='ready'
    and validation_status='approved' and expires_at>statement_timestamp() order by created_at desc,id limit 1 for update;
  if photo is null then raise exception 'photo unavailable' using errcode='42501'; end if;
  insert into private.outfit_renders(user_id,mode,photo_id,request_key,request_hash,provider,model,reserve_usd_micros,pilot_id,comparison_state)
    values(p_user,p_mode,photo,p_key,p_hash,p_provider,p_model,p_reserve,p_pilot,case p_mode when 'individual' then 'not_applicable' else 'waiting' end) returning id into render;
  for pn in select value from jsonb_array_elements(p_panels) loop
    i := i+1;
    if not exists(select 1 from private.outfit_set_revisions where set_id=(pn->>'set_id')::uuid and revision=(pn->>'revision')::integer and user_id=p_user) then
      raise exception 'outfit unavailable' using errcode='42501';
    end if;
    insert into private.outfit_render_panels(render_id,panel,user_id,set_id,revision,label)
      values(render,i,p_user,(pn->>'set_id')::uuid,(pn->>'revision')::integer,left(coalesce(nullif(btrim(pn->>'label'),''),'Conjunto '||i),80));
    jobs := jobs || private.insert_composition_job(p_user,'render_'||replace(render::text,'-','')||'_'||i||'_1',p_hash,p_policy,pn->'items',null,null,render,i::smallint);
  end loop;
  select array_agg(distinct ji.product_id) into products from private.ai_job_items ji where ji.job_id=any(jobs);
  perform private.hold_outfit_budget(p_user,p_provider,p_model,p_reserve,p_pilot,jobs,products);
  return render;
end $$;

-- Only the panel that failed: same pieces, same photo, new job. Never resends an unknown outcome; a second charge needs acceptance.
create function private.retry_outfit_panel(p_user uuid,p_render uuid,p_panel smallint,p_policy text,p_provider text,p_model text,p_reserve bigint,p_pilot text,
  p_accept_charge boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare r private.outfit_renders%rowtype; declare last private.ai_jobs%rowtype; declare n integer; declare job uuid; declare items jsonb; declare products uuid[];
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'inactive account' using errcode='42501'; end if;
  select * into r from private.outfit_renders where id=p_render and user_id=p_user for update;
  if not found then raise exception 'render unavailable' using errcode='42501'; end if;
  if not exists(select 1 from private.outfit_render_panels where render_id=p_render and panel=p_panel and not dropped) then raise exception 'panel unavailable' using errcode='23514'; end if;
  select * into last from private.ai_jobs where render_id=p_render and panel=p_panel order by created_at desc,id desc limit 1;
  if last.status in ('queued','running') then raise exception 'panel already running' using errcode='23505'; end if;
  if exists(select 1 from private.ai_jobs j join private.look_versions v on v.job_id=j.id where j.render_id=p_render and j.panel=p_panel) then
    raise exception 'panel already has a result' using errcode='23514';
  end if;
  if exists(select 1 from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.render_id=p_render and j.panel=p_panel and c.status in ('reserved','dispatched','unknown')) then
    raise exception 'previous outcome needs reconciliation' using errcode='SA008';
  end if;
  if not coalesce(p_accept_charge,false) and exists(select 1 from private.provider_calls c join private.ai_jobs j on j.id=c.job_id
      where j.render_id=p_render and j.panel=p_panel and coalesce(c.settled_usd_micros,0)>0) then
    raise exception 'previous attempt was charged' using errcode='SA009';
  end if;
  select count(*) into n from private.ai_jobs where render_id=p_render and panel=p_panel;
  if n>=5 then raise exception 'retry limit' using errcode='23514'; end if;
  select jsonb_agg(jsonb_build_object('slot',i.slot,'product_id',i.product_id,'variant_id',i.variant_id,'image_url',i.expected_image_url,'commerce',i.commerce) order by i.position),
    array_agg(distinct i.product_id) into items,products from private.ai_job_items i where i.job_id=last.id;
  job := private.insert_composition_job(p_user,'render_'||replace(p_render::text,'-','')||'_'||p_panel||'_'||(n+1),r.request_hash,p_policy,items,null,null,p_render,p_panel);
  perform private.hold_outfit_budget(p_user,p_provider,p_model,p_reserve,p_pilot,array[job],products);
  return p_render;
end $$;

-- Only panels that did not start: a running paid call is never abandoned half-way.
create function private.cancel_outfit_render(p_user uuid,p_render uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare j uuid; declare n integer := 0;
begin
  perform 1 from private.outfit_renders where id=p_render and user_id=p_user for update;
  if not found then raise exception 'render unavailable' using errcode='42501'; end if;
  for j in select id from private.ai_jobs where render_id=p_render and user_id=p_user and status='queued' loop
    if private.cancel_ai_job(p_user,j) then n := n+1; end if;
  end loop;
  return n;
end $$;

-- "Montar com os prontos": explicit choice to drop panels without a result (or to rebuild a montage that failed).
create function private.finalize_outfit_render(p_user uuid,p_render uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.outfit_renders%rowtype; declare ready integer;
begin
  select * into r from private.outfit_renders where id=p_render and user_id=p_user for update;
  if not found then raise exception 'render unavailable' using errcode='42501'; end if;
  if r.mode<>'comparison' or r.comparison_state not in ('waiting','failed') then raise exception 'comparison cannot be finalized now' using errcode='23514'; end if;
  if exists(select 1 from private.ai_jobs where render_id=p_render and status in ('queued','running')) then raise exception 'panels still running' using errcode='23514'; end if;
  select count(*) into ready from private.outfit_render_panels p where p.render_id=p_render and not p.dropped
    and exists(select 1 from private.ai_jobs j join private.look_versions v on v.job_id=j.id where j.render_id=p.render_id and j.panel=p.panel);
  if ready<2 then raise exception 'at least two results required' using errcode='23514'; end if;
  update private.outfit_render_panels p set dropped=true where p.render_id=p_render and not p.dropped
    and not exists(select 1 from private.ai_jobs j join private.look_versions v on v.job_id=j.id where j.render_id=p.render_id and j.panel=p.panel);
  update private.outfit_renders set comparison_state='pending',comparison_attempts=0,comparison_error=null,lease_until=null where id=p_render;
  return true;
end $$;

create function private.read_outfit_render(p_user uuid,p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'mode',r.mode,'provider',r.provider,'model',r.model,'reserve_usd_micros',r.reserve_usd_micros,'created_at',r.created_at,
    'comparison_state',r.comparison_state,'comparison_error',r.comparison_error,'comparison_layout',r.comparison_layout,
    'comparison',(select jsonb_build_object('width',a.width,'height',a.height) from private.assets a where a.id=r.comparison_asset_id and a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())),
    'photo_current',r.photo_id=(select a.id from private.assets a where a.user_id=r.user_id and a.kind='body_photo' and a.body_angle='front' and a.state='ready' and a.validation_status='approved' and a.expires_at>clock_timestamp() order by a.created_at desc,a.id limit 1),
    'panels',coalesce((select jsonb_agg(jsonb_build_object('panel',p.panel,'set_id',p.set_id,'revision',p.revision,'label',p.label,'dropped',p.dropped,
        'search_id',(select s.search_id from private.outfit_sets s where s.id=p.set_id),
        'pieces',(select rv.pieces from private.outfit_set_revisions rv where rv.set_id=p.set_id and rv.revision=p.revision),
        'attempts',(select count(*) from private.ai_jobs j where j.render_id=p.render_id and j.panel=p.panel),
        'job',(select jsonb_build_object('id',j.id,'status',j.status,'failure_code',j.failure_code,'finished_at',j.finished_at) from private.ai_jobs j
          where j.render_id=p.render_id and j.panel=p.panel order by j.created_at desc,j.id desc limit 1),
        'version_id',(select v.id from private.ai_jobs j join private.look_versions v on v.job_id=j.id where j.render_id=p.render_id and j.panel=p.panel limit 1),
        'charge_state',case when exists(select 1 from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.render_id=p.render_id and j.panel=p.panel and c.status in ('dispatched','unknown')
              and j.status not in ('queued','running')) then 'unknown'
          when exists(select 1 from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.render_id=p.render_id and j.panel=p.panel and coalesce(c.settled_usd_micros,0)>0) then 'charged' else 'none' end,
        'settled_usd_micros',(select coalesce(sum(c.settled_usd_micros),0) from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.render_id=p.render_id and j.panel=p.panel)
      ) order by p.panel) from private.outfit_render_panels p where p.render_id=r.id),'[]'::jsonb))
  from private.outfit_renders r where r.id=p_id and r.user_id=p_user;
$$;
create function private.list_outfit_renders(p_user uuid,p_limit integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(private.read_outfit_render(p_user,x.id) order by x.created_at desc),'[]'::jsonb) from (
    select id,created_at from private.outfit_renders where user_id=p_user order by created_at desc limit least(greatest(p_limit,1),20)) x;
$$;
create function private.read_comparison_asset(p_user uuid,p_render uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,'bytes',a.bytes)
  from private.outfit_renders r join private.assets a on a.id=r.comparison_asset_id and a.user_id=r.user_id
  where r.id=p_render and r.user_id=p_user and r.comparison_state='ready' and a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp());
$$;

-- ------------------------------------------------------------------ worker: serialized panels, holds, montage
create or replace function private.next_ai_job() returns uuid
language sql stable security definer set search_path = '' as $$
  select j.id from private.ai_jobs j
  where (j.status='queued' or (j.status='running' and j.lease_until<=clock_timestamp()))
    and not (j.render_id is not null and exists(select 1 from private.ai_jobs o where o.render_id=j.render_id and o.id<>j.id and o.status='running' and o.lease_until>clock_timestamp()))
  order by j.created_at,j.panel nulls first,j.id limit 1;
$$;
create or replace function private.claim_ai_job(p_job uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare render uuid; declare f bigint;
begin
  select render_id into render from private.ai_jobs where id=p_job;
  if render is not null then
    perform 1 from private.outfit_renders where id=render for update;
    if exists(select 1 from private.ai_jobs o where o.render_id=render and o.id<>p_job and o.status='running' and o.lease_until>clock_timestamp()) then return null; end if;
  end if;
  update private.ai_jobs j set status='running', fence=j.fence+1, lease_until=clock_timestamp()+interval '2 minutes'
  where j.id=p_job and (j.status='queued' or (j.status='running' and j.lease_until<=clock_timestamp()))
    and exists (select 1 from public.profiles p where p.id=j.user_id and p.deletion_state='active')
    and exists (select 1 from private.assets a where a.id=j.photo_id and a.state='ready' and a.expires_at>clock_timestamp())
    and exists (select 1 from private.photo_consents c where c.id=j.consent_id and c.revoked_at is null)
  returning j.fence into f;
  return f;
end $$;

create or replace function private.load_ai_job(p_job uuid,p_fence bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',j.id,'user_id',j.user_id,'category_id',j.category_id,'search_query',j.search_query,
    'parent_version_id',j.parent_version_id,'composition_id',j.composition_id,'render_id',j.render_id,'panel',j.panel,
    'photo',jsonb_build_object('bucket',a.bucket_id,'object_key',a.object_key,'mime',a.mime,
      'usable',a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())),
    'variant',case when j.requested_variant_id is null then null else private.ai_variant_json(j.requested_product_id,j.requested_variant_id) end,
    'items',coalesce((select jsonb_agg(private.ai_variant_json(i.product_id,i.variant_id) || jsonb_build_object('slot',i.slot,'position',i.position)
      || coalesce((select jsonb_build_object('canonical_id',candidate->>'id','affiliate_url',candidate->'links'->>'affiliateUrl')
        from private.look_compositions lc, jsonb_array_elements(lc.plan->'slots') sl, jsonb_array_elements(sl->'candidates') candidate
        where lc.id=j.composition_id and candidate->'generationReference'->>'productId'=i.product_id::text
          and candidate->'generationReference'->>'variantId'=i.variant_id::text limit 1),'{}'::jsonb)
      || coalesce((select jsonb_build_object('canonical_id',i.commerce->>'canonical_id','affiliate_url',i.commerce->>'affiliate_url') where i.commerce is not null),'{}'::jsonb)
      || coalesce((select jsonb_build_object('reference',jsonb_build_object('sha256',c.sha256,'object_key',c.object_key,'mime',c.mime))
        from public.product_images pi join private.source_reference_cache c on c.image_id=pi.id and c.url=pi.url and c.expires_at>clock_timestamp()
        where pi.product_id=i.product_id and pi.url=i.expected_image_url limit 1),'{}'::jsonb)
      order by i.position) from private.ai_job_items i where i.job_id=j.id),'[]'::jsonb))
  from private.ai_jobs j join private.assets a on a.id=j.photo_id
  where j.id=p_job and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp();
$$;

-- The batch hold becomes this call's own reservation in the same transaction (never counted twice, never lost in between).
alter function private.reserve_provider_call(uuid,bigint,text,text,text,text,text,bigint,text,text) rename to reserve_provider_call_unheld;
revoke all on function private.reserve_provider_call_unheld(uuid,bigint,text,text,text,text,text,bigint,text,text) from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;
create function private.reserve_provider_call(p_job uuid,p_fence bigint,p_provider text,p_model text,p_price_version text,
  p_operation text,p_key text,p_reserve bigint,p_user_ref text,p_environment text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
begin
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then raise exception 'job lease unavailable' using errcode='42501'; end if;
  if job.render_id is not null then
    -- A panel only ever spends what the person confirmed for it.
    if exists(select 1 from private.outfit_renders r where r.id=job.render_id and (r.provider<>p_provider or r.model<>p_model or r.reserve_usd_micros<p_reserve)) then
      raise exception 'provider differs from the confirmed batch' using errcode='23514';
    end if;
    perform private.release_outfit_hold(p_job);
  end if;
  return private.reserve_provider_call_unheld(p_job,p_fence,p_provider,p_model,p_price_version,p_operation,p_key,p_reserve,p_user_ref,p_environment);
end $$;

create or replace function private.check_layer_budget(p_job uuid, p_fence bigint, p_provider text, p_layers integer,
  p_reserve bigint, p_pilot text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare d date := (statement_timestamp() at time zone 'UTC')::date;
declare m date := date_trunc('month',(statement_timestamp() at time zone 'UTC'))::date;
declare needed bigint;
declare s record;
declare lim private.provider_budget_limits%rowtype;
declare own private.outfit_budget_holds%rowtype;
declare used bigint;
declare remaining bigint;
declare min_remaining bigint := null;
declare scopes jsonb := '[]'::jsonb;
declare limiting jsonb := '[]'::jsonb;
declare pilot private.ai_pilots%rowtype;
declare pilot_used bigint;
declare pilot_attempts integer;
declare held record;
declare pilot_json jsonb := null;
begin
  if p_layers is null or p_layers not between 1 and 3 or p_reserve is null or p_reserve not between 1 and 1000000000000 then
    raise exception 'invalid layer budget request' using errcode='23514';
  end if;
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp();
  if not found then raise exception 'job lease unavailable' using errcode='42501'; end if;
  -- The job's own batch hold is the money it is about to use.
  select * into own from private.outfit_budget_holds where job_id=p_job and released_at is null;
  needed := p_layers::bigint * p_reserve;
  for s in select * from (values
      (1,'global','*','day',d),(2,'global','*','month',m),
      (3,'provider',p_provider,'day',d),(4,'provider',p_provider,'month',m),
      (5,'user',job.user_id::text,'day',d),(6,'job',p_job::text,'job',date '1970-01-01')) as t(ord,scope,scope_key,period,period_start)
    order by ord loop
    select * into lim from private.provider_budget_limits l where l.scope=s.scope and l.period=s.period and l.scope_key in (s.scope_key,'*')
      order by (l.scope_key='*') limit 1;
    if not found then
      limiting := limiting || to_jsonb(s.scope); continue;   -- unconfigured scope: reserve_provider_call would refuse too
    end if;
    select coalesce(sum(u.reserved_usd_micros+u.spent_usd_micros),0) into used from private.provider_budget_usage u
      where u.scope=s.scope and u.scope_key=s.scope_key and u.period=s.period and u.period_start=s.period_start;
    if own.job_id is not null and s.scope<>'job' and (s.scope<>'provider' or own.provider=p_provider)
       and s.period_start=(case s.period when 'day' then own.budget_day else own.budget_month end) then
      used := greatest(used-own.held_usd_micros,0);
    end if;
    remaining := case when lim.paused then 0 else greatest(lim.limit_usd_micros-used,0) end;
    min_remaining := least(coalesce(min_remaining,remaining),remaining);
    scopes := scopes || jsonb_build_object('scope',s.scope,'period',s.period,'limit_usd_micros',lim.limit_usd_micros,
      'used_usd_micros',used,'remaining_usd_micros',remaining,'paused',lim.paused);
    if remaining < needed and not (limiting ? s.scope) then limiting := limiting || to_jsonb(s.scope); end if;
  end loop;
  if p_pilot is not null then
    select * into pilot from private.ai_pilots where id=p_pilot;
    if not found then
      limiting := limiting || '"pilot_missing"'::jsonb;
    else
      select coalesce(sum(case when c.status in ('succeeded','failed') then coalesce(c.settled_usd_micros,0) else c.reserved_usd_micros end),0),
             count(*) into pilot_used, pilot_attempts
        from private.ai_pilot_dispatches pd join private.provider_calls c on c.id=pd.provider_call_id
        where pd.pilot_id=p_pilot and c.status<>'released';
      select count(*)::integer as calls,coalesce(sum(held_usd_micros),0)::bigint as money into held
        from private.outfit_budget_holds where pilot_id=p_pilot and released_at is null and job_id<>p_job;
      pilot_used := pilot_used+held.money; pilot_attempts := pilot_attempts+held.calls;
      pilot_json := jsonb_build_object('limit_usd_micros',pilot.limit_usd_micros,'used_usd_micros',pilot_used,
        'remaining_usd_micros',greatest(pilot.limit_usd_micros-pilot_used,0),'max_attempts',pilot.max_attempts,
        'remaining_attempts',greatest(pilot.max_attempts-pilot_attempts,0),'paused',pilot.paused_at is not null);
      min_remaining := least(coalesce(min_remaining,greatest(pilot.limit_usd_micros-pilot_used,0)),greatest(pilot.limit_usd_micros-pilot_used,0));
      if pilot.paused_at is not null then limiting := limiting || '"pilot_paused"'::jsonb; end if;
      if greatest(pilot.limit_usd_micros-pilot_used,0) < needed then limiting := limiting || '"pilot_budget"'::jsonb; end if;
      if pilot.max_attempts-pilot_attempts < p_layers then limiting := limiting || '"pilot_attempts"'::jsonb; end if;
    end if;
  end if;
  return jsonb_build_object('ok',jsonb_array_length(limiting)=0,'layers',p_layers,'reserve_usd_micros',p_reserve,
    'needed_usd_micros',needed,'effective_ceiling_usd_micros',coalesce(min_remaining,0),
    'max_layers',least(3,coalesce(min_remaining,0)/p_reserve,
      coalesce((pilot_json->>'remaining_attempts')::bigint,3)),
    'limiting',limiting,'scopes',scopes,'pilot',pilot_json);
end $$;

-- Same gate; other batches' holds count as used, and the product rule lives in pilot_allows_product.
create or replace function private.reserve_pilot_dispatch(
  p_pilot text, p_call uuid, p_fence bigint, p_mode text, p_params jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pilot private.ai_pilots%rowtype;
declare c private.provider_calls%rowtype;
declare j private.ai_jobs%rowtype;
declare existing private.ai_pilot_dispatches%rowtype;
declare agg record;
declare held record;
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
    where not private.pilot_allows_product(p_pilot,selected.product_id)
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
    select count(*)::integer as calls, coalesce(sum(held_usd_micros),0)::bigint as money into held
      from private.outfit_budget_holds where pilot_id=p_pilot and released_at is null and job_id<>j.id;

    if agg.uncertain_count > 0 then
      reason := 'uncertain_outcome';
    elsif agg.in_flight > 0 then
      reason := 'in_flight';
    elsif agg.attempts_used + held.calls >= pilot.max_attempts then
      reason := 'max_attempts_reached';
    elsif agg.spent_usd_micros + agg.reserved_usd_micros + held.money + c.reserved_usd_micros > pilot.limit_usd_micros then
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

-- The last missing panel result makes the montage buildable (same transaction as the version).
create function private.mark_comparison_buildable() returns trigger
language plpgsql security definer set search_path='' as $$
declare render uuid;
begin
  select render_id into render from private.ai_jobs where id=new.job_id;
  if render is null then return new; end if;
  update private.outfit_renders r set comparison_state='pending' where r.id=render and r.comparison_state='waiting'
    and not exists(select 1 from private.outfit_render_panels p where p.render_id=r.id and not p.dropped
      and not exists(select 1 from private.ai_jobs j join private.look_versions v on v.job_id=j.id where j.render_id=p.render_id and j.panel=p.panel));
  return new;
end $$;
create trigger look_versions_comparison after insert on private.look_versions for each row execute function private.mark_comparison_buildable();

create function private.comparison_photo_ok(r private.outfit_renders) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.assets a join public.profiles p on p.id=r.user_id where a.id=r.photo_id and a.state='ready' and a.validation_status='approved'
      and (a.expires_at is null or a.expires_at>clock_timestamp()) and p.deletion_state='active')
    and exists(select 1 from private.photo_consents c where c.user_id=r.user_id and c.revoked_at is null);
$$;
create function private.claim_outfit_comparison() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.outfit_renders%rowtype; declare panels jsonb; declare expected integer;
begin
  select * into r from private.outfit_renders where (comparison_state='pending' and (lease_until is null or lease_until<=clock_timestamp()))
    or (comparison_state='building' and lease_until<=clock_timestamp()) order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  if not private.comparison_photo_ok(r) then
    update private.outfit_renders set comparison_state='failed',comparison_error='photo_removed',lease_until=null where id=r.id; return null;
  end if;
  select jsonb_agg(jsonb_build_object('panel',p.panel,'label',p.label,'set_id',p.set_id,'version_id',v.id,'bucket',a.bucket_id,'object_key',a.object_key) order by p.panel)
    into panels from private.outfit_render_panels p join private.ai_jobs j on j.render_id=p.render_id and j.panel=p.panel join private.look_versions v on v.job_id=j.id
    join private.assets a on a.id=v.asset_id and a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp()) where p.render_id=r.id and not p.dropped;
  select count(*) into expected from private.outfit_render_panels where render_id=r.id and not dropped;
  if panels is null or jsonb_array_length(panels)<>expected then
    update private.outfit_renders set comparison_state='failed',comparison_error='panel_image_unavailable',lease_until=null where id=r.id; return null;
  end if;
  update private.outfit_renders set comparison_state='building',fence=fence+1,comparison_attempts=comparison_attempts+1,lease_until=clock_timestamp()+interval '2 minutes' where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'user_id',r.user_id,'fence',r.fence::text,'panels',panels);
end $$;
create function private.complete_outfit_comparison(p_render uuid,p_fence bigint,p_key text,p_bytes integer,p_mime text,p_width integer,p_height integer,p_layout jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.outfit_renders%rowtype; declare asset uuid;
begin
  select * into r from private.outfit_renders where id=p_render and fence=p_fence and comparison_state='building' and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if p_key not like r.user_id::text||'/'||p_render::text||'/%' then raise exception 'object key outside render scope' using errcode='23514'; end if;
  if not private.comparison_photo_ok(r) then
    update private.outfit_renders set comparison_state='failed',comparison_error='photo_removed',lease_until=null where id=p_render; return false;
  end if;
  insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at)
    values(r.user_id,'generated_look','ready','generated-looks',p_key,p_bytes,p_mime,p_width,p_height,now()+interval '168 hours')
    on conflict (bucket_id,object_key) do update set bytes=excluded.bytes,width=excluded.width,height=excluded.height returning id into asset;
  update private.outfit_renders set comparison_state='ready',comparison_asset_id=asset,comparison_layout=p_layout,comparison_error=null,lease_until=null where id=p_render;
  return true;
end $$;
create function private.fail_outfit_comparison(p_render uuid,p_fence bigint,p_code text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update private.outfit_renders set comparison_state=case when comparison_attempts>=3 then 'failed' else 'pending' end,comparison_error=p_code,
    lease_until=case when comparison_attempts>=3 then null else clock_timestamp()+interval '10 seconds' end
    where id=p_render and fence=p_fence and comparison_state='building';
  return found;
end $$;

-- ------------------------------------------------------------------ boundary
do $$
declare t text;
begin
  foreach t in array array['source_image_policies','source_reference_cache','outfit_searches','outfit_sets','outfit_set_revisions','outfit_renders','outfit_render_panels','outfit_budget_holds'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role, stylai_api, stylai_ai_worker',t);
  end loop;
end $$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261124100000'::text $$;

revoke all on function private.withdraw_policy_rights(),private.register_source_reference(text,jsonb,jsonb),private.read_cached_source_references(text,jsonb),
  private.claim_reference_purges(integer),private.finish_reference_purge(text,boolean),
  private.create_outfit_search(uuid,text,text,text,text,text),private.update_outfit_search(uuid,uuid,text,jsonb),
  private.finish_outfit_search(uuid,uuid,text,text,text,jsonb,jsonb),private.cancel_outfit_search(uuid,uuid),private.outfit_set_json(private.outfit_sets),
  private.read_outfit_search(uuid,uuid),private.list_outfit_searches(uuid,integer),private.read_outfit_set(uuid,uuid),
  private.save_outfit_set_revision(uuid,uuid,integer,text,jsonb,jsonb,bigint),private.set_outfit_locks(uuid,uuid,integer,jsonb),private.release_outfit_hold(uuid),private.release_hold_of_settled_job(),
  private.outfit_budget(uuid,text,text,bigint,integer,text,uuid[]),private.pilot_allows_product(text,uuid),
  private.insert_ai_job(uuid,text,text,uuid,text,text,text,uuid,uuid,uuid,smallint),private.insert_composition_job(uuid,text,text,text,jsonb,uuid,uuid,uuid,smallint),
  private.hold_outfit_budget(uuid,text,text,bigint,text,uuid[],uuid[]),private.enqueue_outfit_render(uuid,text,text,text,text,text,text,bigint,text,jsonb),
  private.retry_outfit_panel(uuid,uuid,smallint,text,text,text,bigint,text,boolean),private.cancel_outfit_render(uuid,uuid),private.finalize_outfit_render(uuid,uuid),
  private.read_outfit_render(uuid,uuid),private.list_outfit_renders(uuid,integer),private.read_comparison_asset(uuid,uuid),
  private.reserve_provider_call(uuid,bigint,text,text,text,text,text,bigint,text,text),private.mark_comparison_buildable(),
  private.comparison_photo_ok(private.outfit_renders),private.claim_outfit_comparison(),
  private.complete_outfit_comparison(uuid,bigint,text,integer,text,integer,integer,jsonb),private.fail_outfit_comparison(uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function private.register_source_reference(text,jsonb,jsonb),private.read_cached_source_references(text,jsonb),
  private.create_outfit_search(uuid,text,text,text,text,text),private.update_outfit_search(uuid,uuid,text,jsonb),
  private.finish_outfit_search(uuid,uuid,text,text,text,jsonb,jsonb),private.cancel_outfit_search(uuid,uuid),
  private.read_outfit_search(uuid,uuid),private.list_outfit_searches(uuid,integer),private.read_outfit_set(uuid,uuid),
  private.save_outfit_set_revision(uuid,uuid,integer,text,jsonb,jsonb,bigint),private.set_outfit_locks(uuid,uuid,integer,jsonb),
  private.outfit_budget(uuid,text,text,bigint,integer,text,uuid[]),private.enqueue_outfit_render(uuid,text,text,text,text,text,text,bigint,text,jsonb),
  private.retry_outfit_panel(uuid,uuid,smallint,text,text,text,bigint,text,boolean),private.cancel_outfit_render(uuid,uuid),private.finalize_outfit_render(uuid,uuid),
  private.read_outfit_render(uuid,uuid),private.list_outfit_renders(uuid,integer),private.read_comparison_asset(uuid,uuid) to stylai_api;
grant execute on function private.reserve_provider_call(uuid,bigint,text,text,text,text,text,bigint,text,text),
  private.claim_reference_purges(integer),private.finish_reference_purge(text,boolean),private.claim_outfit_comparison(),
  private.complete_outfit_comparison(uuid,bigint,text,integer,text,integer,integer,jsonb),private.fail_outfit_comparison(uuid,bigint,text) to stylai_ai_worker;

commit;
