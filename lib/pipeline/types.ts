// lib/pipeline/types.ts: shared types for the four-stage reverse-search pipeline.
import type { Platform } from "@/lib/platforms";

export type EngineId = "google_vision" | "google_lens" | "yandex";
export const ENGINE_LABEL: Record<EngineId, string> = {
  google_vision: "Google Vision",
  google_lens: "Google Lens",
  yandex: "Yandex Images",
};

/** A candidate while it is being discovered (stage 2). */
export interface Cand {
  hits: number; // frames Google Vision matched it on
  engines: Set<EngineId>;
  thumb?: string;
  title?: string;
  handle?: string; // set when it came from a credited creator's page
}

/** Visual evidence for a candidate, each 0-100. */
export interface Signals {
  visual: number;
  engines: number;
}

export interface Candidate {
  url: string;
  platform: Platform;
  videoId: string;
  title: string;
  author: string;
  publishedAt?: string;
  thumbnail: string;
  similarity: number; // 0-100, same as signals.visual
  score: number; // 0-100
  confidence: "high" | "medium" | "low";
  clean: { hasText: boolean; hasLogo: boolean; text: string; fullText: string; score: number } | null;
  compilation: boolean;
  official: boolean;
  mirrored: boolean;
  foundVia?: string;
  byHandle?: string;
  engines: EngineId[];
  signals: Signals;
  reasons: string[];
}
/** Candidate plus fields only the pipeline needs (stripped before the result is returned). */
export type Verified = Candidate;

export interface RankedSource extends Candidate { rank: number; is_primary: boolean }
