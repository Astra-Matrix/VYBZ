// Supabase Edge Function: billing-usage-report
//
// Monthly overage billing for metered plans. For each organization on Business
// or Enterprise with an active subscription, computes last month's usage beyond
// the included quantities and creates Stripe invoice items on the customer, so
// they land on the next subscription invoice. Idempotent per organization and
// month via billing_usage_reports.
//
//   POST .../billing-usage-report            → reports the previous month
//   POST .../billing-usage-report?period=2026-08-01
//   POST .../billing-usage-report?dry_run=1  → compute only, no Stripe writes
//
// Auth: header x-cron-secret == BILLING_CRON_SECRET (or DIGEST_CRON_SECRET), or
// a service-role Bearer. Deploy with --no-verify-jwt. Schedule: 1st of each
// month, 06:00 UTC.
import { admin, json } from "../_shared/edge.ts";
import { stripe } from "../_shared/stripe.ts";

const RATES = {
  issuance_cents: 2,      // $0.02 per issuance over the included amount
  detection_cents: 10,    // $0.10 per detection
  storage_gb_cents: 1.5,  // $0.015 per GB-month
};

function authorized(req: Request): boolean {
  const secret = Deno.env.get("BILLING_CRON_SECRET") ?? Deno.env.get("DIGEST_CRON_SECRET") ?? "";
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (secret && hdr && hdr === secret) return true;
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
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
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
      for (const l of lines) {
        if (l.amount < 1) continue;
        const item = await stripe.invoiceItems.create({
          customer: String(r.stripe_customer_id),
          currency: "usd",
          amount: l.amount,
          description: l.description,
          metadata: { vybz_org_id: String(r.org_id), period },
        });
        items.push(item.id);
      }
      await admin.rpc("billing_usage_report_record", {
        p_org: r.org_id, p_period: period, p_plan: r.plan,
        p_issuances: r.issuances, p_detections: r.detections, p_storage_bytes: r.storage_bytes,
        p_over_issuances: overI, p_over_detections: overD, p_over_storage_gb: overG,
        p_amount_cents: total, p_items: items,
      });
    }
    results.push({ org_id: r.org_id, org: r.org_name, plan: r.plan, over: { issuances: overI, detections: overD, storage_gb: Number(overG.toFixed(3)) }, amount_cents: total, invoice_items: items });
  }
  return json({ period, dry_run: dryRun, organizations: results.length, results });
});
