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
  onReorderFile, // optional: drag & drop reorder handler
  onOpenInLibrary, // open in File Library (legacy)
  onOpenInTestCasesLibrary, // navigate to Test Cases tab and auto-select this test case row
  onDeleteFile, // remove a pending test case from this batch only
  // Report batch actions (show at top only; when provided, show Select all / Clear / Download report)
  onReportSelectAll,
  onReportClear,
  onReportDownload,
  reportSelectedCount = 0,
}) => {
  const runningFileRef = useRef(null);
  const [selectedFileIds, setSelectedFileIds] = useState([]);

  const getTestCaseDisplayName = (file) => formatTestCaseDisplayNameRaw(file?.testCaseName || (file?.order != null ? `Test case ${file.order}` : '—'));
  
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
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        {/* Header: title (details are controlled by outer job card) */}
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 min-w-0">
              <Activity size={18} className="text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="truncate">Test Cases Progress - {job.name}</span>
            </h4>
          </div>

          <>
              {/* Batch summary (Firmware, Boards, Progress, Files, date) */}
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300 flex-wrap mb-3">
                <span>Firmware: <strong className="text-slate-800 dark:text-slate-100">{job.firmware}</strong></span>
                <span>Boards: <strong className="text-slate-800 dark:text-slate-100">{job.boards?.join(', ')}</strong></span>
                <span>Progress: <strong className="text-slate-800 dark:text-slate-100">{job.progress}%</strong></span>
                <span>Files: <strong className="text-slate-800 dark:text-slate-100">{job.completedFiles}/{job.totalFiles}</strong></span>
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
            </>
          {/* Statistics Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm shadow-slate-900/40 min-w-0">
                  <div className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-tight truncate">Total</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{files.length}</div>
                </div>
                <div className="bg-emerald-50 dark:bg-slate-900 p-2 rounded-lg border border-emerald-200 dark:border-emerald-600 shadow-sm shadow-slate-950/40 min-w-0">
                  <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-tight truncate">Done</div>
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{files.filter(f => f.status === 'completed').length}</div>
                </div>
                <div className="bg-blue-50 dark:bg-slate-900 p-2 rounded-lg border border-blue-200 dark:border-blue-600 shadow-sm shadow-slate-950/40 min-w-0">
                  <div className="text-[10px] font-bold text-blue-700 dark:text-sky-400 uppercase tracking-tight truncate">Run</div>
                  <div className="text-lg font-bold text-blue-700 dark:text-sky-300">{files.filter(f => f.status === 'running').length}</div>
                </div>
                <div className="bg-yellow-50 p-2 rounded-lg border border-yellow-200 min-w-0">
                  <div className="text-[10px] font-bold text-yellow-600 uppercase tracking-tight truncate">Pending</div>
                  <div className="text-lg font-bold text-yellow-700">{files.filter(f => f.status === 'pending').length}</div>
                </div>
                <div className="bg-red-50 p-2 rounded-lg border border-red-200 min-w-0">
                  <div className="text-[10px] font-bold text-red-600 uppercase tracking-tight truncate">Failed</div>
                  <div className="text-lg font-bold text-red-700">{files.filter(f => f.result === 'fail').length}</div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 min-w-0">
                  <div className="text-[10px] font-bold text-slate-600 uppercase tracking-tight truncate">Stop</div>
                  <div className="text-lg font-bold text-slate-700">{files.filter(f => f.status === 'stopped').length}</div>
                </div>
              </div>
          {/* Overall progress bar removed per UX request */}

          {/* Search and Filter */}
          <div className="flex gap-3 items-center">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name or tag..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {/* Status dropdown: ไม่แสดงเมื่อ batch ยัง Pending เพราะ test cases ทั้งหมดเป็น pending อยู่แล้ว */}
            {(job.status || '').toLowerCase() !== 'pending' && (
            <select
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="stopped">Stopped</option>
            </select>
            )}
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

                {/* Delete from batch (pending only) */}
                <button
                  onClick={async () => {
                    const pendingSelected = filteredFiles.filter(f =>
                      selectedFileIds.includes(f.id) && f.status === 'pending'
                    );
                    if (pendingSelected.length === 0) return;
                    if (!window.confirm(`Remove ${pendingSelected.length} pending test case(s) from this batch? (Will not delete files or library data)`)) {
                      return;
                    }
                    await Promise.all(pendingSelected.map(file => onDeleteFile?.(file.id)));
                    setSelectedFileIds([]);
                  }}
                  className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg text-sm font-bold hover:bg-slate-300 transition-all flex items-center gap-2"
                  title="Remove selected pending test cases from this batch (does not delete from Library)"
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {/* Select All Header (if there are files) */}
          {filteredFiles.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
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
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  title="Select all test cases"
                />
                <span className="text-xs font-semibold text-slate-600">
                  {selectedFileIds.length > 0 
                    ? `${selectedFileIds.length} of ${filteredFiles.length} selected`
                    : `Select All (${filteredFiles.length} test cases)`}
                </span>
              </div>
              {typeof onReportDownload === 'function' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => onReportSelectAll?.()} className="text-xs font-bold text-blue-600 hover:text-blue-800 dark:text-blue-400">Select all</button>
                  <button type="button" onClick={() => onReportClear?.()} className="text-xs font-bold text-slate-600 hover:text-slate-800 dark:text-slate-400">Clear</button>
                  <button
                    type="button"
                    onClick={() => onReportDownload?.()}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 flex items-center gap-1"
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
              <div className="p-12 text-center text-slate-400">
                <FileCode size={48} className="mx-auto mb-4 opacity-50" />
                <p>No test cases found</p>
                {search && <p className="text-xs mt-2">Try adjusting your search or filter</p>}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredFiles.map((file, index) => {
                  const isRunning = file.status === 'running';
                  const isFailed = file.result === 'fail' || file.status === 'error';
                  const fileIndex = files.findIndex(f => f.id === file.id);
                  return (
                    <div
                      key={file.id}
                      draggable={!!onReorderFile}
                      data-drop-index={index}
                      onDragStart={(e) => {
                        if (!onReorderFile) return;
                        e.dataTransfer.setData(
                          'application/json',
                          JSON.stringify({ type: 'jobFile', fromIndex: index })
                        );
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (!onReorderFile) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        if (!onReorderFile) return;
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          const raw = e.dataTransfer.getData('application/json');
                          if (!raw) return;
                          const data = JSON.parse(raw);
                          if (
                            data.type === 'jobFile' &&
                            typeof data.fromIndex === 'number' &&
                            data.fromIndex !== index
                          ) {
                            onReorderFile(data.fromIndex, index);
                          }
                        } catch (_) {}
                      }}
                      ref={isRunning ? runningFileRef : null}
                      className={`p-4 transition-all ${
                        isRunning 
                          ? 'bg-blue-50 border-l-4 border-blue-500' 
                          : selectedFileIds.includes(file.id)
                          ? 'bg-blue-50/50 border-l-2 border-blue-300'
                          : 'hover:bg-slate-50'
                      }`}
                    >
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
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
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
                            : 'bg-slate-200 text-slate-600'
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
                              onClick={() => {
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
                              }}
                              title={getTestCaseDisplayName(file)}
                            >
                              <FileCode size={18} className="text-blue-500 shrink-0" />
                              <span className="font-bold text-slate-800 text-sm truncate group-hover:underline">
                                {getTestCaseDisplayName(file)}
                              </span>
                            </button>
                            {/* VCD/ERoM/ULP as secondary when different from display name */}
                            {file.vcd && (file.testCaseName !== file.vcd) && (
                              <div className="flex items-center gap-1 min-w-0 max-w-full text-xs text-slate-500">
                                <span>VCD: {file.vcd}</span>
                              </div>
                            )}
                            {file.erom && (
                              <div className="flex items-center gap-1 min-w-0 max-w-full text-xs text-slate-500">
                                <span className="text-slate-400 shrink-0">+</span>
                                <span title={file.erom}>{file.erom}</span>
                              </div>
                            )}
                            {file.ulp && (
                              <div className="flex items-center gap-1 min-w-0 max-w-full text-xs text-slate-500">
                                <span className="text-slate-400 shrink-0">+</span>
                                <span title={file.ulp}>{file.ulp}</span>
                              </div>
                            )}
                            {isRunning && (
                              <span className="px-2 py-0.5 bg-blue-500 text-white rounded text-xs font-bold animate-pulse shrink-0">
                                RUNNING NOW
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            Test Case #{file.order || fileIndex + 1} of {files.length}
                            {file.try_count && file.try_count > 1 && ` • ${file.try_count} rounds`}
                          </div>
                        </div>
                        
                        {/* Status & Result (ซ่อน status badge เมื่อเป็น running เพราะมี RUNNING NOW ด้านบนแล้ว) */}
                        <div className="flex items-center gap-2 shrink-0">
                          {!isRunning && (
                          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase border-2 ${
                            file.status === 'completed' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                            file.status === 'stopped' ? 'bg-red-100 text-red-700 border-red-300' :
                            file.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                            'bg-slate-100 text-slate-700 border-slate-300'
                          }`}>
                            {file.status}
                          </span>
                          )}
                          {file.result && (
                            <span className={`px-3 py-1 rounded text-xs font-bold ${
                              file.result === 'pass' ? 'bg-emerald-50 text-emerald-700' :
                              file.result === 'fail' ? 'bg-red-50 text-red-700' :
                              'bg-slate-50 text-slate-400'
                            }`}>
                              {file.result.toUpperCase()}
                            </span>
                          )}
                        </div>
                        
                        {/* Actions */}
                        {isFailed && onRerunFailedFile && (
                          <button
                            onClick={() => onRerunFailedFile([file.id])}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-1"
                            title="Re-run this failed test case (new batch in Running)"
                          >
                            <Play size={14} />
                            Re-run
                          </button>
                        )}
                        {isRunning && (
                          <button
                            onClick={() => onStopFile(file.id)}
                            className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200 transition-all flex items-center gap-1"
                          >
                            <StopCircle size={14} />
                            Stop
                          </button>
                        )}
                        {file.status === 'stopped' && onRerunFile && (
                          <button
                            onClick={() => onRerunFile(file.id)}
                            className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-200 transition-all flex items-center gap-1"
                            title="Re-run this test case"
                          >
                            <Play size={14} />
                            Re-run
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        
        {/* Current Running Indicator */}
        {currentRunningIndex >= 0 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <Activity size={16} className="text-blue-600 animate-pulse shrink-0" />
              <span className="font-bold text-blue-700 min-w-0 truncate" title={getTestCaseDisplayName(filteredFiles[currentRunningIndex])}>
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
            title="Select for batch report download"
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
                title="Re-run this failed test case (new batch in Running)"
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
