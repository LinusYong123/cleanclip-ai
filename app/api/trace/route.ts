/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { PLANS } from "@/lib/plans";
import { windowStart } from "@/lib/usage";
import { getInfo, parseVideoUrl, type VideoInfo } from "@/lib/platforms";
import { fetchBuf, workerFrames } from "@/lib/frames";
import { signature } from "@/lib/frameQuality";
import { detectRanking } from "@/lib/ranking";
import { coreQuery, attributions, videoLinks, COMPILATION } from "@/lib/sources";
import { textSearch, topComments } from "@/lib/queries";
import { splitScenes } from "@/lib/sceneSplit";
import { extractHandles, pickTargets, nextQueries, searchHandle, isSelf, type Handle } from "@/lib/handles";
import { segmentAndSample } from "@/lib/pipeline/keyframes";
import { discover } from "@/lib/pipeline/discover";
import { verifyCandidate, type VerifyContext } from "@/lib/pipeline/verify";
import { rankProvenance } from "@/lib/pipeline/provenance";
import { tokens } from "@/lib/pipeline/signals";
import { ENGINE_LABEL, type Candidate, type Cand, type EngineId, type Verified } from "@/lib/pipeline/types";

export const maxDuration = 60; // Vercel Hobby cap
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
type Emit = (pct: number, msg: string) => void;
const stage = (emit: Emit, n: number, name: string) => (pct: number, msg: string) => emit(pct, `${n}/4 ${name}: ${msg}`);

function chaptersFrom(description: string) {
  const found: { start: number; label: string }[] = [];
  for (const line of description.split("\n")) {
    const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$/.exec(line);
    if (m) found.push({ start: (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3], label: m[4].trim() });
  }
  return found.length >= 2 ? found.map((s, i) => ({ ...s, end: found[i + 1]?.start ?? Infinity })) : [];
}
const equalScenes = (d: number) => {
  const n = Math.min(6, Math.max(2, Math.floor(d / 20)));
  return Array.from({ length: n }, (_, i) => ({ start: Math.floor((d / n) * i), end: Math.floor((d / n) * (i + 1)), label: `Scene ${i + 1}` }));
};

async function rawFrames(b: any, info: VideoInfo | null) {
  if (b.frames?.length) return { bufs: (b.frames as string[]).slice(0, 16).map((d) => Buffer.from(d.split(",")[1], "base64")), offsets: b.frameTimes as number[] | undefined } as any;
  const clip = b.start != null && b.end != null;
  try {
    const w = await workerFrames(info!.url, clip ? b.start : 0, clip ? b.end - b.start : info!.duration ?? 0, clip ? 8 : 30);
    if (w.bufs.length) return { ...w, offsets: w.times.map((t) => t - (clip ? b.start : 0)) };
  } catch { /* fall back to thumbnails */ }
  let bufs = ((await Promise.all(info!.thumbs.map((t) => fetchBuf(t).catch(() => null)))).filter(Boolean)) as Buffer[];
  const note = clip ? "Approximate frames. Deploy the frame worker to search the exact moment." : undefined;
  if (clip && info!.platform === "youtube" && info!.duration && bufs.length >= 3) {
    const i = Math.min(2, Math.max(0, Math.round(((b.start + b.end) / 2 / info!.duration) * 4) - 1));
    bufs = [bufs[i]];
  }
  return { bufs, note } as any;
}

