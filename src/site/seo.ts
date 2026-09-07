// The single source of truth for page metadata: titles, descriptions,
// canonical URLs, robots directives, and structured data. Used three ways:
//  - at build time by scripts/prerender.mjs to write static HTML and sitemap.xml
//  - at runtime by SiteShell to update the document head on navigation
//  - by tests, which enforce length and uniqueness constraints

import { DOCS, LEGAL, docPath, excerpt, lastUpdated } from "./docsIndex";

export const SITE = "https://vybz.cloud";
export const SITE_NAME = "VYBZ";
const ORG_ID = `${SITE}/#org`;
const SITE_ID = `${SITE}/#website`;
const OG_IMAGE = `${SITE}/og.png`;

export interface RouteSeo {
  path: string;
  title: string;
  description: string;
  /** Exclude from index and sitemap. */
  noindex?: boolean;
  /** ISO date for sitemap lastmod and structured data. */
  lastmod?: string;
  jsonLd: Record<string, unknown>[];
}

const ORG = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: SITE_NAME,
  legalName: "Andrew Laustrup (doing business as VYBZ)",
  url: `${SITE}/`,
  logo: { "@type": "ImageObject", url: `${SITE}/icons/icon-512.png`, width: 512, height: 512 },
  email: "legal@vybz.cloud",
};

const WEBSITE = {
  "@type": "WebSite",
  "@id": SITE_ID,
  url: `${SITE}/`,
  name: SITE_NAME,
  publisher: { "@id": ORG_ID },
  inLanguage: "en-US",
};

function app(name: string, path: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    "@type": "SoftwareApplication",
    name,
    url: `${SITE}${path}`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description,
    publisher: { "@id": ORG_ID },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: `${SITE}/pricing` },
    ...extra,
  };
}

