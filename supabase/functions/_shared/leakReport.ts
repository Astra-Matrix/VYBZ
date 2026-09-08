// Renders a leak report as a PDF from the stored report record. The layout is
// deliberately plain: a lawyer, a label head, or a manager should be able to
// read it on a phone and forward it without explanation.
// Environment-neutral: no Deno or browser globals.
import { PAGE, PdfDocument, wrap, type Font } from "./pdf.ts";

export interface ReportRecord {
  id: string;
  created_at: string;
  name: string;
  sha256: string;
  verdict: "original" | "issued_copy" | "derived_copy" | "derived_unattributed" | "unknown";
  confidence: "exact" | "high" | "medium" | "none";
  input: Record<string, unknown>;
  evidence: Array<Record<string, unknown> & { method: string; result: string }>;
  note: string | null;
  report_hash: string;
  org: { name: string; slug: string };
  asset: { id: string; title: string; external_ref: string | null; sha256: string; created_at: string; duration_sec: number | null } | null;
  issuance: { id: string; recipient: string; license: string | null; watermark_id: string; created_at: string; c2pa_signed: boolean } | null;
}

const VERDICT_TEXT: Record<ReportRecord["verdict"], string> = {
  original: "The file is the registered original.",
  issued_copy: "The file is byte- or audio-identical to a copy issued to the recipient named below.",
  derived_copy: "The file is altered audio derived from the registered original and carries the watermark issued to the recipient named below.",
  derived_unattributed: "The file derives from the registered original, but no recipient's watermark could be established.",
  unknown: "The file could not be matched to any registered original or issued copy.",
};

