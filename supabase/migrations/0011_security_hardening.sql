-- Closing the gaps an outsider, or a household member, could use to get past
-- what the app's screens allow.

-- ---------------------------------------------------------------------------
-- Sign-up allow-list, enforced by Supabase Auth itself
-- ---------------------------------------------------------------------------
--
-- Until now the allow-list was only checked by the login page. The anon key is
-- in every browser that loads the app, so anyone could call Supabase's sign-up
-- API directly and create an account with any email. This function is a
-- "Before User Created" auth hook: Supabase calls it before creating any
-- account, and an email that isn't on the list is refused there.
--
-- It does nothing until it's switched on: Supabase dashboard ->
-- Authentication -> Hooks -> Before User Created -> Postgres function ->
-- public.hook_before_user_created.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_email text := event -> 'user' ->> 'email';
begin
  if new_email is not null and exists (
    select 1 from public.allowed_emails where lower(email) = lower(new_email)
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email hasn''t been given access to this app.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Household membership rows: initials only
-- ---------------------------------------------------------------------------
--
-- "Members can update their own row" let a member change any column of their
-- own row, including is_owner (making themselves an owner, who can then manage
-- the sign-up list and the household) and household_id (moving themselves into
-- another household whose id they had). Initials are the only thing the app
-- ever changes here; ownership and membership go through the owner-checked
-- functions in 0005, which run as their owner and are unaffected by this.

revoke update on public.household_members from anon, authenticated;
grant update (initials) on public.household_members to authenticated;
