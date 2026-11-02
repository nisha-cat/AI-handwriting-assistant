/**
 * End-to-end smoke test against a RUNNING server:
 *   npm run dev -w server   (or: npm run build && npm start)
 *   npm run smoke -w server -- ./out.pdf
 *
 * Walks the real workflow over HTTP: health → organise → save → reopen → export PDF.
 * Uses real font metrics (fontkit) so line wrapping matches what the browser would produce.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { HANDWRITING_STYLES, computeLayout, defaultHandwritingSettings, type MeasureFn } from '@hw/shared';

const API = process.env.API_URL ?? 'http://localhost:8787';
const out = process.argv[2] ?? 'smoke-output.pdf';
const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts');

let cookie = '';
async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return res;
}
const step = (msg: string) => console.log(`✔ ${msg}`);
const fail = (msg: string): never => {
  console.error(`✘ ${msg}`);
  process.exit(1);
};

const health: unknown = await (await call('GET', '/api/health')).json();
step(`health: ${JSON.stringify(health)}`);

const spoken =
  'um photosynthesis is the process by which green plants make food. it happens in the chloroplasts. ' +
  'plants take in carbon dioxide and water and with light energy they make glucose and oxygen. ' +
  'this is important because it supplies food and oxygen to almost all living things.';
const orgRes = await call('POST', '/api/ai/organize-answer', {
  text: spoken,
  mode: 'exam_answer',
  question: 'Explain photosynthesis.',
});
if (!orgRes.ok) fail(`organise failed: ${orgRes.status} ${await orgRes.text()}`);
const organized = (await orgRes.json()) as {
  provider: string;
  text: string;
  warnings: string[];
  organized: { title: string };
};
step(`organised via ${organized.provider}; warnings: ${organized.warnings.length}`);

const settings = defaultHandwritingSettings();
const key = `smoke-${Date.now()}`;
const docBody = {
  title: organized.organized.title || 'Photosynthesis',
  content: { mode: 'exam', question: 'Explain photosynthesis.', rawText: spoken, bodyText: organized.text, settings },
};
const created = await call('POST', '/api/documents', docBody, { 'Idempotency-Key': key });
const doc = ((await created.json()) as { document: { id: string } }).document;
const retried = await call('POST', '/api/documents', docBody, { 'Idempotency-Key': key });
if (((await retried.json()) as { document: { id: string } }).document.id !== doc.id) fail('idempotent retry created a duplicate');
step(`saved document ${doc.id} (retry returned same id)`);

const reopened = ((await (await call('GET', `/api/documents/${doc.id}`)).json()) as {
  document: { title: string; content: { rawText: string; bodyText: string } };
}).document;
if (reopened.content.rawText !== spoken) fail('original text was not preserved');
step('reopened; original dictation preserved');

const font = fontkit.create(readFileSync(path.join(fontsDir, HANDWRITING_STYLES[settings.style].file))) as unknown as {
  unitsPerEm: number;
  layout(text: string): { advanceWidth: number };
};
const measure: MeasureFn = (text, size) => (font.layout(text).advanceWidth / font.unitsPerEm) * size;
const { layout } = computeLayout({ text: reopened.content.bodyText, title: reopened.title, settings, measure });
step(`layout: ${layout.pages.length} page(s)`);

const pdfRes = await call('POST', '/api/export/pdf', { title: reopened.title, layout });
if (!pdfRes.ok) fail(`export failed: ${pdfRes.status} ${await pdfRes.text()}`);
const bytes = Buffer.from(await pdfRes.arrayBuffer());
const parsed = await PDFDocument.load(bytes);
if (parsed.getPageCount() !== layout.pages.length) fail('page count mismatch');
writeFileSync(out, bytes);
step(`PDF exported and re-opened OK: ${bytes.length} bytes, ${parsed.getPageCount()} page(s) → ${out}`);

await call('DELETE', `/api/documents/${doc.id}`);
step('cleaned up');
