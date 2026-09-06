import { describe, expect, it } from "vitest";
import { isSitePath } from "./SiteApp";

describe("isSitePath", () => {
  it("owns the root and platform prefixes", () => {
    for (const p of ["/", "", "/provenance", "/vault", "/agents", "/pricing", "/docs", "/docs/api", "/legal/terms", "/signin", "/console", "/console/keys", "/console/join"]) {
      expect(isSitePath(p)).toBe(true);
    }
  });
  it("does not claim unrelated paths", () => {
    for (const p of ["/v1", "/api/mcp", "/consolex", "/docsy", "/library"]) {
      expect(isSitePath(p)).toBe(false);
    }
  });
});
