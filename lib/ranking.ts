/* eslint-disable @typescript-eslint/no-explicit-any */
import sharp from "sharp";
import { annotateMany } from "./vision";

/**
 * Finds "countdown/ranking" videos: reads large on-screen numbers (#10, 9, No. 8...) and cuts
 * a new clip each time the next number appears. Returns null when no counting sequence is found.
 */
export async function detectRanking(frames: { t: number; buf: Buffer }[], duration: number) {
  if (frames.length < 6) return null;
  const res = await annotateMany(frames.map((f) => f.buf), ["TEXT_DETECTION"]);
  const reads: { t: number; n: number }[] = [];
  for (let i = 0; i < frames.length; i++) {
    const h = (await sharp(frames[i].buf).metadata()).height ?? 1;
    let best: { n: number; ht: number } | null = null;
    for (const w of (res[i]?.textAnnotations ?? []).slice(1)) {
      const m = /^#?(\d{1,2})[.):]?$/.exec(String(w.description).trim());
      if (!m) continue;
      const ys = (w.boundingPoly?.vertices ?? []).map((v: any) => v.y ?? 0);
      const ht = Math.max(...ys) - Math.min(...ys), n = +m[1];
      if (n < 1 || n > 50 || ht < h * 0.06) continue; // only large, rank-sized digits
      if (!best || ht > best.ht) best = { n, ht };
    }
    if (best) reads.push({ t: frames[i].t, n: best.n });
  }

  // Keep only readings that continue one counting direction (tolerates a missed number or two).
  let cur = 0, dir = 0;
  const marks: { t: number; n: number }[] = [];
  for (const r of reads) {
    if (!cur) { cur = r.n; marks.push(r); continue; }
    const d = r.n - cur;
    if (!d) continue;
    if (dir === 0 ? Math.abs(d) <= 2 : d * dir >= 1 && d * dir <= 3) { dir = dir || Math.sign(d); cur = r.n; marks.push(r); }
  }
  if (marks.length < 3) return null;

  const step = duration / frames.length;
  const starts = marks.map((m, i) => (i === 0 && m.t < step * 2 ? 0 : Math.max(0, m.t - step / 2)));
  const segments = marks.map((m, i) => ({ start: starts[i], end: starts[i + 1] ?? duration, label: `#${m.n}` }));
  if (segments[0].start > Math.max(5, step * 2)) segments.unshift({ start: 0, end: segments[0].start, label: "Intro" });
  return { segments, direction: dir > 0 ? "up" : "down", first: marks[0].n, last: marks[marks.length - 1].n };
}
