-- Photos and documents on items.
--
-- Files live in a private Storage bucket, never a public one: every read goes
-- through a short-lived signed link, and only someone who can see the item can
-- get one. A file belongs to whichever items an item_attachments row ties it
-- to, which is how one photo of a list can sit on every item read from it
-- without being stored once per item.
--
-- Paths are "<household id>/<random id>.<ext>". The random part is what the
-- app shows nobody; the household part is what upload permission is checked
-- against.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------
--
-- The size and type limits are enforced by Storage itself, whatever the app
-- sends. No HTML or SVG: a file that a browser would run as a page has no
-- business being on a to-do item.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760, -- 10 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Which files are on which items
-- ---------------------------------------------------------------------------

create table if not exists public.item_attachments (
  id uuid primary key default gen_random_uuid(),
  -- Deleting an item takes its rows with it. The file itself is removed by the
  -- app, since Storage objects can't be deleted from SQL.
  item_id uuid not null references public.items (id) on delete cascade,
  path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (item_id, path)
);

create index if not exists item_attachments_item_id_idx on public.item_attachments (item_id);
create index if not exists item_attachments_path_idx on public.item_attachments (path);

-- Same rule as items: you can use an item if you can use its list.
create or replace function public.can_use_item(check_item uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.items i
    where i.id = check_item and public.can_use_list(i.list_id)
  );
$$;

grant execute on function public.can_use_item(uuid) to authenticated;

-- Whether a file may be tied to another item: it has to sit under your own
-- household, and no item you can't see may already have it. Without the second
-- part, someone could tie a file from another person's private list to a
-- shared item and read it from there.
create or replace function public.can_link_attachment(object_path text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    split_part(object_path, '/', 1) in (select h::text from public.my_household_ids() h)
    and not exists (
      select 1 from public.item_attachments a
      where a.path = object_path and not public.can_use_item(a.item_id)
    );
$$;

grant execute on function public.can_link_attachment(text) to authenticated;

alter table public.item_attachments enable row level security;

create policy "See attachments on items you can use"
  on public.item_attachments for select
  using (public.can_use_item(item_id));

create policy "Attach files to items you can use"
  on public.item_attachments for insert
  with check (
    public.can_use_item(item_id)
    and created_by = auth.uid()
    and public.can_link_attachment(path)
  );

create policy "Remove attachments from items you can use"
  on public.item_attachments for delete
  using (public.can_use_item(item_id));

-- No update policy: an attachment is added or removed, never rewritten.

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------
--
-- Reading a file needs an attachment row on an item you can use, so a private
-- list's photos stay private even from the rest of the household.

create or replace function public.can_read_attachment(object_path text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.item_attachments a
    where a.path = object_path and public.can_use_item(a.item_id)
  );
$$;

-- Removing a file: never while any item still has it, and then only your
-- household's files or ones you uploaded. The app deletes the attachment rows
-- first and the file after, so a file shared by several items (a photographed
-- list) stays until the last of them lets go of it.
create or replace function public.can_remove_attachment(object_path text, object_owner text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    not exists (
      select 1 from public.item_attachments a where a.path = object_path
    )
    and (
      object_owner = auth.uid()::text
      or split_part(object_path, '/', 1) in (select h::text from public.my_household_ids() h)
    );
$$;

grant execute on function public.can_read_attachment(text) to authenticated;
grant execute on function public.can_remove_attachment(text, text) to authenticated;

-- The second half covers a file no item has any more. Storage only deletes
-- what the caller can also read, so without it the app couldn't clean up a
-- file after removing its last attachment row.
create policy "Read attachments on items you can use"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.can_read_attachment(name)
      or public.can_remove_attachment(name, owner_id)
    )
  );

create policy "Upload attachments to your household"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (select h::text from public.my_household_ids() h)
  );

create policy "Remove attachments you can use"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and public.can_remove_attachment(name, owner_id));
