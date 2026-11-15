// lib/niche/youtube.ts: YouTube Data API v3 client for discovery. Server-side only (reads YOUTUBE_API_KEY).

const BASE = "https://www.googleapis.com/youtube/v3";
const MAX_IDS_PER_CALL = 50;
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);
const TRANSIENT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "backendError", "internalError"]);

/** Documented quota units per request type. */
export const QUOTA_COST = { search: 100, list: 1 } as const;

export class YouTubeApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
    this.name = "YouTubeApiError";
  }
}
/** Daily quota exhausted, or the per-run budget was reached. Callers should stop issuing requests. */
export class YouTubeQuotaError extends YouTubeApiError {
  constructor(message: string, status = 403) {
    super(message, status, "quotaExceeded");
    this.name = "YouTubeQuotaError";
  }
}

// ---- Public types -----------------------------------------------------------------------------
export interface YtVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string; // trimmed to 500 characters
  tags: string[];
  publishedAt: string; // ISO
  thumbnailUrl: string | null;
  durationS: number | null;
  viewCount: number;
  likeCount: number | null; // null when the owner hides likes
  commentCount: number | null;
  isLive: boolean; // live or upcoming broadcast
}

export interface YtChannel {
  id: string;
  title: string;
  handle: string | null; // "@name"
  thumbnailUrl: string | null;
  subscriberCount: number | null; // null when hidden
  videoCount: number | null;
}
export interface SimilarChannel extends YtChannel {
  /** Rank-based proxy in [0.4, 1]: YouTube's own relevance order for the keywords. Not a semantic similarity. */
  similarity: number;
}

export interface SearchHit { videoId: string; channelId: string; channelTitle: string; title: string; publishedAt: string }
export interface UploadHit { videoId: string; channelId: string; publishedAt: string }

export interface SearchVideosParams {
  query: string;
  publishedAfter: Date | string;
  publishedBefore?: Date | string;
  order?: "viewCount" | "relevance" | "date"; // default viewCount
  maxResults?: number; // 1-50, default 25
  regionCode?: string;
  relevanceLanguage?: string;
  videoDuration?: "any" | "short" | "medium" | "long";
}
export interface ChannelUploadsOptions { maxResults?: number; publishedAfter?: Date | string }
export interface FindSimilarOptions {
  keywords: readonly string[];
  excludeIds?: Iterable<string>;
  maxResults?: number; // default 10
  minSubscribers?: number;
  regionCode?: string;
  relevanceLanguage?: string;
}

export interface YouTubeClientOptions {
  apiKey?: string; // defaults to process.env.YOUTUBE_API_KEY
  quotaBudget?: number; // hard cap in units for this client's lifetime (one cron run)
  timeoutMs?: number; // default 15000
  maxRetries?: number; // default 3, for 429 / 5xx / transient errors
  fetchImpl?: typeof fetch;
}

// ---- Raw response shapes (only the fields we request) -------------------------------------------
interface RawThumb { url?: string }
interface RawThumbs { medium?: RawThumb; high?: RawThumb; default?: RawThumb }
interface RawError { error?: { message?: string; errors?: { reason?: string }[] } }
interface RawVideo {
  id?: string;
  snippet?: { publishedAt?: string; channelId?: string; channelTitle?: string; title?: string; description?: string; tags?: string[]; thumbnails?: RawThumbs; liveBroadcastContent?: string };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}
interface RawChannel {
  id?: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: RawThumbs };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
}
interface RawSearchItem { id?: { videoId?: string; channelId?: string }; snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string } }
interface RawPlaylistItem { contentDetails?: { videoId?: string; videoPublishedAt?: string } }
interface ListResponse<T> { items?: T[] }

type Params = Record<string, string | number | boolean | undefined>;

// ---- Helpers ------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** ISO 8601 duration ("PT1H2M3S", "P1DT2H") to seconds. Returns null if it can't be parsed. */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/** A channel's uploads playlist ID is its channel ID with the "UC" prefix replaced by "UU" (costs 1 unit instead of search's 100). */
export function uploadsPlaylistId(channelId: string): string | null {
  return /^UC[\w-]{22}$/.test(channelId) ? `UU${channelId.slice(2)}` : null;
}

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

const bestThumb = (t?: RawThumbs) => t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? null;

