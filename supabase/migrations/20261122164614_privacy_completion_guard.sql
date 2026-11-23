-- Restricted operator completion for pilot accounts without commercial/provider history.
-- External erasure and recovery journal must be verified by the operator workflow first.
begin;
-- Recovery-only identifiers, separate from the minimized completion receipt.
create table private.deletion_tombstones (
 user_id uuid primary key, requested_at timestamptz not null default now(), completed_at timestamptz
);
alter table private.deletion_tombstones enable row level security;
revoke all on private.deletion_tombstones from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;
create function private.record_deletion_tombstone() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 insert into private.deletion_tombstones(user_id,requested_at) values(new.user_id,new.requested_at) on conflict(user_id) do nothing;
 return new;
end $$;
revoke all on function private.record_deletion_tombstone() from public,anon,authenticated,service_role;
create trigger deletion_recovery_record after insert on private.deletion_requests
 for each row execute function private.record_deletion_tombstone();
insert into private.deletion_tombstones(user_id,requested_at)
 select user_id,requested_at from private.deletion_requests where user_id is not null on conflict(user_id) do nothing;
alter table private.deletion_requests add column recovery_journal_sha256 text
 check (recovery_journal_sha256 is null or recovery_journal_sha256 ~ '^[a-f0-9]{64}$');
create function private.complete_pilot_account_deletion(p_request uuid,p_journal_sha256 text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r private.deletion_requests%rowtype;
begin
 if p_journal_sha256 is null or p_journal_sha256 !~ '^[a-f0-9]{64}$' then
   raise exception 'verified recovery journal required' using errcode='23514';
 end if;
 select * into r from private.deletion_requests where id=p_request for update;
 if not found then raise exception 'request unavailable' using errcode='23514'; end if;
 if r.state='done' then return true; end if;
 perform 1 from public.profiles where id=r.user_id and deletion_state='deleting' for update;
 if not found then raise exception 'account not deleting' using errcode='23514'; end if;
 if exists(select 1 from private.assets where user_id=r.user_id and (state<>'deleted' or deleted_at is null))
 or exists(select 1 from storage.objects o join private.assets a on a.bucket_id=o.bucket_id and a.object_key=o.name where a.user_id=r.user_id)
 then raise exception 'media purge incomplete' using errcode='23514'; end if;
 -- Commercial records and provider-side data require a separately reviewed retention/erasure path.
 if exists(select 1 from private.provider_calls where user_id=r.user_id)
 or exists(select 1 from private.orders where user_id=r.user_id)
 or exists(select 1 from private.quotes where user_id=r.user_id)
 or exists(select 1 from private.ai_pilots where allowed_user_id=r.user_id)
 then raise exception 'external or commercial review required' using errcode='23514'; end if;
 if exists(select 1 from private.ai_jobs where user_id=r.user_id and status in ('queued','running'))
 then raise exception 'processing still active' using errcode='23514'; end if;
 -- Remove identity-linked operational audit records; receipt retains only request id/times/hash.
 delete from private.audit_events where actor_id=r.user_id or resource_id=r.user_id;
 delete from auth.users where id=r.user_id;
 if not found then raise exception 'identity unavailable' using errcode='23514'; end if;
 update private.deletion_requests set state='done',finished_at=clock_timestamp(),recovery_journal_sha256=p_journal_sha256 where id=p_request;
 update private.deletion_tombstones set completed_at=clock_timestamp() where user_id=r.user_id;
 return true;
end $$;
revoke all on function private.complete_pilot_account_deletion(uuid,text) from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker,stylai_payments,stylai_procurement;
commit;
