/** A board as saved on disk: plain text, with freehand strokes drawn over it. */

import { PALETTE_SIZE } from './palette.ts';
import { DEFAULT_UI } from './ui-settings.ts';

export interface Stroke {
  /** Palette slot; 0 is the theme's main color. */
  color: number;
  /** Pen width in CSS pixels. */
  size: number;
  /** Flat list of x, y, pressure triples, in board coordinates. */
  points: number[];
  /** True when the pressure values come from a real pen. */
  pressure: boolean;
}

export interface Board {
  text: string;
  strokes: Stroke[];
}

/** Version of the saved format, written into every file. */
const BOARD_FORMAT = 1;
const PEN_SIZE_MIN = 1;
const PEN_SIZE_MAX = 48;

export function emptyBoard(): Board {
  return { text: '', strokes: [] };
}

/** Reads a saved board, keeping what is valid and dropping the rest. Null when
 *  the JSON is not a board, or comes from a newer version of the app: such a
 *  file is better left alone than read wrong. */
export function parseBoard(json: string | null | undefined): Board | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (typeof raw.format === 'number' && raw.format > BOARD_FORMAT) return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const strokes: Stroke[] = [];
  if (Array.isArray(raw.strokes)) {
    for (const item of raw.strokes) {
      const stroke = parseStroke(item);
      if (stroke) strokes.push(stroke);
    }
  }
  return { text, strokes };
}

function parseStroke(raw: unknown): Stroke | null {
  if (!isRecord(raw) || !Array.isArray(raw.p)) return null;
  const points: number[] = [];
  for (const value of raw.p) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    points.push(value);
  }
  const usable = points.length - (points.length % 3);
  if (usable < 3) return null;
  const color = typeof raw.c === 'number' && Number.isInteger(raw.c) ? clamp(raw.c, 0, PALETTE_SIZE - 1) : 0;
  const size =
    typeof raw.s === 'number' && Number.isFinite(raw.s) ? clamp(raw.s, PEN_SIZE_MIN, PEN_SIZE_MAX) : DEFAULT_UI.penSize;
  return { color, size, points: points.slice(0, usable), pressure: raw.pr === 1 };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify({
    format: BOARD_FORMAT,
    text: board.text,
    strokes: board.strokes.map((stroke) => {
      const saved: Record<string, unknown> = { c: stroke.color, s: stroke.size, p: roundPoints(stroke.points) };
      if (stroke.pressure) saved.pr = 1;
      return saved;
    }),
  });
}

/** One decimal for coordinates and two for pressure: smaller files, no visible change. */
export function roundPoints(points: readonly number[]): number[] {
  return points.map((value, index) => (index % 3 === 2 ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
