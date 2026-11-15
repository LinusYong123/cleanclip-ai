"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, Zap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Sticky header: Upgrade is always visible, and so is the free-trial button until someone has used it or subscribed. */
export default function Navbar() {
  const [email, setEmail] = useState<string | null>(null);
  const [trial, setTrial] = useState(true); // visitors and new users are eligible; hidden once we know otherwise

  useEffect(() => {
    const sb = supabaseBrowser();
    const check = async (user: { email?: string } | null) => {
      setEmail(user?.email ?? null);
      if (!user) return setTrial(true);
      const { data } = await sb.from("subscriptions").select("plan,trial_used").maybeSingle();
      setTrial(!data || (data.plan === "free" && !data.trial_used));
    };
    sb.auth.getUser().then(({ data }) => check(data.user));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => check(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/" className="text-lg font-bold text-white">CleanClip <span className="text-accent">AI</span></Link>
        <nav className="hidden gap-6 text-sm text-body md:flex">
          {[["/dashboard", "Dashboard"], ["/pricing", "Pricing"], ...(email ? [["/billing", "Billing"]] : []), ["/contact", "Contact"]].map(([h, l]) => (
            <Link key={h} href={h} className="transition hover:text-white">{l}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          {trial && (
            <Link href="/pricing#elite" className="flex items-center gap-1.5 rounded-full bg-cream px-3 py-2 text-sm font-semibold text-bg shadow-[0_0_20px_-2px_#FFFACD] transition hover:brightness-95 sm:px-4">
              <Zap className="h-4 w-4" /><span className="hidden sm:inline">Try Elite free for 7 days</span><span className="sm:hidden">Free trial</span>
            </Link>
          )}
          <Link href="/pricing" className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-sm font-semibold text-cream shadow-[0_0_20px_-2px_#3D8D7A] transition hover:brightness-110 sm:px-4">
            <Sparkles className="h-4 w-4" /> Upgrade
          </Link>
          {email ? (
            <button className="hidden text-sm text-body transition hover:text-white sm:block" title={email}
              onClick={async () => { await supabaseBrowser().auth.signOut(); window.location.href = "/"; }}>Sign out</button>
          ) : <Link href="/auth" className="text-sm text-white">Sign in</Link>}
        </div>
      </div>
    </header>
  );
}
