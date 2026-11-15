/** Platform detection + metadata lookup for YouTube, TikTok, Instagram and Facebook video links. */
export type Platform = "youtube" | "tiktok" | "instagram" | "facebook" | "vimeo";

export interface VideoInfo {
  platform: Platform; url: string; title: string; author: string;
  thumbs: string[];            // frames we can send to reverse image search
  publishedAt?: string; duration?: number; views?: number; description?: string; videoId: string;
}

// Only URLs that point at an actual video page count.
const PATTERNS: Record<Platform, RegExp> = {
  youtube: /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  tiktok: /tiktok\.com\/.*video\/(\d+)/,
  vimeo: /vimeo\.com\/(?:.*\/)?(\d{6,})/,
  instagram: /instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/,
  facebook: /(?:facebook\.com\/(?:.*\/videos\/|watch\/?\?v=|reel\/|share\/[vr]\/)|fb\.watch\/)([\w-]+)/,
};

export function parseVideoUrl(url: string): { platform: Platform; id: string } | null {
  for (const p of Object.keys(PATTERNS) as Platform[]) {
    const m = PATTERNS[p].exec(url);
    if (m) return { platform: p, id: m[1] };
  }
  return null;
}

/** TikTok and Instagram IDs embed their creation time, which gives a date without any API. */
export function dateFromId(platform: Platform, id: string): string | undefined {
  try {
    if (platform === "tiktok") return new Date(Number(BigInt(id) >> BigInt(32)) * 1000).toISOString();
    if (platform === "instagram") {
      const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let n = BigInt(0);
      for (const ch of id.slice(0, 11)) n = n * BigInt(64) + BigInt(abc.indexOf(ch));
      return new Date(Number(n >> BigInt(23)) + 1314220021721).toISOString();
    }
  } catch {}
  return undefined;
}

const seconds = (iso: string) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso) ?? [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};

export async function getInfo(rawUrl: string): Promise<VideoInfo> {
  // Short TikTok links redirect to the full URL
  let url = rawUrl;
  if (/\/\/(vm|vt)\.tiktok\.com/.test(url)) url = (await fetch(url, { redirect: "follow" })).url;
  const parsed = parseVideoUrl(url);
  if (!parsed) throw new Error("That doesn't look like a YouTube, TikTok, Instagram or Facebook video link.");
  const { platform, id } = parsed;
  const base = { platform, url, videoId: id, publishedAt: dateFromId(platform, id) };

  if (platform === "youtube") {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${id}&key=${process.env.YOUTUBE_API_KEY}`).then((r) => r.json());
    const v = r.items?.[0];
    if (!v) throw new Error(r.error?.message ?? "YouTube video not found.");
    return { ...base, title: v.snippet.title, author: v.snippet.channelTitle, publishedAt: v.snippet.publishedAt,
      duration: seconds(v.contentDetails.duration), views: +v.statistics?.viewCount || 0, description: v.snippet.description,
      thumbs: [1, 2, 3].map((n) => `https://i.ytimg.com/vi/${id}/hq${n}.jpg`).concat(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`) };
  }

  if (platform === "tiktok") {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`).then((r) => r.json());
    if (!r.thumbnail_url) throw new Error("TikTok video not found or private.");
    return { ...base, title: r.title || "TikTok video", author: r.author_name, thumbs: [r.thumbnail_url] };
  }

  if (platform === "vimeo") {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`).then((r) => r.json());
    if (!r.thumbnail_url) throw new Error("Vimeo video not found or private.");
    return { ...base, title: r.title, author: r.author_name, thumbs: [r.thumbnail_url], duration: r.duration, description: r.description,
      publishedAt: r.upload_date ? new Date(String(r.upload_date).replace(" ", "T") + "Z").toISOString() : undefined };
  }

  // Instagram + Facebook: Meta's oEmbed needs an app token (see .env), og:image is the fallback.
  const token = process.env.META_APP_TOKEN;
  if (token) {
    const ep = platform === "instagram" ? "instagram_oembed" : "oembed_video";
    const r = await fetch(`https://graph.facebook.com/v21.0/${ep}?url=${encodeURIComponent(url)}&access_token=${token}`).then((r) => r.json());
    if (r.thumbnail_url) return { ...base, title: r.title || `${platform} video`, author: r.author_name ?? "", thumbs: [r.thumbnail_url] };
  }
  const html = await fetch(url, { headers: { "User-Agent": "facebookexternalhit/1.1" } }).then((r) => r.text()).catch(() => "");
  const og = /property="og:image"\s+content="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  const title = /property="og:title"\s+content="([^"]*)"/.exec(html)?.[1] ?? `${platform} video`;
  if (!og) throw new Error(`Couldn't read that ${platform} video. It may be private, or META_APP_TOKEN is missing.`);
  return { ...base, title, author: "", thumbs: [og] };
}
