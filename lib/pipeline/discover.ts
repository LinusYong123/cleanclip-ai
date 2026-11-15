/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 2: multi-engine discovery.
// Image engines (Google Vision web detection, Google Lens, Yandex reverse image) look at the key frames;
// text engines (Google Videos via SerpApi, or the YouTube Data API) run queries written from what the AI saw.
import { createClient } from "@supabase/supabase-js";
import { webInfo, subjectLabels } from "@/lib/vision";
import { analyzeScene, type Scene } from "@/lib/visualIntel";
import { buildQueries, textSearch } from "@/lib/queries";
import { parseVideoUrl, type VideoInfo } from "@/lib/platforms";
import { LEAD_THREAD } from "@/lib/sources";
import { lensHits, yandexHits, type Hit } from "./parse";
import type { Cand, EngineId } from "./types";

export interface DiscoveryInput {
  frames: Buffer[];
  info: VideoInfo | null;
  core: string; // the video's title without ranking/compilation words
  hint?: string;
  onProgress: (fraction: number, message: string) => void;
}
export interface DiscoveryOutput {
  cands: Map<string, Cand>;
  leads: Map<string, string>;
  queries: { A: string; B: string; C: string };
  scene: Scene | null;
  engines: { id: EngineId; enabled: boolean; hits: number }[];
}

/**
 * Google Lens and Yandex need public image URLs, so the frames are parked in the "frames" bucket once,
 * both engines read them, and they are deleted straight away.
 */
async function imageEngines(frames: Buffer[], lensContext: string | undefined, tick: () => void) {
  const out = { lens: [] as Hit[], yandex: [] as Hit[] };
  const key = process.env.SERPAPI_KEY;
  if (!key) return out;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const names: string[] = [];
  const urls = (await Promise.all(frames.slice(0, 4).map(async (buf) => {
    const name = `${crypto.randomUUID()}.jpg`;
    const up = await db.storage.from("frames").upload(name, buf, { contentType: "image/jpeg" });
    if (up.error) return null;
    names.push(name);
    return db.storage.from("frames").getPublicUrl(name).data.publicUrl;
  }))).filter((u): u is string => !!u);

  const serp = (params: Record<string, string>): Promise<any> =>
    fetch(`https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: key })}`).then((r) => r.json()).catch(() => ({}));
  const yandexOn = process.env.YANDEX_SEARCH !== "off";

  await Promise.all([
    ...urls.map(async (u) => { out.lens.push(...lensHits(await serp({ engine: "google_lens", url: u, type: "visual_matches" }))); tick(); }),
    ...(yandexOn ? urls.slice(0, 3).map(async (u) => { out.yandex.push(...yandexHits(await serp({ engine: "yandex_images", url: u }))); tick(); }) : []),
  ]);
  if (lensContext && urls[0]) out.lens.push(...lensHits(await serp({ engine: "google_lens", url: urls[0], type: "all", q: lensContext.slice(0, 100) })));
  tick();
  if (names.length) await db.storage.from("frames").remove(names);
  return out;
}

export async function discover({ frames, info, core, hint, onProgress }: DiscoveryInput): Promise<DiscoveryOutput> {
  const serp = !!process.env.SERPAPI_KEY;
  const yandexOn = serp && process.env.YANDEX_SEARCH !== "off";
  const textEngine: EngineId = serp ? "google_videos" : "youtube_search";
  const total = frames.length + (serp ? Math.min(frames.length, 4) + 1 : 0) + (yandexOn ? Math.min(frames.length, 3) : 0) + 3;
  let done = 0;
  const tick = (msg: string) => onProgress(Math.min(0.99, ++done / total), msg);

  const cands = new Map<string, Cand>(), leads = new Map<string, string>();
  const counts: Partial<Record<EngineId, number>> = {};
  const selfKey = info ? `${info.platform}:${info.videoId}` : "";
  const add = (page: string, engine: EngineId, thumb?: string, title?: string) => {
    if (LEAD_THREAD.test(page)) { leads.set(page, title || page); return; }
    const p = parseVideoUrl(page);
    if (!p || `${p.platform}:${p.id}` === selfKey) return;
    const c = cands.get(page) ?? { hits: 0, engines: new Set<EngineId>() };
    c.engines.add(engine);
    if (engine === "google_vision") c.hits += 1;
    c.thumb = c.thumb ?? thumb;
    c.title = c.title ?? title;
    cands.set(page, c);
    counts[engine] = (counts[engine] ?? 0) + 1;
  };

  // The AI scene profile runs alongside the image engines; Lens uses its broad query as a text hint
  const scenePromise = analyzeScene(frames.slice(0, 3), [core, hint].filter(Boolean).join(". ") || undefined).catch(() => null);
  const [webs, img, subj, scene] = await Promise.all([
    Promise.all(frames.map(async (f) => { const w = await webInfo(f).catch(() => null); tick("Google Vision"); return w; })),
    (async () => imageEngines(frames, (await scenePromise)?.search_queries.broad ?? (core ? `${core} original` : undefined), () => tick("Google Lens and Yandex")))()
      .catch(() => ({ lens: [] as Hit[], yandex: [] as Hit[] })),
    subjectLabels(frames).catch(() => ({ labels: [] as string[] })),
    scenePromise,
  ]);

  const ent = new Map<string, number>();
  for (const w of webs) {
    for (const pg of w?.pages ?? []) add(pg.url, "google_vision", undefined, pg.title);
    for (const e of w?.entities ?? []) if (e.d.length > 2 && !/^(video|youtube|photograph|image)$/i.test(e.d)) ent.set(e.d, (ent.get(e.d) ?? 0) + e.s);
  }
  for (const m of img.lens) add(m.link, "google_lens", m.thumb, m.title);
  for (const m of img.yandex) add(m.link, "yandex", m.thumb, m.title);

  // Text engines: the AI's three queries (specific, broad, source-tracing), or label-based ones as a fallback
  const entities = [...ent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
  const queries = scene
    ? { A: scene.search_queries.specific, B: scene.search_queries.broad, C: scene.search_queries.source_tracing }
    : buildQueries(subj.labels, entities, core);
  const results = await Promise.all([queries.A, queries.B, queries.C].map(async (q) => { const h = await textSearch(q); tick("Source-tracing queries"); return h; }));
  for (const hits of results) for (const h of hits) add(h.link, textEngine, h.thumbnail, h.title);

  return {
    cands, leads, queries, scene,
    engines: [
      { id: "google_vision", enabled: true, hits: counts.google_vision ?? 0 },
      { id: "google_lens", enabled: serp, hits: counts.google_lens ?? 0 },
      { id: "yandex", enabled: yandexOn, hits: counts.yandex ?? 0 },
      { id: textEngine, enabled: serp || !!process.env.YOUTUBE_API_KEY, hits: counts[textEngine] ?? 0 },
    ],
  };
}
