"use client";

import { useEffect, useRef, useState } from "react";
import { COLS, ROWS, B, Engine, P, RGB, COLOR_NAMES, type EngineOpts, type Piece } from "@/lib/engine";
import { createPixiRenderer, type PaintRenderer } from "@/lib/pixiRenderer";
import {
  THEMES, PUZZLES, defaultSave, loadSave, persistSave, dailySeed, dailyKey,
  type SaveData, type Theme, type PuzzleDef,
} from "@/lib/meta";

const SCALE = 4; // canvas pixels per grid cell, before device pixel ratio
const DISPLAY_W = 384; // css size of the board — the canvas renders above this
const DISPLAY_H = 576;

type Screen = "menu" | "themes" | "puzzles" | "settings" | "play" | "over";
type Mode = "classic" | "zen" | "rush" | "daily" | "puzzle";
type EndKind = "win" | "lose" | "full" | "end";

interface Setup {
  mode: Mode;
  puzzle?: PuzzleDef;
}

// Cheap synth splashes; created lazily on first user gesture.
class Sfx {
  ctx: AudioContext | null = null;
  muted = false;
  ensure() {
    if (this.muted) return;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
  }
  private noise(dur: number, freq: number, gain: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
  }
  land() { this.noise(0.15, 900, 0.25); }
  boom() { this.noise(0.5, 250, 0.5); }
  chime(steps: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    for (let k = 0; k < steps; k++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 400 * Math.pow(1.25, k);
      g.gain.setValueAtTime(0.12, ctx.currentTime + k * 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + k * 0.07 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + k * 0.07);
      o.stop(ctx.currentTime + k * 0.07 + 0.35);
    }
  }
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
    case "zen": return { zen: true, baseSpeed: 1.08 };
    case "rush": return { ramp: true, baseSpeed: 2.97 };
    case "daily": return { ramp: true, seed: dailySeed() };
    case "puzzle": {
      const p = setup.puzzle!;
      return { seed: p.seed, budget: p.budget, targets: p.targets, plainPieces: true };
    }
  }
}

