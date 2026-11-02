import { describe, expect, it } from 'vitest';
import { computeLayout, wrapText, type MeasureFn } from './layout';
import { defaultHandwritingSettings, layoutSchema, LIMITS } from './schemas';
import { organizedToMarkup, parseMarkup } from './markup';

/** Fake monospace-ish measurer so tests don't need a canvas or font files. */
const measure: MeasureFn = (text, size) => Array.from(text).length * size * 0.5;

const settings = () => defaultHandwritingSettings();
const lorem = 'The mitochondria is the organelle that produces most of the cell energy as ATP. '.repeat(40);

describe('parseMarkup', () => {
  it('recognises headings, bullets, numbered items and paragraphs', () => {
    const blocks = parseMarkup('# Intro\nplain\n- one\n2) two\n\n* star');
    expect(blocks).toEqual([
      { type: 'heading', text: 'Intro' },
      { type: 'paragraph', text: 'plain' },
      { type: 'bullet', text: 'one' },
      { type: 'numbered', marker: '2.', text: 'two' },
      { type: 'bullet', text: 'star' },
    ]);
  });

  it('round-trips structured output to editable markup', () => {
    const md = organizedToMarkup({
      title: 'T',
      addedContent: false,
      changeNotes: [],
      sections: [
        { heading: 'Main', paragraphs: ['Para'], points: ['a', 'b'], ordered: true },
        { heading: '', paragraphs: [], points: ['x'], ordered: false },
      ],
    });
    expect(md).toBe('# Main\nPara\n1. a\n2. b\n\n- x');
  });
});

describe('wrapText', () => {
  it('never exceeds the max width', () => {
    const lines = wrapText(lorem, 300, 18, measure);
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(measure(l, 18)).toBeLessThanOrEqual(300);
  });

  it('splits words that are wider than the line', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious', 100, 18, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious');
    for (const l of lines) expect(measure(l, 18)).toBeLessThanOrEqual(100);
  });
});

describe('computeLayout', () => {
  it('keeps every line inside the margins and on the page', () => {
    const { layout } = computeLayout({ text: lorem, title: 'Biology', settings: settings(), measure });
    const right = layout.pageWidth - layout.marginRight;
    for (const page of layout.pages) {
      for (const line of page.lines) {
        if (line.kind === 'pageNumber') continue;
        expect(line.x).toBeGreaterThanOrEqual(layout.marginLeft - 2);
        expect(line.x + line.width).toBeLessThanOrEqual(right + 2);
        expect(line.y).toBeLessThanOrEqual(layout.pageHeight);
      }
    }
  });

  it('paginates and never overfills a page', () => {
    const { layout } = computeLayout({ text: lorem, title: 'Biology', settings: settings(), measure });
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      const textRows = new Set(page.lines.filter((l) => l.kind !== 'pageNumber').map((l) => Math.round(l.y / layout.pitch)));
      expect(textRows.size).toBeLessThanOrEqual(layout.rows);
    }
  });

  it('never places two lines of text on the same baseline row', () => {
    const { layout } = computeLayout({ text: lorem, title: 'T', settings: settings(), measure });
    for (const page of layout.pages) {
      const ys = page.lines.filter((l) => l.kind === 'body').map((l) => l.y);
      expect(new Set(ys).size).toBe(ys.length);
    }
  });

  it('enforces a minimum row pitch based on font size', () => {
    const s = { ...settings(), fontSize: 30, lineSpacing: 16 };
    const { layout } = computeLayout({ text: 'hello', title: '', settings: s, measure });
    expect(layout.pitch).toBeGreaterThanOrEqual(30 * 1.25);
  });

  it('does not leave a heading stranded at the bottom of a page', () => {
    const s = settings();
    const filler = Array.from({ length: 200 }, (_, i) => `Line number ${i}`).join('\n');
    const { layout } = computeLayout({ text: `${filler}\n# Heading\nAfter`, title: '', settings: s, measure });
    for (const page of layout.pages) {
      const body = page.lines.filter((l) => l.kind !== 'pageNumber');
      const last = body[body.length - 1];
      if (last) expect(last.kind).not.toBe('heading');
    }
  });

  it('is deterministic for identical input', () => {
    const a = computeLayout({ text: lorem, title: 'T', settings: settings(), measure });
    const b = computeLayout({ text: lorem, title: 'T', settings: settings(), measure });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('varies with the seed only when naturalness > 0', () => {
    const base = { ...settings(), naturalness: 0 };
    const a = computeLayout({ text: 'hello world', title: '', settings: { ...base, seed: 1 }, measure });
    const b = computeLayout({ text: 'hello world', title: '', settings: { ...base, seed: 2 }, measure });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = computeLayout({ text: 'hello world', title: '', settings: { ...base, naturalness: 1, seed: 1 }, measure });
    const d = computeLayout({ text: 'hello world', title: '', settings: { ...base, naturalness: 1, seed: 2 }, measure });
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(d));
  });

  it('keeps rotation small enough to stay legible', () => {
    const { layout } = computeLayout({ text: lorem, title: 'T', settings: { ...settings(), naturalness: 1 }, measure });
    for (const p of layout.pages) for (const l of p.lines) expect(Math.abs(l.rotation)).toBeLessThanOrEqual(0.31);
  });

  it('replaces characters the fonts cannot draw and reports them', () => {
    const r = computeLayout({ text: 'Hello नमस्ते 😀', title: '', settings: settings(), measure });
    expect(r.unsupportedChars.length).toBeGreaterThan(0);
    const text = r.layout.pages[0]!.lines.map((l) => l.text).join(' ');
    expect(text).toContain('?');
    expect(text).not.toContain('😀');
  });

  it('returns one blank page for empty text', () => {
    const r = computeLayout({ text: '', title: '', settings: settings(), measure });
    expect(r.layout.pages).toHaveLength(1);
  });

  it('truncates at the page limit and says so', () => {
    const huge = Array.from({ length: 6000 }, (_, i) => `line ${i}`).join('\n');
    const r = computeLayout({ text: huge, title: '', settings: settings(), measure });
    expect(r.layout.pages.length).toBe(LIMITS.maxPages);
    expect(r.truncated).toBe(true);
  });

  it('adds page numbers and date only when enabled', () => {
    const on = computeLayout({
      text: 'x',
      title: 'T',
      dateText: '1 Jan 2026',
      settings: { ...settings(), showDate: true, pageNumbers: true },
      measure,
    });
    const kinds = on.layout.pages[0]!.lines.map((l) => l.kind);
    expect(kinds).toContain('date');
    expect(kinds).toContain('pageNumber');
    const off = computeLayout({
      text: 'x',
      title: 'T',
      dateText: '1 Jan 2026',
      settings: { ...settings(), showDate: false, pageNumbers: false },
      measure,
    });
    const offKinds = off.layout.pages[0]!.lines.map((l) => l.kind);
    expect(offKinds).not.toContain('date');
    expect(offKinds).not.toContain('pageNumber');
  });

  it('supports A4 and Letter dimensions', () => {
    const a4 = computeLayout({ text: 'x', title: '', settings: { ...settings(), pageSize: 'a4' }, measure });
    const letter = computeLayout({ text: 'x', title: '', settings: { ...settings(), pageSize: 'letter' }, measure });
    expect(Math.round(a4.layout.pageWidth)).toBe(595);
    expect(letter.layout.pageWidth).toBe(612);
  });

  it('produces output that satisfies the export schema', () => {
    const { layout } = computeLayout({ text: lorem, title: 'Biology', settings: settings(), measure });
    expect(layoutSchema.safeParse(layout).success).toBe(true);
  });
});
