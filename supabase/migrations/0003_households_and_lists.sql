-- Multiple lists, shared within a household.
--
-- Before this migration every task belonged to a single user. After it, every
-- item belongs to a *list*, every list belongs to a *household*, and a
-- household holds one or more people plus the settings they share (streaming
-- services, viewing profiles, the order of the aisles in their supermarket).
--
-- A list is shared with the whole household unless `private_to` names one
-- person, which is how a private to-do list sits alongside a shared grocery
-- list without a second sharing mechanism.
--
-- Run this AFTER taking a database export. It renames a table, rewrites every
-- row-level security policy, and backfills existing rows.

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Home',
  -- Settings the household shares. The app snaps dictated service names to
  -- this list so "Apple TV", "AppleTV" and "Apple TV+" stay one service.
  services text[] not null default array[
    'Netflix', 'Stan', 'Binge', 'Disney+', 'Apple TV+', 'Prime Video'
  ],
  profiles text[] not null default array['Ours'],
  aisle_order text[] not null default array[
    'Produce', 'Bakery', 'Meat', 'Deli', 'Dairy', 'Frozen', 'Pantry', 'Drinks', 'Household'
  ],
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Shown against items on shared lists, so you can see who added or ticked
  -- something. Falls back to initials derived from the email if left null.
  initials text,
  -- The owner manages membership and the sign-up allow-list.
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_id_idx
  on public.household_members (user_id);

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  -- The label on the pill. Several lists can share one group name, which is
  -- how "Watching now" and "Want to watch" appear as sections under one TV
  -- pill rather than as two separate pills.
  group_name text not null,
  position int not null default 0,
  -- Null means shared with the whole household.
  private_to uuid references auth.users (id) on delete cascade,
  -- How the list arranges itself, and how it behaves. Per-list behaviour is
  -- data rather than code, so a new list needs no new rendering path.
  group_by text check (group_by in ('service', 'aisle')),
  auto_clear boolean not null default false,
  show_done boolean not null default false,
  is_archive boolean not null default false,
  kind text not null default 'general' check (kind in ('general', 'shop', 'watch')),
  created_at timestamptz not null default now()
);

create index if not exists lists_household_position_idx
  on public.lists (household_id, position);

-- ---------------------------------------------------------------------------
-- Items (was: tasks)
-- ---------------------------------------------------------------------------

-- The old policies name user_id, so they have to go before the column does.
drop policy if exists "Users can select their own tasks" on public.tasks;
drop policy if exists "Users can insert their own tasks" on public.tasks;
drop policy if exists "Users can update their own tasks" on public.tasks;
drop policy if exists "Users can delete their own tasks" on public.tasks;

alter table public.tasks rename to items;
alter table public.items rename column user_id to created_by;
alter index if exists tasks_user_id_created_at_idx rename to items_created_by_created_at_idx;

alter table public.items
  add column if not exists list_id uuid references public.lists (id) on delete cascade,
  add column if not exists done_by uuid references auth.users (id) on delete set null,
  add column if not exists done_at timestamptz,
  -- Grocery detail.
  add column if not exists qty text,
  add column if not exists aisle text,
  -- Watchlist detail. `service` is snapped to households.services at capture.
  add column if not exists service text,
  add column if not exists progress text,
  add column if not exists profile text,
  add column if not exists suggested_by text,
  -- Snoozed until this time: out of the list and out of the count, not done.
  add column if not exists hidden_until timestamptz,
  -- "Clear bought" sets this rather than deleting, so the archive can teach
  -- the app what you buy most weeks.
  add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------------
-- Backfill: one household per existing user, holding their existing tasks
-- ---------------------------------------------------------------------------
--
-- Everyone with an account gets their own household so nobody is left without
-- one. Joining two people into a single household is a deliberate step, not
-- something a migration should guess at — see README, "Sharing lists with
-- someone else".

do $$
declare
  u record;
  new_household uuid;
  todo_list uuid;
