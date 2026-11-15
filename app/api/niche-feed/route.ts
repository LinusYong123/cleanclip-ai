// app/api/niche-feed/route.ts
import { FEED } from "@/lib/niche/config";
import { fail, getSession, respond } from "@/lib/niche/http";
import type { Confidence, DailyRecommendation, Niche, NichePreferences } from "@/lib/niche/types";
import type { FeedIdea, IdeaTrace, NicheFeedResponse } from "@/lib/niche/api";

const PLACEHOLDER_THUMB =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='100%25' height='100%25' fill='%230f172a'/></svg>";

interface UsageRow {
  source: string;
  created_at: string;
  primary: { url?: string; title?: string; author?: string; publishedAt?: string; score?: number; confidence?: Confidence } | null;
  tracing: { is_likely_original?: boolean } | null;
}

function rowsOf<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

/**
 * GET /api/niche-feed: the user's current ideas, their keywords, and how many reloads they have left.
 * Same for every plan. It never generates anything (that's POST /api/niche-feed/reload).
 */
export async function GET() {
  const { supabase, user } = await getSession();
  if (!user) return fail(401, "unauthorized", "Sign in first.");

  try {
    const [prefsRes, nicheRes, latestRes] = await Promise.all([
      supabase.from("niche_preferences").select("last_reload_at,reload_count_date,reload_count").maybeSingle(),
      supabase.from("niches").select("id,label,keywords,exclude_terms").order("created_at", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("daily_recommendations").select("batch_id,batch_at").order("batch_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (prefsRes.error) throw new Error(`preferences: ${prefsRes.error.message}`);
    if (nicheRes.error) throw new Error(`niche: ${nicheRes.error.message}`);
    if (latestRes.error) throw new Error(`latest batch: ${latestRes.error.message}`);

    const latest = latestRes.data as { batch_id: string | null; batch_at: string } | null;
    const rows = latest?.batch_id
      ? rowsOf<DailyRecommendation>(await supabase.from("daily_recommendations").select("*").eq("batch_id", latest.batch_id).order("rank", { ascending: true }), "ideas")
      : [];

    // Reverse-search results come from the user's own search history, so they're always the real pipeline output.
    const traces = new Map<string, IdeaTrace>();
    if (rows.length) {
      const usage = rowsOf<UsageRow>(
        await supabase.from("searches_usage").select("source,created_at,primary:result->primary,tracing:result->source_tracing")
          .in("source", rows.map((r) => r.url)).order("created_at", { ascending: false }),
        "traces",
      );
      for (const u of usage) {
        if (traces.has(u.source)) continue; // newest first
        traces.set(u.source, {
          traced_at: u.created_at,
          primary_source_url: u.primary?.url ?? null,
          primary_title: u.primary?.title ?? null,
          primary_author: u.primary?.author ?? null,
          primary_published_at: u.primary?.publishedAt ?? null,
          confidence: u.primary?.confidence ?? null,
          score: u.primary?.score ?? null,
          is_likely_original: u.tracing?.is_likely_original ?? null,
        });
      }
    }

    const ideas: FeedIdea[] = rows.map((r) => ({
      id: r.id,
      platform: "youtube",
      video_id: r.video_id,
      url: r.url,
      title: r.title,
      channel_title: r.channel_title ?? "",
      thumbnail_url: r.thumbnail_url ?? PLACEHOLDER_THUMB,
      published_at: r.published_at,
      duration_s: r.duration_s,
      view_count: r.view_count,
      trend_score: r.trend_score ?? 0,
      selection_reason: r.reason ?? "",
      matched_keywords: r.matched_keywords,
      trace: traces.get(r.url) ?? null,
    }));

    const prefs = prefsRes.data as Pick<NichePreferences, "last_reload_at" | "reload_count_date" | "reload_count"> | null;
    const today = new Date().toISOString().slice(0, 10);
    const used = prefs?.reload_count_date === today ? prefs.reload_count : 0;
    const cooldownEnds = prefs?.last_reload_at ? Date.parse(prefs.last_reload_at) + FEED.reloadCooldownSeconds * 1000 : 0;

    return respond<NicheFeedResponse>({
      ideas,
      generated_at: latest?.batch_at ?? null,
      niche: (nicheRes.data ?? null) as Pick<Niche, "id" | "label" | "keywords" | "exclude_terms"> | null,
      has_niches: !!nicheRes.data,
      reload: {
        reloads_left_today: Math.max(0, FEED.reloadsPerDay - used),
        reloads_per_day: FEED.reloadsPerDay,
        cooldown_seconds: FEED.reloadCooldownSeconds,
        next_reload_at: cooldownEnds > Date.now() ? new Date(cooldownEnds).toISOString() : null,
      },
    });
  } catch (err) {
    console.error("niche-feed:", err);
    return fail(502, "upstream", "Couldn't load your ideas. Please try again.");
  }
}
