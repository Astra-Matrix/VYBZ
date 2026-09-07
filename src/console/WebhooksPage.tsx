import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Plus, Send, Trash2, RefreshCw, Copy, Check } from "lucide-react";
import { apiRequest, fmtDate, type Org } from "./consoleApi";

type Endpoint = { id: string; url: string; description: string | null; events: string[]; active: boolean; created_at: string; updated_at: string; secret?: string };
type Delivery = { id: string; event: string; status: "pending" | "sending" | "delivered" | "failed"; attempt: number; last_status: number | null; last_error: string | null; created_at: string; delivered_at: string | null };

const EVENTS: Array<{ id: string; label: string }> = [
  { id: "asset.registered", label: "Asset registered" },
  { id: "issuance.created", label: "Issuance created" },
  { id: "detection.completed", label: "Detection completed" },
  { id: "detection.attributed", label: "Detection attributed" },
  { id: "commit.created", label: "Commit created" },
];

export function WebhooksPage({ org }: { org: Org }) {
  const [list, setList] = useState<Endpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Endpoint | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await apiRequest<{ data: Endpoint[] }>(org.id, "GET", "/webhooks");
      setList(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [org.id]);
  useEffect(() => { void reload(); }, [reload]);

  async function remove(ep: Endpoint) {
    if (!confirm(`Delete the endpoint ${ep.url}? Pending deliveries are dropped.`)) return;
    try {
      await apiRequest(org.id, "DELETE", `/webhooks/${ep.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function test(ep: Endpoint) {
    try {
      await apiRequest(org.id, "POST", `/webhooks/${ep.id}/test`);
      setOpen(ep.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function toggle(ep: Endpoint) {
    try {
      await apiRequest(org.id, "PATCH", `/webhooks/${ep.id}`, JSON.stringify({ active: !ep.active }), { "Content-Type": "application/json" });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Webhooks</h1>
          <p>Signed JSON for every registration, issuance, detection, and commit. Retries for about fifteen hours, then a delivery log to inspect.</p>
        </div>
        <button type="button" className="vz-btn vz-btn-primary vz-btn-sm" onClick={() => { setCreating(true); setCreated(null); }}><Plus size={14} /> New endpoint</button>
      </div>
      {error ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{error}</div> : null}

      {created?.secret ? (
        <div className="vz-card vz-card-accent" style={{ marginBottom: 14 }}>
          <h3 className="vz-h3">Signing secret</h3>
          <p className="vz-p">Store it now. It is not shown again. Verify deliveries with HMAC-SHA256 over <span className="vz-mono">t + "." + body</span>.</p>
          <SecretRow value={created.secret} />
        </div>
      ) : null}

      {creating ? <CreateForm org={org} onDone={(ep) => { setCreating(false); if (ep) { setCreated(ep); void reload(); } }} /> : null}

      {list === null ? <p className="vz-muted">Loading…</p> : list.length === 0 && !creating ? (
        <div className="vz-card"><p className="vz-p">No endpoints yet. Add one to receive events, or manage them from the API and MCP with the <span className="vz-mono">webhooks:manage</span> scope.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {list.map((ep) => (
            <div key={ep.id} className="vz-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="vz-mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ep.url}</div>
                  <div className="vz-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {ep.description ? `${ep.description} · ` : ""}{ep.events.includes("*") ? "all events" : ep.events.join(", ")} · created {fmtDate(ep.created_at)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`vz-pill ${ep.active ? "mint" : ""}`}>{ep.active ? "Active" : "Paused"}</span>
                  <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => void test(ep)}><Send size={13} /> Test</button>
                  <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => void toggle(ep)}>{ep.active ? "Pause" : "Resume"}</button>
                  <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => setOpen(open === ep.id ? null : ep.id)}>{open === ep.id ? "Hide deliveries" : "Deliveries"}</button>
                  <button type="button" className="vz-btn vz-btn-danger vz-btn-sm" aria-label="Delete endpoint" onClick={() => void remove(ep)}><Trash2 size={13} /></button>
                </div>
              </div>
              {open === ep.id ? <Deliveries org={org} endpoint={ep} /> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SecretRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <code className="vz-mono" style={{ flex: 1, overflow: "auto", padding: "8px 10px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10 }}>{value}</code>
      <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}>
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CreateForm({ org, onDone }: { org: Org; onDone: (ep: Endpoint | null) => void }) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS.map((e) => e.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({ url: url.trim(), description: description.trim() || undefined, events: events.length === EVENTS.length ? ["*"] : events });
      const ep = await apiRequest<Endpoint>(org.id, "POST", "/webhooks", body, { "Content-Type": "application/json" });
      onDone(ep);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="vz-card" style={{ display: "grid", gap: 12, marginBottom: 14 }}>
      <div>
        <label className="vz-label" htmlFor="wh-url">Endpoint URL</label>
        <input id="wh-url" className="vz-input" required placeholder="https://example.com/vybz" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div>
        <label className="vz-label" htmlFor="wh-desc">Description</label>
        <input id="wh-desc" className="vz-input" maxLength={200} placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <span className="vz-label">Events</span>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {EVENTS.map((ev) => (
            <label key={ev.id} className="vz-check">
              <input type="checkbox" checked={events.includes(ev.id)} onChange={(e) => setEvents(e.target.checked ? [...events, ev.id] : events.filter((x) => x !== ev.id))} />
              <span>{ev.label} <span className="vz-muted vz-mono" style={{ fontSize: 11 }}>{ev.id}</span></span>
            </label>
          ))}
        </div>
      </div>
      {err ? <div className="vz-alert err">{err}</div> : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy || !events.length}>{busy ? "Creating…" : "Create endpoint"}</button>
      </div>
    </form>
  );
}

function Deliveries({ org, endpoint }: { org: Org; endpoint: Endpoint }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await apiRequest<{ data: Delivery[] }>(org.id, "GET", `/webhooks/${endpoint.id}/deliveries?limit=50`);
      setRows(r.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [org.id, endpoint.id]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);
  async function retry(d: Delivery) {
    try {
      await apiRequest(org.id, "POST", `/webhooks/${endpoint.id}/deliveries/${d.id}/retry`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  const tone = (s: Delivery["status"]) => (s === "delivered" ? "mint" : s === "failed" ? "rose" : "");
  return (
    <div style={{ marginTop: 12 }}>
      {err ? <div className="vz-alert err">{err}</div> : null}
      {rows === null ? <p className="vz-muted">Loading…</p> : rows.length === 0 ? <p className="vz-muted" style={{ fontSize: 12.5 }}>No deliveries yet. Send a test.</p> : (
        <div className="vz-table-wrap" tabIndex={0}>
          <table className="vz-table">
            <thead><tr><th>Event</th><th>Status</th><th>Attempt</th><th>Response</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="vz-mono">{d.event}</td>
                  <td><span className={`vz-pill ${tone(d.status)}`}>{d.status}</span></td>
                  <td>{d.attempt}</td>
                  <td className="vz-muted">{d.last_status ?? ""}{d.last_error ? ` ${d.last_error}` : ""}</td>
                  <td className="vz-muted">{fmtDate(d.created_at)}</td>
                  <td>{d.status === "failed" || d.status === "pending" ? <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => void retry(d)}><RefreshCw size={12} /> Retry</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
