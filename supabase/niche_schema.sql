-- Daily Niche Inspiration: Phase 1 schema. Run once in the Supabase SQL editor.
-- Convention: users edit preferences/niches/channels; the pipeline (service role) writes everything else.

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 1. Reload bookkeeping: one row per user (same limits for every plan, see lib/niche/config.ts) ----
create table public.niche_preferences (
  user_id           uuid primary key references public.users on delete cascade,
  last_reload_at    timestamptz,
  reload_count_date date,                         -- UTC day the count belongs to
  reload_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 2. Niches: what the user types in ("tech reviews", "badminton tips") --------------------------
create table public.niches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users on delete cascade,
  label         text not null check (char_length(label) between 2 and 60),
  keywords      text[] not null check (cardinality(keywords) between 1 and 10),
  exclude_terms text[] not null default '{}' check (cardinality(exclude_terms) <= 10),
  language      text not null default 'en',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, label)
);
create index niches_user_active on public.niches (user_id) where is_active;

-- 3. Connected social accounts (OAuth). Tokens live in a separate, client-unreadable table -------
create table public.social_connections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users on delete cascade,
  platform         text not null check (platform in ('youtube','tiktok')),
  platform_user_id text not null,
  handle           text,
  display_name     text,
  avatar_url       text,
  scopes           text[] not null default '{}',
  status           text not null default 'active' check (status in ('active','expired','revoked','error')),
  last_synced_at   timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, platform, platform_user_id)
);

create table public.social_connection_secrets (
  connection_id     uuid primary key references public.social_connections on delete cascade,
  access_token_enc  text not null,   -- encrypted in the app (AES-GCM) before it is stored
  refresh_token_enc text,
  expires_at        timestamptz,
  updated_at        timestamptz not null default now()
);

-- 4. Channels used to find videos: the user's own, similar ones we discovered, or added by hand ----
create table public.niche_channels (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users on delete cascade,
  niche_id       uuid references public.niches on delete set null,
  connection_id  uuid references public.social_connections on delete set null,
  platform       text not null check (platform in ('youtube','tiktok')),
  channel_id     text not null,
  handle         text,
  title          text,
  thumbnail_url  text,
  subscriber_count bigint,
  source         text not null check (source in ('connected','similar','manual')),
  similarity     numeric(4,3) check (similarity between 0 and 1),
  is_blocked     boolean not null default false,          -- "don't recommend from this channel"
  discovered_at  timestamptz not null default now(),
  last_checked_at timestamptz,
  unique (user_id, platform, channel_id)
);
create index niche_channels_user_niche on public.niche_channels (user_id, niche_id);

-- 5. One row per user per day: makes the daily job idempotent and gives an audit trail -----------
create table public.curation_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users on delete cascade,
  run_date         date not null,
  status           text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  candidates_found integer not null default 0,
  selected         integer not null default 0,
  quota_units_used integer not null default 0,            -- YouTube API units spent
  error            text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  unique (user_id, run_date)
);

-- 6. Daily recommendation cards -------------------------------------------------------------
create table public.daily_recommendations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users on delete cascade,
  niche_id       uuid references public.niches on delete set null,
  run_id         uuid references public.curation_runs on delete set null,
  recommended_on date not null,                            -- the user's local date
  batch_id       uuid,                                     -- ideas created by one reload share a batch
  batch_at       timestamptz not null default now(),
  rank           smallint not null check (rank between 1 and 50),
  platform       text not null check (platform in ('youtube','tiktok')),
  video_id       text not null,
  url            text not null,
  title          text not null,
  channel_id     text,
  channel_title  text,
  thumbnail_url  text,
  published_at   timestamptz,
  duration_s     integer,
  view_count     bigint,
  like_count     bigint,
  trend_score    numeric(8,3),
  reason         text,                                     -- why it was picked, shown on the card
  matched_keywords text[] not null default '{}',
  trace_status   text not null default 'skipped' check (trace_status in ('queued','processing','ready','failed','skipped')),  -- denormalised from the latest trace for fast card loads
  is_saved       boolean not null default false,
  is_dismissed   boolean not null default false,
  viewed_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, recommended_on, platform, video_id)
);
create index recs_user_batch on public.daily_recommendations (user_id, batch_at desc);
create index recs_user_day on public.daily_recommendations (user_id, recommended_on desc, rank);
create index recs_pending on public.daily_recommendations (created_at) where trace_status in ('queued','processing');

