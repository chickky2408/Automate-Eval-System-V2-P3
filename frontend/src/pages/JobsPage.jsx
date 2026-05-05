import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Menu, X, LayoutDashboard, Settings, PlayCircle, Cpu, 
  History, Bell, Upload, FileCode, Box, Search, 
  CheckCircle2, AlertCircle, Clock, Zap, Database, ChevronRight,
  Grid3x3, List, Filter, Terminal, Wifi, WifiOff, HardDrive,
  RefreshCw, Download, Activity, XCircle, Eye, MoreVertical,
  ArrowUp, ArrowDown, Square, Tag, StopCircle, Plus,
  Command, Copy, Play, Layers, Monitor, ChevronDown, ChevronUp, ChevronLeft, CheckSquare, Pencil, Check,
  Pause, ZoomIn, ZoomOut, Trash2, Gauge, User, UserPlus, LogOut, Save, FileDown, FileUp, FolderOpen,
  Lock, Globe, Users
} from 'lucide-react';
import TestCasesProgressView from '../components/jobs/TestCasesProgressView';
import { useTestStore } from '../store/useTestStore';
import api from '../services/api';
import {
  jobTagPillClasses,
  TAG_PALETTE_MAP,
  TAG_PALETTE_KEYS,
  TAG_SWATCH_DOT_CLASS,
  jobHasAnyTagColor,
} from '../utils/tagPalette';

