-- Multi-piece composition jobs (20261123210932), executed with the real restricted roles.
begin;

insert into auth.users(id) values ('60000000-0000-4000-8000-00000000000a'),('60000000-0000-4000-8000-00000000000b');
insert into public.categories(id,label) values ('tops','Blusas'),('pants','Calças'),('dresses','Vestidos'),('jackets','Jaquetas')
  on conflict do nothing;
insert into public.partners(id,source,external_seller_id,region,name) values
  ('61000000-0000-4000-8000-000000000001','curated','composition-seller','BR','Loja composição');
insert into public.products(id,partner_id,external_product_id,category_id,name,price_minor,availability,published,rights_cleared,fixture) values
  ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','c-top','tops','Blusa',1000,'unknown',true,true,true),
  ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','c-pants','pants','Calça',2000,'unknown',true,true,true),
  ('62000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','c-dress','dresses','Vestido',3000,'unknown',true,true,true),
  ('62000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001','c-jacket','jackets','Jaqueta só exibição',4000,'unknown',true,true,true);
insert into public.product_variants(id,product_id,external_variant_id,label,available) values
  ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','cv1','M',true),
  ('63000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','cv2','40',true),
  ('63000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000003','cv3','M',true),
  ('63000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000004','cv4','M',true);
insert into public.product_images(id,product_id,url,position) values
  ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','https://fixtures.stylai.test/c1.png',0),
  ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','https://fixtures.stylai.test/c2.png',0),
  ('64000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000003','https://fixtures.stylai.test/c3.png',0),
  ('64000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000004','https://fixtures.stylai.test/c4.png',0);
insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed) values
  ('64000000-0000-4000-8000-000000000001','test_fixture','synthetic',true),
  ('64000000-0000-4000-8000-000000000002','test_fixture','synthetic',true),
  ('64000000-0000-4000-8000-000000000003','test_fixture','synthetic',true),
  ('64000000-0000-4000-8000-000000000004','test_fixture','display only',false);
insert into private.photo_consents(user_id,policy_version) values ('60000000-0000-4000-8000-00000000000a','dev-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,body_angle,
    validation_status,validator_version,validation)
  values ('65000000-0000-4000-8000-00000000000a','60000000-0000-4000-8000-00000000000a','body_photo','ready','body-photos',
    '60000000-0000-4000-8000-00000000000a/front.png',10,'image/png',600,900,now()+interval '1 day','front','approved',
    'test+'||private.required_pose_rules(),'{"supports":{"upper":true,"lower":true,"dress":true}}');

set local role stylai_api;
do $$
declare a uuid := '60000000-0000-4000-8000-00000000000a';
declare b uuid := '60000000-0000-4000-8000-00000000000b';
declare top uuid := '62000000-0000-4000-8000-000000000001';
declare pants uuid := '62000000-0000-4000-8000-000000000002';
declare dress uuid := '62000000-0000-4000-8000-000000000003';
declare jacket uuid := '62000000-0000-4000-8000-000000000004';
declare comp uuid; declare job uuid; declare again uuid;
begin
  assert private.server_boundary_version()='20261124210000', 'boundary version';
  assert private.take_provider_call_slot('aliexpress',2) and private.take_provider_call_slot('aliexpress',2), 'slots within budget';
  assert not private.take_provider_call_slot('aliexpress',2), 'global call budget exceeded';
  assert private.take_provider_daily_slot('anthropic',1) and not private.take_provider_daily_slot('anthropic',1), 'daily ceiling';
  assert private.composition_quota_available(a), 'quota available for a new person';
  begin
    perform private.take_provider_call_slot('unknown',2);
    raise exception 'unknown provider accepted';
  exception when check_violation then null; end;
  comp := private.save_look_composition(a,'curated','rules_fallback',null,'{"slots":["upper","lower"]}');
  assert private.read_look_composition(a,comp)->>'selection_method'='rules_fallback', 'composition not durable';
  assert private.read_look_composition(b,comp) is null, 'foreign composition readable';

  -- Dress cannot be combined with a top; a piece without try-on image rights is refused (SA003).
  begin
    perform private.enqueue_composition_job(a,'k-dress',repeat('a',64),'dev-v1',
      jsonb_build_array(jsonb_build_object('slot','dress','product_id',dress),jsonb_build_object('slot','upper','product_id',top)),null,comp);
    raise exception 'dress + top accepted';
  exception when check_violation then null; end;
  begin
    perform private.enqueue_composition_job(a,'k-jacket',repeat('b',64),'dev-v1',
      jsonb_build_array(jsonb_build_object('slot','upper','product_id',top),jsonb_build_object('slot','outer','product_id',jacket)),null,comp);
    raise exception 'display-only piece accepted for generation';
  exception when sqlstate 'SA003' then null; end;
  begin
    perform private.enqueue_composition_job(a,'k-slot',repeat('c',64),'dev-v1',
      jsonb_build_array(jsonb_build_object('slot','lower','product_id',top)),null,comp);
    raise exception 'piece in wrong slot accepted';
  exception when check_violation then null; end;
  begin
    perform private.enqueue_composition_job(b,'k-foreign',repeat('d',64),'dev-v1',
      jsonb_build_array(jsonb_build_object('slot','upper','product_id',top)),null,comp);
    raise exception 'foreign composition accepted';
  exception when insufficient_privilege then null; end;

  -- Top + pants: ordered base first, primary = pants; idempotent by key; one daily unit.
  job := private.enqueue_composition_job(a,'k-ok',repeat('e',64),'dev-v1',
    jsonb_build_array(jsonb_build_object('slot','upper','product_id',top),jsonb_build_object('slot','lower','product_id',pants)),null,comp);
  again := private.enqueue_composition_job(a,'k-ok',repeat('e',64),'dev-v1',
    jsonb_build_array(jsonb_build_object('slot','upper','product_id',top),jsonb_build_object('slot','lower','product_id',pants)),null,comp);
  assert again=job, 'composition enqueue not idempotent';
  begin
    perform private.enqueue_composition_job(a,'k-ok',repeat('f',64),'dev-v1',
      jsonb_build_array(jsonb_build_object('slot','upper','product_id',top)),null,comp);
    raise exception 'request key reuse with other pieces accepted';
  exception when unique_violation then null; end;
  perform set_config('test.job', job::text, true);
