/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import ProgressBar from "./ProgressBar";
import { readNdjson } from "@/lib/clientStream";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** Best visual match and the exact-frame location result. */
export default function SourceVerdict({ data, workerOn }: { data: any; workerOn: boolean }) {
  const [loc, setLoc] = useState<any>(null);
  const [prog, setProg] = useState<{ pct: number; msg: string } | null>(null);
  const p = data?.primary;

  useEffect(() => {
    setLoc(null); setProg(null);
    if (!workerOn || !p || !data?.locate) return;
    let dead = false;
    (async () => {
      setProg({ pct: 3, msg: "Locating the clip in the original" });
      try {
        const res = await fetch("/api/locate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.url, ...data.locate }) });
        if (!res.headers.get("content-type")?.includes("ndjson")) { setLoc({ error: (await res.json()).error }); return; }
        await readNdjson(res, (m) => {
          if (dead) return;
          if (m.type === "progress") setProg({ pct: m.pct, msg: m.msg });
          if (m.type === "result") setLoc(m.data);
          if (m.type === "error") setLoc({ error: m.error });
        });
      } catch { if (!dead) setLoc({ error: "Couldn't reach the worker." }); } finally { if (!dead) setProg(null); }
    })();
    return () => { dead = true; };
  }, [p?.url, data?.locate, workerOn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data?.candidates) return null;
  if (!p) return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
      <h3 className="mb-1 flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-4 w-4 text-accent" /> Best visual match</h3>
      No strong visual match was found, but all candidate videos remain listed below.
    </div>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-accent bg-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-4 w-4 text-accent" /> Best visual match</h3>
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumbnail && <img src={p.thumbnail} alt="" referrerPolicy="no-referrer" className="h-28 w-48 rounded-lg object-cover" />}
        <dl className="space-y-1 text-sm">
          <dd><a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-cream underline">{p.title || p.url} <ExternalLink className="h-3 w-3" /></a></dd>
          <dd>Visual score: <span className="font-semibold text-white">{p.score}%</span> <span className="text-xs">({p.confidence}, {p.similarity}% look-alike)</span></dd>
          <dd>{p.platform}{p.mirrored ? " · mirrored visual match" : ""}</dd>
        </dl>
      </div>

      <div className="text-sm">
        <span>Matching moment: </span>
        {prog ? <div className="mt-2"><ProgressBar pct={prog.pct} msg={prog.msg} /></div>
          : loc?.found ? <span className="font-semibold text-white">{fmt(loc.start)} – {fmt(loc.end)} <span className="text-xs font-normal">(±{Math.max(1, Math.round(loc.precision))}s, {loc.matched}/{loc.total} frames matched)</span></span>
          : loc?.found === false ? <span>couldn&apos;t locate the exact moment in the original</span>
          : loc?.error ? <span className="text-red-300">{loc.error}</span>
          : !workerOn ? <span>needs the frame worker (see setup)</span> : <span>not available</span>}
      </div>

      {p.reasons?.length > 0 && (
        <div className="space-y-2 text-xs">
          <p className="text-sm text-white">Why this match</p>
          <ul className="list-disc space-y-0.5 pl-4">{p.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
          {p.matches?.length > 0 && (
            <p className="pt-2 text-xs text-cream">Top matching source frame indices: {p.matches.map((m: any) => `${m.frameIndex} (${m.score}%)`).join(", ")}</p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 sm:grid-cols-4">
            {([["visual", "Frame similarity"], ["engines", "Image-search agreement"]] as const).map(([k, label]) =>
              p.signals?.[k] == null ? null : (
                <div key={k}>
                  <div className="mb-1 flex justify-between"><span>{label}</span><span className="tabular-nums text-white">{p.signals[k]}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${p.signals[k]}%` }} /></div>
                </div>
              ))}
          </div>
        </div>
      )}
      {data.pipeline && (
        <details className="text-xs">
          <summary className="cursor-pointer">How this was found</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li><b className="text-white">Frames:</b> searched {data.pipeline.segmentation.sampled} sampled frames.</li>
            <li><b className="text-white">Discovery:</b> {data.pipeline.discovery.engines.filter((e: any) => e.enabled).map((e: any) => `${e.label} (${e.hits})`).join(", ")}. {data.pipeline.discovery.candidates} candidate videos.</li>
            <li><b className="text-white">Verification:</b> {data.pipeline.verification.checked} candidates compared against the sampled frames.</li>
            <li><b className="text-white">Ranking:</b> {data.pipeline.provenance.ranked} results ranked by visual similarity and reverse-image agreement.</li>
          </ol>
        </details>
      )}
    </div>
  );
}
