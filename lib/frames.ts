export const fetchBuf = async (url: string) => {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("fetch failed");
  return Buffer.from(await r.arrayBuffer());
};

/** Exact frames (with timestamps and duration) from the optional worker. Empty if not configured. */
export async function workerFrames(url: string, start: number, dur: number, n: number, interval?: number) {
  const none = { bufs: [] as Buffer[], times: [] as number[], duration: 0 };
  if (!process.env.WORKER_URL) return none;
  const q = new URLSearchParams({ url, start: String(start), dur: String(dur), n: String(n) });
  if (interval != null) q.set("interval", String(interval));
  const r = await fetch(`${process.env.WORKER_URL}/frames?${q}`, {
    headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` }, signal: AbortSignal.timeout(52000),
  });
  if (!r.ok) {
    let msg = "worker failed";
    try {
      const j = await r.json();
      if (j.error) msg = `worker failed: ${j.error}`;
    } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  return { bufs: (j.frames as string[]).map((b) => Buffer.from(b, "base64")), times: j.times as number[], duration: j.duration as number };
}
