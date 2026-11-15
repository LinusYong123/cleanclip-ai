// app/api/niche/preferences/route.ts
import { fail, getSession, readJson, respond } from "@/lib/niche/http";
import { cleanTerms } from "@/lib/niche/validate";
import { NICHE_LIMITS, type Niche } from "@/lib/niche/types";
import type { UpdateNichePreferencesRequest, UpdateNichePreferencesResponse } from "@/lib/niche/api";

/**
 * PUT /api/niche/preferences: saves the user's keywords and exclusions. The dashboard edits one niche, so this updates the
 * user's oldest niche, or creates it the first time. Writes use the user's session, so RLS enforces ownership.
 */
export async function PUT(req: Request) {
  const { supabase, user } = await getSession();
  if (!user) return fail(401, "unauthorized", "Sign in first.");

  const body = (await readJson(req)) as Partial<UpdateNichePreferencesRequest> | null;
  if (!body || typeof body !== "object") return fail(400, "validation", "Send a JSON body.");

  const kw = cleanTerms(body.keywords ?? [], { label: "Keywords", max: NICHE_LIMITS.keywordsPerNiche, minLen: 2, maxLen: 60 });
  if (!kw.ok) return fail(400, "validation", kw.message, "keywords");
  if (kw.terms.length === 0) return fail(400, "validation", "Add at least one keyword.", "keywords");
  const ex = cleanTerms(body.exclude_terms ?? [], { label: "Exclusion terms", max: NICHE_LIMITS.excludeTerms, minLen: 2, maxLen: 40 });
  if (!ex.ok) return fail(400, "validation", ex.message, "exclude_terms");

  try {
    const existing = await supabase.from("niches").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (existing.error) throw new Error(`lookup: ${existing.error.message}`);

    const res = existing.data
      ? await supabase.from("niches").update({ keywords: kw.terms, exclude_terms: ex.terms, is_active: true }).eq("id", existing.data.id).select("*").single()
      : await supabase.from("niches").insert({ user_id: user.id, label: kw.terms[0].slice(0, 60), keywords: kw.terms, exclude_terms: ex.terms }).select("*").single();
    if (res.error) throw new Error(`save: ${res.error.message}`);
    return respond<UpdateNichePreferencesResponse>({ niche: res.data as Niche });
  } catch (err) {
    console.error("niche preferences:", err);
    const detail = process.env.NODE_ENV !== "production" && err instanceof Error ? ` (${err.message})` : "";
    return fail(502, "upstream", `Couldn't save your keywords. Please try again.${detail}`);
  }
}
