/** Platform detection for supported video links. */
export type Platform = "youtube" | "tiktok" | "instagram" | "facebook" | "vimeo";

const PATTERNS: Record<Platform, RegExp> = {
  youtube: /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  tiktok: /tiktok\.com\/.*video\/(\d+)/,
  vimeo: /vimeo\.com\/(?:.*\/)?(\d{6,})/,
  instagram: /instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/,
  facebook: /(?:facebook\.com\/(?:.*\/videos\/|watch\/?\?v=|reel\/|share\/[vr]\/)|fb\.watch\/)([\w-]+)/,
};

export function parseVideoUrl(url: string): { platform: Platform; id: string } | null {
  for (const platform of Object.keys(PATTERNS) as Platform[]) {
    const match = PATTERNS[platform].exec(url);
    if (match) return { platform, id: match[1] };
  }
  return null;
}
