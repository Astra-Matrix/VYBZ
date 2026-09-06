import { describe, expect, it } from "vitest";
import { SCOPES, fmtBytes, slugFromName } from "./consoleApi";

describe("consoleApi helpers", () => {
  it("slugifies organization names", () => {
    expect(slugFromName("Astra Matrix, Inc.")).toBe("astra-matrix-inc");
    expect(slugFromName("  Ünïcode Sound Library  ")).toBe("unicode-sound-library");
    expect(slugFromName("a".repeat(60)).length).toBe(40);
  });
  it("formats bytes", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.50 KB");
    expect(fmtBytes(1099511627776)).toBe("1.00 TB");
  });
  it("exposes the six API scopes", () => {
    expect(SCOPES.map((s) => s.id)).toEqual(["org:read", "provenance:read", "provenance:write", "provenance:detect", "vault:read", "vault:write", "webhooks:manage"]);
  });
});
