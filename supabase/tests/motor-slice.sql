-- First engine slice: lineage, isolation, provider spend ledger, telemetry outbox.
begin;

insert into auth.users(id) values ('10000000-0000-4000-8000-0000000000a1'),('10000000-0000-4000-8000-0000000000b2');
insert into private.photo_consents(user_id,policy_version) values ('10000000-0000-4000-8000-0000000000a1','test-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,validation_status,validator_version,validation) values
 ('20000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a1','body_photo','ready','body-photos',
  '10000000-0000-4000-8000-0000000000a1/photo.jpg',4096,'image/jpeg',800,1000,now()+interval '1 day','approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb);
insert into public.categories(id,label) values ('tops','Tops');
insert into public.partners(id,source,external_seller_id,region,name) values
 ('50000000-0000-4000-8000-000000000001','curated','fixture','BR','Fixture curated (not a real product)');
insert into public.products(id,partner_id,external_product_id,category_id,name,price_minor,product_url,availability,published,rights_cleared) values
 ('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','p1','tops','Jaqueta A',19990,'https://example.com/p1','available',true,true),
 ('60000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','p2','tops','Jaqueta B',24990,'https://example.com/p2','available',true,true);
insert into public.product_variants(id,product_id,external_variant_id,label,available) values
 ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','v1','Preta M',true),
 ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','v2','Azul M',true);
insert into public.product_images(product_id,url,position) values
 ('60000000-0000-4000-8000-000000000001','https://example.com/p1.jpg',0),('60000000-0000-4000-8000-000000000002','https://example.com/p2.jpg',0);
insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed)
  select id,'test_fixture','synthetic test row',true from public.product_images;

create temporary table slice(k text primary key, v text) on commit drop;
grant all on slice to stylai_api, stylai_ai_worker;

do $$ begin
  assert private.server_boundary_version()='20261124220000', 'boundary version not bumped';
  assert not has_function_privilege('stylai_api','private.reserve_provider_call(uuid,bigint,text,text,text,text,text,bigint,text,text)','EXECUTE'), 'API can reserve spend';
  assert not has_function_privilege('stylai_ai_worker','private.enqueue_look_job(uuid,text,text,text,uuid,uuid,uuid)','EXECUTE'), 'worker can enqueue';
  assert not has_function_privilege('authenticated','private.read_look(uuid,uuid)','EXECUTE'), 'browser can read looks';
end $$;

-- v1: enqueue, idempotent replay
set local role stylai_api;
do $$ declare j uuid; begin
  begin
    perform private.enqueue_look_job('10000000-0000-4000-8000-0000000000a1','no-variant',repeat('c',64),'test-v1',null,null,null);
    raise exception 'job without explicit variant accepted';
  exception when check_violation then null; end;
  j := private.enqueue_look_job('10000000-0000-4000-8000-0000000000a1','slice-v1',repeat('a',64),
    'test-v1','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',null);
  assert private.enqueue_look_job('10000000-0000-4000-8000-0000000000a1','slice-v1',repeat('a',64),
    'test-v1','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',null)=j, 'replay created a second job';
  assert private.read_ai_job('10000000-0000-4000-8000-0000000000b2',j) is null, 'foreign user read job';
  assert private.read_ai_job('10000000-0000-4000-8000-0000000000a1',j)->>'status'='queued';
  insert into slice values('job1',j::text);
end $$;
reset role;

-- Worker: claim, budget gate, spend, completion
set local role stylai_ai_worker;
do $$ declare j uuid := (select v::uuid from slice where k='job1'); f bigint; c uuid; a uuid; ver uuid; job jsonb; begin
  assert private.next_ai_job()=j, 'job not discoverable';
  f := private.claim_ai_job(j);
  job := private.load_ai_job(j,f);
  assert job->'variant'->>'image_url'='https://example.com/p1.jpg' and job->'variant'->>'source'='curated', 'variant snapshot incomplete';
  assert private.load_ai_job(j,f+1) is null, 'stale fence loaded job';
  begin
    perform private.reserve_provider_call(j,f,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen-'||replace(j::text,'-',''),500000,'u_0123456789abcdef','test');
    raise exception 'generation reserved before selection';
  exception when check_violation then null; end;
  assert private.record_ai_selection(j,f,'60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',
    '{"name":"Jaqueta A","link_verification":"unverified","visual_fidelity":"unverified"}');
  begin
    perform private.reserve_provider_call(j,f,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen-'||replace(j::text,'-',''),500000,'u_0123456789abcdef','test');
    raise exception 'paid call without configured budget';
  exception when check_violation then null; end;
  insert into slice values('fence1',f::text);
end $$;
reset role;

insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
  ('global','*','day',2000000),('global','*','month',20000000),('provider','segmind','day',1000000),('provider','segmind','month',10000000),
  ('provider','anthropic','day',1000000),('provider','anthropic','month',5000000),('user','*','day',800000),('job','*','job',600000);

set local role stylai_ai_worker;
do $$ declare j uuid := (select v::uuid from slice where k='job1'); f bigint := (select v::bigint from slice where k='fence1');
  c uuid; c2 uuid; a uuid; ver uuid; begin
  c := private.reserve_provider_call(j,f,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen-attempt-0001',500000,'u_0123456789abcdef','test');
  assert private.reserve_provider_call(j,f,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen-attempt-0001',500000,'u_0123456789abcdef','test')=c, 'reservation not idempotent';
  begin
    perform private.reserve_provider_call(j,f,'anthropic','claude-haiku-5-5','a-2026-11-20','interpretation','int-attempt-0001',200000,'u_0123456789abcdef','test');
    raise exception 'job cap exceeded';
  exception when check_violation then null; end;
  begin
    perform private.settle_provider_call(c,'succeeded',null,'{}','{}',null,58000,null,'computed_from_usage',10,null);
    raise exception 'settled before dispatch';
  exception when check_violation then null; end;
  assert private.begin_provider_call(c,f);
  assert not private.begin_provider_call(c,f), 'double dispatch';
  assert private.settle_provider_call(c,'succeeded','req-1','{"gpu_seconds":8.06}','{"credits":0.058}',null,58032,null,'computed_from_usage',8100,null);
  assert not private.settle_provider_call(c,'succeeded','req-1','{}','{}',null,58032,null,'computed_from_usage',8100,null), 'double settle';
  a := private.register_generated_asset(j,f,'10000000-0000-4000-8000-0000000000a1/'||j::text||'/out.png',2048,'image/png',768,1024);
  assert private.register_generated_asset(j,f,'10000000-0000-4000-8000-0000000000a1/'||j::text||'/out.png',2048,'image/png',768,1024)=a;
  begin
    perform private.register_generated_asset(j,f,'someone-else/out.png',2048,'image/png',768,1024);
    raise exception 'object key outside job scope';
  exception when check_violation then null; end;
  ver := private.complete_look_job(j,f,a);
  assert ver is not null;
  assert private.complete_look_job(j,f,a) is null, 'completed twice';
  insert into slice values('v1',ver::text);
end $$;
reset role;

do $$ begin
  assert (select reserved_usd_micros||'/'||spent_usd_micros from private.provider_budget_usage where scope='job')='0/58032', 'job ledger';
  assert (select reserved_usd_micros||'/'||spent_usd_micros from private.provider_budget_usage where scope='provider' and period='day')='0/58032';
  assert (select spent from private.ai_daily_usage where user_id='10000000-0000-4000-8000-0000000000a1')=1, 'customer quota not spent once';
  assert (select look_version_id from private.provider_calls limit 1)=(select v::uuid from slice where k='v1'), 'call not linked to version';
end $$;

-- v2: swap garment with lineage to v1; v1 stays intact
set local role stylai_api;
do $$ declare v1 uuid := (select v::uuid from slice where k='v1'); j uuid; look jsonb; begin
  begin
    perform private.enqueue_look_job('10000000-0000-4000-8000-0000000000b2','steal',repeat('d',64),
      'test-v1','60000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002',v1);
    raise exception 'foreign parent accepted';
  exception when insufficient_privilege then null; end;
  j := private.enqueue_look_job('10000000-0000-4000-8000-0000000000a1','slice-v2',repeat('b',64),
    'test-v1','60000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002',v1);
  insert into slice values('job2',j::text);
  look := private.read_look('10000000-0000-4000-8000-0000000000a1',(private.read_ai_job('10000000-0000-4000-8000-0000000000a1',
    (select v::uuid from slice where k='job1'))->>'look_id')::uuid);
  assert jsonb_array_length(look->'versions')=1;
  assert private.read_version_asset('10000000-0000-4000-8000-0000000000b2',v1) is null, 'foreign asset read';
  assert private.read_version_asset('10000000-0000-4000-8000-0000000000a1',v1)->>'bucket'='generated-looks';
end $$;
reset role;

set local role stylai_ai_worker;
do $$ declare j uuid := (select v::uuid from slice where k='job2'); f bigint; c uuid; a uuid; ver uuid; begin
  f := private.claim_ai_job(j);
  perform private.record_ai_selection(j,f,'60000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','{"name":"Jaqueta B"}');
  -- Unknown outcome: reservation stays open; reconciliation releases it.
  c := private.reserve_provider_call(j,f,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen-attempt-0002',500000,'u_0123456789abcdef','test');
  assert private.begin_provider_call(c,f);
  assert private.settle_provider_call(c,'failed',null,'{}','{}',null,null,null,'unknown',30000,'timeout');
  insert into slice values('unknown',c::text);
  a := private.register_generated_asset(j,f,'10000000-0000-4000-8000-0000000000a1/'||j::text||'/out.png',2048,'image/png',768,1024);
  ver := private.complete_look_job(j,f,a);
  insert into slice values('v2',ver::text);
end $$;
reset role;

do $$ declare c uuid := (select v::uuid from slice where k='unknown'); begin
  assert (select status from private.provider_calls where id=c)='unknown', 'unknown cost became zero';
  assert (select reserved_usd_micros from private.provider_budget_usage where scope='provider' and period='day')=500000, 'unknown reservation released early';
  set local role stylai_ai_worker;
  assert private.reconcile_provider_call(c,'failed',0,'provider_confirmed','{"note":"fixture"}');
  reset role;
  assert (select reserved_usd_micros from private.provider_budget_usage where scope='provider' and period='day')=0;
  assert (select version||':'||coalesce(parent_version_id::text,'-') from private.look_versions where id=(select v::uuid from slice where k='v2'))
    ='2:'||(select v from slice where k='v1'), 'v2 lineage';
  assert (select product_id from private.look_versions where id=(select v::uuid from slice where k='v1'))='60000000-0000-4000-8000-000000000001', 'v1 mutated';
  assert (select selection_snapshot->>'name' from private.look_versions where id=(select v::uuid from slice where k='v1'))='Jaqueta A', 'v1 snapshot mutated';
end $$;

-- Cancellation mid-processing: the worker's fence dies; nothing can be published.
set local role stylai_api;
do $$ declare j uuid; begin
  j := private.enqueue_look_job('10000000-0000-4000-8000-0000000000a1','slice-cancel',repeat('e',64),
    'test-v1','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',null);
  insert into slice values('job3',j::text);
end $$;
reset role;
set local role stylai_ai_worker;
do $$ declare j uuid := (select v::uuid from slice where k='job3'); f bigint; begin
  f := private.claim_ai_job(j);
  insert into slice values('fence3',f::text);
end $$;
reset role;
set local role stylai_api;
do $$ begin
  assert private.cancel_ai_job('10000000-0000-4000-8000-0000000000a1',(select v::uuid from slice where k='job3')), 'cancel failed';
end $$;
reset role;
set local role stylai_ai_worker;
do $$ declare j uuid := (select v::uuid from slice where k='job3'); f bigint := (select v::bigint from slice where k='fence3'); begin
  assert not private.renew_ai_job_lease(j,f), 'cancelled job lease renewed';
  begin
    perform private.register_generated_asset(j,f,'10000000-0000-4000-8000-0000000000a1/'||j::text||'/out.png',2048,'image/png',768,1024);
    raise exception 'asset registered after cancel';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Telemetry outbox: dedup by key, 'unknown' never reclaimed
set local role stylai_ai_worker;
do $$ declare e jsonb; begin
  assert private.enqueue_telemetry_event('evt-1',null,'{"kind":"test"}');
  assert not private.enqueue_telemetry_event('evt-1',null,'{"kind":"test"}'), 'duplicate telemetry row';
  e := private.claim_telemetry_events(10);
  assert jsonb_array_length(e)=1;
  assert private.mark_telemetry_event((e->0->>'id')::uuid,'unknown');
  assert jsonb_array_length(private.claim_telemetry_events(10))=0, 'unknown event was resent';
end $$;
reset role;

select 'Motor slice SQL assertions passed.';
rollback;
