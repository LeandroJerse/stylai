begin;

create table private.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  connection_id uuid not null references private.source_connections(id),
  updated_at timestamptz not null default now()
);
create table private.cart_items (
  cart_id uuid not null references private.carts(id) on delete cascade,
  product_id uuid not null,
  variant_id uuid not null,
  quantity integer not null check (quantity between 1 and 99),
  primary key (cart_id,variant_id),
  foreign key (product_id,variant_id) references public.product_variants(product_id,id)
);

create table private.procurement_budgets (
  id uuid primary key default gen_random_uuid(),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  currency text not null default 'BRL' check (currency='BRL'),
  limit_minor bigint not null check (limit_minor > 0),
  reserved_minor bigint not null default 0 check (reserved_minor >= 0),
  spent_minor bigint not null default 0 check (spent_minor >= 0),
  enabled boolean not null default false,
  check (reserved_minor <= limit_minor - spent_minor)
);

create table private.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  budget_id uuid not null references private.procurement_budgets(id),
  currency text not null default 'BRL' check (currency='BRL'),
  total_minor bigint not null check (total_minor > 0),
  procurement_minor bigint not null check (procurement_minor > 0),
  expires_at timestamptz not null,
  -- Versioned terms and listing/price snapshot. Keep delivery PII out of this record.
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index quotes_owner_history on private.quotes(user_id,created_at desc);

create table private.orders (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references private.quotes(id),
  user_id uuid references public.profiles(id) on delete set null,
  state text not null default 'awaiting_payment' check (state in ('awaiting_payment','paid','expired','payment_exception','cancelled','refunded')),
  currency text not null check (currency='BRL'),
  total_minor bigint not null check (total_minor > 0),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index orders_owner_history on private.orders(user_id,created_at desc);

create table private.procurement_reservations (
  order_id uuid primary key references private.orders(id),
  budget_id uuid not null references private.procurement_budgets(id),
  amount_minor bigint not null check (amount_minor > 0),
  actual_minor bigint check (actual_minor between 1 and amount_minor),
  state text not null default 'reserved' check (state in ('reserved','spent','released')),
  created_at timestamptz not null default now(),
  check ((state='spent') = (actual_minor is not null))
);
create index procurement_reservations_budget on private.procurement_reservations(budget_id);

create table private.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.orders(id),
  environment text not null check (environment in ('sandbox','production')),
  merchant_ref text not null check (length(btrim(merchant_ref)) between 1 and 128),
  method text not null check (method in ('pix','card','boleto')),
  state text not null default 'prepared' check (state in ('prepared','pending','submission_unknown','confirmed','closed','late_paid')),
  resource_kind text check (resource_kind in ('checkout','payment')),
  resource_id text check (length(btrim(resource_id)) between 1 and 128),
  payable_until timestamptz,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (environment,merchant_ref,resource_kind,resource_id),
  check ((resource_kind is null) = (resource_id is null)),
  check ((resource_id is null) = (payable_until is null)),
  check (payable_until is null or payable_until>created_at),
  check (method <> 'boleto' or resource_kind is null or resource_kind='payment'),
  check (state not in ('pending','confirmed','late_paid') or resource_id is not null)
);
create unique index payment_attempts_one_active on private.payment_attempts(order_id)
  where state in ('prepared','pending','submission_unknown','confirmed');

create table private.payment_event_inbox (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('sandbox','production')),
  merchant_ref text not null,
  event_id text not null,
  resource_ref text not null,
  event_kind text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (environment,merchant_ref,event_id)
);
create index payment_events_unprocessed on private.payment_event_inbox(received_at) where processed_at is null;

create table private.order_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.orders(id),
  kind text not null check (kind in ('procure_order','payment_exception')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (order_id,kind)
);
create index order_outbox_undelivered on private.order_outbox(created_at) where delivered_at is null;

create table private.refund_operations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references private.payment_attempts(id),
  request_key text not null,
  provider_ref text,
  amount_minor bigint not null check (amount_minor > 0),
  state text not null check (state in ('requested','submitted','unknown','confirmed','failed')),
  created_at timestamptz not null default now(),
  unique (attempt_id,request_key),
  unique (attempt_id,provider_ref)
);

