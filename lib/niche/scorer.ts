// lib/niche/scorer.ts: filtering, trend scoring and selection for daily recommendations. Pure functions, no I/O.
import type { CurationCandidate } from "./api";
import { videoUrl, type YtVideo } from "./youtube";

// ---- Configuration -----------------------------------------------------------------------------
export interface ScoreWeights { velocity: number; engagement: number; outlier: number; relevance: number; recency: number; seed: number }

export interface ScoringConfig {
  maxAgeDays: number; // reject older videos
  minAgeHours: number; // reject videos too new to have a signal
  minViews: number;
  minDurationS: number;
  maxDurationS: number;
  dedupeDays: number; // don't recommend the same video again within this window
  maxPerChannel: number; // used by selectTop
  velocityFloorHours: number; // age floor when computing views per hour
  velocityReference: number; // views/hour that earns a full velocity score
  engagementReference: number; // (likes + 2*comments)/views that earns a full engagement score
  outlierReference: number; // views/subscribers ratio that earns a full outlier score
  recencyHalfLifeHours: number;
  weights: ScoreWeights; // should sum to 1
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  maxAgeDays: 7,
  minAgeHours: 1,
  minViews: 300,
  minDurationS: 5,
  maxDurationS: 3600,
  dedupeDays: 30,
  maxPerChannel: 2,
  velocityFloorHours: 6,
  velocityReference: 5000,
  engagementReference: 0.08,
  outlierReference: 10,
  recencyHalfLifeHours: 48,
  weights: { velocity: 0.3, engagement: 0.15, outlier: 0.15, relevance: 0.2, recency: 0.1, seed: 0.1 },
};

// ---- Types -------------------------------------------------------------------------------------
export interface NicheTarget { id: string; keywords: readonly string[]; excludeTerms: readonly string[] }

export interface ScoringContext {
  niche: NicheTarget;
  now?: Date;
  /** Keys from buildSeenSet(): videos already recommended inside the dedupe window. */
  seen: ReadonlySet<string>;
  blockedChannelIds: ReadonlySet<string>;
  /** Followed channels (connected, manual, similar) mapped to similarity in [0, 1]. Use 1 for the user's own and manual ones. */
  followedChannels: ReadonlyMap<string, number>;
  /** Subscriber counts when known (null = hidden). Missing entries are treated as unknown. */
  channelSubscribers: ReadonlyMap<string, number | null>;
}

export type RejectReason =
  | "live_or_upcoming" | "blocked_channel" | "duplicate_in_batch" | "recently_recommended"
  | "too_new" | "too_old" | "too_short" | "too_long" | "low_views" | "excluded_term";
export interface Rejection { videoId: string; reason: RejectReason }
export interface FilterResult { kept: YtVideo[]; rejected: Rejection[] }

export interface ScoreBreakdown { velocity: number; engagement: number; outlier: number; relevance: number; recency: number; seed: number }
export interface ScoredVideo {
  video: YtVideo;
  nicheId: string;
  score: number; // 0-100, three decimals
  breakdown: ScoreBreakdown; // each component in [0, 1]
  viewsPerHour: number;
  matchedKeywords: string[];
  fromChannelId: string | null; // set when the channel is followed or similar
}

export interface SelectOptions { count: number; maxPerChannel?: number }

// ---- Text matching -----------------------------------------------------------------------------
export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds a matcher for whole words and phrases, ignoring case and accents.
 * Returns the original terms that appear in the text.
 */
