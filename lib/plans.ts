/** Single source of truth for pricing. Yearly = exactly 25% off 12 monthly payments. */
export type PlanId = "free" | "pro" | "elite";
export type Interval = "month" | "year";

export interface Plan {
  id: PlanId;
  name: string;
  monthly: number;
  yearly: number;          // total billed per year
  limit: number | null;    // credits per billing period; null = unlimited
  features: string[];
  cta: string;
}

export const PLANS: Plan[] = [
  { id: "free", name: "Free", monthly: 0, yearly: 0, limit: 3, cta: "Get Started Free",
    features: ["3 credits / month", "Basic clip segmentation", "Standard speed processing"] },
  { id: "pro", name: "Pro", monthly: 19.99, yearly: 179.99, limit: 15, cta: "Upgrade to Pro",
    features: ["15 credits / month", "Advanced video source tracing & metadata breakdown", "HD clip exports"] },
  { id: "elite", name: "Elite", monthly: 39.99, yearly: 359.99, limit: null, cta: "Go Unlimited with Elite",
    features: ["Unlimited credits", "Real-time deep YouTube original source tracing",
      "Priority queue & bulk clip segmentation", "Premium support"] },
];

/** Stripe price IDs come from env. An env var may hold several IDs separated by commas (e.g. old and new prices). */
export const priceIds = (plan: PlanId, interval: Interval) =>
  (process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEARLY" : "MONTHLY"}`] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
/** The first ID is used for new checkouts. */
export const priceId = (plan: PlanId, interval: Interval) => priceIds(plan, interval)[0];