const MODE_LABEL: Record<Mode, string> = {
  classic: "CLASSIC", zen: "ZEN", rush: "RUSH", daily: "DAILY", puzzle: "PUZZLE",
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
  const [hud, setHud] = useState({
    score: 0, combo: 0, flash: 0,
    piecesLeft: null as number | null,
    progress: [] as { color: number; pct: number; target: number }[],
  });
  const [result, setResult] = useState<{ kind: EndKind; score: number; earned: number; best: number }>({
    kind: "end", score: 0, earned: 0, best: 0,
  });

  const theme: Theme = THEMES.find((t) => t.id === save.theme) ?? THEMES[0];
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Keep the audio engine in step with the saved preference, and play one
  // splash when it's switched back on so you hear what you enabled.
  const prevSound = useRef<boolean | null>(null);
  useEffect(() => {
    sfxRef.current.muted = !save.sound;
    if (prevSound.current === false && save.sound) {
      sfxRef.current.ensure();
      sfxRef.current.land();
    }
    prevSound.current = save.sound;
  }, [save.sound]);

  const setScreen = (s: Screen) => {
    screenRef.current = s;
    setScreenState(s);
  };

  // Takes an updater so rapid clicks compose instead of overwriting each
  // other with a stale snapshot; the effect above writes it to storage.
  const updateSave = (fn: (prev: SaveData) => SaveData) => setSave(fn);

  const bestKey = (setup: Setup) =>
    setup.mode === "daily" ? dailyKey() : setup.mode;

  const endGame = (kind: EndKind) => {
    if (screenRef.current !== "play") return;
    const e = engineRef.current;
    if (!e) return;
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
    setScreen("over");
  };
  const endGameRef = useRef(endGame);
  endGameRef.current = endGame;

  const startGame = (setup: Setup) => {
    sfxRef.current.ensure();
    setupRef.current = setup;
    const e = new Engine(engineOpts(setup));
    e.onEvent = (ev) => {
      if (ev === "land") sfxRef.current.land();
      if (ev === "boom") sfxRef.current.boom();
      if (ev === "clear") sfxRef.current.chime(3 + e.combo);
      if (ev === "win") { sfxRef.current.chime(8); endGameRef.current("win"); }
      if (ev === "over") endGameRef.current(setupRef.current.mode === "puzzle" ? "lose" : "full");
    };
    e.spawn();
    engineRef.current = e;
    if (typeof window !== "undefined") (window as unknown as { __paintris: Engine }).__paintris = e;
    setScreen("play");
  };

  const toggleSound = () => updateSave((prev) => ({ ...prev, sound: !prev.sound }));

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

    // per-cell brightness jitter for paint texture
    const noise = new Float32Array(COLS * ROWS);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.88 + Math.random() * 0.24;

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
          piecesLeft: e.piecesLeft, progress: e.progress,
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
        <canvas ref={canvasRef} style={{ width: DISPLAY_W, height: DISPLAY_H }} />

        {playing && hud.flash > 0 && hud.combo > 0 && (
          <div className="combo" key={hud.combo}>
            {hud.combo >= 4 ? "PAINTSTORM" : "SPLASH"}
            {hud.combo > 1 && <span> x{hud.combo}</span>}
          </div>
        )}

        {screen === "menu" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            {titleWord}
            <p className="tag">blocks made of wet paint</p>
            <div className="menu-modes">
              <button className="mode-btn" onClick={() => startGame({ mode: "classic" })}>
                CLASSIC<small>endless · speeds up</small>
              </button>
              <button className="mode-btn" onClick={() => startGame({ mode: "zen" })}>
                ZEN<small>no losing · just paint</small>
              </button>
              <button className="mode-btn" onClick={() => startGame({ mode: "rush" })}>
                RUSH<small>twice the pour</small>
              </button>
              <button className="mode-btn" onClick={() => startGame({ mode: "daily" })}>
                DAILY<small>same paint for everyone</small>
              </button>
              <button className="mode-btn" onClick={() => setScreen("puzzles")}>
                PUZZLE<small>paint to order</small>
              </button>
            </div>
            <div className="menu-secondary">
              <button className="side-btn" onClick={() => setScreen("themes")}>
                🎨 CANVAS<small>change background</small>
              </button>
              <button className="side-btn" onClick={() => setScreen("settings")}>
                ⚙ SETTINGS<small>sound {save.sound ? "on" : "off"}</small>
              </button>
            </div>
            {(save.best.classic ?? 0) > 0 && <p className="tag small-tag">best {save.best.classic}</p>}
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
              <button className={`setting-row${save.sound ? " on" : ""}`} onClick={toggleSound}>
                <span className="setting-text">
                  <span className="setting-name">{save.sound ? "🔊" : "🔇"} Sound</span>
                  <small>splashes, booms and combo chimes</small>
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

        {screen === "over" && (
          <div className="overlay" style={{ background: theme.overlay }}>
            <h1 className="title small">{overTitle[result.kind]}</h1>
            <p className="tag">score {result.score} · best {result.best}</p>
            <p className="tag">+{result.earned} paint drops</p>
            <button className="play" onClick={() => startGame(setupRef.current)}>
              {result.kind === "win" ? "PAINT MORE" : "PAINT AGAIN"}
            </button>
            <button className="play ghost" onClick={() => setScreen("menu")}>MENU</button>
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
          <p className="box-line">Big connected areas of one colour pop.</p>
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
          <button className="endbtn" onClick={toggleSound} title="Toggle sound">
            {save.sound ? "🔊 sound on" : "🔇 sound off"}
          </button>
          {playing && (
            <button className="endbtn" onClick={() => endGameRef.current("end")}>■ end session</button>
          )}
        </div>
      </aside>
    </div>
  );
}
