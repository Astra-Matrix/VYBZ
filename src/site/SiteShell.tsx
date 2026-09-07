import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useSession } from "@/store/session";
import { applySeo, seoFor } from "./seo";
import "./site.css";

const NAV = [
  { to: "/provenance", label: "Provenance" },
  { to: "/vault", label: "Vault" },
  { to: "/agents", label: "Agents" },
  { to: "/docs", label: "Docs" },
  { to: "/pricing", label: "Pricing" },
];

export function SiteShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { userId, signOut } = useSession();
  const location = useLocation();
  useEffect(() => {
    applySeo(seoFor(location.pathname));
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="vz">
      <a className="vz-skip" href="#main">Skip to content</a>
      <div className="vz-backdrop" aria-hidden />
      <header className="vz-header">
        <div className="vz-wrap vz-header-inner">
          <Link to="/" className="vz-logo" aria-label="VYBZ home">
            <span className="vz-logo-mark" aria-hidden />
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
                <button type="button" className="vz-btn vz-btn-ghost vz-btn-sm" onClick={() => void signOut()}>Sign out</button>
              </>
            ) : (
              <>
                <Link to="/signin" className="vz-btn vz-btn-ghost vz-btn-sm">Sign in</Link>
                <Link to="/signin?mode=create" className="vz-btn vz-btn-primary vz-btn-sm">Get API key</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={wide ? "vz-wrap" : "vz-wrap"} style={{ paddingBottom: 40 }}>{children}</main>
      <footer className="vz-footer">
        <div className="vz-wrap vz-footer-inner">
          <div>
            <Link to="/docs">Docs</Link>
            <Link to="/docs/api">API</Link>
            <Link to="/docs/agents">MCP</Link>
            <Link to="/docs/security">Security</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/legal/privacy">Privacy</Link>
            <Link to="/legal/acceptable-use">Acceptable use</Link>
            <Link to="/legal/accessibility">Accessibility</Link>
          </div>
          <div>© {new Date().getFullYear()} Astra Matrix, Inc. · VYBZ</div>
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
    <div className="vz-code" role="figure" aria-label={title ?? "code"}>
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
