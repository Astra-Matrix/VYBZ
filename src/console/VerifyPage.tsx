import { type ChangeEvent, type DragEvent, useState } from "react";
import { Upload, ShieldCheck, X } from "lucide-react";
import { apiRequest, fmtBytes, type Org } from "./consoleApi";

type Evidence = { method: string; result: string; reason?: string; note?: string } & Record<string, unknown>;
type Verification = {
  status?: "ok" | "error";
  name: string;
  verdict: "original" | "issued_copy" | "derived_copy" | "derived_unattributed" | "unknown";
  confidence: "exact" | "high" | "medium" | "none";
  sha256: string;
  input: { format: string; codec: string; bytes: number; sample_rate: number | null; channels: number | null; duration_sec: number | null; analyzed_sec: number | null; truncated: boolean; decoded: boolean; decode_error: { code: string; message: string } | null };
  asset: { id: string; title: string } | null;
  issuance: { id: string; recipient: string; watermark_id: string; created_at: string } | null;
  evidence: Evidence[];
  hint: string | null;
  error?: { code: string; message: string };
};
type Batch = { data: Verification[]; summary: Record<string, number> };

const VERDICT: Record<Verification["verdict"], { label: string; tone: string }> = {
  original: { label: "Original", tone: "cyan" },
  issued_copy: { label: "Issued copy", tone: "cyan" },
  derived_copy: { label: "Derived copy, attributed", tone: "violet" },
  derived_unattributed: { label: "Derived copy, unattributed", tone: "violet" },
  unknown: { label: "Unknown", tone: "" },
};

const METHOD: Record<string, string> = {
  exact_hash: "Exact hash",
  pcm_hash: "PCM hash",
  fingerprint: "Fingerprint",
  content_credentials: "Content Credentials",
  watermark: "Watermark",
};

function toneFor(e: Evidence): string {
  if (["match", "attributed", "present"].includes(e.result)) return e.method === "watermark" ? "violet" : "mint";
  if (["no_match", "inconclusive", "absent"].includes(e.result)) return "";
  return "";
}

function describe(e: Evidence): string {
  switch (e.method) {
    case "exact_hash":
      return e.result === "match" ? "Bytes are identical to a file we hold." : "No file with these exact bytes.";
    case "pcm_hash":
      if (e.result === "match") return "Decoded audio is identical to a file we hold; container or metadata differs.";
      if (e.result === "skipped") return `Skipped (${e.reason}).`;
      return "Decoded audio differs from every file we hold.";
    case "fingerprint":
      if (e.result === "match") return `Derives from a registered original. Similarity ${Math.round(Number(e.similarity) * 100)}%, starts at ${e.offset_sec}s, ${e.overlap_sec}s compared.`;
      if (e.result === "skipped") return `Skipped (${e.reason}).`;
      return "No registered original matched by fingerprint.";
    case "content_credentials":
      if (e.result === "present" && e.issuer === "vybz") return e.consistent ? "VYBZ manifest present and consistent with the issuance record." : "VYBZ manifest present but not matching any issuance record.";
      if (e.result === "present") return "A Content Credentials manifest is present from another issuer.";
      return "No Content Credentials manifest.";
    case "watermark":
      if (e.result === "attributed") {
        const a = e.attributed as { recipient: string } | null;
        return `Attributed to ${a?.recipient ?? "a recipient"} with ${e.confidence} confidence.`;
      }
      if (e.result === "inconclusive") return "No recipient's watermark stood out.";
      if (e.result === "not_requested") return "Not run. Enable attribution to correlate the watermark.";
      return `Skipped (${e.reason}).`;
    default:
      return e.result;
  }
}

