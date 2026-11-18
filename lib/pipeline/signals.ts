// lib/pipeline/signals.ts: pure helpers for visual verification and ranking.
/** Agreement across reverse-image engines and sampled frames, 0-100. */
export function engineSignal(engineCount: number, frameHits: number, searched: number): number {
  const engines = Math.min(engineCount, 3) / 3;
  const frames = Math.min(frameHits / Math.max(searched, 1), 1);
  return Math.round(100 * (0.6 * engines + 0.4 * frames));
}

/** Groups consecutive items into scenes by similarity. */
export function groupScenes<T>(items: readonly T[], sim: (a: T, b: T) => number, threshold: number): T[][] {
  const scenes: T[][] = [];
  items.forEach((item, k) => {
    if (k > 0 && sim(items[k - 1], item) >= threshold) scenes[scenes.length - 1].push(item);
    else scenes.push([item]);
  });
  return scenes;
}
