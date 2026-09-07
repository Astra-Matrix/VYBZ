// Supabase Edge Function: billing-checkout
//
// Console → billing provider for organization plans. Paddle is the provider
// (merchant of record); the Stripe path remains for organizations linked
// before the switch and is selected by BILLING_PROVIDER=stripe.
//   POST { action: "status",   orgId }
//        → { plan, billing, usage, provider, paddle: { client_token, environment } }
//   POST { action: "checkout", orgId, plan, interval, origin? }
//        Paddle → { provider: "paddle", transaction_id, url }   new subscription; open with Paddle.js
//        Stripe → { provider: "stripe", url }
//   POST { action: "change",   orgId, plan, interval }
//        Paddle → { provider: "paddle", changed: true, plan, interval }   existing subscription moved to another price
//   POST { action: "portal",   orgId, origin? } → { url }
//
// `plan` is creator | pro | ultimate and `interval` is month | year; prices
// come from _shared/plans.ts for the configured PADDLE_ENV. Every new
// subscription starts with the 14-day trial carried by the price.
//
// Caller must be an org admin (Supabase JWT, self-verified). Deploy with
// --no-verify-jwt. Secrets: BILLING_PROVIDER, PADDLE_API_KEY, PADDLE_ENV,
// PADDLE_CLIENT_TOKEN (public, handed to the console); STRIPE_* for the
// Stripe path.
import { admin, CORS, json, callerId } from "../_shared/edge.ts";
import { secret } from "../_shared/secrets.ts";
import { paddle, PADDLE_ENV, PaddleError } from "../_shared/paddle.ts";
import { PADDLE_PRICES, PLAN_RANK, isPaidPlan, planById, type Interval, type PaidPlanId } from "../_shared/plans.ts";

async function provider(): Promise<"paddle" | "stripe"> {
  const p = (await secret("BILLING_PROVIDER")).toLowerCase();
  if (p === "stripe" || p === "paddle") return p;
  return Deno.env.get("PADDLE_API_KEY") ? "paddle" : "stripe";
}

async function isAdmin(orgId: string, uid: string): Promise<boolean> {
  const { data } = await admin.rpc("is_org_admin", { p_org: orgId, p_uid: uid });
  return data === true;
}

function parseSelection(body: Record<string, unknown>): { plan: PaidPlanId; interval: Interval; priceId: string } {
  const plan = String(body.plan ?? "pro");
  const interval = body.interval === "year" ? "year" : "month";
  if (!isPaidPlan(plan)) throw new Error("`plan` must be creator, pro, or ultimate.");
  return { plan, interval, priceId: PADDLE_PRICES[PADDLE_ENV][plan][interval] };
}

// ── Paddle ──────────────────────────────────────────────────────────────────

type PaddleCustomer = { id: string; email: string };

async function ensurePaddleCustomer(orgId: string, email: string | null): Promise<string> {
  const { data: b } = await admin.from("org_billing").select("paddle_customer_id").eq("org_id", orgId).maybeSingle();
  if (b?.paddle_customer_id) return b.paddle_customer_id;
  const { data: org } = await admin.from("orgs").select("name,slug").eq("id", orgId).single();
  if (!email) throw new Error("The signed-in user has no email address to bill.");
  let customer: PaddleCustomer;
  try {
    customer = await paddle<PaddleCustomer>("POST", "/customers", {
      email,
      name: org?.name ?? "VYBZ organization",
      custom_data: { vybz_org_id: orgId, vybz_org_slug: org?.slug ?? "" },
    });
  } catch (e) {
    if (!(e instanceof PaddleError) || e.code !== "customer_already_exists") throw e;
    const found = await paddle<PaddleCustomer[]>("GET", `/customers?email=${encodeURIComponent(email)}&status=active`);
    if (!found?.length) throw e;
    customer = found[0];
  }
  await admin.rpc("billing_apply_paddle", { p_org: orgId, p_customer: customer.id, p_subscription: null, p_status: "none", p_period_end: null, p_plan: null });
  return customer.id;
}

