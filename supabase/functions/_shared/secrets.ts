// Platform secrets: Supabase Vault first (managed in SQL via vault.create_secret and
// read through public.platform_secret), environment second. Vault wins so a value
// rotated in the database takes effect without a redeploy or dashboard edit.
import { admin } from "./edge.ts";

const cache = new Map<string, { v: string; at: number }>();

export async function secret(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v = "";
  try {
    const { data } = await admin.rpc("platform_secret", { p_name: name });
    if (typeof data === "string" && data) v = data;
  } catch { /* fall through to env */ }
  if (!v) v = Deno.env.get(name) ?? "";
  cache.set(name, { v, at: Date.now() });
  return v;
}
