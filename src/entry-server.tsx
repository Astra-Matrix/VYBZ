// Build-time renderer used by scripts/prerender.mjs. Not shipped to the browser.
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { SiteApp } from "@/site/SiteApp";
import { SessionProvider } from "@/store/session";
import { headHtml, indexableRoutes, seoFor, type RouteSeo } from "@/site/seo";
import { DOCS, LEGAL, docPath } from "@/site/docsIndex";

export const routes: RouteSeo[] = indexableRoutes();

export function render(path: string): { html: string; head: string; seo: RouteSeo } {
  const seo = seoFor(path);
  const html = renderToString(
    <StaticRouter location={path}>
      <SessionProvider>
        <SiteApp />
      </SessionProvider>
    </StaticRouter>,
  );
  return { html, head: headHtml(seo), seo };
}

/** Complete public documentation as one text file for language models (llms-full.txt). */
export function llmsFull(): string {
  const parts = [
    "# VYBZ — complete documentation",
    "",
    "> Audio infrastructure for businesses. Provenance (forensic watermarking, C2PA Content Credentials, verification, leak attribution) and Vault (content-addressed version control for DAW projects), behind one organization API key. REST at https://vybz.cloud/v1, MCP at https://vybz.cloud/api/mcp, OpenAPI at https://vybz.cloud/v1/openapi.json.",
  ];
  for (const d of DOCS.filter((x) => x.group !== "Engineering")) {
    parts.push("", "---", "", `<!-- https://vybz.cloud${docPath(d, false)} -->`, "", d.body.trim());
  }
  for (const d of LEGAL) {
    parts.push("", "---", "", `<!-- https://vybz.cloud${docPath(d, true)} -->`, "", d.body.trim());
  }
  return `${parts.join("\n")}\n`;
}
