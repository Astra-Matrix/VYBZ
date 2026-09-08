import { describe, expect, it } from "vitest";
import { PdfDocument, wrap, textWidth } from "./pdf.ts";
import { renderLeakReport, type ReportRecord } from "./leakReport.ts";

const record: ReportRecord = {
  id: "0b6c4e6e-1c2d-4c2b-9a1f-6f0e4c6d7a11",
  created_at: "2026-09-08T10:15:00.000Z",
  name: "leaked-from-youtube.m4a",
  sha256: "a".repeat(64),
  verdict: "derived_copy",
  confidence: "high",
  input: { format: "m4a", codec: "aac", sample_rate: 44100, channels: 2, duration_sec: 41.8, bytes: 693_120, truncated: false },
  evidence: [
    { method: "exact_hash", result: "no_match" },
    { method: "pcm_hash", result: "no_match" },
    { method: "fingerprint", result: "match", similarity: 0.91, offset_sec: 41.2, overlap_sec: 42 },
    { method: "content_credentials", result: "absent" },
    { method: "watermark", result: "attributed", confidence: "high", attributed: { recipient: "sync-house@partner.com" }, statistics: { z: 37.1, ratio: 6.2 } },
  ],
  note: "Found on a public upload 2026-09-07. Takedown filed.",
  report_hash: "b".repeat(64),
  org: { name: "Astra Matrix", slug: "astra-matrix" },
  asset: { id: "2f1a0c7e-3b3e-4a12-8b7a-0d1a9e8c5b21", title: "Midnight (final master)", external_ref: "ISRC US-XYZ-26-00001", sha256: "c".repeat(64), created_at: "2026-09-01T09:00:00.000Z", duration_sec: 214 },
  issuance: { id: "7c9d2b1a-5e6f-4a7b-8c9d-0e1f2a3b4c5d", recipient: "sync-house@partner.com", license: "preview", watermark_id: "9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b", created_at: "2026-09-03T14:00:00.000Z", c2pa_signed: true },
};

describe("pdf writer", () => {
  it("produces a well-formed PDF with the expected structure", () => {
    const doc = new PdfDocument({ title: "t", author: "a" });
    const p = doc.addPage();
    doc.text(p, 50, 700, "Hello (world) \\ é");
    doc.rule(p, 50, 690, 300);
    const bytes = doc.render();
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/Type /Catalog");
    expect(s).toContain("/Count 1");
    expect(s).toContain("(Hello \\(world\\) \\\\ \\351) Tj");
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    // xref offsets point at "N 0 obj"
    const xref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const first = Number(s.match(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/)![1]);
    expect(s.slice(first, first + 7)).toBe("1 0 obj");
  });

  it("wraps text within the width", () => {
    const lines = wrap("one two three four five six seven eight nine ten", "F1", 10, 80);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(textWidth(l, "F1", 10)).toBeLessThanOrEqual(80 + 30);
  });
});

describe("leak report", () => {
  it("renders the attribution, recipient, evidence, and integrity hash", () => {
    const bytes = renderLeakReport(record, { publicBase: "https://vybz.cloud/v1" });
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s).toContain("Attributed to sync-house@partner.com");
    expect(s).toContain("Recipient of the matching copy".toUpperCase().slice(0, 0) + "Recipient of the matching copy");
    expect(s).toContain("Midnight \\(final master\\)");
    expect(s).toContain("Forensic watermark");
    expect(s).toContain("b".repeat(64));
    expect(s).toContain("/provenance/reports/0b6c4e6e-1c2d-4c2b-9a1f-6f0e4c6d7a11");
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it("handles an unmatched file without an asset or issuance", () => {
    const bytes = renderLeakReport({ ...record, verdict: "unknown", confidence: "none", asset: null, issuance: null, evidence: [{ method: "exact_hash", result: "no_match" }], note: null }, { publicBase: "https://vybz.cloud/v1" });
    const s = new TextDecoder("latin1").decode(bytes);
    expect(s).toContain("No match");
    expect(s).not.toContain("Recipient of the matching copy");
  });
});
