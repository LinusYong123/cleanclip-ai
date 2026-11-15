"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FeedIdea, NicheFeedResponse } from "@/lib/niche/api";

interface DailyNicheDashboardProps {
  /** Kept so existing usages still compile. The feed uses the signed-in session, and every plan sees the same thing. */
  userId?: string;
  userPlan?: "free" | "pro" | "elite";
}

interface ErrorBody { error?: string | { message?: string } }
const errorText = (body: ErrorBody | null, fallback: string) =>
  typeof body?.error === "string" ? body.error : body?.error?.message ?? fallback;

const splitList = (value: string) => value.split(",").map((t) => t.trim()).filter(Boolean);
const JSON_HEADERS = { "Content-Type": "application/json" };

export default function DailyNicheDashboard(_props: DailyNicheDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [feed, setFeed] = useState<NicheFeedResponse | null>(null);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tracing, setTracing] = useState<{ id: string; pct: number; msg: string } | null>(null);
  const [error, setError] = useState("");
  const [keywords, setKeywords] = useState("");
  const [excludeTerms, setExcludeTerms] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const loadFeed = useCallback(async (): Promise<NicheFeedResponse | null> => {
    const res = await fetch("/api/niche-feed");
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(errorText(body, "Couldn't load your ideas."));
      return null;
    }
    const data = body as NicheFeedResponse;
    setFeed(data);
    return data;
  }, []);

  const reload = useCallback(async () => {
    setReloading(true);
    setError("");
    try {
      const res = await fetch("/api/niche-feed/reload", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(errorText(body, "Couldn't get new ideas."));
      else if (body?.created === 0 && body?.message) setError(body.message);
      await loadFeed();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setReloading(false);
    }
  }, [loadFeed]);

  // First visit: load the feed, fill the form, and fetch ideas automatically if there are none yet
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const data = await loadFeed();
        if (data?.niche) {
          setKeywords(data.niche.keywords.join(", "));
          setExcludeTerms(data.niche.exclude_terms.join(", "));
        }
        if (data?.has_niches && data.ideas.length === 0) await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadFeed, reload]);

  // Tick once a second while the reload cooldown is running
  const cooldownEnds = feed?.reload.next_reload_at ? Date.parse(feed.reload.next_reload_at) : 0;
  useEffect(() => {
    if (cooldownEnds <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownEnds]);
  const wait = Math.max(0, Math.ceil((cooldownEnds - now) / 1000));
  const reloadsLeft = feed?.reload.reloads_left_today ?? 0;
  const canReload = !!feed?.has_niches && !reloading && !saving && !tracing && wait === 0 && reloadsLeft > 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/niche/preferences", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ keywords: splitList(keywords), exclude_terms: splitList(excludeTerms) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorText(body, "Couldn't save your keywords."));
        return;
      }
      await reload(); // new keywords, new ideas
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /** Runs the full reverse search for one idea. It uses one of the user's normal reverse searches. */
  const handleTrace = async (idea: FeedIdea) => {
    setTracing({ id: idea.id, pct: 0, msg: "Starting" });
    setError("");
    try {
      const res = await fetch("/api/trace", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url: idea.url }) });
      if (!res.headers.get("content-type")?.includes("ndjson")) {
        setError(errorText(await res.json().catch(() => null), "Couldn't start the search."));
        return;
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const m = JSON.parse(line) as { type: string; pct?: number; msg?: string; error?: string };
          if (m.type === "progress") setTracing({ id: idea.id, pct: m.pct ?? 0, msg: m.msg ?? "" });
          else if (m.type === "error") failure = m.error ?? "The search failed.";
        }
      }
      if (failure) setError(failure);
      await loadFeed(); // the result now appears on the card
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setTracing(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64 text-slate-400">Loading ideas...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 bg-slate-950 text-slate-100 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Niche Ideas</h1>
          <p className="text-slate-400 text-sm mt-1">Fresh trending videos in your niche. Press reload any time for new ones.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            <strong className="text-white">{reloadsLeft}</strong> / {feed?.reload.reloads_per_day ?? 0} reloads left today
          </span>
          <button
            onClick={reload}
            disabled={!canReload}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {reloading ? "Finding ideas..." : wait > 0 ? `Reload in ${wait}s` : "Reload ideas"}
          </button>
        </div>
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Niche settings */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-6 h-fit space-y-6">
          <h2 className="text-xl font-semibold text-white">Your niche</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Keywords (comma-separated, up to 10)</label>
              <textarea
                rows={3}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="badminton tips, smash technique, footwork"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Words to avoid (comma-separated)</label>
              <input
                type="text"
                value={excludeTerms}
                onChange={(e) => setExcludeTerms(e.target.value)}
                placeholder="compilation, top10, shorts"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving || reloading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save and get ideas"}
            </button>
          </form>
        </div>

        {/* Ideas */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-white">Ideas for you</h2>
            <span className="text-xs text-slate-400">{feed?.ideas.length ?? 0} videos</span>
          </div>

          {!feed?.has_niches ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
              Add a few keywords on the left and press save to get your first ideas.
            </div>
          ) : feed.ideas.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
              {reloading ? "Finding ideas..." : "No ideas yet. Press reload to get some."}
            </div>
          ) : (
            <div className="space-y-4">
              {feed.ideas.map((idea) => (
                <div key={idea.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <img
                      src={idea.thumbnail_url}
                      alt={idea.title}
                      className="w-full sm:w-44 h-28 object-cover rounded-lg border border-slate-800 bg-slate-950"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <a href={idea.url} target="_blank" rel="noreferrer" className="font-semibold text-slate-100 text-base line-clamp-2 hover:text-white">
                          {idea.title}
                        </a>
                        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                          Score: {Math.round(idea.trend_score)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Channel: <span className="text-slate-200">{idea.channel_title}</span>
                      </p>
                      {idea.selection_reason && <p className="text-xs text-indigo-300 italic">&quot;{idea.selection_reason}&quot;</p>}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-xs">
                    {tracing?.id === idea.id ? (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-slate-300">
                          <span>{tracing.msg}</span>
                          <span className="tabular-nums">{tracing.pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${tracing.pct}%` }} />
                        </div>
                      </div>
                    ) : idea.trace ? (
                      idea.trace.primary_source_url ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <a href={idea.trace.primary_source_url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 font-medium">
                            View original source ↗
                          </a>
                          <span className="text-slate-400">
                            {[idea.trace.primary_author, idea.trace.confidence && `${idea.trace.confidence} confidence`].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">
                          {idea.trace.is_likely_original ? "No earlier upload found. This looks like the original." : "No confident original source found."}
                        </span>
                      )
                    ) : (
                      <button
                        onClick={() => handleTrace(idea)}
                        disabled={!!tracing || reloading}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        Find original source
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">Finding an original source uses one of your reverse searches.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
