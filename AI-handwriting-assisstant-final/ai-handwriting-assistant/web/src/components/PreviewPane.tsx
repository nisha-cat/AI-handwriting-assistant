import { useEffect, useRef } from 'react';
import { HANDWRITING_STYLES, type HandwritingStyleId, type Layout, type LayoutResult } from '@hw/shared';
import { drawPage } from '../lib/render';

interface PageCanvasProps {
  layout: Layout;
  index: number;
}

const PREVIEW_SCALE = 1.6;

function PageCanvas({ layout, index }: PageCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = Math.round(layout.pageWidth * PREVIEW_SCALE);
    canvas.height = Math.round(layout.pageHeight * PREVIEW_SCALE);
    drawPage(ctx, layout, index, PREVIEW_SCALE);
  }, [layout, index]);

  const firstText = layout.pages[index]?.lines.find((l) => l.kind === 'body' || l.kind === 'heading')?.text ?? 'empty page';
  return (
    <figure className="mx-auto w-full max-w-[640px]">
      <canvas
        ref={ref}
        role="img"
        aria-label={`Handwriting-style preview, page ${index + 1} of ${layout.pages.length}. Begins: ${firstText}`}
        className="h-auto w-full rounded border border-stone-300 bg-white shadow-md"
        style={{ aspectRatio: `${layout.pageWidth} / ${layout.pageHeight}` }}
        data-testid="page-canvas"
      />
      <figcaption className="mt-1 text-center text-xs text-stone-600">
        Page {index + 1} of {layout.pages.length}
      </figcaption>
    </figure>
  );
}

interface Props {
  result: LayoutResult | null;
  fontReady: boolean;
  fontFailed: boolean;
  styleId: HandwritingStyleId;
  empty: boolean;
}

/** Live, deterministic preview. Draws the same layout that the PDF export uses. */
export function PreviewPane({ result, fontReady, fontFailed, styleId, empty }: Props) {
  const style = HANDWRITING_STYLES[styleId];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Preview</h2>
        <p className="text-xs text-stone-600">Handwriting-style rendering using the “{style.label}” font - not real handwriting.</p>
      </div>
      {fontFailed && (
        <p role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
          The “{style.label}” font could not be loaded, so the preview may use a fallback font. Reload the page to try again.
        </p>
      )}
      {result && result.unsupportedChars.length > 0 && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
          These characters aren't in the handwriting fonts and were shown as “?”: {result.unsupportedChars.join(' ')}. Edit the text to avoid them.
        </p>
      )}
      {result?.truncated && (
        <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-950">
          Your text is longer than the maximum page count, so the end was cut off. Split it into two documents.
        </p>
      )}
      {!fontReady && <p className="text-sm text-stone-600">Loading handwriting font…</p>}
      {fontReady && empty && <p className="rounded border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600">Your pages will appear here as soon as there is some text.</p>}
      <div className="space-y-6">
        {result && !empty && result.layout.pages.map((_, i) => <PageCanvas key={i} layout={result.layout} index={i} />)}
      </div>
    </div>
  );
}
