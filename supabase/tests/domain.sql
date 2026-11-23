begin;

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
insert into private.photo_consents(user_id, policy_version) values ('10000000-0000-4000-8000-000000000001', 'test-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','body_photo','ready','body-photos','fixture-a',4096,'image/jpeg',800,1000,now()+interval '1 day');
insert into public.categories(id,label) values ('test-tops','Tops');
insert into private.ai_spend_budgets(scope,period_start,limit_micros) values
  ('daily',(now() at time zone 'UTC')::date,50000),
  ('monthly',date_trunc('month',now() at time zone 'UTC')::date,50000);

do $$ begin
  assert not has_table_privilege('authenticated','private.assets','SELECT'), 'authenticated direct asset read';
  assert not has_table_privilege('anon','private.ai_jobs','INSERT'), 'anonymous direct job write';
  assert not has_function_privilege('authenticated','private.enqueue_ai_job(uuid,text,text,uuid,text,text,text,uuid,uuid)','EXECUTE'), 'authenticated private RPC execute';
end $$;

set local role service_role;
do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000001';
  b constant uuid := '10000000-0000-4000-8000-000000000002';
  photo constant uuid := '20000000-0000-4000-8000-000000000001';
  job uuid;
  claim bigint;
  spend uuid;
begin
  begin
    perform private.enqueue_ai_job(b,'foreign-photo',repeat('a',64),photo,'test-tops','test-v1');
    raise exception 'foreign photo accepted';
  exception when insufficient_privilege then null; end;

  for i in 1..3 loop
    job := private.enqueue_ai_job(a,'request-'||i,repeat('a',64),photo,'test-tops','test-v1');
    assert job = private.enqueue_ai_job(a,'request-'||i,repeat('a',64),photo,'test-tops','test-v1'), 'same request must replay';
    begin
      perform private.enqueue_ai_job(a,'request-'||i,repeat('b',64),photo,'test-tops','test-v1');
      raise exception 'same key with different hash accepted';
    exception when unique_violation then null; end;
    claim := private.claim_ai_job(job);
    assert claim = 1, 'first claim should have fence 1';
    if i=1 then
      spend := private.reserve_ai_attempt(job,claim,'search','test-search',10000);
      assert spend = private.reserve_ai_attempt(job,claim,'search','test-search',10000), 'duplicate spend reservation';
      begin
        perform private.reserve_ai_attempt(job,claim,'search','duplicate-in-flight',10000);
        raise exception 'second unresolved search attempt accepted';
      exception when unique_violation then null; end;
      assert not private.begin_ai_attempt(spend,claim+1), 'stale worker received dispatch permission';
      assert private.begin_ai_attempt(spend,claim), 'search dispatch claim failed';
      assert not private.begin_ai_attempt(spend,claim), 'repeated search dispatch claim';
      assert private.settle_ai_attempt(spend,12000), 'search spend not reconciled';
      assert not private.settle_ai_attempt(spend,12000), 'duplicate spend reconciliation';
    end if;
    assert not private.finish_ai_job(job,claim+1,'no_results',null), 'stale worker finalized job';
    assert private.finish_ai_job(job,claim,'no_results',null), 'searched job should finalize';
    assert not private.finish_ai_job(job,claim,'no_results',null), 'terminal job finalized twice';
  end loop;

  begin
    perform private.enqueue_ai_job(a,'over-quota',repeat('a',64),photo,'test-tops','test-v1');
    raise exception 'free quota exceeded';
  exception when check_violation then null; end;
end $$;
reset role;

do $$ begin
  assert (select spent = 3 and reserved = 0 from private.ai_daily_usage where user_id='10000000-0000-4000-8000-000000000001'), 'no-match requests charged once';
  assert (select count(*) from private.ai_jobs) = 3, 'failed requests left partial jobs';
  assert (select count(*)=2 and bool_and(reserved_micros=0 and spent_micros=12000) from private.ai_spend_budgets), 'daily/monthly cost was not reconciled';
end $$;

insert into private.settings_versions(id,kind,scope,version,payload,effective_at,reason)
  values ('50000000-0000-4000-8000-000000000001','membership','paid',1,'{}',now(),'test only');
insert into private.ai_memberships(user_id,plan_version_id,environment,merchant_ref,provider_subscription_id,provider_payment_id,valid_from,valid_until)
  values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','sandbox','test','test-sub','test-pay',now()-interval '1 day',now()+interval '1 day');

