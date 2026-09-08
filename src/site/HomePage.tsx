import { Link } from "react-router-dom";
import { GitBranch, Bot, ArrowRight } from "lucide-react";
import { SiteShell } from "./SiteShell";

// A slow audio-like line drawn once behind the hero, in the three brand colors.
const SIGNAL = (() => {
  const pts: string[] = [];
  for (let x = 0; x <= 1400; x += 10) {
    const t = x / 1400;
    const env = Math.sin(t * Math.PI) ** 1.6;
    const y = 100 + env * (Math.sin(x * 0.021) * 46 + Math.sin(x * 0.0057 + 1.3) * 28 + Math.sin(x * 0.047 + 0.4) * 9);
    pts.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
})();

/** The proof: what a manager sees thirty seconds after dropping the leaked file in. */
function ReportPreview() {
  return (
    <div className="vz-report" role="figure" aria-label="Example leak report">
      <div className="vz-report-head">
        <span className="vz-report-mark" aria-hidden />
        <div>
          <div className="vz-report-kicker">Leak attribution report</div>
          <div className="vz-report-meta">2026-09-07 18:42 UTC · report 0b6c4e6e</div>
        </div>
        <span className="vz-pill violet" style={{ marginLeft: "auto" }}>High confidence</span>
      </div>
      <div className="vz-report-title">Attributed to editor@sync-house.com</div>
      <p className="vz-report-line">The file is altered audio derived from the registered original and carries the watermark issued to the recipient named above.</p>
      <dl className="vz-report-grid">
        <dt>Original</dt><dd>Midnight (final master) · ISRC US-XYZ-26-00001</dd>
        <dt>Copy issued</dt><dd>2026-09-03 14:00 UTC · preview license</dd>
        <dt>Submitted file</dt><dd>ripped-from-youtube.m4a · AAC 44.1 kHz · 41.8 s</dd>
        <dt>Fingerprint</dt><dd>Match, 91% · aligned at 41.2 s</dd>
        <dt>Watermark</dt><dd>Attributed · z = 37.1 · 6.2× the runner-up</dd>
        <dt>Integrity</dt><dd className="vz-mono">sha256 b7e1…4c09, same in JSON and PDF</dd>
      </dl>
    </div>
  );
}

export function HomePage() {
  return (
    <SiteShell>
      <section className="vz-hero">
        <svg className="vz-hero-signal" viewBox="0 0 1400 200" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="vz-signal-grad" x1="0" x2="1">
              <stop offset="0" stopColor="#00c2ff" stopOpacity="0" />
              <stop offset="0.35" stopColor="#00c2ff" stopOpacity="0.9" />
              <stop offset="0.65" stopColor="#8b7cff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#38e8b0" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={SIGNAL} />
        </svg>
        <div>
          <span className="vz-eyebrow pulse vz-reveal r1">Leak forensics for unreleased audio</span>
          <h1 className="vz-h1">
            <span className="line vz-reveal r2">Who leaked it?</span>
            <span className="line grad vz-reveal r3">Now you know.</span>
          </h1>
          <div className="vz-beam" aria-hidden />
          <p className="vz-lead vz-reveal r4">Every copy you send is marked to the person who got it. When it leaks, VYBZ names them.</p>
        </div>
        <div className="vz-reveal r5" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 26 }}>
          <Link to="/signin?mode=create" className="vz-btn vz-btn-primary">
            Protect a master <ArrowRight size={16} />
          </Link>
          <a href="mailto:sales@vybz.cloud?subject=VYBZ%20for%20our%20catalog" className="vz-btn vz-btn-ghost">Talk to us</a>
        </div>
      </section>

      <section className="vz-section" id="proof">
        <h2 className="vz-h2">The report you forward.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 22, alignItems: "start" }}>
          <ReportPreview />
          <div style={{ display: "grid", gap: 14 }}>
            <div className="vz-card"><h3 className="vz-h3">1. Register the master.</h3></div>
            <div className="vz-card"><h3 className="vz-h3">2. Send each person their own copy.</h3></div>
            <div className="vz-card"><h3 className="vz-h3">3. When it leaks, drop the file in.</h3></div>
            <p className="vz-p" style={{ margin: "4px 0 0" }}>Survives rips, re-encodes, and phone recordings. Inaudible. <Link to="/provenance">How it works</Link>.</p>
          </div>
        </div>
      </section>

      <section className="vz-section">
        <div className="vz-grid vz-grid-2">
          <div className="vz-card lift">
            <div className="vz-icon violet"><GitBranch size={18} /></div>
            <h3 className="vz-h3">Vault</h3>
            <p className="vz-p">Version control for the sessions behind the masters.</p>
            <Link to="/vault" className="vz-btn vz-btn-ghost vz-btn-sm">Explore Vault <ArrowRight size={14} /></Link>
          </div>
          <div className="vz-card lift">
            <div className="vz-icon mint"><Bot size={18} /></div>
            <h3 className="vz-h3">API and agents</h3>
            <p className="vz-p">Everything the console does, as REST and MCP.</p>
            <Link to="/docs" className="vz-btn vz-btn-ghost vz-btn-sm">Read the docs <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>

      <section className="vz-section" style={{ textAlign: "center" }}>
        <h2 className="vz-h2">Protect the next release before it goes out.</h2>
        <p className="vz-lead" style={{ margin: "0 auto" }}>From $9 a month. 14-day trial.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
          <Link to="/signin?mode=create" className="vz-btn vz-btn-primary">Protect a master</Link>
          <Link to="/pricing" className="vz-btn vz-btn-ghost">See pricing</Link>
        </div>
      </section>
    </SiteShell>
  );
}
