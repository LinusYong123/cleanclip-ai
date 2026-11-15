// Stage 3: deep multi-signal verification of one candidate.
// Four independent signals: visual look-alike, search-engine agreement, on-screen text (OCR), and metadata (title, description, length).
import sharp from "sharp";
import { getInfo, parseVideoUrl } from "@/lib/platforms";
import { cleanliness } from "@/lib/vision";
import { fetchBuf } from "@/lib/frames";
import { prepareFrame, signature, similarity, type Sig } from "@/lib/frameQuality";
import { classify } from "@/lib/sources";
import { buildReasons, combine, engineSignal, keywordOverlap, overlap, tokens } from "./signals";
import type { Cand, Signals, Verified } from "./types";

export interface VerifyContext {
  ours: Sig[]; // signatures of our key frames
  searched: number; // number of key frames
  ourTokens: Set<string>; // words seen on screen in our frames
  keywords: string[]; // what the scene is about (AI keywords plus the title's core words)
  clipDuration: number | null; // seconds, when known
  selfDate?: string; // upload date of the submitted video, when known
}

export async function verifyCandidate(url: string, c: Cand, vc: VerifyContext, via?: string): Promise<Verified | null> {
  const info = await getInfo(url).catch(() => null);
  const thumb = info?.thumbs[0] ?? c.thumb;
  if (!thumb) return null;
  const p = parseVideoUrl(url);
  if (!p) return null;
  const raw = await fetchBuf(thumb).catch(() => null);

  // Signal 1: visual look-alike (also tries a mirrored copy)
  let sim = 0, mirrored = false;
  if (raw) {
    try {
      const prep = await prepareFrame(raw);
      const simOf = async (b: Buffer) => { const s = await signature(b); return Math.max(...vc.ours.map((o) => similarity(o, s))); };
      sim = await simOf(prep);
      const flipped = await simOf(await sharp(prep).flop().toBuffer());
      if (flipped > sim + 0.15) { sim = flipped; mirrored = true; }
    } catch { /* keep 0 */ }
  }

  // Signal 3: text on screen in the candidate's thumbnail vs text in our frames (also reads logos and captions for cleanliness)
  const clean = await cleanliness(raw ?? thumb).catch(() => null);
  const ocr = clean ? overlap(vc.ourTokens, tokens(clean.fullText)) : null;

  // Signal 4: metadata (subject words in the title and description, and whether the video is long enough to contain the clip)
  const title = info?.title ?? c.title ?? "";
  const cls = classify(title, info?.author ?? "", info?.description ?? "");
  const metadata = keywordOverlap(`${title} ${(info?.description ?? "").slice(0, 600)} ${info?.author ?? ""}`, vc.keywords);
  const durationOk = info?.duration && vc.clipDuration ? info.duration >= vc.clipDuration * 0.9 : null;

  const signals: Signals = {
    visual: Math.round(sim * 100),
    engines: engineSignal(c.engines.size, c.hits, vc.searched), // Signal 2
    ocr: ocr === null ? null : Math.round(ocr * 100),
    metadata: metadata === null ? null : Math.round(metadata * 100),
    duration_ok: durationOk,
  };

  // Combine, then apply provenance adjustments
  let score = combine(signals);
  if (cls.compilation) score -= cls.channelFlag ? 40 : 30; // edits, clips, reactions, top-N re-uploads
  if (cls.official) score += 10; // studios, developers, news archives, stock libraries
  if (p.platform === "vimeo") score += 5;
  if (via && sim >= 0.5) score += 20; // credited by a compilation and looks like our footage
  if (c.handle && sim >= 0.5) score += 15; // found on the credited creator's own pages
  score = Math.max(0, Math.min(100, Math.round(score)));

  const engines = [...c.engines];
  return {
    url, platform: p.platform, videoId: p.id, title, author: info?.author ?? "", publishedAt: info?.publishedAt, thumbnail: thumb,
    similarity: signals.visual, score, confidence: score >= 65 ? "high" : score >= 35 ? "medium" : "low",
    clean: clean ? { hasText: clean.hasText, hasLogo: clean.hasLogo, text: clean.text, fullText: "", score: clean.score } : null,
    compilation: cls.compilation, official: cls.official, mirrored, foundVia: via, byHandle: c.handle, engines, signals,
    reasons: buildReasons({ signals, engines, similarity: signals.visual, publishedAt: info?.publishedAt, selfDate: vc.selfDate, official: cls.official,
      compilation: cls.compilation, mirrored, via, handle: c.handle }),
    _links: cls.links, attrib: cls.attrib, _text: `${title}\n${info?.description ?? ""}`,
  };
}
