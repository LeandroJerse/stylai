begin;

-- Exercise the same read and write boundary used in the API and worker.
do $$
begin
  assert has_function_privilege('stylai_api','private.list_affiliate_offers(jsonb)','EXECUTE');
  assert not has_function_privilege('stylai_catalog_worker','private.list_affiliate_offers(jsonb)','EXECUTE');
  assert not has_function_privilege('stylai_api','private.claim_affiliate_collection(text,integer)','EXECUTE');
  assert not has_function_privilege('stylai_catalog_worker','private.take_provider_call_slot(text,integer)','EXECUTE');
  assert not has_function_privilege('anon','private.read_affiliate_offer(text)','EXECUTE');
end $$;

create function pg_temp.affiliate_fixture(external_id text, title text, price integer, observed_at timestamptz)
returns jsonb language sql as $$
  select jsonb_build_object(
    'source','aliexpress','canonicalKey','aliexpress:'||external_id,'externalProductId',external_id,
    'name',title,'category','shirts','categoryLabel','Camisas','seller','aliexpress-shop-5','sellerName','Loja cinco',
    'currency','BRL','priceMinor',price,'priceObservedAt',observed_at,'fixture',false,
    'image','https://ae01.alicdn.com/test.png','productUrl','https://pt.aliexpress.com/item/'||external_id||'.html',
    'affiliateUrl','https://s.click.aliexpress.com/e/_fixture','color',null,'variants','[]'::jsonb,
    'ratingPercent',null,'recentSales',null,
    'capabilities',jsonb_build_object('displayAndLink',true,'aiTryOn',false,'aiTryOnBlockedReason','ai_image_rights_unconfirmed'),
    'rights',jsonb_build_object('basis','unconfirmed','evidence','test only','tryOnAllowed',false));
$$;
grant execute on function pg_temp.affiliate_fixture(text,text,integer,timestamptz) to stylai_catalog_worker;

set local role stylai_catalog_worker;
do $$
declare first_token text;
declare second_token text;
declare observed timestamptz := clock_timestamp()-interval '10 seconds';
declare expires timestamptz := observed+interval '4 hours';
declare due timestamptz := observed+interval '2 hours';
begin
  first_token := private.claim_affiliate_collection('shirts',600)->>'token';
  assert first_token is not null, 'initial run was not claimed';
  assert private.claim_affiliate_collection('shirts',600) is null, 'collection was claimed twice';
  assert not private.publish_affiliate_collection('shirts',gen_random_uuid()::text,'Camisas',observed::text,expires::text,due::text,'[]','[]'), 'wrong fence published';

  assert private.publish_affiliate_collection('shirts',first_token,'Camisas',observed::text,expires::text,due::text,
    jsonb_build_array(pg_temp.affiliate_fixture('100','Camisa de linho',3900,observed),
                       pg_temp.affiliate_fixture('100','Camisa repetida',9000,observed),
                       pg_temp.affiliate_fixture('101','Camisa de algodão',2900,observed),
                       pg_temp.affiliate_fixture('102','Camisa branca',4900,observed)), '[]');
  assert private.claim_affiliate_collection('shirts',600) is null, 'completed schedule was ignored';

  -- A later execution can finish with an older provider observation, but cannot roll the offer back.
  second_token := private.claim_affiliate_collection('linen',600)->>'token';
  assert private.publish_affiliate_collection('linen',second_token,'Linho',observed::text,expires::text,due::text,
    jsonb_build_array(pg_temp.affiliate_fixture('100','Camisa de linho',3900,observed)), '[]');
  second_token := private.claim_affiliate_collection('older',600)->>'token';
  assert private.publish_affiliate_collection('older',second_token,'Observação antiga',(observed-interval '1 second')::text,expires::text,due::text,
    jsonb_build_array(pg_temp.affiliate_fixture('100','Preço antigo',9900,observed-interval '1 second')), '["aliexpress:101"]');
  assert not private.retry_affiliate_collection('older',second_token,due::text), 'completed token could reschedule';

  second_token := private.claim_affiliate_collection('rejected',600)->>'token';
  begin
    perform private.publish_affiliate_collection('rejected',second_token,'Inválida',observed::text,expires::text,due::text,
      jsonb_build_array(pg_temp.affiliate_fixture('103','Camisa com link inválido',9900,observed) || '{"affiliateUrl":"https://wrong.example/offer"}'::jsonb), '[]');
    raise exception 'untrusted affiliate link was accepted';
  exception when check_violation then null; end;
  assert private.retry_affiliate_collection('rejected',second_token,due::text), 'validation failure consumed ownership';
  assert private.claim_affiliate_collection('rejected',600) is null;
end $$;
reset role;

