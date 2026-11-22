/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Search, UploadCloud, X, Scissors, Play } from "lucide-react";
import Navbar from "@/components/Navbar";
import DashboardSidebar from "@/components/DashboardSidebar";
import PricingEngine from "@/components/PricingEngine";
import ClipPlayer from "@/components/ClipPlayer";
import MatchGrid from "@/components/MatchGrid";
import ProgressBar from "@/components/ProgressBar";
import SourceVerdict from "@/components/SourceVerdict";
import { supabaseBrowser } from "@/lib/supabase/client";
import { windowStart } from "@/lib/usage";
import { loadVideo, grabFrames, detectScenes, sampleTimes, type Seg, type CropBox } from "@/lib/clientFrames";
import CropEditor, { type Edit } from "@/components/CropEditor";
import type { PlanId } from "@/lib/plans";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const date = (d: string) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const matchesForDisplay = (data: any) => [...(data?.candidates ?? []), ...(data?.compilations ?? [])].sort((a, b) => b.score - a.score);
type Prog = { pct: number; msg: string } | null;

export default function Dashboard() {
  const sb = supabaseBrowser();
  const [plan, setPlan] = useState<PlanId>("free");
  const [used, setUsed] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [subInfo, setSubInfo] = useState<any>(null);
  const [surveyDone, setSurveyDone] = useState(true);
  const [url, setUrl] = useState("");
  const [prog, setProg] = useState<Prog>(null);
  const [clipProg, setClipProg] = useState<Prog>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [segMode, setSegMode] = useState("");
  const [seg, setSeg] = useState<number | null>(null);
  const [clipRes, setClipRes] = useState<any>(null);
  const [modal, setModal] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<{ video: HTMLVideoElement; name: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const file = useRef<{ video: HTMLVideoElement; url: string; crop?: CropBox | null } | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await sb.from("subscriptions").select("plan,current_period_start,status,trial_ends_at,bonus_searches").single();
    if (s) { setPlan(s.plan); setSubInfo(s); }
    const { count } = await sb.from("searches_usage").select("*", { count: "exact", head: true }).gte("created_at", windowStart(s).toISOString());
    setUsed(count ?? 0);
    const { count: sc } = await sb.from("survey_responses").select("*", { count: "exact", head: true });
    setSurveyDone((sc ?? 0) > 0);
    const { data: h } = await sb.from("searches_usage").select("id,source,result,created_at").order("created_at", { ascending: false }).limit(8);
    setHistory(h ?? []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    if (q.get("url")) setUrl(q.get("url")!);
    if (q.get("upgraded")) { // back from Stripe: apply the new plan right away, without waiting for the webhook
      fetch("/api/billing/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: q.get("session_id") }) }).then(() => load());
      window.history.replaceState(null, "", "/dashboard");
    }
  }, [load]);

  /** Calls /api/trace and reads its progress stream. `range` maps server 0-100% onto part of the bar. */
  async function post(body: any, report: (p: Prog) => void, range: [number, number] = [0, 100]) {
    report({ pct: range[0], msg: "Starting" });
    const res = await fetch("/api/trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.headers.get("content-type")?.includes("ndjson")) {
      const d = await res.json(); setError(d.error); if (res.status === 402) setModal(true); report(null); return null;
    }
    const reader = res.body!.getReader(), dec = new TextDecoder();
    let buf = "", out: any = null;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop()!;
      for (const l of lines) {
        if (!l.trim()) continue;
        const m = JSON.parse(l);
        if (m.type === "progress") report({ pct: range[0] + ((range[1] - range[0]) * m.pct) / 100, msg: m.msg });
        else if (m.type === "result") out = m.data;
        else if (m.type === "error") setError(m.error);
      }
    }
    setTimeout(() => report(null), 500); load(); return out;
  }
  const reset = () => { setError(""); setResult(null); setSeg(null); setSegMode(""); file.current = null; };

  async function trace(e: React.FormEvent) {
    e.preventDefault(); reset();
    const secs = (t: string) => { const p = t.trim().split(":").map(Number); return !t.trim() || p.some(isNaN) ? null : p.reduce((x, y) => x * 60 + y, 0); };
    const a = secs(from), b = secs(to);
    const data = await post(a != null && b != null && b > a ? { url, start: a, end: b } : { url }, setProg); // optional trim for links
    if (data) { setResult(data); setSegMode(data.segmentMode ?? ""); }
  }

  /** Step 1 for uploads: open the file in the trim/crop editor. */
  async function onFile(f?: File) {
    if (!f) return; reset();
    try { setProg({ pct: 2, msg: "Opening your video" }); const v = await loadVideo(f); setProg(null); setPending({ video: v, name: f.name }); }
    catch (e: any) { setError(e.message); setProg(null); }
  }

  /** Step 2: trace the chosen time range using high-frequency frame capture. */
  async function runUpload(edit: Edit) {
    const { video: v, name } = pending!; setPending(null);
    const { start, end, crop } = edit, span = end - start;
    const rep = (pct: number, msg: string) => setProg({ pct, msg });
    try {
      rep(1, "Capturing high-frequency frames");
      const ts = sampleTimes(start, end, 0.1, 300);
      const frames = await grabFrames(v, ts, 480, 0.65, (p) => rep(5 + p * 45, "Capturing frames every few milliseconds"), crop);
      const data = await post({ frames, name, frameTimes: ts.map((t) => t - start), clipDuration: span }, setProg, [50, 100]);
      if (!data) return;
      file.current = { video: v, url: v.src, crop }; setSegMode("");
      setResult({ ...data, title: name, duration: v.duration, segments: [] });
    } catch (e: any) { setError(e.message); setProg(null); }
  }

  async function reverseClip(i: number) {
    const s: Seg = result.segments[i];
    setSeg(i); setClipRes(null); setError("");
    let data;
    if (file.current) {
      const t = sampleTimes(s.start, s.end);
      setClipProg({ pct: 2, msg: "Capturing clip frames" });
      const frames = await grabFrames(file.current.video, t, 480, 0.65, undefined, file.current.crop);
      data = await post({ frames, name: `${result.title} (${s.label})`, frameTimes: t.map((x) => x - s.start), clipDuration: s.end - s.start }, setClipProg, [10, 100]);
    } else data = await post({ url: result.link, start: s.start, end: s.end }, setClipProg);
    if (data) setClipRes({ index: i, ...data });
  }

  const billing = () => { window.location.href = "/billing"; }; // plan, cancel and invoices live there
  const onUpgrade = () => (plan === "elite" ? billing() : setModal(true));
  const segs: Seg[] = result?.segments ?? [];
  const busy = !!prog;

  return (
    <div className="min-h-screen bg-bg text-body">
      <Navbar />
      <div className="flex">
        <div className="hidden md:block"><DashboardSidebar plan={plan} used={used} onUpgrade={onUpgrade} bonus={subInfo?.bonus_searches ?? 0} /></div>
        <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-white">Trace a clip</h1>
            {plan !== "free" && <button onClick={billing} className="text-sm text-cream underline">Manage billing</button>}
          </div>

          {subInfo?.status === "trialing" && subInfo.trial_ends_at && (
            <div className="rounded-xl border border-accent bg-accent/10 px-4 py-3 text-sm text-white">
              Your Elite free trial ends {date(subInfo.trial_ends_at)} ({Math.max(0, Math.ceil((new Date(subInfo.trial_ends_at).getTime() - Date.now()) / 864e5))} days left).
              You&apos;ll be charged then unless you cancel.
              <button onClick={billing} className="ml-2 text-cream underline">Manage or cancel</button>
            </div>
          )}
          {!surveyDone && (
            <Link href="/survey" className="block rounded-xl border border-line bg-surface px-4 py-3 text-sm text-white transition hover:border-accent">
              Give us honest feedback (even about pricing) and get <b className="text-cream">10 free searches</b> →
            </Link>
          )}

          {status && (!status.worker || !status.lens) && (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-xs">
              {!status.worker && "Linked-video searches need the frame worker for exact frame capture. "}
              {!status.lens && "Google Lens and Yandex reverse search are off; add SERPAPI_KEY for more image-search coverage. "}
              Uploaded videos can still be searched from browser-captured frames.
            </p>
          )}

          <form onSubmit={trace} className="flex flex-col gap-2 sm:flex-row">
            <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="Paste a YouTube, TikTok, Instagram, Facebook or Vimeo link"
              className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-white outline-none transition focus:border-accent" />
            <button disabled={busy} className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-bg transition hover:brightness-110 disabled:opacity-50">
              <Search className="h-4 w-4" /> Trace source
            </button>
          </form>

          <details className="text-xs">
            <summary className="cursor-pointer">Only trace part of a linked video (optional)</summary>
            <div className="mt-2 flex items-center gap-2">
              From <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:30" className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-white" />
              to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="1:15" className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-white" />
              <span>(mm:ss. Exact frames need the worker.)</span>
            </div>
          </details>

          <label onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files[0]); }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition ${dragging ? "border-accent bg-accent/10" : "border-line hover:border-accent/60"}`}>
            <UploadCloud className="h-7 w-7 text-accent" />
            <p className="text-sm">Drop an MP4 or MOV, or click to choose one</p>
            <input type="file" accept="video/mp4,video/quicktime" className="hidden" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>

          {pending && <CropEditor video={pending.video} name={pending.name} onConfirm={runUpload} onCancel={() => setPending(null)} />}

          <AnimatePresence>{prog && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><ProgressBar pct={prog.pct} msg={prog.msg} /></motion.div>}</AnimatePresence>
          {error && <p className="text-sm text-red-400">{error}</p>}

          <AnimatePresence>
            {result && (
              <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <div className="space-y-4">
                  <ClipPlayer result={result} seg={seg != null ? segs[seg] : null} fileUrl={file.current?.url} />
                  <div className="text-sm">
                    <h2 className="text-lg font-semibold text-white">{result.title}</h2>
                    <p>{[result.duration ? fmt(result.duration) : "", result.platform].filter(Boolean).join(" · ")}</p>
                    <p className="mt-2">
                      <span className="rounded-full bg-cream/10 px-3 py-1 text-xs font-medium text-cream">
                        {result.verdict === "visual_only" ? "Visual-only search" : "Previous search"}</span>
                      <span className="ml-2 text-xs">{result.framesUsed} sampled frames searched</span></p>
                    {result.note && <p className="mt-1 text-xs text-cream">{result.note}</p>}
                    {result.context?.classification && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-accent/20 px-2 py-0.5 font-medium text-accent">{result.context.classification}</span>
                        {result.context.summary.map((s: string) => <span key={s} className="rounded-full bg-line px-2 py-0.5 text-white">{s}</span>)}
                      </div>
                    )}
                    {result.context?.compilation && <p className="mt-2 text-xs text-cream">This looks like a compilation or ranking video. Use "Find source" on each clip to trace the original footage behind it.</p>}
                  </div>
                </div>

                <SourceVerdict data={result} workerOn={!!status?.worker} />

                <div>
                  <h3 className="mb-3 text-xl font-semibold text-white">Matches for the full video</h3>
                  <MatchGrid items={matchesForDisplay(result)} originalUrl={result.original?.url} />
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          <section id="history">
            <h2 className="mb-3 text-xl font-semibold text-white">Recent searches</h2>
            {history.length === 0 ? <p className="text-sm">Nothing yet. Paste a link above to start.</p> : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => { reset(); setResult(h.result); setSegMode(h.result?.segmentMode ?? ""); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="flex w-full justify-between gap-4 px-4 py-3 text-left transition hover:bg-line/50">
                      <span className="truncate text-white">{h.result?.title ?? h.source}</span>
                      <span className="shrink-0">{date(h.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal(false)}
            className="fixed inset-0 z-[60] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }} onClick={(e) => e.stopPropagation()}
              className="relative mx-auto mt-10 max-w-6xl rounded-3xl border border-line bg-bg">
              <button onClick={() => setModal(false)} aria-label="Close" className="absolute right-4 top-4 text-body hover:text-white"><X /></button>
              <PricingEngine currentPlan={plan} />
              {!surveyDone && <p className="pb-6 text-center text-sm">Not ready to upgrade? <Link href="/survey" className="text-cream underline">Take our short survey for 10 free searches.</Link></p>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
