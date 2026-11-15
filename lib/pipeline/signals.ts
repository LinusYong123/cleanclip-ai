// lib/pipeline/signals.ts: pure helpers for verification and ranking (no I/O, easy to test).
import { ENGINE_LABEL, type EngineId, type Signals } from "./types";

const STOP = new Set(
  "the and for you with this that from your are was have has not but can will just about into more than then them they what when where which who how our out all one two new get got its video videos watch official channel subscribe".split(" "),
);

/** Lowercase word set: accents stripped, 3+ characters, no stop words, no pure numbers. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/)) {
    if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)) out.add(t);
  }
  return out;
}

/** Overlap coefficient |A∩B| / min(|A|,|B|). Null if either side has fewer than 3 words (not enough text to judge). */
export function overlap(a: Set<string>, b: Set<string>): number | null {
  if (a.size < 3 || b.size < 3) return null;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

/** Share of the scene's keywords (as words) that appear in the candidate's text. Null without keywords. */
export function keywordOverlap(text: string, keywords: readonly string[]): number | null {
  const wanted = tokens(keywords.join(" "));
  if (wanted.size === 0) return null;
  const have = tokens(text);
  let n = 0;
  for (const t of wanted) if (have.has(t)) n++;
  return n / wanted.size;
}

/** Agreement between engines (60%) and across frames (40%), 0-100. */
export function engineSignal(engineCount: number, frameHits: number, searched: number): number {
  const engines = Math.min(engineCount, 3) / 3;
  const frames = Math.min(frameHits / Math.max(searched, 1), 1);
  return Math.round(100 * (0.6 * engines + 0.4 * frames));
}

export const WEIGHTS = { visual: 0.45, engines: 0.25, ocr: 0.1, metadata: 0.2 } as const;

/** Weighted average of the signals that exist (weights renormalised), 0-100. A too-short candidate loses 20%. */
export function combine(s: Signals): number {
  const parts: [number | null, number][] = [[s.visual, WEIGHTS.visual], [s.engines, WEIGHTS.engines], [s.ocr, WEIGHTS.ocr], [s.metadata, WEIGHTS.metadata]];
  let sum = 0, weight = 0;
  for (const [v, w] of parts) if (v !== null) { sum += v * w; weight += w; }
  const score = weight ? sum / weight : 0;
  return s.duration_ok === false ? score * 0.8 : score;
}

/** Groups consecutive items into scenes: a new scene starts when similarity to the previous item drops below the threshold. */
export function groupScenes<T>(items: readonly T[], sim: (a: T, b: T) => number, threshold: number): T[][] {
  const scenes: T[][] = [];
  items.forEach((item, k) => {
    if (k > 0 && sim(items[k - 1], item) >= threshold) scenes[scenes.length - 1].push(item);
    else scenes.push([item]);
  });
  return scenes;
}

export function humanGap(ms: number): string {
  const days = ms / 86_400_000;
  if (days >= 365) return `${(days / 365).toFixed(1)} years`;
  if (days >= 45) return `${Math.round(days / 30)} months`;
  if (days >= 1) return `${Math.round(days)} days`;
  return "hours";
}

export function buildReasons(i: {
  signals: Signals; engines: EngineId[]; similarity: number; publishedAt?: string; selfDate?: string;
  official: boolean; compilation: boolean; mirrored: boolean; via?: string; handle?: string;
}): string[] {
  const r: string[] = [];
  r.push(i.similarity >= 50 ? `Visual match ${i.similarity}%` : `Weak visual match (${i.similarity}%)`);
  if (i.engines.length) r.push(`Found by ${i.engines.length} search ${i.engines.length === 1 ? "engine" : "engines"} (${i.engines.map((e) => ENGINE_LABEL[e]).join(", ")})`);
  if (i.signals.ocr !== null && i.signals.ocr >= 40) r.push("On-screen text matches");
  if (i.signals.metadata !== null && i.signals.metadata >= 40) r.push("Title and description match the scene");
  if (i.signals.duration_ok === true) r.push("Long enough to contain your clip");
  if (i.signals.duration_ok === false) r.push("Shorter than your clip");
  if (i.publishedAt && i.selfDate && i.publishedAt < i.selfDate) r.push(`Uploaded ${humanGap(Date.parse(i.selfDate) - Date.parse(i.publishedAt))} before this video`);
  if (i.official) r.push("Official or full-length source");
  if (i.compilation) r.push("Compilation, reaction or re-upload channel (ranked down)");
  if (i.mirrored) r.push("Mirrored copy");
  if (i.via) r.push("Credited by a compilation");
  if (i.handle) r.push(`On ${i.handle}'s page`);
  return r;
}
