// Frame worker: reads only the needed slice with yt-dlp + ffmpeg and returns JPEG frames, their timestamps and the duration.
// Needs a real server (Docker on Railway/Render/Fly), not Vercel. Only process videos you're allowed to.
import http from "node:http";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const run = promisify(execFile);

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") {
    try {
      await Promise.all([run("yt-dlp", ["--version"]), run("ffmpeg", ["-version"]), run("ffprobe", ["-version"])]);
      return res.writeHead(200).end("ok");
    } catch (e) {
      return res.writeHead(500).end(`Dependency missing: ${e.message}`);
    }
  }

  // Signed browser download (a link can't carry an Authorization header, so the app signs url+expiry with WORKER_SECRET)
  if (u.pathname === "/download") {
    const url = u.searchParams.get("url") || "", exp = +(u.searchParams.get("exp") || 0), sig = u.searchParams.get("sig") || "";
    const want = crypto.createHmac("sha256", process.env.WORKER_SECRET).update(`${url}|${exp}`).digest("hex");
    const ok = sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    if (!ok || Date.now() / 1000 > exp) return res.writeHead(403).end("Link expired or invalid.");
    const name = (u.searchParams.get("name") || "video").replace(/[^\w .-]/g, "").slice(0, 80) || "video";
    // One progressive file (no merging), capped in size. Headers are sent only once data starts flowing, so failures aren't saved as empty files.
    // Use --user-agent to help with 429 errors on YouTube.
    const p = spawn("yt-dlp", ["-f", "b[ext=mp4]/b", "--no-playlist", "--no-warnings", "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "--js-runtimes", "node", "--remote-components", "ejs:github", "--max-filesize", "300M", "-o", "-", url]);
    let started = false;
    p.stdout.once("data", (chunk) => {
      started = true;
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="${name}.mp4"` });
      res.write(chunk); p.stdout.pipe(res);
    });
    p.on("close", () => { if (!started) res.writeHead(502).end("Couldn't download that video."); });
    p.on("error", () => { if (!started) res.writeHead(500).end(); });
    req.on("close", () => p.kill());
    return;
  }
  if (req.headers.authorization !== `Bearer ${process.env.WORKER_SECRET}`) {
    console.warn("Unauthorized request to /frames");
    return res.writeHead(401).end();
  }
  const q = u.searchParams;
  const url = q.get("url"), start = +q.get("start") || 0;
  if (!url) return res.writeHead(400).end(JSON.stringify({ error: "Missing url parameter" }));
  const interval = +q.get("interval") || 0;
  let n = Math.min(+q.get("n") || 6, 40);
  let dir;
  try {
    const src = (await run("yt-dlp", ["-g", "--no-playlist", "--no-warnings", "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "--js-runtimes", "node", "--remote-components", "ejs:github", "-f", "bestvideo[height<=480]/best[height<=480]/best", url])).stdout.trim().split("\n")[0];
    if (!src) throw new Error("yt-dlp could not find a video URL.");
    const total = +(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src])).stdout || 30;
    const dur = +q.get("dur") || Math.max(1, total - start);
    let step = interval > 0 ? Math.max(interval, dur / 40) : dur / n;
    if (interval > 0) {
      if (dur < interval) step = dur;
      n = Math.max(1, Math.min(40, Math.floor(dur / step - 0.5 + 1e-9) + 1));
    }
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "f-"));
    const fast = !interval && dur > 90 ? ["-skip_frame", "nokey"] : [];
    const fps = interval > 0
      ? `fps=fps=${1 / step}:start_time=${step / 2},scale=640:-2`
      : `fps=${n}/${dur},scale=640:-2`;
    await run("ffmpeg", ["-ss", String(start), ...fast, "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2", "-i", src, "-t", String(dur), "-vf", fps,
      "-frames:v", String(n), "-q:v", "2", path.join(dir, "f%02d.jpg")], { timeout: 50000 });
    const files = (await fs.readdir(dir)).sort();
    const frames = await Promise.all(files.map(async (f) => (await fs.readFile(path.join(dir, f))).toString("base64")));
    const times = files.map((_, i) => start + (interval > 0 ? step : dur / n) * (i + 0.5));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ frames, times, duration: total }));
  } catch (e) {
    res.writeHead(500).end(JSON.stringify({ error: String(e.message).slice(0, 200) }));
  } finally { if (dir) fs.rm(dir, { recursive: true, force: true }); }
}).listen(process.env.PORT || 8080);