async function run(body: any, plan: (typeof PLANS)[number], emit: Emit) {
  // ===== 1/4 Scene segmentation and sampling =====================================================
  const s1 = stage(emit, 1, "Segmentation");
  s1(3, "reading video details");
  const info = body.frames?.length ? null : await getInfo(body.url);
  const clip = body.start != null && body.end != null;

  s1(10, info ? "grabbing frames" : "preparing your frames");
  const raw = await rawFrames(body, info);
  if (!raw.bufs.length) throw new Error("Couldn't get any frames from that video.");

  // Clips for the UI: chapters, then ranking numbers, then AI scene detection, then equal parts
  let segments: any[] = [], segmentMode: string | undefined;
  const duration = info?.duration ?? raw.duration ?? 0;
  if (info && !clip && duration) {
    s1(16, "splitting into clips");
    const ch = chaptersFrom(info.description ?? "").map((s) => ({ ...s, end: Math.min(s.end, duration) }));
    if (ch.length) { segments = ch; segmentMode = "chapters"; }
    else if (raw.times?.length) {
      const r = await detectRanking(raw.bufs.map((b: Buffer, i: number) => ({ t: raw.times[i], buf: b })), duration).catch(() => null);
      if (r) { segments = r.segments; segmentMode = `ranking #${r.first} to #${r.last}`; }
      else {
        const ai = await splitScenes(raw.bufs.map((b: Buffer, i: number) => ({ buf: b, t: raw.times[i] })), duration).catch(() => null);
        if (ai) { segments = ai.segments; segmentMode = "AI scene detection"; }
      }
    }
    if (!segments.length) { segments = equalScenes(duration); segmentMode = "equal scenes"; }
  }

  s1(22, "dropping static frames, grouping scenes, picking key frames");
  const kf = await segmentAndSample(raw.bufs, 5);
  const { frames, idx, context, ocr } = kf;
  const ours = await Promise.all(frames.map(signature));
  const name = (body.name ?? "").replace(/\.\w+$/, "");
  const core = coreQuery(info?.title ?? (/^[\d_\-\s.]+$/.test(name) ? "" : name));
  const clipDuration: number | null = body.clipDuration ?? (clip ? body.end - body.start : info?.duration ?? null);

  // ===== 2/4 Multi-engine discovery ==============================================================
  const s2 = stage(emit, 2, "Discovery");
  s2(28, "starting the search engines");
  const disc = await discover({ frames, info, core, hint: body.hint, onProgress: (f, m) => s2(28 + 32 * f, m) });
  const { cands, leads, queries, scene } = disc;

  // ===== 3/4 Deep multi-signal verification ======================================================
  const s3 = stage(emit, 3, "Verification");
  const vctx: VerifyContext = {
    ours, searched: frames.length, ourTokens: tokens(ocr),
    keywords: [...(scene?.extracted_keywords ?? []), core].filter(Boolean),
    clipDuration, selfDate: info?.publishedAt,
  };
  const max = plan.id === "elite" ? 10 : plan.id === "pro" ? 8 : 5;
  const weight = (c: Cand) => c.engines.size * 2 + c.hits;
  const top = [...cands.entries()].sort((a, b) => weight(b[1]) - weight(a[1])).slice(0, max + 6);
  let checked = 0;
  const analysed = (await Promise.all(top.map(async ([u, c]) => {
    const r = await verifyCandidate(u, c, vctx).catch(() => null);
    s3(60 + (24 * ++checked) / Math.max(top.length, 1), "checking look-alike, on-screen text and metadata");
    return r;
  }))).filter(Boolean) as Verified[];

  // Compilations: read description and comments for credits, then verify the credited source one step further back
  s3(85, "following credits from compilations");
  const seen = new Set(analysed.map((a) => a.url));
  const comps = analysed.filter((a) => a.compilation).sort((a, b) => b.score - a.score).slice(0, 3);
  const follow: { l: string; via: string }[] = [], phrases: { q: string; via: string }[] = [];
  for (const cmp of comps) {
    const comments = cmp.platform === "youtube" ? await topComments(cmp.videoId).catch(() => "") : "";
    for (const l of [...cmp._links, ...videoLinks(comments)]) follow.push({ l, via: cmp.url });
    for (const a of [...cmp.attrib, ...attributions(comments)].slice(0, 2)) phrases.push({ q: `${a} original`, via: cmp.url });
  }
  const found = (await Promise.all(phrases.slice(0, 3).map(async (x) => (await textSearch(x.q)).slice(0, 3).map((r) => ({ l: r.link, via: x.via }))))).flat();
  const uniq = new Map<string, string>();
  for (const x of [...follow, ...found]) if (parseVideoUrl(x.l) && !seen.has(x.l)) uniq.set(x.l, x.via);
  const back = ((await Promise.all([...uniq.entries()].slice(0, 7).map(([l, via]) => verifyCandidate(l, { hits: 0, engines: new Set<EngineId>() }, vctx, via).catch(() => null))))
    .filter(Boolean) as Verified[]).filter((b) => b.similarity >= 40);

  // Creator attribution: collect handles from every text source, then search the credited creator's own pages
  s3(90, "tracing credited creators");
  const comments = info?.platform === "youtube" ? await topComments(info.videoId).catch(() => "") : "";
  const handles: Handle[] = extractHandles([
    ...(info ? [{ src: "title", t: info.title }, { src: "description", t: info.description ?? "" }, { src: "comments", t: comments }] : []),
    { src: "frame", t: ocr },
    ...analysed.filter((a) => a.compilation).slice(0, 3).map((a) => ({ src: "compilation", t: a._text })),
  ]);
  const targets = pickTargets(handles, info?.author ?? "");
  const phrase = scene?.search_queries.broad ?? core;
  const nextQ = nextQueries(targets, phrase);
  const handleHits = (await Promise.all(targets.slice(0, 2).map(async (h) => (await searchHandle(h, phrase)).slice(0, 4).map((x) => ({ x, h: h.handle }))))).flat();
  const known = new Set([...analysed, ...back].map((a) => a.url));
  const traced = ((await Promise.all(handleHits.filter(({ x }) => parseVideoUrl(x.link) && !known.has(x.link) && x.link !== info?.url).slice(0, 6)
    .map(({ x, h }) => verifyCandidate(x.link, { hits: 0, engines: new Set<EngineId>(["creator_page"]), handle: h, thumb: x.thumbnail, title: x.title }, vctx).catch(() => null))))
    .filter(Boolean) as Verified[]).filter((t) => t.similarity >= 35);

  // ===== 4/4 Ranked provenance and timestamps ====================================================
  const s4 = stage(emit, 4, "Provenance");
  s4(94, "ranking sources by evidence and upload date");
  const all: Candidate[] = [...analysed, ...back, ...traced].map(({ _links, attrib, _text, ...rest }) => rest);
  const candidates = all.filter((c) => !c.compilation).sort((a, b) => b.score - a.score).slice(0, max);
  const compilations = all.filter((c) => c.compilation).sort((a, b) => b.score - a.score).slice(0, 5);
  const { original, primary, ranked } = rankProvenance(candidates, { selfDate: info?.publishedAt, max });
  const bestClean = candidates.filter((c) => c.score >= 30 && c.clean && c.clean.score >= 60)[0] ?? null;

  const compilationInput = context.ranking || !!segmentMode?.startsWith("ranking") || COMPILATION.test(info?.title ?? name);
  const external = handles.filter((h) => !isSelf(h.handle, info?.author ?? "") && h.kind !== "mention");
  const watermarkMismatch = handles.some((h) => h.source === "frame" && !isSelf(h.handle, info?.author ?? ""));
  const videoType = /react/i.test(info?.title ?? name) ? "reaction" : compilationInput ? "compilation" : original || external.length ? "re-upload" : "original";
  const source_tracing = {
    found_handles: handles.map((h) => ({ handle: h.handle, platform: h.platform, source: h.source, kind: h.kind })),
    is_likely_original: !external.length && !watermarkMismatch && !original && videoType === "original",
    next_search_queries: nextQ,
    type: videoType,
    primary_target: targets[0]?.handle ?? null,
  };
  const mirrored = !!primary?.mirrored;
  const overlaid = context.text || context.ranking || context.watermark;
  const canvas = context.bars || context.sidebars || mirrored;
  const classification = overlaid && canvas ? "Overlaid/Edited + Modified Canvas" : overlaid ? "Overlaid/Edited" : canvas ? "Modified Canvas" : "Raw Clean Footage";
  const summary = [context.ranking && "Ranking numbers", context.text && "Text or subtitles", context.watermark && "Watermark or logo",
    (context.bars || context.sidebars) && "Bars or sidebars", mirrored && "Mirrored"].filter(Boolean);

  // Where each key frame sits inside the clip, so /api/locate can find the clip's start and end in the original
  const locate = primary && ours.length ? {
    sigs: ours.map((s) => ({ g: s.g, h: s.h.toString() })), offsets: idx.map((i: number) => raw.offsets?.[i] ?? null), clipDuration,
  } : undefined;

  return {
    platform: info?.platform ?? "upload", videoId: info?.videoId, title: info?.title ?? body.name ?? "Uploaded video", channel: info?.author ?? "",
    publishedAt: info?.publishedAt, duration, views: info?.views ?? 0, link: info?.url, thumbnail: info?.thumbs[info.thumbs.length - 1],
    framesUsed: frames.length, note: raw.note, verdict: original ? "reupload" : "likely_original", original, primary, bestClean, candidates, compilations,
    provenance: { primary, ranked },
    pipeline: {
      segmentation: kf.stats,
      discovery: { engines: disc.engines.map((e) => ({ ...e, label: ENGINE_LABEL[e.id] })), candidates: cands.size },
      verification: { checked: analysed.length, compilations: comps.length, credited_found: back.length, creator_matches: traced.length },
      provenance: { ranked: ranked.length },
    },
    leads: [...leads.entries()].slice(0, 5).map(([url, title]) => ({ url, title })), queries, source_tracing,
    scene: scene ? { description: scene.scene_description, keywords: scene.extracted_keywords } : undefined, locate,
    context: { ...context, compilation: compilationInput, classification, summary }, segments, segmentMode, clip: clip ? { start: body.start, end: body.end } : undefined,
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

  const { data: sub } = await supabase.from("subscriptions").select("plan,current_period_start,bonus_searches").single();
  const plan = PLANS.find((p) => p.id === (sub?.plan ?? "free"))!;
  const { count } = await supabase.from("searches_usage").select("*", { count: "exact", head: true }).gte("created_at", windowStart(sub).toISOString());
  const overLimit = plan.limit !== null && (count ?? 0) >= plan.limit;
  const bonus: number = sub?.bonus_searches ?? 0; // from the feedback survey; used only after the plan's own searches run out
  if (overLimit && bonus <= 0)
    return NextResponse.json({ error: "You've used all your searches. Upgrade, or take our short survey for 10 free searches." }, { status: 402 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: any) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const result = await run(body, plan, (pct, msg) => send({ type: "progress", pct: Math.round(pct), msg }));
        send({ type: "progress", pct: 96, msg: "4/4 Provenance: saving results" });
        await supabase.from("searches_usage").insert({ user_id: user.id, source: body.url ?? body.name ?? "upload", result });
        if (overLimit) await admin().from("subscriptions").update({ bonus_searches: Math.max(0, bonus - 1) }).eq("user_id", user.id);
        send({ type: "progress", pct: 100, msg: "4/4 Provenance: done" });
        send({ type: "result", data: result });
      } catch (e: any) { send({ type: "error", error: e.message ?? "Trace failed." }); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
