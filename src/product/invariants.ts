/**
 * Runtime constants used by the app.
 * Product direction is not defined here.
 */

export const DELIVERY_STATES = [
  "DOCUMENTED ONLY",
  "STUB OR SCAFFOLD",
  "INFRASTRUCTURE ONLY",
  "NATIVE-PLATFORM ONLY",
  "PARTIALLY IMPLEMENTED",
  "IMPLEMENTED BUT NOT DELIVERED",
  "DEPLOYED BUT UNVERIFIED",
  "DELIVERED AND PRODUCTION-VERIFIED",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const NOT_MEASURED = "Not measured" as const;

export const WORK_SESSION_CLAIM =
  "This file is associated with verified VYBZ creation sessions." as const;

export const PROVENANCE_STRENGTHS = ["thin", "full"] as const;
export type ProvenanceStrength = (typeof PROVENANCE_STRENGTHS)[number];

export const PROVENANCE_EVENT_TYPES = ["open", "atc_burn", "signal", "seal"] as const;
export type ProvenanceEventType = (typeof PROVENANCE_EVENT_TYPES)[number];

export const NOTIFICATION_ROUTING = {
  chatKinds: ["message"] as const,
  chatSeparateFromAlerts: true,
} as const;

export const ATC_UNMEASURED_MINTS = ["reception_bonus", "referral"] as const;

export const ATC_CREATION_TYPES = [
  "daily_grant",
  "listen_earn",
  "reception_bonus",
  "referral",
  "bootstrap",
  "admin_adjust",
] as const;

export const ATC_DESTRUCTION_TYPES = ["host_consume", "admin_adjust"] as const;

export type AtcLedgerType = (typeof ATC_CREATION_TYPES)[number];

export const ATC_POLICY = {
  secondsPerAtc: 1,
  dailyFreeGrantAtc: 7200,
  baseAtcPerVerifiedMinute: 50,
  hostStartMinimumAtc: 300,
  hostWarningRemainingAtc: 60,
  maxQualityMultiplier: 1.8,
  sparkMultiplier: 1.2,
  stayMultiplier: 1.15,
  discoveryMultiplier: 1.25,
  firstListenMultiplier: 1.1,
  newUserBootstrapDays: 7,
  newUserStarterAtc: 3600,
  heartbeatChunkSeconds: 30,
  hostBurnChunkSeconds: 30,
  maxConcurrentEarnSessions: 4,
  stayContinuousSeconds: 1200,
  discoveryViewerCeiling: 5,
} as const;

export const GATE_REGISTRY = [
  "routeTruth",
  "m4Measurement",
  "m5Analysis",
  "m6Correction",
  "m7Translation",
  "m8Assembly",
  "m9Vdock",
  "m10SuiteRedesign",
  "m10StoreCommerce",
  "or032WorkingSet",
  "or034CorrectDesk",
  "or035WhatNext",
  "or036MidiMaker",
  "or037ConverterFormats",
  "or038PackMakerLibrary",
  "or039MarketDiscovery",
  "or040LandingDrop",
  "or041DawFolderLink",
  "or042AnalyzerReliability",
  "or043VibesRadio",
  "suiteUxCostRemoval",
  "socialFirstShell",
  "libraryCompleteness",
  "livingMix",
  "sparks",
  "reception",
  "stationLine",
  "accountMenu",
  "uploader",
  "packPipeline",
  "trackTools",
  "playbackAuthority",
  "dockVisuals",
  "featuredMiniPlayer",
  "chatIdentity",
  "alphaWelcome",
  "alphaKey",
  "perceptionEngine",
  "aiReviewPortal",
  "liveManifest",
  "airtimeCredits",
  "humanProvenance",
  "artistStageProfile",
  "livingProfilePhase2",
  "generateAudio",
  "validatePipeline",
  "assetNode",
  "creatorNetwork",
  "notificationRouting",
  "creatorOsHarden",
] as const;

export type GateId = (typeof GATE_REGISTRY)[number];

export function isRegisteredGate(id: string): id is GateId {
  return (GATE_REGISTRY as readonly string[]).includes(id);
}
