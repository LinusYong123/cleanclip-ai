/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Gift, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import { supabaseBrowser } from "@/lib/supabase/client";
import { QUESTIONS, BONUS, validate, isEmpty, type Q } from "@/lib/survey";

const chip = (on: boolean) => `rounded-full border px-4 py-2 text-sm transition ${on ? "border-accent bg-accent/15 text-white" : "border-line text-body hover:border-accent/60"}`;

function Field({ q, value, onChange }: { q: Q; value: any; onChange: (v: any) => void }) {
  if (q.type === "text") return (
    <div>
      <textarea value={value ?? ""} maxLength={2000} rows={3} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-line bg-bg px-4 py-3 text-white outline-none transition focus:border-accent" />
      <p className="mt-1 text-right text-xs">{(value ?? "").length}/2000</p>
    </div>
  );
  if (q.type === "scale") return (
    <div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: q.max! - q.min! + 1 }, (_, i) => q.min! + i).map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} className={`${chip(value === n)} w-11 px-0 text-center`}>{n}</button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs"><span>{q.lo}</span><span>{q.hi}</span></div>
    </div>
  );
  const multi = q.type === "multi", sel: string[] = multi ? value ?? [] : [];
  return (
    <div className="flex flex-wrap gap-2">
      {q.options!.map((o) => {
        const on = multi ? sel.includes(o) : value === o;
        return <button key={o} type="button" onClick={() => onChange(multi ? (on ? sel.filter((x) => x !== o) : [...sel, o]) : o)} className={chip(on)}>{o}</button>;
      })}
    </div>
  );
}

export default function Survey() {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [state, setState] = useState<"loading" | "signin" | "done" | "form" | "sent">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return setState("signin");
      const { count } = await sb.from("survey_responses").select("*", { count: "exact", head: true });
      setState((count ?? 0) > 0 ? "done" : "form");
    });
  }, []);

  const required = QUESTIONS.filter((q) => q.required);
  const answered = required.filter((q) => !isEmpty(answers[q.id])).length;
  const groups = [...new Set(QUESTIONS.map((q) => q.group))];
  const set = (id: string, v: any) => setAnswers((a) => ({ ...a, [id]: v }));

  async function submit() {
    const err = validate(answers);
    if (err) return setError(err);
    setBusy(true); setError("");
    const res = await fetch("/api/survey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) { if (res.status === 409) return setState("done"); return setError(d.error); }
    setState("sent");
  }

  const card = "mx-auto mt-20 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center";
  return (
    <main className="min-h-screen bg-bg px-4 pb-24 text-body">
      <Navbar />
      {state === "loading" && <p className="mt-20 text-center">Loading…</p>}
      {state === "signin" && (
        <div className={card}><p className="mb-4 text-white">Sign in to take the survey and claim your {BONUS} free searches.</p>
          <Link href="/auth?next=/survey" className="rounded-xl bg-accent px-5 py-3 font-semibold text-bg">Sign in</Link></div>
      )}
      {state === "done" && (
        <div className={card}><CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-accent" /><p className="mb-4 text-white">You&apos;ve already completed the survey. Thank you!</p>
          <Link href="/dashboard" className="text-cream underline">Back to the dashboard</Link></div>
      )}
      {state === "sent" && (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={card}>
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-accent" />
          <h1 className="text-2xl font-bold text-white">Thank you!</h1>
          <p className="my-3">We added <b className="text-cream">{BONUS} bonus searches</b> to your account. We read every response and will do our best to act on it.</p>
          <Link href="/dashboard" className="inline-block rounded-xl bg-accent px-5 py-3 font-semibold text-bg">Use your searches</Link>
        </motion.div>
      )}

      {state === "form" && (
        <div className="mx-auto mt-12 max-w-2xl space-y-8">
          <header className="rounded-2xl border border-accent bg-surface p-6">
            <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold text-white"><Gift className="h-6 w-6 text-cream" /> Tell us the truth, get {BONUS} free searches</h1>
            <p className="text-sm leading-relaxed">
              We&apos;re building CleanClip AI around what people actually need, so we want <b className="text-white">honest feedback</b>, including
              criticism and anything about our <b className="text-white">pricing, plans or limits</b>. We read every response and will try to implement
              what we can. Your {BONUS} bonus searches don&apos;t depend on what you say, only that you answer thoughtfully. It takes about 5 minutes.
            </p>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs"><span>{answered} of {required.length} required answered</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(answered / required.length) * 100}%` }} /></div>
            </div>
          </header>

          {groups.map((g) => (
            <section key={g} className="space-y-6 rounded-2xl border border-line bg-surface p-6">
              <h2 className="text-lg font-semibold text-white">{g}</h2>
              {QUESTIONS.filter((q) => q.group === g).map((q) => (
                <div key={q.id}>
                  <label className="mb-1 block text-sm font-medium text-white">{q.label}{q.required ? <span className="text-cream"> *</span> : <span className="text-xs font-normal"> (optional)</span>}</label>
                  {q.help && <p className="mb-2 text-xs">{q.help}</p>}
                  <Field q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
                </div>
              ))}
            </section>
          ))}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={submit} disabled={busy} className="w-full rounded-xl bg-accent py-4 font-semibold text-bg transition hover:brightness-110 disabled:opacity-50">
            {busy ? "Sending…" : `Submit and get ${BONUS} free searches`}
          </button>
        </div>
      )}
    </main>
  );
}
