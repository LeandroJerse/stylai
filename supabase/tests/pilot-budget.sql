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
  ('global','*','day',100000000),('global','*','month',100000000),
  ('provider','segmind','day',100000000),('provider','segmind','month',100000000),
  ('provider','fal','day',100000000),('provider','fal','month',100000000),
  ('user','*','day',100000000),('job','*','job',100000000);

insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
values ('test-real-pilot','segmind','try-on-diffusion','real',2000000,5,'11000000-0000-4000-8000-0000000000a1','curated','stylai-pilot','test authorization',now()-interval '1 day');

-- Prepares one generation call for a fresh job: enqueue (API), claim + select + reserve (worker).
create function pg_temp.prep_for(p_user uuid,p_product uuid,p_variant uuid,p_key text,p_provider text,p_model text,p_price_version text,p_reserve bigint default 500000,out job uuid,out fence bigint,out call uuid)
language plpgsql as $$ begin
  job := private.enqueue_look_job(p_user,p_key,md5(p_key)||md5(p_key),'test-v1',p_product,p_variant,null);
  fence := private.claim_ai_job(job);
  perform private.record_ai_selection(job,fence,p_product,p_variant,'{"name":"x"}');
  call := private.reserve_provider_call(job,fence,p_provider,p_model,p_price_version,'generation','gen_'||p_key,p_reserve,'u_0123456789abcdef','development');
end $$;
create function pg_temp.prep(p_user uuid,p_product uuid,p_variant uuid,p_key text,p_reserve bigint default 500000,out job uuid,out fence bigint,out call uuid)
language plpgsql as $$ begin
  select t.job, t.fence, t.call into job, fence, call
  from pg_temp.prep_for(p_user,p_product,p_variant,p_key,'segmind','try-on-diffusion','segmind-2026-11-20',p_reserve) t;
end $$;
-- Ends the job without touching its provider call (a crash/timeout after dispatch leaves the call as is).
create function pg_temp.drop_job(p_job uuid,p_fence bigint) returns void language plpgsql as $$ begin
  perform private.fail_look_job(p_job,p_fence,'test_end');
end $$;
create function pg_temp.reserve(p_call uuid,p_fence bigint,p_mode text default 'real',p_pilot text default 'test-real-pilot') returns jsonb language sql as $$
  select private.reserve_pilot_dispatch(p_pilot,p_call,p_fence,p_mode,'{"num_inference_steps":25}'::jsonb) $$;