function breadcrumb(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE}${it.path}` })),
  };
}

function webPage(path: string, name: string, description: string, extra: Record<string, unknown> = {}) {
  return { "@type": "WebPage", "@id": `${SITE}${path}`, url: `${SITE}${path}`, name, description, isPartOf: { "@id": SITE_ID }, ...extra };
}

const HOME_DESCRIPTION =
  "Forensic audio watermarking, C2PA Content Credentials, and leak attribution as an API, plus version control for DAW projects. Built for people and AI agents.";

const PROVENANCE_DESCRIPTION =
  "Issue per-recipient forensically watermarked copies with C2PA Content Credentials, verify any file, and attribute a leaked copy to the recipient it went to.";

const VAULT_DESCRIPTION =
  "Content-addressed version control for DAW sessions and sample libraries. Every file stored once per organization, whole-tree commits, branches, diffs, restore.";

const AGENTS_DESCRIPTION =
  "Every VYBZ capability as a Model Context Protocol tool, hosted at vybz.cloud or local with npx. Scoped keys, a full audit log, nothing leaves the organization.";

const PRICING_DESCRIPTION =
  "Developer plan free. Business at $249 per month with 10,000 issuances and 2,000 detections included. Enterprise by contract. Reads are always free.";

const STATIC_ROUTES: RouteSeo[] = [
  {
    path: "/",
    title: "VYBZ — Audio provenance and DAW version control API",
    description: HOME_DESCRIPTION,
    jsonLd: [ORG, WEBSITE, app("VYBZ", "/", HOME_DESCRIPTION)],
  },
  {
    path: "/provenance",
    title: "Forensic audio watermarking API — VYBZ Provenance",
    description: PROVENANCE_DESCRIPTION,
    jsonLd: [
      webPage("/provenance", "VYBZ Provenance", PROVENANCE_DESCRIPTION),
      app("VYBZ Provenance", "/provenance", PROVENANCE_DESCRIPTION, {
        featureList: [
          "Per-recipient forensic watermark",
          "C2PA Content Credentials",
          "Verification of any file",
          "Leak attribution with confidence",
          "Tamper-evident ledger",
        ],
      }),
      breadcrumb([
        { name: "Home", path: "/" },
        { name: "Provenance", path: "/provenance" },
      ]),
    ],
  },
  {
    path: "/vault",
    title: "Version control for DAW projects — VYBZ Vault",
    description: VAULT_DESCRIPTION,
    jsonLd: [
      webPage("/vault", "VYBZ Vault", VAULT_DESCRIPTION),
      app("VYBZ Vault", "/vault", VAULT_DESCRIPTION, {
        featureList: ["Content-addressed blobs", "Organization-wide deduplication", "Whole-tree commits", "Branches and diffs", "Restore any ref"],
      }),
      breadcrumb([
        { name: "Home", path: "/" },
        { name: "Vault", path: "/vault" },
      ]),
    ],
  },
  {
    path: "/agents",
    title: "MCP server for audio provenance and Vault — VYBZ Agents",
    description: AGENTS_DESCRIPTION,
    jsonLd: [
      webPage("/agents", "VYBZ for AI agents", AGENTS_DESCRIPTION),
      app("@vybz/mcp-server", "/agents", AGENTS_DESCRIPTION, {
        operatingSystem: "Node.js 20+",
        downloadUrl: "https://www.npmjs.com/package/@vybz/mcp-server",
      }),
      breadcrumb([
        { name: "Home", path: "/" },
        { name: "Agents", path: "/agents" },
      ]),
    ],
  },
  {
    path: "/pricing",
    title: "Pricing — VYBZ",
    description: PRICING_DESCRIPTION,
    jsonLd: [
      webPage("/pricing", "VYBZ pricing", PRICING_DESCRIPTION),
      {
        "@type": "Product",
        name: "VYBZ",
        description: HOME_DESCRIPTION,
        brand: { "@id": ORG_ID },
        offers: [
          { "@type": "Offer", name: "Developer", price: "0", priceCurrency: "USD", url: `${SITE}/pricing`, availability: "https://schema.org/InStock" },
          {
            "@type": "Offer",
            name: "Business",
            price: "249",
            priceCurrency: "USD",
            url: `${SITE}/pricing`,
            availability: "https://schema.org/InStock",
            priceSpecification: { "@type": "UnitPriceSpecification", price: "249", priceCurrency: "USD", billingIncrement: 1, unitCode: "MON" },
          },
        ],
      },
      breadcrumb([
        { name: "Home", path: "/" },
        { name: "Pricing", path: "/pricing" },
      ]),
    ],
  },
  {
    path: "/signin",
    title: "Sign in — VYBZ",
    description: "Sign in to the VYBZ console to manage organizations, API keys, usage, and audit.",
    noindex: true,
    jsonLd: [],
  },
];

/** Curated descriptions for documentation pages. The first paragraph of a doc is the fallback. */
const DOC_DESCRIPTIONS: Record<string, string> = {
  overview: "VYBZ documentation. Provenance for forensic watermarking and leak attribution, Vault for DAW version control, one API key, a console, and an MCP server.",
  quickstart: "Five minutes from sign-up to an attributed leak: create a key, register an original, issue a watermarked copy, and detect which recipient it came from.",
  product: "What VYBZ sells and to whom: Provenance and Vault for sample libraries, sync houses, labels, distributors, AI music companies, and studios. Plans and teams.",
  provenance: "How VYBZ makes every copy traceable: the object model, the watermark, Content Credentials, verify versus detect, the ledger, formats, and limits.",
  vault: "How Vault stores DAW projects: content-addressed blobs deduplicated per organization, whole-tree commits, hashing rules, concurrency, and limits.",
  api: "REST reference for the VYBZ API at vybz.cloud/v1: conventions, error codes, platform, Provenance and Vault endpoints, scopes, and the OpenAPI 3.1 document.",
  agents: "Operate VYBZ from AI agents over the Model Context Protocol: two ways to connect, every tool, recommended prompts, the safety model, and custom integrations.",
  security: "How VYBZ protects keys and audio: identity, organization isolation, audit, Provenance integrity, transport, agent safety, data handling, and reporting.",
  architecture: "How the platform is built: services, the request path, the data model, the watermark DSP module, the Vault commit graph, and the front end.",
  operations: "Deploying and running VYBZ: environments, edge functions, secrets, Stripe modes, and runbooks for keys, chain integrity, billing, and storage growth.",
  roadmap: "What VYBZ ships next, ordered by revenue impact: compressed input, chunked upload, webhooks, batch issue, a detection queue, and a Vault console.",
  brand: "The VYBZ voice and visual system: precise, calm copy, the words we use and avoid, color tokens, type, motion, and the logo.",
  terms: "Terms of Service for the VYBZ platform, API, MCP server, and console, provided by VYBZ. Accounts, plans, payment and renewal, content, and liability.",
  privacy: "How VYBZ handles personal data on vybz.cloud and the VYBZ API: what is collected, where it lives, retention, your rights, and security.",
  "acceptable-use": "What VYBZ may not be used for, how rights holders report infringing content, and how violations are enforced. Part of the Terms of Service.",
  dpa: "Data Processing Addendum: scope and roles, nature of processing, sub-processors, security, deletion and return, audits, and international transfers.",
};

function docDescription(slug: string, body: string): string {
  return DOC_DESCRIPTIONS[slug] ?? excerpt(body);
}

function docRoutes(): RouteSeo[] {
  const out: RouteSeo[] = [];
  for (const d of DOCS) {
    const path = docPath(d, false);
    const description = docDescription(d.slug, d.body);
    const lastmod = lastUpdated(d.body);
    const overview = d.slug === "overview";
    out.push({
      path,
      title: overview ? "Documentation — VYBZ" : `${d.title} — VYBZ Docs`,
      description,
      lastmod,
      jsonLd: [
        {
          "@type": "TechArticle",
          "@id": `${SITE}${path}`,
          headline: overview ? "VYBZ documentation" : d.title,
          description,
          url: `${SITE}${path}`,
          inLanguage: "en-US",
          author: { "@id": ORG_ID },
          publisher: { "@id": ORG_ID },
          isPartOf: { "@id": SITE_ID },
          ...(lastmod ? { dateModified: lastmod } : {}),
        },
        breadcrumb(
          overview
            ? [
                { name: "Home", path: "/" },
                { name: "Docs", path: "/docs" },
              ]
            : [
                { name: "Home", path: "/" },
                { name: "Docs", path: "/docs" },
                { name: d.title, path },
              ],
        ),
      ],
    });
  }
  for (const d of LEGAL) {
    const path = docPath(d, true);
    const description = docDescription(d.slug, d.body);
    const lastmod = lastUpdated(d.body);
    out.push({
      path,
      title: `${d.title} — VYBZ`,
      description,
      lastmod,
      jsonLd: [
        webPage(path, `VYBZ ${d.title}`, description, lastmod ? { dateModified: lastmod } : {}),
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Legal", path: "/legal/terms" },
          { name: d.title, path },
        ]),
      ],
    });
  }
  return out;
}

let cache: RouteSeo[] | null = null;

/** Every route with metadata, static pages first. */
export function allRoutes(): RouteSeo[] {
  if (!cache) cache = [...STATIC_ROUTES, ...docRoutes()];
  return cache;
}

/** Routes that belong in the sitemap and get prerendered. */
export function indexableRoutes(): RouteSeo[] {
  return allRoutes().filter((r) => !r.noindex);
}

export function normalizePath(pathname: string): string {
  let p = (pathname || "/").split(/[?#]/)[0];
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

/** Metadata for a pathname. Console pages and unknown paths are never indexed. */
export function seoFor(pathname: string): RouteSeo {
  const p = normalizePath(pathname);
  const hit = allRoutes().find((r) => r.path === p);
  if (hit) return hit;
  if (p === "/console" || p.startsWith("/console/")) {
    return { path: p, title: "Console — VYBZ", description: "Organizations, API keys, usage, audit, members, and billing.", noindex: true, jsonLd: [] };
  }
  if (p === "/legal") return seoFor("/legal/terms");
  return { path: p, title: SITE_NAME, description: HOME_DESCRIPTION, noindex: true, jsonLd: [] };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function robotsFor(seo: RouteSeo): string {
  return seo.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1";
}

function canonicalFor(seo: RouteSeo): string {
  return `${SITE}${seo.path === "/" ? "/" : seo.path}`;
}

export function jsonLdString(seo: RouteSeo): string {
  const graph = seo.jsonLd.length ? seo.jsonLd : [ORG];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

/** Head fragment for the prerenderer. Replaces the region between the seo markers in index.html. */
export function headHtml(seo: RouteSeo): string {
  const url = canonicalFor(seo);
  const lines = [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}" />`,
    `<meta name="robots" content="${robotsFor(seo)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(seo.title)}" />`,
    `<meta property="og:description" content="${esc(seo.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="VYBZ. Every copy traceable. Every session recoverable." />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(seo.title)}" />`,
    `<meta name="twitter:description" content="${esc(seo.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<script type="application/ld+json" id="vz-ld">${jsonLdString(seo)}</script>`,
  ];
  return `<!-- seo:start -->\n    ${lines.join("\n    ")}\n    <!-- seo:end -->`;
}

