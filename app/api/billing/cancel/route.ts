import { NextResponse } from "next/server";
import Stripe from "stripe";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sync } from "@/lib/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** POST {} cancels at the end of the paid (or trial) period, so access continues until then. POST {resume:true} undoes it. */
export async function POST(req: Request) {
  const { resume } = await req.json().catch(() => ({}));
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: sub } = await supabase.from("subscriptions").select("stripe_subscription_id").single();
  if (!sub?.stripe_subscription_id) return NextResponse.json({ error: "You don't have an active subscription." }, { status: 400 });
  try {
    const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: !resume });
    await sync(updated, user.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
