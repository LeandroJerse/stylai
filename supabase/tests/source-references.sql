-- Multi-piece composition jobs (20261123210932), executed with the real restricted roles.
begin;
insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
 ('global','*','day',2000000),('global','*','month',5000000),('provider','segmind','day',2000000),
 ('provider','segmind','month',5000000),('user','*','day',2000000),('job','*','job',2000000)
 on conflict(scope,scope_key,period) do update set limit_usd_micros=excluded.limit_usd_micros;

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

-- Replace only this transaction's test SKU with an explicitly non-commercial image reference.
delete from public.product_variants where product_id='62000000-0000-4000-8000-000000000001';
update public.partners set source='aliexpress' where id='61000000-0000-4000-8000-000000000001';
insert into public.product_variants(id,product_id,external_variant_id,label,available,kind) values
 ('63000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000001','stylai:image-reference','Referência visual; tamanho não informado',null,'image_reference');
set local role stylai_api;
do $$
declare refs jsonb; declare job uuid;
begin
 begin
  perform private.enqueue_composition_job('60000000-0000-4000-8000-00000000000a','wrong-reference-test',repeat('b',64),'dev-v1',
  '[{"slot":"upper","product_id":"62000000-0000-4000-8000-000000000001","variant_id":"63000000-0000-4000-8000-000000000005","image_url":"https://fixtures.stylai.test/old.png"}]',null,null);
  raise exception 'changed composition image accepted';
 exception when sqlstate 'SA004' then null; end;
 refs := private.read_source_generation_references('aliexpress','[{"externalProductId":"c-top","imageUrl":"https://fixtures.stylai.test/c1.png"}]');
 assert jsonb_array_length(refs)=1, 'authorized exact image not resolved';
 assert refs->0->>'productId'='62000000-0000-4000-8000-000000000001', 'reference switched product';
 assert private.read_source_generation_references('aliexpress','[{"externalProductId":"c-top","imageUrl":"https://fixtures.stylai.test/changed.png"}]')='[]'::jsonb, 'changed image authorized';
 assert jsonb_array_length(private.read_catalog_product('62000000-0000-4000-8000-000000000001')->'variants')=0, 'reference exposed as SKU';
 job := private.enqueue_composition_job('60000000-0000-4000-8000-00000000000a','reference-test',repeat('a',64),'dev-v1',
 '[{"slot":"upper","product_id":"62000000-0000-4000-8000-000000000001","variant_id":"63000000-0000-4000-8000-000000000005","image_url":"https://fixtures.stylai.test/c1.png"}]',null,null);
 perform set_config('test.reference_job',job::text,true);
end $$;
set local role stylai_ai_worker;
do $$
declare job uuid := current_setting('test.reference_job')::uuid; declare fence bigint; declare loaded jsonb;
begin
 fence := private.claim_ai_job(job);
 assert fence is not null, 'job not claimed';
 perform set_config('test.reference_fence',fence::text,true);
 loaded := private.load_ai_job(job,fence);
 assert loaded->'items'->0->>'reference_kind'='image_reference', 'reference kind missing';
 assert loaded->'items'->0->>'external_variant_id' is null, 'invented supplier SKU';
 assert loaded->'items'->0->>'variant_available' is null, 'invented stock';
 assert private.record_job_item_snapshot(job,fence,1::smallint,'{"source":"aliexpress","reference_kind":"image_reference","garment_image_url":"https://fixtures.stylai.test/c1.png"}'), 'authorized snapshot refused';
 assert private.record_ai_selection(job,fence,'62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000005','{"reference_kind":"image_reference"}'), 'authorized selection refused';
 perform set_config('test.reference_call',private.reserve_provider_call(job,fence,'segmind','try-on-diffusion','test','generation','reference_layer_2',500000,'u_0000000000000000','test')::text,true);
end $$;
reset role;
set local role anon;
do $$ begin
 assert not exists(select 1 from public.product_variants where id='63000000-0000-4000-8000-000000000005'), 'public reference leaked as SKU';
end $$;
reset role;
update private.catalog_image_rights set try_on_allowed=false where image_id='64000000-0000-4000-8000-000000000001';
set local role stylai_api;
do $$ begin
 assert private.read_source_generation_references('aliexpress','[{"externalProductId":"c-top","imageUrl":"https://fixtures.stylai.test/c1.png"}]')='[]'::jsonb, 'revoked reference returned';
end $$;
set local role stylai_ai_worker;
do $$ begin
 begin
  perform private.begin_provider_call(current_setting('test.reference_call')::uuid,current_setting('test.reference_fence')::bigint);
  raise exception 'revoked layer dispatched';
 exception when sqlstate 'SA003' then null; end;
 begin
  perform private.record_job_item_snapshot(current_setting('test.reference_job')::uuid,current_setting('test.reference_fence')::bigint,1::smallint,'{"source":"aliexpress","reference_kind":"image_reference"}');
  raise exception 'revoked image accepted';
 exception when sqlstate 'SA003' then null; end;
end $$;
reset role;
update private.catalog_image_rights set try_on_allowed=true where image_id='64000000-0000-4000-8000-000000000001';
update public.product_images set url='https://fixtures.stylai.test/new.png' where id='64000000-0000-4000-8000-000000000001';
do $$ begin
 assert not (select try_on_allowed from private.catalog_image_rights where image_id='64000000-0000-4000-8000-000000000001'), 'URL mutation inherited image authorization';
end $$;
select 'Source image reference assertions passed';
-- A pilot must approve every piece, not only ai_job_selection's primary product.
insert into public.partners(id,source,external_seller_id,region,name) values
 ('61000000-0000-4000-8000-000000000002','aliexpress','other-seller','BR','Other seller');
update public.products set partner_id='61000000-0000-4000-8000-000000000002' where id='62000000-0000-4000-8000-000000000002';
insert into private.ai_job_items(job_id,position,slot,product_id,variant_id,category_id)
 values(current_setting('test.reference_job')::uuid,2,'lower','62000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000002','pants');
insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
 values('reference-pilot','segmind','try-on-diffusion','real',2000000,5,'60000000-0000-4000-8000-00000000000a','aliexpress','composition-seller','test',now()-interval '1 day');
set local role stylai_ai_worker;
do $$ declare call_id uuid; declare result jsonb; begin
 call_id := private.reserve_provider_call(current_setting('test.reference_job')::uuid,current_setting('test.reference_fence')::bigint,'segmind','try-on-diffusion','test','generation','reference_pilot_test',500000,'u_0000000000000000','test');
 result := private.reserve_pilot_dispatch('reference-pilot',call_id,current_setting('test.reference_fence')::bigint,'real','{"layer":2}');
 assert result->>'reason'='item_not_allowed', 'secondary seller bypassed pilot';
end $$;
reset role;
update private.ai_pilots set allowed_product_ids=array['62000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002']::uuid[] where id='reference-pilot';
set local role stylai_ai_worker;
do $$ declare call_id uuid; declare result jsonb; begin
 call_id := private.reserve_provider_call(current_setting('test.reference_job')::uuid,current_setting('test.reference_fence')::bigint,'segmind','try-on-diffusion','test','generation','reference_pilot_allowed',500000,'u_0000000000000000','test');
 result := private.reserve_pilot_dispatch('reference-pilot',call_id,current_setting('test.reference_fence')::bigint,'real','{"layer":2}');
 assert result->>'ok'='true', 'explicit approved products across sellers rejected';
end $$;
reset role;
rollback;
