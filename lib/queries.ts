/* eslint-disable @typescript-eslint/no-explicit-any */
export type TextHit = { link: string; title?: string; channel?: string; date?: string; thumbnail?: string };

/** A = visual cues, B = entities/context, C = B plus source-tracing exclusions. */
export function buildQueries(labels: string[], entities: string[], core: string) {
  const A = labels.slice(0, 6).join(" ");
  const B = [...new Set([core, ...entities].filter(Boolean))].slice(0, 3).join(" ");
  const C = `${B || A} "original video" OR "raw footage" OR "official source" -compilation -top10 -shorts -tiktok -reaction`.trim();
  return { A, B, C };
}

/** Text search: Google Videos via SerpApi if configured, otherwise the YouTube Data API (100 quota units per query). */
export async function textSearch(q: string): Promise<TextHit[]> {
  if (!q.trim()) return [];
  try {
    if (process.env.SERPAPI_KEY) {
      const r = await fetch(`https://serpapi.com/search.json?engine=google_videos&q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}`).then((r) => r.json());
      return (r.video_results ?? []).slice(0, 8).map((v: any) => ({ link: v.link, title: v.title, channel: v.channel ?? v.source, date: v.date,
        thumbnail: typeof v.thumbnail === "string" ? v.thumbnail : undefined }));
    }
    if (process.env.YOUTUBE_API_KEY) {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q=${encodeURIComponent(q.replace(/ OR /g, "|"))}&key=${process.env.YOUTUBE_API_KEY}`).then((r) => r.json());
      return (r.items ?? []).map((i: any) => ({ link: `https://www.youtube.com/watch?v=${i.id.videoId}`, title: i.snippet.title, channel: i.snippet.channelTitle,
        date: i.snippet.publishedAt, thumbnail: i.snippet.thumbnails?.medium?.url }));
    }
  } catch { /* ignore and return nothing */ }
  return [];
}

/** Top comments often carry "credit: @creator" lines. Costs 1 YouTube quota unit. */
export async function topComments(videoId: string) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=20&order=relevance&textFormat=plainText&key=${process.env.YOUTUBE_API_KEY}`).then((r) => r.json());
  return (r.items ?? []).map((i: any) => i.snippet.topLevelComment.snippet.textDisplay).join("\n");
}
