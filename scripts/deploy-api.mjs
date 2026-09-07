// Deploy the api-v1 edge function without the Supabase CLI.
//
// Bundles supabase/functions/api-v1/index.ts with esbuild (the four npm audio
// decoders and esm.sh stay external and resolve through deno.json), then
// uploads the bundle plus its import map through the Supabase Management API.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... npm run api:deploy
//
// The token is a personal access token from supabase.com/dashboard/account/tokens.
// It is read from the environment only and never written anywhere.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "xixmneooyufbeftdfpcm";
const SLUG = "api-v1";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN to a personal access token (supabase.com/dashboard/account/tokens).");
  process.exit(2);
}

const out = mkdtempSync(join(tmpdir(), "vybz-api-v1-"));
const bundle = join(out, "index.js");
const build = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "esbuild", "supabase/functions/api-v1/index.ts", "--bundle", "--minify", "--format=esm", "--platform=neutral", "--target=esnext",
    "--external:mpg123-decoder", "--external:@wasm-audio-decoders/flac", "--external:@wasm-audio-decoders/ogg-vorbis",
    "--external:ogg-opus-decoder", "--external:https://esm.sh/*", `--outfile=${bundle}`,
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const importMap = readFileSync("supabase/functions/api-v1/deno.json", "utf8");
writeFileSync(join(out, "deno.json"), importMap);
const js = readFileSync(bundle);
console.log(`bundle: ${(js.byteLength / 1024).toFixed(1)} KB`);

// Management API: multipart with a `metadata` JSON part and one `file` part per source.
const form = new FormData();
form.append("metadata", JSON.stringify({ name: SLUG, entrypoint_path: "index.js", import_map_path: "deno.json", verify_jwt: false }));
form.append("file", new Blob([js], { type: "application/javascript" }), "index.js");
form.append("file", new Blob([importMap], { type: "application/json" }), "deno.json");

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${SLUG}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const text = await res.text();
if (!res.ok) {
  console.error(`deploy failed: ${res.status} ${res.statusText}\n${text}`);
  process.exit(1);
}
let info = {};
try { info = JSON.parse(text); } catch { /* not JSON */ }
console.log(`deployed ${SLUG} v${info.version ?? "?"} (${info.status ?? "ok"})`);

// Smoke: the public descriptor and the OpenAPI document must render.
const base = process.env.API_PUBLIC_BASE ?? "https://vybz.cloud/v1";
for (const path of ["", "/openapi.json"]) {
  const r = await fetch(`${base}${path}`);
  const ok = r.ok && (path ? (await r.json()).paths?.["/vault/repos/{repo}/uploads"] : (await r.json()).object === "vybz.api");
  console.log(`${ok ? "ok " : "FAIL"} GET ${base}${path || "/"} -> ${r.status}`);
  if (!ok) process.exitCode = 1;
}
