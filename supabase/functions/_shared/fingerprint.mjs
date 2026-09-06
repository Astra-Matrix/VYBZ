// ---------------------------------------------------------------------------
// VYBZ perceptual audio fingerprint.
//
// Identifies which registered original a suspect file derives from, and where
// in it, without the caller knowing the asset id and regardless of codec,
// bitrate, gain, or trimming. Classic spectral-band-difference fingerprinting
// (Haitsma & Kalker): mono at 11025 Hz, 2048-sample frames every 512 samples,
// 33 log-spaced bands from 300 Hz to 2 kHz, one 32-bit sub-fingerprint per
// frame from the sign of the time-frequency energy differences.
//
// Matching has two stages. Exact sub-fingerprint hits vote for (asset, offset)
// in Postgres; the best few candidates are then confirmed by bit error rate
// over the aligned overlap. Robust re-encodings keep a BER well under 0.35.
// ---------------------------------------------------------------------------
import { fft } from "./watermark.mjs";
import { downmix, resample } from "./decode.mjs";

export const FP_RATE = 11025;
export const FP_WINDOW = 2048;
export const FP_HOP = 512;
export const FP_BANDS = 33;
export const FP_FPS = FP_RATE / FP_HOP; // ≈ 21.5 sub-fingerprints per second
export const FP_MATCH_BER = 0.35;
export const FP_MIN_OVERLAP_FRAMES = 43; // ≈ 2 s

const BAND_EDGES = (() => {
  const lo = 300, hi = 2000, edges = [];
  const binHz = FP_RATE / FP_WINDOW;
  for (let m = 0; m <= FP_BANDS; m++) edges.push(Math.round((lo * Math.pow(hi / lo, m / FP_BANDS)) / binHz));
  return edges;
})();

const HANN = (() => {
  const w = new Float64Array(FP_WINDOW);
  for (let i = 0; i < FP_WINDOW; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FP_WINDOW);
  return w;
})();

/** Sub-fingerprints for decoded audio. Returns a Uint32Array, one entry per frame. */
export function fingerprint(channels, sampleRate, { maxSeconds = 600 } = {}) {
  let mono = downmix(channels);
  if (sampleRate !== FP_RATE) mono = resample(mono, sampleRate, FP_RATE);
  const limit = Math.min(mono.length, Math.floor(maxSeconds * FP_RATE));
  const frames = Math.floor((limit - FP_WINDOW) / FP_HOP) + 1;
  if (frames < 2) return new Uint32Array(0);
  const re = new Float64Array(FP_WINDOW), im = new Float64Array(FP_WINDOW);
  let prev = null;
  const out = new Uint32Array(frames - 1);
  for (let f = 0; f < frames; f++) {
    const off = f * FP_HOP;
    for (let i = 0; i < FP_WINDOW; i++) { re[i] = mono[off + i] * HANN[i]; im[i] = 0; }
    fft(re, im);
    const e = new Float64Array(FP_BANDS + 1);
    for (let m = 0; m <= FP_BANDS; m++) {
      let s = 0;
      for (let k = BAND_EDGES[m]; k < BAND_EDGES[m + 1]; k++) s += re[k] * re[k] + im[k] * im[k];
      e[m] = s;
    }
    if (prev) {
      let h = 0;
      for (let m = 0; m < 32; m++) {
        const d = e[m] - e[m + 1] - (prev[m] - prev[m + 1]);
        if (d > 0) h |= 1 << m;
      }
      out[f - 1] = h >>> 0;
    }
    prev = e;
  }
  return out;
}

export function toBytes(fp) {
  const b = new Uint8Array(fp.length * 4);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < fp.length; i++) dv.setUint32(i * 4, fp[i], true);
  return b;
}

export function fromBytes(bytes) {
  const n = Math.floor(bytes.byteLength / 4);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 4);
  const fp = new Uint32Array(n);
  for (let i = 0; i < n; i++) fp[i] = dv.getUint32(i * 4, true);
  return fp;
}

/** Signed 32-bit view of a sub-fingerprint for a Postgres int4 column. */
export function toInt4(h) {
  return h | 0;
}

export function popcount(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Bit error rate between suspect `a` and reference `b` when a[i] aligns with
 * b[i + offset]. Returns { ber, overlap } with overlap in frames.
 */
export function compare(a, b, offset) {
  let bits = 0, overlap = 0;
  const start = Math.max(0, -offset), end = Math.min(a.length, b.length - offset);
  for (let i = start; i < end; i++) {
    bits += popcount(a[i] ^ b[i + offset]);
    overlap++;
  }
  return { ber: overlap ? bits / (overlap * 32) : 1, overlap };
}

/** Best alignment near a set of candidate offsets (±1 frame around each). */
export function bestAlignment(a, b, offsets) {
  let best = { ber: 1, overlap: 0, offset: 0 };
  const tried = new Set();
  for (const o of offsets) {
    for (let d = -1; d <= 1; d++) {
      const off = o + d;
      if (tried.has(off)) continue;
      tried.add(off);
      const r = compare(a, b, off);
      if (r.overlap >= FP_MIN_OVERLAP_FRAMES && r.ber < best.ber) best = { ...r, offset: off };
    }
  }
  return best;
}

/** Sub-fingerprints worth indexing: skip silence and saturation patterns. */
export function indexable(h) {
  return h !== 0 && h !== 0xffffffff;
}
