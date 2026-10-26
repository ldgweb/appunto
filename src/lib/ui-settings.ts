/** Look and feel of the board. Stored by the native side as an opaque object. */

import { isFontId, isThemeId, PALETTE_SIZE, type ThemeId } from './palette.ts';

export interface UiSettings {
  font: string;
  fontSize: number;
  /** Palette slot for the text. */
  textColor: number;
  theme: ThemeId;
  /** Palette slot for new strokes. */
  penColor: number;
  penSize: number;
  spellcheck: boolean;
  /** Esc hides the board. */
  escHides: boolean;
}

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 72;
export const FONT_SIZE_DEFAULT = 22;
/** What one press of the larger or smaller key changes. */
export const FONT_SIZE_STEP = 2;
/** Thin, medium and thick chalk, in CSS pixels. */
export const PEN_SIZES = [3, 5, 10] as const;

export const DEFAULT_UI: UiSettings = {
  font: 'hand',
  fontSize: FONT_SIZE_DEFAULT,
  textColor: 0,
  theme: 'black',
  penColor: 0,
  penSize: 5,
  spellcheck: false,
  escHides: true,
};

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
}

/** Accepts whatever was stored and returns complete, valid settings. */
export function normalizeUi(raw: unknown): UiSettings {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const slot = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE ? v : fallback;
  return {
    font: isFontId(value.font) ? value.font : DEFAULT_UI.font,
    fontSize: typeof value.fontSize === 'number' ? clampFontSize(value.fontSize) : DEFAULT_UI.fontSize,
    textColor: slot(value.textColor, DEFAULT_UI.textColor),
    theme: isThemeId(value.theme) ? value.theme : DEFAULT_UI.theme,
    penColor: slot(value.penColor, DEFAULT_UI.penColor),
    penSize: PEN_SIZES.includes(value.penSize as (typeof PEN_SIZES)[number])
      ? (value.penSize as number)
      : DEFAULT_UI.penSize,
    spellcheck: typeof value.spellcheck === 'boolean' ? value.spellcheck : DEFAULT_UI.spellcheck,
    escHides: typeof value.escHides === 'boolean' ? value.escHides : DEFAULT_UI.escHides,
  };
}
