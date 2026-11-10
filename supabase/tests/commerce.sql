begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
insert into private.procurement_budgets(id,limit_minor,enabled) values ('30000000-0000-4000-8000-000000000001',10000,true);
insert into private.quotes(id,user_id,budget_id,total_minor,procurement_minor,expires_at,snapshot) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',9900,7000,now()+interval '10 minutes','{}'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',9900,7000,now()+interval '10 minutes','{}');

set local role service_role;
do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000001';
  b constant uuid := '10000000-0000-4000-8000-000000000002';
  q constant uuid := '40000000-0000-4000-8000-000000000001';
  q2 constant uuid := '40000000-0000-4000-8000-000000000002';
  attempt uuid;
begin
  begin
    perform private.start_order_payment(b,q,'pix','sandbox','fixture-merchant');
    raise exception 'foreign quote accepted';
  exception when insufficient_privilege then null; end;
  attempt := private.start_order_payment(a,q,'pix','sandbox','fixture-merchant');
  assert attempt = private.start_order_payment(a,q,'pix','sandbox','fixture-merchant'), 'repeated quote created second attempt';
  begin
    perform private.start_order_payment(a,q,'boleto','sandbox','fixture-merchant');
    raise exception 'replaced pending attempt via method switch';
  exception when unique_violation then null; end;
  begin
    perform private.start_order_payment(b,q2,'card','sandbox','fixture-merchant');
    raise exception 'oversubscribed procurement balance';
  exception when check_violation then null; end;
  assert not private.bind_payment_resource(attempt,'payment','fixture-payment',now()+interval '2 days'), 'prepared intent was never claimed';
  assert private.begin_payment_submission(attempt), 'submission claim failed';
  assert not private.begin_payment_submission(attempt), 'duplicate dispatch claim';
  assert not private.close_unpayable_attempt(attempt,null,null), 'released unknown submission';
  assert private.bind_payment_resource(attempt,'payment','fixture-payment',now()+interval '2 days'), 'provider resource not bound';
  assert private.record_payment_event('sandbox','fixture-merchant','event-1','fixture-payment','payment_confirmed',repeat('a',64)), 'initial event not accepted';
  assert not private.record_payment_event('sandbox','fixture-merchant','event-1','fixture-payment','payment_confirmed',repeat('a',64)), 'duplicate event created another row';
  begin
    perform private.record_payment_event('sandbox','fixture-merchant','event-1','fixture-payment','payment_confirmed',repeat('b',64));
    raise exception 'event id reused with different body';
  exception when unique_violation then null; end;
  begin
    perform private.confirm_order_payment(attempt,'sandbox','fixture-merchant','payment','fixture-payment',9899,'BRL',clock_timestamp());
    raise exception 'incorrect amount accepted';
  exception when check_violation then null; end;
  assert private.confirm_order_payment(attempt,'sandbox','fixture-merchant','payment','fixture-payment',9900,'BRL',clock_timestamp()), 'payment not confirmed';
  assert not private.confirm_order_payment(attempt,'sandbox','fixture-merchant','payment','fixture-payment',9900,'BRL',clock_timestamp()), 'duplicate confirmation';
  assert private.record_supplier_purchase(attempt,6500), 'supplier cost not accounted';
  assert not private.record_supplier_purchase(attempt,6500), 'supplier cost reconciled twice';
  perform private.request_account_deletion(a);
end $$;
reset role;
delete from auth.users where id='10000000-0000-4000-8000-000000000001';
do $$ begin
  assert (select count(*) = 1 and count(user_id)=0 from private.orders), 'paid financial record lost or retained user link';
  assert (select count(*) from private.payment_attempts)=1, 'rejected attempts left partial rows';
  assert (select count(*) from private.order_outbox)=1, 'dispatch not exactly once';
  assert (select reserved_minor=0 and spent_minor=6500 from private.procurement_budgets), 'supplier cost lost or duplicated';
end $$;
rollback;
select 'Phase 2 commerce SQL assertions passed.' as result;
