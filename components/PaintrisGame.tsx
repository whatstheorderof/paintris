"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, ROWS, B, FALL_BASE, Engine, P, RGB, COLOR_NAMES, type EngineOpts, type Piece } from "@/lib/engine";
import { createPixiRenderer, type PaintRenderer } from "@/lib/pixiRenderer";
import { Sfx, PACKS, type PackId } from "@/lib/sfx";
import {
  THEMES, PUZZLES, SCORE_TABS, TABLE_SIZE, defaultSave, loadSave, persistSave,
  dailySeed, dailyKey, qualifies, withScore,
  type SaveData, type Theme, type PuzzleDef,
} from "@/lib/meta";

const SCALE = 4; // canvas pixels per grid cell, before device pixel ratio

type Screen = "menu" | "themes" | "puzzles" | "settings" | "scores" | "play" | "name" | "over";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -!";

// One landing, one chain. Each further pop in the same cascade steps up.
const COMBO_NAME = ["SPLASH", "DOUBLE SPLASH", "TRIPLE SPLASH", "PAINTSTORM", "PAINTSTORM"];
type Mode = "classic" | "levels" | "zen" | "rush" | "daily" | "puzzle";
type EndKind = "win" | "lose" | "full" | "end";

interface Setup {
  mode: Mode;
  puzzle?: PuzzleDef;
}

function rainbow(t: number): [number, number, number] {
  const h = (t % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] =
    h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x]
    : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r * 255, g * 255, b * 255];
}

function engineOpts(setup: Setup): EngineOpts {
  switch (setup.mode) {
    case "classic": return { ramp: true };
    case "levels": return { levels: true, baseSpeed: FALL_BASE * 0.85 };
    case "zen": return { zen: true, baseSpeed: FALL_BASE * 0.8 };
    case "rush": return { ramp: true, baseSpeed: FALL_BASE * 2.2 };
    case "daily": return { ramp: true, seed: dailySeed() };
    case "puzzle": {
      const p = setup.puzzle!;
      return { seed: p.seed, budget: p.budget, targets: p.targets, plainPieces: true };
    }
  }
}

const MODE_LABEL: Record<Mode, string> = {
  classic: "CLASSIC", levels: "LEVELS", zen: "ZEN", rush: "RUSH",
  daily: "DAILY", puzzle: "PUZZLE",
};

