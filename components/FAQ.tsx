"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

const faqs = [
  ["What counts as a reverse search?", "Each YouTube link you trace counts as one search."],
  ["Do unused searches roll over?", "No. Your allowance resets at the start of each month."],
  ["Can I cancel anytime?", "Yes. Cancel from billing and you keep access until the period ends."],
  ["How does source tracing work?", "We read the video's details, then look for earlier uploads with the same title and length to find the likely original."],
];

/** Smooth animated accordion: one item open at a time. */
export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {faqs.map(([q, a], i) => {
        const isOpen = open === i;
        return (
          <div key={q} className={`overflow-hidden rounded-2xl border transition-colors duration-300 ${isOpen ? "border-accent bg-surface" : "border-line bg-surface/60 hover:border-accent/50"}`}>
            <button onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream">
              {q}
              <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3 }}>
                <ChevronDown className="h-5 w-5 text-accent" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-body">{a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
