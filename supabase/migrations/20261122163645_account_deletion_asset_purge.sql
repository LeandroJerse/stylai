-- Account deletion must retire private media as well as sessions and consent.
begin;
create or replace function private.request_account_deletion(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
declare job_id uuid;
begin
  update public.profiles set deletion_state='deleting' where id=p_user;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  update private.app_sessions set revoked_at=clock_timestamp() where user_id=p_user and revoked_at is null;
  update private.photo_consents set revoked_at=clock_timestamp() where user_id=p_user and revoked_at is null;
  for job_id in select id from private.ai_jobs where user_id=p_user and status in ('queued','running') loop
    perform private.cancel_ai_job(p_user,job_id);
  end loop;
  -- Stop signed-media reads and enqueue physical removal; preserve retry/lease state.
  update private.assets set state='deleting'
    where user_id=p_user and state in ('processing','ready','rejected');
  insert into private.deletion_requests(user_id) values(p_user) on conflict (user_id) do nothing;
  select id into request_id from private.deletion_requests where user_id=p_user;
  return request_id;
end $$;
commit;