export function termMatcher(terms: readonly string[]): (text: string) => string[] {
  const seen = new Set<string>();
  const compiled: { original: string; re: RegExp }[] = [];
  for (const original of terms) {
    const norm = normalize(original);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    compiled.push({ original, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(norm)}(?![\\p{L}\\p{N}])`, "u") });
  }
  return (text) => {
    const haystack = normalize(text);
    return compiled.filter((c) => c.re.test(haystack)).map((c) => c.original);
  };
}

const excludeHaystack = (v: YtVideo) => `${v.title}\n${v.channelTitle}\n${v.tags.join(" ")}\n${v.description.slice(0, 300)}`;
const keywordHaystack = (v: YtVideo) => `${v.title}\n${v.tags.join(" ")}\n${v.description.slice(0, 500)}`;

// ---- Deduplication -----------------------------------------------------------------------------
export const seenKey = (platform: string, videoId: string) => `${platform}:${videoId}`;

/** Set of videos recommended within the last `days` days. Pass rows from daily_recommendations. */
export function buildSeenSet(
  rows: readonly { platform: string; video_id: string; recommended_on: string }[],
  today: Date | string = new Date(),
  days: number = DEFAULT_SCORING_CONFIG.dedupeDays,
): Set<string> {
  const end = new Date(today).getTime();
  const cutoff = end - days * 86_400_000;
  const set = new Set<string>();
  for (const r of rows) {
    const t = Date.parse(r.recommended_on);
    if (!Number.isNaN(t) && t >= cutoff) set.add(seenKey(r.platform, r.video_id));
  }
  return set;
}

// ---- Filtering ---------------------------------------------------------------------------------
export function filterCandidates(
  videos: readonly YtVideo[],
  ctx: ScoringContext,
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
): FilterResult {
  const now = (ctx.now ?? new Date()).getTime();
  const matchExcluded = termMatcher(ctx.niche.excludeTerms);
  const inBatch = new Set<string>();
  const kept: YtVideo[] = [];
  const rejected: Rejection[] = [];

  for (const v of videos) {
    const reject = (reason: RejectReason) => void rejected.push({ videoId: v.id, reason });
    if (v.isLive) { reject("live_or_upcoming"); continue; }
    if (ctx.blockedChannelIds.has(v.channelId)) { reject("blocked_channel"); continue; }
    if (inBatch.has(v.id)) { reject("duplicate_in_batch"); continue; }
    if (ctx.seen.has(seenKey("youtube", v.id))) { reject("recently_recommended"); continue; }

    const published = Date.parse(v.publishedAt);
    const ageHours = (now - published) / 3_600_000;
    if (Number.isNaN(published) || ageHours > cfg.maxAgeDays * 24) { reject("too_old"); continue; }
    if (ageHours < cfg.minAgeHours) { reject("too_new"); continue; }

    if (v.durationS !== null) {
      if (v.durationS < cfg.minDurationS) { reject("too_short"); continue; }
      if (v.durationS > cfg.maxDurationS) { reject("too_long"); continue; }
    }
    if (v.viewCount < cfg.minViews) { reject("low_views"); continue; }
    if (matchExcluded(excludeHaystack(v)).length > 0) { reject("excluded_term"); continue; }

    inBatch.add(v.id);
    kept.push(v);
  }
  return { kept, rejected };
}

// ---- Scoring -----------------------------------------------------------------------------------
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const logScale = (value: number, reference: number) => clamp01(Math.log10(1 + Math.max(value, 0)) / Math.log10(1 + reference));

export function scoreVideo(
  video: YtVideo,
  ctx: ScoringContext,
  matchedKeywords: string[],
  cfg: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ScoredVideo {
  const now = (ctx.now ?? new Date()).getTime();
  const ageHours = Math.max((now - Date.parse(video.publishedAt)) / 3_600_000, 0);
  const viewsPerHour = video.viewCount / Math.max(ageHours, cfg.velocityFloorHours);

  const engagementRate = video.likeCount === null ? null : (video.likeCount + 2 * (video.commentCount ?? 0)) / Math.max(video.viewCount, 1);
  const subs = ctx.channelSubscribers.get(video.channelId) ?? null;
  const similarity = ctx.followedChannels.get(video.channelId);

  const breakdown: ScoreBreakdown = {
    velocity: logScale(viewsPerHour, cfg.velocityReference),
    engagement: engagementRate === null ? 0.3 : clamp01(engagementRate / cfg.engagementReference), // neutral-low when likes are hidden
    outlier: subs === null ? 0.35 : logScale(video.viewCount / Math.max(subs, 1000), cfg.outlierReference), // neutral when unknown
    relevance: clamp01(matchedKeywords.length / Math.min(Math.max(ctx.niche.keywords.length, 1), 3)),
    recency: 0.5 ** (ageHours / cfg.recencyHalfLifeHours),
    seed: similarity === undefined ? 0 : 0.5 + 0.5 * clamp01(similarity),
  };
  const w = cfg.weights;
  const score =
    100 * (w.velocity * breakdown.velocity + w.engagement * breakdown.engagement + w.outlier * breakdown.outlier +
           w.relevance * breakdown.relevance + w.recency * breakdown.recency + w.seed * breakdown.seed);

  return {
    video,
    nicheId: ctx.niche.id,
    score: round3(score),
    breakdown,
    viewsPerHour: Math.round(viewsPerHour),
    matchedKeywords,
    fromChannelId: similarity === undefined ? null : video.channelId,
  };
}

/** Scores videos (already filtered) for one niche, best first. */
export function scoreVideos(videos: readonly YtVideo[], ctx: ScoringContext, cfg: ScoringConfig = DEFAULT_SCORING_CONFIG): ScoredVideo[] {
  const matchKeywords = termMatcher(ctx.niche.keywords);
  return videos.map((v) => scoreVideo(v, ctx, matchKeywords(keywordHaystack(v)), cfg)).sort((a, b) => b.score - a.score);
}

/** Filter, then score. One call per niche. */
export function curate(videos: readonly YtVideo[], ctx: ScoringContext, cfg: ScoringConfig = DEFAULT_SCORING_CONFIG) {
  const { kept, rejected } = filterCandidates(videos, ctx, cfg);
  return { scored: scoreVideos(kept, ctx, cfg), rejected };
}

// ---- Selection ---------------------------------------------------------------------------------
/** Picks `count` videos round-robin across niches (best niche first), at most `maxPerChannel` per channel, no repeated videos. */
export function selectTop(scored: readonly ScoredVideo[], opts: SelectOptions): ScoredVideo[] {
  const maxPerChannel = opts.maxPerChannel ?? DEFAULT_SCORING_CONFIG.maxPerChannel;
  const queues: ScoredVideo[][] = [];
  const queueOf = new Map<string, number>();
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    let i = queueOf.get(s.nicheId);
    if (i === undefined) { i = queues.length; queueOf.set(s.nicheId, i); queues.push([]); }
    queues[i].push(s);
  }

  const picked: ScoredVideo[] = [];
  const perChannel = new Map<string, number>();
  const ids = new Set<string>();
  let progressed = true;
  while (picked.length < opts.count && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= opts.count) break;
      while (queue.length > 0) {
        const c = queue.shift() as ScoredVideo;
        if (ids.has(c.video.id) || (perChannel.get(c.video.channelId) ?? 0) >= maxPerChannel) continue;
        picked.push(c);
        ids.add(c.video.id);
        perChannel.set(c.video.channelId, (perChannel.get(c.video.channelId) ?? 0) + 1);
        progressed = true;
        break;
      }
    }
  }
  return picked;
}

// ---- Output ------------------------------------------------------------------------------------
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** One-line explanation shown on the card, for example: 12K views/hr · matches "badminton tips" · from a similar channel. */
export function buildReason(s: ScoredVideo, ctx: Pick<ScoringContext, "followedChannels">): string {
  const parts = [`${compact.format(s.viewsPerHour)} views/hr`];
  if (s.matchedKeywords.length) parts.push(`matches ${s.matchedKeywords.slice(0, 2).map((k) => `"${k}"`).join(", ")}`);
  if (s.breakdown.outlier >= 0.7) parts.push("outperforming its channel");
  const sim = ctx.followedChannels.get(s.video.channelId);
  if (sim !== undefined) parts.push(sim >= 1 ? "from a channel you follow" : "from a similar channel");
  return parts.join(" · ");
}

export function toCandidate(s: ScoredVideo): CurationCandidate {
  return {
    platform: "youtube",
    video_id: s.video.id,
    url: videoUrl(s.video.id),
    title: s.video.title,
    channel_id: s.video.channelId,
    channel_title: s.video.channelTitle,
    thumbnail_url: s.video.thumbnailUrl,
    published_at: s.video.publishedAt,
    duration_s: s.video.durationS,
    view_count: s.video.viewCount,
    like_count: s.video.likeCount,
    niche_id: s.nicheId,
    matched_keywords: s.matchedKeywords,
    from_channel_id: s.fromChannelId,
    trend_score: s.score,
  };
}
