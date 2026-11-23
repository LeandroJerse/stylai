begin;
create table private.integration_blocks (
 provider text primary key check(provider='tiktok_shop'), blocked_at timestamptz not null default now()
);
alter table private.integration_blocks enable row level security;
revoke all on private.integration_blocks from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;
create function private.tiktok_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.integration_blocks where provider='tiktok_shop');
$$;
create function private.block_tiktok_access() returns void
language sql security definer set search_path='' as $$
 insert into private.integration_blocks(provider) values ('tiktok_shop') on conflict(provider) do nothing;
$$;
revoke all on function private.tiktok_access_allowed(),private.block_tiktok_access() from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker,stylai_payments,stylai_procurement;
grant execute on function private.tiktok_access_allowed() to stylai_api;
create function private.export_privacy_recovery_journal() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'exportedAt',statement_timestamp(),
 'accountIds',(select coalesce(jsonb_agg(user_id order by user_id),'[]'::jsonb) from private.deletion_tombstones),
 'tiktokBlocked',not private.tiktok_access_allowed());
$$;
revoke all on function private.export_privacy_recovery_journal() from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker,stylai_payments,stylai_procurement;
commit;
