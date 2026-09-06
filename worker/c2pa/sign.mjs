// VYBZ C2PA signing — attaches a signed Content Credentials manifest to a
// delivered audio file (WAV/MP3), binding VYBZ's provenance assertions (creator,
// asset id, per-recipient watermark id, license) to the bytes. Wraps Adobe/CAI's
// `c2patool` (the current, maintained tool for audio C2PA, 2026). Runs in Node —
// NOT in a Deno edge function — so it lives in this worker.
//
// Verified locally: a WAV signed with the manifest below reads back with
// "validation_state": "Valid" and the VYBZ assertions intact.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);
const C2PATOOL = process.env.C2PATOOL_BIN || "c2patool";

/** Build a C2PA manifest describing a delivered VYBZ drop. */
export function buildManifest(meta) {
  return {
    alg: "es256",
    claim_generator: "VYBZ/1.0 (Astra Matrix)",
    title: meta.title || "VYBZ drop",
    assertions: [
      {
        label: "stds.schema-org.CreativeWork",
        kind: "Json",
        data: {
          "@context": "https://schema.org",
          "@type": "MusicRecording",
          name: meta.title || "",
          author: meta.author ? [{ "@type": "Person", name: meta.author }] : [],
        },
      },
      {
        label: "com.vybz.provenance",
        data: {
          asset_id: meta.assetId ?? null,
          recipient: meta.recipient ?? null,
          watermark_id: meta.watermarkId ?? null,
          license: meta.license ?? null,
          issued_at: new Date().toISOString(),
          platform: "vybz.cloud",
        },
      },
    ],
  };
}

/**
 * Sign an audio buffer with a C2PA manifest. `certPem`/`keyPem` are the ES256
 * signing certificate chain + private key (self-signed for alpha; a CA-issued
 * cert for production). Returns the signed audio bytes.
 */
export async function signAudio(audioBuffer, meta, { certPem, keyPem, ext = "wav" }) {
  const dir = await mkdtemp(join(tmpdir(), "vybz-c2pa-"));
  try {
    const inP = join(dir, `in.${ext}`);
    const outP = join(dir, `out.${ext}`);
    const manP = join(dir, "manifest.json");
    await writeFile(inP, audioBuffer);
    await writeFile(manP, JSON.stringify(buildManifest(meta)));
    await execFileP(C2PATOOL, [inP, "-m", manP, "-o", outP, "-f"], {
      env: { ...process.env, C2PA_PRIVATE_KEY: keyPem, C2PA_SIGN_CERT: certPem },
      maxBuffer: 1 << 30,
    });
    return await readFile(outP);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Read + validate the C2PA manifest of an audio file (returns c2patool's report). */
export async function readManifest(path) {
  const { stdout } = await execFileP(C2PATOOL, [path], { maxBuffer: 1 << 30 });
  return JSON.parse(stdout);
}
