/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 2: multi-engine discovery.
// Google Vision, Google Lens, and Yandex search only the sampled video frames.
import { createClient } from "@supabase/supabase-js";
import { webInfoMany } from "@/lib/vision";
import { parseVideoUrl, type Platform } from "@/lib/platforms";
import { lensHits, yandexHits, type Hit } from "./parse";
import type { Cand, EngineId } from "./types";

export interface DiscoveryInput {
  frames: Buffer[];
  source: { platform: Platform; videoId: string } | null;
  onProgress: (fraction: number, message: string) => void;
}
export interface DiscoveryOutput {
  cands: Map<string, Cand>;
  queries?: { A: string; B: string; C: string };
  scene?: null;
  engines: { id: EngineId; enabled: boolean; hits: number }[];
}

/**
 * Reverse-image engines need public image URLs. Use up to four frames spaced across the video;
 * Google Vision checks every sampled frame separately.
 */
async function imageEngines(frames: Buffer[], tick: () => void) {
  const out = { lens: [] as Hit[], yandex: [] as Hit[] };
  const key = process.env.SERPAPI_KEY;
  if (!key) return out;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const names: string[] = [];
  const indexes = frames.length <= 4
    ? frames.map((_, i) => i)
    : Array.from({ length: 4 }, (_, i) => Math.round(i * (frames.length - 1) / 3));
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

export async function discover({ frames, source, onProgress }: DiscoveryInput): Promise<DiscoveryOutput> {
  const serp = !!process.env.SERPAPI_KEY;
  const yandexOn = serp && process.env.YANDEX_SEARCH !== "off";
  const reverseFrames = Math.min(frames.length, 4);
  const total = Math.ceil(frames.length / 16) + (serp ? reverseFrames + (yandexOn ? Math.min(reverseFrames, 3) : 0) : 0);
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
    imageEngines(frames, () => tick("Reverse image search")),
  ]);
  for (const batch of webs) {
    for (const w of batch) {
      for (const pg of w?.pages ?? []) add(pg.url, "google_vision", undefined, pg.title);
    }
  }
  for (const m of img.lens) add(m.link, "google_lens", m.thumb, m.title);
  for (const m of img.yandex) add(m.link, "yandex", m.thumb, m.title);

  return {
    cands,
    engines: [
      { id: "google_vision", enabled: true, hits: counts.google_vision ?? 0 },
      { id: "google_lens", enabled: serp, hits: counts.google_lens ?? 0 },
      { id: "yandex", enabled: yandexOn, hits: counts.yandex ?? 0 },
    ],
  };
}
