-- Studio journey entry points, executed with the real restricted roles.
begin;

insert into auth.users(id) values ('30000000-0000-4000-8000-00000000000a'),('30000000-0000-4000-8000-00000000000b');
insert into public.categories(id,label) values ('tops','Blusas'),('pants','Calças'),('dresses','Vestidos'),('hats','Chapéus');
insert into public.partners(id,source,external_seller_id,region,name) values
  ('31000000-0000-4000-8000-000000000001','curated','fixture-seller','BR','Loja fixture');
insert into public.products(id,partner_id,external_product_id,category_id,name,price_minor,availability,published,rights_cleared,fixture) values
  ('32000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','p1','tops','Blusa fixture',null,'unknown',true,true,true),
  ('32000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001','p2','tops','Rascunho',1000,'available',false,true,true),
  ('32000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000001','p3','tops','Sem direito de prova',1000,'available',true,true,true),
  ('32000000-0000-4000-8000-000000000004','31000000-0000-4000-8000-000000000001','p4','pants','Calça fixture',null,'unknown',true,true,true),
  ('32000000-0000-4000-8000-000000000005','31000000-0000-4000-8000-000000000001','p5','dresses','Vestido fixture',null,'unknown',true,true,true),
  ('32000000-0000-4000-8000-000000000006','31000000-0000-4000-8000-000000000001','p6','hats','Chapéu fixture',null,'unknown',true,true,true);
insert into public.product_variants(id,product_id,external_variant_id,label,available) values
  ('33000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','v1','M',true),
  ('33000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000003','v3','M',true),
  ('33000000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000004','v4','40',true),
  ('33000000-0000-4000-8000-000000000005','32000000-0000-4000-8000-000000000005','v5','M',true),
  ('33000000-0000-4000-8000-000000000006','32000000-0000-4000-8000-000000000006','v6','U',true);
insert into public.product_images(id,product_id,url,position) values
  ('34000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','https://fixtures.stylai.test/p1.png',0),
  ('34000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000003','https://fixtures.stylai.test/p3.png',0);
insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed) values
  ('34000000-0000-4000-8000-000000000001','test_fixture','synthetic test image',true),
  ('34000000-0000-4000-8000-000000000003','test_fixture','display only',false);

