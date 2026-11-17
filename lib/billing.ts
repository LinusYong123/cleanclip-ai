/* eslint-disable @typescript-eslint/no-explicit-any */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { priceIds, type PlanId, type Interval } from "./plans";

/** Service-role client: server only. */
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const iso = (n?: number) => (n ? new Date(n * 1000).toISOString() : null);

/** Which plan does this Stripe price belong to? (An env var can list several IDs, e.g. old and new prices.) */
export function fromPrice(id: string): { plan: PlanId; interval: Interval } | null {
  for (const plan of ["pro", "elite"] as const) for (const interval of ["month", "year"] as const)
    if (priceIds(plan, interval).includes(id)) return { plan, interval };
  return null;
}

/**
 * Copies a Stripe subscription into our table. This is what grants (or removes) a plan's searches.
 * Used by the webhook AND by the return-from-checkout and cancel endpoints, so the plan updates immediately.
 */
export async function sync(sub: Stripe.Subscription, userId?: string) {
  const item: any = sub.items.data[0];
  if (!item) throw new Error(`Stripe subscription ${sub.id} has no subscription items.`);
  const match = fromPrice(item.price.id);
  const live = ["active", "trialing", "past_due"].includes(sub.status);
  if (live && !match) throw new Error(`No plan is configured for Stripe price ${item.price.id}.`);
  const patch = {
    plan: live && match ? match.plan : "free",
    interval: live && match ? match.interval : null,
    status: sub.status,
    stripe_subscription_id: sub.id,
    current_period_start: iso(item.current_period_start ?? (sub as any).current_period_start),
    current_period_end: iso(item.current_period_end ?? (sub as any).current_period_end),
    trial_ends_at: iso(sub.trial_end ?? undefined),
    cancel_at_period_end: sub.cancel_at_period_end || !!(sub as any).cancel_at,
    ...(sub.trial_end ? { trial_used: true } : {}), // never reset: one trial per account
  };
  const uid = userId ?? sub.metadata?.user_id;
  if (uid) {
    const { error } = await admin.from("subscriptions").upsert({ user_id: uid, ...patch });
    if (error) throw new Error(`Could not sync subscription ${sub.id}: ${error.message}`);
    return;
  }

  const { data, error } = await admin.from("subscriptions").update(patch)
    .eq("stripe_subscription_id", sub.id).select("user_id").maybeSingle();
  if (error) throw new Error(`Could not sync subscription ${sub.id}: ${error.message}`);
  if (!data) throw new Error(`No account is linked to Stripe subscription ${sub.id}.`);
}
