// lib/niche/http.ts: small helpers shared by the niche API routes.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { ApiError } from "./api";

export function respond<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export const fail = (status: number, code: ApiError["error"]["code"], message: string, field?: string) =>
  respond<ApiError>({ error: { code, message, field } }, status);

/** Supabase client bound to the caller's session (RLS applies) plus the signed-in user, if any. */
export async function getSession() {
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Service-role client for writes users aren't allowed to make directly. Server only. */
export const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
