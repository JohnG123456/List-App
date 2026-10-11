-- Which Claude model each AI feature uses, chosen per household in Settings.
--
-- Null means "use the app's default". The server only honours values on its
-- own allowlist (src/lib/models.ts), so a stale or unknown value here falls
-- back to the default instead of breaking capture.

alter table public.households
  add column if not exists capture_model text,
  add column if not exists pick_model text,
  add column if not exists read_photo_model text;
