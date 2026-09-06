// Shared audio modules, exercised in Node against real encoder output.
// Fixtures were produced with ffmpeg from tone.wav (6 s, stereo, 44.1 kHz):
// tone.{mp3,flac,ogg,opus,aiff,m4a}, tone48.mp3 (48 kHz), and marked.* which
// carry a watermark keyed by deriveKey("fixture-secret", "fixture|asset|alice|wm1").
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { decodeAudio, downmix, parseAiff, pcmHash, resample, sniff } from "./decode.mjs";
import { Folder, deriveKey, detectChannel, detectFolded, foldChannel, parseWav } from "./watermark.mjs";
import { bestAlignment, compare, fingerprint, fromBytes, toBytes } from "./fingerprint.mjs";

const dir = join(__dirname, "fixtures");
const load = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const REF = parseWav(load("tone.wav"))!;

/** Peak normalized cross-correlation of two mono signals over lags in [0, maxLag]. */
function xcorrPeak(a: Float32Array, b: Float32Array, maxLag = 4096, len = 44100): { corr: number; lag: number } {
  let best = 0, bestLag = 0;
  const n = Math.min(len, a.length - maxLag, b.length - maxLag);
  let ea = 0;
  for (let i = 0; i < n; i++) ea += a[i] * a[i];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let s = 0, eb = 0;
    const off = maxLag;
    for (let i = 0; i < n; i++) {
      const bv = b[i + off + lag];
      s += a[i + off] * bv;
      eb += bv * bv;
    }
    const c = s / (Math.sqrt(ea) * Math.sqrt(eb) || 1);
    if (c > best) { best = c; bestLag = lag; }
  }
  return { corr: best, lag: bestLag };
}

describe("sniff", () => {
  it("identifies every fixture by bytes", () => {
    const cases: Array<[string, string, string]> = [
      ["tone.wav", "wav", "native"], ["tone.aiff", "aiff", "native"], ["tone.flac", "flac", "native"], ["tone.mp3", "mp3", "native"],
      ["tone.ogg", "ogg", "native"], ["tone.opus", "opus", "native"], ["tone.m4a", "m4a", "worker"],
    ];
    for (const [f, format, decodable] of cases) {
      const s = sniff(load(f));
      expect(s.format, f).toBe(format);
      expect(s.decodable, f).toBe(decodable);
    }
    expect(sniff(new TextEncoder().encode("hello world, this is not audio at all")).decodable).toBe("none");
  });
});

describe("decodeAudio", () => {
  for (const f of ["tone.aiff", "tone.flac", "tone.mp3", "tone.ogg", "tone.opus", "tone48.mp3"]) {
    it(`decodes ${f} to audio that correlates with the original`, async () => {
      const d = await decodeAudio(load(f));
      expect(d.channels.length).toBe(2);
      expect(d.durationSec).toBeGreaterThan(5.9);
      expect(d.durationSec).toBeLessThan(6.2);
      let mono = downmix(d.channels);
      if (d.sampleRate !== REF.sampleRate) mono = resample(mono, d.sampleRate, REF.sampleRate);
      const { corr } = xcorrPeak(downmix(REF.channels), mono);
      expect(corr, f).toBeGreaterThan(0.9);
    });
  }
  it("parses AIFF sample-exactly", () => {
    const a = parseAiff(load("tone.aiff"))!;
    expect(a.sampleRate).toBe(44100);
    expect(a.frames).toBe(REF.frames);
    let maxDiff = 0;
    for (let i = 0; i < 20000; i++) maxDiff = Math.max(maxDiff, Math.abs(a.channels[0][i] - REF.channels[0][i]));
    expect(maxDiff).toBe(0);
  });
  it("honours the frame cap and reports truncation", async () => {
    const d = await decodeAudio(load("tone.mp3"), { maxFrames: 50_000 });
    expect(d.frames).toBe(50_000);
    expect(d.truncated).toBe(true);
    const w = parseWav(load("tone.wav"), { maxFrames: 1000 })!;
    expect(w.frames).toBe(1000);
    expect(w.truncated).toBe(true);
  });
  it("refuses lossy input for registration and unknown bytes anywhere", async () => {
    await expect(decodeAudio(load("tone.mp3"), { lossless: true })).rejects.toMatchObject({ code: "lossless_required" });
    await expect(decodeAudio(new Uint8Array(64))).rejects.toMatchObject({ code: "unsupported_audio" });
    await expect(decodeAudio(load("tone.m4a"))).rejects.toMatchObject({ code: "unsupported_audio" });
  });
});

