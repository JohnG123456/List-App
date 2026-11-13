-- Who watches a show, for shows only one person in the household watches.
--
-- Null means watched together, which is most shows, so only the exceptions
-- need tagging. Otherwise it is one of the household's viewing profiles, e.g.
-- "Dawn". Kept apart from `profile`, which is whose streaming profile a show
-- is on: a show can be watched together on one person's profile.

alter table public.items
  add column if not exists watcher text;
