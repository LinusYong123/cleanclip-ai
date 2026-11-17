-- Run in the Supabase SQL editor.
create table public.users (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  stripe_customer_id text,
  created_at timestamptz default now()
);
create table public.subscriptions (
  user_id uuid primary key references public.users on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','elite')),
  interval text check (interval in ('month','year')),
  status text not null default 'active',
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_used boolean not null default false,
  trial_ends_at timestamptz,
  bonus_searches integer not null default 0,
  cancel_at_period_end boolean not null default false
);
create table public.searches_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users on delete cascade,
  source text not null,             -- YouTube URL or uploaded file name
  result jsonb,
  created_at timestamptz default now()
);
create index on public.searches_usage (user_id, created_at desc);

-- Row Level Security: users only read their own rows.
alter table public.users enable row level security;
alter table public.subscriptions enable row level security;
alter table public.searches_usage enable row level security;
create policy "own user" on public.users for select using (auth.uid() = id);
create policy "own sub" on public.subscriptions for select using (auth.uid() = user_id);
create policy "own usage" on public.searches_usage for select using (auth.uid() = user_id);
-- Inserts into searches_usage happen via the API route with the user's session:
create policy "own usage insert" on public.searches_usage for insert with check (auth.uid() = user_id);

-- Auto-create profile + free subscription on signup.
create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  insert into public.subscriptions (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
