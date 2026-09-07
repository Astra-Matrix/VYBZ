// Supabase Edge Function: billing-usage-report
//
// Monthly overage billing for metered plans. For each organization on Business
// or Enterprise with an active subscription, computes last month's usage beyond
// the included quantities and bills it through the organization's provider:
// a one-time charge on the Paddle subscription (collected with the next
// renewal), or Stripe invoice items for organizations still linked there. Idempotent per organization and
// month via billing_usage_reports.
//
//   POST .../billing-usage-report            → reports the previous month
//   POST .../billing-usage-report?period=2026-08-01
//   POST .../billing-usage-report?dry_run=1  → compute only, no Stripe writes
//
// Auth: header x-cron-secret == BILLING_CRON_SECRET (Vault, env fallback; or
// DIGEST_CRON_SECRET), or a service-role Bearer. Deploy with --no-verify-jwt.
// Scheduled by pg_cron (migration 0119) on the 1st of each month, 06:00 UTC.
import { admin, json } from "../_shared/edge.ts";
import { secret } from "../_shared/secrets.ts";
import { paddle } from "../_shared/paddle.ts";

const RATES = {
  issuance_cents: 2,      // $0.02 per issuance over the included amount
  detection_cents: 10,    // $0.10 per detection
  storage_gb_cents: 1.5,  // $0.015 per GB-month
};

async function authorized(req: Request): Promise<boolean> {
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (hdr) {
    const s = await secret("BILLING_CRON_SECRET");
    if (s && hdr === s) return true;
    const d = Deno.env.get("DIGEST_CRON_SECRET") ?? "";
    if (d && hdr === d) return true;
  }
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return Boolean(service) && bearer === service;
}

function previousMonth(): string {
  const d = new Date();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return first.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const period = /^\d{4}-\d{2}-01$/.test(url.searchParams.get("period") ?? "") ? url.searchParams.get("period")! : previousMonth();
  const dryRun = url.searchParams.get("dry_run") === "1";
  const label = period.slice(0, 7);

  const { data: rows, error } = await admin.rpc("billing_overages", { p_period: period });
  if (error) return json({ error: error.message }, 500);

  const results: unknown[] = [];
  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    const overI = Number(r.over_issuances ?? 0);
    const overD = Number(r.over_detections ?? 0);
    const overG = Number(r.over_storage_gb ?? 0);
    const lines: Array<{ amount: number; description: string }> = [];
    if (overI > 0) lines.push({ amount: Math.round(overI * RATES.issuance_cents), description: `VYBZ Provenance issuances over plan, ${label}: ${overI} × $0.02` });
    if (overD > 0) lines.push({ amount: Math.round(overD * RATES.detection_cents), description: `VYBZ Provenance detections over plan, ${label}: ${overD} × $0.10` });
    if (overG > 0) lines.push({ amount: Math.round(overG * RATES.storage_gb_cents), description: `VYBZ storage over plan, ${label}: ${overG.toFixed(2)} GB × $0.015` });
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const items: string[] = [];
    if (!dryRun) {
      const billable = lines.filter((l) => l.amount >= 1);
      if (billable.length && r.provider === "paddle" && r.paddle_subscription_id) {
        // One charge with one non-catalog item per overage line, applied to the next renewal.
        await paddle("POST", `/subscriptions/${r.paddle_subscription_id}/charge`, {
          effective_from: "next_billing_period",
          items: billable.map((l) => ({
            quantity: 1,
            price: {
              description: l.description,
              name: l.description.slice(0, 60),
              unit_price: { amount: String(l.amount), currency_code: "USD" },
              tax_mode: "account_setting",
              product: { name: "VYBZ usage", tax_category: "saas" },
              custom_data: { vybz_org_id: String(r.org_id), period },
            },
          })),
        });
        items.push(`paddle:${r.paddle_subscription_id}:${period}`);
      } else if (billable.length && r.stripe_customer_id) {
        const { stripe } = await import("../_shared/stripe.ts");
        for (const l of billable) {
          const item = await stripe.invoiceItems.create({
            customer: String(r.stripe_customer_id),
            currency: "usd",
            amount: l.amount,
            description: l.description,
            metadata: { vybz_org_id: String(r.org_id), period },
          });
          items.push(item.id);
        }
      }
      await admin.rpc("billing_usage_report_record", {
        p_org: r.org_id, p_period: period, p_plan: r.plan,
        p_issuances: r.issuances, p_detections: r.detections, p_storage_bytes: r.storage_bytes,
        p_over_issuances: overI, p_over_detections: overD, p_over_storage_gb: overG,
        p_amount_cents: total, p_items: items,
      });
    }
    results.push({ org_id: r.org_id, org: r.org_name, plan: r.plan, provider: r.provider, over: { issuances: overI, detections: overD, storage_gb: Number(overG.toFixed(3)) }, amount_cents: total, invoice_items: items });
  }
  return json({ period, dry_run: dryRun, organizations: results.length, results });
});
