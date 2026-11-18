/* eslint-disable @typescript-eslint/no-explicit-any */
/** Google Cloud Vision helpers. Accepts Buffers or image URLs; batches up to 16 images per request. */
type Img = Buffer | string;
const ENDPOINT = () => `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`;
const toImage = (i: Img) => (typeof i === "string" ? { source: { imageUri: i } } : { content: i.toString("base64") });

export async function annotateMany(imgs: Img[], types: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < imgs.length; i += 16) {
    const res = await fetch(ENDPOINT(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: imgs.slice(i, i + 16).map((img) => ({ image: toImage(img), features: types.map((type) => ({ type, maxResults: 40 })) })) }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error.message);
    out.push(...(res.responses ?? []));
  }
  return out;
}

/** Reverse image search: matching pages (with titles) plus what Google thinks the subject is. */
const webResult = (r: any) => {
  const w = r?.webDetection ?? {};
  return {
    pages: (w.pagesWithMatchingImages ?? []).map((p: any) => ({ url: p.url as string, title: (p.pageTitle ?? "") as string })),
    entities: (w.webEntities ?? []).filter((e: any) => e.description).map((e: any) => ({ d: e.description as string, s: (e.score ?? 0) as number })),
    guess: (w.bestGuessLabels ?? []).map((g: any) => g.label as string),
  };
};
export async function webInfo(img: Img) {
  const [r] = await annotateMany([img], ["WEB_DETECTION"]);
  return webResult(r);
}
export async function webInfoMany(imgs: Img[]) {
  return (await annotateMany(imgs, ["WEB_DETECTION"])).map(webResult);
}
export async function matchingPages(img: Img): Promise<string[]> { return (await webInfo(img)).pages.map((p: { url: string }) => p.url); }

const GENERIC = /^(photograph|image|screenshot|font|text|design|graphics|rectangle|poster|display device|multimedia|technology|electronic device|screen|video|youtube|facebook|tiktok|instagram|logo|pattern|art)$/i;
/** Distinctive objects and visual cues across the chosen frames (feeds Query A). */
export async function subjectLabels(bufs: Buffer[]) {
  const r = await annotateMany(bufs, ["LABEL_DETECTION", "OBJECT_LOCALIZATION"]);
  const score = new Map<string, number>();
  for (const x of r) {
    for (const l of x.labelAnnotations ?? []) if (l.score >= 0.7 && !GENERIC.test(l.description)) score.set(l.description, (score.get(l.description) ?? 0) + l.score);
    for (const o of x.localizedObjectAnnotations ?? []) if (o.score >= 0.6 && !GENERIC.test(o.name)) score.set(o.name, (score.get(o.name) ?? 0) + o.score + 0.3);
  }
  return { labels: [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d]) => d.toLowerCase()) };
}

/** Burned-in captions and logos lower the score. */
export async function cleanliness(img: Img) {
  const [r] = await annotateMany([img], ["TEXT_DETECTION", "LOGO_DETECTION"]);
  const text: string = r?.textAnnotations?.[0]?.description?.trim() ?? "";
  const hasText = text.split(/\s+/).filter(Boolean).length >= 3;
  const hasLogo = (r?.logoAnnotations ?? []).length > 0;
  return { hasText, hasLogo, text: text.slice(0, 80), fullText: text, score: 100 - (hasText ? 45 : 0) - (hasLogo ? 45 : 0) };
}

/** Faces and readable text make a frame far more searchable. */
export async function faceText(bufs: Buffer[]) {
  const r = await annotateMany(bufs, ["FACE_DETECTION", "TEXT_DETECTION"]);
  return r.map((x) => ({
    faces: (x.faceAnnotations ?? []).filter((f: any) => f.detectionConfidence > 0.7).length,
    text: (x.textAnnotations?.[0]?.description ?? "").split(/\s+/).filter(Boolean).length >= 3,
  }));
}

/** Everything we need to understand a frame's overlays: faces, every word box, big digits, logos. */
export async function frameInsights(bufs: Buffer[]) {
  const r = await annotateMany(bufs, ["FACE_DETECTION", "TEXT_DETECTION", "LOGO_DETECTION"]);
  return r.map((x: any) => {
    const full: string = x.textAnnotations?.[0]?.description ?? "";
    const boxes = (x.textAnnotations ?? []).slice(1).map((w: any) => {
      const v = w.boundingPoly?.vertices ?? [], xs = v.map((p: any) => p.x ?? 0), ys = v.map((p: any) => p.y ?? 0);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
        digit: /^#?\d{1,2}[.):]?$/.test(String(w.description).trim()) };
    });
    return {
      faces: (x.faceAnnotations ?? []).filter((f: any) => f.detectionConfidence > 0.7).length,
      text: full.split(/\s+/).filter(Boolean).length >= 3, full, boxes, logos: (x.logoAnnotations ?? []).length,
    };
  });
}
