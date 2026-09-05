-- Moving an item between lists, as configuration rather than code.
--
-- Two of the TV behaviours are really the same idea: starting a show moves it
-- from Want to watch into Watching now, and finishing one moves it into
-- Watched. Rather than teach the app about television, a list can say where a
-- promoted item goes and where a ticked item goes. Any future pair of lists
-- gets the same behaviour by filling in these columns.

alter table public.lists
  -- The list a "Start watching" style button moves an item to.
  add column if not exists promote_to uuid references public.lists (id) on delete set null,
  add column if not exists promote_label text,
  -- The list a ticked item moves to, e.g. Watching now -> Watched.
  add column if not exists done_to uuid references public.lists (id) on delete set null;

do $$
declare
  h record;
  watching uuid;
  want uuid;
  watched uuid;
begin
  for h in select id from public.households loop
    -- SELECT INTO leaves the variable null when nothing matches, so a
    -- household that renamed or deleted a list is simply skipped.
    select id into watching from public.lists
      where household_id = h.id and name = 'Watching now' limit 1;
    select id into want from public.lists
      where household_id = h.id and name = 'Want to watch' limit 1;
    select id into watched from public.lists
      where household_id = h.id and name = 'Watched' limit 1;

    if want is not null and watching is not null then
      update public.lists
      set promote_to = watching, promote_label = 'Start watching'
      where id = want;
    end if;

    if watching is not null and watched is not null then
      update public.lists set done_to = watched where id = watching;
    end if;
  end loop;
end $$;