// 3. JOBS PAGE (Enhanced)
const JobsPage = ({ expandJobId, onManageTags, onExpandComplete, onEditJob, onNavigateToFileLibrary, onNavigateToTestCases, onNavigateToLibrarySet }) => {
  const { 
    jobs, 
    startPendingJobs,
    startJobById,
    stopAllJobs,
    stopJob,
    moveJobUp,
    moveJobDown,
    moveJobToIndex,
    stopFile,
    rerunFile,
    rerunFailedFiles,
    moveFileUp, 
    moveFileDown, 
    deleteJobFile,
    updateJobTag,
    updateJobTags,
    deleteJob,
    loading,
    errors
  } = useTestStore();
  const addToast = useTestStore((state) => state.addToast);

  /** Persisted across leaving Jobs page (Zustand); survives SPA navigation without losing filters/expanded rows */
  const jobsPageSession = useTestStore((s) => s.jobsPageSession);
  const setJobsPageSession = useTestStore((s) => s.setJobsPageSession);
  const upd = useCallback(
    (key, update) =>
      setJobsPageSession((prev) => ({
        ...prev,
        [key]: typeof update === 'function' ? update(prev[key]) : update,
      })),
    [setJobsPageSession]
  );
  const assignSession = useCallback(
    (patch) => setJobsPageSession((prev) => ({ ...prev, ...patch })),
    [setJobsPageSession]
  );

  const {
    expandedDetailsJobs,
    testCasesFilter,
    testCasesSearch,
    selectedJobIds,
    jobsSearch,
    jobsStatusFilter,
    jobsTagFilter,
    jobsTagColorFilter,
    jobsTimeFilter,
    editingTag,
    tagInput,
  } = jobsPageSession;

  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [isStoppingAll, setIsStoppingAll] = useState(false);
  const [isStoppingSelected, setIsStoppingSelected] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState(null); // สำหรับ drag selection
  const [isDragging, setIsDragging] = useState(false); // track ว่ากำลัง drag อยู่หรือไม่
  const [draggingJobId, setDraggingJobId] = useState(null);
  /** true while pointer is over the Running column drop zone (pending → start run) */
  const [runningColumnDropActive, setRunningColumnDropActive] = useState(false);
  const runningDropZoneRef = useRef(null);
  const [highlightJobId, setHighlightJobId] = useState(null);
  const highlightTimerRef = useRef(null);
  const [testCaseErrorModal, setTestCaseErrorModal] = useState(null); // { file, job, index } when showing error modal per test case
  const [rerunFailedModal, setRerunFailedModal] = useState(null); // { job, failedFiles } when selecting VCD/ERoM/ULP per test case before re-run
  const [rerunSelections, setRerunSelections] = useState([]); // [{ vcd, erom, ulp }] per failed file for rerun modal
  const [jobsTagColorDropdownOpen, setJobsTagColorDropdownOpen] = useState(false);
  const [jobsTagColorSearch, setJobsTagColorSearch] = useState('');
  const uploadedFiles = useTestStore((s) => s.uploadedFiles) || [];
  const fileTags = useTestStore((s) => s.fileTags) || {};

  /** Checked rows that are still pending — "Run Selected" only starts these (not all pending). */
  const selectedPendingJobsForRun = useMemo(
    () =>
      jobs.filter(
        (j) =>
          selectedJobIds.some((sid) => String(sid) === String(j.id)) &&
          (j.status || '').toLowerCase() === 'pending'
      ),
    [jobs, selectedJobIds]
  );
  const selectedPendingCount = selectedPendingJobsForRun.length;

  const getTestCaseDisplayNameForReport = (f) => (f?.testCaseName || (f?.order != null ? `Test case ${f.order}` : '—'));

  const getFileLibraryInfoForJobFile = (f) => {
    const names = [f?.vcd, f?.erom, f?.ulp].filter(Boolean);
    for (const n of names) {
      const lib = uploadedFiles.find((x) => x.name === n);
      if (lib) {
        const dateStr = lib.uploadDate || lib.date ? new Date(lib.uploadDate || lib.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
        return { size: lib.sizeFormatted, date: dateStr, tag: fileTags[lib.id] };
      }
    }
    return null;
  };

  const downloadReportForJob = (jobId, fileIdsFilter = null) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    const files = (job.files || []).sort((a, b) => (a.order || 0) - (b.order || 0));
    const toInclude = fileIdsFilter && fileIdsFilter.length > 0
      ? files.filter((f) => fileIdsFilter.includes(f.id))
      : files;
    if (toInclude.length === 0) return;
    const rows = toInclude.map((file) => `
        <tr>
          <td>${file.order || 0}</td>
          <td>${getTestCaseDisplayNameForReport(file)}</td>
          <td class="status-${(file.status || 'pending')}">${file.status || 'pending'}</td>
          <td class="result-${file.result === 'pass' ? 'pass' : file.result === 'fail' ? 'fail' : ''}">${file.result || 'N/A'}</td>
          <td>${file.errorMessage || file.error || '—'}</td>
        </tr>`).join('');
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Test Report - Job #${jobId}</title>
<style>body{font-family:Arial,sans-serif;margin:20px;background:#f5f5f5}.container{max-width:900px;margin:0 auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}h1{color:#1e293b;border-bottom:3px solid #3b82f6;padding-bottom:8px}.info{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:16px 0}.info-item{padding:8px;background:#f8fafc;border-radius:4px}.info-label{font-weight:bold;color:#64748b;font-size:12px}.info-value{color:#1e293b;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#3b82f6;color:#fff;padding:10px;text-align:left}td{padding:8px;border-bottom:1px solid #e2e8f0}.status-completed{color:#10b981}.status-running{color:#3b82f6}.result-pass{color:#10b981}.result-fail{color:#ef4444}.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}</style></head><body><div class="container">
<h1>Test Report - Job #${jobId}</h1><div class="info"><div class="info-item"><div class="info-label">Job name</div><div class="info-value">${job.name || 'N/A'}</div></div><div class="info-item"><div class="info-label">Tag</div><div class="info-value">${job.tag || '—'}</div></div><div class="info-item"><div class="info-label">Firmware</div><div class="info-value">${job.firmware || '—'}</div></div><div class="info-item"><div class="info-label">Test cases</div><div class="info-value">${toInclude.length}</div></div></div>
<table><thead><tr><th>Order</th><th>Test Case</th><th>Status</th><th>Result</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">Generated ${new Date().toLocaleString()}</div></div></body></html>`;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `job_${jobId}_report_${toInclude.length === 1 ? getTestCaseDisplayNameForReport(toInclude[0]).replace(/[^a-z0-9]/gi, '_') : new Date().toISOString().split('T')[0]}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadSingleFileReport = (job, file) => {
    if (!job || !file) return;
    downloadReportForJob(job.id, [file.id]);
  };

  useEffect(() => {
    if (!rerunFailedModal?.failedFiles?.length) return;
    setRerunSelections(
      rerunFailedModal.failedFiles.map((f) => ({
        vcd: (f.vcd ?? f.name ?? '').toString().trim(),
        erom: (f.erom ?? '').toString().trim(),
        ulp: (f.ulp ?? '').toString().trim(),
      }))
    );
  }, [rerunFailedModal]);

  // Drop selections/expansion for job ids that no longer exist (after delete / refresh)
  // NOTE: setJobsPageSession is stable (zustand action) — intentionally omitted from deps
  // to avoid re-running on every parent re-render.
  useEffect(() => {
    const valid = new Set(jobs.map((j) => j.id));
    const keepIfDemo = (id) => typeof id === 'string' && id.startsWith('demo-');
    setJobsPageSession((prev) => {
      const selectedJobIds = prev.selectedJobIds.filter((id) => valid.has(id));
      const expandedJobs = prev.expandedJobs.filter((id) => valid.has(id) || keepIfDemo(id));
      const expandedDetailsJobs = prev.expandedDetailsJobs.filter((id) => valid.has(id) || keepIfDemo(id));
      const testCasesView =
        prev.testCasesView != null && (valid.has(prev.testCasesView) || keepIfDemo(prev.testCasesView))
          ? prev.testCasesView
          : null;
      if (
        selectedJobIds.length === prev.selectedJobIds.length &&
        expandedJobs.length === prev.expandedJobs.length &&
        expandedDetailsJobs.length === prev.expandedDetailsJobs.length &&
        testCasesView === prev.testCasesView
      ) {
        return prev;
      }
      return { ...prev, selectedJobIds, expandedJobs, expandedDetailsJobs, testCasesView };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // Keep the latest onExpandComplete in a ref so the expand effect below can call it
  // without having onExpandComplete as a dep (parent re-creates it every render).
  const onExpandCompleteRef = useRef(onExpandComplete);
  useEffect(() => {
    onExpandCompleteRef.current = onExpandComplete;
  }, [onExpandComplete]);

  // จาก History: เปิด job นั้นและโฟกัสที่ test cases/files (เปิด Details ด้วย)
  // Only re-run when expandJobId actually changes — prevents setState loop caused by
  // unstable onExpandComplete prop identity.
  useEffect(() => {
    if (!expandJobId) return;
    const idStr = String(expandJobId);
    setJobsPageSession((prev) => {
      const alreadyExpanded = prev.expandedJobs.includes(expandJobId);
      const alreadyDetails = prev.expandedDetailsJobs.includes(expandJobId);
      if (alreadyExpanded && alreadyDetails && prev.testCasesView === expandJobId) {
        return prev;
      }
      return {
        ...prev,
        expandedJobs: alreadyExpanded ? prev.expandedJobs : [...prev.expandedJobs, expandJobId],
        expandedDetailsJobs: alreadyDetails
          ? prev.expandedDetailsJobs
          : [...prev.expandedDetailsJobs, expandJobId],
        testCasesView: expandJobId,
      };
    });
    requestAnimationFrame(() => {
      const el = document.getElementById(`job-${expandJobId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setHighlightJobId(idStr);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightJobId(null);
      highlightTimerRef.current = null;
    }, 5000);
    onExpandCompleteRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandJobId]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!jobsTagColorDropdownOpen) return;
    const onDoc = (e) => {
      const root = e.target?.closest?.('[data-jobs-tagcolor-dropdown-root]');
      if (!root) setJobsTagColorDropdownOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setJobsTagColorDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [jobsTagColorDropdownOpen]);

  const handleStopAll = async () => {
    if (window.confirm('Do you want to stop all running jobs?')) {
      if (isStoppingAll) return;
      setIsStoppingAll(true);
      const success = await stopAllJobs();
      setIsStoppingAll(false);
      if (success) {
        addToast({ type: 'success', message: 'All running jobs have been stopped.' });
      } else {
        addToast({ type: 'error', message: 'Failed to stop running jobs.' });
      }
    }
  };

  const handleStopSelected = async () => {
    const runningSelected = selectedJobIds.filter((id) => {
      const job = jobs.find((j) => j.id === id);
      return job && job.status === 'running';
    });
    if (runningSelected.length === 0) {
      addToast({ type: 'warning', message: 'No running jobs selected. Please select at least one running job to stop.' });
      return;
    }
    if (!window.confirm(`Do you want to stop ${runningSelected.length} selected job(s)?`)) return;
    if (isStoppingSelected) return;
    setIsStoppingSelected(true);
    const results = await Promise.allSettled(runningSelected.map((jobId) => stopJob(jobId)));
    setIsStoppingSelected(false);
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - ok;
    if (failed === 0) {
      addToast({ type: 'success', message: `Stopped ${ok} job(s).` });
      upd('selectedJobIds', (prev) => prev.filter((id) => !runningSelected.includes(id)));
    } else if (ok > 0) {
      addToast({ type: 'warning', message: `Stopped ${ok} job(s), failed to stop ${failed}.` });
      upd('selectedJobIds', (prev) => prev.filter((id) => !runningSelected.includes(id)));
    } else {
      addToast({ type: 'error', message: 'Failed to stop selected jobs.' });
    }
  };

  const handleRunBatch = async () => {
    const pendingJobs = jobs.filter(j => j.status === 'pending');
    if (pendingJobs.length === 0) {
      addToast({ type: 'info', message: 'No pending jobs to run.' });
      return;
    }
    if (isRunningBatch) return;
    setIsRunningBatch(true);
    const success = await startPendingJobs();
    setIsRunningBatch(false);
    if (success) {
      addToast({ type: 'success', message: 'Started pending jobs.' });
    } else {
      addToast({ type: 'error', message: 'Failed to start pending jobs.' });
    }
  };

  // Functions สำหรับเลือก batch
  const toggleJobSelection = (jobId) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    upd('selectedJobIds', (prev) =>
      prev.includes(jobId)
        ? prev.filter(id => id !== jobId)
        : [...prev, jobId]
    );
  };

  // Functions สำหรับ drag selection (deprecated - ใช้ onClick แทน)
  // เก็บไว้เพื่อ backward compatibility แต่ไม่ได้ใช้แล้ว
  const handleMouseDown = (jobIndex) => {
    // ไม่ทำอะไร - ใช้ onClick แทน
  };

  const handleMouseEnter = (jobIndex) => {
    // ไม่ทำอะไร - ใช้ onClick แทน
  };

  const handleMouseUp = () => {
    // ไม่ทำอะไร - ใช้ onClick แทน
  };

  const handleRunSelectedJobs = async () => {
    const pendingSelectedJobs = selectedPendingJobsForRun;
    if (pendingSelectedJobs.length === 0) {
      addToast({
        type: 'info',
        message:
          'No pending jobs in current selection. Select pending jobs and try again.',
      });
      return;
    }

    if (isRunningBatch) return;
    setIsRunningBatch(true);

    try {
      const results = await Promise.allSettled(pendingSelectedJobs.map((job) => api.startJob(job.id)));
      const fileModified = results.find(
        (r) => r.status === 'rejected' && r.reason?.status === 409 && r.reason?.detail?.code === 'FILE_MODIFIED'
      );
      const { refreshJobs } = useTestStore.getState();
      await refreshJobs();

      if (fileModified) {
        const d = fileModified.reason?.detail;
        const msg =
          (d?.message || 'One or more files were modified after upload.') +
          (Array.isArray(d?.files) && d.files.length ? ` (${d.files.join(', ')})` : '');
        addToast({ type: 'error', message: msg, duration: 8000 });
      } else {
        const rejected = results.filter((r) => r.status === 'rejected');
        if (rejected.length > 0) {
          const first = rejected[0].reason;
          const detail = first?.detail;
          let msg =
            (typeof detail === 'object' && detail !== null && detail.message && String(detail.message)) ||
            (typeof detail === 'string' ? detail : null) ||
            first?.message ||
            'Failed to start jobs.';
          if (typeof detail === 'object' && detail !== null && typeof detail.detail === 'string') {
            msg = detail.detail;
          }
          addToast({ type: 'error', message: String(msg), duration: 8000 });
        } else {
          addToast({
            type: 'success',
            message: `Started ${pendingSelectedJobs.length} selected job(s).`,
          });
          const startedIds = new Set(pendingSelectedJobs.map((j) => String(j.id)));
          upd('selectedJobIds', (prev) => prev.filter((id) => !startedIds.has(String(id))));
        }
      }
    } catch (error) {
      console.error('Failed to start selected jobs', error);
      const d = error?.detail;
      if (error?.status === 409 && d?.code === 'FILE_MODIFIED') {
        const msg = (d?.message || 'One or more files were modified after upload.') + (Array.isArray(d?.files) && d.files.length ? ` (${d.files.join(', ')})` : '');
        addToast({ type: 'error', message: msg, duration: 8000 });
      } else {
        addToast({ type: 'error', message: 'Failed to start selected jobs.' });
      }
    } finally {
      setIsRunningBatch(false);
    }
  };
  
  const handleEditTag = (job) => {
    assignSession({ editingTag: job.id, tagInput: job.tag || '' });
  };
  
  const handleSaveTag = (jobId) => {
    updateJobTag(jobId, tagInput);
    assignSession({ editingTag: null, tagInput: '' });
  };

  const getJobTagsArray = (job) => {
    const raw = Array.isArray(job?.tags) ? job.tags : [];
    const normalized = raw
      .map((t) => ({
        tag: String(t?.tag ?? t?.name ?? '').trim(),
        tagColor: (t?.tagColor ?? t?.color ?? null) ? String(t?.tagColor ?? t?.color).trim() : null,
      }))
      .filter((t) => t.tag);
    if (normalized.length) return normalized;
    if (job?.tag) return [{ tag: String(job.tag).trim(), tagColor: job.tagColor ?? null }];
    return [];
  };

  const openTagManager = (job) => {
    if (onManageTags) onManageTags(job.id);
  };
  
  const handleCancelTag = () => {
    assignSession({ editingTag: null, tagInput: '' });
  };

  // delete job function

  const handleDeleteJob = async (jobId, jobName) => {
    if (!window.confirm(`Delete job #${jobId}?\n\nJob: ${jobName || 'N/A'}\n\nThis action cannot be undone.`)) {
      return;
    }
    const success = await deleteJob(jobId);
    if (success) {
      addToast({ type: 'success', message: `Deleted Job #${jobId} successfully` });
    } else {
      addToast({ type: 'error', message: `Failed to delete Job #${jobId}` });
    }
  };

  const handleDeleteSelectedJobs = async () => {
    if (selectedJobIds.length === 0) {
      addToast({ type: 'warning', message: 'Please select at least one job to delete' });
      return;
    }

    const selectedJobs = jobs.filter(j => selectedJobIds.includes(j.id));
    const jobNames = selectedJobs.map(j => `#${j.id} (${j.name || 'N/A'})`).join('\n');

    if (!window.confirm(`Are you sure you want to delete ${selectedJobIds.length} jobs?\n\n${jobNames}\n\nThis action cannot be undone`)) {
      return;
    }

    const { deleteJob: doDeleteJob, refreshJobs: doRefreshJobs } = useTestStore.getState();
    const results = await Promise.allSettled(selectedJobIds.map((jobId) => doDeleteJob(jobId)));
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.length - ok;
    const deletedIds = selectedJobIds.filter((_, i) => results[i].status === 'fulfilled' && results[i].value === true);

    if (deletedIds.length > 0) {
      await doRefreshJobs();
    }
    upd('selectedJobIds', (prev) => prev.filter((id) => !deletedIds.includes(id)));

    if (failed === 0) {
      addToast({ type: 'success', message: `Deleted ${ok} jobs successfully` });
    } else if (ok > 0) {
      addToast({ type: 'warning', message: `Deleted ${ok} jobs, failed to delete ${failed} jobs` });
    } else {
      addToast({ type: 'error', message: 'Failed to delete the selected jobs' });
    }
  };
  
  // Sort files by order
  const getSortedFiles = (job) => {
    if (!job.files || job.files.length === 0) return [];
    return [...job.files].sort((a, b) => (a.order || 0) - (b.order || 0));
  };

  const jobHasExecutionFailure = (job) =>
    (job.files || []).some(
      (f) => f.result === 'fail' || (f.status || '').toLowerCase() === 'error'
    );

  /** Kanban column: pending | running | error | completed (error = finished job with any TC fail) */
  const jobBoardColumn = (job) => {
    const s = (job.status || '').toLowerCase();
    if (s === 'pending') return 'pending';
    if (s === 'running') return 'running';
    if (s === 'completed' || s === 'stopped') {
      return jobHasExecutionFailure(job) ? 'error' : 'completed';
    }
    return 'completed';
  };

  const isDemoJobId = (id) => typeof id === 'string' && id.startsWith('demo-');

  // สีการ์ดตามสถานะ: เขียว = ผ่านทั้งหมด, แดง = มี fail
  const getCardStatusStyle = (job) => {
    const hasFail = jobHasExecutionFailure(job);
    if (job.status === 'running') return 'border-l-4 border-l-blue-500';
    if (job.status === 'pending') return 'border-l-4 border-l-amber-500';
    if (job.status === 'completed' || job.status === 'stopped') {
      return hasFail ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-emerald-500';
    }
    return 'border-l-4 border-l-slate-300';
  };

  // Helper function to get job date for sorting (newest first)
  const getJobDate = (job) => {
    // สำหรับ pending/running: ใช้ createdAt หรือ startedAt (ใหม่สุด)
    // สำหรับ completed: ใช้ completedAt หรือ startedAt
    if (job.status === 'completed' || job.status === 'stopped') {
      // Completed jobs: ใช้ completedAt ก่อน
      if (job.completedAt) return new Date(job.completedAt);
      if (job.startedAt) return new Date(job.startedAt);
    } else {
      // Running/Pending jobs: ใช้ createdAt ก่อน (เวลาที่สร้าง)
      if (job.createdAt) return new Date(job.createdAt);
      if (job.startedAt) return new Date(job.startedAt);
    }
    // Fallback: ใช้เวลาปัจจุบันสำหรับ pending jobs ที่ไม่มี createdAt
    return new Date();
  };

  // Sort all jobs by date (newest first)
  const sortedAllJobs = [...jobs].sort((a, b) => {
    const dateA = getJobDate(a);
    const dateB = getJobDate(b);
    return dateB - dateA; // newest first
  });

  // แบ่ง jobs เป็น Pending | Running | Completed (เรียงตาม date แล้ว)
  const sortByDate = (list) =>
    [...list].sort((a, b) => getJobDate(b) - getJobDate(a));

  const pendingJobs = sortByDate(
    sortedAllJobs.filter(j => (j.status || '').toLowerCase() === 'pending')
  );
  const runningJobs = sortByDate(
    sortedAllJobs.filter(j => (j.status || '').toLowerCase() === 'running')
  );

  // Apply single search + tag + config + time to any job list
  const applyJobsFilters = (jobsList) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    return jobsList.filter(job => {
      // Search text
      if (jobsSearch.trim()) {
        const searchLower = jobsSearch.trim().toLowerCase();
        const nameMatch = (job.name || '').toLowerCase().includes(searchLower);
        const idMatch = (job.id || '').toLowerCase().includes(searchLower);
        const firmwareMatch = (job.firmware || '').toLowerCase().includes(searchLower);
        const boardsMatch = (job.boards || []).some(b => (b || '').toLowerCase().includes(searchLower));
        const tagMatch = (job.tag || '').toLowerCase().includes(searchLower);
        const configMatch = (job.configName || '').toLowerCase().includes(searchLower);
        if (!nameMatch && !idMatch && !firmwareMatch && !boardsMatch && !tagMatch && !configMatch) return false;
      }
      // Tag
      if (jobsTagFilter) {
        const jobTag = (job.tag || '').toLowerCase();
        if (!jobTag.includes(jobsTagFilter.toLowerCase())) return false;
      }
      // Tag color (any tag on the job, including multi-tag + legacy job.tagColor)
      if (jobsTagColorFilter && !jobHasAnyTagColor(job, jobsTagColorFilter)) return false;
      // Time (by job date)
      if (jobsTimeFilter !== 'all') {
        const jobDate = getJobDate(job);
        switch (jobsTimeFilter) {
          case 'today': if (jobDate < today) return false; break;
          case 'week': if (jobDate < weekAgo) return false; break;
          case 'month': if (jobDate < monthAgo) return false; break;
          default: break;
        }
      }
      return true;
    });
  };

  const filteredPendingJobs = sortByDate(applyJobsFilters(pendingJobs));
  const filteredRunningJobs = sortByDate(applyJobsFilters(runningJobs));
  const allCompletedOrStopped = sortedAllJobs.filter(
    (j) => j.status === 'completed' || j.status === 'stopped'
  );
  const completedSuccessJobs = sortByDate(
    allCompletedOrStopped.filter((j) => !jobHasExecutionFailure(j))
  );
  const errorColumnSourceJobs = sortByDate(
    allCompletedOrStopped.filter((j) => jobHasExecutionFailure(j))
  );
  const filteredCompletedSuccess = sortByDate(applyJobsFilters(completedSuccessJobs));
  const filteredErrorJobs = sortByDate(applyJobsFilters(errorColumnSourceJobs));
  const filteredStoppedSuccess = sortByDate(
    filteredCompletedSuccess.filter((j) => (j.status || '').toLowerCase() === 'stopped')
  );
  const filteredStoppedError = sortByDate(
    filteredErrorJobs.filter((j) => (j.status || '').toLowerCase() === 'stopped')
  );

  // Simulated completed batches for demo when there are no real completed jobs
  const DEMO_COMPLETED_JOB = {
    id: 'demo-completed',
    name: 'Completed job',
    status: 'completed',
    progress: 100,
    tag: 'Demo',
    configName: 'Default_Setup',
    totalFiles: 3,
    completedFiles: 3,
    firmware: 'abi_many_args_2.bin',
    boards: ['Demo Board 1'],
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date().toISOString(),
    files: [
      { id: 'demo-c-1', name: 'test_case_1.vcd', status: 'completed', result: 'pass', order: 1 },
      { id: 'demo-c-2', name: 'test_case_2.vcd', status: 'completed', result: 'pass', order: 2 },
      { id: 'demo-c-3', name: 'test_case_3.vcd', status: 'completed', result: 'pass', order: 3 },
    ],
  };
  // อีกชุด demo completed สำหรับใช้พรีเซนต์เพิ่มเติม
  const DEMO_COMPLETED_JOB_2 = {
    id: 'demo-completed-2',
    name: 'Completed job (ALT)',
    status: 'completed',
    progress: 100,
    tag: 'Demo',
    configName: 'Alt_Setup',
    totalFiles: 2,
    completedFiles: 2,
    firmware: 'demo_erom_2.erom',
    boards: ['Demo Board 2'],
    startedAt: new Date(Date.now() - 5400000).toISOString(),
    completedAt: new Date(Date.now() - 1800000).toISOString(),
    files: [
      { id: 'demo-c2-1', name: 'alt_case_1.vcd', status: 'completed', result: 'pass', order: 1 },
      { id: 'demo-c2-2', name: 'alt_case_2.vcd', status: 'completed', result: 'pass', order: 2 },
    ],
  };
  // Demo batch ที่มีบาง test case fail (สำหรับพรีเซนต์ - แสดงการ์ดสีแดง)
  const DEMO_FAILED_JOB = {
    id: 'demo-failed',
    name: 'Demo failed job',
    status: 'completed',
    progress: 100,
    tag: 'Demo',
    configName: 'Default_Setup',
    totalFiles: 3,
    completedFiles: 3,
    firmware: 'demo_erom_1.erom',
    boards: ['Demo Board 2'],
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    completedAt: new Date(Date.now() - 3600000).toISOString(),
    files: [
      { id: 'demo-f-1', name: 'test_case_1.vcd', status: 'completed', result: 'pass', order: 1 },
      { id: 'demo-f-2', name: 'test_case_2.vcd', status: 'completed', result: 'fail', order: 2 },
      { id: 'demo-f-3', name: 'test_case_3.vcd', status: 'completed', result: 'pass', order: 3 },
    ],
  };
  // ชุด demo failed เพิ่มอีกอันสำหรับพรีเซนต์ flow re-run failed
  const DEMO_FAILED_JOB_2 = {
    id: 'demo-failed-2',
    name: 'Demo failed job (ALT)',
    status: 'completed',
    progress: 100,
    tag: 'Demo',
    configName: 'Alt_Setup',
    totalFiles: 3,
    completedFiles: 3,
    firmware: 'demo_erom_3.erom',
    boards: ['Demo Board 3'],
    startedAt: new Date(Date.now() - 10800000).toISOString(),
    completedAt: new Date(Date.now() - 5400000).toISOString(),
    files: [
      { id: 'demo-f2-1', name: 'alt_case_1.vcd', status: 'completed', result: 'pass', order: 1 },
      { id: 'demo-f2-2', name: 'alt_case_2.vcd', status: 'completed', result: 'fail', order: 2 },
      { id: 'demo-f2-3', name: 'alt_case_3.vcd', status: 'completed', result: 'fail', order: 3 },
    ],
  };
  const displayCompletedJobs = jobsStatusFilter === 'stopped'
    ? filteredStoppedSuccess
    : [DEMO_COMPLETED_JOB, DEMO_COMPLETED_JOB_2, ...filteredCompletedSuccess];
  const displayErrorJobs = jobsStatusFilter === 'stopped'
    ? filteredStoppedError
    : [DEMO_FAILED_JOB, DEMO_FAILED_JOB_2, ...filteredErrorJobs];

  // Unique tags from all jobs (for dropdown)
  const uniqueTags = [...new Set(jobs.map(j => j.tag).filter(Boolean))].sort();
  const hasActiveFilters = !!(
    jobsSearch.trim() ||
    jobsTagFilter ||
    jobsTagColorFilter ||
    jobsTimeFilter !== 'all' ||
    jobsStatusFilter !== 'all'
  );

  // Component สำหรับ render job card (ใช้ซ้ำได้)
  const ensureDetailsOpen = (jobId) => {
    upd('expandedDetailsJobs', (prev) => (prev.includes(jobId) ? prev : [...prev, jobId]));
  };

  const toggleDetails = (jobId) => {
    upd('expandedDetailsJobs', (prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  };

  useEffect(() => {
    const handleOutsideJobCardClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-job-card]')) return;
      upd('expandedDetailsJobs', []);
    };
    document.addEventListener('mousedown', handleOutsideJobCardClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideJobCardClick);
    };
  }, [upd]);

  const draggedJobIsPending = useMemo(() => {
    if (!draggingJobId) return false;
    const j = jobs.find((x) => x.id === draggingJobId);
    return j != null && (j.status || '').toLowerCase() === 'pending';
  }, [draggingJobId, jobs]);

  const handleRunningColumnDragOver = useCallback(
    (e) => {
      e.preventDefault();
      if (!draggedJobIsPending) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      setRunningColumnDropActive(true);
    },
    [draggedJobIsPending]
  );

  const handleRunningColumnDragEnter = useCallback(
    (e) => {
      e.preventDefault();
      if (draggedJobIsPending) setRunningColumnDropActive(true);
    },
    [draggedJobIsPending]
  );

  const handleRunningColumnDragLeave = useCallback((e) => {
    const root = runningDropZoneRef.current;
    const rel = e.relatedTarget;
    if (root && rel instanceof Node && root.contains(rel)) return;
    setRunningColumnDropActive(false);
  }, []);

  const handleRunningColumnDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setRunningColumnDropActive(false);
      const id = e.dataTransfer.getData('application/x-job-id') || e.dataTransfer.getData('text/plain');
      if (!id) {
        setDraggingJobId(null);
        return;
      }
      const dragged = jobs.find((j) => j.id === id);
      if (!dragged || (dragged.status || '').toLowerCase() !== 'pending') {
        setDraggingJobId(null);
        return;
      }
      await startJobById(id);
      setDraggingJobId(null);
    },
    [jobs, startJobById]
  );

  const renderJobCard = (job, jobIndex, allJobs, column, queueJobs = allJobs) => {
    const isDemoJob = isDemoJobId(job.id);
    const sortedFiles = getSortedFiles(job);
    const showDetails = expandedDetailsJobs.includes(job.id);
    const runningFiles = sortedFiles.filter(f => f.status === 'running');
    
    const isPendingJob = (job.status || '').toLowerCase() === 'pending';
    const isDraggable = !isDemoJob && isPendingJob; // ลากได้เฉพาะคิวที่ยัง pending

    const tagsArr = getJobTagsArray(job);
    const primaryTag = tagsArr[0] || null;
    return (
      <div 
      key={job.id} 
      id={`job-${job.id}`} 
      data-job-card
      className={`bg-white text-slate-900 rounded-lg border shadow-sm overflow-hidden transition-all ${getCardStatusStyle(job)} ${
          selectedJobIds.includes(job.id) ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 dark:border-slate-700'
        } ${highlightJobId === String(job.id) ? 'ring-4 ring-amber-300/70 border-amber-400' : ''} ${
          draggingJobId === job.id ? 'opacity-50' : ''
        } dark:bg-slate-900 dark:text-slate-100`}
        draggable={isDraggable}
        onDragStart={isDraggable ? (e) => {
          e.stopPropagation();
          setDraggingJobId(job.id);
          e.dataTransfer.setData('application/x-job-id', job.id);
          e.dataTransfer.setData('text/plain', job.id);
          e.dataTransfer.setData('application/x-job-from-index', String(jobIndex));
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
        onDragEnd={() => {
          setDraggingJobId(null);
          setRunningColumnDropActive(false);
        }}
        onClick={(e) => {
          if (
            e.target.closest('button') ||
            e.target.closest('input') ||
            e.target.closest('select') ||
            e.target.closest('[data-no-select]') ||
            e.target.closest('[data-batch-select]')
          ) {
            return;
          }
          // คลิกในการ์ด = เปิด details (ไม่ toggle ปิด)
          ensureDetailsOpen(job.id);
        }}
        onDragOver={isDraggable ? (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        } : undefined}
        onDrop={isDraggable ? (e) => {
          e.preventDefault();
          const draggedJobId = e.dataTransfer.getData('application/x-job-id') || e.dataTransfer.getData('text/plain');
          if (!draggedJobId) return;

          const draggedJob = jobs.find((j) => j.id === draggedJobId);
          if (!draggedJob) {
            setDraggingJobId(null);
            return;
          }

          if ((draggedJob.status || '').toLowerCase() === 'pending' && (column === 'pending' || column === 'running-queue')) {
            const fromIndex = parseInt(e.dataTransfer.getData('application/x-job-from-index'), 10);
            const toIndex = queueJobs.findIndex((j) => j.id === job.id);
            if (!Number.isNaN(fromIndex) && toIndex >= 0 && fromIndex !== toIndex) {
              moveJobToIndex(draggedJobId, toIndex, queueJobs);
            }
          }
          setDraggingJobId(null);
        } : undefined}
      >
        {/* Job Header */}
        <div className="px-2 py-1.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col gap-0">
            {/* Top Row: Batch Info */}
            <div className="flex justify-between items-center gap-2.5">
              <div className="flex-1 min-w-0 overflow-hidden" data-no-select>
                <div className="flex items-center gap-2 mb-0.5 flex-wrap" data-no-select>
                  {/* div+role แทน <input type="checkbox"> — native checkbox ทำให้ HTML5 drag บนการ์ดแม่ไม่เริ่ม (เฉพาะ pending) */}
                  {!isDemoJob && (
                  <div
                    data-batch-select
                    role="checkbox"
                    aria-checked={selectedJobIds.includes(job.id)}
                    aria-disabled={false}
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleJobSelection(job.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleJobSelection(job.id);
                      }
                    }}
                    className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
                      selectedJobIds.includes(job.id)
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-600'
                    } cursor-pointer`}
                    title="Select this job"
                  >
                    {selectedJobIds.includes(job.id) && <Check size={12} strokeWidth={3} aria-hidden />}
                  </div>
                  )}
                  {isDemoJob && (
                    <span className="px-2 py-0.5 bg-slate-200 text-slate-500 rounded text-xs font-semibold">Demo</span>
                  )}
                  <span className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (typeof onNavigateToLibrarySet !== 'function') return;
                        onNavigateToLibrarySet({
                          setName: (job.name || job.configName || '').trim() || null,
                          setId: job.savedTestCaseSetId ?? job.saved_test_case_set_id ?? job.savedSetId ?? job.setId ?? job.set_id ?? null,
                        });
                      }}
                      className="min-w-0 text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                      title="Open this job in Library → Jobs"
                    >
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {(job.name || job.configName || '').trim() || `Job #${job.id}`}
                      </h3>
                    </button>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase shrink-0 inline-flex items-center gap-1 ${
                    job.status === 'running' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                    job.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                    job.status === 'stopped' ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' :
                    job.status === 'completed'
                      ? (jobHasExecutionFailure(job)
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300')
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  }`}>
                    {job.status === 'stopped' && <StopCircle size={11} />}
                    {job.status === 'stopped'
                      ? 'Stopped'
                      : (job.status === 'completed' && jobHasExecutionFailure(job))
                        ? 'Failed'
                        : job.status
                    }
                  </span>
                  {/* Tag pill should be after status (PENDING/RUNNING/...) */}
                  {primaryTag && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTagManager(job);
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${jobTagPillClasses(primaryTag.tagColor || job.tagColor)}`}
                      title={tagsArr.length > 1 ? `${primaryTag.tag} (+${tagsArr.length - 1})` : primaryTag.tag}
                    >
                      <span className="truncate max-w-[140px]">{primaryTag.tag}</span>
                      {tagsArr.length > 1 && <span className="opacity-70">+{tagsArr.length - 1}</span>}
                    </button>
                  )}
                  {!primaryTag && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openTagManager(job);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`px-2 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1 shrink-0 cursor-pointer hover:brightness-95 transition-colors ${jobTagPillClasses(job.tagColor)}`}
                      title="Add tags"
                    >
                      <Tag size={12} />
                      Add tag
                    </button>
                  )}
                  </span>
                </div>
              </div>
              
              {/* Drag & drop reordering: ไม่มีปุ่ม/ไอคอน แต่อีกการ์ดยังรับ drag จากส่วนหัวการ์ดหลัก */}
            </div>
            {/* Action Row: Details, Delete */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1" data-no-select>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleDetails(job.id); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
                title="Show all details, progress and test cases"
              >
                {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Details
              </button>
              {/* ลบได้เฉพาะ Pending / Error / Completed — ไม่แสดงระหว่าง Running (กันลบขณะกำลังรัน) */}
                  {!isDemoJob && column !== 'running' && column !== 'running-active' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleDeleteJob(job.id, job.name);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-red-600 text-white hover:bg-red-700 transition-all shadow-sm shrink-0"
                      title="Delete this job"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
            </div>
            {showDetails && (
              <div className="mt-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                <TestCasesProgressView
                  job={job}
                  files={sortedFiles}
                  filter={testCasesFilter}
                  search={testCasesSearch}
                  onFilterChange={(v) => upd('testCasesFilter', v)}
                  onSearchChange={(v) => upd('testCasesSearch', v)}
                  onStopFile={(fileId) => stopFile(job.id, fileId)}
                  onRerunFile={(fileId) => rerunFile(job.id, fileId)}
                  onRerunFailedFile={(fileIds) => {
                    const failed = sortedFiles.filter((f) => fileIds.includes(f.id) && (f.result === 'fail' || f.status === 'error'));
                    if (failed.length) setRerunFailedModal({ job, failedFiles: failed });
                  }}
                  onReorderFile={
                    (job.status || '').toLowerCase() === 'pending' || (job.status || '').toLowerCase() === 'running'
                      ? (fromFileId, toFileId) => {
                          if (!fromFileId || !toFileId || fromFileId === toFileId) return;
                          const filesForJob = getSortedFiles(job);
                          const fromIndex = filesForJob.findIndex((f) => f.id === fromFileId);
                          const toIndex = filesForJob.findIndex((f) => f.id === toFileId);
                          if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
                          const fromFile = filesForJob[fromIndex];
                          const toFile = filesForJob[toIndex];
                          const pend = (s) => String(s || '').toLowerCase() === 'pending';
                          if (!pend(fromFile.status) || !pend(toFile.status)) return;
                          const steps = Math.abs(toIndex - fromIndex);
                          const direction = toIndex < fromIndex ? 'up' : 'down';
                          for (let i = 0; i < steps; i += 1) {
                            if (direction === 'up') {
                              moveFileUp(job.id, fromFileId);
                            } else {
                              moveFileDown(job.id, fromFileId);
                            }
                          }
                        }
                      : undefined
                  }
                  onOpenInLibrary={onNavigateToFileLibrary}
                  onOpenInTestCasesLibrary={onNavigateToTestCases}
                  onDeleteFile={(fileId) => deleteJobFile(job.id, fileId)}
                  onReportDownload={() => downloadReportForJob(job.id, null)}
                  compactKanbanDetails={jobsStatusFilter === 'all'}
                />
              </div>
            )}
          </div>
          
          {/* Progress Bar (แสดงเฉพาะเมื่อมี progress > 0 เพื่อไม่ให้ดูเป็นพื้นที่ว่างใน PENDING) */}
          {(job.progress || 0) > 0 && (
            <div className="mt-2">
              <div className="h-1 w-full bg-slate-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 transition-all duration-1000" 
                  style={{ width: `${job.progress}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
        
      </div>
    );
  };
  
  const getTestCaseDisplayNameForModal = (f) => formatTestCaseDisplayNameRaw(f?.testCaseName || (f?.order != null ? `Test case ${f.order}` : '—'));

  return (
  <div className="space-y-3 min-w-0">
    {/* Modal: error notification per test case */}
    {testCaseErrorModal && (() => {
      const { file, job, index } = testCaseErrorModal;
      const displayName = getTestCaseDisplayNameForModal(file);
      const errorBody = file.errorMessage || file.error || 'No detailed error message available.';
      const exportErrorLogFromModal = (e) => {
        e.stopPropagation();
        const errorLogContent = `Error Log - Test Case Failure Report
Generated: ${new Date().toISOString()}
========================================

Test Case: ${displayName}
Order: ${file.order ?? index + 1}
Status: ${file.status || 'unknown'}
Result: ${file.result || 'N/A'}
Job ID: ${job?.id || 'N/A'}
${job ? `Job Name: ${job.name || 'N/A'}\nFirmware: ${job.firmware || 'N/A'}\nBoards: ${(job.boards || []).join(', ') || 'N/A'}` : ''}

Error Details:
${errorBody}

Started: ${file.startedAt || 'N/A'}
Completed: ${file.completedAt || 'N/A'}
Duration: ${file.duration || 'N/A'}
`;
        const blob = new Blob([errorLogContent], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const safeName = (file.name || `test_case_${index + 1}`).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        link.download = `error_log_${job?.id || 'job'}_${safeName}_${new Date().toISOString().split('T')[0]}.txt`;
        link.click();
        URL.revokeObjectURL(url);
      };
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setTestCaseErrorModal(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">
              <h3 className="text-lg font-bold text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertCircle size={20} />
                Test case error
              </h3>
              <button type="button" onClick={() => setTestCaseErrorModal(null)} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-200">
                <X size={20} />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 space-y-1">
              <div className="font-semibold text-slate-800 dark:text-white truncate" title={displayName}>{displayName}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Order: {file.order ?? index + 1}
                {job?.name && ` · Job: ${job.name}`}
                {job?.id && ` · #${job.id}`}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Error message</div>
              <pre className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-sm whitespace-pre-wrap break-words font-sans">
                {errorBody}
              </pre>
              {(file.startedAt || file.completedAt) && (
                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  {file.startedAt && <div>Started: {file.startedAt}</div>}
                  {file.completedAt && <div>Completed: {file.completedAt}</div>}
                  {file.duration != null && <div>Duration: {file.duration}</div>}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-600 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={exportErrorLogFromModal} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center gap-2">
                <Download size={16} />
                Download error log
              </button>
              <button type="button" onClick={() => setTestCaseErrorModal(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500">
                Close
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    {/* Modal: Re-run failed — select VCD/ERoM/ULP per test case */}
    {rerunFailedModal && rerunFailedModal.failedFiles?.length > 0 && (() => {
      const { job, failedFiles } = rerunFailedModal;
      const ext = (name) => (String(name || '').split('.').pop() || '').toLowerCase();
      const vcdOptions = uploadedFiles.filter((f) => ext(f.name) === 'vcd');
      const eromOptions = uploadedFiles.filter((f) => ['bin', 'hex', 'elf', 'erom'].includes(ext(f.name)));
      const ulpOptions = uploadedFiles.filter((f) => ['ulp', 'lin', 'txt'].includes(ext(f.name)));
      const setRerunSelection = (fileIndex, field, value) => {
        setRerunSelections((prev) => {
          const next = [...prev];
          if (!next[fileIndex]) next[fileIndex] = { vcd: '', erom: '', ulp: '' };
          next[fileIndex] = { ...next[fileIndex], [field]: value };
          return next;
        });
      };
      const handleRerunConfirm = async () => {
        const fileIds = failedFiles.map((f) => f.id);
        const ok = await rerunFailedFiles(job.id, fileIds, rerunSelections);
        if (ok) setRerunFailedModal(null);
      };
      const allVcdSelected = failedFiles.length === rerunSelections.length && rerunSelections.every((s) => (s?.vcd ?? '').toString().trim() !== '');
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setRerunFailedModal(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Re-run failed test cases</h3>
              <button type="button" onClick={() => setRerunFailedModal(null)} className="p-1.5 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                <X size={20} />
              </button>
            </div>
            <p className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
              Select VCD, ERoM (BIN), and ULP for each test case. Then Re-run will create a new job and start it.
            </p>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {failedFiles.map((f, i) => {
                const displayName = f.testCaseName || (f.order != null ? `Test case ${f.order}` : `Test case ${i + 1}`);
                const sel = rerunSelections[i] || { vcd: '', erom: '', ulp: '' };
                const vcdNames = new Set(vcdOptions.map((o) => o.name));
                const eromNames = new Set(eromOptions.map((o) => o.name));
                const ulpNames = new Set(ulpOptions.map((o) => o.name));
                const vcdList = [...vcdOptions];
                if ((f.vcd || f.name) && !vcdNames.has((f.vcd || f.name).toString().trim())) {
                  vcdList.unshift({ id: '__orig__', name: (f.vcd || f.name).toString().trim() });
                }
                const eromList = [...eromOptions];
                if (f.erom && !eromNames.has(f.erom.toString().trim())) {
                  eromList.unshift({ id: '__orig_erom__', name: f.erom.toString().trim() });
                }
                const ulpList = [...ulpOptions];
                if (f.ulp && !ulpNames.has(f.ulp.toString().trim())) {
                  ulpList.unshift({ id: '__orig_ulp__', name: f.ulp.toString().trim() });
                }
                return (
                  <div key={f.id || i} className="p-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 space-y-2">
                    <div className="font-semibold text-slate-800 dark:text-white text-sm">
                      {i + 1}. {displayName}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">VCD</label>
                        <select
                          value={sel.vcd}
                          onChange={(e) => setRerunSelection(i, 'vcd', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                        >
                          <option value="">— Select —</option>
                          {vcdList.map((o) => (
                            <option key={o.id} value={o.name}>{o.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">ERoM / BIN</label>
                        <select
                          value={sel.erom}
                          onChange={(e) => setRerunSelection(i, 'erom', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                        >
                          <option value="">— Optional —</option>
                          {eromList.map((o) => (
                            <option key={o.id} value={o.name}>{o.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">ULP / LIN</label>
                        <select
                          value={sel.ulp}
                          onChange={(e) => setRerunSelection(i, 'ulp', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                        >
                          <option value="">— Optional —</option>
                          {ulpList.map((o) => (
                            <option key={o.id} value={o.name}>{o.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-600 flex justify-end gap-2">
              <button type="button" onClick={() => setRerunFailedModal(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRerunConfirm}
                disabled={!allVcdSelected}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Play size={16} />
                Re-run ({failedFiles.length} test case{failedFiles.length !== 1 ? 's' : ''})
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-center gap-2">
        <div className="min-w-0">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 leading-tight">Job Management</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-0.5 text-xs sm:text-sm">Manage and monitor all test jobs</p>
        </div>
      <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
        {/* Run Selected: เฉพาะ batch สถานะ Pending ที่ติ๊กเลือก (ไม่ใช่ทุก pending) */}
        {selectedPendingCount > 0 && (
          <button
            type="button"
            onClick={handleRunSelectedJobs}
            disabled={isRunningBatch}
            title="Start only selected jobs from the Pending queue"
            className={`bg-blue-500 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 ${isRunningBatch ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-600'}`}
          >
            <Play size={18} />
            {isRunningBatch ? 'Starting...' : `Run Selected (${selectedPendingCount})`}
          </button>
        )}
        
        {/* Run All Pending Button */}
        <button
          onClick={handleRunBatch}
          disabled={isRunningBatch}
          className={`bg-emerald-500 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 ${isRunningBatch ? 'opacity-60 cursor-not-allowed' : 'hover:bg-emerald-600'}`}
        >
          <PlayCircle size={18} />
          {isRunningBatch ? 'Starting...' : 'Run All Pending'}
        </button>
        
        {/* Stop Selected Button (running only) */}
        {selectedJobIds.some((id) => jobs.find((j) => j.id === id)?.status === 'running') && (
          <button
            onClick={handleStopSelected}
            disabled={isStoppingSelected}
            className={`bg-red-600 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 ${isStoppingSelected ? 'opacity-60 cursor-not-allowed' : 'hover:bg-red-700'}`}
            title="Stop selected running job(s)"
          >
            <Square size={18} />
            {isStoppingSelected ? 'Stopping...' : `Stop Selected (${selectedJobIds.filter((id) => jobs.find((j) => j.id === id)?.status === 'running').length})`}
          </button>
        )}
        {/* Delete Selected Button */}
        {selectedJobIds.length > 0 && (
          <button
            onClick={handleDeleteSelectedJobs}
            className="bg-red-600 text-white px-6 py-2 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 hover:bg-red-700"
            title={`Delete ${selectedJobIds.length} selected job(s)`}
          >
            <XCircle size={18} />
            Delete Selected ({selectedJobIds.length})
          </button>
        )}
      </div>
    </div>

      {/* Single search + filter bar */}
      <div className="rounded-lg border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 p-2 mb-3 flex flex-wrap items-center gap-1.5">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
          type="text"
          value={jobsSearch}
          onChange={(e) => upd('jobsSearch', e.target.value)}
          placeholder="Search by name, ID, firmware, boards..."
          className="w-full pl-8 pr-2 py-1 border border-slate-300 dark:border-slate-700 rounded-md text-xs bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={jobsStatusFilter}
          onChange={(e) => upd('jobsStatusFilter', e.target.value)}
          className="px-2 py-1 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[140px]"
          title="Column / Status"
        >
          <option value="all">All columns</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="error">Error</option>
          <option value="completed">Completed</option>
        </select>
        <select
          value={jobsTagFilter}
          onChange={(e) => upd('jobsTagFilter', e.target.value)}
          className="px-2 py-1 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer min-w-[100px] max-w-[130px]"
          title="Tag"
        >
          <option value="">All Tags</option>
          {uniqueTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
        {(() => {
          const selectedKey = String(jobsTagColorFilter || '').trim();
          const dotKey = TAG_PALETTE_MAP[selectedKey] ? selectedKey : 'mint';
          const isAll = !selectedKey;
          const q = jobsTagColorSearch.trim().toLowerCase();
          const keys = TAG_PALETTE_KEYS.filter((k) => !q || k.toLowerCase().includes(q));
          return (
            <div className="relative shrink-0" data-jobs-tagcolor-dropdown-root>
              <button
                type="button"
                onClick={() => setJobsTagColorDropdownOpen((v) => !v)}
                className="px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                title="Filter by tag color"
              >
                <span
                  className={`inline-flex w-2.5 h-2.5 rounded-full ${isAll ? 'bg-slate-400 dark:bg-slate-600' : (TAG_SWATCH_DOT_CLASS[dotKey] || TAG_SWATCH_DOT_CLASS.mint)}`}
                  aria-hidden
                />
                <span className="hidden sm:inline max-w-[72px] truncate">{isAll ? 'Tag color' : selectedKey}</span>
              </button>
              {jobsTagColorDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg w-[180px] max-h-[280px] overflow-y-auto">
                  <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">Tag color</div>
                  <div className="px-2 pb-2">
                    <input
                      type="text"
                      value={jobsTagColorSearch}
                      onChange={(e) => setJobsTagColorSearch(e.target.value)}
                      placeholder="Search color…"
                      className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                    />
                  </div>
                  <div className="p-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        upd('jobsTagColorFilter', '');
                        setJobsTagColorDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-start px-2 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 ${isAll ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                      title="All tag colors"
                    >
                      <span className="inline-flex w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-600" aria-hidden />
                      <span className="ml-2 text-xs text-slate-700 dark:text-slate-200">All</span>
                    </button>
                    {keys.map((k) => {
                      const isSelected = selectedKey === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            upd('jobsTagColorFilter', k);
                            setJobsTagColorDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-start px-2 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 ${isSelected ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                          title={k}
                        >
                          <span className={`inline-flex w-2.5 h-2.5 rounded-full ${TAG_SWATCH_DOT_CLASS[k] || TAG_SWATCH_DOT_CLASS.mint}`} aria-hidden />
                          <span className="ml-2 text-xs text-slate-700 dark:text-slate-200">{k}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        <select
          value={jobsTimeFilter}
          onChange={(e) => upd('jobsTimeFilter', e.target.value)}
          className="px-2 py-1 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          title="Time"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
        {hasActiveFilters && (
          <button
            onClick={() =>
              assignSession({
                jobsSearch: '',
                jobsTagFilter: '',
                jobsTagColorFilter: '',
                jobsTimeFilter: 'all',
                jobsStatusFilter: 'all',
              })
            }
            className="px-2 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 flex items-center gap-1"
            title="Clear all filters"
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>
      
      {(loading?.jobs || errors?.jobs) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          errors?.jobs
            ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300'
            : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
        }`}>
          {errors?.jobs ? `Failed to load jobs: ${errors.jobs}` : 'Loading jobs...'}
        </div>
      )}

      {(!loading?.jobs && !errors?.jobs && jobs.length === 0) && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
          No jobs yet
        </div>
      )}

      {/* Columns: 4 columns when "All", or 1 column when a single status is selected */}
      <div
        className={`grid gap-2 md:gap-3 ${
          jobsStatusFilter === 'all' ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'
        }`}
      >
        {/* Pending column removed: queue is shown under Running to save space */}

        {/* Column 2: Running + Queue (Pending under running) */}
        {(jobsStatusFilter === 'all' || jobsStatusFilter === 'running' || jobsStatusFilter === 'pending') && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white/80 p-2 shadow-sm dark:bg-slate-900/70 dark:border-slate-800 min-w-0">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 dark:bg-blue-900/30 dark:border-blue-700">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Running</h2>
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold dark:bg-blue-900/60 dark:text-blue-200 tabular-nums">
                {filteredRunningJobs.length}
              </span>
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold dark:bg-amber-900/60 dark:text-amber-200 tabular-nums">
                Queue {filteredPendingJobs.length}
              </span>
            </div>
            
          </div>
          <div
            ref={runningDropZoneRef}
            onDragEnter={handleRunningColumnDragEnter}
            onDragOver={handleRunningColumnDragOver}
            onDragLeave={handleRunningColumnDragLeave}
            onDrop={handleRunningColumnDrop}
            className={`space-y-1.5 pt-0.5 pr-0.5 md:pr-1 min-h-[4rem] rounded-lg transition-colors ${
              runningColumnDropActive && draggedJobIsPending
                ? 'bg-blue-50/90 ring-2 ring-blue-400/60 ring-offset-1 dark:bg-blue-950/40 dark:ring-blue-500/50'
                : ''
            }`}
          >
            {filteredRunningJobs.length === 0 ? (
              <div
                className={`rounded-lg border border-dashed px-2 py-6 text-center text-xs dark:border-slate-600 ${
                  runningColumnDropActive && draggedJobIsPending
                    ? 'border-blue-400 bg-blue-50/50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-400 dark:bg-slate-900 dark:text-slate-400'
                }`}
              >
                <p className="font-medium text-slate-500 dark:text-slate-400">
                  {hasActiveFilters ? 'No matching running jobs' : 'No running jobs'}
                </p>
                {!hasActiveFilters && (
                  <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                    Drag Jobs from Pending to here to start running immediately (or drag on the running card)
                  </p>
                )}
              </div>
            ) : (
              filteredRunningJobs.map((job, queueIndex) =>
                renderJobCard(job, queueIndex, filteredRunningJobs, 'running-active')
              )
            )}
            <div className="mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-2 h-2 bg-amber-500 rounded-full shrink-0" />
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Queue (Pending)</h3>
                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold dark:bg-amber-900/60 dark:text-amber-200 tabular-nums">
                  {filteredPendingJobs.length}
                </span>
              </div>
              <div
                className="space-y-1.5 min-h-[2.75rem] rounded-lg"
                onDragOver={(e) => {
                  if (!draggedJobIsPending) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  if (!draggedJobIsPending) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const draggedJobId = e.dataTransfer.getData('application/x-job-id') || e.dataTransfer.getData('text/plain');
                  if (!draggedJobId) return;
                  const fromIndex = filteredPendingJobs.findIndex((j) => j.id === draggedJobId);
                  if (fromIndex < 0) return;
                  const toIndex = Math.max(0, filteredPendingJobs.length - 1);
                  if (toIndex !== fromIndex) moveJobToIndex(draggedJobId, toIndex, filteredPendingJobs);
                  setDraggingJobId(null);
                }}
              >
                {filteredPendingJobs.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-3 text-center text-slate-400 text-xs dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
                    <p>{hasActiveFilters ? 'No matching queue jobs' : 'No queued jobs'}</p>
                  </div>
                ) : (
                  filteredPendingJobs.map((job, queueIndex) =>
                    renderJobCard(job, queueIndex, filteredPendingJobs, 'running-queue', filteredPendingJobs)
                  )
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Column: Error (completed/stopped sets with any failed TC) — after Running */}
        {(jobsStatusFilter === 'all' || jobsStatusFilter === 'error' || jobsStatusFilter === 'stopped') && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white/80 p-2 shadow-sm dark:bg-slate-900/70 dark:border-slate-800 min-w-0">
          <div className="bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 dark:bg-red-900/25 dark:border-red-800">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Error</h2>
              <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded-full text-[10px] font-bold dark:bg-red-900/50 dark:text-red-200 tabular-nums">
                {displayErrorJobs.length}
              </span>
            </div>
          </div>
          <div className="space-y-1.5 pt-0.5 pr-0.5 md:pr-1 min-h-[4rem]">
            {displayErrorJobs.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-4 text-center text-slate-400 text-xs dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
                <p>{hasActiveFilters ? 'No matching error jobs' : 'No error jobs'}</p>
              </div>
            ) : (
              displayErrorJobs.map((job, queueIndex) =>
                renderJobCard(job, queueIndex, displayErrorJobs, 'error')
              )
            )}
          </div>
        </div>
        )}

        {/* Column: Completed (passed / no failed TC) */}
        {(jobsStatusFilter === 'all' || jobsStatusFilter === 'completed' || jobsStatusFilter === 'stopped') && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white/80 p-2 shadow-sm dark:bg-slate-900/70 dark:border-slate-800 min-w-0">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 dark:bg-emerald-900/30 dark:border-emerald-700">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Completed</h2>
              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold dark:bg-emerald-900/60 dark:text-emerald-200 tabular-nums">
                {displayCompletedJobs.length}
              </span>
            </div>
          </div>
          <div className="space-y-1.5 pt-0.5 pr-0.5 md:pr-1 min-h-[4rem]">
            {displayCompletedJobs.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-4 text-center text-slate-400 text-xs dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
                <p>{hasActiveFilters ? 'No matching completed jobs' : 'No completed jobs'}</p>
              </div>
            ) : (
              displayCompletedJobs.map((job, queueIndex) =>
                renderJobCard(job, queueIndex, displayCompletedJobs, 'completed')
              )
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

// File Row Component (for JobsPage)
// Test Cases Progress View Component
const JobRow = ({ id, name, status, machine, color }) => (
  <tr className="hover:bg-slate-50/80 transition-colors">
    <td className="px-6 py-5">
      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase bg-${color}-100 text-${color}-600`}>
        {status}
      </span>
    </td>
    <td className="px-6 py-5">
      <div className="font-bold text-slate-700">{name}</div>
      <div className="text-xs text-slate-400 font-medium">Job ID: #{id}</div>
    </td>
    <td className="px-6 py-5 text-sm font-bold text-slate-500">{machine}</td>
    <td className="px-6 py-5">
      <button className="text-blue-600 hover:text-blue-800 text-xs font-bold uppercase tracking-wider transition-colors">Details</button>
    </td>
  </tr>
);

// Batch Details Modal


export default JobsPage;
