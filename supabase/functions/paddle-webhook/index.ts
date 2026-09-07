// Supabase Edge Function: paddle-webhook
//
// Signature-verified Paddle Billing notifications. Keeps org_billing and
// orgs.plan in step with the subscription:
//   • transaction.completed (custom_data.kind = org_plan) → link customer + subscription, plan up
//   • subscription.created / activated / updated / resumed / trialing → status and period
//   • subscription.past_due                                            → status only, plan kept
//   • subscription.paused / canceled                                   → plan back to developer
//
// Deploy with --no-verify-jwt: Paddle presents no Supabase JWT; the
// Paddle-Signature header is verified with PADDLE_WEBHOOK_SECRET (Vault, env
// fallback) instead. Paddle retries on non-2xx, so every handler is
// idempotent and the function answers 200 for events it does not use.
import { admin, json } from "../_shared/edge.ts";
import { verifyPaddleSignature, mapStatus, type PaddleSubscription } from "../_shared/paddle.ts";
import { planForPrice } from "../_shared/plans.ts";

const KEEPS_PLAN = new Set(["active", "trialing", "past_due"]);

async function orgFor(sub: { id?: string; customer_id?: string; custom_data?: Record<string, unknown> | null }): Promise<string | null> {
  const fromData = sub.custom_data?.org_id;
  if (typeof fromData === "string" && /^[0-9a-f-]{36}$/i.test(fromData)) return fromData;
  if (sub.id) {
    const { data } = await admin.rpc("billing_org_for_paddle_subscription", { p_subscription: sub.id });
    if (typeof data === "string") return data;
  }
  if (sub.customer_id) {
    const { data } = await admin.rpc("billing_org_for_paddle_customer", { p_customer: sub.customer_id });
    if (typeof data === "string") return data;
  }
  return null;
}

async function applySubscription(sub: PaddleSubscription, forcedStatus?: string): Promise<void> {
  const orgId = await orgFor(sub);
  if (!orgId) { console.error("paddle webhook: no organization for subscription", sub.id, sub.customer_id); return; }
  const status = mapStatus(forcedStatus ?? sub.status);
  // The price on the subscription is the truth after plan changes; custom_data is what checkout started with.
  const fromPrice = sub.items?.map((i) => (i.price?.id ? planForPrice(i.price.id) : undefined)).find(Boolean);
  const plan = fromPrice ?? (typeof sub.custom_data?.plan === "string" ? String(sub.custom_data.plan) : "ultimate");
  const { error } = await admin.rpc("billing_apply_paddle", {
    p_org: orgId,
    p_customer: sub.customer_id ?? null,
    p_subscription: sub.id,
    p_status: status,
    p_period_end: sub.current_billing_period?.ends_at ?? null,
    p_plan: KEEPS_PLAN.has(status) ? plan : "developer",
  });
  if (error) console.error("billing_apply_paddle", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const raw = await req.text();
  if (!(await verifyPaddleSignature(req.headers.get("paddle-signature"), raw))) return json({ error: "bad signature" }, 400);

  let event: { event_id?: string; event_type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const type = String(event.event_type ?? "");
  const data = (event.data ?? {}) as Record<string, unknown>;

  try {
    if (type === "transaction.completed") {
      const custom = (data.custom_data ?? {}) as Record<string, unknown>;
      const subId = typeof data.subscription_id === "string" ? data.subscription_id : null;
      if (custom.kind === "org_plan" && typeof custom.org_id === "string" && subId) {
        await applySubscription({ id: subId, status: "active", customer_id: String(data.customer_id ?? ""), custom_data: custom } as PaddleSubscription);
      }
    } else if (type.startsWith("subscription.")) {
      const sub = data as unknown as PaddleSubscription;
      const forced = type === "subscription.canceled" ? "canceled" : type === "subscription.paused" ? "paused" : undefined;
      await applySubscription(sub, forced);
    }
  } catch (e) {
    console.error("paddle webhook", type, (e as Error).message);
    return json({ error: "handler" }, 500);
  }
  return json({ received: true, event_id: event.event_id ?? null });
});
