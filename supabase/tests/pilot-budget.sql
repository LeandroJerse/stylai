-- Supervised real try-on pilot: one persistent ceiling (USD micros + attempts) over the existing
-- provider_calls ledger. Never renewed by day, restart or re-queue; one call in flight; an uncertain
-- outcome pauses new dispatches until reconciled; only the allowed account and the pilot catalog.
begin;

insert into auth.users(id) values ('11000000-0000-4000-8000-0000000000a1'),('11000000-0000-4000-8000-0000000000b2');
insert into private.photo_consents(user_id,policy_version) values
  ('11000000-0000-4000-8000-0000000000a1','test-v1'),('11000000-0000-4000-8000-0000000000b2','test-v1');
insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,validation_status,validator_version,validation,body_angle)
  select u,'body_photo','ready','body-photos',u||'/front.jpg',4096,'image/jpeg',800,1000,now()+interval '1 day','approved',
    'mp-test+'||private.required_pose_rules(),'{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb,'front'
  from unnest(array['11000000-0000-4000-8000-0000000000a1','11000000-0000-4000-8000-0000000000b2']::uuid[]) u;
insert into private.settings_versions(kind,scope,version,payload,effective_at,reason)
  values ('membership','pilot-test',1,'{"coins_per_day":120,"local_test":true}'::jsonb,now(),'pilot test') on conflict do nothing;
insert into private.ai_memberships(user_id,plan_version_id,environment,merchant_ref,provider_subscription_id,provider_payment_id,valid_from,valid_until)
  select u,(select id from private.settings_versions where kind='membership' and scope='pilot-test' and version=1),'sandbox','local-test',
    'pt-'||u,'pt-'||u||'-1',now()-interval '1 hour',now()+interval '1 day'
  from unnest(array['11000000-0000-4000-8000-0000000000a1','11000000-0000-4000-8000-0000000000b2']::uuid[]) u;
insert into public.categories(id,label) values ('tops','Tops') on conflict do nothing;
insert into public.partners(id,source,external_seller_id,region,name) values
  ('51000000-0000-4000-8000-000000000001','curated','stylai-pilot','BR','Catálogo piloto'),
  ('51000000-0000-4000-8000-000000000002','curated','fixture-other','BR','Outro catálogo');
insert into public.products(id,partner_id,external_product_id,category_id,name,price_minor,product_url,availability,published,rights_cleared) values
  ('61000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','pilot-1','tops','Peça piloto',null,null,'unknown',true,true),
  ('61000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','other-1','tops','Peça fora do piloto',null,null,'unknown',true,true);
insert into public.product_variants(id,product_id,external_variant_id,label,available) values
  ('71000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','v1','Peça fotografada',true),
  ('71000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','v1','Peça fotografada',true);
insert into public.product_images(product_id,url,position) values
  ('61000000-0000-4000-8000-000000000001','https://upload.example.org/pilot-1.jpg',0),
  ('61000000-0000-4000-8000-000000000002','https://upload.example.org/other-1.jpg',0);
insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed)
  select id,'licensed','CC0 test row',true from public.product_images where product_id in
    ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002');
-- Generous day/month ceilings: only the pilot ceiling is under test here.
delete from private.provider_budget_limits;
insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
  ('global','*','day',100000000),('global','*','month',100000000),('provider','segmind','day',100000000),('provider','segmind','month',100000000),
  ('user','*','day',100000000),('job','*','job',100000000);

insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
values ('test-real-pilot','segmind','try-on-diffusion','real',2000000,5,'11000000-0000-4000-8000-0000000000a1','curated','stylai-pilot','test authorization',now()-interval '1 day');

