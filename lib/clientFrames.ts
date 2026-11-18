/** Browser-side video helpers: load a file, grab (optionally cropped) frames as JPEGs, and detect scene cuts. */
export type Seg = { start: number; end: number; label: string; description?: string; keywords?: string[]; trigger?: string };
export type CropBox = { x: number; y: number; w: number; h: number };
type Progress = (fraction: number) => void;

export function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
    v.onloadeddata = () => res(v);
    v.onerror = () => rej(new Error("This video format can't be read in your browser. Try MP4."));
  });
}

const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((r) => {
  v.addEventListener("seeked", () => r(), { once: true });
  v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
});

export function sampleTimes(start: number, end: number, interval = 0.25, maxFrames = 40) {
  const span = end - start;
  if (!(span > 0)) return [];
  const step = Math.max(interval, span / maxFrames);
  const count = Math.max(1, Math.min(maxFrames, Math.floor(span / step - 0.5 + 1e-9) + 1));
  return Array.from({ length: count }, (_, i) => start + Math.min(span, step) / 2 + i * step);
}

/** If `crop` is given, only that part of each frame is captured. */
export async function grabFrames(v: HTMLVideoElement, times: number[], width = 640, quality = 0.8, onProgress?: Progress, crop?: CropBox | null): Promise<string[]> {
  const sx = crop ? crop.x * v.videoWidth : 0, sy = crop ? crop.y * v.videoHeight : 0;
  const sw = crop ? crop.w * v.videoWidth : v.videoWidth, sh = crop ? crop.h * v.videoHeight : v.videoHeight;
  const c = document.createElement("canvas");
  c.width = width; c.height = Math.max(2, Math.round((sh / sw) * width));
  const ctx = c.getContext("2d")!, out: string[] = [];
  for (let i = 0; i < times.length; i++) {
    await seek(v, times[i]); ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    out.push(c.toDataURL("image/jpeg", quality)); onProgress?.((i + 1) / times.length);
  }
  return out;
}

/** Cuts where consecutive frames differ a lot (within an optional time range); falls back to equal scenes. */
export async function detectScenes(v: HTMLVideoElement, onProgress?: Progress, range?: { start: number; end: number }): Promise<Seg[]> {
  const a = range?.start ?? 0, b = range?.end ?? v.duration, span = b - a, step = Math.max(1, span / 150);
  const c = document.createElement("canvas"); c.width = 32; c.height = 18;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  let prev: Uint8ClampedArray | null = null, last = a; const cuts = [a];
  for (let t = a; t < b; t += step) {
    await seek(v, t); ctx.drawImage(v, 0, 0, 32, 18);
    const px = ctx.getImageData(0, 0, 32, 18).data;
    if (prev) {
      let diff = 0; for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]);
      if (diff / (px.length / 4) / 3 > 28 && t - last >= 2) { cuts.push(t); last = t; }
    }
    prev = px; onProgress?.((t - a) / span);
  }
  const n = Math.min(6, Math.max(2, Math.floor(span / 15)));
  if (cuts.length < 2) for (let i = 1; i < n; i++) cuts.push(a + (span / n) * i);
  return cuts.map((s, i) => ({ start: s, end: cuts[i + 1] ?? b, label: `Scene ${i + 1}` }));
}
