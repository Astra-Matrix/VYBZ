# Brand

## One line

**VYBZ. Every copy traceable. Every session recoverable.**

## Voice

- Precise. Say what the system does and what it guarantees. Name the limit in the same breath.
- Calm. No exclamation marks, no hype adjectives, no emoji in product surfaces.
- Short. Headlines under eight words. Body paragraphs under four sentences.
- Honest about confidence. "Attributed with high confidence" beats "caught the leaker".

Words we use: original, copy, issuance, recipient, attribute, verify, ledger, repository, commit, restore, organization, key, scope.
Words we avoid: drop, vibe, creator, community, magic, AI-powered, revolutionary.

## Visual system

| Token | Value | Use |
|---|---|---|
| Background | `#06080d` | Page ground |
| Panel | `rgba(255,255,255,.03–.055)` | Cards, inputs |
| Text | `#e8edf5` / `#aab4c3` / `#74809a` | Primary / secondary / muted |
| Cyan | `#00c2ff` | Provenance, primary action |
| Violet | `#8b7cff` | Vault |
| Mint | `#38e8b0` | Agents, success |
| Rose | `#ff5d7a` | Destructive, errors |
| Radius | 18px cards, 12px controls | |
| Type | Lexend (UI), system monospace (code) | |

Backdrop: a single canvas paints the ground, two aurora fields (cyan top-left, violet top-right) drifting on slow sines, a faint mint field below the fold, a dot lattice fading from the top, and a soft spotlight that trails the pointer; dots near the pointer brighten and lean toward it, taking cyan, violet, or mint by their angle around the cursor. A low-opacity grain layer sits on top. Capped at 30 frames per second, paused when the tab is hidden, rendered once as a still image under `prefers-reduced-motion`. Cards use a 1px border and a subtle vertical gradient; accent cards carry a gradient border from cyan to violet.

Motion, all of it easing on `cubic-bezier(.2,.7,.2,1)`:

- Hero: a staged reveal. The eyebrow rule draws in, each headline line rises out of a clip with a 200 ms stagger, a light beam sweeps once beneath the headline, then the lead and the actions arrive. A thin signal line in the three brand colors draws itself once behind the headline. Total under two seconds; nothing loops.
- Sections fade and rise 18 px as they enter the viewport, once.
- Click: a burst at the pointer on the backdrop, nine short strokes in the five brand colors and a cyan ring, gone in 800 ms.
- Hover: cards lift 1 px, tint their border cyan, and carry a spotlight that follows the pointer; icons lift; primary buttons carry one sheen pass; ghost buttons and pills glow in their own color; the nav underline slides in; the logo mark turns a quarter turn.
- Press: 120 ms.
- Under `prefers-reduced-motion` every animation and transition is off and the page is complete on first paint.

Nothing flashes, nothing loops except the ambient backdrop, and no motion carries information that is not also stated in text.

## Logo

The mark is `public/brand/icon.svg`: a rounded square carrying the negative-space waveform on a mint-to-blue gradient (#00ff8f → #00a1ff). Full lockups with the wordmark are `logo.svg`, `logo-white.svg`, and `logo-on-white.svg`; `wordmark-letters.svg` is the letterforms alone. The header uses the mark at 26 px beside "VYBZ" in Lexend 700, 0.08em tracking. Never stretch, never recolor, never regenerate it from CSS.

## Copy patterns

- Product intro: `<Product>. <Promise in one sentence>. <Who it is for>.`
- Feature card: title of three words or fewer, then one or two sentences with a concrete mechanism.
- Error message: what happened, what to do, in that order. Include the request id.

Last updated: 2026-09-07