async function paddleCheckout(orgId: string, email: string | null, origin: string, sel: { plan: PaidPlanId; interval: Interval; priceId: string }) {
  const customer = await ensurePaddleCustomer(orgId, email);
  const body: Record<string, unknown> = {
    items: [{ price_id: sel.priceId, quantity: 1 }],
    customer_id: customer,
    collection_mode: "automatic",
    custom_data: { kind: "org_plan", org_id: orgId, plan: sel.plan, interval: sel.interval },
  };
  let tx: { id: string; checkout?: { url?: string | null } | null };
  try {
    tx = await paddle("POST", "/transactions", { ...body, checkout: { url: `${origin}/console/billing` } });
  } catch (e) {
    if (!(e instanceof PaddleError) || e.status !== 400) throw e;
    tx = await paddle("POST", "/transactions", body);
  }
  return { provider: "paddle", transaction_id: tx.id, url: tx.checkout?.url ?? null, plan: sel.plan, interval: sel.interval };
}

/**
 * Move an existing subscription to another plan or interval. Upgrades are
 * prorated and charged now; downgrades take effect at the next renewal with
 * no refund, as the terms state. The webhook applies the plan when Paddle
 * confirms the change.
 */
async function paddleChange(orgId: string, sel: { plan: PaidPlanId; interval: Interval; priceId: string }) {
  const [{ data: b }, { data: org }] = await Promise.all([
    admin.from("org_billing").select("paddle_subscription_id,status").eq("org_id", orgId).maybeSingle(),
    admin.from("orgs").select("plan").eq("id", orgId).single(),
  ]);
  if (!b?.paddle_subscription_id || !["active", "trialing", "past_due"].includes(String(b.status))) {
    throw new Error("There is no active subscription to change. Start one first.");
  }
  const currentRank = PLAN_RANK[(org?.plan ?? "developer") as keyof typeof PLAN_RANK] ?? 0;
  const upgrade = PLAN_RANK[sel.plan] >= currentRank;
  const sub = await paddle<{ status: string; items: Array<{ price: { id: string } }> }>("PATCH", `/subscriptions/${b.paddle_subscription_id}`, {
    items: [{ price_id: sel.priceId, quantity: 1 }],
    proration_billing_mode: b.status === "trialing" ? "do_not_bill" : upgrade ? "prorated_immediately" : "full_next_billing_period",
    custom_data: { kind: "org_plan", org_id: orgId, plan: sel.plan, interval: sel.interval },
  });
  return { provider: "paddle", changed: true, plan: sel.plan, interval: sel.interval, status: sub.status, effective: upgrade || b.status === "trialing" ? "now" : "next_billing_period" };
}

async function paddlePortal(orgId: string, email: string | null) {
  const customer = await ensurePaddleCustomer(orgId, email);
  const { data: b } = await admin.from("org_billing").select("paddle_subscription_id").eq("org_id", orgId).maybeSingle();
  const session = await paddle<{ urls: { general: { overview: string } } }>("POST", `/customers/${customer}/portal-sessions`, b?.paddle_subscription_id ? { subscription_ids: [b.paddle_subscription_id] } : {});
  return { provider: "paddle", url: session.urls.general.overview };
}

// ── Stripe (legacy path) ────────────────────────────────────────────────────

async function stripeClient() {
  const mod = await import("../_shared/stripe.ts");
  return mod.stripe;
}

