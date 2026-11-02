import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont } from 'pdf-lib';
import { HANDWRITING_STYLES, PAPER_COLOR, getPaperSegments, type Layout } from '@hw/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Works from source (src/export), the esbuild bundle (dist) and when FONT_DIR is set. */
function fontDir(): string {
  const candidates = [process.env.FONT_DIR, path.resolve(here, '../../assets/fonts'), path.resolve(here, '../assets/fonts')];
  const found = candidates.find((c): c is string => !!c && existsSync(c));
  if (!found) throw new Error('Handwriting font directory not found.');
  return found;
}

const fontBytesCache = new Map<string, Buffer>();
async function loadFontBytes(file: string): Promise<Buffer> {
  let bytes = fontBytesCache.get(file);
  if (!bytes) {
    bytes = await readFile(path.join(fontDir(), file));
    fontBytesCache.set(file, bytes);
  }
  return bytes;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** pdf-lib cannot encode control characters; strip them defensively. */
const clean = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, '');

/**
 * Renders a computed layout as a PDF. The same Layout drives the canvas preview, so text
 * wraps and paginates identically. The handwriting font is embedded (subset) in the file.
 */
export async function renderPdf(layout: Layout, title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const style = HANDWRITING_STYLES[layout.style];
  const font: PDFFont = await pdf.embedFont(await loadFontBytes(style.file), { subset: true });

  pdf.setTitle(title || 'Handwriting-style notes');
  pdf.setCreator('AI Handwriting Assistant');
  pdf.setProducer('AI Handwriting Assistant (pdf-lib)');
  pdf.setSubject('Handwriting-style rendering generated from typed or dictated text');

  const ink = hexToRgb(layout.inkColor);
  const paperBg = hexToRgb(PAPER_COLOR);
  const H = layout.pageHeight;
  const segments = getPaperSegments(layout);

  for (const pageData of layout.pages) {
    const page = pdf.addPage([layout.pageWidth, H]);
    page.drawRectangle({ x: 0, y: 0, width: layout.pageWidth, height: H, color: paperBg });

    for (const s of segments) {
      page.drawLine({
        start: { x: s.x1, y: H - s.y1 },
        end: { x: s.x2, y: H - s.y2 },
        thickness: s.width,
        color: hexToRgb(s.color),
      });
    }

    for (const line of pageData.lines) {
      const text = clean(line.text);
      if (!text) continue;
      page.drawText(text, {
        x: line.x,
        y: H - line.y,
        size: line.fontSize,
        font,
        color: ink,
        // Canvas rotation is clockwise-positive; PDF is counter-clockwise-positive.
        rotate: degrees(-line.rotation),
      });
      if (line.underline && line.width > 0) {
        page.drawLine({
          start: { x: line.x, y: H - line.y - 2.5 },
          end: { x: line.x + line.width, y: H - line.y - 2.5 },
          thickness: Math.max(0.6, line.fontSize * 0.04),
          color: ink,
        });
      }
    }
  }
  return pdf.save();
}

export function safeFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return `${slug || 'notes'}.pdf`;
}