function upsert(selector: string, create: () => HTMLElement, set: (el: HTMLElement) => void) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  set(el);
}

function meta(attr: "name" | "property", key: string, content: string) {
  upsert(
    `meta[${attr}="${key}"]`,
    () => {
      const m = document.createElement("meta");
      m.setAttribute(attr, key);
      return m;
    },
    (el) => el.setAttribute("content", content),
  );
}

/** Apply metadata to the live document. Safe to call on every navigation. */
export function applySeo(seo: RouteSeo): void {
  if (typeof document === "undefined") return;
  const url = canonicalFor(seo);
  document.title = seo.title;
  meta("name", "description", seo.description);
  meta("name", "robots", robotsFor(seo));
  meta("property", "og:title", seo.title);
  meta("property", "og:description", seo.description);
  meta("property", "og:url", url);
  meta("name", "twitter:title", seo.title);
  meta("name", "twitter:description", seo.description);
  upsert(
    'link[rel="canonical"]',
    () => {
      const l = document.createElement("link");
      l.setAttribute("rel", "canonical");
      return l;
    },
    (el) => el.setAttribute("href", url),
  );
  upsert(
    "script#vz-ld",
    () => {
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.id = "vz-ld";
      return s;
    },
    (el) => {
      el.textContent = jsonLdString(seo);
    },
  );
}
