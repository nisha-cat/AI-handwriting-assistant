import type { Layout } from './schemas';

export const RULE_COLOR = '#c3d1e8';
export const GRID_COLOR = '#d5deee';
export const MARGIN_LINE_COLOR = '#e8a0a0';
export const PAPER_COLOR = '#ffffff';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in points. */
  width: number;
  color: string;
}

/**
 * Line segments that make up the paper background (y measured from the top of the page).
 * Both the canvas preview and the PDF exporter draw exactly these, so they cannot drift.
 */
export function getPaperSegments(layout: Layout): Segment[] {
  const { pageWidth: w, pageHeight: h, pitch, gridTop, rows, marginLeft } = layout;
  const segs: Segment[] = [];
  const gridBottom = gridTop + rows * pitch;

  if (layout.paper === 'ruled') {
    for (let r = 1; r <= rows; r++) {
      const y = gridTop + r * pitch;
      segs.push({ x1: 0, y1: y, x2: w, y2: y, width: 0.6, color: RULE_COLOR });
    }
    if (marginLeft >= 30) {
      const x = marginLeft - 8;
      segs.push({ x1: x, y1: 0, x2: x, y2: h, width: 0.8, color: MARGIN_LINE_COLOR });
    }
  } else if (layout.paper === 'grid') {
    for (let r = 0; r <= rows; r++) {
      const y = gridTop + r * pitch;
      segs.push({ x1: 0, y1: y, x2: w, y2: y, width: 0.5, color: GRID_COLOR });
    }
    // Vertical lines anchored on the left margin so text starts on a grid line.
    for (let x = marginLeft; x <= w; x += pitch) {
      segs.push({ x1: x, y1: gridTop, x2: x, y2: gridBottom, width: 0.5, color: GRID_COLOR });
    }
    for (let x = marginLeft - pitch; x >= 0; x -= pitch) {
      segs.push({ x1: x, y1: gridTop, x2: x, y2: gridBottom, width: 0.5, color: GRID_COLOR });
    }
  }
  return segs;
}
