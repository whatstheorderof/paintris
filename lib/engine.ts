// Paintris core engine: a falling-sand style paint simulation on a cell grid.
// Tetromino pieces fall as rigid bodies, then burst into loose paint particles
// that flow, mix, and settle. Connected same-colour zones above a size
// threshold clear with combos.

// A 10 x 20 block playfield, the classic proportion — anything shorter fills
// up before you can build a colour zone worth clearing. Each block is B cells
// on a side, giving the paint room to splash and pool. Constants further down
// that depend on cell counts are tuned for this grid.
export const B = 14; // grid cells per tetromino block edge
export const COLS = B * 10;
export const ROWS = B * 20;

export enum P {
  Empty = 0,
  Red,
  Blue,
  Yellow,
  Green,
  Black,
  Purple,
  Orange,
  White,
  Rainbow,
  Metallic,
  Explosive,
  Magnetic,
  Frozen,
  Hot,
  Mirror,
}

// Per-colour paint behaviour.
// fall: chance to fall an extra cell per step (density)
// flow: chance to flow sideways when resting on paint (wateriness)
// stick: chance to refuse to move at all (stickiness)
const PROPS: Record<number, { fall: number; flow: number; stick: number }> = {
  [P.Red]: { fall: 0.8, flow: 0.1, stick: 0 },
  [P.Blue]: { fall: 0.3, flow: 0.85, stick: 0 },
  [P.Yellow]: { fall: 0.15, flow: 0.45, stick: 0 },
  [P.Green]: { fall: 0.3, flow: 0.05, stick: 0.35 },
  [P.Black]: { fall: 0.95, flow: 0.02, stick: 0.1 },
  [P.Purple]: { fall: 0.5, flow: 0.3, stick: 0 },
  [P.Orange]: { fall: 0.4, flow: 0.35, stick: 0 },
  [P.White]: { fall: 0.3, flow: 0.5, stick: 0 },
  [P.Rainbow]: { fall: 0.4, flow: 0.5, stick: 0 },
  [P.Magnetic]: { fall: 0.5, flow: 0.05, stick: 0.3 },
  [P.Hot]: { fall: 0.7, flow: 0.15, stick: 0 },
  [P.Mirror]: { fall: 0.4, flow: 0.3, stick: 0 },
};

export const RGB: Record<number, [number, number, number]> = {
  [P.Red]: [229, 52, 74],
  [P.Blue]: [47, 127, 232],
  [P.Yellow]: [247, 201, 72],
  [P.Green]: [62, 201, 110],
  [P.Black]: [44, 44, 56],
  [P.Purple]: [155, 79, 214],
  [P.Orange]: [247, 127, 58],
  [P.White]: [230, 231, 240],
  [P.Rainbow]: [255, 255, 255], // rendered as animated hue cycle
  [P.Metallic]: [184, 190, 201],
  [P.Explosive]: [255, 92, 40], // only exists as a falling piece
  [P.Magnetic]: [214, 64, 150],
  [P.Frozen]: [150, 214, 236],
  [P.Hot]: [236, 84, 26],
  [P.Mirror]: [186, 170, 222],
};

export const COLOR_NAMES: Record<number, string> = {
  [P.Red]: "red",
  [P.Blue]: "blue",
  [P.Yellow]: "yellow",
  [P.Green]: "green",
  [P.Black]: "black",
  [P.Purple]: "purple",
  [P.Orange]: "orange",
  [P.White]: "white",
};

// Unordered primary-pair mixing recipes.
function mixOf(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === P.Red && hi === P.Blue) return P.Purple;
  if (lo === P.Blue && hi === P.Yellow) return P.Green;
  if (lo === P.Red && hi === P.Yellow) return P.Orange;
  return 0;
}

// Colours that can form clearable zones (rainbow joins them as a wildcard).
function zoneColor(c: number): boolean {
  return (
    c !== P.Empty && c !== P.Metallic && c !== P.Rainbow && c !== P.Frozen && c !== P.Hot
  );
}

