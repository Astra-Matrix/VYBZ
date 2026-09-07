// The plans on the public pricing page. Edit copy and features here; prices
// come from Paddle at render time (localized), with `fallback` shown only when
// Paddle is not configured for the build. Price ids differ between the sandbox
// and live accounts, so they are read from the build environment.

export type Interval = "month" | "year";

export interface Tier {
  name: "Developer" | "Business" | "Enterprise";
  description: string;
  features: string[];
  /** Paddle price ids per interval, or null for plans that are not sold through checkout. */
  priceId: { month: string; year: string } | null;
  /** Shown when Paddle cannot be reached. Never used for arithmetic. */
  fallback: { month: string; year: string };
  cta: { checkout: true } | { checkout: false; label: string; to: string };
  featured?: boolean;
}

const env = (name: string): string => ((import.meta.env[name] as string | undefined) ?? "").trim();

export const TIERS: Tier[] = [
  {
    name: "Developer",
    description: "Build and test. Enough for a pilot.",
    features: ["1 organization, 3 keys", "250 issuances / month", "50 detections / month", "10 GB Vault storage", "Community support", "Hosted + local MCP"],
    priceId: null,
    fallback: { month: "$0", year: "$0" },
    cta: { checkout: false, label: "Start free", to: "/signin?mode=create" },
  },
  {
    name: "Business",
    description: "For catalogs, sync houses, and studios.",
    features: [
      "Unlimited keys and members",
      "10,000 issuances / month, then $0.02",
      "2,000 detections / month, then $0.10",
      "1 TB Vault, then $0.015 / GB",
      "Content Credentials with CA-issued certificate",
      "Audit export, 99.9% SLA, email support",
    ],
    priceId: env("VITE_PADDLE_PRICE_BUSINESS_MONTH") && env("VITE_PADDLE_PRICE_BUSINESS_YEAR")
      ? { month: env("VITE_PADDLE_PRICE_BUSINESS_MONTH"), year: env("VITE_PADDLE_PRICE_BUSINESS_YEAR") }
      : null,
    fallback: { month: "$249", year: "$2,490" },
    cta: { checkout: true },
    featured: true,
  },
  {
    name: "Enterprise",
    description: "Distributors, platforms, AI labs.",
    features: ["Volume pricing on issuances and storage", "Dedicated signing certificate and key ceremony", "Private deployment options", "SSO and custom retention", "Solutions engineering", "Named support, 24×7"],
    priceId: null,
    fallback: { month: "Custom", year: "Custom" },
    cta: { checkout: false, label: "Contact sales", to: "mailto:sales@vybz.cloud?subject=VYBZ%20Enterprise" },
  },
];
