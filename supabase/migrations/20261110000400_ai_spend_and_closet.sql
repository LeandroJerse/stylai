begin;

-- One unit is one millionth of a BRL. Provider currency and the FX evidence used
-- for conversion belong in the later adapter's sanitized reconciliation evidence.
create table private.ai_spend_budgets (
  scope text not null check (scope in ('daily','monthly')),
  period_start date not null,
  limit_micros bigint not null check (limit_micros between 1 and 1000000000000000),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  paused boolean not null default false,
  primary key(scope,period_start),
  check (scope <> 'monthly' or extract(day from period_start)=1)
);

create table private.ai_attempts (
  id uuid primary key default gen_random_uuid(),
  -- Keep minimized reconciliation records through user deletion.
  job_id uuid references private.ai_jobs(id) on delete set null,
  stage text not null check (stage in ('search','generation')),
  attempt_key text not null check (length(attempt_key) between 1 and 128),
  reserved_micros bigint not null check (reserved_micros between 1 and 1000000000000000),
  actual_micros bigint check (actual_micros between 0 and 1000000000000000),
  dispatched_at timestamptz,
  day date not null,
  month date not null,
  created_at timestamptz not null default now(),
  unique(job_id,stage,attempt_key)
);
alter table private.ai_spend_budgets enable row level security;
alter table private.ai_attempts enable row level security;
create unique index ai_attempts_one_unsettled_stage on private.ai_attempts(job_id,stage) where actual_micros is null;
revoke all on private.ai_spend_budgets,private.ai_attempts from public,anon,authenticated,service_role;
grant select on private.ai_spend_budgets,private.ai_attempts to service_role;

