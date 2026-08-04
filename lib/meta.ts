// Themes, puzzle levels, and persistent progression (localStorage).

import { P } from "./engine";
import type { PackId, AmbienceId } from "./sfx";

export interface Theme {
  id: string;
  name: string;
  cost: number; // drops; 0 = free
  light: boolean;
  page: string; // page background
  ink: string; // text colour
  overlay: string; // menu/overlay backdrop
  border: string; // board frame
  glow: string; // board glow shadow
  bgTop: [number, number, number]; // canvas gradient inside the board
  bgBot: [number, number, number];
}

export const THEMES: Theme[] = [
  {
    id: "midnight", name: "Midnight Studio", cost: 0, light: false,
    page: "#0b0a12", ink: "#f2eef8", overlay: "rgba(10,8,18,0.84)",
    border: "#2c2840", glow: "rgba(120,60,220,0.25)",
    bgTop: [24, 22, 34], bgBot: [14, 13, 22],
  },
  {
    id: "canvas", name: "White Canvas", cost: 0, light: true,
    page: "#eceae4", ink: "#2a2733", overlay: "rgba(250,249,246,0.88)",
    border: "#d5d1c8", glow: "rgba(90,70,50,0.14)",
    bgTop: [251, 250, 247], bgBot: [238, 235, 227],
  },
  {
    id: "cream", name: "Cream Linen", cost: 200, light: true,
    page: "#efe6d2", ink: "#3b3226", overlay: "rgba(248,242,228,0.88)",
    border: "#dccfae", glow: "rgba(160,120,60,0.16)",
    bgTop: [250, 244, 230], bgBot: [239, 227, 201],
  },
  {
    id: "paper", name: "Watercolour Paper", cost: 300, light: true,
    page: "#e6e9e6", ink: "#2f3a36", overlay: "rgba(244,247,244,0.88)",
    border: "#c9d2cc", glow: "rgba(80,140,120,0.16)",
    bgTop: [247, 249, 246], bgBot: [231, 237, 232],
  },
  {
    id: "candy", name: "Candy Shop", cost: 350, light: true,
    page: "#f6dfe9", ink: "#4a2438", overlay: "rgba(252,235,243,0.88)",
    border: "#eab8cf", glow: "rgba(240,110,170,0.28)",
    bgTop: [253, 238, 245], bgBot: [246, 217, 231],
  },
  {
    id: "concrete", name: "Graffiti Wall", cost: 400, light: false,
    page: "#3a3a3e", ink: "#eceff2", overlay: "rgba(40,40,44,0.86)",
    border: "#55555a", glow: "rgba(240,240,255,0.12)",
    bgTop: [96, 96, 102], bgBot: [68, 68, 74],
  },
  {
    id: "space", name: "Deep Space", cost: 500, light: false,
    page: "#06040f", ink: "#e8e6ff", overlay: "rgba(8,5,20,0.84)",
    border: "#241d4a", glow: "rgba(90,120,255,0.3)",
    bgTop: [18, 14, 44], bgBot: [7, 5, 18],
  },
  {
    id: "sand", name: "Desert Sand", cost: 250, light: true,
    page: "#efe3cf", ink: "#4a3a26", overlay: "rgba(249,240,225,0.88)",
    border: "#dcc9a6", glow: "rgba(190,140,70,0.18)",
    bgTop: [250, 241, 224], bgBot: [238, 224, 196],
  },
  {
    id: "lavender", name: "Lavender Wash", cost: 300, light: true,
    page: "#e9e4f3", ink: "#3a3050", overlay: "rgba(245,242,252,0.88)",
    border: "#cfc6e4", glow: "rgba(130,100,210,0.2)",
    bgTop: [247, 244, 253], bgBot: [232, 226, 245],
  },
  {
    id: "mint", name: "Sea Glass", cost: 350, light: true,
    page: "#dfeeea", ink: "#25423c", overlay: "rgba(240,250,247,0.88)",
    border: "#bcd9d1", glow: "rgba(60,170,150,0.2)",
    bgTop: [242, 251, 248], bgBot: [223, 240, 234],
  },
  {
    id: "forest", name: "Forest Floor", cost: 450, light: false,
    page: "#0e1a13", ink: "#dcecdf", overlay: "rgba(12,24,17,0.86)",
    border: "#1f3a2a", glow: "rgba(60,200,120,0.22)",
    bgTop: [24, 44, 32], bgBot: [10, 20, 14],
  },
  {
    id: "ocean", name: "Deep Ocean", cost: 500, light: false,
    page: "#04141c", ink: "#d8eef5", overlay: "rgba(4,20,28,0.86)",
    border: "#12384a", glow: "rgba(40,170,220,0.26)",
    bgTop: [12, 46, 62], bgBot: [4, 16, 24],
  },
  {
    id: "ember", name: "Ember", cost: 600, light: false,
    page: "#1a0c08", ink: "#ffe2d2", overlay: "rgba(26,12,8,0.86)",
    border: "#4a2016", glow: "rgba(255,110,50,0.28)",
    bgTop: [56, 24, 16], bgBot: [18, 8, 6],
  },
];

