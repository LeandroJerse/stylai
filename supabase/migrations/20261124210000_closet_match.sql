-- Match and Closet on the real engine. ADDITIVE:
--   * look_decisions: one decision (save|pass) per generated version and person, undoable;
--   * a saved version keeps its image (generated images expire in 168 hours; saved ones do not) and its pieces, frozen
--     in the version snapshot (saved_looks / saved_look_products already exist);
--   * saved_pieces: favourite listings with a server-built snapshot (store listings are not catalog rows).
-- Nothing here generates images or spends coins. Account and body-data deletion keep working through the same cascades.
-- Rollback: drop the new functions/tables and restore server_boundary_version() to 20261124200000.
begin;

create table private.look_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  version_id uuid not null,
  decision text not null check (decision in ('save','pass')),
  -- The decision itself put the look in the Closet: undoing it takes the look out again.
  created_save boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id,version_id),
  foreign key (user_id,version_id) references private.look_versions(user_id,id) on delete cascade
);
create index look_decisions_version on private.look_decisions(version_id);
create table private.saved_pieces (
  user_id uuid not null references public.profiles(id) on delete cascade,
  piece_key text not null check (length(piece_key) between 1 and 200),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=8192),
  created_at timestamptz not null default now(),
  primary key (user_id,piece_key)
);
alter table private.look_decisions enable row level security;
alter table private.saved_pieces enable row level security;
revoke all on private.look_decisions,private.saved_pieces from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;

