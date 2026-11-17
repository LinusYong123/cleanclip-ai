"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { LayoutDashboard, History, Scissors, CreditCard, Sparkles, Gift } from "lucide-react";
import { PLANS, type PlanId } from "@/lib/plans";

interface Props { plan: PlanId; used: number; onUpgrade: () => void; bonus?: number }

const links = [
  { href: "/dashboard", Icon: LayoutDashboard, label: "Workspace" },
  { href: "/dashboard#history", Icon: History, label: "Search history" },
  { href: "/dashboard#clips", Icon: Scissors, label: "Clips" },
  { href: "/billing", Icon: CreditCard, label: "Billing" },
  { href: "/survey", Icon: Gift, label: "Free credits" },
];

/** Sidebar: the Upgrade button is ALWAYS rendered, whatever the plan. */
export default function DashboardSidebar({ plan, used, onUpgrade, bonus = 0 }: Props) {
  const info = PLANS.find((p) => p.id === plan)!;
  const unlimited = info.limit === null;
  const pct = unlimited ? 100 : Math.min(100, (used / info.limit!) * 100);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface p-5">
      <nav className="flex flex-col gap-1 text-sm text-body">
        {links.map(({ href, Icon, label }) => (
          <Link key={href} href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-line hover:text-white">
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <span className="inline-block rounded-full bg-cream/10 px-3 py-1 text-xs font-medium text-cream">{info.name} plan</span>
        <div>
          <div className="mb-1 flex justify-between text-xs text-body">
            <span>Credits</span>
            <span>{unlimited ? `${used} used · Unlimited` : `${Math.min(used, info.limit!)} / ${info.limit}${bonus ? ` (+${bonus} bonus)` : ""}`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <motion.div 
              className="h-full bg-accent" 
              initial={false} 
              animate={{ width: `${pct}%` }} 
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        {/* Persistent upgrade CTA, visible on Free, Pro and Elite */}
        <button onClick={onUpgrade}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg shadow-[0_0_24px_-4px_#3D8D7A] transition hover:brightness-110">
          <Sparkles className="h-4 w-4" /> {plan === "elite" ? "Manage plan" : "Upgrade plan"}
        </button>
      </div>
    </aside>
  );
}