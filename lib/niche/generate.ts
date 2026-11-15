// lib/niche/generate.ts: builds a fresh batch of ideas for one user. Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FEED } from "./config";
import { type SearchHit, type YouTubeClient } from "./youtube";
import { DEFAULT_SCORING_CONFIG, buildReason, buildSeenSet, curate, normalize, selectTop, toCandidate, type ScoringContext } from "./scorer";
import type { Niche } from "./types";

export type NicheLite = Pick<Niche, "id" | "keywords" | "exclude_terms" | "language">;
const DAY = 86_400_000;

function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** YouTube searches cost 100 units, so identical searches are shared between users for a few hours. */
async function cachedSearch(
  admin: SupabaseClient, yt: YouTubeClient, query: string, order: "viewCount" | "relevance", lang: string, now: Date,
): Promise<SearchHit[]> {
  const bucket = Math.floor(now.getTime() / (FEED.searchCacheHours * 3_600_000));
  const key = `yt:${order}:${lang}:${bucket}:${normalize(query)}`.slice(0, 250);
  const cached = await admin.from("niche_search_cache").select("hits").eq("cache_key", key).maybeSingle();
  if (cached.data?.hits) return cached.data.hits as SearchHit[];
  const hits = await yt.searchVideos({
    query, order, maxResults: 25, relevanceLanguage: lang,
    publishedAfter: new Date(now.getTime() - FEED.maxAgeDays * DAY),
  });
  await admin.from("niche_search_cache").upsert({ cache_key: key, hits, fetched_at: now.toISOString() }, { onConflict: "cache_key" });
  return hits;
}

/**
 * Searches, scores and stores a new batch. Returns how many ideas were created (0 if nothing fresh matched).
 * Throws if every search failed (for example YouTube quota), so the caller can refund the reload.
 */
export async function generateIdeas(admin: SupabaseClient, userId: string, niche: NicheLite, yt: YouTubeClient, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - FEED.historyDays * DAY).toISOString();
  const publishedAfter = new Date(now.getTime() - FEED.maxAgeDays * DAY);

  const [seenRes, chanRes] = await Promise.all([
    admin.from("daily_recommendations").select("platform,video_id,recommended_on").eq("user_id", userId).gte("created_at", since),
    admin.from("niche_channels").select("channel_id,is_blocked,similarity,source").eq("user_id", userId).eq("platform", "youtube"),
  ]);
  if (seenRes.error) throw new Error(`history: ${seenRes.error.message}`);
  if (chanRes.error) throw new Error(`channels: ${chanRes.error.message}`);

  const seen = buildSeenSet((seenRes.data ?? []) as { platform: string; video_id: string; recommended_on: string }[], now, FEED.historyDays);
  const blocked = new Set<string>();
  const followed = new Map<string, number>();
  for (const c of (chanRes.data ?? []) as { channel_id: string; is_blocked: boolean; similarity: number | null; source: string }[]) {
    if (c.is_blocked) blocked.add(c.channel_id);
    else followed.set(c.channel_id, c.source === "similar" ? Number(c.similarity ?? 0.5) : 1);
  }

  // Discover: a couple of random keywords (cached searches) plus recent uploads from followed channels
  const keywords = shuffle(niche.keywords).slice(0, FEED.keywordsPerReload);
  const searches = await Promise.allSettled(
    keywords.map((k) => cachedSearch(admin, yt, k, Math.random() < 0.5 ? "viewCount" : "relevance", niche.language || "en", now)),
  );
  const ids = new Set<string>();
  for (const s of searches) if (s.status === "fulfilled") for (const h of s.value) ids.add(h.videoId);
  const failedSearches = searches.filter((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failedSearches.length === searches.length && searches.length > 0) throw failedSearches[0].reason;

  const pick = shuffle([...followed.keys()].filter((id) => !blocked.has(id))).slice(0, FEED.followedChannelsPerReload);
  const uploads = await Promise.allSettled(pick.map((id) => yt.getChannelUploads(id, { maxResults: 10, publishedAfter })));
  for (const u of uploads) if (u.status === "fulfilled") for (const h of u.value) ids.add(h.videoId);
  if (ids.size === 0) return 0;

  // Score
  const videos = await yt.getVideoDetails(ids);
  const channels = await yt.getChannels(new Set(videos.map((v) => v.channelId)));
  const ctx: ScoringContext = {
    niche: { id: niche.id, keywords: niche.keywords, excludeTerms: niche.exclude_terms },
    now, seen, blockedChannelIds: blocked, followedChannels: followed,
    channelSubscribers: new Map(channels.map((c) => [c.id, c.subscriberCount])),
  };
  let { scored } = curate(videos, ctx);
  if (scored.length < FEED.ideasPerReload) scored = curate(videos, ctx, { ...DEFAULT_SCORING_CONFIG, minViews: 50 }).scored; // relax if the pool is thin
  const picked = selectTop(scored, { count: FEED.ideasPerReload });
  if (picked.length === 0) return 0;

  // Store as a new batch. Older batches stay for 30 days so ideas aren't repeated, and the feed shows only the newest.
  const batchId = crypto.randomUUID();
  const batchAt = now.toISOString();
  const rows = picked.map((s, i) => {
    const c = toCandidate(s);
    return {
      user_id: userId, niche_id: niche.id, batch_id: batchId, batch_at: batchAt, recommended_on: batchAt.slice(0, 10), rank: i + 1,
      platform: c.platform, video_id: c.video_id, url: c.url, title: c.title, channel_id: c.channel_id, channel_title: c.channel_title,
      thumbnail_url: c.thumbnail_url, published_at: c.published_at, duration_s: c.duration_s, view_count: c.view_count, like_count: c.like_count,
      trend_score: c.trend_score, reason: buildReason(s, ctx), matched_keywords: c.matched_keywords, trace_status: "skipped" as const,
    };
  });
  const ins = await admin.from("daily_recommendations").insert(rows).select("id");
  if (ins.error) throw new Error(`save ideas: ${ins.error.message}`);

  // Housekeeping (best effort)
  await admin.from("daily_recommendations").delete().eq("user_id", userId).eq("is_saved", false).lt("created_at", since);
  await admin.from("niche_search_cache").delete().lt("fetched_at", new Date(now.getTime() - 2 * DAY).toISOString());
  return rows.length;
}