export default function PaintrisGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLCanvasElement>(null);
  const holdRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sfxRef = useRef<Sfx>(new Sfx());
  const glossRef = useRef<PaintRenderer | null>(null);
  const ctx2dRef = useRef<CanvasRenderingContext2D | null>(null);
  const setupRef = useRef<Setup>({ mode: "classic" });
  const screenRef = useRef<Screen>("menu");

  const [screen, setScreenState] = useState<Screen>("menu");
  // start from defaults so SSR and first client render agree, then hydrate
  // the real save from localStorage after mount
  const [save, setSave] = useState<SaveData>(defaultSave);
  useEffect(() => {
    setSave(loadSave());
  }, []);
  // Persist on change, skipping the pre-hydration render so the defaults
  // never overwrite a real save.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    persistSave(save);
  }, [save]);
  const emptyHud = {
    score: 0, combo: 0, flash: 0,
    piecesLeft: null as number | null,
    flooding: false,
    level: 0, levelPct: 0,
    progress: [] as { color: number; pct: number; target: number }[],
  };
  const [hud, setHud] = useState(emptyHud);
  const [result, setResult] = useState<{ kind: EndKind; score: number; earned: number; best: number }>({
    kind: "end", score: 0, earned: 0, best: 0,
  });
  // arcade-style initials entry, remembered between runs this session
  const [initials, setInitials] = useState(["A", "A", "A"]);
  const [slot, setSlot] = useState(0);
  const [scoreTab, setScoreTab] = useState("classic");
  const pendingKey = useRef<string | null>(null);

  const theme: Theme = THEMES.find((t) => t.id === save.theme) ?? THEMES[0];
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Keep the audio engine in step with the saved pack, and play one sound on
  // change so you hear what you picked.
  const prevPack = useRef<PackId | null>(null);
  useEffect(() => {
    const sfx = sfxRef.current;
    sfx.pack = save.soundPack;
    if (save.soundPack !== "off") {
      sfx.ensure();
      if (prevPack.current !== null) sfx.land();
    }
    sfx.setAmbience(save.soundPack === "zen" && screenRef.current === "play");
    prevPack.current = save.soundPack;
  }, [save.soundPack]);

  const setScreen = (s: Screen) => {
    screenRef.current = s;
    setScreenState(s);
  };

  // Takes an updater so rapid clicks compose instead of overwriting each
  // other with a stale snapshot; the effect above writes it to storage.
  const updateSave = (fn: (prev: SaveData) => SaveData) => setSave(fn);

  // Each mode keeps its own high score; dailies are per-day and each puzzle
  // tracks separately, since they're distinct challenges.
  const bestKey = (setup: Setup) =>
    setup.mode === "daily"
      ? dailyKey()
      : setup.mode === "puzzle" && setup.puzzle
        ? `puzzle-${setup.puzzle.id}`
        : setup.mode;

  const endGame = (kind: EndKind) => {
    if (screenRef.current !== "play") return;
    const e = engineRef.current;
    if (!e) return;
    // Stop the run for good. Without this the engine kept spawning and
    // scoring in the background after you walked away, and the panel counter
    // carried on climbing on the menu.
    e.finish();
    sfxRef.current.setAmbience(false);
    const setup = setupRef.current;
    const puzzleId = setup.puzzle?.id;
    const firstClear = kind === "win" && puzzleId != null && !save.puzzlesDone.includes(puzzleId);
    const earned = Math.floor(e.score / 100) + (firstClear ? 250 : 0);
    const key = bestKey(setup);
    const best = Math.max(save.best[key] ?? 0, e.score);

    updateSave((prev) => ({
      ...prev,
      drops: prev.drops + earned,
      best: { ...prev.best, [key]: Math.max(prev.best[key] ?? 0, e.score) },
      puzzlesDone:
        firstClear && puzzleId != null && !prev.puzzlesDone.includes(puzzleId)
          ? [...prev.puzzlesDone, puzzleId]
          : prev.puzzlesDone,
    }));
    setResult({ kind, score: e.score, earned, best });
    // earned a place on the board? take their initials first, arcade style
    if (qualifies(save, key, e.score)) {
      pendingKey.current = key;
      slotRef.current = 0;
      setSlot(0);
      setScreen("name");
    } else {
      pendingKey.current = null;
      setScreen("over");
    }
  };
  const endGameRef = useRef(endGame);
  endGameRef.current = endGame;

  const startGame = (setup: Setup) => {
    sfxRef.current.ensure();
    setupRef.current = setup;
    const e = new Engine({ ...engineOpts(setup), calm: save.reducedMotion });
    e.onEvent = (ev) => {
      if (ev === "land") sfxRef.current.land();
      if (ev === "boom") sfxRef.current.boom();
      if (ev === "clear") sfxRef.current.clear(3 + e.combo);
      if (ev === "level") sfxRef.current.level();
      if (ev === "win") { sfxRef.current.clear(8); endGameRef.current("win"); }
      if (ev === "over") endGameRef.current(setupRef.current.mode === "puzzle" ? "lose" : "full");
    };
    e.spawn();
    engineRef.current = e;
    if (typeof window !== "undefined") (window as unknown as { __paintris: Engine }).__paintris = e;
    sfxRef.current.setAmbience(save.soundPack === "zen");
    setScreen("play");
  };

  const setPack = (pack: PackId) => updateSave((prev) => ({ ...prev, soundPack: pack }));
  const cyclePack = () => {
    const i = PACKS.findIndex((p) => p.id === save.soundPack);
    setPack(PACKS[(i + 1) % PACKS.length].id);
  };

  // slotRef is the immediate source of truth: consecutive keystrokes land in
  // consecutive slots even if React hasn't re-rendered between them.
  const slotRef = useRef(0);
  const gotoSlot = (i: number) => {
    slotRef.current = Math.max(0, Math.min(2, i));
    setSlot(slotRef.current);
  };

  const bumpLetter = (i: number, dir: 1 | -1) => {
    gotoSlot(i);
    setInitials((prev) => {
      const next = [...prev];
      const at = ALPHABET.indexOf(next[i]);
      next[i] = ALPHABET[(at + dir + ALPHABET.length) % ALPHABET.length];
      return next;
    });
  };

  const typeLetter = (ch: string) => {
    const i = slotRef.current;
    setInitials((prev) => {
      const next = [...prev];
      next[i] = ch;
      return next;
    });
    gotoSlot(i + 1);
  };

  const submitName = () => {
    const key = pendingKey.current;
    pendingKey.current = null;
    if (key) {
      const name = initials.join("").trim() || "AAA";
      const entry = { name, score: result.score, at: Date.now() };
      updateSave((prev) => ({
        ...prev,
        scores: { ...prev.scores, [key]: withScore(prev.scores[key], entry) },
      }));
      setScoreTab(key);
    }
    setScreen("over");
  };
  const submitNameRef = useRef(submitName);
  submitNameRef.current = submitName;

  const buyOrSelectTheme = (t: Theme) => {
    updateSave((prev) => {
      if (prev.unlocked.includes(t.id)) return { ...prev, theme: t.id };
      if (prev.drops < t.cost) return prev;
      return {
        ...prev,
        drops: prev.drops - t.cost,
        unlocked: [...prev.unlocked, t.id],
        theme: t.id,
      };
    });
  };

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pixels = new Uint8ClampedArray(COLS * ROWS * 4);
    let img: ImageData | null = null;

    // Per-cell brightness jitter for paint texture. Keep it subtle — too much
    // and each simulation cell reads as a visible pixel.
    const noise = new Float32Array(COLS * ROWS);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.94 + Math.random() * 0.12;

    let raf = 0;
    let alive = true;

    // PixiJS presentation; plain 2D canvas when WebGL is unavailable
    createPixiRenderer(canvas, COLS, ROWS, SCALE, pixels).then((r) => {
      if (!alive) {
        r?.destroy();
        return;
      }
      if (r) {
        glossRef.current = r;
      } else {
        canvas.width = COLS;
        canvas.height = ROWS;
        canvas.style.imageRendering = "pixelated";
        ctx2dRef.current = canvas.getContext("2d");
        img = ctx2dRef.current ? new ImageData(pixels, COLS, ROWS) : null;
      }
    });

    // The simulation runs on an interval clock, not rAF, so paint keeps
    // flowing when the window is occluded and the browser throttles
    // animation frames. The engine regulates its own 60Hz internally.
    const sim = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      e.step();
      if (e.frame % 10 === 0) {
        setHud({
          score: e.score, combo: e.combo, flash: e.comboFlash,
          piecesLeft: e.piecesLeft, flooding: e.flooding, progress: e.progress,
          level: e.opts.levels ? e.level : 0,
          levelPct: e.opts.levels
            ? Math.max(0, Math.min(100, ((e.score - e.levelFrom) / (e.levelAt - e.levelFrom)) * 100))
            : 0,
        });
      }
    }, 1000 / 60);

    const render = () => {
      if (!alive) return;
      raf = requestAnimationFrame(render);

      const e = engineRef.current;
      const th = themeRef.current;
      const d = pixels;
      const t = performance.now() * 0.15;
      const [bgTop, bgBot] = [th.bgTop, th.bgBot];

      for (let y = 0; y < ROWS; y++) {
        const mix = y / ROWS;
        const br = bgTop[0] + (bgBot[0] - bgTop[0]) * mix;
        const bg = bgTop[1] + (bgBot[1] - bgTop[1]) * mix;
        const bb = bgTop[2] + (bgBot[2] - bgTop[2]) * mix;
        for (let x = 0; x < COLS; x++) {
          const i = y * COLS + x;
          const o = i * 4;
          const c = e ? e.grid[i] : P.Empty;
          if (c === P.Empty) {
            d[o] = br; d[o + 1] = bg; d[o + 2] = bb; d[o + 3] = 0;
            continue;
          }
          let [r, g, b] = c === P.Rainbow ? rainbow(t + x * 4 + y * 4) : RGB[c];
          let n = noise[i];
          // glossy highlight on exposed paint surfaces
          if (y > 0 && e!.grid[i - COLS] === P.Empty) n *= 1.35;
          // special paints get their own shimmer
          if (c === P.Hot) n *= 1 + 0.3 * Math.sin(t * 0.35 + (i % 7));
          else if (c === P.Frozen && noise[i] > 1.06) n = 1.6;
          else if (c === P.Magnetic) n *= 1 + 0.12 * Math.sin(t * 0.2 + i * 0.3);
          else if (c === P.Mirror) n *= 1 + 0.15 * Math.sin(t * 0.25 + x * 0.5);
          if (e!.clearing[i]) {
            const p = Math.sin(t * 0.3 + i) * 0.5 + 0.5;
            r = r + (255 - r) * p; g = g + (255 - g) * p; b = b + (255 - b) * p;
          }
          d[o] = Math.min(255, r * n);
          d[o + 1] = Math.min(255, g * n);
          d[o + 2] = Math.min(255, b * n);
          d[o + 3] = 255;
        }
      }

      // Pixi draws the piece and its preview as crisp geometry; only the 2D
      // fallback bakes them into the low-res grid.
      const bakePiece = !glossRef.current;

      // landing preview: faint outline where the piece would splash down
      if (bakePiece && e?.piece) {
        const p = e.piece;
        const gdy = e.ghostDy();
        if (gdy > B) {
          const [r, g, b] = p.color === P.Rainbow ? rainbow(t) : RGB[p.color];
          for (const [bx, by] of p.blocks) {
            for (let y = 0; y < B; y++) {
              const gy = p.y + by * B + y + gdy;
              if (gy < 0 || gy >= ROWS) continue;
              const ring = y === 0 || y === B - 1;
              for (let x = 0; x < B; x++) {
                if (!ring && x !== 0 && x !== B - 1) continue;
                const gx = p.x + bx * B + x;
                if (gx < 0 || gx >= COLS) continue;
                const o = (gy * COLS + gx) * 4;
                d[o] = d[o] * 0.55 + r * 0.45;
                d[o + 1] = d[o + 1] * 0.55 + g * 0.45;
                d[o + 2] = d[o + 2] * 0.55 + b * 0.45;
              }
            }
          }
        }
      }

      // active piece on top
      if (bakePiece && e?.piece) {
        const p = e.piece;
        const [r, g, b] = p.color === P.Rainbow ? rainbow(t) : RGB[p.color];
        for (const [bx, by] of p.blocks) {
          for (let y = 0; y < B; y++) {
            const gy = p.y + by * B + y;
            if (gy < 0 || gy >= ROWS) continue;
            for (let x = 0; x < B; x++) {
              const gx = p.x + bx * B + x;
              if (gx < 0 || gx >= COLS) continue;
              const o = (gy * COLS + gx) * 4;
              const edge = y === 0 ? 1.3 : y === B - 1 ? 0.8 : 1;
              d[o] = Math.min(255, r * edge);
              d[o + 1] = Math.min(255, g * edge);
              d[o + 2] = Math.min(255, b * edge);
              d[o + 3] = 255;
            }
          }
        }
      }

      // 2D fallback bakes sparks into the grid; Pixi draws them as GPU sprites
      if (e && !glossRef.current) {
        const dark = !th.light;
        for (const s of e.sparks) {
          const x = s.x | 0, y = s.y | 0;
          if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;
          const [r, g, b] = s.color === P.Rainbow ? rainbow(t + s.life * 10) : RGB[s.color];
          const o = (y * COLS + x) * 4;
          d[o] = Math.min(255, dark ? r + 70 : r * 0.85);
          d[o + 1] = Math.min(255, dark ? g + 70 : g * 0.85);
          d[o + 2] = Math.min(255, dark ? b + 70 : b * 0.85);
          d[o + 3] = 255;
        }
      }

      if (glossRef.current) {
        const p = e?.piece;
        glossRef.current.draw(t * 0.05, e ? e.sparks : [], th.light,
          p ? { blocks: p.blocks, x: p.x, y: p.y, color: p.color, ghostDy: e!.ghostDy(), cell: B } : null);
      } else if (ctx2dRef.current && img) {
        // 2D fallback has no mask shader — flatten alpha
        for (let o = 3; o < d.length; o += 4) d[o] = 255;
        ctx2dRef.current.putImageData(img, 0, 0);
      }

      if (e) {
        const drawPreview = (cv: HTMLCanvasElement | null, piece: Piece | null) => {
          if (!cv) return;
          const pctx = cv.getContext("2d")!;
          pctx.clearRect(0, 0, cv.width, cv.height);
          if (!piece) return;
          const [r, g, b] = piece.color === P.Rainbow ? rainbow(t) : RGB[piece.color];
          pctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
          for (const [bx, by] of piece.blocks) pctx.fillRect(4 + bx * 14, 4 + by * 14, 12, 12);
        };
        drawPreview(nextRef.current, e.next);
        drawPreview(holdRef.current, e.held);
      }
    };
    raf = requestAnimationFrame(render);
    return () => {
      alive = false;
      clearInterval(sim);
      cancelAnimationFrame(raf);
      glossRef.current?.destroy();
      glossRef.current = null;
    };
  }, []);

  // input
  useEffect(() => {
    const down = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      if (screen === "menu") {
        if (ev.key === "Enter") startGame({ mode: "classic" });
        return;
      }
      if (screen === "name") {
        if (ev.key === "Enter") { submitNameRef.current(); return; }
        if (ev.key === "ArrowUp") { ev.preventDefault(); bumpLetter(slotRef.current, 1); return; }
        if (ev.key === "ArrowDown") { ev.preventDefault(); bumpLetter(slotRef.current, -1); return; }
        if (ev.key === "ArrowLeft") { gotoSlot(slotRef.current - 1); return; }
        if (ev.key === "ArrowRight") { gotoSlot(slotRef.current + 1); return; }
        if (ev.key === "Backspace") { ev.preventDefault(); gotoSlot(slotRef.current - 1); return; }
        const ch = ev.key.toUpperCase();
        if (ch.length === 1 && ALPHABET.includes(ch)) typeLetter(ch);
        return;
      }
      if (screen === "over") {
        if (ev.key === "Enter") startGame(setupRef.current);
        return;
      }
      if (screen !== "play" || !e) return;
      if (ev.key === "ArrowLeft" || ev.key === "a") e.moveDir = -1;
      else if (ev.key === "ArrowRight" || ev.key === "d") e.moveDir = 1;
      else if ((ev.key === "ArrowUp" || ev.key === "w" || ev.key === "x") && !ev.repeat) e.rotate();
      else if (ev.key === "ArrowDown" || ev.key === "s") e.softDrop = true;
      else if (ev.key === " " && !ev.repeat) { ev.preventDefault(); e.hardDrop(); }
      else if ((ev.key === "c" || ev.key === "C" || ev.key === "Shift") && !ev.repeat) e.hold();
      else if (ev.key === "Escape") endGameRef.current("end");
    };
    const up = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      if (!e) return;
      if (ev.key === "ArrowDown" || ev.key === "s") e.softDrop = false;
      else if ((ev.key === "ArrowLeft" || ev.key === "a") && e.moveDir === -1) e.moveDir = 0;
      else if ((ev.key === "ArrowRight" || ev.key === "d") && e.moveDir === 1) e.moveDir = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const btn = (label: string, fn: () => void, hold?: (on: boolean) => void) => (
    <button
      className="ctl"
      onPointerDown={(ev) => { ev.preventDefault(); hold ? hold(true) : fn(); }}
      onPointerUp={() => hold?.(false)}
      onPointerLeave={() => hold?.(false)}
    >
      {label}
    </button>
  );

  const titleWord = (
    <h1 className="title">
      {"PAINTRIS".split("").map((ch, i) => (
        <span key={i} className="drip" style={{ animationDelay: `${i * 0.12}s` }}>{ch}</span>
      ))}
    </h1>
  );

  const overTitle: Record<EndKind, string> = {
    win: "MASTERPIECE", lose: "OUT OF PAINT", full: "CANVAS FULL", end: "BRUSHES DOWN",
  };

  const playing = screen === "play";
  const setup = setupRef.current;

  return (
    <div
      className={`wrap${theme.light ? " light" : ""}`}
      style={{ background: theme.page, color: theme.ink }}
    >
      <div className="board" style={{ borderColor: theme.border, boxShadow: `0 0 60px ${theme.glow}` }}>
        {/* CSS drives the display size; the canvas backing store is far
            larger so the board stays sharp as it scales up */}
        <canvas ref={canvasRef} style={{ aspectRatio: `${COLS} / ${ROWS}` }} />

        {playing && hud.flooding && (
          <div className="flooding">PAINT RUNNING · zones pop sooner</div>
        )}

        {playing && hud.flash > 0 && hud.combo > 0 && (
          <div className="combo" key={hud.combo}>
            {COMBO_NAME[Math.min(hud.combo, COMBO_NAME.length) - 1]}
            {hud.combo > 1 && <span> x{hud.combo}</span>}
          </div>
        )}

        {screen === "menu" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            {titleWord}
            <p className="tag">blocks made of wet paint</p>
            <div className="menu-modes">
              {([
                ["classic", "CLASSIC", "endless · speeds up", "classic"],
                ["levels", "LEVELS", "climb the ranks", "levels"],
                ["zen", "ZEN", "no losing · just paint", "zen"],
                ["rush", "RUSH", "twice the pour", "rush"],
                ["daily", "DAILY", "same paint for everyone", dailyKey()],
              ] as [Mode, string, string, string][]).map(([mode, label, blurb, key]) => (
                <button key={mode} className="mode-btn" onClick={() => startGame({ mode })}>
                  {label}
                  <small>{blurb}</small>
                  <em className="best">
                    {save.best[key] ? `★ best ${save.best[key]}` : "no score yet"}
                  </em>
                </button>
              ))}
              <button className="mode-btn" onClick={() => setScreen("puzzles")}>
                PUZZLE<small>paint to order</small>
                <em className="best">
                  {save.puzzlesDone.length}/{PUZZLES.length} solved
                </em>
              </button>
            </div>
            <div className="menu-secondary">
              <button className="side-btn wide" onClick={() => setScreen("scores")}>
                🏆 HIGH SCORES<small>every mode&apos;s hall of fame</small>
              </button>
              <button className="side-btn" onClick={() => setScreen("themes")}>
                🎨 CANVAS<small>change background</small>
              </button>
              <button className="side-btn" onClick={() => setScreen("settings")}>
                ⚙ SETTINGS<small>{PACKS.find((p) => p.id === save.soundPack)?.name.toLowerCase()}</small>
              </button>
            </div>
            <a className="credit" href="https://zaney.dev" target="_blank" rel="noopener noreferrer">
              a game by zaney.dev
            </a>
          </div>
        )}

        {screen === "puzzles" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            <h1 className="title small">PUZZLES</h1>
            <div className="menu-modes">
              {PUZZLES.map((p) => (
                <button key={p.id} className="mode-btn" onClick={() => startGame({ mode: "puzzle", puzzle: p })}>
                  {save.puzzlesDone.includes(p.id) ? "✓ " : ""}{p.name.toUpperCase()}
                  <small>
                    {p.targets.map((tg) => `${tg.pct}% ${COLOR_NAMES[tg.color]}`).join(" + ")} · {p.budget} pieces
                  </small>
                  <em className="best">
                    {save.best[`puzzle-${p.id}`] ? `★ best ${save.best[`puzzle-${p.id}`]}` : "not solved yet"}
                  </em>
                </button>
              ))}
            </div>
            <button className="play ghost" onClick={() => setScreen("menu")}>BACK</button>
          </div>
        )}

        {screen === "themes" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            <h1 className="title small">CANVAS</h1>
            <p className="tag">the surface you paint on — light or dark</p>
            <p className="tag drops-line">🎨 {save.drops} paint drops earned</p>
            <div className="swatches">
              {THEMES.map((t) => {
                const owned = save.unlocked.includes(t.id);
                const selected = save.theme === t.id;
                const affordable = save.drops >= t.cost;
                return (
                  <button
                    key={t.id}
                    className={`swatch${selected ? " selected" : ""}${!owned && !affordable ? " locked" : ""}`}
                    onClick={() => buyOrSelectTheme(t)}
                    title={owned ? `Paint on ${t.name}` : `Unlock ${t.name} for ${t.cost} drops`}
                  >
                    <span
                      className="chip"
                      style={{
                        background: `linear-gradient(180deg, rgb(${t.bgTop.join(",")}), rgb(${t.bgBot.join(",")}))`,
                        borderColor: t.border,
                      }}
                    >
                      {/* sample paint so you can see how colours sit on it */}
                      <i style={{ background: "#e5344a" }} />
                      <i style={{ background: "#2f7fe8" }} />
                      <i style={{ background: "#f7c948" }} />
                    </span>
                    <span className="swatch-text">
                      <span className="swatch-name">{t.name}</span>
                      <span className={`swatch-status${selected ? " on" : ""}${!owned && affordable ? " cost" : ""}`}>
                        {selected
                          ? "✓ IN USE"
                          : owned
                            ? "TAP TO USE"
                            : affordable
                              ? `BUY · ${t.cost} DROPS`
                              : `🔒 ${t.cost} DROPS`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button className="play ghost" onClick={() => setScreen("menu")}>BACK</button>
          </div>
        )}

        {screen === "settings" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            <h1 className="title small">SETTINGS</h1>
            <div className="settings-list">
              <div className="setting-block">
                <span className="setting-name">🔊 Sound</span>
                <div className="pack-list">
                  {PACKS.map((p) => (
                    <button
                      key={p.id}
                      className={`pack${save.soundPack === p.id ? " on" : ""}`}
                      onClick={() => setPack(p.id)}
                    >
                      <span className="pack-name">{p.name}</span>
                      <small>{p.blurb}</small>
                    </button>
                  ))}
                </div>
              </div>
              <button
                className={`setting-row${save.reducedMotion ? " on" : ""}`}
                onClick={() => updateSave((prev) => ({ ...prev, reducedMotion: !prev.reducedMotion }))}
              >
                <span className="setting-text">
                  <span className="setting-name">🍃 Calm motion</span>
                  <small>gentler splashes, fewer sparks</small>
                </span>
                <span className="toggle" aria-hidden>
                  <span className="knob" />
                </span>
              </button>
              <button className="setting-row" onClick={() => setScreen("themes")}>
                <span className="setting-text">
                  <span className="setting-name">🎨 Canvas</span>
                  <small>currently {theme.name}</small>
                </span>
                <span className="setting-go">›</span>
              </button>
            </div>
            <button className="play ghost" onClick={() => setScreen("menu")}>BACK</button>
          </div>
        )}

        {screen === "scores" && (() => {
          const puzzleTabs = PUZZLES.map((p) => ({ key: `puzzle-${p.id}`, label: p.name.toUpperCase() }));
          const tabs = [...SCORE_TABS, ...puzzleTabs];
          const activeKey = scoreTab === "daily" ? dailyKey() : scoreTab;
          const rows = save.scores[activeKey] ?? [];
          return (
            <div className="overlay" style={{ background: theme.overlay }}>
              <h1 className="title small">HIGH SCORES</h1>
              <div className="tabs">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    className={`tab${scoreTab === t.key ? " on" : ""}`}
                    onClick={() => setScoreTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <ol className="scoretable">
                {Array.from({ length: TABLE_SIZE }).map((_, i) => {
                  const row = rows[i];
                  return (
                    <li key={i} className={row ? "" : "blank"}>
                      <span className="rank">{i + 1}</span>
                      <span className="who">{row ? row.name : "---"}</span>
                      <span className="pts">{row ? row.score.toLocaleString() : "—"}</span>
                    </li>
                  );
                })}
              </ol>
              {scoreTab === "daily" && <p className="tag small-tag">today&apos;s board · resets daily</p>}
              <button className="play ghost" onClick={() => setScreen("menu")}>BACK</button>
            </div>
          );
        })()}

        {screen === "name" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            <h1 className="title small">NEW HIGH SCORE</h1>
            <p className="tag">{result.score.toLocaleString()} points · enter your initials</p>
            <div className="initials">
              {initials.map((ch, i) => (
                <div key={i} className={`slotwrap${slot === i ? " on" : ""}`}>
                  <button className="arrow" onClick={() => bumpLetter(i, 1)} aria-label="previous letter">▲</button>
                  <button className="letter" onClick={() => gotoSlot(i)}>{ch === " " ? "_" : ch}</button>
                  <button className="arrow" onClick={() => bumpLetter(i, -1)} aria-label="next letter">▼</button>
                </div>
              ))}
            </div>
            <p className="tag small-tag">type, or use ↑ ↓ ← → · enter to confirm</p>
            <button className="play" onClick={submitName}>SUBMIT</button>
          </div>
        )}

        {screen === "over" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            <h1 className="title small">{overTitle[result.kind]}</h1>
            <p className="tag">score {result.score} · best {result.best}</p>
            <p className="tag">+{result.earned} paint drops</p>
            <button className="play" onClick={() => startGame(setupRef.current)}>
              {result.kind === "win" ? "PAINT MORE" : "PAINT AGAIN"}
            </button>
            <div className="over-links">
              <button className="play ghost" onClick={() => {
                setScoreTab(setup.mode === "puzzle" && setup.puzzle ? `puzzle-${setup.puzzle.id}` : setup.mode);
                setScreen("scores");
              }}>
                🏆 SCORES
              </button>
              <button className="play ghost" onClick={() => { engineRef.current = null; setHud(emptyHud); setScreen("menu"); }}>MENU</button>
            </div>
            <a className="credit" href="https://zaney.dev" target="_blank" rel="noopener noreferrer">
              a game by zaney.dev
            </a>
          </div>
        )}
      </div>

      <aside className="panel">
        <div className="stat">
          <label>{playing || screen === "over" ? MODE_LABEL[setup.mode] : "SCORE"}</label>
          <div className="val">{hud.score}</div>
        </div>
        <div className="previews">
          <div className="stat">
            <label>NEXT</label>
            <canvas ref={nextRef} width={64} height={40} />
          </div>
          <div className="stat">
            <label>HOLD</label>
            <canvas ref={holdRef} width={64} height={40} />
          </div>
        </div>
        {hud.level > 0 && (playing || screen === "over") && (
          <div className="stat">
            <label>LEVEL {hud.level}</label>
            <div className="bar">
              <span style={{ width: `${hud.levelPct}%`, background: "currentColor" }} />
            </div>
          </div>
        )}
        {hud.piecesLeft != null && playing && (
          <div className="stat">
            <label>PIECES LEFT</label>
            <div className="val">{hud.piecesLeft}</div>
          </div>
        )}
        {hud.progress.length > 0 && playing && (
          <div className="targets">
            {hud.progress.map((p) => (
              <div key={p.color} className="target">
                <label>{COLOR_NAMES[p.color]} {Math.floor(p.pct)}/{p.target}%</label>
                <div className="bar">
                  <span
                    style={{
                      width: `${Math.min(100, (p.pct / p.target) * 100)}%`,
                      background: `rgb(${RGB[p.color].join(",")})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="box">
          <h3 className="box-title">CONTROLS</h3>
          <ul className="keylist">
            <li><span className="keys"><kbd>←</kbd><kbd>→</kbd></span> move</li>
            <li><span className="keys"><kbd>↑</kbd></span> rotate</li>
            <li><span className="keys"><kbd>↓</kbd></span> soft drop</li>
            <li><span className="keys"><kbd>space</kbd></span> slam down</li>
            <li><span className="keys"><kbd>C</kbd></span> hold piece</li>
            <li><span className="keys"><kbd>esc</kbd></span> end session</li>
          </ul>
        </div>

        <div className="box">
          <h3 className="box-title">HOW TO SCORE</h3>
          <p className="box-line">
            Big connected areas of one colour pop. If that pop makes another,
            the chain counts: 2 is a double, 4+ is a <b>PAINTSTORM</b>, and the
            chain number multiplies the points. One landing, one chain.
          </p>
          <ul className="recipes">
            <li><i style={{ background: "#e5344a" }} />+<i style={{ background: "#2f7fe8" }} />=<i style={{ background: "#9b4fd6" }} /> purple</li>
            <li><i style={{ background: "#2f7fe8" }} />+<i style={{ background: "#f7c948" }} />=<i style={{ background: "#3ec96e" }} /> green</li>
            <li><i style={{ background: "#e5344a" }} />+<i style={{ background: "#f7c948" }} />=<i style={{ background: "#f77f3a" }} /> orange</li>
          </ul>
        </div>
        {/* movement on its own row, drop and hold below — easier to thumb */}
        <div className="touch">
          <div className="touch-row">
            {btn("←", () => {}, (on) => { if (engineRef.current) engineRef.current.moveDir = on ? -1 : 0; })}
            {btn("⟳", () => engineRef.current?.rotate())}
            {btn("→", () => {}, (on) => { if (engineRef.current) engineRef.current.moveDir = on ? 1 : 0; })}
          </div>
          <div className="touch-row">
            {btn("▼", () => {}, (on) => { if (engineRef.current) engineRef.current.softDrop = on; })}
            {btn("⤓", () => engineRef.current?.hardDrop())}
            {btn("⇄", () => engineRef.current?.hold())}
          </div>
        </div>
        <div className="panel-actions">
          <button className="endbtn" onClick={cyclePack} title="Change sound pack">
            {save.soundPack === "off" ? "🔇" : save.soundPack === "zen" ? "🎐" : "🔊"}{" "}
            {PACKS.find((p) => p.id === save.soundPack)?.name.toLowerCase()}
          </button>
          {playing && (
            <button className="endbtn" onClick={() => endGameRef.current("end")}>■ end session</button>
          )}
        </div>
      </aside>
    </div>
  );
}
