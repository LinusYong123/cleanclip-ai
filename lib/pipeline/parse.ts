/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/pipeline/parse.ts: turn search-engine JSON into plain hits. Defensive, because the shapes aren't ours.
export interface Hit { link: string; title?: string; thumb?: string }

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** SerpApi google_lens: visual_matches[] */
export function lensHits(r: any): Hit[] {
  return (r?.visual_matches ?? []).map((m: any) => ({ link: str(m?.link) ?? "", title: str(m?.title), thumb: str(m?.thumbnail) })).filter((h: Hit) => h.link);
}

/** SerpApi yandex_images (reverse): image_results[] are the pages where the image appears. */
export function yandexHits(r: any): Hit[] {
  return (r?.image_results ?? []).map((x: any) => ({
    link: str(x?.link) ?? str(x?.source?.link) ?? "",
    title: str(x?.title) ?? str(x?.snippet),
    thumb: str(x?.thumbnail) ?? str(x?.thumbnail?.link) ?? str(x?.original?.link),
  })).filter((h: Hit) => h.link);
}
