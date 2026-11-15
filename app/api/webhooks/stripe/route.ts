import { NextResponse } from "next/server";
import Stripe from "stripe";
import { admin, sync } from "@/lib/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature")!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch { return NextResponse.json({ error: "Bad signature" }, { status: 400 }); }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.metadata?.user_id;
    if (userId && s.subscription) {
      await admin.from("users").update({ stripe_customer_id: s.customer as string }).eq("id", userId);
      await sync(await stripe.subscriptions.retrieve(s.subscription as string), userId);
    }
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created")
    await sync(event.data.object as Stripe.Subscription);
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await admin.from("subscriptions").update({ plan: "free", interval: null, status: "canceled", cancel_at_period_end: false }).eq("stripe_subscription_id", sub.id);
  }
  return NextResponse.json({ received: true });
}
