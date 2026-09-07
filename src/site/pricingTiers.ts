// Tiers on the public pricing page, derived from the shared plan ladder. The
// Paddle price ids are public identifiers selected by VITE_PADDLE_ENV; prices
// themselves come from Paddle at render time (localized), with `fallback` only
// when Paddle is not configured for the build.
import { PADDLE_PRICES, PLANS, formatUsd, isPaidPlan, type Interval, type PlanId } from "../../supabase/functions/_shared/plans.ts";

export type { Interval };

export interface Tier {
  id: PlanId;
  name: string;
  description: string;
  features: string[];
  trialDays: number;
  /** Paddle price ids per interval, or null for plans that are not sold through checkout. */
  priceId: { month: string; year: string } | null;
  /** Shown when Paddle cannot be reached. Never used for arithmetic. */
  fallback: { month: string; year: string };
  cta: { checkout: true } | { checkout: false; label: string; to: string };
  featured?: boolean;
}

const env = ((import.meta.env.VITE_PADDLE_ENV as string | undefined) ?? "").trim();
const prices = env === "live" ? PADDLE_PRICES.live : env === "sandbox" ? PADDLE_PRICES.sandbox : null;

export const TIERS: Tier[] = PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  description: p.tagline,
  features: p.features,
  trialDays: p.trialDays,
  priceId: prices && isPaidPlan(p.id) ? prices[p.id] : null,
  fallback: p.price ? { month: formatUsd(p.price.month), year: formatUsd(p.price.year) } : { month: p.id === "developer" ? "$0" : "Custom", year: p.id === "developer" ? "$0" : "Custom" },
  cta: p.price
    ? { checkout: true }
    : p.id === "developer"
      ? { checkout: false, label: "Start free", to: "/signin?mode=create" }
      : { checkout: false, label: "Contact sales", to: "mailto:sales@vybz.cloud?subject=VYBZ%20Enterprise" },
  featured: p.featured,
}));
