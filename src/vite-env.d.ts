/// <reference types="vite/client" />

declare const __VYBZ_BUILD_SHA__: string;

interface ImportMetaEnv {
  /** Supabase project URL (optional — enables the real backend). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key (optional — enables the real backend). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_FEATURE_TIPS?: string;
  readonly VITE_FEATURE_OAUTH_SPOTIFY?: string;
  readonly VITE_FEATURE_SWARM?: string;
  readonly VITE_FEATURE_PRO?: string;
  readonly VITE_FEATURE_ROLE_CLASS?: string;
  readonly VITE_FEATURE_REPOS?: string;
  readonly VITE_FEATURE_SOCIAL_LIVE?: string;
  readonly VITE_FEATURE_PREPARE?: string;
  /** Paddle, public: "sandbox" | "live", client-side token, Business price ids. */
  readonly VITE_PADDLE_ENV?: string;
  readonly VITE_PADDLE_CLIENT_TOKEN?: string;
  readonly VITE_PADDLE_PRICE_BUSINESS_MONTH?: string;
  readonly VITE_PADDLE_PRICE_BUSINESS_YEAR?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
