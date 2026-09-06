// Supabase Edge Function: billing-checkout
//
// Console → Stripe for organization plans.
//   POST { action: "checkout", orgId, origin? } → { url }   Business subscription Checkout
//   POST { action: "portal",   orgId, origin? } → { url }   Stripe Billing Portal
//   POST { action: "status",   orgId }          → { plan, billing, usage }
//
// Caller must be an org admin (Supabase JWT, self-verified). Deploy with
// --no-verify-jwt. Secrets: STRIPE_SECRET_KEY (env), STRIPE_PRICE_BUSINESS
// (Vault, env fallback). Without a price id, Checkout uses inline recurring
// price_data at $249/month.
import { admin, CORS, json, callerId } from "../_shared/edge.ts";
import { stripe } from "../_shared/stripe.ts";
import { secret } from "../_shared/secrets.ts";

const BUSINESS_CENTS = 24900;

async function isAdmin(orgId: string, uid: string): Promise<boolean> {
  const { data } = await admin.rpc("is_org_admin", { p_org: orgId, p_uid: uid });
  return data === true;
}

async function ensureCustomer(orgId: string, email: string | null): Promise<string> {
  const { data: b } = await admin.from("org_billing").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
  if (b?.stripe_customer_id) return b.stripe_customer_id;
  const { data: org } = await admin.from("orgs").select("name,slug").eq("id", orgId).single();
  const customer = await stripe.customers.create({
    name: org?.name ?? "VYBZ organization",
    email: email ?? undefined,
    metadata: { vybz_org_id: orgId, vybz_org_slug: org?.slug ?? "" },
  });
  await admin.rpc("billing_apply", { p_org: orgId, p_customer: customer.id, p_subscription: null, p_status: "none", p_period_end: null, p_plan: null });
  return customer.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const uid = await callerId(req);
  if (!uid) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const orgId = String(body.orgId ?? "");
  const action = String(body.action ?? "checkout");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: "orgId required" }, 400);
  if (!(await isAdmin(orgId, uid))) return json({ error: "forbidden" }, 403);

  const origin = typeof body.origin === "string" && body.origin.startsWith("http")
    ? body.origin
    : (Deno.env.get("APP_URL") ?? "https://vybz.cloud");
  const PRICE_BUSINESS = await secret("STRIPE_PRICE_BUSINESS");

  try {
    if (action === "status") {
      const [{ data: org }, { data: billing }, { data: usage }] = await Promise.all([
        admin.from("orgs").select("plan").eq("id", orgId).single(),
        admin.from("org_billing").select("status,current_period_end,stripe_subscription_id").eq("org_id", orgId).maybeSingle(),
        admin.rpc("org_plan_usage", { p_org: orgId }),
      ]);
      const u = Array.isArray(usage) ? usage[0] : usage;
      return json({ plan: org?.plan ?? "developer", billing: billing ?? { status: "none" }, usage: u ?? null, price_configured: Boolean(PRICE_BUSINESS) });
    }

    const { data: userRes } = await admin.auth.admin.getUserById(uid);
    const customer = await ensureCustomer(orgId, userRes?.user?.email ?? null);

    if (action === "portal") {
      const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/console/billing` });
      return json({ url: portal.url });
    }

    const lineItem = PRICE_BUSINESS
      ? { price: PRICE_BUSINESS, quantity: 1 }
      : {
          price_data: {
            currency: "usd",
            unit_amount: BUSINESS_CENTS,
            recurring: { interval: "month" as const },
            product_data: { name: "VYBZ Business", description: "Provenance and Vault. 10,000 issuances and 2,000 detections per month included, 1 TB Vault, Content Credentials, 99.9% SLA." },
          },
          quantity: 1,
        };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [lineItem],
      allow_promotion_codes: true,
      success_url: `${origin}/console/billing?checkout=success`,
      cancel_url: `${origin}/console/billing?checkout=cancel`,
      subscription_data: { metadata: { kind: "org_plan", org_id: orgId, plan: "business" } },
      metadata: { kind: "org_plan", org_id: orgId, plan: "business" },
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: (e as Error).message ?? "stripe error" }, 400);
  }
});
