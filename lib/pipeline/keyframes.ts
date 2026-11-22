/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 1: scene segmentation and sampling.
// Drops static (blank, flat, blurry) frames, groups the rest into scenes, keeps the best frame of each scene,
// and blurs captions and banners so the search engines see only the footage.
import sharp from "sharp";
import { barFraction, blurRegions, cropCenterWidth, hamming, hasBlurredSidebars, prepareFrame, quality, signature, similarity, type Sig } from "@/lib/frameQuality";
import { frameInsights } from "@/lib/vision";
import { RANKING_TEXT } from "@/lib/sources";
import { groupScenes } from "./signals";

const SAME_SCENE = 0.45; // consecutive frames at least this alike are the same camera setup

interface Item { b: Buffer; i: number; bad: boolean; score: number; total: number; sig?: Sig; ins?: any; W?: number; H?: number }

export interface KeyframeResult {
  frames: Buffer[];
  idx: number[]; // positions of the kept frames in the sampled sequence
  ocr: string; // on-screen text seen before overlays were blurred
  context: { text: boolean; ranking: boolean; watermark: boolean; bars: boolean; sidebars: boolean };
  stats: { sampled: number; static_dropped: number; scenes: number; kept: number; duplicate_dropped: number };
}

async function addInsights(items: Item[]) {
  if (!items.length) return;
  const ins = await frameInsights(items.map((c) => c.b)).catch(() => []);
  for (let k = 0; k < items.length; k++) {
    const x = ins[k], m = await sharp(items[k].b).metadata();
    items[k].ins = x; items[k].W = m.width!; items[k].H = m.height!;
    const cover = x ? x.boxes.reduce((s: number, bx: any) => s + bx.w * bx.h, 0) / (m.width! * m.height!) : 0;
    items[k].total = items[k].score + (x?.faces ? 25 : 0) - cover * 80; // faces help, text coverage hurts
  }
}

export async function segmentAndSample(bufs: Buffer[], want = 5): Promise<KeyframeResult> {
  const sidebars = (await Promise.all(bufs.slice(0, 3).map(hasBlurredSidebars))).filter(Boolean).length >= 2;
  let prepared = await Promise.all(bufs.map((b) => prepareFrame(b).catch(() => b)));
  if (sidebars) prepared = await Promise.all(prepared.map((b) => cropCenterWidth(b).catch(() => b)));
  const q = await Promise.all(prepared.map(quality));

  const all: Item[] = prepared.map((b, i) => ({ b, i, bad: q[i].bad, score: q[i].score, total: q[i].score }));
  const staticDropped = all.filter((x) => x.bad).length;
  let good = all.filter((x) => !x.bad);
  if (!good.length) good = all.slice(0, want).map((x) => ({ ...x, score: 1, total: 1 })); // everything looked flat: use what we have

  // Scenes: consecutive frames that look alike belong together, so repeats and static stretches collapse into one
  const sigs = await Promise.all(good.map((g) => signature(g.b)));
  good.forEach((g, k) => { g.sig = sigs[k]; });
  const scenes = groupScenes(good, (a, b) => similarity(a.sig as Sig, b.sig as Sig), SAME_SCENE);

  // Faces, text and logos for the best two frames of each scene (capped), then the best frame per scene
  const cand = scenes.flatMap((s) => [...s].sort((a, b) => b.score - a.score).slice(0, 2)).sort((a, b) => b.score - a.score).slice(0, 10);
  await addInsights(cand);

  const representatives = scenes.map((s) => [...s].sort((a, b) => b.total - a.total)[0]);
  const chosen = representatives.length <= want
    ? [...representatives]
    : Array.from({ length: want }, (_, i) =>
        representatives[Math.round(i * (representatives.length - 1) / Math.max(want - 1, 1))]);
  if (chosen.length < want) {
    // Short clips are often a single scene: add visually distinct frames from it
    const rest = good.filter((g) => !chosen.includes(g)).sort((a, b) => b.total - a.total);
    for (const g of rest) {
      if (chosen.every((c) => hamming((c.sig as Sig).h, (g.sig as Sig).h) >= 8)) chosen.push(g);
      if (chosen.length >= want) break;
    }
  }
  chosen.sort((a, b) => a.i - b.i);
  await addInsights(chosen.filter((c) => !c.ins));

  const frames = await Promise.all(chosen.map((c) => (c.ins?.boxes?.length ? blurRegions(c.b, c.ins.boxes.slice(0, 60)).catch(() => c.b) : c.b)));

  const pool = [...new Set([...cand, ...chosen])].filter((c) => c.ins);
  const n = Math.max(pool.length, 1), frac = (f: (p: Item) => boolean) => pool.filter(f).length / n;
  const bars = (await Promise.all(bufs.slice(0, 3).map(barFraction))).some((f) => f > 0.08);
  return {
    frames,
    idx: chosen.map((c) => c.i),
    ocr: pool.map((c) => c.ins?.full ?? "").join("\n"),
    context: {
      text: frac((p) => !!p.ins?.text) >= 0.4,
      ranking: frac((p) => !!p.ins?.boxes?.some((bx: any) => bx.digit && bx.h > (p.H ?? 1) * 0.06)) >= 0.25 || pool.some((p) => RANKING_TEXT.test(p.ins?.full ?? "")),
      watermark: frac((p) => (p.ins?.logos ?? 0) > 0) >= 0.25,
      bars, sidebars,
    },
    stats: { sampled: bufs.length, static_dropped: staticDropped, scenes: scenes.length, kept: chosen.length, duplicate_dropped: Math.max(0, good.length - chosen.length) },
  };
}
