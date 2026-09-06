// VYBZ decode worker — a small Node HTTP service that turns any audio or video
// container into 32-bit float WAV using ffmpeg. The API gateway calls it for
// formats the edge runtime cannot decode in-process (AAC/M4A, ALAC, MP4, MOV,
// WebM, WMA). Run it anywhere with Node 20+ and ffmpeg on the path.
//
// Env:
//   PORT            (default 8788)
//   WORKER_TOKEN    shared bearer token the gateway presents
//   MAX_BYTES       request cap (default 200 MiB)
//   FFMPEG_BIN      path to ffmpeg (default: ffmpeg)
//
// POST /decode
//   headers: Authorization: Bearer <WORKER_TOKEN>
//            X-VYBZ-Max-Seconds: <cap on decoded duration, default 600>
//   body:    the file bytes
//   → 200 audio/wav (pcm_f32le), header X-VYBZ-Truncated: 0|1
import { createServer } from "node:http";
import { decodeWithFfmpeg } from "./ffmpeg.mjs";

const PORT = Number(process.env.PORT || 8788);
const TOKEN = process.env.WORKER_TOKEN || "";
const MAX_BYTES = Number(process.env.MAX_BYTES || 200 * 1024 * 1024);

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/healthz"))) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "vybz-decode", ok: true }));
    return;
  }
  if (req.method !== "POST" || !req.url?.startsWith("/decode")) {
    res.writeHead(404).end("not found");
    return;
  }
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BYTES) {
    res.writeHead(413).end("too large");
    return;
  }
  try {
    const maxSeconds = Math.min(3600, Math.max(1, Number(req.headers["x-vybz-max-seconds"] || 600)));
    const input = await readBody(req, MAX_BYTES);
    const { wav, truncated } = await decodeWithFfmpeg(input, maxSeconds);
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": String(wav.length), "X-VYBZ-Truncated": truncated ? "1" : "0" });
    res.end(wav);
  } catch (e) {
    const msg = e?.message ?? String(e);
    res.writeHead(msg === "too large" ? 413 : 422, { "Content-Type": "text/plain" }).end(`decode failed: ${msg}`);
  }
}).listen(PORT, () => console.log(`VYBZ decode worker on :${PORT}`));
