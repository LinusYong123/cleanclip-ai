-- Optional: adds one demo card so you can see /api/niche-feed return data before the cron job has run.
-- 1) Sign up in the app. 2) Replace the email below. 3) Run in the Supabase SQL editor (after niche_schema.sql).
do $$
declare
  uid uuid;
  today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  select id into uid from public.users where email = 'you@example.com';
  if uid is null then raise exception 'No user with that email. Sign up in the app first.'; end if;

  insert into public.niche_preferences (user_id) values (uid) on conflict (user_id) do nothing;
  insert into public.niches (user_id, label, keywords) values (uid, 'badminton tips', array['badminton tips', 'smash']) on conflict (user_id, label) do nothing;

  insert into public.daily_recommendations
    (user_id, recommended_on, batch_id, batch_at, rank, platform, video_id, url, title, channel_id, channel_title, thumbnail_url,
     published_at, duration_s, view_count, like_count, trend_score, reason, matched_keywords, trace_status)
  values
    (uid, today, gen_random_uuid(), now(), 1, 'youtube', 'aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'Demo card: badminton smash tips',
     'UCdemo', 'Demo Channel', 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg',
     now() - interval '20 hours', 480, 52000, 3100, 85.6, '2.6K views/hr · matches "badminton tips"', array['badminton tips'], 'skipped')
  on conflict do nothing;
end $$;
