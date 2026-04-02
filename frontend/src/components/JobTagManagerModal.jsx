import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import { jobTagPillClasses, TAG_PALETTE_KEYS, TAG_SWATCH_DOT_CLASS } from '../utils/tagPalette';

const normalizeTagEntry = (t) => {
  const name = String(t?.tag ?? t?.name ?? '').trim();
  if (!name) return null;
  const rawColor = t?.tagColor ?? t?.color ?? null;
  const c = rawColor ? String(rawColor).trim() : null;
  return { tag: name, tagColor: c || null };
};

const getJobTagsArray = (job) => {
  const raw = Array.isArray(job?.tags) ? job.tags : [];
  const normalized = raw.map(normalizeTagEntry).filter(Boolean);
  if (normalized.length) return normalized;
  if (job?.tag) return [{ tag: String(job.tag).trim(), tagColor: job.tagColor ?? null }];
  return [];
};

export default function JobTagManagerModal({ jobId, onClose }) {
  const jobs = useTestStore((s) => s.jobs) || [];
  const updateJobTags = useTestStore((s) => s.updateJobTags);

  const job = useMemo(() => jobs.find((j) => j.id === jobId) || null, [jobs, jobId]);

  const [draft, setDraft] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('mint');
  const [editingIndex, setEditingIndex] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    setDraft(getJobTagsArray(job));
    setNewName('');
    setNewColor(job?.tagColor || 'mint');
    setEditingIndex(null);
  }, [jobId, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTagHistory = useMemo(() => {
    const freq = new Map();
    for (const j of jobs || []) {
      const tags = getJobTagsArray(j);
      for (const t of tags) {
        const k = `${t.tag}__${t.tagColor || ''}`;
        const cur = freq.get(k) || { tag: t.tag, tagColor: t.tagColor || null, count: 0 };
        cur.count += 1;
        freq.set(k, cur);
      }
    }
    return Array.from(freq.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [jobs]);

  const pickColor = (k) => (TAG_SWATCH_DOT_CLASS[k] ? k : 'mint');

  const startEdit = (idx) => {
    const t = draft[idx];
    if (!t) return;
    setEditingIndex(idx);
    setNewName(t.tag || '');
    setNewColor(pickColor(t.tagColor || 'mint'));
  };

  const applyEdit = () => {
    const name = String(newName || '').trim();
    if (!name) return;
    const color = pickColor(newColor);
    setDraft((prev) => {
      const next = [...prev];
      if (editingIndex == null) next.push({ tag: name, tagColor: color });
      else if (next[editingIndex]) next[editingIndex] = { tag: name, tagColor: color };

      const seen = new Set();
      return next.filter((t) => {
        const k = `${t.tag}__${t.tagColor || ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });
    setEditingIndex(null);
    setNewName('');
    setNewColor('mint');
  };

  const removeIdx = (idx) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setNewName('');
      setNewColor('mint');
    }
  };

  const addFromHistory = (t) => {
    if (!t?.tag) return;
    const name = String(t.tag).trim();
    if (!name) return;
    const color = pickColor(t.tagColor || 'mint');
    setDraft((prev) => {
      const next = [...prev, { tag: name, tagColor: color }];
      const seen = new Set();
      return next.filter((x) => {
        const k = `${x.tag}__${x.tagColor || ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });
  };

  const save = () => {
    if (!jobId) return;
    updateJobTags(jobId, draft);
    onClose?.();
  };

  if (!jobId) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/50" onClick={() => onClose?.()}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              Manage tags {job ? `— ${job.name || `Set #${job.id}`}` : ''}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Add multiple tags to one set. The first tag is used as the “display tag”.
            </div>
          </div>
          <button type="button" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" onClick={() => onClose?.()}>
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Current tags</div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">Click a tag to edit</div>
                </div>
                {draft.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                    No tags yet. Add one below.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {draft.map((t, idx) => (
                      <div key={`${t.tag}-${idx}`} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border ${jobTagPillClasses(t.tagColor)}`}>
                        <button type="button" className="text-[11px] font-bold max-w-[220px] truncate" onClick={() => startEdit(idx)} title="Edit tag">
                          {t.tag}
                        </button>
                        {idx === 0 && <span className="text-[10px] font-semibold opacity-70">(display)</span>}
                        <button type="button" className="ml-1 text-[12px] font-bold opacity-70 hover:opacity-100" onClick={() => removeIdx(idx)} title="Remove">
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {editingIndex == null ? 'Add tag' : 'Edit tag'}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Tag name…"
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    list="job-tag-history"
                  />
                  <button
                    type="button"
                    onClick={applyEdit}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                    disabled={!String(newName || '').trim()}
                  >
                    {editingIndex == null ? 'Add' : 'Update'}
                  </button>
                </div>
                <datalist id="job-tag-history">
                  {allTagHistory.map((t) => (
                    <option key={`${t.tag}__${t.tagColor || ''}`} value={t.tag} />
                  ))}
                </datalist>

                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Color</div>
                <div className="flex flex-wrap gap-2">
                  {TAG_PALETTE_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setNewColor(k)}
                      className={`w-7 h-7 rounded-full border ${
                        newColor === k ? 'ring-2 ring-blue-500 border-blue-400' : 'border-slate-200 dark:border-slate-700'
                      } ${TAG_SWATCH_DOT_CLASS[k] || 'bg-emerald-500'}`}
                      title={k}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 h-full flex flex-col">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tag history</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Click to add an existing tag.</div>
                <div className="mt-3 flex-1 overflow-y-auto pr-1">
                  <div className="flex flex-wrap gap-2">
                    {allTagHistory.length === 0 ? (
                      <div className="text-sm text-slate-400">No history yet.</div>
                    ) : (
                      allTagHistory.slice(0, 80).map((t) => (
                        <button
                          key={`${t.tag}__${t.tagColor || ''}`}
                          type="button"
                          onClick={() => addFromHistory(t)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold ${jobTagPillClasses(t.tagColor)}`}
                          title={`Used ${t.count} time(s)`}
                        >
                          <span className="truncate max-w-[170px]">{t.tag}</span>
                          <span className="opacity-60">({t.count})</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => onClose?.()}
          >
            Cancel
          </button>
          <button type="button" className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

