-- P04: the whole layer chain must fit EVERY budget scope before layer 1 is dispatched (no paid layer 1 then a blocked layer 2).
begin;

insert into auth.users(id) values ('70000000-0000-4000-8000-00000000000a');
insert into public.categories(id,label) values ('tops','Blusas'),('pants','Calças') on conflict do nothing;
insert into public.partners(id,source,external_seller_id,region,name) values
  ('71000000-0000-4000-8000-000000000001','curated','stylai-pilot','BR','Catálogo piloto — peças reais');
insert into public.products(id,partner_id,external_product_id,category_id,name,price_minor,availability,published,rights_cleared,fixture) values
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','lb-top','tops','Blusa',null,'unknown',true,true,false),
  ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','lb-pants','pants','Calça',null,'unknown',true,true,false);
insert into public.product_variants(id,product_id,external_variant_id,label,available) values
  ('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','lv1','M',true),
  ('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','lv2','40',true);
insert into public.product_images(id,product_id,url,position) values
  ('74000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','https://upload.wikimedia.org/top.jpg',0),
  ('74000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','https://upload.wikimedia.org/pants.jpg',0);
insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed) values
  ('74000000-0000-4000-8000-000000000001','test_fixture','test',true),('74000000-0000-4000-8000-000000000002','test_fixture','test',true);
insert into private.photo_consents(user_id,policy_version) values ('70000000-0000-4000-8000-00000000000a','dev-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,body_angle,validation_status,validator_version,validation)
  values ('75000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-00000000000a','body_photo','ready','body-photos',
    '70000000-0000-4000-8000-00000000000a/front.png',10,'image/png',600,900,now()+interval '1 day','front','approved',
    'test+'||private.required_pose_rules(),'{"supports":{"upper":true,"lower":true,"dress":true}}');
-- Same shape as the local pilot: job US$0.60, daily US$1, pilot US$2 / 5 attempts.
delete from private.provider_budget_limits;
insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
  ('global','*','day',1000000),('global','*','month',5000000),('provider','segmind','day',1000000),('provider','segmind','month',5000000),
  ('user','*','day',1000000),('job','*','job',600000);
insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
  values ('layer-pilot','segmind','try-on-diffusion','real',2000000,5,'70000000-0000-4000-8000-00000000000a','curated','stylai-pilot','test',now()-interval '1 day'),
         ('layer-pilot-one','segmind','try-on-diffusion','real',2000000,1,'70000000-0000-4000-8000-00000000000a','curated','stylai-pilot','test',now()-interval '1 day');

set local role stylai_api;
do $$ begin
  perform set_config('test.job', private.enqueue_composition_job('70000000-0000-4000-8000-00000000000a','lb-key',repeat('a',64),'dev-v1',
    jsonb_build_array(jsonb_build_object('slot','upper','product_id','72000000-0000-4000-8000-000000000001'),
                      jsonb_build_object('slot','lower','product_id','72000000-0000-4000-8000-000000000002')),null,null)::text, true);
end $$;

set local role stylai_ai_worker;
do $$
declare job uuid := current_setting('test.job')::uuid;
declare fence bigint; declare r jsonb;
begin
  assert private.server_boundary_version()='20261124100000', 'boundary version';
  fence := private.claim_ai_job(job);
  -- 2 layers x US$0.50 = US$1.00 > job US$0.60: refused before any reservation, naming the limiting scope.
  r := private.check_layer_budget(job,fence,'segmind',2,500000,'layer-pilot');
  assert (r->>'ok')::boolean is false, 'chain over the job budget accepted';
  assert r->'limiting' ? 'job', 'job scope not reported as limiting';
  assert (r->>'needed_usd_micros')::bigint=1000000, 'needed amount';
  assert (r->>'max_layers')::int=1, 'effective ceiling in layers';
  -- 1 layer fits every scope.
  assert (private.check_layer_budget(job,fence,'segmind',1,500000,'layer-pilot')->>'ok')::boolean, 'single layer refused';
  -- 2 layers at US$0.25 fit the job (0.50 <= 0.60).
  assert (private.check_layer_budget(job,fence,'segmind',2,250000,'layer-pilot')->>'ok')::boolean, 'cheaper chain refused';
  -- Pilot attempts are counted per layer.
  r := private.check_layer_budget(job,fence,'segmind',2,10000,'layer-pilot-one');
  assert (r->'limiting') ? 'pilot_attempts' and (r->>'max_layers')::int=1, 'pilot attempts not enforced per layer';
  -- Wrong fence: no data.
  begin
    perform private.check_layer_budget(job,fence+1,'segmind',1,500000,'layer-pilot');
    raise exception 'foreign fence accepted';
  exception when insufficient_privilege then null; end;
end $$;

-- The check never reserves budget (read with the owner role: the worker role cannot read the ledger).
reset role;
do $$ begin
  assert not exists(select 1 from private.provider_calls where job_id=current_setting('test.job')::uuid), 'check must not reserve';
  assert not exists(select 1 from private.provider_budget_usage where scope='job' and scope_key=current_setting('test.job')), 'check must not touch usage';
end $$;

rollback;
