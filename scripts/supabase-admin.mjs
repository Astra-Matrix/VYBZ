// Small Supabase Management API helper for machines without the Supabase CLI.
// Reads SUPABASE_ACCESS_TOKEN (a personal access token) from the environment only.
//
//   node scripts/supabase-admin.mjs secrets set NAME=value [NAME=value ...]
//   node scripts/supabase-admin.mjs secrets list
//   node scripts/supabase-admin.mjs functions list
//   node scripts/supabase-admin.mjs functions delete <slug> [<slug> ...]
//
// npm aliases: `npm run secrets:set -- NAME=value`, `npm run functions:list`.

const REF = process.env.SUPABASE_PROJECT_REF ?? "xixmneooyufbeftdfpcm";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN to a personal access token (supabase.com/dashboard/account/tokens).");
  process.exit(2);
}
const api = async (method, path, body) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${path} -> ${res.status}\n${text}`);
    process.exit(1);
  }
  try { return JSON.parse(text); } catch { return text; }
};

const [area, verb, ...rest] = process.argv.slice(2);
if (area === "secrets" && verb === "set") {
  const pairs = rest.map((kv) => {
    const i = kv.indexOf("=");
    if (i <= 0) { console.error(`Expected NAME=value, got ${kv}`); process.exit(2); }
    return { name: kv.slice(0, i), value: kv.slice(i + 1) };
  });
  if (!pairs.length) { console.error("Nothing to set."); process.exit(2); }
  await api("POST", "/secrets", pairs);
  console.log(`set ${pairs.map((p) => p.name).join(", ")} (edge functions pick them up on the next invocation)`);
} else if (area === "secrets" && verb === "list") {
  for (const s of await api("GET", "/secrets")) console.log(s.name);
} else if (area === "functions" && verb === "list") {
  for (const f of await api("GET", "/functions")) console.log(`${f.slug}\tv${f.version}\t${f.status}\t${f.updated_at ? new Date(f.updated_at).toISOString().slice(0, 10) : ""}`);
} else if (area === "functions" && verb === "delete") {
  if (!rest.length) { console.error("Give at least one slug."); process.exit(2); }
  for (const slug of rest) {
    await api("DELETE", `/functions/${slug}`);
    console.log(`deleted ${slug}`);
  }
} else {
  console.error("Usage: secrets set NAME=value ... | secrets list | functions list | functions delete <slug> ...");
  process.exit(2);
}