describe("pcmHash", () => {
  it("is identical across lossless containers and differs for lossy", async () => {
    const wav = await pcmHash(REF.channels, REF.sampleRate);
    const flac = await decodeAudio(load("tone.flac"));
    const aiff = await decodeAudio(load("tone.aiff"));
    const mp3 = await decodeAudio(load("tone.mp3"));
    expect(await pcmHash(flac.channels, flac.sampleRate)).toBe(wav);
    expect(await pcmHash(aiff.channels, aiff.sampleRate)).toBe(wav);
    expect(await pcmHash(mp3.channels, mp3.sampleRate)).not.toBe(wav);
  });
});

describe("watermark fold", () => {
  it("gives the same statistic folded once or per candidate, in any chunking", async () => {
    const key = await deriveKey("fixture-secret", "fixture|asset|alice|wm1");
    const x = parseWav(load("marked.wav"))!.channels[0];
    const whole = detectChannel(x, key);
    const f = new Folder();
    for (let i = 0; i < x.length; i += 7777) f.add(x.subarray(i, Math.min(i + 7777, x.length)));
    expect(detectFolded(f.acc, key)).toBeCloseTo(whole, 9);
    expect(detectFolded(foldChannel(x), key)).toBeCloseTo(whole, 9);
  });

  async function scoreFile(name: string, targetRate: number) {
    const d = await decodeAudio(load(name));
    const key = await deriveKey("fixture-secret", "fixture|asset|alice|wm1");
    let total = 0;
    const decoys: number[] = Array(12).fill(0);
    for (const chRaw of d.channels) {
      const ch = d.sampleRate === targetRate ? chRaw : resample(chRaw, d.sampleRate, targetRate);
      const acc = foldChannel(ch);
      total += detectFolded(acc, key);
      for (let i = 0; i < 12; i++) decoys[i] += detectFolded(acc, await deriveKey("fixture-secret", `decoy|${i}`));
    }
    const score = total / d.channels.length;
    const ds = decoys.map((v) => v / d.channels.length);
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length) || 1e-9;
    return { score, maxDecoy: Math.max(...ds), z: (score - mean) / sd };
  }

  for (const f of ["marked.mp3", "marked.opus", "marked_trim48.mp3"]) {
    it(`survives ${f}`, async () => {
      const r = await scoreFile(f, 44100);
      expect(r.score, `score ${r.score} decoy ${r.maxDecoy}`).toBeGreaterThan(r.maxDecoy * 2.5);
      expect(r.z).toBeGreaterThan(8);
    });
  }
  it("does not fire on unmarked audio", async () => {
    const r = await scoreFile("tone.mp3", 44100);
    expect(r.score).toBeLessThan(r.maxDecoy * 2.5);
  });
});

describe("fingerprint", () => {
  const ref = fingerprint(REF.channels, REF.sampleRate);
  it("survives lossy re-encoding, resampling, and trimming", async () => {
    for (const f of ["tone.mp3", "tone.opus", "tone48.mp3"]) {
      const d = await decodeAudio(load(f));
      const fp = fingerprint(d.channels, d.sampleRate);
      const best = bestAlignment(fp, ref, [-2, -1, 0, 1, 2]);
      expect(best.ber, f).toBeLessThan(0.35);
    }
    const trimmed = fingerprint(REF.channels.map((c) => c.subarray(44100 * 2)), REF.sampleRate);
    const aligned = bestAlignment(trimmed, ref, [Math.round((2 * 11025) / 512)]);
    expect(aligned.ber).toBeLessThan(0.2);
  });
  it("does not match unrelated audio", () => {
    const n = 44100 * 6;
    const other = new Float32Array(n);
    let seed = 7;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      other[i] = 0.3 * Math.sin((2 * Math.PI * (200 + i / 900) * i) / 44100) + (seed / 0x7fffffff - 0.5) * 0.2;
    }
    const fp = fingerprint([other], 44100);
    expect(compare(fp, ref, 0).ber).toBeGreaterThan(0.4);
  });
  it("round-trips through bytes", () => {
    expect(Array.from(fromBytes(toBytes(ref)))).toEqual(Array.from(ref));
  });
});

describe("decode worker", () => {
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  it.skipIf(!hasFfmpeg)("decodes AAC through ffmpeg exactly as the worker does", async () => {
    const { decodeWithFfmpeg } = await import("../../../worker/decode/ffmpeg.mjs");
    const { wav, truncated } = await decodeWithFfmpeg(Buffer.from(load("tone.m4a")), 600);
    expect(truncated).toBe(false);
    const parsed = parseWav(new Uint8Array(wav))!;
    expect(parsed.sampleRate).toBe(44100);
    const { corr } = xcorrPeak(downmix(REF.channels), downmix(parsed.channels));
    expect(corr).toBeGreaterThan(0.9);
    const cut = await decodeWithFfmpeg(Buffer.from(load("tone.m4a")), 2);
    expect(cut.truncated).toBe(true);
    expect(parseWav(new Uint8Array(cut.wav))!.frames).toBeLessThanOrEqual(44100 * 2 + 2048);
  });
});