create table private.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references private.orders(id),
  connection_id uuid not null references private.source_connections(id),
  supplier_reference text,
  state text not null check (state in ('prepared','submitting','purchase_unknown','accepted','cancelled','failed')),
  created_at timestamptz not null default now(),
  unique (connection_id,supplier_reference)
);
create table private.shipments (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null references private.supplier_orders(id),
  external_shipment_id text not null,
  tracking_ref text,
  state text not null check (state in ('pending','in_transit','delivered','exception','returned')),
  unique (supplier_order_id,external_shipment_id)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['carts','cart_items','procurement_budgets','quotes','orders','procurement_reservations',
    'payment_attempts','payment_event_inbox','order_outbox','refund_operations','supplier_orders','shipments'] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role',table_name);
    execute format('grant select on private.%I to service_role',table_name);
  end loop;
end $$;
grant insert on private.quotes to service_role;
grant insert,update,delete on private.carts,private.cart_items to service_role;

create function private.start_order_payment(p_user uuid,p_quote uuid,p_method text,p_environment text,p_merchant text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q private.quotes%rowtype;
declare existing private.payment_attempts%rowtype;
declare new_order uuid;
declare new_attempt uuid;
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  select * into q from private.quotes where id=p_quote and user_id=p_user for update;
  if not found then raise exception 'quote unavailable' using errcode='42501'; end if;
  select id into new_order from private.orders where quote_id=p_quote;
  if found then
    select * into existing from private.payment_attempts where order_id=new_order;
    if existing.state not in ('prepared','pending','submission_unknown','confirmed') or
       (existing.method,existing.environment,existing.merchant_ref) is distinct from (p_method,p_environment,p_merchant) then
      raise exception 'quote already consumed' using errcode='23505';
    end if;
    return existing.id;
  end if;
  if q.expires_at<=clock_timestamp() then raise exception 'quote expired' using errcode='23514'; end if;
  update private.procurement_budgets set reserved_minor=reserved_minor+q.procurement_minor
    where id=q.budget_id and enabled and currency=q.currency and environment=p_environment
      and q.procurement_minor<=limit_minor-spent_minor-reserved_minor;
  if not found then raise exception 'procurement funding unavailable' using errcode='23514'; end if;
  insert into private.orders(quote_id,user_id,currency,total_minor) values(q.id,p_user,q.currency,q.total_minor) returning id into new_order;
  insert into private.procurement_reservations(order_id,budget_id,amount_minor) values(new_order,q.budget_id,q.procurement_minor);
  insert into private.payment_attempts(order_id,method,environment,merchant_ref) values(new_order,p_method,p_environment,p_merchant) returning id into new_attempt;
  return new_attempt;
end $$;

-- Transition and commit before calling the provider. Ambiguous I/O keeps this state.
create function private.begin_payment_submission(p_attempt uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare account_id uuid;
begin
  select o.user_id into account_id from private.orders o join private.payment_attempts a on a.order_id=o.id where a.id=p_attempt;
  perform 1 from public.profiles where id=account_id and deletion_state='active' for update;
  if not found then return false; end if;
  update private.payment_attempts a set state='submission_unknown'
    from private.orders o join private.quotes q on q.id=o.quote_id
    where a.id=p_attempt and a.order_id=o.id and a.state='prepared' and o.state='awaiting_payment' and q.expires_at>clock_timestamp();
  return found;
end $$;

create function private.record_payment_event(p_environment text,p_merchant text,p_event text,p_resource text,p_kind text,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into private.payment_event_inbox(environment,merchant_ref,event_id,resource_ref,event_kind,payload_hash)
    values(p_environment,p_merchant,p_event,p_resource,p_kind,p_hash)
    on conflict(environment,merchant_ref,event_id) do nothing;
  if found then return true; end if;
  if not exists(select 1 from private.payment_event_inbox where environment=p_environment and merchant_ref=p_merchant
    and event_id=p_event and (resource_ref,event_kind,payload_hash) is not distinct from (p_resource,p_kind,p_hash)) then
    raise exception 'event identity conflict' using errcode='23505';
  end if;
  return false;
end $$;

create function private.bind_payment_resource(p_attempt uuid,p_kind text,p_resource text,p_payable_until timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.payment_attempts set resource_kind=p_kind,resource_id=p_resource,payable_until=p_payable_until,state='pending'
    where id=p_attempt and state='submission_unknown' and resource_id is null;
  if found then return true; end if;
  return exists(select 1 from private.payment_attempts where id=p_attempt and resource_kind=p_kind and resource_id=p_resource
    and payable_until=p_payable_until and state='pending');
end $$;

-- Use only after the server has reconciled a confirmed provider payment.
create function private.confirm_order_payment(p_attempt uuid,p_environment text,p_merchant text,p_kind text,p_resource text,
  p_amount bigint,p_currency text,p_paid_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare attempt private.payment_attempts%rowtype;
declare order_row private.orders%rowtype;
declare account_id uuid;
begin
  select o.user_id into account_id from private.orders o join private.payment_attempts a on a.order_id=o.id where a.id=p_attempt;
  perform 1 from public.profiles where id=account_id for update;
  select * into attempt from private.payment_attempts where id=p_attempt for update;
  if not found or attempt.resource_id is null or (attempt.environment,attempt.merchant_ref,attempt.resource_kind,attempt.resource_id)
    is distinct from (p_environment,p_merchant,p_kind,p_resource) then
    raise exception 'payment reference mismatch' using errcode='23514';
  end if;
  select * into strict order_row from private.orders where id=attempt.order_id for update;
  if (order_row.total_minor,order_row.currency) is distinct from (p_amount,p_currency) then
    raise exception 'payment amount mismatch' using errcode='23514';
  end if;
  if p_paid_at is null or p_paid_at<attempt.created_at or p_paid_at>clock_timestamp() then
    raise exception 'invalid provider payment time' using errcode='23514';
  end if;
  if attempt.state in ('confirmed','late_paid') then return false; end if;
  if attempt.state='closed' or order_row.state <> 'awaiting_payment' or order_row.user_id is null
    or not exists(select 1 from public.profiles where id=order_row.user_id and deletion_state='active')
    or p_paid_at>attempt.payable_until
    or not exists(select 1 from private.procurement_reservations where order_id=order_row.id and state='reserved') then
    update private.payment_attempts set state='late_paid' where id=p_attempt;
    update private.orders set state='payment_exception',paid_at=p_paid_at where id=order_row.id;
    insert into private.order_outbox(order_id,kind) values(order_row.id,'payment_exception') on conflict do nothing;
    return true;
  end if;
  if attempt.state <> 'pending' then raise exception 'payment is not bound' using errcode='23514'; end if;
  update private.payment_attempts set state='confirmed' where id=p_attempt;
  update private.orders set state='paid',paid_at=p_paid_at where id=order_row.id;
  insert into private.order_outbox(order_id,kind) values(order_row.id,'procure_order');
  return true;
end $$;

-- Record an already reconciled supplier acceptance within the reserved maximum.
-- Provider/FX proof and supplier-order identity are verified by the adapter.
create function private.record_supplier_purchase(p_attempt uuid,p_actual_minor bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare order_id_value uuid;
declare reservation private.procurement_reservations%rowtype;
begin
  select order_id into order_id_value from private.payment_attempts where id=p_attempt and state='confirmed' for update;
  if not found then raise exception 'payment is unconfirmed' using errcode='23514'; end if;
  perform 1 from private.orders where id=order_id_value and state='paid' for update;
  if not found then raise exception 'paid order unavailable' using errcode='23514'; end if;
  select * into reservation from private.procurement_reservations where order_id=order_id_value for update;
  if not found or p_actual_minor is null or p_actual_minor not between 1 and reservation.amount_minor then
    raise exception 'supplier cost outside reservation' using errcode='23514';
  end if;
  if reservation.state='spent' and reservation.actual_minor=p_actual_minor then return false; end if;
  if reservation.state<>'reserved' then raise exception 'procurement already resolved' using errcode='23505'; end if;
  update private.procurement_budgets set reserved_minor=reserved_minor-reservation.amount_minor,spent_minor=spent_minor+p_actual_minor
    where id=reservation.budget_id;
  update private.procurement_reservations set state='spent',actual_minor=p_actual_minor where order_id=order_id_value;
  return true;
end $$;

-- Closure requires provider proof the instrument cannot still be paid, or proof
-- the intent was never dispatched. An unknown submission keeps its reservation.
create function private.close_unpayable_attempt(p_attempt uuid,p_kind text,p_resource text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare attempt private.payment_attempts%rowtype;
declare reservation private.procurement_reservations%rowtype;
begin
  select * into attempt from private.payment_attempts where id=p_attempt for update;
  if not found or attempt.state not in ('prepared','pending')
    or (attempt.resource_kind,attempt.resource_id) is distinct from (p_kind,p_resource) then return false; end if;
  perform 1 from private.orders where id=attempt.order_id and state='awaiting_payment' for update;
  if not found then return false; end if;
  update private.procurement_reservations set state='released'
    where order_id=attempt.order_id and state='reserved' returning * into reservation;
  if not found then raise exception 'procurement reservation unavailable' using errcode='23514'; end if;
  update private.procurement_budgets set reserved_minor=reserved_minor-reservation.amount_minor where id=reservation.budget_id;
  update private.payment_attempts set state='closed',closed_at=clock_timestamp() where id=p_attempt;
  update private.orders set state='expired' where id=attempt.order_id;
  return true;
end $$;

revoke all on function private.start_order_payment(uuid,uuid,text,text,text),private.begin_payment_submission(uuid),
  private.record_payment_event(text,text,text,text,text,text),private.bind_payment_resource(uuid,text,text,timestamptz),
  private.confirm_order_payment(uuid,text,text,text,text,bigint,text,timestamptz),private.close_unpayable_attempt(uuid,text,text),
  private.record_supplier_purchase(uuid,bigint)
  from public,anon,authenticated;
grant execute on function private.start_order_payment(uuid,uuid,text,text,text),private.begin_payment_submission(uuid),
  private.record_payment_event(text,text,text,text,text,text),private.bind_payment_resource(uuid,text,text,timestamptz),
  private.confirm_order_payment(uuid,text,text,text,text,bigint,text,timestamptz),private.close_unpayable_attempt(uuid,text,text),
  private.record_supplier_purchase(uuid,bigint)
  to service_role;

commit;
