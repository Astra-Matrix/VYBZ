// Prerenders every indexable route to static HTML with route-specific head tags,
// and writes sitemap.xml and llms-full.txt. Runs after `vite build`.
import { build } from "vite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const ssrDir = resolve(root, "dist-ssr");
const SITE = "https://vybz.cloud";

if (!existsSync(resolve(dist, "index.html"))) {
  console.error("prerender: dist/index.html missing; run `vite build` first");
  process.exit(1);
}

await build({
  configFile: resolve(root, "vite.config.ts"),
  logLevel: "warn",
  build: {
    ssr: resolve(root, "src/entry-server.tsx"),
    outDir: ssrDir,
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "entry-server.mjs" } },
  },
});

const { render, routes, llmsFull } = await import(pathToFileURL(resolve(ssrDir, "entry-server.mjs")).href);
const template = readFileSync(resolve(dist, "index.html"), "utf8");
const marker = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
if (!marker.test(template) || !template.includes('<div id="root"></div>')) {
  console.error("prerender: index.html is missing the seo markers or the root element");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const urls = [];
for (const r of routes) {
  const { html, head } = render(r.path);
  const page = template.replace(marker, () => head).replace('<div id="root"></div>', () => `<div id="root">${html}</div>`);
  const out = r.path === "/" ? resolve(dist, "index.html") : resolve(dist, `.${r.path}`, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page);
  urls.push({ loc: `${SITE}${r.path === "/" ? "/" : r.path}`, lastmod: r.lastmod ?? today });
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join("\n")}
</urlset>
`;
writeFileSync(resolve(dist, "sitemap.xml"), sitemap);
// Clean shell for routes that are not prerendered (console, sign in, unknown paths).
// vercel.json rewrites those to /app.html so the client mounts fresh instead of
// hydrating against the home page markup.
writeFileSync(resolve(dist, "app.html"), template.replace(marker, () => render("/signin").head));
writeFileSync(resolve(dist, "llms-full.txt"), llmsFull());
rmSync(ssrDir, { recursive: true, force: true });
console.log(`prerender: ${urls.length} pages, sitemap.xml, llms-full.txt`);
