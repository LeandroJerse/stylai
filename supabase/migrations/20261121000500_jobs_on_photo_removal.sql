-- QA-002 (found while testing): claim_ai_job refuses a job whose photo is no longer 'ready', so a queued job
-- whose photo was removed/replaced stayed queued forever: it held the user's only active slot and the daily
-- reservation, and next_ai_job kept returning it. When a body photo stops being usable, its queued jobs (or
-- running jobs whose lease expired) now fail with 'photo_removed' and release the reservation. Jobs being
-- processed right now are stopped by the worker itself (load_ai_job.photo.usable).
begin;

create function private.fail_jobs_of_unusable_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  if new.kind<>'body_photo' or old.state<>'ready' or new.state='ready' then return new; end if;
  for j in
    update private.ai_jobs set status='failed',failure_code='photo_removed',fence=fence+1,lease_until=null,finished_at=clock_timestamp()
    where photo_id=new.id and (status='queued' or (status='running' and lease_until<=clock_timestamp()))
    returning user_id,usage_date
  loop
    update private.ai_daily_usage set reserved=greatest(reserved-1,0) where user_id=j.user_id and usage_date=j.usage_date;
  end loop;
  return new;
end $$;

create trigger assets_fail_jobs_of_unusable_photo after update of state on private.assets
  for each row execute function private.fail_jobs_of_unusable_photo();

revoke all on function private.fail_jobs_of_unusable_photo() from public,anon,authenticated,service_role;

commit;
