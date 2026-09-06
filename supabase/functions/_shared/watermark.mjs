// ---------------------------------------------------------------------------
// VYBZ forensic audio watermarking — direct-sequence spread spectrum (DSSS).
//
// Per-recipient, perceptually-masked, blind-detectable watermark for WAV/PCM.
// A pseudo-random ±1 chip sequence (PN), keyed by an HMAC of the server secret +
// recipient + asset + watermark id, is added at low amplitude scaled by a local
// energy envelope (so it hides under the signal). Detection is blind: correlate
// the suspect signal against each candidate recipient's PN — the true recipient
// yields a correlation far above the noise floor, attributing a leak.
//
// This is spread-spectrum watermarking per the current literature (DSSS, the
// "High robustness" option in oximedia-watermark / VoiceSign, 2026). It is
// PROVENANCE + ATTRIBUTION, not DRM: robust to mild processing (noise, gain,
// requantization, light filtering), but — like all watermarking — defeatable by
// a determined adversary. Pure, dependency-free; runs in both Deno and Node.
// ---------------------------------------------------------------------------

/** Derive a 32-byte key = HMAC-SHA256(secret, payload). WebCrypto (Deno + Node). */
export async function deriveKey(secret, payload) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(payload));
  return new Uint8Array(sig);
}

/** Watermark period (samples). The PN repeats every PERIOD, which makes the mark
 *  alignment-tolerant: trimming just shifts the fold offset, recovered by xcorr. */
export const PERIOD = 8192;

/** Seed a xorshift128+ PRNG from key bytes; yields ±1 chips deterministically. */
function pnGenerator(key) {
  let s0 = 0n, s1 = 0n;
  for (let i = 0; i < 8; i++) s0 = (s0 << 8n) | BigInt(key[i]);
  for (let i = 8; i < 16; i++) s1 = (s1 << 8n) | BigInt(key[i]);
  if (s0 === 0n && s1 === 0n) s0 = 0x9e3779b97f4a7c15n;
  const MASK = (1n << 64n) - 1n;
  return () => {
    let x = s0; const y = s1;
    s0 = y;
    x ^= (x << 23n) & MASK;
    x ^= x >> 17n;
    x ^= y ^ (y >> 26n);
    s1 = x & MASK;
    return ((s0 + s1) & MASK) & 1n ? 1 : -1; // low bit → ±1
  };
}

/** One period of the PN sequence (±1), as Float64Array of length PERIOD. */
function pnPeriod(key) {
  const g = pnGenerator(key);
  const p = new Float64Array(PERIOD);
  for (let i = 0; i < PERIOD; i++) p[i] = g();
  return p;
}

/** In-place iterative radix-2 FFT (complex). len must be a power of 2. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Local energy envelope (moving RMS) for perceptual masking. */
function envelope(x, win = 1024) {
  const n = x.length, env = new Float64Array(n);
  let acc = 0;
  const half = win >> 1;
  // Prime the window.
  for (let i = 0; i < Math.min(win, n); i++) acc += x[i] * x[i];
  for (let i = 0; i < n; i++) {
    const add = i + half < n ? x[i + half] * x[i + half] : 0;
    const sub = i - half - 1 >= 0 ? x[i - half - 1] * x[i - half - 1] : 0;
    acc += add - sub;
    env[i] = Math.sqrt(Math.max(0, acc) / win);
  }
  return env;
}

/**
 * Embed the watermark in-place into a channel (Float64 [-1,1]) as a PERIOD-length
 * PN repeated across the signal, at low amplitude scaled by a local energy
 * envelope. alpha ≈ 0.02 keeps it ~34–40 dB below the signal (inaudible).
 */
export function embedChannel(x, key, alpha = 0.02) {
  const p = pnPeriod(key);
  const env = envelope(x);
  const floor = 0.0015;
  for (let i = 0; i < x.length; i++) {
    const g = alpha * Math.max(env[i], floor);
    let v = x[i] + g * p[i % PERIOD];
    if (v > 1) v = 1; else if (v < -1) v = -1;
    x[i] = v;
  }
  return x;
}

/**
 * Fold accumulator. The detector's first step, summing the signal modulo PERIOD,
 * does not depend on the candidate key, so it is computed once per channel and
 * shared by every candidate. `add` accepts the signal in any chunking, which
 * lets a decoder stream audio through without holding it whole.
 */
export class Folder {
  constructor() {
    this.acc = new Float64Array(PERIOD);
    this.pos = 0;
    this.samples = 0;
  }
  add(x) {
    const acc = this.acc;
    let j = this.pos;
    for (let i = 0; i < x.length; i++) {
      acc[j] += x[i];
      if (++j === PERIOD) j = 0;
    }
    this.pos = j;
    this.samples += x.length;
    return this;
  }
}

/** Fold a whole channel into PERIOD bins. */
export function foldChannel(x) {
  return new Folder().add(x).acc;
}

