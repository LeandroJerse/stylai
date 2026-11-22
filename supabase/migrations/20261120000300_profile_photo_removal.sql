-- Body photos are managed in the Perfil: the owner can remove the current front photo.
-- Removal is immediate for use (no new job can pick it: enqueue requires state 'ready');
-- deleting the stored object is the pending storage-cleanup workflow ('deleting').
begin;

create function private.remove_body_photo(p_user uuid) returns integer
language sql security definer set search_path = '' as $$
  with removed as (
    update private.assets set state='deleting'
    where user_id=p_user and kind='body_photo' and state in ('ready','processing','rejected')
    returning 1)
  select count(*)::integer from removed;
$$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261120000300'::text $$;

revoke all on function private.remove_body_photo(uuid) from public,anon,authenticated,service_role;
grant execute on function private.remove_body_photo(uuid) to stylai_api;

commit;