set local role stylai_api;
do $$
declare result jsonb;
begin
  assert private.read_affiliate_offer('aliexpress:100')->>'priceMinor' = '3900', 'duplicate or stale update won';
  assert private.read_affiliate_offer('aliexpress:100')->>'offerExpiresAt' is not null;
  assert private.read_affiliate_offer('aliexpress:101') is not null, 'old withdrawal overwrote current data';
  assert private.read_affiliate_offer('aliexpress:103') is null;
  result := private.list_affiliate_offers('{"sort":"price_asc","limit":1}');
  assert result#>>'{items,0,canonicalKey}' = 'aliexpress:101' and result->>'total' = '3';
  result := private.list_affiliate_offers(jsonb_build_object('sort','price_asc','limit',1,'cursor',result->>'nextCursor'));
  assert result#>>'{items,0,canonicalKey}' = 'aliexpress:100' and result->>'total' = '3';
  assert private.list_affiliate_offers('{"sort":"price_desc","limit":1}')#>>'{items,0,canonicalKey}' = 'aliexpress:102';
  assert private.list_affiliate_offers('{"sort":"price_near","nearPriceMinor":3900,"exclude":"aliexpress:100","limit":1}')#>>'{items,0,canonicalKey}' = 'aliexpress:101';
  assert private.list_affiliate_offers('{"collection":"linen","category":"shirts","partner":"aliexpress-shop-5","keyword":"LINHO"}')->>'total' = '1';
  assert private.list_affiliate_offers('{"keyword":"algodao","minPriceMinor":2800,"maxPriceMinor":3000}')#>>'{items,0,canonicalKey}' = 'aliexpress:101';
  assert private.list_affiliate_offers('{"requiredTerms":["camisa","algodao"],"categories":["shirts"],"limit":1}')#>>'{items,0,canonicalKey}' = 'aliexpress:101';
  assert private.list_affiliate_offers('{"requiredTerms":["camisa","algodao"],"categories":["dresses"],"limit":1}')->>'total' = '0';
  assert private.read_affiliate_facets()->>'total' = '3', 'cross-collection memberships inflated total';
  assert (private.read_affiliate_facets()#>>'{priceRange,min}')::numeric = 29;
  begin
    perform private.list_affiliate_offers('{"cursor":"invalid"}');
    raise exception 'malformed cursor was accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- A dead process leaves a lease which can be reclaimed and fenced off.
select private.claim_affiliate_collection('fenced',600)->>'token' as old_affiliate_token \gset
update private.affiliate_catalog_collections set lease_until=clock_timestamp()-interval '1 second' where slug='fenced';
select private.claim_affiliate_collection('fenced',600)->>'token' as new_affiliate_token \gset
select set_config('test.affiliate_old_token', :'old_affiliate_token', true), set_config('test.affiliate_new_token', :'new_affiliate_token', true);
set local role stylai_catalog_worker;
do $$
declare observed timestamptz := clock_timestamp();
begin
  assert not private.publish_affiliate_collection('fenced',current_setting('test.affiliate_old_token'),'Vencida',observed::text,
    (observed+interval '4 hours')::text,(observed+interval '2 hours')::text,'[]','[]'), 'expired lease completed';
  assert private.publish_affiliate_collection('fenced',current_setting('test.affiliate_new_token'),'Ativa',observed::text,
    (observed+interval '4 hours')::text,(observed+interval '2 hours')::text,'[]','["aliexpress:102"]');
end $$;
reset role;

update private.affiliate_catalog_offers set expires_at=clock_timestamp()-interval '1 second' where canonical_key='aliexpress:101';
set local role stylai_api;
do $$ begin
  assert private.read_affiliate_offer('aliexpress:101') is null, 'expired offer visible in details';
  assert private.read_affiliate_offer('aliexpress:102') is null, 'withdrawn offer visible in details';
  assert private.list_affiliate_offers('{}')->>'total' = '1', 'expired or withdrawn offer visible in list';
  assert private.read_affiliate_facets()->>'total' = '1', 'expired or withdrawn offer counted in facets';
end $$;
reset role;

set local role stylai_catalog_worker;
do $$ begin
  assert private.claim_affiliate_collection('retention-sweep',600) is not null;
end $$;
reset role;
do $$ begin
  assert (select payload is null from private.affiliate_catalog_offers where canonical_key='aliexpress:101'),
    'worker retained expired provider metadata after claiming work';
end $$;

delete from private.provider_call_windows where provider='aliexpress';
delete from private.provider_call_days where provider='aliexpress';
set local role stylai_catalog_worker;
do $$ begin
  assert private.take_affiliate_catalog_slot(2,1), 'first slot denied';
  assert not private.take_affiliate_catalog_slot(2,1), 'daily cap ignored';
end $$;
reset role;
do $$ begin
  assert (select sum(calls) from private.provider_call_windows where provider='aliexpress') = 1, 'denied day incremented minute';
end $$;
set local role stylai_api;
do $$ begin
  assert not private.take_provider_daily_slot('aliexpress',1), 'catalog worker did not consume shared day slot';
  assert not private.take_provider_call_slot('aliexpress',1), 'catalog worker did not consume shared minute slot';
end $$;
reset role;

rollback;
select 'Affiliate catalog PostgreSQL assertions passed.';
