// app/api/niche-feed/reload/route.ts
import { FEED } from "@/lib/niche/config";
import { adminClient, fail, getSession, respond } from "@/lib/niche/http";
import { generateIdeas, type NicheLite } from "@/lib/niche/generate";
import { YouTubeClient, YouTubeQuotaError } from "@/lib/niche/youtube";
import type { ReloadResponse } from "@/lib/niche/api";

export const maxDuration = 30;

interface ReloadState { last_reload_at: string | null; reload_count_date: string | null; reload_count: number }

/**
 * POST /api/niche-feed/reload: creates a fresh batch of ideas. Same cooldown and daily limit for every plan.
 * A reload that fails or finds nothing is refunded.
 */
export async function POST() {
  const { supabase, user } = await getSession();
  if (!user) return fail(401, "unauthorized", "Sign in first.");

  const nicheRes = await supabase.from("niches").select("id,keywords,exclude_terms,language").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (nicheRes.error) return fail(502, "upstream", "Couldn't load your keywords. Please try again.");
  const niche = nicheRes.data as NicheLite | null;
  if (!niche) return fail(400, "validation", "Add at least one keyword first.", "keywords");

  const admin = adminClient();
  try {
    await admin.from("niche_preferences").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
    const stateRes = await admin.from("niche_preferences").select("last_reload_at,reload_count_date,reload_count").eq("user_id", user.id).single();
    if (stateRes.error) throw new Error(`state: ${stateRes.error.message}`);
    const prev = stateRes.data as ReloadState;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const usedToday = prev.reload_count_date === today ? prev.reload_count : 0;
    const sinceLast = prev.last_reload_at ? (now.getTime() - Date.parse(prev.last_reload_at)) / 1000 : Infinity;
    if (sinceLast < FEED.reloadCooldownSeconds) {
      return fail(429, "rate_limited", `Please wait ${Math.ceil(FEED.reloadCooldownSeconds - sinceLast)} seconds before reloading again.`);
    }
    if (usedToday >= FEED.reloadsPerDay) {
      return fail(429, "rate_limited", `You've used all ${FEED.reloadsPerDay} reloads for today. They reset at midnight UTC.`);
    }

    // Claim the reload. The conditional update means two quick clicks can't both pass.
    const claimBase = admin.from("niche_preferences")
      .update({ last_reload_at: now.toISOString(), reload_count_date: today, reload_count: usedToday + 1 }).eq("user_id", user.id);
    const claim = await (prev.last_reload_at ? claimBase.eq("last_reload_at", prev.last_reload_at) : claimBase.is("last_reload_at", null)).select("user_id");
    if (claim.error) throw new Error(`claim: ${claim.error.message}`);
    if (!claim.data?.length) return fail(429, "rate_limited", "A reload is already in progress.");

    const refund = () => admin.from("niche_preferences").update(prev).eq("user_id", user.id);
    try {
      const created = await generateIdeas(admin, user.id, niche, new YouTubeClient({ quotaBudget: FEED.quotaBudgetPerReload }), now);
      if (created === 0) {
        await refund();
        return respond<ReloadResponse>({ created: 0, reloads_left_today: FEED.reloadsPerDay - usedToday, message: "No fresh ideas matched. Try different keywords or check back later." });
      }
      return respond<ReloadResponse>({ created, reloads_left_today: FEED.reloadsPerDay - (usedToday + 1) });
    } catch (err) {
      await refund();
      throw err;
    }
  } catch (err) {
    console.error("niche reload:", err);
    if (err instanceof YouTubeQuotaError) return fail(503, "upstream", "Idea search is at capacity right now. Please try again in a little while.");
    return fail(502, "upstream", "Couldn't get new ideas. Please try again.");
  }
}
