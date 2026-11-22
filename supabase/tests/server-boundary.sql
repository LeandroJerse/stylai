begin;

do $$
declare role_name text; table_row record;
begin
  foreach role_name in array array['stylai_api','stylai_ai_worker','stylai_payments','stylai_procurement'] loop
    assert exists(select 1 from pg_roles where rolname=role_name and not rolcanlogin and not rolsuper
      and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication and not rolinherit),
      'runtime role must start disabled and restricted';
    assert not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=role_name), 'runtime role inherits authority';
    assert not pg_has_role('anon',role_name,'MEMBER') and not pg_has_role('authenticated',role_name,'MEMBER'), 'browser runtime membership';
    for table_row in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','auth','storage') and c.relkind in ('r','p','v','m','f') loop
      assert not has_table_privilege(role_name,table_row.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'runtime raw table access';
      assert not has_any_column_privilege(role_name,table_row.oid,'SELECT,INSERT,UPDATE,REFERENCES'), 'runtime column access';
    end loop;
    assert has_function_privilege(role_name,'private.server_boundary_version()','EXECUTE'), 'missing contract probe';
  end loop;
  assert not has_function_privilege('authenticated','private.server_boundary_version()','EXECUTE'), 'browser probe access';
end $$;

-- These calls execute with the real restricted role, not service_role.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into private.photo_consents(user_id,policy_version) values ('10000000-0000-4000-8000-000000000001','test-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','body_photo','ready','body-photos','boundary-photo',4096,'image/jpeg',800,1000,now()+interval '1 day');
insert into public.categories(id,label) values ('test-tops','Tops');

set local role stylai_api;
do $$
declare job uuid;
begin
  assert private.server_boundary_version()='20261121000400', 'wrong boundary contract';
  job := private.enqueue_ai_job('10000000-0000-4000-8000-000000000001','boundary-key',repeat('a',64),
    '20000000-0000-4000-8000-000000000001','test-tops','test-v1');
  assert private.cancel_ai_job('10000000-0000-4000-8000-000000000002',job)=false, 'foreign account cancelled job';
  begin
    perform private.enqueue_ai_job('10000000-0000-4000-8000-000000000002','foreign',repeat('a',64),
      '20000000-0000-4000-8000-000000000001','test-tops','test-v1');
    raise exception 'foreign photo accepted';
  exception when insufficient_privilege then null; end;
  begin perform private.claim_ai_job(job); raise exception 'API claimed worker job';
  exception when insufficient_privilege then null; end;
  begin perform private.confirm_order_payment(null,null,null,null,null,null,null,null); raise exception 'API confirmed payment';
  exception when insufficient_privilege then null; end;
  begin perform 1 from private.app_sessions; raise exception 'runtime read session vault';
  exception when insufficient_privilege then null; end;
  assert private.cancel_ai_job('10000000-0000-4000-8000-000000000001',job), 'owner cancellation failed';
end $$;
reset role;

set local role stylai_ai_worker;
do $$ begin
  assert private.claim_ai_job('00000000-0000-4000-8000-000000000000') is null;
  begin perform private.request_account_deletion('10000000-0000-4000-8000-000000000001'); raise exception 'worker deleted account';
  exception when insufficient_privilege then null; end;
  begin perform private.record_supplier_purchase(null,1); raise exception 'AI worker spent procurement funds';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role stylai_payments;
do $$ begin
  assert private.record_payment_event('sandbox','fixture-merchant','evt-1','res-1','fixture',repeat('b',64));
  begin perform private.record_supplier_purchase(null,1); raise exception 'payments spent procurement funds';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role stylai_procurement;
do $$ begin
  begin perform private.record_supplier_purchase(null,1); raise exception 'unconfirmed purchase accepted';
  exception when check_violation then null; end;
  begin perform private.record_payment_event('sandbox','x','x','x','x',repeat('b',64)); raise exception 'procurement wrote payment inbox';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Future private functions must not silently become browser/runtime callable.
create function private.boundary_future_fixture() returns integer language sql as $$ select 1 $$;
do $$ begin
  assert not has_function_privilege('anon','private.boundary_future_fixture()','EXECUTE'), 'future public execution';
  assert not has_function_privilege('stylai_api','private.boundary_future_fixture()','EXECUTE'), 'future runtime execution';
end $$;
rollback;
select 'Server boundary PostgreSQL privilege assertions passed.';
