/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import ProgressBar from "./ProgressBar";
import { readNdjson } from "@/lib/clientStream";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const date = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "unknown");

/** Final answer: primary source, confidence, original upload details and the clean scene timestamp. */
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
      <h3 className="mb-1 flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-4 w-4 text-accent" /> Primary source</h3>
      No confident primary source found. Try a clip with a clearer subject, or use &quot;Find source&quot; on a single scene.
      {data.leads?.length > 0 && <Leads leads={data.leads} />}
    </div>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-accent bg-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-4 w-4 text-accent" /> Primary source</h3>
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.thumbnail} alt="" referrerPolicy="no-referrer" className="h-28 w-48 rounded-lg object-cover" />
        <dl className="space-y-1 text-sm">
          <dd><a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-cream underline">{p.title || p.url} <ExternalLink className="h-3 w-3" /></a></dd>
          <dd>Confidence: <span className="font-semibold text-white">{p.score}%</span> <span className="text-xs">({p.confidence}, {p.similarity}% look-alike)</span></dd>
          <dd>Original upload: <span className="text-white">{date(p.publishedAt)}</span> · {p.author || "creator unknown"} · {p.platform}</dd>
          <dd className="flex flex-wrap gap-2 pt-1 text-xs">
            {p.official && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">Official or full-length</span>}
            {p.foundVia && <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream">Credited by a compilation</span>}
            {p.mirrored && <span className="rounded-full bg-line px-2 py-0.5 text-white">Your copy is mirrored</span>}
          </dd>
        </dl>
      </div>

      <div className="text-sm">
        <span>Clean scene timestamp: </span>
        {prog ? <div className="mt-2"><ProgressBar pct={prog.pct} msg={prog.msg} /></div>
          : loc?.found ? <span className="font-semibold text-white">{fmt(loc.start)} – {fmt(loc.end)} <span className="text-xs font-normal">(±{Math.max(1, Math.round(loc.precision))}s, {loc.matched}/{loc.total} frames matched)</span></span>
          : loc?.found === false ? <span>couldn&apos;t locate the exact moment in the original</span>
          : loc?.error ? <span className="text-red-300">{loc.error}</span>
          : !workerOn ? <span>needs the frame worker (see setup)</span> : <span>not available</span>}
      </div>

      {data.leads?.length > 0 && <Leads leads={data.leads} />}
      {p.reasons?.length > 0 && (
        <div className="space-y-2 text-xs">
          <p className="text-sm text-white">Why this match</p>
          <ul className="list-disc space-y-0.5 pl-4">{p.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 sm:grid-cols-4">
            {([["visual", "Look-alike"], ["engines", "Engine agreement"], ["ocr", "On-screen text"], ["metadata", "Title and details"]] as const).map(([k, label]) =>
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
            <li><b className="text-white">Segmentation:</b> sampled {data.pipeline.segmentation.sampled} frames, dropped {data.pipeline.segmentation.static_dropped} static or blurry and {data.pipeline.segmentation.duplicate_dropped} repeats, found {data.pipeline.segmentation.scenes} scene{data.pipeline.segmentation.scenes === 1 ? "" : "s"}, searched with {data.pipeline.segmentation.kept} key frames.</li>
            <li><b className="text-white">Discovery:</b> {data.pipeline.discovery.engines.filter((e: any) => e.enabled).map((e: any) => `${e.label} (${e.hits})`).join(", ")}. {data.pipeline.discovery.candidates} candidate videos.</li>
            <li><b className="text-white">Verification:</b> {data.pipeline.verification.checked} candidates checked by look-alike, on-screen text and metadata. {data.pipeline.verification.compilations} compilations followed back, {data.pipeline.verification.creator_matches} creator-page matches.</li>
            <li><b className="text-white">Provenance:</b> {data.pipeline.provenance.ranked} sources ranked, preferring the oldest upload of near-identical footage.</li>
          </ol>
        </details>
      )}
      {data.source_tracing && (
        <div className="space-y-2 text-xs">
          <p className="text-sm text-white">Creator attribution:{" "}
            <span className={data.source_tracing.is_likely_original ? "text-cream" : "text-red-300"}>
              {data.source_tracing.is_likely_original ? "no outside credits found" : `looks like a ${data.source_tracing.type}`}</span></p>
          {data.source_tracing.found_handles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.source_tracing.found_handles.map((h: any) => (
                <span key={h.handle + h.platform} className="rounded-full bg-line px-2 py-0.5 text-white">{h.handle} <span className="text-body">· {h.platform} · {h.source}</span></span>
              ))}
            </div>
          ) : <p>No creator handles found in the title, description, comments or frames.</p>}
          {data.source_tracing.next_search_queries.length > 0 && (
            <details><summary className="cursor-pointer">Creator searches</summary>
              <ul className="mt-1 space-y-1">{data.source_tracing.next_search_queries.map((q: string) => <li key={q}>{q}</li>)}</ul></details>
          )}
        </div>
      )}
      {data.scene && (
        <details className="text-xs">
          <summary className="cursor-pointer">What the AI saw</summary>
          <p className="mt-2 text-white">{data.scene.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{data.scene.keywords.map((k: string) => <span key={k} className="rounded-full bg-line px-2 py-0.5">{k}</span>)}</div>
        </details>
      )}
      {data.queries && (
        <details className="text-xs">
          <summary className="cursor-pointer">Queries used</summary>
          <ul className="mt-2 space-y-1">{(["A", "B", "C"] as const).map((k) => data.queries[k] && <li key={k}><b className="text-white">{({ A: "Specific", B: "Broad", C: "Source-tracing" } as Record<string, string>)[k]}:</b> {data.queries[k]}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Leads({ leads }: { leads: { url: string; title: string }[] }) {
  return (
    <div className="mt-3 text-xs">
      <p className="mb-1 text-white">Possible attribution threads</p>
      <ul className="space-y-1">{leads.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer" className="text-cream underline">{l.title}</a></li>)}</ul>
    </div>
  );
}
