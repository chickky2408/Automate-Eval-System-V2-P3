import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, PaintBucket } from 'lucide-react';
import {
  TAG_PALETTE_KEYS,
  TAG_PALETTE_MAP,
  TAG_SWATCH_DOT_CLASS,
  formatPaletteOptionLabel,
} from '../utils/tagPalette';

/**
 * Paint bucket = random palette key. Main control = grid of color dots (no text list).
 */
export default function TagColorSwatchPicker({
  value,
  onChange,
  disabled = false,
  className = '',
  menuZClass = 'z-[120]',
  /** `sm` = compact header toolbars (Tags modal). */
  size = 'md',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const safeValue = TAG_PALETTE_MAP[value] ? value : 'mint';
  const dotClass = TAG_SWATCH_DOT_CLASS[safeValue] || TAG_SWATCH_DOT_CLASS.mint;
  const sm = size === 'sm';

  const pickRandom = useCallback(() => {
    const k = TAG_PALETTE_KEYS[Math.floor(Math.random() * TAG_PALETTE_KEYS.length)];
    onChange(k);
  }, [onChange]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative flex items-center min-w-0 ${sm ? 'gap-1' : 'gap-1.5'} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          pickRandom();
        }}
        className={
          sm
            ? 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-amber-400/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 disabled:opacity-40 disabled:pointer-events-none shrink-0'
            : 'inline-flex items-center justify-center w-9 h-9 rounded-lg border border-amber-400/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 disabled:opacity-40 disabled:pointer-events-none shrink-0'
        }
        title="สุ่มสี"
        aria-label="สุ่มสี"
      >
        <PaintBucket size={sm ? 14 : 18} strokeWidth={2} />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={
          sm
            ? 'inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-700/80 disabled:opacity-40 disabled:pointer-events-none min-w-0'
            : 'inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/80 disabled:opacity-40 disabled:pointer-events-none min-w-0'
        }
        title="เลือกสี"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span
          className={`inline-block rounded-full shrink-0 ${
            sm
              ? `w-4 h-4 ring-1 ring-slate-300/80 dark:ring-slate-600 ${dotClass}`
              : `w-6 h-6 ring-2 ring-slate-300/80 dark:ring-slate-600 ${dotClass}`
          }`}
          aria-hidden
        />
        <ChevronDown size={sm ? 14 : 16} className="text-slate-500 dark:text-slate-400 shrink-0" />
      </button>
      {open && !disabled && (
        <div
          className={`absolute top-full left-0 mt-1 ${menuZClass} w-[min(320px,calc(100vw-3rem))] max-h-[min(50vh,280px)] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-xl ${sm ? 'p-1.5' : 'p-2'}`}
          role="listbox"
        >
          <div className={`grid grid-cols-8 ${sm ? 'gap-1.5' : 'gap-2'}`}>
            {TAG_PALETTE_KEYS.map((k) => {
              const dc = TAG_SWATCH_DOT_CLASS[k] || 'bg-slate-400';
              const selected = k === safeValue;
              return (
                <button
                  key={k}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={formatPaletteOptionLabel(k)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(k);
                    setOpen(false);
                  }}
                  className={`${sm ? 'w-6 h-6' : 'w-7 h-7'} rounded-full mx-auto transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-500 ${dc} ${
                    selected ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ring-blue-500' : 'ring-1 ring-slate-300/60 dark:ring-slate-600'
                  }`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
