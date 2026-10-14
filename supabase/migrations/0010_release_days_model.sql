-- The Claude model "Find release days" uses, chosen in Settings like the rest.
-- Null means the app's default (Haiku 5.5); see src/lib/models.ts.

alter table public.households
  add column if not exists release_days_model text;
