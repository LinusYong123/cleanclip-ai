/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { webInfoMany, subjectLabels } from "@/lib/vision";
import { parseVideoUrl, type Platform } from "@/lib/platforms";
import { lensHits, yandexHits, type Hit } from "./parse";
import type { Cand, EngineId } from "./types";

export interface DiscoveryInput {
  frames: Buffer[];
  source: { platform: Platform; videoId: string } | null;
  textClues?: string;
  onProgress: (fraction: number, message: string) => void;
}
export interface DiscoveryOutput {
  cands: Map<string, Cand>;
  queries?: { A: string; B: string; C: string };
  scene?: null;
  engines: { id: EngineId; enabled: boolean; hits: number }[];
}

/**
 * Search general web, video-specific Google results, and YouTube using visual labels and OCR clues.
 */
async function textEngines(frames: Buffer[], textClues: string | undefined, tick: () => void) {
  const { labels } = await subjectLabels(frames.slice(0, 8));
  const phrases = (textClues ?? "").split(/\r?\n/)
    .map((line) => line.replace(/[^\w@#'-]+/g, " ").trim())
    .filter((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      return (words.length >= 2 && words.length <= 8 && line.length >= 8) || /^@\w{3,}$/.test(line);
    })
    .slice(0, 2)
    .map((line) => `"${line}"`);
  if (!labels.length && !phrases.length) return [];

  const key = process.env.SERPAPI_KEY;
  if (!key) return [];

  const visualQuery = labels.slice(0, 4).join(" ");
  const searches = [
    { engine: "google", param: "q", query: visualQuery, groups: ["organic_results", "video_results"] },
    { engine: "google_videos", param: "q", query: visualQuery, groups: ["video_results", "inline_videos"] },
    { engine: "youtube", param: "search_query", query: visualQuery, groups: ["video_results"] },
    ...(phrases[0] ? [{ engine: "google", param: "q", query: phrases[0], groups: ["organic_results", "video_results"] }] : []),
  ];
  const results = await Promise.all(searches.map(async ({ engine, param, query, groups }) => {
    try {
      const params = new URLSearchParams({ engine, [param]: query, api_key: key });
      const r = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) {
        console.warn(`Video search (${engine}) failed: ${r.status}`);
        return [] as Hit[];
      }
      const data = await r.json();
      if (data.error) {
        console.warn(`Video search (${engine}) failed: ${data.error}`);
        return [] as Hit[];
      }
      const hits: Hit[] = [];
      for (const group of groups) {
        for (const item of data[group] ?? []) {
          const link = typeof item.link === "string" ? item.link : "";
          const thumb = typeof item.thumbnail === "string"
            ? item.thumbnail
            : Array.isArray(item.thumbnail)
              ? item.thumbnail.find((t: any) => typeof t === "string") ?? item.thumbnail.find((t: any) => typeof t?.url === "string")?.url
              : item.thumbnail?.url;
          if (parseVideoUrl(link)) hits.push({ link, title: item.title, thumb });
        }
      }
      return hits;
    } catch (error) {
      console.warn(`Video search (${engine}) failed:`, error);
      return [] as Hit[];
    }
  }));
  tick();
  return results.flat();
}

/**
 * Reverse-image engines need public image URLs. Use up to ten frames spaced across the video;
 * Google Vision checks every sampled frame separately.
 */
async function imageEngines(frames: Buffer[], textClues: string | undefined, tick: () => void) {
  const out = { lens: [] as Hit[], yandex: [] as Hit[], text: [] as Hit[] };
  const key = process.env.SERPAPI_KEY;
  if (!key) return out;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const names: string[] = [];
  const maxReverse = 10;
  const indexes = frames.length <= maxReverse
    ? frames.map((_, i) => i)
    : Array.from({ length: maxReverse }, (_, i) => Math.round(i * (frames.length - 1) / (maxReverse - 1)));
  const serp = async (params: Record<string, string>): Promise<any> => {
    const r = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: key })}`);
    if (!r.ok) throw new Error(`Reverse-image search failed (${r.status}).`);
    const data = await r.json();
    if (data.error) throw new Error("Reverse-image search failed.");
    return data;
  };
  const yandexOn = process.env.YANDEX_SEARCH !== "off";

  try {
    const urls = (await Promise.all(indexes.map(async (i) => {
      const buf = frames[i];
      const name = `${crypto.randomUUID()}.jpg`;
      const up = await db.storage.from("frames").upload(name, buf, { contentType: "image/jpeg" });
      if (up.error) throw new Error("Couldn't upload a sampled frame for reverse-image search.");
      names.push(name);
      return db.storage.from("frames").getPublicUrl(name).data.publicUrl;
    }))).filter((u): u is string => !!u);

    await Promise.all([
      ...urls.map(async (u) => { out.lens.push(...lensHits(await serp({ engine: "google_lens", url: u, type: "visual_matches" }))); tick(); }),
      ...(yandexOn ? urls.slice(0, 3).map(async (u) => { out.yandex.push(...yandexHits(await serp({ engine: "yandex_images", url: u }))); tick(); }) : []),
    ]);
    out.text = await textEngines(frames, textClues, tick);
  } finally {
    if (names.length) {
      try {
        const { error } = await db.storage.from("frames").remove(names);
        if (error) console.error("Sampled-frame cleanup failed:", error);
      } catch (error) {
        console.error("Sampled-frame cleanup failed:", error);
      }
    }
  }
  return out;
}

export async function discover({ frames, source, textClues, onProgress }: DiscoveryInput): Promise<DiscoveryOutput> {
  const serp = !!process.env.SERPAPI_KEY;
  const yandexOn = serp && process.env.YANDEX_SEARCH !== "off";
  const maxReverse = 10;
  const reverseFrames = Math.min(frames.length, maxReverse);
  const total = Math.ceil(frames.length / 16) + (serp ? reverseFrames + (yandexOn ? Math.min(reverseFrames, 3) : 0) + 1 : 0);
  let done = 0;
  const tick = (msg: string) => onProgress(Math.min(0.99, ++done / total), msg);

  const cands = new Map<string, Cand>();
  const counts: Partial<Record<EngineId, number>> = {};
  const selfKey = source ? `${source.platform}:${source.videoId}` : "";
  const add = (page: string, engine: EngineId, thumb?: string, title?: string) => {
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

  const batches = Array.from({ length: Math.ceil(frames.length / 16) }, (_, i) => frames.slice(i * 16, (i + 1) * 16));
  const [webs, img] = await Promise.all([
    Promise.all(batches.map(async (batch) => {
      const result = await webInfoMany(batch);
      tick("Google Vision frame matches");
      return result;
    })),
    imageEngines(frames, textClues, () => tick("Reverse image and video search")),
  ]);
  for (const batch of webs) {
    for (const w of batch) {
      for (const pg of w?.pages ?? []) add(pg.url, "google_vision", undefined, pg.title);
    }
  }
  for (const m of img.lens) add(m.link, "google_lens", m.thumb, m.title);
  for (const m of img.yandex) add(m.link, "yandex", m.thumb, m.title);
  for (const m of img.text) add(m.link, "text_search", m.thumb, m.title);

  return {
    cands,
    engines: [
      { id: "google_vision", enabled: true, hits: counts.google_vision ?? 0 },
      { id: "google_lens", enabled: serp, hits: counts.google_lens ?? 0 },
      { id: "yandex", enabled: yandexOn, hits: counts.yandex ?? 0 },
      { id: "text_search", enabled: serp, hits: counts.text_search ?? 0 },
    ],
  };
}