-- Prepares one generation call for a fresh job: enqueue (API), claim + select + reserve (worker).
create function pg_temp.prep(p_user uuid,p_product uuid,p_variant uuid,p_key text,p_reserve bigint default 500000,out job uuid,out fence bigint,out call uuid)
language plpgsql as $$ begin
  job := private.enqueue_look_job(p_user,p_key,md5(p_key)||md5(p_key),'test-v1',p_product,p_variant,null);
  fence := private.claim_ai_job(job);
  perform private.record_ai_selection(job,fence,p_product,p_variant,'{"name":"x"}');
  call := private.reserve_provider_call(job,fence,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen_'||p_key,p_reserve,'u_0123456789abcdef','development');
end $$;
-- Ends the job without touching its provider call (a crash/timeout after dispatch leaves the call as is).
create function pg_temp.drop_job(p_job uuid,p_fence bigint) returns void language plpgsql as $$ begin
  perform private.fail_look_job(p_job,p_fence,'test_end');
end $$;
create function pg_temp.reserve(p_call uuid,p_fence bigint,p_mode text default 'real',p_pilot text default 'test-real-pilot') returns jsonb language sql as $$
  select private.reserve_pilot_dispatch(p_pilot,p_call,p_fence,p_mode,'{"num_inference_steps":25}'::jsonb) $$;
create temporary table keep(k text primary key, v text) on commit drop;
-- TODO (next session): in-flight block, release of unsent call, timeout->unknown->uncertain_outcome,
-- reconcile, failed-with-cost, rejected_before_run counts, 6th attempt blocked after "day change",
-- money ceiling on a 1M pilot, operator pause. Then `rollback;`.

do $$ begin
  assert has_function_privilege('stylai_ai_worker','private.reserve_pilot_dispatch(text,uuid,bigint,text,jsonb)','EXECUTE'), 'worker cannot reserve pilot';
  assert has_function_privilege('stylai_ai_worker','private.pilot_status(text)','EXECUTE'), 'worker cannot read pilot status';
  assert not has_function_privilege('stylai_api','private.reserve_pilot_dispatch(text,uuid,bigint,text,jsonb)','EXECUTE'), 'API can reserve pilot';
  assert not has_function_privilege('authenticated','private.pilot_status(text)','EXECUTE'), 'browser can read pilot';
  assert not has_table_privilege('stylai_ai_worker','private.ai_pilots','UPDATE'), 'worker can edit the pilot ceiling';
end $$;

do $$ declare r record; res jsonb; c private.provider_calls%rowtype; st jsonb; begin
  -- Another account: refused and its reservation released (no money held, no attempt used).
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000b2','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','other-user-1');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'ok'='false' and res->>'reason'='user_not_allowed', 'other user accepted: '||res;
  select * into c from private.provider_calls where id=r.call;
  assert c.status='released' and c.settled_usd_micros=0, 'refused reservation not released';
  assert not private.begin_provider_call(r.call,r.fence), 'released call dispatched';
  perform pg_temp.drop_job(r.job,r.fence);

  -- Item outside the pilot catalog.
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','off-catalog-1');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'reason'='item_not_allowed', 'off-catalog item accepted: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- A simulated worker can never charge the real pilot.
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','mode-1');
  res := pg_temp.reserve(r.call,r.fence,'simulated');
  assert res->>'reason'='mode_mismatch', 'mode mismatch accepted: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Jobs queued before the pilot was activated are never paid for.
  update private.ai_pilots set active_since=now()+interval '1 minute' where id='test-real-pilot';
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','old-job-1');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'reason'='job_predates_pilot', 'pre-existing job accepted: '||res;
  perform pg_temp.drop_job(r.job,r.fence);
  update private.ai_pilots set active_since=now()-interval '1 day' where id='test-real-pilot';

  st := private.pilot_status('test-real-pilot');
  assert (st->>'attempts_used')::int=0 and (st->>'reserved_usd_micros')::bigint=0, 'refusals consumed the pilot: '||st;

  -- Attempt 1: accepted, idempotent for the same call (double click / re-queue of the same job).
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','ok-1');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'ok'='true' and (res->>'attempt_no')::int=1, 'first attempt refused: '||res;
  assert pg_temp.reserve(r.call,r.fence)->>'attempt_no'='1', 'same call counted twice';
  assert private.reserve_provider_call(r.job,r.fence,'segmind','try-on-diffusion','segmind-2026-11-20','generation','gen_ok-1',500000,'u_0123456789abcdef','development')=r.call, 're-queue created a new call';
  -- The worker crashes before sending: the reservation stays and blocks the next dispatch (one in flight).
  perform pg_temp.drop_job(r.job,r.fence);
  insert into keep values('c1',r.call::text);
end $$;

rollback;
