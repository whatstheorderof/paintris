// Themes, puzzle levels, and persistent progression (localStorage).

import { P } from "./engine";

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
];

export interface PuzzleDef {
  id: number;
  name: string;
  blurb: string;
  budget: number; // pieces available
  seed: number;
  targets: { color: number; pct: number }[];
}

export const PUZZLES: PuzzleDef[] = [
  {
    id: 1, name: "Purple Rain", blurb: "mix red into blue", budget: 26, seed: 101,
    targets: [{ color: P.Purple, pct: 30 }],
  },
  {
    id: 2, name: "Go Green", blurb: "drown yellow in blue", budget: 26, seed: 202,
    targets: [{ color: P.Green, pct: 40 }],
  },
  {
    id: 3, name: "Blackout", blurb: "keep the dark stuff", budget: 22, seed: 303,
    targets: [{ color: P.Black, pct: 28 }],
  },
  {
    id: 4, name: "Sunset", blurb: "orange sky, red horizon", budget: 30, seed: 404,
    targets: [{ color: P.Orange, pct: 28 }, { color: P.Red, pct: 14 }],
  },
];

export interface SaveData {
  drops: number;
  unlocked: string[];
  theme: string;
  best: Record<string, number>;
  puzzlesDone: number[];
}

const KEY = "paintris-save-v1";

export function defaultSave(): SaveData {
  return { drops: 0, unlocked: ["midnight", "canvas"], theme: "midnight", best: {}, puzzlesDone: [] };
}

export function loadSave(): SaveData {
  const base = defaultSave();
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return { ...base, ...JSON.parse(raw) };
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
