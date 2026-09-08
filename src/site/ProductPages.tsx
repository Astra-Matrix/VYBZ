import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { SiteShell, Code } from "./SiteShell";
import { useSession } from "@/store/session";
import { openCheckout, paddleConfigFromEnv, previewPrices, type PricePreviewResult } from "@/lib/paddle";
import { TIERS, type Interval, type Tier } from "./pricingTiers";

export function ProvenancePage() {
  return (
    <SiteShell>
      <section className="vz-hero" style={{ paddingBottom: 24 }}>
        <span className="vz-eyebrow">Provenance</span>
        <h1 className="vz-h1">Leak forensics that survive the internet.</h1>
        <p className="vz-lead">
          Managers, labels, studios, and sync houses ship unreleased audio to people they do not control. Provenance makes every delivered copy
          unique, names the recipient when one leaks, and hands you a report with the evidence. Content Credentials ride along on every copy.
        </p>
      </section>

      <section className="vz-section">
        <div className="vz-flow">
          <div><b>1. Register</b><span>POST the original WAV. It is hashed, stored privately, and becomes an asset.</span></div>
          <div><b>2. Issue</b><span>Each recipient gets a copy carrying a unique inaudible watermark and a C2PA manifest.</span></div>
          <div><b>3. Verify</b><span>Any file, any time: is it ours, is it an issued copy, and for whom?</span></div>
          <div><b>4. Report</b><span>A leaked copy is correlated against all issuances. The recipient is named with a confidence, in a report you can forward.</span></div>
        </div>
      </section>

      <section className="vz-section">
        <h2 className="vz-sr">Details</h2>
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
        <h2 className="vz-sr">Details</h2>
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
        <h2 className="vz-sr">Details</h2>
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
        <div className="vz-table-wrap" tabIndex={0} style={{ marginTop: 16 }}>
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

export function PricingPage() {
  const { email } = useSession();
  const navigate = useNavigate();
  const [interval, setInterval] = useState<Interval>("month");
  const [prices, setPrices] = useState<Map<string, PricePreviewResult> | null>(null);
  const [country, setCountry] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cfg = useMemo(() => {
    try { return paddleConfigFromEnv(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return null; }
  }, []);
  const priceIds = useMemo(() => TIERS.flatMap((t) => (t.priceId ? [t.priceId.month, t.priceId.year] : [])), []);

  // Country from the edge, if Vercel provided it. Absent means "let Paddle detect it".
  useEffect(() => {
    let alive = true;
    fetch("/api/country").then((r) => (r.ok ? r.json() : { country: null })).then((j: { country?: string | null }) => { if (alive) setCountry(j.country ?? null); }).catch(() => { if (alive) setCountry(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!cfg || !priceIds.length || country === undefined) return;
    let alive = true;
    previewPrices(cfg, priceIds, country).then((m) => { if (alive) setPrices(m); }).catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [cfg, priceIds, country]);

  async function subscribe(t: Tier) {
    if (!t.priceId) return;
    if (!email) { navigate("/signin?mode=create&next=/pricing"); return; }
    let orgId: string | null = null;
    try { orgId = localStorage.getItem("vybz.console.org"); } catch { /* ignore */ }
    if (!orgId) { navigate("/console/billing"); return; }
    if (!cfg) { navigate("/console/billing"); return; }
    setBusy(t.name); setErr(null);
    try {
      await openCheckout(cfg, {
        priceId: t.priceId[interval],
        email,
        customData: { kind: "org_plan", org_id: orgId, plan: t.id, interval },
        successUrl: `${window.location.origin}/console/billing?checkout=success`,
      });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  const shown = (t: Tier): { amount: string; per: string } => {
    const per = t.cta.checkout ? (interval === "month" ? "per month" : "per year") : t.id === "developer" ? "forever" : "by agreement";
    if (t.priceId && prices) {
      const p = prices.get(t.priceId[interval]);
      if (p) return { amount: p.total, per: `${per}, ${p.currencyCode}` };
    }
    return { amount: t.fallback[interval], per };
  };

  return (
    <SiteShell>
      <section className="vz-hero" style={{ paddingBottom: 12 }}>
        <span className="vz-eyebrow">Pricing</span>
        <h1 className="vz-h1">Priced by what leaves the building.</h1>
        <p className="vz-lead">Copies issued, leak checks, and stored bytes are the only meters. Reading, verifying, and the ledger are always free.</p>
        <div className="vz-tabs" role="tablist" aria-label="Billing interval" style={{ display: "inline-flex", marginTop: 18, borderBottom: 0, gap: 0, border: "1px solid var(--vz-line)", borderRadius: 999, padding: 3 }}>
          {(["month", "year"] as Interval[]).map((i) => (
            <button key={i} type="button" role="tab" aria-selected={interval === i} className={`vz-tab ${interval === i ? "active" : ""}`} style={{ borderRadius: 999, borderBottom: 0, margin: 0, padding: "8px 16px", background: interval === i ? "var(--vz-panel)" : "none" }} onClick={() => setInterval(i)}>
              {i === "month" ? "Monthly" : "Yearly, two months free"}
            </button>
          ))}
        </div>
        {prices ? <p className="vz-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Prices shown in your local currency, tax added at checkout.</p> : null}
        {err ? <p className="vz-alert err" style={{ marginTop: 10, display: "inline-block" }}>{err}</p> : null}
      </section>
      <section className="vz-section" style={{ borderTop: 0 }}>
        <h2 className="vz-sr">Details</h2>
        <div className="vz-grid vz-grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {TIERS.filter((t) => t.id !== "developer").map((t) => {
            const p = shown(t);
            return (
              <div key={t.name} className={`vz-card ${t.featured ? "vz-card-accent" : ""}`}>
                {t.featured ? <span className="vz-pill cyan" style={{ position: "absolute", top: 16, right: 16 }}>Most chosen</span> : null}
                <h3 className="vz-h3">{t.name}</h3>
                <div className="vz-stat">{p.amount}<small>{p.per}</small></div>
                <p className="vz-p">{t.description}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px" }}>
                  {t.features.map((i) => (
                    <li key={i} className="vz-p" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0" }}>
                      <Check size={15} style={{ color: "var(--vz-mint)", marginTop: 3, flex: "none" }} aria-hidden /> {i}
                    </li>
                  ))}
                </ul>
                {t.cta.checkout ? (
                  <button type="button" className="vz-btn vz-btn-primary" style={{ width: "100%" }} disabled={busy === t.name} onClick={() => void subscribe(t)}>
                    {busy === t.name ? "Opening checkout…" : email ? `Start ${t.trialDays}-day trial` : "Sign in to start a trial"}
                  </button>
                ) : t.cta.to.startsWith("mailto:") ? (
                  <a href={t.cta.to} className="vz-btn vz-btn-ghost" style={{ width: "100%" }}>{t.cta.label}</a>
                ) : (
                  <Link to={t.cta.to} className="vz-btn vz-btn-ghost" style={{ width: "100%" }}>{t.cta.label}</Link>
                )}
              </div>
            );
          })}
        </div>
        <p className="vz-p" style={{ marginTop: 18 }}>Building an integration or evaluating the API? The <b>Developer</b> plan is free: 100 copies and 20 leak checks a month, one member, three keys. <Link to="/signin?mode=create">Start free</Link>.</p>
        <p className="vz-muted" style={{ fontSize: 12.5, marginTop: 18 }}>
          Every paid plan starts with a 14-day trial, one per person; a card is taken at checkout and charged when the trial ends unless you cancel. During the trial each plan is limited to 25 issuances, 10 detections, and 10 GB, with full quantities from the first paid period. Sold by Paddle as merchant of record; tax is added at checkout. Metered overages on Label and Catalog are billed monthly with the renewal. Watermark detection counts one call per suspect file regardless of candidates.
        </p>
      </section>
    </SiteShell>
  );
}
