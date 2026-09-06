// ---------------------------------------------------------------------------
// VYBZ audio input — one entry point for every format a customer might send.
//
// Decodes WAV, AIFF, FLAC, MP3, Ogg Vorbis, and Opus in-process (pure JS plus
// WASM decoders that run in both Deno and Node). Formats the edge cannot decode
// (AAC/M4A, ALAC, MP4/MOV/WebM containers, WMA) are forwarded to the optional
// decode worker (worker/decode, ffmpeg) when one is configured.
//
// Everything decodes to Float32 channels in [-1, 1] with a hard cap on decoded
// frames, so a large upload never expands into unbounded memory. Analysis that
// needs the whole signal (the PCM hash) reports when the cap truncated input.
// ---------------------------------------------------------------------------
import { MPEGDecoder } from "mpg123-decoder";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { OggOpusDecoder } from "ogg-opus-decoder";
import { parseWav } from "./watermark.mjs";

/** Formats decoded in-process, and formats that need the decode worker. */
export const NATIVE_FORMATS = ["wav", "aiff", "flac", "mp3", "ogg", "opus"];
export const WORKER_FORMATS = ["aac", "m4a", "mp4", "mov", "alac", "webm", "mkv", "wma", "ac3", "amr"];
export const LOSSLESS_FORMATS = ["wav", "aiff", "flac", "alac"];

const MIMES = {
  wav: "audio/wav", aiff: "audio/aiff", flac: "audio/flac", mp3: "audio/mpeg", ogg: "audio/ogg", opus: "audio/opus",
  aac: "audio/aac", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime", alac: "audio/mp4", webm: "video/webm",
  mkv: "video/x-matroska", wma: "audio/x-ms-wma", ac3: "audio/ac3", amr: "audio/amr",
};

