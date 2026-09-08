import { Link } from "react-router-dom";
import { Fingerprint, GitBranch, Bot, ShieldCheck, FileCheck2, Lock, ArrowRight, Send, FileSearch, Building2, Users, Disc3 } from "lucide-react";
import { SiteShell, Code } from "./SiteShell";

const ISSUE = `curl -X POST https://vybz.cloud/v1/provenance/assets/ast_7f3…/issue \\
  -H "Authorization: Bearer $VYBZ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"recipient":"editor@sync-house.com","license":"preview"}' \\
  -o master-for-sync-house.wav`;

const REPORT = `curl -X POST https://vybz.cloud/v1/provenance/reports \\
  -H "Authorization: Bearer $VYBZ_API_KEY" \\
  --data-binary @ripped-from-youtube.m4a
# → { "verdict": "derived_copy", "confidence": "high",
#     "issuance": { "recipient": "editor@sync-house.com", … },
#     "links": { "pdf": "…/provenance/reports/0b6c4e6e.pdf" } }`;

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
          <p className="vz-lead vz-reveal r4">
            Every copy you send out carries an inaudible mark tied to the person who received it. When the track turns up where it should not,
            drop the file in. VYBZ names the recipient and hands you a report you can forward to a lawyer, a label head, or the partner who let it out.
          </p>
        </div>
        <div className="vz-reveal r5" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 26 }}>
          <Link to="/signin?mode=create" className="vz-btn vz-btn-primary">
            Protect a master <ArrowRight size={16} />
          </Link>
          <a href="#proof" className="vz-btn vz-btn-ghost">See it name a leak</a>
          <a href="mailto:sales@vybz.cloud?subject=VYBZ%20for%20our%20catalog" className="vz-btn vz-btn-ghost">Talk to us</a>
        </div>
        <div className="vz-reveal r5" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 26 }}>
          <span className="vz-pill cyan"><Fingerprint size={12} /> Survives rips, re-encodes, phone recordings</span>
          <span className="vz-pill cyan"><FileCheck2 size={12} /> Content Credentials on every copy</span>
          <span className="vz-pill"><Lock size={12} /> Originals never leave private storage</span>
        </div>
      </section>

      <section className="vz-section" id="proof">
        <span className="vz-eyebrow">The proof</span>
        <h2 className="vz-h2">Thirty seconds after the leak lands on your desk.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 22, alignItems: "start" }}>
          <ReportPreview />
          <div style={{ display: "grid", gap: 14 }}>
            <div className="vz-card">
              <div className="vz-icon"><Send size={18} /></div>
              <h3 className="vz-h3">1. Send copies from VYBZ instead of from your inbox.</h3>
              <p className="vz-p" style={{ margin: 0 }}>Register the master once. Add the people who need it, by name or email. Each gets a copy that sounds identical and is uniquely theirs.</p>
            </div>
            <div className="vz-card">
              <div className="vz-icon violet"><FileSearch size={18} /></div>
              <h3 className="vz-h3">2. When it leaks, drop the file in.</h3>
              <p className="vz-p" style={{ margin: 0 }}>A rip from a video, a phone recording in a club, a re-encoded MP3 from a forum. VYBZ identifies the original and correlates the mark against every copy you issued.</p>
            </div>
            <div className="vz-card">
              <div className="vz-icon mint"><ShieldCheck size={18} /></div>
              <h3 className="vz-h3">3. Forward the report.</h3>
              <p className="vz-p" style={{ margin: 0 }}>Recipient, confidence, every method that ran, and an integrity hash. PDF for people, JSON for systems. The same hash in both.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="vz-section">
        <span className="vz-eyebrow">Who it is for</span>
        <h2 className="vz-h2">Anyone who holds a catalog before the world does.</h2>
        <div className="vz-grid vz-grid-3" style={{ marginTop: 22 }}>
          {[
            { i: <Users size={18} />, t: "Managers", d: "Pre-release singles go to radio, playlists, press, and features. One leak burns a release plan. Issue every copy from VYBZ and know exactly who to call." },
            { i: <Disc3 size={18} />, t: "Labels and distributors", d: "Hundreds of recipients per release across promo, sync, and retail. Batch-issue fifty copies in one call, keep a ledger of who got what, and answer the leak question in minutes instead of weeks." },
            { i: <Building2 size={18} />, t: "Studios and sync houses", d: "Client sessions and library pitches leave the building every day. Protect what you send, prove what you delivered, and keep the trust that keeps the clients." },
          ].map((c) => (
            <div key={c.t} className="vz-card lift">
              <div className="vz-icon">{c.i}</div>
              <h3 className="vz-h3">{c.t}</h3>
              <p className="vz-p" style={{ margin: 0 }}>{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vz-section">
        <span className="vz-eyebrow">Why it holds up</span>
        <h2 className="vz-h2">Built to survive the internet, and to be believed.</h2>
        <div className="vz-grid vz-grid-4" style={{ marginTop: 22 }}>
          {[
            { t: "Inaudible", d: "A spread-spectrum mark 34 to 40 dB under the signal, shaped to the audio. Nobody hears it, including mastering engineers." },
            { t: "Robust", d: "Trimming, gain, re-encoding, and phone recordings shift the mark; they do not remove it. Attribution is blind: the original is never needed." },
            { t: "Honest", d: "An attribution is asserted only when the top candidate is decisively above the noise and the runner-up. Every report shows the numbers." },
            { t: "Tamper-evident", d: "Register, issue, verify, and detect events are hash-chained per organization. Reports carry an integrity hash, in PDF and JSON alike." },
          ].map((f) => (
            <div key={f.t} className="vz-card">
              <h3 className="vz-h3">{f.t}</h3>
              <p className="vz-p" style={{ margin: 0 }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vz-section">
        <span className="vz-eyebrow violet">Once the catalog is protected</span>
        <h2 className="vz-h2">Keep the sessions in the same place.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 22 }}>
          <div className="vz-card vz-card-accent lift">
            <div className="vz-icon violet"><GitBranch size={18} /></div>
            <span className="vz-eyebrow violet">Vault</span>
            <h3 className="vz-h3" style={{ marginTop: 8 }}>Version control for DAW projects and sample libraries.</h3>
            <p className="vz-p">
              Commit whole project folders. Bytes are stored once per organization, so a 40 GB catalog with shared samples costs a fraction of its size.
              Branch, diff, and restore any session to any moment. The masters you protect and the sessions they came from, together.
            </p>
            <Link to="/vault" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 8 }}>Explore Vault <ArrowRight size={14} /></Link>
          </div>
          <div className="vz-card lift">
            <div className="vz-icon mint"><Bot size={18} /></div>
            <span className="vz-eyebrow" style={{ color: "var(--vz-mint)" }}>Agents and API</span>
            <h3 className="vz-h3" style={{ marginTop: 8 }}>When your tools should do it for you.</h3>
            <p className="vz-p">
              Everything the console does is a REST call and an MCP tool. Issue a hundred promo copies from a spreadsheet, attribute a takedown
              notice from a chat window, snapshot a session after every save. Claude, Cursor, and any MCP client connect with one key.
            </p>
            <Link to="/agents" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 8 }}>Agent setup <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>

      <section className="vz-section">
        <span className="vz-eyebrow">For the technical reader</span>
        <h2 className="vz-h2">Two calls. Issue a copy, then name the leak.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 22 }}>
          <Code title="issue" code={ISSUE} />
          <Code title="report" code={REPORT} />
        </div>
      </section>

      <section className="vz-section" style={{ textAlign: "center" }}>
        <h2 className="vz-h2">Protect the next release before it goes out.</h2>
        <p className="vz-lead" style={{ margin: "0 auto" }}>Manager from $9 a month, Label from $85, Catalog from $245. Every plan starts with a 14-day trial. Building an integration? Developer is free.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
          <Link to="/signin?mode=create" className="vz-btn vz-btn-primary">Protect a master</Link>
          <Link to="/pricing" className="vz-btn vz-btn-ghost">See pricing</Link>
        </div>
      </section>
    </SiteShell>
  );
}
