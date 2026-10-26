/** Backgrounds, chalk colors and fonts. Colors are stored as palette slots, so
 *  switching between a dark board and a white one keeps everything readable. */

export type ThemeId = 'black' | 'slate' | 'green' | 'white';

/** Six colors; slot 0 is the main chalk (or marker) color. */
export type Palette = readonly [string, string, string, string, string, string];

export interface Theme {
  id: ThemeId;
  background: string;
  dark: boolean;
  palette: Palette;
  /** Names of the six colors, as in the `color.*` translation keys. */
  colorNames: readonly string[];
}

export const PALETTE_SIZE = 6;

const CHALK: Palette = ['#ecebe4', '#ffd866', '#ff8fab', '#7cc4ff', '#8fe388', '#ffad5c'];
const CHALK_NAMES = ['white', 'yellow', 'pink', 'blue', 'green', 'orange'];
const MARKER: Palette = ['#1f2328', '#cf222e', '#0969da', '#1a7f37', '#9a6700', '#8250df'];
const MARKER_NAMES = ['black', 'red', 'blue', 'green', 'brown', 'purple'];

export const THEMES: readonly Theme[] = [
  { id: 'black', background: '#141615', dark: true, palette: CHALK, colorNames: CHALK_NAMES },
  { id: 'slate', background: '#232a30', dark: true, palette: CHALK, colorNames: CHALK_NAMES },
  { id: 'green', background: '#1e3a2c', dark: true, palette: CHALK, colorNames: CHALK_NAMES },
  { id: 'white', background: '#f7f6f2', dark: false, palette: MARKER, colorNames: MARKER_NAMES },
];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as Theme);
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export interface FontChoice {
  id: string;
  label: string;
  stack: string;
}

/** Two handwriting fonts ship with the app; the others come from the system. */
export const FONTS: readonly FontChoice[] = [
  { id: 'hand', label: 'Patrick Hand', stack: '"Patrick Hand", "Segoe Print", "Bradley Hand", cursive' },
  { id: 'script', label: 'Caveat', stack: '"Caveat", "Segoe Script", "Snell Roundhand", cursive' },
  {
    id: 'sans',
    label: 'Sans',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif',
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Noto Serif", serif',
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  },
];

const SYSTEM_PREFIX = 'system:';
const MAX_FAMILY_LENGTH = 200;

/** Font id for an installed family, as stored in the settings. */
export function systemFontId(family: string): string {
  return SYSTEM_PREFIX + family;
}

export function isFontId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (FONTS.some((font) => font.id === value)) return true;
  const family = value.startsWith(SYSTEM_PREFIX) ? value.slice(SYSTEM_PREFIX.length).trim() : '';
  return family.length > 0 && family.length <= MAX_FAMILY_LENGTH;
}

/** CSS font-family value for a font id. */
export function fontStack(id: string): string {
  if (id.startsWith(SYSTEM_PREFIX)) {
    return `${quoteFamily(id.slice(SYSTEM_PREFIX.length))}, system-ui, sans-serif`;
  }
  return (FONTS.find((font) => font.id === id) ?? (FONTS[0] as FontChoice)).stack;
}

/** Quotes a family name for CSS, so names with quotes or commas stay one family. */
function quoteFamily(family: string): string {
  const clean = family.replace(/[\n\r\f]/g, ' ').replace(/[\\"]/g, '\\$&');
  return `"${clean}"`;
}
