begin;
do $$ begin
 assert private.tiktok_access_allowed(), 'fresh integration blocked';
 perform private.block_tiktok_access();
 assert not private.tiktok_access_allowed(), 'revocation not durable';
 assert not has_function_privilege('stylai_api','private.block_tiktok_access()','EXECUTE'), 'public API can revoke global integration';
end $$;
insert into auth.users(id) values ('71000000-0000-4000-8000-000000000001'),('71000000-0000-4000-8000-000000000002');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','body_photo','ready','body-photos','privacy-fixture',10,'image/png',600,800,now()+interval '1 day');
do $$
declare receipt uuid;
begin
 receipt := private.request_account_deletion('71000000-0000-4000-8000-000000000001');
 begin
   perform private.complete_pilot_account_deletion(receipt,repeat('a',64));
   raise exception 'unfinished media deletion accepted';
 exception when check_violation then null; end;
 perform private.finish_asset_purge('72000000-0000-4000-8000-000000000001',true,null);
 assert private.complete_pilot_account_deletion(receipt,repeat('a',64)), 'completion failed';
 assert private.complete_pilot_account_deletion(receipt,repeat('a',64)), 'completion not idempotent';
 assert not exists(select 1 from auth.users where id='71000000-0000-4000-8000-000000000001'), 'identity remains';
 assert not exists(select 1 from public.profiles where id='71000000-0000-4000-8000-000000000001'), 'profile remains';
 assert not exists(select 1 from private.assets where user_id='71000000-0000-4000-8000-000000000001'), 'metadata remains';
 assert exists(select 1 from auth.users where id='71000000-0000-4000-8000-000000000002'), 'other user removed';
 assert exists(select 1 from private.deletion_requests where id=receipt and state='done' and user_id is null and finished_at is not null), 'receipt incomplete';
 assert not has_function_privilege('stylai_api','private.complete_pilot_account_deletion(uuid,text)','EXECUTE'), 'API can erase auth';
 assert not has_function_privilege('stylai_ai_worker','private.complete_pilot_account_deletion(uuid,text)','EXECUTE'), 'worker can erase auth';
end $$;
rollback;
select 'Privacy completion PostgreSQL assertions passed.';


