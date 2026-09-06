// Decode any container or codec ffmpeg understands to 32-bit float WAV.
//
// Input goes through a temp file, not a pipe: MP4/MOV keep their index at the
// end of the file, and ffmpeg needs to seek to it.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

/**
 * @param {Buffer} input  compressed bytes
 * @param {number} maxSeconds  cap on decoded duration
 * @returns {Promise<{ wav: Buffer, truncated: boolean }>}
 */
export async function decodeWithFfmpeg(input, maxSeconds = 600) {
  const dir = await mkdtemp(join(tmpdir(), "vybz-decode-"));
  const file = join(dir, "input");
  try {
    await writeFile(file, input);
    const wav = await run(file, maxSeconds);
    return { wav, truncated: durationOf(wav) >= maxSeconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(file, maxSeconds) {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-sn", "-dn", "-map", "0:a:0", "-t", String(maxSeconds), "-c:a", "pcm_f32le", "-f", "wav", "pipe:1"];
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => err.push(c));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().trim().slice(0, 400)}`));
      resolve(Buffer.concat(out));
    });
  });
}

/** Seconds of audio in a WAV buffer, from its fmt chunk and the bytes that follow `data`. */
function durationOf(wav) {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let off = 12, rate = 0, channels = 0, bytesPer = 0;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    let sz = dv.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = dv.getUint16(off + 10, true);
      rate = dv.getUint32(off + 12, true);
      bytesPer = dv.getUint16(off + 22, true) >> 3;
    }
    if (id === "data") {
      if (sz === 0xffffffff || sz === 0 || off + 8 + sz > wav.length) sz = wav.length - off - 8;
      return rate && channels && bytesPer ? sz / (bytesPer * channels) / rate : 0;
    }
    off += 8 + sz + (sz & 1);
  }
  return 0;
}
