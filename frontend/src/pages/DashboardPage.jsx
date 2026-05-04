import React, { useMemo, useState, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Cpu,
  HardDrive,
  Layers,
  Monitor,
  Search,
  X,
  Zap,
  FileCode,
  Download,
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import { getClientId } from '../utils/sessionStorage';
import { resolveJobOwnerDisplayName } from '../utils/profileOwnerLabel';
import { jobTagPillClasses, TAG_PALETTE_KEYS, TAG_SWATCH_DOT_CLASS, normalizeTagColorKey, getJobPrimaryTagColorKey, jobHasAnyTagColor } from '../utils/tagPalette';

const StatCard = ({ icon, label, value, sub, onClick, title: statTitle }) => {
  const isClickable = typeof onClick === 'function';
  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      title={statTitle || (isClickable ? `${label} — Open in Jobs or Fleet Manager` : undefined)}
      className={`bg-white dark:bg-slate-900 px-4 py-3 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm transition-shadow ${
        isClickable ? 'cursor-pointer hover:shadow-md hover:border-blue-200 dark:hover:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900' : 'hover:shadow-md'
      }`}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.(e);
              }
            }
          : undefined
      }
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

const BatchDetailsModal = ({ batch, onClose }) => (
  <>
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
          <div>
            <h2 className="text-2xl font-bold">{batch.name || `Job #${batch.id}`}</h2>
            <p className="text-sm text-slate-500 mt-1">
              ID: {batch.id} • {batch.completedFiles}/{batch.totalFiles} files completed • {batch.progress}%
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">Firmware</div>
              <div className="text-sm font-bold">{batch.firmware}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">Boards</div>
              <div className="text-sm font-bold">{batch.boards?.join(', ')}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">Started</div>
              <div className="text-sm font-bold">{batch.startedAt}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">Status</div>
              <div className="text-sm font-bold capitalize">{batch.status}</div>
            </div>
          </div>

          <div>
            <h3 className="font-bold mb-3">Files in Batch</h3>
            <div className="space-y-2">
              {batch.files && batch.files.length > 0 ? (
                batch.files.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileCode size={18} className="text-slate-400" />
                      <span className="text-sm font-bold">{file.testCaseName || (file.order != null ? `Test case ${file.order}` : '—')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        file.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : file.status === 'running'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-700'
                      }`}>
                        {file.status}
                      </span>
                      {file.result && (
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          file.result === 'pass' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {file.result}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <p>File details will appear here as they are processed</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  </>
);

const DashboardPage = ({ onNavigateBoards, onNavigateJobs, onManageTags }) => {
  const {
    systemHealth,
    boards,
    jobs,
    commonCommands,
    updateJobTag,
    loading,
    errors,
  } = useTestStore();
  const boardQueuePaused = useTestStore((state) => state.boardQueuePaused || {});
  const profiles = useTestStore((s) => s.profiles) || [];
  const sharedProfiles = useTestStore((s) => s.sharedProfiles) || [];
  const serverProfileDirectory = useTestStore((s) => s.serverProfileDirectory) || [];
  const activeProfileId = useTestStore((s) => s.activeProfileId);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || { id: 'default', name: 'Default' };
  const jobOwnerLabelCtx = useMemo(
    () => ({
      profiles,
      sharedProfiles,
      serverProfileDirectory,
      activeProfileId,
      activeProfileName: activeProfile.name,
      currentClientId: getClientId(),
    }),
    [profiles, sharedProfiles, serverProfileDirectory, activeProfileId, activeProfile.name]
  );

  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showBatchDetails, setShowBatchDetails] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(null);
  const setDashboardSystemSummary = useTestStore((s) => s.setDashboardSystemSummary);
  const {
    systemSearch,
    systemStatusFilter,
    systemTagFilter,
    systemTagColorFilter,
    systemOwnerFilter,
    systemBoardFilter,
    systemDateFilter,
    isSystemSummaryExpanded,
  } = useTestStore((s) => s.dashboardSystemSummary);
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState(false);
  const [tagColorDropdownOpen, setTagColorDropdownOpen] = useState(false);
  const [editingSystemTagId, setEditingSystemTagId] = useState(null);
  const [systemTagEditInput, setSystemTagEditInput] = useState('');
  const [systemModalJobId, setSystemModalJobId] = useState(null);
  const [systemModalBoardId, setSystemModalBoardId] = useState(null);

  useEffect(() => {
    if (!ownerDropdownOpen) return;
    const onMouseDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-owner-dropdown-root]')) return;
      setOwnerDropdownOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [ownerDropdownOpen]);

  useEffect(() => {
    if (!tagColorDropdownOpen) return;
    const onMouseDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-tagcolor-dropdown-root]')) return;
      setTagColorDropdownOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [tagColorDropdownOpen]);

  /** Default/legacy owner filter → active profile id so the Owner chip shows the profile name. */
  useEffect(() => {
    if (systemOwnerFilter !== 'mine' && systemOwnerFilter !== '__active__') return;
    setDashboardSystemSummary({
      systemOwnerFilter: activeProfileId ? String(activeProfileId) : 'all',
    });
  }, [systemOwnerFilter, activeProfileId, setDashboardSystemSummary]);

  const dashboardDemoBoards = useMemo(
    () => [
      {
        id: 'BOARD-1',
        name: 'Demo Board 1',
        status: 'online',
        ip: '192.168.0.10',
        mac: '00:11:22:33:44:55',
        firmware: 'v1.0.0',
        model: 'Zybo',
        tag: 'paused',
        fpgaStatus: 'unknown',
        armStatus: 'online',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: true,
        isDemo: true,
      },
      {
        id: 'BOARD-2',
        name: 'Line A – Ready',
        status: 'online',
        ip: '192.168.0.11',
        mac: '00:11:22:33:44:66',
        firmware: 'v1.0.3',
        model: 'Zybo',
        tag: 'line-a',
        fpgaStatus: 'active',
        armStatus: 'online',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-3',
        name: 'Burn-in Tester 1',
        status: 'busy',
        ip: '192.168.0.21',
        mac: '00:11:22:33:44:88',
        firmware: 'v1.1.0',
        model: 'Zybo',
        tag: 'burn-in',
        fpgaStatus: 'active',
        armStatus: 'busy',
        currentJob: '10Mar ',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-4',
        name: 'Demo Board – Busy',
        status: 'busy',
        ip: '192.168.0.22',
        mac: '00:11:22:33:44:99',
        firmware: 'v1.0.5',
        model: 'Zybo',
        tag: 'running',
        fpgaStatus: 'active',
        armStatus: 'busy',
        currentJob: 'test-1',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-ERR',
        name: 'Demo Error Board',
        status: 'error',
        ip: '192.168.0.31',
        mac: '00:11:22:33:44:77',
        firmware: 'v1.0.0',
        model: 'Zybo',
        tag: 'error',
        fpgaStatus: 'error',
        armStatus: 'offline',
        currentJob: 'Idle',
        voltage: '3.3',
        queuePaused: false,
        isDemo: true,
      },
      {
        id: 'BOARD-OFF',
        name: 'Spare Board (offline)',
        status: 'error',
        ip: '192.168.0.32',
        mac: '00:11:22:33:44:AA',
        firmware: 'v0.9.0',
        model: 'Zybo',
        tag: 'maintenance',
        fpgaStatus: 'offline',
        armStatus: 'offline',
        currentJob: '—',
        voltage: '0.0',
        queuePaused: false,
        isDemo: true,
      },
    ],
    []
  );

  const fleetBoards = useMemo(() => {
    const realBoards = boards || [];
    const byId = new Map();
    realBoards.forEach((b) => {
      byId.set(String(b.id), b);
    });
    dashboardDemoBoards.forEach((demo) => {
      const id = String(demo.id);
      const base = byId.get(id) || {};
      byId.set(id, { ...base, ...demo });
    });
    const merged = Array.from(byId.values());
    return merged.map((b) => {
      const override = boardQueuePaused[String(b.id)];
      return override === undefined ? b : { ...b, queuePaused: override };
    });
  }, [boards, dashboardDemoBoards, boardQueuePaused]);

  const fleetTotalBoards = fleetBoards.length;
  /** Dashboard fleet KPIs: count all online/busy operational boards (includes queue-paused). Run SetAssignment may still block paused boards separately. */
  const isFleetStatLiveBoard = (b) => {
    const st = String(b?.status || '').toLowerCase();
    if (st === 'error' || st === 'offline') return false;
    return st === 'online' || st === 'busy';
  };
  const fleetOnlineBoards = fleetBoards.filter(
    (b) => isFleetStatLiveBoard(b) && String(b?.status || '').toLowerCase() === 'online',
  ).length;
  const fleetBusyBoards = fleetBoards.filter(
    (b) => isFleetStatLiveBoard(b) && String(b?.status || '').toLowerCase() === 'busy',
  ).length;
  /** Boards user can attach work to — excludes error/offline and queue-paused (matches Run Set behavior). Shown nowhere by default; use for tooltip / future badge. */
  const fleetSelectableCombined = fleetBoards.filter((b) => {
    const st = String(b?.status || '').toLowerCase();
    if (st === 'error' || st === 'offline') return false;
    if (b?.queuePaused) return false;
    return st === 'online' || st === 'busy';
  }).length;

  /** Used for Device Progress / queue semantics — excludes queue-paused boards from “available”. */
  const isBoardSelectable = (b) => {
    const st = String(b?.status || '').toLowerCase();
    if (st === 'error' || st === 'offline') return false;
    if (b?.queuePaused) return false;
    return st === 'online' || st === 'busy';
  };

  const pendingJobs = useMemo(() => (jobs || []).filter((j) => j.status === 'pending'), [jobs]);
  const jobQueueCount = pendingJobs.length;
  const jobsInErrorBucket = useMemo(
    () =>
      (jobs || []).filter((job) => {
        if (job.status !== 'completed' && job.status !== 'stopped') return false;
        return (job.files || []).some((f) => {
          const result = (f.result || '').toLowerCase();
          const status = (f.status || '').toLowerCase();
          return result === 'fail' || status === 'error';
        });
      }),
    [jobs],
  );
  const jobErrorCount = jobsInErrorBucket.length;

  const clientId = getClientId();
  const systemSearchLower = systemSearch.trim().toLowerCase();
  const systemTagOptions = [...new Set(jobs.map((j) => j.tag).filter(Boolean))].sort();
  const systemBoardOptions = [...new Set((jobs || []).flatMap((j) => Array.isArray(j.boards) ? j.boards : []).filter(Boolean))].sort();

  const allOwnerProfiles = useMemo(() => {
    // De-dupe by display name (not by id) so Owner dropdown does not repeat the same person
    // just because they created many jobs or appear in multiple directories.
    const norm = (s) => String(s || '').trim().toLowerCase();
    const pickKey = (p) => norm(p?.name) || norm(p?.id);

    // Priority: local profiles first, then shared, then server directory.
    const list = [
      ...(Array.isArray(profiles) ? profiles : []),
      ...(Array.isArray(sharedProfiles) ? sharedProfiles : []),
      ...(Array.isArray(serverProfileDirectory) ? serverProfileDirectory : []),
    ];

    const byDisplay = new Map(); // key -> profile
    list.forEach((p) => {
      if (!p || !p.id) return;
      const k = pickKey(p);
      if (!k) return;
      if (!byDisplay.has(k)) byDisplay.set(k, p);
    });

    // Also ensure active profile is present and wins for its display name.
    const active = (Array.isArray(profiles) ? profiles : []).find((p) => String(p?.id) === String(activeProfileId));
    if (active?.id) {
      const k = pickKey(active);
      if (k) byDisplay.set(k, active);
    }

    return Array.from(byDisplay.values()).sort((a, b) =>
      String(a?.name || a?.id).localeCompare(String(b?.name || b?.id))
    );
  }, [profiles, sharedProfiles, serverProfileDirectory]);

  const ownerColorKeyFromText = (text) => {
    const s = String(text || '');
    if (!s) return 'mint';
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
    const keys = TAG_PALETTE_KEYS;
    const k = keys[sum % keys.length];
    return k || 'mint';
  };

  const ownerTagColorByProfileId = useMemo(() => {
    const counts = new Map(); // pid -> key->count
    (jobs || []).forEach((job) => {
      const pid = job?.profileId ?? job?.profile_id ?? null;
      if (!pid) return;
      const key = getJobPrimaryTagColorKey(job);
      const pidStr = String(pid);
      if (!counts.has(pidStr)) counts.set(pidStr, new Map());
      const m = counts.get(pidStr);
      m.set(key, (m.get(key) || 0) + 1);
    });

    const out = new Map();
    counts.forEach((m, pid) => {
      let bestKey = 'mint';
      let best = -1;
      m.forEach((v, k) => {
        if (v > best) {
          best = v;
          bestKey = k;
        }
      });
      out.set(pid, bestKey);
    });
    return out;
  }, [jobs]);

  const mineTagColorKey = useMemo(() => {
    const counts = new Map();
    (jobs || []).forEach((job) => {
      if (!job) return;
      if (job.clientId !== clientId) return;
      const key = getJobPrimaryTagColorKey(job);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    let bestKey = 'mint';
    let best = -1;
    counts.forEach((v, k) => {
      if (v > best) {
        best = v;
        bestKey = k;
      }
    });
    return bestKey;
  }, [jobs, clientId]);

  const othersTagColorKey = useMemo(() => {
    const counts = new Map();
    (jobs || []).forEach((job) => {
      if (!job) return;
      if (job.clientId === clientId || !job.clientId) return;
      const key = getJobPrimaryTagColorKey(job);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    let bestKey = 'mint';
    let best = -1;
    counts.forEach((v, k) => {
      if (v > best) {
        best = v;
        bestKey = k;
      }
    });
    return bestKey;
  }, [jobs, clientId]);

  const toYMD = (raw) => {
    if (!raw) return '';
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const systemOwnerFilterResolved = useMemo(() => {
    if (systemOwnerFilter === 'mine' || systemOwnerFilter === '__active__') {
      return activeProfileId ? String(activeProfileId) : 'all';
    }
    return systemOwnerFilter;
  }, [systemOwnerFilter, activeProfileId]);

  const systemSummaryJobs = jobs.filter((job) => {
    if (systemStatusFilter !== 'all' && job.status !== systemStatusFilter) return false;
    if (systemTagFilter && (job.tag || '').toLowerCase() !== systemTagFilter.toLowerCase()) return false;
    if (systemTagColorFilter && !jobHasAnyTagColor(job, systemTagColorFilter)) return false;
    if (systemBoardFilter !== 'all' && systemBoardFilter) {
      const bq = systemBoardFilter.toLowerCase();
      const hasBoard = (Array.isArray(job.boards) ? job.boards : []).some((b) => String(b || '').toLowerCase() === bq);
      if (!hasBoard) return false;
    }
    if (systemDateFilter) {
      const ymd = toYMD(job.startedAt || job.createdAt);
      if (ymd !== systemDateFilter) return false;
    }
    if (systemOwnerFilterResolved === 'others' && (job.clientId === clientId || !job.clientId)) return false;
    if (systemOwnerFilterResolved !== 'all' && systemOwnerFilterResolved !== 'others') {
      const targetProfile = allOwnerProfiles.find((p) => String(p.id) === String(systemOwnerFilterResolved));
      const targetName = targetProfile?.name || targetProfile?.id || String(systemOwnerFilterResolved);

      const pid = job.profileId ?? job.profile_id ?? null;
      const ownerName = resolveJobOwnerDisplayName(job, jobOwnerLabelCtx);
      const pidMatch = pid != null && String(pid) === String(systemOwnerFilterResolved);
      const nameMatch = ownerName && targetName && ownerName === targetName;
      if (!pidMatch && !nameMatch) return false;
    }
    if (systemSearchLower) {
      const name = (job.name || '').toLowerCase();
      const id = (job.id || '').toLowerCase();
      if (!name.includes(systemSearchLower) && !id.includes(systemSearchLower)) {
        return false;
      }
    }
    return true;
  });

  // Some owners may exist only as "clientId -> displayName" mapping learned from jobs,
  // so they might not be present in profiles/sharedProfiles/serverProfileDirectory.
  // Add those resolved display names so Owner dropdown never misses an active owner.
  const jobResolvedOwnerNames = useMemo(() => {
    const set = new Set();
    (jobs || []).forEach((job) => {
      const name = resolveJobOwnerDisplayName(job, jobOwnerLabelCtx);
      if (!name || name === '—') return;
      set.add(String(name));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [jobs, jobOwnerLabelCtx]);

  const jobOwnerNamesNotInProfiles = useMemo(() => {
    const profileNames = new Set(
      (allOwnerProfiles || []).map((p) => String(p?.name || p?.id || '')).filter(Boolean),
    );
    return jobResolvedOwnerNames.filter((n) => !profileNames.has(String(n)));
  }, [jobResolvedOwnerNames, allOwnerProfiles]);

  const myOwnerProfileIds = useMemo(() => {
    const set = new Set();
    (jobs || []).forEach((job) => {
      if (!job) return;
      if (job.clientId !== clientId) return;
      const pid = job.profileId ?? job.profile_id ?? null;
      if (!pid) return;
      set.add(String(pid));
    });
    return set;
  }, [jobs, clientId]);

  const myOwnerResolvedNames = useMemo(() => {
    const set = new Set();
    (jobs || []).forEach((job) => {
      if (!job) return;
      if (job.clientId !== clientId) return;
      const name = resolveJobOwnerDisplayName(job, jobOwnerLabelCtx);
      if (!name || name === '—') return;
      set.add(String(name));
    });
    return set;
  }, [jobs, clientId, jobOwnerLabelCtx]);

  const systemSummary = systemSummaryJobs.map((job) => {
    const rawAt = job.startedAt || job.createdAt;
    const d = rawAt ? new Date(rawAt) : null;
    const displayDate = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const displayTime = d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
    const ownerLabel = resolveJobOwnerDisplayName(job, jobOwnerLabelCtx);
    const tagsArr = Array.isArray(job?.tags) ? job.tags.filter((t) => t && (t.tag || t.name)) : [];
    const primaryTag = tagsArr.length
      ? (tagsArr[0].tag || tagsArr[0].name || '').toString()
      : (job.tag || 'Untagged');
    return {
      jobId: job.id,
      jobName: job.name,
      tag: primaryTag || 'Untagged',
      tagColor: getJobPrimaryTagColorKey(job),
      extraTagCount: Math.max(0, tagsArr.length - 1),
      boards: job.boards || [],
      status: job.status,
      totalFiles: job.totalFiles ?? (job.files ? job.files.length : 0),
      firmware: job.firmware,
      ownerLabel,
      displayDate,
      displayTime,
    };
  });

  const availableBoards = fleetBoards.filter((b) => {
    const st = String(b?.status || '').toLowerCase();
    return isBoardSelectable(b) && st === 'online' && !b.currentJob;
  }).length;
  const queuedBoardsLeft = availableBoards;
  const deviceProgressRows = fleetBoards.map((b) => {
    const boardKey = (b.name || b.id || '').toString();
    let jobId = (b.currentJob || '').replace(/^(Batch|Set) #/, '');
    let job = jobs.find((j) => j.id === jobId);
    if (!job) {
      job =
        jobs.find((j) => (j.status === 'running') && (j.boards || []).some((jb) => (jb || '').toString() === boardKey)) ||
        jobs.find((j) => (j.status === 'pending') && (j.boards || []).some((jb) => (jb || '').toString() === boardKey)) ||
        null;
    }
    if (!job && (b.status || '').toLowerCase() === 'busy' && b.currentJob) {
      job = {
        id: `DEMO-${b.id}`,
        name: (b.currentJob || '').toString(),
        status: 'running',
        boards: [boardKey],
        clientId: clientId,
        files: [],
        progress: 0,
        completedFiles: 0,
        totalFiles: 0,
      };
    }
    const progress = job ? job.progress : 0;
    const completedFiles = job ? job.completedFiles ?? 0 : 0;
    const totalFiles = job ? job.totalFiles ?? (job.files ? job.files.length : 0) : 0;
    const remainingFiles = Math.max(0, totalFiles - completedFiles);
    const jobsWaitingForBoard = pendingJobs.filter(
      (j) => !(j.boards || []).length || (j.boards || []).some((jb) => (jb || '').toString() === boardKey)
    ).length;
    return { board: b, progress, job, completedFiles, totalFiles, remainingFiles, jobsWaitingForBoard };
  });

  const handleCopyCommand = (command) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const hasDashboardError = errors?.systemHealth || errors?.boards || errors?.jobs;
  const isDashboardLoading = loading?.systemHealth || loading?.boards || loading?.jobs;

  const goToBoardStatus = (boardFocusId) => {
    if (onNavigateBoards) onNavigateBoards(boardFocusId ?? null);
  };

  const goToJobManager = (jobId = null, options = {}) => {
    if (onNavigateJobs) onNavigateJobs(jobId, options);
  };

  const setBoardsPageFocusBoardIdGlobal = useTestStore((s) => s.setBoardsPageFocusBoardId);
  const setBoardsFleetStatusPresetGlobal = useTestStore((s) => s.setBoardsFleetStatusPreset);

  const openFleetFiltered = (preset) => {
    setBoardsPageFocusBoardIdGlobal(null);
    setBoardsFleetStatusPresetGlobal(preset === 'busy' ? 'busy' : 'online');
    goToBoardStatus(null);
  };

  const openJobsErrorFocused = () => {
    const jid = jobsInErrorBucket.length > 0 ? jobsInErrorBucket[0]?.id ?? null : null;
    goToJobManager(jid, { jobsStatusFilter: 'error' });
  };

  const openJobsPendingFocused = () => {
    const jid = pendingJobs.length > 0 ? pendingJobs[0]?.id ?? null : null;
    goToJobManager(jid, { jobsStatusFilter: 'pending' });
  };

  const systemModalJob = systemModalJobId ? jobs.find((j) => j.id === systemModalJobId) : null;

  const systemModalBoardRow = systemModalBoardId
    ? deviceProgressRows.find((r) => (r.board?.id || r.board?.name) === systemModalBoardId)
    : null;

  const getDashboardTestCaseDisplayName = (file) =>
    file?.testCaseName || (file?.order != null ? `Test case ${file.order}` : '—');

  const systemModalFiles = systemModalJob?.files ? [...systemModalJob.files].sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
  const systemModalRunningFiles = systemModalFiles.filter((f) => (f.status || '').toLowerCase() === 'running');
  const systemModalFailedFiles = systemModalFiles.filter((f) => {
    const result = (f.result || '').toLowerCase();
    const status = (f.status || '').toLowerCase();
    return result === 'fail' || status === 'error' || status === 'failed';
  });
  let systemModalSummaryText = '';
  if (systemModalJob) {
    const status = (systemModalJob.status || '').toLowerCase();
    if (status === 'pending') {
      systemModalSummaryText = 'Pending — waiting to start';
    } else if (status === 'running') {
      if (systemModalRunningFiles.length > 0) {
        const names = systemModalRunningFiles
          .slice(0, 2)
          .map((f) => getDashboardTestCaseDisplayName(f))
          .join(', ');
        systemModalSummaryText =
          systemModalRunningFiles.length > 1
            ? `Running test cases: ${names}${systemModalRunningFiles.length > 2 ? ` +${systemModalRunningFiles.length - 2} more` : ''}`
            : `Running test case: ${names}`;
      } else {
        systemModalSummaryText = 'Running — waiting for next test case';
      }
    } else if (status === 'completed' || status === 'stopped') {
      if (systemModalFailedFiles.length > 0) {
        systemModalSummaryText = `Completed with ${systemModalFailedFiles.length} failed test case(s)`;
      } else {
        systemModalSummaryText = 'Set completed';
      }
    }
  }

  return (
    <div className="space-y-2.5 min-w-0">
      {(hasDashboardError || isDashboardLoading) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          hasDashboardError
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}>
          {hasDashboardError
            ? `Failed to load dashboard data: ${hasDashboardError}`
            : 'Loading dashboard data...'}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          icon={<CheckCircle2 className="text-emerald-500" />}
          label="Online"
          value={fleetOnlineBoards}
          sub={`${fleetTotalBoards} total · ${fleetSelectableCombined} ready for Run`}
          title="Fleet Manager — filter Online boards"
          onClick={() => openFleetFiltered('online')}
        />
        <StatCard
          icon={<Zap className="text-blue-500" />}
          label="Busy"
          value={fleetBusyBoards}
          sub="Running board"
          title="Fleet Manager — filter Busy boards"
          onClick={() => openFleetFiltered('busy')}
        />
        <StatCard
          icon={<AlertCircle className="text-red-500" />}
          label="Job Errors"
          value={jobErrorCount}
          sub="Set with failed tests"
          title="Jobs Manager — Error column; expands first error set if present"
          onClick={openJobsErrorFocused}
        />
        <StatCard
          icon={<Activity className="text-purple-500" />}
          label="Job Queue"
          value={jobQueueCount}
          sub="Set waiting to run"
          title="Jobs Manager — Pending column; expands first queued set if present"
          onClick={openJobsPendingFocused}
        />
        <StatCard
          icon={<HardDrive className="text-orange-500" />}
          label="Storage"
          value={`${systemHealth.storageUsage}%`}
          sub={`${systemHealth.storageUsed} / ${systemHealth.storageTotal}`}
        />
      </div>

      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers size={20} className="text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">System Summary</h2>
            {systemSummary.length > 0 && (
              <span className="text-sm text-slate-500 dark:text-slate-400 font-normal">
                ({systemSummary.length} {systemSummary.length === 1 ? 'system' : 'systems'})
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={systemSearch}
                onChange={(e) => setDashboardSystemSummary({ systemSearch: e.target.value })}
                placeholder="Name (or ID)"
                className="pl-7 pr-2 py-1.5 text-xs border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800 rounded-full px-1 py-0.5 flex-wrap" data-owner-dropdown-root>
              {(() => {
                const selectedKey = systemOwnerFilterResolved;
                const selectedProfile = allOwnerProfiles.find((p) => String(p.id) === String(selectedKey));
                const ownerButtonLabel =
                  selectedKey === 'all'
                    ? 'All owners'
                    : selectedKey === 'others'
                      ? 'Other clients'
                      : (selectedProfile?.name || selectedProfile?.id || String(selectedKey));

                return (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOwnerDropdownOpen((v) => !v)}
                      className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 inline-flex items-center gap-2"
                      title="Owner"
                    >
                      <span className="max-w-[160px] break-words">{ownerButtonLabel}</span>
                    </button>
                    {ownerDropdownOpen && (
                      <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg w-[260px] max-h-[360px] overflow-y-auto">
                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">Owner</div>
                        <div className="px-2 pb-2">
                          {[
                            { value: 'all', label: 'All owners' },
                            { value: 'others', label: 'Other clients' },
                          ].map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              onClick={() => {
                                setDashboardSystemSummary({ systemOwnerFilter: o.value });
                                setOwnerDropdownOpen(false);
                              }}
                              className={`w-full px-2 py-2 rounded-md text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 ${
                                systemOwnerFilterResolved === o.value ? 'bg-slate-100 dark:bg-slate-700' : ''
                              }`}
                              title={o.label}
                            >
                              <span className="break-words">{o.label}</span>
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-slate-200 dark:border-slate-700" />
                        <div className="py-1">
                          {[...allOwnerProfiles]
                            .sort((a, b) => {
                              const arank = myOwnerProfileIds.has(String(a?.id)) || myOwnerResolvedNames.has(String(a?.name)) ? 0 : 1;
                              const brank = myOwnerProfileIds.has(String(b?.id)) || myOwnerResolvedNames.has(String(b?.name)) ? 0 : 1;
                              if (arank !== brank) return arank - brank;
                              return String(a?.name || a?.id).localeCompare(String(b?.name || b?.id));
                            })
                            .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setDashboardSystemSummary({ systemOwnerFilter: String(p.id) });
                                setOwnerDropdownOpen(false);
                              }}
                              className={`w-full px-2 py-2 rounded-md text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 ${
                                String(systemOwnerFilterResolved) === String(p.id) ? 'bg-slate-100 dark:bg-slate-700' : ''
                              }`}
                              title={p.name || p.id}
                            >
                              <span className="break-words">{p.name || p.id}</span>
                            </button>
                          ))}
                          {[...jobOwnerNamesNotInProfiles]
                            .sort((a, b) => {
                              const arank = myOwnerResolvedNames.has(String(a)) ? 0 : 1;
                              const brank = myOwnerResolvedNames.has(String(b)) ? 0 : 1;
                              if (arank !== brank) return arank - brank;
                              return String(a).localeCompare(String(b));
                            })
                            .map((name) => (
                            <button
                              key={`jobOwnerName-${name}`}
                              type="button"
                              onClick={() => {
                                setDashboardSystemSummary({ systemOwnerFilter: String(name) });
                                setOwnerDropdownOpen(false);
                              }}
                              className={`w-full px-2 py-2 rounded-md text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 ${
                                String(systemOwnerFilterResolved) === String(name) ? 'bg-slate-100 dark:bg-slate-700' : ''
                              }`}
                              title={name}
                            >
                              <span className="break-words">{name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              <select
                value={systemStatusFilter}
                onChange={(e) => setDashboardSystemSummary({ systemStatusFilter: e.target.value })}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Batch status"
              >
                <option value="running">Running</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="stopped">Stopped</option>
                <option value="all">All Status</option>
              </select>
              <select
                value={systemTagFilter}
                onChange={(e) => setDashboardSystemSummary({ systemTagFilter: e.target.value })}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Tag"
              >
                <option value="">All Tags</option>
                {systemTagOptions.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              {(() => {
                const tagColorDotKey = systemTagColorFilter ? normalizeTagColorKey(systemTagColorFilter) : 'mint';
                const isAll = !systemTagColorFilter;
                return (
                  <div className="relative" data-tagcolor-dropdown-root>
                    <button
                      type="button"
                      onClick={() => setTagColorDropdownOpen((v) => !v)}
                      className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 inline-flex items-center gap-2"
                      title="Tag color"
                    >
                      <span
                        className={`inline-flex w-2.5 h-2.5 rounded-full ${isAll ? 'bg-slate-400 dark:bg-slate-600' : (TAG_SWATCH_DOT_CLASS[tagColorDotKey] || TAG_SWATCH_DOT_CLASS.mint)}`}
                        aria-hidden
                      />
                      <span className="sr-only">{isAll ? 'All tag colors' : systemTagColorFilter}</span>
                    </button>
                    {tagColorDropdownOpen && (
                      <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg w-[140px] max-h-[320px] overflow-y-auto">
                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">Tag color</div>
                        <div className="p-2 space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              setDashboardSystemSummary({ systemTagColorFilter: '' });
                              setTagColorDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-start px-2 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 ${isAll ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                            title="All tag colors"
                          >
                            <span className="inline-flex w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-600" aria-hidden />
                            <span className="sr-only">All tag colors</span>
                          </button>
                          {TAG_PALETTE_KEYS.map((k) => {
                            const isSelected = systemTagColorFilter === k;
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => {
                                  setDashboardSystemSummary({ systemTagColorFilter: k });
                                  setTagColorDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-start px-2 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 ${isSelected ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
                                title={k}
                              >
                                <span className={`inline-flex w-2.5 h-2.5 rounded-full ${TAG_SWATCH_DOT_CLASS[k] || TAG_SWATCH_DOT_CLASS.mint}`} aria-hidden />
                                <span className="sr-only">{k}</span>
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
                value={systemBoardFilter}
                onChange={(e) => setDashboardSystemSummary({ systemBoardFilter: e.target.value })}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Board"
              >
                <option value="all">All boards</option>
                {systemBoardOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={systemDateFilter}
                onChange={(e) => setDashboardSystemSummary({ systemDateFilter: e.target.value })}
                className="px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-600 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Date"
              />
            </div>
            {systemSummary.length > 3 && (
              <button
                onClick={() =>
                  setDashboardSystemSummary((p) => ({
                    ...p,
                    isSystemSummaryExpanded: !p.isSystemSummaryExpanded,
                  }))
                }
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors"
              >
                {isSystemSummaryExpanded ? (
                  <>
                    <ChevronUp size={14} />
                    <span>Collapse</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
                    <span>Expand</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        {systemSummary.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(isSystemSummaryExpanded ? systemSummary : systemSummary.slice(0, 3)).map((sys) => {
                const status = (sys.status || '').toLowerCase();
                const statusColors =
                  status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : status === 'pending'
                      ? 'border-amber-200 bg-amber-50/40'
                      : status === 'stopped'
                        ? 'border-red-200 bg-red-50/40'
                        : 'border-blue-200 bg-blue-50/40';
                const dotColor =
                  status === 'completed'
                    ? 'bg-emerald-500'
                    : status === 'pending'
                      ? 'bg-amber-500'
                      : status === 'stopped'
                        ? 'bg-red-500'
                        : 'bg-blue-500';
                const handleTagManage = (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (onManageTags) onManageTags(sys.jobId);
                };
                return (
                  <div
                    key={sys.jobId}
                    className={`p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer dark:bg-slate-800 dark:border-slate-700 ${statusColors}`}
                    onClick={() => setSystemModalJobId(sys.jobId)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                            {sys.jobName || `Job #${sys.jobId}`}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">ID: {sys.jobId}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleTagManage}
                          className={`px-2 py-0.5 rounded text-xs font-bold border hover:brightness-95 transition-colors ${jobTagPillClasses(sys.tagColor)}`}
                          title="Manage tags"
                        >
                          <span className="inline-flex items-center gap-1">
                            <span className="truncate max-w-[120px]">{sys.tag || 'Untagged'}</span>
                            {sys.extraTagCount > 0 && <span className="opacity-70">+{sys.extraTagCount}</span>}
                          </span>
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className={`inline-flex w-2 h-2 rounded-full ${dotColor}`} />
                      <span className="uppercase tracking-wide font-semibold">
                        {status || 'RUNNING'}
                      </span>
                    </div>
                    {(sys.displayDate || sys.displayTime) && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        {sys.displayDate}{sys.displayTime ? ` · ${sys.displayTime}` : ''}
                      </div>
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <div className="mb-0.5">
                        Owner: {sys.ownerLabel || '—'}
                      </div>
                      <div>
                        Boards:{' '}
                        {sys.boards.length > 0 ? sys.boards.join(', ') : '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!isSystemSummaryExpanded && systemSummary.length > 3 && (
              <div className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
                Showing top 3 of {systemSummary.length} systems. Click &quot;Expand&quot; to view all.
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500">
            <p>No active systems running</p>
          </div>
        )}
      </div>

      {systemModalJob && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSystemModalJobId(null)}
        >
          <div
            className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-stretch justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Layers size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                      {systemModalJob.name || systemModalJob.configName || `Job #${systemModalJob.id}`}
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    ID: {systemModalJob.id}
                  </p>
                </div>
              </div>
              <div className="hidden shrink-0 items-stretch sm:flex">
                {(systemModalJob.tag || systemModalJob.tagColor) && (
                  <div className="flex items-center pr-3">
                    <span
                      className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-bold border ${jobTagPillClasses(systemModalJob.tagColor)}`}
                    >
                      {systemModalJob.tag || 'Untagged'}
                    </span>
                  </div>
                )}
                <div className="flex items-center border-l border-slate-200 pl-4 dark:border-slate-600">
                  <button
                    onClick={() => {
                      setSystemModalJobId(null);
                      goToJobManager(systemModalJob?.id ?? null);
                    }}
                    type="button"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Monitor size={14} />
                    Open in Job Manager
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">{systemModalSummaryText}</div>
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/60 shadow-inner">
                <div className="px-3 py-2 bg-slate-100/80 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <span>Test Cases</span>
                    <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                      (running / failed highlighted)
                    </span>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto text-xs divide-y divide-slate-100 dark:divide-slate-700/80">
                  {(!systemModalJob.files || systemModalJob.files.length === 0) ? (
                    <div className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-950/40">
                      No test cases in this set.
                    </div>
                  ) : (
                    (systemModalJob.files || [])
                      .slice()
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map((file) => {
                        const isRunning = file.status === 'running';
                        const isFailed =
                          (file.result || '').toLowerCase() === 'fail' ||
                          (file.status || '').toLowerCase() === 'error' ||
                          (file.status || '').toLowerCase() === 'failed';
                        const rowBg = isFailed
                          ? 'bg-red-50 dark:bg-red-950/35'
                          : isRunning
                            ? 'bg-blue-50 dark:bg-blue-950/35'
                            : 'bg-white/90 dark:bg-slate-950/35';
                        return (
                          <div
                            key={file.id}
                            className={`px-4 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 ${rowBg}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                                #{file.order || file.id}
                              </span>
                              <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                                {getDashboardTestCaseDisplayName(file)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">
                                {file.status || 'pending'}
                              </span>
                              {file.result && (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    file.result === 'pass'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/55 dark:text-emerald-300'
                                      : file.result === 'fail'
                                        ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {file.result.toUpperCase()}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSystemModalJobId(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent dark:border-slate-600"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {systemModalBoardRow && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSystemModalBoardId(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <div className="flex items-center gap-2">
                <Cpu size={18} className="text-blue-600 dark:text-blue-400" />
                <h2 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                  {systemModalBoardRow.board?.name || 'Board'}
                </h2>
              </div>
              <button
                onClick={() => setSystemModalBoardId(null)}
                className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {systemModalBoardRow.job ? (
                <>
                  <div className="text-sm">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-0.5">Running set</div>
                    {(() => {
                      const rawName = (systemModalBoardRow.job.name || systemModalBoardRow.job.configName || '').trim();
                      const displayName = rawName.replace(/^Batch\s*#/i, 'Set ');
                      return (
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {displayName || `Job #${systemModalBoardRow.job.id}`}
                        </div>
                      );
                    })()}
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">ID: {systemModalBoardRow.job.id}</div>
                  </div>
                  <div className="text-sm">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-0.5">Owner</div>
                    <div className="font-medium text-slate-700 dark:text-slate-300">
                      {resolveJobOwnerDisplayName(systemModalBoardRow.job, jobOwnerLabelCtx)}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-0.5">Status</div>
                  <div className="font-medium text-slate-700 dark:text-slate-300">Idle</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Queue: {systemModalBoardRow.jobsWaitingForBoard} waiting
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setSystemModalBoardId(null);
                  const bid =
                    systemModalBoardRow.board?.id != null && systemModalBoardRow.board?.id !== ''
                      ? String(systemModalBoardRow.board.id)
                      : String(systemModalBoardRow.board?.name || '').trim() || null;
                  goToBoardStatus(bid);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                <Activity size={14} />
                Board Status
              </button>
              {(() => {
                const mj = systemModalBoardRow.job;
                if (!mj) return null;
                const jid = mj.id != null && String(mj.id) !== '' ? String(mj.id) : null;
                const isSyntheticDemoJob = !!(jid && String(jid).startsWith('DEMO-'));
                if (!jid || isSyntheticDemoJob) return null;
                return (
                  <button
                    type="button"
                    title="Open Jobs Manager with this running set highlighted"
                    onClick={() => {
                      setSystemModalBoardId(null);
                      goToJobManager(jid);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-600 text-white hover:bg-slate-700"
                  >
                    <Monitor size={14} />
                    Open running job
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <div className="w-full">
        <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">Device Progress</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {deviceProgressRows.length === 0 ? (
              <div className="col-span-full py-4 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                No devices available
              </div>
            ) : (
              deviceProgressRows.map(({ board, progress, job, completedFiles, totalFiles, remainingFiles, jobsWaitingForBoard }) => {
                const status = (board.status || '').toLowerCase();
                const isBusy = status === 'busy';
                const isOnline = status === 'online';
                return (
                  <div
                    key={board.id}
                    className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500 cursor-pointer"
                    onClick={() => setSystemModalBoardId(board.id)}
                    title="Click to view board details"
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{board.name}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                        isBusy
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : isOnline
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                      }`}>
                        {isBusy ? 'Busy' : isOnline ? 'Online' : (board.status || '—')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mb-1" title={job ? `${((job.configName || job.name || 'Set').trim()).replace(/^Batch\s*#/i, 'Set ')} · set #${job.id}` : 'Idle'}>
                      {job ? `${((job.configName || job.name || 'Set').trim()).replace(/^Batch\s*#/i, 'Set ')} · #${job.id}` : 'Idle'}
                    </div>
                    {isBusy && (
                      <>
                        <div className="h-1 w-full bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden mb-1">
                          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          {completedFiles}/{totalFiles} ({progress}%) · {remainingFiles} left · Queue: {jobsWaitingForBoard}
                        </div>
                      </>
                    )}
                    {!isBusy && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Queue: {jobsWaitingForBoard} waiting</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showBatchDetails && selectedBatch && (
        <BatchDetailsModal
          batch={selectedBatch}
          onClose={() => {
            setShowBatchDetails(false);
            setSelectedBatch(null);
          }}
        />
      )}
    </div>
  );
};

export default DashboardPage;

