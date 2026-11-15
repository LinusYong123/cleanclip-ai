-- Run once in the Supabase SQL editor.
alter table public.subscriptions
  add column if not exists trial_used boolean not null default false,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists bonus_searches integer not null default 0;

create table if not exists public.survey_responses (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references public.users on delete cascade, -- one survey (and one reward) per user
  answers jsonb not null,
  created_at timestamptz default now()
);
alter table public.survey_responses enable row level security;
create policy "own survey" on public.survey_responses for select using (auth.uid() = user_id);
-- Read everyone's answers in the Supabase table editor (Table: survey_responses).
