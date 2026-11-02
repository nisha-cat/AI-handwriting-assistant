import { useState } from 'react';
import type { LayoutResult } from '@hw/shared';
import { api } from '../lib/api';
import { slugify } from '../lib/draft';
import { saveBlob } from '../lib/format';
import { pageToPng } from '../lib/render';
import { useToast } from './Toasts';

interface Props {
  result: LayoutResult | null;
  title: string;
  onBack: () => void;
  onSave: () => Promise<boolean>;
  saving: boolean;
  saved: boolean;
}

export function StepExport({ result, title, onBack, onSave, saving, saved }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'pdf' | 'png'>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = result?.layout.pages.length ?? 0;
  const base = slugify(title || 'notes');

  async function downloadPdf() {
    if (!result) return;
    setError(null);
    setBusy('pdf');
    try {
      const blob = await api.exportPdf({ title: title || 'notes', layout: result.layout });
      saveBlob(blob, `${base}.pdf`);
      toast.success('PDF downloaded.');
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'PDF export failed.'} You can still download PNG images of each page.`);
    } finally {
      setBusy(null);
    }
  }

  async function downloadPng(pageIndexes: number[]) {
    if (!result) return;
    setError(null);
    setBusy('png');
    try {
      for (const i of pageIndexes) {
        const blob = await pageToPng(result.layout, i);
        saveBlob(blob, `${base}-page-${i + 1}.png`);
        // Browsers may throttle bursts of downloads; a short pause keeps them all.
        if (pageIndexes.length > 1) await new Promise((r) => setTimeout(r, 350));
      }
      toast.success(pageIndexes.length > 1 ? `${pageIndexes.length} PNG images downloaded.` : 'PNG downloaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PNG export failed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const disabled = !result || pages === 0 || busy !== null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-stone-800">
        {pages > 0 ? `Your notes are ${pages} page${pages === 1 ? '' : 's'}.` : 'Nothing to export yet.'} PDF export embeds the handwriting font and uses the same layout you see in the preview.
      </p>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={disabled} onClick={() => void downloadPdf()}>
          {busy === 'pdf' ? 'Building PDF…' : 'Download PDF'}
        </button>
        <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void downloadPng(Array.from({ length: pages }, (_, i) => i))}>
          {busy === 'png' ? 'Rendering…' : pages > 1 ? 'Download all pages (PNG)' : 'Download PNG'}
        </button>
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => void onSave()}>
          {saving ? 'Saving…' : saved ? 'Saved ✓ - save again' : 'Save document'}
        </button>
      </div>

      {pages > 1 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Individual pages</h3>
          <ul className="flex flex-wrap gap-2">
            {Array.from({ length: pages }, (_, i) => (
              <li key={i}>
                <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void downloadPng([i])}>
                  Page {i + 1} (PNG)
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          {error}
        </div>
      )}

      <aside className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
        <p>
          <strong>About this output:</strong> pages are a <em>handwriting-style rendering</em> made from open-licensed fonts (SIL OFL), not a sample of anyone's real handwriting. Use it for your own notes and answers, and check that your school or exam board allows assistive tools before submitting work. Don't use it to imitate another person's handwriting or signature.
        </p>
      </aside>

      <button type="button" className="btn-secondary" onClick={onBack}>
        ← Back to style
      </button>
    </div>
  );
}