export function VerifyPage({ org }: { org: Org }) {
  const [files, setFiles] = useState<File[]>([]);
  const [attribute, setAttribute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Verification[] | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [drag, setDrag] = useState(false);

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next.slice(0, 25));
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    add(e.dataTransfer.files);
  }
  function onPick(e: ChangeEvent<HTMLInputElement>) {
    add(e.target.files);
    e.target.value = "";
  }

  async function submit() {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      if (attribute) form.append("attribute", "true");
      const r = await apiRequest<Batch>(org.id, "POST", "/provenance/verify/batch", form);
      setResults(r.data);
      setSummary(r.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const total = files.reduce((s, f) => s + f.size, 0);

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Verify</h1>
          <p>Drop files in any format. Each is checked by exact hash, decoded-audio hash, fingerprint, and Content Credentials. Attribution correlates the watermark and counts as a detection.</p>
        </div>
      </div>

      <div
        className="vz-card"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        style={{ borderStyle: "dashed", borderColor: drag ? "var(--vz-cyan)" : undefined, textAlign: "center", padding: 28 }}
      >
        <Upload size={22} style={{ color: "var(--vz-cyan)" }} />
        <p className="vz-p" style={{ margin: "10px 0 12px" }}>Drop up to 25 files, 200 MB total. WAV, AIFF, FLAC, MP3, Ogg, Opus. Video containers when the decode worker is configured.</p>
        <label className="vz-btn vz-btn-ghost vz-btn-sm" style={{ cursor: "pointer" }}>
          Choose files
          <input type="file" multiple hidden onChange={onPick} />
        </label>
      </div>

      {files.length ? (
        <div className="vz-card" style={{ marginTop: 14 }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`} className="vz-p" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, margin: "4px 0" }}>
                <span className="vz-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span className="vz-muted" style={{ flex: "none" }}>{fmtBytes(f.size)}</span>
                <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}><X size={14} /></button>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <label className="vz-check">
              <input type="checkbox" checked={attribute} onChange={(e) => setAttribute(e.target.checked)} />
              <span>Attribute leaks with the watermark (one detection per file)</span>
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="vz-muted" style={{ fontSize: 12.5 }}>{files.length} file{files.length === 1 ? "" : "s"}, {fmtBytes(total)}</span>
              <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy || total > 200 * 1_048_576} onClick={() => void submit()}>
                <ShieldCheck size={14} /> {busy ? "Verifying…" : "Verify"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="vz-alert err" style={{ marginTop: 14 }}>{error}</div> : null}

      {results ? (
        <section style={{ marginTop: 22 }}>
          {summary ? (
            <p className="vz-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              {summary.total} checked · {summary.original} original · {summary.issued_copy} issued · {summary.derived_copy} attributed · {summary.derived_unattributed} derived · {summary.unknown} unknown · {summary.errors} failed
            </p>
          ) : null}
          <div style={{ display: "grid", gap: 12 }}>
            {results.map((r, i) => <Result key={`${r.name}-${i}`} r={r} />)}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Result({ r }: { r: Verification }) {
  const [open, setOpen] = useState(false);
  if (r.status === "error" || r.error) {
    return (
      <div className="vz-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <span className="vz-mono">{r.name}</span>
          <span className="vz-pill">Failed</span>
        </div>
        <p className="vz-p" style={{ marginTop: 8 }}>{r.error?.message ?? "This file could not be processed."}</p>
      </div>
    );
  }
  const v = VERDICT[r.verdict] ?? VERDICT.unknown;
  return (
    <div className="vz-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="vz-mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
        <span className={`vz-pill ${v.tone}`}>{v.label}{r.confidence !== "none" ? ` · ${r.confidence}` : ""}</span>
      </div>
      <p className="vz-muted" style={{ fontSize: 12.5, margin: "6px 0 10px" }}>
        {r.input.format.toUpperCase()}{r.input.codec !== r.input.format ? ` (${r.input.codec})` : ""} · {fmtBytes(r.input.bytes)}
        {r.input.sample_rate ? ` · ${r.input.sample_rate} Hz · ${r.input.channels} ch` : ""}
        {r.input.duration_sec ? ` · ${r.input.duration_sec.toFixed(1)} s` : r.input.analyzed_sec ? ` · ${r.input.analyzed_sec.toFixed(1)} s analyzed` : ""}
        {r.input.truncated ? " · truncated" : ""}
      </p>
      {r.asset ? <p className="vz-p"><b>Asset</b> {r.asset.title}</p> : null}
      {r.issuance ? <p className="vz-p"><b>Recipient</b> {r.issuance.recipient} <span className="vz-muted">· watermark {r.issuance.watermark_id.slice(0, 8)}</span></p> : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {r.evidence.map((e) => (
          <span key={e.method} className={`vz-pill ${toneFor(e)}`} title={describe(e)}>{METHOD[e.method] ?? e.method}: {e.result.replace("_", " ")}</span>
        ))}
      </div>
      <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(!open)}>{open ? "Hide detail" : "Show detail"}</button>
      {open ? (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
          {r.evidence.map((e) => <li key={e.method} className="vz-p" style={{ margin: "4px 0" }}><b>{METHOD[e.method] ?? e.method}.</b> {describe(e)}</li>)}
          {r.hint ? <li className="vz-p vz-muted" style={{ margin: "4px 0" }}>{r.hint}</li> : null}
          <li className="vz-p vz-muted vz-mono" style={{ margin: "4px 0", fontSize: 11.5 }}>sha256 {r.sha256}</li>
        </ul>
      ) : null}
    </div>
  );
}
