/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";

export const fetchBuf = async (url: string) => {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("fetch failed");
  return Buffer.from(await r.arrayBuffer());
};

/** Exact frames (with timestamps and duration) from the optional worker. Empty if not configured. */
export async function workerFrames(url: string, start: number, dur: number, n: number) {
  const none = { bufs: [] as Buffer[], times: [] as number[], duration: 0 };
  if (!process.env.WORKER_URL) return none;
  const q = new URLSearchParams({ url, start: String(start), dur: String(dur), n: String(n) });
  const r = await fetch(`${process.env.WORKER_URL}/frames?${q}`, {
    headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` }, signal: AbortSignal.timeout(52000),
  });
  if (!r.ok) throw new Error("worker failed");
  const j = await r.json();
  return { bufs: (j.frames as string[]).map((b) => Buffer.from(b, "base64")), times: j.times as number[], duration: j.duration as number };
}

/** Optional English subtitle/transcript extraction for source metadata and search context. */
export async function workerCaptions(url: string): Promise<string> {
  if (!process.env.WORKER_URL) return "";
  const q = new URLSearchParams({ url });
  const r = await fetch(`${process.env.WORKER_URL}/captions?${q}`, {
    headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` }, signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error("Caption extraction failed.");
  const j = await r.json();
  return typeof j.captions === "string" ? j.captions : "";
}

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * Google Lens via SerpApi. Every frame uses type=visual_matches (video/image sources, no shopping noise).
 * If we know the title, one extra Lens search sends it as text context (q) with the best frame.
 */
export async function lensMatches(frames: Buffer[], context?: string, onEach?: () => void) {
  if (!process.env.SERPAPI_KEY) return [];
  const db = admin(), names: string[] = [], out: { link: string; thumbnail?: string; title?: string }[] = [];
  const lens = async (img: string, extra: string) => {
    const r = await fetch(`https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(img)}${extra}&api_key=${process.env.SERPAPI_KEY}`)
      .then((r) => r.json()).catch(() => ({}));
    for (const m of r.visual_matches ?? []) out.push({ link: m.link, thumbnail: m.thumbnail, title: m.title });
  };
  const urls = (await Promise.all(frames.slice(0, 4).map(async (buf) => {
    const name = `${crypto.randomUUID()}.jpg`;
    const up = await db.storage.from("frames").upload(name, buf, { contentType: "image/jpeg" });
    if (up.error) return null;
    names.push(name);
    return db.storage.from("frames").getPublicUrl(name).data.publicUrl;
  }))).filter(Boolean) as string[];
  await Promise.all(urls.map(async (u) => { await lens(u, "&type=visual_matches"); onEach?.(); }));
  if (context && urls[0]) await lens(urls[0], `&type=all&q=${encodeURIComponent(context.slice(0, 100))}`);
  if (names.length) await db.storage.from("frames").remove(names);
  return out;
}
