import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTestStore } from '../store/useTestStore';
import {
  buildLibraryFileReplaceImpact,
  getSetJobStatusPillClass,
} from '../utils/libraryFileReplaceImpact';

const UploadChoiceModal = ({ open, prepared = [], onConfirm, onCancel, extraTestCaseLists = [] }) => {
  const [choices, setChoices] = useState({});
  const [ackReplace, setAckReplace] = useState(false);

  const savedTestCases = useTestStore((s) => s.savedTestCases);
  const globalSavedTestCases = useTestStore((s) => s.globalSavedTestCases);
  const savedTestCaseSets = useTestStore((s) => s.savedTestCaseSets);
  const jobs = useTestStore((s) => s.jobs);

  const mergedSavedTestCases = useMemo(
    () => [...(savedTestCases || []), ...(globalSavedTestCases || [])],
    [savedTestCases, globalSavedTestCases]
  );

  const impactContext = useMemo(
    () => ({
      savedTestCases: mergedSavedTestCases,
      savedTestCaseSets,
      jobs,
      extraTestCaseLists,
    }),
    [mergedSavedTestCases, savedTestCaseSets, jobs, extraTestCaseLists]
  );

  const impactsByChoiceKey = useMemo(() => {
    const out = {};
    prepared.forEach((p) => {
      if (!p.existing) return;
      const lookupName = p.existing.name || p.file.name;
      out[p.file.name] = buildLibraryFileReplaceImpact(lookupName, impactContext);
    });
    return out;
  }, [prepared, impactContext]);

  useEffect(() => {
    if (!open || !prepared.length) return;
    const initial = {};
    prepared.forEach((p) => {
      initial[p.file.name] = p.existing ? 'reuse' : 'upload';
    });
    setChoices(initial);
    setAckReplace(false);
  }, [open, prepared]);

  const setChoice = useCallback((fileName, value) => {
    setChoices((prev) => ({ ...prev, [fileName]: value }));
    setAckReplace(false);
  }, []);

  const rowsNeedingAck = useMemo(() => {
    return prepared.filter((p) => {
      if (!p.existing) return false;
      if ((choices[p.file.name] || 'reuse') !== 'upload') return false;
      const imp = impactsByChoiceKey[p.file.name];
      return imp?.needsConfirmAck;
    });
  }, [prepared, choices, impactsByChoiceKey]);

  const mustAck = rowsNeedingAck.length > 0;
  const confirmDisabled = mustAck && !ackReplace;

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm(choices);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={onCancel}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 max-w-xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-600">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">Upload Choice</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            For each file that already exists in the Library, choose whether to reuse the stored copy or upload a new
            one. If you upload a new file, references below show where the current library copy is used.
          </p>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {prepared.map((p) => {
            const choiceKey = p.file.name;
            const choice = p.existing ? choices[choiceKey] || 'reuse' : 'upload';
            const impact = impactsByChoiceKey[choiceKey];
            const showImpact = p.existing && choice === 'upload' && impact?.hasAnyUsage;

            return (
              <div
                key={choiceKey}
                className="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-slate-800 dark:text-white truncate flex-1 min-w-0" title={choiceKey}>
                    {choiceKey}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {p.existing ? (
                      <>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`choice-${choiceKey}`}
                            checked={choice === 'reuse'}
                            onChange={() => setChoice(choiceKey, 'reuse')}
                            className="w-4 h-4 text-blue-600"
                          />
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Reuse existing file</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`choice-${choiceKey}`}
                            checked={choice === 'upload'}
                            onChange={() => setChoice(choiceKey, 'upload')}
                            className="w-4 h-4 text-blue-600"
                          />
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Upload new file</span>
                        </label>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">Upload new file (not in Library)</span>
                    )}
                  </div>
                </div>

                {showImpact && (
                  <div className="mt-1 pt-2 border-t border-slate-200 dark:border-slate-600 space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      The library copy of this file is referenced elsewhere. Are you sure you want to upload a new
                      version?
                    </p>

                    {impact.jobRows.length > 0 && (
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200 mb-1">Saved jobs</div>
                        <ul className="flex flex-wrap gap-1.5">
                          {impact.jobRows.map((row) => (
                            <li
                              key={`${choiceKey}-job-${row.name}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${getSetJobStatusPillClass(row.status)}`}
                              title={row.status ? `Job status: ${row.status}` : 'No recent run status for this name'}
                            >
                              <span className="truncate max-w-[200px]">{row.name}</span>
                              {row.status && <span className="opacity-80">({row.status})</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {impact.tcRows.length > 0 && (
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200 mb-1">Test cases</div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {impact.tcRows.map((row) => (
                            <li key={`${choiceKey}-tc-${row.name}-${row.context}`}>
                              <span className="font-medium">{row.name}</span>
                              {row.context === 'Current (from table)' ? (
                                <span className="text-slate-500 dark:text-slate-400"> — unsaved draft on this page</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400"> — job: {row.context}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {impact.queueTcRows.length > 0 && (
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200 mb-1">Also seen on Jobs list</div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {impact.queueTcRows.map((row) => (
                            <li key={`${choiceKey}-qj-${row.name}-${row.jobName}`}>
                              <span className="font-medium">{row.name}</span>
                              {row.jobName ? (
                                <span className="text-slate-500 dark:text-slate-400"> — job: {row.jobName}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(impact.hasRunningOrPending || impact.hasCompleted || impact.hasError) && (
                      <div className="rounded-md bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 p-2 space-y-1 text-[11px] leading-snug text-amber-950 dark:text-amber-100">
                        {impact.hasRunningOrPending && (
                          <p>
                            <strong>Running or queued jobs:</strong> boards may already be using a copy from the
                            current run. Uploading a new library file does not change files already deployed for that
                            run. Future runs will pick up the new content, so comparing results across runs can be
                            misleading if the same filename points at different data.
                          </p>
                        )}
                        {impact.hasCompleted && (
                          <p>
                            <strong>Completed jobs:</strong> past results and logs stay tied to the version that ran.
                            Re-running the same job or building a new run from the same saved definition will load the
                            new library file, which may differ from what earlier completed runs used.
                          </p>
                        )}
                        {impact.hasError && (
                          <p>
                            <strong>Jobs with failures:</strong> replacing the file does not change archived logs. Fix
                            the underlying issue in the new file before relying on a re-run.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {mustAck && (
            <label className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/25 cursor-pointer">
              <input
                type="checkbox"
                checked={ackReplace}
                onChange={(e) => setAckReplace(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-blue-600 shrink-0"
              />
              <span className="text-xs text-amber-950 dark:text-amber-100 leading-snug">
                I have read where this file is used and I understand the impact on jobs and test cases. I still want to
                upload a new file to the Library for the selected rows.
              </span>
            </label>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-600 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default UploadChoiceModal;
