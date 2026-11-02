// End-to-end smoke test: drives the real UI against a running dev stack.
//   Prereqs: `npm run dev` (web :5173, api :8787) and Playwright with Chromium available
//   (`npx playwright install chromium` if you don't already have it).
//   Run:  node e2e/smoke.mjs   (BASE_URL, OUT_DIR optional)
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT_DIR ?? path.resolve('e2e/output');
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

const ANSWER =
  'photosynthesis is the process by which green plants make food using sunlight. chlorophyll in the leaves absorbs light energy. ' +
  'water from the roots and carbon dioxide from the air are combined to make glucose and oxygen. ' +
  'this is important because it supplies energy to almost every food chain on earth. '.repeat(1) +
  'plants also release oxygen which animals need to breathe. the process takes place in the chloroplasts. ' +
  'light dependent reactions happen in the thylakoid membranes. the calvin cycle happens in the stroma. ' +
  'factors such as light intensity, temperature and carbon dioxide concentration affect the rate of photosynthesis.';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  // ---- dashboard
  await page.goto(BASE);
  await page.getByRole('heading', { name: /Speak or type/ }).waitFor();
  await page.getByText('No documents yet').waitFor({ timeout: 10000 });
  check(true, 'dashboard shows empty state');
  await page.screenshot({ path: `${OUT}/01-dashboard-empty.png` });

  // ---- step 1: input
  await page.getByRole('button', { name: 'Start an exam answer' }).click();
  await page.getByLabel('1. Exam question').fill('Explain the process of photosynthesis.');
  await page.getByLabel('Title').fill('Photosynthesis - Biology');
  await page.getByLabel('2. Your answer').fill(ANSWER);
  await page.screenshot({ path: `${OUT}/02-input.png` });

  // preview should already render handwriting for the raw text
  await page.getByTestId('page-canvas').first().waitFor();
  check((await page.getByTestId('page-canvas').count()) >= 1, 'live preview renders at least one page');

  // ---- step 2: organize (local fallback, no API key)
  await page.getByRole('button', { name: /Next: organize with AI/ }).click();
  await page.getByRole('button', { name: /^(Format my text|Organi[sz]e with AI)$/ }).click();
  await page.getByLabel('Text that will be written (editable)').waitFor({ timeout: 15000 });
  check(await page.getByText('Basic formatting only').isVisible(), 'review step honestly says no AI model was used');
  await page.screenshot({ path: `${OUT}/03-review.png` });

  const body = await page.getByLabel('Text that will be written (editable)').inputValue();
  check(body.length > 100, `organized text present (${body.length} chars)`);

  // ---- step 4: style
  await page.getByRole('button', { name: /choose a style/ }).click();
  await page.screenshot({ path: `${OUT}/04-style.png` });
  await page.getByRole('button', { name: /^Next/ }).first().click();

  // ---- step 5: export
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const pdfPath = `${OUT}/export.pdf`;
  await pdf.saveAs(pdfPath);
  const pdfBytes = readFileSync(pdfPath);
  check(pdfBytes.subarray(0, 5).toString() === '%PDF-', `PDF downloaded and has a PDF header (${pdfBytes.length} bytes)`);

  const pngButton = page.getByRole('button', { name: /Download (all pages \(PNG\)|PNG)/ });
  const [png] = await Promise.all([page.waitForEvent('download'), pngButton.click()]);
  const pngPath = `${OUT}/page-1.png`;
  await png.saveAs(pngPath);
  const pngBytes = readFileSync(pngPath);
  check(pngBytes.subarray(1, 4).toString() === 'PNG', `PNG downloaded and has a PNG signature (${statSync(pngPath).size} bytes)`);

  // ---- save, then dashboard
  await page.getByRole('button', { name: /^Save document|Saved/ }).click();
  await page.getByText('Saved.').first().waitFor();
  check(/#\/doc\/[0-9a-f-]{36}/.test(page.url()), 'URL updated to the saved document');
  await page.screenshot({ path: `${OUT}/05-export.png` });

  await page.goto(`${BASE}/#/`);
  await page.getByRole('heading', { name: 'Photosynthesis - Biology' }).waitFor();
  check(true, 'saved document appears on the dashboard');
  await page.screenshot({ path: `${OUT}/06-dashboard.png` });

  // duplicate + rename + delete
  await page.getByRole('button', { name: /^Duplicate/ }).click();
  await page.getByText('Document duplicated.').waitFor();
  await page.getByRole('button', { name: /^Rename/ }).first().click();
  await page.getByLabel('Title').fill('Renamed copy');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('heading', { name: 'Renamed copy' }).waitFor();
  check(true, 'duplicate and rename work');
  await page.getByRole('button', { name: /^Delete/ }).first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Document deleted.').waitFor();
  check(true, 'delete works');

  // ---- reopen persisted document
  await page.getByRole('link', { name: /^Open/ }).first().click();
  await page.getByTestId('page-canvas').first().waitFor();
  check(true, 'reopened document renders its pages');

  // ---- mobile layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${OUT}/07-mobile.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'no horizontal scrolling at 390px width');

  // ---- accessibility scan
  // The scan injects a script; a strict CSP (production) may block that, which is not an app error.
  const appConsoleErrors = [...consoleErrors];
  try {
    const axePath = require.resolve('axe-core/axe.min.js');
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.addScriptTag({ path: axePath });
    const results = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
    for (const v of results.violations) console.log(`      axe: ${v.id} (${v.impact}) x${v.nodes.length} - ${v.help}`);
    check(results.violations.length === 0, `axe-core: ${results.violations.length} WCAG A/AA violations on the workspace page`);
  } catch (e) {
    console.log('SKIP  axe scan not run (axe-core missing, or CSP blocked its injection)');
  }

  check(appConsoleErrors.length === 0, `no console errors${appConsoleErrors.length ? ': ' + appConsoleErrors.join(' | ') : ''}`);
} catch (err) {
  failures++;
  console.log('FAIL  unexpected error:', err.message);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nAll E2E checks passed.' : `\n${failures} E2E check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
