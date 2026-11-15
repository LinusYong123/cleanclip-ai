import { NextResponse } from "next/server";
import Stripe from "stripe";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { priceId, type Interval, type PlanId } from "@/lib/plans";
import { sync } from "@/lib/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** POST { plan, interval } -> { url }. New buyers go to Checkout; existing subscribers are switched in place (no double billing). */
export async function POST(req: Request) {
  const { plan, interval, trial } = (await req.json()) as { plan: PlanId; interval: Interval; trial?: boolean };
  const price = priceId(plan, interval);
  if (plan === "free" || !price) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  const { data: sub } = await supabase.from("subscriptions").select("plan,status,stripe_subscription_id,trial_used").single();
  const { data: profile } = await supabase.from("users").select("stripe_customer_id").single();

  if (sub?.stripe_subscription_id && sub.plan !== "free" && ["active", "trialing", "past_due"].includes(sub.status)) {
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const item = current.items.data[0];
    if (item.price.id === price) return NextResponse.json({ error: "You're already on this plan." }, { status: 400 });
    const switched = await stripe.subscriptions.update(current.id, { items: [{ id: item.id, price }], proration_behavior: "create_prorations" });
    await sync(switched, user.id); // plan changes right away
    return NextResponse.json({ url: `${site}/dashboard?upgraded=1` }); // webhook syncs the new plan
  }

  // One free trial per account, Elite only, and only for people who aren't already subscribed
  if (trial && (plan !== "elite" || sub?.trial_used || (sub && sub.plan !== "free")))
    return NextResponse.json({ error: "The free trial isn't available on this account." }, { status: 400 });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    ...(profile?.stripe_customer_id ? { customer: profile.stripe_customer_id } : { customer_email: user.email }),
    client_reference_id: user.id,
    metadata: { user_id: user.id, plan, interval },
    payment_method_collection: "always", // card required, even during the free trial
    subscription_data: {
      metadata: { user_id: user.id },
      ...(trial ? { trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } } } : {}),
    },
    ...(trial ? { custom_text: { submit: { message: "Your 7-day Elite trial starts today. You won't be charged until it ends, and you can cancel any time before then." } } } : {}),
    success_url: `${site}/dashboard?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/pricing`,
  });
  return NextResponse.json({ url: session.url });
}