/**
 * Blind, desync-tolerant detection on a folded channel. The fold makes the
 * repeated watermark add constructively while unrelated audio averages toward
 * zero; the fold is then circularly cross-correlated with the candidate PN via
 * FFT. The peak over all alignments is the statistic, so trimming and cropping
 * only move where the peak lands. ~0 for the wrong key. Scale-invariant (~0..1).
 */
export function detectFolded(acc, key) {
  const p = pnPeriod(key);
  const ar = Float64Array.from(acc), ai = new Float64Array(PERIOD);
  const pr = Float64Array.from(p), pi = new Float64Array(PERIOD);
  fft(ar, ai); fft(pr, pi);
  const cr = new Float64Array(PERIOD), ci = new Float64Array(PERIOD);
  for (let k = 0; k < PERIOD; k++) {
    cr[k] = ar[k] * pr[k] + ai[k] * pi[k];   // multiply by conjugate of P
    ci[k] = ai[k] * pr[k] - ar[k] * pi[k];
  }
  fft(cr, ci, true);
  let peak = 0;
  for (let k = 0; k < PERIOD; k++) if (Math.abs(cr[k]) > peak) peak = Math.abs(cr[k]);
  let accEnergy = 0;
  for (let k = 0; k < PERIOD; k++) accEnergy += acc[k] * acc[k];
  const norm = Math.sqrt(accEnergy) * Math.sqrt(PERIOD) || 1;
  return peak / norm;
}

/** Detection on an unfolded channel. Identical statistic to fold + detectFolded. */
export function detectChannel(x, key) {
  return detectFolded(foldChannel(x), key);
}

// ── Minimal WAV (PCM 8/16/24/32-bit int + 32/64-bit float, incl. WAVE_FORMAT_EXTENSIBLE) ──
/**
 * Parse a RIFF/WAVE file into Float32 channels in [-1, 1].
 * `maxFrames` caps how much audio is decoded; `truncated` reports when the cap hit.
 */
export function parseWav(bytes, { maxFrames = Infinity } = {}) {
  if (bytes.byteLength < 12) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== 0x52494646 /*RIFF*/ || dv.getUint32(8, false) !== 0x57415645 /*WAVE*/)
    return null;
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= dv.byteLength) {
    const id = dv.getUint32(off, false);
    let sz = dv.getUint32(off + 4, true);
    if (id === 0x666d7420 /*fmt */) {
      let audioFormat = dv.getUint16(off + 8, true);
      if (audioFormat === 0xfffe && sz >= 40) audioFormat = dv.getUint16(off + 8 + 24, true); // EXTENSIBLE: sub-format GUID
      fmt = {
        audioFormat,
        channels: dv.getUint16(off + 10, true),
        sampleRate: dv.getUint32(off + 12, true),
        bits: dv.getUint16(off + 22, true),
      };
    } else if (id === 0x64617461 /*data*/) {
      dataOff = off + 8;
      if (sz === 0xffffffff || sz === 0 || off + 8 + sz > dv.byteLength) sz = dv.byteLength - dataOff; // streamed/unfinished header
      dataLen = sz; break;
    }
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0 || !fmt.channels || !fmt.sampleRate) return null;
  const { channels, bits, audioFormat } = fmt;
  const bytesPer = bits >> 3;
  if (!bytesPer) return null;
  const total = Math.floor(dataLen / (bytesPer * channels));
  const frames = Math.min(total, maxFrames);
  const ch = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (f * channels + c) * bytesPer;
      let s;
      if (audioFormat === 3 && bits === 32) s = dv.getFloat32(p, true);
      else if (audioFormat === 3 && bits === 64) s = dv.getFloat64(p, true);
      else if (bits === 16) s = dv.getInt16(p, true) / 32768;
      else if (bits === 24) { const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getInt8(p + 2); s = ((b2 << 16) | (b1 << 8) | b0) / 8388608; }
      else if (bits === 32) s = dv.getInt32(p, true) / 2147483648;
      else if (bits === 8) s = (dv.getUint8(p) - 128) / 128;
      else s = 0;
      ch[c][f] = s;
    }
  }
  return { channels: ch, sampleRate: fmt.sampleRate, bits, audioFormat, frames, totalFrames: total, truncated: frames < total };
}

export function encodeWav({ channels, sampleRate }) {
  // Always write 16-bit PCM (universally compatible for the delivered copy).
  const nch = channels.length, frames = channels[0].length, bytesPer = 2;
  const dataLen = frames * nch * bytesPer;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false); dv.setUint32(4, 36 + dataLen, true); dv.setUint32(8, 0x57415645, false);
  dv.setUint32(12, 0x666d7420, false); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, nch, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nch * bytesPer, true); dv.setUint16(32, nch * bytesPer, true); dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false); dv.setUint32(40, dataLen, true);
  let p = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) {
      let v = channels[c][f]; if (v > 1) v = 1; else if (v < -1) v = -1;
      dv.setInt16(p, Math.round(v * 32767), true); p += 2;
    }
  }
  return new Uint8Array(buf);
}
