-- Two things for "Find release days".
--
-- Which Claude model it uses, chosen in Settings like the rest. Null means the
-- app's default (Haiku 5.5); see src/lib/models.ts.
--
-- When each show was last looked up, so a show whose details can't have
-- changed since isn't searched again: a weekly show until its next release
-- day, a finished season for a month.

alter table public.households
  add column if not exists release_days_model text;

alter table public.items
  add column if not exists release_checked_at timestamptz;