create function private.reserve_ai_attempt(p_job uuid,p_fence bigint,p_stage text,p_key text,p_micros bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare day date := (statement_timestamp() at time zone 'UTC')::date;
declare month date := date_trunc('month', day::timestamp)::date;
declare previous private.ai_attempts%rowtype;
declare attempt uuid;
declare owner_id uuid;
begin
  if p_micros is null or p_micros not between 1 and 1000000000000000 then
    raise exception 'invalid spend ceiling' using errcode='23514';
  end if;
  select user_id into owner_id from private.ai_jobs where id=p_job;
  perform 1 from public.profiles where id=owner_id and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  perform 1 from private.ai_jobs j where j.id=p_job and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp()
    and exists(select 1 from private.assets a where a.id=j.photo_id and a.state='ready' and a.expires_at>clock_timestamp())
    and exists(select 1 from private.photo_consents c where c.id=j.consent_id and c.revoked_at is null) for update;
  if not found then raise exception 'job lease or input unavailable' using errcode='42501'; end if;
  select * into previous from private.ai_attempts where job_id=p_job and stage=p_stage and attempt_key=p_key;
  if found then
    if previous.reserved_micros <> p_micros then raise exception 'attempt ceiling conflict' using errcode='23505'; end if;
    return previous.id;
  end if;
  if p_stage='generation' and not exists(select 1 from private.ai_job_selection where job_id=p_job) then
    raise exception 'verified catalog selection required' using errcode='23514';
  end if;
  -- Match settlement lock order. A monthly rejection rolls the daily increment back.
  update private.ai_spend_budgets set reserved_micros=reserved_micros+p_micros where scope='daily' and period_start=day
    and not paused and p_micros<=limit_micros-spent_micros-reserved_micros;
  if not found then raise exception 'daily provider budget unavailable' using errcode='23514'; end if;
  update private.ai_spend_budgets set reserved_micros=reserved_micros+p_micros where scope='monthly' and period_start=month
    and not paused and p_micros<=limit_micros-spent_micros-reserved_micros;
  if not found then raise exception 'monthly provider budget unavailable' using errcode='23514'; end if;
  insert into private.ai_attempts(job_id,stage,attempt_key,reserved_micros,day,month)
    values(p_job,p_stage,p_key,p_micros,day,month) returning id into attempt;
  return attempt;
end $$;

-- Commit this claim before sending the provider request. Reclaimed workers
-- reconcile dispatched attempts instead of treating the reservation as permission.
create function private.begin_ai_attempt(p_attempt uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare attempt private.ai_attempts%rowtype;
declare owner_id uuid;
begin
  select j.user_id into owner_id from private.ai_jobs j join private.ai_attempts a on a.job_id=j.id where a.id=p_attempt;
  perform 1 from public.profiles where id=owner_id and deletion_state='active' for update;
  if not found then return false; end if;
  select j.* into job from private.ai_jobs j join private.ai_attempts a on a.job_id=j.id
    where a.id=p_attempt and j.status='running' and j.fence=p_fence and j.lease_until>clock_timestamp() for update of j;
  if not found then return false; end if;
  perform 1 from private.photo_consents where id=job.consent_id and revoked_at is null for share;
  if not found then return false; end if;
  perform 1 from private.assets where id=job.photo_id and state='ready' and expires_at>clock_timestamp() for share;
  if not found then return false; end if;
  select * into attempt from private.ai_attempts where id=p_attempt for update;
  if not found or attempt.dispatched_at is not null or attempt.actual_micros is not null
     or attempt.day<>(clock_timestamp() at time zone 'UTC')::date then return false; end if;
  if attempt.stage='generation' then
    perform 1 from private.ai_job_selection s join public.products p on p.id=s.product_id
      join public.product_variants v on v.id=s.variant_id and v.product_id=p.id
      where s.job_id=job.id and p.category_id=job.category_id and p.published and p.rights_cleared and v.available is true
      for share of p,v;
    if not found then return false; end if;
  end if;
  perform 1 from private.ai_spend_budgets where scope='daily' and period_start=attempt.day
    and not paused and reserved_micros<=limit_micros-spent_micros for share;
  if not found then return false; end if;
  perform 1 from private.ai_spend_budgets where scope='monthly' and period_start=attempt.month
    and not paused and reserved_micros<=limit_micros-spent_micros for share;
  if not found then return false; end if;
  update private.ai_attempts set dispatched_at=clock_timestamp() where id=p_attempt;
  return true;
end $$;

-- Unknown attempts remain reserved until reconciled with provider evidence.
create function private.settle_ai_attempt(p_attempt uuid,p_actual bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare attempt private.ai_attempts%rowtype;
begin
  if p_actual is null or p_actual not between 0 and 1000000000000000 then
    raise exception 'invalid actual spend' using errcode='23514';
  end if;
  select * into attempt from private.ai_attempts where id=p_attempt for update;
  if not found then return false; end if;
  if attempt.dispatched_at is null and p_actual<>0 then raise exception 'attempt was not dispatched' using errcode='23514'; end if;
  if attempt.actual_micros is not null then
    if attempt.actual_micros <> p_actual then raise exception 'attempt already reconciled' using errcode='23505'; end if;
    return false;
  end if;
  update private.ai_spend_budgets set reserved_micros=reserved_micros-attempt.reserved_micros,spent_micros=spent_micros+p_actual
    where scope='daily' and period_start=attempt.day;
  if not found then raise exception 'daily budget missing' using errcode='23514'; end if;
  update private.ai_spend_budgets set reserved_micros=reserved_micros-attempt.reserved_micros,spent_micros=spent_micros+p_actual
    where scope='monthly' and period_start=attempt.month;
  if not found then raise exception 'monthly budget missing' using errcode='23514'; end if;
  update private.ai_attempts set actual_micros=p_actual where id=p_attempt;
  return true;
end $$;

create function private.record_ai_selection(p_job uuid,p_fence bigint,p_product uuid,p_variant uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare job private.ai_jobs%rowtype;
declare owner_id uuid;
begin
  select user_id into owner_id from private.ai_jobs where id=p_job;
  perform 1 from public.profiles where id=owner_id and deletion_state='active' for update;
  if not found then return false; end if;
  select * into job from private.ai_jobs where id=p_job and status='running' and fence=p_fence and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if job.requested_variant_id is not null and (p_product,p_variant) is distinct from (job.requested_product_id,job.requested_variant_id) then
    raise exception 'requested variant cannot be substituted' using errcode='23514';
  end if;
  if not exists(select 1 from public.products p join public.product_variants v on v.product_id=p.id
    where p.id=p_product and v.id=p_variant and p.category_id=job.category_id and p.published and p.rights_cleared and v.available is true) then
    raise exception 'catalog variant unavailable' using errcode='23514';
  end if;
  insert into private.ai_job_selection(job_id,product_id,variant_id,search_snapshot) values(p_job,p_product,p_variant,p_snapshot)
    on conflict(job_id) do nothing;
  if found then return true; end if;
  if not exists(select 1 from private.ai_job_selection where job_id=p_job
    and (product_id,variant_id,search_snapshot) is not distinct from (p_product,p_variant,p_snapshot)) then
    raise exception 'job selection already recorded' using errcode='23505';
  end if;
  return false;
end $$;

create function private.save_ai_look(p_user uuid,p_job uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare output_id uuid;
declare look_id uuid;
declare selection private.ai_job_selection%rowtype;
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  select result_asset_id into output_id from private.ai_jobs where id=p_job and user_id=p_user and status='succeeded';
  if output_id is null then raise exception 'result unavailable' using errcode='42501'; end if;
  update private.assets set expires_at=null where id=output_id and user_id=p_user and kind='generated_look' and state='ready'
    and (expires_at is null or expires_at>clock_timestamp());
  if not found then raise exception 'output expired' using errcode='42501'; end if;
  select * into strict selection from private.ai_job_selection where job_id=p_job;
  insert into private.saved_looks(user_id,job_id,asset_id,snapshot)
    values(p_user,p_job,output_id,jsonb_build_object('product_id',selection.product_id,'variant_id',selection.variant_id))
    on conflict(user_id,asset_id) do nothing returning id into look_id;
  if look_id is null then select id into look_id from private.saved_looks where user_id=p_user and asset_id=output_id; end if;
  insert into private.saved_look_products(user_id,look_id,product_id) values(p_user,look_id,selection.product_id) on conflict do nothing;
  return look_id;
end $$;

create function private.set_favorite_product(p_user uuid,p_product uuid,p_saved boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  if p_saved then
    if not exists(select 1 from public.products where id=p_product and published and rights_cleared) then
      raise exception 'product unavailable' using errcode='42501';
    end if;
    insert into private.favorite_products(user_id,product_id) values(p_user,p_product) on conflict do nothing;
  else
    delete from private.favorite_products where user_id=p_user and product_id=p_product;
  end if;
end $$;

revoke all on function private.reserve_ai_attempt(uuid,bigint,text,text,bigint),private.begin_ai_attempt(uuid,bigint),private.settle_ai_attempt(uuid,bigint),
  private.record_ai_selection(uuid,bigint,uuid,uuid,jsonb),private.save_ai_look(uuid,uuid),private.set_favorite_product(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function private.reserve_ai_attempt(uuid,bigint,text,text,bigint),private.begin_ai_attempt(uuid,bigint),private.settle_ai_attempt(uuid,bigint),
  private.record_ai_selection(uuid,bigint,uuid,uuid,jsonb),private.save_ai_look(uuid,uuid),private.set_favorite_product(uuid,uuid,boolean)
  to service_role;

commit;
