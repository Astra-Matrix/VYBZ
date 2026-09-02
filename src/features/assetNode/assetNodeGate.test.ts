/**
 * Local Asset Node gate — originals stay on the creator's device.
 * Indexing is not publishing. No Devices nav. Cloud metadata is owner-only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATE_REGISTRY } from "@/product/invariants";
import { navItems } from "@/shell/navModel";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("local asset node", () => {
  it("is a registered gate", () => {
    expect(GATE_REGISTRY).toContain("assetNode");
  });

  it("does not add a Devices destination before the node exists in chrome", () => {
    expect(navItems().map((i) => i.path)).not.toContain("/devices");
  });

  it("indexes through the Platform Bridge without uploading", () => {
    const walk = read("src/features/assetNode/walkHandle.ts");
    const index = read("src/features/assetNode/indexFolder.ts");
    const store = read("src/features/assetNode/store.ts");
    const ui = read("src/components/library/LocalAssetsLibrary.tsx");
    const web = read("src/platform/bridge/web.ts");
    const desktop = read("src/platform/bridge/desktop.ts");
    const page = read("src/pages/LibraryPage.tsx");
    const cloud = read("src/features/assetNode/cloudSync.ts");
    const mig = read("supabase/migrations/20260821_0111_creator_asset_nodes.sql");
    const sessionMig = read("supabase/migrations/20260821_0114_asset_availability_session.sql");

    expect(web).toContain("showDirectoryPicker");
    expect(web).toContain("pickFiles");
    expect(web).toContain("File picks live only while the app is open");
    expect(desktop).not.toContain("Tauri command pending Phase 2.D");
    expect(desktop).toContain("web.files.selectFolder");
    expect(page).toContain("library-tab-device");
    expect(page).toContain("This device");
    expect(page).toContain('params.get("tab")');
    expect(page).toContain('n.set("tab", next)');
    expect(ui).toContain("Indexing is not publishing");
    expect(ui).toContain("Not published");
    expect(ui).toContain("Swarm is not this catalog");
    expect(ui).toContain("node-honesty");
    expect(store).toContain("Unindex only. Does not delete files on disk.");

    for (const src of [walk, index, store, ui]) {
      expect(src).not.toContain("@/lib/api");
      expect(src).not.toContain("from \"@/lib/supabase\"");
      expect(src).not.toContain("audio-assets");
      expect(src).not.toMatch(/storage\.from\(/);
    }
    expect(walk).not.toContain(".arrayBuffer(");
    expect(walk).not.toContain("sha256");
    expect(walk).toContain("Name-only walk");
    expect(walk).toContain("directory is not listable");
    expect(page).toContain("tab === \"device\"");
    expect(index).toContain("Does not upload, hash, or copy bytes");
    expect(cloud).toContain("creator_nodes");
    expect(cloud).toContain("indexed_assets");
    expect(cloud).toContain("Never uploads file bytes");
    expect(cloud).not.toMatch(/storage\.from\(/);
    expect(cloud).not.toContain(".upload(");
    expect(mig).toContain("create table if not exists public.creator_nodes");
    expect(mig).toContain("create table if not exists public.indexed_assets");
    expect(mig).not.toMatch(/\burl text\b/);
    expect(mig).not.toContain("local_path");
    expect(mig).toContain("Indexing is not publishing");
    expect(sessionMig).toContain("session-only");
    expect(sessionMig).toContain("unavailable");
    expect(sessionMig).not.toMatch(/\burl text\b/);
    expect(sessionMig).not.toContain("local_path");
    expect(ui).toContain("availability-legend");
    expect(ui).toContain("session-only");
    expect(ui).toContain("Not a background host");
    expect(store).toContain("Never written to IndexedDB");
    expect(read("src/app/routeTruth.ts")).toContain('title: "This device"');
    expect(read("src/app/routeTruth.ts")).toContain("/library?tab=device");
    expect(read("src/shell/commands.ts")).toContain("Index this device");
    expect(read("src/components/shell/DrawerChrome.tsx")).toContain("add-node");
    expect(read("src/components/shell/DrawerChrome.tsx")).toContain("/library?tab=device");
    expect(read("supabase/migrations/20260709_0001_vybz_v1.sql")).toContain("url text not null");
  });
});
