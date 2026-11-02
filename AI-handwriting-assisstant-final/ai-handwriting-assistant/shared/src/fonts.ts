import type { HANDWRITING_STYLE_IDS } from './schemas';

export type HandwritingStyleId = (typeof HANDWRITING_STYLE_IDS)[number];

export interface HandwritingStyleInfo {
  id: HandwritingStyleId;
  label: string;
  description: string;
  /** CSS font-family name (matches the @fontsource packages used by the web app). */
  cssFamily: string;
  /** Font file bundled in server/assets/fonts (used for PDF embedding). */
  file: string;
  license: string;
}

/** All three are SIL Open Font License 1.1 fonts, distributed via @fontsource. */
export const HANDWRITING_STYLES: Record<HandwritingStyleId, HandwritingStyleInfo> = {
  caveat: {
    id: 'caveat',
    label: 'Caveat',
    description: 'Flowing, slanted cursive-style hand',
    cssFamily: 'Caveat',
    file: 'caveat-latin-400-normal.woff',
    license: 'SIL OFL 1.1 - The Caveat Project Authors',
  },
  kalam: {
    id: 'kalam',
    label: 'Kalam',
    description: 'Upright, casual marker-pen hand',
    cssFamily: 'Kalam',
    file: 'kalam-latin-400-normal.woff',
    license: 'SIL OFL 1.1 - Indian Type Foundry',
  },
  patrick: {
    id: 'patrick',
    label: 'Patrick Hand',
    description: 'Neat, rounded print-style hand',
    cssFamily: 'Patrick Hand',
    file: 'patrick-hand-latin-400-normal.woff',
    license: 'SIL OFL 1.1 - Patrick Wagesreiter',
  },
};

export const INK_PRESETS = [
  { label: 'Blue', value: '#1f3fa0' },
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Dark green', value: '#14532d' },
  { label: 'Purple', value: '#5b21b6' },
  { label: 'Dark red', value: '#991b1b' },
] as const;

/** Page sizes in PostScript points. */
export const PAGE_DIMENSIONS = {
  a4: { width: 595.28, height: 841.89, label: 'A4' },
  letter: { width: 612, height: 792, label: 'US Letter' },
} as const;

/**
 * Characters present in the bundled (Latin-subset) fonts. Anything else cannot be drawn
 * faithfully, so the layout engine substitutes "?" and reports it instead of silently
 * rendering missing-glyph boxes.
 */
const SUPPORTED = /[ -~ -ÿŒœ‐-‧‰‹›€™−]/;

export function isSupportedChar(ch: string): boolean {
  return SUPPORTED.test(ch);
}
