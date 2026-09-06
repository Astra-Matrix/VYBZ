// Lightweight, build-time feature flags. Keep additive & reversible (§9):
// most flags default ON but flip OFF instantly via env; opt-in flags default OFF
// until their external dependency (e.g. Stripe Connect) is provisioned.
const off = (v: unknown) => String(v ?? "").toLowerCase() === "off" || String(v ?? "") === "false";
const on = (v: unknown) => ["on", "true", "1"].includes(String(v ?? "").toLowerCase());

export const FLAGS = {
  /**
   * Legacy creator app (social, live, tools). Default OFF since the platform pivot
   * (2026-09-05). Set VITE_FEATURE_LEGACY_CREATOR=on to reach it under its old routes.
   */
  legacyCreator: on(import.meta.env.VITE_FEATURE_LEGACY_CREATOR),
  /** Phase O1 — creator-adjacent Role Class onboarding + badges + feed split. */
  roleClass: !off(import.meta.env.VITE_FEATURE_ROLE_CLASS),
  /** Phase O3b — Stripe Connect tips. Opt-in; secondary to cosmetics (Phase 4). */
  tips: on(import.meta.env.VITE_FEATURE_TIPS),
  /** Paid live visibility boost — forbidden as core model; stub stays OFF. */
  liveBoost: on(import.meta.env.VITE_FEATURE_LIVE_BOOST),
  /** Phase C3 — Spotify for Artists OAuth connector. */
  oauthSpotify: on(import.meta.env.VITE_FEATURE_OAUTH_SPOTIFY),
  /** Phase H — encrypted-chunk WebRTC swarm (CDN fallback always available). */
  swarm: on(import.meta.env.VITE_FEATURE_SWARM),
  /** Phase J — Pro soft entitlement UI (badge + soft limits; no hard paywall). */
  pro: !off(import.meta.env.VITE_FEATURE_PRO),
  /** Phase N — Music Repos (CAS VCS on Studio). Default ON; set off to hide. */
  repos: !off(import.meta.env.VITE_FEATURE_REPOS),
  /** Phase O — Unified Social Live (Social tab + SFU). Default ON. */
  socialLive: !off(import.meta.env.VITE_FEATURE_SOCIAL_LIVE),
  /** Drop audio via Bunny CDN. Default OFF — Supabase Storage is the playback backend. */
  bunnyAudio: on(import.meta.env.VITE_FEATURE_BUNNY_AUDIO),
  /** Sample Pack Storefront Generator. Default ON; set off to hide. (Market — keep WIP isolated.) */
  storefront: !off(import.meta.env.VITE_FEATURE_STOREFRONT),
  /** Phase 2 — Prepare MVP (release list, findings, local drafts). Default ON. */
  prepare: !off(import.meta.env.VITE_FEATURE_PREPARE),
  /**
   * Airtime Credits on the live path. Default OFF — parked, not deleted.
   * Ledger, RPCs, and UI stay in the tree. Set VITE_FEATURE_ATC=on to restore
   * the header clock, go-live gate, host burn, and listen earn.
   */
  atc: on(import.meta.env.VITE_FEATURE_ATC),
} as const;
