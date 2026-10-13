-- Which day of the week a show's new episodes come out, for shows still airing.
--
-- A weekday rather than a date: a weekly show drops on the same day every
-- week, so "Thursday" stays true all season where a date is stale in seven
-- days. Null means unknown, finished, or released all at once.

alter table public.items
  add column if not exists airs_on text;

alter table public.items drop constraint if exists items_airs_on_check;
alter table public.items
  add constraint items_airs_on_check
  check (airs_on in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'));