begin
  for u in
    select au.id
    from auth.users au
    where not exists (
      select 1 from public.household_members hm where hm.user_id = au.id
    )
  loop
    insert into public.households (name) values ('Home')
    returning id into new_household;

    insert into public.household_members (household_id, user_id, is_owner)
    values (new_household, u.id, true);

    -- The list every existing task moves into. Private, because a to-do list
    -- carrying work items is not something to share by default.
    insert into public.lists
      (household_id, name, group_name, position, private_to, kind, show_done)
    values
      (new_household, 'To do', 'To do', 0, u.id, 'general', false)
    returning id into todo_list;

    -- Seeded empty and shared. They stay invisible until something is put in
    -- them, so this migration changes nothing on screen.
    insert into public.lists
      (household_id, name, group_name, position, group_by, auto_clear, kind)
    values
      (new_household, 'Groceries', 'Groceries', 1, 'aisle', true, 'shop');

    insert into public.lists
      (household_id, name, group_name, position, group_by, kind, show_done)
    values
      (new_household, 'Watching now',  'TV', 2, 'service', 'watch', false),
      (new_household, 'Want to watch', 'TV', 3, 'service', 'watch', false);

    insert into public.lists
      (household_id, name, group_name, position, kind, is_archive, show_done)
    values
      (new_household, 'Watched', 'TV', 4, 'watch', true, true);

    update public.items
    set list_id = todo_list
    where created_by = u.id and list_id is null;
  end loop;
end $$;

-- Every item now belongs to a list, and must from here on.
alter table public.items alter column list_id set not null;

create index if not exists items_list_id_idx on public.items (list_id);

-- ---------------------------------------------------------------------------
-- Security helpers
-- ---------------------------------------------------------------------------
--
-- These are SECURITY DEFINER on purpose. A policy on household_members that
-- queried household_members would recurse forever; running the lookup as the
-- function owner sidesteps the policy while still only ever answering about
-- the caller's own membership.

create or replace function public.my_household_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;

create or replace function public.can_use_list(check_list uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.lists l
    join public.household_members m
      on m.household_id = l.household_id
     and m.user_id = auth.uid()
    where l.id = check_list
      and (l.private_to is null or l.private_to = auth.uid())
  );
$$;

create or replace function public.is_household_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where user_id = auth.uid() and is_owner
  );
$$;

grant execute on function public.my_household_ids() to authenticated;
grant execute on function public.can_use_list(uuid) to authenticated;
grant execute on function public.is_household_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.lists enable row level security;

create policy "Members can see their household"
  on public.households for select
  using (id in (select public.my_household_ids()));

create policy "Owners can update their household"
  on public.households for update
  using (id in (select public.my_household_ids()) and public.is_household_owner())
  with check (id in (select public.my_household_ids()));

create policy "Members can see who else is in the household"
  on public.household_members for select
  using (household_id in (select public.my_household_ids()));

create policy "Owners can add members"
  on public.household_members for insert
  with check (
    household_id in (select public.my_household_ids())
    and public.is_household_owner()
  );

create policy "Members can update their own row"
  on public.household_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Owners can remove members"
  on public.household_members for delete
  using (
    household_id in (select public.my_household_ids())
    and public.is_household_owner()
  );

-- A list is visible to the household unless it is private to someone else.
create policy "Members can see household lists"
  on public.lists for select
  using (
    household_id in (select public.my_household_ids())
    and (private_to is null or private_to = auth.uid())
  );

create policy "Members can create lists"
  on public.lists for insert
  with check (
    household_id in (select public.my_household_ids())
    and (private_to is null or private_to = auth.uid())
  );

create policy "Members can update lists they can see"
  on public.lists for update
  using (
    household_id in (select public.my_household_ids())
    and (private_to is null or private_to = auth.uid())
  )
  with check (
    household_id in (select public.my_household_ids())
    and (private_to is null or private_to = auth.uid())
  );

create policy "Members can delete lists they can see"
  on public.lists for delete
  using (
    household_id in (select public.my_household_ids())
    and (private_to is null or private_to = auth.uid())
  );

-- Items inherit their visibility entirely from their list.
create policy "See items on lists you can use"
  on public.items for select
  using (public.can_use_list(list_id));

create policy "Add items to lists you can use"
  on public.items for insert
  with check (public.can_use_list(list_id) and created_by = auth.uid());

create policy "Change items on lists you can use"
  on public.items for update
  using (public.can_use_list(list_id))
  with check (public.can_use_list(list_id));

create policy "Remove items from lists you can use"
  on public.items for delete
  using (public.can_use_list(list_id));

-- ---------------------------------------------------------------------------
-- Sign-up allow-list: household owner instead of a hardcoded email
-- ---------------------------------------------------------------------------

drop policy if exists "Admin can view allowlist" on public.allowed_emails;
drop policy if exists "Admin can add to allowlist" on public.allowed_emails;
drop policy if exists "Admin can remove from allowlist" on public.allowed_emails;

create policy "Household owners can view the allowlist"
  on public.allowed_emails for select
  using (public.is_household_owner());

create policy "Household owners can add to the allowlist"
  on public.allowed_emails for insert
  with check (public.is_household_owner());

create policy "Household owners can remove from the allowlist"
  on public.allowed_emails for delete
  using (public.is_household_owner());
