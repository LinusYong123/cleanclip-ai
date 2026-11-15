/* eslint-disable @typescript-eslint/no-explicit-any */
/** Survey questions, shared by the page and the API so both validate the same way. */
export const BONUS = 10;

export type Q = {
  id: string; group: string; type: "select" | "scale" | "text" | "multi"; label: string; help?: string;
  options?: string[]; min?: number; max?: number; lo?: string; hi?: string; required?: boolean;
};

export const QUESTIONS: Q[] = [
  { id: "source", group: "About you", type: "select", required: true, label: "How did you find out about CleanClip AI?",
    options: ["Google or another search engine", "TikTok", "YouTube", "Instagram", "Facebook", "Reddit", "A friend or coworker", "News or a blog", "Other"] },
  { id: "source_other", group: "About you", type: "text", label: "If you picked Other, where did you hear about us?" },
  { id: "role", group: "About you", type: "select", required: true, label: "What best describes you?",
    options: ["Content creator", "Video editor", "Journalist or researcher", "Copyright or legal work", "Social media manager", "Just curious", "Other"] },
  { id: "frequency", group: "About you", type: "select", required: true, label: "How often do you need to trace a video back to its source?",
    options: ["Daily", "Weekly", "Monthly", "A few times a year", "Rarely"] },

  { id: "last_tried", group: "Your last attempt", type: "select", required: true, label: "When did you last try to find the original source of a video?",
    options: ["Today", "In the past week", "In the past month", "1 to 6 months ago", "More than 6 months ago", "I've never tried"] },
  { id: "how_tried", group: "Your last attempt", type: "text", required: true, label: "How did you try to find it? Which tools or methods did you use?",
    help: "Google Lens, TikTok search, asking friends, paid tools... anything counts." },
  { id: "ease", group: "Your last attempt", type: "scale", required: true, min: 1, max: 5, lo: "Very hard", hi: "Very easy", label: "How easy was it?" },
  { id: "challenges", group: "Your last attempt", type: "text", required: true, label: "What made it challenging?" },

  { id: "time_spent", group: "The cost of the problem", type: "select", required: true, label: "How much time did you spend trying to solve this problem?",
    options: ["Under 5 minutes", "5 to 30 minutes", "30 to 60 minutes", "1 to 3 hours", "More than 3 hours", "Days or longer"] },
  { id: "money_spent", group: "The cost of the problem", type: "select", required: true, label: "How much money have you spent trying to solve it (tools, subscriptions, freelancers)?",
    options: ["Nothing", "Under $10", "$10 to $50", "$50 to $200", "$200 to $1,000", "More than $1,000"] },
  { id: "consequence", group: "The cost of the problem", type: "text", required: true, label: "What would happen if you never solved it?",
    help: "Lost credit, lost income, legal trouble, wasted hours, or nothing much? Be honest." },
  { id: "use_case", group: "The cost of the problem", type: "text", label: "What do you do once you find the original?", help: "For example: credit the creator, request a takedown, license it, or reuse it." },

  { id: "easier_now", group: "This app", type: "text", required: true, label: "What about CleanClip AI makes this easier now?" },
  { id: "still_missing", group: "This app", type: "text", required: true, label: "What's still hard, broken or missing? Be blunt.", help: "Wrong matches, slow traces, confusing screens, missing platforms... we want the unflattering truth." },
  { id: "features", group: "This app", type: "multi", label: "Which features matter most to you? (pick any)",
    options: ["Accurate matches", "Finding clean versions without watermarks", "Splitting compilations into clips", "Speed", "TikTok, Instagram and Facebook coverage", "Exact timestamps in the original", "Bulk processing", "API access"] },

  { id: "pricing_feel", group: "Pricing", type: "select", required: true, label: "How does our pricing feel to you?",
    options: ["Cheaper than I expected", "Great value", "Fair", "A bit high", "Too expensive", "I haven't looked closely"] },
  { id: "pricing_text", group: "Pricing", type: "text", label: "Your honest take on pricing: what would you change?",
    help: "Plans, limits, the free tier, the trial, what you'd happily pay for. Criticism is welcome." },

  { id: "nps", group: "Last thoughts", type: "scale", required: true, min: 0, max: 10, lo: "Not likely", hi: "Very likely", label: "How likely are you to recommend CleanClip AI to a friend or coworker?" },
  { id: "build_next", group: "Last thoughts", type: "text", label: "If you could change one thing, what should we build or fix first?" },
];

export const isEmpty = (v: any) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "string" && !v.trim());

/** Returns an error message, or null if the answers are valid. */
export function validate(a: Record<string, any>): string | null {
  for (const q of QUESTIONS) {
    const v = a[q.id];
    if (isEmpty(v)) { if (q.required) return `Please answer: ${q.label}`; continue; }
    if (q.type === "text") {
      const t = String(v).trim();
      if (t.length > 2000) return "Answers can be up to 2,000 characters.";
      if (q.required && t.length < 8) return `Please write a bit more for: ${q.label}`;
    }
    if (q.type === "select" && !q.options!.includes(v)) return "Invalid answer.";
    if (q.type === "multi" && !(Array.isArray(v) && v.every((x) => q.options!.includes(x)))) return "Invalid answer.";
    if (q.type === "scale" && !(Number.isInteger(v) && v >= q.min! && v <= q.max!)) return "Invalid answer.";
  }
  return null;
}
