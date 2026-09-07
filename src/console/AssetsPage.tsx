import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Plus, Send, ExternalLink, FileJson } from "lucide-react";
import { apiRequest, fmtBytes, fmtDate, type Org } from "./consoleApi";

type Asset = {
  id: string; title: string; external_ref: string | null; sha256: string; source_format: string | null; bytes: number;
  sample_rate: number | null; channels: number | null; duration_sec: number | null; created_at: string;
};
type Issuance = { id: string; recipient: string; license: string | null; watermark_id: string; c2pa_signed: boolean; created_at: string; bytes?: number; download?: { url: string | null; expires_in: number } };
type BatchItem = ({ status: "ok" } & Issuance) | { status: "error"; name: string; error: { code: string; message: string } };
type Batch = { batch_id: string; data: BatchItem[]; summary: { total: number; issued: number; errors: number }; manifest: { url: string | null; expires_in: number } | null };

const short = (s: string) => s.slice(0, 10);
const dur = (s: number | null) => (s === null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

export function AssetsPage({ org }: { org: Org }) {
  const [list, setList] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [open, setOpen] = useState<{ id: string; panel: "issue" | "issuances" } | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await apiRequest<{ data: Asset[] }>(org.id, "GET", "/provenance/assets?limit=200");
      setList(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [org.id]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Assets</h1>
          <p>Registered originals. Issue a watermarked copy per recipient, one at a time or fifty in one call, and review who received what.</p>
        </div>
        <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" onClick={() => setRegistering(true)}><Plus size={14} /> Register original</button>
      </div>
      {error ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{error}</div> : null}
      {registering ? <RegisterForm org={org} onDone={(ok) => { setRegistering(false); if (ok) void reload(); }} /> : null}

      {list === null ? <p className="vz-muted">Loading…</p> : list.length === 0 && !registering ? (
        <div className="vz-card"><p className="vz-p">No assets yet. Register a lossless original (WAV, AIFF, or FLAC) to start issuing copies.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {list.map((a) => (
            <div key={a.id} className="vz-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  <div className="vz-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    <span className="vz-mono">{short(a.sha256)}</span>
                    {a.source_format ? ` · ${a.source_format.toUpperCase()}` : ""}
                    {a.sample_rate ? ` · ${a.sample_rate / 1000} kHz` : ""}
                    {a.channels ? ` · ${a.channels === 1 ? "mono" : a.channels === 2 ? "stereo" : `${a.channels} ch`}` : ""}
                    {a.duration_sec !== null ? ` · ${dur(a.duration_sec)}` : ""}
                    {` · ${fmtBytes(Number(a.bytes))}`}
                    {a.external_ref ? ` · ref ${a.external_ref}` : ""}
                    {` · registered ${fmtDate(a.created_at)}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" onClick={() => setOpen(open?.id === a.id && open.panel === "issue" ? null : { id: a.id, panel: "issue" })}><Send size={13} /> Issue</button>
                  <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => setOpen(open?.id === a.id && open.panel === "issuances" ? null : { id: a.id, panel: "issuances" })}>Issuances</button>
                </div>
              </div>
              {open?.id === a.id && open.panel === "issue" ? <IssuePanel org={org} asset={a} /> : null}
              {open?.id === a.id && open.panel === "issuances" ? <Issuances org={org} asset={a} /> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RegisterForm({ org, onDone }: { org: Org; onDone: (ok: boolean) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream", "X-VYBZ-Title": (title.trim() || file.name.replace(/\.[^.]+$/, "")).slice(0, 200) };
      if (ref.trim()) headers["X-VYBZ-External-Ref"] = ref.trim().slice(0, 200);
      await apiRequest(org.id, "POST", "/provenance/assets", file, headers);
      onDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="vz-card" style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div>
        <label className="vz-label" htmlFor="as-file">Original (WAV, AIFF, or FLAC, up to 200 MB)</label>
        <input id="as-file" className="vz-input" type="file" accept=".wav,.wave,.aif,.aiff,.aifc,.flac,audio/wav,audio/aiff,audio/flac" required onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }} />
      </div>
      <div className="vz-grid vz-grid-2">
        <div>
          <label className="vz-label" htmlFor="as-title">Title</label>
          <input id="as-title" className="vz-input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="vz-label" htmlFor="as-ref">External reference</label>
          <input id="as-ref" className="vz-input" maxLength={200} placeholder="Your catalogue id, optional" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
      </div>
      {err ? <div className="vz-alert err">{err}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => onDone(false)}>Cancel</button>
        <button type="submit" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy || !file}>{busy ? "Registering…" : "Register"}</button>
      </div>
    </form>
  );
}

function IssuePanel({ org, asset }: { org: Org; asset: Asset }) {
  const [text, setText] = useState("");
  const [license, setLicense] = useState("");
  const [c2pa, setC2pa] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Batch | null>(null);
  const recipients = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!recipients.length) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const h = { "Content-Type": "application/json" };
      if (recipients.length === 1) {
        const iss = await apiRequest<Issuance>(org.id, "POST", `/provenance/assets/${asset.id}/issue`, JSON.stringify({ recipient: recipients[0], license: license.trim() || undefined, c2pa, store: true }), h);
        setResult({ batch_id: "", data: [{ status: "ok", ...iss }], summary: { total: 1, issued: 1, errors: 0 }, manifest: null });
      } else {
        const b = await apiRequest<Batch>(org.id, "POST", `/provenance/assets/${asset.id}/issue/batch`, JSON.stringify({ recipients, license: license.trim() || undefined, c2pa }), h);
        setResult(b);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <div>
          <label className="vz-label" htmlFor={`is-r-${asset.id}`}>Recipients, one per line (up to 50)</label>
          <textarea id={`is-r-${asset.id}`} className="vz-input" rows={4} placeholder={"partner@label.com\nsync-house-42"} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="vz-grid vz-grid-2">
          <div>
            <label className="vz-label" htmlFor={`is-l-${asset.id}`}>License</label>
            <input id={`is-l-${asset.id}`} className="vz-input" maxLength={200} placeholder="Optional, recorded on every copy" value={license} onChange={(e) => setLicense(e.target.value)} />
          </div>
          <label className="vz-check" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={c2pa} onChange={(e) => setC2pa(e.target.checked)} />
            <span>Attach Content Credentials when configured</span>
          </label>
        </div>
        {err ? <div className="vz-alert err">{err}</div> : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <span className="vz-muted" style={{ fontSize: 12.5 }}>{recipients.length > 50 ? "At most 50 recipients per call." : recipients.length ? `${recipients.length} ${recipients.length === 1 ? "issuance" : "issuances"}, each metered.` : ""}</span>
          <button type="submit" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy || !recipients.length || recipients.length > 50}>{busy ? "Issuing…" : recipients.length > 1 ? `Issue ${recipients.length} copies` : "Issue copy"}</button>
        </div>
      </form>

      {result ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span className="vz-muted" style={{ fontSize: 12.5 }}>{result.summary.issued} issued{result.summary.errors ? `, ${result.summary.errors} failed` : ""}. Links expire in one hour.</span>
            {result.manifest?.url ? <a className="vz-btn vz-btn-ghost vz-btn-sm" href={result.manifest.url} target="_blank" rel="noopener noreferrer"><FileJson size={13} /> Manifest</a> : null}
          </div>
          <div className="vz-table-wrap">
            <table className="vz-table">
              <thead><tr><th>Recipient</th><th>Status</th><th>Watermark</th><th>Credentials</th><th /></tr></thead>
              <tbody>
                {result.data.map((it, i) => it.status === "ok" ? (
                  <tr key={it.id}>
                    <td>{it.recipient}</td>
                    <td><span className="vz-pill mint">Issued</span></td>
                    <td className="vz-mono vz-muted">{short(it.watermark_id)}</td>
                    <td>{it.c2pa_signed ? "Signed" : <span className="vz-muted">None</span>}</td>
                    <td style={{ textAlign: "right" }}>{it.download?.url ? <a className="vz-btn vz-btn-ghost vz-btn-sm" href={it.download.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Download</a> : null}</td>
                  </tr>
                ) : (
                  <tr key={`e${i}`}>
                    <td>{it.name}</td>
                    <td><span className="vz-pill rose">Failed</span></td>
                    <td colSpan={3} className="vz-muted">{it.error.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Issuances({ org, asset }: { org: Org; asset: Asset }) {
  const [rows, setRows] = useState<Issuance[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiRequest<{ data: Issuance[] }>(org.id, "GET", `/provenance/assets/${asset.id}/issuances`)
      .then((r) => setRows(r.data))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [org.id, asset.id]);
  if (err) return <div className="vz-alert err" style={{ marginTop: 12 }}>{err}</div>;
  if (rows === null) return <p className="vz-muted" style={{ marginTop: 12 }}>Loading…</p>;
  if (rows.length === 0) return <p className="vz-muted" style={{ marginTop: 12, fontSize: 12.5 }}>No copies issued yet.</p>;
  return (
    <div className="vz-table-wrap" style={{ marginTop: 12 }}>
      <table className="vz-table">
        <thead><tr><th>Recipient</th><th>License</th><th>Watermark</th><th>Credentials</th><th>Issued</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.recipient}</td>
              <td className="vz-muted">{r.license ?? ""}</td>
              <td className="vz-mono vz-muted">{short(r.watermark_id)}</td>
              <td>{r.c2pa_signed ? "Signed" : <span className="vz-muted">None</span>}</td>
              <td className="vz-muted">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
