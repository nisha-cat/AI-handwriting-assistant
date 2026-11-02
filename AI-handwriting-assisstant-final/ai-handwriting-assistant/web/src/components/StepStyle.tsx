import { HANDWRITING_STYLES, HANDWRITING_STYLE_IDS, INK_PRESETS, PAGE_DIMENSIONS, PAGE_SIZES, PAPER_TYPES, type HandwritingSettings } from '@hw/shared';

interface Props {
  settings: HandwritingSettings;
  onChange: (patch: Partial<HandwritingSettings>) => void;
  onBack: () => void;
  onNext: () => void;
  onSaveDefaults: () => void;
  savingDefaults: boolean;
}

const PAPER_LABELS = { ruled: 'Ruled notebook', grid: 'Grid', blank: 'Blank' } as const;

function Range({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="label flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-stone-700">
          {value}
          {unit}
        </span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-700" />
    </div>
  );
}

export function StepStyle({ settings, onChange, onBack, onNext, onSaveDefaults, savingDefaults }: Props) {
  const setMargin = (side: keyof HandwritingSettings['margins'], v: number) => onChange({ margins: { ...settings.margins, [side]: v } });

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="label">Handwriting style</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {HANDWRITING_STYLE_IDS.map((id) => {
            const s = HANDWRITING_STYLES[id];
            return (
              <label
                key={id}
                className={`cursor-pointer rounded-lg border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 ${
                  settings.style === id ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700' : 'border-stone-300 bg-white hover:bg-stone-50'
                }`}
              >
                <input type="radio" name="hw-style" className="sr-only" checked={settings.style === id} onChange={() => onChange({ style: id })} />
                <span className="block text-2xl leading-tight" style={{ fontFamily: `"${s.cssFamily}"`, color: settings.inkColor }} aria-hidden="true">
                  Sample note
                </span>
                <span className="mt-1 block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-stone-600">{s.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <fieldset>
          <legend className="label">Paper</legend>
          <div className="flex flex-wrap gap-2">
            {PAPER_TYPES.map((p) => (
              <label key={p} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-brand-600 ${settings.paper === p ? 'border-brand-700 bg-brand-50 font-semibold' : 'border-stone-300 bg-white'}`}>
                <input type="radio" name="hw-paper" className="sr-only" checked={settings.paper === p} onChange={() => onChange({ paper: p })} />
                {PAPER_LABELS[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="page-size" className="label">
            Page size
          </label>
          <select id="page-size" className="field" value={settings.pageSize} onChange={(e) => onChange({ pageSize: e.target.value as HandwritingSettings['pageSize'] })}>
            {PAGE_SIZES.map((p) => (
              <option key={p} value={p}>
                {PAGE_DIMENSIONS[p].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="label">Ink colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {INK_PRESETS.map((c) => (
            <label key={c.value} className="cursor-pointer">
              <input type="radio" name="hw-ink" className="peer sr-only" checked={settings.inkColor.toLowerCase() === c.value} onChange={() => onChange({ inkColor: c.value })} />
              <span
                className="flex size-9 items-center justify-center rounded-full border-2 border-white shadow ring-1 ring-stone-400 peer-checked:ring-4 peer-checked:ring-brand-700 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600"
                style={{ backgroundColor: c.value }}
                title={c.label}
              >
                <span className="sr-only">{c.label}</span>
              </span>
            </label>
          ))}
          <label className="ml-2 flex items-center gap-2 text-sm">
            Custom
            <input type="color" aria-label="Custom ink colour" value={settings.inkColor} onChange={(e) => onChange({ inkColor: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-stone-400" />
          </label>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Range id="font-size" label="Font size" value={settings.fontSize} min={10} max={32} unit=" pt" onChange={(v) => onChange({ fontSize: v })} />
        <Range id="line-spacing" label="Line spacing" value={settings.lineSpacing} min={16} max={48} unit=" pt" onChange={(v) => onChange({ lineSpacing: v })} />
        <Range id="naturalness" label="Natural variation" value={settings.naturalness} min={0} max={1} step={0.05} onChange={(v) => onChange({ naturalness: v })} />
        <div className="flex items-end">
          <button type="button" className="btn-secondary" onClick={() => onChange({ seed: (settings.seed + 1 + Math.floor(Math.random() * 1000)) % 1_000_000 })}>
            Shuffle variation
          </button>
        </div>
      </div>

      <fieldset>
        <legend className="label">Margins (pt; 72 pt = 1 inch)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <div key={side}>
              <label htmlFor={`margin-${side}`} className="hint mt-0 mb-1 block capitalize">
                {side}
              </label>
              <input
                id={`margin-${side}`}
                type="number"
                className="field"
                min={side === 'bottom' ? 36 : 24}
                max={144}
                value={settings.margins[side]}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setMargin(side, Math.min(144, Math.max(side === 'bottom' ? 36 : 24, n)));
                }}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Page extras</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(
            [
              ['showTitle', 'Title on page 1'],
              ['showDate', "Today's date"],
              ['pageNumbers', 'Page numbers'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-700" checked={settings[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn-secondary" onClick={onSaveDefaults} disabled={savingDefaults}>
          {savingDefaults ? 'Saving…' : 'Save as my default style'}
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
          Next: export →
        </button>
      </div>
    </div>
  );
}
