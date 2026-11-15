"use client";
import { useEffect, useRef } from "react";
import { embedUrl } from "@/lib/embed";
import type { Seg } from "@/lib/clientFrames";

/** Plays the video inside the app. Local files and YouTube honour the clip's start/end. */
export default function ClipPlayer({ result, seg, fileUrl }: { result: any; seg: Seg | null; fileUrl?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v || !seg) return;
    v.currentTime = seg.start; v.play().catch(() => {});
    const stop = () => { if (v.currentTime >= seg.end) v.pause(); };
    v.addEventListener("timeupdate", stop);
    return () => v.removeEventListener("timeupdate", stop);
  }, [seg]);

  const box = "aspect-video w-full overflow-hidden rounded-xl border border-line bg-black";
  if (fileUrl) return <video ref={ref} src={fileUrl} controls className={box} />;
  const src = result.videoId && embedUrl(result.platform, result.videoId, result.link, seg?.start, seg?.end);
  if (!src) return null;
  const tall = result.platform !== "youtube";
  return <iframe key={src} src={src} allow="autoplay; encrypted-media; fullscreen" allowFullScreen
    className={tall ? "mx-auto h-[560px] w-full max-w-sm rounded-xl border border-line bg-black" : box} />;
}