function toVideo(raw: RawVideo): YtVideo | null {
  const s = raw.snippet;
  if (!raw.id || !s?.channelId || !s.title || !s.publishedAt) return null;
  return {
    id: raw.id,
    channelId: s.channelId,
    channelTitle: s.channelTitle ?? "",
    title: s.title,
    description: (s.description ?? "").slice(0, 500),
    tags: s.tags ?? [],
    publishedAt: s.publishedAt,
    thumbnailUrl: bestThumb(s.thumbnails),
    durationS: parseDuration(raw.contentDetails?.duration),
    viewCount: num(raw.statistics?.viewCount) ?? 0,
    likeCount: num(raw.statistics?.likeCount),
    commentCount: num(raw.statistics?.commentCount),
    isLive: (s.liveBroadcastContent ?? "none") !== "none",
  };
}

function toChannel(raw: RawChannel): YtChannel | null {
  if (!raw.id || !raw.snippet?.title) return null;
  return {
    id: raw.id,
    title: raw.snippet.title,
    handle: raw.snippet.customUrl?.startsWith("@") ? raw.snippet.customUrl : null,
    thumbnailUrl: bestThumb(raw.snippet.thumbnails),
    subscriberCount: raw.statistics?.hiddenSubscriberCount ? null : num(raw.statistics?.subscriberCount),
    videoCount: num(raw.statistics?.videoCount),
  };
}

const VIDEO_FIELDS =
  "items(id,snippet(publishedAt,channelId,channelTitle,title,description,tags,thumbnails(medium/url,high/url),liveBroadcastContent),contentDetails/duration,statistics(viewCount,likeCount,commentCount))";
const CHANNEL_FIELDS = "items(id,snippet(title,customUrl,thumbnails(medium/url,high/url)),statistics(subscriberCount,hiddenSubscriberCount,videoCount))";

// ---- Client -------------------------------------------------------------------------------------
export class YouTubeClient {
  private used = 0;
  constructor(private readonly opts: YouTubeClientOptions = {}) {}

  /** Units spent by this client so far (successful requests). */
  get quotaUsed(): number {
    return this.used;
  }

  private get key(): string {
    const k = this.opts.apiKey ?? process.env.YOUTUBE_API_KEY;
    if (!k) throw new YouTubeApiError("YOUTUBE_API_KEY is not set", 500);
    return k;
  }