set local role service_role;
do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000001';
  photo constant uuid := '20000000-0000-4000-8000-000000000001';
  job uuid;
  fence bigint;
  deletion uuid;
begin
  for i in 4..12 loop
    job := private.enqueue_ai_job(a,'paid-'||i,repeat('a',64),photo,'test-tops','test-v1');
    fence := private.claim_ai_job(job);
    assert private.finish_ai_job(job,fence,'no_results',null), 'paid job did not finish';
  end loop;
  begin
    perform private.enqueue_ai_job(a,'paid-13',repeat('a',64),photo,'test-tops','test-v1');
    raise exception 'paid quota exceeded';
  exception when check_violation then null; end;
  deletion := private.request_account_deletion(a);
  assert deletion = private.request_account_deletion(a), 'deletion request did not replay';
  begin
    perform private.enqueue_ai_job(a,'after-deletion',repeat('a',64),photo,'test-tops','test-v1');
    raise exception 'deleting account allowed a request';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select spent=12 and reserved=0 from private.ai_daily_usage where user_id='10000000-0000-4000-8000-000000000001'), 'paid limit not enforced at 12 total';
  assert (select state='deleting' from private.assets where id='20000000-0000-4000-8000-000000000001'), 'account deletion did not queue private image removal';
end $$;

insert into private.photo_consents(user_id,policy_version) values ('10000000-0000-4000-8000-000000000002','test-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at) values
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','body_photo','ready','body-photos','fixture-b',4096,'image/jpeg',800,1000,now()+interval '1 day'),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','generated_look','ready','generated-looks','fixture-result',4096,'image/jpeg',800,1000,now()+interval '1 day');
insert into public.partners(id,source,external_seller_id,region,name) values ('30000000-0000-4000-8000-000000000001','aliexpress','test','BR','Fixture');
do $$ begin
  perform private.request_account_deletion('10000000-0000-4000-8000-000000000001');
  assert (select count(*)=2 from private.assets where user_id='10000000-0000-4000-8000-000000000002' and state='ready'), 'deletion affected another account';
end $$;
insert into public.products(id,partner_id,external_product_id,category_id,name,published,rights_cleared) values
  ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','top','test-tops','Fixture',true,true);
insert into public.product_variants(id,product_id,external_variant_id,label,available) values
  ('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','one','One',true),
  ('60000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','two','Two',true);

set local role service_role;
do $$
declare
  b constant uuid := '10000000-0000-4000-8000-000000000002';
  photo constant uuid := '20000000-0000-4000-8000-000000000002';
  product constant uuid := '40000000-0000-4000-8000-000000000001';
  variant constant uuid := '60000000-0000-4000-8000-000000000001';
  job uuid;
  fence bigint;
  look uuid;
begin
  job := private.enqueue_ai_job(b,'explicit',repeat('a',64),photo,'test-tops','test-v1','black top',product,variant);
  assert (select search_query='black top' and requested_variant_id=variant from private.ai_jobs where id=job), 'durable request missing';
  fence := private.claim_ai_job(job);
  begin
    perform private.record_ai_selection(job,fence,product,'60000000-0000-4000-8000-000000000002','{}');
    raise exception 'requested variant was substituted';
  exception when check_violation then null; end;
  assert private.record_ai_selection(job,fence,product,variant,'{}'), 'selection not recorded';
  assert private.finish_ai_job(job,fence,'succeeded','20000000-0000-4000-8000-000000000003'), 'valid output did not finalize';
  look := private.save_ai_look(b,job);
  assert look=private.save_ai_look(b,job), 'duplicate look save';
  perform private.set_favorite_product(b,product,true);
  perform private.set_favorite_product(b,product,false);
  assert not exists(select 1 from private.favorite_products where user_id=b), 'explicit favorite not removed';
  assert exists(select 1 from private.saved_look_products where user_id=b and look_id=look and product_id=product), 'unfavorite removed look provenance';
end $$;
reset role;
do $$ begin
  assert (select expires_at is not null from private.assets where id='20000000-0000-4000-8000-000000000002'), 'save extended original photo retention';
  assert (select expires_at is null from private.assets where id='20000000-0000-4000-8000-000000000003'), 'saved output expires';
end $$;

rollback;
select 'Phase 2 domain SQL assertions passed.' as result;