const SHAPES: [number, number][][] = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], // I
  [[0, 0], [1, 0], [0, 1], [1, 1]], // O
  [[0, 0], [1, 0], [2, 0], [1, 1]], // T
  [[1, 0], [2, 0], [0, 1], [1, 1]], // S
  [[0, 0], [1, 0], [1, 1], [2, 1]], // Z
  [[0, 0], [0, 1], [1, 1], [2, 1]], // J
  [[2, 0], [0, 1], [1, 1], [2, 1]], // L
];

export interface Piece {
  blocks: [number, number][]; // block coords within the piece
  color: number;
  x: number; // grid cells
  y: number;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: number;
}

export interface EngineOpts {
  seed?: number;
  zen?: boolean; // canvas never fills
  baseSpeed?: number; // piece gravity, cells per frame
  ramp?: boolean; // speed up as pieces are used
  budget?: number; // piece limit (puzzle mode)
  targets?: { color: number; pct: number }[]; // colour coverage goals
  plainPieces?: boolean; // no special paints (puzzle mode)
}

export type EngineEvent = "land" | "clear" | "boom" | "over" | "win";

// With hold + landing preview, deliberate play makes zones easy to build —
// a higher pop threshold keeps clears feeling earned.
// Scale this with cells-per-block (B*B), not with total board area — it's
// "how many blocks of one colour must connect", which is what a player feels.
const CLEAR_SIZE = B * B * 8; // ~8 blocks of connected colour
// A crowded canvas fragments into a dozen colours, and the biggest zone
// stalls just under the bar — nothing can ever pop and the board deadlocks.
// So thick paint runs: the fuller it gets, the less it takes to make it go.
const CLEAR_SIZE_FLOODED = B * B * 2.5;
const FLOOD_FROM = 0.5; // fill fraction where the threshold starts easing
const FLOOD_TO = 0.88; // ...and where it bottoms out
// Above this, the canvas must always be able to shed something: a crowded
// board fragments into ever-smaller zones, so easing the bar alone can chase
// a target it never catches and the game deadlocks.
const DROWNING = 0.78;
const CLEAR_ANIM = 32; // frames of glow before removal
const COMBO_WINDOW = 300; // frames between clears that keep a combo alive
const BOOM_RADIUS = 34;
const PULSE_RADIUS = 27; // white push / magnetic pull
const MIN_PAINT_FOR_TARGETS = 7100; // coverage goals need a real painting first
// Canvas-full backstop, measured as the share of COLUMNS whose top two rows
// hold paint. Counting cells instead would miss a narrow tower that reaches
// the ceiling in only a few columns.
const TOP_COLS_FULL = 0.55;

