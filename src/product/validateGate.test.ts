import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY } from "@/product/invariants";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("validation pipeline (Vercel merge gate)", () => {
  it("is a registered gate", () => {
    expect(GATE_REGISTRY).toContain("validatePipeline");
  });

  it("defines one validate command: lint → typecheck → test → build", () => {
    const pkg = read("package.json");
    expect(pkg).toMatch(/"validate"\s*:\s*"npm run lint && npm run typecheck && npm run test && npm run build"/);
    expect(pkg).toMatch(/"lint"\s*:\s*"tsc --noEmit"/);
    expect(pkg).toMatch(/"typecheck"\s*:\s*"tsc --noEmit"/);
    expect(pkg).toMatch(/"test"\s*:\s*"vitest run"/);
    expect(pkg).toMatch(/"build"\s*:\s*"tsc --noEmit && vite build"/);
  });

  it("runs validate on every Vercel Preview and Production build", () => {
    const vercel = JSON.parse(read("vercel.json")) as { buildCommand?: string };
    expect(vercel.buildCommand).toBe("npm run validate");
  });
});
