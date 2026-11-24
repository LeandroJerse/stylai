-- A paid image whose answer we lost is delivered instead of paid twice. ADDITIVE: one function and one field in a list.
--   * only for a job that ended with an unknown outcome, whose single call the provider's history proves was charged;
--   * the person must still be active, the consent still given and the same photo still usable: otherwise nothing is kept;
--   * the coin of that job was already returned when it failed, and recovering does not take it again.
-- Rollback: drop recover_look_job, restore list_unreconciled_calls and server_boundary_version() 20261124220000.
begin;
create function private.recover_look_job(p_call uuid,p_object_key text,p_bytes integer,p_mime text,p_width integer,p_height integer,p_cost bigint,p_report jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c private.provider_calls%rowtype; declare job private.ai_jobs%rowtype; declare selection private.ai_job_selection%rowtype;
declare asset uuid; declare look uuid; declare next_version integer; declare version_id uuid;
begin
  if p_cost is null or p_cost<1 then raise exception 'a recovered image has a cost' using errcode='23514'; end if;
  select * into c from private.provider_calls where id=p_call;
  if not found or c.job_id is null then return null; end if;
  -- Global lock order: profile, job, call.
  perform 1 from public.profiles where id=(select user_id from private.ai_jobs where id=c.job_id) and deletion_state='active' for update;
  if not found then return null; end if;
  select * into job from private.ai_jobs where id=c.job_id and status='failed' and failure_code in ('provider_outcome_unknown','generation_needs_reconciliation') for update;
  if not found then return null; end if;
  select * into c from private.provider_calls where id=p_call and status in ('unknown','dispatched') for update;
  if not found or exists(select 1 from private.provider_calls o where o.job_id=job.id and o.id<>c.id and o.status not in ('released','failed')) then return null; end if;
  if exists(select 1 from private.look_versions where job_id=job.id) then return null; end if;
  perform 1 from private.photo_consents where id=job.consent_id and revoked_at is null for share;
  if not found then return null; end if;
  perform 1 from private.assets where id=job.photo_id and state='ready' and expires_at>clock_timestamp() for share;
  if not found then return null; end if;
  select * into selection from private.ai_job_selection where job_id=job.id;
  if not found then return null; end if;
  if p_object_key not like job.user_id::text||'/'||job.id::text||'/%' then raise exception 'object key outside job scope' using errcode='23514'; end if;
  if not private.reconcile_provider_call(p_call,'succeeded',p_cost,'provider_confirmed',p_report) then return null; end if;
  insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at)
    values(job.user_id,'generated_look','ready','generated-looks',p_object_key,p_bytes,p_mime,p_width,p_height,now()+interval '168 hours') returning id into asset;
  update private.ai_jobs set status='succeeded',failure_code=null,result_asset_id=asset,finished_at=clock_timestamp() where id=job.id;
  if job.parent_version_id is null then
    insert into private.looks(user_id) values(job.user_id) returning id into look;
  else
    select look_id into look from private.look_versions where id=job.parent_version_id and user_id=job.user_id;
    if look is null then raise exception 'parent version unavailable' using errcode='42501'; end if;
  end if;
  perform 1 from private.looks where id=look for update;
  select coalesce(max(version),0)+1 into next_version from private.look_versions where look_id=look;
  insert into private.look_versions(user_id,look_id,version,parent_version_id,job_id,asset_id,product_id,variant_id,selection_snapshot)
    values(job.user_id,look,next_version,job.parent_version_id,job.id,asset,selection.product_id,selection.variant_id,selection.search_snapshot) returning id into version_id;
  update private.provider_calls set look_version_id=version_id where job_id=job.id;
  return version_id;
end $$;

create or replace function private.list_unreconciled_calls(p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'job_id',c.job_id,'user_id',c.user_id,'provider',c.provider,'model',c.model,
    'attempt_key',c.attempt_key,'provider_request_id',c.provider_request_id,'status',c.status,'started_at',c.started_at,
    'finished_at',c.finished_at,'error_code',c.error_code,'environment',c.environment,
    'job_active',exists(select 1 from private.ai_jobs j where j.id=c.job_id and j.status in ('queued','running')),
    -- Requests already accounted for: one history row is never used for two calls.
    'taken',coalesce((select jsonb_agg(coalesce(o.provider_request_id,o.provider_report->>'request_id')) from private.provider_calls o where o.provider=c.provider and o.id<>c.id
      and coalesce(o.provider_request_id,o.provider_report->>'request_id') is not null and o.started_at between c.started_at-interval '15 minutes' and c.started_at+interval '15 minutes'),'[]'::jsonb),
    -- Another unidentified call of the same model around it: a row could belong to either.
    'rivals',(select count(*) from private.provider_calls o where o.provider=c.provider and o.model=c.model and o.id<>c.id and o.provider_request_id is null
      and o.status in ('dispatched','unknown') and o.started_at between c.started_at-interval '5 minutes' and c.started_at+interval '5 minutes'))),'[]'::jsonb)
  from (select * from private.provider_calls where status in ('dispatched','unknown')
    and started_at<clock_timestamp()-interval '30 seconds' order by created_at limit least(greatest(p_limit,1),100)) c;
$$;
create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261124230000'::text $$;
revoke all on function private.recover_look_job(uuid,text,integer,text,integer,integer,bigint,jsonb) from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;
grant execute on function private.recover_look_job(uuid,text,integer,text,integer,integer,bigint,jsonb) to stylai_ai_worker;
commit;
