/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Download, ExternalLink, Play, X } from "lucide-react";
import { embedUrl } from "@/lib/embed";

const date = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "date unknown");
const tone = { high: "bg-accent/20 text-accent", medium: "bg-cream/10 text-cream", low: "bg-line text-body" } as Record<string, string>;

/** Match cards with optional thumbnails. Clicking a preview plays the video full screen. */
export default function MatchGrid({ items, originalUrl }: { items: any[]; originalUrl?: string }) {
  const [open, setOpen] = useState<any | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [dlPanel, setDlPanel] = useState(false);
  const [ack, setAck] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlErr, setDlErr] = useState("");
  useEffect(() => { setDlPanel(false); setAck(false); setDlErr(""); }, [open]); // fresh state for each video

  async function download() {
    setDlBusy(true); setDlErr("");
    try {
      const r = await fetch("/api/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: open.url, title: open.title || open.author }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.href = d.url; // the browser downloads straight from the worker
    } catch (e: any) { setDlErr(e.message ?? "Download failed."); } finally { setDlBusy(false); }
  }

  // Esc closes the player, and the page behind it stops scrolling
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const prev = document.body.style.overflow;
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);

  if (!items?.length) return <p className="text-sm">No matches found for these frames.</p>;

  const src = open ? embedUrl(open.platform, open.videoId, open.url, 0) : null; // start=0 also autoplays on YouTube
  const tall = open && open.platform !== "youtube";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((c) => (
          <div key={c.url} className={`overflow-hidden rounded-2xl border bg-surface ${c.url === originalUrl ? "border-accent" : "border-line"}`}>
            <button onClick={() => (embedUrl(c.platform, c.videoId, c.url) ? setOpen(c) : window.open(c.url, "_blank"))}
              className="group relative block aspect-video w-full bg-black" aria-label="Play video full screen">
              {c.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              ) : <span className="flex h-full items-center justify-center text-sm text-white">Preview unavailable</span>}
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100"><Play className="h-10 w-10 text-white" /></span>
            </button>
            <div className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-line px-2 py-0.5 text-white">{c.platform}</span>
                <span className={`rounded-full px-2 py-0.5 ${tone[c.confidence]}`}>{c.confidence} match · {c.similarity}% look-alike</span>
                {c.clean && (c.clean.score >= 60 ? <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream">No overlays seen</span>
                  : <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-red-300">{c.clean.hasLogo ? "Watermark" : "Text overlay"}</span>)}
                {c.url === originalUrl && <span className="rounded-full bg-accent px-2 py-0.5 text-bg">Likely original</span>}
                {c.official && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">Official or full-length</span>}
                {c.compilation && <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-red-300">Compilation or reaction</span>}
                {c.foundVia && <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream">Found via a compilation</span>}
                {c.byHandle && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">On {c.byHandle}&apos;s page</span>}
              </div>
              <p className="line-clamp-2 text-white">{c.title || c.author}</p>
              <p className="flex items-center justify-between">{c.author} · {date(c.publishedAt)}
                <a href={c.url} target="_blank" rel="noreferrer" className="text-cream" aria-label="Open source"><ExternalLink className="h-4 w-4" /></a></p>
            </div>
          </div>
        ))}
      </div>

      {/* Full-screen player, rendered on <body> so no parent can clip or offset it */}
      {mounted && createPortal(
        <AnimatePresence>
          {open && src && (
            <motion.div key="player" role="dialog" aria-modal="true" aria-label="Video player"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              onClick={() => setOpen(null)} className="fixed inset-0 z-[80] flex flex-col bg-black/95 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{open.title || open.author}</p>
                  <p className="truncate">{open.platform}{open.author ? ` · ${open.author}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <button onClick={() => setDlPanel((v) => !v)} className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 font-semibold text-bg transition hover:brightness-110"><Download className="h-4 w-4" /> Download</button>
                  <a href={open.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-cream hover:underline">Open on {open.platform} <ExternalLink className="h-4 w-4" /></a>
                  <button onClick={() => setOpen(null)} aria-label="Close player" className="rounded-full bg-line p-2 text-white transition hover:bg-accent hover:text-bg"><X className="h-5 w-5" /></button>
                </div>
              </div>
              {dlPanel && (
                <div className="mx-4 mb-2 rounded-xl border border-line bg-surface p-4 text-sm" onClick={(e) => e.stopPropagation()}>
                  <label className="flex items-start gap-2 text-white">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-[#3D8D7A]" />
                    I own this video or have permission to download and use it.
                  </label>
                  <p className="mt-1 text-xs">Downloading other people&apos;s videos can break a platform&apos;s terms or copyright law. You&apos;re responsible for how you use it.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button disabled={!ack || dlBusy} onClick={download} className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg transition hover:brightness-110 disabled:opacity-50">{dlBusy ? "Preparing…" : "Download MP4"}</button>
                    {dlErr && <span className="text-red-300">{dlErr}</span>}
                  </div>
                </div>
              )}
              <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
                <iframe src={src} allow="autoplay; encrypted-media; fullscreen" allowFullScreen onClick={(e) => e.stopPropagation()}
                  className={tall ? "h-full w-full max-w-md rounded-xl bg-black" : "aspect-video max-h-full w-full max-w-6xl rounded-xl bg-black"} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
    </>
  );
}
