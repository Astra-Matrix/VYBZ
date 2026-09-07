// Streaming SHA-256 with exportable state. Environment-neutral: Deno, Node,
// and browsers. Used where WebCrypto's one-shot digest does not fit: the
// gateway hashes chunked uploads part by part and stores the running state
// between requests; the console hashes large files without holding them in
// memory.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** Serializable mid-stream state. `buf` is the unprocessed tail in hex; `len` is total bytes seen. */
export type Sha256State = { h: number[]; buf: string; len: number };

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");

export class Sha256 {
  private h = new Uint32Array(INIT);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private len = 0;
  private readonly w = new Uint32Array(64);

  update(data: Uint8Array): this {
    let i = 0;
    this.len += data.length;
    if (this.bufLen) {
      const n = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, n), this.bufLen);
      this.bufLen += n;
      i = n;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = data.length - i;
    }
    return this;
  }

  /** Hex digest of everything seen so far. Does not consume the hasher. */
  digestHex(): string {
    const c = this.clone();
    const len = c.len;
    const padLen = (c.bufLen < 56 ? 56 - c.bufLen : 120 - c.bufLen) + 8;
    const pad = new Uint8Array(padLen);
    pad[0] = 0x80;
    const hi = Math.floor(len / 0x20000000); // len * 8 / 2^32
    const lo = (len % 0x20000000) * 8;
    const v = new DataView(pad.buffer);
    v.setUint32(padLen - 8, hi, false);
    v.setUint32(padLen - 4, lo >>> 0, false);
    c.update(pad);
    let out = "";
    for (let i = 0; i < 8; i++) out += hex(c.h[i]);
    return out;
  }

  export(): Sha256State {
    let buf = "";
    for (let i = 0; i < this.bufLen; i++) buf += this.buf[i].toString(16).padStart(2, "0");
    return { h: Array.from(this.h), buf, len: this.len };
  }

  static import(s: Sha256State | null | undefined): Sha256 {
    const c = new Sha256();
    if (!s || !Array.isArray(s.h) || s.h.length !== 8) return c;
    c.h = new Uint32Array(s.h.map((x) => x >>> 0));
    const buf = String(s.buf ?? "");
    c.bufLen = buf.length >> 1;
    for (let i = 0; i < c.bufLen; i++) c.buf[i] = parseInt(buf.substr(i * 2, 2), 16);
    c.len = Number(s.len) || 0;
    return c;
  }

  private clone(): Sha256 {
    const c = new Sha256();
    c.h = new Uint32Array(this.h);
    c.buf = new Uint8Array(this.buf);
    c.bufLen = this.bufLen;
    c.len = this.len;
    return c;
  }

  private block(p: Uint8Array, off: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
    this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0;
    this.h[7] = (this.h[7] + h) | 0;
  }
}

export function sha256HexSync(data: Uint8Array): string {
  return new Sha256().update(data).digestHex();
}
