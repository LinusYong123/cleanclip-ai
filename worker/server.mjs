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
  if (u.pathname === "/health") return res.writeHead(200).end("ok");

  // Signed browser download (a link can't carry an Authorization header, so the app signs url+expiry with WORKER_SECRET)
  if (u.pathname === "/download") {
    const url = u.searchParams.get("url") || "", exp = +(u.searchParams.get("exp") || 0), sig = u.searchParams.get("sig") || "";
    const want = crypto.createHmac("sha256", process.env.WORKER_SECRET).update(`${url}|${exp}`).digest("hex");
    const ok = sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    if (!ok || Date.now() / 1000 > exp) return res.writeHead(403).end("Link expired or invalid.");
    const name = (u.searchParams.get("name") || "video").replace(/[^\w .-]/g, "").slice(0, 80) || "video";
    // One progressive file (no merging), capped in size. Headers are sent only once data starts flowing, so failures aren't saved as empty files.
    const p = spawn("yt-dlp", ["-f", "b[ext=mp4]/b", "--no-playlist", "--max-filesize", "300M", "-o", "-", url]);
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
  if (req.headers.authorization !== `Bearer ${process.env.WORKER_SECRET}`) return res.writeHead(401).end();
  const q = u.searchParams;
  if (u.pathname === "/captions") {
    const url = q.get("url") || "";
    let dir;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(host))
        return res.writeHead(400).end(JSON.stringify({ error: "Captions are only supported for YouTube links." }));
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "c-"));
      await run("yt-dlp", ["--skip-download", "--no-warnings", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en",
        "--sub-format", "vtt", "--output", path.join(dir, "caption.%(ext)s"), url], { timeout: 20000, maxBuffer: 1024 * 1024 });
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".vtt")).sort();
      const lines = new Set();
      let captionLength = 0;
      for (const file of files) {
        const content = await fs.readFile(path.join(dir, file), "utf8");
        for (const line of content.split(/\r?\n/)) {
          const text = line.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
          if (!text || /^WEBVTT|^(NOTE|STYLE|REGION)\b/.test(text) || /^\d+$/.test(text) ||
            /^\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->/.test(text)) continue;
          if (!lines.has(text)) { lines.add(text); captionLength += text.length + 1; }
          if (captionLength >= 12000) break;
        }
        if (captionLength >= 12000) break;
      }
      const captions = [...lines].join(" ").slice(0, 12000);
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ captions }));
    } catch (e) {
      return res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e.message).slice(0, 200) }));
    } finally { if (dir) await fs.rm(dir, { recursive: true, force: true }); }
  }
  const url = q.get("url"), start = +q.get("start") || 0, n = Math.min(+q.get("n") || 6, 40);
  let dir;
  try {
    const src = (await run("yt-dlp", ["-g", "-f", "best[height<=480]/best", url])).stdout.trim().split("\n")[0];
    const total = +(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src])).stdout || 30;
    const dur = +q.get("dur") || Math.max(1, total - start);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "f-"));
    // Long videos: decode keyframes only, which is much faster
    const fast = dur > 90 ? ["-skip_frame", "nokey"] : [];
    await run("ffmpeg", ["-ss", String(start), ...fast, "-i", src, "-t", String(dur), "-vf", `fps=${n}/${dur},scale=640:-2`,
      "-frames:v", String(n), path.join(dir, "f%02d.jpg")], { timeout: 50000 });
    const files = (await fs.readdir(dir)).sort();
    const frames = await Promise.all(files.map(async (f) => (await fs.readFile(path.join(dir, f))).toString("base64")));
    const times = files.map((_, i) => start + (dur / n) * (i + 0.5));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ frames, times, duration: start ? start + dur : dur }));
  } catch (e) {
    res.writeHead(500).end(JSON.stringify({ error: String(e.message).slice(0, 200) }));
  } finally { if (dir) fs.rm(dir, { recursive: true, force: true }); }
}).listen(process.env.PORT || 8080);
