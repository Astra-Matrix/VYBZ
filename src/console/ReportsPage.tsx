import { type ChangeEvent, type DragEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileSearch, Download, Upload, ArrowLeft, Copy, Check } from "lucide-react";
import { apiRequest, apiDownload, fmtBytes, fmtDate, type Org } from "./consoleApi";

type Evidence = { method: string; result: string } & Record<string, unknown>;
export type Report = {
  id: string;
  name: string;
  sha256: string;
  verdict: "original" | "issued_copy" | "derived_copy" | "derived_unattributed" | "unknown";
  confidence: "exact" | "high" | "medium" | "none";
  input: Record<string, unknown>;
  asset: { id: string; title: string; external_ref: string | null; sha256: string; created_at: string } | null;
  issuance: { id: string; recipient: string; license: string | null; watermark_id: string; created_at: string; c2pa_signed: boolean } | null;
  evidence: Evidence[];
  note: string | null;
  report_hash: string;
  created_at: string;
  links: { self: string; pdf: string; asset: string | null };
};

const VERDICT: Record<Report["verdict"], { label: string; tone: string }> = {
  original: { label: "Registered original", tone: "mint" },
  issued_copy: { label: "Issued copy", tone: "violet" },
  derived_copy: { label: "Attributed", tone: "violet" },
  derived_unattributed: { label: "Derived, not attributed", tone: "cyan" },
  unknown: { label: "No match", tone: "" },
};

const METHOD: Record<string, string> = { exact_hash: "Exact bytes", pcm_hash: "Decoded audio", fingerprint: "Fingerprint", content_credentials: "Content Credentials", watermark: "Watermark" };

function headline(r: Report): string {
  if ((r.verdict === "derived_copy" || r.verdict === "issued_copy") && r.issuance) return `Attributed to ${r.issuance.recipient}`;
  if (r.verdict === "derived_unattributed") return "Derived from a protected original, recipient not established";
  if (r.verdict === "original") return "This is the registered original";
  return "No match";
}

export function ReportsPage({ org }: { org: Org }) {
  const { id } = useParams();
  if (id) return <ReportDetail org={org} id={id} />;
  return <ReportsList org={org} />;
}

