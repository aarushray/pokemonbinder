-- PokeEngrave database setup for Supabase.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run again: it only creates what's missing and replaces the functions/policies.
--
-- Accounts themselves (email, hashed password) live in Supabase's built-in auth.users table,
-- shown under Authentication → Users. These tables hold everything else about a customer.

-- ─── Profiles: one row per customer, created automatically when they sign up ─────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  telegram    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Customers can see and edit only their own profile. (The dashboard can see everything.)
drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "Profiles: update own" on public.profiles;
create policy "Profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Fill in a profile from the sign-up form (name is sent as full_name).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep a profile's email in step if the customer changes it.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Accounts created before this script ran get a profile too.
insert into public.profiles (id, email, full_name)
select id, email, raw_user_meta_data ->> 'full_name' from auth.users
on conflict (id) do nothing;

-- ─── Orders: placed from the cart page by logged-in customers ───────────────────────────
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'paid', 'in_production', 'shipped', 'completed', 'cancelled')),
  -- [{ design_id, name, binder_type, color, color_name, unit_price, qty }]
  items       jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  item_count  integer not null check (item_count > 0),
  subtotal    numeric(10, 2) not null check (subtotal >= 0),
  currency    text not null default 'SGD',
  created_at  timestamptz not null default now()
);

create index if not exists orders_user_id_created_at on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;

-- Customers see only their own orders.
drop policy if exists "Orders: read own" on public.orders;
create policy "Orders: read own" on public.orders
  for select to authenticated using (user_id = auth.uid());

-- ─── Table access ───────────────────────────────────────────────────────────────────────
-- Logged-in customers may use these tables (the policies above/below still limit them to their
-- own rows). Visitors who aren't logged in get no access at all.
revoke all on public.profiles, public.orders from anon;
grant select, update on public.profiles to authenticated;
grant select, insert on public.orders to authenticated;

-- Customers can place orders for themselves, always starting as 'pending'.
-- They can't edit or delete orders; status changes are made by you in the dashboard.
drop policy if exists "Orders: place own" on public.orders;
create policy "Orders: place own" on public.orders
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
