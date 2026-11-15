import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Saves contact messages to Supabase (view them in the table editor). */
export async function POST(req: Request) {
  const { name, email, message } = await req.json();
  if (!name || !email || !message) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const { error } = await db.from("contact_messages").insert({ name, email, message });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