create temporary table keep(k text primary key, v text) on commit drop;

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

  -- In-flight block: while c1 is still reserved (never dispatched), a second job is refused and released.
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','inflight-1');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'ok'='false' and res->>'reason'='in_flight', 'in-flight not blocked: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Operator releases the proven-unsent reservation c1: now attempts_used=0 and reserved=0.
  assert private.release_unsent_pilot_call('test-real-pilot',(select v::uuid from keep where k='c1'),'crash_before_send'), 'unsent call not released';
  st := private.pilot_status('test-real-pilot');
  assert (st->>'attempts_used')::int=0 and (st->>'reserved_usd_micros')::bigint=0 and (st->>'released_count')::int=1, 'released call still counted: '||st;

  -- Dispatch 1: timeout after send -> status=unknown pauses new dispatches (uncertain_outcome) and keeps reservation.
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','d1-unknown');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'ok'='true', 'd1 refused: '||res;
  assert private.begin_provider_call(r.call,r.fence), 'd1 begin failed';
  assert private.settle_provider_call(r.call,'unknown','req_d1','{}'::jsonb,'{}'::jsonb,500000,null,null,'unknown',12000,'provider_timeout'), 'd1 settle unknown failed';
  perform pg_temp.drop_job(r.job,r.fence);
  insert into keep values('d1',r.call::text);

  -- Dispatched/unknown call can NEVER be released as unsent.
  begin
    perform private.release_unsent_pilot_call('test-real-pilot',r.call,'bad_release');
    assert false, 'unknown call was released as unsent';
  exception when check_violation then null; end;

  -- Next dispatch is blocked by uncertain_outcome.
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','blocked-by-unknown');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'ok'='false' and res->>'reason'='uncertain_outcome', 'uncertain outcome did not pause: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Reconcile d1 as succeeded with 180000 micros (US$ 0.18): unblocks pilot and counts attempt 1.
  assert private.reconcile_provider_call((select v::uuid from keep where k='d1'),'succeeded',180000,'computed_from_usage','{"inference_time":25}'::jsonb), 'reconcile failed';
  assert private.mark_pilot_dispatch_usable('test-real-pilot',(select v::uuid from keep where k='d1'),true,'good output'), 'mark usable failed';
  st := private.pilot_status('test-real-pilot');
  assert (st->>'attempts_used')::int=1 and (st->>'spent_usd_micros')::bigint=180000 and (st->>'reserved_usd_micros')::bigint=0 and (st->>'usable_count')::int=1, 'post-reconcile status wrong: '||st;

  -- Dispatch 2: failed WITH cost (90000 micros) still counts as attempt 2 and spends 90000.
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','d2-fail-cost');
  assert (pg_temp.reserve(r.call,r.fence)->>'ok')='true';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'failed','req_d2','{"gpu_seconds":12.5}'::jsonb,'{}'::jsonb,500000,90000,null,'computed_from_usage',12500,'provider_failed');
  perform pg_temp.drop_job(r.job,r.fence);

  -- Dispatch 3: rejected_before_run (cost 0) still counts as attempt 3 (it reached dispatch).
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','d3-rejected');
  assert (pg_temp.reserve(r.call,r.fence)->>'ok')='true';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'failed',null,'{}'::jsonb,'{}'::jsonb,500000,0,null,'rejected_before_run',300,'provider_rejected_400');
  perform pg_temp.drop_job(r.job,r.fence);

  -- Dispatches 4 and 5 succeed (100000 each).
  for i in 4..5 loop
    r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','d'||i||'-ok');
    assert (pg_temp.reserve(r.call,r.fence)->>'ok')='true';
    assert private.begin_provider_call(r.call,r.fence);
    assert private.settle_provider_call(r.call,'succeeded','req_d'||i,'{"gpu_seconds":14}'::jsonb,'{}'::jsonb,500000,100000,null,'computed_from_usage',14000,null);
    perform pg_temp.drop_job(r.job,r.fence);
  end loop;

  -- Simulate day change on all prior provider_calls: the 6th attempt MUST STILL be blocked!
  update private.provider_calls set budget_day = budget_day - 3, created_at = created_at - interval '3 days';
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','d6-blocked');
  res := pg_temp.reserve(r.call,r.fence);
  assert res->>'ok'='false' and res->>'reason'='max_attempts_reached', '6th attempt not blocked after day change: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Money ceiling test on a 1,000,000 micros (US$ 1.00) pilot: 2 x 400k OK, 3rd with 500k reserve blocked (800k+500k > 1M).
  insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
  values ('test-1m-pilot','segmind','try-on-diffusion','real',1000000,5,'11000000-0000-4000-8000-0000000000a1','curated','stylai-pilot','1M ceiling test',now()-interval '1 day');
  for i in 1..2 loop
    r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','money-'||i,400000);
    assert (pg_temp.reserve(r.call,r.fence,'real','test-1m-pilot')->>'ok')='true';
    assert private.begin_provider_call(r.call,r.fence);
    assert private.settle_provider_call(r.call,'succeeded','req_m'||i,'{}'::jsonb,'{}'::jsonb,400000,400000,null,'computed_from_usage',10000,null);
    perform pg_temp.drop_job(r.job,r.fence);
  end loop;
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','m3-over',500000);
  res := pg_temp.reserve(r.call,r.fence,'real','test-1m-pilot');
  assert res->>'ok'='false' and res->>'reason'='budget_exhausted', 'money ceiling did not block: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Operator pause blocks immediately even when attempts and budget remain.
  insert into private.ai_pilots(id,provider,model,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
  values ('test-pause-pilot','segmind','try-on-diffusion','real',2000000,5,'11000000-0000-4000-8000-0000000000a1','curated','stylai-pilot','pause test',now()-interval '1 day');
  assert private.pause_pilot('test-pause-pilot','manual stop');
  r := pg_temp.prep('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','paused-1');
  res := pg_temp.reserve(r.call,r.fence,'real','test-pause-pilot');
  assert res->>'ok'='false' and res->>'reason'='pilot_paused', 'paused pilot accepted dispatch: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Shared TOTAL budget across ALL providers (Segmind + fal FASHN + fal ImageApps):
  -- switching provider NEVER resets counters, and unknown on one provider blocks all others.
  insert into private.ai_pilots(id,provider,model,allowed_targets,mode,limit_usd_micros,max_attempts,allowed_user_id,allowed_source,allowed_seller,authorization_note,active_since)
  values (
    'test-shared-pilot','any','multi-provider-tryon',
    '[
      {"provider":"segmind","model":"try-on-diffusion"},
      {"provider":"fal","model":"fal-ai/fashn/tryon/v1.6"},
      {"provider":"fal","model":"fal-ai/image-apps-v2/virtual-try-on"}
    ]'::jsonb,
    'real',2000000,5,'11000000-0000-4000-8000-0000000000a1','curated','stylai-pilot','shared budget test',now()-interval '1 day'
  );

  -- Unlisted fal model is refused and its reservation released.
  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-bad-model','fal','fal-ai/other','v1',75000);
  res := pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot');
  assert res->>'ok'='false' and res->>'reason'='provider_mismatch', 'unlisted model accepted: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Attempt 1 (Segmind, US$ 0.10) + Attempt 2 (fal FASHN, US$ 0.075) + Attempt 3 (fal ImageApps, US$ 0.040).
  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-1-seg','segmind','try-on-diffusion','segmind-2026-11-20',500000);
  assert (pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot')->>'attempt_no')='1';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'succeeded','req_sh1','{"gpu_seconds":13.8}'::jsonb,'{}'::jsonb,500000,100000,null,'computed_from_usage',14000,null);
  perform pg_temp.drop_job(r.job,r.fence);

  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-2-fashn','fal','fal-ai/fashn/tryon/v1.6','fal-fashn-tryon-v1.6-2026-11-21',75000);
  assert (pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot')->>'attempt_no')='2';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'succeeded','req_sh2','{"images":1}'::jsonb,'{}'::jsonb,75000,75000,null,'computed_from_usage',9000,null);
  perform pg_temp.drop_job(r.job,r.fence);

  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-3-imgapps','fal','fal-ai/image-apps-v2/virtual-try-on','fal-image-apps-v2-vton-2026-11-21',40000);
  assert (pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot')->>'attempt_no')='3';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'succeeded','req_sh3','{"images":1}'::jsonb,'{}'::jsonb,40000,40000,null,'computed_from_usage',7000,null);
  perform pg_temp.drop_job(r.job,r.fence);

  st := private.pilot_status('test-shared-pilot');
  assert (st->>'attempts_used')::int=3 and (st->>'spent_usd_micros')::bigint=215000 and jsonb_array_length(st->'by_provider')=3, 'shared totals wrong: '||st;

  -- Attempt 4 (fal FASHN) ends unknown -> blocks BOTH Segmind and fal ImageApps until reconciled.
  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-4-unknown','fal','fal-ai/fashn/tryon/v1.6','fal-fashn-tryon-v1.6-2026-11-21',75000);
  assert (pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot')->>'attempt_no')='4';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'unknown','req_sh4','{}'::jsonb,'{}'::jsonb,75000,null,null,'unknown',240000,'provider_timeout');
  perform pg_temp.drop_job(r.job,r.fence);
  insert into keep values('sh4',r.call::text);

  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-blk-seg','segmind','try-on-diffusion','segmind-2026-11-20',500000);
  res := pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot');
  assert res->>'ok'='false' and res->>'reason'='uncertain_outcome', 'unknown fal did not block segmind: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-blk-imgapps','fal','fal-ai/image-apps-v2/virtual-try-on','fal-image-apps-v2-vton-2026-11-21',40000);
  res := pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot');
  assert res->>'ok'='false' and res->>'reason'='uncertain_outcome', 'unknown fal did not block image-apps: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  -- Reconcile sh4 (US$ 0.075), execute attempt 5 (fal ImageApps, US$ 0.040), then 6th on ANY provider is blocked even after day change!
  assert private.reconcile_provider_call((select v::uuid from keep where k='sh4'),'succeeded',75000,'computed_from_usage','{"images":1}'::jsonb), 'reconcile sh4 failed';
  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-5-imgapps','fal','fal-ai/image-apps-v2/virtual-try-on','fal-image-apps-v2-vton-2026-11-21',40000);
  assert (pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot')->>'attempt_no')='5';
  assert private.begin_provider_call(r.call,r.fence);
  assert private.settle_provider_call(r.call,'succeeded','req_sh5','{"images":1}'::jsonb,'{}'::jsonb,40000,40000,null,'computed_from_usage',6000,null);
  perform pg_temp.drop_job(r.job,r.fence);

  update private.provider_calls set budget_day = budget_day - 5, created_at = created_at - interval '5 days';
  r := pg_temp.prep_for('11000000-0000-4000-8000-0000000000a1','61000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','sh-6-blocked','fal','fal-ai/fashn/tryon/v1.6','fal-fashn-tryon-v1.6-2026-11-21',75000);
  res := pg_temp.reserve(r.call,r.fence,'real','test-shared-pilot');
  assert res->>'ok'='false' and res->>'reason'='max_attempts_reached', '6th shared attempt not blocked: '||res;
  perform pg_temp.drop_job(r.job,r.fence);

  st := private.pilot_status('test-shared-pilot');
  assert (st->>'attempts_used')::int=5 and (st->>'spent_usd_micros')::bigint=330000 and (st->>'blocked_reason')='max_attempts_reached', 'final shared status wrong: '||st;

  raise notice 'Pilot budget assertions passed.';
end $$;

rollback;
