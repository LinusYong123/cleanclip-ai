// Stage 4: ranked provenance. Picks the primary source (oldest upload of near-identical footage) and ranks the rest.
import type { Candidate, RankedSource } from "./types";

/** `candidates` must already exclude compilations and be sorted by score, best first. */
export function rankProvenance(candidates: readonly Candidate[], opts: { selfDate?: string; max: number }) {
  const older = (c: Candidate) => !!c.publishedAt && (!opts.selfDate || c.publishedAt < opts.selfDate);
  const oldest = (arr: readonly Candidate[]) =>
    [...arr].filter(older).sort((a, b) => (a.publishedAt as string).localeCompare(b.publishedAt as string))[0] ?? null;

  // Age rule: among near-identical footage the earliest upload is the probable original
  const original = oldest(candidates.filter((c) => c.similarity >= 55)) ?? oldest(candidates.filter((c) => c.score >= 30));
  const primary = original ?? (candidates[0] && candidates[0].score >= 35 ? candidates[0] : null);
  const ordered = primary ? [primary, ...candidates.filter((c) => c !== primary)] : [...candidates];

  const ranked: RankedSource[] = ordered.slice(0, opts.max).map((c, i) => ({
    ...c,
    rank: i + 1,
    is_primary: c === primary,
    reasons: c === original ? [...c.reasons, "Oldest upload of near-identical footage"] : c.reasons,
  }));
  return { original, primary: ranked.find((r) => r.is_primary) ?? null, ranked };
}
