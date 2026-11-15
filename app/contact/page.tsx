"use client";
import { useState } from "react";
import { Mail, Clock } from "lucide-react";
import Navbar from "@/components/Navbar";

const statuses = ["Reverse search", "Clip processing", "Billing"];

export default function Contact() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setState(res.ok ? "sent" : "error");
  }
  const field = "w-full rounded-xl border border-line bg-bg px-4 py-3 text-white outline-none transition focus:border-accent";

  return (
    <main className="min-h-screen bg-bg text-body">
      <Navbar />
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-20 md:grid-cols-2">
        <section className="space-y-6">
          <h1 className="text-4xl font-bold text-white">Talk to us</h1>
          <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-accent" /> <a href="mailto:support@cleanclip.ai" className="text-cream underline">support@cleanclip.ai</a></p>
          <p className="inline-flex items-center gap-2 rounded-full bg-cream/10 px-3 py-1 text-sm text-cream"><Clock className="h-4 w-4" /> We reply within 24 hours</p>
          <ul className="space-y-2 rounded-2xl border border-line bg-surface p-5">
            {statuses.map((s) => (
              <li key={s} className="flex items-center justify-between text-sm">
                {s}<span className="flex items-center gap-2 text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Operational</span>
              </li>
            ))}
          </ul>
        </section>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6">
          <input name="name" required placeholder="Your name" className={field} />
          <input name="email" type="email" required placeholder="Email" className={field} />
          <textarea name="message" required rows={5} placeholder="How can we help?" className={field} />
          <button disabled={state === "sending"} className="w-full rounded-xl bg-accent py-3 font-semibold text-bg transition hover:brightness-110 disabled:opacity-50">
            {state === "sending" ? "Sending…" : "Send message"}
          </button>
          {state === "sent" && <p className="text-sm text-cream">Message sent. We'll be in touch soon.</p>}
          {state === "error" && <p className="text-sm text-red-400">Something went wrong. Email us directly instead.</p>}
        </form>
      </div>
    </main>
  );
}
