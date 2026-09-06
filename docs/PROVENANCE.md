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

**Detection** is blind: the suspect signal is folded modulo the period, then circularly cross-correlated with each candidate's sequence via FFT. The true recipient's key produces a peak far above the noise floor; wrong keys average toward zero. Because the mark repeats, trimming and cropping only shift the peak, so alignment is recovered automatically.

**Robustness:** survives gain change, requantization, resampling within reason, light EQ and compression, and trimming. Like every watermark, it can be degraded by a determined adversary who is willing to damage the audio. It is attribution, not DRM.

**Decision rule:** two independent tests, either suffices. *Absolute:* the top score exceeds 0.15 and is at least 2.5× the runner-up. *Relative:* the top score is a statistical outlier (z-score above 8) against the other candidates plus a set of never-issued decoy keys, and at least 2.5× the runner-up; this catches true recipients on short or tonal material where absolute scores run low. Scores are averaged across channels. Exact byte matches short-circuit to `confidence: "exact"`. `high` is an absolute score above 0.3 or a z-score above 15; otherwise `medium`. The response includes the statistics so you can apply your own policy.

## Content Credentials

When `C2PA_WORKER_URL` is configured, each issued copy is forwarded to the signing worker, which attaches a C2PA manifest with:

- `stds.schema-org.CreativeWork` — title and the organization as author.
- `com.vybz.provenance` — asset id, recipient, watermark id, license, issue time.

The manifest is a metadata chunk; PCM samples are untouched, so the watermark and the credentials coexist. Developer plans sign with the VYBZ staging certificate; Business and Enterprise use a CA-issued certificate so public validators trust the chain.

## Verify versus detect

| | Verify | Detect |
|---|---|---|
| Input | Any bytes | PCM WAV, one asset |
| Method | Exact SHA-256 lookup | Blind correlation |
| Answers | Is this exactly a file we hold, and for whom? | Which issuance does this derived file come from? |
| Cost | Free | Metered |

Use verify first; it is instant. Fall back to detect when the file has been transcoded, trimmed, or otherwise altered.

## Ledger

Each event stores `prev_hash` and `row_hash = SHA-256(event | asset | org | payload | prev_hash)`. `GET /provenance/chain` recomputes the entire chain and returns the first broken sequence number, if any. The console shows the same check on the overview page.

## Formats

Registration and detection require PCM WAV. Decode MP3, AAC, FLAC, or video audio to WAV before calling. Delivered copies are 16-bit PCM WAV; downstream transcoding by the recipient does not remove the mark.

## Limits

- 200 MB per request.
- Detection cost grows linearly with the number of issuances for the asset. Thousands of issuances are fine; hundreds of thousands should be split across assets.

Last updated: 2026-09-05
