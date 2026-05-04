import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  Menu, X, LayoutDashboard, Settings, PlayCircle, Cpu, 
  History, Bell, Upload, FileCode, Box, Search, 
  CheckCircle2, AlertCircle, Clock, Zap, Database, ExternalLink,
  Grid3x3, List, Filter, Terminal, Wifi, WifiOff, HardDrive,
  RefreshCw, Download, Activity, XCircle, Eye, MoreVertical,
  ArrowUp, ArrowDown, Square, Tag, FileJson, StopCircle, Plus,
  Command, Copy, Play, Layers, Monitor, ChevronDown, ChevronUp, GripVertical, ChevronLeft, CheckSquare, Pencil,
  Pause, ZoomIn, ZoomOut, Trash2, Gauge, User, UserPlus, LogOut, Save, FileDown, FileUp, FolderOpen,
  Lock, Globe, Users
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';

// 5. HISTORY PAGE
const isDemoHistoryJob = (job) => typeof job?.id === 'string' && String(job.id).startsWith('demo-');

const HistoryPage = ({ onViewJob }) => {
  const { jobs, exportJobToJSON, exportAllFailedLogs, loading, errors, deleteJob, addToast } = useTestStore();
  const [downloadMenuOpen, setDownloadMenuOpen] = useState({});
  const [statusFilter, setStatusFilter] = useState('all'); // all | passed | failed
  const [searchTerm, setSearchTerm] = useState('');
  const [groupByDate, setGroupByDate] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState(null);
  const cardRefs = useRef({});

  const completedJobs = useMemo(
    () => jobs.filter((job) => job.status === 'completed' || job.status === 'stopped'),
    [jobs]
  );

  const jobHasExecutionFailure = (job) =>
    (job.files || []).some(
      (f) => f.result === 'fail' || String(f.status || '').toLowerCase() === 'error'
    );

  const hasFailedFiles = jobHasExecutionFailure;
  
  // Helper to count failed files
  const getFailedFilesCount = (job) => {
    return (job.files || []).filter(f => f.result === 'fail' || f.status === 'error').length;
  };
  
  // Helper to format duration จาก startedAt / completedAt
  const formatDuration = (job) => {
    if (!job.startedAt || !job.completedAt) return '—';
    const start = new Date(job.startedAt);
    const end = new Date(job.completedAt);
    const diffMs = Math.max(0, end - start);
    const totalSec = Math.round(diffMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };
  
  // Helper to format date จาก completedAt (fallback เป็น startedAt)
  const formatDate = (job) => {
    const ts = job.completedAt || job.startedAt;
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getJobDate = (job) => {
    if (job.completedAt) return new Date(job.completedAt);
    if (job.startedAt) return new Date(job.startedAt);
    return new Date(0);
  };

  const sortByDate = (list) => [...list].sort((a, b) => getJobDate(b) - getJobDate(a));

  const dayKey = (job) => {
    const d = getJobDate(job);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const formatDayHeading = (key) => {
    const [y, mo, da] = key.split('-').map(Number);
    const d = new Date(y, mo - 1, da);
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startToday - startThat) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  const DEMO_COMPLETED_JOB = {
    id: 'demo-completed',
    name: 'Completed job',
    profileName: 'Demo user',
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

  const DEMO_COMPLETED_JOB_2 = {
    id: 'demo-completed-2',
    name: 'Completed job (ALT)',
    profileName: 'Demo user',
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

  const DEMO_FAILED_JOB = {
    id: 'demo-failed',
    name: 'Demo failed job',
    profileName: 'Demo user',
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

  const DEMO_FAILED_JOB_2 = {
    id: 'demo-failed-2',
    name: 'Demo failed job (ALT)',
    profileName: 'Demo user',
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

  const completedSuccessSource = useMemo(
    () => sortByDate(completedJobs.filter((j) => !jobHasExecutionFailure(j))),
    [completedJobs]
  );

  const errorColumnSource = useMemo(
    () => sortByDate(completedJobs.filter((j) => jobHasExecutionFailure(j))),
    [completedJobs]
  );

  const displayCompletedColumn = [DEMO_COMPLETED_JOB, DEMO_COMPLETED_JOB_2, ...completedSuccessSource];
  const displayErrorColumn = [DEMO_FAILED_JOB, DEMO_FAILED_JOB_2, ...errorColumnSource];

  const matchesHistoryFilters = useCallback((job) => {
    if (statusFilter === 'passed' && jobHasExecutionFailure(job)) return false;
    if (statusFilter === 'failed' && !jobHasExecutionFailure(job)) return false;

    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;

    const name = (job.name || job.configName || '').toLowerCase();
    const tag = (job.tag || '').toLowerCase();
    const runBy = `${job.profileName || ''} ${job.clientId || ''}`.toLowerCase();
    return name.includes(q) || tag.includes(q) || runBy.includes(q);
  }, [statusFilter, searchTerm]);

  const filteredCompletedCol = useMemo(
    () => displayCompletedColumn.filter(matchesHistoryFilters),
    [displayCompletedColumn, matchesHistoryFilters]
  );

  const filteredErrorCol = useMemo(
    () => displayErrorColumn.filter(matchesHistoryFilters),
    [displayErrorColumn, matchesHistoryFilters]
  );

  const mergedDemoAndDisplayJobs = useMemo(() => {
    const m = new Map();
    [...displayCompletedColumn, ...displayErrorColumn].forEach((j) => m.set(j.id, j));
    return m;
  }, [displayCompletedColumn, displayErrorColumn]);

  const getJobById = (jobId) => jobs.find((j) => j.id === jobId) || mergedDemoAndDisplayJobs.get(jobId);

  const groupedByDate = useMemo(() => {
    if (!groupByDate) return null;
    const map = new Map();
    const ingest = (job, col) => {
      const k = dayKey(job);
      if (!map.has(k)) {
        map.set(k, { dayKey: k, label: formatDayHeading(k), completed: [], error: [] });
      }
      map.get(k)[col].push(job);
    };
    filteredErrorCol.forEach((j) => ingest(j, 'error'));
    filteredCompletedCol.forEach((j) => ingest(j, 'completed'));
    const rows = Array.from(map.values());
    rows.forEach((row) => {
      row.completed.sort((a, b) => getJobDate(b) - getJobDate(a));
      row.error.sort((a, b) => getJobDate(b) - getJobDate(a));
    });
    return rows.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }, [groupByDate, filteredCompletedCol, filteredErrorCol]);

  const historyJobsShownCount = filteredCompletedCol.length + filteredErrorCol.length;

  const getJobProgress = (job) => {
    if (typeof job.progress === 'number') return job.progress;
    if (job.completedFiles != null && job.totalFiles) {
      return Math.round((job.completedFiles / job.totalFiles) * 100);
    }
    return 100;
  };

  // ชื่อแสดงของ test case: ใช้ชื่อจาก set (testCaseName) เท่านั้น
  const getTestCaseDisplayName = (file) => (file?.testCaseName || (file?.order != null ? `Test case ${file.order}` : '—'));
  
  // Export functions for different formats
  const exportToCSV = (jobId) => {
    const job = getJobById(jobId);
    if (!job) return;
    
    const headers = ['Test Case', 'Order', 'Status', 'Result', 'Board', 'Firmware'];
    const rows = (job.files || []).map(file => [
      getTestCaseDisplayName(file),
      file.order || 0,
      file.status || 'unknown',
      file.result || 'N/A',
      job.boards?.join(', ') || 'N/A',
      job.firmware || 'N/A'
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `batch_${jobId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  const exportToHTML = (jobId) => {
    const job = getJobById(jobId);
    if (!job) return;
    
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Test Report - Batch ${jobId}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #1e293b; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
    .info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
    .info-item { padding: 10px; background: #f8fafc; border-radius: 4px; }
    .info-label { font-weight: bold; color: #64748b; font-size: 12px; }
    .info-value { color: #1e293b; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #3b82f6; color: white; padding: 12px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    tr:hover { background: #f8fafc; }
    .status-completed { color: #10b981; font-weight: bold; }
    .status-running { color: #3b82f6; font-weight: bold; }
    .status-failed { color: #ef4444; font-weight: bold; }
    .status-pending { color: #f59e0b; font-weight: bold; }
    .result-pass { color: #10b981; }
    .result-fail { color: #ef4444; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Report - Job #${jobId}</h1>
    <div class="info">
      <div class="info-item">
        <div class="info-label">Test Name</div>
        <div class="info-value">${job.name || 'N/A'}</div>
          </div>
      <div class="info-item">
        <div class="info-label">Tag</div>
        <div class="info-value">${job.tag || 'Untagged'}</div>
          </div>
      <div class="info-item">
        <div class="info-label">Firmware</div>
        <div class="info-value">${job.firmware || 'N/A'}</div>
        </div>
      <div class="info-item">
        <div class="info-label">Boards</div>
        <div class="info-value">${job.boards?.join(', ') || 'N/A'}</div>
    </div>
      <div class="info-item">
        <div class="info-label">Progress</div>
        <div class="info-value">${job.progress}% (${job.completedFiles || 0}/${job.totalFiles || 0} files)</div>
  </div>
      <div class="info-item">
        <div class="info-label">Status</div>
        <div class="info-value">${job.status || 'unknown'}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Test Case</th>
          <th>Status</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        ${(job.files || []).sort((a, b) => (a.order || 0) - (b.order || 0)).map(file => `
        <tr>
          <td>${file.order || 0}</td>
          <td>${getTestCaseDisplayName(file)}</td>
          <td class="status-${file.status || 'pending'}">${file.status || 'pending'}</td>
          <td class="result-${file.result === 'pass' ? 'pass' : file.result === 'fail' ? 'fail' : ''}">${file.result || 'N/A'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="footer">
      Generated on ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>`;
    
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `batch_${jobId}_report_${new Date().toISOString().split('T')[0]}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  const exportToPDF = (jobId) => {
    const job = getJobById(jobId);
    if (!job) return;
    
    // Generate HTML content for PDF
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Test Report - Batch ${jobId}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20px; }
      .no-print { display: none; }
    }
    body { font-family: Arial, sans-serif; margin: 20px; background: white; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; }
    h1 { color: #1e293b; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
    .info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
    .info-item { padding: 10px; background: #f8fafc; border-radius: 4px; }
    .info-label { font-weight: bold; color: #64748b; font-size: 12px; }
    .info-value { color: #1e293b; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #3b82f6; color: white; padding: 12px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    .status-completed { color: #10b981; font-weight: bold; }
    .status-running { color: #3b82f6; font-weight: bold; }
    .status-failed { color: #ef4444; font-weight: bold; }
    .status-pending { color: #f59e0b; font-weight: bold; }
    .result-pass { color: #10b981; }
    .result-fail { color: #ef4444; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Report - Job #${jobId}</h1>
    <div class="info">
      <div class="info-item">
        <div class="info-label">Test Name</div>
        <div class="info-value">${job.name || 'N/A'}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Tag</div>
        <div class="info-value">${job.tag || 'Untagged'}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Firmware</div>
        <div class="info-value">${job.firmware || 'N/A'}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Boards</div>
        <div class="info-value">${job.boards?.join(', ') || 'N/A'}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Progress</div>
        <div class="info-value">${job.progress}% (${job.completedFiles || 0}/${job.totalFiles || 0} files)</div>
      </div>
      <div class="info-item">
        <div class="info-label">Status</div>
        <div class="info-value">${job.status || 'unknown'}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Test Case</th>
          <th>Status</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        ${(job.files || []).sort((a, b) => (a.order || 0) - (b.order || 0)).map(file => `
        <tr>
          <td>${file.order || 0}</td>
          <td>${getTestCaseDisplayName(file)}</td>
          <td class="status-${file.status || 'pending'}">${file.status || 'pending'}</td>
          <td class="result-${file.result === 'pass' ? 'pass' : file.result === 'fail' ? 'fail' : ''}">${file.result || 'N/A'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="footer">
      Generated on ${new Date().toLocaleString()}
    </div>
  </div>
  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`;
    
    // Open in new window and trigger print dialog
    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };
  
  const exportLogs = (jobId) => {
    const job = getJobById(jobId);
    if (!job) return;
    
    const logContent = `Test Job Log - Job #${jobId}
Generated: ${new Date().toISOString()}
========================================

Batch Information:
- Name: ${job.name || 'N/A'}
- Tag: ${job.tag || 'Untagged'}
- Firmware: ${job.firmware || 'N/A'}
- Boards: ${job.boards?.join(', ') || 'N/A'}
- Status: ${job.status || 'unknown'}
- Progress: ${job.progress}% (${job.completedFiles || 0}/${job.totalFiles || 0} files)

Test Cases:
${(job.files || []).sort((a, b) => (a.order || 0) - (b.order || 0)).map((file, idx) => `
[${idx + 1}] ${getTestCaseDisplayName(file)}
    Order: ${file.order || 0}
    Status: ${file.status || 'unknown'}
    Result: ${file.result || 'N/A'}
    ${file.status === 'completed' ? '✓ Completed' : file.status === 'running' ? '→ Running' : file.status === 'failed' ? '✗ Failed' : '○ Pending'}
`).join('\n')}

Summary:
- Total: ${job.totalFiles || 0} test cases
- Completed: ${(job.files || []).filter(f => f.status === 'completed').length}
- Running: ${(job.files || []).filter(f => f.status === 'running').length}
- Failed: ${(job.files || []).filter(f => f.result === 'fail').length}
- Pending: ${(job.files || []).filter(f => f.status === 'pending').length}
`;
    
    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `batch_${jobId}_logs_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  const toggleDownloadMenu = (e, jobId) => {
    e.stopPropagation();
    setDownloadMenuOpen(prev => ({
      ...prev,
      [jobId]: !prev[jobId]
    }));
  };
  
  const handleDownload = (e, jobId, format) => {
    e.stopPropagation();
    setDownloadMenuOpen(prev => ({ ...prev, [jobId]: false }));
    
    switch(format) {
      case 'json':
        exportJobToJSON(jobId);
        break;
      case 'csv':
        exportToCSV(jobId);
        break;
      case 'html':
        exportToHTML(jobId);
        break;
      case 'pdf':
        exportToPDF(jobId);
        break;
      case 'log':
        exportLogs(jobId);
        break;
      case 'failed':
        exportAllFailedLogs(jobId);
        break;
      default:
        exportJobToJSON(jobId);
    }
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.download-menu-container')) {
        setDownloadMenuOpen({});
      }
    };
    
    if (Object.keys(downloadMenuOpen).length > 0) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [downloadMenuOpen]);

  useEffect(() => {
    if (!expandedJobId) return;
    const el = cardRefs.current[expandedJobId];
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [expandedJobId]);

  const handleDeleteJob = async (e, job) => {
    e.stopPropagation();
    if (isDemoHistoryJob(job)) {
      addToast({ type: 'info', message: 'Demo rows are not stored on the server.' });
      return;
    }
    const label = (job.name || job.configName || job.id || '').trim() || `Job #${job.id}`;
    if (
      !window.confirm(
        `Remove "${label}" from history?\n\nThis deletes the job and all stored results on the server. This cannot be undone.`
      )
    ) {
      return;
    }
    const ok = await deleteJob(job.id);
    if (ok) addToast({ type: 'success', message: 'Job removed from the server.' });
    else addToast({ type: 'error', message: 'Could not delete job.' });
  };

  const toggleCardExpand = (jobId) => {
    setExpandedJobId((prev) => (prev === jobId ? null : jobId));
  };

  const sortedFilesForJob = (job) =>
    [...(job.files || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  const renderDownloadMenu = (job) => (
    <div className="relative download-menu-container">
      <button
        type="button"
        onClick={(e) => toggleDownloadMenu(e, job.id)}
        className="p-1.5 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-md transition-all group-hover:bg-blue-50 dark:group-hover:bg-slate-800"
        title="Download files"
      >
        <Download size={16} className="text-slate-400 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
      </button>

      {downloadMenuOpen[job.id] && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xl z-50 min-w-[200px]">
          <div className="py-1">
            <button
              type="button"
              onClick={(e) => handleDownload(e, job.id, 'json')}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <FileJson size={16} className="text-blue-600 dark:text-blue-400" />
              <span>Download JSON</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleDownload(e, job.id, 'csv')}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <FileCode size={16} className="text-green-600 dark:text-green-400" />
              <span>Download CSV</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleDownload(e, job.id, 'html')}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <FileCode size={16} className="text-purple-600 dark:text-purple-400" />
              <span>Download HTML Report</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleDownload(e, job.id, 'pdf')}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <FileCode size={16} className="text-red-600 dark:text-red-400" />
              <span>Download PDF Report</span>
            </button>
            <button
              type="button"
              onClick={(e) => handleDownload(e, job.id, 'log')}
              className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
            >
              <FileCode size={16} className="text-orange-600 dark:text-orange-400" />
              <span>Download Logs</span>
            </button>
            {hasFailedFiles(job) && (
              <>
                <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                <button
                  type="button"
                  onClick={(e) => handleDownload(e, job.id, 'failed')}
                  className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-red-50 dark:hover:bg-red-900/40 flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold"
                >
                  <AlertCircle size={16} className="text-red-600" />
                  <span>Download Failed Files ({getFailedFilesCount(job)})</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderJobCard = (job) => {
    const expanded = expandedJobId === job.id;
    return (
      <div
        key={job.id}
        ref={(el) => {
          cardRefs.current[job.id] = el;
        }}
        className={`bg-white dark:bg-slate-900 rounded-lg border transition-all min-w-0 ${
          expanded
            ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-500/40 shadow-sm'
            : 'border-slate-200 dark:border-slate-700 hover:border-blue-300/80 dark:hover:border-slate-600'
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleCardExpand(job.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleCardExpand(job.id);
            }
          }}
          className="px-2.5 py-2 sm:px-3 sm:py-2 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 cursor-pointer group hover:bg-slate-50/80 dark:hover:bg-slate-800/60 rounded-lg"
        >
          <div className="flex items-start gap-2 sm:gap-2.5 min-w-0 flex-1">
            <div
              className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                hasFailedFiles(job)
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-300'
                  : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
              }`}
            >
              {hasFailedFiles(job) ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug truncate">
                {(job.name || job.configName || '').trim() || `Job #${job.id}`}
              </h4>
              <p className="text-slate-500 dark:text-slate-400 text-[11px] sm:text-xs leading-tight mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Clock size={11} className="opacity-70" />
                  {formatDate(job)}
                </span>
                <span className="text-slate-400">·</span>
                <span>{formatDuration(job)}</span>
                <span className="text-slate-400">·</span>
                <span className="inline-flex items-center gap-0.5 min-w-0">
                  <User size={11} className="shrink-0 opacity-70" />
                  <span className="truncate font-medium text-slate-600 dark:text-slate-300">
                    {(job.profileName && String(job.profileName).trim()) || job.clientId || '—'}
                  </span>
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                  {job.completedFiles}/{job.totalFiles}
                </span>
                {hasFailedFiles(job) && (
                  <span className="text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 px-1 py-px rounded flex items-center gap-0.5">
                    <AlertCircle size={10} />
                    {getFailedFilesCount(job)} fail
                  </span>
                )}
                {job.tag && (
                  <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/45 dark:text-purple-300 px-1 py-px rounded">
                    {job.tag}
                  </span>
                )}
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[140px] sm:max-w-[220px]">
                  {job.firmware}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-1 flex-shrink-0 sm:pl-2 border-t border-slate-100 dark:border-slate-800/80 pt-2 sm:border-0 sm:pt-0">
            <div className="text-right leading-none mr-0.5">
              <div
                className={`text-xs font-bold tabular-nums ${
                  hasFailedFiles(job)
                    ? 'text-slate-600 dark:text-slate-300'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {getJobProgress(job)}%
              </div>
              <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 hidden sm:block">done</div>
            </div>
            {hasFailedFiles(job) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(e, job.id, 'failed');
                }}
                className="px-2 py-1 bg-red-600 text-white rounded-md text-[11px] font-semibold hover:bg-red-700 transition-colors inline-flex items-center gap-1 shadow-sm"
                title={`Download failed files report (${getFailedFilesCount(job)} failed)`}
              >
                <Download size={12} />
                <span className="hidden sm:inline">Failed</span>
                <span className="bg-red-800/80 px-1 rounded text-[10px] font-bold tabular-nums">{getFailedFilesCount(job)}</span>
              </button>
            )}
            {renderDownloadMenu(job)}
            {!isDemoHistoryJob(job) && (
              <button
                type="button"
                onClick={(e) => handleDeleteJob(e, job)}
                className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-300 transition-colors"
                title="Delete job from server"
              >
                <Trash2 size={16} />
              </button>
            )}
            {typeof onViewJob === 'function' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewJob(job.id);
                }}
                className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:hover:text-blue-300 transition-colors"
                title="Open in Jobs Manager"
              >
                <ExternalLink size={16} />
              </button>
            )}
            {expanded ? (
              <ChevronUp className="text-blue-500 dark:text-blue-400 transition-colors shrink-0" size={16} />
            ) : (
              <ChevronDown className="text-slate-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors shrink-0" size={16} />
            )}
          </div>
        </div>

        {expanded && (
          <div className="px-2.5 sm:px-3 pb-3 border-t border-slate-200 dark:border-slate-700">
            <div className="pt-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              Test cases run
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-1 font-semibold">#</th>
                    <th className="px-2 py-1 font-semibold">Test case</th>
                    <th className="px-2 py-1 font-semibold">Status</th>
                    <th className="px-2 py-1 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {sortedFilesForJob(job).map((file) => (
                    <tr key={file.id ?? `${job.id}-${file.order}`} className="bg-white dark:bg-slate-900">
                      <td className="px-2 py-1 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">{file.order ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-800 dark:text-slate-100 font-medium">{getTestCaseDisplayName(file)}</td>
                      <td className="px-2 py-1 text-slate-600 dark:text-slate-300">{file.status || '—'}</td>
                      <td className="px-2 py-1">
                        <span
                          className={`font-semibold ${
                            file.result === 'pass'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : file.result === 'fail'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {file.result || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTwoColumns = (errorList, completedList) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <section className="rounded-xl border border-red-200/70 dark:border-red-900/45 bg-red-50/25 dark:bg-red-950/15 p-2 sm:p-2.5 min-w-0">
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
          <h2 className="text-xs font-bold text-red-700 dark:text-red-300 uppercase tracking-wide">Error</h2>
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-100 dark:bg-red-900/50 text-[10px] font-bold text-red-800 dark:text-red-200 tabular-nums">
            {errorList.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {errorList.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1 py-3 text-center">No jobs in this group.</p>
          ) : (
            errorList.map((job) => renderJobCard(job))
          )}
        </div>
      </section>
      <section className="rounded-xl border border-emerald-200/70 dark:border-emerald-900/45 bg-emerald-50/25 dark:bg-emerald-950/15 p-2 sm:p-2.5 min-w-0">
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
          <h2 className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Completed</h2>
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-[10px] font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">
            {completedList.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {completedList.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1 py-3 text-center">No jobs in this group.</p>
          ) : (
            completedList.map((job) => renderJobCard(job))
          )}
        </div>
      </section>
    </div>
  );

  if (loading?.jobs) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-6 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
        Loading history...
      </div>
    );
  }

  if (errors?.jobs) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        Failed to load history: {errors.jobs}
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-1.5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">Test History</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-0.5 text-xs sm:text-sm leading-snug">
            Two columns by outcome; click a row to expand test cases here.
          </p>
        </div>
        <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 flex-shrink-0 text-right tabular-nums">
          <div>
            {historyJobsShownCount} job{historyJobsShownCount !== 1 ? 's' : ''} shown
          </div>
          <div className="text-[11px] opacity-80">
            {completedJobs.length} on server
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-1">
          {[
            { key: 'all', label: 'All' },
            { key: 'passed', label: 'Passed' },
            { key: 'failed', label: 'Failed' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setStatusFilter(opt.key)}
              className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-full transition-colors ${
                statusFilter === opt.key
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setGroupByDate((v) => !v)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-full border transition-colors ${
            groupByDate
              ? 'border-blue-400 bg-blue-50 text-blue-800 dark:border-blue-600 dark:bg-blue-950/50 dark:text-blue-200'
              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Layers size={14} className="shrink-0" />
          Group by date
        </button>
        <div className="flex-1 min-w-[200px] lg:max-w-md">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by job name, tag, or who ran it"
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {historyJobsShownCount === 0 && (
          <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl py-8 px-3 text-center text-slate-500 dark:text-slate-400 text-sm">
            No history matches the current filters.
          </div>
        )}

        {groupByDate && groupedByDate && groupedByDate.length > 0 && (
          <div className="space-y-5">
            {groupedByDate.map((row) => (
              <div key={row.dayKey} className="space-y-2">
                <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 pb-1.5">
                  {row.label}
                  <span className="ml-2 font-normal text-slate-400 tabular-nums">{row.dayKey}</span>
                </h3>
                {renderTwoColumns(row.error, row.completed)}
              </div>
            ))}
          </div>
        )}

        {!groupByDate && historyJobsShownCount > 0 && renderTwoColumns(filteredErrorCol, filteredCompletedCol)}
      </div>
    </div>
  );
};

// --- HELPER COMPONENTS ---

const StatCard = ({ icon, label, value, sub, onClick }) => {
  const isClickable = typeof onClick === 'function';
  return (
  <div
    className={`bg-white dark:bg-slate-900 px-4 py-3 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm transition-shadow ${
      isClickable ? 'cursor-pointer hover:shadow-md hover:border-blue-200 dark:hover:border-slate-600' : 'hover:shadow-md'
    }`}
    onClick={onClick}
  >
    <div className="flex items-center gap-3 mb-3">
      <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl">{icon}</div>
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
    <div className="text-[11px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-[0.18em]">{label}</div>
    <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 italic">{sub}</div>
  </div>
  );
};

const ActiveJobCard = ({ job, onClick }) => {
  return (
    <div 
      className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-600 hover:shadow-md transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-slate-700 dark:text-slate-200">Job #{job.id}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              job.status === 'running' ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}>
              {job.status}
            </span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">{job.name}</div>
          <div className="text-xs text-slate-400 dark:text-slate-400 mt-1">
            {job.totalFiles} Files | {job.firmware} | Boards: {job.boards?.join(', ')}
          </div>
        </div>
        <span className="text-sm font-bold text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/40 px-3 py-1 rounded-lg">
          {job.progress}%
        </span>
      </div>
      <div className="mb-2">
        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
          <span>Progress: {job.completedFiles}/{job.totalFiles} files completed</span>
          <span>{job.progress}%</span>
    </div>
    <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 transition-all duration-1000" style={{ width: `${job.progress}%` }}></div>
        </div>
      </div>
      <div className="text-xs text-slate-400 dark:text-slate-400 mt-2">
        ⏱ Started: {job.startedAt} | ETA: ~{Math.ceil((100 - job.progress) / 5)} min
    </div>
  </div>
);
};

const FileItem = ({ name, size }) => (
  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-300 transition-all cursor-pointer">
    <FileCode className="text-slate-400" size={18} />
    <div className="flex-1 overflow-hidden">
      <div className="text-sm font-bold truncate">{name}</div>
      <div className="text-[10px] text-slate-400 uppercase font-bold">{size}</div>
    </div>
  </div>
);

export default HistoryPage;
