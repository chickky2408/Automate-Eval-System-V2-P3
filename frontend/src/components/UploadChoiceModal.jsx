import React, { useEffect, useState } from 'react';

const UploadChoiceModal = ({ open, prepared = [], onConfirm, onCancel }) => {
  const [choices, setChoices] = useState({});

  useEffect(() => {
    if (!open || !prepared.length) return;
    const initial = {};
    prepared.forEach((p) => {
      initial[p.file.name] = p.existing ? 'reuse' : 'upload';
    });
    setChoices(initial);
  }, [open, prepared]);

  const setChoice = (fileName, value) => setChoices((prev) => ({ ...prev, [fileName]: value }));

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 max-w-lg w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-600">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">Upload Choice</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Select each file to reuse the existing file in the Library or upload a new file</p>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {prepared.map((p) => (
            <div key={p.file.name} className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600">
              <span className="text-sm font-medium text-slate-800 dark:text-white truncate flex-1 min-w-0" title={p.file.name}>{p.file.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                {p.existing ? (
                  <>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name={`choice-${p.file.name}`} checked={(choices[p.file.name] || 'reuse') === 'reuse'} onChange={() => setChoice(p.file.name, 'reuse')} className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Reuse existing file</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name={`choice-${p.file.name}`} checked={choices[p.file.name] === 'upload'} onChange={() => setChoice(p.file.name, 'upload')} className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Upload new file</span>
                    </label>
                  </>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">Upload new file (not in Library)</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-600 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500">Cancel</button>
          <button type="button" onClick={() => onConfirm(choices)} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">Confirm</button>
        </div>
      </div>
    </div>
  );
};

export default UploadChoiceModal;

