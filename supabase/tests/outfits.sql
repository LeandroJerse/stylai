-- Autonomous outfit flow (20261124100000), executed with the real restricted roles. Everything rolls back.
begin;
delete from private.provider_budget_limits;
insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
 ('global','*','day',1000000),('global','*','month',5000000),('provider','segmind','day',1000000),('provider','segmind','month',5000000),
 ('user','*','day',100000),('job','*','job',60000);
insert into auth.users(id) values ('80000000-0000-4000-8000-00000000000a'),('80000000-0000-4000-8000-00000000000b');
insert into private.photo_consents(user_id,policy_version) values ('80000000-0000-4000-8000-00000000000a','dev-v1'),('80000000-0000-4000-8000-00000000000b','dev-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,body_angle,validation_status,validator_version,validation)
  select ('85000000-0000-4000-8000-00000000000'||x)::uuid,('80000000-0000-4000-8000-00000000000'||x)::uuid,'body_photo','ready','body-photos',
    '80000000-0000-4000-8000-00000000000'||x||'/front.png',10,'image/png',600,900,now()+interval '1 day','front','approved',
    'test+'||private.required_pose_rules(),'{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb from unnest(array['a','b']) x;
insert into private.settings_versions(kind,scope,version,payload,effective_at,reason) values ('membership','outfit-test',1,'{"coins_per_day":120}'::jsonb,now(),'test') on conflict do nothing;
insert into private.ai_memberships(user_id,plan_version_id,environment,merchant_ref,provider_subscription_id,provider_payment_id,valid_from,valid_until)
  select '80000000-0000-4000-8000-00000000000a',(select id from private.settings_versions where kind='membership' and scope='outfit-test' and version=1),'sandbox','local-test','ot-a','ot-a-1',now()-interval '1 hour',now()+interval '1 day';

set local role stylai_api;

-- ---------------------------------------------------------------- automatic references under a revocable policy
do $$
declare r jsonb; declare again jsonb;
begin
  r := private.register_source_reference('aliexpress',jsonb_build_object('externalProductId','1001','seller','aliexpress-shop-7','sellerName','Loja 7','name','Camisa social branca',
    'category','shirts','imageUrl','https://ae01.alicdn.com/kf/a.jpg','productUrl','https://pt.aliexpress.com/item/1001.html','priceMinor',9000,'observedAt',now()),
    jsonb_build_object('sha256',repeat('a',64),'mime','image/jpeg','bytes',1234,'width',600,'height',800,'objectKey','catalog/'||repeat('a',64)||'.jpg'));
  assert r->>'imageUrl'='https://ae01.alicdn.com/kf/a.jpg' and r->>'productId' is not null and r->>'variantId' is not null, 'reference not registered';
  perform set_config('t.p1',r->>'productId',true); perform set_config('t.v1',r->>'variantId',true);
  again := private.register_source_reference('aliexpress',jsonb_build_object('externalProductId','1001','seller','aliexpress-shop-7','sellerName','Loja 7','name','Camisa social branca',
    'category','shirts','imageUrl','https://ae01.alicdn.com/kf/a.jpg','productUrl','https://pt.aliexpress.com/item/1001.html','priceMinor',9500,'observedAt',now()),
    jsonb_build_object('sha256',repeat('a',64),'mime','image/jpeg','bytes',1234,'width',600,'height',800,'objectKey','catalog/'||repeat('a',64)||'.jpg'));
  assert again->>'productId'=r->>'productId' and again->>'variantId'=r->>'variantId', 'registration is not idempotent';
  r := private.register_source_reference('aliexpress',jsonb_build_object('externalProductId','1002','seller','aliexpress-shop-7','sellerName','Loja 7','name','Calça alfaiataria',
    'category','pants','imageUrl','https://ae01.alicdn.com/kf/b.jpg','productUrl','https://pt.aliexpress.com/item/1002.html','priceMinor',15000,'observedAt',now()),
    jsonb_build_object('sha256',repeat('b',64),'mime','image/jpeg','bytes',1234,'width',600,'height',800,'objectKey','catalog/'||repeat('b',64)||'.jpg'));
  perform set_config('t.p2',r->>'productId',true); perform set_config('t.v2',r->>'variantId',true);
  r := private.register_source_reference('aliexpress',jsonb_build_object('externalProductId','1003','seller','aliexpress-shop-8','sellerName','Loja 8','name','Terno masculino',
    'category','outfit_sets','imageUrl','https://ae01.alicdn.com/kf/c.jpg','productUrl','https://pt.aliexpress.com/item/1003.html','priceMinor',40000,'observedAt',now()),
    jsonb_build_object('sha256',repeat('c',64),'mime','image/jpeg','bytes',1234,'width',600,'height',800,'objectKey','catalog/'||repeat('c',64)||'.jpg'));
  perform set_config('t.p3',r->>'productId',true); perform set_config('t.v3',r->>'variantId',true);
  begin
    perform private.register_source_reference('aliexpress',jsonb_build_object('externalProductId','1009','seller','s','sellerName','s','name','x','category','shirts',
      'imageUrl','https://alicdn.com.evil.test/a.jpg','productUrl','https://pt.aliexpress.com/item/1.html','priceMinor',1,'observedAt',now()),
      jsonb_build_object('sha256',repeat('a',64),'mime','image/jpeg','bytes',1,'width',1,'height',1,'objectKey','catalog/x.jpg'));
    raise exception 'foreign host accepted';
  exception when sqlstate 'SA003' then null; end;
  begin
    perform private.register_source_reference('tiktok_shop',jsonb_build_object('externalProductId','1','seller','s','sellerName','s','name','x','category','shirts',
      'imageUrl','https://ae01.alicdn.com/kf/z.jpg','productUrl','https://pt.aliexpress.com/item/1.html','priceMinor',1,'observedAt',now()),
      jsonb_build_object('sha256',repeat('a',64),'mime','image/jpeg','bytes',1,'width',1,'height',1,'objectKey','catalog/x.jpg'));
    raise exception 'source without policy accepted';
  exception when sqlstate 'SA003' then null; end;
  assert not exists(select 1 from jsonb_array_elements(private.list_catalog_products(48,0,null)->'items') i where i->>'id'=current_setting('t.p1')), 'references leaked into the local catalog';
end $$;

-- ---------------------------------------------------------------- searches, sets and revisions
do $$
declare s jsonb; declare again jsonb; declare f jsonb; declare read jsonb; declare set_id uuid; declare rev integer;
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b';
begin
  s := private.create_outfit_search(a,'search-key-1',repeat('1',64),'roupas italianas','aliexpress_affiliate','claude-haiku');
  again := private.create_outfit_search(a,'search-key-1',repeat('1',64),'roupas italianas','aliexpress_affiliate','claude-haiku');
  assert s->>'id'=again->>'id' and (s->>'created')::boolean and not (again->>'created')::boolean, 'search replay created another search';
  begin perform private.create_outfit_search(a,'search-key-1',repeat('2',64),'outra','aliexpress_affiliate',null); raise exception 'key reused'; exception when unique_violation then null; end;
  begin perform private.create_outfit_search(a,'search-key-2',repeat('3',64),'outra','aliexpress_affiliate',null); raise exception 'two searches at once'; exception when unique_violation then null; end;
  assert private.update_outfit_search(a,(s->>'id')::uuid,'searching','{"done":1,"total":3}'), 'stage not saved';
  assert not private.update_outfit_search(b,(s->>'id')::uuid,'searching','{}'), 'foreign account changed a search';
  assert private.read_outfit_search(a,(s->>'id')::uuid)->>'stage'='searching', 'stage not readable';
  f := private.finish_outfit_search(a,(s->>'id')::uuid,'succeeded',null,'agent','{"pools":{}}',
    jsonb_build_array(
      jsonb_build_object('kind','assembled','recommended',true,'title','Italiano','rationale','r','missingSlots','[]'::jsonb,'totalMinor',24000,'pieces',
        jsonb_build_array(jsonb_build_object('slot','lower','id','aliexpress:1002'),jsonb_build_object('slot','upper','id','aliexpress:1001'))),
      jsonb_build_object('kind','bundle','recommended',false,'title','Terno','rationale','r','missingSlots','[]'::jsonb,'totalMinor',40000,'pieces',
        jsonb_build_array(jsonb_build_object('slot','set','id','aliexpress:1003')))));
  assert jsonb_array_length(f)=2, 'sets not stored';
  read := private.read_outfit_search(a,(s->>'id')::uuid);
  assert read->>'status'='succeeded' and jsonb_array_length(read->'sets')=2 and read->'sets'->0->>'title'='Italiano', 'search not recoverable';
  assert private.read_outfit_search(b,(s->>'id')::uuid) is null, 'foreign search readable';
  set_id := (read->'sets'->0->>'id')::uuid;
  perform set_config('t.search',s->>'id',true); perform set_config('t.set1',set_id::text,true); perform set_config('t.set2',read->'sets'->1->>'id',true);
  assert private.read_outfit_set(b,set_id) is null, 'foreign set readable';
  rev := private.save_outfit_set_revision(a,set_id,1,'swap',jsonb_build_array(jsonb_build_object('slot','upper','id','aliexpress:1001')),'[]',9000);
  assert rev=2, 'revision not appended';
  begin perform private.save_outfit_set_revision(a,set_id,1,'swap','[{"slot":"upper","id":"x"}]','[]',1); raise exception 'stale revision accepted'; exception when serialization_failure then null; end;
  begin perform private.save_outfit_set_revision(b,set_id,2,'swap','[{"slot":"upper","id":"x"}]','[]',1); raise exception 'foreign revision accepted'; exception when insufficient_privilege then null; end;
  rev := private.save_outfit_set_revision(a,set_id,2,'swap',jsonb_build_array(jsonb_build_object('slot','lower','id','aliexpress:1002'),jsonb_build_object('slot','upper','id','aliexpress:1001')),'["upper"]',24000);
  assert jsonb_array_length(private.read_outfit_set(a,set_id)->'revisions')=3, 'revision history lost';
  assert private.set_outfit_locks(a,set_id,3,'["lower"]'), 'locks refused';
  assert private.read_outfit_set(a,set_id)->'locked'='["lower"]'::jsonb and (private.read_outfit_set(a,set_id)->>'revision')::integer=3, 'locks not kept';
  begin perform private.set_outfit_locks(a,set_id,3,'["dress"]'); raise exception 'lock without piece accepted'; exception when check_violation then null; end;
  begin perform private.set_outfit_locks(a,set_id,2,'[]'); raise exception 'stale lock accepted'; exception when serialization_failure then null; end;
  begin perform private.set_outfit_locks(b,set_id,3,'[]'); raise exception 'foreign lock accepted'; exception when insufficient_privilege then null; end;
  -- "Buscar outra": options found by the server join the pool of that part only, newest first, never twice, owner only.
  assert private.add_outfit_options(a,set_id,'upper','[{"slot":"upper","id":"aliexpress:2001"},{"slot":"upper","id":"aliexpress:2002"},{"slot":"upper","id":"aliexpress:2001"}]')=2, 'options not added once';
  assert private.add_outfit_options(a,set_id,'upper','[{"slot":"upper","id":"aliexpress:2002"},{"slot":"upper","id":"aliexpress:2003"}]')=1, 'known option added again';
  assert private.add_outfit_options(a,set_id,'upper','[{"slot":"upper","id":"aliexpress:2003"}]')=0, 'repeated option counted';
  assert private.read_outfit_set(a,set_id)#>>'{plan,pools,upper,0,id}'='aliexpress:2003' and jsonb_array_length(private.read_outfit_set(a,set_id)#>'{plan,pools,upper}')=3, 'options not readable';
  assert (private.read_outfit_set(a,set_id)->>'revision')::integer=3, 'options created a revision';
  begin perform private.add_outfit_options(b,set_id,'upper','[{"slot":"upper","id":"x"}]'); raise exception 'foreign options accepted'; exception when insufficient_privilege then null; end;
  begin perform private.add_outfit_options(a,set_id,'dress','[{"slot":"dress","id":"x"}]'); raise exception 'options for an absent part accepted'; exception when check_violation then null; end;
  begin perform private.add_outfit_options(a,set_id,'upper','[{"slot":"lower","id":"x"}]'); raise exception 'wrong slot accepted'; exception when check_violation then null; end;
  begin perform private.add_outfit_options(a,set_id,'upper','[]'); raise exception 'empty options accepted'; exception when check_violation then null; end;
  perform private.add_outfit_options(a,set_id,'upper',(select jsonb_agg(jsonb_build_object('slot','upper','id','aliexpress:3'||lpad(n::text,3,'0'))) from generate_series(1,24) n));
  perform private.add_outfit_options(a,set_id,'upper',(select jsonb_agg(jsonb_build_object('slot','upper','id','aliexpress:4'||lpad(n::text,3,'0'))) from generate_series(1,24) n));
  assert jsonb_array_length(private.read_outfit_set(a,set_id)#>'{plan,pools,upper}')=48 and private.read_outfit_set(a,set_id)#>>'{plan,pools,upper,0,id}'='aliexpress:4001', 'options not bounded, newest first';
  -- A cancelled search refuses further stages.
  s := private.create_outfit_search(a,'search-key-3',repeat('4',64),'frio','aliexpress_affiliate',null);
  assert private.cancel_outfit_search(a,(s->>'id')::uuid) and not private.update_outfit_search(a,(s->>'id')::uuid,'selecting','{}'), 'cancelled search kept running';
  assert jsonb_array_length(private.list_outfit_searches(a,10))=2 and jsonb_array_length(private.list_outfit_searches(b,10))=0, 'history isolation';
end $$;

-- ---------------------------------------------------------------- batch budget, atomicity, idempotency
create or replace function pg_temp.panel(p_set text, p_rev integer, p_items jsonb) returns jsonb language sql as $$
  select jsonb_build_object('set_id',p_set,'revision',p_rev,'label','Conjunto','items',p_items) $$;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b';
declare two jsonb; declare one jsonb; declare r uuid; declare q jsonb;
begin
  two := jsonb_build_array(
    pg_temp.panel(current_setting('t.set1'),3,jsonb_build_array(
      jsonb_build_object('slot','lower','product_id',current_setting('t.p2'),'variant_id',current_setting('t.v2'),'image_url','https://ae01.alicdn.com/kf/b.jpg','commerce',jsonb_build_object('canonical_id','aliexpress:1002','affiliate_url','https://s.click.aliexpress.com/e/b')),
      jsonb_build_object('slot','upper','product_id',current_setting('t.p1'),'variant_id',current_setting('t.v1'),'image_url','https://ae01.alicdn.com/kf/a.jpg','commerce',jsonb_build_object('canonical_id','aliexpress:1001','affiliate_url',null)))),
    pg_temp.panel(current_setting('t.set2'),1,jsonb_build_array(
      jsonb_build_object('slot','set','product_id',current_setting('t.p3'),'variant_id',current_setting('t.v3'),'image_url','https://ae01.alicdn.com/kf/c.jpg','commerce',jsonb_build_object('canonical_id','aliexpress:1003','affiliate_url',null)))));
  perform set_config('t.two',two::text,true);
  q := private.outfit_budget(a,'segmind','flux-3-klein-image-edit',20000,2,null,null);
  assert (q->>'ok')::boolean and (q->>'remaining_usd_micros')::bigint=100000, 'budget quote: '||q::text;
  assert (private.outfit_budget(a,'segmind','flux-3-klein-image-edit',60000,2,null,null)->'limiting') ? 'user', 'insufficient user budget not reported';
  -- Over the whole-batch budget: nothing is created, reserved or charged.
  begin
    perform private.enqueue_outfit_render(a,'render-key-0',repeat('0',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',60000,null,two);
    raise exception 'batch over budget accepted';
  exception when sqlstate 'SA007' then null; end;
  assert private.read_active_ai_job(a) is null, 'a refused batch left a job behind';
  begin perform private.enqueue_outfit_render(b,'render-key-b',repeat('0',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',20000,null,two); raise exception 'foreign sets accepted'; exception when insufficient_privilege then null; end;
  begin perform private.enqueue_outfit_render(a,'render-key-x',repeat('0',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',20000,null,jsonb_build_array(two->0)); raise exception 'one-panel comparison accepted'; exception when check_violation then null; end;
  r := private.enqueue_outfit_render(a,'render-key-1',repeat('1',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',20000,null,two);
  assert r=private.enqueue_outfit_render(a,'render-key-1',repeat('1',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',20000,null,two), 'double click created another batch';
  begin perform private.enqueue_outfit_render(a,'render-key-2',repeat('2',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',20000,null,two); raise exception 'second active batch accepted'; exception when unique_violation then null; end;
  perform set_config('t.render',r::text,true);
  assert jsonb_array_length(private.read_outfit_render(a,r)->'panels')=2 and private.read_outfit_render(b,r) is null, 'render isolation';
  -- The whole batch is held: 2 x 20000 of the user's 100000.
  assert (private.outfit_budget(a,'segmind','flux-3-klein-image-edit',20000,1,null,null)->>'remaining_usd_micros')::bigint=60000, 'batch not held';
end $$;

-- ---------------------------------------------------------------- worker: serialized panels, partial failure
set local role stylai_ai_worker;
do $$
declare j1 uuid; declare j2 uuid; declare f bigint; declare f2 bigint; declare c uuid; declare asset uuid; declare loaded jsonb;
begin
  assert private.server_boundary_version()='20261124210000', 'boundary version';
  j1 := private.next_ai_job(); f := private.claim_ai_job(j1);
  loaded := private.load_ai_job(j1,f);
  assert loaded->'items'->0->>'canonical_id'='aliexpress:1002' and loaded->'items'->0->>'affiliate_url'='https://s.click.aliexpress.com/e/b', 'commerce link not bound to its panel';
  assert loaded->'items'->0->'reference'->>'sha256'=repeat('b',64), 'cached reference not offered';
  -- The sibling panel waits (one paid call in flight per batch).
  assert private.next_ai_job() is null, 'sibling panel offered while another runs';
  perform private.record_job_item_snapshot(j1,f,1::smallint,jsonb_build_object('garment_image_url','https://ae01.alicdn.com/kf/b.jpg'));
  perform private.record_job_item_snapshot(j1,f,2::smallint,jsonb_build_object('garment_image_url','https://ae01.alicdn.com/kf/a.jpg'));
  perform private.record_ai_selection(j1,f,current_setting('t.p2')::uuid,current_setting('t.v2')::uuid,'{"name":"x"}');
  assert (private.check_layer_budget(j1,f,'segmind',1,20000,null)->>'ok')::boolean, 'own hold counted against itself';
  c := private.reserve_provider_call(j1,f,'segmind','flux-3-klein-image-edit','v1','generation','gen_outfit_test_1',20000,'u_0123456789abcdef','test');
  assert private.begin_provider_call(c,f), 'dispatch refused';
  perform private.settle_provider_call(c,'succeeded',null,'{}','{}',20000,12870,null,'computed_from_usage',10,null);
  asset := private.register_generated_asset(j1,f,'80000000-0000-4000-8000-00000000000a/'||j1||'/look.png',10,'image/png',300,400);
  assert private.complete_look_job(j1,f,asset) is not null, 'panel 1 not published';
  j2 := private.next_ai_job(); assert j2 is not null and j2<>j1, 'second panel not released';
  f2 := private.claim_ai_job(j2);
  assert private.load_ai_job(j2,f2)->'items'->0->>'slot'='set', 'complete set slot lost';
  assert private.fail_look_job(j2,f2,'garment_download_failed'), 'panel 2 failure';
  assert private.claim_outfit_comparison() is null, 'comparison built with a missing panel';
end $$;

set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b'; declare r uuid := current_setting('t.render')::uuid; declare v jsonb;
begin
  v := private.read_outfit_render(a,r);
  assert v->'panels'->0->>'version_id' is not null and v->'panels'->1->'job'->>'status'='failed' and v->>'comparison_state'='waiting', 'partial state: '||v::text;
  -- Hold of the failed panel released, finished panel settled at its real cost: 100000 - 12870.
  assert (private.outfit_budget(a,'segmind','flux-3-klein-image-edit',20000,1,null,null)->>'remaining_usd_micros')::bigint=87130, 'hold not released';
  begin perform private.retry_outfit_panel(b,r,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,false); raise exception 'foreign retry accepted'; exception when insufficient_privilege then null; end;
  begin perform private.retry_outfit_panel(a,r,1::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,false); raise exception 'finished panel retried'; exception when check_violation then null; end;
  perform private.retry_outfit_panel(a,r,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,false);
  -- A second click while the retry is active changes nothing.
  begin perform private.retry_outfit_panel(a,r,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,false); raise exception 'double retry'; exception when unique_violation then null; end;
end $$;

-- Unknown outcome blocks another attempt until reconciled.
set local role stylai_ai_worker;
do $$
declare j uuid; declare f bigint; declare c uuid;
begin
  j := private.next_ai_job(); f := private.claim_ai_job(j);
  perform private.record_job_item_snapshot(j,f,1::smallint,jsonb_build_object('garment_image_url','https://ae01.alicdn.com/kf/c.jpg'));
  perform private.record_ai_selection(j,f,current_setting('t.p3')::uuid,current_setting('t.v3')::uuid,'{"name":"x"}');
  c := private.reserve_provider_call(j,f,'segmind','flux-3-klein-image-edit','v1','generation','gen_outfit_test_2',20000,'u_0123456789abcdef','test');
  perform private.begin_provider_call(c,f);
  perform private.settle_provider_call(c,'unknown',null,'{}','{}',20000,null,null,'unknown',0,null);
  perform private.fail_look_job(j,f,'provider_outcome_unknown');
  perform set_config('t.call',c::text,true);
end $$;
set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare r uuid := current_setting('t.render')::uuid;
begin
  assert private.read_outfit_render(a,r)->'panels'->1->>'charge_state'='unknown', 'unknown charge not reported';
  begin perform private.retry_outfit_panel(a,r,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,true); raise exception 'unknown outcome retried'; exception when sqlstate 'SA008' then null; end;
end $$;
set local role stylai_ai_worker;
do $$ begin assert private.reconcile_provider_call(current_setting('t.call')::uuid,'failed',20000,'provider_confirmed','{}'), 'reconcile'; end $$;
set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare r uuid := current_setting('t.render')::uuid;
begin
  -- Charged without a result: another charge needs explicit acceptance.
  begin perform private.retry_outfit_panel(a,r,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,false); raise exception 'second charge without acceptance'; exception when sqlstate 'SA009' then null; end;
  begin perform private.finalize_outfit_render(a,r); raise exception 'comparison of one panel'; exception when check_violation then null; end;
end $$;

-- The photo was replaced: a comparison never mixes photos.
reset role;
savepoint photo;
update private.assets set state='deleting' where id='85000000-0000-4000-8000-00000000000a';
insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,body_angle,validation_status,validator_version,validation)
  values('80000000-0000-4000-8000-00000000000a','body_photo','ready','body-photos','80000000-0000-4000-8000-00000000000a/new.png',10,'image/png',600,900,now()+interval '1 day','front','approved',
    'test+'||private.required_pose_rules(),'{"supports":{"upper":true,"lower":true,"dress":true}}');
set local role stylai_api;
do $$ begin
  perform private.retry_outfit_panel('80000000-0000-4000-8000-00000000000a',current_setting('t.render')::uuid,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,true);
  raise exception 'mixed photos accepted'; exception when sqlstate 'SA010' then null; end $$;
rollback to savepoint photo;

-- Retry accepted, succeeds, comparison becomes buildable exactly once.
set local role stylai_api;
do $$ begin perform private.retry_outfit_panel('80000000-0000-4000-8000-00000000000a',current_setting('t.render')::uuid,2::smallint,'dev-v1','segmind','flux-3-klein-image-edit',20000,null,true); end $$;
set local role stylai_ai_worker;
do $$
declare j uuid; declare f bigint; declare c uuid; declare asset uuid; declare cmp jsonb; declare ok boolean;
begin
  j := private.next_ai_job(); f := private.claim_ai_job(j);
  perform private.record_job_item_snapshot(j,f,1::smallint,jsonb_build_object('garment_image_url','https://ae01.alicdn.com/kf/c.jpg'));
  perform private.record_ai_selection(j,f,current_setting('t.p3')::uuid,current_setting('t.v3')::uuid,'{"name":"x"}');
  c := private.reserve_provider_call(j,f,'segmind','flux-3-klein-image-edit','v1','generation','gen_outfit_test_3',20000,'u_0123456789abcdef','test');
  perform private.begin_provider_call(c,f);
  perform private.settle_provider_call(c,'succeeded',null,'{}','{}',20000,12870,null,'computed_from_usage',10,null);
  asset := private.register_generated_asset(j,f,'80000000-0000-4000-8000-00000000000a/'||j||'/look.png',10,'image/png',300,400);
  perform private.complete_look_job(j,f,asset);
  cmp := private.claim_outfit_comparison();
  assert cmp->>'id'=current_setting('t.render') and jsonb_array_length(cmp->'panels')=2 and cmp->'panels'->0->>'object_key' is not null, 'comparison not claimable';
  assert private.claim_outfit_comparison() is null, 'comparison claimed twice';
  assert not private.complete_outfit_comparison((cmp->>'id')::uuid,(cmp->>'fence')::bigint+1,'80000000-0000-4000-8000-00000000000a/'||(cmp->>'id')||'/comparison.png',10,'image/png',600,400,'{}'), 'stale fence published';
  begin perform private.complete_outfit_comparison((cmp->>'id')::uuid,(cmp->>'fence')::bigint,'80000000-0000-4000-8000-00000000000b/x/comparison.png',10,'image/png',600,400,'{}'); raise exception 'foreign key accepted'; exception when check_violation then null; end;
  assert private.complete_outfit_comparison((cmp->>'id')::uuid,(cmp->>'fence')::bigint,'80000000-0000-4000-8000-00000000000a/'||(cmp->>'id')||'/comparison.png',10,'image/png',600,400,'{"panels":2}'), 'comparison not published';
end $$;
set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b'; declare r uuid := current_setting('t.render')::uuid; declare v jsonb; declare r2 uuid;
begin
  v := private.read_outfit_render(a,r);
  assert v->>'comparison_state'='ready' and v->'panels'->0->>'version_id' is not null and v->'panels'->1->>'version_id' is not null, 'individual results lost';
  assert private.read_comparison_asset(a,r)->>'object_key' like a::text||'/%' and private.read_comparison_asset(b,r) is null, 'comparison asset isolation';
  assert jsonb_array_length(private.list_outfit_renders(a,10))=1 and jsonb_array_length(private.list_outfit_renders(b,10))=0, 'render history isolation';
  -- Match and Closet: a saved version keeps its image and its pieces; a decision is one per version, undoable, owner only.
  perform set_config('t.ver1',v->'panels'->0->>'version_id',true); perform set_config('t.ver2',v->'panels'->1->>'version_id',true);
  -- Later choice of another saved set: new individual render, previous results untouched.
  r2 := private.enqueue_outfit_render(a,'render-key-9',repeat('9',64),'dev-v1','individual','segmind','flux-3-klein-image-edit',20000,null,jsonb_build_array(current_setting('t.two')::jsonb->1));
  assert private.read_outfit_render(a,r2)->>'mode'='individual' and private.read_outfit_render(a,r)->>'comparison_state'='ready', 'history overwritten';
  assert private.cancel_outfit_render(a,r2)=1, 'queued panel not cancelled';
  -- Separate statement: a stable read inside the same one would still see the old snapshot.
  assert private.read_outfit_render(a,r2)->'panels'->0->'job'->>'status'='cancelled', 'queued panel not cancelled';
end $$;

do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b';
declare v1 uuid := current_setting('t.ver1')::uuid; declare v2 uuid := current_setting('t.ver2')::uuid; declare d1 uuid; declare d2 uuid;
begin
  assert jsonb_array_length(private.list_match_deck(a,v2,30))=2 and private.list_match_deck(a,v2,30)->>0=v2::text, 'deck without the generated looks, or not starting at the asked one';
  assert private.list_match_deck(b,null,30)='[]'::jsonb, 'foreign deck';
  d1 := private.decide_look(a,v1,'save'); d2 := private.decide_look(a,v2,'pass');
  assert private.decide_look(a,v1,'save')=d1, 'double tap became another decision';
  perform set_config('t.d1',d1::text,true); perform set_config('t.d2',d2::text,true);
  begin perform private.decide_look(b,v1,'save'); raise exception 'foreign decision accepted'; exception when insufficient_privilege then null; end;
  begin perform private.decide_look(a,v1,'love'); raise exception 'unknown decision accepted'; exception when check_violation then null; end;
  begin perform private.set_saved_look(b,v1,true); raise exception 'foreign save accepted'; exception when insufficient_privilege then null; end;
end $$;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a';
begin
  assert private.list_match_deck(a,null,30)='[]'::jsonb, 'decided looks stayed in the deck';
  assert jsonb_array_length(private.list_saved_looks(a,10))=1 and private.list_saved_looks(a,10)->0->>'version_id'=current_setting('t.ver1'), 'match did not save the look';
  assert private.list_saved_looks('80000000-0000-4000-8000-00000000000b',10)='[]'::jsonb, 'foreign closet';
end $$;
reset role;
do $$ begin
  assert (select a.expires_at is null from private.assets a join private.look_versions v on v.asset_id=a.id where v.id=current_setting('t.ver1')::uuid), 'saved image would expire';
  assert (select a.expires_at is not null from private.assets a join private.look_versions v on v.asset_id=a.id where v.id=current_setting('t.ver2')::uuid), 'passed image kept';
  assert (select count(*) from private.saved_look_products where user_id='80000000-0000-4000-8000-00000000000a')>=1, 'pieces not saved';
end $$;
set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a';
begin
  assert not private.undo_look_decision('80000000-0000-4000-8000-00000000000b',current_setting('t.d1')::uuid), 'foreign undo';
  assert private.undo_look_decision(a,current_setting('t.d1')::uuid) and not private.undo_look_decision(a,current_setting('t.d1')::uuid), 'undo not once';
end $$;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a';
begin
  assert private.list_saved_looks(a,10)='[]'::jsonb and private.list_match_deck(a,null,30)->>0=current_setting('t.ver1'), 'undo did not take the look out';
  -- Saved by hand first: a later match decision and its undo never remove it.
  perform private.set_saved_look(a,current_setting('t.ver1')::uuid,true);
  perform set_config('t.d1',private.decide_look(a,current_setting('t.ver1')::uuid,'save')::text,true);
  perform private.undo_look_decision(a,current_setting('t.d1')::uuid);
end $$;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b';
begin
  assert jsonb_array_length(private.list_saved_looks(a,10))=1, 'undo removed a look saved by hand';
  perform private.set_saved_look(a,current_setting('t.ver1')::uuid,false);
  assert private.set_saved_piece(a,'aliexpress:1','{"id":"aliexpress:1","name":"Camisa"}') and private.set_saved_piece(a,'aliexpress:1','{"id":"aliexpress:1","name":"Camisa"}'), 'piece not saved';
  begin perform private.set_saved_piece(a,'aliexpress:2',jsonb_build_object('x',repeat('y',9000))); raise exception 'huge snapshot accepted'; exception when check_violation then null; end;
end $$;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare b uuid := '80000000-0000-4000-8000-00000000000b';
begin
  assert private.list_saved_looks(a,10)='[]'::jsonb, 'look not removed';
  assert jsonb_array_length(private.list_saved_pieces(a))=1 and private.list_saved_pieces(b)='[]'::jsonb, 'pieces isolation';
  assert not private.set_saved_piece(a,'aliexpress:1',null), 'piece removal';
end $$;

-- ---------------------------------------------------------------- pilot gate stays closed for policy references by default
reset role;
insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
  values ('outfit-pilot','segmind','flux-3-klein-image-edit','real',2000000,1,'80000000-0000-4000-8000-00000000000a','aliexpress','stylai-pilot','test',now()-interval '1 day');
set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a'; declare q jsonb; declare ids uuid[] := array[current_setting('t.p1')::uuid];
begin
  q := private.outfit_budget(a,'segmind','flux-3-klein-image-edit',20000,1,'outfit-pilot',ids);
  assert q->'limiting' ? 'pilot_items' and not (q->>'ok')::boolean, 'policy references open the pilot by default: '||q::text;
  assert private.outfit_budget(a,'segmind','flux-3-klein-image-edit',20000,2,'outfit-pilot',ids)->'limiting' ? 'pilot_attempts', 'attempts not checked for the batch';
  assert private.outfit_budget('80000000-0000-4000-8000-00000000000b','segmind','flux-3-klein-image-edit',20000,1,'outfit-pilot',ids)->'limiting' ? 'pilot_user', 'foreign pilot user';
  assert private.outfit_budget(a,'segmind','other-model',20000,1,'outfit-pilot',ids)->'limiting' ? 'pilot_target', 'foreign model';
  begin
    perform private.enqueue_outfit_render(a,'render-key-p',repeat('7',64),'dev-v1','individual','segmind','flux-3-klein-image-edit',20000,'outfit-pilot',jsonb_build_array(current_setting('t.two')::jsonb->1));
    raise exception 'closed pilot accepted a job';
  exception when sqlstate 'SA007' then null; end;
end $$;
reset role;
update private.ai_pilots set allow_policy_references=true where id='outfit-pilot';
set local role stylai_api;
do $$ begin
  assert (private.outfit_budget('80000000-0000-4000-8000-00000000000a','segmind','flux-3-klein-image-edit',20000,1,'outfit-pilot',array[current_setting('t.p1')::uuid])->>'ok')::boolean, 'operator switch ignored';
end $$;

-- ---------------------------------------------------------------- revocation
reset role;
update private.source_image_policies set revoked_at=now() where source='aliexpress';
set local role stylai_api;
do $$
declare a uuid := '80000000-0000-4000-8000-00000000000a';
begin
  assert private.read_source_generation_references('aliexpress','[{"externalProductId":"1001","imageUrl":"https://ae01.alicdn.com/kf/a.jpg"}]')='[]'::jsonb, 'revoked policy still authorizes';
  begin
    perform private.register_source_reference('aliexpress',jsonb_build_object('externalProductId','1001','seller','aliexpress-shop-7','sellerName','Loja 7','name','Camisa','category','shirts',
      'imageUrl','https://ae01.alicdn.com/kf/a.jpg','productUrl','https://pt.aliexpress.com/item/1001.html','priceMinor',9000,'observedAt',now()),
      jsonb_build_object('sha256',repeat('a',64),'mime','image/jpeg','bytes',1234,'width',600,'height',800,'objectKey','catalog/'||repeat('a',64)||'.jpg'));
    raise exception 'revoked policy registered';
  exception when sqlstate 'SA003' then null; end;
  begin
    perform private.enqueue_outfit_render(a,'render-key-r',repeat('8',64),'dev-v1','individual','segmind','flux-3-klein-image-edit',20000,null,jsonb_build_array(current_setting('t.two')::jsonb->1));
    raise exception 'revoked reference generated';
  exception when sqlstate 'SA003' then null; end;
end $$;
set local role stylai_ai_worker;
do $$ begin
  assert jsonb_array_length(private.claim_reference_purges(10))=3, 'revoked cache not queued for removal';
  assert private.finish_reference_purge('catalog/'||repeat('a',64)||'.jpg',true), 'cache purge not recorded';
end $$;
reset role;
do $$ begin raise notice 'Outfit flow assertions passed'; end $$;
select 'Outfit flow assertions passed (references, searches, batch budget, partial recovery, comparison, isolation, revocation).';
rollback;
