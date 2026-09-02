import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DELIVERY_STATES, GATE_REGISTRY } from "@/product/invariants";
import {
  DRY_PLAYBACK_VERSION,
  ambientSignal,
  catalogSignal,
  resolveTrackSignal,
} from "@/lib/vdock/playbackSignal";
import { VDOCK_COMPARE_PREVIEW_VERSION } from "@/lib/vdock/comparePreview";
import { dryPlaybackCapabilities } from "@/platform/bridge/playbackCapabilities";
import { createMockBridge } from "@/platform/bridge/mock";

const ROOT = path.resolve(__dirname, "../../..");

/**
 * M9 exit gate — Masterplan §10 VDock Completion / Law 5.
 * Gate: VDock reliable across web, desktop and Android; correctly represents
 * active processing and simulation; never applies hidden processing; core
 * frozen behind stable interfaces.
 *
 * Close-out delivery vocabulary (Masterplan §12): DEPLOYED BUT UNVERIFIED —
 * production ships the contracts; interactive / device interrupt smoke remain
 * Not measured until evidenced.
 */
describe("M9 VDock gate", () => {
  it("cites the M9 gate and ships a versioned dry-playback contract", () => {
    expect(GATE_REGISTRY).toContain("m9Vdock");
    expect(DRY_PLAYBACK_VERSION).toMatch(/^m9\./);
  });

  it("freezes AudioBus as a dry HTMLAudioElement engine (no hidden DSP)", () => {
    const bus = readFileSync(path.join(ROOT, "src/lib/audioBus.ts"), "utf8");
    expect(bus).toContain("createMediaElementSource");
    expect(bus).toMatch(/do NOT call createMediaElementSource/i);
    expect(bus).not.toMatch(/audioEl\.playbackRate\s*=/);
    expect(bus).not.toMatch(/new\s+OfflineAudioContext\s*\(/);
    // Prohibit live DSP graph wiring on the play element (comments may name the APIs).
    expect(bus).not.toMatch(/\.createBiquadFilter\s*\(/);
    expect(bus).not.toMatch(/\.createDynamicsCompressor\s*\(/);
    expect(bus).not.toMatch(/\.createMediaElementSource\s*\(/);
    expect(bus).toContain("signal");
    expect(bus).toContain("resolveTrackSignal");
    expect(bus).not.toContain("navigator.mediaSession");
  });

  it("surfaces disclosure in the dock when signal.disclosure is set", () => {
    const player = readFileSync(path.join(ROOT, "src/components/GlobalPlayer.tsx"), "utf8");
    const vdock = readFileSync(path.join(ROOT, "src/components/vdock/VDock.tsx"), "utf8");
    expect(player).toContain("data-vdock-disclosure");
    expect(player).toContain("signal?.disclosure");
    expect(vdock).toContain("MusicDockPlayer");
    // Compact MusicDockPlayer + expanded NowPlayingExpanded both disclose.
    expect(player.match(/data-vdock-disclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("routes Translation, Correct, MasterReady, and Analyzer A/B through disclosed AudioBus tracks", () => {
    for (const relativePath of [
      "src/features/translation/TranslationLabPage.tsx",
      "src/features/correction/CorrectPage.tsx",
    ]) {
      const page = readFileSync(path.join(ROOT, relativePath), "utf8");
      expect(page).toContain("playTrack");
      expect(page).toContain("simulationSignal");
      expect(page).toContain("VDock");
      expect(page).not.toContain("<audio");
    }
    const master = readFileSync(
      path.join(ROOT, "src/features/mastering/ReleaseMasterPane.tsx"),
      "utf8",
    );
    expect(master).toContain("playTrack");
    expect(master).toContain("compareSideBSignal");
    expect(master).toContain("buildMatchedCompareObjectUrls");
    expect(master).toContain("VDock");
    expect(master).not.toContain("<audio");
    const analyzer = readFileSync(
      path.join(ROOT, "src/features/prepare/ReleasesPage.tsx"),
      "utf8",
    );
    expect(analyzer).toContain("playTrack");
    expect(analyzer).toContain("compareSideBSignal");
    expect(analyzer).toContain("buildMatchedCompareObjectUrls");
    expect(analyzer).toContain("VDock");
    expect(analyzer).not.toContain("<audio");
    const compare = readFileSync(path.join(ROOT, "src/lib/vdock/comparePreview.ts"), "utf8");
    expect(compare).toContain("VDOCK_COMPARE_PREVIEW_VERSION");
    expect(compare).toContain("matchLoudnessForCompare");
    const mediaSession = readFileSync(
      path.join(ROOT, "src/platform/bridge/mediaSession.ts"),
      "utf8",
    );
    expect(mediaSession).toContain("state.disclosure");
  });

  it("tags ambient pad with a non-null disclosure", () => {
    const ambient = ambientSignal();
    expect(ambient.kind).toBe("ambient");
    expect(ambient.disclosure).toBeTruthy();
    expect(ambient.disclosure!.toLowerCase()).toContain("dry");
    expect(catalogSignal().disclosure).toBeNull();
    expect(
      resolveTrackSignal({ id: "vybz-ambient-pad", url: "blob:x" })?.kind
    ).toBe("ambient");
  });

  it("exposes playback capabilities on the Platform Bridge (no native DSP)", async () => {
    const caps = dryPlaybackCapabilities();
    expect(caps.dryHtmlAudio).toBe(true);
    expect(caps.nativeDsp).toBe(false);
    expect(caps.audioFocus).toBe(false);
    expect(caps.playbackLifecycle).toBe(false);
    const bridge = createMockBridge();
    const live = await bridge.playback.getCapabilities();
    expect(live).toEqual(caps);
    const types = readFileSync(path.join(ROOT, "src/platform/bridge/types.ts"), "utf8");
    expect(types).toContain("playback:");
    expect(types).toContain("PlaybackCapabilities");
    expect(types).toContain("bindMediaSession");
    expect(types).toContain("bindPlaybackLifecycle");
    expect(types).toContain("bindAudioFocus");
    const mediaSession = readFileSync(
      path.join(ROOT, "src/platform/bridge/mediaSession.ts"),
      "utf8",
    );
    expect(mediaSession).toContain("bindBrowserMediaSession");
    expect(mediaSession).toContain("setActionHandler");
    const lifecycle = readFileSync(
      path.join(ROOT, "src/platform/bridge/playbackLifecycle.ts"),
      "utf8",
    );
    expect(lifecycle).toContain("bindPlaybackLifecycle");
    expect(lifecycle).toContain("appStateChange");
    expect(lifecycle).not.toMatch(/createBiquadFilter\s*\(/);
    expect(lifecycle).not.toMatch(/createMediaElementSource\s*\(/);
    const focusBind = readFileSync(
      path.join(ROOT, "src/platform/bridge/audioFocusBind.ts"),
      "utf8",
    );
    expect(focusBind).toContain("bindAudioFocus");
    expect(focusBind).toContain("lossTransient");
    expect(focusBind).not.toMatch(/createBiquadFilter\s*\(/);
    const nativePlugin = readFileSync(
      path.join(ROOT, "android/app/src/main/java/cloud/vybz/app/VybzAudioFocusPlugin.java"),
      "utf8",
    );
    expect(nativePlugin).toContain("AudioManager");
    expect(nativePlugin).toContain("VybzAudioFocus");
    const mainActivity = readFileSync(
      path.join(ROOT, "android/app/src/main/java/cloud/vybz/app/MainActivity.java"),
      "utf8",
    );
    expect(mainActivity).toContain("VybzAudioFocusPlugin");
  });

  it("freezes the M9 stable interface surface at close-out versions", () => {
    // Contract versions — extend only with a new version string + consumer, never silent rewrite.
    expect(DRY_PLAYBACK_VERSION).toBe("m9.dry-playback.1");
    expect(VDOCK_COMPARE_PREVIEW_VERSION).toBe("m9.compare-preview.1");

    const provider = readFileSync(
      path.join(ROOT, "src/platform/bridge/PlatformProvider.tsx"),
      "utf8",
    );
    expect(provider).toContain("bindMediaSession");
    expect(provider).toContain("bindPlaybackLifecycle");
    expect(provider).toContain("bindAudioFocus");
    expect(provider).toContain("audioBusController");

    const types = readFileSync(path.join(ROOT, "src/platform/bridge/types.ts"), "utf8");
    expect(types).toContain("getCapabilities");
    expect(types).toContain("bindMediaSession");
    expect(types).toContain("bindPlaybackLifecycle");
    expect(types).toContain("bindAudioFocus");

    expect(DELIVERY_STATES).toContain("DEPLOYED BUT UNVERIFIED");
  });
});
