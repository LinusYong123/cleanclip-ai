import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client (used in "use client" components). */
export const supabaseBrowser = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
