-- Public storefront offers are independent from saved outfits and generation rights.
begin;

create role stylai_catalog_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
grant usage on schema private to stylai_catalog_worker;
grant execute on function private.server_boundary_version() to stylai_catalog_worker;

create table private.affiliate_catalog_collections (
  slug text primary key,
  label text,
  next_due_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  check (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  check ((lease_token is null) = (lease_until is null))
);

create table private.affiliate_catalog_offers (
  canonical_key text primary key,
  -- Null is a tombstone: a slow provider response cannot resurrect a newer withdrawal.
  payload jsonb,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  category text generated always as (payload->>'category') stored,
  seller text generated always as (payload->>'seller') stored,
  price_minor bigint generated always as ((payload->>'priceMinor')::bigint) stored,
  search_text text generated always as (lower(translate((payload->>'name') || ' ' || (payload->>'categoryLabel'),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))) stored,
  check (canonical_key ~ '^aliexpress:[0-9]{1,20}$')
);
create index affiliate_catalog_offers_expiry on private.affiliate_catalog_offers(expires_at) where payload is not null;
create index affiliate_catalog_offers_category_price on private.affiliate_catalog_offers(category,price_minor,canonical_key) where payload is not null;
create index affiliate_catalog_offers_seller on private.affiliate_catalog_offers(seller) where payload is not null;
create index affiliate_catalog_offer_tombstones on private.affiliate_catalog_offers(observed_at) where payload is null;

create table private.affiliate_catalog_memberships (
  collection_slug text not null references private.affiliate_catalog_collections(slug) on delete cascade,
  canonical_key text not null references private.affiliate_catalog_offers(canonical_key) on delete cascade,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (collection_slug, canonical_key)
);
create index affiliate_catalog_memberships_expiry on private.affiliate_catalog_memberships(expires_at);
create index affiliate_catalog_memberships_offer on private.affiliate_catalog_memberships(canonical_key);

alter table private.affiliate_catalog_collections enable row level security;
alter table private.affiliate_catalog_offers enable row level security;
alter table private.affiliate_catalog_memberships enable row level security;
revoke all on private.affiliate_catalog_collections, private.affiliate_catalog_offers, private.affiliate_catalog_memberships
  from public, anon, authenticated, service_role, stylai_api, stylai_ai_worker, stylai_catalog_worker, stylai_payments, stylai_procurement;

create function private.claim_affiliate_collection(p_slug text, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claimed uuid;
declare checked_at timestamptz := clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds not between 1 and 600 then
    raise exception 'Invalid affiliate collection lease' using errcode='22023';
  end if;
  insert into private.affiliate_catalog_collections(slug,next_due_at) values(p_slug,checked_at)
    on conflict (slug) do nothing;
  update private.affiliate_catalog_collections
    set lease_token=gen_random_uuid(), lease_until=checked_at+make_interval(secs=>p_lease_seconds)
    where slug=p_slug and next_due_at<=checked_at and (lease_until is null or lease_until<=checked_at)
    returning lease_token into claimed;
  if not found then return null; end if;

  -- Make removal progress even during a provider outage. Retain only the key
  -- and observation time until no older in-flight batch can still be valid.
  with expired as (
    select canonical_key from private.affiliate_catalog_offers
      where payload is not null and expires_at<=checked_at
      order by expires_at,canonical_key limit 500 for update skip locked
  )
  update private.affiliate_catalog_offers as offer set payload=null
    from expired where offer.canonical_key=expired.canonical_key;

  with expired as (
    select collection_slug,canonical_key from private.affiliate_catalog_memberships
      where expires_at<=checked_at
      order by expires_at,collection_slug,canonical_key limit 500 for update skip locked
  )
  delete from private.affiliate_catalog_memberships as member using expired
    where (member.collection_slug,member.canonical_key)=(expired.collection_slug,expired.canonical_key);

  with obsolete as (
    select canonical_key from private.affiliate_catalog_offers
      where payload is null and observed_at<=checked_at-interval '24 hours'
      order by observed_at,canonical_key limit 500 for update skip locked
  )
  delete from private.affiliate_catalog_offers as offer using obsolete where offer.canonical_key=obsolete.canonical_key;
  return jsonb_build_object('token',claimed);
end $$;

create function private.publish_affiliate_collection(
  p_slug text, p_token text, p_label text, p_observed_at text, p_expires_at text, p_next_due_at text,
  p_offers jsonb, p_withdrawn jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare observed timestamptz := p_observed_at::timestamptz;
declare expires timestamptz := p_expires_at::timestamptz;
declare due timestamptz := p_next_due_at::timestamptz;
declare checked_at timestamptz := clock_timestamp();
begin
  perform 1 from private.affiliate_catalog_collections
    where slug=p_slug and lease_token::text=p_token and lease_until>checked_at for update;
  if not found then return false; end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 100
    or observed is null or observed>checked_at+interval '30 seconds'
    or expires is null or expires<=greatest(observed,checked_at) or expires>observed+interval '24 hours'
    or due is null or due<checked_at-interval '30 seconds' or due>checked_at+interval '24 hours'
    or jsonb_typeof(p_offers) is distinct from 'array' or jsonb_typeof(p_withdrawn) is distinct from 'array' then
    raise exception 'Invalid affiliate collection batch' using errcode='23514';
  end if;
  if jsonb_array_length(p_offers)>200 or jsonb_array_length(p_withdrawn)>200 then
    raise exception 'Affiliate collection batch is too large' using errcode='23514';
  end if;

  if exists(select 1 from jsonb_array_elements_text(p_withdrawn) key where key is null or key !~ '^aliexpress:[0-9]{1,20}$')
    or exists(select 1 from jsonb_array_elements(p_offers) item
      where item->>'source' is distinct from 'aliexpress'
        or not coalesce(item->>'externalProductId' ~ '^[0-9]{1,20}$',false)
        or item->>'canonicalKey' is distinct from 'aliexpress:'||(item->>'externalProductId')
        or item->>'currency' is distinct from 'BRL'
        or item->'fixture' is distinct from 'false'::jsonb
        or item#>'{capabilities,displayAndLink}' is distinct from 'true'::jsonb
        or item#>'{capabilities,aiTryOn}' is distinct from 'false'::jsonb
        or item#>'{rights,tryOnAllowed}' is distinct from 'false'::jsonb
        or jsonb_typeof(item->'priceMinor') is distinct from 'number'
        or not coalesce(item->>'priceMinor' ~ '^[0-9]{1,14}$',false)
        or not coalesce((item->>'priceObservedAt')::timestamptz between observed-interval '1 minute' and observed+interval '1 minute',false)
        or not coalesce(char_length(btrim(item->>'name')) between 1 and 500,false)
        or not coalesce(char_length(btrim(item->>'categoryLabel')) between 1 and 100,false)
        or not coalesce(item->>'category' ~ '^[a-z0-9_-]{1,64}$',false)
        or not coalesce(char_length(btrim(item->>'seller')) between 1 and 100,false)
        or not coalesce(char_length(btrim(item->>'sellerName')) between 1 and 200,false)
        or not coalesce(item->>'image' ~ '^https://([a-z0-9-]+\.)*(alicdn\.com|aliexpress-media\.com)(:443)?/[^[:space:]]+$',false)
        or not coalesce(item->>'productUrl' ~ '^https://([a-z0-9-]+\.)*aliexpress\.(com|us)(:443)?/[^[:space:]]+$',false)
        or not coalesce(item->>'affiliateUrl' ~ '^https://([a-z0-9-]+\.)*aliexpress\.com(:443)?/[^[:space:]]+$',false)) then
    raise exception 'Invalid or untracked affiliate offer' using errcode='23514';
  end if;

  -- Stable key order avoids deadlocks when two collections publish the same items.
  -- First observation in a batch wins, except explicit withdrawals always win ties.
  with incoming as (
    select item->>'canonicalKey' as key, item as payload, ordinality as position
      from jsonb_array_elements(p_offers) with ordinality as items(item,ordinality)
    union all
    select withdrawn, null::jsonb, 0 from jsonb_array_elements_text(p_withdrawn) withdrawn
  )
  insert into private.affiliate_catalog_offers as stored(canonical_key,payload,observed_at,expires_at)
    select distinct on (key) key, payload, observed, case when payload is null then checked_at else expires end
    from incoming order by key,position
    on conflict (canonical_key) do update set payload=excluded.payload, observed_at=excluded.observed_at, expires_at=excluded.expires_at
    where stored.observed_at<excluded.observed_at
      or (stored.observed_at=excluded.observed_at and stored.payload is not null and excluded.payload is null);

  -- Missing search results are not an authoritative delisting. Each collection
  -- membership keeps its own validity, independently of a refresh in another one.
  insert into private.affiliate_catalog_memberships as stored(collection_slug,canonical_key,observed_at,expires_at)
    select distinct p_slug, offer.canonical_key, observed, expires
    from jsonb_array_elements(p_offers) item
    join private.affiliate_catalog_offers offer on offer.canonical_key=item->>'canonicalKey'
    where offer.payload is not null
    order by offer.canonical_key
    on conflict (collection_slug,canonical_key) do update set observed_at=excluded.observed_at,expires_at=excluded.expires_at
    where stored.observed_at<excluded.observed_at;

  update private.affiliate_catalog_collections
    set label=btrim(p_label),next_due_at=greatest(due,checked_at+interval '1 second'),lease_token=null,lease_until=null where slug=p_slug;
  return true;
end $$;

create function private.retry_affiliate_collection(p_slug text, p_token text, p_next_due_at text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare checked_at timestamptz := clock_timestamp();
declare due timestamptz := p_next_due_at::timestamptz;
begin
  if due is null or due<=checked_at or due>checked_at+interval '24 hours' then
    raise exception 'Invalid affiliate collection retry' using errcode='22023';
  end if;
  update private.affiliate_catalog_collections
    set next_due_at=due,lease_token=null,lease_until=null
    where slug=p_slug and lease_token::text=p_token and lease_until>checked_at;
  return found;
end $$;

create function private.take_affiliate_catalog_slot(p_minute_limit integer,p_daily_limit integer) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- Same counters and lock order as the interactive API. If the day is full,
  -- rollback the minute debit so no denied worker attempt consumes headroom.
  if not private.take_provider_call_slot('aliexpress',p_minute_limit) then return false; end if;
  if not private.take_provider_daily_slot('aliexpress',p_daily_limit) then
    raise exception 'Affiliate catalog daily quota exhausted' using errcode='PCA01';
  end if;
  return true;
exception when sqlstate 'PCA01' then return false;
end $$;

create function private.list_affiliate_offers(p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare checked_at timestamptz := statement_timestamp();
declare item_limit integer;
declare cursor_text text := p_query->>'cursor';
declare sort_order text := coalesce(p_query->>'sort','default');
declare center_price bigint;
declare minimum bigint;
declare maximum bigint;
declare favorite_actor uuid;
declare terms text[];
begin
  if jsonb_typeof(p_query) is distinct from 'object'
    or not coalesce(p_query->>'limit' ~ '^[0-9]{1,3}$',true)
    or not coalesce(p_query->>'minPriceMinor' ~ '^[0-9]{1,14}$',true)
    or not coalesce(p_query->>'maxPriceMinor' ~ '^[0-9]{1,14}$',true)
    or not coalesce(p_query->>'nearPriceMinor' ~ '^[0-9]{1,14}$',true)
    or sort_order not in ('default','newest','price_asc','price_desc','price_near')
    or char_length(p_query->>'keyword')>120
    or (sort_order='price_near' and p_query->>'nearPriceMinor' is null)
    or (cursor_text is not null and cursor_text !~ '^-?[0-9]{1,16}/aliexpress:[0-9]{1,20}$') then
    raise exception 'Invalid affiliate catalog query' using errcode='22023';
  end if;
  item_limit := coalesce((p_query->>'limit')::integer,24);
  if item_limit not between 1 and 96 then
    raise exception 'Invalid affiliate catalog limit' using errcode='22023';
  end if;
  center_price := (p_query->>'nearPriceMinor')::bigint;
  favorite_actor := (p_query->>'favoriteActor')::uuid;
  minimum := (p_query->>'minPriceMinor')::bigint;
  maximum := (p_query->>'maxPriceMinor')::bigint;
  if minimum>maximum then
    raise exception 'Invalid affiliate catalog price range' using errcode='22023';
  end if;
  terms := array(select term from regexp_split_to_table(
    lower(translate(coalesce(p_query->>'keyword',''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '[^[:alnum:]]+') term
    where char_length(term)>2 and term not in ('com','para','uma','das','dos','por','sem'));

  return (
    with matching as materialized (
      select canonical_key, payload, expires_at, case sort_order
        when 'newest' then -floor(extract(epoch from observed_at)*1000)::bigint
        when 'price_asc' then price_minor
        when 'price_desc' then -price_minor
        when 'price_near' then abs(price_minor-center_price)
        else 0 end as sort_key
      from private.affiliate_catalog_offers as offer
      where payload is not null and expires_at>checked_at
        and (p_query->>'category' is null or category=p_query->>'category')
        and (p_query->'categories' is null or (p_query->'categories') ? category)
        and (p_query->>'partner' is null or seller=p_query->>'partner')
        and (p_query->>'exclude' is null or canonical_key<>p_query->>'exclude')
        and (favorite_actor is null or exists(
          select 1 from private.saved_pieces saved where saved.user_id=favorite_actor and saved.piece_key=offer.canonical_key))
        and (minimum is null or price_minor>=minimum)
        and (maximum is null or price_minor<=maximum)
        and (cardinality(terms)=0 or exists(select 1 from unnest(terms) term where strpos(offer.search_text,term)>0))
        and (p_query->'requiredTerms' is null or not exists (
          select 1 from jsonb_array_elements_text(p_query->'requiredTerms') term
          where not (term=any(regexp_split_to_array(offer.search_text,'[^[:alnum:]]+')))))
        and (p_query->>'collection' is null or exists(
          select 1 from private.affiliate_catalog_memberships member where member.canonical_key=offer.canonical_key
            and member.collection_slug=p_query->>'collection' and member.expires_at>checked_at))
    ), candidates as (
      select * from matching
      where cursor_text is null or (sort_key,canonical_key)>(split_part(cursor_text,'/',1)::bigint,split_part(cursor_text,'/',2))
      order by sort_key,canonical_key limit item_limit+1
    ), page as materialized (
      select * from candidates order by sort_key,canonical_key limit item_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(payload||jsonb_build_object('offerExpiresAt',expires_at) order by sort_key,canonical_key) from page),'[]'::jsonb),
      'nextCursor',case when (select count(*) from candidates)>item_limit
        then (select sort_key::text||'/'||canonical_key from page order by sort_key desc,canonical_key desc limit 1) end,
      'total',(select count(*) from matching)
    )
  );
end $$;

create function private.read_affiliate_offer(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select payload||jsonb_build_object('offerExpiresAt',expires_at) from private.affiliate_catalog_offers
    where canonical_key=p_id and payload is not null and expires_at>statement_timestamp();
$$;

create function private.read_affiliate_facets() returns jsonb
language sql stable security definer set search_path = '' as $$
  with current_offers as materialized (
    select * from private.affiliate_catalog_offers where payload is not null and expires_at>statement_timestamp()
  ), categories as (
    select category as id,min(payload->>'categoryLabel') as label,count(*) as count from current_offers group by category
  ), partners as (
    select seller as id,min(payload->>'sellerName') as label,count(*) as count from current_offers group by seller
  ), collections as (
    select collection.slug as id, collection.label, count(*) as count
      from private.affiliate_catalog_collections collection
      join private.affiliate_catalog_memberships member on member.collection_slug=collection.slug
      join current_offers offer on offer.canonical_key=member.canonical_key
      where collection.label is not null and member.expires_at>statement_timestamp()
      group by collection.slug,collection.label
  )
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'count',count) order by label,id) from categories),'[]'::jsonb),
    'partners',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'count',count) order by label,id) from partners),'[]'::jsonb),
    'collections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'count',count) order by label,id) from collections),'[]'::jsonb),
    'priceRange',(select case when count(*)>0 then jsonb_build_object('min',min(price_minor)/100.0,'max',max(price_minor)/100.0,'currency','BRL') end from current_offers),
    'total',(select count(*) from current_offers)
  );
$$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261125190000'::text $$;

revoke all on function private.claim_affiliate_collection(text,integer),
  private.publish_affiliate_collection(text,text,text,text,text,text,jsonb,jsonb),
  private.retry_affiliate_collection(text,text,text), private.take_affiliate_catalog_slot(integer,integer),
  private.list_affiliate_offers(jsonb), private.read_affiliate_offer(text), private.read_affiliate_facets()
  from public, anon, authenticated, service_role, stylai_api, stylai_ai_worker, stylai_catalog_worker, stylai_payments, stylai_procurement;
grant execute on function private.list_affiliate_offers(jsonb), private.read_affiliate_offer(text),
  private.read_affiliate_facets() to stylai_api;
grant execute on function private.claim_affiliate_collection(text,integer),
  private.publish_affiliate_collection(text,text,text,text,text,text,jsonb,jsonb),
  private.retry_affiliate_collection(text,text,text), private.take_affiliate_catalog_slot(integer,integer)
  to stylai_catalog_worker;

commit;
