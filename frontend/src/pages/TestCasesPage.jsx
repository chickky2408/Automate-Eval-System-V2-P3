import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowUp, ArrowDown, ArrowUpFromLine, ArrowDownFromLine, ChevronDown, Copy, FileUp, FolderOpen, Globe, GripVertical, Lock, Plus, Save, Trash2, X, Play
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import api from '../services/api';
import { computeFileSignature } from '../utils/fileSignature';
import { getClientId } from '../utils/sessionStorage';
import { resolveFileOwnerDisplay } from '../utils/profileOwnerLabel';
import UploadChoiceModal from '../components/UploadChoiceModal';
import {
  TAG_PALETTE_MAP,
  normalizeTagColorList,
  getFirstTagPillClass,
  syncTagColorListAfterTagChange,
  isExtraColumnHiddenFromLibraryTable,
  jobTagPillClasses,
} from '../utils/tagPalette';
import TagColorSwatchPicker from '../components/TagColorSwatchPicker';
import { isTestCasePrimaryFileSetComplete } from '../utils/testCasePrimaryFiles';

/** จัดกลุ่มไฟล์เช่น TC0008.vcd + TC0008_erom_1.erom → คีย์ TC0008 */
function extractTcGroupKeyFromFileName(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  const m = base.match(/(TC\d+)/i);
  if (m) return m[1].toUpperCase();
  const parts = base.split('_');
  if (parts[0] && /^TC\d+/i.test(parts[0])) return parts[0].toUpperCase();
  return base;
}

const pushLibraryPickerSuggestOpt = (out, seen, raw) => {
  const x = String(raw ?? '').trim();
  if (!x) return;
  const k = x.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  out.push(x);
};

const splitTags = (raw) =>
  String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

// Remember which tags *we* added (per active profile + per entity),
// then show those tags first for this profile (personalized view).
const MY_TAG_ORDER_KEY = 'app_my_tag_order_v1';
const loadMyTagOrderMap = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(MY_TAG_ORDER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const saveMyTagOrderMap = (map) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MY_TAG_ORDER_KEY, JSON.stringify(map || {}));
  } catch {
    // ignore
  }
};

const recordMyAddedTagsForEntity = (profileId, entityKey, addedTags) => {
  const pid = String(profileId || 'default');
  const ek = String(entityKey || '');
  if (!ek || !Array.isArray(addedTags) || addedTags.length === 0) return;

  const map = loadMyTagOrderMap();
  const profileMap = (map[pid] && typeof map[pid] === 'object' ? map[pid] : {});
  const existing = Array.isArray(profileMap[ek]) ? profileMap[ek] : [];
  const existingSet = new Set(existing.map((t) => String(t).toLowerCase()));

  let changed = false;
  for (const t of addedTags) {
    const lt = String(t || '').trim().toLowerCase();
    if (!lt) continue;
    if (existingSet.has(lt)) continue;
    existingSet.add(lt);
    existing.push(lt);
    changed = true;
  }

  if (!changed) return;
  profileMap[ek] = existing;
  map[pid] = profileMap;
  saveMyTagOrderMap(map);
};


const reorderTagsForDisplay = (profileId, entityKey, tags, colorList) => {
  const pid = String(profileId || 'default');
  const ek = String(entityKey || '');
  if (!ek || !Array.isArray(tags) || tags.length === 0) {
    return { orderedTags: tags || [], orderedColorList: colorList || [] };
  }

  const map = loadMyTagOrderMap();
  const savedList = map?.[pid]?.[ek];
  const myList = Array.isArray(savedList) ? savedList : [];
  if (myList.length === 0) {
    return { orderedTags: tags, orderedColorList: colorList || [] };
  }

  const mySet = new Set(myList.map((t) => String(t).toLowerCase()));
  const indexed = tags.map((t, i) => ({ t, i, lt: String(t).toLowerCase() }));
  const inMy = indexed.filter((x) => mySet.has(x.lt));
  if (inMy.length === 0) {
    return { orderedTags: tags, orderedColorList: colorList || [] };
  }
  const notMy = indexed.filter((x) => !mySet.has(x.lt));
  // Personalized view: show tags I added first (others keep default order).
  const ordered = [...inMy, ...notMy];

  return {
    orderedTags: ordered.map((x) => x.t),
    orderedColorList: Array.isArray(colorList)
      ? ordered.map((x) => colorList[x.i])
      : [],
  };
};

const upsertTagsString = (currentRaw, addRaw) => {
  const current = splitTags(currentRaw);
  const toAdd = splitTags(addRaw);
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const next = [...current];
  toAdd.forEach((t) => {
    const k = t.toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    next.push(t);
  });
  return next.join(', ');
};

const removeOneTagFromString = (currentRaw, tagToRemove) => {
  const target = String(tagToRemove || '').trim().toLowerCase();
  if (!target) return String(currentRaw || '');
  const next = splitTags(currentRaw).filter((t) => t.trim().toLowerCase() !== target);
  return next.join(', ');
};

const replaceTagAtIndexInRaw = (raw, index, newTag) => {
  const tags = splitTags(raw);
  if (index < 0 || index >= tags.length) return String(raw || '');
  const next = [...tags];
  const tr = String(newTag ?? '').trim();
  if (tr === '') next.splice(index, 1);
  else next[index] = tr;
  return next.join(', ');
};

const removeTagAtIndexFromRaw = (raw, index) => {
  const tags = splitTags(raw);
  if (index < 0 || index >= tags.length) return String(raw || '');
  return tags.filter((_, j) => j !== index).join(', ');
};

/** Enter ระหว่าง IME — ไม่ commit tag */
const tagEnterShouldIgnoreIme = (e) =>
  e.key === 'Enter' && (e.nativeEvent?.isComposing === true || e.keyCode === 229);

