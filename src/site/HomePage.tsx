import { Link } from "react-router-dom";
import { Fingerprint, GitBranch, Bot, ShieldCheck, Waves, FileCheck2, Search, Lock, Activity, ArrowRight } from "lucide-react";
import { SiteShell, Code } from "./SiteShell";

const ISSUE = `curl -X POST https://vybz.cloud/v1/provenance/assets/ast_7f3…/issue \\
  -H "Authorization: Bearer $VYBZ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"recipient":"sync-house@partner.com","license":"preview"}' \\
  -o master-for-partner.wav
# → X-VYBZ-Issuance-Id, X-VYBZ-Watermark-Id, X-VYBZ-C2PA: 1`;

const DETECT = `curl -X POST https://vybz.cloud/v1/provenance/assets/ast_7f3…/detect \\
  -H "Authorization: Bearer $VYBZ_API_KEY" \\
  --data-binary @leaked-from-youtube.wav
# → { "attributed": { "recipient": "sync-house@partner.com", "score": 0.41 },
#     "confidence": "high", "candidates": 212 }`;

const MCP = `{
  "mcpServers": {
    "vybz": {
      "command": "npx",
      "args": ["-y", "@vybz/mcp-server"],
      "env": { "VYBZ_API_KEY": "vybz_live_…" }
    }
  }
}`;

export function HomePage() {
  return (
    <SiteShell>
      <section className="vz-hero">
        <div className="vz-rise">
          <span className="vz-eyebrow">Audio infrastructure for businesses</span>
          <h1 className="vz-h1">
            Every copy traceable.
            <br />
            <span className="grad">Every session recoverable.</span>
          </h1>
          <p className="vz-lead">
            VYBZ is two APIs behind one key. <strong>Provenance</strong> watermarks, signs, verifies, and attributes audio so you always know who
            received a file and who leaked it. <strong>Vault</strong> is version control for DAW projects and sample libraries, content-addressed and
            deduplicated. Both are built for humans in a console and for AI agents over MCP.
          </p>
        </div>
        <div className="vz-rise d1" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 26 }}>
          <Link to="/signin?mode=create" className="vz-btn vz-btn-primary">
            Create an API key <ArrowRight size={16} />
          </Link>
          <Link to="/docs" className="vz-btn vz-btn-ghost">Read the docs</Link>
          <Link to="/agents" className="vz-btn vz-btn-ghost">
            <Bot size={16} /> Connect an agent
          </Link>
        </div>
        <div className="vz-rise d2" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 26 }}>
          <span className="vz-pill cyan"><Fingerprint size={12} /> Forensic watermark</span>
          <span className="vz-pill cyan"><FileCheck2 size={12} /> C2PA Content Credentials</span>
          <span className="vz-pill violet"><GitBranch size={12} /> Content-addressed VCS</span>
          <span className="vz-pill mint"><Bot size={12} /> MCP native</span>
          <span className="vz-pill"><Lock size={12} /> Org-scoped keys</span>
          <span className="vz-pill"><Activity size={12} /> Full audit log</span>
        </div>
      </section>

      <section className="vz-section">
        <div className="vz-grid vz-grid-2">
          <div className="vz-card vz-card-accent lift">
            <div className="vz-icon"><Fingerprint size={18} /></div>
            <span className="vz-eyebrow">Provenance</span>
            <h3 className="vz-h3" style={{ marginTop: 8 }}>Know who has your audio. Prove who leaked it.</h3>
            <p className="vz-p">
              Register an original once. Issue a unique, inaudible spread-spectrum watermark per recipient, with Content Credentials attached. When a
              copy shows up where it should not, one call correlates it against every issuance and names the source.
            </p>
            <Link to="/provenance" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 8 }}>Explore Provenance <ArrowRight size={14} /></Link>
          </div>
          <div className="vz-card vz-card-accent lift">
            <div className="vz-icon violet"><GitBranch size={18} /></div>
            <span className="vz-eyebrow violet">Vault</span>
            <h3 className="vz-h3" style={{ marginTop: 8 }}>Git for DAW projects, built for multi-gigabyte sessions.</h3>
            <p className="vz-p">
              Commit whole project folders. Blobs are stored once per organization by SHA-256, so a 40 GB catalog with shared samples costs a fraction
              of the raw size. Branch, diff, and restore any session to any moment.
            </p>
            <Link to="/vault" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 8 }}>Explore Vault <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>

      <section className="vz-section">
        <span className="vz-eyebrow">Two calls that matter</span>
        <h2 className="vz-h2">Issue a copy. Later, name the leak.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 22 }}>
          <Code title="issue" code={ISSUE} />
          <Code title="detect" code={DETECT} />
        </div>
      </section>

      <section className="vz-section">
        <span className="vz-eyebrow mint" style={{ color: "var(--vz-mint)" }}>Agents</span>
        <h2 className="vz-h2">Your agents already know how to use it.</h2>
        <p className="vz-lead">
          VYBZ ships a Model Context Protocol server, hosted and local, with tools for every operation: register, issue, verify, detect, commit a
          folder, restore a session. Claude, Cursor, and any MCP client connect with one key. The OpenAPI document and llms.txt are published for
          everything else.
        </p>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 22 }}>
          <Code title="claude_desktop_config.json" code={MCP} lang="json" />
          <div className="vz-card">
            <h3 className="vz-h3">What an agent can do</h3>
            <ul className="vz-p" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Snapshot a project folder after every session and report what changed.</li>
              <li>Issue watermarked previews to a list of partners and log each recipient.</li>
              <li>Take a suspicious file from a takedown notice and attribute it.</li>
              <li>Verify a delivery against the ledger before a payment is released.</li>
              <li>Restore last Tuesday's arrangement into a fresh folder.</li>
            </ul>
            <Link to="/agents" className="vz-btn vz-btn-ghost vz-btn-sm" style={{ marginTop: 14 }}>Agent setup <ArrowRight size={14} /></Link>
          </div>
        </div>
      </section>

      <section className="vz-section">
        <div className="vz-grid vz-grid-4">
          {[
            { i: <ShieldCheck size={18} />, t: "Scoped keys", d: "Six scopes, per-key rate limits, expiry, instant revocation. The plaintext is shown once." },
            { i: <Activity size={18} />, t: "Audited", d: "Every call lands in your organization's audit log with request id, agent, bytes, and latency." },
            { i: <Waves size={18} />, t: "Alignment-tolerant", d: "Detection survives trimming, gain, requantization, and light processing." },
            { i: <Search size={18} />, t: "Tamper-evident ledger", d: "A per-organization hash chain you can verify in one call, or export and verify yourself." },
          ].map((f) => (
            <div key={f.t} className="vz-card">
              <div className="vz-icon">{f.i}</div>
              <h3 className="vz-h3">{f.t}</h3>
              <p className="vz-p" style={{ margin: 0 }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vz-section" style={{ textAlign: "center" }}>
        <h2 className="vz-h2">Start in the console. Ship with the API.</h2>
        <p className="vz-lead" style={{ margin: "0 auto" }}>Developer plan is free. Business and enterprise add volume, Content Credentials with your own certificate, and SLAs.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
          <Link to="/signin?mode=create" className="vz-btn vz-btn-primary">Create an API key</Link>
          <Link to="/pricing" className="vz-btn vz-btn-ghost">See pricing</Link>
        </div>
      </section>
    </SiteShell>
  );
}
