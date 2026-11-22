// Stage 3: verify candidate footage against sampled source-video frames.
import sharp from "sharp";
import { parseVideoUrl } from "@/lib/platforms";
import { workerFrames } from "@/lib/frames";
import { prepareFrame, signature, similarity, type Sig } from "@/lib/frameQuality";
import { engineSignal } from "./signals";
import { ENGINE_LABEL, type Cand, type Candidate, type Signals } from "./types";

export interface VerifyContext {
  ours: Sig[]; // signatures for every sampled source frame
}

const VIDEO_HOSTS: Record<string, string[]> = {
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.watch"],
  vimeo: ["vimeo.com"],
};

function isTrustedVideoUrl(url: string, platform: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (VIDEO_HOSTS[platform] ?? [])
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export async function verifyCandidate(url: string, c: Cand, vc: VerifyContext): Promise<Candidate | null> {
  const p = parseVideoUrl(url);
  if (!p || !isTrustedVideoUrl(url, p.platform)) return null;
  const thumb = c.thumb || (p.platform === "youtube" ? `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` : "");

  let footage: Buffer[] = [];
  try {
    footage = (await workerFrames(url, 0, 0, 6, undefined, 20000)).bufs;
  } catch (error) {
    console.warn(`Candidate footage sampling failed for ${p.platform}:${p.id}:`, error instanceof Error ? error.message : String(error));
  }

  let sim = 0, mirrored = false;
  const matches: { frameIndex: number; score: number }[] = [];
  if (footage.length) {
    try {
      const scoreFootage = async (frames: Buffer[], flip: boolean) => {
        const perFrame = await Promise.all(frames.map(async (frame) => {
          let prepared = await prepareFrame(frame);
          if (flip) prepared = await sharp(prepared).flop().toBuffer();
          const sig = await signature(prepared);
          let best = { frameIndex: 0, score: 0 };
          vc.ours.forEach((source, frameIndex) => {
            const score = similarity(source, sig);
            if (score > best.score) best = { frameIndex, score };
          });
          return best;
        }));
        const bySourceFrame = new Map<number, typeof perFrame[number]>();
        for (const match of perFrame) {
          const previous = bySourceFrame.get(match.frameIndex);
          if (!previous || match.score > previous.score) bySourceFrame.set(match.frameIndex, match);
        }
        const best = [...bySourceFrame.values()].sort((a, b) => b.score - a.score).slice(0, 3);
        return {
          score: best.reduce((sum, match) => sum + match.score, 0) / Math.max(best.length, 1),
          matches: best.map(({ frameIndex, score }) => ({ frameIndex, score: Math.round(score * 100) })),
        };
      };
      const normal = await scoreFootage(footage, false);
      const flipped = await scoreFootage(footage, true);
      const best = flipped.score > normal.score + 0.05 ? flipped : normal;
      sim = best.score;
      mirrored = best === flipped;
      matches.push(...best.matches);
    } catch (error) {
      console.warn("Candidate footage could not be compared.", error);
    }
  }

  const visual = Math.round(sim * 100);
  const engines = [...c.engines];
  const engineAgreement = engineSignal(engines.length, c.hits, vc.ours.length);
  const signals: Signals = { visual, engines: engineAgreement };
  const score = Math.round(visual * 0.8 + engineAgreement * 0.2);
  const reasons = [footage.length
    ? `Compared ${footage.length} frames from the candidate footage: ${visual}% visual similarity`
    : "Candidate footage unavailable; visual similarity could not be verified"];
  if (engines.length) reasons.push(`Reverse-image matches: ${engines.map((engine) => ENGINE_LABEL[engine]).join(", ")}`);
  if (score < 25) reasons.push("Weak lead; visual evidence is not enough to confirm it as the source.");
  return {
    url, platform: p.platform, videoId: p.id, title: c.title ?? url, author: "", thumbnail: thumb,
    similarity: signals.visual, score, confidence: score >= 65 ? "high" : score >= 35 ? "medium" : "low",
    clean: null, compilation: false, official: false, mirrored, engines, signals, reasons,
    matches,
  };
}
