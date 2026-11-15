/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { workerFrames } from "@/lib/frames";
import { prepareFrame, signature, similarity, type Sig } from "@/lib/frameQuality";

export const maxDuration = 60;

/**
 * Stage 5 timestamp: scan the original with the worker (coarse, then fine) and compare against the frames we searched with.
 * Precision is about 1/10 of a coarse step (e.g. ~1.5 s on a 10-minute video).
 */
export async function POST(req: Request) {
  const { url, sigs, offsets, clipDuration } = await req.json();
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  if (!(await supabase.auth.getUser()).data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!process.env.WORKER_URL) return NextResponse.json({ error: "The frame worker isn't configured." }, { status: 400 });

  const ours: Sig[] = (sigs as any[]).map((s) => ({ g: s.g, h: BigInt(s.h) }));
  const sigOf = async (b: Buffer) => signature(await prepareFrame(b));
  const best = (s: Sig) => ours.reduce((m, o) => Math.max(m, similarity(o, s)), 0);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: any) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const emit = (pct: number, msg: string) => send({ type: "progress", pct, msg });
      try {
        emit(8, "Scanning the original video");
        const c = await workerFrames(url, 0, 0, 40);
        if (!c.bufs.length) throw new Error("Couldn't read frames from the original.");
        const cs = await Promise.all(c.bufs.map(sigOf));
        emit(45, "Finding the best match");
        let bj = -1, bs = 0;
        cs.forEach((s, j) => { const v = best(s); if (v > bs) { bs = v; bj = j; } });
        if (bs < 0.45) { send({ type: "result", data: { found: false } }); return; }

        const step = c.duration / 40, t0 = c.times[bj], start0 = Math.max(0, t0 - step), span = Math.min(2 * step, c.duration - start0);
        emit(55, "Narrowing down the exact moment");
        const f = await workerFrames(url, start0, span, 20);
        const fs = await Promise.all(f.bufs.map(sigOf));
        emit(90, "Calculating start and end");

        const est: number[] = [], sims: number[] = [];
        let minT = Infinity, maxT = 0;
        ours.forEach((o, i) => {
          let bk = -1, v = 0;
          fs.forEach((s, k) => { const x = similarity(o, s); if (x > v) { v = x; bk = k; } });
          if (v < 0.55) return;
          const t = f.times[bk]; sims.push(v); minT = Math.min(minT, t); maxT = Math.max(maxT, t);
          if (offsets?.[i] != null) est.push(t - offsets[i]);
        });
        if (!sims.length) { send({ type: "result", data: { found: false } }); return; }

        const fine = span / 20;
        let start: number, end: number;
        if (est.length) { est.sort((a, b) => a - b); start = Math.max(0, est[Math.floor(est.length / 2)]); end = start + (clipDuration ?? maxT - minT + fine); }
        else { start = Math.max(0, minT - fine / 2); end = maxT + fine / 2; }
        end = Math.min(end, c.duration);
        const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
        send({ type: "result", data: { found: true, start, end, precision: fine, duration: c.duration, matched: sims.length, total: ours.length,
          confidence: Math.round((sims.length / ours.length) * 50 + avg * 50) } });
      } catch (e: any) { send({ type: "error", error: e.message ?? "Locate failed." }); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
