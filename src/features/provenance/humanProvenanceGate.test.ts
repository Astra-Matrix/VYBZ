/**
 * Session provenance gate — decision 0006.
 * Proves a live session was hosted. Refuses a not-AI claim.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY, PROVENANCE_EVENT_TYPES } from "@/product/invariants";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("human / session provenance", () => {
  it("is a registered gate", () => {
    expect(GATE_REGISTRY).toContain("humanProvenance");
  });

  it("binds to public live mix and refuses a not-AI claim", () => {
    expect(PROVENANCE_EVENT_TYPES).toContain("atc_burn");
  });

  it("keeps the ledger off Stripe and off Living Mix / 1:1 calls", () => {
    const sql = read("supabase/migrations/20260817_0106_session_provenance.sql");
    expect(sql).toContain("create table if not exists public.provenance_sessions");
    expect(sql).toContain("create table if not exists public.provenance_events");
    expect(sql).toContain("references public.live_sessions");
    expect(sql).toContain("references public.airtime_ledger");
    expect(sql).toContain("host_consume");
    expect(sql).toContain("'full'");
    expect(sql).toContain("'thin'");
    expect(sql).toContain("Not measured");
    expect(sql).not.toMatch(/stripe/i);
    expect(sql).not.toMatch(/livingMix|liveSession\.ts/i);
    expect(sql).toContain("revoke all on function public.open_provenance_session(uuid) from anon");
  });

  it("opens on Go Live, records ATC burn, and seals on end", () => {
    const api = read("src/lib/api.ts");
    expect(api).toContain("openProvenanceForLive");
    expect(api).toContain("sealProvenanceForLive");
    const consume = read("src/features/airtime/atcApi.ts");
    expect(consume).toContain("recordAtcBurnEvent");
    const hook = read("src/features/provenance/provenanceApi.ts");
    expect(hook).toContain("open_provenance_session");
    expect(hook).toContain("append_provenance_event");
    expect(hook).toContain("seal_provenance_session");
    expect(hook).toContain('p_type: "atc_burn"');
  });

  it("records declared host signals on the ATC burn clock", () => {
    const signals = read("src/features/provenance/hostSignals.ts");
    expect(signals).toContain('kind: "declared"');
    expect(signals).toContain("notePointer");
    expect(signals).toContain("noteChatSent");
    const burn = read("src/features/airtime/AtcLiveHooks.ts");
    expect(burn).toContain("recordDeclaredSignals");
    expect(burn).toContain("takeHostSignalSnapshot");
    const api = read("src/features/provenance/provenanceApi.ts");
    expect(api).toContain('p_type: "signal"');
    const watch = read("src/pages/LiveWatchPage.tsx");
    expect(watch).toContain("useHostSignals");
    expect(watch).toContain("noteChatSent");
  });

  it("ships a .vprov package that refuses a not-AI claim", () => {
    const pack = read("src/features/provenance/buildVprov.ts");
    expect(pack).toContain("vybz.vprov");
    expect(pack).toContain("notAiClaim");
    expect(pack).toContain("verify.txt");
    const watch = read("src/pages/LiveWatchPage.tsx");
    expect(watch).toContain("SessionProvenanceBadge");
    expect(watch).toContain("downloadVprovPackage");
    expect(watch).toContain("Download .vprov");
    expect(watch).toContain("SessionProvenanceReport");
  });

  it("binds a client DAW digest as declared and never as measured", () => {
    const bind = read("src/features/provenance/audioBind.ts");
    expect(bind).toContain('kind: "declared"');
    expect(bind).toContain("measuredHex");
    const api = read("src/features/provenance/provenanceApi.ts");
    expect(api).toContain("recordDeclaredAudioSha");
    expect(api).toContain('source: "daw_pcm_client"');
    const watch = read("src/pages/LiveWatchPage.tsx");
    expect(watch).toContain("useDeclaredAudioSha");
    expect(watch).toContain("finishDeclaredPcmHash");
    expect(watch).toContain("recordDeclaredAudioSha");
    const pack = read("src/features/provenance/buildVprov.ts");
    expect(pack).toContain("audioSha");
    expect(pack).toContain("audioShaKind");
    expect(pack).toContain("A client DAW PCM digest is declared");
  });

  it("binds stored-bytes SHA through 0108 and does not invoke the C2PA worker", () => {
    const sql = read("supabase/migrations/20260818_0108_session_stored_audio.sql");
    expect(sql).toContain("bind_session_stored_audio");
    expect(sql).toContain("c2pa_ledger_events");
    expect(sql).toContain("Not measured");
    expect(sql).not.toMatch(/stripe/i);
    expect(sql).not.toMatch(/c2patool|C2PA_WORKER/i);
    const api = read("src/features/provenance/provenanceApi.ts");
    expect(api).toContain("bind_session_stored_audio");
    expect(api).toContain("listHostHashedAssets");
    const drawer = read("src/features/broadcast/SessionToolDrawer.tsx");
    expect(drawer).toContain("StoredRecapBind");
    const watch = read("src/pages/LiveWatchPage.tsx");
    expect(watch).toContain("canBindStoredAudio");
    const report = read("src/features/provenance/SessionProvenanceReport.tsx");
    expect(report).toContain("session-provenance-report");
    expect(report).toContain("NOT_MEASURED");
    expect(report).toContain("Does not prove the music was not AI-generated");
    expect(report).not.toMatch(/Human certified/i);
  });

  it("associates a sealed session with a Work using defensible Validate Humanity copy", () => {
    const sql = read("supabase/migrations/20260821_0112_work_session_provenance.sql");
    expect(sql).toContain("associate_session_work");
    expect(sql).toContain("creation_session_links");
    expect(sql).toContain("work_link");
    expect(sql).toContain("'declared'");
    expect(sql).not.toMatch(/stripe/i);
    const api = read("src/features/provenance/provenanceApi.ts");
    expect(api).toContain("associateSessionWork");
    expect(api).toContain("listCreationSessionLinks");
    const sheet = read("src/features/provenance/ValidateHumanitySheet.tsx");
    expect(sheet).toContain("Validate Humanity");
    expect(sheet).toContain("WORK_SESSION_CLAIM");
    expect(sheet).not.toMatch(/Human certified/i);
    expect(read("src/lib/trackActions.ts")).toContain("validate-humanity");
    expect(read("src/pages/LivePage.tsx")).toContain("ProvenanceHistory");
    expect(read("src/features/profile/WorkCard.tsx")).toContain("WorkSessionMark");
    const copy = read("src/features/provenance/workAttestation.ts");
    expect(copy).toContain("WORK_SESSION_CLAIM");
    expect(copy).toContain("Does not prove the work was not AI-generated");
  });
});
