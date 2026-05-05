import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowDown, ArrowUp, Download, FileCode, Play, Search, StopCircle } from 'lucide-react';

const formatTestCaseDisplayNameRaw = (raw) => {
  if (!raw || raw === 'N/A') return raw || 'N/A';
  const ext = raw.split('.').pop()?.toLowerCase();
  if (['vcd', 'erom', 'ulp', 'bin', 'hex', 'elf'].includes(ext) && raw.includes('.')) return raw.slice(0, -ext.length - 1);
  return raw;
};

const TestCasesProgressView = ({
  job,
  files,
  filter,
  search,
  onFilterChange,
  onSearchChange,
  onStopFile,
  onRerunFile,
  onRerunFailedFile,
  onReorderFile, // optional: (fromFileId, toFileId). Parent controls allowed statuses (typically pending TCs in pending/running jobs).
  onOpenInLibrary, // open in File Library (legacy)
  onOpenInTestCasesLibrary, // Jobs → TC Library tab: pulse + scroll to matching saved test case row
  onDeleteFile, // remove pending/stopped test cases from this batch only
  // Report: Download report in list header (per-row report checkboxes still drive "selected" count)
  onReportDownload,
  reportSelectedCount = 0,
  /** When Jobs page shows all Kanban columns at once, use a denser row (name + tooltip) so cards stay readable */
  compactKanbanDetails = false,
}) => {
  const runningFileRef = useRef(null);
  const [selectedFileIds, setSelectedFileIds] = useState([]);

  const getTestCaseDisplayName = (file) => formatTestCaseDisplayNameRaw(file?.testCaseName || (file?.order != null ? `Test case ${file.order}` : '—'));

  const getFileAttachmentsTooltip = (file) => {
    const lines = [];
    if (file.vcd) lines.push(`VCD: ${file.vcd}`);
    if (file.erom) lines.push(`ERoM: ${file.erom}`);
    if (file.ulp) lines.push(`ULP: ${file.ulp}`);
    return lines.length ? lines.join('\n') : '';
  };

  // Filter and search files
  const filteredFiles = files.filter(file => {
    // Status filter
    if (filter !== 'all' && file.status !== filter) return false;
    // Search filter - search in test case name, VCD, ERoM, ULP file names
    if (search) {
      const searchLower = search.toLowerCase();
      const testCaseNameMatch = file.testCaseName?.toLowerCase().includes(searchLower);
      const vcdMatch = file.vcd?.toLowerCase().includes(searchLower);
      const eromMatch = file.erom?.toLowerCase().includes(searchLower);
      const ulpMatch = file.ulp?.toLowerCase().includes(searchLower);
      const nameMatch = file.name?.toLowerCase().includes(searchLower);
      const tagMatch = (file.tag || file.testCaseTag || '').toString().toLowerCase().includes(searchLower);
      if (!testCaseNameMatch && !vcdMatch && !eromMatch && !ulpMatch && !nameMatch && !tagMatch) return false;
    }
    return true;
  });
  
  // Statistics
  const stats = {
    total: files.length,
    completed: files.filter(f => f.status === 'completed').length,
    running: files.filter(f => f.status === 'running').length,
    pending: files.filter(f => f.status === 'pending').length,
    failed: files.filter(f => f.result === 'fail').length,
    stopped: files.filter(f => f.status === 'stopped').length
  };
  
  const isPendingTc = (f) => String(f?.status || '').toLowerCase() === 'pending';

  // Find current running test case
  const currentRunningIndex = filteredFiles.findIndex(f => f.status === 'running');
  
  // Auto-scroll to running test case
  useEffect(() => {
    if (currentRunningIndex >= 0 && runningFileRef.current) {
      setTimeout(() => {
        runningFileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [currentRunningIndex]);
  
  return (
  <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
      <div className={compactKanbanDetails ? 'w-full min-w-0 p-3 sm:p-4' : 'p-4 sm:p-6 max-w-6xl mx-auto'}>
        {/* Summary: boards + test case counts (job name shown on outer card) */}
        <div className={compactKanbanDetails ? 'mb-3' : 'mb-4'}>
          <div className={`flex items-center gap-2 sm:gap-3 text-xs text-slate-600 dark:text-slate-300 flex-wrap ${compactKanbanDetails ? 'mb-2' : 'mb-3'}`}>
                <span className="text-slate-600 dark:text-slate-300">
                  Boards:{' '}
                  <strong className="text-slate-800 dark:text-slate-100">{job.boards?.join(', ') || '—'}</strong>
                  <span className="mx-2 text-slate-400 dark:text-slate-600">·</span>
                  Test cases:{' '}
                  <strong className="text-slate-800 dark:text-slate-100">
                    {job.completedFiles}/{job.totalFiles}
                  </strong>
                </span>
                {(job.completedAt || job.startedAt) && (
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded text-xs font-semibold">
                    {(() => {
                      const date = job.completedAt ? new Date(job.completedAt) : new Date(job.startedAt);
                      const now = new Date();
                      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                      const jobDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                      if (jobDate.getTime() === today.getTime()) {
                        return `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
                      }
                      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
                    })()}
                  </span>
                )}
              </div>
          {/* Statistics: full grid when one column; flex-wrap when All columns so labels are never "T.." */}
          <div
            className={
              compactKanbanDetails
                ? 'flex flex-wrap gap-2 mb-2'
                : 'grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3'
            }
          >
                <div
                  className={
                    compactKanbanDetails
                      ? 'bg-white dark:bg-slate-900 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm min-w-[4.75rem] flex-[1_1_5rem] text-center'
                      : 'bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm shadow-slate-900/40 min-w-0'
                  }
                >
                  <div
                    className={
                      compactKanbanDetails
                        ? 'text-[9px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-wide leading-tight'
                        : 'text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-tight truncate'
                    }
                    title="Total"
                  >
                    Total
                  </div>
                  <div className={`font-bold text-slate-900 dark:text-slate-100 tabular-nums ${compactKanbanDetails ? 'text-base mt-0.5' : 'text-lg'}`}>{files.length}</div>
                </div>
                <div
                  className={
                    compactKanbanDetails
                      ? 'bg-emerald-50 dark:bg-slate-900 px-2 py-2 rounded-lg border border-emerald-200 dark:border-emerald-600 shadow-sm min-w-[4.75rem] flex-[1_1_5rem] text-center'
                      : 'bg-emerald-50 dark:bg-slate-900 p-2 rounded-lg border border-emerald-200 dark:border-emerald-600 shadow-sm shadow-slate-950/40 min-w-0'
                  }
                >
                  <div
                    className={
                      compactKanbanDetails
                        ? 'text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide leading-tight'
                        : 'text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-tight truncate'
                    }
                    title="Done"
                  >
                    Done
                  </div>
                  <div className={`font-bold text-emerald-700 dark:text-emerald-300 tabular-nums ${compactKanbanDetails ? 'text-base mt-0.5' : 'text-lg'}`}>{files.filter(f => f.status === 'completed').length}</div>
                </div>
                <div
                  className={
                    compactKanbanDetails
                      ? 'bg-blue-50 dark:bg-slate-900 px-2 py-2 rounded-lg border border-blue-200 dark:border-blue-600 shadow-sm min-w-[4.75rem] flex-[1_1_5rem] text-center'
                      : 'bg-blue-50 dark:bg-slate-900 p-2 rounded-lg border border-blue-200 dark:border-blue-600 shadow-sm shadow-slate-950/40 min-w-0'
                  }
                >
                  <div
                    className={
                      compactKanbanDetails
                        ? 'text-[9px] font-bold text-blue-700 dark:text-sky-400 uppercase tracking-wide leading-tight'
                        : 'text-[10px] font-bold text-blue-700 dark:text-sky-400 uppercase tracking-tight truncate'
                    }
                    title="Run"
                  >
                    Run
                  </div>
                  <div className={`font-bold text-blue-700 dark:text-sky-300 tabular-nums ${compactKanbanDetails ? 'text-base mt-0.5' : 'text-lg'}`}>{files.filter(f => f.status === 'running').length}</div>
                </div>
                <div
                  className={
                    compactKanbanDetails
                      ? 'bg-yellow-50 dark:bg-amber-950/35 px-2 py-2 rounded-lg border border-yellow-200 dark:border-amber-700/60 shadow-sm min-w-[4.75rem] flex-[1_1_5rem] text-center'
                      : 'bg-yellow-50 dark:bg-amber-950/35 p-2 rounded-lg border border-yellow-200 dark:border-amber-700/60 min-w-0'
                  }
                >
                  <div
                    className={
                      compactKanbanDetails
                        ? 'text-[9px] font-bold text-yellow-600 dark:text-amber-300 uppercase tracking-wide leading-tight'
                        : 'text-[10px] font-bold text-yellow-600 dark:text-amber-300 uppercase tracking-tight truncate'
                    }
                    title="Pending"
                  >
                    Pending
                  </div>
                  <div className={`font-bold text-yellow-700 dark:text-amber-200 tabular-nums ${compactKanbanDetails ? 'text-base mt-0.5' : 'text-lg'}`}>{files.filter(f => f.status === 'pending').length}</div>
                </div>
                <div
                  className={
                    compactKanbanDetails
                      ? 'bg-red-50 dark:bg-red-950/35 px-2 py-2 rounded-lg border border-red-200 dark:border-red-800/60 shadow-sm min-w-[4.75rem] flex-[1_1_5rem] text-center'
                      : 'bg-red-50 dark:bg-red-950/35 p-2 rounded-lg border border-red-200 dark:border-red-800/60 min-w-0'
                  }
                >
                  <div
                    className={
                      compactKanbanDetails
                        ? 'text-[9px] font-bold text-red-600 dark:text-red-300 uppercase tracking-wide leading-tight'
                        : 'text-[10px] font-bold text-red-600 dark:text-red-300 uppercase tracking-tight truncate'
                    }
                    title="Failed"
                  >
                    Failed
                  </div>
                  <div className={`font-bold text-red-700 dark:text-red-200 tabular-nums ${compactKanbanDetails ? 'text-base mt-0.5' : 'text-lg'}`}>{files.filter(f => f.result === 'fail').length}</div>
                </div>
                <div
                  className={
                    compactKanbanDetails
                      ? 'bg-slate-50 dark:bg-slate-800/80 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-600 min-w-[4.75rem] flex-[1_1_5rem] text-center'
                      : 'bg-slate-50 dark:bg-slate-800/80 p-2 rounded-lg border border-slate-200 dark:border-slate-600 min-w-0'
                  }
                >
                  <div
                    className={
                      compactKanbanDetails
                        ? 'text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide leading-tight'
                        : 'text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-tight truncate'
                    }
                    title="Stop"
                  >
                    Stop
                  </div>
                  <div className={`font-bold text-slate-700 dark:text-slate-200 tabular-nums ${compactKanbanDetails ? 'text-base mt-0.5' : 'text-lg'}`}>{files.filter(f => f.status === 'stopped').length}</div>
                </div>
              </div>
          {/* Overall progress bar removed per UX request */}

          {/* Search and Filter — compact: search + filter บรรทัดเดียวเหมือนมุมมองคอลัมน์เดียว */}
          <div className={`flex gap-2 sm:gap-3 items-stretch min-w-0 ${compactKanbanDetails ? 'flex-wrap' : 'items-center'}`}>
            <div className={`min-w-0 relative ${compactKanbanDetails ? 'flex-1 basis-[min(100%,12rem)]' : 'flex-1'}`}>
              <Search size={compactKanbanDetails ? 16 : 18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by name or tag..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className={`w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  compactKanbanDetails ? 'pl-9 pr-3 py-1.5 text-xs' : 'pl-10 pr-4 py-2 text-sm'
                }`}
              />
            </div>
            {(job.status || '').toLowerCase() !== 'pending' ? (
            <select
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              className={`shrink-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${compactKanbanDetails ? 'min-w-[8.5rem] px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="stopped">Stopped</option>
            </select>
            ) : compactKanbanDetails ? (
            <div
              className="shrink-0 min-w-[8.5rem] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100/90 dark:bg-slate-800/90 text-xs font-bold text-slate-500 dark:text-slate-400 text-center select-none"
              title="Job not started — all test cases are pending"
            >
              Pending only
            </div>
            ) : null}
            {/* Actions for selected test cases */}
            {selectedFileIds.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Stop Selected (running or pending) */}
                <button
                  onClick={async () => {
                    const runningSelected = filteredFiles.filter(f => 
                      selectedFileIds.includes(f.id) && (f.status === 'running' || f.status === 'pending')
                    );
                    if (runningSelected.length === 0) return;
                    if (window.confirm(`Stop ${runningSelected.length} selected test case(s)?`)) {
                      await Promise.all(runningSelected.map(file => onStopFile(file.id)));
                      setSelectedFileIds([]);
                    }
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition-all flex items-center gap-2"
                  title={`Stop ${selectedFileIds.length} selected test case(s)`}
                >
                  <StopCircle size={16} />
                  Stop Selected ({selectedFileIds.length})
                </button>

                {/* Delete from batch (pending or stopped) */}
                <button
                  onClick={async () => {
                    const removableSelected = filteredFiles.filter(f =>
                      selectedFileIds.includes(f.id) && (f.status === 'pending' || f.status === 'stopped')
                    );
                    if (removableSelected.length === 0) return;
                    if (!window.confirm(`Remove ${removableSelected.length} pending/stopped test case(s) from this job? (Will not delete files or library data)`)) {
                      return;
                    }
                    await Promise.all(removableSelected.map(file => onDeleteFile?.(file.id)));
                    setSelectedFileIds([]);
                  }}
                  className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg text-sm font-bold hover:bg-slate-300 transition-all flex items-center gap-2"
                  title="Remove selected pending/stopped test cases from this job (does not delete from Library)"
                >
                  Remove from set
                </button>

                {/* Re-run Selected (stopped only) */}
                {onRerunFile && filteredFiles.some(f => selectedFileIds.includes(f.id) && f.status === 'stopped') && (
                  <button
                    onClick={async () => {
                      const stoppedSelected = filteredFiles.filter(f => 
                        selectedFileIds.includes(f.id) && f.status === 'stopped'
                      );
                      if (stoppedSelected.length === 0) return;
                      for (const file of stoppedSelected) onRerunFile(file.id);
                      setSelectedFileIds([]);
                    }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
                    title="Re-run selected stopped test case(s)"
                  >
                    <Play size={16} />
                    Re-run Selected ({filteredFiles.filter(f => selectedFileIds.includes(f.id) && f.status === 'stopped').length})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Test Cases List */}
        <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 shadow-sm dark:shadow-slate-950/40 ${compactKanbanDetails ? 'rounded-lg' : 'rounded-xl'}`}>
          {/* Select All Header (if there are files) */}
          {filteredFiles.length > 0 && (
            <div className={`bg-slate-50 dark:bg-slate-800/95 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between flex-wrap gap-2 ${compactKanbanDetails ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedFileIds.length === filteredFiles.length && filteredFiles.length > 0}
                  onChange={() => {
                    if (selectedFileIds.length === filteredFiles.length) {
                      setSelectedFileIds([]);
                    } else {
                      setSelectedFileIds(filteredFiles.map(f => f.id));
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-500 dark:bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  title="Select all test cases"
                />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {selectedFileIds.length > 0 
                    ? `${selectedFileIds.length} of ${filteredFiles.length} selected`
                    : `Select All (${filteredFiles.length} test cases)`}
                </span>
              </div>
              {typeof onReportDownload === 'function' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onReportDownload?.()}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Download size={12} />
                    Download report {reportSelectedCount > 0 ? `(${reportSelectedCount} selected)` : '(all)'}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="max-h-[600px] overflow-y-auto">
            {filteredFiles.length === 0 ? (
              <div className="p-12 text-center text-slate-400 dark:text-slate-500">
                <FileCode size={48} className="mx-auto mb-4 opacity-50" />
                <p>No test cases found</p>
                {search && <p className="text-xs mt-2">Try adjusting your search or filter</p>}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-600/80">
                {filteredFiles.map((file, index) => {
                  const isRunning = file.status === 'running';
                  const isFailed = file.result === 'fail' || file.status === 'error';
                  const fileIndex = files.findIndex(f => f.id === file.id);
                  const rowCanDrag = !!(onReorderFile && isPendingTc(file));
                  return (
                    <div
                      key={file.id}
                      draggable={rowCanDrag}
                      data-drop-index={index}
                      onDragStart={(e) => {
                        if (!onReorderFile || !isPendingTc(file)) return;
                        e.dataTransfer.setData(
                          'application/json',
                          JSON.stringify({ type: 'jobFile', fromFileId: file.id })
                        );
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (!onReorderFile) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const canDropHere = isPendingTc(filteredFiles[index]);
                        e.dataTransfer.dropEffect = canDropHere ? 'move' : 'none';
                      }}
                      onDrop={(e) => {
                        if (!onReorderFile) return;
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const raw = e.dataTransfer.getData('application/json');
                          if (!raw) return;
                          const data = JSON.parse(raw);
                          if (data.type !== 'jobFile' || !data.fromFileId) return;
                          const toFile = filteredFiles[index];
                          if (!toFile || !isPendingTc(toFile)) return;
                          if (data.fromFileId !== toFile.id) {
                            onReorderFile(data.fromFileId, toFile.id);
                          }
                        } catch (_) {}
                      }}
                      ref={isRunning ? runningFileRef : null}
                      title={rowCanDrag ? 'Drag to reorder (pending queue only)' : undefined}
                      className={`${compactKanbanDetails ? 'p-2' : 'p-4'} transition-all ${rowCanDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${
                        isRunning 
                          ? `bg-blue-50 dark:bg-blue-950/35 border-blue-500 ${compactKanbanDetails ? 'border-l-[3px]' : 'border-l-4'}` 
                          : selectedFileIds.includes(file.id)
                          ? 'bg-blue-50/50 dark:bg-blue-950/25 border-l-2 border-blue-300 dark:border-blue-500'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/35'
                      }`}
                    >
                      {(() => {
                        const openLibrary = () => {
                          if (onOpenInTestCasesLibrary) {
                            onOpenInTestCasesLibrary({
                              name: file.testCaseName || getTestCaseDisplayName(file),
                              vcdName: file.vcd || file.vcdName,
                              binName: file.erom || file.binName,
                              linName: file.ulp || file.linName,
                            });
                          } else if (onOpenInLibrary) {
                            onOpenInLibrary(file.vcd || file.erom || file.ulp || file.name);
                          }
                        };
                        const attachTooltip = getFileAttachmentsTooltip(file);
                        const attachCount = [file.vcd, file.erom, file.ulp].filter(Boolean).length;
                        const nameTitle = [getTestCaseDisplayName(file), attachTooltip].filter(Boolean).join('\n\n');

                        if (compactKanbanDetails) {
                          return (
                      <div className="flex items-center gap-1.5 min-w-0 w-full">
                        <input
                          type="checkbox"
                          checked={selectedFileIds.includes(file.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedFileIds(prev => 
                              prev.includes(file.id)
                                ? prev.filter(id => id !== file.id)
                                : [...prev, file.id]
                            );
                          }}
                          className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-500 dark:bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                          title="Select this test case"
                        />
                        <div className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold leading-none ${
                          isRunning 
                            ? 'bg-blue-500 text-white animate-pulse' 
                            : file.status === 'completed'
                            ? 'bg-emerald-500 text-white'
                            : file.status === 'stopped'
                            ? 'bg-red-500 text-white'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                        }`}>
                          {file.order || fileIndex + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 min-w-0 flex-wrap">
                            <button
                              type="button"
                              className="flex items-center gap-0.5 min-w-0 max-w-full group text-left"
                              onClick={openLibrary}
                              title={nameTitle}
                            >
                              <FileCode size={12} className="text-blue-500 shrink-0" />
                              <span className="font-semibold text-slate-800 dark:text-slate-100 text-[11px] leading-snug truncate group-hover:underline">
                                {getTestCaseDisplayName(file)}
                              </span>
                            </button>
                            {attachCount > 0 && (
                              <span
                                className="shrink-0 text-[9px] font-semibold px-1 py-px rounded bg-slate-200/80 dark:bg-slate-700/90 text-slate-600 dark:text-slate-300 tabular-nums"
                                title={attachTooltip || undefined}
                              >
                                ×{attachCount}
                              </span>
                            )}
                          </div>
                          <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                            #{file.order || fileIndex + 1}/{files.length}
                            {file.try_count && file.try_count > 1 ? ` · ${file.try_count}r` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                          {isRunning && (
                            <span
                              className="px-1.5 py-px bg-blue-500 text-white rounded text-[9px] font-bold animate-pulse whitespace-nowrap"
                              title="Running now"
                            >
                              RUN
                            </span>
                          )}
                          {!isRunning && (
                          <span className={`px-1.5 py-px rounded-full text-[9px] font-bold uppercase border whitespace-nowrap ${
                            file.status === 'completed' ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700' :
                            file.status === 'stopped' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-700' :
                            file.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-amber-950/45 dark:text-amber-200 dark:border-amber-700' :
                            'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700/80 dark:text-slate-200 dark:border-slate-500'
                          }`}>
                            {file.status}
                          </span>
                          )}
                          {file.result && (
                            <span className={`px-1.5 py-px rounded text-[9px] font-bold ${
                              file.result === 'pass' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' :
                              file.result === 'fail' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' :
                              'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                            }`}>
                              {file.result.toUpperCase()}
                            </span>
                          )}
                          {isFailed && onRerunFailedFile && (
                            <button
                              type="button"
                              onClick={() => onRerunFailedFile([file.id])}
                              className="p-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors inline-flex items-center justify-center"
                              title="Re-run failed test case"
                              aria-label="Re-run failed"
                            >
                              <Play size={12} />
                            </button>
                          )}
                          {isRunning && (
                            <button
                              type="button"
                              onClick={() => onStopFile(file.id)}
                              className="p-1 rounded-md bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors inline-flex items-center justify-center"
                              title="Stop"
                              aria-label="Stop"
                            >
                              <StopCircle size={14} strokeWidth={2.25} />
                            </button>
                          )}
                          {file.status === 'stopped' && onRerunFile && (
                            <button
                              type="button"
                              onClick={() => onRerunFile(file.id)}
                              className="p-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/35 transition-colors inline-flex items-center justify-center"
                              title="Re-run this test case"
                              aria-label="Re-run"
                            >
                              <Play size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                          );
                        }

                        return (
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Checkbox for selection */}
                        <input
                          type="checkbox"
                          checked={selectedFileIds.includes(file.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedFileIds(prev => 
                              prev.includes(file.id)
                                ? prev.filter(id => id !== file.id)
                                : [...prev, file.id]
                            );
                          }}
                          className="w-5 h-5 rounded border-slate-300 dark:border-slate-500 dark:bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          title="Select this test case"
                        />
                        
                        {/* Order Number */}
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                          isRunning 
                            ? 'bg-blue-500 text-white animate-pulse' 
                            : file.status === 'completed'
                            ? 'bg-emerald-500 text-white'
                            : file.status === 'stopped'
                            ? 'bg-red-500 text-white'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                        }`}>
                          {file.order || fileIndex + 1}
                        </div>
                        
                        {/* File Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap min-w-0">
                            {/* Test case display name (from set) or file name */}
                            <button
                              type="button"
                              className="flex items-center gap-1 min-w-0 max-w-full group"
                              onClick={openLibrary}
                              title={getTestCaseDisplayName(file)}
                            >
                              <FileCode size={18} className="text-blue-500 shrink-0" />
                              <span className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate group-hover:underline">
                                {getTestCaseDisplayName(file)}
                              </span>
                            </button>
                            {/* VCD/ERoM/ULP as secondary when different from display name */}
                            {file.vcd && (file.testCaseName !== file.vcd) && (
                              <div className="flex items-center gap-1 min-w-0 max-w-full text-xs text-slate-500 dark:text-slate-400">
                                <span>VCD: {file.vcd}</span>
                              </div>
                            )}
                            {file.erom && (
                              <div className="flex items-center gap-1 min-w-0 max-w-full text-xs text-slate-500 dark:text-slate-400">
                                <span className="text-slate-400 dark:text-slate-500 shrink-0">+</span>
                                <span title={file.erom}>{file.erom}</span>
                              </div>
                            )}
                            {file.ulp && (
                              <div className="flex items-center gap-1 min-w-0 max-w-full text-xs text-slate-500 dark:text-slate-400">
                                <span className="text-slate-400 dark:text-slate-500 shrink-0">+</span>
                                <span title={file.ulp}>{file.ulp}</span>
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Test Case #{file.order || fileIndex + 1} of {files.length}
                            {file.try_count && file.try_count > 1 && ` • ${file.try_count} rounds`}
                          </div>
                        </div>
                        
                        {/* สถานะ + ปุ่ม ริมขวา กลุ่มเดียว — จัดกึ่งกลางแนวตั้งของแถว (เหมือนมุมมอง compact) */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0 justify-end">
                          {isRunning && (
                            <span className="px-2 py-0.5 bg-blue-500 text-white rounded text-xs font-bold animate-pulse shrink-0 whitespace-nowrap">
                              RUNNING NOW
                            </span>
                          )}
                          {!isRunning && (
                          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase border-2 ${
                            file.status === 'completed' ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700' :
                            file.status === 'stopped' ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-700' :
                            file.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-amber-950/45 dark:text-amber-200 dark:border-amber-700' :
                            'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700/80 dark:text-slate-200 dark:border-slate-500'
                          }`}>
                            {file.status}
                          </span>
                          )}
                          {file.result && (
                            <span className={`px-3 py-1 rounded text-xs font-bold ${
                              file.result === 'pass' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' :
                              file.result === 'fail' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' :
                              'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                            }`}>
                              {file.result.toUpperCase()}
                            </span>
                          )}
                        {isFailed && onRerunFailedFile && (
                          <button
                            onClick={() => onRerunFailedFile([file.id])}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-1"
                            title="Re-run this failed test case (new job in Running)"
                          >
                            <Play size={14} />
                            Re-run
                          </button>
                        )}
                        {isRunning && (
                          <button
                            onClick={() => onStopFile(file.id)}
                            className="px-3 py-1.5 bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 rounded-lg text-xs font-bold hover:bg-red-200 dark:hover:bg-red-900/40 transition-all flex items-center gap-1"
                          >
                            <StopCircle size={14} />
                            Stop
                          </button>
                        )}
                        {file.status === 'stopped' && onRerunFile && (
                          <button
                            onClick={() => onRerunFile(file.id)}
                            className="px-3 py-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300 rounded-lg text-xs font-bold hover:bg-emerald-200 dark:hover:bg-emerald-900/35 transition-all flex items-center gap-1"
                            title="Re-run this test case"
                          >
                            <Play size={14} />
                            Re-run
                          </button>
                        )}
                        </div>
                      </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        
        {/* Current Running Indicator */}
        {currentRunningIndex >= 0 && (
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <Activity size={16} className="text-blue-600 dark:text-blue-400 animate-pulse shrink-0" />
              <span className="font-bold text-blue-700 dark:text-blue-200 min-w-0 truncate" title={getTestCaseDisplayName(filteredFiles[currentRunningIndex])}>
                Currently running: Test Case #{filteredFiles[currentRunningIndex].order || currentRunningIndex + 1} — {getTestCaseDisplayName(filteredFiles[currentRunningIndex])}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FileRow = ({ file, jobId, index, totalFiles, onStop, onRerun, onRerunFailed, onMoveUp, onMoveDown, onShowError, job, reportChecked, onToggleReport, onDownloadReport, fileLibraryInfo, onOpenInLibrary }) => {
  const getTestCaseDisplayName = (f) => formatTestCaseDisplayNameRaw(f?.testCaseName || (f?.order != null ? `Test case ${f.order}` : '—'));
  const getStatusColor = (status) => {
    switch(status) {
      case 'completed': return 'bg-emerald-100 text-emerald-700';
      case 'running': return 'bg-blue-100 text-blue-700';
      case 'stopped': return 'bg-red-100 text-red-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };
  
  const getResultColor = (result) => {
    if (result === 'pass') return 'bg-emerald-100 text-emerald-700';
    if (result === 'fail') return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-400';
  };
  
  const isFailed = file.result === 'fail' || file.status === 'error';
  
  const exportErrorLog = (e) => {
    e.stopPropagation();
    const errorLogContent = `Error Log - Test Case Failure Report
Generated: ${new Date().toISOString()}
========================================

Test Case Information:
- Test Case: ${getTestCaseDisplayName(file)}
- Order: ${file.order || index + 1}
- Status: ${file.status || 'unknown'}
- Result: ${file.result || 'N/A'}
- Job ID: ${jobId}
${job ? `- Job Name: ${job.name || 'N/A'}\n- Firmware: ${job.firmware || 'N/A'}\n- Boards: ${job.boards?.join(', ') || 'N/A'}` : ''}

Error Details:
${file.errorMessage || file.error || 'No detailed error message available. Test case failed during execution.'}

Execution Context:
- Test started at: ${file.startedAt || 'N/A'}
- Test completed at: ${file.completedAt || 'N/A'}
- Duration: ${file.duration || 'N/A'}

Possible Causes:
1. Test case logic error
2. Hardware connection issue
3. Firmware version mismatch
4. Test data corruption
5. Timeout during execution

Recommendations:
1. Check hardware connections
2. Verify firmware version compatibility
3. Review test case configuration
4. Check system logs for additional details
5. Re-run the test case after fixing issues

Additional Notes:
${file.notes || 'No additional notes available.'}
`;
    
    const blob = new Blob([errorLogContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeFileName = (file.name || `test_case_${index + 1}`).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `error_log_${jobId}_${safeFileName}_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <div className={`flex items-center gap-4 p-4 rounded-lg border transition-all min-w-0 ${
      isFailed ? 'bg-red-50 border-red-200 hover:border-red-300' : 'bg-white border-slate-200 hover:border-blue-300'
    }`}>
      {/* Report checkbox */}
      {typeof reportChecked === 'boolean' && onToggleReport && (
        <div className="shrink-0 flex items-center">
          <input
            type="checkbox"
            checked={reportChecked}
            onChange={(e) => { e.stopPropagation(); onToggleReport(); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            title="Select for job report download"
          />
        </div>
      )}
      {/* Order Number */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
          isFailed ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {file.order || index + 1}
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className={`p-1 rounded ${index === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100'}`}
            title="Move Up"
          >
            <ArrowUp size={14} className="text-slate-600" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === totalFiles - 1}
            className={`p-1 rounded ${index === totalFiles - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100'}`}
            title="Move Down"
          >
            <ArrowDown size={14} className="text-slate-600" />
          </button>
        </div>
      </div>
      
      {/* File Info */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <FileCode size={20} className={`shrink-0 ${isFailed ? 'text-red-500' : 'text-slate-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-bold truncate ${isFailed ? 'text-red-800' : 'text-slate-700'}`} title={getTestCaseDisplayName(file)}>{getTestCaseDisplayName(file)}</span>
            {onOpenInLibrary && (file.vcd || file.erom || file.ulp) && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenInLibrary(file.vcd || file.erom || file.ulp); }}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline shrink-0"
                title="Show file in File Library"
              >
                Open in Library
              </button>
            )}
          </div>
          <div className="text-xs text-slate-400">
            Order: {file.order || index + 1}{file.vcd && file.testCaseName ? ` · ${file.vcd}` : ''}
            {fileLibraryInfo && (fileLibraryInfo.size || fileLibraryInfo.date) && (
              <span className="ml-2"> · {[fileLibraryInfo.size, fileLibraryInfo.date].filter(Boolean).join(' · ')}</span>
            )}
          </div>
          {isFailed && file.errorMessage && (
            <div className="text-xs text-red-600 mt-1 font-medium truncate" title={file.errorMessage}>⚠ {file.errorMessage}</div>
          )}
        </div>
      </div>
      
      {/* Status & Result */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${getStatusColor(file.status)}`}>
          {file.status}
        </span>
        {file.result && (
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${getResultColor(file.result)}`}>
            {file.result}
          </span>
        )}
      </div>
      
      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isFailed && (
          <>
            {onShowError && (
              <button
                onClick={(e) => { e.stopPropagation(); onShowError(); }}
                className="px-3 py-1.5 bg-red-700 text-white rounded-lg text-xs font-bold hover:bg-red-800 transition-all flex items-center gap-1"
                title="View error in modal"
              >
                <AlertCircle size={14} />
                View error
              </button>
            )}
            <button
              onClick={exportErrorLog}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition-all flex items-center gap-1"
              title="Download error log for this test case"
            >
              <Download size={14} />
              Error Log
            </button>
            {onRerunFailed && (
              <button
                onClick={(e) => { e.stopPropagation(); onRerunFailed(); }}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-1"
                title="Re-run this failed test case (new job in Running)"
              >
                <Play size={14} />
                Re-run
              </button>
            )}
          </>
        )}
        {file.status === 'running' && (
          <button
            onClick={onStop}
            className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 transition-all flex items-center gap-1"
            title="Stop this file"
          >
            <StopCircle size={14} />
            Stop
          </button>
        )}
        {file.status === 'stopped' && onRerun && (
          <button
            onClick={onRerun}
            className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-200 transition-all flex items-center gap-1"
            title="Re-run this test case"
          >
            <Play size={14} />
            Re-run
          </button>
        )}
        {onDownloadReport && (
          <button
            onClick={(e) => { e.stopPropagation(); onDownloadReport(); }}
            className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all flex items-center gap-1"
            title="Download report for this test case"
          >
            <Download size={14} />
            Report
          </button>
        )}
      </div>
    </div>
  );
};


export { FileRow };
export default TestCasesProgressView;
