import { useEffect, useState } from "react";
import { Gift, Copy, Check } from "lucide-react";
import { fmtDate, referrals, type Org, type ReferralRow } from "./consoleApi";

export function ReferralsPage({ org }: { org: Org }) {
  const [rows, setRows] = useState<ReferralRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = `${typeof window !== "undefined" ? window.location.origin : "https://vybz.cloud"}/signin?mode=create&ref=${org.slug}`;

  useEffect(() => {
    referrals(org.id).then(setRows).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [org.id]);

  const converted = (rows ?? []).filter((r) => r.plan !== "developer").length;

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Referrals</h1>
          <p>Organizations that sign up through your link are recorded here. Rewards for referrals that convert to a paid plan are being finalised and will apply to referrals recorded from today.</p>
        </div>
      </div>
      {err ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{err}</div> : null}

      <div className="vz-grid vz-grid-2" style={{ marginBottom: 16 }}>
        <div className="vz-card vz-card-accent">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Gift size={18} style={{ color: "var(--vz-cyan)" }} /><h3 className="vz-h3" style={{ margin: 0 }}>Your link</h3></div>
          <p className="vz-p">Anyone who creates an account from this link and then an organization is attributed to {org.name}.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code className="vz-mono" style={{ flex: 1, overflow: "auto", padding: "8px 10px", border: "1px solid var(--vz-line)", borderRadius: 10 }}>{link}</code>
            <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="vz-card">
          <h3 className="vz-h3">So far</h3>
          <div className="vz-grid vz-grid-2">
            <div className="vz-stat">{rows ? rows.length : "…"}<small>organizations referred</small></div>
            <div className="vz-stat">{rows ? converted : "…"}<small>on a paid plan</small></div>
          </div>
        </div>
      </div>

      <div className="vz-table-wrap" tabIndex={0}>
        <table className="vz-table">
          <thead><tr><th>Organization</th><th>Plan</th><th>Joined</th></tr></thead>
          <tbody>
            {rows === null && !err ? <tr><td colSpan={3} className="vz-muted">Loading…</td></tr> : null}
            {rows?.length === 0 ? <tr><td colSpan={3} className="vz-muted">No referrals yet. Share the link with a studio or label that ships audio.</td></tr> : null}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td style={{ textTransform: "capitalize" }}>{r.plan}</td>
                <td className="vz-muted">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
