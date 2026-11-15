/** Frame preparation, quality scoring and robust similarity (hash + brightness-invariant correlation). */
import sharp from "sharp";

/** Strip letterbox bars, crop away app UI zones (TikTok/Reels buttons + captions), cap the size. */
export async function prepareFrame(input: Buffer): Promise<Buffer> {
  let buf = input;
  const m0 = await sharp(input).metadata();
  try {
    const t = await sharp(input).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true });
    if (t.info.width * t.info.height >= 0.4 * (m0.width! * m0.height!)) buf = t.data; // don't over-trim dark scenes
  } catch { /* nothing to trim */ }
  const m = await sharp(buf).metadata();
  const w = m.width!, h = m.height!;
  const box = w / h < 0.7
    ? { left: 0, top: Math.round(h * 0.07), width: Math.round(w * 0.86), height: Math.round(h * 0.7) } // portrait: drop right buttons, top bar, bottom captions
    : { left: Math.round(w * 0.04), top: Math.round(h * 0.04), width: Math.round(w * 0.92), height: Math.round(h * 0.92) };
  return sharp(buf).extract(box).resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

/** Solid colours, black/white flashes and blur score 0; detailed, sharp, contrasty frames score high. */
export async function quality(buf: Buffer) {
  const g = sharp(buf).resize(160, 160, { fit: "inside" }).greyscale();
  const st = await g.clone().stats();
  const lap = await g.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats();
  const contrast = st.channels[0].stdev, mean = st.channels[0].mean, sharpness = lap.channels[0].stdev;
  const bad = contrast < 12 || mean < 12 || mean > 243 || st.entropy < 3.5 || sharpness < 2;
  return { bad, score: bad ? 0 : st.entropy * 10 + Math.min(sharpness, 40) * 1.5 + Math.min(contrast, 60) * 0.3 };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
async function gray(src: Buffer, w: number, h: number) {
  const { data, info } = await sharp(src).greyscale().resize(w, h, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return Array.from({ length: w * h }, (_, i) => data[i * info.channels]);
}

export type Sig = { g: number[]; h: bigint };
/** Signature of the centre square, so aspect-ratio changes don't break matching. */
export async function signature(prepared: Buffer): Promise<Sig> {
  const m = await sharp(prepared).metadata(), s = Math.min(m.width!, m.height!);
  const sq = await sharp(prepared).extract({ left: Math.floor((m.width! - s) / 2), top: Math.floor((m.height! - s) / 2), width: s, height: s }).toBuffer();
  const g = await gray(sq, 16, 16), d = await gray(sq, 9, 8);
  let h = BigInt(0);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << BigInt(1)) | BigInt(d[y * 9 + x] > d[y * 9 + x + 1] ? 1 : 0);
  return { g, h };
}

export function hamming(a: bigint, b: bigint) {
  let x = a ^ b, c = 0;
  while (x) { c += Number(x & BigInt(1)); x >>= BigInt(1); }
  return c;
}

function pearson(a: number[], b: number[]) {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** 0..1. Takes the better of hash similarity and correlation (which survives colour grading and compression). */
export function similarity(a: Sig, b: Sig) {
  const d = clamp((1 - hamming(a.h, b.h) / 64 - 0.6) / 0.35);
  const n = clamp((pearson(a.g, b.g) - 0.35) / 0.55);
  return Math.max(d, n);
}

/** Share of the frame taken up by black bars / flat borders (0 if none). */
export async function barFraction(input: Buffer) {
  try {
    const m = await sharp(input).metadata();
    const t = await sharp(input).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true });
    const f = 1 - (t.info.width * t.info.height) / (m.width! * m.height!);
    return f < 0.6 ? f : 0;
  } catch { return 0; }
}

/** De-contextualise: blur subtitle, caption and ranking-number boxes so the search sees only the underlying footage. */
export async function blurRegions(buf: Buffer, boxes: { x: number; y: number; w: number; h: number }[]) {
  const m = await sharp(buf).metadata(), W = m.width!, H = m.height!;
  const ops: { input: Buffer; left: number; top: number }[] = [];
  for (const b of boxes) {
    const pad = Math.round(Math.max(b.h, 6) * 0.4);
    const left = Math.max(0, b.x - pad), top = Math.max(0, b.y - pad);
    const width = Math.min(W - left, b.w + pad * 2), height = Math.min(H - top, b.h + pad * 2);
    if (width < 4 || height < 4 || width * height > W * H * 0.35) continue; // skip huge boxes, they're probably the scene itself
    ops.push({ input: await sharp(buf).extract({ left, top, width, height }).blur(18).toBuffer(), left, top });
  }
  return ops.length ? sharp(buf).composite(ops).jpeg({ quality: 85 }).toBuffer() : buf;
}

/** Landscape canvas with sharp centre and blurred/flat sides = portrait video pillarboxed with a blurred background. */
export async function hasBlurredSidebars(buf: Buffer) {
  try {
    const m = await sharp(buf).metadata(), W = m.width!, H = m.height!;
    if (W / H < 1.3) return false;
    const lap = async (left: number, width: number) => (await sharp(buf).extract({ left, top: 0, width, height: H }).resize(160).greyscale()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats()).channels[0].stdev;
    const side = Math.floor(W * 0.2);
    const [l, r, c] = await Promise.all([lap(0, side), lap(W - side, side), lap(Math.floor(W * 0.3), Math.floor(W * 0.4))]);
    return c > 6 && (l + r) / 2 < c * 0.4;
  } catch { return false; }
}
export async function cropCenterWidth(buf: Buffer, keep = 0.56) {
  const m = await sharp(buf).metadata(), W = m.width!, H = m.height!;
  return sharp(buf).extract({ left: Math.floor((W * (1 - keep)) / 2), top: 0, width: Math.floor(W * keep), height: H }).jpeg({ quality: 85 }).toBuffer();
}
