import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Filter,
  Globe,
  GripVertical,
  Layers,
  Lock,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import api from '../services/api';
import { getClientId } from '../utils/sessionStorage';
import { resolveOwnerDisplayName } from '../utils/profileOwnerLabel';
import {
  getFirstTagPillClass,
  TAG_PALETTE_MAP,
  TAG_PALETTE_KEYS,
  TAG_SWATCH_DOT_CLASS,
  jobTagPillClasses,
  splitTagsComma,
  normalizeTagColorKey,
  normalizeTagColorList,
  formatPaletteOptionLabel,
  isExtraColumnHiddenFromLibraryTable,
} from '../utils/tagPalette';
import TagColorSwatchPicker from '../components/TagColorSwatchPicker';

/** Match dropdown owner filter to row: same id, or same resolved display (e.g. default vs server UUID both "Default"). */
function rowMatchesOwnerFilter(rowOid, filterProfileId, ownerLabelCtx, activeProfileId, rowOwnerNameHint) {
  const f = String(filterProfileId ?? '').trim();
  const o = String(rowOid ?? '').trim();
  if (o === f) return true;
  const hint = rowOwnerNameHint && String(rowOwnerNameHint).trim();
  const dispRow = hint || resolveOwnerDisplayName(o || activeProfileId, ownerLabelCtx);
  const dispFil = resolveOwnerDisplayName(f, ownerLabelCtx);
  const dr = String(dispRow || '').trim().toLowerCase();
  const df = String(dispFil || '').trim().toLowerCase();
  if (dr && df && dr !== '—' && dr === df) return true;
  return false;
}

/** Limit Run Set library list by tag palette color on the row (multi-tag aware). */
function tcMatchesRunLibraryTagColor(tc, filterColorRaw) {
  const wantTrim = String(filterColorRaw ?? '').trim();
  if (!wantTrim) return true;
  const want = normalizeTagColorKey(wantTrim);
  const ex = tc?.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
  const parts = splitTagsComma(ex.tag || ex.Tag || '');
  const colorKeys = new Set();
  if (parts.length > 0) {
    normalizeTagColorList(ex, parts.length).forEach((k) => colorKeys.add(normalizeTagColorKey(k)));
  } else {
    colorKeys.add(normalizeTagColorKey(ex.tagColor ?? ex.tag_color ?? 'mint'));
  }
  return colorKeys.has(want);
}

/** Manual Vis=close: row is excluded from “Select all (visible)” (same as TC Library). Not the same as running/pending (system lock). */
function isTcManuallyClosedForPicker(tc) {
  const vis = String(tc?.extraColumns?.vis || '').trim().toLowerCase();
  return vis === 'close' || vis === 'closed' || vis === 'lock' || vis === 'locked' || vis === 'private';
}

function isTcSystemLockedForRunPicker(tc) {
  return tc?._status === 'running' || tc?._status === 'pending';
}

