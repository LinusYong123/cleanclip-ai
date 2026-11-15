import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { BONUS, QUESTIONS, validate } from "@/lib/survey";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); // server only

/** Saves the survey once per user and adds the bonus searches. The reward doesn't depend on what the answers say. */
export async function POST(req: Request) {
  const { answers } = await req.json();
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const err = validate(answers ?? {});
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // Keep only known questions
  const clean = Object.fromEntries(QUESTIONS.filter((q) => answers[q.id] != null).map((q) => [q.id, answers[q.id]]));
  const { error } = await db.from("survey_responses").insert({ user_id: user.id, answers: clean });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "You've already completed the survey. Thank you!" }, { status: 409 });
    return NextResponse.json({ error: "Couldn't save your answers. Please try again." }, { status: 500 });
  }
  const { data: s } = await db.from("subscriptions").select("bonus_searches").eq("user_id", user.id).single();
  await db.from("subscriptions").update({ bonus_searches: (s?.bonus_searches ?? 0) + BONUS }).eq("user_id", user.id);
  return NextResponse.json({ ok: true, bonus: BONUS });
}
