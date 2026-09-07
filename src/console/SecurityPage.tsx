import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, KeyRound, LogOut } from "lucide-react";
import { useSession } from "@/store/session";
import { supabase } from "@/lib/supabase";
import { listKeys, type Org } from "./consoleApi";

export function SecurityPage({ org }: { org: Org }) {
  const { email } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ active: number; total: number } | null>(null);

  useEffect(() => {
    listKeys(org.id).then((rows) => setKeys({ active: rows.filter((k) => !k.revoked_at).length, total: rows.length })).catch(() => setKeys(null));
  }, [org.id]);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (pw.length < 12) { setErr("Use at least 12 characters."); return; }
    if (pw !== pw2) { setErr("The two passwords do not match."); return; }
    if (!supabase) { setErr("Sign-in backend is not configured."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPw(""); setPw2("");
    setMsg("Password changed. Other devices keep their sessions until you sign them out below.");
  }

  async function signOutOthers() {
    if (!supabase) return;
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg("Every other device and browser has been signed out. This one stays signed in.");
  }

  return (
    <>
      <div className="vz-page-head">
        <div>
          <h1>Security</h1>
          <p>Your sign-in, your sessions, and the keys that act on this organization's behalf.</p>
        </div>
      </div>
      {msg ? <div className="vz-alert ok" style={{ marginBottom: 14 }}>{msg}</div> : null}
      {err ? <div className="vz-alert err" style={{ marginBottom: 14 }}>{err}</div> : null}

      <div className="vz-grid vz-grid-2">
        <form onSubmit={changePassword} className="vz-card" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><ShieldCheck size={18} style={{ color: "var(--vz-cyan)" }} /><h3 className="vz-h3" style={{ margin: 0 }}>Password</h3></div>
          <p className="vz-muted" style={{ fontSize: 12.5, margin: 0 }}>Signed in as <span className="vz-mono">{email}</span>. Twelve characters or more; a passphrase is easiest to keep.</p>
          <div>
            <label className="vz-label" htmlFor="sec-pw">New password</label>
            <input id="sec-pw" className="vz-input" type="password" autoComplete="new-password" minLength={12} required value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div>
            <label className="vz-label" htmlFor="sec-pw2">Repeat it</label>
            <input id="sec-pw2" className="vz-input" type="password" autoComplete="new-password" minLength={12} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="vz-btn vz-btn-primary vz-btn-sm" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
          </div>
        </form>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="vz-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><LogOut size={18} style={{ color: "var(--vz-violet)" }} /><h3 className="vz-h3" style={{ margin: 0 }}>Sessions</h3></div>
            <p className="vz-p">If a laptop was lost or a browser shared, sign out everywhere else. This browser stays signed in.</p>
            <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" disabled={busy} onClick={() => void signOutOthers()}>Sign out other devices</button>
          </div>
          <div className="vz-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><KeyRound size={18} style={{ color: "var(--vz-mint)" }} /><h3 className="vz-h3" style={{ margin: 0 }}>API keys</h3></div>
            <p className="vz-p">
              {keys ? `${keys.active} active ${keys.active === 1 ? "key" : "keys"} for ${org.name}${keys.total > keys.active ? `, ${keys.total - keys.active} revoked` : ""}.` : "Keys act with the scopes you gave them and appear in the audit log by prefix."}
              {" "}Revoke any key you cannot account for; agents using it stop immediately.
            </p>
            <Link to="/console/keys" className="vz-btn vz-btn-ghost vz-btn-sm">Manage keys</Link>
          </div>
        </div>
      </div>
    </>
  );
}
