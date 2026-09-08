// The plan ladder, shared by the gateway, the billing functions, the console,
// and the public site. Limits here mirror plan_limits() in the database, which
// is what the API enforces; this file carries the copy and the Paddle ids.
// Environment-neutral: no Deno or browser globals.

export type PlanId = "developer" | "creator" | "pro" | "ultimate" | "enterprise";
export type PaidPlanId = "creator" | "pro" | "ultimate";
export type Interval = "month" | "year";
export type PaddleEnv = "sandbox" | "live";

export interface Plan {
  id: PlanId;
  name: string;
  /** USD per interval, in cents. Null for plans not sold through checkout. */
  price: { month: number; year: number } | null;
  /** Trial length in days on first subscription, applied by Paddle. */
  trialDays: number;
  tagline: string;
  features: string[];
  limits: { issuances: number; detections: number; storageBytes: number; hardCap: boolean; members: number | null };
  featured?: boolean;
}

const GB = 1024 ** 3;
const TB = 1024 ** 4;

export const PLANS: Plan[] = [
  {
    id: "developer",
    name: "Developer",
    price: null,
    trialDays: 0,
    tagline: "For building an integration. Not for a release.",
    features: ["100 copies issued / month", "20 leak checks / month", "1 member, 3 keys", "2 GB Vault", "Hosted and local MCP", "Community support"],
    limits: { issuances: 100, detections: 20, storageBytes: 2 * GB, hardCap: true, members: 1 },
  },
  {
    id: "creator",
    name: "Manager",
    price: { month: 900, year: 9000 },
    trialDays: 14,
    tagline: "One roster, every pre-release copy accounted for.",
    features: ["200 copies issued / month", "50 leak checks / month", "Leak reports, PDF and JSON", "Content Credentials on every copy", "100 GB Vault", "Email support"],
    limits: { issuances: 200, detections: 50, storageBytes: 100 * GB, hardCap: true, members: 1 },
  },
  {
    id: "pro",
    name: "Label",
    price: { month: 8500, year: 85000 },
    trialDays: 14,
    tagline: "Labels, studios, and sync houses with a release calendar.",
    features: ["1,500 copies issued / month, then $0.02", "300 leak checks / month, then $0.10", "Batch issue, 50 recipients per call", "5 members", "500 GB Vault, then $0.015 / GB", "Webhooks, audit export"],
    limits: { issuances: 1500, detections: 300, storageBytes: 500 * GB, hardCap: false, members: 5 },
    featured: true,
  },
  {
    id: "ultimate",
    name: "Catalog",
    price: { month: 24500, year: 245000 },
    trialDays: 14,
    tagline: "Distributors, label groups, and libraries with thousands of recipients.",
    features: ["3 TB Vault, then $0.015 / GB", "10,000 issuances / month, then $0.02", "2,000 detections / month, then $0.10", "Unlimited members", "CA-issued Content Credentials certificate", "99.9% SLA, priority support"],
    limits: { issuances: 10000, detections: 2000, storageBytes: 3 * TB, hardCap: false, members: null },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    trialDays: 0,
    tagline: "Distributors, platforms, AI labs.",
    features: ["Volume pricing on issuances and storage", "Dedicated signing certificate and key ceremony", "Private deployment options", "SSO and custom retention", "Solutions engineering", "Named support, 24×7"],
    limits: { issuances: Number.MAX_SAFE_INTEGER, detections: Number.MAX_SAFE_INTEGER, storageBytes: Number.MAX_SAFE_INTEGER, hardCap: false, members: null },
  },
];

/** Paddle price ids per environment, plan, and interval. */
export const PADDLE_PRICES: Record<PaddleEnv, Record<PaidPlanId, Record<Interval, string>>> = {
  sandbox: {
    creator: { month: "pri_01m1yyrts9em8nesg3ywep41b2", year: "pri_01m1yyrv22rkbp892cyv1pmwxh" },
    pro: { month: "pri_01m1yyrvy8ha8qkhbpdfbt88fh", year: "pri_01m1yyrw5zykw28zcfwrkcyb1k" },
    ultimate: { month: "pri_01m1yyrx7fjbgmmh6nwesxgv9b", year: "pri_01m1yyrxf2rdj3vz7hcp4z6s1m" },
  },
  live: {
    creator: { month: "pri_01m1yyry0gjgfv3y01f95j5qhy", year: "pri_01m1yyry7vyjrwdaxa7ct0rqdw" },
    pro: { month: "pri_01m1yyryrdb0cpam8cpvy77ktx", year: "pri_01m1yyryzxbpkbqb3n8dk4sc4q" },
    ultimate: { month: "pri_01m1yyrzk9xzb0cj86gx8y3vdm", year: "pri_01m1yyrztt965aqwwat890gqcq" },
  },
};

/** Paddle product ids per environment and plan, for non-catalog prices (a subscription without the trial). */
export const PADDLE_PRODUCTS: Record<PaddleEnv, Record<PaidPlanId, string>> = {
  sandbox: { creator: "pro_01m1yyrtj0wahjs5tt7jq0sn4d", pro: "pro_01m1yyrvamncc751q2j868h4cr", ultimate: "pro_01m1yyrwsggetx39dyzvx9h428" },
  live: { creator: "pro_01m1yyrxsn112a50kx8n3kvs10", pro: "pro_01m1yyryhmpc78b9e7wa5zcayq", ultimate: "pro_01m1yyrza4s41q8j82jybnrr4n" },
};

/** Caps that apply to every plan while its subscription is trialing. Mirrors trial_limits() in the database. */
export const TRIAL_LIMITS = { issuances: 25, detections: 10, storageBytes: 10 * GB, days: 14 };

/** Legacy prices that map to a plan, so subscriptions created before the ladder keep resolving. */
const LEGACY_PRICES: Record<string, PlanId> = {
  pri_01m1ybdqphgqerhccne3my186b: "ultimate", // sandbox Business, monthly
  pri_01m1yrnhtqh0q9q60e23zvvbz7: "ultimate", // sandbox Business, yearly
  pri_01m1yqesgyjw5ysj92svmhxn3v: "ultimate", // live Business, monthly
  pri_01m1ysawsyk0n263k6ktrhbfbq: "ultimate", // live Business, yearly
};

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function isPaidPlan(id: string): id is PaidPlanId {
  return id === "creator" || id === "pro" || id === "ultimate";
}

/** Which plan a Paddle price belongs to, across both environments. */
export function planForPrice(priceId: string): PlanId | undefined {
  for (const env of Object.keys(PADDLE_PRICES) as PaddleEnv[]) {
    for (const plan of Object.keys(PADDLE_PRICES[env]) as PaidPlanId[]) {
      const p = PADDLE_PRICES[env][plan];
      if (p.month === priceId || p.year === priceId) return plan;
    }
  }
  return LEGACY_PRICES[priceId];
}

/** Rank for upgrade/downgrade decisions. */
export const PLAN_RANK: Record<PlanId, number> = { developer: 0, creator: 1, pro: 2, ultimate: 3, enterprise: 4 };

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
