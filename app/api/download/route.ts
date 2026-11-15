import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { parseVideoUrl } from "@/lib/platforms";

/**
 * POST { url, title } -> { url }: a 5-minute signed link to the worker, which streams the video straight to the browser.
 * Only video URLs on supported platforms are accepted, so this can't be used as a general proxy.
 */
export async function POST(req: Request) {
  const { url, title } = await req.json();
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  if (!(await supabase.auth.getUser()).data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!process.env.WORKER_URL || !process.env.WORKER_SECRET) return NextResponse.json({ error: "Downloads need the frame worker. Set WORKER_URL and WORKER_SECRET." }, { status: 400 });
  if (!parseVideoUrl(url ?? "")) return NextResponse.json({ error: "That link can't be downloaded." }, { status: 400 });

  const exp = Math.floor(Date.now() / 1000) + 300;
  const sig = crypto.createHmac("sha256", process.env.WORKER_SECRET).update(`${url}|${exp}`).digest("hex");
  const name = String(title ?? "video").replace(/[^\w .-]/g, "").slice(0, 80) || "video";
  return NextResponse.json({ url: `${process.env.WORKER_URL}/download?${new URLSearchParams({ url, exp: String(exp), sig, name })}` });
}