/** Calendar day YYYY-MM-DD from modified time — matches TC Library date filter. */
function tcModifiedYmd(tc) {
  const raw = tc?.updatedAt || tc?.createdAt || '';
  const d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRunPickerLibDate(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** One MDI summary cell like TC Library “MDI (text)”. */
function getTcMdiSummaryForPicker(tc) {
  if (!tc) return '—';
  const names = [];
  (Array.isArray(tc.commands) ? tc.commands : [])
    .filter((c) => c && c.type === 'mdi' && String(c.file || '').trim())
    .forEach((c) => names.push(String(c.file).trim()));
  const ex = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
  Object.keys(ex)
    .filter((k) => /^mdi\d+$/i.test(String(k)))
    .sort((a, b) => {
      const na = parseInt(String(a).match(/\d+/)?.[0] || '0', 10);
      const nb = parseInt(String(b).match(/\d+/)?.[0] || '0', 10);
      return na - nb;
    })
    .forEach((k) => {
      const v = String(ex[k] || '').trim();
      if (v && !names.includes(v)) names.push(v);
    });
  return names.length ? names.join(', ') : '—';
}

function RunTagColorFilterDropdown({
  value,
  onChange,
  placeholder = 'All tag colors',
  size = 'sm',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const options = useMemo(() => {
    const query = String(q || '').trim().toLowerCase();
    if (!query) return TAG_PALETTE_KEYS;
    return TAG_PALETTE_KEYS.filter((k) => String(k).toLowerCase().includes(query));
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const btnCls =
    size === 'xs'
      ? 'h-8 px-2 py-1.5 pr-8 text-xs rounded-lg'
      : 'h-9 px-2.5 py-1.5 pr-9 text-sm rounded-lg';
  const iconSize = size === 'xs' ? 'h-3.5 w-3.5 right-2' : 'h-4 w-4 right-2.5';
  const popCls =
    size === 'xs'
      ? 'top-[calc(100%+4px)] p-2 text-xs max-h-72'
      : 'top-[calc(100%+6px)] p-3 text-sm max-h-80';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full appearance-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-left ${btnCls} focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`}
        title="Filter by tag color"
      >
        <span className="truncate inline-flex items-center gap-2">
          {value ? (
            <>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${TAG_SWATCH_DOT_CLASS[value] || 'bg-slate-400'}`} />
              <span>{formatPaletteOptionLabel(value)}</span>
            </>
          ) : (
            placeholder
          )}
        </span>
      </button>
      <ChevronDown
        aria-hidden
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 ${iconSize}`}
      />
      {open && (
        <div className={`absolute left-0 right-0 z-[160] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 shadow-2xl ${popCls}`}>
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Tag color</div>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search color..."
            className="w-full mb-2 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange('');
                setOpen(false);
              }}
              className={`w-full px-2.5 py-1.5 rounded-lg text-left inline-flex items-center gap-2 hover:bg-slate-200/70 dark:hover:bg-slate-700 ${!value ? 'bg-slate-200/80 dark:bg-slate-700/80' : ''}`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />
              <span>All</span>
            </button>
            {options.map((k) => (
              <button
                key={`run-tag-color-${k}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(k);
                  setOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 rounded-lg text-left inline-flex items-center gap-2 hover:bg-slate-200/70 dark:hover:bg-slate-700 ${value === k ? 'bg-slate-200/80 dark:bg-slate-700/80' : ''}`}
              >
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${TAG_SWATCH_DOT_CLASS[k] || 'bg-slate-400'}`} />
                <span>{k}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const RunSetPage = ({ onNavigateJobs }) => {
  const savedTestCaseSets = useTestStore((s) => s.savedTestCaseSets);
  const savedTestCases = useTestStore((s) => s.savedTestCases);
  const uploadedFiles = useTestStore((s) => s.uploadedFiles);
  const boards = useTestStore((s) => s.boards);
  const loading = useTestStore((s) => s.loading);
  const errors = useTestStore((s) => s.errors);
  const silentRefreshBoards = useTestStore((s) => s.silentRefreshBoards);
  const refreshBoards = useTestStore((s) => s.refreshBoards);
  const jobs = useTestStore((s) => s.jobs);
  const runBoardSelection = useTestStore((s) => s.runBoardSelection);
  const setRunBoardSelection = useTestStore((s) => s.setRunBoardSelection);
  const updateSavedTestCaseSet = useTestStore((s) => s.updateSavedTestCaseSet);
  const updateSavedTestCase = useTestStore((s) => s.updateSavedTestCase);
  const createJob = useTestStore((s) => s.createJob);
  const refreshJobs = useTestStore((s) => s.refreshJobs);
  const addSavedTestCaseSet = useTestStore((s) => s.addSavedTestCaseSet);
  const moveSavedTestCaseSetUp = useTestStore((s) => s.moveSavedTestCaseSetUp);
  const moveSavedTestCaseSetDown = useTestStore((s) => s.moveSavedTestCaseSetDown);
  const duplicateSavedTestCaseSet = useTestStore((s) => s.duplicateSavedTestCaseSet);
  const removeSavedTestCaseSet = useTestStore((s) => s.removeSavedTestCaseSet);
  const savedTestCaseSetPendingById = useTestStore((s) => s.savedTestCaseSetPendingById);
  const runSetImportContext = useTestStore((s) => s.runSetImportContext);
  const clearRunSetImportContext = useTestStore((s) => s.clearRunSetImportContext);
  const addToast = useTestStore((s) => s.addToast);
  const activeProfileId = useTestStore((s) => s.activeProfileId);
  const profiles = useTestStore((s) => s.profiles) || [];
  const sharedProfiles = useTestStore((s) => s.sharedProfiles) || [];
  const serverProfileDirectory = useTestStore((s) => s.serverProfileDirectory) || [];
  const globalTestCaseDataLoaded = useTestStore((s) => s.globalTestCaseDataLoaded);
  const aggregateSavedTestCasesAcrossProfiles = useTestStore((s) => s.aggregateSavedTestCasesAcrossProfiles);
  const aggregateSavedTestCaseSetsAcrossProfiles = useTestStore((s) => s.aggregateSavedTestCaseSetsAcrossProfiles);
  const refreshGlobalTestCaseData = useTestStore((s) => s.refreshGlobalTestCaseData);
  const safeSets = Array.isArray(savedTestCaseSets) ? savedTestCaseSets : [];
  const safeCases = Array.isArray(savedTestCases) ? savedTestCases : [];
  const safeFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const safeBoards = Array.isArray(boards) ? boards : [];
  const activeProfile = profiles.find((p) => p.id === activeProfileId) || { id: 'default', name: 'Default' };

  const ownerLabelCtx = useMemo(
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

  const allOwnerProfiles = useMemo(() => {
    const norm = (s) => String(s || '').trim().toLowerCase();
    const pickKey = (p) => norm(p?.name) || norm(p?.id);
    const list = [
      ...(Array.isArray(profiles) ? profiles : []),
      ...(Array.isArray(sharedProfiles) ? sharedProfiles : []),
      ...(Array.isArray(serverProfileDirectory) ? serverProfileDirectory : []),
    ];
    const byDisplay = new Map();
    list.forEach((p) => {
      if (!p || !p.id) return;
      const k = pickKey(p);
      if (!k) return;
      if (!byDisplay.has(k)) byDisplay.set(k, p);
    });
    const activeP = (Array.isArray(profiles) ? profiles : []).find((p) => String(p?.id) === String(activeProfileId));
    if (activeP?.id) {
      const k = pickKey(activeP);
      if (k) byDisplay.set(k, activeP);
    }
    return Array.from(byDisplay.values()).sort((a, b) =>
      String(a?.name || a?.id).localeCompare(String(b?.name || b?.id))
    );
  }, [profiles, sharedProfiles, serverProfileDirectory, activeProfileId]);

  useEffect(() => {
    void silentRefreshBoards();
  }, [silentRefreshBoards]);

  useEffect(() => {
    void refreshGlobalTestCaseData();
  }, [refreshGlobalTestCaseData]);

  const boardsEmptyPlaceholder = () => {
    if (loading?.boards) {
      return (
        <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
          <RefreshCw size={12} className="animate-spin shrink-0" aria-hidden />
          Loading boards…
        </span>
      );
    }
    if (errors?.boards) {
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs max-w-xl">
          <span className="text-amber-700 dark:text-amber-300">
            Could not load boards: {errors.boards}
          </span>
          <button
            type="button"
            onClick={() => void refreshBoards()}
            className="font-bold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
        No boards in the list yet. The API returned an empty list — add boards under{' '}
        <strong className="text-slate-600 dark:text-slate-300">Board Status</strong>, or check that the backend is running and{' '}
        <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">VITE_API_BASE_URL</code> matches your server.
      </span>
    );
  };

  const [showBrowseModal, setShowBrowseModal] = useState(false);
  /** Modal table: click-drag to add rows to selection (primary button held). */
  const browseDragSelectingRef = useRef(false);

  useEffect(() => {
    if (!showBrowseModal) return;
    const endDrag = () => {
      browseDragSelectingRef.current = false;
    };
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, [showBrowseModal]);

  const [selectedSetIds, setSelectedSetIds] = useState([]);
  const [runSetName, setRunSetName] = useState('');
  const [tag, setTag] = useState('');
  const [runSetTagColor, setRunSetTagColor] = useState('mint');
  const [boardSelectionMode, setBoardSelectionMode] = useState('auto');
  const [selectedBoardIds, setSelectedBoardIds] = useState([]);
  const [prioritize, setPrioritize] = useState(false);
  // Tag history scoped for sets / jobs (ไม่ปนกับ tag ของไฟล์หรือ TC)
  const setTagHistory = useMemo(() => {
    const acc = [];
    (savedTestCaseSets || []).forEach((set) => {
      const raw = (set && set.tag) || '';
      if (!raw) return;
      splitTagsComma(raw).forEach((t) => acc.push(t));
    });
    (jobs || []).forEach((job) => {
      const raw = (job && job.tag) || '';
      if (!raw) return;
      splitTagsComma(raw).forEach((t) => acc.push(t));
    });
    const seen = new Set();
    const out = [];
    acc.forEach((t) => {
      const v = String(t || '').trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    });
    return out.sort((a, b) => a.localeCompare(b));
  }, [savedTestCaseSets, jobs]);
  const runSetBoardInitDone = useRef(false);
  useEffect(() => {
    if (runSetBoardInitDone.current) return;
    if (safeBoards.length === 0) return;
    runSetBoardInitDone.current = true;
    const stored = runBoardSelection || { mode: 'auto', boardIds: [] };
    setBoardSelectionMode(stored.mode);
    const validIds = (stored.boardIds || []).filter((id) => safeBoards.some((b) => b.id === id));
    setSelectedBoardIds(validIds);
  }, [runBoardSelection, safeBoards]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runPreview, setRunPreview] = useState([]);
  const [runListNameFilter, setRunListNameFilter] = useState('');
  const [runListTagFilter, setRunListTagFilter] = useState('');
  /** Tag filter: combobox popover — chevron picks from tags present in browsed TC list */
  const [runTagSuggestOpenLibrary, setRunTagSuggestOpenLibrary] = useState(false);
  const [runTagSuggestOpenPicker, setRunTagSuggestOpenPicker] = useState(false);
  const runTagSuggestLibraryRef = useRef(null);
  const runTagSuggestPickerRef = useRef(null);
  const browsePickerSelectAllRef = useRef(null);
  /** __active__ = โปรไฟล์ปัจจุบัน (savedTestCases + sets ในเครื่อง); all / profile id / shared = ใช้ snapshot รวมเหมือน Library */
  const [runLibraryOwnerFilter, setRunLibraryOwnerFilter] = useState('__active__');
  /** Empty = any tag pill color — uses same palette keys as TC Library */
  const [runLibraryTagColorFilter, setRunLibraryTagColorFilter] = useState('');
  /** '' = all dates; YYYY-MM-DD — same semantics as Library → TC Library */
  const [runLibraryDateFilter, setRunLibraryDateFilter] = useState('');
  const [tcClipboard, setTcClipboard] = useState([]);
  /** Multi-select in section 1 (library list) — order for drag/copy follows visible list order */
  const [selectedLeftKeys, setSelectedLeftKeys] = useState(() => new Set());
  const leftListShiftAnchorIdxRef = useRef(null);
  const [selectedRunIndex, setSelectedRunIndex] = useState(null);
  const [selectedBrowsedKeys, setSelectedBrowsedKeys] = useState(new Set());
  const [editingSetId, setEditingSetId] = useState(null);
  const [editingSetName, setEditingSetName] = useState('');
  const runSetRightRef = useRef(null);

  useEffect(() => {
    if (!runSetImportContext || !Array.isArray(runSetImportContext.items)) return;
    const imported = runSetImportContext.items.filter(Boolean);
    if (imported.length === 0) {
      clearRunSetImportContext();
      return;
    }
    const importedName = (runSetImportContext.name || '').trim();
    const setStub = { id: '__library_selected__', name: importedName || 'Selected from Library' };
    const items = imported.map((tc, idx) => ({
      key: `lib-send-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      setId: setStub.id,
      set: setStub,
      tc,
      order: idx + 1,
    }));
    // Replace right panel with imported list, preserving selection order from Library.
    setRunPreview(items);
    setSelectedRunIndex(items.length ? 0 : null);
    if (importedName) setRunSetName(importedName);
    clearRunSetImportContext();
    addToast({ type: 'info', message: `Loaded ${items.length} test case(s) from Library` });
  }, [runSetImportContext, clearRunSetImportContext, addToast]);

  // Helper: job status for a Saved set on Run Set page ('pending' | 'running' | null)
  const getRunSetStatusForSet = useCallback(
    (set) => {
      const setName = (set?.name || '').trim();
      if (!setName) return null;
      let status = null;
      (jobs || []).forEach((job) => {
        const state = (job.status || '').toLowerCase();
        if (state !== 'pending' && state !== 'running') return;
        const configName = (job.configName || '').trim();
        const jobName = (job.name || '').trim();
        if (setName && (configName === setName || jobName === setName)) {
          if (state === 'running') status = 'running';
          else if (!status) status = 'pending';
        }
      });
      return status;
    },
    [jobs]
  );

  const isSetInUseByJobs = useCallback(
    (set) => {
      const activeStates = new Set(['pending', 'running']);
      return (jobs || []).some((job) => {
        const state = (job.status || '').toLowerCase();
        if (!activeStates.has(state)) return false;
        const configName = (job.configName || '').trim();
        const jobName = (job.name || '').trim();
        const setName = (set.name || '').trim();
        return setName && (configName === setName || jobName === setName);
      });
    },
    [jobs]
  );
  const selectedRunnableSets = useMemo(
    () => safeSets.filter((set) => selectedSetIds.includes(set.id) && !isSetInUseByJobs(set)),
    [safeSets, selectedSetIds, isSetInUseByJobs]
  );
  const selectedRunnableCaseCount = useMemo(
    () => selectedRunnableSets.reduce((sum, set) => sum + ((Array.isArray(set.items) ? set.items.length : 0) || 0), 0),
    [selectedRunnableSets]
  );

  const singleSelectedSetForSave = useMemo(() => {
    if (selectedSetIds.length !== 1) return null;
    return safeSets.find((s) => s.id === selectedSetIds[0]) || null;
  }, [selectedSetIds, safeSets]);

  const hasSingleSetMetadataDirty = useMemo(() => {
    const set = singleSelectedSetForSave;
    if (!set) return false;
    if ((runSetName || '').trim() !== (set.name || '').trim()) return true;
    if ((tag || '').trim() !== (set.tag || '').trim()) return true;
    const colA = TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint';
    const colB = TAG_PALETTE_MAP[set.tagColor] ? set.tagColor : 'mint';
    if (colA !== colB) return true;
    return false;
  }, [singleSelectedSetForSave, runSetName, tag, runSetTagColor]);

  const canSaveNotRun = runPreview.length > 0 || hasSingleSetMetadataDirty;

  // ไม่ให้เลือก set ที่กำลังรันอยู่ (In run) — ถ้า job เปลี่ยนสถานะเป็น running/pending ให้ถอด checkbox ออกอัตโนมัติ
  useEffect(() => {
    setSelectedSetIds((prev) =>
      prev.filter((id) => {
        const set = safeSets.find((s) => s.id === id);
        return set && !isSetInUseByJobs(set);
      })
    );
  }, [safeSets, isSetInUseByJobs]);

  const toggleSet = (id) => setSelectedSetIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const selectAllSets = () => setSelectedSetIds(safeSets.map((s) => s.id));
  const clearAllSets = () => setSelectedSetIds([]);
  const toggleBoard = (boardId) => {
    setSelectedBoardIds((prev) => {
      const next = prev.includes(boardId) ? prev.filter((x) => x !== boardId) : [...prev, boardId];
      setRunBoardSelection({ mode: 'manual', boardIds: next });
      return next;
    });
  };
  const selectAllBoards = () => {
    const ids = safeBoards.map((b) => b.id);
    setSelectedBoardIds(ids);
    setRunBoardSelection({ mode: 'manual', boardIds: ids });
  };
  const selectAllOnlineBoards = () => {
    const ids = safeBoards
      .filter((b) => {
        const s = (b.status || '').toLowerCase();
        return s === 'online' || s === 'busy';
      })
      .map((b) => b.id);
    setSelectedBoardIds(ids);
    setRunBoardSelection({ mode: 'manual', boardIds: ids });
  };
  const clearBoards = () => {
    setSelectedBoardIds([]);
    setRunBoardSelection({ mode: 'manual', boardIds: [] });
  };

  /** Reset section 3: set name, tag, color, board mode/selection, prioritize (persisted board prefs too). */
  const clearSection3RunConfig = useCallback(() => {
    setRunSetName('');
    setTag('');
    setRunSetTagColor('mint');
    setPrioritize(false);
    setBoardSelectionMode('auto');
    setSelectedBoardIds([]);
    setRunBoardSelection({ mode: 'auto', boardIds: [] });
  }, [setRunBoardSelection]);

  const getJobDateForRunSet = useCallback((job) => {
    if (!job) return new Date(0);
    const s = (job.status || '').toLowerCase();
    if (s === 'completed' || s === 'stopped') {
      if (job.completedAt) return new Date(job.completedAt);
      if (job.startedAt) return new Date(job.startedAt);
    } else {
      if (job.createdAt) return new Date(job.createdAt);
      if (job.startedAt) return new Date(job.startedAt);
    }
    return new Date(0);
  }, []);

  const findLatestJobForSetName = useCallback(
    (setName) => {
      const n = (setName || '').trim();
      if (!n || !Array.isArray(jobs)) return null;
      const matches = jobs.filter((j) => {
        const jn = (j.configName || j.name || '').trim();
        return jn === n;
      });
      if (!matches.length) return null;
      return matches.sort((a, b) => getJobDateForRunSet(b) - getJobDateForRunSet(a))[0];
    },
    [jobs, getJobDateForRunSet]
  );

  const applyBoardsAndPriorityFromJob = useCallback(
    (j, boardList) => {
      if (j) {
        const p = (j.priority || '').toString().toLowerCase();
        setPrioritize(p === 'high' || j.priority === 'high');
      } else {
        setPrioritize(false);
      }
      const bnames = j && Array.isArray(j.boards) ? j.boards : [];
      const nameToId = new Map((boardList || []).map((b) => [b.name, b.id]));
      if (bnames.length > 0) {
        const ids = bnames.map((bn) => nameToId.get(bn)).filter(Boolean);
        if (ids.length > 0) {
          setBoardSelectionMode('manual');
          setSelectedBoardIds(ids);
          setRunBoardSelection({ mode: 'manual', boardIds: ids });
        } else {
          setBoardSelectionMode('auto');
          setSelectedBoardIds([]);
          setRunBoardSelection({ mode: 'auto', boardIds: [] });
        }
      } else {
        setBoardSelectionMode('auto');
        setSelectedBoardIds([]);
        setRunBoardSelection({ mode: 'auto', boardIds: [] });
      }
    },
    [setRunBoardSelection]
  );

  /** When exactly one saved set is ticked, fill section 3 with that set’s tag/name + best-known job (boards, priority). */
  const lastSetSelectionKeyRef = useRef('');
  const lastJobHydrateSigRef = useRef('');
  useEffect(() => {
    const k = selectedSetIds.join(',');
    const isSingle = selectedSetIds.length === 1;
    if (!isSingle) {
      lastSetSelectionKeyRef.current = k;
      return;
    }
    const set = safeSets.find((s) => s.id === selectedSetIds[0]);
    if (!set) return;
    const setName = (set.name || '').trim();
    const j = findLatestJobForSetName(setName);
    const jobSig = j
      ? `job:${j.id}:boards:${(j.boards || []).join('|') || '∅'}:pr:${(j.priority || '∅')}`
      : 'nojob';

    if (k !== lastSetSelectionKeyRef.current) {
      lastSetSelectionKeyRef.current = k;
      lastJobHydrateSigRef.current = '';
      setRunSetName(setName);
      setTag((set.tag || '').trim());
      setRunSetTagColor(TAG_PALETTE_MAP[set.tagColor] ? set.tagColor : 'mint');
      applyBoardsAndPriorityFromJob(j, safeBoards);
      lastJobHydrateSigRef.current = j ? jobSig : 'nojob';
      return;
    }

    if (lastJobHydrateSigRef.current === jobSig) return;
    lastJobHydrateSigRef.current = jobSig;
    applyBoardsAndPriorityFromJob(j, safeBoards);
  }, [
    selectedSetIds,
    safeSets,
    jobs,
    safeBoards,
    findLatestJobForSetName,
    applyBoardsAndPriorityFromJob,
  ]);

  const contentKeyTc = (tc) =>
    [tc?.name ?? '', tc?.vcdName ?? '', tc?.binName ?? '', tc?.linName ?? ''].join('\0');

  // Flow: default = โปรไฟล์ปัจจุบัน; เลือก "All owners" / โปรไฟล์อื่น / Shared → รวมจาก server + local เหมือน TC Library
  const browsedRows = useMemo(() => {
    const mineLike = runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine';

    let sourceCases;
    let sourceSets;
    if (mineLike) {
      sourceCases = safeCases;
      sourceSets = safeSets;
    } else {
      sourceCases = aggregateSavedTestCasesAcrossProfiles();
      sourceSets = aggregateSavedTestCaseSetsAcrossProfiles();
    }

    const fromCurrent = sourceCases.map((tc) => ({
      setId: '__current__',
      set: {
        id: '__current__',
        name: mineLike ? 'Current (from table)' : 'Library',
        items: sourceCases,
      },
      tc,
      key: mineLike ? `current-${tc.id}` : `current-${tc.id}-${tc._ownerId ?? 'x'}`,
    }));

    const seen = new Set(fromCurrent.map((row) => contentKeyTc(row.tc)));
    const fromSets = sourceSets.flatMap((set) =>
      (Array.isArray(set.items) ? set.items : []).map((tc, tcIdx) => ({
        setId: set.id,
        set,
        tc,
        _itemIndex: tcIdx,
        key: `${set.id}-${tcIdx}-${tc.id || tc.name || tc.vcdName || ''}-${set._ownerId ?? ''}`,
      }))
    );
    const fromSetsDeduped = fromSets.filter((row) => {
      const k = contentKeyTc(row.tc);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    let combined = [...fromCurrent, ...fromSetsDeduped];

    if (!mineLike) {
      const ownerF = runLibraryOwnerFilter;
      const resolvedOwner =
        ownerF === '__active__' ? (activeProfileId ? String(activeProfileId) : 'all') : String(ownerF || 'all');

      combined = combined.filter((row) => {
        const oid = row.tc._ownerId ?? row.set?._ownerId;
        if (resolvedOwner === 'all') return true;
        if (resolvedOwner === 'shared') {
          if (oid === activeProfileId || !oid) return false;
          return true;
        }
        return rowMatchesOwnerFilter(
          oid,
          resolvedOwner,
          ownerLabelCtx,
          activeProfileId,
          row.tc._ownerName
        );
      });
    }

    return combined;
  }, [
    runLibraryOwnerFilter,
    safeCases,
    safeSets,
    activeProfileId,
    ownerLabelCtx,
    aggregateSavedTestCasesAcrossProfiles,
    aggregateSavedTestCaseSetsAcrossProfiles,
  ]);
  const toggleBrowsed = (key) => {
    setSelectedBrowsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const clearAllBrowsed = () => setSelectedBrowsedKeys(new Set());

  const handleBrowseRowMouseDown = useCallback((e, rowKey, tc) => {
    if (e.button !== 0) return;
    if (e.target.closest('input, button, a, textarea, select, label')) return;
    if (tc && isTcManuallyClosedForPicker(tc)) return;
    e.preventDefault();
    browseDragSelectingRef.current = true;
    setSelectedBrowsedKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });
  }, []);

  const handleBrowseRowMouseEnter = useCallback((rowKey, tc) => {
    if (!browseDragSelectingRef.current) return;
    if (tc && isTcManuallyClosedForPicker(tc)) return;
    setSelectedBrowsedKeys((prev) => {
      if (prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });
  }, []);

  const updateRunPickerTcVisibility = useCallback(
    (row) => {
      const tc = row.tc;
      if (isTcSystemLockedForRunPicker(tc)) {
        addToast({ type: 'warning', message: 'Test case is locked (running/pending) — cannot change Vis' });
        return;
      }
      const wantClosed = !isTcManuallyClosedForPicker(tc);
      const visVal = wantClosed ? 'close' : 'open';
      const nextExtra = { ...(tc.extraColumns || {}), vis: visVal };

      const clearRowPick = () =>
        setSelectedBrowsedKeys((prev) => {
          const next = new Set(prev);
          next.delete(row.key);
          return next;
        });

      if (row.setId === '__current__') {
        const id = tc?.id;
        if (id == null) {
          addToast({ type: 'warning', message: 'Cannot change Vis — this test case has no id.' });
          return;
        }
        if (!safeCases.some((t) => String(t.id) === String(id))) {
          addToast({
            type: 'warning',
            message:
              'Vis can only be changed for library data on this device. Switch the owner filter to your profile or “This device”.',
          });
          return;
        }
        updateSavedTestCase(id, { extraColumns: nextExtra });
        clearRowPick();
        return;
      }

      const setEntity = safeSets.find((s) => s.id === row.setId);
      const idx = row._itemIndex;
      if (!setEntity || !Array.isArray(setEntity.items) || idx == null || idx < 0 || !setEntity.items[idx]) {
        addToast({
          type: 'warning',
          message:
            'Cannot change Vis — this set is not editable here. Switch the owner filter to your local profile / sets.',
        });
        return;
      }
      const items = [...setEntity.items];
      items[idx] = { ...items[idx], extraColumns: { ...(items[idx].extraColumns || {}), vis: visVal } };
      updateSavedTestCaseSet(row.setId, { items });
      clearRowPick();
    },
    [addToast, safeCases, safeSets, updateSavedTestCase, updateSavedTestCaseSet]
  );

  const nameFilter = (runListNameFilter || '').trim().toLowerCase();
  const tagFilter = (runListTagFilter || '').trim().toLowerCase();
  const filteredLibraryRows = useMemo(() => {
    const dateWant = (runLibraryDateFilter || '').trim();
    return browsedRows.filter((row) => {
      const name = (row.tc.name || row.tc.vcdName || '').toLowerCase();
      const tagVal = (row.tc.extraColumns?.tag || '').toString().toLowerCase();
      const ownerDisp = resolveOwnerDisplayName(
        row.tc._ownerId ?? row.set?._ownerId ?? activeProfileId,
        ownerLabelCtx
      ).toLowerCase();
      const ownerRaw = String(row.tc._ownerName || row.tc._ownerId || '').toLowerCase();
      const bin = (row.tc.binName || '').toLowerCase();
      const lin = (row.tc.linName || '').toLowerCase();
      const vcd = (row.tc.vcdName || '').toLowerCase();
      const searchBlob = [name, ownerDisp, ownerRaw, bin, lin, vcd].join('\n');
      if (nameFilter && !searchBlob.includes(nameFilter)) return false;
      if (tagFilter && !tagVal.includes(tagFilter)) return false;
      if (!tcMatchesRunLibraryTagColor(row.tc, runLibraryTagColorFilter)) return false;
      if (dateWant) {
        const ymd = tcModifiedYmd(row.tc);
        if (!ymd || ymd !== dateWant) return false;
      }
      return true;
    });
  }, [browsedRows, nameFilter, tagFilter, runLibraryTagColorFilter, runLibraryDateFilter, activeProfileId, ownerLabelCtx]);

  useEffect(() => {
    setSelectedLeftKeys((prev) => {
      const allowed = new Set(filteredLibraryRows.map((r) => r.key));
      return new Set([...prev].filter((k) => allowed.has(k)));
    });
  }, [filteredLibraryRows]);

  const runLibraryDatePickOptions = useMemo(() => {
    const seen = new Set();
    (browsedRows || []).forEach((row) => {
      const ymd = tcModifiedYmd(row.tc);
      if (ymd) seen.add(ymd);
    });
    return [...seen].sort((a, b) => b.localeCompare(a)).slice(0, 120);
  }, [browsedRows]);

  const runLibraryUniqueTags = useMemo(() => {
    const seen = new Set();
    const out = [];
    (browsedRows || []).forEach((row) => {
      const ex = row.tc.extraColumns && typeof row.tc.extraColumns === 'object' ? row.tc.extraColumns : {};
      const raw = ex.tag ?? ex.Tag ?? '';
      splitTagsComma(String(raw)).forEach((part) => {
        const v = String(part || '').trim();
        if (!v) return;
        const k = v.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push(v);
      });
    });
    return out.sort((a, b) => a.localeCompare(b));
  }, [browsedRows]);

  const runLibraryTagPickerOptions = useMemo(() => {
    const q = (runListTagFilter || '').trim().toLowerCase();
    if (!q) return runLibraryUniqueTags;
    return runLibraryUniqueTags.filter((t) => t.toLowerCase().includes(q));
  }, [runLibraryUniqueTags, runListTagFilter]);

  /** Library list (section 1): selected rows in visible order — used for multi-drag payload */
  const leftPanelOrderedSelectedRows = useMemo(
    () =>
      filteredLibraryRows.filter(
        (r) => selectedLeftKeys.has(r.key) && !isTcManuallyClosedForPicker(r.tc)
      ),
    [filteredLibraryRows, selectedLeftKeys]
  );

  /** Extra CSV-style columns for browse modal — same hide rules as TC Library table */
  const runPickerModalExtraCols = useMemo(() => {
    const cols = new Set();
    (filteredLibraryRows || []).forEach((r) => {
      Object.keys(r?.tc?.extraColumns || {}).forEach((k) => {
        if (!isExtraColumnHiddenFromLibraryTable(k)) cols.add(k);
      });
    });
    return [...cols].sort((a, b) => a.localeCompare(b));
  }, [filteredLibraryRows]);

  /** Same as TC Library: Vis=closed (manual) rows are never bulk-selected. */
  const browsePickerSelectableKeys = useMemo(
    () => filteredLibraryRows.filter((r) => !isTcManuallyClosedForPicker(r.tc)).map((r) => r.key),
    [filteredLibraryRows]
  );
  const browsePickerAllVisibleSelected = useMemo(
    () =>
      browsePickerSelectableKeys.length > 0 &&
      browsePickerSelectableKeys.every((k) => selectedBrowsedKeys.has(k)),
    [browsePickerSelectableKeys, selectedBrowsedKeys]
  );
  const browsePickerSomeVisibleSelected = useMemo(
    () => browsePickerSelectableKeys.some((k) => selectedBrowsedKeys.has(k)),
    [browsePickerSelectableKeys, selectedBrowsedKeys]
  );

  useEffect(() => {
    const el = browsePickerSelectAllRef.current;
    if (!el || typeof el.indeterminate !== 'boolean') return;
    el.indeterminate = browsePickerSomeVisibleSelected && !browsePickerAllVisibleSelected;
  }, [browsePickerSomeVisibleSelected, browsePickerAllVisibleSelected]);

  useEffect(() => {
    if (!runTagSuggestOpenLibrary && !runTagSuggestOpenPicker) return;
    const onDoc = (e) => {
      if (runTagSuggestLibraryRef.current?.contains(e.target)) return;
      if (runTagSuggestPickerRef.current?.contains(e.target)) return;
      setRunTagSuggestOpenLibrary(false);
      setRunTagSuggestOpenPicker(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [runTagSuggestOpenLibrary, runTagSuggestOpenPicker]);

  useEffect(() => {
    if (!runTagSuggestOpenLibrary && !runTagSuggestOpenPicker) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setRunTagSuggestOpenLibrary(false);
        setRunTagSuggestOpenPicker(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runTagSuggestOpenLibrary, runTagSuggestOpenPicker]);

  const selectAllBrowsed = () =>
    setSelectedBrowsedKeys(
      new Set(
        filteredLibraryRows.filter((r) => !isTcManuallyClosedForPicker(r.tc)).map((r) => r.key)
      )
    );

  const addToRunPreview = useCallback((row, atIndex = null) => {
    const item = {
      key: `${row.key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      setId: row.setId,
      set: row.set,
      tc: row.tc,
      order: 0,
    };
    setRunPreview((prev) => {
      const next = atIndex != null && atIndex >= 0 && atIndex <= prev.length
        ? [...prev.slice(0, atIndex), item, ...prev.slice(atIndex)]
        : [...prev, item];
      return next.map((it, idx) => ({ ...it, order: idx + 1 }));
    });
  }, []);

  const addLibraryRowsToRunPreview = useCallback((rows, atIndex = null) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const t0 = Date.now();
    setRunPreview((prev) => {
      const newItems = rows.map((row, i) => ({
        key: `${row.key}-${t0}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        setId: row.setId,
        set: row.set,
        tc: row.tc,
        order: 0,
      }));
      const next =
        atIndex != null && atIndex >= 0 && atIndex <= prev.length
          ? [...prev.slice(0, atIndex), ...newItems, ...prev.slice(atIndex)]
          : [...prev, ...newItems];
      return next.map((it, idx) => ({ ...it, order: idx + 1 }));
    });
  }, []);

  /**
   * Build run-preview items from a set while skipping duplicate test cases.
   * Duplicate key uses same rule as left-library dedupe (name + file tuple).
   */
  const buildDedupedRunItemsFromSet = useCallback(
    (set, existingTcs = []) => {
      const seen = new Set((Array.isArray(existingTcs) ? existingTcs : []).map((tc) => contentKeyTc(tc)));
      let skipped = 0;
      const out = [];
      (Array.isArray(set?.items) ? set.items : []).forEach((tc, idx) => {
        const k = contentKeyTc(tc);
        if (seen.has(k)) {
          skipped += 1;
          return;
        }
        seen.add(k);
        out.push({
          key: `${set.id}-${idx}-${Date.now()}-${tc.id || tc.name || tc.vcdName || ''}`,
          setId: set.id,
          set,
          tc,
          order: out.length + 1,
        });
      });
      return { items: out, skipped };
    },
    [contentKeyTc]
  );

  const removeFromRunPreview = useCallback((index) => {
    setRunPreview((prev) => prev.filter((_, i) => i !== index).map((it, idx) => ({ ...it, order: idx + 1 })));
    setSelectedRunIndex((i) => (i === index ? null : i > index ? i - 1 : i));
  }, []);

  const reorderRunPreview = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setRunPreview((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next.map((it, idx) => ({ ...it, order: idx + 1 }));
    });
    setSelectedRunIndex((i) => {
      if (i === fromIndex) return toIndex;
      if (fromIndex < i && toIndex >= i) return i - 1;
      if (fromIndex > i && toIndex <= i) return i + 1;
      return i;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
      const isCopy = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c';
      const isPaste = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v';
      if (isCopy) {
        if (selectedRunIndex !== null && runPreview[selectedRunIndex]) {
          setTcClipboard([{ row: { key: runPreview[selectedRunIndex].key, setId: runPreview[selectedRunIndex].setId, set: runPreview[selectedRunIndex].set, tc: runPreview[selectedRunIndex].tc } }]);
          addToast({ type: 'info', message: 'Copied test case' });
        } else if (selectedLeftKeys.size > 0) {
          const rows = filteredLibraryRows.filter((r) => selectedLeftKeys.has(r.key));
          if (rows.length > 0) {
            setTcClipboard(rows.map((row) => ({ row })));
            addToast({ type: 'info', message: rows.length > 1 ? `Copied ${rows.length} test cases` : 'Copied test case' });
          }
        }
      } else if (isPaste) {
        const rightEl = runSetRightRef.current;
        if (rightEl && (document.activeElement === rightEl || rightEl.contains(document.activeElement)) && tcClipboard.length > 0) {
          setRunPreview((prev) => {
            const newItems = tcClipboard.map(({ row }) => ({
              key: `${row.key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              setId: row.setId,
              set: row.set,
              tc: row.tc,
              order: prev.length + 1,
            }));
            return prev.concat(newItems).map((it, idx) => ({ ...it, order: idx + 1 }));
          });
          addToast({ type: 'info', message: `Pasted ${tcClipboard.length} test case(s)` });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRunIndex, selectedLeftKeys, runPreview, filteredLibraryRows, tcClipboard, addToast]);

  const buildJobFromSet = (set, testCasesOverride = null) => {
    const items = testCasesOverride != null ? testCasesOverride : (set.items || []);
    const missingNames = new Set(); // ชื่อไฟล์ที่ไม่พบใน Library (ไม่ซ้ำ)
    const filesPayload = [];
    let firstBinName = '';
    for (let i = 0; i < items.length; i++) {
      const tc = items[i];
      const vcdFile = safeFiles.find((f) => f.name === (tc.vcdName || ''));
      const binFile = safeFiles.find((f) => f.name === (tc.binName || ''));
      const linFile = (tc.linName && safeFiles.find((f) => f.name === tc.linName)) || null;
      if (!vcdFile || !binFile) {
        if (tc.vcdName && !safeFiles.find((f) => f.name === tc.vcdName)) missingNames.add(tc.vcdName);
        if (tc.binName && !safeFiles.find((f) => f.name === tc.binName)) missingNames.add(tc.binName);
        continue;
      }
      if (!firstBinName) firstBinName = tc.binName || '';
      // ใช้ชื่อ test case เท่านั้น — ไม่ใช้ชื่อไฟล์ (ต้องแสดงชื่อจาก set/ตาราง ไม่ใช่ชื่อไฟล์)
      const displayName = (tc.name || '').trim();
      const testCaseName = displayName || `Test case ${i + 1}`;
      filesPayload.push({
        name: vcdFile.name,
        order: i + 1,
        vcd: vcdFile.name,
        erom: binFile.name,
        ulp: linFile?.name || null,
        try_count: typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
        testCaseName,
      });
    }
    const missing = [...missingNames];
    const pairsData = items.map((tc, idx) => {
      const vcdFile = safeFiles.find((f) => f.name === (tc.vcdName || ''));
      const binFile = safeFiles.find((f) => f.name === (tc.binName || ''));
      const linFile = (tc.linName && safeFiles.find((f) => f.name === tc.linName)) || null;
      const tcName = (tc.name || '').trim() || `Test case ${idx + 1}`;
      return {
        vcdId: vcdFile?.id,
        binId: binFile?.id,
        linId: linFile?.id || null,
        vcdName: tc.vcdName || '',
        binName: tc.binName || '',
        linName: tc.linName || null,
        try: typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
        boardId: tc.boardId || null,
        boardName: tc.boardId ? (safeBoards.find((b) => b.id === tc.boardId)?.name) : null,
        testCaseName: tcName, // ชื่อ test case สำหรับ persist หลัง restart
      };
    });
    return { missing, filesPayload, firstBinName, pairsData };
  };

  const saveCurrentRunSet = (options = { showToast: true }) => {
    if (runPreview.length === 0) {
      if (options.showToast) {
        addToast({ type: 'warning', message: 'Add test cases to Set for run first (drag from left or Load a set)' });
      }
      return null;
    }
    const items = runPreview.map((item) => item.tc);
    if (items.length === 0) {
      if (options.showToast) addToast({ type: 'warning', message: 'No test cases to save' });
      return null;
    }
    const name = (runSetName || '').trim() || `Set ${safeSets.length + 1}`;
    const fileNames = new Set();
    items.forEach((t) => {
      if (t.vcdName) fileNames.add(t.vcdName);
      if (t.binName) fileNames.add(t.binName);
      if (t.linName) fileNames.add(t.linName);
    });
    const fileLibrarySnapshot = [...fileNames].map((n) => ({ name: n }));
    const tagTrim = (tag || '').trim();
    const colorKey = TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint';
    addSavedTestCaseSet(name, items, {
      fileLibrarySnapshot,
      ...(tagTrim ? { tag: tagTrim, tagColor: colorKey } : {}),
    });
    const sets = useTestStore.getState().savedTestCaseSets;
    const newSetId = Array.isArray(sets) && sets.length ? sets[sets.length - 1]?.id : null;
    if (newSetId && safeFiles.length > 0) {
      const fileIds = safeFiles.filter((f) => fileNames.has(f.name)).map((f) => f.id);
      if (fileIds.length > 0) {
        api.saveSetFiles(newSetId, fileIds).catch((err) => console.error('Save set files failed', err));
      }
    }
    if (options.showToast) {
      addToast({ type: 'success', message: `Saved "${name}" (${items.length} case(s)) — see SAVED on Test Cases page` });
    }
    return { id: newSetId, name, count: items.length };
  };

  const runSelected = async (options = { startImmediately: true, navigateToJobs: true }) => {
    const { startImmediately = true, navigateToJobs = true } = options || {};
    const usingPreview = runPreview.length > 0;
    const setsToRun = usingPreview ? [] : selectedRunnableSets;

    if (!usingPreview && setsToRun.length === 0) {
      addToast({ type: 'warning', message: 'Select at least one set to run or add test cases to the list first' });
      return;
    }
    if (usingPreview && runPreview.length === 0) {
      addToast({ type: 'warning', message: 'Select test cases to run first' });
      return;
    }
    if (boardSelectionMode === 'manual' && selectedBoardIds.length === 0) {
      addToast({ type: 'warning', message: 'Select at least one board (or switch to Auto assign)' });
      return;
    }

    // แจ้งเตือนถ้ามี set ที่ถูกเลือกแต่กำลังรันอยู่ (จะถูกข้ามอัตโนมัติ)
    if (!usingPreview) {
      const inUseSelected = safeSets.filter((set) => selectedSetIds.includes(set.id) && isSetInUseByJobs(set));
      if (inUseSelected.length > 0) {
        const names = inUseSelected.map((s) => s.name || 'Unnamed').join(', ');
        addToast({
          type: 'info',
          message: `sets that are running will not be sent again: ${names}`,
        });
      }
    } else {
      // Auto-save current selection as a set so it appears in SAVED
      saveCurrentRunSet({ showToast: false });
    }

    const boardNames = boardSelectionMode === 'auto'
      ? []
      : safeBoards.filter((b) => selectedBoardIds.includes(b.id)).map((b) => b.name);

    const jobsToCreate = [];
    const errorsPerSet = [];

    if (usingPreview) {
      const virtualSet = { id: '__run__', name: (runSetName || '').trim() || 'Run' };
      const cases = runPreview.map((item) => item.tc);
      const { missing, filesPayload, firstBinName, pairsData } = buildJobFromSet(virtualSet, cases);
      if (missing.length > 0) {
        const list = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` +${missing.length - 5} files` : '');
        errorsPerSet.push(`Files not found in Library — ${list}`);
      } else if (filesPayload.length > 0) {
        const jobName = (runSetName || '').trim() || virtualSet.name;
        jobsToCreate.push({
          name: jobName,
          tag: tag || undefined,
          tagColor: TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint',
          firmware: firstBinName,
          boards: boardNames,
          priority: prioritize ? 'high' : undefined,
          files: filesPayload,
          configName: jobName,
          pairsData,
        });
      }
      if (filesPayload.length === 0 && missing.length === 0) {
        errorsPerSet.push('No test cases with both VCD and ERoM');
      }
    } else {
      // Run ตามชุดที่เลือกไว้ (แต่ละ set = 1 job), ข้าม set ที่กำลังรัน
      setsToRun.forEach((set) => {
        const { missing, filesPayload, firstBinName, pairsData } = buildJobFromSet(set, null);
        if (missing.length > 0) {
          const list = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` +${missing.length - 5} files` : '');
          errorsPerSet.push(`Set "${set.name || set.id}": Files not found in Library — ${list}`);
        } else if (filesPayload.length > 0) {
          const jobName = (set.name || '').trim() || `Set ${setsToRun.indexOf(set) + 1}`;
          const setTagRaw = (set?.tag || '').trim();
          const fallbackTagColor = TAG_PALETTE_MAP[set?.tagColor] ? set.tagColor : null;
          const fallbackRunColor = TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint';
          const resolvedTagRaw = (tag || '').trim() || setTagRaw;
          const resolvedTagColor = fallbackTagColor || fallbackRunColor;
          jobsToCreate.push({
            name: jobName,
            tag: resolvedTagRaw || undefined,
            tagColor: resolvedTagColor,
            firmware: firstBinName,
            boards: boardNames,
            priority: prioritize ? 'high' : undefined,
            files: filesPayload,
            configName: jobName,
            pairsData,
          });
        }
      });
      if (jobsToCreate.length === 0 && errorsPerSet.length === 0) {
        errorsPerSet.push('No test cases with both VCD and ERoM in selected sets');
      }
    }

    if (errorsPerSet.length > 0) {
      const msg = errorsPerSet.join(' | ') + ' — Upload files on Test Cases → File Library first';
      addToast({ type: 'error', message: msg, duration: 8000 });
      if (jobsToCreate.length === 0) return;
    }

    setIsSubmitting(true);
    try {
      let created = 0;
      for (const payload of jobsToCreate) {
        const result = await createJob(payload, { startImmediately });
        if (result) created++;
      }
      if (created > 0) {
        if (refreshJobs) await refreshJobs();
        const tagTrim = (tag || '').trim();
        if (tagTrim && !usingPreview) {
          const colorKey = TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint';
          const parts = splitTagsComma(tagTrim);
          const patch = { tag: tagTrim, tagColor: colorKey };
          if (parts.length > 0) {
            patch.tagColorList = parts.map(() => colorKey);
          }
          setsToRun.forEach((s) => updateSavedTestCaseSet(s.id, patch));
        }
        addToast({
          type: 'success',
          message: startImmediately
            ? `${created} job(s) sent to queue — see Jobs Manager (Running)`
            : `${created} job(s) created in Pending — see Jobs Manager (Pending)`,
        });
        clearSection3RunConfig();
        if (startImmediately) {
          setRunPreview([]);
        }
        if (navigateToJobs && onNavigateJobs) onNavigateJobs();
      }
      if (created < jobsToCreate.length) {
        addToast({ type: 'warning', message: `Created ${created}/${jobsToCreate.length} set(s)` });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveSelectedNotRun = useCallback(() => {
    if (runPreview.length > 0) {
      saveCurrentRunSet({ showToast: true });
      clearSection3RunConfig();
      return;
    }
    if (selectedSetIds.length !== 1) {
      addToast({ type: 'warning', message: 'Load test cases into “Set for run” or select one set and edit name/tag' });
      return;
    }
    const set = safeSets.find((s) => s.id === selectedSetIds[0]);
    if (!set) {
      addToast({ type: 'error', message: 'Set not found' });
      return;
    }
    const name = (runSetName || '').trim();
    if (!name) {
      addToast({ type: 'warning', message: 'Set name cannot be empty' });
      return;
    }
    if (!hasSingleSetMetadataDirty) {
      addToast({ type: 'info', message: 'No changes to save' });
      return;
    }
    const colorKey = TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint';
    const tagTrim = (tag || '').trim();
    const patch = { name };
    if (tagTrim) {
      patch.tag = tagTrim;
      patch.tagColor = colorKey;
      const parts = splitTagsComma(tagTrim);
      if (parts.length > 0) {
        patch.tagColorList = parts.map(() => colorKey);
      }
    } else {
      patch.tag = '';
      patch.tagColor = 'mint';
      patch.tagColorList = [];
    }
    updateSavedTestCaseSet(set.id, patch);
    addToast({ type: 'success', message: `Saved "${name}"` });
    clearSection3RunConfig();
  }, [
    runPreview.length,
    saveCurrentRunSet,
    clearSection3RunConfig,
    selectedSetIds,
    safeSets,
    runSetName,
    tag,
    runSetTagColor,
    hasSingleSetMetadataDirty,
    addToast,
    updateSavedTestCaseSet,
  ]);

  return (
    <div className="flex min-h-0 w-full max-w-none min-w-0 flex-1 flex-col space-y-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Run Set</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">Browse to select test cases, then run. Set for run is built on this page.</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        {/* Two columns: left = Browse test cases, right = Set for run (larger — important process) */}
        <div className="mb-4 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_1.25fr] lg:min-h-[min(680px,calc(100dvh-17rem))]">
          {/* Left — Library list (filter + scroll, draggable) */}
          <div className="flex min-h-[420px] flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/50 lg:min-h-0 lg:h-full">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">1. Test cases in library</h3>
            <div className="flex flex-col gap-2 mb-2 shrink-0">
              <div className="relative w-full">
                <select
                  value={runLibraryOwnerFilter === 'mine' ? '__active__' : runLibraryOwnerFilter}
                  onChange={(e) => setRunLibraryOwnerFilter(e.target.value)}
                  className="w-full appearance-none cursor-pointer px-2.5 py-1.5 pr-9 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  title="Filter by owner. “All owners” loads merged library from the server (like TC Library)."
                >
                  <option value="__active__">
                    {resolveOwnerDisplayName(activeProfileId, ownerLabelCtx) || activeProfile?.name || 'My profile'} (this device)
                  </option>
                  <option value="all">All owners</option>
                  {allOwnerProfiles
                    .filter((p) => String(p?.id) !== String(activeProfileId))
                    .map((p) => (
                      <option key={`runset-owner-${p.id}`} value={String(p.id)}>
                        {p.name || p.id}
                      </option>
                    ))}
                  <option value="shared">Shared with me (other owners)</option>
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  name="runset-lib-filter-name"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Name, owner, or file…"
                  value={runListNameFilter}
                  onChange={(e) => setRunListNameFilter(e.target.value)}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <div ref={runTagSuggestLibraryRef} className="relative z-20 flex-1 min-w-0">
                  <input
                    type="text"
                    name="runset-lib-filter-tag"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Filter by tag"
                    value={runListTagFilter}
                    onChange={(e) => setRunListTagFilter(e.target.value)}
                    onFocus={() => {
                      setRunTagSuggestOpenPicker(false);
                    }}
                    title="Type to filter by tag — use ▼ for common tags"
                    className="w-full min-w-0 px-2.5 py-1.5 pr-9 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    aria-expanded={runTagSuggestOpenLibrary}
                    aria-haspopup="listbox"
                    aria-label="Show tag suggestions"
                    className="absolute right-0.5 top-1/2 z-[2] inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    title="Browse tags used in this list"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      setRunTagSuggestOpenPicker(false);
                      setRunTagSuggestOpenLibrary((v) => !v);
                    }}
                  >
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${runTagSuggestOpenLibrary ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>
                  {runTagSuggestOpenLibrary && (
                    <div
                      role="listbox"
                      aria-label="Tag suggestions"
                      className="absolute left-0 right-0 top-[calc(100%+4px)] z-[100] max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl dark:border-slate-600 dark:bg-slate-900"
                    >
                      <button
                        type="button"
                        role="option"
                        className="w-full px-2.5 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setRunListTagFilter('');
                          setRunTagSuggestOpenLibrary(false);
                        }}
                      >
                        Clear tag filter…
                      </button>
                      {runLibraryTagPickerOptions.length === 0 ? (
                        <div className="px-2.5 py-2 text-xs text-slate-500 dark:text-slate-400">
                          {runLibraryUniqueTags.length === 0
                            ? 'No tags on test cases in this list — type any text to filter.'
                            : 'No tag matches — type to narrow (substring).'}
                        </div>
                      ) : (
                        runLibraryTagPickerOptions.slice(0, 80).map((t) => (
                          <button
                            key={`run-lib-tag-opt-${t}`}
                            type="button"
                            role="option"
                            className="w-full truncate px-2.5 py-1.5 text-left text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setRunListTagFilter(t);
                              setRunTagSuggestOpenLibrary(false);
                            }}
                          >
                            {t}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <RunTagColorFilterDropdown
                  value={runLibraryTagColorFilter}
                  onChange={setRunLibraryTagColorFilter}
                  placeholder="All tag colors"
                  size="sm"
                  className="shrink-0 w-full sm:w-[11rem] lg:w-[11.5rem]"
                />
                <div className="relative shrink-0 w-full sm:w-[10.75rem] min-w-[8rem]">
                  <select
                    value={runLibraryDateFilter}
                    onChange={(e) => setRunLibraryDateFilter(e.target.value)}
                    className="w-full appearance-none cursor-pointer px-2.5 py-1.5 pr-9 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    title="Filter by modified date (Date column)"
                  >
                    <option value="">All dates</option>
                    {runLibraryDatePickOptions.map((ymd) => {
                      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
                      const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null;
                      const lbl =
                        dt && !Number.isNaN(dt.getTime())
                          ? dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                          : ymd;
                      return (
                        <option key={`run-lib-date-${ymd}`} value={ymd}>
                          {lbl}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown
                    aria-hidden
                    className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                  />
                </div>
              </div>
              {runLibraryOwnerFilter !== '__active__' && runLibraryOwnerFilter !== 'mine' && !globalTestCaseDataLoaded ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Loading merged library from server…</p>
              ) : null}
              {filteredLibraryRows.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700/60 dark:bg-blue-900/25 dark:text-blue-300 dark:hover:bg-blue-900/40"
                    title="Select every visible row except Vis=closed (same as TC Library picker)"
                    onClick={() =>
                      setSelectedLeftKeys(
                        new Set(
                          filteredLibraryRows.filter((r) => !isTcManuallyClosedForPicker(r.tc)).map((r) => r.key)
                        )
                      )
                    }
                  >
                    Select all 
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80"
                    onClick={() => setSelectedLeftKeys(new Set())}
                  >
                    Clear
                  </button>
                  <span className="text-slate-500 dark:text-slate-500">{selectedLeftKeys.size} selected</span>
                  <span className="hidden sm:inline text-slate-400 dark:text-slate-500">
                    · Click row: select one · ⌘/Ctrl+click toggle · Shift+click range
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-inner scroll-smooth" style={{ scrollBehavior: 'smooth' }}>
              {filteredLibraryRows.length === 0 ? (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">
                  {browsedRows.length === 0
                    ? runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine'
                      ? 'No test cases yet — create on Test Cases page or choose “All owners” to pick others’ cases.'
                      : 'No test cases for this owner filter — try “All owners” or check the server connection.'
                    : 'No test cases match name / tag / tag color / date filters'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-600">
                  {filteredLibraryRows.map((row, rowIdx) => {
                    const tagVal = row.tc.extraColumns?.tag ?? '';
                    const isSelected = selectedLeftKeys.has(row.key);
                    const visBulkOff = isTcManuallyClosedForPicker(row.tc);
                    const isFromCurrent = row.setId === '__current__';
                    const ownerHint =
                      runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine'
                        ? ''
                        : resolveOwnerDisplayName(row.tc._ownerId ?? row.set?._ownerId ?? activeProfileId, ownerLabelCtx);
                    const dragPayloadRows =
                      isSelected && leftPanelOrderedSelectedRows.length > 1
                        ? leftPanelOrderedSelectedRows
                        : [row];
                    return (
                      <li
                        key={row.key}
                        draggable={!visBulkOff}
                        onDragStart={(e) => {
                          if (visBulkOff) return;
                          const rows = dragPayloadRows.filter((r) => !isTcManuallyClosedForPicker(r.tc));
                          const payload =
                            rows.length > 1
                              ? { type: 'library', rows }
                              : { type: 'library', row: rows[0] || row };
                          e.dataTransfer.setData('application/json', JSON.stringify(payload));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={(e) => {
                          if (e.target.closest('input, button')) return;
                          if (visBulkOff) return;
                          if (e.shiftKey && leftListShiftAnchorIdxRef.current != null) {
                            const anchor = leftListShiftAnchorIdxRef.current;
                            const a = Math.min(anchor, rowIdx);
                            const b = Math.max(anchor, rowIdx);
                            const rangeKeys = filteredLibraryRows
                              .slice(a, b + 1)
                              .filter((r) => !isTcManuallyClosedForPicker(r.tc))
                              .map((r) => r.key);
                            setSelectedLeftKeys(new Set(rangeKeys));
                            return;
                          }
                          if (e.metaKey || e.ctrlKey) {
                            setSelectedLeftKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.key)) next.delete(row.key);
                              else next.add(row.key);
                              return next;
                            });
                            leftListShiftAnchorIdxRef.current = rowIdx;
                            return;
                          }
                          setSelectedLeftKeys(new Set([row.key]));
                          leftListShiftAnchorIdxRef.current = rowIdx;
                        }}
                        className={`flex items-center gap-2 px-2 sm:px-3 min-h-[56px] transition-colors ${
                          visBulkOff
                            ? 'cursor-not-allowed opacity-80 bg-slate-50/80 dark:bg-slate-800/40'
                            : 'cursor-grab active:cursor-grabbing hover:bg-slate-100 dark:hover:bg-slate-800/50'
                        } ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 ring-inset ring-1 ring-blue-300 dark:ring-blue-600' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className={`w-4 h-4 shrink-0 rounded border-slate-400 text-blue-600 ${
                            visBulkOff ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                          }`}
                          checked={isSelected}
                          disabled={visBulkOff}
                          title={
                            visBulkOff
                              ? 'Vis closed — cannot select (excluded from Select all)'
                              : 'Include in multi-drag / ⌘C copy'
                          }
                          onChange={() => {
                            if (visBulkOff) return;
                            setSelectedLeftKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.key)) next.delete(row.key);
                              else next.add(row.key);
                              return next;
                            });
                            leftListShiftAnchorIdxRef.current = rowIdx;
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <GripVertical size={16} className="text-slate-400 shrink-0 flex-shrink-0 pointer-events-none" aria-hidden />
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 py-1.5">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{row.tc.name || row.tc.vcdName || '—'}</div>
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
                              {ownerHint ? `${ownerHint} · ` : ''}
                              {isFromCurrent ? 'From table' : `From set: ${row.set?.name || row.setId || 'Set'}`}
                            </span>
                          </div>
                          {tagVal ? (
                            <span
                              className={`inline-block w-fit px-1.5 py-0.5 rounded text-[10px] font-medium border ${getFirstTagPillClass(row.tc.extraColumns, String(tagVal))}`}
                            >
                              {String(tagVal)}
                            </span>
                          ) : (
                            <span className="inline-block h-4" aria-hidden="true" />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 shrink-0 leading-relaxed">
              Drag one or <span className="font-medium text-slate-600 dark:text-slate-300">all selected</span> to the right; or Copy (⌘/Ctrl+C) then focus the right panel and Paste (⌘/Ctrl+V).{' '}
              <button
                type="button"
                onClick={() => setShowBrowseModal(true)}
                className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700/60 dark:bg-blue-900/25 dark:text-blue-300 dark:hover:bg-blue-900/40"
              >
                Open picker (TC Library table)
              </button>
            </p>
          </div>

          {/* Right — 2. Set for run (drop zone + list, reorder) — ใหญ่ขึ้นเพื่อให้จัดการ test cases ได้ง่าย */}
          <div
            ref={runSetRightRef}
            tabIndex={0}
            className="flex min-h-[420px] flex-col rounded-xl border-2 border-slate-200 bg-white p-4 outline-none dark:border-slate-600 dark:bg-slate-900 lg:min-h-0 lg:h-full"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; e.currentTarget.classList.add('ring-2', 'ring-blue-400'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('ring-2', 'ring-blue-400'); }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('ring-2', 'ring-blue-400');
              try {
                const raw = e.dataTransfer.getData('application/json');
                if (!raw) return;
                const data = JSON.parse(raw);
                if (data.type === 'library') {
                  const rows = Array.isArray(data.rows) && data.rows.length ? data.rows : data.row ? [data.row] : [];
                  if (rows.length === 0) return;
                  const dropEl = e.target.closest('[data-drop-index]');
                  const atIndex = dropEl ? parseInt(dropEl.getAttribute('data-drop-index'), 10) : null;
                  const insertAt = !Number.isNaN(atIndex) && atIndex >= 0 ? atIndex : null;
                  addLibraryRowsToRunPreview(rows, insertAt);
                } else if (data.type === 'run' && typeof data.fromIndex === 'number') {
                  const dropEl = e.target.closest('[data-drop-index]');
                  const toIndex = dropEl ? parseInt(dropEl.getAttribute('data-drop-index'), 10) : null;
                  if (!Number.isNaN(toIndex) && toIndex >= 0) reorderRunPreview(data.fromIndex, toIndex);
                }
              } catch (_) {}
            }}
          >
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">2. Set for run</h3>
            {runPreview.length === 0 ? (
              <div
                className="flex-1 flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30 min-h-[200px]"
                data-drop-index="0"
              >
                <span className="text-sm text-slate-500 dark:text-slate-400">Drop test cases here or paste (⌘/Ctrl+V)</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{runPreview.length} test case(s)</span>
                  <button type="button" onClick={() => { setRunPreview([]); setSelectedRunIndex(null); }} className="text-xs font-bold text-slate-600 hover:text-slate-800 dark:hover:text-slate-200">Clear all</button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 shadow-inner scroll-smooth" style={{ scrollBehavior: 'smooth' }}>
                  <div className="divide-y divide-slate-200 dark:divide-slate-600">
                    {runPreview.map((item, idx) => (
                      <div
                        key={item.key}
                        draggable
                        data-drop-index={idx}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify({ type: 'run', fromIndex: idx }));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            const raw = e.dataTransfer.getData('application/json');
                            if (!raw) return;
                            const data = JSON.parse(raw);
                            if (data.type === 'run' && typeof data.fromIndex === 'number' && data.fromIndex !== idx) {
                              reorderRunPreview(data.fromIndex, idx);
                            }
                          } catch (_) {}
                        }}
                        onClick={() => setSelectedRunIndex(idx)}
                    className={`flex items-center gap-3 px-3 min-h-[56px] bg-white dark:bg-slate-900 cursor-grab active:cursor-grabbing hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${selectedRunIndex === idx ? 'ring-inset ring-1 ring-blue-400 dark:ring-blue-500' : ''}`}
                      >
                        <GripVertical size={16} className="text-slate-400 shrink-0 flex-shrink-0" />
                    <div className="w-6 text-xs font-bold text-slate-500 shrink-0 text-center">{idx + 1}</div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center py-1.5">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{item.tc.name || item.tc.vcdName || '—'}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{item.tc.vcdName || '—'}{item.tc.binName ? ` · ${item.tc.binName}` : ''}</div>
                        </div>
                    <div className="flex flex-col items-center gap-0.5 mr-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (idx > 0) reorderRunPreview(idx, idx - 1); }}
                        disabled={idx === 0}
                        className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        title="Move up"
                      >
                        <ArrowUp size={12} className="text-slate-400" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (idx < runPreview.length - 1) reorderRunPreview(idx, idx + 1); }}
                        disabled={idx === runPreview.length - 1}
                        className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        title="Move down"
                      >
                        <ArrowDown size={12} className="text-slate-400" />
                      </button>
                    </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeFromRunPreview(idx); }}
                          className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 shrink-0 transition-colors"
                          title="Remove"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <div data-drop-index={runPreview.length} className="min-h-[12px]" aria-hidden="true" />
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2 shrink-0">Drag to reorder. Copy/Paste: ⌘/Ctrl+C then ⌘/Ctrl+V.</p>
              </>
            )}
          {/* Saved sets list embedded under Set for run */}
          <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase">Saved sets</h4>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  {safeSets.length} set(s)
                </span>
              </div>
            </div>
            {safeSets.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No saved sets yet — create and save on the Test Cases page.
              </p>
            ) : (
            <div className="space-y-1 min-h-[120px] max-h-56 overflow-y-auto overflow-x-hidden pr-2">
                {safeSets.map((set, index) => {
                const status = getRunSetStatusForSet(set); // 'pending' | 'running' | null
                const inUse = !!status;
                const setBusy = !!(savedTestCaseSetPendingById && savedTestCaseSetPendingById[String(set.id)]);
                return (
                  <div
                    key={set.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 ${setBusy ? 'ring-1 ring-amber-400/50 dark:ring-amber-500/40' : ''}`}
                  >
                    <div className="flex flex-col gap-0 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveSavedTestCaseSetUp(set.id)}
                        disabled={index === 0 || setBusy}
                        className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp size={12} className="text-slate-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSavedTestCaseSetDown(set.id)}
                        disabled={index === safeSets.length - 1 || setBusy}
                        className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown size={12} className="text-slate-500" />
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-400 w-4 shrink-0">#{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      {editingSetId === set.id ? (
                        <>
                          <div className="flex items-center gap-2 mb-1">
                            <input
                              type="text"
                              value={editingSetName}
                              onChange={(e) => setEditingSetName(e.target.value)}
                              className="flex-1 min-w-0 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-[11px]"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const trimmed = (editingSetName || '').trim();
                                if (!trimmed) {
                                  addToast({ type: 'warning', message: 'Set name cannot be empty' });
                                  return;
                                }
                                updateSavedTestCaseSet(set.id, { name: trimmed });
                                setEditingSetId(null);
                                setEditingSetName('');
                                addToast({ type: 'success', message: `Renamed set to "${trimmed}"` });
                              }}
                              className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSetId(null);
                                setEditingSetName('');
                              }}
                              className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-semibold"
                            >
                              Cancel
                            </button>
                          </div>
                          {set.createdAt && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              {new Date(set.createdAt).toLocaleString()}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                              {set.name}
                            </span>
                            {status === 'running' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 text-[9px] font-semibold">
                                Running
                              </span>
                            )}
                            {status === 'pending' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 text-[9px] font-semibold">
                                Pending
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              {Array.isArray(set.items) ? `${set.items.length} cases` : ''}
                            </span>
                          </div>
                          {set.createdAt && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              {new Date(set.createdAt).toLocaleString()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        disabled={setBusy}
                        onClick={() => {
                          if (setBusy) return;
                          const { items, skipped } = buildDedupedRunItemsFromSet(set, []);
                          setRunPreview(items);
                          setRunSetName(set.name || '');
                          if (items.length === 0) {
                            addToast({ type: 'warning', message: `Set "${set.name}" has no unique test cases to load` });
                            return;
                          }
                          addToast({
                            type: skipped > 0 ? 'info' : 'success',
                            message:
                              skipped > 0
                                ? `Loaded "${set.name}" (${items.length} unique, skipped ${skipped} duplicate TC)`
                                : `Loaded set "${set.name}" for run`,
                          });
                        }}
                        className="px-2 py-1 rounded font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        disabled={setBusy}
                        onClick={() => {
                          if (setBusy) return;
                          const existingTcs = runPreview.map((it) => it.tc);
                          const { items, skipped } = buildDedupedRunItemsFromSet(set, existingTcs);
                          if (items.length === 0) {
                            addToast({
                              type: 'info',
                              message: `No new TC to append from "${set.name}" (all duplicates in run list)`,
                            });
                            return;
                          }
                          setRunPreview((prev) => prev.concat(items).map((it, i) => ({ ...it, order: i + 1 })));
                          setRunSetName((prev) => (prev ? `${prev}, ${set.name || ''}` : (set.name || '')));
                          addToast({
                            type: skipped > 0 ? 'info' : 'success',
                            message:
                              skipped > 0
                                ? `Appended "${set.name}" (${items.length} added, skipped ${skipped} duplicate TC)`
                                : `Appended set "${set.name}" to run list`,
                          });
                        }}
                        className="px-2 py-1 rounded font-semibold bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-40 disabled:pointer-events-none"
                        title="Append this set to run list (without replacing)"
                      >
                        +Append
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (setBusy) return;
                          if (inUse) {
                            addToast({
                              type: 'warning',
                              message: 'Set นี้กำลังถูกใช้รันอยู่ แก้ไขชื่อไม่ได้ กรุณา duplicate แล้วแก้ในชุดใหม่แทน',
                            });
                            return;
                          }
                          setEditingSetId(set.id);
                          setEditingSetName(set.name || '');
                        }}
                        disabled={inUse || setBusy}
                        className={`p-1 rounded text-slate-500 dark:text-slate-300 ${
                          inUse || setBusy ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                        title={
                          setBusy
                            ? 'กำลังลบ/สำเนา/จัดเรียง set — รอสักครู่'
                            : inUse
                              ? 'Set นี้กำลังอยู่ใน process แก้ไขไม่ได้ (ให้ duplicate แล้วแก้ชื่อในชุดใหม่)'
                              : 'Rename set'
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={setBusy}
                        onClick={() => {
                          if (setBusy) return;
                          void duplicateSavedTestCaseSet(set.id);
                        }}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 disabled:opacity-40 disabled:pointer-events-none"
                        title="Clone set"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={setBusy}
                        onClick={async () => {
                          if (setBusy) return;
                          if (!window.confirm(`Delete set "${set.name}"? This will remove it from Saved sets only (test cases and files in Library will stay).`)) return;
                          try {
                            await api.deleteSet(set.id);
                          } catch (e) {
                            if (!String(e?.message || '').includes('404')) addToast({ type: 'warning', message: `Backend: ${e?.message || 'Delete failed'}` });
                          }
                          removeSavedTestCaseSet(set.id);
                          addToast({ type: 'success', message: `Deleted set "${set.name}"` });
                        }}
                        className="p-1 rounded hover:bg-red-600/10 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:pointer-events-none"
                        title="Delete set from Saved (ไม่ลบ test cases หรือไฟล์ใน Library)"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Alternative: Run by Set (whole set) — ติ๊กเลือก set ที่ต้องการรันได้เลย (แต่ละ set = 1 job). Set ที่กำลังรันอยู่จะถูกข้ามอัตโนมัติ. */}
        <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Sets</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-blue-600">Use sets</span>
            <span className="text-xs text-slate-500">{selectedSetIds.length} set(s) selected</span>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900">
            {safeSets.length === 0 ? (
              <div className="p-3 text-center text-slate-400 text-xs">No sets yet — create on Test Cases page (Save Set)</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {safeSets.map((set) => {
                  const status = getRunSetStatusForSet(set); // 'pending' | 'running' | null
                  const disabled = status === 'running'; // Running only; Pending can still be selected
                  return (
                    <li
                      key={set.id}
                      className={`flex items-center gap-2 px-3 py-2 ${
                        disabled
                          ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSetIds.includes(set.id)}
                        onChange={() => !disabled && toggleSet(set.id)}
                        disabled={disabled}
                        className="w-4 h-4 rounded border-slate-400 text-blue-600 shrink-0"
                      />
                      <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                        {set.name}
                      </span>
                      {status === 'running' && (
                        <span className="px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-semibold border border-blue-200 dark:border-blue-700 shrink-0">
                          Running
                        </span>
                      )}
                      {status === 'pending' && (
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px] font-semibold border border-amber-200 dark:border-amber-700 shrink-0">
                          Pending
                        </span>
                      )}
                      <span className="text-xs text-slate-500 shrink-0">
                        {Array.isArray(set.items) ? set.items.length : 0} cases
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 3. Set name, Tag, Board selection — ด้านล่าง หลังการเลือก test case */}
        <div className="mb-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">3. Set name, Tag & Board selection</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Configure after selecting test cases above.</p>
            </div>
            <button
              type="button"
              onClick={clearSection3RunConfig}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-500 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="ล้างชื่อ set, tag, สี, โหมด/รายการบอร์ด และ Prioritize — รีเซ็ตเป็นค่าเริ่มต้น (Auto assign, ไม่เลือกบอร์ด)"
            >
              <RotateCcw size={14} className="text-slate-500 dark:text-slate-400" aria-hidden />
              Clear config
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Set name</label>
              <input
                type="text"
                placeholder="Set name (optional)"
                value={runSetName}
                onChange={(e) => setRunSetName(e.target.value)}
                className="px-3 py-2 border border-slate-300 dark:border-slate-500 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 min-w-[200px]"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Tag (optional)</label>
              <div className="flex flex-wrap items-center gap-2 overflow-visible pl-0 sm:border-l sm:border-slate-200 sm:dark:border-slate-600 sm:pl-3 sm:ml-1">
                <TagColorSwatchPicker
                  size="sm"
                  value={TAG_PALETTE_MAP[runSetTagColor] ? runSetTagColor : 'mint'}
                  menuZClass="z-[120]"
                  onChange={(k) => setRunSetTagColor(k)}
                />
                <input
                  type="text"
                  placeholder="Type tag (optional)"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="flex-1 min-w-[140px] px-3 py-2 border border-slate-300 dark:border-slate-500 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                />
                {tag.trim() ? (
                  <span
                    className={`shrink-0 px-2 py-1 rounded-full text-[11px] font-semibold border ${jobTagPillClasses(runSetTagColor)}`}
                  >
                    {tag.trim()}
                  </span>
                ) : null}
                {setTagHistory.length > 0 && (
                  <div className="w-full flex flex-wrap gap-1 mt-1">
                    {(() => {
                      const q = tag.trim().toLowerCase();
                      const current = tag.trim().toLowerCase();
                      return setTagHistory
                        .filter((t) => {
                          const lt = t.toLowerCase();
                          if (lt === current) return false;
                          if (q && !lt.includes(q)) return false;
                          return true;
                        })
                        .slice(0, 10)
                        .map((t) => (
                          <button
                            key={t}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setTag(t);
                            }}
                            className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title={`Use tag "${t}"`}
                          >
                            {t}
                          </button>
                        ));
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">Board selection</h4>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="boardMode" checked={boardSelectionMode === 'auto'} onChange={() => { setBoardSelectionMode('auto'); setRunBoardSelection({ mode: 'auto', boardIds: [] }); }} className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-slate-700 dark:text-slate-200">Auto assign</span>
                {boardSelectionMode === 'auto' && <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />}
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="boardMode" checked={boardSelectionMode === 'manual'} onChange={() => { setBoardSelectionMode('manual'); setRunBoardSelection({ mode: 'manual', boardIds: selectedBoardIds }); }} className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-slate-700 dark:text-slate-200">Manual select</span>
                {boardSelectionMode === 'manual' && <span className="text-xs text-slate-500">({selectedBoardIds.length} selected)</span>}
              </label>
              <label className="flex items-center gap-2 cursor-pointer ml-2 border-l border-slate-200 dark:border-slate-600 pl-4">
                <input type="checkbox" checked={prioritize} onChange={(e) => setPrioritize(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
                <span className="text-sm text-slate-700 dark:text-slate-200">Prioritize (high priority)</span>
              </label>
            </div>
            {boardSelectionMode === 'auto' && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold uppercase tracking-wide">Preferred boards (optional)</span>
                  <span className="text-[11px] italic">System will still auto assign, but prefer selected boards first.</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {safeBoards.length === 0 ? (
                    boardsEmptyPlaceholder()
                  ) : (
                    safeBoards.map((b) => {
                      const status = (b.status || '').toLowerCase();
                      const isSelected = selectedBoardIds.includes(b.id);
                      const isOnline = status === 'online';
                      const isBusy = status === 'busy';
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            const next = isSelected
                              ? selectedBoardIds.filter((id) => id !== b.id)
                              : [...selectedBoardIds, b.id];
                            setSelectedBoardIds(next);
                            setRunBoardSelection({ mode: 'auto', boardIds: next });
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            isSelected
                              ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded border flex items-center justify-center ${
                            isSelected
                              ? 'bg-blue-600 border-blue-600'
                              : 'border-slate-400 bg-white dark:bg-slate-800'
                          }`}>
                            {isSelected && <span className="w-1.5 h-1.5 rounded-sm bg-white" />}
                          </span>
                          <span>{b.name || b.id}</span>
                          {isOnline && !isBusy && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Online" />
                          )}
                          {isBusy && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Busy" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            {boardSelectionMode === 'manual' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={selectAllBoards} className="text-xs font-bold text-blue-600 hover:text-blue-800">Select all</button>
                <button type="button" onClick={selectAllOnlineBoards} className="text-xs font-bold text-slate-600 hover:text-slate-800">Select all online</button>
                <button type="button" onClick={clearBoards} className="text-xs font-bold text-slate-600 hover:text-slate-800">Clear</button>
                <div className="flex flex-wrap gap-2 mt-1">
                  {safeBoards.length === 0 ? (
                    boardsEmptyPlaceholder()
                  ) : (
                  safeBoards.map((b) => {
                      const status = (b.status || '').toLowerCase();
                      const isOnline = status === 'online';
                      const isBusy = status === 'busy' || (isOnline && !!b.currentJob);
                      return (
                        <label key={b.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${selectedBoardIds.includes(b.id) ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-300'}`}>
                          <input type="checkbox" checked={selectedBoardIds.includes(b.id)} onChange={() => toggleBoard(b.id)} className="w-3.5 h-3.5 rounded border-slate-400 text-blue-600" />
                          <span>{b.name || b.id}</span>
                          {isOnline && !isBusy && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Online" />}
                          {isBusy && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Busy" />}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>


        {/* Run & Save (not run) */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => runSelected({ startImmediately: true, navigateToJobs: true })}
            disabled={isSubmitting || (runPreview.length === 0 && selectedRunnableCaseCount === 0)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            {runPreview.length > 0
              ? `Run (${runPreview.length} case${runPreview.length !== 1 ? 's' : ''})`
              : `Run (${selectedRunnableCaseCount} case${selectedRunnableCaseCount !== 1 ? 's' : ''})`}
          </button>
          <button
            type="button"
            onClick={() => runSelected({ startImmediately: false, navigateToJobs: true })}
            disabled={isSubmitting || (runPreview.length === 0 && selectedRunnableCaseCount === 0)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create job(s) in Pending without starting. You can edit order or remove test cases in Jobs Manager."
          >
            <Clock size={16} />
            Send to Pending
          </button>
          <button
            type="button"
            onClick={saveSelectedNotRun}
            disabled={!canSaveNotRun}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg text-sm font-bold hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              runPreview.length > 0
                ? 'Save “Set for run” as a new set (no run). Appears in SAVED on Test Cases page.'
                : 'Save name / tag changes to the selected set (no run). Or add cases to “Set for run” to save a new set.'
            }
          >
            <Save size={16} />
            Save (not run)
          </button>
          <p className="text-xs text-slate-500">After Run, see Jobs Manager → Running. Saved sets appear in SAVED on Test Cases page.</p>
        </div>
      </div>

      {/* Browse modal (Finder-like picker) */}
      {showBrowseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowBrowseModal(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-[min(1200px,calc(100vw-1.5rem))] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-600">
              <div className="min-w-0 pr-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Select test cases to run</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  Same table layout as <span className="font-semibold text-slate-600 dark:text-slate-300">Library → TC Library</span>
                  . <span className="font-medium text-slate-600 dark:text-slate-400">Vis</span> (click globe/lock): closing it yourself excludes that row from &quot;Select all (visible)&quot; — same as TC Library. Running/pending rows show a blue lock. Use checkboxes or drag to multi-select, then Done.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBrowseModal(false)}
                className="p-1 rounded shrink-0 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 space-y-2">
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <div className="relative flex-1 min-w-[140px]">
                  <select
                    value={runLibraryOwnerFilter === 'mine' ? '__active__' : runLibraryOwnerFilter}
                    onChange={(e) => setRunLibraryOwnerFilter(e.target.value)}
                    className="w-full appearance-none cursor-pointer flex-1 min-w-0 px-2 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    title="Owner filter (same as column on the left)"
                  >
                    <option value="__active__">
                      {resolveOwnerDisplayName(activeProfileId, ownerLabelCtx) || activeProfile?.name || 'My profile'} (this device)
                    </option>
                    <option value="all">All owners</option>
                    {allOwnerProfiles
                      .filter((p) => String(p?.id) !== String(activeProfileId))
                      .map((p) => (
                        <option key={`picker-owner-${p.id}`} value={String(p.id)}>
                          {p.name || p.id}
                        </option>
                      ))}
                    <option value="shared">Shared with me</option>
                  </select>
                  <ChevronDown
                    aria-hidden
                    className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                  />
                </div>
                <input
                  type="text"
                  name="runset-picker-filter-name"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Name, owner, or file…"
                  value={runListNameFilter}
                  onChange={(e) => setRunListNameFilter(e.target.value)}
                  className="flex-1 min-w-[100px] px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
                <div ref={runTagSuggestPickerRef} className="relative z-20 flex-1 min-w-[100px]">
                  <input
                    type="text"
                    name="runset-picker-filter-tag"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Filter by tag"
                    value={runListTagFilter}
                    onChange={(e) => setRunListTagFilter(e.target.value)}
                    onFocus={() => {
                      setRunTagSuggestOpenLibrary(false);
                    }}
                    title="Type to filter by tag — use ▼ for common tags"
                    className="w-full min-w-0 px-2 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    aria-expanded={runTagSuggestOpenPicker}
                    aria-haspopup="listbox"
                    aria-label="Show tag suggestions"
                    className="absolute right-px top-1/2 z-[2] inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    title="Browse tags used in this list"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => {
                      setRunTagSuggestOpenLibrary(false);
                      setRunTagSuggestOpenPicker((v) => !v);
                    }}
                  >
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${runTagSuggestOpenPicker ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>
                  {runTagSuggestOpenPicker && (
                    <div
                      role="listbox"
                      aria-label="Tag suggestions"
                      className="absolute left-0 right-0 top-[calc(100%+4px)] z-[120] max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-xl dark:border-slate-600 dark:bg-slate-900"
                    >
                      <button
                        type="button"
                        role="option"
                        className="w-full px-2 py-1.5 text-left font-medium text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setRunListTagFilter('');
                          setRunTagSuggestOpenPicker(false);
                        }}
                      >
                        Clear tag filter…
                      </button>
                      {runLibraryTagPickerOptions.length === 0 ? (
                        <div className="px-2 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {runLibraryUniqueTags.length === 0
                            ? 'No tags on test cases — type text to filter.'
                            : 'No tag matches — type to narrow.'}
                        </div>
                      ) : (
                        runLibraryTagPickerOptions.slice(0, 80).map((t) => (
                          <button
                            key={`run-pick-tag-opt-${t}`}
                            type="button"
                            role="option"
                            className="w-full truncate px-2 py-1.5 text-left text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setRunListTagFilter(t);
                              setRunTagSuggestOpenPicker(false);
                            }}
                          >
                            {t}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <RunTagColorFilterDropdown
                  value={runLibraryTagColorFilter}
                  onChange={setRunLibraryTagColorFilter}
                  placeholder="All colors"
                  size="xs"
                  className="shrink-0 w-full sm:w-[10.75rem] min-w-[8rem]"
                />
                <div className="relative shrink-0 w-full sm:w-[10.25rem] min-w-[7.5rem]">
                  <select
                    value={runLibraryDateFilter}
                    onChange={(e) => setRunLibraryDateFilter(e.target.value)}
                    className="w-full appearance-none cursor-pointer px-2 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    title="Filter by modified date (Date column)"
                  >
                    <option value="">All dates</option>
                    {runLibraryDatePickOptions.map((ymd) => {
                      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
                      const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : null;
                      const lbl =
                        dt && !Number.isNaN(dt.getTime())
                          ? dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                          : ymd;
                      return (
                        <option key={`run-pick-date-${ymd}`} value={ymd}>
                          {lbl}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown
                    aria-hidden
                    className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={selectAllBrowsed}
                  className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700/60 dark:bg-blue-900/25 dark:text-blue-300 dark:hover:bg-blue-900/40"
                  title="Selects every visible row except those you closed with Vis (amber lock). Running/pending (blue lock) can still be toggled individually."
                >
                  Select all (visible)
                </button>
                <button
                  type="button"
                  onClick={clearAllBrowsed}
                  className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80"
                >
                  Clear
                </button>
                <span className="text-xs text-slate-500">{selectedBrowsedKeys.size} selected</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                  · Hold click and drag down rows to multi-select
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col px-2 pb-2">
              {filteredLibraryRows.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">
                  {browsedRows.length === 0
                    ? runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine'
                      ? 'No test cases — create on Test Cases page or switch to “All owners” to use others’ cases.'
                      : 'No test cases for this owner filter.'
                    : 'No test cases match name / tag / color / date filters'}
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 shadow-inner table-scroll-smooth" style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}>
                  <table className="w-full text-sm min-w-max border-collapse select-none">
                    <caption className="sr-only">
                      TC Library style list. Rows with Vis closed (amber lock) are skipped by Select all (visible). Use the header checkbox or row checkboxes; drag with mouse held to multi-select.
                    </caption>
                    <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-600">
                      <tr className="text-left text-xs font-bold text-slate-600 dark:text-slate-400">
                        <th className="w-9 px-2 py-2 border-r border-slate-200 dark:border-slate-600 sticky left-0 bg-slate-100 dark:bg-slate-800 z-10">
                          <input
                            ref={browsePickerSelectAllRef}
                            type="checkbox"
                            checked={browsePickerAllVisibleSelected}
                            onChange={(e) => {
                              if (e.target.checked) selectAllBrowsed();
                              else clearAllBrowsed();
                            }}
                            className="w-4 h-4 rounded cursor-pointer border-slate-400 text-blue-600"
                            title="Select all visible rows except Vis=closed (amber lock). Clears other picks and selects only those rows."
                          />
                        </th>
                        <th className="w-8 px-2 py-2 border-r border-slate-200 dark:border-slate-600">#</th>
                        <th className="min-w-[120px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Name</th>
                        <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600" title="Owner">
                          Owner
                        </th>
                        <th className="min-w-[120px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Source</th>
                        <th className="w-10 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center" title="Visibility">
                          Vis
                        </th>
                        <th className="min-w-[168px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">Tag</th>
                        <th className="w-24 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Date</th>
                        <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">ERoM</th>
                        <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">ULP</th>
                        <th className="min-w-[100px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">VCD</th>
                        <th className="min-w-[140px] px-2 py-2 border-r border-slate-200 dark:border-slate-600">MDI (text)</th>
                        {runPickerModalExtraCols.map((col) => (
                          <th key={col} className="px-2 py-2 border-r border-slate-200 dark:border-slate-600 min-w-[90px] whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                        <th className="w-14 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Try</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLibraryRows.map((row, idx) => {
                        const tc = row.tc;
                        const isSel = selectedBrowsedKeys.has(row.key);
                        const ownerDisp = resolveOwnerDisplayName(tc._ownerId ?? row.set?._ownerId ?? activeProfileId, ownerLabelCtx);
                        const sourceLabel =
                          row.setId === '__current__' ? 'Current (from table)' : String(row.set?.name || row.setId || '—');
                        const tagRaw = (tc.extraColumns?.tag ?? tc.extraColumns?.Tag ?? '').toString().trim();
                        const dateRaw = tc.updatedAt || tc.createdAt;
                        const visClosed = isTcManuallyClosedForPicker(tc);
                        const systemLocked = isTcSystemLockedForRunPicker(tc);
                        const bulkSelDisabled = visClosed;
                        const stickyBg = isSel
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : bulkSelDisabled
                            ? 'bg-slate-50/90 dark:bg-slate-800/40'
                            : 'bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50';
                        return (
                          <tr
                            key={row.key}
                            className={`group border-b border-slate-100 dark:border-slate-700 ${
                              isSel ? 'bg-blue-50 dark:bg-blue-900/20' : bulkSelDisabled ? 'opacity-80' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            } ${bulkSelDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            onMouseDown={(e) => handleBrowseRowMouseDown(e, row.key, tc)}
                            onMouseEnter={() => handleBrowseRowMouseEnter(row.key, tc)}
                          >
                            <td
                              className={`px-2 py-2 border-r border-slate-100 dark:border-slate-700 sticky left-0 z-[1] ${stickyBg}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isSel}
                                disabled={bulkSelDisabled}
                                onChange={() => {
                                  if (!bulkSelDisabled) toggleBrowsed(row.key);
                                }}
                                className={`w-4 h-4 rounded border-slate-400 text-blue-600 ${
                                  bulkSelDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                                }`}
                                title={
                                  bulkSelDisabled
                                    ? 'Cannot select — Vis is closed (excluded from Select all). Open Vis to include this row.'
                                    : undefined
                                }
                              />
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-500">{idx + 1}</td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200 min-w-[120px] truncate" title={tc.name || ''}>
                              {tc.name || '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[96px]" title={ownerDisp}>
                              {ownerDisp}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[140px]" title={sourceLabel}>
                              {sourceLabel}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateRunPickerTcVisibility(row);
                                }}
                                className={`inline-flex items-center justify-center p-1 rounded ${
                                  systemLocked
                                    ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 cursor-not-allowed'
                                    : visClosed
                                      ? 'text-amber-500 hover:bg-amber-500/10'
                                      : 'text-slate-400 hover:bg-slate-500/10'
                                }`}
                                title={
                                  systemLocked
                                    ? 'Locked — running/pending (not the same as closing Vis yourself)'
                                    : visClosed
                                      ? 'Vis closed — excluded from Select all (visible). Click to open.'
                                      : 'Vis open — click to close and exclude from Select all (visible)'
                                }
                              >
                                {systemLocked ? (
                                  <Lock size={14} className="text-blue-600 dark:text-blue-400" strokeWidth={2.25} />
                                ) : visClosed ? (
                                  <Lock size={14} className="text-amber-500" strokeWidth={2.25} />
                                ) : (
                                  <Globe size={14} />
                                )}
                              </button>
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 min-w-[160px]">
                              {tagRaw ? (
                                <span
                                  className={`inline-block max-w-full truncate px-1.5 py-0.5 rounded text-[10px] font-medium border ${getFirstTagPillClass(tc.extraColumns, tagRaw)}`}
                                >
                                  {tagRaw}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td
                              className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-center text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap"
                              title={dateRaw ? String(dateRaw) : undefined}
                            >
                              {formatRunPickerLibDate(dateRaw)}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title={tc.binName || ''}>
                              {tc.binName || '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[100px]" title={tc.linName || ''}>
                              {tc.linName || '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title={tc.vcdName || ''}>
                              {tc.vcdName || '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[180px]" title={getTcMdiSummaryForPicker(tc)}>
                              {getTcMdiSummaryForPicker(tc)}
                            </td>
                            {runPickerModalExtraCols.map((col) => (
                              <td
                                key={col}
                                className="px-2 py-2 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[120px]"
                                title={String(tc.extraColumns?.[col] ?? '')}
                              >
                                {tc.extraColumns?.[col] != null && String(tc.extraColumns[col]).trim() !== ''
                                  ? String(tc.extraColumns[col])
                                  : '—'}
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center text-slate-500">
                              {typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-600 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const picked = filteredLibraryRows.filter((r) => selectedBrowsedKeys.has(r.key));
                  picked.forEach((row) => addToRunPreview(row));
                  setShowBrowseModal(false);
                  if (picked.length > 0) addToast({ type: 'success', message: `Added ${picked.length} test case(s) to run list` });
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
              >
                Done — add to run list
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 2. SETUP PAGE (Version with File Upload) — ใช้เมื่อ Edit Batch จาก Jobs Manager

export default RunSetPage;
