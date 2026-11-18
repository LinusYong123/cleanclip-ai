// Stage 4: rank candidates using visual-match evidence only.
import type { Candidate, RankedSource } from "./types";

/** `candidates` must be sorted by visual score, best first. */
export function rankVisualMatches(candidates: readonly Candidate[], opts: { max: number }) {
  const primary = candidates[0] && candidates[0].score >= 35 ? candidates[0] : null;
  const ranked: RankedSource[] = candidates.slice(0, opts.max).map((c, i) => ({
    ...c,
    rank: i + 1,
    is_primary: c === primary,
  }));
  return { original: null, primary: ranked.find((r) => r.is_primary) ?? null, ranked };
}
