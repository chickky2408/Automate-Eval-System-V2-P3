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
  GripVertical,
  Layers,
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
import { getFirstTagPillClass, TAG_PALETTE_MAP, jobTagPillClasses, splitTagsComma } from '../utils/tagPalette';
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
  /** __active__ = โปรไฟล์ปัจจุบัน (savedTestCases + sets ในเครื่อง); all / profile id / shared = ใช้ snapshot รวมเหมือน Library */
  const [runLibraryOwnerFilter, setRunLibraryOwnerFilter] = useState('__active__');
  const [tcClipboard, setTcClipboard] = useState([]);
  const [selectedLeftKey, setSelectedLeftKey] = useState(null);
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

  const handleBrowseRowMouseDown = useCallback((e, rowKey) => {
    if (e.button !== 0) return;
    if (e.target.closest('input, button, a, textarea, select, label')) return;
    e.preventDefault();
    browseDragSelectingRef.current = true;
    setSelectedBrowsedKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });
  }, []);

  const handleBrowseRowMouseEnter = useCallback((rowKey) => {
    if (!browseDragSelectingRef.current) return;
    setSelectedBrowsedKeys((prev) => {
      if (prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });
  }, []);

  const nameFilter = (runListNameFilter || '').trim().toLowerCase();
  const tagFilter = (runListTagFilter || '').trim().toLowerCase();
  const filteredLibraryRows = useMemo(() => {
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
      return true;
    });
  }, [browsedRows, nameFilter, tagFilter, activeProfileId, ownerLabelCtx]);

  const selectAllBrowsed = () => setSelectedBrowsedKeys(new Set(filteredLibraryRows.map((r) => r.key)));

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
        } else if (selectedLeftKey) {
          const row = filteredLibraryRows.find((r) => r.key === selectedLeftKey);
          if (row) {
            setTcClipboard([{ row }]);
            addToast({ type: 'info', message: 'Copied test case' });
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
  }, [selectedRunIndex, selectedLeftKey, runPreview, filteredLibraryRows, tcClipboard, addToast]);

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
        if (startImmediately) {
          setRunPreview([]);
          setRunSetName('');
          setTag('');
          setRunSetTagColor('mint');
          setSelectedBoardIds([]);
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
  }, [
    runPreview.length,
    saveCurrentRunSet,
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
              <select
                value={runLibraryOwnerFilter === 'mine' ? '__active__' : runLibraryOwnerFilter}
                onChange={(e) => setRunLibraryOwnerFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
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
                <input
                  type="text"
                  name="runset-lib-filter-tag"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Filter by tag"
                  value={runListTagFilter}
                  onChange={(e) => setRunListTagFilter(e.target.value)}
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>
              {runLibraryOwnerFilter !== '__active__' && runLibraryOwnerFilter !== 'mine' && !globalTestCaseDataLoaded ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Loading merged library from server…</p>
              ) : null}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-inner scroll-smooth" style={{ scrollBehavior: 'smooth' }}>
              {filteredLibraryRows.length === 0 ? (
                <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">
                  {browsedRows.length === 0
                    ? runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine'
                      ? 'No test cases yet — create on Test Cases page or choose “All owners” to pick others’ cases.'
                      : 'No test cases for this owner filter — try “All owners” or check the server connection.'
                    : 'No test cases match name/tag filters'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-600">
                  {filteredLibraryRows.map((row) => {
                    const tagVal = row.tc.extraColumns?.tag ?? '';
                    const isSelected = selectedLeftKey === row.key;
                    const isFromCurrent = row.setId === '__current__';
                    const ownerHint =
                      runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine'
                        ? ''
                        : resolveOwnerDisplayName(row.tc._ownerId ?? row.set?._ownerId ?? activeProfileId, ownerLabelCtx);
                    return (
                      <li
                        key={row.key}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify({ type: 'library', row }));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => setSelectedLeftKey(row.key)}
                        className={`flex items-center gap-3 px-3 min-h-[56px] cursor-grab active:cursor-grabbing hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 ring-inset ring-1 ring-blue-300 dark:ring-blue-600' : ''}`}
                      >
                        <GripVertical size={16} className="text-slate-400 shrink-0 flex-shrink-0" />
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
            <p className="text-xs text-slate-500 mt-2 shrink-0">Drag to the right, or Copy (⌘/Ctrl+C) and Paste (⌘/Ctrl+V). <button type="button" onClick={() => setShowBrowseModal(true)} className="text-blue-600 hover:underline">Open picker</button></p>
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
                if (data.type === 'library' && data.row) {
                  const dropEl = e.target.closest('[data-drop-index]');
                  const atIndex = dropEl ? parseInt(dropEl.getAttribute('data-drop-index'), 10) : null;
                  if (!Number.isNaN(atIndex) && atIndex >= 0) addToRunPreview(data.row, atIndex);
                  else addToRunPreview(data.row);
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
                          const items = (set.items || []).map((tc, idx) => ({
                            key: `${set.id}-${idx}-${tc.id || tc.name || tc.vcdName || ''}`,
                            setId: set.id,
                            set,
                            tc,
                            order: idx + 1,
                          }));
                          setRunPreview(items);
                          setRunSetName(set.name || '');
                          addToast({ type: 'success', message: `Loaded set "${set.name}" for run` });
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
                          const start = runPreview.length;
                          const items = (set.items || []).map((tc, idx) => ({
                            key: `${set.id}-${idx}-${Date.now()}-${tc.id || tc.name || tc.vcdName || ''}`,
                            setId: set.id,
                            set,
                            tc,
                            order: start + idx + 1,
                          }));
                          setRunPreview((prev) => prev.concat(items).map((it, i) => ({ ...it, order: i + 1 })));
                          setRunSetName((prev) => (prev ? `${prev}, ${set.name || ''}` : (set.name || '')));
                          addToast({ type: 'success', message: `Appended set "${set.name}" to run list` });
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
                          duplicateSavedTestCaseSet(set.id);
                          addToast({ type: 'success', message: `Duplicated set "${set.name}"` });
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
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-600">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Select test cases to run</h3>
              <button type="button" onClick={() => setShowBrowseModal(false)} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300">
                <X size={20} />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 space-y-2">
              <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                <select
                  value={runLibraryOwnerFilter === 'mine' ? '__active__' : runLibraryOwnerFilter}
                  onChange={(e) => setRunLibraryOwnerFilter(e.target.value)}
                  className="flex-1 min-w-[140px] px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
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
                <input
                  type="text"
                  name="runset-picker-filter-tag"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Filter by tag"
                  value={runListTagFilter}
                  onChange={(e) => setRunListTagFilter(e.target.value)}
                  className="flex-1 min-w-[100px] px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" onClick={selectAllBrowsed} className="text-xs font-bold text-blue-600 hover:text-blue-800 dark:text-blue-400">
                  Select all (visible)
                </button>
                <button type="button" onClick={clearAllBrowsed} className="text-xs font-bold text-slate-600 hover:text-slate-800 dark:text-slate-300">
                  Clear
                </button>
                <span className="text-xs text-slate-500">{selectedBrowsedKeys.size} selected</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                  · Hold click and drag down rows to multi-select
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {filteredLibraryRows.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">
                  {browsedRows.length === 0
                    ? runLibraryOwnerFilter === '__active__' || runLibraryOwnerFilter === 'mine'
                      ? 'No test cases — create on Test Cases page or switch to “All owners” to use others’ cases.'
                      : 'No test cases for this owner filter.'
                    : 'No test cases match name/tag filters'}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <caption className="sr-only">
                    Test cases. Use checkboxes, drag across rows with the mouse button held, or Select all.
                  </caption>
                  <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0">
                    <tr className="text-left font-bold text-slate-600 dark:text-slate-400">
                      <th className="w-8 px-2 py-1.5 border-r border-slate-200 dark:border-slate-600"></th>
                      <th className="w-8 px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">#</th>
                      <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">Owner</th>
                      <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">Source</th>
                      <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">Name</th>
                      <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">ERoM</th>
                      <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">ULP</th>
                      <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600">VCD</th>
                      {[...new Set(filteredLibraryRows.flatMap((row) => Object.keys(row.tc.extraColumns || {})))].sort().map((col) => (
                        <th key={col} className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-600 min-w-[80px]">{col}</th>
                      ))}
                      <th className="w-10 px-2 py-1.5 text-center">Try</th>
                    </tr>
                  </thead>
                  <tbody className="select-none">
                    {filteredLibraryRows.map((row, idx) => {
                      const extraCols = [...new Set(filteredLibraryRows.flatMap((r) => Object.keys(r.tc.extraColumns || {})))].sort();
                      return (
                      <tr
                        key={row.key}
                        className={`border-b border-slate-100 dark:border-slate-700 ${selectedBrowsedKeys.has(row.key) ? 'bg-blue-50 dark:bg-blue-900/20' : ''} hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer`}
                        onMouseDown={(e) => handleBrowseRowMouseDown(e, row.key)}
                        onMouseEnter={() => handleBrowseRowMouseEnter(row.key)}
                      >
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedBrowsedKeys.has(row.key)} onChange={() => toggleBrowsed(row.key)} className="w-3.5 h-3.5 rounded border-slate-400 text-blue-600" />
                        </td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-500">{idx + 1}</td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[72px]" title={resolveOwnerDisplayName(row.tc._ownerId ?? row.set?._ownerId ?? activeProfileId, ownerLabelCtx)}>
                          {resolveOwnerDisplayName(row.tc._ownerId ?? row.set?._ownerId ?? activeProfileId, ownerLabelCtx)}
                        </td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title={row.set.name}>{row.set.name || row.setId}</td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{row.tc.name || '—'}</td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[100px]">{row.tc.binName || '—'}</td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[80px]">{row.tc.linName || '—'}</td>
                        <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[100px]">{row.tc.vcdName || '—'}</td>
                        {extraCols.map((col) => (
                          <td key={col} className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[100px]">{row.tc.extraColumns?.[col] ?? '—'}</td>
                        ))}
                        <td className="px-2 py-1.5 text-center text-slate-500">{typeof row.tc.tryCount === 'number' && row.tc.tryCount > 0 ? row.tc.tryCount : 1}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
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
