import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Sha256, sha256HexSync } from "./sha256.ts";

const ref = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("streaming sha256", () => {
  it("matches node crypto across block boundaries", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 1000, 65_537]) {
      const b = new Uint8Array(randomBytes(n));
      expect(sha256HexSync(b), `size ${n}`).toBe(ref(b));
    }
  });

  it("is split-invariant and survives export/import mid-stream", () => {
    const b = new Uint8Array(randomBytes(200_003));
    const expected = ref(b);
    for (const cut of [1, 7, 63, 64, 65, 6 * 1024, 100_000]) {
      let h = new Sha256();
      for (let i = 0; i < b.length; i += cut) {
        h.update(b.subarray(i, Math.min(i + cut, b.length)));
        h = Sha256.import(JSON.parse(JSON.stringify(h.export()))); // as the gateway does between parts
      }
      expect(h.digestHex(), `cut ${cut}`).toBe(expected);
    }
  });

  it("digest does not consume the hasher", () => {
    const h = new Sha256().update(new TextEncoder().encode("abc"));
    expect(h.digestHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(h.digestHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    h.update(new TextEncoder().encode("d"));
    expect(h.digestHex()).toBe(ref(new TextEncoder().encode("abcd")));
  });

  it("tolerates an empty or malformed imported state", () => {
    expect(Sha256.import(null).digestHex()).toBe(ref(new Uint8Array(0)));
    expect(Sha256.import({ h: [], buf: "", len: 0 }).digestHex()).toBe(ref(new Uint8Array(0)));
  });
});
