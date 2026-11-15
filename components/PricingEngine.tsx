"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { PLANS, type Interval, type PlanId } from "@/lib/plans";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Pricing table with Monthly/Yearly toggle and live discount breakdown. */
/** 19.99 -> "19.99", 15 -> "15" */
const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function PricingEngine({ currentPlan }: { currentPlan?: PlanId }) {
  const [interval, setInterval] = useState<Interval>("month");
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [eligible, setEligible] = useState(true); // free trial: Elite only, once per account
  const [msg, setMsg] = useState("");
  const [own, setOwn] = useState<PlanId | undefined>();
  const cur = currentPlan ?? own; // the dashboard passes it; on /pricing we look it up
  useEffect(() => {
    supabaseBrowser().from("subscriptions").select("plan,trial_used").maybeSingle().then(({ data }) => { setEligible(!data || (data.plan === "free" && !data.trial_used)); setOwn(data?.plan); });
  }, []);

  async function checkout(plan: PlanId) {
    if (plan === "free") return (window.location.href = "/auth");
    setLoading(plan);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval, trial: plan === "elite" && eligible }),
    });
    if (res.status === 401) return (window.location.href = "/auth?next=/pricing");
    const out = await res.json();
    if (!res.ok) { setLoading(null); setMsg(out.error); return; }
    const { url } = out;
    window.location.href = url; // Stripe Checkout
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      {eligible && (
        <div className="mx-auto mb-8 max-w-xl rounded-2xl border border-cream/40 bg-cream/10 px-5 py-4 text-center">
          <p className="font-semibold text-cream">Try Elite free for 7 days</p>
          <p className="text-sm">Unlimited searches, priority queue, everything. Card required. Cancel any time before day 7 and you won&apos;t be charged.</p>
        </div>
      )}
      {/* Toggle */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <div role="tablist" className="relative flex rounded-full border border-line bg-surface p-1">
          {(["month", "year"] as const).map((i) => (
            <button key={i} role="tab" aria-selected={interval === i} onClick={() => setInterval(i)}
              className={`relative z-10 rounded-full px-6 py-2 text-sm font-medium transition-colors ${interval === i ? "text-bg" : "text-body hover:text-white"}`}>
              {interval === i && (
                <motion.span layoutId="pill" className="absolute inset-0 -z-10 rounded-full bg-accent"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }} />
              )}
              {i === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        <span className="rounded-full bg-cream/10 px-3 py-1 text-xs font-medium text-cream">
          Save 25% with Annual Billing!
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((p) => {
          const featured = p.id === "pro";
          const perMonth = interval === "year" ? p.yearly / 12 : p.monthly;
          return (
            <motion.div key={p.id} id={p.id} whileHover={{ y: -4 }}
              className={`flex flex-col rounded-2xl border p-7 ${featured ? "border-accent bg-surface shadow-[0_0_40px_-12px_#3D8D7A]" : "border-line bg-surface"} ${p.id === "elite" && eligible ? "ring-2 ring-cream/50" : ""}`}>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-white">{p.name}{p.id === "elite" && eligible && <span className="rounded-full bg-cream/10 px-2 py-0.5 text-xs font-medium text-cream">7 days free</span>}</h3>

              <div className="mt-4 flex items-baseline gap-2">
                {interval === "year" && p.monthly > 0 && (
                  <span className="text-lg text-body/60 line-through">${money(p.monthly)}</span>
                )}
                <AnimatePresence mode="popLayout">
                  <motion.span key={`${p.id}-${interval}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }} className="text-4xl font-bold text-white">
                    ${money(perMonth)}
                  </motion.span>
                </AnimatePresence>
                <span className="text-body">/mo</span>
              </div>

              <p className="mt-1 h-5 text-sm text-body">
                {p.monthly === 0 ? "Free forever"
                  : interval === "year" ? `Billed $${money(p.yearly)} annually instead of $${money(Math.round(p.monthly * 12 * 100) / 100)}`
                  : "Billed monthly"}
              </p>

              <ul className="my-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm text-body">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {f}
                  </li>
                ))}
              </ul>

              <button onClick={() => checkout(p.id)} disabled={cur === p.id || loading === p.id}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream disabled:opacity-50 ${
                  featured ? "bg-accent text-bg hover:brightness-110" : "border border-line text-white hover:border-accent"}`}>
                {cur === p.id ? "Current plan" : loading === p.id ? "Redirecting…" : p.id === "elite" && eligible ? "Start 7-day free trial" : p.cta}
              </button>
              {p.id === "elite" && eligible && cur !== "elite" && (
                <p className="mt-3 text-center text-xs">Card required. Free for 7 days, then {interval === "year" ? `$${money(p.yearly)}/year` : `$${money(p.monthly)}/month`}. Cancel any time before day 7 and you won&apos;t be charged.</p>
              )}
            </motion.div>
          );
        })}
      </div>
      {msg && <p className="mt-6 text-center text-sm text-red-400">{msg}</p>}
    </section>
  );
}
