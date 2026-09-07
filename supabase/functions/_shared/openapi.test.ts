import { describe, expect, it, vi } from "vitest";

// edge.ts pulls supabase-js from esm.sh, which Node cannot load; the document needs only the version constant.
vi.mock("./edge.ts", () => ({ admin: {}, STORAGE: { url: "", key: "" } }));
import { openapiDocument } from "./openapi.ts";

describe("openapi document", () => {
  it("renders without reference errors and lists every route family", () => {
    const doc = openapiDocument("https://vybz.cloud/v1") as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(doc.openapi).toBe("3.1.0");
    for (const p of [
      "/me", "/billing/usage",
      "/provenance/assets", "/provenance/assets/{id}/issue", "/provenance/assets/{id}/issue/batch", "/provenance/verify", "/provenance/verify/batch",
      "/webhooks", "/webhooks/{id}/deliveries/{delivery}/retry",
      "/vault/repos/{repo}/blobs", "/vault/repos/{repo}/uploads", "/vault/repos/{repo}/uploads/{upload}/parts/{n}", "/vault/repos/{repo}/uploads/{upload}/complete",
    ]) expect(doc.paths[p], p).toBeTruthy();
    for (const s of ["IssueBatchRequest", "IssueBatch", "Upload", "Blob"]) expect(doc.components.schemas[s], s).toBeTruthy();
    // Every $ref resolves to a declared schema.
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/[A-Za-z]+/g) ?? [];
    for (const r of new Set(refs)) expect(doc.components.schemas[r.split("/").pop()!], r).toBeTruthy();
  });
});
