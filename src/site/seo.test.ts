import { describe, expect, it } from "vitest";
import { allRoutes, headHtml, indexableRoutes, normalizePath, seoFor } from "./seo";
import { DOCS, LEGAL, excerpt, lastUpdated } from "./docsIndex";

describe("seo table", () => {
  it("has a unique path per route", () => {
    const paths = allRoutes().map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it("keeps titles and descriptions within search-result limits", () => {
    for (const r of allRoutes()) {
      expect(r.title.length, r.path).toBeLessThanOrEqual(65);
      expect(r.title.length, r.path).toBeGreaterThan(8);
      expect(r.description.length, r.path).toBeLessThanOrEqual(160);
      expect(r.description.length, r.path).toBeGreaterThanOrEqual(50);
      expect(r.description, r.path).not.toMatch(/!/);
    }
  });
  it("covers every doc and legal page", () => {
    const paths = new Set(indexableRoutes().map((r) => r.path));
    for (const d of DOCS) expect(paths.has(d.slug === "overview" ? "/docs" : `/docs/${d.slug}`), d.slug).toBe(true);
    for (const d of LEGAL) expect(paths.has(`/legal/${d.slug}`), d.slug).toBe(true);
    for (const p of ["/", "/provenance", "/vault", "/agents", "/pricing"]) expect(paths.has(p), p).toBe(true);
  });
  it("never indexes the console or sign in", () => {
    expect(seoFor("/console").noindex).toBe(true);
    expect(seoFor("/console/keys").noindex).toBe(true);
    expect(seoFor("/signin").noindex).toBe(true);
    expect(seoFor("/nope").noindex).toBe(true);
  });
  it("normalizes trailing slashes and query strings", () => {
    expect(normalizePath("/provenance/")).toBe("/provenance");
    expect(normalizePath("/docs/api?x=1")).toBe("/docs/api");
    expect(normalizePath("")).toBe("/");
    expect(seoFor("/vault/").path).toBe("/vault");
    expect(seoFor("/legal").path).toBe("/legal/terms");
  });
  it("emits a canonical, robots, and structured data per route", () => {
    for (const r of indexableRoutes()) {
      const head = headHtml(r);
      expect(head).toContain(`<link rel="canonical" href="https://vybz.cloud${r.path === "/" ? "/" : r.path}" />`);
      expect(head).toContain('content="index, follow');
      const ld = head.match(/<script type="application\/ld\+json" id="vz-ld">([\s\S]*?)<\/script>/)?.[1];
      expect(ld, r.path).toBeTruthy();
      const parsed = JSON.parse(ld!);
      expect(parsed["@graph"].length).toBeGreaterThan(0);
    }
    expect(headHtml(seoFor("/signin"))).toContain("noindex");
  });
});

describe("docs index", () => {
  it("extracts a prose excerpt, not a heading or table", () => {
    const e = excerpt("# Title\n\n| a | b |\n|---|---|\n\nThe **first** paragraph with a [link](x).\nSecond line.\n\nNext para.");
    expect(e).toBe("The first paragraph with a link. Second line.");
  });
  it("cuts long excerpts at a sentence boundary", () => {
    const long = `${"Alpha beta gamma delta epsilon zeta eta theta. ".repeat(6)}Tail.`;
    const e = excerpt(long, 120);
    expect(e.length).toBeLessThanOrEqual(120);
    expect(e.endsWith(".")).toBe(true);
  });
  it("reads last-updated dates", () => {
    expect(lastUpdated("x\n\nLast updated: 2026-09-05\n")).toBe("2026-09-05");
    expect(lastUpdated("Effective 2026-09-05. Terms.")).toBe("2026-09-05");
    expect(lastUpdated("nothing")).toBeUndefined();
  });
});
