// lib/niche/api.ts: API contracts for the Niche Ideas feed. Same behaviour for every plan.
import type { Confidence, Niche } from "./types";

export type ApiErrorCode = "unauthorized" | "validation" | "rate_limited" | "not_found" | "conflict" | "upstream";
/** HTTP: 401, 400, 429, 404, 409, 502/503 */
export interface ApiError { error: { code: ApiErrorCode; message: string; field?: string } }

// ---- GET /api/niche-feed --------------------------------------------------------------------------
/** Result of a reverse search for an idea, read from the user's search history. Null until they trace it. */
export interface IdeaTrace {
  traced_at: string;
  primary_source_url: string | null;
  primary_title: string | null;
  primary_author: string | null;
  primary_published_at: string | null;
  confidence: Confidence | null;
  score: number | null; // 0-100
  is_likely_original: boolean | null;
}

export interface FeedIdea {
  id: string;
  platform: "youtube";
  video_id: string;
  url: string;
  title: string;
  channel_title: string;
  thumbnail_url: string; // placeholder when missing
  published_at: string | null;
  duration_s: number | null;
  view_count: number | null;
  trend_score: number;
  selection_reason: string;
  matched_keywords: string[];
  trace: IdeaTrace | null;
}

export interface ReloadStatus {
  reloads_left_today: number;
  reloads_per_day: number;
  cooldown_seconds: number;
  next_reload_at: string | null; // ISO, only while the cooldown is running
}

export interface NicheFeedResponse {
  ideas: FeedIdea[];
  generated_at: string | null; // when the current ideas were created
  niche: Pick<Niche, "id" | "label" | "keywords" | "exclude_terms"> | null; // the user's first niche
  has_niches: boolean;
  reload: ReloadStatus;
}

// ---- POST /api/niche-feed/reload ----------------------------------------------------------------------
export interface ReloadResponse {
  created: number; // 0 = nothing fresh matched; the reload isn't counted
  reloads_left_today: number;
  message?: string;
}

// ---- PUT /api/niche/preferences -----------------------------------------------------------------------
export interface UpdateNichePreferencesRequest {
  keywords: string[]; // 1-10
  exclude_terms: string[]; // 0-10
}
export interface UpdateNichePreferencesResponse { niche: Niche }

// ---- Used by lib/niche/scorer.ts ------------------------------------------------------------------------
export interface CurationCandidate {
  platform: "youtube";
  video_id: string;
  url: string;
  title: string;
  channel_id: string;
  channel_title: string;
  thumbnail_url: string | null;
  published_at: string;
  duration_s: number | null;
  view_count: number;
  like_count: number | null;
  niche_id: string;
  matched_keywords: string[];
  from_channel_id: string | null;
  trend_score: number;
}
