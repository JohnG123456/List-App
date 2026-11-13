-- A "Didn't like" shelf on the TV pill, for shows tried and given up on.
--
-- It is a second archive beside Watched, so it needs no new behaviour: like
-- Watched, it stays folded away until opened, is left out of Pick something
-- and Find release days, and is still searched by "Have we watched this?".
-- Moving a show into it marks it done, the same as moving into Watched.
--
-- Safe to run more than once: a household that already has the list, or has
-- no TV pill, is skipped.

do $$
declare
  h record;
  tv_group text;
  next_position int;
begin
  for h in select id from public.households loop
    if exists (
      select 1 from public.lists
      where household_id = h.id and name = 'Didn''t like'
    ) then
      continue;
    end if;

    -- Whatever the TV pill is called now, found by its watch lists.
    select group_name into tv_group from public.lists
      where household_id = h.id and kind = 'watch'
      order by position limit 1;

    if tv_group is null then
      continue;
    end if;

    select coalesce(max(position), 0) + 1 into next_position
      from public.lists where household_id = h.id;

    insert into public.lists
      (household_id, name, group_name, position, kind, is_archive, show_done)
    values
      (h.id, 'Didn''t like', tv_group, next_position, 'watch', true, true);
  end loop;
end $$;
