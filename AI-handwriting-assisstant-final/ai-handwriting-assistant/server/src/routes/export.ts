import { Router } from 'express';
import { exportPdfRequestSchema } from '@hw/shared';
import { AppError } from '../errors';
import { renderPdf, safeFilename } from '../export/pdf';

export function exportRouter(): Router {
  const router = Router();

  // POST /api/export/pdf  body: { title, layout }  → application/pdf
  router.post('/pdf', async (req, res) => {
    const { title, layout } = exportPdfRequestSchema.parse(req.body);
    let bytes: Uint8Array;
    try {
      bytes = await renderPdf(layout, title);
    } catch (err) {
      throw new AppError(500, 'PDF_RENDER_FAILED', 'Could not build the PDF. Try again, or export pages as PNG images instead.', {
        reason: (err as Error).message.slice(0, 120),
      });
    }
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename(title)}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
      })
      .end(Buffer.from(bytes));
  });

  return router;
}
