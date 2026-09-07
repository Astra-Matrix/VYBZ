// Account avatar in the header. Click opens a menu with the organization
// switcher, the console sections that belong to the account, and sign out.
// Keyboard: Enter or Space opens, arrows move, Escape closes, Tab leaves.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LayoutDashboard, KeyRound, CreditCard, Users, ShieldCheck, Gift, BookOpen, LogOut, ChevronsUpDown, Check } from "lucide-react";
import { useSession } from "@/store/session";
import { listOrgs, type Org } from "@/console/consoleApi";

export const ORG_STORAGE = "vybz.console.org";
export const ORG_EVENT = "vybz:org";

export function initials(email: string | null): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return (s || "?").toUpperCase();
}

export function AccountMenu() {
  const { email, signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(() => { try { return localStorage.getItem(ORG_STORAGE); } catch { return null; } });
  const [switching, setSwitching] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLElement[]>([]);

  useEffect(() => {
    if (!open || orgs) return;
    listOrgs().then(setOrgs).catch(() => setOrgs([]));
  }, [open, orgs]);

  useEffect(() => {
    const onOrg = (e: Event) => setOrgId((e as CustomEvent<string>).detail);
    window.addEventListener(ORG_EVENT, onOrg);
    return () => window.removeEventListener(ORG_EVENT, onOrg);
  }, []);

  const close = useCallback(() => { setOpen(false); setSwitching(false); }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); (root.current?.querySelector("button") as HTMLElement | null)?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = items.current.filter(Boolean);
        const i = list.indexOf(document.activeElement as HTMLElement);
        const n = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[n]?.focus();
      }
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, close]);

  const current = orgs?.find((o) => o.id === orgId) ?? null;

  function pickOrg(o: Org) {
    try { localStorage.setItem(ORG_STORAGE, o.id); } catch { /* ignore */ }
    setOrgId(o.id);
    window.dispatchEvent(new CustomEvent(ORG_EVENT, { detail: o.id }));
    close();
    navigate("/console");
  }

  let idx = 0;
  const reg = (el: HTMLElement | null) => { if (el) items.current[idx++] = el; };
  items.current = [];

  const links: Array<{ to: string; label: string; icon: React.ReactNode }> = [
    { to: "/console", label: "Console", icon: <LayoutDashboard size={15} /> },
    { to: "/console/keys", label: "API keys", icon: <KeyRound size={15} /> },
    { to: "/console/billing", label: "Billing", icon: <CreditCard size={15} /> },
    { to: "/console/members", label: "Members", icon: <Users size={15} /> },
    { to: "/console/security", label: "Security", icon: <ShieldCheck size={15} /> },
    { to: "/console/referrals", label: "Referrals", icon: <Gift size={15} /> },
    { to: "/docs", label: "Documentation", icon: <BookOpen size={15} /> },
  ];

  return (
    <div className="vz-account" ref={root}>
      <button
        type="button"
        className="vz-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${email ?? "you"}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vz-avatar-ring" aria-hidden />
        <span className="vz-avatar-text">{initials(email)}</span>
      </button>
      {open ? (
        <div className="vz-menu" role="menu" aria-label="Account">
          <div className="vz-menu-head">
            <div className="vz-avatar vz-avatar-lg" aria-hidden><span className="vz-avatar-ring" /><span className="vz-avatar-text">{initials(email)}</span></div>
            <div style={{ minWidth: 0 }}>
              <div className="vz-menu-email" title={email ?? ""}>{email}</div>
              <div className="vz-muted" style={{ fontSize: 12 }}>{current ? `${current.name} · ${current.plan}` : orgs ? "No organization selected" : "Loading…"}</div>
            </div>
          </div>

          <button type="button" role="menuitem" className="vz-menu-item" ref={reg} onClick={() => setSwitching((v) => !v)} aria-expanded={switching}>
            <ChevronsUpDown size={15} /> Switch organization
          </button>
          {switching ? (
            <div className="vz-menu-sub" role="group" aria-label="Organizations">
              {(orgs ?? []).map((o) => (
                <button key={o.id} type="button" role="menuitemradio" aria-checked={o.id === orgId} className="vz-menu-item" ref={reg} onClick={() => pickOrg(o)}>
                  {o.id === orgId ? <Check size={14} /> : <span style={{ width: 14 }} />} {o.name}
                </button>
              ))}
              {orgs && orgs.length === 0 ? <div className="vz-muted" style={{ padding: "8px 12px", fontSize: 12.5 }}>No organizations yet.</div> : null}
            </div>
          ) : null}

          <div className="vz-menu-sep" role="separator" />
          {links.map((l) => (
            <Link key={l.to} to={l.to} role="menuitem" className="vz-menu-item" ref={reg as unknown as React.Ref<HTMLAnchorElement>} onClick={close}>
              {l.icon} {l.label}
            </Link>
          ))}
          <div className="vz-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="vz-menu-item danger" ref={reg} onClick={() => { close(); void signOut().then(() => navigate("/")); }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
