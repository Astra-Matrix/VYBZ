/**
 * Console data layer. Everything goes through Supabase RPCs and RLS-guarded
 * tables; the plaintext API key exists in the browser only for the moment it
 * is shown after creation.
 */
import { supabase } from "@/lib/supabase";

export type Org = { id: string; name: string; slug: string; plan: "developer" | "business" | "enterprise"; created_at: string };
export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rate_limit_per_min: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};
export type CreatedKey = { id: string; prefix: string; key: string; scopes: string[]; created_at: string };
export type UsageRow = { day: string; product: "provenance" | "vault" | "platform"; calls: number; bytes_in: number; bytes_out: number };
export type AuditRow = {
  seq: number;
  method: string;
  path: string;
  status: number;
  duration_ms: number | null;
  bytes_in: number | null;
  bytes_out: number | null;
  agent: string | null;
  request_id: string | null;
  created_at: string;
  key_id: string | null;
};

export const SCOPES: Array<{ id: string; label: string; hint: string }> = [
  { id: "org:read", label: "Organization", hint: "Read org and key metadata (whoami)" },
  { id: "provenance:read", label: "Provenance read", hint: "List assets, issuances, ledger, verify" },
  { id: "provenance:write", label: "Provenance write", hint: "Register originals, issue copies" },
  { id: "provenance:detect", label: "Provenance detect", hint: "Attribute suspect files" },
  { id: "vault:read", label: "Vault read", hint: "Repos, history, trees, blobs" },
  { id: "vault:write", label: "Vault write", hint: "Upload blobs, commit, branch" },
];

function client() {
  if (!supabase) throw new Error("Backend not configured.");
  return supabase;
}

export async function listOrgs(): Promise<Org[]> {
  const { data, error } = await client().rpc("my_orgs");
  if (error) throw new Error(error.message);
  return (data ?? []) as Org[];
}

export async function createOrg(name: string, slug: string): Promise<Org> {
  const { data, error } = await client().rpc("org_create", { p_name: name, p_slug: slug });
  if (error) throw new Error(friendly(error.message));
  return data as Org;
}

export async function listKeys(orgId: string): Promise<ApiKeyRow[]> {
  const { data, error } = await client().rpc("api_keys_list", { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApiKeyRow[];
}

export async function createKey(orgId: string, name: string, scopes: string[], rateLimit: number, expiresAt: string | null): Promise<CreatedKey> {
  const { data, error } = await client().rpc("api_key_create", {
    p_org: orgId,
    p_name: name,
    p_scopes: scopes,
    p_rate_limit: rateLimit,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(friendly(error.message));
  const row = Array.isArray(data) ? data[0] : data;
  return row as CreatedKey;
}

export async function revokeKey(keyId: string): Promise<void> {
  const { error } = await client().rpc("api_key_revoke", { p_key: keyId });
  if (error) throw new Error(friendly(error.message));
}

export async function usage(orgId: string, days = 30): Promise<UsageRow[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await client()
    .from("api_usage_daily")
    .select("day,product,calls,bytes_in,bytes_out")
    .eq("org_id", orgId)
    .gte("day", since)
    .order("day", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as UsageRow[];
}

export async function audit(orgId: string, limit = 100): Promise<AuditRow[]> {
  const { data, error } = await client()
    .from("api_audit_log")
    .select("seq,method,path,status,duration_ms,bytes_in,bytes_out,agent,request_id,created_at,key_id")
    .eq("org_id", orgId)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditRow[];
}

export async function counts(orgId: string): Promise<{ assets: number; issuances: number; repos: number; commits: number }> {
  const c = client();
  const q = (table: string) => c.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const [a, i, r, m] = await Promise.all([q("provenance_assets"), q("provenance_issuances"), q("vault_repos"), q("vault_commits")]);
  return { assets: a.count ?? 0, issuances: i.count ?? 0, repos: r.count ?? 0, commits: m.count ?? 0 };
}

export async function chainStatus(orgId: string): Promise<{ ok: boolean; length: number; first_bad_seq: number | null } | null> {
  const { data, error } = await client().rpc("provenance_chain_verify", { p_org: orgId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

function friendly(msg: string): string {
  if (/orgs_slug_key|duplicate key/.test(msg)) return "That slug is taken. Choose another.";
  if (/violates check constraint "orgs_slug_check"/.test(msg)) return "Slugs are 3–40 lowercase letters, digits, and hyphens.";
  if (/forbidden/.test(msg)) return "You do not have permission to do that in this organization.";
  return msg;
}

export function slugFromName(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}

export function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Team ────────────────────────────────────────────────────────────────────
export type MemberRow = { user_id: string; email: string; role: "owner" | "admin" | "member"; created_at: string };
export type InviteRow = { id: string; email: string; role: string; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };

export async function members(orgId: string): Promise<MemberRow[]> {
  const { data, error } = await client().rpc("org_members_list", { p_org: orgId });
  if (error) throw new Error(friendly(error.message));
  return (data ?? []) as MemberRow[];
}
export async function invites(orgId: string): Promise<InviteRow[]> {
  const { data, error } = await client().rpc("org_invites_list", { p_org: orgId });
  if (error) throw new Error(friendly(error.message));
  return (data ?? []) as InviteRow[];
}
export async function inviteCreate(orgId: string, email: string, role: "admin" | "member"): Promise<{ id: string; token: string; email: string }> {
  const { data, error } = await client().rpc("org_invite_create", { p_org: orgId, p_email: email, p_role: role });
  if (error) throw new Error(friendly(error.message));
  const row = Array.isArray(data) ? data[0] : data;
  return row as { id: string; token: string; email: string };
}
export async function inviteRevoke(id: string): Promise<void> {
  const { error } = await client().rpc("org_invite_revoke", { p_id: id });
  if (error) throw new Error(friendly(error.message));
}
export async function inviteAccept(token: string): Promise<Org> {
  const { data, error } = await client().rpc("org_invite_accept", { p_token: token });
  if (error) throw new Error(friendly(error.message));
  return data as Org;
}
export async function memberSetRole(orgId: string, userId: string, role: "admin" | "member"): Promise<void> {
  const { error } = await client().rpc("org_member_set_role", { p_org: orgId, p_user: userId, p_role: role });
  if (error) throw new Error(friendly(error.message));
}
export async function memberRemove(orgId: string, userId: string): Promise<void> {
  const { error } = await client().rpc("org_member_remove", { p_org: orgId, p_user: userId });
  if (error) throw new Error(friendly(error.message));
}

// ── Billing ─────────────────────────────────────────────────────────────────
export type PlanUsage = {
  plan: string; issuances_month: number; detections_month: number; storage_bytes: number;
  limit_issuances: number; limit_detections: number; limit_storage: number; hard_cap: boolean;
};
export type BillingStatus = {
  plan: "developer" | "business" | "enterprise";
  billing: { status: string; current_period_end?: string | null; stripe_subscription_id?: string | null };
  usage: PlanUsage | null;
  price_configured: boolean;
};
async function billingCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke("billing-checkout", { body: { ...body, origin: window.location.origin } });
  if (error) throw new Error(error.message ?? "Billing is unavailable right now.");
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}
export function billingStatus(orgId: string) { return billingCall<BillingStatus>({ action: "status", orgId }); }
export function billingCheckout(orgId: string) { return billingCall<{ url: string }>({ action: "checkout", orgId }); }
export function billingPortal(orgId: string) { return billingCall<{ url: string }>({ action: "portal", orgId }); }
