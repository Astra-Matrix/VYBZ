import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY } from "@/product/invariants";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("artist stage profile", () => {
  it("is a registered gate", () => {
    expect(GATE_REGISTRY).toContain("artistStageProfile");
  });

  it("leads with live nights and keeps connect as a request", () => {
    const page = read("src/pages/UserProfilePage.tsx");
    expect(page).toContain("ArtistStageProfile");
    expect(page).toContain("listHostStageNights");
    expect(page).toContain("listProfileProjects");
    expect(page).toContain('roleLabel || "Creator"');
    const ui = read("src/features/profile/ArtistStageProfile.tsx");
    expect(ui).toContain("On the stage");
    expect(ui).toContain("Works");
    expect(ui).toContain("WorkCard");
    expect(ui).toContain("collectStageWorks");
    expect(ui).toContain("SessionProvenanceBadge");
    expect(ui).toContain("Book a session");
    expect(ui).toContain("this is not a calendar");
    expect(ui).toContain("profile-connect");
    expect(ui).toContain("Handshake");
    expect(ui).toContain("Request sent");
    expect(page).toContain("connectionBlocksNewRequest");
    expect(ui).toContain("No live nights yet");
    expect(ui).toContain("TipButton");
    expect(ui).not.toMatch(/Followers|Human certified|AI-free/i);
    expect(ui).not.toMatch(/No live mixes yet|Join live mix/);
    const kinds = read("src/features/profile/workKind.ts");
    expect(kinds).toContain('"audio"');
    expect(kinds).toContain('"image"');
    expect(kinds).toContain('"video"');
    expect(kinds).toContain('"file"');
    expect(kinds).toContain('"project"');
    expect(kinds).toContain('"link"');
    expect(kinds).toContain('"text"');
    expect(kinds).toContain('"collection"');
    const card = read("src/features/profile/WorkCard.tsx");
    expect(card).toContain("WORK_RENDERERS");
    expect(card).toContain("MODULE_RENDERERS");
    expect(card).toContain("rendererFor");
    expect(card).toContain("UnknownWork");
    expect(card).toContain("TrackCard");
  });
});
