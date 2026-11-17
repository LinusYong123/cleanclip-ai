/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { admin, sync } from "@/lib/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Pulls the latest subscription state from Stripe and applies it. The dashboard calls this right after Checkout,
 * so the plan updates even if the webhook is slow or not running (e.g. local development).
 */
export async function POST(req: Request) {
  const { session_id } = await req.json().catch(() => ({}));
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  try {
    let customer: string | null = null;
    if (session_id) {
      const s = await stripe.checkout.sessions.retrieve(session_id);
      if (s.client_reference_id !== user.id && s.metadata?.user_id !== user.id) return NextResponse.json({ error: "That checkout isn't yours." }, { status: 403 });
      customer = s.customer as string | null;
      if (customer) {
        const { error } = await admin.from("users").update({ stripe_customer_id: customer }).eq("id", user.id);
        if (error) throw error;
      }
      if (s.subscription) { await sync(await stripe.subscriptions.retrieve(s.subscription as string), user.id); return NextResponse.json({ ok: true }); }
    }
    if (!customer) customer = (await supabase.from("users").select("stripe_customer_id").single()).data?.stripe_customer_id ?? null;
    if (!customer) return NextResponse.json({ ok: true });
    const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 5 });
    const best = subs.data.find((s) => ["active", "trialing", "past_due"].includes(s.status)) ?? subs.data[0];
    if (best) await sync(best, user.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
