/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/components/Navbar";
import { supabaseBrowser } from "@/lib/supabase/client";
import { windowStart } from "@/lib/usage";
import { PLANS } from "@/lib/plans";

const date = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "");

export default function Billing() {
  const sb = supabaseBrowser();
  const [sub, setSub] = useState<any>(null);
  const [used, setUsed] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data: s } = await sb.from("subscriptions").select("*").maybeSingle();
    setSub(s);
    const { count } = await sb.from("searches_usage").select("*", { count: "exact", head: true }).gte("created_at", windowStart(s).toISOString());
    setUsed(count ?? 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function act(path: string, body: any = {}) {
    setBusy(true); setMsg("");
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Something went wrong."); return null; }
    await load(); return d;
  }
  const portal = async () => { const d = await act("/api/portal"); if (d?.url) window.location.href = d.url; };

  if (!sub) return <main className="min-h-screen bg-bg text-body"><Navbar /><p className="mt-20 text-center">Loading…</p></main>;

  const plan = PLANS.find((p) => p.id === sub.plan)!;
  const paid = sub.plan !== "free";
  const trialing = sub.status === "trialing";
  const price = sub.interval === "year" ? `$${plan.yearly}/year` : `$${plan.monthly}/month`;
  const unlimited = plan.limit === null;
  const pct = unlimited ? 100 : Math.min(100, (Math.min(used, plan.limit!) / plan.limit!) * 100);
  const endDate = date(trialing ? sub.trial_ends_at : sub.current_period_end);

  return (
    <main className="min-h-screen bg-bg text-body">
      <Navbar />
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
        <h1 className="text-3xl font-bold text-white">Billing</h1>

        <section className="space-y-4 rounded-2xl border border-line bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">{plan.name} plan{trialing && <span className="ml-2 rounded-full bg-cream/10 px-2 py-0.5 text-xs text-cream">Free trial</span>}</h2>
            {paid && <span className="text-white">{price}</span>}
          </div>
          <p className="text-sm">
            {!paid && "You're on the Free plan."}
            {paid && trialing && !sub.cancel_at_period_end && `Your free trial ends ${endDate}. You'll be charged ${price} then, unless you cancel before.`}
            {paid && trialing && sub.cancel_at_period_end && `Your trial is cancelled. You keep ${plan.name} until ${endDate} and you won't be charged.`}
            {paid && !trialing && sub.cancel_at_period_end && `Your plan is cancelled. You keep ${plan.name} until ${endDate}, then move to Free.`}
            {paid && !trialing && !sub.cancel_at_period_end && `Renews on ${endDate}.`}
          </p>

          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span>Reverse searches this period</span>
              <span>{unlimited ? `${used} used · Unlimited` : `${Math.min(used, plan.limit!)} / ${plan.limit}`}{sub.bonus_searches ? ` (+${sub.bonus_searches} bonus)` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line"><motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: `${pct}%` }} /></div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/pricing" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110">{paid ? "Change plan" : "Upgrade"}</Link>
            {paid && !sub.cancel_at_period_end && <button onClick={() => setConfirm(true)} className="rounded-xl border border-line px-5 py-2.5 text-sm text-white transition hover:border-red-400">Cancel subscription</button>}
            {paid && sub.cancel_at_period_end && <button onClick={() => act("/api/billing/cancel", { resume: true })} disabled={busy} className="rounded-xl bg-cream px-5 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Resume subscription</button>}
            {paid && <button onClick={portal} disabled={busy} className="rounded-xl border border-line px-5 py-2.5 text-sm text-white transition hover:border-accent disabled:opacity-50">Payment method and invoices</button>}
          </div>
          {msg && <p className="text-sm text-red-400">{msg}</p>}
        </section>

        <p className="text-xs">Something look out of date? <button onClick={() => act("/api/billing/sync")} className="text-cream underline">Refresh from Stripe</button></p>
      </div>

      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirm(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-bg p-6">
              <h3 className="text-lg font-semibold text-white">Cancel your {plan.name} {trialing ? "trial" : "subscription"}?</h3>
              <p className="text-sm">{trialing ? `You keep Elite until ${endDate} and you won't be charged.` : `You keep ${plan.name} until ${endDate}, then move to the Free plan (3 searches a month). You can resume any time before then.`}</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setConfirm(false)} className="rounded-xl border border-line px-4 py-2 text-sm text-white">Keep it</button>
                <button onClick={async () => { if (await act("/api/billing/cancel")) setConfirm(false); }} disabled={busy} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Cancelling…" : "Yes, cancel"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
