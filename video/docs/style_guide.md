# Style guide — OVERFIT intro (20 s)

No reference video was supplied. Two named styles were proposed; the first was picked for the
unattended run (reasoning in `review_log.md`, round 0):

1. **"Linear launch film"** (picked). Near-black canvas, one accent, asymmetric left-anchored type
   that enters by spring and leaves before the next beat, real UI crops that assemble piece by
   piece and are pushed into by the camera, hard cuts on downbeats, no gradients, no glows on
   chrome, generous negative space. Fits the product: its HUD is already dark panels with hairlines,
   so crops sit on the canvas as if they belong to it.
2. "Tactical briefing / Swiss-grid kinetic type". Hairline grid, monospace readouts counting up,
   redaction bars, scan-lines. Closer to the game's fiction but it would compete with the HUD's own
   mono readouts and tempt a second accent (red). Not used; one device borrowed: a monospace
   counter for the metric shot.

## Palette (sampled from `src/ui/style.css` and the live title screen)
| Role | Hex | Use in the film |
|------|-----|-----------------|
| Canvas | `#07090c` | background, always |
| Display | `#ffffff` | headlines (the wordmark is white) |
| Paper | `#d6e2e0` | body text |
| Muted | `#7d8f8c` | labels, URL |
| Accent | `#37e0c8` (teal) | the one accent: underlines, cursor ring, highlights, counter |
| (AXIOM red `#ff3355`) | appears only inside real UI crops and the diamond mark; never drawn as a graphic accent |

## Type
- Display: **Chakra Petch 700**, caps, tracking 0.12-0.2 em (the game's wordmark treatment). Never overshoots.
- UI: **JetBrains Mono 400/600** for counters, labels, the URL.
- Both OFL, self-hosted from the game's `@fontsource` files (`assets/fonts/`).

## Motion grammar
- 120 BPM; every scene cut on a downbeat (2 s); every state change on a beat (0.5 s).
- Type: `default` spring (170/26), slides 40-60 px from the left, no overshoot; exits 0.1 s before the next beat it must clear.
- UI crops: `default` spring for position/scale; `snappy` for the cursor and button highlights; `heavy` for the logo lockup.
- Camera: `track()` on scale + translate, pushes in on the panel that matters.
- Cuts: hard. Swaps inside a panel: `swapAlpha` plus a 2-4 px blur on the outgoing crop.
- Per-frame shake (the strike) keyed to the frame index via `rng`, 3 frames only.

## Composition
- Left-anchored type with the UI on the right or below; never centred-on-gradient.
- 9:16: type block in the top third, UI block in the lower two thirds. 16:9: type left 45%, UI right 55%.
- Title-safe: 6% from each edge. No corner labels, no frame borders, no watermark captions.
