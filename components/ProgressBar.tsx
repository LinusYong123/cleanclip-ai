"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

/** Smooth progress bar: eases toward the real value and creeps forward slowly between updates. */
export default function ProgressBar({ pct, msg }: { pct: number; msg: string }) {
  const [shown, setShown] = useState(0);
  const target = useRef(pct);
  target.current = pct;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((s) => {
        const t = target.current;
        if (t < s - 10) return t;                              // a new job started
        if (s < t) return s + Math.max((t - s) * 0.08, 0.05);  // ease toward the real value
        return t >= 100 ? 100 : Math.min(s + 0.012, Math.min(t + 4, 99)); // gentle creep while waiting
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const v = Math.min(100, shown);
  // Messages like "2/4 Discovery: ..." light up the matching step of the four-stage pipeline
  const m = /^([1-4])\/4\s+(.*)$/.exec(msg);
  const step = m ? Number(m[1]) : 0;
  const label = m ? m[2] : msg;
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} className="rounded-2xl border border-line bg-surface p-4">
      {step > 0 && (
        <div className="mb-3 flex gap-1.5 text-[11px]">
          {["Segment", "Discover", "Verify", "Provenance"].map((s, i) => (
            <div key={s} className={`flex-1 rounded-md px-2 py-1 text-center ${i + 1 === step ? "bg-accent font-semibold text-bg" : i + 1 < step ? "bg-accent/20 text-accent" : "bg-line text-body"}`}>
              {i + 1}. {s}
            </div>
          ))}
        </div>
      )}
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-white">{label}</span>
        <span className="font-semibold tabular-nums text-cream">{Math.round(v)}%</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-accent" style={{ width: `${v}%` }} />
        <motion.div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cream/30 to-transparent"
          animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }} />
      </div>
    </div>
  );
}
