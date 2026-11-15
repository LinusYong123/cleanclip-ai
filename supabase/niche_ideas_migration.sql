-- Niche ideas v2: no daily schedule, no delivery hour, same limits for every plan. Run once on an existing database.

-- Ideas now come in batches (one per reload), any number per day
alter table public.daily_recommendations drop constraint if exists daily_recommendations_user_id_recommended_on_rank_key;
alter table public.daily_recommendations drop constraint if exists daily_recommendations_rank_check;
alter table public.daily_recommendations add constraint daily_recommendations_rank_check check (rank between 1 and 50);
alter table public.daily_recommendations add column if not exists batch_id uuid;
alter table public.daily_recommendations add column if not exists batch_at timestamptz not null default now();
create index if not exists recs_user_batch on public.daily_recommendations (user_id, batch_at desc);

-- niche_preferences now only tracks reload limits
alter table public.niche_preferences
  add column if not exists last_reload_at timestamptz,
  add column if not exists reload_count_date date,
  add column if not exists reload_count integer not null default 0,
  drop column if exists delivery_hour,
  drop column if exists is_active,
  drop column if exists videos_per_day,
  drop column if exists timezone,
  drop column if exists platforms,
  drop column if exists last_curated_on;

-- YouTube search results shared between users (searches cost 100 quota units each). Service role only.
create table if not exists public.niche_search_cache (
  cache_key  text primary key,
  hits       jsonb not null,
  fetched_at timestamptz not null default now()
);
create index if not exists niche_search_cache_age on public.niche_search_cache (fetched_at);
alter table public.niche_search_cache enable row level security; -- no policies on purpose

-- Optional cleanup: these tables belonged to the old scheduled pipeline and are no longer used.
-- drop table if exists public.source_links, public.recommendation_traces, public.curation_runs cascade;
