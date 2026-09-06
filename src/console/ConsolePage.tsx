import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { KeyRound, Activity, ScrollText, Bot, LayoutDashboard, Plus, Copy, Check, ShieldCheck, Users, CreditCard, Fingerprint, Webhook } from "lucide-react";
import { MembersPage, BillingPage, JoinPage } from "./TeamBilling";
import { VerifyPage } from "./VerifyPage";
import { WebhooksPage } from "./WebhooksPage";
import { useSession } from "@/store/session";
import { SiteShell, Code } from "@/site/SiteShell";
import {
  SCOPES,
  type ApiKeyRow,
  type AuditRow,
  type CreatedKey,
  type Org,
  type UsageRow,
  audit,
  chainStatus,
  counts,
  createKey,
  createOrg,
  fmtBytes,
  fmtDate,
  listKeys,
  listOrgs,
  revokeKey,
  slugFromName,
  usage,
} from "./consoleApi";

const ORG_STORAGE = "vybz.console.org";

export function ConsolePage() {
  const { userId, ready } = useSession();
  const location = useLocation();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(() => {
    try { return localStorage.getItem(ORG_STORAGE); } catch { return null; }
  });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await listOrgs();
      setOrgs(list);
      if (list.length && !list.some((o) => o.id === orgId)) setOrgId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [orgId]);

  useEffect(() => { if (userId) void reload(); }, [userId, reload]);
  useEffect(() => { try { if (orgId) localStorage.setItem(ORG_STORAGE, orgId); } catch { /* ignore */ } }, [orgId]);

  if (!ready) return null;
  if (!userId) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (location.pathname === "/console/join") {
    return (
      <SiteShell>
        <JoinPage onJoined={(o) => { setOrgs((cur) => [...(cur ?? []).filter((x) => x.id !== o.id), o]); setOrgId(o.id); }} />
      </SiteShell>
    );
  }

  const org = orgs?.find((o) => o.id === orgId) ?? null;

  return (
    <SiteShell wide>
      {error ? <div className="vz-alert err" style={{ marginTop: 20 }}>{error}</div> : null}
      {orgs && orgs.length === 0 ? (
        <CreateOrg onCreated={(o) => { setOrgs([o]); setOrgId(o.id); }} />
      ) : (
        <div className="vz-console">
          <aside className="vz-side">
            <div className="group">Organization</div>
            <select
              className="vz-input"
              style={{ height: 38, marginBottom: 8 }}
              value={orgId ?? ""}
              onChange={(e) => setOrgId(e.target.value)}
              aria-label="Organization"
            >
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <div className="group">Console</div>
            <NavLink to="/console" end className={({ isActive }) => (isActive ? "active" : "")}><LayoutDashboard size={15} /> Overview</NavLink>
            <NavLink to="/console/keys" className={({ isActive }) => (isActive ? "active" : "")}><KeyRound size={15} /> API keys</NavLink>
            <NavLink to="/console/verify" className={({ isActive }) => (isActive ? "active" : "")}><Fingerprint size={15} /> Verify</NavLink>
            <NavLink to="/console/webhooks" className={({ isActive }) => (isActive ? "active" : "")}><Webhook size={15} /> Webhooks</NavLink>
            <NavLink to="/console/usage" className={({ isActive }) => (isActive ? "active" : "")}><Activity size={15} /> Usage</NavLink>
            <NavLink to="/console/audit" className={({ isActive }) => (isActive ? "active" : "")}><ScrollText size={15} /> Audit log</NavLink>
            <NavLink to="/console/agents" className={({ isActive }) => (isActive ? "active" : "")}><Bot size={15} /> Agents</NavLink>
            <div className="group">Organization</div>
            <NavLink to="/console/members" className={({ isActive }) => (isActive ? "active" : "")}><Users size={15} /> Members</NavLink>
            <NavLink to="/console/billing" className={({ isActive }) => (isActive ? "active" : "")}><CreditCard size={15} /> Billing</NavLink>
          </aside>
          <section>
            {org ? (
              <Routes>
                <Route index element={<Overview org={org} />} />
                <Route path="keys" element={<Keys org={org} />} />
                <Route path="verify" element={<VerifyPage org={org} />} />
                <Route path="webhooks" element={<WebhooksPage org={org} />} />
                <Route path="usage" element={<Usage org={org} />} />
                <Route path="audit" element={<Audit org={org} />} />
                <Route path="agents" element={<Agents org={org} />} />
                <Route path="members" element={<MembersPage org={org} onChanged={() => void reload()} />} />
                <Route path="billing" element={<BillingPage org={org} onChanged={() => void reload()} />} />
                <Route path="*" element={<Navigate to="/console" replace />} />
              </Routes>
            ) : (
              <p className="vz-muted">Loading…</p>
            )}
          </section>
        </div>
      )}
    </SiteShell>
  );
}

