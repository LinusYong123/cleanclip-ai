/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { PLANS } from "@/lib/plans";
import { windowStart } from "@/lib/usage";
import { parseVideoUrl } from "@/lib/platforms";
import { workerFrames } from "@/lib/frames";
import { prepareFrame, signature } from "@/lib/frameQuality";
import { discover } from "@/lib/pipeline/discover";
import { verifyCandidate, type VerifyContext } from "@/lib/pipeline/verify";
import { rankVisualMatches } from "@/lib/pipeline/provenance";
import { ENGINE_LABEL, type Candidate, type Cand } from "@/lib/pipeline/types";
import { segmentAndSample } from "@/lib/pipeline/keyframes";

export const maxDuration = 60; // Vercel Hobby cap
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
type Emit = (pct: number, msg: string) => void;
const stage = (emit: Emit, n: number, name: string) => (pct: number, msg: string) => emit(pct, `${n}/4 ${name}: ${msg}`);

type RawFrames = { bufs: Buffer[]; offsets?: number[]; duration: number };

async function resolveUrl(url: string) {
  if (!/\/\/(vm|vt)\.tiktok\.com/.test(url)) return url;
  const resolved = (await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) })).url;
  if (!parseVideoUrl(resolved)) throw new Error("That short link did not resolve to a supported video.");
  return resolved;
}

async function rawFrames(b: any, url: string | null): Promise<RawFrames> {
  if (b.frames?.length) return {
    bufs: (b.frames as string[]).slice(0, 300).map((d) => Buffer.from(d.split(",")[1], "base64")),
    offsets: Array.isArray(b.frameTimes) ? b.frameTimes as number[] : undefined,
    duration: 0,
  };
  if (!url || !process.env.WORKER_URL || !process.env.WORKER_SECRET)
    throw new Error("Exact-frame search requires the frame worker. Configure WORKER_URL and WORKER_SECRET.");
  const clip = b.start != null && b.end != null;
  const w = await workerFrames(url, clip ? b.start : 0, clip ? b.end - b.start : 0, 120, 0.5);
  if (!w.bufs.length) throw new Error("The frame worker did not return any video frames.");
  return { bufs: w.bufs, offsets: w.times.map((t) => t - (clip ? b.start : 0)), duration: w.duration };
}

