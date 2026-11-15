import { NextResponse } from "next/server";
import Stripe from "stripe";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** Opens Stripe's billing portal (change card, switch plan, cancel, invoices). */
export async function POST() {
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data: profile } = await supabase.from("users").select("stripe_customer_id").single();
  if (!profile?.stripe_customer_id) return NextResponse.json({ error: "No active subscription yet." }, { status: 400 });
  const s = await stripe.billingPortal.sessions.create({ customer: profile.stripe_customer_id, return_url: `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard` });
  return NextResponse.json({ url: s.url });
}
