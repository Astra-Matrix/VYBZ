// Supabase Edge Function: stripe-webhook
//
// Signature-verified Stripe webhook. Handles:
//   • checkout.session.completed (kind=tip) → mark the tip 'paid'
//   • checkout.session.completed (kind=credit_topup) → fulfill_credit_topup
//   • checkout.session.completed (kind=ai_topup) → fulfill_ai_topup (+6000 sec default)
//   • checkout.session.completed (kind=storefront) → mark order paid + Resend ZIP link
//   • checkout.session.completed (kind=org_plan) → link subscription, set org plan
//   • customer.subscription.updated/deleted → keep org plan and status in sync
//   • account.updated             → sync creator_payouts readiness flags
//
// Deploy with --no-verify-jwt (Stripe calls this without a Supabase JWT; we
// verify the Stripe-Signature instead).
import { admin } from "../_shared/edge.ts";
import { stripe, cryptoProvider } from "../_shared/stripe.ts";

const ZIP_BUCKET = "storefront-zips";
const SIGN_TTL_SEC = 24 * 60 * 60;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function fulfillStorefrontOrder(session: {
  id: string;
  payment_intent?: string | { id?: string } | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  metadata?: Record<string, string>;
}): Promise<void> {
  const packId = session.metadata?.pack_id;
  if (!packId) {
    console.error("storefront webhook missing pack_id");
    return;
  }

  const pi = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  const email = (
    session.customer_details?.email
    || session.customer_email
    || ""
  ).trim().toLowerCase();

  const { data: existing } = await admin
    .from("storefront_orders")
    .select("id, status, fulfilled_at")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (existing?.status === "paid" && existing.fulfilled_at) {
    return; // idempotent
  }

  const now = new Date().toISOString();

  if (existing?.id) {
    await admin.from("storefront_orders").update({
      status: "paid",
      stripe_payment_intent: pi,
      buyer_email: email || "unknown@buyer",
      fulfilled_at: now,
      settlement_status: "pending_manual",
    }).eq("id", existing.id);
  } else {
    // Create paid row without Connect transfer_id (platform checkout).
    const { data: packRow } = await admin
      .from("storefront_packs")
      .select("price_cents")
      .eq("id", packId)
      .maybeSingle();
    const amountCents = Number(packRow?.price_cents ?? 0);
    const feeCents = Math.floor((Math.max(amountCents, 0) * 1000) / 10_000);
    await admin.from("storefront_orders").insert({
      pack_id: packId,
      buyer_email: email || "unknown@buyer",
      buyer_user_id: session.metadata?.buyer_user_id || null,
      amount_cents: amountCents > 0 ? amountCents : 100,
      application_fee_cents: feeCents,
      status: "paid",
      settlement_status: "pending_manual",
      stripe_session_id: session.id,
      stripe_payment_intent: pi,
      fulfilled_at: now,
    });
  }

  const { data: pack } = await admin
    .from("storefront_packs")
    .select("title, zip_path, slug")
    .eq("id", packId)
    .maybeSingle();

  if (!pack?.zip_path) {
    console.error("storefront fulfill missing zip", packId);
    return;
  }
  if (!email || !email.includes("@")) {
    console.error("storefront fulfill missing buyer email", session.id);
    return;
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(ZIP_BUCKET)
    .createSignedUrl(pack.zip_path, SIGN_TTL_SEC, { download: true });

  if (signErr || !signed?.signedUrl) {
    console.error("storefront signed url", signErr?.message);
    return;
  }

  const key = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("RESEND_FROM") ?? Deno.env.get("RESEND_FROM_EMAIL") ?? "";
  if (!key || !from) {
    console.error("storefront fulfill: Resend not configured");
    return;
  }

  const app = (Deno.env.get("APP_URL") ?? "https://vybz.cloud").replace(/\/$/, "");
  const title = esc(String(pack.title || "Your sample pack"));
  const url = esc(signed.signedUrl);
  const subject = `Your VYBZ download — ${String(pack.title || "Sample Pack").slice(0, 80)}`;
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#0a0c12;color:#eee;padding:32px;margin:0">
  <div style="max-width:480px;margin:0 auto">
    <p style="letter-spacing:3px;font-size:12px;color:#00c2ff;margin:0 0 16px">VYBZ PACKS</p>
    <h1 style="font-size:22px;margin:0 0 12px;font-weight:600">${title}</h1>
    <p style="opacity:.85;line-height:1.55;margin:0 0 24px">Thanks for your purchase. Your secure download link is ready — it expires in 24 hours.</p>
    <p style="margin:0 0 28px"><a href="${url}" style="display:inline-block;background:#00c2ff;color:#041018;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">Download ZIP</a></p>
    <p style="opacity:.45;font-size:12px;line-height:1.5;margin:0">If the button fails, copy this URL:<br/><span style="word-break:break-all;opacity:.7">${url}</span></p>
    <p style="opacity:.4;font-size:12px;margin-top:28px"><a href="${esc(app)}" style="color:#22d3ee">vybz.cloud</a></p>
  </div>
  </body></html>`;
  const text = `Your VYBZ pack "${String(pack.title)}" is ready.\nDownload (24h): ${signed.signedUrl}\n${app}`;

  const mailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [email], subject, html, text }),
  });
  if (!mailRes.ok) {
    console.error("storefront resend", mailRes.status, await mailRes.text());
  }
}

/** Organization plan checkout completed: link the subscription and raise the plan. */
async function applyOrgSubscription(
  orgId: string | undefined,
  subscription: string | { id?: string } | null | undefined,
  customer: string | { id?: string } | null | undefined,
  plan: string,
): Promise<void> {
  if (!orgId) { console.error("org_plan webhook missing org_id"); return; }
  const subId = typeof subscription === "string" ? subscription : subscription?.id ?? null;
  const custId = typeof customer === "string" ? customer : customer?.id ?? null;
  let periodEnd: string | null = null;
  let status = "active";
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      status = sub.status;
      periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    } catch (e) { console.error("subscription retrieve", (e as Error).message); }
  }
  const { error } = await admin.rpc("billing_apply", { p_org: orgId, p_customer: custId, p_subscription: subId, p_status: status, p_period_end: periodEnd, p_plan: plan });
  if (error) console.error("billing_apply", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const raw = await req.text();
  if (!sig || !secret) return new Response("not configured", { status: 400 });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, cryptoProvider);
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as {
        id: string;
        payment_intent?: string | { id?: string } | null;
        customer_details?: { email?: string | null } | null;
        customer_email?: string | null;
        metadata?: Record<string, string>;
      };
      const pi = typeof s.payment_intent === "string"
        ? s.payment_intent
        : s.payment_intent?.id ?? null;

      if (s.metadata?.kind === "tip") {
        await admin.from("tips").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          stripe_payment_intent: pi,
        }).eq("stripe_session_id", s.id);
      } else if (s.metadata?.kind === "credit_topup") {
        const { error } = await admin.rpc("fulfill_credit_topup", {
          p_session_id: s.id,
          p_payment_intent: pi,
        });
        if (error) console.error("fulfill_credit_topup", error.message);
      } else if (s.metadata?.kind === "ai_topup") {
        const { error } = await admin.rpc("fulfill_ai_topup", {
          p_session_id: s.id,
          p_payment_intent: pi,
        });
        if (error) console.error("fulfill_ai_topup", error.message);
      } else if (s.metadata?.kind === "storefront") {
        await fulfillStorefrontOrder(s);
      } else if (s.metadata?.kind === "org_plan") {
        await applyOrgSubscription(s.metadata.org_id, (s as { subscription?: string | { id?: string } | null }).subscription, (s as { customer?: string | { id?: string } | null }).customer, s.metadata.plan ?? "business");
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as { id: string; status: string; current_period_end?: number; customer?: string | { id?: string }; metadata?: Record<string, string> };
      let orgId = sub.metadata?.org_id ?? null;
      if (!orgId) {
        const { data } = await admin.rpc("billing_org_for_subscription", { p_subscription: sub.id });
        orgId = (data as string | null) ?? null;
      }
      if (orgId) {
        const active = ["active", "trialing", "past_due"].includes(sub.status) && event.type !== "customer.subscription.deleted";
        await admin.rpc("billing_apply", {
          p_org: orgId,
          p_customer: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
          p_subscription: sub.id,
          p_status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
          p_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          p_plan: active ? (sub.metadata?.plan ?? "business") : "developer",
        });
      }
    } else if (event.type === "account.updated") {
      const a = event.data.object as {
        id: string; charges_enabled: boolean; details_submitted: boolean; payouts_enabled: boolean;
      };
      await admin.from("creator_payouts").update({
        charges_enabled: !!a.charges_enabled,
        details_submitted: !!a.details_submitted,
        payouts_enabled: !!a.payouts_enabled,
        updated_at: new Date().toISOString(),
      }).eq("stripe_account_id", a.id);
    }
  } catch (e) {
    // Log-and-200 for handler errors so Stripe doesn't hammer retries on a bug;
    // signature failures above already returned 400.
    console.error("webhook handler error", (e as Error).message);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
