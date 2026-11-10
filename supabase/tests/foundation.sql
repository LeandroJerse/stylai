-- Real role/RLS/constraint assertions. Synthetic data is rolled back.
begin;
insert into auth.users(id, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', '{"name":"User A"}'),
  ('22222222-2222-4222-8222-222222222222', '{"name":"User B"}');
insert into private.app_sessions(user_id, provider_session_id, cookie_hash, token_payload_ciphertext, key_version, token_expires_at, expires_at)
values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a',64), 'TEST_ONLY_NOT_REAL_TOKENS', 'test', now()+interval '15 minutes', now()+interval '1 day');
insert into public.partners(id, source, external_seller_id, region, name) values ('33333333-3333-4333-8333-333333333333', 'aliexpress','TEST_SELLER','TEST','Test seller');
insert into public.categories(id,label) values ('test-category','Test category'),('unused','Unused');
insert into public.products(id, partner_id, external_product_id, category_id, name, published, rights_cleared, price_minor) values
  ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','TEST_PUBLIC','test-category','Test public',true,true,10000),
  ('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','TEST_DRAFT','test-category','Test draft',false,true,null),
  ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','TEST_UNCLEARED','test-category','Test uncleared',true,false,null);
insert into public.product_variants(id, product_id, external_variant_id, label) values ('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444','TEST_VARIANT','M');
insert into storage.buckets(id,name,public) values ('unrelated-test-bucket','Unrelated',false);
insert into storage.objects(bucket_id,name) values ('body-photos','hidden-test.jpg'),('unrelated-test-bucket','allowed-test.jpg');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'auth profile trigger';
  assert not has_table_privilege('anon','public.profiles','select'), 'anon profile privilege';
  assert not has_table_privilege('authenticated','private.app_sessions','select'), 'session vault private';
  assert (select count(*) from storage.buckets where id in ('body-photos','references','generated-looks') and public) = 0, 'photo buckets private';
  begin
    insert into public.products(partner_id,external_product_id,name,price_minor) values ('33333333-3333-4333-8333-333333333333','BAD_PRICE','Bad',-1);
    raise exception 'negative price accepted';
  exception when check_violation then null; end;
end $$;

set local role anon;
do $$ begin
  assert public.stylai_health()->>'schema_version' = '20261110000100', 'database health/schema';
  assert (select count(*) from public.products) = 1, 'published and rights-cleared only';
  assert (select count(*) from public.categories) = 1, 'unpublished/unused facet hidden';
  assert (select count(*) from public.product_variants) = 1, 'published variant';
  assert (select count(*) from storage.objects where bucket_id='body-photos') = 0, 'restrictive private read';
  assert (select count(*) from storage.objects where bucket_id='unrelated-test-bucket') = 1, 'unrelated bucket unchanged';
  begin
    insert into public.categories(id,label) values ('unauthorized','No');
    raise exception 'anonymous catalog write accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'owner-only active profile';
  update public.profiles set name='Updated A' where id='11111111-1111-4111-8111-111111111111';
  assert (select name from public.profiles where id='11111111-1111-4111-8111-111111111111') = 'Updated A', 'owner name update';
  begin
    update public.profiles set deletion_state='deleting';
    raise exception 'protected profile column writable';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) values ('body-photos','bypass.jpg');
    raise exception 'private object write bypass accepted';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
do $$ begin
  assert (select count(*) from public.profiles) = 0, 'another user cannot borrow session';
end $$;
reset role;
update private.app_sessions set revoked_at=now();
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
do $$ begin
  assert (select count(*) from public.profiles) = 0, 'revoked session denied';
end $$;
reset role;

do $$ begin
  begin
    insert into public.product_images(product_id,variant_id,url) values ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777','https://example.test/wrong-product.jpg');
    raise exception 'variant/image product mismatch accepted';
  exception when foreign_key_violation then null; end;
end $$;
rollback;
select 'Foundation SQL/RLS assertions passed; all synthetic rows rolled back.' as result;
