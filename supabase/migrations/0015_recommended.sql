-- Shows you would recommend to friends, and a line on why.
--
-- A tag rather than a list: a recommended show stays wherever it already is
-- (usually Watched), so recommending one never moves it. The note is what
-- makes a shared list worth reading: "slow start, worth it by ep 3".

alter table public.items
  add column if not exists recommended boolean not null default false,
  add column if not exists recommend_note text;