set local role stylai_api;
do $$
declare a uuid := '30000000-0000-4000-8000-00000000000a';
declare b uuid := '30000000-0000-4000-8000-00000000000b';
declare sa uuid := '35000000-0000-4000-8000-00000000000a';
declare session uuid; declare r jsonb; declare consent uuid; declare photo uuid; declare photo2 uuid; declare job uuid;
begin
  assert private.server_boundary_version()='20261125190100', 'boundary version not bumped';

  -- Catalog: only published + cleared rows; fixture flag and rights are visible to the API.
  r := private.list_catalog_products(24,0,null);
  assert (r->>'total')::int=5, 'unpublished product listed';
  assert private.read_catalog_product('32000000-0000-4000-8000-000000000002') is null, 'draft readable';
  r := private.read_catalog_product('32000000-0000-4000-8000-000000000001');
  assert (r->>'fixture')::boolean and r->'price_minor'='null'::jsonb, 'fixture/null price not preserved';
  assert (r->'images'->0->>'try_on_allowed')::boolean, 'rights flag missing';
  assert (private.catalog_facets()->>'total')::int=5, 'facets count';

  -- Session vault: JWT session must map to an active app session of the same user.
  session := private.create_app_session(a,sa,repeat('a',64),'ct-1','v1',900,86400);
  assert private.check_app_session(a,sa), 'active session not recognised';
  assert not private.check_app_session(b,sa), 'session accepted for another user';
  r := private.begin_session_refresh(repeat('a',64));
  assert r->>'state'='fresh' and r->>'ciphertext'='ct-1', 'fresh tokens not reused';
  assert private.begin_session_refresh(repeat('f',64)) is null, 'unknown cookie accepted';
  begin
    perform private.create_app_session(b,sa,repeat('b',64),'ct-x','v1',900,86400);
    raise exception 'session takeover accepted';
  exception when insufficient_privilege then null; end;
  r := private.revoke_app_session(repeat('a',64));
  assert r->>'ciphertext'='ct-1', 'revoke must return ciphertext for provider logout';
  assert not private.check_app_session(a,sa), 'revoked session still valid';
  assert private.begin_session_refresh(repeat('a',64)) is null, 'revoked session refreshed';
  assert private.revoke_app_session(repeat('a',64)) is null, 'double revoke returned data';

  -- Consent before photo; object key confined to the actor prefix.
  begin
    perform private.begin_body_photo(a,'dev-v1',a::text||'/x.png',10,'image/png',600,800);
    raise exception 'photo accepted without consent';
  exception when insufficient_privilege then null; end;
  consent := private.record_photo_consent(a,'dev-v1');
  assert private.record_photo_consent(a,'dev-v1')=consent, 'consent not idempotent';
  begin
    perform private.begin_body_photo(a,'dev-v1',b::text||'/x.png',10,'image/png',600,800);
    raise exception 'foreign object prefix accepted';
  exception when insufficient_privilege then null; end;
  photo := private.begin_body_photo(a,'dev-v1',a::text||'/front-1.png',10,'image/png',600,800);
  assert private.read_body_photo_asset(b,photo) is null, 'foreign candidate readable';
  assert private.set_body_photo_hash(a,photo,repeat('1',64)), 'hash not recorded';
  begin
    perform private.settle_body_photo_validation(a,photo,repeat('9',64),'approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb);
    raise exception 'validation accepted for other bytes';
  exception when serialization_failure then null; end;
  assert private.settle_body_photo_validation(a,photo,repeat('1',64),'approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb), 'approval failed';
  assert private.read_body_photo_asset(b,photo) is null, 'foreign photo readable';
  assert private.read_body_photo_asset(a,photo)->>'object_key'=a::text||'/front-1.png', 'own photo unreadable';
  -- A new candidate that needs adjustment never replaces the approved photo.
  photo2 := private.begin_body_photo_at(a,'front','dev-v1',a::text||'/front-2.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo2,repeat('2',64));
  assert not private.settle_body_photo_validation(a,photo2,repeat('2',64),'needs_adjustment','mp-test+pose-rules/4','{"issues":["legs"]}'::jsonb), 'rejected candidate in use';
  assert private.read_body_photo_asset(a,photo) is not null, 'approved photo replaced by a failed candidate';
  assert jsonb_array_length(private.list_body_photos(a))=2, 'list should show current + candidate';
  assert private.read_cached_photo_validation(a,repeat('2',64),'mp-test+pose-rules/4','front')->>'status'='needs_adjustment', 'cached result not reused';
  -- Side/profile photos are stored per angle and never become the job photo.
  photo := private.begin_body_photo_at(a,'side','dev-v1',a::text||'/side-1.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo,repeat('3',64));
  assert private.settle_body_photo_validation(a,photo,repeat('3',64),'approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb), 'side approval failed';
  assert private.remove_body_photo_at(a,'side')=1, 'side not removed';
  photo := (select (e->>'id')::uuid from jsonb_array_elements(private.list_body_photos(a)) e where e->>'state'='ready');
  photo2 := private.begin_body_photo_at(a,'front','dev-v1',a::text||'/front-2b.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo2,repeat('4',64));
  assert private.settle_body_photo_validation(a,photo2,repeat('4',64),'approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb), 'replacement failed';
  assert private.read_body_photo_asset(a,photo) is null, 'replaced photo still usable';
  assert jsonb_array_length(private.list_body_photos(a))=1, 'list should show only the current photo';
  assert private.list_body_photos(b)='[]'::jsonb, 'foreign photos listed';
  assert private.remove_body_photo(b)=0, 'removed another user''s photo';
  assert private.read_body_photo_asset(a,photo2) is not null, 'foreign removal touched the owner photo';

  -- Active job recovery and allowance are per actor.
  assert private.read_active_ai_job(a) is null, 'phantom active job';
  job := private.enqueue_look_job(a,'sj-key-0001',repeat('c',64),'dev-v1','32000000-0000-4000-8000-000000000001',null,null);
  assert private.read_active_ai_job(a)->>'id'=job::text, 'active job not recovered';
  assert private.read_active_ai_job(b) is null, 'foreign active job visible';
  r := private.read_ai_allowance(a);
  assert (r->>'allowance')::int=3 and (r->>'reserved')::int=1, 'allowance not reported';
  assert (private.read_ai_allowance(b)->>'reserved')::int=0, 'foreign usage leaked';
  assert private.cancel_ai_job(a,job), 'cancel failed';
  assert (private.read_ai_allowance(a)->>'reserved')::int=0, 'cancel did not release allowance';
  -- Removing the photo in the Perfil blocks generation at once (database rule, not only the UI).
  assert private.remove_body_photo(a)=1, 'photo not removed';
  assert private.list_body_photos(a)='[]'::jsonb, 'removed photo still listed';
  begin
    perform private.enqueue_look_job(a,'sj-key-0009',repeat('e',64),'dev-v1','32000000-0000-4000-8000-000000000001',null,null);
    raise exception 'generation accepted without a photo';
  exception when insufficient_privilege then null; end;
  photo := private.begin_body_photo(a,'dev-v1',a::text||'/front-3.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo,repeat('5',64));
  perform private.settle_body_photo_validation(a,photo,repeat('5',64),'approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb);
end $$;
reset role;

-- QA-001/QA-005: the job photo must be approved by the CURRENT rules and support the garment group.
set local role stylai_api;
do $$
declare a uuid := '30000000-0000-4000-8000-00000000000a';
declare photo uuid; declare job uuid;
begin
  perform private.remove_body_photo(a);
  -- Photo approved only to the knees: tops yes, trousers/dresses no, nothing reserved on refusal.
  photo := private.begin_body_photo_at(a,'front','dev-v1',a::text||'/front-knees.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo,repeat('6',64));
  perform private.settle_body_photo_validation(a,photo,repeat('6',64),'approved','mp-test+pose-rules/4',
    '{"supports":{"upper":true,"lower":false,"dress":false}}'::jsonb);
  begin
    perform private.enqueue_look_job(a,'gate-pants-1',repeat('f',64),'dev-v1','32000000-0000-4000-8000-000000000004',null,null);
    raise exception 'trousers accepted with a knees-only photo';
  exception when sqlstate 'SA001' then null; end;
  begin
    perform private.enqueue_look_job(a,'gate-dress-1',repeat('f',64),'dev-v1','32000000-0000-4000-8000-000000000005',null,null);
    raise exception 'dress accepted with a knees-only photo';
  exception when sqlstate 'SA001' then null; end;
  assert (private.read_ai_allowance(a)->>'reserved')::int=0, 'a refused request reserved allowance';
  begin
    perform private.enqueue_look_job(a,'gate-hat-1',repeat('f',64),'dev-v1','32000000-0000-4000-8000-000000000006',null,null);
    raise exception 'unknown category accepted';
  exception when check_violation then null; end;
  job := private.enqueue_look_job(a,'gate-top-1',repeat('f',64),'dev-v1','32000000-0000-4000-8000-000000000001',null,null);
  assert job is not null, 'top refused with a knees-only photo';
  assert private.cancel_ai_job(a,job), 'cancel failed';
  -- Missing/malformed metadata and approvals by older rules never unlock a generation.
  perform private.remove_body_photo(a);
  photo := private.begin_body_photo_at(a,'front','dev-v1',a::text||'/front-nometa.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo,repeat('7',64));
  perform private.settle_body_photo_validation(a,photo,repeat('7',64),'approved','mp-test+pose-rules/4','{"supports":"yes"}'::jsonb);
  begin
    perform private.enqueue_look_job(a,'gate-meta-1',repeat('f',64),'dev-v1','32000000-0000-4000-8000-000000000001',null,null);
    raise exception 'malformed supports accepted';
  exception when sqlstate 'SA001' then null; end;
  perform private.remove_body_photo(a);
  photo := private.begin_body_photo_at(a,'front','dev-v1',a::text||'/front-old.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo,repeat('8',64));
  perform private.settle_body_photo_validation(a,photo,repeat('8',64),'approved','mp-test+pose-rules/3','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb);
  begin
    perform private.enqueue_look_job(a,'gate-old-1',repeat('f',64),'dev-v1','32000000-0000-4000-8000-000000000001',null,null);
    raise exception 'approval by old rules accepted';
  exception when sqlstate 'SA002' then null; end;
  assert (private.read_ai_allowance(a)->>'reserved')::int=0, 'refusals reserved allowance';
  -- Restore the full-body approved photo for the next blocks.
  perform private.remove_body_photo(a);
  photo := private.begin_body_photo_at(a,'front','dev-v1',a::text||'/front-4.png',10,'image/png',600,800);
  perform private.set_body_photo_hash(a,photo,repeat('9',64));
  perform private.settle_body_photo_validation(a,photo,repeat('9',64),'approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb);
end $$;
reset role;

-- Try-on input image requires recorded try-on rights (display-only image is never sent).
do $$
declare job uuid; declare fence bigint; declare loaded jsonb;
begin
  job := private.enqueue_look_job('30000000-0000-4000-8000-00000000000a','sj-key-0002',repeat('d',64),'dev-v1',
    '32000000-0000-4000-8000-000000000003',null,null);
  fence := private.claim_ai_job(job);
  loaded := private.load_ai_job(job,fence);
  assert loaded->'variant'->'image_url'='null'::jsonb, 'display-only image offered to provider';
  assert (loaded->'variant'->>'fixture')::boolean, 'fixture flag not loaded';
end $$;

-- Deleting account: sessions stop validating even with an unexpired JWT.
do $$
declare s uuid;
begin
  s := private.create_app_session('30000000-0000-4000-8000-00000000000b','35000000-0000-4000-8000-00000000000b',repeat('b',64),'ct','v1',900,86400);
  assert private.check_app_session('30000000-0000-4000-8000-00000000000b','35000000-0000-4000-8000-00000000000b');
  update public.profiles set deletion_state='deleting' where id='30000000-0000-4000-8000-00000000000b';
  assert not private.check_app_session('30000000-0000-4000-8000-00000000000b','35000000-0000-4000-8000-00000000000b'), 'deleting account kept session';
  assert private.begin_session_refresh(repeat('b',64)) is null, 'deleting account refreshed';
end $$;

-- QA-002: bytes of removed photos are purged by the worker with lease, retry and confirmed completion.
do $$
declare a uuid := '30000000-0000-4000-8000-00000000000a';
declare n integer; declare first jsonb; declare target uuid;
begin
  assert not has_function_privilege('stylai_api','private.claim_asset_purges(integer)','EXECUTE'), 'API can claim purges';
  assert has_function_privilege('stylai_ai_worker','private.claim_asset_purges(integer)','EXECUTE'), 'worker cannot claim purges';
  select count(*) into n from private.assets where state='deleting';
  assert n>0, 'no removed photo queued for purge';
end $$;
set local role stylai_ai_worker;
do $$
declare first jsonb; declare again jsonb; declare target uuid; declare n integer;
begin
  first := private.claim_asset_purges(50);
  assert jsonb_array_length(first)>0, 'nothing claimed';
  again := private.claim_asset_purges(50);
  assert not exists (select 1 from jsonb_array_elements(again) x join jsonb_array_elements(first) y on x->>'id'=y->>'id'), 'leased row claimed twice';
  target := (first->0->>'id')::uuid;
  assert private.finish_asset_purge(target,false,'storage_remove_failed'), 'failure not recorded';
  assert private.finish_asset_purge((first->1->>'id')::uuid,true,null) or jsonb_array_length(first)<2, 'success not recorded';
end $$;
reset role;
do $$
declare r record;
begin
  select * into r from private.assets where state='deleting' and purge_last_error='storage_remove_failed' limit 1;
  assert found and r.purge_after>clock_timestamp() and r.purge_lease_until is null, 'failed purge not scheduled for retry';
  assert exists (select 1 from private.assets where state='deleted' and deleted_at is not null), 'confirmed purge not marked deleted';
end $$;

select 'Studio journey SQL assertions passed (session vault, consent/photo, catalog rights, isolation).';
rollback;
