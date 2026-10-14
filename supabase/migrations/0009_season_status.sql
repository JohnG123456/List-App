-- Where a show's current season is up to, filled in by "Find release days".
--
-- latest_episode is the newest episode available, e.g. "S2 E5", in the same
-- shape as progress so the two read side by side. all_released means the
-- whole season is out to binge, as opposed to one a week (airs_on).

alter table public.items
  add column if not exists latest_episode text,
  add column if not exists all_released boolean not null default false;