  private async call<T>(endpoint: string, params: Params, cost: number): Promise<T> {
    const { quotaBudget, maxRetries = 3, timeoutMs = 15_000, fetchImpl = fetch } = this.opts;
    if (quotaBudget !== undefined && this.used + cost > quotaBudget) {
      throw new YouTubeQuotaError(`Per-run quota budget of ${quotaBudget} units reached`, 429);
    }
    const url = new URL(`${BASE}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    url.searchParams.set("key", this.key);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt));
      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        lastError = err; // network error or timeout
        continue;
      }
      if (res.ok) {
        this.used += cost;
        return (await res.json()) as T;
      }
      const body = (await res.json().catch(() => null)) as RawError | null;
      const reason = body?.error?.errors?.[0]?.reason;
      const message = body?.error?.message ?? res.statusText;
      if (reason && QUOTA_REASONS.has(reason)) throw new YouTubeQuotaError(message, res.status);
      if (res.status === 429 || res.status >= 500 || (reason && TRANSIENT_REASONS.has(reason))) {
        lastError = new YouTubeApiError(message, res.status, reason);
        continue;
      }
      throw new YouTubeApiError(message, res.status, reason);
    }
    throw lastError instanceof Error ? lastError : new YouTubeApiError("YouTube request failed", 502);
  }

  /** Keyword search for videos (100 units). Returns IDs and light metadata; call getVideoDetails for statistics. */
  async searchVideos(p: SearchVideosParams): Promise<SearchHit[]> {
    const q = p.query.trim();
    if (!q) return [];
    const res = await this.call<ListResponse<RawSearchItem>>("search", {
      part: "snippet",
      type: "video",
      q,
      order: p.order ?? "viewCount",
      maxResults: Math.min(Math.max(p.maxResults ?? 25, 1), 50),
      publishedAfter: iso(p.publishedAfter),
      publishedBefore: p.publishedBefore ? iso(p.publishedBefore) : undefined,
      regionCode: p.regionCode,
      relevanceLanguage: p.relevanceLanguage,
      videoDuration: p.videoDuration && p.videoDuration !== "any" ? p.videoDuration : undefined,
      safeSearch: "moderate",
      fields: "items(id/videoId,snippet(channelId,channelTitle,title,publishedAt))",
    }, QUOTA_COST.search);
    const hits: SearchHit[] = [];
    for (const item of res.items ?? []) {
      const s = item.snippet;
      if (item.id?.videoId && s?.channelId && s.title && s.publishedAt) {
        hits.push({ videoId: item.id.videoId, channelId: s.channelId, channelTitle: s.channelTitle ?? "", title: s.title, publishedAt: s.publishedAt });
      }
    }
    return hits;
  }

  /** Recent uploads for one channel via its uploads playlist (1 unit). Newest first. */
  async getChannelUploads(channelId: string, opts: ChannelUploadsOptions = {}): Promise<UploadHit[]> {
    const playlistId = uploadsPlaylistId(channelId);
    if (!playlistId) return [];
    let res: ListResponse<RawPlaylistItem>;
    try {
      res = await this.call<ListResponse<RawPlaylistItem>>("playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: Math.min(Math.max(opts.maxResults ?? 15, 1), 50),
        fields: "items(contentDetails(videoId,videoPublishedAt))",
      }, QUOTA_COST.list);
    } catch (err) {
      if (err instanceof YouTubeApiError && err.status === 404) return []; // deleted channel or empty uploads
      throw err;
    }
    const cutoff = opts.publishedAfter ? new Date(opts.publishedAfter).getTime() : -Infinity;
    const out: UploadHit[] = [];
    for (const item of res.items ?? []) {
      const id = item.contentDetails?.videoId;
      const at = item.contentDetails?.videoPublishedAt;
      if (id && at && new Date(at).getTime() >= cutoff) out.push({ videoId: id, channelId, publishedAt: at });
    }
    return out;
  }

  /** Full metadata and statistics for any number of video IDs, batched 50 per request (1 unit each). Missing or private videos are dropped. */
  async getVideoDetails(ids: Iterable<string>): Promise<YtVideo[]> {
    const unique = [...new Set([...ids].filter(isString))];
    const batches = chunk(unique, MAX_IDS_PER_CALL);
    const results = await mapLimit(batches, 3, async (batch) => {
      const res = await this.call<ListResponse<RawVideo>>("videos", {
        part: "snippet,contentDetails,statistics",
        id: batch.join(","),
        maxResults: batch.length,
        fields: VIDEO_FIELDS,
      }, QUOTA_COST.list);
      return (res.items ?? []).map(toVideo).filter((v): v is YtVideo => v !== null);
    });
    return results.flat();
  }

  /** Channel info and subscriber counts, batched 50 per request (1 unit each). Order follows the input IDs. */
  async getChannels(ids: Iterable<string>): Promise<YtChannel[]> {
    const unique = [...new Set([...ids].filter(isString))];
    const results = await mapLimit(chunk(unique, MAX_IDS_PER_CALL), 3, async (batch) => {
      const res = await this.call<ListResponse<RawChannel>>("channels", {
        part: "snippet,statistics",
        id: batch.join(","),
        maxResults: batch.length,
        fields: CHANNEL_FIELDS,
      }, QUOTA_COST.list);
      return (res.items ?? []).map(toChannel).filter((c): c is YtChannel => c !== null);
    });
    const byId = new Map(results.flat().map((c) => [c.id, c]));
    return unique.map((id) => byId.get(id)).filter((c): c is YtChannel => c !== undefined);
  }

  /** Resolves "@handle" to a channel (1 unit). */
  async resolveHandle(handle: string): Promise<YtChannel | null> {
    const h = handle.trim().replace(/^@?/, "@");
    if (h.length < 3) return null;
    const res = await this.call<ListResponse<RawChannel>>("channels", {
      part: "snippet,statistics",
      forHandle: h,
      fields: CHANNEL_FIELDS,
    }, QUOTA_COST.list);
    const raw = res.items?.[0];
    return raw ? toChannel(raw) : null;
  }

  /** Channels related to the niche keywords (100 units for the search, plus 1 per 50 channels). */
  async findSimilarChannels(opts: FindSimilarOptions): Promise<SimilarChannel[]> {
    const q = opts.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 3).join(" ");
    if (!q) return [];
    const exclude = new Set(opts.excludeIds ?? []);
    const wanted = Math.min(Math.max(opts.maxResults ?? 10, 1), 25);
    const res = await this.call<ListResponse<RawSearchItem>>("search", {
      part: "snippet",
      type: "channel",
      q,
      maxResults: Math.min(wanted + exclude.size, 50),
      regionCode: opts.regionCode,
      relevanceLanguage: opts.relevanceLanguage,
      fields: "items(id/channelId)",
    }, QUOTA_COST.search);
    const ranked = [...new Set((res.items ?? []).map((i) => i.id?.channelId).filter(isString))].filter((id) => !exclude.has(id));
    const channels = await this.getChannels(ranked);
    const min = opts.minSubscribers ?? 0;
    const kept = channels.filter((c) => c.subscriberCount === null || c.subscriberCount >= min).slice(0, wanted);
    return kept.map((c, i) => ({ ...c, similarity: Math.round((1 - (i / Math.max(kept.length, 1)) * 0.6) * 1000) / 1000 }));
  }
}
