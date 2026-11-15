import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { splitScenes } from "@/lib/sceneSplit";

/** POST { frames:[{t,data}], duration } -> AI scene boundaries, or { segments: null } if unavailable. */
export async function POST(req: Request) {
  const { frames, duration } = await req.json();
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  if (!(await supabase.auth.getUser()).data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const bufs = (frames as { t: number; data: string }[]).slice(0, 40).map((f) => ({ t: f.t, buf: Buffer.from(f.data.split(",")[1], "base64") }));
    const r = await splitScenes(bufs, duration);
    return NextResponse.json(r ?? { segments: null });
  } catch { return NextResponse.json({ segments: null }); }
}
