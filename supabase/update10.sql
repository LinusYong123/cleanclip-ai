-- Run once in the Supabase SQL editor to ensure existing databases have the billing fields.
alter table public.subscriptions
  add column if not exists current_period_start timestamptz,
  add column if not exists trial_used boolean not null default false,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists bonus_searches integer not null default 0,
  add column if not exists cancel_at_period_end boolean not null default false;
