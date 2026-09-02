/**
 * Generate is a tool on +, not a kingdom. Bytes enter the existing upload
 * queue. The file is labeled. It is not placed on My VYBZ until Place.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY } from "@/product/invariants";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)(--|\/\/).*$/, ""))
    .join("\n");
}

describe("generate audio", () => {
  it("is a registered gate", () => {
    expect(GATE_REGISTRY).toContain("generateAudio");
  });

  it("is not a permanent navigation destination", () => {
    expect(code("src/app/routeTruth.ts")).not.toMatch(/generate/i);
    expect(code("src/shell/suiteApps.ts")).not.toMatch(/generate/i);
  });

  it("enters the existing upload queue and does not place", () => {
    const sheet = code("src/features/generate/GenerateSheet.tsx");
    expect(sheet).toContain("enqueueUploads");
    expect(sheet).not.toMatch(/placeOnVybz/);
    expect(sheet).toContain("Powered by Stability AI");
    expect(sheet).toContain("generationDisclosure");
    expect(sheet).toContain("available !== true");
  });

  it("keeps + as Add, with Generate as a menu action", () => {
    const chrome = read("src/components/shell/DrawerChrome.tsx");
    expect(chrome).toContain('aria-label="Add"');
    expect(chrome).toContain("onGenerate");
    expect(chrome).toContain("add-generate");
    expect(read("src/shell/commands.ts")).toContain("create:generate");
  });

  it("does not vendor the model into the SPA", () => {
    expect(existsSync(path.join(ROOT, "scripts/stable-audio-worker.mjs"))).toBe(true);
    expect(read("package.json")).toContain("generate:worker");
    expect(read("package.json")).not.toMatch(/torch|stable-audio-3/);
    expect(read("src/platform/bridge/web.ts")).toContain("requestLocalGenerate");
    expect(read("src/platform/bridge/android.ts")).toContain('unsupported("generateAudio")');
    expect(read("src/platform/bridge/ios.ts")).toContain('unsupported("generateAudio")');
  });
});