end $$;

reset role;
do $$
declare job uuid := current_setting('test.job')::uuid;
begin
  assert (select requested_product_id from private.ai_jobs where id=job)='62000000-0000-4000-8000-000000000002', 'primary must be the base layer';
  assert (select array_agg(slot order by position) from private.ai_job_items where job_id=job)=array['lower','upper'], 'render order';
  assert (select reserved from private.ai_daily_usage where user_id='60000000-0000-4000-8000-00000000000a')=1, 'one daily unit per composition';
end $$;

set local role stylai_ai_worker;
do $$
declare job uuid := current_setting('test.job')::uuid;
declare fence bigint; declare r jsonb;
begin
  fence := private.claim_ai_job(job);
  r := private.load_ai_job(job,fence);
  assert jsonb_array_length(r->'items')=2 and r->'items'->0->>'slot'='lower' and r->'items'->1->>'image_url' is not null, 'items not loaded';
  assert r->>'composition_id' is not null, 'composition not linked';
  assert private.record_job_item_snapshot(job,fence,1::smallint,'{"name":"Calça"}'), 'snapshot 1';
  assert private.record_job_item_snapshot(job,fence,1::smallint,'{"name":"Calça"}'), 'snapshot idempotent';
  begin
    perform private.record_job_item_snapshot(job,fence,1::smallint,'{"name":"Outra"}');
    raise exception 'changed snapshot accepted';
  exception when sqlstate 'SA004' then null; end;
  perform set_config('test.fence', fence::text, true);
end $$;

-- Rights revoked after selection: the worker gate fails closed before any dispatch.
reset role;
update private.catalog_image_rights set try_on_allowed=false where image_id='64000000-0000-4000-8000-000000000001';
set local role stylai_ai_worker;
do $$
begin
  perform private.record_job_item_snapshot(current_setting('test.job')::uuid,current_setting('test.fence')::bigint,2::smallint,'{"name":"Blusa"}');
  raise exception 'revoked rights accepted';
exception when sqlstate 'SA003' then null; end $$;

-- Version creation freezes recorded pieces.
reset role;
update private.catalog_image_rights set try_on_allowed=true where image_id='64000000-0000-4000-8000-000000000001';
set local role stylai_ai_worker;
do $$
declare job uuid := current_setting('test.job')::uuid;
declare fence bigint := current_setting('test.fence')::bigint;
declare asset uuid; declare version uuid;
begin
  assert private.record_job_item_snapshot(job,fence,2::smallint,'{"name":"Blusa"}'), 'snapshot 2';
  perform private.record_ai_selection(job,fence,'62000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000002','{"items":2}');
  asset := private.register_generated_asset(job,fence,'60000000-0000-4000-8000-00000000000a/'||job||'/look.png',10,'image/png',864,1296);
  version := private.complete_look_job(job,fence,asset);
  assert version is not null, 'version not created';
  perform set_config('test.version', version::text, true);
end $$;
set local role stylai_api;
do $$
declare r jsonb := private.list_look_version_items('60000000-0000-4000-8000-00000000000a',current_setting('test.version')::uuid);
begin
  assert jsonb_array_length(r)=2 and r->0->>'slot'='lower' and r->1->'snapshot'->>'name'='Blusa', 'version items not frozen';
  assert jsonb_array_length(private.list_look_version_items('60000000-0000-4000-8000-00000000000b',current_setting('test.version')::uuid))=0, 'foreign items readable';
end $$;

rollback;
