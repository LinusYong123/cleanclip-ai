import { NextResponse } from "next/server";
/** Tells the dashboard which optional accuracy boosters are switched on. */
export const GET = () => NextResponse.json({
  vision: !!process.env.GOOGLE_VISION_API_KEY, lens: !!process.env.SERPAPI_KEY, worker: !!process.env.WORKER_URL, scene: !!process.env.GEMINI_API_KEY,
});
