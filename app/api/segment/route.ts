import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { detectRanking } from "@/lib/ranking";

/** POST { frames:[{t,data}], duration } -> ranking-based clips, or { segments: null } if it isn't a ranking video. */
export async function POST(req: Request) {
  const { frames, duration } = await req.json();
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  if (!(await supabase.auth.getUser()).data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const bufs = (frames as { t: number; data: string }[]).slice(0, 40).map((f) => ({ t: f.t, buf: Buffer.from(f.data.split(",")[1], "base64") }));
    const r = await detectRanking(bufs, duration);
    return NextResponse.json(r ? { segments: r.segments, direction: r.direction, first: r.first, last: r.last } : { segments: null });
  } catch { return NextResponse.json({ segments: null }); }
}