const METHOD_NAME: Record<string, string> = {
  exact_hash: "Exact bytes",
  pcm_hash: "Decoded audio hash",
  fingerprint: "Perceptual fingerprint",
  content_credentials: "Content Credentials",
  watermark: "Forensic watermark",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function describe(e: ReportRecord["evidence"][number]): string {
  const r = e.result;
  switch (e.method) {
    case "exact_hash":
      return r === "match" ? "The bytes are identical to a file VYBZ holds." : "No file with these exact bytes.";
    case "pcm_hash":
      if (r === "match") return "The decoded audio is identical to a file VYBZ holds; only the container or metadata differs.";
      if (r === "skipped") return `Not run (${e.reason ?? "not decoded"}).`;
      return "The decoded audio does not exactly match a file VYBZ holds.";
    case "fingerprint":
      if (r === "match") return `Derives from the registered original. Similarity ${Math.round(Number(e.similarity ?? 0) * 100)}%, aligned at ${e.offset_sec ?? 0}s, ${e.overlap_sec ?? 0}s compared.`;
      if (r === "skipped") return `Not run (${e.reason ?? "not decoded"}).`;
      return "No registered original matched by fingerprint.";
    case "content_credentials":
      if (r === "present" && e.issuer === "vybz") return e.consistent ? "A VYBZ Content Credentials manifest is present and consistent with the issuance record." : "A VYBZ manifest is present but does not match any issuance record.";
      if (r === "present") return "A Content Credentials manifest from another issuer is present.";
      return "No Content Credentials manifest is present.";
    case "watermark": {
      if (r === "attributed") {
        const a = e.attributed as { recipient?: string } | null;
        const s = e.statistics as { z?: number; ratio?: number } | null;
        return `Attributed to ${a?.recipient ?? "a recipient"} with ${e.confidence} confidence. Correlation z = ${s?.z !== undefined ? Number(s.z).toFixed(1) : "n/a"}, ratio to runner-up ${s?.ratio !== undefined ? Number(s.ratio).toFixed(2) : "n/a"}.`;
      }
      if (r === "inconclusive") return "No recipient's watermark stood out above the floor.";
      if (r === "skipped") return `Not run (${e.reason ?? "skipped"}).`;
      if (r === "not_requested") return "Not requested.";
      return r;
    }
    default:
      return r;
  }
}

export function renderLeakReport(r: ReportRecord, opts: { publicBase: string }): Uint8Array {
  const doc = new PdfDocument({ title: `Leak report ${r.id.slice(0, 8)}`, author: `VYBZ for ${r.org.name}`, subject: r.asset?.title ?? r.name });
  const M = 54;
  const W = PAGE.width - M * 2;
  let page = doc.addPage();
  let y = PAGE.height - M;

  const ink: [number, number, number] = [0.08, 0.1, 0.14];
  const muted: [number, number, number] = [0.42, 0.46, 0.54];
  const accent: [number, number, number] = [0.0, 0.62, 0.86];

  const ensure = (h: number) => {
    if (y - h < M + 30) {
      footer();
      page = doc.addPage();
      y = PAGE.height - M;
    }
  };
  const footer = () => {
    doc.rule(page, M, M + 14, PAGE.width - M);
    doc.text(page, M, M, `VYBZ leak report ${r.id} · integrity hash ${r.report_hash.slice(0, 16)}… · page ${page + 1}`, { size: 7.5, color: muted });
  };
  const line = (s: string, font: Font = "F1", size = 10, color = ink, gap = 4) => {
    for (const l of wrap(s, font, size, W)) {
      ensure(size + gap);
      doc.text(page, M, y - size, l, { font, size, color });
      y -= size + gap;
    }
  };
  const field = (label: string, value: string, mono = false) => {
    ensure(26);
    doc.text(page, M, y - 8, label.toUpperCase(), { font: "F2", size: 7, color: muted });
    const lines = wrap(value, mono ? "F3" : "F1", mono ? 8.5 : 10, W - 150);
    let yy = y - 8;
    for (const l of lines) {
      doc.text(page, M + 150, yy, l, { font: mono ? "F3" : "F1", size: mono ? 8.5 : 10, color: ink });
      yy -= mono ? 11 : 13;
    }
    y = yy - 6;
  };
  const heading = (s: string) => {
    ensure(34);
    y -= 10;
    doc.text(page, M, y - 11, s, { font: "F2", size: 11.5, color: ink });
    y -= 17;
    doc.rule(page, M, y, PAGE.width - M);
    y -= 10;
  };

  // Masthead
  doc.box(page, M, y - 22, 22, 22, accent);
  doc.text(page, M + 30, y - 16, "VYBZ", { font: "F2", size: 13, color: ink });
  doc.text(page, M + 30, y - 27, "Leak attribution report", { size: 8.5, color: muted });
  doc.text(page, PAGE.width - M - 200, y - 16, fmtDate(r.created_at), { size: 8.5, color: muted });
  doc.text(page, PAGE.width - M - 200, y - 27, `Report ${r.id}`, { font: "F3", size: 7.5, color: muted });
  y -= 44;
  doc.rule(page, M, y, PAGE.width - M, { width: 1.2, color: accent });
  y -= 18;

  // Finding
  const title = r.verdict === "derived_copy" || r.verdict === "issued_copy" ? (r.issuance ? `Attributed to ${r.issuance.recipient}` : "Attributed") : r.verdict === "derived_unattributed" ? "Derived from a protected original, recipient not established" : r.verdict === "original" ? "This is the registered original" : "No match";
  line(title, "F2", 17, ink, 8);
  line(VERDICT_TEXT[r.verdict], "F1", 10.5, ink, 6);
  line(`Confidence: ${r.confidence}.`, "F2", 10, r.confidence === "none" ? muted : accent, 6);
  if (r.note) { y -= 4; line(`Note from ${r.org.name}: ${r.note}`, "F1", 9.5, muted, 6); }

  // Recipient
  if (r.issuance) {
    heading("Recipient of the matching copy");
    field("Recipient", r.issuance.recipient);
    if (r.issuance.license) field("License", r.issuance.license);
    field("Copy issued", fmtDate(r.issuance.created_at));
    field("Watermark id", r.issuance.watermark_id, true);
    field("Issuance id", r.issuance.id, true);
    field("Content Credentials", r.issuance.c2pa_signed ? "Signed manifest attached to the issued copy" : "Not attached to this copy");
  }

  // Original
  if (r.asset) {
    heading("Protected original");
    field("Title", r.asset.title);
    if (r.asset.external_ref) field("Reference", r.asset.external_ref);
    field("Registered", fmtDate(r.asset.created_at));
    if (r.asset.duration_sec !== null) field("Duration", `${Math.round(r.asset.duration_sec)} s`);
    field("SHA-256", r.asset.sha256, true);
    field("Asset id", r.asset.id, true);
  }

  // Submitted file
  heading("Submitted file");
  field("Name", r.name);
  field("SHA-256", r.sha256, true);
  const inp = r.input;
  const fmt = [inp.format, inp.codec].filter(Boolean).join(" / ");
  if (fmt) field("Format", String(fmt));
  if (inp.sample_rate) field("Sample rate", `${inp.sample_rate} Hz${inp.channels ? `, ${inp.channels} ch` : ""}`);
  if (inp.duration_sec !== undefined && inp.duration_sec !== null) field("Duration", `${Math.round(Number(inp.duration_sec))} s${inp.truncated ? " (analysis truncated)" : ""}`);
  if (inp.bytes) field("Size", `${Number(inp.bytes).toLocaleString("en-US")} bytes`);

  // Evidence
  heading("Methods and results");
  for (const e of r.evidence) {
    ensure(30);
    const mark = e.result === "match" || e.result === "attributed" || (e.result === "present" && e.consistent) ? "MATCH" : e.result === "no_match" || e.result === "inconclusive" ? "no match" : e.result.replace("_", " ");
    doc.text(page, M, y - 10, METHOD_NAME[e.method] ?? e.method, { font: "F2", size: 9.5, color: ink });
    doc.text(page, M + 150, y - 10, mark, { font: "F2", size: 8.5, color: mark === "MATCH" ? accent : muted });
    y -= 14;
    for (const l of wrap(describe(e), "F1", 9, W)) { ensure(12); doc.text(page, M, y - 9, l, { size: 9, color: ink }); y -= 12; }
    y -= 4;
  }

  // Method statement
  heading("How to read this");
  line("VYBZ registers an original recording and issues each recipient a copy carrying an inaudible spread-spectrum watermark keyed to that recipient. A submitted file is checked by exact bytes, by decoded audio, by perceptual fingerprint against the registered original, by any Content Credentials manifest it carries, and by blind correlation of the watermark against every issued copy. An attribution is asserted only when the top candidate is decisively above the noise floor and the runner-up.", "F1", 9, ink, 4);
  y -= 4;
  line("The integrity hash below is SHA-256 over the report's findings as stored by VYBZ. The same report is available as JSON at the address given; the hash in both must agree.", "F1", 9, ink, 4);
  y -= 6;
  field("Integrity hash", r.report_hash, true);
  field("JSON", `${opts.publicBase}/provenance/reports/${r.id}`, true);
  field("Organization", `${r.org.name} (${r.org.slug})`);

  footer();
  return doc.render();
}
