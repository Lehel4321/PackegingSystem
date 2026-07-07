import { useState } from 'react';

export const inputCls = "bg-[#0b1017] border border-[#1c2736] rounded text-[0.875rem] text-slate-100 px-2 py-1.5 font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed";
export const labelCls = "text-[0.65rem] uppercase tracking-[0.05em] text-slate-500 font-semibold";

/**
 * Numeric field that does NOT commit on every keystroke: while typing
 * it holds a local draft and only commits the parsed value on
 * blur/Enter. A half-typed or cleared field never reaches the engine,
 * so the value cannot snap back mid-edit.
 */
export function NumField({ value, onCommit, disabled, min, max, step, cls }: {
  value: number;
  onCommit: (n: number) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  step?: string;
  cls?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number" min={min} max={max} step={step} disabled={disabled}
      value={draft !== null ? draft : value}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const n = parseFloat(draft);
          if (Number.isFinite(n)) onCommit(n);
        }
        setDraft(null);
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={cls || inputCls}
    />
  );
}
