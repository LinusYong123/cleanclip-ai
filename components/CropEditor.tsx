"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

export type CropBox = { x: number; y: number; w: number; h: number }; // fractions of the frame, 0 to 1
export type Edit = { start: number; end: number; crop: CropBox | null };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Trim the time range and crop the picture before tracing. Both are optional. */
export default function CropEditor({ video, name, onConfirm, onCancel }: { video: HTMLVideoElement; name: string; onConfirm: (e: Edit) => void; onCancel: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; c: CropBox } | null>(null);
  const D = video.duration;
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(D);
  const [useCrop, setUseCrop] = useState(false);
  const [crop, setCrop] = useState<CropBox>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

  useEffect(() => {
    const v = ref.current!;
    const time = () => { setCur(v.currentTime); if (v.currentTime >= end) v.pause(); };
    const on = () => setPlaying(true), off = () => setPlaying(false);
    v.addEventListener("timeupdate", time); v.addEventListener("play", on); v.addEventListener("pause", off);
    return () => { v.removeEventListener("timeupdate", time); v.removeEventListener("play", on); v.removeEventListener("pause", off); };
  }, [end]);

  const seek = (t: number) => { if (ref.current) ref.current.currentTime = t; setCur(t); };
  const toggle = () => { const v = ref.current!; if (v.paused) { if (v.currentTime < start || v.currentTime >= end - 0.1) v.currentTime = start; v.play(); } else v.pause(); };

  const begin = (mode: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, c: { ...crop } };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !box.current) return;
    const r = box.current.getBoundingClientRect(), dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height, MIN = 0.1;
    let { x, y, w, h } = d.c;
    if (d.mode === "move") { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
    else {
      if (d.mode.includes("w")) { const nx = clamp(x + dx, 0, x + w - MIN); w += x - nx; x = nx; }
      if (d.mode.includes("e")) w = clamp(w + dx, MIN, 1 - x);
      if (d.mode.includes("n")) { const ny = clamp(y + dy, 0, y + h - MIN); h += y - ny; y = ny; }
      if (d.mode.includes("s")) h = clamp(h + dy, MIN, 1 - y);
    }
    setCrop({ x, y, w, h });
  };

  const edited = start > 0.05 || end < D - 0.05 || useCrop;
  const handle = (mode: string, pos: string, cursor: string) => (
    <span key={mode} onPointerDown={begin(mode)} className={`absolute h-4 w-4 touch-none rounded-full border-2 border-bg bg-cream ${pos} ${cursor}`} />
  );

  return (
    <div className="space-y-4 rounded-2xl border border-accent bg-surface p-5">
      <div>
        <h3 className="font-semibold text-white">Edit before tracing <span className="text-xs font-normal">(optional)</span></h3>
        <p className="text-xs">Trim to the part you want to trace, and crop out captions, banners or borders so the search sees only the footage. {name}</p>
      </div>

      <div className="flex justify-center">
        <div ref={box} className="relative inline-block max-w-full overflow-hidden rounded-xl bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={ref} src={video.src} playsInline preload="auto" className="block max-h-[55vh] max-w-full" />
          {useCrop && (
            <div onPointerDown={begin("move")} onPointerMove={move} onPointerUp={() => (drag.current = null)}
              className="absolute cursor-move touch-none border-2 border-cream" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}>
              {handle("nw", "-left-2 -top-2", "cursor-nwse-resize")}{handle("ne", "-right-2 -top-2", "cursor-nesw-resize")}
              {handle("sw", "-left-2 -bottom-2", "cursor-nesw-resize")}{handle("se", "-right-2 -bottom-2", "cursor-nwse-resize")}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="rounded-full bg-accent p-2 text-bg">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <input type="range" min={0} max={D} step={0.1} value={cur} onChange={(e) => seek(+e.target.value)} className="flex-1 accent-[#3D8D7A]" aria-label="Seek" />
        <span className="w-24 text-right text-xs tabular-nums">{fmt(cur)} / {fmt(D)}</span>
      </div>

      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <label className="space-y-1"><span className="flex justify-between"><span>Start</span><b className="text-white">{fmt(start)}</b></span>
          <input type="range" min={0} max={D} step={0.1} value={start} className="w-full accent-[#3D8D7A]" onChange={(e) => { const v = Math.min(+e.target.value, end - 1); setStart(v); seek(v); }} />
          <button type="button" onClick={() => setStart(Math.min(cur, end - 1))} className="text-xs text-cream underline">Set to current time</button></label>
        <label className="space-y-1"><span className="flex justify-between"><span>End</span><b className="text-white">{fmt(end)}</b></span>
          <input type="range" min={0} max={D} step={0.1} value={end} className="w-full accent-[#3D8D7A]" onChange={(e) => { const v = Math.max(+e.target.value, start + 1); setEnd(v); seek(Math.max(0, v - 0.2)); }} />
          <button type="button" onClick={() => setEnd(Math.max(cur, start + 1))} className="text-xs text-cream underline">Set to current time</button></label>
      </div>

      <label className="flex items-center gap-2 text-sm text-white">
        <input type="checkbox" checked={useCrop} onChange={(e) => setUseCrop(e.target.checked)} className="accent-[#3D8D7A]" /> Crop the picture (drag the box and its corners)
      </label>

      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="rounded-xl border border-line px-4 py-2 text-sm text-white transition hover:border-accent">Cancel</button>
        <button onClick={() => onConfirm({ start, end, crop: useCrop ? crop : null })} className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:brightness-110">
          {edited ? "Trace my selection" : "Trace full video"}
        </button>
      </div>
    </div>
  );
}
