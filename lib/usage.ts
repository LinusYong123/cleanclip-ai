/** Start of the current usage window: the billing period for paid users, the calendar month for Free. */
export function windowStart(sub?: { plan?: string; current_period_start?: string | null } | null) {
  if (sub && sub.plan !== "free" && sub.current_period_start) return new Date(sub.current_period_start);
  const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d;
}
