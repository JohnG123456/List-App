-- Managing the household from the app instead of from SQL.
--
-- Adding someone needs a lookup in auth.users, which the browser cannot see and
-- should not be able to. These functions run as their owner so they can do that
-- one lookup, while each checks that the caller actually owns a household and
-- only ever touches that household.

-- Who is in the household, with their email, so the settings screen can show
-- people by name rather than as anonymous rows.
create or replace function public.household_member_emails()
returns table (user_id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.email::text
  from auth.users u
  join public.household_members m on m.user_id = u.id
  where m.household_id in (select public.my_household_ids());
$$;

create or replace function public.add_household_member(member_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  my_household uuid;
  target_user uuid;
  old_household uuid;
begin
  select household_id into my_household
  from public.household_members
  where user_id = auth.uid() and is_owner
  limit 1;

  if my_household is null then
    raise exception 'Only a household owner can add people';
  end if;

  select id into target_user
  from auth.users
  where lower(email) = lower(trim(member_email))
  limit 1;

  if target_user is null then
    raise exception 'No account with that email yet. They need to sign up first.';
  end if;

  if exists (
    select 1 from public.household_members
    where household_id = my_household and user_id = target_user
  ) then
    return target_user;
  end if;

  -- Anything they already had comes with them. Moving the lists first means a
  -- private to-do list they had built up isn't stranded in a household nobody
  -- is left in, which is what deleting the membership on its own would do.
  for old_household in
    select household_id from public.household_members where user_id = target_user
  loop
    update public.lists set household_id = my_household where household_id = old_household;
    delete from public.household_members
    where household_id = old_household and user_id = target_user;
    delete from public.households h
    where h.id = old_household
      and not exists (
        select 1 from public.household_members m where m.household_id = h.id
      );
  end loop;

  insert into public.household_members (household_id, user_id, is_owner)
  values (my_household, target_user, false);

  return target_user;
end;
$$;

create or replace function public.remove_household_member(member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_household uuid;
begin
  select household_id into my_household
  from public.household_members
  where user_id = auth.uid() and is_owner
  limit 1;

  if my_household is null then
    raise exception 'Only a household owner can remove people';
  end if;

  if member_user_id = auth.uid() then
    raise exception 'You cannot remove yourself from your own household';
  end if;

  delete from public.household_members
  where household_id = my_household
    and user_id = member_user_id
    and not is_owner;
end;
$$;

grant execute on function public.household_member_emails() to authenticated;
grant execute on function public.add_household_member(text) to authenticated;
grant execute on function public.remove_household_member(uuid) to authenticated;