-- Keeps the image and the pieces of one generated version. Returns true when it was not saved before.
create function private.keep_look_version(p_user uuid,p_version uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v private.look_versions%rowtype; declare saved uuid;
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  select * into v from private.look_versions where id=p_version and user_id=p_user;
  if not found then raise exception 'look unavailable' using errcode='42501'; end if;
  update private.assets set expires_at=null where id=v.asset_id and user_id=p_user and kind='generated_look' and state='ready'
    and (expires_at is null or expires_at>clock_timestamp());
  if not found then raise exception 'image expired' using errcode='42501'; end if;
  insert into private.saved_looks(user_id,job_id,asset_id,snapshot) values(p_user,v.job_id,v.asset_id,jsonb_build_object('version_id',v.id))
    on conflict (user_id,asset_id) do nothing returning id into saved;
  if saved is null then return false; end if;
  insert into private.saved_look_products(user_id,look_id,product_id)
    select distinct p_user,saved,x.product_id from (
      select v.product_id union select i.product_id from private.look_version_items i where i.version_id=v.id) x(product_id)
    where exists(select 1 from public.products p where p.id=x.product_id) on conflict do nothing;
  return true;
end $$;
create function private.drop_saved_look(p_user uuid,p_version uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v private.look_versions%rowtype;
begin
  select * into v from private.look_versions where id=p_version and user_id=p_user;
  if not found then return false; end if;
  delete from private.saved_looks where user_id=p_user and asset_id=v.asset_id;
  if not found then return false; end if;
  -- Back to the normal life of a generated image: 168 hours from its creation (older ones end now).
  update private.assets set expires_at=created_at+interval '168 hours' where id=v.asset_id and user_id=p_user and kind='generated_look' and state='ready';
  return true;
end $$;

create function private.set_saved_look(p_user uuid,p_version uuid,p_saved boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.look_versions where id=p_version and user_id=p_user) then raise exception 'look unavailable' using errcode='42501'; end if;
  if p_saved then perform private.keep_look_version(p_user,p_version);
  else
    perform private.drop_saved_look(p_user,p_version);
    update private.look_decisions set created_save=false where user_id=p_user and version_id=p_version;
  end if;
  return true;
end $$;

create function private.decide_look(p_user uuid,p_version uuid,p_decision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare fresh boolean := false; declare found_id uuid;
begin
  if p_decision is null or p_decision not in ('save','pass') then raise exception 'invalid decision' using errcode='23514'; end if;
  if p_decision='save' then fresh := private.keep_look_version(p_user,p_version);
  elsif not exists(select 1 from private.look_versions where id=p_version and user_id=p_user) then raise exception 'look unavailable' using errcode='42501'; end if;
  -- The same decision sent twice (double tap, lost answer) is one decision.
  insert into private.look_decisions as d (user_id,version_id,decision,created_save) values(p_user,p_version,p_decision,fresh)
    on conflict (user_id,version_id) do update set decision=excluded.decision,created_save=d.created_save or excluded.created_save returning id into found_id;
  return found_id;
end $$;
create function private.undo_look_decision(p_user uuid,p_decision uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.look_decisions%rowtype;
begin
  delete from private.look_decisions where id=p_decision and user_id=p_user returning * into d;
  if not found then return false; end if;
  if d.created_save then perform private.drop_saved_look(p_user,d.version_id); end if;
  return true;
end $$;

-- Newest version of each look, still with its image and not decided yet. A requested look comes first.
create function private.list_match_deck(p_user uuid,p_first uuid,p_limit integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(x.id order by x.first desc,x.created_at desc),'[]'::jsonb) from (
    select v.id,v.created_at,(v.id is not distinct from p_first) as first from private.look_versions v
    join private.assets a on a.id=v.asset_id and a.user_id=v.user_id and a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())
    where v.user_id=p_user
      and not exists(select 1 from private.look_versions n where n.look_id=v.look_id and n.version>v.version)
      and not exists(select 1 from private.look_decisions d where d.user_id=p_user and d.version_id=v.id)
      and not exists(select 1 from private.saved_looks s where s.user_id=p_user and s.asset_id=v.asset_id)
    order by 3 desc,v.created_at desc limit least(greatest(p_limit,1),50)) x;
$$;
create function private.list_saved_looks(p_user uuid,p_limit integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('version_id',x.version_id,'saved_at',x.created_at) order by x.created_at desc),'[]'::jsonb) from (
    select v.id as version_id,s.created_at from private.saved_looks s join private.look_versions v on v.asset_id=s.asset_id and v.user_id=s.user_id
    join private.assets a on a.id=s.asset_id and a.state='ready' and (a.expires_at is null or a.expires_at>clock_timestamp())
    where s.user_id=p_user order by s.created_at desc limit least(greatest(p_limit,1),100)) x;
$$;

create function private.set_saved_piece(p_user uuid,p_key text,p_snapshot jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_user and deletion_state='active' for update;
  if not found then raise exception 'account unavailable' using errcode='42501'; end if;
  if p_snapshot is null then
    delete from private.saved_pieces where user_id=p_user and piece_key=p_key;
    return false;
  end if;
  if (select count(*) from private.saved_pieces where user_id=p_user and piece_key<>p_key)>=300 then raise exception 'closet full' using errcode='23514'; end if;
  insert into private.saved_pieces(user_id,piece_key,snapshot) values(p_user,p_key,p_snapshot)
    on conflict (user_id,piece_key) do update set snapshot=excluded.snapshot;
  return true;
end $$;
create function private.list_saved_pieces(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key',piece_key,'snapshot',snapshot,'saved_at',created_at) order by created_at desc),'[]'::jsonb)
  from private.saved_pieces where user_id=p_user;
$$;

create or replace function private.server_boundary_version() returns text
language sql immutable security invoker set search_path = '' as $$ select '20261124210000'::text $$;
revoke all on function private.keep_look_version(uuid,uuid),private.drop_saved_look(uuid,uuid),private.set_saved_look(uuid,uuid,boolean),
  private.decide_look(uuid,uuid,text),private.undo_look_decision(uuid,uuid),private.list_match_deck(uuid,uuid,integer),private.list_saved_looks(uuid,integer),
  private.set_saved_piece(uuid,text,jsonb),private.list_saved_pieces(uuid) from public,anon,authenticated,service_role,stylai_api,stylai_ai_worker;
grant execute on function private.set_saved_look(uuid,uuid,boolean),private.decide_look(uuid,uuid,text),private.undo_look_decision(uuid,uuid),
  private.list_match_deck(uuid,uuid,integer),private.list_saved_looks(uuid,integer),private.set_saved_piece(uuid,text,jsonb),private.list_saved_pieces(uuid) to stylai_api;
commit;
