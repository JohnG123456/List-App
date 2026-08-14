-- Invite-only sign-up: only emails in this table may create an account.
-- The app's admin (below) is the only one who can view or manage it.
--
-- IMPORTANT: the admin email is hardcoded in this file's RLS policies and
-- separately in src/app/page.tsx (ADMIN_EMAIL). If it ever changes, update
-- both places.
create table if not exists public.allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists allowed_emails_email_lower_idx
  on public.allowed_emails (lower(email));

alter table public.allowed_emails enable row level security;

create policy "Admin can view allowlist"
  on public.allowed_emails for select
  using (auth.jwt() ->> 'email' = 'john@greenborough.com.au');

create policy "Admin can add to allowlist"
  on public.allowed_emails for insert
  with check (auth.jwt() ->> 'email' = 'john@greenborough.com.au');

create policy "Admin can remove from allowlist"
  on public.allowed_emails for delete
  using (auth.jwt() ->> 'email' = 'john@greenborough.com.au');

-- Seed the admin's own email so they aren't locked out of their own app.
insert into public.allowed_emails (email)
values ('john@greenborough.com.au')
on conflict do nothing;

-- Lets the (unauthenticated) login screen check whether an email may sign
-- up without exposing the rest of the allow-list — SECURITY DEFINER runs
-- as the function owner, bypassing the RLS policies above, but the
-- function itself only ever returns a single true/false.
create or replace function public.is_email_allowed(check_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(check_email)
  );
$$;

grant execute on function public.is_email_allowed(text) to anon, authenticated;