function CreateOrg({ onCreated }: { onCreated: (o: Org) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onCreated(await createOrg(name.trim(), slug || slugFromName(name)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="vz-hero" style={{ maxWidth: 480, margin: "0 auto" }}>
      <span className="vz-eyebrow">One more step</span>
      <h1 className="vz-h2">Name your organization.</h1>
      <p className="vz-p">Keys, assets, repositories, and audit logs belong to an organization. You can invite teammates later.</p>
      <form onSubmit={submit} className="vz-card" style={{ display: "grid", gap: 14 }}>
        <div>
          <label className="vz-label" htmlFor="org-name">Organization name</label>
          <input id="org-name" className="vz-input" required minLength={2} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSlug(slugFromName(e.target.value)); }} />
        </div>
        <div>
          <label className="vz-label" htmlFor="org-slug">Slug</label>
          <input id="org-slug" className="vz-input vz-mono" required value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" />
        </div>
        {err ? <div className="vz-alert err">{err}</div> : null}
        <button className="vz-btn vz-btn-primary" disabled={busy}>{busy ? "Creating…" : "Create organization"}</button>
      </form>
    </section>
  );
}

function Head({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="vz-page-head">
      <div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
      {action}
    </div>
  );
}

function Overview({ org }: { org: Org }) {
  const [c, setC] = useState<{ assets: number; issuances: number; repos: number; commits: number } | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; length: number; first_bad_seq: number | null } | null>(null);
  const [u, setU] = useState<UsageRow[]>([]);
  useEffect(() => {
    void counts(org.id).then(setC).catch(() => setC(null));
    void chainStatus(org.id).then(setChain);
    void usage(org.id, 30).then(setU).catch(() => setU([]));
  }, [org.id]);
  const calls30 = u.reduce((s, r) => s + Number(r.calls), 0);
  return (
    <>
      <Head title={org.name} sub={`${org.slug} · ${org.plan} plan`} action={<NavLink to="/console/keys" className="vz-btn vz-btn-primary vz-btn-sm"><Plus size={14} /> New key</NavLink>} />
      <div className="vz-grid vz-grid-4">
        <div className="vz-card"><div className="vz-stat">{c?.assets ?? "—"}<small>Provenance assets</small></div></div>
        <div className="vz-card"><div className="vz-stat">{c?.issuances ?? "—"}<small>Issued copies</small></div></div>
        <div className="vz-card"><div className="vz-stat">{c?.repos ?? "—"}<small>Vault repositories</small></div></div>
        <div className="vz-card"><div className="vz-stat">{c?.commits ?? "—"}<small>Commits</small></div></div>
      </div>
      <div className="vz-grid vz-grid-2" style={{ marginTop: 16 }}>
        <div className="vz-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck size={18} style={{ color: chain?.ok === false ? "var(--vz-rose)" : "var(--vz-mint)" }} />
            <h3 className="vz-h3" style={{ margin: 0 }}>Ledger integrity</h3>
          </div>
          <p className="vz-p" style={{ marginTop: 8 }}>
            {chain === null ? "Verifying…" : chain.ok ? `Chain of ${chain.length} events verifies end to end.` : `Chain broken at sequence ${chain.first_bad_seq}. Contact support with this number.`}
          </p>
        </div>
        <div className="vz-card">
          <h3 className="vz-h3">Last 30 days</h3>
          <div className="vz-stat">{calls30.toLocaleString()}<small>API calls</small></div>
          <NavLink to="/console/usage" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 10 }}>View usage</NavLink>
        </div>
      </div>
      <div className="vz-card" style={{ marginTop: 16 }}>
        <h3 className="vz-h3">First call</h3>
        <Code title="whoami" code={`curl https://vybz.cloud/v1/me -H "Authorization: Bearer vybz_live_…"`} />
      </div>
    </>
  );
}

