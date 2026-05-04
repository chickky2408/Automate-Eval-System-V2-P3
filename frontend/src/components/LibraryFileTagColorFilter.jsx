import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TAG_PALETTE_KEYS, TAG_PALETTE_MAP, TAG_SWATCH_DOT_CLASS } from '../utils/tagPalette';

/**
 * Library "Select file" modal — tag color filter: combobox with search + scrollable swatch list (matches File Library style).
 */
export default function LibraryFileTagColorFilter({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);

  const safeKey = value && TAG_PALETTE_MAP[value] ? value : '';
  const dotClass = !safeKey ? 'bg-slate-400' : TAG_SWATCH_DOT_CLASS[safeKey] || 'bg-slate-400';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const qLower = q.trim().toLowerCase();
  const filteredKeys = TAG_PALETTE_KEYS.filter((k) => k.toLowerCase().includes(qLower));

  return (
    <div ref={rootRef} className="flex flex-col gap-0.5 min-w-0 relative" data-library-picker-filter-root>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Tag color
      </span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={`w-full flex items-center gap-2 pl-2.5 pr-8 py-1.5 text-xs rounded-lg border bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-left min-h-[34px] ${
            open
              ? 'border-blue-500 ring-2 ring-blue-500/40 dark:ring-blue-400/35'
              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-slate-300/80 dark:ring-slate-600 ${dotClass}`}
            aria-hidden
          />
          <span className={`truncate flex-1 min-w-0 ${safeKey ? 'lowercase' : ''}`}>
            {!safeKey ? 'Any color' : safeKey}
          </span>
        </button>
        <span
          className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center text-slate-400 dark:text-slate-500"
          aria-hidden
        >
          <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />
        </span>
      </div>

      {open && !disabled && (
        <div
          className="absolute left-0 right-0 top-full z-[160] mt-1 flex max-h-[min(50vh,280px)] min-w-[200px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900"
          role="listbox"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 border-b border-slate-100 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Tag color
          </div>
          <div className="shrink-0 p-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search color..."
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              autoFocus
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-width:thin]">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!safeKey}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium lowercase transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  !safeKey ? 'bg-slate-100 dark:bg-slate-800/90' : ''
                } text-slate-800 dark:text-slate-100`}
              >
                <span className="h-3 w-3 shrink-0 rounded-full bg-slate-400 ring-1 ring-slate-300/80 dark:ring-slate-600" />
                all
              </button>
            </li>
            {filteredKeys.map((k) => {
              const dc = TAG_SWATCH_DOT_CLASS[k] || 'bg-slate-400';
              const selected = k === safeKey;
              return (
                <li key={k}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(k);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium lowercase transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      selected ? 'bg-slate-100 dark:bg-slate-800/90' : ''
                    } text-slate-800 dark:text-slate-100`}
                  >
                    <span className={`h-3 w-3 shrink-0 rounded-full ring-1 ring-slate-300/80 dark:ring-slate-600 ${dc}`} />
                    {k}
                  </button>
                </li>
              );
            })}
            {filteredKeys.length === 0 && qLower && (
              <li className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">No color name matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
