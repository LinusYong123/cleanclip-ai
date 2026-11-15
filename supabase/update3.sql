-- Run once in the Supabase SQL editor.
alter table public.subscriptions add column if not exists current_period_start timestamptz;

-- Public bucket where frames are parked for a few seconds so Google Lens can fetch them (then deleted).
insert into storage.buckets (id, name, public) values ('frames', 'frames', true) on conflict do nothing;
