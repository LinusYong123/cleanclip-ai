"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import { supabaseBrowser } from "@/lib/supabase/client";

function AuthForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = supabaseBrowser();
  const redirectTo = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback?next=${encodeURIComponent(next)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error, data } = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    if (mode === "signup" && !data.session) return setMsg({ ok: true, text: "Check your email to confirm your account." });
    router.push(next); router.refresh();
  }

  async function magicLink() {
    if (!email) return setMsg({ ok: false, text: "Enter your email first." });
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Magic link sent. Check your inbox." });
  }

  const google = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  const input = "w-full rounded-xl border border-line bg-bg px-4 py-3 text-white outline-none transition focus:border-accent";

  return (
    <motion.form onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="mx-auto mt-20 w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-8">
      <h1 className="text-2xl font-bold text-white">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
      <input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className={input} type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {msg && <p className={`text-sm ${msg.ok ? "text-cream" : "text-red-400"}`}>{msg.text}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-bg transition hover:brightness-110 disabled:opacity-50">
        {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
      </button>
      <button type="button" onClick={magicLink} className="w-full rounded-xl border border-line py-3 text-sm text-white transition hover:border-accent">Email me a magic link</button>
      <button type="button" onClick={google} className="w-full rounded-xl border border-line py-3 text-sm text-white transition hover:border-accent">Continue with Google</button>
      <p className="text-center text-sm text-body">
        {mode === "signin" ? "New here? " : "Already have an account? "}
        <button type="button" className="text-cream underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Sign up" : "Sign in"}
        </button>
      </p>
    </motion.form>
  );
}

export default function AuthPage() {
  return (
    <main className="min-h-screen bg-bg px-4 text-body">
      <Navbar />
      <Suspense><AuthForm /></Suspense>
    </main>
  );
}
