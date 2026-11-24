-- "Buscar outra": the person searches one more piece for a part of a stored outfit. ADDITIVE: one function, no table.
-- The pieces found by the server become swap options of that search (never client input; a swap still validates them).
-- Rollback: drop the function and restore server_boundary_version() to 20261124100000.
begin;
create function private.add_outfit_options(p_user uuid,p_set uuid,p_slot text,p_pieces jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare q private.outfit_searches%rowtype; declare known jsonb; declare fresh jsonb;
begin
  if p_slot is null or p_slot not in ('set','dress','lower','upper','outer') then raise exception 'invalid slot' using errcode='23514'; end if;
  if jsonb_typeof(p_pieces) is distinct from 'array' or jsonb_array_length(p_pieces) not between 1 and 24
    or exists(select 1 from jsonb_array_elements(p_pieces) x where jsonb_typeof(x) is distinct from 'object' or x->>'slot' is distinct from p_slot
      or coalesce(length(x->>'id'),0) not between 1 and 200) then
    raise exception 'invalid options' using errcode='23514';
  end if;
  -- The search row is the lock: two tabs adding options never lose each other's.
  select s.* into q from private.outfit_searches s join private.outfit_sets o on o.search_id=s.id
    where o.id=p_set and o.user_id=p_user and s.user_id=p_user and s.status='succeeded' for update of s;
  if not found then raise exception 'outfit unavailable' using errcode='42501'; end if;
  if not exists(select 1 from private.outfit_sets o join private.outfit_set_revisions r on r.set_id=o.id and r.revision=o.current_revision,
      jsonb_array_elements(r.pieces) x where o.id=p_set and x->>'slot'=p_slot) then
    raise exception 'slot without piece' using errcode='23514';
  end if;
  known := coalesce(q.plan#>array['pools',p_slot],'[]'::jsonb);
  select coalesce(jsonb_agg(f.x order by f.n),'[]'::jsonb) into fresh from (
    select distinct on (x->>'id') x,n from jsonb_array_elements(p_pieces) with ordinality e(x,n)
    where not exists(select 1 from jsonb_array_elements(known) k where k->>'id'=x->>'id') order by x->>'id',n) f;
  if jsonb_array_length(fresh)=0 then return 0; end if;
  -- Newest first, bounded: the plan has a size limit of its own.
  update private.outfit_searches set plan=jsonb_set(jsonb_set(plan,'{pools}',coalesce(plan->'pools','{}'::jsonb),true),array['pools',p_slot],
    (select jsonb_agg(v order by n) from jsonb_array_elements(fresh||known) with ordinality m(v,n) where n<=48),true) where id=q.id;
  return jsonb_array_length(fresh);
end $$;
create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261124200000'::text $$;
revoke all on function private.add_outfit_options(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;
grant execute on function private.add_outfit_options(uuid,uuid,text,jsonb) to stylai_api;
commit;
