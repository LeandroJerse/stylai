-- Committed only inside the disposable test database for multi-session assertions.
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into private.photo_consents(user_id,policy_version) values ('10000000-0000-4000-8000-000000000001','test-v1');
insert into private.assets(id,user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','body_photo','ready','body-photos','race-fixture',4096,'image/jpeg',800,1000,now()+interval '1 day');
insert into public.categories(id,label) values ('test-tops','Tops');
insert into private.procurement_budgets(id,limit_minor,enabled) values ('30000000-0000-4000-8000-000000000001',10000,true);
insert into private.quotes(id,user_id,budget_id,total_minor,procurement_minor,expires_at,snapshot) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',9900,7000,now()+interval '10 minutes','{}'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',9900,7000,now()+interval '10 minutes','{}');
