begin;

-- Disabled until the owner provisions distinct passwords over a secure channel.
-- A collision fails this migration rather than trusting a pre-existing role.
create role stylai_api nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 8;
create role stylai_ai_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 8;
create role stylai_payments nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 8;
create role stylai_procurement nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 8;

grant usage on schema private to stylai_api,stylai_ai_worker,stylai_payments,stylai_procurement;
-- Global default is required: a schema-only REVOKE cannot remove PostgreSQL's
-- built-in global PUBLIC EXECUTE default. Applies to this migration owner only.
alter default privileges revoke execute on functions from public;

create function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261115000100'::text $$;
revoke all on function private.server_boundary_version() from public,anon,authenticated,service_role;
grant execute on function private.server_boundary_version() to stylai_api,stylai_ai_worker,stylai_payments,stylai_procurement;

-- Actor UUIDs MUST come from a verified app session. No public RPC is added.
grant execute on function private.enqueue_ai_job(uuid,text,text,uuid,text,text,text,uuid,uuid),
  private.cancel_ai_job(uuid,uuid),private.request_account_deletion(uuid),
  private.save_ai_look(uuid,uuid),private.set_favorite_product(uuid,uuid,boolean) to stylai_api;

grant execute on function private.claim_ai_job(uuid),private.finish_ai_job(uuid,bigint,text,uuid),
  private.reserve_ai_attempt(uuid,bigint,text,text,bigint),private.begin_ai_attempt(uuid,bigint),
  private.settle_ai_attempt(uuid,bigint),private.record_ai_selection(uuid,bigint,uuid,uuid,jsonb) to stylai_ai_worker;

-- Financial reconciliation cannot be reached through API or AI credentials.
grant execute on function private.start_order_payment(uuid,uuid,text,text,text),private.begin_payment_submission(uuid),
  private.record_payment_event(text,text,text,text,text,text),private.bind_payment_resource(uuid,text,text,timestamptz),
  private.confirm_order_payment(uuid,text,text,text,text,bigint,text,timestamptz),
  private.close_unpayable_attempt(uuid,text,text) to stylai_payments;
grant execute on function private.record_supplier_purchase(uuid,bigint) to stylai_procurement;

commit;
