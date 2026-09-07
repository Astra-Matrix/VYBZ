import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Check, ShieldCheck, ArrowUpRight } from "lucide-react";
import { useSession } from "@/store/session";
import {
  type BillingStatus,
  type InviteRow,
  type MemberRow,
  type Org,
  type UsageReportRow,
  billingCheckout,
  billingPortal,
  billingStatus,
  fmtBytes,
  fmtDate,
  fmtMoney,
  fmtMonth,
  inviteAccept,
  openPaddleCheckout,
  inviteCreate,
  inviteRevoke,
  invites,
  memberRemove,
  memberSetRole,
  usageReports,
  members,
} from "./consoleApi";

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="vz-page-head">
      <div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

export function MembersPage({ org, onChanged }: { org: Org; onChanged: () => void }) {
  const { userId } = useSession();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [inv, setInv] = useState<InviteRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([members(org.id), invites(org.id)]);
      setRows(m);
      setInv(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [org.id]);
  useEffect(() => { void load(); }, [load]);

  const me = rows?.find((r) => r.user_id === userId);
  const canAdmin = me?.role === "owner" || me?.role === "admin";

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await inviteCreate(org.id, email.trim(), role);
      setLink({ email: r.email, url: `${window.location.origin}/console/join?token=${encodeURIComponent(r.token)}` });
      setEmail("");
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); } finally { setBusy(false); }
  }

  return (
    <>
      <Head title="Members" sub={`People who can open ${org.name} in the console. Keys and agents are separate.`} />
      {err ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{err}</div> : null}
      {canAdmin ? (
        <form onSubmit={invite} className="vz-card" style={{ marginBottom: 16, display: "grid", gap: 12 }}>
          <h3 className="vz-h3">Invite someone</h3>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px auto", gap: 10, alignItems: "end" }}>
            <div>
              <label className="vz-label" htmlFor="inv-email">Work email</label>
              <input id="inv-email" className="vz-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </div>
            <div>
              <label className="vz-label" htmlFor="inv-role">Role</label>
              <select id="inv-role" className="vz-input" value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button className="vz-btn vz-btn-primary" disabled={busy}>{busy ? "Creating…" : "Create invite"}</button>
          </div>
          {link ? (
            <div className="vz-alert info">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Invite link for {link.email}. Send it yourself; it expires in 14 days and works once.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="vz-input vz-mono" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="vz-btn vz-btn-ghost" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          ) : null}
          <p className="vz-muted" style={{ fontSize: 12, margin: 0 }}>Admins manage keys, members, and billing. Members can read everything in the console.</p>
        </form>
      ) : null}

      <div className="vz-table-wrap" style={{ marginBottom: 16 }}>
        <table className="vz-table">
          <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={4} className="vz-muted">Loading…</td></tr> : null}
            {rows?.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email}{m.user_id === userId ? <span className="vz-muted"> (you)</span> : null}</td>
                <td>
                  {m.role === "owner" || !canAdmin ? (
                    <span className={`vz-pill ${m.role === "owner" ? "cyan" : ""}`}>{m.role}</span>
                  ) : (
                    <select className="vz-input" style={{ height: 32, width: 130 }} value={m.role} onChange={(e) => void memberSetRole(org.id, m.user_id, e.target.value as "admin" | "member").then(load).catch((x) => setErr(String(x.message ?? x)))}>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
                </td>
                <td className="vz-muted">{fmtDate(m.created_at)}</td>
                <td style={{ textAlign: "right" }}>
                  {m.role !== "owner" && (canAdmin || m.user_id === userId) ? (
                    <button className="vz-btn vz-btn-danger vz-btn-sm" onClick={() => { if (confirm(`Remove ${m.email} from ${org.name}?`)) void memberRemove(org.id, m.user_id).then(() => { void load(); onChanged(); }).catch((x) => setErr(String(x.message ?? x))); }}>
                      {m.user_id === userId ? "Leave" : "Remove"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inv.length ? (
        <>
          <h3 className="vz-h3">Invites</h3>
          <div className="vz-table-wrap">
            <table className="vz-table">
              <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {inv.map((i) => {
                  const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
                  return (
                    <tr key={i.id} style={{ opacity: state === "pending" ? 1 : 0.55 }}>
                      <td>{i.email}</td>
                      <td><span className="vz-pill">{i.role}</span></td>
                      <td><span className={`vz-pill ${state === "pending" ? "mint" : state === "accepted" ? "cyan" : ""}`}>{state}</span></td>
                      <td className="vz-muted">{fmtDate(i.expires_at)}</td>
                      <td style={{ textAlign: "right" }}>
                        {state === "pending" && canAdmin ? <button className="vz-btn vz-btn-danger vz-btn-sm" onClick={() => void inviteRevoke(i.id).then(load)}>Revoke</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

// ── Join ────────────────────────────────────────────────────────────────────

export function JoinPage({ onJoined }: { onJoined: (o: Org) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>("");
  async function accept() {
    setState("busy");
    try {
      const o = await inviteAccept(token);
      onJoined(o);
      setState("done");
      setMsg(o.name);
      setTimeout(() => navigate("/console", { replace: true }), 900);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section className="vz-hero" style={{ maxWidth: 480, margin: "0 auto" }}>
      <span className="vz-eyebrow">Invitation</span>
      <h1 className="vz-h2">Join an organization.</h1>
      <div className="vz-card" style={{ display: "grid", gap: 12 }}>
        {!token ? <div className="vz-alert err">This link is missing its token. Ask for a new invite.</div> : null}
        {state === "error" ? <div className="vz-alert err">{msg}</div> : null}
        {state === "done" ? <div className="vz-alert ok">You are now a member of {msg}. Opening the console…</div> : null}
        <p className="vz-p" style={{ margin: 0 }}>Accepting adds this account to the organization with the role set by the person who invited you.</p>
        <button className="vz-btn vz-btn-primary" disabled={!token || state === "busy" || state === "done"} onClick={() => void accept()}>
          {state === "busy" ? "Joining…" : "Accept invitation"}
        </button>
        <Link to="/console" className="vz-btn vz-btn-ghost vz-btn-sm">Not now</Link>
      </div>
    </section>
  );
}

// ── Billing ─────────────────────────────────────────────────────────────────

function Meter({ label, used, limit, fmt = (n: number) => n.toLocaleString() }: { label: string; used: number; limit: number; fmt?: (n: number) => string }) {
  const unlimited = limit >= 9e18;
  const pct = unlimited ? 0 : Math.min(100, (used / Math.max(limit, 1)) * 100);
  return (
    <div className="vz-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="vz-label" style={{ margin: 0 }}>{label}</span>
        <span className="vz-mono vz-muted">{fmt(used)} / {unlimited ? "∞" : fmt(limit)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,.08)", marginTop: 10, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct > 90 ? "var(--vz-rose)" : "linear-gradient(90deg,#4fd6ff,var(--vz-cyan))" }} />
      </div>
    </div>
  );
}

export function BillingPage({ org, onChanged }: { org: Org; onChanged: () => void }) {
  const [params] = useSearchParams();
  const [st, setSt] = useState<BillingStatus | null>(null);
  const [reports, setReports] = useState<UsageReportRow[] | null>(null);
  useEffect(() => { usageReports(org.id).then(setReports).catch(() => setReports([])); }, [org.id]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => billingStatus(org.id).then(setSt).catch((e) => setErr(e instanceof Error ? e.message : String(e))), [org.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (params.get("checkout") === "success") { const t = setTimeout(() => { void load(); onChanged(); }, 2500); return () => clearTimeout(t); } }, [params, load, onChanged]);

  async function go(fn: () => Promise<{ url: string | null }>) {
    setBusy(true); setErr(null);
    try {
      const { url } = await fn();
      if (!url) throw new Error("No link was returned.");
      window.location.assign(url);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  async function upgrade() {
    setBusy(true); setErr(null);
    try {
      const start = await billingCheckout(org.id);
      if (start.provider === "paddle" && start.transaction_id && st?.paddle?.client_token) {
        await openPaddleCheckout(start.transaction_id, st.paddle, `${window.location.origin}/console/billing?checkout=success`);
        setBusy(false);
        return;
      }
      if (!start.url) throw new Error("Checkout is not configured yet.");
      window.location.assign(start.url);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  const plan = st?.plan ?? org.plan;
  const u = st?.usage;
  return (
    <>
      <Head title="Billing" sub="Plans meter issuances, detections, and unique stored bytes. Reads are free." />
      {params.get("checkout") === "success" ? <div className="vz-alert ok" style={{ marginBottom: 14 }}>Payment received. Your plan updates within a few seconds.</div> : null}
      {params.get("checkout") === "cancel" ? <div className="vz-alert info" style={{ marginBottom: 14 }}>Checkout cancelled. Nothing was charged.</div> : null}
      {err ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{err}</div> : null}

      <div className="vz-grid vz-grid-2" style={{ marginBottom: 16 }}>
        <div className="vz-card vz-card-accent">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck size={18} style={{ color: "var(--vz-cyan)" }} />
            <h3 className="vz-h3" style={{ margin: 0, textTransform: "capitalize" }}>{plan} plan</h3>
            {st?.billing?.status && st.billing.status !== "none" ? <span className={`vz-pill ${st.billing.status === "active" ? "mint" : "rose"}`}>{st.billing.status}</span> : null}
          </div>
          <p className="vz-p" style={{ marginTop: 8 }}>
            {plan === "developer" ? "Free. 250 issuances and 50 detections per month, 10 GB of storage. Hard limits." :
             plan === "business" ? "$249 per month. 10,000 issuances and 2,000 detections included, 1 TB of storage, then metered. Content Credentials with a CA-issued certificate." :
             "Custom agreement. Volume pricing, dedicated signing certificate, private deployment options."}
          </p>
          {st?.billing?.current_period_end ? <p className="vz-muted" style={{ fontSize: 12.5 }}>Current period ends {fmtDate(st.billing.current_period_end)}.</p> : null}
          {st?.provider === "paddle" ? <p className="vz-muted" style={{ fontSize: 12.5 }}>Payments and invoices are handled by Paddle, our merchant of record. Tax is calculated at checkout.</p> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {plan === "developer" ? <button className="vz-btn vz-btn-primary" disabled={busy} onClick={() => void upgrade()}>Upgrade to Business <ArrowUpRight size={15} /></button> : null}
            {st?.billing?.subscription_id ? <button className="vz-btn vz-btn-ghost" disabled={busy} onClick={() => void go(() => billingPortal(org.id))}>Manage subscription</button> : null}
            <a className="vz-btn vz-btn-ghost" href="mailto:sales@vybz.cloud?subject=VYBZ%20Enterprise">Talk to sales</a>
          </div>
        </div>
        <div className="vz-card">
          <h3 className="vz-h3">What is metered</h3>
          <ul className="vz-p" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Issuances: each watermarked copy created.</li>
            <li>Detections: each suspect file correlated.</li>
            <li>Storage: unique bytes across originals and Vault blobs.</li>
          </ul>
        </div>
      </div>

      {u ? (
        <div className="vz-grid vz-grid-3">
          <Meter label="Issuances this month" used={Number(u.issuances_month)} limit={Number(u.limit_issuances)} />
          <Meter label="Detections this month" used={Number(u.detections_month)} limit={Number(u.limit_detections)} />
          <Meter label="Stored bytes" used={Number(u.storage_bytes)} limit={Number(u.limit_storage)} fmt={fmtBytes} />
        </div>
      ) : null}

      <h3 className="vz-h3" style={{ marginTop: 24 }}>Usage history</h3>
      <p className="vz-muted" style={{ fontSize: 12.5, marginTop: 4, marginBottom: 10 }}>One report per closed month. Overage is billed on the first of the following month.</p>
      <div className="vz-table-wrap">
        <table className="vz-table">
          <thead><tr><th>Month</th><th>Plan</th><th>Issuances</th><th>Detections</th><th>Storage</th><th>Overage</th><th>Amount</th></tr></thead>
          <tbody>
            {reports === null ? <tr><td colSpan={7} className="vz-muted">Loading…</td></tr> : null}
            {reports?.length === 0 ? <tr><td colSpan={7} className="vz-muted">No closed months yet. The first report appears after this month ends{plan === "developer" ? "; developer plans are not metered and produce no reports" : ""}.</td></tr> : null}
            {reports?.map((r) => {
              const over: string[] = [];
              if (Number(r.over_issuances) > 0) over.push(`${Number(r.over_issuances).toLocaleString()} issuances`);
              if (Number(r.over_detections) > 0) over.push(`${Number(r.over_detections).toLocaleString()} detections`);
              if (Number(r.over_storage_gb) > 0) over.push(`${Number(r.over_storage_gb).toLocaleString()} GB`);
              return (
                <tr key={r.period}>
                  <td>{fmtMonth(r.period)}</td>
                  <td style={{ textTransform: "capitalize" }}>{r.plan}</td>
                  <td className="vz-mono">{Number(r.issuances).toLocaleString()}</td>
                  <td className="vz-mono">{Number(r.detections).toLocaleString()}</td>
                  <td className="vz-mono">{fmtBytes(Number(r.storage_bytes))}</td>
                  <td className="vz-muted">{over.length ? over.join(", ") : "None"}</td>
                  <td className="vz-mono">{Number(r.amount_cents) > 0 ? fmtMoney(Number(r.amount_cents)) : <span className="vz-muted">$0.00</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