// mulberry32 — tiny seedable PRNG so daily runs share a piece sequence
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Engine {
  grid = new Uint8Array(COLS * ROWS);
  clearing = new Uint8Array(COLS * ROWS); // countdown per cell during pop
  piece: Piece | null = null;
  next: Piece;
  held: Piece | null = null;
  holdUsed = false; // one hold per drop
  sparks: Spark[] = [];
  frame = 0;
  score = 0;
  combo = 0;
  comboTimer = 0;
  comboFlash = 0; // frames left to show the combo banner
  lastClearSize = 0;
  gameOver = false;
  won = false;
  softDrop = false;
  moveDir = 0; // -1 | 0 | 1, held horizontal movement
  piecesUsed = 0;
  fill = 0; // fraction of the canvas covered in paint
  flooding = false; // canvas crowded enough that paint is running
  progress: { color: number; pct: number; target: number }[] = [];
  onEvent: (e: EngineEvent, n?: number) => void = () => {};

  private rnd: () => number;
  private opts: EngineOpts;
  private fallAcc = 0;
  private settleTimer = -1; // countdown after the piece budget runs out

  constructor(opts: EngineOpts = {}) {
    this.opts = opts;
    this.rnd = mulberry32(opts.seed ?? (Math.random() * 2 ** 32) | 0);
    this.next = this.makePiece();
    if (opts.targets) {
      this.progress = opts.targets.map((t) => ({ color: t.color, pct: 0, target: t.pct }));
    }
  }

  get piecesLeft(): number | null {
    return this.opts.budget != null ? Math.max(0, this.opts.budget - this.piecesUsed) : null;
  }

  get ended(): boolean {
    return this.gameOver || this.won;
  }

  private makePiece(): Piece {
    const shape = SHAPES[(this.rnd() * SHAPES.length) | 0];
    const r = this.rnd();
    let color: number;
    const base = [P.Red, P.Blue, P.Yellow, P.Green, P.Purple, P.Orange];
    if (this.opts.plainPieces) {
      color = r < 0.1 ? P.Black : base[(this.rnd() * base.length) | 0];
    } else if (r < 0.025) color = P.Rainbow;
    else if (r < 0.05) color = P.Explosive;
    else if (r < 0.075) color = P.Metallic;
    else if (r < 0.1) color = P.White;
    else if (r < 0.125) color = P.Magnetic;
    else if (r < 0.15) color = P.Frozen;
    else if (r < 0.175) color = P.Hot;
    else if (r < 0.2) color = P.Mirror;
    else if (r < 0.27) color = P.Black;
    else color = base[(this.rnd() * base.length) | 0];
    return { blocks: shape.map((b) => [...b] as [number, number]), color, x: 0, y: 0 };
  }

  // debug helper: force the colour of the next piece
  forceNext(color: number) {
    this.next.color = color;
  }

  private placeAtSpawn(p: Piece) {
    const w = Math.max(...p.blocks.map((b) => b[0])) + 1;
    p.x = Math.floor((COLS - w * B) / 2 / 2) * 2;
    p.y = -(Math.max(...p.blocks.map((b) => b[1])) + 1) * B;
  }

  spawn() {
    if (this.ended) return;
    if (this.opts.budget != null && this.piecesUsed >= this.opts.budget) {
      this.piece = null;
      this.settleTimer = 240; // let the paint settle, then judge the canvas
      return;
    }
    this.piecesUsed++;
    this.holdUsed = false;
    this.piece = this.next;
    this.next = this.makePiece();
    this.placeAtSpawn(this.piece);
  }

  private pieceHeight(p: Piece): number {
    return (Math.max(...p.blocks.map((b) => b[1])) + 1) * B;
  }

  // stash the current piece; bring out the held one (or the next)
  hold() {
    if (!this.piece || this.ended || this.holdUsed) return;
    const cur = this.piece;
    if (this.held) {
      this.piece = this.held;
    } else {
      this.piece = this.next;
      this.next = this.makePiece();
    }
    this.placeAtSpawn(this.piece);
    this.held = cur;
    this.holdUsed = true;
  }

  // how far the active piece would fall on a hard drop (landing preview)
  ghostDy(): number {
    const p = this.piece;
    if (!p) return 0;
    let dy = 0;
    while (!this.collides(p, 0, dy + 1)) dy++;
    return dy;
  }

  private endGame() {
    this.gameOver = true;
    this.piece = null;
    this.onEvent("over");
  }

  private speed(): number {
    let s = this.opts.baseSpeed ?? 1.7;
    if (this.opts.ramp) s += Math.min(3.4, this.piecesUsed * 0.03);
    return s;
  }

  // Walls and floor are hard; a few stray paint cells are not — wet paint
  // plows through them instead of perching on a single splashed pixel.
  private collides(p: Piece, dx: number, dy: number): boolean {
    let overlap = 0;
    for (const [bx, by] of p.blocks) {
      const x0 = p.x + dx + bx * B;
      const y0 = p.y + dy + by * B;
      if (x0 < 0 || x0 + B > COLS || y0 + B > ROWS) return true;
      for (let y = Math.max(0, y0); y < y0 + B; y++) {
        const row = y * COLS;
        for (let x = x0; x < x0 + B; x++) {
          if (this.grid[row + x] !== P.Empty && ++overlap > 9) return true;
        }
      }
    }
    return false;
  }

  rotate() {
    const p = this.piece;
    if (!p || this.ended) return;
    const rotated = p.blocks.map(([x, y]) => [y, -x] as [number, number]);
    const minX = Math.min(...rotated.map((b) => b[0]));
    const minY = Math.min(...rotated.map((b) => b[1]));
    const norm = rotated.map(([x, y]) => [x - minX, y - minY] as [number, number]);
    const old = p.blocks;
    p.blocks = norm;
    // nudge back in bounds / off paint if the rotation clips
    for (const dx of [0, -B, B, -2 * B, 2 * B]) {
      if (!this.collides(p, dx, 0)) {
        p.x += dx;
        return;
      }
    }
    p.blocks = old;
  }

  hardDrop() {
    const p = this.piece;
    if (!p || this.ended) return;
    let dy = 0;
    while (!this.collides(p, 0, dy + 1)) dy++;
    p.y += dy;
    this.land();
  }

  private pieceCenter(p: Piece): [number, number] {
    const w = Math.max(...p.blocks.map((b) => b[0])) + 1;
    const h = Math.max(...p.blocks.map((b) => b[1])) + 1;
    return [p.x + (w * B) / 2, p.y + (h * B) / 2];
  }

  private land() {
    const p = this.piece!;
    this.piece = null;

    // Lock out: the stack is so high the piece came to rest without any part
    // of it reaching the canvas. Pieces spawn above row 0, so this — not a
    // test at the spawn position — is what "you hit the top" means here.
    if (!this.opts.zen && p.y + this.pieceHeight(p) <= 0) {
      this.endGame();
      return;
    }

    if (p.color === P.Explosive) {
      this.explode(p);
      return;
    }
    const [cx, cy] = this.pieceCenter(p);
    if (p.color === P.White) this.pulse(cx, cy, 1); // shove paint outward
    if (p.color === P.Magnetic) this.pulse(cx, cy, -1); // suck paint inward
    this.stamp(p, p.x);
    if (p.color === P.Mirror) {
      // mirror paint splashes twice — once here, once reflected
      const w = (Math.max(...p.blocks.map((b) => b[0])) + 1) * B;
      this.stamp(p, COLS - p.x - w);
      this.burstSparks(COLS - cx, Math.max(0, cy), p.color, 25);
    }
    this.burstSparks(cx, Math.max(0, cy), p.color, 30);
    this.onEvent("land");
    this.spawn();
  }

  private stamp(p: Piece, originX: number) {
    for (const [bx, by] of p.blocks) {
      const x0 = originX + bx * B;
      const y0 = p.y + by * B;
      for (let y = y0; y < y0 + B; y++) {
        if (y < 0) continue;
        for (let x = x0; x < x0 + B; x++) {
          // splash: some particles spray sideways as the wet paint hits
          let tx = x;
          let ty = y;
          if (this.rnd() < 0.06) {
            tx = x + ((this.rnd() * 5) | 0) - 2;
            ty = y + ((this.rnd() * 3) | 0) - 1;
          }
          if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) { tx = x; ty = y; }
          const i = ty * COLS + tx;
          if (this.grid[i] === P.Empty) this.grid[i] = p.color;
          else this.grid[y * COLS + x] = p.color;
        }
      }
    }
  }

  // Radial shove (dir=1, white paint) or suction (dir=-1, magnetic paint).
  private pulse(cx: number, cy: number, dir: 1 | -1) {
    const cells: [number, number, number][] = []; // x, y, dist²
    const r = PULSE_RADIUS;
    for (let y = Math.max(0, cy - r); y < Math.min(ROWS, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(COLS, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r || d2 === 0) continue;
        const c = this.grid[y * COLS + x];
        if (c === P.Empty || c === P.Metallic || c === P.Frozen) continue;
        cells.push([x, y, d2]);
      }
    }
    // push processes far cells first so inner paint has room to move out;
    // pull is the reverse
    cells.sort((a, b) => (dir === 1 ? b[2] - a[2] : a[2] - b[2]));
    for (const [x, y] of cells) {
      const sx = Math.sign(x - cx) * dir;
      const sy = Math.sign(y - cy) * dir;
      const tx = x + sx * 2;
      const ty = y + sy * 2;
      if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) continue;
      const from = y * COLS + x;
      const to = ty * COLS + tx;
      if (this.grid[to] === P.Empty) {
        this.grid[to] = this.grid[from];
        this.grid[from] = P.Empty;
      }
    }
  }

  private explode(p: Piece) {
    const [cx, cy] = this.pieceCenter(p);
    for (let y = Math.max(0, cy - BOOM_RADIUS); y < Math.min(ROWS, cy + BOOM_RADIUS); y++) {
      for (let x = Math.max(0, cx - BOOM_RADIUS); x < Math.min(COLS, cx + BOOM_RADIUS); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= BOOM_RADIUS * BOOM_RADIUS) {
          const i = y * COLS + x;
          if (this.grid[i] !== P.Metallic) this.grid[i] = P.Empty;
        }
      }
    }
    this.burstSparks(cx, Math.max(0, cy), P.Explosive, 220);
    this.score += 150;
    this.onEvent("boom");
    this.spawn();
  }

  private burstSparks(cx: number, cy: number, color: number, n: number) {
    if (this.sparks.length > 2200) return; // GPU draws them, CPU still moves them
    for (let k = 0; k < n; k++) {
      const a = this.rnd() * Math.PI * 2;
      const v = 0.5 + this.rnd() * 1.5;
      this.sparks.push({
        x: cx, y: cy,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.8,
        life: 20 + this.rnd() * 25, color,
      });
    }
  }

  private stepAcc = 0;
  private lastStepAt = 0;

  // Advance the world to "now" at a fixed 60Hz, regardless of how often or
  // from how many drivers this is called — the engine owns its own clock.
  step() {
    const now = performance.now();
    if (this.lastStepAt === 0) this.lastStepAt = now;
    this.stepAcc = Math.min(this.stepAcc + (now - this.lastStepAt), 100);
    this.lastStepAt = now;
    const STEP = 1000 / 60;
    while (this.stepAcc >= STEP) {
      this.stepAcc -= STEP;
      this.tick();
    }
  }

  // One frame of the world: piece gravity, paint physics, clears, sparks.
  // The paint keeps flowing even after the game ends — it looks better that way.
  private tick() {
    this.frame++;

    if (!this.ended && this.piece) {
      if (this.moveDir !== 0) {
        for (let k = 0; k < 3; k++) {
          if (!this.collides(this.piece, this.moveDir, 0)) this.piece.x += this.moveDir;
        }
      }
      this.fallAcc += this.softDrop ? 11 : this.speed();
      let fall = this.fallAcc | 0;
      this.fallAcc -= fall;
      let moved = 0;
      while (moved < fall && !this.collides(this.piece, 0, 1)) {
        this.piece.y++;
        moved++;
      }
      if (moved < fall) this.land();
    }

    this.stepPaint();
    this.stepClearing();
    if (!this.ended && this.frame % 30 === 0) {
      this.findZones();
      this.checkTargets();
    }

    // puzzle: out of pieces — once the paint settles, judge the canvas
    if (!this.ended && this.settleTimer > 0) {
      this.settleTimer--;
      if (this.settleTimer === 0) {
        this.checkTargets();
        if (!this.won) this.endGame();
      }
    }

    // canvas is full when settled paint crowds the very top of the board
    if (!this.ended && !this.opts.zen && this.frame % 15 === 0) {
      let cols = 0;
      for (let x = 0; x < COLS; x++) {
        if (this.grid[x] !== P.Empty || this.grid[COLS + x] !== P.Empty) cols++;
      }
      if (cols > COLS * TOP_COLS_FULL) this.endGame();
    }

    if (this.comboTimer > 0) this.comboTimer--;
    else this.combo = 0;
    if (this.comboFlash > 0) this.comboFlash--;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.08;
      s.life--;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
  }

  private checkTargets() {
    const targets = this.opts.targets;
    if (!targets || this.won) return;
    const counts = new Array<number>(32).fill(0);
    let total = 0;
    for (let i = 0; i < this.grid.length; i++) {
      const c = this.grid[i];
      if (c === P.Empty) continue;
      counts[c]++;
      total++;
    }
    this.progress = targets.map((t) => ({
      color: t.color,
      pct: total > 0 ? (counts[t.color] / total) * 100 : 0,
      target: t.pct,
    }));
    if (total < MIN_PAINT_FOR_TARGETS) return;
    if (this.progress.every((p) => p.pct >= p.target)) {
      this.won = true;
      this.piece = null;
      this.onEvent("win");
    }
  }

  private stepPaint() {
    const g = this.grid;
    for (let y = ROWS - 2; y >= 0; y--) {
      const ltr = (y + this.frame) & 1;
      const row = y * COLS;
      for (let k = 0; k < COLS; k++) {
        const x = ltr ? k : COLS - 1 - k;
        const i = row + x;
        const c = g[i];
        if (c === P.Empty || this.clearing[i]) continue;
        const below = i + COLS;

        // metallic drops straight down but never spreads, mixes, or clears
        if (c === P.Metallic) {
          if (g[below] === P.Empty) {
            g[below] = c;
            g[i] = P.Empty;
          }
          continue;
        }

        // frozen paint is temporarily solid — it still falls, but never
        // spreads or mixes, and eventually thaws into water-blue
        if (c === P.Frozen) {
          if (g[below] === P.Empty) {
            g[below] = c;
            g[i] = P.Empty;
          } else if (this.rnd() < 0.0012) {
            g[i] = P.Blue;
          }
          continue;
        }

        // hot paint burns its neighbours, then chars into black
        if (c === P.Hot) {
          if (this.rnd() < 0.03) {
            const d = [1, -1, COLS, -COLS][(this.rnd() * 4) | 0];
            const j = i + d;
            if (!(d === 1 && x === COLS - 1) && !(d === -1 && x === 0) && j >= 0 && j < g.length) {
              const t = g[j];
              if (t === P.Frozen) g[j] = P.Blue; // melts ice instantly
              else if (t !== P.Empty && t !== P.Hot && t !== P.Metallic) {
                g[j] = P.Empty;
                if (this.rnd() < 0.1) this.burstSparks(x, y, P.Hot, 1);
              }
            }
          }
          if (this.rnd() < 0.0015) {
            g[i] = P.Black;
            continue;
          }
        }

        const props = PROPS[c];

        if (g[below] === P.Empty) {
          g[below] = c;
          g[i] = P.Empty;
          // dense paint drops an extra cell
          if (this.rnd() < props.fall && y + 2 < ROWS && g[below + COLS] === P.Empty) {
            g[below + COLS] = c;
            g[below] = P.Empty;
          }
          continue;
        }
        if (this.rnd() < props.stick) continue;

        // Slide down slopes when the diagonal is clear. Requiring the cell
        // beside it to be clear too would hold paint at a steep angle, and
        // mounds would spike into the ceiling with the board half empty.
        const canL = x > 0 && g[below - 1] === P.Empty;
        const canR = x < COLS - 1 && g[below + 1] === P.Empty;
        if (canL || canR) {
          const dir = canL && canR ? (this.rnd() < 0.5 ? -1 : 1) : canL ? -1 : 1;
          g[below + dir] = c;
          g[i] = P.Empty;
          continue;
        }

        // watery colours creep sideways across surfaces
        if (this.rnd() < props.flow) {
          const dir = this.rnd() < 0.5 ? -1 : 1;
          const nx = x + dir;
          if (nx >= 0 && nx < COLS && g[row + nx] === P.Empty) {
            g[row + nx] = c;
            g[i] = P.Empty;
            continue;
          }
        }

        // paint tension: speckles surrounded by another colour get absorbed
        if (this.rnd() < 0.06) {
          const n1 = x > 0 ? g[i - 1] : 0;
          const n2 = x < COLS - 1 ? g[i + 1] : 0;
          const n3 = y > 0 ? g[i - COLS] : 0;
          const n4 = g[below];
          if (n1 && n1 === n2 && (n1 === n3 || n1 === n4) && n1 !== c && zoneColor(n1)) {
            g[i] = n1;
            continue;
          }
          if (n3 && n3 === n4 && (n3 === n1 || n3 === n2) && n3 !== c && zoneColor(n3)) {
            g[i] = n3;
            continue;
          }
        }

        // settled: wet neighbours of mixable colours slowly blend
        if (this.rnd() < 0.005) {
          for (const d of [1, -1, COLS, -COLS]) {
            const j = i + d;
            if (j < 0 || j >= g.length) continue;
            if (d === 1 && x === COLS - 1) continue;
            if (d === -1 && x === 0) continue;
            const m = mixOf(c, g[j]);
            if (m) {
              g[i] = m;
              g[j] = m;
              break;
            }
          }
        }
      }
    }
  }

  private stepClearing() {
    let removed = 0;
    for (let i = 0; i < this.clearing.length; i++) {
      if (this.clearing[i] > 0) {
        this.clearing[i]--;
        if (this.clearing[i] === 0) {
          this.grid[i] = P.Empty;
          removed++;
        }
      }
    }
    if (removed > 200) {
      // a zone just finished popping — celebrate
      this.onEvent("clear", removed);
    }
  }

  /** How much connected colour it currently takes to pop, given how flooded
   *  the canvas is. Also drives the HUD hint. */
  private clearThreshold(): number {
    let filled = 0;
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] !== P.Empty) filled++;
    this.fill = filled / this.grid.length;
    const t = Math.max(0, Math.min(1, (this.fill - FLOOD_FROM) / (FLOOD_TO - FLOOD_FROM)));
    this.flooding = t > 0.5;
    return CLEAR_SIZE + (CLEAR_SIZE_FLOODED - CLEAR_SIZE) * t;
  }

  // Flood-fill connected same-colour zones (rainbow is a wildcard) and mark
  // big ones for clearing.
  private findZones() {
    const g = this.grid;
    const need = this.clearThreshold();
    const seen = new Uint8Array(g.length);
    const stack: number[] = [];
    const zone: number[] = [];
    let cleared = false;
    let biggest: number[] = [];
    let biggestColor = 0;

    for (let start = 0; start < g.length; start++) {
      const c0 = g[start];
      if (!zoneColor(c0)) continue;
      if (seen[start] || this.clearing[start]) continue;

      zone.length = 0;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        zone.push(i);
        const x = i % COLS;
        if (x > 0) this.tryFill(i - 1, c0, seen, stack);
        if (x < COLS - 1) this.tryFill(i + 1, c0, seen, stack);
        if (i >= COLS) this.tryFill(i - COLS, c0, seen, stack);
        if (i < g.length - COLS) this.tryFill(i + COLS, c0, seen, stack);
      }

      if (zone.length >= need) {
        this.popZone(zone, c0);
        cleared = true;
      } else if (this.fill > DROWNING && zone.length > biggest.length) {
        biggest = zone.slice();
        biggestColor = c0;
      }
    }

    // Nothing could pop on a drowning canvas — shed the largest zone anyway
    // so the board can never lock into an unplayable state.
    if (!cleared && this.fill > DROWNING && biggest.length >= B * B) {
      this.popZone(biggest, biggestColor);
    }
  }

  private popZone(zone: number[], color: number) {
    for (const i of zone) this.clearing[i] = CLEAR_ANIM;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    this.comboFlash = 120;
    this.lastClearSize = zone.length;
    this.score += zone.length * this.combo;
    this.burstSparks(zone[0] % COLS, (zone[0] / COLS) | 0, color, 140);
  }

  private tryFill(j: number, c0: number, seen: Uint8Array, stack: number[]) {
    if (seen[j] || this.clearing[j]) return;
    const c = this.grid[j];
    if (c === c0 || c === P.Rainbow) {
      seen[j] = 1;
      stack.push(j);
    }
  }
}
