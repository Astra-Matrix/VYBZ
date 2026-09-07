// Deploy edge functions without the Supabase CLI.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... npm run api:deploy                 # api-v1
//   SUPABASE_ACCESS_TOKEN=sbp_... npm run api:deploy -- paddle-webhook billing-checkout
//
// Each function is bundled with esbuild (npm audio decoders and esm.sh imports
// stay external and resolve at runtime; a deno.json import map is included
// when the function has one) and uploaded through the Management API. The
// token is a personal access token from supabase.com/dashboard/account/tokens,
// read from the environment only.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "xixmneooyufbeftdfpcm";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN to a personal access token (supabase.com/dashboard/account/tokens).");
  process.exit(2);
}
const slugs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!slugs.length) slugs.push("api-v1");

async function deploy(slug) {
  const src = `supabase/functions/${slug}/index.ts`;
  if (!existsSync(src)) { console.error(`no such function: ${src}`); process.exit(2); }
  const out = mkdtempSync(join(tmpdir(), `vybz-${slug}-`));
  const bundle = join(out, "index.js");
  const build = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "esbuild", src, "--bundle", "--minify", "--format=esm", "--platform=neutral", "--target=esnext",
      "--external:mpg123-decoder", "--external:@wasm-audio-decoders/flac", "--external:@wasm-audio-decoders/ogg-vorbis",
      "--external:ogg-opus-decoder", "--external:https://esm.sh/*", `--outfile=${bundle}`,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
  const js = readFileSync(bundle);
  console.log(`${slug}: bundle ${(js.byteLength / 1024).toFixed(1)} KB`);

  const importMapPath = `supabase/functions/${slug}/deno.json`;
  const hasMap = existsSync(importMapPath);
  const form = new FormData();
  form.append("metadata", JSON.stringify({ name: slug, entrypoint_path: "index.js", ...(hasMap ? { import_map_path: "deno.json" } : {}), verify_jwt: false }));
  form.append("file", new Blob([js], { type: "application/javascript" }), "index.js");
  if (hasMap) {
    const importMap = readFileSync(importMapPath, "utf8");
    writeFileSync(join(out, "deno.json"), importMap);
    form.append("file", new Blob([importMap], { type: "application/json" }), "deno.json");
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${slug}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) { console.error(`deploy ${slug} failed: ${res.status} ${res.statusText}\n${text}`); process.exit(1); }
  let info = {};
  try { info = JSON.parse(text); } catch { /* not JSON */ }
  console.log(`deployed ${slug} v${info.version ?? "?"} (${info.status ?? "ok"})`);
}

for (const slug of slugs) await deploy(slug);

// Smoke for the gateway: the public descriptor and the OpenAPI document must render.
if (slugs.includes("api-v1")) {
  const base = process.env.API_PUBLIC_BASE ?? "https://vybz.cloud/v1";
  for (const path of ["", "/openapi.json"]) {
    const r = await fetch(`${base}${path}`);
    const ok = r.ok && (path ? (await r.json()).paths?.["/vault/repos/{repo}/uploads"] : (await r.json()).object === "vybz.api");
    console.log(`${ok ? "ok " : "FAIL"} GET ${base}${path || "/"} -> ${r.status}`);
    if (!ok) process.exitCode = 1;
  }
}
