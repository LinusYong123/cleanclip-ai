// Stage 3: deep multi-signal verification of one candidate.
// Candidate thumbnails are compared only with sampled source-video frames.
import sharp from "sharp";
import { parseVideoUrl } from "@/lib/platforms";
import { fetchBuf } from "@/lib/frames";
import { prepareFrame, signature, similarity, type Sig } from "@/lib/frameQuality";
import { engineSignal } from "./signals";
import { ENGINE_LABEL, type Cand, type Candidate, type Signals } from "./types";

export interface VerifyContext {
  ours: Sig[]; // signatures for every sampled source frame
}

export async function verifyCandidate(url: string, c: Cand, vc: VerifyContext): Promise<Candidate | null> {
  const p = parseVideoUrl(url);
  if (!p) return null;
  const thumb = c.thumb ?? (p.platform === "youtube" ? `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` : "");
  const raw = thumb ? await fetchBuf(thumb).catch(() => {
    console.warn("Candidate preview could not be fetched; retaining the visual-search result.");
    return null;
  }) : null;

  // Compare the candidate image to every sampled frame, including a mirrored copy.
  let sim = 0, mirrored = false;
  if (raw) {
    try {
      const prep = await prepareFrame(raw);
      const simOf = async (b: Buffer) => { const s = await signature(b); return Math.max(...vc.ours.map((o) => similarity(o, s))); };
      sim = await simOf(prep);
      const flipped = await simOf(await sharp(prep).flop().toBuffer());
      if (flipped > sim + 0.15) { sim = flipped; mirrored = true; }
    } catch (error) {
      console.warn("Candidate preview could not be compared; retaining the visual-search result.", error);
    }
  }

  const visual = Math.round(sim * 100);
  const engines = [...c.engines];
  const engineAgreement = engineSignal(engines.length, c.hits, vc.ours.length);
  const signals: Signals = { visual, engines: engineAgreement };
  const score = Math.round(visual * 0.8 + engineAgreement * 0.2);
  const reasons = [raw ? `Visual similarity ${visual}%` : "Preview unavailable; ranked by reverse-image search agreement"];
  if (engines.length) reasons.push(`Reverse-image matches: ${engines.map((engine) => ENGINE_LABEL[engine]).join(", ")}`);
  return {
    url, platform: p.platform, videoId: p.id, title: c.title ?? url, author: "", thumbnail: thumb,
    similarity: signals.visual, score, confidence: score >= 65 ? "high" : score >= 35 ? "medium" : "low",
    clean: null, compilation: false, official: false, mirrored, engines, signals, reasons,
  };
}
