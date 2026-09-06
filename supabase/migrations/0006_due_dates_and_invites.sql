-- Two things: telling today's jobs apart from this week's, and making the
-- difference between "allowed to sign up" and "in your household" visible.

-- ---------------------------------------------------------------------------
-- Due dates
-- ---------------------------------------------------------------------------
--
-- Not a reminder system, and deliberately not a star. A star flagged "today"
-- stays flagged tomorrow, and every to-do list where everything is starred is
-- a list where nothing is. A date sorts itself out as time passes.

alter table public.items
  add column if not exists due_on date;

-- Grouping by when something is due is just another way for a list to arrange
-- itself, alongside by streaming service and by supermarket aisle.
alter table public.lists drop constraint if exists lists_group_by_check;
alter table public.lists
  add constraint lists_group_by_check
  check (group_by in ('service', 'aisle', 'due'));

update public.lists
set group_by = 'due'
where kind = 'general' and group_by is null;

create index if not exists items_due_on_idx on public.items (due_on)
  where due_on is not null;

-- ---------------------------------------------------------------------------
-- Who has actually signed up
-- ---------------------------------------------------------------------------
--
-- Being on the sign-up allow-list and being in the household are two different
-- things, and the settings screen was showing only one of them. Someone
-- allowed to create an account but who hasn't yet cannot be added to a
-- household, which read as a bug rather than as a waiting invitation.

create or replace function public.household_invite_status()
returns table (email text, has_account boolean, in_household boolean)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.email,
    u.id is not null as has_account,
    exists (
      select 1
      from public.household_members m
      where m.user_id = u.id
        and m.household_id in (select public.my_household_ids())
    ) as in_household
  from public.allowed_emails a
  left join auth.users u on lower(u.email) = lower(a.email)
  where public.is_household_owner()
  order by a.created_at;
$$;

grant execute on function public.household_invite_status() to authenticated;