function ascii(bytes, off, len) {
  let s = "";
  for (let i = off; i < Math.min(off + len, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function mp3FrameAt(bytes, i) {
  if (i + 4 > bytes.length) return false;
  if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[i + 1] >> 3) & 3; // 1 is reserved
  const layer = (bytes[i + 1] >> 1) & 3; // 0 is reserved
  const bitrate = bytes[i + 2] >> 4; // 15 is invalid
  const rate = (bytes[i + 2] >> 2) & 3; // 3 is reserved
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && rate !== 3;
}

/**
 * Identify a file by its bytes, never by its name.
 * Returns { format, codec, container, mime, decodable: "native" | "worker" | "none" }.
 */
export function sniff(bytes) {
  const b = bytes;
  const head4 = ascii(b, 0, 4);
  const at8 = ascii(b, 8, 4);
  const at4 = ascii(b, 4, 4);
  const done = (format, codec, container, decodable) => ({ format, codec, container, mime: MIMES[format] ?? "application/octet-stream", decodable });
  if (head4 === "RIFF" && at8 === "WAVE") return done("wav", "pcm", "riff", "native");
  if (head4 === "FORM" && (at8 === "AIFF" || at8 === "AIFC")) return done("aiff", "pcm", "aiff", "native");
  if (head4 === "fLaC") return done("flac", "flac", "flac", "native");
  if (head4 === "OggS") {
    const page = ascii(b, 28, 8);
    if (page.startsWith("OpusHead")) return done("opus", "opus", "ogg", "native");
    if (page.startsWith("vorbis")) return done("ogg", "vorbis", "ogg", "native");
    if (page.includes("FLAC")) return done("flac", "flac", "ogg", "worker");
    return done("ogg", "unknown", "ogg", "worker");
  }
  if (at4 === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand.startsWith("qt")) return done("mov", "unknown", "mov", "worker");
    if (brand === "M4A " || brand === "M4B ") return done("m4a", "aac", "mp4", "worker");
    return done("mp4", "unknown", "mp4", "worker");
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return done("webm", "unknown", "matroska", "worker");
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return done("wma", "wma", "asf", "worker");
  if (head4.startsWith("#!AMR")) return done("amr", "amr", "amr", "worker");
  if (b[0] === 0x0b && b[1] === 0x77) return done("ac3", "ac3", "ac3", "worker");
  if (head4.startsWith("ID3")) return done("mp3", "mp3", "mpeg", "native");
  if (b.length > 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return done("aac", "aac", "adts", "worker");
  // Raw MPEG audio: two consecutive valid frame headers in the first 8 KB.
  for (let i = 0; i < Math.min(b.length - 4, 8192); i++) {
    if (mp3FrameAt(b, i)) {
      const len = mp3FrameLength(b, i);
      if (len > 0 && mp3FrameAt(b, i + len)) return done("mp3", "mp3", "mpeg", "native");
    }
  }
  return done("unknown", "unknown", "unknown", "none");
}

const MP3_BITRATES = {
  // [version index][layer index] → table (kbps), index by bitrate bits 1..14
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3FrameLength(b, i) {
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3; // 3 = layer I, 2 = II, 1 = III
  const br = b[i + 2] >> 4;
  const sr = (b[i + 2] >> 2) & 3;
  const pad = (b[i + 2] >> 1) & 1;
  const rate = MP3_RATES[version]?.[sr];
  if (!rate) return 0;
  const v1 = version === 3;
  const table = layer === 3 ? (v1 ? MP3_BITRATES.v1l1 : MP3_BITRATES.v2l1) : layer === 2 ? (v1 ? MP3_BITRATES.v1l2 : MP3_BITRATES.v2l23) : v1 ? MP3_BITRATES.v1l3 : MP3_BITRATES.v2l23;
  const kbps = table[br];
  if (!kbps) return 0;
  if (layer === 3) return Math.floor((12 * kbps * 1000) / rate + pad) * 4;
  const samples = layer === 2 ? 1152 : v1 ? 1152 : 576;
  return Math.floor((samples / 8) * ((kbps * 1000) / rate) + pad);
}

// ── AIFF ────────────────────────────────────────────────────────────────────
function readExtended(dv, off) {
  // 80-bit IEEE 754 extended → number (sample rates are small positive values).
  const exp = dv.getUint16(off, false) & 0x7fff;
  const hi = dv.getUint32(off + 2, false);
  const lo = dv.getUint32(off + 6, false);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}

export function parseAiff(bytes, { maxFrames = Infinity } = {}) {
  if (bytes.byteLength < 12) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "FORM") return null;
  const kind = ascii(bytes, 8, 4);
  if (kind !== "AIFF" && kind !== "AIFC") return null;
  let off = 12, comm = null, ssnd = null;
  while (off + 8 <= dv.byteLength) {
    const id = ascii(bytes, off, 4);
    const sz = dv.getUint32(off + 4, false);
    if (id === "COMM") {
      comm = {
        channels: dv.getInt16(off + 8, false),
        frames: dv.getUint32(off + 10, false),
        bits: dv.getInt16(off + 14, false),
        sampleRate: Math.round(readExtended(dv, off + 16)),
        compression: kind === "AIFC" && sz >= 22 ? ascii(bytes, off + 26, 4) : "NONE",
      };
    } else if (id === "SSND") {
      const dataOffset = dv.getUint32(off + 8, false);
      ssnd = { start: off + 16 + dataOffset, length: Math.min(sz - 8 - dataOffset, dv.byteLength - (off + 16 + dataOffset)) };
    }
    off += 8 + sz + (sz & 1);
  }
  if (!comm || !ssnd || !comm.channels || !comm.sampleRate) return null;
  const little = comm.compression === "sowt";
  const float = comm.compression === "fl32" || comm.compression === "FL32" || comm.compression === "fl64";
  if (!["NONE", "sowt", "fl32", "FL32", "fl64", "twos"].includes(comm.compression)) return null;
  const bytesPer = comm.bits >> 3;
  if (!bytesPer) return null;
  const total = Math.min(comm.frames, Math.floor(ssnd.length / (bytesPer * comm.channels)));
  const frames = Math.min(total, maxFrames);
  const ch = Array.from({ length: comm.channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < comm.channels; c++) {
      const p = ssnd.start + (f * comm.channels + c) * bytesPer;
      let s;
      if (float && comm.bits === 32) s = dv.getFloat32(p, little);
      else if (float && comm.bits === 64) s = dv.getFloat64(p, little);
      else if (comm.bits === 16) s = dv.getInt16(p, little) / 32768;
      else if (comm.bits === 24) {
        const b0 = bytes[p], b1 = bytes[p + 1], b2 = bytes[p + 2];
        s = (little ? ((b2 << 24) | (b1 << 16) | (b0 << 8)) >> 8 : ((b0 << 24) | (b1 << 16) | (b2 << 8)) >> 8) / 8388608;
      } else if (comm.bits === 32) s = dv.getInt32(p, little) / 2147483648;
      else if (comm.bits === 8) s = dv.getInt8(p) / 128;
      else s = 0;
      ch[c][f] = s;
    }
  }
  return { channels: ch, sampleRate: comm.sampleRate, bits: comm.bits, frames, totalFrames: total, truncated: frames < total };
}

// ── WASM decoders (chunked so a cap stops decoding early) ──────────────────
const CHUNK = 1 << 18;

async function wasmDecode(Decoder, bytes, maxFrames) {
  const d = new Decoder();
  await d.ready;
  const parts = [];
  let frames = 0, sampleRate = 0, nch = 0, truncated = false, errors = 0;
  const push = (r) => {
    if (!r || !r.samplesDecoded) return;
    sampleRate = r.sampleRate || sampleRate;
    nch = r.channelData.length || nch;
    parts.push(r.channelData);
    frames += r.samplesDecoded;
    if (r.errors?.length) errors += r.errors.length;
  };
  try {
    for (let off = 0; off < bytes.length; off += CHUNK) {
      push(await d.decode(bytes.subarray(off, Math.min(off + CHUNK, bytes.length))));
      if (frames >= maxFrames) {
        truncated = frames > maxFrames || off + CHUNK < bytes.length;
        break;
      }
    }
    if (!truncated && typeof d.flush === "function") push(await d.flush());
  } finally {
    d.free?.();
  }
  if (!frames || !sampleRate) return null;
  const n = Math.min(frames, maxFrames);
  const channels = Array.from({ length: nch }, () => new Float32Array(n));
  let w = 0;
  for (const part of parts) {
    const len = Math.min(part[0].length, n - w);
    if (len <= 0) break;
    for (let c = 0; c < nch; c++) channels[c].set(len === part[c].length ? part[c] : part[c].subarray(0, len), w);
    w += len;
  }
  return { channels, sampleRate, frames: n, truncated: truncated || frames > n, errors };
}

// ── Resampling (windowed sinc, Lanczos a=8; low-passed when decimating) ────
function lanczos(t, a) {
  if (t === 0) return 1;
  if (t <= -a || t >= a) return 0;
  const pt = Math.PI * t;
  return (a * Math.sin(pt) * Math.sin(pt / a)) / (pt * pt);
}

export function resample(x, from, to) {
  if (from === to) return x;
  const ratio = from / to;
  const scale = ratio > 1 ? ratio : 1; // widen the kernel when decimating
  const A = 8;
  const reach = Math.ceil(A * scale);
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    const c0 = Math.floor(c);
    let s = 0, w = 0;
    const k0 = Math.max(0, c0 - reach + 1), k1 = Math.min(x.length - 1, c0 + reach);
    for (let k = k0; k <= k1; k++) {
      const wk = lanczos((c - k) / scale, A);
      s += x[k] * wk;
      w += wk;
    }
    out[i] = w ? s / w : 0;
  }
  return out;
}

export function downmix(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length, out = new Float32Array(n), g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  return out;
}

// ── Canonical PCM hash ─────────────────────────────────────────────────────
/**
 * SHA-256 over the decoded audio as 16-bit interleaved PCM, prefixed with the
 * sample rate and channel count. Two files that carry the same audio in
 * different lossless containers (WAV/AIFF/FLAC, extra metadata chunks) hash
 * identically. Rounding is `round(v * 32768)` so 16-bit sources round-trip.
 */
export async function pcmHash(channels, sampleRate) {
  const nch = channels.length, frames = channels[0]?.length ?? 0;
  const header = new TextEncoder().encode(`vybz-pcm-v1|${sampleRate}|${nch}|${frames}\n`);
  const buf = new Uint8Array(header.length + frames * nch * 2);
  buf.set(header, 0);
  const dv = new DataView(buf.buffer, header.length);
  let p = 0;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) {
      let v = Math.round(channels[c][f] * 32768);
      if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
      dv.setInt16(p, v, true);
      p += 2;
    }
  }
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Decode worker (ffmpeg) ─────────────────────────────────────────────────
async function workerDecode(bytes, worker, maxSeconds) {
  const res = await fetch(`${worker.url.replace(/\/+$/, "")}/decode`, {
    method: "POST",
    headers: { Authorization: `Bearer ${worker.token}`, "Content-Type": "application/octet-stream", "X-VYBZ-Max-Seconds": String(maxSeconds) },
    body: bytes,
    signal: AbortSignal.timeout(worker.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw new DecodeError("worker_failed", `The decode worker answered ${res.status}.`);
  const wav = parseWav(new Uint8Array(await res.arrayBuffer()));
  if (!wav) throw new DecodeError("worker_failed", "The decode worker returned unreadable audio.");
  return { channels: wav.channels, sampleRate: wav.sampleRate, frames: wav.frames, truncated: res.headers.get("x-vybz-truncated") === "1" || wav.truncated, errors: 0 };
}

export class DecodeError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Decode any supported file.
 *   opts.maxFrames   cap on decoded frames per channel (default 12M ≈ 4.5 min at 44.1 kHz)
 *   opts.worker      { url, token } for formats the edge cannot decode
 *   opts.lossless    only accept lossless formats (registration)
 * Returns { channels, sampleRate, frames, durationSec, truncated, format, codec, container, mime, source }.
 */
export async function decodeAudio(bytes, opts = {}) {
  const maxFrames = opts.maxFrames ?? 12_000_000;
  const info = sniff(bytes);
  if (info.decodable === "none") {
    throw new DecodeError("unsupported_audio", "This file is not a recognized audio format.", { supported: supportedFormats(Boolean(opts.worker)) });
  }
  if (opts.lossless && !LOSSLESS_FORMATS.includes(info.format)) {
    throw new DecodeError("lossless_required", `Originals must be lossless (WAV, AIFF, FLAC); received ${info.format}.`, { supported: ["wav", "aiff", "flac"] });
  }
  let out = null, source = "native";
  if (info.decodable === "native") {
    switch (info.format) {
      case "wav": out = parseWav(bytes, { maxFrames }); break;
      case "aiff": out = parseAiff(bytes, { maxFrames }); break;
      case "flac": out = await wasmDecode(FLACDecoder, bytes, maxFrames); break;
      case "mp3": out = await wasmDecode(MPEGDecoder, bytes, maxFrames); break;
      case "ogg": out = await wasmDecode(OggVorbisDecoder, bytes, maxFrames); break;
      case "opus": out = await wasmDecode(OggOpusDecoder, bytes, maxFrames); break;
    }
  } else if (opts.worker?.url && opts.worker?.token) {
    source = "worker";
    out = await workerDecode(bytes, opts.worker, Math.ceil(maxFrames / 48000));
  } else {
    throw new DecodeError("unsupported_audio", `${info.format.toUpperCase()} needs the decode worker, which is not configured on this deployment. Send WAV, AIFF, FLAC, MP3, Ogg Vorbis, or Opus.`, { format: info.format, supported: supportedFormats(false) });
  }
  if (!out || !out.frames || !out.channels?.length) {
    throw new DecodeError("undecodable_audio", `The ${info.format.toUpperCase()} stream could not be decoded.`, { format: info.format });
  }
  return {
    channels: out.channels,
    sampleRate: out.sampleRate,
    frames: out.frames,
    totalFrames: out.totalFrames ?? (out.truncated ? null : out.frames),
    durationSec: out.frames / out.sampleRate,
    truncated: Boolean(out.truncated),
    format: info.format,
    codec: info.codec,
    container: info.container,
    mime: info.mime,
    source,
    decodeErrors: out.errors ?? 0,
  };
}

export function supportedFormats(workerConfigured) {
  return workerConfigured ? [...NATIVE_FORMATS, ...WORKER_FORMATS] : [...NATIVE_FORMATS];
}
