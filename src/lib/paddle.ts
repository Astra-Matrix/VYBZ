// Paddle in the browser: one initialised instance per client token, localized
// price previews, and the checkout overlay. Used by the public pricing page
// (configuration from VITE_PADDLE_* build variables) and by the console
// (configuration handed over by the billing function). The server-side API
// key never appears here; client tokens are public by design.
import { initializePaddle, type Paddle } from "@paddle/paddle-js";

export type PaddleEnvironment = "sandbox" | "live";
export type PaddleConfig = { environment: PaddleEnvironment; token: string };

/**
 * Configuration from the build environment. Returns null, with a loud console
 * error, when the variables are missing so the pricing page can fall back to
 * static prices; throws when the environment value is not one of the two
 * allowed words, so a typo can never point checkout at the wrong account.
 */
export function paddleConfigFromEnv(): PaddleConfig | null {
  const environment = (import.meta.env.VITE_PADDLE_ENV as string | undefined)?.trim();
  const token = (import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined)?.trim();
  if (!environment || !token) {
    console.error("Paddle is not configured for this build: set VITE_PADDLE_ENV and VITE_PADDLE_CLIENT_TOKEN.");
    return null;
  }
  if (environment !== "sandbox" && environment !== "live") {
    throw new Error(`VITE_PADDLE_ENV must be "sandbox" or "live", got "${environment}".`);
  }
  return { environment, token };
}

const instances = new Map<string, Promise<Paddle>>();

export function getPaddle(cfg: PaddleConfig): Promise<Paddle> {
  const key = `${cfg.environment}:${cfg.token}`;
  let p = instances.get(key);
  if (!p) {
    p = initializePaddle({ environment: cfg.environment === "live" ? "production" : "sandbox", token: cfg.token }).then((paddle) => {
      if (!paddle) throw new Error("Paddle checkout could not be loaded.");
      return paddle;
    });
    instances.set(key, p);
  }
  return p;
}

export type PricePreviewResult = { priceId: string; total: string; subtotal: string; currencyCode: string };

/**
 * Localized totals for a set of prices, exactly as Paddle formats them. Pass a
 * two-letter country only when it is known; without one Paddle uses the
 * visitor's IP address.
 */
export async function previewPrices(cfg: PaddleConfig, priceIds: string[], country?: string | null): Promise<Map<string, PricePreviewResult>> {
  const paddle = await getPaddle(cfg);
  const res = await paddle.PricePreview({
    items: priceIds.map((priceId) => ({ priceId, quantity: 1 })),
    ...(country ? { address: { countryCode: country } } : {}),
  });
  const out = new Map<string, PricePreviewResult>();
  for (const li of res.data.details.lineItems) {
    out.set(li.price.id, { priceId: li.price.id, total: li.formattedTotals.total, subtotal: li.formattedTotals.subtotal, currencyCode: res.data.currencyCode });
  }
  return out;
}

export type CheckoutOptions = {
  priceId?: string;
  transactionId?: string;
  email?: string | null;
  customData?: Record<string, string>;
  successUrl: string;
};

/** Open the one-page overlay for a price or for a transaction the server created. */
export async function openCheckout(cfg: PaddleConfig, o: CheckoutOptions): Promise<void> {
  const paddle = await getPaddle(cfg);
  const settings = { displayMode: "overlay" as const, variant: "one-page" as const, theme: "dark" as const, successUrl: o.successUrl };
  if (o.transactionId) {
    paddle.Checkout.open({ transactionId: o.transactionId, settings });
    return;
  }
  if (!o.priceId) throw new Error("A price or a transaction is required to open checkout.");
  paddle.Checkout.open({
    items: [{ priceId: o.priceId, quantity: 1 }],
    ...(o.email ? { customer: { email: o.email } } : {}),
    ...(o.customData ? { customData: o.customData } : {}),
    settings,
  });
}
