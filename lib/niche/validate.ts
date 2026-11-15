// lib/niche/validate.ts: input validation shared by the niche API routes.

export type TermsResult = { ok: true; terms: string[] } | { ok: false; message: string };

/** Trims, collapses whitespace, drops blanks and case-insensitive duplicates, then enforces length and count limits. */
export function cleanTerms(input: unknown, opts: { label: string; max: number; minLen: number; maxLen: number }): TermsResult {
  if (!Array.isArray(input)) return { ok: false, message: `${opts.label} must be a list.` };
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return { ok: false, message: `${opts.label} must be text.` };
    const t = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length < opts.minLen || t.length > opts.maxLen) {
      return { ok: false, message: `Each item in ${opts.label} must be ${opts.minLen}-${opts.maxLen} characters ("${t.slice(0, 20)}").` };
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
  if (terms.length > opts.max) return { ok: false, message: `${opts.label}: at most ${opts.max} items (you entered ${terms.length}).` };
  return { ok: true, terms };
}

export function isTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