async function run(body: any, plan: (typeof PLANS)[number], emit: Emit) {
  const s1 = stage(emit, 1, "Frame sampling");
  s1(3, "preparing video source");
  const url = body.frames?.length ? null : await resolveUrl(body.url);
  const source = url ? parseVideoUrl(url) : null;
  const searchSource = source ? { platform: source.platform, videoId: source.id } : null;
  const clip = body.start != null && body.end != null;

  s1(10, url ? "capturing exact video frames" : "preparing uploaded frames");
  const raw = await rawFrames(body, url);
  if (!raw.bufs.length) throw new Error("Couldn't get any frames from that video.");

  const duration = raw.duration || body.clipDuration || 0;
  const segments: any[] = [];
  const segmentMode = undefined;
  s1(22, "selecting distinct, high-quality frames");
  const keyframes = await segmentAndSample(raw.bufs, 12);
  const frames = keyframes.frames;
  const idx = keyframes.idx;
  const ours = await Promise.all(frames.map(async (frame: Buffer) => signature(await prepareFrame(frame))));
  const context = keyframes.context;

  const s2 = stage(emit, 2, "Visual search");
  s2(28, "searching sampled frames");
  const disc = await discover({ frames, source: searchSource, textClues: keyframes.ocr, onProgress: (f, m) => s2(28 + 32 * f, m) });
  const { cands } = disc;

  const s3 = stage(emit, 3, "Visual verification");
  const vctx: VerifyContext = { ours };
  const max = plan.id === "elite" ? 10 : plan.id === "pro" ? 8 : 5;
  const weight = (c: Cand) => c.engines.size * 2 + c.hits;
  const top = [...cands.entries()].sort((a, b) => weight(b[1]) - weight(a[1])).slice(0, Math.min(max, 6));
  const analysed: Candidate[] = [];
  const batchSize = 3;
  for (let i = 0; i < top.length; i += batchSize) {
    const batch = await Promise.all(top.slice(i, i + batchSize).map(([u, c]) => verifyCandidate(u, c, vctx)));
    analysed.push(...batch.filter((candidate): candidate is Candidate => candidate !== null));
    s3(60 + (24 * Math.min(i + batch.length, top.length)) / Math.max(top.length, 1), "comparing candidate footage");
  }

  const s4 = stage(emit, 4, "Visual ranking");
  s4(94, "ranking by frame similarity");
  const candidates = analysed.sort((a, b) => b.score - a.score).slice(0, max);
  const { original, primary, ranked } = rankVisualMatches(candidates, { max });
  const compilations: Candidate[] = [];
  const classification = "Visual-only search";

  // Where each key frame sits inside the clip, so /api/locate can find the clip's start and end in the original
  const locate = primary && ours.length ? {
    sigs: ours.map((s) => ({ g: s.g, h: s.h.toString() })), offsets: idx.map((i: number) => raw.offsets?.[i] ?? null),
    clipDuration: body.clipDuration ?? (clip ? body.end - body.start : null),
  } : undefined;

  const searchedSpan = clip ? body.end - body.start : body.clipDuration ?? duration;
  return {
    platform: source?.platform ?? "upload", videoId: source?.id, title: body.name ?? url ?? "Uploaded video", duration, link: url ?? undefined,
    framesUsed: frames.length,
    note: searchedSpan > 5 ? `Analyzed ${raw.bufs.length} sampled frames and searched ${frames.length} high-quality keyframes.` : undefined,
    verdict: "visual_only", original, primary, bestClean: null, candidates, compilations,
    provenance: { primary, ranked },
    pipeline: {
      segmentation: keyframes.stats,
      discovery: { engines: disc.engines.map((e) => ({ ...e, label: ENGINE_LABEL[e.id] })), candidates: cands.size },
      verification: { checked: analysed.length, compilations: 0, credited_found: 0, creator_matches: 0 },
      provenance: { ranked: ranked.length },
    },
    leads: [], locate, context: { ...context, compilation: false, classification, summary: [] }, segments, segmentMode,
    clip: clip ? { start: body.start, end: body.end } : undefined,
  };
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.frames?.length && !parseVideoUrl(body.url ?? "") && !/\/\/(vm|vt)\.tiktok\.com/.test(body.url ?? ""))
    return NextResponse.json({ error: "Paste a YouTube, TikTok, Instagram, Facebook or Vimeo video link." }, { status: 400 });
  if (!process.env.GOOGLE_VISION_API_KEY) return NextResponse.json({ error: "GOOGLE_VISION_API_KEY is missing in .env.local." }, { status: 500 });

  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data: sub, error: subError } = await supabase.from("subscriptions").select("plan,current_period_start,bonus_searches").single();
  if (subError) {
    console.error("Credit plan lookup failed:", subError);
    const missingBillingFields = subError.code === "42703" || subError.code === "PGRST204"
      || /column .* does not exist/i.test(subError.message);
    const error = missingBillingFields
      ? "Your billing database needs an update. Run supabase/update10.sql in the Supabase SQL editor, then try again."
      : subError.code === "PGRST116"
        ? "No subscription record was found for your account. Refresh your billing status from the Billing page, then try again."
        : `Couldn't load your credit plan (${subError.code ?? "database error"}). Check the server logs and try again.`;
    return NextResponse.json({ error }, { status: 500 });
  }
  const plan = PLANS.find((p) => p.id === (sub?.plan ?? "free"))!;
  const { count, error: usageError } = await supabase.from("searches_usage").select("*", { count: "exact", head: true }).gte("created_at", windowStart(sub).toISOString());
  if (usageError) return NextResponse.json({ error: "Couldn't check your remaining credits. Please try again." }, { status: 500 });
  const overLimit = plan.limit !== null && (count ?? 0) >= plan.limit;
  const bonus: number = sub?.bonus_searches ?? 0; // from the feedback survey; used only after the plan's own searches run out
  if (overLimit && bonus <= 0)
    return NextResponse.json({ error: "You've used all your credits. Upgrade, or take our short survey for 10 free credits." }, { status: 402 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: any) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const result = await run(body, plan, (pct, msg) => send({ type: "progress", pct: Math.round(pct), msg }));
        send({ type: "progress", pct: 96, msg: "4/4 Provenance: saving results" });
        const { error: saveError } = await supabase.from("searches_usage").insert({ user_id: user.id, source: body.url ?? body.name ?? "upload", result });
        if (saveError) throw new Error(`Couldn't save this search: ${saveError.message}`);
        if (overLimit) {
          const { error: bonusError } = await admin().from("subscriptions").update({ bonus_searches: Math.max(0, bonus - 1) }).eq("user_id", user.id);
          if (bonusError) throw new Error(`Couldn't update your bonus credits: ${bonusError.message}`);
        }
        send({ type: "progress", pct: 100, msg: "4/4 Provenance: done" });
        send({ type: "result", data: result });
      } catch (e: any) { send({ type: "error", error: e.message ?? "Trace failed." }); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
