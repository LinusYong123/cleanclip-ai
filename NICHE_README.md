# Niche Ideas (no schedule, same for every plan)

Copy these folders into your cleanclip-ai project (merge, keep the structure).

1. Supabase SQL editor: run `supabase/niche_ideas_migration.sql` (existing database) or `supabase/niche_schema.sql` (fresh install).
2. Delete the old files that no longer apply: `app/api/niche/trace/route.ts` and any `app/api/cron/niche-*` routes.
3. Limits live in `lib/niche/config.ts` and apply to everyone.

| Route | What it does |
|---|---|
| `GET /api/niche-feed` | Current ideas, keywords, reloads left |
| `POST /api/niche-feed/reload` | New batch of ideas (cooldown and daily cap) |
| `PUT /api/niche/preferences` | Save keywords and words to avoid |
| `POST /api/trace` (existing) | "Find original source" button on each idea |
