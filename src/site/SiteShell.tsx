import { type ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useSession } from "@/store/session";
import { applySeo, seoFor } from "./seo";
import { Backdrop } from "./Backdrop";
import { AccountMenu } from "./AccountMenu";
import { Menu, X } from "lucide-react";
import "./site.css";

const NAV = [
  { to: "/provenance", label: "Provenance" },
  { to: "/vault", label: "Vault" },
  { to: "/agents", label: "Agents" },
  { to: "/docs", label: "Docs" },
  { to: "/pricing", label: "Pricing" },
];

export function SiteShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { userId } = useSession();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    applySeo(seoFor(location.pathname));
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Cards carry a spotlight at the pointer (--mx/--my), and sections arrive as they scroll into view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.(".vz-card") as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sections = Array.from(el.querySelectorAll<HTMLElement>(".vz-section"));
    let io: IntersectionObserver | null = null;
    if (reduced || typeof IntersectionObserver === "undefined") {
      sections.forEach((s) => s.classList.add("in"));
    } else {
      sections.forEach((s) => s.classList.add("vz-io"));
      io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io?.unobserve(en.target); }
      }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
      sections.forEach((s) => io!.observe(s));
    }
    return () => { el.removeEventListener("pointermove", onMove); io?.disconnect(); };
  }, [location.pathname]);

  return (
    <div className="vz" ref={root}>
      <a className="vz-skip" href="#main">Skip to content</a>
      <Backdrop />
      <div className="vz-backdrop" aria-hidden />
      <header className="vz-header">
        <div className="vz-wrap vz-header-inner">
          <Link to="/" className="vz-logo" aria-label="VYBZ home">
            <img className="vz-logo-mark" src="/brand/icon.svg" alt="" width={26} height={26} aria-hidden />
            VYBZ
          </Link>
          <nav className="vz-nav" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="vz-header-cta">
            {userId ? (
              <>
                <Link to="/console" className="vz-btn vz-btn-primary vz-btn-sm">Console</Link>
                <AccountMenu />
              </>
            ) : (
              <>
                <Link to="/signin" className="vz-btn vz-btn-ghost vz-btn-sm">Sign in</Link>
                <Link to="/signin?mode=create" className="vz-btn vz-btn-primary vz-btn-sm vz-hide-mobile">Get API key</Link>
              </>
            )}
            <button type="button" className="vz-burger" aria-label={navOpen ? "Close menu" : "Open menu"} aria-expanded={navOpen} aria-controls="vz-mobile-nav" onClick={() => setNavOpen((v) => !v)}>
              {navOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        <nav id="vz-mobile-nav" className={`vz-mobile-nav${navOpen ? " open" : ""}`} aria-label="Primary, mobile" hidden={!navOpen}>
          <div className="vz-wrap">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>{n.label}</NavLink>
            ))}
            {userId ? <NavLink to="/console" className={({ isActive }) => (isActive ? "active" : "")}>Console</NavLink> : <NavLink to="/signin?mode=create">Get API key</NavLink>}
          </div>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className={wide ? "vz-wrap" : "vz-wrap"} style={{ paddingBottom: 40 }}>{children}</main>
      <footer className="vz-footer">
        <div className="vz-wrap vz-footer-inner">
          <div className="vz-footer-links">
            <Link to="/docs">Docs</Link>
            <Link to="/docs/api">API</Link>
            <Link to="/docs/agents">MCP</Link>
            <Link to="/docs/security">Security</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/refunds">Refunds</Link>
            <Link to="/legal/acceptable-use">Acceptable use</Link>
            <Link to="/legal/accessibility">Accessibility</Link>
          </div>
          <div>© {new Date().getFullYear()} VYBZ · Andrew Laustrup</div>
        </div>
      </footer>
    </div>
  );
}

/** Tokenized code block with a copy button. Tokens: `//` comments, strings, numbers, keywords. */
export function Code({ title, code, lang = "bash" }: { title?: string; code: string; lang?: "bash" | "json" | "ts" | "py" }) {
  const [copied, setCopied] = useState(false);
  const html = highlight(code.trim(), lang);
  return (
    <div className="vz-code" role="figure" aria-label={title ?? "code"} tabIndex={0}>
      {title ? <span className="vz-code-title">{title}</span> : null}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code.trim()).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
        className="vz-btn vz-btn-ghost vz-btn-sm"
        style={{ position: "absolute", right: 12, bottom: 12, height: 26, padding: "0 9px", fontSize: 11 }}
        aria-label="Copy code"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(src: string, lang: string): string {
  const lines = src.split("\n").map((line) => {
    let out = esc(line);
    if (lang === "bash") {
      out = out.replace(/(^|\s)(#.*)$/, '$1<span class="c">$2</span>');
      out = out.replace(/(&quot;|")([^"]*)(&quot;|")/g, '<span class="s">"$2"</span>');
      out = out.replace(/'([^']*)'/g, '<span class="s">\'$1\'</span>');
      out = out.replace(/^(\s*)(curl|npx|npm|export|pip|python|node)\b/, '$1<span class="k">$2</span>');
      out = out.replace(/(\s)(-[-A-Za-z]+)/g, '$1<span class="n">$2</span>');
    } else if (lang === "json") {
      out = out.replace(/"([^"]+)"(\s*:)/g, '<span class="k">"$1"</span>$2');
      out = out.replace(/:\s*"([^"]*)"/g, ': <span class="s">"$1"</span>');
      out = out.replace(/\b(true|false|null|\d+(\.\d+)?)\b/g, '<span class="n">$1</span>');
    } else {
      out = out.replace(/(\/\/.*|#.*)$/, '<span class="c">$1</span>');
      out = out.replace(/"([^"]*)"|'([^']*)'|`([^`]*)`/g, (m) => `<span class="s">${m}</span>`);
      out = out.replace(/\b(const|let|await|async|import|from|return|function|def|with|as|open|print|export|new|if|for|of)\b/g, '<span class="k">$1</span>');
    }
    return out;
  });
  return lines.join("\n");
}
