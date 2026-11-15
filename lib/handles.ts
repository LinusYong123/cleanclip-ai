/* eslint-disable @typescript-eslint/no-explicit-any */
import { textSearch, type TextHit } from "./queries";

export type Platform = "tiktok" | "instagram" | "youtube" | "facebook" | "unknown";
/** kind: credit = explicit attribution ("cc @x", "yt: x", a profile link); watermark = burned into the frames; mention = a bare @name */
export type Handle = { handle: string; platform: Platform; source: string; kind: "credit" | "watermark" | "mention" };

const PLAT = "tiktok|tt|instagram|insta|ig|youtube|yt|facebook|fb";
const NAME = "[A-Za-z0-9._]{2,30}";
const platOf = (w: string): Platform => /^(tiktok|tt)$/i.test(w) ? "tiktok" : /^(instagram|insta|ig)$/i.test(w) ? "instagram" : /^(youtube|yt)$/i.test(w) ? "youtube" : "facebook";
const STOP = new Set(["gmail", "yahoo", "hotmail", "outlook", "everyone", "channel", "here", "you", "all", "this", "that", "me"]);
const RANK = { credit: 0, watermark: 1, mention: 2 } as const;

/** Pulls creator handles out of titles, descriptions, comments and on-screen (OCR) text. */
export function extractHandles(texts: { src: string; t: string }[]): Handle[] {
  const found = new Map<string, Handle>();
  const keep = (name: string, platform: Platform, src: string, kind: Handle["kind"]) => {
    const n = name.replace(/[._]+$/, "");
    if (n.length < 3 || /^\d+$/.test(n) || STOP.has(n.toLowerCase())) return;
    const key = n.toLowerCase(), prev = found.get(key);
    const better = !prev || RANK[kind] < RANK[prev.kind] || (prev.platform === "unknown" && platform !== "unknown");
    if (better) found.set(key, { handle: "@" + n, platform: platform !== "unknown" ? platform : prev?.platform ?? "unknown", source: prev && RANK[prev.kind] <= RANK[kind] ? prev.source : src, kind: prev && RANK[prev.kind] < RANK[kind] ? prev.kind : kind });
  };
  for (const { src, t } of texts) {
    if (!t) continue;
    const frame = src === "frame";
    for (const m of t.matchAll(new RegExp(`\\b(${PLAT})\\b\\s*(?:[:\\-–]\\s*@?|\\s+@)(${NAME})`, "gi"))) keep(m[2], platOf(m[1]), src, frame ? "watermark" : "credit");
    for (const m of t.matchAll(new RegExp(`\\b(?:cc|credits?|via|source|original|by|from|repost(?:ed)? from|dc|clip by|video by)\\b\\s*[:\\-–]?\\s*@(${NAME})`, "gi"))) keep(m[1], "unknown", src, "credit");
    for (const m of t.matchAll(/tiktok\.com\/@([\w.]{2,30})/gi)) keep(m[1], "tiktok", src, "credit");
    for (const m of t.matchAll(/instagram\.com\/(?!p\/|reels?\/|tv\/|explore|stories|accounts)([\w.]{3,30})/gi)) keep(m[1], "instagram", src, "credit");
    for (const m of t.matchAll(/youtube\.com\/@([\w.-]{2,40})/gi)) keep(m[1], "youtube", src, "credit");
    for (const m of t.matchAll(new RegExp(`(?:^|[\\s(,])@(${NAME})`, "gm"))) keep(m[1], "unknown", src, frame ? "watermark" : "mention");
  }
  return [...found.values()];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Is this handle just the uploader's own account? */
export function isSelf(handle: string, author: string) {
  const a = norm(author), h = norm(handle);
  return !!a && !!h && (a === h || (h.length >= 4 && a.includes(h)) || (a.length >= 4 && h.includes(a)));
}

/** Handles worth tracing next: explicit credits and watermarks that aren't the uploader's own account, strongest first. */
export const pickTargets = (handles: Handle[], author: string) =>
  handles.filter((h) => h.kind !== "mention" && !isSelf(h.handle, author)).sort((a, b) => RANK[a.kind] - RANK[b.kind]);

/** Search strings aimed straight at each target's platform. */
export function nextQueries(targets: Handle[], phrase: string) {
  const q = phrase.slice(0, 80).trim();
  return targets.slice(0, 3).map((h) => {
    const n = h.handle.slice(1);
    switch (h.platform) {
      case "tiktok": return `site:tiktok.com/@${n} ${q}`.trim();
      case "instagram": return `site:instagram.com ${n} ${q}`.trim();
      case "youtube": return `"@${n}" ${q} site:youtube.com`.trim();
      case "facebook": return `site:facebook.com ${n} ${q}`.trim();
      default: return `"@${n}" ${q} original`.trim();
    }
  });
}

/** Runs the next trace step for one handle: its YouTube channel via the API, and/or Google Videos with a site: query (needs SERPAPI_KEY). */
export async function searchHandle(h: Handle, phrase: string): Promise<TextHit[]> {
  const n = h.handle.slice(1), out: TextHit[] = [], yt = process.env.YOUTUBE_API_KEY;
  if ((h.platform === "youtube" || h.platform === "unknown") && yt) {
    try {
      const c = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent("@" + n)}&key=${yt}`).then((r) => r.json());
      const id = c.items?.[0]?.id;
      if (id) {
        const s = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&channelId=${id}&q=${encodeURIComponent(phrase)}&maxResults=5&key=${yt}`).then((r) => r.json());
        out.push(...(s.items ?? []).map((i: any) => ({ link: `https://www.youtube.com/watch?v=${i.id.videoId}`, title: i.snippet.title, channel: i.snippet.channelTitle,
          date: i.snippet.publishedAt, thumbnail: i.snippet.thumbnails?.medium?.url })));
      }
    } catch { /* ignore */ }
  }
  if (process.env.SERPAPI_KEY && h.platform !== "youtube") out.push(...(await textSearch(nextQueries([h], phrase)[0])));
  return out;
}
