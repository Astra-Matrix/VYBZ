import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "@/store/session";
import { SiteShell } from "./SiteShell";

export function SignInPage() {
  const { userId, signIn, signUp } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "create">(params.get("mode") === "create" ? "create" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nextRaw = params.get("next") ?? "";
  const next = nextRaw.startsWith("/") ? nextRaw : "/console";
  if (userId) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const fn = mode === "create" ? signUp : signIn;
    const { error } = await fn(email.trim(), password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    if (mode === "create") {
      setNotice("Account created. If email confirmation is required, confirm and then sign in.");
      setMode("signin");
      return;
    }
    navigate(next, { replace: true });
  }

  return (
    <SiteShell>
      <section className="vz-hero" style={{ maxWidth: 440, margin: "0 auto", paddingTop: 72 }}>
        <span className="vz-eyebrow">{mode === "create" ? "Create your organization" : "Welcome back"}</span>
        <h1 className="vz-h2">{mode === "create" ? "Get an API key in a minute." : "Sign in to the console."}</h1>
        <form onSubmit={submit} className="vz-card" style={{ marginTop: 18, display: "grid", gap: 14 }}>
          <div>
            <label className="vz-label" htmlFor="email">Work email</label>
            <input id="email" className="vz-input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="vz-label" htmlFor="password">Password</label>
            <input id="password" className="vz-input" type="password" autoComplete={mode === "create" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <div className="vz-alert err">{error}</div> : null}
          {notice ? <div className="vz-alert ok">{notice}</div> : null}
          <button type="submit" className="vz-btn vz-btn-primary" disabled={busy}>
            {busy ? "One moment…" : mode === "create" ? "Create account" : "Sign in"}
          </button>
          <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => setMode(mode === "create" ? "signin" : "create")}>
            {mode === "create" ? "I already have an account" : "I need an account"}
          </button>
          <p className="vz-muted" style={{ fontSize: 12, margin: 0 }}>
            By continuing you agree to the <Link to="/legal/terms" style={{ color: "var(--vz-text-2)" }}>Terms</Link> and{" "}
            <Link to="/legal/privacy" style={{ color: "var(--vz-text-2)" }}>Privacy Policy</Link>.
          </p>
        </form>
      </section>
    </SiteShell>
  );
}
