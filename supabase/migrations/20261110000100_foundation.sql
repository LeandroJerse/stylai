-- Dedicated StylAI development project only. Inspect existing objects before hosted apply.
-- No destructive reset, sample catalog, payment state or public personal-photo access.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  deletion_state text not null default 'active' check (deletion_state in ('active', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_session_id uuid not null unique,
  cookie_hash text not null unique check (cookie_hash ~ '^[0-9a-f]{64}$'),
  token_payload_ciphertext text not null,
  key_version text not null,
  token_expires_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  refresh_lease_until timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);
create index app_sessions_user_id on private.app_sessions(user_id);
alter table public.profiles enable row level security;
alter table private.app_sessions enable row level security;
revoke all on public.profiles from public, anon, authenticated;
revoke all on private.app_sessions from public, anon, authenticated;
grant select, update(name) on public.profiles to authenticated;
grant all on public.profiles, private.app_sessions to service_role;

create function private.is_active_session() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.app_sessions s join public.profiles p on p.id = s.user_id
    where s.user_id = (select auth.uid())
      and s.provider_session_id::text = (select auth.jwt() ->> 'session_id')
      and s.revoked_at is null and s.expires_at > now() and p.deletion_state = 'active'
  );
$$;
revoke all on function private.is_active_session() from public, anon;
grant execute on function private.is_active_session() to authenticated;
create policy profiles_owner_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) and (select private.is_active_session()));
create policy profiles_owner_name_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_active_session()))
  with check (id = (select auth.uid()) and (select private.is_active_session()));

create function private.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, name)
  values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'name'), 80), ''), 'Nova conta'));
  return new;
end;
$$;
revoke all on function private.create_profile_for_auth_user() from public, anon, authenticated;
create trigger stylai_auth_user_created after insert on auth.users
  for each row execute function private.create_profile_for_auth_user();

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('aliexpress', 'shopee', 'tiktok_shop')),
  external_seller_id text not null,
  region text not null,
  name text not null check (length(btrim(name)) > 0),
  unique(source, region, external_seller_id)
);
create table public.categories (id text primary key, label text not null);
create table public.styles (id text primary key, label text not null);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  external_product_id text not null,
  category_id text references public.categories(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  price_minor bigint check (price_minor >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  availability text not null default 'unknown' check (availability in ('available', 'partial', 'unavailable', 'unknown')),
  published boolean not null default false,
  rights_cleared boolean not null default false,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_id, external_product_id)
);
create index products_public_newest on public.products(created_at desc, id desc) where published and rights_cleared;
create index products_partner_id on public.products(partner_id);
create index products_category_id on public.products(category_id);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  external_variant_id text not null,
  label text not null,
  available boolean,
  unique(product_id, id),
  unique(product_id, external_variant_id)
);
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid,
  url text not null check (url ~ '^https://[^[:space:]]+$'),
  alt text,
  position integer not null default 0 check (position >= 0),
  unique(product_id, position),
  foreign key (product_id, variant_id) references public.product_variants(product_id, id)
);
create table public.product_styles (
  product_id uuid not null references public.products(id) on delete cascade,
  style_id text not null references public.styles(id),
  primary key (product_id, style_id)
);

create function private.touch_updated_at() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
create trigger stylai_profile_updated before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger stylai_product_updated before update on public.products
  for each row execute function private.touch_updated_at();

alter table public.partners enable row level security;
alter table public.categories enable row level security;
alter table public.styles enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.product_styles enable row level security;
revoke all on public.partners, public.categories, public.styles, public.products, public.product_variants, public.product_images, public.product_styles from public, anon, authenticated;
grant select on public.partners, public.categories, public.styles, public.products, public.product_variants, public.product_images, public.product_styles to anon, authenticated;
grant all on public.partners, public.categories, public.styles, public.products, public.product_variants, public.product_images, public.product_styles to service_role;
create policy catalog_published on public.products for select to anon, authenticated using (published and rights_cleared);
-- Parent checks are evaluated under caller RLS; drafts/uncleared listings do not leak.
create policy catalog_partners on public.partners for select to anon, authenticated using (exists (select 1 from public.products p where p.partner_id = partners.id));
create policy catalog_categories on public.categories for select to anon, authenticated using (exists (select 1 from public.products p where p.category_id = categories.id));
create policy catalog_variants on public.product_variants for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_variants.product_id));
create policy catalog_images on public.product_images for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_images.product_id));
create policy catalog_style_links on public.product_styles for select to anon, authenticated using (exists (select 1 from public.products p where p.id = product_styles.product_id));
create policy catalog_styles on public.styles for select to anon, authenticated using (exists (select 1 from public.product_styles ps where ps.style_id = styles.id));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('body-photos', 'body-photos', false, 12582912, array['image/jpeg', 'image/png', 'image/webp']),
  ('references', 'references', false, 12582912, array['image/jpeg', 'image/png', 'image/webp']),
  ('generated-looks', 'generated-looks', false, 12582912, array['image/jpeg', 'image/png', 'image/webp']);
-- Restrictive guards cannot be bypassed by another permissive policy in this project.
-- Server-authorized signed asset delivery is added with the actual asset/consent workflow.
create policy stylai_private_asset_reads on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id not in ('body-photos', 'references', 'generated-looks'));
create policy stylai_private_asset_inserts on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('body-photos', 'references', 'generated-looks'));
create policy stylai_private_asset_updates on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id not in ('body-photos', 'references', 'generated-looks'))
  with check (bucket_id not in ('body-photos', 'references', 'generated-looks'));
create policy stylai_private_asset_deletes on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id not in ('body-photos', 'references', 'generated-looks'));

create function public.stylai_health() returns jsonb language sql stable security invoker
set search_path = pg_catalog as $$
  select jsonb_build_object('status', 'ok', 'schema_version', '20261110000100');
$$;
revoke all on function public.stylai_health() from public;
grant execute on function public.stylai_health() to anon, authenticated, service_role;
comment on function public.stylai_health() is 'Minimal database/schema readiness probe; does not certify auth, payments or full MVP readiness.';

notify pgrst, 'reload schema';

commit;
