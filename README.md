# 🎨 Paintris

**A physics-based colour puzzle where every block splashes into living paint.**

Tetris pieces made of wet paint. When they land they burst into hundreds of
particles that flow, pool, drip and mix. You don't clear rows — you clear
**colour zones**, when enough connected paint of one colour covers the canvas.

No two landings ever look the same.

*a game by [zaney.dev](https://zaney.dev)*

---

## Play

```bash
npm install
npm run dev
```

Open <http://localhost:3002>.

| Key | Action |
| --- | --- |
| `←` `→` | move |
| `↑` | rotate |
| `↓` | soft drop |
| `space` | slam down |
| `C` / `shift` | hold piece |
| `esc` | end session |

Touch controls appear on mobile.

## How it plays

Drop paint, build big connected areas of a single colour, and they glow, bubble
and pop. Chained pops build a combo — four in a row is a **PAINTSTORM**.

Colours mix where they touch:

- red + blue → purple
- blue + yellow → green
- red + yellow → orange

And each colour has its own physics. Red is heavy and stacks well. Blue is
watery and finds every gap. Green is sticky and clings to walls, so it can
bridge holes. Black is dense and makes a good blocker. Yellow is light.

### Special paints

| | |
| --- | --- |
| 🌈 **Rainbow** | wildcard — joins any colour zone |
| 💣 **Explosive** | blasts a crater of blank canvas |
| ✨ **Metallic** | can't mix, can't be cleared — a permanent obstacle |
| ⚪ **White** | shoves surrounding paint outward on impact |
| 🧲 **Magnetic** | pulls nearby paint inward |
| ❄️ **Frozen** | temporarily solid, then thaws into blue |
| 🔥 **Hot** | burns neighbouring paint, then chars into black |
| 🪞 **Mirror** | splashes twice, mirrored across the canvas |

### Modes

- **Classic** — endless, speeds up as you go
- **Zen** — no losing, slower pour, just paint
- **Rush** — everything falls more than twice as fast
- **Daily** — everyone gets the same piece sequence for the day
- **Puzzle** — hit colour coverage targets on a fixed piece budget

Beat a mode's top five and you get to punch in three initials, arcade style.
Every mode keeps its own board — dailies reset each day and each puzzle tracks
separately — all viewable under **HIGH SCORES**.

Every run earns **paint drops**, which unlock canvases — light ones (white,
cream, watercolour paper, candy) and dark ones (midnight, concrete, deep space).
Purely cosmetic; they never change how the game plays.

## How it works

| File | Role |
| --- | --- |
| `lib/engine.ts` | falling-sand paint simulation, zone detection, modes |
| `lib/pixiRenderer.ts` | PixiJS gloss shader + GPU spark particles |
| `lib/meta.ts` | canvases, puzzles, save data |
| `components/PaintrisGame.tsx` | compositing and UI |

The playfield is 10 × 20 blocks, the classic proportion, at `18` simulation
cells per block — a `180 × 360` grid. `B` in `lib/engine.ts` is the single
fidelity knob: every distance and speed derives from it, so raising it makes
the paint finer without changing how the game plays. Pieces fall as rigid blocks, then
dissolve into loose paint that the sand solver moves each frame — falling,
flowing sideways, sticking, mixing, and pulling itself together by surface
tension. A flood fill finds connected same-colour regions and pops any holding
about eight blocks' worth of paint.

The simulation runs on a fixed 60 Hz interval clock and owns its own timing, so
it stays correct on any refresh rate and keeps flowing when the tab is occluded
(browsers throttle `requestAnimationFrame`, which would otherwise stall it).
Rendering is separate: the grid is composited on the CPU into an RGBA buffer
where **alpha is the paint mask**, uploaded to a PixiJS buffer texture, and
drawn by a mesh shader that derives surface normals from that mask for wet
specular highlights and a moving sheen. The falling piece and its landing
preview are drawn as vector geometry on top rather than baked into the grid, so
their edges stay sharp, and the canvas renders above its CSS size for retina
displays. Sparks are pooled GPU sprites with additive blending. Without WebGL
it falls back to plain 2D canvas.

Progress lives in `localStorage` under `paintris-save-v1` — scores, unlocked
canvases, drops and settings.

## Stack

Next.js · TypeScript · PixiJS · Vercel Analytics

Type is Bungee for signage and Space Grotesk for reading text, both self-hosted
through `next/font` so there's no request to a font CDN at runtime.

## Licence

All rights reserved.
