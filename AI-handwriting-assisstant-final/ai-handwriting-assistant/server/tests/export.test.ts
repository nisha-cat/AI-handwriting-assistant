import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { computeLayout, defaultHandwritingSettings, type HandwritingSettings } from '@hw/shared';
import { safeFilename } from '../src/export/pdf';
import { buildApp, request } from './helpers';

const measure = (t: string, s: number) => Array.from(t).length * s * 0.45;
const body = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`).join('\n');

const layoutFor = (over: Partial<HandwritingSettings> = {}, text = body) =>
  computeLayout({ text: `# Heading\n${text}`, title: 'Biology: Cells', settings: { ...defaultHandwritingSettings(), ...over }, measure }).layout;

describe('POST /api/export/pdf', () => {
  it('produces a PDF that can be opened, with the expected page count and size', async () => {
    const { app } = buildApp();
    const layout = layoutFor();
    const res = await request(app).post('/api/export/pdf').send({ title: 'Biology: Cells', layout }).buffer(true).parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="biology-cells.pdf"');
    const bytes = res.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(layout.pages.length);
    expect(layout.pages.length).toBeGreaterThan(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    expect(doc.getTitle()).toBe('Biology: Cells');
  });

  it('embeds the handwriting font in the PDF', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout: layoutFor({ style: 'kalam' }, 'short') }).parse(binaryParser);
    // Objects are stored in compressed streams, so inspect the parsed font dictionaries.
    const doc = await PDFDocument.load(res.body as Buffer);
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const type0 = doc.context.lookup(fonts.values()[0]!, PDFDict);
    expect(type0.lookup(PDFName.of('BaseFont'), PDFName).decodeText()).toMatch(/^Kalam/);
    // "Embedded" means the descriptor carries the actual font program (a FontFile stream).
    const descendant = type0.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const hasFontFile = ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.has(PDFName.of(k)));
    expect(hasFontFile).toBe(true);
  });

  it.each(['caveat', 'kalam', 'patrick'] as const)('renders the %s style', async (style) => {
    const { app } = buildApp();
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout: layoutFor({ style }, 'Hello world') }).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(2000);
  });

  it.each(['ruled', 'grid', 'blank'] as const)('renders %s paper', async (paper) => {
    const { app } = buildApp();
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout: layoutFor({ paper }, 'Hello') }).parse(binaryParser);
    expect(res.status).toBe(200);
    await expect(PDFDocument.load(res.body as Buffer)).resolves.toBeTruthy();
  });

  it('exports US Letter pages at 612x792', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout: layoutFor({ pageSize: 'letter' }, 'Hello') }).parse(binaryParser);
    const doc = await PDFDocument.load(res.body as Buffer);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it('rejects an invalid layout with a 400', async () => {
    const { app } = buildApp();
    const bad = { ...layoutFor(), inkColor: 'url(javascript:alert(1))' };
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout: bad });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects more pages than the limit', async () => {
    const { app } = buildApp();
    const layout = layoutFor();
    const tooMany = { ...layout, pages: Array.from({ length: 61 }, () => layout.pages[0]) };
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout: tooMany });
    expect(res.status).toBe(400);
  });

  it('survives text containing control characters', async () => {
    const { app } = buildApp();
    const layout = layoutFor();
    layout.pages[0]!.lines[0]!.text = 'tab\there\u0007bell';
    const res = await request(app).post('/api/export/pdf').send({ title: 't', layout }).parse(binaryParser);
    expect(res.status).toBe(200);
  });
});

describe('safeFilename', () => {
  it('produces safe slugs', () => {
    expect(safeFilename('My Notes: Ch.1/2!')).toBe('my-notes-ch12.pdf');
    expect(safeFilename('"><script>')).toBe('script.pdf');
    expect(safeFilename('日本語')).toBe('notes.pdf');
    expect(safeFilename('')).toBe('notes.pdf');
  });
});

/** supertest buffers PDFs as text by default; collect raw bytes instead. */
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
