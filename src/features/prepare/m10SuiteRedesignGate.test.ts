/**
 * M10 Wave R redesign gate — R0–R5 (visual cohesion before Store commerce).
 * Cites Masterplan §10 M10 (partial) + AGENTS correctness gate.
 * Full M10 publish/discover/support gate remains open until later waves.
 * Law 5: VDock disclosure / dry-playback contracts must remain intact.
 * Law 1: Home / Library figures must come from measured sources only.
 * Delivery: Wave R may reach IMPLEMENTED BUT NOT DELIVERED after local validate;
 * never claim DEPLOYED until merged + production smoke.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY } from "@/product/invariants";
import { SUITE_APP_ACCENT_RGB, suiteAppAccentRgb } from "@/design/suiteAppAccents";
import { PRODUCT_ACCENT_RGB } from "@/design/tokens";
import { SUITE_APPS, type SuiteAppId } from "@/shell/suiteApps";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("M10 suite redesign gate (Wave R0)", () => {
  it("declares a cool accent for every suite app id", () => {
    const ids = SUITE_APPS.map((a) => a.id);
    for (const id of ids) {
      expect(SUITE_APP_ACCENT_RGB[id as SuiteAppId]).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    }
    // No purple / magenta SaaS channels in the suite-app map
    const joined = Object.values(SUITE_APP_ACCENT_RGB).join("|");
    expect(joined).not.toContain("168 85 247");
    expect(joined).not.toContain("217 70 239");
    expect(joined).not.toContain("99 102 241");
  });

  it("keeps product market/credits/coverlab accents off purple", () => {
    expect(PRODUCT_ACCENT_RGB.market).toBe("34 211 238");
    expect(PRODUCT_ACCENT_RGB.credits).toBe("56 189 248");
    expect(PRODUCT_ACCENT_RGB.coverlab).toBe("94 234 212");
  });

  it("wires SuiteShell data-suite-app and SuiteStage mount", () => {
    const shell = read("src/shell/SuiteShell.tsx");
    const stage = read("src/shell/SuiteStage.tsx");
    expect(shell).toContain("data-suite-app");
    expect(shell).toContain("useActiveSuiteAppId");
    expect(shell).toContain("SuiteStage");
    expect(stage).toContain("data-testid=\"suite-stage\"");
  });

  it("loads suite-app-accents.css from the design layer", () => {
    const indexCss = read("src/index.css");
    const accentsCss = read("src/design/suite-app-accents.css");
    expect(indexCss).toContain('suite-app-accents.css');
    expect(accentsCss).toContain('--app-accent-rgb');
    expect(accentsCss).toContain('[data-suite-app="correct"]');
    expect(accentsCss).toContain('[data-suite-app="home"]');
  });

  it("exposes type scale tokens for the redesign", () => {
    const tokens = read("src/design/tokens.css");
    expect(tokens).toContain("--type-eyebrow");
    expect(tokens).toContain("--type-display");
    expect(tokens).toContain("--type-body");
  });

  it("suiteAppAccentRgb falls back to home", () => {
    expect(suiteAppAccentRgb(null)).toBe(SUITE_APP_ACCENT_RGB.home);
    expect(suiteAppAccentRgb("correct")).toBe(SUITE_APP_ACCENT_RGB.correct);
  });

  it("Wave R1 loads suite-shell-chrome and ops chrome markers", () => {
    const indexCss = read("src/index.css");
    const chromeCss = read("src/design/suite-shell-chrome.css");
    const primary = read("src/shell/PrimaryRail.tsx");
    const appRail = read("src/shell/SuiteAppRail.tsx");
    const appBar = read("src/components/shell/ContextualAppBar.tsx");
    const vdock = read("src/components/vdock/VDock.tsx");
    expect(indexCss).toContain("suite-shell-chrome.css");
    expect(chromeCss).toContain(".suite-rail--ops");
    expect(chromeCss).toContain(".app-bar--ops");
    expect(chromeCss).toContain(".vdock-ops");
    expect(primary).toContain("suite-rail--ops");
    expect(primary).toContain("RailIdentity");
    const identity = read("src/shell/RailIdentity.tsx");
    expect(identity).toContain("suite-rail-ops-head");
    expect(identity).toContain("rail-identity");
    expect(identity).not.toContain("rail-notify-button");
    expect(appRail).toContain("suite-app-rail--ops");
    expect(appBar).toContain("app-bar--ops");
    expect(vdock).toContain("vdock-ops");
    // Law 5 — disclosure / dry contract hooks stay on the dock
    expect(vdock).toContain("data-vdock");
    expect(vdock).toContain("MusicDockPlayer");
  });

  it("Wave R2 Home ops desk uses measured dashboardModel sources", () => {
    const home = read("src/components/home/ArtistHome.tsx");
    expect(home).toContain("data-testid=\"ops-home\"");
    expect(home).toContain("buildStats");
    expect(home).toContain("buildActionItems");
    expect(home).toContain("listReleases");
    expect(home).toContain("ops-home-stats");
    expect(home).toContain("ops-home-actions");
    expect(home).toContain("playTrack");
    expect(home).toContain("toPlayerTrack");
    expect(home).toContain("hub-go-live");
    expect(home).toContain("HubActivity");
    expect(home).toContain("WallAlerts");
    expect(home).toContain("GoLiveSheet");
    // No invented engagement / fake readiness copy
    expect(home).not.toMatch(/engagement score|viral|estimated listeners/i);
  });

  it("Wave R3 rolls ToolWorkbench across remaining tools + denser Analyzer desk", () => {
    const workbench = read("src/components/ToolWorkbench.tsx");
    expect(workbench).toContain("wide?: boolean");
    expect(workbench).toContain("ForgeDropzone");

    const metadata = read("src/features/tools/MetadataEditorPage.tsx");
    const art = read("src/features/tools/ArtCheckPage.tsx");
    const midi = read("src/features/tools/MidiMakerPage.tsx");
    const convert = read("src/features/tools/MediaConverterPage.tsx");
    const correct = read("src/features/correction/CorrectPage.tsx");
    const translate = read("src/features/translation/TranslationLabPage.tsx");
    const packs = read("src/features/packs/PackMakerPage.tsx");
    const stems = read("src/features/stems/StemMakerPage.tsx");
    const analyzer = read("src/features/prepare/ReleasesPage.tsx");

    for (const src of [metadata, art, midi, convert, correct, translate, packs, stems]) {
      expect(src).toContain("ToolWorkbench");
    }
    expect(midi).toContain("wide");
    expect(art).toContain("ForgeDropzone");
    expect(convert).toContain("ForgeDropzone");
    expect(metadata).toContain("ForgeDropzone");

    expect(analyzer).toContain("analyzer-desk");
    expect(analyzer).toContain("NexusPageHeader");
    expect(analyzer).toContain("analyzer-desk-title");
    expect(analyzer).toContain("analyzer-dropzone");
    // Law 5 — Analyzer still routes previews through VDock compare contract
    expect(analyzer).toContain("VDOCK_COMPARE_PREVIEW_VERSION");
    // Law 1 — no fake DSP submission / engagement claims in Analyzer shell
    expect(analyzer).not.toMatch(/guaranteed DSP|viral score|estimated streams/i);
  });

  it("Wave R4 Library media desk + public shell continuity", () => {
    const indexCss = read("src/index.css");
    const publicCss = read("src/design/suite-public-shell.css");
    expect(indexCss).toContain("suite-public-shell.css");
    expect(publicCss).toContain(".public-ops-shell");
    expect(publicCss).toContain(".public-ops-header");

    const library = read("src/pages/LibraryPage.tsx");
    expect(library).toContain("ToolWorkbench");
    expect(library).toContain("library-desk");
    expect(library).toContain("listReleases");
    expect(library).toContain("dropsBy");
    expect(library).not.toMatch(/engagement score|viral|estimated listeners/i);

    const landing = read("src/pages/LandingPage.tsx");
    const prepare = read("src/features/prepare/PrepareLocalApp.tsx");
    const auth = read("src/components/AuthShell.tsx");
    const app = read("src/App.tsx");
    expect(landing).toContain('data-public-shell="landing"');
    expect(landing).toContain("landing-invite-gate");
    expect(prepare).toContain('data-public-shell="prepare"');
    expect(prepare).toContain("prepare-local-shell");
    expect(auth).toContain('data-public-shell="auth"');
    expect(app).toContain('data-public-shell="docs"');
    expect(app).toContain("public-doc-shell");
    // Public shells stay dark ops void — no paper wash
    expect(app).not.toMatch(/PublicDocShell[\s\S]{0,400}bg-paper-50/);
  });

  it("Wave R5 rollup — redesign surface markers present; Law 5 frozen", () => {
    const gate = read("src/features/prepare/m10SuiteRedesignGate.test.ts");
    // Executable gate cites itself across waves
    expect(gate).toContain("Wave R1 loads suite-shell-chrome");
    expect(gate).toContain("Wave R2 Home ops desk");
    expect(gate).toContain("Wave R3 rolls ToolWorkbench");
    expect(gate).toContain("Wave R4 Library media desk");
    expect(GATE_REGISTRY).toContain("m10SuiteRedesign");
  });
});