function Keys({ org }: { org: Org }) {
  const [rows, setRows] = useState<ApiKeyRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => listKeys(org.id).then(setRows).catch((e) => setErr(String(e.message ?? e))), [org.id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <Head title="API keys" sub="Keys authenticate the API and MCP. The plaintext is shown once." action={<button className="vz-btn vz-btn-primary vz-btn-sm" onClick={() => { setOpen(true); setCreated(null); }}><Plus size={14} /> New key</button>} />
      {err ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{err}</div> : null}
      {created ? <RevealKey k={created} onDone={() => setCreated(null)} /> : null}
      {open ? <NewKey org={org} onClose={() => setOpen(false)} onCreated={(k) => { setCreated(k); setOpen(false); void load(); }} /> : null}
      <div className="vz-table-wrap">
        <table className="vz-table">
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Limit</th><th>Last used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={7} className="vz-muted">Loading…</td></tr> : null}
            {rows?.length === 0 ? <tr><td colSpan={7} className="vz-muted">No keys yet. Create one to start.</td></tr> : null}
            {rows?.map((k) => (
              <tr key={k.id} style={{ opacity: k.revoked_at ? 0.5 : 1 }}>
                <td>{k.name}</td>
                <td className="vz-mono">{k.prefix}…</td>
                <td>{k.scopes.map((s) => <span key={s} className="vz-pill" style={{ marginRight: 4, marginBottom: 4 }}>{s}</span>)}</td>
                <td className="vz-mono">{k.rate_limit_per_min}/min</td>
                <td className="vz-muted">{fmtDate(k.last_used_at)}</td>
                <td>{k.revoked_at ? <span className="vz-pill rose">Revoked</span> : k.expires_at && new Date(k.expires_at) < new Date() ? <span className="vz-pill">Expired</span> : <span className="vz-pill mint">Active</span>}</td>
                <td style={{ textAlign: "right" }}>
                  {!k.revoked_at ? (
                    <button className="vz-btn vz-btn-danger vz-btn-sm" onClick={() => { if (confirm(`Revoke "${k.name}"? Agents using it stop immediately.`)) void revokeKey(k.id).then(load).catch((e) => setErr(String(e.message ?? e))); }}>Revoke</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewKey({ org, onClose, onCreated }: { org: Org; onClose: () => void; onCreated: (k: CreatedKey) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["org:read", "provenance:read", "provenance:write", "vault:read", "vault:write"]);
  const [rate, setRate] = useState(300);
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function toggle(s: string) { setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      onCreated(await createKey(org.id, name.trim(), scopes, rate, expires ? new Date(expires).toISOString() : null));
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="vz-card vz-card-accent" style={{ marginBottom: 16, display: "grid", gap: 14 }}>
      <h3 className="vz-h3">New API key</h3>
      <div className="vz-grid vz-grid-2">
        <div>
          <label className="vz-label" htmlFor="k-name">Name</label>
          <input id="k-name" className="vz-input" required maxLength={80} placeholder="Production · catalog service" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="vz-grid vz-grid-2">
          <div>
            <label className="vz-label" htmlFor="k-rate">Rate limit / min</label>
            <input id="k-rate" className="vz-input" type="number" min={1} max={100000} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </div>
          <div>
            <label className="vz-label" htmlFor="k-exp">Expires</label>
            <input id="k-exp" className="vz-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>
      </div>
      <div>
        <span className="vz-label">Scopes</span>
        <div className="vz-grid vz-grid-3">
          {SCOPES.map((s) => (
            <label key={s.id} className="vz-check">
              <input type="checkbox" checked={scopes.includes(s.id)} onChange={() => toggle(s.id)} />
              <span><b style={{ display: "block", fontSize: 13, color: "var(--vz-text)" }}>{s.label}</b><span className="vz-muted" style={{ fontSize: 12 }}>{s.hint}</span></span>
            </label>
          ))}
        </div>
      </div>
      {err ? <div className="vz-alert err">{err}</div> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="vz-btn vz-btn-primary" disabled={busy || scopes.length === 0}>{busy ? "Creating…" : "Create key"}</button>
        <button type="button" className="vz-btn vz-btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function RevealKey({ k, onDone }: { k: CreatedKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="vz-card vz-card-accent" style={{ marginBottom: 16 }}>
      <h3 className="vz-h3">Copy your key now</h3>
      <p className="vz-p">This is the only time it is shown. Store it in a secret manager. If lost, revoke it and create another.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input className="vz-input vz-mono" readOnly value={k.key} onFocus={(e) => e.currentTarget.select()} />
        <button className="vz-btn vz-btn-primary" onClick={() => { void navigator.clipboard?.writeText(k.key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 12 }} onClick={onDone}>I have stored it</button>
    </div>
  );
}

function Usage({ org }: { org: Org }) {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  useEffect(() => { void usage(org.id, 30).then(setRows).catch(() => setRows([])); }, [org.id]);
  const totals = useMemo(() => {
    const t = { provenance: 0, vault: 0, platform: 0, in: 0, out: 0 };
    for (const r of rows ?? []) { t[r.product] += Number(r.calls); t.in += Number(r.bytes_in); t.out += Number(r.bytes_out); }
    return t;
  }, [rows]);
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.day, (m.get(r.day) ?? 0) + Number(r.calls));
    return [...m.entries()];
  }, [rows]);
  const max = Math.max(1, ...byDay.map(([, v]) => v));
  return (
    <>
      <Head title="Usage" sub="Last 30 days. Metered products: issuances, detections, unique stored bytes." />
      <div className="vz-grid vz-grid-4">
        <div className="vz-card"><div className="vz-stat">{totals.provenance.toLocaleString()}<small>Provenance calls</small></div></div>
        <div className="vz-card"><div className="vz-stat">{totals.vault.toLocaleString()}<small>Vault calls</small></div></div>
        <div className="vz-card"><div className="vz-stat">{fmtBytes(totals.in)}<small>Ingress</small></div></div>
        <div className="vz-card"><div className="vz-stat">{fmtBytes(totals.out)}<small>Egress</small></div></div>
      </div>
      <div className="vz-card" style={{ marginTop: 16 }}>
        <h3 className="vz-h3">Calls per day</h3>
        {byDay.length === 0 ? <p className="vz-muted">No traffic yet.</p> : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140 }} role="img" aria-label="Calls per day">
            {byDay.map(([d, v]) => (
              <div key={d} title={`${d}: ${v}`} style={{ flex: 1, height: `${Math.max(3, (v / max) * 100)}%`, background: "linear-gradient(180deg, #4fd6ff, var(--vz-cyan))", borderRadius: 4, opacity: 0.85 }} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Audit({ org }: { org: Org }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => { void audit(org.id, 200).then(setRows).catch(() => setRows([])); }, [org.id]);
  return (
    <>
      <Head title="Audit log" sub="Every API and agent call, newest first. Request ids match the X-Request-Id header." />
      <div className="vz-table-wrap">
        <table className="vz-table">
          <thead><tr><th>Time</th><th>Call</th><th>Status</th><th>ms</th><th>In / Out</th><th>Agent</th><th>Request</th></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={7} className="vz-muted">Loading…</td></tr> : null}
            {rows?.length === 0 ? <tr><td colSpan={7} className="vz-muted">Nothing yet. Make a call with a key.</td></tr> : null}
            {rows?.map((r) => (
              <tr key={r.seq}>
                <td className="vz-muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                <td className="vz-mono"><b>{r.method}</b> {r.path}</td>
                <td><span className={`vz-pill ${r.status < 300 ? "mint" : r.status < 500 ? "" : "rose"}`}>{r.status}</span></td>
                <td className="vz-mono">{r.duration_ms ?? "—"}</td>
                <td className="vz-mono vz-muted">{fmtBytes(Number(r.bytes_in ?? 0))} / {fmtBytes(Number(r.bytes_out ?? 0))}</td>
                <td className="vz-muted" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.agent ?? "—"}</td>
                <td className="vz-mono vz-muted">{r.request_id?.slice(0, 8) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Agents({ org }: { org: Org }) {
  const [tab, setTab] = useState<"claude" | "cursor" | "code" | "http">("claude");
  const snippets: Record<typeof tab, { title: string; lang: "json" | "bash"; code: string }> = {
    claude: {
      title: "claude_desktop_config.json",
      lang: "json",
      code: `{
  "mcpServers": {
    "vybz": {
      "command": "npx",
      "args": ["-y", "@vybz/mcp-server"],
      "env": { "VYBZ_API_KEY": "vybz_live_…", "VYBZ_ROOTS": "D:/Projects" }
    }
  }
}`,
    },
    cursor: {
      title: ".cursor/mcp.json",
      lang: "json",
      code: `{
  "mcpServers": {
    "vybz": {
      "url": "https://vybz.cloud/api/mcp",
      "headers": { "Authorization": "Bearer vybz_live_…" }
    }
  }
}`,
    },
    code: {
      title: "claude code",
      lang: "bash",
      code: `claude mcp add --transport http vybz https://vybz.cloud/api/mcp \\
  --header "Authorization: Bearer vybz_live_…"`,
    },
    http: {
      title: "any llm",
      lang: "bash",
      code: `# Give the model these two documents and a key; it can call the API directly.
curl https://vybz.cloud/v1/openapi.json
curl https://vybz.cloud/llms.txt`,
    },
  };
  const s = snippets[tab];
  return (
    <>
      <Head title="Agents" sub={`Connect an assistant to ${org.name}. Use a key scoped to what the agent should be able to do.`} />
      <div className="vz-card">
        <div className="vz-tabs">
          {(["claude", "cursor", "code", "http"] as const).map((t) => (
            <button key={t} type="button" className={`vz-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {{ claude: "Claude Desktop", cursor: "Cursor", code: "Claude Code", http: "OpenAPI / llms.txt" }[t]}
            </button>
          ))}
        </div>
        <Code title={s.title} lang={s.lang} code={s.code} />
        <p className="vz-p" style={{ marginTop: 14 }}>
          Local mode adds folder workflows: <span className="vz-mono">vault_commit_folder</span>, <span className="vz-mono">vault_status</span>, <span className="vz-mono">vault_restore</span>. Hosted mode accepts URLs and base64 for files.
        </p>
      </div>
    </>
  );
}
