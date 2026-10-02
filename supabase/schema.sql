-- TCGEngrave database setup for Supabase.
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
              check (status in ('pending', 'payment_submitted', 'paid', 'in_production', 'shipped', 'completed', 'cancelled')),
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
grant select on public.orders to authenticated;
revoke insert on public.orders from authenticated;
-- The server's admin Orders page uses the service_role key, which also needs explicit access here.
grant select, insert, update, delete on public.profiles, public.orders to service_role;

-- Customers can't create, edit or delete orders directly. The site's server places orders (it works
-- out every price itself, so prices can't be altered in the browser); status changes are made by you.
drop policy if exists "Orders: place own" on public.orders;

-- ─── Custom design artwork (Storage) ────────────────────────────────────────────────────
-- Customers' own artwork for custom-design orders, uploaded at checkout to
-- custom-art/<customer id>/<cart line id>.<ext>. The order line's art_path says which file.
-- Private: only you (in the dashboard, Storage → custom-art) and the customer who uploaded it can see it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custom-art', 'custom-art', false, 26214400, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Custom art: upload own" on storage.objects;
create policy "Custom art: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'custom-art' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Custom art: read own" on storage.objects;
create policy "Custom art: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'custom-art' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─── Checkout delivery details ──────────────────────────────────────────────────────────
-- Entered on the cart page at checkout. Saved on the order, and on the customer's profile so the
-- form is filled in next time. contact is the Telegram username (without @) or Gmail address.
alter table public.profiles
  add column if not exists contact_method text check (contact_method in ('telegram', 'gmail')),
  add column if not exists contact        text,
  add column if not exists address        text,
  add column if not exists unit_number    text,
  add column if not exists postal_code    text;

alter table public.orders
  add column if not exists contact_method text check (contact_method in ('telegram', 'gmail')),
  add column if not exists contact        text,
  add column if not exists customer_name  text,
  add column if not exists phone          text,
  add column if not exists address        text,
  add column if not exists unit_number    text,
  add column if not exists postal_code    text,
  add column if not exists shipping_fee   numeric(10, 2) not null default 0 check (shipping_fee >= 0),
  add column if not exists total          numeric(10, 2) check (total >= 0);

-- ─── PayNow payment proof ───────────────────────────────────────────────────────────────
-- After checkout, customers pay by scanning the shop's PayNow QR code and upload a screenshot of the
-- payment. The order then moves to 'payment_submitted' until you check it and set it to 'paid'.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'payment_submitted', 'paid', 'in_production', 'shipped', 'completed', 'cancelled'));

alter table public.orders
  add column if not exists payment_proof_path   text,
  add column if not exists payment_submitted_at timestamptz;

-- Screenshots are stored privately at payment-proofs/<customer id>/<file>. Only you (Storage →
-- payment-proofs, or the admin Orders page) and the customer who uploaded one can see it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Payment proofs: upload own" on storage.objects;
create policy "Payment proofs: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Payment proofs: read own" on storage.objects;
create policy "Payment proofs: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─── Admin accounts ─────────────────────────────────────────────────────────────────────
-- The admin pages (Manage designs, Orders, Messages) only work for admin accounts: a normal site
-- account (signed up and email-confirmed) marked with role "admin". Accounts can't give themselves
-- this role. Run these lines by hand, changing the email:
--
-- Make an account an admin:
--   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
--   where email = 'admin@example.com';
--
-- Remove an admin:
--   update auth.users set raw_app_meta_data = raw_app_meta_data - 'role'
--   where email = 'admin@example.com';
--
-- List the admins:
--   select email from auth.users where raw_app_meta_data ->> 'role' = 'admin';
