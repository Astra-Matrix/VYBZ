// Single index of the public documentation. Imported by the docs pages, the SEO
// table, the prerenderer, and the llms-full.txt generator. No React here.

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
import accessibility from "../../public/legal/accessibility.md?raw";
import refunds from "../../public/legal/refunds.md?raw";

export type Doc = { slug: string; title: string; body: string; group: string };

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
  { slug: "refunds", title: "Refund Policy", body: refunds, group: "Legal" },
  { slug: "dpa", title: "Data Processing Addendum", body: dpa, group: "Legal" },
  { slug: "accessibility", title: "Accessibility", body: accessibility, group: "Legal" },
];

/** Path of a doc on the site. The overview lives at /docs itself. */
export function docPath(doc: Doc, legal: boolean): string {
  if (legal) return `/legal/${doc.slug}`;
  return doc.slug === "overview" ? "/docs" : `/docs/${doc.slug}`;
}

/** `Last updated: YYYY-MM-DD` or `Effective YYYY-MM-DD` from a document body. */
export function lastUpdated(md: string): string | undefined {
  const m = md.match(/(?:Last updated|Effective):?\s*(\d{4}-\d{2}-\d{2})/);
  return m?.[1];
}

/** Plain-text summary of the first prose paragraph, trimmed to a sentence boundary under `max` characters. */
export function excerpt(md: string, max = 158): string {
  const lines = md.split("\n");
  const para: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (!line) {
      if (para.length) break;
      continue;
    }
    if (/^(#|\||>|-|\*|\d+\.|!\[)/.test(line) || /^(Last updated|Effective)/.test(line)) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  let text = para
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > 60) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(" ");
  text = cut.slice(0, space > 0 ? space : max).replace(/[,;:]$/, "");
  return `${text}.`;
}
