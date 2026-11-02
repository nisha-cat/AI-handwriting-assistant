import { PAGE_DIMENSIONS, isSupportedChar } from './fonts';
import { parseMarkup, type Block } from './markup';
import { LIMITS, type HandwritingSettings, type Layout, type LayoutLine } from './schemas';

/** Returns the rendered width (in points) of `text` at `fontSize` points. */
export type MeasureFn = (text: string, fontSize: number) => number;

export interface LayoutInput {
  text: string;
  title: string;
  settings: HandwritingSettings;
  /** Pre-formatted date; only drawn when settings.showDate is true. */
  dateText?: string;
  measure: MeasureFn;
}

export interface LayoutResult {
  layout: Layout;
  /** Distinct characters replaced with "?" because the bundled fonts lack them. */
  unsupportedChars: string[];
  /** True when the content exceeded LIMITS.maxPages and was cut off. */
  truncated: boolean;
}

interface Part {
  text: string;
  x: number;
  fontSize: number;
  kind: LayoutLine['kind'];
  underline: boolean;
  width: number;
}

interface Row {
  parts: Part[];
  spaceBefore: boolean;
  keepWithNext: boolean;
}

/** Deterministic pseudo-random value in [-1, 1] derived from integer inputs. */
function jitter(seed: number, page: number, row: number, channel: number): number {
  let h = 2166136261;
  for (const n of [seed, page, row, channel]) {
    h ^= n | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  let t = (h >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}

/** Greedy word wrap. Words wider than the line are split by character. */
export function wrapText(text: string, maxWidth: number, fontSize: number, measure: MeasureFn): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  const pushBroken = (word: string) => {
    let chunk = '';
    for (const ch of Array.from(word)) {
      if (chunk && measure(chunk + ch, fontSize) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    if (measure(word, fontSize) <= maxWidth) current = word;
    else pushBroken(word);
  }
  if (current) lines.push(current);
  return lines;
}

function sanitize(text: string, found: Set<string>): string {
  let out = '';
  for (const ch of Array.from(text.replace(/\t/g, '    '))) {
    if (ch === '\n' || isSupportedChar(ch)) out += ch;
    else {
      found.add(ch);
      out += '?';
    }
  }
  return out;
}

export function computeLayout(input: LayoutInput): LayoutResult {
  const { settings, measure } = input;
  const dims = PAGE_DIMENSIONS[settings.pageSize];
  const fs = settings.fontSize;
  // Rows must be tall enough that neighbouring lines of text never touch.
  const pitch = Math.max(settings.lineSpacing, fs * 1.25);
  const headingSize = Math.min(fs * 1.15, pitch * 0.9);
  const titleSize = Math.min(fs * 1.4, pitch * 0.9);

  const left = settings.margins.left;
  let contentWidth = dims.width - left - settings.margins.right;
  if (contentWidth < 120) contentWidth = 120; // guard against absurd margins
  const marginRight = dims.width - left - contentWidth;
  const gridTop = settings.margins.top;
  const usable = dims.height - gridTop - settings.margins.bottom;
  const rowsPerPage = Math.max(2, Math.floor(usable / pitch));

  const unsupported = new Set<string>();
  const part = (
    text: string,
    x: number,
    fontSize: number,
    kind: LayoutLine['kind'],
    underline = false,
  ): Part => ({ text, x, fontSize, kind, underline, width: measure(text, fontSize) });

  const rows: Row[] = [];

  // ----- title / date row(s) -----
  const title = sanitize(input.title.trim(), unsupported).replace(/\s+/g, ' ');
  const dateText = settings.showDate && input.dateText ? sanitize(input.dateText, unsupported) : '';
  if (settings.showTitle && title) {
    const dateWidth = dateText ? measure(dateText, fs) : 0;
    const titleWidth = contentWidth - (dateText ? dateWidth + 16 : 0);
    const titleLines = wrapText(title, Math.max(titleWidth, 80), titleSize, measure);
    titleLines.forEach((line, i) => {
      const parts = [part(line, left, titleSize, 'title', true)];
      if (i === 0 && dateText) parts.push(part(dateText, left + contentWidth - dateWidth, fs, 'date'));
      rows.push({ parts, spaceBefore: false, keepWithNext: true });
    });
  } else if (dateText) {
    const w = measure(dateText, fs);
    rows.push({ parts: [part(dateText, left + contentWidth - w, fs, 'date')], spaceBefore: false, keepWithNext: false });
  }

  // ----- body blocks -----
  const body = sanitize(input.text, unsupported);
  const blocks: Block[] = parseMarkup(body);
  const bulletIndent = fs * 1.1;
  const numberIndent = measure('88.', fs) + fs * 0.35;

  blocks.forEach((block, blockIndex) => {
    if (block.type === 'heading') {
      const lines = wrapText(block.text, contentWidth, headingSize, measure);
      lines.forEach((line, i) =>
        rows.push({
          parts: [part(line, left, headingSize, 'heading', true)],
          spaceBefore: i === 0 && (blockIndex > 0 || rows.length > 0),
          keepWithNext: true,
        }),
      );
      return;
    }
    const indent = block.type === 'bullet' ? bulletIndent : block.type === 'numbered' ? numberIndent : 0;
    const lines = wrapText(block.text, contentWidth - indent, fs, measure);
    lines.forEach((line, i) => {
      const parts: Part[] = [];
      if (i === 0 && block.type === 'bullet') parts.push(part('•', left, fs, 'marker'));
      if (i === 0 && block.type === 'numbered') parts.push(part(block.marker, left, fs, 'marker'));
      parts.push(part(line, left + indent, fs, 'body'));
      rows.push({ parts, spaceBefore: false, keepWithNext: false });
    });
  });

  // ----- pagination -----
  const pages: Part[][][] = [[]]; // pages → rows → parts (a null-ish gap is an empty array)
  let r = 0;
  let truncated = false;
  const newPage = (): boolean => {
    if (pages.length >= LIMITS.maxPages) {
      truncated = true;
      return false;
    }
    pages.push([]);
    r = 0;
    return true;
  };

  for (const row of rows) {
    const gap = row.spaceBefore && r > 0 ? 1 : 0;
    const needed = gap + 1 + (row.keepWithNext ? 1 : 0);
    if (r + needed > rowsPerPage && r > 0) {
      if (!newPage()) break;
    } else if (r >= rowsPerPage) {
      if (!newPage()) break;
    } else if (gap) {
      r += 1; // blank row before a heading
    }
    pages[pages.length - 1]![r] = row.parts;
    r += 1;
  }

  // ----- convert grid rows to positioned lines -----
  const lift = Math.max(2, pitch * 0.1);
  const natural = settings.naturalness;
  const layoutPages = pages.map((pageRows, pageIndex) => {
    const lines: LayoutLine[] = [];
    pageRows.forEach((parts, rowIndex) => {
      if (!parts) return;
      const rowRotation = jitter(settings.seed, pageIndex, rowIndex, 0) * 0.3 * natural;
      const dy = jitter(settings.seed, pageIndex, rowIndex, 1) * 0.8 * natural;
      const dx = jitter(settings.seed, pageIndex, rowIndex, 2) * 1.0 * natural;
      for (const p of parts) {
        if (!p.text) continue;
        const wobble = p.kind === 'date' ? 0 : 1;
        lines.push({
          text: p.text,
          x: round(p.x + dx * wobble),
          y: round(gridTop + (rowIndex + 1) * pitch - lift + dy * wobble),
          fontSize: round(p.fontSize),
          rotation: round(rowRotation * wobble, 3),
          width: round(p.width),
          kind: p.kind,
          underline: p.underline,
        });
      }
    });
    if (settings.pageNumbers) {
      const size = fs * 0.75;
      const label = String(pageIndex + 1);
      const w = measure(label, size);
      lines.push({
        text: label,
        x: round(dims.width / 2 - w / 2),
        y: round(dims.height - settings.margins.bottom / 2 + size * 0.35),
        fontSize: round(size),
        rotation: 0,
        width: round(w),
        kind: 'pageNumber',
        underline: false,
      });
    }
    return { lines };
  });

  return {
    layout: {
      pageWidth: dims.width,
      pageHeight: dims.height,
      style: settings.style,
      paper: settings.paper,
      inkColor: settings.inkColor,
      pitch: round(pitch),
      gridTop,
      rows: rowsPerPage,
      marginLeft: left,
      marginRight: round(marginRight),
      pages: layoutPages,
    },
    unsupportedChars: [...unsupported],
    truncated,
  };
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
