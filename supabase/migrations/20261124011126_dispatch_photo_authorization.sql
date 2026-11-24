-- Recheck original person authorization at the dispatch boundary for every provider.
begin;
create or replace function private.begin_provider_call(p_call uuid,p_fence bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.provider_calls%rowtype; declare item record; declare current_image text;
begin
 select * into c from private.provider_calls where id=p_call for update;
 if not found or c.status<>'reserved' then return false; end if;
 perform 1 from private.ai_jobs where id=c.job_id and status='running' and fence=p_fence and lease_until>clock_timestamp() for share;
 if not found then return false; end if;
 if c.operation='generation' then
  perform 1 from private.ai_jobs j join private.assets a on a.id=j.photo_id and a.user_id=j.user_id
    join private.photo_consents consent on consent.id=j.consent_id and consent.user_id=j.user_id
    join public.profiles profile on profile.id=j.user_id
    where j.id=c.job_id and a.state='ready' and a.validation_status='approved'
      and (a.expires_at is null or a.expires_at>clock_timestamp()) and consent.revoked_at is null and profile.deletion_state='active'
    for share of a,consent,profile;
  if not found then raise exception 'person photo authorization revoked' using errcode='SA005'; end if;
  for item in select i.product_id,i.variant_id,i.expected_image_url,i.snapshot from private.ai_job_items i where i.job_id=c.job_id loop
   current_image := private.ai_variant_json(item.product_id,item.variant_id)->>'image_url';
   if current_image is null or not exists(select 1 from public.products p where p.id=item.product_id and p.published and p.rights_cleared and p.availability<>'unavailable') then
    raise exception 'try-on rights missing at dispatch' using errcode='SA003';
   end if;
   if (item.expected_image_url is not null and current_image is distinct from item.expected_image_url)
     or (item.snapshot->>'garment_image_url' is not null and current_image is distinct from item.snapshot->>'garment_image_url') then
    raise exception 'selected image changed at dispatch' using errcode='SA004';
   end if;
  end loop;
 end if;
 update private.provider_calls set status='dispatched',started_at=clock_timestamp() where id=p_call;
 return true;
end $$;
commit;
