import { useEffect, useMemo } from "react";
import { NavLink, useParams, Navigate } from "react-router-dom";
import { marked } from "marked";
import { SiteShell } from "./SiteShell";

import overview from "../../docs/README.md?raw";
import product from "../../docs/PRODUCT.md?raw";
import quickstart from "../../docs/QUICKSTART.md?raw";
import api from "../../docs/API.md?raw";
import agents from "../../docs/AGENTS.md?raw";
import provenance from "../../docs/PROVENANCE.md?raw";
import vault from "../../docs/VAULT.md?raw";
import security from "../../docs/SECURITY.md?raw";
import architecture from "../../docs/ARCHITECTURE.md?raw";
import operations from "../../docs/OPERATIONS.md?raw";
import roadmap from "../../docs/ROADMAP.md?raw";
import brand from "../../docs/BRAND.md?raw";

import terms from "../../public/legal/terms.md?raw";
import privacy from "../../public/legal/privacy.md?raw";
import aup from "../../public/legal/acceptable-use.md?raw";
import dpa from "../../public/legal/dpa.md?raw";

type Doc = { slug: string; title: string; body: string; group: string };

export const DOCS: Doc[] = [
  { slug: "overview", title: "Overview", body: overview, group: "Start" },
  { slug: "quickstart", title: "Quickstart", body: quickstart, group: "Start" },
  { slug: "product", title: "Product", body: product, group: "Start" },
  { slug: "provenance", title: "Provenance", body: provenance, group: "Products" },
  { slug: "vault", title: "Vault", body: vault, group: "Products" },
  { slug: "api", title: "API reference", body: api, group: "Reference" },
  { slug: "agents", title: "Agents and MCP", body: agents, group: "Reference" },
  { slug: "security", title: "Security", body: security, group: "Reference" },
  { slug: "architecture", title: "Architecture", body: architecture, group: "Engineering" },
  { slug: "operations", title: "Operations", body: operations, group: "Engineering" },
  { slug: "roadmap", title: "Roadmap", body: roadmap, group: "Engineering" },
  { slug: "brand", title: "Brand", body: brand, group: "Engineering" },
];

export const LEGAL: Doc[] = [
  { slug: "terms", title: "Terms of Service", body: terms, group: "Legal" },
  { slug: "privacy", title: "Privacy Policy", body: privacy, group: "Legal" },
  { slug: "acceptable-use", title: "Acceptable Use", body: aup, group: "Legal" },
  { slug: "dpa", title: "Data Processing Addendum", body: dpa, group: "Legal" },
];

marked.setOptions({ gfm: true, breaks: false });

function render(md: string): string {
  const html = marked.parse(md) as string;
  // Internal links: docs/X.md → /docs/x, public/legal/x.md → /legal/x
  return html
    .replace(/href="(?:\.\.\/)*docs\/([A-Za-z_-]+)\.md"/g, (_m, n: string) => `href="/docs/${n.toLowerCase()}"`)
    .replace(/href="(?:\.\.\/)*(?:public\/)?legal\/([a-z-]+)\.md"/g, (_m, n: string) => `href="/legal/${n}"`)
    .replace(/href="\.\/([A-Za-z_-]+)\.md"/g, (_m, n: string) => `href="/docs/${n.toLowerCase()}"`);
}

export function DocsPage({ legal = false }: { legal?: boolean }) {
  const { slug } = useParams();
  const list = legal ? LEGAL : DOCS;
  const doc = list.find((d) => d.slug === (slug ?? (legal ? "terms" : "overview")));
  const html = useMemo(() => (doc ? render(doc.body) : ""), [doc]);
  useEffect(() => { document.title = doc ? `${doc.title} · VYBZ` : "VYBZ"; }, [doc]);
  if (!doc) return <Navigate to={legal ? "/legal/terms" : "/docs"} replace />;
  const groups = [...new Set(list.map((d) => d.group))];
  return (
    <SiteShell wide>
      <div className="vz-docs">
        <aside className="vz-side">
          {groups.map((g) => (
            <div key={g}>
              <div className="group">{g}</div>
              {list.filter((d) => d.group === g).map((d) => (
                <NavLink key={d.slug} to={legal ? `/legal/${d.slug}` : d.slug === "overview" ? "/docs" : `/docs/${d.slug}`} end className={({ isActive }) => (isActive ? "active" : "")}>
                  {d.title}
                </NavLink>
              ))}
            </div>
          ))}
          {!legal ? (
            <div>
              <div className="group">Machine</div>
              <a href="/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI 3.1</a>
              <a href="/llms.txt" target="_blank" rel="noreferrer">llms.txt</a>
            </div>
          ) : null}
        </aside>
        <article className="vz-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </SiteShell>
  );
}
