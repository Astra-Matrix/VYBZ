import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { SiteShell, Code } from "./SiteShell";

export function ProvenancePage() {
  return (
    <SiteShell>
      <section className="vz-hero" style={{ paddingBottom: 24 }}>
        <span className="vz-eyebrow">Provenance</span>
        <h1 className="vz-h1">Attribution that survives the internet.</h1>
        <p className="vz-lead">
          Sample libraries, sync houses, labels, distributors, and AI music companies all ship audio to people they do not control. Provenance makes
          every delivered copy unique and every leak attributable, with an industry-standard Content Credentials manifest on top.
        </p>
      </section>

      <section className="vz-section">
        <div className="vz-flow">
          <div><b>1. Register</b><span>POST the original WAV. It is hashed, stored privately, and becomes an asset.</span></div>
          <div><b>2. Issue</b><span>Each recipient gets a copy carrying a unique inaudible watermark and a C2PA manifest.</span></div>
          <div><b>3. Verify</b><span>Any file, any time: is it ours, is it an issued copy, and for whom?</span></div>
          <div><b>4. Detect</b><span>A leaked copy is correlated against all issuances. The source is named with a confidence.</span></div>
        </div>
      </section>

      <section className="vz-section">
        <div className="vz-grid vz-grid-3">
          {[
            ["Direct-sequence spread spectrum", "A pseudo-random chip sequence keyed to the recipient is added 34–40 dB below the signal, shaped by a local energy envelope. Inaudible in listening tests; blind-detectable without the original."],
            ["Alignment tolerant", "The mark repeats on a fixed period, so trimming and cropping only shift the correlation peak. Gain changes, requantization, and light filtering do not remove it."],
            ["Content Credentials", "When enabled, each copy carries a signed C2PA manifest with your organization as author, the recipient, license, and watermark id. Validators trust CA-issued certificates on Business and Enterprise."],
            ["Tamper-evident ledger", "Register, issue, verify, and detect events are hash-chained per organization. One call recomputes the chain and reports the first broken link."],
            ["Honest confidence", "Detection returns ranked candidates with scores. An attribution is only asserted when the top candidate is decisively above the floor and the runner-up."],
            ["Private by default", "Originals live in private storage. Copies are returned as bytes or as one-hour signed links. Nothing is ever public."],
          ].map(([t, d]) => (
            <div key={t} className="vz-card">
              <h3 className="vz-h3">{t}</h3>
              <p className="vz-p" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vz-section">
        <h2 className="vz-h2">Register, then issue.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 18 }}>
          <Code
            title="register"
            code={`curl -X POST https://vybz.cloud/v1/provenance/assets \\
  -H "Authorization: Bearer $VYBZ_API_KEY" \\
  -H "Content-Type: audio/wav" \\
  -H "X-VYBZ-Title: Midnight Drive (Master)" \\
  -H "X-VYBZ-External-Ref: cat-00412" \\
  --data-binary @midnight-drive-master.wav
# 201 { "id": "…", "sha256": "…", "duration_sec": 214.5 }`}
          />
          <Code
            title="issue (json + link)"
            code={`curl -X POST https://vybz.cloud/v1/provenance/assets/$ASSET/issue \\
  -H "Authorization: Bearer $VYBZ_API_KEY" \\
  -H "Accept: application/json" \\
  -H "Content-Type: application/json" \\
  -d '{"recipient":"a&r@label.example","license":"internal-review"}'
# 201 { "watermark_id": "…", "c2pa_signed": true,
#       "download": { "url": "https://…", "expires_in": 3600 } }`}
          />
        </div>
        <div style={{ marginTop: 18 }}>
          <Link to="/docs/api" className="vz-btn vz-btn-ghost">Full API reference <ArrowRight size={14} /></Link>
        </div>
      </section>
    </SiteShell>
  );
}

export function VaultPage() {
  return (
    <SiteShell>
      <section className="vz-hero" style={{ paddingBottom: 24 }}>
        <span className="vz-eyebrow violet">Vault</span>
        <h1 className="vz-h1">Version control that understands a session.</h1>
        <p className="vz-lead">
          A DAW project is a folder of large binaries that change a little every day. Vault stores every file once by its hash, commits the whole tree,
          and lets you branch, diff, and restore. Studios, schools, and production teams stop losing work and stop shipping zip files.
        </p>
      </section>

      <section className="vz-section">
        <div className="vz-flow">
          <div><b>1. Hash</b><span>Every file in the folder is hashed locally. Caches and backups are skipped.</span></div>
          <div><b>2. Upload missing</b><span>One call asks which hashes the organization lacks. Only those bytes move.</span></div>
          <div><b>3. Commit</b><span>The tree (path, hash, size) is committed with a message and free-form metadata.</span></div>
          <div><b>4. Restore</b><span>Any ref, any time, into any folder. Unchanged files are left alone.</span></div>
        </div>
      </section>

      <section className="vz-section">
        <div className="vz-grid vz-grid-3">
          {[
            ["Organization-wide dedupe", "A kick sample used in 300 projects is stored once. Storage bills follow unique bytes, not project count."],
            ["Optimistic concurrency", "Commits carry the expected head. Two writers cannot silently clobber each other."],
            ["Branches and diffs", "Try an alternate arrangement on a branch. Diff any two refs to see what changed, down to the file."],
            ["Metadata that matters", "Attach DAW, version, tempo, key, and plugin lists to each commit. Search and filter later."],
            ["Signed downloads", "Blobs come back through short-lived signed links. No public buckets, ever."],
            ["Agent-ready", "The MCP server commits folders, reports status, and restores trees so an assistant can run the workflow end to end."],
          ].map(([t, d]) => (
            <div key={t} className="vz-card">
              <h3 className="vz-h3">{t}</h3>
              <p className="vz-p" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="vz-section">
        <h2 className="vz-h2">Commit a folder from an agent, or from three calls.</h2>
        <div className="vz-grid vz-grid-2" style={{ marginTop: 18 }}>
          <Code
            title="mcp tool call"
            lang="json"
            code={`{
  "tool": "vault_commit_folder",
  "arguments": {
    "repo": "midnight-drive",
    "folder": "D:/Projects/Midnight Drive Project",
    "message": "Vocal comp v3, new bass layer",
    "meta": { "daw": "ableton", "version": "12.1", "bpm": 124 }
  }
}`}
          />
          <Code
            title="http"
            code={`# 1. which blobs are missing?
curl -X POST $BASE/vault/repos/midnight-drive/blobs/exists \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"hashes":["3f9a…","b21c…"]}'
# 2. upload each missing blob (raw bytes, content-addressed)
curl -X POST $BASE/vault/repos/midnight-drive/blobs \\
  -H "Authorization: Bearer $KEY" --data-binary @Samples/kick.wav
# 3. commit the tree
curl -X POST $BASE/vault/repos/midnight-drive/commits \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"message":"Vocal comp v3","entries":[{"path":"Samples/kick.wav","hash":"3f9a…","size":88244}]}'`}
          />
        </div>
      </section>
    </SiteShell>
  );
}

export function AgentsPage() {
  return (
    <SiteShell>
      <section className="vz-hero" style={{ paddingBottom: 24 }}>
        <span className="vz-eyebrow" style={{ color: "var(--vz-mint)" }}>Agents</span>
        <h1 className="vz-h1">Built to be operated by AI.</h1>
        <p className="vz-lead">
          Every capability is exposed as a Model Context Protocol tool, hosted at vybz.cloud and as a local package with filesystem workflows. Keys
          are scoped, every tool call is audited, and nothing an agent does can escape its organization.
        </p>
      </section>

      <section className="vz-section">
        <div className="vz-grid vz-grid-2">
          <div className="vz-card vz-card-accent">
            <span className="vz-pill mint">Hosted</span>
            <h3 className="vz-h3" style={{ marginTop: 12 }}>Remote MCP, zero install</h3>
            <p className="vz-p">Streamable HTTP, stateless. Point any MCP client at the endpoint with your key. Files arrive as URLs or base64.</p>
            <Code title="endpoint" code={`https://vybz.cloud/api/mcp
Authorization: Bearer vybz_live_…`} />
            <Code
              title="claude code"
              code={`claude mcp add --transport http vybz https://vybz.cloud/api/mcp \\
  --header "Authorization: Bearer vybz_live_…"`}
            />
          </div>
          <div className="vz-card vz-card-accent">
            <span className="vz-pill cyan">Local</span>
            <h3 className="vz-h3" style={{ marginTop: 12 }}>Local MCP with folder workflows</h3>
            <p className="vz-p">Adds vault_commit_folder, vault_status, and vault_restore. Confine it to project roots with VYBZ_ROOTS.</p>
            <Code
              title="claude_desktop_config.json"
              lang="json"
              code={`{
  "mcpServers": {
    "vybz": {
      "command": "npx",
      "args": ["-y", "@vybz/mcp-server"],
      "env": {
        "VYBZ_API_KEY": "vybz_live_…",
        "VYBZ_ROOTS": "D:/Projects"
      }
    }
  }
}`}
            />
          </div>
        </div>
      </section>

      <section className="vz-section">
        <h2 className="vz-h2">Tools</h2>
        <div className="vz-table-wrap" style={{ marginTop: 16 }}>
          <table className="vz-table">
            <thead><tr><th>Tool</th><th>Does</th><th>Scope</th></tr></thead>
            <tbody>
              {[
                ["vybz_whoami", "Organization, plan, key, scopes", "org:read"],
                ["vybz_billing_usage", "Plan usage this month and closed-month reports", "org:read"],
                ["provenance_register", "Register a WAV original", "provenance:write"],
                ["provenance_issue", "Issue a watermarked copy to a recipient", "provenance:write"],
                ["provenance_issue_batch", "Copies for up to 50 recipients, with a manifest of links", "provenance:write"],
                ["provenance_verify", "Exact-hash verification of any file", "provenance:read"],
                ["provenance_detect", "Attribute a suspect file to a recipient", "provenance:detect"],
                ["provenance_ledger / chain_verify", "Event history and chain integrity", "provenance:read"],
                ["vault_create_repo / list / get", "Repositories", "vault:*"],
                ["vault_commit_folder", "Hash, upload missing, commit (local)", "vault:write"],
                ["vault_status", "Compare a folder with a ref (local)", "vault:read"],
                ["vault_restore", "Materialize a ref into a folder (local)", "vault:read"],
                ["vault_history / tree / diff / branches", "Read the graph", "vault:read"],
              ].map(([t, d, s]) => (
                <tr key={t}><td className="vz-mono">{t}</td><td>{d}</td><td className="vz-mono vz-muted">{s}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vz-p" style={{ marginTop: 16 }}>
          Not using MCP? The OpenAPI 3.1 document at <span className="vz-mono">/v1/openapi.json</span> and <span className="vz-mono">/llms.txt</span> give
          any model enough to call the API directly.
        </p>
        <Link to="/docs/agents" className="vz-btn vz-btn-ghost">Agent guide <ArrowRight size={14} /></Link>
      </section>
    </SiteShell>
  );
}

const PLANS = [
  {
    name: "Developer",
    price: "$0",
    per: "forever",
    blurb: "Build and test. Enough for a pilot.",
    items: ["1 organization, 3 keys", "250 issuances / month", "50 detections / month", "10 GB Vault storage", "Community support", "Hosted + local MCP"],
    cta: "Start free",
    to: "/signin?mode=create",
  },
  {
    name: "Business",
    price: "$249",
    per: "per month",
    blurb: "For catalogs, sync houses, and studios.",
    items: ["Unlimited keys and members", "10,000 issuances / month, then $0.02", "2,000 detections / month, then $0.10", "1 TB Vault, then $0.015 / GB", "Content Credentials with CA-issued certificate", "Audit export, 99.9% SLA, email support"],
    cta: "Talk to us",
    to: "mailto:sales@vybz.cloud?subject=VYBZ%20Business",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    per: "annual",
    blurb: "Distributors, platforms, AI labs.",
    items: ["Volume pricing on issuances and storage", "Dedicated signing certificate and key ceremony", "Private deployment options", "SSO and custom retention", "Solutions engineering", "Named support, 24×7"],
    cta: "Contact sales",
    to: "mailto:sales@vybz.cloud?subject=VYBZ%20Enterprise",
  },
];

export function PricingPage() {
  return (
    <SiteShell>
      <section className="vz-hero" style={{ paddingBottom: 12 }}>
        <span className="vz-eyebrow">Pricing</span>
        <h1 className="vz-h1">Pay for outcomes, not seats.</h1>
        <p className="vz-lead">Issuances, detections, and unique stored bytes are the only meters. Reading is always free.</p>
      </section>
      <section className="vz-section" style={{ borderTop: 0 }}>
        <div className="vz-grid vz-grid-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`vz-card ${p.featured ? "vz-card-accent" : ""}`}>
              {p.featured ? <span className="vz-pill cyan" style={{ position: "absolute", top: 16, right: 16 }}>Most chosen</span> : null}
              <h3 className="vz-h3">{p.name}</h3>
              <div className="vz-stat">{p.price}<small>{p.per}</small></div>
              <p className="vz-p">{p.blurb}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px" }}>
                {p.items.map((i) => (
                  <li key={i} className="vz-p" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0" }}>
                    <Check size={15} style={{ color: "var(--vz-mint)", marginTop: 3, flex: "none" }} /> {i}
                  </li>
                ))}
              </ul>
              {p.to.startsWith("mailto:") ? (
                <a href={p.to} className={`vz-btn ${p.featured ? "vz-btn-primary" : "vz-btn-ghost"}`} style={{ width: "100%" }}>{p.cta}</a>
              ) : (
                <Link to={p.to} className={`vz-btn ${p.featured ? "vz-btn-primary" : "vz-btn-ghost"}`} style={{ width: "100%" }}>{p.cta}</Link>
              )}
            </div>
          ))}
        </div>
        <p className="vz-muted" style={{ fontSize: 12.5, marginTop: 18 }}>
          Prices in USD. Metered overages are billed monthly. Watermark detection counts one call per suspect file regardless of candidates.
        </p>
      </section>
    </SiteShell>
  );
}