async function ensureStripeCustomer(orgId: string, email: string | null): Promise<string> {
  const { data: b } = await admin.from("org_billing").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
  if (b?.stripe_customer_id) return b.stripe_customer_id;
  const stripe = await stripeClient();
  const { data: org } = await admin.from("orgs").select("name,slug").eq("id", orgId).single();
  const customer = await stripe.customers.create({
    name: org?.name ?? "VYBZ organization",
    email: email ?? undefined,
    metadata: { vybz_org_id: orgId, vybz_org_slug: org?.slug ?? "" },
  });
  await admin.rpc("billing_apply", { p_org: orgId, p_customer: customer.id, p_subscription: null, p_status: "none", p_period_end: null, p_plan: null });
  return customer.id;
}

async function stripeCheckout(orgId: string, email: string | null, origin: string) {
  const stripe = await stripeClient();
  const PRICE_BUSINESS = await secret("STRIPE_PRICE_BUSINESS");
  const customer = await ensureStripeCustomer(orgId, email);
  const lineItem = PRICE_BUSINESS
    ? { price: PRICE_BUSINESS, quantity: 1 }
    : {
        price_data: {
          currency: "usd",
          unit_amount: 24500,
          recurring: { interval: "month" as const },
          product_data: { name: "VYBZ Ultimate", description: planById("ultimate")?.tagline ?? "" },
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
    subscription_data: { metadata: { kind: "org_plan", org_id: orgId, plan: "ultimate" } },
    metadata: { kind: "org_plan", org_id: orgId, plan: "ultimate" },
  });
  return { provider: "stripe", url: session.url };
}

async function stripePortal(orgId: string, email: string | null, origin: string) {
  const stripe = await stripeClient();
  const customer = await ensureStripeCustomer(orgId, email);
  const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/console/billing` });
  return { provider: "stripe", url: portal.url };
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const uid = await callerId(req);
  if (!uid) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = String(body.orgId ?? "");
  const action = String(body.action ?? "checkout");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: "orgId required" }, 400);
  if (!(await isAdmin(orgId, uid))) return json({ error: "forbidden" }, 403);

  const origin = typeof body.origin === "string" && body.origin.startsWith("http")
    ? body.origin
    : (Deno.env.get("APP_URL") ?? "https://vybz.cloud");

  try {
    const prov = await provider();
    if (action === "status") {
      const [{ data: org }, { data: billing }, { data: usage }] = await Promise.all([
        admin.from("orgs").select("plan").eq("id", orgId).single(),
        admin.from("org_billing").select("provider,status,current_period_end,stripe_subscription_id,paddle_subscription_id").eq("org_id", orgId).maybeSingle(),
        admin.rpc("org_plan_usage", { p_org: orgId }),
      ]);
      const u = Array.isArray(usage) ? usage[0] : usage;
      const subscriptionId = billing?.paddle_subscription_id ?? billing?.stripe_subscription_id ?? null;
      return json({
        provider: prov,
        plan: org?.plan ?? "developer",
        billing: billing
          ? { status: billing.status, current_period_end: billing.current_period_end, provider: billing.provider, subscription_id: subscriptionId, stripe_subscription_id: billing.stripe_subscription_id ?? null }
          : { status: "none", provider: prov, subscription_id: null, stripe_subscription_id: null },
        usage: u ?? null,
        price_configured: true,
        paddle: prov === "paddle" ? { client_token: await secret("PADDLE_CLIENT_TOKEN"), environment: PADDLE_ENV } : null,
      });
    }

    const { data: userRes } = await admin.auth.admin.getUserById(uid);
    const email = userRes?.user?.email ?? null;

    if (action === "portal") return json(prov === "paddle" ? await paddlePortal(orgId, email) : await stripePortal(orgId, email, origin));
    if (action === "change") {
      if (prov !== "paddle") return json({ error: "Plan changes for this organization are handled in the Stripe portal." }, 400);
      return json(await paddleChange(orgId, parseSelection(body)));
    }
    return json(prov === "paddle" ? await paddleCheckout(orgId, email, origin, parseSelection(body)) : await stripeCheckout(orgId, email, origin));
  } catch (e) {
    return json({ error: (e as Error).message ?? "billing error" }, 400);
  }
});
