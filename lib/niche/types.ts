// lib/niche/types.ts: row types mirror niche_schema.sql (snake_case, ISO timestamp strings).

export const SOCIAL_PLATFORMS = ["youtube", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
/** Platforms a source link can live on (everything the existing trace pipeline understands). */
export type VideoPlatform = SocialPlatform | "instagram" | "facebook" | "vimeo";

export const NICHE_LIMITS = {
  keywordsPerNiche: 10,
  excludeTerms: 10,
} as const;

export type ConnectionStatus = "active" | "expired" | "revoked" | "error";
export type ChannelSource = "connected" | "similar" | "manual";
export type RunStatus = "running" | "succeeded" | "partial" | "failed";
export type CardTraceStatus = "queued" | "processing" | "ready" | "failed" | "skipped";
export type TraceStatus = "queued" | "processing" | "succeeded" | "failed";
export type LinkRole = "primary" | "candidate" | "compilation" | "creator_page";
export type Confidence = "high" | "medium" | "low";
export type LinkStatus = "unchecked" | "live" | "unavailable" | "private" | "removed" | "error";

// ---- User-editable ----------------------------------------------------------------------
/** Reload bookkeeping only. Every plan gets the same limits (see lib/niche/config.ts). */
export interface NichePreferences {
  user_id: string;
  last_reload_at: string | null;
  reload_count_date: string | null; // YYYY-MM-DD (UTC)
  reload_count: number; // reloads used on reload_count_date
  created_at: string;
  updated_at: string;
}

export interface Niche {
  id: string;
  user_id: string;
  label: string;
  keywords: string[]; // 1-10
  exclude_terms: string[]; // 0-10
  language: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---- Connected accounts and channels ------------------------------------------------------
/** Never includes tokens. Those live in social_connection_secrets and are server-only. */
export interface SocialConnection {
  id: string;
  user_id: string;
  platform: SocialPlatform;
  platform_user_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  scopes: string[];
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Server-only. */
export interface SocialConnectionSecret {
  connection_id: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  updated_at: string;
}

export interface NicheChannel {
  id: string;
  user_id: string;
  niche_id: string | null;
  connection_id: string | null;
  platform: SocialPlatform;
  channel_id: string;
  handle: string | null;
  title: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  source: ChannelSource;
  similarity: number | null; // 0-1
  is_blocked: boolean;
  discovered_at: string;
  last_checked_at: string | null;
}

// ---- Pipeline output ------------------------------------------------------------------------
export interface CurationRun {
  id: string;
  user_id: string;
  run_date: string;
  status: RunStatus;
  candidates_found: number;
  selected: number;
  quota_units_used: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface DailyRecommendation {
  id: string;
  user_id: string;
  niche_id: string | null;
  run_id: string | null;
  recommended_on: string; // YYYY-MM-DD (UTC) the idea was created
  batch_id: string | null; // ideas created by one reload share a batch
  batch_at: string;
  rank: number; // position within its batch
  platform: SocialPlatform;
  video_id: string;
  url: string;
  title: string;
  channel_id: string | null;
  channel_title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_s: number | null;
  view_count: number | null;
  like_count: number | null;
  trend_score: number | null;
  reason: string | null;
  matched_keywords: string[];
  trace_status: CardTraceStatus; // ideas start as 'skipped' = not traced yet
  is_saved: boolean;
  is_dismissed: boolean;
  viewed_at: string | null;
  created_at: string;
}

/** Same shapes the existing /api/trace result already produces. */
export interface TraceQueries { A: string; B: string; C: string }
export interface FoundHandle { handle: string; platform: SocialPlatform | "instagram" | "facebook" | "unknown"; source: string; kind: "credit" | "watermark" | "mention" }
export interface SourceTracingJson {
  found_handles: FoundHandle[];
  is_likely_original: boolean;
  next_search_queries: string[];
  type?: "original" | "re-upload" | "compilation" | "reaction";
  primary_target?: string | null;
}
export interface TraceCost { vision_calls: number; gemini_calls: number; serpapi_calls: number; youtube_units: number }

export interface RecommendationTrace {
  id: string;
  recommendation_id: string;
  attempt: number;
  status: TraceStatus;
  classification: string | null;
  frames_used: number | null;
  scene_summary: string | null;
  keywords: string[];
  queries: TraceQueries | null;
  source_tracing: SourceTracingJson | null;
  primary_link_id: string | null;
  clip_start_s: number | null;
  clip_end_s: number | null;
  cost: TraceCost | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface SourceLink {
  id: string;
  trace_id: string;
  url: string;
  platform: VideoPlatform | null;
  video_id: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  role: LinkRole;
  score: number | null; // 0-100
  confidence: Confidence | null;
  similarity: number | null; // 0-100
  is_official: boolean;
  is_mirrored: boolean;
  found_via: string | null;
  link_status: LinkStatus;
  http_status: number | null;
  check_attempts: number;
  last_checked_at: string | null;
}

// ---- Inputs the API will accept ---------------------------------------------------------------
export type NicheInput = Pick<Niche, "label" | "keywords"> & Partial<Pick<Niche, "exclude_terms" | "language" | "is_active">>;
export type ManualChannelInput = Pick<NicheChannel, "platform" | "channel_id"> & Partial<Pick<NicheChannel, "niche_id" | "handle" | "title">>;

// ---- What the dashboard renders (assembled by one query) --------------------------------------
export interface RecommendationCard extends DailyRecommendation {
  trace: (RecommendationTrace & { primary_link: SourceLink | null; links: SourceLink[] }) | null;
}