export interface PuzzleDef {
  id: number;
  name: string;
  blurb: string;
  budget: number; // pieces available
  seed: number;
  targets: { color: number; pct: number }[];
  /** Colours the pieces are drawn from. A puzzle has to actually supply what
   *  it asks for — drawing evenly from all six made the goals unreachable. */
  palette: number[];
}

export const PUZZLES: PuzzleDef[] = [
  // Targets are set from measured play: reachable when you interleave the
  // colours well, missable when you dump them in separate heaps.
  {
    id: 1, name: "Purple Rain", blurb: "interleave red and blue", budget: 26, seed: 101,
    palette: [P.Red, P.Blue],
    targets: [{ color: P.Purple, pct: 25 }],
  },
  {
    id: 2, name: "Go Green", blurb: "stir yellow through blue", budget: 26, seed: 202,
    palette: [P.Blue, P.Yellow],
    targets: [{ color: P.Green, pct: 32 }],
  },
  {
    id: 3, name: "Blackout", blurb: "keep the dark stuff", budget: 22, seed: 303,
    palette: [P.Black, P.Black, P.Blue, P.Red],
    targets: [{ color: P.Black, pct: 48 }],
  },
  {
    id: 4, name: "Sunset", blurb: "orange sky, red horizon", budget: 30, seed: 404,
    palette: [P.Red, P.Red, P.Yellow],
    targets: [{ color: P.Orange, pct: 20 }, { color: P.Red, pct: 30 }],
  },
];

export interface ScoreEntry {
  name: string;
  score: number;
  at: number; // epoch ms
}

export interface SaveData {
  drops: number;
  unlocked: string[];
  theme: string;
  best: Record<string, number>;
  /** Top scores per mode key, highest first. */
  scores: Record<string, ScoreEntry[]>;
  puzzlesDone: number[];
  sound: boolean; // kept so older saves still round-trip
  soundPack: PackId;
  ambience: AmbienceId; // background bed, independent of the pack
  reducedMotion: boolean; // calmer splashes and sparks
}

export const TABLE_SIZE = 5; // entries kept per mode

/** Would this score earn a place on the board for that mode? */
export function qualifies(save: SaveData, key: string, score: number): boolean {
  if (score <= 0) return false;
  const list = save.scores[key] ?? [];
  return list.length < TABLE_SIZE || score > list[list.length - 1].score;
}

/** Returns a new table with the entry inserted, trimmed to TABLE_SIZE. */
export function withScore(
  list: ScoreEntry[] | undefined,
  entry: ScoreEntry
): ScoreEntry[] {
  return [...(list ?? []), entry]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, TABLE_SIZE);
}

/** Modes shown on the high score board, in order. */
export const SCORE_TABS: { key: string; label: string }[] = [
  { key: "classic", label: "CLASSIC" },
  { key: "levels", label: "LEVELS" },
  { key: "rush", label: "RUSH" },
  { key: "zen", label: "ZEN" },
  { key: "daily", label: "DAILY" },
];

const KEY = "paintris-save-v1";

export function defaultSave(): SaveData {
  return {
    drops: 0,
    unlocked: ["midnight", "canvas"],
    theme: "midnight",
    best: {},
    scores: {},
    puzzlesDone: [],
    sound: true,
    // Default to the calm pairing — that's the mood the game is going for.
    soundPack: "zen",
    ambience: "night",
    reducedMotion: false,
  };
}

export function loadSave(): SaveData {
  const base = defaultSave();
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const save: SaveData = { ...base, ...JSON.parse(raw) };
    // saves from before sound packs only had an on/off flag
    // Saves predating packs only had an on/off flag; carry that intent over.
    if (!save.soundPack) save.soundPack = save.sound === false ? "off" : "zen";
    if (!save.ambience) save.ambience = "night";
    // Saves from before the score board only kept a single number per mode;
    // seed the table from those so old bests still show up.
    for (const [key, score] of Object.entries(save.best ?? {})) {
      if (score > 0 && !(save.scores[key]?.length)) {
        save.scores[key] = [{ name: "YOU", score, at: 0 }];
      }
    }
    return save;
  } catch {
    return base;
  }
}

export function persistSave(s: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode) — progression just won't persist
  }
}

export function dailySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function dailyKey(): string {
  const d = new Date();
  return `daily-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