const normalizeFileSizeBytes = (value) => {
  if (typeof value === 'number') return value;
  if (value == null) return 0;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const getSetNamesUsingFile = (fileName, savedTestCaseSets) => {
  if (!fileName || !savedTestCaseSets?.length) return [];
  const names = [];
  for (const set of savedTestCaseSets) {
    const hasInSnapshot = set.fileLibrarySnapshot?.some((s) => s.name === fileName);
    const hasInItems = (set.items || []).some(
      (t) => t.vcdName === fileName || t.binName === fileName || t.linName === fileName
    );
    if (hasInSnapshot || hasInItems) names.push(set.name || set.id);
  }
  return names;
};

/** Same logic as File Library — TC names that reference this file */
const getTestCasesUsingFile = (fileName, savedTestCases, savedTestCaseSets) => {
  if (!fileName) return [];
  const out = [];
  const isUsedInTc = (tc) => {
    if (tc.vcdName === fileName || tc.binName === fileName || tc.linName === fileName) return true;
    const cmds = Array.isArray(tc.commands) ? tc.commands : [];
    if (cmds.some((c) => c && c.file === fileName)) return true;
    const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
    return Object.values(extra).some((v) => v === fileName);
  };
  (savedTestCases || []).forEach((tc) => {
    if (isUsedInTc(tc)) {
      out.push({ name: (tc.name || tc.vcdName || '').trim() || '—', set: 'Current (from table)' });
    }
  });
  (savedTestCaseSets || []).forEach((set) => {
    (set.items || []).forEach((tc) => {
      if (isUsedInTc(tc)) {
        out.push({ name: (tc.name || tc.vcdName || '').trim() || '—', set: set.name || set.id });
      }
    });
  });
  return out;
};

const TestCasesPage = ({ onNavigateBackToLibrary, onNavigateToRunSet } = {}) => {
  const viewingSharedProfileId = useTestStore((s) => s.viewingSharedProfileId);
  const sharedProfileDataCache = useTestStore((s) => s.sharedProfileDataCache);
  const sharedProfiles = useTestStore((s) => s.sharedProfiles || []);
  const setViewingSharedProfile = useTestStore((s) => s.setViewingSharedProfile);
  const copySharedToMyProfile = useTestStore((s) => s.copySharedToMyProfile);
  const fetchSharedProfileData = useTestStore((s) => s.fetchSharedProfileData);
  const {
    uploadedFiles,
    savedTestCases,
    savedTestCaseSets,
    workingTestCases,
    addWorkingTestCase,
    updateWorkingTestCase,
    removeWorkingTestCase,
    moveWorkingTestCaseUp,
    moveWorkingTestCaseDown,
    reorderWorkingTestCases,
    duplicateWorkingTestCase,
    setWorkingTestCases,
    bulkUpdateWorkingTryCount,
    addWorkingTestCaseCommand,
    updateWorkingTestCaseCommand,
    removeWorkingTestCaseCommand,
    saveWorkingToLibrary,
    addSavedTestCase,
    ensureUniqueTestCaseName,
    updateSavedTestCase,
    removeSavedTestCase,
    setSavedTestCases,
    reorderSavedTestCases,
    moveSavedTestCaseUp,
    moveSavedTestCaseDown,
    duplicateSavedTestCase,
    bulkUpdateTryCount,
    addTestCaseCommand,
    updateTestCaseCommand,
    removeTestCaseCommand,
    addSavedTestCaseSet,
    updateSavedTestCaseSet,
    removeSavedTestCaseSet,
    duplicateSavedTestCaseSet,
    applySavedTestCaseSet,
    loadSetForEditing,
    restoreSavedTestCasesFromProfile,
    setLoadedSetId,
    appendSavedTestCaseSet,
    moveSavedTestCaseSetUp,
    moveSavedTestCaseSetDown,
    addUploadedFile,
    removeUploadedFile,
  } = useTestStore();
  const addToast = useTestStore((s) => s.addToast);
  const refreshFiles = useTestStore((s) => s.refreshFiles);
  const setRunSetImportContext = useTestStore((s) => s.setRunSetImportContext);
  const activeProfileId = useTestStore((s) => s.activeProfileId);
  const profiles = useTestStore((s) => s.profiles) || [];
  const serverProfileDirectory = useTestStore((s) => s.serverProfileDirectory) || [];
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
  const globalSavedTestCases = useTestStore((s) => s.globalSavedTestCases) || [];
  const globalSavedTestCaseSets = useTestStore((s) => s.globalSavedTestCaseSets) || [];
  const globalTestCaseDataLoaded = useTestStore((s) => s.globalTestCaseDataLoaded);
  const fileReferenceTestCases = useMemo(
    () => (globalTestCaseDataLoaded ? globalSavedTestCases : savedTestCases) || [],
    [globalTestCaseDataLoaded, globalSavedTestCases, savedTestCases]
  );
  const fileReferenceTestCaseSets = useMemo(
    () => (globalTestCaseDataLoaded ? globalSavedTestCaseSets : savedTestCaseSets) || [],
    [globalTestCaseDataLoaded, globalSavedTestCaseSets, savedTestCaseSets]
  );
  const libraryEditContext = useTestStore((s) => s.libraryEditContext);
  const clearLibraryEditContext = useTestStore((s) => s.clearLibraryEditContext);
  const testCaseLibraryFocusOnNavigate = useTestStore((s) => s.testCaseLibraryFocusOnNavigate);
  const setTestCaseLibraryFocusOnNavigate = useTestStore((s) => s.setTestCaseLibraryFocusOnNavigate);
  const clearTestCaseLibraryFocusOnNavigate = useTestStore((s) => s.clearTestCaseLibraryFocusOnNavigate);
  const fileToTestCaseDraft = useTestStore((s) => s.fileToTestCaseDraft);
  const clearFileToTestCaseDraft = useTestStore((s) => s.clearFileToTestCaseDraft);
  const fileTags = useTestStore((s) => s.fileTags);
  const fileTagColors = useTestStore((s) => s.fileTagColors);
  const fileDisplayNames = useTestStore((s) => s.fileDisplayNames);
  const fileVisById = useTestStore((s) => s.fileVisById);
  const setFileVisById = useTestStore((s) => s.setFileVisById);
  const testCasePendingById = useTestStore((s) => s.testCasePendingById);
  const jobs = useTestStore((s) => s.jobs);
  const currentClientId = useMemo(() => getClientId(), []);
  const fileNamesInUseByBatch = useMemo(() => {
    const names = new Set();
    (jobs || []).filter((j) => j.status === 'pending' || j.status === 'running').forEach((job) => {
      (job.files || []).forEach((f) => {
        if (f.vcd) names.add(f.vcd);
        if (f.erom) names.add(f.erom);
        if (f.ulp) names.add(f.ulp);
      });
    });
    return names;
  }, [jobs]);

  /** เฉพาะ test case ที่ชุดไฟล์ครบและตรงกับ job ที่กำลัง running/pending ถึงจะถือว่า "in use" (ล็อกได้) */
  const testCaseFileKeysInUseByBatch = useMemo(() => {
    const keys = new Set();
    (jobs || []).filter((j) => j.status === 'pending' || j.status === 'running').forEach((job) => {
      (job.files || []).forEach((f) => {
        const v = (f.vcd || f.vcdName || '').trim();
        const b = (f.erom || f.binName || '').trim();
        const l = (f.ulp || f.linName || '').trim();
        keys.add(`${v}||${b}||${l}`);
      });
    });
    return keys;
  }, [jobs]);

  // Helper: get job status for a set name in Jobs (used only on Run Set page)
  const getSetJobStatusForRunSet = useCallback(
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
          // running > pending
          if (state === 'running') status = 'running';
          else if (!status) status = 'pending';
        }
      });
      return status;
    },
    [jobs]
  );

  const isSetInUseByJobs = useCallback(
    (set) => !!getSetJobStatusForRunSet(set),
    [getSetJobStatusForRunSet]
  );

  // For file browse modal: map set name -> job status (running / pending / completed)
  const STATUS_PRIORITY = { completed: 1, pending: 2, running: 3 };
  const normalizeJobStatusForLibrary = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'running' || s === 'pending') return s;
    if (s === 'completed') return 'completed';
    return null;
  };
  const setStatusByName = useMemo(() => {
    const map = new Map();
    (jobs || []).forEach((job) => {
      const status = normalizeJobStatusForLibrary(job.status);
      if (!status) return;
      const setName = (job.configName || job.name || '').trim();
      if (!setName) return;
      const current = map.get(setName);
      if (!current || STATUS_PRIORITY[status] > STATUS_PRIORITY[current]) {
        map.set(setName, status);
      }
    });
    return map;
  }, [jobs]);

  const getSetJobStatusPillClass = (status) => {
    if (status === 'running') {
      return 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/35 dark:text-blue-200 dark:border-blue-600';
    }
    if (status === 'pending') {
      return 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700';
    }
    if (status === 'completed') {
      return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-700';
    }
    return 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-600';
  };
  const csvInputRef = useRef(null);
  const prevUploadedCountRef = useRef(0);
  const justDidStartFreshRef = useRef(false);
  const loadedSetId = useTestStore((s) => s.loadedSetId);
  const loadedSetTable = useTestStore((s) => s.loadedSetTable);
  const [pendingDraftTestCases, setPendingDraftTestCases] = useState([]);
  const [tableClearedMode, setTableClearedMode] = useState(false);

  // Tag history for test cases only (ไม่ปนกับ tag ของไฟล์หรือ Set)
  const tcTagHistory = useMemo(() => {
    const acc = [];
    const pushFrom = (list) => {
      (list || []).forEach((tc) => {
        const raw =
          tc?.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag);
        if (!raw) return;
        splitTags(raw).forEach((t) => acc.push(t));
      });
    };
    pushFrom(savedTestCases);
    pushFrom(globalSavedTestCases);
    pushFrom(pendingDraftTestCases);
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
  }, [savedTestCases, globalSavedTestCases, pendingDraftTestCases]);

  const SETUP_CLEARED_KEY = 'app_setup_cleared_';
  const getSetupClearedPersisted = (profileId) => typeof window !== 'undefined' && localStorage.getItem(SETUP_CLEARED_KEY + (profileId || 'default')) === 'true';
  const setSetupClearedPersisted = (profileId, value) => { if (typeof window !== 'undefined') localStorage.setItem(SETUP_CLEARED_KEY + (profileId || 'default'), value ? 'true' : 'false'); };
  useEffect(() => {
    if (getSetupClearedPersisted(activeProfileId)) {
      setTableClearedMode(true);
      setSelectedIds([]);
      setLocalDroppedFiles([]);
    }
  }, [activeProfileId]);

  /** Create mode (no set loaded): table shows only in-session drafts — not the full library list. */
  const displayedSavedTestCases = (() => {
    if (viewingSharedProfileId && sharedProfileDataCache[viewingSharedProfileId]) {
      return sharedProfileDataCache[viewingSharedProfileId].savedTestCases ?? [];
    }
    if (loadedSetId) {
      return loadedSetTable || [];
    }
    if (tableClearedMode && (pendingDraftTestCases?.length || 0) === 0) {
      return [];
    }
    return [...(pendingDraftTestCases || [])];
  })();

  /** Vertical tab: one horizontal row (scroll), newest / most recently updated on the left. Indices = order in `displayedSavedTestCases` for drag/drop. */
  const stepViewOrderedCases = useMemo(() => {
    const list = displayedSavedTestCases || [];
    const rowTime = (tc) => {
      const t = new Date(tc.updatedAt || tc.createdAt || 0).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    return [...list]
      .map((tc, originalIndex) => ({ tc, originalIndex }))
      .sort((a, b) => {
        const tb = rowTime(b.tc);
        const ta = rowTime(a.tc);
        if (tb !== ta) return tb - ta;
        return b.originalIndex - a.originalIndex;
      });
  }, [displayedSavedTestCases]);

  const displayedSavedTestCaseSets = viewingSharedProfileId && sharedProfileDataCache[viewingSharedProfileId]
    ? (sharedProfileDataCache[viewingSharedProfileId].savedTestCaseSets ?? [])
    : savedTestCaseSets;
  const isViewingShared = Boolean(viewingSharedProfileId);
  const viewingSharedName = isViewingShared ? (sharedProfiles.find((p) => p.id === viewingSharedProfileId)?.name || viewingSharedProfileId) : '';

  useEffect(() => {
    if (viewingSharedProfileId && !sharedProfileDataCache[viewingSharedProfileId]) {
      fetchSharedProfileData(viewingSharedProfileId);
    }
  }, [viewingSharedProfileId, sharedProfileDataCache, fetchSharedProfileData]);

  // When navigating from Library "edit this test case" → load set and focus row
  useEffect(() => {
    if (!libraryEditContext) return;
    const { loadSetId, focusTcIndex, focusTcId } = libraryEditContext;
    if (loadSetId) {
      setSetupClearedPersisted(activeProfileId, false);
      setTableClearedMode(false);
      loadSetForEditing(loadSetId);
      setPendingDraftTestCases([]);
    } else {
      // Coming from Raw Test Cases with focusTcId (edit single test case): ensure table is not in "cleared" state so savedTestCases show
      setSetupClearedPersisted(activeProfileId, false);
      setTableClearedMode(false);
    }
    const applyFocus = () => {
      const state = useTestStore.getState();
      const list = loadSetId ? (state.loadedSetTable || []) : (state.savedTestCases || []);
      if (focusTcIndex != null && list[focusTcIndex]) {
        setSelectedTestCaseIds([list[focusTcIndex].id]);
      } else if (focusTcId && list.some((t) => t.id === focusTcId)) {
        setSelectedTestCaseIds([focusTcId]);
      }
      clearLibraryEditContext();
    };
    if (loadSetId) {
      setTimeout(applyFocus, 0);
    } else {
      applyFocus();
    }
  }, [libraryEditContext, loadSetForEditing, clearLibraryEditContext, activeProfileId]);

  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState([]);
  const [duplicateHighlightIds, setDuplicateHighlightIds] = useState([]);
  const [bulkTryCount, setBulkTryCount] = useState('');
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryPickerNameQ, setLibraryPickerNameQ] = useState('');
  const [libraryPickerTagQ, setLibraryPickerTagQ] = useState('');
  const [libraryPickerSizeQ, setLibraryPickerSizeQ] = useState('');
  const [libraryPickerOwnerQ, setLibraryPickerOwnerQ] = useState('');
  const [libraryPickerDateQ, setLibraryPickerDateQ] = useState('');
  /** From Library modal — filter suggestion popover (same chevron UX as File in Library). */
  const [libraryPickerSuggest, setLibraryPickerSuggest] = useState(null); // { field: 'name'|'tag'|..., rect: DOMRect }
  const [libraryPickerSelectedIds, setLibraryPickerSelectedIds] = useState([]);
  /** Browse modal: show all tags for a file (ellipsis) */
  const [libraryPickerTagOverflowFileId, setLibraryPickerTagOverflowFileId] = useState(null);
  /** Browse modal: show all TC names that use this file (ellipsis) */
  const [libraryPickerTcOverflowFileName, setLibraryPickerTcOverflowFileName] = useState(null);
  /** Browse modal: show all sets that use this file (ellipsis) */
  const [libraryPickerSetsOverflowFileName, setLibraryPickerSetsOverflowFileName] = useState(null);
  /** Test case table: show all tags (ellipsis) + edit in modal */
  const [tcTagOverflowTcId, setTcTagOverflowTcId] = useState(null);
  const [tcTagModalAddDraft, setTcTagModalAddDraft] = useState('');
  const [tcTagModalEditIndex, setTcTagModalEditIndex] = useState(null);
  const [tcTagModalEditDraft, setTcTagModalEditDraft] = useState('');
  /** Inline “+” to add a tag (same idea as File Library) */
  const [tcTagPlusInputTcId, setTcTagPlusInputTcId] = useState(null);
  /** Toolbar Insert (Excel-style insert row above/below) — mirrors File Library behavior */
  const [insertRowMenuOpen, setInsertRowMenuOpen] = useState(false);
  const [tcTagPlusInputDraft, setTcTagPlusInputDraft] = useState('');
  const libraryPickerDragSelectRef = useRef(false);
  const [draggingRowIndex, setDraggingRowIndex] = useState(null);
  const [dropTargetRowIndex, setDropTargetRowIndex] = useState(null);
  const draggingRowIndexRef = useRef(null);

  useEffect(() => {
    const onMouseUp = () => {
      libraryPickerDragSelectRef.current = false;
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    if (!libraryPickerOpen) libraryPickerDragSelectRef.current = false;
  }, [libraryPickerOpen]);

  useEffect(() => {
    if (tcTagOverflowTcId === null) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setTcTagOverflowTcId(null);
      setTcTagModalAddDraft('');
      setTcTagModalEditIndex(null);
      setTcTagModalEditDraft('');
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [tcTagOverflowTcId]);

  // When navigating from Jobs (click test case name): auto-select the matching row so user sees which one was pointed to
  useEffect(() => {
    if (!testCaseLibraryFocusOnNavigate) return;
    const focus = testCaseLibraryFocusOnNavigate;
    const list = displayedSavedTestCases;
    const match = list.find((tc) => {
      const nameMatch = focus.name && (tc.name || '').trim() === (focus.name || '').trim();
      const vcdMatch = (focus.vcdName || '').trim() && (tc.vcdName || '').trim() === (focus.vcdName || '').trim();
      const binMatch = focus.binName == null || (tc.binName || '').trim() === (focus.binName || '').trim();
      const linMatch = focus.linName == null || (tc.linName || '').trim() === (focus.linName || '').trim();
      return nameMatch || (vcdMatch && binMatch && linMatch);
    });
    if (match) setSelectedTestCaseIds([match.id]);
    clearTestCaseLibraryFocusOnNavigate();
  }, [testCaseLibraryFocusOnNavigate, displayedSavedTestCases, clearTestCaseLibraryFocusOnNavigate]);

  // All test case names in Library: every profile + sets + drafts (for TC##### auto-number)
  const getAllLibraryNames = () => {
    const global = useTestStore.getState().getAllGlobalTestCaseNames(null, {
      extraTestCaseLists: [pendingDraftTestCases],
    });
    return [...global];
  };

  const getNextTestCaseName = () => {
    const combined = getAllLibraryNames();
    const nums = combined.map((name) => {
      const m = (name || '').match(/^TC(\d+)$/i);
      return m ? parseInt(m[1], 10) : 0;
    });
    const max = Math.max(0, ...nums);
    return 'TC' + String(max + 1).padStart(5, '0');
  };

  const isDraftId = (id) =>
    (pendingDraftTestCases || []).some((t) => String(t.id) === String(id));
  /** Saved TC row: delete/duplicate/reorder in progress (not used for inline field edits). */
  const isTcStorePending = (tcId) =>
    tcId != null &&
    tcId !== '' &&
    !isDraftId(tcId) &&
    !!(testCasePendingById && testCasePendingById[String(tcId)]);
  useEffect(() => {
    if (!duplicateHighlightIds.length) return;
    const timer = setTimeout(() => setDuplicateHighlightIds([]), 1600);
    return () => clearTimeout(timer);
  }, [duplicateHighlightIds]);
  const updateDisplayedTestCase = (id, updates) => {
    if (isDraftId(id)) {
      setPendingDraftTestCases((prev) =>
        prev.map((t) => (String(t.id) === String(id) ? { ...t, ...updates } : t))
      );
    } else {
      updateSavedTestCase(id, updates);
    }
  };
  const removeDisplayedTestCase = (id, rowIndex) => {
    if (isViewingShared) return;
    const idStr = id == null ? '' : String(id);

    // Editing a loaded set: visible rows are from loadedSetTable. Never remove only from pending
    // when the same id also exists in loadedSetTable — or the row stays on screen.
    if (loadedSetId) {
      const loadedTable = useTestStore.getState().loadedSetTable || [];
      const inLoaded = loadedTable.some((t) => String(t.id) === idStr);
      if (inLoaded) {
        removeSavedTestCase(id);
      }
      setPendingDraftTestCases((prev) => prev.filter((t) => String(t.id) !== idStr));
      return;
    }
    // Create mode: table lists only pendingDraftTestCases — always drop from pending; fallback by row index if id missing / mismatch
    setPendingDraftTestCases((prev) => {
      const hasId = idStr !== '';
      if (hasId) {
        const next = prev.filter((t) => String(t.id) !== idStr);
        if (next.length < prev.length) return next;
      }
      if (typeof rowIndex === 'number' && rowIndex >= 0 && rowIndex < prev.length) {
        return prev.filter((_, i) => i !== rowIndex);
      }
      return prev;
    });
  };
  const addDisplayedTestCaseCommand = (tcId, cmd) => {
    const type = cmd?.type;
    const file = cmd?.file ?? '';
    const tc = displayedSavedTestCases.find((t) => t.id === tcId);
    const existingCommands = Array.isArray(tc?.commands) ? tc.commands : [];
    const existingOfType = existingCommands.filter((c) => c.type === type);
    const colIndex = type === 'mdi' ? existingOfType.length + 1 : existingOfType.length + 2; // MDI1…; VCD2…
    const colPrefix = type === 'vcd' ? 'VCD' : type === 'erom' ? 'ERoM' : type === 'ulp' ? 'ULP' : type === 'mdi' ? 'MDI' : null;
    const colKey = colPrefix ? `${colPrefix}${colIndex}` : null;

    if (isDraftId(tcId)) {
      setPendingDraftTestCases((prev) =>
        prev.map((t) => {
          if (t.id !== tcId) return t;
          const commands = Array.isArray(t.commands) ? t.commands : [];
          const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const next = { ...t, commands: [...commands, { id, ...cmd }] };
          if (colKey) {
            next.extraColumns = {
              ...(next.extraColumns || {}),
              [colKey]: file,
            };
          }
          return next;
        })
      );
    } else {
      addTestCaseCommand(tcId, cmd);
      if (colKey) {
        const prevExtra = (tc && tc.extraColumns) || {};
        updateDisplayedTestCase(tcId, {
          extraColumns: {
            ...prevExtra,
            [colKey]: file,
          },
        });
      }
    }
  };
  const updateDisplayedTestCaseCommand = (tcId, cmdId, updates) => {
    if (isDraftId(tcId)) {
      setPendingDraftTestCases((prev) =>
        prev.map((t) => {
          if (t.id !== tcId || !Array.isArray(t.commands)) return t;
          return {
            ...t,
            commands: t.commands.map((c) => (c.id === cmdId ? { ...c, ...updates } : c)),
          };
        })
      );
    } else {
      updateTestCaseCommand(tcId, cmdId, updates);
    }
  };
  const removeDisplayedTestCaseCommand = (tcId, cmdId) => {
    if (isDraftId(tcId)) {
      setPendingDraftTestCases((prev) =>
        prev.map((t) => {
          if (t.id !== tcId || !Array.isArray(t.commands)) return t;
          return { ...t, commands: t.commands.filter((c) => c.id !== cmdId) };
        })
      );
    } else {
      removeTestCaseCommand(tcId, cmdId);
    }
  };
  const handleExtraColumnChange = (tcId, col, value) => {
    const m = col.match(/^(VCD|ERoM|ULP)(\d+)$/);
    const mMdi = col.match(/^MDI(\d+)$/);
    if (mMdi) {
      const idx = parseInt(mMdi[1], 10) - 1;
      const tc = displayedSavedTestCases.find((t) => String(t.id) === String(tcId));
      if (!tc) return;
      const mdis = (tc.commands || []).filter((c) => c.type === 'mdi');
      if (idx < mdis.length) {
        if (isDraftId(tcId)) {
          setPendingDraftTestCases((prev) =>
            prev.map((t) => {
              if (t.id !== tcId || !Array.isArray(t.commands)) return t;
              const cmd = mdis[idx];
              if (!cmd) return t;
              return {
                ...t,
                commands: t.commands.map((c) => (c.id === cmd.id ? { ...c, file: value } : c)),
                extraColumns: { ...(t.extraColumns || {}), [col]: value },
              };
            })
          );
        } else {
          updateTestCaseCommand(tcId, mdis[idx].id, { file: value });
        }
      } else {
        addDisplayedTestCaseCommand(tcId, { type: 'mdi', file: value });
      }
      return;
    }
    if (m) {
      const type = m[1] === 'VCD' ? 'vcd' : m[1] === 'ERoM' ? 'erom' : 'ulp';
      const idx = parseInt(m[2], 10) - 2;
      const tc = displayedSavedTestCases.find((t) => String(t.id) === String(tcId));
      if (!tc) return;
      const cmds = (tc.commands || []).filter((c) => c.type === type);
      if (idx < cmds.length) {
        if (isDraftId(tcId)) {
          setPendingDraftTestCases((prev) =>
            prev.map((t) => {
              if (t.id !== tcId || !Array.isArray(t.commands)) return t;
              const typed = t.commands.filter((c) => c.type === type);
              const cmd = typed[idx];
              if (!cmd) return t;
              return { ...t, commands: t.commands.map((c) => (c.id === cmd.id ? { ...c, file: value } : c)) };
            })
          );
        } else {
          updateTestCaseCommand(tcId, cmds[idx].id, { file: value });
        }
      } else {
        addDisplayedTestCaseCommand(tcId, { type, file: value });
      }
    } else {
      const row = displayedSavedTestCases.find((t) => String(t.id) === String(tcId));
      if (col === 'tag') {
        // Track tags we add ourselves, then prioritize them in tag chip rendering.
        const oldRaw = (row?.extraColumns && (row.extraColumns.tag || row.extraColumns.Tag)) || '';
        const oldTags = splitTags(oldRaw);
        const newTags = splitTags(value);
        const oldLower = new Set(oldTags.map((t) => String(t).toLowerCase()));
        const added = newTags.filter((t) => !oldLower.has(String(t).toLowerCase()));
        if (added.length) recordMyAddedTagsForEntity(activeProfileId, `tc:${tcId}`, added);

        const nextExtra = { ...(row?.extraColumns || {}), tag: value };
        delete nextExtra.Tag;
        syncTagColorListAfterTagChange(nextExtra, String(value ?? ''));
        updateDisplayedTestCase(tcId, { extraColumns: nextExtra });
      } else {
        updateDisplayedTestCase(tcId, { extraColumns: { ...(row?.extraColumns || {}), [col]: value } });
      }
    }
  };
  const duplicateDisplayedTestCase = (id, overrides = {}) => {
    const list = displayedSavedTestCases;
    const src = list.find((t) => t.id === id);
    if (!src) return;
    const name = overrides.name || getUniqueName((src.name || '').trim(), id);
    const dup = {
      ...src,
      id: `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
    if (loadedSetId) {
      duplicateSavedTestCase(id, overrides);
    } else {
      setPendingDraftTestCases((prev) => [...prev, dup]);
    }
  };
  const [testCaseTableLayout, setTestCaseTableLayout] = useState('table'); // 'table' | 'step' — ตารางแนวนอน หรือ layout แนวตั้งตามขั้นตอน (ตามภาพ)
  const [localDroppedFiles, setLocalDroppedFiles] = useState([]);
  const [commandMenuPopover, setCommandMenuPopover] = useState(null); // { tcId, anchor } | null — portal menu (outside scroll areas)
  const tcBuilderPanelRef = useRef(null);
  const [tcBuilderPanelHeight, setTcBuilderPanelHeight] = useState(() => {
    try {
      const raw = localStorage.getItem('tcBuilderPanelHeight');
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n >= 260 ? n : 640;
    } catch {
      return 640;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('tcBuilderPanelHeight', String(tcBuilderPanelHeight));
    } catch {
      // ignore
    }
  }, [tcBuilderPanelHeight]);

  useEffect(() => {
    if (!commandMenuPopover) return;
    const close = () => setCommandMenuPopover(null);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onCapMouseDown = (e) => {
      const el = e.target;
      if (el?.closest?.('[data-command-menu-portal]')) return;
      if (el?.closest?.('[data-testcase-command-menu-trigger]')) return;
      close();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onCapMouseDown, true);
    const end = () => close();
    window.addEventListener('scroll', end, true);
    window.addEventListener('resize', end);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onCapMouseDown, true);
      window.removeEventListener('scroll', end, true);
      window.removeEventListener('resize', end);
    };
  }, [commandMenuPopover]);

  const [saveLibraryUploadModal, setSaveLibraryUploadModal] = useState(null); // { prepared, toSave } when showing per-file Reuse/Upload before Save to library
  const justDidSaveSetRef = useRef(false);
  const sendToRunSetAfterSaveRef = useRef(false);
  const sendToRunSetItemsRef = useRef(null);

  const doSendToRunSet = useCallback(
    (testCases, nameOverride) => {
      const list = Array.isArray(testCases) ? testCases : [];
      if (list.length === 0) {
        addToast({ type: 'warning', message: 'No test cases to send to Run Set' });
        return;
      }
      const incomplete = list.filter((tc) => !isTestCasePrimaryFileSetComplete(tc));
      if (incomplete.length > 0) {
        const names = incomplete
          .map((t) => String(t?.name || '').trim() || '—')
          .slice(0, 5);
        addToast({
          type: 'warning',
          message: `แต่ละ test case ต้องมี VCD, ERoM และ ULP ให้ครบ — ${incomplete.length} แถวยังไม่ครบ: ${names.join(', ')}${incomplete.length > 5 ? '…' : ''}`,
        });
        return;
      }
      const items = list.map((tc) => ({
        name: String(tc?.name || '').trim(),
        vcdName: tc?.vcdName || '',
        binName: tc?.binName || '',
        linName: tc?.linName || null,
        tryCount: typeof tc?.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
        boardId: tc?.boardId || null,
        extraColumns: tc?.extraColumns && typeof tc.extraColumns === 'object' ? { ...tc.extraColumns } : {},
        createdAt: tc?.createdAt || new Date().toISOString(),
      }));

      setRunSetImportContext({
        items,
        name: (nameOverride || '').trim() || `Selected ${items.length} test case(s)`,
      });
      if (onNavigateToRunSet) onNavigateToRunSet();
      addToast({ type: 'success', message: `Sent ${items.length} test case(s) to Run Set` });
    },
    [setRunSetImportContext, onNavigateToRunSet, addToast]
  );

  const mergeCommandsIntoExtraForSave = useCallback((tc) => {
    const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? { ...tc.extraColumns } : {};
    const cmds = Array.isArray(tc.commands) ? tc.commands : [];
    const vcdCmds = cmds.filter((c) => c.type === 'vcd' && (c.file || '').trim());
    const eromCmds = cmds.filter((c) => c.type === 'erom' && (c.file || '').trim());
    const ulpCmds = cmds.filter((c) => c.type === 'ulp' && (c.file || '').trim());
    const mdiCmds = cmds.filter((c) => c.type === 'mdi' && (c.file || '').trim());
    vcdCmds.forEach((c, i) => { extra[`VCD${i + 2}`] = c.file || ''; });
    eromCmds.forEach((c, i) => { extra[`ERoM${i + 2}`] = c.file || ''; });
    ulpCmds.forEach((c, i) => { extra[`ULP${i + 2}`] = c.file || ''; });
    mdiCmds.forEach((c, i) => { extra[`MDI${i + 1}`] = c.file || ''; });
    return Object.fromEntries(Object.entries(extra).filter(([, v]) => (v ?? '').toString().trim() !== ''));
  }, []);

  const getTableExtraColKeysForTc = useCallback((t) => {
    const fromExtra = Object.keys(t.extraColumns || {});
    const fromCmds = [];
    (t.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`VCD${i + 2}`));
    (t.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`ERoM${i + 2}`));
    (t.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim()).forEach((_, i) => fromCmds.push(`ULP${i + 2}`));
    (t.commands || []).filter((c) => c.type === 'mdi').forEach((_, i) => fromCmds.push(`MDI${i + 1}`));
    return [...fromExtra, ...fromCmds];
  }, []);

  const getTableExtraColVal = useCallback((tc, col) => {
    const m = col.match(/^VCD(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10) - 2;
      const vcds = (tc.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim());
      return vcds[idx]?.file ?? tc.extraColumns?.[col] ?? '';
    }
    const m2 = col.match(/^ERoM(\d+)$/);
    if (m2) {
      const idx = parseInt(m2[1], 10) - 2;
      const eroms = (tc.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim());
      return eroms[idx]?.file ?? tc.extraColumns?.[col] ?? '';
    }
    const m3 = col.match(/^ULP(\d+)$/);
    if (m3) {
      const idx = parseInt(m3[1], 10) - 2;
      const ulps = (tc.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim());
      return ulps[idx]?.file ?? tc.extraColumns?.[col] ?? '';
    }
    const m4 = col.match(/^MDI(\d+)$/);
    if (m4) {
      const idx = parseInt(m4[1], 10) - 1;
      const mdis = (tc.commands || []).filter((c) => c.type === 'mdi');
      return mdis[idx]?.file ?? tc.extraColumns?.[col] ?? '';
    }
    return tc.extraColumns?.[col] ?? '';
  }, []);

  const handleSaveLibraryUploadChoiceConfirm = useCallback(async (choices) => {
    const modal = saveLibraryUploadModal;
    if (!modal?.prepared?.length) return;
    const { prepared, toSave } = modal;
    let uploaded = 0;
    let reused = 0;
    for (const p of prepared) {
      const choice = choices[p.file.name];
      if (p.existing && (choice || 'reuse') === 'reuse') {
        reused++;
        continue;
      }
      const result = await addUploadedFile(p.file);
      if (result) uploaded++;
    }
    setLocalDroppedFiles([]);
    if (refreshFiles) await refreshFiles();
    if (uploaded > 0) addToast({ type: 'success', message: `${uploaded} file(s) uploaded to library` });
    if (reused > 0) addToast({ type: 'info', message: `${reused} file(s) reused from library` });
    if (toSave?.length > 0) {
      const badRows = toSave.filter((tc) => !isTestCasePrimaryFileSetComplete(tc));
      if (badRows.length > 0) {
        setSaveLibraryUploadModal(null);
        const names = badRows.map((t) => String(t.name || '—').trim() || '—').slice(0, 5);
        addToast({
          type: 'warning',
          message: `แต่ละ test case ต้องมี VCD, ERoM และ ULP ให้ครบ — ยังไม่บันทึก (${badRows.length} แถว): ${names.join(', ')}${badRows.length > 5 ? '…' : ''}`,
        });
        if (sendToRunSetAfterSaveRef.current) {
          sendToRunSetAfterSaveRef.current = false;
          sendToRunSetItemsRef.current = null;
        }
        return;
      }
      const existingSaved = useTestStore.getState().savedTestCases || [];
      const existingByKey = new Map(
        existingSaved.map((t) => [getFullTestCaseFileKeyFromMerged(t, mergeCommandsIntoExtraForSave(t)), t])
      );
      const skipped = [];
      const created = [];
      toSave.forEach((tc) => {
        const { id, commands, ...rest } = tc;
        const extraColumns = mergeCommandsIntoExtraForSave(tc);
        const key = getFullTestCaseFileKeyFromMerged(rest, extraColumns);
        const existing = existingByKey.get(key);
        if (existing) {
          skipped.push(existing);
          return;
        }
        const newId = addSavedTestCase({
          ...rest,
          extraColumns: Object.keys(extraColumns).length ? extraColumns : undefined,
        });
        created.push(newId);
      });
      setPendingDraftTestCases([]);
      setTableClearedMode(true);
      setSetupClearedPersisted(activeProfileId, true);
      setSelectedTestCaseIds([]);
      if (refreshFiles) await refreshFiles();
      const total = useTestStore.getState().savedTestCases?.length || 0;
      if (created.length > 0) {
        addToast({
          type: 'success',
          message: `Test cases saved to library (${total} case(s))`,
        });
        if (skipped.length > 0) {
          addToast({
            type: 'info',
            message: `${skipped.length} test case(s) already existed (same VCD/ERoM/ULP) and were reused`,
          });
        }
      } else if (skipped.length > 0) {
        addToast({
          type: 'info',
          message: `All ${skipped.length} test case(s) already exist in library — no new entries created`,
        });
      }
    } else {
      if (refreshFiles) await refreshFiles();
      const total = useTestStore.getState().savedTestCases?.length || 0;
      addToast({ type: 'success', message: `Test cases saved to library (${total} case(s))` });
    }
    setSaveLibraryUploadModal(null);

    if (sendToRunSetAfterSaveRef.current) {
      sendToRunSetAfterSaveRef.current = false;
      const items = Array.isArray(toSave) ? toSave : sendToRunSetItemsRef.current;
      sendToRunSetItemsRef.current = null;
      doSendToRunSet(items, 'Saved & run from Test Cases');
    }
  }, [saveLibraryUploadModal, addUploadedFile, refreshFiles, addToast, addSavedTestCase, setPendingDraftTestCases, mergeCommandsIntoExtraForSave, activeProfileId, doSendToRunSet]);

  const getFileKind = (file) => {
    const ext = String(file?.name || '').split('.').pop()?.toLowerCase();
    if (ext === 'vcd') return 'vcd';
    if (['bin', 'hex', 'elf', 'erom'].includes(ext)) return 'bin';
    if (ext === 'txt') return 'mdi';
    if (['lin', 'ulp'].includes(ext)) return 'lin';
    return 'other';
  };
  const workingFilesList = (() => {
    const byId = new Map();
    selectedIds.forEach((id) => {
      const f = uploadedFiles.find((x) => x.id === id);
      if (f && !byId.has(f.id)) byId.set(f.id, f);
    });
    localDroppedFiles.forEach((f) => {
      const entry = { id: f.id, name: f.name, sizeFormatted: f.sizeFormatted };
      if (!byId.has(f.id)) byId.set(f.id, entry);
    });
    return [...byId.values()];
  })();
  const selectedFiles = workingFilesList;
  const vcdFilesList = uploadedFiles.filter((f) => getFileKind(f) === 'vcd');
  const binFilesList = uploadedFiles.filter((f) => getFileKind(f) === 'bin');
  const linFilesList = uploadedFiles.filter((f) => getFileKind(f) === 'lin');
  const mdiFilesList = uploadedFiles.filter((f) => getFileKind(f) === 'mdi');
  const vcdSelected = selectedFiles.filter((f) => getFileKind(f) === 'vcd');
  const binSelected = selectedFiles.filter((f) => getFileKind(f) === 'bin');
  const workingCount = selectedIds.length + localDroppedFiles.length;

  const normalizeTCTestCaseKey = (tc) => {
    const v = (tc.vcdName || '').trim();
    const b = (tc.binName || '').trim();
    const l = (tc.linName || '').trim();
    return `${v}||${b}||${l}`;
  };

  /** Key สำหรับเช็คซ้ำ: ต้องตรงทุกไฟล์ใน test case (3, 4, 5 ไฟล์ ตามที่ user สร้าง) ไม่ใช่แค่ VCD+ERoM+ULP หลัก */
  const normalizeTCTestCaseKeyFull = (tc) => {
    const base = [(tc.vcdName || '').trim(), (tc.binName || '').trim(), (tc.linName || '').trim()].join('||');
    const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
    const fileCols = Object.keys(extra).filter((k) => /^(VCD|ERoM|ULP|MDI)\d+$/i.test(k)).sort();
    const extraPart = fileCols.map((k) => (extra[k] || '').toString().trim()).join('||');
    return extraPart ? `${base}||${extraPart}` : base;
  };

  const getFullTestCaseFileKeyFromMerged = (tc, mergedExtra) => {
    const base = [(tc.vcdName || '').trim(), (tc.binName || '').trim(), (tc.linName || '').trim()].join('||');
    const fileCols = Object.keys(mergedExtra || {}).filter((k) => /^(VCD|ERoM|ULP|MDI)\d+$/i.test(k)).sort();
    const extraPart = fileCols.map((k) => (mergedExtra[k] || '').toString().trim()).join('||');
    return extraPart ? `${base}||${extraPart}` : base;
  };

  // ชื่อไม่ซ้ำทั้งระบบ (ทุกโปรไฟล์ + แบบร่างบนหน้านี้)
  const getUniqueName = (baseName, excludeId = null) =>
    ensureUniqueTestCaseName(baseName, excludeId, { extraTestCaseLists: [pendingDraftTestCases] });

  const isTestCaseLocked = (tcId) => {
    // Locked if this test case is part of any saved set (to avoid surprising changes to sets/runs)
    return (savedTestCaseSets || []).some((set) =>
      (Array.isArray(set.items) ? set.items : []).some((t) => t.id === tcId)
    );
  };
  const isTestCaseInUseByBatch = (tc) => {
    // แถวร่างบนหน้า Create — ลบ/เปลี่ยนไฟล์ได้เสมอ (ไม่ใช่การลบจาก Library)
    if (tc && isDraftId(tc.id)) return false;
    const v = (tc.vcdName || '').trim();
    const b = (tc.binName || '').trim();
    const l = (tc.linName || '').trim();
    // ถ้ายังเลือกไฟล์ไม่ครบ 3 ตัว (VCD/ERoM/ULP) ให้ถือว่ายังไม่ถูกใช้งาน ปล่อยให้แก้ไข/เลือกไฟล์ต่อได้
    if (!v || !b || !l) return false;
    const baseKey = `${v}||${b}||${l}`;
    return testCaseFileKeysInUseByBatch.has(baseKey);
  };

  /** Tag column: first tag + … (if ≥1 tag) + + — คลิก pill หรือ … เปิด modal (สี/แก้ชื่อ tag); ถ้ามีแค่ 1 tag ก็แสดง … เพื่อไม่ให้ user หาปุ่มไม่เจอ */
  const renderTestCaseTagCell = (tc) => {
    const raw = (tc.extraColumns && (tc.extraColumns.tag || tc.extraColumns.Tag)) || '';
    const tags = splitTags(raw);
    const colorList = normalizeTagColorList(tc.extraColumns, tags.length);
    const entityKey = `tc:${tc.id}`;
    const { orderedTags, orderedColorList } = reorderTagsForDisplay(activeProfileId, entityKey, tags, colorList);
    const firstTagPillClass =
      orderedColorList.length > 0 && TAG_PALETTE_MAP[orderedColorList[0]]
        ? TAG_PALETTE_MAP[orderedColorList[0]]
        : TAG_PALETTE_MAP.mint;
    const tagDisabled = isTestCaseInUseByBatch(tc) || isViewingShared;

    const openTagModal = () => {
      setTcTagOverflowTcId(tc.id);
      setTcTagModalAddDraft('');
      setTcTagModalEditIndex(null);
      setTcTagModalEditDraft('');
    };

    const showEllipsis = tags.length >= 1;

    return (
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        {tags.length === 0 ? (
          tagDisabled ? (
            <span className="text-slate-400">—</span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setTcTagPlusInputTcId(tc.id);
                setTcTagPlusInputDraft('');
              }}
              className="inline-flex items-center px-2 py-0.5 rounded-full border border-dashed border-slate-400/60 text-[11px] text-slate-400 hover:border-slate-300 hover:text-slate-300 transition-colors"
              title="Add tag (or use +)"
            >
              No tag
            </button>
          )
        ) : (
          <>
            {!tagDisabled ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openTagModal();
                }}
                className={`px-1.5 py-0.5 rounded-full text-[10px] max-w-[120px] truncate border hover:brightness-95 text-left ${firstTagPillClass}`}
                title="View / edit tags"
              >
                {orderedTags[0]}
              </button>
            ) : (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] max-w-[120px] truncate border ${firstTagPillClass}`}
                title={orderedTags[0]}
              >
                {orderedTags[0]}
              </span>
            )}
            {showEllipsis && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openTagModal();
                }}
                className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                title="Tags & colors"
              >
                …
              </button>
            )}
          </>
        )}
        {!tagDisabled && (
          <>
            {tcTagPlusInputTcId === tc.id ? (
              <>
                <input
                  type="text"
                  value={tcTagPlusInputDraft}
                  onChange={(e) => setTcTagPlusInputDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (tagEnterShouldIgnoreIme(e)) return;
                      e.preventDefault();
                      const add = tcTagPlusInputDraft.trim();
                      if (!add) {
                        setTcTagPlusInputTcId(null);
                        setTcTagPlusInputDraft('');
                        return;
                      }
                      const next = upsertTagsString(raw, add);
                      handleExtraColumnChange(tc.id, 'tag', next);
                      setTcTagPlusInputDraft('');
                      setTcTagPlusInputTcId(null);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setTcTagPlusInputTcId(null);
                      setTcTagPlusInputDraft('');
                    }
                  }}
                  onBlur={() => {
                    setTcTagPlusInputTcId(null);
                    setTcTagPlusInputDraft('');
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="px-2 py-0.5 text-[11px] rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 w-28 min-w-0"
                  placeholder="tag…"
                  title="Press Enter to add (comma supported)"
                  autoFocus
                />
                {tcTagHistory.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(() => {
                      const existingLower = new Set(tags.map((t) => t.toLowerCase()));
                      const q = tcTagPlusInputDraft.trim().toLowerCase();
                      return tcTagHistory
                        .filter((t) => {
                          const lt = t.toLowerCase();
                          if (existingLower.has(lt)) return false;
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
                              const next = upsertTagsString(raw, t);
                              const prevLower = new Set(splitTags(raw).map((x) => x.toLowerCase()));
                              const added = splitTags(t).filter(
                                (x) => !prevLower.has(String(x).toLowerCase())
                              );
                              if (added.length) {
                                recordMyAddedTagsForEntity(activeProfileId, `tc:${tc.id}`, added);
                              }
                              handleExtraColumnChange(tc.id, 'tag', next);
                              setTcTagPlusInputDraft('');
                              setTcTagPlusInputTcId(null);
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
              </>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTcTagPlusInputTcId(tc.id);
                  setTcTagPlusInputDraft('');
                }}
                className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                title="Add tag"
              >
                +
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  const handleNameChange = (tcId, newName, prevName = '') => {
    const trimmed = (newName || '').trim();
    const used = useTestStore.getState().getAllGlobalTestCaseNames(tcId, {
      extraTestCaseLists: [pendingDraftTestCases],
    });
    const isDuplicate = trimmed !== '' && used.has(trimmed);
    if (isDuplicate) {
      addToast({
        type: 'warning',
        message: 'ชื่อนี้ถูกใช้แล้วในระบบ (ทุกโปรไฟล์) — ใช้ชื่ออื่น',
      });
      updateDisplayedTestCase(tcId, { name: prevName });
      return;
    }
    updateDisplayedTestCase(tcId, { name: trimmed });
  };

  // เมื่อมีไฟล์ใหม่จาก Library (refresh): ไม่ overwrite ถ้า Save Set; ถ้า Start fresh ให้เลือกเฉพาะที่เพิ่ม; ถ้า user เคยกด Start fresh/Clear (persisted) ไม่ auto-select เพื่อไม่ให้ไฟล์กลับมา
  useEffect(() => {
    if (justDidSaveSetRef.current) {
      justDidSaveSetRef.current = false;
      prevUploadedCountRef.current = uploadedFiles.length;
      return;
    }
    if (getSetupClearedPersisted(activeProfileId)) {
      setSelectedIds([]);
      prevUploadedCountRef.current = uploadedFiles.length;
      return;
    }
    const prev = prevUploadedCountRef.current;
    const curr = uploadedFiles.length;
    if (curr > prev) {
      if (justDidStartFreshRef.current) {
        const newFiles = uploadedFiles.slice(prev);
        setSelectedIds((prevIds) => [...prevIds, ...newFiles.map((f) => f.id)]);
        const t = setTimeout(() => { justDidStartFreshRef.current = false; }, 2000);
        prevUploadedCountRef.current = curr;
        return () => clearTimeout(t);
      }
      // กลับมาหลัง remount: ถ้า prev === 0 เลือกเฉพาะไฟล์ที่ใช้โดย test cases (ยกเว้นเมื่อ persisted cleared แล้ว)
      if (prev === 0) {
        const allCases = [...(savedTestCases || []), ...(pendingDraftTestCases || [])];
        const usedNames = new Set();
        allCases.forEach((t) => {
          if (t.vcdName) usedNames.add(t.vcdName);
          if (t.binName) usedNames.add(t.binName);
          if (t.linName) usedNames.add(t.linName);
        });
        const matchingIds = (uploadedFiles || []).filter((f) => usedNames.has(f.name)).map((f) => f.id);
        setSelectedIds(matchingIds.length > 0 ? matchingIds : []);
        prevUploadedCountRef.current = curr;
        return;
      }
      setSelectedIds(uploadedFiles.map((f) => f.id));
    }
    prevUploadedCountRef.current = curr;
  }, [uploadedFiles.length, savedTestCases.length, pendingDraftTestCases.length, activeProfileId]);

  // Auto-pair: เมื่อเลือกไฟล์ (VCD + ERoM + ULP) ให้สร้าง test case อัตโนมัติ — ใส่ draft จนกว่าจะกด Save
  useEffect(() => {
    const orderedFiles = selectedFiles;
    if (orderedFiles.length === 0) return;
    const orderedVcds = orderedFiles.filter((f) => getFileKind(f) === 'vcd');
    const orderedBins = orderedFiles.filter((f) => getFileKind(f) === 'bin');
    const orderedLins = orderedFiles.filter((f) => getFileKind(f) === 'lin');
    if (orderedVcds.length === 0 || orderedBins.length === 0 || orderedLins.length === 0) return;
    orderedVcds.forEach((vcdFile, vcdIdx) => {
      const vcdIndexInOrdered = orderedFiles.findIndex((f) => f.id === vcdFile.id);
      let nearestBin = null, minDistance = Infinity;
      orderedBins.forEach((binFile) => {
        const d = Math.abs(orderedFiles.findIndex((f) => f.id === binFile.id) - vcdIndexInOrdered);
        if (d < minDistance) { minDistance = d; nearestBin = binFile; }
      });
      const binFile = nearestBin || orderedBins[vcdIdx % orderedBins.length];
      let nearestLin = null, minLin = Infinity;
      orderedLins.forEach((linFile) => {
        const d = Math.abs(orderedFiles.findIndex((f) => f.id === linFile.id) - vcdIndexInOrdered);
        if (d < minLin) { minLin = d; nearestLin = linFile; }
      });
      const pairKey = normalizeTCTestCaseKeyFull({
        vcdName: vcdFile.name,
        binName: binFile.name,
        linName: nearestLin?.name || '',
      });
      const libCases = [...(savedTestCases || []), ...(globalSavedTestCases || [])];
      const inLibrary = libCases.some((t) => normalizeTCTestCaseKeyFull(t) === pairKey);
      const inDraft = (pendingDraftTestCases || []).some((t) => normalizeTCTestCaseKeyFull(t) === pairKey);
      if (!inLibrary && !inDraft) {
        const name = getNextTestCaseName();
        const entry = { name, vcdName: vcdFile.name, binName: binFile.name, linName: nearestLin?.name || '', tryCount: 1, createdAt: new Date().toISOString() };
        if (loadedSetId) {
          addSavedTestCase(entry);
        } else {
          setPendingDraftTestCases((prev) => [...prev, { ...entry, id: `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }]);
        }
      }
    });
    // Do not depend on pendingDraftTestCases.length: deleting a draft row would re-run this effect
    // while the same files stay selected and the pair would be auto-added again.
  }, [
    selectedIds.join(','),
    localDroppedFiles.length,
    localDroppedFiles.map((f) => f.id).join(','),
    savedTestCases?.length,
    globalSavedTestCases?.length,
    loadedSetId,
  ]);

  // เมื่อโหลด Set แล้วอัปโหลดไฟล์เพิ่ม — เลือกไฟล์ที่ตรงกับ Set อัตโนมัติ
  useEffect(() => {
    if (!loadedSetId || !uploadedFiles.length) return;
    const loadedSet = savedTestCaseSets?.find((s) => s.id === loadedSetId);
    if (!loadedSet) return;
    const fileNames = loadedSet.fileLibrarySnapshot?.length
      ? loadedSet.fileLibrarySnapshot.map((s) => s.name)
      : [...(loadedSet.items || []).reduce((acc, t) => { if (t.vcdName) acc.add(t.vcdName); if (t.binName) acc.add(t.binName); if (t.linName) acc.add(t.linName); return acc; }, new Set())];
    if (fileNames.length === 0) return;
    const matchingIds = uploadedFiles.filter((f) => fileNames.includes(f.name)).map((f) => f.id);
    if (matchingIds.length > 0) setSelectedIds((prev) => [...new Set([...prev, ...matchingIds])]);
  }, [loadedSetId, uploadedFiles.length, savedTestCaseSets]);

  const pairAll = () => {
    if (vcdSelected.length === 0 || binSelected.length === 0) {
      addToast({ type: 'warning', message: 'Select at least one VCD and one ERoM file first' });
      return;
    }
    const linSelected = selectedFiles.filter((f) => getFileKind(f) === 'lin');
    if (linSelected.length === 0) {
      addToast({ type: 'warning', message: 'Select at least one ULP/LIN file — VCD, ERoM, and ULP are required for each test case' });
      return;
    }
    const orderedFiles = selectedFiles;
    const orderedVcds = orderedFiles.filter((f) => getFileKind(f) === 'vcd');
    const orderedBins = orderedFiles.filter((f) => getFileKind(f) === 'bin');
    const orderedLins = orderedFiles.filter((f) => getFileKind(f) === 'lin');
    let added = 0;
    const duplicateIds = new Set();
    const existingByKey = new Map(
      (savedTestCases || []).map((t) => [normalizeTCTestCaseKeyFull(t), t])
    );
    (globalSavedTestCases || []).forEach((t) => {
      const k = normalizeTCTestCaseKeyFull(t);
      if (!existingByKey.has(k)) existingByKey.set(k, t);
    });
    orderedVcds.forEach((vcdFile, vcdIdx) => {
      const vcdIndexInOrdered = orderedFiles.findIndex((f) => f.id === vcdFile.id);
      let nearestBin = null, minDistance = Infinity;
      orderedBins.forEach((binFile) => {
        const d = Math.abs(orderedFiles.findIndex((f) => f.id === binFile.id) - vcdIndexInOrdered);
        if (d < minDistance) { minDistance = d; nearestBin = binFile; }
      });
      const binFile = nearestBin || orderedBins[vcdIdx % orderedBins.length];
      let nearestLin = null, minLin = Infinity;
      orderedLins.forEach((linFile) => {
        const d = Math.abs(orderedFiles.findIndex((f) => f.id === linFile.id) - vcdIndexInOrdered);
        if (d < minLin) { minLin = d; nearestLin = linFile; }
      });
      const pairEntry = { vcdName: vcdFile.name, binName: binFile.name, linName: nearestLin?.name || '' };
      const key = normalizeTCTestCaseKeyFull(pairEntry);
      const existing = existingByKey.get(key) ||
        (pendingDraftTestCases || []).find((t) => normalizeTCTestCaseKeyFull(t) === key) ||
        (displayedSavedTestCases || []).find((t) => normalizeTCTestCaseKeyFull(t) === key);
      if (!existing) {
        const name = getNextTestCaseName();
        const entry = { name, vcdName: vcdFile.name, binName: binFile.name, linName: nearestLin?.name || '', tryCount: 1, createdAt: new Date().toISOString() };
        if (loadedSetId) {
          addSavedTestCase(entry);
        } else {
          setPendingDraftTestCases((prev) => [...prev, { ...entry, id: `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }]);
        }
        added++;
      } else if (existing.id) {
        duplicateIds.add(existing.id);
      }
    });
    if (added > 0) {
      setSetupClearedPersisted(activeProfileId, false);
      setTableClearedMode(false);
      addToast({ type: 'success', message: `Added ${added} test case(s) from selection` });
      if (duplicateIds.size > 0) {
        addToast({
          type: 'warning',
          message: `${duplicateIds.size} pair(s) match an existing test case in the library (any owner) — skipped. Choose different files.`,
        });
      }
    } else if (duplicateIds.size > 0) {
      const ids = Array.from(duplicateIds);
      setSelectedTestCaseIds(ids);
      setDuplicateHighlightIds(ids);
      addToast({
        type: 'warning',
        message: `Same file set as ${ids.length} existing library test case(s) — no new rows. Pick different files.`,
      });
    } else {
      addToast({ type: 'info', message: 'All possible pairs already exist in the library' });
    }
  };

  /** จากรายการ file id ใน Library: จัดกลุ่มตาม TCxxxx ในชื่อไฟล์ แล้วสร้างแถว test case (ต้องมี VCD+ERoM+ULP ใน Library, MDI ถ้ามี) */
  const runLibraryGroupingFromFileIds = (fileIds) => {
    const ids = [...new Set((fileIds || []).filter(Boolean))];
    const files = ids.map((id) => uploadedFiles.find((f) => f.id === id)).filter(Boolean);
    if (files.length === 0) {
      addToast({ type: 'warning', message: 'ไม่พบไฟล์ใน Library' });
      return;
    }
    setSelectedIds(ids);
    setSetupClearedPersisted(activeProfileId, false);
    setTableClearedMode(false);

    const groups = new Map();
    for (const f of files) {
      const key = extractTcGroupKeyFromFileName(f.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const sortPick = (arr) => [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    /** รวมไฟล์ที่เลือกกับทุกไฟล์ใน Library ที่ extractTcGroupKey ตรงกัน — เติม VCD/ERoM/ULP/MDI ที่ user ยังไม่ติ๊ก */
    const mergeSelectedWithLibraryByKey = (gKey, groupFiles) => {
      const byId = new Map();
      for (const f of groupFiles) {
        if (f?.id) byId.set(f.id, f);
      }
      for (const f of uploadedFiles || []) {
        if (!f?.id || byId.has(f.id)) continue;
        if (extractTcGroupKeyFromFileName(f.name) === gKey) {
          byId.set(f.id, f);
        }
      }
      return sortPick([...byId.values()]);
    };
    const buildMdiColumnsAndCommands = (mdis) => {
      const list = [...(mdis || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      if (list.length === 0) return { extraColumns: undefined, mdiCmd: [] };
      const t = Date.now();
      const extraColumns = list.reduce((acc, mdi, i) => {
        acc[`MDI${i + 1}`] = mdi.name;
        return acc;
      }, {});
      const mdiCmd = list.map((mdi, i) => ({
        id: `cmd-${t}-${i}-${Math.random().toString(36).slice(2, 9)}`,
        type: 'mdi',
        file: mdi.name,
      }));
      return { extraColumns, mdiCmd };
    };

    const makeNameForGroup = (gKey, namesUsed) => {
      if (/^TC\d+$/i.test(gKey)) {
        const base = gKey.toUpperCase();
        if (!namesUsed.has(base)) {
          namesUsed.add(base);
          return base;
        }
        let n = 2;
        while (namesUsed.has(`${base} (${n})`)) n += 1;
        const nm = `${base} (${n})`;
        namesUsed.add(nm);
        return nm;
      }
      const nums = [...namesUsed].map((name) => {
        const m = (name || '').match(/^TC(\d+)$/i);
        return m ? parseInt(m[1], 10) : 0;
      });
      let nextNum = Math.max(0, ...nums) + 1;
      let candidate = `TC${String(nextNum).padStart(5, '0')}`;
      while (namesUsed.has(candidate)) {
        nextNum += 1;
        candidate = `TC${String(nextNum).padStart(5, '0')}`;
      }
      namesUsed.add(candidate);
      return candidate;
    };

    if (loadedSetId) {
      const state = useTestStore.getState();
      const existingKeys = new Set();
      (state.loadedSetTable || []).forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));
      (savedTestCases || []).forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));
      (globalSavedTestCases || []).forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));
      (pendingDraftTestCases || []).forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));

      const namesUsed = new Set(
        useTestStore.getState().getAllGlobalTestCaseNames(null, {
          extraTestCaseLists: [pendingDraftTestCases],
        })
      );

      let added = 0;
      let totalPulledFromLib = 0;
      const skipped = [];
      for (const [gKey, groupFiles] of groups) {
        const gf = mergeSelectedWithLibraryByKey(gKey, groupFiles);
        totalPulledFromLib += Math.max(0, gf.length - groupFiles.length);
        const vcd = gf.find((f) => getFileKind(f) === 'vcd');
        const bin = gf.find((f) => getFileKind(f) === 'bin');
        const lin = gf.find((f) => getFileKind(f) === 'lin');
        const mdis = gf.filter((f) => getFileKind(f) === 'mdi');
        const { extraColumns, mdiCmd } = buildMdiColumnsAndCommands(mdis);
        if (!vcd || !bin || !lin) {
          skipped.push(gKey);
          continue;
        }
        const pairEntry = { vcdName: vcd.name, binName: bin.name, linName: lin.name };
        const key = normalizeTCTestCaseKeyFull(pairEntry);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        const name = makeNameForGroup(gKey, namesUsed);
        addSavedTestCase({
          name,
          vcdName: vcd.name,
          binName: bin.name,
          linName: lin.name,
          tryCount: 1,
          createdAt: new Date().toISOString(),
          ...(extraColumns ? { extraColumns } : {}),
          ...(mdiCmd.length ? { commands: mdiCmd } : {}),
        });
        added += 1;
      }
      if (skipped.length) {
        addToast({
          type: 'warning',
          message: `skipped ${skipped.length} groups that need VCD, ERoM, and ULP in your Library: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}`,
        });
      }
      if (totalPulledFromLib > 0) {
        addToast({
          type: 'info',
          message: `รวม ${totalPulledFromLib} ไฟล์เพิ่มจาก Library (ชื่อ TC เดียวกัน) เพื่อจับคู่ VCD/ERoM/ULP/MDI ให้ครบ`,
        });
      }
      if (added > 0) {
        addToast({ type: 'success', message: `added ${added} test cases from Library (grouped by TCxxxx in file name)` });
      } else if (!skipped.length) {
        addToast({ type: 'info', message: 'no new rows — file set already exists in the list' });
      }
      return;
    }

    setPendingDraftTestCases((prev) => {
      const existingKeys = new Set();
      (savedTestCases || []).forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));
      (globalSavedTestCases || []).forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));
      prev.forEach((t) => existingKeys.add(normalizeTCTestCaseKeyFull(t)));

      const namesUsed = new Set(
        useTestStore.getState().getAllGlobalTestCaseNames(null, {
          extraTestCaseLists: [prev],
        })
      );

      const newRows = [];
      const skipped = [];
      let totalPulledFromLib = 0;
      for (const [gKey, groupFiles] of groups) {
        const gf = mergeSelectedWithLibraryByKey(gKey, groupFiles);
        totalPulledFromLib += Math.max(0, gf.length - groupFiles.length);
        const vcd = gf.find((f) => getFileKind(f) === 'vcd');
        const bin = gf.find((f) => getFileKind(f) === 'bin');
        const lin = gf.find((f) => getFileKind(f) === 'lin');
        const mdis = gf.filter((f) => getFileKind(f) === 'mdi');
        const { extraColumns, mdiCmd } = buildMdiColumnsAndCommands(mdis);
        if (!vcd || !bin || !lin) {
          skipped.push(gKey);
          continue;
        }
        const pairEntry = { vcdName: vcd.name, binName: bin.name, linName: lin.name };
        const key = normalizeTCTestCaseKeyFull(pairEntry);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        const name = makeNameForGroup(gKey, namesUsed);
        newRows.push({
          id: `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name,
          vcdName: vcd.name,
          binName: bin.name,
          linName: lin.name,
          tryCount: 1,
          createdAt: new Date().toISOString(),
          ...(extraColumns ? { extraColumns } : {}),
          ...(mdiCmd.length ? { commands: mdiCmd } : {}),
        });
      }
      // Defer toasts: addToast updates NotificationBell; must not run inside the setState updater.
      queueMicrotask(() => {
        if (skipped.length) {
          addToast({
            type: 'warning',
            message: `skipped ${skipped.length} groups that need VCD, ERoM, and ULP in your Library: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}`,
          });
        }
        if (totalPulledFromLib > 0) {
          addToast({
            type: 'info',
            message: `รวม ${totalPulledFromLib} ไฟล์เพิ่มจาก Library (ชื่อ TC เดียวกัน) เพื่อจับคู่ VCD/ERoM/ULP/MDI ให้ครบ`,
          });
        }
        if (newRows.length) {
          addToast({ type: 'success', message: `created ${newRows.length} test cases from Library (grouped by TCxxxx in file name)` });
        } else if (!skipped.length) {
          addToast({
            type: 'warning',
            message:
              'All selected file groups already match test cases in the library (any owner). Nothing new added — pick a different file set.',
          });
        }
      });
      return [...prev, ...newRows];
    });
  };

  useEffect(() => {
    if (!fileToTestCaseDraft?.fileIds?.length) return;
    if (isViewingShared) {
      clearFileToTestCaseDraft();
      addToast({ type: 'info', message: 'switch to your files to create test cases from Library' });
      return;
    }
    const ids = [...fileToTestCaseDraft.fileIds];
    clearFileToTestCaseDraft();
    runLibraryGroupingFromFileIds(ids);
  }, [fileToTestCaseDraft, isViewingShared, clearFileToTestCaseDraft]);

  const addOneTestCase = () => {
    setSetupClearedPersisted(activeProfileId, false);
    setTableClearedMode(false);
    const name = getNextTestCaseName();
    const entry = { name, vcdName: '', binName: '', linName: '', tryCount: 1, createdAt: new Date().toISOString() };
    if (loadedSetId) {
      addSavedTestCase(entry);
    } else {
      setPendingDraftTestCases((prev) => [...prev, { ...entry, id: `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }]);
    }
    addToast({ type: 'success', message: `Added "${name}" — fill VCD/ERoM below or rename if you like` });
  };

  /**
   * Toolbar "Insert" — same UX as File Library → Test Cases tab.
   * Requires exactly one selected row, then inserts a new TC (identical defaults
   * to `addOneTestCase`) immediately above or below that row.
   */
  const handleInsertRowFromToolbar = (position) => {
    setInsertRowMenuOpen(false);
    if (isViewingShared) {
      addToast({ type: 'warning', message: 'Read-only mode — cannot insert rows' });
      return;
    }
    if (selectedTestCaseIds.length === 0) {
      addToast({
        type: 'info',
        message: 'เลือกแถวในตารางก่อน แล้วค่อย Insert row (เหมือน Excel — เลือกแถว แล้วใช้เมนู Insert)',
      });
      return;
    }
    if (selectedTestCaseIds.length > 1) {
      addToast({
        type: 'info',
        message: 'Select one row first — then select Insert row above or below',
      });
      return;
    }
    const targetId = selectedTestCaseIds[0];
    const idx = displayedSavedTestCases.findIndex((t) => String(t.id) === String(targetId));
    if (idx < 0) {
      addToast({ type: 'warning', message: 'ไม่พบแถวที่เลือกในตาราง' });
      return;
    }
    const insertAt = position === 'above' ? idx : idx + 1;

    setSetupClearedPersisted(activeProfileId, false);
    setTableClearedMode(false);
    const name = getNextTestCaseName();
    const entry = { name, vcdName: '', binName: '', linName: '', tryCount: 1, createdAt: new Date().toISOString() };
    if (loadedSetId) {
      addSavedTestCase(entry, { insertAt });
    } else {
      setPendingDraftTestCases((prev) => {
        const next = [...prev];
        const safe = Math.max(0, Math.min(insertAt, next.length));
        next.splice(safe, 0, {
          ...entry,
          id: `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        });
        return next;
      });
    }
    addToast({
      type: 'success',
      message: `Inserted "${name}" ${position === 'above' ? 'above' : 'below'} the selected row`,
    });
  };

  useEffect(() => {
    if (!insertRowMenuOpen) return;
    const onDoc = (e) => {
      const root = e.target?.closest?.('[data-testcases-insert-menu]');
      if (!root) setInsertRowMenuOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setInsertRowMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [insertRowMenuOpen]);

  // Clear: ล้างเฉพาะ UI/ตาราง ไม่ลบข้อมูลจาก Library (server). Persist so refresh/return keeps empty.
  const clearAllTestCases = () => {
    const total = (savedTestCases?.length || 0) + (pendingDraftTestCases?.length || 0) + selectedIds.length;
    if (total === 0) { addToast({ type: 'info', message: 'No test cases or file selection to clear' }); return; }
    if (window.confirm('Clear table and file selection? (Saved test cases in Library will remain)')) {
      setSetupClearedPersisted(activeProfileId, true);
      setTableClearedMode(true);
      setPendingDraftTestCases([]);
      setSelectedTestCaseIds([]);
      setSelectedIds([]);
      setLoadedSetId(null);
      addToast({ type: 'success', message: 'Table cleared — Library unchanged' });
    }
  };

  const toggleSelectAllTestCases = () => {
    if (selectedTestCaseIds.length === displayedSavedTestCases.length) setSelectedTestCaseIds([]);
    else setSelectedTestCaseIds(displayedSavedTestCases.map((t) => t.id));
  };
  const toggleTestCaseSelect = (id) => {
    setSelectedTestCaseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const handleBulkSetTryCount = () => {
    if (selectedTestCaseIds.length === 0) { addToast({ type: 'warning', message: 'Select at least one test case' }); return; }
    const num = parseInt(bulkTryCount, 10);
    if (isNaN(num) || num < 1) { addToast({ type: 'error', message: 'Enter a valid number (min 1)' }); return; }
    const draftIds = selectedTestCaseIds.filter((id) => isDraftId(id));
    const savedIds = selectedTestCaseIds.filter((id) => !isDraftId(id));
    if (draftIds.length > 0) {
      setPendingDraftTestCases((prev) =>
        prev.map((t) => (draftIds.includes(t.id) ? { ...t, tryCount: num } : t))
      );
    }
    if (savedIds.length > 0) bulkUpdateTryCount(savedIds, num);
    setBulkTryCount('');
    addToast({ type: 'success', message: `Set try count to ${num} for ${selectedTestCaseIds.length} test case(s)` });
  };
  const handleDeleteSelectedTestCases = () => {
    if (selectedTestCaseIds.length === 0) {
      addToast({ type: 'warning', message: 'Select at least one row to remove from this table' });
      return;
    }
    if (selectedTestCaseIds.some((tid) => isTcStorePending(tid))) {
      addToast({ type: 'info', message: 'Please wait for the current action to finish on the selected test case(s).' });
      return;
    }
    const selectedTcs = displayedSavedTestCases.filter((t) => selectedTestCaseIds.includes(t.id));
    const inUse = selectedTcs.filter((tc) => {
      if (isDraftId(tc.id)) return false;
      const v = (tc.vcdName || '').trim();
      const b = (tc.binName || '').trim();
      const l = (tc.linName || '').trim();
      return (v && fileNamesInUseByBatch.has(v)) || (b && fileNamesInUseByBatch.has(b)) || (l && fileNamesInUseByBatch.has(l));
    });
    if (inUse.length > 0) {
      addToast({
        type: 'warning',
        message: `${inUse.length} selected saved test case(s) use files in a running or pending set. Wait for the job to finish before removing them from the library.`,
      });
      return;
    }
    const nDel = selectedTestCaseIds.length;
    selectedTestCaseIds.forEach((id) => removeDisplayedTestCase(id));
    setSelectedTestCaseIds([]);
    addToast({
      type: 'success',
      message: `Removed ${nDel} row(s) from this table. Nothing was deleted from the File / Test Case library unless you removed saved rows.`,
    });
  };

  const reorderList = (arr, fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= arr.length || toIndex >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(fromIndex, 1);
    next.splice(fromIndex < toIndex ? toIndex - 1 : toIndex, 0, item);
    return next;
  };
  const handleRowDragStart = (e, index) => {
    const row = displayedSavedTestCases[index];
    if (row && isTcStorePending(row.id)) return;
    draggingRowIndexRef.current = index;
    setDraggingRowIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };
  const handleRowDragOver = (e, index) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetRowIndex(index); };
  const handleRowDrop = (e, toIndex) => {
    e.preventDefault();
    const fromIndex = draggingRowIndexRef.current;
    if (fromIndex == null || isViewingShared) {
      draggingRowIndexRef.current = null;
      setDraggingRowIndex(null);
      setDropTargetRowIndex(null);
      return;
    }
    const list = displayedSavedTestCases;
    if (list.length === 0) return;
    const reordered = reorderList([...list], fromIndex, toIndex);
    if (loadedSetId) {
      reorderSavedTestCases(fromIndex, toIndex);
    } else {
      setPendingDraftTestCases(reordered);
    }
    draggingRowIndexRef.current = null;
    setDraggingRowIndex(null);
    setDropTargetRowIndex(null);
  };
  const moveDisplayedTestCaseUp = (tcId) => {
    if (loadedSetId) {
      moveSavedTestCaseUp(tcId);
      return;
    }
    setPendingDraftTestCases((prev) => {
      const i = prev.findIndex((t) => t.id === tcId);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  };
  const moveDisplayedTestCaseDown = (tcId) => {
    if (loadedSetId) {
      moveSavedTestCaseDown(tcId);
      return;
    }
    setPendingDraftTestCases((prev) => {
      const i = prev.findIndex((t) => t.id === tcId);
      if (i < 0 || i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  };
  const handleRowDragEnd = () => { draggingRowIndexRef.current = null; setDraggingRowIndex(null); setDropTargetRowIndex(null); };

  const handleCsvFileInput = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length < 2) {
        addToast({ type: 'warning', message: 'CSV must have at least 1 data row' });
        return;
      }
      const headerRaw = lines[0].split(',').map((h) => h.trim());
      const header = headerRaw.map((h) => h.toLowerCase());
      const knownKeys = new Set(['name', 'testcase', 'test_case', 'vcd', 'bin', 'erom', 'firmware', 'lin', 'ulp', 'try', 'tries', 'retry', 'tag']);
      const extraColumnIndices = header
        .map((h, idx) => ({ key: headerRaw[idx] || h, idx }))
        .filter(({ key }) => {
          const k = (key || '').trim().toLowerCase();
          return k && !knownKeys.has(k);
        });

      const idxName = header.findIndex((h) => h === 'name' || h === 'testcase' || h === 'test_case');
      const idxVcd = header.findIndex((h) => h === 'vcd');
      const idxBin = header.findIndex((h) => h === 'bin' || h === 'erom' || h === 'firmware');
      const idxLin = header.findIndex((h) => h === 'lin' || h === 'ulp');
      const idxTry = header.findIndex((h) => h === 'try' || h === 'tries' || h === 'retry');

      if (idxVcd === -1 || idxBin === -1 || idxLin === -1) {
        addToast({ type: 'error', message: 'CSV must have VCD, BIN/EROM, and ULP (or LIN) columns' });
        return;
      }

      const existingNames = new Set(
        useTestStore.getState().getAllGlobalTestCaseNames(null, {
          extraTestCaseLists: [pendingDraftTestCases],
        })
      );
      const created = [];

      const makeUniqueName = (baseRaw) => {
        const baseInitial = (baseRaw || 'Test case').trim() || 'Test case';
        let name = baseInitial;
        if (!existingNames.has(name)) {
          existingNames.add(name);
          return name;
        }
        let n = 2;
        while (existingNames.has(`${baseInitial} (${n})`)) n++;
        name = `${baseInitial} (${n})`;
        existingNames.add(name);
        return name;
      };

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (!cols.some((c) => c.trim() !== '')) continue;
        const vcdName = (cols[idxVcd] || '').trim();
        const binName = (cols[idxBin] || '').trim();
        const linName = (cols[idxLin] || '').trim();
        if (!vcdName || !binName || !linName) continue;
        const rawName = idxName >= 0 ? cols[idxName] : vcdName;
        const name = makeUniqueName(rawName);
        let tryCount = 1;
        if (idxTry >= 0) {
          const parsed = parseInt(cols[idxTry], 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
            tryCount = parsed;
          }
        }
        const extraColumns = {};
        extraColumnIndices.forEach(({ key, idx }) => {
          const val = (cols[idx] || '').trim();
          if (key) extraColumns[key] = val;
        });
        created.push({
          id: loadedSetId ? `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` : `tc-draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name,
          vcdName,
          binName,
          linName: linName || '',
          tryCount,
          createdAt: new Date().toISOString(),
          ...(Object.keys(extraColumns).length > 0 ? { extraColumns } : {}),
        });
      }

      if (created.length === 0) {
        addToast({ type: 'warning', message: 'No rows in CSV have VCD, BIN/EROM, and ULP/LIN (all three required)' });
        return;
      }

      if (loadedSetId) {
        const nextList = [...(loadedSetTable || []), ...created];
        setSavedTestCases(nextList);
      } else {
        setPendingDraftTestCases((prev) => [...prev, ...created]);
      }
      setSetupClearedPersisted(activeProfileId, false);
      setTableClearedMode(false);
      let msg = `Imported ${created.length} test case(s) from CSV (names made unique)`;
      if (extraColumnIndices.length > 0) {
        msg += ` — ${extraColumnIndices.length} extra column(s) added: ${extraColumnIndices.map((x) => x.key).join(', ')}`;
      }
      addToast({ type: 'success', message: msg });
    } catch (err) {
      addToast({ type: 'error', message: `Failed to read CSV: ${err.message}` });
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const exportTestCasesCsv = () => {
    const rows = displayedSavedTestCases || [];
    if (rows.length === 0) {
      addToast({ type: 'warning', message: 'No test cases to export' });
      return;
    }

    const extraKeys = Array.from(
      rows.reduce((acc, tc) => {
        const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
        Object.keys(extra).forEach((k) => {
          const key = (k || '').trim();
          if (key) acc.add(key);
        });
        return acc;
      }, new Set())
    );

    const headers = ['Name', 'Tag', 'Date', 'ERoM', 'ULP', 'VCD', 'Try', ...extraKeys];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.map(esc).join(',')];

    rows.forEach((tc) => {
      const base = [
        tc.name || '',
        tc.tag || '',
        (tc.updatedAt || tc.createdAt) ? String(tc.updatedAt || tc.createdAt).slice(0, 10) : '',
        tc.binName || '',
        tc.linName || '',
        tc.vcdName || '',
        typeof tc.tryCount === 'number' && tc.tryCount > 0 ? tc.tryCount : 1,
      ];
      const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? tc.extraColumns : {};
      const extraValues = extraKeys.map((k) => extra[k] ?? '');
      lines.push([...base, ...extraValues].map(esc).join(','));
    });

    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test_cases_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: `Exported ${rows.length} test case(s) to CSV` });
  };

  const handleSaveToLibrary = async () => {
    const toSave = pendingDraftTestCases || [];
    if (toSave.length === 0 && (savedTestCases?.length || 0) === 0) {
      addToast({ type: 'warning', message: 'No test cases to save' });
      return;
    }
    if (toSave.length > 0) {
      const bad = toSave.filter((tc) => !isTestCasePrimaryFileSetComplete(tc));
      if (bad.length > 0) {
        const names = bad.map((t) => String(t.name || '—').trim() || '—').slice(0, 5);
        addToast({
          type: 'warning',
          message: `แต่ละ test case ต้องมี VCD, ERoM และ ULP ให้ครบ — กรุณาเลือกไฟล์ (${bad.length} แถว): ${names.join(', ')}${bad.length > 5 ? '…' : ''}`,
        });
        return;
      }
    }
    // Upload any dropped-but-not-yet-uploaded files first; compare by checksum so duplicates are not re-uploaded
    const toUpload = (localDroppedFiles || []).filter((f) => f && f.file instanceof File);
    if (toUpload.length > 0) {
      await refreshFiles?.();
      const currentFiles = useTestStore.getState().uploadedFiles || [];
      const byChecksum = new Map(
        currentFiles
          .filter((f) => f.checksum)
          .map((f) => [f.checksum, f])
      );
      const byName = new Map(currentFiles.map((f) => [f.name.toLowerCase(), f]));
      const prepared = [];
      for (const f of toUpload) {
        const sig = await computeFileSignature(f.file);
        const existingByChecksum = sig.checksum ? byChecksum.get(sig.checksum) : null;
        const existingByName = byName.get((f.file.name || '').toLowerCase());
        prepared.push({ file: f.file, sig, existing: existingByChecksum || existingByName });
      }
      const duplicates = prepared.filter((p) => p.existing);
      if (duplicates.length > 0) {
        setSaveLibraryUploadModal({ prepared, toSave });
        return;
      }
      let uploaded = 0;
      for (const p of prepared) {
        const result = await addUploadedFile(p.file);
        if (result) uploaded++;
      }
      setLocalDroppedFiles([]);
      if (refreshFiles) await refreshFiles();
      if (uploaded > 0) addToast({ type: 'success', message: `${uploaded} file(s) uploaded to library` });
    }
    if (toSave.length > 0) {
      // Prevent duplicates by:
      // - identical full file-set (VCD/ERoM/ULP + extra VCD2/ERoM2/ULP2/MDI..)
      // - identical name (global)
      const stateNow = useTestStore.getState();
      const localSaved = Array.isArray(stateNow.savedTestCases) ? stateNow.savedTestCases : [];
      const globalSaved = Array.isArray(stateNow.globalSavedTestCases) ? stateNow.globalSavedTestCases : [];
      const existingSaved = [...localSaved, ...globalSaved];
      const existingByKey = new Map(
        existingSaved.map((t) => [getFullTestCaseFileKeyFromMerged(t, mergeCommandsIntoExtraForSave(t)), t])
      );
      const usedNames = stateNow.getAllGlobalTestCaseNames(null, { extraTestCaseLists: [] });
      const skipped = []; // { reason, tcName?, existingId?, existingName? }
      const created = [];
      toSave.forEach((tc) => {
        const { id, commands, ...rest } = tc;
        const nm = String(rest?.name || '').trim();
        if (nm && usedNames.has(nm)) {
          skipped.push({ reason: 'name', tcName: nm });
          return;
        }
        const extraColumns = mergeCommandsIntoExtraForSave(tc);
        const key = getFullTestCaseFileKeyFromMerged(rest, extraColumns);
        const existing = existingByKey.get(key);
        if (existing) {
          skipped.push({
            reason: 'files',
            tcName: nm,
            existingId: String(existing?.id || ''),
            existingName: String(existing?.name || '').trim() || String(existing?.id || ''),
          });
          return;
        }
        const newId = addSavedTestCase({
          ...rest,
          extraColumns: Object.keys(extraColumns).length ? extraColumns : undefined,
        });
        // addSavedTestCase can still refuse identical saves (safety net) and return existing id.
        if (localSaved.some((t) => String(t.id) === String(newId)) || globalSaved.some((t) => String(t.id) === String(newId))) {
          skipped.push({ reason: 'files', tcName: nm, existingId: String(newId), existingName: String(newId) });
        } else {
          created.push(newId);
        }
      });
      // Only clear drafts if we actually created something (otherwise user can fix & retry)
      if (created.length > 0) {
        setPendingDraftTestCases([]);
        setTableClearedMode(true);
        setSetupClearedPersisted(activeProfileId, true);
        setSelectedTestCaseIds([]);
      }
      if (refreshFiles) await refreshFiles();
      const total = useTestStore.getState().savedTestCases?.length || 0;
      if (created.length > 0) {
        addToast({ type: 'success', message: `Test cases saved to library (${total} case(s))` });
        const skippedFiles = skipped.filter((s) => s.reason === 'files');
        const skippedNames = skipped.filter((s) => s.reason === 'name');
        if (skippedFiles.length > 0) {
          const names = [...new Set(skippedFiles.map((s) => s.existingName).filter(Boolean))].slice(0, 3);
          addToast({
            type: 'info',
            message: `${skippedFiles.length} test case(s) duplicate file-set — matches: ${names.join(', ')}${skippedFiles.length > names.length ? ' …' : ''}`,
          });
        }
        if (skippedNames.length > 0) {
          addToast({ type: 'warning', message: `${skippedNames.length} test case(s) have duplicate names — please rename before saving` });
        }
      } else if (skipped.length > 0) {
        const skippedFiles = skipped.filter((s) => s.reason === 'files');
        const skippedNames = skipped.filter((s) => s.reason === 'name');
        if (skippedFiles.length > 0 && skippedNames.length === 0) {
          const names = [...new Set(skippedFiles.map((s) => s.existingName).filter(Boolean))].slice(0, 3);
          addToast({
            type: 'info',
            message: `Duplicate file-set — matches: ${names.join(', ')}${skippedFiles.length > names.length ? ' …' : ''}`,
          });
        } else if (skippedNames.length > 0 && skippedFiles.length === 0) {
          addToast({ type: 'warning', message: `All ${skippedNames.length} test case(s) have duplicate names — rename to save` });
        } else {
          addToast({ type: 'warning', message: `No new entries created — some are duplicate names and some are duplicate file-sets` });
        }

        // Pointer: auto-select the duplicate TC checkbox (if it exists in current table)
        if (skippedFiles.length > 0) {
          const first = skippedFiles.find((s) => s.existingId) || null;
          if (first?.existingId) {
            const found = (displayedSavedTestCases || []).find((t) => String(t.id) === String(first.existingId));
            if (found) {
              setSelectedTestCaseIds([found.id]);
              setDuplicateHighlightIds([found.id]);
              queueMicrotask(() => {
                try {
                  const el = document.querySelector(`[data-tc-row-id="${String(found.id)}"]`);
                  if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                  }
                } catch {
                  // ignore
                }
              });
            }
            setTestCaseLibraryFocusOnNavigate({
              name: first.existingName || '',
              vcdName: found?.vcdName || '',
              binName: found?.binName || '',
              linName: found?.linName || '',
            });
          }
        }
      }
    } else {
      if (refreshFiles) await refreshFiles();
      const total = useTestStore.getState().savedTestCases?.length || 0;
      addToast({ type: 'success', message: `Library updated (${total} test case(s))` });
    }

    if (sendToRunSetAfterSaveRef.current) {
      sendToRunSetAfterSaveRef.current = false;
      const items = Array.isArray(sendToRunSetItemsRef.current) ? sendToRunSetItemsRef.current : toSave;
      sendToRunSetItemsRef.current = null;
      doSendToRunSet(items, 'Saved & run from Test Cases');
    } else {
      // Continuous workflow: after user saves to Library, jump back to Library (Step 2).
      onNavigateBackToLibrary?.();
    }
  };

  const handleSaveAndSendToRunSet = async () => {
    const pending = pendingDraftTestCases || [];
    const fallback = displayedSavedTestCases || [];
    const itemsToSend = pending.length > 0 ? pending : fallback;
    if (!itemsToSend.length) {
      addToast({ type: 'warning', message: 'No test cases to save/send' });
      return;
    }
    if (pending.length > 0) {
      sendToRunSetAfterSaveRef.current = true;
      sendToRunSetItemsRef.current = itemsToSend;
      await handleSaveToLibrary();
      return;
    }
    doSendToRunSet(itemsToSend, 'Send from Test Cases');
  };

  /** Same rules as File Library Files tab: Vis=close from store + API visibility */
  const isBrowseFileVisClosed = useCallback(
    (f) => {
      const vis = String(fileVisById?.[f?.id] || f?.visibility || 'open').toLowerCase();
      return vis === 'close' || vis === 'closed' || vis === 'lock' || vis === 'locked' || vis === 'private';
    },
    [fileVisById]
  );

  const libraryPickerPickNameOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (uploadedFiles || []).forEach((f) => pushLibraryPickerSuggestOpt(out, seen, f?.name));
    return out.sort((a, b) => a.localeCompare(b)).slice(0, 120);
  }, [uploadedFiles]);

  const libraryPickerPickTagOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const fm = fileTags || {};
    Object.keys(fm).forEach((kid) =>
      splitTags(String(fm[kid] || '')).forEach((t) => pushLibraryPickerSuggestOpt(out, seen, t))
    );
    return out.sort((a, b) => a.localeCompare(b)).slice(0, 150);
  }, [fileTags]);

  const libraryPickerPickSizeOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (uploadedFiles || []).forEach((f) =>
      pushLibraryPickerSuggestOpt(out, seen, f.sizeFormatted ?? f.size ?? '')
    );
    return out.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).slice(0, 80);
  }, [uploadedFiles]);

  const libraryPickerPickOwnerOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (uploadedFiles || []).forEach((f) => {
      pushLibraryPickerSuggestOpt(out, seen, resolveFileOwnerDisplay(f, ownerLabelCtx));
      pushLibraryPickerSuggestOpt(out, seen, f?.ownerId);
    });
    return out.sort((a, b) => a.localeCompare(b)).slice(0, 80);
  }, [uploadedFiles, ownerLabelCtx]);

  const libraryPickerPickDateOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (uploadedFiles || []).forEach((f) => {
      const raw = f.updatedAt || f.uploadDate || f.createdAt || '';
      const d = raw ? new Date(raw) : null;
      if (d && !Number.isNaN(d.getTime())) {
        pushLibraryPickerSuggestOpt(
          out,
          seen,
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        );
      }
    });
    return out.sort((a, b) => b.localeCompare(a)).slice(0, 100);
  }, [uploadedFiles]);

  const toggleLibraryPickerSuggest = useCallback((field, rootEl) => {
    const rect = rootEl?.getBoundingClientRect?.();
    setLibraryPickerSuggest((prev) => {
      if (prev?.field === field) return null;
      if (!rect) return null;
      return { field, rect };
    });
  }, []);

  useEffect(() => {
    if (!libraryPickerOpen) setLibraryPickerSuggest(null);
  }, [libraryPickerOpen]);

  useEffect(() => {
    if (!libraryPickerSuggest) return;
    const onDown = (e) => {
      if (e.target?.closest?.('[data-lib-picker-suggest-pop]')) return;
      if (e.target?.closest?.('[data-library-picker-filter-root]')) return;
      setLibraryPickerSuggest(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setLibraryPickerSuggest(null);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [libraryPickerSuggest]);

  const libraryPickerSuggestOptions =
    libraryPickerSuggest?.field === 'name'
      ? libraryPickerPickNameOptions
      : libraryPickerSuggest?.field === 'tag'
        ? libraryPickerPickTagOptions
        : libraryPickerSuggest?.field === 'size'
          ? libraryPickerPickSizeOptions
          : libraryPickerSuggest?.field === 'owner'
            ? libraryPickerPickOwnerOptions
            : libraryPickerSuggest?.field === 'date'
              ? libraryPickerPickDateOptions
              : [];

  const libraryPickerFiles = useMemo(() => {
    const list = uploadedFiles || [];
    const nameQ = libraryPickerNameQ.trim().toLowerCase();
    const tagQ = libraryPickerTagQ.trim().toLowerCase();
    const sizeQ = libraryPickerSizeQ.trim().toLowerCase();
    const ownerQ = libraryPickerOwnerQ.trim().toLowerCase();
    const dateQ = libraryPickerDateQ.trim().toLowerCase();

    return list.filter((f) => {
      if (nameQ && !String(f.name || '').toLowerCase().includes(nameQ)) return false;
      if (tagQ) {
        const tags = splitTags((fileTags && fileTags[f.id]) || '');
        if (!tags.some((t) => t.toLowerCase().includes(tagQ))) return false;
      }
      if (sizeQ) {
        const n = normalizeFileSizeBytes(f.size);
        const sizeTxt = String(f.sizeFormatted || f.size || '').toLowerCase();
        if (!sizeTxt.includes(sizeQ) && !String(n).includes(sizeQ)) return false;
      }
      if (ownerQ) {
        const ownerDisplay = resolveFileOwnerDisplay(f, ownerLabelCtx).toLowerCase();
        const ownerId = String(f.ownerId || '').toLowerCase();
        if (!ownerDisplay.includes(ownerQ) && !ownerId.includes(ownerQ)) return false;
      }
      if (dateQ) {
        const lastModified = f.updatedAt || f.uploadDate || f.createdAt || null;
        const timeStr = lastModified ? String(lastModified).replace('T', ' ').toLowerCase() : '';
        if (!timeStr.includes(dateQ)) return false;
      }
      return true;
    });
  }, [
    uploadedFiles,
    fileTags,
    libraryPickerNameQ,
    libraryPickerTagQ,
    libraryPickerSizeQ,
    libraryPickerOwnerQ,
    libraryPickerDateQ,
    ownerLabelCtx,
  ]);

  const libraryPickerSelectableIds = useMemo(
    () =>
      libraryPickerFiles
        .filter((f) => !fileNamesInUseByBatch.has(f.name) && !isBrowseFileVisClosed(f))
        .map((f) => f.id)
        .filter(Boolean),
    [libraryPickerFiles, fileNamesInUseByBatch, isBrowseFileVisClosed]
  );

  return (
    <div className="w-full max-w-none min-w-0 flex flex-1 flex-col min-h-0 space-y-4">
      <UploadChoiceModal
        open={!!saveLibraryUploadModal?.prepared?.length}
        prepared={saveLibraryUploadModal?.prepared ?? []}
        onConfirm={handleSaveLibraryUploadChoiceConfirm}
        onCancel={() => setSaveLibraryUploadModal(null)}
      />
      {commandMenuPopover &&
        typeof window !== 'undefined' &&
        typeof document !== 'undefined' &&
        createPortal(
          (() => {
            const MENU_W = 192;
            const MENU_H_ALLOW = 160;
            const { anchor, tcId } = commandMenuPopover;
            let top = anchor.bottom + 6;
            let left = anchor.right - MENU_W;
            left = Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8));
            if (top + MENU_H_ALLOW > window.innerHeight - 8) {
              top = Math.max(8, anchor.top - MENU_H_ALLOW - 8);
            }
            const itemCls =
              'w-full text-left px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-50 hover:bg-slate-100 dark:hover:bg-slate-700';
            return (
              <div
                data-command-menu-portal
                role="menu"
                className="fixed z-[250] py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-xl min-w-[180px]"
                style={{ top, left, width: MENU_W }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    addDisplayedTestCaseCommand(tcId, { type: 'mdi', file: '' });
                    setCommandMenuPopover(null);
                  }}
                  className={itemCls}
                >
                  Add MDI (text file)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    addDisplayedTestCaseCommand(tcId, { type: 'erom', file: '' });
                    setCommandMenuPopover(null);
                  }}
                  className={itemCls}
                >
                  Add EROM
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    addDisplayedTestCaseCommand(tcId, { type: 'ulp', file: '' });
                    setCommandMenuPopover(null);
                  }}
                  className={itemCls}
                >
                  Add ULP
                </button>
              </div>
            );
          })(),
          document.body
        )}
      {libraryPickerOpen && (
        <>
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/50"
          onClick={() => {
            setLibraryPickerOpen(false);
            setLibraryPickerTagOverflowFileId(null);
            setLibraryPickerTcOverflowFileName(null);
            setLibraryPickerSetsOverflowFileName(null);
            setTcTagOverflowTcId(null);
            setTcTagModalAddDraft('');
            setTcTagModalEditIndex(null);
            setTcTagModalEditDraft('');
            setTcTagPlusInputTcId(null);
            setLibraryPickerSuggest(null);
          }}
          role="presentation"
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-600 w-full max-w-6xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-picker-title"
          >
            <div className="p-4 border-b border-slate-200 dark:border-slate-600 shrink-0">
              <h3 id="library-picker-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">
                Select File from Library
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-3">
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</span>
                  <div className="relative" data-library-picker-filter-root>
                    <input
                      type="text"
                      value={libraryPickerNameQ}
                      onChange={(e) => setLibraryPickerNameQ(e.target.value)}
                      placeholder="Search name…"
                      className="w-full px-2.5 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      aria-label="Suggestions"
                      title="Suggestions"
                      className="absolute right-0.5 top-1/2 z-[1] -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLibraryPickerSuggest('name', e.currentTarget.parentElement);
                      }}
                    >
                      <ChevronDown className="w-3.5 h-3.5 pointer-events-none" strokeWidth={2} />
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tag</span>
                  <div className="relative" data-library-picker-filter-root>
                    <input
                      type="text"
                      value={libraryPickerTagQ}
                      onChange={(e) => setLibraryPickerTagQ(e.target.value)}
                      placeholder="Search tag…"
                      className="w-full px-2.5 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      aria-label="Suggestions"
                      title="Suggestions"
                      className="absolute right-0.5 top-1/2 z-[1] -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLibraryPickerSuggest('tag', e.currentTarget.parentElement);
                      }}
                    >
                      <ChevronDown className="w-3.5 h-3.5 pointer-events-none" strokeWidth={2} />
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Size</span>
                  <div className="relative" data-library-picker-filter-root>
                    <input
                      type="text"
                      value={libraryPickerSizeQ}
                      onChange={(e) => setLibraryPickerSizeQ(e.target.value)}
                      placeholder="e.g. 154, kb…"
                      className="w-full px-2.5 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      aria-label="Suggestions"
                      title="Suggestions"
                      className="absolute right-0.5 top-1/2 z-[1] -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLibraryPickerSuggest('size', e.currentTarget.parentElement);
                      }}
                    >
                      <ChevronDown className="w-3.5 h-3.5 pointer-events-none" strokeWidth={2} />
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner</span>
                  <div className="relative" data-library-picker-filter-root>
                    <input
                      type="text"
                      value={libraryPickerOwnerQ}
                      onChange={(e) => setLibraryPickerOwnerQ(e.target.value)}
                      placeholder="profile name…"
                      className="w-full px-2.5 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      aria-label="Suggestions"
                      title="Suggestions"
                      className="absolute right-0.5 top-1/2 z-[1] -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLibraryPickerSuggest('owner', e.currentTarget.parentElement);
                      }}
                    >
                      <ChevronDown className="w-3.5 h-3.5 pointer-events-none" strokeWidth={2} />
                    </button>
                  </div>
                </label>
                <label className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date</span>
                  <div className="relative" data-library-picker-filter-root>
                    <input
                      type="text"
                      value={libraryPickerDateQ}
                      onChange={(e) => setLibraryPickerDateQ(e.target.value)}
                      placeholder="2026-03-19…"
                      className="w-full px-2.5 py-1.5 pr-8 text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      aria-label="Suggestions"
                      title="Suggestions"
                      className="absolute right-0.5 top-1/2 z-[1] -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLibraryPickerSuggest('date', e.currentTarget.parentElement);
                      }}
                    >
                      <ChevronDown className="w-3.5 h-3.5 pointer-events-none" strokeWidth={2} />
                    </button>
                  </div>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => setLibraryPickerSelectedIds([...libraryPickerSelectableIds])}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  title="Same as File Library: skips Vis=close and files in running/pending jobs"
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryPickerSelectedIds([])}
                  className="text-xs font-semibold text-slate-500 hover:underline"
                >
                  Clear selection
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLibraryPickerNameQ('');
                    setLibraryPickerTagQ('');
                    setLibraryPickerSizeQ('');
                    setLibraryPickerOwnerQ('');
                    setLibraryPickerDateQ('');
                  }}
                  className="text-xs font-semibold text-slate-500 hover:underline"
                >
                  Clear filters
                </button>
              </div>
            </div>
            <div
              className="overflow-auto flex-1 min-h-[140px] border-t border-slate-100 dark:border-slate-700"
              title="Click and drag across rows to select multiple files"
            >
              {libraryPickerFiles.length === 0 ? (
                <p className="text-sm text-slate-500 p-6 text-center">No files match the current filters</p>
              ) : (
                <table className="w-full text-left text-xs border-collapse select-none">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-600">
                    <tr className="text-slate-600 dark:text-slate-300">
                      <th className="w-10 px-2 py-2 font-semibold">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-2 py-2 font-semibold min-w-[140px]">Name</th>
                      <th className="px-2 py-2 font-semibold min-w-[120px]">Tags</th>
                      <th className="px-2 py-2 font-semibold min-w-[100px]">Used by TC</th>
                      <th
                        className="px-2 py-2 font-semibold min-w-[120px]"
                        title="Saved sets that reference this file (color follows job status when available)"
                      >
                        Sets
                      </th>
                      <th className="px-2 py-2 font-semibold w-16">Owner</th>
                      <th className="px-2 py-2 font-semibold w-10 text-center" title="Visibility">
                        Vis
                      </th>
                      <th
                        className="px-2 py-2 font-semibold min-w-[120px]"
                        title="Calendar date modified; hover a cell for full timestamp"
                      >
                        Date
                      </th>
                      <th className="px-2 py-2 font-semibold w-20 text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {libraryPickerFiles.map((f) => {
                      const tagVal = (fileTags && fileTags[f.id]) || '';
                      const tags = splitTags(tagVal);
                      const fileTagColorKey = (fileTagColors && fileTagColors[f.id]) || 'mint';
                      const displayName = (fileDisplayNames && fileDisplayNames[f.id]) || (String(f.name || '').split('/').pop() || f.name);
                      const usedByTcs = getTestCasesUsingFile(f.name, fileReferenceTestCases, fileReferenceTestCaseSets);
                      const setNames = getSetNamesUsingFile(f.name, fileReferenceTestCaseSets);
                      const lastModified = f.updatedAt || f.uploadDate || f.createdAt || null;
                      const ownerShort = resolveFileOwnerDisplay(f, ownerLabelCtx);
                      const inUseByBatch = fileNamesInUseByBatch.has(f.name);
                      const isFileClosed = isBrowseFileVisClosed(f);
                      return (
                        <tr
                          key={f.id}
                          className={`text-slate-800 dark:text-slate-100 ${
                            isFileClosed ? 'opacity-75 bg-slate-50/50 dark:bg-slate-800/30 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-default'
                          }`}
                          onMouseDown={(e) => {
                            if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;
                            if (isFileClosed) return;
                            if (e.button !== 0) return;
                            e.preventDefault();
                            libraryPickerDragSelectRef.current = true;
                            setLibraryPickerSelectedIds((prev) => (prev.includes(f.id) ? prev : [...prev, f.id]));
                          }}
                          onMouseEnter={() => {
                            if (isFileClosed) return;
                            if (!libraryPickerDragSelectRef.current) return;
                            setLibraryPickerSelectedIds((prev) => (prev.includes(f.id) ? prev : [...prev, f.id]));
                          }}
                        >
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="checkbox"
                              checked={libraryPickerSelectedIds.includes(f.id)}
                              disabled={isFileClosed}
                              onChange={() => {
                                if (isFileClosed) return;
                                setLibraryPickerSelectedIds((prev) =>
                                  prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]
                                );
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={`w-4 h-4 rounded border-slate-300 text-blue-600 ${isFileClosed ? 'cursor-not-allowed opacity-50' : ''}`}
                              aria-label={`Select ${f.name}`}
                              title={isFileClosed ? 'Vis=close — not selectable (same as File Library)' : undefined}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <span className="font-medium break-all" title={f.name}>
                              {displayName}
                            </span>
                            {displayName !== f.name && (
                              <div className="text-[10px] text-slate-400 truncate" title={f.name}>
                                {String(f.name || '').split('/').pop() || f.name}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <div className="flex flex-wrap items-center gap-0.5">
                              {tags.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <>
                                  {tags.slice(0, 1).map((t, ti) => (
                                    <span
                                      key={`${f.id}-t-${ti}`}
                                      className={`px-1 py-0.5 rounded-full text-[10px] font-semibold border ${jobTagPillClasses(fileTagColorKey)}`}
                                      title={t}
                                    >
                                      {t}
                                    </span>
                                  ))}
                                  {tags.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLibraryPickerTcOverflowFileName(null);
                                        setLibraryPickerTagOverflowFileId(f.id);
                                        setLibraryPickerSetsOverflowFileName(null);
                                      }}
                                      className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                      title="Show all tags"
                                    >
                                      …
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <div className="flex flex-wrap items-center gap-0.5">
                              {usedByTcs.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <>
                                  {usedByTcs.slice(0, 3).map((u, idx) => (
                                    <span
                                      key={`${f.id}-tc-${idx}-${u.name}-${u.set || ''}`}
                                      className="px-1 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
                                      title={u.set ? `${u.name} (${u.set})` : u.name}
                                    >
                                      {u.name}
                                    </span>
                                  ))}
                                  {usedByTcs.length > 3 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLibraryPickerTagOverflowFileId(null);
                                        setLibraryPickerTcOverflowFileName(f.name);
                                        setLibraryPickerSetsOverflowFileName(null);
                                      }}
                                      className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                      title={usedByTcs.map((u) => (u.set ? `${u.name} (${u.set})` : u.name)).join('\n')}
                                    >
                                      …
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <div className="flex flex-wrap items-center gap-0.5">
                              {setNames.length === 0 ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <>
                                  {setNames.slice(0, 3).map((sn) => {
                                    const st = setStatusByName.get(sn) ?? null;
                                    return (
                                      <span
                                        key={`${f.id}-setchip-${sn}`}
                                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border max-w-[140px] truncate ${getSetJobStatusPillClass(st)}`}
                                        title={st ? `${sn} — job: ${st}` : `${sn} — no active job`}
                                      >
                                        {sn}
                                      </span>
                                    );
                                  })}
                                  {setNames.length > 3 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLibraryPickerTagOverflowFileId(null);
                                        setLibraryPickerTcOverflowFileName(null);
                                        setLibraryPickerSetsOverflowFileName(f.name);
                                      }}
                                      className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                                      title={`All sets: ${setNames.join(', ')}`}
                                    >
                                      …
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 align-top text-slate-600 dark:text-slate-300" title={f.ownerId ? String(f.ownerId) : ''}>
                            {ownerShort}
                          </td>
                          <td className="px-2 py-1.5 align-top text-center text-slate-400">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (inUseByBatch) {
                                  addToast({
                                    type: 'warning',
                                    message: 'This file is locked by a running or pending set — cannot change Vis',
                                  });
                                  return;
                                }
                                const nextClosed = !isFileClosed;
                                setFileVisById((prev) => ({ ...prev, [f.id]: nextClosed ? 'close' : 'open' }));
                                setLibraryPickerSelectedIds((prev) => prev.filter((id) => id !== f.id));
                              }}
                              className={`inline-flex items-center justify-center p-1 rounded ${
                                inUseByBatch
                                  ? 'text-blue-500 hover:bg-blue-500/10 cursor-not-allowed opacity-80'
                                  : isFileClosed
                                    ? 'text-amber-500 hover:bg-amber-500/10'
                                    : 'text-slate-400 hover:bg-slate-500/10'
                              }`}
                              title={
                                inUseByBatch
                                  ? 'Locked by system (running/pending)'
                                  : isFileClosed
                                    ? 'Closed — click to open/selectable'
                                    : 'Open — click to close/lock from select all'
                              }
                            >
                              {inUseByBatch ? <Lock size={14} className="inline" /> : isFileClosed ? <Lock size={14} className="inline" /> : <Globe size={14} className="inline" />}
                            </button>
                          </td>
                          <td className="px-2 py-1.5 align-top whitespace-nowrap text-slate-500 dark:text-slate-400" title={lastModified ? String(lastModified) : ''}>
                            {(() => {
                              if (!lastModified) return '—';
                              const d = new Date(lastModified);
                              if (Number.isNaN(d.getTime())) return '—';
                              return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                            })()}
                          </td>
                          <td className="px-2 py-1.5 align-top text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {f.sizeFormatted ?? f.size ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-600 flex flex-wrap justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setLibraryPickerOpen(false);
                  setLibraryPickerTagOverflowFileId(null);
                  setLibraryPickerTcOverflowFileName(null);
                  setTcTagOverflowTcId(null);
                  setTcTagModalAddDraft('');
                  setTcTagModalEditIndex(null);
                  setTcTagModalEditDraft('');
                  setTcTagPlusInputTcId(null);
                  setLibraryPickerSuggest(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (libraryPickerSelectedIds.length === 0) {
                    addToast({ type: 'info', message: 'Select at least 1 file' });
                    return;
                  }
                  runLibraryGroupingFromFileIds(libraryPickerSelectedIds);
                  setLibraryPickerOpen(false);
                  setLibraryPickerTagOverflowFileId(null);
                  setLibraryPickerTcOverflowFileName(null);
                  setTcTagOverflowTcId(null);
                  setTcTagModalAddDraft('');
                  setTcTagModalEditIndex(null);
                  setTcTagModalEditDraft('');
                  setTcTagPlusInputTcId(null);
                  setLibraryPickerNameQ('');
                  setLibraryPickerTagQ('');
                  setLibraryPickerSizeQ('');
                  setLibraryPickerOwnerQ('');
                  setLibraryPickerDateQ('');
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700"
              >
                Add and pair automatically
              </button>
            </div>
          </div>
        </div>
      {libraryPickerTagOverflowFileId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setLibraryPickerTagOverflowFileId(null)}
            role="presentation"
          />
          <div className="relative w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Tags</div>
              <button
                type="button"
                onClick={() => setLibraryPickerTagOverflowFileId(null)}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,320px)] overflow-y-auto">
              {(() => {
                const raw = (fileTags && fileTags[libraryPickerTagOverflowFileId]) || '';
                const allTags = splitTags(raw);
                return allTags.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">No tags</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((t, i) => (
                      <span
                        key={`browse-alltag-${libraryPickerTagOverflowFileId}-${i}-${t}`}
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold border ${jobTagPillClasses(
                          (fileTagColors && fileTagColors[libraryPickerTagOverflowFileId]) || 'mint'
                        )}`}
                      >
                        <span className="max-w-[360px] truncate" title={t}>{t}</span>
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {tcTagOverflowTcId !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setTcTagOverflowTcId(null);
              setTcTagModalAddDraft('');
              setTcTagModalEditIndex(null);
              setTcTagModalEditDraft('');
            }}
            role="presentation"
          />
          <div
            className="relative w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="test-case-tags-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap overflow-visible">
              <div
                id="test-case-tags-dialog-title"
                className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate"
              >
                Tags
              </div>
              {(() => {
                const hdr = displayedSavedTestCases.find((t) => String(t.id) === String(tcTagOverflowTcId));
                const hdrLocked = !hdr || isTestCaseInUseByBatch(hdr) || isViewingShared;
                const hdrRaw = (hdr?.extraColumns && (hdr.extraColumns.tag || hdr.extraColumns.Tag)) || '';
                const hdrTags = splitTags(hdrRaw);
                const displayKey = hdrTags.length
                  ? normalizeTagColorList(hdr?.extraColumns || {}, hdrTags.length)[0]
                  : TAG_PALETTE_MAP[hdr?.extraColumns?.tagColor || hdr?.extraColumns?.tag_color]
                    ? hdr?.extraColumns?.tagColor || hdr?.extraColumns?.tag_color
                    : 'mint';
                const safeDisplayKey = TAG_PALETTE_MAP[displayKey] ? displayKey : 'mint';
                if (hdrLocked) return null;
                return (
                  <>
                    <span
                      className="shrink-0 w-px h-5 self-center bg-slate-200 dark:bg-slate-600 mx-2"
                      aria-hidden
                    />
                    <TagColorSwatchPicker
                      size="sm"
                      value={safeDisplayKey}
                      menuZClass="z-[250]"
                      onChange={(k) => {
                        if (!hdr) return;
                        const r = (hdr.extraColumns && (hdr.extraColumns.tag || hdr.extraColumns.Tag)) || '';
                        const tagArr = splitTags(r);
                        const nextExtra = { ...(hdr.extraColumns || {}), tagColor: k };
                        if (tagArr.length) nextExtra.tagColorList = tagArr.map(() => k);
                        updateDisplayedTestCase(hdr.id, { extraColumns: nextExtra });
                      }}
                    />
                  </>
                );
              })()}
              <button
                type="button"
                onClick={() => {
                  setTcTagOverflowTcId(null);
                  setTcTagModalAddDraft('');
                  setTcTagModalEditIndex(null);
                  setTcTagModalEditDraft('');
                }}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                const otc = displayedSavedTestCases.find((t) => String(t.id) === String(tcTagOverflowTcId));
                if (!otc) {
                  return <div className="text-sm text-slate-500 dark:text-slate-400">—</div>;
                }
                const raw =
                  (otc.extraColumns && (otc.extraColumns.tag || otc.extraColumns.Tag)) || '';
                const allTags = splitTags(raw);
                const tagModalColorList = normalizeTagColorList(otc.extraColumns, allTags.length);
                const modalLocked = isTestCaseInUseByBatch(otc) || isViewingShared;
                const commitTcTagModalEdit = () => {
                  if (tcTagModalEditIndex == null) return;
                  const row = displayedSavedTestCases.find((x) => String(x.id) === String(tcTagOverflowTcId));
                  if (!row) {
                    setTcTagModalEditIndex(null);
                    setTcTagModalEditDraft('');
                    return;
                  }
                  const r =
                    (row.extraColumns && (row.extraColumns.tag || row.extraColumns.Tag)) || '';
                  const next = replaceTagAtIndexInRaw(r, tcTagModalEditIndex, tcTagModalEditDraft);
                  handleExtraColumnChange(row.id, 'tag', next);
                  setTcTagModalEditIndex(null);
                  setTcTagModalEditDraft('');
                };
                return (
                  <div className="space-y-3">
                    {allTags.length === 0 ? (
                      <div className="text-sm text-slate-500 dark:text-slate-400">
                        {modalLocked ? 'No tags' : 'No tags yet — add below'}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((t, i) => {
                          const pillCls =
                            TAG_PALETTE_MAP[tagModalColorList[i]] || TAG_PALETTE_MAP.mint;
                          return (
                            <div
                              key={`tc-alltag-${tcTagOverflowTcId}-${i}`}
                              className="flex items-center gap-1.5 flex-wrap min-w-0"
                            >
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${pillCls}`}
                              >
                                {tcTagModalEditIndex === i ? (
                                  <input
                                    type="text"
                                    value={tcTagModalEditDraft}
                                    onChange={(e) => setTcTagModalEditDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        if (tagEnterShouldIgnoreIme(e)) return;
                                        e.preventDefault();
                                        commitTcTagModalEdit();
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setTcTagModalEditIndex(null);
                                        setTcTagModalEditDraft('');
                                      }
                                    }}
                                    onBlur={commitTcTagModalEdit}
                                    className="min-w-[100px] max-w-[280px] px-2 py-0.5 text-xs rounded-md border border-slate-400/80 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                                    autoFocus
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    disabled={modalLocked}
                                    onClick={() => {
                                      if (modalLocked) return;
                                      setTcTagModalEditIndex(i);
                                      setTcTagModalEditDraft(t);
                                    }}
                                    className="max-w-[200px] truncate text-left font-medium hover:underline disabled:cursor-default disabled:no-underline"
                                    title={modalLocked ? t : 'คลิกเพื่อแก้ไขชื่อ'}
                                  >
                                    {t}
                                  </button>
                                )}
                                {!modalLocked && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (tcTagModalEditIndex === i) {
                                        setTcTagModalEditIndex(null);
                                        setTcTagModalEditDraft('');
                                      }
                                      const row = displayedSavedTestCases.find(
                                        (x) => String(x.id) === String(tcTagOverflowTcId)
                                      );
                                      if (!row) return;
                                      const r =
                                        (row.extraColumns &&
                                          (row.extraColumns.tag || row.extraColumns.Tag)) ||
                                        '';
                                      handleExtraColumnChange(
                                        row.id,
                                        'tag',
                                        removeTagAtIndexFromRaw(r, i)
                                      );
                                    }}
                                    className="ml-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                                    title="Remove tag"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!modalLocked && (
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                          Add tag
                        </label>
                        <input
                          type="text"
                          value={tcTagModalAddDraft}
                          onChange={(e) => setTcTagModalAddDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            if (tagEnterShouldIgnoreIme(e)) return;
                            e.preventDefault();
                            const add = tcTagModalAddDraft.trim();
                            if (!add) return;
                            const r =
                              (otc.extraColumns &&
                                (otc.extraColumns.tag || otc.extraColumns.Tag)) ||
                              '';
                            const next = upsertTagsString(r, add);
                            handleExtraColumnChange(otc.id, 'tag', next);
                            setTcTagModalAddDraft('');
                          }}
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                          placeholder="Type and press Enter (comma allowed)"
                        />
                        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
          document.body
        )}
      {libraryPickerTcOverflowFileName && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setLibraryPickerTcOverflowFileName(null)}
            role="presentation"
          />
          <div className="relative w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Used by test cases</div>
              <button
                type="button"
                onClick={() => setLibraryPickerTcOverflowFileName(null)}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                const list = getTestCasesUsingFile(libraryPickerTcOverflowFileName, fileReferenceTestCases, fileReferenceTestCaseSets);
                return list.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">—</div>
                ) : (
                  <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                    {list.map((u, idx) => (
                      <li key={`browse-tc-${idx}-${u.name}-${u.set || ''}`} className="flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-700 pb-2 last:border-0 last:pb-0">
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">{u.name}</span>
                        {u.set && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {String(u.set).startsWith('Current') ? u.set : `Set: ${u.set}`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {libraryPickerSetsOverflowFileName && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setLibraryPickerSetsOverflowFileName(null)}
            role="presentation"
          />
          <div className="relative w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">Sets using this file</div>
              <button
                type="button"
                onClick={() => setLibraryPickerSetsOverflowFileName(null)}
                className="ml-auto p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 max-h-[min(60vh,360px)] overflow-y-auto">
              {(() => {
                const names = getSetNamesUsingFile(libraryPickerSetsOverflowFileName, fileReferenceTestCaseSets);
                return names.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">—</div>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {names.map((sn) => {
                      const st = setStatusByName.get(sn) ?? null;
                      return (
                        <li
                          key={`browse-set-all-${libraryPickerSetsOverflowFileName}-${sn}`}
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getSetJobStatusPillClass(st)}`}
                          title={st ? `Job status: ${st}` : 'No active job for this set name'}
                        >
                          {sn}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      {libraryPickerSuggest?.rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-lib-picker-suggest-pop
            className="fixed z-[120] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl w-[min(280px,calc(100vw-24px))] max-h-[min(288px,calc(100vh-120px))] flex flex-col"
            style={{
              top: Math.min(
                libraryPickerSuggest.rect.bottom + 6,
                (typeof window !== 'undefined' ? window.innerHeight : 800) - 120
              ),
              left: Math.max(
                12,
                Math.min(
                  libraryPickerSuggest.rect.left,
                  (typeof window !== 'undefined' ? window.innerWidth : 400) - 292
                )
              ),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
              Suggestions
            </div>
            <div className="overflow-y-auto p-1 [scrollbar-width:thin]">
              {libraryPickerSuggestOptions.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-slate-400">No suggestions</div>
              ) : (
                libraryPickerSuggestOptions.map((opt) => {
                  const selField = libraryPickerSuggest.field;
                  return (
                    <button
                      key={`lp-pick-${selField}-${String(opt)}`}
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-xs rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 truncate"
                      title={String(opt)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const v = String(opt);
                        if (selField === 'name') setLibraryPickerNameQ(v);
                        else if (selField === 'tag') setLibraryPickerTagQ(v);
                        else if (selField === 'size') setLibraryPickerSizeQ(v);
                        else if (selField === 'owner') setLibraryPickerOwnerQ(v);
                        else if (selField === 'date') setLibraryPickerDateQ(v);
                        setLibraryPickerSuggest(null);
                      }}
                    >
                      {String(opt).length > 56 ? `${String(opt).slice(0, 55)}…` : String(opt)}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
      </>
      )}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Create Test Case</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm max-w-2xl">
        </p>
      </div>

      {isViewingShared && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Viewing shared profile: <strong>{viewingSharedName}</strong> (read-only)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                copySharedToMyProfile();
                addToast({ type: 'success', message: 'Copied to your profile' });
              }}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700"
            >
              Copy to my profile
            </button>
            <button
              onClick={() => setViewingSharedProfile(null)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Stop viewing
            </button>
          </div>
        </div>
      )}

      {loadedSetId && (() => {
        const loadedSet = displayedSavedTestCaseSets?.find((s) => s.id === loadedSetId);
        const namesArr = loadedSet?.fileLibrarySnapshot?.length
          ? loadedSet.fileLibrarySnapshot.map((s) => s.name)
          : [...(loadedSet?.items || []).reduce((acc, t) => { if (t.vcdName) acc.add(t.vcdName); if (t.binName) acc.add(t.binName); if (t.linName) acc.add(t.linName); return acc; }, new Set())];
        const inLibrary = namesArr.filter((n) => uploadedFiles.some((f) => f.name === n)).length;
        const total = namesArr.length;
        return total > 0 ? (
          <div className="mb-3 rounded-xl border border-blue-200 dark:border-blue-800 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-800 dark:text-blue-200">
            Set &quot;{loadedSet?.name}&quot;: Files in Library {inLibrary}/{total}
            {inLibrary < total && <span className="ml-1"> — Upload missing files in Library to run this set</span>}
          </div>
        ) : null;
      })()}

      {/* Saved Test Cases table (Apply try, Duplicate, Move, Auto select, Save as Set) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col flex-1 min-h-0">
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLibraryPickerNameQ('');
                setLibraryPickerTagQ('');
                setLibraryPickerSizeQ('');
                setLibraryPickerOwnerQ('');
                setLibraryPickerDateQ('');
                setLibraryPickerSuggest(null);
                setLibraryPickerSelectedIds([]);
                setLibraryPickerTagOverflowFileId(null);
                setLibraryPickerTcOverflowFileName(null);
                setTcTagOverflowTcId(null);
                setTcTagModalAddDraft('');
                setTcTagModalEditIndex(null);
                setTcTagModalEditDraft('');
                setTcTagPlusInputTcId(null);
                setLibraryPickerOpen(true);
              }}
              disabled={isViewingShared || !(uploadedFiles?.length > 0)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                isViewingShared || !(uploadedFiles?.length > 0)
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500'
              }`}
              title="เลือกไฟล์จาก Library ในหน้านี้ แล้วจัดกลุ่มตาม TCxxxx อัตโนมัติ"
            >
              <FolderOpen size={14} /> From Library
            </button>
            <button onClick={addOneTestCase} className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2"><Plus size={14} /> Add Test Case</button>
            <div className="relative" data-testcases-insert-menu>
              <button
                type="button"
                onClick={() => setInsertRowMenuOpen((v) => !v)}
                disabled={isViewingShared}
                className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                  isViewingShared
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
                title={
                  isViewingShared
                    ? 'Read-only mode — cannot insert rows'
                    : selectedTestCaseIds.length === 1
                      ? 'Insert row above/below the selected row (Excel-style)'
                      : 'เลือกแถวเดียวในกริดก่อน — แล้วแทรกเหนือหรือใต้แถวนั้น'
                }
              >
                <Plus size={14} />
                <span>Insert</span>
                <ChevronDown size={14} className="opacity-80" />
              </button>
              {insertRowMenuOpen && !isViewingShared && (
                <div className="absolute left-0 top-full mt-1 z-50 min-w-[220px] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg py-1 text-left">
                  <button
                    type="button"
                    onClick={() => handleInsertRowFromToolbar('above')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-left"
                  >
                    <ArrowUpFromLine size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    <span>
                      <span className="font-medium block">Insert row above</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">Insert row above selected row</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertRowFromToolbar('below')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-left border-t border-slate-100 dark:border-slate-700"
                  >
                    <ArrowDownFromLine size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    <span>
                      <span className="font-medium block">Insert row below</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">Insert row below selected row</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <button onClick={clearAllTestCases} disabled={(savedTestCases.length === 0 && workingCount === 0) || isViewingShared} className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${(savedTestCases.length === 0 && workingCount === 0) || isViewingShared ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}><X size={14} /> Clear</button>
            <div className="h-6 w-px bg-slate-300 dark:bg-slate-600 mx-1" />
            <button
              onClick={() => csvInputRef.current?.click()}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 flex items-center gap-1.5"
            >
              <FileUp size={14} />
              <span>Import CSV</span>
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              onChange={handleCsvFileInput}
              className="hidden"
            />
            <button
              onClick={exportTestCasesCsv}
              disabled={displayedSavedTestCases.length === 0 || isViewingShared}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Export test cases to CSV"
            >
              <FileUp size={14} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
        {loadedSetId && displayedSavedTestCaseSets?.find((s) => s.id === loadedSetId) && !isViewingShared && (
          <div className="mb-3 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              Editing set: {displayedSavedTestCaseSets.find((s) => s.id === loadedSetId)?.name}
            </span>
            <button
              onClick={() => {
                const currentSet = displayedSavedTestCaseSets.find((s) => s.id === loadedSetId);
                if (currentSet && isSetInUseByJobs(currentSet)) {
                  addToast({
                    type: 'warning',
                    message: 'ชุด Set นี้กำลังถูกใช้รันอยู่ ไม่สามารถอัปเดต test cases / files ได้จนกว่ารันเสร็จ',
                  });
                  return;
                }
                const badUpdate = (displayedSavedTestCases || []).filter((t) => !isTestCasePrimaryFileSetComplete(t));
                if (badUpdate.length > 0) {
                  const names = badUpdate.map((t) => String(t.name || '—').trim() || '—').slice(0, 5);
                  addToast({
                    type: 'warning',
                    message: `แต่ละ test case ต้องมี VCD, ERoM และ ULP ให้ครบก่อนอัปเดต Set — ${badUpdate.length} แถว: ${names.join(', ')}${badUpdate.length > 5 ? '…' : ''}`,
                  });
                  return;
                }
                const mergeCommandsIntoExtra = (tc) => {
                  const extra = tc.extraColumns && typeof tc.extraColumns === 'object' ? { ...tc.extraColumns } : {};
                  const cmds = Array.isArray(tc.commands) ? tc.commands : [];
                  const vcdCmds = cmds.filter((c) => c.type === 'vcd' && (c.file || '').trim());
                  const eromCmds = cmds.filter((c) => c.type === 'erom' && (c.file || '').trim());
                  const ulpCmds = cmds.filter((c) => c.type === 'ulp' && (c.file || '').trim());
                  const mdiCmds = cmds.filter((c) => c.type === 'mdi' && (c.file || '').trim());
                  vcdCmds.forEach((c, i) => { extra[`VCD${i + 2}`] = c.file || ''; });
                  eromCmds.forEach((c, i) => { extra[`ERoM${i + 2}`] = c.file || ''; });
                  ulpCmds.forEach((c, i) => { extra[`ULP${i + 2}`] = c.file || ''; });
                  mdiCmds.forEach((c, i) => { extra[`MDI${i + 1}`] = c.file || ''; });
                  return Object.fromEntries(Object.entries(extra).filter(([, v]) => (v ?? '').toString().trim() !== ''));
                };
                const normalized = displayedSavedTestCases.map((t) => ({
                  name: t.name || '',
                  vcdName: t.vcdName || '',
                  binName: t.binName || '',
                  linName: t.linName || '',
                  boardId: t.boardId || '',
                  tryCount: typeof t.tryCount === 'number' && t.tryCount > 0 ? t.tryCount : 1,
                  extraColumns: mergeCommandsIntoExtra(t),
                  createdAt: t.createdAt || new Date().toISOString(),
                }));
                const fileNames = new Set();
                displayedSavedTestCases.forEach((t) => {
                  if (t.vcdName) fileNames.add(t.vcdName);
                  if (t.binName) fileNames.add(t.binName);
                  if (t.linName) fileNames.add(t.linName);
                  const ec = mergeCommandsIntoExtra(t);
                  Object.values(ec).forEach((v) => { if ((v ?? '').toString().trim()) fileNames.add(String(v).trim()); });
                });
                const fileLibrarySnapshot = [...fileNames].map((n) => ({ name: n }));
                updateSavedTestCaseSet(loadedSetId, { items: normalized, fileLibrarySnapshot });
                const setName = displayedSavedTestCaseSets.find((s) => s.id === loadedSetId)?.name || 'Set';
                restoreSavedTestCasesFromProfile();
                addToast({ type: 'success', message: `Updated set "${setName}"` });
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700"
            >
              Update set
            </button>
            <button
              onClick={() => {
                restoreSavedTestCasesFromProfile();
              }}
              className="px-2 py-1 rounded text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              Cancel
            </button>
          </div>
        )}
        {displayedSavedTestCases.length > 0 && !isViewingShared && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400"></span>
            {selectedTestCaseIds.length > 0 && (
              <>
                <span className="text-xs text-slate-500">{selectedTestCaseIds.length} selected</span>
                <input type="number" min={1} value={bulkTryCount} onChange={(e) => setBulkTryCount(e.target.value)} placeholder="Try" className="w-16 px-2 py-1 text-xs border border-slate-300 dark:border-slate-500 rounded bg-white dark:bg-slate-800" onKeyDown={(e) => e.key === 'Enter' && handleBulkSetTryCount()} />
                <button onClick={handleBulkSetTryCount} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">Apply</button>
                <span className="text-slate-300 dark:text-slate-600 mx-0.5">|</span>
                <button
                  onClick={handleDeleteSelectedTestCases}
                  disabled={selectedTestCaseIds.some((tid) => isTcStorePending(tid))}
                  className="px-3 py-1 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-700 flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
                  title={
                    selectedTestCaseIds.some((tid) => isTcStorePending(tid))
                      ? 'รอให้ action กับ test case ที่เลือกจบก่อน'
                      : loadedSetId
                        ? 'Remove selected rows from this set (saved rows may delete from library)'
                        : 'Remove selected rows from this table only — does not delete from Library'
                  }
                >
                  <Trash2 size={12} />
                  {loadedSetId ? 'Delete selected' : 'Remove selected'}
                </button>
              </>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
        {/* Tab switcher: Table (horizontal) | Step (vertical layout per image) + Select all when Step */}
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-600">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTestCaseTableLayout('table')}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                testCaseTableLayout === 'table'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setTestCaseTableLayout('step')}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                testCaseTableLayout === 'step'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              Vertical
            </button>
          </div>
          {testCaseTableLayout === 'step' && displayedSavedTestCases.length > 0 && (
            <label className={`flex items-center gap-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 ${isViewingShared ? 'pointer-events-none opacity-70' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={selectedTestCaseIds.length === displayedSavedTestCases.length}
                disabled={isViewingShared}
                onChange={toggleSelectAllTestCases}
                className="w-4 h-4 rounded cursor-pointer"
                title="Select all"
              />
              Select all
            </label>
          )}
        </div>
        <div
          ref={tcBuilderPanelRef}
          className="min-h-[260px] flex-1 resize-y overflow-auto"
          style={{
            height: tcBuilderPanelHeight,
            maxHeight: 'min(92dvh, calc(100dvh - 10.5rem))',
          }}
          onMouseUp={() => {
            const el = tcBuilderPanelRef.current;
            if (!el) return;
            const h = Math.round(el.getBoundingClientRect().height);
            if (Number.isFinite(h) && h >= 260) setTcBuilderPanelHeight(h);
          }}
          title="Drag bottom edge to resize"
        >
        {testCaseTableLayout === 'table' ? (
          /* Tab 1: Table layout (horizontal) — original */
          <div className="overflow-x-auto overflow-y-visible border border-slate-200 dark:border-slate-600 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold text-slate-600 dark:text-slate-400">
                <th className="w-10 px-2 py-2 border-r border-slate-200 dark:border-slate-600">
                  <input
                    type="checkbox"
                    checked={displayedSavedTestCases.length > 0 && selectedTestCaseIds.length === displayedSavedTestCases.length}
                    onChange={toggleSelectAllTestCases}
                    disabled={isViewingShared}
                    className="w-4 h-4 rounded cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="w-8 px-2 py-2 border-r border-slate-200 dark:border-slate-600">#</th>
                <th className="px-2 py-2 border-r border-slate-200 dark:border-slate-600">Name</th>
                <th className="px-2 py-2 border-r border-slate-200 dark:border-slate-600">Tag</th>
                <th className="w-28 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Date</th>
                <th className="px-2 py-2 border-r border-slate-200 dark:border-slate-600">ERoM</th>
                <th className="px-2 py-2 border-r border-slate-200 dark:border-slate-600">ULP</th>
                <th className="px-2 py-2 border-r border-slate-200 dark:border-slate-600">VCD</th>
                {(() => {
                  const allCols = [...new Set(displayedSavedTestCases.flatMap(getTableExtraColKeysForTc))].sort();
                  const extraCols = allCols.filter((col) => !isExtraColumnHiddenFromLibraryTable(col));
                  return extraCols.map((col) => (
                    <th key={col} className="px-2 py-2 border-r border-slate-200 dark:border-slate-600 min-w-[80px]" title="Extra column from CSV">{col}</th>
                  ));
                })()}
                <th className="w-16 px-2 py-2 border-r border-slate-200 dark:border-slate-600 text-center">Try</th>
                <th className="w-32 px-2 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedSavedTestCases.length === 0 ? (
                <tr>
                  <td colSpan={9 + (() => {
                    const allCols = [...new Set(displayedSavedTestCases.flatMap(getTableExtraColKeysForTc))].sort();
                    const extraCols = allCols.filter((col) => !isExtraColumnHiddenFromLibraryTable(col));
                    return extraCols.length;
                  })()} className="py-8 text-center text-slate-400">
                    No test cases — use From Library or Add Test Case
                  </td>
                </tr>
              ) : (
                displayedSavedTestCases.map((tc, idx) => {
                  const tcPending = isTcStorePending(tc.id);
                  return (
                  <tr
                    key={tc.id}
                    data-tc-row-id={String(tc.id)}
                    onDragEnter={(e) => e.preventDefault()}
                    onDragOver={(e) => handleRowDragOver(e, idx)}
                    onDrop={(e) => handleRowDrop(e, idx)}
                    className={`border-b border-slate-100 dark:border-slate-700 ${
                      draggingRowIndex === idx ? 'opacity-50' : ''
                    } ${
                      dropTargetRowIndex === idx
                        ? 'ring-1 ring-blue-400 bg-blue-50 dark:bg-blue-900/20'
                        : ''
                    } ${
                      tcPending ? 'ring-1 ring-amber-400/50 dark:ring-amber-500/40' : ''
                    } ${
                      selectedTestCaseIds.includes(tc.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    } ${
                      duplicateHighlightIds.includes(tc.id) ? 'animate-pulse ring-1 ring-emerald-400' : ''
                    } ${
                      isTestCaseInUseByBatch(tc) ? 'opacity-75 bg-slate-50 dark:bg-slate-800/50' : ''
                    }`}
                  >
                    <td
                      className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700"
                      onClick={() => toggleTestCaseSelect(tc.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTestCaseIds.includes(tc.id)}
                        onChange={() => toggleTestCaseSelect(tc.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700">
                      <input
                        type="text"
                        value={tc.name || ''}
                        onChange={(e) =>
                          handleNameChange(tc.id, e.target.value, tc.name || '')
                        }
                        disabled={isTestCaseInUseByBatch(tc) || isViewingShared}
                        className={`w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 ${isTestCaseInUseByBatch(tc) ? 'opacity-70 cursor-not-allowed' : ''}`}
                        placeholder="set name"
                        title={isTestCaseInUseByBatch(tc) ? 'ล็อก — test case อยู่ใน process (running/pending)' : 'Use a unique name for this test case'}
                      />
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 min-w-[120px] align-middle">
                      <div className="flex items-center justify-center min-h-[30px]">
                        {renderTestCaseTagCell(tc)}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs text-center whitespace-nowrap">
                      {(tc.updatedAt || tc.createdAt) ? new Date(tc.updatedAt || tc.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700">
                      <select
                        value={tc.binName || ''}
                        onChange={(e) =>
                          updateDisplayedTestCase(tc.id, { binName: e.target.value })
                        }
                        disabled={isTestCaseLocked(tc.id) || isTestCaseInUseByBatch(tc) || isViewingShared}
                        className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        title={
                          isTestCaseLocked(tc.id)
                            ? 'Files are locked because this test case is used in a set. Duplicate this test case to change files.'
                            : isTestCaseInUseByBatch(tc)
                              ? 'Files are locked because this test case is in a running or pending set. Duplicate this test case to change files.'
                            : 'Select ERoM file'
                        }
                      >
                        <option value="">— ERoM —</option>
                        {binFilesList.map((f) => (
                          <option key={f.id} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                        {tc.binName &&
                          !binFilesList.some((f) => f.name === tc.binName) && (
                            <option value={tc.binName}>{tc.binName}</option>
                          )}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700">
                      <select
                        value={tc.linName || ''}
                        onChange={(e) =>
                          updateDisplayedTestCase(tc.id, {
                            linName: e.target.value || undefined,
                          })
                        }
                        disabled={isTestCaseLocked(tc.id) || isTestCaseInUseByBatch(tc) || isViewingShared}
                        className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        title={
                          isTestCaseLocked(tc.id)
                            ? 'Files are locked because this test case is used in a set. Duplicate this test case to change files.'
                            : isTestCaseInUseByBatch(tc)
                            ? 'Files are locked because this test case is in a running or pending set. Duplicate this test case to change files.'
                            : 'Select ULP file'
                        }
                      >
                        <option value="">— ULP —</option>
                        {linFilesList.map((f) => (
                          <option key={f.id} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                        {tc.linName &&
                          !linFilesList.some((f) => f.name === tc.linName) && (
                            <option value={tc.linName}>{tc.linName}</option>
                          )}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700">
                      <select
                        value={tc.vcdName || ''}
                        onChange={(e) =>
                          updateDisplayedTestCase(tc.id, { vcdName: e.target.value })
                        }
                        disabled={isTestCaseLocked(tc.id) || isTestCaseInUseByBatch(tc) || isViewingShared}
                        className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        title={
                          isTestCaseLocked(tc.id)
                            ? 'Files are locked because this test case is used in a set. Duplicate this test case to change files.'
                            : isTestCaseInUseByBatch(tc)
                            ? 'Files are locked because this test case is in a running or pending set. Duplicate this test case to change files.'
                            : 'Select VCD file'
                        }
                      >
                        <option value="">— VCD —</option>
                        {vcdFilesList.map((f) => (
                          <option key={f.id} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                        {tc.vcdName &&
                          !vcdFilesList.some((f) => f.name === tc.vcdName) && (
                            <option value={tc.vcdName}>{tc.vcdName}</option>
                          )}
                      </select>
                    </td>
                    {(() => {
                      const allCols = [...new Set(displayedSavedTestCases.flatMap(getTableExtraColKeysForTc))].sort();
                      const extraCols = allCols.filter((col) => !isExtraColumnHiddenFromLibraryTable(col));
                      const isFileCol = (c) => /^(VCD|ERoM|ULP|MDI)\d+$/.test(c);
                      const fileListForCol = (c) =>
                        c.startsWith('VCD') ? vcdFilesList : c.startsWith('ERoM') ? binFilesList : c.startsWith('MDI') ? mdiFilesList : linFilesList;
                      return extraCols.map((col) => (
                        <td key={col} className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700">
                          {isFileCol(col) ? (
                            <select
                              value={getTableExtraColVal(tc, col)}
                              onChange={(e) => handleExtraColumnChange(tc.id, col, e.target.value)}
                              disabled={isTestCaseLocked(tc.id) || isTestCaseInUseByBatch(tc) || isViewingShared}
                              className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                              title={
                                isTestCaseLocked(tc.id)
                                ? 'Files are locked because this test case is used in a set. Duplicate this test case to change files.'
                                : isTestCaseInUseByBatch(tc)
                                  ? 'Files are locked because this test case is in a running or pending set. Duplicate this test case to change files.'
                                  : `Select file for ${col}`
                              }
                            >
                              <option value="">— {col} —</option>
                              {fileListForCol(col).map((f) => (
                                <option key={f.id} value={f.name}>{f.name}</option>
                              ))}
                              {getTableExtraColVal(tc, col) && !fileListForCol(col).some((f) => f.name === getTableExtraColVal(tc, col)) && (
                                <option value={getTableExtraColVal(tc, col)}>{getTableExtraColVal(tc, col)}</option>
                              )}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={getTableExtraColVal(tc, col)}
                              onChange={(e) => handleExtraColumnChange(tc.id, col, e.target.value)}
                              disabled={isTestCaseInUseByBatch(tc) || isViewingShared}
                              className={`w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 ${isTestCaseInUseByBatch(tc) ? 'opacity-70 cursor-not-allowed' : ''}`}
                              placeholder="—"
                            />
                          )}
                        </td>
                      ));
                    })()}
                    <td className="px-2 py-1.5 border-r border-slate-100 dark:border-slate-700">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={tc.tryCount ?? 1}
                        onChange={(e) =>
                          updateDisplayedTestCase(tc.id, {
                            tryCount: Math.max(
                              1,
                              Math.min(100, parseInt(e.target.value, 10) || 1),
                            ),
                          })
                        }
                        disabled={isTestCaseInUseByBatch(tc) || isViewingShared}
                        className={`w-full px-1 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-center ${isTestCaseInUseByBatch(tc) ? 'opacity-70 cursor-not-allowed' : ''}`}
                        title={isTestCaseInUseByBatch(tc) ? 'ล็อก — อยู่ใน process' : undefined}
                      />
                    </td>
                    <td className="px-2 py-1.5 flex items-center justify-center gap-0.5 relative">
                      <span
                        draggable={!tcPending}
                        onDragStart={(e) => handleRowDragStart(e, idx)}
                        onDragEnd={handleRowDragEnd}
                        className={`p-1 text-slate-400 hover:text-slate-600 ${tcPending ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                        title={tcPending ? 'กำลังลบ/สำเนา/จัดเรียง — รอสักครู่' : 'Drag to reorder'}
                      >
                        <GripVertical size={14} />
                      </span>
                      <button
                        type="button"
                        disabled={tcPending}
                        onClick={() => {
                          duplicateDisplayedTestCase(tc.id, {
                            name: getNextTestCaseName(),
                          });
                          addToast({ type: 'success', message: 'Saved as new test case' });
                        }}
                        className="p-1 text-slate-500 hover:text-blue-600 rounded disabled:opacity-40 disabled:pointer-events-none"
                        title="Duplicate this test case"
                      >
                        <Copy size={14} />
                      </button>
                      {/* Add extra file/command — menu rendered via portal (avoids overflow clip in Vertical / table panels) */}
                      <div className="relative">
                        <button
                          type="button"
                          data-testcase-command-menu-trigger
                          onClick={(e) => {
                            const el = e.currentTarget;
                            setCommandMenuPopover((prev) => {
                              if (prev?.tcId === tc.id) return null;
                              const r = el.getBoundingClientRect();
                              return {
                                tcId: tc.id,
                                anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
                              };
                            });
                          }}
                          className="p-1 rounded border border-slate-200 dark:border-slate-600 text-blue-600 hover:text-blue-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                          title="Add extra file (MDI / VCD / ERoM / ULP)"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => moveDisplayedTestCaseUp(tc.id)}
                        disabled={idx === 0 || tcPending}
                        className="p-1 text-slate-500 hover:text-slate-700 disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDisplayedTestCaseDown(tc.id)}
                        disabled={idx === displayedSavedTestCases.length - 1 || isViewingShared || tcPending}
                        className="p-1 text-slate-500 hover:text-slate-700 disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isTestCaseInUseByBatch(tc)) {
                            addToast({ type: 'warning', message: 'This test case uses files in a running or pending set. Wait for the set to finish.' });
                            return;
                          }
                          removeDisplayedTestCase(tc.id, idx);
                          queueMicrotask(() =>
                            addToast({
                              type: 'success',
                              message: isDraftId(tc.id) ? 'Row removed from this table (Library unchanged)' : 'Removed',
                            })
                          );
                        }}
                        disabled={isTestCaseInUseByBatch(tc) || tcPending}
                        className="p-1 text-red-500 hover:text-red-700 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          tcPending
                            ? 'กำลังลบ/สำเนา/จัดเรียง — รอสักครู่'
                            : isDraftId(tc.id)
                              ? 'Remove this row from the table only — does not delete from Library'
                              : isTestCaseInUseByBatch(tc)
                                ? 'In use by a running or pending set'
                                : 'Remove from library'
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
                })
              )}
            </tbody>
          </table>
        </div>
        ) : (
          /* Tab 2: Vertical — single row, scroll horizontally; newest / latest updated first (left) */
          <div className="flex flex-row flex-nowrap gap-3 overflow-x-auto pb-1 scroll-smooth [scrollbar-gutter:stable]">
            {displayedSavedTestCases.length === 0 ? (
              <div className="w-full min-w-0 py-8 text-center text-slate-400 text-sm border border-slate-200 dark:border-slate-600 rounded-lg">
                No test cases — use From Library or Add Test Case
              </div>
            ) : (
              stepViewOrderedCases.map(({ tc, originalIndex }, displayIdx) => {
                const tcPending = isTcStorePending(tc.id);
                return (
                <div
                  key={tc.id}
                  onDragEnter={(e) => e.preventDefault()}
                  onDragOver={(e) => handleRowDragOver(e, originalIndex)}
                  onDrop={(e) => handleRowDrop(e, originalIndex)}
                  className={`shrink-0 w-[min(100%,380px)] min-w-[280px] border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 ${
                    draggingRowIndex === originalIndex ? 'opacity-50' : ''
                  } ${
                    dropTargetRowIndex === originalIndex
                      ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : ''
                  } ${tcPending ? 'ring-1 ring-amber-400/50 dark:ring-amber-500/40' : ''} ${selectedTestCaseIds.includes(tc.id) ? 'bg-blue-50/60 dark:bg-blue-900/20' : ''}`}
                >
                  {/* Test case header: checkbox + handle + name + tag + actions */}
                  <div className="flex items-start gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
                    {/* Checkbox: left-most */}
                    <div className="pt-1 shrink-0">
                      <input
                        type="checkbox"
                        checked={selectedTestCaseIds.includes(tc.id)}
                        onChange={() => toggleTestCaseSelect(tc.id)}
                        className="w-4 h-4 rounded cursor-pointer"
                      />
                    </div>

                    {/* Drag handle */}
                    <span
                      draggable={!tcPending}
                      onDragStart={(e) => handleRowDragStart(e, originalIndex)}
                      onDragEnd={handleRowDragEnd}
                      className={`p-1 shrink-0 mt-0.5 text-slate-400 hover:text-slate-600 ${tcPending ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                      title={tcPending ? 'กำลังลบ/สำเนา/จัดเรียง — รอสักครู่' : 'Drag to reorder'}
                    >
                      <GripVertical size={16} />
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Name row: input grows; tag strip must not shrink to 0 (was breaking + / tag clicks in Vertical) */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500 shrink-0">#{displayIdx + 1}</span>
                        <input
                          type="text"
                          value={tc.name || ''}
                          onChange={(e) => handleNameChange(tc.id, e.target.value, tc.name || '')}
                          className="min-w-[100px] flex-1 basis-0 px-2 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 font-medium"
                          placeholder="Test case name"
                          title="Use a unique name"
                        />
                        <div className="shrink-0 min-w-0 relative z-10">{renderTestCaseTagCell(tc)}</div>
                      </div>
                    </div>

                    {/* Actions: right-most, separated */}
                    <div className="flex items-center gap-1 shrink-0 border-l border-slate-200 dark:border-slate-700 pl-2">
                      <button
                        type="button"
                        disabled={tcPending}
                        onClick={() => {
                          duplicateDisplayedTestCase(tc.id, { name: getNextTestCaseName() });
                          addToast({ type: 'success', message: 'Saved as new test case' });
                        }}
                        className="p-1 text-slate-500 hover:text-blue-600 rounded disabled:opacity-40 disabled:pointer-events-none"
                        title="Duplicate this test case"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isTestCaseInUseByBatch(tc)) {
                            addToast({ type: 'warning', message: 'This test case uses files in a running or pending set. Wait for the set to finish.' });
                            return;
                          }
                          removeDisplayedTestCase(tc.id, originalIndex);
                          queueMicrotask(() =>
                            addToast({
                              type: 'success',
                              message: isDraftId(tc.id) ? 'Row removed from this table (Library unchanged)' : 'Removed',
                            })
                          );
                        }}
                        disabled={isTestCaseInUseByBatch(tc) || tcPending}
                        className="p-1 text-red-500 hover:text-red-700 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          tcPending
                            ? 'กำลังลบ/สำเนา/จัดเรียง — รอสักครู่'
                            : isDraftId(tc.id)
                              ? 'Remove this row from the table only — does not delete from Library'
                              : isTestCaseInUseByBatch(tc)
                                ? 'In use by a running or pending set'
                                : 'Remove from library'
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Files: EROM → ULP → VCD in one row (matches table order) */}
                  <div className="px-3 py-1.5 space-y-2">
                    <div className="grid grid-cols-3 gap-2 min-w-0">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[10px] font-semibold text-slate-500">EROM</span>
                        <select
                          value={tc.binName || ''}
                          onChange={(e) => updateDisplayedTestCase(tc.id, { binName: e.target.value })}
                          disabled={isTestCaseLocked(tc.id) || isViewingShared}
                          className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                          title={
                            isTestCaseLocked(tc.id)
                              ? 'Files are locked because this test case is used in a set. Use “Save as new test case” to change files.'
                              : 'Select ERoM file'
                          }
                        >
                          <option value="">— ERoM —</option>
                          {binFilesList.map((f) => (
                            <option key={f.id} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                          {tc.binName && !binFilesList.some((f) => f.name === tc.binName) && (
                            <option value={tc.binName}>{tc.binName}</option>
                          )}
                        </select>
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[10px] font-semibold text-slate-500">ULP</span>
                        <select
                          value={tc.linName || ''}
                          onChange={(e) => updateDisplayedTestCase(tc.id, { linName: e.target.value || undefined })}
                          disabled={isTestCaseLocked(tc.id) || isViewingShared}
                          className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                          title={
                            isTestCaseLocked(tc.id)
                              ? 'Files are locked because this test case is used in a set. Use “Save as new test case” to change files.'
                              : 'Select ULP file'
                          }
                        >
                          <option value="">— ULP —</option>
                          {linFilesList.map((f) => (
                            <option key={f.id} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                          {tc.linName && !linFilesList.some((f) => f.name === tc.linName) && (
                            <option value={tc.linName}>{tc.linName}</option>
                          )}
                        </select>
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[10px] font-semibold text-slate-500">VCD</span>
                        <select
                          value={tc.vcdName || ''}
                          onChange={(e) => updateDisplayedTestCase(tc.id, { vcdName: e.target.value })}
                          disabled={isTestCaseLocked(tc.id) || isViewingShared}
                          className="w-full min-w-0 px-1.5 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                          title={
                            isTestCaseLocked(tc.id)
                              ? 'Files are locked because this test case is used in a set. Use “Save as new test case” to change files.'
                              : 'Select VCD file'
                          }
                        >
                          <option value="">— VCD —</option>
                          {vcdFilesList.map((f) => (
                            <option key={f.id} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                          {tc.vcdName && !vcdFilesList.some((f) => f.name === tc.vcdName) && (
                            <option value={tc.vcdName}>{tc.vcdName}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    {/* Date / Try / lock — full-width strip under files (not under name) */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 mt-1 border-t border-slate-100 dark:border-slate-800/90 text-[10px] text-slate-500 dark:text-slate-400">
                      <span>
                        Date:{' '}
                        {(tc.updatedAt || tc.createdAt)
                          ? new Date(tc.updatedAt || tc.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500" aria-hidden>
                        ·
                      </span>
                      <span>Try {tc.tryCount ?? 1}</span>
                      {isTestCaseLocked(tc.id) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 text-[10px] font-semibold">
                          Locked in set
                        </span>
                      )}
                    </div>
                    {(() => {
                      const verticalExtraRows = Object.entries(tc.extraColumns || {}).filter(([col, val]) => {
                        if (isExtraColumnHiddenFromLibraryTable(col)) return false;
                        const m = col.match(/^(VCD|ERoM|ULP|MDI)(\d+)$/);
                        if (!m) return true;
                        if (!String(val || '').trim()) return false;
                        if (m[1] === 'MDI') {
                          const idx = parseInt(m[2], 10) - 1;
                          const mdis = (tc.commands || []).filter((c) => c.type === 'mdi');
                          return idx >= mdis.length;
                        }
                        const type = m[1] === 'VCD' ? 'vcd' : m[1] === 'ERoM' ? 'erom' : 'ulp';
                        const idx = parseInt(m[2], 10) - 2;
                        const cmds = (tc.commands || []).filter((c) => c.type === type && (c.file || '').trim());
                        return idx >= cmds.length;
                      });
                      if (verticalExtraRows.length === 0) return null;
                      return (
                      <div className="grid grid-cols-1 gap-y-1.5">
                        {verticalExtraRows.map(([col, val]) => {
                          const isFileCol = /^(VCD|ERoM|ULP|MDI)\d+$/.test(col);
                          const fileList = col.startsWith('VCD') ? vcdFilesList : col.startsWith('ERoM') ? binFilesList : col.startsWith('MDI') ? mdiFilesList : linFilesList;
                          const displayVal = (() => {
                            const m = col.match(/^VCD(\d+)$/);
                            if (m) {
                              const idx = parseInt(m[1], 10) - 2;
                              const vcds = (tc.commands || []).filter((c) => c.type === 'vcd' && (c.file || '').trim());
                              return vcds[idx]?.file ?? val ?? '';
                            }
                            const m2 = col.match(/^ERoM(\d+)$/);
                            if (m2) {
                              const idx = parseInt(m2[1], 10) - 2;
                              const eroms = (tc.commands || []).filter((c) => c.type === 'erom' && (c.file || '').trim());
                              return eroms[idx]?.file ?? val ?? '';
                            }
                            const m3 = col.match(/^ULP(\d+)$/);
                            if (m3) {
                              const idx = parseInt(m3[1], 10) - 2;
                              const ulps = (tc.commands || []).filter((c) => c.type === 'ulp' && (c.file || '').trim());
                              return ulps[idx]?.file ?? val ?? '';
                            }
                            const m4 = col.match(/^MDI(\d+)$/);
                            if (m4) {
                              const idx = parseInt(m4[1], 10) - 1;
                              const mdis = (tc.commands || []).filter((c) => c.type === 'mdi');
                              return mdis[idx]?.file ?? val ?? '';
                            }
                            return val ?? '';
                          })();
                          return (
                            <div key={col} className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-semibold text-slate-500 shrink-0">{col}:</span>
                              {isFileCol ? (
                                <select
                                  value={displayVal}
                                  onChange={(e) => handleExtraColumnChange(tc.id, col, e.target.value)}
                                  disabled={isTestCaseLocked(tc.id) || isViewingShared}
                                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                                  title={
                                    isTestCaseLocked(tc.id)
                                      ? 'Files are locked because this test case is used in a set. Use “Save as new test case” to change files.'
                                      : `Select file for ${col}`
                                  }
                                >
                                  <option value="">— {col} —</option>
                                  {fileList.map((f) => (
                                    <option key={f.id} value={f.name}>{f.name}</option>
                                  ))}
                                  {displayVal && !fileList.some((f) => f.name === displayVal) && (
                                    <option value={displayVal}>{displayVal}</option>
                                  )}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={displayVal}
                                  onChange={(e) => handleExtraColumnChange(tc.id, col, e.target.value)}
                                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                                  placeholder="—"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      );
                    })()}
                  </div>
                  {/* Command section: compact — only + button when empty; list when commands exist */}
                  <div className="px-3 py-1 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex items-center justify-end">
                      <div className="relative">
                        <button
                          type="button"
                          data-testcase-command-menu-trigger
                          onClick={(e) => {
                            const el = e.currentTarget;
                            setCommandMenuPopover((prev) => {
                              if (prev?.tcId === tc.id) return null;
                              const r = el.getBoundingClientRect();
                              return {
                                tcId: tc.id,
                                anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
                              };
                            });
                          }}
                          className="p-1 rounded border border-slate-200 dark:border-slate-600 text-blue-600 hover:text-blue-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                          title="Add command"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    {(tc.commands && tc.commands.length > 0) ? (
                      <div className="space-y-1 mt-1">
                        {(tc.commands || []).map((cmd) => {
                          const label = cmd.type === 'mdi' ? 'MDI:' : cmd.type === 'vcd' ? 'VCD:' : cmd.type === 'erom' ? 'EROM:' : 'ULP:';
                          const fileList = cmd.type === 'mdi' ? mdiFilesList : cmd.type === 'vcd' ? vcdFilesList : cmd.type === 'erom' ? binFilesList : linFilesList;
                          const placeholder = cmd.type === 'mdi' ? '— Text file —' : cmd.type === 'vcd' ? '— VCD —' : cmd.type === 'erom' ? '— EROM —' : '— ULP —';
                          return (
                            <div key={cmd.id} className="flex items-center gap-2 min-h-[28px]">
                              <span className="text-xs font-medium text-slate-500 w-12 shrink-0">{label}</span>
                              <select
                                value={cmd.file || ''}
                                onChange={(e) => updateDisplayedTestCaseCommand(tc.id, cmd.id, { file: e.target.value })}
                                className="flex-1 min-w-0 px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                              >
                                <option value="">{placeholder}</option>
                                {fileList.map((f) => (
                                  <option key={f.id} value={f.name}>{f.name}</option>
                                ))}
                                {cmd.file && !fileList.some((f) => f.name === cmd.file) && (
                                  <option value={cmd.file}>{cmd.file}</option>
                                )}
                              </select>
                              <button
                                type="button"
                                onClick={() => removeDisplayedTestCaseCommand(tc.id, cmd.id)}
                                className="p-0.5 text-red-500 hover:text-red-700 rounded shrink-0 flex items-center justify-center"
                                title="Remove"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
              })
            )}
          </div>
        )}
        </div>
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <button
            onClick={handleSaveAndSendToRunSet}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5"
            title="Save test cases and then jump to Run Set"
          >
            <Play size={14} />
            <span>Save&Send to run set</span>
          </button>
          <button
            onClick={handleSaveToLibrary}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5"
            title="Save test cases. Pending local files are uploaded to Library when you save."
          >
            <Save size={14} />
            <span>Save to library</span>
          </button>
        </div>

      </div>
    </div>
  );
};

export default TestCasesPage;