function ReportsList({ org }: { org: Org }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Report[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    apiRequest<{ data: Report[] }>(org.id, "GET", "/provenance/reports?limit=100").then((r) => setRows(r.data)).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [org.id]);

  function onDrop(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }
  function onPick(e: ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }

  async function create() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      if (note.trim()) form.append("note", note.trim());
      const r = await apiRequest<Report>(org.id, "POST", "/provenance/reports", form);
      navigate(`/console/reports/${r.id}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Leak reports</h1>
          <p>Drop the file that turned up where it should not. VYBZ names the recipient it was issued to and gives you a report to forward.</p>
        </div>
      </div>

      <div className="vz-card vz-card-accent">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          style={{ border: "1px dashed", borderColor: drag ? "var(--vz-cyan)" : "var(--vz-line-2)", borderRadius: 12, textAlign: "center", padding: 24 }}
        >
          <FileSearch size={22} style={{ color: "var(--vz-cyan)" }} />
          <p className="vz-p" style={{ margin: "10px 0 12px" }}>{file ? <span className="vz-mono">{file.name} · {fmtBytes(file.size)}</span> : "Any format. A phone recording, a rip from a video, a re-encoded MP3. Up to 200 MB."}</p>
          <label className="vz-btn vz-btn-ghost vz-btn-sm" style={{ cursor: "pointer" }}>
            <Upload size={13} /> {file ? "Choose a different file" : "Choose the leaked file"}
            <input type="file" hidden onChange={onPick} />
          </label>
        </div>
        <div style={{ marginTop: 14 }}>
          <label className="vz-label" htmlFor="rep-note">Where it was found (printed on the report)</label>
          <input id="rep-note" className="vz-input" maxLength={2000} placeholder="Public upload found 2026-09-07, takedown filed." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <span className="vz-muted" style={{ fontSize: 12.5 }}>Attribution runs automatically and counts as one detection.</span>
          <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" disabled={!file || busy} onClick={() => void create()}>{busy ? "Analysing…" : "Name the leak"}</button>
        </div>
      </div>

      {err ? <div className="vz-alert err" style={{ marginTop: 14 }}>{err}</div> : null}

      <div className="vz-table-wrap" tabIndex={0} style={{ marginTop: 16 }}>
        <table className="vz-table">
          <thead><tr><th>Finding</th><th>Original</th><th>Confidence</th><th>Created</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows === null && !err ? <tr><td colSpan={5} className="vz-muted">Loading…</td></tr> : null}
            {rows?.length === 0 ? <tr><td colSpan={5} className="vz-muted">No reports yet.</td></tr> : null}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td><span className={`vz-pill ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>{r.issuance ? <span style={{ marginLeft: 8 }}>{r.issuance.recipient}</span> : null}</td>
                <td>{r.asset ? r.asset.title : <span className="vz-muted">—</span>}</td>
                <td style={{ textTransform: "capitalize" }}>{r.confidence}</td>
                <td className="vz-muted">{fmtDate(r.created_at)}</td>
                <td style={{ textAlign: "right" }}><Link to={`/console/reports/${r.id}`} className="vz-btn vz-btn-ghost vz-btn-sm">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReportDetail({ org, id }: { org: Org; id: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiRequest<Report>(org.id, "GET", `/provenance/reports/${id}`).then(setR).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [org.id, id]);

  async function pdf() {
    setBusy(true); setErr(null);
    try { await apiDownload(org.id, `/provenance/reports/${id}.pdf`, `vybz-leak-report-${id.slice(0, 8)}.pdf`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (err && !r) return <><Link to="/console/reports" className="vz-btn vz-btn-ghost vz-btn-sm"><ArrowLeft size={14} /> Reports</Link><div className="vz-alert err" style={{ marginTop: 14 }}>{err}</div></>;
  if (!r) return <><h1 className="vz-sr">Leak report</h1><p className="vz-muted">Loading…</p></>;

  return (
    <>
      <div className="vz-page-head">
        <div>
          <Link to="/console/reports" className="vz-muted" style={{ fontSize: 12.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={13} /> Reports</Link>
          <h1 style={{ marginTop: 6 }}>{headline(r)}</h1>
          <p>{fmtDate(r.created_at)} · report <span className="vz-mono">{r.id.slice(0, 8)}</span></p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy JSON"}</button>
          <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy} onClick={() => void pdf()}><Download size={13} /> {busy ? "Preparing…" : "Download PDF"}</button>
        </div>
      </div>
      {err ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{err}</div> : null}

      <div className="vz-grid vz-grid-2">
        <div className={`vz-card ${r.issuance ? "vz-card-accent" : ""}`}>
          <span className={`vz-pill ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
          <div className="vz-stat" style={{ marginTop: 12, textTransform: "capitalize" }}>{r.confidence}<small>confidence</small></div>
          {r.issuance ? (
            <dl className="vz-dl">
              <dt>Recipient</dt><dd>{r.issuance.recipient}</dd>
              {r.issuance.license ? <><dt>License</dt><dd>{r.issuance.license}</dd></> : null}
              <dt>Copy issued</dt><dd>{fmtDate(r.issuance.created_at)}</dd>
              <dt>Watermark</dt><dd className="vz-mono">{r.issuance.watermark_id}</dd>
              <dt>Content Credentials</dt><dd>{r.issuance.c2pa_signed ? "Signed manifest on the issued copy" : "Not attached"}</dd>
            </dl>
          ) : <p className="vz-p" style={{ marginTop: 10 }}>{r.verdict === "unknown" ? "Nothing VYBZ holds matches this file. If you know which original it may derive from, run detection against that asset." : "The audio derives from a protected original but no recipient's watermark stood out. Heavy processing or a very short excerpt can cause this."}</p>}
        </div>
        <div className="vz-card">
          <h3 className="vz-h3">Protected original</h3>
          {r.asset ? (
            <dl className="vz-dl">
              <dt>Title</dt><dd>{r.asset.title}</dd>
              {r.asset.external_ref ? <><dt>Reference</dt><dd>{r.asset.external_ref}</dd></> : null}
              <dt>Registered</dt><dd>{fmtDate(r.asset.created_at)}</dd>
              <dt>SHA-256</dt><dd className="vz-mono" style={{ wordBreak: "break-all" }}>{r.asset.sha256}</dd>
            </dl>
          ) : <p className="vz-muted">None identified.</p>}
          <h3 className="vz-h3" style={{ marginTop: 16 }}>Submitted file</h3>
          <dl className="vz-dl">
            <dt>Name</dt><dd className="vz-mono">{r.name}</dd>
            <dt>SHA-256</dt><dd className="vz-mono" style={{ wordBreak: "break-all" }}>{r.sha256}</dd>
            {r.input.format ? <><dt>Format</dt><dd>{String(r.input.format)}{r.input.codec ? ` / ${String(r.input.codec)}` : ""}{r.input.sample_rate ? `, ${String(r.input.sample_rate)} Hz` : ""}</dd></> : null}
          </dl>
          {r.note ? <><h3 className="vz-h3" style={{ marginTop: 16 }}>Note</h3><p className="vz-p" style={{ margin: 0 }}>{r.note}</p></> : null}
        </div>
      </div>

      <div className="vz-card" style={{ marginTop: 16 }}>
        <h3 className="vz-h3">Methods and results</h3>
        <div className="vz-table-wrap" tabIndex={0}>
          <table className="vz-table">
            <thead><tr><th>Method</th><th>Result</th><th>Detail</th></tr></thead>
            <tbody>
              {r.evidence.map((e) => (
                <tr key={e.method}>
                  <td>{METHOD[e.method] ?? e.method}</td>
                  <td><span className={`vz-pill ${["match", "attributed"].includes(e.result) || (e.result === "present" && e.consistent) ? (e.method === "watermark" ? "violet" : "mint") : ""}`}>{e.result.replace(/_/g, " ")}</span></td>
                  <td className="vz-muted" style={{ fontSize: 12.5 }}>{detail(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vz-muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>Integrity hash <span className="vz-mono" style={{ wordBreak: "break-all" }}>{r.report_hash}</span>. The PDF carries the same hash; the two must agree.</p>
      </div>
    </>
  );
}

function detail(e: Evidence): string {
  switch (e.method) {
    case "fingerprint": return e.result === "match" ? `Similarity ${Math.round(Number(e.similarity) * 100)}%, aligned at ${e.offset_sec}s over ${e.overlap_sec}s.` : e.result === "skipped" ? `Skipped (${e.reason}).` : "";
    case "watermark": {
      if (e.result === "attributed") { const s = e.statistics as { z?: number; ratio?: number } | undefined; return `z = ${s?.z !== undefined ? Number(s.z).toFixed(1) : "n/a"}, ratio to runner-up ${s?.ratio !== undefined ? Number(s.ratio).toFixed(2) : "n/a"}.`; }
      if (e.result === "skipped") return `Skipped (${e.reason}).`;
      return "";
    }
    case "content_credentials": return e.result === "present" ? (e.consistent ? "VYBZ manifest, consistent with the issuance." : `Manifest from ${String(e.issuer ?? "another issuer")}.`) : "";
    default: return "";
  }
}