-- 7. Reverse-search runs for a card (one row per attempt, so retries keep their history) ---------
create table public.recommendation_traces (
  id                uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.daily_recommendations on delete cascade,
  attempt           smallint not null default 1,
  status            text not null default 'queued' check (status in ('queued','processing','succeeded','failed')),
  classification    text,                                  -- e.g. 'Overlaid/Edited', 'Raw Clean Footage'
  frames_used       smallint,
  scene_summary     text,
  keywords          text[] not null default '{}',
  queries           jsonb,                                 -- { A, B, C }
  source_tracing    jsonb,                                 -- { found_handles, is_likely_original, next_search_queries, ... }
  primary_link_id   uuid,                                  -- FK added below
  clip_start_s      numeric,                               -- where the clip sits in the original
  clip_end_s        numeric,
  cost              jsonb,                                 -- { vision_calls, gemini_calls, serpapi_calls, youtube_units }
  error             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (recommendation_id, attempt)
);

-- 8. Source links found by a trace, each with its own health status ------------------------------
create table public.source_links (
  id              uuid primary key default gen_random_uuid(),
  trace_id        uuid not null references public.recommendation_traces on delete cascade,
  url             text not null,
  platform        text check (platform in ('youtube','tiktok','instagram','facebook','vimeo')),
  video_id        text,
  title           text,
  author          text,
  published_at    timestamptz,
  thumbnail_url   text,
  role            text not null default 'candidate' check (role in ('primary','candidate','compilation','creator_page')),
  score           smallint check (score between 0 and 100),
  confidence      text check (confidence in ('high','medium','low')),
  similarity      smallint check (similarity between 0 and 100),
  is_official     boolean not null default false,
  is_mirrored     boolean not null default false,
  found_via       text,                                    -- compilation URL or creator handle that led here
  link_status     text not null default 'unchecked' check (link_status in ('unchecked','live','unavailable','private','removed','error')),
  http_status     smallint,
  check_attempts  smallint not null default 0,
  last_checked_at timestamptz,
  unique (trace_id, url)
);
create index source_links_trace on public.source_links (trace_id);
create index source_links_recheck on public.source_links (last_checked_at nulls first) where link_status in ('unchecked','error');

alter table public.recommendation_traces
  add constraint traces_primary_link_fk foreign key (primary_link_id) references public.source_links (id) on delete set null;

-- updated_at triggers -----------------------------------------------------------------------
create trigger t_prefs before update on public.niche_preferences for each row execute function public.set_updated_at();
create trigger t_niches before update on public.niches for each row execute function public.set_updated_at();
create trigger t_conn before update on public.social_connections for each row execute function public.set_updated_at();
create trigger t_secrets before update on public.social_connection_secrets for each row execute function public.set_updated_at();

-- Row Level Security --------------------------------------------------------------------------
alter table public.niche_preferences       enable row level security;
alter table public.niches                  enable row level security;
alter table public.social_connections      enable row level security;
alter table public.social_connection_secrets enable row level security;  -- no policies: service role only
alter table public.niche_channels          enable row level security;
alter table public.curation_runs           enable row level security;
alter table public.daily_recommendations   enable row level security;
alter table public.recommendation_traces   enable row level security;
alter table public.source_links            enable row level security;

-- Users manage their own settings and niches
create policy "own prefs"  on public.niche_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own niches" on public.niches            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Connections: see and disconnect only. The OAuth callback (service role) creates and refreshes them.
create policy "own connections read"   on public.social_connections for select using (auth.uid() = user_id);
create policy "own connections delete" on public.social_connections for delete using (auth.uid() = user_id);

-- Channels: read, hide/unhide, and add by hand (manual only)
create policy "own channels read"   on public.niche_channels for select using (auth.uid() = user_id);
create policy "own channels add"    on public.niche_channels for insert with check (auth.uid() = user_id and source = 'manual');
create policy "own channels update" on public.niche_channels for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own channels delete" on public.niche_channels for delete using (auth.uid() = user_id);

-- Pipeline output is read-only for users. Saving/dismissing a card goes through an API route (service role).
create policy "own runs"    on public.curation_runs         for select using (auth.uid() = user_id);
create policy "own recs"    on public.daily_recommendations for select using (auth.uid() = user_id);
create policy "own traces"  on public.recommendation_traces for select using (
  exists (select 1 from public.daily_recommendations r where r.id = recommendation_id and r.user_id = auth.uid()));
create policy "own links"   on public.source_links         for select using (
  exists (select 1 from public.recommendation_traces t join public.daily_recommendations r on r.id = t.recommendation_id
          where t.id = trace_id and r.user_id = auth.uid()));

-- Shared YouTube search cache (service role only)
create table public.niche_search_cache (
  cache_key  text primary key,
  hits       jsonb not null,
  fetched_at timestamptz not null default now()
);
create index niche_search_cache_age on public.niche_search_cache (fetched_at);
alter table public.niche_search_cache enable row level security;
