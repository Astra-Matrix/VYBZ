/**
 * Reception gate — the truth about what happened to a track.
 *
 * A play count says nothing; the point is completion. The invariants: completion
 * is observed rather than inferred from a position, unknowns read "Not measured",
 * the owner sees counts and never who listened, and nothing here claims to know
 * how anyone felt.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY, NOT_MEASURED } from "@/product/invariants";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Comments explaining a rule are not uses of it. See sparksGate for the CRLF trap. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)(--|\/\/).*$/, ""))
    .join("\n");
}

const MIGRATION = "supabase/migrations/20260815_0099_drop_listens.sql";

describe("reception", () => {
  it("is a registered gate", () => {
    expect(GATE_REGISTRY).toContain("reception");
  });

  it("measures how far people got, not just that a play happened", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("reached_sec");
    expect(sql).toContain("completed boolean");
    // Furthest point only ever moves forward.
    expect(sql).toContain("greatest(public.drop_listens.reached_sec, excluded.reached_sec)");
  });

  it("sets completion from the end event, never from a position", () => {
    const rec = read("src/features/reception/ListenRecorder.tsx");
    // The bus parks the clock at the end; completion follows that, not a guess.
    expect(rec).toContain("s.completed = true");
    expect(rec).toContain("snap.currentTime >= dur - 0.75");
    // A tap-and-skip is not a listen.
    expect(rec).toContain("MIN_MEANINGFUL_SEC");
  });

  it("reports counts to the owner and never who listened", () => {
    const sql = read(MIGRATION);
    const report = sql.slice(sql.indexOf("function public.listen_report"));
    expect(report).toContain("count(distinct l.user_id)");
    // Aggregates only — no identity leaves the function.
    expect(report).not.toMatch(/select l\.user_id|username/);
    expect(sql).toContain('create policy "drop_listens own"');
    expect(sql).toContain("using (user_id = auth.uid())");
  });

  it("says Not measured instead of substituting a number", () => {
    const panel = read("src/features/reception/ReceptionPanel.tsx");
    expect(panel).toContain("NOT_MEASURED");
    expect(NOT_MEASURED).toBe("Not measured");
    // Duration is null when no session ever reported one.
    expect(read(MIGRATION)).toContain("max(l.duration_sec)");
    expect(panel).toContain("track length");
  });

  it("never claims to know how a listener felt", () => {
    const panel = code("src/features/reception/ReceptionPanel.tsx");
    expect(panel).not.toMatch(/enjoyed it\b(?!:)/i);
    expect(panel).not.toMatch(/loved|hated|engagement score|sentiment/i);
    // And says so out loud.
    expect(read("src/features/reception/ReceptionPanel.tsx")).toContain(
      "Whether anyone enjoyed it",
    );
  });

  it("keeps playback dry", () => {
    const rec = read("src/features/reception/ListenRecorder.tsx");
    expect(rec).toContain("getSnapshot");
    expect(rec).not.toMatch(/createMediaElementSource|AudioContext|playbackRate/);
    expect(PRINCIPLES.playbackIsDryAndDisclosed).toBe(true);
  });

  it("is mounted, owner-only, and reversible", () => {
    expect(read("src/App.tsx")).toContain("<ListenRecorder />");
    const page = read("src/pages/TrackDetailPage.tsx");
    expect(page).toContain("ReceptionPanel");
    // The tab only exists for the owner.
    expect(page).toContain("function tabsFor(isOwner: boolean)");
    expect(page).toContain('tab === "reception" && drop.authorId === userId');
    expect(
      existsSync(path.join(ROOT, "supabase/migrations/20260815_0099_drop_listens.down.sql")),
    ).toBe(true);
  });

  it("carries no economy yet", () => {
    expect(code(MIGRATION)).not.toMatch(/airtime|charge/i);
  });
});
