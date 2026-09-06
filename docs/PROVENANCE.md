# Provenance

How VYBZ makes a copy traceable, and what the guarantees are.

## Object model

| Object | Meaning |
|---|---|
| **Asset** | A registered original: private storage path, SHA-256, format metadata. Unique per organization by hash. |
| **Issuance** | One delivered copy: recipient, license, watermark id, delivered SHA-256, whether Content Credentials were attached. |
| **Chain event** | Append-only, hash-linked record: `register`, `issue`, `c2pa`, `verify`, `detect`. One chain per organization. |

## The watermark

Direct-sequence spread spectrum (DSSS), per recipient.

1. A 32-byte key is derived as `HMAC-SHA256(secret, org | asset | recipient | watermark_id)`. The secret never leaves the server.
2. The key seeds a deterministic ±1 chip sequence with a period of 8192 samples.
3. The sequence is added to each channel at roughly 34 to 40 dB below the signal, scaled by a local energy envelope so it hides under the music and never rides above silence.
4. The copy is re-encoded as 16-bit PCM WAV.

**Detection** is blind: the suspect is decoded, resampled to the asset's sample rate if it differs, and each channel is folded modulo the period once. The fold does not depend on the candidate, so every issued key correlates against the same fold via FFT; cost is O(samples + issuances × period), and a decoder can stream audio through the fold without holding it whole. The true recipient's key produces a peak far above the noise floor; wrong keys average toward zero. Because the mark repeats, trimming and cropping only shift the peak, so alignment is recovered automatically.

**Robustness:** survives gain change, requantization, resampling within reason, light EQ and compression, and trimming. Like every watermark, it can be degraded by a determined adversary who is willing to damage the audio. It is attribution, not DRM.

**Decision rule:** two independent tests, either suffices. *Absolute:* the top score exceeds 0.15 and is at least 2.5× the runner-up. *Relative:* the top score is a statistical outlier (z-score above 8) against the other candidates plus a set of never-issued decoy keys, and at least 2.5× the runner-up; this catches true recipients on short or tonal material where absolute scores run low. Scores are averaged across channels. Exact byte matches short-circuit to `confidence: "exact"`. `high` is an absolute score above 0.3 or a z-score above 15; otherwise `medium`. The response includes the statistics so you can apply your own policy.

## Content Credentials

When `C2PA_WORKER_URL` is configured, each issued copy is forwarded to the signing worker, which attaches a C2PA manifest with:

- `stds.schema-org.CreativeWork` — title and the organization as author.
- `com.vybz.provenance` — asset id, recipient, watermark id, license, issue time.

The manifest is a metadata chunk; PCM samples are untouched, so the watermark and the credentials coexist. Developer plans sign with the VYBZ staging certificate; Business and Enterprise use a CA-issued certificate so public validators trust the chain.

## Verification methods

`POST /provenance/verify` runs every method that can establish what a file is, cheapest first, and reports each as evidence. No single test is trusted alone; the verdict is the strongest evidence that held.

| Method | What it compares | Survives | Cost |
|---|---|---|---|
| Exact hash | SHA-256 of the bytes against originals and issued copies. | Nothing. Any change to the file breaks it. | Free |
| PCM hash | SHA-256 of the decoded 16-bit audio, prefixed with rate and channel count. | Container changes (WAV to FLAC to AIFF), metadata edits, Content Credentials being added. | Free |
| Fingerprint | Perceptual sub-fingerprints of the audio against the index of every registered original. | Lossy codecs at any bitrate, resampling, gain, trimming, and clips taken from the middle. Reports the offset within the original. | Free |
| Content Credentials | Presence of a C2PA manifest; for VYBZ manifests, the embedded asset and watermark ids against the issuance record. | Anything that keeps the metadata chunk. | Free |
| Watermark | Blind correlation against every issued key of the identified asset. | Codecs, resampling, gain, trimming, light EQ and compression. | One detection |

The fingerprint is what lets verify work without an asset id: it identifies which original a suspect derives from, then the watermark step, when requested with `attribute=true`, correlates against that asset's issuances. A file that no method places is reported `unknown` with a hint.

| | Verify | Detect |
|---|---|---|
| Input | Any file | Any supported audio, one asset |
| Method | All of the above | Watermark correlation |
| Answers | What is this file, where does it come from, and for whom was it issued? | Which issuance does this derived file come from? |
| Cost | Free; one detection when attribution is requested | Metered |

Use verify by default. Call detect directly when you already know the asset and want the full candidate ranking.

## Fingerprint

Mono at 11025 Hz, 2048-sample frames every 512 samples, 33 log-spaced bands between 300 Hz and 2 kHz. Each frame yields a 32-bit sub-fingerprint from the sign of the band-energy differences across frequency and time, the scheme introduced by Haitsma and Kalker. Registration indexes the first ten minutes of every original: every sub-fingerprint value maps to (asset, frame) in Postgres.

Lookup takes up to two minutes of the suspect, votes for (asset, offset) pairs from exact sub-fingerprint hits, then confirms the best candidates by bit error rate over the aligned overlap. A match needs a bit error rate of 0.35 or lower over at least two seconds. The evidence reports `similarity` (one minus the error rate), `offset_sec` (where the suspect begins within the original), `overlap_sec`, and `votes`.

## Ledger

Each event stores `prev_hash` and `row_hash = SHA-256(event | asset | org | payload | prev_hash)`. `GET /provenance/chain` recomputes the entire chain and returns the first broken sequence number, if any. The console shows the same check on the overview page.

## Formats

| | Accepted |
|---|---|
| Register | WAV (8 to 32-bit PCM or float, including extensible), AIFF/AIFC, FLAC. Lossless only, so the stored original is the customer's master. |
| Verify and detect | WAV, AIFF, FLAC, MP3, Ogg Vorbis, Opus decoded in the edge function. AAC/M4A, ALAC, MP4, MOV, WebM, WMA decoded by the ffmpeg worker when `DECODE_WORKER_URL` is configured. |
| Issued copies | 16-bit PCM WAV. Downstream transcoding by the recipient does not remove the mark. |

Files are identified by their bytes, never by name or declared type. `GET /provenance/formats` reports what a deployment accepts.

## Limits

- 200 MB per request; batches of 25 files and 200 MB total.
- Analysis decodes up to 16 million frames per channel (about six minutes at 44.1 kHz). Longer files are analyzed from the start and reported `truncated`; the PCM hash is skipped for them, the fingerprint and watermark still run.
- The fingerprint index covers the first ten minutes of each original.
- Detection cost grows with the number of issuances for the asset at one FFT each. Thousands of issuances are fine; hundreds of thousands should be split across assets.

Last updated: 2026-09-07
