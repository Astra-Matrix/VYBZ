import { useMemo } from "react";
import { NavLink, useParams, Navigate } from "react-router-dom";
import { marked } from "marked";
import { SiteShell } from "./SiteShell";
import { DOCS, LEGAL, docPath } from "./docsIndex";

export { DOCS, LEGAL } from "./docsIndex";

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
  if (!doc) return <Navigate to={legal ? "/legal/terms" : "/docs"} replace />;
  const groups = [...new Set(list.map((d) => d.group))];
  return (
    <SiteShell wide>
      <div className="vz-docs">
        <aside className="vz-side">
          {groups.map((g) => (
            <div key={g}>
              <div className="group">{g}</div>
              {list
                .filter((d) => d.group === g)
                .map((d) => (
                  <NavLink key={d.slug} to={docPath(d, legal)} end className={({ isActive }) => (isActive ? "active" : "")}>
                    {d.title}
                  </NavLink>
                ))}
            </div>
          ))}
          {!legal ? (
            <div>
              <div className="group">Machine</div>
              <a href="/v1/openapi.json" target="_blank" rel="noreferrer">
                OpenAPI 3.1
              </a>
              <a href="/llms.txt" target="_blank" rel="noreferrer">
                llms.txt
              </a>
              <a href="/llms-full.txt" target="_blank" rel="noreferrer">
                llms-full.txt
              </a>
            </div>
          ) : null}
        </aside>
        <article className="vz-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </SiteShell>
  );
}
