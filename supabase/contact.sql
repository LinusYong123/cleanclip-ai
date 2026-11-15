-- Run once in the Supabase SQL editor.
create table public.contact_messages (
  id bigint generated always as identity primary key,
  name text not null, email text not null, message text not null,
  created_at timestamptz default now()
);
alter table public.contact_messages enable row level security; -- only the service role can write/read
