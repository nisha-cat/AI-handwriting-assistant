import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  HANDWRITING_STYLES,
  PAPER_COLOR,
  computeLayout,
  getPaperSegments,
  type HandwritingSettings,
  type HandwritingStyleId,
  type Layout,
  type LayoutResult,
  type MeasureFn,
} from '@hw/shared';

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
const REFERENCE_SIZE = 100;

/**
 * Widths are measured at a large reference size and scaled linearly. Measuring directly at
 * ~18px would be affected by hinting/rounding and would not match the PDF's font metrics.
 */
export function createMeasure(cssFamily: string): MeasureFn {
  return (text, fontSize) => {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return text.length * fontSize * 0.5;
    measureCtx.font = `${REFERENCE_SIZE}px "${cssFamily}"`;
    return (measureCtx.measureText(text).width * fontSize) / REFERENCE_SIZE;
  };
}

/** Resolves once the handwriting font is actually usable by canvas. */
export function useFontReady(style: HandwritingStyleId): { ready: boolean; failed: boolean } {
  const [state, setState] = useState<{ style: HandwritingStyleId; ready: boolean; failed: boolean }>({
    style,
    ready: false,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    const family = HANDWRITING_STYLES[style].cssFamily;
    setState({ style, ready: false, failed: false });
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.load) {
      setState({ style, ready: true, failed: false });
      return;
    }
    // Load the latin subset the layout uses; loading "A" is enough to pull the matching file.
    fonts
      .load(`18px "${family}"`, 'Aa Zz 09')
      .then((faces) => {
        if (!cancelled) setState({ style, ready: true, failed: faces.length === 0 });
      })
      .catch(() => {
        if (!cancelled) setState({ style, ready: true, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [style]);

  return { ready: state.style === style && state.ready, failed: state.style === style && state.failed };
}

export interface UseLayoutArgs {
  text: string;
  title: string;
  settings: HandwritingSettings;
  dateText: string;
}

export function useHandwritingLayout({ text, title, settings, dateText }: UseLayoutArgs) {
  const { ready, failed } = useFontReady(settings.style);
  // Keep typing responsive: layout may lag a frame behind the textarea.
  const deferredText = useDeferredValue(text);
  const deferredTitle = useDeferredValue(title);

  const result: LayoutResult | null = useMemo(() => {
    if (!ready) return null;
    return computeLayout({
      text: deferredText,
      title: deferredTitle,
      settings,
      dateText,
      measure: createMeasure(HANDWRITING_STYLES[settings.style].cssFamily),
    });
  }, [ready, deferredText, deferredTitle, settings, dateText]);

  return { result, fontReady: ready, fontFailed: failed };
}

// ---------------------------------------------------------------------------
// Drawing (mirrors server/src/export/pdf.ts so preview, PNG and PDF agree)
// ---------------------------------------------------------------------------

export function drawPage(ctx: CanvasRenderingContext2D, layout: Layout, pageIndex: number, scale: number): void {
  const page = layout.pages[pageIndex];
  if (!page) return;
  const family = HANDWRITING_STYLES[layout.style].cssFamily;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, layout.pageWidth, layout.pageHeight);

  for (const s of getPaperSegments(layout)) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }

  ctx.fillStyle = layout.inkColor;
  ctx.strokeStyle = layout.inkColor;
  ctx.textBaseline = 'alphabetic';
  for (const line of page.lines) {
    ctx.save();
    ctx.translate(line.x, line.y);
    ctx.rotate((line.rotation * Math.PI) / 180);
    ctx.font = `${line.fontSize}px "${family}"`;
    ctx.fillText(line.text, 0, 0);
    if (line.underline && line.width > 0) {
      ctx.lineWidth = Math.max(0.6, line.fontSize * 0.04);
      ctx.beginPath();
      ctx.moveTo(0, 2.5);
      ctx.lineTo(line.width, 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Renders one page to a PNG blob (scale 3 ≈ 215 dpi on A4). */
export function pageToPng(layout: Layout, pageIndex: number, scale = 3): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.pageWidth * scale);
  canvas.height = Math.round(layout.pageHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not available in this browser.'));
  drawPage(ctx, layout, pageIndex, scale);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob && blob.size > 0 ? resolve(blob) : reject(new Error('The browser could not create the image.'))),
      'image/png',
    );
  });
}
